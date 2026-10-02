/**
 * Demo data for /event/demo (behind NEXT_PUBLIC_ENABLE_DEMO).
 *
 * FICTIONAL: Dijkerhoven, all people, organisations, quotes and articles are made up to show the
 * Onderzoeksmodus. Outlet names are real (so the propaganda-model link works), their coverage here
 * is not. The UI shows a clear "verzonnen voorbeeld" banner and does not link to article URLs.
 *
 * Shape = RawExploration, so the demo goes through exactly the same pipeline as real data.
 */

import type { ArticleBiasAnalysis, SentenceBias } from "@/lib/types";

import type { RawExploration, RawExploreArticle } from "../input";

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

const U = {
  nos1: "https://nos.nl/artikel/2601101-windpark-dijkerhoven-mag-er-komen-dorp-verdeeld",
  nos2: "https://nos.nl/artikel/2601187-onderzoek-naar-laagfrequent-geluid-nog-niet-klaar",
  nu1: "https://www.nu.nl/binnenland/6361022/adviesraad-windpark-dijkerhoven-veilig-en-noodzakelijk.html",
  nu2: "https://www.nu.nl/binnenland/6361090/omwonenden-dijkerhoven-stappen-naar-de-rechter.html",
  tel1: "https://www.telegraaf.nl/nieuws/1284455/windpark-levert-dijkerhoven-miljoenen-op",
  tel2: "https://www.telegraaf.nl/nieuws/1284502/wethouder-verbeek-kiest-voor-de-toekomst",
  vk1: "https://www.volkskrant.nl/nieuws-achtergrond/in-dijkerhoven-botsen-klimaat-en-natuur~b8a1c2d3/",
  ad1: "https://www.ad.nl/binnenland/dijkerhoven-krijgt-18-turbines-bewoners-woedend~a4f2e1b0/",
  gs1: "https://www.geenstijl.nl/5241987/dijkerhoven-wordt-geofferd-aan-de-windlobby/",
  dak1: "https://deanderekrant.nl/nieuws/windpark-dijkerhoven-wat-u-niet-hoort-over-infrageluid",
  blik1: "https://xcancel.com/eenblikopdenos/status/1840455120001",
  dw1: "https://www.dw.com/en/german-wind-developer-nordvind-expands-in-the-netherlands/a-70123456",
  vrt1: "https://www.vrt.be/vrtnws/nl/2026/09/29/nederlands-windpark-van-nordvind-ook-in-vlaanderen-omstreden/",
};

const sentence = (
  index: number,
  text: string,
  type: string,
  source: SentenceBias["bias_source"],
  score: number,
  explanation: string,
  speaker: string | null = null,
): SentenceBias => ({
  sentence_index: index,
  sentence_text: text,
  bias_type: type,
  bias_source: source,
  speaker,
  score,
  explanation,
});

const bias = (
  articleId: number,
  totalSentences: number,
  rating: number,
  journalist: SentenceBias[],
  quotes: SentenceBias[] = [],
): ArticleBiasAnalysis => ({
  article_id: articleId,
  analyzed_at: "2026-09-29T21:00:00Z",
  provider: "demo",
  model: "demo",
  summary: {
    total_sentences: totalSentences,
    journalist_bias_count: journalist.length,
    quote_bias_count: quotes.length,
    journalist_bias_percentage: Math.round((journalist.length / totalSentences) * 1000) / 10,
    most_frequent_journalist_bias: journalist[0]?.bias_type ?? null,
    most_frequent_count: journalist.length ? 1 : null,
    average_journalist_bias_strength: journalist.length
      ? journalist.reduce((sum, item) => sum + item.score, 0) / journalist.length
      : null,
    overall_journalist_rating: rating,
  },
  journalist_biases: journalist,
  quote_biases: quotes,
});

