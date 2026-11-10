// La classificazione della scena, i dettagli: ciò che una voce dice di un
// elemento modificabile, il tratto, chi segue uno stile, e la voce che ne
// viene (`../classify.ts`).

import { BrushError, parseInkBrush } from "../../../../ink/brush";
import { decodeInk, inkDuration, inkLength, unknownChannels, type Ink } from "../../ink/codec";
import { InkError } from "../../../../ink/sample";
import { isContainer, useTarget, type Role, type Stroke, type Tool } from "../analysis";
import type { Code } from "../diagnostics";
import { readLabelPlace, type LabelPlace } from "../connectors";
import { readInside } from "../labels";
import type { Repeat } from "../repeat";
import type { Polygonal } from "../parametric";
import type { VarWidth } from "../varwidth";
import type { Span } from "../text";
import { trim, wrapWidth } from "../values";
import { isSvg, NS_FUB, NS_NONE, valueOf, type ElementNode, type NodeId, type XmlDocument } from "../xml";
import type { ConnectorFacts, ElementItem, Layer, Lifecycle, MotifFacts, StyleFacts, SwatchFacts, Tag, Tags } from "./types";
import { characterData, firstTitle, lineText, textPathOf, textPathTarget } from "./attributes";
import { motifOf, styleOf, swatchOf } from "./facts";
import { arrowGeometry, boardBox, connectorEnd, connectorGeometry, polygonalGeometry, repeatOf, widthGeometry } from "./children";

/// Ciò che una voce dice di un elemento modificabile oltre a percorso,
/// span, rientro e tag: quello che dipende solo dall'elemento. Il motore
/// delle operazioni lo conserva per ogni elemento, e ne ricava le voci senza
/// rileggere il documento.
export interface Details {
  readonly tag: Tag;
  readonly role: Role;
  readonly id: string | null;
  readonly layer?: Layer;
  /// `fub:locked="true"` e `display="none"`, anche fuori dai livelli (§3).
  readonly locked?: true;
  readonly hidden?: true;
  readonly stroke?: Stroke;
  readonly arrow?: readonly [number, number, number, number];
  readonly connector?: ConnectorFacts;
  readonly polygonal?: Polygonal;
  readonly varwidth?: VarWidth;
  /// Il nome di un'unità, come [`ElementItem.title`]. Quello di un
  /// contenitore viene dai figli, e lo aggiunge chi li ha: la lettura intera
  /// e il modello, che riscrive il tag d'apertura senza rileggere i figli.
  readonly title?: string;
  readonly text?: string;
  readonly lines?: readonly string[];
  readonly wrap?: number;
  readonly glued?: readonly boolean[];
  readonly textPath?: string;
  readonly along?: LabelPlace;
  readonly inside?: string;
  readonly lifecycle?: Lifecycle;
  readonly swatch?: SwatchFacts;
  readonly motif?: MotifFacts;
  readonly style?: StyleFacts;
  readonly follows?: string;
  readonly box?: readonly [number, number, number, number];
  readonly board?: string;
  readonly symbol?: string;
  readonly source?: string;
  readonly repeat?: Repeat;
  readonly original?: string;
}

/// Un problema di un tratto: S004 o S010, col dettaglio.
export type StrokeProblem = readonly [code: Code, detail: string];

/// Legge inchiostro e pennello di un tratto: S004 per ognuno che non si
/// legge, S010 per i canali sconosciuti.
export function readStroke(element: ElementNode): { stroke: Stroke; problems: StrokeProblem[] } {
  const tool: Tool = valueOf(element, NS_FUB, "tool") === "highlighter" ? "highlighter" : "pen";
  const problems: StrokeProblem[] = [];
  let ink: Ink | null = null;
  const inkText = valueOf(element, NS_FUB, "ink");
  if (inkText === undefined) {
    problems.push(["S004", new InkError("missing").detail]);
  } else {
    try {
      ink = decodeInk(inkText);
    } catch (error) {
      if (!(error instanceof InkError)) throw error;
      problems.push(["S004", error.detail]);
    }
  }
  const brushText = valueOf(element, NS_FUB, "brush");
  if (brushText === undefined) {
    problems.push(["S004", new BrushError("missing").detail]);
  } else {
    try {
      parseInkBrush(brushText);
    } catch (error) {
      if (!(error instanceof BrushError)) throw error;
      problems.push(["S004", error.detail]);
    }
  }
  if (ink !== null) {
    const unknown = unknownChannels(ink);
    if (unknown !== "") problems.push(["S010", unknown]);
  }
  const stroke: { tool: Tool; redrawable: boolean; samples?: number; duration?: number } = {
    tool,
    redrawable: problems.length === 0,
  };
  if (ink !== null) {
    stroke.samples = inkLength(ink);
    const duration = inkDuration(ink);
    if (duration !== null) stroke.duration = duration;
  }
  return { stroke, problems };
}

