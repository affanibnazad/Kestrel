import React from "react";
import styles from "./Card.module.css";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { className = "", children, ...props },
  ref
) {
  return (
    <div ref={ref} className={`${styles.card} ${className}`.trim()} {...props}>
      {children}
    </div>
  );
});
