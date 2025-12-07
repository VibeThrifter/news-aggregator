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
    <div className={`flex items-center gap-2 ${className}`}>
      <label className="whitespace-nowrap text-sm text-slate-400">
        Van:
      </label>
      <input
        type="date"
        value={startDate ?? ""}
        max={endDate ?? today}
        onChange={(e) => onStartDateChange(e.target.value || null)}
        className="h-9 rounded-full border border-slate-600 bg-slate-800/50 px-3 text-sm text-slate-100 transition-colors hover:bg-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      />
      <label className="whitespace-nowrap text-sm text-slate-400">
        Tot:
      </label>
      <input
        type="date"
        value={endDate ?? ""}
        min={startDate ?? undefined}
        max={today}
        onChange={(e) => onEndDateChange(e.target.value || null)}
        className="h-9 rounded-full border border-slate-600 bg-slate-800/50 px-3 text-sm text-slate-100 transition-colors hover:bg-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      />
    </div>
  );
}
