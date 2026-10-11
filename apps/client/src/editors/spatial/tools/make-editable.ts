// «Rendi modificabile»: le parti estranee di un disegno diventano oggetti del
// formato, se si può senza che cambi niente di ciò che si vede. È un comando
// esplicito dell'Esperto, su un blocco, sugli oggetti scelti o su tutto il
// disegno; fuori dal comando niente si normalizza.
//
// - **Che cosa traduce:** l'attributo `style` in attributi di presentazione;
//   le regole dei fogli `<style>` che scelgono un elemento, coi valori che vi
//   danno; i colori di CSS (`rgb()`, `hsl()`, `hwb()`, `transparent`,
//   `currentColor`, le forme con la trasparenza) in `#rrggbb` con l'opacità a
//   parte; le misure relative (`em`, `rem`, le percentuali della finestra) in
//   numeri; `data-name` e `aria-label` nel titolo, che è il nome
//   dell'oggetto. Gli attributi che non disegnano niente e che il formato non
//   ammette, come `data-*` e `class`, se ne vanno.
// - **Come lo vede un browser, prima e dopo:** lo stile di prima si calcola
//   con la cascata di CSS e tutti i fogli (`cascade.ts`). Dopo, un elemento
//   reso modificabile si guarda due volte: coi fogli che restano, come lo
//   vedono un browser e l'esportazione, e senza, come lo disegna la
//   superficie, che sugli oggetti vivi non applica fogli e dalla radice
//   prende solo alcuni attributi. Con dei fogli si riguarda anche ogni altro
//   elemento, perché un foglio sceglie anche per posizione. Il confronto è
//   quello di `editable-look.ts`, con le equivalenze di resa.
// - **Le unità sono atomiche:** un'unità estranea diventa modificabile, con
//   i figli che possono se è un gruppo, oppure resta byte per byte, col
//   perché. Un figlio di un gruppo che non può resta estraneo dentro il
//   gruppo diventato modificabile, com'era.
// - **I fogli si puliscono:** una regola che dopo non sceglie più niente se
//   ne va, se prima sceglieva qualcosa o se il comando è su tutto il
//   disegno; un foglio vuoto se ne va con la `defs` che lo conteneva, se
//   resta vuota. Una regola che sceglierebbe ancora un elemento reso
//   modificabile lo lascia estraneo, perché vincerebbe sugli attributi che
//   vi si cambiano. Le regole dentro una condizione, come `@media`, restano,
//   e un elemento il cui stile dipende da loro resta estraneo.
// - **Alla fine si prova:** le operazioni si applicano a un motore di prova;
//   il testo che ne esce si riclassifica e si riconfronta. Ciò che non torna
//   resta estraneo, e si riprova senza. Le operazioni sono un passo solo
//   d'annulla: ogni unità si toglie e si rimette riscritta nel punto esatto
//   da cui è partita, con gli spazi attorno com'erano. Un documento non
//   ancora adottato si adotta nello stesso passo.

import { resourceIndex, resourceKind, svgAttribute, tagOf, type Resolve, type Tag } from "../scene/classify";
import { SceneEngine } from "../scene/engine";
import { transform as svgTransform, viewBox as readViewBox, length as svgLength, paint as formatPaint, reference } from "../scene/values";
import { elementChildren, tagName, type DocumentModel, type ElementPart } from "../scene/model";
import type { Op, RestoreOp } from "../scene/ops";
import { canonicalOrder, escapeAttribute, escapeText, formatTransform, type OutAttr } from "../scene/serialize";
import { SourceText } from "../scene/text";
import { isSpace, NS_NONE, NS_SVG, NS_XLINK, parseXml, SVG_NS, type Attr, type ElementNode, type XmlDocument } from "../scene/xml";
import { formatNumber } from "../number";
import { Cascade, inherits, longhands, PRESENTATION, readOpacity, renders, same, type CascadeNode } from "./cascade";
import { Matcher, readDeclarations, readSheet, readSheets, type Rule, type Sheet, type StyleAttr } from "./selectors";
import { formatHex } from "./css-color";
import { ambiguousSpace, difference, lengthOf, paintOf, shapeFacts, type Difference, type ShapeFacts } from "./editable-look";

/// Su che cosa lavora il comando: tutto il disegno, o le unità estranee che
/// stanno ai percorsi dati (gli indici dei figli elemento dalla radice), o
/// che li contengono.
export type EditableScope = { readonly kind: "all" } | { readonly kind: "units"; readonly paths: readonly (readonly number[])[] };

/// Le traduzioni che il comando conta, per dirle.
export type Translation = "style" | "sheet" | "color" | "unit" | "data";

/// Perché una parte resta estranea.
export type Reason =
  /// Un elemento che il formato non ha, come `switch` o `foreignObject`.
  | { readonly kind: "element"; readonly tag: string }
  /// Un `use` che non è un'istanza di un simbolo.
  | { readonly kind: "use" }
  /// Un elemento che il formato non ammette dove sta, come una sfumatura
  /// fuori dalla `defs` della radice.
  | { readonly kind: "place"; readonly tag: string }
  /// Un attributo che il formato non ammette e che non si può togliere.
  | { readonly kind: "attribute"; readonly name: string }
  /// Un valore di stile che il formato non sa scrivere.
  | { readonly kind: "property"; readonly name: string; readonly value: string }
  /// Uno stile che dipende da dove si guarda il disegno, come `@media`.
  | { readonly kind: "condition"; readonly text: string }
  /// Uno stile da un selettore che non si sa leggere, come `:hover`.
  | { readonly kind: "selector"; readonly text: string }
  /// Una regola che resta e sceglierebbe ancora la parte.
  | { readonly kind: "shared"; readonly text: string }
  /// Un foglio che sceglie per posizione: cambierebbe l'aspetto di un vicino.
  | { readonly kind: "structure" }
  /// Un foglio importato, che qui non si legge.
  | { readonly kind: "import" }
  /// Una misura relativa che non si sa calcolare, come `ex`.
  | { readonly kind: "unit"; readonly value: string }
  /// Un rimando a una risorsa che il formato non conosce.
  | { readonly kind: "resource"; readonly id: string }
  /// Un `use` mostra la parte anche altrove.
  | { readonly kind: "copy" }
  /// La parte sta in un livello o in un gruppo bloccato.
  | { readonly kind: "locked" }
  /// Un testo con righe che il formato non ha.
  | { readonly kind: "text" }
  /// Un figlio che il formato non ammette lì.
  | { readonly kind: "child"; readonly tag: string }
  | { readonly kind: "unknown" };

/// Una parte che resta estranea: dove sta dopo il comando, il tag, il nome
/// se ne ha uno, e il perché.
export interface Leftover {
  readonly path: readonly number[];
  readonly tag: string;
  readonly name: string | null;
  readonly reason: Reason;
}

/// Ciò che il comando farebbe.
export interface EditablePlan {
  /// Le operazioni, da applicare in un `batch`: vuote se non c'è niente da
  /// fare.
  readonly ops: readonly Op[];
  /// Quante unità estranee diventano modificabili.
  readonly converted: number;
  /// Quanti elementi hanno avuto ogni traduzione.
  readonly translations: ReadonlyMap<Translation, number>;
  /// Ciò che resta estraneo e si vede, col perché.
  readonly leftovers: readonly Leftover[];
  /// Quante regole dei fogli se ne vanno.
  readonly rules: number;
  /// Quanti fogli se ne vanno.
  readonly sheets: number;
  /// Quante parti estranee non si vedono e restano come sono: metadati,
  /// impostazioni di altri programmi, fogli.
  readonly invisible: number;
  /// Il testo di dopo; `null` se non c'è niente da fare.
  readonly after: string | null;
}

const XHTML_NS = "http://www.w3.org/1999/xhtml";

/// Gli elementi SVG estranei che da soli non disegnano niente: restano come
/// sono e non si contano fra ciò che resta.
const INVISIBLE: ReadonlySet<string> = new Set(["metadata", "script", "style", "title", "desc", "defs", "view", "symbol"]);

/// Gli attributi che non disegnano niente e che il formato non ammette.
const JUNK: ReadonlySet<string> = new Set([
  "focusable", "enable-background", "version", "baseProfile", "tabindex", "role", "contentScriptType", "contentStyleType",
  "zoomAndPan", "externalResourcesRequired",
]);

/// Gli attributi che decidono se l'elemento si disegna: restano, e
/// l'elemento con loro.
const CONDITIONAL: ReadonlySet<string> = new Set(["systemLanguage", "requiredFeatures", "requiredExtensions", "requiredFonts", "requiredFormats"]);

/// Gli attributi che possono rimandare a una risorsa.
const REFERENCES: ReadonlySet<string> = new Set(["fill", "stroke", "marker-start", "marker-mid", "marker-end", "clip-path", "mask", "filter"]);

/// Le risorse del formato.
const RESOURCES: ReadonlySet<string> = new Set(["linearGradient", "radialGradient", "pattern", "marker", "clipPath", "mask", "filter"]);

/// La geometria che può essere una misura relativa, e su quali tag.
const GEOMETRY: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["x", new Set(["rect", "image", "text", "tspan"])],
  ["y", new Set(["rect", "image", "text"])],
  ["dy", new Set(["tspan"])],
  ["width", new Set(["rect", "image"])],
  ["height", new Set(["rect", "image"])],
  ["cx", new Set(["circle", "ellipse"])],
  ["cy", new Set(["circle", "ellipse"])],
  ["r", new Set(["circle"])],
  ["rx", new Set(["rect", "ellipse"])],
  ["ry", new Set(["rect", "ellipse"])],
  ["x1", new Set(["line"])],
  ["y1", new Set(["line"])],
  ["x2", new Set(["line"])],
  ["y2", new Set(["line"])],
]);

