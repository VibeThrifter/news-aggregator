/**
 * Dutch labels and descriptions used throughout the exploration UI.
 */

import type { PmRelation } from "@/lib/types";

import type { OwnKind, TabId } from "./types";

export interface TabDefinition {
  id: TabId;
  /** The question the tab answers (also its label) */
  label: string;
  /** Accent colour (also used in SVG) */
  color: string;
}

/** The tabs under "Wie zegt wat?", in display order (Epic 14). */
export const TABS: TabDefinition[] = [
  { id: "invalshoeken", label: "Invalshoeken", color: "#1F75CE" },
  { id: "klopt", label: "Klopt het?", color: "#E30613" },
  { id: "stemmen", label: "Wie praat?", color: "#b7791f" },
  { id: "ontbreekt", label: "Wat ontbreekt?", color: "#0f766e" },
  { id: "gebracht", label: "Hoe gebracht?", color: "#7c3aed" },
  { id: "tijdlijn", label: "Tijdlijn", color: "#475569" },
];

export const TAB_BY_ID: Record<TabId, TabDefinition> = Object.fromEntries(TABS.map((tab) => [tab.id, tab])) as Record<
  TabId,
  TabDefinition
>;

export function isTabId(value: unknown): value is TabId {
  return typeof value === "string" && value in TAB_BY_ID;
}

/** What you can add yourself, per kind (rows, popovers, the board). */
export const OWN_KIND_LABELS: Record<OwnKind, string> = {
  claim: "Twijfel",
  fallacy: "Drogreden",
  contradiction: "Tegenspraak",
  error: "Fout",
  speaker: "Spreker",
  source: "Bron",
  gap: "Ontbrekende stem",
  question: "Vraag",
  note: "Opmerking",
  moment: "Moment",
};

export const FRAME_LABELS: Record<string, string> = {
  conflict: "Conflict",
  human_interest: "Menselijk verhaal",
  economisch: "Economisch",
  moraliteit: "Moraal",
  verantwoordelijkheid: "Verantwoordelijkheid",
  veiligheid: "Veiligheid",
  metafoor: "Metafoor",
  eufemisme: "Eufemisme",
  hyperbool: "Overdrijving",
  strategisch: "Strategisch spel",
  consensus: "Consensus",
  inevitability: "Onvermijdelijkheid",
  authority_deference: "Gezag volgen",
  fear: "Angst",
  progress: "Vooruitgang",
  nostalgia: "Nostalgie",
};

export const FRAME_DESCRIPTIONS: Record<string, string> = {
  conflict: "Het verhaal draait om tegenstellingen tussen partijen.",
  human_interest: "Het nieuws wordt verteld via persoonlijke verhalen en emoties.",
  economisch: "De nadruk ligt op kosten, baten en economische gevolgen.",
  moraliteit: "Het nieuws wordt gebracht als kwestie van goed en kwaad.",
  verantwoordelijkheid: "De vraag wie schuldig of verantwoordelijk is staat centraal.",
  veiligheid: "Het nieuws wordt gebracht als dreiging of veiligheidskwestie.",
  metafoor: "Beeldspraak stuurt hoe je het nieuws begrijpt.",
  eufemisme: "Verzachtende woorden maken iets onschuldiger dan het is.",
  hyperbool: "Overdreven taal maakt iets groter dan het is.",
  strategisch: "Het nieuws wordt gebracht als politiek spel van winnen en verliezen.",
  consensus: "Er wordt eensgezindheid gesuggereerd waar debat mogelijk is.",
  inevitability: "Een ontwikkeling wordt gepresenteerd als onvermijdelijk.",
  authority_deference: "Het oordeel van gezagsdragers wordt zonder vragen overgenomen.",
  fear: "Het verhaal speelt in op angst.",
  progress: "Verandering wordt vanzelfsprekend als vooruitgang gebracht.",
  nostalgia: "Het verleden wordt als betere tijd neergezet.",
};

export function frameLabel(type: string | null | undefined): string {
  if (!type) return "Frame";
  return FRAME_LABELS[type] ?? capitalize(type.replace(/_/g, " "));
}

export const TONE_LABELS: Record<string, string> = {
  feitelijk: "Feitelijk",
  kritisch: "Kritisch",
  sensationeel: "Sensationeel",
  alarmerend: "Alarmerend",
  geruststellend: "Geruststellend",
  activistisch: "Activistisch",
};

