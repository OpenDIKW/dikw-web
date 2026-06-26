import type { ReactNode } from "react";
import { cx } from "./cx";

interface MetricCardProps {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  /** When set, the whole cell becomes a quiet stretched link to this hash route. */
  href?: string;
}

/**
 * One cell of the Overview metric strip. Renders as a `<div>` grouping a `<dt>`
 * label and `<dd>` value (the strip itself is a `<dl>`), so a screen reader
 * announces "label, value" pairs instead of a flat text stream. When `href` is
 * set the value is a stretched link covering the whole cell — no button chrome.
 */
export function MetricCard({ label, value, detail, href }: MetricCardProps) {
  return (
    <div className={cx("metric-card", href && "metric-card--link")}>
      <dt className="metric-card__label">{label}</dt>
      <dd className="metric-card__value">
        {href ? (
          <a
            className="metric-card__link"
            href={href}
            aria-label={typeof value === "string" ? `${label} ${value}` : label}
          >
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
      {detail ? <dd className="metric-card__detail">{detail}</dd> : null}
    </div>
  );
}
