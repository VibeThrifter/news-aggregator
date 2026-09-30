"""Role triage for named entities in the news (Epic 12 "Wie is dit?", Story 12.6).

Decides WHO a name in the news is, from cues around its mentions in the article text and from the
LLM authority analysis:

- a title before the name        "wethouder Anouk Verbeek", "de Amerikaanse president Trump"
- a title inside the NER span    "Minister Hugo de Jonge" (spaCy sometimes includes it)
- an apposition after the name   "Jan Jansen, woordvoerder van Shell, zegt"
- a party after the name         "Jan Paternotte (D66)"
- a byline                       "Pomme Rademaker\\nredacteur Economie" (NOS article header)
- an age after the name          "Henk (61)"  -> private person
- the LLM authority analysis     authority_type / actual_role

Categories (priority order of the user): politicus, journalist, woordvoerder, bestuurder
("hoge piefen"), organisatie, expert, overig (public but less relevant), prive (never researched),
onbekend (no cue). Pure functions, no I/O.
"""

from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

POLITICUS = "politicus"
JOURNALIST = "journalist"
WOORDVOERDER = "woordvoerder"
BESTUURDER = "bestuurder"
ORGANISATIE = "organisatie"
EXPERT = "expert"
OVERIG = "overig"
PRIVE = "prive"
ONBEKEND = "onbekend"

PUBLIC_CATEGORIES: tuple[str, ...] = (
    POLITICUS,
    JOURNALIST,
    WOORDVOERDER,
    BESTUURDER,
    ORGANISATIE,
    EXPERT,
    OVERIG,
)
ROLE_CATEGORIES: tuple[str, ...] = (*PUBLIC_CATEGORIES, PRIVE, ONBEKEND)

# Tie-break between categories with the same cue score (the user's order of importance).
_CATEGORY_ORDER = {category: index for index, category in enumerate(ROLE_CATEGORIES)}

