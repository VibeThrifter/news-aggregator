import {
  evidenceExtras,
  evidenceGaps,
  evidenceOf,
  evidenceSummary,
  fold,
  fromParty,
  GRADE_RANK,
  hostLabel,
  independentOrigins,
  researchNote,
  shortName,
  sourceLabel,
  VERDICT_RANK,
  verdictOf,
  yearOf,
} from "@/lib/explore/evidence";
import type { PmArgument, RelationResearch } from "@/lib/types";

// The arguments behind three RIVM/PBL links of the propaganda model (2026-10-05), shortened
const arg = (id: number, extra: Partial<PmArgument> = {}): PmArgument => ({
  id,
  stance: "supporting",
  status: "ongecontroleerd",
  claim: `Claim ${id}`,
  sources: [],
  ...extra,
});
const pressRelease = { title: "Klimaatdoel 2030 raakt uit zicht — PBL (KEV 2024)", kind: "persbericht" };
const medialogica = { title: "Medialogica in coronatijd", kind: "nieuwsartikel", publisher: "HUMAN / VPRO", published_at: "2021-11-22" };

describe("what a link rests on", () => {
  it("shows one unreviewed press release as exactly that", () => {
    const evidence = evidenceOf([arg(2322, { claim: "De PBL Klimaat- en Energieverkenning wordt door NOS als gezaghebbend feit doorgegeven (24 okt 2024).", sources: [pressRelease] })]);
    expect(evidence.grade).toBe("met_bron");
    expect(evidence.lead?.id).toBe(2322);
    expect(evidenceSummary(evidence)).toBe("1 bron: persbericht · niet gecontroleerd");
    expect(evidenceExtras(evidence)).toEqual([]);
  });

  it("puts a verified argument first and counts its sources, nuance and outdated arguments", () => {
    const evidence = evidenceOf([
      arg(1717, { sources: [{ title: "Vijf maanden coronaberichtgeving", publisher: "NPO Omroepombudsman", published_at: "2020-08-06" }] }),
      arg(3564, { status: "geverifieerd", sources: [{ title: "Wetenschappers bekritiseren", published_at: "2020-04-25" }, { title: "Groene", published_at: "2020-04-15" }] }),
      arg(2191, { stance: "contextual", sources: [medialogica] }),
      arg(145, { status: "verouderd" }),
    ]);
    expect(evidence.grade).toBe("gecontroleerd");
    expect(evidence.lead?.id).toBe(3564);
    expect(evidenceSummary(evidence)).toBe("3 bronnen, 2020 · gecontroleerd");
    expect(evidenceExtras(evidence)).toEqual(["1 nuancering", "1 verouderd argument"]);
  });

  it("calls disputed, countered and outdated links what they are", () => {
    const disputed = evidenceOf([arg(222, { status: "betwist" })]);
    expect(disputed.grade).toBe("betwist");
    expect(evidenceSummary(disputed)).toBe("betwist · zonder bron");
    // a reply against an argument disputes it
    const countered = evidenceOf([arg(10, { sources: [medialogica] }), arg(11, { parent_id: 10, stance: "contradicting" })]);
    expect(countered.grade).toBe("betwist");
    expect(evidenceSummary(countered)).toBe("betwist · 1 bron: nieuwsartikel · HUMAN / VPRO, 2021");
    expect(evidenceExtras(countered)).toEqual(["1 tegenargument"]);
    const outdated = evidenceOf([arg(145, { status: "verouderd" })]);
    expect(outdated.grade).toBe("verouderd");
    expect(evidenceExtras(outdated)).toEqual([]);
    expect(evidenceSummary(evidenceOf([arg(5, { status: "bronvermelding_nodig", sources: [pressRelease] })]))).toBe("1 bron: persbericht · bron nodig");
    expect(evidenceOf([arg(6)]).grade).toBe("zonder_bron");
  });

  it("only counts arguments about whether the link exists", () => {
    expect(evidenceOf([arg(16, { aspect: "influence", sources: [medialogica] })]).grade).toBe("geen");
    expect(evidenceSummary(evidenceOf(null))).toBe("geen onderbouwing in het model");
    expect(evidenceOf([arg(1, { aspect: "existence", sources: [medialogica] })]).grade).toBe("met_bron");
  });

  it("ranks the grades and labels sources", () => {
    expect(Object.entries(GRADE_RANK).sort((a, b) => a[1] - b[1]).map(([grade]) => grade)).toEqual([
      "gecontroleerd",
      "met_bron",
      "zonder_bron",
      "betwist",
      "verouderd",
      "geen",
    ]);
    expect(sourceLabel(medialogica)).toBe("nieuwsartikel · HUMAN / VPRO, 2021");
    expect(sourceLabel({ title: "Losse titel" })).toBe("Losse titel");
    expect(yearOf("2023")).toBe("2023");
    expect(yearOf(null)).toBeNull();
  });
});

