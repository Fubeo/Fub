// Il livello XML della scena: un albero ben formato con le posizioni di ogni
// nodo (formato della scena, §2).
//
// È il lettore di `fub-scene` (`xml.rs`) riscritto evento per evento. Rust
// taglia la sorgente con `quick-xml` e controlla tutto il resto sui byte di
// ogni evento; qui il taglio di `quick-xml` 0.41 è riprodotto a mano — dove
// finisce un tag, un commento, un CDATA, un `DOCTYPE` col suo sottoinsieme
// interno — e i controlli sono gli stessi, nello stesso ordine. Così un file
// malformato si rifiuta con lo stesso tipo d'errore e allo stesso byte, e un
// file che Rust apre si apre anche qui.
//
// Perché non `DOMParser`. Non dà posizioni, e la superficie ne ha bisogno per
// ogni elemento; il suo giudizio cambia da un motore all'altro (WebKitGTK,
// WebView2, WKWebView), mentre quello di Rust è uno; rifiuta i `DOCTYPE` con
// sottoinsieme interno, che Rust legge e apre in sola lettura (§8); e
// costruirebbe un documento con i nodi della sorgente, che non deve esistere
// fuori da questo modulo (DEC-05). Qui la sorgente resta una stringa: nessun
// nodo, nessun URL, nessuno stile prende vita.
//
// Le posizioni dei nodi sono indici UTF-16 grezzi della stringa. Gli errori
// escono già in byte UTF-8, BOM compreso, come quelli di Rust.

import { bomUnits, SourceText, utf8Length } from "./text";

/// L'indice di un nodo nell'arena di [`XmlDocument`].
export type NodeId = number;

/// Nessun namespace: gli attributi senza prefisso.
export const NS_NONE = 0;
export const NS_SVG = 1;
export const NS_FUB = 2;
export const NS_XLINK = 3;
/// `http://www.w3.org/XML/1998/namespace`, legato per definizione a `xml`.
export const NS_XML = 4;
/// Il namespace delle dichiarazioni `xmlns`.
export const NS_XMLNS = 5;
/// L'HTML dentro i `foreignObject`.
export const NS_XHTML = 6;

export const SVG_NS = "http://www.w3.org/2000/svg";
export const FUB_NS = "https://fubeo.github.io/ns/scene/1";
export const XLINK_NS = "http://www.w3.org/1999/xlink";
export const XML_URI = "http://www.w3.org/XML/1998/namespace";
export const XMLNS_URI = "http://www.w3.org/2000/xmlns/";
const XHTML_URI = "http://www.w3.org/1999/xhtml";

/// Quanto può annidarsi l'espansione di un'entità dentro un attributo.
const MAX_ENTITY_DEPTH = 16;
/// Quanti byte possono produrre in tutto le entità espanse negli attributi: il
/// riparo dalla «billion laughs».
const MAX_ENTITY_EXPANSION = 1 << 20;

/// Perché una sorgente non è XML ben formato, coi nomi di Rust.
export type XmlErrorKind =
  | "unclosed-markup"
  | "invalid-markup"
  | "invalid-char"
  | "invalid-name"
  | "invalid-reference"
  | "undeclared-entity"
  | "external-entity"
  | "entity-limit"
  | "less-than-in-attribute"
  | "cdata-end-in-text"
  | "invalid-comment"
  | "invalid-processing-instruction"
  | "invalid-declaration"
  | "misplaced-declaration"
  | "invalid-doctype"
  | "misplaced-doctype"
  | "duplicate-attribute"
  | "mismatched-end-tag"
  | "unmatched-end-tag"
  | "unclosed-element"
  | "undeclared-prefix"
  | "invalid-namespace-declaration"
  | "content-outside-root"
  | "missing-root"
  | "multiple-roots";

/// La frase di ogni errore, la stessa del `Display` di Rust.
export const XML_ERROR_MESSAGES: Readonly<Record<XmlErrorKind, string>> = {
  "unclosed-markup": "costrutto non chiuso",
  "invalid-markup": "marcatura non valida",
  "invalid-char": "carattere non ammesso da XML",
  "invalid-name": "nome non valido",
  "invalid-reference": "riferimento non valido",
  "undeclared-entity": "entità non dichiarata",
  "external-entity": "entità esterna fuori posto",
  "entity-limit": "entità annidate oltre il limite",
  "less-than-in-attribute": "`<` nel valore di un attributo",
  "cdata-end-in-text": "`]]>` nel testo",
  "invalid-comment": "commento non valido",
  "invalid-processing-instruction": "istruzione di elaborazione non valida",
  "invalid-declaration": "dichiarazione XML non valida",
  "misplaced-declaration": "dichiarazione XML fuori posto",
  "invalid-doctype": "DOCTYPE non valido",
  "misplaced-doctype": "DOCTYPE fuori posto",
  "duplicate-attribute": "attributo ripetuto",
  "mismatched-end-tag": "tag di chiusura diverso da quello aperto",
  "unmatched-end-tag": "tag di chiusura senza apertura",
  "unclosed-element": "elemento non chiuso",
  "undeclared-prefix": "prefisso non dichiarato",
  "invalid-namespace-declaration": "dichiarazione di namespace non valida",
  "content-outside-root": "contenuto fuori dalla radice",
  "missing-root": "manca l'elemento radice",
  "multiple-roots": "più di un elemento radice",
};

/// Un errore di buona formazione, al byte in cui si vede, BOM compreso.
export class XmlError extends Error {
  constructor(readonly offset: number, readonly kind: XmlErrorKind) {
    super(`XML non ben formato al byte ${offset}: ${XML_ERROR_MESSAGES[kind]}`);
    this.name = "XmlError";
  }
}

/// Un errore all'indice UTF-16 `index`: diventa un [`XmlError`] in byte
/// all'uscita di [`parseXml`].
class Failure {
  constructor(readonly index: number, readonly kind: XmlErrorKind) {}
}

function fail(index: number, kind: XmlErrorKind): never {
  throw new Failure(index, kind);
}

/// Un attributo: il nome com'è scritto, il namespace risolto e il valore
/// normalizzato come lo vede un parser XML.
export interface Attr {
  readonly name: string;
  readonly local: string;
  readonly ns: number;
  readonly value: string;
  /// Gli indici del valore grezzo, virgolette escluse.
  readonly raw: readonly [number, number];
}

