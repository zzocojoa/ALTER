import { useRef, useState, type ReactElement, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { ActionBar } from "../../components/alter/action-bar";
import { ActionButton, type ActionAvailability } from "../../components/alter/action-button";
import { TextField, TextareaField, FileField } from "../../components/alter/fields";
import { ManualTabs, RetainedTabPanel, SelectedTabPanel } from "../../components/alter/tabs";
import { Disclosure } from "../../components/alter/disclosure";
import { SegmentedControl } from "../../components/alter/segmented-control";
import { LearningDialog } from "../../components/alter/dialog";
import { SaveStatus, StatusBadge, EmptyState, ErrorState, LoadingState } from "../../components/alter/status";
import "../../app/globals.css";
import "../../app/styles/tokens.css";
import "../../app/styles/foundation.css";
import "../../app/styles/components.css";
import "../../app/learn/tutor/tutor.css";

function Fixture(): ReactElement {
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [dialogDraft, setDialogDraft] = useState<string>("");
  const [tab, setTab] = useState<string>("draft");
  const [disclosed, setDisclosed] = useState<boolean>(false);
  const [segment, setSegment] = useState<string>("all");
  const [answer, setAnswer] = useState<string>("");
  const [label, setLabel] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [submits, setSubmits] = useState<number>(0);
  const [aiCalls, setAiCalls] = useState<number>(0);
  const inFlight = useRef<boolean>(false);
  const availability: ActionAvailability = busy ? { kind: "busy", reason: "저장 결과를 확인하고 있어요." } : answer.trim().length === 0 ? { kind: "blocked", reason: "답안을 작성하면 제출할 수 있어요." } : { kind: "available" };
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (inFlight.current || answer.trim().length === 0) return;
    inFlight.current = true;
    setBusy(true);
    setSubmits((count): number => count + 1);
  }
  return <main data-alter-ui className="alter-view" style={{ padding: "var(--alter-space-4)" }}>
    <h1 className="alter-heading">공통 입력 검증</h1>
    <section className="tutor-panel">
      <form className="alter-form" onSubmit={submit}>
        <TextField id="label" label="자료 이름" type="text" hint="학습할 자료의 이름입니다." error={null} input={{ value: label, onChange: (event): void => setLabel(event.target.value), autoComplete: "off" }} />
        <TextareaField id="answer" label="나의 답안" hint="내 말로 설명해 주세요. Enter는 줄바꿈이에요." error={error} input={{ value: answer, onChange: (event): void => setAnswer(event.target.value), rows: 5 }} />
        <FileField id="file" label="풀이 사진" hint="이 검증은 파일 이름만 확인해요." error={null} input={{ accept: "image/png,image/jpeg", onChange: (event): void => setFileName(event.target.files?.[0]?.name ?? "") }} />
        <p aria-label="선택한 파일">{fileName || "선택한 파일 없음"}</p>
        <ActionBar label="답안 저장과 별도 요청">
        <ActionButton id="submit" type="submit" tone="primary" availability={availability}>답안 제출·저장</ActionButton>
        <ActionButton id="ai" type="button" tone="secondary" availability={{ kind: "available" }} onClick={(): void => setAiCalls((count): number => count + 1)}>별도 AI 동작</ActionButton>
        </ActionBar>
      </form>
      <button type="button" className="alter-control" onClick={(): void => setError("설명과 예시를 함께 작성해 주세요.")}>오류 표시</button>
      <button type="button" className="alter-control" onClick={(): void => { inFlight.current = false; setBusy(false); }}>모의 저장 확인</button>
      <output aria-label="제출 횟수">{submits}</output><output aria-label="AI 횟수">{aiCalls}</output>
    </section>
    <ManualTabs value={tab} onValueChange={setTab} label="자료와 답안" choices={[{ value: "draft", label: "초안", unavailableReason: null }, { value: "source", label: "원본", unavailableReason: null }, { value: "future", label: "추가 자료", unavailableReason: "등록 후 열 수 있어요." }]}>
      <RetainedTabPanel value="draft" selectedValue={tab}><label>탭 안의 초안<input className="alter-control" defaultValue="보존할 초안" /></label></RetainedTabPanel>
      <SelectedTabPanel value="source"><p>합성 원본</p><button className="alter-control" type="button">원본 확대</button></SelectedTabPanel>
    </ManualTabs>
    <Disclosure title="저장 안내" open={disclosed} onOpenChange={setDisclosed}><p>확인한 응답으로만 저장을 표시해요.</p><a className="alter-link" href="#answer">답안으로</a></Disclosure>
    <SegmentedControl legend="기록 표시" value={segment} onValueChange={setSegment} choices={[{ value: "all", label: "전체", unavailableReason: null }, { value: "confirmed", label: "확정", unavailableReason: null }, { value: "none", label: "외부 기록", unavailableReason: "연결 후 확인해요." }]} />
    <section aria-label="저장 상태 사례">
      <SaveStatus id="save-unknown" state={{ kind: "unknown", detail: "입력을 유지하고 같은 요청의 결과를 확인해 주세요." }} />
      <SaveStatus id="save-draft" state={{ kind: "saved", version: 3 }} />
      <SaveStatus id="save-submitted" state={{ kind: "submitted", version: 4 }} />
      <StatusBadge label="원화 청구 미확정" tone="warning" />
      <EmptyState title="아직 자료가 없어요" detail="학습할 자료를 등록하면 여기서 열 수 있어요." action={<a href="#file" className="alter-link">자료 선택으로</a>} />
      <ErrorState title="자료를 읽지 못했어요" detail="현재 입력은 유지하고 있어요. 연결을 확인한 뒤 다시 읽어 주세요." action={<button className="alter-control" type="button">현재 결과 다시 확인</button>} />
      <LoadingState label="저장된 기록을 읽고 있어요" />
    </section>
    <LearningDialog open={dialogOpen} onOpenChange={setDialogOpen} title="자료 확인" closeLabel="닫기" description="화면 검증용 대화상자입니다." trigger={<button type="button" className="alter-control" id="dialog-trigger">자료 확인 열기</button>}>
      <TextareaField id="dialog-answer" label="대화상자 초안" hint="닫아도 이 검증 화면의 입력은 유지돼요." error={null} input={{ value: dialogDraft, onChange: (event): void => setDialogDraft(event.target.value) }} />
      <ActionButton id="dialog-done" type="button" availability={{ kind: "available" }} tone="primary" onClick={(): void => setDialogOpen(false)}>확인하고 닫기</ActionButton>
    </LearningDialog>
  </main>;
}

const target: HTMLElement | null = document.getElementById("fixture");
if (target === null) throw new TypeError("공통 컴포넌트 검증의 마운트 지점이 없습니다.");
createRoot(target).render(<Fixture />);
