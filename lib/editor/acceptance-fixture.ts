export const EDITOR_ACCEPTANCE_ID="00000000-0000-4000-a000-000000001010";
export const EDITOR_FEEDBACK_ACCEPTANCE_ID="00000000-0000-4000-a000-000000001019";
export const EDITOR_ACCEPTANCE_IDS=[EDITOR_ACCEPTANCE_ID,EDITOR_FEEDBACK_ACCEPTANCE_ID] as const;
export const EDITOR_ACCEPTANCE_QUESTION="00000000-0000-4000-a000-000000001011";
export const EDITOR_ACCEPTANCE_ATTEMPT="00000000-0000-4000-a000-000000001012";
export const EDITOR_ACCEPTANCE_TASK="전체를 같은 크기의 여덟 조각으로 나누고 세 조각을 선택했습니다. 이를 분수로 쓰고, 그 분수에서 분자와 분모가 각각 무엇을 나타내는지 설명하세요.";
export const EDITOR_ACCEPTANCE_VARIATION="전체를 같은 크기의 다섯 조각으로 나누고 두 조각을 선택했습니다. 이를 분수로 쓰고 분자와 분모의 뜻을 설명하세요.";
export const editorAcceptanceAnswers={draft:"8/3입니다. 분자 8은 전체를 나눈 조각의 수이고 분모 3은 선택한 조각의 수입니다.",revision:"3/8입니다. 분모 8은 전체를 같은 크기로 나눈 여덟 조각을 나타내고, 분자 3은 그중 선택한 세 조각을 나타냅니다.",reason:"분자와 분모의 뜻을 반대로 설명해서 고쳤습니다. 전체를 같은 크기로 나눈 조각 수를 분모에, 선택한 조각 수를 분자에 적어야 합니다.",variation:"2/5입니다. 분모 5는 전체를 같은 크기로 나눈 다섯 조각을 나타내고 분자 2는 선택한 두 조각을 나타냅니다."} as const;
