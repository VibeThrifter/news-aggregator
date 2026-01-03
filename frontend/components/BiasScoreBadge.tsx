"use client";

import { AlertTriangle, CheckCircle, Info, MinusCircle } from "lucide-react";

interface BiasScoreBadgeProps {
  /** Overall journalist rating from 0 (objective) to 1 (heavily biased) */
  rating: number;
  /** Number of journalist biases detected */
  biasCount?: number;
  /** Whether to show the count label */
  showCount?: boolean;
  /** Click handler for showing details */
  onClick?: () => void;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Get the rating category and styling based on the bias rating.
 * 0.0 - 0.2: Zeer objectief (green)
 * 0.2 - 0.4: Objectief (light green)
 * 0.4 - 0.6: Neutraal (yellow)
 * 0.6 - 0.8: Subjectief (orange)
 * 0.8 - 1.0: Sterk subjectief (red)
 */
function getRatingStyle(rating: number): {
  label: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
  icon: React.ReactNode;
} {
  if (rating <= 0.2) {
    return {
      label: "Zeer objectief",
      bgColor: "bg-green-50",
      textColor: "text-green-700",
      borderColor: "border-green-300",
      icon: <CheckCircle size={12} className="text-green-600" />,
    };
  } else if (rating <= 0.4) {
    return {
      label: "Objectief",
      bgColor: "bg-emerald-50",
      textColor: "text-emerald-700",
      borderColor: "border-emerald-300",
      icon: <CheckCircle size={12} className="text-emerald-600" />,
    };
  } else if (rating <= 0.6) {
    return {
      label: "Neutraal",
      bgColor: "bg-amber-50",
      textColor: "text-amber-700",
      borderColor: "border-amber-300",
      icon: <MinusCircle size={12} className="text-amber-600" />,
    };
  } else if (rating <= 0.8) {
    return {
      label: "Subjectief",
      bgColor: "bg-orange-50",
      textColor: "text-orange-700",
      borderColor: "border-orange-300",
      icon: <AlertTriangle size={12} className="text-orange-600" />,
    };
  } else {
    return {
      label: "Sterk subjectief",
      bgColor: "bg-red-50",
      textColor: "text-red-700",
      borderColor: "border-red-300",
      icon: <AlertTriangle size={12} className="text-red-600" />,
    };
  }
}

/**
 * Compact badge showing bias objectivity score.
 * Shows a color-coded badge with the objectivity rating.
 * Lower score = more objective (green), higher = more biased (red).
 */
export function BiasScoreBadge({
  rating,
  biasCount,
  showCount = false,
  onClick,
  className = "",
}: BiasScoreBadgeProps) {
  const style = getRatingStyle(rating);
  const percentage = Math.round((1 - rating) * 100);

  const baseClasses = `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${style.bgColor} ${style.textColor} ${style.borderColor}`;
  const clickableClasses = onClick
    ? "cursor-pointer hover:opacity-80 transition-opacity"
    : "";

  const content = (
    <>
      {style.icon}
      <span>{percentage}%</span>
      {showCount && biasCount !== undefined && biasCount > 0 && (
        <span className="text-[10px] opacity-75">({biasCount})</span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        }}
        className={`${baseClasses} ${clickableClasses} ${className}`}
        title={`${style.label} - Klik voor details`}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={`${baseClasses} ${className}`} title={style.label}>
      {content}
    </span>
  );
}

/**
 * Placeholder badge shown when bias analysis is not available.
 */
export function BiasScorePlaceholder({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-500 ${className}`}
      title="Bias analyse niet beschikbaar"
    >
      <Info size={12} />
      <span>—</span>
    </span>
  );
}
