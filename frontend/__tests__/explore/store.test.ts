import { safeStorage, onStorageQuotaExceeded } from "@/lib/explore/storage";
import { STORE_KEY, exportDossier, migrateState, sanitizeOwn, sanitizeOwnEntry, sanitizePrefs, useExploreStore } from "@/lib/explore/store";
import type { OwnEntry } from "@/lib/explore/types";

const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: "outlet" as const,
  eventId: 1,
  title: id,
  keys: [`outlet:${id}`],
  ...extra,
});

beforeEach(() => {
  window.localStorage.clear();
  useExploreStore.setState({
    events: {},
    own: {},
    dossier: { items: {}, order: [], edges: [], dismissed: [] },
    compare: { eventId: null, a: null, b: null },
  });
});

const own = (id: string, extra: Partial<OwnEntry> = {}): OwnEntry => ({
  id: `own:${id}`,
  kind: "gap",
  text: `Stem ${id}`,
  createdAt: "2026-10-03T10:00:00.000Z",
  ...extra,
});

describe("exploration store", () => {
  it("remembers the outlets chosen per event", () => {
    const store = useExploreStore.getState();
    store.touchEvent(7, { slug: "zeven", title: "Zeven" });
    store.setOutletShown(7, { key: "dw", isInternational: true }, true);
    store.setOutletShown(7, { key: "nos", isInternational: false }, false);
    expect(useExploreStore.getState().events["7"].sources).toEqual({ added: ["dw"], removed: ["nos"] });
    store.touchEvent(7, { slug: "zeven", title: "Zeven" });
    expect(useExploreStore.getState().events["7"].sources?.added).toEqual(["dw"]);
  });

  it("migrates v1 data: quest state goes, clue items become findings with the same id", () => {
    const v1 = {
      events: { "7": { revealed: ["a"], completed: ["wat-klopt-niet"], lastVisitedAt: "2026-09-30T10:00:00Z", slug: "zeven", title: "Zeven" } },
      dossier: {
        items: {
          "clue:7:wat-klopt-niet:claim:abc": {
            id: "clue:7:wat-klopt-niet:claim:abc",
            kind: "clue",
            spoor: "wat-klopt-niet",
            refId: "wat-klopt-niet:claim:abc",
            eventId: 7,
            title: "Een claim",
            keys: [],
            addedAt: "2026-09-30T10:00:00Z",
          },
          "outlet:nos": { id: "outlet:nos", kind: "outlet", eventId: null, title: "NOS", keys: [], addedAt: "2026-09-30T10:00:00Z" },
        },
        order: ["clue:7:wat-klopt-niet:claim:abc", "outlet:nos"],
        edges: [{ id: "e1", source: "clue:7:wat-klopt-niet:claim:abc", target: "outlet:nos", origin: "user" }],
        dismissed: ["x"],
      },
      prefs: { heroLens: "frame", questMode: true, seenHints: ["bubbles"], listMode: true, networkLens: "actoren" },
    };
    const migrated = migrateState(v1);
    expect(migrated.events["7"]).toEqual({ lastVisitedAt: "2026-09-30T10:00:00Z", slug: "zeven", title: "Zeven" });
    const clue = migrated.dossier.items["clue:7:wat-klopt-niet:claim:abc"];
    expect(clue.kind).toBe("finding");
    expect(clue.findingId).toBe("claim:abc");
    expect(clue.tab).toBe("klopt");
    expect("spoor" in clue).toBe(false);
    expect(migrated.dossier.edges).toHaveLength(1);
    expect(migrated.dossier.dismissed).toEqual(["x"]);
    expect(migrated.prefs).toEqual({ mapMode: "auto", findingsTab: null });
  });

  it("keeps only known preference values", () => {
    expect(sanitizePrefs({ mapMode: "spectrum", findingsTab: "klopt" })).toEqual({ mapMode: "spectrum", findingsTab: "klopt" });
    expect(sanitizePrefs({ heroLens: "spectrum" })).toEqual({ mapMode: "spectrum", findingsTab: null });
    expect(sanitizePrefs({ mapMode: "lenzen", findingsTab: "wat-klopt-niet" })).toEqual({ mapMode: "auto", findingsTab: null });
    expect(sanitizePrefs(null)).toEqual({ mapMode: "auto", findingsTab: null });
  });

  it("adds, moves, connects and removes dossier items", () => {
    const store = useExploreStore.getState();
    expect(store.addItem(item("nos"))).toBe("added");
    expect(store.addItem(item("nos"))).toBe("exists");
    store.addItem(item("ad", { url: "javascript:alert(1)" }));
    expect(useExploreStore.getState().dossier.items.ad.url).toBeUndefined();

    store.moveItem("nos", { x: 10, y: 20 });
    expect(useExploreStore.getState().dossier.items.nos.position).toEqual({ x: 10, y: 20 });

    const edgeId = store.connect("nos", "ad", "spreekt tegen");
    expect(edgeId).toBeTruthy();
    expect(store.connect("ad", "nos")).toBe(edgeId);
    expect(store.connect("nos", "nos")).toBeNull();
    expect(store.connect("nos", "missing")).toBeNull();
    store.updateEdgeLabel(edgeId as string, "zelfde eigenaar");
    expect(useExploreStore.getState().dossier.edges[0].label).toBe("zelfde eigenaar");

    store.removeItem("ad");
    expect(useExploreStore.getState().dossier.order).toEqual(["nos"]);
    expect(useExploreStore.getState().dossier.edges).toHaveLength(0);
  });

  it("updates notes and dismisses suggestions once", () => {
    const store = useExploreStore.getState();
    store.addItem({ ...item("note-1"), kind: "note", title: "Notitie", text: "" });
    store.updateNote("note-1", "Eerste regel\nmeer tekst");
    expect(useExploreStore.getState().dossier.items["note-1"].title).toBe("Eerste regel");
    store.dismissSuggestion("k");
    store.dismissSuggestion("k");
    expect(useExploreStore.getState().dossier.dismissed).toEqual(["k"]);
  });

  it("exports and imports the dossier", () => {
    const store = useExploreStore.getState();
    store.addItem(item("nos"));
    store.addItem(item("ad"));
    store.connect("nos", "ad");
    const json = exportDossier();
    store.clearDossier();
    expect(useExploreStore.getState().dossier.order).toEqual([]);
    expect(useExploreStore.getState().importDossier(json)).toEqual({ ok: true, items: 2 });
    expect(useExploreStore.getState().dossier.edges).toHaveLength(1);
    expect(useExploreStore.getState().importDossier("niet json")).toEqual({ ok: false, error: "Bestand kon niet gelezen worden" });
    expect(useExploreStore.getState().importDossier("{}")).toEqual({ ok: false, error: "Geen geldig dossierbestand" });
  });

  it("fills compare slots for one event", () => {
    const store = useExploreStore.getState();
    store.setCompareSlot(1, "nos");
    store.setCompareSlot(1, "nos");
    store.setCompareSlot(1, "ad");
    expect(useExploreStore.getState().compare).toEqual({ eventId: 1, a: "nos", b: "ad" });
    store.setCompareSlot(2, "trouw");
    expect(useExploreStore.getState().compare).toEqual({ eventId: 2, a: "trouw", b: null });
    store.clearCompare();
    expect(useExploreStore.getState().compare.a).toBeNull();
  });

  it("persists to localStorage and survives corrupt data", async () => {
    await useExploreStore.persist.rehydrate();
    useExploreStore.getState().touchEvent(3, { slug: "drie", title: "Drie" });
    const raw = window.localStorage.getItem(STORE_KEY);
    expect(raw).toContain('"Drie"');

    window.localStorage.setItem(STORE_KEY, JSON.stringify({ state: { prefs: { questMode: false, heroLens: "spectrum" }, dossier: { nope: true } }, version: 1 }));
    await useExploreStore.persist.rehydrate();
    const state = useExploreStore.getState();
    expect(state.prefs).toEqual({ mapMode: "spectrum", findingsTab: null });
    expect(Array.isArray(state.dossier.order)).toBe(true);

    // A renamed value from another tab never reaches the UI
    window.localStorage.setItem(STORE_KEY, JSON.stringify({ state: { prefs: { findingsTab: "sporen" } }, version: 2 }));
    await useExploreStore.persist.rehydrate();
    expect(useExploreStore.getState().prefs.findingsTab).toBeNull();
  });
});