interface NodeBase {
  readonly start: number;
  end: number;
  readonly parent: NodeId | null;
}

/// Un elemento: nome, namespace, attributi, figli e dove finisce il suo tag
/// d'apertura.
export interface ElementNode extends NodeBase {
  readonly kind: "element";
  readonly name: string;
  readonly local: string;
  readonly ns: number;
  readonly attrs: readonly Attr[];
  readonly children: NodeId[];
  /// L'indice dopo il `>` del tag d'apertura.
  readonly openEnd: number;
  /// L'indice del `<` del tag di chiusura; `null` per un tag autochiuso.
  closeStart: number | null;
}

/// Dati di carattere, coi riferimenti predefiniti e numerici già risolti e i
/// terminatori già ridotti a `\n`. `blank` dice se i caratteri grezzi sono
/// soltanto spazi XML.
export interface TextNode extends NodeBase {
  readonly kind: "text";
  readonly value: string;
  readonly blank: boolean;
}

/// Una sezione CDATA, col suo contenuto a LF.
export interface CDataNode extends NodeBase {
  readonly kind: "cdata";
  readonly value: string;
}

/// Un riferimento a un'entità dichiarata nel `DOCTYPE`, col suo nome.
export interface EntityRefNode extends NodeBase {
  readonly kind: "entity-ref";
  readonly name: string;
}

export interface OtherNode extends NodeBase {
  readonly kind: "comment" | "pi" | "decl" | "doctype";
}

export type XmlNode = ElementNode | TextNode | CDataNode | EntityRefNode | OtherNode;

/// L'attributo `local` nel namespace `ns`.
export function attrOf(element: ElementNode, ns: number, local: string): Attr | undefined {
  return element.attrs.find((a) => a.ns === ns && a.local === local);
}

/// Il valore normalizzato dell'attributo `local` nel namespace `ns`.
export function valueOf(element: ElementNode, ns: number, local: string): string | undefined {
  return attrOf(element, ns, local)?.value;
}

/// Vero se l'elemento è `local` nel namespace SVG.
export function isSvg(element: ElementNode, local: string): boolean {
  return element.ns === NS_SVG && element.local === local;
}

/// Un'entità generale dichiarata nel sottoinsieme interno del `DOCTYPE`.
type Entity =
  /// Il testo di sostituzione coi riferimenti a carattere già espansi, e la
  /// sua lunghezza in byte.
  | { readonly kind: "internal"; readonly text: string; readonly bytes: number }
  /// Un'entità esterna analizzata: nessun browser la carica.
  | { readonly kind: "external" }
  /// Un'entità esterna non analizzata (`NDATA`).
  | { readonly kind: "unparsed" }
  /// Un valore che usa entità parametriche, che qui non si risolvono.
  | { readonly kind: "unresolved" };

/// Un documento XML letto: l'arena dei nodi e i fatti del prologo.
export class XmlDocument {
  constructor(
    readonly source: SourceText,
    readonly nodes: readonly XmlNode[],
    /// I nodi di primo livello in ordine: prologo, radice, epilogo.
    readonly top: readonly NodeId[],
    readonly root: NodeId,
    /// La codifica dichiarata da `<?xml … encoding="…"?>`, se c'è.
    readonly encoding: string | null,
    readonly doctype: NodeId | null,
    /// Quanti elementi, di qualunque namespace, radice compresa.
    readonly elements: number,
    /// Falso quando la lettura si è fermata dopo la testa (§11).
    readonly complete: boolean,
    private readonly entities: ReadonlyMap<string, Entity>,
    /// L'URI di ogni namespace, al numero che lo rappresenta: `""` è
    /// l'assenza di namespace.
    readonly namespaces: readonly string[],
  ) {}

  /// L'elemento `id`, se il nodo è un elemento.
  element(id: NodeId): ElementNode | null {
    const node = this.nodes[id]!;
    return node.kind === "element" ? node : null;
  }

  /// I figli di `id`, vuoti se il nodo non è un elemento.
  children(id: NodeId): readonly NodeId[] {
    return this.element(id)?.children ?? [];
  }

  /// Il testo di sostituzione di un'entità interna, se è testo semplice:
  /// senza marcatura e senza altri riferimenti. Serve all'indice, che lo
  /// legge come testo; tutto il resto non si espande.
  plainEntity(name: string): string | null {
    const entity = this.entities.get(name);
    if (entity?.kind !== "internal" || /[<&]/.test(entity.text)) return null;
    return entity.text;
  }
}

/// Lo spazio di XML: `S ::= (#x20 | #x9 | #xD | #xA)+`.
export function isSpace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}

function isNameStart(c: number): boolean {
  return c === 0x3a || (c >= 0x41 && c <= 0x5a) || c === 0x5f || (c >= 0x61 && c <= 0x7a)
    || (c >= 0xc0 && c <= 0xd6) || (c >= 0xd8 && c <= 0xf6) || (c >= 0xf8 && c <= 0x2ff)
    || (c >= 0x370 && c <= 0x37d) || (c >= 0x37f && c <= 0x1fff) || (c >= 0x200c && c <= 0x200d)
    || (c >= 0x2070 && c <= 0x218f) || (c >= 0x2c00 && c <= 0x2fef) || (c >= 0x3001 && c <= 0xd7ff)
    || (c >= 0xf900 && c <= 0xfdcf) || (c >= 0xfdf0 && c <= 0xfffd) || (c >= 0x10000 && c <= 0xeffff);
}

function isNameChar(c: number): boolean {
  return isNameStart(c) || c === 0x2d || c === 0x2e || (c >= 0x30 && c <= 0x39) || c === 0xb7
    || (c >= 0x300 && c <= 0x36f) || (c >= 0x203f && c <= 0x2040);
}

/// Il code point all'indice `i`: un surrogato isolato resta sé stesso, e non
/// è mai un carattere di nome.
function codePoint(text: string, i: number): number {
  return text.codePointAt(i) ?? -1;
}

/// La fine del `Name` che comincia all'indice `from` di `text`, senza passare
/// `limit`; `from` se lì non comincia un nome.
export function scanName(text: string, from: number, limit = text.length): number {
  if (from >= limit) return from;
  let c = codePoint(text, from);
  if (!isNameStart(c)) return from;
  let i = from + (c > 0xffff ? 2 : 1);
  while (i < limit) {
    c = codePoint(text, i);
    if (!isNameChar(c)) return i;
    i += c > 0xffff ? 2 : 1;
  }
  return limit;
}

