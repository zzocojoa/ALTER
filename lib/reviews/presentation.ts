import { calendarDate } from "./calendar";
import { tutorActivePhase } from "../tutor/contracts";
import type { ReviewOverview, SavedReviewPlan } from "./view";

export type ReviewGroup = Readonly<{ state: SavedReviewPlan["dueState"]; label: string; description: string; plans: readonly SavedReviewPlan[] }>;
const groups: readonly Omit<ReviewGroup, "plans">[] = [
  { state: "today", label: "오늘", description: "서울 기준 오늘로 수락한 복습이에요." },
  { state: "overdue", label: "기한 지남", description: "예정일이 지났지만 제출 결과를 확정하지 않았어요." },
  { state: "recheck", label: "재확인", description: "정정된 근거로 다시 확인해야 해요. 수락 여부와 시작 날짜는 각각 확인해 주세요." },
  { state: "proposed", label: "미수락", description: "조건과 날짜를 확인하고 직접 수락해야 시작할 수 있어요." },
  { state: "future", label: "예정", description: "수락한 날짜가 아직 오지 않았어요." },
  { state: "complete", label: "완료", description: "이 일정의 제출 결과가 확정됐어요. 다음 제안과 수행 수준은 별도로 확인해요." },
];
/** 서버의 분류를 그대로 사용하므로 날짜·정정 조건이 겹쳐도 항목을 중복 배치하지 않습니다. */
export function groupReviewPlans(plans: readonly SavedReviewPlan[]): readonly ReviewGroup[] {
  return groups.map((group): ReviewGroup => ({ ...group, plans: plans.filter((plan): boolean => plan.dueState === group.state) }));
}

export type ReviewStartState = Readonly<{ kind: "start" | "blocked"; reason: string }> | Readonly<{ kind: "resume" | "result"; reason: string; href: string }>;
/** 서버 날짜와 저장된 수락·회차 정보만 해석하며 실제 시작 허가는 기존 서버 명령이 다시 확인합니다. */
export function reviewStartState(plan: SavedReviewPlan, today: string): ReviewStartState {
  if (!calendarDate.safeParse(today).success) return { kind: "blocked", reason: "서버의 서울 날짜를 확인하지 못했어요. 복습 목록을 다시 읽어 주세요." };
  if (plan.dueState === "complete") return { kind: "blocked", reason: "이번 복습은 제출 결과가 확정되었어요. 다음 복습 일정을 확인해 주세요." };
  if (plan.sessionId !== null) {
    if (plan.sessionPhase === "finished") return { kind: "result", href: `/learn/results?id=${plan.sessionId}`, reason: "이미 종료한 회차예요. 새 회차를 만들지 않고 저장된 답안의 결과·확정 상태를 확인해 주세요." };
    if (plan.sessionPhase !== "paused" && !tutorActivePhase.safeParse(plan.sessionPhase).success) return { kind: "blocked", reason: "연결된 복습 회차의 상태를 확인하지 못했어요. 복습 목록을 다시 읽어 주세요." };
    return { kind: "resume", href: `/learn/tutor?id=${plan.sessionId}#tutor-answer-area`, reason: "시작한 복습이 있어요. 아래 버튼으로 저장한 회차를 이어가세요." };
  }
  if (plan.decision.status === "proposed") return { kind: "blocked", reason: "아직 복습 날짜를 수락하지 않았어요. 아래 ‘복습 날짜·조건 설정’에서 날짜와 이유를 확인하고 수락해 주세요." };
  if (plan.decision.dueDate > today) return { kind: "blocked", reason: `${plan.decision.dueDate}부터 시작할 수 있어요. 오늘은 ${today}(서울 기준)이므로 아직 답안 입력칸이 열리지 않아요. 예정일에 이 화면을 새로고침해 주세요.` };
  return { kind: "start", reason: "복습할 시간이 되었어요. 아래 버튼을 누르면 답안을 작성하는 화면으로 이동해요." };
}

/** 응답 지연이 수락·정정 버전을 되돌리지 못하게 기존 목록의 저장 버전을 대조합니다. */
export function requireReviewResponse(previous: ReviewOverview, next: ReviewOverview): void {
  for (const before of previous.plans) {
    const after = next.plans.find((plan): boolean => plan.id === before.id);
    if (!after || after.version < before.version || after.reviewVersion < before.reviewVersion || after.errorVersion < before.errorVersion) throw new Error("이전 버전의 복습 목록은 적용하지 않았어요. 최신 상태를 다시 확인해 주세요.");
  }
}
