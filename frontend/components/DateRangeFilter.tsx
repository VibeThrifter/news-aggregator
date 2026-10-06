"use client";

import { CalendarDays } from "lucide-react";

interface DateRangeFilterProps {
  startDate: string | null;
  endDate: string | null;
  onStartDateChange: (value: string | null) => void;
  onEndDateChange: (value: string | null) => void;
  className?: string;
}

const DATE_INPUT =
  "min-w-0 bg-transparent text-base text-ink-800 [color-scheme:light] focus:outline-none sm:text-sm [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-50";

/** The period of the feed: one pill with a from and a to date. */
export default function DateRangeFilter({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  className = "",
}: DateRangeFilterProps) {
  // Get today's date in YYYY-MM-DD format for max attribute
  const today = new Date().toISOString().split("T")[0];

  return (
    <div
      role="group"
      aria-label="Periode"
      className={`inline-flex min-h-[40px] items-center gap-2 rounded-full border border-paper-300 bg-paper-50 pl-3.5 pr-3 text-sm ${className}`}
    >
      <CalendarDays size={16} className="shrink-0 text-ink-400" aria-hidden="true" />
      <input
        type="date"
        aria-label="Van"
        value={startDate ?? ""}
        max={endDate ?? today}
        onChange={(e) => onStartDateChange(e.target.value || null)}
        className={DATE_INPUT}
      />
      <span aria-hidden="true" className="text-ink-300">
        –
      </span>
      <input
        type="date"
        aria-label="Tot"
        value={endDate ?? ""}
        min={startDate ?? undefined}
        max={today}
        onChange={(e) => onEndDateChange(e.target.value || null)}
        className={DATE_INPUT}
      />
    </div>
  );
}
