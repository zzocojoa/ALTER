import type { ReactElement } from "react";
import type { RoommateExplanation } from "@/lib/weekly/roommate";

type Analogy = RoommateExplanation["analogy"];
const parts: readonly Readonly<{ key: "similarities" | "differences" | "limitations"; label: string; hint: string }>[] = [
  { key: "similarities", label: "공통점", hint: "어떤 관계나 구조가 닮았는지 살펴봐요." },
  { key: "differences", label: "차이점", hint: "두 분야의 목적·특성에서 다른 부분을 구분해요." },
  { key: "limitations", label: "비유가 성립하지 않는 조건", hint: "이 비유로 설명할 수 없는 상황과 경계를 남겨요." },
];

export function WeeklyAnalogyFields({ analogy }: Readonly<{ analogy: Analogy }>): ReactElement {
  return <section className="weekly-analogy" aria-labelledby="weekly-analogy-edit-title"><h4 id="weekly-analogy-edit-title">이해를 돕는 비유 · 사실이나 성과의 근거가 아니에요</h4>
    <label>비교할 다른 분야<input name="otherDomain" required maxLength={2000} defaultValue={analogy.otherDomain}/></label><label>다른 분야의 사례 하나<textarea name="example" required maxLength={2000} defaultValue={analogy.example}/></label>
    <div className="weekly-analogy-parts">{parts.map(part => <section className="weekly-analogy-part" key={part.key}><label htmlFor={`weekly-${part.key}`}>{part.label}</label><p id={`weekly-${part.key}-hint`} className="alter-caption">{part.hint} 한 줄에 하나씩 적어요.</p><textarea id={`weekly-${part.key}`} name={part.key} required aria-describedby={`weekly-${part.key}-hint`} defaultValue={analogy[part.key].join("\n")}/></section>)}</div>
  </section>;
}

export function WeeklyAnalogyReading({ analogy }: Readonly<{ analogy: Analogy }>): ReactElement {
  return <section className="weekly-analogy" aria-labelledby="weekly-analogy-read-title"><h2 id="weekly-analogy-read-title">이해를 돕는 비유</h2><p>사실이나 학습 성과의 근거가 아니에요.</p><p className="weekly-analogy-domain"><strong>{analogy.otherDomain}</strong></p><p className="weekly-analogy-example">{analogy.example}</p><div className="weekly-analogy-parts">{parts.map(part => <section className="weekly-analogy-part" key={part.key}><h3>{part.label}</h3><p className="alter-caption">{part.hint}</p><ul>{analogy[part.key].map((text, index) => <li key={index}>{text}</li>)}</ul></section>)}</div></section>;
}
