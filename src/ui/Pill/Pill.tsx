import React from "react";
import styles from "./Pill.module.css";

export type PillVariant =
  | "positive"
  | "active"
  | "good"
  | "maybe"
  | "no"
  | "review"
  | "info"
  | "neutral";

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: PillVariant;
  dot?: boolean;
  children: React.ReactNode;
}

export function Pill({
  variant = "neutral",
  dot = true,
  className = "",
  children,
  ...props
}: PillProps) {
  const variantClass = styles[variant] || styles.neutral;
  const combinedClassName = `${styles.pill} ${variantClass} ${className}`.trim();

  return (
    <span className={combinedClassName} {...props}>
      {dot && <span className={styles.dot} aria-hidden="true" />}
      <span className={styles.label}>{children}</span>
    </span>
  );
}

export const StatusPill = Pill;