/// I contenitori del formato: i figli di uno che lo diventa si classificano
/// uno per uno.
const CONTAINERS: ReadonlySet<string> = new Set(["g", "a"]);

/// Le proprietà ereditate che un gruppo può portare ai figli.
const GROUP_INHERITED: readonly string[] = [
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "font-family", "font-size", "font-weight",
  "font-style", "text-anchor", "letter-spacing",
];

/// Gli attributi della radice che la superficie porta sugli oggetti vivi, se
/// varrebbero su un `g`: gli stessi del pittore.
export const LIVE_ROOT: readonly string[] = [
  "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "opacity",
  "font-family", "font-size", "font-weight", "text-anchor",
];

/// I servizi di caratteri: i soli fogli importati che non toccano lo stile
/// degli elementi.
const FONT_SERVICES = /^(?:https?:)?\/\/(?:fonts\.googleapis\.com|fonts\.bunny\.net|use\.typekit\.net|fonts\.cdnfonts\.com|api\.fontshare\.com)\//i;

/// Quante volte si riprova al più, togliendo ogni volta ciò che non torna.
const MAX_ROUNDS = 48;

/// Le cifre dei numeri calcolati.
const PLACES = 4;

const num = (n: number): string => formatNumber(n, PLACES);

const NO_SHEET: Sheet = { rules: [], selectors: [], deep: false, imports: [] };

// ---------------------------------------------------------------------------
// L'albero.
// ---------------------------------------------------------------------------

/// Un elemento come lo vedono la cascata e i selettori.
class El implements CascadeNode {
  parent: El | null = null;
  children: El[] = [];
  /// Il pezzo del modello di cui è la cima: un contenitore o un'unità.
  part: ElementPart | null = null;
  /// L'unità che lo contiene, lui compreso; `null` in un contenitore.
  unit: El | null = null;
  /// Vero se sta in un'unità estranea.
  foreign = false;
  /// L'elemento di prima da cui viene; `null` per uno nuovo.
  origin: El | null = null;

  constructor(
    readonly uri: string,
    readonly local: string,
    /// Il nome com'è scritto.
    readonly name: string,
    public attrs: StyleAttr[],
    readonly text: boolean,
    /// L'elemento letto; `null` per uno nuovo.
    readonly element: ElementNode | null,
    /// Il foglio, per un `style` che ne porta uno.
    readonly sheet: string | null,
    readonly serial: number,
  ) {}

  attr(local: string): string | null {
    return this.attrs.find((attr) => attr.uri === "" && attr.local === local)?.value ?? null;
  }

  /// Scrive l'attributo `local` senza namespace, al suo posto se c'è già;
  /// `null` lo toglie.
  set(local: string, value: string | null): void {
    const at = this.attrs.findIndex((attr) => attr.uri === "" && attr.local === local);
    if (value === null) {
      if (at >= 0) this.attrs.splice(at, 1);
    } else if (at >= 0) this.attrs[at] = { uri: "", local, value };
    else this.attrs.push({ uri: "", local, value });
  }

  /// Vero se è l'elemento SVG `local`.
  is(local: string): boolean {
    return this.uri === SVG_NS && this.local === local;
  }
}

/// Gli attributi di `element` come li vedono i selettori, senza le
/// dichiarazioni di namespace.
function styleAttrs(element: ElementNode): Attr[] {
  return element.attrs.filter((attr) => attr.name !== "xmlns" && !attr.name.startsWith("xmlns:"));
}

/// L'albero degli elementi di `doc`.
function treeOf(doc: XmlDocument, serial: () => number): El {
  const build = (element: ElementNode): El => {
    const uri = doc.namespaces[element.ns]!;
    const attrs = styleAttrs(element).map((attr) => ({ uri: doc.namespaces[attr.ns]!, local: attr.local, value: attr.value }));
    let text = false;
    let css = "";
    for (const child of element.children) {
      const node = doc.nodes[child]!;
      if (node.kind === "text" || node.kind === "cdata") {
        text = true;
        css += node.value;
      } else if (node.kind === "entity-ref") {
        text = true;
        css += doc.plainEntity(node.name) ?? "";
      }
    }
    const type = attrs.find((attr) => attr.uri === "" && attr.local === "type")?.value.trim().toLowerCase() ?? "";
    const sheet = element.local === "style" && (uri === SVG_NS || uri === XHTML_NS) && (type === "" || type === "text/css") ? css : null;
    return new El(uri, element.local, element.name, attrs, text, element, sheet, serial());
  };
  const top = doc.element(doc.root)!;
  const root = build(top);
  const stack: Array<[ElementNode, El]> = [[top, root]];
  while (stack.length > 0) {
    const [element, node] = stack.pop()!;
    for (const child of element.children) {
      const inner = doc.element(child);
      if (inner === null) continue;
      const built = build(inner);
      built.parent = node;
      node.children.push(built);
      stack.push([inner, built]);
    }
  }
  return root;
}

/// Gli elementi di `root` in ordine di documento, lui compreso.
function walk(root: El): El[] {
  const out: El[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    out.push(node);
    for (let k = node.children.length - 1; k >= 0; k--) stack.push(node.children[k]!);
  }
  return out;
}

/// Lega gli elementi di `root` ai pezzi di `model`; falso se non si
/// corrispondono.
function annotate(root: El, model: DocumentModel): boolean {
  const stack: Array<[ElementPart, El]> = [[model.root, root]];
  while (stack.length > 0) {
    const [part, node] = stack.pop()!;
    if (part.facts.local !== node.local || part.facts.uri !== node.uri) return false;
    node.part = part;
    if (part.kind === "container") {
      const children = elementChildren(part);
      if (children.length !== node.children.length) return false;
      children.forEach((child, at) => stack.push([child, node.children[at]!]));
    } else {
      for (const inner of walk(node)) {
        inner.unit = node;
        inner.foreign = part.details === null;
      }
    }
  }
  return true;
}

/// Una copia di `root`: ogni elemento ricorda `origin(originale)`.
function cloneTree(root: El, serial: () => number, origin: (node: El) => El | null): [El, Map<El, El>] {
  const copies = new Map<El, El>();
  const copy = (node: El, parent: El | null): El => {
    const made = new El(node.uri, node.local, node.name, [...node.attrs], node.text, node.element, node.sheet, serial());
    made.parent = parent;
    made.part = node.part;
    made.foreign = node.foreign;
    made.origin = origin(node);
    copies.set(node, made);
    return made;
  };
  const top = copy(root, null);
  const stack: Array<[El, El]> = [[root, top]];
  while (stack.length > 0) {
    const [from, to] = stack.pop()!;
    for (const child of from.children) {
      const made = copy(child, to);
      to.children.push(made);
      stack.push([child, made]);
    }
  }
  for (const [node, made] of copies) made.unit = node.unit === null ? null : copies.get(node.unit)!;
  return [top, copies];
}

/// L'albero di `root` come lo vede la superficie: dalla radice soltanto gli
/// attributi che il pittore porta sugli oggetti vivi.
function liveTree(root: El, serial: () => number, origin: (node: El) => El | null): [El, Map<El, El>] {
  const [live, of] = cloneTree(root, serial, origin);
  live.attrs = live.attrs.filter((attr) => attr.uri === "" && LIVE_ROOT.includes(attr.local) && svgAttribute("g", attr.local, attr.value));
  return [live, of];
}

/// Il percorso di `node`: gli indici dei figli elemento dalla radice.
function pathOf(node: El): number[] {
  const out: number[] = [];
  for (let at: El = node; at.parent !== null; at = at.parent) out.push(at.parent.children.indexOf(at));
  return out.reverse();
}

/// Vero se `node` è un elemento che da solo non disegna niente.
function invisible(node: El): boolean {
  return node.uri !== SVG_NS || INVISIBLE.has(node.local);
}

/// Vero se `inner` sta dentro `outer`, o è lui.
function within(inner: El, outer: El): boolean {
  for (let at: El | null = inner; at !== null; at = at.parent) if (at === outer) return true;
  return false;
}

/// Le proprietà dichiarate negli attributi `style` di un albero.
function inlineSet(root: El): Set<string> {
  const out = new Set<string>();
  for (const node of walk(root)) {
    const style = node.attr("style");
    if (style === null) continue;
    for (const declaration of readDeclarations(style)) for (const p of longhands(declaration.property)) out.add(p);
  }
  return out;
}

/// Vero se `style` dichiara qualcosa.
function declares(style: string | null): boolean {
  return style !== null && readDeclarations(style).length > 0;
}

/// I nomi degli attributi senza namespace di un albero.
function attributeNames(root: El): Set<string> {
  const out = new Set<string>();
  for (const node of walk(root)) for (const attr of node.attrs) if (attr.uri === "") out.add(attr.local);
  return out;
}

/// La finestra della radice, larga e alta: il `viewBox`, o `width` e
/// `height` assoluti.
function viewportOf(root: El): readonly [number, number] | null {
  const box = root.attr("viewBox");
  const read = box === null ? null : readViewBox(box);
  if (read !== null && read[2] > 0 && read[3] > 0) return [read[2], read[3]];
  const w = svgLength(root.attr("width") ?? "");
  const h = svgLength(root.attr("height") ?? "");
  return w !== null && h !== null && w > 0 && h > 0 ? [w, h] : null;
}

/// Il nome di `node` per dirlo: il titolo, poi i nomi degli altri
/// programmi, poi l'id.
function nameOf(doc: XmlDocument, node: El): string | null {
  const title = node.children.find((child) => child.is("title"));
  if (title?.element !== null && title?.element !== undefined) {
    const text = characterDataOf(doc, title.element);
    if (text !== null) return text;
  }
  for (const [uri, local] of [["", "data-name"], ["", "aria-label"], ["http://www.inkscape.org/namespaces/inkscape", "label"], ["", "id"]]) {
    const value = node.attrs.find((attr) => attr.uri === uri && attr.local === local)?.value.trim();
    if (value !== undefined && value !== "") return value;
  }
  return null;
}

