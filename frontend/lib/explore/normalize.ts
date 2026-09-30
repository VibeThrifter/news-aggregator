/**
 * Normalisation helpers shared by the exploration model.
 *
 * `slugify` MUST stay identical to `backend/app/nlp/entity_keys.py::slugify`; both are tested
 * against the shared vectors in `backend/tests/fixtures/entity_keys.json`.
 */

const TRANSLITERATIONS: Record<string, string> = {
  ł: "l",
  ø: "o",
  æ: "ae",
  œ: "oe",
  ß: "ss",
  đ: "d",
  ı: "i",
  þ: "th",
  ð: "d",
};

const LEADING_ARTICLES = new Set(["de", "het", "een", "the"]);

/** Slug for names: "De Nederlandsche Bank" -> "nederlandsche-bank", "Björn Borg" -> "bjorn-borg". */
export function slugify(name: string | null | undefined): string {
  if (!name) {
    return "";
  }
  let value = name.normalize("NFKD").replace(/\p{Mn}/gu, "");
  value = value.toLowerCase();
  value = value.replace(/[łøæœßđıþð]/g, (ch) => TRANSLITERATIONS[ch] ?? ch);
  value = value.replace(/['’‘`]/g, "");
  value = value.replace(/[^a-z0-9]/g, " ");
  let tokens = value.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && LEADING_ARTICLES.has(tokens[0])) {
    tokens = tokens.slice(1);
  }
  return tokens.join("-");
}

const TRACKING_PARAMS = /^(utm_.*|fbclid|gclid|ref|xtor|cmpid|at_medium|at_campaign)$/i;

/**
 * Normalise an article URL so insight URLs (which went through pydantic HttpUrl) match article URLs:
 * lowercase host without www./m./amp., no scheme/hash/tracking params, no trailing slash or /amp.
 */
export function normalizeUrl(url: string | null | undefined): string {
  if (!url) {
    return "";
  }
  const trimmed = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, "");
  }
  const host = parsed.hostname.toLowerCase().replace(/^(www\.|m\.|amp\.)/, "");
  let path = decodeSafe(parsed.pathname).replace(/\/amp\/?$/i, "").replace(/\/+$/, "");
  if (!path) {
    path = "";
  }
  const params = Array.from(parsed.searchParams.entries())
    .filter(([key]) => !TRACKING_PARAMS.test(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join("&")}` : "";
  return `${host}${path}${query}`;
}

function decodeSafe(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

/** Host of a URL without www./m./amp. ("" when unparsable). */
export function urlHost(url: string | null | undefined): string {
  const normalized = normalizeUrl(url);
  const slash = normalized.indexOf("/");
  const question = normalized.indexOf("?");
  const cut = [slash, question].filter((i) => i >= 0);
  return cut.length ? normalized.slice(0, Math.min(...cut)) : normalized;
}

/**
 * Loose fingerprint for URL matching when exact normalisation fails:
 * host + the longest run of 5+ digits (NOS, NU.nl and DPG article ids), else the last path segment.
 */
export function urlFingerprint(url: string | null | undefined): string {
  const normalized = normalizeUrl(url);
  if (!normalized) {
    return "";
  }
  const host = urlHost(url);
  const rest = normalized.slice(host.length).split("?")[0];
  const digitRuns = rest.match(/\d{5,}/g);
  if (digitRuns && digitRuns.length) {
    const longest = digitRuns.reduce((a, b) => (b.length > a.length ? b : a));
    return `${host}#${longest}`;
  }
  const segments = rest.split("/").filter(Boolean);
  return segments.length ? `${host}#${segments[segments.length - 1]}` : host;
}

const ROLE_PREFIXES = [
  "oud-",
  "oud ",
  "minister-president",
  "minister",
  "premier",
  "staatssecretaris",
  "burgemeester",
  "wethouder",
  "president",
  "woordvoerder van",
  "woordvoerder",
  "hoogleraar",
  "directeur",
  "voorzitter",
  "kamerlid",
  "prof.",
  "prof",
  "dr.",
  "dr",
  "mr.",
  "mr",
  "drs.",
  "drs",
  "ir.",
  "ir",
];

export interface ActorKeys {
  /** Canonical slug used for node ids */
  slug: string;
  /** All slugs to match other data on (incl. slug) */
  aliases: string[];
  /** Cleaned display name */
  display: string;
}

/**
 * Keys for a free-text actor name from the LLM ("Minister De Jonge", "RIVM (Rijksinstituut ...)").
 * Strips parentheticals (keeping an all-caps acronym as alias) and role prefixes.
 * With `person: true`, the last name token is added as alias ("mark-rutte" -> also "rutte"), matching
 * the surname aliases the backend stores in event_entities.aliases.
 */
export function actorKeys(name: string, options: { person?: boolean } = {}): ActorKeys {
  const aliases = new Set<string>();
  let display = name.trim();

  display = display.replace(/\(([^)]*)\)/g, (_, inner: string) => {
    const acronym = inner.trim();
    if (/^[A-Z0-9]{2,6}$/.test(acronym)) {
      aliases.add(slugify(acronym));
    }
    return " ";
  });
  display = display.replace(/\s+/g, " ").trim();

  let lowered = display.toLowerCase();
  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const prefix of ROLE_PREFIXES) {
      if (lowered.startsWith(prefix) && lowered.length > prefix.length) {
        const next = lowered.charAt(prefix.length);
        if (prefix.endsWith("-") || prefix.endsWith(" ") || next === " " || next === ".") {
          display = display.slice(prefix.length).replace(/^[\s.]+/, "");
          lowered = display.toLowerCase();
          stripped = true;
          break;
        }
      }
    }
  }

  const slug = slugify(display) || slugify(name);
  aliases.add(slug);
  if (options.person) {
    const tokens = slug.split("-").filter(Boolean);
    if (tokens.length > 1) {
      aliases.add(tokens[tokens.length - 1]);
    }
  }
  return { slug, aliases: Array.from(aliases).filter(Boolean), display: display || name.trim() };
}

/** FNV-1a 32-bit hash as base36 — short, stable ids for clues. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Deterministic pseudo-random generator (for seeded layouts). */
export function lcg(seed: number): () => number {
  let state = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => {
    state = (state * 48271) % 2147483647;
    return (state - 1) / 2147483646;
  };
}
