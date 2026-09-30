/**
 * Tiny mdast transformer that turns known outlet and entity names in the summary into
 * `pluri:` links, which the UI renders as buttons (click-through to balloons and panels).
 * Word boundaries are checked manually (no lookbehind regex: crashes Safari < 16.4).
 */

export interface LinkTarget {
  /** Text to find (exact, case-sensitive) */
  text: string;
  /** e.g. "pluri:outlet:nos" or "pluri:entity:org:nordvind" */
  href: string;
}

export interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

const LETTER = /[\p{L}\p{N}]/u;

function isBoundary(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) return true;
  return !LETTER.test(text.charAt(index));
}

/** Split a text into text/link segments for the given targets (longest match first, first occurrence only per target). */
export function linkifyText(text: string, targets: LinkTarget[], used: Set<string>): MdNode[] {
  const segments: MdNode[] = [];
  let rest = text;
  // Sort by length so "De Telegraaf" wins over "Telegraaf"
  const ordered = [...targets].sort((a, b) => b.text.length - a.text.length);
  while (rest.length > 0) {
    let best: { index: number; target: LinkTarget } | null = null;
    for (const target of ordered) {
      if (used.has(target.href) || target.text.length < 2) continue;
      let from = 0;
      while (from <= rest.length) {
        const index = rest.indexOf(target.text, from);
        if (index === -1) break;
        if (isBoundary(rest, index - 1) && isBoundary(rest, index + target.text.length)) {
          if (!best || index < best.index || (index === best.index && target.text.length > best.target.text.length)) {
            best = { index, target };
          }
          break;
        }
        from = index + 1;
      }
    }
    if (!best) {
      segments.push({ type: "text", value: rest });
      break;
    }
    if (best.index > 0) {
      segments.push({ type: "text", value: rest.slice(0, best.index) });
    }
    segments.push({ type: "link", url: best.target.href, children: [{ type: "text", value: best.target.text }] });
    used.add(best.target.href);
    rest = rest.slice(best.index + best.target.text.length);
  }
  return segments;
}

/** remark plugin factory: link each target once in the document (not inside existing links or headings). */
export function remarkEntityLinks(targets: LinkTarget[]) {
  return () => (tree: MdNode) => {
    const used = new Set<string>();
    const walk = (node: MdNode) => {
      if (!node.children || node.type === "link" || node.type === "heading") return;
      const next: MdNode[] = [];
      for (const child of node.children) {
        if (child.type === "text" && child.value) {
          next.push(...linkifyText(child.value, targets, used));
        } else {
          walk(child);
          next.push(child);
        }
      }
      node.children = next;
    };
    walk(tree);
  };
}
