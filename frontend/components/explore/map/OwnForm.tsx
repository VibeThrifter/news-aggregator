"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Plus } from "lucide-react";

import { markerTypeOf } from "@/lib/explore/figure";
import { findingTitle } from "@/lib/explore/findings";
import { useFocusStore } from "@/lib/explore/focus";
import { isOutletShown } from "@/lib/explore/layout/bubbles";
import { FALLACY_LABELS, OWN_KIND_LABELS } from "@/lib/explore/labels";
import { anchorOptions, OWN_LIMITS } from "@/lib/explore/own";
import { useExploreStore } from "@/lib/explore/store";
import { truncate } from "@/lib/explore/summary";
import type { OwnEntry, OwnKind } from "@/lib/explore/types";

import { useExplore } from "../ExploreContext";
import { Favicon } from "../ui/primitives";
import { NumberBadge } from "./Markers";
import { Avatar } from "./PeopleCards";

/** "jij": added by the reader; "overgenomen": taken over from another reader. */
export function OwnTag({ adopted = false, className = "" }: { adopted?: boolean; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border border-ink-300 bg-white px-1.5 text-[10px] font-semibold leading-4 text-ink-700 ${className}`}>
      <span aria-hidden="true">{adopted ? "overgenomen" : "jij"}</span>
      <span className="sr-only">{adopted ? "overgenomen van een andere lezer" : "door jou toegevoegd"}</span>
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

interface FormSpec {
  text: FieldSpec;
  detail?: FieldSpec;
  quote?: FieldSpec;
  /** Who or what it hangs on */
  anchor?: { label: string; required: boolean };
  /** Contradiction: the other side */
  against?: { label: string };
  /** Fallacy: which one */
  fallacy?: boolean;
  /** A link: optional, or what the entry is about (a source: required, asked first) */
  url?: { label: string; required: boolean };
  title?: FieldSpec;
  date?: boolean;
}

const SOURCE: FormSpec["url"] = { label: "Bron", required: false };

/** The fields per kind: the main text, then what is optional. */
const FORM: Record<OwnKind, FormSpec> = {
  claim: {
    text: { label: "Wat wordt er beweerd?", multiline: true, max: OWN_LIMITS.text },
    anchor: { label: "Wie zegt het?", required: false },
    detail: { label: "Waarom twijfel je?", multiline: true, max: OWN_LIMITS.detail },
    url: SOURCE,
  },
  fallacy: {
    fallacy: true,
    text: { label: "Welke redenering?", multiline: true, max: OWN_LIMITS.text },
    anchor: { label: "Wie redeneert zo?", required: false },
    detail: { label: "Waarom klopt die niet?", multiline: true, max: OWN_LIMITS.detail },
  },
  contradiction: {
    text: { label: "Waarover spreken ze elkaar tegen?", multiline: true, max: OWN_LIMITS.text },
    anchor: { label: "Wie zegt het één?", required: true },
    against: { label: "Wie zegt het andere?" },
    detail: { label: "Wat zeggen ze?", multiline: true, max: OWN_LIMITS.detail },
    url: SOURCE,
  },
  error: {
    text: { label: "Wat is er fout?", multiline: true, max: OWN_LIMITS.text },
    anchor: { label: "Waar staat het?", required: false },
    detail: { label: "Wat klopt wel?", multiline: true, max: OWN_LIMITS.detail },
    url: SOURCE,
  },
  speaker: {
    text: { label: "Naam", max: 120 },
    detail: { label: "Rol of organisatie", max: 160 },
    anchor: { label: "Aan het woord bij", required: true },
    quote: { label: "Wat zegt hij of zij?", multiline: true, max: OWN_LIMITS.quote },
  },
  source: {
    url: { label: "Link", required: true },
    text: { label: "Wat brengt deze bron?", multiline: true, max: OWN_LIMITS.text },
    title: { label: "Kop", max: OWN_LIMITS.title },
    detail: { label: "Wie komt er aan het woord?", max: 300 },
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
    url: SOURCE,
  },
  moment: {
    date: true,
    text: { label: "Wat gebeurde er?", multiline: true, max: OWN_LIMITS.text },
    url: SOURCE,
  },
};

/** The label of the optional extra field of an entry, for its detail view. */
export const DETAIL_LABELS: Partial<Record<OwnKind, string>> = {
  claim: "Waarom je twijfelt",
  fallacy: "Waarom die niet klopt",
  contradiction: "Wat ze zeggen",
  error: "Wat wel klopt",
  gap: "Waarom het ertoe doet",
  speaker: "Rol of organisatie",
  source: "Aan het woord",
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

/** What an entry of this kind can hang on, as the picture shows it (foreign outlets only when shown). */
export function useAnchorOptions(kind: OwnKind) {
  const { exploration, eventId } = useExplore();
  const sources = useExploreStore((state) => state.events[String(eventId)]?.sources);
  return useMemo(
    () =>
      anchorOptions(exploration, kind, (key) => {
        const outlet = exploration.index.outlet(key);
        return outlet ? isOutletShown(outlet, sources) : false;
      }),
    [exploration, kind, sources],
  );
}

/** Who or what an entry hangs on: outlets with their speakers, as chips. */
function AnchorPicker({
  kind,
  label,
  required,
  value,
  onChange,
  exclude = null,
  autoChoose = true,
}: {
  kind: OwnKind;
  label: string;
  required: boolean;
  value: string | null;
  onChange: (anchor: string | null) => void;
  /** Not this one (the other side of a contradiction) */
  exclude?: string | null;
  /** A single required choice is made without asking */
  autoChoose?: boolean;
}) {
  const { exploration } = useExplore();
  const all = useAnchorOptions(kind);
  const options = useMemo(() => all.filter((option) => option.anchor !== exclude), [all, exclude]);
  const strip = useRef<HTMLDivElement | null>(null);
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
  const only = autoChoose && required && options.length === 1 ? options[0].anchor : null;
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

/** Which reasoning error: the kinds the analysis names too. */
function FallacyPicker({ value, onChange }: { value: string | null; onChange: (value: string) => void }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-ink-700">Welke drogreden?</p>
      <div role="radiogroup" aria-label="Welke drogreden?" className="flex flex-wrap gap-1.5">
        {Object.entries(FALLACY_LABELS).map(([key, label]) => {
          const checked = value === key;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onChange(key)}
              className={`min-h-[36px] rounded-full border px-2.5 text-xs font-semibold transition-colors ${
                checked ? "border-violet-700 bg-violet-700 text-white" : "border-paper-300 bg-paper-50 text-ink-800 hover:bg-paper-100"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The finding of the analysis an error corrects: its number and title. */
function AboutLine({ findingId }: { findingId: string }) {
  const { exploration } = useExplore();
  const finding = exploration.findingById.get(findingId);
  if (!finding) return null;
  const marker = markerTypeOf(finding);
  return (
    <p className="flex items-start gap-2 rounded-xl bg-orange-50 p-2.5 text-sm text-ink-800">
      <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-orange-800">Over</span>
      {marker ? <NumberBadge findingId={finding.id} type={marker} /> : null}
      <span className="min-w-0 flex-1">{truncate(findingTitle(finding, exploration.index), 160)}</span>
    </p>
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
  about: presetAbout = null,
  onDone,
  onCancel,
}: {
  kind: OwnKind;
  initial?: OwnEntry;
  /** Preset: who says it / which outlet */
  anchor?: string | null;
  /** Preset for an error: the finding of the analysis it corrects */
  about?: string | null;
  onDone: (entry: OwnEntry) => void;
  onCancel: () => void;
}) {
  const { addOwn, updateOwn, exploration } = useExplore();
  const spec = FORM[kind];
  const id = useId();
  const dutch = exploration.input.outlets.filter((outlet) => !outlet.isInternational);
  const defaultAnchor =
    presetAnchor ?? initial?.anchor ?? (spec.anchor?.required && kind !== "contradiction" && dutch.length === 1 ? `outlet:${dutch[0].key}` : null);
  // A speaker's role belongs with the name, before where and what they say
  const detailFirst = kind === "speaker";
  const [text, setText] = useState(initial?.text ?? "");
  const [detail, setDetail] = useState(initial?.detail ?? "");
  const [quote, setQuote] = useState(initial?.quote ?? "");
  const [anchor, setAnchorValue] = useState<string | null>(defaultAnchor);
  const [against, setAgainst] = useState<string | null>(initial?.against ?? null);
  const [fallacy, setFallacy] = useState<string | null>(initial?.fallacy ?? null);
  const [url, setUrl] = useState(initial?.url ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState(initial?.date ?? today());
  const [error, setError] = useState<string | null>(null);
  const about = initial?.about ?? presetAbout ?? null;

  // The two sides of a contradiction are never the same
  const setAnchor = useCallback(
    (value: string | null) => {
      setAnchorValue(value);
      if (value && value === against) setAgainst(null);
    },
    [against],
  );

  const missing = spec.url?.required && !url.trim()
    ? spec.url.label
    : spec.fallacy && !fallacy
      ? "Welke drogreden?"
      : !text.trim()
        ? spec.text.label
        : spec.anchor?.required && !anchor
          ? spec.anchor.label
          : spec.against && !against
            ? spec.against.label
            : spec.date && !date
              ? "Wanneer?"
              : null;

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
      // An error about a finding hangs where that finding hangs
      anchor: spec.anchor && !about ? (anchor ?? undefined) : undefined,
      against: spec.against ? (against ?? undefined) : undefined,
      about: kind === "error" ? (about ?? undefined) : undefined,
      fallacy: spec.fallacy ? (fallacy ?? undefined) : undefined,
      url: spec.url ? (link ?? undefined) : undefined,
      title: spec.title ? title.trim() || undefined : undefined,
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
      autoFocus={!spec.url?.required && !spec.fallacy}
      className={inputClass}
    />
  ) : (
    <input
      id={`${id}-text`}
      value={text}
      onChange={(event) => setText(event.target.value)}
      maxLength={spec.text.max}
      autoFocus={!spec.url?.required && !spec.fallacy}
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

  const urlField = spec.url ? (
    <Field id={`${id}-url`} label={spec.url.label} optional={!spec.url.required}>
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
        autoFocus={spec.url.required}
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
      {about ? <AboutLine findingId={about} /> : null}
      {spec.url?.required ? urlField : null}
      {spec.fallacy ? <FallacyPicker value={fallacy} onChange={setFallacy} /> : null}
      {spec.date ? (
        <Field id={`${id}-date`} label="Wanneer?">
          <input id={`${id}-date`} type="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
        </Field>
      ) : null}
      <Field id={`${id}-text`} label={spec.text.label}>
        {textInput}
      </Field>
      {spec.title ? (
        <Field id={`${id}-title`} label={spec.title.label} optional>
          <input id={`${id}-title`} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={spec.title.max} className={inputClass} />
        </Field>
      ) : null}
      {detailFirst ? detailField : null}
      {spec.anchor && !about ? (
        <AnchorPicker kind={kind} label={spec.anchor.label} required={spec.anchor.required} value={anchor} onChange={setAnchor} />
      ) : null}
      {spec.against ? (
        <AnchorPicker kind={kind} label={spec.against.label} required value={against} onChange={setAgainst} exclude={anchor} autoChoose={false} />
      ) : null}
      {spec.quote ? (
        <Field id={`${id}-quote`} label={spec.quote.label} optional>
          <textarea id={`${id}-quote`} value={quote} onChange={(event) => setQuote(event.target.value)} rows={2} maxLength={spec.quote.max} className={inputClass} />
        </Field>
      ) : null}
      {detailFirst ? null : detailField}
      {spec.url && !spec.url.required ? urlField : null}
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
  const [open, setOpen] = useState<{ kind: OwnKind; anchor: string | null; about: string | null; key: number } | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  // A contradiction needs two sides to choose from
  const sides = useAnchorOptions("contradiction").length;
  const available = kinds.filter((kind) => kind !== "contradiction" || sides >= 2);

  useEffect(() => {
    if (!compose || !kinds.includes(compose.kind)) return;
    setOpen({ kind: compose.kind, anchor: compose.anchor, about: compose.about ?? null, key: compose.nonce });
    clearCompose();
    window.setTimeout(() => box.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 80);
  }, [clearCompose, compose, kinds]);

  if (available.length === 0) return null;
  return (
    <div ref={box} className="scroll-mt-28 pt-2">
      {open ? (
        <OwnForm
          key={open.key}
          kind={open.kind}
          anchor={open.anchor}
          about={open.about}
          onCancel={() => setOpen(null)}
          onDone={(entry) => {
            setOpen(null);
            // The new row rings (it mounts after this)
            focus("finding", entry.id);
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {available.map((kind) => (
            <AddButton key={kind} onClick={() => setOpen({ kind, anchor: null, about: null, key: Date.now() })}>
              {OWN_KIND_LABELS[kind]}
            </AddButton>
          ))}
        </div>
      )}
    </div>
  );
}
