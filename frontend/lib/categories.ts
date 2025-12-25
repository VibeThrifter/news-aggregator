/**
 * Category configuration for event filtering.
 *
 * Maps backend event_type values to Dutch UI labels and colors.
 * Based on classification categories from backend/app/nlp/classify.py
 */

export interface CategoryConfig {
  slug: string;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

/**
 * All available categories for filtering.
 * Order determines display order in the navigation.
 * Light theme colors for Volkskrant-style design.
 */
export const CATEGORIES: CategoryConfig[] = [
  {
    slug: "all",
    label: "Alles",
    color: "text-ink-700",
    bgColor: "bg-paper-200",
    borderColor: "border-paper-300",
  },
  {
    slug: "politics",
    label: "Politiek",
    color: "text-blue-700",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
  },
  {
    slug: "international",
    label: "Buitenland",
    color: "text-purple-700",
    bgColor: "bg-purple-50",
    borderColor: "border-purple-200",
  },
  {
    slug: "crime",
    label: "Misdaad",
    color: "text-red-700",
    bgColor: "bg-red-50",
    borderColor: "border-red-200",
  },
  {
    slug: "sports",
    label: "Sport",
    color: "text-green-700",
    bgColor: "bg-green-50",
    borderColor: "border-green-200",
  },
  {
    slug: "entertainment",
    label: "Cultuur",
    color: "text-pink-700",
    bgColor: "bg-pink-50",
    borderColor: "border-pink-200",
  },
  {
    slug: "business",
    label: "Economie",
    color: "text-amber-700",
    bgColor: "bg-amber-50",
    borderColor: "border-amber-200",
  },
  {
    slug: "legal",
    label: "Rechtszaken",
    color: "text-orange-700",
    bgColor: "bg-orange-50",
    borderColor: "border-orange-200",
  },
  {
    slug: "weather",
    label: "Weer",
    color: "text-cyan-700",
    bgColor: "bg-cyan-50",
    borderColor: "border-cyan-200",
  },
  {
    slug: "other",
    label: "Overig",
    color: "text-ink-600",
    bgColor: "bg-paper-100",
    borderColor: "border-paper-300",
  },
];

/**
 * Lookup map for quick category retrieval by slug.
 */
export const CATEGORY_BY_SLUG: Record<string, CategoryConfig> = Object.fromEntries(
  CATEGORIES.map((cat) => [cat.slug, cat]),
);

/**
 * Get category config by slug, with fallback to "other".
 */
export function getCategoryBySlug(slug: string | null | undefined): CategoryConfig {
  if (!slug || slug === "all") {
    return CATEGORY_BY_SLUG["all"];
  }
  return CATEGORY_BY_SLUG[slug] ?? CATEGORY_BY_SLUG["other"];
}

/**
 * Legacy event types that map to other categories.
 */
const LEGACY_TYPE_MAPPING: Record<string, string> = {
  royal: "entertainment",
};

/**
 * Get category config for an event_type value from the backend.
 */
export function getCategoryForEventType(eventType: string | null | undefined): CategoryConfig {
  if (!eventType) {
    return CATEGORY_BY_SLUG["other"];
  }
  const mappedType = LEGACY_TYPE_MAPPING[eventType] ?? eventType;
  return CATEGORY_BY_SLUG[mappedType] ?? CATEGORY_BY_SLUG["other"];
}

/**
 * Get the Dutch label for an event type.
 */
export function getCategoryLabel(eventType: string | null | undefined): string {
  return getCategoryForEventType(eventType).label;
}

/**
 * Get Tailwind classes for a category badge.
 */
export function getCategoryBadgeClasses(eventType: string | null | undefined): string {
  const cat = getCategoryForEventType(eventType);
  return `${cat.color} ${cat.bgColor} ${cat.borderColor}`;
}

/**
 * Filter categories that should be shown in navigation.
 * Excludes "all" from the filter list (it's handled separately).
 */
export const FILTERABLE_CATEGORIES = CATEGORIES.filter((cat) => cat.slug !== "all");

/**
 * Default category (shows all events).
 */
export const DEFAULT_CATEGORY = "all";
