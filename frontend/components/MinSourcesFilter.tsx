"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface MinSourcesFilterProps {
  value: number;
  onChange: (value: number) => void;
  className?: string;
}

export default function MinSourcesFilter({
  value,
  onChange,
  className = "",
}: MinSourcesFilterProps) {
  const [localValue, setLocalValue] = useState<string>(String(value));
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Sync local value with external value
  useEffect(() => {
    setLocalValue(String(value));
  }, [value]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const rawValue = e.target.value;

      // Allow empty string for typing
      if (rawValue === "") {
        setLocalValue("");
        return;
      }

      // Only allow digits
      if (!/^\d+$/.test(rawValue)) {
        return;
      }

      setLocalValue(rawValue);
      const numValue = Math.max(1, parseInt(rawValue, 10) || 1);

      // Debounce the onChange callback
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        onChange(numValue);
      }, 300);
    },
    [onChange],
  );

  const handleBlur = useCallback(() => {
    // On blur, ensure we have a valid value
    const numValue = Math.max(1, parseInt(localValue, 10) || 1);
    setLocalValue(String(numValue));
    onChange(numValue);
  }, [localValue, onChange]);

  const handleDecrement = useCallback(() => {
    const currentNum = parseInt(localValue, 10) || 1;
    const newValue = Math.max(1, currentNum - 1);
    setLocalValue(String(newValue));
    onChange(newValue);
  }, [localValue, onChange]);

  const handleIncrement = useCallback(() => {
    const currentNum = parseInt(localValue, 10) || 1;
    const newValue = currentNum + 1;
    setLocalValue(String(newValue));
    onChange(newValue);
  }, [localValue, onChange]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <label
        htmlFor="min-sources"
        className="whitespace-nowrap text-sm text-slate-400"
      >
        Min. bronnen:
      </label>
      <div className="flex items-center">
        <button
          type="button"
          onClick={handleDecrement}
          disabled={(parseInt(localValue, 10) || 1) <= 1}
          className="flex h-9 w-9 items-center justify-center rounded-l-full border border-r-0 border-slate-600 bg-slate-800/50 text-slate-300 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Verlaag minimum aantal bronnen"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M20 12H4"
            />
          </svg>
        </button>
        <input
          ref={inputRef}
          id="min-sources"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={localValue}
          onChange={handleChange}
          onBlur={handleBlur}
          className="h-9 w-12 border-y border-slate-600 bg-slate-800/50 text-center text-sm text-slate-100 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          aria-label="Minimum aantal bronnen"
        />
        <button
          type="button"
          onClick={handleIncrement}
          className="flex h-9 w-9 items-center justify-center rounded-r-full border border-l-0 border-slate-600 bg-slate-800/50 text-slate-300 transition-colors hover:bg-slate-700"
          aria-label="Verhoog minimum aantal bronnen"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
