import { z } from "zod";
import { googleFileMetadata } from "../google/resources.ts";
import { materialFailure,materialPolicy } from "../materials/policy.ts";
import type { MaterialKind } from "../materials/policy.ts";

export const googleReferenceMetadata=googleFileMetadata.extend({version:z.string().regex(/^[1-9]\d{0,19}$/),capabilities:z.object({canEdit:z.boolean(),canDownload:z.literal(true)})});
export type GoogleReferenceMetadata=Readonly<z.infer<typeof googleReferenceMetadata>>;
export type GoogleReferenceFormat=Readonly<{kind:MaterialKind;mime:"application/pdf"|"image/png"|"image/jpeg"|"text/plain";extension:"pdf"|"png"|"jpg"|"txt";maximumBytes:number;expectedBytes:number|null}>;
export const googleReferenceProof=z.object({fileId:z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),title:z.string().min(1).max(1024),modifiedTime:z.string().datetime(),driveVersion:z.string().regex(/^[1-9]\d{0,19}$/),sourceMime:z.string(),sourceUrl:z.string().url(),mime:z.enum(["application/pdf","image/png","image/jpeg","text/plain"]),bytes:z.number().int().positive().max(20_971_520),sha256:z.string().regex(/^[a-f0-9]{64}$/),maximumReadBufferBytes:z.number().int().positive().max(1_048_576),documentRevision:z.string().nullable()}).strict().refine(value=>value.sourceUrl===`https://drive.google.com/file/d/${value.fileId}/view`);
export type GoogleReferenceProof=Readonly<z.infer<typeof googleReferenceProof>>;

/** Google 원본 크기와 ALTER 사본 한도를 별도로 검사합니다. */
export function googleReferenceFormat(file:GoogleReferenceMetadata):GoogleReferenceFormat {
  const format=file.mimeType==="application/vnd.google-apps.document"?{kind:"text",mime:"text/plain",extension:"txt"} as const:file.mimeType==="application/pdf"?{kind:"pdf",mime:"application/pdf",extension:"pdf"} as const:file.mimeType==="image/png"?{kind:"image",mime:"image/png",extension:"png"} as const:file.mimeType==="image/jpeg"?{kind:"image",mime:"image/jpeg",extension:"jpg"} as const:null;
  if(format===null)throw materialFailure("material_type_mismatch","google-reference-type",415);
  const maximumBytes:number=materialPolicy.types[format.kind].maximumBytes;
  const expectedBytes:number|null=format.kind==="text" || file.size===undefined?null:Number(file.size);
  if(expectedBytes!==null && (!Number.isSafeInteger(expectedBytes) || expectedBytes<1 || expectedBytes>maximumBytes))throw materialFailure("material_size_exceeded","google-reference-size",413);
  return {...format,maximumBytes,expectedBytes};
}
export function requireUnchangedGoogleReference(before:GoogleReferenceMetadata,after:GoogleReferenceMetadata):void {
  if(before.id!==after.id || before.version!==after.version || before.modifiedTime!==after.modifiedTime || before.mimeType!==after.mimeType || before.name!==after.name || before.size!==after.size || after.trashed || !after.isAppAuthorized)throw materialFailure("material_version_conflict","google-source-changed-during-read",409);
}
