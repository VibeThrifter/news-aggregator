import { initials, parseSourcePart } from "@/lib/explore/speakers";

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
