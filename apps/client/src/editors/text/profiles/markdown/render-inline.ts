import type { SyntaxNode } from "@lezer/common";
import { inlineDelimiters, scanTags, spans, wikilink, type FoundWikilink } from "../../../../rules/syntax";
import { markdownGrammar } from "./grammar";
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

/// Un'immagine Markdown come la scrive la resa. Live la riusa per le immagini
/// in mezzo al testo: stesse dimensioni (`alt|120`), stesso testo alternativo.
export function imageHtml(label: string, href: string, caption?: string, attrs = ""): string {
  const presentation = imagePresentation(label);
  const titleAttr = caption === undefined ? "" : ` title="${attribute(caption)}"`;
  return `<img src="${attribute(href)}" alt="${attribute(presentation.alt)}"${titleAttr}${presentation.dimensions}${attrs}>`;
}

/// `120` o `200x100` dopo la barra di un embed: una dimensione, non un'etichetta.
export function embedSizeOf(alias: string | null): string | null {
  return alias !== null && /^\s*\d{1,5}(?:x\d{1,5})?\s*$/.test(alias) ? alias.trim() : null;
}

/// Un embed `![[…]]` come lo scrive la resa: chi lo idrata (nota trasclusa o
/// media del vault) legge i `data-embed-*`.
export function embedHtml(link: Pick<FoundWikilink, "page" | "heading" | "block" | "alias" | "target">, attrs = ""): string {
  const data = ` data-embed-page="${escapeHtml(link.page)}"`
    + (link.heading ? ` data-embed-heading="${escapeHtml(link.heading)}"` : "")
    + (link.block ? ` data-embed-block="${escapeHtml(link.block)}"` : "");
  // `![[foto.png|120]]` e `![[foto.png|200x100]]`: il dopo-barra è una
  // dimensione per chi incorpora, non un'etichetta da mostrare.
  const size = embedSizeOf(link.alias);
  const shown = size !== null ? link.target : link.alias ?? link.target;
  const sized = size !== null ? ` data-embed-size="${escapeHtml(size)}"` : "";
  return `<span class="embed"${data}${sized}${attrs}>${escapeHtml(shown)}</span>`;
}

interface Piece { from: number; to: number; priority?: number; html: () => string }

function escaped(value: string, at: number): boolean {
  let slashes = 0;
  for (let index = at - 1; index >= 0 && value[index] === "\\"; index--) slashes++;
  return slashes % 2 === 1;
}

/// Una formula fra dollari: `from`/`to` coprono anche i dollari, `tex` è il
/// sorgente come lo porta il modello del provider.
export interface DollarMath {
  readonly from: number;
  readonly to: number;
  /// `$$…$$`: in mezzo al testo resta in riga, da sola nel paragrafo è un blocco.
  readonly display: boolean;
  readonly tex: string;
}

interface Range { readonly from: number; readonly to: number }

/// Gli spazi e le cifre di comrak sono quelli ASCII: un NBSP non è uno spazio.
function blank(character: string | undefined): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\v"
    || character === "\f" || character === "\r";
}

function digit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

/// Dove chiude la formula aperta da `fence` dollari prima di `from`: l'indice
/// del primo dollaro di chiusura, o -1. `$$…$$` chiude sul primo `$$`. Per
/// `$…$`, `failed.at` ricorda il dollaro su cui una ricerca precedente si è
/// fermata senza chiudere: ogni dollaro prima di lui l'aveva saltato, quindi
/// chi parte prima di lui finisce lì anche lui, e la lettura resta lineare.
function closing(value: string, from: number, fence: number, failed: { at: number }): number {
  if (fence === 2) return value.indexOf("$$", from);
  if (blank(value[from]) || from <= failed.at) return -1;
  for (let at = from; ; at++) {
    at = value.indexOf("$", at);
    if (at < 0) {
      failed.at = value.length;
      return -1;
    }
    if (value[at - 1] === "\\") continue;
    if (blank(value[at - 1]) || digit(value[at + 1])) {
      failed.at = at;
      return -1;
    }
    return at;
  }
}

/// Il TeX che il provider legge fra i dollari. Le righe dopo la prima perdono
/// il rientro, come nel paragrafo di comrak; in riga gli a capo diventano
/// spazi, a display il testo resta com'è scritto.
function texOf(content: string, display: boolean): string {
  const lines = content.split("\n");
  for (let index = 1; index < lines.length; index++) lines[index] = lines[index]!.replace(/^[ \t]+/, "");
  return lines.join(display ? "\n" : " ");
}

