// Gli aiuti dei test delle punte (`tips*.test.ts`): le operazioni che danno le
// punte, applicate al motore con il giro annulla e rifai al byte, il seguito
// delle punte e ciò che una linea mostra ai suoi capi.

import { expect } from "vitest";
import type { LeafNode } from "../../scene/model";
import type { AddOp, Op, SetOp } from "../../scene/ops";
import type { Elem } from "../../scene/serialize";
import { elemOf } from "../arrange";
import { gesture } from "../edit";
import { open, type Opened } from "../test-support";
import { BLUE, ids, RED, written } from "../tip-support";
import { followTips, markerTip, tipOps, tipsLookOf, type MarkerTip, type Tip, type TipChange, type TipEnd, type TipShape, type TipSize, type Tipped } from "../tips";

/// Un elemento come lo scrive il motore su una riga sola, per confrontarlo a occhio.
export const oneLine = (elem: Elem): string => written(elem).replace(/\n\s*/g, "");

/// Un elemento che un test ritocca.
export interface Edit {
  tag: string;
  attrs: Record<string, string>;
  children?: Edit[];
}

export const PINK = "#cc79a7";

export const tip = (shape: TipShape, size: TipSize = "medium"): Tip => ({ shape, size });

export const SWATCH = (id: string, color: string): string =>
  `<linearGradient id="${id}" fub:role="swatch" fub:name="Campione" gradientUnits="userSpaceOnUse"><stop stop-color="${color}"/></linearGradient>`;
export const RAMP = (id: string, x2 = 100): string =>
  `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${x2}" y2="0"><stop offset="0" stop-color="${RED}"/><stop offset="1" stop-color="${BLUE}"/></linearGradient>`;

export const INK = "1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8";
export const BRUSH = "pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0";

/// Una linea orizzontale con il contorno `RED` di spessore 2, salvo `extra`.
export const LINE = (id: string, extra = ` stroke="${RED}" stroke-width="2"`, y = 10): string => `<line id="${id}" x1="0" y1="${y}" x2="50" y2="${y}"${extra}/>`;

/// Le operazioni di `ops`, anche dentro i `batch`, in ordine.
export function flat(ops: Op | readonly Op[]): Op[] {
  const list = Array.isArray(ops) ? (ops as readonly Op[]) : [ops as Op];
  return list.flatMap((op) => (op.op === "batch" ? flat(op.ops) : [op]));
}

export const adds = (ops: Op | readonly Op[]): AddOp[] => flat(ops).filter((op): op is AddOp => op.op === "add" && "elem" in op);
export const sets = (ops: Op | readonly Op[]): SetOp[] => flat(ops).filter((op): op is SetOp => op.op === "set");

/// Le punte di `units` come le legge il pannello.
export const looks = (opened: Opened, units = opened.reindex().units): ReturnType<typeof tipsLookOf> => tipsLookOf(opened.engine.model!, units);

/// Le scelte su tutti gli oggetti del disegno, o su `units`.
export function tipped(opened: Opened, change: TipChange, units = opened.reindex().units): Tipped {
  return tipOps(opened.engine.model!, units, change, ids(opened));
}

/// Applica `ops` in un passo, verifica che un annulla torni al byte e che
/// rifare torni al dopo, e lascia il motore al dopo.
export function applied(opened: Opened, ops: readonly Op[]): string {
  const before = opened.engine.text;
  const outcome = opened.engine.apply(gesture(ops)!);
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

/// Le punte di `change` applicate a tutto il disegno.
export function given(opened: Opened, change: TipChange, units = opened.reindex().units): Tipped {
  const made = tipped(opened, change, units);
  applied(opened, made.ops);
  return made;
}

/// Il motore di `source` con le punte che seguono la linea.
export function followed(source: string, index = false): Opened {
  const opened = open(source);
  opened.engine.follow = (model, touched) => followTips(model, touched, ids(opened), index ? (id) => opened.engine.holder(id) : undefined);
  return opened;
}

/// Applica `op` al motore, con ciò che lo segue; verifica un solo annulla e
/// un solo rifai, e torna l'operazione com'è stata applicata.
export function step(opened: Opened, op: Op): Op {
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
  return outcome.forward;
}

export const leaf = (opened: Opened, id: string): LeafNode => {
  const node = opened.engine.holder(id);
  if (node === null || node.kind !== "leaf") throw new Error(`nessuna foglia ${id}`);
  return node;
};

/// L'id del marcatore che il capo `end` di `line` nomina; `null` se non ne ha.
export function usedBy(opened: Opened, line: string, end: TipEnd): string | null {
  const value = elemOf(opened.engine.holder(line)!)!.attrs[`marker-${end}`];
  return value === undefined ? null : (/^url\(#([^)]+)\)$/.exec(value)?.[1] ?? null);
}

/// La punta che il capo `end` di `line` mostra, se è della raccolta.
export function shown(opened: Opened, line: string, end: TipEnd): (MarkerTip & { readonly id: string }) | null {
  const id = usedBy(opened, line, end);
  if (id === null) return null;
  const read = markerTip(leaf(opened, id));
  return read === null ? null : { ...read, id };
}

/// Tutti gli id del testo di `opened`.
export const everyId = (opened: Opened): Set<string> => new Set([...opened.engine.text.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]!));

/// Verifica che una nuova richiesta di seguito non abbia più niente da fare.
export function settled(opened: Opened, find = true): void {
  const again = followTips(opened.engine.model!, everyId(opened), ids(opened), find ? (id) => opened.engine.holder(id) : undefined);
  expect(again).toBeNull();
}
