"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
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

interface HeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  /** The title of the dialog the header sits in (vaul's or Radix's) */
  Title: ComponentType<{ className?: string; children?: ReactNode }>;
  wide: boolean;
}

function SheetHeader({ title, subtitle, icon, onClose, Title, wide }: HeaderProps) {
  return (
    <header className={`flex items-start gap-3 border-b border-paper-200 ${wide ? "px-6 pb-4 pt-5" : "px-4 pb-3 pt-3"}`}>
      {icon ? (
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper-100 text-ink-600 [&>svg]:h-[18px] [&>svg]:w-[18px]">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1 self-center">
        <Title className={`font-serif font-bold leading-snug text-ink-900 ${wide ? "text-xl" : "text-lg"}`}>{title}</Title>
        {subtitle ? <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p> : null}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-500 hover:bg-paper-200 hover:text-ink-900"
        aria-label="Sluiten"
      >
        <X size={20} />
      </button>
    </header>
  );
}

/**
 * Bottom sheet on phones, a window in the middle of the page on desktop (≥1024px).
 * The sheet wraps vaul and the window Radix Dialog (which vaul is built on), so both trap focus,
 * close on Escape and keep the page still in the same way.
 */
export function Sheet({ open, onOpenChange, title, subtitle, icon, children, footer, handleOnly, label }: SheetProps) {
  const isDesktop = useIsDesktop();
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const close = () => onOpenChange(false);

  const body = (wide: boolean) => (
    <>
      <div
        ref={setPortalRoot}
        className={`relative min-h-0 flex-1 overflow-y-auto overscroll-contain ${
          wide ? "px-6 pb-6 pt-5" : "px-4 pb-[calc(env(safe-area-inset-bottom)+20px)] pt-4"
        }`}
      >
        <PortalRootContext.Provider value={portalRoot}>{children}</PortalRootContext.Provider>
      </div>
      {footer ? (
        <div className={`border-t border-paper-200 bg-paper-50 ${wide ? "px-6 py-4" : "px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3"}`}>
          {footer}
        </div>
      ) : null}
    </>
  );

  if (isDesktop) {
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-sheet bg-ink-900/30 backdrop-blur-[2px] motion-safe:animate-fade-in" />
          <Dialog.Content
            data-explore
            aria-label={label}
            aria-describedby={undefined}
            // The window itself takes the focus, not its close button
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              (event.currentTarget as HTMLElement | null)?.focus();
            }}
            className="fixed inset-x-6 top-[7vh] z-sheet mx-auto flex max-h-[86vh] max-w-[680px] flex-col overflow-hidden rounded-3xl border border-paper-300 bg-paper-50 shadow-dialog outline-none focus-visible:outline-none motion-safe:animate-dialog-in"
          >
            <SheetHeader title={title} subtitle={subtitle} icon={icon} onClose={close} Title={Dialog.Title} wide />
            {body(true)}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} direction="bottom" handleOnly={handleOnly} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-sheet bg-ink-900/40 backdrop-blur-[1px]" />
        <Drawer.Content
          data-explore
          aria-label={label}
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-sheet flex max-h-[92dvh] flex-col rounded-t-3xl bg-paper-50 shadow-dialog outline-none focus-visible:outline-none"
        >
          <Drawer.Handle className="!mt-2 !h-1.5 !w-10 !bg-paper-300" />
          <SheetHeader title={title} subtitle={subtitle} icon={icon} onClose={close} Title={Drawer.Title} wide={false} />
          {body(false)}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
