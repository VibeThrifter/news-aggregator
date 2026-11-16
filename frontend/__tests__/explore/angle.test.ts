import { angleLabel } from "@/lib/explore/angle";

describe("angleLabel", () => {
  const names = ["De Telegraaf", "RTL Nieuws", "de Volkskrant", "AD", "NU.nl", "Het Parool"];

  it.each([
    ["Telegraaf: nadruk op onduidelijkheid en de vermoedelijke moord", "Nadruk op onduidelijkheid en de vermoedelijke moord"],
    ["Berichtgeving RTL Nieuws over de verkeerscontrole", "Berichtgeving over de verkeerscontrole"],
    ["Recensie van de Volkskrant", "Recensie"],
    ["Zomerse pechoorzaken volgens het AD", "Zomerse pechoorzaken"],
    ["Nederlandse sportberichtgeving (RTL Nieuws)", "Nederlandse sportberichtgeving"],
    ["Telegraaf-berichtgeving", "Berichtgeving"],
    ["NU.nl-berichtgeving over de reactie van Hofman", "Berichtgeving over de reactie van Hofman"],
    ["Het Parool over de novelle Tetris", "Over de novelle Tetris"],
    ["RTL Boulevard: trotse onthulling van de cover", "Trotse onthulling van de cover"],
    ["Persoonlijk verhaal via RTL Boulevard", "Persoonlijk verhaal"],
    ["AD Haagsche Courant - verslaggeving rechtszaak", "Verslaggeving rechtszaak"],
    ["Duiding Volkskrant: Carney, Trump en onvrede in Canada", "Duiding: Carney, Trump en onvrede in Canada"],
    ["Berichtgeving AD", "Berichtgeving"],
    ["RTL Nieuws", "Berichtgeving"],
  ])("%s → %s", (label, expected) => {
    expect(angleLabel(label, names)).toBe(expected);
  });

  it("leaves a name that says how the news is brought alone", () => {
    expect(angleLabel("Politiebericht en oproep aan het publiek", names)).toBe("Politiebericht en oproep aan het publiek");
    expect(angleLabel("Kritiek op het advertentiebeleid", names)).toBe("Kritiek op het advertentiebeleid");
    // Only the outlets of this news: another one named in the label stays
    expect(angleLabel("Kritiek op Ouariachi en Trouw", ["GeenStijl"])).toBe("Kritiek op Ouariachi en Trouw");
  });
});
