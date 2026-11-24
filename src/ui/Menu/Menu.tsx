import React, { useState, useRef, useEffect } from "react";
import styles from "./Menu.module.css";

export interface MenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export interface MenuProps {
  trigger: React.ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
  className?: string;
}

export function Menu({
  trigger,
  items,
  align = "right",
  className = "",
}: MenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const alignClass = align === "left" ? styles.alignLeft : styles.alignRight;

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${className}`.trim()}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsOpen((prev) => !prev);
          }
        }}
        className={styles.triggerWrapper}
      >
        {trigger}
      </div>

      {isOpen && (
        <div
          role="menu"
          className={`${styles.dropdown} ${alignClass}`.trim()}
        >
          {items.map((item) => (
            <button
              key={item.id}
              role="menuitem"
              type="button"
              disabled={item.disabled}
              className={`${styles.item} ${item.danger ? styles.danger : ""}`.trim()}
              onClick={() => {
                if (item.disabled) return;
                setIsOpen(false);
                item.onClick?.();
              }}
            >
              {item.icon && <span className={styles.icon}>{item.icon}</span>}
              <span className={styles.label}>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
