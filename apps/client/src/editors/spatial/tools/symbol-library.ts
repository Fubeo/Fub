// Le librerie di simboli (Disegni, simboli; formato della scena, simboli,
// §4): un disegno del vault coi suoi simboli, da cui se ne copia uno nel
// disegno aperto.
//
// - **Leggere** una libreria dà i suoi simboli modificabili, in ordine di
//   documento, col nome e l'impronta. Un file più grande di quanto un
//   disegno si modifica, o che non è un disegno di FubDraw, non è una
//   libreria, e lo si dice.
// - **La copia** di un simbolo è un SVG come quello degli appunti: una sua
//   istanza, e nella `defs` il simbolo con ciò che usa. Ogni simbolo della
//   libreria che vi entra porta `fub:source`: il percorso, il suo id e la
//   sua impronta. Il disegno la riceve come un incolla (`clipboard.ts`):
//   un simbolo uguale che ha già resta il suo, e un nome preso cambia.
// - **Inserire** un simbolo che il disegno ha già dalla stessa libreria, con
//   lo stesso percorso e lo stesso id, è un'istanza del suo: un simbolo di
//   una libreria entra una volta sola, e se la libreria è cambiata lo si
//   aggiorna.
// - **Aggiornare** dà al simbolo del disegno il contenuto di quello della
//   libreria al posto del suo, col suo id, il suo nome e le sue istanze;
//   `fub:source` prende l'impronta di adesso. Le risorse che il contenuto
//   di prima usava e che nessuno usa più se ne vanno, come sempre.
// - **Le copie si fanno in piccolo:** una libreria tiene i testi dei suoi
//   simboli e delle sue risorse, e la copia di un simbolo, o la sua
//   anteprima, parte da un disegno che ha soltanto la radice della libreria
//   e ciò che il simbolo usa, non da tutta la libreria.

import { ReadError, readScene } from "../scene/read";
import type { Bounds } from "../scene/geometry";
import { elementChildren, pathOf, type ContainerNode, type DocumentModel } from "../scene/model";
import { MAX_EDIT_BYTES } from "../scene/read";
import type { Op } from "../scene/ops";
import { SceneEngine } from "../scene/engine";
import { utf8Length } from "../scene/text";
import { copySvg, planPaste, readPaste } from "./clipboard";
import { NewIds, type Destination } from "./edit";
import { IDENTITY } from "../scene/matrix";
import { documentSymbols, readOrigin, resourceTexts, sourceValue, symbolClosure, symbolNode, type DocumentSymbol } from "./symbols";

export { readOrigin, sourceValue, type Origin } from "./symbols";

/// Il file più grande che si legge come libreria: quanto un disegno si
/// modifica.
export const LIBRARY_MAX_BYTES = MAX_EDIT_BYTES;

/// Un simbolo di una libreria.
export interface LibrarySymbol {
  /// L'id nella libreria.
  readonly id: string;
  /// Il primo `title`; vuoto senza.
  readonly name: string;
  /// L'impronta, 16 cifre esadecimali.
  readonly print: string;
}

/// Ciò che serve a copiare i simboli di un disegno senza rileggerlo: il tag
/// d'apertura della radice, com'è scritto, il nome della radice e i testi dei
/// simboli e delle risorse per id.
export interface SymbolSheet {
  readonly head: string;
  readonly name: string;
  readonly texts: (id: string) => string | undefined;
}

/// Una libreria letta: il percorso nel vault, il testo, i simboli e ciò che
/// serve a copiarli.
export interface Library {
  readonly path: string;
  readonly text: string;
  readonly symbols: readonly LibrarySymbol[];
  readonly sheet: SymbolSheet;
}

/// Perché un file non è una libreria: troppo grande, o non è un disegno di
/// FubDraw che si modifica.
export type LibraryProblem = "too-large" | "not-drawing";

/// La copia di un simbolo pronta da incollare, e il riquadro dell'istanza.
export interface SymbolCopy {
  readonly svg: string;
  readonly frame: Bounds;
}

const OFFSET_HI = 0xcbf29ce4;
const OFFSET_LO = 0x84222325;
/// Il primo FNV a 64 bit è 2⁴⁰ + 0x1b3.
const PRIME_LO = 0x1b3;

