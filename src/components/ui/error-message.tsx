import React from "react";
import { AlertCircle } from "lucide-react";

export interface ErrorMessageProps {
  title?: string;
  message: string;
  className?: string;
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({
  title = "Error",
  message,
  className = "",
}) => {
  return (
    <div
      role="alert"
      className={["u-error-message", className].filter(Boolean).join(" ")}
    >
      <span className="u-error-icon" aria-hidden="true">
        <AlertCircle size={20} strokeWidth={1.5} />
      </span>
      <div className="u-error-content">
        <strong className="u-error-title">{title}</strong>
        <span className="u-error-desc">{message}</span>
      </div>
    </div>
  );
};
