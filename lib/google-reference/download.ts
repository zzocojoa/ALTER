import type { SiteIdentity } from "../domain/contracts.ts";
import type { GoogleExecutionRuntime,GoogleExecutionSettings } from "../google/execute.ts";
import { beginGoogleReferenceRead,finishGoogleReferenceRead,failGoogleReferenceRead,readGoogleReferenceRead } from "../../db/repositories/google-references.ts";
import { readGoogleReference } from "./read.ts";
import type { GoogleReferenceProof } from "./contract.ts";

/** 본문 전송 중단도 출처 원장에 남기되 이미 검증된 읽기 증거를 실패로 되돌리지 않습니다. */
export async function downloadGoogleReference(db:D1Database,owner:SiteIdentity,settings:GoogleExecutionSettings,id:string,fileId:string,runtime:GoogleExecutionRuntime):Promise<Readonly<{body:ReadableStream<Uint8Array>;mime:GoogleReferenceProof["mime"]}>> {
  await beginGoogleReferenceRead(db,owner,id,fileId,runtime.rest.now());
  const failed=async():Promise<void>=>{const read=await readGoogleReferenceRead(db,owner,id);if(read.state==="reading")await failGoogleReferenceRead(db,owner,id,runtime.rest.now());};
  try {
    const result=await readGoogleReference(db,owner,settings,fileId,runtime,proof=>finishGoogleReferenceRead(db,owner,id,proof,runtime.rest.now()));
    const reader=result.body.getReader();
    return {mime:result.mime,body:new ReadableStream<Uint8Array>({async pull(controller):Promise<void>{
      try{const part=await reader.read();if(part.done){reader.releaseLock();controller.close();}else controller.enqueue(part.value);}
      catch(error:unknown){await failed();reader.releaseLock();controller.error(error);}
    },async cancel(reason:unknown):Promise<void>{try{await reader.cancel(reason);}finally{reader.releaseLock();await failed();}}})};
  }catch(error:unknown){await failed();throw error;}
}
