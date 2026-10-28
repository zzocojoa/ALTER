import type { ReactElement } from "react";
import "./styles/access.css";
import { formatSeoulDate } from "@/lib/seoul-date";
import type { SeoulDate } from "@/lib/seoul-date";
import { Welcome } from "./welcome";
import { chatGPTSignInPath } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default function Home(): ReactElement {
  const today: SeoulDate = formatSeoulDate(new Date());
  return (
    <div data-alter-ui className="site-shell public-entry">
      <a href="#main" className="skip-link">본문으로 건너뛰기</a>
      <header className="site-header">
        <span className="wordmark">ALTER<span aria-hidden="true">.</span></span>
        <div className="date"><time dateTime={today.isoDate}>{today.label}</time><span>서울 기준</span></div>
      </header>
      <main id="main" tabIndex={-1}>
        <div className="intro-grid">
          <section aria-labelledby="welcome-title">
            <p className="eyebrow">배움의 주도권을 나에게</p>
            <h1 id="welcome-title">나의 속도로,<br /><span>스스로 배우기</span></h1>
            <p className="introduction">많이 읽는 것보다, 내 말로 설명할 수 있는 한 가지.<br className="desktop-break" /> 자료를 고르고, 직접 답하고, 배운 내용을 다시 확인해 보세요.</p>
            <p><a className="alter-link access-primary" href={chatGPTSignInPath("/learn")} target="_top">내 학습 공간 열기</a></p>
            <Welcome />
          </section>
          <aside className="learning-note" aria-labelledby="note-title">
            <p className="note-number" aria-hidden="true">A / 01</p>
            <h2 id="note-title">배움을 남기는 세 가지 순간</h2>
            <ol>
              <li><strong>떠올리기</strong><p>자료를 잠시 덮고, 기억나는 것을 꺼내 보세요.</p></li>
              <li><strong>설명하기</strong><p>정답을 보기 전에, 나의 생각을 말로 풀어 보세요.</p></li>
              <li><strong>다시 확인하기</strong><p>시간이 지난 뒤에도 스스로 해낼 수 있는지 살펴보세요.</p></li>
            </ol>
            <p className="note-footer">조금씩, 그러나 내 힘으로.</p>
          </aside>
        </div>
      </main>
      <footer className="site-footer"><span>ALTER · 나의 학습 공간</span><span>오늘의 작은 이해가 내일의 바탕이 되도록.</span></footer>
    </div>
  );
}
