import type { LearningConditions } from "../../lib/advisor/conditions";

export type LearningFlowCase = Readonly<{
  domain: LearningConditions["domain"];
  title: string;
  definition: string;
  question: string;
  explanationAnswer: string;
  exercise: string;
  revision: string;
  reason: string;
  variation: string;
  changedCondition: string;
  variationAnswer: string;
  followupVariation: string;
  followupCondition: string;
  followupAnswer: string;
}>;

/** 외부 자료나 실제 모델 평가로 오인하지 않도록 자체 작성한 결정적 시험 입력입니다. */
export const learningFlowCases: readonly LearningFlowCase[] = [
  {
    domain: "major", title: "전공 · 균등 확률",
    definition: "모든 결과의 가능성이 같을 때 사건의 확률은 사건에 속한 결과 수를 전체 결과 수로 나눈 값이다. 전체 8개 중 3개가 해당하면 확률은 3/8이다.",
    question: "결과의 가능성이 같을 때 확률을 구하는 기준을 자기 말로 설명하세요.",
    explanationAnswer: "가능성이 같은 모든 결과를 분모에 놓고 원하는 사건에 속한 결과를 분자로 놓습니다.",
    exercise: "균등한 8개 결과 중 3개가 해당하는 사건의 확률을 계산하세요.",
    revision: "가능성이 같으므로 해당 결과 3개를 전체 결과 8개로 나누어 3/8입니다.",
    reason: "전체 결과와 해당 결과를 거꾸로 나눈 오류를 고쳤습니다.",
    variation: "균등한 10개 결과 중 4개가 해당하는 사건의 확률을 계산하세요.",
    changedCondition: "10개 결과 중 4개", variationAnswer: "4/10 = 2/5입니다.",
    followupVariation: "균등한 12개 결과 중 5개가 해당하는 사건의 확률을 계산하세요.", followupCondition: "12개 결과 중 5개", followupAnswer: "5/12입니다.",
  },
  {
    domain: "certification", title: "자격 · 저항 회로 계산",
    definition: "이상적인 저항의 전압 V, 전류 I, 저항 R은 V=IR을 만족한다. 전류는 전압을 저항으로 나누어 구한다. 12 V와 6 Ω이면 2 A이다. 이 자료는 계산 연습이며 실제 전기 작업 지침이 아니다.",
    question: "이상적인 저항의 전류 계산 관계를 자기 말로 설명하세요.",
    explanationAnswer: "저항이 같을 때 전압이 커지면 전류도 커지며, 전류는 전압 나누기 저항입니다.",
    exercise: "12 V가 걸린 6 Ω 저항의 전류를 계산하세요.",
    revision: "I=V/R이므로 12 V를 6 Ω으로 나눈 2 A입니다.",
    reason: "전압과 저항을 곱한 오류를 나눗셈으로 고쳤습니다.",
    variation: "24 V가 걸린 8 Ω 저항의 전류를 계산하세요.",
    changedCondition: "24 V가 걸린 8 Ω", variationAnswer: "24 V ÷ 8 Ω = 3 A입니다.",
    followupVariation: "15 V가 걸린 3 Ω 저항의 전류를 계산하세요.", followupCondition: "15 V가 걸린 3 Ω", followupAnswer: "15 V ÷ 3 Ω = 5 A입니다.",
  },
  {
    domain: "practical", title: "실무 · 재고 수량 대사",
    definition: "기말 재고 수량은 기초 재고에 입고를 더하고 출고를 뺀다. 기초 20개, 출고 6개, 입고 4개이면 기말 재고는 18개이다. 수량 대사는 같은 품목과 같은 기간을 사용한다.",
    question: "같은 품목의 기말 재고를 대사하는 원칙을 자기 말로 설명하세요.",
    explanationAnswer: "같은 기간의 시작 수량에 들어온 수량을 더하고 나간 수량을 빼서 끝 수량을 확인합니다.",
    exercise: "기초 20개, 출고 6개, 입고 4개인 품목의 기말 재고를 계산하세요.",
    revision: "기초 20개에 입고 4개를 더하고 출고 6개를 빼면 18개입니다.",
    reason: "입고와 출고의 부호를 반대로 사용한 오류를 고쳤습니다.",
    variation: "기초 30개, 출고 8개, 입고 5개인 품목의 기말 재고를 계산하세요.",
    changedCondition: "기초 30개, 출고 8개, 입고 5개", variationAnswer: "30 + 5 - 8 = 27개입니다.",
    followupVariation: "기초 40개, 출고 9개, 입고 3개인 품목의 기말 재고를 계산하세요.", followupCondition: "기초 40개, 출고 9개, 입고 3개", followupAnswer: "40 + 3 - 9 = 34개입니다.",
  },
];

export function learningFlowSource(scenario: LearningFlowCase): string {
  return `저자: ALTER. 출처: 자체 통합 시험 자료. 판본: flow-v1. ${scenario.title}. ${scenario.definition} 연습: ${scenario.exercise}`;
}
