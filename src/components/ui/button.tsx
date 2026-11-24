import React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "danger" | "icon";
  size?: "default" | "sm";
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = "", variant = "default", size = "default", disabled, children, ...props }, ref) => {
    const variantClass =
      variant === "primary"
        ? "u-btn-primary"
        : variant === "danger"
        ? "u-btn-danger"
        : variant === "icon"
        ? "u-btn-icon"
        : "u-btn-default";

    const sizeClass = size === "sm" ? "u-btn-sm" : "";
    const classes = ["u-btn", variantClass, sizeClass, className].filter(Boolean).join(" ");

    return (
      <button ref={ref} className={classes} disabled={disabled} aria-disabled={disabled} {...props}>
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
