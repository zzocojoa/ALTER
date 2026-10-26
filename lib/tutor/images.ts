import { Buffer } from "node:buffer";
import { domainFailure,recordId } from "../domain/contracts.ts";
import type { SiteIdentity } from "../domain/contracts.ts";
import type { TutorState } from "./contracts.ts";
import type { InputImage } from "../ai/request-bound.ts";
import { getRegisteredMaterial } from "../materials/download.ts";
import { readMaterialObject,headMaterialObject } from "../materials/object.ts";
import { validatePngContent } from "../materials/png-content.ts";
import { validateJpegContent } from "../materials/jpeg-content.ts";
import { hashFile } from "../learning-upload.ts";

/** 사진 원본은 보존하며 전송 상한을 넘으면 판독만 중단합니다. */
export async function readTutorAnswerImages(db:D1Database,bucket:R2Bucket,owner:SiteIdentity,state:TutorState,jpeg:WebAssembly.Module,signal:AbortSignal):Promise<readonly InputImage[]> {
  const answer=state.answers.find((item):boolean=>item.id===state.currentAnswerId);
  if(!answer || state.pending?.kind==="tutor-lesson") return [];
  const images:InputImage[]=[];
  for(const id of answer.fileIds) {
    const transfer=await getRegisteredMaterial(db,owner,id);
    if(transfer.courseId!==state.start.bundle.unit.courseId || transfer.metadata.kind!=="image" || transfer.metadata.role!=="answer") throw domainFailure("reference_conflict","tutor.answer-image-owner",null);
    if(transfer.metadata.bytes>2097152 || images.reduce((sum,item):number=>sum+item.bytes,0)+transfer.metadata.bytes>4194304) throw domainFailure("limit_exceeded","tutor.ai-photo-2MiB-each-4MiB-total-original-retained",null);
    const object=await readMaterialObject(bucket,transfer);
    const proof=transfer.metadata.mime==="image/png" ? await validatePngContent(object.body,transfer.metadata,signal) : await validateJpegContent(object.body,transfer.metadata,signal,jpeg);
    if(proof.image.width>8192 || proof.image.height>8192) throw domainFailure("limit_exceeded","tutor.ai-photo-dimensions",null);
    const bytes=await (await readMaterialObject(bucket,transfer)).arrayBuffer();
    if(bytes.byteLength!==transfer.metadata.bytes || await hashFile(bytes)!==transfer.metadata.sha256) throw domainFailure("reference_conflict","tutor.answer-image-hash",null);
    await headMaterialObject(bucket,transfer);
    images.push({type:"input_image",sourceRefId:recordId.parse(id),dataUrl:`data:${transfer.metadata.mime};base64,${Buffer.from(bytes).toString("base64")}`,width:proof.image.width,height:proof.image.height,bytes:bytes.byteLength,detail:"high"});
  }
  return images;
}
