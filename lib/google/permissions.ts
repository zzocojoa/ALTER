import { z } from "zod";
import { approvedScopes, recordId, timestamp, version } from "../domain/contracts.ts";
import { googleFailure } from "./errors.ts";
import type { GoogleApi } from "./project.ts";

export const googleIdentityScopes = ["openid", "email"] as const;
export const googleRequestedScopes = [...googleIdentityScopes, ...approvedScopes] as const;
export type GoogleScope = typeof googleRequestedScopes[number];
export type GoogleResourceRole = "account" | "picker" | "selection-candidate" | "reference" | "docs-target" | "sheets-target" | "calendar-target" | "docs-create" | "sheets-create" | "calendar-create" | "folder-target" | "folder-create";
export type GoogleMethodPolicy = Readonly<{ api: GoogleApi; scope: typeof approvedScopes[number]; action: "read" | "write" | "create" | "browser"; roles: readonly GoogleResourceRole[]; source: string }>;
const driveScope: typeof approvedScopes[0] = approvedScopes[0];
const calendarScope: typeof approvedScopes[1] = approvedScopes[1];

/** 실제 실행도 아래 메서드로만 제한하며 scope 지원 근거와 자원 역할을 함께 유지합니다. */
export const googleMethodPolicies = {
  "drive.about.get": { api: "drive", scope: driveScope, action: "read", roles: ["account"], source: "https://developers.google.com/workspace/drive/api/reference/rest/v3/about/get" },
  "drive.files.get": { api: "drive", scope: driveScope, action: "read", roles: ["selection-candidate", "reference", "docs-target", "sheets-target", "folder-target"], source: "https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get" },
  "drive.files.get-media": { api: "drive", scope: driveScope, action: "read", roles: ["reference"], source: "https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get" },
  "drive.files.list": { api: "drive", scope: driveScope, action: "read", roles: ["folder-target"], source: "https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list" },
  "drive.files.create": { api: "drive", scope: driveScope, action: "create", roles: ["folder-create"], source: "https://developers.google.com/workspace/drive/api/reference/rest/v3/files/create" },
  "drive.files.update": { api: "drive", scope: driveScope, action: "write", roles: ["docs-target", "sheets-target"], source: "https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update" },
  "drive.files.export": { api: "drive", scope: driveScope, action: "read", roles: ["reference"], source: "https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export" },
  "docs.documents.get": { api: "docs", scope: driveScope, action: "read", roles: ["reference", "docs-target"], source: "https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/get" },
  "docs.documents.create": { api: "docs", scope: driveScope, action: "create", roles: ["docs-create"], source: "https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/create" },
  "docs.documents.batchUpdate": { api: "docs", scope: driveScope, action: "write", roles: ["docs-target"], source: "https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate" },
  "sheets.spreadsheets.get": { api: "sheets", scope: driveScope, action: "read", roles: ["reference", "sheets-target"], source: "https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get" },
  "sheets.spreadsheets.create": { api: "sheets", scope: driveScope, action: "create", roles: ["sheets-create"], source: "https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/create" },
  "sheets.values.get": { api: "sheets", scope: driveScope, action: "read", roles: ["reference", "sheets-target"], source: "https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get" },
  "sheets.values.append": { api: "sheets", scope: driveScope, action: "write", roles: ["sheets-target"], source: "https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append" },
  "sheets.values.update": { api: "sheets", scope: driveScope, action: "write", roles: ["sheets-target"], source: "https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/update" },
  "calendar.calendars.get": { api: "calendar", scope: calendarScope, action: "read", roles: ["calendar-target"], source: "https://developers.google.com/workspace/calendar/api/v3/reference/calendars/get" },
  "calendar.calendars.insert": { api: "calendar", scope: calendarScope, action: "create", roles: ["calendar-create"], source: "https://developers.google.com/workspace/calendar/api/v3/reference/calendars/insert" },
  "calendar.events.get": { api: "calendar", scope: calendarScope, action: "read", roles: ["calendar-target"], source: "https://developers.google.com/workspace/calendar/api/v3/reference/events/get" },
  "calendar.events.list": { api: "calendar", scope: calendarScope, action: "read", roles: ["calendar-target"], source: "https://developers.google.com/workspace/calendar/api/v3/reference/events/list" },
  "calendar.events.insert": { api: "calendar", scope: calendarScope, action: "write", roles: ["calendar-target"], source: "https://developers.google.com/workspace/calendar/api/v3/reference/events/insert" },
  "calendar.events.update": { api: "calendar", scope: calendarScope, action: "write", roles: ["calendar-target"], source: "https://developers.google.com/workspace/calendar/api/v3/reference/events/update" },
  "calendar.events.delete": { api: "calendar", scope: calendarScope, action: "write", roles: ["calendar-target"], source: "https://developers.google.com/workspace/calendar/api/v3/reference/events/delete" },
  "picker.open": { api: "picker", scope: driveScope, action: "browser", roles: ["picker"], source: "https://developers.google.com/workspace/drive/picker/guides/overview" },
} as const satisfies Readonly<Record<string, GoogleMethodPolicy>>;
export type GoogleMethod = keyof typeof googleMethodPolicies;

