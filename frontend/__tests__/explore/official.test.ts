import { chronology, documentLabel } from "@/lib/explore/chronology";
import { buildExploration } from "@/lib/explore/exploration";
import { DEMO_EVENT } from "@/lib/explore/fixtures/demo-event";
import type { RawExploration } from "@/lib/explore/input";
import {
  documentOutlets,
  headlineChanges,
  kamervragenByArticle,
  measuredCopying,
  measuredCopyingLabel,
  pressQuotesByArticle,
  sponsoredLabel,
  togetherClusters,
  voteSummary,
} from "@/lib/explore/official";
import type { EventDocument } from "@/lib/types";

const clone = (raw: RawExploration): RawExploration => JSON.parse(JSON.stringify(raw));

/** The demo news with its outlets' first articles at these minutes after 10:00 */
function withMinutes(minutes: number[]): RawExploration {
  const raw = clone(DEMO_EVENT);
  const firstOf = new Map<string, number>();
  raw.articles.forEach((article, i) => {
    if (!firstOf.has(article.source_name ?? "")) firstOf.set(article.source_name ?? "", i);
  });
  const firsts = [...firstOf.values()];
  raw.articles = raw.articles.map((article, i) => {
    const slot = firsts.indexOf(i);
    const minute = slot >= 0 && slot < minutes.length ? minutes[slot] : 600 + i * 10;
    return { ...article, published_at: new Date(Date.UTC(2026, 9, 8, 8, 0) + minute * 60_000).toISOString() };
  });
  return raw;
}

describe("Tegelijk verschenen (Story 14.35)", () => {
  it("finds three or more outlets within two minutes", () => {
    const input = buildExploration(withMinutes([0, 1, 2, 30, 31])).input;
    const clusters = togetherClusters(input);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].outletKeys).toHaveLength(3);
    expect(new Date(clusters[0].t).toISOString()).toBe("2026-10-08T08:00:00.000Z");
  });

  it("two outlets at once are no cluster", () => {
    expect(togetherClusters(buildExploration(withMinutes([0, 1, 30, 60, 90])).input)).toEqual([]);
  });

  it("puts the cluster on the axis before the articles of that minute", () => {
    const { rows } = chronology(buildExploration(withMinutes([0, 1, 2])).input);
    const kinds = rows.filter((row) => row.t === Date.UTC(2026, 9, 8, 8, 0)).map((row) => row.kind);
    expect(kinds[0]).toBe("together");
    expect(kinds).toContain("publication");
  });
});

describe("Koppen die veranderen (Story 14.32)", () => {
  it("goes from each earlier headline to the next one", () => {
    const raw = clone(DEMO_EVENT);
    const first = raw.articles[0];
    raw.articles[0] = {
      ...first,
      title: "Derde kop",
      title_history: [
        { title: "Eerste kop", until: "2026-09-28T10:00:00Z" },
        { title: "Tweede kop", until: "2026-09-28T12:00:00Z" },
        { title: "", until: "kapot" },
      ],
    };
    const input = buildExploration(raw).input;
    const changes = headlineChanges(input.articles);
    expect(changes.map((change) => [change.from, change.to])).toEqual([
      ["Eerste kop", "Tweede kop"],
      ["Tweede kop", "Derde kop"],
    ]);
    const { rows, after } = chronology(input);
    expect([...rows, ...after].filter((row) => row.kind === "headline")).toHaveLength(2);
  });
});

const PRESS: EventDocument = {
  term: "",
  source: "persbericht",
  doc_type: "Persbericht",
  title: "Collectiestukken terug naar Indonesië",
  url: "https://www.rijksoverheid.nl/actueel/nieuws/2026/10/09/collectiestukken",
  published_at: "2026-10-09T16:00:00Z",
  location: "Ministerie van Onderwijs, Cultuur en Wetenschap",
  details: { quoted_by: [] },
};