_LEXICON_WORDS: dict[str, tuple[str, ...]] = {
    POLITICUS: (
        "premier",
        "minister-president",
        "vicepremier",
        "minister",
        "staatssecretaris",
        "kamerlid",
        "tweede-kamerlid",
        "eerste-kamerlid",
        "senator",
        "europarlementarier",
        "europarlementslid",
        "eurocommissaris",
        "burgemeester",
        "locoburgemeester",
        "wethouder",
        "gedeputeerde",
        "statenlid",
        "raadslid",
        "gemeenteraadslid",
        "fractievoorzitter",
        "fractieleider",
        "partijleider",
        "partijvoorzitter",
        "lijsttrekker",
        "voorman",
        "voorvrouw",
        "politicus",
        "politica",
        "president",
        "vicepresident",
        "kanselier",
        "formateur",
        "informateur",
        "oppositieleider",
        "regeringsleider",
        "staatshoofd",
        "ambassadeur",
        "gouverneur",
        "dijkgraaf",
    ),
    JOURNALIST: (
        "journalist",
        "journaliste",
        "verslaggever",
        "verslaggeefster",
        "correspondent",
        "redacteur",
        "redactrice",
        "hoofdredacteur",
        "eindredacteur",
        "adjunct-hoofdredacteur",
        "columnist",
        "columniste",
        "commentator",
        "presentator",
        "presentatrice",
        "programmamaker",
        "documentairemaker",
        "onderzoeksjournalist",
        "fotojournalist",
        "nieuwslezer",
        "nieuwslezeres",
        "anchor",
        "recensent",
        "publicist",
        "reporter",
    ),
    WOORDVOERDER: (
        "woordvoerder",
        "woordvoerster",
        "persvoorlichter",
        "voorlichter",
        "voorlichtster",
        "zegsman",
        "zegsvrouw",
        "spokesperson",
        "persofficier",
        "perschef",
    ),
    BESTUURDER: (
        "ceo",
        "cfo",
        "coo",
        "cto",
        "topman",
        "topvrouw",
        "directeur",
        "directrice",
        "bestuursvoorzitter",
        "bestuurder",
        "bestuurslid",
        "topbestuurder",
        "voorzitter",
        "vicevoorzitter",
        "president-directeur",
        "oprichter",
        "medeoprichter",
        "secretaris-generaal",
        "directeur-generaal",
        "topambtenaar",
        "lobbyist",
        "bankier",
        "grootaandeelhouder",
        "investeerder",
        "korpschef",
        "hoofdcommissaris",
        "generaal",
        "luitenant-generaal",
        "commandant",
        "admiraal",
        "rector",
        "commissaris",
    ),
    EXPERT: (
        "hoogleraar",
        "professor",
        "prof",
        "lector",
        "onderzoeker",
        "onderzoekster",
        "wetenschapper",
        "econoom",
        "hoofdeconoom",
        "analist",
        "deskundige",
        "expert",
        "specialist",
        "strateeg",
        "beleggingsstrateeg",
        "epidemioloog",
        "viroloog",
        "microbioloog",
        "klimaatwetenschapper",
        "klimatoloog",
        "meteoroloog",
        "historicus",
        "politicoloog",
        "socioloog",
        "criminoloog",
        "psycholoog",
        "psychiater",
        "jurist",
        "rechtsgeleerde",
        "staatsrechtgeleerde",
        "filosoof",
        "arts",
        "demograaf",
    ),
    OVERIG: (
        "advocaat",
        "advocate",
        "activist",
        "activiste",
        "schrijver",
        "schrijfster",
        "auteur",
        "zanger",
        "zangeres",
        "artiest",
        "acteur",
        "actrice",
        "rapper",
        "muzikant",
        "voetballer",
        "trainer",
        "coach",
        "bondscoach",
        "sporter",
        "schaatser",
        "wielrenner",
        "tennisser",
        "influencer",
        "kunstenaar",
        "cabaretier",
        "komiek",
        "ondernemer",
        "dominee",
        "imam",
        "rabbijn",
        "predikant",
        "bisschop",
        "paus",
        "koning",
        "koningin",
        "prins",
        "prinses",
        "rechter",
        "officier",
        "eigenaar",
        "blogger",
        "podcastmaker",
    ),
    PRIVE: (
        "bewoner",
        "bewoonster",
        "omwonende",
        "buurtbewoner",
        "buurman",
        "buurvrouw",
        "ooggetuige",
        "getuige",
        "slachtoffer",
        "verdachte",
        "nabestaande",
        "patient",
        "moeder",
        "vader",
        "zoon",
        "dochter",
        "broer",
        "zus",
        "opa",
        "oma",
        "leerling",
        "scholier",
        "student",
        "studente",
        "klant",
        "reiziger",
        "passagier",
        "automobilist",
        "fietser",
        "voetganger",
        "bezoeker",
        "vrijwilliger",
        "boer",
        "boerin",
        "agent",
        "huurder",
        "ouder",
        "echtgenote",
        "echtgenoot",
        "partner",
    ),
}
LEXICON: dict[str, str] = {
    word: category for category, words in _LEXICON_WORDS.items() for word in words
}
# Two-word titles (matched on the last two tokens before the name)
PHRASES: dict[str, str] = {
    "commissaris van de koning": POLITICUS,
    "algemeen directeur": BESTUURDER,
    "managing director": BESTUURDER,
    "raad van bestuur": BESTUURDER,
    "politiek verslaggever": JOURNALIST,
    "officier van justitie": OVERIG,
}
# Words that only occur in Dutch domestic politics (a person with such a cue is not foreign)
DOMESTIC_TITLES: frozenset[str] = frozenset(
    {
        "wethouder",
        "burgemeester",
        "locoburgemeester",
        "kamerlid",
        "tweede-kamerlid",
        "eerste-kamerlid",
        "gedeputeerde",
        "statenlid",
        "raadslid",
        "gemeenteraadslid",
        "dijkgraaf",
        "staatssecretaris",
        "formateur",
        "informateur",
    }
)
# Modifiers allowed between a title and the name or before the title
MODIFIERS: frozenset[str] = frozenset(
    {
        "oud",
        "ex",
        "voormalig",
        "voormalige",
        "demissionair",
        "demissionaire",
        "interim",
        "waarnemend",
        "waarnemende",
        "kersverse",
        "nieuwe",
        "vorige",
        "huidige",
        "toenmalig",
        "toenmalige",
        "de",
        "het",
        "een",
    }
)
PARTIES: frozenset[str] = frozenset(
    {
        "vvd",
        "pvv",
        "cda",
        "d66",
        "gl",
        "groenlinks",
        "pvda",
        "gl-pvda",
        "groenlinks-pvda",
        "sp",
        "pvdd",
        "cu",
        "christenunie",
        "sgp",
        "denk",
        "fvd",
        "ja21",
        "volt",
        "bbb",
        "nsc",
        "50plus",
        "bij1",
        "bvnl",
    }
)
# Titles that in Dutch news refer to foreign heads of state/government (the Netherlands has no
# president or chancellor; "president-directeur" and "president van DNB" are other cues)
FOREIGN_HEAD_TITLES: frozenset[str] = frozenset({"president", "vicepresident", "kanselier"})
FOREIGN_DEMONYMS: frozenset[str] = frozenset(
    {
        "amerikaanse",
        "russische",
        "britse",
        "engelse",
        "duitse",
        "franse",
        "chinese",
        "oekraiense",
        "israelische",
        "palestijnse",
        "iraanse",
        "turkse",
        "belgische",
        "vlaamse",
        "waalse",
        "spaanse",
        "italiaanse",
        "poolse",
        "hongaarse",
        "japanse",
        "indiase",
        "braziliaanse",
        "canadese",
        "australische",
        "zweedse",
        "noorse",
        "deense",
        "finse",
        "griekse",
        "oostenrijkse",
        "zwitserse",
        "portugese",
        "ierse",
        "schotse",
        "syrische",
        "libanese",
        "egyptische",
        "saoedische",
        "qatarese",
        "venezolaanse",
        "argentijnse",
        "mexicaanse",
        "wit-russische",
        "georgische",
        "servische",
        "kroatische",
        "roemeense",
        "bulgaarse",
        "tsjechische",
        "slowaakse",
        "zuid-afrikaanse",
        "noord-koreaanse",
        "zuid-koreaanse",
        "taiwanese",
        "afghaanse",
        "pakistaanse",
        "irakese",
        "jordaanse",
        "marokkaanse",
        "algerijnse",
        "tunesische",
        "nigeriaanse",
        "keniaanse",
        "ethiopische",
        "sudanese",
        "jemenitische",
        "armeense",
        "azerbeidzjaanse",
        "kazachse",
        "estse",
        "letse",
        "litouwse",
        "sloveense",
        "moldavische",
        "cubaanse",
        "colombiaanse",
        "chileense",
        "peruaanse",
        "indonesische",
        "vietnamese",
        "thaise",
        "filipijnse",
    }
)

