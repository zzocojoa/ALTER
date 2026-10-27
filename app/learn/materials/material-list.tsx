"use client";

import type { ReactElement, MouseEvent } from "react";
import { ChevronRight, FileText, ImageIcon, type LucideIcon } from "lucide-react";
import { StatusBadge } from "@/components/alter/status";
import type { MaterialCard } from "@/lib/materials/library";
import type { MaterialMetadata } from "@/lib/materials/policy";

const roles: Readonly<Record<MaterialMetadata["role"], string>> = { textbook: "주교재", reference: "참고 자료", answer: "사진 답안" };
const formats: Readonly<Record<MaterialMetadata["kind"], string>> = { pdf: "PDF", image: "사진", text: "TXT" };
const icons: Readonly<Record<MaterialMetadata["kind"], LucideIcon>> = { pdf: FileText, image: ImageIcon, text: FileText };

type MaterialListProps = Readonly<{ materials: readonly MaterialCard[]; selectedId: string | null; unavailable: boolean; onSelect: (item: MaterialCard, button: HTMLButtonElement) => void }>;

/** 등록 API가 확인한 원본만 나열하며 AI 추출 확인 여부를 추정하지 않습니다. */
export function MaterialList({ materials, selectedId, unavailable, onSelect }: MaterialListProps): ReactElement {
  return <ul className="alter-material-list">{materials.map((item): ReactElement => {
    const Icon: LucideIcon = icons[item.metadata.kind];
    return <li key={item.id}><button id={`material-${item.id}`} type="button" className="alter-control alter-material-row" disabled={unavailable} aria-pressed={selectedId === item.id} onClick={(event: MouseEvent<HTMLButtonElement>): void => onSelect(item, event.currentTarget)}>
      <span className="alter-material-format"><Icon aria-hidden="true" className="alter-icon" /><span>{formats[item.metadata.kind]}</span></span>
      <span className="alter-material-copy"><strong>{item.metadata.title}</strong><span className="alter-caption">{item.metadata.filename}</span><span className="alter-caption">{roles[item.metadata.role]}{item.metadata.edition ? ` · ${item.metadata.edition}` : ""} · {item.file.pages}페이지 · {(item.file.bytes / 1048576).toFixed(2)} MiB</span><StatusBadge label="원본 등록 확인됨" tone="success" /></span>
      <span className="alter-material-open">{selectedId === item.id ? "선택됨" : "열기"}<ChevronRight aria-hidden="true" className="alter-icon" /></span>
    </button></li>;
  })}</ul>;
}
