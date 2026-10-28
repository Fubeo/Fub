// La mano: la curva della pressione della penna e lo stabilizzatore del
// tratto, come gruppi di campi. Li usano la finestra «Penna e dita»
// (`touch-dialog.ts`) e il pannello «Mano» della Penna
// (`editor/chrome/hand-options.ts`): lo stesso codice, due posti.
//
// La curva (`ink/input/pressure.ts`) ha tre manopole e si vede mentre si
// sceglie: il disegno della curva, con il punto della pressione di adesso, un
// tratto d'esempio che va da leggero a pieno e torna, e un riquadro dove
// provare la penna, che disegna con la curva dei campi. Il tratto d'esempio fa
// vedere la curva anche a chi non ha la penna in mano; i campi sono cursori
// con il valore scritto accanto. Lo stabilizzatore (`ink/input/stabilizer.ts`)
// dice quanto leviga, da spento al massimo, e se tira il pennino con la corda
// invece che con la media.
//
// `onChange` arriva quando una scelta è fatta: un cursore lasciato, una
// casella, «Ripristina». Non a ogni passo del cursore.

import { resolvedLanguage } from "../../../i18n/strings";
import { curvePath, DEFAULT_CURVE, isDefaultCurve, MAX_MIN, MIN_FULL, pressureCurve, type PenCurve } from "../../../ink/input/pressure";
import { t } from "../strings";
import type { Steady } from "./grid";

const SVG_NS = "http://www.w3.org/2000/svg";

/// Il riquadro della curva, in unità del suo `viewBox`.
const CURVE_SIZE = 120;

/// Il riquadro della prova, in unità del suo `viewBox`.
const PAD_WIDTH = 320;
const PAD_HEIGHT = 120;

/// Lo spessore del tratto di prova a pressione piena, e quello più sottile.
const PAD_MAX_WIDTH = 14;
const PAD_MIN_WIDTH = 0.5;

/// Quanti pezzi tiene la prova: oltre, i più vecchi se ne vanno.
const PAD_MAX_SEGMENTS = 1500;

/// Un gruppo di campi della mano: il suo `fieldset`, e la scelta di adesso.
export interface HandGroup<T> {
  readonly element: HTMLFieldSetElement;
  value(): T;
  /// Mette il fuoco sul primo campo.
  focus(): void;
}

/// Una manopola: il cursore, in centesimi, e dove scrive il valore come si
/// legge.
interface Knob {
  readonly input: HTMLInputElement;
  readonly output: HTMLOutputElement;
  readonly text: (value: number) => string;
}

/// Il valore di una manopola, da centesimi.
const valueOf = (knob: Knob): number => Number(knob.input.value) / 100;

/// Porta la manopola a `value`.
const setKnob = (knob: Knob, value: number): void => {
  knob.input.value = String(Math.round(value * 100));
};

let groups = 0;

/// Una manopola da `from` a `to` in `parent`, che a ogni passo chiama `show`
/// e a scelta fatta `changed`.
function knob(parent: HTMLElement, label: string, from: number, to: number, value: number, text: Knob["text"], show: () => void, changed: () => void): Knob {
  const field = document.createElement("label");
  field.className = "draw-touch-knob";
  const name = document.createElement("span");
  name.textContent = label;
  const input = document.createElement("input");
  input.type = "range";
  input.id = `draw-touch-knob-${++groups}`;
  input.min = String(Math.round(from * 100));
  input.max = String(Math.round(to * 100));
  input.step = "5";
  const output = document.createElement("output");
  output.setAttribute("for", input.id);
  field.append(name, output, input);
  parent.append(field);
  const each: Knob = { input, output, text };
  setKnob(each, value);
  input.addEventListener("input", show);
  input.addEventListener("change", changed);
  return each;
}

const percentFormat = (): Intl.NumberFormat => new Intl.NumberFormat(resolvedLanguage(), { style: "percent", maximumFractionDigits: 0 });

