/**
 * Identity of news outlets: names, aliases, domains, spectrum and the link to the propaganda-model
 * project (`pmEntityId`). Ownership, funding and other structural relations come from the
 * propaganda model itself (Story 11.17), not from this file.
 *
 * `ownershipType` of international outlets is an editorial estimate, shown as such in the UI.
 * `establishment` (-1 alternatief .. +1 gevestigd) and `politicalX` (left-right for alternative outlets) come from the
 * Epic 8 reference table (docs/stories/active/epic-8-media-spectrum-visualization.md); Een Blik op de NOS is our own
 * estimate. All positions are editorial estimates and are labelled as such in the UI.
 * Spectrum values mirror `source_metadata.spectrum` in backend/app/feeds/*.py.
 */

import { slugify, urlHost } from "./normalize";
import type { OutletProfile } from "./types";

export const DUTCH_OUTLETS: OutletProfile[] = [
  {
    key: "nos",
    name: "NOS",
    aliases: ["NOS", "NOS Nieuws", "Nederlandse Omroep Stichting"],
    domains: ["nos.nl"],
    country: "NL",
    mediaType: "public_broadcaster",
    spectrum: 4,
    establishment: 0.9,
    ownershipType: "public",
    pmEntityId: 11,
    wikipediaTitle: "Nederlandse Omroep Stichting",
    monitored: true,
  },
  {
    key: "nu-nl",
    name: "NU.nl",
    aliases: ["NU.nl", "NU", "nu.nl", "nunl"],
    domains: ["nu.nl"],
    country: "NL",
    mediaType: "commercial",
    spectrum: 6,
    establishment: 0.7,
    ownershipType: "corporate",
    pmEntityId: 7,
    wikipediaTitle: "NU.nl",
    monitored: true,
  },
  {
    key: "ad",
    name: "AD",
    aliases: ["AD", "Algemeen Dagblad", "AD (Algemeen Dagblad)"],
    domains: ["ad.nl"],
    country: "NL",
    mediaType: "commercial",
    spectrum: 5.5,
    establishment: 0.6,
    ownershipType: "corporate",
    pmEntityId: 3,
    wikipediaTitle: "Algemeen Dagblad",
    monitored: true,
  },
  {
    key: "rtl-nieuws",
    name: "RTL Nieuws",
    aliases: ["RTL Nieuws", "RTL"],
    domains: ["rtl.nl", "rtlnieuws.nl"],
    country: "NL",
    mediaType: "commercial_broadcaster",
    spectrum: 5,
    establishment: 0.8,
    ownershipType: "corporate",
    pmEntityId: 88,
    wikipediaTitle: "RTL Nieuws",
    monitored: true,
  },
  {
    key: "telegraaf",
    name: "De Telegraaf",
    aliases: ["De Telegraaf", "Telegraaf"],
    domains: ["telegraaf.nl"],
    country: "NL",
    mediaType: "tabloid",
    spectrum: 7,
    establishment: 0.7,
    ownershipType: "corporate",
    pmEntityId: 9,
    wikipediaTitle: "De Telegraaf",
    monitored: true,
  },
  {
    key: "volkskrant",
    name: "de Volkskrant",
    aliases: ["de Volkskrant", "De Volkskrant", "Volkskrant"],
    domains: ["volkskrant.nl"],
    country: "NL",
    mediaType: "broadsheet",
    spectrum: 2,
    establishment: 0.7,
    ownershipType: "corporate",
    pmEntityId: 4,
    wikipediaTitle: "de Volkskrant",
    monitored: true,
  },
  {
    key: "parool",
    name: "Het Parool",
    aliases: ["Het Parool", "Parool"],
    domains: ["parool.nl"],
    country: "NL",
    mediaType: "regional_daily",
    spectrum: 3,
    establishment: 0.6,
    ownershipType: "corporate",
    pmEntityId: 6,
    wikipediaTitle: "Het Parool",
    monitored: true,
  },
  {
    key: "trouw",
    name: "Trouw",
    aliases: ["Trouw"],
    domains: ["trouw.nl"],
    country: "NL",
    mediaType: "quality_daily",
    spectrum: 4.5,
    establishment: 0.7,
    ownershipType: "corporate",
    pmEntityId: 5,
    wikipediaTitle: "Trouw (krant)",
    monitored: true,
  },
  {
    key: "geenstijl",
    name: "GeenStijl",
    aliases: ["GeenStijl", "Geenstijl"],
    domains: ["geenstijl.nl"],
    country: "NL",
    mediaType: "opinion_blog",
    spectrum: 8,
    establishment: -0.5,
    ownershipType: "corporate",
    pmEntityId: 342,
    wikipediaTitle: "GeenStijl",
    monitored: true,
  },
  {
    key: "nieuwrechts",
    name: "NieuwRechts",
    aliases: ["NieuwRechts", "Nieuw Rechts"],
    domains: ["nieuwrechts.nl"],
    country: "NL",
    mediaType: "online_news",
    spectrum: 9,
    establishment: -0.7,
    ownershipType: "independent",
    monitored: true,
  },
  {
    key: "andere-krant",
    name: "De Andere Krant",
    aliases: ["De Andere Krant", "de andere krant", "deanderekrant"],
    domains: ["deanderekrant.nl"],
    country: "NL",
    mediaType: "alternative_weekly",
    spectrum: "alternative",
    politicalX: 6,
    establishment: -0.8,
    ownershipType: "independent",
    pmEntityId: 248,
    monitored: true,
  },
  {
    key: "ninefornews",
    name: "NineForNews",
    aliases: ["NineForNews", "Nine For News"],
    domains: ["ninefornews.nl"],
    country: "NL",
    mediaType: "alternative_online",
    spectrum: "alternative",
    politicalX: 7,
    establishment: -0.9,
    ownershipType: "independent",
    monitored: true,
  },
  {
    key: "een-blik-op-de-nos",
    name: "Een Blik op de NOS",
    aliases: ["Een Blik op de NOS", "@eenblikopdenos", "eenblikopdenos"],
    domains: ["x.com", "xcancel.com"],
    country: "NL",
    mediaType: "social_commentary",
    spectrum: 7,
    establishment: -0.4,
    ownershipType: "independent",
    monitored: true,
    watchdogOf: ["nos"],
  },
];

