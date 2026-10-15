// Il divisore: la maniglia fra due riquadri, che ne sposta il confine.
//
// La misura non è sua. La legge con `value()`, propone con `onInput` mentre il
// gesto dura e consegna con `onCommit` quando finisce: chi lo monta decide dove
// vive (una variabile CSS, il layout) e che cosa vuol dire salvarla.
//
// Oltre i limiti il gesto non si blocca di colpo: cede, sempre meno. Quindi
// `onInput` può ricevere misure fuori dai limiti, di pochi pixel; `onCommit`
// mai. Al rilascio la misura torna subito sul limite, e la maniglia ci torna
// con la molla `elastic` da dove il puntatore l'ha lasciata: il ritorno è una
// trasformazione della maniglia, non una misura riscritta a ogni fotogramma,
// che rifarebbe il layout di tutto ciò che il divisore governa.
//
// Due cose restano al foglio di stile della maniglia, come per ogni gesto di
// `moto`: `touch-action: none` e `user-select: none`. Le mette `kit.css`.
import { animate, drag, motionLevel, type Motion } from "../moto";
import type { Lifetime } from "../ui/lifetime";

export interface SplitterOptions {
  handle: HTMLElement;
  /// L'orientamento **della maniglia**, come lo intende `aria-orientation`:
  /// `vertical` è una linea verticale fra due riquadri affiancati, e si
  /// trascina in orizzontale.
  orientation: "vertical" | "horizontal";
  /// La misura corrente (px) del riquadro che il divisore governa.
  value: () => number;
  min: number | (() => number);
  max: number | (() => number);
  /// Il passo delle frecce (px); con Maiusc vale cinque volte. Di serie 16.
  step?: number;
  /// Il riquadro governato sta dopo la maniglia (a destra, o sotto): andare
  /// avanti lo restringe.
  reverse?: boolean;
  /// La misura proposta mentre il gesto dura. Può uscire dai limiti.
  onInput: (px: number) => void;
  /// La misura scelta, sempre dentro i limiti. Dopo le frecce arriva subito
  /// dopo `onInput`, con lo stesso valore.
  onCommit: (px: number) => void;
  /// Doppio clic, o Invio con la maniglia a fuoco: torna alla misura di serie.
  onReset?: () => void;
  /// Il nome accessibile.
  label: string;
  /// L'id del riquadro governato, per `aria-controls`.
  controls?: string;
  lifetime: Lifetime;
}

export interface SplitterHandle {
  /// Rilegge misura e limiti negli attributi ARIA: per chi cambia la misura da
  /// fuori, o i limiti quando la finestra cambia.
  sync(): void;
}

const DEFAULT_STEP_PX = 16;
const SHIFT_FACTOR = 5;
/// Quanto cede all'inizio un gesto oltre il limite: metà dello spostamento.
const RESIST_SLOPE = 0.5;
/// Il tetto (px) a cui il cedimento tende senza arrivarci.
export const RESIST_LIMIT_PX = 36;

/// Di quanto si sposta la misura per uno spostamento `over` (px) oltre il
/// limite. Cresce sempre, sempre meno, e non passa `RESIST_LIMIT_PX`.
export function resist(over: number): number {
  const pull = RESIST_SLOPE * Math.abs(over);
  return (Math.sign(over) * (RESIST_LIMIT_PX * pull)) / (RESIST_LIMIT_PX + pull);
}

export function mountSplitter(options: SplitterOptions): SplitterHandle {
  const { handle, lifetime } = options;
  const vertical = options.orientation === "vertical";
  const sign = options.reverse ? -1 : 1;
  const step = options.step ?? DEFAULT_STEP_PX;
  const low = (): number => (typeof options.min === "function" ? options.min() : options.min);
  const high = (): number =>
    Math.max(low(), typeof options.max === "function" ? options.max() : options.max);
  const clamp = (px: number): number => Math.min(Math.max(px, low()), high());

  const sync = (): void => {
    // Un gesto annullato dallo smontaggio passa ancora di qui.
    if (lifetime.closed) return;
    handle.setAttribute("aria-valuemin", String(Math.round(low())));
    handle.setAttribute("aria-valuemax", String(Math.round(high())));
    handle.setAttribute("aria-valuenow", String(Math.round(clamp(options.value()))));
  };

  handle.classList.add("kit-splitter");
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", options.orientation);
  handle.setAttribute("aria-label", options.label);
  if (options.controls) handle.setAttribute("aria-controls", options.controls);
  handle.tabIndex = 0;
  sync();

  /// Il ritorno della maniglia sul limite dopo un rilascio oltre.
  let back: Motion | null = null;
  const stopBack = (): void => {
    back?.cancel();
    back = null;
  };
  /// La misura da cui il gesto è partito.
  let origin = 0;

  /// La misura che il gesto propone: dentro i limiti è quella del puntatore,
  /// oltre cede. Nel livello «ridotto» si ferma sul limite.
  const shape = (raw: number): number => {
    const inside = clamp(raw);
    if (raw === inside || motionLevel() === "reduced") return inside;
    return inside + resist(raw - inside);
  };
  const along = (info: { dx: number; dy: number }): number =>
    origin + sign * (vertical ? info.dx : info.dy);

  drag(handle, {
    onStart() {
      stopBack();
      origin = clamp(options.value());
      handle.dataset.dragging = "";
    },
    onMove(info) {
      const raw = along(info);
      options.onInput(shape(raw));
      handle.setAttribute("aria-valuenow", String(Math.round(clamp(raw))));
    },
    onEnd(info) {
      const raw = along(info);
      const shaped = shape(raw);
      const chosen = clamp(raw);
      delete handle.dataset.dragging;
      // La scelta arriva subito, e la misura con lei: il ritorno è solo ciò
      // che si vede della maniglia.
      if (shaped !== chosen) options.onInput(chosen);
      options.onCommit(chosen);
      sync();
      const over = sign * (shaped - chosen);
      if (over !== 0) {
        back = animate(handle, { from: vertical ? { x: over } : { y: over }, spring: "elastic", lifetime });
      }
    },
    onCancel() {
      delete handle.dataset.dragging;
      options.onInput(origin);
      sync();
    },
    lifetime,
  });

  lifetime.listen(handle, "keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const stride = step * (event.shiftKey ? SHIFT_FACTOR : 1);
    const forward = vertical ? "ArrowRight" : "ArrowDown";
    const backward = vertical ? "ArrowLeft" : "ArrowUp";
    let next: number;
    if (event.key === forward) next = options.value() + sign * stride;
    else if (event.key === backward) next = options.value() - sign * stride;
    else if (event.key === "Home") next = low();
    else if (event.key === "End") next = high();
    else if (event.key === "Enter" && options.onReset) {
      event.preventDefault();
      stopBack();
      options.onReset();
      sync();
      return;
    } else return;
    event.preventDefault();
    stopBack();
    next = clamp(next);
    options.onInput(next);
    options.onCommit(next);
    sync();
  });
  lifetime.listen(handle, "dblclick", () => {
    if (!options.onReset) return;
    stopBack();
    options.onReset();
    sync();
  });

  lifetime.add(() => {
    delete handle.dataset.dragging;
    for (const name of [
      "role",
      "aria-orientation",
      "aria-label",
      "aria-valuemin",
      "aria-valuemax",
      "aria-valuenow",
      "tabindex",
    ]) {
      handle.removeAttribute(name);
    }
    if (options.controls) handle.removeAttribute("aria-controls");
    handle.classList.remove("kit-splitter");
  });

  return { sync };
}
