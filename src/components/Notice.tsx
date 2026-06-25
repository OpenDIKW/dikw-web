import { AlertTriangle, Info } from "lucide-react";
import { DikwClientError } from "../api/client";

interface NoticeProps {
  title?: string;
  error?: unknown;
  children?: React.ReactNode;
  tone?: "info" | "warn" | "bad";
}

export function Notice({ title, error, children, tone = error ? "bad" : "info" }: NoticeProps) {
  const Icon = tone === "info" ? Info : AlertTriangle;
  const message =
    error instanceof DikwClientError
      ? error.message
      : error instanceof Error
        ? error.message
        : null;
  const code = error instanceof DikwClientError ? `${error.status} ${error.code}` : null;

  return (
    // Errors interrupt assertively; info/warn announce politely. Either way a
    // Notice surfaced after a user action is read out, not silently rendered.
    <div className={`notice notice--${tone}`} role={tone === "bad" ? "alert" : "status"}>
      <Icon size={18} aria-hidden="true" />
      <div>
        {title ? <div className="notice__title">{title}</div> : null}
        {code ? <div className="notice__code">{code}</div> : null}
        {message ? <div>{message}</div> : null}
        {children}
      </div>
    </div>
  );
}
