import { markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";
import type { SyntaxForm } from "../../../../host/contract";
import { declaredFences } from "../../../../rules/syntax";
import { normalizeLineBreaks } from "../../../../rules/offsets";
import { taskChecked } from "../../../../rules/mirrored";
import { escapeHtml, normalizeLabel, renderInline, sourceAttributes } from "./render-inline";
import type {
  MarkdownBlock,
  MarkdownDocument,
  MarkdownFootnote,
  MarkdownLinkDefinition,
  MarkdownRenderContext,
} from "./render-types";

// Block-level renderer sharing one Lezer GFM parse between the two surfaces.
// Live reuses CodeMirror's tree when complete, otherwise it parses the buffer.
// Source attributes are UTF-16 offsets on LF-normalized text; inline detail
// comes from `render-inline`. Allowed raw HTML blocks remain inert data until
// the shared mount sanitizes them into fresh DOM nodes.

// Initial `---` block (optional BOM) closed by `---`/`...`. The body must hold
// a `:` (or be empty) so a leading rule plus heading is not misread.
function detectFrontmatter(source: string): { from: number; to: number } | null {
  let start = 0;
  if (source.startsWith("﻿")) start = 1;
  const firstEnd = source.indexOf("\n", start);
  if (firstEnd === -1 || source.slice(start, firstEnd).trim() !== "---") return null;
  let pos = firstEnd + 1;
  for (;;) {
    const next = source.indexOf("\n", pos);
    const line = (next === -1 ? source.slice(pos) : source.slice(pos, next)).trim();
    if (line === "---" || line === "...") {
      const to = next === -1 ? source.length : next + 1;
      const inner = source.slice(firstEnd + 1, pos);
      if (inner.trim() === "" || inner.includes(":")) return { from: 0, to };
      return null;
    }
    if (next === -1) return null;
    pos = next + 1;
  }
}

function isAlphaNum(char: string): boolean {
  return /[\p{Alphabetic}\p{Nd}\p{Nl}\p{No}]/u.test(char);
}

function headingSlug(text: string): string {
  const composed = text.normalize("NFC");
  let slug = "";
  let lastDash = false;
  for (const char of composed) {
    if (isAlphaNum(char)) {
      slug += char.toLowerCase();
      lastDash = false;
    } else if ((char === "-" || char === "_" || /\s/.test(char)) && !lastDash && slug.length > 0) {
      slug += "-";
      lastDash = true;
    }
  }
  while (slug.endsWith("-")) slug = slug.slice(0, -1);
  return slug;
}

function canonicalAnchor(id: string): string {
  return id.trim().normalize("NFC").toLowerCase();
}

function validAnchor(id: string): boolean {
  if (id.length === 0) return false;
  for (const char of id) {
    if (char === "-" || char === "_") continue;
    if (!isAlphaNum(char)) return false;
  }
  return true;
}

class HeadingSlugs {
  private taken = new Set<string>();
  next(text: string): string {
    const base = headingSlug(text);
    if (!this.taken.has(base)) {
      this.taken.add(base);
      return base;
    }
    for (let n = 1; ; n++) {
      const candidate = base === "" ? String(n) : `${base}-${n}`;
      if (!this.taken.has(candidate)) {
        this.taken.add(candidate);
        return candidate;
      }
    }
  }
}

export function findTrailingAnchor(slice: string): { raw: string; start: number } | null {
  const text = slice.replace(/[ \t\n]+$/, "");
  const at = text.lastIndexOf("^");
  if (at === -1) return null;
  const written = text.slice(at);
  if (/[\s]/.test(written.slice(1))) return null;
  const raw = written.slice(1);
  if (!validAnchor(raw)) return null;
  if (at > 0 && !/\s/.test(text[at - 1]!)) return null;
  return { raw, start: at };
}

function mdAttrs(from: number, to: number): string {
  const raw = sourceAttributes(from, to);
  if (!raw) return "";
  return raw.startsWith(" ") ? raw : ` ${raw}`;
}

function idAttr(id: string | null): string {
  return id === null || id === "" ? "" : ` id="${escapeHtml(id)}"`;
}

function rawHtmlBlock(source: string, from: number, to: number): string {
  const raw = source.slice(from, to);
  return `<div class="block-html block-html-allowed"${mdAttrs(from, to)} data-md-raw-html="${escapeHtml(raw)}"><pre>${escapeHtml(raw)}</pre></div>`;
}

interface FootnoteDef {
  readonly labelNorm: string;
  readonly from: number;
  readonly to: number;
  readonly contentFrom: number;
}

interface Collected {
  readonly references: ReadonlyMap<string, MarkdownLinkDefinition>;
  readonly footnotes: ReadonlyMap<string, MarkdownFootnote>;
  readonly headingIds: ReadonlyMap<number, string>;
}

function stripDelimiters(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === "(" && last === ")")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function collectDefinitions(source: string, tree: Tree): Collected {
  const references = new Map<string, MarkdownLinkDefinition>();
  const refOffsets = new Map<string, number[]>();
  const defs: FootnoteDef[] = [];
  const defSeen = new Set<string>();
  const refOrder: string[] = [];
  const refSeen = new Set<string>();
  const headingIds = new Map<number, string>();
  const slugs = new HeadingSlugs();

  const footnoteRefPattern = /^\[\^[^\]\r\n]+\]$/;

  function visit(node: SyntaxNode, insideFootnoteDef: boolean): void {
    const name = node.name;
    const definition = !insideFootnoteDef && (name === "Paragraph" || name === "LinkReference")
      ? /^\[\^([^\]\r\n]+)\]:(?:[ \t]|$)/.exec(source.slice(node.from, node.to))
      : null;
    if (definition) {
      const key = normalizeLabel(definition[1]!);
      if (key !== "" && !defSeen.has(key)) {
        defSeen.add(key);
        let contentFrom = node.from + definition[0].length;
        while (source[contentFrom] === " " || source[contentFrom] === "\t") contentFrom++;
        defs.push({ labelNorm: key, from: node.from, to: node.to, contentFrom });
      }
    } else
    if (/^(ATXHeading[1-6]|SetextHeading[1-2])$/.test(name)) {
      const slice = source.slice(node.from, node.to);
      const anchor = findTrailingAnchor(slice);
      if (anchor) {
        const canonical = canonicalAnchor(anchor.raw);
        headingIds.set(node.from, anchor.raw);
        slugs.next(canonical);
      } else {
        let title = slice;
        if (name.startsWith("ATX")) {
          title = title.replace(/^#{1,6}[ \t]*/, "").replace(/[ \t]+#+[ \t]*$/, "");
        } else {
          title = title.replace(/\n[ \t]*[=\-]+[ \t]*$/, "");
        }
        const slug = headingSlug(title.trim());
        if (slug !== "") headingIds.set(node.from, slugs.next(slug));
      }
    } else if (name === "LinkReference") {
      const labelNode = node.getChild("LinkLabel");
      const urlNode = node.getChild("URL");
      if (labelNode && urlNode) {
        const rawLabel = source.slice(labelNode.from + 1, labelNode.to - 1);
        const key = normalizeLabel(rawLabel);
        if (key !== "" && !references.has(key)) {
          let href = source.slice(urlNode.from, urlNode.to);
          if (href.length >= 2 && href.startsWith("<") && href.endsWith(">")) href = href.slice(1, -1);
          const titleNode = node.getChild("LinkTitle");
          const title = titleNode ? stripDelimiters(source.slice(titleNode.from, titleNode.to)) : undefined;
          references.set(key, title === undefined ? { href } : { href, title });
        }
      }
    } else if (name === "Link" && !insideFootnoteDef) {
      const text = source.slice(node.from, node.to);
      if (
        footnoteRefPattern.test(text) &&
        node.getChildren("URL").length === 0 &&
        node.getChildren("LinkLabel").length === 0
      ) {
        const key = normalizeLabel(text.slice(2, -1));
        if (key !== "") {
          const offsets = refOffsets.get(key) ?? [];
          offsets.push(node.from);
          refOffsets.set(key, offsets);
          if (!refSeen.has(key)) {
            refSeen.add(key);
            refOrder.push(key);
          }
        }
      }
    }
    const isDefPara =
      name === "Paragraph" && /^\[\^([^\]\r\n]+)\]:(?:[ \t]|$)/.test(source.slice(node.from, node.to));
    for (let child = node.firstChild; child; child = child.nextSibling) {
      visit(child, insideFootnoteDef || isDefPara);
    }
  }

  const top = tree.topNode;
  for (let child = top.firstChild; child; child = child.nextSibling) visit(child, false);

  const defKeys = new Set(defs.map((d) => d.labelNorm));
  const numbers = new Map<string, number>();
  let next = 1;
  for (const key of refOrder) {
    if (defKeys.has(key) && !numbers.has(key)) numbers.set(key, next++);
  }
  for (const def of defs) {
    if (!numbers.has(def.labelNorm)) numbers.set(def.labelNorm, next++);
  }
  const footnotes = new Map<string, MarkdownFootnote>();
  for (const def of defs) {
    const offsets = (refOffsets.get(def.labelNorm) ?? []).slice().sort((a, b) => a - b);
    const ordinals = new Map<number, number>();
    offsets.forEach((offset, index) => ordinals.set(offset, index + 1));
    footnotes.set(def.labelNorm, {
      label: def.labelNorm,
      number: numbers.get(def.labelNorm)!,
      from: def.from,
      to: def.to,
      contentFrom: def.contentFrom,
      references: ordinals,
    });
  }
  return { references, footnotes, headingIds };
}

