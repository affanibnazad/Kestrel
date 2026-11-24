import React from "react";
import { Check } from "lucide-react";
import styles from "./Checkbox.module.css";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: React.ReactNode;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ label, className = "", id, checked, ...props }, ref) {
    const defaultId = React.useId();
    const inputId = id || defaultId;

    return (
      <label
        htmlFor={inputId}
        className={`${styles.wrapper} ${className}`.trim()}
      >
        <span className={styles.box}>
          <input
            ref={ref}
            id={inputId}
            type="checkbox"
            checked={checked}
            className={styles.input}
            {...props}
          />
          <span className={styles.customBox}>
            <Check className={styles.checkIcon} size={12} strokeWidth={3} />
          </span>
        </span>
        {label && <span className={styles.label}>{label}</span>}
      </label>
    );
  }
);
