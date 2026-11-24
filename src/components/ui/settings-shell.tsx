import React from "react";

export interface SettingsMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  group?: string;
  href?: string;
}

export interface SettingsShellProps {
  items: SettingsMenuItem[];
  activeId: string;
  onSelect: (id: string) => void;
  menuTitle?: string;
  children: React.ReactNode;
  className?: string;
}

export const SettingsShell: React.FC<SettingsShellProps> = ({
  items,
  activeId,
  onSelect,
  menuTitle = "Settings",
  children,
  className = "",
}) => {
  return (
    <div className={["u-shell", "shell", className].filter(Boolean).join(" ")}>
      <nav className="u-menu menu" aria-label="Settings">
        {menuTitle && <div className="u-menu-label menu-label">{menuTitle}</div>}
        {items.map((item) => {
          const isActive = item.id === activeId;
          const ariaCurrent = isActive ? "page" : undefined;
          const classes = [
            "u-menu-item",
            isActive ? "active" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <a
              key={item.id}
              href={item.href ?? `#${item.id}`}
              className={classes}
              aria-current={ariaCurrent}
              onClick={(e) => {
                e.preventDefault();
                onSelect(item.id);
              }}
            >
              {item.icon && <span className="u-menu-icon" aria-hidden="true">{item.icon}</span>}
              <span>{item.label}</span>
            </a>
          );
        })}
      </nav>
      <main className="u-content content">{children}</main>
    </div>
  );
};

SettingsShell.displayName = "SettingsShell";
