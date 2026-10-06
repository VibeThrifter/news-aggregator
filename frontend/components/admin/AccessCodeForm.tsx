"use client";

import { useEffect, useState, type FormEvent } from "react";

import { readAccessCode, saveAccessCode, useAccess } from "@/lib/explore/access";

import { AdminCard, BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT } from "./ui";

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
    <AdminCard id="access-title" title="Toegangscode" subtitle="Zoeken met AI naar stemmen die niet aan het woord zijn, en gevonden bronnen goedkeuren">
      {hasCode ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span role="status" className="inline-flex items-center gap-2 font-medium text-ink-800">
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${access.checking ? "bg-paper-300" : access.role ? "bg-emerald-500" : "bg-red-500"}`}
            />
            {access.checking
              ? "Code controleren…"
              : access.role
                ? `${ROLE_LABELS[access.role]} op dit apparaat${access.canSearch ? " · mag zoeken" : ""}`
                : "Code onbekend of ingetrokken"}
          </span>
          <button type="button" onClick={() => saveAccessCode(null)} className={BUTTON_SECONDARY}>
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
            placeholder="Code"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className={`${INPUT} min-w-0 flex-1 rounded-full px-4`}
          />
          <button type="submit" disabled={!value.trim()} className={BUTTON_PRIMARY}>
            Gebruik code
          </button>
        </form>
      )}
    </AdminCard>
  );
}
