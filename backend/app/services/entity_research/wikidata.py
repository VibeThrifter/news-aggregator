"""Wikidata as a second opinion on who a name in the news is (Epic 12 "Wie is dit?").

The role triage reads cues around a name. When the news gives none ("de geroofde Kandinsky",
"Messi scoorde"), Wikidata can say what the person does. Only two verdicts count, both what the
pm agent nieuws-scout decides anyway: a person whose every occupation is in sport or the arts
(no office, no party), and a fictional character. Never "deceased": the propaganda model keeps
people of the past on purpose, and the oldest bearer of a name is often the only one in Wikidata
(measured 2026-10-16: "Maarten van Rossum" is the general of 1555). Two people with the name give
no verdict. Writers, presenters and directors stay (a column or a following is a place).

Public read-only API, no key, no AI.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx

from backend.app.services.entity_research.roles import NO_NETWORK_SUFFIX, fold

WIKIDATA_API = "https://www.wikidata.org/w/api.php"
# Wikimedia: a client without contact details in its User-Agent may make 10 requests a minute,
# with an e-mail address or URL 200 (mediawiki.org/wiki/Wikimedia_APIs/Rate_limits, 2026-10-19)
USER_AGENT = "NieuwsAggregator/1.0 (Wie is dit? role triage{contact})"
ANONYMOUS_INTERVAL_SECONDS = 6.5
CONTACT_INTERVAL_SECONDS = 0.5
SEARCH_LIMIT = 10

HUMAN = "Q5"
OCCUPATION = "P106"
INSTANCE_OF = "P31"
POSITION_HELD = "P39"
PARTY = "P102"

# English occupation labels (substring match); checked in this order
_KINDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "Sporter",
        (
            "football",
            "soccer",
            "player",
            "athlete",
            "cyclist",
            "racing",
            "formula one",
            "skater",
            "swimmer",
            "runner",
            "sprinter",
            "boxer",
            "golfer",
            "jockey",
            "darts",
            "rower",
            "gymnast",
            "judoka",
            "wrestler",
            "triathlete",
            "volleyball",
            "handball",
            "hockey",
            "coach",
            "sportsperson",
        ),
    ),
    (
        "Artiest",
        (
            "actor",
            "actress",
            "singer",
            "musician",
            "rapper",
            "composer",
            "guitarist",
            "pianist",
            "drummer",
            "violinist",
            "disc jockey",
            "record producer",
            "songwriter",
            "comedian",
            "cabaret",
            "dancer",
            "model",
            "conductor",
            "performing artist",
            "recording artist",
        ),
    ),
    ("Kunstenaar", ("painter", "sculptor", "printmaker", "illustrator", "artist")),
)
# An occupation with one of these words is a place in the network, whatever else it says
# ("sports journalist", "music director", "football executive")
_NETWORK_WORDS: tuple[str, ...] = (
    "journalist",
    "presenter",
    "commentator",
    "critic",
    "columnist",
    "executive",
    "official",
    "administrator",
    "director",
    "politician",
    "lobbyist",
    "businessperson",
    "entrepreneur",
    "activist",
)
_FICTION_WORDS: tuple[str, ...] = ("fictional", "character", "anthropomorphic")


class WikidataUnavailableError(RuntimeError):
    """Wikidata could not be reached or refused (rate limit): the next cycle tries again."""


@dataclass(frozen=True, slots=True)
class WikidataEntry:
    """One item whose label or alias is exactly the name."""

    qid: str
    description: str = ""
    human: bool = False
    fictional: bool = False
    occupations: tuple[str, ...] = ()
    offices: bool = False
    party: bool = False


@dataclass(frozen=True, slots=True)
class WikidataVerdict:
    qid: str | None
    # "Sporter zonder rol in het netwerk (Wikidata)"; None = no verdict, the triage decides
    reason: str | None = None
    description: str = ""
    occupations: tuple[str, ...] = ()

    def as_json(self, checked_at: datetime) -> dict[str, Any]:
        return {
            "qid": self.qid,
            "reason": self.reason,
            "description": self.description,
            "occupations": list(self.occupations),
            "checked_at": checked_at.isoformat(),
        }


def occupation_kind(label: str) -> str | None:
    """ "Sporter", "Artiest" or "Kunstenaar" for an occupation label; None for anything else."""

    text = label.lower()
    if not text or any(word in text for word in _NETWORK_WORDS):
        return None
    for kind, words in _KINDS:
        if any(word in text for word in words):
            return kind
    return None


def verdict(entries: Sequence[WikidataEntry]) -> WikidataVerdict:
    """The skip reason when Wikidata is sure; otherwise no verdict."""

    humans = [entry for entry in entries if entry.human]
    if len(humans) > 1:
        return WikidataVerdict(None)
    if not humans:
        fictional = next((entry for entry in entries if entry.fictional), None)
        if fictional is None:
            return WikidataVerdict(None)
        return WikidataVerdict(
            fictional.qid, "Verzonnen personage (Wikidata)", fictional.description
        )
    person = humans[0]
    kinds = [occupation_kind(label) for label in person.occupations]
    reason = None
    if kinds and all(kinds) and not person.offices and not person.party:
        reason = f"{kinds[0]} {NO_NETWORK_SUFFIX} (Wikidata)"
    return WikidataVerdict(person.qid, reason, person.description, person.occupations)


def _claim_ids(entity: Mapping[str, Any], prop: str) -> list[str]:
    ids: list[str] = []
    for claim in (entity.get("claims") or {}).get(prop) or []:
        value = ((claim.get("mainsnak") or {}).get("datavalue") or {}).get("value")
        if isinstance(value, dict) and isinstance(value.get("id"), str):
            ids.append(value["id"])
    return ids


def _text(values: Mapping[str, Any] | None) -> str:
    values = values or {}
    return str((values.get("nl") or values.get("en") or {}).get("value") or "")


def _same_name(name: str, hit: Mapping[str, Any]) -> bool:
    wanted = " ".join(fold(name).split())
    names = [hit.get("label") or "", *(hit.get("aliases") or [])]
    match = hit.get("match") or {}
    if match.get("type") in ("label", "alias"):
        names.append(match.get("text") or "")
    return any(" ".join(fold(str(value)).split()) == wanted for value in names)


class WikidataClient:
    """Exact-name lookup: search, claims of the hits, labels of their occupations and classes."""

    def __init__(
        self,
        base_url: str = WIKIDATA_API,
        *,
        contact: str = "",
        timeout: float = 15.0,
        min_interval: float | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = base_url
        self.contact = contact.strip()
        self.timeout = timeout
        self.min_interval = (
            min_interval
            if min_interval is not None
            else CONTACT_INTERVAL_SECONDS if self.contact else ANONYMOUS_INTERVAL_SECONDS
        )
        self._transport = transport
        self._labels: dict[str, str] = {}  # occupation/class labels hardly change: kept
        self._last_request = 0.0

    @property
    def user_agent(self) -> str:
        return USER_AGENT.format(contact=f"; {self.contact}" if self.contact else "")

    async def _get(self, client: httpx.AsyncClient, params: Mapping[str, str]) -> dict[str, Any]:
        wait = self._last_request + self.min_interval - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        self._last_request = time.monotonic()
        try:
            response = await client.get(self.base_url, params={**params, "format": "json"})
        except httpx.HTTPError as exc:
            raise WikidataUnavailableError(str(exc)) from exc
        if response.status_code != 200:
            raise WikidataUnavailableError(f"{response.status_code}")
        data = response.json()
        if "error" in data:
            raise WikidataUnavailableError(str(data["error"])[:200])
        return data

    async def _entities(
        self, client: httpx.AsyncClient, ids: Iterable[str], props: str
    ) -> dict[str, Any]:
        wanted = list(dict.fromkeys(ids))
        entities: dict[str, Any] = {}
        for start in range(0, len(wanted), 50):
            data = await self._get(
                client,
                {
                    "action": "wbgetentities",
                    "ids": "|".join(wanted[start : start + 50]),
                    "props": props,
                    "languages": "nl|en",
                },
            )
            entities.update(data.get("entities") or {})
        return entities

    async def lookup(self, name: str) -> list[WikidataEntry]:
        """Items whose label or alias is exactly ``name``; raises WikidataUnavailableError."""

        async with httpx.AsyncClient(
            headers={"User-Agent": self.user_agent, "Accept": "application/json"},
            timeout=self.timeout,
            transport=self._transport,
        ) as client:
            search = await self._get(
                client,
                {
                    "action": "wbsearchentities",
                    "search": name,
                    "language": "nl",
                    "uselang": "nl",
                    "type": "item",
                    "limit": str(SEARCH_LIMIT),
                },
            )
            ids = [hit["id"] for hit in search.get("search") or [] if _same_name(name, hit)]
            if not ids:
                return []
            entities = await self._entities(client, ids, "claims|descriptions")
            missing = {
                qid
                for entity in entities.values()
                for qid in (*_claim_ids(entity, OCCUPATION), *_claim_ids(entity, INSTANCE_OF))
                if qid not in self._labels
            }
            if missing:
                for qid, entity in (await self._entities(client, missing, "labels")).items():
                    labels = entity.get("labels") or {}
                    label = (labels.get("en") or labels.get("nl") or {}).get("value")
                    self._labels[qid] = str(label or "")
        entries: list[WikidataEntry] = []
        for qid in ids:
            entity = entities.get(qid)
            if not entity:
                continue
            classes = _claim_ids(entity, INSTANCE_OF)
            entries.append(
                WikidataEntry(
                    qid=qid,
                    description=_text(entity.get("descriptions")),
                    human=HUMAN in classes,
                    fictional=any(
                        word in self._labels.get(cls, "").lower()
                        for cls in classes
                        for word in _FICTION_WORDS
                    ),
                    occupations=tuple(
                        self._labels.get(occupation, occupation)
                        for occupation in _claim_ids(entity, OCCUPATION)
                    ),
                    offices=bool(_claim_ids(entity, POSITION_HELD)),
                    party=bool(_claim_ids(entity, PARTY)),
                )
            )
        return entries


__all__ = [
    "WikidataClient",
    "WikidataEntry",
    "WikidataUnavailableError",
    "WikidataVerdict",
    "occupation_kind",
    "verdict",
]
