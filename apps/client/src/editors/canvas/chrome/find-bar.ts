// La barra «Cerca nella lavagna» (N6 T60, H1), in alto a destra della vista,
// con l'aspetto del prototipo (`PLAN-ui/lavagna-impianto.html`, la barra con
// 0, 3 e 200 risultati): il campo, il contatore «3 di 12», ‹ e ›, la ×.
//
// - **Si apre** con `open()`: la chiama `find()` della superficie, così Ctrl+F
//   dello Scrittoio arriva qui. Il fuoco va al campo, col testo di prima scelto.
// - **A ogni tasto** i risultati del file della lavagna (`boardMatches` di
//   `find.ts`, un `includes` per scheda) e il velo, subito. Il contenuto delle
//   note lo chiede all'indice una richiesta sola per ricerca,
//   `FIND_NOTES_DELAY_MS` dopo l'ultimo tasto; una risposta vecchia (un'altra
//   ricerca partita dopo, la barra chiusa) si scarta. Finché la nuova non
//   arriva restano le note trovate da quella di prima: le schede non si velano
//   e si svelano a ogni tasto.
// - **Invio** va al risultato del contatore la prima volta, poi al seguente;
//   **Maiusc+Invio** al precedente. Ogni risultato è un salto della vista
//   (`go`, che la tela fa con `#jumpCamera`): Indietro torna al punto di
//   partenza. Scrivere non muove la vista.
// - **Esc** (o la ×) chiude: il velo se ne va, la vista resta dov'è arrivata.
// - **Il vault senza indice**: la richiesta delle note fallisce, e la barra dice
//   che ha cercato solo nel file della lavagna.
// - Una nota cambiata dopo la ricerca non la rifà: le note trovate restano
//   finché non si cerca di nuovo. Il file della lavagna invece si rilegge a
//   ogni modifica (`refresh`), perché una scheda tolta non resti un risultato.
//
// Sempre gli stessi elementi, creati una volta; ogni ascoltatore e il timer
// stanno nella vita della lavagna.

import { t } from "../../../i18n/strings";
import { iconEl } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";
import { setTooltip } from "../../../ui/tooltip";
import { boardMatches, searchBoardNotes, type BoardFindIndex, type FindNotesPort, type FindTarget } from "../find";
import { displayCanvasKey } from "./commands";
import { ensureCanvasIcons } from "./icons";

/** Quanto aspetta la richiesta delle note dopo l'ultimo tasto, in ms. */
export const FIND_NOTES_DELAY_MS = 200;

export interface CanvasFindPort {
  readonly lifetime: Lifetime;
  /** Il documento della lavagna letto per la ricerca (`boardFindIndex`), `null` senza documento. */
  index(): BoardFindIndex | null;
  /** Chi chiede all'indice le note che contengono la ricerca; di serie `searchBoardNotes`. */
  readonly notes?: FindNotesPort;
  /** I risultati da mostrare col velo, e quello di adesso (`-1` nessuno); `null` toglie il velo. */
  show(matches: readonly FindTarget[] | null, current: number): void;
  /** Porta la vista sul risultato `target`: un salto. */
  go(target: FindTarget): void;
  /** La barra si è chiusa: il fuoco, se era nella barra, torna alla lavagna. */
  closed(hadFocus: boolean): void;
}

export interface CanvasFindBar {
  readonly element: HTMLElement;
  /** Apre la barra (o ci torna) e mette il fuoco nel campo. */
  open(): void;
  /** Chiude la barra: via il velo, la vista resta. */
  close(): void;
  isOpen(): boolean;
  /** Il documento della lavagna è cambiato: i risultati del file si rifanno, le note trovate restano. */
  refresh(): void;
  /** La lingua è cambiata. */
  relabel(): void;
}

