"use client";

import { Pin, UserRound } from "lucide-react";

import { CLUE_TYPE_LABELS } from "@/lib/explore/clues";
import { actorKeys } from "@/lib/explore/normalize";
import type { EventEntity } from "@/lib/types";

import { SPOOR_COLORS, dossierIds, useExplore } from "../ExploreContext";
import { PmSection } from "../network/PmSection";
import { Eyebrow, Tag } from "../ui/primitives";
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
  const { exploration, panel, pin, isRevealed, eventId } = useExplore();
  const { input, clues, index } = exploration;
  const entity = findEntity(input.entities, entityKey);
  const name = entity?.name ?? panel.param("n") ?? entityKey.replace(/-/g, " ");
  const keys = actorKeys(name, { person: entity?.kind === "person" });
  const aliases = Array.from(new Set([...(entity?.aliases ?? []), ...keys.aliases, entityKey]));

  const related = clues.filter((clue) =>
    clue.links.some(
      (link) => link === `actor:${entityKey}` || aliases.some((alias) => link === `actor:${alias}`) || (entity && link === `entity:${entity.entity_key}`),
    ),
  );

  return (
    <Sheet
      open
      onOpenChange={(open) => (!open ? panel.close() : undefined)}
      title={name}
      subtitle={entity ? KIND_LABELS[entity.kind] : "In dit nieuws"}
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
          <Pin size={16} /> Bewaar in dossier
        </button>
      }
    >
      <div className="space-y-6">
        {related.length ? (
          <section className="space-y-2">
            <Eyebrow>Rol in dit nieuws</Eyebrow>
            <ul className="space-y-1">
              {related.map((clue) => (
                <li key={clue.id}>
                  <button
                    type="button"
                    onClick={() => panel.open(`spoor:${clue.spoor}`, { c: clue.id })}
                    className="flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-paper-300 px-3 text-left text-sm hover:bg-paper-100"
                  >
                    <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: SPOOR_COLORS[clue.spoor] }} />
                    <span className="flex-1">{clue.teaser.title}</span>
                    <Tag>{isRevealed(clue.id) ? CLUE_TYPE_LABELS[clue.type] : "?"}</Tag>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <MentionsByOutlet entity={entity} name={name} />

        <section className="space-y-2">
          <Eyebrow>Achtergrond</Eyebrow>
          <WikipediaBlock key={name} name={name} />
        </section>

        <PmSection aliases={aliases} name={name} kind={entity?.kind ?? null} entityKey={entityKey} entity={entity} />

        <EntityCoverage aliases={aliases} kind={entity?.kind ?? null} excludeEventId={eventId} title="Ook in ander nieuws" />

        <ArticleSearch key={name} initialQuery={name} />

        {index && !entity && related.length === 0 ? (
          <p className="text-sm text-ink-500">Over {name} is in deze analyse verder niets bekend.</p>
        ) : null}
      </div>
    </Sheet>
  );
}
