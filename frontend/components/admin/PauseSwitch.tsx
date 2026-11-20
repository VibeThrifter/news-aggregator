"use client";

import { useState } from "react";
import useSWR from "swr";

import { getBackendPause, setBackendPause } from "@/lib/api";

import { AdminCard, Toggle } from "./ui";

const moment = new Intl.DateTimeFormat("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Pauze (owner 2026-11-19): switches off everything of the backend that looks for something new
 * (news and its analyses), to save AI tokens. The website keeps working with what is there: the
 * backend still publishes and does what someone asks for with a button. The research of the
 * propaganda model goes on: its queue is worked off.
 */
export function PauseSwitch() {
  const { data, error, isLoading, mutate } = useSWR("backend-pause", getBackendPause, { refreshInterval: 60_000, revalidateOnFocus: true });
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const change = async (working: boolean) => {
    setSaving(true);
    setFailed(false);
    try {
      await mutate(await setBackendPause(!working), { revalidate: false });
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminCard id="pause-title" title="Nieuws ophalen" subtitle="Op pauze komt er geen nieuws bij en maakt de backend geen analyses; de website toont wat er is">
      {isLoading ? <p className="text-sm text-ink-500">Laden…</p> : null}
      {error && !data ? <p className="text-sm text-ink-500">De backend is niet bereikbaar.</p> : null}
      {data ? (
        <div className="space-y-2">
          <label className="flex items-center gap-3 text-sm font-medium text-ink-800">
            <Toggle checked={!data.paused} onChange={change} disabled={saving} label="Nieuws ophalen en analyseren" />
            <span role="status" className="inline-flex items-center gap-2">
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${data.paused ? "bg-amber-500" : "bg-emerald-500"}`} />
              {data.paused ? `Op pauze${data.since ? ` sinds ${moment.format(new Date(data.since))}` : ""}` : "Aan"}
            </span>
          </label>
          {data.paused ? (
            <p className="text-sm text-ink-600">
              Er komt geen nieuws bij en er starten geen analyses; wat al liep, maakt hij af. Het onderzoek van het propagandamodel werkt zijn
              wachtrij af. Zoek met AI en gekleurde zinnen werken nog op verzoek.
            </p>
          ) : null}
          {failed ? (
            <p role="alert" className="text-sm font-medium text-red-700">
              Wijzigen lukte niet: de backend antwoordt niet.
            </p>
          ) : null}
        </div>
      ) : null}
    </AdminCard>
  );
}