export function isNcName(name: string): boolean {
  return name !== "" && !name.includes(":") && scanName(name, 0) === name.length;
}

/// Prefisso e nome locale di un `QName`; `null` se il nome non è un `QName`.
export function splitQName(name: string): [prefix: string | null, local: string] | null {
  const colon = name.indexOf(":");
  if (colon < 0) return isNcName(name) ? [null, name] : null;
  const prefix = name.slice(0, colon);
  const local = name.slice(colon + 1);
  return isNcName(prefix) && isNcName(local) ? [prefix, local] : null;
}

/// Le cinque entità che XML dichiara da sé.
function predefined(name: string): string | null {
  switch (name) {
    case "lt": return "<";
    case "gt": return ">";
    case "amp": return "&";
    case "apos": return "'";
    case "quot": return "\"";
    default: return null;
  }
}

/// Un carattere che XML 1.0 ammette (`Char`).
function isXmlChar(c: number): boolean {
  return c === 0x09 || c === 0x0a || c === 0x0d || (c >= 0x20 && c <= 0xd7ff)
    || (c >= 0xe000 && c <= 0xfffd) || (c >= 0x10000 && c <= 0x10ffff);
}

type Reference =
  | { readonly kind: "char"; readonly char: string }
  | { readonly kind: "named"; readonly name: string };

function isHexDigit(c: number): boolean {
  return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
}

/// Il riferimento che comincia con `&` all'indice `at` di `text`, senza
/// passare `limit`, e quante unità occupa.
function parseReference(text: string, at: number, limit: number): [Reference, number] | null {
  if (text.charCodeAt(at) !== 0x26) return null;
  if (at + 1 < limit && text.charCodeAt(at + 1) === 0x23) {
    const hex = at + 2 < limit && text.charCodeAt(at + 2) === 0x78;
    const skip = hex ? 3 : 2;
    let end = at + skip;
    while (end < limit && isHexDigit(text.charCodeAt(end))) end++;
    const digits = text.slice(at + skip, end);
    if (digits === "" || end >= limit || text.charCodeAt(end) !== 0x3b) return null;
    if (!hex && !/^[0-9]+$/.test(digits)) return null;
    const significant = digits.replace(/^0+/, "");
    // `u32::from_str_radix`: oltre 32 bit non è un carattere.
    if (significant.length > (hex ? 8 : 10)) return null;
    const value = significant === "" ? 0 : parseInt(significant, hex ? 16 : 10);
    if (value > 0xffffffff || !isXmlChar(value)) return null;
    return [{ kind: "char", char: String.fromCodePoint(value) }, end + 1 - at];
  }
  const end = scanName(text, at + 1, limit);
  if (end === at + 1 || end >= limit || text.charCodeAt(end) !== 0x3b) return null;
  return [{ kind: "named", name: text.slice(at + 1, end) }, end + 1 - at];
}

/// Riduce `\r\n` e `\r` a `\n`, come fa un parser XML col testo (§2.11).
function eol(raw: string): string {
  return raw.indexOf("\r") < 0 ? raw : raw.replace(/\r\n?/g, "\n");
}

function allSpace(text: string, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (!isSpace(text.charCodeAt(i))) return false;
  return true;
}

/// `to_ascii_lowercase` di Rust: solo le lettere ASCII cambiano.
function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/// Il primo indice da `from` in poi che non sta fra le virgolette di un
/// attributo e contiene `>`: come `ElementParser` di `quick-xml`. `-1` se il
/// tag non si chiude.
function tagEnd(text: string, from: number): number {
  let quote = 0;
  for (let i = from; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (quote !== 0) {
      if (c === quote) quote = 0;
    } else if (c === 0x3e) {
      return i;
    } else if (c === 0x22 || c === 0x27) {
      quote = c;
    }
  }
  return -1;
}

/// L'indice del `>` che chiude il `<!DOCTYPE` all'indice `from`, saltando
/// letterali e sottoinsieme interno come `DtdParser` di `quick-xml`; `-1` se
/// non si chiude.
function doctypeEnd(text: string, from: number): number {
  let cur = from;
  // Prima del sottoinsieme: solo le virgolette dei letterali contano.
  for (;;) {
    let i = cur;
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c === 0x22 || c === 0x27 || c === 0x5b || c === 0x3e) break;
      i++;
    }
    if (i >= text.length) return -1;
    const c = text.charCodeAt(i);
    if (c === 0x3e) return i;
    if (c === 0x5b) {
      cur = i + 1;
      break;
    }
    const close = text.indexOf(c === 0x22 ? "\"" : "'", i + 1);
    if (close < 0) return -1;
    cur = close + 1;
  }
  // Dentro il sottoinsieme: si salta ogni dichiarazione fino alla `]`.
  for (;;) {
    let i = cur;
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c === 0x5d || c === 0x3c) break;
      i++;
    }
    if (i >= text.length) return -1;
    if (text.charCodeAt(i) === 0x5d) return text.indexOf(">", i + 1);
    const markup = i + 1;
    if (text.charCodeAt(markup) === 0x3f) {
      const end = text.indexOf("?>", markup + 1);
      if (end < 0) return -1;
      cur = end + 1;
    } else if (text.startsWith("!--", markup)) {
      const end = text.indexOf("-->", markup + 3);
      if (end < 0) return -1;
      cur = end + 3;
    } else if (text.startsWith("!ELEMENT", markup)) {
      const end = text.indexOf(">", markup + 8);
      if (end < 0) return -1;
      cur = end + 1;
    } else if (text.startsWith("!ENTITY", markup) || text.startsWith("!ATTLIST", markup)
      || text.startsWith("!NOTATION", markup)) {
      const skip = text.startsWith("!ENTITY", markup) ? 7 : text.startsWith("!ATTLIST", markup) ? 8 : 9;
      const end = tagEnd(text, markup + skip);
      if (end < 0) return -1;
      cur = end;
    } else {
      const end = text.indexOf(">", markup);
      if (end < 0) return -1;
      cur = end + 1;
    }
  }
}

/// Un attributo come sta nel tag: nome e indici del valore.
interface RawAttr {
  readonly start: number;
  readonly name: string;
  readonly value: readonly [number, number];
}