/// I ruoli che seguono uno stile con `fub:style` (formato della scena,
/// stili): il testo uno di testo, gli altri uno grafico. Non i livelli, i
/// collegamenti, la carta, le tavole e le risorse.
export const FOLLOWERS: ReadonlySet<Role> = new Set<Role>([
  "group",
  "stroke",
  "arrow",
  "connector",
  "ngon",
  "star",
  "width",
  "path",
  "rect",
  "ellipse",
  "circle",
  "line",
  "polyline",
  "polygon",
  "text",
  "image",
]);

/// Il tipo di stile che un elemento di ruolo `role` può seguire, o `null`
/// se non ne segue.
export function followedKind(role: Role): StyleFacts["kind"] | null {
  if (!FOLLOWERS.has(role)) return null;
  return role === "text" ? "text" : "graphic";
}

/// I dettagli di un elemento modificabile di ruolo `role`, coi problemi del
/// suo tratto se è un tratto.
export function describe(doc: XmlDocument, id: NodeId, tag: Tag, role: Role): { details: Details; problems: StrokeProblem[] } {
  const element = doc.element(id)!;
  const details: { -readonly [K in keyof Details]: Details[K] } = {
    tag,
    role,
    id: valueOf(element, NS_NONE, "id") ?? null,
  };
  let problems: StrokeProblem[] = [];
  if (role === "layer") {
    const display = valueOf(element, NS_NONE, "display");
    details.layer = {
      name: valueOf(element, NS_FUB, "layer") ?? "",
      locked: valueOf(element, NS_FUB, "locked") === "true",
      hidden: display !== undefined && trim(display) === "none",
    };
  }
  // Si bloccano e si nascondono i livelli e ciò che si disegna, non il
  // titolo, la descrizione, la carta o le risorse.
  if (role === "resource") {
    const lifecycle = valueOf(element, NS_FUB, "role");
    if (lifecycle === "private" || lifecycle === "shared") details.lifecycle = lifecycle;
    if (lifecycle === "swatch") {
      const swatch = swatchOf(doc, element);
      const motif = motifOf(element);
      if (swatch !== null) {
        details.lifecycle = "swatch";
        details.swatch = swatch;
      } else if (motif !== null) {
        details.lifecycle = "swatch";
        details.motif = motif;
      }
    }
    // Un `text` o una `polyline` con `fub:role="style"` è una risorsa
    // soltanto con la forma di uno stile; un'altra risorsa con quel ruolo
    // resta senza ciclo di vita.
    if (lifecycle === "style") {
      const style = styleOf(doc, element);
      if (style !== null) {
        details.lifecycle = "style";
        details.style = style;
      }
    }
    const title = firstTitle(doc, element);
    if (title !== null) details.title = title;
  } else if (role === "board") {
    // Una tavola non si blocca e non si nasconde (formato della scena,
    // tavole).
    details.box = boardBox(element)!;
    const title = firstTitle(doc, element);
    if (title !== null) details.title = title;
  } else if (role === "paper") {
    const board = valueOf(element, NS_FUB, "board");
    if (board !== undefined) details.board = board;
  } else if (role !== "title" && role !== "desc" && role !== "defs") {
    if (valueOf(element, NS_FUB, "locked") === "true") details.locked = true;
    const display = valueOf(element, NS_NONE, "display");
    if (display !== undefined && trim(display) === "none") details.hidden = true;
    const title = isContainer(role) ? null : firstTitle(doc, element);
    if (title !== null) details.title = title;
  }
  if (role === "stroke") {
    const read = readStroke(element);
    details.stroke = read.stroke;
    problems = read.problems;
  }
  if (role === "arrow") {
    const arrow = arrowGeometry(element);
    if (arrow !== null) details.arrow = arrow;
  }
  if (role === "connector") {
    const geom = connectorGeometry(element);
    if (geom !== null) details.connector = { geom, from: connectorEnd(element, "from"), to: connectorEnd(element, "to") };
  }
  if (role === "ngon" || role === "star") {
    const polygonal = polygonalGeometry(element);
    if (polygonal !== null) details.polygonal = polygonal;
  }
  if (role === "width") {
    const varwidth = widthGeometry(element);
    if (varwidth !== null) details.varwidth = varwidth;
  }
  if (FOLLOWERS.has(role)) {
    const follows = valueOf(element, NS_FUB, "style");
    if (follows !== undefined) details.follows = follows;
  }
  if (role === "title" || role === "desc") details.text = characterData(doc, id);
  if (role === "instance") details.symbol = useTarget(element)!;
  if (role === "copy") details.original = useTarget(element)!;
  if (role === "group") {
    const repeat = repeatOf(element);
    if (repeat !== null) details.repeat = repeat;
  }
  if (role === "symbol") {
    const source = valueOf(element, NS_FUB, "source");
    if (source !== undefined) details.source = source;
  }
  if (role === "text") {
    const path = textPathOf(doc, element);
    if (path !== null) {
      details.lines = [lineText(doc, path)];
      details.textPath = textPathTarget(doc.element(path)!)!;
    } else {
      const rows = element.children.filter((child) => {
        const tspan = doc.element(child);
        return tspan !== null && isSvg(tspan, "tspan");
      });
      details.lines = rows.map((child) => lineText(doc, child));
      const wrap = valueOf(element, NS_FUB, "wrap");
      const width = wrap === undefined ? null : wrapWidth(wrap);
      if (width !== null) {
        details.wrap = width;
        // Dopo la prima riga, `fub:join="word"` continua la parola di prima.
        const glued = rows.map((child, at) => at > 0 && valueOf(doc.element(child)!, NS_FUB, "join") === "word");
        if (glued.includes(true)) details.glued = glued;
      }
    }
    const along = valueOf(element, NS_FUB, "along");
    const place = along === undefined ? null : readLabelPlace(along);
    if (place !== null) details.along = place;
    const inside = valueOf(element, NS_FUB, "inside");
    const shape = inside === undefined ? null : readInside(inside);
    if (shape !== null) details.inside = shape;
  }
  return { details, problems };
}

