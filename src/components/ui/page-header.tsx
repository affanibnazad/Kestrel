import React from "react";

export interface PageHeaderProps {
  title: string;
  lead?: string;
  action?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  lead,
  action,
  className = "",
}) => {
  return (
    <div className={["u-page-header", className].filter(Boolean).join(" ")}>
      <div className="u-page-header-text">
        <h1>{title}</h1>
        {lead && <p className="u-lead">{lead}</p>}
      </div>
      {action && <div className="u-page-header-action">{action}</div>}
    </div>
  );
};

PageHeader.displayName = "PageHeader";