interface RenderAux {
  readonly ctx: MarkdownRenderContext;
  readonly headingIds: ReadonlyMap<number, string>;
  readonly declared: ReadonlySet<string>;
}

const MATH_INFOS: Record<string, true> = { math: true, latex: true, tex: true };

function headingLevel(name: string): number {
  if (name === "SetextHeading1") return 1;
  if (name === "SetextHeading2") return 2;
  const match = /^ATXHeading([1-6])$/.exec(name);
  return match ? Number(match[1]) : 1;
}

function renderParagraphSegments(
  node: SyntaxNode,
  aux: RenderAux,
  marks: readonly { from: number; to: number }[],
  from: number,
  to: number,
): string {
  if (from >= to) return "";
  if (marks.length === 0) return renderInline(aux.ctx, from, to, node);
  const cuts = marks
    .filter((m) => m.from >= from && m.to <= to)
    .sort((a, b) => a.from - b.from);
  if (cuts.length === 0) return renderInline(aux.ctx, from, to, node);
  const parts: string[] = [];
  let pos = from;
  const source = aux.ctx.source;
  for (const cut of cuts) {
    if (cut.from > pos) parts.push(renderInline(aux.ctx, pos, cut.from, node));
    pos = cut.to;
    while (source[pos] === " " || source[pos] === "\t") pos++;
  }
  if (pos < to) parts.push(renderInline(aux.ctx, pos, to, node));
  return parts.filter((p) => p !== "").join(" ");
}

