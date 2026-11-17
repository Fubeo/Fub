// Il pannello del «/»: una colonna sola, larga 352 px. In alto le sei tessere
// dei blocchi più usati, sotto le righe a gruppi con la sintassi a destra (i
// titoli dei gruppi restano in cima mentre si scorre), in fondo il disegno del
// blocco scelto. Scrivendo, un elenco solo e in fondo «Cerca fra tutti i
// comandi». Una voce che apre un passo lo apre nello stesso riquadro
// (`pickers/`).
//
// La superficie lo posa accanto al cursore (`markdown/slash.ts`) e gli passa
// ciò che si scrive e i tasti; il fuoco resta nell'editor, e la voce attiva
// si dice con `aria-activedescendant`. I tasti li mostra la riga dei
// suggerimenti della banda (il contesto `slash` di `markdown/hints.ts`), non
// il pannello. Il pannello non conosce CodeMirror.
//
// Tessere e righe sono i pezzi del kit (`kit/tile.ts`, `kit/row.ts`,
// `kit/group-label.ts`), gli stessi del menu e dello spazio comandi.
import type {
  SlashMenuEntry,
  SlashPanel,
  SlashPanelEvents,
  SlashPlace,
  SlashSection,
} from "../../editors/core/editor-menu";
import { t, type Key } from "../../i18n/strings";
import { createGroupLabel, createRow, createTile, iconButton, markLit } from "../../kit";
import { enter, exitGhost, stagger } from "../../moto";
import { identifier } from "../../ui/a11y";
import { displayBinding } from "../../ui/commands";
import { openLifetime } from "../../ui/lifetime";
import { registerFormatIcons } from "../format-bar";
import { COLOR_ENTRY, type SlashResults } from "./entries";
import { openStep, type SlashStep, type StepDeps } from "./pickers";
import { descriptionOf, syntaxOf, thumbOf } from "./preview";

/// Ciò che il pannello chiede alla shell.
export interface SlashPanelDeps extends StepDeps {
  /// Le voci per ciò che si è scritto, dove si scrive.
  entries(query: string, place: SlashPlace): SlashResults;
  /// La voce è fra i preferiti (che vanno per primi fra le tessere).
  favorite(id: string): boolean;
  /// Mette o toglie la voce dai preferiti; torna il nuovo stato.
  toggleFavorite(id: string): boolean;
  /// Toglie la voce dal menu (`editor.slash.hidden`): da quel momento
  /// `entries` non la dà più. Resta un comando.
  hide?(entry: SlashMenuEntry): void;
}

/// Sotto questa, o con un dito, il pannello è un foglio dal basso, largo
/// quanto la finestra.
export const SHEET_PX = 600;
/// L'uscita, entro i 140 ms del banco del moto.
export const CLOSE_MS = 110;
/// Quanto resta sopra la riga scelta quando l'elenco scorre fin lì: il titolo
/// del gruppo, che sta in cima (px).
const SCROLL_TOP_MARGIN = 30;
const SCROLL_BOTTOM_MARGIN = 4;

const SECTION_KEYS: Readonly<Record<SlashSection, Key>> = {
  text: "slash_menu.section.text",
  lists: "slash_menu.section.lists",
  blocks: "slash_menu.section.blocks",
  code: "slash_menu.section.code",
  media: "slash_menu.section.media",
  people: "slash_menu.section.people",
  style: "slash_menu.section.style",
  page: "slash_menu.section.page",
  vault: "slash_menu.section.vault",
};

/// Il nome di un gruppo, nella lingua dell'interfaccia.
export function sectionLabel(section: SlashSection): string {
  return t(SECTION_KEYS[section]);
}

/// I nomi brevi delle tessere: sotto un quadrato da 40 sta una parola.
const TILE_KEYS: Readonly<Record<string, Key>> = {
  "markdown.paragraph": "slash.tile.paragraph",
  "markdown.quote": "slash.tile.quote",
  "markdown.list.bullet": "slash.tile.bullet",
  "markdown.list.ordered": "slash.tile.ordered",
  "markdown.list.task": "slash.tile.task",
  "markdown.callout": "slash.tile.callout",
  "markdown.details": "slash.tile.details",
  "markdown.columns": "slash.tile.columns",
  "markdown.table": "slash.tile.table",
  "markdown.rule": "slash.tile.rule",
  "markdown.codeblock": "slash.tile.code",
  "markdown.mathblock": "slash.tile.math",
  "markdown.diagram": "slash.tile.diagram",
  "markdown.image": "slash.tile.image",
  "markdown.embed": "slash.tile.embed",
  "markdown.wikilink": "slash.tile.link",
  "markdown.link": "slash.tile.link",
  "markdown.mention": "slash.tile.person",
  "markdown.date": "slash.tile.date",
  "markdown.linkcard": "slash.tile.web",
  "markdown.toc": "slash.tile.toc",
};