const PBL = "Planbureau voor de Leefomgeving (PBL)";
const ownRelease = { ...pressRelease, url: "https://www.pbl.nl/actueel/nieuws/klimaatdoel-2030-raakt-uit-zicht" };

describe("thin evidence: verdict, own sources and research (Story 14.13)", () => {
  it("calls one press release of the party itself thin and says whose it is", () => {
    const evidence = evidenceOf([arg(2322, { sources: [ownRelease] })]);
    expect(verdictOf(evidence, "aannemelijk")).toBe("dun");
    expect(evidenceSummary(evidence, PBL)).toBe("1 bron: persbericht van PBL zelf · niet gecontroleerd");
    expect(evidenceGaps(evidence, PBL)).toEqual([
      "een bron die niet van PBL zelf komt",
      "een tweede, onafhankelijke bron",
      "controle of de bron het verband draagt",
    ]);
    // without the party (or for another party) the plain line stays
    expect(evidenceSummary(evidence)).toBe("1 bron: persbericht · niet gecontroleerd");
    expect(evidenceSummary(evidence, "NOS")).toBe("1 bron: persbericht · niet gecontroleerd");
  });

  it("is strong only when the model says so, or when two independent sources were checked", () => {
    const checked = evidenceOf([
      arg(1, { status: "geverifieerd", sources: [{ title: "Rapport", publisher: "NPO Omroepombudsman" }, { title: "Studie", publisher: "Universiteit Utrecht" }] }),
    ]);
    expect(independentOrigins(checked.sources)).toBe(2);
    expect(verdictOf(checked)).toBe("stevig");
    expect(verdictOf(checked, "aannemelijk")).toBe("dun");
    expect(evidenceGaps(checked)).toEqual([]);
    const sameOrigin = evidenceOf([arg(2, { status: "geverifieerd", sources: [{ title: "A", publisher: "NOS" }, { title: "B", publisher: "NOS" }] })]);
    expect(verdictOf(sameOrigin)).toBe("dun");
    expect(verdictOf(evidenceOf([arg(3, { sources: [medialogica] })]), "onderbouwd")).toBe("stevig");
    // what the arguments show wins over the label when nothing holds
    expect(verdictOf(evidenceOf([arg(4, { status: "betwist" })]), "onderbouwd")).toBe("betwist");
    expect(verdictOf(evidenceOf([arg(5)]), "aannemelijk")).toBe("onbewezen");
    expect(verdictOf(evidenceOf(null))).toBe("onbewezen");
    expect(verdictOf(evidenceOf([arg(6, { status: "verouderd", sources: [medialogica] })]))).toBe("verouderd");
    expect(evidenceGaps(evidenceOf([arg(7, { status: "betwist" })]))).toEqual(["een argument dat de tegenspraak doorstaat"]);
    // next to the verdict label the grade is not repeated
    expect(evidenceSummary(evidenceOf([arg(7, { status: "betwist" })]), null, true)).toBe("zonder bron");
    expect(evidenceGaps(evidenceOf([arg(8)]))).toEqual(["een bron die het verband draagt"]);
    expect(Object.entries(VERDICT_RANK).sort((a, b) => a[1] - b[1]).map(([verdict]) => verdict)).toEqual(["stevig", "dun", "onbewezen", "betwist", "verouderd"]);
  });

  it("counts an automatic re-read of the source as checked, but stays thin on one line of evidence", () => {
    const nos = (n: number, year: string) => ({ title: `NOS ${n}`, kind: "nieuwsartikel", publisher: "NOS", published_at: year, checked: true });
    const evidence = evidenceOf([arg(3913, { sources: [nos(1, "2024-10-24")] }), arg(3914, { sources: [nos(2, "2025-09-16")] })]);
    expect(evidence.grade).toBe("gecontroleerd");
    expect(evidenceSummary(evidence, PBL)).toBe("2 bronnen, 2024–2025 · automatisch gecontroleerd");
    // both from NOS: one line of evidence, so thin unless the model calls it onderbouwd
    expect(independentOrigins(evidence.sources)).toBe(1);
    expect(verdictOf(evidence)).toBe("dun");
    expect(verdictOf(evidence, "aannemelijk")).toBe("dun");
    expect(evidenceGaps(evidence, PBL)).toEqual(["een tweede, onafhankelijke bron"]);
    const human = evidenceOf([arg(1, { status: "geverifieerd", sources: [medialogica] })]);
    expect(evidenceSummary(human)).toBe("1 bron: nieuwsartikel · HUMAN / VPRO, 2021 · gecontroleerd");
  });

  it("recognises a source of the party itself, not a news article about it", () => {
    expect(fold("Planbureau voor de Leefomgeving")).toBe("planbureauvoordeleefomgeving");
    expect(fold("Élan Médiagroep")).toBe("elanmediagroep");
    expect(hostLabel("https://www.pbl.nl/actueel")).toBe("pbl");
    expect(hostLabel("https://nos.nl/artikel/1")).toBe("nos");
    expect(hostLabel("geen adres")).toBeNull();
    expect(shortName(PBL)).toBe("PBL");
    expect(shortName("RIVM")).toBe("RIVM");
    expect(fromParty(ownRelease, PBL)).toBe(true);
    expect(fromParty({ title: "Verkenning", publisher: "Planbureau voor de Leefomgeving" }, PBL)).toBe(true);
    expect(fromParty({ title: "PBL: klimaatdoel uit zicht", url: "https://nos.nl/artikel/2541", publisher: "NOS" }, PBL)).toBe(false);
    expect(fromParty({ url: "https://www.dpgmedia.nl/over" }, "DPG Media")).toBe(true);
    expect(fromParty(ownRelease, null)).toBe(false);
    const several = evidenceOf([arg(9, { sources: [ownRelease, { title: "Jaarverslag", url: "https://www.pbl.nl/jaarverslag", published_at: "2023" }] })]);
    expect(evidenceSummary(several, PBL)).toBe("2 bronnen van PBL zelf, 2023 · niet gecontroleerd");
  });

  it("says how far the research of a thin link is", () => {
    const now = new Date("2026-10-06T12:00:00");
    const row = (status: string, extra: Partial<RelationResearch> = {}): RelationResearch => ({ relation_id: 1564, status, ...extra });
    expect(researchNote(null)).toBeNull();
    expect(researchNote(row("nieuw"))).toBeNull();
    expect(researchNote(row("niet_nodig"))).toBeNull();
    expect(researchNote(row("wachtrij"))).toBe("staat op de lijst om uit te zoeken");
    expect(researchNote(row("bezig"))).toBe("wordt nu uitgezocht");
    expect(researchNote(row("klaar", { found: { arguments: 3, pending: 3 } }))).toBe("uitgezocht: 3 nieuwe argumenten worden gecontroleerd");
    expect(researchNote(row("klaar", { found: { pending: 1 } }))).toBe("uitgezocht: 1 nieuw argument wordt gecontroleerd");
    expect(researchNote(row("klaar", { found: { pending: 0, merged: 2 }, researched_at: "2026-10-06T09:00:00Z" }), now)).toBe("uitgezocht op 6 okt");
    expect(researchNote(row("niets_gevonden", { researched_at: "2025-12-01T09:00:00Z" }), now)).toBe("uitgezocht op 1 dec 2025: geen nieuwe bron gevonden");
    expect(researchNote(row("twijfel"))).toBe("uitgezocht: het bewijs spreekt elkaar tegen");
    expect(researchNote(row("fout"))).toBe("uitzoeken mislukte, volgt opnieuw");
  });
});