function directChildren(node: SyntaxNode, name: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) out.push(child);
  }
  return out;
}

function renderInnerBlocks(node: SyntaxNode, aux: RenderAux, quoteMarks: readonly { from: number; to: number }[]): string {
  let out = "";
  for (let child = node.firstChild; child; child = child.nextSibling) {
    out += renderInnerBlock(child, aux, quoteMarks);
  }
  return out;
}

function renderInnerBlock(
  node: SyntaxNode,
  aux: RenderAux,
  quoteMarks: readonly { from: number; to: number }[],
): string {
  const source = aux.ctx.source;
  switch (node.name) {
    case "QuoteMark":
    case "ListMark":
    case "HeaderMark":
    case "CodeMark":
    case "EmphasisMark":
    case "StrikethroughMark":
    case "LinkMark":
    case "TableDelimiter":
      return "";
    case "Paragraph": {
      const slice = source.slice(node.from, node.to);
      if (/^\[\^([^\]\r\n]+)\]:(?:[ \t]|$)/.test(slice)) return renderFootnoteDefNode(node, aux);
      const anchor = findTrailingAnchor(slice);
      let id: string | null = null;
      let to = node.to;
      if (anchor && anchor.start > 0) {
        id = canonicalAnchor(anchor.raw);
        to = node.from + anchor.start;
        while (to > node.from && (source[to - 1] === " " || source[to - 1] === "\t")) to--;
      }
      const inner = renderParagraphSegments(node, aux, quoteMarks, node.from, to);
      return `<p${idAttr(id)}${mdAttrs(node.from, node.to)}>${inner}</p>`;
    }
    case "Task": {
      const marker = node.getChild("TaskMarker");
      let contentFrom = marker ? marker.to : node.from;
      if (source[contentFrom] === " " || source[contentFrom] === "\t") contentFrom++;
      return renderInline(aux.ctx, contentFrom, node.to, node);
    }
    case "BulletList":
    case "OrderedList":
      return renderListNode(node, aux);
    case "ListItem":
      return renderListItemNode(node, aux);
    case "Blockquote":
      return renderBlockquoteNode(node, aux);
    case "FencedCode":
    case "CodeBlock":
      return renderCodeNode(node, aux);
    case "Table":
      return renderTableNode(node, aux);
    case "HorizontalRule":
      return `<hr${mdAttrs(node.from, node.to)}>`;
    case "LinkReference":
      return /^\[\^/.test(source.slice(node.from, node.to)) ? renderFootnoteDefNode(node, aux) : "";
    case "HTMLBlock":
      return rawHtmlBlock(source, node.from, node.to);
    case "CommentBlock":
      return "";
    case "ProcessingInstructionBlock":
      return `<div class="block-html"${mdAttrs(node.from, node.to)}><pre>${escapeHtml(source.slice(node.from, node.to))}</pre></div>`;
    case "TableHeader":
    case "TableRow":
    case "TableCell":
      return "";
    default:
      if (/^(ATXHeading[1-6]|SetextHeading[1-2])$/.test(node.name)) return renderHeadingNode(node, aux);
      if (node.firstChild) return renderInnerBlocks(node, aux, quoteMarks);
      return renderInline(aux.ctx, node.from, node.to, node);
  }
}

