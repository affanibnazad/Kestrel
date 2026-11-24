import React from "react";

export type BadgeVariant =
  | "connected"
  | "untested"
  | "error"
  | "neutral"
  | "success"
  | "warning"
  | "danger";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  children: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({
  variant = "connected",
  className = "",
  children,
  ...props
}) => {
  let variantClass = "u-badge-connected";
  if (variant === "untested" || variant === "neutral") {
    variantClass = "u-badge-untested";
  } else if (variant === "error" || variant === "danger") {
    variantClass = "u-badge-error";
  } else if (variant === "warning") {
    variantClass = "u-badge-warning";
  } else if (variant === "success" || variant === "connected") {
    variantClass = "u-badge-connected";
  }

  return (
    <span
      className={["u-badge", "badge", variantClass, className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </span>
  );
};

Badge.displayName = "Badge";
