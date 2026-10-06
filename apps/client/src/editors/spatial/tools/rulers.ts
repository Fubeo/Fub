// I righelli del foglio e le guide del documento (livello Standard), e i
// numeri nell'unità del documento. Come la griglia sono un aiuto della vista:
// le guide stanno nel file (`scene/rulers.ts`), ma non si disegnano mai fuori
// dall'editor.
//
// - **L'unità** è quella del documento: le tacche, le misure sulla cornice e
//   sulle guide, i campi delle finestre e gli annunci parlano in quella. Gli
//   spessori e i corpi del testo restano nella scala della barra.
// - **I righelli** coprono il bordo in alto e a sinistra del foglio, sopra il
//   disegno, e quando compaiono il disegno non si sposta. Lo zero è
//   l'origine della scena, l'angolo della pagina di un documento nuovo, come
//   per la griglia. Le tacche col numero vanno a passi di 1, 2 o 5 per una
//   potenza di dieci, i pollici anche a metà, quarti, ottavi e sedicesimi, e
//   distano almeno [`RULER_LABEL_PX`] pixel. Sul righello la pagina ha il
//   fondo del tavolo, la selezione una fascia del colore della linea, il
//   puntatore una linea.
// - **Le guide** attraversano tutta la vista, sopra il disegno e sotto le
//   maniglie, in un azzurro che si vede sulla carta e sul tavolo di ogni
//   tema. Una guida bloccata è tratteggiata, così si riconosce anche senza
//   il colore; quella sotto il puntatore, o che si trascina, ha il colore
//   della linea.

import type { Camera } from "../../../spatial/camera";
import { formatNumber } from "../number";
import type { InkPointerType } from "../pen/pen-input";
import type { Bounds } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import { UNIT_SIZE, type LengthUnit, type RulerGuide } from "../scene/rulers";
import { SVG_NS } from "../scene/xml";

/// Lo spessore di un righello, in pixel CSS: un bersaglio da 24 pixel, da
/// cui si tira una guida anche col dito.
export const RULER_PX = 24;

/// La distanza più piccola, in pixel, fra due tacche col numero.
export const RULER_LABEL_PX = 56;

/// La distanza più piccola, in pixel, fra due tacche qualunque.
export const RULER_TICK_PX = 5;

/// Quanto lontano da una guida il puntatore la prende ancora, in pixel: più
/// largo per la penna e per il dito, come per gli oggetti.
export const GUIDE_HIT_PX: Readonly<Record<InkPointerType, number>> = { mouse: 4, pen: 6, touch: 12 };

/// I decimali di una misura che si legge, e quelli di un campo: un campo ne
/// ha abbastanza da scrivere ogni centesimo di unità utente.
export const UNIT_PLACES: Readonly<Record<LengthUnit, number>> = { px: 1, mm: 1, cm: 2, in: 2, pt: 1 };
export const FIELD_PLACES: Readonly<Record<LengthUnit, number>> = { px: 2, mm: 3, cm: 4, in: 4, pt: 2 };

/// `value`, in unità della scena, nell'unità `unit`.
export function toUnit(value: number, unit: LengthUnit): number {
  return value / UNIT_SIZE[unit];
}

/// `value`, nell'unità `unit`, in unità della scena.
export function fromUnit(value: number, unit: LengthUnit): number {
  return value * UNIT_SIZE[unit];
}

/// `value`, in unità della scena, come lo mostra un campo in `unit`.
export function fieldText(value: number, unit: LengthUnit): string {
  return formatNumber(toUnit(value, unit), FIELD_PLACES[unit]);
}

/// Il minimo di un campo in `unit` che non scende sotto `value` unità della
/// scena: arrotondato in su ai decimali del campo.
export function fieldMin(value: number, unit: LengthUnit): number {
  const factor = 10 ** FIELD_PLACES[unit];
  return Math.ceil(toUnit(value, unit) * factor - 1e-9) / factor;
}

/// Una tacca di un righello.
export interface Tick {
  /// Dove sta, in pixel dall'inizio del righello.
  readonly at: number;
  /// 0 per la tacca col numero, 1 per quella di mezzo, 2 per le altre.
  readonly level: 0 | 1 | 2;
  /// Il valore, nell'unità.
  readonly value: number;
}

/// Le tacche di un righello, e i decimali dei loro numeri.
export interface Ticks {
  readonly ticks: readonly Tick[];
  readonly places: number;
}

/// Un passo fra due tacche col numero, nell'unità, e in quante parti si
/// divide, dalla più fitta: si sceglie la prima che lascia le tacche
/// abbastanza larghe.
interface Step {
  readonly step: number;
  readonly divisions: readonly number[];
}

