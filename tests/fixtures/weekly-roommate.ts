import { recordId } from "../../lib/domain/contracts";
import type { SourceExcerpt } from "../../lib/librarian/contracts";
import type { RoommateExplanation } from "../../lib/weekly/roommate";

export function roommateFixture(unitId:string,sources:readonly SourceExcerpt[]):RoommateExplanation {
  const source=sources[0];if(!source) throw new Error("Roommate 시험 원문이 필요합니다.");
  const quote=source.evidence.slice(0,1000);
  return {unitId:recordId.parse(unitId),learningDomain:"수학",facts:[{content:quote,sourceRefId:source.id,quote,status:"source-checked"}],analogy:{otherDomain:"음악",example:"한 마디를 같은 길이의 네 박으로 나누고 한 박을 연주하는 가상의 사례",similarities:["같게 나눈 전체 중 한 부분을 선택한다는 구조를 비교해요."],differences:["음악의 실제 박자와 수학의 분수는 역할이 달라요."],limitations:["실제 음악의 강세·변박·연주 해석은 이 비유로 설명할 수 없어요."],appliesUniversally:false,distinction:"analogy-not-established-fact"}};
}
