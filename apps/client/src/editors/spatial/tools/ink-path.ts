// Il tratto a penna che diventa un tracciato, quando la penna scrive in
// tracciati (l'uscita «Tracciato» della Penna, P11): la sua spina,
// i nodi della curva che la segue, col colore dell'inchiostro come contorno
// e lo spessore del pennello. La geometria della spina è in `spine.ts`.
//
// - **La pressione resta.** Se il pennello la segue e il tratto la porta, il
//   tracciato è una linea a spessore variabile col profilo della pressione
//   (`fub:shape="width"`), che la scena sa leggere e disegnare.
// - **Niente id.** Chi scrive il tracciato gli dà il suo.

import { isNib1, parseInkBrush, type Pf1Brush } from "../../../ink/brush";
import { dequantizeSample, type InkSample, type InkScale } from "../../../ink/sample";
import { decodeInk, inkToQuantized } from "../ink/codec";
import { formatNumber } from "../number";
import { parsePath, type Segment } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import { pathData, type Elem } from "../scene/serialize";
import { AT_DECIMALS, type WidthPoint } from "../scene/varwidth";
import type { Fidelity } from "./grid";
import { writeNodes } from "./nodes";
import { widthAttrs } from "./profile";
import { fitSpine, spineTolerance } from "./spine";

/// Vero se `d` si scrive e si rilegge.
const readable = (d: string): boolean => parsePath(d) !== null;

/// Gli attributi di `elem` senza `names`.
function without(attrs: Readonly<Record<string, string>>, names: Iterable<string>): Record<string, string> {
  const out = { ...attrs };
  for (const name of names) delete out[name];
  return out;
}

/// Gli attributi del tratto che il tracciato non tiene: l'inchiostro, il
/// pennello e il riempimento, che diventa il contorno.
const INK = ["id", "d", "fill", "fill-opacity", "fub:tool", "fub:ink", "fub:brush", "fub:at"];

/// La tolleranza della spina per fedeltà, in parti di quella di serie.
const FIDELITY: Readonly<Record<Fidelity, number>> = { high: 0.4, medium: 1, low: 2.5 };

/// I punti del profilo al più, perché la linea resti leggera.
const PROFILE_POINTS = 64;

/// Il profilo di spessore che la pressione dà a un tratto col pennello
/// `brush`: il raggio di perfect-freehand per ogni campione,
/// lungo la linea dei campioni. `null` se il tratto non ha la pressione, se
/// il pennello non la segue, o se la larghezza non cambia.
function pressureProfile(samples: readonly InkSample[], brush: Pf1Brush): WidthPoint[] | null {
  if (brush.thinning === 0 || samples.length < 2 || samples.some((sample) => sample.p === undefined)) return null;
  const lengths = [0];
  for (let i = 1; i < samples.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(samples[i]!.x - samples[i - 1]!.x, samples[i]!.y - samples[i - 1]!.y));
  const total = lengths[lengths.length - 1]!;
  if (!(total > 0)) return null;
  const half = (p: number): number => Math.max(0.01, brush.size * (0.5 - brush.thinning * (0.5 - p)));
  const points: WidthPoint[] = [];
  const step = 1 / PROFILE_POINTS;
  for (let i = 0; i < samples.length; i++) {
    const at = i === samples.length - 1 ? 1 : Number(formatNumber(lengths[i]! / total, AT_DECIMALS));
    const last = points[points.length - 1];
    // Un punto ogni passo, il primo e l'ultimo sempre; il penultimo non sta
    // sull'1.
    if (last !== undefined && i < samples.length - 1 && (at - last[0] < step || at >= 1)) continue;
    const h = half(samples[i]!.p!);
    points.push([at, h, h]);
  }
  if (points.length < 2 || points[points.length - 1]![0] !== 1 || points[1]![0] === 0) return null;
  const first = points[0]![1];
  return points.every((point) => Math.abs(point[1] - first) < 0.01) ? null : points;
}

/// Il tracciato che prende il posto del tratto a penna `elem`: la sua spina,
/// nelle sue coordinate, con la fedeltà `fidelity`. Se il pennello segue la
/// pressione e il tratto la porta, una linea a spessore variabile col
/// profilo della pressione, che la scena legge; se no un
/// contorno uniforme. Senza id: chi lo scrive lo mette. `null` se
/// l'inchiostro o il pennello non si leggono.
export function inkAsPath(elem: Elem, fidelity: Fidelity = "medium"): Elem | null {
  let brush;
  let samples: InkSample[];
  try {
    brush = parseInkBrush(elem.attrs["fub:brush"] ?? "");
    const ink = inkToQuantized(decodeInk(elem.attrs["fub:ink"] ?? ""));
    samples = ink.samples.map((sample) => dequantizeSample(sample, ink.scale as InkScale));
  } catch {
    return null;
  }
  if (samples.length === 0) return null;
  const { sub } = fitSpine(
    samples.map((sample): Point => [sample.x, sample.y]),
    spineTolerance(brush.size) * FIDELITY[fidelity],
  );
  // Un punto è una linea lunga zero, che gli estremi tondi fanno vedere:
  // la penna lo disegna tondo anche con un pennello senza estremi.
  const dot = sub.nodes.length < 2;
  const segments: Segment[] = dot ? [{ kind: "move", to: sub.nodes[0]! }, { kind: "line", to: sub.nodes[0]! }] : writeNodes([sub]);
  const d = pathData(segments);
  if (!readable(d)) return null;
  const rest = without(elem.attrs, INK);
  // La punta piatta lascia estremi dritti, come il suo pennino.
  const round = dot || (!isNib1(brush) && (brush.capStart || brush.capEnd));
  const profile = dot || isNib1(brush) ? null : pressureProfile(samples, brush);
  const written = profile === null ? null : widthAttrs({ cap: round ? "round" : "butt", join: "round", profile, spine: segments });
  if (written !== null) {
    const attrs: Record<string, string> = { ...rest, "fub:shape": "width", "fub:geom": written.geom, d: written.d, fill: elem.attrs.fill ?? "#000000" };
    if (elem.attrs["fill-opacity"] !== undefined) attrs["fill-opacity"] = elem.attrs["fill-opacity"];
    return elem.children === undefined ? { tag: "path", attrs } : { tag: "path", attrs, children: elem.children };
  }
  const attrs: Record<string, string> = { ...rest, d, fill: "none", stroke: elem.attrs.fill ?? "#000000", "stroke-width": formatNumber(brush.size, 2) };
  if (elem.attrs["fill-opacity"] !== undefined) attrs["stroke-opacity"] = elem.attrs["fill-opacity"];
  if (round) attrs["stroke-linecap"] = "round";
  attrs["stroke-linejoin"] = "round";
  return elem.children === undefined ? { tag: "path", attrs } : { tag: "path", attrs, children: elem.children };
}
