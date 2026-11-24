import React from "react";

export interface ListGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const ListGroup: React.FC<ListGroupProps> = ({ className = "", children, ...props }) => {
  return (
    <div className={["u-list-group", className].filter(Boolean).join(" ")} {...props}>
      {children}
    </div>
  );
};

export interface ListRowProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  name: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  clickable?: boolean;
  onClick?: () => void;
}

export const ListRow: React.FC<ListRowProps> = ({
  icon,
  name,
  description,
  action,
  clickable = false,
  onClick,
  className = "",
  ...props
}) => {
  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        clickable && onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={["u-list-row", clickable ? "clickable" : "", className].filter(Boolean).join(" ")}
      {...props}
    >
      <div className="u-list-row-left">
        {icon && <span className="u-list-row-icon" aria-hidden="true">{icon}</span>}
        <div className="u-list-row-text">
          <span className="u-list-row-name">{name}</span>
          {description && <span className="u-list-row-desc">{description}</span>}
        </div>
      </div>
      {action && <div className="u-list-row-right">{action}</div>}
    </div>
  );
};
