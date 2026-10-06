/**
 * Demo of "Van anderen" (Story 14.15), behind NEXT_PUBLIC_ENABLE_DEMO: what other readers shared
 * about the demo news, and sharing, taking over and reporting simulated on this device.
 *
 * FICTIONAL, like the demo event: these readers, what they wrote and their sources do not exist
 * (links go to example.org or the reserved .example domain). What you share, take over or report
 * in the demo is kept on this device (localStorage), never sent anywhere.
 */

import type { ModerateAction, ShareFields, ShareResult, SharedEntry } from "@/lib/shared";

const STORAGE_KEY = "pluriformiteit:demo-gedeeld";

type Fixture = Omit<SharedEntry, "event_id" | "mine" | "own_id" | "adopted_by_me" | "hidden" | "detail" | "quote" | "anchor" | "against" | "about" | "fallacy" | "url" | "title" | "date"> &
  Partial<Pick<SharedEntry, "detail" | "quote" | "anchor" | "against" | "about" | "fallacy" | "url" | "title" | "date">>;

/** What other readers shared, per demo event (ids are negative, like the demo's) */
const OTHERS: Record<number, Fixture[]> = {
  // /event/demo: the decision on the wind farm
  [-1]: [
    {
      id: -201,
      kind: "error",
      about: "claim:kfkq1g",
      text: "Het omgevingsfonds is € 400.000 per jaar, geen miljoenen",
      detail: "Dat staat in de overeenkomst die de gemeente publiceerde.",
      url: "https://example.org/demo/dijkerhoven-omgevingsfonds",
      adopted: 5,
      created_at: "2026-09-28T13:20:00Z",
    },
    {
      id: -202,
      kind: "fallacy",
      fallacy: "ad_hominem",
      anchor: "outlet:geenstijl",
      text: "Voorstanders worden weggezet als 'windlobby' in plaats van op hun argumenten beantwoord",
      adopted: 3,
      created_at: "2026-09-28T15:05:00Z",
    },
    {
      id: -203,
      kind: "fallacy",
      fallacy: "selectieve_presentatie",
      anchor: "outlet:nu-nl",
      text: "Alleen de adviesraad en NordVind komen aan het woord over de veiligheid",
      detail: "Geluidsdeskundigen die twijfelen, worden niet genoemd.",
      adopted: 1,
      created_at: "2026-09-29T08:40:00Z",
    },
    {
      id: -204,
      kind: "contradiction",
      anchor: "speaker:telegraaf:anouk-verbeek",
      against: "speaker:ad:henk-de-boer",
      text: "Of het dorp inspraak heeft gehad",
      detail: "De wethouder noemt drie inspraakavonden; Henk de Boer zegt dat niemand iets gevraagd is.",
      adopted: 2,
      created_at: "2026-09-28T18:30:00Z",
    },
    {
      id: -212,
      kind: "claim",
      anchor: "speaker:nu-nl:nordvind",
      text: "Het geluid blijft ruim binnen de normen",
      detail: "Het geluidsonderzoek is nog niet af, en de normen gaan over gemiddelden, niet over de nacht.",
      adopted: 2,
      created_at: "2026-09-29T16:00:00Z",
    },
    {
      id: -205,
      kind: "gap",
      text: "Jongeren uit het dorp",
      detail: "Zij wonen er straks het langst naast.",
      adopted: 4,
      created_at: "2026-09-28T12:10:00Z",
    },
    {
      id: -206,
      kind: "gap",
      text: "Netbeheerder",
      detail: "Of het stroomnet de opwek aankan, vraagt niemand.",
      adopted: 2,
      created_at: "2026-09-29T09:15:00Z",
    },
    {
      id: -207,
      kind: "question",
      anchor: "speaker:telegraaf:anouk-verbeek",
      text: "Wie beheert het omgevingsfonds?",
      adopted: 3,
      created_at: "2026-09-29T10:00:00Z",
    },
    {
      id: -208,
      kind: "source",
      url: "https://dijkerhovense-courant.example/nieuws/dorpsraden-willen-geld-uit-windpark",
      title: "Dorpsraden willen geld uit windpark voor de dorpshuizen",
      text: "De lokale krant laat de dorpsraden aan het woord over wat het omgevingsfonds moet betalen.",
      detail: "Dorpsraad Dijkerhoven, dorpsraad Oosterpolder",
      adopted: 2,
      created_at: "2026-09-29T11:30:00Z",
    },
    {
      id: -209,
      kind: "speaker",
      anchor: "outlet:volkskrant",
      text: "Vogelwerkgroep Dijkerhoven",
      detail: "telt al dertig jaar de weidevogels",
      quote: "De grutto broedt precies waar de turbines komen",
      adopted: 1,
      created_at: "2026-09-29T07:50:00Z",
    },
    {
      id: -210,
      kind: "note",
      anchor: "outlet:ad",
      text: "'Bewoners woedend' in de kop, terwijl er twee bewoners aan het woord komen",
      adopted: 2,
      created_at: "2026-09-28T20:45:00Z",
    },
    {
      id: -211,
      kind: "moment",
      date: "2019-06-12",
      text: "De provincie wees een eerder windplan in de polder af vanwege de weidevogels",
      url: "https://example.org/demo/provincie-windplan-2019",
      adopted: 1,
      created_at: "2026-09-29T14:20:00Z",
    },
  ],
  // /event/demo-vervolg: the court halts the build
  [-3]: [
    {
      id: -301,
      kind: "fallacy",
      fallacy: "slippery_slope",
      anchor: "speaker:nos:anouk-verbeek",
      text: "Als Dijkerhoven stopt, stopt de energietransitie in de hele regio",
      detail: "De rechter oordeelt over het geluid van één park, niet over de klimaatdoelen.",
      adopted: 3,
      created_at: "2026-10-02T09:30:00Z",
    },
    {
      id: -302,
      kind: "contradiction",
      anchor: "speaker:nos:nordvind",
      against: "speaker:nos:joost-ravenhorst",
      text: "Of de bouw al mocht beginnen",
      detail: "NordVind zegt dat alle vergunningen rond waren; Ravenhorst dat het geluidsonderzoek eerst af moest.",
      adopted: 2,
      created_at: "2026-10-02T10:15:00Z",
    },
    {
      id: -303,
      kind: "error",
      about: "claim:1f8hibt",
      text: "Het RIVM zegt niet dat het geluid onschuldig is: hinder en slaapverstoring zijn wél aangetoond",
      url: "https://example.org/demo/rivm-windturbinegeluid",
      adopted: 4,
      created_at: "2026-10-02T11:00:00Z",
    },
    {
      id: -304,
      kind: "gap",
      text: "Jongeren uit het dorp",
      detail: "Zij wonen er straks het langst naast.",
      adopted: 2,
      created_at: "2026-10-02T12:40:00Z",
    },
    {
      id: -305,
      kind: "question",
      anchor: "speaker:nos:anouk-verbeek",
      text: "Wie betaalt de schade als de bouw stil blijft liggen?",
      adopted: 1,
      created_at: "2026-10-02T13:05:00Z",
    },
    {
      id: -306,
      kind: "source",
      url: "https://dijkerhovense-courant.example/nieuws/omwonenden-na-de-uitspraak",
      title: "Omwonenden na de uitspraak: 'Eindelijk luistert iemand'",
      text: "De lokale krant laat omwonenden uit beide kampen aan het woord, ook voorstanders van het park.",
      detail: "Omwonenden, een boer, de dorpsraad",
      adopted: 2,
      created_at: "2026-10-02T15:20:00Z",
    },
    {
      id: -307,
      kind: "note",
      anchor: "outlet:nos",
      text: "Het stuk brengt de uitspraak als nederlaag voor het dorp, terwijl een deel van het dorp haar juist wilde",
      adopted: 1,
      created_at: "2026-10-02T16:10:00Z",
    },
    {
      id: -308,
      kind: "moment",
      date: "2025-11-20",
      text: "De gemeenteraad stemt in met het bestemmingsplan, onder voorbehoud van het geluidsonderzoek",
      url: "https://example.org/demo/raad-bestemmingsplan",
      adopted: 1,
      created_at: "2026-10-02T17:00:00Z",
    },
  ],
};

