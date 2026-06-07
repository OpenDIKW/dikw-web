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
    <div className={`notice notice--${tone}`}>
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
