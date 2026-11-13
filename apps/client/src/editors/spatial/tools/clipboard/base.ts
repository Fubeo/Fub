// Gli appunti dei disegni, la base: il tipo dell'SVG negli appunti, i limiti,
// le misure della copia e le visite dell'albero XML che copiare e incollare
// condividono (`../clipboard.ts`).

import { formatNumber, formatShortest } from "../../number";
import { NON_RENDERING } from "../../painter/paint";
import { isContainer, type Role } from "../../scene/analysis";
import { classifyChild, type Place, type Resolve, type Tag } from "../../scene/classify";
import type { Bounds } from "../../scene/geometry";
import { IDENTITY, type Matrix } from "../../scene/matrix";
import { declarationsOf } from "../../scene/model";
import { MAX_OP_BYTES } from "../../scene/ops";
import { NamespaceScope, scopeInside } from "../../scene/serialize";
import { length, numberList, scanNumber, trim } from "../../scene/values";
import { isSvg, NS_FUB, NS_NONE, NS_SVG, NS_XML, valueOf, type ElementNode, type NodeId, type XmlDocument } from "../../scene/xml";
import { INHERITED } from "../arrange";
import { inheritedBy } from "../place";

/// Il tipo di un SVG negli appunti.
export const SVG_TYPE = "image/svg+xml";

/// Il JSON di un `add` dell'incolla, al più: la metà del limite di
/// un'operazione, così nessuna gli si avvicina. Un elemento estraneo più
/// grande va da solo, perché non si divide.
export const CHUNK_BYTES = MAX_OP_BYTES / 2;

/// Il lato più corto del `viewBox` copiato, in unità del disegno.
export const MIN_SIDE = 1;

/// Quanto un numero della matrice fra due disegni può scostarsi da un intero
/// e valere quell'intero: le misure lette e riscritte non tornano esatte.
export const SNAP = 1e-9;

