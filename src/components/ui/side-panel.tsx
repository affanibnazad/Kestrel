import React from "react";
import { X as CloseIcon } from "lucide-react";
import { Button } from "./button";

export interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export const SidePanel: React.FC<SidePanelProps> = ({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className = "",
}) => {
  if (!open) return null;

  return (
    <>
      <div className="u-side-panel-overlay" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={["u-side-panel", className].filter(Boolean).join(" ")}
      >
        <header className="u-side-panel-header">
          <div>
            <h2 className="u-side-panel-title">{title}</h2>
            {description && <p className="u-side-panel-desc" style={{ margin: "4px 0 0", fontSize: "var(--u-font-14)" }}>{description}</p>}
          </div>
          <Button
            variant="icon"
            onClick={onClose}
            aria-label="Close panel"
            type="button"
          >
            <CloseIcon size={18} strokeWidth={1.5} />
          </Button>
        </header>
        <div className="u-side-panel-body">{children}</div>
        {footer && <footer className="u-side-panel-footer">{footer}</footer>}
      </aside>
    </>
  );
};
