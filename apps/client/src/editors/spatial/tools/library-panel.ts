// Le forme come pannello: le raccolte del catalogo (forme di base, diagrammi
// di flusso, fumetti, frecce piene, scuola), ognuna una griglia di riquadri
// con l'anteprima della forma. In cima, un campo di ricerca. Un clic, Invio o
// Spazio su una forma la inseriscono al centro della vista; tirata fuori dal
// pannello, la porta l'editor, che la mostra sul foglio dov'è il puntatore.
//
// - **Una griglia di pulsanti.** Ogni forma è un `button` col nome per
//   `aria-label` e per suggerimento; l'anteprima è per gli occhi. Un solo
//   riquadro ha `tabindex="0"`, gli altri -1: Tab entra nella griglia e ne
//   esce, le frecce passano da una forma all'altra, anche da una raccolta
//   all'altra; Home e Fine vanno alla prima e all'ultima. Dal campo, ↓ porta
//   alla prima forma; da quella, ↑ riporta al campo.
// - **La ricerca** guarda il nome e le altre parole della forma nella lingua
//   di adesso, senza badare alle maiuscole né agli accenti, e per pezzi di
//   parola: «rett» trova i rettangoli, «condizione» la decisione. Le raccolte
//   restano nel loro ordine; una raccolta senza risultati sparisce, e se non
//   ne resta nessuna una riga lo dice. Esc svuota il campo, e a campo vuoto
//   torna al foglio.
// - **Le anteprime** si costruiscono una volta, dai pezzi della forma, nel
//   loro rapporto di lati e con il colore del testo (`currentColor`): seguono
//   il tema chiaro e scuro, e i colori forzati.
// - **Il puntatore.** Premuto un riquadro e mosso oltre la soglia dei gesti
//   dell'editor, comincia un trascinamento, e il pannello lo passa all'editor
//   con l'evento. Un clic che non trascina inserisce. Niente trascinamento
//   del browser, che nell'app intercetta i file. Il mouse e la penna non
//   hanno altro. Il dito ne ha due, perché sotto i 36rem il pannello sta
//   sotto il foglio e per portarci una forma si tira in su, dove un dito
//   scorre l'elenco: mosso subito, di lato, trascina come gli altri; mosso
//   subito più in su o in giù, scorre; tenuto fermo un momento, il riquadro
//   si solleva (`data-lifted`) e da lì il primo movimento oltre la soglia, in
//   qualunque direzione, lo trascina, mentre l'elenco non scorre più. Un
//   riquadro sollevato e lasciato senza muoverlo non inserisce, e non apre
//   nessun menu: né quello del sistema, né quello che la pressione lunga di
//   `ui/long-press.ts` farebbe aprire.
// - **In sola lettura** i riquadri restano `aria-disabled` e non inseriscono:
//   dicono perché.

import { identifier, stableIdentifier } from "../../../ui/a11y";
import type { Lifetime } from "../../../ui/lifetime";
import { formatNumber } from "../number";
import { SVG_NS } from "../scene/xml";
import { plural, t, type DrawKey } from "../strings";
import { LIBRARY, LIBRARY_GROUPS, type LibraryGroup, type LibraryPiece, type LibraryShape } from "./shape-library";
import { arrowPath } from "./shapes";

/// La misura in cui sta l'anteprima di una forma, in pixel.
const PREVIEW_W = 40;
const PREVIEW_H = 32;

/// Lo spessore del contorno delle anteprime, in pixel dello schermo.
const PREVIEW_STROKE = 1.5;

/// Lo spessore con cui si disegnano le frecce delle anteprime, che ne regola
/// la punta.
const PREVIEW_ARROW = 6;

/// Quanto si tiene il dito fermo su un riquadro perché si sollevi: lo stesso
/// tempo delle righe dell'albero degli oggetti (`HOLD_MS` in `objects.ts`),
/// perché i due pannelli si trascinino allo stesso modo.
const HOLD_MS = 400;

/// Il tipo del puntatore, come lo leggono i gesti dell'editor.
export type LibraryPointer = "pen" | "mouse" | "touch";

/// Ciò che il pannello mostra.
export interface LibraryView {
  /// Falso in sola lettura: i riquadri non inseriscono.
  readonly editable: boolean;
}

