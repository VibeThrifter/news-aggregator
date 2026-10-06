"use client";

import { forwardRef, useCallback, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const FADES = {
  "paper-50": "from-paper-50",
  "paper-100": "from-paper-100",
} as const;

interface ScrollRowProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Background behind the row, for the fade at the edges */
  fade?: keyof typeof FADES;
}

/**
 * A row of chips or tabs that scrolls sideways without a scrollbar. Where more is hidden the edge
 * fades out; on desktop a round arrow there scrolls on.
 */
export const ScrollRow = forwardRef<HTMLDivElement, ScrollRowProps>(function ScrollRow(
  { children, fade = "paper-100", className = "", ...rest },
  forwardedRef,
) {
  const strip = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const element = strip.current;
    if (!element) return;
    const left = element.scrollLeft > 2;
    const right = element.scrollLeft + element.clientWidth < element.scrollWidth - 2;
    setEdges((current) => (current.left === left && current.right === right ? current : { left, right }));
  }, []);

  // Children come and go (chips toggled, tabs appearing): measure after every render
  useEffect(measure);
  useEffect(() => {
    const element = strip.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);

  const setRef = (node: HTMLDivElement | null) => {
    strip.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };

  const scrollBy = (direction: -1 | 1) => {
    const element = strip.current;
    if (element) element.scrollBy({ left: direction * Math.max(160, element.clientWidth * 0.7), behavior: "smooth" });
  };

  const edge = (side: "left" | "right") => (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-y-0 ${side === "left" ? "left-0 bg-gradient-to-r" : "right-0 bg-gradient-to-l"} ${FADES[fade]} flex w-14 items-center to-transparent ${
        side === "left" ? "justify-start" : "justify-end"
      }`}
    >
      <button
        type="button"
        tabIndex={-1}
        onClick={() => scrollBy(side === "left" ? -1 : 1)}
        className="pointer-events-auto hidden h-8 w-8 items-center justify-center rounded-full border border-paper-300 bg-paper-50 text-ink-700 shadow-card-light hover:bg-paper-100 [@media(hover:hover)_and_(pointer:fine)]:flex"
      >
        {side === "left" ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
      </button>
    </div>
  );

  return (
    <div className="relative min-w-0">
      <div ref={setRef} onScroll={measure} className={`scrollbar-hide flex overflow-x-auto ${className}`} {...rest}>
        {children}
      </div>
      {edges.left ? edge("left") : null}
      {edges.right ? edge("right") : null}
    </div>
  );
});
