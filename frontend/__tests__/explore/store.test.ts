import { safeStorage, onStorageQuotaExceeded } from "@/lib/explore/storage";
import { STORE_KEY, exportDossier, useExploreStore } from "@/lib/explore/store";

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
    dossier: { items: {}, order: [], edges: [], dismissed: [] },
    compare: { eventId: null, a: null, b: null },
  });
});

describe("exploration store", () => {
  it("tracks revealed clues per event without duplicates", () => {
    const store = useExploreStore.getState();
    store.touchEvent(7, { slug: "zeven", title: "Zeven" });
    store.reveal(7, ["a", "b"]);
    store.reveal(7, ["b", "c"]);
    store.reveal(7, []);
    expect(useExploreStore.getState().events["7"].revealed).toEqual(["a", "b", "c"]);
    store.markSpoorCompleted(7, "wat-klopt-niet");
    store.markSpoorCompleted(7, "wat-klopt-niet");
    expect(useExploreStore.getState().events["7"].completed).toEqual(["wat-klopt-niet"]);
    store.resetEvent(7);
    expect(useExploreStore.getState().events["7"].revealed).toEqual([]);
  });

  it("reveals for events that were never touched", () => {
    useExploreStore.getState().reveal(9, ["x"]);
    expect(useExploreStore.getState().events["9"].revealed).toEqual(["x"]);
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
    useExploreStore.getState().reveal(3, ["z"]);
    const raw = window.localStorage.getItem(STORE_KEY);
    expect(raw).toContain('"z"');

    window.localStorage.setItem(STORE_KEY, JSON.stringify({ state: { prefs: { questMode: false }, dossier: { nope: true } }, version: 1 }));
    await useExploreStore.persist.rehydrate();
    const state = useExploreStore.getState();
    expect(state.prefs.questMode).toBe(false);
    expect(state.prefs.heroLens).toBe("invalshoek");
    expect(Array.isArray(state.dossier.order)).toBe(true);
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
