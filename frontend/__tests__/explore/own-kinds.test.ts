import { buildExploration } from "@/lib/explore/exploration";
import { buildFigure, numberFindings } from "@/lib/explore/figure";
import { DEMO_EVENT, DEMO_EVENTS } from "@/lib/explore/fixtures/demo-event";
import { isOutletShown } from "@/lib/explore/layout/bubbles";
import { anchorOptions, resolveOwnAnchor, withOwn } from "@/lib/explore/own";
import type { ExploreOutlet, OwnEntry } from "@/lib/explore/types";

/** Story 14.14: a fallacy, a contradiction, an error and a source of your own. */

const at = "2026-10-06T10:00:00.000Z";
const entry = (id: string, fields: Pick<OwnEntry, "kind" | "text"> & Partial<OwnEntry>): OwnEntry => ({ id: `own:${id}`, createdAt: at, ...fields });
const shownByDefault = (outlet: ExploreOutlet) => isOutletShown(outlet);

describe("a fallacy, a contradiction and an error of your own", () => {
  const analysis = buildExploration(DEMO_EVENT);
  const verbeek = "speaker:telegraaf:anouk-verbeek";
  const deBoer = "speaker:ad:henk-de-boer";
  const view = withOwn(analysis, [
    entry("f", { kind: "fallacy", fallacy: "vals_dilemma", text: "Dit park of de klimaatdoelen opgeven", anchor: verbeek }),
    entry("c", { kind: "contradiction", text: "Of het dorp inspraak had", anchor: verbeek, against: deBoer }),
    entry("e", { kind: "error", text: "Het fonds is € 400.000 per jaar", about: "claim:kfkq1g" }),
  ]);
  const before = numberFindings(analysis);
  const after = numberFindings(view);
  const last = Math.max(...Array.from(before.numbers.values()));

  it("are findings of Klopt het?, numbered after the analysis", () => {
    expect(["own:f", "own:c", "own:e"].map((id) => view.findingById.get(id)?.tab)).toEqual(["klopt", "klopt", "klopt"]);
    expect(["own:f", "own:c", "own:e"].map((id) => after.numbers.get(id))).toEqual([last + 1, last + 2, last + 3]);
    for (const [id, number] of Array.from(before.numbers.entries())) expect(after.numbers.get(id)).toBe(number);
  });

  it("hang on what they are about: the fallacy on its speaker, the error next to what it corrects", () => {
    expect(after.anchorOf.get("own:f")).toBe(verbeek);
    expect(after.markers.get(verbeek)?.find((marker) => marker.findingId === "own:f")).toMatchObject({ type: "fallacy", own: true });
    // The claim it corrects hangs on De Telegraaf: the error too
    expect(after.anchorOf.get("own:e")).toBe(before.anchorOf.get("claim:kfkq1g"));
    expect(after.markers.get("outlet:telegraaf")?.find((marker) => marker.findingId === "own:e")).toMatchObject({ type: "error", own: true });
    // A contradiction is drawn as a line, not on a balloon
    expect(after.anchorOf.has("own:c")).toBe(false);
    expect(view.findingById.get("own:c")?.outletKeys).toEqual(["telegraaf", "ad"]);
  });

  it("draw a contradiction between the two balloons as they are drawn", () => {
    // Per perspective a speaker is an avatar in their outlet's balloon: the line runs between the outlets
    const figure = buildFigure(view, shownByDefault);
    expect(figure.mode).toBe("perInvalshoek");
    expect(figure.contradictions.find((line) => line.findingId === "own:c")).toMatchObject({ from: "outlet:telegraaf", to: "outlet:ad", own: true });

    // One side left out of the picture: the number goes on the other side
    const withoutAd = buildFigure(view, (outlet) => outlet.key !== "ad" && isOutletShown(outlet));
    expect(withoutAd.contradictions.some((line) => line.findingId === "own:c")).toBe(false);
    expect(withoutAd.markers.get("outlet:telegraaf")?.find((marker) => marker.findingId === "own:c")).toMatchObject({ type: "contradiction", own: true });

    // Per outlet (one Dutch outlet) the speakers are balloons of their own
    const vervolg = withOwn(buildExploration(DEMO_EVENTS["demo-vervolg"]), [
      entry("c2", { kind: "contradiction", text: "Of de bouw mocht beginnen", anchor: "speaker:nos:nordvind", against: "speaker:nos:joost-ravenhorst" }),
    ]);
    const perBron = buildFigure(vervolg, shownByDefault);
    expect(perBron.mode).toBe("perBron");
    expect(perBron.contradictions.find((line) => line.findingId === "own:c2")).toMatchObject({
      from: "speaker:nos:nordvind",
      to: "speaker:nos:joost-ravenhorst",
    });
  });

  it("offer two sides only when there are two to choose", () => {
    expect(anchorOptions(analysis, "contradiction").length).toBeGreaterThan(2);
    expect(anchorOptions(analysis, "source")).toEqual([]);
  });
});

