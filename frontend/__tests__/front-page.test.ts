import { dayLabel, frontClaim, groupByDay, outletQuotes, pickTopStories, sortByNews, storyHook, storySection, teaserOf } from "@/lib/front-page";
import type { EventListItem } from "@/lib/types";

const SUMMARY = `Premier Kulbergs wint verkiezingen in Letland ruim

De Letse premier Andris Kulbergs heeft de parlementsverkiezingen gewonnen, en wel met een ruimere marge dan verwacht. Volgens de NOS had zijn middenpartij na telling van 88 procent van de stemmen 36,5 procent van de kiezers achter zich. RTL Nieuws noemt 36,6 procent voor de centrumpartij. NU.nl meldt dat Kulbergs de verkiezingen zaterdag met 'ruime voorsprong' won.

**Uitslag en reactie**

Als grootste rivaal noemt de NOS het pro-Russische Letland Eerst met 13 procent. De Telegraaf is de enige Nederlandse bron die de opkomst noemt.`;

function event(id: number, overrides: Partial<EventListItem> = {}): EventListItem {
  return {
    id,
    title: `Nieuws ${id}`,
    article_count: 1,
    last_updated_at: "2026-10-06T10:00:00.000Z",
    has_llm_insights: true,
    source_breakdown: [{ source: "NOS", article_count: 1, is_international: false }],
    ...overrides,
  };
}

const outlets = (...names: string[]) => names.map((source) => ({ source, article_count: 1, is_international: false }));

describe("day labels", () => {
  const now = new Date(2026, 9, 7, 12, 0);

  it("says today and yesterday, else the weekday and date", () => {
    expect(dayLabel(new Date(2026, 9, 7, 0, 5), now)).toBe("Vandaag");
    expect(dayLabel(new Date(2026, 9, 6, 23, 50), now)).toBe("Gisteren");
    expect(dayLabel(new Date(2026, 9, 2, 9, 0), now)).toBe("Vrijdag 2 oktober");
  });

  it("adds the year for news from another year", () => {
    expect(dayLabel(new Date(2025, 3, 28, 9, 0), now)).toBe("28 april 2025");
  });

  it("groups news per day, newest first", () => {
    const days = groupByDay(
      [
        event(1, { last_updated_at: new Date(2026, 9, 5, 9).toISOString() }),
        event(2, { last_updated_at: new Date(2026, 9, 7, 8).toISOString() }),
        event(3, { last_updated_at: new Date(2026, 9, 5, 18).toISOString() }),
      ],
      now,
    );
    expect(days.map((day) => day.label)).toEqual(["Vandaag", "Maandag 5 oktober"]);
    expect(days[1].events.map((item) => item.id)).toEqual([3, 1]);
  });
});

describe("the start of the story", () => {
  it("takes whole sentences of the first paragraph, without the title", () => {
    expect(teaserOf(SUMMARY, 140)).toBe(
      "De Letse premier Andris Kulbergs heeft de parlementsverkiezingen gewonnen, en wel met een ruimere marge dan verwacht.",
    );
  });

  it("cuts one long sentence at a word", () => {
    const teaser = teaserOf(SUMMARY, 60);
    expect(teaser.length).toBeLessThanOrEqual(61);
    expect(teaser.endsWith("…")).toBe(true);
  });

  it("is empty without a summary", () => {
    expect(teaserOf(null, 200)).toBe("");
  });
});

describe("what each outlet reported", () => {
  const letland = event(7289, { summary: SUMMARY, source_breakdown: outlets("NOS", "RTL Nieuws", "NU.nl", "De Telegraaf") });

  it("takes per outlet the first sentence that names it, also by a short name", () => {
    const quotes = outletQuotes(letland, { max: 3 });
    expect(quotes.map((quote) => quote.outlet)).toEqual(["NOS", "RTL Nieuws", "NU.nl"]);
    expect(quotes[0].text).toBe("Volgens de NOS had zijn middenpartij na telling van 88 procent van de stemmen 36,5 procent van de kiezers achter zich.");
    expect(quotes[2].text).toBe("NU.nl meldt dat Kulbergs de verkiezingen zaterdag met 'ruime voorsprong' won.");
  });

  it("leaves out sentences about the sources themselves", () => {
    const quotes = outletQuotes(letland, { max: 4 });
    expect(quotes.map((quote) => quote.outlet)).not.toContain("De Telegraaf");
  });

  it("skips what the teaser already says", () => {
    const teaser = "Volgens de NOS had zijn middenpartij na telling van 88 procent van de stemmen 36,5 procent van de kiezers achter zich.";
    const quotes = outletQuotes(letland, { max: 3, teaser });
    expect(quotes[0]).toEqual({ outlet: "NOS", text: "Als grootste rivaal noemt de NOS het pro-Russische Letland Eerst met 13 procent." });
  });

  it("does not count Een Blik op de NOS as NOS", () => {
    const blik = event(1, {
      summary: "Titel\n\nVolgens Een Blik op de NOS laat de omroep iets weg.",
      source_breakdown: outlets("NOS", "Een Blik op de NOS"),
    });
    expect(outletQuotes(blik, { max: 3 }).map((quote) => quote.outlet)).toEqual(["Een Blik op de NOS"]);
  });

  it("only quotes Dutch outlets", () => {
    const foreign = event(2, {
      summary: "Titel\n\nReuters meldt dat het gebeurde. De NOS schrijft het ook.",
      source_breakdown: [...outlets("NOS"), { source: "Reuters", article_count: 1, is_international: true }],
    });
    expect(outletQuotes(foreign, { max: 3 }).map((quote) => quote.outlet)).toEqual(["NOS"]);
  });
});

