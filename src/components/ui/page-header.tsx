import React from "react";

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  actions,
  className = "",
}) => {
  return (
    <header className={["u-page-header", className].filter(Boolean).join(" ")}>
      <div className="u-page-header-text">
        <h1 className="u-page-title">{title}</h1>
        {description && <p className="u-page-desc">{description}</p>}
      </div>
      {actions && <div className="u-page-header-actions">{actions}</div>}
    </header>
  );
};
