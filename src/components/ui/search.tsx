import React from "react";
import { Search as SearchIcon, X as ClearIcon } from "lucide-react";

export interface SearchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  onClear?: () => void;
}

export const Search = React.forwardRef<HTMLInputElement, SearchProps>(
  ({ className = "", value, onChange, onClear, placeholder = "Search...", ...props }, ref) => {
    const hasValue = Boolean(value && String(value).length > 0);

    return (
      <div className={["u-search-wrap", className].filter(Boolean).join(" ")}>
        <span className="u-search-icon" aria-hidden="true">
          <SearchIcon size={18} strokeWidth={1.5} />
        </span>
        <input
          ref={ref}
          type="search"
          role="searchbox"
          className="u-search-input"
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          {...props}
        />
        {hasValue && onClear && (
          <button
            type="button"
            className="u-search-clear"
            onClick={onClear}
            aria-label="Clear search"
          >
            <ClearIcon size={16} strokeWidth={1.5} />
          </button>
        )}
      </div>
    );
  }
);

Search.displayName = "Search";
