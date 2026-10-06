// La cronologia come pannello: i passi del disegno, dal più vecchio, e la
// riga dove si è adesso. Un clic o Invio su un passo porta lì in un colpo,
// annullando o ripetendo i passi in mezzo. In cima c'è il disegno com'era:
// «Disegno aperto», o «Inizio della cronologia» quando la pila ha dimenticato
// i passi più vecchi. Un segno sta sotto il passo dopo cui è stato messo, col
// suo nome.
//
// - **Un elenco ARIA.** `role="listbox"`, il fuoco sull'elenco e la riga
//   attiva in `aria-activedescendant`, come nell'albero degli oggetti: le
//   righe non prendono il fuoco, e possono sparire e tornare senza perderlo.
//   La riga di adesso ha `aria-current="step"`. Le frecce muovono la riga
//   attiva senza andarci; Invio o Spazio ci va. Quando ci si muove da fuori,
//   con Annulla o un gesto nuovo, la riga attiva torna su quella di adesso.
// - **Mai il solo colore.** La riga di adesso ha il triangolo e la parola
//   «adesso»; i passi da ripetere sono in corsivo e sbiaditi, e il nome lo
//   dice a parole; un segno ha la sua bandierina, e il nome dice che è un
//   segno.
// - **Scorrere col puntatore.** Col mouse o con la penna, premuto su una riga
//   e trascinato, il disegno segue la riga sotto il puntatore, anche oltre i
//   bordi dell'elenco, che scorre con lui. Il dito scorre l'elenco, e un
//   tocco porta alla riga.
// - **I segni si rinominano e si tolgono qui.** F2, o un doppio clic sul
//   nome, apre il campo: Invio lo scrive, Esc lo lascia com'era, e uscire dal
//   campo lo scrive anche lui. Canc toglie il segno, e col puntatore la croce
//   in fondo alla riga.
// - **Virtualizzato.** Le righe hanno tutte la stessa altezza, e si disegnano
//   quelle che si vedono, più qualcuna, e la riga attiva: mille passi
//   scorrono come dieci.

import { plural, t } from "../strings";
import { identifier } from "../../../ui/a11y";
import { iconEl, icon, registerIcon } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";
import type { Mark, Step } from "./history";
import { cleanName, NAME_MAX } from "./naming";
import { ROW_PX } from "./objects";

/// Le righe disegnate oltre quelle che si vedono, sopra e sotto.
const OVERSCAN = 8;

/// Le icone del pannello, col costrutto di `ui/icons.ts`: il triangolo del
/// punto di adesso, la bandierina del segno e la croce che lo toglie.
const ICONS: Readonly<Record<string, readonly string[]>> = {
  "draw-here": ["M8 5.5l10 6.5-10 6.5z"],
  "draw-mark": ["M6 21V4", "M6 4h11.5l-2.5 4.5 2.5 4.5H6"],
  "draw-unmark": ["M7 7l10 10", "M17 7L7 17"],
};

/// Ciò che il pannello mostra: la cronologia di adesso.
export interface HistoryView {
  /// I passi, dal più vecchio; i primi `done` sono fatti, gli altri da
  /// ripetere.
  readonly steps: readonly Step[];
  readonly done: number;
  /// Il punto prima del passo più vecchio, e se la pila ha dimenticato i
  /// passi prima di lui.
  readonly start: number;
  readonly trimmed: boolean;
  /// Quanti passi la pila ricorda, per dirlo quando ne dimentica.
  readonly limit: number;
  readonly marks: readonly Mark[];
  /// Falso in sola lettura: la cronologia si guarda soltanto.
  readonly editable: boolean;
}

export interface HistoryPanelOptions {
  /// Va al punto `at`; `mark` è il segno da cui ci si va, se ci si va da un
  /// segno.
  onGo(at: number, mark: Mark | null): void;
  /// «Segna questo punto».
  onMark(): void;
  /// Il nome nuovo del segno `id`, già pulito e non vuoto.
  onRename(id: number, name: string): void;
  onUnmark(id: number): void;
  /// Esc: il fuoco torna al foglio.
  onLeave(): void;
}