# LLM authority_type/actual_role keywords -> category (first match wins, checked in order)
_AUTHORITY_HINTS: tuple[tuple[str, str], ...] = (
    ("woordvoer", WOORDVOERDER),
    ("journalist", JOURNALIST),
    ("redactie", JOURNALIST),
    ("politic", POLITICUS),
    ("politie", BESTUURDER),
    ("minister", POLITICUS),
    ("kamerlid", POLITICUS),
    ("wethouder", POLITICUS),
    ("burgemeester", POLITICUS),
    ("partij", POLITICUS),
    ("ceo", BESTUURDER),
    ("directeur", BESTUURDER),
    ("bestuur", BESTUURDER),
    ("wetenschap", EXPERT),
    ("onderzoe", EXPERT),
    ("hoogleraar", EXPERT),
    ("deskundig", EXPERT),
    ("expert", EXPERT),
    ("econoom", EXPERT),
    ("analist", EXPERT),
    ("advocaat", OVERIG),
    ("activist", OVERIG),
    ("bewoner", PRIVE),
    ("burger", PRIVE),
    ("ooggetuige", PRIVE),
)
# Words in an authority_type or name that mark an organisation (for actor keys of unknown kind)
ORG_WORDS: tuple[str, ...] = (
    "bedrijf",
    "organisatie",
    "stichting",
    "ministerie",
    "overheid",
    "instituut",
    "instantie",
    "raad",
    "groep",
    "vereniging",
    "ngo",
    "partij",
    "bank",
    "universiteit",
    "hogeschool",
    "omroep",
    "krant",
    "media",
    "agentschap",
    "autoriteit",
    "toezichthouder",
    "adviesorgaan",
    "rechtbank",
    "gemeente",
    "provincie",
    "waterschap",
    "fonds",
    "federatie",
    "bond",
    "unie",
    "commissie",
    "college",
    "planbureau",
    "centrum",
    "coalitie",
    "platform",
    "concern",
    "holding",
    "b.v.",
    "n.v.",
    "bv",
    "nv",
    "inc",
    "ltd",
    "gmbh",
    "company",
    "corporation",
)