/// Legge un tag d'apertura `[start, end)`: nome, attributi e i loro indici.
function scanStartTag(text: string, start: number, end: number, empty: boolean): [string, RawAttr[]] {
  const close = empty ? end - 2 : end - 1;
  const nameEnd = scanName(text, start + 1, end);
  if (nameEnd === start + 1) fail(start + 1, "invalid-name");
  const name = text.slice(start + 1, nameEnd);
  const attrs: RawAttr[] = [];
  let i = nameEnd;
  for (;;) {
    const spaced = i;
    while (i < close && isSpace(text.charCodeAt(i))) i++;
    if (i === close) break;
    if (i === spaced) fail(i, "invalid-markup");
    const attrStart = i;
    i = scanName(text, i, end);
    if (i === attrStart) fail(i, "invalid-name");
    const attrName = text.slice(attrStart, i);
    while (i < close && isSpace(text.charCodeAt(i))) i++;
    if (i >= close || text.charCodeAt(i) !== 0x3d) fail(i, "invalid-markup");
    i++;
    while (i < close && isSpace(text.charCodeAt(i))) i++;
    const quote = text.charCodeAt(i);
    if (i >= close || (quote !== 0x22 && quote !== 0x27)) fail(i, "invalid-markup");
    const valueStart = i + 1;
    const valueEnd = text.indexOf(quote === 0x22 ? "\"" : "'", valueStart);
    if (valueEnd < 0 || valueEnd >= close) fail(i, "unclosed-markup");
    attrs.push({ start: attrStart, name: attrName, value: [valueStart, valueEnd] });
    i = valueEnd + 1;
  }
  return [name, attrs];
}

/// Il nome di un tag di chiusura `</name S?>`.
function scanEndTag(text: string, start: number, end: number): string {
  const nameEnd = scanName(text, start + 2, end);
  if (nameEnd === start + 2) fail(start + 2, "invalid-name");
  if (!allSpace(text, nameEnd, end - 1)) fail(nameEnd, "invalid-markup");
  return text.slice(start + 2, nameEnd);
}

/// Legge `<?xml version="1.x" encoding="…" standalone="…"?>` e ne restituisce
/// la codifica dichiarata; `undefined` se la dichiarazione è malformata.
function parseDecl(raw: string): string | null | undefined {
  if (!raw.startsWith("<?xml") || !raw.endsWith("?>")) return undefined;
  const body = raw.slice(5, raw.length - 2);
  let i = 0;
  let seen = 0;
  let encoding: string | null = null;
  for (;;) {
    const spaced = i;
    while (i < body.length && isSpace(body.charCodeAt(i))) i++;
    if (i === body.length) break;
    if (i === spaced) return undefined;
    const nameEnd = scanName(body, i);
    const name = body.slice(i, nameEnd);
    i = nameEnd;
    while (i < body.length && isSpace(body.charCodeAt(i))) i++;
    if (body.charCodeAt(i) !== 0x3d) return undefined;
    i++;
    while (i < body.length && isSpace(body.charCodeAt(i))) i++;
    const quote = body.charCodeAt(i);
    if (quote !== 0x22 && quote !== 0x27) return undefined;
    const close = body.indexOf(quote === 0x22 ? "\"" : "'", i + 1);
    if (close < 0) return undefined;
    const value = body.slice(i + 1, close);
    i = close + 1;
    // L'ordine è fisso: version, encoding, standalone.
    const rank = name === "version" ? 1 : name === "encoding" ? 2 : name === "standalone" ? 3 : 0;
    if (rank === 0 || rank <= seen || (seen === 0 && rank !== 1)) return undefined;
    seen = rank;
    let valid: boolean;
    if (rank === 1) {
      valid = /^1\.[0-9]+$/.test(value);
    } else if (rank === 2) {
      encoding = value;
      valid = /^[A-Za-z][A-Za-z0-9._-]*$/.test(value);
    } else {
      valid = value === "yes" || value === "no";
    }
    if (!valid) return undefined;
  }
  return seen >= 1 ? encoding : undefined;
}

