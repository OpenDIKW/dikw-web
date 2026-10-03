import type { LucideIcon } from "lucide-react";
import { SearchX } from "lucide-react";

interface EmptyStateProps {
  title: string;
  detail?: string;
  icon?: LucideIcon;
}

export function EmptyState({ title, detail, icon: Icon = SearchX }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <Icon size={22} aria-hidden="true" />
      <div>
        <div className="empty-state__title">{title}</div>
        {detail ? <div className="empty-state__detail">{detail}</div> : null}
      </div>
    </div>
  );
}
