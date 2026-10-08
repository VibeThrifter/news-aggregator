import { biasByOutlet, biasCards, objectivity } from "@/lib/explore/bias";
import { deriveFindings, findingsByTab, legacyFindingId } from "@/lib/explore/findings";
import { contradictionsBetween, outletProfileView } from "@/lib/explore/compare";
import { DEMO_EVENT, isDemoIdentifier } from "@/lib/explore/fixtures/demo-event";

import { SECOND_EVENT } from "./fixtures/second-event";
import { ArticleIndex, buildExploreInput, type RawExploration } from "@/lib/explore/input";
import { biasTypeLabel, fallacyLabel, frameLabel, toneLabel } from "@/lib/explore/labels";
import { findOutletByName, findOutletByUrl } from "@/lib/explore/media-landscape";
import { eventFilterSignals } from "@/lib/explore/propaganda";
import { splitLlmSummary, stripMarkdown, truncate } from "@/lib/explore/summary";

function clone(raw: RawExploration): RawExploration {
  return JSON.parse(JSON.stringify(raw));
}

describe("summary", () => {
  it("splits the LLM title from the body and finds the first paragraph", () => {
    const split = splitLlmSummary("Titel zonder punt\n\n**Kopje**\n\nEerste **echte** alinea.\n\nTweede.");
    expect(split.title).toBe("Titel zonder punt");
    expect(split.firstParagraph).toBe("Eerste echte alinea.");
    expect(split.body.startsWith("**Kopje**")).toBe(true);
  });

  it("falls back to the first sentence without a blank line", () => {
    const split = splitLlmSummary("Kort nieuws. Daarna meer tekst die langer is dan de titel zelf ooit zou mogen zijn in een kop.");
    expect(split.title).toBe("Kort nieuws");
  });

  it("handles empty input", () => {
    expect(splitLlmSummary(null)).toEqual({ title: null, body: "", firstParagraph: "" });
  });

  it("strips markdown and truncates at word boundaries", () => {
    expect(stripMarkdown("**Vet** en [link](https://x) en *schuin*")).toBe("Vet en link en schuin");
    expect(truncate("een twee drie vier vijf", 12)).toBe("een twee…");
    expect(truncate("kort", 12)).toBe("kort");
  });
});

describe("media landscape", () => {
  it("finds outlets by name aliases and by url (incl. subdomains)", () => {
    expect(findOutletByName("Algemeen Dagblad")?.key).toBe("ad");
    expect(findOutletByName("nu.nl")?.key).toBe("nu-nl");
    expect(findOutletByUrl("https://edition.cnn.com/2026/x")?.key).toBe("cnn");
    expect(findOutletByUrl("https://www.dw.com/en/x")?.key).toBe("dw");
    expect(findOutletByName("Onbekend Blad")).toBeNull();
  });
});