export function toneLabel(tone: string | null | undefined): string {
  if (!tone) return "Onbekend";
  const key = tone.trim().toLowerCase();
  return TONE_LABELS[key] ?? capitalize(tone.trim());
}

export const FALLACY_LABELS: Record<string, string> = {
  stroman: "Stroman",
  ad_hominem: "Op de man spelen",
  vals_dilemma: "Vals dilemma",
  cirkelredenering: "Cirkelredenering",
  slippery_slope: "Hellend vlak",
  autoriteit_zonder_bewijs: "Autoriteit zonder bewijs",
  aanname_als_feit: "Aanname als feit",
  consensus_fabricatie: "Gefabriceerde consensus",
  selectieve_presentatie: "Selectieve presentatie",
  post_hoc: "Daarna, dus daardoor",
  andere: "Andere redeneerfout",
};

export function fallacyLabel(type: string | null | undefined): string {
  if (!type) return "Redeneerfout";
  const key = type.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return FALLACY_LABELS[key] ?? capitalize(type.replace(/_/g, " "));
}

export const VERIFICATION_LABELS: Record<string, { label: string; tone: "neutral" | "good" | "bad" }> = {
  onbevestigd: { label: "Onbevestigd", tone: "neutral" },
  bevestigd: { label: "Bevestigd", tone: "good" },
  tegengesproken: { label: "Tegengesproken", tone: "bad" },
};

export const PRESENTED_AS_LABELS: Record<string, string> = {
  feit: "gebracht als feit",
  advies: "gebracht als advies",
  mening: "gebracht als mening",
  voorspelling: "gebracht als voorspelling",
};

/** The 26 bias types of Epic 10 with Dutch labels. */
export const BIAS_TYPE_LABELS: Record<string, string> = {
  "Ad Hominem Bias": "Op de man spelen",
  "Ambiguous Attribution Bias": "Vage bronvermelding",
  "Anecdotal Evidence Bias": "Anekdote als bewijs",
  "Causal Misunderstanding Bias": "Verband als oorzaak",
  "Cherry Picking Bias": "Krenten uit de pap",
  "Circular Reasoning Bias": "Cirkelredenering",
  "Discriminatory Bias": "Vooroordeel over groepen",
  "Emotional Sensationalism Bias": "Emotioneel sensationeel",
  "External Validation Bias": "Leunen op gezag",
  "False Balance Bias": "Valse balans",
  "False Dichotomy Bias": "Vals dilemma",
  "Faulty Analogy Bias": "Gebrekkige vergelijking",
  "Generalization Bias": "Overgeneralisatie",
  "Insinuative Questioning Bias": "Suggestieve vraag",
  "Intergroup Bias": "Wij tegen zij",
  "Mud Praise Bias": "Verpakte kritiek",
  "Opinionated Bias": "Mening als feit",
  "Political Bias": "Politieke kleur",
  "Projection Bias": "Projectie",
  "Shifting Benchmark Bias": "Verschuivende maatstaf",
  "Source Selection Bias": "Eenzijdige bronnen",
  "Speculation Bias": "Speculatie als feit",
  "Straw Man Bias": "Stroman",
  "Unsubstantiated Claims Bias": "Claim zonder onderbouwing",
  "Whataboutism Bias": "Whataboutism",
  "Word Choice Bias": "Geladen woordkeus",
};

export function biasTypeLabel(type: string | null | undefined): string {
  if (!type) return "Bias";
  return BIAS_TYPE_LABELS[type] ?? BIAS_TYPE_LABELS[`${type} Bias`] ?? type.replace(/ Bias$/, "");
}

export const BIAS_SOURCE_LABELS: Record<string, string> = {
  journalist: "Eigen tekst",
  framing: "Framing rond quote",
  quote_selection: "Quote-selectie",
  quote: "In een quote",
};

/**
 * Herman & Chomsky filters as used by the propaganda-model project, plus tegenmacht, and (Epic 15)
 * the five decision-making categories of the same network (after Domhoff). A relation can belong to
 * several: the categories overlap.
 */
export type FilterId =
  | "eigendom"
  | "advertentie"
  | "sourcing"
  | "flak"
  | "ideologie"
  | "tegenmacht"
  | "formele_macht"
  | "belangen"
  | "kennis_advies"
  | "polder"
  | "werving";

