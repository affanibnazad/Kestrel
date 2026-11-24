import React from "react";
import styles from "./Row.module.css";

export interface RowProps extends React.HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
  interactive?: boolean;
  children: React.ReactNode;
}

export const Row = React.forwardRef<HTMLDivElement, RowProps>(function Row(
  { selected = false, interactive = false, className = "", children, ...props },
  ref
) {
  const selectedClass = selected ? styles.selected : "";
  const interactiveClass = interactive ? styles.interactive : "";
  const combinedClassName = `${styles.row} ${selectedClass} ${interactiveClass} ${className}`.trim();

  return (
    <div ref={ref} className={combinedClassName} {...props}>
      {children}
    </div>
  );
});
