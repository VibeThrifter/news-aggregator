# ruff: noqa: S101
"""A simple division of the angles: at most a few groups (Story 14.41)."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from backend.app.db.models import LLMInsight
from backend.app.llm.angle_groups import (
    AngleDivision,
    AngleGroup,
    apply_division,
    simple_division_prompt,
)
from backend.app.llm.client import BaseLLMClient, LLMGenericResult, LLMResponseError
from backend.app.llm.prompt_builder import PromptGenerationResult
from backend.app.llm.schemas import (
    CriticalPayload,
    FactualPayload,
    InsightCluster,
    InsightClusterSource,
)
from backend.tests.unit._exploration_fixtures import (
    make_session_factory,
    make_settings,
    real_module,
    seed_event,
)

SUMMARY = (
    "Coalitie herstelt vertrouwen\n\n" + "Na vier dagen crisisberaad gaat de coalitie verder. " * 5
)


def _cluster(label: str, *outlets: str, spectrum: str = "mainstream") -> InsightCluster:
    return InsightCluster(
        label=label,
        spectrum=spectrum,
        source_types=["nieuws"],
        summary=f"Samenvatting: {label}.",
        sources=[
            InsightClusterSource(
                title=f"Kop van {outlet}",
                url=f"https://www.{outlet}/{label.split()[0].lower()}",
                spectrum=spectrum,
                stance=f"{outlet} over {label.lower()}",
            )
            for outlet in outlets
        ],
    )


def _six() -> list[InsightCluster]:
    """The angles of event 12055 as the analysis gave them."""

    return [
        _cluster("Herstelde samenwerking en een mkb-pakket", "nos.nl", "trouw.nl", "ad.nl"),
        _cluster("Jetten moet kiezen", "volkskrant.nl", "parool.nl"),
        _cluster("Ondernemers zien vage plannen en capitulatie", "rtl.nl", "geenstijl.nl"),
        _cluster(
            "Rechtse oppositie noemt de uitkomst een afgang",
            "dagelijksestandaard.nl",
            spectrum="rechts",
        ),
        _cluster("Lezers oordelen hard over het kabinet", "telegraaf.nl", spectrum="rechts"),
        _cluster("Crisis draaide om beeld", "nu.nl"),
    ]


def _division(*groups: tuple[str, list[int]]) -> AngleDivision:
    return AngleDivision(
        groups=[
            AngleGroup(label=label, summary=f"{label} in een zin.", members=members)
            for label, members in groups
        ]
    )


GOOD = _division(
    ("Herstelde samenwerking", [1]),
    ("Jetten moet kiezen", [2]),
    ("Te weinig bereikt", [3, 4, 5]),
    ("Beeld", [6]),
)


def test_the_prompt_lists_every_angle_with_its_outlets_and_the_limit() -> None:
    prompt = simple_division_prompt(_six(), limit=4)
    assert "at most 4 groups" in prompt
    assert "6. Crisis draaide om beeld" in prompt
    assert (
        "   - geenstijl.nl: geenstijl.nl over ondernemers zien vage plannen en capitulatie"
        in prompt
    )
    assert "Every number from 1 to 6" in prompt


def test_merged_angles_take_the_models_label_and_all_their_sources() -> None:
    clusters = _six()
    merged = apply_division(clusters, GOOD, limit=4)
    assert merged is not None
    assert [cluster.label for cluster in merged] == [
        "Herstelde samenwerking en een mkb-pakket",  # a group of one keeps its own label
        "Jetten moet kiezen",
        "Te weinig bereikt",
        "Crisis draaide om beeld",
    ]
    assert merged[0] is clusters[0]
    together = merged[2]
    assert together.summary == "Te weinig bereikt in een zin."
    assert [str(source.url).split("/")[2] for source in together.sources] == [
        "www.rtl.nl",
        "www.geenstijl.nl",
        "www.dagelijksestandaard.nl",
        "www.telegraaf.nl",
    ]
    # The spectrum of the angle with most sources
    assert together.spectrum == "mainstream"


def test_the_models_order_is_kept_so_look_alike_groups_stand_together() -> None:
    division = _division(("Uitkomst", [2, 1]), ("Te weinig bereikt", [5, 3, 4]), ("Beeld", [6]))
    merged = apply_division(_six(), division, limit=4)
    assert merged is not None
    assert [cluster.label for cluster in merged] == [
        "Uitkomst",
        "Te weinig bereikt",
        "Crisis draaide om beeld",
    ]
    assert str(merged[0].sources[0].url).startswith("https://www.volkskrant.nl")


@pytest.mark.parametrize(
    "division",
    [
        _division(
            ("A", [1]), ("B", [2]), ("C", [3]), ("D", [4]), ("E", [5, 6])
        ),  # still five groups
        _division(("A", [1, 2]), ("B", [3, 4]), ("C", [5])),  # angle 6 is gone
        _division(("A", [1, 2, 3]), ("B", [3, 4]), ("C", [5, 6])),  # angle 3 twice
        _division(("A", [1, 2, 7]), ("B", [3, 4]), ("C", [5, 6])),  # an angle that is not there
        AngleDivision(groups=[]),
        AngleDivision(
            groups=[AngleGroup(label="", summary="Zonder naam.", members=[1, 2, 3, 4, 5, 6])]
        ),
    ],
)
def test_a_division_that_loses_or_doubles_an_angle_is_not_used(division: AngleDivision) -> None:
    assert apply_division(_six(), division, limit=4) is None


def test_the_same_article_in_two_merged_angles_is_listed_once() -> None:
    clusters = [_cluster("A", "nos.nl"), _cluster("A", "nos.nl", "ad.nl"), _cluster("C", "nu.nl")]
    merged = apply_division(clusters, _division(("Samen", [1, 2]), ("C", [3])), limit=2)
    assert merged is not None
    assert [str(source.url) for source in merged[0].sources] == [
        "https://www.nos.nl/a",
        "https://www.ad.nl/a",
    ]


# --- In the analysis ---------------------------------------------------------------------------


class _PromptBuilder:
    def __init__(self) -> None:
        self.result = PromptGenerationResult(
            prompt="PROMPT",
            prompt_length=6,
            selected_article_ids=[1],
            selected_count=1,
            total_articles=1,
        )

    async def build_factual_prompt_package(self, event_id: int, max_articles=None):
        return self.result

    async def build_critical_prompt_package(
        self, event_id: int, factual_summary: str, max_articles=None
    ):
        return self.result


class _Client(BaseLLMClient):
    provider = "mistral"

    def __init__(
        self, clusters: list[InsightCluster], division: AngleDivision | Exception | None
    ) -> None:
        self.factual = FactualPayload(
            summary=SUMMARY, timeline=[], clusters=clusters, contradictions=[]
        )
        self.critical = CriticalPayload()
        self.division = division
        self.division_prompts: list[str] = []

    async def generate(self, prompt: str, *, correlation_id=None):  # pragma: no cover
        raise NotImplementedError

    async def generate_json(self, prompt: str, schema_class, *, correlation_id=None):
        if schema_class is AngleDivision:
            self.division_prompts.append(prompt)
            if isinstance(self.division, Exception):
                raise self.division
            payload = self.division
        else:
            payload = self.factual if schema_class is FactualPayload else self.critical
        return LLMGenericResult(
            provider="mistral",
            model="mistral-small-latest",
            payload=payload,
            raw_content="{}",
            usage=None,
        )


async def _stored_labels(monkeypatch, client: _Client, **settings_overrides) -> list[str]:
    module = real_module("backend.app.services.insight_service")
    factory, engine = await make_session_factory()
    event_id = await seed_event(factory, slug="coalitie", llm_title=None)
    service = module.InsightService(
        session_factory=factory,
        prompt_builder=_PromptBuilder(),
        client=client,
        settings=make_settings(mistral_api_key="test", **settings_overrides),
        exploration_hook=None,
    )

    async def client_for_phase(phase: str):
        return client

    monkeypatch.setattr(service, "_get_client_for_phase", client_for_phase)
    await service.generate_for_event(event_id, skip_international_enrichment=True)
    async with factory() as session:
        insight = (await session.execute(select(LLMInsight))).scalars().one()
    await engine.dispose()
    return [cluster["label"] for cluster in insight.clusters]


@pytest.mark.asyncio
async def test_an_analysis_with_six_angles_is_stored_with_four(monkeypatch) -> None:
    client = _Client(_six(), GOOD)
    labels = await _stored_labels(monkeypatch, client)
    assert labels == [
        "Herstelde samenwerking en een mkb-pakket",
        "Jetten moet kiezen",
        "Te weinig bereikt",
        "Crisis draaide om beeld",
    ]
    assert len(client.division_prompts) == 1


@pytest.mark.asyncio
async def test_four_angles_cost_no_extra_call(monkeypatch) -> None:
    client = _Client(_six()[:4], GOOD)
    labels = await _stored_labels(monkeypatch, client)
    assert len(labels) == 4
    assert client.division_prompts == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "division",
    [
        LLMResponseError("geen JSON"),
        _division(("A", [1, 2]), ("B", [3, 4]), ("C", [5])),  # loses angle 6
    ],
)
async def test_a_failed_division_keeps_the_angles_and_the_analysis(monkeypatch, division) -> None:
    client = _Client(_six(), division)
    labels = await _stored_labels(monkeypatch, client)
    assert len(labels) == 6
    assert len(client.division_prompts) == 1


@pytest.mark.asyncio
async def test_the_limit_can_be_switched_off(monkeypatch) -> None:
    client = _Client(_six(), GOOD)
    labels = await _stored_labels(monkeypatch, client, angle_groups_max=0)
    assert len(labels) == 6
    assert client.division_prompts == []
