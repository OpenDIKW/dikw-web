import type { LabelHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

interface FieldProps extends Omit<LabelHTMLAttributes<HTMLLabelElement>, "children"> {
  /** Label text rendered in the leading `<span>`. */
  label: ReactNode;
  /** `.field--grow` — flex to fill the row. */
  grow?: boolean;
  /** `.field--small` — fixed narrow width. */
  small?: boolean;
  /** `.field--inline` — label and control on one grid row. */
  inline?: boolean;
  /** `.field--token` — capped-width token input. */
  token?: boolean;
  /** The control: an `<input>`, `<select>`, or `<textarea>`. */
  children: ReactNode;
}

/**
 * Shared labeled form field wrapping the `.field` class. Renders the same
 * `<label class="field"><span>{label}</span>{control}</label>` markup the
 * hand-rolled call-sites use; modifier props map to the existing `field--*`
 * classes and any extra `className` is appended.
 */
export function Field({
  label,
  grow,
  small,
  inline,
  token,
  className,
  children,
  ...rest
}: FieldProps) {
  return (
    <label
      className={cx(
        "field",
        grow && "field--grow",
        small && "field--small",
        inline && "field--inline",
        token && "field--token",
        className,
      )}
      {...rest}
    >
      <span>{label}</span>
      {children}
    </label>
  );
}
