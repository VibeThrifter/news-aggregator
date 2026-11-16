"""Onderzoek in opdracht van (Story 14.36): who paid for the research an article reports.

Articles often rest on a study, poll or report and say in one sentence who ordered it: "Onderzoek
van Ecorys in opdracht van MantelzorgNL raamt …", "De enquête is uitgevoerd door Q&A in opdracht
van Independer", "… in opdracht van deze site". Measured on 2026-11-16: 26 of 7,602 Dutch articles
of six weeks name the sponsor this way. The article states it itself, so it is a fact with a source:
the sentence is kept with it.

The extraction reads only sentences with "in opdracht van" and a word for research in them, and
takes the name after it: capitalized words, joined by van/voor/en/&, or a determiner with one
noun ("het kabinet", "het landbouwministerie", "de Canadese overheid"). "Deze site" or "deze
krant" is the outlet itself. No AI.
"""

from __future__ import annotations

import re
from typing import Any

# At most this many studies per article
MAX_PER_ARTICLE = 3
SENTENCE_CHARS = 300

_SENTENCE = re.compile(r"[^.!?\n]+(?:[.!?]+|$)")
_RESEARCH = re.compile(
    r"\b(?:onderzoek\w*|peiling\w*|enqu[eê]te\w*|studie\w*|rapport\w*|analyse\w*|survey\w*|"
    r"berekening\w*|becijfer\w*|steekproef|ondervraag\w*|panel\w*|adviesbureau\w*|poll\w*)\b",
    re.IGNORECASE,
)
_ORDERED_BY = re.compile(r"\bin\s+opdracht\s+van\s+", re.IGNORECASE)
# "onderzoek van Ecorys", "uitgevoerd door Q&A", "onderzoeksbureau Arcadis", "Panel Inzicht"
_RESEARCHER = re.compile(
    r"(?i:\b(?:onderzoek|peiling|enqu[eê]te|studie|analyse|rapport)\s+(?:van|door)"
    r"|\b(?:uitgevoerd|gedaan|verricht|opgesteld|gemaakt|becijferd)\s+door"
    r"|\b(?:onderzoeks|peilings|advies|marktonderzoeks)bureau)"
    r"\s+((?:[A-Z0-9][\w&'.-]*)(?:\s+(?:[A-Z0-9][\w&'.-]*|&|van|de|der|for|of|voor))*)"
)
_TOKEN = re.compile(r"[\w&'’.-]+|[,;:()]")
_DETERMINERS = {"het", "de", "een", "deze", "dit", "die", "dat", "hun", "zijn", "haar"}
_LEAD = {"onder", "meer", "andere", "anderen", "onder andere"}
_CONNECTORS = {"van", "voor", "de", "der", "den", "het", "en", "&", "'t", "op", "in", "uit"}
# The outlet itself: "in opdracht van deze site", "… van deze krant"
_SELF = re.compile(
    r"^(?:deze|onze|dit|de)\s+(?:site|krant|nieuwssite|website|redactie|omroep|programma|medium)$",
    re.IGNORECASE,
)


_COMMA = ","
# "de toenmalige staatssecretaris", "het voormalige ministerie van …"
_TIME_ADJECTIVES = {"toenmalige", "voormalige", "huidige", "vorige", "nieuwe", "vroegere"}
# "in opdracht van een onbekende": nobody is named
_UNNAMED = {"onbekende", "onbekenden", "anonieme", "anoniem"}


def _is_name(token: str) -> bool:
    return bool(token) and (token[0].isupper() or token[0].isdigit())


def sponsor_after(text: str) -> str | None:
    """The sponsor named at the start of ``text`` (the words after "in opdracht van")."""

    tokens = _TOKEN.findall(text[:200])
    taken: list[str] = []
    i = 0
    while i < len(tokens) and tokens[i].lower() in _LEAD:
        i += 1
    noun_allowed = False
    while i < len(tokens):
        token = tokens[i]
        lower = token.lower()
        if not taken and lower in _DETERMINERS:
            taken.append(lower)
            noun_allowed = True
        elif _is_name(token):
            # "de Canadese overheid": a noun may still follow an adjective right after the
            # determiner; after a name ("de Jagersvereniging verrichtte") it is a verb
            noun_allowed = noun_allowed and len(taken) == 1 and token.lower().endswith("e")
            taken.append(token.rstrip("."))
        elif noun_allowed and token[0].isalpha() and lower not in _CONNECTORS:
            # "het kabinet", "de Canadese overheid": one noun after a determiner; after "de
            # toenmalige" the noun still follows ("de toenmalige staatssecretaris")
            taken.append(token.rstrip("."))
            noun_allowed = lower in _TIME_ADJECTIVES
        elif lower in _CONNECTORS and taken and taken[-1] not in _CONNECTORS:
            # "ministerie van Volksgezondheid", "Natuur & Milieu": only when a name follows
            nxt = tokens[i + 1] if i + 1 < len(tokens) else ""
            if not (_is_name(nxt) or nxt.lower() in _DETERMINERS):
                break
            taken.append(lower)
        elif token == _COMMA and taken and i + 1 < len(tokens) and _is_name(tokens[i + 1]):
            # "het Rijk, VNG en Aedes": a list of names
            taken.append(",")
        else:
            break
        i += 1
    while taken and (taken[-1] in _CONNECTORS or taken[-1] in _DETERMINERS or taken[-1] == ","):
        taken.pop()
    if not taken or all(word in _DETERMINERS or word in _TIME_ADJECTIVES for word in taken):
        return None
    if any(word.lower() in _UNNAMED for word in taken):
        return None
    sponsor = " ".join(taken).replace(" ,", ",")
    return sponsor[:120] if len(sponsor) >= 2 else None


def researcher_before(sentence: str) -> str | None:
    """Who did the research, when the sentence names it before "in opdracht van"."""

    match = None
    for found in _RESEARCHER.finditer(sentence):
        match = found
    if not match:
        return None
    name = re.sub(r"(?:\s+(?:in|van|de|der|&|for|of|voor))+$", "", match.group(1).strip())
    return name[:120] or None


def sponsored_research(text: str | None) -> list[dict[str, Any]]:
    """The studies whose sponsor the text names: sponsor, researcher (or None), the sentence, and
    whether the sponsor is the outlet itself."""

    found: list[dict[str, Any]] = []
    seen: set[str] = set()
    for match in _SENTENCE.finditer(text or ""):
        sentence = " ".join(match.group(0).split())
        ordered = _ORDERED_BY.search(sentence)
        if not ordered or not _RESEARCH.search(sentence):
            continue
        sponsor = sponsor_after(sentence[ordered.end() :])
        if not sponsor or sponsor.lower() in seen:
            continue
        seen.add(sponsor.lower())
        found.append(
            {
                "sponsor": sponsor,
                "researcher": researcher_before(sentence[: ordered.start()]),
                "sentence": sentence[:SENTENCE_CHARS],
                "self": bool(_SELF.match(sponsor)),
            }
        )
        if len(found) == MAX_PER_ARTICLE:
            break
    return found