/** Frequently seen international outlets (Google News), matched by domain. Ownership type is editorial. */
export const INTERNATIONAL_OUTLETS: OutletProfile[] = [
  intl("bbc", "BBC", ["bbc.com", "bbc.co.uk"], "GB", "public", "BBC"),
  intl("reuters", "Reuters", ["reuters.com"], "GB", "corporate", "Reuters"),
  intl("ap", "Associated Press", ["apnews.com"], "US", "cooperative", "Associated Press", ["AP News"]),
  intl("cnn", "CNN", ["cnn.com"], "US", "corporate", "CNN"),
  intl("nytimes", "The New York Times", ["nytimes.com"], "US", "corporate", "The New York Times"),
  intl("washington-post", "The Washington Post", ["washingtonpost.com"], "US", "corporate", "The Washington Post"),
  intl("wsj", "The Wall Street Journal", ["wsj.com"], "US", "corporate", "The Wall Street Journal"),
  intl("bloomberg", "Bloomberg", ["bloomberg.com"], "US", "corporate", "Bloomberg News"),
  intl("fox-news", "Fox News", ["foxnews.com"], "US", "corporate", "Fox News"),
  intl("politico", "Politico", ["politico.com", "politico.eu"], "US", "corporate", "Politico"),
  intl("guardian", "The Guardian", ["theguardian.com"], "GB", "trust", "The Guardian"),
  intl("dw", "Deutsche Welle", ["dw.com"], "DE", "public", "Deutsche Welle", ["DW"]),
  intl("spiegel", "Der Spiegel", ["spiegel.de"], "DE", "corporate", "Der Spiegel"),
  intl("france24", "France 24", ["france24.com"], "FR", "public", "France 24"),
  intl("le-monde", "Le Monde", ["lemonde.fr"], "FR", "corporate", "Le Monde"),
  intl("euronews", "Euronews", ["euronews.com"], "FR", "corporate", "Euronews"),
  intl("vrt", "VRT NWS", ["vrt.be", "vrtnws.be"], "BE", "public", "VRT NWS", ["VRT"]),
  intl("standaard", "De Standaard", ["standaard.be"], "BE", "corporate", "De Standaard"),
  intl("nieuwsblad", "Het Nieuwsblad", ["nieuwsblad.be"], "BE", "corporate", "Het Nieuwsblad"),
  intl("hln", "HLN", ["hln.be"], "BE", "corporate", "Het Laatste Nieuws"),
  intl("al-jazeera", "Al Jazeera", ["aljazeera.com", "aljazeera.net"], "QA", "state", "Al Jazeera"),
  intl("rt", "RT", ["rt.com"], "RU", "state", "RT (televisiezender)"),
  intl("tass", "TASS", ["tass.com", "tass.ru"], "RU", "state", "TASS"),
  intl("xinhua", "Xinhua", ["xinhuanet.com", "news.cn"], "CN", "state", "Xinhua"),
  intl("cgtn", "CGTN", ["cgtn.com"], "CN", "state", "China Global Television Network"),
  intl("global-times", "Global Times", ["globaltimes.cn"], "CN", "state", "Global Times"),
  intl("trt-world", "TRT World", ["trtworld.com"], "TR", "state", "TRT World"),
  intl("anadolu", "Anadolu", ["aa.com.tr"], "TR", "state", "Anadolu Agency"),
  intl("times-of-israel", "The Times of Israel", ["timesofisrael.com"], "IL", "corporate", "The Times of Israel"),
  intl("haaretz", "Haaretz", ["haaretz.com"], "IL", "corporate", "Haaretz"),
  intl("jerusalem-post", "The Jerusalem Post", ["jpost.com"], "IL", "corporate", "The Jerusalem Post"),
  intl("kyiv-independent", "The Kyiv Independent", ["kyivindependent.com"], "UA", "independent", "The Kyiv Independent"),
];

