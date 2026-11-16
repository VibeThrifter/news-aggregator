/**
 * @jest-environment jsdom
 */
import { chanceLabel, copyGroupLabel, copyGroups, copyShortLabel, shareLabel } from "@/lib/explore/copies";
import { buildExploration } from "@/lib/explore/exploration";
import { buildFigure } from "@/lib/explore/figure";
import { DEMO_EVENT } from "@/lib/explore/fixtures/demo-event";
import type { RawExploration, RawExploreArticle } from "@/lib/explore/input";

const clone = (raw: RawExploration): RawExploration => JSON.parse(JSON.stringify(raw));

const copied = (id: number, source: string, minutes: number, copy: RawExploreArticle["copy"]): RawExploreArticle => ({
  id,
  title: "Bieders hebben 27 miljoen euro over voor vakantieparken Gillis",
  url: `https://example.org/${source}/${id}`,
  source_name: source,
  published_at: new Date(Date.UTC(2026, 9, 1, 13, 41 + minutes)).toISOString(),
  is_international: false,
  source_country: "NL",
  spectrum: null,
  copy,
});

const agency = { group: -8001, source: "persbureau", agency: null, likely_agency: "ANP", publisher: null };

function withCopies(...articles: RawExploreArticle[]) {
  const raw = clone(DEMO_EVENT);
  raw.articles.push(...articles);
  return buildExploration(raw).input;
}

describe("zelfde tekst (Story 14.27)", () => {
  it("puts the articles of one text together, the first published first", () => {
    const input = withCopies(
      copied(-8002, "De Telegraaf", 12, { ...agency, share: 0.96, match: -8001, probability: 0.998 }),
      copied(-8001, "RTL Nieuws", 0, { ...agency, share: 1, match: -8002, probability: 0.998 }),
    );
    const groups = copyGroups(input.articles);
    expect(groups).toHaveLength(1);
    expect(groups[0].articles.map(({ article }) => article.id)).toEqual([-8001, -8002]);
    expect(groups[0].outletKeys).toEqual(["rtl-nieuws", "telegraaf"]);
    expect(copyGroupLabel(groups[0])).toBe("Zelfde persbureautekst (vermoedelijk ANP)");
  });

  it("needs two outlets, and leaves out a stored copy that does not parse", () => {
    const input = withCopies(
      copied(-8001, "RTL Nieuws", 0, { ...agency, share: 1, match: -8002, probability: 0.9 }),
      copied(-8002, "RTL Nieuws", 30, { ...agency, share: 1, match: -8001, probability: 0.9 }),
      copied(-8003, "AD", 40, { ...agency, share: "veel", match: -8001, probability: 0.9 }),
    );
    expect(copyGroups(input.articles)).toEqual([]);
    expect(input.articles.find((article) => article.id === -8003)?.copy).toBeNull();
  });

  it("names where the text comes from", () => {
    expect(copyGroupLabel({ source: "persbureau", agency: "ANP", likelyAgency: null, publisher: null })).toBe("Zelfde ANP-tekst");
    expect(copyGroupLabel({ source: "uitgever", agency: null, likelyAgency: null, publisher: "DPG Media" })).toBe("Zelfde artikel van DPG Media");
    expect(copyGroupLabel({ source: null, agency: null, likelyAgency: null, publisher: "DPG Media" })).toBe("Zelfde tekst bij titels van DPG Media");
    expect(copyGroupLabel({ source: null, agency: null, likelyAgency: null, publisher: null })).toBe("Zelfde tekst");
  });

  it("says how much of an article is the text, and how sure that is", () => {
    expect(shareLabel(0.92)).toBe("92% dezelfde tekst");
    expect(shareLabel(0.04)).toBe("bevat deze tekst");
    expect(chanceLabel(0.62)).toBe("kans 62%");
    expect(chanceLabel(0.9996)).toBe("kans 99%");
  });

  it("puts a word for the source on the line: ANP only when a text names it", () => {
    expect(copyShortLabel({ source: "persbureau", agency: "ANP", publisher: null })).toBe("ANP");
    expect(copyShortLabel({ source: "persbureau", agency: null, publisher: null })).toBe("persbureau");
    expect(copyShortLabel({ source: "uitgever", agency: null, publisher: "DPG Media" })).toBe("DPG Media");
    expect(copyShortLabel({ source: null, agency: null, publisher: "DPG Media" })).toBe("zelfde tekst");
  });
});

