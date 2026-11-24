import React from "react";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className = "",
}) => {
  return (
    <div className={["u-empty-state", className].filter(Boolean).join(" ")}>
      {icon && <div className="u-empty-state-icon" aria-hidden="true">{icon}</div>}
      <h3 className="u-empty-state-title">{title}</h3>
      {description && <p className="u-empty-state-desc">{description}</p>}
      {action && <div style={{ marginTop: "var(--u-space-8)" }}>{action}</div>}
    </div>
  );
};
