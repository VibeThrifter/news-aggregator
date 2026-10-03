import { autoPlace, computeSuggestions, normalizeKey, pairKey, suggestionLabel } from "@/lib/explore/suggestions";
import type { DossierItem } from "@/lib/explore/store";

const item = (id: string, eventId: number | null, keys: string[], extra: Partial<DossierItem> = {}): DossierItem => ({
  id,
  kind: "finding",
  eventId,
  title: id,
  keys,
  addedAt: "2026-09-30T00:00:00Z",
  ...extra,
});

describe("dossier suggestions", () => {
  const items = [
    item("a", 1, ["entity:org:nordvind", "outlet:nos"]),
    item("b", 2, ["entity:org:nordvind"]),
    item("c", 1, ["outlet:nos"]),
    item("d", null, ["pm:11"], { kind: "pm", title: "NOS" }),
    item("e", 2, ["pm:11"]),
  ];

  it("suggests pairs that share a key, cross-event first", () => {
    const suggestions = computeSuggestions(items, [], []);
    expect(suggestions[0].key).toBe(pairKey("a", "b"));
    expect(suggestions.map((s) => s.key)).toEqual(expect.arrayContaining([pairKey("a", "c"), pairKey("d", "e")]));
  });

  it("skips existing edges and dismissed pairs", () => {
    const suggestions = computeSuggestions(items, [{ id: "x", source: "b", target: "a", origin: "user" }], [pairKey("a", "c")]);
    expect(suggestions.some((s) => s.key === pairKey("a", "b"))).toBe(false);
    expect(suggestions.some((s) => s.key === pairKey("a", "c"))).toBe(false);
  });

  it("ignores keys shared by too many items", () => {
    const many = Array.from({ length: 10 }, (_, i) => item(`m${i}`, i, ["country:de"]));
    expect(computeSuggestions(many, [], [])).toHaveLength(0);
  });

  it("normalises keys so the same name matches however it was saved", () => {
    expect(normalizeKey("actor:nordvind")).toBe("name:nordvind");
    expect(normalizeKey("alias:nordvind")).toBe("name:nordvind");
    expect(normalizeKey("entity:org:nordvind")).toBe("name:nordvind");
    expect(normalizeKey("entity:country:de")).toBe("country:de");
    expect(normalizeKey("perspective:0")).toBeNull();
    expect(normalizeKey("claim:abc")).toBeNull();
    expect(normalizeKey("nokind")).toBeNull();
    const suggestions = computeSuggestions(
      [item("clue", 2, ["actor:nordvind", "perspective:0"]), item("ent", 1, ["alias:nordvind", "entity:org:nordvind"], { kind: "entity", title: "NordVind" }), item("other", 1, ["perspective:0"])],
      [],
      [],
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].label).toBe("Zelfde naam: NordVind");
  });

  it("labels suggestions", () => {
    expect(suggestionLabel("outlet:nos", [item("o", 1, [], { kind: "outlet", title: "NOS" })])).toBe("Zelfde bron: NOS");
    expect(suggestionLabel("pm:1", [])).toBe("Zelfde actor in het propagandamodel");
    expect(suggestionLabel("entity:person:x", [item("p", 1, [], { kind: "entity", title: "Anouk Verbeek" })])).toBe("Zelfde naam: Anouk Verbeek");
    expect(suggestionLabel("country:de", [])).toBe("Zelfde land");
    expect(suggestionLabel("frame:conflict", [])).toBe("Zelfde frame");
    expect(suggestionLabel("weird:x", [])).toBe("Hebben iets gemeen");
  });

  it("auto-places items without position in columns per event", () => {
    const placed = autoPlace([item("p1", 1, []), item("p2", 1, []), item("q1", 2, []), item("r", 3, [], { position: { x: 0, y: 0 } })]);
    expect(placed.has("r")).toBe(false);
    expect(placed.get("p1")!.x).toBe(placed.get("p2")!.x);
    expect(placed.get("q1")!.x).toBeGreaterThan(placed.get("p1")!.x);
  });
});
