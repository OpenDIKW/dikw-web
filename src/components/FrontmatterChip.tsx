import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

type FrontmatterChipVariant = "tag" | "source";

interface FrontmatterChipProps extends HTMLAttributes<HTMLSpanElement> {
  /** `tag` = petrol `#tag`, `source` = mono provenance chip; omit for a plain key/value chip. */
  variant?: FrontmatterChipVariant;
  children: ReactNode;
}

const VARIANT_CLASS: Record<FrontmatterChipVariant, string> = {
  tag: "frontmatter-chip--tag",
  source: "frontmatter-chip--source",
};

/**
 * Shared frontmatter metadata chip wrapping the `.frontmatter-chip` class. Kept
 * separate from {@link SoftLabel} and `StatusPill` — the three are visually
 * distinct and their CSS is not merged. DOM-identical to the markup it replaces:
 * the optional `variant` maps to the existing `frontmatter-chip--*` modifier and
 * any extra `className` is appended.
 */
export function FrontmatterChip({ variant, className, children, ...rest }: FrontmatterChipProps) {
  return (
    <span
      className={cx("frontmatter-chip", variant && VARIANT_CLASS[variant], className)}
      {...rest}
    >
      {children}
    </span>
  );
}
