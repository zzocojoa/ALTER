import { z } from "zod";
import { validateMaterialMetadata } from "@/lib/materials/policy";
import { hashClientFile } from "@/lib/materials/client-file";
import { materialJson,transferReply,recoveryReply } from "../materials/client-api";
export const tutorPhotoIntent=z.object({key:z.string().uuid(),hash:z.string().regex(/^[a-f0-9]{64}$/),uploadId:z.string().uuid().nullable()}).strict();
export type TutorPhotoProgress=(message:string)=>void;
export type TutorPhotoIntent=Readonly<z.infer<typeof tutorPhotoIntent>>;
type PhotoTransfer = Readonly<z.infer<typeof transferReply>>;
/** 같은 예약의 응답만 사용하고 다른 자료의 성공을 첨부 완료로 처리하지 않습니다. */
function requirePhotoTransfer(value: unknown, expected: PhotoTransfer): PhotoTransfer {
  const actual = transferReply.parse(value);
  if (actual.id !== expected.id || actual.materialId !== expected.materialId || actual.version < expected.version) throw Object.assign(new Error(`사진 등록 응답이 예약과 일치하지 않아요. 원래 사진으로 결과를 확인해 주세요. 예약 ${expected.id}・${expected.version} → 응답 ${actual.id}・${actual.version} (${actual.state})`), { name: "TutorPhotoConfirmationError" });
  return actual;
}
function requireRegisteredPhoto(transfer: PhotoTransfer): string {
  if (transfer.state !== "registered") throw Object.assign(new Error(`사진은 등록 확인 대기 중이에요. 같은 사진을 다시 선택해 확인해 주세요. 예약 ${transfer.id}· 상태 ${transfer.state}`), { name: "TutorPhotoConfirmationError" });
  return transfer.materialId;
}
export function readTutorPhotoIntent(sessionId:string):TutorPhotoIntent|null {const saved=sessionStorage.getItem(`alter.tutor.photo.${sessionId}`);return saved===null ? null : tutorPhotoIntent.parse(JSON.parse(saved));}
export function rememberTutorPhotoIntent(sessionId:string,value:TutorPhotoIntent):void {sessionStorage.setItem(`alter.tutor.photo.${sessionId}`,JSON.stringify(tutorPhotoIntent.parse(value)));}
export function clearTutorPhotoIntent(sessionId:string):void {sessionStorage.removeItem(`alter.tutor.photo.${sessionId}`);}
/** 같은 파일의 재시도는 원래 예약과 전송 상태부터 확인합니다. */
export async function uploadTutorPhoto(file:File,courseId:string,intent:TutorPhotoIntent|null,remember:(value:TutorPhotoIntent)=>void,progress:TutorPhotoProgress):Promise<string> {
  progress("사진 형식과 크기를 확인하고 있어요.");
  const suffix=file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if(![".png",".jpg",".jpeg"].includes(suffix)) throw new Error("풀이 사진은 PNG·JPG로 선택해 주세요. HEIC는 지원하지 않아요.");
  const declared={title:`풀이 사진 · ${file.name}`,edition:"",role:"answer",kind:"image",filename:file.name,mime:suffix===".png" ? "image/png" : "image/jpeg",bytes:file.size,sha256:"0".repeat(64)};
  validateMaterialMetadata(declared);progress("사진의 동일 파일 여부를 확인하고 있어요.");const hash=await hashClientFile(file);const metadata=validateMaterialMetadata({...declared,sha256:hash});
  if(intent && intent.hash!==hash) throw new Error("진행 중인 사진의 결과를 먼저 확인해 주세요. 처음 선택한 파일로 다시 시도할 수 있어요.");
  let current:TutorPhotoIntent=intent ?? {key:crypto.randomUUID(),hash,uploadId:null};remember(current);
  progress("저장 공간 예약과 이전 전송 상태를 확인하고 있어요.");
  const started=transferReply.parse(await materialJson("/api/materials/uploads",{method:"POST",headers:{"content-type":"application/json","idempotency-key":current.key},body:JSON.stringify({courseId,metadata})}));
  if(current.uploadId!==null && current.uploadId!==started.id) throw new Error("사진 예약이 이전 전송과 달라요. 기존 예약 결과를 먼저 확인해 주세요.");
  current={...current,uploadId:started.id};remember(current);
  let transfer=requirePhotoTransfer(await materialJson(`/api/materials/uploads/${started.id}`,{method:"GET"}),started);
  if(transfer.state==="registered") {progress("이미 등록된 사진을 확인했어요.");return transfer.materialId;}
  if(transfer.state==="reserved") {progress("사진 원본을 전송하고 있어요. 완료 전에는 이 화면을 유지해 주세요.");transfer=requirePhotoTransfer(await materialJson(`/api/materials/uploads/${transfer.id}/body`,{method:"PUT",headers:{"content-type":metadata.mime,"x-upload-version":String(transfer.version)},body:file}),transfer);}
  if(transfer.state==="stored" || transfer.state==="verified") {progress("서버에서 원본 무결성을 검증하고 등록하고 있어요.");return requireRegisteredPhoto(requirePhotoTransfer(await materialJson(`/api/materials/uploads/${transfer.id}/complete`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({expectedVersion:transfer.version})}),transfer));}
  progress("중단된 전송의 실제 저장 결과를 확인하고 있어요.");
  const recovered=recoveryReply.parse(await materialJson(`/api/materials/uploads/${transfer.id}/recover`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({expectedVersion:transfer.version})}));
  requirePhotoTransfer(recovered,transfer);
  if(recovered.nextAction==="registered") return requireRegisteredPhoto(recovered);
  throw new Error("사진 전송 결과를 확인했지만 등록이 완료되지 않았어요. 자료 보관함의 ‘상태 확인·이어서 등록’에서 이 사진을 확인해 주세요.");
}
