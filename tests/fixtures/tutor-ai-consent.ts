import { expect, type Page } from "@playwright/test";

/** 합성 원장을 읽고 화면의 전송 동의를 확인하며 AI 실행 버튼은 호출자가 별도로 누릅니다. */
export async function confirmTutorAiTransmission(page: Page, label: string): Promise<void> {
  const form = page.getByRole("form", { name: `${label} 전송 조건`, exact: true });
  await form.getByRole("button", { name: "비용·지원 상태 확인", exact: true }).click();
  const consent = form.getByRole("checkbox", { name: "위 내용을 OpenAI로 전송하고 API 비용이 발생할 수 있음에 동의해요.", exact: true });
  await expect(consent).toBeEnabled(); await consent.check();
}