/// Legge `<!DOCTYPE …>` (gli indici `[start, end)` di `source`) e restituisce
/// le entità generali del sottoinsieme interno. Le altre dichiarazioni si
/// saltano: un lettore non validante non le usa, e il documento con `DOCTYPE`
/// si apre comunque in sola lettura.
function parseDoctype(source: string, start: number, end: number): Map<string, Entity> {
  // Il testo senza il `>` finale, con gli indici del file.
  const limit = end - 1;
  const bad = (at: number): never => fail(at, "invalid-doctype");
  const space = (i: number): number => {
    while (i < limit && isSpace(source.charCodeAt(i))) i++;
    return i;
  };
  const startsWith = (word: string, i: number): boolean =>
    i + word.length <= limit && source.startsWith(word, i);
  /// Una stringa fra virgolette che comincia all'indice `i`: il contenuto e
  /// l'indice dopo la virgoletta di chiusura.
  const quoted = (i: number): [string, number] | null => {
    const quote = i < limit ? source.charCodeAt(i) : 0;
    if (quote !== 0x22 && quote !== 0x27) return null;
    const close = source.indexOf(quote === 0x22 ? "\"" : "'", i + 1);
    if (close < 0 || close >= limit) return null;
    return [source.slice(i + 1, close), close + 1];
  };
  /// `SYSTEM "…"` oppure `PUBLIC "…" "…"`: l'indice dopo l'identificatore.
  /// Rust salta sei byte senza guardarli, anche quando la parola è un'altra:
  /// qui si saltano sei byte UTF-8, e un salto che cade dentro un carattere
  /// non trova lo spazio che deve seguire.
  const externalId = (from: number): number | null => {
    const isPublic = startsWith("PUBLIC", from);
    let i = from;
    for (let bytes = 0; bytes < 6; ) {
      if (i >= limit) return null;
      const c = codePoint(source, i);
      bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
      i += c > 0xffff ? 2 : 1;
      if (bytes > 6) return null;
    }
    let next = space(i);
    if (next === i) return null;
    let literal = quoted(next);
    if (literal === null) return null;
    i = literal[1];
    if (isPublic) {
      next = space(i);
      if (next === i) return null;
      literal = quoted(next);
      if (literal === null) return null;
      i = literal[1];
    }
    return i;
  };
  const entities = new Map<string, Entity>();
  /// `<!ENTITY …>`: registra le entità generali e restituisce l'indice dopo
  /// `>`.
  const entityDecl = (i: number): number | null => {
    i += 8;
    let next = space(i);
    if (next === i) return null;
    i = next;
    const parameter = i < limit && source.charCodeAt(i) === 0x25;
    if (parameter) {
      i++;
      next = space(i);
      if (next === i) return null;
      i = next;
    }
    const nameEnd = scanName(source, i, limit);
    const name = source.slice(i, nameEnd);
    if (!isNcName(name)) return null;
    i = nameEnd;
    next = space(i);
    if (next === i) return null;
    i = next;
    let entity: Entity;
    const c = i < limit ? source.charCodeAt(i) : 0;
    if (c === 0x22 || c === 0x27) {
      const literal = quoted(i);
      if (literal === null) return null;
      i = literal[1];
      const replacement = replacementText(literal[0]);
      if (replacement === null) return null;
      entity = replacement;
    } else {
      const after = externalId(i);
      if (after === null) return null;
      i = space(after);
      if (i > after && startsWith("NDATA", i)) {
        if (parameter) return null;
        i += 5;
        next = space(i);
        if (next === i) return null;
        i = next;
        const end = scanName(source, i, limit);
        if (end === i) return null;
        i = space(end);
        entity = { kind: "unparsed" };
      } else {
        entity = { kind: "external" };
      }
    }
    if (i >= limit || source.charCodeAt(i) !== 0x3e) return null;
    // La prima dichiarazione vince (§4.2); le predefinite non si ridefiniscono.
    if (!parameter && predefined(name) === null && !entities.has(name)) entities.set(name, entity);
    return i + 1;
  };
  /// Il byte dopo il `>` di una dichiarazione, saltando le stringhe.
  const markupDeclEnd = (i: number): number | null => {
    while (i < limit) {
      const c = source.charCodeAt(i);
      if (c === 0x3e) return i + 1;
      if (c === 0x22 || c === 0x27) {
        const literal = quoted(i);
        if (literal === null) return null;
        i = literal[1];
      } else {
        i++;
      }
    }
    return null;
  };

  if (!startsWith("<!DOCTYPE", start)) bad(start);
  let i = start + 9;
  let next = space(i);
  if (next === i) bad(i);
  i = next;
  const nameEnd = scanName(source, i, limit);
  if (nameEnd === i || splitQName(source.slice(i, nameEnd)) === null) bad(i);
  i = nameEnd;
  next = space(i);
  if (next > i && (startsWith("SYSTEM", next) || startsWith("PUBLIC", next))) {
    const after = externalId(next);
    if (after === null) bad(next);
    i = space(after!);
  } else {
    i = next;
  }
  if (i < limit && source.charCodeAt(i) === 0x5b) {
    i++;
    // Il sottoinsieme interno fino alla sua `]`.
    for (;;) {
      i = space(i);
      if (startsWith("]", i)) {
        i++;
        break;
      } else if (startsWith("<!--", i)) {
        const close = source.indexOf("-->", i + 4);
        if (close < 0 || close + 3 > limit) bad(i);
        i = close + 3;
      } else if (startsWith("<?", i)) {
        const close = source.indexOf("?>", i + 2);
        if (close < 0 || close + 2 > limit) bad(i);
        i = close + 2;
      } else if (startsWith("<!ENTITY", i)) {
        const after = entityDecl(i);
        if (after === null) bad(i);
        i = after!;
      } else if (startsWith("<!ELEMENT", i) || startsWith("<!ATTLIST", i) || startsWith("<!NOTATION", i)) {
        const after = markupDeclEnd(i);
        if (after === null) bad(i);
        i = after!;
      } else if (startsWith("%", i)) {
        const end = scanName(source, i + 1, limit);
        if (end === i + 1 || end >= limit || source.charCodeAt(end) !== 0x3b) bad(i);
        i = end + 1;
      } else {
        bad(i);
      }
    }
    i = space(i);
  }
  if (i !== limit) bad(i);
  return entities;
}

/// Il testo di sostituzione di un `EntityValue`: i riferimenti a carattere si
/// espandono, quelli a entità generali restano com'erano (§4.5).
function replacementText(value: string): Entity | null {
  let out = "";
  let i = 0;
  while (i < value.length) {
    const c = value.charCodeAt(i);
    if (c === 0x25) return { kind: "unresolved" };
    if (c === 0x26) {
      const parsed = parseReference(value, i, value.length);
      if (parsed === null) return null;
      const [reference, length] = parsed;
      out += reference.kind === "char" ? reference.char : value.slice(i, i + length);
      i += length;
    } else {
      out += value[i];
      i++;
    }
  }
  return { kind: "internal", text: out, bytes: utf8Length(out) };
}

/// Il testo in attesa: eventi di testo e riferimenti contigui diventano un
/// solo nodo.
interface PendingText {
  start: number;
  end: number;
  /// Il valore, quando non coincide con i caratteri grezzi.
  value: string | null;
}

/// I tipi di evento in cui `quick-xml` taglia la sorgente.
type EventKind = "text" | "ref" | "start" | "empty" | "end" | "comment" | "pi" | "decl" | "cdata" | "doctype";

class Parser {
  readonly nodes: XmlNode[] = [];
  readonly top: NodeId[] = [];
  root: NodeId | null = null;
  private readonly stack: NodeId[] = [];
  /// Le associazioni prefisso → namespace in vigore, dalla più vecchia.
  private readonly bindings: Array<[string | null, number]> = [["xml", NS_XML]];
  /// Quante associazioni c'erano all'apertura di ogni elemento della pila.
  private readonly marks: number[] = [];
  /// Gli URI dei namespace, indicizzati dal numero che li rappresenta.
  readonly namespaces = ["", SVG_NS, FUB_NS, XLINK_NS, XML_URI, XMLNS_URI, XHTML_URI];
  entities = new Map<string, Entity>();
  private expanded = 0;
  encoding: string | null = null;
  doctype: NodeId | null = null;
  elements = 0;
  private text: PendingText | null = null;
  private readonly bom: number;

  constructor(private readonly source: string) {
    this.bom = bomUnits(source);
  }