describe("own entries", () => {
  it("are added, changed, removed and put back per event", () => {
    const store = useExploreStore.getState();
    expect(store.addOwn(7, own("a"))).toBe("added");
    expect(store.addOwn(7, own("b", { kind: "claim", text: "Twijfel", anchor: "outlet:nos" }))).toBe("added");
    expect(store.addOwn(8, own("c"))).toBe("added");
    expect(useExploreStore.getState().own["7"].map((entry) => entry.id)).toEqual(["own:a", "own:b"]);

    store.updateOwn(7, "own:b", { text: "  Andere twijfel  ", detail: "Bron zegt iets anders", url: "javascript:alert(1)" });
    const changed = useExploreStore.getState().own["7"][1];
    expect(changed).toMatchObject({ text: "Andere twijfel", detail: "Bron zegt iets anders", anchor: "outlet:nos" });
    expect(changed.url).toBeUndefined();
    expect(changed.updatedAt).toBeDefined();

    const removed = store.removeOwn(7, "own:a");
    expect(removed?.index).toBe(0);
    expect(useExploreStore.getState().own["7"].map((entry) => entry.id)).toEqual(["own:b"]);
    store.restoreOwn(7, removed!.entry, removed!.index);
    expect(useExploreStore.getState().own["7"].map((entry) => entry.id)).toEqual(["own:a", "own:b"]);

    store.removeOwn(8, "own:c");
    expect(useExploreStore.getState().own["8"]).toBeUndefined();
    expect(store.removeOwn(8, "own:c")).toBeNull();
  });

  it("refuses what is not a valid entry and stops at the maximum", () => {
    const store = useExploreStore.getState();
    expect(store.addOwn(1, own("x", { text: "   " }))).toBe("invalid");
    expect(store.addOwn(1, own("y", { kind: "moment" }))).toBe("invalid");
    for (let i = 0; i < 100; i += 1) store.addOwn(1, own(`n${i}`));
    expect(store.addOwn(1, own("teveel"))).toBe("full");
  });

  it("are cleaned when read back: known kind, limited text, safe link, valid anchor and date", () => {
    expect(sanitizeOwnEntry({ ...own("a"), kind: "spel" })).toBeNull();
    expect(sanitizeOwnEntry({ ...own("a"), id: "x" })).toBeNull();
    expect(sanitizeOwnEntry({ ...own("a"), text: "x".repeat(400) })?.text).toHaveLength(300);
    expect(sanitizeOwnEntry({ ...own("a"), url: "https://cbs.nl/x", anchor: "speaker:nos:jan" })).toMatchObject({
      url: "https://cbs.nl/x",
      anchor: "speaker:nos:jan",
    });
    expect(sanitizeOwnEntry({ ...own("a"), anchor: "<script>" })?.anchor).toBeUndefined();
    expect(sanitizeOwnEntry({ ...own("a"), kind: "moment", date: "12-11-2026" })).toBeNull();
    expect(sanitizeOwnEntry({ ...own("a"), kind: "moment", date: "2026-11-12" })?.date).toBe("2026-11-12");
    expect(sanitizeOwn({ "7": [own("a"), own("a"), { nope: true }], abc: [own("b")], "8": "geen lijst" })).toEqual({ "7": [own("a")] });
  });

  it("travel with the dossier export and are merged on import", () => {
    const store = useExploreStore.getState();
    store.addOwn(7, own("a"));
    const json = exportDossier();
    expect(JSON.parse(json).own["7"]).toHaveLength(1);
    useExploreStore.setState({ own: { "7": [own("b")] } });
    expect(useExploreStore.getState().importDossier(json)).toEqual({ ok: true, items: 0 });
    expect(useExploreStore.getState().own["7"].map((entry) => entry.id)).toEqual(["own:b", "own:a"]);
    // Importing twice adds nothing
    useExploreStore.getState().importDossier(json);
    expect(useExploreStore.getState().own["7"]).toHaveLength(2);
  });

  it("persist and survive bad data in storage", async () => {
    await useExploreStore.persist.rehydrate();
    useExploreStore.getState().addOwn(5, own("p", { kind: "question", text: "Wie betaalt?" }));
    expect(window.localStorage.getItem(STORE_KEY)).toContain("Wie betaalt?");
    window.localStorage.setItem(STORE_KEY, JSON.stringify({ state: { own: { "5": [{ id: "own:p", kind: "vraag" }], x: 1 } }, version: 2 }));
    await useExploreStore.persist.rehydrate();
    expect(useExploreStore.getState().own).toEqual({});
  });
});

describe("safeStorage", () => {
  it("falls back to memory and reports quota errors", () => {
    const listener = jest.fn();
    const unsubscribe = onStorageQuotaExceeded(listener);
    const spy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    safeStorage.setItem("k", "v");
    expect(listener).toHaveBeenCalled();
    expect(safeStorage.getItem("k")).toBe("v");
    spy.mockRestore();
    unsubscribe();
    safeStorage.removeItem("k");
    expect(safeStorage.getItem("k")).toBeNull();
  });
});
