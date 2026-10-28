import type { ReactElement } from "react";
import type { UsageDashboard } from "@/lib/dashboard/usage";

function dollars(micros: number): string { return `US$${(micros / 1_000_000).toFixed(6)}`; }
export function VisionCostSummary({ data }: Readonly<{ data: UsageDashboard }>): ReactElement {
  const funding = data.ai.funding;
  return <section aria-label="이번 판독의 비용과 승인 조건" className="alter-vision-cost">
    <h4>비용과 승인 조건</h4>
    <p className="alter-caption">저장된 원장 기준 · 실제 청구액과 별도</p>
    {funding?.probeLimitUsdMicros != null ? <><p>승인된 누적 검증 한도 {dollars(funding.probeLimitUsdMicros)} · 모든 시도 상한 누적 {dollars(data.ai.probeCommittedUsdMicros)} · 남은 상한 {dollars(Math.max(0, funding.probeLimitUsdMicros - data.ai.probeCommittedUsdMicros))}</p><p>기존 승인: 등록된 시험 입력만 허용. 이 화면에서 승인을 확대하지 않아요.</p></> : <p>현재 확인된 누적 검증 승인 한도 없음. 요청별 승인 범위와 예산을 서버에서 확인합니다.</p>}
    {funding?.pendingPayment && <p>원화 청구 미확정 · 월 예산 {(funding.pendingPayment.reservedKrwUnits / 1_000_000).toLocaleString("ko-KR")}원 예약 유지</p>}
    <p>이번 호출 예약액은 전송 전에 계산해요. 추가·자동 충전은 하지 않아요.</p><details><summary>승인 범위와 비용 계산 기준</summary><p>이 이미지의 자료·파일 페이지·내용이 기존 승인과 일치하는지는 실행 직전에 서버에서 확인합니다.</p><p>이번 호출의 개별 예약액은 아직 계산하지 않았어요. 서버가 토큰·이미지·재시도 상한을 계산하고 남은 예산을 넘으면 차단합니다. 실제 제공사 잔액·최종 청구액은 미확인이에요.</p></details>
    <a href="/learn#check-budget">사용량과 비용 상세</a>
  </section>;
}
