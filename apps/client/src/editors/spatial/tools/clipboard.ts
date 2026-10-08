// Gli appunti, a ogni livello: la selezione come documento SVG, e un SVG
// incollato come elementi del disegno.
//
// - **Copiare** scrive un SVG completo, che si apre anche da solo: la radice
//   dichiara i namespace del disegno e `fub:version`, ha un `viewBox` attorno
//   a ciò che si vede della selezione, e `width` e `height` nell'unità del
//   disegno. Ogni elemento porta il suo testo; chi stava in un contenitore
//   trasformato, o che gli dava uno stile, prende su di sé la trasformazione
//   e lo stile che ereditava, come quando esce da un contenitore
//   (`place.ts`). Ciò a cui rimanda e che resta fuori, una sfumatura o la
//   forma di un `use`, anche per un colore ereditato, va in un `defs`, e
//   così i fogli di stile del disegno se un blocco estraneo può usarli.
// - **Incollare** è un `batch` solo, un passo di annulla. Un SVG di FubDraw
//   rientra com'era, elemento per elemento, nel livello che riceve; un
//   livello diventa un gruppo, col suo nome per titolo. Un SVG di un altro
//   programma entra in un gruppo nuovo, alla sua misura: ciò che il formato
//   ammette resta modificabile, il resto entra in blocchi estranei, che non
//   eseguono niente. Fra disegni con unità diverse la misura vera resta.
// - **Le risorse** dei `defs` della radice che ciò che entra usa vanno nella
//   `defs` del disegno, prima di chi le usa (`resources.ts`): una privata
//   come copia, una condivisa o che non è di FubDraw resta quella del
//   disegno se è la stessa, con lo stesso id. Un campione resta quello del
//   disegno con lo stesso id, o diventa quello con lo stesso nome e lo
//   stesso colore, e chi lo usa ne prende il colore di adesso come
//   ripiego; se arriva con un nome già preso, prende il primo libero
//   (`swatches.ts`). Una punta delle linee (`tips.ts`) uguale a una del
//   disegno, a parte l'id, è quella del disegno: una linea con le punte
//   rientra con le sue, senza marcatori doppi, anche da un altro disegno.
//   Ciò che nessuno usa resta fuori. Con un foglio di stile, che può
//   rimandarvi, restano dove sono.
// - **Id nuovi.** Ogni id cambia, e i riferimenti interni lo seguono:
//   `url(#…)`, `href`, gli attributi ARIA, l'inizio e la fine delle
//   animazioni, i selettori dei fogli di stile. Un foglio di un altro
//   programma vale solo dentro il suo gruppo (`stylesheet.ts`).
// - **I connettori e le etichette.** Un capo agganciato a un oggetto
//   incollato nomina il suo id nuovo, e così un'etichetta il suo connettore o
//   la sua forma; un capo agganciato a ciò che non entra, e un'etichetta
//   senza il suo connettore o la sua forma, perdono `fub:from`, `fub:to`,
//   `fub:along` o `fub:inside`, e restano un capo libero e un testo qualunque
//   (`connector-copies.ts`). Un valore fuori grammatica resta com'è. La copia
//   scrive l'SVG con gli id di prima.
// - **Byte per byte.** Ciò che non deve cambiare resta come era scritto: fra
//   due disegni con le stesse unità, da un livello senza trasformazioni a un
//   altro, un giro di copia e incolla riporta gli stessi byte, id a parte.
// - **Fuori:** il CSS non si interpreta e nessuna risorsa esterna si carica.
//   Le entità di un `DOCTYPE` si sostituiscono col loro testo, perché il
//   disegno che riceve non le dichiara.

import { formatNumber, formatShortest } from "../number";
import { NON_RENDERING } from "../painter/paint";
import { isContainer, type Role } from "../scene/analysis";
import { classifyChild, firstTitle, resourceIndex, resourceKind, svgAttribute, swatchOf, type Place, type Resolve, type ResourceKind, type SwatchFacts, type Tag } from "../scene/classify";
import { reindent } from "../scene/engine";
import type { Bounds } from "../scene/geometry";
import { compose, IDENTITY, type Matrix, type Point } from "../scene/matrix";
import { declarationsOf, elementChildren, indentOf, parseFragment, placeOf, scopeOf, type ContainerNode, type DocumentModel } from "../scene/model";
import { MAX_OP_BYTES, type Op } from "../scene/ops";
import { MAX_EDIT_BYTES, MAX_RESOURCES } from "../scene/read";
import {
  attributesOf,
  canonicalOrder,
  escapeAttribute,
  escapeText,
  formatTransform,
  NamespaceScope,
  scopeInside,
  writeOpenTag,
  type OutAttr,
} from "../scene/serialize";
import { SourceText, utf8Length } from "../scene/text";
import { href as hrefKind, length, numberList, paintReference, scanNumber, transform as parseTransform, trim, urlIds, viewBoxMatrix } from "../scene/values";
import {
  FUB_NS,
  isSvg,
  NS_FUB,
  NS_NONE,
  NS_SVG,
  NS_XLINK,
  NS_XML,
  parseXml,
  valueOf,
  XMLNS_URI,
  XmlError,
  type Attr,
  type ElementNode,
  type EntityRefNode,
  type NodeId,
  type XmlDocument,
} from "../scene/xml";
import { t } from "../strings";
import { INHERITED, plainAttributes } from "./arrange";
import { isLinkName, relinked } from "./connector-copies";
import { mappedBounds, transformValue, type Destination, type NewIds } from "./edit";
import { cleanName, nameKey } from "./naming";
import { inheritedBy, INITIAL } from "./place";
import { homeOf, paintCode, resourceHome, resourcesOf } from "./resources";
import { renameUrls, restyle } from "./stylesheet";
import { freshSwatchName, swatchNameProblem } from "./swatches";
import { markerTip } from "./tips";

/// Il tipo di un SVG negli appunti.
export const SVG_TYPE = "image/svg+xml";

/// Il JSON di un `add` dell'incolla, al più: la metà del limite di
/// un'operazione, così nessuna gli si avvicina. Un elemento estraneo più
/// grande va da solo, perché non si divide.
const CHUNK_BYTES = MAX_OP_BYTES / 2;

/// Il lato più corto del `viewBox` copiato, in unità del disegno.
const MIN_SIDE = 1;

/// Quanto un numero della matrice fra due disegni può scostarsi da un intero
/// e valere quell'intero: le misure lette e riscritte non tornano esatte.
const SNAP = 1e-9;

/// Gli attributi che valgono solo sulla radice: la misura, la vista, la
/// versione. Il gruppo di un SVG incollato li sostituisce con la sua
/// trasformazione.
const ROOT_ONLY: ReadonlySet<string> = new Set([
  "x",
  "y",
  "width",
  "height",
  "viewBox",
  "preserveAspectRatio",
  "version",
  "baseProfile",
  "zoomAndPan",
  "contentScriptType",
  "contentStyleType",
]);

/// Gli attributi ARIA che nominano altri elementi per id.
const IDREFS: ReadonlySet<string> = new Set([
  "aria-activedescendant",
  "aria-controls",
  "aria-describedby",
  "aria-details",
  "aria-errormessage",
  "aria-flowto",
  "aria-labelledby",
  "aria-owns",
]);

/// Le animazioni, che in `begin` e `end` nominano altri elementi.
const ANIMATIONS: ReadonlySet<string> = new Set(["animate", "animateMotion", "animateTransform", "set", "discard"]);

/// Un `id.evento` in `begin` o `end`: l'id, con i suoi escape, prima del
/// punto.
const TIMING = /(^|;)(\s*)((?:[^\s;.\\]|\\.)+)\.(?=[A-Za-z])/g;

