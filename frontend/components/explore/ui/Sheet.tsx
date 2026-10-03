"use client";

import { useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Drawer } from "vaul";

import { useIsDesktop } from "@/lib/explore/hooks";

import { PortalRootContext } from "./portal-root";

export { usePortalRoot } from "./portal-root";

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Only drag via the handle (for content with its own gestures) */
  handleOnly?: boolean;
  /** Accessible label when the title is not plain text */
  label?: string;
}

/**
 * Bottom sheet on phones, right-hand drawer on desktop (≥1024px).
 * Wraps vaul so it can be swapped for another implementation later.
 */
export function Sheet({ open, onOpenChange, title, subtitle, icon, children, footer, handleOnly, label }: SheetProps) {
  const isDesktop = useIsDesktop();
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  return (
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      direction={isDesktop ? "right" : "bottom"}
      handleOnly={handleOnly}
      repositionInputs={false}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-sheet bg-ink-900/40 backdrop-blur-[1px]" />
        <Drawer.Content
          data-explore
          aria-label={label}
          aria-describedby={undefined}
          className={
            isDesktop
              ? "fixed inset-y-0 right-0 z-sheet flex w-[460px] max-w-[92vw] flex-col bg-paper-50 shadow-balloon outline-none"
              : "fixed inset-x-0 bottom-0 z-sheet flex max-h-[92dvh] flex-col rounded-t-2xl bg-paper-50 shadow-balloon outline-none"
          }
        >
          {!isDesktop && <Drawer.Handle className="!mt-2 !h-1.5 !w-10 !bg-paper-300" />}
          <header className="flex items-start gap-3 border-b border-paper-200 px-4 pb-3 pt-3">
            {icon ? <div className="mt-0.5 shrink-0 text-accent-blue">{icon}</div> : null}
            <div className="min-w-0 flex-1">
              <Drawer.Title className="font-serif text-lg font-bold leading-snug text-ink-900">{title}</Drawer.Title>
              {subtitle ? <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-500 hover:bg-paper-200 hover:text-ink-900"
              aria-label="Sluiten"
            >
              <X size={20} />
            </button>
          </header>
          <div
            ref={setPortalRoot}
            className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-4"
          >
            <PortalRootContext.Provider value={portalRoot}>
              {children}
            </PortalRootContext.Provider>
          </div>
          {footer ? (
            <div className="border-t border-paper-200 bg-paper-50 px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3">{footer}</div>
          ) : null}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
