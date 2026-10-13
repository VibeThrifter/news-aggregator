/**
 * Stable node ids for the exploration graph.
 */

import { fnv1a } from "./normalize";
import type { NodeId } from "./types";

export const outletNode = (key: string): NodeId => `outlet:${key}`;
export const perspectiveNode = (index: number): NodeId => `perspective:${index}`;
export const actorNode = (slug: string): NodeId => `actor:${slug}`;
export const frameNode = (type: string): NodeId => `frame:${type}`;
export const claimNode = (text: string): NodeId => `claim:${fnv1a(text)}`;
export const contradictionNode = (topic: string): NodeId => `contradiction:${fnv1a(topic)}`;
export const fallacyNode = (key: string): NodeId => `fallacy:${fnv1a(key)}`;
export const statisticNode = (text: string): NodeId => `statistic:${fnv1a(text)}`;
export const gapNode = (text: string): NodeId => `gap:${fnv1a(text)}`;
