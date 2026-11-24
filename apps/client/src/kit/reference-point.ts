// Il punto di riferimento: nove quadratini in tre righe, di cui uno è scelto,
// come il `reference_point` di VectorCraft (gli angoli, i lati e il centro di un
// riquadro). Il valore è l'indice del quadratino, da 0 (in alto a sinistra) a 8
// (in basso a destra) per righe; `null` è «misto» (gli oggetti scelti ne hanno
// più d'uno): nessun quadratino è scelto.
//
// È un gruppo di scelte (`radiogroup`): Tab si ferma una volta sola, sul
// quadratino scelto (o sul primo, se misto); le frecce si muovono nella griglia
// e scelgono, Home e Fine vanno al primo e all'ultimo. Il clic sceglie. Le
// parole (il nome del gruppo e quello di ogni quadratino) arrivano da chi
// chiama.
import type { Lifetime } from "../ui/lifetime";

export interface ReferencePointOptions {
  /// Il nome del gruppo, per chi ascolta.
  label: string;
  /// Il nome di ogni quadratino, nell'ordine dei valori (nove parole).
  pointLabels: readonly string[];
  /// Il quadratino scelto, `null` se misto.
  value: number | null;
  /// Un quadratino scelto da chi usa il controllo (non da `setValue`).
  onChange: (value: number) => void;
  /// Possiede gli ascolti. Senza, stanno sugli elementi e vivono quanto loro.
  lifetime?: Lifetime;
}

export interface ReferencePoint {
  readonly element: HTMLElement;
  value(): number | null;
  /// Scrive il valore senza avvisare: è il programma, non l'utente.
  setValue(value: number | null): void;
  setDisabled(disabled: boolean): void;
}

/// Il quadratino dopo una freccia o Home/Fine da `da` (`null`: nessuno
/// scelto, si parte dal centro), o `null` se il tasto non muove.
export function referencePointStep(da: number | null, key: string): number | null {
  const at = da ?? 4;
  const row = Math.floor(at / 3);
  const col = at % 3;
  switch (key) {
    case "ArrowLeft":
      return row * 3 + Math.max(0, col - 1);
    case "ArrowRight":
      return row * 3 + Math.min(2, col + 1);
    case "ArrowUp":
      return Math.max(0, row - 1) * 3 + col;
    case "ArrowDown":
      return Math.min(2, row + 1) * 3 + col;
    case "Home":
      return 0;
    case "End":
      return 8;
    default:
      return null;
  }
}

function valid(value: number | null): number | null {
  return value !== null && Number.isInteger(value) && value >= 0 && value <= 8 ? value : null;
}

export function referencePoint(options: ReferencePointOptions): ReferencePoint {
  let value = valid(options.value);
  let disabled = false;
  const element = document.createElement("div");
  element.className = "kit-reference-point";
  element.setAttribute("role", "radiogroup");
  element.setAttribute("aria-label", options.label);
  const points = Array.from({ length: 9 }, (_, i) => {
    const point = document.createElement("button");
    point.type = "button";
    point.className = "kit-reference-point-cell";
    point.setAttribute("role", "radio");
    point.setAttribute("aria-label", options.pointLabels[i] ?? String(i + 1));
    point.dataset.point = String(i);
    element.append(point);
    return point;
  });

  const paint = (): void => {
    const stop = value ?? 0;
    points.forEach((point, i) => {
      point.setAttribute("aria-checked", String(i === value));
      point.tabIndex = i === stop ? 0 : -1;
      point.disabled = disabled;
    });
  };

  const choose = (next: number, focus: boolean): void => {
    if (disabled) return;
    const changed = next !== value;
    value = next;
    paint();
    if (focus) points[next]!.focus();
    if (changed) options.onChange(next);
  };

  const onClick = (event: MouseEvent): void => {
    const point = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(".kit-reference-point-cell");
    if (point === null || point === undefined) return;
    choose(Number(point.dataset.point), true);
  };
  const onKey = (event: KeyboardEvent): void => {
    const next = referencePointStep(value, event.key);
    if (next === null) return;
    event.preventDefault();
    choose(next, true);
  };
  if (options.lifetime !== undefined) {
    options.lifetime.listen(element, "click", onClick);
    options.lifetime.listen(element, "keydown", onKey);
  } else {
    element.addEventListener("click", onClick);
    element.addEventListener("keydown", onKey);
  }
  paint();

  return {
    element,
    value: () => value,
    setValue(next) {
      value = valid(next);
      paint();
    },
    setDisabled(next) {
      disabled = next;
      paint();
    },
  };
}
