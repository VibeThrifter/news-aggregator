import { createLocalPm, sortRelations, type PmSlice } from "@/lib/explore/pm-local";
import { newsOnlyEntities, researchedIds, researchKeys } from "@/lib/explore/pm-seeds";
import { usePmStore } from "@/lib/explore/pm-store";
import type { EntityKind, EntityResearch, EventEntity, PmMatch, PmRelation } from "@/lib/types";
import {
  DEFAULT_HIDDEN_FILTERS,
  bundleNodeId,
  countBreakdown,
  countFilters,
  displayFilter,
  expansionFilters,
  filterNeighborhood,
  hoodKey,
  hoodKeyFilters,
  isDirected,
  isHistoric,
  mergeNeighborhoods,
  pickHood,
  countDirections,
  directionsFrom,
  expandedFiltersOf,
  hoodKeyDirection,
  influenceOf,
  newsNodeId,
  onSide,
  pmScene,
  proposalsOf,
  reasonKey,
  relationFilters,
  relationsByFilter,
  relationsOf,
  bySpecificity,
  routeParts,
  specificityOf,
  PM_EVENT_NODE,
  viewScene,
} from "@/lib/explore/pm-graph";

const slice: PmSlice = {
  meta: { version: "test", synced_at: "2026-09-30", entity_count: 5, relation_count: 7 },
  entities: [
    { id: 1, name: "DPG Media", type: "bedrijf", primary_filter: "eigendom", degree: 40, description: "Mediaconcern." },
    { id: 3, name: "AD (Algemeen Dagblad)", type: "mediaorganisatie", primary_filter: "eigendom", degree: 8 },
    { id: 7, name: "NU.nl", type: "mediaorganisatie", primary_filter: "advertentie", degree: 6 },
    { id: 50, name: "Jan Jansen", type: "persoon", primary_filter: "sourcing", degree: 2 },
    { id: 60, name: "PCM", type: "bedrijf", primary_filter: "eigendom", degree: 4 },
  ],
  relations: [
    { id: 100, source_id: 1, target_id: 3, relation_type: "eigendom", filter: "eigendom", source_count: 3, active_from: "2009" },
    { id: 101, source_id: 1, target_id: 7, relation_type: "eigendom", filter: "eigendom", source_count: 2, active_from: "2020-04-20" },
    { id: 102, source_id: 50, target_id: 7, relation_type: "personeel", filter: "sourcing", source_count: 1 },
    { id: 103, source_id: 60, target_id: 3, relation_type: "eigendom", filter: "eigendom", source_count: 1, active_until: "2009", description: "PCM was eigenaar." },
    { id: 104, source_id: 1, target_id: 50, relation_type: "lidmaatschap", filter: "ideologie", source_count: 0 },
    // Draaideur: cross-filter mechanism that belongs to three filters
    { id: 105, source_id: 50, target_id: 60, relation_type: "draaideur", filter: "cross_filter", filters: ["eigendom", "sourcing", "ideologie"], source_count: 1 },
    { id: 106, source_id: 7, target_id: 60, relation_type: "alliantie", filter: "cross_filter", filters: [], source_count: 1 },
  ],
  sources: { "relation:103": [{ title: "Bron", url: "https://example.org" }] },
  aliases: [
    { alias: "nu-nl", entity_id: 7 },
    { alias: "ad", entity_id: 3 },
    { alias: "algemeen-dagblad", entity_id: 3 },
    { alias: "jan-jansen", entity_id: 50 },
  ],
};

const pm = createLocalPm(slice);

describe("local propaganda-model RPC implementation", () => {
  it("matches aliases, searches and returns meta", () => {
    expect(pm.match(["ad", "onbekend", ""]).map((m) => m.entity_id)).toEqual([3]);
    expect(pm.search("dpg").map((e) => e.name)).toEqual(["DPG Media"]);
    expect(pm.search("a")).toEqual([]);
    expect(pm.search("dagblad")[0].id).toBe(3);
    expect(pm.meta().version).toBe("test");
  });

  it("returns neighbourhoods without descriptions, ordered by informativeness", () => {
    const hood = pm.neighborhood(1, 2)!;
    expect(hood.center.name).toBe("DPG Media");
    expect(hood.total).toBe(3);
    expect(hood.truncated).toBe(true);
    expect(hood.relations.map((r) => r.relation_type)).toEqual(["eigendom", "eigendom"]);
    expect(JSON.stringify(hood)).not.toContain("Mediaconcern");
    expect(pm.neighborhood(999)).toBeNull();
    expect(sortRelations(slice.relations)[0].relation_type).toBe("eigendom");
  });

  it("returns details with descriptions and sources on demand", () => {
    expect(pm.details("entity", 1)?.description).toBe("Mediaconcern.");
    const relation = pm.details("relation", 103)!;
    expect(relation.title).toBe("PCM → AD (Algemeen Dagblad)");
    expect(relation.sources).toHaveLength(1);
    expect(pm.details("relation", 999)).toBeNull();
    expect(pm.details("entity", 999)).toBeNull();
  });
});

describe("propaganda-model scene", () => {
  const merged = mergeNeighborhoods([pm.neighborhood(3)!, pm.neighborhood(7)!]);

  it("merges neighbourhoods", () => {
    expect(merged.entities.has(1)).toBe(true);
    expect(merged.totals.get(3)).toBe(2);
    expect(relationsByFilter(merged).get("eigendom")?.length).toBe(3);
  });

  it("builds a scene around the event with seeds and marks historic relations", () => {
    const scene = pmScene(merged, [{ id: 3, reason: "outlet", outletKey: "ad" }, { id: 7, reason: "outlet", outletKey: "nu-nl" }], new Set([3, 7]), {
      now: new Date("2026-09-30"),
    });
    expect(scene.nodes.some((node) => node.id === PM_EVENT_NODE)).toBe(true);
    expect(scene.edges.find((edge) => edge.relationId === 103)?.historic).toBe(true);
    expect(scene.edges.find((edge) => edge.relationId === 100)?.historic).toBe(false);
    expect(scene.edges.filter((edge) => edge.source === PM_EVENT_NODE)).toHaveLength(2);
  });

  it("hides filters and caps the number of nodes", () => {
    const hidden = pmScene(merged, [{ id: 3, reason: "outlet" }], new Set([3, 7]), { hiddenFilters: new Set(["eigendom"]) });
    expect(hidden.edges.every((edge) => edge.filter !== "eigendom")).toBe(true);
    const capped = pmScene(merged, [{ id: 3, reason: "outlet" }], new Set([3]), { maxNodes: 2 });
    expect(capped.nodes.filter((node) => !node.isEvent && !node.bundle)).toHaveLength(2);
    // What the cap drops from an expanded node ends up in its bundle
    expect(capped.bundles).toEqual([expect.objectContaining({ anchorId: 3, filter: "eigendom", count: 1 })]);
  });

  it("detects historic relations by date", () => {
    expect(isHistoric({ active_until: "2019-11-05" }, new Date("2026-01-01"))).toBe(true);
    expect(isHistoric({ active_until: null })).toBe(false);
    expect(isHistoric({ active_until: "2030" }, new Date("2026-01-01"))).toBe(false);
  });
});