export interface FilterDefinition {
  id: FilterId;
  label: string;
  question: string;
  /** Short question to explore one node along this filter (Epic 13: "Wie betaalt?") */
  ask: string;
  /** Colour from propaganda-model web/huisstijl.css (decision-making: web/shared_vocab.js) */
  color: string;
  /** Media (the five filters + tegenmacht) or besluitvorming (Epic 15) */
  group: "media" | "besluitvorming";
}

export const FILTERS: FilterDefinition[] = [
  { id: "eigendom", label: "Eigendom", question: "Wie is de eigenaar?", ask: "Wie bezit wat?", color: "#e74c3c", group: "media" },
  { id: "advertentie", label: "Advertenties", question: "Wie betaalt de rekening?", ask: "Wie betaalt?", color: "#f0a030", group: "media" },
  { id: "sourcing", label: "Bronnen", question: "Wie mag het verhaal vertellen?", ask: "Wie praat mee?", color: "#3498db", group: "media" },
  { id: "flak", label: "Flak", question: "Wie oefent druk uit op de berichtgeving?", ask: "Wie valt aan?", color: "#9b59b6", group: "media" },
  { id: "ideologie", label: "Ideologie", question: "Welk wereldbeeld is vanzelfsprekend?", ask: "Welke kringen?", color: "#2ecc71", group: "media" },
  { id: "tegenmacht", label: "Tegenmacht", question: "Wie houdt de macht in toom?", ask: "Wie spreekt tegen?", color: "#1abc9c", group: "media" },
  { id: "formele_macht", label: "Formele macht", question: "Wie mag hierover besluiten?", ask: "Wie beslist?", color: "#5468ff", group: "besluitvorming" },
  { id: "belangen", label: "Belangen", question: "Wie heeft er belang bij, en hoe komt het binnen?", ask: "Wie heeft belang?", color: "#c4d630", group: "besluitvorming" },
  { id: "kennis_advies", label: "Kennis & advies", question: "Wie levert de kennis en het advies?", ask: "Wie adviseert?", color: "#e15ef2", group: "besluitvorming" },
  { id: "polder", label: "Polder", question: "Wie zit er aan tafel?", ask: "Wie zit aan tafel?", color: "#c08552", group: "besluitvorming" },
  { id: "werving", label: "Werving", question: "Wie komt waar terecht, en via wie?", ask: "Wie benoemt wie?", color: "#22d3ee", group: "besluitvorming" },
];

/** Short question per filter key, "overig" included (relations without a filter). */
export function filterAsk(key: string): string {
  return FILTERS.find((filter) => filter.id === key)?.ask ?? "Overige banden";
}

export const FILTER_BY_ID: Record<FilterId, FilterDefinition> = Object.fromEntries(
  FILTERS.map((filter) => [filter.id, filter]),
) as Record<FilterId, FilterDefinition>;

export function filterColor(filter: string | null | undefined): string {
  if (!filter) return "#94a3b8";
  return FILTER_BY_ID[filter as FilterId]?.color ?? "#94a3b8";
}

/** Relation types of the propaganda model, read as "source … target". */
export const PM_RELATION_LABELS: Record<string, string> = {
  eigendom: "is eigenaar van",
  financiering: "financiert",
  adverteerder: "adverteert bij",
  flak: "oefent druk uit op",
  bron_van: "is bron voor",
  beinvloeding: "beïnvloedt",
  draaideur: "stapte over naar",
  bestuurder: "bestuurt",
  adviseur: "adviseert",
  censuur: "censureert",
  mediaplatform: "is platform voor",
  personeel: "werkt voor",
  lidmaatschap: "is lid van",
  oppositie: "staat tegenover",
  alliantie: "werkt samen met",
  etikettering: "etiketteert",
  dienstverband: "is in dienst van",
  regulering: "reguleert",
  cooptatie: "coöpteert",
  investering: "investeert in",
  donor: "doneert aan",
  woordvoerder_van: "is woordvoerder van",
  citeert: "citeert",
  framing: "stuurt de framing van",
  intimidatie: "intimideert",
  zelfcensuur: "past zelfcensuur toe voor",
  lobbyt: "lobbyt bij",
  algoritmische_filtering: "filtert algoritmisch",
  // Epic 15 (decision-making)
  ambt: "heeft een ambt bij",
  zeggenschap: "heeft zeggenschap over",
  controle: "controleert",
  geschenk: "gaf een geschenk aan",
};

