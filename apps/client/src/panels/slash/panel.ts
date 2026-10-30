// Il pannello del «/»: la testata con ciò che si è scritto, le linguette
// delle sezioni, l'elenco con la pillola che scivola fra le righe,
// l'anteprima a destra e il piede coi tasti. Una voce con «›» apre il suo
// passo nello stesso riquadro (`pickers/`).
//
// La superficie lo posa accanto al cursore (`markdown/slash.ts`) e gli passa
// ciò che si scrive e i tasti; il fuoco resta nell'editor, e la riga attiva si
// dice con `aria-activedescendant`. Il pannello non conosce CodeMirror.
//
// Il movimento passa da `moto`: l'entrata dal cursore (snap), le prime otto
// righe sfalsate, la pillola che segue la scelta (snap), l'anteprima che
// arriva da 4 px (soft), i passi che scorrono di lato, l'uscita in 110 ms.
import type {
  SlashMenuEntry,
  SlashPanel,
  SlashPanelEvents,
  SlashPlace,
  SlashSection,
} from "../../editors/core/editor-menu";
import { t, type Key } from "../../i18n/strings";
import { iconButton } from "../../kit";
import { animate, enter, exitGhost, flip, stagger } from "../../moto";
import { identifier } from "../../ui/a11y";
import { iconEl } from "../../ui/icons";
import { openLifetime } from "../../ui/lifetime";
import { registerFormatIcons } from "../format-bar";
import { COLOR_ENTRY, type SlashResults } from "./entries";
import { openStep, type SlashStep, type StepDeps } from "./pickers";
import { previewOf } from "./preview";

/// Ciò che il pannello chiede alla shell.
export interface SlashPanelDeps extends StepDeps {
  /// Le voci per ciò che si è scritto, dove si scrive.
  entries(query: string, place: SlashPlace): SlashResults;
  /// La voce è fra i preferiti.
  favorite(id: string): boolean;
  /// Mette o toglie la voce dai preferiti; torna il nuovo stato.
  toggleFavorite(id: string): boolean;
  /// Toglie la voce dal menu (`editor.slash.hidden`): da quel momento
  /// `entries` non la dà più. Resta un comando.
  hide?(entry: SlashMenuEntry): void;
}

/// Quanto aspetta l'anteprima dopo l'ultima freccia (ms): chi scorre veloce
/// non la ridisegna a ogni riga.
export const PREVIEW_DELAY_MS = 40;
/// Sotto questo spazio, dal bordo sinistro dell'editor al bordo destro della
/// finestra, resta soltanto l'elenco: la finestra non scende sotto gli 800 px,
/// ma il riquadro può stare a destra di una barra o di un altro riquadro.
export const NARROW_PX = 760;
/// Sotto questa, o con un dito, il pannello è un foglio dal basso.
export const SHEET_PX = 600;
/// L'uscita, entro i 140 ms del banco del moto.
export const CLOSE_MS = 110;

