import React from "react";
import { ChevronDown } from "lucide-react";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = "", children, disabled, error, ...props }, ref) => {
    return (
      <div className={["u-select-wrap", className].filter(Boolean).join(" ")}>
        <select
          ref={ref}
          className={["u-select", error ? "u-input-error" : ""].filter(Boolean).join(" ")}
          disabled={disabled}
          aria-invalid={error ? "true" : undefined}
          {...props}
        >
          {children}
        </select>
        <span className="u-select-chevron" aria-hidden="true">
          <ChevronDown size={16} strokeWidth={1.5} />
        </span>
      </div>
    );
  }
);

Select.displayName = "Select";
