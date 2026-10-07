// Le tavole come pannello: le pagine del disegno, nell'ordine del file, ognuna
// col suo numero, il nome e la misura. Un clic, Invio o Spazio su una tavola
// ci porta; «Nuova tavola» ne aggiunge una. Un disegno senza tavole è una
// pagina sola, e il pannello lo dice, con ciò che farebbe «Nuova tavola».
//
// - **Un elenco ARIA.** `role="listbox"`, il fuoco sull'elenco e la riga
//   attiva in `aria-activedescendant`, come nella cronologia: le righe non
//   prendono il fuoco, e possono sparire e tornare senza perderlo. Le frecce
//   muovono la riga attiva senza andarci; Invio o Spazio ci va. Quando la
//   tavola di adesso cambia da fuori, la riga attiva la segue.
// - **Mai il solo colore.** La tavola di adesso ha `aria-current="true"`, il
//   triangolo e il grassetto, e il nome della riga lo dice a parole:
//   «Tavola 2 di 5: Evaporazione, 1600 × 1000 px, corrente».
// - **Le tavole si cambiano qui.** F2, o un doppio clic sul nome, apre il
//   campo del nome: Invio lo scrive, Esc lo lascia com'era, e uscire dal
//   campo lo scrive anche lui. Ctrl+D, ⌘D sul Mac, duplica la tavola col suo
//   contenuto; Alt+↑ e Alt+↓ la spostano fra le sue vicine, Canc la elimina;
//   il clic destro, Maiusc+F10 o il tasto del menu aprono il suo menu. In
//   sola lettura le tavole si guardano e ci si va, e basta: gli altri tasti
//   dicono perché non fanno niente. Al limite delle tavole «Duplica» non
//   aggiunge, e lo dice come «Nuova tavola».
// - **Il fuoco resta nel pannello.** «Nuova tavola» non lo prende col
//   puntatore. Quando ciò che lo aveva se ne va, passa all'elenco, al
//   pulsante o alla spiegazione del pannello vuoto, e non si perde.
// - **Virtualizzato.** Le righe hanno tutte la stessa altezza, e si disegnano
//   quelle che si vedono, più qualcuna, la riga attiva, quella del campo e
//   quella del menu: mille tavole scorrono come dieci.

import { resolvedLanguage } from "../../../i18n/strings";
import { identifier, stableIdentifier } from "../../../ui/a11y";
import { displayBinding } from "../../../ui/commands";
import { iconEl, icon, registerIcon } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";
import { closeContextMenu, showContextMenu, type MenuItem } from "../../../ui/menu";
import { MAX_BOARDS } from "../scene/read";
import { plural, t } from "../strings";
import { cleanName, NAME_MAX } from "./naming";
import { ROW_PX } from "./objects";

/// Le righe disegnate oltre quelle che si vedono, sopra e sotto.
const OVERSCAN = 8;

/// Dopo il menu aperto dalla tastiera, per tanti millisecondi il clic destro
/// che il tasto del menu manda dietro non ne apre un altro.
const KEYED_MENU_MS = 1000;

/// Le icone del pannello, col costrutto di `ui/icons.ts`: il più di «Nuova
/// tavola» e il triangolo della tavola di adesso.
const ICONS: Readonly<Record<string, readonly string[]>> = {
  "draw-board-add": ["M12 5v14", "M5 12h14"],
  "draw-board-here": ["M8 5.5l10 6.5-10 6.5z"],
};

/// Una riga del pannello: una tavola.
export interface BoardRow {
  readonly id: string;
  /// Il nome, come lo dice l'editor: il titolo della tavola, o il suo id.
  readonly name: string;
  /// La misura, già scritta nell'unità del documento: «210 × 297 mm».
  readonly size: string;
}

