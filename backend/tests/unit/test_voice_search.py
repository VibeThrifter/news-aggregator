"""Story 14.10: the AI search for a voice that is missing (Stemmen zoeken).

The LLM, Google News and the publishers' pages are stubbed: these tests cover what the service
decides (which candidates, which verdicts are kept, when the planned queries run) and the queue
loop. The SQL of the queue is checked against PostgreSQL by hand (migration 009 test).
"""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any

import pytest

from backend.app.services import voice_search as vs
from backend.app.services.voice_search import (
    EventContext,
    SearchPlan,
    VerdictBatch,
    VoiceSearchJob,
    VoiceSearchService,
    copy_key,
    country_of,
    readable_text,
)

LONG = "De boeren in de polder zeggen dat niemand hen iets vroeg. " * 20


class StubLLM:
    """Answers the plan and the check; records the prompts."""

    def __init__(self, plan: SearchPlan, verdicts: list[list[dict[str, Any]]]) -> None:
        self.plan = plan
        self.verdicts = list(verdicts)
        self.prompts: list[str] = []

    async def generate_json(self, prompt: str, schema, **_: Any):
        self.prompts.append(prompt)
        if schema is SearchPlan:
            return SimpleNamespace(payload=self.plan, usage=None)
        results = self.verdicts.pop(0) if self.verdicts else []
        return SimpleNamespace(payload=VerdictBatch(results=results), usage=None)


def context(**extra: Any) -> EventContext:
    return EventContext(
        id=7,
        title="Windpark Dijkerhoven mag er komen",
        summary="De gemeente geeft groen licht voor een windpark in de polder.",
        start=datetime(2026, 9, 28, 6, 0, tzinfo=timezone.utc),
        article_ids=[1],
        urls={vs.norm_url("https://nos.nl/artikel/1")},
        outlets=["NOS"],
        dutch_outlets=["NOS"],
        **extra,
    )


JOB = VoiceSearchJob(
    id=3,
    event_id=7,
    perspective="Boeren op de polder",
    context=None,
    origin="analyse",
    gap_key="gap:abc",
)


def service(
    llm: StubLLM,
    *,
    own: list[dict[str, Any]],
    google: dict[str, list[dict[str, Any]]],
    texts: dict[str, str | None],
):
    calls: list[str] = []

    async def google_search(query: str, _context: EventContext, limit: int):
        calls.append(query)
        return [dict(item) for item in google.get(query, [])][:limit]

    async def fetch_text(url: str):
        return texts.get(url)

    svc = VoiceSearchService(llm=llm, google_search=google_search, fetch_text=fetch_text)

    async def load_context(_job):
        return context()

    async def own_articles(*_args):
        return [dict(item) for item in own]

    svc.load_context = load_context  # type: ignore[method-assign]
    svc.own_articles = own_articles  # type: ignore[method-assign]
    return svc, calls


def hit(article: str, confidence: float = 0.9, **extra: Any) -> dict[str, Any]:
    return {
        "article": article,
        "same_news": True,
        "voiced": True,
        "own_voice": True,
        "who": "Gerrit Hofstede, boer",
        "gist": "Hij wil meepraten over de plek van de turbines.",
        "confidence": confidence,
        **extra,
    }


def gnews(url: str, outlet: str = "Trouw") -> dict[str, Any]:
    return {
        "outlet": outlet,
        "title": "Boeren in de polder",
        "url": url,
        "published_at": "2026-09-29T05:30:00+00:00",
        "text": "",
        "basis": "title",
    }


def test_text_helpers():
    assert readable_text(None) == ""
    assert readable_text("kort") == ""
    assert readable_text("Dit artikel is alleen voor abonnees. " * 8) == ""
    assert readable_text(LONG) == LONG
    assert copy_key("ANP — Het kabinet wil...") == copy_key("ANP  het kabinet wil")
    assert country_of("https://www.trouw.nl/x") == ("NL", False)
    assert country_of("https://www.vrt.be/x") == ("BE", True)
    assert country_of("https://www.reuters.com/x") == (None, False)


async def test_keeps_only_the_voice_itself_about_the_same_news():
    plan = SearchPlan(kind="concreet", event_terms=["Dijkerhoven", "windpark"], event_query="windpark Dijkerhoven", queries=["boeren windpark Dijkerhoven"])
    llm = StubLLM(
        plan,
        [
            [
                hit("a1"),
                hit("a2", own_voice=False),  # someone talking about the farmers
                hit("a3", same_news=False),
                hit("a4", confidence=0.6),  # not sure enough
            ]
        ],
    )
    svc, calls = service(
        llm,
        own=[{"outlet": "RTL Nieuws", "title": "Boer over windpark", "url": "https://www.rtl.nl/a", "published_at": None, "text": LONG, "basis": "db"}],
        google={"windpark Dijkerhoven": [gnews("https://www.trouw.nl/b"), gnews("https://www.ad.nl/c", "AD"), gnews("https://www.bd.nl/d", "BD")]},
        texts={
            "https://www.trouw.nl/b": LONG.replace("boeren", "politici"),
            "https://www.ad.nl/c": LONG + " anders",
            "https://www.bd.nl/d": "boeren " + LONG + " nog anders",
        },
    )
    outcome = await svc.search(JOB)

    assert [c["url"] for c in outcome.candidates] == ["https://www.rtl.nl/a"]
    found = outcome.candidates[0]
    assert found["verdict"] == "open" and found["article_id"] is None
    assert found["who"] == "Gerrit Hofstede, boer" and found["confidence"] == 0.9
    assert (found["country"], found["is_international"], found["domain"]) == ("NL", False, "rtl.nl")
    # A and D found something to check: the planned queries (B) were not needed
    assert calls == ["windpark Dijkerhoven"]
    assert outcome.stats["kept"] == 1
    # The check reads the voice and the news, and is told the texts are material
    assert "ONTBREKEND PERSPECTIEF: Boeren op de polder" in llm.prompts[-1]
    assert "geen opdracht" in llm.prompts[-1]


