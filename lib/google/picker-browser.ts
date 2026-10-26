import { z } from "zod";
import { googlePickerCredentials } from "./picker";
import type { GooglePickerCredentials, GooglePickerSelection } from "./picker";

export interface GooglePickerInstance { setVisible(visible: boolean): void; dispose(): void }
export interface GooglePickerBuilder {
  setOAuthToken(token: string): GooglePickerBuilder; setDeveloperKey(key: string): GooglePickerBuilder; setAppId(id: string): GooglePickerBuilder;
  setOrigin(origin: string): GooglePickerBuilder; setCallback(callback: (value: unknown) => void): GooglePickerBuilder;
  setSelectableMimeTypes(types: string): GooglePickerBuilder; setMaxItems(count: number): GooglePickerBuilder; setLocale(locale: string): GooglePickerBuilder;
  addView(view: string): GooglePickerBuilder; build(): GooglePickerInstance;
}
export type GooglePickerSdk = Readonly<{ PickerBuilder: new () => GooglePickerBuilder; ViewId: Readonly<{ DOCS: string }> }>;
type GoogleWindow = Window & { gapi?: Readonly<{ load: (name: string, options: Readonly<{ callback: () => void; onerror: () => void; timeout: number; ontimeout: () => void }>) => void }>; google?: Readonly<{ picker?: GooglePickerSdk }> };
export type PickerOutcome = Readonly<{ kind: "selected"; selection: GooglePickerSelection }> | Readonly<{ kind: "canceled" }>;
const selectionResponse = z.object({ action: z.literal("picked"), docs: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/) })).length(1) });

/** 공식 SDK만 지연 로드하며 토큰이나 선택 파일을 전역 상태에 저장하지 않습니다. */
async function loadGooglePickerSdkOnce(browser: GoogleWindow): Promise<GooglePickerSdk> {
  if (browser.google?.picker) return browser.google.picker;
  if (!browser.gapi) await new Promise<void>((resolve, reject) => {
    const script: HTMLScriptElement = browser.document.createElement("script");
    const timeout: number = browser.setTimeout(() => { script.remove(); reject(new Error("Google 파일 선택기 로딩 시간이 초과됐어요.")); }, 15_000);
    script.src = "https://apis.google.com/js/api.js"; script.async = true; script.referrerPolicy = "strict-origin-when-cross-origin";
    script.onload = (): void => { browser.clearTimeout(timeout); resolve(); };
    script.onerror = (): void => { browser.clearTimeout(timeout); script.remove(); reject(new Error("Google 파일 선택기를 불러오지 못했어요.")); };
    browser.document.head.appendChild(script);
  });
  const loader = browser.gapi;
  if (!loader) throw new Error("Google 파일 선택기 로더를 확인하지 못했어요.");
  await new Promise<void>((resolve, reject) => loader.load("picker", { callback: resolve, onerror: () => reject(new Error("Google 파일 선택기를 초기화하지 못했어요.")), timeout: 15_000, ontimeout: () => reject(new Error("Google 파일 선택기 초기화 시간이 초과됐어요.")) }));
  if (!browser.google?.picker) throw new Error("Google 파일 선택기 초기화 결과가 없어요.");
  return browser.google.picker;
}

/** 선택·취소·만료·페이지 이탈 모두 Picker를 폐기하고 메모리 참조를 해제합니다. */
export async function openGooglePicker(sdk: GooglePickerSdk, value: GooglePickerCredentials, role: GooglePickerSelection["role"], origin: string, signal: AbortSignal, now: () => number): Promise<PickerOutcome> {
  const credentials: GooglePickerCredentials = googlePickerCredentials.parse(value);
  if (credentials.origin !== origin || credentials.leaseExpiresAt <= now() || credentials.tokenExpiresAt <= now() || signal.aborted) throw new Error("파일 선택 요청이 만료됐어요. 다시 시작해 주세요.");
  return new Promise<PickerOutcome>((resolve, reject) => {
    let picker: GooglePickerInstance | null = null;
    let settled: boolean = false;
    const close = (): void => { clearTimeout(timer); signal.removeEventListener("abort", abort); picker?.dispose(); picker = null; };
    const fail = (message: string): void => { if (settled) return; settled = true; close(); reject(new Error(message)); };
    const abort = (): void => fail("파일 선택을 중단했어요.");
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => fail("파일 선택 시간이 만료됐어요. 다시 시작해 주세요."), credentials.leaseExpiresAt - now());
    signal.addEventListener("abort", abort, { once: true });
    const callback = (data: unknown): void => {
      if (settled) return;
      if (credentials.leaseExpiresAt <= now() || signal.aborted) { fail("파일 선택 요청이 만료됐어요."); return; }
      const action = z.object({ action: z.string() }).safeParse(data);
      if (action.success && action.data.action === "loaded") return;
      if (action.success && action.data.action === "cancel") { settled = true; close(); resolve({ kind: "canceled" }); return; }
      const selected = selectionResponse.safeParse(data);
      if (!selected.success) { fail("Google 파일 선택 결과를 확인하지 못했어요."); return; }
      settled = true; close(); resolve({ kind: "selected", selection: { leaseId: credentials.leaseId, connectionId: credentials.connectionId, generation: credentials.generation, fileId: selected.data.docs[0].id, role } });
    };
    try {
      const mimeTypes: string = role === "docs-target" ? "application/vnd.google-apps.document" : role === "sheets-target" ? "application/vnd.google-apps.spreadsheet" : "application/vnd.google-apps.document,application/pdf,image/png,image/jpeg";
      picker = new sdk.PickerBuilder().setOAuthToken(credentials.accessToken).setDeveloperKey(credentials.apiKey).setAppId(credentials.projectNumber).setOrigin(origin).setLocale("ko").addView(sdk.ViewId.DOCS).setSelectableMimeTypes(mimeTypes).setMaxItems(1).setCallback(callback).build();
      picker.setVisible(true);
    } catch (error: unknown) { settled = true; close(); reject(new Error("Google 파일 선택기를 열지 못했어요.", { cause: error })); }
  });
}

/** 일시적인 SDK 로드 오류는 상한과 경고를 두고 다시 시도합니다. */
export async function loadGooglePickerSdk(browser: GoogleWindow): Promise<GooglePickerSdk> {
  for (let attempt: number = 1; attempt <= 3; attempt += 1) {
    try { return await loadGooglePickerSdkOnce(browser); }
    catch (error: unknown) {
      if (!(error instanceof Error) || attempt === 3) throw error;
      console.warn({ event: "google_picker_sdk_retry", attempt, errorType: error.name });
      await new Promise<void>(resolve => browser.setTimeout(resolve, attempt * 1000));
    }
  }
  throw new Error("Google 파일 선택기를 불러오지 못했어요.");
}