/// La curva della pressione della penna, a partire da `initial`.
export function pressureGroup(initial: PenCurve, onChange?: (curve: PenCurve) => void): HandGroup<PenCurve> {
  const pressure = group(t("draw.touch.pressure"));
  const id = ++groups;
  const hint = document.createElement("p");
  hint.className = "draw-touch-hint";
  hint.id = `draw-touch-hint-${id}`;
  hint.textContent = t("draw.touch.pressure.hint");
  pressure.setAttribute("aria-describedby", hint.id);

  const percent = percentFormat();
  const signed = new Intl.NumberFormat(resolvedLanguage(), { style: "percent", maximumFractionDigits: 0, signDisplay: "exceptZero" });
  const knobs = document.createElement("div");
  knobs.className = "draw-touch-knobs";
  const show = (): void => showNow();
  const changed = (): void => onChange?.(curveNow());
  const soft = knob(knobs, t("draw.touch.soft"), -1, 1, initial.soft, (v) => signed.format(v), show, changed);
  const min = knob(knobs, t("draw.touch.min"), 0, MAX_MIN, initial.min, (v) => percent.format(v), show, changed);
  const full = knob(knobs, t("draw.touch.full"), MIN_FULL, 1, initial.full, (v) => percent.format(v), show, changed);
  const curveNow = (): PenCurve => ({ soft: valueOf(soft), min: valueOf(min), full: valueOf(full) });

  // Il disegno della curva: la diagonale della pressione com'è, la curva,
  // e il punto della pressione di adesso mentre si prova.
  const graph = svg("draw-touch-curve", CURVE_SIZE, CURVE_SIZE);
  const diagonal = path(graph, "draw-touch-diagonal");
  diagonal.setAttribute("d", `M0 ${CURVE_SIZE}L${CURVE_SIZE} 0`);
  diagonal.setAttribute("stroke-dasharray", "4 4");
  const line = path(graph, "draw-touch-line");
  line.setAttribute("stroke-linejoin", "round");
  const dot = document.createElementNS(SVG_NS, "circle");
  dot.setAttribute("class", "draw-touch-dot");
  dot.setAttribute("r", "4");
  dot.setAttribute("display", "none");
  graph.append(dot);

  // La prova: il tratto d'esempio finché la penna non disegna.
  const pad = svg("draw-touch-pad", PAD_WIDTH, PAD_HEIGHT);
  pad.removeAttribute("aria-hidden");
  pad.setAttribute("role", "img");
  pad.setAttribute("aria-label", t("draw.touch.try"));
  const sample = path(pad, "draw-touch-sample");
  const strokes = document.createElementNS(SVG_NS, "g");
  strokes.setAttribute("class", "draw-touch-strokes");
  strokes.setAttribute("stroke-linecap", "round");
  pad.append(strokes);

  const curveBox = document.createElement("div");
  curveBox.className = "draw-touch-pressure";
  curveBox.append(graph, knobs);

  const tools = document.createElement("div");
  tools.className = "draw-touch-tools";
  const tool = (label: string, run: () => void): HTMLButtonElement => {
    const control = document.createElement("button");
    control.type = "button";
    control.textContent = label;
    control.addEventListener("click", run);
    tools.append(control);
    return control;
  };
  const reset = tool(t("draw.touch.reset"), () => {
    setKnob(soft, DEFAULT_CURVE.soft);
    setKnob(min, DEFAULT_CURVE.min);
    setKnob(full, DEFAULT_CURVE.full);
    showNow();
    changed();
    soft.input.focus();
  });
  const clear = tool(t("draw.touch.clear"), () => {
    strokes.replaceChildren();
    showNow();
  });
  pressure.append(hint, curveBox, pad, tools);

  /// La curva, i valori e il tratto d'esempio come dicono i cursori.
  const showNow = (): void => {
    const curve = curveNow();
    for (const each of [soft, min, full]) {
      const text = each.text(valueOf(each));
      each.output.textContent = text;
      each.input.setAttribute("aria-valuetext", text);
    }
    line.setAttribute("d", curvePath(curve, CURVE_SIZE, CURVE_SIZE));
    const drawn = strokes.childElementCount > 0;
    sample.setAttribute("display", drawn ? "none" : "inline");
    if (!drawn) sample.setAttribute("d", samplePath(curve));
    reset.disabled = isDefaultCurve(curve);
    clear.disabled = !drawn;
  };

  // La penna sulla prova: ogni pezzo spesso quanto la pressione curvata. Il
  // mouse e il dito, senza pressione, disegnano a metà, come la penna a
  // metà corsa.
  let last: { readonly id: number; readonly x: number; readonly y: number } | null = null;
  const local = (event: PointerEvent): readonly [number, number] => {
    const rect = pad.getBoundingClientRect();
    const kx = rect.width > 0 ? PAD_WIDTH / rect.width : 1;
    const ky = rect.height > 0 ? PAD_HEIGHT / rect.height : 1;
    return [(event.clientX - rect.left) * kx, (event.clientY - rect.top) * ky];
  };
  const pressureOf = (event: PointerEvent): number => (event.pointerType === "pen" ? event.pressure : 0.5);
  const mark = (event: PointerEvent): void => {
    const raw = pressureOf(event);
    dot.setAttribute("display", "inline");
    dot.setAttribute("cx", String(round(raw * CURVE_SIZE)));
    dot.setAttribute("cy", String(round((1 - pressureCurve(curveNow())(raw)) * CURVE_SIZE)));
  };
  pad.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    try {
      pad.setPointerCapture(event.pointerId);
    } catch {
      // Non catturabile: il tratto prosegue finché il puntatore resta sopra.
    }
    const [x, y] = local(event);
    last = { id: event.pointerId, x, y };
    mark(event);
  });
  pad.addEventListener("pointermove", (event) => {
    if (last === null || last.id !== event.pointerId) return;
    const events = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
    const apply = pressureCurve(curveNow());
    for (const each of events.length > 0 ? events : [event]) {
      const [x, y] = local(each);
      const width = PAD_MIN_WIDTH + (PAD_MAX_WIDTH - PAD_MIN_WIDTH) * apply(pressureOf(each));
      const piece = document.createElementNS(SVG_NS, "line");
      piece.setAttribute("x1", String(round(last.x)));
      piece.setAttribute("y1", String(round(last.y)));
      piece.setAttribute("x2", String(round(x)));
      piece.setAttribute("y2", String(round(y)));
      piece.setAttribute("stroke-width", String(round(width)));
      strokes.append(piece);
      last = { id: last.id, x, y };
    }
    while (strokes.childElementCount > PAD_MAX_SEGMENTS) strokes.firstElementChild!.remove();
    mark(event);
    showNow();
  });
  const lift = (event: PointerEvent): void => {
    if (last?.id !== event.pointerId) return;
    last = null;
    dot.setAttribute("display", "none");
  };
  pad.addEventListener("pointerup", lift);
  pad.addEventListener("pointercancel", lift);

  showNow();
  return { element: pressure, value: curveNow, focus: () => soft.input.focus() };
}

