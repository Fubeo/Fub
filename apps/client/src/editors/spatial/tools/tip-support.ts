// Gli aiuti dei test delle punte dentro i comandi che tagliano, uniscono,
// chiudono, combinano e copiano: il marcatore della raccolta come lo scrive
// FubDraw, il motore con il seguito delle punte come lo installa l'editor, e
// il giro applica, annulla e rifai che deve tornare al byte.

import { expect } from "vitest";
import type { Op } from "../scene/ops";
import { elemToOut, NamespaceScope, writeElement, type Elem } from "../scene/serialize";
import { FUB_NS, SVG_NS, XLINK_NS } from "../scene/xml";
import { elemOf } from "./arrange";
import { gesture, NewIds } from "./edit";
import { open, type Opened } from "./test-support";
import { followTips, markerTip, tipElem, type TipEnd, type TipShape, type TipSize } from "./tips";

export const RED = "#d55e00";
export const BLUE = "#0072b2";
export const GREEN = "#009e73";

/// Lo scope di un documento FubDraw: SVG predefinito, `fub` e `xlink`.
const FUBDRAW = NamespaceScope.EMPTY.declare([
  [null, SVG_NS],
  ["fub", FUB_NS],
  ["xlink", XLINK_NS],
]);

/// Un elemento come lo scrive il motore, sulla sua riga e con i figli sotto.
export const written = (elem: Elem): string => writeElement(elemToOut(elem, FUBDRAW), "");

/// Un marcatore della raccolta, scritto come lo scrive FubDraw.
export const MARKER = (id: string, shape: TipShape, size: TipSize, end: TipEnd, paint = RED, opacity = 1): string =>
  written(tipElem(id, { shape, size }, end, paint, opacity));

/// Un marcatore che non è della raccolta.
export const CUSTOM = (id: string): string =>
  `<marker id="${id}" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto"><circle cx="2" cy="2" r="2" fill="#000000"/></marker>`;

export const DEFS = (...inner: string[]): string => `<defs id="fub-defs">${inner.join("")}</defs>`;

/// Gli attributi di una linea che mostra i marcatori `start` e `end`.
export const ENDS = (start: string | null, end: string | null): string =>
  `${start === null ? "" : ` marker-start="url(#${start})"`}${end === null ? "" : ` marker-end="url(#${end})"`}`;

export const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

/// Il motore di `source` con le punte che seguono la linea, come lo
/// installa l'editor.
export function followed(source: string): Opened {
  const opened = open(source);
  opened.engine.follow = (model, touched) => followTips(model, touched, ids(opened), (id) => opened.engine.holder(id));
  return opened;
}

/// Applica `ops` in un passo, verifica che un annulla torni al byte e che
/// rifare torni al dopo, e lascia il motore al dopo; torna il testo di dopo.
export function applied(opened: Opened, ops: Op | readonly Op[]): string {
  const op = Array.isArray(ops) ? gesture(ops as readonly Op[]) : (ops as Op);
  if (op === null) throw new Error("niente da applicare");
  const before = opened.engine.text;
  const outcome = opened.engine.apply(op);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = opened.engine.text;
  const back = opened.engine.undo(outcome.undo);
  if (back.outcome !== "applied") throw new Error(`annulla rifiutato: ${back.detail}`);
  expect(opened.engine.text).toBe(before);
  const again = opened.engine.undo(back.undo);
  if (again.outcome !== "applied") throw new Error(`rifai rifiutato: ${again.detail}`);
  expect(opened.engine.text).toBe(after);
  expect(opened.engine.scene().every((item) => item.kind !== "foreign")).toBe(true);
  return after;
}

/// I marcatori che il disegno ha adesso.
export const markersIn = (opened: Opened): string[] => [...opened.engine.text.matchAll(/<marker id="([^"]+)"/g)].map((match) => match[1]!);

/// L'attributo `name` dell'elemento `id`; `null` se non lo ha.
export function attrOf(opened: Opened, id: string, name: string): string | null {
  const node = opened.engine.holder(id);
  if (node === null) throw new Error(`nessun elemento ${id}`);
  return elemOf(node)?.attrs[name] ?? null;
}

/// La punta che il capo `end` dell'elemento `id` mostra, come «forma misura
/// capo colore», o `custom` se il marcatore non è della raccolta; `null` se
/// il capo non ne ha.
export function tipOf(opened: Opened, id: string, end: TipEnd): string | null {
  const value = attrOf(opened, id, `marker-${end}`);
  if (value === null) return null;
  const marker = /^url\(#([^)]+)\)$/.exec(value)?.[1];
  const node = marker === undefined ? null : opened.engine.holder(marker);
  if (node === null || node.kind !== "leaf") throw new Error(`il marcatore di ${id} non c'è: ${value}`);
  const read = markerTip(node);
  return read === null ? "custom" : `${read.tip.shape} ${read.tip.size} ${read.end} ${read.paint}`;
}

/// Il marcatore che il capo `end` di `id` nomina; `null` se non ne ha.
export const markerOf = (opened: Opened, id: string, end: TipEnd): string | null => /^url\(#([^)]+)\)$/.exec(attrOf(opened, id, `marker-${end}`) ?? "")?.[1] ?? null;
