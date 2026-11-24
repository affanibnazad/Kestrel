import React, { useState } from "react";
import styles from "./Tooltip.module.css";

export interface TooltipProps {
  content: React.ReactNode;
  position?: "top" | "bottom";
  children: React.ReactNode;
  className?: string;
}

export function Tooltip({
  content,
  position = "top",
  children,
  className = "",
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const posClass = position === "bottom" ? styles.bottom : styles.top;

  return (
    <div
      className={`${styles.wrapper} ${className}`.trim()}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      onFocus={() => setIsVisible(true)}
      onBlur={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <div role="tooltip" className={`${styles.bubble} ${posClass}`.trim()}>
          {content}
        </div>
      )}
    </div>
  );
}
