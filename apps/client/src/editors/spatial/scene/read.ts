// La lettura di una scena: dal testo del file alla `Scene` che descrive che
// cosa è modificabile, che cosa è estraneo e dove sta, byte per byte e unità
// per unità (formato della scena; DEC-05, DEC-08).
//
// È `read` di `fub-scene` (`lib.rs`), e la scena che restituisce è la stessa
// di Rust anche nella forma JSON: chiavi in camelCase, span appiattiti accanto
// ai campi della voce, chiavi facoltative assenti invece che `undefined`. Un
// test confronta le due su ogni fixture di `__fixtures__/scene/`.
//
// Niente qui tocca il DOM: la sorgente si legge con lo scanner di `xml.ts`, e
// della sorgente non arriva al documento vivo nemmeno un nodo.

import { index as analyzeIndex, truncatedSummary, type Index, type Summary } from "./analysis";
import { classifyDocument, type Item } from "./classify";
import { diagnostic, sortDiagnostics, type Diagnostic } from "./diagnostics";
import { bomUnits, lineBreakOf, lineEndingOf, SourceText, type LineEnding } from "./text";
import { isSvg, NS_FUB, NS_NONE, parseXml, valueOf, XML_ERROR_MESSAGES, XmlError, type XmlDocument, type XmlErrorKind } from "./xml";

export { SVG_NS, FUB_NS, XLINK_NS } from "./xml";

/// La versione del formato che questo lettore sa modificare.
export const SUPPORTED_VERSION = 1;

/// La dimensione in byte UTF-8 oltre la quale un file si apre in sola lettura
/// e si indicizzano solo titolo e riepilogo (§11).
export const MAX_EDIT_BYTES = 20 * 1024 * 1024;

/// Quanti elementi può avere un documento modificabile (§11).
export const MAX_ELEMENTS = 50_000;

/// Che documento è: con `fub:version` sulla radice, o un SVG qualunque che
/// la superficie mostra inerte e adotta con «Modifica» (DEC-04).
export type Status = "fubdraw" | "foreign";

/// Perché un documento si apre in sola lettura, nell'ordine in cui la scena
/// le elenca.
export type ReadOnly =
  | "doctype"
  | "encoding"
  | "invalid-version"
  | "future-version"
  | "duplicate-id"
  | "too-large"
  | "too-many-elements";

const READ_ONLY_ORDER: readonly ReadOnly[] = [
  "doctype",
  "encoding",
  "invalid-version",
  "future-version",
  "duplicate-id",
  "too-large",
  "too-many-elements",
];

/// Una scena letta.
export interface Scene {
  readonly status: Status;
  /// Le ragioni della sola lettura, in ordine fisso; vuota se il documento si
  /// può modificare.
  readonly readOnly: readonly ReadOnly[];
  /// `fub:version`, se è un intero positivo che sta in 32 bit.
  readonly version: number | null;
  /// Se il file comincia con il BOM, che resta.
  readonly bom: boolean;
  /// I terminatori che il file usa.
  readonly lineEnding: LineEnding;
  /// Il terminatore delle righe nuove: il prevalente.
  readonly lineBreak: Exclude<LineEnding, "mixed">;
  /// Vero se il file supera [`MAX_EDIT_BYTES`]: se ne è letta solo la testa,
  /// e le voci sono vuote.
  readonly truncated: boolean;
  /// Le voci in ordine di documento. Sono vuote se il file è troncato o ha
  /// più di [`MAX_ELEMENTS`] elementi.
  readonly items: readonly Item[];
  /// Titolo, descrizione, testi, collegamenti e immagini del vault, di tutto
  /// il documento: anche di ciò che è estraneo.
  readonly index: Index;
  /// Il riepilogo di `fub.scene.summary`, anche quando le voci sono vuote.
  readonly summary: Summary;
  readonly diagnostics: readonly Diagnostic[];
}

/// Vero se la superficie può modificare il documento così com'è: un
/// documento FubDraw senza ragioni di sola lettura.
export function isEditable(scene: Scene): boolean {
  return scene.status === "fubdraw" && scene.readOnly.length === 0;
}

/// Perché una sorgente non è una scena. `offset` è in byte UTF-8, BOM
/// compreso, come `ReadError` di Rust.
export class ReadError extends Error {
  /// `malformed`: non è XML ben formato, e `xml` dice perché. `not-svg`: è
  /// XML, ma la radice non è `svg` nel namespace SVG.
  readonly kind: "malformed" | "not-svg";
  readonly offset: number;
  readonly xml: XmlErrorKind | null;

  constructor(kind: "malformed" | "not-svg", offset: number, xml: XmlErrorKind | null = null) {
    super(
      kind === "malformed"
        ? `XML non ben formato al byte ${offset}: ${XML_ERROR_MESSAGES[xml!]}`
        : `la radice al byte ${offset} non è un elemento svg di SVG`,
    );
    this.name = "ReadError";
    this.kind = kind;
    this.offset = offset;
    this.xml = xml;
  }
}