/// I passi dal più piccolo: 1, 2 e 5 per una potenza di dieci, divisi in
/// decimi, quinti e mezzi; per i pollici da un sedicesimo a 1, le frazioni
/// binarie, e sotto i decimali, che a quello zoom si leggono meglio.
function stepsOf(unit: LengthUnit): Step[] {
  const steps: Step[] = [];
  if (unit === "in") {
    for (const [step, divisions] of [[1 / 16, [2]], [1 / 8, [2]], [1 / 4, [4, 2]], [1 / 2, [8, 4, 2]], [1, [16, 8, 4, 2]]] as const) {
      steps.push({ step, divisions });
    }
  }
  for (let exponent = -3; exponent <= 6; exponent++) {
    const power = exponent < 0 ? 1 / 10 ** -exponent : 10 ** exponent;
    for (const [mantissa, divisions] of [[1, [10, 5, 2]], [2, [4, 2]], [5, [5]]] as const) {
      const step = mantissa * power;
      if (unit !== "in" || step >= 2 || step < 1 / 16) steps.push({ step, divisions });
    }
  }
  return steps.sort((a, b) => a.step - b.step);
}

const STEPS: Readonly<Record<LengthUnit, readonly Step[]>> = {
  px: stepsOf("px"),
  mm: stepsOf("mm"),
  cm: stepsOf("cm"),
  in: stepsOf("in"),
  pt: stepsOf("pt"),
};

/// I decimali che servono per scrivere `value` esatto, fino a sei.
function placesOf(value: number): number {
  for (let places = 0; places < 6; places++) {
    const scaled = value * 10 ** places;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6) return places;
  }
  return 6;
}

/// Le tacche di un righello lungo `length` pixel, con lo zero della scena a
/// `offset` pixel dall'inizio e `scale` pixel per unità della scena,
/// nell'unità `unit`.
export function rulerTicks(offset: number, scale: number, length: number, unit: LengthUnit): Ticks {
  const px = scale * UNIT_SIZE[unit];
  if (!(px > 0) || !Number.isFinite(px) || !Number.isFinite(offset) || !(length > 0)) return { ticks: [], places: 0 };
  const steps = STEPS[unit];
  const chosen = steps.find((each) => each.step * px >= RULER_LABEL_PX) ?? steps[steps.length - 1]!;
  const divisions = chosen.divisions.find((count) => (chosen.step / count) * px >= RULER_TICK_PX) ?? 1;
  const pitch = (chosen.step / divisions) * px;
  const first = Math.ceil(-offset / pitch);
  const last = Math.floor((length - offset) / pitch);
  // Una vista che non si disegnerebbe tacca per tacca non ne ha.
  if (!(last - first <= length / RULER_TICK_PX + 2)) return { ticks: [], places: 0 };
  const ticks: Tick[] = [];
  for (let k = first; k <= last; k++) {
    const rest = ((k % divisions) + divisions) % divisions;
    const level = rest === 0 ? 0 : divisions % 2 === 0 && rest === divisions / 2 ? 1 : 2;
    // Il valore senza le code della virgola mobile, e senza lo zero negativo.
    ticks.push({ at: offset + k * pitch, level, value: Math.round((k / divisions) * chosen.step * 1e6) / 1e6 || 0 });
  }
  return { ticks, places: placesOf(chosen.step) };
}

/// La guida di `guides` sotto il punto `p` dello schermo, entro `reach`
/// pixel: la più vicina, e a pari distanza l'ultima, che si vede sopra le
/// altre. `null` se non ce n'è. `unlocked` lascia fuori le bloccate.
export function guideAt(guides: readonly RulerGuide[], view: Camera, p: Point, reach: number, unlocked: boolean): number | null {
  let best: number | null = null;
  let distance = reach;
  guides.forEach((guide, i) => {
    if (unlocked && guide.locked) return;
    const at = guide.axis === "x" ? view.tx + view.scale * guide.at : view.ty + view.scale * guide.at;
    const apart = Math.abs(at - (guide.axis === "x" ? p[0] : p[1]));
    if (apart <= distance) {
      best = i;
      distance = apart;
    }
  });
  return best;
}

/// Il mezzo pixel su cui una linea di un pixel resta netta.
function crisp(at: number): number {
  return Math.round(at - 0.5) + 0.5;
}

