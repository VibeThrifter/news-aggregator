/**
 * In-memory implementation of the propaganda-model RPC contract (migration 005), used for the demo
 * (demo-pm.json, a small slice of the real graph) and in tests. Mirrors pm_match / pm_search /
 * pm_neighborhood / pm_details / pm_meta_info, including the Epic 12 fields (pm_match.degree,
 * auto_approved on entities/relations, unreviewed on sources), and pm_paths (Epic 13, migration 007).
 */

import type { PmDetails, PmEntity, PmMatch, PmMeta, PmNeighborhood, PmPaths, PmRelation, PmSource } from "@/lib/types";

import { slugify } from "./normalize";
import { countBreakdown, countFilters, matchesFilters, relationFilters } from "./pm-graph";
import { findPaths, type PathOptions } from "./pm-paths";

export interface PmSlice {
  meta: PmMeta;
  entities: (PmEntity & { description?: string | null; slug?: string })[];
  relations: (PmRelation & { description?: string | null })[];
  sources: Record<string, PmSource[]>;
  aliases: { alias: string; entity_id: number }[];
}

/** Informative relation types first (same order as the pm_neighborhood SQL function). */
const TYPE_PRIORITY = ["eigendom", "financiering", "adverteerder", "flak", "bron_van", "beinvloeding", "draaideur", "bestuurder", "adviseur", "censuur", "mediaplatform", "personeel", "lidmaatschap"];

export function relationRank(relation: PmRelation): number {
  const index = TYPE_PRIORITY.indexOf(relation.relation_type);
  return index === -1 ? TYPE_PRIORITY.length : index;
}

export function sortRelations(relations: PmRelation[]): PmRelation[] {
  return [...relations].sort(
    (a, b) =>
      relationRank(a) - relationRank(b) ||
      b.source_count - a.source_count ||
      String(b.active_from ?? "").localeCompare(String(a.active_from ?? "")),
  );
}

function strip(entity: PmSlice["entities"][number]): PmEntity {
  return {
    id: entity.id,
    name: entity.name,
    type: entity.type,
    role: entity.role ?? null,
    primary_filter: entity.primary_filter ?? null,
    degree: entity.degree,
    active_from: entity.active_from ?? null,
    active_until: entity.active_until ?? null,
    ...(entity.auto_approved ? { auto_approved: true } : {}),
  };
}

/** A slice plus extra entities/relations (e.g. what the demo research "added"). */
export function extendSlice(base: PmSlice, extra: Partial<Omit<PmSlice, "meta">>): PmSlice {
  return {
    meta: base.meta,
    entities: [...base.entities, ...(extra.entities ?? [])],
    relations: [...base.relations, ...(extra.relations ?? [])],
    sources: { ...base.sources, ...(extra.sources ?? {}) },
    aliases: [...base.aliases, ...(extra.aliases ?? [])],
  };
}

function stripRelation(relation: PmSlice["relations"][number]): PmRelation {
  const copy: PmSlice["relations"][number] = { ...relation };
  delete copy.description;
  return copy;
}

export function createLocalPm(slice: PmSlice) {
  const entityById = new Map(slice.entities.map((entity) => [entity.id, entity]));
  let stripped: { entities: PmEntity[]; relations: PmRelation[] } | null = null;
  const graph = () => (stripped ??= { entities: slice.entities.map(strip), relations: slice.relations.map(stripRelation) });

  return {
    meta(): PmMeta {
      return slice.meta;
    },

    match(aliases: string[]): PmMatch[] {
      const wanted = new Set(aliases.filter(Boolean).slice(0, 100));
      const result: PmMatch[] = [];
      for (const row of slice.aliases) {
        if (!wanted.has(row.alias)) continue;
        const entity = entityById.get(row.entity_id);
        if (entity) result.push({ alias: row.alias, entity_id: entity.id, name: entity.name, type: entity.type, degree: entity.degree });
        if (result.length >= 50) break;
      }
      return result;
    },

    search(query: string, limit = 10): PmEntity[] {
      const q = query.trim().toLowerCase();
      if (q.length < 2) return [];
      const qSlug = slugify(q);
      const hits = slice.entities.filter(
        (entity) =>
          entity.name.toLowerCase().includes(q) ||
          slice.aliases.some((row) => row.entity_id === entity.id && row.alias.includes(qSlug)),
      );
      return hits
        .sort((a, b) => {
          const pa = a.name.toLowerCase() === q ? 0 : a.name.toLowerCase().startsWith(q) ? 1 : 2;
          const pb = b.name.toLowerCase() === q ? 0 : b.name.toLowerCase().startsWith(q) ? 1 : 2;
          return pa - pb || b.degree - a.degree;
        })
        .slice(0, Math.min(Math.max(limit, 1), 20))
        .map(strip);
    },

    neighborhood(entityId: number, limit = 40, filters: string[] | null = null): PmNeighborhood | null {
      const center = entityById.get(entityId);
      if (!center) return null;
      const touching = slice.relations.filter((relation) => relation.source_id === entityId || relation.target_id === entityId);
      const matching = touching.filter((relation) => matchesFilters(relation, filters));
      const relations = (sortRelations(matching) as PmSlice["relations"]).slice(0, Math.min(Math.max(limit, 1), 60));
      const neighbourIds = new Set<number>();
      for (const relation of relations) {
        neighbourIds.add(relation.source_id === entityId ? relation.target_id : relation.source_id);
      }
      return {
        center: strip(center),
        entities: Array.from(neighbourIds)
          .map((id) => entityById.get(id))
          .filter((entity): entity is NonNullable<typeof entity> => Boolean(entity))
          .map(strip),
        relations: relations.map(stripRelation),
        total: matching.length,
        truncated: matching.length > relations.length,
        filter_counts: countFilters(touching),
        breakdown: countBreakdown(touching, entityId, (id) => entityById.get(id)?.type),
        filters: filters?.length ? filters : null,
      };
    },

    paths(from: number[], to: number[], options: PathOptions = {}): PmPaths {
      const { entities, relations } = graph();
      return findPaths(entities, relations, from, to, options);
    },

    details(kind: "entity" | "relation", id: number): PmDetails | null {
      if (kind === "entity") {
        const entity = entityById.get(id);
        if (!entity) return null;
        return {
          kind,
          id,
          title: entity.name,
          type: entity.type,
          filter: entity.primary_filter ?? null,
          description: entity.description ?? null,
          active_from: entity.active_from ?? null,
          active_until: entity.active_until ?? null,
          sources: slice.sources[`entity:${id}`] ?? [],
          ...(entity.auto_approved ? { auto_approved: true } : {}),
        };
      }
      const relation = slice.relations.find((candidate) => candidate.id === id);
      if (!relation) return null;
      const source = entityById.get(relation.source_id);
      const target = entityById.get(relation.target_id);
      return {
        kind,
        id,
        title: `${source?.name ?? relation.source_id} → ${target?.name ?? relation.target_id}`,
        type: relation.relation_type,
        mechanism: relation.mechanism ?? null,
        filter: relation.filter ?? null,
        filters: relationFilters(relation),
        description: relation.description ?? null,
        active_from: relation.active_from ?? null,
        active_until: relation.active_until ?? null,
        certainty_label: relation.certainty_label ?? null,
        sources: slice.sources[`relation:${id}`] ?? [],
        ...(relation.auto_approved ? { auto_approved: true } : {}),
      };
    },
  };
}
