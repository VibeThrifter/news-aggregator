"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";

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
    <div
      className={`inline-flex min-h-[40px] items-center gap-1 rounded-full border border-paper-300 bg-paper-50 pl-3.5 pr-1 text-sm ${className}`}
    >
      <label htmlFor="min-sources" className="whitespace-nowrap text-ink-500">
        Min. bronnen
      </label>
      <button
        type="button"
        onClick={handleDecrement}
        disabled={(parseInt(localValue, 10) || 1) <= 1}
        className="flex h-8 w-8 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-paper-200 hover:text-ink-900 disabled:opacity-30 disabled:hover:bg-transparent"
        aria-label="Verlaag minimum aantal bronnen"
      >
        <Minus size={14} />
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
        className="w-6 bg-transparent text-center text-base font-semibold text-ink-900 focus:outline-none sm:text-sm"
        aria-label="Minimum aantal bronnen"
      />
      <button
        type="button"
        onClick={handleIncrement}
        className="flex h-8 w-8 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-paper-200 hover:text-ink-900"
        aria-label="Verhoog minimum aantal bronnen"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
