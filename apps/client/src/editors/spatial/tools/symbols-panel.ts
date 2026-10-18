// I simboli come pannello: quelli del disegno, poi una sezione per ogni
// libreria del vault, ognuna una griglia di riquadri con l'anteprima e il
// nome. In cima, un campo di ricerca. Un clic, Invio o Spazio su un simbolo
// ne mette un'istanza al centro della vista; tirato fuori dal pannello, lo
// porta l'editor, che lo mostra sul foglio dov'è il puntatore. Il clic
// destro, Maiusc+F10 o il tasto del menu aprono i comandi del simbolo.
//
// - **Una griglia di pulsanti,** come le forme (`library-panel.ts`): un solo
//   riquadro ha `tabindex="0"`, le frecce passano da un simbolo all'altro,
//   anche da una sezione all'altra; Home e Fine vanno al primo e
//   all'ultimo. Dal campo, ↓ porta al primo simbolo; da lì, ↑ riporta al
//   campo. Il nome del pulsante dice il simbolo e il suo stato a parole:
//   «Presa, 3 istanze, la libreria ne ha una versione nuova».
// - **Mai il solo colore.** Un simbolo del disegno ha sotto l'anteprima il
//   numero delle sue istanze; uno che la sua libreria ha cambiato ha il
//   segno dell'aggiornamento; uno di una libreria che il disegno ha già ha
//   il segno di spunta.
// - **La ricerca** guarda il nome del simbolo e quello della libreria, senza
//   badare alle maiuscole né agli accenti, e per pezzi di parola. Esc svuota
//   il campo, e a campo vuoto torna al foglio.
// - **Le anteprime** le fa l'editor, quando un riquadro sta per vedersi: un
//   simbolo che non si vede non costa niente.
// - **Una sezione dice com'è:** una libreria che si sta leggendo, troppo
//   grande, che non è un disegno, che non si legge o che non ha simboli lo
//   dice al posto della griglia; sotto le sezioni, una riga dice dove si
//   cercano le librerie, o che la cartella non c'è.
// - **Il puntatore** fa come nelle forme: premuto e mosso oltre la soglia
//   dei gesti dell'editor, il riquadro passa all'editor un trascinamento; il
//   dito tenuto fermo lo solleva. In sola lettura i riquadri restano
//   `aria-disabled` e non inseriscono: dicono perché.

import { identifier, stableIdentifier } from "../../../ui/a11y";
import type { Lifetime } from "../../../ui/lifetime";
import { t } from "../strings";
import { plain, type LibraryPointer } from "./library-panel";

/// Quanto si tiene il dito fermo su un riquadro perché si sollevi: come nelle
/// forme.
const HOLD_MS = 400;

/// Dopo il menu aperto dalla tastiera, per tanti millisecondi il clic destro
/// che il tasto del menu manda dietro non ne apre un altro.
const KEYED_MENU_MS = 1000;

/// Un simbolo del pannello: del disegno, o della libreria `path`.
export type SymbolRef = { readonly kind: "drawing"; readonly id: string } | { readonly kind: "library"; readonly path: string; readonly id: string };

/// La chiave di `ref`, unica nel pannello.
export function refKey(ref: SymbolRef): string {
  return ref.kind === "drawing" ? `d:${ref.id}` : `l:${ref.path}#${ref.id}`;
}

/// Un riquadro: un simbolo, come il pannello lo mostra.
export interface SymbolTile {
  readonly ref: SymbolRef;
  /// Il nome da mostrare: il suo, o «Simbolo senza nome».
  readonly name: string;
  /// Cambia quando cambia ciò che il simbolo disegna: l'anteprima si rifà.
  readonly version: string;
  /// Le istanze nel disegno: per i simboli del disegno.
  readonly uses?: number;
  /// La libreria ne ha una versione diversa da quella che il disegno ha
  /// copiato.
  readonly stale?: boolean;
  /// Un simbolo di una libreria che il disegno ha già.
  readonly present?: boolean;
}

/// Una sezione: il disegno, o una libreria.
export interface SymbolSection {
  /// `drawing`, o il percorso della libreria.
  readonly key: string;
  readonly title: string;
  readonly tiles: readonly SymbolTile[];
  /// Ciò che la sezione dice al posto della griglia, o sotto il titolo:
  /// che si sta leggendo, perché non si mostra, che è vuota.
  readonly note: string | null;
}