function renderHeadingNode(node: SyntaxNode, aux: RenderAux): string {
  const source = aux.ctx.source;
  const level = headingLevel(node.name);
  const rawId = aux.headingIds.get(node.from) ?? null;
  const id = rawId === null || rawId === "" ? null : rawId;
  const marks = node.getChildren("HeaderMark");
  let contentFrom = node.from;
  let contentTo = node.to;
  if (node.name.startsWith("ATX")) {
    if (marks.length > 0) {
      contentFrom = marks[0]!.to;
      while (source[contentFrom] === " " || source[contentFrom] === "\t") contentFrom++;
    }
    if (marks.length > 1) {
      contentTo = marks[marks.length - 1]!.from;
      while (contentTo > contentFrom && (source[contentTo - 1] === " " || source[contentTo - 1] === "\t")) contentTo--;
    }
  } else if (marks.length > 0) {
    contentTo = marks[marks.length - 1]!.from;
    while (contentTo > contentFrom && /\s/.test(source[contentTo - 1]!)) contentTo--;
  }
  const anchor = findTrailingAnchor(source.slice(contentFrom, contentTo));
  if (anchor && anchor.start > 0) {
    contentTo = contentFrom + anchor.start;
    while (contentTo > contentFrom && (source[contentTo - 1] === " " || source[contentTo - 1] === "\t")) contentTo--;
  }
  const inner = contentFrom < contentTo ? renderInline(aux.ctx, contentFrom, contentTo, node) : "";
  return `<h${level}${idAttr(id)}${mdAttrs(node.from, node.to)}>${inner}</h${level}>`;
}
function renderListNode(node: SyntaxNode, aux: RenderAux): string {
  const source = aux.ctx.source;
  const ordered = node.name === "OrderedList";
  let startAttr = "";
  if (ordered) {
    for (let item = node.firstChild; item; item = item.nextSibling) {
      if (item.name !== "ListItem") continue;
      for (let mark = item.firstChild; mark; mark = mark.nextSibling) {
        if (mark.name !== "ListMark") continue;
        const num = parseInt(source.slice(mark.from, mark.to), 10);
        if (Number.isSafeInteger(num) && num !== 1) startAttr = ` start="${num}"`;
        break;
      }
      break;
    }
  }
  let items = "";
  for (let item = node.firstChild; item; item = item.nextSibling) {
    if (item.name !== "ListItem") continue;
    items += renderListItemNode(item, aux);
  }
  return `<${ordered ? "ol" : "ul"}${mdAttrs(node.from, node.to)}${startAttr}>${items}</${ordered ? "ol" : "ul"}>`;
}

function taskItemHtml(symbol: string, symbolOffset: number, inner: string, nested: string): string {
  const checked = taskChecked(symbol);
  return `<li class="task" data-task="${escapeHtml(symbol === " " ? "" : symbol)}"><input type="checkbox" data-md-task="${symbolOffset}"${checked ? " checked" : ""} disabled>${inner}${nested}</li>`;
}

