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
 * pattern for mutually exclusive view choices (Settings theme / locale). The
 * track is a named `role="group"` (a bare `<div>` would drop its `aria-label`),
 * and each option is a toggle `<button>` carrying `aria-pressed`, so a
 * screen-reader user hears which option is selected — not three identical
 * buttons. Generic over a string value union so `onChange` stays type-safe.
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
      role="group"
      className={cx("segmented-control", settings && "segmented-control--settings", className)}
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            className={selected ? "is-active" : ""}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
