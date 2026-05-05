import { CheckCircle2, Clock3, HelpCircle, XCircle } from "lucide-react";
import { statusTone } from "../utils/format";

interface StatusPillProps {
  status: string;
  label?: string;
}

export function StatusPill({ status, label }: StatusPillProps) {
  const tone = statusTone(status);
  const Icon =
    tone === "ok" ? CheckCircle2 : tone === "bad" ? XCircle : tone === "info" ? Clock3 : HelpCircle;

  return (
    <span className={`status-pill status-pill--${tone}`}>
      <Icon size={14} aria-hidden="true" />
      {label ?? status}
    </span>
  );
}
