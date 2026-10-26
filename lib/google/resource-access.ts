import { recordId } from "../domain/contracts.ts";
import type { SiteIdentity } from "../domain/contracts.ts";
import { googleFailure } from "./errors.ts";
import { requireGoogleResourceGrant } from "./permissions.ts";
import type { GoogleResourceGrant } from "./permissions.ts";
import type { GoogleRestRequest } from "./rest-request.ts";
import type { GooglePickerSelection } from "./picker.ts";
import { verifyGoogleFile, verifiedGoogleResourceGrant } from "./resources.ts";
import type { GoogleStoredResourceRole } from "./resources.ts";
import { readGoogleResource } from "../../db/repositories/google-resources.ts";
import type { ManagedGoogleConnection } from "../../db/repositories/google-managed.ts";
import { readStorage } from "../../db/repositories/atomic.ts";

/** 자원 승인은 항상 D1에서 읽으며 파일 업무 전에 quota를 예약한 메타데이터 조회를 다시 수행합니다. */
export async function authorizeGoogleRestResource(db: D1Database, owner: SiteIdentity, connection: ManagedGoogleConnection, request: GoogleRestRequest, selection: GooglePickerSelection | null, now: number, readMetadata: (id: string, role: GoogleStoredResourceRole) => Promise<unknown>): Promise<GoogleResourceGrant> {
  const initial: GoogleResourceGrant = { ownerId: owner.userId, connectionId: recordId.parse(connection.connectionId), generation: connection.generation, role: request.role, externalId: request.externalId, appCreated: false, approvedAt: now, checkedAt: now, validUntil: now + 60_000 };
  if (request.role === "selection-candidate") {
    if (!selection || request.method !== "drive.files.get" || selection.fileId !== request.externalId || selection.connectionId !== connection.connectionId || selection.generation !== connection.generation) throw googleFailure("google_scope_denied", "selection-candidate");
    const lease = await readStorage("google.selection.candidate", () => db.prepare("SELECT id FROM google_picker_leases WHERE owner_id=? AND id=? AND connection_id=? AND generation=? AND role=? AND state='consumed' AND expires_at>?").bind(owner.userId, selection.leaseId, selection.connectionId, selection.generation, selection.role, now).first());
    if (!lease) throw googleFailure("google_scope_denied", "selection-lease");
    requireGoogleResourceGrant(initial, owner.userId, connection.connectionId, connection.generation, request.method, connection.scopes, request.externalId, now); return initial;
  }
  if (request.externalId === null) { requireGoogleResourceGrant(initial, owner.userId, connection.connectionId, connection.generation, request.method, connection.scopes, null, now); return initial; }
  if (!["reference", "docs-target", "sheets-target", "calendar-target", "folder-target"].includes(request.role)) throw googleFailure("google_scope_denied", "resource-role");
  const role: GoogleStoredResourceRole = request.role as GoogleStoredResourceRole;
  const resource = await readGoogleResource(db, owner, connection, request.externalId, role);
  if (request.method === "drive.files.update" && resource.source !== "app-created") throw googleFailure("google_scope_denied","placement-app-created-only");
  if (role === "calendar-target" || request.method === "drive.files.get") {
    const grant: GoogleResourceGrant = { ...initial, approvedAt: resource.approvedAt, appCreated: resource.source === "app-created" };
    requireGoogleResourceGrant(grant, owner.userId, connection.connectionId, connection.generation, request.method, connection.scopes, request.externalId, now); return grant;
  }
  const metadata: unknown = await readMetadata(request.externalId, role);
  const file = verifyGoogleFile(metadata, request.externalId, role, now);
  const grant = verifiedGoogleResourceGrant(owner.userId, connection.connectionId, connection.generation, resource.approvedAt, resource.source === "app-created", file, now);
  requireGoogleResourceGrant(grant, owner.userId, connection.connectionId, connection.generation, request.method, connection.scopes, request.externalId, now);
  return grant;
}
