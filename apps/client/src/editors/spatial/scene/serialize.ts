// La scrittura canonica di §7: come FubDraw scrive un elemento che crea o
// modifica.
//
// Un elemento per riga; gli attributi nell'ordine canonico; i figli nelle
// righe seguenti, due spazi più dentro; gruppi e livelli vuoti in forma
// aperta, ogni altro elemento senza figli chiuso con `/>`; il testo di `tspan`,
// `textPath`, `title` e `desc` sulla riga del tag. I valori che l'operazione non tocca si
// copiano come sono scritti nella sorgente, riferimenti compresi: un `set` di
// `transform` non riscrive `d`. Solo i valori nuovi passano dall'escape.
//
// Qui si scrive soltanto. Che un elemento sia ammesso dal formato lo decide
// la classificazione di §4 (`classify.ts`), che il motore delle operazioni
// applica al testo prodotto da qui: un controllo solo, lo stesso della
// lettura.
//
// Il testo prodotto è sempre a LF: il motore lo riporta sul terminatore
// prevalente del file.

import { formatNumber } from "../number";
import type { Segment } from "./geometry";
import type { Matrix } from "./matrix";
import {
  FUB_NS,
  isSvg,
  splitQName,
  SVG_NS,
  XLINK_NS,
  XML_URI,
  XMLNS_URI,
  type ElementNode,
  type NodeId,
  type XmlDocument,
} from "./xml";

/// Un elemento come lo descrive un'operazione della superficie. Gli
/// attributi con namespace si scrivono col prefisso convenzionale: `fub:` è
/// il namespace di FubDraw e `xlink:` quello di XLink in qualunque documento;
/// ogni altro prefisso è quello dichiarato nel documento.
export interface Elem {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  /// Per `g`, `a` e `text`, per la `defs`, le risorse e il loro contenuto;
  /// `title` e `desc` sono figli ammessi di qualunque elemento.
  readonly children?: readonly Elem[];
  /// Solo per `tspan`, `textPath`, `title` e `desc`.
  readonly text?: string | null;
  /// Solo per una riga di `text` o per il suo `textPath`, al posto di
  /// `text`: il suo testo coi pezzi.
  readonly runs?: readonly Run[];
}

/// Un pezzo di riga: una parte del testo con uno stile suo, un `tspan`
/// dentro la riga (§4).
export interface Piece {
  readonly text: string;
  readonly attrs: Readonly<Record<string, string>>;
}

/// Una parte di una riga: testo della riga o un pezzo.
export type Run = string | Piece;

/// Un elemento che non si può scrivere: la forma dell'operazione è sbagliata,
/// o un nome non ha namespace.
export class ElemError extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = "ElemError";
  }
}

/// Le primitive dei filtri (formato della scena, risorse).
const PRIMITIVES = [
  "feGaussianBlur",
  "feOffset",
  "feFlood",
  "feDropShadow",
  "feColorMatrix",
  "feComposite",
  "feBlend",
  "feMorphology",
  "feMerge",
];

/// Gli elementi che stanno solo dentro certi altri: una riga o il tracciato
/// nel suo testo, un punto nella sua sfumatura, una primitiva nel suo filtro.
const OWNERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["tspan", new Set(["text"])],
  ["textPath", new Set(["text"])],
  ["stop", new Set(["linearGradient", "radialGradient"])],
  ["feMergeNode", new Set(["feMerge"])],
  ...PRIMITIVES.map((tag): [string, ReadonlySet<string>] => [tag, new Set(["filter"])]),
]);

/// Gli elementi i cui figli sono elementi qualunque, fra quelli che non
/// stanno solo dentro un altro: dove vanno lo giudica la classificazione.
const OPEN_PARENTS: ReadonlySet<string> = new Set(["g", "a", "defs", "pattern", "marker", "clipPath", "mask"]);

/// I tag di §4, delle risorse e delle tavole (formato della scena, risorse e
/// tavole).
export const SCENE_TAGS: ReadonlySet<string> = new Set([
  "title",
  "desc",
  "view",
  "g",
  "a",
  "path",
  "rect",
  "ellipse",
  "circle",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "textPath",
  "image",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "pattern",
  "marker",
  "clipPath",
  "mask",
  "filter",
  "feMergeNode",
  ...PRIMITIVES,
]);