describe("exploring neighbours per filter", () => {
  it("derives a relation's filters from its mechanism and primary filter", () => {
    expect(relationFilters({ filter: "cross_filter", filters: ["eigendom", "sourcing", "ideologie"] })).toEqual(["eigendom", "sourcing", "ideologie"]);
    expect(relationFilters({ filter: "sourcing", filters: ["flak"] })).toEqual(["sourcing", "flak"]);
    expect(relationFilters({ filter: "eigendom" })).toEqual(["eigendom"]);
    expect(relationFilters({ filter: "cross_filter", filters: [] })).toEqual([]);
    expect(countFilters(slice.relations)).toEqual({ eigendom: 4, sourcing: 2, ideologie: 2, overig: 1 });
  });

  it("counts per filter and restricts the neighbourhood to a set of filters", () => {
    const all = pm.neighborhood(50)!;
    expect(all.filters).toBeNull();
    expect(all.total).toBe(3);
    expect(all.filter_counts).toEqual({ sourcing: 2, ideologie: 2, eigendom: 1 });

    const viaEigendom = pm.neighborhood(50, 40, ["eigendom"])!;
    expect(viaEigendom.filters).toEqual(["eigendom"]);
    expect(viaEigendom.total).toBe(1);
    expect(viaEigendom.relations.map((relation) => relation.id)).toEqual([105]);
    expect(viaEigendom.entities.map((entity) => entity.id)).toEqual([60]);
    // Counts are always over all relations, whatever the filters
    expect(viaEigendom.filter_counts).toEqual(all.filter_counts);

    expect(pm.neighborhood(50, 40, ["eigendom", "ideologie"])!.total).toBe(2);
    expect(pm.neighborhood(7, 40, ["overig"])!.relations.map((relation) => relation.id)).toEqual([106]);
    expect(pm.neighborhood(7, 40, [])!.total).toBe(3);
    expect(pm.details("relation", 105)?.filters).toEqual(["eigendom", "sourcing", "ideologie"]);
  });

  it("keeps totals of unfiltered neighbourhoods and counts of any", () => {
    const merged = mergeNeighborhoods([pm.neighborhood(50, 40, ["eigendom"])!]);
    expect(merged.totals.has(50)).toBe(false);
    expect(merged.filterCounts.get(50)?.sourcing).toBe(2);
    const full = mergeNeighborhoods([pm.neighborhood(50, 40, ["eigendom"])!, pm.neighborhood(50)!]);
    expect(full.totals.get(50)).toBe(3);
    expect(relationsOf(full, 50, ["ideologie"]).map((relation) => relation.id).sort()).toEqual([104, 105]);
    expect(hoodKey(50, ["sourcing", "eigendom"])).toBe(hoodKey(50, ["eigendom", "sourcing"]));
    expect(hoodKey(50, [])).toBe("50");
  });

  it("expands via the filters that are switched on and keeps the new neighbours in view", () => {
    expect(expansionFilters(DEFAULT_HIDDEN_FILTERS)).toEqual(["eigendom", "sourcing", "ideologie"]);
    expect(expansionFilters([])).toBeNull();

    const merged = mergeNeighborhoods([pm.neighborhood(1)!, pm.neighborhood(50, 40, ["eigendom"])!]);
    const scene = pmScene(merged, [{ id: 1, reason: "outlet" }], new Set([1, 50]), {
      hiddenFilters: new Set(DEFAULT_HIDDEN_FILTERS),
      latest: { id: 50, filters: ["eigendom"] },
      maxNodes: 2,
    });
    // The cap never drops the neighbours of the latest expansion
    expect(scene.latestIds.sort()).toEqual(["pm:50", "pm:60"]);
    expect(scene.nodes.some((node) => node.pmId === 60)).toBe(true);
    const draaideur = scene.edges.find((edge) => edge.relationId === 105)!;
    expect(draaideur.filter).toBe("eigendom");
    expect(draaideur.filters).toEqual(["eigendom", "sourcing", "ideologie"]);
    expect(draaideur.directed).toBe(true);
  });

  it("shows only eigendom, sourcing and ideologie by default", () => {
    // the decision-making categories (Epic 15) start hidden too
    expect([...DEFAULT_HIDDEN_FILTERS].sort()).toEqual([
      "advertentie", "belangen", "flak", "formele_macht", "kennis_advies", "overig", "polder", "tegenmacht", "werving",
    ]);
    const merged = mergeNeighborhoods([pm.neighborhood(7)!]);
    const scene = pmScene(merged, [{ id: 7, reason: "outlet" }], new Set([7]), { hiddenFilters: new Set(DEFAULT_HIDDEN_FILTERS) });
    expect(scene.edges.some((edge) => edge.relationId === 106)).toBe(false); // overig
    expect(scene.edges.some((edge) => edge.relationId === 101)).toBe(true);
  });

  it("picks the edge colour and direction", () => {
    expect(displayFilter({ filter: "cross_filter", filters: ["eigendom", "ideologie"] }, { hidden: new Set(["eigendom"]) })).toBe("ideologie");
    expect(displayFilter({ filter: "sourcing", filters: ["flak"] })).toBe("sourcing");
    expect(displayFilter({ filter: "sourcing", filters: ["flak"] }, { prefer: "flak" })).toBe("flak");
    expect(isDirected({ relation_type: "eigendom" })).toBe(true);
    expect(isDirected({ relation_type: "eigendom", bidirectional: true })).toBe(false);
    expect(isDirected({ relation_type: "alliantie" })).toBe(false);
  });
});

