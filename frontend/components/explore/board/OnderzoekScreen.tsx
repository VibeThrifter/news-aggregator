"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, Download, LayoutDashboard, List, Pin, StickyNote, Trash2, Upload, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { useExploreHydration } from "@/lib/explore/hooks";
import { exportDossier, useExploreStore, type DossierItem } from "@/lib/explore/store";
import { autoPlace, computeSuggestions } from "@/lib/explore/suggestions";

import { ToastProvider, useToast } from "../ui/Toast";
import { Chip, Eyebrow, Tag } from "../ui/primitives";

const BoardCanvas = dynamic(() => import("./BoardCanvas"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-ink-500">Bord laden…</div>,
});

const LABEL_PRESETS = ["spreekt tegen", "zelfde eigenaar", "betaalt", "citeert", "hoort bij", "versterkt", "vraag"];

function itemHref(item: DossierItem): string | null {
  const event = item.eventSlug ?? (item.eventId !== null ? String(item.eventId) : null);
  if (!event) return null;
  const base = `/event/${encodeURIComponent(event)}`;
  if (item.kind === "finding" && (item.findingId ?? item.refId)) return `${base}?f=${encodeURIComponent(item.findingId ?? item.refId ?? "")}`;
  if (item.kind === "pm" && item.refId) return `${base}/netwerk?lens=propaganda&focus=${encodeURIComponent(`pm:${item.refId}`)}`;
  if ((item.kind === "entity" || item.kind === "actor") && item.refId) {
    const key = item.refId.includes(":") ? item.refId.slice(item.refId.indexOf(":") + 1) : item.refId;
    return `${base}?p=${encodeURIComponent(`entiteit:${key}`)}`;
  }
  if (item.kind === "bias" && item.outletKey) return `${base}?p=${encodeURIComponent(`bias:${item.outletKey}`)}`;
  return base;
}

