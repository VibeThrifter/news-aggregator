"use client";

import { useState } from "react";
import Link from "next/link";
import { FolderOpen, LayoutDashboard, StickyNote, Trash2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { useExploreStore, type DossierItem } from "@/lib/explore/store";

import { useExplore } from "../ExploreContext";
import { Eyebrow, Favicon, Tag } from "../ui/primitives";
import { Sheet } from "../ui/Sheet";

const KIND_LABELS: Record<DossierItem["kind"], string> = {
  outlet: "Bron",
  actor: "Actor",
  entity: "Entiteit",
  finding: "Bevinding",
  event: "Nieuws",
  pm: "Propagandamodel",
  note: "Notitie",
  bias: "Bias",
  country: "Land",
};

export function DossierSheet() {
  const { panel, pin, eventId } = useExplore();
  const { items, order, removeItem } = useExploreStore(
    useShallow((state) => ({ items: state.dossier.items, order: state.dossier.order, removeItem: state.removeItem })),
  );
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");

  const list = order.map((id) => items[id]).filter(Boolean);
  const here = list.filter((item) => item.eventId === eventId);
  const elsewhere = list.filter((item) => item.eventId !== eventId);

  const addNote = () => {
    const text = note.trim();
    if (!text) return;
    pin({
      id: `note:${Date.now().toString(36)}`,
      kind: "note",
      title: text.split("\n")[0].slice(0, 80),
      text,
      url: url.trim() || undefined,
      keys: [],
    });
    setNote("");
    setUrl("");
  };

  const renderItem = (item: DossierItem) => (
    <li key={item.id} className="flex items-start gap-3 rounded-xl border border-paper-300 bg-paper-50 p-3">
      {item.outletKey ? <Favicon name={item.title} size={18} className="mt-0.5" /> : <StickyNote size={18} className="mt-0.5 text-ink-400" />}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink-900">{item.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Tag>{KIND_LABELS[item.kind]}</Tag>
          {item.subtitle ? <span className="text-xs text-ink-500">{item.subtitle}</span> : null}
        </div>
        {item.kind === "note" && item.text && item.text !== item.title ? (
          <p className="mt-1 whitespace-pre-line text-xs text-ink-600">{item.text}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => removeItem(item.id)}
        className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-400 hover:text-red-600"
        aria-label={`Verwijder ${item.title}`}
      >
        <Trash2 size={16} />
      </button>
    </li>
  );

  return (
    <Sheet
      open
      onOpenChange={(open) => (!open ? panel.close() : undefined)}
      title="Bewaard"
      subtitle={`${list.length} bewaard · alleen op dit apparaat`}
      icon={<FolderOpen size={22} />}
      footer={
        <Link
          href="/onderzoek"
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full bg-ink-900 text-sm font-semibold text-white"
        >
          <LayoutDashboard size={16} /> Open het bord
        </Link>
      }
    >
      <div className="space-y-6">
        <section className="space-y-2 rounded-2xl border border-dashed border-paper-300 p-3">
          <Eyebrow>Notitie</Eyebrow>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            placeholder="Eigen notitie, vermoeden of vraag…"
            className="w-full rounded-xl border border-paper-300 bg-paper-50 p-3 text-base sm:text-sm"
          />
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            type="url"
            inputMode="url"
            placeholder="Link (optioneel)"
            className="w-full rounded-xl border border-paper-300 bg-paper-50 px-3 py-2 text-base sm:text-sm"
          />
          <button
            type="button"
            onClick={addNote}
            disabled={!note.trim()}
            className="min-h-[44px] rounded-full border border-paper-300 px-4 text-sm font-semibold text-ink-800 disabled:opacity-40"
          >
            Notitie bewaren
          </button>
        </section>

        {list.length === 0 ? <p className="text-sm text-ink-500">Nog niets bewaard</p> : null}
        {here.length ? (
          <section className="space-y-2">
            <Eyebrow>Uit dit nieuws</Eyebrow>
            <ul className="space-y-2">{here.map(renderItem)}</ul>
          </section>
        ) : null}
        {elsewhere.length ? (
          <section className="space-y-2">
            <Eyebrow>Uit ander nieuws</Eyebrow>
            <ul className="space-y-2">{elsewhere.map(renderItem)}</ul>
          </section>
        ) : null}
      </div>
    </Sheet>
  );
}
