// Il campo numerico del kit: un numero nell'unità del campo, che si scrive
// con le operazioni e le unità (`quantity.ts`), si cambia con le frecce e si
// tira sull'etichetta, come nei programmi di disegno.
//
// - **Scrivere.** Invio, o il fuoco che se ne va, conferma ciò che si è
//   scritto; Esc torna al valore di prima. Ciò che non si legge resta scritto,
//   il campo si dice non valido e l'errore si legge accanto.
// - **Le frecce.** Su e giù cambiano di un passo (con Maiuscolo dieci, con
//   Alt un decimo) e confermano subito.
// - **L'etichetta si tira.** Trascinata di lato cambia il valore di un passo
//   ogni `SCRUB_PX` pixel, con gli stessi modificatori; durante il gesto
//   `onPreview` vede i valori, al rilascio parte una conferma sola.
// - **Misto.** `value: null` è una selezione con valori diversi: il campo è
//   vuoto e dice `mixedText`; le frecce e l'etichetta non hanno da dove
//   partire, e `%` non ha di che essere parte.
//
// Il kit non ha testo suo: il nome, «Misto» e le parole degli errori
// arrivano da chi chiama.
import { identifier } from "../ui/a11y";
import type { Lifetime } from "../ui/lifetime";
import { evaluate, type QuantityProblem } from "./quantity";

/// Quanti pixel di trascinamento fanno un passo.
export const SCRUB_PX = 4;

export interface NumberFieldOptions {
  /// Il nome del campo.
  label: string;
  /// L'etichetta resta per chi ascolta e non si vede; non si tira.
  labelHidden?: boolean;
  /// Il valore; `null` se la selezione ne ha più d'uno.
  value: number | null;
  /// La sigla dell'unità accanto al valore.
  unit?: string;
  /// Le unità che il campo accetta, minuscole, e quanto vale ciascuna
  /// nell'unità del campo. Senza, quella del campo soltanto.
  units?: Readonly<Record<string, number>>;
  /// Vero se `%` è una parte del valore.
  relative?: boolean;
  /// I decimali che il campo mostra, e a cui arrotonda.
  places?: number;
  min?: number;
  max?: number;
  /// Di quanto cambia una freccia. Uno, se non si dice.
  step?: number;
  /// La lingua dei numeri mostrati. Quella del documento, se non si dice.
  language?: string;
  /// Che cosa dice un campo misto.
  mixedText: string;
  /// Le parole di un errore.
  problem: (problem: QuantityProblem | "mixed") => string;
  /// Un valore confermato. Una stringa è il motivo per cui non è stato
  /// preso: il campo resta com'era scritto e la dice.
  onCommit: (value: number) => string | void;
  /// I valori mentre si tira l'etichetta, prima della conferma.
  onPreview?: (value: number) => void;
  /// Possiede gli ascolti. Senza, stanno sugli elementi e vivono quanto loro.
  lifetime?: Lifetime;
}

export interface NumberField {
  /// Etichetta, campo ed errore insieme: è ciò che si monta.
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  value(): number | null;
  /// Scrive il valore senza confermarlo: è il programma, non l'utente. Ciò
  /// che si sta scrivendo resta, finché il campo ha il fuoco.
  setValue(value: number | null): void;
  setDisabled(disabled: boolean): void;
  focus(): void;
}

/// Arrotonda a `places` decimali, senza lo zero col segno.
export function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor + 0;
}

/// Il numero come lo mostra il campo: al più `places` decimali, senza zeri in
/// coda, col separatore della lingua del documento.
export function numberText(value: number, places: number, language = document.documentElement.lang || "en"): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits: places, useGrouping: false }).format(roundTo(value, places));
}

/// Il passo di un tasto o di un trascinamento, coi modificatori.
export function stepFactor(event: { readonly shiftKey: boolean; readonly altKey: boolean }): number {
  if (event.shiftKey) return 10;
  if (event.altKey) return 0.1;
  return 1;
}

