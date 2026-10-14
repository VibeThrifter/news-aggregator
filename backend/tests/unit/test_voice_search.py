"""Story 14.10: the AI search for a voice that is missing (Stemmen zoeken).

The LLM, the search model, Google News and the publishers' pages are stubbed: these tests cover
what the service decides (which candidates, which verdicts are kept, when Google News and the
planned queries run) and the queue loop. The SQL of the queue is checked against PostgreSQL by hand
(migration 009 test).
"""

from __future__ import annotations

import json
import logging
from dataclasses import replace
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any

import pytest

from backend.app.core.scheduler import _QuietVoiceSearchLog
from backend.app.llm.web_search import WebAnswer, WebSearchError
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


class FailingLLM:
    """An LLM that is down (a limit, an outage)."""

    def __init__(self) -> None:
        self.calls = 0

    async def generate_json(self, _prompt: str, _schema, **_: Any):
        self.calls += 1
        raise RuntimeError("Gemini: limiet bereikt (429)")


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


class StubWeb:
    """The search model: answers with JSON in a code block and resolves its links from a table."""

    name = "gemini-search:test"

    def __init__(
        self,
        hits: list[dict[str, Any]] | None = None,
        *,
        links: dict[str, str] | None = None,
        error: str | None = None,
    ) -> None:
        self.hits = hits or []
        self.links = links or {}
        self.error = error
        self.prompts: list[str] = []

    async def search(self, prompt: str) -> WebAnswer:
        self.prompts.append(prompt)
        if self.error:
            raise WebSearchError(self.error)
        return WebAnswer(
            text="```json\n" + json.dumps({"results": self.hits}) + "\n```",
            queries=["boeren windpark Dijkerhoven"],
            ms=1200,
            usage={
                "promptTokenCount": 500,
                "toolUsePromptTokenCount": 1400,
                "candidatesTokenCount": 900,
                "thoughtsTokenCount": 2700,
            },
        )

    async def publisher_urls(self, _answer: WebAnswer, cited):
        return [self.links.get(link) for link in cited]


def service(
    llm: StubLLM,
    *,
    own: list[dict[str, Any]],
    google: dict[str, list[dict[str, Any]]],
    texts: dict[str, str | None],
    web: StubWeb | None = None,
):
    calls: list[str] = []

    async def google_search(query: str, _context: EventContext, limit: int):
        calls.append(query)
        return [dict(item) for item in google.get(query, [])][:limit]

    async def fetch_text(url: str):
        return texts.get(url)

    # No search model unless a test gives one (never the real one)
    svc = VoiceSearchService(
        llm=llm, web_search=web, google_search=google_search, fetch_text=fetch_text
    )

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


def web_hit(url: str, confidence: float = 0.9, **extra: Any) -> dict[str, Any]:
    return {
        "url": url,
        "outlet": "NL Vandaag",
        "title": "Boeren boos over windpark",
        "date": "2026-09-29",
        "who": "LTO Noord",
        "gist": "LTO Noord wil meepraten over de plek van de turbines.",
        "confidence": confidence,
        **extra,
    }


