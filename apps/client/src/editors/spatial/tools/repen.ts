// Ripennare (P10): i tratti a penna scelti si ridisegnano dai loro campioni
// con un'altra penna, misura, colore o opacità, o ripassati dallo
// stabilizzatore («Leviga»). Il comando è un `batch` solo, un passo di
// Annulla.
//
// - **Dai campioni.** Un tratto tiene `fub:ink`, i campioni grezzi: il
//   pennello nuovo li ridisegna, e il motore ricalcola `d`, come quando un
//   tratto si trasforma (`apply.ts`). La pressione del pennello nuovo segue
//   quella dei campioni: un tratto scritto col mouse non la finge.
// - **Quello che si vede insieme.** Una penna dice quanto copre e come si
//   fonde (`penLook`): cambiando penna cambiano anche `fill-opacity` e la
//   fusione in `style`, e l'opacità scelta da chi disegna resta la stessa
//   frazione. Un `style` con altro oltre alla fusione tiene l'altro.
// - **L'evidenziatore resta evidenziatore.** Un'altra penna va ai tratti
//   della Penna; misura, colore, opacità e «Leviga» a tutti e due.
// - **Ciò che non è più inchiostro resta com'è.** Un tratto già in
//   tracciato, o che non si ridisegna (S004, S010), non cambia, e si conta
//   fra quelli tenuti, perché chi chiama lo dica.

import { formatInkBrush, parseInkBrush, penOf, type InkBrush } from "../../../ink/brush";
import { Stabilizer, type StabilizerConfig } from "../../../ink/input/stabilizer";
import { formatShortest } from "../../../ink/number";
import { DEFAULT_PEN, isPenId, penBrush, penLook, type PenId } from "../../../ink/pens";
import { dequantizeSample, quantizeInk, type InkSample, type InkScale } from "../../../ink/sample";
import { decodeInk, encodeInk, inkFromQuantized, inkToQuantized, INK_MAX_BYTES } from "../ink/codec";
import type { DocumentModel } from "../scene/model";
import { fubAttributes, nodeOf, plainAttributes, Plan, type Arranged } from "./arrange";
import type { NewIds } from "./edit";
import type { Unit } from "./hit";
import { cuttable } from "./erase-precise";

/// Che cosa cambia nei tratti; ciò che manca resta com'è.
export interface Repen {
  readonly pen?: PenId;
  readonly size?: number;
  readonly color?: string;
  /// L'opacità scelta da chi disegna, da 0 a 1, prima di quella della penna.
  readonly opacity?: number;
  /// «Leviga»: i campioni ripassano dallo stabilizzatore, con `zoom` pixel
  /// dello schermo per unità della scena.
  readonly smooth?: { readonly config: StabilizerConfig; readonly zoom: number };
}

/// Ripennati: le operazioni, quanti tratti cambiano e quanti restano com'erano
/// perché non sono più inchiostro.
export interface Repenned extends Arranged {
  readonly changed: number;
  readonly kept: number;
}

/// La fusione di `style`, tolta o sostituita: `null` se non resta niente.
function withBlend(style: string | undefined, blend: string): string | null {
  const rest = (style ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part !== "" && !/^mix-blend-mode\s*:/i.test(part));
  if (blend !== "normal") rest.push(`mix-blend-mode: ${blend}`);
  return rest.length === 0 ? null : rest.join("; ");
}

/// `samples` ripassati dallo stabilizzatore.
function smoothed(samples: readonly InkSample[], config: StabilizerConfig, zoom: number): InkSample[] {
  const stabilizer = new Stabilizer(config, zoom);
  const out: InkSample[] = [];
  for (const sample of samples) stabilizer.push(sample, out);
  stabilizer.finish(out);
  return out;
}

/// Gli attributi nuovi di un tratto, o `null` se non si ridisegna.
function repenned(unit: Unit, change: Repen): Record<string, string | null> | null {
  const fub = fubAttributes(unit.node);
  const plain = plainAttributes(unit.node);
  const tool = fub.get("tool") ?? "pen";
  try {
    const ink = decodeInk(fub.get("ink") ?? "");
    const brush = parseInkBrush(fub.get("brush") ?? "");
    const attrs: Record<string, string | null> = {};
    let next: InkBrush = brush;
    const pen = tool === "pen" ? change.pen : undefined;
    if (pen !== undefined || change.size !== undefined) {
      const named = penOf(brush);
      const from: PenId = isPenId(named) ? named : tool === "highlighter" ? "highlighter" : DEFAULT_PEN;
      next = penBrush(pen ?? from, change.size ?? brush.size, ink.channels.includes("p"));
      const text = formatInkBrush(next);
      if (text !== formatInkBrush(brush)) attrs["fub:brush"] = text;
    }
    if (change.smooth !== undefined) {
      const quantized = inkToQuantized(ink);
      const scale = quantized.scale as InkScale;
      const samples = quantized.samples.map((sample) => dequantizeSample(sample, scale));
      const text = encodeInk(inkFromQuantized(quantizeInk(smoothed(samples, change.smooth.config, change.smooth.zoom), scale)));
      // L'inchiostro è ASCII: un carattere è un byte.
      if (text.length > INK_MAX_BYTES) return null;
      if (text !== fub.get("ink")) attrs["fub:ink"] = text;
    }
    if (change.color !== undefined && change.color !== plain.get("fill")) attrs.fill = change.color;
    // Quanto copre: la penna per l'opacità di chi disegna, che resta la
    // stessa frazione se non la si sceglie.
    const before = penLook(brush, tool);
    const after = penLook(next, tool);
    const covers = Number(plain.get("fill-opacity") ?? "1");
    const chosen = change.opacity ?? (Number.isFinite(covers) && before.opacity > 0 ? Math.min(1, covers / before.opacity) : 1);
    const nextCovers = Math.round(after.opacity * chosen * 1000) / 1000;
    const opacity = nextCovers < 1 ? formatShortest(nextCovers) : null;
    if (opacity !== (plain.get("fill-opacity") ?? null) && (change.opacity !== undefined || after.opacity !== before.opacity)) attrs["fill-opacity"] = opacity;
    if (after.blend !== before.blend) {
      const style = withBlend(plain.get("style"), after.blend);
      if (style !== (plain.get("style") ?? null)) attrs.style = style;
    }
    return attrs;
  } catch {
    return null;
  }
}

/// Le operazioni che ripennano i tratti `units` con `change`. Un elemento
/// che cambia senza id ne riceve uno; la selezione resta la stessa.
export function repenOps(model: DocumentModel, units: readonly Unit[], change: Repen, ids: NewIds): Repenned {
  const plan = new Plan(model, ids);
  let changed = 0;
  let kept = 0;
  for (const unit of units) {
    const attrs = cuttable(unit) ? repenned(unit, change) : null;
    if (attrs === null) {
      kept++;
      continue;
    }
    if (Object.keys(attrs).length === 0) continue;
    plan.ops.push({ op: "set", id: plan.idOf(nodeOf(model, unit)), attrs });
    changed++;
  }
  const keys = units.map((unit) => plan.keyOf(nodeOf(model, unit), unit.key));
  return { ...plan.finish(keys), changed, kept };
}