describe("top stories", () => {
  it("leads with news where several outlets are quoted, then with the most Dutch outlets", () => {
    const single = event(1, { last_updated_at: "2026-10-06T20:00:00.000Z", summary: "Titel\n\nDe NOS meldt iets." });
    const many = event(2, { last_updated_at: "2026-10-04T08:00:00.000Z", summary: SUMMARY, source_breakdown: outlets("NOS", "RTL Nieuws", "NU.nl") });
    const unquoted = event(3, { last_updated_at: "2026-10-05T08:00:00.000Z", summary: "Titel\n\nIets gebeurde.", source_breakdown: outlets("NOS", "AD", "Trouw", "Het Parool") });
    expect(pickTopStories([single, many, unquoted], 3).map((item) => item.id)).toEqual([2, 3, 1]);
  });

  it("leads with news several Dutch outlets brought in the last day, also when it is not among the newest", () => {
    const fresh = Array.from({ length: 15 }, (_, i) =>
      event(10 + i, {
        last_updated_at: `2026-10-07T${String(4 + i).padStart(2, "0")}:00:00.000Z`,
        summary: "Titel\n\nDe NOS meldt iets.",
        source_breakdown: [...outlets("NOS"), { source: "Reuters", article_count: 10, is_international: true }],
        claims: [{ claim: "Het is belangrijk", by: "NOS", question: "Waarom?" }],
      }),
    );
    const broad = event(1, { last_updated_at: "2026-10-06T22:00:00.000Z", summary: SUMMARY, source_breakdown: outlets("NOS", "RTL Nieuws") });
    const stale = event(2, { last_updated_at: "2026-10-05T22:00:00.000Z", summary: SUMMARY, source_breakdown: outlets("NOS", "RTL Nieuws", "NU.nl") });
    expect(pickTopStories([...fresh, broad, stale], 1).map((item) => item.id)).toEqual([1]);
  });

  it("only looks at the newest news", () => {
    const old = event(1, { last_updated_at: "2026-09-20T08:00:00.000Z", summary: SUMMARY, source_breakdown: outlets("NOS", "RTL Nieuws", "NU.nl") });
    const recent = Array.from({ length: 15 }, (_, i) => event(10 + i, { last_updated_at: `2026-10-0${1 + (i % 6)}T0${i % 10}:00:00.000Z` }));
    expect(pickTopStories([old, ...recent], 1)[0].id).not.toBe(1);
  });

  it("prefers news with a claim without evidence when as many outlets are quoted", () => {
    const plain = event(1, { last_updated_at: "2026-10-06T20:00:00.000Z", summary: "Titel\n\nDe NOS meldt iets." });
    const claimed = event(2, {
      last_updated_at: "2026-10-05T08:00:00.000Z",
      summary: "Titel\n\nDe NOS meldt iets.",
      claims: [{ claim: "Heel Europa krijgt er last van", by: "Jan-Willem van den Beukel (Vemobin)", question: null }],
    });
    expect(pickTopStories([plain, claimed], 1).map((item) => item.id)).toEqual([2]);
  });

  it("puts news without an analysis last", () => {
    const waiting = event(1, { has_llm_insights: false, source_breakdown: outlets("NOS", "RTL Nieuws") });
    const analysed = event(2, { last_updated_at: "2026-10-01T08:00:00.000Z" });
    expect(pickTopStories([waiting, analysed], 1).map((item) => item.id)).toEqual([2]);
  });

  it("sorts by the time of the news", () => {
    const ids = sortByNews([event(1, { last_updated_at: "2026-10-01T08:00:00Z" }), event(2, { last_updated_at: "2026-10-03T08:00:00Z" })]).map((item) => item.id);
    expect(ids).toEqual([2, 1]);
  });
});