export interface LibraryPanelOptions {
  /// Inserisce la forma `id` al centro della vista.
  onInsert(id: string): void;
  /// Il puntatore ha tirato il riquadro della forma `id` oltre la soglia: da
  /// qui il trascinamento è dell'editor. `event` è il movimento che ha
  /// superato la soglia.
  onDrag(id: string, event: PointerEvent): void;
  /// Esc a campo vuoto: il fuoco torna al foglio.
  onLeave(): void;
  /// Di quanti pixel si deve muovere il puntatore perché il clic diventi un
  /// trascinamento: la soglia dei gesti dell'editor.
  readonly slop: Readonly<Record<LibraryPointer, number>>;
}

export interface LibraryPanel {
  /// Il pannello: titolo, campo di ricerca e le raccolte.
  readonly element: HTMLElement;
  update(view: LibraryView): void;
  /// Il fuoco va al campo di ricerca.
  focus(): void;
  /// Riscrive i testi nella lingua di adesso.
  relabel(): void;
}

/// Un riquadro e ciò che serve a filtrarlo.
interface Tile {
  readonly shape: LibraryShape;
  readonly button: HTMLButtonElement;
}

/// Il riquadro premuto e dove, finché non si decide se è un clic o un
/// trascinamento.
interface Press {
  readonly tile: Tile;
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly kind: LibraryPointer;
}

/// Una raccolta: il titolo, la griglia e i suoi riquadri.
interface Section {
  readonly group: LibraryGroup;
  readonly element: HTMLElement;
  readonly heading: HTMLElement;
  readonly tiles: readonly Tile[];
}

/// Il titolo di ogni raccolta.
const GROUP_KEYS: Readonly<Record<LibraryGroup, DrawKey>> = {
  basic: "draw.library.group.basic",
  flowchart: "draw.library.group.flowchart",
  callouts: "draw.library.group.callouts",
  arrows: "draw.library.group.arrows",
  school: "draw.library.group.school",
};

/// Il testo senza maiuscole né segni sulle lettere: «Più» e «piu» sono uguali.
export function plain(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/[’‘]/g, "'").toLowerCase();
}

/// Vero se `shape` risponde a `tokens`, già ripuliti con [`plain`]: ogni pezzo
/// sta nel nome o nelle altre parole della forma, nella lingua di adesso.
export function matches(shape: LibraryShape, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return true;
  const words = shape.words === undefined ? "" : ` ${t(shape.words)}`;
  const haystack = plain(`${t(shape.name)}${words}`);
  return tokens.every((token) => haystack.includes(token));
}

const n = (value: number): string => formatNumber(value, 2);

/// L'elemento SVG di un pezzo per l'anteprima, o `null` se non si disegna: i
/// testi, troppo piccoli per leggersi, restano fuori.
function previewPiece(piece: LibraryPiece): SVGElement | null {
  if (piece.paint === "text") return null;
  const element = document.createElementNS(SVG_NS, piece.tag);
  for (const [name, value] of Object.entries(piece.attrs)) if (!name.includes(":")) element.setAttribute(name, value);
  if (piece.attrs["fub:shape"] === "arrow") {
    const [x1, y1, x2, y2] = (piece.attrs["fub:geom"] ?? "").split(" ").map(Number) as [number, number, number, number];
    element.setAttribute("d", arrowPath(x1, y1, x2, y2, PREVIEW_ARROW));
  }
  element.setAttribute("fill", "none");
  element.setAttribute("stroke", "currentColor");
  element.setAttribute("stroke-width", n(piece.paint === "outline" ? PREVIEW_STROKE : PREVIEW_STROKE / 2));
  element.setAttribute("stroke-linecap", "round");
  element.setAttribute("stroke-linejoin", "round");
  // Lo spessore è in pixel dello schermo, qualunque sia la misura della forma.
  element.setAttribute("vector-effect", "non-scaling-stroke");
  // Le righe del quaderno restano sullo sfondo.
  if (piece.paint === "paper") element.setAttribute("stroke-opacity", "0.55");
  return element;
}