describe("undo and redo while building the graph", () => {
  it("restores the exact graph, keeps fetched data for redo and ignores late loads", () => {
    const store = () => usePmStore.getState();
    store().reset(-1);
    store().putNeighborhood(pm.neighborhood(1)!, false); // seed
    expect(store().past).toHaveLength(0);

    // Expand node 50 via eigendom (one user action)
    store().record();
    store().setLatest({ id: 50, filters: ["eigendom"] });
    store().putNeighborhood(pm.neighborhood(50, 40, ["eigendom"])!, true, ["eigendom"]);
    expect(store().active).toEqual(["1", "50:eigendom"]);
    expect(store().expanded).toEqual([50]);

    const epoch = store().epoch;
    store().select("pm:50");
    store().undo();
    expect(store().active).toEqual(["1"]);
    expect(store().expanded).toEqual([]);
    expect(store().latest).toBeNull();
    expect(store().selected).toBeNull();
    expect(store().epoch).toBe(epoch + 1); // loads started before the undo stay out of the graph
    expect(store().neighborhoods["50:eigendom"]).toBeDefined(); // still cached: redo needs no fetch
    expect(store().future).toHaveLength(1);

    store().redo();
    expect(store().active).toEqual(["1", "50:eigendom"]);
    expect(store().latest).toEqual({ id: 50, filters: ["eigendom"] });

    // Filter toggles are undoable too, and a new action clears redo
    const hiddenBefore = store().hiddenFilters;
    store().toggleFilter("flak");
    expect(store().hiddenFilters).not.toContain("flak");
    expect(store().future).toHaveLength(0);
    store().undo();
    expect(store().hiddenFilters).toEqual(hiddenBefore);

    // Nothing to undo/redo is a no-op
    store().reset(-2);
    const state = store();
    store().undo();
    store().redo();
    expect(store().active).toBe(state.active);
  });
});