/// Il testo di un elemento, se ha soltanto testo.
function characterDataOf(doc: XmlDocument, element: ElementNode): string | null {
  let out = "";
  for (const child of element.children) {
    const node = doc.nodes[child]!;
    if (node.kind !== "text") return null;
    out += node.value;
  }
  const text = out.trim().replace(/\s+/g, " ");
  return text === "" ? null : text;
}

// ---------------------------------------------------------------------------
// I fogli.
// ---------------------------------------------------------------------------

/// Una frase di primo livello di un foglio, una regola o una at-rule, coi
/// suoi limiti nel testo del foglio e le regole lette che ne vengono.
interface Statement {
  readonly start: number;
  readonly end: number;
  readonly at: boolean;
  readonly rules: readonly Rule[];
}

/// Un foglio del disegno.
interface SheetOf {
  readonly el: El;
  readonly id: string;
  readonly css: string;
  /// Le frasi, se si sanno separare e corrispondono alle regole lette.
  readonly statements: readonly Statement[] | null;
  /// Dove sta il testo del foglio nel documento, per riscriverlo: per ogni
  /// indice del foglio, e per la fine, quello nel documento. `null` se non
  /// si sa riscrivere (entità, più pezzi).
  readonly raw: readonly number[] | null;
}

/// Le frasi di primo livello di `css`, coi loro limiti; `null` se non si
/// leggono.
function statementsOf(css: string): Array<{ start: number; end: number; at: boolean }> | null {
  const out: Array<{ start: number; end: number; at: boolean }> = [];
  const n = css.length;
  let i = 0;
  const comment = (): boolean => {
    if (css[i] !== "/" || css[i + 1] !== "*") return false;
    const end = css.indexOf("*/", i + 2);
    i = end < 0 ? n : end + 2;
    return true;
  };
  while (i < n) {
    if (/\s/.test(css[i]!)) i++;
    else if (comment()) continue;
    else if (css.startsWith("<!--", i)) i += 4;
    else if (css.startsWith("-->", i)) i += 3;
    else {
      const start = i;
      const at = css[i] === "@";
      let depth = 0;
      let done = false;
      while (i < n && !done) {
        if (comment()) continue;
        const c = css[i]!;
        if (c === '"' || c === "'") {
          i++;
          while (i < n && css[i] !== c) {
            if (css[i] === "\n") return null;
            i += css[i] === "\\" ? 2 : 1;
          }
          i++;
          continue;
        }
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth < 0) return null;
          if (depth === 0) done = true;
        } else if (c === ";" && depth === 0 && at) done = true;
        i++;
      }
      if (depth !== 0) return null;
      out.push({ start, end: Math.min(i, n), at });
    }
  }
  return out;
}

