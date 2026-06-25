import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

type ButtonVariant = "primary" | "secondary" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` = filled petrol, `secondary` = outline, `danger` = outline with red text. */
  variant?: ButtonVariant;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "primary-button",
  secondary: "secondary-button",
  danger: "secondary-button secondary-button--danger",
};

/**
 * Shared text/action button wrapping the `.primary-button` / `.secondary-button`
 * classes. DOM-identical to the hand-rolled markup it replaces: same element,
 * classes, and passthrough attributes. Defaults `type="button"` so a button
 * inside a form never submits by accident.
 */
export function Button({ variant = "primary", type, className, children, ...rest }: ButtonProps) {
  return (
    <button type={type ?? "button"} className={cx(VARIANT_CLASS[variant], className)} {...rest}>
      {children}
    </button>
  );
}