/// I tag che portano testo.
const TEXT_TAGS: ReadonlySet<string> = new Set(["title", "desc", "tspan", "textPath"]);

/// I prefissi convenzionali delle operazioni.
const CONVENTIONAL: ReadonlyMap<string, string> = new Map([
  ["fub", FUB_NS],
  ["xlink", XLINK_NS],
  ["xml", XML_URI],
]);

/// I namespace in vigore in un punto del documento: prefisso → URI, con
/// `null` per il namespace predefinito. `xml` è sempre legato.
export class NamespaceScope {
  private constructor(private readonly bindings: ReadonlyMap<string | null, string>) {}

  static readonly EMPTY = new NamespaceScope(new Map());

  /// Lo scope dentro un elemento che dichiara `declarations`.
  declare(declarations: Iterable<readonly [prefix: string | null, uri: string]>): NamespaceScope {
    const bindings = new Map(this.bindings);
    for (const [prefix, uri] of declarations) bindings.set(prefix, uri);
    return new NamespaceScope(bindings);
  }

  /// L'URI di `prefix`; `""` per il namespace predefinito non dichiarato,
  /// `null` per un prefisso non dichiarato.
  uri(prefix: string | null): string | null {
    if (prefix === "xml") return XML_URI;
    const uri = this.bindings.get(prefix);
    if (prefix === null) return uri ?? "";
    // `xmlns:p=""` non è ammesso, ma uno scope costruito a mano potrebbe
    // averlo: un prefisso legato a niente non è legato.
    return uri === undefined || uri === "" ? null : uri;
  }

  /// Il prefisso con cui scrivere un attributo nel namespace `uri`: quello
  /// convenzionale se è legato lì, altrimenti il primo in ordine alfabetico.
  /// `null` se nessun prefisso è legato a `uri`.
  attributePrefix(uri: string): string | null {
    if (uri === XML_URI) return "xml";
    for (const [prefix, conventional] of CONVENTIONAL) {
      if (conventional === uri && this.uri(prefix) === uri) return prefix;
    }
    const candidates = [...this.bindings.keys()].filter(
      (prefix): prefix is string => prefix !== null && this.uri(prefix) === uri,
    );
    candidates.sort();
    return candidates[0] ?? null;
  }

  /// Il nome qualificato di un elemento SVG: senza prefisso se SVG è il
  /// namespace predefinito, altrimenti con un prefisso legato a SVG.
  svgName(local: string): string | null {
    if (this.uri(null) === SVG_NS) return local;
    const prefix = this.attributePrefix(SVG_NS);
    return prefix === null ? null : `${prefix}:${local}`;
  }

  /// Le associazioni in vigore, per costruire un documento che le dichiari.
  entries(): Array<[string | null, string]> {
    return [...this.bindings];
  }
}

// ---------------------------------------------------------------------------
// Escape.
// ---------------------------------------------------------------------------

/// Vero se `text` ha solo caratteri che XML 1.0 ammette: niente controlli
/// tranne tabulazione e a capo, niente surrogati isolati, niente U+FFFE e
/// U+FFFF.
export function isXmlText(text: string): boolean {
  return !/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/u.test(text);
}

const ATTRIBUTE_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "\t": "&#9;",
  "\n": "&#10;",
  "\r": "&#13;",
};

