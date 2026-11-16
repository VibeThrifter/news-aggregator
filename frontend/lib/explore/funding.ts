/**
 * "Wie betaalt" for a quoted authority, from the propaganda model instead of the analysis's memory
 * (owner 2026-11-16, "bouw alles"). The pm holds who funds an organisation as relations into it:
 * `financiering` (a ministry's subsidies from Rijksfinanciën, register `subsidies`; a funder of a
 * think tank) and `donor` (gifts). Each relation is sourced and approved; `functie` carries the
 * amounts per year as the register gives them ("Subsidie volgens Rijksfinanciën: 2023 € 30.000").
 * Pure.
 */

import type { PmNeighborhood, PmRelation } from "@/lib/types";

export const FUNDING_TYPES = new Set(["financiering", "donor"]);
/** At most this many funders under one authority */
export const MAX_FUNDERS = 5;

export interface FundingLine {
  relationId: number;
  funderId: number;
  funder: string;
  /** The amounts as the register gives them, or null */
  detail: string | null;
  from: string | null;
  until: string | null;
}

function lastYear(line: FundingLine): string {
  return line.until ?? "9999";
}

/** The funders of `entityId` in a neighbourhood: relations of a funding type that end at it. */
export function fundingOf(hood: PmNeighborhood | null | undefined, entityId: number): FundingLine[] {
  if (!hood) return [];
  const names = new Map(hood.entities.map((entity) => [entity.id, entity.name]));
  names.set(hood.center.id, hood.center.name);
  const lines = hood.relations
    .filter((relation: PmRelation) => FUNDING_TYPES.has(relation.relation_type) && relation.target_id === entityId && relation.source_id !== entityId)
    .map((relation) => ({
      relationId: relation.id,
      funderId: relation.source_id,
      funder: names.get(relation.source_id) ?? "",
      detail: relation.functie?.trim() || null,
      from: relation.active_from ?? null,
      until: relation.active_until ?? null,
    }))
    .filter((line) => line.funder);
  // still running first, then the most recent, then the earliest start; ties by name
  lines.sort(
    (a, b) =>
      lastYear(b).localeCompare(lastYear(a)) || (b.from ?? "").localeCompare(a.from ?? "") || a.funder.localeCompare(b.funder, "nl"),
  );
  return lines.slice(0, MAX_FUNDERS);
}

/** "Ministerie van Buitenlandse Zaken: Subsidie volgens Rijksfinanciën: 2023 € 30.000" */
export function fundingLabel(line: FundingLine): string {
  if (line.detail) return `${line.funder}: ${line.detail}`;
  const period = line.from ? (line.until && line.until !== line.from ? ` (${line.from}–${line.until})` : line.until ? ` (${line.from})` : ` (sinds ${line.from})`) : "";
  return `${line.funder} financiert${period}`;
}
