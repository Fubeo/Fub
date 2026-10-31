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
// - **Il foglio girato:** le guide girano con lui, perché sono della scena.
//   I righelli no: misurano lungo i bordi dello schermo, che sul foglio
//   girato non seguono più un asse. Restano senza tacche, e nell'angolo una
//   freccia mostra dove sta l'alto del foglio.

import { formatNumber } from "../number";
import type { Bounds } from "../scene/geometry";
import type { Point } from "../scene/matrix";
import { UNIT_SIZE, type LengthUnit, type RulerGuide } from "../scene/rulers";
import type { View } from "../view";

/// La distanza più piccola, in pixel, fra due tacche col numero.
export const RULER_LABEL_PX = 56;

/// La distanza più piccola, in pixel, fra due tacche qualunque.
export const RULER_TICK_PX = 5;

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

/// Ciò che i righelli mostrano.
export interface RulerView {
  readonly camera: View;
  /// La misura del foglio, in pixel.
  readonly width: number;
  readonly height: number;
  readonly unit: LengthUnit;
  /// La pagina, la selezione e il puntatore nella scena, se ci sono.
  readonly page: Bounds | null;
  readonly selection: Bounds | null;
  readonly pointer: Point | null;
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
  readonly camera: View;
  readonly width: number;
  readonly height: number;
  readonly guides: readonly RulerGuide[];
  /// La guida sotto il puntatore; quella che si sposta non si vede al suo
  /// posto di prima.
  readonly hot: number | null;
  readonly hidden: number | null;
  readonly moving: MovingGuide | null;
}