/// Un valore d'attributo fra virgolette doppie (§7, punto 5). Tabulazioni e
/// a capo diventano riferimenti, perché il parser li trasformerebbe in spazi.
export function escapeAttribute(value: string): string {
  return value.replace(/[&<>"\t\n\r]/g, (c) => ATTRIBUTE_ESCAPES[c]!);
}

/// Il testo di `tspan`, `title` e `desc` (§7, punto 5): `&`, `<` e `>`. Un
/// `\r` diventa `&#13;`, perché il parser lo trasformerebbe in un a capo.
export function escapeText(value: string): string {
  return value.replace(/[&<>\r]/g, (c) => (c === "\r" ? "&#13;" : ATTRIBUTE_ESCAPES[c]!));
}

// ---------------------------------------------------------------------------
// Ordine degli attributi.
// ---------------------------------------------------------------------------

const FUB_ORDER = ["layer", "role", "name", "marker", "board", "tool", "shape", "geom", "wrap", "join", "locked", "at", "brush"];
const GEOMETRY_ORDER = [
  "x",
  "y",
  "dx",
  "dy",
  "cx",
  "cy",
  "r",
  "fx",
  "fy",
  "width",
  "height",
  "rx",
  "ry",
  "x1",
  "y1",
  "x2",
  "y2",
  "points",
  "d",
  // Dove comincia un testo su tracciato (formato della scena, testo).
  "startOffset",
  // La geometria delle risorse.
  "offset",
  "refX",
  "refY",
  "markerWidth",
  "markerHeight",
  "orient",
  "viewBox",
];
/// Le unità e le trasformazioni delle risorse, poi gli attributi delle
/// primitive dei filtri.
const RESOURCE_ORDER = [
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "patternUnits",
  "patternContentUnits",
  "patternTransform",
  "markerUnits",
  "clipPathUnits",
  "maskUnits",
  "maskContentUnits",
  "filterUnits",
  "primitiveUnits",
  "in",
  "in2",
  "result",
  "type",
  "values",
  "operator",
  "k1",
  "k2",
  "k3",
  "k4",
  "mode",
  "stdDeviation",
  "radius",
];
const PRESENTATION_ORDER = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "marker-start",
  "marker-mid",
  "marker-end",
  "clip-path",
  "clip-rule",
  "mask",
  "filter",
  "opacity",
  "style",
  "display",
  "stop-color",
  "stop-opacity",
  "flood-color",
  "flood-opacity",
  "color-interpolation-filters",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "text-decoration",
  "text-anchor",
  "preserveAspectRatio",
];

/// Un attributo pronto da scrivere.
export interface OutAttr {
  /// Il nome qualificato con cui si scrive.
  readonly name: string;
  /// Il namespace; `""` per nessun namespace.
  readonly uri: string;
  readonly local: string;
  /// Il valore così come va fra virgolette doppie: già con gli escape.
  readonly text: string;
}

/// Il gruppo e il posto di un attributo nell'ordine canonico (§7, punto 2);
/// `null` per gli attributi che restano nell'ordine originale.
function rank(attr: OutAttr): [group: number, slot: number] | null {
  if (attr.uri === "") {
    if (attr.local === "id") return [0, 0];
    const geometry = GEOMETRY_ORDER.indexOf(attr.local);
    if (geometry >= 0) return [2, geometry];
    const resource = RESOURCE_ORDER.indexOf(attr.local);
    if (resource >= 0) return [3, resource];
    const presentation = PRESENTATION_ORDER.indexOf(attr.local);
    if (presentation >= 0) return [4, presentation];
    if (attr.local === "transform") return [5, 0];
    if (attr.local === "href") return [5, 1];
    return null;
  }
  if (attr.uri === FUB_NS) {
    if (attr.local === "ink") return [7, 0];
    const fub = FUB_ORDER.indexOf(attr.local);
    return fub >= 0 ? [1, fub] : null;
  }
  if (attr.uri === XLINK_NS && attr.local === "href") return [5, 2];
  return null;
}

/// Gli attributi nell'ordine canonico: `id`; gli attributi `fub:` noti; la
/// geometria; le unità delle risorse e gli attributi delle primitive; la
/// presentazione; `transform` e `href`; gli sconosciuti e quelli di altri
/// namespace nell'ordine in cui arrivano; `fub:ink`.
export function canonicalOrder(attrs: readonly OutAttr[]): OutAttr[] {
  const keyed = attrs.map((attr, index) => {
    const [group, slot] = rank(attr) ?? [6, index];
    return { attr, group, slot };
  });
  keyed.sort((a, b) => a.group - b.group || a.slot - b.slot);
  return keyed.map((k) => k.attr);
}

// ---------------------------------------------------------------------------
// Scrittura.
// ---------------------------------------------------------------------------

/// Un elemento pronto da scrivere, con gli attributi già in ordine.
export interface OutElement {
  readonly name: string;
  /// Vero per `g`: gruppi e livelli vuoti restano in forma aperta.
  readonly group: boolean;
  readonly attrs: readonly OutAttr[];
  readonly children: readonly OutElement[];
  /// Il contenuto di `tspan`, `textPath`, `title` e `desc`, già con gli
  /// escape; `null` per gli altri.
  readonly text: string | null;
}

/// Il tag d'apertura, `<` e attributi senza la chiusura.
function openTag(element: OutElement): string {
  let tag = `<${element.name}`;
  for (const attr of element.attrs) tag += ` ${attr.name}="${attr.text}"`;
  return tag;
}

/// Il tag d'apertura intero di `element`, per riscrivere solo quello: `>` se
/// l'elemento ha un contenuto, `/>` se si chiude da sé.
export function writeOpenTag(element: OutElement, selfClosing: boolean): string {
  return openTag(element) + (selfClosing ? "/>" : ">");
}

/// La forma canonica di `element` a partire dalla colonna del suo tag:
/// `indent` è il rientro della riga su cui comincia, e i figli stanno due
/// spazi più dentro.
export function writeElement(element: OutElement, indent: string): string {
  const open = openTag(element);
  if (element.children.length > 0) {
    const inner = `${indent}  `;
    let out = `${open}>`;
    for (const child of element.children) out += `\n${inner}${writeElement(child, inner)}`;
    return `${out}\n${indent}</${element.name}>`;
  }
  if (element.text !== null && element.text !== "") return `${open}>${element.text}</${element.name}>`;
  if (element.group) return `${open}>\n${indent}</${element.name}>`;
  return `${open}/>`;
}

/// L'URI e il nome locale di una chiave d'attributo di un'operazione, e il
/// nome con cui si scrive nello scope.
export function attributeName(key: string, scope: NamespaceScope): { uri: string; local: string; name: string } {
  const parts = splitQName(key);
  if (parts === null) throw new ElemError(`nome di attributo non valido: ${JSON.stringify(key)}`);
  const [prefix, local] = parts;
  if (key === "xmlns" || prefix === "xmlns") {
    throw new ElemError(`un'operazione non dichiara namespace: ${key}`);
  }
  if (prefix === null) return { uri: "", local, name: local };
  const uri = CONVENTIONAL.get(prefix) ?? scope.uri(prefix);
  if (uri === null) throw new ElemError(`prefisso non dichiarato nel documento: ${key}`);
  const written = scope.attributePrefix(uri);
  if (written === null) throw new ElemError(`il documento non dichiara il namespace di ${key}`);
  return { uri, local, name: `${written}:${local}` };
}

/// Un elemento di un'operazione pronto da scrivere nello scope del suo
/// genitore. Controlla la forma di §2; i valori li giudica la
/// classificazione.
export function elemToOut(elem: Elem, scope: NamespaceScope, parentTag: string | null = null): OutElement {
  if (elem === null || typeof elem !== "object" || Array.isArray(elem)) throw new ElemError("elemento assente");
  const { tag, attrs, children, text } = elem;
  if (typeof tag !== "string" || !SCENE_TAGS.has(tag)) throw new ElemError(`tag fuori dal formato: ${JSON.stringify(tag)}`);
  const owners = OWNERS.get(tag);
  if (owners !== undefined && (parentTag === null || !owners.has(parentTag))) {
    throw new ElemError(`${tag} sta solo dentro un ${[...owners].join(" o un ")}`);
  }
  if (parentTag !== null && tag !== "title" && tag !== "desc" && owners === undefined && !OPEN_PARENTS.has(parentTag)) {
    throw new ElemError(`${tag} non può stare dentro ${parentTag}`);
  }
  if (attrs === null || typeof attrs !== "object" || Array.isArray(attrs)) throw new ElemError(`attributi assenti su ${tag}`);
  const name = scope.svgName(tag);
  if (name === null) throw new ElemError("il documento non lega un prefisso al namespace SVG");

  const out: OutAttr[] = [];
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value !== "string") throw new ElemError(`valore non stringa per ${key}`);
    if (!isXmlText(value)) throw new ElemError(`carattere non ammesso da XML nel valore di ${key}`);
    const resolved = attributeName(key, scope);
    const expanded = `${resolved.uri} ${resolved.local}`;
    if (seen.has(expanded)) throw new ElemError(`attributo ripetuto: ${key}`);
    seen.add(expanded);
    out.push({ ...resolved, text: escapeAttribute(value) });
  }

  if (children !== undefined && !Array.isArray(children)) throw new ElemError(`figli non validi su ${tag}`);
  const kids = children ?? [];
  if (kids.length > 0 && TEXT_TAGS.has(tag)) throw new ElemError(`${tag} non ha figli, solo testo`);
  if (text !== undefined && text !== null) {
    if (typeof text !== "string") throw new ElemError(`testo non stringa su ${tag}`);
    if (!TEXT_TAGS.has(tag)) throw new ElemError(`${tag} non ha testo`);
    if (!isXmlText(text)) throw new ElemError(`carattere non ammesso da XML nel testo di ${tag}`);
  }
  const runs = elem.runs;
  if (runs !== undefined) {
    if ((tag !== "tspan" && tag !== "textPath") || parentTag !== "text") throw new ElemError("i pezzi stanno solo in una riga di un text o nel suo tracciato");
    if (text !== undefined && text !== null) throw new ElemError("una riga ha il testo o i pezzi, non tutti e due");
  }
  return {
    name,
    group: tag === "g",
    attrs: canonicalOrder(out),
    children: kids.map((child) => elemToOut(child, scope, tag)),
    text: runs !== undefined ? lineContent(runs, scope) : TEXT_TAGS.has(tag) ? escapeText(text ?? "") : null,
  };
}

