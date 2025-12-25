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
    <div className={`flex items-center gap-2 text-sm ${className}`}>
      <span className="text-ink-400">min. bronnen</span>
      <div className="flex items-center">
        <button
          type="button"
          onClick={handleDecrement}
          disabled={(parseInt(localValue, 10) || 1) <= 1}
          className="flex h-7 w-7 items-center justify-center text-ink-400 transition-colors hover:text-ink-700 disabled:opacity-30"
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
          className="w-8 border-0 border-b border-paper-300 bg-transparent py-1 text-center text-sm text-ink-700 transition-colors focus:border-accent-orange focus:outline-none"
          aria-label="Minimum aantal bronnen"
        />
        <button
          type="button"
          onClick={handleIncrement}
          className="flex h-7 w-7 items-center justify-center text-ink-400 transition-colors hover:text-ink-700"
          aria-label="Verhoog minimum aantal bronnen"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}
