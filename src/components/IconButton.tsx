import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** Accessible name — required, since the visible child is an icon only. */
  label: string;
  /** A single icon element. */
  children: ReactNode;
}

/**
 * Shared 38px square icon button wrapping the `.icon-button` class. DOM-identical
 * to the markup it replaces; `className` is appended (not replaced) so call-site
 * BEM classes like `agent-session__menu-trigger` survive. `label` is required and
 * becomes `aria-label`, so every icon button keeps an accessible name.
 */
export function IconButton({ label, type, className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={cx("icon-button", className)}
      aria-label={label}
      {...rest}
    >
      {children}
    </button>
  );
}