interface Stored {
  /** What you shared in the demo */
  shared: SharedEntry[];
  /** Ids you took over */
  adopted: number[];
  /** Ids you reported (gone for you) */
  reported: number[];
  /** Ids hidden by the admin */
  hidden: number[];
}

function read(): Stored {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const data = raw ? (JSON.parse(raw) as Partial<Stored>) : {};
    return {
      shared: Array.isArray(data.shared) ? data.shared : [],
      adopted: Array.isArray(data.adopted) ? data.adopted : [],
      reported: Array.isArray(data.reported) ? data.reported : [],
      hidden: Array.isArray(data.hidden) ? data.hidden : [],
    };
  } catch {
    return { shared: [], adopted: [], reported: [], hidden: [] };
  }
}

function write(data: Stored) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // A private window: the demo just does not remember it
  }
}

function fixture(eventId: number, entry: Fixture, data: Stored): SharedEntry {
  const adoptedByMe = data.adopted.includes(entry.id);
  return {
    detail: null,
    quote: null,
    anchor: null,
    against: null,
    about: null,
    fallacy: null,
    url: null,
    title: null,
    date: null,
    ...entry,
    event_id: eventId,
    adopted: entry.adopted + (adoptedByMe ? 1 : 0),
    mine: false,
    own_id: null,
    adopted_by_me: adoptedByMe,
    hidden: false,
  };
}

