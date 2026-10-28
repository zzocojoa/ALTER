import { createRoot } from "react-dom/client";
import { useDraftNavigation } from "../../lib/use-draft-navigation";
import { useState, type ReactElement } from "react";
import { PageHeader } from "../../components/alter/page-header";
import { SessionBoundary } from "../../components/alter/session-boundary";
import { ShellFrame } from "../../components/alter/shell-frame";
import { TextareaField } from "../../components/alter/fields";
import { ActionBar } from "../../components/alter/action-bar";
import { ActionButton } from "../../components/alter/action-button";
import "../../app/globals.css";
import "../../app/styles/tokens.css";
import "../../app/styles/foundation.css";
import "../../app/styles/components.css";
import "../../app/styles/shell.css";

function Fixture({ initialDraft }: Readonly<{ initialDraft: string }>): ReactElement {
  const [focused, setFocused] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [draft, setDraft] = useState<string>(initialDraft);
  const [submitted, setSubmitted] = useState<number>(0);
  useDraftNavigation({ dirty: draft !== initialDraft, busy, onError: setError, save: async (): Promise<boolean> => {
    const response: Response = await fetch("/__fixture/draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draft }) });
    if (!response.ok) { setError("모의 저장 실패 · 입력 유지"); return false; }
    return true;
  } });
  return <SessionBoundary><ShellFrame pathname={location.pathname}>
    <main id="learn-main" className="site-shell" tabIndex={-1}>
      <PageHeader title="탐색 검증" context="학습 · 합성 시험" back={{ href: "/learn", label: "오늘로" }} action={null} />
      <p>현재 경로: {location.pathname}{location.search}{location.hash}</p>
      <button type="button" className="alter-control" onClick={(): void => setFocused((value): boolean => !value)}>집중 화면 전환</button>
      <button type="button" className="alter-control" onClick={(): void => setBusy((value): boolean => !value)}>저장 대기 전환</button>
      {error === "" ? null : <p role="alert">{error}</p>}
      <form data-learning-focus={focused} className="alter-form" onSubmit={(event): void => { event.preventDefault(); setSubmitted((count): number => count + 1); }}>
        <TextareaField id="tutor-answer" label="나의 답안" hint="화면 폭이 바뀌어도 입력을 유지해요." error={null} input={{ value: draft, onChange: (event): void => setDraft(event.target.value) }} />
        <ActionBar label="답안 행동"><ActionButton id="submit" type="submit" tone="primary" availability={{ kind: "available" }}>답안 제출·저장</ActionButton></ActionBar>
      </form>
      <output aria-label="제출 횟수">{submitted}</output>
    </main>
  </ShellFrame></SessionBoundary>;
}
const target: HTMLElement | null = document.getElementById("fixture");
if (target === null) throw new TypeError("셸 검증의 마운트 지점이 없습니다.");
const initialDraft: string = target.dataset.draft ?? "";
createRoot(target).render(<Fixture initialDraft={initialDraft} />);