/// Il nome breve di una tessera: il Titolo 2 è «Titolo», gli altri livelli
/// col numero; una voce senza nome breve tiene il suo.
export function tileLabel(entry: SlashMenuEntry): string {
  const heading = /^markdown\.heading\.([1-6])$/.exec(entry.id);
  if (heading) return heading[1] === "2" ? t("slash.tile.heading2") : t("slash.tile.heading", { level: heading[1]! });
  const key = TILE_KEYS[entry.id];
  return key ? t(key) : entry.label;
}

/// La finestra è stretta, o la si tocca col dito.
function sheetWanted(): boolean {
  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  return coarse || window.innerWidth <= SHEET_PX;
}

/// Il nome di una voce con la parte trovata in evidenza.
function labelWithSpan(target: HTMLElement, entry: SlashMenuEntry): void {
  const [from, to] = entry.span ?? [0, 0];
  if (to <= from) {
    target.textContent = entry.label;
    return;
  }
  const mark = document.createElement("mark");
  mark.className = "slash-found";
  mark.textContent = entry.label.slice(from, to);
  target.replaceChildren(entry.label.slice(0, from), mark, entry.label.slice(to));
}

/// Una scelta del pannello: una tessera, una riga, o «Cerca fra tutti i
/// comandi».
interface Item {
  readonly element: HTMLElement;
  readonly entry: SlashMenuEntry | null;
  readonly tile: boolean;
}