/// Vero se `run` è un pezzo: un oggetto con il suo testo e i suoi
/// attributi.
function isPiece(run: unknown): run is Piece {
  return run !== null && typeof run === "object" && !Array.isArray(run);
}

/// Le parti di una riga nella forma canonica: senza testo vuoto, coi pezzi
/// senza attributi fatti testo della riga, e le parti vicine uguali unite.
/// Controlla la forma di un'operazione; i valori li giudica la
/// classificazione.
export function canonicalRuns(runs: unknown): Run[] {
  if (!Array.isArray(runs)) throw new ElemError("pezzi non validi");
  const out: Run[] = [];
  for (const run of runs as unknown[]) {
    let part: Run;
    if (typeof run === "string") {
      part = run;
    } else if (isPiece(run)) {
      const { text, attrs } = run as { text?: unknown; attrs?: unknown };
      if (typeof text !== "string") throw new ElemError("un pezzo senza testo");
      if (attrs === null || typeof attrs !== "object" || Array.isArray(attrs)) throw new ElemError("un pezzo senza attributi");
      for (const value of Object.values(attrs)) if (typeof value !== "string") throw new ElemError("un valore di un pezzo non è una stringa");
      part = Object.keys(attrs).length === 0 ? text : { text, attrs: attrs as Record<string, string> };
    } else {
      throw new ElemError("parte di riga non valida");
    }
    const value = typeof part === "string" ? part : part.text;
    if (!isXmlText(value) || /[\r\n]/.test(value)) throw new ElemError("carattere non ammesso in una riga");
    if (value === "") continue;
    const last = out[out.length - 1];
    if (typeof part === "string" && typeof last === "string") out[out.length - 1] = last + part;
    else if (typeof part !== "string" && last !== undefined && typeof last !== "string" && sameAttrs(last.attrs, part.attrs)) {
      out[out.length - 1] = { text: last.text + part.text, attrs: last.attrs };
    } else out.push(part);
  }
  return out;
}

