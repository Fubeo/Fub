import type { SyntaxNode } from "@lezer/common";
import { inlineDelimiters, scanTags, textSpans, wikilink, type FoundWikilink } from "../../../../rules/syntax";
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
/// senza formule, come `code_beats_dollars` del provider. Fra un wikilink e una
/// formula vince chi apre prima: un dollaro dentro uno dei `wikilinks` che
/// apre dopo l'ultima formula (`[[a$]] b$`) non apre niente.
export function scanDollarMath(value: string, opaque: readonly Range[] = [], wikilinks: readonly Range[] = []): DollarMath[] {
  const found: DollarMath[] = [];
  const failed = { at: -1 };
  let next = 0;
  const hidden = (at: number) => {
    while (next < opaque.length && opaque[next]!.to <= at) next++;
    return next < opaque.length && opaque[next]!.from <= at;
  };
  let after = 0;
  const linked = (at: number) => wikilinks.some((link) => after <= link.from && link.from < at && at < link.to);
  let at = value.indexOf("$");
  while (at >= 0) {
    if (escaped(value, at) || hidden(at) || linked(at)) {
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
    after = close + fence;
    at = value.indexOf("$", after);
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
  const links = wikilink(value).filter((link) => opaque.every((range) => link.to <= range.from || range.to <= link.from));
  const formulas = scanDollarMath(value, opaque, links).map((formula) => ({
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

/// Un nodo che tocca una formula senza contenerla: per il provider vince la
/// formula, e il nodo non c'è.
function crossesFormula(formulas: readonly Range[], node: Range): boolean {
  return formulas.some((formula) => formula.from < node.to && node.from < formula.to
    && (formula.from < node.from || node.to < formula.to));
}

/// Un inline che il modello del provider ha come nodo, e che spezza quindi il
/// testo in cui cade. `content` è ciò che vi resta testo, il contenuto di
/// un'enfasi o l'etichetta di un link; manca se non c'è.
export interface NativeInline extends Range {
  readonly content?: Range;
}

const NATIVE_MARKS: Record<string, string> = {
  Emphasis: "EmphasisMark", StrongEmphasis: "EmphasisMark", Strikethrough: "StrikethroughMark",
  Subscript: "SubscriptMark", Superscript: "SuperscriptMark",
};
const NATIVE_ATOMS: Record<string, true> = {
  InlineCode: true, Autolink: true, HTMLTag: true, Comment: true, ProcessingInstruction: true, HardBreak: true,
};
/// Un rimando a una nota come lo legge comrak: anche senza definizione il
/// provider lo stacca dal testo che lo circonda.
export const FOOTNOTE_REFERENCE = /^\[\^[^\] \t\r\n]+\]$/;

/// Gli inline nativi sotto `node` che toccano [from, to), annidati compresi.
/// `link` dice se un link o un'immagine lo è anche per il provider: senza
/// destinazione `[x]` è testo, e se ne leggono i figli. Escape, entità e URL
/// nudi sono testo; un nodo che attraversa una formula pure.
export function nativeInlines(
  node: SyntaxNode,
  from: number,
  to: number,
  link: (node: SyntaxNode) => NativeInline | null,
  formulas: readonly Range[],
): NativeInline[] {
  const found: NativeInline[] = [];
  const walk = (current: SyntaxNode) => {
    for (let child = current.firstChild; child; child = child.nextSibling) {
      if (child.to <= from || child.from >= to) continue;
      let native: NativeInline | null = null;
      if (!crossesFormula(formulas, child)) {
        const marks = NATIVE_MARKS[child.name] ? child.getChildren(NATIVE_MARKS[child.name]!) : [];
        if (marks.length >= 2) {
          native = { from: child.from, to: child.to, content: { from: marks[0]!.to, to: marks[marks.length - 1]!.from } };
        } else if (NATIVE_ATOMS[child.name]) native = { from: child.from, to: child.to };
        else if (child.name === "Link" || child.name === "Image") native = link(child);
      }
      if (native) found.push(native);
      if (!native || native.content) walk(child);
    }
  };
  walk(node);
  return found;
}

/// Ciò che di un inline nativo non è testo: tutto, o soltanto i marcatori
/// attorno al suo contenuto.
export function nativeCuts(natives: readonly NativeInline[]): Range[] {
  return natives.flatMap((native) => native.content
    ? [{ from: native.from, to: native.content.from }, { from: native.content.to, to: native.to }]
    : [native]);
}

/// Una nota in riga c'è se apre e chiude nello stesso testo del modello: nessun
/// inline nativo la attraversa, e il suo `[` non apre un link. Ciò che contiene
/// è suo, e il provider lo legge come etichetta.
export function footnoteStands(note: Range, natives: readonly NativeInline[]): boolean {
  return natives.every((native) => native.to <= note.from || note.to <= native.from
    || (native.content !== undefined && native.content.from <= note.from && note.to <= native.content.to)
    || (note.from <= native.from && native.to <= note.to && native.from !== note.from + 1));
}

interface InlineFootnote {
  readonly from: number;
  readonly to: number;
  readonly contentFrom: number;
  readonly contentTo: number;
}

export function scanInlineFootnotes(value: string): InlineFootnote[] {
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

/// Dove porta un link o un'immagine: la destinazione scritta o quella della
/// sua definizione. Senza nessuna delle due `[x]` è testo, anche per comrak.
function linkTarget(
  context: MarkdownRenderContext,
  node: SyntaxNode,
): { labelFrom: number; labelTo: number; href: string; caption: string | undefined } | null {
  const source = context.source;
  const marks = node.getChildren("LinkMark");
  const opener = marks[0];
  const closer = marks.find((mark) => source[mark.from] === "]");
  if (!opener || !closer) return null;
  const label = source.slice(opener.to, closer.from);
  const url = node.getChild("URL");
  const title = node.getChild("LinkTitle");
  const reference = node.getChild("LinkLabel");
  const definition = context.references.get(normalizeLabel(reference
    ? source.slice(reference.from + 1, reference.to - 1) || label : label));
  let href = url ? source.slice(url.from, url.to) : definition?.href;
  if (href === undefined) return null;
  if (href.startsWith("<") && href.endsWith(">")) href = href.slice(1, -1);
  const caption = title ? source.slice(title.from + 1, title.to - 1) : definition?.title;
  return { labelFrom: opener.to, labelTo: closer.from, href, caption };
}

/// Il nodo nativo di un link della Lettura: un rimando a una nota sempre, un
/// link o un'immagine se portano da qualche parte.
function linkNative(context: MarkdownRenderContext, node: SyntaxNode): NativeInline | null {
  if (node.name === "Link" && FOOTNOTE_REFERENCE.test(context.source.slice(node.from, node.to))) {
    return { from: node.from, to: node.to };
  }
  const target = linkTarget(context, node);
  if (!target) return null;
  if (node.name === "Image") return { from: node.from, to: node.to };
  return { from: node.from, to: node.to, content: { from: target.labelFrom, to: target.labelTo } };
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
    const target = linkTarget(context, node);
    if (!target) return text(context, node.from, node.to);
    const { labelFrom, labelTo, href, caption } = target;
    const label = source.slice(labelFrom, labelTo);
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
export function renderInline(context: MarkdownRenderContext, from: number, to: number, node?: SyntaxNode, plain = false): string {
  if (from >= to) return "";
  const root = node ?? markdownGrammar.parser.parse(context.source).topNode;
  const pieces: Piece[] = [];
  const formulas = formulasAround(context, root, from, to);
  const protectedRanges: Array<{ from: number; to: number }> = [];
  function protect(current: SyntaxNode): void {
    if (current.to <= from || current.from >= to) return;
    if (LITERAL_NODES[current.name] || current.name === "URL" || current.name === "LinkTitle") {
      protectedRanges.push(current);
      return;
    }
    for (let child = current.firstChild; child; child = child.nextSibling) protect(child);
  }
  // Lezer non conosce le formule: un suo nodo che ne tocca una senza
  // contenerla (`*a $b* c$`) non è un'enfasi per il provider, e se ne leggono
  // i figli.
  function collectPieces(current: SyntaxNode): void {
    for (let child = current.firstChild; child; child = child.nextSibling) {
      if (child.to <= from || child.from >= to) continue;
      if (child.from >= from && child.to <= to && child.to > child.from && !crossesFormula(formulas, child)) {
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
  const inFormula = (at: number) => formulas.some((formula) => formula.from <= at && at < formula.to);
  const delimiters = inlineDelimiters(context.forms);
  // Gli inline che il modello del provider ha come nodi: una nota in riga non
  // li attraversa, e un evidenziato o un commento sta tutto in un testo fra due
  // di loro.
  const natives = plain ? [] : [...nativeInlines(root, from, to, (link) => linkNative(context, link), formulas), ...formulas];
  const cuts = nativeCuts(natives);
  // Il contenuto di un evidenziato (`plain`) è per il provider il testo di un
  // nodo suo, dove nessun'altra regola entra.
  let lineFrom = plain ? to : from;
  while (lineFrom < to) {
    const newline = context.source.indexOf("\n", lineFrom);
    const lineTo = newline < 0 ? to : Math.min(to, newline);
    const row = context.source.slice(lineFrom, lineTo);
    const base = lineFrom;
    const rowCuts = cuts.filter((cut) => cut.from < lineTo && lineFrom < cut.to)
      .map((cut) => ({ from: cut.from - base, to: cut.to - base }));
    const wikiRanges: Array<{ from: number; to: number }> = [];
    for (const note of scanInlineFootnotes(row)) {
      const start = base + note.from, end = base + note.to;
      if (!footnoteStands({ from: start, to: end }, natives)) continue;
      rowCuts.push(note);
      pieces.push({
        from: start,
        to: end,
        priority: 3,
        html: () => `<sup class="footnote-inline"${sourceAttributes(start, end)}>${renderInline(context, base + note.contentFrom, base + note.contentTo, root)}</sup>`,
      });
    }
    for (const link of wikilink(row)) {
      const start = base + link.from, end = base + link.to;
      if (!free(start, end) || inFormula(start)) continue;
      // Anche un wikilink che non nomina niente è un nodo del provider.
      rowCuts.push(link);
      if (!link.page && !link.heading && !link.block) continue;
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
    for (const tag of scanTags(row)) {
      const start = base + tag.from, end = base + tag.to;
      if (!free(start, end) || wikiRanges.some((range) => start < range.to && end > range.from)) continue;
      rowCuts.push(tag);
      pieces.push({ from: start, to: end, html: () => `<span class="tag" data-tag="${escapeHtml(tag.name)}"${sourceAttributes(start, end)}>${escapeHtml(context.source.slice(start, end))}</span>` });
    }
    for (const span of textSpans(row, rowCuts, delimiters)) {
      const start = base + span.from, end = base + span.to;
      // Un commento resta nel file e non nella resa (`fub:comments`).
      if (span.name === "fub:comments") {
        pieces.push({ from: start, to: end, priority: 4, html: () => "" });
        continue;
      }
      pieces.push({ from: start, to: end, html: () => `<mark class="inline-highlight"${sourceAttributes(start, end)}>${renderInline(context, base + span.contentFrom, base + span.contentTo, root, true)}</mark>` });
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
