import React from "react";

export interface ListGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  children: React.ReactNode;
}

export const ListGroup: React.FC<ListGroupProps> = ({
  label,
  className = "",
  children,
  ...props
}) => {
  return (
    <>
      {label && <div className="u-group-label">{label}</div>}
      <div className={["u-group", "u-list-group", className].filter(Boolean).join(" ")} {...props}>
        {children}
      </div>
    </>
  );
};

ListGroup.displayName = "ListGroup";

export interface ListRowProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  name: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  washIndex?: 1 | 2 | 3 | 4 | 5 | 6;
  washColor?: "purple" | "blue" | "peach" | "green" | "pink" | "yellow";
  clickable?: boolean;
  onClick?: () => void;
}

export const ListRow: React.FC<ListRowProps> = ({
  icon,
  name,
  description,
  action,
  washIndex,
  washColor,
  clickable = false,
  onClick,
  className = "",
  ...props
}) => {
  const washClass = washIndex
    ? `u-wash-${washIndex} t${washIndex}`
    : washColor
    ? `u-wash-${washColor}`
    : "";

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
      className={[
        "u-row",
        "u-list-row",
        washClass,
        clickable ? "clickable" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {icon && (
        <span className="u-ico" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="u-txt">
        <div className="u-name">{name}</div>
        {description && <div className="u-desc">{description}</div>}
      </div>
      {action && <div className="u-list-row-action">{action}</div>}
    </div>
  );
};

ListRow.displayName = "ListRow";
