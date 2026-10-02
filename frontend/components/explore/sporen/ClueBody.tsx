"use client";

import type { ReactNode } from "react";
import { ScanText, UserSearch } from "lucide-react";

import { objectivity } from "@/lib/explore/bias";
import { OWNERSHIP_TYPE_LABELS } from "@/lib/explore/media-landscape";
import {
  FRAME_DESCRIPTIONS,
  PRESENTED_AS_LABELS,
  VERIFICATION_LABELS,
  biasTypeLabel,
  fallacyLabel,
  frameLabel,
  toneLabel,
} from "@/lib/explore/labels";
import { actorKeys } from "@/lib/explore/normalize";
import { formatLag } from "@/lib/explore/timeline";
import type { Clue } from "@/lib/explore/types";
import { getCountryName } from "@/lib/format";

import { useExplore } from "../ExploreContext";
import { EntityText, OutletInline } from "../entity/EntityText";
import { OutletChip } from "../outlet/OutletCard";
import { Chip, Eyebrow, Tag } from "../ui/primitives";

function Row({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === "" || children === false) return null;
  return (
    <div className="space-y-0.5">
      <Eyebrow>{label}</Eyebrow>
      <div className="text-sm leading-relaxed text-ink-800">{typeof children === "string" ? <EntityText text={children} /> : children}</div>
    </div>
  );
}

function List({ items }: { items: (string | null | undefined)[] | null | undefined }) {
  const clean = (items ?? []).filter((item): item is string => Boolean(item && item.trim()));
  if (clean.length === 0) return null;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink-800">
      {clean.map((item, i) => (
        <li key={i}>
          <EntityText text={item} />
        </li>
      ))}
    </ul>
  );
}

function Outlets({ keys }: { keys: string[] }) {
  if (keys.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {keys.map((key) => (
        <OutletChip key={key} outletKey={key} />
      ))}
    </div>
  );
}

/** Button that opens the actor/entity panel (Wikipedia, appearances). */
export function ActorButton({ name, person = false }: { name: string; person?: boolean }) {
  const { panel } = useExplore();
  const keys = actorKeys(name, { person });
  if (!keys.slug) return <span>{name}</span>;
  return (
    <Chip
      tone="neutral"
      icon={<UserSearch size={14} />}
      onClick={() => panel.open(`entiteit:${keys.slug}`, { n: keys.display, k: person ? "person" : null })}
    >
      {keys.display}
    </Chip>
  );
}