/// **La regola delle formule fra dollari**, la stessa di `math_dollars` di
/// comrak che il provider accende (`parse.rs`): Lettura, anteprima dal vivo e
/// azioni leggono le formule soltanto da qui, e la famiglia `math` del corpus
/// comune la confronta col modello del provider.
///
/// `value` è il testo di **un** contenitore di inline (paragrafo, titolo,
/// cella), che una formula può attraversare da una riga all'altra. Apre un
/// dollaro non protetto da backslash e fuori dagli intervalli `opaque`, in
/// ordine (codice, HTML, destinazioni: lì comrak non legge dollari); tre o più
/// dollari di fila sono testo. `$…$` non comincia con uno spazio e chiude sul
/// primo dollaro che non segue un backslash, se non segue uno spazio e non
/// precede una cifra (`$5 e $6` non è una formula); `$$…$$` chiude sul primo
/// `$$`. La ricerca della chiusura non guarda `opaque`: comrak legge i dollari
/// prima del codice. Una formula che ingoia un backtick lascia il contenitore
/// senza formule, come `code_beats_dollars` del provider.
export function scanDollarMath(value: string, opaque: readonly Range[] = []): DollarMath[] {
  const found: DollarMath[] = [];
  const failed = { at: -1 };
  let next = 0;
  const hidden = (at: number) => {
    while (next < opaque.length && opaque[next]!.to <= at) next++;
    return next < opaque.length && opaque[next]!.from <= at;
  };
  let at = value.indexOf("$");
  while (at >= 0) {
    if (escaped(value, at) || hidden(at)) {
      at = value.indexOf("$", at + 1);
      continue;
    }
    let fence = 1;
    while (value[at + fence] === "$") fence++;
    const close = fence > 2 ? -1 : closing(value, at + fence, fence, failed);
    if (close < 0) {
      at = value.indexOf("$", at + fence);
      continue;
    }
    const tex = texOf(value.slice(at + fence, close), fence === 2);
    if (tex.includes("`")) return [];
    found.push({ from: at, to: close + fence, display: fence === 2, tex });
    at = value.indexOf("$", close + fence);
  }
  return found;
}

/// I blocchi che il provider legge come un solo testo di inline: una formula
/// sta tutta in uno di loro.
const MATH_CONTAINERS: Record<string, true> = {
  Paragraph: true, Task: true, TableCell: true, SetextHeading1: true, SetextHeading2: true,
  ATXHeading1: true, ATXHeading2: true, ATXHeading3: true, ATXHeading4: true, ATXHeading5: true, ATXHeading6: true,
};
/// Marcatori di blocco dentro un contenitore: comrak li toglie prima di
/// leggere gli inline, qui valgono come spazi (gli offset restano quelli).
/// Quelli di un titolo non toccano mai un dollaro, e non servono. La casella
/// comrak la toglie soltanto dal primo blocco della voce: negli altri
/// paragrafi che Lezer legge come `Task` resta testo.
function blockMark(child: SyntaxNode, container: SyntaxNode): boolean {
  if (child.name === "QuoteMark") return true;
  if (child.name !== "TaskMarker") return false;
  let before = container.prevSibling;
  while (before?.name === "ListMark") before = before.prevSibling;
  return before === null;
}

export function isMathContainer(name: string): boolean {
  return MATH_CONTAINERS[name] === true;
}

/// Le formule di un contenitore, in posizioni assolute, col suo testo come lo
/// legge comrak: i marcatori di blocco diventano spazi.
export interface ContainerMath {
  readonly from: number;
  readonly text: string;
  readonly formulas: readonly DollarMath[];
}

/// Le formule del contenitore `container`, il cui testo è `text`.
export function containerMath(text: string, container: SyntaxNode): ContainerMath {
  const base = container.from;
  if (!text.includes("$")) return { from: base, text, formulas: [] };
  const opaque: Range[] = [];
  const marks: Range[] = [];
  const walk = (node: SyntaxNode) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      const range = { from: child.from - base, to: child.to - base };
      if (blockMark(child, container)) marks.push(range);
      // Un URL nudo resta testo anche per comrak; quello di un link no.
      else if (LITERAL_NODES[child.name] || child.name === "LinkTitle"
        || (child.name === "URL" && (node.name === "Link" || node.name === "Image"))) opaque.push(range);
      else walk(child);
    }
  };
  walk(container);
  let value = "";
  let position = 0;
  for (const mark of marks) {
    value += text.slice(position, mark.from) + " ".repeat(mark.to - mark.from);
    position = mark.to;
  }
  value += text.slice(position);
  // In una cella `\|` è una pipe già prima degli inline (GFM).
  const cell = container.name === "TableCell";
  const formulas = scanDollarMath(value, opaque).map((formula) => ({
    from: base + formula.from,
    to: base + formula.to,
    display: formula.display,
    tex: cell ? formula.tex.replace(/\\\|/g, "|") : formula.tex,
  }));
  return { from: base, text: value, formulas };
}