describe("Klopt het? on the front page", () => {
  it("takes a named speaker with their organisation and the question to ask", () => {
    const claim = frontClaim({
      claims: [
        { claim: "De dieselprijs stijgt hard", by: "NOS (eigen bewering)", question: "Met hoeveel?" },
        {
          claim: "Als het tot een exportverbod komt, dan zullen wij daar in heel Europa veel last van hebben",
          by: "Jan-Willem van den Beukel (Vemobin)",
          question: "Hoeveel procent van de Europese diesel komt uit de VS?",
        },
      ],
    });
    expect(claim).toEqual({
      claim: "Als het tot een exportverbod komt, dan zullen wij daar in heel Europa veel last van hebben",
      speaker: "Jan-Willem van den Beukel",
      role: "Vemobin",
      question: "Hoeveel procent van de Europese diesel komt uit de VS?",
      named: true,
    });
  });

  it("names the outlet when it makes the claim itself, and leaves out how it is quoted", () => {
    expect(frontClaim({ claims: [{ claim: "'Oorlogachtig'", by: "GeenStijl (auteur)", question: null }] })).toEqual({
      claim: "Oorlogachtig",
      speaker: "GeenStijl",
      role: null,
      question: null,
      named: false,
    });
    expect(frontClaim({ claims: [{ claim: "Er loopt een onderzoek", by: "Kommersant, via de NOS", question: null }] })?.speaker).toBe("Kommersant");
    expect(frontClaim({ claims: [{ claim: "Er komt een wet", by: "bronnen rond het kabinet (anoniem)", question: null }] })?.speaker).toBe("Anonieme bron");
    expect(frontClaim({ claims: [{ claim: "Er zijn twee inbrekers", by: "Niet-genoemde Franse media", question: null }] })?.named).toBe(false);
  });

  it("is empty without claims", () => {
    expect(frontClaim({ claims: [] })).toBeNull();
    expect(frontClaim({})).toBeNull();
  });
});

describe("what makes you read on", () => {
  const STORY = `Russische aanvallen op Oekraïne

Bij Russische aanvallen zijn negentien burgers omgekomen, meldt NU.nl.

**Reactie van Zelensky**

Volgens NU.nl noemt president Volodymyr Zelensky de aanvallen "een van de gemeenste aanvallen" door de Russen. Hij vraagt om meer luchtafweer.

**Beperkte bronbasis**

NU.nl is de enige Nederlandse bron.`;

  it("takes the first heading about the news with the first sentence under it", () => {
    expect(storySection(STORY)).toEqual({
      heading: "Reactie van Zelensky",
      text: 'Volgens NU.nl noemt president Volodymyr Zelensky de aanvallen "een van de gemeenste aanvallen" door de Russen.',
    });
  });

  it("skips what the card already shows", () => {
    const shown = ['Volgens NU.nl noemt president Volodymyr Zelensky de aanvallen "een van de gemeenste aanvallen" door de Russen.'];
    expect(storySection(STORY, shown)?.text).toBe("Hij vraagt om meer luchtafweer.");
  });

  it("skips headings about the sources or the coverage", () => {
    const about = "Titel\n\nIets gebeurde.\n\n**Duiding**\n\nDe NOS kiest een toon.\n\n**Internationale perspectieven**\n\nReuters ook.";
    expect(storySection(about)).toBeNull();
    expect(storySection("Titel\n\nIets.\n\n**Wat bekend is**\n\nHet bericht van NU.nl is kort en bevat weinig details.")).toBeNull();
    expect(storySection(null)).toBeNull();
  });

  it("shows a claim someone with a name makes, else the next part of the story", () => {
    const named = [{ claim: "Heel Europa krijgt er last van", by: "Jan-Willem van den Beukel (Vemobin)", question: null }];
    const own = [{ claim: "De dieven leken goed voorbereid", by: "NOS (eigen duiding)", question: null }];
    expect(storyHook({ summary: STORY, claims: named })?.kind).toBe("claim");
    expect(storyHook({ summary: STORY, claims: own })).toEqual({ kind: "section", section: storySection(STORY) });
    expect(storyHook({ summary: "Titel\n\nIets.", claims: own })).toBeNull();
  });
});