export function createCanvasFindBar(port: CanvasFindPort): CanvasFindBar {
  ensureCanvasIcons();
  const notesPort = port.notes ?? searchBoardNotes;
  const element = document.createElement("div");
  element.className = "canvas-find";
  element.setAttribute("role", "search");
  element.hidden = true;
  const input = document.createElement("input");
  input.type = "search";
  input.className = "canvas-find-input";
  input.autocomplete = "off";
  input.spellcheck = false;
  const count = document.createElement("span");
  count.className = "canvas-find-count";
  count.setAttribute("role", "status");
  // Il vault senza indice: la barra cerca solo nel file della lavagna, e lo dice.
  const scope = document.createElement("span");
  scope.className = "canvas-find-scope";
  scope.hidden = true;
  const button = (iconName: string, keys: string | null): HTMLButtonElement => {
    const control = document.createElement("button");
    control.type = "button";
    control.className = "canvas-button";
    if (keys !== null) control.setAttribute("aria-keyshortcuts", keys);
    const svg = iconEl(iconName);
    if (svg) {
      svg.setAttribute("aria-hidden", "true");
      control.append(svg);
    }
    return control;
  };
  const previous = button("canvas-find-previous", "Shift+Enter");
  const next = button("canvas-find-next", "Enter");
  const closeButton = button("close", "Escape");
  element.append(input, count, scope, previous, next, closeButton);

  let open = false;
  /** La ricerca di adesso, com'è scritta. */
  let query = "";
  /** I file delle note che l'indice ha trovato con l'ultima risposta arrivata. */
  let noteHits: ReadonlySet<string> = new Set();
  let notesFailed = false;
  let matches: FindTarget[] = [];
  /** Il risultato del contatore: `-1` senza risultati. */
  let current = -1;
  /** La vista è già stata portata su `current`: il prossimo Invio va al seguente. */
  let visited = false;
  /** Ogni ricerca nuova (e la chiusura) cambia la generazione: una risposta di un'altra si scarta. */
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  port.lifetime.add(() => clearTimeout(timer));

  const relabel = (): void => {
    element.setAttribute("aria-label", t("canvas.find"));
    input.setAttribute("aria-label", t("canvas.find"));
    input.placeholder = t("canvas.find");
    const label = (control: HTMLButtonElement, key: Parameters<typeof t>[0], binding: string): void => {
      const name = t(key);
      control.setAttribute("aria-label", name);
      setTooltip(control, `${name} (${displayCanvasKey(binding)})`);
    };
    label(previous, "canvas.find.previous", "Shift-Enter");
    label(next, "canvas.find.next", "Enter");
    label(closeButton, "canvas.find.close", "Escape");
    scope.textContent = t("canvas.find.no_index");
    paint();
  };

  /** Il contatore, i pulsanti e il velo come dicono i risultati di adesso. */
  function paint(): void {
    const searching = query.trim() !== "";
    const none = searching && matches.length === 0;
    const text = !searching ? "" : none ? t("canvas.find.none") : t("canvas.find.count", { n: current + 1, total: matches.length });
    if (count.textContent !== text) count.textContent = text;
    count.toggleAttribute("data-none", none);
    scope.hidden = !(searching && notesFailed);
    previous.disabled = matches.length === 0;
    next.disabled = matches.length === 0;
    if (open) port.show(searching ? matches : null, current);
  }

  /**
   * Rifà i risultati con la ricerca e le note di adesso. Il risultato del
   * contatore resta lo stesso se c'è ancora; se no si riparte dal primo.
   */
  const rematch = (): void => {
    const index = port.index();
    const was = current >= 0 ? matches[current] : undefined;
    matches = index === null ? [] : boardMatches(index, query, noteHits);
    const kept = was === undefined ? -1 : matches.findIndex((target) => target.kind === was.kind && target.id === was.id);
    if (kept >= 0) {
      current = kept;
    } else {
      current = matches.length > 0 ? 0 : -1;
      visited = false;
    }
  };

  /** La richiesta delle note, partita dal timer: una per ricerca. */
  const askNotes = (): void => {
    timer = undefined;
    const index = port.index();
    const asked = query;
    const mine = generation;
    if (index === null || index.notes.length === 0 || asked.trim() === "") {
      noteHits = new Set();
      rematch();
      paint();
      return;
    }
    notesPort(asked, index.notes).then(
      (hits) => {
        if (mine !== generation || !open || port.lifetime.closed) return;
        noteHits = hits;
        notesFailed = false;
        rematch();
        paint();
      },
      () => {
        if (mine !== generation || !open || port.lifetime.closed) return;
        noteHits = new Set();
        notesFailed = true;
        rematch();
        paint();
      },
    );
  };

  /** La ricerca è cambiata: i risultati del file subito, le note fra poco. */
  const search = (): void => {
    query = input.value;
    generation++;
    clearTimeout(timer);
    current = -1;
    visited = false;
    if (query.trim() === "") {
      timer = undefined;
      noteHits = new Set();
      notesFailed = false;
    } else {
      timer = setTimeout(askNotes, FIND_NOTES_DELAY_MS);
    }
    rematch();
    paint();
  };

  /** Va al risultato seguente (`step` 1) o al precedente (-1). La prima volta, Invio va a quello del contatore. */
  const step = (direction: 1 | -1): void => {
    if (matches.length === 0) return;
    if (!visited && direction === 1 && current >= 0) {
      visited = true;
    } else {
      current = ((current < 0 ? 0 : current) + direction + matches.length) % matches.length;
      visited = true;
    }
    paint();
    port.go(matches[current]!);
  };

  const close = (): void => {
    if (!open) return;
    const hadFocus = element.contains(document.activeElement);
    open = false;
    generation++;
    clearTimeout(timer);
    timer = undefined;
    element.hidden = true;
    port.show(null, -1);
    port.closed(hadFocus);
  };

  port.lifetime.listen(input, "input", () => search());
  port.lifetime.listen(element, "keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Enter" && event.target === input && !event.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      step(event.shiftKey ? -1 : 1);
    }
  });
  port.lifetime.listen(previous, "click", () => step(-1));
  port.lifetime.listen(next, "click", () => step(1));
  port.lifetime.listen(closeButton, "click", () => close());

  relabel();

  return {
    element,
    open: (): void => {
      if (!open) {
        open = true;
        element.hidden = false;
        // La ricerca di prima riparte col documento di adesso.
        if (input.value !== query || query.trim() !== "") search();
        else paint();
      }
      input.focus();
      input.select();
    },
    close,
    isOpen: () => open,
    refresh: (): void => {
      if (!open || query.trim() === "") return;
      rematch();
      paint();
    },
    relabel,
  };
}
