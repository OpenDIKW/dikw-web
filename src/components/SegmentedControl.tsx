import type { ReactNode } from "react";
import { cx } from "./cx";

interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface SegmentedControlProps<T extends string> {
  /** The currently selected option value. */
  value: T;
  /** Mutually exclusive choices, rendered left to right. */
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
  /** Accessible name for the track (maps to `aria-label`). */
  ariaLabel: string;
  /** `.segmented-control--settings` — fit-content track used on the Settings page. */
  settings?: boolean;
  className?: string;
}

/**
 * Shared segmented control wrapping the `.segmented-control` class — the chosen
 * pattern for mutually exclusive view choices (Settings theme / locale).
 * DOM-identical to the hand-rolled markup: a labeled `<div>` track of
 * `type="button"` options where the selected one carries `is-active`. Generic
 * over a string value union so the caller's `onChange` stays type-safe.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  settings,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={cx("segmented-control", settings && "segmented-control--settings", className)}
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? "is-active" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
