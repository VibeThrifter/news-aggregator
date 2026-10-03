"use client";

/**
 * Access to options for the admin (and later paying users): an access code kept on this device.
 * What it may do is decided by the database (access_code_role, migration 009); the app only hides
 * what the code cannot use.
 */

import { useEffect, useState } from "react";
import useSWR from "swr";

import { accessCodeRole, type AccessInfo } from "@/lib/voice-search";

export const ACCESS_KEY = "pluriformiteit:toegang";
const CHANGED = "pluriformiteit:toegang-gewijzigd";

export function readAccessCode(): string | null {
  try {
    return window.localStorage.getItem(ACCESS_KEY);
  } catch {
    return null;
  }
}

export function saveAccessCode(code: string | null) {
  try {
    if (code && code.trim()) window.localStorage.setItem(ACCESS_KEY, code.trim());
    else window.localStorage.removeItem(ACCESS_KEY);
  } catch {
    // Storage blocked: the code only lasts until the page closes (below)
  }
  window.dispatchEvent(new Event(CHANGED));
}

export interface Access {
  code: string | null;
  role: AccessInfo["role"];
  /** May let AI search for missing voices and approve what it finds */
  canSearch: boolean;
  checking: boolean;
}

/** The access of this device; checked once per code. */
export function useAccess(): Access {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setCode(readAccessCode());
    update();
    window.addEventListener(CHANGED, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(CHANGED, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  const { data, isLoading } = useSWR(code ? ["access", code] : null, () => accessCodeRole(code as string), {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    dedupingInterval: 10 * 60_000,
    shouldRetryOnError: false,
  });
  return { code, role: data?.role ?? null, canSearch: Boolean(code && data?.can_search), checking: Boolean(code) && isLoading };
}