describe("buildExploreInput", () => {
  const input = buildExploreInput(DEMO_EVENT);

  it("uses the LLM title and marks demo events", () => {
    expect(input.event.title).toBe("Windpark Dijkerhoven splijt dorp en Den Haag");
    expect(input.event.isDemo).toBe(true);
    expect(isDemoIdentifier("demo")).toBe(true);
    expect(isDemoIdentifier("demo-vervolg")).toBe(true);
    expect(isDemoIdentifier(-3)).toBe(true);
    expect(isDemoIdentifier("demo-2")).toBe(false);
    expect(isDemoIdentifier("windpark")).toBe(false);
  });

  it("resolves outlets, spectrum and international sources", () => {
    const keys = input.outlets.map((outlet) => outlet.key);
    expect(keys).toEqual(expect.arrayContaining(["nos", "nu-nl", "telegraaf", "ad", "geenstijl", "volkskrant", "andere-krant", "een-blik-op-de-nos", "dw", "vrt"]));
    const nos = input.outlets.find((outlet) => outlet.key === "nos");
    expect(nos?.articleIds).toHaveLength(2);
    expect(nos?.spectrum).toBe(4);
    const andere = input.outlets.find((outlet) => outlet.key === "andere-krant");
    expect(andere?.isAlternative).toBe(true);
    expect(andere?.x).toBe(6);
    expect(andere?.establishment).toBe(-0.8);
    expect(nos?.x).toBe(4);
    expect(nos?.establishment).toBe(0.9);
    const dw = input.outlets.find((outlet) => outlet.key === "dw");
    expect(dw?.isInternational).toBe(true);
    expect(dw?.country).toBe("DE");
    expect(dw?.establishment).toBeNull();
  });

  it("orders articles by publication time", () => {
    const times = input.articles.map((article) => Date.parse(article.publishedAt as string));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("keeps the latest bias analysis per article", () => {
    const raw = clone(DEMO_EVENT);
    raw.bias.push({ ...raw.bias[0], analyzed_at: "2020-01-01T00:00:00Z", summary: { ...raw.bias[0].summary, overall_journalist_rating: 0.01 } });
    const withOld = buildExploreInput(raw);
    expect(withOld.bias[-103].summary.overall_journalist_rating).toBe(0.62);
  });

  it("resolves insight urls despite trailing slashes, tracking params and host-only matches", () => {
    const index = new ArticleIndex(input);
    expect(index.resolveUrl("https://www.geenstijl.nl/5241987/dijkerhoven-wordt-geofferd-aan-de-windlobby").article?.id).toBe(-105);
    expect(index.resolveUrl("https://nos.nl/artikel/2601101-windpark-dijkerhoven-mag-er-komen-dorp-verdeeld/?utm_source=x").article?.id).toBe(-102);
    expect(index.resolveUrl("https://nos.nl/artikel/9999999-iets-anders")).toEqual({ article: null, outletKey: "nos" });
    expect(index.resolveUrl("https://unknown.example/x")).toEqual({ article: null, outletKey: null });
    expect(index.resolveUrl(null)).toEqual({ article: null, outletKey: null });
    expect(index.outletForName("Telegraaf")).toBe("telegraaf");
    expect(index.outletForName("Onbekend")).toBeNull();
  });
});

describe("deriveFindings", () => {
  const input = buildExploreInput(DEMO_EVENT);
  const findings = deriveFindings(input);
  const byTab = findingsByTab(findings);

  it("fills every tab for a rich event", () => {
    for (const tab of ["invalshoeken", "klopt", "stemmen", "ontbreekt", "gebracht", "tijdlijn"] as const) {
      expect(byTab.get(tab)?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("covers every insight field", () => {
    const types = new Set(findings.map((finding) => finding.type));
    for (const type of ["perspective", "voices", "contradiction", "claim", "statistic", "fallacy", "authority", "timing", "frame", "tone", "bias", "gap", "questions", "science", "first", "timeline"]) {
      expect(types.has(type as never)).toBe(true);
    }
    expect(findings.filter((finding) => finding.type === "contradiction")).toHaveLength(2);
    expect(findings.filter((finding) => finding.type === "authority")).toHaveLength(4);
  });

  it("has unique and stable ids, the old clue ids without their spoor", () => {
    const ids = findings.map((finding) => finding.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(deriveFindings(buildExploreInput(DEMO_EVENT)).map((finding) => finding.id)).toEqual(ids);
    expect(ids.every((id) => /^[a-z]+:[0-9a-z]+(-\d+)?$/.test(id))).toBe(true);
    const claim = findings.find((finding) => finding.type === "claim")!;
    expect(legacyFindingId(`wat-klopt-niet:${claim.id}`)).toBe(claim.id);
    expect(legacyFindingId(claim.id)).toBe(claim.id);
  });

  it("links contradiction sides to outlets", () => {
    const turbines = findings.find((finding) => finding.body.type === "contradiction" && finding.body.contradiction.topic.includes("turbines"));
    expect(turbines?.body.type === "contradiction" && turbines.body.outletsA).toEqual(["ad"]);
    expect(turbines?.body.type === "contradiction" && turbines.body.outletsB).toEqual(["nos", "nu-nl"]);
  });

  it("orders first reporters", () => {
    const first = findings.find((finding) => finding.body.type === "first");
    expect(first?.body.type === "first" && first.body.order[0].outletKey).toBe("nu-nl");
    expect(first?.body.type === "first" && first.body.order[1].lagMinutes).toBe(39);
  });

  it("works for old insights without critical fields and for missing insights", () => {
    const raw = clone(DEMO_EVENT);
    raw.insight = {
      ...raw.insight!,
      unsubstantiated_claims: undefined,
      authority_analysis: undefined,
      media_analysis: undefined,
      statistical_issues: undefined,
      timing_analysis: undefined,
      scientific_plurality: undefined,
      involved_countries: undefined,
    };
    raw.bias = [];
    const old = deriveFindings(buildExploreInput(raw));
    const types = new Set(old.map((finding) => finding.type));
    expect(types.has("authority")).toBe(false);
    expect(types.has("perspective")).toBe(true);

    const none = clone(DEMO_EVENT);
    none.insight = null;
    none.bias = [];
    const derived = deriveFindings(buildExploreInput(none));
    expect(derived.every((finding) => finding.type === "first")).toBe(true);
  });
});

describe("propaganda filter signals", () => {
  const input = buildExploreInput(DEMO_EVENT);
  const findings = deriveFindings(input);
  const evidence = eventFilterSignals(input, findings);
  const byFilter = Object.fromEntries(evidence.map((entry) => [entry.filter, entry.signals]));

  it("returns all six filters without levels or scores (the decision-making categories have no event signals)", () => {
    expect(evidence.map((entry) => entry.filter)).toEqual(["eigendom", "advertentie", "sourcing", "flak", "ideologie", "tegenmacht"]);
    for (const entry of evidence) {
      expect(Object.keys(entry).sort()).toEqual(["filter", "signals"]);
    }
  });

  it("finds flak from the watchdog account and ad hominem", () => {
    expect(byFilter.flak.some((signal: { text: string }) => signal.text.includes("Een Blik op de NOS levert kritiek op NOS"))).toBe(true);
    expect(byFilter.flak.some((signal: { text: string }) => signal.text.includes("Op de man spelen"))).toBe(true);
  });

  it("finds sourcing, ideology, advertising and counter-power signals linked to findings", () => {
    expect(byFilter.sourcing.some((signal: { text: string }) => signal.text.includes("persberichten"))).toBe(true);
    expect(byFilter.ideologie.some((signal: { text: string }) => signal.text.includes("Angst"))).toBe(true);
    expect(byFilter.advertentie.some((signal: { text: string }) => signal.text.includes("Sensationeel"))).toBe(true);
    expect(byFilter.tegenmacht.some((signal: { text: string }) => signal.text.includes("Kritische toon"))).toBe(true);
    expect(byFilter.sourcing.every((signal: { findingIds: string[] }) => signal.findingIds.length > 0)).toBe(true);
  });

  it("returns empty signal lists (not a verdict) when there is nothing to report", () => {
    const empty = eventFilterSignals(buildExploreInput(SECOND_EVENT), deriveFindings(buildExploreInput(SECOND_EVENT)));
    const flak = empty.find((entry) => entry.filter === "flak");
    expect(flak?.signals).toEqual([]);
  });
});

describe("compare and bias", () => {
  const input = buildExploreInput(DEMO_EVENT);
  const clues = deriveFindings(input);

  it("builds an outlet profile view", () => {
    const view = outletProfileView("telegraaf", input, clues);
    expect(view?.tone).toBe("Geruststellend");
    expect(view?.ownFrames).toContain("Economisch");
    expect(view?.perspectives[0].label).toBe("Economische kans voor het dorp");
    expect(view?.bias?.sentenceCount).toBe(3);
    expect(outletProfileView("onbekend", input, clues)).toBeNull();
  });

  it("finds contradictions between two outlets in either order", () => {
    expect(contradictionsBetween("ad", "nos", clues)).toHaveLength(1);
    expect(contradictionsBetween("nos", "ad", clues)).toHaveLength(1);
    expect(contradictionsBetween("telegraaf", "nos", clues)).toHaveLength(0);
  });

  it("aggregates bias per outlet and builds swipe cards", () => {
    const byOutlet = biasByOutlet(input);
    expect(byOutlet.get("geenstijl")?.topTypes[0].count).toBe(1);
    expect(byOutlet.get("nu-nl")?.quoteSentenceCount).toBe(1);
    const cards = biasCards(input, { outletKey: "geenstijl" });
    expect(cards).toHaveLength(4);
    expect(cards[0].score).toBeGreaterThanOrEqual(cards[1].score);
    expect(biasCards(input, { outletKey: "nu-nl", includeQuotes: true })).toHaveLength(2);
    expect(objectivity(0.62)).toBe(38);
  });
});

describe("labels", () => {
  it("translates frames, tones, fallacies and bias types", () => {
    expect(frameLabel("authority_deference")).toBe("Gezag volgen");
    expect(frameLabel("iets_nieuws")).toBe("Iets nieuws");
    expect(toneLabel("Alarmerend")).toBe("Alarmerend");
    expect(fallacyLabel("vals_dilemma")).toBe("Vals dilemma");
    expect(biasTypeLabel("Word Choice Bias")).toBe("Geladen woordkeus");
    expect(biasTypeLabel("Word Choice")).toBe("Geladen woordkeus");
  });
});
