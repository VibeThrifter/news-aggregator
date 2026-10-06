import { buildExploration } from "@/lib/explore/exploration";
import { DEMO_EVENT } from "@/lib/explore/fixtures/demo-event";
import { demoAdopt, demoModerate, demoReport, demoShare, demoSharedEntries, demoUnshare } from "@/lib/explore/fixtures/demo-shared";
import { adoptionOf, groupShared, groupsAbout, groupsInTab, matchesQuery, sharedKey, shareFields, sortGroups } from "@/lib/explore/others";
import { withOwn } from "@/lib/explore/own";
import { sanitizeOwnEntry } from "@/lib/explore/store";
import type { OwnEntry } from "@/lib/explore/types";
import type { SharedEntry } from "@/lib/shared";

/** Story 14.15: "Van anderen", what other readers shared, as you browse it. */

const shared = (id: number, fields: Partial<SharedEntry> & Pick<SharedEntry, "kind" | "text">): SharedEntry => ({
  id,
  event_id: -1,
  detail: null,
  quote: null,
  anchor: null,
  against: null,
  about: null,
  fallacy: null,
  url: null,
  title: null,
  date: null,
  adopted: 0,
  created_at: "2026-10-01T10:00:00Z",
  mine: false,
  own_id: null,
  adopted_by_me: false,
  hidden: false,
  ...fields,
});

describe("Van anderen", () => {
  const entries = [
    shared(1, { kind: "gap", text: "Jongeren uit het dorp", adopted: 2, created_at: "2026-10-01T09:00:00Z" }),
    shared(2, { kind: "gap", text: "  jongeren uit het dorp! ", adopted: 3, created_at: "2026-10-02T09:00:00Z" }),
    shared(3, { kind: "contradiction", text: "Inspraak", anchor: "outlet:ad", against: "outlet:telegraaf" }),
    shared(4, { kind: "contradiction", text: "inspraak", anchor: "outlet:telegraaf", against: "outlet:ad", created_at: "2026-10-03T09:00:00Z" }),
    shared(5, { kind: "source", text: "Regionale krant", url: "https://www.courant.example/a/" }),
    shared(6, { kind: "source", text: "Andere woorden", url: "https://courant.example/a" }),
    shared(7, { kind: "fallacy", fallacy: "ad_hominem", text: "Voorstanders heten de windlobby", anchor: "outlet:geenstijl", adopted: 1 }),
    shared(8, { kind: "moment", text: "Provincie wees plan af", date: "2019-06-12", mine: true, own_id: "own:m" }),
  ];

  it("make one row of the same entry, however many readers shared it", () => {
    const groups = groupShared(entries);
    expect(groups).toHaveLength(5);
    const gap = groups.find((group) => group.lead.kind === "gap")!;
    // Two shared it, five took it over; you take over the one most readers took over
    expect(gap.readers).toBe(7);
    expect(gap.lead.id).toBe(2);
    expect(gap.newest).toBe("2026-10-02T09:00:00Z");
    // The sides of a contradiction in any order, a source by its link
    expect(groups.find((group) => group.lead.kind === "contradiction")?.entries).toHaveLength(2);
    expect(groups.find((group) => group.lead.kind === "source")?.entries).toHaveLength(2);
    expect(sharedKey(entries[2])).toBe(sharedKey(entries[3]));
  });

  it("know what is yours and what you took over", () => {
    const groups = groupShared(entries, new Set(["7"]));
    expect(groups.find((group) => group.lead.kind === "moment")?.mine).toBe(true);
    expect(groups.find((group) => group.lead.kind === "fallacy")?.adopted).toBe(true);
    const mineAndOthers = groupShared([shared(9, { kind: "gap", text: "Boeren", mine: true, adopted: 4 }), shared(10, { kind: "gap", text: "Boeren" })]);
    // You never take over your own
    expect(mineAndOthers[0].lead.id).toBe(10);
    expect(groupShared([shared(11, { kind: "gap", text: "X y", adopted_by_me: true })])[0].adopted).toBe(true);
  });

  it("are ordered by readers or by what is new", () => {
    const groups = groupShared(entries);
    expect(sortGroups(groups, "lezers").map((group) => group.lead.kind)[0]).toBe("gap");
    expect(sortGroups(groups, "nieuw").map((group) => group.lead.kind)[0]).toBe("contradiction");
  });

  it("are found by all words you type, also the kind of fallacy, the site and who it is about", () => {
    const groups = groupShared(entries);
    const fallacy = groups.find((group) => group.lead.kind === "fallacy")!;
    expect(matchesQuery(fallacy, "windlobby")).toBe(true);
    expect(matchesQuery(fallacy, "op de man")).toBe(true);
    expect(matchesQuery(fallacy, "windlobby boeren")).toBe(false);
    expect(matchesQuery(fallacy, "geenstijl", (entry) => (entry.anchor === "outlet:geenstijl" ? "GeenStijl" : null))).toBe(true);
    expect(matchesQuery(groups.find((group) => group.lead.kind === "source")!, "courant")).toBe(true);
    expect(matchesQuery(groupShared([shared(12, { kind: "gap", text: "Energiecoöperatie" })])[0], "cooperatie")).toBe(true);
    expect(matchesQuery(fallacy, "  ")).toBe(true);
  });

  it("are in the tab of their kind, and about a speaker or outlet as either side", () => {
    const groups = groupShared(entries);
    expect(groupsInTab(groups, "klopt").map((group) => group.lead.kind).sort()).toEqual(["contradiction", "fallacy"]);
    expect(groupsInTab(groups, "stemmen").map((group) => group.lead.kind)).toEqual(["source"]);
    expect(groupsInTab(groups, "tijdlijn").map((group) => group.lead.kind)).toEqual(["moment"]);
    expect(groupsAbout(groups, "outlet:telegraaf").map((group) => group.lead.kind)).toEqual(["contradiction"]);
    expect(groupsAbout(groups, "outlet:geenstijl").map((group) => group.lead.kind)).toEqual(["fallacy"]);
  });
});

