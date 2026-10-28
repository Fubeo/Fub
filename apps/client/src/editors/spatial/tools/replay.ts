// Riproduci (P12): il disegno si riscrive coi tempi veri dei campioni. Qui la
// parte pura: l'ordine dei tratti, la linea del tempo, e che cosa si vede a
// un istante. L'editor (`editor/replay.ts`) la mostra col pittore; il file
// non cambia.
//
// - **L'ordine** è quello di `fub:at`, l'ora in cui il tratto è cominciato;
//   a pari ora, o senza, quello del documento.
// - **Le pause lunghe si accorciano**: fra due tratti, e fra due campioni
//   dello stesso tratto, si aspetta al più `MAX_PAUSE_MS`. Un tratto senza
//   ora comincia `GAP_MS` dopo il precedente.
// - **A un istante** un tratto non ancora cominciato non si vede, uno finito
//   si vede com'è, e quello in corso si disegna fino all'ultimo campione già
//   arrivato.

import { parseInkBrush, type InkBrush } from "../../../ink/brush";
import { inkPath } from "../../../ink/outline";
import type { QuantizedInk } from "../../../ink/sample";
import { decodeInk, inkToQuantized } from "../ink/codec";
import { fubAttributes } from "./arrange";
import type { Unit } from "./hit";
import { cuttable } from "./erase-precise";

/// La pausa più lunga che si aspetta, in millisecondi.
export const MAX_PAUSE_MS = 400;
/// Fra un tratto senza ora e il precedente.
export const GAP_MS = 150;

/// Un tratto da riprodurre.
export interface ReplayStroke {
  readonly unit: Unit;
  readonly ink: QuantizedInk;
  readonly brush: InkBrush;
  /// Quando arriva ogni campione, sulla linea del tempo, in millisecondi.
  readonly times: readonly number[];
}

/// La riproduzione di un disegno: i tratti in ordine e quanto dura.
export interface ReplayPlan {
  readonly strokes: readonly ReplayStroke[];
  readonly duration: number;
}

/// Che cosa si vede a un istante: i tratti che non si vedono ancora, e il
/// `d` di quello in corso.
export interface ReplayFrame {
  readonly hidden: readonly Unit[];
  readonly partial: ReadonlyMap<Unit, string>;
  readonly done: boolean;
}

/// La riproduzione dei tratti a penna fra `units`; gli altri oggetti non
/// contano, e si vedono sempre.
export function replayPlan(units: readonly Unit[]): ReplayPlan {
  const found: Array<{ unit: Unit; ink: QuantizedInk; brush: InkBrush; at: number | null; order: number }> = [];
  units.forEach((unit, order) => {
    if (!cuttable(unit)) return;
    const fub = fubAttributes(unit.node);
    try {
      const ink = inkToQuantized(decodeInk(fub.get("ink") ?? ""));
      if (ink.samples.length === 0) return;
      const at = Date.parse(fub.get("at") ?? "");
      found.push({ unit, ink, brush: parseInkBrush(fub.get("brush") ?? ""), at: Number.isFinite(at) ? at : null, order });
    } catch {
      // Un tratto che non si legge si vede com'è, dall'inizio.
    }
  });
  found.sort((a, b) => (a.at !== null && b.at !== null && a.at !== b.at ? a.at - b.at : a.order - b.order));
  const strokes: ReplayStroke[] = [];
  let clock = 0;
  let lastEnd: number | null = null;
  for (const each of found) {
    const samples = each.ink.samples;
    // La pausa prima del tratto: dalla fine vera del precedente.
    const pause = each.at === null || lastEnd === null ? (strokes.length === 0 ? 0 : GAP_MS) : each.at - lastEnd;
    clock += Math.min(MAX_PAUSE_MS, Math.max(0, pause));
    const times = [clock];
    for (let i = 1; i < samples.length; i++) times.push(times[i - 1]! + Math.min(MAX_PAUSE_MS, Math.max(0, samples[i]!.t - samples[i - 1]!.t)));
    clock = times[times.length - 1]!;
    lastEnd = each.at === null ? null : each.at + samples[samples.length - 1]!.t;
    strokes.push({ unit: each.unit, ink: each.ink, brush: each.brush, times });
  }
  return { strokes, duration: clock };
}

/// Che cosa si vede di `plan` all'istante `at`, in millisecondi.
export function replayFrame(plan: ReplayPlan, at: number): ReplayFrame {
  const hidden: Unit[] = [];
  const partial = new Map<Unit, string>();
  for (const stroke of plan.strokes) {
    const { times } = stroke;
    if (at >= times[times.length - 1]!) continue;
    if (at < times[0]!) {
      hidden.push(stroke.unit);
      continue;
    }
    let count = 1;
    while (count < times.length && times[count]! <= at) count++;
    partial.set(stroke.unit, inkPath({ scale: stroke.ink.scale, samples: stroke.ink.samples.slice(0, count) }, stroke.brush));
  }
  return { hidden, partial, done: at >= plan.duration };
}
