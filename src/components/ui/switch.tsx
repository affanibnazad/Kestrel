import React from "react";

export interface SwitchProps {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
  "aria-label"?: string;
}

export const Switch: React.FC<SwitchProps> = ({
  id,
  checked,
  onChange,
  disabled = false,
  label,
  className = "",
  "aria-label": ariaLabel,
}) => {
  const inputId = id || (label ? `u-switch-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);

  return (
    <label
      htmlFor={inputId}
      className={["u-switch-wrap", disabled ? "disabled" : "", className].filter(Boolean).join(" ")}
    >
      <input
        type="checkbox"
        id={inputId}
        role="switch"
        className="u-switch-input"
        checked={checked}
        disabled={disabled}
        aria-checked={checked}
        aria-label={ariaLabel || label}
        onChange={(e) => !disabled && onChange(e.target.checked)}
      />
      <span className={["u-switch-track", checked ? "on" : ""].filter(Boolean).join(" ")} aria-hidden="true">
        <span className="u-switch-thumb" />
      </span>
      {label && <span className="u-switch-label">{label}</span>}
    </label>
  );
};
