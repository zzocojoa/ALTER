import type { SiteIdentity } from "../domain/contracts.ts";
import { advanceMaterialTransfer, getMaterialTransfer } from "../../db/repositories/material-transfers.ts";
import type { StoredTransfer } from "../../db/repositories/material-transfers.ts";
import type { TransferEvent } from "./transfer-state.ts";

/** 실행별 요청 키와 관측한 상태 버전으로 전이하며 결과를 다시 읽습니다. */
export async function transitionMaterialTransfer(db: D1Database, owner: SiteIdentity, current: StoredTransfer, event: TransferEvent, dispatchId: string): Promise<StoredTransfer> {
  await advanceMaterialTransfer(db, { owner, requestKey: `${dispatchId}:${event.type}`, expectedVersion: current.version }, current.id, event, Date.now());
  return getMaterialTransfer(db, owner, current.id);
}
