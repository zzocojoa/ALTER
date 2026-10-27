"use client";

import type { ReactElement } from "react";
import { ActionButton } from "@/components/alter/action-button";
import { StatusBadge } from "@/components/alter/status";
import type { PendingMaterial } from "@/lib/materials/library";

const stages: Readonly<Record<PendingMaterial["state"], string>> = { reserved: "예약됨 · 원본 전송 대기", transferring: "전송 중 · 결과 미확정", stored: "원본 저장됨 · 등록 미확정", validating: "원본 검증 중 · 등록 미확정", verified: "원본 검증됨 · 등록 미확정", registered: "등록 확인됨", unknown: "저장 결과 미확정", failed: "중단·실패 확인 필요", cleaning: "임시 자료 정리 결과 미확정", discarded: "정리 확인됨" };

type PendingMaterialsProps = Readonly<{ items: readonly PendingMaterial[]; busy: boolean; onRecover: (item: PendingMaterial) => Promise<void>; onCleanup: (item: PendingMaterial) => Promise<void> }>;

export function PendingMaterials({ items, busy, onRecover, onCleanup }: PendingMaterialsProps): ReactElement {
  return <section className="alter-pending-materials" aria-label="중단된 자료"><h3>확인이 필요한 자료</h3><p>아직 등록이 완료되지 않았어요. 새로 등록하기 전에 같은 요청을 확인해 주세요.</p>{items.map((item): ReactElement => <article key={item.id}>
    <h4>{item.metadata.title}</h4><p className="alter-caption">{item.metadata.filename} · {(item.metadata.bytes / 1048576).toFixed(2)} MiB · 요청 {item.id.slice(-8)} · 기록 {item.version}판</p>
    <StatusBadge label={stages[item.state]} tone="warning" />
    <p className="alter-caption">원본과 예약은 서버에서 확인할 때까지 유지해요. 전송을 이어가려면 ‘새 자료 등록’에서 처음 선택한 원본을 다시 고르세요.</p>
    <ActionButton id={`material-recover-${item.id}`} type="button" tone="primary" availability={busy ? { kind: "busy", reason: "현재 요청을 확인하고 있어요." } : { kind: "available" }} onClick={(): void => { void onRecover(item); }}>상태 확인·이어서 등록</ActionButton>
    <details className="alter-pending-cleanup"><summary className="alter-focus">이 임시 자료를 그만 등록하려면</summary><p>이 요청의 임시 원본과 예약을 정리해요. 등록이 끝난 원본은 정리하지 않아요. 정리 실패·미확정이면 예약도 유지돼요.</p><ActionButton id={`material-cleanup-${item.id}`} type="button" tone="danger" availability={busy ? { kind: "busy", reason: "현재 요청을 확인하고 있어요." } : { kind: "available" }} onClick={(): void => { void onCleanup(item); }}>이 임시 자료 정리</ActionButton></details>
  </article>)}</section>;
}
