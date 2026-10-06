"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";

import { useAccess } from "@/lib/explore/access";
import { OWN_KIND_LABELS } from "@/lib/explore/labels";
import { moderateSharedEntry, reportedSharedEntries, type ModerateAction, type ReportReason, type ReportedEntry } from "@/lib/shared";

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
    <section aria-labelledby="reported-title" className="space-y-3 rounded-lg border border-slate-700 bg-slate-800 p-4">
      <div>
        <h2 id="reported-title" className="font-semibold text-slate-100">
          Gemeld door lezers
        </h2>
        <p className="text-sm text-slate-400">Wat lezers deelden en anderen meldden; na 3 meldingen is het verborgen</p>
      </div>
      {isLoading ? <p className="text-sm text-slate-400">Laden…</p> : null}
      {data && data.length === 0 ? <p className="text-sm text-slate-400">Niets gemeld.</p> : null}
      <ul className="space-y-2">
        {(data ?? []).map((item) => {
          const href = `/event/${encodeURIComponent(item.event_slug ?? String(item.entry.event_id))}`;
          const reasons = Object.entries(item.reasons ?? {})
            .map(([reason, count]) => `${REASON_LABELS[reason as ReportReason] ?? reason} ${count}×`)
            .join(" · ");
          return (
            <li key={item.entry.id} className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
              <p className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span className="font-semibold uppercase tracking-wide text-slate-300">{OWN_KIND_LABELS[item.entry.kind] ?? item.entry.kind}</span>
                <Link href={href} className="text-sky-300 hover:underline">
                  {item.event_title ?? `Nieuwsitem ${item.entry.event_id}`}
                </Link>
                <span>{time.format(new Date(item.entry.created_at))}</span>
                {item.hidden_at ? (
                  <span className="rounded-full bg-red-500/20 px-2 text-red-200">
                    {item.hidden_reason === "admin" ? "verborgen door jou" : "verborgen na meldingen"}
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-500/20 px-2 text-emerald-200">zichtbaar</span>
                )}
              </p>
              <p className="text-sm text-slate-100">{item.entry.text}</p>
              {item.entry.detail ? <p className="text-sm text-slate-300">{item.entry.detail}</p> : null}
              {item.entry.url ? <p className="break-all text-xs text-slate-400">{item.entry.url}</p> : null}
              {reasons ? <p className="text-xs text-slate-400">Gemeld: {reasons}</p> : null}
              <div className="flex flex-wrap gap-2">
                {item.hidden_at ? (
                  <button
                    type="button"
                    disabled={busy === item.entry.id}
                    onClick={() => act(item, "toon")}
                    className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                  >
                    Toon weer
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy === item.entry.id}
                    onClick={() => act(item, "verberg")}
                    className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                  >
                    Verberg
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy === item.entry.id}
                  onClick={() => act(item, "verwijder")}
                  className="rounded-lg border border-red-500/50 px-3 py-1.5 text-sm text-red-200 hover:bg-red-500/10 disabled:opacity-50"
                >
                  Verwijder
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
