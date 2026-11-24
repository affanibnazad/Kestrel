import React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "solid" | "danger" | "icon" | "advanced";
  size?: "default" | "sm";
  icon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className = "",
      variant = "default",
      size = "default",
      icon,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    let variantClass = "u-btn-default";
    if (variant === "primary") {
      variantClass = "u-btn-primary primary";
    } else if (variant === "solid") {
      variantClass = "u-btn-solid solid";
    } else if (variant === "danger") {
      variantClass = "u-btn-danger";
    } else if (variant === "icon") {
      variantClass = "u-btn-icon";
    }

    const isAdvanced = variant === "advanced";
    const baseClass = isAdvanced ? "u-adv" : "u-btn";
    const sizeClass = size === "sm" ? "u-btn-sm" : "";
    const classes = [baseClass, !isAdvanced ? variantClass : "", sizeClass, className]
      .filter(Boolean)
      .join(" ");

    return (
      <button
        ref={ref}
        className={classes}
        disabled={disabled}
        aria-disabled={disabled}
        {...props}
      >
        {icon && <span className="u-btn-icon-wrap" aria-hidden="true">{icon}</span>}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
