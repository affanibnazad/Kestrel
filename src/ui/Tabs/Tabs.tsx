import React from "react";
import styles from "./Tabs.module.css";

export interface TabItem {
  id: string;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  ariaLabel?: string;
}

export function Tabs({
  items,
  value,
  onChange,
  className = "",
  ariaLabel = "Tabs",
}: TabsProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`${styles.tablist} ${className}`.trim()}
    >
      {items.map((tab) => {
        const isActive = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`${styles.tab} ${isActive ? styles.active : ""}`.trim()}
            onClick={() => onChange(tab.id)}
          >
            {tab.icon && <span className={styles.icon}>{tab.icon}</span>}
            <span className={styles.label}>{tab.label}</span>
            {typeof tab.count === "number" && (
              <span
                className={`${styles.count} ${isActive ? styles.countActive : ""}`.trim()}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