function renderListItemNode(item: SyntaxNode, aux: RenderAux): string {
  const source = aux.ctx.source;
  let firstBlock: SyntaxNode | null = null;
  for (let child = item.firstChild; child; child = child.nextSibling) {
    if (child.name === "ListMark") continue;
    firstBlock = child;
    break;
  }
  if (firstBlock && firstBlock.name === "Task") {
    const marker = firstBlock.getChild("TaskMarker");
    const symbol = marker ? source.slice(marker.from + 1, marker.from + 2) : " ";
    const symbolOffset = marker ? marker.from + 1 : firstBlock.from + 1;
    let contentFrom = marker ? marker.to : firstBlock.from;
    if (source[contentFrom] === " " || source[contentFrom] === "\t") contentFrom++;
    const inner = renderInline(aux.ctx, contentFrom, firstBlock.to, firstBlock);
    let nested = "";
    for (let child = item.firstChild; child; child = child.nextSibling) {
      if (child.from === firstBlock.from || child.name === "ListMark") continue;
      nested += renderInnerBlock(child, aux, []);
    }
    return taskItemHtml(symbol, symbolOffset, inner, nested);
  }
  if (firstBlock && firstBlock.name === "Paragraph") {
    const slice = source.slice(firstBlock.from, firstBlock.to);
    const box = /^\[([^\]\r\n])\](?=[ \t]|$)/u.exec(slice);
    if (box) {
      const symbol = box[1]!;
      const symbolOffset = firstBlock.from + 1;
      let contentFrom = firstBlock.from + box[0].length;
      if (source[contentFrom] === " " || source[contentFrom] === "\t") contentFrom++;
      const inner = renderInline(aux.ctx, contentFrom, firstBlock.to, firstBlock);
      let nested = "";
      for (let child = item.firstChild; child; child = child.nextSibling) {
        if (child.from === firstBlock.from || child.name === "ListMark") continue;
        nested += renderInnerBlock(child, aux, []);
      }
      return taskItemHtml(symbol, symbolOffset, inner, nested);
    }
  }
  let children = "";
  for (let child = item.firstChild; child; child = child.nextSibling) {
    if (child.name === "ListMark") continue;
    children += renderInnerBlock(child, aux, []);
  }
  return `<li>${children}</li>`;
}

function strippedQuoteLines(source: string, from: number, to: number): string[] {
  return source
    .slice(from, to)
    .split("\n")
    .map((line) => line.replace(/^\s*(?:>\s?)+/, ""));
}

function nestedMarks(
  node: SyntaxNode,
  marks: readonly { from: number; to: number }[],
): { from: number; to: number }[] {
  return marks.filter((mark) => mark.from >= node.from && mark.to <= node.to);
}

function renderBlockquoteNode(node: SyntaxNode, aux: RenderAux): string {
  const source = aux.ctx.source;
  const marks = directChildren(node, "QuoteMark").map((m) => ({ from: m.from, to: m.to }));
  const lines = strippedQuoteLines(source, node.from, node.to);
  const first = (lines[0] ?? "").trim();
  const callout = /^\[!([^\]]+)\]([+-])?[ \t]*(.*)$/.exec(first);
  if (callout) {
    const kind = callout[1]!.trim().toLowerCase();
    const title = callout[3]!.trim();
    let body = "";
    let firstParaSkipped = false;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name === "QuoteMark") continue;
      const childMarks = nestedMarks(child, marks);
      if (child.name === "Paragraph" && !firstParaSkipped) {
        firstParaSkipped = true;
        const newline = source.indexOf("\n", child.from);
        if (newline !== -1 && newline < child.to) {
          let rest = newline + 1;
          while (rest < child.to && (source[rest] === ">" || source[rest] === " " || source[rest] === "\t")) {
            if (source[rest] === ">") {
              rest++;
              if (source[rest] === " " || source[rest] === "\t") rest++;
              break;
            }
            rest++;
          }
          if (rest < child.to) {
            const inner = renderParagraphSegments(child, aux, childMarks, rest, child.to);
            if (inner !== "") body += `<p>${inner}</p>`;
          }
          continue;
        }
        continue;
      }
      body += renderInnerBlock(child, aux, childMarks);
    }
    const paragraph = node.getChild("Paragraph");
    let titleFrom = source.indexOf("]", node.from) + 1 + (callout[2] ? 1 : 0);
    while (source[titleFrom] === " " || source[titleFrom] === "\t") titleFrom++;
    const newline = source.indexOf("\n", titleFrom);
    const titleTo = newline < 0 ? node.to : Math.min(newline, node.to);
    const label = title && paragraph ? renderInline(aux.ctx, titleFrom, titleTo, paragraph)
      : escapeHtml(kind.charAt(0).toUpperCase() + kind.slice(1));
    if (callout[2]) {
      return `<details class="callout" data-callout="${escapeHtml(kind)}"${mdAttrs(node.from, node.to)}${callout[2] === "+" ? " open" : ""}><summary class="callout-title">${label}</summary>${body}</details>`;
    }
    return `<div class="callout" data-callout="${escapeHtml(kind)}"${mdAttrs(node.from, node.to)}><div class="callout-title">${label}</div>${body}</div>`;
  }
  return `<blockquote${mdAttrs(node.from, node.to)}>${renderInnerBlocks(node, aux, marks)}</blockquote>`;
}

