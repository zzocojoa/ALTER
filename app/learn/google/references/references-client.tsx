"use client";
import { useState,useSyncExternalStore } from "react";
import type { FormEvent,ReactElement } from "react";
import { z } from "zod";
import { clientReady,serverReady,subscribeToHydration } from "@/lib/client-ready";
import { materialMetadata } from "@/lib/materials/policy";
import { hashClientFile } from "@/lib/materials/client-file";
import { materialJson,requireMaterialResponse,transferReply } from "../../materials/client-api";

type ReferenceProps=Readonly<{files:readonly Readonly<{id:string;name:string;mimeType:string}>[];courses:readonly Readonly<{id:string;title:string}>[]}>;
export function GoogleReferencesClient({files,courses}:ReferenceProps):ReactElement {
  const ready=useSyncExternalStore(subscribeToHydration,clientReady,serverReady);const [busy,setBusy]=useState<boolean>(false);const [message,setMessage]=useState<string>("");
  const [download,setDownload]=useState<Readonly<{id:string;body:Blob;fileId:string;courseId:string}>|null>(null);
  async function submit(event:FormEvent<HTMLFormElement>):Promise<void> {
    event.preventDefault();setBusy(true);const data=new FormData(event.currentTarget);const fileId=z.string().min(1).parse(download?.fileId??data.get("fileId"));const courseId=z.string().uuid().parse(download?.courseId??data.get("courseId"));
    try {
      let current=download;
      if(current!==null && (current.fileId!==fileId || current.courseId!==courseId))throw new Error("받은 사본의 등록을 먼저 완료하거나 페이지를 새로 열어 주세요.");
      if(current===null){
        const id=crypto.randomUUID();setMessage("선택한 원본을 읽고 변경 여부를 확인하고 있어요…");
        const response=await fetch("/api/google/references/read",{method:"POST",cache:"no-store",headers:{"content-type":"application/json","idempotency-key":id},body:JSON.stringify({fileId})});await requireMaterialResponse(response);
        const body=await response.blob();current={id,body,fileId,courseId};setDownload(current);
      }
      setMessage("자료 저장 공간과 출처를 확인하고 있어요…");
      await materialJson("/api/materials/storage-check",{method:"POST"});
      const started=transferReply.extend({metadata:materialMetadata}).parse(await materialJson("/api/google/references/import",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({readId:current.id,courseId})}));
      if(started.state==="registered"){setMessage("이미 등록한 사본이에요. 자료 보관함에서 확인해 주세요.");return;}
      if(started.state!=="reserved")throw new Error("이 사본의 저장이 이미 시작됐어요. 자료 보관함의 중단된 자료에서 저장 결과를 확인해 주세요.");
      const file=new File([current.body],started.metadata.filename,{type:started.metadata.mime});
      if(file.size!==started.metadata.bytes || await hashClientFile(file)!==started.metadata.sha256)throw new Error("다운로드한 사본과 서버 검증 해시가 달라요. 등록을 중단했어요.");
      setMessage("원본 사본을 저장하고 파일 내용을 검증하고 있어요…");
      const stored=transferReply.parse(await materialJson(`/api/materials/uploads/${started.id}/body`,{method:"PUT",headers:{"content-type":started.metadata.mime,"x-upload-version":String(started.version)},body:file}));
      await materialJson(`/api/materials/uploads/${started.id}/complete`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({expectedVersion:stored.version})});setMessage("출처와 함께 등록했어요. 자료 보관함에서 원본과 선택 페이지를 확인해 주세요.");
    }catch(error:unknown){if(error instanceof Error)setMessage(error.message);else throw error;}finally{setBusy(false);}
  }
  return <section className="storage-check" inert={!ready}><h2>가져올 참고 자료</h2>{files.length===0?<p><a href="/learn/google">Google 연결에서 참고 자료를 먼저 선택해 주세요.</a></p>:courses.length===0?<p><a href="/learn/materials">자료 보관함에서 학습 공간을 먼저 만들어 주세요.</a></p>:<form onSubmit={event=>{void submit(event);}}><label>선택한 파일<select name="fileId" required disabled={busy||download!==null}><option value="">파일 선택</option>{files.map(file=><option key={file.id} value={file.id}>{file.name}</option>)}</select></label><label>학습 공간<select name="courseId" required disabled={busy||download!==null}><option value="">학습 공간 선택</option>{courses.map(course=><option key={course.id} value={course.id}>{course.title}</option>)}</select></label><button className="storage-check-button" type="submit" disabled={!ready||busy}>{busy?"가져오는 중…":download===null?"선택한 자료 가져오기":"받은 사본 등록 상태 확인"}</button></form>}{message&&<p role="status">{message}</p>}</section>;
}