export function numberField(options: NumberFieldOptions): NumberField {
  const places = options.places ?? 0;
  const step = options.step ?? 1;
  const units = options.units ?? (options.unit ? { [options.unit.toLowerCase()]: 1 } : {});
  let value = options.value;
  /// Il testo che il campo mostrava l'ultima volta: scritto diverso, è una
  /// bozza.
  let shown = "";

  const element = document.createElement("div");
  element.className = "kit-number";

  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.className = "kit-number-input";
  input.id = identifier("kit-number");
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("role", "spinbutton");

  const label = document.createElement("label");
  label.className = options.labelHidden ? "kit-number-label sr-only" : "kit-number-label";
  label.htmlFor = input.id;
  label.textContent = options.label;

  const unit = document.createElement("span");
  unit.className = "kit-number-unit";
  unit.setAttribute("aria-hidden", "true");
  unit.textContent = options.unit ?? "";
  unit.hidden = !options.unit;

  const box = document.createElement("div");
  box.className = "kit-number-box";
  box.append(input, unit);

  const error = document.createElement("div");
  error.className = "kit-number-error";
  error.id = identifier("kit-number-error");
  error.hidden = true;
  input.setAttribute("aria-describedby", error.id);

  element.append(label, box, error);

  const listen = <K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void => {
    if (options.lifetime) options.lifetime.listen(target, type, handler);
    else target.addEventListener(type, handler as EventListener);
  };

  const clamp = (next: number): number => {
    let out = next;
    if (options.min !== undefined) out = Math.max(options.min, out);
    if (options.max !== undefined) out = Math.min(options.max, out);
    return roundTo(out, places);
  };

  const showError = (message: string | null): void => {
    error.textContent = message ?? "";
    error.hidden = message === null;
    if (message === null) input.removeAttribute("aria-invalid");
    else input.setAttribute("aria-invalid", "true");
  };

  const paint = (): void => {
    shown = value === null ? "" : numberText(value, places, options.language);
    input.value = shown;
    input.placeholder = value === null ? options.mixedText : "";
    if (value === null) input.removeAttribute("aria-valuenow");
    else input.setAttribute("aria-valuenow", String(roundTo(value, places)));
    const spoken = value === null ? options.mixedText : `${shown}${options.unit ? ` ${options.unit}` : ""}`;
    input.setAttribute("aria-valuetext", spoken);
    if (options.min !== undefined) input.setAttribute("aria-valuemin", String(options.min));
    if (options.max !== undefined) input.setAttribute("aria-valuemax", String(options.max));
  };

  /// Il numero scritto, nell'unità del campo e dentro i limiti, o le parole
  /// di che cosa non va.
  const typed = (): number | string => {
    const out = evaluate(input.value, { units, current: value, relative: options.relative ?? false });
    return "problem" in out ? options.problem(out.problem) : clamp(out.value);
  };

  /// Conferma `next`: falso se chi chiama non l'ha preso.
  const commit = (next: number): boolean => {
    const failure = options.onCommit(next);
    if (typeof failure === "string") {
      showError(failure);
      return false;
    }
    value = next;
    showError(null);
    paint();
    return true;
  };

  /// Conferma ciò che è scritto, se è cambiato.
  const commitTyped = (): void => {
    if (input.readOnly || input.disabled || input.value === shown) {
      if (input.value === shown) showError(null);
      return;
    }
    const next = typed();
    if (typeof next === "string") {
      showError(next);
      return;
    }
    if (value !== null && next === roundTo(value, places)) {
      paint();
      showError(null);
      return;
    }
    commit(next);
  };

  /// Da dove parte una freccia: ciò che è scritto, se si legge, o il valore.
  const base = (): number | string | null => {
    if (input.value !== shown && input.value.trim() !== "") return typed();
    return value;
  };

  const nudge = (delta: number): void => {
    if (input.readOnly || input.disabled) return;
    const from = base();
    if (typeof from === "string") {
      showError(from);
      return;
    }
    if (from === null) {
      showError(options.problem("mixed"));
      return;
    }
    const next = clamp(from + delta);
    if (value !== null && next === roundTo(value, places) && input.value === shown) return;
    commit(next);
  };

  listen(input, "keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      commitTyped();
    } else if (event.key === "Escape" && input.value !== shown) {
      event.preventDefault();
      event.stopPropagation();
      input.value = shown;
      showError(null);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      nudge((event.key === "ArrowUp" ? step : -step) * stepFactor(event));
    }
  });
  listen(input, "blur", () => commitTyped());

  // L'etichetta si tira: il valore segue il puntatore, e parte al rilascio.
  let scrub: { readonly pointer: number; readonly x: number; readonly from: number; moved: boolean; last: number } | null = null;
  listen(label, "pointerdown", (event) => {
    if (options.labelHidden || event.button > 0 || input.readOnly || input.disabled || value === null) return;
    event.preventDefault();
    scrub = { pointer: event.pointerId, x: event.clientX, from: value, moved: false, last: value };
    label.setPointerCapture?.(event.pointerId);
    element.classList.add("scrubbing");
  });
  listen(label, "pointermove", (event) => {
    if (!scrub || event.pointerId !== scrub.pointer) return;
    const steps = Math.trunc((event.clientX - scrub.x) / SCRUB_PX);
    if (steps === 0 && !scrub.moved) return;
    scrub.moved = true;
    const next = clamp(scrub.from + steps * step * stepFactor(event));
    if (next === scrub.last) return;
    scrub.last = next;
    input.value = numberText(next, places, options.language);
    options.onPreview?.(next);
  });
  const endScrub = (event: PointerEvent, keep: boolean): void => {
    if (!scrub || event.pointerId !== scrub.pointer) return;
    const done = scrub;
    scrub = null;
    element.classList.remove("scrubbing");
    label.releasePointerCapture?.(event.pointerId);
    if (!done.moved) {
      // Un clic sull'etichetta porta il fuoco al campo, come una `label`.
      input.focus();
      input.select();
      return;
    }
    if (keep && done.last !== done.from) {
      if (!commit(done.last)) options.onPreview?.(done.from);
    } else {
      input.value = shown;
      if (done.last !== done.from) options.onPreview?.(done.from);
    }
  };
  listen(label, "pointerup", (event) => endScrub(event, true));
  listen(label, "pointercancel", (event) => endScrub(event, false));
  // La `label` sposta il fuoco col clic: il gesto lo fa da sé.
  listen(label, "click", (event) => event.preventDefault());

  paint();

  return {
    element,
    input,
    value: () => value,
    setValue(next) {
      value = next;
      const drafting = document.activeElement === input && input.value !== shown;
      if (drafting) {
        const draft = input.value;
        paint();
        input.value = draft;
      } else {
        paint();
      }
    },
    setDisabled(disabled) {
      input.disabled = disabled;
      element.classList.toggle("disabled", disabled);
    },
    focus: () => input.focus(),
  };
}
