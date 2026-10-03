"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Plus } from "lucide-react";

import { useFocusStore } from "@/lib/explore/focus";
import { isOutletShown } from "@/lib/explore/layout/bubbles";
import { OWN_KIND_LABELS } from "@/lib/explore/labels";
import { anchorOptions, OWN_LIMITS } from "@/lib/explore/own";
import { useExploreStore } from "@/lib/explore/store";
import { truncate } from "@/lib/explore/summary";
import type { OwnEntry, OwnKind } from "@/lib/explore/types";

import { useExplore } from "../ExploreContext";
import { Favicon } from "../ui/primitives";
import { Avatar } from "./PeopleCards";

/** "jij": added by the reader. */
export function OwnTag({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border border-ink-300 bg-white px-1.5 text-[10px] font-semibold leading-4 text-ink-700 ${className}`}>
      <span aria-hidden="true">jij</span>
      <span className="sr-only">door jou toegevoegd</span>
    </span>
  );
}

/** "gevonden": a missing voice an AI search found here (approved). */
export function FoundTag({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full bg-teal-700 px-1.5 text-[10px] font-semibold leading-4 text-white ${className}`}>
      gevonden
    </span>
  );
}

/** The button that opens a form ("＋ Twijfel"). */
export function AddButton({ children, onClick, small = false }: { children: ReactNode; onClick: () => void; small?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-ink-300 font-semibold text-ink-700 hover:bg-white ${
        small ? "min-h-[36px] px-2.5 text-[12px]" : "min-h-[40px] px-3.5 text-sm"
      }`}
    >
      <Plus size={small ? 14 : 16} aria-hidden="true" /> {children}
    </button>
  );
}

interface FieldSpec {
  label: string;
  multiline?: boolean;
  max: number;
}

/** The fields per kind: the main text, then what is optional. */
const FORM: Record<
  OwnKind,
  { text: FieldSpec; detail?: FieldSpec; quote?: FieldSpec; anchor?: { label: string; required: boolean }; url?: boolean; date?: boolean }
> = {
  claim: {
    text: { label: "Wat wordt er beweerd?", multiline: true, max: OWN_LIMITS.text },
    anchor: { label: "Wie zegt het?", required: false },
    detail: { label: "Waarom twijfel je?", multiline: true, max: OWN_LIMITS.detail },
    url: true,
  },
  speaker: {
    text: { label: "Naam", max: 120 },
    detail: { label: "Rol of organisatie", max: 160 },
    anchor: { label: "Aan het woord bij", required: true },
    quote: { label: "Wat zegt hij of zij?", multiline: true, max: OWN_LIMITS.quote },
  },
  gap: {
    text: { label: "Wie komt niet aan het woord?", max: 160 },
    detail: { label: "Waarom doet dat ertoe?", multiline: true, max: OWN_LIMITS.detail },
  },
  question: {
    text: { label: "Welke vraag is niet gesteld?", multiline: true, max: OWN_LIMITS.text },
    anchor: { label: "Aan wie?", required: false },
  },
  note: {
    text: { label: "Wat valt je op?", multiline: true, max: OWN_LIMITS.text },
    anchor: { label: "Bij", required: false },
    url: true,
  },
  moment: {
    date: true,
    text: { label: "Wat gebeurde er?", multiline: true, max: OWN_LIMITS.text },
    url: true,
  },
};

/** The label of the optional extra field of an entry, for its detail view. */
export const DETAIL_LABELS: Partial<Record<OwnKind, string>> = {
  claim: "Waarom je twijfelt",
  gap: "Waarom het ertoe doet",
  speaker: "Rol of organisatie",
};

/** "www.cbs.nl/x" → "https://www.cbs.nl/x"; null when it is no web link. */
function normalizeUrl(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const inputClass =
  "w-full rounded-xl border border-paper-300 bg-paper-50 px-3 py-2 text-base text-ink-900 focus:border-ink-500 focus:outline-none sm:text-sm";

function Field({ id, label, optional, children }: { id: string; label: string; optional?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="flex items-baseline gap-1.5 text-xs font-semibold text-ink-700">
        {label}
        {optional ? <span className="font-normal text-ink-400">optioneel</span> : null}
      </label>
      {children}
    </div>
  );
}

/** Who or what an entry hangs on: outlets with their speakers, as chips. */
function AnchorPicker({
  kind,
  label,
  required,
  value,
  onChange,
}: {
  kind: OwnKind;
  label: string;
  required: boolean;
  value: string | null;
  onChange: (anchor: string | null) => void;
}) {
  const { exploration, eventId } = useExplore();
  const sources = useExploreStore((state) => state.events[String(eventId)]?.sources);
  const strip = useRef<HTMLDivElement | null>(null);
  const options = useMemo(
    () =>
      anchorOptions(exploration, kind, (key) => {
        const outlet = exploration.index.outlet(key);
        return outlet ? isOutletShown(outlet, sources) : false;
      }),
    [exploration, kind, sources],
  );
  const dutchCount = exploration.input.outlets.filter((outlet) => !outlet.isInternational).length;

  // The chosen chip in view (a preset from a popover may be far to the right)
  useEffect(() => {
    if (!value) return;
    const box = strip.current;
    const chip = box?.querySelector<HTMLElement>(`[data-anchor-option="${CSS.escape(value)}"]`);
    if (chip && box) box.scrollLeft += chip.getBoundingClientRect().left - box.getBoundingClientRect().left - 16;
    // Only on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A single choice that is required needs no picker: it is the choice
  const only = required && options.length === 1 ? options[0].anchor : null;
  useEffect(() => {
    if (only && value !== only) onChange(only);
  }, [only, onChange, value]);

  if (options.length === 0 || only) return null;
  return (
    <div className="space-y-1">
      <p className="flex items-baseline gap-1.5 text-xs font-semibold text-ink-700">
        {label}
        {!required ? <span className="font-normal text-ink-400">optioneel</span> : null}
      </p>
      <div ref={strip} role="radiogroup" aria-label={label} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {options.map((option) => {
          const outlet = exploration.index.outlet(option.outletKey);
          const checked = value === option.anchor;
          return (
            <button
              key={option.anchor}
              type="button"
              role="radio"
              aria-checked={checked}
              data-anchor-option={option.anchor}
              onClick={() => onChange(checked && !required ? null : option.anchor)}
              className={`flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors ${
                checked ? "border-ink-900 bg-ink-900 text-white" : "border-paper-300 bg-paper-50 text-ink-800 hover:bg-paper-100"
              }`}
            >
              {option.speaker ? (
                <>
                  <Avatar speaker={option.speaker} size={18} />
                  {truncate(option.speaker.name, 26)}
                  {dutchCount > 1 && outlet ? (
                    <span className="opacity-70">
                      <Favicon name={outlet.name} domain={outlet.domain} size={12} />
                    </span>
                  ) : null}
                </>
              ) : outlet ? (
                <>
                  <Favicon name={outlet.name} domain={outlet.domain} size={16} />
                  {outlet.name}
                </>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The form for an entry of your own (new or to edit). Opens inline where you tapped "＋", never in
 * a side panel.
 */
export function OwnForm({
  kind,
  initial,
  anchor: presetAnchor = null,
  onDone,
  onCancel,
}: {
  kind: OwnKind;
  initial?: OwnEntry;
  /** Preset: who says it / which outlet */
  anchor?: string | null;
  onDone: (entry: OwnEntry) => void;
  onCancel: () => void;
}) {
  const { addOwn, updateOwn, exploration } = useExplore();
  const spec = FORM[kind];
  const id = useId();
  const dutch = exploration.input.outlets.filter((outlet) => !outlet.isInternational);
  const defaultAnchor =
    presetAnchor ?? initial?.anchor ?? (spec.anchor?.required && dutch.length === 1 ? `outlet:${dutch[0].key}` : null);
  // A speaker's role belongs with the name, before where and what they say
  const detailFirst = kind === "speaker";
  const [text, setText] = useState(initial?.text ?? "");
  const [detail, setDetail] = useState(initial?.detail ?? "");
  const [quote, setQuote] = useState(initial?.quote ?? "");
  const [anchor, setAnchor] = useState<string | null>(defaultAnchor);
  const [url, setUrl] = useState(initial?.url ?? "");
  const [date, setDate] = useState(initial?.date ?? today());
  const [error, setError] = useState<string | null>(null);

  const missing = !text.trim() ? spec.text.label : spec.anchor?.required && !anchor ? spec.anchor.label : spec.date && !date ? "Wanneer?" : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (missing) return;
    const link = url.trim() ? normalizeUrl(url) : null;
    if (url.trim() && !link) {
      setError("Dat is geen weblink");
      return;
    }
    const fields = {
      text: text.trim(),
      detail: spec.detail ? detail.trim() || undefined : undefined,
      quote: spec.quote ? quote.trim() || undefined : undefined,
      anchor: spec.anchor ? anchor ?? undefined : undefined,
      url: spec.url ? link ?? undefined : undefined,
      date: spec.date ? date : undefined,
    };
    if (initial) {
      updateOwn(initial.id, fields);
      onDone({ ...initial, ...fields });
      return;
    }
    const entry = addOwn({ kind, ...fields });
    if (entry) onDone(entry);
  };

  const textInput = spec.text.multiline ? (
    <textarea
      id={`${id}-text`}
      value={text}
      onChange={(event) => setText(event.target.value)}
      rows={2}
      maxLength={spec.text.max}
      autoFocus
      className={inputClass}
    />
  ) : (
    <input
      id={`${id}-text`}
      value={text}
      onChange={(event) => setText(event.target.value)}
      maxLength={spec.text.max}
      autoFocus
      enterKeyHint="done"
      className={inputClass}
    />
  );

  const detailField = spec.detail ? (
    <Field id={`${id}-detail`} label={spec.detail.label} optional>
      {spec.detail.multiline ? (
        <textarea id={`${id}-detail`} value={detail} onChange={(event) => setDetail(event.target.value)} rows={2} maxLength={spec.detail.max} className={inputClass} />
      ) : (
        <input id={`${id}-detail`} value={detail} onChange={(event) => setDetail(event.target.value)} maxLength={spec.detail.max} className={inputClass} />
      )}
    </Field>
  ) : null;

  return (
    <form
      noValidate
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
      aria-label={initial ? `${OWN_KIND_LABELS[kind]} aanpassen` : `${OWN_KIND_LABELS[kind]} toevoegen`}
      className="basis-full space-y-3 rounded-2xl border border-paper-300 bg-white p-3 shadow-sm"
    >
      {spec.date ? (
        <Field id={`${id}-date`} label="Wanneer?">
          <input id={`${id}-date`} type="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
        </Field>
      ) : null}
      <Field id={`${id}-text`} label={spec.text.label}>
        {textInput}
      </Field>
      {detailFirst ? detailField : null}
      {spec.anchor ? <AnchorPicker kind={kind} label={spec.anchor.label} required={spec.anchor.required} value={anchor} onChange={setAnchor} /> : null}
      {spec.quote ? (
        <Field id={`${id}-quote`} label={spec.quote.label} optional>
          <textarea id={`${id}-quote`} value={quote} onChange={(event) => setQuote(event.target.value)} rows={2} maxLength={spec.quote.max} className={inputClass} />
        </Field>
      ) : null}
      {detailFirst ? null : detailField}
      {spec.url ? (
        <Field id={`${id}-url`} label="Bron" optional>
          <input
            id={`${id}-url`}
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setError(null);
            }}
            // Text, not type="url": "cbs.nl/x" is fine here (normalizeUrl), the browser would refuse it
            type="text"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${id}-error` : undefined}
            className={inputClass}
          />
          {error ? (
            <p id={`${id}-error`} className="text-xs font-semibold text-red-700">
              {error}
            </p>
          ) : null}
        </Field>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={Boolean(missing)}
          className="min-h-[44px] rounded-full bg-ink-900 px-5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {initial ? "Opslaan" : "Toevoegen"}
        </button>
        <button type="button" onClick={onCancel} className="min-h-[44px] rounded-full border border-paper-300 px-4 text-sm font-semibold text-ink-700 hover:bg-paper-100">
          Annuleren
        </button>
      </div>
    </form>
  );
}