# Cue weights
W_BYLINE = 3.0
W_PARTY = 2.5
W_TITLE = 2.0
W_APPOSITION = 2.0
W_SPAN_TITLE = 2.0
W_AGE = 2.5
W_LLM = 1.5
W_PRIVATE_WORD = 1.5

_SENTENCE_BREAK = re.compile(r"[.!?;:\"“”«»\n]")
_TOKEN = re.compile(r"[\wÀ-ÿ'’-]+")
_APPOSITION = re.compile(
    r"^\s*,\s*(?:de\s+|het\s+|een\s+)?(?P<role>[a-zà-ÿ][\wà-ÿ-]*(?:\s+[a-zà-ÿ][\wà-ÿ-]*){0,3}?)"
    r"(?:\s+(?:van|bij|aan|namens|voor|in|op)\s+(?:de\s+|het\s+)?"
    r"(?P<org>[A-Z0-9][\w&.'’-]*(?:\s+(?:[A-Z0-9&][\w&.'’-]*|van|voor|de|en)){0,5}))?"
    r"\s*[,.;)]"
)
_PARENTHETICAL = re.compile(r"^\s*\((?P<inner>[^()\n]{1,20})\)")
_AGE = re.compile(r"^\d{1,3}$")


def fold(text: str) -> str:
    """Lowercase without diacritics ("Oekraïense" -> "oekraiense", "patiënt" -> "patient")."""

    normalized = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch)).lower()