/// Ciò che il pannello mostra.
export interface BoardsView {
  /// Le tavole, nell'ordine del disegno.
  readonly boards: readonly BoardRow[];
  /// La tavola di adesso: quella scelta con lo strumento Tavola, o quella
  /// in vista; `null` se nessuna.
  readonly current: string | null;
  /// Falso in sola lettura: le tavole si guardano e ci si va, e basta.
  readonly editable: boolean;
  /// Vero se il disegno riceve un'altra tavola, cioè se è sotto il limite
  /// di 1 000.
  readonly canAdd: boolean;
  /// Vero se il disegno ha una pagina: senza tavole, «Nuova tavola» la fa
  /// diventare la tavola 1. Senza pagina, la tavola nuova racchiude il
  /// disegno.
  readonly paged: boolean;
}

export interface BoardsPanelOptions {
  /// Porta alla tavola `id`, anche in sola lettura.
  onGo(id: string): void;
  /// «Nuova tavola».
  onAdd(): void;
  /// Il nome nuovo della tavola `id`, già pulito con `cleanName` di
  /// `naming.ts`, non vuoto e diverso da quello di prima.
  onRename(id: string, name: string): void;
  /// «Duplica»: una copia della tavola `id` col suo contenuto. Arriva solo
  /// se il disegno si cambia e riceve un'altra tavola.
  onDuplicate(id: string): void;
  onDelete(id: string): void;
  /// Porta la tavola `id` al posto `to`, contato da 0, nell'ordine delle
  /// tavole.
  onMove(id: string, to: number): void;
  /// Esc: il fuoco torna al foglio.
  onLeave(): void;
  /// «Presenta da qui»: presenta dalla tavola `id`. Il menu la offre se
  /// `canPresent` dice di sì quando si apre.
  onPresent?(id: string): void;
  canPresent?(): boolean;
}

export interface BoardsPanel {
  /// Il pannello: titolo, conteggio e «Nuova tavola», poi l'elenco.
  readonly element: HTMLElement;
  update(view: BoardsView): void;
  /// Il fuoco va all'elenco, sulla riga attiva; senza tavole, a «Nuova
  /// tavola», o alla spiegazione se il pulsante non si usa.
  focus(): void;
  /// Porta in vista la tavola `id` e ne apre il campo del nome. Falso se non
  /// c'è, o in sola lettura.
  rename(id: string): boolean;
  /// Riscrive i testi nella lingua di adesso.
  relabel(): void;
}

/// Le parti di una riga, una volta create.
interface Parts {
  readonly glyph: HTMLElement;
  readonly number: HTMLElement;
  readonly name: HTMLElement;
  readonly size: HTMLElement;
}

