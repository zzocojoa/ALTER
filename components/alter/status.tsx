import type { ReactElement, ReactNode } from "react";
import { CircleCheck, CircleAlert, Clock3, Info, type LucideIcon } from "lucide-react";
import { savePresentation, type SaveState, type StatusTone } from "@/lib/ui/save-status";

const icons: Readonly<Record<StatusTone, LucideIcon>> = { neutral: Info, success: CircleCheck, warning: Clock3, danger: CircleAlert };

export function StatusBadge({ label, tone }: Readonly<{ label: string; tone: StatusTone }>): ReactElement {
  const Icon: LucideIcon = icons[tone];
  return <span className="alter-badge" data-tone={tone}><Icon className="alter-icon" aria-hidden="true" focusable="false" /><span>{label}</span></span>;
}

export function SaveStatus({ id, state }: Readonly<{ id: string; state: SaveState }>): ReactElement {
  const view = savePresentation(state);
  return <div id={id} className="alter-save-status" role="status" aria-live="polite" aria-atomic="true" data-persistence={view.persistence}>
    <StatusBadge label={view.label} tone={view.tone} />
    {view.detail === null ? null : <p className="alter-caption">{view.detail}</p>}
  </div>;
}

type StateCopy = Readonly<{ title: string; detail: string; action: ReactNode }>;
export function EmptyState({ title, detail, action }: StateCopy): ReactElement {
  return <section className="alter-state"><h2 className="alter-subheading">{title}</h2><p className="alter-body">{detail}</p>{action}</section>;
}
export function ErrorState({ title, detail, action }: StateCopy): ReactElement {
  return <section className="alter-state" data-tone="danger" role="alert"><h2 className="alter-subheading">{title}</h2><p className="alter-body">{detail}</p>{action}</section>;
}
export function LoadingState({ label }: Readonly<{ label: string }>): ReactElement {
  return <div className="alter-state" role="status" aria-live="polite"><p className="alter-body">{label}</p><div className="alter-skeleton" aria-hidden="true" /><div className="alter-skeleton" aria-hidden="true" /></div>;
}
