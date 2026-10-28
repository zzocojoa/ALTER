import type { GooglePickerBuilder, GooglePickerInstance, GooglePickerSdk } from "../../lib/google/picker-browser";

function requireValue(value: string): void { if (value.length === 0) throw new Error("시험 Picker 설정 누락"); }
class FixturePickerBuilder implements GooglePickerBuilder {
  private callback: ((value: unknown) => void) | null = null;
  private mimeTypes: string = "";
  setOAuthToken(value: string): GooglePickerBuilder { requireValue(value); return this; }
  setDeveloperKey(value: string): GooglePickerBuilder { requireValue(value); return this; }
  setAppId(value: string): GooglePickerBuilder { requireValue(value); return this; }
  setOrigin(value: string): GooglePickerBuilder { if (value !== location.origin) throw new Error("시험 Picker origin 불일치"); return this; }
  setCallback(value: (data: unknown) => void): GooglePickerBuilder { this.callback = value; return this; }
  setSelectableMimeTypes(value: string): GooglePickerBuilder { this.mimeTypes = value; return this; }
  setMaxItems(value: number): GooglePickerBuilder { if (value !== 1) throw new Error("시험 Picker 단일 파일 조건 누락"); return this; }
  setLocale(value: string): GooglePickerBuilder { if (value !== "ko") throw new Error("시험 Picker 언어 불일치"); return this; }
  addView(value: string): GooglePickerBuilder { requireValue(value); return this; }
  build(): GooglePickerInstance {
    const callback = this.callback; if (!callback) throw new Error("시험 Picker 콜백 누락");
    const dialog = document.createElement("dialog"); dialog.setAttribute("aria-label", "Google 시험 파일 선택");
    const description = document.createElement("p"); description.textContent = this.mimeTypes;
    const choose = document.createElement("button"); choose.textContent = "시험 파일 선택 완료"; choose.onclick = (): void => callback({ action: "picked", docs: [{ id: "fixture-selected-doc", name: "신뢰하지 않는 선택기 이름" }] });
    const cancel = document.createElement("button"); cancel.textContent = "시험 파일 선택 취소"; cancel.onclick = (): void => callback({ action: "cancel" });
    dialog.appendChild(description); dialog.appendChild(choose); dialog.appendChild(cancel);
    return { setVisible: (visible: boolean): void => { if (visible) { document.body.appendChild(dialog); dialog.showModal(); } else dialog.close(); }, dispose: (): void => { dialog.close(); dialog.remove(); } };
  }
}
export function installFixtureGooglePicker(browser: Window): void {
  const target = browser as Window & { google: { picker: GooglePickerSdk } };
  target.google = { picker: { PickerBuilder: FixturePickerBuilder, ViewId: { DOCS: "docs" } } };
}
