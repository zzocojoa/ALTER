import { createHash } from "node:crypto";
import type { Hash } from "node:crypto";
import type { SiteIdentity } from "../domain/contracts.ts";
import { materialFailure,materialPolicy } from "../materials/policy.ts";
import { prepareGoogleExecution,recordGoogleExecutionFailure,recordGoogleExecutionSuccess } from "../google/execute.ts";
import type { GoogleExecutionRuntime,GoogleExecutionSettings } from "../google/execute.ts";
import { fetchGoogleRestResponse,googleRestFailure } from "../google/rest-transport.ts";
import type { GoogleRestInput } from "../google/rest-request.ts";

export type GoogleMediaProof=Readonly<{bytes:number;sha256:string;maximumReadBufferBytes:number}>;
/** 완료 검증을 통과한 뒤에만 스트림을 닫으며 실패한 다운로드는 자동 재전송하지 않습니다. */
export async function openGoogleReferenceMedia(db:D1Database,owner:SiteIdentity,settings:GoogleExecutionSettings,input:Extract<GoogleRestInput,{method:"drive.files.get-media"}>,runtime:GoogleExecutionRuntime,complete:(proof:GoogleMediaProof)=>Promise<void>):Promise<ReadableStream<Uint8Array>> {
  const prepared=await prepareGoogleExecution(db,owner,settings,input,{id:crypto.randomUUID(),role:"reference",storageUpperBytes:0,selection:null,context:null},runtime);
  let response:Response|null=null;let reader:ReadableStreamBYOBReader;
  try {
    response=await fetchGoogleRestResponse(runtime.rest,prepared.request,prepared.token);
    if(response.headers.get("content-type")?.split(";")[0].trim()!==input.mime || response.body===null)throw googleRestFailure(prepared.request,response.status,"invalid-response",null);
    const encoding:string|null=response.headers.get("content-encoding");
    if(encoding!==null && !["identity","gzip","br","deflate"].includes(encoding.toLowerCase().trim()))throw googleRestFailure(prepared.request,response.status,"invalid-response",null);
    const length:string|null=encoding===null || encoding==="identity"?response.headers.get("content-length"):null;
    if(length!==null && (!/^[1-9]\d*$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length)>input.maximumBytes || input.expectedBytes!==null && Number(length)!==input.expectedBytes))throw googleRestFailure(prepared.request,response.status,"invalid-response",null);
    reader=response.body.getReader({mode:"byob"});
  } catch(error:unknown){if(response?.body!==null && response?.body!==undefined && !response.body.locked)await response.body.cancel(error);return recordGoogleExecutionFailure(db,owner,prepared,error,runtime);}
  const status:number=response.status;
  const hash:Hash=createHash("sha256");let bytes:number=0;let maximumReadBufferBytes:number=0;let finalized:boolean=false;
  const fail=async(error:unknown):Promise<never>=>{
    try{await reader.cancel(error);}catch(cleanup:unknown){if(cleanup!==error)throw new AggregateError([error,cleanup],"Google 다운로드 입력 정리 실패");}finally{reader.releaseLock();}
    if(finalized)throw error;finalized=true;return recordGoogleExecutionFailure(db,owner,prepared,error,runtime);
  };
  return new ReadableStream({type:"bytes",async pull(controller:ReadableByteStreamController):Promise<void>{
    try {
      const part=await reader.read(new Uint8Array(materialPolicy.streamChunkBytes));
      if(part.done){
        if(bytes<1 || input.expectedBytes!==null && bytes!==input.expectedBytes)throw materialFailure("material_body_length_invalid","google-media-incomplete",422);
        finalized=true;await recordGoogleExecutionSuccess(db,owner,prepared,{status,data:null,externalId:null},runtime);
        await complete({bytes,sha256:hash.digest("hex"),maximumReadBufferBytes});reader.releaseLock();controller.close();return;
      }
      bytes+=part.value.byteLength;if(bytes>input.maximumBytes || input.expectedBytes!==null && bytes>input.expectedBytes)throw materialFailure("material_size_exceeded","google-media-stream",413);
      maximumReadBufferBytes=Math.max(maximumReadBufferBytes,part.value.buffer.byteLength);hash.update(part.value);controller.enqueue(part.value);
    }catch(error:unknown){await fail(error);}
  },async cancel():Promise<void>{await fail(materialFailure("material_request_invalid","google-download-canceled",409));}});
}
