"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { egoLayout } from "@/lib/explore/ego-layout";
import { filterColor, filterLabel, pmRelationLabel } from "@/lib/explore/labels";
import { actorHref, kindForPmType } from "@/lib/explore/research";
import type { PmNeighborhood } from "@/lib/types";

import { Tag } from "../ui/primitives";

const PAD = 28;

function initials(name: string): string {
  const words = name.replace(/\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function short(name: string, max = 16): string {
  return name.length <= max ? name : `${name.slice(0, max - 1).trimEnd()}…`;
}

/** "Label" for an auto-approved item */
export function AutoApprovedTag({ className = "" }: { className?: string }) {
  return (
    <Tag tone="orange" className={className}>
      automatisch toegevoegd
    </Tag>
  );
}

/**
 * Small radial picture of an entity and (at most ten of) its neighbours in the propaganda model, in
 * the edge colours of the filter legend, with the same relations as a list (tap = actor page).
 * Lightweight SVG: no graph library, no animation.
 */
export function MiniEgoNetwork({ hood, demo = false, max = 10 }: { hood: PmNeighborhood; demo?: boolean; max?: number }) {
  const layout = useMemo(() => egoLayout(hood, { max }), [hood, max]);
  const { center, nodes, size } = layout;
  const total = Math.max(hood.total, nodes.length);

  return (
    <div className="space-y-2">
      <svg
        viewBox={`${-PAD} 0 ${size + 2 * PAD} ${size}`}
        className="mx-auto block h-auto w-full max-w-[340px]"
        role="img"
        aria-label={`Netwerk van ${center.name}: ${nodes.length} van ${total} verbanden in beeld`}
      >
        {nodes.map((node) => (
          <line
            key={`edge-${node.id}`}
            x1={center.x}
            y1={center.y}
            x2={node.x}
            y2={node.y}
            stroke={filterColor(node.filter)}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeDasharray={node.historic ? "6 5" : undefined}
            opacity={0.9}
          />
        ))}
        {nodes.map((node) => (
          <g key={`node-${node.id}`}>
            <circle cx={node.x} cy={node.y} r={14} fill="#ffffff" stroke={filterColor(node.filter)} strokeWidth={3} />
            <text x={node.x} y={node.y + 3.5} textAnchor="middle" fontSize={9} fontWeight={700} fill="#1a1a1a">
              {initials(node.name)}
            </text>
            <text x={node.x} y={node.y + 27} textAnchor="middle" fontSize={10} fontWeight={600} fill="#333333">
              {short(node.name)}
            </text>
          </g>
        ))}
        <circle cx={center.x} cy={center.y} r={24} fill="#1a1a1a" />
        <text x={center.x} y={center.y + 4.5} textAnchor="middle" fontSize={13} fontWeight={700} fill="#ffffff">
          {initials(center.name)}
        </text>
      </svg>

      <ul className="divide-y divide-paper-200 rounded-xl border border-paper-300" aria-label={`Verbanden van ${center.name}`}>
        {nodes.map((node) => {
          const label = pmRelationLabel(node.relation.relation_type, node.relation.mechanism, node.relation.functie);
          return (
            <li key={node.id}>
              <Link
                href={actorHref(`pm-${node.id}`, { kind: kindForPmType(node.type), name: node.name, demo })}
                className="flex min-h-[44px] items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-paper-100"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: filterColor(node.filter) }}
                  title={filterLabel(node.filter)}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-ink-500">{node.outgoing ? `${label} →` : `← ${label}`}</span>
                  <span className="font-semibold text-ink-900">{node.name}</span>
                  {node.autoApproved ? <AutoApprovedTag className="ml-1.5 align-middle" /> : null}
                </span>
                <ChevronRight size={16} className="shrink-0 text-ink-400" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
      {total > nodes.length ? (
        <p className="text-xs text-ink-500">
          De {nodes.length} belangrijkste van {total} verbanden.
        </p>
      ) : null}
    </div>
  );
}
