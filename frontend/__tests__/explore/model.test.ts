import { biasByOutlet, biasCards, objectivity } from "@/lib/explore/bias";
import { cluesBySpoor, deriveClues } from "@/lib/explore/clues";
import { contradictionsBetween, outletProfileView } from "@/lib/explore/compare";
import { DEMO_EVENT, DEMO_EVENT_2, isDemoIdentifier } from "@/lib/explore/fixtures/demo-event";
import { buildGraph } from "@/lib/explore/graph";
import { outletNode } from "@/lib/explore/ids";
import { ArticleIndex, buildExploreInput, type RawExploration } from "@/lib/explore/input";
import { biasTypeLabel, fallacyLabel, frameLabel, toneLabel } from "@/lib/explore/labels";
import { findOutletByName, findOutletByUrl } from "@/lib/explore/media-landscape";
import { eventFilterSignals } from "@/lib/explore/propaganda";
import { splitLlmSummary, stripMarkdown, truncate } from "@/lib/explore/summary";
import { spoorProgress, visibleGraph } from "@/lib/explore/visibility";

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
    expect(isDemoIdentifier("demo-2")).toBe(true);
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

describe("deriveClues", () => {
  const input = buildExploreInput(DEMO_EVENT);
  const clues = deriveClues(input);
  const bySpoor = cluesBySpoor(clues);

  it("creates clues in every spoor for a rich event", () => {
    for (const spoor of ["wie-zegt-wat", "wat-klopt-niet", "wie-heeft-belang", "hoe-gebracht", "wat-zie-je-niet", "hoe-liep-het", "buitenland"] as const) {
      expect(bySpoor.get(spoor)?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("covers every insight field", () => {
    const types = new Set(clues.map((clue) => clue.type));
    for (const type of ["perspective", "voices", "contradiction", "claim", "statistic", "fallacy", "authority", "timing", "ownership", "frame", "tone", "bias", "gap", "questions", "science", "silent", "first", "timeline", "international", "country"]) {
      expect(types.has(type as never)).toBe(true);
    }
    expect(clues.filter((clue) => clue.type === "contradiction")).toHaveLength(2);
    expect(clues.filter((clue) => clue.type === "authority")).toHaveLength(3);
  });

  it("has unique and stable ids", () => {
    const ids = clues.map((clue) => clue.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(deriveClues(buildExploreInput(DEMO_EVENT)).map((clue) => clue.id)).toEqual(ids);
  });

  it("does not give away findings in face-down teasers", () => {
    for (const clue of clues) {
      if (clue.body.type === "perspective") {
        expect(clue.teaser.title).not.toContain(clue.body.cluster.label);
        for (const stance of clue.body.stances) {
          if (stance.stance) expect(clue.teaser.hint ?? "").not.toContain(stance.stance);
        }
      }
      if (clue.body.type === "contradiction") {
        expect(clue.teaser.title).not.toContain(clue.body.contradiction.topic);
      }
      if (clue.body.type === "frame") {
        expect(clue.teaser.title).not.toContain(frameLabel(clue.body.frame.frame_type));
      }
    }
  });

  it("links contradiction sides to outlets", () => {
    const turbines = clues.find((clue) => clue.body.type === "contradiction" && clue.body.contradiction.topic.includes("turbines"));
    expect(turbines?.body.type === "contradiction" && turbines.body.outletsA).toEqual(["ad"]);
    expect(turbines?.body.type === "contradiction" && turbines.body.outletsB).toEqual(["nos", "nu-nl"]);
    expect(turbines?.teaser.hint).toBe("AD vs NOS, NU.nl");
  });

  it("orders first reporters", () => {
    const first = clues.find((clue) => clue.body.type === "first");
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
    const oldClues = deriveClues(buildExploreInput(raw));
    const types = new Set(oldClues.map((clue) => clue.type));
    expect(types.has("authority")).toBe(false);
    expect(types.has("perspective")).toBe(true);

    const none = clone(DEMO_EVENT);
    none.insight = null;
    none.bias = [];
    const derived = deriveClues(buildExploreInput(none));
    expect(derived.every((clue) => ["ownership", "silent", "first", "international"].includes(clue.type))).toBe(true);
  });

  it("adds a consensus clue when all outlets share one perspective", () => {
    const raw = clone(DEMO_EVENT);
    raw.insight!.clusters = [raw.insight!.clusters[0]];
    expect(deriveClues(buildExploreInput(raw)).some((clue) => clue.type === "consensus")).toBe(true);
  });
});

describe("graph and fog-of-war", () => {
  const input = buildExploreInput(DEMO_EVENT);
  const clues = deriveClues(input);
  const graph = buildGraph(input, clues);

  it("contains outlets as baseline and findings behind clues", () => {
    expect(graph.nodeById.get(outletNode("nos"))?.baseline).toBe(true);
    const frame = graph.nodes.find((node) => node.kind === "frame");
    expect(frame?.baseline).toBe(false);
    expect(frame?.clueIds.length).toBeGreaterThan(0);
    expect(graph.nodes.some((node) => node.kind === "related")).toBe(true);
  });

  it("merges actors with matching NER entities", () => {
    const nordvind = graph.nodes.filter((node) => node.label === "NordVind");
    expect(nordvind).toHaveLength(1);
    expect(nordvind[0].kind).toBe("entity");
  });

  it("reveals nodes as clues are revealed", () => {
    const hidden = visibleGraph(graph, clues, new Set());
    expect(hidden.nodes.some((node) => node.kind === "contradiction")).toBe(false);
    expect(hidden.hiddenCount).toBeGreaterThan(0);
    expect(hidden.hiddenBySpoor.get("wat-klopt-niet")).toBeGreaterThan(0);

    const contradiction = clues.find((clue) => clue.type === "contradiction")!;
    const after = visibleGraph(graph, clues, new Set([contradiction.id]));
    expect(after.nodes.some((node) => node.kind === "contradiction")).toBe(true);
    expect(after.edges.some((edge) => edge.kind === "contradicts")).toBe(true);

    const all = visibleGraph(graph, clues, new Set(), { revealAll: true });
    expect(all.nodes).toHaveLength(graph.nodes.length);
    expect(all.hiddenCount).toBe(0);
  });

  it("computes progress per spoor", () => {
    const first = clues[0];
    const progress = spoorProgress(clues, new Set([first.id]));
    expect(progress.get(first.spoor)?.revealed).toBe(1);
    expect(progress.get(first.spoor)?.total).toBe(clues.filter((clue) => clue.spoor === first.spoor).length);
  });
});

describe("propaganda filter signals", () => {
  const input = buildExploreInput(DEMO_EVENT);
  const clues = deriveClues(input);
  const evidence = eventFilterSignals(input, clues);
  const byFilter = Object.fromEntries(evidence.map((entry) => [entry.filter, entry.signals]));

  it("returns all six filters without levels or scores", () => {
    expect(evidence.map((entry) => entry.filter)).toEqual(["eigendom", "advertentie", "sourcing", "flak", "ideologie", "tegenmacht"]);
    for (const entry of evidence) {
      expect(Object.keys(entry).sort()).toEqual(["filter", "signals"]);
    }
  });

  it("finds flak from the watchdog account and ad hominem", () => {
    expect(byFilter.flak.some((signal: { text: string }) => signal.text.includes("Een Blik op de NOS levert kritiek op NOS"))).toBe(true);
    expect(byFilter.flak.some((signal: { text: string }) => signal.text.includes("Op de man spelen"))).toBe(true);
  });

  it("finds sourcing, ideology, advertising and counter-power signals linked to clues", () => {
    expect(byFilter.sourcing.some((signal: { text: string }) => signal.text.includes("persberichten"))).toBe(true);
    expect(byFilter.ideologie.some((signal: { text: string }) => signal.text.includes("Angst"))).toBe(true);
    expect(byFilter.advertentie.some((signal: { text: string }) => signal.text.includes("Sensationeel"))).toBe(true);
    expect(byFilter.tegenmacht.some((signal: { text: string }) => signal.text.includes("Kritische toon"))).toBe(true);
    expect(byFilter.sourcing.every((signal: { clueIds: string[] }) => signal.clueIds.length > 0)).toBe(true);
  });

  it("returns empty signal lists (not a verdict) when there is nothing to report", () => {
    const empty = eventFilterSignals(buildExploreInput(DEMO_EVENT_2), deriveClues(buildExploreInput(DEMO_EVENT_2)));
    const flak = empty.find((entry) => entry.filter === "flak");
    expect(flak?.signals).toEqual([]);
  });
});

describe("compare and bias", () => {
  const input = buildExploreInput(DEMO_EVENT);
  const clues = deriveClues(input);

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