def _clip(text: str, limit: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


@dataclass(frozen=True, slots=True)
class MentionContext:
    """Text around one mention of the entity in one article."""

    before: str
    after: str
    span: str = ""
    line_start: bool = False
    next_line: str | None = None  # the next line when the mention is alone on its line
    outlet: str | None = None


@dataclass(slots=True)
class RoleCue:
    category: str
    label: str
    weight: float
    evidence: str
    foreign: bool = False
    domestic: bool = False
    org: str | None = None


@dataclass(slots=True)
class RoleAssessment:
    category: str
    label: str | None
    evidence: list[str]
    is_foreign: bool
    confidence: float
    organisations: list[str] = field(default_factory=list)
    cues: list[RoleCue] = field(default_factory=list)

    @property
    def is_public(self) -> bool:
        return self.category in PUBLIC_CATEGORIES


def classify_word(word: str) -> str | None:
    """Category of a (possibly compound) title word: "VVD-Kamerlid", "oud-minister"."""

    folded = fold(word).strip("'’-")
    if not folded:
        return None
    if folded in LEXICON:
        return LEXICON[folded]
    if "-" in folded:
        head, _, tail = folded.rpartition("-")
        if tail in LEXICON:
            return LEXICON[tail]
        if head in LEXICON and head not in MODIFIERS:
            return LEXICON[head]
    return None


def _party_prefix(word: str) -> str | None:
    """ "VVD-Kamerlid" -> "VVD" (a Dutch party compound marks a politician)."""

    head, sep, _tail = word.partition("-")
    if sep and fold(head) in PARTIES:
        return head
    return None


def _trailing_tokens(before: str, limit: int = 5) -> list[str]:
    """Tokens of the last clause before the mention (stops at a sentence break)."""

    breaks = list(_SENTENCE_BREAK.finditer(before))
    clause = before[breaks[-1].end() :] if breaks else before
    return _TOKEN.findall(clause)[-limit:]


def cue_from_before(context: MentionContext) -> RoleCue | None:
    """A title directly before the name (modifiers and a demonym may sit in between)."""

    tokens = _trailing_tokens(context.before)
    if not tokens:
        return None
    folded = [fold(token) for token in tokens]
    # Two-word titles first ("commissaris van de koning", "politiek verslaggever")
    for size in (4, 2):
        if len(folded) >= size:
            phrase = " ".join(folded[-size:])
            if phrase in PHRASES:
                return RoleCue(
                    PHRASES[phrase],
                    " ".join(tokens[-size:]).lower(),
                    W_TITLE,
                    _clip(context.before[-80:] + context.span, 160),
                )
    # Walk back over at most 3 tokens: the title may be followed by a lowercase specification
    # ("hoogleraar economie Bas Jacobs") or preceded by modifiers.
    for back in range(1, min(4, len(tokens)) + 1):
        token = tokens[-back]
        category = classify_word(token)
        if category is None:
            if back == 1 and token[:1].isupper() and not _party_prefix(token):
                return None  # another name or organisation right before the mention
            continue
        previous = folded[-back - 1] if len(tokens) > back else ""
        foreign = previous in FOREIGN_DEMONYMS or fold(token) in FOREIGN_HEAD_TITLES
        party = _party_prefix(token)
        label = tokens[-back].lower() if not party else f"{party}-{token.partition('-')[2].lower()}"
        cue = RoleCue(
            POLITICUS if party else category,
            label,
            W_TITLE,
            _clip(context.before[-80:] + context.span, 160),
            foreign=foreign and not party,
            domestic=bool(party) or fold(token).split("-")[-1] in DOMESTIC_TITLES,
        )
        return cue
    return None


def cue_from_span(context: MentionContext) -> RoleCue | None:
    """A title that spaCy put inside the PERSON span ("Minister Hugo de Jonge")."""

    tokens = context.span.split()
    if len(tokens) < 2:
        return None
    category = classify_word(tokens[0])
    if category is None or category == PRIVE:
        return None
    party = _party_prefix(tokens[0])
    return RoleCue(
        POLITICUS if party else category,
        tokens[0].lower(),
        W_SPAN_TITLE,
        _clip(context.span, 160),
        foreign=not party and fold(tokens[0]) in FOREIGN_HEAD_TITLES,
        domestic=bool(party) or fold(tokens[0]).split("-")[-1] in DOMESTIC_TITLES,
    )


def cues_from_after(context: MentionContext) -> list[RoleCue]:
    """Party or age in parentheses, or an apposition ", woordvoerder van Shell,"."""

    cues: list[RoleCue] = []
    evidence = _clip(context.span + context.after[:100], 160)
    parenthetical = _PARENTHETICAL.match(context.after)
    if parenthetical:
        inner = parenthetical.group("inner").strip()
        if fold(inner) in PARTIES:
            cues.append(
                RoleCue(POLITICUS, f"politicus ({inner})", W_PARTY, evidence, domestic=True)
            )
        elif _AGE.match(inner):
            cues.append(RoleCue(PRIVE, f"({inner})", W_AGE, evidence))
    apposition = _APPOSITION.match(context.after)
    if apposition:
        role_words = apposition.group("role").split()
        org = (apposition.group("org") or "").strip() or None
        for word in role_words[:3]:
            category = classify_word(word)
            if category is None:
                continue
            if org and fold(word) in FOREIGN_HEAD_TITLES:
                category = BESTUURDER  # "president van De Nederlandsche Bank"
            label = " ".join(role_words)
            if org:
                label = f"{label} van {org}" if category != PRIVE else label
            cues.append(
                RoleCue(
                    category,
                    _clip(label, 80),
                    W_APPOSITION if category != PRIVE else W_PRIVATE_WORD,
                    evidence,
                    domestic=fold(word) in DOMESTIC_TITLES,
                    org=org if category != PRIVE else None,
                )
            )
            break
    return cues


def cue_from_byline(context: MentionContext) -> RoleCue | None:
    """NOS-style byline: the name alone on a line, the next line "redacteur Economie"."""

    if not context.line_start or not context.next_line:
        return None
    line = context.next_line.strip()
    if not line or len(line) > 60:
        return None
    first = line.split()[0]
    if classify_word(first) != JOURNALIST:
        return None
    label = line if not context.outlet else f"{line} ({context.outlet})"
    return RoleCue(
        JOURNALIST,
        _clip(label, 80),
        W_BYLINE,
        _clip(f"{context.span} — {line}", 160),
        org=context.outlet,
    )


def cues_from_authority(authority: Mapping[str, Any]) -> list[RoleCue]:
    """Cues from the LLM authority analysis (authority_type, actual_role)."""

    cues: list[RoleCue] = []
    actual_role = str(authority.get("actual_role") or "").strip()
    authority_type = str(authority.get("authority_type") or "").strip()
    for text in (actual_role, authority_type):
        if not text:
            continue
        folded = fold(text)
        category: str | None = None
        for token in _TOKEN.findall(text):
            category = classify_word(token)
            if category is not None:
                break
        if category is None:
            for hint, hint_category in _AUTHORITY_HINTS:
                if hint in folded:
                    category = hint_category
                    break
        if category is not None:
            cues.append(
                RoleCue(
                    category,
                    _clip(text, 80),
                    W_LLM,
                    _clip(f"{authority.get('authority') or ''}: {text}", 160),
                    domestic=any(word in folded for word in DOMESTIC_TITLES),
                )
            )
            break
    return cues


def infer_kind(name: str, authority_type: str | None = None) -> str:
    """person | org for a free-text actor name (LLM authorities have no NER kind)."""

    haystack = fold(f"{name} {authority_type or ''}")
    tokens = set(re.findall(r"[a-z0-9.]+", haystack))
    if any(word in tokens or (len(word) > 4 and word in haystack) for word in ORG_WORDS):
        return "org"
    words = name.split()
    if 2 <= len(words) <= 5 and all(
        w[:1].isupper()
        or fold(w) in {"van", "de", "der", "den", "ter", "ten", "het", "la", "le", "von", "da"}
        for w in words
    ):
        return "person"
    return "org" if name.isupper() else "person"


def assess_person(
    contexts: Iterable[MentionContext],
    authorities: Sequence[Mapping[str, Any]] = (),
) -> RoleAssessment:
    """Combine all cues of one person into a category, label and evidence."""

    cues: list[RoleCue] = []
    for context in contexts:
        for cue in (cue_from_byline(context), cue_from_span(context), cue_from_before(context)):
            if cue is not None:
                cues.append(cue)
        cues.extend(cues_from_after(context))
    for authority in authorities:
        cues.extend(cues_from_authority(authority))
    return _combine(cues)


def assess_organisation(authorities: Sequence[Mapping[str, Any]] = ()) -> RoleAssessment:
    """Organisations are always researchable; the label comes from the LLM analysis."""

    label = None
    evidence: list[str] = []
    for authority in authorities:
        text = str(authority.get("actual_role") or authority.get("authority_type") or "").strip()
        if text:
            label = _clip(text, 80)
            evidence.append(_clip(f"{authority.get('authority') or ''}: {text}", 160))
            break
    return RoleAssessment(ORGANISATIE, label, evidence, False, 1.0)


def _combine(cues: list[RoleCue]) -> RoleAssessment:
    if not cues:
        return RoleAssessment(ONBEKEND, None, [], False, 0.0)
    scores: dict[str, float] = defaultdict(float)
    for cue in cues:
        scores[cue.category] += cue.weight
    public = {category: score for category, score in scores.items() if category != PRIVE}
    if public:
        category = min(public, key=lambda c: (-public[c], _CATEGORY_ORDER[c]))
        score = public[category]
    else:
        category, score = PRIVE, scores[PRIVE]
    chosen = sorted((cue for cue in cues if cue.category == category), key=lambda cue: -cue.weight)
    label = chosen[0].label if chosen else None
    evidence: list[str] = []
    for cue in sorted(cues, key=lambda cue: (cue.category != category, -cue.weight)):
        if cue.evidence and cue.evidence not in evidence:
            evidence.append(cue.evidence)
        if len(evidence) == 3:
            break
    public_cues = [cue for cue in cues if cue.category != PRIVE]
    foreign_cues = [cue for cue in public_cues if cue.foreign]
    is_foreign = (
        bool(foreign_cues)
        and not any(cue.domestic for cue in public_cues)
        and len(foreign_cues) * 2 >= len(public_cues)
    )
    organisations: list[str] = []
    for cue in chosen:
        if cue.org and cue.org not in organisations:
            organisations.append(cue.org)
    return RoleAssessment(
        category,
        label,
        evidence,
        is_foreign,
        round(min(1.0, score / 4.0), 2),
        organisations,
        cues,
    )


__all__ = [
    "BESTUURDER",
    "EXPERT",
    "JOURNALIST",
    "MentionContext",
    "ONBEKEND",
    "ORGANISATIE",
    "OVERIG",
    "POLITICUS",
    "PRIVE",
    "PUBLIC_CATEGORIES",
    "ROLE_CATEGORIES",
    "RoleAssessment",
    "RoleCue",
    "WOORDVOERDER",
    "assess_organisation",
    "assess_person",
    "classify_word",
    "cue_from_before",
    "cue_from_byline",
    "cue_from_span",
    "cues_from_after",
    "cues_from_authority",
    "fold",
    "infer_kind",
]
