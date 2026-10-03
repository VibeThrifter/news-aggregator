/**
 * The rest of the demo story (behind NEXT_PUBLIC_ENABLE_DEMO): an earlier and a later episode of the
 * Dijkerhoven wind park, and other news with the same alderman. Together with /event/demo they show
 * every part of the event page: "Eerder/Later in dit verhaal", "Dezelfde mensen in ander nieuws",
 * and — in the later episode — the usual case of one Dutch outlet with its speakers, missing voices
 * and foreign coverage (one of it old).
 *
 * FICTIONAL, like /event/demo: Dijkerhoven, its people, NordVind, Stichting Stille Polder and all
 * quotes are made up. Outlet names and national institutions (RIVM, ANP, Ipsos I&O) are real; their
 * role in this story is not. Shape = RawExploration (the same pipeline as real data).
 */

import type { EventRelation, RelationReason } from "@/lib/types";

import type { RawExploration, RawExploreArticle } from "../input";

export const art = (
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

const person = (name: string, key: string): RelationReason => ({ type: "entity", key: `person:${key}`, name, kind: "person" });
const org = (name: string, key: string): RelationReason => ({ type: "entity", key: `org:${key}`, name, kind: "org" });
const place = (name: string, key: string): RelationReason => ({ type: "entity", key: `place:${key}`, name, kind: "place" });

export const REASONS = {
  verbeek: person("Anouk Verbeek", "anouk-verbeek"),
  nordvind: org("NordVind", "nordvind"),
  stillePolder: org("Stichting Stille Polder", "stichting-stille-polder"),
  dijkerhoven: place("Dijkerhoven", "dijkerhoven"),
};

export interface DemoEpisode {
  id: number;
  slug: string;
  title: string;
  firstSeenAt: string;
  lastUpdatedAt: string;
  articleCount: number;
  eventType: string;
}

/** A relation to another demo event, as event_relations stores it */
export function relationTo(episode: DemoEpisode, score: number, reasons: RelationReason[]): EventRelation {
  return {
    related_event_id: episode.id,
    score,
    reasons,
    related_slug: episode.slug,
    related_title: episode.title,
    related_event_type: episode.eventType,
    related_article_count: episode.articleCount,
    related_first_seen_at: episode.firstSeenAt,
    related_last_updated_at: episode.lastUpdatedAt,
  };
}

export const EPISODES = {
  demo: {
    id: -1,
    slug: "demo",
    title: "Windpark Dijkerhoven splijt dorp en Den Haag",
    firstSeenAt: "2026-09-28T06:12:00Z",
    lastUpdatedAt: "2026-09-29T19:40:00Z",
    articleCount: 13,
    eventType: "politics",
  },
  aanloop: {
    id: -2,
    slug: "demo-aanloop",
    title: "Dijkerhoven wil windpark van NordVind in de polder",
    firstSeenAt: "2026-09-20T09:00:00Z",
    lastUpdatedAt: "2026-09-20T09:00:00Z",
    articleCount: 1,
    eventType: "politics",
  },
  vervolg: {
    id: -3,
    slug: "demo-vervolg",
    title: "Rechter legt bouw windpark Dijkerhoven stil",
    firstSeenAt: "2026-10-02T07:10:00Z",
    lastUpdatedAt: "2026-10-02T15:20:00Z",
    articleCount: 4,
    eventType: "legal",
  },
  verbeek: {
    id: -4,
    slug: "demo-verbeek",
    title: "Dijkerhoven verhoogt OZB voor duurzaamheidsfonds",
    firstSeenAt: "2026-08-14T10:30:00Z",
    lastUpdatedAt: "2026-08-14T10:30:00Z",
    articleCount: 1,
    eventType: "politics",
  },
} satisfies Record<string, DemoEpisode>;

const NO_BIAS: RawExploration["bias"] = [];
const AVAILABLE = { entities: true, relations: true, bias: true };

// --- An earlier episode: the plan (one NOS article) ---------------------------------------------

const A = { nos: "https://nos.nl/artikel/2598840-dijkerhoven-wil-windpark-in-de-polder" };

export const DEMO_AANLOOP: RawExploration = {
  event: {
    id: EPISODES.aanloop.id,
    slug: EPISODES.aanloop.slug,
    event_type: "politics",
    article_count: 1,
    first_seen_at: EPISODES.aanloop.firstSeenAt,
    last_updated_at: EPISODES.aanloop.lastUpdatedAt,
    archived_at: null,
  },
  articles: [art(-201, "NOS", A.nos, "Dijkerhoven wil windpark in de polder", "2026-09-20T09:00:00Z", 4)],
  insight: {
    query: "",
    generated_at: "2026-09-20T10:00:00Z",
    llm_provider: "demo",
    model: "demo",
    summary: `${EPISODES.aanloop.title}

Het college van Dijkerhoven wil de Duitse ontwikkelaar NordVind een windpark laten bouwen in de polder ten zuiden van het dorp, meldt NOS. Wethouder Anouk Verbeek legt het plan volgende week aan de gemeenteraad voor.`,
    timeline: [{ time: "2026-09-20T08:00:00Z", headline: "College presenteert plan voor windpark", sources: [A.nos], spectrum: "mainstream" }],
    clusters: [
      {
        label: "Een plan van het college",
        spectrum: "mainstream",
        source_types: ["publieke omroep"],
        summary: "Het plan wordt gebracht als besluit dat nog door de raad moet.",
        characteristics: ["aankondiging"],
        sources: [{ title: "Dijkerhoven wil windpark in de polder", url: A.nos, spectrum: "mainstream", stance: "Het college wil NordVind laten bouwen" }],
      },
    ],
    contradictions: [],
    fallacies: [],
    frames: [{ frame_type: "verantwoordelijkheid", technique: "Het college besluit", description: "Het verhaal draait om wat het college wil, nog niet om het dorp.", sources: [A.nos], spectrum: "mainstream", attribution: "eigen_framing" }],
    coverage_gaps: [
      { perspective: "Omwonenden", description: "Niemand uit het dorp komt aan het woord.", relevance: "Zij merken het park het meest.", potential_sources: ["dorpsraad"] },
      { perspective: "Natuurorganisaties", description: "Of de polder broedgebied is, wordt niet gevraagd.", relevance: "Het bepaalt mede of het park er mag komen.", potential_sources: ["vogelwerkgroep"] },
    ],
    unsubstantiated_claims: [
      { claim: "Het park maakt Dijkerhoven energieneutraal.", presented_as: "voorspelling", source_in_article: "Wethouder Anouk Verbeek", article_url: A.nos, evidence_provided: "geen", missing_context: ["Het energieverbruik van het dorp"], critical_questions: ["Op welke berekening is dit gebaseerd?"] },
    ],
    authority_analysis: [],
    media_analysis: [
      { source: "NOS", article_url: A.nos, tone: "feitelijk", sourcing_pattern: "Alleen het college aan het woord.", questions_not_asked: ["Wat vinden omwonenden?"], perspectives_omitted: ["omwonenden"], framing_by_omission: "", copy_paste_score: "middel", anonymous_source_count: 0, narrative_alignment: "", what_if_wrong: "" },
    ],
    statistical_issues: [],
    timing_analysis: null,
    scientific_plurality: null,
    involved_countries: [{ iso_code: "DE", name: "Germany", relevance: "NordVind is een Duits bedrijf." }],
  },
  entities: [
    { entity_key: "org:nordvind", name: "NordVind", kind: "org", iso_code: null, aliases: ["nordvind"], mention_count: 3, article_count: 1, article_ids: [-201], outlet_counts: { NOS: 3 }, salience: 0.2 },
    { entity_key: "person:anouk-verbeek", name: "Anouk Verbeek", kind: "person", iso_code: null, aliases: ["anouk-verbeek", "verbeek"], mention_count: 2, article_count: 1, article_ids: [-201], outlet_counts: { NOS: 2 }, salience: 0.15 },
    { entity_key: "place:dijkerhoven", name: "Dijkerhoven", kind: "place", iso_code: null, aliases: ["dijkerhoven"], mention_count: 4, article_count: 1, article_ids: [-201], outlet_counts: { NOS: 4 }, salience: 0.3 },
  ],
  relations: [
    relationTo(EPISODES.demo, 0.82, [REASONS.verbeek, REASONS.nordvind, REASONS.dijkerhoven]),
    relationTo(EPISODES.vervolg, 0.74, [REASONS.nordvind, REASONS.verbeek, REASONS.dijkerhoven]),
    relationTo(EPISODES.verbeek, 0.41, [REASONS.verbeek]),
  ],
  bias: NO_BIAS,
  availability: AVAILABLE,
};

// --- A later episode: one Dutch outlet, as in almost all real news ------------------------------

const V = {
  nos: "https://nos.nl/artikel/2601950-rechter-legt-bouw-windpark-dijkerhoven-stil",
  dw: "https://www.dw.com/en/court-halts-nordvind-wind-farm-in-dutch-village/a-70144410",
  reuters: "https://www.reuters.com/business/energy/nordvind-raises-funds-for-benelux-expansion-2026-06-30/",
  vrt: "https://www.vrt.be/vrtnws/nl/2026/10/02/nederlandse-rechter-stopt-windpark-nordvind/",
};

export const DEMO_VERVOLG: RawExploration = {
  event: {
    id: EPISODES.vervolg.id,
    slug: EPISODES.vervolg.slug,
    event_type: "legal",
    article_count: 4,
    first_seen_at: EPISODES.vervolg.firstSeenAt,
    last_updated_at: EPISODES.vervolg.lastUpdatedAt,
    archived_at: null,
  },
  articles: [
    art(-301, "NOS", V.nos, "Rechter legt bouw windpark Dijkerhoven stil", "2026-10-02T07:10:00Z", 4),
    {
      ...art(-302, "DW", V.dw, "Court halts NordVind wind farm in Dutch village", "2026-10-02T11:45:00Z", null, true, "DE"),
      digest: {
        nl: "Een Nederlandse rechter heeft de bouw van een windpark van NordVind stilgelegd tot er een geluidsonderzoek ligt. Voor het Duitse bedrijf is het de tweede tegenvaller na Vlaanderen.",
        basis: "text",
      },
    },
    {
      // Old coverage that Google News attached to this news: the page shows its date
      ...art(-303, "Reuters", V.reuters, "NordVind raises funds for Benelux expansion", "2026-06-30T09:00:00Z", null, true, "GB"),
      digest: { nl: "NordVind haalt geld op voor uitbreiding naar Nederland en België.", basis: "title" },
    },
    {
      ...art(-304, "VRT NWS", V.vrt, "Nederlandse rechter stopt windpark van NordVind", "2026-10-02T15:20:00Z", null, true, "BE"),
      digest: { nl: "De rechter in Nederland geeft omwonenden gelijk; in Vlaanderen loopt een vergelijkbare zaak tegen NordVind.", basis: "text" },
    },
  ],
  insight: {
    query: "",
    generated_at: "2026-10-02T16:00:00Z",
    llm_provider: "demo",
    model: "demo",
    summary: `${EPISODES.vervolg.title}

De voorzieningenrechter heeft de bouw van het windpark bij Dijkerhoven stilgelegd tot het onderzoek naar laagfrequent geluid klaar is, meldt NOS. Stichting Stille Polder had daarom gevraagd. Ontwikkelaar NordVind spreekt van een kostbare vertraging; wethouder Anouk Verbeek houdt vast aan het park.

Het RIVM zegt tegen NOS dat er geen bewijs is dat laagfrequent geluid van turbines ziek maakt, maar dat hinder wel voorkomt. Volgens een peiling van Ipsos I&O voor NOS is een kleine meerderheid van de omwonenden tegen het park.

De Duitse omroep DW en de Vlaamse VRT brengen de uitspraak als tegenvaller voor NordVind, dat ook in Vlaanderen op verzet stuit.`,
    timeline: [
      { time: "2026-09-27T21:30:00Z", headline: "Gemeenteraad stemt in met het windpark", sources: [V.nos], spectrum: "mainstream" },
      { time: "2026-10-01T14:00:00Z", headline: "Kort geding van Stichting Stille Polder", sources: [V.nos], spectrum: "mainstream" },
      { time: "2026-10-02T06:30:00Z", headline: "Voorzieningenrechter legt de bouw stil", sources: [V.nos], spectrum: "mainstream" },
    ],
    clusters: [
      {
        label: "Rechter geeft omwonenden gelijk",
        spectrum: "mainstream",
        source_types: ["publieke omroep"],
        summary: "De uitspraak wordt gebracht als overwinning voor het dorp en tegenvaller voor de ontwikkelaar.",
        characteristics: ["rechtszaak", "geluidsonderzoek"],
        sources: [{ title: "Rechter legt bouw windpark Dijkerhoven stil", url: V.nos, spectrum: "mainstream", stance: "Eerst het geluidsonderzoek, dan pas bouwen" }],
      },
    ],
    contradictions: [],
    fallacies: [
      { type: "vals_dilemma", description: "De wethouder stelt het als keuze tussen dit park of \"de klimaatdoelen opgeven\", terwijl andere locaties niet ter sprake komen.", sources: [V.nos], spectrum: "mainstream" },
    ],
    frames: [
      { frame_type: "conflict", technique: "Dorp tegen ontwikkelaar", description: "De zaak wordt gebracht als strijd tussen omwonenden en NordVind.", sources: [V.nos], spectrum: "mainstream", attribution: "eigen_framing" },
      { frame_type: "verantwoordelijkheid", technique: "Wie had moeten wachten?", description: "De vraag is wie te snel was: de gemeente of de ontwikkelaar.", sources: [V.nos], spectrum: "mainstream", attribution: "eigen_framing" },
      { frame_type: "economisch", technique: "Kosten van vertraging", description: "NordVind brengt de uitspraak in geld: elke maand kost miljoenen.", sources: [V.nos], spectrum: "mainstream", attribution: "geciteerd" },
    ],
    coverage_gaps: [
      { perspective: "Boeren met turbines op hun land", description: "De grondeigenaren, die vergoedingen mislopen, komen niet aan het woord.", relevance: "Zij hebben het grootste financiële belang in het dorp.", potential_sources: ["LTO-afdeling", "grondeigenaren"] },
      { perspective: "Onafhankelijke juristen", description: "Wat de uitspraak betekent voor andere windparken, legt niemand uit.", relevance: "De zaak kan een voorbeeld worden voor andere gemeenten.", potential_sources: ["omgevingsrechtjuristen"] },
      { perspective: "Andere gemeenten met NordVind", description: "Hoe het NordVind elders verging, wordt niet uitgezocht.", relevance: "Het zegt iets over de beloftes van de ontwikkelaar.", potential_sources: ["gemeenten in Vlaanderen en Duitsland"] },
      { perspective: "Energiecoöperatie", description: "Of inwoners kunnen meedoen in het park, blijft buiten beeld.", relevance: "Lokaal eigendom verandert vaak het draagvlak.", potential_sources: ["energiecoöperaties"] },
    ],
    unsubstantiated_claims: [
      { claim: "De bouw had nooit mogen beginnen zonder geluidsonderzoek.", presented_as: "mening", source_in_article: "Mr. Joost Ravenhorst, advocaat van Stichting Stille Polder", article_url: V.nos, evidence_provided: "verwijzing naar de vergunning", missing_context: ["Wat de vergunning precies voorschrijft"], critical_questions: ["Welke voorwaarde in de vergunning is geschonden?"] },
      { claim: "Elke maand vertraging kost het project twee miljoen euro.", presented_as: "feit", source_in_article: "woordvoerder NordVind, via ANP", article_url: V.nos, evidence_provided: "geen", missing_context: ["Hoe dit bedrag is berekend", "Of verzekeringen dit dekken"], critical_questions: ["Welke kosten tellen mee?", "Staat dit in de jaarstukken?"] },
      { claim: "Een deel van de raad wilde het besluit eigenlijk uitstellen.", presented_as: "feit", source_in_article: "ingewijden op het gemeentehuis (anoniem)", article_url: V.nos, evidence_provided: "geen", missing_context: ["Wie dit zegt en waarom anoniem"], critical_questions: ["Waarom stemde de raad dan toch in?"] },
      { claim: "Er is geen bewijs dat laagfrequent geluid van turbines ziek maakt.", presented_as: "feit", source_in_article: "RIVM (geciteerd door NOS)", article_url: V.nos, evidence_provided: "eerdere RIVM-rapporten", missing_context: ["Dat hinder en slaapverstoring wel zijn aangetoond", "Dat het onderzoek in Dijkerhoven nog loopt"], critical_questions: ["Gaat het over ziekte of over hinder?"] },
      { claim: "Zonder dit park kunnen we de klimaatdoelen wel vergeten.", presented_as: "voorspelling", source_in_article: "Wethouder Anouk Verbeek", article_url: V.nos, evidence_provided: "geen", missing_context: ["Welke andere projecten meetellen"], critical_questions: ["Welke berekening ligt hieronder?"] },
    ],
    authority_analysis: [
      {
        authority: "RIVM",
        authority_type: "overheidsinstelling",
        article_url: V.nos,
        claimed_expertise: "Gezondheidseffecten van geluid",
        actual_role: "Rijksinstituut dat onderzoek doet naar gezondheid en milieu",
        scope_creep: "",
        composition_question: "",
        funding_sources: "Ministerie van VWS",
        track_record: "Eerdere rapporten over windturbinegeluid noemen hinder en slaapverstoring.",
        potential_interests: [],
        independence_check: "Wetenschappelijk onafhankelijk, gefinancierd door de overheid.",
        critical_questions: ["Gaat de uitspraak over hinder of over ziekte?"],
      },
      {
        authority: "NordVind",
        authority_type: "bedrijf",
        article_url: V.nos,
        claimed_expertise: "Bouw en exploitatie van windparken",
        actual_role: "Ontwikkelaar van het park",
        scope_creep: "",
        composition_question: "",
        funding_sources: "Investeringsfondsen en bankleningen",
        track_record: "Ook in Vlaanderen in een rechtszaak verwikkeld.",
        potential_interests: ["Opbrengst van het park", "Subsidies"],
        independence_check: "Belanghebbende partij.",
        critical_questions: ["Wie draagt de kosten van de vertraging?"],
      },
      {
        authority: "Ipsos I&O",
        authority_type: "peilingbureau",
        article_url: V.nos,
        claimed_expertise: "Opiniepeilingen",
        actual_role: "Onderzoeksbureau dat de peiling voor NOS hield",
        scope_creep: "",
        composition_question: "",
        funding_sources: "Opdrachtgever NOS",
        track_record: "",
        potential_interests: [],
        independence_check: "Werkt in opdracht van de omroep die het nieuws brengt.",
        critical_questions: ["Hoe groot was de steekproef?"],
      },
    ],
    media_analysis: [
      {
        source: "NOS",
        article_url: V.nos,
        tone: "kritisch",
        sourcing_pattern: "Advocaat, ontwikkelaar (via ANP), wethouder, RIVM en een eigen peiling; geen boeren en geen onafhankelijke juristen.",
        questions_not_asked: ["Wat betekent de uitspraak voor andere windparken?", "Wie betaalt de vertraging?", "Hoe verging het NordVind in Vlaanderen?"],
        perspectives_omitted: ["grondeigenaren", "juristen buiten de zaak"],
        framing_by_omission: "Zonder de boeren lijkt het alsof alleen het bedrijf financieel belang heeft.",
        copy_paste_score: "laag",
        anonymous_source_count: 1,
        narrative_alignment: "Past in het verhaal van het dorp tegen de ontwikkelaar.",
        what_if_wrong: "Als het geluidsonderzoek geen problemen vindt, was de vertraging voor niets.",
      },
    ],
    statistical_issues: [
      { claim: "Een kleine meerderheid van de omwonenden is tegen het park.", article_url: V.nos, issue: "De peiling ondervroeg 212 mensen; de foutmarge is groter dan het verschil.", better_framing: "Noem de steekproef en zeg dat voor- en tegenstanders ongeveer even groot zijn." },
    ],
    timing_analysis: {
      why_now: "De rechter oordeelde in kort geding, een dag voordat de eerste funderingen zouden worden gestort.",
      cui_bono: "De stichting, die de bouw tegenhoudt tot het onderzoek er ligt; voor NordVind loopt de subsidietermijn af.",
      upcoming_events: "Het geluidsonderzoek wordt in november verwacht; de bodemzaak volgt in het voorjaar.",
    },
    scientific_plurality: null,
    involved_countries: [
      { iso_code: "DE", name: "Germany", relevance: "NordVind is een Duits bedrijf." },
      { iso_code: "BE", name: "Belgium", relevance: "In Vlaanderen loopt een vergelijkbare zaak tegen NordVind." },
    ],
  },
  entities: [
    { entity_key: "org:nordvind", name: "NordVind", kind: "org", iso_code: null, aliases: ["nordvind"], mention_count: 6, article_count: 4, article_ids: [-301, -302, -303, -304], outlet_counts: { NOS: 4 }, salience: 0.2 },
    { entity_key: "person:anouk-verbeek", name: "Anouk Verbeek", kind: "person", iso_code: null, aliases: ["anouk-verbeek", "verbeek"], mention_count: 2, article_count: 1, article_ids: [-301], outlet_counts: { NOS: 2 }, salience: 0.1 },
    { entity_key: "org:stichting-stille-polder", name: "Stichting Stille Polder", kind: "org", iso_code: null, aliases: ["stichting-stille-polder", "stille-polder"], mention_count: 3, article_count: 1, article_ids: [-301], outlet_counts: { NOS: 3 }, salience: 0.12 },
    { entity_key: "person:joost-ravenhorst", name: "Joost Ravenhorst", kind: "person", iso_code: null, aliases: ["joost-ravenhorst", "ravenhorst"], mention_count: 2, article_count: 1, article_ids: [-301], outlet_counts: { NOS: 2 }, salience: 0.08 },
    { entity_key: "org:rivm", name: "RIVM", kind: "org", iso_code: null, aliases: ["rivm"], mention_count: 2, article_count: 1, article_ids: [-301], outlet_counts: { NOS: 2 }, salience: 0.08 },
    { entity_key: "org:ipsos-i-o", name: "Ipsos I&O", kind: "org", iso_code: null, aliases: ["ipsos-i-o"], mention_count: 1, article_count: 1, article_ids: [-301], outlet_counts: { NOS: 1 }, salience: 0.05 },
    { entity_key: "place:dijkerhoven", name: "Dijkerhoven", kind: "place", iso_code: null, aliases: ["dijkerhoven"], mention_count: 5, article_count: 2, article_ids: [-301, -304], outlet_counts: { NOS: 4 }, salience: 0.25 },
  ],
  relations: [
    relationTo(EPISODES.demo, 0.86, [REASONS.nordvind, REASONS.stillePolder, REASONS.verbeek, REASONS.dijkerhoven]),
    relationTo(EPISODES.aanloop, 0.72, [REASONS.nordvind, REASONS.verbeek, REASONS.dijkerhoven]),
    relationTo(EPISODES.verbeek, 0.4, [REASONS.verbeek]),
  ],
  bias: NO_BIAS,
  availability: AVAILABLE,
};

// --- Other news with the same alderman ----------------------------------------------------------

const B = { nu: "https://www.nu.nl/binnenland/6352210/dijkerhoven-verhoogt-ozb-voor-duurzaamheidsfonds.html" };

export const DEMO_VERBEEK: RawExploration = {
  event: {
    id: EPISODES.verbeek.id,
    slug: EPISODES.verbeek.slug,
    event_type: "politics",
    article_count: 1,
    first_seen_at: EPISODES.verbeek.firstSeenAt,
    last_updated_at: EPISODES.verbeek.lastUpdatedAt,
    archived_at: null,
  },
  articles: [art(-401, "NU.nl", B.nu, "Dijkerhoven verhoogt OZB voor duurzaamheidsfonds", "2026-08-14T10:30:00Z", 6)],
  insight: {
    query: "",
    generated_at: "2026-08-14T11:00:00Z",
    llm_provider: "demo",
    model: "demo",
    summary: `${EPISODES.verbeek.title}

Inwoners van Dijkerhoven gaan meer onroerendezaakbelasting betalen voor een nieuw duurzaamheidsfonds, meldt NU.nl. Wethouder Anouk Verbeek noemt het "een investering in de toekomst".`,
    timeline: [],
    clusters: [
      {
        label: "Belasting voor de energietransitie",
        spectrum: "mainstream",
        source_types: ["online"],
        summary: "De lastenverzwaring wordt gebracht als investering.",
        characteristics: ["begroting"],
        sources: [{ title: "Dijkerhoven verhoogt OZB voor duurzaamheidsfonds", url: B.nu, spectrum: "mainstream", stance: "Een investering in de toekomst" }],
      },
    ],
    contradictions: [],
    fallacies: [],
    frames: [{ frame_type: "economisch", technique: "Belasting als investering", description: "De verhoging wordt in termen van rendement gebracht.", sources: [B.nu], spectrum: "mainstream", attribution: "eigen_framing" }],
    coverage_gaps: [{ perspective: "Huiseigenaren met een laag inkomen", description: "Wat de verhoging voor hen betekent, wordt niet gevraagd.", relevance: "Zij voelen de lastenverzwaring het eerst.", potential_sources: ["Nibud"] }],
    unsubstantiated_claims: [
      { claim: "Het fonds verdient zichzelf binnen tien jaar terug.", presented_as: "voorspelling", source_in_article: "Wethouder Anouk Verbeek", article_url: B.nu, evidence_provided: "geen", missing_context: ["De berekening"], critical_questions: ["Welke projecten moet het fonds betalen?"] },
    ],
    authority_analysis: [],
    media_analysis: [
      { source: "NU.nl", article_url: B.nu, tone: "feitelijk", sourcing_pattern: "Alleen de wethouder.", questions_not_asked: ["Hoeveel gaat een gemiddeld huishouden meer betalen?"], perspectives_omitted: ["inwoners"], framing_by_omission: "", copy_paste_score: "hoog", anonymous_source_count: 0, narrative_alignment: "", what_if_wrong: "" },
    ],
    statistical_issues: [],
    timing_analysis: null,
    scientific_plurality: null,
    involved_countries: [],
  },
  entities: [
    { entity_key: "person:anouk-verbeek", name: "Anouk Verbeek", kind: "person", iso_code: null, aliases: ["anouk-verbeek", "verbeek"], mention_count: 3, article_count: 1, article_ids: [-401], outlet_counts: { "NU.nl": 3 }, salience: 0.2 },
    { entity_key: "place:dijkerhoven", name: "Dijkerhoven", kind: "place", iso_code: null, aliases: ["dijkerhoven"], mention_count: 2, article_count: 1, article_ids: [-401], outlet_counts: { "NU.nl": 2 }, salience: 0.2 },
  ],
  relations: [
    relationTo(EPISODES.demo, 0.45, [REASONS.verbeek, REASONS.dijkerhoven]),
    relationTo(EPISODES.aanloop, 0.42, [REASONS.verbeek, REASONS.dijkerhoven]),
    relationTo(EPISODES.vervolg, 0.4, [REASONS.verbeek, REASONS.dijkerhoven]),
  ],
  bias: NO_BIAS,
  availability: AVAILABLE,
};
