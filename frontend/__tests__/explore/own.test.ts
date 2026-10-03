import { buildExploration } from "@/lib/explore/exploration";
import { buildFigure, numberFindings } from "@/lib/explore/figure";
import { DEMO_EVENT } from "@/lib/explore/fixtures/demo-event";
import { isOutletShown } from "@/lib/explore/layout/bubbles";
import type { RawExploration } from "@/lib/explore/input";
import { outletIndex } from "@/lib/explore/lens-index";
import { anchorOptions, withOwn } from "@/lib/explore/own";
import { guessSpeakerKind as ownSpeakerKind } from "@/lib/explore/speakers";
import type { OwnEntry } from "@/lib/explore/types";

const at = "2026-10-03T10:00:00.000Z";
const entry = (id: string, fields: Pick<OwnEntry, "kind" | "text"> & Partial<OwnEntry>): OwnEntry => ({ id: `own:${id}`, createdAt: at, ...fields });

describe("own entries", () => {
  const analysis = buildExploration(DEMO_EVENT);
  const verbeek = analysis.speakers.speakers.find((speaker) => speaker.name === "Anouk Verbeek")!;
  const firstDutch = analysis.input.outlets.find((outlet) => !outlet.isInternational)!;

  it("leave the exploration as it is when there are none", () => {
    expect(withOwn(analysis, undefined)).toBe(analysis);
    expect(withOwn(analysis, [])).toBe(analysis);
  });

  it("become findings after the analysis, each in the tab of its question", () => {
    const view = withOwn(analysis, [
      entry("a", { kind: "claim", text: "Het park levert stroom voor 40.000 huishoudens", anchor: `speaker:${verbeek.id}` }),
      entry("b", { kind: "gap", text: "Jongeren uit het dorp" }),
      entry("c", { kind: "moment", text: "Gemeenteraad stemt over het bestemmingsplan", date: "2026-11-12" }),
    ]);
    expect(view.findings).toHaveLength(analysis.findings.length + 3);
    expect(view.findingById.get("own:a")).toMatchObject({ tab: "klopt", type: "own", outletKeys: [verbeek.outletKey] });
    const klopt = view.byTab.get("klopt") ?? [];
    expect(klopt[klopt.length - 1].id).toBe("own:a");
    expect(view.byTab.get("ontbreekt")?.some((finding) => finding.id === "own:b")).toBe(true);
    expect(view.byTab.get("tijdlijn")?.some((finding) => finding.id === "own:c")).toBe(true);
    // Links for suggestions on the board
    expect(view.findingById.get("own:a")?.links).toEqual(expect.arrayContaining([`outlet:${verbeek.outletKey}`, `actor:${verbeek.slug}`]));
    // The analysis itself is untouched
    expect(analysis.findingById.has("own:a")).toBe(false);
  });

  it("keep the analysis numbers and are numbered after them, on what they hang on", () => {
    const before = numberFindings(analysis);
    const view = withOwn(analysis, [
      entry("a", { kind: "claim", text: "Twijfel", anchor: `speaker:${verbeek.id}` }),
      entry("b", { kind: "gap", text: "Jongeren uit het dorp" }),
      entry("c", { kind: "question", text: "Wie betaalt de netaansluiting?", anchor: `outlet:${firstDutch.key}` }),
      entry("d", { kind: "note", text: "De kop overdrijft", anchor: "speaker:verdwenen:spreker" }),
      entry("e", { kind: "moment", text: "Raad stemt", date: "2026-11-12" }),
      entry("f", { kind: "speaker", text: "Marieke Brand", anchor: `outlet:${firstDutch.key}` }),
    ]);
    const after = numberFindings(view);
    for (const [id, number] of Array.from(before.numbers.entries())) expect(after.numbers.get(id)).toBe(number);
    const last = Math.max(...Array.from(before.numbers.values()));
    expect(["own:a", "own:b", "own:c", "own:d"].map((id) => after.numbers.get(id))).toEqual([last + 1, last + 2, last + 3, last + 4]);
    // Moments and speakers get no number
    expect(after.numbers.has("own:e")).toBe(false);
    expect(after.numbers.has("own:f")).toBe(false);
    expect(after.anchorOf.get("own:a")).toBe(`speaker:${verbeek.id}`);
    expect(after.anchorOf.get("own:b")).toBe("gap:own:b");
    expect(after.anchorOf.get("own:c")).toBe(`outlet:${firstDutch.key}`);
    // Its speaker is gone: a number for the list, nothing on the picture
    expect(after.anchorOf.has("own:d")).toBe(false);
    expect(after.markers.get(`speaker:${verbeek.id}`)?.find((marker) => marker.findingId === "own:a")).toMatchObject({ type: "claim", own: true });
    expect(after.markers.get(`outlet:${firstDutch.key}`)?.find((marker) => marker.findingId === "own:c")?.type).toBe("question");
  });

  it("add speakers to their outlet, and other entries can hang on them", () => {
    const view = withOwn(analysis, [
      entry("s", { kind: "speaker", text: "Boeren uit de polder", detail: "LTO-afdeling", quote: "Wij zijn nooit gevraagd", anchor: "outlet:telegraaf" }),
      entry("q", { kind: "question", text: "Wat krijgen de boeren ervoor?", anchor: "speaker:telegraaf:own:s" }),
    ]);
    const added = view.speakers.byId.get("telegraaf:own:s");
    expect(added).toMatchObject({ name: "Boeren uit de polder", role: "LTO-afdeling", kind: "group", ownId: "own:s", quote: "Wij zijn nooit gevraagd" });
    expect(view.speakers.byOutlet.get("telegraaf")?.slice(-1)[0].id).toBe("telegraaf:own:s");
    expect(analysis.speakers.byId.has("telegraaf:own:s")).toBe(false);
    expect(numberFindings(view).anchorOf.get("own:q")).toBe("speaker:telegraaf:own:s");
  });

  it("guess person, organisation or group from a typed name", () => {
    expect(ownSpeakerKind("Marieke Brand")).toBe("person");
    expect(ownSpeakerKind("Jan de Vries")).toBe("person");
    expect(ownSpeakerKind("Natuurmonumenten")).toBe("org");
    expect(ownSpeakerKind("Vereniging Eigen Huis")).toBe("org");
    expect(ownSpeakerKind("LTO")).toBe("org");
    expect(ownSpeakerKind("Boeren uit de polder")).toBe("group");
    expect(ownSpeakerKind("omwonenden")).toBe("group");
    expect(ownSpeakerKind("een anonieme ambtenaar")).toBe("anonymous");
    expect(ownSpeakerKind("Energiecoöperatie Dijkerhoven Duurzaam")).toBe("org");
    expect(ownSpeakerKind("LTO-afdeling Dijkerhoven")).toBe("org");
    expect(ownSpeakerKind("Gerrit Hofstede, boer en verpachter")).toBe("person");
  });

  it("show a missing voice of your own in the picture, also when the analysis found none", () => {
    const raw: RawExploration = JSON.parse(JSON.stringify(DEMO_EVENT));
    raw.insight!.coverage_gaps = [];
    const bare = buildExploration(raw);
    const empty = buildFigure(bare, (outlet) => isOutletShown(outlet)).groups.find((group) => group.kind === "missing");
    // The group is there to add to
    expect(empty?.ghosts).toEqual([]);
    const view = withOwn(bare, [entry("g", { kind: "gap", text: "Jongeren uit het dorp" })]);
    const missing = buildFigure(view, (outlet) => isOutletShown(outlet)).groups.find((group) => group.kind === "missing");
    expect(missing?.ghosts).toEqual([{ anchor: "gap:own:g", findingId: "own:g", label: "Jongeren uit het dorp", own: true }]);
  });

  it("are counted in an outlet's lines as 'van jou'", () => {
    const view = withOwn(analysis, [
      entry("a", { kind: "claim", text: "Twijfel", anchor: `speaker:${verbeek.id}` }),
      entry("n", { kind: "note", text: "De kop overdrijft", anchor: `outlet:${verbeek.outletKey}` }),
    ]);
    const lines = outletIndex(view, verbeek.outletKey);
    const klopt = lines.find((line) => line.tab === "klopt");
    expect(klopt?.text).toMatch(/ · 1 van jou$/);
    expect(klopt?.findingIds).toContain("own:a");
    expect(lines.find((line) => line.tab === "gebracht")?.text).toMatch(/1 van jou$/);
    // The analysis lines are unchanged without entries
    expect(outletIndex(analysis, verbeek.outletKey).some((line) => line.text.includes("van jou"))).toBe(false);
  });

  it("offer the outlets with their speakers to hang on", () => {
    const options = anchorOptions(analysis, "claim");
    expect(options[0].anchor.startsWith("outlet:")).toBe(true);
    expect(options.some((option) => option.anchor === `speaker:${verbeek.id}`)).toBe(true);
    expect(anchorOptions(analysis, "speaker").every((option) => option.speaker === null)).toBe(true);
    expect(anchorOptions(analysis, "gap")).toEqual([]);
  });
});
