import type { SyntaxNode } from "@lezer/common";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { inlineDelimiters, scanTags, spans, wikilink } from "../../../../rules/syntax";
import type { MarkdownRenderContext } from "./render-types";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character]!);
}
export function sourceAttributes(from: number, to: number): string {
  return ` data-md-from="${from}" data-md-to="${to}"`;
}
export function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").normalize("NFC").toLowerCase();
}

const INLINE_TAGS: Record<string, string> = {
  Emphasis: "em", StrongEmphasis: "strong", Strikethrough: "del", Subscript: "sub", Superscript: "sup",
};
const INLINE_MARKS: Record<string, true> = {
  EmphasisMark: true, StrikethroughMark: true, SubscriptMark: true, SuperscriptMark: true,
};
const LITERAL_NODES: Record<string, true> = {
  InlineCode: true, Autolink: true, HTMLTag: true, Comment: true, ProcessingInstruction: true, Escape: true,
};

function text(context: MarkdownRenderContext, from: number, to: number): string {
  return from < to ? `<span${sourceAttributes(from, to)}>${escapeHtml(context.source.slice(from, to))}</span>` : "";
}

function attribute(value: string): string {
  // Entities remain entities in HTML attributes; literal quotes never become delimiters.
  return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])|&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);|[&<>"']/gi,
    (match, escaped: string | undefined) => escaped !== undefined ? escapeHtml(escaped)
      : match.startsWith("&") && match.endsWith(";") ? match : escapeHtml(match));
}

function imagePresentation(label: string): { alt: string; dimensions: string } {
  const match = /^(.*)\|([1-9]\d{0,4})(?:x([1-9]\d{0,4}))?$/u.exec(label);
  if (!match) return { alt: label, dimensions: "" };
  const width = Number(match[2]);
  const height = match[3] === undefined ? null : Number(match[3]);
  if (width > 10_000 || (height !== null && height > 10_000)) {
    return { alt: label, dimensions: "" };
  }
  return {
    alt: match[1]!,
    dimensions: ` width="${width}"${height === null ? "" : ` height="${height}"`}`,
  };
}

interface Piece { from: number; to: number; priority?: number; html: () => string }

interface InlineMath {
  readonly from: number;
  readonly to: number;
  readonly contentFrom: number;
  readonly contentTo: number;
}

function escaped(value: string, at: number): boolean {
  let slashes = 0;
  for (let index = at - 1; index >= 0 && value[index] === "\\"; index--) slashes++;
  return slashes % 2 === 1;
}

export function scanInlineMath(value: string): InlineMath[] {
  const found: InlineMath[] = [];
  for (let from = 0; from < value.length; from++) {
    if (value[from] !== "$" || value[from + 1] === "$" || escaped(value, from)) continue;
    const contentFrom = from + 1;
    if (contentFrom >= value.length || /\s/.test(value[contentFrom]!)) continue;
    for (let to = contentFrom + 1; to < value.length; to++) {
      if (value[to] !== "$" || value[to + 1] === "$" || escaped(value, to)) continue;
      if (/\s/.test(value[to - 1]!)) continue;
      if (value.slice(contentFrom, to).trim() === "") break;
      found.push({ from, to: to + 1, contentFrom, contentTo: to });
      from = to;
      break;
    }
  }
  return found;
}

interface InlineFootnote {
  readonly from: number;
  readonly to: number;
  readonly contentFrom: number;
  readonly contentTo: number;
}

function scanInlineFootnotes(value: string): InlineFootnote[] {
  const found: InlineFootnote[] = [];
  for (let from = 0; from + 3 < value.length; from++) {
    if (value[from] !== "^" || value[from + 1] !== "[" || escaped(value, from)) continue;
    let depth = 1;
    for (let index = from + 2; index < value.length; index++) {
      if (escaped(value, index)) continue;
      if (value[index] === "[") depth++;
      if (value[index] === "]" && --depth === 0) {
        if (index > from + 2) {
          found.push({ from, to: index + 1, contentFrom: from + 2, contentTo: index });
          from = index;
        }
        break;
      }
    }
  }
  return found;
}