/**
 * "beinvloeding" alone says nothing: what it means is in the mechanism. Read as "source … target"
 * and "target … source", the source being the one with the influence.
 */
const INFLUENCE_PHRASES: Record<string, [string, string]> = {
  expert_legitimatie: ["treedt op als deskundige bij", "heeft als deskundige"],
  expert_framing: ["levert experts en analyses aan", "brengt experts en analyses van"],
  bron_afhankelijkheid: ["is vaste bron voor", "leunt als bron op"],
  crisis_bronmonopolie: ["was in de crisis dé bron voor", "leunde in de crisis op"],
  institutioneel_gezag: ["is gezaghebbende bron voor", "neemt rapporten en cijfers over van"],
  pakketjournalistiek: ["levert kant-en-klaar nieuws aan", "neemt kant-en-klaar nieuws over van"],
  verifieerbaarheidsroutine: ["levert snel te checken nieuws aan", "neemt snel te checken nieuws over van"],
  pr_subsidie: ["levert kant-en-klare PR aan", "neemt PR over van"],
  politicus_als_bron: ["is bron voor", "heeft als bron"],
  belangenbehartiging: ["brengt zijn belang in bij", "geeft podium aan het belang van"],
  intermedia_agendering: ["zet de agenda van", "volgt de agenda van"],
  media_agendering: ["zet de agenda van", "volgt de agenda van"],
  indexering: ["bepaalt de bandbreedte van", "volgt de bandbreedte van"],
  citaatautorisatie: ["autoriseert de citaten van", "laat citaten autoriseren door"],
  elite_referentiekader: ["bepaalt het referentiekader van", "denkt binnen het kader van"],
  ideologische_synchronisatie: ["stemt het wereldbeeld af met", "deelt het wereldbeeld van"],
  academische_socialisatie: ["leidde journalisten op voor", "heeft journalisten opgeleid aan"],
  academische_socialisatie_hoofdredacteur: ["vormde", "is gevormd aan"],
  academische_socialisatie_politiek: ["vormde", "is gevormd aan"],
  academische_vorming_opinie: ["vormde", "is gevormd aan"],
  academische_orthodoxie_denktank: ["levert het denkkader van", "denkt in de kaders van"],
  academische_orthodoxie_instituut: ["levert het denkkader van", "denkt in de kaders van"],
  academische_autoriteit: ["verleent gezag aan", "ontleent gezag aan"],
  institutionele_gezagsketen: ["verleent gezag aan", "ontleent gezag aan"],
  begrotingsorthodoxie: ["zet het begrotingsframe van", "neemt het begrotingsframe over van"],
  meningsspectrum_beperking: ["beperkt de keuze van", "krijgt een beperkte keuze van"],
  kapitaalvluchtdreiging: ["dreigt met vertrek bij", "krijgt vertrekdreigingen van"],
  algoritmische_filtering: ["bepaalt het bereik van", "hangt voor zijn bereik af van"],
  algoritmische_socialisatie: ["bepaalt het nieuwsbeeld van", "haalt zijn nieuws via"],
  platform_advertentie_concentratie: ["neemt advertentiegeld af van", "verliest advertentiegeld aan"],
  platform_verdienmodel_druk: ["dwingt platformlogica af bij", "volgt de platformlogica van"],
  kijkcijferdisciplinering: ["stuurt met kijkcijfers de redactie van", "stuurt op de kijkcijfers van"],
  bestelsturing: ["verdeelt geld en zendtijd van", "krijgt geld en zendtijd van"],
  intekensturing: ["keurt de programma's goed van", "laat zijn programma's goedkeuren door"],
  winstmaximalisatie: ["legt een rendementseis op aan", "moet rendement maken voor"],
  redactioneel_budgetcontrole: ["bepaalt het redactiebudget van", "krijgt zijn redactiebudget van"],
  stak_stemzeggenschap: ["heeft het stemrecht over", "valt onder het stemrecht van"],
  ledenraad_zeggenschap: ["heeft zeggenschap over", "valt onder de zeggenschap van"],
  redactieraad_instemming: ["stemt in met de hoofdredacteur van", "benoemt zijn hoofdredacteur met instemming van"],
  zelfcensuur: ["bepaalt de redactiecultuur van", "past zich aan aan de cultuur van"],
  bestuurlijke_redactiedruk: ["zet de redactie onder druk van", "staat onder druk van"],
  statelijke_tegenwerking: ["werkt journalisten tegen bij", "wordt tegengewerkt door"],
  geweld_intimidatie: ["is een afschrikwekkend geval voor", "is afgeschrikt door het geval"],
  toezicht_tandeloosheid: ["houdt zwak toezicht op", "staat onder zwak toezicht van"],
  toezichthouder_interventie: ["grijpt in bij", "kreeg voorwaarden van"],
  vakbond_bescherming: ["beschermt de journalisten van", "heeft journalisten onder bescherming van"],
  publieksafleiding: ["leidt de aandacht af van", "wordt afgeleid door"],
};