/// Ciò che i righelli mostrano.
export interface RulerView {
  readonly camera: Camera;
  /// La misura del foglio, in pixel.
  readonly width: number;
  readonly height: number;
  readonly unit: LengthUnit;
  /// La pagina, la selezione e il puntatore nella scena, se ci sono.
  readonly page: Bounds | null;
  readonly selection: Bounds | null;
  readonly pointer: Point | null;
}

export interface Rulers {
  readonly element: SVGSVGElement;
  /// Mostra i righelli di `view`, o li nasconde (`null`).
  show(view: RulerView | null): void;
}

/// Monta i righelli dentro `host`, sopra ciò che c'è. `label` scrive il
/// numero di una tacca coi suoi decimali, nella lingua di adesso; `unitName`
/// la sigla dell'unità, nell'angolo.
export function createRulers(host: HTMLElement, label: (value: number, places: number) => string, unitName: (unit: LengthUnit) => string): Rulers {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "draw-rulers");
  svg.setAttribute("aria-hidden", "true");
  svg.style.display = "none";
  const part = <K extends keyof SVGElementTagNameMap>(tag: K, name: string, parent: Element): SVGElementTagNameMap[K] => {
    const element = document.createElementNS(SVG_NS, tag);
    element.setAttribute("data-part", name);
    parent.append(element);
    return element;
  };
  const ruler = (axis: "x" | "y"): { bg: SVGRectElement; page: SVGRectElement; selection: SVGRectElement; ticks: SVGPathElement; labels: SVGGElement; edge: SVGPathElement; pointer: SVGPathElement; pool: SVGTextElement[] } => {
    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("data-ruler", axis);
    svg.append(group);
    return {
      bg: part("rect", "bg", group),
      page: part("rect", "page", group),
      selection: part("rect", "selection", group),
      ticks: part("path", "ticks", group),
      labels: part("g", "labels", group),
      edge: part("path", "edge", group),
      pointer: part("path", "pointer", group),
      pool: [],
    };
  };
  const top = ruler("x");
  const left = ruler("y");
  const corner = part("rect", "corner", svg);
  const cornerText = part("text", "unit", svg);
  corner.setAttribute("width", String(RULER_PX));
  corner.setAttribute("height", String(RULER_PX));
  cornerText.setAttribute("x", String(RULER_PX / 2));
  cornerText.setAttribute("y", String(RULER_PX / 2));
  cornerText.setAttribute("text-anchor", "middle");
  cornerText.setAttribute("dominant-baseline", "central");
  host.append(svg);

  /// Un rettangolo lungo il righello, da `from` a `to` pixel, dentro il
  /// righello e fuori dall'angolo; nascosto se non resta niente.
  const span = (rect: SVGRectElement, axis: "x" | "y", from: number | null, to: number | null, length: number): void => {
    const a = from === null ? 0 : Math.max(RULER_PX, Math.min(from, to!));
    const b = to === null ? 0 : Math.min(length, Math.max(from!, to));
    if (from === null || !(b > a)) {
      rect.setAttribute("display", "none");
      return;
    }
    rect.removeAttribute("display");
    rect.setAttribute(axis === "x" ? "x" : "y", String(a));
    rect.setAttribute(axis === "x" ? "y" : "x", "0");
    rect.setAttribute(axis === "x" ? "width" : "height", String(b - a));
    rect.setAttribute(axis === "x" ? "height" : "width", String(RULER_PX));
  };

  /// Le tacche e i numeri: si rifanno solo quando cambiano la vista, la
  /// misura o l'unità.
  let drawn = "";
  const drawTicks = (view: RulerView): void => {
    const { camera, width, height, unit } = view;
    const key = `${camera.scale} ${camera.tx} ${camera.ty} ${width} ${height} ${unit}`;
    if (key === drawn) return;
    drawn = key;
    for (const [axis, r, length] of [["x", top, width], ["y", left, height]] as const) {
      const offset = axis === "x" ? camera.tx : camera.ty;
      const { ticks, places } = rulerTicks(offset, camera.scale, length, unit);
      let d = "";
      let used = 0;
      for (const tick of ticks) {
        const at = crisp(tick.at);
        if (at < RULER_PX) continue;
        const reach = tick.level === 0 ? RULER_PX : tick.level === 1 ? RULER_PX / 3 : RULER_PX / 6;
        d += axis === "x" ? `M${at} ${RULER_PX - reach}V${RULER_PX}` : `M${RULER_PX - reach} ${at}H${RULER_PX}`;
        if (tick.level !== 0) continue;
        let text = r.pool[used];
        if (text === undefined) {
          text = document.createElementNS(SVG_NS, "text");
          r.pool.push(text);
        }
        used++;
        text.textContent = label(tick.value, places);
        if (axis === "x") {
          text.setAttribute("x", String(at + 3));
          text.setAttribute("y", "10");
          text.removeAttribute("transform");
        } else {
          text.removeAttribute("x");
          text.removeAttribute("y");
          text.setAttribute("transform", `translate(10 ${at - 3}) rotate(-90)`);
        }
      }
      r.ticks.setAttribute("d", d);
      r.labels.replaceChildren(...r.pool.slice(0, used));
      r.bg.setAttribute(axis === "x" ? "width" : "height", String(length));
      r.bg.setAttribute(axis === "x" ? "height" : "width", String(RULER_PX));
      r.edge.setAttribute("d", axis === "x" ? `M${RULER_PX} ${RULER_PX - 0.5}H${length}` : `M${RULER_PX - 0.5} ${RULER_PX}V${length}`);
    }
    cornerText.textContent = unitName(unit);
  };

  return {
    element: svg,
    show(view) {
      svg.style.display = view === null ? "none" : "";
      if (view === null) {
        drawn = "";
        return;
      }
      drawTicks(view);
      const { camera, page, selection, pointer } = view;
      for (const [axis, r, length] of [["x", top, view.width], ["y", left, view.height]] as const) {
        const i = axis === "x" ? 0 : 1;
        const screen = (value: number): number => (axis === "x" ? camera.tx : camera.ty) + camera.scale * value;
        span(r.page, axis, page === null ? null : screen(page.min[i]), page === null ? null : screen(page.max[i]), length);
        span(r.selection, axis, selection === null ? null : screen(selection.min[i]), selection === null ? null : screen(selection.max[i]), length);
        const at = pointer === null ? null : crisp(screen(pointer[i]));
        r.pointer.setAttribute("d", at === null || at < RULER_PX || at > length ? "" : axis === "x" ? `M${at} 0V${RULER_PX}` : `M0 ${at}H${RULER_PX}`);
      }
    },
  };
}

