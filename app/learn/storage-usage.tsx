import type { ReactElement } from "react";
import { StatusBadge } from "@/components/alter/status";
import type { UsageDashboard } from "@/lib/dashboard/usage";
import { formatUsageTime as when, formatUsageMiB as mib } from "./usage-format";
import "./usage.css";

/** 저장된 사용량과 유효기간만 보여 주며 조회로 파일·예약·용량 판정을 바꾸지 않습니다. */
export function StorageUsage({ material, observedAt }: Readonly<{ material: UsageDashboard["platform"]["material"]; observedAt: number }>): ReactElement {
  const expired: boolean = material !== null && (material.checkedAt > observedAt || material.validUntil <= observedAt);
  const full: boolean = material !== null && material.occupiedBytes + material.reservedBytes >= material.limitBytes;
  return <section className="storage-usage" aria-label="사이트와 저장 공간"><h3>사이트와 저장 공간</h3>
    <p>D1: 이번 원장 읽기 성공. 제공사 잔여 용량·쓰기 가능 여부는 이 조회로 확인하지 않았어요.</p>
    {material === null ? <><StatusBadge label="원본 저장소 상태 미확인" tone="warning"/><p>ALTER 원본 사용량·저장소 검증 미확인. 자료 보관함에서 저장 공간을 확인해 주세요.</p></> : <>
      <StatusBadge label={expired ? "저장소 관측 만료 · 재확인 필요" : material.blocked ? "등록 제한 · 재확인 필요" : full ? "사용량·예약이 앱 한도에 도달" : "저장된 검증 기간 내"} tone={expired || material.blocked || full ? "warning" : "neutral"}/>
      <dl className="usage-metrics storage-metrics">
        <div data-storage-metric="used"><dt>원본 사용량</dt><dd><strong className="usage-metric-value">{mib(material.occupiedBytes)}</strong><p>등록된 원본과 이미 확인한 기타 원본을 포함해요.</p></dd></div>
        <div data-storage-metric="reserved"><dt>업로드 예약</dt><dd><strong className="usage-metric-value">{mib(material.reservedBytes)}</strong><p>중단·실패·결과 불명도 최종 확인 전에는 유지해요.</p></dd></div>
        <div data-storage-metric="limit"><dt>ALTER 앱 저장 한도</dt><dd><strong className="usage-metric-value">{mib(material.limitBytes)}</strong><p>계정 전체의 제공사 잔여 용량과 별도예요.</p></dd></div>
        <div data-storage-metric="pending"><dt>확인이 필요한 등록</dt><dd><strong className="usage-metric-value">{material.activeTransfers}개</strong><p>전송 중·미확정·정리 대기를 포함하며 등록 완료 수가 아니에요.</p></dd></div>
      </dl>
      <p>원본 사용량 중 등록 목록 밖 원본 {mib(material.untrackedBytes)} · 위 사용량에 포함되어 있어 다시 더하지 않아요.</p>
      <p>마지막 실측 <time dateTime={new Date(material.checkedAt).toISOString()}>{when(material.checkedAt)}</time> · 유효 종료 {when(material.validUntil)} · 서울 시간</p>
      {material.activeTransfers > 0 && <p><a className="alter-link" href="/learn/materials">자료 보관함에서 중단된 자료 확인</a> · ‘확인이 필요한 자료’에서 같은 요청의 상태를 확인하고 이어서 등록해 주세요.</p>}
      {full && <p>추가 등록을 완료할 수 있다고 보장하지 않아요. 중단된 요청과 실제 저장 상태를 먼저 확인해 주세요. 이 조회는 원본이나 예약을 정리하지 않아요.</p>}
    </>}
    <p>계정 전체 R2 잔여 용량, D1·Sites 제공사 한도는 미확인이에요. 앱의 256MiB 제한과 구분해요.</p>
    <a className="alter-link" href="/learn/materials">자료 보관함과 저장 공간 확인</a>
  </section>;
}