const SECTION_KEYS: Readonly<Record<SlashSection, Key>> = {
  suggested: "slash_menu.section.suggested",
  favorites: "slash_menu.section.favorites",
  recent: "slash_menu.section.recent",
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

/// Il nome di una sezione, nella lingua dell'interfaccia.
export function sectionLabel(section: SlashSection): string {
  return t(SECTION_KEYS[section]);
}

/// La finestra è stretta, o la si tocca col dito.
function sheetWanted(): boolean {
  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  return coarse || window.innerWidth <= SHEET_PX;
}

/// Un tasto disegnato come un tasto.
function keycap(text: string): HTMLElement {
  const kbd = document.createElement("kbd");
  kbd.textContent = text;
  return kbd;
}

/// Un pezzo del piede: i tasti e che cosa fanno.
function footKey(keys: readonly string[], what: string): HTMLElement {
  const span = document.createElement("span");
  for (const key of keys) span.append(keycap(key));
  span.append(` ${what}`);
  return span;
}

/// Il nome di una voce con la parte trovata in evidenza.
function labelWithSpan(entry: SlashMenuEntry): DocumentFragment {
  const out = document.createDocumentFragment();
  const [from, to] = entry.span ?? [0, 0];
  if (to <= from) {
    out.append(entry.label);
    return out;
  }
  const mark = document.createElement("mark");
  mark.textContent = entry.label.slice(from, to);
  out.append(entry.label.slice(0, from), mark, entry.label.slice(to));
  return out;
}

/// Il campione di un colore: la «A» del testo, o il fondo.
function swatchOf(entry: SlashMenuEntry): { kind: "text" | "fill"; name: string } | null {
  const match = /^markdown\.(color|background)\.([a-z]+)$/.exec(entry.id);
  return match ? { kind: match[1] === "color" ? "text" : "fill", name: match[2]! } : null;
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

  const head = document.createElement("div");
  head.className = "slash-head";
  const typed = document.createElement("span");
  typed.className = "slash-query";
  const context = document.createElement("span");
  context.className = "slash-context";
  const count = document.createElement("span");
  count.className = "slash-count";
  count.setAttribute("role", "status");
  count.setAttribute("aria-live", "polite");
  head.append(typed, context, count);

  const tabs = document.createElement("div");
  tabs.className = "slash-tabs";
  tabs.setAttribute("role", "group");
  tabs.setAttribute("aria-label", t("slash.panel.sections"));
  // Le linguette non scorrono a mano: segue la scelta (Tab, frecce), e un
  // contenitore che scorre senza niente di raggiungibile sarebbe una tappa
  // del Tab per Chromium e un errore per axe.

  const body = document.createElement("div");
  body.className = "slash-body";
  const list = document.createElement("div");
  list.className = "slash-list";
  list.id = identifier("slash-list");
  list.setAttribute("role", "listbox");
  // Il fuoco resta nell'editor (`aria-activedescendant`): l'elenco che scorre
  // non è una tappa del Tab.
  list.tabIndex = -1;
  // Il dito lo fa scorrere il pannello, non il browser (vedi sotto).
  list.style.touchAction = "none";
  list.setAttribute("aria-label", t(transform ? "slash.panel.transform" : "slash.panel.label"));
  const pill = document.createElement("div");
  pill.className = "slash-pill";
  pill.setAttribute("aria-hidden", "true");

  const preview = document.createElement("div");
  preview.className = "slash-preview";
  const previewHead = document.createElement("div");
  previewHead.className = "slash-preview-head";
  const previewTitle = document.createElement("span");
  previewTitle.className = "slash-preview-title";
  const stage = document.createElement("div");
  stage.className = "slash-stage";
  // L'anteprima è decorativa; la descrizione si legge.
  stage.setAttribute("aria-hidden", "true");
  const description = document.createElement("div");
  description.className = "slash-description";
  description.id = identifier("slash-description");
  const tip = document.createElement("div");
  tip.className = "slash-tip";
  previewHead.append(previewTitle);
  preview.append(previewHead, stage, description, tip);
  body.append(list, preview);

  const foot = document.createElement("div");
  foot.className = "slash-foot";
  const listFoot = (): void => {
    foot.replaceChildren(
      footKey(["↑", "↓"], t("slash.panel.keys.move")),
      footKey(["↵"], t("slash.panel.keys.enter")),
      footKey(["⇥"], t("slash.panel.keys.tab")),
      ...(transform ? [] : [footKey(["⇧", "↵"], t("slash.panel.keys.below"))]),
      footKey(["Esc"], t(transform ? "slash.panel.keys.close" : "slash.panel.keys.escape")),
      footKey(["Ctrl", "/"], t("slash.panel.keys.all")),
    );
  };
  listFoot();
  dom.append(head, tabs, body, foot);

  let query = "";
  let place: SlashPlace = { line: "empty", above: null, inList: false };
  let results: SlashResults = { entries: [], sections: [], filtering: false };
  let rows: HTMLElement[] = [];
  let selected = 0;
  let pillTop: number | null = null;
  let previewTimer: number | undefined;
  let step: SlashStep | null = null;
  let shown = false;
  /// Dove il pannello sta adesso: l'uscita parte da lì anche quando l'editor
  /// lo ha già tolto dal documento.
  /// Dove CodeMirror ha messo il pannello: lo toglie prima di chiuderlo, e
  /// l'uscita parte da lì, con le righe ancora in corsa.
  let home: HTMLElement | null = null;
  life.add(() => window.clearTimeout(previewTimer));

  const entryAt = (index: number): SlashMenuEntry | null => results.entries[index] ?? null;

  /// La testata: ciò che si è scritto (o il percorso del passo), il posto e
  /// il conto.
  const drawHead = (): void => {
    if (step) return;
    typed.replaceChildren();
    if (transform) {
      typed.className = "slash-crumb";
      typed.textContent = query === "" ? t("slash.panel.transform") : `${t("slash.panel.transform")} · ${query}`;
      context.textContent = t(transform.lines === 1 ? "slash.panel.place.one" : "slash.panel.place.many", { count: transform.lines });
    } else {
      typed.className = "slash-query";
      const written = document.createElement("b");
      written.textContent = query;
      typed.append("/", written);
      context.textContent = t(place.line === "empty" ? "slash.panel.place.empty" : "slash.panel.place.after");
    }
    const n = results.entries.length;
    count.textContent = !results.filtering
      ? t("slash.panel.all", { count: n })
      : n === 0 ? t("slash.panel.zero") : n === 1 ? t("slash.panel.one") : t("slash.panel.count", { count: n });
  };

  const drawTabs = (): void => {
    tabs.hidden = results.filtering || step !== null;
    tabs.replaceChildren(...results.sections.map((section) => {
      const button = document.createElement("button");
      button.type = "button";
      button.tabIndex = -1;
      button.dataset["section"] = section;
      button.textContent = sectionLabel(section);
      button.addEventListener("click", () => {
        const index = results.entries.findIndex((each) => each.section === section);
        if (index >= 0) select(index, true);
      });
      return button;
    }));
  };

  /// Le righe, coi gruppi delle sezioni a menu appena aperto.
  const drawList = (): void => {
    list.replaceChildren(pill);
    rows = [];
    dom.classList.toggle("is-empty", results.entries.length === 0);
    // Un elenco senza opzioni non è un listbox: il messaggio si legge com'è.
    if (results.entries.length === 0) list.removeAttribute("role");
    else list.setAttribute("role", "listbox");
    if (results.entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "slash-empty";
      const title = document.createElement("b");
      title.textContent = t("slash.panel.none", { query });
      const hint = document.createElement("span");
      hint.textContent = t("slash.panel.none.hint");
      empty.append(title, hint);
      list.append(empty);
      return;
    }
    let group: HTMLElement | null = null;
    let last: string | null = null;
    results.entries.forEach((entry, index) => {
      const name = entry.quick ? t("slash.panel.quick") : results.filtering ? (index === (results.entries[0]!.quick ? 1 : 0) ? t("slash.panel.results") : null) : sectionLabel(entry.section);
      if (name !== null && name !== last) {
        group = document.createElement("div");
        group.className = "slash-group";
        group.setAttribute("role", "group");
        const label = document.createElement("div");
        label.className = "slash-section";
        label.id = identifier("slash-section");
        label.textContent = name;
        group.setAttribute("aria-labelledby", label.id);
        group.append(label);
        list.append(group);
        last = name;
      }
      const row = document.createElement("div");
      row.className = "slash-row";
      if (entry.quick) row.classList.add("is-quick");
      row.id = identifier("slash-option");
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", "false");
      row.setAttribute("aria-describedby", description.id);
      row.dataset["index"] = String(index);
      const box = document.createElement("span");
      box.className = "slash-icon";
      box.setAttribute("aria-hidden", "true");
      const swatch = swatchOf(entry);
      if (swatch) {
        box.dataset["swatch"] = swatch.kind;
        box.dataset["color"] = swatch.name;
        if (swatch.kind === "text") box.textContent = "A";
      } else {
        const figure = entry.icon ? iconEl(entry.icon) : null;
        if (figure) box.append(figure);
      }
      const text = document.createElement("span");
      text.className = "slash-text";
      const label = document.createElement("b");
      label.append(labelWithSpan(entry));
      text.append(label);
      if (entry.why) {
        const why = document.createElement("span");
        why.textContent = t(entry.why === "forse" ? "slash.panel.maybe" : "slash.panel.initials");
        text.append(why);
      }
      row.append(box, text);
      if (entry.picker) {
        const more = document.createElement("span");
        more.className = "slash-more";
        more.setAttribute("aria-hidden", "true");
        more.textContent = "›";
        row.append(more);
      } else if (entry.hint) {
        const hint = document.createElement("span");
        hint.className = "slash-hint";
        hint.textContent = entry.hint;
        row.append(hint);
      }
      (group ?? list).append(row);
      rows.push(row);
    });
  };

  /// Posa la pillola sulla riga scelta: scivola da dov'era.
  const placePill = (slide: boolean): void => {
    const row = rows[selected];
    if (!row) {
      pill.hidden = true;
      return;
    }
    pill.hidden = false;
    const top = row.offsetTop;
    const move = (): void => {
      pill.style.top = `${top}px`;
      pill.style.height = `${row.offsetHeight}px`;
    };
    // Una pillola ancora in volo riparte da dove la si vede.
    if (slide && pillTop !== null && pillTop !== top) flip([pill], move, { spring: "snap", scale: false, lifetime: life });
    else move();
    pillTop = top;
  };

  const drawPreview = (): void => {
    const entry = entryAt(selected);
    stage.replaceChildren();
    previewHead.querySelector(".slash-preview-tools")?.remove();
    if (!entry) {
      previewTitle.textContent = "";
      description.textContent = "";
      tip.textContent = "";
      return;
    }
    previewTitle.textContent = `${t(entry.quick ? "slash.panel.quick" : "slash.panel.preview")} · ${entry.label}`;
    const shown = previewOf(entry, { outline: events.outline, transform, today: deps.today() });
    stage.append(shown.stage);
    description.textContent = entry.description;
    tip.replaceChildren(...shown.tip);
    if (entry.id !== COLOR_ENTRY && !entry.quick) {
      const favored = deps.favorite(entry.id);
      const star = iconButton({
        icon: "fmt-star",
        label: t(favored ? "slash.panel.unfavorite" : "slash.panel.favorite"),
        pressed: favored,
        onPress: () => {
          deps.toggleFavorite(entry.id);
          drawPreview();
        },
      });
      star.tabIndex = -1;
      const tools = document.createElement("span");
      tools.className = "slash-preview-tools";
      tools.append(star);
      if (deps.hide) {
        const hide = iconButton({
          icon: "fmt-hide",
          label: t("slash.panel.hide"),
          onPress: () => {
            const at = selected;
            deps.hide?.(entry);
            if (life.closed) return;
            refresh(false);
            if (results.entries.length) select(Math.min(at, results.entries.length - 1), true, true);
          },
        });
        hide.tabIndex = -1;
        tools.append(hide);
      }
      previewHead.append(tools);
    }
  };

  const schedulePreview = (now: boolean): void => {
    window.clearTimeout(previewTimer);
    if (now) {
      drawPreview();
      return;
    }
    previewTimer = window.setTimeout(() => {
      if (life.closed) return;
      drawPreview();
      animate(stage, { from: { y: 4, opacity: 0.2 }, spring: "soft", whenReduced: "fade", lifetime: life });
    }, PREVIEW_DELAY_MS);
  };

  /// Sceglie la riga `index`: pillola, attivo per il lettore di schermo,
  /// linguetta accesa, anteprima.
  function select(index: number, jump = false, now = false): void {
    if (rows.length === 0) {
      selected = 0;
      events.active(null);
      placePill(false);
      schedulePreview(true);
      return;
    }
    const previous = rows[selected];
    selected = Math.max(0, Math.min(rows.length - 1, index));
    const row = rows[selected]!;
    if (previous && previous !== row) previous.setAttribute("aria-selected", "false");
    previous?.classList.remove("is-selected");
    row.classList.add("is-selected");
    row.setAttribute("aria-selected", "true");
    events.active(row.id);
    placePill(!jump);
    // La riga resta in vista, senza far scorrere niente fuori dall'elenco.
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop - 30;
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight + 8;
    }
    const section = entryAt(selected)?.section;
    for (const tab of tabs.querySelectorAll<HTMLElement>("button")) {
      const current = tab.dataset["section"] === section;
      tab.classList.toggle("is-current", current);
      if (current && (tab.offsetLeft < tabs.scrollLeft || tab.offsetLeft + tab.offsetWidth > tabs.scrollLeft + tabs.clientWidth)) {
        tabs.scrollLeft = Math.max(0, tab.offsetLeft - 16);
      }
    }
    schedulePreview(now);
  }

  /// Rifà l'elenco per ciò che si è scritto.
  const refresh = (first: boolean): void => {
    results = deps.entries(query, place);
    if (transform) {
      // «Trasforma»: soltanto ciò che cambia le righe scelte, e i comandi.
      results = { ...results, entries: results.entries.filter((entry) => !entry.action || transform.after(entry.id) !== null) };
      results = { ...results, sections: results.filtering ? [] : results.sections.filter((section) => results.entries.some((entry) => entry.section === section)) };
    }
    drawHead();
    drawTabs();
    drawList();
    pillTop = null;
    selected = 0;
    select(0, true, first);
  };

  // Le righe si scelgono passandoci sopra e si eseguono col clic. Un
  // movimento fermo (lo scorrimento sotto il puntatore) non cambia la scelta.
  let pointer: { x: number; y: number } | null = null;
  life.listen(list, "mousemove", (event) => {
    if (pointer && Math.abs(pointer.x - event.clientX) < 2 && Math.abs(pointer.y - event.clientY) < 2) return;
    pointer = { x: event.clientX, y: event.clientY };
    const row = (event.target as Element).closest<HTMLElement>(".slash-row");
    if (row && Number(row.dataset["index"]) !== selected) select(Number(row.dataset["index"]));
  });
  // L'elenco non è un contenitore che scorre da sé (`overflow: hidden`): il
  // fuoco resta nell'editor e le frecce lo fanno scorrere con la scelta, e un
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
  life.listen(list, "click", (event) => {
    const row = (event.target as Element).closest<HTMLElement>(".slash-row");
    if (!row || dragged) return;
    select(Number(row.dataset["index"]), true, true);
    choose(false);
  });

  /// Entra nel passo di una voce con «›».
  const enterStep = (entry: SlashMenuEntry): void => {
    const opened = openStep(entry, deps, {
      done: (choice) => events.choose({ entry: choice.entry ?? entry, params: choice.params, below: false }),
      changed: () => drawStepHead(),
    });
    if (!opened) return;
    step = opened;
    dom.classList.add("is-step");
    typed.className = "slash-crumb";
    typed.textContent = `${entry.label} ›`;
    context.textContent = "";
    drawStepHead();
    tabs.hidden = true;
    body.replaceChildren(opened.dom);
    foot.replaceChildren(
      footKey(["←", "→", "↑", "↓"], t("slash.panel.keys.move")),
      footKey(["↵"], t("slash.panel.keys.enter")),
      footKey(["⌫"], t("slash.panel.keys.back")),
    );
    enter(opened.dom, { from: { x: 14, opacity: 0 }, spring: "snap", whenReduced: "fade", lifetime: life });
  };

  function drawStepHead(): void {
    if (!step) return;
    count.textContent = step.hint();
    events.active(step.active());
  }

  const leaveStep = (): void => {
    if (!step) return;
    // Il passo esce di lato da dove lo si vede, anche a metà dell'entrata;
    // l'immagine resta nel pannello, che ne porta la pelle.
    exitGhost(step.dom, { to: { x: 14, opacity: 0 }, duration: CLOSE_MS, layer: dom });
    step.dispose();
    step = null;
    dom.classList.remove("is-step");
    body.replaceChildren(list, preview);
    listFoot();
    refresh(true);
    enter(body, { from: { x: -14, opacity: 0 }, spring: "snap", whenReduced: "fade", lifetime: life });
  };

  function choose(below: boolean): void {
    const entry = entryAt(selected);
    if (!entry) {
      // Niente trovato: Invio cerca fra tutti i comandi.
      events.dismiss();
      events.palette(query);
      return;
    }
    if (entry.picker) {
      enterStep(entry);
      return;
    }
    events.choose({ entry, params: entry.params, below });
  }

  /// Salta alla sezione dopo (o prima) di quella della riga scelta.
  const jumpSection = (direction: 1 | -1): void => {
    const entries = results.entries;
    if (entries.length === 0) return;
    const firsts = entries.map((_, index) => index).filter((index) => index === 0 || entries[index - 1]!.section !== entries[index]!.section);
    const here = firsts.filter((index) => index <= selected).pop() ?? 0;
    const at = firsts.indexOf(here);
    const next = firsts[(at + direction + firsts.length) % firsts.length]!;
    select(next, true);
  };

  const printable = (event: KeyboardEvent): boolean =>
    event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;

  return {
    dom,
    listId: list.id,
    update(text, where) {
      if (life.closed) return;
      if (!transform) query = text;
      place = where;
      if (step) leaveStep();
      else refresh(!shown);
    },
    key(event) {
      if (life.closed) return false;
      if ((event.ctrlKey || event.metaKey) && event.key === "/") {
        events.dismiss();
        events.palette(query);
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
      switch (event.key) {
        case "ArrowDown":
          select(rows.length === 0 ? 0 : (selected + 1) % rows.length);
          return true;
        case "ArrowUp":
          select(rows.length === 0 ? 0 : (selected - 1 + rows.length) % rows.length);
          return true;
        case "PageDown":
          select(selected + 8);
          return true;
        case "PageUp":
          select(selected - 8);
          return true;
        case "Tab":
          if (results.filtering) select(event.shiftKey ? selected - 1 : selected + 1);
          else jumpSection(event.shiftKey ? -1 : 1);
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
          refresh(false);
          return true;
        }
        if (printable(event)) {
          query += event.key;
          refresh(false);
          return true;
        }
      }
      return false;
    },
    placed(above, caretX) {
      if (life.closed) return;
      home = dom.parentElement;
      // Il foglio sta in fondo alla finestra: CodeMirror riscrive `top` e
      // `left` a ogni misura, quindi li si rimette ogni volta.
      if (dom.classList.contains("is-sheet")) pinSheet(dom);
      if (shown) return;
      shown = true;
      const sheet = sheetWanted();
      dom.classList.toggle("is-sheet", sheet);
      if (sheet) pinSheet(dom);
      const room = window.innerWidth - (dom.closest(".cm-editor")?.getBoundingClientRect().left ?? 0);
      dom.classList.toggle("is-narrow", !sheet && room < NARROW_PX);
      dom.style.transformOrigin = sheet ? "50% 100%" : `${Math.round(caretX)}px ${above ? "100%" : "0"}`;
      enter(dom, {
        from: sheet ? { y: 24, opacity: 0 } : { scale: 0.96, y: above ? 6 : -6, opacity: 0 },
        spring: "snap",
        whenReduced: "fade",
        lifetime: life,
      });
      stagger(rows.slice(0, 8), (row) => enter(row, { from: { y: 6, opacity: 0 }, spring: "soft", lifetime: life }));
      placePill(false);
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
