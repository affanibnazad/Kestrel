import React from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", error, type = "text", disabled, ...props }, ref) => {
    const classes = ["u-input", error ? "u-input-error" : "", className].filter(Boolean).join(" ");
    return (
      <input
        ref={ref}
        type={type}
        className={classes}
        disabled={disabled}
        aria-invalid={error ? "true" : undefined}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