  /// Legge la sorgente evento per evento. Con `headOnly` si ferma al primo
  /// figlio della radice che non è `title` o `desc` e restituisce dove.
  run(headOnly: boolean): number | null {
    const s = this.source;
    let pos = this.bom;
    while (pos < s.length) {
      const start = pos;
      const [kind, end] = this.next(pos);
      pos = end;
      this.checkChars(start, end);
      switch (kind) {
        case "text": this.textEvent(start, end); break;
        case "ref": this.reference(start, end); break;
        case "start":
        case "empty": {
          const empty = kind === "empty";
          const id = this.open(start, end, empty);
          if (headOnly && this.leavesHead(id)) {
            this.retract(id, empty);
            return start;
          }
          break;
        }
        case "end": this.close(start, end); break;
        case "comment": this.comment(start, end); break;
        case "pi": this.pi(start, end); break;
        case "decl": this.decl(start, end); break;
        case "cdata": this.cdata(start, end); break;
        case "doctype": this.doctypeEvent(start, end); break;
      }
    }
    return null;
  }

  /// Il prossimo evento da `pos`, come lo taglia `quick-xml` 0.41: il tipo e
  /// l'indice dopo la sua fine. Gli errori di `quick-xml` cadono sul `<` o
  /// sull'`&` che apre il costrutto.
  private next(pos: number): [EventKind, number] {
    const s = this.source;
    const c = s.charCodeAt(pos);
    if (c === 0x26) {
      // Un riferimento finisce al primo `;`, se viene prima di `&` e `<`.
      for (let i = pos + 1; i < s.length; i++) {
        const d = s.charCodeAt(i);
        if (d === 0x3b) return ["ref", i + 1];
        if (d === 0x26 || d === 0x3c) break;
      }
      return fail(pos, "invalid-reference");
    }
    if (c !== 0x3c) {
      let i = pos;
      while (i < s.length) {
        const d = s.charCodeAt(i);
        if (d === 0x3c || d === 0x26) break;
        i++;
      }
      return ["text", i];
    }
    if (pos + 1 >= s.length) return fail(pos, "unclosed-markup");
    const second = s.charCodeAt(pos + 1);
    if (second === 0x21) return this.bang(pos);
    if (second === 0x3f) {
      const close = s.indexOf("?>", pos + 1);
      if (close < 0) return fail(pos, "unclosed-markup");
      const end = close + 2;
      // Almeno `<??>`: `<?>` è un'istruzione non chiusa.
      if (end - pos <= 3) return fail(pos, "unclosed-markup");
      const content = s.slice(pos + 2, end - 2);
      const decl = content.startsWith("xml") && (content.length === 3 || isSpace(content.charCodeAt(3)));
      return [decl ? "decl" : "pi", end];
    }
    const close = tagEnd(s, pos + 1);
    if (close < 0) return fail(pos, "unclosed-markup");
    if (second === 0x2f) return ["end", close + 1];
    return [s.charCodeAt(close - 1) === 0x2f ? "empty" : "start", close + 1];
  }

  /// Commento, CDATA o `DOCTYPE`, che cominciano con `<!`.
  private bang(pos: number): [EventKind, number] {
    const s = this.source;
    const third = pos + 2 < s.length ? s.charCodeAt(pos + 2) : -1;
    if (third === 0x5b) {
      // Il primo `]]>`, e il CDATA deve aprirsi in maiuscolo.
      const close = s.indexOf("]]>", pos + 3);
      if (close < 0 || !s.startsWith("<![CDATA[", pos)) return fail(pos, "unclosed-markup");
      return ["cdata", close + 3];
    }
    if (third === 0x2d) {
      // Il primo `-->` dopo `<!--`: `<!-->` e `<!--->` non si chiudono lì.
      const close = s.indexOf("-->", pos + 4);
      if (close < 0 || !s.startsWith("<!--", pos)) return fail(pos, "unclosed-markup");
      return ["comment", close + 3];
    }
    if (third === 0x44 || third === 0x64) {
      const close = doctypeEnd(s, pos);
      if (close < 0 || close + 1 - pos < 9 || asciiLower(s.slice(pos, pos + 9)) !== "<!doctype") {
        return fail(pos, "unclosed-markup");
      }
      // `quick-xml` vuole un nome dopo `<!DOCTYPE`, e lo cerca prima del `>`.
      if (allSpace(s, pos + 9, close)) return fail(close, "invalid-doctype");
      return ["doctype", close + 1];
    }
    return fail(pos, "invalid-markup");
  }