function renderNode(context: MarkdownRenderContext, node: SyntaxNode): string {
  const source = context.source;
  const raw = source.slice(node.from, node.to);
  const attrs = sourceAttributes(node.from, node.to);
  const tag = INLINE_TAGS[node.name];
  if (node.name === "QuoteMark") return "";
  if (tag) {
    let first: SyntaxNode | null = null, last: SyntaxNode | null = null;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (INLINE_MARKS[child.name]) {
        first ??= child;
        last = child;
      }
    }
    return `<${tag}${attrs}>${renderInline(context, first?.to ?? node.from, last?.from ?? node.to, node)}</${tag}>`;
  }
  if (node.name === "InlineCode") {
    const marks = node.getChildren("CodeMark");
    let from = marks[0]?.to ?? node.from;
    let to = marks[marks.length - 1]?.from ?? node.to;
    let value = source.slice(from, to).replace(/\n/g, " ");
    if (value.startsWith(" ") && value.endsWith(" ") && /\S/.test(value)) {
      from++;
      to--;
      value = value.slice(1, -1);
    }
    return `<code${sourceAttributes(from, to)}>${escapeHtml(value)}</code>`;
  }
  if (node.name === "Escape") return text(context, node.from + 1, node.to);
  if (node.name === "Entity") return `<span${attrs}>${raw}</span>`;
  if (node.name === "HardBreak") return `<br${attrs}>`;
  if (node.name === "Autolink") {
    const label = raw.startsWith("<") ? raw.slice(1, -1) : raw;
    const href = label.includes("@") && !/^[a-z][\w+.-]*:/i.test(label) ? `mailto:${label}` : label;
    return `<a href="${attribute(href)}"${attrs}>${escapeHtml(label)}</a>`;
  }
  if (node.name === "Link" || node.name === "Image") {
    const noteLabel = /^\[\^([^\]]+)\]$/.exec(raw);
    if (noteLabel && node.name === "Link") {
      const note = context.footnotes.get(normalizeLabel(noteLabel[1]!));
      const occurrence = note?.references.get(node.from);
      if (note && occurrence !== undefined) {
        return `<sup${attrs}><a class="footnote-ref" id="fnref-${note.number}-${occurrence}" href="#fn-${note.number}" data-md-anchor="fn-${note.number}">${note.number}</a></sup>`;
      }
    }
    const marks = node.getChildren("LinkMark");
    const opener = marks[0];
    const closer = marks.find((mark) => source[mark.from] === "]");
    if (!opener || !closer) return text(context, node.from, node.to);
    const labelFrom = opener.to;
    const labelTo = closer.from;
    const label = source.slice(labelFrom, labelTo);
    const url = node.getChild("URL");
    const title = node.getChild("LinkTitle");
    const reference = node.getChild("LinkLabel");
    const definition = context.references.get(normalizeLabel(reference
      ? source.slice(reference.from + 1, reference.to - 1) || label : label));
    let href = url ? source.slice(url.from, url.to) : definition?.href;
    if (href === undefined) return text(context, node.from, node.to);
    if (href.startsWith("<") && href.endsWith(">")) href = href.slice(1, -1);
    const caption = title ? source.slice(title.from + 1, title.to - 1) : definition?.title;
    const titleAttr = caption === undefined ? "" : ` title="${attribute(caption)}"`;
    if (node.name === "Image") {
      const presentation = imagePresentation(label);
      return `<img src="${attribute(href)}" alt="${attribute(presentation.alt)}"${titleAttr}${presentation.dimensions}${attrs}>`;
    }
    const internal = href !== "" && !href.startsWith("#") && !/^[a-z][\w+.-]*:/i.test(href);
    const anchor = href.startsWith("#") ? ` data-md-anchor="${attribute(href.slice(1))}"` : "";
    return `<a href="${attribute(href)}"${internal ? ` class="internal-path" data-path="${attribute(href)}"` : ""}${anchor}${titleAttr}${attrs}>${renderInline(context, labelFrom, labelTo, node)}</a>`;
  }
  if (LITERAL_NODES[node.name]) return text(context, node.from, node.to);
  return renderInline(context, node.from, node.to, node);
}