/// L'anteprima di `shape`: i suoi pezzi, nella misura con cui s'inserisce, in
/// un riquadro di 40 × 32 pixel, centrati e nel loro rapporto di lati.
function previewOf(shape: LibraryShape): SVGSVGElement {
  const [width, height] = shape.size;
  const scale = Math.min(PREVIEW_W / width, PREVIEW_H / height);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "draw-library-preview");
  svg.setAttribute("viewBox", `0 0 ${n(width)} ${n(height)}`);
  svg.setAttribute("width", n(width * scale));
  svg.setAttribute("height", n(height * scale));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const piece of shape.build(width, height)) {
    const drawn = previewPiece(piece);
    if (drawn !== null) svg.append(drawn);
  }
  return svg;
}

/// Scrive `text` in `node`, se non c'è già.
function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function createLibraryPanel(life: Lifetime, options: LibraryPanelOptions): LibraryPanel {
  const element = document.createElement("section");
  element.className = "draw-library";
  element.id = identifier("draw-library");
  const header = document.createElement("div");
  header.className = "draw-library-header";
  const heading = document.createElement("h2");
  heading.className = "draw-library-title";
  heading.id = identifier("draw-library-title");
  const counter = document.createElement("span");
  counter.className = "draw-library-count";
  header.append(heading, counter);
  // Il campo di ricerca, col suo nome per chi non lo vede.
  const find = document.createElement("div");
  find.className = "draw-library-find";
  const label = document.createElement("label");
  label.className = "sr-only";
  const search = document.createElement("input");
  search.type = "search";
  search.className = "draw-library-search";
  search.id = identifier("draw-library-search");
  search.autocomplete = "off";
  search.spellcheck = false;
  label.htmlFor = search.id;
  find.append(label, search);
  const scroller = document.createElement("div");
  scroller.className = "draw-library-scroll";
  // Che cosa fanno i tasti, letto quando il fuoco arriva al campo.
  const hint = document.createElement("span");
  hint.className = "sr-only";
  hint.id = identifier("draw-library-hint");
  search.setAttribute("aria-describedby", hint.id);
  // La riga di quando la ricerca non trova niente.
  const none = document.createElement("p");
  none.className = "draw-library-empty";
  none.hidden = true;
  // Perché un tasto non ha fatto niente, e quante forme restano.
  const live = document.createElement("div");
  live.className = "sr-only";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  element.setAttribute("aria-labelledby", heading.id);

  const prefix = identifier("draw-library-tile");
  const sections: Section[] = LIBRARY_GROUPS.map((group) => {
    const section = document.createElement("div");
    section.className = "draw-library-group";
    const title = document.createElement("h3");
    title.className = "draw-library-heading";
    title.id = identifier("draw-library-heading");
    const grid = document.createElement("div");
    grid.className = "draw-library-grid";
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-labelledby", title.id);
    const tiles = LIBRARY.filter((shape) => shape.group === group).map((shape): Tile => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "draw-library-tile";
      button.id = stableIdentifier(prefix, shape.id);
      button.dataset.shape = shape.id;
      button.tabIndex = -1;
      button.append(previewOf(shape));
      return { shape, button };
    });
    grid.append(...tiles.map((tile) => tile.button));
    section.append(title, grid);
    return { group, element: section, heading: title, tiles };
  });
  scroller.append(...sections.map((section) => section.element), none);
  element.append(header, find, scroller, hint, live);

  const tiles: readonly Tile[] = sections.flatMap((section) => section.tiles);
  const byButton = new Map<HTMLElement, Tile>(tiles.map((tile) => [tile.button, tile]));
  let editable = true;
  let active: Tile | null = tiles[0] ?? null;
  let shown = tiles.length;

  let echo = false;
  /// Lo dice a chi ascolta: lo stesso testo due volte di fila si dice due
  /// volte.
  const say = (text: string): void => {
    echo = !echo;
    live.textContent = echo ? text : `${text} `;
  };

  const query = (): string => search.value.trim();
  const visible = (): Tile[] => tiles.filter((tile) => !tile.button.hidden);
  const countText = (count: number): string => plural(count, "draw.shapes.count.one", "draw.shapes.count.other", { count: String(count) });
  const noneText = (): string => t("draw.shapes.none", { query: query() });

  /// Il riquadro attivo, quello con `tabindex="0"`.
  const activate = (tile: Tile | null): void => {
    active = tile;
    for (const each of tiles) each.button.tabIndex = each === tile ? 0 : -1;
  };

  /// Mostra le forme che rispondono al campo, e le raccolte che ne hanno.
  const filter = (): void => {
    const tokens = plain(search.value).split(/\s+/).filter((token) => token !== "");
    shown = 0;
    for (const section of sections) {
      let inside = 0;
      for (const tile of section.tiles) {
        const found = matches(tile.shape, tokens);
        tile.button.hidden = !found;
        if (found) inside++;
      }
      section.element.hidden = inside === 0;
      shown += inside;
    }
    none.hidden = shown > 0;
    setText(none, noneText());
    setText(counter, countText(shown));
    // Il riquadro attivo che sparisce lascia il posto al primo che c'è.
    if (active === null || active.button.hidden) activate(visible()[0] ?? null);
    else activate(active);
  };

  /// Scrive il testo di ogni cosa nella lingua di adesso.
  const relabel = (): void => {
    setText(heading, t("draw.library"));
    setText(label, t("draw.shapes.search"));
    search.placeholder = t("draw.shapes.search");
    setText(hint, t(editable ? "draw.shapes.hint" : "draw.shapes.hint.read_only"));
    for (const section of sections) setText(section.heading, t(GROUP_KEYS[section.group]));
    for (const { shape, button } of tiles) {
      const name = t(shape.name);
      if (button.getAttribute("aria-label") !== name) button.setAttribute("aria-label", name);
      if (button.title !== name) button.title = name;
    }
    filter();
  };

  /// Inserisce la forma di `tile` al centro della vista, se il disegno si
  /// cambia; se no dice perché non lo fa.
  const insert = (tile: Tile): void => {
    activate(tile);
    if (!editable) {
      say(t("draw.rejected", { reason: t("draw.reason.read_only") }));
      return;
    }
    options.onInsert(tile.shape.id);
  };

  // --- La tastiera ----------------------------------------------------------------

  const tileAt = (target: EventTarget | null): Tile | null => {
    const button = target instanceof Element ? target.closest<HTMLElement>(".draw-library-tile") : null;
    return button === null ? null : (byButton.get(button) ?? null);
  };

  const goTo = (tile: Tile | undefined): void => {
    if (tile === undefined) return;
    activate(tile);
    tile.button.focus({ preventScroll: true });
    tile.button.scrollIntoView?.({ block: "nearest" });
  };

  /// Vero se il riquadro ha una posizione sullo schermo: fuori dallo schermo,
  /// e nei test, no.
  const laidOut = (tile: Tile): boolean => {
    const box = tile.button.getBoundingClientRect();
    return box.width > 0 || box.height > 0;
  };

  /// Il riquadro della riga sopra (`step` -1) o sotto (1) quella di `from`,
  /// nella griglia come si vede, il più vicino in orizzontale; `null` se non
  /// c'è. Passa da una raccolta alla successiva.
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

  /// ↑ sulla prima riga riporta al campo.
  const toSearch = (from: Tile): void => {
    activate(from);
    search.focus({ preventScroll: true });
  };

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
        if (above === null) toSearch(tile);
        else goTo(above);
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
    // L'editor non deve vedere il tasto: le frecce, qui, non spostano niente.
    event.stopPropagation();
  });
  // Spazio e Invio hanno già inserito alla pressione: il clic che alcuni
  // browser mandano al rilascio non deve inserire un'altra volta.
  life.listen(element, "keyup", (event) => {
    if ((event.key === " " || event.key === "Enter") && tileAt(event.target) !== null) event.preventDefault();
  });

  life.listen(search, "input", () => {
    filter();
    say(shown === 0 ? noneText() : countText(shown));
  });

  // --- Il puntatore -------------------------------------------------------------

  /// Il riquadro premuto, finché non si decide se è un clic o un
  /// trascinamento.
  let press: Press | null = null;
  /// Il riquadro sollevato dal dito tenuto fermo, finché il dito non si alza:
  /// l'elenco non scorre, e la pressione non è più un clic.
  let lifted: { readonly tile: Tile; readonly pointerId: number } | null = null;
  /// Il dito che ha premuto un riquadro, finché non si alza: tenuto, sollevato
  /// o già in un trascinamento, non apre nessun menu.
  let finger: number | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  life.add(() => clearTimeout(holdTimer));
  /// Vero dopo un trascinamento, o un riquadro sollevato, finché il clic che
  /// il browser manda al rilascio non è passato.
  let dragged = false;
  const kindOf = (event: PointerEvent): LibraryPointer => (event.pointerType === "pen" || event.pointerType === "touch" ? event.pointerType : "mouse");

  const stopHold = (): void => {
    clearTimeout(holdTimer);
    holdTimer = undefined;
  };

  /// Il riquadro sollevato torna al suo posto.
  const putDown = (): void => {
    stopHold();
    if (lifted === null) return;
    lifted.tile.button.removeAttribute("data-lifted");
    lifted = null;
  };

  /// Il dito è rimasto fermo: il riquadro si solleva. Il clic che seguirebbe
  /// il rilascio non inserisce.
  const lift = (pressed: Press): void => {
    holdTimer = undefined;
    if (press !== pressed || !editable) return;
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
    // Il riquadro tiene il puntatore anche fuori dal pannello: l'editor
    // riceve i movimenti fino al rilascio.
    try {
      tile.button.setPointerCapture?.(event.pointerId);
    } catch {
      // Un puntatore che non c'è più: il gesto non comincia.
    }
    // Il dito che resta fermo solleva il riquadro: da lì si trascina in ogni
    // direzione, anche in su, dove prima scorreva l'elenco.
    if (pressed.kind === "touch" && editable) holdTimer = setTimeout(() => lift(pressed), HOLD_MS);
  });
  life.listen(scroller, "pointermove", (event) => {
    if (press === null || event.pointerId !== press.pointerId) return;
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    if (Math.hypot(dx, dy) <= options.slop[press.kind]) return;
    const { tile, kind } = press;
    press = null;
    stopHold();
    // Il dito che si muove prima del tempo, più in su o in giù che di lato,
    // scorre l'elenco: il gesto non è più del pannello. Se il riquadro è già
    // sollevato, ogni direzione lo trascina.
    if (kind === "touch" && lifted === null && Math.abs(dy) > Math.abs(dx)) return;
    // In sola lettura il riquadro non si trascina: il clic dirà perché.
    if (!editable) return;
    dragged = true;
    activate(tile);
    options.onDrag(tile.shape.id, event);
  });
  for (const type of ["pointerup", "pointercancel"] as const) {
    life.listen(scroller, type, (event) => {
      if (press !== null && event.pointerId === press.pointerId) {
        press = null;
        stopHold();
      }
      if (lifted !== null && event.pointerId === lifted.pointerId) putDown();
      if (event.pointerId === finger) finger = null;
      // Un puntatore annullato non manda nessun clic dopo di sé.
      if (type === "pointercancel") dragged = false;
    });
  }
  // Col riquadro sollevato l'elenco non scorre: un `touchmove` annullato prima
  // che lo scorrimento cominci lo ferma, come per le righe dell'albero degli
  // oggetti. L'ascoltatore non è passivo, perché possa annullare.
  life.listen(
    scroller,
    "touchmove",
    (event) => {
      if (lifted !== null && event.cancelable) event.preventDefault();
    },
    { passive: false },
  );
  // La pressione lunga di un dito non apre nessun menu: né quello che il
  // sistema manda da sé, né quello che il ponte di `ui/long-press.ts` fa
  // nascere dopo mezzo secondo, anche a un trascinamento cominciato di poco e
  // poi fermo. Dopo di lei non arriva nessun clic.
  life.listen(scroller, "contextmenu", (event) => {
    if (finger === null) return;
    event.preventDefault();
    event.stopPropagation();
    dragged = false;
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
      if (next.editable === editable) return;
      editable = next.editable;
      for (const { button } of tiles) {
        if (editable) button.removeAttribute("aria-disabled");
        else button.setAttribute("aria-disabled", "true");
      }
      setText(hint, t(editable ? "draw.shapes.hint" : "draw.shapes.hint.read_only"));
    },
    focus() {
      search.focus({ preventScroll: true });
    },
    relabel,
  };
}
