import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

interface SoftLabelProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

/**
 * Shared inline meta badge wrapping the `.soft-label` class — the hairline pill
 * used for counts, layers, and short tags. DOM-identical to the hand-rolled
 * `<span className="soft-label">` markup it replaces; `className` is appended
 * (not replaced) so call-site classes like `wiki-backlinks__layer` survive, and
 * any extra attributes (`role`, `aria-live`, …) pass through. Block uses of
 * `.soft-label` on a `<p>` (hints, empty states) are left as raw markup — they
 * borrow the type, they are not badges.
 */
export function SoftLabel({ className, children, ...rest }: SoftLabelProps) {
  return (
    <span className={cx("soft-label", className)} {...rest}>
      {children}
    </span>
  );
}
