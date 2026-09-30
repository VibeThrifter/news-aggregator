/**
 * Dutch labels and descriptions used throughout the exploration UI.
 */

import type { SpoorId } from "./types";

export interface SpoorDefinition {
  id: SpoorId;
  question: string;
  intro: string;
  /** lucide icon name, resolved in the UI layer */
  icon: string;
}

export const SPOREN: SpoorDefinition[] = [
  {
    id: "wie-zegt-wat",
    question: "Wie zegt wat?",
    intro: "Welke invalshoeken zijn er, en wie krijgt bij welke bron het woord?",
    icon: "MessagesSquare",
  },
  {
    id: "wat-klopt-niet",
    question: "Wat klopt er niet?",
    intro: "Tegenspraak tussen bronnen, claims zonder bewijs, rammelende cijfers en redeneerfouten.",
    icon: "SearchCheck",
  },
  {
    id: "wie-heeft-belang",
    question: "Wie heeft er belang bij?",
    intro: "Wie zijn de geciteerde autoriteiten, wie betaalt ze, en waarom is dit juist nu nieuws?",
    icon: "Coins",
  },
  {
    id: "hoe-gebracht",
    question: "Hoe wordt het gebracht?",
    intro: "Frames, toon en gekleurde zinnen: hoe het verhaal verteld wordt.",
    icon: "Megaphone",
  },
  {
    id: "wat-zie-je-niet",
    question: "Wat zie je niet?",
    intro: "Ontbrekende stemmen, vragen die niemand stelde en wat er is weggelaten.",
    icon: "EyeOff",
  },
  {
    id: "hoe-liep-het",
    question: "Hoe liep het?",
    intro: "Wie meldde wat wanneer, en hoe ontwikkelde het verhaal zich?",
    icon: "History",
  },
  {
    id: "buitenland",
    question: "En het buitenland?",
    intro: "Hoe brengen buitenlandse media dit verhaal, en welke landen spelen een rol?",
    icon: "Globe2",
  },
];

export const SPOOR_BY_ID: Record<SpoorId, SpoorDefinition> = Object.fromEntries(
  SPOREN.map((spoor) => [spoor.id, spoor]),
) as Record<SpoorId, SpoorDefinition>;

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

/** Herman & Chomsky filters as used by the propaganda-model project, plus tegenmacht. */
export type FilterId = "eigendom" | "advertentie" | "sourcing" | "flak" | "ideologie" | "tegenmacht";

export interface FilterDefinition {
  id: FilterId;
  label: string;
  question: string;
  /** Colour from propaganda-model web/huisstijl.css */
  color: string;
}

export const FILTERS: FilterDefinition[] = [
  { id: "eigendom", label: "Eigendom", question: "Wie is de eigenaar?", color: "#e74c3c" },
  { id: "advertentie", label: "Advertenties", question: "Wie betaalt de rekening?", color: "#f0a030" },
  { id: "sourcing", label: "Bronnen", question: "Wie mag het verhaal vertellen?", color: "#3498db" },
  { id: "flak", label: "Flak", question: "Wie oefent druk uit op de berichtgeving?", color: "#9b59b6" },
  { id: "ideologie", label: "Ideologie", question: "Welk wereldbeeld is vanzelfsprekend?", color: "#2ecc71" },
  { id: "tegenmacht", label: "Tegenmacht", question: "Wie houdt de macht in toom?", color: "#1abc9c" },
];

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
  draaideur: "draaideur naar",
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
};

export function pmRelationLabel(type: string): string {
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
  draaideur: "draaideur vanaf",
  bestuurder: "wordt bestuurd door",
  adviseur: "wordt geadviseerd door",
  censuur: "wordt gecensureerd door",
  mediaplatform: "heeft als platform",
  personeel: "heeft als medewerker",
  lidmaatschap: "heeft als lid",
  oppositie: "staat tegenover",
  alliantie: "werkt samen met",
  etikettering: "wordt geëtiketteerd door",
  dienstverband: "heeft in dienst",
  regulering: "wordt gereguleerd door",
  cooptatie: "wordt gecoöpteerd door",
};

export function pmRelationReverseLabel(type: string): string {
  return PM_RELATION_REVERSE_LABELS[type] ?? `${pmRelationLabel(type)} (omgekeerd)`;
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
