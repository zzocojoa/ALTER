"use client";

import type { ReactElement, ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type DisclosureProps = Readonly<{ title: string; open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }>;

export function Disclosure({ title, open, onOpenChange, children }: DisclosureProps): ReactElement {
  return <details className="alter-disclosure" open={open} onToggle={(event): void => onOpenChange(event.currentTarget.open)}>
    <summary className="alter-focus"><span>{title}</span><ChevronDown className="alter-icon" aria-hidden="true" focusable="false" /></summary>
    <div className="alter-disclosure-content">{children}</div>
  </details>;
}
