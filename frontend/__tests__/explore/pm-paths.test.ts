import { createLocalPm, type PmSlice } from "@/lib/explore/pm-local";
import {
  PATH_LIMITS,
  compareIds,
  findPaths,
  hubFactor,
  periodEnd,
  periodStart,
  pickRoutes,
  referenceDate,
  relationStrength,
  relationWeight,
  uniqueRoutes,
} from "@/lib/explore/pm-paths";
import type { PmEntity, PmRelation } from "@/lib/types";

// A small model: two DPG titles, the NOS, the ANP as a hub, and NordVind (in the news) that advertises with DPG
const entities: PmEntity[] = [
  { id: 1, name: "NU.nl", type: "mediaorganisatie", degree: 3 },
  { id: 2, name: "AD", type: "mediaorganisatie", degree: 2 },
  { id: 3, name: "NOS", type: "omroep", degree: 1 },
  { id: 10, name: "DPG Media", type: "bedrijf", degree: 5 },
  { id: 11, name: "Sanoma", type: "bedrijf", degree: 2 },
  { id: 20, name: "ANP", type: "persbureau", degree: 60 },
  { id: 30, name: "NordVind", type: "bedrijf", degree: 3 },
];

const rel = (id: number, source_id: number, target_id: number, relation_type: string, extra: Partial<PmRelation> = {}): PmRelation => ({
  id,
  source_id,
  target_id,
  relation_type,
  source_count: 1,
  ...extra,
});

const relations: PmRelation[] = [
  rel(100, 10, 1, "eigendom", { certainty_label: "onderbouwd", active_from: "2020-04-20" }),
  rel(101, 10, 2, "eigendom", { certainty_label: "aannemelijk", active_from: "2009" }),
  rel(102, 30, 10, "adverteerder"),
  rel(103, 20, 1, "beinvloeding"),
  rel(104, 20, 2, "beinvloeding"),
  rel(105, 20, 3, "beinvloeding"),
  rel(106, 30, 20, "bron_van"),
  rel(107, 11, 1, "eigendom", { active_from: "1999", active_until: "2020" }),
  rel(108, 10, 11, "eigendom", { active_from: "2020" }),
  // A weaker second tie between NordVind and DPG: the same route counts once
  rel(109, 30, 10, "lobbyt"),
];

const AT = "2026-10-01";
const paths = (from: number[], to: number[], options = {}) => findPaths(entities, relations, from, to, { at: AT, ...options });

describe("route weights", () => {
  it("weighs kinds of relation, certainty and history", () => {
    expect(relationStrength("eigendom")).toBe(1);
    expect(relationStrength("beinvloeding")).toBe(0.4);
    expect(relationStrength("iets_nieuws")).toBe(0.4);
    expect(relationWeight(relations[0], AT)).toEqual({ weight: 1, historic: false });
    expect(relationWeight(relations[2], AT)).toEqual({ weight: 0.8 * 0.7 * 1, historic: false });
    expect(relationWeight(relations[7], AT)).toEqual({ weight: 1 * 0.7 * 0.5, historic: true });
    // Not yet active at the reference date
    expect(relationWeight(relations[0], "2019-12-31")).toBeNull();
  });

  it("reads partial dates as periods and falls back to today", () => {
    expect(periodStart("2020")).toBe("2020-01-01");
    expect(periodStart("2020-04")).toBe("2020-04-01");
    expect(periodStart("2020-04-20T00:00:00")).toBe("2020-04-20");
    expect(periodStart(" ")).toBeNull();
    expect(periodEnd("2020")).toBe("2020-12-31");
    expect(periodEnd("2020-04")).toBe("2020-04-31");
    expect(referenceDate("2025-01-02")).toBe("2025-01-02");
    expect(referenceDate("gisteren", new Date("2026-10-01T12:00:00Z"))).toBe("2026-10-01");
  });

  it("gives hubs a small factor and orders id lists like PostgreSQL", () => {
    expect(hubFactor(3)).toBe(0.5);
    expect(hubFactor(60)).toBeLessThan(hubFactor(5));
    expect(hubFactor(null)).toBe(1);
    expect(compareIds([1, 2], [1, 3])).toBeLessThan(0);
    expect(compareIds([1, 2], [1, 2, 0])).toBeLessThan(0);
    expect(compareIds([2], [1, 9])).toBeGreaterThan(0);
  });
});

