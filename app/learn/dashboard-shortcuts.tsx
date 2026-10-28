import type { ReactElement } from "react";
import { FileText, BookOpen, Check, Clock3, CircleCheck, ChevronRight, type LucideIcon } from "lucide-react";
import type { LearningDashboard, DashboardSession, DashboardReview } from "@/lib/dashboard/contracts";

type Shortcut = Readonly<{ title: string; description: string; href: string | null; icon: LucideIcon }>;

/** 서버의 인출 가림과 도래 상태를 유지하며 이동만 제공합니다. 생성·제출은 도착한 화면의 명시적 행동입니다. */
export function DashboardShortcuts({ data }: Readonly<{ data: LearningDashboard }>): ReactElement {
  const answer: DashboardSession | undefined = data.sessions.find((session): boolean => session.phase === "awaiting-answer");
  const review: DashboardReview | undefined = data.reviews.find((item): boolean => item.dueState === "today" || item.dueState === "overdue");
  const answerHref: string = answer === undefined ? "/learn/tutor" : `/learn/${answer.kind === "editor" ? "editor" : "tutor"}?id=${answer.id}#${answer.kind === "editor" ? "editor-answer-area" : "tutor-answer-area"}`;
  const concealed: boolean = data.visibility === "hidden-recall";
  const shortcuts: readonly Shortcut[] = [
    { title: "자료 원본 열기", description: concealed ? "인출 연습이 끝나면 원본을 열 수 있어요." : "보관함에서 자료를 선택해 원본 확인", href: concealed ? null : "/learn/materials", icon: FileText },
    { title: "답안 쓰기", description: answer === undefined ? "수업 화면에서 현재 회차와 학습 범위 확인" : "진행 중인 질문에 내 말로 답하기", href: answerHref, icon: BookOpen },
    { title: "답안 제출", description: answer === undefined ? "작성 중인 답안이 없어요. 먼저 답안 쓰기로 이동해 주세요." : "답안을 확인한 뒤 제출·저장 버튼을 눌러요.", href: answer === undefined ? null : answerHref, icon: Check },
    { title: "오늘 복습 시작", description: concealed ? "진행 중인 인출 답안을 먼저 마쳐 주세요." : review === undefined ? "지금 시작할 도래 복습이 없어요. 아래에서 일정을 확인해 주세요." : `${review.title} · ${review.dueState === "overdue" ? "기한 지남" : "오늘 가능"}`, href: concealed || review === undefined ? null : review.sessionId === null ? `/learn/tutor#review-${review.id}` : `/learn/tutor?id=${review.sessionId}#tutor-answer-area`, icon: Clock3 },
    { title: "확정 기록 찾기", description: concealed ? "인출 연습이 끝나면 확정 기록을 열 수 있어요." : "진도와 실제 수행 수준을 따로 확인", href: concealed ? null : "/learn/results", icon: CircleCheck },
  ];
  return <section className="dashboard-shortcuts" aria-label="학습 바로가기"><h3 className="alter-label">학습 바로가기</h3><ul>{shortcuts.map((item): ReactElement => {
    const Icon: LucideIcon = item.icon;
    const content: ReactElement = <><span className="dashboard-shortcut-icon"><Icon className="alter-icon" aria-hidden="true" /></span><span className="dashboard-shortcut-copy"><strong>{item.title}</strong><span>{item.description}</span></span>{item.href === null ? null : <ChevronRight className="alter-icon" aria-hidden="true" />}</>;
    return <li key={item.title}>{item.href === null ? <div className="dashboard-shortcut" data-unavailable="true">{content}</div> : <a className="dashboard-shortcut alter-focus" href={item.href}>{content}</a>}</li>;
  })}</ul></section>;
}
