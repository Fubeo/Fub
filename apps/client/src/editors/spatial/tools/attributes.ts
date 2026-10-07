// Gli attributi di un oggetto, per il pannello del livello Esperto: che cosa
// si legge, che cosa si cambia e come si scrive. Il pannello è in
// `inspector.ts`; qui stanno le regole, senza DOM.
//
// - **Il file com'è.** Le righe sono gli attributi scritti nel tag,
//   nell'ordine canonico del formato della scena (§7), coi valori come li
//   legge un parser: le entità risolte, le unità come sono scritte.
// - **Si cambia ciò che il formato ammette**, e si scrive come lo scrive
//   FubDraw: colori `#rrggbb` o `none`, lunghezze in unità utente con al più
//   due decimali, `transform` come una `matrix` sola, tolta se è l'identità,
//   `d` coi comandi assoluti. Un valore che il formato non ammette non parte:
//   renderebbe estraneo l'oggetto.
// - **Ciò che ha un padrone si legge soltanto.** Il `d` di un tratto viene
//   dall'inchiostro e quello di una freccia dalla sua geometria; gli attributi
//   `fub:*` li scrive FubDraw, quelli di altri namespace altri programmi; gli
//   `href` hanno i loro comandi. Una freccia a cui cambia lo spessore
//   ridisegna la punta, che ne dipende.
// - **Si aggiunge ciò che serve all'oggetto**: niente contorno su un tratto,
//   che è tutto riempimento, niente carattere su un rettangolo.
// - **L'id è un nome.** Uno scritto a mano comincia con una lettera o `_` e
//   continua con lettere, cifre, `_`, `.` e `-`, fino a 64 caratteri; è unico
//   nel documento, e `fub-` è del formato. Un id che una parte estranea del
//   disegno cita non si cambia, perché il riferimento si romperebbe.

import type { Details, Tag } from "../scene/classify";
import { svgAttribute } from "../scene/classify";
import { parsePath } from "../scene/geometry";
import { pathOf, type ElementPart } from "../scene/model";
import type { Op } from "../scene/ops";
import { attributeKey, canonicalOrder, pathData, type OutAttr } from "../scene/serialize";
import {
  dasharray,
  keyword,
  keywords,
  length,
  letterSpacing,
  nonNegativeLength,
  opacity,
  points,
  preserveAspectRatio,
  textDecoration,
  transform,
  trim,
} from "../scene/values";
import { FUB_NS, XLINK_NS, XMLNS_URI } from "../scene/xml";
import type { Role } from "../scene/analysis";
import { formatNumber } from "../number";
import { readHead } from "./arrange";
import { transformValue, type NewIds } from "./edit";
import { customColor } from "./palette";
import { arrowPath } from "./shapes";
import { TEXT_FAMILIES, TEXT_FAMILY } from "./text";

/// Quanti caratteri al più ha un id scritto a mano.
export const MAX_ID_LENGTH = 64;

/// Oltre questi caratteri un valore si legge soltanto: un `d` tracciato da un
/// altro programma può pesare megabyte, e un campo non è il posto dove
/// cambiarlo.
export const EDIT_LIMIT = 100_000;

/// I decimali di un'opacità scritta a mano, come quelli che separare un
/// gruppo moltiplica.
const OPACITY_PLACES = 4;

/// Un nome: una lettera o `_`, poi lettere, segni, cifre, `_`, `.` e `-`.
const NAME = /^[\p{L}_][\p{L}\p{M}\p{N}_.-]*$/u;

/// Un carattere che continua un nome, in un riferimento.
const NAME_CHAR = /[\p{L}\p{M}\p{N}_.:-]/u;

/// Che genere di valore vuole un attributo.
export type Kind =
  | "paint"
  | "length"
  | "size"
  | "opacity"
  | "dashes"
  | "keyword"
  | "spacing"
  | "decoration"
  | "family"
  | "transform"
  | "points"
  | "path"
  | "aspect";

