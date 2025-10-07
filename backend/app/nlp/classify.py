"""Event type classification for articles."""

from __future__ import annotations

from typing import Dict, List, Optional, Set

# Keywords for event type classification
EVENT_TYPE_KEYWORDS: Dict[str, Set[str]] = {
    "politics": {
        "kabinet", "minister", "kamer", "coalitie", "verkiezingen", "stemmen", "politiek",
        "regering", "oppositie", "partij", "fracty", "verkiezing", "debat", "wet", "parlementair"
    },
    "crime": {
        "politie", "arrestatie", "verdenking", "verdachte", "aanslag", "moord", "dood",
        "steekpartij", "geweld", "misdrijf", "rechtbank", "gevangenis", "cel", "tbs",
        "doodslag", "femicide", "inbraak", "overval", "schietpartij"
    },
    "sports": {
        "voetbal", "eredivisie", "europa league", "champions league", "f1", "formule",
        "verstappen", "ajax", "feyenoord", "psv", "tennis", "wielrennen", "olympisch",
        "wedstrijd", "coach", "trainer", "doelpunt", "kampioenschap", "competitie"
    },
    "international": {
        "trump", "rusland", "oekraïne", "poetin", "amerika", "china", "gaza", "israël",
        "oorlog", "vredesplan", "sancties", "navo", "europese unie", "brexit", "conflict"
    },
    "business": {
        "aex", "beurs", "aandeel", "bedrijf", "economie", "inflatie", "euro", "dollar",
        "investering", "overnam", "faillissement", "winst", "omzet", "ceo", "markt"
    },
    "entertainment": {
        "film", "muziek", "concert", "festival", "taylor swift", "album", "serie",
        "netflix", "acteur", "zanger", "artiest", "show", "award", "nominatie"
    },
    "weather": {
        "storm", "weer", "orkaan", "regen", "wind", "temperatuur", "knmi", "weerbericht",
        "code oranje", "code rood", "weersvoorspelling", "hagel", "onweer"
    },
    "royal": {
        "koning", "koningin", "prinses", "prins", "royal", "prinsenvlag", "alexia",
        "amalia", "máxima", "willem-alexander", "hof", "paleis"
    },
}


def classify_event_type(title: str, content: str, entities: Optional[List[Dict]] = None) -> str:
    """
    Classify article into an event type based on keywords and entities.

    Args:
        title: Article title
        content: Article content (first 1000 chars used)
        entities: Optional list of extracted entities

    Returns:
        Event type string: politics, crime, sports, international, business,
        entertainment, weather, royal, or "other"
    """
    # Combine title (weighted 3x) with content excerpt for classification
    text = (title.lower() + " " + title.lower() + " " + title.lower() + " " + content[:1000].lower())

    # Count keyword matches for each type
    type_scores: Dict[str, int] = {}

    for event_type, keywords in EVENT_TYPE_KEYWORDS.items():
        score = sum(1 for keyword in keywords if keyword in text)
        if score > 0:
            type_scores[event_type] = score

    # No keywords matched - try entity-based classification
    if not type_scores and entities:
        entity_types = {ent.get("label") for ent in entities if ent.get("label")}
        # GPE/LOC + no other strong signals = international
        if ("GPE" in entity_types or "LOC" in entity_types) and len(text.split()) > 50:
            return "international"

    # Return type with highest score, or "other" if no match
    if not type_scores:
        return "other"

    return max(type_scores.items(), key=lambda x: x[1])[0]


__all__ = ["classify_event_type", "EVENT_TYPE_KEYWORDS"]