describe("bundles: a few neighbours per question, the rest as one +N", () => {
  const TYPES = ["overheidsinstelling", "persoon", "denktank"];
  const hub: PmSlice = {
    meta: { version: "test", synced_at: "2026-09-30", entity_count: 15, relation_count: 14 },
    entities: [
      { id: 200, name: "NOS", type: "omroep", primary_filter: "sourcing", degree: 40 },
      { id: 201, name: "De Telegraaf", type: "mediaorganisatie", primary_filter: "eigendom", degree: 20 },
      { id: 202, name: "NPO", type: "omroep", primary_filter: "eigendom", degree: 10 },
      // Twelve sources of NOS: the lower the number, the more connected in the model (the less specific)
      ...Array.from({ length: 12 }, (_, i) => ({ id: 301 + i, name: `Bron ${i + 1}`, type: TYPES[i % 3], primary_filter: "sourcing", degree: 30 - i })),
    ],
    relations: [
      { id: 900, source_id: 202, target_id: 200, relation_type: "eigendom", filter: "eigendom", filters: ["eigendom"], source_count: 2 },
      ...Array.from({ length: 12 }, (_, i) => ({
        id: 1000 + i,
        source_id: 301 + i,
        target_id: 200,
        relation_type: "bron_van",
        mechanism: i < 8 ? "Expert framing" : "Bron afhankelijkheid",
        filter: "sourcing",
        filters: ["sourcing"],
        source_count: 1,
      })),
      // Bron 1 also feeds De Telegraaf: a shared source
      { id: 1100, source_id: 301, target_id: 201, relation_type: "bron_van", mechanism: "Expert framing", filter: "sourcing", filters: ["sourcing"], source_count: 1 },
    ],
    sources: {},
    aliases: [],
  };
  const local = createLocalPm(hub);
  const hidden = new Set(DEFAULT_HIDDEN_FILTERS);
  const seeds = [
    { id: 200, reason: "outlet" as const, outletKey: "nos" },
    { id: 201, reason: "outlet" as const, outletKey: "telegraaf" },
  ];
  // NOS: seeded (6 relations) and expanded along Bronnen (8 of its 12 sources loaded); De Telegraaf only seeded
  const merged = mergeNeighborhoods([local.neighborhood(200, 6)!, local.neighborhood(200, 8, ["sourcing"])!, local.neighborhood(201, 6)!]);
  const expandedFilters = new Map([[200, new Set(["sourcing"])]]);
  const ids = (scene: ReturnType<typeof pmScene>) => scene.nodes.map((node) => node.pmId).filter((id): id is number => id !== null);

  it("counts with whom and how, per filter, over all relations", () => {
    const hood = local.neighborhood(200, 1)!;
    expect(hood.breakdown?.sourcing).toEqual({
      types: { denktank: 4, overheidsinstelling: 4, persoon: 4 },
      mechanisms: { "Expert framing": 8, "Bron afhankelijkheid": 4 },
    });
    expect(hood.breakdown?.eigendom).toEqual({ types: { omroep: 1 }, mechanisms: {} });
    expect(countBreakdown(hub.relations, 202, () => undefined).eigendom.types).toEqual({ onbekend: 1 });
  });

  it("draws the three most specific parties of an asked filter, shared sources always, and bundles the rest", () => {
    const scene = pmScene(merged, seeds, new Set([200]), { hiddenFilters: hidden, expandedFilters, latest: { id: 200, filters: ["sourcing"] } });
    // Bron 1 links NOS and De Telegraaf; Bron 6-8 are the least connected (most specific) of the rest.
    // Nothing is drawn along Eigendom: NOS was not asked about it (no NPO)
    expect(ids(scene).sort((a, b) => a - b)).toEqual([200, 201, 301, 306, 307, 308]);
    expect(scene.bundles).toHaveLength(1);
    const [bundle] = scene.bundles;
    expect(bundle).toMatchObject({ anchorId: 200, filter: "sourcing", count: 8 }); // 12 in the model, 4 drawn
    expect(bundle.members.map((relation) => relation.source_id)).toEqual([305, 304, 303, 302]); // loaded, most specific first
    const node = scene.nodes.find((item) => item.id === bundleNodeId(200, "sourcing"));
    expect(node?.label).toBe("+8");
    expect(scene.edges.find((edge) => edge.target === bundleNodeId(200, "sourcing"))).toMatchObject({ kind: "bundle", source: "pm:200", directed: false });
    // The view glides to the expansion including its bundle; not expanded along Eigendom: no bundle there
    expect(scene.latestIds).toContain(bundleNodeId(200, "sourcing"));
    expect(scene.bundles.some((item) => item.filter === "eigendom")).toBe(false);
  });

  it("draws nothing around a node you did not ask about", () => {
    const scene = pmScene(mergeNeighborhoods([local.neighborhood(200, 6)!]), [seeds[0]], new Set(), { hiddenFilters: hidden });
    expect(ids(scene)).toEqual([200]);
    expect(scene.bundles).toEqual([]);
  });

  it("draws small leftovers instead of bundling them", () => {
    const small = mergeNeighborhoods([local.neighborhood(200, 7, ["sourcing"])!]);
    // 7 of 12 loaded: 3 drawn, 4 loaded + 5 not loaded left: still a bundle
    expect(pmScene(small, [seeds[0]], new Set([200]), { hiddenFilters: hidden }).bundles[0].count).toBe(9);
    // Everything loaded and only one left over: drawn; two left over: a "+2" bundle
    const sources = local.neighborhood(200, 60, ["sourcing"])!;
    const complete = (n: number) => mergeNeighborhoods([{ ...sources, relations: sources.relations.slice(0, n), truncated: false, filter_counts: { sourcing: n } }]);
    const four = pmScene(complete(4), [seeds[0]], new Set([200]), { hiddenFilters: hidden });
    expect(four.bundles).toEqual([]);
    expect(ids(four)).toHaveLength(5);
    const five = pmScene(complete(5), [seeds[0]], new Set([200]), { hiddenFilters: hidden });
    expect(five.bundles.map((bundle) => bundle.count)).toEqual([2]);
    expect(ids(five)).toHaveLength(4);
  });

  it("always draws nodes taken out of a bundle", () => {
    const scene = pmScene(merged, seeds, new Set([200]), { hiddenFilters: hidden, expandedFilters, revealed: new Set([302]) });
    expect(ids(scene)).toContain(302);
    expect(scene.bundles[0].count).toBe(7);
  });

  it("always draws the routes you asked for, also through filters that are switched off", () => {
    // NOS - NPO (eigendom, not asked) - NOS ... a route from De Telegraaf to NPO via Bron 1 and NOS
    const route = { from: 201, to: 202, rank: 1, hops: 3, nodes: [201, 301, 200, 202], relations: [1100, 1000, 900], historic: false, shared_with: [] };
    const paths = {
      routes: [route],
      entities: hub.entities.filter((entity) => route.nodes.includes(entity.id)),
      relations: hub.relations.filter((relation) => route.relations.includes(relation.id)),
      truncated: false,
      max_hops: 3,
      at: "2026-10-01",
    };
    const graph = mergeNeighborhoods([local.neighborhood(201, 6)!], [paths]);
    const offEigendom = new Set([...Array.from(hidden), "eigendom"]);
    const scene = pmScene(graph, [seeds[1]], new Set(), { hiddenFilters: offEigendom, routeNodes: new Set(route.nodes), routeRelations: new Set(route.relations) });
    expect(ids(scene).sort((a, b) => a - b)).toEqual([200, 201, 202, 301]);
    expect(scene.edges.filter((edge) => edge.kind === "relation").map((edge) => edge.relationId as number).sort((a, b) => a - b)).toEqual([900, 1000, 1100]);
    // Without the route the NPO relation is hidden with its filter
    const plain = pmScene(graph, [seeds[1]], new Set(), { hiddenFilters: offEigendom });
    expect(ids(plain)).not.toContain(202);
  });

  it("reuses and restricts neighbourhoods by their store key", () => {
    expect(hoodKeyFilters("200:eigendom,sourcing")).toEqual(["eigendom", "sourcing"]);
    expect(hoodKeyFilters("200")).toBeNull();
    const all = local.neighborhood(200, 60)!;
    const eigendom = filterNeighborhood(all, ["eigendom"]);
    expect(eigendom.relations.map((relation) => relation.id)).toEqual([900]);
    expect(eigendom.entities.map((entity) => entity.id)).toEqual([202]);
    expect(eigendom).toMatchObject({ total: 1, truncated: false, filters: ["eigendom"] });
  });

  it("reveals a node from a bundle as one undoable step, adding only its relation", () => {
    const store = () => usePmStore.getState();
    store().reset(-3);
    store().putNeighborhood(local.neighborhood(200, 8, ["sourcing"])!, true, ["sourcing"]);
    const behind = local.neighborhood(200, 60, ["sourcing"])!;
    const relation = behind.relations.find((item) => item.source_id === 311)!;
    const [key, hood] = pickHood(behind.center, [relation], behind.entities, "sourcing");
    expect(key).toBe("200:sourcing#311");
    expect(hood.entities.map((entity) => entity.id)).toEqual([311]);
    expect(hood.filter_counts).toBeUndefined(); // never overrides the counts of the node

    store().reveal([311], { [key]: hood });
    expect(store().revealed).toEqual([311]);
    expect(store().active).toEqual(["200:sourcing", key]);
    const graph = mergeNeighborhoods(store().active.map((item) => store().neighborhoods[item]));
    expect(graph.relations.has(relation.id)).toBe(true);
    expect(graph.relations.size).toBe(9);

    store().undo();
    expect(store().revealed).toEqual([]);
    expect(store().active).toEqual(["200:sourcing"]);
    store().redo();
    expect(store().revealed).toEqual([311]);
    // Revealing what is already revealed is a no-op (no extra undo step)
    const past = store().past.length;
    store().reveal([311], {});
    expect(store().past).toHaveLength(past);
  });
});

