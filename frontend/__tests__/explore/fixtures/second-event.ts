/**
 * A second, smaller exploration fixture (test-only). The app has exactly ONE demo (/event/demo);
 * unit tests that need a second event (estimated perspectives, empty filter signals) use this one.
 * FICTIONAL, like the demo.
 */

import type { RawExploration, RawExploreArticle } from "@/lib/explore/input";

const art = (
  id: number,
  source: string,
  url: string,
  title: string,
  publishedAt: string,
  spectrum: number | string | null,
  international = false,
  country: string | null = null,
): RawExploreArticle => ({
  id,
  title,
  url,
  source_name: source,
  published_at: publishedAt,
  is_international: international,
  source_country: country,
  spectrum,
});

export const SECOND_EVENT: RawExploration = {
  event: {
    id: -2,
    slug: "tweede-event",
    event_type: "politics",
    article_count: 6,
    first_seen_at: "2026-09-20T08:00:00Z",
    last_updated_at: "2026-09-22T17:00:00Z",
    archived_at: null,
  },
  articles: [
    art(-201, "NOS", "https://nos.nl/artikel/2600420-protest-tegen-windpark-op-zee", "Protest tegen windpark op zee", "2026-09-20T08:00:00Z", 4),
    art(-202, "De Telegraaf", "https://www.telegraaf.nl/nieuws/1283100/vissers-varen-uit-tegen-windpark", "Vissers varen uit tegen windpark", "2026-09-20T10:30:00Z", 7),
    art(-203, "de Volkskrant", "https://www.volkskrant.nl/nieuws-achtergrond/windpark-op-zee~c1d2e3f4/", "Windpark op zee: vissers tegen", "2026-09-21T09:15:00Z", 2),
    art(-204, "NU.nl", "https://www.nu.nl/binnenland/6359000/vissers-protesteren-bij-den-helder.html", "Vissers protesteren bij Den Helder", "2026-09-21T12:00:00Z", 6),
    art(-205, "GeenStijl", "https://www.geenstijl.nl/5241500/vissers-tegen-de-windmolenmaffia/", "Vissers tegen de windmolenmaffia", "2026-09-22T09:00:00Z", 8),
    art(-206, "DW", "https://www.dw.com/en/dutch-fishermen-protest-nordvind-offshore-park/a-70100001", "Dutch fishermen protest NordVind offshore park", "2026-09-22T17:00:00Z", null, true, "DE"),
  ],
  insight: {
    query: "",
    generated_at: "2026-09-22T18:00:00Z",
    llm_provider: "demo",
    model: "demo",
    summary: `Protest tegen windpark op zee bij Den Helder

Tientallen vissersboten voeren uit uit protest tegen een windpark op zee van NordVind, meldt NOS. Volgens De Telegraaf vrezen vissers voor hun visgronden.

**Vissers en natuur**

De Volkskrant wijst erop dat natuurorganisaties het park juist steunen vanwege de rustgebieden tussen de turbines. GeenStijl spreekt van een "windmolenmaffia".`,
    timeline: [
      { time: "2026-09-20T07:00:00Z", headline: "Vissers varen uit bij Den Helder", sources: [], spectrum: "mainstream" },
    ],
    clusters: [
      {
        label: "Vissers in het nauw",
        spectrum: "mainstream",
        source_types: ["dagblad"],
        summary: "Het park bedreigt het inkomen van vissers.",
        characteristics: [],
        sources: [
          { title: "Vissers varen uit tegen windpark", url: "https://www.telegraaf.nl/nieuws/1283100/vissers-varen-uit-tegen-windpark", spectrum: "rechts", stance: "Vissers zijn de dupe" },
          { title: "Protest tegen windpark op zee", url: "https://nos.nl/artikel/2600420-protest-tegen-windpark-op-zee", spectrum: "mainstream", stance: "Vissers laten van zich horen" },
        ],
      },
      {
        label: "Natuurwinst op zee",
        spectrum: "links",
        source_types: ["kwaliteitskrant"],
        summary: "Rustgebieden tussen turbines zijn goed voor de natuur.",
        characteristics: [],
        sources: [
          { title: "Windpark op zee: vissers tegen", url: "https://www.volkskrant.nl/nieuws-achtergrond/windpark-op-zee~c1d2e3f4/", spectrum: "links", stance: "Natuurorganisaties zien juist kansen" },
        ],
      },
    ],
    contradictions: [],
    fallacies: [],
    frames: [
      { frame_type: "conflict", technique: "Vissers tegen ontwikkelaar", description: "Het verhaal draait om de strijd tussen vissers en NordVind.", sources: ["https://nos.nl/artikel/2600420-protest-tegen-windpark-op-zee"], spectrum: "mainstream", attribution: "eigen_framing" },
    ],
    coverage_gaps: [],
    unsubstantiated_claims: [],
    authority_analysis: [
      {
        authority: "NordVind",
        authority_type: "bedrijf",
        article_url: "https://www.telegraaf.nl/nieuws/1283100/vissers-varen-uit-tegen-windpark",
        claimed_expertise: "Windparken op zee",
        actual_role: "Ontwikkelaar",
        potential_interests: ["Opbrengst"],
        critical_questions: ["Welke afspraken zijn er met vissers gemaakt?"],
      },
    ],
    media_analysis: [],
    statistical_issues: [],
    timing_analysis: null,
    scientific_plurality: null,
    involved_countries: [{ iso_code: "DE", name: "Germany", relevance: "NordVind is een Duits bedrijf." }],
  },
  entities: [
    { entity_key: "org:nordvind", name: "NordVind", kind: "org", iso_code: null, aliases: ["nordvind"], mention_count: 9, article_count: 5, article_ids: [-201, -202, -203, -205, -206], outlet_counts: { NOS: 2, "De Telegraaf": 3, "de Volkskrant": 2, "NU.nl": 1, GeenStijl: 1 }, salience: 0.3 },
    { entity_key: "place:den-helder", name: "Den Helder", kind: "place", iso_code: null, aliases: ["den-helder"], mention_count: 7, article_count: 5, article_ids: [-201, -202, -203, -204, -206], outlet_counts: { NOS: 2, "De Telegraaf": 2, "NU.nl": 2, "de Volkskrant": 1 }, salience: 0.24 },
  ],
  relations: [
    {
      related_event_id: -1,
      score: 0.62,
      reasons: [
        { type: "entity", key: "org:nordvind", name: "NordVind", kind: "org" },
        { type: "country", iso: "DE" },
      ],
      related_slug: "demo",
      related_title: "Windpark Dijkerhoven splijt dorp en Den Haag",
      related_event_type: "politics",
      related_article_count: 13,
      related_first_seen_at: "2026-09-28T06:12:00Z",
      related_last_updated_at: "2026-09-29T19:40:00Z",
    },
  ],
  bias: [],
  availability: { entities: true, relations: true, bias: true },
};