export interface HistoryPanel {
  /// Il pannello: titolo, conteggio e «Segna questo punto», poi l'elenco.
  readonly element: HTMLElement;
  update(view: HistoryView): void;
  /// Il fuoco va all'elenco, sulla riga attiva.
  focus(): void;
  /// Porta in vista il segno `id` e ne apre il campo del nome. Falso se non
  /// c'è.
  rename(id: number): boolean;
  /// Riscrive i testi nella lingua di adesso.
  relabel(): void;
}

/// Una riga: il punto di partenza, un passo o un segno. `at` è il punto
/// dove porta; `ahead` se sta dopo il punto di adesso.
type Row =
  | { readonly kind: "start"; readonly key: string; readonly at: number; readonly ahead: false }
  | { readonly kind: "step"; readonly key: string; readonly at: number; readonly ahead: boolean; readonly step: Step }
  | { readonly kind: "mark"; readonly key: string; readonly at: number; readonly ahead: boolean; readonly mark: Mark };

/// Le parti di una riga, una volta create.
interface Parts {
  readonly glyph: HTMLElement;
  readonly label: HTMLElement;
  readonly state: HTMLElement;
  readonly now: HTMLElement;
  readonly remove: HTMLElement;
}

export function createHistoryPanel(life: Lifetime, options: HistoryPanelOptions): HistoryPanel {
  for (const [name, paths] of Object.entries(ICONS)) if (icon(name) === "") registerIcon(name, paths);
  const element = document.createElement("section");
  element.className = "draw-history";
  element.id = identifier("draw-history");
  const header = document.createElement("div");
  header.className = "draw-history-header";
  const heading = document.createElement("h2");
  heading.className = "draw-history-title";
  heading.id = identifier("draw-history-title");
  const counter = document.createElement("span");
  counter.className = "draw-history-count";
  // «Segna questo punto» sta nell'intestazione, con la parola che comincia il
  // suo nome: le righe dei passi si prendono l'altezza che resta.
  const markButton = document.createElement("button");
  markButton.type = "button";
  markButton.className = "draw-button draw-history-action";
  const markIcon = iconEl("draw-mark");
  const markText = document.createElement("span");
  if (markIcon !== null) {
    markIcon.setAttribute("aria-hidden", "true");
    markButton.append(markIcon);
  }
  markButton.append(markText);
  header.append(heading, counter, markButton);
  const note = document.createElement("p");
  note.className = "draw-history-note";
  const empty = document.createElement("p");
  empty.className = "draw-history-empty";
  const scroller = document.createElement("div");
  scroller.className = "draw-history-scroll";
  const list = document.createElement("div");
  list.className = "draw-history-list";
  list.id = identifier("draw-history-list");
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-labelledby", heading.id);
  list.tabIndex = 0;
  scroller.append(list);
  element.setAttribute("aria-labelledby", heading.id);
  element.append(header, note, empty, scroller);

  const prefix = identifier("draw-history-row");
  let view: HistoryView | null = null;
  let rows: Row[] = [];
  let current = "";
  /// Il punto di adesso all'ultimo `update`: quando cambia, la riga attiva
  /// torna su quella di adesso.
  let followed: number | null = null;
  let position = 0;
  let active: string | null = null;
  let rendered = new Map<string, HTMLElement>();
  const parts = new WeakMap<HTMLElement, Parts>();

  /// Il campo del nome, uno solo: sta sulla riga del segno `renaming`.
  const field = document.createElement("input");
  field.type = "text";
  field.className = "draw-history-rename";
  field.autocomplete = "off";
  field.maxLength = NAME_MAX;
  let renaming: string | null = null;

  /// Il puntatore premuto sull'elenco, mentre scorre la cronologia.
  let scrubbing: { readonly pointer: number; key: string } | null = null;
  /// Il mouse o la penna sono già andati alla riga premendo: il clic che
  /// segue non ci va di nuovo.
  let pressed = false;

  const rowId = (key: string): string => `${prefix}-${key}`;
  const indexOf = (key: string | null): number => (key === null ? -1 : rows.findIndex((row) => row.key === key));
  const editable = (): boolean => view?.editable ?? false;

  const startLabel = (): string => t(view?.trimmed ? "draw.history.start" : "draw.history.opened");
  const labelOf = (row: Row): string => (row.kind === "start" ? startLabel() : row.kind === "step" ? t(row.step.label) : row.mark.name);

  /// Le righe della cronologia `next`: la partenza, poi ogni passo coi segni
  /// che stanno dopo di lui.
  const flatten = (next: HistoryView): void => {
    const here = next.done === 0 ? next.start : next.steps[next.done - 1]!.serial;
    const out: Row[] = [{ kind: "start", key: `p${next.start}`, at: next.start, ahead: false }];
    let sign = 0;
    const marksTo = (at: number): void => {
      for (; sign < next.marks.length && next.marks[sign]!.at <= at; sign++) {
        const mark = next.marks[sign]!;
        out.push({ kind: "mark", key: `m${mark.id}`, at: mark.at, ahead: mark.at > here, mark });
      }
    };
    marksTo(next.start);
    next.steps.forEach((step, at) => {
      out.push({ kind: "step", key: `p${step.serial}`, at: step.serial, ahead: at >= next.done, step });
      marksTo(step.serial);
    });
    marksTo(Infinity);
    rows = out;
    position = here;
    current = `p${here}`;
    if (followed !== here) {
      followed = here;
      active = current;
      revealSoon = true;
    } else if (indexOf(active) < 0) {
      active = current;
    }
  };

  let revealSoon = false;

  const partsOf = (item: HTMLElement): Parts => {
    let found = parts.get(item);
    if (found !== undefined) return found;
    item.className = "draw-history-row";
    item.setAttribute("role", "option");
    const glyph = document.createElement("span");
    glyph.className = "draw-history-glyph";
    const label = document.createElement("span");
    label.className = "draw-history-label";
    // Il nome dice a parole ciò che il corsivo e la bandierina mostrano.
    const state = document.createElement("span");
    state.className = "sr-only";
    const now = document.createElement("span");
    now.className = "draw-history-now";
    const remove = document.createElement("span");
    remove.className = "draw-history-remove";
    const cross = iconEl("draw-unmark");
    if (cross !== null) remove.append(cross);
    // Il triangolo, la parola «adesso» e la croce sono per gli occhi: la
    // riga di adesso lo dice con `aria-current`, e la tastiera ha Canc.
    for (const part of [glyph, now, remove]) part.setAttribute("aria-hidden", "true");
    item.append(glyph, label, state, now, remove);
    found = { glyph, label, state, now, remove };
    parts.set(item, found);
    return found;
  };

  /// Scrive `row` nel nodo `item`, nuovo o di prima.
  const paintRow = (item: HTMLElement, row: Row, index: number): void => {
    const { glyph, label, state, now, remove } = partsOf(item);
    const here = row.key === current;
    item.id = rowId(row.key);
    item.dataset.key = row.key;
    item.dataset.index = String(index);
    item.dataset.kind = row.kind;
    item.setAttribute("aria-posinset", String(index + 1));
    item.setAttribute("aria-setsize", String(rows.length));
    if (here) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
    // La scelta segue la riga attiva, come in ogni elenco a scelta singola:
    // andarci è Invio.
    item.setAttribute("aria-selected", String(row.key === active));
    item.toggleAttribute("data-ahead", row.ahead);
    item.toggleAttribute("data-active", row.key === active);
    item.style.top = `${index * ROW_PX}px`;
    item.style.height = `${ROW_PX}px`;
    const shape = here ? "draw-here" : row.kind === "mark" ? "draw-mark" : "";
    if (glyph.dataset.shape !== shape) {
      glyph.dataset.shape = shape;
      const drawn = shape === "" ? null : iconEl(shape);
      glyph.replaceChildren(...(drawn === null ? [] : [drawn]));
    }
    const text = labelOf(row);
    if (label.textContent !== text) label.textContent = text;
    if (item.title !== text) item.title = text;
    const said = [row.kind === "mark" ? t("draw.history.mark.kind") : "", row.ahead ? t("draw.history.ahead") : ""].filter((part) => part !== "");
    const stateText = said.length === 0 ? "" : `, ${said.join(", ")}`;
    if (state.textContent !== stateText) state.textContent = stateText;
    now.hidden = !here;
    if (here && now.textContent !== t("draw.history.now")) now.textContent = t("draw.history.now");
    remove.hidden = row.kind !== "mark" || !editable();
    remove.title = row.kind === "mark" ? t("draw.history.unmark") : "";
    item.toggleAttribute("data-renaming", row.key === renaming);
  };

  /// Le righe da disegnare: quelle che si vedono, più qualcuna, la riga
  /// attiva e quella che si rinomina.
  const windowOf = (): number[] => {
    const first = Math.max(0, Math.floor(scroller.scrollTop / ROW_PX) - OVERSCAN);
    const visible = Math.ceil((scroller.clientHeight || ROW_PX * 12) / ROW_PX);
    const last = Math.min(rows.length - 1, first + visible + 2 * OVERSCAN);
    const indices: number[] = [];
    for (let index = first; index <= last; index++) indices.push(index);
    for (const key of [active, renaming]) {
      const index = indexOf(key);
      if (index >= 0 && (index < first || index > last) && !indices.includes(index)) indices.push(index);
    }
    return indices;
  };

  const render = (): void => {
    const steps = view?.steps.length ?? 0;
    counter.textContent = plural(steps, "draw.history.count.one", "draw.history.count.other");
    note.hidden = !(view?.trimmed ?? false);
    if (view !== null && !note.hidden) note.textContent = t("draw.history.trimmed", { count: view.limit });
    empty.hidden = steps > 0;
    markButton.disabled = !editable();
    if (editable()) list.removeAttribute("aria-disabled");
    else list.setAttribute("aria-disabled", "true");
    list.style.height = `${rows.length * ROW_PX}px`;
    const next = new Map<string, HTMLElement>();
    const nodes = windowOf().map((index) => {
      const row = rows[index]!;
      const item = rendered.get(row.key) ?? document.createElement("div");
      paintRow(item, row, index);
      next.set(row.key, item);
      return item;
    });
    for (const [key, item] of rendered) if (!next.has(key)) item.remove();
    rendered = next;
    // Le righe nell'ordine dell'elenco, spostando quelle fuori posto. Quella
    // col campo del nome resta dov'è: spostata, il campo perderebbe il fuoco
    // e scriverebbe il nome a metà.
    const still = renaming !== null && field.isConnected ? next.get(renaming) : undefined;
    let cursor = list.firstElementChild;
    for (const node of nodes) {
      if (node === still) continue;
      if (cursor === still) cursor = cursor?.nextElementSibling ?? null;
      if (cursor === node) {
        cursor = node.nextElementSibling;
        continue;
      }
      list.insertBefore(node, cursor);
    }
    if (active === null) list.removeAttribute("aria-activedescendant");
    else list.setAttribute("aria-activedescendant", rowId(active));
    if (revealSoon) {
      revealSoon = false;
      reveal();
    }
  };

  /// Porta in vista la riga attiva.
  const reveal = (): void => {
    const index = indexOf(active);
    if (index < 0) return;
    const top = index * ROW_PX;
    const height = scroller.clientHeight;
    const before = scroller.scrollTop;
    if (top < before) scroller.scrollTop = top;
    else if (height > 0 && top + ROW_PX > before + height) scroller.scrollTop = top + ROW_PX - height;
    if (scroller.scrollTop !== before) render();
  };

  const moveTo = (index: number): void => {
    if (rows.length === 0) return;
    active = rows[Math.max(0, Math.min(rows.length - 1, index))]!.key;
    render();
    reveal();
  };

  /// Va alla riga `key`, se la cronologia si cambia e non ci si è già; in
  /// sola lettura la riga diventa soltanto quella attiva. La riga resta
  /// attiva anche se è un segno, o se il salto si è fermato prima.
  const go = (key: string | null): void => {
    const row = rows[indexOf(key)];
    if (row === undefined) return;
    active = row.key;
    if (editable() && row.at !== position) options.onGo(row.at, row.kind === "mark" ? row.mark : null);
    if (indexOf(row.key) >= 0) active = row.key;
    render();
  };

  const page = (): number => Math.max(1, Math.floor((scroller.clientHeight || ROW_PX * 10) / ROW_PX) - 1);

  // --- Il nome dei segni ------------------------------------------------------

  const startRename = (key: string): boolean => {
    const index = indexOf(key);
    const row = rows[index];
    if (row === undefined || row.kind !== "mark" || !editable()) return false;
    finishRename(true, false);
    active = key;
    renaming = key;
    render();
    reveal();
    const item = rendered.get(key);
    if (item === undefined) return false;
    field.value = row.mark.name;
    field.setAttribute("aria-label", t("draw.history.rename", { name: row.mark.name }));
    item.append(field);
    field.focus({ preventScroll: true });
    field.select();
    return true;
  };

  /// Chiude il campo del nome; se `write`, il nome scritto vale. Con
  /// `refocus` il fuoco torna all'elenco.
  const finishRename = (write: boolean, refocus: boolean): void => {
    if (renaming === null) return;
    const key = renaming;
    renaming = null;
    const row = rows[indexOf(key)];
    const name = cleanName(field.value);
    field.remove();
    if (refocus) list.focus({ preventScroll: true });
    render();
    if (write && row?.kind === "mark" && name !== "" && name !== row.mark.name) options.onRename(row.mark.id, name);
  };

  life.listen(field, "keydown", (event) => {
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    finishRename(event.key === "Enter", true);
  });
  // Uscire dal campo scrive il nome; passare a un'altra finestra no, e al
  // ritorno il campo è ancora lì.
  life.listen(field, "blur", () => {
    if (typeof document.hasFocus === "function" && !document.hasFocus()) return;
    finishRename(true, false);
  });
  life.listen(field, "pointerdown", (event) => event.stopPropagation());
  life.listen(field, "click", (event) => event.stopPropagation());
  life.listen(field, "dblclick", (event) => event.stopPropagation());

  // --- La tastiera --------------------------------------------------------------

  life.listen(list, "keydown", (event) => {
    if (event.target !== list || event.altKey || event.ctrlKey || event.metaKey) return;
    const at = indexOf(active);
    const row = rows[at];
    switch (event.key) {
      case "ArrowDown":
        moveTo(at + 1);
        break;
      case "ArrowUp":
        moveTo(at - 1);
        break;
      case "PageDown":
        moveTo(at + page());
        break;
      case "PageUp":
        moveTo(at - page());
        break;
      case "Home":
        moveTo(0);
        break;
      case "End":
        moveTo(rows.length - 1);
        break;
      case "Enter":
      case " ":
        go(active);
        break;
      // F2 e Canc sono dei segni: sugli altri passi non arrivano al foglio,
      // dove cambierebbero il nome o toglierebbero gli oggetti scelti.
      case "F2":
        if (row?.kind === "mark") startRename(row.key);
        break;
      case "Delete":
      case "Backspace":
        if (row?.kind === "mark" && editable()) options.onUnmark(row.mark.id);
        break;
      case "Escape":
        options.onLeave();
        break;
      default:
        return;
    }
    event.preventDefault();
    // L'editor non deve vedere il tasto: le frecce, qui, non spostano niente.
    event.stopPropagation();
  });

  // --- Il puntatore -------------------------------------------------------------

  const rowAt = (target: EventTarget | null): number => {
    const item = target instanceof Element ? target.closest<HTMLElement>(".draw-history-row") : null;
    return item === null ? -1 : Number(item.dataset.index);
  };

  /// La riga sotto il punto `y` dello schermo.
  const rowAtY = (y: number): number => Math.max(0, Math.min(rows.length - 1, Math.floor((y - list.getBoundingClientRect().top) / ROW_PX)));

  // La riga si legge prima di prendere il fuoco: lasciare il foglio può
  // concludere un testo, e con lui cambiare la cronologia.
  life.listen(list, "pointerdown", (event) => {
    pressed = false;
    if (event.button !== 0 || event.pointerType === "touch") return;
    const key = rows[rowAt(event.target)]?.key;
    if (key === undefined) return;
    list.focus({ preventScroll: true });
    if (event.target instanceof Element && event.target.closest(".draw-history-remove") !== null) return;
    event.preventDefault();
    pressed = true;
    scrubbing = { pointer: event.pointerId, key };
    // Il puntatore resta all'elenco anche fuori, e il rilascio arriva qui.
    // Un puntatore già andato non si cattura.
    try {
      list.setPointerCapture(event.pointerId);
    } catch {
      // Niente: il rilascio fuori dall'elenco non arriva, e lo scorrimento
      // finisce al primo passaggio senza tasti premuti.
    }
    go(key);
  });
  life.listen(list, "pointermove", (event) => {
    if (scrubbing === null || event.pointerId !== scrubbing.pointer) return;
    if (event.buttons === 0) {
      scrubbing = null;
      return;
    }
    const row = rows[rowAtY(event.clientY)];
    if (row === undefined || row.key === scrubbing.key) return;
    scrubbing.key = row.key;
    go(row.key);
    // Oltre il bordo dell'elenco la riga sotto il puntatore non si vede: la
    // si porta in vista, e l'elenco scorre col puntatore che va più in là.
    reveal();
  });
  const endScrub = (event: PointerEvent): void => {
    if (scrubbing === null || event.pointerId !== scrubbing.pointer) return;
    scrubbing = null;
    if (typeof list.hasPointerCapture === "function" && list.hasPointerCapture(event.pointerId)) list.releasePointerCapture(event.pointerId);
  };
  life.listen(list, "pointerup", endScrub);
  life.listen(list, "pointercancel", endScrub);

  // Il dito, che non scorre la cronologia, ci arriva col tocco; la croce
  // toglie il segno.
  life.listen(list, "click", (event) => {
    const row = rows[rowAt(event.target)];
    if (row === undefined) return;
    if (event.target instanceof Element && event.target.closest(".draw-history-remove") !== null) {
      if (row.kind === "mark" && editable()) options.onUnmark(row.mark.id);
      return;
    }
    list.focus({ preventScroll: true });
    if (pressed) pressed = false;
    else go(row.key);
  });

  life.listen(list, "dblclick", (event) => {
    const row = rows[rowAt(event.target)];
    const onLabel = event.target instanceof Element && event.target.closest(".draw-history-label") !== null;
    if (row?.kind === "mark" && onLabel) startRename(row.key);
  });

  life.listen(scroller, "scroll", () => render());
  life.listen(markButton, "click", () => options.onMark());

  const relabel = (): void => {
    heading.textContent = t("draw.history");
    markText.textContent = t("draw.history.mark.short");
    markButton.setAttribute("aria-label", t("draw.history.mark"));
    markButton.title = t("draw.history.mark");
    empty.textContent = t("draw.history.empty");
    for (const item of rendered.values()) item.removeAttribute("title");
    render();
  };
  relabel();

  return {
    element,
    update(next) {
      view = next;
      flatten(next);
      if (renaming !== null && indexOf(renaming) < 0) finishRename(false, list.contains(document.activeElement) || document.activeElement === field);
      render();
    },
    focus() {
      if (active === null) active = current;
      list.focus({ preventScroll: true });
      render();
      reveal();
    },
    rename: (id) => startRename(`m${id}`),
    relabel,
  };
}