describe("Epic 13: specific before connected, routes as undoable steps", () => {
  it("ranks a strong tie with a small party before a weak tie with a hub", () => {
    const hub = specificityOf({ id: 1, name: "ANP", degree: 60 }, 1, [{ relation_type: "beinvloeding", source_count: 5 }], "2026-10-01");
    const specific = specificityOf({ id: 2, name: "Teldersstichting", degree: 4 }, 2, [{ relation_type: "financiering", certainty_label: "aannemelijk", source_count: 1 }], "2026-10-01");
    expect([hub, specific].sort(bySpecificity).map((item) => item.name)).toEqual(["Teldersstichting", "ANP"]);
    // Not yet existing at the date: last
    const future = specificityOf({ id: 3, name: "Later", degree: 1 }, 3, [{ relation_type: "eigendom", active_from: "2030", source_count: 9 }], "2026-10-01");
    expect(future.score).toBe(0);
  });

  it("adds routes as one undoable step and glides to them", () => {
    const store = () => usePmStore.getState();
    store().reset(-4);
    const route = { from: 7, to: 3, rank: 1, hops: 2, nodes: [7, 1, 3], relations: [101, 100], historic: false, shared_with: [] };
    const paths = {
      routes: [route],
      entities: slice.entities.filter((entity) => route.nodes.includes(entity.id)),
      relations: slice.relations.filter((relation) => route.relations.includes(relation.id)),
      truncated: false,
      max_hops: 3,
      at: "2026-10-01",
    };
    store().putRoutes("start", paths, { glide: false });
    expect(store().activeRoutes).toEqual(["start"]);
    expect(store().latestRoutes).toBeNull();
    store().setLatest({ id: 7, filters: ["eigendom"] });

    store().record();
    store().putRoutes("pair:7:3", paths);
    expect(store().activeRoutes).toEqual(["start", "pair:7:3"]);
    expect(store().latestRoutes).toBe("pair:7:3");
    expect(store().latest).toBeNull();
    const parts = routeParts(store().activeRoutes.map((key) => store().routeSets[key]));
    expect(Array.from(parts.nodes).sort((a, b) => a - b)).toEqual([1, 3, 7]);
    expect(mergeNeighborhoods([], [paths]).relations.size).toBe(2);

    store().undo();
    expect(store().activeRoutes).toEqual(["start"]);
    expect(store().latest).toEqual({ id: 7, filters: ["eigendom"] });
    store().redo();
    expect(store().activeRoutes).toEqual(["start", "pair:7:3"]);
    // The fetched routes stay cached after undo, so redo needs no new request
    expect(Object.keys(store().routeSets).sort()).toEqual(["pair:7:3", "start"]);
  });
});