  /// Rifiuta i caratteri che XML 1.0 non ammette: i controlli C0 salvo
  /// tabulazione e a capo, `U+FFFE`, `U+FFFF` e i surrogati isolati, che in
  /// UTF-8 non esistono.
  private checkChars(start: number, end: number): void {
    const s = this.source;
    for (let i = start; i < end; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0x20 && c < 0xd800) continue;
      if (c < 0x20) {
        if (c === 0x09 || c === 0x0a || c === 0x0d) continue;
        fail(i, "invalid-char");
      }
      if (c === 0xfffe || c === 0xffff) fail(i, "invalid-char");
      if (c >= 0xd800 && c <= 0xdbff) {
        const low = s.charCodeAt(i + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          i++;
          continue;
        }
        fail(i, "invalid-char");
      }
      if (c >= 0xdc00 && c <= 0xdfff) fail(i, "invalid-char");
    }
  }

  private push(node: XmlNode): NodeId {
    const id = this.nodes.length;
    this.nodes.push(node);
    if (node.parent === null) {
      this.top.push(id);
    } else {
      const parent = this.nodes[node.parent]!;
      if (parent.kind === "element") parent.children.push(id);
    }
    return id;
  }

  private parent(): NodeId | null {
    return this.stack.length === 0 ? null : this.stack[this.stack.length - 1]!;
  }

  private textEvent(start: number, end: number): void {
    const s = this.source;
    if (this.stack.length === 0) {
      for (let i = start; i < end; i++) {
        if (!isSpace(s.charCodeAt(i))) fail(i, "content-outside-root");
      }
    }
    const raw = s.slice(start, end);
    if (this.stack.length > 0) {
      const cdataEnd = raw.indexOf("]]>");
      if (cdataEnd >= 0) fail(start + cdataEnd, "cdata-end-in-text");
    }
    this.extendText(start, end, raw.indexOf("\r") >= 0 ? eol(raw) : null);
  }

  /// Accoda `[start, end)` al testo in attesa; `decoded` è il suo valore
  /// quando non coincide con i caratteri.
  private extendText(start: number, end: number, decoded: string | null): void {
    if (this.text !== null && this.text.end !== start) this.flushText();
    const pending = this.text ?? (this.text = { start, end: start, value: null });
    if (decoded === null) {
      if (pending.value !== null) pending.value += this.source.slice(start, end);
    } else {
      pending.value = (pending.value ?? this.source.slice(pending.start, start)) + decoded;
    }
    pending.end = end;
  }

  private flushText(): void {
    const pending = this.text;
    if (pending === null) return;
    this.text = null;
    const raw = this.source.slice(pending.start, pending.end);
    this.push({
      kind: "text",
      value: pending.value ?? raw,
      blank: allSpace(raw, 0, raw.length),
      start: pending.start,
      end: pending.end,
      parent: this.parent(),
    });
  }

  private reference(start: number, end: number): void {
    if (this.stack.length === 0) fail(start, "content-outside-root");
    const parsed = parseReference(this.source, start, end);
    if (parsed === null || parsed[1] !== end - start) fail(start, "invalid-reference");
    const reference = parsed![0];
    if (reference.kind === "char") {
      this.extendText(start, end, reference.char);
      return;
    }
    const value = predefined(reference.name);
    if (value !== null) {
      this.extendText(start, end, value);
      return;
    }
    const entity = this.entities.get(reference.name);
    if (entity?.kind === "internal" || entity?.kind === "external") {
      this.flushText();
      this.push({ kind: "entity-ref", name: reference.name, start, end, parent: this.parent() });
    } else if (entity?.kind === "unparsed") {
      fail(start, "external-entity");
    } else {
      fail(start, "undeclared-entity");
    }
  }

  private open(start: number, end: number, empty: boolean): NodeId {
    this.flushText();
    if (this.stack.length === 0 && this.root !== null) fail(start, "multiple-roots");
    const [tagName, rawAttrs] = scanStartTag(this.source, start, end, empty);
    const values = rawAttrs.map((raw) => this.normalize(raw.value[0], raw.value[1]));

    // Prima le dichiarazioni, che valgono anche per il tag che le porta.
    const mark = this.bindings.length;
    rawAttrs.forEach((raw, i) => {
      let prefix: string | null;
      if (raw.name === "xmlns") prefix = null;
      else if (raw.name.startsWith("xmlns:")) prefix = raw.name.slice(6);
      else return;
      const ns = this.declare(prefix, values[i]!, raw.start);
      this.bindings.push([prefix, ns]);
    });

    const qname = splitQName(tagName);
    if (qname === null) fail(start + 1, "invalid-name");
    const ns = this.resolve(qname![0]);
    if (ns === null) fail(start + 1, "undeclared-prefix");

    const attrs: Attr[] = rawAttrs.map((raw, i) => {
      const parts = splitQName(raw.name);
      if (parts === null) fail(raw.start, "invalid-name");
      const [prefix, local] = parts!;
      let attrNs: number;
      if (raw.name === "xmlns" || prefix === "xmlns") {
        attrNs = NS_XMLNS;
      } else if (prefix !== null) {
        const resolved = this.resolve(prefix);
        if (resolved === null) fail(raw.start, "undeclared-prefix");
        attrNs = resolved!;
      } else {
        attrNs = NS_NONE;
      }
      return { name: raw.name, local, ns: attrNs, value: values[i]!, raw: raw.value };
    });
    checkDuplicates(attrs, rawAttrs);

    const id = this.push({
      kind: "element",
      name: tagName,
      local: qname![1],
      ns: ns!,
      attrs,
      children: [],
      openEnd: end,
      closeStart: null,
      start,
      end,
      parent: this.parent(),
    });
    if (this.root === null) this.root = id;
    this.elements++;
    if (empty) {
      this.bindings.length = mark;
    } else {
      this.stack.push(id);
      this.marks.push(mark);
    }
    return id;
  }

  /// Il namespace di una dichiarazione `xmlns` o `xmlns:prefix`, coi vincoli
  /// di «Namespaces in XML».
  private declare(prefix: string | null, uri: string, at: number): number {
    let invalid: boolean;
    if (prefix === "xml") invalid = uri !== XML_URI;
    else if (prefix === "xmlns") invalid = true;
    else if (prefix !== null) invalid = uri === "" || uri === XML_URI || uri === XMLNS_URI;
    else invalid = uri === XML_URI || uri === XMLNS_URI;
    if (invalid) fail(at, "invalid-namespace-declaration");
    if (prefix !== null && !isNcName(prefix)) fail(at, "invalid-name");
    const known = this.namespaces.indexOf(uri);
    if (known >= 0) return known;
    this.namespaces.push(uri);
    return this.namespaces.length - 1;
  }

  private resolve(prefix: string | null): number | null {
    for (let i = this.bindings.length - 1; i >= 0; i--) {
      const [p, ns] = this.bindings[i]!;
      if (p === prefix) return ns;
    }
    // Senza dichiarazioni il namespace predefinito è nessuno.
    return prefix === null ? NS_NONE : null;
  }

  /// Vero se l'elemento `id` esce dalla testa del documento: un figlio della
  /// radice che non è `title` né `desc`.
  private leavesHead(id: NodeId): boolean {
    const node = this.nodes[id]!;
    if (node.parent === null || node.parent !== this.root || node.kind !== "element") return false;
    return !(isSvg(node, "title") || isSvg(node, "desc"));
  }

  /// Toglie l'ultimo elemento aperto, quello che ha chiuso la testa.
  private retract(id: NodeId, empty: boolean): void {
    if (!empty) {
      this.stack.pop();
      const mark = this.marks.pop();
      if (mark !== undefined) this.bindings.length = mark;
    }
    const parent = this.nodes[id]!.parent;
    if (parent !== null) {
      const node = this.nodes[parent]!;
      if (node.kind === "element") node.children.pop();
    }
    this.nodes.pop();
    this.elements--;
  }

  private close(start: number, end: number): void {
    this.flushText();
    const name = scanEndTag(this.source, start, end);
    const id = this.stack.pop();
    if (id === undefined) return fail(start, "unmatched-end-tag");
    const node = this.nodes[id] as ElementNode;
    if (node.name !== name) fail(start, "mismatched-end-tag");
    node.closeStart = start;
    node.end = end;
    const mark = this.marks.pop();
    if (mark !== undefined) this.bindings.length = mark;
  }

  private comment(start: number, end: number): void {
    this.flushText();
    const body = this.source.slice(start + 4, end - 3);
    const dashes = body.indexOf("--");
    if (dashes >= 0) fail(start + 4 + dashes, "invalid-comment");
    if (body.endsWith("-")) fail(end - 4, "invalid-comment");
    this.push({ kind: "comment", start, end, parent: this.parent() });
  }

  private pi(start: number, end: number): void {
    this.flushText();
    const body = this.source.slice(start + 2, end - 2);
    const targetEnd = scanName(body, 0);
    const target = body.slice(0, targetEnd);
    const valid = target !== ""
      && asciiLower(target) !== "xml"
      && !target.includes(":")
      && (targetEnd === body.length || isSpace(body.charCodeAt(targetEnd)));
    if (!valid) fail(start, "invalid-processing-instruction");
    this.push({ kind: "pi", start, end, parent: this.parent() });
  }

  private decl(start: number, end: number): void {
    this.flushText();
    if (start !== this.bom || this.nodes.length > 0) fail(start, "misplaced-declaration");
    const encoding = parseDecl(this.source.slice(start, end));
    if (encoding === undefined) fail(start, "invalid-declaration");
    this.encoding = encoding ?? null;
    this.push({ kind: "decl", start, end, parent: this.parent() });
  }

  private cdata(start: number, end: number): void {
    this.flushText();
    if (this.stack.length === 0) fail(start, "content-outside-root");
    const value = eol(this.source.slice(start + 9, end - 3));
    this.push({ kind: "cdata", value, start, end, parent: this.parent() });
  }

  private doctypeEvent(start: number, end: number): void {
    this.flushText();
    if (this.root !== null || this.doctype !== null) fail(start, "misplaced-doctype");
    this.entities = parseDoctype(this.source, start, end);
    this.doctype = this.push({ kind: "doctype", start, end, parent: this.parent() });
  }

  /// Il valore di un attributo come lo vede un parser XML (§3.3.3): i
  /// riferimenti espansi, tabulazioni e a capo diventati spazi, `\r\n` uno
  /// spazio solo.
  private normalize(from: number, to: number): string {
    const raw = this.source.slice(from, to);
    const less = raw.indexOf("<");
    if (less >= 0) fail(from + less, "less-than-in-attribute");
    if (!/[&\t\n\r]/.test(raw)) return raw;
    const out: string[] = [];
    this.expand(raw, from, true, out, 0);
    return out.join("");
  }

  /// Espande `text` dentro `out`. `literal` dice se `text` sta nella
  /// sorgente, così gli errori cadono sul carattere giusto; il testo di
  /// un'entità li riporta tutti sul suo riferimento, `at`.
  private expand(text: string, at: number, literal: boolean, out: string[], depth: number): void {
    let i = 0;
    while (i < text.length) {
      let run = i;
      while (run < text.length) {
        const c = text.charCodeAt(run);
        if (c === 0x26 || c === 0x09 || c === 0x0a || c === 0x0d) break;
        run++;
      }
      if (run > i) out.push(text.slice(i, run));
      i = run;
      if (i === text.length) break;
      const here = literal ? at + i : at;
      const c = text.charCodeAt(i);
      if (c === 0x26) {
        const parsed = parseReference(text, i, text.length);
        if (parsed === null) return fail(here, "invalid-reference");
        const [reference, length] = parsed;
        if (reference.kind === "char") {
          out.push(reference.char);
        } else {
          const value = predefined(reference.name);
          if (value !== null) out.push(value);
          else this.expandEntity(reference.name, here, out, depth);
        }
        i += length;
      } else if (c === 0x0d && text.charCodeAt(i + 1) === 0x0a) {
        out.push(" ");
        i += 2;
      } else {
        out.push(" ");
        i++;
      }
    }
  }

  private expandEntity(name: string, at: number, out: string[], depth: number): void {
    const entity = this.entities.get(name);
    if (entity?.kind === "external" || entity?.kind === "unparsed") fail(at, "external-entity");
    if (entity?.kind !== "internal") return fail(at, "undeclared-entity");
    if (entity.text.includes("<")) fail(at, "less-than-in-attribute");
    this.expanded += entity.bytes;
    if (depth >= MAX_ENTITY_DEPTH || this.expanded > MAX_ENTITY_EXPANSION) fail(at, "entity-limit");
    this.expand(entity.text, at, false, out, depth + 1);
  }

  /// Chiude la lettura; `stop` è l'indice a cui si è fermata la lettura della
  /// sola testa.
  finish(stop: number | null): NodeId {
    this.flushText();
    if (this.root === null) return fail(this.source.length, "missing-root");
    if (stop === null) {
      const open = this.stack[this.stack.length - 1];
      if (open !== undefined) fail(this.nodes[open]!.start, "unclosed-element");
    } else {
      // La lettura si è fermata dentro la radice: i nodi aperti finiscono
      // dove è finita la lettura.
      for (const open of this.stack) this.nodes[open]!.end = stop;
    }
    return this.root;
  }
}