describe("findPaths", () => {
  it("puts a specific route before one through a hub, and marks history", () => {
    const result = paths([1], [30]);
    expect(result.routes.map((route) => route.nodes)).toEqual([
      [1, 10, 30],
      [1, 11, 10, 30],
    ]);
    expect(result.routes.map((route) => route.rank)).toEqual([1, 2]);
    expect(result.routes[1].historic).toBe(true);
    // The strongest tie between DPG and NordVind is used, the weaker one is not a second route
    expect(result.routes[0].relations).toEqual([100, 102]);
    expect(result.relations.map((relation) => relation.id)).toEqual([100, 102, 107, 108]);
    expect(result.entities.map((entity) => entity.id)).toEqual([1, 10, 11, 30]);
    expect(result.truncated).toBe(false);
    expect(result.at).toBe(AT);
  });

  it("returns more routes per pair on request, the hub route last", () => {
    const result = paths([1], [30], { limit: 5 });
    expect(result.routes.map((route) => route.nodes)).toEqual([
      [1, 10, 30],
      [1, 11, 10, 30],
      [1, 20, 30],
    ]);
  });

  it("tells which other outlets share the same explanation", () => {
    const result = paths([1, 2, 3], [30], { limit: 3 });
    const byFrom = (from: number, via: number) => result.routes.find((route) => route.from === from && route.nodes[1] === via);
    // Both DPG titles: owned by DPG, which NordVind advertises with
    expect(byFrom(1, 10)?.shared_with).toEqual([2]);
    expect(byFrom(2, 10)?.shared_with).toEqual([1]);
    // Everyone gets it from the ANP: explains no difference
    expect(byFrom(3, 20)?.shared_with).toEqual([1, 2]);
    // The Sanoma chain is NU.nl's own
    expect(result.routes.find((route) => route.from === 1 && route.nodes[1] === 11)?.shared_with).toEqual([]);
  });

  it("never passes through one of the given entities", () => {
    const result = paths([1], [30, 10], { limit: 5 });
    expect(result.routes.filter((route) => route.to === 30).map((route) => route.nodes)).toEqual([[1, 20, 30]]);
    // AD is not one of the given entities here, so the ANP → AD → DPG detour is a (weak) route
    expect(result.routes.filter((route) => route.to === 10).map((route) => route.nodes)).toEqual([
      [1, 10],
      [1, 11, 10],
      [1, 20, 2, 10],
    ]);
  });

  it("looks at the model as it was on the reference date", () => {
    const result = paths([1], [30], { at: "2015-06-01", limit: 5 });
    expect(result.routes.map((route) => route.nodes)).toEqual([[1, 20, 30]]);
    expect(result.routes[0].historic).toBe(false);
  });

  it("respects the number of hops and ignores unknown or duplicate ids", () => {
    expect(paths([1], [30], { maxHops: 1 }).routes).toEqual([]);
    expect(paths([1], [10], { maxHops: 1 }).routes.map((route) => route.relations)).toEqual([[100]]);
    expect(paths([999, 1, 1], [30, 999]).routes[0].from).toBe(1);
    expect(paths([], [30]).routes).toEqual([]);
    expect(paths([1], [1]).routes).toEqual([]);
    expect(paths([1], [30], { maxHops: 9 }).max_hops).toBe(3);
  });

  it("caps the routes per call", () => {
    const many: PmEntity[] = Array.from({ length: 60 }, (_, i) => ({ id: 1000 + i, name: `P${i}`, type: "persoon", degree: 12 }));
    const ties: PmRelation[] = [];
    for (let f = 0; f < 12; f++) {
      for (let t = 12; t < 60; t++) ties.push(rel(5000 + f * 100 + t, 1000 + f, 1000 + t, "personeel"));
    }
    const from = many.slice(0, 20).map((entity) => entity.id);
    const to = many.slice(12).map((entity) => entity.id);
    const result = findPaths(many, ties, from, to, { at: AT, maxHops: 1 });
    expect(result.routes).toHaveLength(PATH_LIMITS.routes);
    expect(result.truncated).toBe(true);
    // Only the first 12 `from` ids and 40 `to` ids are used
    expect(Math.max(...result.routes.map((route) => route.from))).toBeLessThan(1012);
    expect(Math.max(...result.routes.map((route) => route.to))).toBeLessThan(1052);
  });

  it("is deterministic and counts a route and its mirror once", () => {
    const a = paths([1, 30], [1, 30], { limit: 2 });
    const b = paths([30, 1], [30, 1], { limit: 2 });
    expect(a).toEqual(b);
    const unique = uniqueRoutes(a.routes);
    expect(unique.length).toBe(a.routes.length / 2);
  });
});

describe("picking routes to draw", () => {
  it("puts what distinguishes before what everyone shares, and keeps only what is on the chosen routes", () => {
    const all = paths([1, 2, 3], [30], { limit: 3 });
    const picked = pickRoutes(all, 2);
    // NU.nl's own Sanoma chain (shared with nobody) first, then a DPG route (shared with one); the ANP routes (shared by all) drop out
    expect(picked.routes.map((route) => route.nodes)).toEqual([
      [1, 11, 10, 30],
      [1, 10, 30],
    ]);
    expect(picked.entities.map((entity) => entity.id)).toEqual([1, 10, 11, 30]);
    expect(picked.relations.map((relation) => relation.id)).toEqual([100, 102, 107, 108]);
    // A route and its mirror count once
    const both = paths([1, 30], [1, 30], { limit: 1 });
    expect(pickRoutes(both, 10).routes).toHaveLength(1);
  });
});

describe("pm_paths in the demo", () => {
  const slice: PmSlice = {
    meta: { version: "test", synced_at: AT, entity_count: entities.length, relation_count: relations.length },
    entities: entities.map((entity) => ({ ...entity, description: "niet in routes" })),
    relations: relations.map((relation) => ({ ...relation, description: "niet in routes" })),
    sources: {},
    aliases: [],
  };

  it("returns the same routes as the pure function, without descriptions", () => {
    const local = createLocalPm(slice);
    const result = local.paths([1], [30], { at: AT });
    expect(result.routes).toEqual(paths([1], [30]).routes);
    expect(result.relations.every((relation) => !("description" in relation))).toBe(true);
    expect(result.entities.every((entity) => !("description" in entity))).toBe(true);
  });
});
