import { z } from "zod";
import { approvedScopes, command, encryptedToken, recordId, siteIdentity, timestamp, version } from "../../lib/domain/contracts.ts";
import type { EncryptedToken, SiteIdentity } from "../../lib/domain/contracts.ts";
import { googleFailure } from "../../lib/google/errors.ts";
import { parseGoogleGrantedScopes } from "../../lib/google/permissions.ts";
import type { GoogleScope } from "../../lib/google/permissions.ts";
import type { OAuthPurpose } from "../../lib/google/oauth-state.ts";
import type { GoogleTokenBinding } from "../../lib/google/token-crypto.ts";
import { executeAtomic, guardedUpdate, readStorage, requireInBatch } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";
import { googleConnectionStatements, googleTokenStatements } from "./google.ts";

const managedRow = z.object({ id: recordId, version, connectionId: recordId, connectionVersion: version, generation: version, state: z.enum(["active", "partial", "refreshing", "refresh-unknown", "reconsent", "disconnecting", "disconnected"]), googleSubject: z.string(), googleEmail: z.string().email(), scopes: z.string(), accessExpiresAt: timestamp, authorizedAt: timestamp, refreshExpiresAt: timestamp.nullable(), refreshLeaseId: z.string().nullable(), refreshLeaseExpiresAt: timestamp.nullable(), storageEvidence: z.string().nullable(), providerRevocation: z.enum(["none", "pending", "revoked", "failed", "unknown"]) }).strict();
export type StoredGoogleToken = Readonly<{ token: EncryptedToken; tokenVersion: number }>;
export type ManagedGoogleConnection = Readonly<Omit<z.infer<typeof managedRow>, "scopes"> & { scopes: readonly GoogleScope[] }>;
const targetRow = z.object({ id: recordId, version, googleSubject: z.string() }).strict();
export type GoogleConnectionWritePlan = Readonly<{ owner: SiteIdentity; current: ManagedGoogleConnection | null; target: z.infer<typeof targetRow> | null; binding: GoogleTokenBinding; runtimeId: string; purpose: OAuthPurpose }>;
const metadata = z.object({ subject: z.string().min(1).max(200), email: z.string().email().max(254), scopes: z.array(z.string()).max(4), accessExpiresAt: timestamp, refreshExpiresAt: timestamp.nullable(), authorizedAt: timestamp }).strict();
export type GoogleConnectionMetadata = Readonly<z.infer<typeof metadata>>;

/** 화면에 표시할 정보와 연결 제어 상태만 조회하며 토큰 원문은 포함하지 않습니다. */
export async function readManagedGoogleConnection(db: D1Database, owner: SiteIdentity): Promise<ManagedGoogleConnection | null> {
  siteIdentity.parse(owner);
  const row: unknown = await readStorage("google.managed.read", () => db.prepare("SELECT r.id,r.version,r.connection_id AS connectionId,c.version AS connectionVersion,r.generation,r.state,c.google_subject AS googleSubject,r.google_email AS googleEmail,c.scopes,c.expires_at AS accessExpiresAt,r.authorized_at AS authorizedAt,r.refresh_expires_at AS refreshExpiresAt,r.refresh_lease_id AS refreshLeaseId,r.refresh_lease_expires_at AS refreshLeaseExpiresAt,r.storage_evidence AS storageEvidence,r.provider_revocation AS providerRevocation FROM google_runtime r JOIN google_connections c ON c.owner_id=r.owner_id AND c.id=r.connection_id WHERE r.owner_id=?").bind(owner.userId).first());
  if (row === null) return null;
  const parsed = managedRow.parse(row);
  const scopes: readonly string[] = z.array(z.enum(approvedScopes)).parse(JSON.parse(parsed.scopes));
  return { ...parsed, scopes: parseGoogleGrantedScopes(["openid", "email", ...scopes].join(" ")) };
}

/** 다른 Google sub로의 전환은 현재 연결·세대에 결합된 명시적 재연결만 허용합니다. */
export async function prepareGoogleConnectionWrite(db: D1Database, owner: SiteIdentity, subject: string, purpose: OAuthPurpose): Promise<GoogleConnectionWritePlan> {
  const current: ManagedGoogleConnection | null = await readManagedGoogleConnection(db, owner);
  if (current?.state === "disconnecting") throw googleFailure("google_connection_unavailable", "connection-disconnect-pending");
  if (current === null ? purpose.kind !== "connect" : purpose.kind !== "reconnect" || purpose.connectionId !== current.connectionId || purpose.generation !== current.generation) throw googleFailure("google_account_replacement_denied", "connection-prepare");
  const existing: unknown = await readStorage("google.managed.target", () => db.prepare("SELECT id,version,google_subject AS googleSubject FROM google_connections WHERE owner_id=? AND google_subject=?").bind(owner.userId, subject).first());
  const target: z.infer<typeof targetRow> | null = existing === null ? null : targetRow.parse(existing);
  const connectionId = target?.id ?? recordId.parse(crypto.randomUUID());
  return { owner: siteIdentity.parse(owner), current, target, binding: { ownerId: owner.userId, connectionId, generation: version.parse((current?.generation ?? 0) + 1) }, runtimeId: current?.id ?? crypto.randomUUID(), purpose };
}

