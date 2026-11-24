import React from "react";
import styles from "./IconCircle.module.css";

export interface IconCircleProps extends React.HTMLAttributes<HTMLDivElement> {
  icon: React.ReactNode;
  size?: "sm" | "md" | "lg";
}

export function IconCircle({
  icon,
  size = "md",
  className = "",
  ...props
}: IconCircleProps) {
  const sizeClass = styles[size] || styles.md;

  return (
    <div
      className={`${styles.circle} ${sizeClass} ${className}`.trim()}
      aria-hidden="true"
      {...props}
    >
      {icon}
    </div>
  );
}