describe("proposals: what a step adds is see-through until you keep it", () => {
  // NOS and RTL are in the news; ANP feeds both (it links them), five small sources feed NOS only,
  // and one critic attacks NOS (flak, switched off by default)
  const steps: PmSlice = {
    meta: { version: "test", synced_at: "2026-10-03", entity_count: 9, relation_count: 8 },
    entities: [
      { id: 1, name: "NOS", type: "omroep", primary_filter: "sourcing", degree: 20 },
      { id: 2, name: "RTL Nieuws", type: "mediaorganisatie", primary_filter: "eigendom", degree: 10 },
      { id: 10, name: "ANP", type: "persbureau", primary_filter: "sourcing", degree: 50 },
      // The lower the degree, the more specific
      ...[11, 12, 13, 14, 15].map((id) => ({ id, name: `Bron ${id}`, type: "denktank", primary_filter: "sourcing", degree: id - 9 })),
      { id: 16, name: "Criticus", type: "persoon", primary_filter: "flak", degree: 1 },
    ],
    relations: [
      { id: 100, source_id: 10, target_id: 1, relation_type: "bron_van", filter: "sourcing", filters: ["sourcing"], source_count: 1 },
      { id: 101, source_id: 10, target_id: 2, relation_type: "bron_van", filter: "sourcing", filters: ["sourcing"], source_count: 1 },
      ...[11, 12, 13, 14, 15].map((id) => ({ id: 100 + id, source_id: id, target_id: 1, relation_type: "bron_van", filter: "sourcing", filters: ["sourcing"], source_count: 1 })),
      { id: 117, source_id: 16, target_id: 1, relation_type: "flak", filter: "flak", filters: ["flak"], source_count: 1 },
    ],
    sources: {},
    aliases: [],
  };
  const local = createLocalPm(steps);
  const store = () => usePmStore.getState();
  const scene = () => viewScene(store(), store());
  const drawn = () => scene().nodes.map((node) => node.id);
  const proposals = () => proposalsOf(scene(), store().pending, store().revealed);
  const bundleCount = () => scene().bundles.find((bundle) => bundle.anchorId === 1 && bundle.filter === "sourcing")?.count;

  /** The news: NOS and RTL, with ANP between them */
  const start = (eventId: number) => {
    store().reset(eventId);
    store().setSeeds([
      { id: 1, reason: "outlet", outletKey: "nos" },
      { id: 2, reason: "outlet", outletKey: "rtl" },
    ]);
    store().putNeighborhood(local.neighborhood(1, 40)!, false);
    store().putNeighborhood(local.neighborhood(2, 40)!, false);
  };
  /** "Wie praat mee?" about NOS, as the network asks it */
  const ask = (filter = "sourcing") => {
    const token = store().begin("ask");
    store().recall(1, filter);
    store().showFilter(filter);
    store().setLatest({ id: 1, filters: [filter] });
    store().putNeighborhood(local.neighborhood(1, 12, [filter])!, true, [filter]);
    return token;
  };

  it("proposes the three most specific answers and their bundle, see-through", () => {
    start(-20);
    expect(drawn().sort()).toEqual(["pm-event", "pm:1", "pm:10", "pm:2"]);
    expect(proposals().ghosts.size).toBe(0);

    ask();
    const now = proposals();
    expect(now.parties.sort((a, b) => a - b)).toEqual([11, 12, 13]);
    // Nothing kept yet: the question's bundle goes when it is withdrawn, so it is see-through too
    expect(Array.from(now.ghosts).sort()).toEqual(["bundle:1:sourcing", "pm:11", "pm:12", "pm:13"]);
    expect(now.withdraws).toBe(true);
    expect(bundleCount()).toBe(2);
  });

  it("keeps what you tap, takes the rest away (the bundle too) without moving the next one up, and undoes that", () => {
    start(-21);
    ask();
    store().keep("pm:12");
    expect(Array.from(proposals().ghosts).sort()).toEqual(["bundle:1:sourcing", "pm:11", "pm:13"]);
    expect(proposals().withdraws).toBe(false);

    store().dropRest();
    expect(store().pending).toBeNull();
    expect(drawn()).toContain("pm:12");
    expect(drawn()).not.toContain("pm:11");
    expect(drawn()).not.toContain("pm:13");
    // Bron 14 (the fourth) does not take a free place, and the bundle you did not tap went too
    expect(drawn()).not.toContain("pm:14");
    expect(bundleCount()).toBeUndefined();
    expect(store().dismissed[11]).toEqual([reasonKey.group(1, "sourcing")]);
    expect(store().dismissedBundles).toEqual(["1:sourcing"]);

    // Undo brings the proposals back as they were
    store().undo();
    expect(store().pending?.kept).toEqual(["pm:12"]);
    expect(Array.from(proposals().ghosts).sort()).toEqual(["bundle:1:sourcing", "pm:11", "pm:13"]);
    store().redo();
    expect(drawn()).not.toContain("pm:11");
  });

  it("keeps a bundle you tap, with what you did not keep in it", () => {
    start(-29);
    ask();
    store().keep("bundle:1:sourcing");
    expect(proposals().withdraws).toBe(false);
    store().dropRest();
    expect(drawn()).not.toContain("pm:11");
    expect(bundleCount()).toBe(5); // Bron 11-15
    // Weghalen takes it away (undoably)
    store().remove("bundle:1:sourcing");
    expect(bundleCount()).toBeUndefined();
    store().undo();
    expect(bundleCount()).toBe(5);
  });

  it("brings back what you took away of an answer when you ask the question again", () => {
    start(-30);
    ask();
    store().keep("pm:12");
    store().dropRest();
    expect(drawn()).not.toContain("bundle:1:sourcing");

    // Ask again: the bundle and the two sources come back as proposals; keep nothing and nothing changes
    ask();
    expect(Array.from(proposals().ghosts).sort()).toEqual(["bundle:1:sourcing", "pm:11", "pm:13"]);
    store().dropRest();
    expect(drawn()).toContain("pm:12");
    expect(drawn()).not.toContain("pm:11");
    expect(drawn()).not.toContain("bundle:1:sourcing");
    expect(store().dismissedBundles).toEqual(["1:sourcing"]);
  });

  it("withdraws a question of which you keep nothing", () => {
    start(-22);
    const before = { active: store().active, expanded: store().expanded, hidden: store().hiddenFilters };
    ask("flak");
    expect(store().hiddenFilters).not.toContain("flak");
    expect(proposals().parties).toEqual([16]);

    store().dropRest();
    expect(store().active).toEqual(before.active);
    expect(store().expanded).toEqual(before.expanded);
    expect(store().hiddenFilters).toEqual(before.hidden);
    expect(store().latest).toBeNull();
    expect(drawn().sort()).toEqual(["pm-event", "pm:1", "pm:10", "pm:2"]);
    expect(store().past).toHaveLength(2); // the question, and taking it away
  });

  it("settles the last step when you take the next one, and keeps all on request", () => {
    start(-23);
    ask();
    store().keep("pm:11");
    store().begin("routes");
    expect(store().pending?.kind).toBe("routes");
    expect(Object.keys(store().dismissed).map(Number).sort((a, b) => a - b)).toEqual([12, 13]);
    expect(store().dismissedBundles).toEqual(["1:sourcing"]);
    expect(store().pending?.base).toContain("pm:11");

    // Houd alle: everything stays, nothing is taken away
    start(-24);
    ask();
    store().keepAll();
    expect(store().pending).toBeNull();
    expect(store().dismissed).toEqual({});
    expect(drawn()).toEqual(expect.arrayContaining(["pm:11", "pm:12", "pm:13", "bundle:1:sourcing"]));
  });

  it("switches a filter the way the legend showed it, also when that withdraws a question", () => {
    start(-25);
    ask("flak"); // switches Flak on
    store().toggleFilter("flak"); // you switch it off again: the question goes, Flak stays off
    expect(store().hiddenFilters).toContain("flak");
    expect(store().expanded).toEqual([]);
    store().toggleFilter("flak");
    expect(store().hiddenFilters).not.toContain("flak");
  });

  it("ends a step that proposed nothing (yet) without taking anything away", () => {
    start(-26);
    const token = store().begin("ask");
    expect(store().pending?.token).toBe(token);
    store().dropRest(); // its load has not arrived: nothing to take away
    expect(store().pending).toBeNull();
    expect(store().dismissed).toEqual({});
    expect(drawn().sort()).toEqual(["pm-event", "pm:1", "pm:10", "pm:2"]);
    // The next step gets a new token, so a late load of this one stays out of the graph
    expect(store().begin("ask")).toBe(token + 1);
  });

  it("removes any node that is not the news' own or asked about, undoably", () => {
    start(-27);
    expect(drawn()).toContain("pm:10");
    store().remove("pm:1"); // NOS is the news' own: stays
    expect(store().past).toHaveLength(0);
    store().remove("pm:10");
    expect(drawn()).not.toContain("pm:10");
    expect(store().dismissed[10]).toEqual([reasonKey.link([1, 2])]);
    store().undo();
    expect(drawn()).toContain("pm:10");
  });

  it("brings a removed node back when something new points at it, and when you pick it from a bundle", () => {
    start(-28);
    ask();
    store().dropRest(); // nothing kept: withdrawn
    ask();
    store().keep("pm:11");
    store().dropRest();
    expect(drawn()).not.toContain("pm:12");

    // A route through Bron 12 is a new reason
    const route = { from: 2, to: 12, rank: 1, hops: 2, nodes: [2, 10, 12], relations: [101, 100], historic: false, shared_with: [] };
    const merged = mergeNeighborhoods([local.neighborhood(1, 40)!, local.neighborhood(2, 40)!, local.neighborhood(1, 12, ["sourcing"])!]);
    const options = {
      hiddenFilters: new Set(store().hiddenFilters),
      expandedFilters: new Map([[1, new Set(["sourcing"])]]),
      dismissed: store().dismissed,
    };
    const seeds = store().seeds;
    expect(pmScene(merged, seeds, new Set([1]), options).nodes.map((node) => node.id)).not.toContain("pm:12");
    const viaRoute = pmScene(merged, seeds, new Set([1]), { ...options, routeNodes: new Set(route.nodes), routeKeys: new Map([[12, ["pair:2:12"]]]) });
    expect(viaRoute.nodes.map((node) => node.id)).toContain("pm:12");

    // Taken out of the bundle: chosen, so back for good
    const behind = local.neighborhood(1, 60, ["sourcing"])!;
    const [key, hood] = pickHood(behind.center, behind.relations.filter((relation) => relation.source_id === 12), behind.entities, "sourcing");
    store().reveal([12], { [key]: hood });
    expect(store().dismissed[12]).toBeUndefined();
    expect(drawn()).toContain("pm:12");
  });

  it("draws the people and organisations of the news that are not in the model around Dit nieuws", () => {
    const result = pmScene(mergeNeighborhoods([]), [], new Set(), { newsNodes: [{ id: newsNodeId("person:sarah-dobbe"), label: "Sarah Dobbe" }] });
    expect(result.nodes.map((node) => node.id).sort()).toEqual(["news:person:sarah-dobbe", "pm-event"]);
    expect(result.edges).toEqual([expect.objectContaining({ kind: "news", source: "pm-event", target: "news:person:sarah-dobbe" })]);
  });
});