/// Vero se due pezzi hanno gli stessi attributi, con gli stessi valori.
function sameAttrs(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && a[key] === b[key]);
}

/// Il contenuto di una riga, già con gli escape: il testo della riga e i
/// pezzi, ciascuno un `tspan` coi suoi attributi in ordine canonico, sulla
/// stessa riga del file.
export function lineContent(runs: readonly Run[], scope: NamespaceScope): string {
  const name = scope.svgName("tspan");
  if (name === null) throw new ElemError("il documento non lega un prefisso al namespace SVG");
  let out = "";
  for (const run of canonicalRuns(runs)) {
    if (typeof run === "string") {
      out += escapeText(run);
      continue;
    }
    const attrs: OutAttr[] = [];
    const seen = new Set<string>();
    for (const [key, value] of Object.entries(run.attrs)) {
      if (!isXmlText(value)) throw new ElemError(`carattere non ammesso da XML nel valore di ${key}`);
      const resolved = attributeName(key, scope);
      const expanded = `${resolved.uri} ${resolved.local}`;
      if (seen.has(expanded)) throw new ElemError(`attributo ripetuto: ${key}`);
      seen.add(expanded);
      attrs.push({ ...resolved, text: escapeAttribute(value) });
    }
    out += `${openTag({ name, group: false, attrs: canonicalOrder(attrs), children: [], text: null })}>${escapeText(run.text)}</${name}>`;
  }
  return out;
}

