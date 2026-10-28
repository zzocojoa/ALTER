import { createElement } from "react";
import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TutorPanel } from "../../app/learn/tutor/tutor-panel";
import { publicTutorView } from "../../lib/tutor/view";
import { beginTutorLesson, beginTutorRecall, finishTutorLesson, pauseTutor, beginDirectTutorAnswer, saveTutorAnswer, beginTutorDiagnosis, finishTutorDiagnosis } from "../../lib/tutor/state";
import { tutorLessonFixture, tutorStateFixture, tutorAnswerFixture, tutorDiagnosisFixture } from "../fixtures/tutor-state";

it("인출 화면과 서버 전달 자료에 원문·AI 설명·접힌 이력이 남지 않는다",()=>{
  const explained=finishTutorLesson(beginTutorLesson(tutorStateFixture()),tutorLessonFixture());
  const view=publicTutorView(beginTutorRecall(explained));
  expect(JSON.stringify(view)).not.toContain(explained.start.bundle.sources[0].evidence); expect(view.lesson).toBeNull(); expect(view.sources).toEqual([]);
  const html=renderToStaticMarkup(createElement(TutorPanel,{aiUnavailable:null,view,text:"",busy:false,saved:true,error:"",onText:():void=>{},onSubmit:():void=>{},onAction:():void=>{},onFile:():void=>{},fileNames:[],composing:false,photoProgress:"",inputBusy:false,saveState:{kind:"idle"},submitting:false,uncertain:false,retryAvailable:false,onRetry:():void=>{},onComposition:():void=>{}}));
  expect(html).not.toContain(tutorLessonFixture().explanation.text); expect(html).not.toContain("<details"); expect(html.match(/data-testid="tutor-question"/g)).toHaveLength(1); expect(html).toContain('id="tutor-answer"'); expect(html).toContain('disabled=""');
  const paused=publicTutorView(pauseTutor(explained));expect(paused.sources).toEqual([]);expect(paused.lesson).toBeNull();
});


it("진단의 정답 인용은 전달하지 않고 서버의 판정 근거는 보존한다",()=>{
  const answer={...tutorAnswerFixture(),text:"아직 모르겠습니다."};
  const output={...tutorDiagnosisFixture(),correct:false,needsHelp:true,observation:"요구한 설명이 아직 없어요."};
  const state=finishTutorDiagnosis(beginTutorDiagnosis(saveTutorAnswer(beginDirectTutorAnswer(tutorStateFixture()),answer)),output);
  const before=JSON.stringify(state);const view=publicTutorView(state);
  expect(view.diagnosis).toEqual({...output,citations:[]});
  expect(JSON.stringify(view)).not.toContain(output.citations[0].quote);
  expect(state.diagnosis?.citations).toEqual(output.citations);expect(state.diagnoses[0].citations).toEqual(output.citations);expect(JSON.stringify(state)).toBe(before);
  const html=renderToStaticMarkup(createElement(TutorPanel,{aiUnavailable:null,view,text:"",busy:false,saved:true,error:"",onText:():void=>{},onSubmit:():void=>{},onAction:():void=>{},onFile:():void=>{},fileNames:[],composing:false,photoProgress:"",inputBusy:false,saveState:{kind:"idle"},submitting:false,uncertain:false,retryAvailable:false,onRetry:():void=>{},onComposition:():void=>{}}));
  expect(html).toContain(output.observation);expect(html).toContain("다음 단계 도움 요청");expect(html).not.toContain(output.citations[0].quote);expect(html).not.toContain("<blockquote");
});