async def test_the_planned_queries_run_only_when_nothing_was_kept_for_a_concrete_voice():
    plan = SearchPlan(kind="concreet", event_terms=["windpark"], event_query="", queries=["boeren windpark", "LTO windpark"])
    llm = StubLLM(plan, [[hit("a1")]])
    svc, calls = service(
        llm,
        own=[],
        google={"boeren windpark": [gnews("https://www.trouw.nl/b")]},
        texts={"https://www.trouw.nl/b": LONG},
    )
    outcome = await svc.search(JOB)
    assert calls == ["boeren windpark", "LTO windpark"]
    assert [c["url"] for c in outcome.candidates] == ["https://www.trouw.nl/b"]
    assert outcome.candidates[0]["strategy"] == "B"

    # A general category ("experts") does not get the extra queries
    llm2 = StubLLM(plan.model_copy(update={"kind": "generiek"}), [])
    svc2, calls2 = service(llm2, own=[], google={}, texts={})
    outcome2 = await svc2.search(JOB)
    assert calls2 == [] and outcome2.candidates == []


async def test_never_judges_a_headline_alone_and_drops_agency_copies():
    plan = SearchPlan(kind="generiek", event_terms=["windpark"], event_query="windpark Dijkerhoven")
    llm = StubLLM(plan, [[hit("a1"), hit("a2")]])
    svc, _ = service(
        llm,
        own=[],
        google={
            "windpark Dijkerhoven": [
                gnews("https://www.nu.nl/a", "NU.nl"),  # behind a wall: only the headline
                gnews("https://www.trouw.nl/b", "Trouw"),
                gnews("https://www.parool.nl/c", "Parool"),  # the same ANP text as Trouw
                gnews("https://nos.nl/artikel/1", "NOS"),  # already in the news
            ]
        },
        texts={
            "https://www.nu.nl/a": "Word abonnee om verder te lezen over boeren.",
            "https://www.trouw.nl/b": "ANP: " + LONG,
            "https://www.parool.nl/c": "ANP: " + LONG,
            "https://nos.nl/artikel/1": LONG,
        },
    )
    outcome = await svc.search(JOB)
    assert [c["outlet"] for c in outcome.candidates] == ["Trouw"]
    assert outcome.stats["checked"] == 1
    check = llm.prompts[-1]
    assert "Trouw" in check and "NU.nl" not in check and "Parool" not in check


async def test_run_pending_marks_each_search_done_or_failed(monkeypatch):
    jobs = [
        VoiceSearchJob(id=1, event_id=7, perspective="Boeren", context=None, origin="analyse", gap_key=None),
        VoiceSearchJob(id=2, event_id=7, perspective="Jongeren", context=None, origin="eigen", gap_key="own:x"),
        VoiceSearchJob(id=3, event_id=7, perspective="Juristen", context=None, origin="analyse", gap_key=None),
    ]
    finished: list[tuple[int, str, int, str | None]] = []
    svc = VoiceSearchService(llm=StubLLM(SearchPlan(), []), google_search=None)

    async def ready():
        return True

    async def stale():
        return 0

    async def claim():
        return jobs.pop(0) if jobs else None

    async def finish(job_id, status, candidates, _stats, reason):
        finished.append((job_id, status, len(candidates), reason))

    async def search(job):
        if job.id == 2:
            raise RuntimeError("LLM 402 Payment Required")
        found = [{"id": "c1"}] if job.id == 1 else []
        return vs.SearchOutcome(found, {})

    monkeypatch.setattr(svc, "table_ready", ready)
    monkeypatch.setattr(svc, "fail_stale", stale)
    monkeypatch.setattr(svc, "claim", claim)
    monkeypatch.setattr(svc, "finish", finish)
    monkeypatch.setattr(svc, "search", search)

    stats = await svc.run_pending(limit=5)
    assert stats == {"ran": 3, "found": 1, "nothing": 1, "failed": 1, "stale": 0}
    assert finished == [
        (1, "klaar", 1, None),
        (2, "fout", 0, "LLM 402 Payment Required"),
        (3, "niets_gevonden", 0, None),
    ]


async def test_run_pending_waits_for_the_migration(monkeypatch):
    svc = VoiceSearchService(llm=StubLLM(SearchPlan(), []))

    async def not_ready():
        return False

    monkeypatch.setattr(svc, "table_ready", not_ready)
    stats = await svc.run_pending(limit=2)
    assert stats["ran"] == 0 and "009" in stats["skipped"]


@pytest.mark.parametrize(
    ("query", "expected"),
    [("", []), ("   ", [])],
)
async def test_google_search_ignores_empty_queries(query, expected):
    assert await vs.GoogleNewsSearch().search(query, context(), 3) == expected