describe("every name of the news in the network", () => {
  const entity = (key: string, name: string, kind: EntityKind, salience: number, aliases: string[] = [key.split(":")[1]]): EventEntity => ({
    entity_key: key,
    name,
    kind,
    aliases,
    mention_count: Math.round(salience * 10),
    article_count: 1,
    outlet_counts: { "NU.nl": 1, NOS: 3 },
    salience,
  });
  const research = (key: string, row: Partial<EntityResearch>): EntityResearch => ({ entity_key: key, name: "", kind: "person", status: "nieuw", ...row });
  const input = {
    entities: [
      entity("person:david-van-weel", "David van Weel", "person", 0.36),
      entity("org:vvd", "VVD", "org", 0.05),
      entity("person:sarah-dobbe", "Sarah Dobbe", "person", 0.04),
      entity("person:lisa", "Lisa", "person", 0.04),
      entity("person:henk", "Henk", "person", 0.03),
      entity("org:algemene-rekenkamer", "Algemene Rekenkamer", "org", 0.02),
      entity("person:fons-lambie", "Fons Lambie", "person", 0.02),
      entity("group:excuses", "Excuses", "group", 0.02),
      entity("place:den-haag", "Den Haag", "place", 0.3),
    ],
  };
  const matches = [{ alias: "vvd", entity_id: 53, type: "partij", degree: 27 } as PmMatch];
  const rows = [
    research("person:david-van-weel", { status: "klaar", pm_entity_id: 1252 }),
    research("person:lisa", { status: "overgeslagen", role_category: "onbekend" }),
    research("person:henk", { status: "overgeslagen", role_category: "prive" }),
    research("person:fons-lambie", { status: "overgeslagen", status_reason: "buitenland", role_category: "journalist" }),
    research("person:sarah-dobbe", { status: "wachtrij", role_category: "politicus" }),
  ];

  it("adds what research found in the model, also under another name", () => {
    expect(researchedIds(rows)).toEqual([1252]);
    expect(researchedIds(rows, new Set([1252]))).toEqual([]);
    expect(researchKeys(input)).not.toContain("group:excuses");
  });

  it("draws every person and organisation not in the model, except private and too vague names", () => {
    const news = newsOnlyEntities(input, matches, rows);
    expect(news.map((item) => item.name)).toEqual(["Sarah Dobbe", "Algemene Rekenkamer", "Fons Lambie"]);
    expect(news[0]).toMatchObject({ id: "news:person:sarah-dobbe", kind: "person", outlets: ["NOS", "NU.nl"], research: { status: "wachtrij" } });
    // Without research everything that is not in the model is drawn
    expect(newsOnlyEntities(input, matches, null).map((item) => item.name)).toEqual([
      "David van Weel",
      "Sarah Dobbe",
      "Lisa",
      "Henk",
      "Algemene Rekenkamer",
      "Fons Lambie",
    ]);
  });
});

