import { z } from "zod";
import { readBoundedJson } from "../materials/request";
import { backupPolicy } from "./contracts";
import { privateJson } from "../owner-access";
import { materialErrorResponse } from "../materials/server-access";
import type { BackupFailure } from "./contracts";

export function backupErrorResponse(error: unknown): Response {
  if (error instanceof z.ZodError) return privateJson({ error: "backup_request_invalid", field: error.issues[0].path.join("."), message: "백업 요청의 식별자와 페이지 번호를 확인해 주세요." }, 400);
  if (error instanceof Error && error.name === "BackupFailure" && "code" in error && "location" in error) {
    const failure = error as BackupFailure;
    return privateJson({ error: failure.code, location: failure.location, message: failure.code === "unsettled-upload" ? "아직 완료 또는 삭제가 확인되지 않은 업로드가 있어요. 자료 보관함에서 해당 전송 상태를 확인한 뒤 백업해 주세요." : failure.code === "incomplete-download" ? "끝까지 받았는지 확인되지 않은 파일이 있어요. 파일 수신을 마친 뒤 완료해 주세요." : failure.code === "learning-active" ? "백업에는 교재와 정답도 포함돼요. 진행 중인 답안을 제출한 뒤 백업을 시작해 주세요." : failure.code === "export-conflict" ? "백업 기준이나 진행 상태가 달라졌어요. 부분 파일은 완료된 백업이 아니며 새 백업을 시작해야 해요." : failure.message }, failure.code === "missing-export" ? 404 : 409);
  }
  return materialErrorResponse(error);
}


const downloadReceipt = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive().max(backupPolicy.maximumObjectBytes) }).strict();
export async function readBackupAcknowledgement(request: Request): Promise<Readonly<z.infer<typeof downloadReceipt>>> { return downloadReceipt.parse(await readBoundedJson(request, 1024)); }
export function backupOrdinal(value: string): number { return Number(z.string().regex(/^(0|[1-9][0-9]{0,3})$/).parse(value)); }
