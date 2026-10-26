import { z } from "zod";
import { googleMethodPolicies } from "../google/permissions.ts";

const googleMethod = z.enum(Object.keys(googleMethodPolicies) as [keyof typeof googleMethodPolicies, ...(keyof typeof googleMethodPolicies)[]]);

export const externalFailure = z.object({
  code:z.string().regex(/^[a-z0-9_-]{1,80}$/), phase:z.enum(["write","verify"]), status:z.number().int().min(100).max(599).nullable(),
  reason:z.string().regex(/^[a-z0-9_-]{1,80}$/), category:z.enum(["temporary","authentication","permission","configuration","storage","conflict","missing","unknown"]),
  action:z.enum(["verify-after-delay","reconnect","review-permission","review-configuration","review-storage","review-content","inspect"]),
  method:googleMethod.nullable(), requestHash:z.string().regex(/^[a-f0-9]{64}$/).nullable(), retryAfterMs:z.number().int().nonnegative().safe().nullable(),
}).strict();
export type ExternalFailure = Readonly<z.infer<typeof externalFailure>>;
const restError=z.object({code:z.literal("google_rest_failed"),method:googleMethod,requestHash:z.string().regex(/^[a-f0-9]{64}$/),status:z.number().int().min(100).max(599).nullable(),reason:z.enum(["unauthorized","forbidden","api-disabled","storage-full","quota","not-found","conflict","server","network","invalid-response","request-rejected"]),retryAfterMs:z.number().int().nonnegative().safe().nullable()});
const oauthError=z.object({code:z.literal("google_oauth_transport_failed"),operation:z.enum(["code-exchange","refresh","signing-keys"]),status:z.number().int().min(100).max(599).nullable(),providerError:z.enum(["invalid_request","invalid_client","invalid_grant","unauthorized_client","unsupported_grant_type","invalid_scope","access_denied","temporarily_unavailable","server_error"]).nullable()});
const localCategories:Readonly<Record<string,Readonly<Pick<ExternalFailure,"category"|"action">>>>=Object.freeze({
  external_content_conflict:{category:"conflict",action:"review-content"},
  google_quota_exhausted:{category:"temporary",action:"verify-after-delay"}, google_request_unknown:{category:"unknown",action:"inspect"},
  google_connection_unavailable:{category:"authentication",action:"reconnect"},google_scope_denied:{category:"permission",action:"review-permission"},
  google_storage_exhausted:{category:"storage",action:"review-storage"}, google_storage_unverified:{category:"storage",action:"review-storage"},
  google_api_disabled:{category:"configuration",action:"review-configuration"},google_quota_unverified:{category:"configuration",action:"review-configuration"},
  google_configuration_invalid:{category:"configuration",action:"review-configuration"},google_project_unverified:{category:"configuration",action:"review-configuration"},
  google_free_conditions_unverified:{category:"configuration",action:"review-configuration"},google_oauth_unverified:{category:"configuration",action:"review-configuration"},
  google_token_key_missing:{category:"configuration",action:"review-configuration"},google_token_integrity_invalid:{category:"authentication",action:"reconnect"},
});
function restCategory(reason:z.infer<typeof restError>["reason"]):Readonly<Pick<ExternalFailure,"category"|"action">> {
  switch(reason) {
    case "quota":case "network":case "server":return {category:"temporary",action:"verify-after-delay"};
    case "unauthorized":return {category:"authentication",action:"reconnect"};
    case "forbidden":return {category:"permission",action:"review-permission"};
    case "api-disabled":return {category:"configuration",action:"review-configuration"};
    case "storage-full":return {category:"storage",action:"review-storage"};
    case "conflict":return {category:"conflict",action:"review-content"};
    case "not-found":return {category:"missing",action:"inspect"};
    case "request-rejected":case "invalid-response":return {category:"unknown",action:"inspect"};
  }
}
/** 쓰기의 일시 오류도 재전송 허가로 변환하지 않으며 원문·토큰을 오류 필드에 복사하지 않습니다. */
export function classifyExternalFailure(error:unknown,phase:ExternalFailure["phase"]):ExternalFailure {
  const rest=restError.safeParse(error);
  if(rest.success) return {...rest.data,phase,...restCategory(rest.data.reason)};
  const oauth=oauthError.safeParse(error);
  if(oauth.success) return {code:oauth.data.code,phase,status:oauth.data.status,reason:oauth.data.providerError??"oauth-response-unclassified",category:oauth.data.providerError==="invalid_grant" || oauth.data.operation==="refresh"?"authentication":"configuration",action:oauth.data.providerError==="invalid_grant" || oauth.data.operation==="refresh"?"reconnect":"review-configuration",method:null,requestHash:null,retryAfterMs:null};
  const code=z.object({code:z.string()}).safeParse(error);
  const recognized=code.success && Object.hasOwn(localCategories,code.data.code)?localCategories[code.data.code]:undefined;
  if(code.success && recognized) return {code:code.data.code,phase,status:null,reason:code.data.code,...recognized,method:null,requestHash:null,retryAfterMs:null};
  return {code:"external_unclassified_failure",phase,status:null,reason:"unclassified-error",category:"unknown",action:"inspect",method:null,requestHash:null,retryAfterMs:null};
}