function renderCodeNode(node: SyntaxNode, aux: RenderAux): string {
  const source = aux.ctx.source;
  const infoNode = node.getChild("CodeInfo");
  const info = infoNode ? source.slice(infoNode.from, infoNode.to).trim() : "";
  const lang = info.split(/\s+/, 1)[0] ?? "";
  const langLower = lang.toLowerCase();
  let code = "";
  for (const text of node.getChildren("CodeText")) code += source.slice(text.from, text.to);
  if (langLower !== "" && MATH_INFOS[langLower] === true && aux.declared.has(langLower) && code.trim() !== "") {
    return `<div class="math-block" data-tex="${escapeHtml(code)}"${mdAttrs(node.from, node.to)}>${escapeHtml(code)}</div>`;
  }
  const classAttr = lang === "" ? "" : ` class="language-${escapeHtml(lang)}"`;
  return `<pre${mdAttrs(node.from, node.to)}><code${classAttr}>${escapeHtml(code)}</code></pre>`;
}

function renderTableNode(node: SyntaxNode, aux: RenderAux): string {
  const source = aux.ctx.source;
  let alignRow: SyntaxNode | null = null;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "TableDelimiter" && child.to - child.from > 1) {
      alignRow = child;
      break;
    }
  }
  const aligns: ("left" | "center" | "right" | null)[] = [];
  if (alignRow) {
    const cells = source.slice(alignRow.from, alignRow.to).split("|");
    const inner = cells.slice(1, cells.length - 1);
    const list = inner.length > 0 ? inner : cells.filter((c) => c.trim() !== "");
    for (const cell of list) {
      const text = cell.trim();
      const left = text.startsWith(":");
      const right = text.endsWith(":");
      aligns.push(left && right ? "center" : left ? "left" : right ? "right" : null);
    }
  }
  const styleFor = (index: number): string => {
    const align = aligns[index] ?? null;
    return align === null ? "" : ` style="text-align:${align}"`;
  };
  const renderCell = (cell: SyntaxNode, header: boolean, index: number): string => {
    const tag = header ? "th" : "td";
    return `<${tag}${styleFor(index)}>${renderInline(aux.ctx, cell.from, cell.to, cell)}</${tag}>`;
  };
  let head = "";
  let body = "";
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "TableHeader") {
      const cells = directChildren(child, "TableCell");
      head = `<thead><tr>${cells.map((c, i) => renderCell(c, true, i)).join("")}</tr></thead>`;
    } else if (child.name === "TableRow") {
      const cells = directChildren(child, "TableCell");
      body += `<tr>${cells.map((c, i) => renderCell(c, false, i)).join("")}</tr>`;
    }
  }
  return `<table${mdAttrs(node.from, node.to)}>${head}<tbody>${body}</tbody></table>`;
}


function renderFootnoteDefNode(node: SyntaxNode, aux: RenderAux): string {
  const source = aux.ctx.source;
  const slice = source.slice(node.from, node.to);
  const match = /^\[\^([^\]\r\n]+)\]:(?:[ \t]|$)/.exec(slice);
  if (!match) return `<p${mdAttrs(node.from, node.to)}>${renderInline(aux.ctx, node.from, node.to, node)}</p>`;
  const key = normalizeLabel(match[1]!);
  const footnote = aux.ctx.footnotes.get(key);
  const number = footnote?.number ?? 0;
  let contentFrom = node.from + match[0].length;
  while (source[contentFrom] === " " || source[contentFrom] === "\t") contentFrom++;
  const inner = contentFrom < node.to ? renderInline(aux.ctx, contentFrom, node.to, node) : "";
  const total = footnote?.references.size ?? 0;
  let backlinks = "";
  for (let occurrence = 1; occurrence <= total; occurrence++) {
    backlinks += `<a href="#fnref-${number}-${occurrence}" data-md-anchor="fnref-${number}-${occurrence}" class="footnote-backref">↩</a>`;
  }
  return `<div class="block-footnote-definition"${idAttr(number === 0 ? null : `fn-${number}`)}${mdAttrs(node.from, node.to)}>${number ? `${number}. ` : ""}${inner} ${backlinks}</div>`;
}

interface BlockRecord {
  readonly from: number;
  readonly to: number;
  readonly kind: string;
  readonly source: string;
  id: string | null;
  readonly render: (id: string | null) => string;
}

class LazyBlock implements MarkdownBlock {
  private cached: string | undefined;
  constructor(private readonly record: BlockRecord) {}
  get from(): number {
    return this.record.from;
  }
  get to(): number {
    return this.record.to;
  }
  get kind(): string {
    return this.record.kind;
  }
  get source(): string {
    return this.record.source;
  }
  get html(): string {
    if (this.cached === undefined) this.cached = this.record.render(this.record.id);
    return this.cached;
  }
}

