import {
  countryName,
  countrySpots,
  dutchSpots,
  itemsLabel,
  parseBeeld,
  parsePeriode,
  periodeStart,
  tintStep,
  visibleRows,
  whenLabel,
  type PlaceRow,
} from "@/lib/kaart/data";

function row(overrides: Partial<PlaceRow>): PlaceRow {
  return {
    event_id: 1,
    place_key: "place:1",
    kind: "place",
    name: "Utrecht",
    iso_code: "NL",
    region: "Utrecht",
    lat: 52.09,
    lon: 5.12,
    article_count: 2,
    in_title: true,
    outlets: ["NOS"],
    event_slug: "nieuws-1",
    event_title: "Nieuws 1",
    event_type: "crime",
    event_first_seen_at: "2026-11-16T10:00:00Z",
    ...overrides,
  };
}

describe("visibleRows", () => {
  const rows = [
    row({ event_id: 1, outlets: ["NOS", "GeenStijl"] }),
    row({ event_id: 2, outlets: ["GeenStijl"] }),
    row({ event_id: 3, outlets: ["AD"], event_type: "politics" }),
  ];

  it("keeps news of a main source only", () => {
    const kept = visibleRows(rows, { mainSources: ["NOS", "AD"], category: "all" });
    expect(kept.map((r) => r.event_id)).toEqual([1, 3]);
  });

  it("shows everything when no main source is configured", () => {
    expect(visibleRows(rows, { mainSources: [], category: "all" })).toHaveLength(3);
  });

  it("filters on the category", () => {
    const kept = visibleRows(rows, { mainSources: [], category: "politics" });
    expect(kept.map((r) => r.event_id)).toEqual([3]);
  });
});

describe("dutchSpots", () => {
  it("groups news per place, most news first, newest news first", () => {
    const spots = dutchSpots([
      row({ event_id: 1, place_key: "place:1", name: "Utrecht", event_first_seen_at: "2026-11-14T10:00:00Z" }),
      row({ event_id: 2, place_key: "place:1", name: "Utrecht", event_first_seen_at: "2026-11-16T10:00:00Z" }),
      row({ event_id: 3, place_key: "place:2", name: "Zwolle", region: "Overijssel" }),
      row({ event_id: 4, place_key: "country:ua", kind: "country", name: "Oekraïne", iso_code: "UA" }),
    ]);
    expect(spots.map((s) => s.name)).toEqual(["Utrecht", "Zwolle"]);
    expect(spots[0].items.map((i) => i.id)).toEqual([2, 1]);
    expect(spots[1].detail).toBe("Overijssel");
  });

  it("counts a news item once per place", () => {
    const spots = dutchSpots([row({ event_id: 1 }), row({ event_id: 1 })]);
    expect(spots[0].items).toHaveLength(1);
  });

  it("a province has no province as its detail", () => {
    const [spot] = dutchSpots([row({ kind: "region", name: "Limburg", region: "Limburg" })]);
    expect(spot.detail).toBeNull();
  });
});

describe("countrySpots", () => {
  it("counts a news item once for a country named or with a place in it", () => {
    const spots = countrySpots([
      row({ event_id: 1, place_key: "country:ua", kind: "country", name: "Oekraïne", iso_code: "UA", lat: 50.45, lon: 30.52 }),
      row({ event_id: 1, place_key: "place:703448", kind: "city", name: "Kyiv", iso_code: "UA", lat: 50.4, lon: 30.5 }),
      row({ event_id: 2, place_key: "place:706483", kind: "city", name: "Charkiv", iso_code: "UA", lat: 50, lon: 36.2 }),
      row({ event_id: 3, place_key: "place:2643743", kind: "city", name: "Londen", iso_code: "GB" }),
      row({ event_id: 4, place_key: "place:1", name: "Utrecht", iso_code: "NL" }),
    ]);
    expect(spots.map((s) => s.iso)).toEqual(["UA", "GB"]);
    expect(spots[0].items.map((i) => i.id).sort()).toEqual([1, 2]);
    expect(spots[0].key).toBe("country:ua");
    expect(spots[0].detail).toBe("Charkiv, Kyiv");
    expect(spots[0].lat).toBeCloseTo(50.45);
  });

  it("names a country in Dutch", () => {
    expect(countryName("UA", "x")).toBe("Oekraïne");
    expect(countryName("ZZ", "Onbekend")).toBe("Onbekend");
  });
});

describe("small helpers", () => {
  it("tints in five steps", () => {
    expect([0, 1, 2, 3, 5, 6, 10, 11, 40].map(tintStep)).toEqual([0, 1, 2, 3, 3, 4, 4, 5, 5]);
  });

  it("says how much", () => {
    expect(itemsLabel(1)).toBe("1 nieuwsitem");
    expect(itemsLabel(3)).toBe("3 nieuwsitems");
  });

  it("reads the URL with defaults", () => {
    expect(parseBeeld("wereld")).toBe("wereld");
    expect(parseBeeld("x")).toBe("nederland");
    expect(parsePeriode(null)).toBe("week");
    expect(parsePeriode("maand")).toBe("maand");
  });

  it("starts the period back from now", () => {
    const now = new Date("2026-11-16T12:00:00Z");
    expect(periodeStart("vandaag", now).toISOString()).toBe("2026-11-15T12:00:00.000Z");
    expect(periodeStart("week", now).toISOString()).toBe("2026-11-09T12:00:00.000Z");
  });

  it("says when in Dutch time", () => {
    const now = new Date("2026-11-16T12:00:00Z");
    expect(whenLabel("2026-11-16T09:05:00Z", now)).toBe("vandaag 10:05");
    expect(whenLabel("2026-11-15T22:30:00Z", now)).toBe("gisteren 23:30");
    expect(whenLabel("2026-11-12T09:05:00Z", now)).toMatch(/^12 nov/);
    expect(whenLabel(null, now)).toBe("");
  });
});
