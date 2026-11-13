import { ensureSyntaxTree, syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import type { ChangeDesc, EditorState } from "@codemirror/state";
import type { SyntaxNode, Tree, TreeCursor } from "@lezer/common";
import type { SyntaxForm } from "../../../../host/contract";
import { declaredFences } from "../../../../rules/syntax";
import { normalizeLineBreaks } from "../../../../rules/offsets";
import { taskChecked } from "../../../../rules/mirrored";
import { FOOTNOTE_DEFINITION, markdownGrammar } from "./grammar";
import { CALLOUT_HEAD } from "./callout-head";
import { type DetailsHead, pairDetails, type TopBlock } from "./details";
import { tocHtml, type TocEntry } from "./toc";
import { decodeDestination } from "./link-syntax";
import {
  escapeHtml,
  figureHtml,
  mathBlock,
  mathOf,
  normalizeLabel,
  renderInline,
  sourceAttributes,
  visibleText,
  type ContainerMath,
} from "./render-inline";
import type {
  MarkdownBlock,
  MarkdownDocument,
  MarkdownFootnote,
  MarkdownLinkDefinition,
  MarkdownRenderContext,
} from "./render-types";

// Block-level renderer sharing one Lezer GFM parse between the two surfaces.
// Live reuses CodeMirror's tree when complete, otherwise it parses the buffer.
// After an edit Live passes the previous document too: blocks the change did
// not touch come back from it, moved by the edit, without a new render.
// Source attributes are UTF-16 offsets on LF-normalized text; inline detail
// comes from `render-inline`. Allowed raw HTML blocks remain inert data until
// the shared mount sanitizes them into fresh DOM nodes.

// Initial `---` block (optional BOM) closed by `---`/`...`. The body must hold
// a `:` (or be empty) so a leading rule plus heading is not misread.
export function detectFrontmatter(source: string): { from: number; to: number } | null {
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

/// Quanto testo guardare in cima al documento: il frontmatter sta lì, e un
/// documento enorme non va copiato per intero a ogni battuta.
const FRONTMATTER_WINDOW = 64 * 1024;

/// Il frontmatter di un documento CodeMirror, guardando solo la sua cima: un
/// documento che non comincia con `---` non si copia affatto.
export function frontmatterRange(doc: { length: number; sliceString(from: number, to?: number): string }): { from: number; to: number } | null {
  const head = doc.sliceString(0, Math.min(doc.length, 256));
  const end = head.indexOf("\n");
  if ((end !== -1 || head.length === doc.length) && head.slice(0, end === -1 ? undefined : end).replace(/^\uFEFF/, "").trim() !== "---") {
    return null;
  }
  return detectFrontmatter(doc.sliceString(0, Math.min(doc.length, FRONTMATTER_WINDOW)));
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
  /// Lo slug libero per `base`, che è già passato da `headingSlug`.
  next(base: string): string {
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

/// Il TeX del paragrafo fatto soltanto di una formula `$$…$$`, spazi e ID di
/// blocco in coda a parte: la resa ne fa un blocco, come il provider. `null`
/// per ogni altro paragrafo.
export function paragraphMathBlock(math: ContainerMath, slice: string): string | null {
  const anchor = findTrailingAnchor(slice);
  return mathBlock(math, math.from + (anchor ? anchor.start : slice.length));
}

function mathBlockHtml(tex: string, from: number, to: number, id: string | null = null): string {
  return `<div class="math-block"${idAttr(id)} data-tex="${escapeHtml(tex)}"${mdAttrs(from, to)}>${escapeHtml(tex)}</div>`;
}

function rawHtmlBlock(source: string, from: number, to: number): string {
  const raw = source.slice(from, to);
  return `<div class="block-html block-html-allowed"${mdAttrs(from, to)} data-md-raw-html="${escapeHtml(raw)}"><pre>${escapeHtml(raw)}</pre></div>`;
}

/// L'apertura di un ripiegabile accoppiato: il sommario è testo.
function detailsOpening(slice: string, head: DetailsHead, from: number, to: number): string {
  const summary = head.summary ? escapeHtml(slice.slice(head.summary.from, head.summary.to)) : "";
  return `<details class="fub-details"${mdAttrs(from, to)}${head.open ? " open" : ""}><summary>${summary}</summary>`;
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
  /// I titoli in ordine, per l'indice (K4).
  readonly toc: readonly TocEntry[];
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

/// I blocchi che contengono altri blocchi: titoli, definizioni e paragrafi
/// possono stare soltanto qui dentro.
const CONTAINERS = new Set(["Document", "Blockquote", "BulletList", "OrderedList", "ListItem"]);

/// Dove comincia ogni `[^` della sorgente, in ordine; soltanto in `[from, to)`
/// se c'è.
function footnoteOpeners(source: string, from = 0, to = source.length): number[] {
  const found: number[] = [];
  for (let at = source.indexOf("[^", from); at !== -1 && at < to; at = source.indexOf("[^", at + 2)) found.push(at);
  return found;
}

/// Se un `[^` comincia in `[from, to)`.
function hasOpener(openers: readonly number[], from: number, to: number): boolean {
  let low = 0;
  let high = openers.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (openers[middle]! < from) low = middle + 1;
    else high = middle;
  }
  return low < openers.length && openers[low]! < to;
}

const HEADINGS = new Set(["ATXHeading1", "ATXHeading2", "ATXHeading3", "ATXHeading4", "ATXHeading5", "ATXHeading6", "SetextHeading1", "SetextHeading2"]);

const FOOTNOTE_REFERENCE_TEXT = /^\[\^[^\]\r\n]+\]$/;

/// Quello che un blocco di primo livello porta alle definizioni del documento,
/// nell'ordine del testo e con le posizioni relative al suo inizio: un blocco
/// che la modifica non tocca lo riporta com'è.
interface Found {
  /// Le definizioni di nota.
  readonly defs: readonly FootnoteDef[];
  /// I titoli: l'ID scritto (`^id`) o lo slug del testo, e la base con cui
  /// l'uno o l'altro occupa uno slug del documento.
  readonly headings: readonly { readonly at: number; readonly anchor: string | null; readonly slug: string; readonly base: string; readonly level: number; readonly text: string }[];
  /// Le definizioni dei link.
  readonly references: readonly (readonly [string, MarkdownLinkDefinition])[];
  /// I richiami di nota.
  readonly calls: readonly { readonly key: string; readonly at: number }[];
}

/// Le definizioni di un blocco di primo livello, lette dal suo albero.
function findDefinitions(source: string, top: SyntaxNode, openers: readonly number[]): Found {
  const base = top.from;
  const defs: FootnoteDef[] = [];
  const headings: { at: number; anchor: string | null; slug: string; base: string; level: number; text: string }[] = [];
  const references: [string, MarkdownLinkDefinition][] = [];
  const calls: { key: string; at: number }[] = [];
  // Dentro un blocco foglia l'albero ha soltanto nodi in riga, e fra questi
  // conta il richiamo di una nota: chi non contiene un `[^` non va visitato.
  const descend = (node: SyntaxNode): boolean => CONTAINERS.has(node.name) || hasOpener(openers, node.from, node.to);

  function visit(node: SyntaxNode, insideFootnoteDef: boolean): void {
    const name = node.name;
    // La grammatica fa di ogni definizione di nota un paragrafo.
    const definition = !insideFootnoteDef && name === "Paragraph" && source.startsWith("[^", node.from)
      ? FOOTNOTE_DEFINITION.exec(source.slice(node.from, node.to))
      : null;
    if (definition) {
      const key = normalizeLabel(definition[1]!);
      if (key !== "") {
        let contentFrom = node.from + definition[0].length;
        while (source[contentFrom] === " " || source[contentFrom] === "\t") contentFrom++;
        defs.push({ labelNorm: key, from: node.from - base, to: node.to - base, contentFrom: contentFrom - base });
      }
    } else if (HEADINGS.has(name)) {
      const anchor = findTrailingAnchor(source.slice(node.from, node.to));
      const level = headingLevel(name);
      const shown = visibleText(source, node);
      if (anchor) {
        const text = shown.replace(/[ \t]*\^[A-Za-z0-9-]+[ \t]*$/, "").trim();
        headings.push({ at: node.from - base, anchor: anchor.raw, slug: "", base: headingSlug(canonicalAnchor(anchor.raw)), level, text });
      } else {
        const slug = headingSlug(shown);
        headings.push({ at: node.from - base, anchor: null, slug, base: headingSlug(slug), level, text: shown.trim() });
      }
    } else if (name === "LinkReference") {
      const labelNode = node.getChild("LinkLabel");
      const urlNode = node.getChild("URL");
      if (labelNode && urlNode) {
        const rawLabel = source.slice(labelNode.from + 1, labelNode.to - 1);
        const key = normalizeLabel(rawLabel);
        if (key !== "") {
          const href = decodeDestination(source.slice(urlNode.from, urlNode.to));
          const titleNode = node.getChild("LinkTitle");
          const title = titleNode ? stripDelimiters(source.slice(titleNode.from, titleNode.to)) : undefined;
          references.push([key, title === undefined ? { href } : { href, title }]);
        }
      }
    } else if (name === "Link" && !insideFootnoteDef) {
      const text = source.slice(node.from, node.to);
      if (
        FOOTNOTE_REFERENCE_TEXT.test(text) &&
        node.getChildren("URL").length === 0 &&
        node.getChildren("LinkLabel").length === 0
      ) {
        const key = normalizeLabel(text.slice(2, -1));
        if (key !== "") calls.push({ key, at: node.from - base });
      }
    }
    if (!descend(node)) return;
    const isDefPara =
      name === "Paragraph" && FOOTNOTE_DEFINITION.test(source.slice(node.from, node.to));
    for (let child = node.firstChild; child; child = child.nextSibling) {
      visit(child, insideFootnoteDef || isDefPara);
    }
  }

  visit(top, false);
  return { defs, headings, references, calls };
}

/// Le definizioni del documento, dai blocchi di primo livello in ordine: vince
/// la prima definizione di ogni etichetta, e gli slug dei titoli si contano
/// dall'inizio.
function combineDefinitions(parts: readonly { readonly found: Found; readonly from: number }[]): Collected {
  const references = new Map<string, MarkdownLinkDefinition>();
  const refOffsets = new Map<string, number[]>();
  const defs: FootnoteDef[] = [];
  const defSeen = new Set<string>();
  const refOrder: string[] = [];
  const headingIds = new Map<number, string>();
  const toc: TocEntry[] = [];
  const slugs = new HeadingSlugs();

  for (const { found, from } of parts) {
    for (const def of found.defs) {
      if (defSeen.has(def.labelNorm)) continue;
      defSeen.add(def.labelNorm);
      defs.push({ labelNorm: def.labelNorm, from: def.from + from, to: def.to + from, contentFrom: def.contentFrom + from });
    }
    for (const heading of found.headings) {
      if (heading.anchor !== null) {
        headingIds.set(heading.at + from, heading.anchor);
        slugs.next(heading.base);
        toc.push({ level: heading.level, text: heading.text, id: heading.anchor });
      } else if (heading.slug !== "") {
        const id = slugs.next(heading.base);
        headingIds.set(heading.at + from, id);
        toc.push({ level: heading.level, text: heading.text, id });
      }
    }
    for (const [key, definition] of found.references) if (!references.has(key)) references.set(key, definition);
    for (const call of found.calls) {
      const offsets = refOffsets.get(call.key);
      if (offsets) offsets.push(call.at + from);
      else {
        refOffsets.set(call.key, [call.at + from]);
        refOrder.push(call.key);
      }
    }
  }

  // Una nota ha un numero se il testo la richiama, nell'ordine dei richiami,
  // come per il core: una definizione che nessuno richiama resta nella
  // sorgente ma non è una nota della resa (D23).
  const numbers = new Map<string, number>();
  let next = 1;
  for (const key of refOrder) {
    if (defSeen.has(key) && !numbers.has(key)) numbers.set(key, next++);
  }
  const footnotes = new Map<string, MarkdownFootnote>();
  for (const def of defs) {
    if (!numbers.has(def.labelNorm)) continue;
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
  return { references, footnotes, headingIds, toc };
}

function collectDefinitions(source: string, tree: Tree): Collected {
  const openers = footnoteOpeners(source);
  const parts: { found: Found; from: number }[] = [];
  for (let child = tree.topNode.firstChild; child; child = child.nextSibling) {
    parts.push({ found: findDefinitions(source, child, openers), from: child.from });
  }
  return combineDefinitions(parts);
}

interface RenderAux {
  readonly ctx: MarkdownRenderContext;
  readonly headingIds: ReadonlyMap<number, string>;
  readonly declared: ReadonlySet<string>;
  readonly toc: readonly TocEntry[];
}

const MATH_INFOS: Record<string, true> = { math: true, latex: true, tex: true };

/// L'apertura di un recinto ```toc``` (K4).
const TOC_FENCE = /^ {0,3}(?:`{3,}|~{3,})[ \t]*toc(?:[ \t]|\r?\n|$)/i;
/// Un'apertura ```toc``` in qualunque punto di un testo: il filtro prima di
/// cercarla nell'albero di una citazione o di una lista.
const TOC_ANYWHERE = /(?:`{3,}|~{3,})[ \t]*toc/i;

/// Se un nodo di primo livello tiene un recinto ```toc```: è il nodo, o sta
/// dentro (una citazione, una lista), dove si rende lo stesso indice.
function holdsToc(source: string, name: string, from: number, to: number, node: () => SyntaxNode): boolean {
  if (name === "FencedCode") return TOC_FENCE.test(source.slice(from, Math.min(to, from + 16)));
  if (name === "Paragraph" || name === "HTMLBlock" || !TOC_ANYWHERE.test(source.slice(from, to))) return false;
  const cursor = node().cursor();
  while (cursor.next() && cursor.from < to) {
    if (cursor.name === "FencedCode" && TOC_FENCE.test(source.slice(cursor.from, Math.min(cursor.to, cursor.from + 16)))) return true;
  }
  return false;
}

/// Un recinto con questa info, se il vault lo dichiara, è una formula.
export function isMathInfo(info: string): boolean {
  return MATH_INFOS[info.toLowerCase()] === true;
}

function headingLevel(name: string): number {
  if (name === "SetextHeading1") return 1;
  if (name === "SetextHeading2") return 2;
  const match = /^ATXHeading([1-6])$/.exec(name);
  return match ? Number(match[1]) : 1;
}

/// Un paragrafo fatto soltanto di un'immagine è una figura, con la didascalia
/// dal testo alternativo (K10); `null` altrimenti, o senza testo alternativo.
function loneFigure(paragraph: SyntaxNode, source: string, to: number, inner: string, attrs: string): string | null {
  const image = paragraph.firstChild;
  if (image?.name !== "Image" || image.from !== paragraph.from || source.slice(image.to, to).trim() !== "") return null;
  return figureHtml(inner, visibleText(source, image), attrs);
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
    // La casella la legge soltanto il primo blocco della voce, ed è
    // `renderListItemNode` a toglierla. Lezer fa un `Task` di ogni paragrafo
    // della voce che comincia con `[ ]`; per il provider gli altri sono
    // paragrafi, e la casella resta testo.
    case "Task":
    case "Paragraph": {
      const slice = source.slice(node.from, node.to);
      if (FOOTNOTE_DEFINITION.test(slice)) return renderFootnoteDefNode(node, aux);
      const anchor = findTrailingAnchor(slice);
      let id: string | null = null;
      let to = node.to;
      if (anchor && anchor.start > 0) {
        id = canonicalAnchor(anchor.raw);
        to = node.from + anchor.start;
        while (to > node.from && (source[to - 1] === " " || source[to - 1] === "\t")) to--;
      }
      const tex = paragraphMathBlock(mathOf(aux.ctx, node), slice);
      if (tex !== null) return mathBlockHtml(tex, node.from, node.to, id);
      const inner = renderParagraphSegments(node, aux, quoteMarks, node.from, to);
      const figure = quoteMarks.length === 0 ? loneFigure(node, source, to, inner, `${idAttr(id)}${mdAttrs(node.from, node.to)}`) : null;
      if (figure) return figure;
      return `<p${idAttr(id)}${mdAttrs(node.from, node.to)}>${inner}</p>`;
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
    // Un indirizzo, anche `[^]: x`: le definizioni di nota sono paragrafi.
    case "LinkReference":
      return "";
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

/// Il testo di una voce con casella: per il provider è un paragrafo, e una
/// formula `$$…$$` da sola ne fa un blocco.
function taskContent(task: SyntaxNode, aux: RenderAux, contentFrom: number): string {
  const tex = mathBlock(mathOf(aux.ctx, task));
  return tex !== null ? mathBlockHtml(tex, contentFrom, task.to) : renderInline(aux.ctx, contentFrom, task.to, task);
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
    const inner = taskContent(firstBlock, aux, contentFrom);
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

/// Il contenuto di un callout, senza la riga della testata.
function calloutBody(node: SyntaxNode, aux: RenderAux, marks: readonly { from: number; to: number }[]): string {
  const source = aux.ctx.source;
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
  return body;
}

/// Le colonne (K3): `[!columns]` con soltanto da due a quattro `[!column]`
/// dentro, una per colonna. Altrimenti è un callout come gli altri.
function columnNodes(node: SyntaxNode, source: string): SyntaxNode[] | null {
  const columns: SyntaxNode[] = [];
  let head = false;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "QuoteMark") continue;
    if (!head && child.name === "Paragraph" && !source.slice(child.from, child.to).includes("\n")) {
      head = true;
      continue;
    }
    if (child.name !== "Blockquote" || !isColumnNode(child, source)) return null;
    columns.push(child);
  }
  return head && columns.length >= 2 && columns.length <= 4 ? columns : null;
}

function isColumnNode(node: SyntaxNode, source: string): boolean {
  const first = strippedQuoteLines(source, node.from, node.to)[0] ?? "";
  return CALLOUT_HEAD.exec(first.trim())?.[1]?.trim().toLowerCase() === "column";
}

function renderBlockquoteNode(node: SyntaxNode, aux: RenderAux): string {
  const source = aux.ctx.source;
  const marks = directChildren(node, "QuoteMark").map((m) => ({ from: m.from, to: m.to }));
  const lines = strippedQuoteLines(source, node.from, node.to);
  const first = (lines[0] ?? "").trim();
  const callout = CALLOUT_HEAD.exec(first);
  if (callout) {
    const kind = callout[1]!.trim().toLowerCase();
    const title = callout[3]!.trim();
    if (kind === "columns") {
      const columns = columnNodes(node, source);
      if (columns) {
        const inner = columns.map((column) =>
          `<div class="fub-column"${mdAttrs(column.from, column.to)}>${calloutBody(column, aux, [...nestedMarks(column, marks), ...directChildren(column, "QuoteMark")])}</div>`).join("");
        return `<div class="fub-columns" data-columns="${columns.length}"${mdAttrs(node.from, node.to)}>${inner}</div>`;
      }
    }
    const body = calloutBody(node, aux, marks);
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
  // L'indice (K4): i titoli della nota al posto del recinto.
  if (langLower === "toc") return tocHtml(code, aux.toc, mdAttrs(node.from, node.to));
  const classAttr = lang === "" ? "" : ` class="language-${escapeHtml(lang)}"`;
  // Un recinto dichiarato dal vault (mermaid, …) lo porta scritto: chi lo
  // idrata guarda questo, non la sola classe, e un recinto che il vault non
  // dichiara resta codice.
  const declaredAttr = langLower !== "" && aux.declared.has(langLower) ? " data-declared-fence" : "";
  return `<pre${mdAttrs(node.from, node.to)}${declaredAttr}><code${classAttr}>${escapeHtml(code)}</code></pre>`;
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

/// La resa in riga di ogni cella non vuota, per offset d'inizio relativo alla
/// tabella: la griglia della Live posa le celle per coordinate sorgente.
function renderTableCells(node: SyntaxNode, aux: RenderAux): ReadonlyMap<number, string> {
  const cells = new Map<number, string>();
  for (let row = node.firstChild; row; row = row.nextSibling) {
    if (row.name !== "TableHeader" && row.name !== "TableRow") continue;
    for (const cell of directChildren(row, "TableCell")) {
      cells.set(cell.from - node.from, renderInline(aux.ctx, cell.from, cell.to, cell));
    }
  }
  return cells;
}

function renderFootnoteDefNode(node: SyntaxNode, aux: RenderAux): string {
  const source = aux.ctx.source;
  const slice = source.slice(node.from, node.to);
  const match = FOOTNOTE_DEFINITION.exec(slice);
  if (!match) return `<p${mdAttrs(node.from, node.to)}>${renderInline(aux.ctx, node.from, node.to, node)}</p>`;
  const key = normalizeLabel(match[1]!);
  const footnote = aux.ctx.footnotes.get(key);
  // Si mostra soltanto la definizione che vale: la prima con quell'etichetta,
  // e richiamata. Una seconda `[^a]:` non ripete `fn-1` (D07), una che nessuno
  // richiama non diventa una nota numerata (D23); tutte e due restano nella
  // sorgente, che la Live mostra come testo.
  if (!footnote || footnote.from !== node.from) return "";
  const number = footnote.number;
  let contentFrom = node.from + match[0].length;
  while (source[contentFrom] === " " || source[contentFrom] === "\t") contentFrom++;
  const inner = contentFrom < node.to ? renderInline(aux.ctx, contentFrom, node.to, node) : "";
  const total = footnote.references.size;
  let backlinks = "";
  for (let occurrence = 1; occurrence <= total; occurrence++) {
    backlinks += `<a href="#fnref-${number}-${occurrence}" data-md-anchor="fnref-${number}-${occurrence}" class="footnote-backref">↩</a>`;
  }
  return `<div class="block-footnote-definition"${idAttr(`fn-${number}`)}${mdAttrs(node.from, node.to)}>${number}. ${inner} ${backlinks}</div>`;
}

interface BlockRecord {
  readonly from: number;
  readonly to: number;
  readonly kind: string;
  readonly source: string;
  id: string | null;
  readonly render: (id: string | null) => string;
  readonly cells?: () => ReadonlyMap<number, string>;
  /// Il nodo di primo livello da cui viene: un blocco della resa dopo torna
  /// da questo soltanto se l'albero nuovo ha lo stesso nodo nello stesso
  /// punto. Vuoto per il frontmatter e per un blocco con il suo ID a parte.
  readonly node: string;
  /// Le definizioni che il nodo porta al documento.
  readonly found?: Found;
}

class LazyBlock implements MarkdownBlock {
  private cached: string | undefined;
  private cachedCells: ReadonlyMap<number, string> | undefined;
  /// `origin` è la resa da cui viene un blocco che la modifica non ha
  /// toccato, `delta` quanto la modifica l'ha spostato; `null` per uno reso
  /// da questa sorgente. Sempre un blocco reso davvero: la catena non si
  /// allunga a ogni battuta. `generation` è il giro di resa che ha letto la
  /// sorgente del blocco.
  constructor(
    readonly record: BlockRecord,
    readonly generation: number,
    readonly origin: LazyBlock | null = null,
    private readonly delta = 0,
  ) {}
  /// Il blocco `previous` della resa di prima, che ora comincia a `from`.
  static moved(previous: LazyBlock, from: number): LazyBlock {
    const origin = previous.origin ?? previous;
    return new LazyBlock(origin.record, origin.generation, origin, from - origin.record.from);
  }
  get from(): number {
    return this.record.from + this.delta;
  }
  get to(): number {
    return this.record.to + this.delta;
  }
  get kind(): string {
    return this.record.kind;
  }
  get source(): string {
    return this.record.source;
  }
  get html(): string {
    if (this.cached === undefined) {
      this.cached = this.origin ? shiftPositions(this.origin.html, this.delta) : this.record.render(this.record.id);
    }
    return this.cached;
  }
  get cells(): ReadonlyMap<number, string> | undefined {
    if (!this.record.cells) return undefined;
    if (this.cachedCells === undefined) {
      // Le chiavi delle celle sono relative all'inizio del blocco, le
      // posizioni nella loro resa no.
      const origin = this.origin;
      this.cachedCells = origin
        ? new Map([...origin.cells!].map(([at, html]) => [at, shiftPositions(html, this.delta)]))
        : this.record.cells();
    }
    return this.cachedCells;
  }
}

/// Un nodo di primo livello dell'albero, con le definizioni che porta al
/// documento e il blocco che ne è nato. Le posizioni sono relative al pezzo
/// della lista che lo tiene (`TopList`).
interface TopEntry {
  readonly from: number;
  readonly to: number;
  readonly name: string;
  readonly found: Found;
  /// Un recinto ```toc``` (K4): con un indice nella nota i titoli entrano
  /// nelle dipendenze.
  readonly toc: boolean;
  /// Il blocco nato dal nodo; `null` per un nodo dentro il frontmatter e per
  /// un ID a parte, che sta nel blocco prima.
  readonly block: LazyBlock | null;
}

/// Un nodo di primo livello con le posizioni di adesso.
interface PlacedTop {
  readonly entry: TopEntry;
  readonly from: number;
  readonly to: number;
}

/// Quanti nodi tiene un pezzo della lista.
const PIECE = 32;

interface Piece {
  readonly entries: readonly TopEntry[];
  /// Quanto le modifiche dopo la lettura hanno spostato i nodi del pezzo.
  readonly shift: number;
}

function shiftedTop(entry: TopEntry, shift: number): TopEntry {
  return shift === 0 ? entry : { ...entry, from: entry.from + shift, to: entry.to + shift };
}

function piecesOf(entries: readonly TopEntry[]): Piece[] {
  if (entries.length === 0) return [];
  if (entries.length <= PIECE * 2) return [{ entries, shift: 0 }];
  const pieces: Piece[] = [];
  for (let at = 0; at < entries.length; at += PIECE) pieces.push({ entries: entries.slice(at, at + PIECE), shift: 0 });
  return pieces;
}

/// I nodi di primo livello del documento, a pezzi. Una battuta rifà soltanto
/// il pezzo che tocca: quelli dopo cambiano lo spostamento e tengono i loro
/// nodi, senza che nessuno li visiti.
class TopList {
  private readonly starts: readonly number[];
  readonly size: number;
  private constructor(private readonly pieces: readonly Piece[]) {
    const starts: number[] = [];
    let size = 0;
    for (const piece of pieces) {
      starts.push(size);
      size += piece.entries.length;
    }
    this.starts = starts;
    this.size = size;
  }

  static of(entries: readonly TopEntry[]): TopList {
    return new TopList(piecesOf(entries));
  }

  /// Il pezzo che tiene il nodo `index`.
  private pieceOf(index: number): number {
    let low = 0;
    let high = this.pieces.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (this.starts[middle]! <= index) low = middle;
      else high = middle - 1;
    }
    return low;
  }

  at(index: number): PlacedTop {
    const p = this.pieceOf(index);
    const piece = this.pieces[p]!;
    const entry = piece.entries[index - this.starts[p]!]!;
    return { entry, from: entry.from + piece.shift, to: entry.to + piece.shift };
  }

  /// Il primo nodo che finisce a `position` o dopo; `size` se non ce n'è.
  firstEndingFrom(position: number): number {
    let low = 0;
    let high = this.pieces.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      const piece = this.pieces[middle]!;
      if (piece.entries[piece.entries.length - 1]!.to + piece.shift < position) low = middle + 1;
      else high = middle;
    }
    if (low === this.pieces.length) return this.size;
    const piece = this.pieces[low]!;
    let first = 0;
    let last = piece.entries.length - 1;
    while (first < last) {
      const middle = (first + last) >> 1;
      if (piece.entries[middle]!.to + piece.shift < position) first = middle + 1;
      else last = middle;
    }
    return this.starts[low]! + first;
  }

  forEach(visit: (entry: TopEntry, from: number, to: number) => void): void {
    for (const piece of this.pieces) {
      for (const entry of piece.entries) visit(entry, entry.from + piece.shift, entry.to + piece.shift);
    }
  }

  /// La lista con i nodi `[low, high)` sostituiti da `added`, scritti nelle
  /// posizioni di adesso, e quelli dopo spostati di `delta`.
  replace(low: number, high: number, added: readonly TopEntry[], delta: number): TopList {
    if (this.size === 0) return TopList.of(added);
    const first = this.pieceOf(Math.min(low, this.size - 1));
    const last = high > low ? this.pieceOf(high - 1) : first;
    const middle: TopEntry[] = [];
    const head = this.pieces[first]!;
    for (let index = this.starts[first]!; index < low; index++) {
      middle.push(shiftedTop(head.entries[index - this.starts[first]!]!, head.shift));
    }
    for (const entry of added) middle.push(entry);
    const tail = this.pieces[last]!;
    const tailEnd = this.starts[last]! + tail.entries.length;
    for (let index = Math.max(high, this.starts[last]!); index < tailEnd; index++) {
      middle.push(shiftedTop(tail.entries[index - this.starts[last]!]!, tail.shift + delta));
    }
    const after = this.pieces.slice(last + 1);
    return new TopList([
      ...this.pieces.slice(0, first),
      ...piecesOf(middle),
      ...(delta === 0 ? after : after.map((piece) => ({ entries: piece.entries, shift: piece.shift + delta }))),
    ]);
  }
}

/// Dove la resa di una modifica ha lavorato, nella sorgente nuova: dall'inizio
/// del primo nodo rifatto all'inizio del primo nodo tornato com'era (o alla
/// fine del testo). Fuori da qui i blocchi sono quelli di prima, spostati.
export interface RenderPatch {
  readonly from: number;
  readonly to: number;
}

interface DocumentState {
  readonly source: string;
  readonly tops: TopList;
  readonly frontmatter: { readonly from: number; readonly to: number } | null;
  readonly frontmatterBlock: LazyBlock | null;
  readonly collected: Collected;
  readonly dependencies: string;
  readonly forms: readonly SyntaxForm[] | undefined;
  /// Le generazioni dei blocchi vivi, con quanti blocchi ciascuna.
  readonly alive: ReadonlyMap<number, number>;
  /// Quanti blocchi questo giro ha reso dalla sorgente.
  readonly fresh: number;
  /// Quanti nodi di primo livello questo giro ha guardato.
  readonly visited: number;
  /// `null` per una resa da capo.
  readonly patch: RenderPatch | null;
}

class LazyDocument implements MarkdownDocument {
  private cachedHtml: string | undefined;
  private cachedAnchors: ReadonlyMap<string, number> | undefined;
  constructor(readonly state: DocumentState, private cachedBlocks?: readonly LazyBlock[]) {}
  get source(): string {
    return this.state.source;
  }
  get dependencies(): string {
    return this.state.dependencies;
  }
  /// I blocchi in fila, con le posizioni di adesso: si mettono in fila
  /// soltanto quando qualcuno li chiede tutti.
  get blocks(): readonly LazyBlock[] {
    if (this.cachedBlocks === undefined) {
      const blocks: LazyBlock[] = [];
      if (this.state.frontmatterBlock) blocks.push(this.state.frontmatterBlock);
      this.state.tops.forEach((entry, from) => {
        if (entry.block) blocks.push(entry.block.from === from ? entry.block : LazyBlock.moved(entry.block, from));
      });
      this.cachedBlocks = blocks;
    }
    return this.cachedBlocks;
  }
  get anchors(): ReadonlyMap<string, number> {
    if (this.cachedAnchors === undefined) {
      const { collected } = this.state;
      const anchors = new Map<string, number>();
      for (const [position, id] of collected.headingIds) if (id) anchors.set(id, position);
      for (const block of this.blocks) if (block.record.id) anchors.set(block.record.id, block.from);
      for (const note of collected.footnotes.values()) {
        anchors.set(`fn-${note.number}`, note.from);
        for (const [position, occurrence] of note.references) anchors.set(`fnref-${note.number}-${occurrence}`, position);
      }
      this.cachedAnchors = anchors;
    }
    return this.cachedAnchors;
  }
  get html(): string {
    if (this.cachedHtml === undefined) this.cachedHtml = this.blocks.map((block) => block.html).join("");
    return this.cachedHtml;
  }
}

/// Quanti blocchi la resa ha letto dalla sorgente: gli altri sono tornati dalla
/// resa di prima. Per i test, che contano il lavoro di una battuta.
export function freshBlocks(document: MarkdownDocument): number | null {
  return document instanceof LazyDocument ? document.state.fresh : null;
}

/// Quanti nodi di primo livello la resa ha guardato: tutti per una resa da
/// capo, soltanto quelli vicini alla modifica per una battuta. Per i test.
export function visitedBlocks(document: MarkdownDocument): number | null {
  return document instanceof LazyDocument ? document.state.visited : null;
}

/// Dove la resa di una modifica ha lavorato (`RenderPatch`); `null` per una
/// resa da capo, dopo la quale ogni blocco può essere diverso.
export function renderPatch(document: MarkdownDocument): RenderPatch | null {
  return document instanceof LazyDocument ? document.state.patch : null;
}

/// I blocchi che toccano `[from, to)`, con quello subito prima, e il primo
/// blocco dopo. Con le posizioni di adesso, senza mettere in fila gli altri.
export function blocksAround(
  document: MarkdownDocument,
  from: number,
  to: number,
): { readonly blocks: readonly MarkdownBlock[]; readonly following: MarkdownBlock | null } {
  if (!(document instanceof LazyDocument)) {
    const all = document.blocks;
    let first = all.findIndex((block) => block.to >= from);
    if (first === -1) first = all.length;
    first = Math.max(0, first - 1);
    let end = first;
    while (end < all.length && (end === first || all[end]!.from < to)) end++;
    return { blocks: all.slice(first, end), following: all[end] ?? null };
  }
  const { tops, frontmatterBlock } = document.state;
  const placed = (index: number): LazyBlock | null => {
    const { entry, from: at } = tops.at(index);
    if (!entry.block) return null;
    return entry.block.from === at ? entry.block : LazyBlock.moved(entry.block, at);
  };
  const blocks: LazyBlock[] = [];
  let index = tops.firstEndingFrom(from);
  // Il blocco prima: si risale oltre i nodi senza blocco.
  let before = index - 1;
  while (before >= 0 && !tops.at(before).entry.block) before--;
  if (before >= 0) {
    blocks.push(placed(before)!);
    index = before + 1;
  } else if (frontmatterBlock) {
    blocks.push(frontmatterBlock);
  }
  let following: LazyBlock | null = null;
  for (; index < tops.size; index++) {
    const block = placed(index);
    if (!block) continue;
    if (block.from >= to && blocks.length > 0) {
      following = block;
      break;
    }
    blocks.push(block);
  }
  return { blocks, following };
}

/// `block` spostato perché cominci a `from`.
export function movedBlock(block: MarkdownBlock, from: number): MarkdownBlock {
  if (block.from === from || !(block instanceof LazyBlock)) return block;
  return LazyBlock.moved(block, from);
}

/// Il blocco reso davvero da cui `block` viene: lo stesso per una resa nuova.
/// Chi ricava qualcosa dal solo testo di un blocco lo ricorda qui.
export function blockOrigin(block: MarkdownBlock): object {
  return block instanceof LazyBlock ? block.origin ?? block : block;
}

/// Le posizioni scritte nella resa di un blocco, spostate di `delta`: soltanto
/// gli attributi della resa, perché il testo dell'utente ha le virgolette
/// già sfuggite.
const POSITIONS = / data-md-(from|to|task)="(\d+)"/g;
function shiftPositions(html: string, delta: number): string {
  if (delta === 0) return html;
  return html.replace(POSITIONS, (_all, key: string, value: string) => ` data-md-${key}="${Number(value) + delta}"`);
}

/// Quante sorgenti vecchie una resa può tenere vive attraverso i blocchi che
/// riusa: oltre, si rifà tutta.
const GENERATIONS = 8;
let generations = 0;

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

/// La resa di prima e le modifiche che la separano da questa sorgente.
export interface PreviousRender {
  readonly document: MarkdownDocument;
  readonly changes: ChangeDesc;
}

/// I blocchi della resa di prima che la modifica non tocca, per dove
/// cominciano ora. Blocchi e modifiche sono in ordine: si scorrono insieme.
function untouchedBlocks(previous: PreviousRender | undefined): Map<number, LazyBlock> {
  const untouched = new Map<number, LazyBlock>();
  if (!previous || !(previous.document instanceof LazyDocument)) return untouched;
  const changed: { fromA: number; toA: number; delta: number }[] = [];
  previous.changes.iterChangedRanges((fromA, toA, _fromB, toB) => changed.push({ fromA, toA, delta: toB - toA }));
  let next = 0;
  let delta = 0;
  previous.document.state.tops.forEach((entry, from, to) => {
    const block = entry.block;
    // Una modifica che finisce prima del blocco lo sposta e basta; una che lo
    // tocca, anche soltanto ai bordi, lo fa rendere di nuovo.
    while (next < changed.length && changed[next]!.toA < from) delta = changed[next++]!.delta;
    if (!block || block.record.node === "" || (next < changed.length && changed[next]!.fromA <= to)) return;
    untouched.set(from + delta, block);
  });
  return untouched;
}

/// L'ID scritto su un paragrafo che non ha altro (`^id`), che va al blocco prima.
function loneAnchorId(slice: string): string | null {
  const lone = /^\^([^\s]+)[ \t]*$/.exec(slice.trim());
  return lone && validAnchor(lone[1]!) ? canonicalAnchor(lone[1]!) : null;
}

/// Ciò che serve a rendere un nodo di primo livello.
interface TopContext {
  readonly source: string;
  readonly aux: RenderAux;
  readonly detailsOpen: ReadonlyMap<number, DetailsHead>;
  readonly detailsClose: ReadonlySet<number>;
  readonly generation: number;
}

/// Il blocco di un nodo di primo livello. L'ID a parte (`^id`) lo unisce chi
/// chiama al blocco prima.
function renderTop(node: SyntaxNode, found: Found, context: TopContext): LazyBlock {
  const { source, aux, detailsOpen, detailsClose, generation } = context;
  const from = node.from;
  const to = node.to;
  const slice = source.slice(from, to);
  const block = (record: Omit<BlockRecord, "node" | "found">): LazyBlock =>
    new LazyBlock({ ...record, node: node.name, found }, generation);
  switch (node.name) {
    case "HorizontalRule":
      return block({ from, to, kind: "hr", source: slice, id: null, render: () => `<hr${mdAttrs(from, to)}>` });
    case "LinkReference":
      return block({ from, to, kind: "definition", source: slice, id: null, render: () => "" });
    case "HTMLBlock": {
      const head = detailsOpen.get(from);
      const closing = detailsClose.has(from);
      return block({
        from,
        to,
        kind: "html",
        source: slice,
        id: null,
        render: () => head ? detailsOpening(slice, head, from, to) : closing ? "</details>" : rawHtmlBlock(source, from, to),
      });
    }
    case "CommentBlock":
      return block({ from, to, kind: "html", source: slice, id: null, render: () => "" });
    case "ProcessingInstructionBlock":
      return block({
        from,
        to,
        kind: "html",
        source: slice,
        id: null,
        render: () => `<div class="block-html"${mdAttrs(from, to)}><pre>${escapeHtml(slice)}</pre></div>`,
      });
    case "FencedCode":
    case "CodeBlock": {
      const closed = node.name === "CodeBlock" || node.getChildren("CodeMark").length === 2;
      // Un recinto con info string **dichiarata** (mermaid, math, …) è un
      // blocco reso, non codice: la Live lo mostra come la Lettura.
      const info = node.getChild("CodeInfo");
      const infoWord = info === null ? "" : source.slice(info.from, info.to).trim().split(/\s+/)[0]!.toLowerCase();
      // Così l'indice (K4): non si scrive come codice, si legge reso.
      const declared = info !== null && (aux.declared.has(infoWord) || infoWord === "toc");
      return block({
        from,
        to,
        kind: !closed ? "incomplete" : declared ? "diagram" : "code",
        source: slice,
        id: null,
        render: () => renderCodeNode(node, aux),
      });
    }
    case "Table":
      return block({
        from,
        to,
        kind: "table",
        source: slice,
        id: null,
        render: () => renderTableNode(node, aux),
        cells: () => renderTableCells(node, aux),
      });
    case "BulletList":
    case "OrderedList":
      return block({ from, to, kind: "list", source: slice, id: null, render: () => renderListNode(node, aux) });
    case "Blockquote":
      return block({
        from,
        to,
        kind: isCalloutNode(node, source) ? "callout" : "blockquote",
        source: slice,
        id: null,
        render: () => renderBlockquoteNode(node, aux),
      });
    case "Paragraph": {
      const tex = paragraphMathBlock(mathOf(aux.ctx, node), slice);
      if (tex !== null) {
        const anchor = findTrailingAnchor(slice);
        return block({
          from,
          to,
          kind: "math",
          source: slice,
          id: anchor && anchor.start > 0 ? canonicalAnchor(anchor.raw) : null,
          render: (resolved) => mathBlockHtml(tex, from, to, resolved),
        });
      }
      if (FOOTNOTE_DEFINITION.test(slice)) {
        return block({ from, to, kind: "footnote-definition", source: slice, id: null, render: () => renderFootnoteDefNode(node, aux) });
      }
      const anchor = findTrailingAnchor(slice);
      let id: string | null = null;
      let contentTo = to;
      if (anchor && anchor.start > 0) {
        id = canonicalAnchor(anchor.raw);
        contentTo = from + anchor.start;
        while (contentTo > from && (source[contentTo - 1] === " " || source[contentTo - 1] === "\t")) contentTo--;
      }
      return block({
        from,
        to,
        kind: "paragraph",
        source: slice,
        id,
        render: (resolved) => {
          const inner = from < contentTo ? renderInline(aux.ctx, from, contentTo, node) : "";
          return loneFigure(node, source, contentTo, inner, `${idAttr(resolved)}${mdAttrs(from, to)}`)
            ?? `<p${idAttr(resolved)}${mdAttrs(from, to)}>${inner}</p>`;
        },
      });
    }
    default: {
      if (/^(ATXHeading[1-6]|SetextHeading[1-2])$/.test(node.name)) {
        const rawId = aux.headingIds.get(from) ?? null;
        const level = headingLevel(node.name);
        return block({
          from,
          to,
          kind: `heading-${level}`,
          source: slice,
          id: rawId === "" ? null : rawId,
          render: () => renderHeadingNode(node, aux),
        });
      }
      return block({ from, to, kind: "paragraph", source: slice, id: null, render: () => renderInnerBlock(node, aux, []) });
    }
  }
}

/// Il contesto della resa per le definizioni di `collected`, lette soltanto
/// quando un blocco si rende davvero.
function auxOf(source: string, forms: readonly SyntaxForm[] | undefined, collected: Collected): RenderAux {
  const ctx: MarkdownRenderContext = {
    source,
    forms,
    references: collected.references,
    get footnotes() {
      return collected.footnotes;
    },
  };
  return {
    ctx,
    get headingIds() {
      return collected.headingIds;
    },
    declared: new Set(declaredFences(forms).map((info) => info.toLowerCase())),
    toc: collected.toc,
  };
}

function buildDocument(source: string, tree: Tree, forms?: readonly SyntaxForm[], previous?: PreviousRender): MarkdownDocument {
  return (previous && patchDocument(source, tree, forms, previous)) || wholeDocument(source, tree, forms, previous);
}

/// La resa di tutti i nodi di primo livello. Con la resa di prima, quelli che
/// la modifica non tocca ne tornano spostati, se le definizioni sono le stesse.
function wholeDocument(source: string, tree: Tree, forms?: readonly SyntaxForm[], previous?: PreviousRender): LazyDocument {
  const generation = ++generations;
  const frontmatter = detectFrontmatter(source);
  // Un nodo di primo livello che l'albero nuovo ha nello stesso punto, con
  // lo stesso nome e lo stesso testo, è il blocco di prima: ne tornano le
  // definizioni e, se quelle del documento non cambiano, la resa.
  const untouched = untouchedBlocks(previous);
  let openers: number[] | null = null;
  // Il cursore scorre i figli senza farne nodi: il nodo serve soltanto a chi
  // va letto di nuovo.
  const tops: { from: number; to: number; name: string; toc: boolean; node: SyntaxNode | null; found: Found; before: LazyBlock | null }[] = [];
  const htmlTops: TopBlock[] = [];
  let hasToc = false;
  const cursor = tree.cursor();
  if (cursor.firstChild()) {
    do {
      const { from, to, name } = cursor;
      // Un albero che va oltre la sorgente è quello di un documento più lungo,
      // reso soltanto fino a un blocco (`renderMarkdownStatePrefix`).
      if (to > source.length) break;
      const toc = holdsToc(source, name, from, to, () => cursor.node);
      if (name === "HTMLBlock") htmlTops.push({ from, to, html: source.slice(from, to) });
      else if (toc) hasToc = true;
      const candidate = untouched.get(from);
      const before = candidate && candidate.record.node === name && candidate.record.found
        && candidate.to - candidate.from === to - from ? candidate : null;
      if (before) tops.push({ from, to, name, toc, node: null, found: before.record.found!, before });
      else {
        const node = cursor.node;
        tops.push({ from, to, name, toc, node, found: findDefinitions(source, node, openers ??= footnoteOpeners(source)), before: null });
      }
    } while (cursor.nextSibling());
  }
  // I ripiegabili (K2): un'apertura accoppiata si rende `<details>` aperto,
  // la sua chiusura `</details>`, e il contenuto fra loro ci cade dentro. Chi
  // è accoppiato a chi dipende dagli altri blocchi: la sequenza delle aperture
  // e delle chiusure entra nelle dipendenze, così un blocco riusato non tiene
  // un'apertura che ha perso la sua chiusura.
  const details = pairDetails(htmlTops);
  const detailsOpen = new Map(details.pairs.map((pair) => [pair.open.from, pair.head]));
  const detailsClose = new Set(details.pairs.map((pair) => pair.close.from));
  const detailsShape = htmlTops.map((top) => detailsOpen.has(top.from) ? "o" : detailsClose.has(top.from) ? "c" : "").join("");
  const collected = combineDefinitions(tops);
  // Un indice (K4) cambia con i livelli e i testi dei titoli, non soltanto
  // coi loro id: con un indice nella nota entrano nelle dipendenze.
  const tocShape = hasToc ? collected.toc.map((entry) => `${entry.level}${entry.text}`) : null;
  const written = JSON.stringify([buildDependencies(collected, source), [...collected.headingIds.values()], forms, detailsShape, tocShape]);
  // Con altre definizioni ogni blocco può rendersi diverso. Uguali, si tiene
  // la stringa di prima: chi confronta i widget la trova identica senza
  // rileggerla.
  const reuse = previous?.document.dependencies === written;
  const dependencies = reuse ? previous!.document.dependencies : written;
  const context: TopContext = { source, aux: auxOf(source, forms, collected), detailsOpen, detailsClose, generation };

  const blocks: LazyBlock[] = [];
  const entries: { from: number; to: number; name: string; found: Found; toc: boolean; block: LazyBlock | null }[] = [];
  let frontmatterBlock: LazyBlock | null = null;
  if (frontmatter) {
    const slice = source.slice(frontmatter.from, frontmatter.to);
    frontmatterBlock = new LazyBlock({
      from: frontmatter.from,
      to: frontmatter.to,
      kind: "frontmatter",
      source: slice,
      id: null,
      node: "",
      render: () =>
        `<div class="block-frontmatter-unparsed"${mdAttrs(frontmatter.from, frontmatter.to)}><pre>${escapeHtml(slice)}</pre></div>`,
    }, generation);
    blocks.push(frontmatterBlock);
  }
  // Chi tiene l'ultimo blocco: l'indice del suo nodo, -1 il frontmatter.
  let owner = -1;
  let fresh = 0;
  const kept = new Set<number>();
  for (const top of tops) {
    const entry = { from: top.from, to: top.to, name: top.name, found: top.found, toc: top.toc, block: null as LazyBlock | null };
    entries.push(entry);
    if (frontmatter && top.from < frontmatter.to) continue;
    if (top.before && reuse) {
      const moved = LazyBlock.moved(top.before, top.from);
      kept.add(moved.generation);
      blocks.push(moved);
      entry.block = moved;
      owner = entries.length - 1;
      continue;
    }
    fresh++;
    // Un blocco tornato con le definizioni ma da rendere di nuovo.
    const node = top.node ?? nodeAt(tree, top.from);
    const previousBlock = blocks[blocks.length - 1];
    const lone = node.name === "Paragraph" && previousBlock ? loneAnchorId(source.slice(top.from, top.to)) : null;
    if (lone !== null && previousBlock) {
      const { from: previousFrom, to: previousTo } = previousBlock;
      const merged = new LazyBlock({
        from: previousFrom,
        to: top.to,
        kind: previousBlock.kind,
        source: source.slice(previousFrom, top.to),
        id: lone,
        node: "",
        render: () => `<div${idAttr(lone)}${mdAttrs(previousFrom, previousTo)}>${previousBlock.html}</div>`,
      }, generation);
      blocks[blocks.length - 1] = merged;
      if (owner === -1) frontmatterBlock = merged;
      else entries[owner]!.block = merged;
      continue;
    }
    const block = renderTop(node, top.found, context);
    blocks.push(block);
    entry.block = block;
    owner = entries.length - 1;
  }
  if (kept.size >= GENERATIONS) return wholeDocument(source, tree, forms);
  const alive = new Map<number, number>();
  for (const block of blocks) alive.set(block.generation, (alive.get(block.generation) ?? 0) + 1);
  return new LazyDocument({
    source,
    tops: TopList.of(entries),
    frontmatter,
    frontmatterBlock,
    collected,
    dependencies,
    forms,
    alive,
    fresh: frontmatter ? fresh + 1 : fresh,
    visited: tops.length,
    patch: null,
  }, blocks);
}

/// Le definizioni di prima, con le posizioni portate avanti dalle modifiche:
/// si rifanno soltanto quando qualcuno le legge. `changes` va dalla resa in
/// cui `base` è stata letta a questa.
class MovedDefinitions implements Collected {
  private cachedHeadings: ReadonlyMap<number, string> | undefined;
  private cachedFootnotes: ReadonlyMap<string, MarkdownFootnote> | undefined;
  constructor(readonly base: Collected, readonly changes: ChangeDesc, readonly steps: number) {}
  get references(): ReadonlyMap<string, MarkdownLinkDefinition> {
    return this.base.references;
  }
  get toc(): readonly TocEntry[] {
    return this.base.toc;
  }
  get headingIds(): ReadonlyMap<number, string> {
    this.cachedHeadings ??= new Map([...this.base.headingIds].map(([at, id]) => [this.changes.mapPos(at, 1), id]));
    return this.cachedHeadings;
  }
  get footnotes(): ReadonlyMap<string, MarkdownFootnote> {
    if (this.cachedFootnotes === undefined) {
      const map = (at: number) => this.changes.mapPos(at, 1);
      this.cachedFootnotes = new Map([...this.base.footnotes].map(([label, note]) => [label, {
        ...note,
        from: map(note.from),
        to: map(note.to),
        contentFrom: map(note.contentFrom),
        references: new Map([...note.references].map(([at, occurrence]) => [map(at), occurrence])),
      }]));
    }
    return this.cachedFootnotes;
  }
}

/// Dopo quante battute le definizioni spostate si rileggono davvero: la
/// catena delle modifiche non cresce senza fine.
const MOVED_STEPS = 64;

function movedDefinitions(collected: Collected, changes: ChangeDesc): Collected {
  if (collected instanceof MovedDefinitions) {
    if (collected.steps < MOVED_STEPS) return new MovedDefinitions(collected.base, collected.changes.composeDesc(changes), collected.steps + 1);
    const { references, footnotes, headingIds, toc } = collected;
    return new MovedDefinitions({ references, footnotes, headingIds, toc }, changes, 1);
  }
  return new MovedDefinitions(collected, changes, 1);
}

/// Quanti nodi nuovi una modifica può leggere prima che convenga la resa da capo.
const PATCH_LIMIT = 256;

/// Un nodo che non porta niente alle definizioni del documento, oltre ai
/// richiami di nota.
const inert = (top: { readonly name: string; readonly toc: boolean; readonly found: Found }): boolean =>
  top.name !== "HTMLBlock" && !top.toc
  && top.found.defs.length === 0 && top.found.headings.length === 0 && top.found.references.length === 0;

/// Se la prima riga è `---`: il frontmatter potrebbe cominciare qui.
function opensFrontmatter(source: string): boolean {
  const start = source.startsWith("﻿") ? 1 : 0;
  const end = source.indexOf("\n", start);
  return end !== -1 && source.slice(start, end).trim() === "---";
}

/// La resa di una modifica che lavora soltanto vicino alle posizioni del
/// cambio: si rileggono i nodi di primo livello dal blocco prima della
/// modifica al primo nodo dopo che l'albero nuovo ha uguale a prima, e i nodi
/// dopo restano quelli di prima, spostati. `null` quando non basta: una
/// modifica nel frontmatter, un ID a parte, definizioni, titoli, ripiegabili
/// o un indice toccati. Allora si rifà la resa intera, che dà lo stesso
/// risultato.
function patchDocument(source: string, tree: Tree, forms: readonly SyntaxForm[] | undefined, previous: PreviousRender): LazyDocument | null {
  const old = previous.document;
  if (!(old instanceof LazyDocument)) return null;
  const was = old.state;
  const { changes } = previous;
  if (was.forms !== forms || changes.length !== was.source.length || changes.newLength !== source.length || tree.length !== source.length) {
    return null;
  }
  let fromA = -1;
  let toA = -1;
  changes.iterChangedRanges((changeFrom, changeTo) => {
    if (fromA < 0) fromA = changeFrom;
    toA = changeTo;
  });
  const tops = was.tops;
  if (fromA < 0 || tops.size === 0) return null;
  const { frontmatter } = was;
  if (frontmatter ? fromA < frontmatter.to : opensFrontmatter(source)) return null;
  const delta = source.length - was.source.length;
  // Si comincia dal nodo prima del primo che la modifica tocca: una riga
  // scritta sotto un paragrafo può farne un titolo o una tabella.
  let low = Math.max(0, tops.firstEndingFrom(fromA) - 1);
  let cursor: TreeCursor;
  for (;;) {
    const start = tops.at(low).from;
    if (start >= fromA || (frontmatter && start < frontmatter.to)) return null;
    cursor = tree.cursor();
    if (!cursor.childAfter(start)) return null;
    if (cursor.from === start) break;
    // L'albero nuovo ha unito il nodo a quello prima.
    if (cursor.from > start || low === 0) return null;
    low--;
  }
  const regionFrom = tops.at(low).from;
  const generation = ++generations;
  const alive = new Map(was.alive);
  const removedCalls: { key: string; at: number }[] = [];
  const added: TopEntry[] = [];
  const fresh: { entry: { from: number; to: number; name: string; found: Found; toc: boolean; block: LazyBlock | null }; node: SyntaxNode }[] = [];
  let visited = 0;
  let index = low;
  let resyncFrom = source.length;
  let resynced = false;
  // Un nodo di prima lascia la resa: deve essere un blocco qualunque.
  const drop = (top: PlacedTop): boolean => {
    const block = top.entry.block;
    if (!block || block.record.node === "" || !inert(top.entry)) return false;
    for (const call of top.entry.found.calls) removedCalls.push({ key: call.key, at: top.from + call.at });
    const count = alive.get(block.generation)! - 1;
    if (count === 0) alive.delete(block.generation);
    else alive.set(block.generation, count);
    return true;
  };
  // Dove un nodo di prima sta ora: -1 se la modifica lo tocca.
  const mapped = (top: PlacedTop): number => top.to < fromA ? top.from : top.from > toA ? top.from + delta : -1;
  for (;;) {
    const { from, to, name } = cursor;
    if (to > source.length) return null;
    while (index < tops.size) {
      const top = tops.at(index);
      if (mapped(top) >= from) break;
      if (!drop(top)) return null;
      index++;
      visited++;
    }
    if (index < tops.size) {
      const top = tops.at(index);
      // Soltanto un nodo col suo blocco: un ID a parte va al blocco prima, che
      // qui potrebbe essere un altro.
      const own = top.entry.block !== null && top.entry.block.record.node !== "";
      if (own && mapped(top) === from && top.entry.name === name && top.to - top.from === to - from) {
        // Un nodo dopo la modifica uguale a prima: da qui l'albero è quello
        // di prima, spostato.
        if (top.from > toA) {
          resyncFrom = from;
          resynced = true;
          break;
        }
        // Un nodo prima della modifica, che l'albero nuovo legge uguale.
        added.push(shiftedTop(top.entry, top.from - top.entry.from));
        index++;
        visited++;
        if (!cursor.nextSibling()) break;
        continue;
      }
    }
    visited++;
    if (fresh.length >= PATCH_LIMIT) return null;
    const node = cursor.node;
    const toc = holdsToc(source, name, from, to, () => node);
    if (name === "Paragraph" && loneAnchorId(source.slice(from, to)) !== null) return null;
    const entry = { from, to, name, toc, found: findDefinitions(source, node, footnoteOpeners(source, from, to)), block: null as LazyBlock | null };
    if (!inert(entry)) return null;
    fresh.push({ entry, node });
    added.push(entry);
    if (!cursor.nextSibling()) break;
  }
  if (!resynced) {
    for (; index < tops.size; index++, visited++) if (!drop(tops.at(index))) return null;
  }
  if (visited > PATCH_LIMIT * 2) return null;
  // I richiami di nota restano gli stessi, nello stesso ordine, e la modifica
  // li porta dove sono ora: le definizioni del documento non cambiano, e si
  // spostano con il testo.
  const addedCalls = fresh.flatMap(({ entry }) => entry.found.calls.map((call) => ({ key: call.key, at: entry.from + call.at })));
  if (addedCalls.length !== removedCalls.length) return null;
  for (let at = 0; at < addedCalls.length; at++) {
    const call = addedCalls[at]!;
    const before = removedCalls[at]!;
    if (call.key !== before.key || changes.mapPos(before.at, 1) !== call.at) return null;
  }
  if (fresh.length > 0) alive.set(generation, fresh.length);
  if (alive.size > GENERATIONS) return null;
  const collected = movedDefinitions(was.collected, changes);
  const context: TopContext = { source, aux: auxOf(source, forms, collected), detailsOpen: new Map(), detailsClose: new Set(), generation };
  for (const { entry, node } of fresh) entry.block = renderTop(node, entry.found, context);
  return new LazyDocument({
    source,
    tops: tops.replace(low, index, added, delta),
    frontmatter,
    frontmatterBlock: was.frontmatterBlock,
    collected,
    dependencies: was.dependencies,
    forms,
    alive,
    fresh: fresh.length,
    visited,
    patch: { from: regionFrom, to: resyncFrom },
  });
}

/// Il nodo di primo livello che comincia a `from`.
function nodeAt(tree: Tree, from: number): SyntaxNode {
  let node = tree.topNode.childAfter(from)!;
  while (node.from < from) node = node.nextSibling!;
  return node;
}

function isCalloutNode(node: SyntaxNode, source: string): boolean {
  const lines = source
    .slice(node.from, node.to)
    .split("\n")
    .map((line) => line.replace(/^\s*(?:>\s?)+/, ""));
  return CALLOUT_HEAD.test((lines[0] ?? "").trim());
}

export function renderMarkdown(source: string, forms?: readonly SyntaxForm[]): MarkdownDocument {
  const normalized = normalizeLineBreaks(source);
  const tree = markdownGrammar.parser.parse(normalized);
  return buildDocument(normalized, tree, forms);
}

/// La resa di uno stato dell'editor. Con la resa di prima e le modifiche
/// della transazione, i blocchi che la modifica non tocca tornano da quella.
export function renderMarkdownState(
  state: EditorState,
  forms?: readonly SyntaxForm[],
  previous?: PreviousRender,
): MarkdownDocument {
  const { source, tree } = stateTree(state);
  return buildDocument(source, tree, forms, previous);
}

/// Fin dove un documento si rende tutto, in un colpo, quando l'editor lo
/// apre: oltre, la prima resa si ferma qui (`renderMarkdownStatePrefix`). In
/// caratteri: nel banco il parser di CodeMirror ne legge da tre a diecimila
/// al millisecondo (meno appena aperto, quando il motore JavaScript non l'ha
/// ancora ottimizzato), e ventimila coprono più volte la prima schermata di
/// qualunque finestra.
export const PREFIX_RENDER_FROM = 20_000;

/// La resa di uno stato, fin dove l'albero di CodeMirror è già arrivato.
export interface StatePrefixRender {
  readonly document: MarkdownDocument;
  /// `false`: la resa si ferma prima della fine del documento, e la sua
  /// sorgente (`document.source`) è soltanto l'inizio del testo.
  readonly complete: boolean;
}

/// La resa di uno stato senza leggere tutto un documento grande. Fino a
/// `PREFIX_RENDER_FROM` caratteri, o con l'albero già in fondo, è
/// `renderMarkdownState`. Oltre, il parser va avanti fino a quel punto e la
/// resa si ferma all'ultimo blocco di primo livello che l'albero ha chiuso:
/// il blocco dopo potrebbe continuare nel testo non ancora letto. Le
/// definizioni di link e note scritte più in basso arrivano con la resa
/// completa, che chi chiama fa quando l'albero è in fondo
/// (`ensureSyntaxTree` a pezzi, poi una transazione).
export function renderMarkdownStatePrefix(
  state: EditorState,
  forms?: readonly SyntaxForm[],
  previous?: PreviousRender,
): StatePrefixRender {
  const length = state.doc.length;
  if (length <= PREFIX_RENDER_FROM || syntaxTreeAvailable(state, length)) {
    return { document: renderMarkdownState(state, forms, previous), complete: true };
  }
  const tree = ensureSyntaxTree(state, PREFIX_RENDER_FROM, TREE_BUDGET) ?? syntaxTree(state);
  if (tree.topNode.name !== "Document") return { document: renderMarkdownState(state, forms, previous), complete: true };
  if (tree.length >= length) {
    return { document: buildDocument(state.doc.toString(), tree, forms, previous), complete: true };
  }
  const last = tree.topNode.lastChild;
  const cut = last ? last.from : 0;
  return { document: buildDocument(state.doc.sliceString(0, cut), tree, forms, previous), complete: false };
}

/// Le definizioni dei link di uno stato, per chiave normalizzata: quelle che
/// la resa usa, lette senza rendere il documento.
export function linkReferences(state: EditorState): ReadonlyMap<string, MarkdownLinkDefinition> {
  const { source, tree } = stateTree(state);
  return collectDefinitions(source, tree).references;
}

/// Quanto lavoro concedere al parser dell'editor perché arrivi in fondo, in
/// millisecondi, prima di rifare l'albero da capo.
const TREE_BUDGET = 200;

/// L'albero di CodeMirror, portato in fondo al documento; uno nuovo soltanto se
/// l'editor non ha un parser Markdown o non ci arriva in tempo.
function stateTree(state: EditorState): { source: string; tree: Tree } {
  const source = state.doc.toString();
  let tree = ensureSyntaxTree(state, state.doc.length, TREE_BUDGET);
  if (!tree || tree.length !== source.length || tree.topNode.name !== "Document") {
    tree = markdownGrammar.parser.parse(source);
  }
  return { source, tree };
}
