/**
 * localStorage wrapper that never throws: falls back to memory in private mode, when storage is
 * blocked, or when the quota is exceeded (and tells listeners so the UI can suggest an export).
 */

import type { StateStorage } from "zustand/middleware";

type QuotaListener = () => void;

const memory = new Map<string, string>();
const quotaListeners = new Set<QuotaListener>();

function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function onStorageQuotaExceeded(listener: QuotaListener): () => void {
  quotaListeners.add(listener);
  return () => quotaListeners.delete(listener);
}

export const safeStorage: StateStorage = {
  getItem(name) {
    const store = storage();
    if (store) {
      try {
        const value = store.getItem(name);
        if (value !== null) return value;
      } catch {
        // fall through to memory
      }
    }
    return memory.get(name) ?? null;
  },
  setItem(name, value) {
    memory.set(name, value);
    const store = storage();
    if (!store) return;
    try {
      store.setItem(name, value);
    } catch (error) {
      if (error instanceof DOMException && (error.name === "QuotaExceededError" || error.code === 22)) {
        quotaListeners.forEach((listener) => listener());
      }
    }
  },
  removeItem(name) {
    memory.delete(name);
    const store = storage();
    if (!store) return;
    try {
      store.removeItem(name);
    } catch {
      // ignore
    }
  },
};

/** Keep a copy of an unreadable payload before it gets replaced. */
export function backupRawValue(name: string): void {
  const raw = safeStorage.getItem(name);
  if (typeof raw === "string") {
    safeStorage.setItem(`${name}:backup`, raw);
  }
}
