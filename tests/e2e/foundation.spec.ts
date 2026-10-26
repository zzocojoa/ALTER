import { expect, test } from "@playwright/test";

test.afterEach(async ({ page }) => {
  expect(await page.pageErrors()).toEqual([]);
});

test("한국어 기본 화면을 표시한다", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/나의 속도로,\s*스스로 배우기/);
});

test("공식 로컬 인증 쿠키를 생성하고 지운다", async ({ page, context }) => {
  await page.goto("/signin-with-chatgpt?return_to=/");
  const signedIn = (await context.cookies()).find((cookie) => cookie.name === "__sites_local_auth");
  expect(signedIn).toMatchObject({ value: "1", httpOnly: true, sameSite: "Lax" });
  await page.goto("/signout-with-chatgpt?return_to=/");
  expect((await context.cookies()).some((cookie) => cookie.name === "__sites_local_auth")).toBe(false);
});

test("다른 출처의 로컬 인증 요청을 거부한다", async ({ request }) => {
  const response = await request.get("/signin-with-chatgpt?return_to=/", { headers: { origin: "https://example.com" }, maxRedirects: 0 });
  expect(response.status()).toBe(403);
});


test("키보드로 입력·대화상자를 조작하고 초점을 복귀시킨다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "환영 문구 바꾸기" })).toBeEnabled();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "본문으로 건너뛰기" })).toBeFocused();
  await page.keyboard.press("Tab");
  const trigger = page.getByRole("button", { name: "환영 문구 바꾸기" });
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "어떻게 불러드릴까요?" });
  const input = page.getByRole("textbox", { name: "표시 이름" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription("입력한 이름은 현재 화면에서만 사용해요. 화면을 새로 열면 지워집니다.");
  await expect(input).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "적용하기" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(input).toBeFocused();
  await input.fill("  하늘  ");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "취소" })).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.getByText("하늘님, 반가워요.")).toBeVisible();
  await page.keyboard.press("Enter");
  await input.fill("취소할 이름");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(page.getByText("하늘님, 반가워요.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("나를 위한 작은 학습 공간")).toBeVisible();
});

test("공백 이름을 거부하고 작은 화면에서도 가로 넘침이 없다", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "환영 문구 바꾸기" }).click();
  const input = page.getByRole("textbox", { name: "표시 이름" });
  await input.fill("   ");
  await page.getByRole("button", { name: "적용하기" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await input.evaluate((element: HTMLInputElement) => element.validity.patternMismatch)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("브라우저 기본 시간대와 무관하게 서울 날짜를 표시한다", async ({ page }) => {
  await page.goto("/");
  const expected: string = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  await expect(page.locator("time")).toHaveAttribute("datetime", expected);
  await expect(page.getByText("서울 기준", { exact: true })).toBeVisible();
});
