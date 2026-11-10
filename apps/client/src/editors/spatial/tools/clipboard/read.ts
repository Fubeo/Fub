// Gli appunti dei disegni, incollare: leggere un SVG incollato, la sua
// cornice, la forma del piano e i testi che il trasloco delle risorse
// confronta (`../clipboard.ts`).

import type { Resolve } from "../../scene/classify";
import type { Bounds } from "../../scene/geometry";
import { IDENTITY, type Matrix, type Point } from "../../scene/matrix";
import type { ContainerNode, DocumentModel } from "../../scene/model";
import type { Op } from "../../scene/ops";
import { MAX_EDIT_BYTES } from "../../scene/read";
import { escapeText } from "../../scene/serialize";
import { SourceText, utf8Length } from "../../scene/text";
import { viewBoxMatrix } from "../../scene/values";
import { isSvg, NS_FUB, NS_NONE, NS_SVG, parseXml, valueOf, XmlError, type NodeId, type XmlDocument } from "../../scene/xml";
import { plainAttributes } from "../arrange";
import { mappedBounds, type Destination, type NewIds } from "../edit";
import { symbolClosure } from "../symbols";
import { DOCUMENT_PARTS, ENTITY, renders, subtree, unitScale, viewBoxOf, viewport } from "./base";
import { Edits, lf, quoted } from "./rewriter";

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
export function expanded(doc: XmlDocument): string | null {
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
export function fromPx(model: DocumentModel, delta: Point): Matrix {
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
  /// Un aggiornamento: il simbolo `into` del disegno prende il contenuto del
  /// simbolo `from` dell'SVG, al posto del suo, dopo il suo primo `title`;
  /// arrivano soltanto le risorse e i simboli che il contenuto usa, e niente
  /// di ciò che sta fuori dalle `defs`.
  readonly refill?: { readonly from: string; readonly into: ContainerNode };
}

/// Un incolla pronto.
export interface PastePlan {
  /// Le operazioni, da applicare in un `batch` solo.
  readonly ops: Op[];
  /// Gli id di ciò che si sceglie dopo.
  readonly keys: string[];
  /// Il riquadro dell'SVG nella scena, dove è andato.
  readonly bounds: Bounds;
  /// I simboli dell'SVG, per id, e il simbolo del disegno che sono dopo:
  /// uno che c'era già, o uno che arriva.
  readonly symbols: ReadonlyMap<string, string>;
}

/// Il JSON di un testo, in byte.
export function jsonBytes(text: string): number {
  return utf8Length(JSON.stringify(text));
}

/// Le risorse che un incolla porta nella `defs` del disegno che riceve: dalle
/// `defs` della radice dell'SVG, ciò che usa quello che entra.
export interface Lift {
  /// Le `defs` della radice dell'SVG: non entrano al loro posto.
  readonly defs: ReadonlySet<NodeId>;
  /// I loro figli da scrivere nella `defs` del disegno, ognuno dopo ciò che
  /// usa.
  readonly moved: readonly NodeId[];
  /// Le `defs` e tutto ciò che hanno dentro: i loro id li decide il
  /// trasloco.
  readonly decided: ReadonlySet<NodeId>;
  /// Il nome nuovo di un campione o di uno stile che arriva con un nome già
  /// preso, o che si legge come un colore, per elemento.
  readonly named: ReadonlyMap<NodeId, string>;
  /// Il colore dei campioni del disegno che ciò che entra usa al posto dei
  /// suoi, per id.
  readonly colors: ReadonlyMap<string, string>;
  /// Il nome nuovo di un simbolo che arriva con un nome già preso: il testo
  /// del suo primo `title`, per elemento del `title`.
  readonly titled: ReadonlyMap<NodeId, string>;
  /// I simboli dell'SVG e quelli del disegno che sono, per id.
  readonly symbols: ReadonlyMap<string, string>;
  /// Vero se il disegno ha lo stile `id`.
  readonly styled: (id: string) => boolean;
  /// Quali id saranno risorse del disegno, con gli id dell'SVG e con quelli
  /// riscritti.
  readonly resolve: Resolve;
  readonly written: Resolve;
}

/// Il testo di un elemento senza gli spazi fra i tag, per riconoscere una
/// risorsa uguale.
export function compact(text: string): string {
  return lf(text).replace(/>\s+</g, "><").trim();
}

/// Il testo compatto di un elemento senza il suo `id`, se è il primo
/// attributo, come lo scrive FubDraw: per riconoscere un marcatore uguale
/// con un altro id.
export function withoutId(text: string): string {
  return compact(text).replace(/^(<[^\s>]+)\s+id="[^"]*"/, "$1");
}

/// Il testo compatto di uno stile senza id né nome, con ogni `url(#…)` al
/// posto del testo senza id di ciò a cui rimanda, letto da `refText`: due
/// stili con lo stesso testo così hanno lo stesso aspetto, anche quando le
/// loro sfumature private hanno id diversi.
export function styleText(text: string, refText: (id: string) => string | undefined): string {
  return compact(text)
    .replace(/\s(?:id|fub:name)="[^"]*"/g, "")
    .replace(/url\(#([^)\s]+)\)/g, (whole, ref: string) => {
      const to = refText(ref);
      return to === undefined ? whole : `url(${withoutId(to)})`;
    });
}

/// La chiave del simbolo `id` senza i suoi id: il suo testo compatto e quello
/// di ciò che usa ([`symbolClosure`]), letti da `lookup`; ogni id definito
/// lì dentro diventa il suo numero d'ordine. `fub:source` resta com'è, in
/// fondo: l'id della libreria che nomina non è uno di questi. Due simboli
/// con la stessa chiave si vedono uguali.
export function symbolKey(id: string, lookup: (id: string) => string | undefined): string {
  const sources: string[] = [];
  const joined = symbolClosure(id, lookup)
    .map(([, text]) => compact(text))
    .join("\n")
    .replace(/(\sfub:source\s*=\s*)(["'])(.*?)\2/g, (_whole, head: string, quote: string, value: string) => {
      sources.push(value);
      return `${head}${quote}${quote}`;
    });
  const order = new Map<string, number>();
  for (const match of joined.matchAll(/\sid\s*=\s*(["'])(.*?)\1/g)) if (!order.has(match[2]!)) order.set(match[2]!, order.size);
  const shape = joined
    .split(/([\s"'#().,;:=<>]+)/)
    .map((part) => {
      const n = order.get(part);
      return n === undefined ? part : `\u0000${n}`;
    })
    .join("");
  return [shape, ...sources].join("\u0001");
}