/** 토큰·연결·현재 소유자 포인터를 한 batch로 저장하며 늦은 동의 결과는 버전 검사로 거부합니다. */
export async function saveManagedGoogleConnection(db: D1Database, plan: GoogleConnectionWritePlan, attemptId: string, value: GoogleConnectionMetadata, token: EncryptedToken): Promise<Receipt> {
  const input: GoogleConnectionMetadata = metadata.parse(value); encryptedToken.parse(token); recordId.parse(attemptId);
  const scopes: readonly GoogleScope[] = parseGoogleGrantedScopes(input.scopes.join(" "));
  const dataScopes: (typeof approvedScopes[number])[] = approvedScopes.filter(scope => scopes.includes(scope));
  const state: "active" | "partial" = dataScopes.length === approvedScopes.length ? "active" : "partial";
  if (input.accessExpiresAt <= input.authorizedAt || input.refreshExpiresAt !== null && input.refreshExpiresAt <= input.authorizedAt || plan.owner.userId !== plan.binding.ownerId || plan.target !== null && plan.target.googleSubject !== input.subject) throw googleFailure("google_configuration_invalid", "connection-save");
  const context = command.parse({ owner: plan.owner, requestKey: attemptId, expectedVersion: plan.current?.version ?? 1 });
  return executeAtomic(db, context, "google.managed.connect", { plan, metadata: input, token }, plan.runtimeId, plan.current === null ? 1 : plan.current.version + 1, (requestId: string): readonly D1PreparedStatement[] => {
    const statements: D1PreparedStatement[] = [requireInBatch(db, plan.owner.userId, requestId, 0, "EXISTS(SELECT 1 FROM google_oauth_attempts WHERE owner_id=? AND id=? AND consumed_at IS NOT NULL AND purpose=? AND connection_id IS ? AND connection_generation IS ?)", [plan.owner.userId, attemptId, plan.purpose.kind, plan.purpose.kind === "reconnect" ? plan.purpose.connectionId : null, plan.purpose.kind === "reconnect" ? plan.purpose.generation : null])];
    if (plan.current !== null && plan.current.connectionId !== plan.binding.connectionId) {
      statements.push(...guardedUpdate(db, "google_connections", plan.owner.userId, plan.current.connectionId, plan.current.connectionVersion, requestId, 1, "revoked_at=?,reconnect_required=1", [input.authorizedAt], "1", []));
      statements.push(db.prepare("DELETE FROM google_tokens WHERE owner_id=? AND connection_id=?").bind(plan.owner.userId, plan.current.connectionId));
    }
    if (plan.target === null) statements.push(...googleConnectionStatements(db, plan.owner, { id: plan.binding.connectionId, google: { realm: "google", subject: input.subject }, scopes: dataScopes, expiresAt: input.accessExpiresAt, token }, requestId));
    else {
      statements.push(...guardedUpdate(db, "google_connections", plan.owner.userId, plan.target.id, plan.target.version, requestId, 2, "scopes=?,expires_at=?,revoked_at=NULL,reconnect_required=0", [JSON.stringify(dataScopes), input.accessExpiresAt], "google_subject=?", [input.subject]));
      statements.push(db.prepare("DELETE FROM google_tokens WHERE owner_id=? AND connection_id=?").bind(plan.owner.userId, plan.target.id), ...googleTokenStatements(db, plan.owner, plan.target.id, token, requestId));
    }
    if (plan.current === null) statements.push(db.prepare("INSERT INTO google_runtime (owner_id,id,version,last_request_id,connection_id,generation,state,google_email,authorized_at,refresh_expires_at,refresh_lease_id,refresh_lease_expires_at,storage_evidence,provider_revocation) VALUES (?,?,1,?,?,?,?,?,?,?,NULL,NULL,NULL,'none')").bind(plan.owner.userId, plan.runtimeId, requestId, plan.binding.connectionId, plan.binding.generation, state, input.email, input.authorizedAt, input.refreshExpiresAt));
    else statements.push(...guardedUpdate(db, "google_runtime", plan.owner.userId, plan.current.id, plan.current.version, requestId, 3, "connection_id=?,generation=?,state=?,google_email=?,authorized_at=?,refresh_expires_at=?,refresh_lease_id=NULL,refresh_lease_expires_at=NULL,storage_evidence=NULL,provider_revocation='none'", [plan.binding.connectionId, plan.binding.generation, state, input.email, input.authorizedAt, input.refreshExpiresAt], "generation=? AND connection_id=?", [plan.current.generation, plan.current.connectionId]));
    return statements;
  });
}

/** 현재 연결과 동일한 세대에서만 암호문을 조회하며 비활성 연결은 토큰을 꺼내지 않습니다. */
export async function readManagedGoogleToken(db: D1Database, owner: SiteIdentity, connection: ManagedGoogleConnection): Promise<StoredGoogleToken> {
  if (!["active", "partial", "refreshing", "disconnecting"].includes(connection.state)) throw googleFailure("google_connection_unavailable", "token-read-state");
  const row = await readStorage("google.managed.token", () => db.prepare("SELECT t.algorithm,t.ciphertext,t.nonce,t.key_version AS keyVersion,t.version AS tokenVersion FROM google_tokens t JOIN google_runtime r ON r.owner_id=t.owner_id AND r.connection_id=t.connection_id WHERE r.owner_id=? AND r.id=? AND r.version=? AND r.generation=? AND r.state=?").bind(owner.userId, connection.id, connection.version, connection.generation, connection.state).first());
  if (row === null) throw googleFailure("google_connection_unavailable", "token-read-version");
  const parsed = encryptedToken.extend({ tokenVersion: version }).parse(row);
  return { token: encryptedToken.parse({ algorithm: parsed.algorithm, ciphertext: parsed.ciphertext, nonce: parsed.nonce, keyVersion: parsed.keyVersion }), tokenVersion: parsed.tokenVersion };
}
