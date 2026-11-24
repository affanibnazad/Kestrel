import React from "react";
import styles from "./Avatar.module.css";

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string;
  src?: string;
  size?: "sm" | "md" | "lg";
}

function getInitials(name: string): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  name,
  src,
  size = "md",
  className = "",
  ...props
}: AvatarProps) {
  const sizeClass = styles[size] || styles.md;
  const initials = getInitials(name);

  return (
    <div
      className={`${styles.avatar} ${sizeClass} ${className}`.trim()}
      aria-label={name}
      role="img"
      {...props}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className={styles.image} />
      ) : (
        <span className={styles.initials}>{initials}</span>
      )}
    </div>
  );
}