/// FNV-1a a 64 bit dei byte UTF-8 di `text`, in 16 cifre esadecimali
/// minuscole: in due metà da 32 bit, perché un `number` non ne tiene 64.
export function fnv1a64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let hi = OFFSET_HI;
  let lo = OFFSET_LO;
  for (let i = 0; i < bytes.length; i++) {
    lo = (lo ^ bytes[i]!) >>> 0;
    // (hi·2³² + lo)·(2⁴⁰ + 0x1b3), modulo 2⁶⁴.
    const low = lo * PRIME_LO;
    const high = hi * PRIME_LO + Math.floor(low / 0x100000000) + ((lo << 8) >>> 0);
    lo = low >>> 0;
    hi = high >>> 0;
  }
  return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
}

/// Il testo a LF.
const lf = (text: string): string => (text.indexOf("\r") < 0 ? text : text.replace(/\r\n?/g, "\n"));

/// L'impronta di una chiusura: i testi, ognuno dopo un a capo, a LF.
const printOf = (closure: ReadonlyArray<readonly [string, string]>): string => fnv1a64(closure.map(([, text]) => lf(text)).join("\n"));

/// L'impronta del simbolo `id` del disegno `model` (formato della scena,
/// simboli, §4): il simbolo e ciò che usa, ognuno dopo un a capo, a LF.
export function symbolPrint(model: DocumentModel, id: string): string {
  return printOf(symbolClosure(id, resourceTexts(model)));
}

/// Il motore di `text`; `null` se non è un SVG che si legge.
function opened(text: string): SceneEngine | null {
  try {
    return SceneEngine.open(text);
  } catch (error) {
    if (error instanceof ReadError) return null;
    throw error;
  }
}

/// I testi dei simboli e delle risorse di `model` e la sua radice, letti
/// quando servono dal modello di adesso: vale finché `model` non cambia.
export function symbolSheet(model: DocumentModel): SymbolSheet {
  const lookup = resourceTexts(model);
  const texts = new Map<string, string>();
  return {
    head: model.root.head,
    name: model.root.facts.name,
    texts: (id) => {
      let text = texts.get(id);
      if (text === undefined && !texts.has(id)) {
        text = lookup(id);
        if (text !== undefined) texts.set(id, text);
      }
      return text;
    },
  };
}

/// Legge la libreria `path` dal suo testo.
export function readLibrary(path: string, text: string): Library | LibraryProblem {
  if (utf8Length(text) > LIBRARY_MAX_BYTES) return "too-large";
  const engine = opened(text);
  const model = engine?.model ?? null;
  if (model === null || engine!.status !== "fubdraw") return "not-drawing";
  const lookup = resourceTexts(model);
  const kept = new Map<string, string>();
  const symbols = documentSymbols(model).map((symbol) => {
    const closure = symbolClosure(symbol.id, lookup);
    for (const [id, each] of closure) kept.set(id, each);
    return { id: symbol.id, name: symbol.name, print: printOf(closure) };
  });
  const sheet: SymbolSheet = { head: model.root.head, name: model.root.facts.name, texts: (id) => kept.get(id) };
  return { path, text, symbols, sheet };
}

/// Il disegno più piccolo che ha il simbolo `id` di `sheet`: la radice, e
/// nella `defs` il simbolo con ciò che usa; `null` se `sheet` non ha il
/// simbolo, o se la radice si chiude da sola.
export function miniature(sheet: SymbolSheet, id: string): string | null {
  if (sheet.texts(id) === undefined || sheet.head.endsWith("/>")) return null;
  const colon = sheet.name.indexOf(":");
  const defs = `${colon < 0 ? "" : sheet.name.slice(0, colon + 1)}defs`;
  const closure = symbolClosure(id, sheet.texts).map(([, text]) => `\n    ${text}`);
  return `${sheet.head}\n  <${defs}>${closure.join("")}\n  </${defs}>\n</${sheet.name}>\n`;
}

/// L'anteprima del simbolo `id` di `sheet`: la sua copia, senza origine.
export function symbolPicture(sheet: SymbolSheet, id: string): SymbolCopy | null {
  const small = miniature(sheet, id);
  return small === null ? null : symbolCopy(small, id);
}

/// Il riquadro che si usa quando il simbolo non ha niente che si veda.
const EMPTY_FRAME: Bounds = { min: [-0.5, -0.5], max: [0.5, 0.5] };

