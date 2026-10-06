"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { CATEGORIES, DEFAULT_CATEGORY } from "@/lib/categories";

import { ScrollRow } from "./explore/ui/ScrollRow";

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
    <nav aria-label="Categoriefilter" className="sticky top-0 z-40 -mx-4 bg-paper-100/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
      <ScrollRow
        ref={scrollContainerRef}
        role="tablist"
        aria-label="Categoriefilter"
        onKeyDown={handleKeyDown}
        className="-mx-1 px-1"
      >
        {/* Centred while everything fits; the auto margins give way when the row scrolls */}
        <div className="mx-auto flex gap-1.5">
          {CATEGORIES.map((category) => {
            const isActive = currentCategory === category.slug;

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
                className={`min-h-[40px] shrink-0 whitespace-nowrap rounded-full border px-4 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue ${
                  isActive ? "border-ink-900 bg-ink-900 text-white" : "border-paper-300 bg-paper-50 text-ink-700 hover:bg-paper-200"
                }`}
              >
                {category.label}
              </button>
            );
          })}
        </div>
      </ScrollRow>
    </nav>
  );
}

export default CategoryNav;
