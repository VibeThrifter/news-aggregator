/**
 * Event-level knowledge graph: outlets, perspectives, actors, entities, frames, claims,
 * contradictions, countries and related events. Built from the clues, so every node and edge
 * knows which clue reveals it (fog-of-war).
 */

import { getCountryName } from "@/lib/format";

import {
  actorNode,
  claimNode,
  contradictionNode,
  countryNode,
  entityNode,
  eventNode,
  fallacyNode,
  frameNode,
  gapNode,
  outletNode,
  perspectiveNode,
  relatedNode,
  statisticNode,
} from "./ids";
import { frameLabel, fallacyLabel } from "./labels";
import { truncate } from "./summary";
import type { Clue, EdgeKind, ExploreGraph, ExploreInput, GraphEdge, GraphNode, NodeId, NodeKind } from "./types";

const MAX_ENTITIES = 12;

class GraphBuilder {
  readonly nodes = new Map<NodeId, GraphNode>();
  readonly edges = new Map<string, GraphEdge>();

  node(id: NodeId, kind: NodeKind, label: string, extra: Partial<GraphNode> = {}): GraphNode {
    const existing = this.nodes.get(id);
    if (existing) {
      if (extra.clueIds) {
        existing.clueIds = Array.from(new Set([...existing.clueIds, ...extra.clueIds]));
      }
      if (extra.baseline) existing.baseline = true;
      if (extra.weight && extra.weight > existing.weight) existing.weight = extra.weight;
      return existing;
    }
    const node: GraphNode = { id, kind, label, clueIds: [], baseline: false, weight: 1, ...extra };
    this.nodes.set(id, node);
    return node;
  }

  edge(source: NodeId, target: NodeId, kind: EdgeKind, extra: Partial<GraphEdge> = {}): void {
    if (source === target || !this.nodes.has(source) || !this.nodes.has(target)) return;
    const id = `${kind}|${source}|${target}`;
    const existing = this.edges.get(id);
    if (existing) {
      existing.clueIds = Array.from(new Set([...existing.clueIds, ...(extra.clueIds ?? [])]));
      return;
    }
    this.edges.set(id, { id, source, target, kind, clueIds: [], ...extra });
  }
}

