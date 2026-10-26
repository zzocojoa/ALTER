import { z } from "zod";
import { contentHash } from "../domain/contracts.ts";
import { googleExternalId, googleFileId } from "./resources.ts";
import type { GoogleMethod, GoogleResourceRole } from "./permissions.ts";
import { googleMethodPolicies } from "./permissions.ts";
import { googleFailure } from "./errors.ts";

const title = z.string().trim().min(1).max(200);
const range = z.string().min(1).max(200).regex(/^[^\u0000-\u001f\\]+$/);
const eventId = z.string().regex(/^[a-v0-9]{5,1024}$/);
const time = z.object({ dateTime: z.string().datetime({ offset: true }), timeZone: z.literal("Asia/Seoul") }).strict();
const eventBody = z.object({ summary: title, description: z.string().max(10_000), start: time, end: time, recurrence: z.array(z.string().regex(/^RRULE:[A-Z0-9=;,]+$/)).max(1), businessKey:z.string().min(1).max(200) }).strict().refine(value => Date.parse(value.start.dateTime) < Date.parse(value.end.dateTime));
const cells = z.array(z.array(z.union([z.string().max(50_000), z.number().finite(), z.boolean()])).max(100)).min(1).max(1000);
export const googleRestInput = z.discriminatedUnion("method", [
  z.object({ method: z.literal("drive.about.get") }).strict(),
  z.object({ method: z.literal("drive.files.get"), fileId: googleFileId }).strict(),
  z.object({ method:z.literal("drive.files.get-media"),fileId:googleFileId,mime:z.enum(["application/pdf","image/png","image/jpeg"]),maximumBytes:z.number().int().min(65_536).max(20_971_520),expectedBytes:z.number().int().positive().max(20_971_520).nullable() }).strict(),
  z.object({ method: z.literal("drive.files.list"),parentId:googleFileId,businessKey:z.string().regex(/^[A-Za-z0-9:_-]{1,100}$/),pageToken:z.string().min(1).max(2000).nullable() }).strict(),
  z.object({ method: z.literal("drive.files.create"),title,businessKey:z.string().min(1).max(100) }).strict(),
  z.object({ method: z.literal("drive.files.update"),fileId:googleFileId,parentId:googleFileId,previousParent:googleFileId.nullable(),businessKey:z.string().min(1).max(100) }).strict(),
  z.object({ method: z.literal("drive.files.export"), fileId: googleFileId }).strict(),
  z.object({ method: z.literal("docs.documents.get"), documentId: googleFileId }).strict(),
  z.object({ method: z.literal("docs.documents.create"), title }).strict(),
  z.object({ method: z.literal("docs.documents.batchUpdate"), documentId: googleFileId, revisionId: z.string().min(1).max(200), text: z.string().min(1).max(200_000), tabId:z.string().min(1).max(200), endIndex:z.number().int().min(2).max(200_002) }).strict(),
  z.object({ method: z.literal("sheets.spreadsheets.get"), spreadsheetId: googleFileId }).strict(),
  z.object({ method: z.literal("sheets.spreadsheets.create"), title }).strict(),
  z.object({ method: z.literal("sheets.values.get"), spreadsheetId: googleFileId, range }).strict(),
  z.object({ method: z.literal("sheets.values.append"), spreadsheetId: googleFileId, range, values: cells }).strict(),
  z.object({ method: z.literal("sheets.values.update"), spreadsheetId: googleFileId, range, values: cells }).strict(),
  z.object({ method: z.literal("calendar.calendars.get"), calendarId: googleExternalId }).strict(),
  z.object({ method: z.literal("calendar.calendars.insert"), title }).strict(),
  z.object({ method: z.literal("calendar.events.get"), calendarId: googleExternalId, eventId }).strict(),
  z.object({ method: z.literal("calendar.events.list"), calendarId: googleExternalId, timeMin: z.string().datetime({ offset: true }), timeMax: z.string().datetime({ offset: true }) }).strict(),
  z.object({ method: z.literal("calendar.events.insert"), calendarId: googleExternalId, eventId, event: eventBody }).strict(),
  z.object({ method: z.literal("calendar.events.update"), calendarId: googleExternalId, eventId, etag: z.string().min(1).max(200).regex(/^[^\r\n]+$/), event: eventBody }).strict(),
  z.object({ method: z.literal("calendar.events.delete"), calendarId: googleExternalId, eventId, etag: z.string().min(1).max(200).regex(/^[^\r\n]+$/) }).strict(),
]);
export type GoogleRestInput = Readonly<z.infer<typeof googleRestInput>>;
export type GoogleRestRequest = Readonly<{ method: Exclude<GoogleMethod, "picker.open">; httpMethod: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"; url: string; body: string | null; ifMatch: string | null; externalId: string | null; role: GoogleResourceRole; response: "json" | "text" | "empty" | "stream"; maximumBytes: number; hash: string }>;
type RestFields = Omit<GoogleRestRequest, "hash" | "method" | "role" | "maximumBytes">;

/** 호출자가 URL·헤더를 지정할 수 없으며 업무 입력을 허용된 공식 메서드로만 변환합니다. */
export async function prepareGoogleRestRequest(value: GoogleRestInput, role: GoogleResourceRole): Promise<GoogleRestRequest> {
  const input: GoogleRestInput = googleRestInput.parse(value);
  const policy = googleMethodPolicies[input.method];
  if (!(policy.roles as readonly GoogleResourceRole[]).includes(role)) throw googleFailure("google_scope_denied", input.method);
  const fields: RestFields = googleRestFields(input);
  const bytes: number = fields.body === null ? 0 : new TextEncoder().encode(fields.body).byteLength;
  if (bytes > 2_000_000) throw googleFailure("google_configuration_invalid", "rest-body-size");
  const maximumBytes:number=input.method==="drive.files.get-media"?input.maximumBytes:googleResponseLimit(input.method);
  return { ...fields, method: input.method, role, maximumBytes, hash: await contentHash({ input, role, maximumBytes }) };
}
/** 메타데이터·본문 응답의 실제 수신 상한과 quota 예약 상한을 같은 값으로 사용합니다. */
export function googleResponseLimit(method:Exclude<GoogleMethod,"picker.open">):number {
  switch(method) {
    case "drive.files.get-media":return 20_971_520;
    case "drive.files.export":case "docs.documents.get":case "sheets.values.get":return 4_194_304;
    case "drive.files.list":return 262_144;
    case "calendar.events.list":return 1_048_576;
    default:return 65_536;
  }
}
export function googleBatchSubrequests(request:GoogleRestRequest):number {
  if(request.method!=="docs.documents.batchUpdate") return 0;
  if(request.body===null) throw new TypeError("Docs batch 본문이 없습니다.");
  return z.object({requests:z.array(z.unknown()).min(1).max(2)}).parse(JSON.parse(request.body)).requests.length;
}
function googleRestFields(input: GoogleRestInput): RestFields {
  const json = (httpMethod: RestFields["httpMethod"], url: string, externalId: string | null, body: string | null): RestFields => ({ httpMethod, url, externalId, body, ifMatch: null, response: "json" });
  switch (input.method) {
    case "drive.about.get": return json("GET", "https://www.googleapis.com/drive/v3/about?fields=storageQuota", null, null);
    case "drive.files.get": return json("GET", `https://www.googleapis.com/drive/v3/files/${input.fileId}?fields=id,name,mimeType,trashed,isAppAuthorized,modifiedTime,capabilities(canEdit,canDownload),size,version,parents,appProperties`, input.fileId, null);
    case "drive.files.get-media":return {...json("GET",`https://www.googleapis.com/drive/v3/files/${input.fileId}?alt=media`,input.fileId,null),response:"stream"};
    case "drive.files.list": return json("GET",`https://www.googleapis.com/drive/v3/files?${new URLSearchParams({q:`'${input.parentId}' in parents and trashed = false and appProperties has { key='alterBusinessKey' and value='${input.businessKey}' }`,spaces:"drive",corpora:"user",pageSize:"100",fields:"nextPageToken,incompleteSearch,files(id,name,mimeType,trashed,isAppAuthorized,parents,appProperties)",...(input.pageToken===null?{}:{pageToken:input.pageToken})})}`,input.parentId,null);
    case "drive.files.create": return json("POST","https://www.googleapis.com/drive/v3/files?fields=id",null,JSON.stringify({name:input.title,mimeType:"application/vnd.google-apps.folder",appProperties:{alterBusinessKey:input.businessKey}}));
    case "drive.files.update": return json("PATCH",`https://www.googleapis.com/drive/v3/files/${input.fileId}?${new URLSearchParams({addParents:input.parentId,...(input.previousParent===null?{}:{removeParents:input.previousParent}),fields:"id,parents,appProperties"})}`,input.fileId,JSON.stringify({appProperties:{alterBusinessKey:input.businessKey}}));
    case "drive.files.export": return { ...json("GET", `https://www.googleapis.com/drive/v3/files/${input.fileId}/export?mimeType=text%2Fplain`, input.fileId, null), response: "text" };
    case "docs.documents.get": return json("GET", `https://docs.googleapis.com/v1/documents/${input.documentId}?includeTabsContent=true`, input.documentId, null);
    case "docs.documents.create": return json("POST", "https://docs.googleapis.com/v1/documents", null, JSON.stringify({ title: input.title }));
    case "docs.documents.batchUpdate": return json("POST", `https://docs.googleapis.com/v1/documents/${input.documentId}:batchUpdate`, input.documentId, JSON.stringify({ writeControl: { requiredRevisionId: input.revisionId }, requests: [...(input.endIndex>2?[{deleteContentRange:{range:{startIndex:1,endIndex:input.endIndex-1,tabId:input.tabId}}}]:[]),{ insertText: { location: {index:1,tabId:input.tabId}, text: input.text } }] }));
    case "sheets.spreadsheets.get": return json("GET", `https://sheets.googleapis.com/v4/spreadsheets/${input.spreadsheetId}?includeGridData=false&fields=spreadsheetId,properties(title),sheets(properties(sheetId,title,gridProperties))`, input.spreadsheetId, null);
    case "sheets.spreadsheets.create": return json("POST", "https://sheets.googleapis.com/v4/spreadsheets", null, JSON.stringify({ properties: { title: input.title },sheets:[{properties:{title:"ALTER",gridProperties:{rowCount:1000,columnCount:100}}}] }));
    case "sheets.values.get": return json("GET", `https://sheets.googleapis.com/v4/spreadsheets/${input.spreadsheetId}/values/${encodeURIComponent(input.range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`, input.spreadsheetId, null);
    case "sheets.values.append": return json("POST", `https://sheets.googleapis.com/v4/spreadsheets/${input.spreadsheetId}/values/${encodeURIComponent(input.range)}:append?valueInputOption=RAW&insertDataOption=OVERWRITE`, input.spreadsheetId, JSON.stringify({ range: input.range, majorDimension: "ROWS", values: input.values }));
    case "sheets.values.update": return json("PUT", `https://sheets.googleapis.com/v4/spreadsheets/${input.spreadsheetId}/values/${encodeURIComponent(input.range)}?valueInputOption=RAW`, input.spreadsheetId, JSON.stringify({ range: input.range, majorDimension: "ROWS", values: input.values }));
    case "calendar.calendars.get": return json("GET", `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}`,input.calendarId,null);
    case "calendar.calendars.insert": return json("POST", "https://www.googleapis.com/calendar/v3/calendars", null, JSON.stringify({ summary: input.title, timeZone: "Asia/Seoul" }));
    case "calendar.events.get": return json("GET", `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/${input.eventId}`, input.calendarId, null);
    case "calendar.events.list": {
      if (Date.parse(input.timeMin) >= Date.parse(input.timeMax)) throw googleFailure("google_configuration_invalid", "calendar-time-range");
      return json("GET", `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events?${new URLSearchParams({ timeMin: input.timeMin, timeMax: input.timeMax, maxResults: "100", singleEvents: "false" })}`, input.calendarId, null);
    }
    case "calendar.events.insert": return json("POST", `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events?sendUpdates=none`, input.calendarId, JSON.stringify({ ...googleEventBody(input.event), id: input.eventId }));
    case "calendar.events.update": return { ...json("PUT", `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/${input.eventId}?sendUpdates=none`, input.calendarId, JSON.stringify(googleEventBody(input.event))), ifMatch: input.etag };
    case "calendar.events.delete": return { ...json("DELETE", `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/${input.eventId}?sendUpdates=none`, input.calendarId, null), ifMatch: input.etag, response: "empty" };
  }
}

function googleEventBody(event:z.infer<typeof eventBody>):Readonly<{summary:string;description:string;start:z.infer<typeof time>;end:z.infer<typeof time>;recurrence:readonly string[];extendedProperties:Readonly<{private:Readonly<{alterBusinessKey:string}>}>}> {
  return {summary:event.summary,description:event.description,start:event.start,end:event.end,recurrence:event.recurrence,extendedProperties:{private:{alterBusinessKey:event.businessKey}}};
}