/** email의 공식 동의 응답 표기만 정규화하고 더 넓은 권한을 묵시적으로 수용하지 않습니다. */
export function parseGoogleGrantedScopes(raw: string): readonly GoogleScope[] {
  if (!raw || raw.length > 2000) throw googleFailure("google_scope_denied", "scope-response");
  const items: readonly string[] = raw.split(" ").map((value: string): string => value === "https://www.googleapis.com/auth/userinfo.email" ? "email" : value);
  if (items.some((value: string): boolean => !(googleRequestedScopes as readonly string[]).includes(value)) || !items.includes("openid") || !items.includes("email")) throw googleFailure("google_scope_denied", "scope-response");
  return googleRequestedScopes.filter((scope: GoogleScope): boolean => items.includes(scope));
}
export function requireGoogleMethodScope(method: GoogleMethod, scopes: readonly string[]): GoogleMethodPolicy {
  if (!Object.hasOwn(googleMethodPolicies, method)) throw googleFailure("google_scope_denied", "method-unknown");
  const policy: GoogleMethodPolicy = googleMethodPolicies[method];
  const approved: readonly GoogleScope[] = parseGoogleGrantedScopes(scopes.join(" "));
  if (!approved.includes(policy.scope)) throw googleFailure("google_scope_denied", method);
  return policy;
}

const resourceGrant = z.object({
  ownerId: z.string().min(1).max(200), connectionId: recordId, generation: version,
  role: z.enum(["account", "picker", "selection-candidate", "reference", "docs-target", "sheets-target", "calendar-target", "docs-create", "sheets-create", "calendar-create", "folder-create", "folder-target"]),
  externalId: z.string().min(1).max(500).nullable(), appCreated: z.boolean(), approvedAt: timestamp, checkedAt: timestamp, validUntil: timestamp,
}).strict();
export type GoogleResourceGrant = Readonly<z.infer<typeof resourceGrant>>;

/** 이 계약의 입력은 요청 본문이 아닌 서버가 조회한 자원 승인 레코드여야 합니다. */
export function requireGoogleResourceGrant(value: GoogleResourceGrant, ownerId: string, connectionId: string, generation: number, method: GoogleMethod, scopes: readonly string[], externalId: string | null, now: number): void {
  timestamp.parse(now);
  const policy: GoogleMethodPolicy = requireGoogleMethodScope(method, scopes);
  const parsed = resourceGrant.safeParse(value);
  if (!parsed.success) throw googleFailure("google_scope_denied", method);
  const grant: GoogleResourceGrant = parsed.data;
  if (grant.ownerId !== ownerId || grant.connectionId !== connectionId || grant.generation !== generation || !policy.roles.includes(grant.role) || grant.externalId !== externalId || grant.approvedAt > now || grant.checkedAt > now || grant.validUntil <= now || grant.validUntil - grant.checkedAt > 60_000) throw googleFailure("google_scope_denied", method);
  const noTarget: boolean = ["account", "picker", "docs-create", "sheets-create", "calendar-create", "folder-create"].includes(grant.role);
  if (noTarget ? externalId !== null : externalId === null || /[\s\u0000-\u001f/?#\\]/.test(externalId)) throw googleFailure("google_scope_denied", method);
  if (grant.role === "folder-target" && !grant.appCreated) throw googleFailure("google_scope_denied", method);
  if (grant.role === "calendar-target" && (!grant.appCreated || externalId === "primary")) throw googleFailure("google_scope_denied", method);
}
