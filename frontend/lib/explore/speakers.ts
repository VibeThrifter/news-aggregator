/**
 * Who speaks in this news (Epic 14 "Wie zegt wat?"): the people and organisations an outlet gives
 * the word to, parsed from the free-text sources of the analysis.
 *
 * `unsubstantiated_claims.source_in_article` is written by the LLM and comes in many shapes:
 * "Jan-Willem van den Beukel (Vemobin)", "NU.nl (eigen bewering)", "Max Verstappen (geciteerd via
 * NU.nl)", "Tina Nijkamp via De Telegraaf", "Benjamin Netanyahu, premier van Israël",
 * "NieuwRechts (introductie) / Frits Bosch", "bronnen rond de ploeg (anoniem)". An outlet speaking
 * for itself is not a speaker: its claim hangs on the outlet. Media and agencies it leans on become
 * a "via" tag. Speakers are merged with `authority_analysis` (role, interests). Pure.
 */

import type { EventEntity } from "@/lib/types";

import { isPersonAuthority } from "./findings";
import { ArticleIndex } from "./input";
import { findOutletByName } from "./media-landscape";
import { actorKeys, slugify } from "./normalize";
import type { ExploreInput, Finding } from "./types";

export type SpeakerKind = "person" | "org" | "group" | "anonymous";

export interface Speaker {
  /** `<outletKey>:<slug>`: one speaker per outlet that gives them the word */
  id: string;
  /** Actor slug (as used by the entity panel and the board) */
  slug: string;
  name: string;
  /** Function or kind ("minister", "belangenbehartiger energiebedrijven") */
  role: string | null;
  /** Organisation in brackets ("Vemobin") */
  org: string | null;
  kind: SpeakerKind;
  outletKey: string;
  /** Through which medium the outlet quotes them ("via NU.nl", "via Page Six") */
  via: string | null;
  claimIds: string[];
  authorityId: string | null;
  /** The analysis names interests, or calls the party not independent */
  interest: boolean;
  entityKey: string | null;
  /** Added by the reader (own.ts): the id of their entry */
  ownId?: string;
  /** What they say: written down by the reader, or found by the AI search */
  quote?: string | null;
  /** A missing voice that an AI search found in this outlet (approved): what was searched for */
  found?: { perspective: string; articleId: number; gapKey: string | null };
}

export type ClaimAnchor = { kind: "speaker"; id: string } | { kind: "outlet"; key: string };

export interface SpeakerModel {
  speakers: Speaker[];
  byId: Map<string, Speaker>;
  byOutlet: Map<string, Speaker[]>;
  /** Claims an outlet makes itself (or attributes to nobody), per outlet */
  ownClaims: Map<string, string[]>;
  /** Media and press agencies an outlet leans on, per outlet ("ANP", "Reuters") */
  via: Map<string, string[]>;
  /** Where a claim hangs: on a speaker or on an outlet */
  claimAnchor: Map<string, ClaimAnchor>;
}

export const ANONYMOUS = /\b(anoniem|anonieme|niet nader|naamloze?|niet bij naam|onbekende?|ingewijden?|bronnen rond|bronnen dicht)\b/i;
/** The outlet itself: "(eigen bewering)", "(redactie)", "(het medium zelf)", "(titel en lead)" */
const OWN_NOTE = /\b(eigen|redactie|het medium|medium zelf|titel|kop|lead|impliciet|als nieuwsmedium|liveblog|auteur|introductie|parafrase|weergave|samenvatting)\b/i;
/** Meta sources that are not a speaker at all */
const META = /\b(fase[- ]?1|factual summary|samenvatting|analyse)\b/i;
/** "via X", "geciteerd in/door/via X", "volgens X" */
const VIA = /\b(?:geciteerd\s+(?:in|door|via)|via|volgens)\s+([^,()]+)/i;
/** Text that only explains where the claim comes from: cut it off */
const TAIL = /\s+(?:op basis van|gebaseerd op|in een interview|met verwijzing|zonder vermelding|, zonder|, geciteerd|, gebaseerd)\b.*$/i;
/** Reporters of the outlet are the outlet's own voice */
const REPORTER = /\b(verslaggever|journalist|correspondent|redacteur|presentator|columnist)\b/i;
export const ORG_WORDS =
  /\b(ministerie|minister?ie|raad|commissie|instituut|bank|partij|organisatie|bureau|universiteit|gemeente|regering|kabinet|politie|ministerie|rechtbank|inspectie|dienst|stichting|vereniging|bond|federatie|agentschap|autoriteit|unie|navo|vn|eu|ggd|rivm|om|ministry|council|agency|group|media)\b/i;