/// La prima metà di una lettura: il documento XML e i fatti che decidono se
/// si può modificare, senza classificazione né indice. È ciò che serve al
/// motore delle operazioni, che costruisce il suo modello dal documento
/// senza rileggerlo.
export interface Opened {
  readonly text: SourceText;
  readonly doc: XmlDocument;
  readonly status: Status;
  /// Le ragioni della sola lettura, in ordine fisso.
  readonly readOnly: readonly ReadOnly[];
  readonly version: number | null;
  /// Il file supera [`MAX_EDIT_BYTES`]: `doc` ne ha solo la testa.
  readonly truncated: boolean;
  /// Il file ha più di [`MAX_ELEMENTS`] elementi.
  readonly tooMany: boolean;
  /// S003, S007 e S008, non ancora ordinate.
  readonly diagnostics: Diagnostic[];
}

/// Apre `source`, il testo intero del file, BOM compreso. Lancia
/// [`ReadError`] se non è XML ben formato o se la radice non è `svg`.
export function openSource(source: string): Opened {
  const text = new SourceText(source);
  const truncated = text.byteLength > MAX_EDIT_BYTES;
  let doc: XmlDocument;
  try {
    doc = parseXml(text, truncated);
  } catch (error) {
    if (error instanceof XmlError) throw new ReadError("malformed", error.offset, error.kind);
    throw error;
  }
  const root = doc.element(doc.root)!;
  if (!isSvg(root, "svg")) throw new ReadError("not-svg", text.byteOf(root.start));

  const readOnly = new Set<ReadOnly>();
  const diagnostics: Diagnostic[] = [];
  if (doc.doctype !== null) {
    readOnly.add("doctype");
    const node = doc.nodes[doc.doctype]!;
    diagnostics.push(diagnostic("S008", text.span(node.start, node.end)));
  }
  if (doc.encoding !== null && asciiLower(doc.encoding) !== "utf-8") readOnly.add("encoding");

  const rawVersion = valueOf(root, NS_FUB, "version");
  const status: Status = rawVersion === undefined ? "foreign" : "fubdraw";
  let version: number | null = null;
  if (rawVersion !== undefined) {
    if (!/^[0-9]+$/.test(rawVersion)) {
      readOnly.add("invalid-version");
    } else {
      // Cifre ASCII soltanto: `Number` le legge come `u32::from_str`, e un
      // valore oltre 2³² − 1 resta oltre anche arrotondato.
      const parsed = Number(rawVersion);
      if (parsed === 0) {
        readOnly.add("invalid-version");
      } else if (parsed > 0xffff_ffff) {
        // Cifre che non stanno in 32 bit: una versione futura, e grande.
        readOnly.add("future-version");
        diagnostics.push(diagnostic("S007", null, rawVersion));
      } else {
        version = parsed;
      }
    }
  }
  if (version !== null && version > SUPPORTED_VERSION) {
    readOnly.add("future-version");
    diagnostics.push(diagnostic("S007", null, String(version)));
  }
  if (duplicateIds(doc, diagnostics)) readOnly.add("duplicate-id");
  if (truncated) readOnly.add("too-large");
  const tooMany = doc.elements > MAX_ELEMENTS;
  if (tooMany) readOnly.add("too-many-elements");
  return {
    text,
    doc,
    status,
    readOnly: READ_ONLY_ORDER.filter((reason) => readOnly.has(reason)),
    version,
    truncated,
    tooMany,
    diagnostics,
  };
}

/// Legge una scena da `source`, il testo intero del file, BOM compreso.
/// Lancia [`ReadError`] se non è XML ben formato o se la radice non è `svg`.
///
/// Un file oltre [`MAX_EDIT_BYTES`] si legge solo fino al primo figlio della
/// radice che non è `title` o `desc`: abbastanza per titolo e riepilogo, con
/// `truncated: true`.
export function readScene(source: string): Scene {
  const { doc, status, readOnly, version, truncated, tooMany, diagnostics } = openSource(source);

  // Le voci di un documento enorme costerebbero più del documento: non
  // servono, perché si apre solo in Lettura. Si classifica comunque, per il
  // riepilogo e la diagnostica; di un file troncato c'è solo la testa.
  let items: readonly Item[] = [];
  let summary: Summary;
  if (truncated) {
    summary = truncatedSummary(status === "foreign", version);
  } else {
    const classified = classifyDocument(doc, !tooMany);
    diagnostics.push(...classified.diagnostics);
    summary = classified.tally.finish(status === "foreign", version, diagnostics);
    items = classified.items;
  }
  const index = analyzeIndex(doc, diagnostics);
  sortDiagnostics(diagnostics);
  return {
    status,
    readOnly,
    version,
    bom: bomUnits(source) > 0,
    lineEnding: lineEndingOf(source),
    lineBreak: lineBreakOf(source),
    truncated,
    items,
    index,
    summary,
    diagnostics,
  };
}

/// `to_ascii_lowercase` di Rust.
function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/// Segnala con S003 ogni elemento che ripete l'id di uno precedente, in
/// qualunque namespace: un'operazione per id deve trovare un elemento solo.
/// Restituisce vero se ce n'è almeno uno.
function duplicateIds(doc: XmlDocument, out: Diagnostic[]): boolean {
  const seen = new Set<string>();
  let found = false;
  for (const node of doc.nodes) {
    if (node.kind !== "element") continue;
    const id = valueOf(node, NS_NONE, "id");
    if (id === undefined || id === "") continue;
    if (seen.has(id)) {
      found = true;
      out.push(diagnostic("S003", doc.source.span(node.start, node.end), id));
    } else {
      seen.add(id);
    }
  }
  return found;
}