const KINDS: ReadonlyMap<string, Kind> = new Map(Object.entries({
  fill: "paint",
  stroke: "paint",
  "fill-opacity": "opacity",
  "stroke-opacity": "opacity",
  opacity: "opacity",
  "stroke-width": "size",
  "font-size": "size",
  width: "size",
  height: "size",
  r: "size",
  rx: "size",
  ry: "size",
  x: "length",
  y: "length",
  dy: "length",
  cx: "length",
  cy: "length",
  x1: "length",
  y1: "length",
  x2: "length",
  y2: "length",
  "stroke-dasharray": "dashes",
  "stroke-linecap": "keyword",
  "stroke-linejoin": "keyword",
  display: "keyword",
  "font-weight": "keyword",
  "font-style": "keyword",
  "letter-spacing": "spacing",
  "text-decoration": "decoration",
  "text-anchor": "keyword",
  "font-family": "family",
  transform: "transform",
  points: "points",
  d: "path",
  preserveAspectRatio: "aspect",
} satisfies Record<string, Kind>));

/// Il genere di valore di `key`; `null` per ciò che il pannello non scrive.
export function kindOf(key: string): Kind | null {
  return KINDS.get(key) ?? null;
}

/// Perché una riga si legge soltanto.
export type Note =
  /// Il `d` di un tratto, che viene dall'inchiostro.
  | "ink"
  /// Il `d` di una freccia, che viene dalla sua geometria.
  | "arrow"
  /// Il `d` di un poligono regolare o di una stella, che viene dai loro
  /// parametri.
  | "shape"
  /// Il `d` di una linea a spessore variabile, che viene dalla linea e dal
  /// profilo.
  | "width"
  /// Un attributo `fub:*`.
  | "fubdraw"
  /// L'`href` di un collegamento, che ha il suo comando.
  | "link"
  /// L'`href` di un'immagine.
  | "image"
  /// Un attributo di un altro namespace, che si conserva.
  | "namespace"
  /// Un valore oltre [`EDIT_LIMIT`].
  | "long";

/// Come si scrive un valore: una riga, più righe, o una scelta.
export type Field =
  | { readonly kind: "line" }
  | { readonly kind: "area" }
  | { readonly kind: "choice"; readonly options: readonly string[] };

const LINE: Field = { kind: "line" };
const AREA: Field = { kind: "area" };

/// Un attributo scritto nel tag.
export interface Row {
  /// Il nome come lo scrive un'operazione: `fill`, `fub:geom`,
  /// `inkscape:label`.
  readonly key: string;
  readonly value: string;
  /// Perché si legge soltanto; `null` se si cambia e si toglie.
  readonly note: Note | null;
  readonly field: Field;
}

/// Un oggetto come lo mostra il pannello.
export interface Subject {
  readonly tag: Tag;
  readonly role: Role;
  readonly id: string | null;
  readonly path: readonly number[];
  readonly rows: readonly Row[];
  /// Gli attributi che si possono aggiungere, nell'ordine canonico.
  readonly addable: readonly string[];
  /// `x1 y1 x2 y2` di una freccia, che ne ridisegna la punta.
  readonly arrow: readonly [number, number, number, number] | null;
}

// ---------------------------------------------------------------------------
// Le righe.
// ---------------------------------------------------------------------------