/// Ciò che il pannello mostra.
export interface SymbolsView {
  /// Falso in sola lettura: i riquadri non inseriscono.
  readonly editable: boolean;
  readonly sections: readonly SymbolSection[];
  /// La riga in fondo: dove si cercano le librerie.
  readonly footer: string;
}

export interface SymbolsPanelOptions {
  /// Mette un'istanza di `ref` al centro della vista.
  onInsert(ref: SymbolRef): void;
  /// Il puntatore ha tirato il riquadro di `ref` oltre la soglia: da qui il
  /// trascinamento è dell'editor.
  onDrag(ref: SymbolRef, event: PointerEvent): void;
  /// Apre il menu di `ref`: nel punto del gesto, o sotto il riquadro.
  onMenu(ref: SymbolRef, at: MouseEvent | HTMLElement, labelledBy: string): void;
  /// L'anteprima di `ref`, un URL, o `null` se non si fa. Si chiede quando il
  /// riquadro sta per vedersi, e di nuovo quando cambia la sua versione.
  picture(ref: SymbolRef, version: string): Promise<string | null>;
  /// Esc a campo vuoto: il fuoco torna al foglio.
  onLeave(): void;
  /// La soglia dei gesti dell'editor.
  readonly slop: Readonly<Record<LibraryPointer, number>>;
}

export interface SymbolsPanel {
  readonly element: HTMLElement;
  update(view: SymbolsView): void;
  /// Il fuoco va al campo di ricerca.
  focus(): void;
  /// Il fuoco va al riquadro di `ref`, se c'è.
  focusTile(ref: SymbolRef): boolean;
  /// Riscrive i testi nella lingua di adesso.
  relabel(): void;
}

/// Un riquadro disegnato.
interface Tile {
  data: SymbolTile;
  /// La sezione, per la ricerca.
  section: string;
  readonly button: HTMLButtonElement;
  readonly image: HTMLImageElement;
  readonly caption: HTMLElement;
  readonly badge: HTMLElement;
  /// La versione la cui anteprima si è chiesta.
  asked: string | null;
}

/// Una sezione disegnata.
interface Section {
  readonly key: string;
  readonly element: HTMLElement;
  readonly heading: HTMLElement;
  readonly note: HTMLElement;
  readonly grid: HTMLElement;
  tiles: Tile[];
}

/// Il riquadro premuto, finché non si decide se è un clic o un
/// trascinamento.
interface Press {
  readonly tile: Tile;
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly kind: LibraryPointer;
}

/// Ciò che il nome di un riquadro dice dopo il nome del simbolo.
function stateOf(tile: SymbolTile): string[] {
  const out: string[] = [];
  if (tile.uses !== undefined) out.push(tile.uses === 0 ? t("draw.symbols.instances.zero") : t(tile.uses === 1 ? "draw.symbols.instances.one" : "draw.symbols.instances.other", { count: tile.uses }));
  // Di un simbolo del disegno, la libreria ha la versione nuova; di uno
  // della libreria, è il disegno ad avere quella di prima.
  if (tile.ref.kind === "library") {
    if (tile.present === true) out.push(t(tile.stale === true ? "draw.symbols.present.stale" : "draw.symbols.present"));
  } else if (tile.stale === true) out.push(t("draw.symbols.stale"));
  return out;
}