describe("sharing and taking over", () => {
  const analysis = buildExploration(DEMO_EVENT);
  const own = (id: string, fields: Pick<OwnEntry, "kind" | "text"> & Partial<OwnEntry>): OwnEntry => ({ id: `own:${id}`, createdAt: "2026-10-06T10:00:00Z", ...fields });

  it("share the entry, never when or whether: a speaker you added becomes their outlet for others", () => {
    const view = withOwn(analysis, [
      own("s", { kind: "speaker", text: "Gerrit Hofstede", anchor: "outlet:telegraaf" }),
      own("q", { kind: "question", text: "Wat krijgt hij ervoor?", anchor: "speaker:telegraaf:own:s", sharedAt: "2026-10-06T10:00:00Z" }),
    ]);
    const question = view.findingById.get("own:q")!.body;
    expect(question.type).toBe("own");
    const fields = shareFields((question as { entry: OwnEntry }).entry, view.speakers);
    expect(fields).toEqual({ id: "own:q", kind: "question", text: "Wat krijgt hij ervoor?", anchor: "outlet:telegraaf" });
    // A speaker of the analysis stays who they are; a long quote is cut short
    const quote = "Wij zijn nooit gevraagd. ".repeat(20);
    expect(shareFields(own("c", { kind: "claim", text: "Twijfel", anchor: "speaker:telegraaf:anouk-verbeek" }), view.speakers).anchor).toBe("speaker:telegraaf:anouk-verbeek");
    expect(shareFields(own("p", { kind: "speaker", text: "Iemand", anchor: "outlet:nos", quote }), view.speakers).quote).toHaveLength(300);
  });

  it("take over the same fields as an entry of your own that remembers where it came from", () => {
    const fallacy = shared(7, { kind: "fallacy", fallacy: "ad_hominem", text: "Voorstanders heten de windlobby", anchor: "outlet:geenstijl" });
    const fields = adoptionOf(fallacy);
    expect(fields).toMatchObject({ kind: "fallacy", fallacy: "ad_hominem", text: "Voorstanders heten de windlobby", anchor: "outlet:geenstijl", from: "7" });
    expect(fields.detail).toBeUndefined();
    expect(sanitizeOwnEntry({ ...fields, id: "own:x", createdAt: "2026-10-06T10:00:00Z" })).toMatchObject({ from: "7", fallacy: "ad_hominem" });
  });
});

describe("the demo of Van anderen", () => {
  beforeEach(() => window.localStorage.clear());

  it("simulates sharing, taking over, reporting and the admin on this device", async () => {
    const before = await demoSharedEntries(-1);
    expect(before.length).toBeGreaterThan(5);
    expect(before.every((entry) => !entry.mine)).toBe(true);

    const result = await demoShare(-1, { id: "own:g", kind: "gap", text: "Jongeren" });
    expect(result.ok).toBe(true);
    const mine = (await demoSharedEntries(-1)).find((entry) => entry.mine);
    expect(mine).toMatchObject({ own_id: "own:g", text: "Jongeren" });
    // Sharing again updates it
    await demoShare(-1, { id: "own:g", kind: "gap", text: "Jongeren uit het dorp" });
    expect((await demoSharedEntries(-1)).filter((entry) => entry.mine).map((entry) => entry.text)).toEqual(["Jongeren uit het dorp"]);
    expect((await demoAdopt(mine!.id, true)).reason).toBe("eigen");

    const other = before[0];
    await demoAdopt(other.id, true);
    expect((await demoSharedEntries(-1)).find((entry) => entry.id === other.id)).toMatchObject({ adopted: other.adopted + 1, adopted_by_me: true });
    await demoAdopt(other.id, false);
    expect((await demoSharedEntries(-1)).find((entry) => entry.id === other.id)?.adopted_by_me).toBe(false);

    await demoReport(other.id);
    expect((await demoSharedEntries(-1)).some((entry) => entry.id === other.id)).toBe(false);
    await demoModerate(other.id, "toon");
    expect((await demoSharedEntries(-1)).some((entry) => entry.id === other.id)).toBe(true);

    await demoUnshare(-1, "own:g");
    expect((await demoSharedEntries(-1)).some((entry) => entry.mine)).toBe(false);
    // Another demo news item has its own
    expect((await demoSharedEntries(-3)).every((entry) => entry.event_id === -3)).toBe(true);
  });
});
