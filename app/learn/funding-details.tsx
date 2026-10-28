import type { ReactElement } from "react";
import { StatusBadge } from "@/components/alter/status";
import type { UsageDashboard, FundingView } from "@/lib/dashboard/usage";
import { CheckTarget } from "./check-target";
import { formatUsageWon as won, formatUsageUsd as usd, formatUsageTime as when } from "./usage-format";
import "./usage.css";

type FundingDetailsProps = Readonly<{ funding: FundingView | null; probeCommitted: number; observedAt: number; restoration: UsageDashboard["restoration"] }>;
/** 결제 대사·예산 점유·시도 상한·과거 잔액은 각각 저장된 근거만 표시합니다. */
export function FundingDetails({ funding, probeCommitted, observedAt, restoration }: FundingDetailsProps): ReactElement {
  const current: boolean = funding !== null && funding.current && funding.checkedAt <= observedAt && observedAt < funding.validUntil;
  return <CheckTarget id="check-budget" instruction="② 아래에서 원화 청구 상태와 모든 시도 상한 누적 금액이 따로 보이는지 확인해 주세요.">
    <h4>결제와 검증 한도</h4>
    {funding === null ? <><StatusBadge label="결제·잔액 근거 미확인" tone="warning"/><p>결제·잔액 근거 미확인. 임의의 잔액을 부여하지 않아요. 미확인을 0원으로 계산하지 않아요.</p></> : <>
      <StatusBadge label={restoration !== null ? "복원한 과거 관측 · 현재 사용 권한 미확인" : current ? "저장된 관측의 확인 기간 내" : "관측 확인 기간 만료"} tone={restoration !== null || !current ? "warning" : "neutral"}/>
      <p>결제 관측 {when(funding.checkedAt)} · {current ? "확인 기간 내" : "확인 기간 만료"} · 자동 충전 꺼짐</p>
      <dl className="usage-metrics funding-metrics">
        <div data-funding-metric="reconciled"><dt>원화 대사된 추가 결제</dt><dd><strong className="usage-metric-value funding-value">{won(funding.paidKrwUnits)}</strong><p>카드 청구액까지 원화 대사를 마친 결제 합계예요. 미확정 결제가 없다는 뜻은 아니에요.</p></dd></div>
        <div data-funding-metric="pending"><dt>미확정 결제 예약</dt><dd><strong className="usage-metric-value funding-value">{funding.pendingPayment ? won(funding.pendingPayment.reservedKrwUnits) : "대기 결제 없음"}</strong><p>{funding.pendingPayment ? "원화 청구 미확정 · 최종 청구액이 확인될 때까지 예산을 확보해요." : "저장된 관측에 미확정 결제 예약이 없어요."}</p></dd></div>
        <div data-funding-metric="committed"><dt>미확정 결제 포함 예산 점유</dt><dd><strong className="usage-metric-value funding-value">{won(funding.committedKrwUnits)}</strong><p>원화 대사된 추가 결제와 미확정 예약을 반영한 점유예요.</p></dd></div>
        <div data-funding-metric="limit"><dt>승인된 누적 검증 상한</dt><dd><strong className="usage-metric-value funding-value">{funding.probeLimitUsdMicros === null ? "설정 근거 없음" : usd(funding.probeLimitUsdMicros)}</strong><p>실제 청구액이나 제공사 잔액과 별도의 실행 제한이에요.</p></dd></div>
        <div data-funding-metric="attempts"><dt>모든 시도 상한 누적</dt><dd><strong className="usage-metric-value funding-value">{usd(probeCommitted)}</strong><p>이 누적값은 실제 청구액과 다르며 실패·재시도도 반환하지 않아요. 추가 충전은 허용하지 않아요.</p></dd></div>
        <div data-funding-metric="credit"><dt>마지막으로 확인한 선불 크레딧</dt><dd><strong className="usage-metric-value funding-value">{funding.probeCreditSnapshotUsdMicros === null ? "미확인" : usd(funding.probeCreditSnapshotUsdMicros)}</strong><p>{when(funding.checkedAt)} 기준. 현재 잔액은 미확인이에요.</p></dd></div>
      </dl>
      {funding.pendingPayment && <p>결제 {usd(funding.pendingPayment.paidUsdMicros)} · 원화 청구 미확정. 대사 전 {won(funding.pendingPayment.reservedKrwUnits)}을 예약해요.</p>}
      <p>제공사 실시간 잔액·최종 청구 대사: 미확인. 확인된 크레딧을 현재 잔액으로 사용하지 않아요.</p>
      <p>관측 유효 종료 {when(funding.validUntil)} · 서울 시간</p>
      <a className="alter-link" href={funding.source} target="_blank" rel="noreferrer">결제 확인 출처</a>
    </>}
  </CheckTarget>;
}
