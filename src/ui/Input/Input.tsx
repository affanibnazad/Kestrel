import React from "react";
import styles from "./Input.module.css";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { error, className = "", ...props },
  ref
) {
  const errorClass = error ? styles.error : "";
  const combinedClassName = `${styles.input} ${errorClass} ${className}`.trim();

  return <input ref={ref} className={combinedClassName} {...props} />;
});