export function createSlashPanel(events: SlashPanelEvents, deps: SlashPanelDeps): SlashPanel {
  const life = openLifetime();
  life.add(registerFormatIcons());
  const transform = events.transform;
  const dom = document.createElement("div");
  dom.className = "slash-panel";
  if (transform) dom.classList.add("is-transform");
  // I gesti nel pannello non portano via il fuoco dall'editor.
  life.listen(dom, "mousedown", (event) => event.preventDefault());

  // La testata c'è soltanto dove ciò che si scrive non si vede nel testo:
  // «Trasforma» (si scrive nel pannello) e i passi (il percorso).
  const head = document.createElement("div");
  head.className = "slash-head";
  const crumb = document.createElement("span");
  crumb.className = "slash-crumb";
  const context = document.createElement("span");
  context.className = "slash-context";
  const count = document.createElement("span");
  count.className = "slash-count";
  head.append(crumb, context, count);
  // Il conto per chi ascolta, sempre: si legge anche senza testata.
  const status = document.createElement("span");
  status.className = "sr-only";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  // Le scelte, per chi ascolta un elenco solo: le tessere e le righe.
  const choices = document.createElement("div");
  choices.className = "slash-choices";
  choices.id = identifier("slash-list");
  choices.setAttribute("role", "listbox");
  choices.setAttribute("aria-label", t(transform ? "slash.panel.transform" : "slash.panel.label"));
  const top = document.createElement("div");
  top.className = "slash-top";
  top.setAttribute("role", "group");
  top.setAttribute("aria-label", t("slash.panel.top"));
  const list = document.createElement("div");
  list.className = "slash-list";
  // Il dito lo fa scorrere il pannello, non il browser (vedi sotto).
  list.style.touchAction = "none";
  choices.append(top, list);

  const detail = document.createElement("div");
  detail.className = "slash-detail";
  const thumb = document.createElement("span");
  thumb.className = "slash-thumb";
  thumb.setAttribute("aria-hidden", "true");
  const detailText = document.createElement("span");
  detailText.className = "slash-detail-text";
  const description = document.createElement("span");
  description.className = "slash-description";
  description.id = identifier("slash-description");
  const syntax = document.createElement("span");
  syntax.className = "slash-syntax";
  detailText.append(description, syntax);
  const tools = document.createElement("span");
  tools.className = "slash-tools";
  detail.append(thumb, detailText, tools);

  const body = document.createElement("div");
  body.className = "slash-body";
  body.append(choices, detail);
  dom.append(head, body, status);
  head.hidden = !transform;

  let query = "";
  let place: SlashPlace = { line: "empty", above: null, inList: false };
  let results: SlashResults = { top: [], entries: [], sections: [], filtering: false };
  let items: Item[] = [];
  /// Quante delle scelte sono tessere: stanno in testa a `items`.
  let tiles = 0;
  let selected = 0;
  let step: SlashStep | null = null;
  let shown = false;
  /// L'altezza del corpo all'ultima misura dell'editor (`placed`).
  let bodyHeight = -1;
  /// Dove CodeMirror ha messo il pannello: lo toglie prima di chiuderlo, e
  /// l'uscita parte da lì, con le righe ancora in corsa.
  let home: HTMLElement | null = null;

  const option = (element: HTMLElement, index: number): void => {
    element.id = identifier("slash-option");
    element.tabIndex = -1;
    element.setAttribute("role", "option");
    element.setAttribute("aria-selected", "false");
    element.dataset["index"] = String(index);
  };

  /// La testata di «Trasforma»: ciò che si è scritto e quante righe.
  const drawHead = (): void => {
    if (step || !transform) return;
    crumb.textContent = query === "" ? t("slash.panel.transform") : `${t("slash.panel.transform")} · ${query}`;
    context.textContent = t(transform.lines === 1 ? "slash.panel.place.one" : "slash.panel.place.many", { count: transform.lines });
    count.textContent = "";
  };

  const drawStatus = (): void => {
    const n = results.entries.length;
    status.textContent = !results.filtering
      ? t("slash.panel.all", { count: n })
      : n === 0 ? t("slash.panel.zero") : n === 1 ? t("slash.panel.one") : t("slash.panel.count", { count: n });
  };

  /// Le tessere e le righe, coi gruppi a menu appena aperto.
  const draw = (): void => {
    items = [];
    top.replaceChildren();
    list.replaceChildren();
    const quick = transform ? [] : results.top;
    top.hidden = quick.length === 0;
    for (const entry of quick) {
      const tile = createTile({ label: tileLabel(entry), shape: "stack", className: "slash-tile", ...(entry.icon ? { icon: entry.icon } : {}) });
      option(tile, items.length);
      // Il nome breve si vede; chi ascolta sente quello intero.
      tile.setAttribute("aria-label", entry.label);
      tile.setAttribute("aria-describedby", description.id);
      top.append(tile);
      items.push({ element: tile, entry, tile: true });
    }
    tiles = items.length;
    dom.classList.toggle("is-filtering", results.filtering);
    const nothing = results.entries.length === 0;
    if (nothing && results.filtering) {
      const none = document.createElement("div");
      none.className = "slash-none";
      none.textContent = t("slash.panel.none", { query });
      list.append(none);
    } else if (nothing) {
      const none = document.createElement("div");
      none.className = "slash-none";
      none.textContent = t("slash.panel.nothing");
      list.append(none);
    }
    let group: HTMLElement | null = null;
    let last: SlashSection | null = null;
    for (const entry of results.entries) {
      if (!results.filtering && entry.section !== last) {
        group = document.createElement("div");
        group.className = "slash-group";
        group.setAttribute("role", "group");
        group.append(createGroupLabel({ text: sectionLabel(entry.section), sticky: true, labels: group, className: "slash-group-label" }));
        list.append(group);
        last = entry.section;
      }
      const note = entry.hint ?? undefined;
      const row = createRow({ label: entry.label, icon: entry.icon, holdIcon: true, className: "slash-row", parts: { note: "slash-syntax-note" }, ...(note ? { note } : {}) });
      labelWithSpan(row.label, entry);
      // Un colore trovato scrivendo («/blu») si vede nel suo colore.
      const swatch = /^markdown\.(color|background)\.([a-z]+)$/.exec(entry.id);
      if (swatch && row.icon) {
        row.icon.replaceChildren(swatch[1] === "color" ? "A" : "");
        row.icon.classList.add("slash-swatch");
        row.icon.dataset[swatch[1] === "color" ? "color" : "fill"] = swatch[2]!;
      }
      if (entry.quick) row.element.classList.add("is-quick");
      option(row.element, items.length);
      row.element.setAttribute("aria-describedby", description.id);
      (group ?? list).append(row.element);
      items.push({ element: row.element, entry, tile: false });
    }
    // Scrivendo, l'ultima scelta cerca fra tutti i comandi; senza risultati
    // è l'unica, ed è accesa.
    if (results.filtering && !transform) {
      const all = createRow({ label: t("context.search.all", { query }), icon: "search", keys: displayBinding("Mod-/"), className: "slash-row slash-all" });
      option(all.element, items.length);
      list.append(all.element);
      items.push({ element: all.element, entry: null, tile: false });
    }
    // Un elenco senza scelte non è un listbox: il messaggio si legge com'è.
    if (items.length === 0) choices.removeAttribute("role");
    else choices.setAttribute("role", "listbox");
  };

  const entryAt = (index: number): SlashMenuEntry | null => items[index]?.entry ?? null;

  /// Il disegno della voce scelta, in fondo; niente per «Cerca fra tutti i
  /// comandi».
  const drawDetail = (): void => {
    const entry = entryAt(selected);
    detail.hidden = entry === null;
    tools.replaceChildren();
    detail.classList.remove("has-tools");
    if (!entry) {
      thumb.replaceChildren();
      description.replaceChildren();
      syntax.replaceChildren();
      return;
    }
    thumb.replaceChildren(thumbOf(entry));
    description.replaceChildren(...descriptionOf(entry.description));
    syntax.replaceChildren(...syntaxOf(entry, transform));
    syntax.hidden = syntax.childNodes.length === 0;
    if (entry.id === COLOR_ENTRY || entry.quick) return;
    const favored = deps.favorite(entry.id);
    const star = iconButton({
      icon: "fmt-star",
      label: t(favored ? "slash.panel.unfavorite" : "slash.panel.favorite"),
      pressed: favored,
      onPress: () => {
        deps.toggleFavorite(entry.id);
        drawDetail();
      },
    });
    star.tabIndex = -1;
    tools.append(star);
    detail.classList.add("has-tools");
    if (deps.hide) {
      const hide = iconButton({
        icon: "fmt-hide",
        label: t("slash.panel.hide"),
        onPress: () => {
          const at = selected;
          deps.hide?.(entry);
          if (life.closed) return;
          refresh();
          if (items.length) select(Math.min(at, items.length - 1));
        },
      });
      hide.tabIndex = -1;
      tools.append(hide);
    }
  };

  /// La riga scelta resta in vista sotto il titolo del suo gruppo, senza far
  /// scorrere niente fuori dall'elenco; una tessera riporta l'elenco in cima.
  const keepInView = (item: Item): void => {
    if (item.tile) {
      list.scrollTop = 0;
      return;
    }
    const row = item.element;
    const margin = results.filtering ? SCROLL_BOTTOM_MARGIN : SCROLL_TOP_MARGIN;
    if (row.offsetTop - margin < list.scrollTop) list.scrollTop = Math.max(0, row.offsetTop - margin);
    else if (row.offsetTop + row.offsetHeight + SCROLL_BOTTOM_MARGIN > list.scrollTop + list.clientHeight) {
      list.scrollTop = row.offsetTop + row.offsetHeight + SCROLL_BOTTOM_MARGIN - list.clientHeight;
    }
  };

  /// Sceglie la voce `index`: accesa, attiva per il lettore di schermo, in
  /// vista, col suo disegno in fondo.
  function select(index: number, scroll = true): void {
    const previous = items[selected];
    if (previous) {
      markLit(previous.element, false);
      previous.element.setAttribute("aria-selected", "false");
    }
    if (items.length === 0) {
      selected = 0;
      events.active(null);
      drawDetail();
      return;
    }
    selected = Math.max(0, Math.min(items.length - 1, index));
    const item = items[selected]!;
    markLit(item.element, true);
    item.element.setAttribute("aria-selected", "true");
    events.active(item.element.id);
    if (scroll) keepInView(item);
    drawDetail();
  }

  /// Rifà le scelte per ciò che si è scritto; la prima è accesa.
  const refresh = (): void => {
    results = deps.entries(query, place);
    if (transform) {
      // «Trasforma»: soltanto ciò che cambia le righe scelte, e i comandi.
      const entries = results.entries.filter((entry) => !entry.action || transform.after(entry.id) !== null);
      results = { ...results, top: [], entries, sections: results.sections.filter((section) => entries.some((entry) => entry.section === section)) };
    }
    drawHead();
    drawStatus();
    draw();
    selected = 0;
    list.scrollTop = 0;
    select(0, false);
  };

  // Le scelte si accendono passandoci sopra e si eseguono col clic. Un
  // movimento fermo (lo scorrimento sotto il puntatore) non cambia la scelta.
  let pointer: { x: number; y: number } | null = null;
  life.listen(choices, "mousemove", (event) => {
    if (pointer && Math.abs(pointer.x - event.clientX) < 2 && Math.abs(pointer.y - event.clientY) < 2) return;
    pointer = { x: event.clientX, y: event.clientY };
    const hit = (event.target as Element).closest<HTMLElement>("[data-index]");
    if (hit && Number(hit.dataset["index"]) !== selected) select(Number(hit.dataset["index"]), false);
  });
  // L'elenco non scorre da sé (`overflow: hidden`): il fuoco resta
  // nell'editor e le frecce lo fanno scorrere con la scelta, e un
  // contenitore che scorre senza niente di raggiungibile sarebbe una tappa del
  // Tab per Chromium e un errore per axe. La rotella e il dito lo spostano qui.
  life.listen(list, "wheel", (event) => {
    event.preventDefault();
    list.scrollTop += event.deltaMode === 1 ? event.deltaY * 40 : event.deltaY;
  }, { passive: false });
  let drag: { id: number; y: number; top: number; moved: boolean } | null = null;
  // Un trascinamento non è un tocco: il clic che lo chiude non sceglie.
  let dragged = false;
  life.listen(list, "pointerdown", (event) => {
    dragged = false;
    if (event.pointerType !== "mouse") drag = { id: event.pointerId, y: event.clientY, top: list.scrollTop, moved: false };
  });
  life.listen(list, "pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dy = event.clientY - drag.y;
    if (Math.abs(dy) > 8) drag.moved = true;
    if (drag.moved) list.scrollTop = drag.top - dy;
  });
  life.listen(list, "pointerup", (event) => {
    if (drag?.moved && event.pointerId === drag.id) dragged = true;
    drag = null;
  });
  life.listen(list, "pointercancel", () => void (drag = null));
  life.listen(choices, "click", (event) => {
    const hit = (event.target as Element).closest<HTMLElement>("[data-index]");
    if (!hit || dragged) return;
    select(Number(hit.dataset["index"]), false);
    choose(false);
  });

  /// Entra nel passo di una voce che ne ha uno.
  const enterStep = (entry: SlashMenuEntry): void => {
    const opened = openStep(entry, deps, {
      done: (choice) => events.choose({ entry: choice.entry ?? entry, params: choice.params, below: false }),
      changed: () => drawStepHead(),
    });
    if (!opened) return;
    step = opened;
    dom.classList.add("is-step");
    head.hidden = false;
    crumb.textContent = `${entry.label} ›`;
    context.textContent = "";
    drawStepHead();
    body.replaceChildren(opened.dom);
    // La scelta del passo in vista, ora che il passo ha le sue misure.
    keepStepChoiceInView();
    enter(opened.dom, { from: { x: 14, opacity: 0 }, spring: "snap", whenReduced: "fade", lifetime: life });
  };

  function drawStepHead(): void {
    if (!step) return;
    count.textContent = step.hint();
    status.textContent = step.hint();
    events.active(step.active());
    keepStepChoiceInView();
  }

  /// Il passo, come l'elenco, non scorre da sé (`overflow: hidden`): il fuoco
  /// resta nell'editor e la scelta, mossa dalle frecce, resta in vista
  /// facendolo scorrere qui. Un contenitore che scorre senza niente di
  /// raggiungibile sarebbe una tappa del Tab per Chromium e un errore per axe.
  function keepStepChoiceInView(): void {
    if (!step || !step.dom.isConnected) return;
    const id = step.active();
    const choice = id ? document.getElementById(id) : null;
    if (!choice || !step.dom.contains(choice)) return;
    const box = step.dom.getBoundingClientRect();
    const at = choice.getBoundingClientRect();
    if (at.top < box.top) step.dom.scrollTop -= box.top - at.top + 8;
    else if (at.bottom > box.bottom) step.dom.scrollTop += at.bottom - box.bottom + 8;
  }

  // La rotella e il dito fanno scorrere il passo, come l'elenco; un
  // trascinamento non è un tocco, e il clic che lo chiude non sceglie.
  let stepDrag: { id: number; y: number; top: number; moved: boolean } | null = null;
  let stepDragged = false;
  life.listen(body, "wheel", (event) => {
    if (!step) return;
    event.preventDefault();
    step.dom.scrollTop += event.deltaMode === 1 ? event.deltaY * 40 : event.deltaY;
  }, { passive: false });
  life.listen(body, "pointerdown", (event) => {
    if (!step) return;
    stepDragged = false;
    if (event.pointerType !== "mouse") stepDrag = { id: event.pointerId, y: event.clientY, top: step.dom.scrollTop, moved: false };
  });
  life.listen(body, "pointermove", (event) => {
    if (!step || !stepDrag || event.pointerId !== stepDrag.id) return;
    const dy = event.clientY - stepDrag.y;
    if (Math.abs(dy) > 8) stepDrag.moved = true;
    if (stepDrag.moved) step.dom.scrollTop = stepDrag.top - dy;
  });
  life.listen(body, "pointerup", (event) => {
    if (stepDrag?.moved && event.pointerId === stepDrag.id) stepDragged = true;
    stepDrag = null;
  });
  life.listen(body, "pointercancel", () => void (stepDrag = null));
  life.listen(body, "click", (event) => {
    if (!step || !stepDragged) return;
    stepDragged = false;
    event.stopPropagation();
  }, { capture: true });

  const leaveStep = (): void => {
    if (!step) return;
    // Il passo esce di lato da dove lo si vede, anche a metà dell'entrata;
    // l'immagine resta nel pannello, che ne porta la pelle.
    exitGhost(step.dom, { to: { x: 14, opacity: 0 }, duration: CLOSE_MS, layer: dom });
    step.dispose();
    step = null;
    dom.classList.remove("is-step");
    head.hidden = !transform;
    body.replaceChildren(choices, detail);
    refresh();
    enter(body, { from: { x: -14, opacity: 0 }, spring: "snap", whenReduced: "fade", lifetime: life });
  };

  /// Cerca fra tutti i comandi, con ciò che si è scritto.
  const toPalette = (): void => {
    events.dismiss();
    events.palette(query);
  };

  function choose(below: boolean): void {
    const item = items[selected];
    if (!item?.entry) {
      // Niente trovato, o «Cerca fra tutti i comandi».
      toPalette();
      return;
    }
    const entry = item.entry;
    if (entry.picker) {
      enterStep(entry);
      return;
    }
    events.choose({ entry, params: entry.params, below });
  }

  /// Dove comincia ogni tappa del Tab: le tessere, poi il primo di ogni
  /// gruppo.
  const groupStarts = (): number[] => {
    const starts = tiles > 0 ? [0] : [];
    for (let index = tiles; index < items.length; index++) {
      const entry = items[index]!.entry;
      if (index === tiles || entry?.section !== items[index - 1]!.entry?.section) starts.push(index);
    }
    return starts;
  };

  /// Salta al gruppo dopo (o prima) di quello della voce scelta.
  const jumpGroup = (direction: 1 | -1): void => {
    const starts = groupStarts();
    if (starts.length === 0) return;
    const here = starts.filter((index) => index <= selected).length - 1;
    select(starts[(here + direction + starts.length) % starts.length]!);
  };

  /// ↓ e ↑ dalle tessere scendono nelle righe e ci risalgono; fra le righe
  /// girano in tondo.
  const step1 = (direction: 1 | -1): number => {
    const n = items.length;
    if (direction === 1) return selected < tiles ? (tiles < n ? tiles : 0) : (selected + 1) % n;
    if (selected < tiles) return n - 1;
    if (selected === tiles && tiles > 0) return 0;
    return (selected - 1 + n) % n;
  };

  const printable = (event: KeyboardEvent): boolean =>
    event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;

  return {
    dom,
    listId: choices.id,
    update(text, where) {
      if (life.closed) return;
      if (!transform) query = text;
      place = where;
      if (step) leaveStep();
      else refresh();
    },
    key(event) {
      if (life.closed) return false;
      if ((event.ctrlKey || event.metaKey) && event.key === "/") {
        toPalette();
        return true;
      }
      if (step) {
        if (event.key === "Escape" || (event.key === "Backspace" && !step.typing())) {
          leaveStep();
          return true;
        }
        return step.key(event);
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      const n = items.length;
      switch (event.key) {
        case "ArrowDown":
          if (n) select(step1(1));
          return true;
        case "ArrowUp":
          if (n) select(step1(-1));
          return true;
        case "ArrowRight":
        case "ArrowLeft":
          // Fra le tessere le frecce di lato scorrono la fila; altrove il
          // cursore si muove nel testo.
          if (selected >= tiles) return false;
          select((selected + (event.key === "ArrowRight" ? 1 : tiles - 1)) % tiles);
          return true;
        case "PageDown":
          if (n) select(Math.max(selected, tiles) + 8);
          return true;
        case "PageUp":
          if (n) select(Math.max(tiles, selected - 8));
          return true;
        case "Tab":
          if (results.filtering) select(event.shiftKey ? selected - 1 : selected + 1);
          else jumpGroup(event.shiftKey ? -1 : 1);
          return true;
        case "Enter":
          choose(event.shiftKey && !transform);
          return true;
        case "Escape":
          events.dismiss();
          return true;
      }
      // «Trasforma» non ha un «/» nel testo: ciò che si scrive cerca qui.
      if (transform) {
        if (event.key === "Backspace") {
          query = query.slice(0, -1);
          refresh();
          return true;
        }
        if (printable(event)) {
          query += event.key;
          refresh();
          return true;
        }
      }
      return false;
    },
    placed(above, caretX) {
      if (life.closed) return;
      home = dom.parentElement;
      // L'editor può accorciare il pannello dopo che la scelta è già scesa
      // (tasti battuti subito dopo il «/»): se il corpo ha cambiato altezza,
      // la scelta accesa, nell'elenco o nel passo, torna in vista. Solo
      // allora, perché una misura per lo scorrere della nota non riporti
      // indietro chi ha girato la rotella.
      if (body.clientHeight !== bodyHeight) {
        bodyHeight = body.clientHeight;
        const item = items[selected];
        if (step) keepStepChoiceInView();
        else if (item) keepInView(item);
      }
      // Il foglio sta in fondo alla finestra: CodeMirror riscrive `top` e
      // `left` a ogni misura, quindi li si rimette ogni volta.
      if (dom.classList.contains("is-sheet")) pinSheet(dom);
      if (shown) return;
      shown = true;
      const sheet = sheetWanted();
      dom.classList.toggle("is-sheet", sheet);
      if (sheet) pinSheet(dom);
      dom.style.transformOrigin = sheet ? "50% 100%" : `${Math.round(caretX)}px ${above ? "100%" : "0"}`;
      enter(dom, {
        from: sheet ? { y: 24, opacity: 0 } : { scale: 0.96, y: above ? 6 : -6, opacity: 0 },
        spring: "snap",
        whenReduced: "fade",
        lifetime: life,
      });
      stagger(items.slice(0, 8).map((item) => item.element), (element) => enter(element, { from: { y: 6, opacity: 0 }, spring: "soft", lifetime: life }));
    },
    close() {
      if (life.closed) return;
      // Se CodeMirror l'ha già tolto, il pannello torna un istante dov'era,
      // con le corse ancora vive, il tempo di lasciare la sua immagine.
      const back = !dom.isConnected && home?.isConnected === true && shown;
      if (back) home!.append(dom);
      // L'immagine sta accanto al pannello, fra i tooltip dell'editor: ne
      // eredita carattere e interlinea, e le righe restano dove sono.
      if (dom.isConnected) exitGhost(dom, { to: { opacity: 0, scale: 0.98 }, duration: CLOSE_MS, layer: dom.parentElement ?? undefined });
      if (back) dom.remove();
      step?.dispose();
      life.close();
    },
  };
}

/// Il foglio, in fondo alla finestra e largo quanto lei.
function pinSheet(dom: HTMLElement): void {
  dom.style.setProperty("position", "fixed");
  dom.style.setProperty("left", "0");
  dom.style.setProperty("right", "0");
  dom.style.setProperty("top", "auto");
  dom.style.setProperty("bottom", "0");
}
