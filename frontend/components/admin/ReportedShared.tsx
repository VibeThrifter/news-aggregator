"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";

import { useAccess } from "@/lib/explore/access";
import { OWN_KIND_LABELS } from "@/lib/explore/labels";
import { moderateSharedEntry, reportedSharedEntries, type ModerateAction, type ReportReason, type ReportedEntry } from "@/lib/shared";

import { AdminCard, BUTTON_SECONDARY } from "./ui";

const REASON_LABELS: Record<ReportReason, string> = {
  spam: "spam",
  beledigend: "beledigend",
  prive: "privépersoon",
  anders: "anders",
};

const time = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * What readers reported of what others shared ("Van anderen", Story 14.15): 3 reports hide an entry
 * until the admin shows it again, hides it for good or deletes it. Admin code only.
 */
export function ReportedShared() {
  const access = useAccess();
  const admin = access.role === "admin" && access.code;
  const { data, mutate, isLoading } = useSWR(admin ? ["shared-reported", access.code] : null, () => reportedSharedEntries(access.code as string), {
    revalidateOnFocus: false,
  });
  const [busy, setBusy] = useState<number | null>(null);
  if (!admin) return null;

  const act = async (item: ReportedEntry, action: ModerateAction) => {
    setBusy(item.entry.id);
    try {
      await moderateSharedEntry(access.code as string, item.entry.id, action);
      await mutate();
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminCard id="reported-title" title="Gemeld door lezers" subtitle="Wat lezers deelden en anderen meldden; na 3 meldingen is het verborgen">
      {isLoading ? <p className="text-sm text-ink-500">Laden…</p> : null}
      {data && data.length === 0 ? <p className="text-sm text-ink-500">Niets gemeld.</p> : null}
      {data?.length ? (
        <ul className="divide-y divide-paper-200 rounded-xl border border-paper-200">
          {data.map((item) => {
            const href = `/event/${encodeURIComponent(item.event_slug ?? String(item.entry.event_id))}`;
            const reasons = Object.entries(item.reasons ?? {})
              .map(([reason, count]) => `${REASON_LABELS[reason as ReportReason] ?? reason} ${count}×`)
              .join(" · ");
            return (
              <li key={item.entry.id} className="space-y-2 p-4">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500">
                  <span className="font-semibold text-ink-800">{OWN_KIND_LABELS[item.entry.kind] ?? item.entry.kind}</span>
                  <Link href={href} className="font-medium text-accent-blue hover:underline">
                    {item.event_title ?? `Nieuwsitem ${item.entry.event_id}`}
                  </Link>
                  <span>{time.format(new Date(item.entry.created_at))}</span>
                  {item.hidden_at ? (
                    <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-semibold text-red-800">
                      {item.hidden_reason === "admin" ? "verborgen door jou" : "verborgen na meldingen"}
                    </span>
                  ) : (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800">zichtbaar</span>
                  )}
                </p>
                <p className="text-sm text-ink-900">{item.entry.text}</p>
                {item.entry.detail ? <p className="text-sm text-ink-600">{item.entry.detail}</p> : null}
                {item.entry.url ? <p className="break-all text-xs text-ink-500">{item.entry.url}</p> : null}
                {reasons ? <p className="text-xs text-ink-500">Gemeld: {reasons}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {item.hidden_at ? (
                    <button type="button" disabled={busy === item.entry.id} onClick={() => act(item, "toon")} className={BUTTON_SECONDARY}>
                      Toon weer
                    </button>
                  ) : (
                    <button type="button" disabled={busy === item.entry.id} onClick={() => act(item, "verberg")} className={BUTTON_SECONDARY}>
                      Verberg
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy === item.entry.id}
                    onClick={() => act(item, "verwijder")}
                    className="inline-flex min-h-[40px] items-center justify-center rounded-full border border-red-200 bg-paper-50 px-4 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-40"
                  >
                    Verwijder
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </AdminCard>
  );
}