/// Un riferimento a un'entità che non è una delle cinque di XML né un
/// carattere.
const ENTITY = /&(?!(?:lt|gt|amp|quot|apos);|#)/;

/// Le forme del formato: contano gli attributi ereditati del colore e del
/// contorno, non quelli del carattere.
const SHAPES: ReadonlySet<string> = new Set(["path", "rect", "ellipse", "circle", "line", "polyline", "polygon"]);

/// I figli della radice di un SVG di FubDraw che sono del documento e non
/// del disegno: titolo, descrizione, metadati.
const DOCUMENT_PARTS: ReadonlySet<string> = new Set(["title", "desc", "metadata"]);

/// Un'entità che non si sostituisce: il suo testo ha marcatura o altri
/// riferimenti.
class Unresolved extends Error {}

// ---------------------------------------------------------------------------
// Misure.
// ---------------------------------------------------------------------------

/// Il `viewBox` letto; `null` se manca o ha un lato che non è positivo.
function viewBoxOf(value: string | undefined): [number, number, number, number] | null {
  const list = value === undefined ? null : numberList(value);
  if (list === null || list.length !== 4 || !(list[2]! > 0) || !(list[3]! > 0)) return null;
  return [list[0]!, list[1]!, list[2]!, list[3]!];
}

/// Una lunghezza positiva in pixel CSS; `null` se non lo è.
function positive(value: string | undefined): number | null {
  const px = value === undefined ? null : length(value);
  return px !== null && px > 0 ? px : null;
}

/// Quanti pixel CSS vale un'unità utente della radice, per asse: dalla
/// misura e dal `viewBox`; uno, cioè un pixel, se manca l'una o l'altro.
function unitScale(attr: (name: string) => string | undefined): [number, number] {
  const box = viewBoxOf(attr("viewBox"));
  const side = (name: string, span: number | undefined): number => {
    const px = positive(attr(name));
    return px === null || span === undefined ? 1 : px / span;
  };
  return [side("width", box?.[2]), side("height", box?.[3])];
}

/// La misura copiata lungo un asse: `side` unità del disegno, nell'unità con
/// cui la radice scrive la sua misura `value` su `span` unità del `viewBox`;
/// in unità utente se la radice non ha l'una o l'altro.
function copiedSize(value: string | undefined, span: number | undefined, side: number): string {
  const px = positive(value);
  if (px === null || span === undefined) return formatShortest(side);
  const text = trim(value!);
  const [number, end] = scanNumber(text, 0)!;
  return `${formatShortest((side * number) / span)}${text.slice(end)}`;
}

/// La misura del riquadro in cui si vede un SVG, in pixel CSS: `width` e
/// `height`, le proporzioni del `viewBox` per quella che manca, o 300 × 150
/// come in un browser.
function viewport(attr: (name: string) => string | undefined, box: readonly number[] | null): [number, number] {
  const w = positive(attr("width"));
  const h = positive(attr("height"));
  if (w !== null && h !== null) return [w, h];
  if (box !== null) {
    if (w !== null) return [w, (w * box[3]!) / box[2]!];
    if (h !== null) return [(h * box[2]!) / box[3]!, h];
    return [box[2]!, box[3]!];
  }
  return [w ?? 300, h ?? 150];
}

/// `m` coi numeri che stanno a meno di [`SNAP`] da un intero portati
/// sull'intero.
function snapped(m: Matrix): Matrix {
  return m.map((v) => (Math.abs(v - Math.round(v)) < SNAP ? Math.round(v) + 0 : v)) as unknown as Matrix;
}

function isIdentity(m: Matrix): boolean {
  return m.every((v, i) => v === IDENTITY[i]);
}

/// Il `viewBox` copiato: il riquadro, largo almeno [`MIN_SIDE`], coi bordi
/// arrotondati verso l'esterno a due decimali.
function copiedBox(bounds: Bounds): [number, number, number, number] {
  const side = (from: number, to: number): [number, number] => {
    if (to - from >= MIN_SIDE) return [from, to];
    const middle = (from + to) / 2;
    return [middle - MIN_SIDE / 2, middle + MIN_SIDE / 2];
  };
  const [x0, x1] = side(bounds.min[0], bounds.max[0]);
  const [y0, y1] = side(bounds.min[1], bounds.max[1]);
  const down = (v: number): number => Math.floor(v * 100 + 1e-6) / 100;
  const up = (v: number): number => Math.ceil(v * 100 - 1e-6) / 100;
  const round = (v: number): number => Number(formatNumber(v, 2));
  return [round(down(x0)), round(down(y0)), round(up(x1) - down(x0)), round(up(y1) - down(y0))];
}

// ---------------------------------------------------------------------------
// Albero XML.
// ---------------------------------------------------------------------------

/// L'elemento al percorso `path`, gli indici dei figli elemento dalla
/// radice; `null` se non c'è.
function elementAt(doc: XmlDocument, path: readonly number[]): NodeId | null {
  if (path.length === 0) return null;
  let at = doc.root;
  for (const index of path) {
    const next = doc.children(at).filter((child) => doc.element(child) !== null)[index];
    if (next === undefined) return null;
    at = next;
  }
  return at;
}

/// Vero se un antenato di `id` sta in `set`.
function within(doc: XmlDocument, id: NodeId, set: ReadonlySet<NodeId>): boolean {
  for (let at = doc.nodes[id]!.parent; at !== null; at = doc.nodes[at]!.parent) if (set.has(at)) return true;
  return false;
}

/// Gli antenati di `id`, dal genitore alla radice.
function ancestors(doc: XmlDocument, id: NodeId): ElementNode[] {
  const out: ElementNode[] = [];
  for (let at = doc.nodes[id]!.parent; at !== null; at = doc.nodes[at]!.parent) {
    const element = doc.element(at);
    if (element !== null) out.push(element);
  }
  return out;
}

/// Lo scope in vigore dentro `chain`, gli antenati dal genitore alla radice.
function scopeOfChain(chain: readonly ElementNode[]): NamespaceScope {
  let scope = NamespaceScope.EMPTY;
  for (let i = chain.length - 1; i >= 0; i--) scope = scopeInside(scope, chain[i]!);
  return scope;
}

/// Gli elementi del sottoalbero di `id`, lui compreso, nell'ordine del
/// documento.
function* subtree(doc: XmlDocument, id: NodeId): Generator<NodeId> {
  const stack = [id];
  while (stack.length > 0) {
    const at = stack.pop()!;
    yield at;
    const children = doc.children(at);
    for (let i = children.length - 1; i >= 0; i--) if (doc.element(children[i]!) !== null) stack.push(children[i]!);
  }
}

/// Il testo dei figli di uno `style`, e se è in una sezione CDATA; `null` se
/// ha dentro altro.
function sheetText(doc: XmlDocument, element: ElementNode): [css: string, cdata: boolean] | null {
  let css = "";
  let cdata = false;
  for (const child of element.children) {
    const node = doc.nodes[child]!;
    if (node.kind === "text") css += node.value;
    else if (node.kind === "cdata") {
      css += node.value;
      cdata = true;
    } else return null;
  }
  return [css, cdata];
}

/// Vero se `element` disegna qualcosa da sé: un elemento SVG che non è una
/// risorsa, uno stile o un metadato.
function renders(element: ElementNode): boolean {
  return element.ns === NS_SVG && !NON_RENDERING.has(element.local);
}

function hasId(element: ElementNode): boolean {
  return (valueOf(element, NS_NONE, "id") ?? "") !== "";
}

/// Gli attributi ereditati che contano per `element`, modificabile col ruolo
/// di `found` o estraneo: per un estraneo che non è una forma tutti, perché
/// può disegnare figli o ciò a cui rimanda.
function inheritedOf(element: ElementNode, found: readonly [Tag, Role] | null): readonly string[] {
  if (found !== null) return inheritedBy(element.local, isContainer(found[1]));
  if (!renders(element) || element.local === "image") return [];
  return SHAPES.has(element.local) ? inheritedBy(element.local, false) : INHERITED;
}

/// Il ruolo di `id` come figlio di un contenitore al posto `place`, a
/// profondità `depth`, e gli elementi modificabili che hanno
/// bisogno di un id: tutti tranne titoli e descrizioni, sotto di lui e, con
/// `top`, lui stesso. `resolve` dice quali id saranno risorse del disegno.
function rolesUnder(doc: XmlDocument, id: NodeId, place: Place, depth: number, top: boolean, missing: NodeId[], resolve: Resolve): [Tag, Role] | null {
  const found = classifyChild(doc, id, place, depth, resolve);
  if (found === null) return null;
  if (top && found[0] !== "title" && found[0] !== "desc" && !hasId(doc.element(id)!)) missing.push(id);
  const stack: Array<readonly [NodeId, Role, number]> = [[id, found[1], depth]];
  while (stack.length > 0) {
    const [at, role, level] = stack.pop()!;
    if (!isContainer(role)) continue;
    for (const child of doc.children(at)) {
      const element = doc.element(child);
      if (element === null) continue;
      const inner = classifyChild(doc, child, role === "defs" ? "defs" : "inside", level + 1, resolve);
      if (inner === null) continue;
      if (inner[0] !== "title" && inner[0] !== "desc" && !hasId(element)) missing.push(child);
      stack.push([child, inner[1], level + 1]);
    }
  }
  return found;
}

/// Vero se dentro `id`, giudicato come in [`rolesUnder`], c'è un blocco
/// estraneo, o lo è lui.
function holdsForeign(doc: XmlDocument, id: NodeId, place: Place, depth: number, resolve: Resolve): boolean {
  const found = classifyChild(doc, id, place, depth, resolve);
  if (found === null) return true;
  const stack: Array<readonly [NodeId, Role, number]> = [[id, found[1], depth]];
  while (stack.length > 0) {
    const [at, role, level] = stack.pop()!;
    if (!isContainer(role)) continue;
    for (const child of doc.children(at)) {
      if (doc.element(child) === null) continue;
      const inner = classifyChild(doc, child, role === "defs" ? "defs" : "inside", level + 1, resolve);
      if (inner === null) return true;
      stack.push([child, inner[1], level + 1]);
    }
  }
  return false;
}

/// Le dichiarazioni che un elemento scritto dove vale `to` deve portare per
/// leggersi come dove vale `from`: quelle dei prefissi che `used` dice usati
/// e che lì valgono altro, se `element` non le porta già. Un prefisso che
/// `from` non lega lo dichiara un discendente.
function needed(from: NamespaceScope, to: NamespaceScope, used: ReadonlySet<string | null>, element: ElementNode | null): Array<[string | null, string]> {
  const own = new Set(element === null ? [] : declarationsOf(element).map(([prefix]) => prefix));
  const out: Array<[string | null, string]> = [];
  for (const prefix of used) {
    if (own.has(prefix)) continue;
    const uri = from.uri(prefix);
    if (uri === null) continue;
    if (uri !== (to.uri(prefix) ?? "")) out.push([prefix, uri]);
  }
  return out;
}

/// Gli id usati in `doc`: il primo elemento per ogni id, come lo trova un
/// browser.
function holdersById(doc: XmlDocument): Map<string, NodeId> {
  const out = new Map<string, NodeId>();
  doc.nodes.forEach((node, id) => {
    if (node.kind !== "element") return;
    const value = valueOf(node, NS_NONE, "id");
    if (value !== undefined && value !== "" && !out.has(value)) out.set(value, id);
  });
  return out;
}

/// Gli id a cui rimanda `element`: `url(#…)` ovunque, un `href` che è un
/// frammento, e un attributo di un altro namespace che è un frammento, come
/// gli effetti di Inkscape; e, in un foglio di stile, i suoi `url(#…)`.
function referencesOf(doc: XmlDocument, element: ElementNode): string[] {
  const out: string[] = [];
  const urls = (text: string): void => {
    for (const match of text.matchAll(/url\(\s*(["']?)#([^"')\s]+)\1\s*\)/gi)) out.push(match[2]!);
  };
  for (const attr of element.attrs) {
    if (attr.name === "xmlns" || attr.name.startsWith("xmlns:")) continue;
    if (/url\(/i.test(attr.value)) urls(attr.value);
    const fragment = /^#(.+)$/.exec(attr.value);
    if (fragment !== null && (attr.local === "href" || (attr.ns !== NS_NONE && attr.ns !== NS_XML))) out.push(fragment[1]!);
  }
  if (isSvg(element, "style")) urls(sheetText(doc, element)?.[0] ?? "");
  return out;
}

// ---------------------------------------------------------------------------
// Riscrittura.
// ---------------------------------------------------------------------------

/// Le modifiche a un testo: intervalli sostituiti, tenuti in ordine. Due
/// inserimenti nello stesso punto restano nell'ordine in cui arrivano.
class Edits {
  private readonly list: Array<{ readonly from: number; readonly to: number; readonly text: string; readonly order: number }> = [];
  private sorted = true;

  add(from: number, to: number, text: string): void {
    const last = this.list[this.list.length - 1];
    if (last !== undefined && from < last.from) this.sorted = false;
    this.list.push({ from, to, text, order: this.list.length });
  }

  /// Il testo di `source` fra `from` e `to`, con le modifiche che vi
  /// cominciano.
  apply(source: string, from: number, to: number): string {
    if (!this.sorted) {
      this.list.sort((a, b) => a.from - b.from || a.order - b.order);
      this.sorted = true;
    }
    let lo = 0;
    let hi = this.list.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.list[mid]!.from < from) lo = mid + 1;
      else hi = mid;
    }
    let out = "";
    let at = from;
    for (let i = lo; i < this.list.length; i++) {
      const edit = this.list[i]!;
      if (edit.from >= to) break;
      out += source.slice(at, edit.from) + edit.text;
      at = edit.to;
    }
    return out + source.slice(at, to);
  }
}

/// Il valore come va scritto fra le virgolette che aveva: con gli escape, e
/// l'apostrofo fra apici.
function quoted(value: string, single: boolean): string {
  const text = escapeAttribute(value);
  return single ? text.replace(/'/g, "&apos;") : text;
}

/// Il testo a LF.
function lf(text: string): string {
  return text.indexOf("\r") < 0 ? text : text.replace(/\r\n?/g, "\n");
}

/// Dove finisce il nome nel tag d'apertura di `element`.
function nameEnd(element: ElementNode): number {
  return element.start + 1 + element.name.length;
}

/// Nessun attributo da togliere.
const KEPT: ReadonlySet<number> = new Set();

/// Ciò che cambia nel testo di un SVG che si copia o si incolla.
interface Rules {
  /// L'id nuovo a cui va un riferimento; `null` se resta.
  readonly rename: (id: string) => string | null;
  /// Vero nell'incolla: `fub:from`, `fub:to`, `fub:along` e `fub:inside`
  /// seguono gli id nuovi, e si tolgono se ciò che nominano non entra. Nella copia gli id
  /// restano, e con loro i riferimenti.
  readonly relink: boolean;
  /// L'id nuovo di un elemento.
  readonly ids: ReadonlyMap<NodeId, string>;
  /// Il nome nuovo di un campione, per elemento.
  readonly named: ReadonlyMap<NodeId, string>;
  /// Il colore dei campioni del disegno a cui va un riferimento, per id: il
  /// ripiego di chi li usa.
  readonly colors: ReadonlyMap<string, string>;
  /// I fogli di stile: l'id del gruppo che li chiude, `null` per rinominare
  /// soltanto, `undefined` se restano come sono.
  readonly sheets: string | null | undefined;
  /// Il nuovo `href` di un'immagine o di un collegamento del vault; `null`
  /// lo lascia.
  readonly href: (value: string) => string | null;
  /// Quali id saranno risorse del disegno: con gli id del testo letto, e con
  /// quelli del testo riscritto.
  readonly resolve: Resolve;
  readonly written: Resolve;
}

/// Il tag d'apertura di un elemento che va in un altro posto.
interface Head {
  /// Gli attributi senza namespace da scrivere, `null` per toglierli.
  readonly set: ReadonlyMap<string, string | null>;
  /// Per un elemento estraneo, la trasformazione da comporre davanti alla
  /// sua: il suo testo non si riscrive.
  readonly before: string | null;
  /// Vero se il tag si riscrive nella forma canonica: un elemento
  /// modificabile che cambia, come lo cambierebbe un `set`.
  readonly canonical: boolean;
  /// Toglie `fub:layer`: un livello che diventa un gruppo.
  readonly unlayer: boolean;
  readonly declarations: ReadonlyArray<readonly [string | null, string]>;
  /// L'id da dare all'elemento, se non ne ha.
  readonly id: string | null;
  /// Un primo figlio da aggiungere, già scritto, col rientro della riga
  /// dell'elemento: il titolo di un livello che diventa un gruppo.
  readonly child: string | null;
}

/// Le modifiche al testo di un SVG letto: le regole di [`Rules`] per i
/// discendenti, quelle di [`Head`] per un elemento che cambia posto.
class Rewriter {
  readonly edits = new Edits();
  private readonly text: string;
  /// Gli id da dare agli elementi modificabili che non ne hanno.
  readonly fresh = new Map<NodeId, string>();
  /// I prefissi usati da ciò che si è riscritto dopo l'ultimo `clear`:
  /// `null` per il namespace predefinito di un elemento.
  readonly used = new Set<string | null>();
  /// I primi figli aggiunti da `head`, per elemento: la divisione di un
  /// contenitore troppo grande li porta per primi.
  readonly added = new Map<NodeId, string>();

  constructor(
    readonly doc: XmlDocument,
    readonly rules: Rules,
  ) {
    this.text = doc.source.text;
  }

  /// L'id di `id` dopo la riscrittura, nuovo o dato a chi non ne aveva;
  /// `null` se resta senza.
  idOf(id: NodeId): string | null {
    return this.rules.ids.get(id) ?? this.fresh.get(id) ?? null;
  }

  /// Il testo fra `from` e `to` con le modifiche, a LF.
  slice(from: number, to: number): string {
    return lf(this.edits.apply(this.text, from, to));
  }

  /// Riscrive il sottoalbero di `id`; il suo tag d'apertura solo se non lo
  /// decide `head`.
  body(id: NodeId, head: boolean): void {
    const stack: NodeId[] = [id];
    while (stack.length > 0) {
      const at = stack.pop()!;
      const element = this.doc.element(at)!;
      this.uses(element);
      if (at !== id || !head) {
        // L'id prima degli attributi tolti, che cominciano dov'è finito il nome.
        const fresh = this.fresh.get(at);
        if (fresh !== undefined) this.edits.add(nameEnd(element), nameEnd(element), ` id="${fresh}"`);
        for (const [index, text] of this.values(at)) {
          const attr = element.attrs[index]!;
          this.edits.add(attr.raw[0], attr.raw[1], text);
        }
        for (const index of this.dropped(element)) this.drop(element, element.attrs[index]!);
      }
      if (this.rules.sheets !== undefined && isSvg(element, "style")) this.sheet(element);
      for (let i = element.children.length - 1; i >= 0; i--) {
        const child = element.children[i]!;
        const node = this.doc.nodes[child]!;
        if (node.kind === "element") stack.push(child);
        else if (node.kind === "entity-ref") this.entity(node);
      }
    }
  }

  /// Il tag d'apertura di `id` come lo chiede `head`.
  head(id: NodeId, head: Head, indent: string): void {
    const element = this.doc.element(id)!;
    const values = this.values(id);
    const dropped = this.dropped(element);
    const selfClosing = element.closeStart === null;
    const child = head.child === null ? "" : `\n${indent}  ${head.child}`;
    if (head.canonical) {
      const attrs: OutAttr[] = [];
      attributesOf(this.doc, element).forEach((attr, index) => {
        if (head.unlayer && attr.uri === FUB_NS && attr.local === "layer") return;
        if (dropped.has(index)) return;
        if (attr.uri === "" && head.set.has(attr.local)) return;
        attrs.push({ ...attr, text: values.get(index) ?? attr.text });
      });
      for (const [name, value] of head.set) if (value !== null) attrs.push({ name, uri: "", local: name, text: escapeAttribute(value) });
      if (head.id !== null) attrs.push({ name: "id", uri: "", local: "id", text: head.id });
      for (const [prefix, uri] of head.declarations) {
        attrs.push({ name: prefix === null ? "xmlns" : `xmlns:${prefix}`, uri: XMLNS_URI, local: prefix ?? "xmlns", text: escapeAttribute(uri) });
      }
      const out = { name: element.name, group: false, attrs: canonicalOrder(attrs), children: [], text: null };
      if (selfClosing && child !== "") {
        this.edits.add(element.start, element.end, `${writeOpenTag(out, false)}${child}\n${indent}</${element.name}>`);
      } else {
        this.edits.add(element.start, element.openEnd, writeOpenTag(out, selfClosing));
        if (child !== "") {
          this.edits.add(element.openEnd, element.openEnd, child);
          this.added.set(id, head.child!);
        }
      }
      return;
    }
    let lead = "";
    for (const [prefix, uri] of head.declarations) lead += prefix === null ? ` xmlns="${escapeAttribute(uri)}"` : ` xmlns:${prefix}="${escapeAttribute(uri)}"`;
    if (head.id !== null) lead += ` id="${head.id}"`;
    if (lead !== "") this.edits.add(nameEnd(element), nameEnd(element), lead);
    const set = new Map(head.set);
    let before = head.before;
    element.attrs.forEach((attr, index) => {
      if (dropped.has(index)) {
        this.drop(element, attr);
        return;
      }
      const single = this.text.charCodeAt(attr.raw[0] - 1) === 0x27;
      let text = values.get(index) ?? null;
      if (attr.ns === NS_NONE && set.has(attr.local)) {
        const value = set.get(attr.local)!;
        set.delete(attr.local);
        if (value !== null) text = quoted(value, single);
      }
      if (attr.ns === NS_NONE && attr.local === "transform" && before !== null) {
        text = `${before} ${text ?? this.text.slice(attr.raw[0], attr.raw[1])}`;
        before = null;
      }
      if (text !== null) this.edits.add(attr.raw[0], attr.raw[1], text);
    });
    if (before !== null) set.set("transform", before);
    let tail = "";
    for (const [name, value] of set) if (value !== null) tail += ` ${name}="${escapeAttribute(value)}"`;
    const last = element.attrs[element.attrs.length - 1];
    const at = last === undefined ? nameEnd(element) : last.raw[1] + 1;
    if (tail !== "") this.edits.add(at, at, tail);
    if (child !== "") throw new Error("un primo figlio si aggiunge solo nella forma canonica");
  }

  /// I valori riscritti degli attributi di `element`, già scritti fra le
  /// loro virgolette, per indice; quelli che restano non ci sono.
  values(id: NodeId): Map<number, string> {
    const out = new Map<number, string>();
    const element = this.doc.element(id)!;
    const dropped = this.dropped(element);
    element.attrs.forEach((attr, index) => {
      if (dropped.has(index)) return;
      const declaration = attr.name === "xmlns" || attr.name.startsWith("xmlns:");
      const next = declaration ? attr.value : this.value(id, element, attr);
      if (next === attr.value && !ENTITY.test(this.text.slice(attr.raw[0], attr.raw[1]))) return;
      out.set(index, quoted(next, this.text.charCodeAt(attr.raw[0] - 1) === 0x27));
    });
    return out;
  }

  /// Gli indici degli attributi di `element` che si tolgono: `fub:from`,
  /// `fub:to`, `fub:along` e `fub:inside` che nominano ciò che non entra.
  private dropped(element: ElementNode): ReadonlySet<number> {
    if (!this.rules.relink) return KEPT;
    let out: Set<number> | null = null;
    element.attrs.forEach((attr, index) => {
      if (attr.ns === NS_FUB && isLinkName(attr.local) && relinked(attr.local, attr.value, this.rules.rename) === null) (out ??= new Set()).add(index);
    });
    return out ?? KEPT;
  }

  /// Toglie l'attributo `attr` di `element`, con gli spazi che lo precedono.
  private drop(element: ElementNode, attr: Attr): void {
    let from = this.text.lastIndexOf(attr.name, attr.raw[0]);
    while (from > element.start && /[ \t\r\n]/.test(this.text[from - 1]!)) from--;
    this.edits.add(from, attr.raw[1] + 1, "");
  }

  /// Il valore nuovo di un attributo.
  private value(id: NodeId, element: ElementNode, attr: Attr): string {
    const { rename } = this.rules;
    if (attr.ns === NS_NONE && attr.local === "id") return this.rules.ids.get(id) ?? attr.value;
    if (attr.ns === NS_FUB && attr.local === "name") return this.rules.named.get(id) ?? attr.value;
    if (this.rules.relink && attr.ns === NS_FUB && isLinkName(attr.local)) return relinked(attr.local, attr.value, rename) ?? attr.value;
    let next = /url\(/i.test(attr.value) ? renameUrls(attr.value, rename) : attr.value;
    if (attr.ns === NS_NONE && (attr.local === "fill" || attr.local === "stroke")) next = this.fallback(next);
    const fragment = /^#(.+)$/.exec(next);
    if (fragment !== null && (attr.local === "href" || (attr.ns !== NS_NONE && attr.ns !== NS_XML))) {
      next = `#${rename(fragment[1]!) ?? fragment[1]!}`;
    } else if (attr.ns === NS_NONE && IDREFS.has(attr.local)) {
      next = next.replace(/\S+/g, (token) => rename(token) ?? token);
    } else if (attr.ns === NS_NONE && (attr.local === "begin" || attr.local === "end") && element.ns === NS_SVG && ANIMATIONS.has(element.local)) {
      next = next.replace(TIMING, (whole: string, lead: string, space: string, name: string) => {
        const to = rename(name.replace(/\\(.)/g, "$1"));
        return to === null ? whole : `${lead}${space}${to}.`;
      });
    } else if (attr.local === "href" && (attr.ns === NS_NONE || attr.ns === NS_XLINK) && (isSvg(element, "image") || isSvg(element, "a")) && hrefKind(next).kind === "vault") {
      next = this.rules.href(next) ?? next;
    }
    return next;
  }

  /// Un colore che rimanda a un campione del disegno, col colore del
  /// campione come ripiego se ne scrive un altro.
  private fallback(value: string): string {
    const used = paintReference(value);
    if (used === null || used.fallback === null) return value;
    const color = this.rules.colors.get(used.id);
    return color === undefined || paintCode(used.fallback) === color ? value : `url(#${used.id}) ${color}`;
  }

  /// I prefissi dei nomi di `element` e dei suoi attributi.
  private uses(element: ElementNode): void {
    const colon = element.name.indexOf(":");
    this.used.add(colon < 0 ? null : element.name.slice(0, colon));
    for (const attr of element.attrs) {
      const c = attr.name.indexOf(":");
      if (c < 0) continue;
      const prefix = attr.name.slice(0, c);
      if (prefix !== "xmlns" && prefix !== "xml") this.used.add(prefix);
    }
  }

  /// Un foglio di stile: i riferimenti e, se va chiuso in un gruppo, i
  /// selettori. Un foglio con dentro altro che testo resta com'è.
  private sheet(element: ElementNode): void {
    if (element.closeStart === null) return;
    const read = sheetText(this.doc, element);
    if (read === null) return;
    const [css, cdata] = read;
    const next = restyle(css, { rename: this.rules.rename, scope: this.rules.sheets! });
    if (next === css) return;
    const body = cdata ? `<![CDATA[${next.replace(/]]>/g, "]]]]><![CDATA[>")}]]>` : escapeText(next);
    this.edits.add(element.openEnd, element.closeStart, body);
  }

  /// Un riferimento a un'entità, sostituito dal suo testo.
  private entity(node: EntityRefNode): void {
    const text = this.doc.plainEntity(node.name);
    if (text === null) throw new Unresolved(node.name);
    this.edits.add(node.start, node.end, escapeText(text));
  }
}

// ---------------------------------------------------------------------------
// Copiare.
// ---------------------------------------------------------------------------

/// Ciò che si copia.
export interface CopyInput {
  /// Il testo del disegno.
  readonly text: string;
  /// I percorsi degli elementi scelti: gli indici dei figli elemento dalla
  /// radice.
  readonly paths: ReadonlyArray<readonly number[]>;
  /// Il riquadro di ciò che si vede della selezione, nella scena.
  readonly bounds: Bounds;
}

/// Un prefisso libero in `scope`: `base`, o `base` con un numero.
function freePrefix(scope: NamespaceScope, base: string): string {
  if (scope.uri(base) === null) return base;
  for (let n = 1; ; n++) if (scope.uri(`${base}${n}`) === null) return `${base}${n}`;
}

/// La selezione come documento SVG; `null` se non c'è niente da copiare, o
/// se un'entità del disegno non si sostituisce col suo testo.
export function copySvg(input: CopyInput): string | null {
  let doc: XmlDocument;
  try {
    doc = parseXml(new SourceText(input.text), false);
  } catch (error) {
    if (error instanceof XmlError) return null;
    throw error;
  }
  const root = doc.element(doc.root)!;
  const chosen = new Set<NodeId>();
  for (const path of input.paths) {
    const at = elementAt(doc, path);
    if (at !== null) chosen.add(at);
  }
  const tops = [...chosen].filter((id) => !within(doc, id, chosen)).sort((a, b) => doc.nodes[a]!.start - doc.nodes[b]!.start);
  if (tops.length === 0) return null;

  const rootScope = scopeInside(NamespaceScope.EMPTY, root);
  const known = rootScope.attributePrefix(FUB_NS);
  const fub = known ?? freePrefix(rootScope, "fub");
  const scope = known === null ? rootScope.declare([[fub, FUB_NS]]) : rootScope;
  const index = resourceIndex(doc);
  const resolve: Resolve = (id) => index.get(id) ?? null;
  const rewriter = new Rewriter(doc, { rename: () => null, relink: false, ids: new Map(), named: new Map(), colors: new Map(), sheets: undefined, href: () => null, resolve, written: resolve });

  try {
    const pieces: string[] = [];
    // Le risorse a cui rimanda ciò che un elemento eredita e prende su di sé.
    const inherited: string[] = [];
    let foreign = false;
    for (const id of tops) {
      const element = doc.element(id)!;
      const chain = ancestors(doc, id);
      let matrix = IDENTITY;
      for (let i = chain.length - 2; i >= 0; i--) matrix = compose(matrix, parseTransform(valueOf(chain[i]!, NS_NONE, "transform") ?? "") ?? IDENTITY);
      const place = element.parent === doc.root ? "root" : "inside";
      const found = classifyChild(doc, id, place, chain.length, resolve);
      foreign ||= holdsForeign(doc, id, place, chain.length, resolve);
      const set = new Map<string, string | null>();
      let before: string | null = null;
      if (!isIdentity(matrix)) {
        const own = parseTransform(valueOf(element, NS_NONE, "transform") ?? "") ?? IDENTITY;
        if (found !== null) set.set("transform", transformValue(compose(matrix, own)));
        else if (renders(element)) before = formatTransform(matrix);
      }
      for (const name of inheritedOf(element, found)) {
        if (valueOf(element, NS_NONE, name) !== undefined) continue;
        const value = chain.map((at) => valueOf(at, NS_NONE, name)).find((v) => v !== undefined);
        if (value === undefined) continue;
        set.set(name, value);
        inherited.push(...urlIds(value));
      }
      rewriter.used.clear();
      rewriter.body(id, true);
      const declarations = needed(scopeOfChain(chain), scope, rewriter.used, element);
      const indent = doc.source.indent(element.start);
      rewriter.head(id, { set, before, canonical: found !== null && set.size > 0, unlayer: false, declarations, id: null, child: null }, indent);
      pieces.push(reindent(rewriter.slice(element.start, element.end), scope, "root", 1, indent, "  ", resolve));
    }

    const holders = holdersOf(doc, tops, foreign, inherited);
    const prefix = root.name.includes(":") ? root.name.slice(0, root.name.indexOf(":") + 1) : "";
    if (holders.length > 0) {
      let defs = `<${prefix}defs>`;
      for (const id of holders) {
        const element = doc.element(id)!;
        rewriter.used.clear();
        rewriter.body(id, true);
        const declarations = needed(scopeOfChain(ancestors(doc, id)), scope, rewriter.used, element);
        const indent = doc.source.indent(element.start);
        rewriter.head(id, { set: new Map(), before: null, canonical: false, unlayer: false, declarations, id: null, child: null }, indent);
        defs += `\n    ${reindent(rewriter.slice(element.start, element.end), scope, "defs", 2, indent, "    ", resolve)}`;
      }
      pieces.unshift(`${defs}\n  </${prefix}defs>`);
    }

    let head = `<${root.name}`;
    for (const attr of root.attrs) if (attr.name === "xmlns" || attr.name.startsWith("xmlns:")) head += ` ${attr.name}="${escapeAttribute(attr.value)}"`;
    if (known === null) head += ` xmlns:${fub}="${FUB_NS}"`;
    const box = copiedBox(input.bounds);
    const rootBox = viewBoxOf(valueOf(root, NS_NONE, "viewBox"));
    head += ` ${fub}:version="${escapeAttribute(valueOf(root, NS_FUB, "version") ?? "1")}"`;
    head += ` viewBox="${box.map((v) => formatNumber(v, 2)).join(" ")}"`;
    head += ` width="${escapeAttribute(copiedSize(valueOf(root, NS_NONE, "width"), rootBox?.[2], box[2]))}"`;
    head += ` height="${escapeAttribute(copiedSize(valueOf(root, NS_NONE, "height"), rootBox?.[3], box[3]))}"`;
    return `${head}>${pieces.map((piece) => `\n  ${piece}`).join("")}\n</${root.name}>\n`;
  } catch (error) {
    if (error instanceof Unresolved) return null;
    throw error;
  }
}

/// Ciò a cui rimandano gli elementi copiati, o gli id `extra`, e che resta
/// fuori, a cascata, e con `styles` i fogli di stile del documento:
/// nell'ordine del documento, senza chi sta dentro un altro di loro. Non la
/// radice né un antenato di ciò che si copia, che lo ripeterebbero.
function holdersOf(doc: XmlDocument, tops: readonly NodeId[], styles: boolean, extra: readonly string[]): NodeId[] {
  const copied = new Set(tops);
  const around = new Set<NodeId>();
  for (const top of tops) for (let at = doc.nodes[top]!.parent; at !== null; at = doc.nodes[at]!.parent) around.add(at);
  const taken = new Set<NodeId>();
  const pending: string[] = [...extra];
  const scan = (id: NodeId): void => {
    for (const at of subtree(doc, id)) pending.push(...referencesOf(doc, doc.element(at)!));
  };
  const take = (id: NodeId): void => {
    if (taken.has(id) || copied.has(id) || around.has(id) || within(doc, id, copied)) return;
    taken.add(id);
    scan(id);
  };
  for (const top of tops) scan(top);
  if (styles) doc.nodes.forEach((node, id) => {
    if (node.kind === "element" && isSvg(node, "style")) take(id);
  });
  let byId: Map<string, NodeId> | null = null;
  while (pending.length > 0) {
    byId ??= holdersById(doc);
    const holder = byId.get(pending.pop()!);
    if (holder !== undefined) take(holder);
  }
  return [...taken].filter((id) => !within(doc, id, taken)).sort((a, b) => doc.nodes[a]!.start - doc.nodes[b]!.start);
}

// ---------------------------------------------------------------------------
// Incollare.
// ---------------------------------------------------------------------------

/// Perché un testo non si incolla come SVG: oltre il limite di un disegno
/// modificabile, non ben formato, non un SVG, senza niente da incollare, o
/// con entità che non si sostituiscono col loro testo.
export type PasteProblem = "too-large" | "malformed" | "not-svg" | "empty" | "entities";

/// Un SVG letto, pronto da incollare.
export interface PasteSource {
  readonly doc: XmlDocument;
  /// Vero per un SVG di FubDraw: torna nelle unità del disegno.
  readonly fubdraw: boolean;
  /// Gli elementi che rientrano uno per uno; vuoto se tutto entra in un
  /// gruppo nuovo.
  readonly pieces: readonly NodeId[];
  /// I figli della radice che restano fuori dal gruppo nuovo.
  readonly dropped: ReadonlySet<NodeId>;
  /// Dalle coordinate dell'SVG ai pixel CSS.
  readonly toPx: Matrix;
  /// Il riquadro dell'SVG in pixel CSS.
  readonly frame: Bounds;
  /// Il nome del file da cui viene, senza estensione; `null` dagli appunti.
  readonly name: string | null;
}

/// Vero se `text` comincia come un documento SVG: è il controllo veloce
/// prima di leggerlo.
export function looksLikeSvg(text: string): boolean {
  return /^﻿?\s*</.test(text) && /<(?:[\w.-]+:)?svg[\s/>]/.test(text.slice(0, 4096));
}

/// Legge `text`, un SVG dagli appunti o dal file `file`.
export function readPaste(text: string, file: string | null = null): PasteSource | PasteProblem {
  if (utf8Length(text) > MAX_EDIT_BYTES) return "too-large";
  let doc: XmlDocument;
  try {
    doc = parseXml(new SourceText(text), false);
  } catch (error) {
    if (error instanceof XmlError) return "malformed";
    throw error;
  }
  if (!isSvg(doc.element(doc.root)!, "svg")) return "not-svg";
  // Le entità si sostituiscono prima di leggere il resto: un testo con
  // un'entità dentro è modificabile quanto lo stesso testo scritto per
  // intero.
  const plain = expanded(doc);
  if (plain === null) return "entities";
  if (plain !== doc.source.text) doc = parseXml(new SourceText(plain), false);
  const root = doc.element(doc.root)!;
  const fubdraw = valueOf(root, NS_FUB, "version") !== undefined;
  const attr = (name: string): string | undefined => valueOf(root, NS_NONE, name);

  // Di un SVG di FubDraw rientrano gli elementi del disegno, non quelli del
  // documento; di ogni SVG resta fuori ciò che un altro programma scrive
  // nei suoi namespace, come la vista di Inkscape o i dati privati di
  // Illustrator.
  const dropped = new Set<NodeId>();
  const pieces: NodeId[] = [];
  let wrap = !fubdraw;
  for (const child of root.children) {
    const element = doc.element(child);
    if (element === null) continue;
    if (element.ns !== NS_SVG) {
      dropped.add(child);
      continue;
    }
    if (!fubdraw) continue;
    const role = valueOf(element, NS_FUB, "role");
    const page = (element.local === "rect" && role === "paper") || (element.local === "view" && role === "board");
    if (page || DOCUMENT_PARTS.has(element.local)) {
      dropped.add(child);
      continue;
    }
    // Un foglio di stile del documento vale per tutto il disegno: per non
    // cambiare il resto, tutto entra in un gruppo che lo chiude.
    if (element.local === "style" || (element.local === "defs" && [...subtree(doc, child)].some((inner) => isSvg(doc.element(inner)!, "style")))) wrap = true;
    pieces.push(child);
  }
  const content = root.children.filter((child) => !dropped.has(child) && doc.element(child) !== null && renders(doc.element(child)!));
  if (content.length === 0) return "empty";

  const box = viewBoxOf(attr("viewBox"));
  let toPx: Matrix;
  let frame: Bounds;
  if (fubdraw && box !== null) {
    const [ux, uy] = unitScale(attr);
    toPx = [ux, 0, 0, uy, 0, 0];
    frame = { min: [box[0] * ux, box[1] * uy], max: [(box[0] + box[2]) * ux, (box[1] + box[3]) * uy] };
  } else {
    const [w, h] = viewport(attr, box);
    toPx = box === null ? IDENTITY : viewBoxMatrix(box, w, h, attr("preserveAspectRatio") ?? "");
    frame = { min: [0, 0], max: [w, h] };
  }
  const name = file === null ? null : file.replace(/^.*[\\/]/, "").replace(/\.svgz?$/i, "");
  return { doc, fubdraw, pieces: wrap ? [] : pieces, dropped, toPx, frame, name: name === "" ? null : name };
}

/// Il testo di `doc` con ogni entità sostituita dal suo testo, quello di
/// prima se non ne ha; `null` se una ha dentro marcatura o altri
/// riferimenti.
function expanded(doc: XmlDocument): string | null {
  const text = doc.source.text;
  const edits = new Edits();
  let changed = false;
  for (const node of doc.nodes) {
    if (node.kind === "entity-ref") {
      const value = doc.plainEntity(node.name);
      if (value === null) return null;
      edits.add(node.start, node.end, escapeText(value));
      changed = true;
    } else if (node.kind === "element") {
      for (const attr of node.attrs) {
        if (!ENTITY.test(text.slice(attr.raw[0], attr.raw[1]))) continue;
        edits.add(attr.raw[0], attr.raw[1], quoted(attr.value, text.charCodeAt(attr.raw[0] - 1) === 0x27));
        changed = true;
      }
    }
  }
  return changed ? edits.apply(text, 0, text.length) : text;
}

/// La matrice dai pixel CSS alla scena del disegno `model`, spostata di
/// `delta`.
function fromPx(model: DocumentModel, delta: Point): Matrix {
  const attrs = plainAttributes(model.root);
  const [ux, uy] = unitScale((name) => attrs.get(name));
  return [1 / ux, 0, 0, 1 / uy, delta[0], delta[1]];
}

/// Il riquadro di `source` nella scena del disegno `model`, prima di
/// spostarlo: l'editor ne ricava lo spostamento.
export function pasteFrame(source: PasteSource, model: DocumentModel): Bounds {
  return mappedBounds(source.frame, fromPx(model, [0, 0]));
}

/// Dove e come si incolla.
export interface PasteTarget {
  readonly model: DocumentModel;
  /// Il contenitore che riceve.
  readonly container: ContainerNode;
  /// Come lo nominano le operazioni, e ciò che va fatto prima.
  readonly to: Destination;
  readonly ids: NewIds;
  /// Lo spostamento nella scena: zero per incollare nello stesso punto.
  readonly delta: Point;
  /// L'`href` di un'immagine o di un collegamento del vault visto dal
  /// disegno che riceve; `null` lo lascia com'è.
  readonly href: (value: string) => string | null;
}

/// Un incolla pronto.
export interface PastePlan {
  /// Le operazioni, da applicare in un `batch` solo.
  readonly ops: Op[];
  /// Gli id di ciò che si sceglie dopo.
  readonly keys: string[];
  /// Il riquadro dell'SVG nella scena, dove è andato.
  readonly bounds: Bounds;
}

/// Il JSON di un testo, in byte.
function jsonBytes(text: string): number {
  return utf8Length(JSON.stringify(text));
}

/// Le risorse che un incolla porta nella `defs` del disegno che riceve: dalle
/// `defs` della radice dell'SVG, ciò che usa quello che entra.
interface Lift {
  /// Le `defs` della radice dell'SVG: non entrano al loro posto.
  readonly defs: ReadonlySet<NodeId>;
  /// I loro figli da scrivere nella `defs` del disegno, ognuno dopo ciò che
  /// usa.
  readonly moved: readonly NodeId[];
  /// Le `defs` e tutto ciò che hanno dentro: i loro id li decide il
  /// trasloco.
  readonly decided: ReadonlySet<NodeId>;
  /// Il nome nuovo di un campione che arriva con un nome già preso, o che
  /// si legge come un colore, per elemento.
  readonly named: ReadonlyMap<NodeId, string>;
  /// Il colore dei campioni del disegno che ciò che entra usa al posto dei
  /// suoi, per id.
  readonly colors: ReadonlyMap<string, string>;
  /// Quali id saranno risorse del disegno, con gli id dell'SVG e con quelli
  /// riscritti.
  readonly resolve: Resolve;
  readonly written: Resolve;
}

/// Il testo di un elemento senza gli spazi fra i tag, per riconoscere una
/// risorsa uguale.
function compact(text: string): string {
  return lf(text).replace(/>\s+</g, "><").trim();
}

/// Il testo compatto di un elemento senza il suo `id`, se è il primo
/// attributo, come lo scrive FubDraw: per riconoscere un marcatore uguale
/// con un altro id.
function withoutId(text: string): string {
  return compact(text).replace(/^(<[^\s>]+)\s+id="[^"]*"/, "$1");
}

/// Il trasloco delle risorse di `doc` nel disegno `model`, per i figli della
/// radice `tops`; i nomi nuovi vanno in `names` e `renamed`. Una risorsa
/// privata ha sempre una copia, con id nuovi; una condivisa, o che non è di
/// FubDraw, resta quella del disegno se ha lo stesso id, lo stesso testo e
/// usa le stesse. Un campione resta quello del disegno con lo stesso id, o
/// diventa il campione del disegno, o uno che arriva prima, con lo stesso
/// nome, senza maiuscole, e lo stesso colore; se arriva, con un nome già
/// preso o che si legge come un colore, prende il primo nome libero. Ciò
/// che nessuno usa resta fuori. Niente trasloco se l'SVG ha fogli di stile,
/// che possono rimandare alle risorse, o se il disegno supererebbe il
/// limite delle risorse, o senza `allowed`: allora resta tutto com'era.
function liftOf(
  doc: XmlDocument,
  tops: readonly NodeId[],
  allowed: boolean,
  model: DocumentModel,
  ids: NewIds,
  names: Map<string, string>,
  renamed: Map<NodeId, string>,
): Lift {
  const resources = resourcesOf(model);
  const byId = holdersById(doc);
  // Un riferimento a un id che l'SVG non ha va alla risorsa del disegno che
  // lo porta, se c'è.
  const outside: Resolve = (id) => {
    const node = byId.has(id) ? undefined : resources.get(id);
    return node === undefined ? null : resourceKind(node.facts.local);
  };
  const none: Lift = { defs: new Set(), moved: [], decided: new Set(), named: new Map(), colors: new Map(), resolve: outside, written: outside };
  const defs = new Set(tops.filter((top) => classifyChild(doc, top, "root", 1)?.[1] === "defs"));
  if (!allowed || defs.size === 0 || doc.nodes.some((node) => node.kind === "element" && isSvg(node, "style"))) return none;
  const index = resourceIndex(doc);
  const decided = new Set<NodeId>();
  for (const top of defs) for (const at of subtree(doc, top)) decided.add(at);
  const refsIn = (id: NodeId): string[] => [...subtree(doc, id)].flatMap((at) => referencesOf(doc, doc.element(at)!));
  // Il figlio di una `defs` che porta l'elemento `holder`.
  const movedOf = (holder: NodeId): NodeId | null => {
    for (let at = holder; ; ) {
      const parent = doc.nodes[at]!.parent;
      if (parent === null) return null;
      if (defs.has(parent)) return at;
      at = parent;
    }
  };
  const moved: NodeId[] = [];
  const seen = new Set<NodeId>();
  // In profondità e senza ricorsione: una catena di rimandi può essere
  // lunga quanto il file.
  const visit = (refs: readonly string[]): void => {
    const stack: Array<{ readonly refs: readonly string[]; at: number; readonly child: NodeId | null }> = [{ refs, at: 0, child: null }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      if (frame.at === frame.refs.length) {
        stack.pop();
        if (frame.child !== null) moved.push(frame.child);
        continue;
      }
      const holder = byId.get(frame.refs[frame.at++]!);
      const child = holder === undefined ? null : movedOf(holder);
      if (child === null || seen.has(child)) continue;
      seen.add(child);
      stack.push({ refs: refsIn(child), at: 0, child });
    }
  };
  for (const top of tops) if (!defs.has(top)) visit(refsIn(top));

  // I campioni del disegno, e poi quelli che arrivano con l'id che avranno.
  const swatches: Array<{ readonly id: string; readonly name: string; readonly color: string }> = [];
  for (const [id, node] of resources) {
    const swatch = node.details?.swatch;
    if (swatch !== undefined) swatches.push({ id, ...swatch });
  }
  const named = new Map<NodeId, string>();
  const colors = new Map<string, string>();
  // Le punte del disegno, per il loro testo senza id; si leggono quando ne
  // arriva una.
  let tips: Map<string, string> | null = null;
  const tipOf = (text: string): string | undefined => {
    if (tips === null) {
      tips = new Map();
      for (const [id, node] of resources) {
        if (node.kind !== "leaf" || markerTip(node) === null) continue;
        const key = withoutId(node.raw);
        if (!tips.has(key)) tips.set(key, id);
      }
    }
    return tips.get(withoutId(text));
  };

  // Gli id, prima ciò che si usa e poi chi lo usa.
  const local = new Map<string, string>();
  const fresh = new Map<NodeId, string>();
  const kinds = new Map<string, ResourceKind>();
  const out: NodeId[] = [];
  let copies = 0;
  for (const child of moved) {
    const element = doc.element(child)!;
    const id = valueOf(element, NS_NONE, "id") ?? "";
    const kind = byId.get(id) === child ? index.get(id) : undefined;
    let arriving: SwatchFacts | null = null;
    if (kind !== undefined) {
      kinds.set(id, kind);
      const there = resources.get(id);
      const swatch = valueOf(element, NS_FUB, "role") === "swatch" ? swatchOf(doc, element) : null;
      if (swatch !== null) {
        const key = nameKey(swatch.name);
        const own = there?.details?.swatch;
        const kept = own !== undefined ? { id, ...own } : swatches.find((other) => other.color === swatch.color && nameKey(other.name) === key);
        if (kept !== undefined) {
          local.set(id, kept.id);
          colors.set(kept.id, kept.color);
          continue;
        }
        arriving = swatch;
      }
      // Una punta della raccolta è quella del disegno che le somiglia, col
      // campione che usa già col nome che avrà: i campioni arrivano prima.
      if (element.local === "marker" && valueOf(element, NS_FUB, "role") === "shared" && valueOf(element, NS_FUB, "marker") !== undefined) {
        const text = doc.source.text.slice(element.start, element.end);
        const kept = tipOf(text.replace(/url\(#([^)\s]+)\)/g, (whole, ref: string) => (local.has(ref) ? `url(#${local.get(ref)!})` : whole)));
        if (kept !== undefined) {
          local.set(id, kept);
          continue;
        }
      }
      const same =
        there !== undefined &&
        valueOf(element, NS_FUB, "role") !== "private" &&
        there.facts.local === element.local &&
        compact(there.raw) === compact(doc.source.text.slice(element.start, element.end)) &&
        refsIn(child).every((ref) => local.get(ref) === ref || movedOf(byId.get(ref) ?? child) === child);
      if (same) {
        local.set(id, id);
        continue;
      }
      copies++;
    }
    out.push(child);
    for (const at of subtree(doc, child)) {
      const value = valueOf(doc.element(at)!, NS_NONE, "id") ?? "";
      if (value === "") continue;
      const next = ids.next("resource");
      fresh.set(at, next);
      if (!local.has(value)) local.set(value, next);
    }
    if (arriving !== null) {
      const clean = cleanName(arriving.name);
      const name = swatchNameProblem(swatches, clean) === null ? arriving.name : freshSwatchName(swatches, clean === "" ? t("draw.colors.form.default") : clean);
      if (name !== arriving.name) named.set(child, name);
      swatches.push({ id: fresh.get(child)!, name, color: arriving.color });
    }
  }
  if (resources.size + copies > MAX_RESOURCES) return none;
  for (const [from, to] of local) if (!names.has(from)) names.set(from, to);
  for (const [at, to] of fresh) renamed.set(at, to);
  const written = new Map<string, ResourceKind>();
  for (const [id, kind] of kinds) written.set(names.get(id)!, kind);
  return {
    defs,
    moved: out,
    decided,
    named,
    colors,
    resolve: (id) => kinds.get(id) ?? outside(id),
    written: (id) => written.get(id) ?? outside(id),
  };
}

/// Gli `add` di un incolla: testi fratelli uniti in sequenze, finché il loro
/// JSON sta in [`CHUNK_BYTES`].
class Adds {
  private parent: string | null = null;
  private texts: string[] = [];
  private bytes = 0;
  private gap = "";

  constructor(private readonly ops: Op[]) {}

  push(parent: string, gap: string, text: string, bytes: number): void {
    if (this.parent !== parent || this.bytes + bytes > CHUNK_BYTES) this.flush();
    this.parent = parent;
    this.gap = gap;
    this.texts.push(text);
    this.bytes += bytes + jsonBytes(gap);
  }

  /// Un'operazione dopo gli `add` fin qui.
  then(op: Op): void {
    this.flush();
    this.ops.push(op);
  }

  flush(): void {
    if (this.parent !== null && this.texts.length > 0) {
      this.ops.push({ op: "add", parent: this.parent, pos: { last: true }, raw: this.texts.join(this.gap) });
    }
    this.parent = null;
    this.texts = [];
    this.bytes = 0;
  }
}


/// I passi dell'incolla di `source` in `target`. Rende la parte fatta, fra 0
/// e 1, di tanto in tanto fra un elemento e l'altro, così l'editor può
/// mostrarla e lasciar respirare la pagina; alla fine, il piano.
export function* planPaste(source: PasteSource, target: PasteTarget): Generator<number, PastePlan> {
  const { doc } = source;
  const { model, container, ids } = target;
  const root = doc.element(doc.root)!;
  const total = Math.max(1, doc.source.text.length);
  let done = 0;
  /// La parte fatta fino a `at`, se è cresciuta almeno di un centesimo.
  const progress = (at: number): number | null => {
    if (at - done < total / 100) return null;
    done = at;
    return done / total;
  };
  // Dalle coordinate dell'SVG alla scena: la misura vera resta, e fra unità
  // uguali è una traslazione.
  const px = fromPx(model, target.delta);
  const content = snapped(compose(target.to.inverse, snapped(compose(px, source.toPx))));
  const bounds = mappedBounds(source.frame, px);
  const scope = scopeOf(container);
  const siblings = elementChildren(container);
  const indent = siblings.length > 0 ? indentOf(model, siblings[siblings.length - 1]!) : `${indentOf(model, container)}  `;
  const place = placeOf(container);
  const depth = container.depth + 1;
  // Gli attributi che il contenitore e i suoi antenati scrivono: chi entra e
  // prendeva un attributo ereditato dal suo valore di partenza lo scrive.
  const passed = new Set<string>();
  for (let at: ContainerNode | null = container; at !== null; at = at.parent) for (const name of plainAttributes(at).keys()) passed.add(name);
  const initial = (element: ElementNode, names: readonly string[], set: Map<string, string | null>): void => {
    for (const name of names) {
      if (!passed.has(name) || valueOf(element, NS_NONE, name) !== undefined || set.has(name)) continue;
      const value = INITIAL[name];
      if (value !== undefined) set.set(name, value);
    }
  };

  // Gli id nuovi, uno per elemento; un riferimento va al primo elemento con
  // quell'id, come in un browser. La radice di un SVG che entra in un gruppo
  // è il gruppo che porta i suoi attributi.
  const wrap = source.pieces.length === 0;
  const tops = wrap ? root.children.filter((child) => doc.element(child) !== null && !source.dropped.has(child)) : source.pieces;
  const inner = wrap ? innerAttributes(root) : [];
  const group = wrap ? ids.next("object") : null;
  const sheetScope = inner.length > 0 ? ids.next("object") : group;
  const renamed = new Map<NodeId, string>();
  const names = new Map<string, string>();
  const rootId = valueOf(root, NS_NONE, "id") ?? "";
  if (wrap && rootId !== "") names.set(rootId, sheetScope!);
  // Dentro un gruppo che resta estraneo non si cercano modificabili, e
  // allora nemmeno risorse.
  const lift = liftOf(doc, tops, inner.length === 0, model, ids, names, renamed);
  for (const top of tops) {
    for (const at of subtree(doc, top)) {
      if (lift.decided.has(at)) continue;
      const value = valueOf(doc.element(at)!, NS_NONE, "id") ?? "";
      if (value === "") continue;
      const id = ids.next("object");
      renamed.set(at, id);
      if (!names.has(value)) names.set(value, id);
    }
  }
  const rewriter = new Rewriter(doc, {
    rename: (id) => names.get(id) ?? null,
    relink: true,
    ids: renamed,
    named: lift.named,
    colors: lift.colors,
    sheets: wrap ? sheetScope : null,
    href: target.href,
    resolve: lift.resolve,
    written: lift.written,
  });
  const sourceScope = scopeInside(NamespaceScope.EMPTY, root);
  const ops: Op[] = [...target.to.prelude];
  const adds = new Adds(ops);

  // Le risorse prima di chi le usa, in fondo alla `defs` del disegno.
  if (lift.moved.length > 0) {
    const home = homeOf(model);
    for (const op of home.prelude) adds.then(op);
    const there = resourceHome(model);
    const homeScope = scopeOf(there ?? model.root);
    const children = there === null ? [] : elementChildren(there);
    const first = elementChildren(model.root)[0];
    const outer = there !== null ? indentOf(model, there) : first !== undefined ? indentOf(model, first) : "";
    const homeIndent = children.length > 0 ? indentOf(model, children[children.length - 1]!) : `${outer}  `;
    for (const child of lift.moved) {
      const element = doc.element(child)!;
      const from = doc.source.indent(element.start);
      rewriter.used.clear();
      rewriter.body(child, true);
      const declarations = needed(scopeOfChain(ancestors(doc, child)), homeScope, rewriter.used, element);
      rewriter.head(child, { set: new Map(), before: null, canonical: false, unlayer: false, declarations, id: null, child: null }, from);
      const text = reindent(rewriter.slice(element.start, element.end), homeScope, "defs", 2, from, homeIndent, lift.written);
      adds.push(home.parent, `\n${homeIndent}`, text, jsonBytes(text));
      const step = progress(element.end);
      if (step !== null) yield step;
    }
    adds.flush();
  }

  if (!wrap) {
    const keys: string[] = [];
    const tag = sourceScope.svgName("title") ?? "title";
    for (const piece of source.pieces) {
      if (lift.defs.has(piece)) continue;
      const element = doc.element(piece)!;
      const missing: NodeId[] = [];
      const found = rolesUnder(doc, piece, "inside", depth, false, missing, lift.resolve);
      for (const at of missing) rewriter.fresh.set(at, ids.next("object"));
      const layer = found !== null && isSvg(element, "g") && valueOf(element, NS_FUB, "layer") !== undefined;
      const set = new Map<string, string | null>();
      let before: string | null = null;
      if (!isIdentity(content)) {
        const own = parseTransform(valueOf(element, NS_NONE, "transform") ?? "") ?? IDENTITY;
        if (found !== null) set.set("transform", transformValue(compose(content, own)));
        else if (renders(element)) before = formatTransform(content);
      }
      initial(element, inheritedOf(element, found), set);
      // Ciò che si vede riceve un id, per sceglierlo dopo.
      const given = renamed.has(piece) || !renders(element) ? null : ids.next("object");
      const title = layer && firstTitle(doc, element) === null ? valueOf(element, NS_FUB, "layer")! : "";
      const from = doc.source.indent(element.start);
      rewriter.used.clear();
      rewriter.body(piece, true);
      rewriter.head(
        piece,
        {
          set,
          before,
          canonical: found !== null && (set.size > 0 || layer),
          unlayer: layer,
          declarations: needed(sourceScope, scope, rewriter.used, element),
          id: given,
          child: title === "" ? null : `<${tag}>${escapeText(title)}</${tag}>`,
        },
        from,
      );
      const key = given ?? renamed.get(piece) ?? null;
      if (key !== null && renders(element)) keys.push(key);
      emit(rewriter, adds, piece, target.to.parent, key, from, indent, scope, place, depth);
      const step = progress(element.end);
      if (step !== null) yield step;
    }
    adds.flush();
    return { ops, keys, bounds };
  }

  // Un SVG che entra in un gruppo nuovo: il gruppo prende gli attributi
  // della radice che il formato gli ammette e la trasformazione dalla sua
  // misura; gli altri vanno su un gruppo dentro, che resta estraneo, e
  // allora dentro non si cercano modificabili. Lo spazio prima di ciò che
  // resta fuori va via con lui; un livello di un SVG di FubDraw diventa un
  // gruppo, come quando rientra da solo.
  const g = scope.svgName("g") ?? "g";
  const tag = scope.svgName("title") ?? "title";
  const layerTag = sourceScope.svgName("title") ?? "title";
  const parts: Array<{ readonly id: NodeId | null; readonly text: string }> = [];
  const missing: NodeId[] = [];
  let blank = -1;
  for (const child of root.children) {
    const node = doc.nodes[child]!;
    if (source.dropped.has(child) || lift.defs.has(child)) {
      if (blank >= 0) parts.splice(blank, 1);
      blank = -1;
      continue;
    }
    if (node.kind === "text" && node.blank) {
      blank = parts.length;
      parts.push({ id: null, text: lf(doc.source.text.slice(node.start, node.end)) });
      continue;
    }
    blank = -1;
    if (node.kind === "element") {
      const found = inner.length === 0 ? rolesUnder(doc, child, "inside", depth + 1, true, missing, lift.resolve) : null;
      for (const at of missing) rewriter.fresh.set(at, ids.next("object"));
      missing.length = 0;
      const layer = source.fubdraw && found !== null && isSvg(node, "g") && valueOf(node, NS_FUB, "layer") !== undefined;
      rewriter.body(child, layer);
      if (layer) {
        const title = firstTitle(doc, node) === null ? `<${layerTag}>${escapeText(valueOf(node, NS_FUB, "layer")!)}</${layerTag}>` : null;
        const fresh = rewriter.fresh.get(child) ?? null;
        rewriter.head(child, { set: new Map(), before: null, canonical: true, unlayer: true, declarations: [], id: fresh, child: title }, doc.source.indent(node.start));
      }
      parts.push({ id: child, text: rewriter.slice(node.start, node.end) });
      const step = progress(node.end);
      if (step !== null) yield step;
    } else if (node.kind === "entity-ref") {
      parts.push({ id: null, text: escapeText(doc.plainEntity(node.name)!) });
    } else {
      parts.push({ id: null, text: lf(doc.source.text.slice(node.start, node.end)) });
    }
  }

  const values = rewriter.values(doc.root);
  const written = attributesOf(doc, root);
  const textOf = (index: number): string => values.get(index) ?? written[index]!.text;
  const attrs: OutAttr[] = [{ name: "id", uri: "", local: "id", text: group! }];
  root.attrs.forEach((attr, index) => {
    if (attr.ns === NS_XML) attrs.push({ ...written[index]!, text: textOf(index) });
    else if (attr.ns === NS_NONE && admitted(attr)) attrs.push({ ...written[index]!, text: escapeAttribute(attr.value) });
  });
  const transform = transformValue(content);
  if (transform !== null) attrs.push({ name: "transform", uri: "", local: "transform", text: transform });
  const set = new Map<string, string | null>();
  initial(root, INHERITED, set);
  for (const [name, value] of set) attrs.push({ name, uri: "", local: name, text: escapeAttribute(value!) });
  for (const [prefix, uri] of needed(sourceScope, scope, rewriter.used, null)) {
    attrs.push({ name: prefix === null ? "xmlns" : `xmlns:${prefix}`, uri: XMLNS_URI, local: prefix ?? "xmlns", text: escapeAttribute(uri) });
  }
  const head = writeOpenTag({ name: g, group: true, attrs: canonicalOrder(attrs), children: [], text: null }, false);
  // Il gruppo prende per nome il titolo dell'SVG, o il nome del file: il
  // titolo della radice lo è già se entra fra i figli del gruppo.
  const titled = root.children.find((child) => {
    const element = doc.element(child);
    return element !== null && isSvg(element, "title");
  });
  const kept = inner.length === 0 && titled !== undefined && !source.dropped.has(titled);
  const name = kept ? null : (firstTitle(doc, root) ?? source.name);
  const title = name === null || name === "" ? null : `<${tag}>${escapeText(name)}</${tag}>`;
  const body = parts.map((part) => part.text).join("");
  let whole = `${head}${title === null ? "" : `\n  ${title}`}`;
  if (inner.length > 0) {
    let open = `<${g} id="${sheetScope!}"`;
    for (const index of inner) open += ` ${root.attrs[index]!.name}="${textOf(index)}"`;
    whole += `\n  ${open}>${body}</${g}>\n</${g}>`;
  } else {
    whole += `${body}</${g}>`;
  }
  const text = reindent(whole, scope, place, depth, "", indent, lift.written);
  const bytes = jsonBytes(text);
  if (bytes <= CHUNK_BYTES || inner.length > 0) {
    adds.push(target.to.parent, `\n${indent}`, text, bytes);
  } else {
    // Troppo grande per un'operazione sola: il gruppo vuoto, poi i suoi
    // figli a sequenze. Ciò che non è un elemento, fra loro, resta fuori.
    const empty = `${head.slice(0, -1)}/>`;
    adds.push(target.to.parent, `\n${indent}`, empty, jsonBytes(empty));
    const inside = scopeInside(scope, readOpen(empty, scope));
    const childIndent = `${indent}  `;
    if (title !== null) adds.push(group!, `\n${childIndent}`, title, jsonBytes(title));
    for (const part of parts) {
      if (part.id === null) continue;
      const from = doc.source.indent(doc.nodes[part.id]!.start);
      emit(rewriter, adds, part.id, group!, rewriter.idOf(part.id), from, childIndent, inside, "inside", depth + 1);
    }
  }
  adds.flush();
  return { ops, keys: [group!], bounds };
}

/// L'elemento del tag `open`, scritto da solo dove vale `scope`.
function readOpen(open: string, scope: NamespaceScope): ElementNode {
  const fragment = parseFragment(open, scope)!;
  return fragment.doc.element(fragment.id)!;
}

/// Vero se un attributo della radice di un SVG incollato va sul gruppo che la
/// sostituisce: uno degli attributi ereditati, l'opacità o la visibilità,
/// con un valore che il formato ammette su un gruppo.
function admitted(attr: Attr): boolean {
  if (!INHERITED.includes(attr.local) && attr.local !== "opacity" && attr.local !== "display") return false;
  return !/url\(/i.test(attr.value) && svgAttribute("g", attr.local, attr.value);
}

/// Gli indici degli attributi della radice di un SVG incollato che vanno sul
/// gruppo dentro: quelli senza namespace che il gruppo nuovo non ammette e
/// che non valgono solo sulla radice. Uno `style` che dice soltanto
/// `enable-background`, che nessun programma disegna più, resta fuori.
function innerAttributes(root: ElementNode): number[] {
  const out: number[] = [];
  root.attrs.forEach((attr, index) => {
    if (attr.ns !== NS_NONE || attr.local === "id" || ROOT_ONLY.has(attr.local) || admitted(attr)) return;
    if (attr.local === "style" && attr.value.split(";").every((part) => part.trim() === "" || /^\s*enable-background\s*:/i.test(part))) return;
    out.push(index);
  });
  return out;
}

/// Il testo di `id`, con le modifiche, nel rientro `indent` di chi riceve: in
/// un `add`, o, se è un contenitore modificabile troppo grande, il suo tag
/// vuoto e poi i figli, ognuno allo stesso modo. `key` è il suo id dopo,
/// `from` il rientro della sua riga.
function emit(
  rewriter: Rewriter,
  adds: Adds,
  id: NodeId,
  parent: string,
  key: string | null,
  from: string,
  indent: string,
  scope: NamespaceScope,
  place: Place,
  depth: number,
): void {
  const doc = rewriter.doc;
  const element = doc.element(id)!;
  const text = reindent(rewriter.slice(element.start, element.end), scope, place, depth, from, indent, rewriter.rules.written);
  const bytes = jsonBytes(text);
  const found = bytes > CHUNK_BYTES ? classifyChild(doc, id, place, depth, rewriter.rules.resolve) : null;
  if (key === null || found === null || !isContainer(found[1]) || element.closeStart === null) {
    adds.push(parent, `\n${indent}`, text, bytes);
    return;
  }
  // In un contenitore bloccato non si aggiunge: il blocco arriva dopo i
  // figli.
  const locked = valueOf(element, NS_FUB, "locked") === "true";
  let empty = `${rewriter.slice(element.start, element.openEnd).slice(0, -1)}/>`;
  if (locked) empty = unlocked(empty, scope);
  adds.push(parent, `\n${indent}`, empty, jsonBytes(empty));
  const inside = scopeInside(scope, readOpen(empty, scope));
  const childIndent = `${indent}  `;
  const added = rewriter.added.get(id);
  if (added !== undefined) adds.push(key, `\n${childIndent}`, added, jsonBytes(added));
  for (const child of element.children) {
    const node = doc.element(child);
    if (node === null) continue;
    emit(rewriter, adds, child, key, rewriter.idOf(child), doc.source.indent(node.start), childIndent, inside, "inside", depth + 1);
  }
  if (locked) adds.then({ op: "set", id: key, attrs: { "fub:locked": "true" } });
}

/// Il tag `open`, scritto dove vale `scope`, senza `fub:locked`.
function unlocked(open: string, scope: NamespaceScope): string {
  const element = readOpen(open, scope);
  const attr = element.attrs.find((at) => at.ns === NS_FUB && at.local === "locked");
  if (attr === undefined) return open;
  const end = attr.raw[1] + 1 - element.start;
  const name = open.lastIndexOf(attr.name, attr.raw[0] - element.start);
  return open.slice(0, name).trimEnd() + open.slice(end);
}