/// Gli indici nel documento di ogni carattere di `value`, il testo letto di
/// un nodo il cui testo grezzo comincia in `start`: uguali salvo i
/// terminatori di riga, che il lettore riduce a `\n`. `null` se non si
/// corrispondono.
function rawMap(source: string, start: number, end: number, value: string): number[] | null {
  const map: number[] = [];
  let r = start;
  for (let v = 0; v < value.length; v++) {
    if (source[r] === "\r") {
      if (value[v] !== "\n") return null;
      map.push(r);
      r += source[r + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (source[r] !== value[v]) return null;
    map.push(r++);
  }
  if (r !== end) return null;
  map.push(r);
  return map;
}

/// I fogli di `root`, letti insieme come li legge un browser.
function readAllSheets(doc: XmlDocument, root: El): { sheets: SheetOf[]; sheet: Sheet } {
  const els = walk(root).filter((node) => node.sheet !== null);
  const sheet = readSheets(els.map((el, at) => ({ id: String(at), css: el.sheet! })));
  const source = doc.source.text;
  const sheets = els.map((el, at): SheetOf => {
    const id = String(at);
    const css = el.sheet!;
    const own = sheet.rules.filter((rule) => rule.id.startsWith(`${id}:`));
    const found = statementsOf(css);
    let statements: Statement[] | null = null;
    if (found !== null) {
      statements = [];
      let next = 0;
      for (const each of found) {
        const count = readSheet(css.slice(each.start, each.end)).rules.length;
        statements.push({ ...each, rules: own.slice(next, next + count) });
        next += count;
      }
      if (next !== own.length || statements.some((statement) => !statement.at && statement.rules.length === 0)) statements = null;
    }
    // Il testo si riscrive se è un pezzo solo, testo o CDATA, senza entità.
    let raw: number[] | null = null;
    const children = el.element!.children.map((child) => doc.nodes[child]!);
    if (children.length === 1) {
      const node = children[0]!;
      if (node.kind === "text") raw = rawMap(source, node.start, node.end, node.value);
      else if (node.kind === "cdata") raw = rawMap(source, node.start + 9, node.end - 3, node.value);
    }
    return { el, id, css, statements, raw };
  });
  return { sheets, sheet };
}

/// Vero se le regole di `a` e di `b` sono le stesse, nello stesso ordine.
function sameRules(a: readonly Rule[], b: readonly Rule[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((rule, at) => {
    const other = b[at]!;
    return rule.text === other.text && rule.condition === other.condition && rule.at === other.at && rule.layer === other.layer
      && rule.specificity === other.specificity && JSON.stringify(rule.declarations) === JSON.stringify(other.declarations);
  });
}

/// `css` senza le frasi `statements`.
function removeRanges(css: string, statements: readonly Statement[]): string {
  let out = "";
  let at = 0;
  for (const statement of [...statements].sort((a, b) => a.start - b.start)) {
    out += css.slice(at, statement.start);
    at = statement.end;
  }
  return out + css.slice(at);
}

/// Vero se `css` non ha più niente oltre a spazi e commenti.
function blankCss(css: string): boolean {
  return css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, "").replace(/<!--|-->/g, "").trim() === "";
}

// ---------------------------------------------------------------------------
// Il testo.
// ---------------------------------------------------------------------------

/// Una modifica del testo: da dove a dove, e che cosa ci va.
type Edit = readonly [from: number, to: number, text: string];

/// `text` fra `start` e `end` con le modifiche `edits`.
function applyEdits(text: string, start: number, end: number, edits: readonly Edit[]): string | null {
  const sorted = [...edits].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let out = "";
  let at = start;
  for (const [from, to, inserted] of sorted) {
    if (from < at || to > end) return null;
    out += text.slice(at, from) + inserted;
    at = to;
  }
  return out + text.slice(at, end);
}

/// Dove sta un attributo nel tag: dallo spazio che lo precede alla
/// virgoletta che lo chiude, e dove comincia il nome.
function attributeSpan(text: string, attr: Attr): { readonly from: number; readonly name: number; readonly to: number } {
  // Dalla virgoletta d'apertura indietro: spazi, `=`, spazi, il nome.
  let at = attr.raw[0] - 2;
  while (isSpace(text.charCodeAt(at))) at--;
  at--;
  while (isSpace(text.charCodeAt(at))) at--;
  const name = at - attr.name.length + 1;
  let from = name;
  while (isSpace(text.charCodeAt(from - 1))) from--;
  return { from, name, to: attr.raw[1] + 1 };
}

/// `value` fra virgolette `quote`.
function escapeIn(value: string, quote: string): string {
  const escaped = escapeAttribute(value);
  return quote === '"' ? escaped : escaped.replace(/&quot;/g, '"').replace(/'/g, "&apos;");
}

/// Le modifiche che tolgono le frasi `drop` dal foglio `sheet`: una frase
/// che sta da sola sulle sue righe se ne va con le righe.
function withoutStatements(sheet: SheetOf, drop: readonly Statement[]): Edit[] {
  const css = sheet.css;
  const raw = sheet.raw!;
  const edits: Edit[] = [];
  for (const statement of drop) {
    let from = statement.start;
    let to = statement.end;
    let lineStart = from;
    while (lineStart > 0 && (css[lineStart - 1] === " " || css[lineStart - 1] === "\t")) lineStart--;
    let lineEnd = to;
    while (lineEnd < css.length && (css[lineEnd] === " " || css[lineEnd] === "\t")) lineEnd++;
    if ((lineStart === 0 || css[lineStart - 1] === "\n") && (lineEnd === css.length || css[lineEnd] === "\n")) {
      from = lineStart;
      to = lineEnd < css.length ? lineEnd + 1 : lineEnd;
    } else to = lineEnd;
    edits.push([raw[from]!, raw[to]!, ""]);
  }
  return edits;
}

// ---------------------------------------------------------------------------
// Il perché.
// ---------------------------------------------------------------------------

/// Perché `element`, una parte di dopo in `place`, è estranea: il primo
/// attributo o figlio che il formato non ammette, come lo giudica il
/// classificatore.
function explain(doc: XmlDocument, element: ElementNode, place: "root" | "defs" | "inside", resolve: Resolve): Reason {
  const tag = tagOf(element);
  if (tag === null) return { kind: "element", tag: element.name };
  if (tag === "use") return { kind: "use" };
  if (tag === "tspan" || tag === "textPath" || tag === "view" || tag === "defs" || tag === "symbol") return { kind: "place", tag };
  if (RESOURCES.has(tag)) return place === "defs" ? { kind: "unknown" } : { kind: "place", tag };
  if (place === "defs" && tag !== "title" && tag !== "desc" && tag !== "path" && tag !== "text" && tag !== "polyline") return { kind: "place", tag };
  for (const attr of element.attrs) {
    if (attr.ns === NS_SVG) return { kind: "attribute", name: attr.name };
    if (attr.ns === NS_XLINK) {
      if (attr.local === "href" && (tag === "a" || tag === "image") && svgAttribute(tag, "href", attr.value)) continue;
      return { kind: "attribute", name: attr.name };
    }
    if (attr.ns !== NS_NONE) continue;
    const local = attr.local;
    const url = /url\(/i.test(attr.value);
    if ((REFERENCES.has(local) || !url) && svgAttribute(tag, local, attr.value, resolve)) continue;
    const id = REFERENCES.has(local) ? referenceIn(attr.value) : null;
    if (id !== null && resolve(id) === null) return { kind: "resource", id };
    return PRESENTATION.has(local) ? { kind: "property", name: local, value: attr.value } : { kind: "attribute", name: local };
  }
  if (tag === "title" || tag === "desc") return { kind: "child", tag: firstChildName(doc, element) };
  if (CONTAINERS.has(tag)) return { kind: "unknown" };
  for (const child of element.children) {
    const node = doc.nodes[child]!;
    if (node.kind === "text" && node.blank) continue;
    if (node.kind === "text" || node.kind === "cdata" || node.kind === "entity-ref") return tag === "text" ? { kind: "text" } : { kind: "child", tag: "#text" };
    if (node.kind !== "element") return { kind: "child", tag: node.kind === "comment" ? "#comment" : `#${node.kind}` };
    const inner = tagOf(node);
    if (tag === "text" && (inner === "tspan" || inner === "textPath")) return { kind: "text" };
    if (inner === "title" || inner === "desc") {
      if (characterDataOf(doc, node) === null && node.children.length > 0) return { kind: "child", tag: node.name };
      continue;
    }
    return { kind: "child", tag: node.name };
  }
  return tag === "text" ? { kind: "text" } : { kind: "unknown" };
}

/// Il nome del primo figlio di `element` che non è testo.
function firstChildName(doc: XmlDocument, element: ElementNode): string {
  for (const child of element.children) {
    const node = doc.nodes[child]!;
    if (node.kind === "element") return node.name;
    if (node.kind !== "text") return node.kind === "comment" ? "#comment" : `#${node.kind}`;
  }
  return "#text";
}

/// L'id di un `url(#id)` dentro `value`, anche col colore di riserva.
function referenceIn(value: string): string | null {
  const match = /url\(\s*(["']?)#([^"')]+)\1\s*\)/i.exec(value);
  return match === null ? null : match[2]!.trim();
}

/// Il perché di una differenza.
function reasonOf(found: Difference): Reason {
  if (found.doubt !== null) return found.doubt.kind === "condition" ? { kind: "condition", text: found.doubt.text } : { kind: "selector", text: found.doubt.text };
  return { kind: "property", name: found.property, value: found.value.split("|")[0]! };
}

/// Vero se una dichiarazione di `rule` può cambiare come si vede `node`: una
/// proprietà che vi si disegna, o che eredita chi sta dentro. Senza
/// `custom`, le proprietà personalizzate (`--nome`) non contano: da sole non
/// disegnano niente.
function relevant(rule: Rule, node: El, custom = true): boolean {
  return rule.declarations.some((declaration) => (custom || !declaration.property.startsWith("--")) && longhands(declaration.property).some((p) => renders(node, p) || (inherits(p) && node.children.length > 0)));
}

/// I nomi delle proprietà personalizzate che `text` usa con `var()`.
function variablesIn(text: string, into: Set<string>): void {
  for (const match of text.matchAll(/var\(\s*(--[^\s,)]+)/g)) into.add(match[1]!);
}

/// Le operazioni di `op`, coi `batch` sciolti.
function flatten(op: Op): Op[] {
  return op.op === "batch" ? op.ops.flatMap(flatten) : [op];
}

// ---------------------------------------------------------------------------
// Il piano.
// ---------------------------------------------------------------------------

/// Un tentativo che non è andato: ciò che si toglie per il prossimo.
class Retry {
  constructor(
    readonly excluded: ReadonlyMap<El, Reason>,
    readonly keepSheets: boolean,
  ) {}
}

/// Ciò che produce un tentativo riuscito.
interface Outcome {
  readonly ops: Op[];
  readonly after: string;
  readonly converted: number;
  readonly translations: ReadonlyMap<Translation, ReadonlySet<El>>;
  readonly rules: number;
  readonly sheets: number;
  /// Le unità che se ne vanno.
  readonly dropped: ReadonlySet<El>;
  /// Ogni elemento di prima nell'albero di dopo.
  readonly yOf: ReadonlyMap<El, El>;
}

/// Il piano di «Rendi modificabile» per il documento `text` su `scope`.
export function planEditable(text: string, scope: EditableScope): EditablePlan {
  return new Planner(text, scope).plan();
}

const EMPTY: EditablePlan = { ops: [], converted: 0, translations: new Map(), leftovers: [], rules: 0, sheets: 0, invisible: 0, after: null };

class Planner {
  private serials = 0;
  readonly serial = (): number => this.serials++;
  readonly doc: XmlDocument;
  private readonly engine: SceneEngine;
  root!: El;
  /// Gli elementi di prima in ordine di documento, e il loro posto.
  private all: El[] = [];
  private order = new Map<El, number>();
  private sheets: SheetOf[] = [];
  private sheetB!: Sheet;
  B!: Cascade;
  inlineB = new Set<string>();
  /// Le proprietà da confrontare oltre a quelle che il confronto guarda
  /// sempre: quelle dichiarate e i nomi degli attributi.
  props = new Set<string>();
  resolve: Resolve = () => null;
  viewport: readonly [number, number] | null = null;
  private readonly matcher = new Matcher();
  /// Le unità su cui si lavora, e quelle estranee che non si vedono.
  private candidates: El[] = [];
  private invisibleUnits: El[] = [];
  /// Ciò che si è escluso, col perché: unità o pezzi di un gruppo.
  private readonly excluded = new Map<El, Reason>();
  private readonly facts = new Map<El, ShapeFacts>();

  constructor(
    readonly text: string,
    private readonly scope: EditableScope,
  ) {
    this.doc = parseXml(new SourceText(text), false);
    this.engine = SceneEngine.open(text);
  }

  plan(): EditablePlan {
    const model = this.engine.model;
    if (model === null) return EMPTY;
    this.root = treeOf(this.doc, this.serial);
    if (!annotate(this.root, model)) return EMPTY;
    this.all = walk(this.root);
    this.order = new Map(this.all.map((node, at) => [node, at]));
    const read = readAllSheets(this.doc, this.root);
    this.sheets = read.sheets;
    this.sheetB = read.sheet;
    this.inlineB = inlineSet(this.root);
    this.B = new Cascade(this.sheetB, this.root, (node) => `t${(node as El).serial}`, this.inlineB);
    this.props = new Set([...this.B.declared, ...attributeNames(this.root)]);
    const index = resourceIndex(this.doc);
    this.resolve = (id) => index.get(id) ?? null;
    this.viewport = viewportOf(this.root);
    this.collect();
    if (this.candidates.length === 0 && (this.scope.kind !== "all" || this.sheets.length === 0)) return { ...EMPTY, invisible: this.invisibleUnits.length };

    let keepSheets = false;
    let outcome: Outcome | null = null;
    for (let round = 0; round < MAX_ROUNDS && outcome === null; round++) {
      const tried = this.attempt(keepSheets);
      if (!(tried instanceof Retry)) {
        outcome = tried;
        break;
      }
      let progress = tried.keepSheets && !keepSheets;
      keepSheets ||= tried.keepSheets;
      for (const [node, reason] of tried.excluded) {
        if (this.excluded.has(node)) continue;
        this.excluded.set(node, reason);
        progress = true;
      }
      if (!progress) break;
    }
    if (outcome === null) {
      for (const unit of this.candidates) if (!this.excluded.has(unit)) this.excluded.set(unit, { kind: "unknown" });
      return { ...EMPTY, leftovers: this.leftovers(null), invisible: this.invisibleUnits.length };
    }
    const invisible = this.invisibleUnits.filter((unit) => ![...outcome!.dropped].some((gone) => within(unit, gone))).length;
    if (outcome.ops.length === 0) return { ...EMPTY, leftovers: this.leftovers(outcome), invisible };
    const translations = new Map<Translation, number>();
    for (const [kind, set] of outcome.translations) if (set.size > 0) translations.set(kind, set.size);
    return {
      ops: outcome.ops,
      converted: outcome.converted,
      translations,
      leftovers: this.leftovers(outcome),
      rules: outcome.rules,
      sheets: outcome.sheets,
      invisible,
      after: outcome.after,
    };
  }

  /// Le unità su cui lavorare, quelle che non si vedono, e quelle escluse
  /// prima di cominciare.
  private collect(): void {
    const units = this.all.filter((node) => node.unit === node && node.foreign);
    let chosen: El[];
    if (this.scope.kind === "all") chosen = units;
    else {
      const set = new Set<El>();
      for (const path of this.scope.paths) {
        let at: El | undefined = this.root;
        for (const index of path) at = at?.children[index];
        if (at === undefined) continue;
        if (at.unit !== null && at.unit.foreign) set.add(at.unit);
        // Un contenitore scelto porta le unità estranee che contiene.
        else if (at.unit === null) for (const inner of walk(at)) if (inner.unit === inner && inner.foreign) set.add(inner);
      }
      chosen = units.filter((unit) => set.has(unit));
    }
    // Gli id che un `use` mostra altrove.
    const shown = new Set<string>();
    for (const node of this.all) {
      if (!node.is("use")) continue;
      const href = node.attr("href") ?? node.attrs.find((attr) => attr.local === "href" && attr.uri !== "")?.value ?? null;
      if (href !== null && href.trim().startsWith("#")) shown.add(href.trim().slice(1));
    }
    // Un foglio importato, o un foglio con una condizione, non si legge.
    const imported = this.sheetB.imports.some((url) => !FONT_SERVICES.test(url))
      || this.doc.top.some((id) => {
        const node = this.doc.nodes[id]!;
        return node.kind === "pi" && this.text.startsWith("<?xml-stylesheet", node.start);
      });
    const conditioned = this.sheets.find((sheet) => {
      const media = sheet.el.attr("media")?.trim().toLowerCase() ?? "";
      return media !== "" && media !== "all";
    });
    for (const unit of chosen) {
      if (invisible(unit)) {
        this.invisibleUnits.push(unit);
        continue;
      }
      this.candidates.push(unit);
      if (imported) this.excluded.set(unit, { kind: "import" });
      else if (conditioned !== undefined) this.excluded.set(unit, { kind: "condition", text: `media="${conditioned.el.attr("media")!.trim()}"` });
      else if (this.lockedAbove(unit)) this.excluded.set(unit, { kind: "locked" });
      else if (walk(unit).some((node) => node.attr("id") !== null && shown.has(node.attr("id")!))) this.excluded.set(unit, { kind: "copy" });
    }
  }

  /// Vero se `unit` sta in un contenitore bloccato.
  private lockedAbove(unit: El): boolean {
    for (let at = unit.parent; at !== null; at = at.parent) {
      const part = at.part;
      if (part !== null && part.kind === "container" && part.details?.locked === true) return true;
    }
    return false;
  }

  /// Il pezzo che resta estraneo quando `node`, in un'unità che diventa
  /// modificabile, non può: l'elemento più in alto sopra di lui, o lui, che
  /// sta direttamente in un gruppo dell'unità; altrimenti l'unità.
  subunit(node: El): El {
    const unit = node.unit!;
    let at = node;
    while (at !== unit && !(at.parent !== null && CONTAINERS.has(at.parent.local) && at.parent.uri === SVG_NS)) at = at.parent!;
    // Un pezzo sta in un gruppo che a sua volta diventa modificabile.
    for (let up = at.parent; up !== null && up !== unit.parent; up = up.parent) if (!CONTAINERS.has(up.local) || up.uri !== SVG_NS) return unit;
    return at;
  }

  /// Il tipo della risorsa modificabile `id`, contando anche le risorse
  /// della `defs` della radice che il comando sta rendendo modificabili: se
  /// poi una non lo diventa, la prova sul testo di dopo lo dice.
  readonly hopeful: Resolve = (id) => {
    const known = this.resolve(id);
    if (known !== null) return known;
    const unit = this.candidates.find((each) => each.attr("id") === id && !this.excluded.has(each));
    return unit !== undefined && unit.parent?.is("defs") === true && unit.parent.parent === this.root ? resourceKind(unit.local) : null;
  };

  /// Vero se `node` è escluso, lui o un antenato nella sua unità.
  isExcluded(node: El): boolean {
    for (let at: El | null = node; at !== null; at = at === node.unit ? null : at.parent) if (this.excluded.has(at)) return true;
    return false;
  }

  /// I fatti della forma di `node`, per il confronto.
  shape(node: El): ShapeFacts {
    let out = this.facts.get(node);
    if (out === undefined) {
      const texts: string[] = [];
      if ((node.local === "text" || node.local === "tspan") && node.element !== null) {
        const stack = [...node.element.children].reverse();
        while (stack.length > 0) {
          const inner = this.doc.nodes[stack.pop()!]!;
          if (inner.kind === "text" || inner.kind === "cdata") texts.push(inner.value);
          else if (inner.kind === "element") stack.push(...[...inner.children].reverse());
        }
      }
      const wraps = ["inline-size", "shape-inside"].some((p) => {
        const value = this.B.value(node, p);
        return value.doubt !== null || !["initial", "auto", "none", "0", "0px"].includes(value.key);
      });
      out = {
        ...shapeFacts(node.local, (name) => node.attr(name)),
        ambiguousSpace: node.local === "text" || node.local === "tspan" ? ambiguousSpace(texts) : null,
        wraps,
        viewport: this.viewport,
      };
      this.facts.set(node, out);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Un tentativo.
  // -------------------------------------------------------------------------

  private attempt(keepSheets: boolean): Outcome | Retry {
    const units = this.candidates.filter((unit) => !this.excluded.has(unit));
    // L'albero di dopo, e come lo vede la superficie.
    const [X, xOf] = cloneTree(this.root, this.serial, (node) => node);
    const [live, liveOf] = liveTree(X, this.serial, (node) => node.origin);
    const L = new Cascade(NO_SHEET, live, (node) => identity(node as El), this.inlineB);
    const writer = new Writer(this, xOf, liveOf, L);
    const failed = new Map<El, Reason>();
    for (const unit of units) writer.unit(unit, failed);
    if (failed.size > 0) return new Retry(failed, false);
    writer.addTitles();
    const converted = writer.converted;
    const convertedSet = new Set(converted);
    const elements = new Set(writer.elements);

    // Le regole che dopo non servono più: scelgono soltanto ciò che diventa
    // modificabile, che ha già i suoi valori scritti, o niente che disegni.
    // Una regola che non sceglie niente se ne va solo dal disegno intero.
    const xAll = walk(X);
    const drop = new Map<SheetOf, Statement[]>();
    if (!keepSheets) {
      const useless = (rule: Rule): boolean => {
        let mine = false;
        for (const node of xAll) {
          const selects = this.matcher.selects(rule.selector, node);
          if (selects === false) continue;
          if (selects === null) return false;
          if (node.origin !== null && elements.has(node.origin)) mine = true;
          else if (relevant(rule, node, false)) return false;
        }
        // Una regola che sceglieva ciò che ora è modificabile è sua.
        return mine || this.scope.kind === "all" || writer.elements.some((node) => this.matcher.selects(rule.selector, node) !== false);
      };
      for (const sheet of this.sheets) {
        if (sheet.statements === null || !this.sheetEditable(sheet, convertedSet)) continue;
        const dead = sheet.statements.filter((statement) => !statement.at && statement.rules.every(useless));
        if (dead.length === 0) continue;
        // Senza il testo da riscrivere, il foglio se ne va tutto o resta.
        if (sheet.raw === null && !(dead.length === sheet.statements.length && blankCss(removeRanges(sheet.css, dead)))) continue;
        drop.set(sheet, dead);
      }
      // Una proprietà personalizzata resta finché un valore che resta la usa:
      // una regola che la dichiara torna nel suo foglio.
      const used = new Set<string>();
      for (const node of xAll) variablesIn(node.attr("style") ?? "", used);
      for (const sheet of this.sheets) {
        const dead = drop.get(sheet) ?? [];
        for (const statement of sheet.statements ?? []) {
          if (dead.includes(statement)) continue;
          for (const rule of statement.rules) for (const declaration of rule.declarations) variablesIn(declaration.value, used);
        }
      }
      for (let changed = true; changed; ) {
        changed = false;
        for (const [sheet, dead] of drop) {
          const back = dead.filter((statement) => statement.rules.some((rule) => rule.declarations.some((declaration) => used.has(declaration.property))));
          if (back.length === 0) continue;
          changed = true;
          for (const statement of back) for (const rule of statement.rules) for (const declaration of rule.declarations) variablesIn(declaration.value, used);
          const rest = dead.filter((statement) => !back.includes(statement));
          if (rest.length === 0 || (sheet.raw === null && !(rest.length === sheet.statements!.length && blankCss(removeRanges(sheet.css, rest))))) drop.delete(sheet);
          else drop.set(sheet, rest);
        }
      }
    }
    const droppedRules = new Set<Rule>();
    for (const statements of drop.values()) for (const statement of statements) for (const rule of statement.rules) droppedRules.add(rule);
    const rulesA = this.sheetB.rules.filter((rule) => !droppedRules.has(rule));

    // Una regola che resta non sceglie niente di ciò che diventa modificabile.
    const shared = new Map<El, Reason>();
    for (const rule of rulesA) {
      for (const node of writer.elements) {
        const piece = this.subunit(node);
        if (shared.has(piece)) continue;
        const x = xOf.get(node)!;
        const selects = this.matcher.selects(rule.selector, x);
        if (selects === false || !relevant(rule, x)) continue;
        shared.set(piece, selects === null ? { kind: "selector", text: rule.text } : { kind: "shared", text: rule.text });
      }
    }
    if (shared.size > 0) return new Retry(shared, false);

    // Le modifiche delle unità, e le unità che se ne vanno.
    const edits = new Map<El, Edit[]>();
    const editsOf = (unit: El): Edit[] => {
      let list = edits.get(unit);
      if (list === undefined) edits.set(unit, (list = []));
      return list;
    };
    for (const unit of converted) editsOf(unit).push(...writer.edits(unit));
    const dropped = new Set<El>();
    /// Gli elementi che se ne vanno da dentro un'unità che resta.
    const removedInside = new Set<El>();
    let sheetsDropped = 0;
    for (const [sheet, statements] of drop) {
      const el = sheet.el;
      const holder = el.unit!;
      const empty = statements.length === sheet.statements!.length && blankCss(removeRanges(sheet.css, statements));
      if (!empty) {
        editsOf(holder).push(...withoutStatements(sheet, statements));
        continue;
      }
      sheetsDropped++;
      if (holder === el) {
        dropped.add(el);
        continue;
      }
      // L'unità che conteneva soltanto il foglio se ne va con lui.
      const alone = holder.element!.children.every((child) => {
        const node = this.doc.nodes[child]!;
        return node === el.element || (node.kind === "text" && node.blank);
      });
      if (alone && !convertedSet.has(holder)) {
        dropped.add(holder);
        continue;
      }
      const element = el.element!;
      let from = element.start;
      while (isSpace(this.text.charCodeAt(from - 1)) && from > holder.element!.openEnd) from--;
      editsOf(holder).push([from, element.end, ""]);
      removedInside.add(el);
    }
    // Una `defs` della radice che resta vuota se ne va, se nessuno la cita.
    for (const defs of this.root.children) {
      if (!defs.is("defs") || defs.part?.kind !== "container" || defs.children.length === 0) continue;
      if (!defs.children.every((child) => dropped.has(child))) continue;
      const other = defs.element!.children.some((child) => {
        const node = this.doc.nodes[child]!;
        return node.kind !== "element" && !(node.kind === "text" && node.blank);
      });
      const id = defs.attr("id");
      if (other || (id !== null && this.all.some((node) => node.attrs.some((attr) => attr.value.includes(`#${id}`))))) continue;
      for (const child of defs.children) dropped.delete(child);
      dropped.add(defs);
    }
    if (edits.size === 0 && dropped.size === 0) {
      return { ops: [], after: this.text, converted: 0, translations: new Map(), rules: 0, sheets: 0, dropped, yOf: new Map() };
    }

    // Le operazioni: le unità riscritte si tolgono dall'ultima e si rimettono
    // nuove dalla prima, ognuna nel punto esatto da cui è partita; poi se ne
    // vanno quelle da togliere, dall'ultima.
    const rewritten = [...edits.keys()].sort((a, b) => this.order.get(a)! - this.order.get(b)!);
    const raws: string[] = [];
    for (const unit of rewritten) {
      const element = unit.element!;
      const part = unit.part!;
      if (part.kind !== "leaf" || this.text.slice(element.start, element.end) !== part.raw) return this.internal(unit);
      const raw = applyEdits(this.text, element.start, element.end, edits.get(unit)!);
      if (raw === null) return this.internal(unit);
      raws.push(raw);
    }
    const adopt: Op[] = this.engine.status === "foreign" ? [{ op: "adopt" }] : [];
    // Un elemento con l'id si toglie per id, uno senza per percorso.
    const target = (node: El): Op => ({ op: "remove", target: node.part!.facts.id ?? { path: pathOf(node), tag: tagName(node.part!) } });
    const removes = [...rewritten].reverse().map(target);
    const restores: RestoreOp[] = [];
    if (rewritten.length > 0) {
      const probe = SceneEngine.open(this.text).apply({ op: "batch", ops: [...adopt, ...removes] });
      if (probe.outcome !== "applied") return this.internal(rewritten[rewritten.length - 1 - Math.max(0, (probe.index ?? adopt.length) - adopt.length)] ?? rewritten[0]!);
      const inverse = flatten(probe.inverse).filter((op): op is RestoreOp => op.op === "add" && "slot" in op);
      const own = inverse.slice(inverse.length - rewritten.length);
      if (own.length !== rewritten.length) return this.internal(rewritten[0]!);
      for (const [at, op] of own.entries()) {
        const part = rewritten[at]!.part!;
        if (part.kind !== "leaf" || op.raw !== part.raw) return this.internal(rewritten[at]!);
        restores.push({ ...op, raw: raws[at]! });
      }
    }
    const tops = [...dropped].filter((node) => ![...dropped].some((other) => other !== node && within(node, other)));
    tops.sort((a, b) => this.order.get(b)! - this.order.get(a)!);
    const ops: Op[] = [...adopt, ...removes, ...restores, ...tops.map(target)];
    const engine = SceneEngine.open(this.text);
    const applied = engine.apply({ op: "batch", ops });
    if (applied.outcome !== "applied") {
      const index = (applied.index ?? adopt.length) - adopt.length;
      const n = rewritten.length;
      const unit = index < 0 ? rewritten[0] : index < n ? rewritten[n - 1 - index] : index < 2 * n ? rewritten[index - n] : undefined;
      return unit === undefined ? new Retry(new Map(), true) : this.internal(unit);
    }
    const after = applied.text;

    // Il documento di dopo, letto da capo e affiancato a quello previsto.
    const yDoc = parseXml(new SourceText(after), false);
    const Y = treeOf(yDoc, this.serial);
    if (engine.model === null || !annotate(Y, engine.model)) return this.internal(rewritten[0] ?? units[0]!);
    const yOf = new Map<El, El>();
    const tOf = new Map<El, El | null>();
    const gone = new Set<El>();
    for (const node of [...dropped, ...removedInside]) for (const inner of walk(node)) gone.add(xOf.get(inner)!);
    const stack: Array<[El, El]> = [[X, Y]];
    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      if (x.local !== y.local || x.uri !== y.uri) return this.internal(rewritten[0] ?? units[0]!);
      tOf.set(y, x.origin);
      if (x.origin !== null) yOf.set(x.origin, y);
      const xs = x.children.filter((child) => !gone.has(child));
      if (xs.length !== y.children.length) return this.internal(rewritten[0] ?? units[0]!);
      xs.forEach((child, at) => stack.push([child, y.children[at]!]));
    }

    // Ciò che è diventato modificabile lo è davvero.
    const yIndex = resourceIndex(yDoc);
    const yResolve: Resolve = (id) => yIndex.get(id) ?? null;
    const unclassified = new Map<El, Reason>();
    for (const node of writer.elements) {
      const y = yOf.get(node)!;
      if (!y.foreign || y.unit !== y) continue;
      const parent = y.parent!;
      const place = parent.parent === null ? "root" : parent.is("defs") && parent.parent.parent === null ? "defs" : "inside";
      unclassified.set(this.subunit(node), explain(yDoc, y.element!, place, yResolve));
    }
    if (unclassified.size > 0) return new Retry(unclassified, false);

    // Lo stile di dopo è quello di prima: coi fogli che restano per tutti, e
    // senza per ciò che è diventato modificabile.
    const yStyles = walk(Y).filter((node) => node.sheet !== null);
    const reread = readSheets(yStyles.map((node) => ({ id: this.sheets.find((sheet) => sheet.el === tOf.get(node))?.id ?? "?", css: node.sheet! })));
    if (!sameRules(reread.rules, rulesA)) return keepSheets ? this.internal(rewritten[0] ?? units[0]!) : new Retry(new Map(), true);
    const sheetA: Sheet = { rules: rulesA, selectors: rulesA.map((rule) => rule.selector), deep: this.sheetB.deep, imports: this.sheetB.imports };
    const yIdentity = (node: El): string => {
      const origin = tOf.get(node);
      return origin === null || origin === undefined ? `n${node.serial}` : `t${origin.serial}`;
    };
    const inlineY = inlineSet(Y);
    const A = new Cascade(sheetA, Y, (node) => yIdentity(node as El), inlineY);
    const [yLive, yLiveOf] = liveTree(Y, this.serial, (node) => node);
    const L2 = new Cascade(NO_SHEET, yLive, (node) => yIdentity((node as El).origin!), inlineY);
    const props = new Set([...this.props, ...attributeNames(Y)]);
    const mismatched = new Map<El, Reason>();
    for (const node of writer.elements) {
      const piece = this.subunit(node);
      if (mismatched.has(piece)) continue;
      const y = yOf.get(node)!;
      const facts = (): ShapeFacts => this.shape(node);
      const found = difference({ cascade: this.B, node }, { cascade: A, node: y }, props, facts)
        ?? difference({ cascade: this.B, node }, { cascade: L2, node: yLiveOf.get(y)! }, props, facts);
      if (found !== null) mismatched.set(piece, reasonOf(found));
    }
    if (mismatched.size > 0) return new Retry(mismatched, false);
    // Un foglio sceglie anche per posizione e per ciò che sta attorno: ciò
    // che resta com'era deve vedersi com'era.
    if (this.sheetB.rules.length > 0) {
      const related = new Map<El, Reason>();
      for (const node of this.all) {
        if (elements.has(node)) continue;
        const y = yOf.get(node);
        if (y === undefined) continue;
        if (difference({ cascade: this.B, node }, { cascade: A, node: y }, props, () => this.shape(node)) === null) continue;
        if (!keepSheets && droppedRules.size > 0) return new Retry(new Map(), true);
        for (const near of this.neighbours(node, writer)) related.set(near, { kind: "structure" });
      }
      if (related.size > 0) return new Retry(related, false);
    }

    let rules = 0;
    for (const statements of drop.values()) rules += statements.reduce((sum, statement) => sum + statement.rules.length, 0);
    return { ops, after, converted: converted.length, translations: writer.translations, rules, sheets: sheetsDropped, dropped, yOf };
  }

  /// Vero se il comando può riscrivere il foglio `sheet`: sta da solo nella
  /// sua unità, o in una che non si vede, o in una che diventa modificabile.
  /// Un'unità estranea che si vede e resta, resta byte per byte.
  private sheetEditable(sheet: SheetOf, converted: ReadonlySet<El>): boolean {
    const holder = sheet.el.unit;
    return holder !== null && (holder === sheet.el || invisible(holder) || converted.has(holder));
  }

  /// I pezzi resi modificabili che un foglio può guardare per scegliere
  /// `node`: i suoi antenati, ciò che contiene, i suoi fratelli e quelli dei
  /// suoi antenati, con ciò che contengono.
  private neighbours(node: El, writer: Writer): El[] {
    const pieces = new Set(writer.elements.map((each) => this.subunit(each)));
    const out = new Set<El>();
    const consider = (each: El): void => {
      for (const inner of walk(each)) if (pieces.has(inner)) out.add(inner);
    };
    for (let at: El | null = node; at !== null; at = at.parent) {
      if (pieces.has(at)) out.add(at);
      for (const sibling of at.parent?.children ?? []) if (sibling !== at) consider(sibling);
    }
    consider(node);
    // Un selettore che guarda lontano, come `:has()`: tutto ciò che cambia.
    if (out.size === 0) for (const piece of pieces) out.add(piece);
    return [...out];
  }

  /// Un tentativo finito male per un motivo che non dipende dal disegno:
  /// l'unità resta estranea, e si riprova senza.
  private internal(unit: El): Retry {
    return new Retry(new Map([[unit.unit ?? unit, { kind: "unknown" }]]), false);
  }

  /// Ciò che resta estraneo, col perché, dove sta dopo: i pezzi dentro una
  /// parte che resta tutta non si ripetono.
  private leftovers(outcome: Outcome | null): Leftover[] {
    const out: Leftover[] = [];
    const sorted = [...this.excluded].sort((a, b) => this.order.get(a[0])! - this.order.get(b[0])!);
    for (const [node, reason] of sorted) {
      if (sorted.some(([other]) => other !== node && within(node, other))) continue;
      const y = outcome?.yOf.get(node);
      out.push({ path: pathOf(y ?? node), tag: node.uri === SVG_NS ? node.local : node.name, name: nameOf(this.doc, node), reason });
    }
    return out;
  }
}

/// Chi è un elemento dell'albero della superficie: lo stesso di prima.
function identity(node: El): string {
  return node.origin === null ? `n${node.serial}` : `t${node.origin.serial}`;
}

// ---------------------------------------------------------------------------
// La riscrittura.
// ---------------------------------------------------------------------------

/// Riscrive le unità sull'albero di dopo: toglie ciò che non serve e scrive
/// ciò che manca perché lo stile senza fogli sia quello di prima.
class Writer {
  /// Le unità riscritte.
  readonly converted: El[] = [];
  /// Gli elementi di prima resi modificabili, in ordine di documento.
  readonly elements: El[] = [];
  readonly translations = new Map<Translation, Set<El>>([["style", new Set()], ["sheet", new Set()], ["color", new Set()], ["unit", new Set()], ["data", new Set()]]);
  /// Il titolo nuovo di un elemento.
  private readonly titles = new Map<El, string>();
  private readonly B: Cascade;

  constructor(
    private readonly planner: Planner,
    private readonly xOf: ReadonlyMap<El, El>,
    private readonly liveOf: ReadonlyMap<El, El>,
    private readonly L: Cascade,
  ) {
    this.B = planner.B;
  }

  private count(kind: Translation, node: El): void {
    this.translations.get(kind)!.add(node);
  }

  /// Scrive `value` per `name` su `node`, nell'albero di dopo e in quello
  /// della superficie.
  private write(node: El, name: string, value: string | null): void {
    const x = this.xOf.get(node)!;
    const live = this.liveOf.get(x)!;
    x.set(name, value);
    live.set(name, value);
    this.L.forget(live);
  }

  /// Riscrive `unit`; ciò che non si sa riscrivere va in `failed`.
  unit(unit: El, failed: Map<El, Reason>): void {
    const start = failed.size;
    const elements: El[] = [];
    const stack = [unit];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node !== unit && (invisible(node) || this.planner.isExcluded(node))) continue;
      elements.push(node);
      for (let k = node.children.length - 1; k >= 0; k--) stack.push(node.children[k]!);
    }
    for (const node of elements) {
      const piece = this.planner.subunit(node);
      if (failed.has(piece)) continue;
      const reason = this.element(node);
      if (reason !== null) failed.set(piece, reason);
    }
    if (failed.size > start) return;
    this.converted.push(unit);
    this.elements.push(...elements);
  }

  /// Riscrive un elemento; il perché, se non si sa.
  private element(node: El): Reason | null {
    const tag = tagOf(node.element!);
    // Ciò che decide se l'elemento si disegna resta, e l'elemento con lui.
    for (const attr of node.attrs) {
      if (attr.uri === "" && (CONDITIONAL.has(attr.local) || /^on[a-z]/i.test(attr.local))) return { kind: "attribute", name: attr.local };
    }
    if (declares(node.attr("style"))) this.count("style", node);
    if (node.attr("class") !== null) this.count("sheet", node);
    // Ciò che non disegna niente, o che il formato non sa scrivere così, se
    // ne va: lo stile di prima si riscrive dopo, dove serve.
    let title: string | null = null;
    const titled = node.children.some((child) => child.is("title"));
    for (const attr of node.attrs) {
      if (attr.uri !== "") continue;
      const name = attr.local;
      let gone = name === "style" || name === "class" || JUNK.has(name);
      if (name.startsWith("data-") || (name.startsWith("aria-") && !(name === "aria-hidden" && node.local === "image"))) {
        gone = true;
        this.count("data", node);
        if ((name === "data-name" || name === "aria-label") && !titled && title === null && attr.value.trim() !== "") title = attr.value.trim().replace(/\s+/g, " ");
      }
      if (name === "pathLength") {
        if (dashed(this.B, node)) return { kind: "attribute", name };
        gone = true;
      }
      if (!gone && tag !== null && PRESENTATION.has(name) && !this.allowed(tag, name, attr.value, node)) gone = true;
      if (gone) this.write(node, name, null);
    }
    if (title !== null) this.titles.set(node, title);
    // La geometria in misure relative.
    for (const [name, tags] of GEOMETRY) {
      const value = node.attr(name);
      if (value === null || !tags.has(node.local) || (tag !== null && svgAttribute(tag, name, value))) continue;
      const px = this.relativeLength(node, name, value);
      if (px === null) return { kind: "unit", value };
      this.write(node, name, num(px));
      this.count("unit", node);
    }
    // Ciò che manca, finché lo stile senza fogli è quello di prima.
    const x = this.xOf.get(node)!;
    const live = this.liveOf.get(x)!;
    const facts = (): ShapeFacts => this.planner.shape(node);
    const tried = new Set<string>();
    for (;;) {
      const found = difference({ cascade: this.B, node }, { cascade: this.L, node: live }, this.planner.props, facts);
      if (found === null) break;
      if (found.doubt !== null) return reasonOf(found);
      const writes = this.valueFor(node, found.property);
      if (!(writes instanceof Map)) return writes;
      const key = `${found.property}:${[...writes].map(([name, value]) => `${name}=${value}`).join(";")}`;
      if (tried.has(key) || [...writes].every(([name, value]) => x.attr(name) === value)) return reasonOf(found);
      tried.add(key);
      for (const [name, value] of writes) this.write(node, name, value);
    }
    // Un gruppo tiene ciò che portava ai figli.
    if (CONTAINERS.has(node.local)) this.inherited(node);
    else this.intent(node);
    return null;
  }

  /// Le estremità e gli angoli di un contorno che ora non si vedono, su una
  /// forma chiusa o senza spigoli, restano come li ha scelti l'autore: si
  /// vedranno se la forma cambia.
  private intent(node: El): void {
    if (this.B.value(node, "stroke").key === "none") return;
    const live = this.liveOf.get(this.xOf.get(node)!)!;
    for (const [p, initial] of [["stroke-linecap", "butt"], ["stroke-linejoin", "miter"]] as const) {
      const value = this.B.value(node, p);
      if (!value.own || value.doubt !== null || value.key === initial || value.key === "initial") continue;
      const now = this.L.value(live, p);
      if (now.key === value.key) continue;
      const writes = this.valueFor(node, p);
      if (writes instanceof Map) for (const [name, written] of writes) this.write(node, name, written);
    }
  }

  /// Su un gruppo, le proprietà ereditate dichiarate su di lui che la
  /// superficie non vedrebbe: si scrivono lì, perché i figli le ereditino
  /// come prima e il gruppo le porti ancora.
  private inherited(node: El): void {
    const live = this.liveOf.get(this.xOf.get(node)!)!;
    for (const p of GROUP_INHERITED) {
      const value = this.B.value(node, p);
      if (!value.own || value.doubt !== null || value.key === this.L.value(live, p).key) continue;
      if (!walk(node).some((inner) => inner !== node && renders(inner, p))) continue;
      const writes = this.valueFor(node, p);
      if (writes instanceof Map) for (const [name, written] of writes) this.write(node, name, written);
    }
  }

  /// Vero se `value` per `name` vale sull'elemento `node` di tag `tag`.
  private allowed(tag: Tag, name: string, value: string, node: El): boolean {
    if (name === "clip-rule") return insideClip(node) && /^\s*(?:nonzero|evenodd)\s*$/.test(value);
    return svgAttribute(tag, name, value, this.planner.hopeful);
  }

  /// Una lunghezza di `name` su `node` in pixel; `null` se non si sa.
  private relativeLength(node: El, name: string, value: string): number | null {
    const absolute = lengthOf(name, value, this.planner.viewport);
    if (absolute !== null) return absolute;
    const match = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(em|rem)\s*$/i.exec(value);
    if (match === null) return null;
    const size = this.B.value(match[2]!.toLowerCase() === "em" ? node : this.planner.root, "font-size").number;
    return size === null ? null : Number(match[1]) * size;
  }

  /// Gli attributi che scrivono su `node` il valore di prima di `p`; il
  /// perché, se il formato non lo sa scrivere.
  private valueFor(node: El, p: string): Map<string, string | null> | Reason {
    const B = this.B;
    const value = B.value(node, p);
    const tag = tagOf(node.element!);
    const out = new Map<string, string | null>();
    const shown = (v: typeof value): string => (v.text ?? v.key).split("|")[0]!;
    const refuse = (): Reason => ({ kind: "property", name: p, value: shown(value) });
    const live = this.liveOf.get(this.xOf.get(node)!)!;
    switch (p) {
      case "fill":
      case "fill-opacity":
      case "stroke":
      case "stroke-opacity":
      case "stop-color":
      case "stop-opacity":
      case "flood-color":
      case "flood-opacity": {
        const base = p.startsWith("fill") ? "fill" : p.startsWith("stroke") ? "stroke" : p.startsWith("stop") ? "stop-color" : "flood-color";
        const alphaName = base === "fill" ? "fill-opacity" : base === "stroke" ? "stroke-opacity" : base === "stop-color" ? "stop-opacity" : "flood-opacity";
        const color = B.value(node, base);
        const alpha = B.value(node, alphaName);
        const parsed = color.text === null ? null : paintOf(color.text);
        const a = alpha.text === null ? null : readOpacity(alpha.text);
        if (parsed === null || color.doubt !== null) return { kind: "property", name: base, value: shown(color) };
        if (a === null || alpha.doubt !== null) return { kind: "property", name: alphaName, value: shown(alpha) };
        let total = a;
        if (parsed.kind === "none") {
          if (base === "stop-color" || base === "flood-color") return refuse();
          out.set(base, "none");
          break;
        }
        if (parsed.kind === "url") {
          if (this.planner.hopeful(parsed.id) === null) return { kind: "resource", id: parsed.id };
          out.set(base, `url(#${parsed.id})`);
        } else {
          // Il colore resta com'è scritto, se il formato lo sa scrivere così.
          const written = color.text!.trim();
          if (parsed.color.a === 1 && formatPaint(written) !== null) out.set(base, written);
          else {
            out.set(base, formatHex(parsed.color));
            this.count("color", node);
          }
          total = parsed.color.a * a;
        }
        // Un colore del tutto trasparente non dipinge: è `none`.
        if (total <= 0.5 / 255 && base !== "stop-color" && base !== "flood-color") {
          out.set(base, "none");
          out.set(alphaName, null);
          break;
        }
        const parent = live.parent;
        const inherited = parent === null ? 1 : readOpacity(this.L.value(parent, alphaName).text ?? "1") ?? 1;
        out.set(alphaName, Math.abs(total - 1) < 5e-5 && Math.abs(inherited - 1) < 5e-5 ? null : num(total));
        break;
      }
      case "stroke-width":
      case "font-size":
      case "x":
      case "y":
      case "width":
      case "height":
      case "cx":
      case "cy":
      case "r":
      case "rx":
      case "ry": {
        const px = lengthOf(p, value.text, this.planner.viewport);
        if (px === null) return { kind: "unit", value: shown(value) };
        if (value.text !== null && /%/.test(value.text)) this.count("unit", node);
        out.set(p, num(px));
        break;
      }
      case "letter-spacing": {
        if (value.key === "normal") out.set(p, "0");
        else {
          const px = lengthOf(p, value.text, this.planner.viewport);
          if (px === null) return { kind: "unit", value: shown(value) };
          out.set(p, num(px));
        }
        break;
      }
      case "stroke-dasharray": {
        if (value.text === null) return refuse();
        const text = value.text.trim().toLowerCase();
        if (text === "none") out.set(p, "none");
        else {
          const lengths = text.split(/[\s,]+/).filter((part) => part !== "").map((part) => lengthOf(p, part, this.planner.viewport));
          if (lengths.length === 0 || lengths.some((n) => n === null || n < 0)) return { kind: "unit", value: value.text };
          out.set(p, lengths.every((n) => n === 0) ? "none" : lengths.map((n) => num(n!)).join(" "));
        }
        break;
      }
      case "stroke-linecap":
      case "stroke-linejoin":
      case "font-style":
      case "text-anchor":
      case "text-decoration":
        out.set(p, value.key);
        break;
      case "font-weight": {
        // Il peso resta com'è scritto, se il formato lo sa scrivere così.
        const written = value.text?.trim().toLowerCase() ?? null;
        if (written !== null && tag !== null && svgAttribute(tag, p, written)) out.set(p, written);
        else if (value.number !== null && value.number % 100 === 0 && value.number >= 100 && value.number <= 900) out.set(p, String(value.number));
        else return refuse();
        break;
      }
      case "font-family":
        if (value.text === null) return refuse();
        out.set(p, value.text.trim());
        break;
      case "opacity": {
        const n = value.text === null ? null : readOpacity(value.text);
        if (n === null) return refuse();
        out.set(p, Math.abs(n - 1) < 5e-5 ? null : num(n));
        break;
      }
      case "display":
        out.set(p, value.key === "none" ? "none" : null);
        break;
      case "transform": {
        const own = B.own(node);
        if (own.m === null) return { kind: "property", name: p, value: own.text };
        const written = node.attr("transform");
        const parsed = written === null ? null : svgTransform(written);
        if (written !== null && parsed !== null && !own.css && same(parsed, own.m)) out.set(p, written);
        else out.set(p, same(own.m, [1, 0, 0, 1, 0, 0]) ? null : formatTransform(own.m));
        break;
      }
      case "clip-path":
      case "mask":
      case "filter":
      case "marker-start":
      case "marker-mid":
      case "marker-end": {
        if (value.text === null) return refuse();
        if (value.key === "none" || value.key === "initial") out.set(p, inherits(p) ? "none" : null);
        else {
          const id = reference(value.text);
          if (id === null) return refuse();
          if (this.planner.hopeful(id) === null) return { kind: "resource", id };
          out.set(p, `url(#${id})`);
        }
        break;
      }
      case "mix-blend-mode":
      case "isolation": {
        const blend = B.value(node, "mix-blend-mode");
        const isolation = B.value(node, "isolation");
        if (blend.doubt !== null || isolation.doubt !== null) return refuse();
        const parts: string[] = [];
        if (blend.key !== "normal" && blend.key !== "initial") parts.push(`mix-blend-mode:${blend.key}`);
        if (isolation.key === "isolate") parts.push("isolation:isolate");
        out.set("style", parts.length === 0 ? null : parts.join(";"));
        break;
      }
      default:
        return refuse();
    }
    // Ogni valore deve valere per il formato.
    if (tag !== null) {
      for (const [name, written] of out) {
        if (written === null || this.allowed(tag, name, written, node)) continue;
        const id = REFERENCES.has(name) ? referenceIn(written) : null;
        return id !== null ? { kind: "resource", id } : { kind: "property", name: p, value: shown(value) };
      }
    }
    return out;
  }

  /// Mette nell'albero di dopo i titoli nuovi, primi figli del loro
  /// elemento.
  addTitles(): void {
    for (const node of this.titles.keys()) {
      const x = this.xOf.get(node)!;
      const made = new El(SVG_NS, "title", "title", [], true, null, null, this.planner.serial());
      made.parent = x;
      made.unit = x.unit;
      made.foreign = x.foreign;
      x.children.unshift(made);
    }
  }

  /// Le modifiche del testo che riscrivono `unit` come l'albero di dopo.
  edits(unit: El): Edit[] {
    const text = this.planner.text;
    const inside = new Set(this.elements);
    const out: Edit[] = [];
    for (const node of walk(unit)) {
      if (!inside.has(node)) continue;
      const element = node.element!;
      const x = this.xOf.get(node)!;
      const attrs = styleAttrs(element);
      const spans = element.attrs.map((attr) => attributeSpan(text, attr));
      const spanOf = new Map(element.attrs.map((attr, at) => [attr, spans[at]!]));
      const kept: Array<OutAttr & { readonly end: number }> = [];
      for (const [k, attr] of attrs.entries()) {
        const was = node.attrs[k]!;
        const now = x.attrs.find((each) => each.uri === was.uri && each.local === was.local);
        const span = spanOf.get(attr)!;
        if (now === undefined) {
          out.push([span.from, span.to, ""]);
          continue;
        }
        if (now.value !== was.value) out.push([attr.raw[0], attr.raw[1], escapeIn(now.value, text[attr.raw[0] - 1]!)]);
        kept.push({ name: attr.name, uri: was.uri, local: was.local, text: "", end: span.to });
      }
      const added = x.attrs.filter((each) => !node.attrs.some((was) => was.uri === each.uri && was.local === each.local));
      const nameEnd = element.start + 1 + element.name.length;
      const last = spans.length === 0 ? nameEnd : spans[spans.length - 1]!.to;
      if (added.length > 0) {
        // Ogni attributo nuovo va dopo l'ultimo, nel testo, di quelli che
        // restano e che lo precedono nell'ordine canonico; quelli che restano
        // non si spostano.
        const gap = (span: { from: number; name: number }): string => text.slice(span.from, span.name);
        const separator = spans.length > 1 && gap(spans[1]!).includes("\n") ? gap(spans[1]!) : spans.length > 0 && gap(spans[0]!).includes("\n") ? gap(spans[0]!) : " ";
        const fresh = added.map((each) => ({ name: each.local, uri: "", local: each.local, text: escapeAttribute(each.value), end: -1 }));
        const inserts = new Map<number, string>();
        let point = nameEnd;
        for (const each of canonicalOrder([...kept, ...fresh]) as Array<OutAttr & { readonly end: number }>) {
          if (each.end >= 0) point = Math.max(point, each.end);
          else inserts.set(point, `${inserts.get(point) ?? ""}${separator}${each.name}="${each.text}"`);
        }
        for (const [at, inserted] of inserts) out.push([at, at, inserted]);
      }
      const title = this.titles.get(node);
      if (title !== undefined) {
        const titled = `<title>${escapeText(title)}</title>`;
        if (element.closeStart === null) {
          // `<path …/>` diventa `<path …><title>…</title></path>`.
          let slash = element.openEnd - 2;
          while (slash > last && isSpace(text.charCodeAt(slash - 1))) slash--;
          out.push([slash, element.openEnd, `>${titled}</${element.name}>`]);
        } else {
          let k = element.openEnd;
          while (k < element.closeStart && isSpace(text.charCodeAt(k))) k++;
          const lead = text.slice(element.openEnd, k);
          out.push([element.openEnd, element.openEnd, `${lead.includes("\n") ? lead : ""}${titled}`]);
        }
      }
    }
    return out;
  }
}

/// Vero se `node` sta in un `clipPath`, dove conta `clip-rule`.
function insideClip(node: El): boolean {
  for (let at = node.parent; at !== null; at = at.parent) if (at.is("clipPath")) return true;
  return false;
}

/// Vero se `node` ha un tratteggio che si vede: `pathLength` lo scala.
function dashed(B: Cascade, node: El): boolean {
  const stroke = B.value(node, "stroke");
  const dashes = B.value(node, "stroke-dasharray");
  return stroke.key !== "none" && dashes.key !== "none" && dashes.key !== "initial";
}