export function buildGraph(input: ExploreInput, clues: Clue[]): ExploreGraph {
  const g = new GraphBuilder();
  const event = eventNode(input.event.id);
  g.node(event, "event", input.event.title, { baseline: true, weight: 3 });

  for (const outlet of input.outlets) {
    const id = outletNode(outlet.key);
    g.node(id, "outlet", outlet.name, {
      baseline: true,
      weight: 1 + outlet.articleIds.length,
      outletKey: outlet.key,
      iso: outlet.country ?? undefined,
    });
    g.edge(event, id, "reports");
  }

  // Entities from NER (top by salience); actors that match an entity alias share the entity
  const aliasToEntity = new Map<string, string>();
  const entities = [...input.entities].sort((a, b) => b.salience - a.salience).slice(0, MAX_ENTITIES);
  for (const entity of entities) {
    const id = entityNode(entity.entity_key);
    g.node(id, "entity", entity.name, {
      baseline: true,
      weight: 1 + entity.mention_count,
      entityKey: entity.entity_key,
      iso: entity.iso_code ?? undefined,
    });
    for (const alias of entity.aliases) {
      aliasToEntity.set(alias, entity.entity_key);
    }
    for (const [sourceName, count] of Object.entries(entity.outlet_counts ?? {})) {
      const outlet = input.outlets.find((candidate) => candidate.name === sourceName || candidate.key === sourceName);
      if (outlet) {
        g.edge(outletNode(outlet.key), id, "mentions", { label: `${count}×` });
      }
    }
  }

  const actorId = (slug: string): NodeId => {
    const entityKey = aliasToEntity.get(slug);
    return entityKey ? entityNode(entityKey) : actorNode(slug);
  };
  const addActor = (slug: string, label: string, clueId: string): NodeId => {
    const id = actorId(slug);
    g.node(id, id.startsWith("entity:") ? "entity" : "actor", label, { clueIds: [clueId], weight: 2 });
    return id;
  };

  for (const clue of clues) {
    const body = clue.body;
    const reveal = { clueIds: [clue.id] };
    switch (body.type) {
      case "perspective": {
        const id = perspectiveNode(body.index);
        g.node(id, "perspective", body.cluster.label, {
          ...reveal,
          maskedLabel: `Invalshoek ${body.index + 1}`,
          weight: 1 + body.stances.length,
        });
        for (const stance of body.stances) {
          g.edge(outletNode(stance.outletKey), id, "perspective", reveal);
        }
        break;
      }
      case "voices": {
        for (const actor of body.actors) {
          const id = addActor(actor.key, actor.name, clue.id);
          g.edge(outletNode(body.outletKey), id, "quotes", { ...reveal, label: actor.role ?? undefined });
        }
        break;
      }
      case "authority": {
        const id = addActor(body.actorKey, body.authority.authority, clue.id);
        if (body.outletKey) {
          g.edge(outletNode(body.outletKey), id, "quotes", { ...reveal, label: body.authority.authority_type });
        }
        break;
      }
      case "claim": {
        const id = claimNode(body.claim.claim);
        g.node(id, "claim", truncate(body.claim.claim, 70), { ...reveal, maskedLabel: "Claim" });
        const actor = addActor(body.actorKey, body.claim.source_in_article || "Onbekend", clue.id);
        g.edge(actor, id, "claims", reveal);
        if (body.outletKey) g.edge(outletNode(body.outletKey), id, "publishes_claim", reveal);
        break;
      }
      case "contradiction": {
        const id = contradictionNode(body.contradiction.topic);
        g.node(id, "contradiction", truncate(body.contradiction.topic, 60), {
          ...reveal,
          maskedLabel: "Tegenspraak",
          weight: 2,
        });
        for (const key of body.outletsA) g.edge(outletNode(key), id, "contradicts", { ...reveal, label: "A" });
        for (const key of body.outletsB) g.edge(outletNode(key), id, "contradicts", { ...reveal, label: "B" });
        break;
      }
      case "fallacy": {
        const id = fallacyNode(`${body.fallacy.type}:${body.fallacy.description}`);
        g.node(id, "fallacy", fallacyLabel(body.fallacy.type), { ...reveal, maskedLabel: "Redeneerfout" });
        for (const key of clue.outletKeys) g.edge(outletNode(key), id, "fallacy", reveal);
        break;
      }
      case "statistic": {
        const id = statisticNode(body.issue.claim);
        g.node(id, "statistic", truncate(body.issue.claim, 60), { ...reveal, maskedLabel: "Cijfer" });
        if (body.outletKey) g.edge(outletNode(body.outletKey), id, "statistic", reveal);
        break;
      }
      case "frame": {
        const id = frameNode(body.frame.frame_type);
        g.node(id, "frame", frameLabel(body.frame.frame_type), { ...reveal, maskedLabel: "Frame ?" });
        const own = body.frame.attribution !== "geciteerd";
        for (const key of clue.outletKeys) {
          g.edge(outletNode(key), id, "frames", { ...reveal, attribution: own ? "eigen_framing" : "geciteerd" });
        }
        break;
      }
      case "gap": {
        const id = gapNode(body.gap.perspective);
        g.node(id, "gap", truncate(body.gap.perspective, 60), { ...reveal, maskedLabel: "Ontbrekend" });
        g.edge(event, id, "involves", { ...reveal, label: "ontbreekt" });
        break;
      }
      case "country": {
        const id = countryNode(body.country.iso_code);
        g.node(id, "country", getCountryName(body.country.iso_code), { ...reveal, iso: body.country.iso_code });
        g.edge(event, id, "involves", reveal);
        break;
      }
      case "international": {
        if (body.country) {
          const id = countryNode(body.country);
          g.node(id, "country", getCountryName(body.country), { ...reveal, iso: body.country });
          for (const key of clue.outletKeys) g.edge(outletNode(key), id, "involves", reveal);
        }
        break;
      }
      default:
        break;
    }
  }

  for (const relation of input.relations) {
    const id = relatedNode(relation.related_event_id);
    g.node(id, "related", relation.related_title, {
      baseline: true,
      weight: 1 + relation.score * 3,
      relatedEventId: relation.related_event_id,
      relatedSlug: relation.related_slug ?? null,
    });
    g.edge(event, id, "related", { label: relationLabel(relation.reasons) });
    for (const reason of relation.reasons) {
      if (reason.type === "entity" && g.nodes.has(entityNode(reason.key))) {
        g.edge(entityNode(reason.key), id, "related");
      }
    }
  }

  const nodes = Array.from(g.nodes.values());
  return { nodes, edges: Array.from(g.edges.values()), nodeById: new Map(nodes.map((node) => [node.id, node])) };
}

function relationLabel(reasons: ExploreInput["relations"][number]["reasons"]): string | undefined {
  const first = reasons[0];
  if (!first) return undefined;
  switch (first.type) {
    case "entity":
      return first.name;
    case "country":
      return getCountryName(first.iso);
    case "category":
      return "zelfde categorie";
    case "topic":
      return "zelfde thema";
    default:
      return undefined;
  }
}