/** One source-mapped renderer for both block widgets and the reading surface. */
export function renderInline(context: MarkdownRenderContext, from: number, to: number, node?: SyntaxNode): string {
  if (from >= to) return "";
  const root = node ?? markdownLanguage.parser.parse(context.source).topNode;
  const pieces: Piece[] = [];
  const protectedRanges: Array<{ from: number; to: number }> = [];
  function protect(current: SyntaxNode): void {
    if (current.to <= from || current.from >= to) return;
    if (LITERAL_NODES[current.name] || current.name === "URL" || current.name === "LinkTitle") {
      protectedRanges.push(current);
      return;
    }
    for (let child = current.firstChild; child; child = child.nextSibling) protect(child);
  }
  function collectPieces(current: SyntaxNode): void {
    for (let child = current.firstChild; child; child = child.nextSibling) {
      if (child.to <= from || child.from >= to) continue;
      if (child.from >= from && child.to <= to && child.to > child.from) {
        const captured = child;
        pieces.push({ from: child.from, to: child.to, html: () => renderNode(context, captured) });
      } else {
        collectPieces(child);
      }
    }
  }
  collectPieces(root);
  protect(root);
  const free = (start: number, end: number) => protectedRanges.every((range) => end <= range.from || start >= range.to);
  const delimiters = inlineDelimiters(context.forms);
  let lineFrom = from;
  while (lineFrom < to) {
    const newline = context.source.indexOf("\n", lineFrom);
    const lineTo = newline < 0 ? to : Math.min(to, newline);
    const row = context.source.slice(lineFrom, lineTo);
    const base = lineFrom;
    const wikiRanges: Array<{ from: number; to: number }> = [];
    for (const note of scanInlineFootnotes(row)) {
      const start = base + note.from, end = base + note.to;
      if (protectedRanges.some((range) => start >= range.from && start < range.to
        || end > range.from && end <= range.to)) continue;
      pieces.push({
        from: start,
        to: end,
        priority: 3,
        html: () => `<sup class="footnote-inline"${sourceAttributes(start, end)}>${renderInline(context, base + note.contentFrom, base + note.contentTo, root)}</sup>`,
      });
    }
    for (const math of scanInlineMath(row)) {
      const start = base + math.from, end = base + math.to;
      if (!free(start, end)) continue;
      const tex = row.slice(math.contentFrom, math.contentTo);
      pieces.push({
        from: start,
        to: end,
        priority: 2,
        html: () => `<span class="math-inline" data-tex="${escapeHtml(tex)}"${sourceAttributes(start, end)}>${escapeHtml(tex)}</span>`,
      });
    }
    for (const link of wikilink(row)) {
      const start = base + link.from, end = base + link.to;
      if ((!link.page && !link.heading && !link.block) || !free(start, end)) continue;
      wikiRanges.push({ from: start, to: end });
      pieces.push({ from: start, to: end, priority: 1, html: () => {
        const label = link.alias ?? link.target;
        const data = ` data-${link.embed ? "embed" : "wikilink"}-page="${escapeHtml(link.page)}"`
          + (link.heading ? ` data-${link.embed ? "embed" : "wikilink"}-heading="${escapeHtml(link.heading)}"` : "")
          + (link.block ? ` data-${link.embed ? "embed" : "wikilink"}-block="${escapeHtml(link.block)}"` : "");
        if (link.embed) {
          // `![[foto.png|120]]` e `![[foto.png|200x100]]`: il dopo-barra è una
          // dimensione per chi incorpora, non un'etichetta da mostrare.
          const size = link.alias !== null && /^\s*\d{1,5}(?:x\d{1,5})?\s*$/.test(link.alias) ? link.alias.trim() : null;
          const shown = size !== null ? link.target : label;
          const sized = size !== null ? ` data-embed-size="${escapeHtml(size)}"` : "";
          return `<span class="embed"${data}${sized}${sourceAttributes(start, end)}>${escapeHtml(shown)}</span>`;
        }
        let labelFrom = link.alias !== null ? row.indexOf("|", link.innerFrom) + 1 : link.innerFrom;
        if (link.alias !== null) while (labelFrom < link.innerA && /\s/.test(row[labelFrom]!)) labelFrom++;
        const visibleFrom = base + labelFrom;
        return `<a class="wikilink" href="#"${data}${sourceAttributes(start, end)}><span${sourceAttributes(visibleFrom, visibleFrom + label.length)}>${escapeHtml(label)}</span></a>`;
      }});
    }
    for (const span of spans(row, delimiters)) {
      const start = base + span.from, end = base + span.to;
      if (!free(start, end)) continue;
      // Un commento resta nel file e non nella resa (`fub:comments`), e con
      // lui ciò che contiene: link e tag dentro un commento non si vedono.
      if (span.name === "fub:comments") {
        pieces.push({ from: start, to: end, priority: 4, html: () => "" });
        continue;
      }
      if (wikiRanges.some((range) => start < range.to && end > range.from)) continue;
      pieces.push({ from: start, to: end, html: () => `<mark class="inline-highlight"${sourceAttributes(start, end)}>${renderInline(context, base + span.contentFrom, base + span.contentTo, root)}</mark>` });
    }
    for (const tag of scanTags(row)) {
      const start = base + tag.from, end = base + tag.to;
      if (!free(start, end) || wikiRanges.some((range) => start < range.to && end > range.from)) continue;
      pieces.push({ from: start, to: end, html: () => `<span class="tag" data-tag="${escapeHtml(tag.name)}"${sourceAttributes(start, end)}>${escapeHtml(context.source.slice(start, end))}</span>` });
    }
    lineFrom = lineTo + 1;
  }
  pieces.sort((left, right) => left.from - right.from || right.to - left.to || (right.priority ?? 0) - (left.priority ?? 0));
  let position = from;
  let html = "";
  for (const piece of pieces) {
    if (piece.from < position || piece.to > to) continue;
    html += text(context, position, piece.from) + piece.html();
    position = piece.to;
  }
  return html + text(context, position, to);
}