/// Scrive `text` in `node`, se non c'è già.
function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function createSymbolsPanel(life: Lifetime, options: SymbolsPanelOptions): SymbolsPanel {
  const element = document.createElement("section");
  element.className = "draw-symbols";
  element.id = identifier("draw-symbols");
  const header = document.createElement("div");
  header.className = "draw-symbols-header";
  const heading = document.createElement("h2");
  heading.className = "draw-symbols-title";
  heading.id = identifier("draw-symbols-title");
  const counter = document.createElement("span");
  counter.className = "draw-symbols-count";
  header.append(heading, counter);
  const find = document.createElement("div");
  find.className = "draw-symbols-find";
  const label = document.createElement("label");
  label.className = "sr-only";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "draw-symbols-search";
  search.id = identifier("draw-symbols-search");
  search.autocomplete = "off";
  search.spellcheck = false;
  label.htmlFor = search.id;
  find.append(label, search);
  const scroller = document.createElement("div");
  scroller.className = "draw-symbols-scroll";
  const hint = document.createElement("span");
  hint.className = "sr-only";
  hint.id = identifier("draw-symbols-hint");
  search.setAttribute("aria-describedby", hint.id);
  const none = document.createElement("p");
  none.className = "draw-symbols-empty";
  none.hidden = true;
  const footer = document.createElement("p");
  footer.className = "draw-symbols-footer";
  const live = document.createElement("div");
  live.className = "sr-only";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  element.setAttribute("aria-labelledby", heading.id);
  scroller.append(none, footer);
  element.append(header, find, scroller, hint, live);

  const prefix = identifier("draw-symbols-tile");
  let sections: Section[] = [];
  let tiles: Tile[] = [];
  const byButton = new Map<HTMLElement, Tile>();
  const byKey = new Map<string, Tile>();
  let view: SymbolsView = { editable: true, sections: [], footer: "" };
  let active: Tile | null = null;
  let shown = 0;

  let echo = false;
  const say = (text: string): void => {
    echo = !echo;
    live.textContent = echo ? text : `${text} `;
  };

  // --- Le anteprime ------------------------------------------------------------

  /// Chiede l'anteprima di `tile`, se la sua versione non l'ha già.
  const paint = (tile: Tile): void => {
    const { ref, version } = tile.data;
    if (tile.asked === version) return;
    tile.asked = version;
    void options.picture(ref, version).then(
      (url) => {
        if (tile.asked !== version || !byButton.has(tile.button)) return;
        if (url === null) {
          tile.image.hidden = true;
          tile.image.removeAttribute("src");
          tile.button.dataset.picture = "none";
        } else {
          tile.image.src = url;
          tile.image.hidden = false;
          delete tile.button.dataset.picture;
        }
      },
      () => undefined,
    );
  };
  // Senza chi guarda, le anteprime si chiedono subito.
  let observer: IntersectionObserver | null = null;
  if (typeof IntersectionObserver === "function") {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const tile = byButton.get(entry.target as HTMLElement);
          if (tile !== undefined) paint(tile);
        }
      },
      { root: scroller, rootMargin: "200px 0px" },
    );
    life.add(() => observer?.disconnect());
  }

  // --- I riquadri --------------------------------------------------------------

  const makeTile = (data: SymbolTile, section: string): Tile => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "draw-symbols-tile";
    button.id = stableIdentifier(prefix, refKey(data.ref));
    button.tabIndex = -1;
    const frame = document.createElement("span");
    frame.className = "draw-symbols-frame";
    const image = document.createElement("img");
    image.className = "draw-symbols-preview";
    image.alt = "";
    image.hidden = true;
    image.draggable = false;
    image.decoding = "async";
    frame.append(image);
    const caption = document.createElement("span");
    caption.className = "draw-symbols-name";
    caption.setAttribute("aria-hidden", "true");
    const badge = document.createElement("span");
    badge.className = "draw-symbols-badge";
    badge.setAttribute("aria-hidden", "true");
    button.append(frame, caption, badge);
    const tile: Tile = { data, section, button, image, caption, badge, asked: null };
    return tile;
  };

  /// Scrive in `tile` il nome, lo stato e le sue parole.
  const dress = (tile: Tile): void => {
    const { data, button } = tile;
    setText(tile.caption, data.name);
    const state = stateOf(data);
    const name = [data.name, ...state].join(", ");
    if (button.getAttribute("aria-label") !== name) button.setAttribute("aria-label", name);
    if (button.title !== name) button.title = name;
    // Il numero delle istanze, o il segno: mai il solo colore.
    const mark = data.stale === true ? "↻" : data.present === true ? "✓" : data.uses !== undefined ? String(data.uses) : "";
    setText(tile.badge, mark);
    tile.badge.hidden = mark === "";
    button.toggleAttribute("data-stale", data.stale === true);
    button.toggleAttribute("data-present", data.present === true);
    if (view.editable) button.removeAttribute("aria-disabled");
    else button.setAttribute("aria-disabled", "true");
  };

  const makeSection = (key: string): Section => {
    const element = document.createElement("div");
    element.className = "draw-symbols-group";
    const title = document.createElement("h3");
    title.className = "draw-symbols-heading";
    title.id = identifier("draw-symbols-heading");
    const note = document.createElement("p");
    note.className = "draw-symbols-note";
    const grid = document.createElement("div");
    grid.className = "draw-symbols-grid";
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-labelledby", title.id);
    element.append(title, note, grid);
    return { key, element, heading: title, note, grid, tiles: [] };
  };

  /// Rifà le sezioni e i riquadri da `view`, tenendo quelli che c'erano: il
  /// fuoco e le anteprime restano.
  const render = (): void => {
    const oldSections = new Map(sections.map((section) => [section.key, section]));
    const oldTiles = new Map(byKey);
    byKey.clear();
    byButton.clear();
    const next: Section[] = [];
    for (const data of view.sections) {
      const section = oldSections.get(data.key) ?? makeSection(data.key);
      oldSections.delete(data.key);
      setText(section.heading, data.title);
      setText(section.note, data.note ?? "");
      section.note.hidden = data.note === null;
      section.tiles = data.tiles.map((each) => {
        const key = refKey(each.ref);
        const tile = oldTiles.get(key) ?? makeTile(each, data.key);
        oldTiles.delete(key);
        tile.data = each;
        tile.section = data.title;
        byKey.set(key, tile);
        byButton.set(tile.button, tile);
        dress(tile);
        return tile;
      });
      // I riquadri nell'ordine di adesso, senza toccare quelli che ci sono
      // già al loro posto.
      section.tiles.forEach((tile, i) => {
        if (section.grid.children[i] !== tile.button) section.grid.insertBefore(tile.button, section.grid.children[i] ?? null);
      });
      while (section.grid.children.length > section.tiles.length) section.grid.lastElementChild!.remove();
      section.grid.hidden = section.tiles.length === 0;
      next.push(section);
    }
    for (const gone of oldTiles.values()) observer?.unobserve(gone.button);
    for (const gone of oldSections.values()) gone.element.remove();
    next.forEach((section, i) => {
      if (scroller.children[i] !== section.element) scroller.insertBefore(section.element, scroller.children[i] ?? none);
    });
    sections = next;
    tiles = sections.flatMap((section) => section.tiles);
    for (const tile of tiles) {
      if (observer === null) paint(tile);
      else {
        observer.observe(tile.button);
        // Un riquadro già visto con una versione nuova si rifà subito.
        if (tile.asked !== null && tile.asked !== tile.data.version) paint(tile);
      }
    }
    setText(footer, view.footer);
    footer.hidden = view.footer === "";
    filter();
  };

  const query = (): string => search.value.trim();
  const visible = (): Tile[] => tiles.filter((tile) => !tile.button.hidden);
  const countText = (count: number): string => t(count === 1 ? "draw.symbols.count.one" : "draw.symbols.count.other", { count: String(count) });
  const noneText = (): string => t("draw.symbols.none", { query: query() });

  const activate = (tile: Tile | null): void => {
    active = tile;
    for (const each of tiles) each.button.tabIndex = each === tile ? 0 : -1;
  };

  /// Mostra i simboli che rispondono al campo, e le sezioni che ne hanno.
  /// Una sezione senza simboli, che dice com'è, resta finché il campo è
  /// vuoto.
  const filter = (): void => {
    const tokens = plain(search.value).split(/\s+/).filter((token) => token !== "");
    shown = 0;
    for (const section of sections) {
      let inside = 0;
      for (const tile of section.tiles) {
        const haystack = plain(`${tile.data.name} ${tile.section}`);
        const found = tokens.every((token) => haystack.includes(token));
        tile.button.hidden = !found;
        if (found) inside++;
      }
      section.element.hidden = tokens.length > 0 && inside === 0;
      shown += inside;
    }
    none.hidden = tokens.length === 0 || shown > 0;
    setText(none, noneText());
    setText(counter, countText(shown));
    if (active === null || active.button.hidden || !byButton.has(active.button)) activate(visible()[0] ?? null);
    else activate(active);
  };

  const relabel = (): void => {
    setText(heading, t("draw.symbols.title"));
    setText(label, t("draw.symbols.search"));
    search.placeholder = t("draw.symbols.search");
    setText(hint, t(view.editable ? "draw.symbols.hint" : "draw.symbols.hint.read_only"));
    for (const tile of tiles) dress(tile);
    filter();
  };

  const insert = (tile: Tile): void => {
    activate(tile);
    if (!view.editable) {
      say(t("draw.rejected", { reason: t("draw.reason.read_only") }));
      return;
    }
    options.onInsert(tile.data.ref);
  };

  const openMenu = (tile: Tile, at: MouseEvent | null): void => {
    activate(tile);
    options.onMenu(tile.data.ref, at ?? tile.button, tile.button.id);
  };

  // --- La tastiera ----------------------------------------------------------------

  const tileAt = (target: EventTarget | null): Tile | null => {
    const button = target instanceof Element ? target.closest<HTMLElement>(".draw-symbols-tile") : null;
    return button === null ? null : (byButton.get(button) ?? null);
  };

  const goTo = (tile: Tile | undefined): void => {
    if (tile === undefined) return;
    activate(tile);
    tile.button.focus({ preventScroll: true });
    tile.button.scrollIntoView?.({ block: "nearest" });
  };

  const laidOut = (tile: Tile): boolean => {
    const box = tile.button.getBoundingClientRect();
    return box.width > 0 || box.height > 0;
  };

  /// Il riquadro della riga sopra (`step` -1) o sotto (1), il più vicino in
  /// orizzontale; `null` se non c'è.
  const vertical = (from: Tile, step: 1 | -1): Tile | null => {
    const here = from.button.getBoundingClientRect();
    let best: Tile | null = null;
    let bestRow = Infinity;
    let bestColumn = Infinity;
    for (const tile of visible()) {
      const box = tile.button.getBoundingClientRect();
      const row = (box.top - here.top) * step;
      if (row < here.height / 2) continue;
      const column = Math.abs(box.left - here.left);
      if (row < bestRow - 1 || (Math.abs(row - bestRow) <= 1 && column < bestColumn)) {
        best = tile;
        bestRow = row;
        bestColumn = column;
      }
    }
    return best;
  };

  let keyedMenu = -Infinity;

  life.listen(element, "keydown", (event) => {
    if (event.defaultPrevented) return;
    const key = event.key;
    if (event.target === search) {
      if (key === "ArrowDown") goTo(active?.button.hidden === false ? active : visible()[0]);
      else if (key === "Escape") {
        if (search.value === "") options.onLeave();
        else {
          search.value = "";
          filter();
          say(countText(shown));
        }
      } else return;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const tile = tileAt(event.target);
    if (tile === null) {
      if (key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        options.onLeave();
      }
      return;
    }
    if (key === "ContextMenu" || (key === "F10" && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey)) {
      keyedMenu = event.timeStamp;
      openMenu(tile, null);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const list = visible();
    const at = list.indexOf(tile);
    switch (key) {
      case "ArrowRight":
        goTo(list[Math.min(list.length - 1, at + 1)]);
        break;
      case "ArrowLeft":
        goTo(list[Math.max(0, at - 1)]);
        break;
      case "ArrowDown":
        goTo(laidOut(tile) ? (vertical(tile, 1) ?? undefined) : list[Math.min(list.length - 1, at + 1)]);
        break;
      case "ArrowUp": {
        const above = laidOut(tile) ? vertical(tile, -1) : (list[at - 1] ?? null);
        if (above === null) {
          activate(tile);
          search.focus({ preventScroll: true });
        } else goTo(above);
        break;
      }
      case "Home":
        goTo(list[0]);
        break;
      case "End":
        goTo(list[list.length - 1]);
        break;
      case "Enter":
      case " ":
        insert(tile);
        break;
      case "Escape":
        options.onLeave();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  });
  life.listen(element, "keyup", (event) => {
    if ((event.key === " " || event.key === "Enter") && tileAt(event.target) !== null) event.preventDefault();
  });

  life.listen(search, "input", () => {
    filter();
    say(shown === 0 && query() !== "" ? noneText() : countText(shown));
  });

  // --- Il puntatore -------------------------------------------------------------

  let press: Press | null = null;
  let lifted: { readonly tile: Tile; readonly pointerId: number } | null = null;
  let finger: number | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  life.add(() => clearTimeout(holdTimer));
  let dragged = false;
  const kindOf = (event: PointerEvent): LibraryPointer => (event.pointerType === "pen" || event.pointerType === "touch" ? event.pointerType : "mouse");

  const stopHold = (): void => {
    clearTimeout(holdTimer);
    holdTimer = undefined;
  };

  const putDown = (): void => {
    stopHold();
    if (lifted === null) return;
    lifted.tile.button.removeAttribute("data-lifted");
    lifted = null;
  };

  const lift = (pressed: Press): void => {
    holdTimer = undefined;
    if (press !== pressed || !view.editable) return;
    lifted = { tile: pressed.tile, pointerId: pressed.pointerId };
    pressed.tile.button.dataset.lifted = "";
    dragged = true;
  };

  life.listen(scroller, "pointerdown", (event) => {
    dragged = false;
    press = null;
    finger = null;
    putDown();
    const tile = tileAt(event.target);
    if (tile === null || !event.isPrimary || event.button !== 0) return;
    const pressed: Press = { tile, pointerId: event.pointerId, x: event.clientX, y: event.clientY, kind: kindOf(event) };
    press = pressed;
    if (pressed.kind === "touch") finger = pressed.pointerId;
    try {
      tile.button.setPointerCapture?.(event.pointerId);
    } catch {
      // Un puntatore che non c'è più: il gesto non comincia.
    }
    if (pressed.kind === "touch" && view.editable) holdTimer = setTimeout(() => lift(pressed), HOLD_MS);
  });
  life.listen(scroller, "pointermove", (event) => {
    if (press === null || event.pointerId !== press.pointerId) return;
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    if (Math.hypot(dx, dy) <= options.slop[press.kind]) return;
    const { tile, kind } = press;
    press = null;
    stopHold();
    if (kind === "touch" && lifted === null && Math.abs(dy) > Math.abs(dx)) return;
    if (!view.editable) return;
    dragged = true;
    activate(tile);
    options.onDrag(tile.data.ref, event);
  });
  for (const type of ["pointerup", "pointercancel"] as const) {
    life.listen(scroller, type, (event) => {
      if (press !== null && event.pointerId === press.pointerId) {
        press = null;
        stopHold();
      }
      if (lifted !== null && event.pointerId === lifted.pointerId) putDown();
      if (event.pointerId === finger) finger = null;
      if (type === "pointercancel") dragged = false;
    });
  }
  life.listen(
    scroller,
    "touchmove",
    (event) => {
      if (lifted !== null && event.cancelable) event.preventDefault();
    },
    { passive: false },
  );
  // Il clic destro apre il menu del simbolo; la pressione lunga di un dito
  // no, come nelle forme: il dito la usa per sollevare il riquadro. Il menu
  // del dito è Maiusc+F10 o il tasto del menu, o il clic destro di un mouse.
  life.listen(scroller, "contextmenu", (event) => {
    const tile = tileAt(event.target);
    if (tile === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (finger !== null) {
      dragged = false;
      return;
    }
    if (event.timeStamp - keyedMenu < KEYED_MENU_MS) return;
    openMenu(tile, event);
  });
  life.listen(scroller, "click", (event) => {
    const tile = tileAt(event.target);
    if (tile === null) return;
    if (dragged) {
      dragged = false;
      return;
    }
    insert(tile);
  });

  relabel();

  return {
    element,
    update(next) {
      const editableChanged = next.editable !== view.editable;
      view = next;
      render();
      if (editableChanged) setText(hint, t(view.editable ? "draw.symbols.hint" : "draw.symbols.hint.read_only"));
    },
    focus() {
      search.focus({ preventScroll: true });
    },
    focusTile(ref) {
      const tile = byKey.get(refKey(ref));
      if (tile === undefined || tile.button.hidden) return false;
      goTo(tile);
      return true;
    },
    relabel,
  };
}
