"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { onStorageQuotaExceeded } from "@/lib/explore/storage";

interface ToastOptions {
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  message: string;
}

const ToastContext = createContext<(message: string, options?: ToastOptions) => void>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, options: ToastOptions = {}) => {
      counter.current += 1;
      const id = counter.current;
      setToasts((current) => [...current.slice(-2), { id, message, ...options }]);
      window.setTimeout(() => dismiss(id), options.duration ?? 3500);
    },
    [dismiss],
  );

  useEffect(
    () => onStorageQuotaExceeded(() => toast("Opslag vol — exporteer je dossier om niets kwijt te raken.", { duration: 6000 })),
    [toast],
  );

  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+84px)] z-toast flex flex-col items-center gap-2 px-4"
      >
        <AnimatePresence>
          {toasts.map((item) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="pointer-events-auto flex max-w-md items-center gap-3 rounded-full bg-ink-900 px-4 py-2.5 text-sm text-white shadow-balloon"
              role="status"
            >
              <span>{item.message}</span>
              {item.actionLabel && item.onAction ? (
                <button
                  type="button"
                  onClick={() => {
                    item.onAction?.();
                    dismiss(item.id);
                  }}
                  className="min-h-[32px] rounded-full px-2 font-semibold text-accent-orange"
                >
                  {item.actionLabel}
                </button>
              ) : null}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