/// Rifiuta due attributi con lo stesso nome, o con lo stesso nome espanso.
function checkDuplicates(attrs: readonly Attr[], raw: readonly RawAttr[]): void {
  const names = new Set<string>();
  const expanded = new Set<string>();
  attrs.forEach((attr, i) => {
    const key = `${attr.ns} ${attr.local}`;
    const fresh = !names.has(attr.name) && (attr.ns === NS_NONE || !expanded.has(key));
    if (!fresh) fail(raw[i]!.start, "duplicate-attribute");
    names.add(attr.name);
    if (attr.ns !== NS_NONE) expanded.add(key);
  });
}

/// Legge `source` come documento XML con namespace. Lancia [`XmlError`] se non
/// è ben formato.
///
/// Con `headOnly` si ferma al primo figlio della radice che non è `title` o
/// `desc`: è la lettura dei file oltre il limite di §11, che indicizza solo
/// titolo e riepilogo.
export function parseXml(source: SourceText, headOnly: boolean): XmlDocument {
  const parser = new Parser(source.text);
  try {
    const stop = parser.run(headOnly);
    const root = parser.finish(stop);
    return new XmlDocument(
      source,
      parser.nodes,
      parser.top,
      root,
      parser.encoding,
      parser.doctype,
      parser.elements,
      stop === null,
      parser.entities,
      parser.namespaces,
    );
  } catch (error) {
    if (error instanceof Failure) throw new XmlError(source.byteOf(error.index), error.kind);
    throw error;
  }
}
