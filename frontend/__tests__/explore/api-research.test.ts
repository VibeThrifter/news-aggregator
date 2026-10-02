/**
 * Epic 12 API: demo branches (simulated research, fictional pm additions) and graceful degradation
 * when the RPC functions of migration 006 do not exist yet.
 */

type Api = typeof import("@/lib/api");

function loadApi(options: { demo: boolean; rpc?: jest.Mock }): Api {
  let api: Api | null = null;
  const previous = process.env.NEXT_PUBLIC_ENABLE_DEMO;
  process.env.NEXT_PUBLIC_ENABLE_DEMO = options.demo ? "true" : "false";
  jest.isolateModules(() => {
    if (options.rpc) {
      const rpc = options.rpc;
      jest.doMock("@/lib/supabase", () => ({ getSupabase: () => ({ rpc }) }));
    }
    api = require("@/lib/api") as Api;
  });
  process.env.NEXT_PUBLIC_ENABLE_DEMO = previous;
  return api as unknown as Api;
}

afterEach(() => {
  jest.dontMock("@/lib/supabase");
});

describe("research API in the demo", () => {
  const api = loadApi({ demo: true });

  it("returns the fixture statuses and simulates a request", async () => {
    const rows = await api.getEntityResearch(["person:anouk-verbeek", "person:henk-de-boer", "org:onbekend"], { demo: true });
    expect(rows?.map((row) => [row.entity_key, row.status])).toEqual([
      ["person:anouk-verbeek", "klaar"],
      ["person:henk-de-boer", "overgeslagen"],
    ]);
    expect(rows?.[0].found).toEqual({ entities: 3, relations: 3, auto_approved: 2, pending: 1 });

    expect(await api.requestEntityResearch("person:henk-de-boer", "Henk de Boer", "person", "demo", { demo: true })).toEqual({
      ok: true,
      status: "overgeslagen",
      reason: "prive",
    });
    expect(await api.requestEntityResearch("org:nieuw-bedrijf", "Nieuw Bedrijf", "org", "demo", { demo: true })).toMatchObject({ ok: true, status: "wachtrij" });
    expect((await api.getEntityResearch(["org:nieuw-bedrijf"], { demo: true }))?.[0].status).toBe("wachtrij");
    expect(await api.getEntityResearch([], { demo: true })).toEqual([]);
  });

  it("serves the fictional research results from the demo propaganda model", async () => {
    const [match] = await api.pmMatch(["anouk-verbeek"], { demo: true });
    expect(match).toMatchObject({ entity_id: 900001, name: "Anouk Verbeek", type: "persoon", degree: 2 });
    const hood = await api.pmNeighborhood(900001, { demo: true, limit: 10 });
    expect(hood?.center.auto_approved).toBe(true);
    expect(hood?.relations.every((relation) => relation.auto_approved)).toBe(true);
    const details = await api.pmDetails("relation", 900102, { demo: true });
    expect(details?.auto_approved).toBe(true);
    expect(details?.sources[0].unreviewed).toBe(true);
    // Real entities of the slice keep their full network
    const [nos] = await api.pmMatch(["nos"], { demo: true });
    expect(nos.degree).toBeGreaterThanOrEqual(3);
  });

  it("finds co-occurrence and appearances without an event", async () => {
    const together = await api.getEntityCooccurrence(["anouk-verbeek", "verbeek"], { demo: true });
    expect(together.map((row) => row.name)).toContain("NordVind");
    const appearances = await api.getEntityAppearances(["nordvind"], 0, "org", { demo: true });
    expect(appearances.map((row) => row.event_slug)).toEqual(["demo"]); // one demo
  });
});

describe("research API before migration 006", () => {
  const missing = jest.fn().mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function public.entity_research_status" } });
  const api = loadApi({ demo: false, rpc: missing });

  it("degrades silently", async () => {
    expect(await api.getEntityResearch(["person:x"])).toBeNull();
    expect(await api.requestEntityResearch("person:x", "X", "person", null)).toBeNull();
    expect(await api.getEntityCooccurrence(["x"])).toEqual([]);
    expect(missing).toHaveBeenCalledWith("entity_research_status", { p_keys: ["person:x"] });
    expect(missing).toHaveBeenCalledWith("request_entity_research", { p_key: "person:x", p_name: "X", p_kind: "person", p_event_slug: null });
    expect(missing).toHaveBeenCalledWith("entity_cooccurrence", { p_aliases: ["x"], p_limit: 20 });
  });

  it("returns an empty list when the function exists but has no rows", async () => {
    const empty = jest.fn().mockResolvedValue({ data: null, error: null });
    const withFunctions = loadApi({ demo: false, rpc: empty });
    expect(await withFunctions.getEntityResearch(["person:x"])).toEqual([]);
  });
});
