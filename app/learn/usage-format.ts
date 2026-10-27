/** 저장된 백만분율 원화 단위를 표시하며 새 환산이나 청구 대사를 하지 않습니다. */
export function formatUsageWon(units: number): string { return `${(units / 1_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 6 })}원`; }
export function formatUsageUsd(micros: number): string { return `US$${(micros / 1_000_000).toFixed(6)}`; }
export function formatUsageTime(value: number): string { return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }).format(value); }
export function formatUsageMiB(value: number | string): string { return `${(Number(value) / 1_048_576).toFixed(2)} MiB`; }