/// Una guida che si trascina: dov'è, e se rilasciata lì se ne va, perché il
/// puntatore è sopra un righello o fuori dal foglio.
export interface MovingGuide {
  readonly axis: "x" | "y";
  readonly at: number;
  readonly away: boolean;
}

/// Ciò che le linee delle guide mostrano.
export interface GuideView {
  readonly camera: Camera;
  readonly width: number;
  readonly height: number;
  readonly guides: readonly RulerGuide[];
  /// La guida sotto il puntatore; quella che si sposta non si vede al suo
  /// posto di prima.
  readonly hot: number | null;
  readonly hidden: number | null;
  readonly moving: MovingGuide | null;
}

export interface GuideLines {
  readonly element: SVGSVGElement;
  /// Mostra le guide di `view`, o le nasconde (`null`).
  show(view: GuideView | null): void;
}

/// Monta le linee delle guide dentro `host`, sopra ciò che c'è.
export function createGuideLines(host: HTMLElement): GuideLines {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "draw-guides");
  svg.setAttribute("aria-hidden", "true");
  svg.style.display = "none";
  const free = document.createElementNS(SVG_NS, "path");
  const locked = document.createElementNS(SVG_NS, "path");
  locked.setAttribute("data-locked", "");
  const hot = document.createElementNS(SVG_NS, "path");
  hot.setAttribute("data-hot", "");
  svg.append(free, locked, hot);
  host.append(svg);
  return {
    element: svg,
    show(view) {
      svg.style.display = view === null ? "none" : "";
      if (view === null) return;
      const { camera, width, height } = view;
      const line = (axis: "x" | "y", value: number): string => {
        const at = crisp(axis === "x" ? camera.tx + camera.scale * value : camera.ty + camera.scale * value);
        if (!Number.isFinite(at) || at < 0 || at > (axis === "x" ? width : height)) return "";
        return axis === "x" ? `M${at} 0V${height}` : `M0 ${at}H${width}`;
      };
      let freeD = "";
      let lockedD = "";
      let hotD = "";
      view.guides.forEach((guide, i) => {
        if (i === view.hidden) return;
        const d = line(guide.axis, guide.at);
        if (i === view.hot) hotD += d;
        else if (guide.locked) lockedD += d;
        else freeD += d;
      });
      const moving = view.moving;
      if (moving !== null) hotD += line(moving.axis, moving.at);
      free.setAttribute("d", freeD);
      locked.setAttribute("d", lockedD);
      hot.setAttribute("d", hotD);
      hot.toggleAttribute("data-away", moving?.away === true);
      hot.toggleAttribute("data-locked", moving === null && view.hot !== null && view.guides[view.hot]?.locked === true);
    },
  };
}