/**
 * "＋" buttons for what you can add in a tab, and the form of the one you opened. Opens by itself
 * when a popover asks for it (`compose`), with the speaker or outlet already chosen.
 */
export function OwnAdd({ kinds }: { kinds: OwnKind[] }) {
  const compose = useFocusStore((state) => state.compose);
  const clearCompose = useFocusStore((state) => state.clearCompose);
  const focus = useFocusStore((state) => state.focus);
  const [open, setOpen] = useState<{ kind: OwnKind; anchor: string | null; key: number } | null>(null);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!compose || !kinds.includes(compose.kind)) return;
    setOpen({ kind: compose.kind, anchor: compose.anchor, key: compose.nonce });
    clearCompose();
    window.setTimeout(() => box.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 80);
  }, [clearCompose, compose, kinds]);

  if (kinds.length === 0) return null;
  return (
    <div ref={box} className="scroll-mt-28 pt-2">
      {open ? (
        <OwnForm
          key={open.key}
          kind={open.kind}
          anchor={open.anchor}
          onCancel={() => setOpen(null)}
          onDone={(entry) => {
            setOpen(null);
            // The new row rings (it mounts after this)
            focus("finding", entry.id);
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {kinds.map((kind) => (
            <AddButton key={kind} onClick={() => setOpen({ kind, anchor: null, key: Date.now() })}>
              {OWN_KIND_LABELS[kind]}
            </AddButton>
          ))}
        </div>
      )}
    </div>
  );
}
