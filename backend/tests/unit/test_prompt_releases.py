"""Persberichten over dit nieuws in de analyse (Story 14.40)."""

from datetime import datetime, timezone

from backend.app.llm.prompt_builder import (
    RELEASE_NOTE,
    RELEASE_TEXT_CHARS,
    RELEASES_IN_PROMPT,
    ReleaseCapsule,
    _format_releases,
    _pick_releases,
    _with_releases,
)


def _release(title, *, quoted=False, topic=0.0, hour=9, text=None, sender="Openbaar Ministerie"):
    return ReleaseCapsule(
        title=title,
        sender=sender,
        url=f"https://www.om.nl/actueel/nieuws/{title.lower().replace(' ', '-')}",
        published_at=datetime(2026, 11, 16, hour, tzinfo=timezone.utc),
        text=text or f"{title}. Het OM meldt dat twee verdachten langer vast blijven.",
        quoted=quoted,
        topic=topic,
    )


def test_quoted_releases_first_then_the_best_topic_score():
    picked = _pick_releases(
        [
            _release("Laag", topic=0.31),
            _release("Hoog", topic=0.6),
            _release("Geciteerd", quoted=True),
        ]
    )
    assert [r.title for r in picked] == ["Geciteerd", "Hoog"][:RELEASES_IN_PROMPT]


def test_the_same_release_on_two_sites_once():
    text = "Vogelgriep vastgesteld in Oosterwolde. " * 20
    picked = _pick_releases(
        [
            _release("Vogelgriep Oosterwolde", topic=0.47, text=text, sender="NVWA"),
            _release(
                "Vogelgriep Oosterwolde ", topic=0.42, text=text, sender="Ministerie van LVVN"
            ),
        ]
    )
    assert [r.sender for r in picked] == ["NVWA"]


def test_a_release_without_text_is_left_out():
    assert _pick_releases([_release("Leeg", text="   ")]) == []


def test_the_block_names_sender_time_and_text_after_the_note():
    block = _format_releases([_release("Twee verdachten langer vast")])
    assert block.startswith(RELEASE_NOTE)
    assert 'Persbericht van Openbaar Ministerie: "Twee verdachten langer vast"' in block
    assert "Gepubliceerd: 2026-11-16T09:00:00+00:00" in block
    assert "twee verdachten langer vast blijven" in block


def test_a_long_release_is_clipped():
    long_text = "Dit is een zin over de zaak. " * 400
    block = _format_releases([_release("Lang", text=long_text)])
    body = block.split("Tekst:\n", 1)[1].split("\n   URL:", 1)[0]
    assert len(body) < RELEASE_TEXT_CHARS + 400


def test_no_releases_leaves_the_articles_as_they_are():
    assert _with_releases("1. Artikel", []) == "1. Artikel"
    assert _with_releases("1. Artikel", [_release("X")]).startswith("1. Artikel\n\nPersberichten:")
