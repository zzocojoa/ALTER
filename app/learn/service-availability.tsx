import { aiRequestIssues } from "@/lib/ui/ai-availability";
import type { ReactElement } from "react";
import { featureAvailability, usageAvailability } from "@/lib/dashboard/availability";
import type { FeatureName, ServiceCondition } from "@/lib/dashboard/availability";
import type { UsageDashboard } from "@/lib/dashboard/usage";
const labels: Readonly<Record<FeatureName, string>> = { records: "확정한 학습 기록 읽기", answer: "직접 텍스트 답안 작성·저장", aiText: "AI 텍스트 학습", aiVision: "AI 사진 판독", upload: "자료·풀이 사진 등록", preview: "원본 미리보기", reportExport: "확정한 Docs·Sheets 보고서 내보내기", calendarExport: "확정한 학습·복습 일정 등록", referenceImport: "선택한 Google 참고 자료 가져오기" };
const states: Readonly<Record<ServiceCondition["state"], string>> = { ready: "관측 조건 확인", blocked: "제한 사유 있음", verify: "실행 시 확인 필요" };
export function ServiceAvailability({ data, observedAt }: Readonly<{ data: UsageDashboard; observedAt: number }>): ReactElement {
  const availability = usageAvailability(data, observedAt);
  return <section id="service-availability" aria-label="기능별 사용 조건"><h3>기능별 사용 조건</h3><p>AI 예산과 Google 연결은 독립적으로 확인해요. AI 한도에 도달해도 조건이 허용하는 기존 확정 보고서 내보내기는 유지돼요. 주간 확정 후 별도의 승인 단계는 없어요.</p><p>아래 표시는 저장된 관측 기준이에요. 실제 실행·저장 결과를 뜻하지 않으며 모델·제공사·권한을 자동 변경하지 않아요.</p>{featureAvailability(availability).map(item => item.feature === "aiText" || item.feature === "aiVision" ? <section key={item.feature} aria-label={labels[item.feature]}><h4>{labels[item.feature]} · {states[item.state]}</h4>{aiRequestIssues(data,item.feature === "aiVision" ? ["text","image","structured-output","usage","output-limit"] : ["text","structured-output","usage","output-limit"],observedAt).map((reason):ReactElement => <p key={reason}>{reason}</p>)}<p>요청별 전송 동의·승인 범위·현재 비용 상한은 실행 전에 별도로 확인해요. 기존 결과 조회는 새 생성과 구별해요.</p></section> : <details key={item.feature}><summary>{labels[item.feature]} · {states[item.state]}</summary>{item.reasons.length > 0 ? item.reasons.map(reason => <p key={reason.service}>{reason.reason}</p>) : <p>읽을 때 소유자 인증과 최신 기록을 다시 확인해요.</p>}</details>)}<p>코드 배포 버전 복귀: 현재 관측 없음 · 데이터 복원: {availability.dataRestore === "verified" ? "검증 후 학습 활성화" : availability.dataRestore === "incomplete" ? "미완료·학습 격리" : "현재 관측 없음"}. 코드 버전을 되돌려도 데이터가 복원되는 것은 아니에요.</p></section>;
}
export function ServiceFailureHelp(): ReactElement {
  return <p>저장 실패·결과 불명은 완료가 아니에요. 입력을 유지하고 같은 요청의 결과를 확인해 주세요. AI·Google·파일 장애가 다른 기능도 중단시켰다는 뜻은 아니에요. <a href="/learn#service-availability">기능별 사용 조건 확인</a></p>;
}