function Board() {
  const toast = useToast();
  const store = useExploreStore(
    useShallow((state) => ({
      items: state.dossier.items,
      order: state.dossier.order,
      edges: state.dossier.edges,
      dismissed: state.dossier.dismissed,
      events: state.events,
      moveItem: state.moveItem,
      removeItem: state.removeItem,
      connect: state.connect,
      updateEdgeLabel: state.updateEdgeLabel,
      removeEdge: state.removeEdge,
      dismissSuggestion: state.dismissSuggestion,
      addItem: state.addItem,
      updateNote: state.updateNote,
      importDossier: state.importDossier,
    })),
  );
  const [mode, setMode] = useState<"bord" | "lijst">("bord");
  const [selected, setSelected] = useState<string | null>(null);
  const [edgeToLabel, setEdgeToLabel] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const items = useMemo(() => store.order.map((id) => store.items[id]).filter(Boolean), [store.order, store.items]);
  const positions = useMemo(() => autoPlace(items), [items]);
  const suggestions = useMemo(() => computeSuggestions(items, store.edges, store.dismissed), [items, store.edges, store.dismissed]);
  const selectedItem = selected ? store.items[selected] : null;
  const recentEvents = useMemo(
    () =>
      Object.entries(store.events)
        .sort((a, b) => Date.parse(b[1].lastVisitedAt) - Date.parse(a[1].lastVisitedAt))
        .slice(0, 8),
    [store.events],
  );

  const connectItems = (source: string, target: string, label?: string, origin: "user" | "suggestion" = "user") => {
    const id = store.connect(source, target, label, origin);
    if (id) {
      setEdgeToLabel(id);
      setSelected(null);
    }
  };

  const onEdgeTap = (edgeId: string) => {
    if (edgeId.startsWith("suggestion:")) {
      const key = edgeId.slice("suggestion:".length);
      const suggestion = suggestions.find((candidate) => candidate.key === key);
      if (suggestion) {
        store.connect(suggestion.source, suggestion.target, suggestion.label, "suggestion");
        toast("Verband gelegd", { actionLabel: "Toch niet", onAction: () => store.dismissSuggestion(key) });
      }
      return;
    }
    setEdgeToLabel(edgeId);
  };

  const addNote = () => {
    const id = `note:${Date.now().toString(36)}`;
    store.addItem({ id, kind: "note", eventId: null, title: "Nieuwe notitie", text: "", keys: [] });
    setSelected(id);
  };

  const download = () => {
    const blob = new Blob([exportDossier()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `onderzoeksdossier-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const onImport = async (file: File) => {
    const result = store.importDossier(await file.text());
    toast(result.ok ? `${result.items} items geïmporteerd` : result.error);
  };

  const edgeBeingLabelled = edgeToLabel ? store.edges.find((edge) => edge.id === edgeToLabel) : null;

  return (
    <div data-explore className="fixed inset-0 z-40 flex flex-col bg-paper-100">
      <header className="space-y-2 border-b border-paper-300 bg-paper-50 px-3 pb-2 pt-[calc(env(safe-area-inset-top)+8px)]">
        <div className="flex items-center gap-2">
          <Link href="/" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-paper-200" aria-label="Terug naar het nieuws">
            <ArrowLeft size={20} />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-lg font-bold text-ink-900">Bewaard</h1>
            <p className="text-xs text-ink-500">
              {items.length} bewaard · {store.edges.length} verbanden · op dit apparaat
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMode(mode === "bord" ? "lijst" : "bord")}
            className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-paper-200"
            aria-label={mode === "bord" ? "Toon als lijst" : "Toon als bord"}
          >
            {mode === "bord" ? <List size={18} /> : <LayoutDashboard size={18} />}
          </button>
        </div>
        <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1">
          <Chip icon={<StickyNote size={14} />} onClick={addNote}>
            Notitie
          </Chip>
          <Chip icon={<Download size={14} />} onClick={download} disabled={items.length === 0}>
            Exporteer
          </Chip>
          <Chip icon={<Upload size={14} />} onClick={() => fileInput.current?.click()}>
            Importeer
          </Chip>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onImport(file);
              event.target.value = "";
            }}
          />
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {items.length === 0 ? (
          <div className="mx-auto max-w-md space-y-4 p-6 text-center">
            <p className="font-serif text-xl font-bold text-ink-900">Nog niets bewaard</p>
            {recentEvents.length ? (
              <div className="space-y-2 text-left">
                <Eyebrow>Laatst bekeken</Eyebrow>
                {recentEvents.map(([id, progress]) => (
                  <Link
                    key={id}
                    href={`/event/${encodeURIComponent(progress.slug ?? id)}`}
                    className="flex min-h-[44px] items-center justify-between rounded-xl border border-paper-300 bg-paper-50 px-3 text-sm"
                  >
                    <span className="font-medium">{progress.title}</span>
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        ) : mode === "bord" ? (
          <BoardCanvas
            items={items}
            positions={positions}
            edges={store.edges}
            suggestions={suggestions}
            selectedId={selected}
            onSelect={setSelected}
            onMove={store.moveItem}
            onConnect={(source, target) => connectItems(source, target)}
            onEdgeTap={onEdgeTap}
          />
        ) : (
          <BoardList items={items} onSelect={setSelected} />
        )}
      </div>

      {selectedItem ? (
        <div className="absolute inset-x-0 bottom-0 z-[41] max-h-[60dvh] overflow-y-auto rounded-t-3xl border-t border-paper-300 bg-paper-50 px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3 shadow-balloon">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-serif text-lg font-bold text-ink-900">{selectedItem.title}</p>
              {selectedItem.subtitle ? <p className="text-sm text-ink-500">{selectedItem.subtitle}</p> : null}
            </div>
            <button type="button" onClick={() => setSelected(null)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-paper-200" aria-label="Sluiten">
              <X size={18} />
            </button>
          </div>
          {selectedItem.kind === "note" ? (
            <textarea
              defaultValue={selectedItem.text ?? ""}
              onBlur={(event) => store.updateNote(selectedItem.id, event.target.value)}
              rows={4}
              placeholder="Wat valt je op? Welk verband zie je?"
              className="mt-3 w-full rounded-xl border border-paper-300 bg-white p-3 text-base sm:text-sm"
            />
          ) : selectedItem.text ? (
            <p className="mt-2 whitespace-pre-line text-sm text-ink-700">{selectedItem.text}</p>
          ) : null}
          {selectedItem.url ? (
            <a href={selectedItem.url} target="_blank" rel="noopener noreferrer" className="mt-2 block truncate text-sm text-accent-blue">
              {selectedItem.url}
            </a>
          ) : null}
          <div className="mt-3 space-y-2">
            <Eyebrow>Verbind met</Eyebrow>
            <div className="flex flex-wrap gap-1.5">
              {items
                .filter((other) => other.id !== selectedItem.id)
                .slice(0, 12)
                .map((other) => (
                  <Chip key={other.id} onClick={() => connectItems(selectedItem.id, other.id)}>
                    {other.title.slice(0, 40)}
                  </Chip>
                ))}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {itemHref(selectedItem) ? (
              <Link href={itemHref(selectedItem) as string} className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-ink-900 px-4 text-sm font-semibold text-white">
                <Pin size={14} /> Terug naar de bron
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => {
                store.removeItem(selectedItem.id);
                setSelected(null);
              }}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-red-200 px-4 text-sm font-semibold text-red-700"
            >
              <Trash2 size={14} /> Verwijder
            </button>
          </div>
        </div>
      ) : null}

      {edgeBeingLabelled ? (
        <div className="absolute inset-x-0 bottom-0 z-[42] space-y-3 rounded-t-3xl border-t border-paper-300 bg-paper-50 px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-4 shadow-balloon">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-ink-900">Wat voor verband is dit?</p>
            <button type="button" onClick={() => setEdgeToLabel(null)} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-paper-200" aria-label="Klaar">
              <X size={18} />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {LABEL_PRESETS.map((label) => (
              <Chip
                key={label}
                tone={edgeBeingLabelled.label === label ? "red" : "neutral"}
                onClick={() => {
                  store.updateEdgeLabel(edgeBeingLabelled.id, label);
                  setEdgeToLabel(null);
                }}
              >
                {label}
              </Chip>
            ))}
          </div>
          <input
            defaultValue={edgeBeingLabelled.label ?? ""}
            placeholder="Of beschrijf het zelf…"
            className="w-full rounded-xl border border-paper-300 bg-white px-3 py-2 text-base sm:text-sm"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                store.updateEdgeLabel(edgeBeingLabelled.id, event.currentTarget.value);
                setEdgeToLabel(null);
              }
            }}
          />
          <button
            type="button"
            onClick={() => {
              store.removeEdge(edgeBeingLabelled.id);
              setEdgeToLabel(null);
            }}
            className="text-sm font-semibold text-red-700"
          >
            Verband verwijderen
          </button>
        </div>
      ) : null}

      {mode === "bord" && suggestions.length > 0 && !selectedItem && !edgeBeingLabelled ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[41] flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+12px)]">
          <p className="pointer-events-auto rounded-full bg-orange-50 px-4 py-2 text-xs font-semibold text-orange-800 shadow">
            {suggestions.length} mogelijke {suggestions.length === 1 ? "verband" : "verbanden"} (oranje) · tik om te verbinden
          </p>
        </div>
      ) : null}
    </div>
  );
}

function BoardList({ items, onSelect }: { items: DossierItem[]; onSelect: (id: string) => void }) {
  const groups = new Map<string, DossierItem[]>();
  for (const item of items) {
    const key = item.eventTitle ?? "Zonder event";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return (
    <div className="h-full space-y-5 overflow-y-auto p-4 pb-32">
      {Array.from(groups.entries()).map(([title, list]) => (
        <section key={title} className="space-y-2">
          <Eyebrow>{title}</Eyebrow>
          <ul className="space-y-1.5">
            {list.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => onSelect(item.id)} className="flex min-h-[48px] w-full items-center gap-2 rounded-xl border border-paper-300 bg-paper-50 px-3 text-left text-sm">
                  <span className="flex-1 font-medium">{item.title}</span>
                  {item.subtitle ? <span className="text-xs text-ink-500">{item.subtitle}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function OnderzoekScreen() {
  const hydrated = useExploreHydration();
  if (!hydrated) {
    return <div className="p-6 text-sm text-ink-500">Bord laden…</div>;
  }
  return (
    <ToastProvider>
      <Board />
    </ToastProvider>
  );
}

