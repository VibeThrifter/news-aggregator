"use client";

import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

import { getSourceFaviconUrl } from "@/lib/format";

/** Outlet or domain favicon with a letter fallback. */
export function Favicon({ name, domain, size = 20, className = "" }: { name: string; domain?: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : getSourceFaviconUrl(name);
  if (failed) {
    return (
      <span
        aria-hidden="true"
        className={`inline-flex shrink-0 items-center justify-center rounded-sm bg-paper-300 font-bold text-ink-600 ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.55 }}
      >
        {name.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-sm object-contain ${className}`}
      // Fixed size: Tailwind's `img { height: auto }` would let a flex row stretch the icon
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}

type ChipTone = "neutral" | "blue" | "red" | "orange" | "green" | "purple";

const CHIP_TONES: Record<ChipTone, string> = {
  neutral: "border-paper-300 bg-paper-100 text-ink-700",
  blue: "border-blue-200 bg-blue-50 text-blue-800",
  red: "border-red-200 bg-red-50 text-red-800",
  orange: "border-orange-200 bg-orange-50 text-orange-800",
  green: "border-emerald-200 bg-emerald-50 text-emerald-800",
  purple: "border-purple-200 bg-purple-50 text-purple-800",
};

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ChipTone;
  icon?: ReactNode;
  /** Colored dot (e.g. a propaganda filter color) */
  dot?: string;
}

/** Clickable chip for click-through links (44px hit area via padding on the button). */
export function Chip({ tone = "neutral", icon, dot, children, className = "", ...rest }: ChipProps) {
  return (
    <button
      type="button"
      className={`group inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue ${CHIP_TONES[tone]} ${className}`}
      {...rest}
    >
      {dot ? <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dot }} /> : null}
      {icon}
      <span className="truncate">{children}</span>
    </button>
  );
}

/** Non-interactive label. */
export function Tag({ tone = "neutral", children, className = "" }: { tone?: ChipTone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${CHIP_TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}

/** Circular progress (revealed / total). */
export function ProgressRing({
  value,
  total,
  size = 36,
  stroke = 4,
  color = "#1F75CE",
  label,
}: {
  value: number;
  total: number;
  size?: number;
  stroke?: number;
  color?: string;
  label?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = total > 0 ? Math.min(1, value / total) : 0;
  const complete = total > 0 && value >= total;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? `${value} van ${total} ontdekt`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#eeeeee" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={complete ? "#10b981" : color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 400ms ease" }}
        />
      </svg>
      <span aria-hidden="true" className="absolute text-[10px] font-bold text-ink-700">
        {complete ? "✓" : total > 0 ? `${value}/${total}` : "–"}
      </span>
    </span>
  );
}

/** A white pill for navigation and actions ("← Nieuws", "Bewaard", "Netwerk"). */
export const PILL =
  "inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-paper-300 bg-paper-50 px-3.5 text-sm font-semibold text-ink-800 transition-colors hover:bg-paper-200";

/** Heading of a part inside a sheet, balloon or card: serif like "Wie zegt wat?", one size smaller. */
export function SubHeading({ children, className = "", tone = "text-ink-900" }: { children: ReactNode; className?: string; tone?: string }) {
  return <p className={`font-serif text-[15px] font-bold leading-snug ${tone} ${className}`}>{children}</p>;
}