/// Le parti di una riga letta, `line`: il testo della riga e i pezzi, coi
/// loro attributi come li nomina un'operazione; `null` se la riga non ha
/// pezzi, e allora è tutta testo.
export function readRuns(doc: XmlDocument, line: ElementNode): Run[] | null {
  const runs: Run[] = [];
  let pieces = false;
  for (const child of line.children) {
    const node = doc.nodes[child]!;
    if (node.kind === "text") {
      runs.push(node.value);
    } else if (node.kind === "element") {
      pieces = true;
      const attrs: Record<string, string> = {};
      for (const attr of node.attrs) {
        if (attr.name === "xmlns" || attr.name.startsWith("xmlns:")) continue;
        attrs[attributeKey({ name: attr.name, uri: doc.namespaces[attr.ns]!, local: attr.local })] = attr.value;
      }
      let text = "";
      for (const inner of node.children) {
        const leaf = doc.nodes[inner]!;
        if (leaf.kind === "text") text += leaf.value;
      }
      runs.push({ text, attrs });
    }
  }
  return pieces ? runs : null;
}

/// Il testo a LF: chi scrive lavora a LF, e il motore riporta le righe sul
/// terminatore del file.
function lf(text: string): string {
  return text.indexOf("\r") < 0 ? text : text.replace(/\r\n?/g, "\n");
}

