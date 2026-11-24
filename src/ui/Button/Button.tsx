import React from "react";
import styles from "./Button.module.css";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "main" | "secondary" | "danger" | "ghost" | "icon";
  size?: "md" | "sm";
  children?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className = "", children, ...props },
  ref
) {
  const variantClass = styles[variant] || styles.secondary;
  const sizeClass = size === "sm" ? styles.sm : "";
  const combinedClassName = `${styles.btn} ${variantClass} ${sizeClass} ${className}`.trim();

  return (
    <button ref={ref} className={combinedClassName} {...props}>
      {children}
    </button>
  );
});
