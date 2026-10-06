"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PILL } from "@/components/explore/ui/primitives";

/** Building blocks of the admin pages, in the look of the rest of the site. */

export const BUTTON_PRIMARY =
  "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-full bg-ink-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-40";

export const BUTTON_SECONDARY =
  "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-full border border-paper-300 bg-paper-50 px-4 text-sm font-semibold text-ink-800 transition-colors hover:bg-paper-200 disabled:cursor-not-allowed disabled:opacity-40";

export const INPUT =
  "w-full rounded-xl border border-paper-300 bg-paper-50 px-3.5 py-2 text-base text-ink-900 placeholder-ink-400 transition-colors focus:border-ink-400 focus:outline-none disabled:opacity-50 sm:text-sm";

export function AdminHeader({
  back,
  title,
  subtitle,
  action,
}: {
  back: { href: string; label: string };
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <header className="space-y-3">
      <Link href={back.href} className={PILL}>
        <ArrowLeft size={16} aria-hidden="true" /> {back.label}
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-bold leading-tight text-ink-900">{title}</h1>
          <p className="mt-1 text-sm text-ink-500">{subtitle}</p>
        </div>
        {action}
      </div>
    </header>
  );
}

export function AdminCard({ title, subtitle, children, className = "", id }: { title?: ReactNode; subtitle?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section aria-labelledby={id} className={`space-y-4 rounded-2xl border border-paper-300 bg-paper-50 p-5 ${className}`}>
      {title ? (
        <div>
          <h2 id={id} className="font-serif text-lg font-bold text-ink-900">
            {title}
          </h2>
          {subtitle ? <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** A message after an action: green when it worked, red when it failed. */
export function Notice({ tone, children }: { tone: "ok" | "error"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-2xl border px-4 py-3 text-sm font-medium ${
        tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
    >
      {children}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-ink-900" : "bg-paper-300"
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[22px]" : "translate-x-0.5"}`}
      />
    </button>
  );
}