function intl(
  key: string,
  name: string,
  domains: string[],
  country: string,
  ownershipType: OutletProfile["ownershipType"],
  wikipediaTitle: string,
  /** Other names in feeds and in the analysis ("DW") */
  aliases: string[] = [],
): OutletProfile {
  return { key, name, aliases: [name, ...aliases], domains, country, ownershipType, wikipediaTitle, monitored: false };
}

export const ALL_OUTLETS: OutletProfile[] = [...DUTCH_OUTLETS, ...INTERNATIONAL_OUTLETS];

const byAlias = new Map<string, OutletProfile>();
const byDomain = new Map<string, OutletProfile>();
for (const profile of ALL_OUTLETS) {
  byAlias.set(slugify(profile.name), profile);
  byAlias.set(profile.key, profile);
  for (const alias of profile.aliases) {
    byAlias.set(slugify(alias), profile);
  }
  for (const domain of profile.domains) {
    byDomain.set(domain, profile);
  }
}

/** Find an outlet by (LLM or feed) name, ignoring case, diacritics and punctuation. */
export function findOutletByName(name: string | null | undefined): OutletProfile | null {
  if (!name) return null;
  return byAlias.get(slugify(name)) ?? null;
}

/** Find an outlet by URL or host, also matching subdomains (e.g. edition.cnn.com). */
export function findOutletByUrl(url: string | null | undefined): OutletProfile | null {
  const host = url && url.includes("/") ? urlHost(url) : (url ?? "").toLowerCase();
  if (!host) return null;
  const parts = host.split(".");
  for (let i = 0; i < parts.length - 1; i += 1) {
    const candidate = parts.slice(i).join(".");
    const profile = byDomain.get(candidate);
    if (profile) return profile;
  }
  return null;
}

export const OWNERSHIP_TYPE_LABELS: Record<NonNullable<OutletProfile["ownershipType"]>, string> = {
  public: "Publieke omroep",
  corporate: "Commercieel",
  independent: "Onafhankelijk",
  state: "Staatsmedium",
  cooperative: "Coöperatie",
  trust: "Stichting/trust",
  unknown: "Onbekend",
};
