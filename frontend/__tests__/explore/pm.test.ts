import { createLocalPm, sortRelations, type PmSlice } from "@/lib/explore/pm-local";
import { usePmStore } from "@/lib/explore/pm-store";
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
  pmScene,
  relationFilters,
  relationsByFilter,
  relationsOf,
  bySpecificity,
  routeParts,
  specificityOf,
  PM_EVENT_NODE,
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
    expect([...DEFAULT_HIDDEN_FILTERS].sort()).toEqual(["advertentie", "flak", "overig", "tegenmacht"]);
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
