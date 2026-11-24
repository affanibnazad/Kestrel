import React from "react";

export interface NavItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  count?: number | string | null;
  href?: string;
  onClick?: () => void;
  ariaCurrent?: boolean;
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

export interface AppNavProps {
  brand?: {
    logo?: React.ReactNode;
    name?: string;
    onClick?: () => void;
  };
  sections?: NavSection[];
  items?: NavItem[];
  bottomItems?: NavItem[];
  user?: {
    avatar?: React.ReactNode;
    name: string;
    subtitle?: string;
    onClick?: () => void;
  };
  activeId: string;
  onSelect?: (id: string) => void;
  isOpen?: boolean;
  onClose?: () => void;
  className?: string;
}

export const AppNav: React.FC<AppNavProps> = ({
  brand = { name: "Kestrel", logo: "K" },
  sections,
  items,
  bottomItems,
  user,
  activeId,
  onSelect,
  isOpen,
  onClose,
  className = "",
}) => {
  const renderItem = (item: NavItem) => {
    const isActive = item.id === activeId;
    const isCurrent = item.ariaCurrent !== undefined ? item.ariaCurrent : isActive;
    const itemClasses = [
      "u-side-link",
      isActive ? "active" : "",
    ].filter(Boolean).join(" ");

    return (
      <a
        key={item.id}
        href={item.href ?? `#${item.id}`}
        className={itemClasses}
        aria-current={isCurrent ? "page" : undefined}
        title={item.label}
        data-tooltip={item.label}
        onClick={(e) => {
          if (!item.href || item.onClick || onSelect) {
            e.preventDefault();
          }
          if (item.onClick) {
            item.onClick();
          } else {
            onSelect?.(item.id);
          }
          onClose?.();
        }}
      >
        {item.icon}
        <span className="u-side-label">{item.label}</span>
        {item.count !== undefined && item.count !== null && item.count !== "" && (
          <span className="count u-count">{item.count}</span>
        )}
      </a>
    );
  };

  return (
    <aside className={["side", "u-side", isOpen ? "open" : "", className].filter(Boolean).join(" ")} aria-label="Menu">
      {brand && (
        <div
          className="brand u-brand"
          onClick={brand.onClick}
          style={{ cursor: brand.onClick ? "pointer" : "default" }}
        >
          <span className="logo u-logo">{brand.logo ?? "K"}</span>
          <span className="brand-text u-brand-text">{brand.name ?? "Kestrel"}</span>
          {onClose && (
            <button
              type="button"
              className="u-side-close"
              aria-label="Close menu"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      )}

      {sections ? (
        sections.map((sec, idx) => (
          <React.Fragment key={idx}>
            {sec.title && <div className="sec u-sec">{sec.title}</div>}
            {sec.items.map((item) => renderItem(item))}
          </React.Fragment>
        ))
      ) : (
        items?.map((item) => renderItem(item))
      )}

      <div className="spacer u-spacer" />

      {bottomItems && bottomItems.map((item) => renderItem(item))}

      {user && (
        <div
          className="user u-user"
          onClick={user.onClick}
          style={{ cursor: user.onClick ? "pointer" : "default" }}
          role={user.onClick ? "button" : undefined}
          tabIndex={user.onClick ? 0 : undefined}
          title={user.name}
          data-tooltip={user.name}
        >
          <span className="avatar u-avatar">{user.avatar ?? (user.name ? user.name[0].toUpperCase() : "A")}</span>
          <span className="who u-who">
            <span className="nm u-nm">{user.name}</span>
            {user.subtitle && <span className="pl u-pl">{user.subtitle}</span>}
          </span>
        </div>
      )}
    </aside>
  );
};

AppNav.displayName = "AppNav";

/* Reference 18px stroke 1.5 icons from docs/ui-reference/app-shell.html */
export const HomeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 11l8-7l8 7v9H4z" />
  </svg>
);

export const LeadsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
  </svg>
);

export const CampaignsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 12l16-8l-6 16l-3-7z" />
  </svg>
);

export const SequencesIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M18 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M8 6h6a4 4 0 0 1 0 8h-4a4 4 0 0 0 0 8h6" />
  </svg>
);

export const RepliesIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 13h4l2 3h4l2-3h4M4 13l2-8h12l2 8v6H4z" />
  </svg>
);

export const PipelineIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 20V10M10 20V4M16 20v-8M21 20H3" />
  </svg>
);

export const FindLeadsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0M20 20l-4-4" />
  </svg>
);

export const AiIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
  </svg>
);

export const TasksIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 11l2 2l4-4M5 4h14v16H5z" />
  </svg>
);

export const AnalyticsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 19h16M6 15l4-5l4 3l5-7" />
  </svg>
);

export const GuideIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4z" />
  </svg>
);

export const OwnerIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 8l4 4l4-7l4 7l4-4l-2 11H6z" />
  </svg>
);

export const SettingsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
  </svg>
);
