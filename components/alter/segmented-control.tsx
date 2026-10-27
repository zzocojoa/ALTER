"use client";

import { useId, type ReactElement } from "react";

type SegmentChoice = Readonly<{ value: string; label: string; unavailableReason: string | null }>;
export type SegmentedControlProps = Readonly<{ legend: string; value: string; onValueChange: (value: string) => void; choices: readonly SegmentChoice[] }>;

export function SegmentedControl({ legend, value, onValueChange, choices }: SegmentedControlProps): ReactElement {
  const name: string = useId();
  return <fieldset className="alter-segmented">
    <legend className="alter-label">{legend}</legend>
    <div className="alter-segment-options">{choices.map((choice, index): ReactElement => <label className="alter-segment" key={choice.value}>
      <input type="radio" name={name} value={choice.value} checked={value === choice.value} disabled={choice.unavailableReason !== null} aria-describedby={choice.unavailableReason === null ? undefined : name + "-reason-" + index} onChange={(): void => onValueChange(choice.value)} />
      <span>{choice.label}</span>
    </label>)}</div>
    {choices.map((choice, index): ReactElement | null => choice.unavailableReason === null ? null : <p className="alter-caption" id={name + "-reason-" + index} key={choice.value}>{choice.label}: {choice.unavailableReason}</p>)}
  </fieldset>;
}
