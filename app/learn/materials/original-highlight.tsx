import type { ReactElement } from "react";
import type { OriginalHighlight } from "./segment-location";

export function OriginalHighlightBox({ highlight }: Readonly<{ highlight: OriginalHighlight | null }>): ReactElement | null {
  if (highlight === null) return null;
  return <span className="alter-original-highlight" data-uncertain={highlight.uncertain} aria-hidden="true" style={{ left: `${highlight.bounds.x * 100}%`, top: `${highlight.bounds.y * 100}%`, width: `${highlight.bounds.width * 100}%`, height: `${highlight.bounds.height * 100}%` }} />;
}