/// Scrive `text` in `node`, se non c'è già.
function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function createBoardsPanel(life: Lifetime, options: BoardsPanelOptions): BoardsPanel {
  for (const [name, paths] of Object.entries(ICONS)) if (icon(name) === "") registerIcon(name, paths);
  const element = document.createElement("section");
  element.className = "draw-boards";
  element.id = identifier("draw-boards");
  const header = document.createElement("div");
  header.className = "draw-boards-header";
  const heading = document.createElement("h2");
  heading.className = "draw-boards-title";
  heading.id = identifier("draw-boards-title");
  const counter = document.createElement("span");
  counter.className = "draw-boards-count";
  // «Nuova tavola» sta nell'intestazione: le righe si prendono l'altezza che
  // resta.
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "draw-button draw-boards-add";
  const addIcon = iconEl("draw-board-add");
  const addText = document.createElement("span");
  if (addIcon !== null) {
    addIcon.setAttribute("aria-hidden", "true");
    addButton.append(addIcon);
  }
  addButton.append(addText);
  header.append(heading, counter, addButton);
  // La spiegazione del pannello vuoto prende il fuoco quando nient'altro può:
  // in sola lettura, senza tavole.
  const empty = document.createElement("p");
  empty.className = "draw-boards-empty";
  empty.id = identifier("draw-boards-empty");
  empty.tabIndex = -1;
  const scroller = document.createElement("div");
  scroller.className = "draw-boards-scroll";
  const list = document.createElement("div");
  list.className = "draw-boards-list";
  list.id = identifier("draw-boards-list");
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-labelledby", heading.id);
  list.tabIndex = 0;
  scroller.append(list);
  // Che cosa fanno i tasti nell'elenco, letto quando ci arriva il fuoco.
  const hint = document.createElement("span");
  hint.className = "sr-only";
  hint.id = identifier("draw-boards-hint");
  list.setAttribute("aria-describedby", hint.id);
  // Perché un tasto non ha fatto niente.
  const live = document.createElement("div");
  live.className = "sr-only";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  element.setAttribute("aria-labelledby", heading.id);
  element.append(header, empty, scroller, hint, live);

  const prefix = identifier("draw-board-row");
  let view: BoardsView | null = null;
  let rows: readonly BoardRow[] = [];
  /// Il posto di ogni tavola in `rows`.
  let places = new Map<string, number>();
  let current: string | null = null;
  let active: string | null = null;
  let rendered = new Map<string, HTMLElement>();
  const parts = new WeakMap<HTMLElement, Parts>();
  let revealSoon = false;

  /// Il campo del nome, uno solo: sta sulla riga della tavola `renaming`.
  const field = document.createElement("input");
  field.type = "text";
  field.className = "draw-board-rename";
  field.autocomplete = "off";
  field.maxLength = NAME_MAX;
  let renaming: string | null = null;

  /// La tavola del menu aperto, finché è aperto: la sua riga resta disegnata,
  /// perché il menu prende il nome da lei.
  let menuFor: string | null = null;
  /// Quando il menu si è aperto dalla tastiera.
  let keyedMenu = -Infinity;

  const rowId = (key: string): string => stableIdentifier(prefix, key);
  const indexOf = (key: string | null): number => (key === null ? -1 : (places.get(key) ?? -1));
  const editable = (): boolean => view?.editable ?? false;
  /// Vero se il disegno si cambia ma ha già tutte le tavole che può avere.
  const full = (): boolean => editable() && !(view?.canAdd ?? false);

  let numbers: { readonly language: string; readonly format: Intl.NumberFormat } | null = null;
  /// Un numero come lo scrive la lingua di adesso.
  const numeral = (value: number): string => {
    const language = resolvedLanguage();
    if (numbers?.language !== language) numbers = { language, format: new Intl.NumberFormat(language) };
    return numbers.format.format(value);
  };

  let echo = false;
  /// Lo dice a chi ascolta: lo stesso testo due volte di fila si dice due
  /// volte.
  const say = (text: string): void => {
    echo = !echo;
    live.textContent = echo ? text : `${text} `;
  };
  const refuse = (): void => say(t("draw.rejected", { reason: t("draw.reason.read_only") }));
  const fullText = (): string => t("draw.boards.add.full", { count: numeral(MAX_BOARDS) });

  /// Il nome della riga, che dice tutto ciò che la riga mostra.
  const labelOf = (row: BoardRow, index: number): string => {
    const args = { number: numeral(index + 1), total: numeral(rows.length), name: row.name, size: row.size };
    return t(row.id === current ? "draw.boards.row.current" : "draw.boards.row", args);
  };

  const partsOf = (item: HTMLElement): Parts => {
    let found = parts.get(item);
    if (found !== undefined) return found;
    item.className = "draw-board-row";
    item.setAttribute("role", "option");
    // Il triangolo è per gli occhi: la riga lo dice con `aria-current` e col
    // suo nome.
    const glyph = document.createElement("span");
    glyph.className = "draw-board-glyph";
    glyph.setAttribute("aria-hidden", "true");
    const number = document.createElement("span");
    number.className = "draw-board-number";
    const name = document.createElement("span");
    name.className = "draw-board-name";
    const size = document.createElement("span");
    size.className = "draw-board-size";
    item.append(glyph, number, name, size);
    found = { glyph, number, name, size };
    parts.set(item, found);
    return found;
  };

  /// Scrive `row` nel nodo `item`, nuovo o di prima.
  const paintRow = (item: HTMLElement, row: BoardRow, index: number): void => {
    const { glyph, number, name, size } = partsOf(item);
    const here = row.id === current;
    item.id = rowId(row.id);
    item.dataset.key = row.id;
    item.dataset.index = String(index);
    item.setAttribute("aria-posinset", String(index + 1));
    item.setAttribute("aria-setsize", String(rows.length));
    if (here) item.setAttribute("aria-current", "true");
    else item.removeAttribute("aria-current");
    // La scelta segue la riga attiva, come in ogni elenco a scelta singola:
    // andarci è Invio.
    item.setAttribute("aria-selected", String(row.id === active));
    item.toggleAttribute("data-active", row.id === active);
    item.style.top = `${index * ROW_PX}px`;
    item.style.height = `${ROW_PX}px`;
    const label = labelOf(row, index);
    if (item.getAttribute("aria-label") !== label) item.setAttribute("aria-label", label);
    const shape = here ? "draw-board-here" : "";
    if (glyph.dataset.shape !== shape) {
      glyph.dataset.shape = shape;
      const drawn = shape === "" ? null : iconEl(shape);
      glyph.replaceChildren(...(drawn === null ? [] : [drawn]));
    }
    setText(number, numeral(index + 1));
    setText(name, row.name);
    // Il nome intero, quando la riga lo accorcia.
    if (name.title !== row.name) name.title = row.name;
    setText(size, row.size);
    item.toggleAttribute("data-renaming", row.id === renaming);
  };

  /// Le righe da disegnare: quelle che si vedono, più qualcuna, la riga
  /// attiva, quella che si rinomina e quella del menu.
  const windowOf = (): number[] => {
    if (rows.length === 0) return [];
    const first = Math.max(0, Math.floor(scroller.scrollTop / ROW_PX) - OVERSCAN);
    const visible = Math.ceil((scroller.clientHeight || ROW_PX * 12) / ROW_PX);
    const last = Math.min(rows.length - 1, first + visible + 2 * OVERSCAN);
    const indices: number[] = [];
    for (let index = first; index <= last; index++) indices.push(index);
    for (const key of [active, renaming, menuFor]) {
      const index = indexOf(key);
      if (index >= 0 && (index < first || index > last) && !indices.includes(index)) indices.push(index);
    }
    return indices;
  };

  const render = (): void => {
    const total = rows.length;
    const canEdit = editable();
    setText(counter, plural(total, "draw.boards.count.one", "draw.boards.count.other", { count: numeral(total) }));
    empty.hidden = total > 0;
    scroller.hidden = total === 0;
    setText(empty, t(!canEdit ? "draw.boards.empty.read_only" : (view?.paged ?? true) ? "draw.boards.empty" : "draw.boards.empty.unbounded"));
    setText(hint, canEdit ? t("draw.boards.hint", { duplicate: displayBinding("Mod-d") }) : t("draw.boards.hint.read_only"));
    // In sola lettura «Nuova tavola» si spegne come gli altri comandi. Al
    // limite delle tavole resta raggiungibile, e dice perché non aggiunge.
    addButton.disabled = !canEdit;
    if (full()) {
      addButton.setAttribute("aria-disabled", "true");
      if (addButton.title !== fullText()) addButton.title = fullText();
    } else {
      addButton.removeAttribute("aria-disabled");
      addButton.removeAttribute("title");
    }
    // Senza tavole, il pulsante si spiega con la spiegazione del pannello.
    if (total === 0) addButton.setAttribute("aria-describedby", empty.id);
    else addButton.removeAttribute("aria-describedby");
    list.style.height = `${total * ROW_PX}px`;
    const next = new Map<string, HTMLElement>();
    const nodes = windowOf().map((index) => {
      const row = rows[index]!;
      const item = rendered.get(row.id) ?? document.createElement("div");
      paintRow(item, row, index);
      next.set(row.id, item);
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
    if (indexOf(active) < 0) list.removeAttribute("aria-activedescendant");
    else list.setAttribute("aria-activedescendant", rowId(active!));
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
    active = rows[Math.max(0, Math.min(rows.length - 1, index))]!.id;
    render();
    reveal();
  };

  const page = (): number => Math.max(1, Math.floor((scroller.clientHeight || ROW_PX * 10) / ROW_PX) - 1);

  /// Dove va il fuoco nel pannello: all'elenco se ci sono tavole; se no a
  /// «Nuova tavola», o alla spiegazione quando il pulsante è spento.
  const fallback = (): HTMLElement => (rows.length > 0 ? list : addButton.disabled ? empty : addButton);

  /// Vero se il fuoco sta su qualcosa del pannello che si vede e si usa.
  const holdsFocus = (): boolean => {
    const at = document.activeElement;
    if (!(at instanceof HTMLElement) || !element.contains(at) || at.closest("[hidden]") !== null) return false;
    return !(at instanceof HTMLButtonElement && at.disabled);
  };

  // --- Ciò che le tavole fanno --------------------------------------------------

  /// Va alla tavola `key`, che diventa la riga attiva; anche in sola lettura.
  const go = (key: string): void => {
    if (indexOf(key) < 0) return;
    active = key;
    options.onGo(key);
    if (indexOf(key) >= 0) active = key;
    render();
  };

  /// Sposta la tavola `key` di un posto: prima con `step` -1, dopo con 1. Al
  /// bordo non c'è dove andare, e lo si dice.
  const shift = (key: string, step: -1 | 1): void => {
    const index = indexOf(key);
    if (index < 0) return;
    if (!editable()) {
      refuse();
      return;
    }
    const to = index + step;
    if (to < 0 || to >= rows.length) {
      say(t(step < 0 ? "draw.boards.edge.first" : "draw.boards.edge.last"));
      return;
    }
    active = key;
    options.onMove(key, to);
  };

  /// Duplica la tavola `key`; al limite delle tavole dice perché non lo fa,
  /// come «Nuova tavola».
  const duplicate = (key: string): void => {
    if (indexOf(key) < 0) return;
    if (!editable()) refuse();
    else if (full()) say(fullText());
    else options.onDuplicate(key);
  };

  const remove = (key: string): void => {
    if (indexOf(key) < 0) return;
    if (editable()) options.onDelete(key);
    else refuse();
  };

  // --- Il nome delle tavole -----------------------------------------------------

  const startRename = (key: string): boolean => {
    if (indexOf(key) < 0 || !editable()) return false;
    // Un altro nome a metà si scrive, e può cambiare le tavole.
    finishRename(true, false);
    const row = rows[indexOf(key)];
    if (row === undefined || !editable()) return false;
    active = key;
    renaming = key;
    render();
    reveal();
    const item = rendered.get(key);
    if (item === undefined) {
      renaming = null;
      return false;
    }
    field.value = row.name;
    field.setAttribute("aria-label", t("draw.boards.rename", { name: row.name }));
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
    if (write && row !== undefined && editable() && name !== "" && name !== row.name) options.onRename(row.id, name);
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
  // Il puntatore nel campo è del campo: non va alla tavola, e il clic destro
  // apre il menu del testo, non quello della tavola.
  for (const type of ["pointerdown", "click", "dblclick", "contextmenu"] as const) life.listen(field, type, (event) => event.stopPropagation());

  // --- Il menu ------------------------------------------------------------------

  /// Apre il menu della tavola `key` nel punto `at`; senza punto, sotto la
  /// sua riga, come lo apre la tastiera.
  const openMenu = (key: string, at: MouseEvent | null): void => {
    finishRename(true, false);
    const index = indexOf(key);
    if (index < 0) return;
    active = key;
    render();
    reveal();
    const canEdit = editable();
    const first = index === 0;
    const last = index === rows.length - 1;
    // Una voce spenta al bordo dice perché, come nel menu del foglio. In sola
    // lettura sono spente tutte, tranne «Vai» e «Presenta da qui», che non
    // cambiano il disegno.
    const items: MenuItem[] = [
      { label: t("draw.boards.menu.go"), hint: displayBinding("Enter"), run: () => go(key) },
      ...(options.canPresent?.() ? [{ label: t("draw.boards.menu.present"), run: () => options.onPresent?.(key) }] : []),
      { label: t("draw.boards.menu.rename"), hint: displayBinding("F2"), disabled: !canEdit, run: () => void startRename(key) },
      {
        label: t("draw.boards.menu.duplicate"),
        hint: displayBinding("Mod-d"),
        disabled: !canEdit || full(),
        ...(full() ? { description: fullText() } : {}),
        run: () => duplicate(key),
      },
      {
        label: t("draw.boards.menu.up"),
        separator: true,
        hint: displayBinding("Alt-ArrowUp"),
        disabled: !canEdit || first,
        ...(canEdit && first ? { description: t("draw.boards.edge.first") } : {}),
        run: () => shift(key, -1),
      },
      {
        label: t("draw.boards.menu.down"),
        hint: displayBinding("Alt-ArrowDown"),
        disabled: !canEdit || last,
        ...(canEdit && last ? { description: t("draw.boards.edge.last") } : {}),
        run: () => shift(key, 1),
      },
      {
        label: t("draw.boards.menu.delete"),
        separator: true,
        hint: displayBinding("Delete"),
        danger: true,
        disabled: !canEdit,
        run: () => remove(key),
      },
    ];
    let point = at;
    if (point === null) {
      const box = (rendered.get(key) ?? list).getBoundingClientRect();
      point = new MouseEvent("contextmenu", { clientX: box.left + 24, clientY: box.bottom, bubbles: true, cancelable: true });
    }
    // Il menu prende il nome dalla riga, che c'è finché il menu è aperto.
    showContextMenu(point, items, { labelledBy: rowId(key), onClose: () => (menuFor = null) });
    menuFor = key;
  };

  // --- La tastiera --------------------------------------------------------------

  life.listen(list, "keydown", (event) => {
    if (event.target !== list) return;
    const at = indexOf(active);
    const key = rows[at]?.id ?? null;
    if (event.ctrlKey || event.metaKey) {
      // Ctrl+D, ⌘D sul Mac, è della tavola: non arriva al foglio, dove
      // duplicherebbe gli oggetti scelti. Gli altri tasti con Ctrl vanno
      // avanti.
      if (event.altKey || event.shiftKey || event.key.toLowerCase() !== "d") return;
      if (key !== null) duplicate(key);
    } else if (event.altKey) {
      if (event.shiftKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      if (key !== null) shift(key, event.key === "ArrowUp" ? -1 : 1);
    } else if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      if (key === null) return;
      keyedMenu = event.timeStamp;
      openMenu(key, null);
    } else {
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
          if (key !== null) go(key);
          break;
        // F2 e Canc sono delle tavole: qui non arrivano al foglio, dove
        // cambierebbero il nome o toglierebbero gli oggetti scelti.
        case "F2":
          if (key !== null && !startRename(key) && !editable()) refuse();
          break;
        case "Delete":
        case "Backspace":
          if (key !== null) remove(key);
          break;
        case "Escape":
          options.onLeave();
          break;
        default:
          return;
      }
    }
    event.preventDefault();
    // L'editor non deve vedere il tasto: le frecce, qui, non spostano niente.
    event.stopPropagation();
  });
  // Esc fuori dall'elenco, su «Nuova tavola» o sulla spiegazione, riporta al
  // foglio come dall'elenco.
  life.listen(element, "keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.target === field) return;
    event.preventDefault();
    event.stopPropagation();
    options.onLeave();
  });

  // --- Il puntatore -------------------------------------------------------------

  /// La tavola della riga sotto `target`, se c'è.
  const keyAt = (target: EventTarget | null): string | null => {
    const item = target instanceof Element ? target.closest<HTMLElement>(".draw-board-row") : null;
    const key = item !== null && list.contains(item) ? item.dataset.key : undefined;
    return key !== undefined && indexOf(key) >= 0 ? key : null;
  };

  // La riga si legge dal nodo, non dal posto: lasciare il foglio per
  // l'elenco può concludere un testo, e con lui ridisegnare le righe.
  life.listen(list, "click", (event) => {
    const key = keyAt(event.target);
    if (key === null) return;
    list.focus({ preventScroll: true });
    // Il secondo clic di un doppio clic non ci va di nuovo: apre il nome.
    if (event.detail > 1) return;
    go(key);
  });
  life.listen(list, "dblclick", (event) => {
    const key = keyAt(event.target);
    const onName = event.target instanceof Element && event.target.closest(".draw-board-name") !== null;
    if (key !== null && onName) startRename(key);
  });
  // Il clic destro, o la pressione lunga, aprono il menu della tavola sotto
  // il puntatore; il menu che arriva sull'elenco stesso è della tastiera, e
  // va alla riga attiva.
  life.listen(list, "contextmenu", (event) => {
    // Quello che il tasto del menu manda dietro: il menu è già aperto.
    if (event.timeStamp - keyedMenu < KEYED_MENU_MS) {
      keyedMenu = -Infinity;
      event.preventDefault();
      return;
    }
    const pointed = keyAt(event.target);
    const key = pointed ?? (event.target === list && indexOf(active) >= 0 ? active : null);
    if (key === null) return;
    event.preventDefault();
    list.focus({ preventScroll: true });
    openMenu(key, pointed === null ? null : event);
  });

  life.listen(scroller, "scroll", () => render());

  // «Nuova tavola» presa col puntatore non prende il fuoco: resta all'elenco
  // o al foglio, con le loro scorciatoie.
  life.listen(addButton, "mousedown", (event) => event.preventDefault());
  life.listen(addButton, "click", () => {
    if (!editable()) return;
    if (full()) say(fullText());
    else options.onAdd();
  });

  const relabel = (): void => {
    setText(heading, t("draw.boards"));
    setText(addText, t("draw.boards.add"));
    const row = rows[indexOf(renaming)];
    if (row !== undefined) field.setAttribute("aria-label", t("draw.boards.rename", { name: row.name }));
    render();
  };
  relabel();

  /// La tavola rimasta più vicina al posto `index` delle tavole `old`, di
  /// prima: la prima dopo di lui che c'è ancora, o la prima prima.
  const nearest = (old: readonly BoardRow[], index: number): string | null => {
    for (let at = index + 1; at < old.length; at++) if (places.has(old[at]!.id)) return old[at]!.id;
    for (let at = Math.min(index, old.length) - 1; at >= 0; at--) if (places.has(old[at]!.id)) return old[at]!.id;
    return rows[0]?.id ?? null;
  };

  return {
    element,
    update(next) {
      const focused = element.contains(document.activeElement);
      const old = rows;
      const before = indexOf(active);
      view = next;
      rows = next.boards;
      places = new Map();
      rows.forEach((row, index) => {
        if (!places.has(row.id)) places.set(row.id, index);
      });
      // La tavola di adesso cambiata da fuori porta con sé la riga attiva,
      // se non si sta scrivendo un nome.
      if (next.current !== current) {
        current = next.current;
        if (renaming === null && indexOf(current) >= 0) {
          active = current;
          revealSoon = true;
        }
      }
      if (active !== null && indexOf(active) < 0) active = nearest(old, before);
      if (active === null && rows.length > 0) active = indexOf(current) >= 0 ? current : rows[0]!.id;
      // La riga attiva spostata, per esempio con Alt+↓, resta in vista.
      const after = indexOf(active);
      if (focused && before >= 0 && after >= 0 && after !== before) revealSoon = true;
      // Il campo di una tavola che se n'è andata, o di un disegno che non si
      // cambia più, si chiude senza scrivere; il menu di una tavola che se
      // n'è andata si chiude.
      if (renaming !== null && (indexOf(renaming) < 0 || !next.editable)) finishRename(false, false);
      if (menuFor !== null && indexOf(menuFor) < 0) closeContextMenu();
      render();
      if (focused && !holdsFocus()) fallback().focus({ preventScroll: true });
    },
    focus() {
      if (rows.length === 0) {
        fallback().focus({ preventScroll: true });
        return;
      }
      if (indexOf(active) < 0) active = indexOf(current) >= 0 ? current : rows[0]!.id;
      list.focus({ preventScroll: true });
      render();
      reveal();
    },
    rename: (id) => startRename(id),
    relabel,
  };
}
