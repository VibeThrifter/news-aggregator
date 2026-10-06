"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export default function SearchBar({
  value,
  onChange,
  placeholder = "Zoek events...",
  className = "",
}: SearchBarProps) {
  const [localValue, setLocalValue] = useState(value);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Sync local value with external value
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setLocalValue(newValue);

      // Debounce the onChange callback
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        onChange(newValue);
      }, 200);
    },
    [onChange],
  );

  const handleClear = useCallback(() => {
    setLocalValue("");
    onChange("");
    inputRef.current?.focus();
  }, [onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        handleClear();
      }
    },
    [handleClear],
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return (
    <div className={`relative ${className}`}>
      <Search
        size={17}
        aria-hidden="true"
        className={`pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 transition-colors ${isFocused ? "text-ink-700" : "text-ink-400"}`}
      />
      <input
        ref={inputRef}
        type="text"
        value={localValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={placeholder}
        className="h-10 w-full rounded-full border border-paper-300 bg-paper-50 pl-10 pr-9 text-base text-ink-900 placeholder-ink-400 transition-colors hover:border-ink-200 focus:border-ink-400 focus:outline-none sm:text-sm"
        aria-label="Zoek events"
      />
      {localValue ? (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-paper-200 hover:text-ink-700"
          aria-label="Wis zoekopdracht"
        >
          <X size={15} />
        </button>
      ) : null}
    </div>
  );
}
