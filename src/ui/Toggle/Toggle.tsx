import React from "react";
import styles from "./Toggle.module.css";

export interface ToggleProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: React.ReactNode;
}

export const Toggle = React.forwardRef<HTMLInputElement, ToggleProps>(
  function Toggle({ label, className = "", id, checked, ...props }, ref) {
    const defaultId = React.useId();
    const inputId = id || defaultId;

    return (
      <label
        htmlFor={inputId}
        className={`${styles.wrapper} ${className}`.trim()}
      >
        <span className={styles.switch}>
          <input
            ref={ref}
            id={inputId}
            type="checkbox"
            checked={checked}
            className={styles.input}
            {...props}
          />
          <span className={styles.track}>
            <span className={styles.thumb} />
          </span>
        </span>
        {label && <span className={styles.label}>{label}</span>}
      </label>
    );
  }
);