describe("influence: who has influence on a party, and on whom it has influence", () => {
  const dpg: PmSlice = {
    meta: { version: "test", synced_at: "2026-10-03", entity_count: 10, relation_count: 9 },
    entities: [
      { id: 1, name: "DPG Media", type: "bedrijf", primary_filter: "eigendom", degree: 30 },
      { id: 2, name: "Epifin", type: "bedrijf", primary_filter: "eigendom", degree: 2 },
      // Five titles it owns: the lower the degree, the more specific
      ...[3, 4, 5, 6, 7].map((id) => ({ id, name: `Titel ${id}`, type: "mediaorganisatie", primary_filter: "eigendom", degree: id })),
      { id: 8, name: "Albert Heijn", type: "bedrijf", primary_filter: "advertentie", degree: 9 },
      { id: 9, name: "Jan", type: "persoon", primary_filter: "ideologie", degree: 1 },
      { id: 10, name: "Mediahuis", type: "bedrijf", primary_filter: "eigendom", degree: 40 },
    ],
    relations: [
      { id: 200, source_id: 2, target_id: 1, relation_type: "eigendom", filter: "eigendom", filters: ["eigendom"], source_count: 2 },
      ...[3, 4, 5, 6, 7].map((id) => ({ id: 200 + id, source_id: 1, target_id: id, relation_type: "eigendom", filter: "eigendom", filters: ["eigendom"], source_count: 1 })),
      { id: 208, source_id: 8, target_id: 1, relation_type: "adverteerder", filter: "advertentie", filters: ["advertentie"], source_count: 1 },
      // "Jan werkt voor DPG Media": DPG Media has the influence
      { id: 209, source_id: 9, target_id: 1, relation_type: "personeel", filter: "ideologie", filters: ["ideologie"], source_count: 1 },
      // Works together: both ways
      { id: 210, source_id: 1, target_id: 10, relation_type: "alliantie", filter: "eigendom", filters: ["eigendom"], source_count: 1 },
    ],
    sources: {},
    aliases: [],
  };
  const local = createLocalPm(dpg);
  const relation = (id: number) => dpg.relations.find((item) => item.id === id) as PmRelation;
  const ids = (scene: ReturnType<typeof pmScene>) =>
    scene.nodes
      .filter((node) => !node.isEvent)
      .map((node) => node.id)
      .sort();

  it("reads the way of influence from the kind of relation", () => {
    expect(influenceOf(relation(203))).toEqual({ from: 1, to: 3 }); // owner on what it owns
    expect(influenceOf(relation(209))).toEqual({ from: 1, to: 9 }); // employer on employee
    expect(influenceOf(relation(210))).toBeNull(); // together
    expect(influenceOf({ ...relation(203), bidirectional: true })).toBeNull();
    expect(directionsFrom(relation(200), 1)).toEqual(["in"]);
    expect(directionsFrom(relation(200), 2)).toEqual(["out"]);
    expect(directionsFrom(relation(210), 1)).toEqual(["in", "out"]);
    expect(onSide(relation(209), 1, "out")).toBe(true);
    expect(onSide(relation(209), 1, "in")).toBe(false);
    expect(onSide(relation(209), 1, "any")).toBe(true);
  });

  it("counts and restricts neighbourhoods per way, like pm_neighborhood of migration 008", () => {
    const all = local.neighborhood(1, 40)!;
    expect(all.direction_counts).toEqual({ eigendom: { in: 2, out: 6 }, advertentie: { in: 1, out: 0 }, ideologie: { in: 0, out: 1 } });
    expect(countDirections(dpg.relations, 1)).toEqual(all.direction_counts);
    const owners = local.neighborhood(1, 40, ["eigendom"], "in")!;
    expect(owners.relations.map((item) => item.id).sort()).toEqual([200, 210]);
    expect(owners).toMatchObject({ direction: "in", total: 2, truncated: false });
    expect(owners.breakdown?.eigendom.types).toEqual({ bedrijf: 2 }); // Epifin and Mediahuis, not the titles
    expect(filterNeighborhood(all, ["eigendom"], "out").relations.map((item) => item.id).sort()).toEqual([203, 204, 205, 206, 207, 210]);
  });

  it("keys questions per way", () => {
    expect(hoodKey(1, ["eigendom"], "out")).toBe("1:eigendom@out");
    expect(hoodKeyFilters("1:eigendom@out")).toEqual(["eigendom"]);
    expect(hoodKeyFilters("1:eigendom@out#bundle")).toEqual(["eigendom"]);
    expect(hoodKeyDirection("1:eigendom@out#3,4")).toBe("out");
    expect(hoodKeyDirection("1:eigendom")).toBeNull();
    expect(expandedFiltersOf(["1", "1:eigendom@out", "1:advertentie", "1:eigendom@in#2"], [1])).toEqual(new Map([[1, new Set(["eigendom@out", "advertentie"])]]));
    expect(bundleNodeId(1, "eigendom", "in")).toBe("bundle:1:eigendom@in");
    expect(bundleNodeId(1, "eigendom")).toBe("bundle:1:eigendom");
  });

  it("answers one way only, with its own bundle on a line in that direction", () => {
    const seeds = [{ id: 1, reason: "actor" as const }];
    const outward = mergeNeighborhoods([local.neighborhood(1, 6)!, local.neighborhood(1, 12, ["eigendom"], "out")!]);
    const titles = pmScene(outward, seeds, new Set([1]), {
      expandedFilters: new Map([[1, new Set(["eigendom@out"])]]),
      latest: { id: 1, filters: ["eigendom"], direction: "out" },
    });
    // The three most specific titles; not its owner Epifin (that is the other question)
    expect(ids(titles)).toEqual(["bundle:1:eigendom@out", "pm:1", "pm:3", "pm:4", "pm:5"]);
    expect(titles.bundles).toEqual([expect.objectContaining({ anchorId: 1, filter: "eigendom", side: "out", count: 3 })]);
    expect(titles.edges.find((edge) => edge.kind === "bundle")).toMatchObject({ source: "pm:1", target: "bundle:1:eigendom@out", directed: true });
    expect(titles.latestIds).toContain("bundle:1:eigendom@out");
    expect(titles.reasons.get(3)).toEqual([reasonKey.group(1, "eigendom", "out")]);

    // Who has influence on it via eigendom: its owner (and its partner, both ways); nothing left to bundle
    const inward = mergeNeighborhoods([local.neighborhood(1, 6)!, local.neighborhood(1, 12, ["eigendom"], "in")!]);
    const owners = pmScene(inward, seeds, new Set([1]), { expandedFilters: new Map([[1, new Set(["eigendom@in"])]]) });
    expect(ids(owners)).toEqual(["pm:1", "pm:10", "pm:2"]);
    expect(owners.bundles).toEqual([]);

    // Nothing loaded yet: the bundle (its owners, counted per way) points at the party they have influence on
    const unloaded = pmScene(mergeNeighborhoods([{ ...local.neighborhood(1, 1, ["eigendom"], "in")!, relations: [] }]), seeds, new Set([1]), {
      expandedFilters: new Map([[1, new Set(["eigendom@in"])]]),
    });
    expect(unloaded.bundles).toEqual([expect.objectContaining({ side: "in", count: 2 })]);
    expect(unloaded.edges.find((edge) => edge.kind === "bundle")).toMatchObject({ source: "bundle:1:eigendom@in", target: "pm:1", directed: true });
  });
});