export function ClueBody({ clue }: { clue: Clue }) {
  const { exploration, panel, eventId } = useExplore();
  const { index } = exploration;
  const body = clue.body;

  switch (body.type) {
    case "perspective":
      return (
        <div className="space-y-3">
          <p className="font-serif text-lg font-bold text-ink-900">{body.cluster.label}</p>
          <p className="text-sm text-ink-700">
            <EntityText text={body.cluster.summary} />
          </p>
          <ul className="space-y-2">
            {body.stances.map((stance) => {
              const outlet = index.outlet(stance.outletKey);
              return (
                <li key={stance.outletKey} className="rounded-xl bg-paper-100 p-2.5">
                  <p className="text-sm">
                    {outlet ? <OutletInline outletKey={outlet.key} /> : <span className="font-semibold">{stance.outletKey}</span>}
                    {stance.stance ? (
                      <span className="text-ink-700">
                        {" "}
                        — “<EntityText text={stance.stance} />”
                      </span>
                    ) : null}
                  </p>
                </li>
              );
            })}
          </ul>
          {body.cluster.characteristics?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {body.cluster.characteristics.map((item) => (
                <Tag key={item}>{item}</Tag>
              ))}
            </div>
          ) : null}
        </div>
      );

    case "voices":
      return (
        <div className="space-y-3">
          <Row label="Bronpatroon">{body.sourcingPattern}</Row>
          {body.actors.length ? (
            <div className="space-y-1.5">
              <Eyebrow>Aan het woord</Eyebrow>
              <div className="flex flex-wrap gap-1.5">
                {body.actors.map((actor) => (
                  <ActorButton key={actor.key} name={actor.name} person={actor.role === "wordt geciteerd"} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      );

    case "contradiction": {
      const verification = VERIFICATION_LABELS[body.contradiction.verification] ?? { label: body.contradiction.verification, tone: "neutral" as const };
      return (
        <div className="space-y-3">
          <p className="font-serif text-lg font-bold text-ink-900">{body.contradiction.topic}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { side: "A", claim: body.contradiction.claim_a, outlets: body.outletsA },
              { side: "B", claim: body.contradiction.claim_b, outlets: body.outletsB },
            ].map(({ side, claim, outlets }) => (
              <div key={side} className="space-y-2 rounded-xl border border-red-100 bg-red-50/60 p-3">
                <Eyebrow className="text-red-700">Claim {side}</Eyebrow>
                <p className="text-sm text-ink-800">
                  <EntityText text={claim?.summary} />
                </p>
                <Outlets keys={outlets} />
              </div>
            ))}
          </div>
          <Tag tone={verification.tone === "good" ? "green" : verification.tone === "bad" ? "red" : "neutral"}>
            Status: {verification.label}
          </Tag>
        </div>
      );
    }

    case "claim":
      return (
        <div className="space-y-3">
          <blockquote className="border-l-4 border-red-300 pl-3 font-serif text-base italic text-ink-900">
            “<EntityText text={body.claim.claim} />”
          </blockquote>
          <div className="flex flex-wrap items-center gap-1.5 text-sm text-ink-600">
            <span>Door</span>
            <ActorButton name={body.claim.source_in_article} />
            <span>{PRESENTED_AS_LABELS[body.claim.presented_as?.toLowerCase()] ?? ""}</span>
          </div>
          <Row label="Aangedragen bewijs">{body.claim.evidence_provided}</Row>
          {body.claim.missing_context?.length ? (
            <Row label="Wat ontbreekt">
              <List items={body.claim.missing_context} />
            </Row>
          ) : null}
          {body.claim.critical_questions?.length ? (
            <Row label="Vragen die je kunt stellen">
              <List items={body.claim.critical_questions} />
            </Row>
          ) : null}
        </div>
      );

    case "statistic":
      return (
        <div className="space-y-3">
          <blockquote className="border-l-4 border-amber-300 pl-3 font-serif italic text-ink-900">
            “<EntityText text={body.issue.claim} />”
          </blockquote>
          <Row label="Wat klopt er niet">{body.issue.issue}</Row>
          <Row label="Eerlijker gebracht">{body.issue.better_framing}</Row>
        </div>
      );

    case "fallacy":
      return (
        <div className="space-y-2">
          <p className="font-serif text-lg font-bold text-ink-900">{fallacyLabel(body.fallacy.type)}</p>
          <p className="text-sm leading-relaxed text-ink-800">
            <EntityText text={body.fallacy.description} />
          </p>
        </div>
      );

    case "authority": {
      const a = body.authority;
      return (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <ActorButton name={a.authority} />
            {a.authority_type ? <Tag>{a.authority_type}</Tag> : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Row label="Claimt expertise in">{a.claimed_expertise}</Row>
            <Row label="Is eigenlijk">{a.actual_role}</Row>
          </div>
          {a.scope_creep ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <Eyebrow className="text-amber-800">Buiten het eigen mandaat?</Eyebrow>
              <p className="mt-1">
                <EntityText text={a.scope_creep} />
              </p>
            </div>
          ) : null}
          <Row label="Wie betaalt">{a.funding_sources}</Row>
          <Row label="Onafhankelijk?">{a.independence_check}</Row>
          <Row label="Samenstelling">{a.composition_question}</Row>
          <Row label="Eerdere adviezen">{a.track_record}</Row>
          {a.potential_interests?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {a.potential_interests.map((interest) => (
                <Tag key={interest} tone="orange">
                  {interest}
                </Tag>
              ))}
            </div>
          ) : null}
          {a.critical_questions?.length ? (
            <Row label="Vragen bij deze autoriteit">
              <List items={a.critical_questions} />
            </Row>
          ) : null}
        </div>
      );
    }

    case "timing":
      return (
        <div className="space-y-3">
          <Row label="Waarom nu?">{body.timing.why_now}</Row>
          <Row label="Wie heeft er baat bij?">{body.timing.cui_bono}</Row>
          <Row label="Wat komt eraan">{body.timing.upcoming_events}</Row>
        </div>
      );

    case "ownership":
      return (
        <div className="space-y-3">
          <ul className="space-y-2">
            {body.outletKeys.map((key) => {
              const outlet = index.outlet(key);
              const type = outlet?.profile?.ownershipType;
              return (
                <li key={key} className="flex items-center justify-between gap-2">
                  <OutletChip outletKey={key} />
                  {type ? <Tag tone={type === "public" ? "blue" : "neutral"}>{OWNERSHIP_TYPE_LABELS[type]}</Tag> : null}
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-ink-500">
            Wie de eigenaren, financiers en adverteerders zijn, zie je in het netwerk (lens Propagandamodel).
          </p>
        </div>
      );

    case "frame":
      return (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-serif text-lg font-bold text-ink-900">{frameLabel(body.frame.frame_type)}</p>
            <Tag tone={body.frame.attribution === "geciteerd" ? "neutral" : "purple"}>
              {body.frame.attribution === "geciteerd" ? "Geciteerd, niet eigen woorden" : "Eigen framing"}
            </Tag>
          </div>
          {FRAME_DESCRIPTIONS[body.frame.frame_type] ? (
            <p className="text-xs text-ink-500">{FRAME_DESCRIPTIONS[body.frame.frame_type]}</p>
          ) : null}
          <Row label="Techniek">{body.frame.technique}</Row>
          <p className="text-sm leading-relaxed text-ink-800">
            <EntityText text={body.frame.description} />
          </p>
        </div>
      );

    case "tone":
      return (
        <div className="space-y-3">
          <p className="font-serif text-lg font-bold text-ink-900">{toneLabel(body.analysis.tone)}</p>
          <div className="flex flex-wrap gap-1.5">
            {body.analysis.copy_paste_score ? <Tag tone="orange">Kopieergedrag: {body.analysis.copy_paste_score}</Tag> : null}
            {body.analysis.anonymous_source_count ? (
              <Tag tone="orange">{body.analysis.anonymous_source_count} anonieme bronnen</Tag>
            ) : null}
          </div>
          <Row label="Past in een narratief">{body.analysis.narrative_alignment}</Row>
          <Row label="Wat als ze ongelijk hebben?">{body.analysis.what_if_wrong}</Row>
        </div>
      );

    case "bias":
      return (
        <div className="space-y-3">
          <p className="text-sm">
            Objectiviteit eigen tekst: <strong>{objectivity(body.averageRating)}%</strong>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {body.topTypes.map((type) => (
              <Tag key={type.type} tone="purple">
                {biasTypeLabel(type.type)} · {type.count}×
              </Tag>
            ))}
          </div>
          <Chip tone="purple" icon={<ScanText size={14} />} onClick={() => panel.open(`bias:${body.outletKey}`)}>
            Swipe door de zinnen
          </Chip>
        </div>
      );

    case "gap":
      return (
        <div className="space-y-3">
          <p className="font-serif text-lg font-bold text-ink-900">{body.gap.perspective}</p>
          <p className="text-sm leading-relaxed text-ink-800">
            <EntityText text={body.gap.description} />
          </p>
          <Row label="Waarom dit ertoe doet">{body.gap.relevance}</Row>
          {body.gap.potential_sources?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {body.gap.potential_sources.map((source) => (
                <Tag key={source}>
                  <EntityText text={source} />
                </Tag>
              ))}
            </div>
          ) : null}
        </div>
      );

    case "questions":
      return (
        <div className="space-y-3">
          {body.analysis.questions_not_asked?.length ? (
            <Row label="Niet gesteld">
              <List items={body.analysis.questions_not_asked} />
            </Row>
          ) : null}
          {body.analysis.perspectives_omitted?.length ? (
            <Row label="Weggelaten perspectieven">
              <List items={body.analysis.perspectives_omitted} />
            </Row>
          ) : null}
          <Row label="Framing door weglating">{body.analysis.framing_by_omission}</Row>
        </div>
      );

    case "science":
      return (
        <div className="space-y-3">
          <p className="font-serif text-lg font-bold text-ink-900">{body.plurality.topic}</p>
          <Row label="Gepresenteerde visie">{body.plurality.presented_view}</Row>
          <Tag tone={body.plurality.alternative_views_mentioned ? "green" : "orange"}>
            {body.plurality.alternative_views_mentioned ? "Andere visies genoemd" : "Andere visies niet genoemd"}
          </Tag>
          {body.plurality.known_debates?.length ? (
            <Row label="Bekende debatten">
              <List items={body.plurality.known_debates} />
            </Row>
          ) : null}
          <Row label="Afwijkende wetenschappers">{body.plurality.notable_dissenters}</Row>
          <Row label="Beoordeling">{body.plurality.assessment}</Row>
        </div>
      );

    case "consensus":
      return (
        <p className="text-sm leading-relaxed text-ink-800">
          Alle bronnen vallen onder één invalshoek: <strong>{body.clusterLabel}</strong>. Dat kan betekenen dat het verhaal
          eenduidig is — of dat andere invalshoeken niemand bereikten.
        </p>
      );

    case "first":
      return (
        <ol className="space-y-2">
          {body.order.map((entry, i) => {
            const outlet = index.outlet(entry.outletKey);
            return (
              <li key={entry.outletKey} className="flex items-center gap-2 text-sm">
                <span className="w-5 text-right font-bold text-ink-400">{i + 1}</span>
                {outlet ? <OutletInline outletKey={outlet.key} /> : <span className="font-semibold">{entry.outletKey}</span>}
                <span className="text-ink-500">{formatLag(entry.lagMinutes)}</span>
              </li>
            );
          })}
        </ol>
      );

    case "timeline":
      return (
        <div className="space-y-2">
          <Eyebrow>{body.timeLabel}</Eyebrow>
          <p className="font-serif text-base font-bold text-ink-900">
            <EntityText text={body.item.headline} />
          </p>
          <Outlets keys={clue.outletKeys} />
        </div>
      );

    case "country":
      return (
        <div className="space-y-1">
          <p className="font-serif text-lg font-bold text-ink-900">{getCountryName(body.country.iso_code)}</p>
          <p className="text-sm text-ink-800">
            <EntityText text={body.country.relevance} />
          </p>
        </div>
      );

    default:
      return <p className="text-sm text-ink-500">Onbekende aanwijzing ({String(eventId)})</p>;
  }
}
