"use client";

import { useEffect, useState, type FormEvent } from "react";

import { readAccessCode, saveAccessCode, useAccess } from "@/lib/explore/access";

const ROLE_LABELS = { admin: "Admin", pro: "Pro" } as const;

/**
 * The access code of this device (Story 14.10): unlocks "Zoek met AI" for missing voices. The
 * database checks the code; it is only kept in this browser.
 */
export function AccessCodeForm() {
  const access = useAccess();
  const [value, setValue] = useState("");
  const [hasCode, setHasCode] = useState(false);
  useEffect(() => setHasCode(Boolean(readAccessCode())), [access.code]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) return;
    saveAccessCode(value);
    setValue("");
  };

  return (
    <section aria-labelledby="access-title" className="space-y-3 rounded-lg border border-slate-700 bg-slate-800 p-4">
      <div>
        <h2 id="access-title" className="font-semibold text-slate-100">
          Toegangscode
        </h2>
        <p className="text-sm text-slate-400">Zoeken met AI naar stemmen die niet aan het woord zijn, en gevonden bronnen goedkeuren</p>
      </div>
      {hasCode ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span role="status" className="text-slate-200">
            {access.checking
              ? "Code controleren…"
              : access.role
                ? `${ROLE_LABELS[access.role]} op dit apparaat${access.canSearch ? " · mag zoeken" : ""}`
                : "Code onbekend of ingetrokken"}
          </span>
          <button
            type="button"
            onClick={() => saveAccessCode(null)}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-slate-200 hover:bg-slate-700"
          >
            Vergeet code
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-wrap gap-2">
          <label htmlFor="access-code" className="sr-only">
            Toegangscode
          </label>
          <input
            id="access-code"
            type="password"
            autoComplete="off"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          />
          <button type="submit" disabled={!value.trim()} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            Gebruik code
          </button>
        </form>
      )}
    </section>
  );
}