/** "Bron afhankelijkheid", "Intermedia-agendering" (pm display names) → "bron_afhankelijkheid", … */
export function mechanismKey(mechanism: string | null | undefined): string {
  return (mechanism ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** "Secretaris-generaal" → "secretaris-generaal"; "Kamerlid", "Europarlementariër" and abbreviations stay */
function officeWords(functie: string): string {
  const text = functie.trim();
  if (/^(Kamerlid|Europarlementari|[A-Z]{2,})/.test(text)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * The words of a relation read as "source … target"; for "beinvloeding" those of its mechanism, for
 * an office (Epic 15) the office the register gives: "is secretaris-generaal bij".
 */
export function pmRelationLabel(type: string, mechanism?: string | null, functie?: string | null): string {
  if (type === "ambt" && functie?.trim()) return `is ${officeWords(functie)} bij`;
  if (type === "beinvloeding" && mechanism?.trim()) {
    return INFLUENCE_PHRASES[mechanismKey(mechanism)]?.[0] ?? `beïnvloedt via ${mechanism.trim().toLowerCase()}`;
  }
  return PM_RELATION_LABELS[type] ?? type.replace(/_/g, " ");
}

/** The same relation types read from the target: "target … source" (AD "is eigendom van" DPG Media). */
const PM_RELATION_REVERSE_LABELS: Record<string, string> = {
  eigendom: "is eigendom van",
  financiering: "wordt gefinancierd door",
  adverteerder: "krijgt advertenties van",
  flak: "krijgt druk van",
  bron_van: "heeft als bron",
  beinvloeding: "wordt beïnvloed door",
  draaideur: "kreeg als overstapper",
  bestuurder: "wordt bestuurd door",
  adviseur: "wordt geadviseerd door",
  censuur: "wordt gecensureerd door",
  mediaplatform: "verschijnt bij",
  personeel: "heeft als medewerker",
  lidmaatschap: "heeft als lid",
  oppositie: "staat tegenover",
  alliantie: "werkt samen met",
  etikettering: "wordt geëtiketteerd door",
  dienstverband: "heeft in dienst",
  regulering: "wordt gereguleerd door",
  cooptatie: "wordt gecoöpteerd door",
  investering: "krijgt investeringen van",
  donor: "krijgt donaties van",
  woordvoerder_van: "heeft als woordvoerder",
  citeert: "wordt geciteerd door",
  framing: "krijgt framing van",
  intimidatie: "wordt geïntimideerd door",
  zelfcensuur: "is onderwerp van zelfcensuur bij",
  lobbyt: "wordt belobbyd door",
  algoritmische_filtering: "wordt algoritmisch gefilterd door",
  // Epic 15 (decision-making)
  ambt: "heeft als ambtsdrager",
  zeggenschap: "valt onder",
  controle: "wordt gecontroleerd door",
  geschenk: "kreeg een geschenk van",
};

export function pmRelationReverseLabel(type: string, mechanism?: string | null, functie?: string | null): string {
  if (type === "ambt" && functie?.trim()) return `heeft als ${officeWords(functie)}`;
  if (type === "beinvloeding" && mechanism?.trim()) {
    return INFLUENCE_PHRASES[mechanismKey(mechanism)]?.[1] ?? `wordt via ${mechanism.trim().toLowerCase()} beïnvloed door`;
  }
  return PM_RELATION_REVERSE_LABELS[type] ?? `${pmRelationLabel(type)} (omgekeerd)`;
}

/**
 * Affiliations: someone belongs to an organisation. The model gives them no direction of influence and
 * stores them either way round ("VVD → Heinen" and "Heinen → Tweede Kamer" are both lidmaatschap).
 */
export const PM_AFFILIATIONS: ReadonlySet<string> = new Set(["lidmaatschap", "personeel", "dienstverband", "woordvoerder_van", "bestuurder", "adviseur", "draaideur"]);

/** Entity types that are a group others are a member of */
const GROUP_TYPES = new Set(["partij", "elite_netwerk", "vakbond", "lobbygroep"]);

type ReadableRelation = Pick<PmRelation, "source_id" | "target_id" | "relation_type" | "mechanism"> & { functie?: string | null };

/**
 * The end a relation's label is read from: its source, but for an affiliation the person (or the
 * member of a group), whichever way the model stores it, so "Heinen is lid van VVD".
 */
export function labelSourceId(relation: ReadableRelation, typeOf: (id: number) => string | null | undefined): number {
  if (!PM_AFFILIATIONS.has(relation.relation_type)) return relation.source_id;
  const member = (id: number, other: number) =>
    (typeOf(id) === "persoon" && typeOf(other) !== "persoon") || (GROUP_TYPES.has(typeOf(other) ?? "") && !GROUP_TYPES.has(typeOf(id) ?? ""));
  if (member(relation.target_id, relation.source_id)) return relation.target_id;
  return relation.source_id;
}

/** The words of a relation read from one of its ends: "RIVM is vaste bron voor …", "NOS leunt als bron op …". */
export function relationWords(relation: ReadableRelation, fromId: number, typeOf: (id: number) => string | null | undefined): string {
  return labelSourceId(relation, typeOf) === fromId
    ? pmRelationLabel(relation.relation_type, relation.mechanism, relation.functie)
    : pmRelationReverseLabel(relation.relation_type, relation.mechanism, relation.functie);
}

export function filterLabel(filter: string | null | undefined): string {
  if (!filter) return "Overig";
  return FILTER_BY_ID[filter as FilterId]?.label ?? (filter === "overig" ? "Overig" : filter);
}

/** Entity types of the propaganda model in the six families of its own website (colours from web/index.html). */
export interface PmTypeFamily {
  id: string;
  label: string;
  color: string;
  types: string[];
}

export const PM_TYPE_FAMILIES: PmTypeFamily[] = [
  { id: "politiek", label: "Politiek & bestuur", color: "#009b88", types: ["partij", "overheidsinstelling", "toezichthouder", "rechterlijke_macht"] },
  { id: "personen", label: "Personen", color: "#e6443d", types: ["persoon"] },
  { id: "lobby", label: "Denktanks & lobby", color: "#a76ef8", types: ["denktank", "lobbygroep", "pr_bureau", "elite_netwerk"] },
  { id: "media", label: "Media", color: "#0087f3", types: ["mediaorganisatie", "omroep", "persbureau", "platform"] },
  { id: "economie", label: "Economie & eigendom", color: "#e1b000", types: ["bedrijf", "vermogensbeheerder", "stichting"] },
  { id: "maatschappij", label: "Wetenschap & maatschappij", color: "#009520", types: ["onderwijsinstelling", "ngo", "vakbond", "burgerinitiatief"] },
];

const OTHER_FAMILY: PmTypeFamily = { id: "overig", label: "Overig", color: "#94a3b8", types: [] };

export function pmTypeFamily(type: string | null | undefined): PmTypeFamily {
  return PM_TYPE_FAMILIES.find((family) => family.types.includes(type ?? "")) ?? OTHER_FAMILY;
}

const PM_TYPE_LABELS: Record<string, string> = {
  rechterlijke_macht: "rechterlijke macht",
  pr_bureau: "pr-bureau",
  elite_netwerk: "elitenetwerk",
};

/** "rechterlijke_macht" → "rechterlijke macht" */
export function pmTypeLabel(type: string | null | undefined): string {
  if (!type) return "onbekend";
  return PM_TYPE_LABELS[type] ?? type.replace(/_/g, " ");
}

export const EVENT_TYPE_LABELS: Record<string, string> = {
  politics: "Politiek",
  international: "Buitenland",
  crime: "Misdaad",
  sports: "Sport",
  entertainment: "Cultuur",
  business: "Economie",
  legal: "Rechtszaken",
  weather: "Weer",
  other: "Overig",
};

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
