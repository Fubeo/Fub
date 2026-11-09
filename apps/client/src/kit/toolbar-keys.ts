// Le frecce di una barra in una fila (`kit-bar`): il modello della barra degli
// strumenti WAI-ARIA, scritto una volta per tutte le barre che lo adottano.
//
// - **Un solo punto di tabulazione.** Il controllo corrente ha `tabIndex` 0,
//   gli altri -1: il Tab entra nella barra e ne esce con un passo solo.
// - **Le frecce.** Destra e sinistra passano al controllo vicino e girano ai
//   capi; Home e Fine vanno al primo e all'ultimo. Contano solo i controlli
//   visibili e accesi: uno spento, o dentro un gruppo nascosto (il troppo
//   finito in «…»), si salta.
// - **I campi di testo.** Le frecce muovono il cursore del testo e passano al
//   controllo vicino solo ai capi del testo; Home e Fine restano al campo.
// - **Escape** è di chi usa la barra: con `onEscape` la barra lo prende (la
//   barra di formato riporta il fuoco all'editor), senza lo lascia passare.
//
// La barra si ridisegna (i comandi cambiano, un gruppo va in «…»): per questo
// `controls` è una funzione che dà i controlli di adesso, e `refresh` rimette
// il punto di tabulazione dopo ogni ridisegno. L'ascoltatore vive quanto la
// `Lifetime` che chi monta la barra passa qui.
//
// Il kit non ha testo suo, e questo modulo non disegna niente: aggiunge la
// tastiera a un DOM che c'è già.

import type { Lifetime } from "../ui/lifetime";

export interface RovingToolbarOptions {
  /// I controlli della barra adesso, nell'ordine del DOM: pulsanti, elenchi e
  /// campi, compresi quelli spenti o nascosti (questo modulo li filtra).
  readonly controls: () => readonly HTMLElement[];
  /// Escape su un controllo della barra. Assente: Escape non è della barra.
  readonly onEscape?: (event: KeyboardEvent) => void;
}

export interface RovingToolbar {
  /// Il controllo che riceve il Tab, o `null` in una barra senza controlli
  /// raggiungibili.
  readonly current: HTMLElement | null;
  /// Rimette il punto di tabulazione dopo un ridisegno: su `preferred` se è
  /// raggiungibile, se no sul corrente, se no sul primo.
  refresh(preferred?: HTMLElement | null): HTMLElement | null;
  /// Sposta il fuoco su un controllo della barra e ne fa il corrente.
  focus(control: HTMLElement): void;
}

/// I tipi di `<input>` in cui le frecce muovono il cursore del testo.
const TEXT_INPUTS = new Set(["text", "search", "url", "tel", "email", "password", "number"]);

function isTextField(control: HTMLElement): control is HTMLInputElement | HTMLTextAreaElement {
  if (control instanceof HTMLTextAreaElement) return true;
  return control instanceof HTMLInputElement && TEXT_INPUTS.has(control.type);
}

function isDisabled(control: HTMLElement): boolean {
  if ((control as HTMLButtonElement).disabled === true) return true;
  return control.getAttribute("aria-disabled") === "true";
}

/// Il cursore sta al capo del testo verso cui va la freccia, senza una
/// selezione. Un campo che non dice dove sta il cursore (un `number` in alcuni
/// motori) si considera ai capi: le frecce non restano intrappolate.
function atEdge(field: HTMLInputElement | HTMLTextAreaElement, forward: boolean): boolean {
  let start: number | null;
  let end: number | null;
  try {
    start = field.selectionStart;
    end = field.selectionEnd;
  } catch {
    return true;
  }
  if (start === null || end === null) return true;
  if (start !== end) return false;
  return forward ? end >= field.value.length : start <= 0;
}

/// Aggiunge a `element` le frecce di una barra degli strumenti.
export function rovingToolbar(element: HTMLElement, options: RovingToolbarOptions, lifetime: Lifetime): RovingToolbar {
  let current: HTMLElement | null = null;

  /// I controlli raggiungibili adesso: visibili e non spenti.
  const reachable = (): HTMLElement[] =>
    options.controls().filter((control) => !isDisabled(control) && !control.closest("[hidden]"));

  function refresh(preferred: HTMLElement | null = current): HTMLElement | null {
    const all = options.controls();
    const live = reachable();
    if (preferred && live.includes(preferred)) current = preferred;
    else if (!current || !live.includes(current)) current = live[0] ?? null;
    for (const control of all) control.tabIndex = control === current ? 0 : -1;
    return current;
  }

  function focus(control: HTMLElement): void {
    refresh(control);
    control.focus();
  }

  /// Il controllo della barra che contiene `target`, se c'è.
  function owner(target: EventTarget | null, list: readonly HTMLElement[]): HTMLElement | null {
    if (!(target instanceof Node)) return null;
    return list.find((control) => control === target || control.contains(target)) ?? null;
  }

  lifetime.listen(element, "keydown", (event) => {
    if (event.defaultPrevented || event.isComposing) return;
    if (event.key === "Escape") {
      if (!options.onEscape || !owner(event.target, options.controls())) return;
      event.preventDefault();
      options.onEscape(event);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const live = reachable();
    const control = owner(event.target, live);
    if (!control) return;
    const at = live.indexOf(control);
    const field = isTextField(control) ? control : null;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        if (field && !atEdge(field, true)) return;
        next = (at + 1) % live.length;
        break;
      case "ArrowLeft":
        if (field && !atEdge(field, false)) return;
        next = (at - 1 + live.length) % live.length;
        break;
      case "Home":
        if (field) return;
        next = 0;
        break;
      case "End":
        if (field) return;
        next = live.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    focus(live[next]!);
  });

  // Il fuoco che entra per un'altra via (un clic, il Tab, un `focus()` di chi
  // usa la barra) fa del controllo il corrente.
  lifetime.listen(element, "focusin", (event) => {
    const control = owner(event.target, reachable());
    if (control && control !== current) refresh(control);
  });

  return {
    get current() {
      return current;
    },
    refresh,
    focus,
  };
}