export async function demoSharedEntries(eventId: number): Promise<SharedEntry[]> {
  const data = read();
  const gone = new Set([...data.reported, ...data.hidden]);
  const others = (OTHERS[eventId] ?? []).filter((entry) => !gone.has(entry.id)).map((entry) => fixture(eventId, entry, data));
  const mine = data.shared.filter((entry) => entry.event_id === eventId && !data.hidden.includes(entry.id));
  return [...mine, ...others].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

export async function demoShare(eventId: number, fields: ShareFields): Promise<ShareResult> {
  const data = read();
  const existing = data.shared.find((entry) => entry.own_id === fields.id);
  const entry: SharedEntry = {
    id: existing?.id ?? Math.min(-5000, ...data.shared.map((item) => item.id)) - 1,
    event_id: eventId,
    kind: fields.kind,
    text: fields.text,
    detail: fields.detail ?? null,
    quote: fields.quote ?? null,
    anchor: fields.anchor ?? null,
    against: fields.against ?? null,
    about: fields.about ?? null,
    fallacy: fields.fallacy ?? null,
    url: fields.url ?? null,
    title: fields.title ?? null,
    date: fields.date ?? null,
    adopted: existing?.adopted ?? 0,
    created_at: existing?.created_at ?? new Date().toISOString(),
    mine: true,
    own_id: fields.id,
    adopted_by_me: false,
    hidden: false,
  };
  write({ ...data, shared: [...data.shared.filter((item) => item.own_id !== fields.id), entry] });
  return { ok: true, entry };
}

export async function demoUnshare(_eventId: number, ownId: string): Promise<boolean> {
  const data = read();
  write({ ...data, shared: data.shared.filter((entry) => entry.own_id !== ownId) });
  return true;
}

export async function demoAdopt(id: number, adopt: boolean): Promise<{ ok: boolean; reason: string | null }> {
  const data = read();
  if (data.shared.some((entry) => entry.id === id)) return { ok: false, reason: "eigen" };
  const adopted = data.adopted.filter((item) => item !== id);
  write({ ...data, adopted: adopt ? [...adopted, id] : adopted });
  return { ok: true, reason: null };
}

export async function demoReport(id: number): Promise<{ ok: boolean; reason: string | null }> {
  const data = read();
  if (data.shared.some((entry) => entry.id === id)) return { ok: false, reason: "eigen" };
  write({ ...data, reported: Array.from(new Set([...data.reported, id])) });
  return { ok: true, reason: null };
}

export async function demoModerate(id: number, action: ModerateAction): Promise<{ ok: boolean; reason: string | null }> {
  const data = read();
  if (action === "toon") write({ ...data, hidden: data.hidden.filter((item) => item !== id), reported: data.reported.filter((item) => item !== id) });
  else write({ ...data, hidden: Array.from(new Set([...data.hidden, id])) });
  return { ok: true, reason: null };
}
