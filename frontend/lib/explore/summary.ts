/**
 * Helpers for the LLM summary ("Title\n\nMarkdown body ...").
 * The first line is the LLM-generated title — the only title we may show for an event (copyright).
 */

export interface SplitSummary {
  /** LLM title (untruncated) */
  title: string | null;
  /** Markdown body without the title line */
  body: string;
  /** First real paragraph of the body as plain text (for the teaser) */
  firstParagraph: string;
}

export function splitLlmSummary(summary: string | null | undefined): SplitSummary {
  if (!summary || !summary.trim()) {
    return { title: null, body: "", firstParagraph: "" };
  }
  const text = summary.replace(/\r\n/g, "\n").trim();

  let title: string | null = null;
  let body = text;
  const blankLine = text.match(/^([^\n]+)\n\s*\n([\s\S]*)$/);
  if (blankLine) {
    title = blankLine[1].trim();
    body = blankLine[2].trim();
  } else {
    const firstLine = text.split("\n")[0];
    if (firstLine.length <= 90 && text.includes("\n")) {
      title = firstLine.trim();
      body = text.slice(firstLine.length).trim();
    } else {
      const sentence = text.match(/^(.+?[.!?])\s+([\s\S]*)$/);
      if (sentence) {
        title = sentence[1].trim();
        body = sentence[2].trim();
      } else {
        title = text;
        body = "";
      }
    }
  }
  if (title) {
    title = stripMarkdown(title).replace(/[.:]$/, "").trim() || null;
  }

  return { title, body, firstParagraph: firstParagraphOf(body) };
}

function firstParagraphOf(markdown: string): string {
  const paragraphs = markdown
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const paragraph of paragraphs) {
    // Skip headings: "**Kopje**" alone on a line, or "# Kopje"
    if (/^#{1,6}\s/.test(paragraph)) continue;
    if (/^\*\*[^*]+\*\*:?$/.test(paragraph)) continue;
    const plain = stripMarkdown(paragraph);
    if (plain.length > 0) {
      return plain;
    }
  }
  return "";
}

/** Remove the markdown the LLM uses (bold/italic, headings, links, list markers). */
export function stripMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** A heading on its own line: "# Kopje" or "**Kopje**". */
const HEADING_LINE = /^(#{1,6}\s.*|\*\*[^*]+\*\*:?)$/;
const LIST_ITEM = /^([-*+]|\d+[.)])\s/;
/** End of a sentence: . ! ? … (and closing quotes), a space, then a capital, digit or opening quote. */
const SENTENCE_END = /[.!?…]+["'”’»)]*\s+(?=["'“‘„«(]?[\p{Lu}\p{N}])/gu;
/** A period that does not end the sentence: initials ("J. Smith", "U.S.") and abbreviations ("o.a.", "dhr."). */
const ABBREVIATION = /(?:^|[\s("'“‘„])(?:\p{Lu}(?:\.\p{Lu})*|\p{Ll}(?:\.\p{Ll})+|bijv|bv|ca|dhr|mevr|mr|dr|drs|ir|prof|nr|St|vs)\.$/u;

/** Split plain text into sentences. */
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  for (const match of text.matchAll(SENTENCE_END)) {
    const index = match.index ?? 0;
    const sentence = text.slice(start, index + match[0].trimEnd().length).trim();
    if (ABBREVIATION.test(sentence)) continue;
    if (sentence) sentences.push(sentence);
    start = index + match[0].length;
  }
  const rest = text.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences;
}

/** The sentences of the summary body as plain text, without headings. */
export function summarySentences(markdown: string): string[] {
  const blocks: string[] = [];
  let lines: string[] = [];
  const flush = () => {
    if (lines.length) blocks.push(lines.join(" "));
    lines = [];
  };
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (!line || HEADING_LINE.test(line)) {
      flush();
      continue;
    }
    if (LIST_ITEM.test(line)) flush();
    lines.push(line.replace(LIST_ITEM, ""));
  }
  flush();
  return blocks.flatMap((block) => splitSentences(stripMarkdown(block)));
}

/** Shorten text at a word boundary. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, "")}…`;
}
