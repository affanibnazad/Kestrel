import React from "react";
import { Search as SearchIcon } from "lucide-react";
import styles from "./Search.module.css";

export interface SearchProps extends React.InputHTMLAttributes<HTMLInputElement> {
  onClear?: () => void;
}

export const Search = React.forwardRef<HTMLInputElement, SearchProps>(function Search(
  { className = "", ...props },
  ref
) {
  return (
    <div className={`${styles.container} ${className}`.trim()}>
      <SearchIcon className={styles.icon} size={18} aria-hidden="true" />
      <input
        ref={ref}
        type="search"
        className={styles.input}
        {...props}
      />
    </div>
  );
});
