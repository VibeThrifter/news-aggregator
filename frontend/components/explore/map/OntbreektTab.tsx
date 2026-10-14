"use client";

import { useId, type ReactNode } from "react";

import { isContextGap } from "@/lib/explore/missing";
import { ownEntryOf } from "@/lib/explore/own";
import type { Finding } from "@/lib/explore/types";

import { EntityText } from "../entity/EntityText";
import { SubHeading } from "../ui/primitives";
import { FindingActions, FindingRow } from "./FindingRow";
import { useFocusRing } from "./Markers";

/** A white card, like the cards under "Wie praat?" */
const CARD = "rounded-2xl border border-paper-300 bg-paper-50 px-4";

/**
 * "Wat ontbreekt?": who does not get the word (the empty balloons of the picture, also the ones
 * you added), the context that is missing, and the debate the news leaves out. Each in its own
 * card; `rows` in display order.
 */
export function OntbreektTab({ rows }: { rows: Finding[] }) {
  const voices = rows.filter((finding) => (finding.body.type === "gap" && !isContextGap(finding.body.gap)) || ownEntryOf(finding)?.kind === "gap");
  const context = rows.filter((finding) => finding.body.type === "gap" && isContextGap(finding.body.gap));
  const science = rows.find((finding) => finding.body.type === "science");
  if (voices.length === 0 && context.length === 0 && !science) return null;
  return (
    <div className="space-y-3">
      <Group title="Wie komt niet aan het woord?" findings={voices} />
      <Group title="Welke context ontbreekt?" findings={context} />
      {science ? <DebateCard finding={science} /> : null}
    </div>
  );
}

function Group({ title, findings }: { title: string; findings: Finding[] }) {
  const id = useId();
  if (findings.length === 0) return null;
  return (
    <section className={CARD} aria-labelledby={id}>
      <SubHeading className="py-3">
        <span id={id}>{title}</span>
      </SubHeading>
      <ul className="divide-y divide-paper-200 border-t border-paper-200">
        {findings.map((finding) => (
          <FindingRow key={finding.id} finding={finding} />
        ))}
      </ul>
    </section>
  );
}

function Part({ label, children }: { label: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="space-y-0.5 py-2.5">
      <p className="text-sm font-semibold text-ink-900">{label}</p>
      <div className="text-sm leading-relaxed text-ink-700">{typeof children === "string" ? <EntityText text={children} /> : children}</div>
    </div>
  );
}

/** The scientific debate (`scientific_plurality`): how the news brings it and what the discussion is about. */
function DebateCard({ finding }: { finding: Finding }) {
  const id = useId();
  const { ref, ringing } = useFocusRing<HTMLElement>("finding", finding.id);
  if (finding.body.type !== "science") return null;
  const plurality = finding.body.plurality;
  const debates = (plurality.known_debates ?? []).filter((item) => item?.trim());
  return (
    <section
      ref={ref}
      id={`finding-${finding.id}`}
      aria-labelledby={id}
      className={`${CARD} scroll-mt-28 transition-shadow ${ringing ? "ring-4 ring-amber-300 ring-offset-2" : ""}`}
    >
      <div className="space-y-1 py-3">
        <SubHeading>
          <span id={id}>Welk debat ontbreekt?</span>
        </SubHeading>
        <p className="text-sm leading-relaxed text-ink-600">
          <EntityText text={plurality.topic} />
        </p>
      </div>
      <div className="divide-y divide-paper-200 border-t border-paper-200">
        <Part label="Zo gebracht">{plurality.presented_view}</Part>
        <Part label="Waarover discussie is">
          {debates.length ? (
            <ul className="list-disc space-y-1 pl-5">
              {debates.map((item) => (
                <li key={item}>
                  <EntityText text={item} />
                </li>
              ))}
            </ul>
          ) : null}
        </Part>
        <Part label="Andere visies">{plurality.notable_dissenters}</Part>
        <Part label="Oordeel">{plurality.assessment}</Part>
        <div className="py-3">
          <FindingActions finding={finding} />
        </div>
      </div>
    </section>
  );
}
