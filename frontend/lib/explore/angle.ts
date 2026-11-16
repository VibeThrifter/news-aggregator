/**
 * The name of a perspective ("invalshoek") says how the news is brought, never who brings it: the
 * balloons in it name the outlets. Analyses often named the outlet anyway ("Telegraaf: nadruk op
 * …", "Berichtgeving AD", "Recensie van de Volkskrant"); this leaves the outlet out. Pure.
 */

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The ways a label writes an outlet: its name, without "De"/"Het", without "Nieuws". */
function variants(names: string[]): string[] {
  const all = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    all.add(name);
    const bare = name.replace(/^(de|het)\s+/i, "");
    all.add(bare);
    const short = bare.replace(/\s+Nieuws$/, "");
    if (short.length >= 2) all.add(short);
  }
  return Array.from(all).sort((a, b) => b.length - a.length);
}

/** The label of a perspective without the outlets in `names`; "Berichtgeving" when nothing is left. */
export function angleLabel(label: string, names: string[]): string {
  const found = variants(names);
  let text = label.trim();
  if (found.length) {
    // With a programme or edition of the outlet when one follows at the end or before ":" or "-"
    // ("RTL Boulevard", "AD Media Podcast", "AD Haagsche Courant - …")
    const brand = "(?:(?:\\s+\\p{Lu}[\\p{L}\\p{N}]*){1,2}(?=\\s*(?:$|[:)\\-–—])))?";
    const outlet = `(?:(?:[Dd]e|[Hh]et)\\s+)?(?:${found.map(escape).join("|")})${brand}`;
    const end = "(?![\\p{L}\\p{N}])";
    text = text
      // "Telegraaf: nadruk op …"
      .replace(new RegExp(`^${outlet}\\s*(?::|\\s[-–—])\\s*`, "u"), "")
      // "… (RTL Nieuws)"
      .replace(new RegExp(`\\s*\\(\\s*${outlet}\\s*\\)`, "gu"), "")
      // "Recensie van de Volkskrant", "Duiding door NieuwRechts", "… volgens het AD"
      .replace(new RegExp(`\\s+(?:van|door|in|via|bij|uit|op|volgens)\\s+${outlet}${end}`, "gu"), "")
      // "Telegraaf-berichtgeving", "RTL Nieuws-berichtgeving over …"
      .replace(new RegExp(`(^|\\s)${outlet}-(?=\\p{L})`, "gu"), "$1")
      // "Berichtgeving AD", "Het Parool over …"
      .replace(new RegExp(`(^|[^\\p{L}\\p{N}])${outlet}${end}`, "gu"), "$1");
  }
  text = text
    .replace(/\s{2,}/g, " ")
    // "Museumvereniging en : groei" → "Museumvereniging: groei"
    .replace(/\s+(?:en|of)\s*(?=[:;,]|$)/g, "")
    .replace(/\s+([:;,])/g, "$1")
    .replace(/^[\s:;,–—-]+|[\s:;,–—-]+$/g, "");
  if (!text) return "Berichtgeving";
  return text[0].toUpperCase() + text.slice(1);
}