/// La copia del simbolo `id` del disegno `text`: un'istanza nell'origine,
/// in un livello nuovo, copiata come dagli appunti; prima, i simboli di
/// `sources` prendono il loro `fub:source`. `null` se `text` non ha quel
/// simbolo, o se il motore non lo lascia fare.
export function symbolCopy(text: string, id: string, sources: ReadonlyMap<string, string> = new Map()): SymbolCopy | null {
  const engine = opened(text);
  const model = engine?.model ?? null;
  if (engine === null || model === null || symbolNode(model, id) === null) return null;
  const ids = new NewIds((value) => engine.holder(value) !== null);
  const layer = ids.next("layer");
  const use = ids.next("object");
  const ops: Op[] = [];
  for (const [symbol, source] of sources) ops.push({ op: "set", id: symbol, attrs: { "fub:source": source } });
  ops.push({ op: "add", parent: "#root", pos: { last: true }, elem: { tag: "g", attrs: { id: layer, "fub:layer": layer } } });
  ops.push({ op: "add", parent: layer, pos: { last: true }, elem: { tag: "use", attrs: { id: use, href: `#${id}` } } });
  if (engine.apply({ op: "batch", ops }).outcome !== "applied") return null;
  const paths = [pathOf(engine.holder(use)!)];
  const first = copySvg({ text: engine.text, paths, bounds: EMPTY_FRAME });
  if (first === null) return null;
  const box = readScene(first).summary.bbox;
  const frame = box === null ? EMPTY_FRAME : { min: [box.x, box.y] as const, max: [box.x + box.width, box.y + box.height] as const };
  const svg = copySvg({ text: engine.text, paths, bounds: frame });
  return svg === null ? null : { svg, frame };
}

/// I simboli della libreria che la copia di `id` porta: lui e quelli che
/// usa, anche attraverso altri, ognuno col suo `fub:source`.
function sourcesOf(library: Library, id: string): Map<string, string> {
  const prints = new Map(library.symbols.map((symbol) => [symbol.id, symbol.print]));
  const out = new Map<string, string>();
  for (const [at] of symbolClosure(id, library.sheet.texts)) {
    const print = prints.get(at);
    if (print !== undefined) out.set(at, sourceValue(library.path, at, print));
  }
  return out;
}

/// La copia del simbolo `id` di `library`, coi `fub:source` dei suoi
/// simboli; `null` se la libreria non lo ha più. Parte dal disegno piccolo,
/// e da tutta la libreria se quello non si legge: una dichiarazione di
/// namespace che non sta sulla radice, per esempio.
export function libraryCopy(library: Library, id: string): SymbolCopy | null {
  if (!library.symbols.some((symbol) => symbol.id === id)) return null;
  const sources = sourcesOf(library, id);
  const small = miniature(library.sheet, id);
  return (small === null ? null : symbolCopy(small, id, sources)) ?? symbolCopy(library.text, id, sources);
}

/// Il simbolo del disegno `model` copiato dal simbolo `id` della libreria
/// `path`, se c'è: il primo.
export function originSymbol(model: DocumentModel, path: string, id: string): DocumentSymbol | null {
  for (const symbol of documentSymbols(model)) {
    const origin = readOrigin(symbol.source);
    if (origin !== null && origin.path === path && origin.id === id) return symbol;
  }
  return null;
}

/// Le operazioni che danno al simbolo `symbol` del disegno il contenuto del
/// simbolo `id` di `library`: tolto il suo, tranne il primo `title`, entra
/// quello della copia, con le risorse e i simboli che usa; `fub:source`
/// prende l'impronta di adesso. `null` se la libreria non ha più il
/// simbolo, o se il contenuto non si legge.
export function updateOps(model: DocumentModel, symbol: DocumentSymbol, library: Library, id: string, ids: NewIds): Op[] | null {
  const copy = libraryCopy(library, id);
  const print = library.symbols.find((each) => each.id === id)?.print;
  if (copy === null || print === undefined) return null;
  const source = readPaste(copy.svg);
  if (typeof source === "string") return null;
  const ops: Op[] = [];
  const node: ContainerNode = symbol.node;
  // Dall'ultimo al primo, così i percorsi degli elementi senza id restano
  // veri.
  const children = elementChildren(node);
  const title = children.find((child) => child.facts.local === "title");
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i]!;
    if (child === title) continue;
    ops.push({ op: "remove", target: child.facts.id ?? { path: pathOf(child), tag: child.facts.local } });
  }
  const to: Destination = { parent: symbol.id, matrix: IDENTITY, inverse: IDENTITY, prelude: [] };
  const run = planPaste(source, { model, container: node, to, ids, delta: [0, 0], href: () => null, refill: { from: id, into: node } });
  let next = run.next();
  while (next.done !== true) next = run.next();
  ops.push(...next.value.ops);
  ops.push({ op: "set", id: symbol.id, attrs: { "fub:source": sourceValue(library.path, id, print) } });
  return ops;
}
