"use client";

import { Pin, UserRound } from "lucide-react";

import { actorKeys } from "@/lib/explore/normalize";
import type { EventEntity } from "@/lib/types";

import { dossierIds, useExplore } from "../ExploreContext";
import { SpeakerCard } from "../map/PeopleCards";
import { PmSection } from "../network/PmSection";
import { SubHeading } from "../ui/primitives";
import { Sheet } from "../ui/Sheet";
import { ArticleSearch, EntityCoverage, MentionsByOutlet } from "./ArticleMentions";
import { WikipediaBlock } from "./Wikipedia";

const KIND_LABELS: Record<EventEntity["kind"], string> = {
  person: "Persoon",
  org: "Organisatie",
  place: "Plaats",
  country: "Land",
  group: "Groep",
  event: "Gebeurtenis",
};

function findEntity(entities: EventEntity[], key: string): EventEntity | undefined {
  return entities.find(
    (entity) => entity.entity_key === key || entity.aliases.includes(key) || entity.entity_key.endsWith(`:${key}`),
  );
}

export function EntitySheet({ entityKey }: { entityKey: string }) {
  const { exploration, panel, pin, eventId } = useExplore();
  const { input } = exploration;
  const entity = findEntity(input.entities, entityKey);
  const name = entity?.name ?? panel.param("n") ?? entityKey.replace(/-/g, " ");
  const keys = actorKeys(name, { person: entity?.kind === "person" });
  const aliases = Array.from(new Set([...(entity?.aliases ?? []), ...keys.aliases, entityKey]));

  // Where this person or organisation speaks in this news (one entry per outlet)
  const speaking = exploration.speakers.speakers.filter(
    (speaker) =>
      (entity && speaker.entityKey === entity.entity_key) || speaker.slug === entityKey || aliases.includes(speaker.slug),
  );

  return (
    <Sheet
      open
      onOpenChange={(open) => (!open ? panel.close() : undefined)}
      title={name}
      subtitle={entity ? KIND_LABELS[entity.kind] : undefined}
      icon={<UserRound size={22} />}
      footer={
        <button
          type="button"
          onClick={() =>
            pin({
              id: entity ? dossierIds.entity(entity.entity_key) : dossierIds.actor(keys.slug),
              kind: entity ? "entity" : "actor",
              eventId: null,
              refId: entity?.entity_key ?? keys.slug,
              title: name,
              subtitle: entity ? KIND_LABELS[entity.kind] : undefined,
              iso: entity?.iso_code ?? undefined,
              keys: [...aliases.map((alias) => `alias:${alias}`), ...(entity ? [`entity:${entity.entity_key}`] : [`actor:${keys.slug}`])],
            })
          }
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full bg-ink-900 text-sm font-semibold text-white"
        >
          <Pin size={16} /> Bewaar
        </button>
      }
    >
      <div className="space-y-6">
        {speaking.length ? (
          <section className="space-y-3">
            <SubHeading>In dit nieuws</SubHeading>
            {speaking.map((speaker) => (
              <div key={speaker.id} className="rounded-2xl border border-paper-300 p-3">
                <SpeakerCard speakerId={speaker.id} inSheet />
              </div>
            ))}
          </section>
        ) : null}

        <MentionsByOutlet entity={entity} name={name} />

        <section className="space-y-2">
          <SubHeading>Achtergrond</SubHeading>
          <WikipediaBlock key={name} name={name} />
        </section>

        <PmSection aliases={aliases} name={name} kind={entity?.kind ?? null} entityKey={entityKey} entity={entity} />

        <EntityCoverage aliases={aliases} kind={entity?.kind ?? null} excludeEventId={eventId} title="Ook in ander nieuws" />

        <ArticleSearch key={name} initialQuery={name} />

      </div>
    </Sheet>
  );
}