class LazyDocument implements MarkdownDocument {
  private cached: string | undefined;
  constructor(
    readonly blocks: readonly MarkdownBlock[],
    readonly dependencies: string,
    readonly anchors: ReadonlyMap<string, number>,
  ) {}
  get html(): string {
    if (this.cached === undefined) this.cached = this.blocks.map((block) => block.html).join("");
    return this.cached;
  }
}

function buildDependencies(collected: Collected, source: string): string {
  const parts: string[] = [];
  const refs = [...collected.references.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [label, def] of refs) parts.push(`ref:${label}=${def.href}|${def.title ?? ""}`);
  const notes = [...collected.footnotes.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [label, note] of notes) {
    parts.push(`fn:${label}#${note.number}x${note.references.size}=${source.slice(note.contentFrom, note.to)}`);
  }
  return parts.join("\n");
}

function buildDocument(source: string, tree: Tree, forms?: readonly SyntaxForm[]): MarkdownDocument {
  const frontmatter = detectFrontmatter(source);
  const collected = collectDefinitions(source, tree);
  const ctx: MarkdownRenderContext = {
    source,
    forms,
    references: collected.references,
    footnotes: collected.footnotes,
  };
  const aux: RenderAux = {
    ctx,
    headingIds: collected.headingIds,
    declared: new Set(declaredFences(forms).map((info) => info.toLowerCase())),
  };
  const records: BlockRecord[] = [];

  const pushTopLevel = (node: SyntaxNode): void => {
    const from = node.from;
    const to = node.to;
    const slice = source.slice(from, to);
    switch (node.name) {
      case "HorizontalRule":
        records.push({
          from,
          to,
          kind: "hr",
          source: slice,
          id: null,
          render: () => `<hr${mdAttrs(from, to)}>`,
        });
        return;
      case "LinkReference":
        records.push({
          from,
          to,
          kind: /^\[\^/.test(slice) ? "footnote-definition" : "definition",
          source: slice,
          id: null,
          render: () => /^\[\^/.test(slice) ? renderFootnoteDefNode(node, aux) : "",
        });
        return;
      case "HTMLBlock":
        records.push({
          from,
          to,
          kind: "html",
          source: slice,
          id: null,
          render: () => rawHtmlBlock(source, from, to),
        });
        return;
      case "CommentBlock":
        records.push({
          from,
          to,
          kind: "html",
          source: slice,
          id: null,
          render: () => "",
        });
        return;
      case "ProcessingInstructionBlock":
        records.push({
          from,
          to,
          kind: "html",
          source: slice,
          id: null,
          render: () => `<div class="block-html"${mdAttrs(from, to)}><pre>${escapeHtml(slice)}</pre></div>`,
        });
        return;
      case "FencedCode":
      case "CodeBlock": {
        const closed = node.name === "CodeBlock" || node.getChildren("CodeMark").length === 2;
        // Un recinto con info string **dichiarata** (mermaid, math, …) è un
        // blocco reso, non codice: la Live lo mostra come la Lettura.
        const info = node.getChild("CodeInfo");
        const declared = info !== null
          && aux.declared.has(source.slice(info.from, info.to).trim().split(/\s+/)[0]!.toLowerCase());
        records.push({
          from,
          to,
          kind: !closed ? "incomplete" : declared ? "diagram" : "code",
          source: slice,
          id: null,
          render: () => renderCodeNode(node, aux),
        });
        return;
      }
      case "Table":
        records.push({
          from,
          to,
          kind: "table",
          source: slice,
          id: null,
          render: () => renderTableNode(node, aux),
        });
        return;
      case "BulletList":
      case "OrderedList":
        records.push({
          from,
          to,
          kind: "list",
          source: slice,
          id: null,
          render: () => renderListNode(node, aux),
        });
        return;
      case "Blockquote":
        records.push({
          from,
          to,
          kind: isCalloutNode(node, source) ? "callout" : "blockquote",
          source: slice,
          id: null,
          render: () => renderBlockquoteNode(node, aux),
        });
        return;
      case "Paragraph": {
        const displayMath = /^[ \t]*\$\$[ \t]*(?:\n)?([\s\S]*?)(?:\n)?[ \t]*\$\$[ \t]*$/.exec(slice);
        const tex = displayMath?.[1]?.trim() ?? "";
        if (tex !== "") {
          records.push({
            from,
            to,
            kind: "math",
            source: slice,
            id: null,
            render: () => `<div class="math-block" data-tex="${escapeHtml(tex)}"${mdAttrs(from, to)}>${escapeHtml(tex)}</div>`,
          });
          return;
        }
        if (/^\[\^([^\]\r\n]+)\]:(?:[ \t]|$)/.test(slice)) {
          records.push({
            from,
            to,
            kind: "footnote-definition",
            source: slice,
            id: null,
            render: () => renderFootnoteDefNode(node, aux),
          });
          return;
        }
        const lone = /^\^([^\s]+)[ \t]*$/.exec(slice.trim());
        const previous = records[records.length - 1];
        if (lone && validAnchor(lone[1]!) && previous) {
          const id = canonicalAnchor(lone[1]!);
          records[records.length - 1] = {
            from: previous.from,
            to,
            kind: previous.kind,
            source: source.slice(previous.from, to),
            id,
            render: () =>
              `<div${idAttr(id)}${mdAttrs(previous.from, previous.to)}>${previous.render(previous.id)}</div>`,
          };
          return;
        }
        const anchor = findTrailingAnchor(slice);
        let id: string | null = null;
        let contentTo = to;
        if (anchor && anchor.start > 0) {
          id = canonicalAnchor(anchor.raw);
          contentTo = from + anchor.start;
          while (contentTo > from && (source[contentTo - 1] === " " || source[contentTo - 1] === "\t")) contentTo--;
        }
        records.push({
          from,
          to,
          kind: "paragraph",
          source: slice,
          id,
          render: (resolved) => {
            const inner = from < contentTo ? renderInline(aux.ctx, from, contentTo, node) : "";
            return `<p${idAttr(resolved)}${mdAttrs(from, to)}>${inner}</p>`;
          },
        });
        return;
      }
      default: {
        if (/^(ATXHeading[1-6]|SetextHeading[1-2])$/.test(node.name)) {
          const rawId = collected.headingIds.get(from) ?? null;
          const level = headingLevel(node.name);
          records.push({
            from,
            to,
            kind: `heading-${level}`,
            source: slice,
            id: rawId === "" ? null : rawId,
            render: () => renderHeadingNode(node, aux),
          });
          return;
        }
        records.push({
          from,
          to,
          kind: "paragraph",
          source: slice,
          id: null,
          render: () => renderInnerBlock(node, aux, []),
        });
      }
    }
  };

  if (frontmatter) {
    const slice = source.slice(frontmatter.from, frontmatter.to);
    records.push({
      from: frontmatter.from,
      to: frontmatter.to,
      kind: "frontmatter",
      source: slice,
      id: null,
      render: () =>
        `<div class="block-frontmatter-unparsed"${mdAttrs(frontmatter.from, frontmatter.to)}><pre>${escapeHtml(slice)}</pre></div>`,
    });
  }
  const top = tree.topNode;
  for (let child = top.firstChild; child; child = child.nextSibling) {
    if (frontmatter && child.from < frontmatter.to) continue;
    pushTopLevel(child);
  }
  const blocks = records.map((record) => new LazyBlock(record));
  const anchors = new Map<string, number>();
  for (const [position, id] of collected.headingIds) if (id) anchors.set(id, position);
  for (const record of records) if (record.id) anchors.set(record.id, record.from);
  for (const note of collected.footnotes.values()) {
    anchors.set(`fn-${note.number}`, note.from);
    for (const [position, occurrence] of note.references) anchors.set(`fnref-${note.number}-${occurrence}`, position);
  }
  return new LazyDocument(blocks, JSON.stringify([buildDependencies(collected, source), [...collected.headingIds.values()], forms]), anchors);
}

function isCalloutNode(node: SyntaxNode, source: string): boolean {
  const lines = source
    .slice(node.from, node.to)
    .split("\n")
    .map((line) => line.replace(/^\s*(?:>\s?)+/, ""));
  return /^\[!([^\]]+)\]/.test((lines[0] ?? "").trim());
}

export function renderMarkdown(source: string, forms?: readonly SyntaxForm[]): MarkdownDocument {
  const normalized = normalizeLineBreaks(source);
  const tree = markdownLanguage.parser.parse(normalized);
  return buildDocument(normalized, tree, forms);
}

export function renderMarkdownState(state: EditorState, forms?: readonly SyntaxForm[]): MarkdownDocument {
  const source = state.doc.toString();
  let tree = syntaxTree(state);
  if (tree.length !== source.length || tree.topNode.name !== "Document") {
    tree = markdownLanguage.parser.parse(source);
  }
  return buildDocument(source, tree, forms);
}