/** The demo with one text at the outlets of these articles (the first id is the group) */
function demoWithCopy(ids: number[]) {
  const raw = clone(DEMO_EVENT);
  for (const article of raw.articles) {
    if (!ids.includes(article.id)) continue;
    const match = ids.find((id) => id !== article.id) as number;
    article.copy = { ...agency, group: ids[0], share: 0.9, match, probability: 0.99 };
  }
  return buildExploration(raw);
}

describe("zelfde tekst in het beeld", () => {
  it("is a finding of Wie praat?, numbered after the contradictions and before the missing voices", () => {
    // NU.nl -101 and De Telegraaf -103
    const exploration = demoWithCopy([-101, -103]);
    const copy = exploration.findings.find((finding) => finding.type === "copy");
    expect(copy?.tab).toBe("stemmen");
    expect(copy?.outletKeys).toEqual(["nu-nl", "telegraaf"]);
    const figure = buildFigure(exploration, () => true);
    const number = figure.numbers.get(copy!.id) ?? 0;
    const of = (type: string) => exploration.findings.filter((finding) => finding.type === type).map((finding) => figure.numbers.get(finding.id) ?? 0);
    expect(Math.max(...of("contradiction"))).toBeLessThan(number);
    expect(Math.min(...of("gap").filter(Boolean))).toBeGreaterThan(number);
  });

  it("puts the outlets of one text side by side in their group and draws one line between them", () => {
    const exploration = demoWithCopy([-101, -103]);
    const figure = buildFigure(exploration, () => true);
    expect(figure.copyLines).toHaveLength(1);
    const [line] = figure.copyLines;
    const group = figure.groups.find((item) => item.key === line.group);
    expect(group?.outlets.slice(0, 2).map((balloon) => balloon.anchor).sort()).toEqual(["outlet:nu-nl", "outlet:telegraaf"]);
    expect(line).toMatchObject({ label: "persbureau", lead: true });
    expect(figure.copyNotes.size).toBe(0);
  });

  it("says on each balloon which outlets have the same text when they stand apart", () => {
    // AD -104 and NU.nl -101 stand in different perspectives
    const exploration = demoWithCopy([-104, -101]);
    const figure = buildFigure(exploration, () => true);
    const ad = Array.from(figure.copyNotes.entries()).find(([key]) => key.endsWith("|outlet:ad"));
    const nu = Array.from(figure.copyNotes.entries()).find(([key]) => key.endsWith("|outlet:nu-nl"));
    expect(figure.copyLines).toHaveLength(0);
    expect(ad?.[1].map((note) => note.others)).toEqual([["NU.nl"]]);
    expect(nu?.[1].map((note) => note.others)).toEqual([["AD"]]);
    // The picture scrolls to one place of the text
    expect(Array.from(figure.copyNotes.values()).flat().filter((note) => note.lead)).toHaveLength(1);
  });

  it("joins three outlets of one text with as many lines as it takes, never with a line across others", () => {
    // NU.nl, NOS and De Telegraaf: whatever group they stand in, every line joins neighbours
    const exploration = demoWithCopy([-101, -102, -103]);
    const figure = buildFigure(exploration, () => true);
    for (const line of figure.copyLines) {
      const anchors = figure.groups.find((group) => group.key === line.group)?.outlets.map((balloon) => balloon.anchor) ?? [];
      const [a, b] = [anchors.indexOf(line.from), anchors.indexOf(line.to)];
      expect((Math.abs(a - b) === 1 && Math.floor(a / 2) === Math.floor(b / 2)) || Math.abs(a - b) === 2).toBe(true);
    }
    // Every outlet of the text is on a line or has a note
    const onLine = new Set(figure.copyLines.flatMap((line) => [line.from, line.to]));
    const noted = new Set(Array.from(figure.copyNotes.keys()).map((key) => key.split("|")[1]));
    for (const anchor of ["outlet:nu-nl", "outlet:nos", "outlet:telegraaf"]) {
      expect(onLine.has(anchor) || noted.has(anchor)).toBe(true);
    }
  });
});