describe("Citaat uit het persbericht (Story 14.34) and Kamervragen (Story 14.33)", () => {
  it("maps the quoting articles and replaces the guessed copy score with what was measured", () => {
    const raw = clone(DEMO_EVENT);
    const [a, b] = raw.articles;
    raw.documents = [
      { ...PRESS, details: { quoted_by: [{ article_id: a.id, outlet: a.source_name, quotes: ["Deze objecten hebben een grote waarde", "Tweede citaat van acht woorden hier"], share: 0 }, { article_id: b.id, outlet: b.source_name, quotes: [], share: 0 }] } },
      {
        term: "",
        source: "kamervragen",
        doc_type: "Kamervragen",
        title: "Het bericht ‘…’",
        url: "https://zoek.officielebekendmakingen.nl/kv-tk-2026Z22400.html",
        published_at: "2027-01-15T00:00:00Z",
        location: "Tweede Kamer",
        details: { cites: [{ article_id: b.id, outlet: b.source_name }], askers: "Ergin (DENK)" },
      },
    ];
    const input = buildExploration(raw).input;
    const press = pressQuotesByArticle(input.documents);
    expect(press.get(a.id)?.[0].quotes).toHaveLength(2);
    // Nothing measured for b: no quotes and no running text
    expect(press.has(b.id)).toBe(false);
    expect(kamervragenByArticle(input.documents).get(b.id)?.map((d) => d.details?.askers)).toEqual(["Ergin (DENK)"]);

    const articleA = input.articles.find((article) => article.id === a.id)!;
    const measured = measuredCopying(input, articleA.outletKey);
    expect(measured.pressQuotes).toBe(2);
    expect(measured.pressFrom).toEqual(["Ministerie van Onderwijs, Cultuur en Wetenschap"]);
    expect(measuredCopyingLabel(measured)).toContain("2 citaten uit een persbericht");

    const question = input.documents!.find((d) => d.source === "kamervragen")!;
    expect(documentOutlets(question, input.articles)).toEqual([input.articles.find((article) => article.id === b.id)!.outletName]);
    expect(chronology(input).after.some((row) => row.kind === "document" && row.document.source === "kamervragen")).toBe(true);
  });

  it("labels the new kinds of documents by their own type", () => {
    expect(documentLabel({ source: "kamervragen", doc_type: "Kamervragen", location: "Tweede Kamer" })).toBe("Kamervragen · Tweede Kamer");
    expect(documentLabel({ source: "persbericht", doc_type: "Persbericht", location: "Ministerie van Financiën" })).toBe("Persbericht · Ministerie van Financiën");
  });

  it("says nothing was measured when nothing was", () => {
    expect(measuredCopyingLabel({ sameTextShare: null, sameTextWith: [], pressQuotes: 0, pressFrom: [] })).toBeNull();
    expect(measuredCopyingLabel({ sameTextShare: 0.62, sameTextWith: ["NOS"], pressQuotes: 0, pressFrom: [] })).toBe("62 % dezelfde tekst als NOS");
  });
});

describe("Stemming (Story 14.33)", () => {
  it("sums up how the Kamer voted", () => {
    const vote = {
      result: "Aangenomen",
      kind: "Met handopsteken",
      for: [["D66", 26], ["VVD", 22], ["PRO", 20], ["CDA", 18], ["SP", 3]] as [string, number][],
      against: [["PVV", 19], ["JA21", 9]] as [string, number][],
      seats_for: 89,
      seats_against: 28,
    };
    expect(voteSummary(vote)).toBe("Aangenomen: voor D66, VVD, PRO en 2 andere (89 zetels), tegen PVV en JA21 (28 zetels)");
    expect(voteSummary(null)).toBeNull();
  });
});

describe("Onderzoek in opdracht van (Story 14.36)", () => {
  it("names the researcher and the sponsor, the outlet itself by its name", () => {
    expect(sponsoredLabel({ sponsor: "Independer", researcher: "Q&A", self: false }, "AD")).toBe("Onderzoek van Q&A in opdracht van Independer");
    expect(sponsoredLabel({ sponsor: "deze site", researcher: "Panel Inzicht", self: true }, "AD")).toBe("Onderzoek van Panel Inzicht in opdracht van AD zelf");
    expect(sponsoredLabel({ sponsor: "het kabinet", researcher: null, self: false }, "NOS")).toBe("Onderzoek in opdracht van het kabinet");
  });
});