RTL = {
    "outlet": "RTL Nieuws",
    "title": "Boer over windpark",
    "url": "https://www.rtl.nl/a",
    "published_at": None,
    "text": LONG,
    "basis": "db",
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


def test_recognises_a_copy_of_an_article_in_the_news():
    headline = "SGP blokkeert komst regenboogvlag op gebouw Tweede Kamer"
    assert vs.title_key(f"{headline} - Headliner.nl") == vs.title_key(headline) != ""
    assert vs.title_key("Live - NOS") == ""
    news = replace(context(), outlets=["NOS", "NieuwRechts"], title_keys={vs.title_key(headline)})
    copy = "https://www.headliner.nl/item/sgp-blokkeert-komst-regenboogvlag-op-gebouw-tweede-kamer-nieuwrechts-23375"
    assert vs.is_copy(news, "https://www.headliner.nl/item/x", f"{headline} - Headliner.nl")
    assert vs.is_copy(news, copy, "Andere kop over de vlag")
    # The outlet's own site, an article about an outlet, a number at the end: no copy
    assert not vs.is_copy(news, "https://nieuwrechts.nl/x-y-nieuwrechts-23375", "Andere kop over de vlag")
    assert not vs.is_copy(news, "https://www.geenstijl.nl/5192449/kritiek-op-nos/", "Kritiek op de NOS")
    assert not vs.is_copy(news, "https://www.ad.nl/politiek/vlag-debat-2026", "Debat over de vlag")


async def test_a_copy_of_an_article_in_the_news_never_reaches_the_check():
    """Own articles and Google News: the same headline or the same agency text as an article of
    the news is no candidate (event 8786)."""
    headline = "Boeren tegen windpark Dijkerhoven in de polder"
    plan = SearchPlan(kind="generiek", event_terms=["windpark"], event_query="windpark Dijkerhoven")
    llm = StubLLM(plan, [[hit("a1")]])
    svc, _ = service(
        llm,
        own=[
            {
                "outlet": "RTL Nieuws",
                "title": "Boer over windpark",
                "url": "https://www.rtl.nl/a",
                "published_at": None,
                "text": LONG,
                "basis": "db",
            }
        ],
        google={
            "windpark Dijkerhoven": [
                {**gnews("https://www.headliner.nl/item/boeren", "Headliner.nl"), "title": headline},
                gnews("https://www.trouw.nl/b", "Trouw"),
            ]
        },
        texts={"https://www.headliner.nl/item/boeren": LONG, "https://www.trouw.nl/b": "ANP: " + LONG},
    )
    news = replace(
        context(),
        title_keys={vs.title_key(headline)},
        text_keys={copy_key("ANP: " + LONG)},
    )

    async def load_context(_job):
        return news

    svc.load_context = load_context  # type: ignore[method-assign]

    outcome = await svc.search(JOB)

    assert [c["url"] for c in outcome.candidates] == ["https://www.rtl.nl/a"]
    check = llm.prompts[-1]
    assert "Headliner" not in check and "Trouw" not in check


async def test_a_copy_of_an_article_in_the_news_is_no_find():
    """Event 8786: Headliner.nl repeated the NieuwRechts article that was in the news already and
    was shown as the missing voice."""
    headline = "Boeren tegen windpark Dijkerhoven in de polder"
    plan = SearchPlan(kind="context", event_terms=["windpark"], event_query="windpark Dijkerhoven")
    llm = StubLLM(plan, [[hit("a1")]])
    web = StubWeb(
        [
            web_hit("g1", outlet="Headliner.nl", title=f"{headline} - Headliner.nl"),
            web_hit("g2", outlet="Headliner.nl", title="Windpark: de boeren blijven boos"),
            web_hit("g3"),
        ],
        links={
            "g1": "https://www.headliner.nl/item/boeren-tegen-windpark",
            "g2": "https://www.headliner.nl/item/windpark-de-boeren-blijven-boos-nieuwrechts-23375",
            "g3": "https://www.nl-vandaag.nl/boeren",
        },
    )
    svc, _ = service(
        llm,
        own=[
            RTL,
            {**RTL, "url": "https://www.ad.nl/kopie", "outlet": "AD", "title": headline},
            {**RTL, "url": "https://www.parool.nl/anp", "outlet": "Parool", "text": "ANP: " + LONG},
        ],
        google={},
        texts={},
        web=web,
    )
    news = replace(
        context(),
        outlets=["NOS", "NieuwRechts"],
        titles=[("NOS", "Windpark Dijkerhoven mag er komen"), ("NieuwRechts", headline)],
        title_keys={vs.title_key(headline)},
        text_keys={copy_key("ANP: " + LONG)},
    )

    async def load_context(_job):
        return news

    svc.load_context = load_context  # type: ignore[method-assign]

    outcome = await svc.search(JOB)

    assert sorted(c["url"] for c in outcome.candidates) == [
        "https://www.nl-vandaag.nl/boeren",
        "https://www.rtl.nl/a",
    ]
    dropped = {v["url"]: v["dropped"] for v in outcome.stats["verdicts"] if v["strategy"] == "G"}
    assert dropped == {
        "https://www.headliner.nl/item/boeren-tegen-windpark": "kopie uit het nieuws",
        "https://www.headliner.nl/item/windpark-de-boeren-blijven-boos-nieuwrechts-23375": "kopie uit het nieuws",
        "https://www.nl-vandaag.nl/boeren": None,
    }
    # The check reads only RTL: the same headline (AD) and the same agency text (Parool) are out
    check = llm.prompts[-1]
    assert "[a1] RTL Nieuws" in check and headline not in check and "Parool" not in check
    assert (
        "AL IN HET NIEUWS:\n- NOS: Windpark Dijkerhoven mag er komen\n- NieuwRechts: " + headline
    ) in web.prompts[0]
    assert "zoals Headliner of MSN" in web.prompts[0]


async def test_keeps_only_the_voice_itself_about_the_same_news():
    plan = SearchPlan(kind="concreet", event_terms=["Dijkerhoven", "windpark"], event_query="windpark Dijkerhoven", queries=["boeren windpark Dijkerhoven"])
    llm = StubLLM(
        plan,
        [
            [
                hit("a1"),
                hit("a2", own_voice=False),  # someone talking about the farmers
                hit("a3", same_news=False),
                hit("a4", confidence=0.5),  # not sure enough
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
    jobs.append(
        VoiceSearchJob(id=4, event_id=7, perspective="Vissers", context=None, origin="analyse", gap_key=None)
    )
    finished: list[tuple[int, str, int, str | None]] = []
    published: list[tuple[int, int]] = []
    svc = VoiceSearchService(llm=StubLLM(SearchPlan(), []), web_search=None, google_search=None)

    async def ready():
        return True

    async def stale():
        return 0

    async def claim():
        return jobs.pop(0) if jobs else None

    async def finish(job_id, status, candidates, _stats, reason):
        finished.append((job_id, status, len(candidates), reason))

    async def publish(job_id, candidates):
        published.append((job_id, len(candidates)))

    async def search(job, on_found=None):
        if job.id == 2:
            raise RuntimeError("LLM 402 Payment Required")
        if job.id == 4:  # G found one, then A failed
            await on_found([{"id": "c1"}])
            raise RuntimeError("Claude Code faalde")
        found = [{"id": "c1"}] if job.id == 1 else []
        return vs.SearchOutcome(found, {})

    async def no_reviews():
        return {"linked": 0, "unlinked": 0, "failed": 0}

    monkeypatch.setattr(svc, "table_ready", ready)
    monkeypatch.setattr(svc, "fail_stale", stale)
    monkeypatch.setattr(svc, "apply_reviews", no_reviews)
    monkeypatch.setattr(svc, "claim", claim)
    monkeypatch.setattr(svc, "finish", finish)
    monkeypatch.setattr(svc, "publish", publish)
    monkeypatch.setattr(svc, "search", search)

    stats = await svc.run_pending(limit=5)
    assert stats == {"ran": 4, "found": 2, "nothing": 1, "failed": 1, "stale": 0}
    assert finished == [
        (1, "klaar", 1, None),
        (2, "fout", 0, "LLM 402 Payment Required"),
        (3, "niets_gevonden", 0, None),
        # What the admin saw already stays
        (4, "klaar", 1, "Claude Code faalde"),
    ]
    assert published == [(4, 1)]


async def test_run_pending_waits_for_the_migration(monkeypatch):
    svc = VoiceSearchService(llm=StubLLM(SearchPlan(), []), web_search=None)

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


async def test_the_search_model_runs_with_the_own_articles_and_both_are_kept():
    plan = SearchPlan(
        kind="concreet",
        event_terms=["Dijkerhoven", "windpark"],
        event_query="windpark Dijkerhoven",
        queries=["boeren windpark"],
    )
    llm = StubLLM(plan, [[hit("a1", confidence=0.7)]])
    web = StubWeb(
        [
            web_hit("g1"),
            web_hit("g2"),  # not one of its search results
            web_hit("g3"),  # already in the news
            web_hit("g4", confidence=0.4),
            web_hit("g5", date="2026-08-01"),  # two months before
            web_hit("g6"),  # the same article as g1
        ],
        links={
            "g1": "https://www.nl-vandaag.nl/boeren",
            "g3": "https://nos.nl/artikel/1",
            "g4": "https://www.ad.nl/x",
            "g5": "https://www.bd.nl/y",
            "g6": "https://nl-vandaag.nl/boeren/",
        },
    )
    svc, calls = service(
        llm,
        own=[RTL],
        google={"windpark Dijkerhoven": [gnews("https://www.trouw.nl/b")]},
        texts={"https://www.trouw.nl/b": LONG},
        web=web,
    )
    shown: list[list[tuple[str, str]]] = []

    async def on_found(items):
        shown.append([(c["id"], c["strategy"]) for c in items])

    outcome = await svc.search(JOB, on_found)

    # Shown as they come in (here A first), each with its id for good
    assert shown == [[("c1", "A")], [("c1", "A"), ("c2", "G")]]
    assert [(c["id"], c["url"], c["strategy"]) for c in outcome.candidates] == [
        ("c1", "https://www.rtl.nl/a", "A"),
        ("c2", "https://www.nl-vandaag.nl/boeren", "G"),
    ]
    assert {"plan", "check", "web", "first"} <= set(outcome.stats["timings"])
    found = outcome.candidates[1]
    assert (found["outlet"], found["domain"], found["country"], found["is_international"]) == (
        "NL Vandaag",
        "nl-vandaag.nl",
        "NL",
        False,
    )
    assert found["who"] == "LTO Noord" and found["published_at"].startswith("2026-09-29")
    assert found["verdict"] == "open" and found["article_id"] is None
    assert found["confidence"] == 0.9
    # Google answered: Google News (D) and the planned queries (B) were not needed
    assert calls == []
    web_stats = outcome.stats["web"]
    assert (web_stats["hits"], web_stats["kept"]) == (6, 1)
    assert web_stats["tokens"] == {"in": 1900, "out": 3600}
    dropped = {v["url"]: v["dropped"] for v in outcome.stats["verdicts"] if v["strategy"] == "G"}
    assert dropped == {
        "https://www.nl-vandaag.nl/boeren": None,
        "g2": "geen zoekresultaat",
        "https://nos.nl/artikel/1": "al in het nieuws",
        "https://www.ad.nl/x": "te onzeker",
        "https://www.bd.nl/y": "buiten de week",
        "https://nl-vandaag.nl/boeren/": "dubbel",
    }
    prompt = web.prompts[0]
    assert "ONTBREKEND PERSPECTIEF: Boeren op de polder" in prompt
    assert "21-09-2026 tot en met 05-10-2026" in prompt and "geen opdracht" in prompt


async def test_falls_back_to_google_news_when_the_search_model_fails():
    plan = SearchPlan(
        kind="concreet",
        event_terms=["windpark"],
        event_query="windpark Dijkerhoven",
        queries=["boeren windpark"],
    )
    llm = StubLLM(plan, [[hit("a1")]])
    svc, calls = service(
        llm,
        own=[],
        google={"windpark Dijkerhoven": [gnews("https://www.trouw.nl/b")]},
        texts={"https://www.trouw.nl/b": LONG},
        web=StubWeb(error="Gemini: limiet bereikt (429)"),
    )
    outcome = await svc.search(JOB)
    assert calls == ["windpark Dijkerhoven"]
    assert [(c["url"], c["strategy"]) for c in outcome.candidates] == [
        ("https://www.trouw.nl/b", "D")
    ]
    assert "429" in outcome.stats["web"]["error"]


async def test_the_search_model_finding_nothing_is_an_answer():
    plan = SearchPlan(
        kind="concreet",
        event_terms=["windpark"],
        event_query="windpark Dijkerhoven",
        queries=["boeren windpark"],
    )
    svc, calls = service(
        StubLLM(plan, []),
        own=[],
        google={"windpark Dijkerhoven": [gnews("https://www.trouw.nl/b")]},
        texts={"https://www.trouw.nl/b": LONG},
        web=StubWeb([]),
    )
    outcome = await svc.search(JOB)
    assert outcome.candidates == [] and calls == []
    assert outcome.stats["web"]["hits"] == 0


def test_reads_the_answer_of_the_search_model():
    hits = vs.parse_web_hits(
        'Gevonden:\n```json\n{"results": [{"url": "https://a.nl/x", "confidence": 0.8}]}\n```'
    )
    assert [(h.url, h.confidence) for h in hits] == [("https://a.nl/x", 0.8)]
    with pytest.raises(WebSearchError):
        vs.parse_web_hits("Ik vond niets.")
    with pytest.raises(WebSearchError):
        vs.parse_web_hits('{"results": "geen"}')
    assert vs.web_date("2026-10-07") == datetime(2026, 10, 7, tzinfo=timezone.utc)
    assert vs.web_date("7 oktober") is None and vs.web_date(None) is None


def test_a_find_keeps_its_place_and_id():
    shown = vs.Shown(limit=3)
    one = {"url": "https://www.trouw.nl/b", "confidence": 0.7, "strategy": "D"}
    other = {"url": "https://www.ad.nl/c", "confidence": 0.8, "strategy": "A"}
    assert shown.add([one, other])
    assert [(c["id"], c["strategy"]) for c in shown.items] == [("c1", "A"), ("c2", "D")]
    # The surer verdict on the same article takes over its place and id
    assert shown.add([{"url": "https://trouw.nl/b/", "confidence": 0.9, "strategy": "G"}])
    assert [(c["id"], c["strategy"]) for c in shown.items] == [("c1", "A"), ("c2", "G")]
    assert not shown.add([one]) and not shown.add([])
    shown.add(
        [
            {"url": "https://nos.nl/d", "confidence": 0.95, "strategy": "G"},
            {"url": "https://nu.nl/e", "confidence": 0.9, "strategy": "G"},
        ]
    )
    assert [(c["id"], c["url"]) for c in shown.items][2:] == [("c3", "https://nos.nl/d")]


def test_what_the_admin_reviewed_meanwhile_stays():
    stored = [
        {"id": "c1", "url": "https://a.nl/1", "verdict": "goedgekeurd", "article_id": 12},
        {"id": "c2", "url": "https://b.nl/2", "verdict": "open"},
    ]
    found = [
        {"id": "c1", "url": "https://a.nl/1", "verdict": "open", "article_id": None, "who": "x"},
        {"id": "c2", "url": "https://b.nl/2", "verdict": "open", "who": "y"},
        {"id": "c3", "url": "https://c.nl/3", "verdict": "open"},
    ]
    kept = vs.keep_reviews(stored, found)
    assert [(c["id"], c["verdict"], c.get("article_id"), c.get("who")) for c in kept] == [
        ("c1", "goedgekeurd", 12, None),
        ("c2", "open", None, "y"),
        ("c3", "open", None, None),
    ]
    assert vs.keep_reviews(None, found) == found


async def test_the_backup_llm_takes_over_when_the_llm_fails():
    plan = SearchPlan(kind="concreet", event_terms=["Dijkerhoven", "windpark"])
    backup = StubLLM(plan, [[hit("a1")]])
    down = FailingLLM()
    svc, _ = service(down, own=[RTL], google={}, texts={})
    svc.backup_llm = backup
    outcome = await svc.search(JOB)
    assert [(c["url"], c["strategy"]) for c in outcome.candidates] == [("https://www.rtl.nl/a", "A")]
    assert down.calls == 2 and len(backup.prompts) == 2
    assert outcome.stats["backup"] == ["SearchPlan", "VerdictBatch"]


async def test_a_failing_check_does_not_lose_what_google_found():
    web = StubWeb([web_hit("g1")], links={"g1": "https://www.nl-vandaag.nl/boeren"})
    svc, calls = service(FailingLLM(), own=[RTL], google={}, texts={}, web=web)
    outcome = await svc.search(JOB)
    assert [c["strategy"] for c in outcome.candidates] == ["G"] and calls == []
    assert "429" in outcome.stats["check_error"]
    # Without a find the search fails: "nobody found" would not be true
    svc, _ = service(FailingLLM(), own=[RTL], google={}, texts={}, web=StubWeb([]))
    with pytest.raises(RuntimeError, match="429"):
        await svc.search(JOB)


async def test_run_pending_looks_for_dead_searches_once_a_minute(monkeypatch):
    svc = VoiceSearchService(llm=StubLLM(SearchPlan(), []), web_search=None)
    counts = {"ready": 0, "stale": 0}

    async def ready():
        counts["ready"] += 1
        return True

    async def stale():
        counts["stale"] += 1
        return 0

    async def claim():
        return None

    async def no_reviews():
        return {"linked": 0, "unlinked": 0, "failed": 0}

    monkeypatch.setattr(svc, "table_ready", ready)
    monkeypatch.setattr(svc, "fail_stale", stale)
    monkeypatch.setattr(svc, "apply_reviews", no_reviews)
    monkeypatch.setattr(svc, "claim", claim)
    await svc.run_pending(limit=2)
    await svc.run_pending(limit=2)
    assert counts == {"ready": 1, "stale": 1}


def test_the_queue_job_stays_out_of_the_log():
    def record(level: int, job: str) -> logging.LogRecord:
        return logging.LogRecord(
            "apscheduler.executors.default",
            level,
            __file__,
            1,
            'Running job "%s" (scheduled at %s)',
            (f"{job} (trigger: interval[0:00:05], next run at: 22:00)", "21:59"),
            None,
        )

    quiet = _QuietVoiceSearchLog()
    assert not quiet.filter(record(logging.INFO, "Voice Search"))
    assert not quiet.filter(record(logging.WARNING, "Voice Search"))
    assert quiet.filter(record(logging.ERROR, "Voice Search"))
    assert quiet.filter(record(logging.INFO, "RSS Feed Polling"))
