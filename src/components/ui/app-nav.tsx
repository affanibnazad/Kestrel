import React from "react";

export interface NavItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  href?: string;
}

export interface AppNavProps {
  items: NavItem[];
  activeId: string;
  onSelect?: (id: string) => void;
  className?: string;
}

export const AppNav: React.FC<AppNavProps> = ({
  items,
  activeId,
  onSelect,
  className = "",
}) => {
  return (
    <nav className={["u-app-nav", className].filter(Boolean).join(" ")} aria-label="App navigation">
      {items.map((item) => {
        const isActive = item.id === activeId;
        const itemClass = ["u-nav-item", isActive ? "active" : ""].filter(Boolean).join(" ");

        if (item.href) {
          return (
            <a
              key={item.id}
              href={item.href}
              className={itemClass}
              aria-current={isActive ? "page" : undefined}
            >
              {item.icon && <span aria-hidden="true">{item.icon}</span>}
              <span>{item.label}</span>
            </a>
          );
        }

        return (
          <button
            key={item.id}
            type="button"
            className={itemClass}
            aria-current={isActive ? "page" : undefined}
            onClick={() => onSelect?.(item.id)}
          >
            {item.icon && <span aria-hidden="true">{item.icon}</span>}
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
