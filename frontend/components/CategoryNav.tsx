"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { CATEGORIES, DEFAULT_CATEGORY, getCategoryBySlug } from "@/lib/categories";

export interface CategoryNavProps {
  activeCategory?: string;
  onCategoryChange?: (category: string) => void;
}

export function CategoryNav({ activeCategory, onCategoryChange }: CategoryNavProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);

  // Get current category from URL or props
  const currentCategory =
    activeCategory ?? searchParams.get("category") ?? DEFAULT_CATEGORY;

  // Scroll active tab into view on mount/change
  useEffect(() => {
    if (activeTabRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const tab = activeTabRef.current;

      // Calculate scroll position to center the active tab
      const containerWidth = container.offsetWidth;
      const tabLeft = tab.offsetLeft;
      const tabWidth = tab.offsetWidth;
      const scrollLeft = tabLeft - containerWidth / 2 + tabWidth / 2;

      container.scrollTo({
        left: Math.max(0, scrollLeft),
        behavior: "smooth",
      });
    }
  }, [currentCategory]);

  const handleCategoryClick = useCallback(
    (slug: string) => {
      // Update URL with new category
      const params = new URLSearchParams(searchParams.toString());
      if (slug === DEFAULT_CATEGORY) {
        params.delete("category");
      } else {
        params.set("category", slug);
      }

      const newUrl = params.toString() ? `?${params.toString()}` : "/";
      router.push(newUrl, { scroll: false });

      // Call external handler if provided
      onCategoryChange?.(slug);
    },
    [router, searchParams, onCategoryChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const currentIndex = CATEGORIES.findIndex((c) => c.slug === currentCategory);
      let newIndex = currentIndex;

      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          newIndex = (currentIndex + 1) % CATEGORIES.length;
          break;
        case "ArrowLeft":
          e.preventDefault();
          newIndex = currentIndex === 0 ? CATEGORIES.length - 1 : currentIndex - 1;
          break;
        case "Home":
          e.preventDefault();
          newIndex = 0;
          break;
        case "End":
          e.preventDefault();
          newIndex = CATEGORIES.length - 1;
          break;
        default:
          return;
      }

      if (newIndex !== currentIndex) {
        handleCategoryClick(CATEGORIES[newIndex].slug);
      }
    },
    [currentCategory, handleCategoryClick],
  );

  return (
    <nav
      aria-label="Categoriefilter"
      className="sticky top-0 z-10 -mx-4 bg-slate-900/95 backdrop-blur-sm sm:-mx-6 lg:-mx-8"
    >
      {/* Fade edges for scroll indication on mobile */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-slate-900 to-transparent sm:hidden" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-slate-900 to-transparent sm:hidden" />

      <div
        ref={scrollContainerRef}
        className="scrollbar-hide flex items-center gap-1 overflow-x-auto px-4 py-3 sm:justify-center sm:gap-2 sm:px-6 lg:px-8"
        style={{ WebkitOverflowScrolling: "touch" }}
        role="tablist"
        aria-label="Categoriefilter"
        onKeyDown={handleKeyDown}
      >
        {CATEGORIES.map((category, index) => {
          const isActive = currentCategory === category.slug;
          const categoryConfig = getCategoryBySlug(category.slug);

          return (
            <button
              key={category.slug}
              ref={isActive ? activeTabRef : null}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls="event-feed"
              tabIndex={isActive ? 0 : -1}
              onClick={() => handleCategoryClick(category.slug)}
              className={`
                relative flex-shrink-0 whitespace-nowrap rounded-full px-4 py-2
                text-sm font-medium transition-all duration-200
                focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900
                ${
                  isActive
                    ? "bg-brand-600 text-white shadow-md"
                    : "text-slate-300 hover:bg-slate-800 hover:text-slate-100"
                }
              `}
            >
              {category.label}
              {/* Active indicator underline */}
              {isActive && (
                <span
                  className="absolute bottom-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-white/60"
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default CategoryNav;