/// Il valore grezzo di un attributo come va fra virgolette doppie: le
/// virgolette doppie di un valore scritto fra apici diventano `&quot;`, il
/// resto si copia com'è, a LF.
function rawValue(doc: XmlDocument, element: ElementNode, index: number): string {
  const attr = element.attrs[index]!;
  const text = doc.source.text;
  const raw = lf(text.slice(attr.raw[0], attr.raw[1]));
  return text.charCodeAt(attr.raw[0] - 1) === 0x27 ? raw.replace(/"/g, "&quot;") : raw;
}

/// Gli attributi di un elemento letto, copiati come sono scritti.
export function attributesOf(doc: XmlDocument, element: ElementNode): OutAttr[] {
  return element.attrs.map((attr, index) => ({
    name: attr.name,
    uri: doc.namespaces[attr.ns]!,
    local: attr.local,
    text: rawValue(doc, element, index),
  }));
}

/// La chiave con cui un'operazione nomina un attributo: col prefisso
/// convenzionale per i namespace di FubDraw, di XLink e di XML, con quello
/// scritto nel documento per gli altri.
export function attributeKey(attr: Pick<OutAttr, "name" | "uri" | "local">): string {
  if (attr.uri === "") return attr.local;
  for (const [prefix, uri] of CONVENTIONAL) if (uri === attr.uri) return `${prefix}:${attr.local}`;
  return attr.name;
}

/// Lo scope dentro `element`: quello del genitore più le dichiarazioni
/// dell'elemento.
export function scopeInside(scope: NamespaceScope, element: ElementNode): NamespaceScope {
  const declarations: Array<[string | null, string]> = [];
  for (const attr of element.attrs) {
    if (attr.name === "xmlns") declarations.push([null, attr.value]);
    else if (attr.name.startsWith("xmlns:")) declarations.push([attr.local, attr.value]);
  }
  return declarations.length === 0 ? scope : scope.declare(declarations);
}

/// Un elemento letto, pronto da riscrivere: attributi e testo copiati come
/// sono scritti, figli elemento ricopiati allo stesso modo, spazi fra i figli
/// sostituiti dal rientro canonico. Serve a elementi modificabili, che hanno
/// solo testo, `title`, `desc`, `tspan` e `textPath` dentro.
export function elementToOut(doc: XmlDocument, id: NodeId): OutElement {
  const element = doc.element(id)!;
  // Il contenuto di una riga, o del tracciato di un testo, si copia com'è
  // scritto, coi suoi pezzi.
  const carriesText = isSvg(element, "title") || isSvg(element, "desc") || isSvg(element, "tspan") || isSvg(element, "textPath");
  const children: OutElement[] = [];
  for (const child of element.children) {
    if (!carriesText && doc.element(child) !== null) children.push(elementToOut(doc, child));
  }
  let text: string | null = null;
  if (carriesText) text = element.closeStart === null ? "" : lf(doc.source.text.slice(element.openEnd, element.closeStart));
  return {
    name: element.name,
    group: isSvg(element, "g"),
    attrs: canonicalOrder(attributesOf(doc, element)),
    children,
    text,
  };
}

/// Gli attributi della radice nell'ordine dell'esempio di §2: le
/// dichiarazioni, `fub:version`, `viewBox`, `width`, `height` e `fub:units`,
/// poi gli altri nell'ordine originale e in fondo `fub:guides`.
export function rootOrder(attrs: readonly OutAttr[]): OutAttr[] {
  const slot = (attr: OutAttr): number => {
    if (attr.uri === XMLNS_URI) return attr.local === "xmlns" ? 0 : 1;
    if (attr.uri === FUB_NS && attr.local === "version") return 2;
    if (attr.uri === "") {
      const geometry = ["viewBox", "width", "height"].indexOf(attr.local);
      if (geometry >= 0) return 3 + geometry;
    }
    if (attr.uri === FUB_NS && attr.local === "units") return 6;
    return attr.uri === FUB_NS && attr.local === "guides" ? 8 : 7;
  };
  return attrs
    .map((attr, index) => ({ attr, index, slot: slot(attr) }))
    .sort((a, b) => a.slot - b.slot || a.index - b.index)
    .map((k) => k.attr);
}

// ---------------------------------------------------------------------------
// Numeri di geometria (§7, punti 3 e 4).
// ---------------------------------------------------------------------------

/// Una coordinata di geometria: al più due decimali.
function coordinate(value: number): string {
  return formatNumber(value, 2);
}

/// `d` di una lista di segmenti assoluti: ogni comando attaccato alle sue
/// coordinate e separato dal successivo da uno spazio, `M10 20 L30 40 Z`.
export function pathData(segments: readonly Segment[]): string {
  return segments
    .map((segment) => {
      switch (segment.kind) {
        case "move": return `M${coordinate(segment.to[0])} ${coordinate(segment.to[1])}`;
        case "line": return `L${coordinate(segment.to[0])} ${coordinate(segment.to[1])}`;
        case "quad":
          return `Q${coordinate(segment.control[0])} ${coordinate(segment.control[1])} ${coordinate(segment.to[0])} ${coordinate(segment.to[1])}`;
        case "cubic":
          return `C${[segment.c1, segment.c2, segment.to].map(([x, y]) => `${coordinate(x)} ${coordinate(y)}`).join(" ")}`;
        case "arc":
          return `A${coordinate(segment.radii[0])} ${coordinate(segment.radii[1])} ${coordinate(segment.rotation)} ${segment.large ? 1 : 0} ${segment.sweep ? 1 : 0} ${coordinate(segment.to[0])} ${coordinate(segment.to[1])}`;
        case "close": return "Z";
      }
    })
    .join(" ");
}

/// Una matrice come `transform`: `matrix(a b c d e f)` con al più quattro
/// decimali per ogni valore.
export function formatTransform(m: Matrix): string {
  return `matrix(${m.map((v) => formatNumber(v, 4)).join(" ")})`;
}
