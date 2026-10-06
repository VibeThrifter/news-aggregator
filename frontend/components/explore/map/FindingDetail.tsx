"use client";

import type { ReactNode } from "react";
import { ExternalLink, ScanText, UserSearch } from "lucide-react";

import { objectivity } from "@/lib/explore/bias";
import { findingTitle } from "@/lib/explore/findings";
import { FRAME_DESCRIPTIONS, VERIFICATION_LABELS, biasTypeLabel, fallacyLabel, frameLabel } from "@/lib/explore/labels";
import { actorKeys } from "@/lib/explore/normalize";
import { truncate } from "@/lib/explore/summary";
import { formatLag } from "@/lib/explore/timeline";
import type { Finding, OwnEntry } from "@/lib/explore/types";

import { useExplore } from "../ExploreContext";
import { EntityText, OutletInline } from "../entity/EntityText";
import { OutletChip } from "../outlet/OutletCard";
import { Chip, SubHeading, Tag } from "../ui/primitives";
import { DETAIL_LABELS } from "./OwnForm";
import { FoundVoices, VoiceSearchPanel } from "./VoiceSearch";

function Row({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === "" || children === false) return null;
  return (
    <div className="space-y-0.5">
      <SubHeading>{label}</SubHeading>
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

/**
 * The content of an opened row. The row itself already shows the title (claim, topic, frame, …),
 * so this shows what is behind it.
 */
export function FindingDetail({ finding }: { finding: Finding }) {
  const { exploration, panel } = useExplore();
  const { index } = exploration;
  const body = finding.body;

  switch (body.type) {
    case "perspective":
      return (
        <div className="space-y-3">
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
                        — <EntityText text={stance.stance} />
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
      return body.actors.length ? (
        <div className="flex flex-wrap gap-1.5">
          {body.actors.map((actor) => (
            <ActorButton key={actor.key} name={actor.name} person={actor.role === "wordt geciteerd"} />
          ))}
        </div>
      ) : null;

    case "contradiction":
      return (
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { side: "A", claim: body.contradiction.claim_a, outlets: body.outletsA },
            { side: "B", claim: body.contradiction.claim_b, outlets: body.outletsB },
          ].map(({ side, claim, outlets }) => (
            <div key={side} className="space-y-2 rounded-xl border border-red-100 bg-red-50/60 p-3">
              <p className="text-sm text-ink-800">
                <EntityText text={claim?.summary} />
              </p>
              <Outlets keys={outlets} />
            </div>
          ))}
        </div>
      );

    case "claim":
      return (
        <div className="space-y-3">
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
          <Row label="Wat klopt er niet">{body.issue.issue}</Row>
          <Row label="Eerlijker gebracht">{body.issue.better_framing}</Row>
        </div>
      );

    case "fallacy":
      return (
        <p className="text-sm leading-relaxed text-ink-800">
          <EntityText text={body.fallacy.description} />
        </p>
      );

    case "authority": {
      const a = body.authority;
      return (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Row label="Claimt expertise in">{a.claimed_expertise}</Row>
            <Row label="Is eigenlijk">{a.actual_role}</Row>
          </div>
          {a.scope_creep ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <SubHeading tone="text-amber-800">Buiten het eigen mandaat?</SubHeading>
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
            <Row label="Vragen bij deze bron">
              <List items={a.critical_questions} />
            </Row>
          ) : null}
          <ActorButton name={a.authority} />
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

    case "frame":
      return (
        <div className="space-y-2">
          {FRAME_DESCRIPTIONS[body.frame.frame_type] ? <p className="text-xs text-ink-500">{FRAME_DESCRIPTIONS[body.frame.frame_type]}</p> : null}
          <p className="text-sm leading-relaxed text-ink-800">
            <EntityText text={body.frame.description} />
          </p>
          <Outlets keys={finding.outletKeys} />
        </div>
      );

    case "tone":
      return (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {body.analysis.copy_paste_score ? <Tag tone="orange">Kopieergedrag: {body.analysis.copy_paste_score}</Tag> : null}
            {body.analysis.anonymous_source_count ? <Tag tone="orange">{body.analysis.anonymous_source_count} anonieme bronnen</Tag> : null}
          </div>
          <Row label="Past in het verhaal van">{body.analysis.narrative_alignment}</Row>
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
            Bekijk de zinnen
          </Chip>
        </div>
      );

    case "gap":
      return (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-ink-800">
            <EntityText text={body.gap.description} />
          </p>
          <Row label="Waarom dit ertoe doet">{body.gap.relevance}</Row>
          {body.gap.potential_sources?.length ? (
            <Row label="Wie had het kunnen zeggen">
              <div className="flex flex-wrap gap-1.5">
                {body.gap.potential_sources.map((source) => (
                  <Tag key={source}>{source}</Tag>
                ))}
              </div>
            </Row>
          ) : null}
          <FoundVoices findingId={finding.id} label={body.gap.perspective} />
          <VoiceSearchPanel
            findingId={finding.id}
            perspective={body.gap.perspective}
            context={[body.gap.description, body.gap.relevance].filter(Boolean).join(" ")}
            origin="analyse"
          />
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
      return <Outlets keys={finding.outletKeys} />;

    case "own":
      return (
        <div className="space-y-3">
          <OwnDetail entry={body.entry} />
          {body.entry.kind === "gap" ? (
            <>
              <FoundVoices findingId={finding.id} label={body.entry.text} />
              <VoiceSearchPanel findingId={finding.id} perspective={body.entry.text} context={body.entry.detail ?? null} origin="eigen" />
            </>
          ) : null}
        </div>
      );

    default:
      return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const dayFormat = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric" });

/** "12 mrt 2024" for a YYYY-MM-DD date. */
export function formatOwnDate(date: string | undefined): string | null {
  if (!date) return null;
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : dayFormat.format(parsed);
}

/** What the reader wrote besides the title: why, what the speaker says, their source. */
function OwnDetail({ entry }: { entry: OwnEntry }) {
  const { exploration, toFinding } = useExplore();
  const about = entry.about ? exploration.findingById.get(entry.about) : undefined;
  if (!entry.detail && !entry.quote && !entry.url && !about && !entry.title) return null;
  return (
    <div className="space-y-3">
      {about ? (
        <button
          type="button"
          onClick={() => toFinding(about.id)}
          className="flex min-h-[44px] w-full items-start gap-2 rounded-xl bg-orange-50 px-2.5 py-2 text-left text-sm text-ink-800"
        >
          <span className="shrink-0 pt-px text-xs font-semibold text-orange-800">Over</span>
          <span className="min-w-0 flex-1">{findingTitle(about, exploration.index)}</span>
        </button>
      ) : null}
      {entry.quote ? <p className="text-sm italic leading-relaxed text-ink-800">{entry.quote}</p> : null}
      {entry.detail ? (
        <div className="space-y-0.5">
          <SubHeading>{DETAIL_LABELS[entry.kind] ?? "Toelichting"}</SubHeading>
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink-800">{entry.detail}</p>
        </div>
      ) : null}
      {entry.url ? (
        <a
          href={entry.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[36px] items-center gap-1.5 text-sm font-semibold text-accent-blue"
        >
          {entry.kind === "source" && entry.title ? truncate(entry.title, 140) : `Bron: ${hostOf(entry.url)}`} <ExternalLink size={14} aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}

/** The one-line summary a row shows while closed. */
export function findingHeadline(finding: Finding): { title: string; meta: string | null } {
  const body = finding.body;
  switch (body.type) {
    case "perspective":
      return { title: body.cluster.label, meta: null };
    case "voices":
      return { title: body.sourcingPattern ?? "Wie aan het woord is", meta: null };
    case "contradiction":
      return { title: body.contradiction.topic, meta: VERIFICATION_LABELS[body.contradiction.verification]?.label ?? null };
    case "claim":
      return {
        title: body.claim.claim,
        meta: [body.claim.presented_as ? `gebracht als ${body.claim.presented_as.toLowerCase()}` : null, body.claim.evidence_provided && body.claim.evidence_provided !== "geen" ? null : "geen bewijs"]
          .filter(Boolean)
          .join(" · "),
      };
    case "statistic":
      return { title: body.issue.claim, meta: null };
    case "fallacy":
      return { title: fallacyLabelText(body.fallacy.type), meta: null };
    case "authority":
      return { title: body.authority.authority, meta: body.authority.authority_type ?? null };
    case "timing":
      return { title: "Waarom nu?", meta: null };
    case "frame":
      return {
        title: frameLabel(body.frame.frame_type),
        meta: [body.frame.attribution === "geciteerd" ? "geciteerd" : "eigen woorden", body.frame.technique].filter(Boolean).join(" · "),
      };
    case "tone":
      return { title: body.analysis.tone ?? "Toon", meta: null };
    case "bias":
      return { title: `${body.sentenceCount} gekleurde ${body.sentenceCount === 1 ? "zin" : "zinnen"}`, meta: null };
    case "gap":
      return { title: body.gap.perspective, meta: null };
    case "questions":
      return {
        title: `${body.analysis.questions_not_asked?.length ?? 0} niet gestelde vragen`,
        meta: body.analysis.perspectives_omitted?.length ? `${body.analysis.perspectives_omitted.length} weggelaten perspectieven` : null,
      };
    case "science":
      return { title: body.plurality.topic, meta: body.plurality.alternative_views_mentioned ? null : "andere visies niet genoemd" };
    case "first":
      return { title: "Wie was er het eerst?", meta: null };
    case "timeline":
      return { title: body.item.headline, meta: body.timeLabel };
    case "own":
      return {
        title: body.entry.text,
        meta:
          body.entry.kind === "moment"
            ? formatOwnDate(body.entry.date)
            : body.entry.kind === "fallacy"
              ? fallacyLabel(body.entry.fallacy)
              : body.entry.url
                ? `${body.entry.kind === "source" ? "" : "bron: "}${hostOf(body.entry.url)}`
                : null,
      };
    default:
      return { title: "", meta: null };
  }
}

function fallacyLabelText(type: string): string {
  return fallacyLabel(type);
}