/// Gli attributi che valgono solo sulla radice: la misura, la vista, la
/// versione. Il gruppo di un SVG incollato li sostituisce con la sua
/// trasformazione.
export const ROOT_ONLY: ReadonlySet<string> = new Set([
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
export const IDREFS: ReadonlySet<string> = new Set([
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
export const ANIMATIONS: ReadonlySet<string> = new Set(["animate", "animateMotion", "animateTransform", "set", "discard"]);

/// Un `id.evento` in `begin` o `end`: l'id, con i suoi escape, prima del
/// punto.
export const TIMING = /(^|;)(\s*)((?:[^\s;.\\]|\\.)+)\.(?=[A-Za-z])/g;

/// Un riferimento a un'entità che non è una delle cinque di XML né un
/// carattere.
export const ENTITY = /&(?!(?:lt|gt|amp|quot|apos);|#)/;

/// Le forme del formato: contano gli attributi ereditati del colore e del
/// contorno, non quelli del carattere.
export const SHAPES: ReadonlySet<string> = new Set(["path", "rect", "ellipse", "circle", "line", "polyline", "polygon"]);

/// I figli della radice di un SVG di FubDraw che sono del documento e non
/// del disegno: titolo, descrizione, metadati.
export const DOCUMENT_PARTS: ReadonlySet<string> = new Set(["title", "desc", "metadata"]);

/// Un'entità che non si sostituisce: il suo testo ha marcatura o altri
/// riferimenti.
export class Unresolved extends Error {}

// ---------------------------------------------------------------------------
// Misure.
// ---------------------------------------------------------------------------

/// Il `viewBox` letto; `null` se manca o ha un lato che non è positivo.
export function viewBoxOf(value: string | undefined): [number, number, number, number] | null {
  const list = value === undefined ? null : numberList(value);
  if (list === null || list.length !== 4 || !(list[2]! > 0) || !(list[3]! > 0)) return null;
  return [list[0]!, list[1]!, list[2]!, list[3]!];
}

/// Una lunghezza positiva in pixel CSS; `null` se non lo è.
export function positive(value: string | undefined): number | null {
  const px = value === undefined ? null : length(value);
  return px !== null && px > 0 ? px : null;
}

/// Quanti pixel CSS vale un'unità utente della radice, per asse: dalla
/// misura e dal `viewBox`; uno, cioè un pixel, se manca l'una o l'altro.
export function unitScale(attr: (name: string) => string | undefined): [number, number] {
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
export function copiedSize(value: string | undefined, span: number | undefined, side: number): string {
  const px = positive(value);
  if (px === null || span === undefined) return formatShortest(side);
  const text = trim(value!);
  const [number, end] = scanNumber(text, 0)!;
  return `${formatShortest((side * number) / span)}${text.slice(end)}`;
}

/// La misura del riquadro in cui si vede un SVG, in pixel CSS: `width` e
/// `height`, le proporzioni del `viewBox` per quella che manca, o 300 × 150
/// come in un browser.
export function viewport(attr: (name: string) => string | undefined, box: readonly number[] | null): [number, number] {
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
export function snapped(m: Matrix): Matrix {
  return m.map((v) => (Math.abs(v - Math.round(v)) < SNAP ? Math.round(v) + 0 : v)) as unknown as Matrix;
}

export function isIdentity(m: Matrix): boolean {
  return m.every((v, i) => v === IDENTITY[i]);
}

/// Il `viewBox` copiato: il riquadro, largo almeno [`MIN_SIDE`], coi bordi
/// arrotondati verso l'esterno a due decimali.
export function copiedBox(bounds: Bounds): [number, number, number, number] {
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
export function elementAt(doc: XmlDocument, path: readonly number[]): NodeId | null {
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
export function within(doc: XmlDocument, id: NodeId, set: ReadonlySet<NodeId>): boolean {
  for (let at = doc.nodes[id]!.parent; at !== null; at = doc.nodes[at]!.parent) if (set.has(at)) return true;
  return false;
}

/// Gli antenati di `id`, dal genitore alla radice.
export function ancestors(doc: XmlDocument, id: NodeId): ElementNode[] {
  const out: ElementNode[] = [];
  for (let at = doc.nodes[id]!.parent; at !== null; at = doc.nodes[at]!.parent) {
    const element = doc.element(at);
    if (element !== null) out.push(element);
  }
  return out;
}

/// Lo scope in vigore dentro `chain`, gli antenati dal genitore alla radice.
export function scopeOfChain(chain: readonly ElementNode[]): NamespaceScope {
  let scope = NamespaceScope.EMPTY;
  for (let i = chain.length - 1; i >= 0; i--) scope = scopeInside(scope, chain[i]!);
  return scope;
}

/// Gli elementi del sottoalbero di `id`, lui compreso, nell'ordine del
/// documento.
export function* subtree(doc: XmlDocument, id: NodeId): Generator<NodeId> {
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
export function sheetText(doc: XmlDocument, element: ElementNode): [css: string, cdata: boolean] | null {
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
export function renders(element: ElementNode): boolean {
  return element.ns === NS_SVG && !NON_RENDERING.has(element.local);
}

export function hasId(element: ElementNode): boolean {
  return (valueOf(element, NS_NONE, "id") ?? "") !== "";
}

/// Gli attributi ereditati che contano per `element`, modificabile col ruolo
/// di `found` o estraneo: per un estraneo che non è una forma tutti, perché
/// può disegnare figli o ciò a cui rimanda.
export function inheritedOf(element: ElementNode, found: readonly [Tag, Role] | null): readonly string[] {
  if (found !== null) return inheritedBy(element.local, isContainer(found[1]));
  if (!renders(element) || element.local === "image") return [];
  return SHAPES.has(element.local) ? inheritedBy(element.local, false) : INHERITED;
}

/// Il ruolo di `id` come figlio di un contenitore al posto `place`, a
/// profondità `depth`, e gli elementi modificabili che hanno
/// bisogno di un id: tutti tranne titoli e descrizioni, sotto di lui e, con
/// `top`, lui stesso. `resolve` dice quali id saranno risorse del disegno.
export function rolesUnder(doc: XmlDocument, id: NodeId, place: Place, depth: number, top: boolean, missing: NodeId[], resolve: Resolve): [Tag, Role] | null {
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
export function holdsForeign(doc: XmlDocument, id: NodeId, place: Place, depth: number, resolve: Resolve): boolean {
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
export function needed(from: NamespaceScope, to: NamespaceScope, used: ReadonlySet<string | null>, element: ElementNode | null): Array<[string | null, string]> {
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
export function holdersById(doc: XmlDocument): Map<string, NodeId> {
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
export function referencesOf(doc: XmlDocument, element: ElementNode): string[] {
  const out: string[] = [];
  const urls = (text: string): void => {
    for (const match of text.matchAll(/url\(\s*(["']?)#([^"')\s]+)\1\s*\)/gi)) out.push(match[2]!);
  };
  for (const attr of element.attrs) {
    if (attr.name === "xmlns" || attr.name.startsWith("xmlns:")) continue;
    if (/url\(/i.test(attr.value)) urls(attr.value);
    const fragment = /^#(.+)$/.exec(attr.value);
    if (fragment !== null && (attr.local === "href" || (attr.ns !== NS_NONE && attr.ns !== NS_XML))) out.push(fragment[1]!);
    // Lo stile che un oggetto segue, per id.
    else if (attr.ns === NS_FUB && attr.local === "style" && attr.value !== "") out.push(attr.value);
  }
  if (isSvg(element, "style")) urls(sheetText(doc, element)?.[0] ?? "");
  return out;
}