describe("a source of your own", () => {
  const raw = DEMO_EVENTS["demo-vervolg"];
  const analysis = buildExploration(raw);
  const trouw = entry("s", { kind: "source", text: "Boeren vertellen wat zij van het park vinden", url: "https://www.trouw.nl/nieuws/boeren-dijkerhoven~b1/", title: "Boeren in de polder" });

  it("brings its outlet into the picture, apart from the analysis", () => {
    const view = withOwn(analysis, [trouw]);
    expect(view.ownOutlets?.map((outlet) => outlet.key)).toEqual(["trouw"]);
    expect(view.input.outlets).toBe(analysis.input.outlets);
    const outlet = view.index.outlet("trouw");
    expect(outlet).toMatchObject({ name: "Trouw", own: true, isInternational: false });
    expect(view.index.article(outlet!.articleIds[0])).toMatchObject({ title: "Boeren in de polder", ownId: "own:s", outletKey: "trouw" });
    // What the analysis found is the same, with the same outlets
    const analysisFindings = view.findings.filter((finding) => finding.type !== "own");
    expect(analysisFindings.map((finding) => [finding.id, finding.outletKeys])).toEqual(analysis.findings.map((finding) => [finding.id, finding.outletKeys]));
    expect(resolveOwnAnchor(trouw, view)).toBe("outlet:trouw");

    const figure = buildFigure(view, shownByDefault);
    expect(figure.mode).toBe("perBron");
    const group = figure.groups.find((item) => item.key === "o:trouw");
    expect(group).toMatchObject({ kind: "outlet", own: true });
    expect(group?.outlets[0]).toMatchObject({ text: "Boeren vertellen wat zij van het park vinden", textKind: "own" });
    // It is not numbered: the balloon is the source
    expect(numberFindings(view).numbers.has("own:s")).toBe(false);
  });

  it("is a place to hang a speaker on, and never changes how the picture is grouped", () => {
    const view = withOwn(analysis, [
      trouw,
      entry("v", { kind: "source", text: "De regionale krant", url: "https://dijkerhovense-courant.example/x" }),
      entry("w", { kind: "source", text: "Nog een krant", url: "https://www.parool.nl/nieuws/x" }),
      entry("p", { kind: "speaker", text: "Gerrit Hofstede", detail: "boer", anchor: "outlet:trouw" }),
    ]);
    expect(view.speakers.byOutlet.get("trouw")?.map((speaker) => speaker.name)).toEqual(["Gerrit Hofstede"]);
    expect(anchorOptions(view, "claim").some((option) => option.anchor === "outlet:trouw")).toBe(true);
    // Three Dutch outlets now, but only the news' own count for grouping per perspective
    expect(buildFigure(view, shownByDefault).mode).toBe("perBron");
    // A site without a profile: named by its host
    expect(view.index.outlet("bron-dijkerhovense-courant-example")).toMatchObject({ name: "dijkerhovense-courant.example", country: null });
  });

  it("of an outlet the news has already hangs on that outlet", () => {
    const nos = entry("n", { kind: "source", text: "Nog een NOS-stuk", url: "https://nos.nl/artikel/2601999-iets" });
    const view = withOwn(analysis, [nos]);
    expect(view.ownOutlets).toEqual([]);
    expect(resolveOwnAnchor(nos, view)).toBe("outlet:nos");
    expect(view.findingById.get("own:n")?.outletKeys).toEqual(["nos"]);
  });

  it("is in its own group when the outlets are grouped per perspective", () => {
    const view = withOwn(buildExploration(DEMO_EVENT), [trouw]);
    const figure = buildFigure(view, shownByDefault);
    expect(figure.mode).toBe("perInvalshoek");
    expect(figure.groups.find((group) => group.kind === "own")?.outlets.map((outlet) => outlet.outletKey)).toEqual(["trouw"]);
  });
});
