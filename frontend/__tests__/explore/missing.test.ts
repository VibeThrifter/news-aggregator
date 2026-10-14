import { deriveFindings, findingLabel, findingsByTab } from "@/lib/explore/findings";
import { DEMO_EVENT } from "@/lib/explore/fixtures/demo-event";
import { buildExploreInput, type RawExploration } from "@/lib/explore/input";
import { isContextGap, omissionText } from "@/lib/explore/missing";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

describe("isContextGap", () => {
  it("tells missing context from a voice by the words of older analyses", () => {
    for (const label of [
      "Oorsprong en onderbouwing van de cijfers",
      "Wat '40 jaar tot levenslang' concreet betekent",
      "Historische context van Westpoort en het Joh. Enschedé-terrein",
      "Juridische motivering van het hof",
      "Het wettelijk kader voor sancties op collectief niveau",
      "Privacy en mediaethiek rond rouwperioden",
    ]) {
      expect(isContextGap({ perspective: label })).toBe(true);
    }
    for (const label of ["Medewerkers en distributiecentra", "Nabestaanden en hun advocaat", "Onafhankelijke cybersecurity-experts", "Positie van Kennedy zelf", "Ministerie/COA"]) {
      expect(isContextGap({ perspective: label })).toBe(false);
    }
  });

  it("follows what the analysis says", () => {
    expect(isContextGap({ perspective: "Kosten voor huishoudens", kind: "stem" })).toBe(false);
    expect(isContextGap({ perspective: "Boeren op de polder", kind: "context" })).toBe(true);
  });
});

describe("omissionText", () => {
  it("leaves out sentences about the text the analysis had, and repeats", () => {
    expect(
      omissionText([
        { framing_by_omission: "Door 'experts say' in de kop ontstaat de indruk van consensus. Dit is niet te toetsen op basis van de beschikbare tekst." },
        { framing_by_omission: "Beperkt tot de kop, dus context ontbreekt." },
        { framing_by_omission: "Door 'experts say' in de kop ontstaat de indruk van consensus." },
      ]),
    ).toBe("Door 'experts say' in de kop ontstaat de indruk van consensus.");
    expect(omissionText([{ framing_by_omission: "" }, {}])).toBeNull();
  });
});

describe("Niet gevraagd", () => {
  it("has one finding per question, in its own tab, and an outlet asks the same question once", () => {
    const raw = clone(DEMO_EVENT) as RawExploration;
    const media = raw.insight!.media_analysis!;
    const telegraaf = media.find((item) => item.source === "De Telegraaf")!;
    // A second article of the same outlet with one question again and one new
    media.push({ ...telegraaf, questions_not_asked: ["wie beheert het omgevingsfonds?", "Wat kost de netaansluiting?"] });
    const findings = deriveFindings(buildExploreInput(raw));
    const questions = findings.filter((finding) => finding.body.type === "question");
    const ofTelegraaf = questions.filter((finding) => finding.body.type === "question" && finding.body.outletKey === "telegraaf");
    expect(ofTelegraaf.map((finding) => (finding.body.type === "question" ? finding.body.question : ""))).toEqual([
      "Wie beheert het omgevingsfonds?",
      "Wat vinden omwonenden?",
      "Wat kost de netaansluiting?",
    ]);
    expect(questions.every((finding) => finding.tab === "vragen")).toBe(true);
    const byTab = findingsByTab(findings);
    expect(byTab.get("ontbreekt")?.some((finding) => finding.body.type === "question")).toBe(false);
    expect(new Set(questions.map((finding) => finding.id)).size).toBe(questions.length);
  });

  it("calls missing context by its name", () => {
    const raw = clone(DEMO_EVENT) as RawExploration;
    raw.insight!.coverage_gaps = [{ perspective: "Onderbouwing van de cijfers", description: "", relevance: "", potential_sources: [] }];
    const gap = deriveFindings(buildExploreInput(raw)).find((finding) => finding.body.type === "gap")!;
    expect(findingLabel(gap)).toBe("Ontbrekende context");
  });
});
