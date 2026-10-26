"use client";
import type { ReactElement } from "react";
import type { LearningDashboard } from "@/lib/dashboard/contracts";
import { useLocationFragment } from "@/lib/use-location-fragment";
import { CheckTarget } from "./check-target";
import "./navigation-check.css";

/** 저장된 회차·복습의 이동 대상만 보여 주며 조회·생성·수락 요청은 보내지 않습니다. */
export function NavigationCheck({ data }: Readonly<{ data: LearningDashboard }>): ReactElement | null {
  const fragment: string = useLocationFragment();
  if (fragment !== "#check-navigation") return null;
  return <CheckTarget id="check-navigation" instruction="아래 번호 버튼을 하나씩 눌러 확인해 주세요."><div className="navigation-check">
    <h2>휴대폰 화면 확인</h2><p>입력과 제출은 끝났어요. 이제 저장한 기록이 열리는지만 확인해요.</p>
    <section className="navigation-check-card"><span className="navigation-check-number" aria-hidden="true">1</span><div><h3>저장한 초안 이어가기</h3><p>제출한 문장이 보이는지 확인해요.</p>{data.sessions.length === 0 && <p>진행 중인 회차가 없어요. 최신 현황을 다시 읽어 주세요.</p>}{data.sessions.map(session => <a key={session.id} className="navigation-check-action" href={`/learn/${session.kind === "editor" ? "editor" : "tutor"}?id=${session.id}${session.kind === "editor" ? "#check-editor-saved" : ""}`}><span>① {session.kind === "editor" ? "저장한 초안" : "저장한 회차"} 열기</span><span aria-hidden="true">→</span><small>{session.title}</small></a>)}</div></section>
    <section className="navigation-check-card"><span className="navigation-check-number" aria-hidden="true">2</span><div><h3>복습 화면 펼쳐 보기</h3><p>복습 내용이 열리고 다시 접히는지 확인해요.</p>{data.visibility === "hidden-recall" ? <p>인출 답안을 작성하는 동안 복습 내용은 가려요.</p> : <>{data.reviews.length === 0 && <p>확인할 복습이 없어요.</p>}{data.reviews.map(review => <a key={review.id} className="navigation-check-action" href={`/learn/tutor#check-review-${review.id}`}><span>② 복습 화면 열기</span><span aria-hidden="true">→</span><small>{review.title}</small></a>)}</>}</div></section>
    <p>날짜 변경이나 AI 생성은 필요하지 않아요.</p>
  </div></CheckTarget>;
}
