import { DEMO_EVENT } from "@/lib/explore/fixtures/demo-event";
import { buildExploreInput } from "@/lib/explore/input";
import { outletSentences, type OutletSentence } from "@/lib/explore/outlet-sentences";
import { splitSentences, summarySentences } from "@/lib/explore/summary";

const text = (sentence: OutletSentence) => sentence.map((part) => part.text).join("");
const own = (sentence: OutletSentence) => sentence.filter((part) => part.own).map((part) => part.text);

describe("summary sentences", () => {
  it("splits at sentence ends, not inside names, numbers or abbreviations", () => {
    expect(
      splitSentences(
        'Het park levert 1.200 banen op, meldt NU.nl. Volgens o.a. Shell en J. Smith is dat "te veel." Klopt dat? 2026 wordt beslissend.',
      ),
    ).toEqual(["Het park levert 1.200 banen op, meldt NU.nl.", 'Volgens o.a. Shell en J. Smith is dat "te veel."', "Klopt dat?", "2026 wordt beslissend."]);
  });

  it("leaves out headings and markdown", () => {
    expect(summarySentences("Eerste zin, meldt **NOS**. Tweede zin.\n\n**Internationale vergelijking**\nReuters plaatst het in context.\n- Een punt\n- Nog een punt")).toEqual([
      "Eerste zin, meldt NOS.",
      "Tweede zin.",
      "Reuters plaatst het in context.",
      "Een punt",
      "Nog een punt",
    ]);
  });
});

describe("what an outlet wrote according to the analysis", () => {
  const input = buildExploreInput(DEMO_EVENT);
  const sentences = outletSentences(input);
  const keyOf = (name: string) => input.outlets.find((outlet) => outlet.name === name)?.key ?? name;

  it("finds an international outlet by the short name the summary uses (DW)", () => {
    const dw = sentences.get(keyOf("Deutsche Welle")) ?? [];
    expect(dw.map(text)).toEqual([
      "Terwijl Nederlandse media zich richten op de lokale strijd, plaatst de Duitse omroep DW het park in de internationale expansie van NordVind.",
    ]);
    expect(own(dw[0])).toEqual(["DW"]);
    expect((sentences.get(keyOf("VRT NWS")) ?? []).map(text)).toEqual(["De Vlaamse VRT meldt dat hetzelfde bedrijf ook in Vlaanderen op verzet stuit."]);
  });

  it("keeps the order of the summary and does not count a name inside another outlet's name", () => {
    const nos = sentences.get(keyOf("NOS")) ?? [];
    expect(nos.map(text)).toEqual([
      "De gemeenteraad van Dijkerhoven heeft ingestemd met een windpark van de Duitse ontwikkelaar NordVind, meldt NOS.",
      "Over het aantal turbines lopen de berichten uiteen: het AD spreekt van 18 turbines, NOS van 12.",
      "Het onderzoek naar laagfrequent geluid van de turbines is nog niet afgerond, schrijft NOS.",
      "Het account Een Blik op de NOS verwijt de NOS dat omwonenden in de eerste berichtgeving ontbraken.",
    ]);
    // "Een Blik op de NOS" is its own outlet; NOS is the second name in that sentence
    expect(own(nos[3])).toEqual(["NOS"]);
    expect(own((sentences.get(keyOf("Een Blik op de NOS")) ?? [])[0])).toEqual(["Een Blik op de NOS"]);
  });

  const withSummary = (body: string) => outletSentences({ ...input, summary: { title: null, body, firstParagraph: "" } });

  it("brings the sentence before when a sentence leans on it ('Dat meldt NOS.')", () => {
    const nos = withSummary("Een man is opgepakt in Breda. Dat meldt NOS. Daarna gebeurde iets anders.").get(keyOf("NOS")) ?? [];
    expect(nos.map(text)).toEqual(["Een man is opgepakt in Breda. Dat meldt NOS."]);
    expect(own(nos[0])).toEqual(["NOS"]);
    // No double sentence when the one before names the outlet too
    const twice = withSummary("Er komt een windpark, meldt NOS. Daarbij gaat het om twaalf turbines, aldus NOS.").get(keyOf("NOS")) ?? [];
    expect(twice.map(text)).toEqual(["Er komt een windpark, meldt NOS. Daarbij gaat het om twaalf turbines, aldus NOS."]);
  });

  it("has nothing for an outlet the summary does not name", () => {
    // "NU" on its own is a common word, not NU.nl
    expect(Array.from(withSummary("NU is het zover, meldt NOS.").keys())).toEqual([keyOf("NOS")]);
    expect(withSummary("").size).toBe(0);
  });
});

describe("the Dutch gist of a foreign article", () => {
  it("is read from the raw article and ignored when it is malformed", () => {
    const input = buildExploreInput(DEMO_EVENT);
    expect(input.articles.find((article) => article.id === -112)?.digest).toEqual({
      text: expect.stringMatching(/^NordVind breidt uit naar Nederland/),
      basis: "text",
    });
    // Dutch articles have none
    expect(input.articles.find((article) => article.id === -102)?.digest).toBeNull();

    const raw = JSON.parse(JSON.stringify(DEMO_EVENT)) as typeof DEMO_EVENT;
    const dw = raw.articles.find((article) => article.id === -112)!;
    const digestOf = (digest: unknown) => {
      dw.digest = digest as typeof dw.digest;
      return buildExploreInput(raw).articles.find((article) => article.id === -112)?.digest;
    };
    expect(digestOf({ nl: "  De kop in het Nederlands. ", basis: "title" })).toEqual({ text: "De kop in het Nederlands.", basis: "title" });
    expect(digestOf({ nl: "Zonder basis" })).toEqual({ text: "Zonder basis", basis: "text" });
    expect(digestOf({ nl: "   " })).toBeNull();
    expect(digestOf({ nl: 42 })).toBeNull();
    expect(digestOf("tekst")).toBeNull();
    expect(digestOf(null)).toBeNull();
  });
});
