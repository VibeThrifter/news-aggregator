"use client";

interface DaysBackFilterProps {
  value: number;
  onChange: (value: number) => void;
  className?: string;
}

const OPTIONS = [
  { value: 1, label: "Vandaag" },
  { value: 3, label: "3 dagen" },
  { value: 7, label: "7 dagen" },
  { value: 14, label: "14 dagen" },
  { value: 30, label: "30 dagen" },
];

export default function DaysBackFilter({
  value,
  onChange,
  className = "",
}: DaysBackFilterProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <label
        htmlFor="days-back"
        className="whitespace-nowrap text-sm text-slate-400"
      >
        Periode:
      </label>
      <select
        id="days-back"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-9 rounded-full border border-slate-600 bg-slate-800/50 px-3 text-sm text-slate-100 transition-colors hover:bg-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