interface ParsedSource {
  /** The outlet speaks for itself */
  own: boolean;
  anonymous: boolean;
  name: string;
  role: string | null;
  org: string | null;
  via: string | null;
}

function cleanVia(value: string): string {
  return value.replace(/\b(de|het|een)\s+(kop|titel|berichtgeving)\b.*$/i, "").trim();
}

/** Parse one part of `source_in_article` ("Name (Org)", "Name, role", "Outlet (eigen bewering)"). */
export function parseSourcePart(raw: string): ParsedSource | null {
  let text = raw.trim().replace(/^['"‘’“”]+|['"‘’“”]+$/g, "");
  if (!text || META.test(text)) return null;
  let via: string | null = null;
  let org: string | null = null;
  let own = false;
  const anonymous = ANONYMOUS.test(text);

  // Brackets: an own claim, a via, an acronym/organisation or a note
  text = text.replace(/\(([^)]*)\)/g, (_, inner: string) => {
    const note = inner.trim();
    const viaMatch = note.match(VIA);
    if (viaMatch) via = via ?? cleanVia(viaMatch[1]);
    else if (OWN_NOTE.test(note)) own = true;
    else if (!org && note && !ANONYMOUS.test(note) && note.split(/\s+/).length <= 6) org = note;
    return " ";
  });
  const viaInline = text.match(VIA);
  if (viaInline && viaInline.index !== undefined && viaInline.index > 0) {
    via = via ?? cleanVia(viaInline[1]);
    text = text.slice(0, viaInline.index);
  }
  text = text.replace(TAIL, "").replace(/\s+/g, " ").trim().replace(/[,;:]$/, "");

  let role: string | null = null;
  const comma = text.indexOf(",");
  if (comma > 0) {
    const after = text.slice(comma + 1).trim();
    if (after && after[0] === after[0].toLowerCase()) role = after;
    text = text.slice(0, comma).trim();
  }
  if (!text) return null;
  return { own, anonymous, name: text, role, org, via };
}

/** Initials for an avatar ("Jan-Willem van den Beukel" → "JB", "HCSS" → "HC"). */
export function initials(name: string): string {
  const words = name
    .replace(/[()'"]/g, " ")
    .split(/[\s-]+/)
    .filter((word) => word && word[0] === word[0].toUpperCase() && /\p{L}/u.test(word[0]));
  if (words.length === 0) return name.slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Entity lookup by alias slug, also on a shorter prefix ("van-weel-van-justitie" → "van-weel"). */
export function entityMatcher(entities: EventEntity[]) {
  const byAlias = new Map<string, EventEntity>();
  for (const entity of entities) {
    if (entity.kind !== "person" && entity.kind !== "org" && entity.kind !== "group") continue;
    for (const alias of [entity.entity_key.split(":").pop() ?? "", ...entity.aliases]) {
      if (alias && !byAlias.has(alias)) byAlias.set(alias, entity);
    }
  }
  return (name: string): EventEntity | null => {
    const tokens = slugify(actorKeys(name).display).split("-").filter(Boolean);
    for (let n = tokens.length; n >= 1; n -= 1) {
      const candidate = byAlias.get(tokens.slice(0, n).join("-"));
      if (candidate && (n >= 2 || tokens.length === 1)) return candidate;
    }
    return null;
  };
}

const ORG_SUFFIX = /(co[öo]peratie|raad|bond|vereniging|stichting|federatie|instituut|bureau|bank|partij|commissie|dienst|organisatie|monumenten|fonds|unie)$/i;
const PARTICLES = new Set(["van", "de", "der", "den", "ter", "ten", "het", "'t", "la", "le", "du", "von", "da", "dos", "bin", "al", "el"]);

/**
 * Person, organisation or group from a name alone (typed by a reader, or found by a search):
 * "Boeren uit de polder" is a group, "Jan de Vries" a person, "LTO" an organisation.
 */
export function guessSpeakerKind(name: string, entityKind?: string | null): SpeakerKind {
  const text = name.trim();
  if (entityKind === "person" || entityKind === "org" || entityKind === "group") return entityKind;
  if (ANONYMOUS.test(text)) return "anonymous";
  if (ORG_WORDS.test(text) || /^[A-Z0-9]{2,6}\b/.test(text)) return "org";
  // A role after the name ("Gerrit Hofstede, boer en verpachter") does not make it a group
  const words = text.split(",")[0].trim().split(/\s+/);
  // Dutch compounds: "Energiecoöperatie", "Dorpsraad", "Natuurmonumenten"
  if (words.some((word) => ORG_SUFFIX.test(word))) return "org";
  const lowerWord = words.slice(1).some((word) => word[0] === word[0].toLowerCase() && /\p{L}/u.test(word[0]) && !PARTICLES.has(word.toLowerCase()));
  if (text[0] === text[0].toLowerCase() || lowerWord) return "group";
  return words.length >= 2 ? "person" : "org";
}

export function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

/** Who speaks per outlet, which claims hang on whom, and which media an outlet leans on. */
export function buildSpeakers(input: ExploreInput, findings: Finding[], index: ArticleIndex = new ArticleIndex(input)): SpeakerModel {
  const model: SpeakerModel = {
    speakers: [],
    byId: new Map(),
    byOutlet: new Map(),
    ownClaims: new Map(),
    via: new Map(),
    claimAnchor: new Map(),
  };
  const dutch = input.outlets.filter((outlet) => !outlet.isInternational);
  const fallbackOutlet = dutch.length === 1 ? dutch[0].key : null;
  const matchEntity = entityMatcher(input.entities);

  const addVia = (outletKey: string, name: string) => {
    const list = model.via.get(outletKey) ?? [];
    const display = index.outlet(index.outletForName(name) ?? "")?.name ?? findOutletByName(name)?.name ?? name;
    if (!list.includes(display) && display !== index.outlet(outletKey)?.name) list.push(display);
    model.via.set(outletKey, list);
  };
  const addOwn = (outletKey: string, claimId: string) => {
    const list = model.ownClaims.get(outletKey) ?? [];
    list.push(claimId);
    model.ownClaims.set(outletKey, list);
    model.claimAnchor.set(claimId, { kind: "outlet", key: outletKey });
  };
  /** An outlet of this event, or a known medium elsewhere ("Variety") */
  const asMedium = (name: string): { eventOutlet: string | null; medium: boolean } => {
    const eventOutlet = index.outletForName(name);
    return { eventOutlet, medium: Boolean(eventOutlet || findOutletByName(name)) };
  };

  const upsert = (
    outletKey: string,
    parsed: ParsedSource,
    extra: { role?: string | null; person?: boolean; claimId?: string; authorityId?: string; interest?: boolean },
  ): Speaker => {
    const entity = parsed.anonymous ? null : matchEntity(parsed.name);
    const keys = actorKeys(entity?.name ?? parsed.name, { person: extra.person || entity?.kind === "person" });
    const slug = parsed.anonymous ? "anoniem" : keys.slug;
    const id = `${outletKey}:${slug}`;
    let speaker = model.byId.get(id);
    if (!speaker) {
      const lower = parsed.name[0] === parsed.name[0].toLowerCase();
      const kind: SpeakerKind = parsed.anonymous
        ? "anonymous"
        : entity?.kind === "person" || extra.person
          ? "person"
          : entity?.kind === "org" || ORG_WORDS.test(parsed.name) || /^[A-Z0-9]{2,6}$/.test(parsed.name)
            ? "org"
            : lower
              ? "group"
              : parsed.name.trim().split(/\s+/).length >= 2
                ? "person"
                : "org";
      // The role prefix actorKeys strips ("Minister", "Wethouder") is the role
      const removed = parsed.name.slice(0, Math.max(0, parsed.name.length - keys.display.length)).trim();
      speaker = {
        id,
        slug,
        name: parsed.anonymous ? "Anonieme bron" : capitalize(entity?.name ?? keys.display),
        role: extra.role ?? parsed.role ?? (removed && removed.length < 40 ? removed.toLowerCase() : null),
        org: parsed.org,
        kind,
        outletKey,
        via: parsed.via,
        claimIds: [],
        authorityId: null,
        interest: false,
        entityKey: entity?.entity_key ?? null,
      };
      model.byId.set(id, speaker);
      model.speakers.push(speaker);
      const list = model.byOutlet.get(outletKey) ?? [];
      list.push(speaker);
      model.byOutlet.set(outletKey, list);
    }
    if (extra.role && !speaker.role) speaker.role = extra.role;
    if (parsed.org && !speaker.org) speaker.org = parsed.org;
    if (parsed.via && !speaker.via) speaker.via = parsed.via;
    if (extra.claimId && !speaker.claimIds.includes(extra.claimId)) speaker.claimIds.push(extra.claimId);
    if (extra.authorityId) speaker.authorityId = speaker.authorityId ?? extra.authorityId;
    if (extra.interest) speaker.interest = true;
    return speaker;
  };

  // Authorities first: they carry the role and the interests
  for (const finding of findings) {
    if (finding.body.type !== "authority") continue;
    const authority = finding.body.authority;
    const outletKey = finding.body.outletKey ?? fallbackOutlet;
    if (!outletKey) continue;
    const parsed = parseSourcePart(authority.authority);
    if (!parsed) continue;
    const medium = asMedium(parsed.name);
    // The outlet itself, or one of its reporters, is not a speaker
    if (medium.eventOutlet || REPORTER.test(authority.authority_type ?? "")) continue;
    if (medium.medium) {
      addVia(outletKey, parsed.name);
      continue;
    }
    // Being paid by someone is no interest by itself (the RIVM is paid by a ministry): named
    // interests, or an analysis that calls the party not independent / an interested party
    const interest =
      (authority.potential_interests?.length ?? 0) > 0 ||
      /\bniet onafhankelijk|belanghebbend|eigen belang/i.test(authority.independence_check ?? "");
    upsert(outletKey, parsed, {
      role: authority.authority_type?.trim() || authority.actual_role?.trim() || null,
      person: isPersonAuthority(authority.authority_type),
      authorityId: finding.id,
      interest,
    });
  }

  // Claims: on the speaker who makes them, or on the outlet itself
  for (const finding of findings) {
    if (finding.body.type !== "claim") continue;
    const articleOutlet = finding.body.outletKey ?? fallbackOutlet;
    const parts = (finding.body.claim.source_in_article ?? "")
      .split(/\s+\/\s+|;/)
      .map((part) => parseSourcePart(part))
      .filter((part): part is ParsedSource => Boolean(part));
    let anchored = false;
    for (const parsed of parts) {
      const medium = asMedium(parsed.name);
      const viaOutlet = parsed.via ? index.outletForName(parsed.via) : null;
      if (medium.eventOutlet) {
        // "NU.nl (eigen bewering)", "NOS op basis van …": the outlet's own claim
        if (!anchored) addOwn(medium.eventOutlet, finding.id);
        anchored = true;
        continue;
      }
      const outletKey = viaOutlet ?? articleOutlet;
      if (!outletKey) continue;
      if (medium.medium) {
        // A medium elsewhere ("Variety", "Reuters"): the outlet leans on it
        addVia(outletKey, parsed.name);
        if (!anchored) addOwn(outletKey, finding.id);
        anchored = true;
        continue;
      }
      if (parsed.via && !viaOutlet) addVia(outletKey, parsed.via);
      const speaker = upsert(outletKey, parsed, { claimId: anchored ? undefined : finding.id });
      if (!anchored) model.claimAnchor.set(finding.id, { kind: "speaker", id: speaker.id });
      anchored = true;
    }
    if (!anchored && articleOutlet) addOwn(articleOutlet, finding.id);
  }

  // Missing voices an AI search found here (approved by the admin): they speak in that outlet
  for (const article of input.articles) {
    const found = article.foundVoice;
    if (!found) continue;
    const id = `${article.outletKey}:gevonden-${article.id}`;
    if (model.byId.has(id)) continue;
    const full = found.who ?? found.perspective;
    // "Gerrit Hofstede, boer en verpachter": the name, and the role after the comma
    const comma = full.indexOf(",");
    const name = comma > 0 ? full.slice(0, comma).trim() : full;
    const entity = matchEntity(name);
    const kind = guessSpeakerKind(full, entity?.kind);
    const speaker: Speaker = {
      id,
      slug: actorKeys(entity?.name ?? name, { person: kind === "person" }).slug || `gevonden-${article.id}`,
      name: capitalize(entity?.name ?? name),
      role: comma > 0 ? full.slice(comma + 1).trim() || null : null,
      org: null,
      kind,
      outletKey: article.outletKey,
      via: null,
      claimIds: [],
      authorityId: null,
      interest: false,
      entityKey: entity?.entity_key ?? null,
      quote: found.gist,
      found: { perspective: found.perspective, articleId: article.id, gapKey: found.gapKey },
    };
    model.byId.set(id, speaker);
    model.speakers.push(speaker);
    model.byOutlet.set(article.outletKey, [...(model.byOutlet.get(article.outletKey) ?? []), speaker]);
  }

  // Speakers with claims first, then those with interests
  for (const list of Array.from(model.byOutlet.values())) {
    list.sort(
      (a, b) =>
        Number(b.claimIds.length > 0) - Number(a.claimIds.length > 0) ||
        Number(b.interest) - Number(a.interest) ||
        Number(a.kind === "anonymous") - Number(b.kind === "anonymous"),
    );
  }
  return model;
}