/// Il TeX del blocco che fa un contenitore composto, fino a `to`, soltanto da
/// una formula `$$…$$` e da spazi: `display_math` della resa del provider.
export function mathBlock(math: ContainerMath, to = math.from + math.text.length): string | null {
  const only = math.formulas[0];
  if (only === undefined || !only.display || only.to > to) return null;
  const outside = math.text.slice(0, only.from - math.from) + math.text.slice(only.to - math.from, to - math.from);
  return /\S/.test(outside) ? null : only.tex.trim();
}

const mathCache = new WeakMap<MarkdownRenderContext, Map<string, ContainerMath>>();

/// `containerMath` per la resa, calcolato una volta per contenitore.
export function mathOf(context: MarkdownRenderContext, container: SyntaxNode): ContainerMath {
  let byContainer = mathCache.get(context);
  if (!byContainer) mathCache.set(context, byContainer = new Map());
  const key = `${container.name}:${container.from}:${container.to}`;
  let found = byContainer.get(key);
  if (!found) {
    found = containerMath(context.source.slice(container.from, container.to), container);
    byContainer.set(key, found);
  }
  return found;
}

/// Le formule che toccano `[from, to)` sotto `node`: quelle del contenitore
/// che lo racchiude, o di quelli che contiene.
function formulasAround(context: MarkdownRenderContext, node: SyntaxNode, from: number, to: number): readonly DollarMath[] {
  for (let up: SyntaxNode | null = node; up; up = up.parent) {
    if (MATH_CONTAINERS[up.name]) return mathOf(context, up).formulas;
  }
  const found: DollarMath[] = [];
  const down = (current: SyntaxNode) => {
    for (let child = current.firstChild; child; child = child.nextSibling) {
      if (child.to <= from || child.from >= to) continue;
      if (MATH_CONTAINERS[child.name]) found.push(...mathOf(context, child).formulas);
      else down(child);
    }
  };
  down(node);
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
    if (node.name === "Image") return imageHtml(label, href, caption, attrs);
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
  const root = node ?? markdownGrammar.parser.parse(context.source).topNode;
  const pieces: Piece[] = [];
  const formulas = formulasAround(context, root, from, to);
  // Lezer non conosce le formule: un suo nodo che ne tocca una senza
  // contenerla (`*a $b* c$`) non è un'enfasi per il provider, e se ne leggono
  // i figli.
  const crosses = (current: SyntaxNode) => formulas.some((formula) =>
    formula.from < current.to && current.from < formula.to
    && (formula.from < current.from || current.to < formula.to));
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
      if (child.from >= from && child.to <= to && child.to > child.from && !crosses(child)) {
        const captured = child;
        pieces.push({ from: child.from, to: child.to, html: () => renderNode(context, captured) });
      } else {
        collectPieces(child);
      }
    }
  }
  collectPieces(root);
  protect(root);
  for (const { from: start, to: end, tex } of formulas) {
    pieces.push({
      from: start,
      to: end,
      html: () => `<span class="math-inline" data-tex="${escapeHtml(tex)}"${sourceAttributes(start, end)}>${escapeHtml(tex)}</span>`,
    });
  }
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
    for (const link of wikilink(row)) {
      const start = base + link.from, end = base + link.to;
      if ((!link.page && !link.heading && !link.block) || !free(start, end)) continue;
      wikiRanges.push({ from: start, to: end });
      pieces.push({ from: start, to: end, priority: 1, html: () => {
        if (link.embed) return embedHtml(link, sourceAttributes(start, end));
        const label = link.alias ?? link.target;
        const data = ` data-wikilink-page="${escapeHtml(link.page)}"`
          + (link.heading ? ` data-wikilink-heading="${escapeHtml(link.heading)}"` : "")
          + (link.block ? ` data-wikilink-block="${escapeHtml(link.block)}"` : "");
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
