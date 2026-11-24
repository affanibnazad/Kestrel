import React from "react";

export interface SettingsMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  group?: string;
}

export interface SettingsShellProps {
  items: SettingsMenuItem[];
  activeId: string;
  onSelect: (id: string) => void;
  children: React.ReactNode;
  className?: string;
}

export const SettingsShell: React.FC<SettingsShellProps> = ({
  items,
  activeId,
  onSelect,
  children,
  className = "",
}) => {
  // Group items by their group property if present
  const groups = items.reduce<Record<string, SettingsMenuItem[]>>((acc, item) => {
    const key = item.group || "Settings";
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const groupKeys = Object.keys(groups);

  return (
    <div className={["u-settings-shell", className].filter(Boolean).join(" ")}>
      <nav className="u-settings-menu" aria-label="Settings navigation">
        {groupKeys.map((group) => (
          <div key={group} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            {groupKeys.length > 1 && (
              <span className="u-settings-group-title">{group}</span>
            )}
            {groups[group].map((item) => {
              const isActive = item.id === activeId;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={["u-settings-item", isActive ? "active" : ""].filter(Boolean).join(" ")}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => onSelect(item.id)}
                >
                  {item.icon && <span aria-hidden="true">{item.icon}</span>}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <main className="u-settings-content">{children}</main>
    </div>
  );
};
