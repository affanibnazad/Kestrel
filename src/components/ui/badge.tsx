import React from "react";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "neutral" | "success" | "warning" | "danger";
  children: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = "success",
  className = "",
  children,
  ...props
}) => {
  const variantClass =
    variant === "success"
      ? "u-badge-success"
      : variant === "warning"
      ? "u-badge-warning"
      : variant === "danger"
      ? "u-badge-danger"
      : "u-badge-neutral";

  return (
    <span
      className={["u-badge", variantClass, className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </span>
  );
};

Badge.displayName = "Badge";