/// Lo stabilizzatore, a partire da `initial` (assente, spento).
export function steadyGroup(initial: Steady | undefined, onChange?: (steady: Steady) => void): HandGroup<Steady> {
  const steady = group(t("draw.touch.steady"));
  const hint = document.createElement("p");
  hint.className = "draw-touch-hint";
  hint.id = `draw-touch-steady-hint-${++groups}`;
  hint.textContent = t("draw.touch.steady.hint");
  steady.setAttribute("aria-describedby", hint.id);
  const knobs = document.createElement("div");
  knobs.className = "draw-touch-knobs";
  const percent = percentFormat();
  const valueNow = (): Steady => ({ amount: valueOf(amount), string: pulled.checked });
  const changed = (): void => onChange?.(valueNow());
  const amount = knob(knobs, t("draw.touch.steady.amount"), 0, 1, initial?.amount ?? 0, (v) => (v === 0 ? t("draw.touch.steady.off") : percent.format(v)), () => show(), changed);
  steady.append(hint, knobs);
  const pulled = check(steady, t("draw.touch.steady.string"), initial?.string ?? false);
  pulled.addEventListener("change", changed);
  const show = (): void => {
    const text = amount.text(valueOf(amount));
    amount.output.textContent = text;
    amount.input.setAttribute("aria-valuetext", text);
    pulled.disabled = valueOf(amount) === 0;
  };
  show();
  return { element: steady, value: valueNow, focus: () => amount.input.focus() };
}

/// Un gruppo di campi col suo titolo.
export function group(title: string): HTMLFieldSetElement {
  const set = document.createElement("fieldset");
  set.className = "draw-touch-group";
  const legend = document.createElement("legend");
  legend.textContent = title;
  set.append(legend);
  return set;
}

/// Una casella col suo nome accanto.
export function check(parent: HTMLElement, label: string, checked: boolean): HTMLInputElement {
  const field = document.createElement("label");
  field.className = "draw-touch-check";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  const name = document.createElement("span");
  name.textContent = label;
  field.append(input, name);
  parent.append(field);
  return input;
}

/// Un disegno di `width` per `height`, che i lettori di schermo saltano
/// finché non gli si dà un nome.
function svg(className: string, width: number, height: number): SVGSVGElement {
  const element = document.createElementNS(SVG_NS, "svg");
  element.setAttribute("class", className);
  element.setAttribute("viewBox", `0 0 ${width} ${height}`);
  element.setAttribute("aria-hidden", "true");
  return element;
}

function path(parent: SVGElement, className: string): SVGPathElement {
  const element = document.createElementNS(SVG_NS, "path");
  element.setAttribute("class", className);
  parent.append(element);
  return element;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/// Il tratto d'esempio con la curva `curve`: un'onda da sinistra a destra,
/// la pressione che sale da zero al pieno a metà e torna a zero, spessa
/// quanto la curva la fa. Il contorno di un tratto pieno, un `d` solo.
export function samplePath(curve: PenCurve, steps = 64): string {
  const apply = pressureCurve(curve);
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  const margin = PAD_MAX_WIDTH;
  const span = PAD_WIDTH - 2 * margin;
  const at = (s: number): [number, number] => [margin + span * s, PAD_HEIGHT / 2 + (PAD_HEIGHT / 4) * Math.sin(s * 2 * Math.PI)];
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const [x, y] = at(s);
    // La direzione dell'onda, e la normale da cui si scosta il contorno.
    const dx = span;
    const dy = (PAD_HEIGHT / 4) * 2 * Math.PI * Math.cos(s * 2 * Math.PI);
    const length = Math.hypot(dx, dy);
    const half = (PAD_MIN_WIDTH + (PAD_MAX_WIDTH - PAD_MIN_WIDTH) * apply(Math.sin(s * Math.PI))) / 2;
    const nx = (-dy / length) * half;
    const ny = (dx / length) * half;
    left.push([round(x + nx), round(y + ny)]);
    right.push([round(x - nx), round(y - ny)]);
  }
  const points = [...left, ...right.reverse()];
  return `${points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join("")}Z`;
}
