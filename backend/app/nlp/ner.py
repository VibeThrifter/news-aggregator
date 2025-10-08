"""Named entity extraction helpers."""

from __future__ import annotations

import re
from typing import Dict, List, Optional, Sequence, TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover
    from spacy.language import Language
else:  # pragma: no cover
    Language = object  # type: ignore[assignment]

from backend.app.nlp import get_spacy_model

# Blacklist: Common Dutch news sites/platforms mislabeled as locations by NER
LOCATION_BLACKLIST = {
    "nu.nl", "nujij", "nos", "rtl nieuws", "ad", "telegraaf", "volkskrant",
    "trouw", "nrc", "nh nieuws", "omroep", "bnr", "rtv", "rijnmond",
}

# Known Dutch cities/provinces for location validation
KNOWN_DUTCH_LOCATIONS = {
    # Major cities
    "amsterdam", "rotterdam", "den haag", "'s-gravenhage", "utrecht", "eindhoven",
    "groningen", "tilburg", "almere", "breda", "nijmegen", "arnhem", "haarlem",
    "enschede", "apeldoorn", "amersfoort", "zaanstad", "hoofddorp", "maastricht",
    "leiden", "dordrecht", "zoetermeer", "zwolle", "deventer", "delft", "alkmaar",
    # Medium cities
    "venlo", "leeuwarden", "heerlen", "hilversum", "roosendaal", "purmerend",
    "oss", "schiedam", "spijkenisse", "vlaardingen", "alphen aan den rijn",
    "gouda", "katwijk", "nieuwegein", "veenendaal", "waalwijk", "harderwijk",
    "ede", "leidschendam", "voorburg", "emmen", "hoogeveen", "zeist",
    "terneuzen", "vlissingen", "middelburg", "goes", "helmond", "bergen op zoom",
    "roermond", "weert", "sittard", "geleen", "kerkrade",
    # Provinces
    "noord-holland", "zuid-holland", "zeeland", "noord-brabant", "limburg",
    "gelderland", "overijssel", "flevoland", "drenthe", "friesland",
    "utrecht", "groningen",
    # Common locations in news
    "schiphol", "tweede kamer", "den bosch", "'s-hertogenbosch", "markt", "centrum",
    # International (commonly mentioned)
    "brussel", "parijs", "berlijn", "londen", "washington", "moskou", "kiev",
    "gaza", "israël", "rusland", "oekraïne", "china", "amerika", "europa",
    "arabië", "azië", "afrika", "syrië", "turkije", "iran", "irak",
    # Caribbean Netherlands
    "bonaire", "saba", "sint eustatius", "curaçao", "aruba", "sint maarten",
    # Cities from visible articles
    "singapore", "bakoe", "monza", "zandvoort", "las vegas", "abu dhabi",
}


def _extract_locations_from_title(title: str) -> List[str]:
    """
    Extract known city names from title using regex pattern matching.

    This is a fallback for when NER misses cities in titles (e.g., "Terneuzen" in
    "Moeder en kind dood gevonden in woning Terneuzen").
    """
    if not title:
        return []

    title_lower = title.lower()
    found = []

    for city in KNOWN_DUTCH_LOCATIONS:
        # Match city name as whole word (with word boundaries)
        # This prevents partial matches like "dam" in "Amsterdam"
        pattern = rf'\b{re.escape(city)}\b'
        if re.search(pattern, title_lower):
            # Capitalize first letter for consistency
            found.append(city.capitalize())

    return found


class NamedEntityExtractor:
    """Extract named entities from Dutch news articles."""

    def __init__(
        self,
        *,
        model: "Language" | None = None,
        include_labels: Optional[Sequence[str]] = None,
    ) -> None:
        self._model = model
        self.include_labels = set(include_labels) if include_labels else None

    @property
    def nlp(self) -> "Language":
        if self._model is None:
            self._model = get_spacy_model()
        return self._model

    def extract(self, text: str) -> List[Dict[str, object]]:
        if not text:
            return []

        doc = self.nlp(text)
        entities: List[Dict[str, object]] = []
        for ent in doc.ents:
            if self.include_labels and ent.label_ not in self.include_labels:
                continue
            entities.append(
                {
                    "text": ent.text,
                    "label": ent.label_,
                    "start": ent.start_char,
                    "end": ent.end_char,
                }
            )
        return entities

    def extract_dates(self, text: str) -> List[str]:
        """Extract explicit date entities (DATE labels) from text."""
        if not text:
            return []

        doc = self.nlp(text)
        dates = []
        for ent in doc.ents:
            if ent.label_ == "DATE":
                dates.append(ent.text.strip())

        # Deduplicate while preserving order
        seen = set()
        return [d for d in dates if not (d.lower() in seen or seen.add(d.lower()))]

    def extract_locations(self, text: str, title: str = "") -> List[str]:
        """Extract location entities (GPE, LOC labels) from text, filtered for quality."""
        if not text:
            return []

        doc = self.nlp(text)
        locations = []
        for ent in doc.ents:
            if ent.label_ in ("GPE", "LOC"):  # GPE = countries/cities, LOC = non-GPE locations
                location_text = ent.text.strip()
                location_lower = location_text.lower()

                # Filter out blacklisted website names
                if location_lower in LOCATION_BLACKLIST:
                    continue

                # Only include if it's in known locations OR has multiple words (likely real location)
                # Single-word unknown locations are often NER errors
                is_known = location_lower in KNOWN_DUTCH_LOCATIONS
                is_multi_word = " " in location_text or "-" in location_text or "'" in location_text

                if is_known or is_multi_word:
                    locations.append(location_text)

        # Fallback: extract known cities from title (catches cases NER misses)
        if title:
            title_locations = _extract_locations_from_title(title)
            locations.extend(title_locations)

        # Deduplicate while preserving order
        seen = set()
        return [loc for loc in locations if not (loc.lower() in seen or seen.add(loc.lower()))]


def extract_entities(text: str) -> List[Dict[str, object]]:
    """Convenience wrapper using default extractor."""

    return NamedEntityExtractor().extract(text)