export const DEMO_EVENT: RawExploration = {
  event: {
    id: -1,
    slug: "demo",
    event_type: "politics",
    article_count: 13,
    first_seen_at: "2026-09-28T06:12:00Z",
    last_updated_at: "2026-09-29T19:40:00Z",
    archived_at: null,
  },
  articles: [
    art(-101, "NU.nl", U.nu1, "Adviesraad: windpark Dijkerhoven veilig en noodzakelijk", "2026-09-28T06:12:00Z", 6),
    art(-102, "NOS", U.nos1, "Windpark Dijkerhoven mag er komen, dorp verdeeld", "2026-09-28T06:51:00Z", 4),
    art(-103, "De Telegraaf", U.tel1, "Windpark levert Dijkerhoven miljoenen op", "2026-09-28T08:05:00Z", 7),
    art(-104, "AD", U.ad1, "Dijkerhoven krijgt 18 turbines, bewoners woedend", "2026-09-28T09:30:00Z", 5.5),
    art(-105, "GeenStijl", U.gs1, "Dijkerhoven wordt geofferd aan de windlobby", "2026-09-28T11:14:00Z", 8),
    art(-106, "Een Blik op de NOS", U.blik1, "Waarom laat de NOS geen omwonenden aan het woord?", "2026-09-28T12:02:00Z", 7),
    art(-107, "de Volkskrant", U.vk1, "In Dijkerhoven botsen klimaat en natuur", "2026-09-28T15:40:00Z", 2),
    art(-108, "De Andere Krant", U.dak1, "Windpark Dijkerhoven: wat u niet hoort over infrageluid", "2026-09-28T18:20:00Z", "alternative"),
    art(-109, "NOS", U.nos2, "Onderzoek naar laagfrequent geluid nog niet klaar", "2026-09-29T07:45:00Z", 4),
    art(-110, "NU.nl", U.nu2, "Omwonenden Dijkerhoven stappen naar de rechter", "2026-09-29T10:10:00Z", 6),
    art(-111, "De Telegraaf", U.tel2, "Wethouder Verbeek kiest voor de toekomst", "2026-09-29T13:30:00Z", 7),
    // Foreign articles: the Dutch gist the backend job "Article Digest" stores in source_metadata.digest
    {
      ...art(-112, "DW", U.dw1, "German wind developer NordVind expands in the Netherlands", "2026-09-29T16:05:00Z", null, true, "DE"),
      digest: {
        nl: "NordVind breidt uit naar Nederland: na parken in Duitsland en Vlaanderen is Dijkerhoven het eerste Nederlandse project. Het bedrijf rekent op meer opdrachten dankzij Nederlandse subsidies.",
        basis: "text",
      },
    },
    {
      ...art(-113, "VRT NWS", U.vrt1, "Nederlands windpark van NordVind ook in Vlaanderen omstreden", "2026-09-29T19:40:00Z", null, true, "BE"),
      digest: {
        nl: "Ook in Vlaanderen stuit NordVind op verzet. Omwonenden van een gepland windpark vechten de vergunning aan, net als in Dijkerhoven.",
        basis: "text",
      },
    },
  ],
  insight: {
    query: "",
    generated_at: "2026-09-29T20:30:00Z",
    llm_provider: "demo",
    model: "demo",
    summary: `Windpark Dijkerhoven splijt dorp en Den Haag

De gemeenteraad van Dijkerhoven heeft ingestemd met een windpark van de Duitse ontwikkelaar NordVind, meldt NOS. Wethouder Anouk Verbeek spreekt van een kans voor het dorp. Volgens NU.nl noemt de Nationale Adviesraad Windenergie het park "veilig en noodzakelijk", terwijl omwonenden verenigd in Stichting Stille Polder naar de rechter stappen.

**Economie tegenover natuur**

De Telegraaf benadrukt de opbrengst: het dorp zou jaarlijks miljoenen ontvangen uit een omgevingsfonds. De Volkskrant legt juist de nadruk op het broedgebied van de grutto, dat deels verdwijnt. Over het aantal turbines lopen de berichten uiteen: het AD spreekt van 18 turbines, NOS van 12.

Verbeek zegt tegenover De Telegraaf dat Dijkerhoven "niet kan achterblijven bij de energietransitie". Bewoners zeggen tegen het AD dat zij pas laat bij de plannen zijn betrokken. Omwonende Henk de Boer (61) hoorde naar eigen zeggen pas uit de krant dat er een turbine op zeshonderd meter van zijn huis komt.

**Gezondheid en wantrouwen**

Het onderzoek naar laagfrequent geluid van de turbines is nog niet afgerond, schrijft NOS. De Andere Krant waarschuwt voor infrageluid, maar noemt geen onderzoek. GeenStijl spreekt van een dorp dat wordt "geofferd aan de windlobby". Het account Een Blik op de NOS verwijt de NOS dat omwonenden in de eerste berichtgeving ontbraken.

Terwijl Nederlandse media zich richten op de lokale strijd, plaatst de Duitse omroep DW het park in de internationale expansie van NordVind. De Vlaamse VRT meldt dat hetzelfde bedrijf ook in Vlaanderen op verzet stuit.`,
    timeline: [
      { time: "2019", headline: "Provincie wijst de polder bij Dijkerhoven aan als zoekgebied voor wind", sources: [U.vk1], spectrum: "mainstream" },
      { time: "2025-03-14", headline: "NordVind presenteert eerste plan met 18 turbines", sources: [U.ad1], spectrum: "mainstream" },
      { time: "2026-09-27T21:30:00Z", headline: "Gemeenteraad stemt in met het windpark", sources: [U.nos1, U.nu1], spectrum: "mainstream" },
      { time: "2026-09-28T09:00:00Z", headline: "Stichting Stille Polder kondigt rechtszaak aan", sources: [U.ad1], spectrum: "mainstream" },
      { time: "2026-09-29T07:30:00Z", headline: "Onderzoek naar laagfrequent geluid blijkt nog niet afgerond", sources: [U.nos2], spectrum: "mainstream" },
      { time: "2026-09-29T10:00:00Z", headline: "Omwonenden dienen bezwaar in bij de rechtbank", sources: [U.nu2], spectrum: "mainstream" },
    ],
    clusters: [
      {
        label: "Economische kans voor het dorp",
        spectrum: "mainstream",
        source_types: ["dagblad", "online"],
        summary: "Het windpark wordt gebracht als financiële meevaller en noodzakelijke stap in de energietransitie.",
        characteristics: ["opbrengst", "vooruitgang", "gezag adviesraad"],
        sources: [
          { title: "Windpark levert Dijkerhoven miljoenen op", url: U.tel1, spectrum: "rechts", stance: "Het omgevingsfonds maakt van Dijkerhoven een winnaar" },
          { title: "Wethouder Verbeek kiest voor de toekomst", url: U.tel2, spectrum: "rechts", stance: "Wie nu nee zegt, blijft achter" },
          { title: "Adviesraad: windpark Dijkerhoven veilig en noodzakelijk", url: U.nu1, spectrum: "mainstream", stance: "De adviesraad heeft gesproken: veilig en nodig" },
        ],
      },
      {
        label: "Natuur en gezondheid eerst",
        spectrum: "links",
        source_types: ["kwaliteitskrant", "publieke omroep"],
        summary: "De nadruk ligt op het verdwijnende broedgebied en de onzekerheid over geluid.",
        characteristics: ["grutto", "onafgerond onderzoek", "voorzorg"],
        sources: [
          { title: "In Dijkerhoven botsen klimaat en natuur", url: U.vk1, spectrum: "links", stance: "Klimaatwinst gaat hier ten koste van de grutto" },
          { title: "Onderzoek naar laagfrequent geluid nog niet klaar", url: U.nos2, spectrum: "mainstream", stance: "Er is besloten voordat het geluidsonderzoek klaar was" },
          { title: "Dijkerhoven krijgt 18 turbines, bewoners woedend", url: U.ad1, spectrum: "mainstream", stance: "Bewoners als Henk de Boer voelen zich overvallen" },
        ],
      },
      {
        label: "Wantrouwen tegen Den Haag en de lobby",
        spectrum: "alternatief",
        source_types: ["blog", "alternatief medium", "sociale media"],
        summary: "Het besluit wordt gezien als opgelegd door lobby en bestuurders, ten koste van gewone inwoners.",
        characteristics: ["lobby", "achterkamer", "gezondheidsangst"],
        sources: [
          { title: "Dijkerhoven wordt geofferd aan de windlobby", url: U.gs1, spectrum: "rechts", stance: "Een dorp wordt opgeofferd voor subsidiegeld" },
          { title: "Windpark Dijkerhoven: wat u niet hoort over infrageluid", url: U.dak1, spectrum: "alternatief", stance: "Over de gezondheidsrisico's wordt gezwegen" },
          { title: "Waarom laat de NOS geen omwonenden aan het woord?", url: U.blik1, spectrum: "sociale_media", stance: "De NOS liet alleen bestuurders aan het woord" },
        ],
      },
    ],
    contradictions: [
      {
        topic: "Hoeveel turbines komen er?",
        claim_a: { summary: "Er komen 18 turbines, zoals in het eerste plan van NordVind.", sources: [U.ad1], spectrum: "mainstream" },
        claim_b: { summary: "Het aangepaste plan telt 12 turbines.", sources: [U.nos1, U.nu1], spectrum: "mainstream" },
        verification: "onbevestigd",
      },
      {
        topic: "Is het geluidsonderzoek afgerond?",
        claim_a: { summary: "De adviesraad noemt het park veilig op basis van het geluidsonderzoek.", sources: [U.nu1], spectrum: "mainstream" },
        claim_b: { summary: "Het onderzoek naar laagfrequent geluid is nog niet klaar.", sources: [U.nos2], spectrum: "mainstream" },
        verification: "tegengesproken",
      },
    ],
    fallacies: [
      {
        type: "vals_dilemma",
        description: "De wethouder stelt dat het dorp kiest tussen dit windpark of \"achterblijven\", terwijl alternatieven zoals een kleinere opstelling of een andere locatie niet worden besproken.",
        sources: [U.tel2],
        spectrum: "rechts",
      },
      {
        type: "stroman",
        description: "Tegenstanders worden neergezet als mensen die \"geen stroom willen\", terwijl hun bezwaar gaat over locatie, inspraak en het onafgeronde onderzoek.",
        sources: [U.gs1],
        spectrum: "rechts",
      },
    ],
    frames: [
      { frame_type: "economisch", technique: "Omgevingsfonds als hoofdnieuws", description: "Het besluit wordt vooral in geld uitgedrukt: miljoenen voor het dorp. Daardoor lijkt verzet onverstandig.", sources: [U.tel1], spectrum: "rechts", attribution: "eigen_framing" },
      { frame_type: "authority_deference", technique: "\"De adviesraad heeft gesproken\"", description: "Het oordeel van de adviesraad wordt als eindpunt van de discussie gebracht, zonder de onderbouwing te bespreken.", sources: [U.nu1], spectrum: "mainstream", attribution: "eigen_framing" },
      { frame_type: "conflict", technique: "Dorp tegenover gemeentehuis", description: "Het verhaal draait om het verdeelde dorp: voor- en tegenstanders tegenover elkaar.", sources: [U.nos1, U.ad1], spectrum: "mainstream", attribution: "eigen_framing" },
      { frame_type: "fear", technique: "\"Wat u niet hoort\"", description: "Suggereert verzwegen gezondheidsrisico's zonder onderzoek te noemen; speelt in op angst.", sources: [U.dak1], spectrum: "alternatief", attribution: "eigen_framing" },
      { frame_type: "moraliteit", technique: "Grutto als symbool", description: "Bewoners en natuurorganisaties brengen het als morele kwestie: mag je natuur opofferen voor klimaatwinst?", sources: [U.vk1], spectrum: "links", attribution: "geciteerd" },
    ],
    coverage_gaps: [
      { perspective: "Boeren op de polder", description: "De grondeigenaren die turbines op hun land krijgen, komen nergens aan het woord.", relevance: "Zij verdienen het meest en bepalen mede de locatie.", potential_sources: ["LTO-afdeling", "grondeigenaren"] },
      { perspective: "Onafhankelijke geluidsdeskundigen", description: "Alleen de adviesraad en een alternatief medium spreken over geluid; onafhankelijke experts ontbreken.", relevance: "De gezondheidsvraag is juist het kernpunt van de rechtszaak.", potential_sources: ["akoestici", "GGD"] },
      { perspective: "Energiecoöperatie", description: "Of inwoners kunnen meedoen in het park, via een coöperatie, wordt niet uitgezocht.", relevance: "Lokaal eigendom verandert vaak het draagvlak.", potential_sources: ["energiecoöperaties", "gemeente"] },
    ],
    unsubstantiated_claims: [
      { claim: "Het windpark levert Dijkerhoven jaarlijks miljoenen op.", presented_as: "feit", source_in_article: "De Telegraaf (redactie)", article_url: U.tel1, evidence_provided: "geen", missing_context: ["Hoe groot het omgevingsfonds precies is", "Wie het fonds beheert"], critical_questions: ["Welk bedrag staat in de overeenkomst?", "Voor hoeveel jaar?"] },
      { claim: "Infrageluid van turbines maakt omwonenden ziek.", presented_as: "feit", source_in_article: "De Andere Krant (redactie)", article_url: U.dak1, evidence_provided: "geen", missing_context: ["Welk onderzoek dit laat zien", "Afstand tot woningen"], critical_questions: ["Op welke studies is dit gebaseerd?", "Wat zeggen onafhankelijke akoestici?"] },
      { claim: "Zonder dit park haalt de regio de klimaatdoelen niet.", presented_as: "voorspelling", source_in_article: "Wethouder Anouk Verbeek", article_url: U.tel2, evidence_provided: "geen", missing_context: ["Welke andere projecten meetellen"], critical_questions: ["Welke berekening ligt hieronder?"] },
    ],
    authority_analysis: [
      {
        authority: "Nationale Adviesraad Windenergie",
        authority_type: "adviesorgaan",
        article_url: U.nu1,
        claimed_expertise: "Veiligheid en noodzaak van windparken",
        actual_role: "Adviesraad die ministeries adviseert over de uitrol van windenergie",
        scope_creep: "Adviseert ook over gezondheidseffecten, terwijl het mandaat vooral energiebeleid betreft.",
        composition_question: "Wie benoemt de leden? Zitten er ook gezondheidsdeskundigen in?",
        funding_sources: "Gefinancierd door het ministerie dat ook de windambities formuleert.",
        track_record: "Eerdere adviezen over afstandsnormen werden later aangescherpt.",
        potential_interests: ["Beleidsdoelen van de opdrachtgever"],
        independence_check: "Onafhankelijk van de ontwikkelaar, maar niet van het beleid dat het toetst.",
        critical_questions: ["Is de adviesraad de juiste instantie voor gezondheidsvragen?", "Waarom oordelen vóór het geluidsonderzoek klaar is?"],
      },
      {
        authority: "NordVind",
        authority_type: "bedrijf",
        article_url: U.tel1,
        claimed_expertise: "Bouw en exploitatie van windparken",
        actual_role: "Ontwikkelaar en toekomstige exploitant van het park",
        scope_creep: "",
        composition_question: "",
        funding_sources: "Duitse investeringsfondsen en bankleningen",
        track_record: "Parken in Duitsland en Vlaanderen, deels met bezwaarprocedures.",
        potential_interests: ["Opbrengst van het park", "Subsidies"],
        independence_check: "Belanghebbende partij.",
        critical_questions: ["Wie verdient er aan het park?", "Welke toezeggingen zijn juridisch vastgelegd?"],
      },
      {
        authority: "Stichting Stille Polder",
        authority_type: "bewonersgroep",
        article_url: U.ad1,
        claimed_expertise: "Belangen van omwonenden",
        actual_role: "Stichting van omwonenden die de rechtszaak voert",
        scope_creep: "",
        composition_question: "Hoeveel inwoners vertegenwoordigt de stichting?",
        funding_sources: "Donaties van leden",
        track_record: "",
        potential_interests: ["Woongenot", "Waarde van woningen"],
        independence_check: "Belanghebbende partij.",
        critical_questions: ["Hoe representatief is de stichting voor het dorp?"],
      },
    ],
    media_analysis: [
      { source: "De Telegraaf", article_url: U.tel1, tone: "geruststellend", sourcing_pattern: "Wethouder en ontwikkelaar aan het woord; geen omwonenden.", questions_not_asked: ["Wie beheert het omgevingsfonds?", "Wat vinden omwonenden?"], perspectives_omitted: ["omwonenden", "natuurorganisaties"], framing_by_omission: "Door alleen de opbrengst te noemen lijkt het besluit vanzelfsprekend.", copy_paste_score: "middel", anonymous_source_count: 0, narrative_alignment: "Past in het verhaal van economische kansen door de energietransitie.", what_if_wrong: "Als het fonds kleiner uitvalt, is de belangrijkste reden voor steun weg." },
      { source: "NU.nl", article_url: U.nu1, tone: "feitelijk", sourcing_pattern: "Vooral de adviesraad en het gemeentelijke persbericht.", questions_not_asked: ["Is het geluidsonderzoek afgerond?", "Is de adviesraad bevoegd voor gezondheidsvragen?"], perspectives_omitted: ["onafhankelijke deskundigen"], framing_by_omission: "", copy_paste_score: "hoog", anonymous_source_count: 0, narrative_alignment: "", what_if_wrong: "" },
      { source: "NOS", article_url: U.nos1, tone: "feitelijk", sourcing_pattern: "Gemeente, adviesraad en één voorstander; omwonenden pas in het tweede artikel.", questions_not_asked: ["Waarom werd besloten vóór het geluidsonderzoek klaar was?"], perspectives_omitted: ["boeren op de polder"], framing_by_omission: "", copy_paste_score: "laag", anonymous_source_count: 1, narrative_alignment: "", what_if_wrong: "" },
      { source: "GeenStijl", article_url: U.gs1, tone: "sensationeel", sourcing_pattern: "Eigen commentaar en anonieme dorpsbewoners.", questions_not_asked: ["Wat is de onderbouwing van de lobby-claim?"], perspectives_omitted: ["voorstanders in het dorp"], framing_by_omission: "Voorstanders ontbreken volledig.", copy_paste_score: "laag", anonymous_source_count: 3, narrative_alignment: "Past in het verhaal van de elite tegen het volk.", what_if_wrong: "Als het besluit zorgvuldig is genomen, ondermijnt dit het vertrouwen zonder grond." },
      { source: "de Volkskrant", article_url: U.vk1, tone: "kritisch", sourcing_pattern: "Ecologen, natuurorganisatie en de wethouder.", questions_not_asked: ["Wat kost een andere locatie?"], perspectives_omitted: [], framing_by_omission: "", copy_paste_score: "laag", anonymous_source_count: 0, narrative_alignment: "", what_if_wrong: "" },
    ],
    statistical_issues: [
      { claim: "Het park voorziet 40.000 huishoudens van stroom.", article_url: U.nu1, issue: "Gebaseerd op het maximale vermogen; de gemiddelde opwek ligt veel lager.", better_framing: "Noem de verwachte jaarproductie in kWh en het gemiddelde verbruik per huishouden." },
      { claim: "60 procent van het dorp is tegen.", article_url: U.gs1, issue: "Komt uit een online peiling van de stichting, niet uit representatief onderzoek.", better_framing: "Vermeld wie de peiling hield en hoeveel mensen meededen." },
    ],
    timing_analysis: {
      why_now: "Het besluit viel een week voordat de provincie de subsidieronde voor windparken sluit.",
      cui_bono: "De ontwikkelaar, die alleen met een raadsbesluit subsidie kan aanvragen.",
      upcoming_events: "Provinciale subsidiedeadline en de eerste zitting in de rechtszaak.",
    },
    scientific_plurality: {
      topic: "Gezondheidseffecten van laagfrequent geluid van windturbines",
      presented_view: "Het park is veilig (adviesraad) of juist gevaarlijk (De Andere Krant).",
      alternative_views_mentioned: false,
      known_debates: ["Hinder versus aantoonbare gezondheidsschade", "Afstandsnormen per land"],
      notable_dissenters: "",
      assessment: "Beide kanten worden als vaststaand gebracht, terwijl het onderzoek nog loopt en de wetenschap genuanceerder is.",
    },
    involved_countries: [
      { iso_code: "DE", name: "Germany", relevance: "De ontwikkelaar NordVind is een Duits bedrijf." },
      { iso_code: "BE", name: "Belgium", relevance: "NordVind stuit met een vergelijkbaar park in Vlaanderen op verzet." },
    ],
  },
  entities: [
    { entity_key: "place:dijkerhoven", name: "Dijkerhoven", kind: "place", iso_code: null, aliases: ["dijkerhoven"], mention_count: 31, article_count: 11, article_ids: [-101, -102, -103, -104, -105, -106, -107, -108, -109, -110, -111], outlet_counts: { NOS: 6, "NU.nl": 5, "De Telegraaf": 6, AD: 4, GeenStijl: 3, "de Volkskrant": 4, "De Andere Krant": 3 }, salience: 0.34 },
    { entity_key: "org:nordvind", name: "NordVind", kind: "org", iso_code: null, aliases: ["nordvind"], mention_count: 14, article_count: 8, article_ids: [-101, -102, -103, -105, -107, -111, -112, -113], outlet_counts: { NOS: 2, "NU.nl": 2, "De Telegraaf": 4, AD: 2, GeenStijl: 2, "de Volkskrant": 2 }, salience: 0.16 },
    { entity_key: "person:anouk-verbeek", name: "Anouk Verbeek", kind: "person", iso_code: null, aliases: ["anouk-verbeek", "verbeek"], mention_count: 12, article_count: 6, article_ids: [-102, -103, -104, -107, -110, -111], outlet_counts: { NOS: 2, "De Telegraaf": 5, AD: 2, "de Volkskrant": 2, "NU.nl": 1 }, salience: 0.13 },
    { entity_key: "org:nationale-adviesraad-windenergie", name: "Nationale Adviesraad Windenergie", kind: "org", iso_code: null, aliases: ["nationale-adviesraad-windenergie", "naw"], mention_count: 9, article_count: 5, article_ids: [-101, -102, -107, -109, -110], outlet_counts: { "NU.nl": 4, NOS: 3, "de Volkskrant": 1, "De Telegraaf": 1 }, salience: 0.1 },
    { entity_key: "org:stichting-stille-polder", name: "Stichting Stille Polder", kind: "org", iso_code: null, aliases: ["stichting-stille-polder", "stille-polder"], mention_count: 8, article_count: 5, article_ids: [-101, -102, -104, -105, -110], outlet_counts: { AD: 3, "NU.nl": 2, NOS: 2, GeenStijl: 1 }, salience: 0.09 },
    // Epic 12: a private resident (never researched: "Privépersoon — wordt niet uitgezocht")
    { entity_key: "person:henk-de-boer", name: "Henk de Boer", kind: "person", iso_code: null, aliases: ["henk-de-boer", "boer"], mention_count: 3, article_count: 2, article_ids: [-104, -110], outlet_counts: { AD: 2, "NU.nl": 1 }, salience: 0.04 },
    { entity_key: "country:de", name: "Duitsland", kind: "country", iso_code: "DE", aliases: ["de", "duitsland"], mention_count: 5, article_count: 4, article_ids: [-103, -105, -107, -112], outlet_counts: { "De Telegraaf": 2, "de Volkskrant": 1, NOS: 1, GeenStijl: 1 }, salience: 0.05 },
  ],
  // One demo: no related demo event to follow ("Volg het spoor" shows its empty state)
  relations: [],
  bias: [
    bias(-103, 18, 0.62, [
      sentence(0, "Dijkerhoven kan zich rijk rekenen: het windpark brengt het dorp jaarlijks miljoenen op.", "Opinionated Bias", "journalist", 0.78, "Een verwachting wordt als vaststaand feit gebracht."),
      sentence(4, "Alleen een kleine groep bezwaarmakers ligt nog dwars.", "Word Choice Bias", "journalist", 0.71, "\"Kleine groep\" en \"dwars liggen\" kleineren de tegenstanders zonder onderbouwing."),
      sentence(9, "Wie nu nog tegen is, kiest ervoor om achter te blijven.", "False Dichotomy Bias", "journalist", 0.66, "Stelt het als keuze tussen dit park of achterblijven."),
    ]),
    bias(-105, 14, 0.81, [
      sentence(0, "Dijkerhoven wordt geofferd aan de windlobby.", "Emotional Sensationalism Bias", "journalist", 0.86, "Sterk emotionele taal zonder onderbouwing van een lobby."),
      sentence(3, "De bestuurders in hun kantoortjes hebben nog nooit een turbine gehoord.", "Ad Hominem Bias", "journalist", 0.79, "Richt zich op de personen in plaats van op hun argumenten."),
      sentence(6, "Tegenstanders willen helemaal geen stroom meer, zo lijkt het in Den Haag.", "Straw Man Bias", "journalist", 0.72, "Verdraait het bezwaar van tegenstanders."),
      sentence(8, "Wij, de gewone mensen, betalen de rekening.", "Intergroup Bias", "journalist", 0.7, "Zet een \"wij tegen zij\" tegenstelling neer."),
    ]),
    bias(
      -101,
      15,
      0.33,
      [sentence(2, "De adviesraad heeft gesproken: het park is veilig.", "External Validation Bias", "journalist", 0.61, "Het oordeel van de adviesraad wordt zonder onderbouwing als eindpunt gebracht.")],
      [sentence(7, "\"Dit park is onmisbaar voor onze toekomst,\" zegt de voorzitter.", "Opinionated Bias", "quote", 0.55, "Mening van de geciteerde voorzitter; telt niet mee.", "Voorzitter NAW")],
    ),
    bias(-102, 16, 0.18, [
      sentence(5, "Critici spreken van een overhaast besluit.", "Ambiguous Attribution Bias", "journalist", 0.52, "Onduidelijk wie de critici zijn."),
    ]),
  ],
  availability: { entities: true, relations: true, bias: true },
};

/** There is exactly one demo: /event/demo. */
export const DEMO_EVENTS: Record<string, RawExploration> = {
  demo: DEMO_EVENT,
};

export function isDemoIdentifier(identifier: string | number): boolean {
  return typeof identifier === "string" ? identifier === "demo" : identifier === DEMO_EVENT.event.id;
}
