"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  FloatingArrow,
  FloatingFocusManager,
  FloatingPortal,
  arrow,
  autoUpdate,
  flip,
  offset,
  safePolygon,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useHover,
  useInteractions,
  useRole,
  type Placement,
} from "@floating-ui/react";
import { AnimatePresence, motion } from "framer-motion";

import { useFinePointer } from "@/lib/explore/hooks";

import { usePortalRoot } from "./portal-root";

export interface BalloonTriggerProps {
  ref: (node: HTMLElement | null) => void;
  props: Record<string, unknown>;
  open: boolean;
}

export interface BalloonProps {
  /** Accessible name of the balloon dialog */
  label: string;
  content: ReactNode | ((close: () => void) => ReactNode);
  children: (trigger: BalloonTriggerProps) => ReactNode;
  placement?: Placement;
  /** Preview on hover for fine pointers (desktop) */
  hover?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  width?: number;
}

/**
 * Speech-balloon popover with an arrow ("tekstballon"). Tap/click toggles; on desktop it can also
 * preview on hover. Stays inside the viewport and scrolls internally when long.
 */
export function Balloon({ label, content, children, placement = "top", hover = false, open: controlledOpen, onOpenChange, width = 300 }: BalloonProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const arrowRef = useRef<SVGSVGElement | null>(null);
  const finePointer = useFinePointer();
  const portalRoot = usePortalRoot();

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(12),
      flip({ padding: 12 }),
      shift({ padding: 12 }),
      size({
        padding: 12,
        apply({ availableHeight, availableWidth, elements }) {
          elements.floating.style.maxHeight = `${Math.max(160, Math.min(availableHeight, 520))}px`;
          elements.floating.style.maxWidth = `${Math.min(width, availableWidth)}px`;
        },
      }),
      arrow({ element: arrowRef }),
    ],
  });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useHover(context, { enabled: hover && finePointer, delay: { open: 120, close: 80 }, handleClose: safePolygon() }),
    useDismiss(context),
    useRole(context, { role: "dialog" }),
  ]);

  const close = () => setOpen(false);

  return (
    <>
      {children({ ref: refs.setReference, props: getReferenceProps(), open })}
      <FloatingPortal root={portalRoot}>
        <AnimatePresence>
          {open ? (
            <FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus>
              <div
                ref={refs.setFloating}
                style={{ ...floatingStyles, width }}
                className={`${portalRoot ? "z-sheet-balloon" : "z-balloon"} outline-none`}
                aria-label={label}
                data-explore
                {...getFloatingProps()}
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.14 }}
                  className="max-h-[inherit] overflow-y-auto overscroll-contain rounded-2xl border border-paper-300 bg-paper-50 p-4 text-sm text-ink-700 shadow-balloon"
                >
                  {typeof content === "function" ? content(close) : content}
                </motion.div>
                <FloatingArrow ref={arrowRef} context={context} fill="#ffffff" stroke="#eeeeee" strokeWidth={1} width={16} height={8} />
              </div>
            </FloatingFocusManager>
          ) : null}
        </AnimatePresence>
      </FloatingPortal>
    </>
  );
}