/// La voce di un elemento modificabile dai suoi dettagli e da dove sta.
export function elementItem(details: Details, path: readonly number[], span: Span, indent: string, tags: Tags | null): ElementItem {
  const item: { -readonly [K in keyof ElementItem]: ElementItem[K] } = {
    kind: "element",
    path,
    tag: details.tag,
    role: details.role,
    id: details.id,
    ...span,
    indent,
  };
  if (tags !== null) item.tags = tags;
  if (details.layer !== undefined) item.layer = details.layer;
  if (details.locked !== undefined) item.locked = details.locked;
  if (details.hidden !== undefined) item.hidden = details.hidden;
  if (details.stroke !== undefined) item.stroke = details.stroke;
  if (details.arrow !== undefined) item.arrow = details.arrow;
  if (details.connector !== undefined) item.connector = details.connector;
  if (details.polygonal !== undefined) item.polygonal = details.polygonal;
  if (details.varwidth !== undefined) item.varwidth = details.varwidth;
  if (details.title !== undefined) item.title = details.title;
  if (details.text !== undefined) item.text = details.text;
  if (details.lines !== undefined) item.lines = details.lines;
  if (details.wrap !== undefined) item.wrap = details.wrap;
  if (details.glued !== undefined) item.glued = details.glued;
  if (details.textPath !== undefined) item.textPath = details.textPath;
  if (details.along !== undefined) item.along = details.along;
  if (details.inside !== undefined) item.inside = details.inside;
  if (details.lifecycle !== undefined) item.lifecycle = details.lifecycle;
  if (details.swatch !== undefined) item.swatch = details.swatch;
  if (details.motif !== undefined) item.motif = details.motif;
  if (details.style !== undefined) item.style = details.style;
  if (details.follows !== undefined) item.follows = details.follows;
  if (details.box !== undefined) item.box = details.box;
  if (details.board !== undefined) item.board = details.board;
  if (details.symbol !== undefined) item.symbol = details.symbol;
  if (details.source !== undefined) item.source = details.source;
  if (details.repeat !== undefined) item.repeat = details.repeat;
  if (details.original !== undefined) item.original = details.original;
  return item;
}