const PAINT = ["fill", "fill-opacity"];
const OUTLINE = ["stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "stroke-dasharray"];
const COMMON = ["opacity", "display", "transform"];
const TYPE = ["font-family", "font-size", "font-weight", "font-style", "letter-spacing", "text-anchor"];

/// Le linee del testo, che non si ereditano: solo di un testo.
const TEXT_TYPE = ["font-family", "font-size", "font-weight", "font-style", "letter-spacing", "text-decoration", "text-anchor"];

const GEOMETRY: Readonly<Partial<Record<Role, readonly string[]>>> = {
  rect: ["x", "y", "width", "height", "rx", "ry"],
  ellipse: ["cx", "cy", "rx", "ry"],
  circle: ["cx", "cy", "r"],
  line: ["x1", "y1", "x2", "y2"],
  polyline: ["points"],
  polygon: ["points"],
  path: ["d"],
  text: ["x", "y"],
  image: ["x", "y", "width", "height", "preserveAspectRatio"],
};

/// Gli attributi che hanno senso su un oggetto di ruolo `role`.
function offered(role: Role): readonly string[] {
  const geometry = GEOMETRY[role] ?? [];
  switch (role) {
    // Un tratto e una linea a spessore variabile sono tutti riempimento.
    case "stroke":
    case "width":
      return [...PAINT, ...COMMON];
    // Una freccia è tutta contorno.
    case "arrow":
      return [...OUTLINE, ...COMMON];
    case "line":
      return [...geometry, ...OUTLINE, ...COMMON];
    case "image":
      return [...geometry, ...COMMON];
    case "text":
      return [...geometry, ...PAINT, ...OUTLINE, ...COMMON, ...TEXT_TYPE];
    case "group":
    case "link":
      return [...PAINT, ...OUTLINE, ...COMMON, ...TYPE];
    default:
      return [...geometry, ...PAINT, ...OUTLINE, ...COMMON];
  }
}

/// I nomi nell'ordine canonico (§7).
function inCanonicalOrder(keys: readonly string[]): string[] {
  return canonicalOrder(keys.map((local) => ({ name: local, uri: "", local, text: "" }))).map((attr) => attr.local);
}

/// La riga di un attributo letto.
function rowOf(role: Role, attr: OutAttr): Row {
  const key = attributeKey(attr);
  const value = attr.text;
  const read = (note: Note): Row => ({ key, value, note, field: LINE });
  if (attr.uri === FUB_NS) return read("fubdraw");
  if (attr.local === "href" && (attr.uri === "" || attr.uri === XLINK_NS)) return read(role === "link" ? "link" : "image");
  if (attr.uri !== "") return read("namespace");
  if (attr.local === "d" && role === "stroke") return read("ink");
  if (attr.local === "d" && role === "arrow") return read("arrow");
  if (attr.local === "d" && (role === "ngon" || role === "star")) return read("shape");
  if (attr.local === "d" && role === "width") return read("width");
  if (value.length > EDIT_LIMIT) return read("long");
  switch (kindOf(key)) {
    case "keyword":
      return { key, value, note: null, field: { kind: "choice", options: keywords(key) } };
    case "family":
      return { key, value, note: null, field: { kind: "choice", options: familiesWith(value) } };
    case "points":
    case "path":
      return { key, value, note: null, field: AREA };
    case null:
      return read("namespace");
    default:
      return { key, value, note: null, field: LINE };
  }
}

/// Il campo di un attributo che si aggiunge: le scelte del suo genere, o più
/// righe per punti e percorsi.
export function fieldOf(key: string): Field {
  switch (kindOf(key)) {
    case "keyword":
      return { kind: "choice", options: keywords(key) };
    case "family":
      return { kind: "choice", options: TEXT_FAMILIES };
    case "points":
    case "path":
      return AREA;
    default:
      return LINE;
  }
}

/// I caratteri che il file scrive, più `value` se è un altro: un valore letto
/// resta fra le scelte finché non si cambia.
function familiesWith(value: string): readonly string[] {
  return TEXT_FAMILIES.includes(value) ? TEXT_FAMILIES : [...TEXT_FAMILIES, value];
}

const subjects = new WeakMap<ElementPart, Subject | null>();

/// L'oggetto `node` come lo mostra il pannello; `null` se non è un elemento
/// modificabile. Un nodo che un'operazione non tocca resta lo stesso
/// oggetto, e si rilegge una volta sola.
export function subjectOf(node: ElementPart): Subject | null {
  const known = subjects.get(node);
  if (known !== undefined) return known;
  const subject = readSubject(node);
  subjects.set(node, subject);
  return subject;
}

function readSubject(node: ElementPart): Subject | null {
  const details: Details | null = node.details;
  const read = readHead(node);
  if (details === null || read === null) return null;
  const { doc, element } = read;
  const attrs: OutAttr[] = [];
  for (const attr of element.attrs) {
    const uri = doc.namespaces[attr.ns] ?? "";
    if (uri === XMLNS_URI || (uri === "" && attr.local === "id")) continue;
    attrs.push({ name: attr.name, uri, local: attr.local, text: attr.value });
  }
  const rows = canonicalOrder(attrs).map((attr) => rowOf(details.role, attr));
  const present = new Set(rows.map((row) => row.key));
  return {
    tag: details.tag,
    role: details.role,
    id: node.facts.id,
    path: pathOf(node),
    rows,
    addable: inCanonicalOrder(offered(details.role).filter((key) => !present.has(key))),
    arrow: details.role === "arrow" ? (details.arrow ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// I valori.
// ---------------------------------------------------------------------------

/// Il valore di partenza di un attributo che si aggiunge: quello iniziale di
/// SVG, che non cambia niente, dove c'è.
export function initialValue(key: string): string {
  switch (kindOf(key)) {
    case "paint":
      return key === "fill" ? "#000000" : "none";
    case "opacity":
      return "1";
    case "size":
      return key === "stroke-width" ? "1" : key === "font-size" ? "16" : "0";
    case "length":
      return "0";
    case "dashes":
      return "none";
    case "spacing":
      return "normal";
    case "decoration":
      return "none";
    case "keyword":
      return keywords(key)[key === "display" ? 1 : 0] ?? "";
    case "family":
      return TEXT_FAMILY;
    case "aspect":
      return "xMidYMid meet";
    default:
      return "";
  }
}

/// Che cosa non va in un valore: vuoto, o non del suo genere.
export type ValueProblem = "empty" | Kind;

/// Un valore come lo scrive il file; `null` toglie l'attributo, come una
/// `transform` che è l'identità.
export type Canonical = { readonly value: string | null } | { readonly problem: ValueProblem };

/// `input`, scritto per l'attributo `key` di un `tag`, come lo scrive il file.
export function canonicalValue(tag: Tag, key: string, input: string): Canonical {
  const kind = kindOf(key);
  if (kind === null) throw new Error(`il pannello non scrive ${key}`);
  const text = trim(input);
  if (text === "") return { problem: "empty" };
  const value = written(kind, key, text);
  if (value === undefined) return { problem: kind };
  // Ciò che si scrive deve rileggersi come il formato lo ammette: un numero
  // che arrotondato esce da un float a 32 bit, per esempio, no.
  if (value !== null && !svgAttribute(tag, key, value)) return { problem: kind };
  return { value };
}

/// `text` scritto come lo scrive il file; `undefined` se non è del genere
/// `kind`.
function written(kind: Kind, key: string, text: string): string | null | undefined {
  const place = (value: number | null, decimals = 2): string | undefined => (value === null ? undefined : formatNumber(value, decimals));
  switch (kind) {
    case "paint":
      return text === "none" ? "none" : (customColor(text) ?? undefined);
    case "length":
      return place(length(text));
    case "size":
      return place(nonNegativeLength(text));
    case "opacity":
      return place(opacity(text), OPACITY_PLACES);
    case "dashes": {
      if (!dasharray(text)) return undefined;
      if (text === "none") return "none";
      return text
        .split(/[\t\n\f\r ,]+/)
        .filter((part) => part !== "")
        .map((part) => formatNumber(nonNegativeLength(part)!, 2))
        .join(" ");
    }
    case "keyword":
      return keyword(key, text) ? text : undefined;
    case "spacing":
      return trim(text) === "normal" ? "normal" : place(letterSpacing(text));
    case "decoration": {
      const lines = textDecoration(text);
      return lines === null ? undefined : lines.length === 0 ? "none" : lines.join(" ");
    }
    case "family":
      return TEXT_FAMILIES.includes(text) ? text : undefined;
    case "transform": {
      const m = transform(text);
      return m === null ? undefined : transformValue(m);
    }
    case "points": {
      const pairs = points(text);
      if (pairs === null) return undefined;
      return pairs.map(([x, y]) => `${formatNumber(x, 2)},${formatNumber(y, 2)}`).join(" ");
    }
    case "path": {
      const segments = parsePath(text);
      return segments === null ? undefined : pathData(segments);
    }
    case "aspect":
      return preserveAspectRatio(text) ? text.split(/[\t\n\f\r ]+/).join(" ") : undefined;
  }
}

// ---------------------------------------------------------------------------
// Le operazioni.
// ---------------------------------------------------------------------------

/// Un cambio pronto: le operazioni, in un `batch`, e l'id dell'oggetto dopo.
export interface Change {
  readonly ops: readonly Op[];
  readonly id: string;
}

/// Scrive `value` in `key`, o lo toglie con `null`. Un oggetto senza id ne
/// riceve uno; una freccia a cui cambia lo spessore ridisegna la punta.
export function attributeOps(subject: Subject, key: string, value: string | null, ids: NewIds): Change {
  const ops: Op[] = [];
  let id = subject.id;
  if (id === null) {
    id = ids.next("object");
    ops.push({ op: "ident", path: [...subject.path], tag: subject.tag, id });
  }
  const attrs: Record<string, string | null> = { [key]: value };
  if (subject.arrow !== null && key === "stroke-width") {
    const [x1, y1, x2, y2] = subject.arrow;
    // Senza spessore vale quello iniziale, 1.
    attrs.d = arrowPath(x1, y1, x2, y2, value === null ? 1 : (nonNegativeLength(value) ?? 1));
  }
  ops.push({ op: "set", id, attrs });
  return { ops, id };
}

/// Che cosa non va in un id nuovo.
export type IdProblem =
  | "empty"
  | "long"
  | "form"
  /// Comincia con `fub-`, come gli id del formato.
  | "reserved"
  /// Un altro elemento lo porta già.
  | "taken"
  /// Una parte estranea del disegno cita l'id di adesso.
  | "cited";

/// Che cosa non va nel dare l'id `next` a `subject`; `null` se va bene.
/// `taken` dice se un elemento del documento porta già un id, `cited` se una
/// parte estranea del disegno lo cita.
export function idProblem(subject: Subject, next: string, taken: (id: string) => boolean, cited: (id: string) => boolean): IdProblem | null {
  if (next === "") return "empty";
  if ([...next].length > MAX_ID_LENGTH) return "long";
  if (!NAME.test(next)) return "form";
  if (next.toLowerCase().startsWith("fub-")) return "reserved";
  if (next !== subject.id && taken(next)) return "taken";
  if (subject.id !== null && subject.id !== next && cited(subject.id)) return "cited";
  return null;
}

/// Dà a `subject` l'id `next`: uno solo se non ne ha, altrimenti tolto il
/// vecchio, così che l'undo lo rimetta com'era scritto.
export function renameOps(subject: Subject, next: string): Op[] {
  const at = { path: [...subject.path], tag: subject.tag };
  if (subject.id === null) return [{ op: "ident", ...at, id: next }];
  return [
    { op: "ident", ...at, id: null },
    { op: "ident", ...at, id: next },
  ];
}

/// Vero se `text` cita l'id `id`: un `url(#id)`, un `href="#id"`, un
/// selettore `#id` di un foglio di stile.
export function cites(text: string, id: string): boolean {
  const needle = `#${id}`;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    const next = String.fromCodePoint(text.codePointAt(at + needle.length) ?? 0x20);
    if (!NAME_CHAR.test(next)) return true;
  }
  return false;
}
