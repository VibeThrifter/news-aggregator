import { buildExploration } from "@/lib/explore/exploration";
import { DEMO_EVENT } from "@/lib/explore/fixtures/demo-event";
import type { RawExploration } from "@/lib/explore/input";
import { initials, parseSourcePart, speaksItself } from "@/lib/explore/speakers";

describe("speaker roles", () => {
  it("take the title before the name, never the article the entity is named without", () => {
    const raw: RawExploration = JSON.parse(JSON.stringify(DEMO_EVENT));
    const claim = raw.insight?.unsubstantiated_claims?.find((item) => item.source_in_article?.startsWith("Planbureau"));
    claim!.source_in_article = "Het Planbureau voor de Leefomgeving, via de Volkskrant";
    const { speakers } = buildExploration(raw);
    const pbl = speakers.speakers.find((speaker) => speaker.name === "Planbureau voor de Leefomgeving");
    expect(pbl).toBeDefined();
    expect(pbl?.role).toBeNull();
    expect(speakers.speakers.find((speaker) => speaker.name === "Anouk Verbeek")?.role).toBe("wethouder");
  });
});

describe("who speaks", () => {
  it("is not an authority the article only names or discusses", () => {
    const raw: RawExploration = JSON.parse(JSON.stringify(DEMO_EVENT));
    const authorities = raw.insight!.authority_analysis!;
    const names = (exploration: ReturnType<typeof buildExploration>) => exploration.speakers.speakers.map((speaker) => speaker.name);
    expect(names(buildExploration(raw))).toEqual(expect.arrayContaining(["RIVM", "Stichting Stille Polder"]));

    authorities.find((item) => item.authority === "RIVM")!.speaks = "nee";
    // An analysis of before the field: in its own words
    authorities.find((item) => item.authority === "Stichting Stille Polder")!.actual_role = "Wordt in de artikelen niet zelf geciteerd.";
    const after = names(buildExploration(raw));
    expect(after).not.toContain("RIVM");
    expect(after).not.toContain("Stichting Stille Polder");
  });

  it("reads the field first, the analysis' own words without it", () => {
    expect(speaksItself({ speaks: "ja", actual_role: "Wordt niet geciteerd" })).toBe(true);
    expect(speaksItself({ speaks: "Nee" })).toBe(false);
    expect(speaksItself({ actual_role: "Diyanet wordt in de artikelen niet zelf geciteerd; de kritiek komt van de PVV." })).toBe(false);
    expect(speaksItself({ actual_role: "De gemeente wordt in de actuele berichtgeving niet geciteerd." })).toBe(false);
    expect(speaksItself({ actual_role: "Ontwerper van het gebouw, geciteerd door Trouw." })).toBe(true);
    expect(speaksItself({})).toBe(true);
  });
});

describe("parseSourcePart (real source_in_article strings)", () => {
  const cases: [string, Partial<ReturnType<typeof parseSourcePart> & object> | null][] = [
    ["Jan-Willem van den Beukel (Vemobin)", { name: "Jan-Willem van den Beukel", org: "Vemobin", own: false }],
    ["NU.nl (eigen bewering, niet toegeschreven aan een bron)", { name: "NU.nl", own: true }],
    ["NieuwRechts (het medium zelf)", { name: "NieuwRechts", own: true }],
    ["Openbaar Ministerie (geciteerd door GeenStijl)", { name: "Openbaar Ministerie", via: "GeenStijl" }],
    ["Max Verstappen (geciteerd via NU.nl)", { name: "Max Verstappen", via: "NU.nl" }],
    ["Tina Nijkamp via De Telegraaf", { name: "Tina Nijkamp", via: "De Telegraaf" }],
    ["Benjamin Netanyahu, premier van Israël, in een interview met Fox News", { name: "Benjamin Netanyahu", role: "premier van Israël" }],
    ["Erik Ziengs, voorzitter van Ondernemend Nederland (ONL)", { name: "Erik Ziengs", role: "voorzitter van Ondernemend Nederland" }],
    ["NU.nl op basis van niet nader genoemde wetenschappelijke bevindingen", { name: "NU.nl" }],
    ["bronnen rondom de Deense nationale ploeg (anoniem)", { anonymous: true }],
    ["naamloze 'wetenschappers'", { anonymous: true }],
    ["Factual summary / fase 1-analyse", null],
    ["Partij voor de Dieren (via NieuwRechts)", { name: "Partij voor de Dieren", via: "NieuwRechts" }],
    ["De Telegraaf (titel en lead)", { name: "De Telegraaf", own: true }],
    ["Wethouder Anouk Verbeek", { name: "Wethouder Anouk Verbeek" }],
  ];
  it.each(cases)("%s", (raw, expected) => {
    const parsed = parseSourcePart(raw);
    if (expected === null) {
      expect(parsed).toBeNull();
      return;
    }
    expect(parsed).toMatchObject(expected);
  });

  it("makes initials", () => {
    expect(initials("Jan-Willem van den Beukel")).toBe("JB");
    expect(initials("HCSS")).toBe("HC");
    expect(initials("Max Verstappen")).toBe("MV");
  });
});
