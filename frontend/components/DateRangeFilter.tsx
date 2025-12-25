"use client";

interface DateRangeFilterProps {
  startDate: string | null;
  endDate: string | null;
  onStartDateChange: (value: string | null) => void;
  onEndDateChange: (value: string | null) => void;
  className?: string;
}

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
    <div className={`flex items-center gap-3 text-sm ${className}`}>
      <div className="flex items-center gap-1.5">
        <span className="text-ink-400">van</span>
        <input
          type="date"
          value={startDate ?? ""}
          max={endDate ?? today}
          onChange={(e) => onStartDateChange(e.target.value || null)}
          className="border-0 border-b border-paper-300 bg-transparent px-1 py-1 text-sm text-ink-700 transition-colors hover:border-ink-400 focus:border-accent-orange focus:outline-none"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-ink-400">tot</span>
        <input
          type="date"
          value={endDate ?? ""}
          min={startDate ?? undefined}
          max={today}
          onChange={(e) => onEndDateChange(e.target.value || null)}
          className="border-0 border-b border-paper-300 bg-transparent px-1 py-1 text-sm text-ink-700 transition-colors hover:border-ink-400 focus:border-accent-orange focus:outline-none"
        />
      </div>
    </div>
  );
}
