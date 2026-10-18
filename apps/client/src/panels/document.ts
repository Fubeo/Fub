// La vista dei riquadri della shell di oggi: la loro cornice.
//
// Il controller (`state/document-controller.ts`) possiede i riquadri — quale
// documento mostrano, la superficie montata, il collegamento con la sessione,
// i comandi — e non disegna. Qui sta ciò che disegna: la striscia delle
// linguette con i suoi gesti, la barra del riquadro, la barra di
// formattazione, il banner del conflitto, lo stato vuoto, i divisori e l'albero
// dei contenitori dentro `#panes`. Il controller la raggiunge soltanto dalla
// porta `PaneView`, che questo modulo gli consegna in `mountDocument`.
//
// Chi importava da qui continua a farlo: ciò che è passato al controller è
// riesportato sotto, con gli stessi nomi.
import { promptText } from "../ui/dialogs";
import { openCompare } from "../ui/compare";
import { iconEl } from "../ui/icons";
import { api } from "../host/ipc";
import { on, state } from "../state/store";
import { documentSessions } from "../state/document-session";
import { openDocument as openRecreated } from "../state/document-controller";
import { clearRemovedNotice, dismissSheetNotice, limitedMode, removedNoticeOf, sheetNoticesOf, type SheetNoticeKind } from "../state/sheet-notices";
import {
  openIn,
  activateTab,
  closeTab,
  moveTab,
  moveTabToPane,
  splitWithTab,
  setPinnedTab,
  setTabStack,
  split,
  activeDoc,
  focusPane,
  layout,
  pane as paneState,
  panes as layoutPanes,
  activeTab,
  tabOverride,
  setSplitSizes,
  MIN_SPLIT_FRACTION,
  type LayoutNode,
  type SplitNode,
  type Tab,
} from "../state/layout";
import { $ } from "../ui/dom";
import { showContextMenu } from "../ui/menu";
import { confirm } from "../platform/confirm";
import { allCommands, ariaBinding, canCreateDrawing, displayBinding, newDrawing } from "../ui/commands";
import { notify } from "../ui/notify";
import { errorText } from "../host/errors";
import { t, type Key } from "../i18n/strings";
import type { Lifetime } from "../ui/lifetime";
import { setTooltip } from "../ui/tooltip";
import { tabIndexForKey } from "../ui/tab-keys";
import { createFormatBar, registerFormatIcons, type FormatBar } from "./format-bar";
import { createSelectionBubble, type SelectionBubble } from "./selection-bubble";
import { platformSupports } from "../platform/capabilities";
import { writeClipboardText } from "../platform/clipboard";
import {
  chooseExport,
  closeOthersAndRelease,
  closeRightAndRelease,
  closeTabAt,
  closeUnpinnedAndRelease,
  describeTab,
  docTitle,
  exportWindow,
  mountDocumentController,
  nameTab,
  offeredExports,
  offeredSourceView,
  openSourceViewBeside,
  paneBack,
  paneForward,
  paneOf,
  presentPrint,
  presentSlides,
  releaseTab,
  renderPane,
  resolveDiscardingMine,
  resolveKeepingMine,
  runExport,
  selectedMode,
  setMode,
  showSourceView,
  synchronize,
  toggleRecorder,
  type DocumentDeps,
  type Pane,
  type PaneElements,
  type PaneView,
} from "../state/document-controller";

// Ciò che questo modulo esportava e che adesso è del controller: i percorsi
// di import di chi lo usa non cambiano.
export {
  canShowFile,
  closeCurrentTab,
  closeDocument,
  closeOtherTabs,
  closeUnpinnedTabs,
  describeTab,
  focusEditor,
  freezeDocumentSurfaces,
  hasUnknownPersistedMode,
  isOpen,
  linkCurrentPane,
  moveCurrentTab,
  moveCurrentTabToPane,
  openDocument,
  openFromView,
  openWikilink,
  paneBack,
  paneForward,
  pinCurrentTab,
  publishContext,
  recoverDrafts,
  reloadCurrent,
  resetDocumentsForVault,
  reveal,
  runEditorAction,
  setEditorTheme,
  setMode,
  showsFileBytes,
  synchronize,
  textProfileFor,
} from "../state/document-controller";
export type { DocumentDeps } from "../state/document-controller";

/// La cornice di un riquadro: i nodi che questa vista ha creato attorno
/// all'editor. Lo stato del riquadro — cosa mostra, con quale superficie — è
/// del controller (`Pane`), e da qui lo si legge soltanto.
interface PaneFrame {
  id: string;
  root: HTMLElement;
  tabsShell: HTMLElement;
  tabsEl: HTMLElement;
  contentEl: HTMLElement;
  tabMenuEl: HTMLButtonElement;
  toolbarEl: HTMLElement;
  /// La barra di formattazione, sotto la toolbar: i pulsanti che i plugin
  /// offrono in `CommandSurface::Toolbar`. Vuota e nascosta senza nessuno.
  formatBar: FormatBar;
  /// La bolla di selezione: la barra ristretta, accanto al testo scelto,
  /// quando la barra del foglio è spenta.
  selectionBubble: SelectionBubble;
  conflictEl: HTMLElement;
  /// Gli altri avvisi della nota, sotto il conflitto (bozza, ricaricato,
  /// sola lettura, errore di salvataggio, modalità limitata).
  noticeEl: HTMLElement;
  /// Lo stato vuoto: cosa fare quando il riquadro non ha tab.
  emptyEl: HTMLElement;
  /// Firma dell'ultima striscia disegnata: un cambio di riquadro non deve
  /// ricreare tab identiche e togliere il fuoco al loro nodo DOM.
  tabsSignature: string | null;
}
const frames = new Map<string, PaneFrame>();
let panesEl: HTMLElement;
let deps: DocumentDeps;
/// Il gruppo dello stato del documento, trovato una volta: quando il riquadro
/// che lo ospita viene smontato esce dal documento, e `getElementById` non lo
/// ritroverebbe più.
let paneStatusEl: HTMLElement | null = null;

function frameOf(pane: Pane): PaneFrame {
  return frames.get(pane.id)!;
}

/// Monta l'area principale con la cornice di questa shell: accende il
/// controller dei riquadri e gli consegna la vista.
export function mountDocument(lifetime: Lifetime, d: DocumentDeps): void {
  deps = d;
  lifetime.add(registerFormatIcons());
  // I pulsanti della barra sono comandi: quando l'elenco cambia — un
  // componente acceso o spento — ogni riquadro ridisegna la sua.
  lifetime.add(on("commands", () => {
    for (const pane of frames.values()) {
      pane.formatBar.update(state.commandSpecs);
      pane.selectionBubble.update(state.commandSpecs);
    }
    // Il riquadro vuoto offre «Nuovo disegno…» quando il kernel ha il comando,
    // e l'elenco arriva dopo che il vault è già aperto.
    for (const id of layoutPanes()) {
      const frame = frames.get(id);
      const current = paneState(id);
      if (frame && current) drawEmptyPane(frame, current.tabs.length === 0);
    }
  }));
  mountDocumentController(lifetime, d, view);
}

/// La porta che il controller riceve. Ogni voce è il pezzo di disegno che
/// prima stava nel punto da cui adesso arriva la chiamata.
const view: PaneView = {
  attach: () => {
    panesEl = $("#panes");
  },
  createPane,
  releaseFrame: (pane) => {
    frameOf(pane).formatBar.destroy();
    frameOf(pane).selectionBubble.destroy();
  },
  removePane: (pane) => {
    pane.root.remove();
    frames.delete(pane.id);
  },
  layoutTree,
  drawTabs: (pane, tabs, active) => drawTab(frameOf(pane), tabs, active),
  drawFocus: (pane, focused) => {
    pane.root.classList.toggle("focus", focused);
  },
  drawViewSurface: (pane, shown) => {
    pane.root.classList.toggle("con-vista", shown);
  },
  drawToolbar,
  drawConflict: (pane, doc) => drawConflict(frameOf(pane), doc),
  drawSave,
  focusTab: (pane, index) => focusPaneTab(frameOf(pane), index),
  focusedTab,
  recorderHost: (pane) => frameOf(pane).toolbarEl,
};

/// La linguetta col fuoco della tastiera, se il fuoco è su una linguetta — le
/// frecce della striscia la raggiungono senza attivarla.
function focusedTab(): { pane: string; index: number } | null {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused.matches('.tab[role="tab"]')) {
    for (const r of frames.values()) {
      if (r.tabsShell.contains(focused)) return { pane: r.id, index: Number(focused.dataset.index) };
    }
  }
  return null;
}

/// Mette l'albero dei riquadri dentro `#panes`: i nodi dei riquadri si riusano
/// e si riappendono, i contenitori delle divisioni si rifanno.
function layoutTree(tree: LayoutNode): void {
  const onboarding = document.getElementById("onboarding");
  panesEl.replaceChildren(node(tree));
  // La schermata senza vault vive nell'HTML statico dentro #panes: il layout
  // la spazzerebbe via a ogni synchronize, quindi la si rimette in fondo —
  // `hidden` resta padrone della visibilità (A01, syncOnboarding in shell).
  if (onboarding) panesEl.append(onboarding);
}

function node(n: LayoutNode): HTMLElement {
  if (n.k === "leaf") {
    // Un riquadro riusato può venire da una divisione: fuori da lì la sua
    // frazione non vale più, e un `flex-grow` rimasto lo stringerebbe.
    const root = renderPane(n.pane).root;
    root.style.removeProperty("flex-grow");
    return root;
  }
  const el = document.createElement("div");
  el.className = `pane-split ${n.dir}`;
  const items = n.children.map(node);
  const sizes = n.sizes ?? items.map(() => 1 / items.length);
  items.forEach((item, index) => {
    item.style.flexGrow = String(sizes[index]);
    if (index > 0) el.append(splitDivider(n, index, el, items));
    el.append(item);
  });
  return el;
}

/// Il divisore fra due figli di una divisione: si trascina, si sposta con le
/// frecce (a passi del 5%), e un doppio clic riporta le parti uguali. Durante
/// il trascinamento cambia solo lo stile; il layout si scrive al rilascio.
function splitDivider(split: SplitNode, index: number, container: HTMLElement, items: HTMLElement[]): HTMLElement {
  const handle = document.createElement("div");
  handle.className = "pane-divider";
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", split.dir === "row" ? "vertical" : "horizontal");
  handle.setAttribute("aria-label", t("pane.resize"));
  handle.setAttribute("aria-valuemin", String(Math.round(MIN_SPLIT_FRACTION * 100)));
  handle.setAttribute("aria-valuemax", String(Math.round((1 - MIN_SPLIT_FRACTION) * 100)));
  handle.tabIndex = 0;
  const current = (): number[] => items.map((item) => Number(item.style.flexGrow) || 1 / items.length);
  const show = (sizes: number[]): void => {
    items.forEach((item, i) => { item.style.flexGrow = String(sizes[i]); });
    const pair = sizes[index - 1]! + sizes[index]!;
    handle.setAttribute("aria-valuenow", String(Math.round((sizes[index - 1]! / pair) * 100)));
  };
  // Si spostano solo i due vicini del divisore: gli altri riquadri non si
  // accorgono di niente.
  const shifted = (from: number[], delta: number): number[] => {
    const sizes = [...from];
    const pair = sizes[index - 1]! + sizes[index]!;
    const before = Math.min(Math.max(sizes[index - 1]! + delta, MIN_SPLIT_FRACTION), pair - MIN_SPLIT_FRACTION);
    sizes[index - 1] = before;
    sizes[index] = pair - before;
    return sizes;
  };
  show(current());
  const span = (): number => {
    const rect = container.getBoundingClientRect();
    return Math.max(1, split.dir === "row" ? rect.width : rect.height);
  };
  let dragging: { origin: number; start: number[] } | null = null;
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture?.(event.pointerId);
    handle.dataset.dragging = "";
    dragging = { origin: split.dir === "row" ? event.clientX : event.clientY, start: current() };
  });
  handle.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const at = split.dir === "row" ? event.clientX : event.clientY;
    show(shifted(dragging.start, (at - dragging.origin) / span()));
  });
  const release = (): void => {
    if (!dragging) return;
    dragging = null;
    delete handle.dataset.dragging;
    setSplitSizes(split, current());
  };
  handle.addEventListener("pointerup", release);
  handle.addEventListener("pointercancel", release);
  handle.addEventListener("dblclick", () => setSplitSizes(split, items.map(() => 1)));
  handle.addEventListener("keydown", (event) => {
    const back = split.dir === "row" ? "ArrowLeft" : "ArrowUp";
    const forward = split.dir === "row" ? "ArrowRight" : "ArrowDown";
    if (event.key !== back && event.key !== forward) return;
    event.preventDefault();
    const sizes = shifted(current(), event.key === back ? -0.05 : 0.05);
    show(sizes);
    setSplitSizes(split, sizes);
  });
  return handle;
}

/// La cornice di un riquadro nuovo. Lo stato del riquadro lo tiene il
/// controller, che riceve da qui i tre elementi in cui monta.
function createPane(id: string): PaneElements {
  const root = document.createElement("section");
  root.className = "pane";
  root.dataset.pane = id;
  // Ogni riquadro è una regione con un nome: senza, un lettore di schermo
  // annuncia N sezioni identiche e non c'è modo di sapere in quale si è
  // finiti. Il nome è il numero, che è l'unica cosa che li distingua finché
  // non hanno un titolo — e col documento aperto lo aggiorna `disegnaTab`.
  root.setAttribute("role", "region");
  root.tabIndex = -1;

  const tabsShell = document.createElement("div");
  tabsShell.className = "pane-tabs";
  const tabsEl = document.createElement("div");
  tabsEl.setAttribute("role", "tablist");
  // Le tab sono possedute dal tablist con `aria-owns`, ma il loro bottone di
  // chiusura resta nel flusso visivo accanto senza diventare un figlio vietato
  // della tablist. `display: contents` lascia la striscia un'unica fila.
  tabsEl.style.display = "contents";
  tabsShell.append(tabsEl);
  const tabMenuEl = document.createElement("button");
  tabMenuEl.type = "button";
  tabMenuEl.dataset.tabMenu = "";
  tabMenuEl.setAttribute("aria-haspopup", "menu");
  tabMenuEl.textContent = "▾";
  tabMenuEl.addEventListener("click", (event) => {
    const current = paneState(id);
    if (!current) return;
    showContextMenu(event, current.tabs.map((tab, index) => ({
      label: nameTab(tab) + (tab.k === "doc" && documentSessions.isDirty(tab.doc) ? ` · ${t("save.unsaved")}` : ""),
      selected: index === current.active,
      run: () => activateTab(id, index),
    })));
  });
  tabsShell.append(tabMenuEl);

  const contentEl = document.createElement("div");
  contentEl.setAttribute("role", "tabpanel");
  contentEl.style.display = "flex";
  contentEl.style.flex = "1";
  contentEl.style.minHeight = "0";
  contentEl.style.flexDirection = "column";
  contentEl.id = panePanelId(id);

  const editorEl = document.createElement("div");
  editorEl.className = "pane-editor";

  // La seconda superficie del riquadro (§3.3). Non è `declared-view` come nella
  // sidebar e non deve esserlo: là una view è un pannello con un titolo che si
  // apre e si chiude, qui **è** il contenuto del riquadro, e il titolo è già
  // sulla tab.
  const viewEl = document.createElement("div");
  viewEl.className = "pane-view";

  const toolbarEl = document.createElement("div");
  toolbarEl.className = "pane-toolbar";
  toolbarEl.setAttribute("role", "toolbar");

  const conflictEl = document.createElement("div");
  conflictEl.hidden = true;
  const noticeEl = document.createElement("div");
  noticeEl.className = "sheet-notices";
  noticeEl.hidden = true;

  // I collegamenti entranti e uscenti non stanno sotto il testo: li mostra
  // la scheda Collegamenti dell'ispettore, che segue il documento a fuoco.
  contentEl.append(editorEl, viewEl);
  const barHost = {
    surface: () => {
      const pane = paneOf(id);
      return pane?.shown?.k === "doc" ? pane.surface : null;
    },
    writing: () => {
      const pane = paneOf(id);
      return pane ? selectedMode(pane)?.presentation === "surface" : false;
    },
    focusPane: () => focusPane(id),
    runCommand: (command: string) => deps.runCommand(command),
  };
  const formatBar = createFormatBar(barHost);
  const selectionBubble: SelectionBubble = createSelectionBubble({
    ...barHost,
    barOff: () => document.getElementById("app")?.hasAttribute("data-formatbar-off") === true,
    active: () => root.contains(document.activeElement) || selectionBubble.element.contains(document.activeElement),
  });
  root.append(tabsShell, toolbarEl, formatBar.element, conflictEl, noticeEl, contentEl);
  // Toccare un riquadro gli dà il fuoco. `mousedown` e non `click` perché il
  // fuoco deve essere già di questo riquadro quando l'editor riceve l'evento:
  // altrimenti il contesto pubblicato subito dopo sarebbe quello di prima.
  root.addEventListener("mousedown", () => focusPane(id));
  root.addEventListener("focusin", () => focusPane(id));
  // I tasti laterali del mouse: indietro e avanti nella cronologia del riquadro.
  root.addEventListener("mouseup", (event) => {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    focusPane(id);
    if (event.button === 3) paneBack();
    else paneForward();
  });

  // Un riquadro senza tab dice cosa si può fare, invece di restare bianco.
  const emptyEl = document.createElement("div");
  emptyEl.className = "pane-empty";
  emptyEl.hidden = true;
  root.append(emptyEl);

  const r: PaneFrame = {
    id,
    root,
    tabsShell,
    tabsEl,
    contentEl,
    tabMenuEl,
    toolbarEl,
    formatBar,
    selectionBubble,
    conflictEl,
    noticeEl,
    emptyEl,
    tabsSignature: null,
  };
  frames.set(id, r);
  return { root, editorEl, viewEl };
}

function panePanelId(id: string): string {
  return `pane-${id}-tabpanel`;
}

function paneTabId(id: string, index: number): string {
  return `pane-${id}-tab-${index}`;
}

function focusPaneTab(r: PaneFrame, index: number): void {
  const tabs = r.tabsShell.querySelectorAll<HTMLElement>(".tab");
  tabs.forEach((tab, position) => {
    tab.tabIndex = position === index ? 0 : -1;
    const close = tab.parentElement?.querySelector<HTMLElement>(".tab-close");
    if (close) close.tabIndex = tab.tabIndex;
  });
  tabs[index]?.focus();
}

/// Disegna la striscia delle tab di un riquadro.
function drawTab(r: PaneFrame, tabs: Tab[], active: number): void {
  // Solo l'identità modifica la struttura: dirty, lingua e selezione
  // ridipingono gli stessi controlli senza sottrarre il focus.
  const signature = JSON.stringify(tabs);
  const focused = document.activeElement;
  const focusedTab = focused instanceof HTMLElement && r.tabsShell.contains(focused)
    ? focused.closest(".tab-entry")?.querySelector<HTMLElement>(".tab")
    : null;
  const focusedKey = focusedTab?.dataset.key;
  const focusedIndex = focusedTab ? Number(focusedTab.dataset.index) : -1;
  const onClose = focused instanceof HTMLElement && focused.matches(".tab-close");
  if (r.tabsSignature !== signature) {
    const children = tabs.map((tab, index) => buildTab(r, tab, index));
    const tabIds = children.map((entry) => entry.querySelector<HTMLElement>(".tab")!.id);
    r.tabsShell.replaceChildren(r.tabsEl, ...children, r.tabMenuEl);
    r.tabsSignature = signature;
    // Una tab con un comando di chiusura non può contenere il suo secondo
    // controllo: un `<button>` dentro una tab interattiva è HTML invalido e
    // axe lo segnala come `nested-interactive`. La tab è posseduta dalla
    // tablist tramite `aria-owns`; il bottone di chiusura resta il suo fratello
    // nel flusso visivo (`.tab-entry` li tiene in una fila).
    if (tabIds.length > 0) r.tabsEl.setAttribute("aria-owns", tabIds.join(" "));
    else r.tabsEl.removeAttribute("aria-owns");
  }
  const buttons = [...r.tabsShell.querySelectorAll<HTMLElement>(".tab")];
  const retained = focusedKey === undefined
    ? -1
    : buttons.findIndex((tab) => tab.dataset.key === focusedKey);
  const roving = retained >= 0
    ? retained
    : focusedIndex >= 0 ? Math.min(focusedIndex, tabs.length - 1) : active;
  tabs.forEach((tab, index) => paintTab(buttons[index]!, tab, index === active, index === roving));
  r.tabsShell.hidden = tabs.length === 0;
  r.contentEl.hidden = tabs.length === 0;
  drawEmptyPane(r, tabs.length === 0);
  const selected =
    active >= 0
      ? r.tabsShell.querySelector<HTMLElement>(`[role="tab"][data-index="${active}"]`)
      : null;
  if (selected) r.contentEl.setAttribute("aria-labelledby", selected.id);
  else r.contentEl.removeAttribute("aria-labelledby");
  r.tabsEl.setAttribute("aria-label", t("document.tab.list"));
  const activeName = tabs[active] ? nameTab(tabs[active]!) : "";
  // Il numero del riquadro, non il suo id interno (`pane-2`): è ciò che
  // distingue due riquadri per chi ascolta.
  const ordinal = layoutPanes().indexOf(r.id) + 1;
  r.root.setAttribute(
    "aria-label",
    activeName
      ? `${t("pane.named", { name: activeName })} (${ordinal})`
      : `${t("pane.empty")} (${ordinal})`,
  );
  if (focusedTab && focused && !focused.isConnected) {
    const replacement = buttons[roving];
    const control = onClose
      ? replacement?.parentElement?.querySelector<HTMLElement>(".tab-close")
      : replacement;
    (control ?? r.toolbarEl.querySelector<HTMLElement>('button[aria-haspopup="menu"]'))
      ?.focus({ preventScroll: true });
  }
  drawTabOverflow(r, tabs, active);
}

/// Lo stato vuoto del riquadro: i gesti con le loro scorciatoie, e «Nuovo
/// disegno…» se il kernel sa farli. Si ridisegna a ogni giro perché segue
/// lingua, accordi riconfigurati e l'elenco dei comandi del kernel, che arriva
/// dopo l'apertura del vault.
function drawEmptyPane(r: PaneFrame, empty: boolean): void {
  r.emptyEl.hidden = !empty || state.vaultRoot === "";
  if (r.emptyEl.hidden) return;
  const chord = (id: string): string =>
    displayBinding(allCommands().find((entry) => entry.id === id)?.binding ?? null);
  /// Un gesto del comando di shell `id`, col nome `label` e la sua scorciatoia.
  const shellGesture = (id: string, label: "commands.note.new" | "pane.empty.open") => {
    const keys = chord(id);
    return {
      text: keys ? `${t(label)} (${keys})` : t(label),
      run: () => allCommands().find((candidate) => candidate.id === id)?.run?.(),
    };
  };
  const gestures = [
    shellGesture("shell.note.new", "commands.note.new"),
    // La porta di un disegno, fra la nota nuova e l'apertura: due creazioni
    // vicine. Senza il comando del kernel non c'è, e non lascia un buco.
    ...(canCreateDrawing() ? [{ text: t("pane.empty.new_drawing"), run: () => void newDrawing() }] : []),
    shellGesture("shell.switcher", "pane.empty.open"),
  ];
  // Se i gesti sono gli stessi non si tocca niente: chi ha il fuoco su un
  // bottone non lo perde per un elenco di comandi che è arrivato uguale.
  const signature = JSON.stringify([t("pane.empty.title"), gestures.map((gesture) => gesture.text)]);
  if (r.emptyEl.dataset.gestures === signature) return;
  r.emptyEl.dataset.gestures = signature;
  const title = document.createElement("p");
  title.className = "pane-empty-title";
  title.textContent = t("pane.empty.title");
  const actions = document.createElement("div");
  actions.className = "pane-empty-actions";
  for (const gesture of gestures) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "link-button";
    button.textContent = gesture.text;
    button.addEventListener("click", () => {
      focusPane(r.id);
      gesture.run();
    });
    actions.append(button);
  }
  r.emptyEl.replaceChildren(title, actions);
}

/// Costruisce una tab accessibile (U21): nome breve + dirty testuale oltre
/// colore (`aria-label` "nome · Non salvato"), close "Chiudi nome" come
/// bottone vero (non span), attiva distinguibile via aria-selected, view con
/// titolo dichiarato senza fingere file.
function buildTab(r: PaneFrame, target: Tab, index: number): HTMLElement {
  const item = document.createElement("div");
  item.className = "tab-entry";
  const tab = document.createElement("button");
  tab.className = "tab";
  tab.type = "button";
  tab.id = paneTabId(r.id, index);
  tab.dataset.key = JSON.stringify(target);
  tab.dataset.index = String(index);
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-controls", panePanelId(r.id));
  const name = document.createElement("span");
  name.className = "tab-name";
  tab.append(name);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "tab-close";
  close.dataset.tabId = tab.id;
  const glyph = iconEl("close");
  if (glyph) close.append(glyph);
  const remove = (): void => {
    if (!tab.isConnected) return;
    closeTab(r.id, index);
    void releaseTab(r.id, target);
  };
  close.addEventListener("mousedown", (event) => {
    // Chiudere una tab in secondo piano non deve prima attivarla, né
    // attivare quella che si sta chiudendo un istante prima di toglierla.
    // La chiusura resta al `click`: premere e trascinare fuori annulla.
    event.stopPropagation();
    event.preventDefault();
  });
  close.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();
    remove();
  });
  // Il clic centrale chiude la tab, come nei browser.
  tab.addEventListener("mousedown", (event) => {
    if (event.button === 1) event.preventDefault();
  });
  tab.addEventListener("auxclick", (event) => {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    remove();
  });
  // Invio/Spazio sul Chiudi non devono anche attivare la tab: l'attivazione
  // resta esplicita e resta testabile senza sintesi nativa dei tasti.
  close.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.stopPropagation();
      event.preventDefault();
      close.click();
      return;
    }
    if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      event.stopPropagation();
    }
  });
  tab.addEventListener("click", () => activateTab(r.id, index));
  tab.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    openTabMenu(r, index, target, event);
  });
  tab.addEventListener("keydown", (event) => {
    if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      const box = tab.getBoundingClientRect();
      openTabMenu(r, index, target, new MouseEvent("contextmenu", {
        clientX: box.left + box.width / 2, clientY: box.bottom, bubbles: true,
      }));
      return;
    }
    // Gli accordi con modificatori sono della tastiera globale: spostare la
    // tab è `shell.tab.move.*`, rimappabile e sotto il presidio dei conflitti.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Delete") {
      event.preventDefault();
      remove();
      return;
    }
    const next = tabIndexForKey(index, event.key, r.tabsShell.querySelectorAll(".tab").length);
    if (next !== null) {
      event.preventDefault();
      focusPaneTab(r, next);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      tab.click();
    }
  });
  item.append(tab, close);
  wireTabDrag(r, item, index, target);
  return item;
}

/// Il contestuale di una tab (P06/F21): appunta, spunta, chiudi le altre,
/// chiudi le non appuntate, sposta a sinistra/destra. Le appuntate non si
/// chiudono per sbaglio: «chiudi le altre» le tiene.
function openTabMenu(r: PaneFrame, index: number, target: Tab, at: MouseEvent): void {
  const pinned = target.pinned === true;
  const paneIds = layoutPanes().filter((id) => id !== r.id);
  const tabs = paneState(r.id)?.tabs ?? [];
  const stacks = [...new Set(tabs.map((tab) => tab.stack).filter((name): name is string => !!name))];
  const chord = (id: string): string | undefined =>
    displayBinding(allCommands().find((entry) => entry.id === id)?.binding ?? null) || undefined;
  const doc = target.k === "doc" ? target.doc : null;
  const hasRight = tabs.some((tab, i) => i > index && !tab.pinned);
  showContextMenu(at, [
    {
      label: t("tabmenu.close"),
      hint: chord("shell.tab.close"),
      run: () => void closeTabAt(r.id, index),
    },
    {
      label: t("tabmenu.close_others"),
      disabled: tabs.length < 2,
      run: () => void closeOthersAndRelease(r.id, index),
    },
    {
      label: t("tabmenu.close_right"),
      disabled: !hasRight,
      run: () => void closeRightAndRelease(r.id, index),
    },
    {
      label: t("tabmenu.close_unpinned"),
      run: () => void closeUnpinnedAndRelease(r.id),
    },
    {
      separator: true,
      label: t(pinned ? "tabmenu.unpin" : "tabmenu.pin"),
      run: () => {
        setPinnedTab(r.id, index, !pinned);
        void synchronize();
      },
    },
    ...(doc ? [{
      label: t("tabmenu.split_right"),
      run: () => {
        const added = split(r.id, "row");
        if (added) {
          openIn(added, doc);
          void synchronize();
        }
      },
    }, ...(platformSupports("multipleWindows") ? [{
      label: t("tabmenu.new_window"),
      run: () => void import("../state/document-windows").then((windows) => windows.openCurrentInNewWindow(doc)),
    }] : [])] : []),
    // Gli stessi quattro bordi su cui si rilascia una linguetta: il gesto col
    // mouse ha il suo comando (§18.2).
    ...(!pinned && tabs.length > 1
      ? (["left", "right", "top", "bottom"] as const).map((edge, i) => ({
          separator: i === 0,
          label: t(`tabmenu.move_split.${edge}` as const),
          run: () => {
            if (splitWithTab(r.id, index, r.id, edge)) void synchronize();
          },
        }))
      : []),
    ...(!pinned ? paneIds.map((id) => ({
      label: t("tabmenu.to_pane", { pane: String(layoutPanes().indexOf(id) + 1) }),
      run: () => { if (moveTabToPane(r.id, index, id)) void synchronize(); },
    })) : []),
    ...(doc ? [{
      separator: true,
      label: t("tabmenu.copy_path"),
      run: () => {
        void writeClipboardText(doc).then(
          () => notify(t("tabmenu.path_copied", { path: doc }), "info"),
          () => notify(t("tabmenu.copy_failed"), "guasto"),
        );
      },
    }, {
      label: t("commands.explorer.reveal"),
      run: () => {
        activateTab(r.id, index);
        void synchronize().then(() => allCommands().find((entry) => entry.id === "shell.explorer.reveal")?.run?.());
      },
    }] : []),
    {
      separator: true,
      label: t("tabmenu.left"),
      hint: chord("shell.tab.move.left"),
      disabled: index === 0,
      run: () => {
        if (moveTab(r.id, index, index - 1)) void synchronize();
      },
    },
    {
      label: t("tabmenu.right"),
      hint: chord("shell.tab.move.right"),
      disabled: index >= tabs.length - 1,
      run: () => {
        if (moveTab(r.id, index, index + 1)) void synchronize();
      },
    },
    ...stacks.filter((name) => name !== target.stack).map((name, i) => ({
      separator: i === 0,
      label: t("tabmenu.to_stack", { stack: name }),
      run: () => {
        setTabStack(r.id, index, name);
        void synchronize();
      },
    })),
    {
      separator: stacks.filter((name) => name !== target.stack).length === 0,
      label: t("tabmenu.new_stack"),
      run: async () => {
        const name = await promptText({ title: t("tabmenu.new_stack"), label: t("tabmenu.stack_name") });
        if (name?.trim()) {
          setTabStack(r.id, index, name);
          void synchronize();
        }
      },
    },
    ...(target.stack ? [{
      label: t("tabmenu.leave_stack"),
      run: () => {
        setTabStack(r.id, index, null);
        void synchronize();
      },
    }] : []),
  ]);
}

/// Il drag di una tab (P06/F21): riordino dentro il riquadro, spostamento fra
/// riquadri. Le appuntate non si trascinano via: restano dov'erano. Il gesto
/// col mouse ha gli stessi comandi del contestuale e della tastiera, che è la
/// regola del §18.2 — un gesto che vive solo in un listener non compare da
/// nessuna parte.
function wireTabDrag(r: PaneFrame, item: HTMLElement, index: number, target: Tab): void {
  if (target.pinned) return;
  item.draggable = true;
  item.addEventListener("dragstart", (e) => {
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/plain", JSON.stringify({ pane: r.id, index }));
  });
  item.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
  });
  item.addEventListener("drop", (e) => {
    e.preventDefault();
    let payload: { pane: string; index: number } | null = null;
    try {
      payload = JSON.parse(e.dataTransfer?.getData("text/plain") ?? "") as { pane: string; index: number };
    } catch {
      payload = null;
    }
    if (!payload || typeof payload.pane !== "string" || typeof payload.index !== "number") return;
    if (payload.pane === r.id) {
      if (moveTab(r.id, payload.index, index)) void synchronize();
    } else if (moveTabToPane(payload.pane, payload.index, r.id)) {
      void synchronize();
    }
  });
}

/// Ridipinge etichette e selezione senza ricreare i controlli. Il nome
/// accessibile porta anche lo stato non salvato, non soltanto il colore.
function paintTab(tab: HTMLElement, target: Tab, selected: boolean, tabStop: boolean): void {
  const described = describeTab(target);
  tab.classList.toggle("dirty", described.dirty);
  tab.classList.toggle("tab-view", described.kind === "view");
  tab.classList.toggle("tab-pinned", target.pinned === true);
  tab.setAttribute("aria-selected", String(selected));
  tab.tabIndex = tabStop ? 0 : -1;
  // La vista sorgente si dice a vista e al lettore di schermo: lo stesso
  // documento in due riquadri, una volta disegnato e una volta come testo,
  // darebbe due schede indistinguibili.
  const source = tabOverride(target) ? t("document.tab.source_view") : null;
  const name = tab.querySelector<HTMLElement>(".tab-name")!;
  name.textContent = described.label + (target.stack ? ` [${target.stack}]` : "") + (source ? ` · ${source}` : "");
  const pin = target.pinned ? iconEl("pin") : null;
  if (pin) {
    pin.classList.add("tab-pin");
    name.prepend(pin);
  }
  setTooltip(tab, (target.k === "doc" ? target.doc : described.label) + (source ? ` · ${source}` : ""));
  // Si ridipinge a ogni giro: segue gli accordi riconfigurati.
  tab.setAttribute("aria-keyshortcuts", tabShortcuts());
  tab.setAttribute(
    "aria-label",
    (target.pinned ? `${t("tabmenu.pinned")} · ` : "") + (described.dirty ? `${described.label} · ${t("save.unsaved")}` : described.label) + (source ? ` · ${source}` : "") + (target.stack ? ` · ${t("tabmenu.stack", { stack: target.stack })}` : ""),
  );
  const close = tab.parentElement!.querySelector<HTMLElement>(".tab-close")!;
  close.tabIndex = tab.tabIndex;
  const closeLabel = t("document.tab.close", { doc: described.label });
  close.setAttribute("aria-label", closeLabel);
  setTooltip(close, closeLabel);
}

/// I comandi che agiscono sulla tab col fuoco, oltre ai due tasti della striscia.
const TAB_COMMANDS = ["shell.tab.move.left", "shell.tab.move.right", "shell.tab.move.pane.previous", "shell.tab.move.pane.next"];

function tabShortcuts(): string {
  const bound = allCommands().filter((entry) => TAB_COMMANDS.includes(entry.id));
  return ["Delete", "Shift+F10", ...bound.map((entry) => ariaBinding(entry.binding)).filter(Boolean)].join(" ");
}

/// L'elenco resta fuori dalla tablist e non viene ricreato a ogni ridisegno.
function drawTabOverflow(r: PaneFrame, tabs: Tab[], active: number): void {
  r.tabMenuEl.hidden = tabs.length <= 1;
  r.tabMenuEl.setAttribute("aria-label", t("document.tab.list"));
  setTooltip(r.tabMenuEl, t("document.tab.list"));
  const focused = document.activeElement;
  const selected = focused instanceof HTMLElement && r.tabsShell.contains(focused)
    ? focused
    : r.tabsShell.querySelectorAll<HTMLElement>(".tab")[active];
  selected?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

/// Toolbar per-riquadro (U23-U26): percorso contestuale + modi dichiarati
/// dalla superficie + menu con azioni esistenti. Usa percorso focus/mode
/// esistente, mai seconda verità; una sola modalità = nessun segmentato (U24);
/// mai ricreare EditorView (solo chrome, superficie intatta).
function drawToolbar(r: Pane): void {
  const bar = frameOf(r).toolbarEl;
  if (!bar.firstElementChild) {
    // Indietro e avanti nella cronologia del riquadro: i comandi ci sono, qui
    // diventano visibili.
    const nav = document.createElement("span");
    nav.className = "pane-nav";
    for (const [direction, glyph] of [["back", "←"], ["forward", "→"]] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.nav = direction;
      button.textContent = glyph;
      button.addEventListener("click", () => {
        focusPane(r.id);
        if (direction === "back") paneBack();
        else paneForward();
      });
      nav.append(button);
    }
    const crumbs = document.createElement("span");
    crumbs.className = "muted";
    // Il posto dello stato del documento (salvataggio, statistiche): lo
    // occupa soltanto il riquadro col fuoco, vedi `hostPaneStatus`.
    const status = document.createElement("span");
    status.className = "pane-status-slot";
    const group = document.createElement("span");
    group.className = "segmented";
    group.setAttribute("role", "group");
    const menu = document.createElement("button");
    menu.type = "button";
    menu.dataset.paneMenu = "";
    menu.textContent = "…";
    menu.setAttribute("aria-haspopup", "menu");
    menu.addEventListener("click", (event) => openPaneMenu(r, event));
    bar.append(nav, crumbs, status, group, menu);
  }
  const nav = bar.querySelector<HTMLElement>(":scope > .pane-nav")!;
  const crumbs = bar.querySelector<HTMLElement>(":scope > .muted")!;
  const status = bar.querySelector<HTMLElement>(":scope > .pane-status-slot")!;
  const group = bar.querySelector<HTMLElement>(":scope > .segmented")!;
  const menu = bar.querySelector<HTMLElement>(":scope > [data-pane-menu]")!;
  const history = paneState(r.id)?.history;
  for (const button of nav.querySelectorAll<HTMLButtonElement>("button")) {
    const back = button.dataset.nav === "back";
    const label = t(back ? "commands.pane.back" : "commands.pane.forward");
    button.setAttribute("aria-label", label);
    setTooltip(button, label);
    button.disabled = back ? !history?.past.length : !history?.future.length;
  }
  if (r.id === layout.focus) hostPaneStatus(status);
  const tab = activeTab(r.id);
  // Senza una tab non c'è documento di cui dire lo stato né una strada da
  // ripercorrere a vista: restano il menu del riquadro e lo stato vuoto.
  status.hidden = tab?.k !== "doc";
  nav.hidden = !tab;
  const path = tab?.k === "doc" ? tab.doc : tab?.k === "view" ? nameTab(tab) : "";
  crumbs.textContent = path;
  setTooltip(crumbs, path);
  group.setAttribute("aria-label", t("document.toolbar.modes"));
  menu.setAttribute("aria-label", t("document.pane.menu"));
  const modes = r.surface && r.surface.modes.length > 1 ? r.surface.modes : [];
  const active = selectedMode(r);
  group.hidden = modes.length <= 1;
  while (group.children.length > modes.length) group.lastElementChild!.remove();
  modes.forEach((mode, index) => {
    let button = group.children[index] as HTMLButtonElement | undefined;
    if (!button) {
      const control = document.createElement("button");
      control.type = "button";
      control.className = "segmented-option";
      control.addEventListener("click", () => {
        focusPane(r.id);
        void setMode(control.dataset.mode!);
      });
      group.append(control);
      button = control;
    }
    button.dataset.mode = mode.id;
    button.textContent = mode.label();
    button.setAttribute("aria-pressed", String(active?.id === mode.id));
  });
  // La barra segue la superficie e la sua modalità: si ridisegna qui, dove
  // entrambe sono appena state decise.
  frameOf(r).formatBar.update(state.commandSpecs);
  frameOf(r).selectionBubble.update(state.commandSpecs);
}

/// Porta lo stato del documento a fuoco — `#pane-status`: il salvataggio e
/// le view della superficie di stato — nella toolbar del riquadro col fuoco.
/// È un gruppo solo e si sposta, non si copia: i suoi proprietari
/// (`drawSave`, `ui/views.ts`) continuano a scrivere sugli stessi nodi.
function hostPaneStatus(slot: HTMLElement): void {
  const group = paneStatusEl ??= document.getElementById("pane-status");
  if (!group) return;
  if (group.parentElement !== slot) slot.append(group);
  group.hidden = false;
}

/// Menu riquadro con sole azioni esistenti (U25): split/close via comandi
/// registrati, focus/mode dal percorso esistente. Registratore, slide e stampa
/// seguono le capacità che la superficie montata dichiara.
function openPaneMenu(r: Pane, event: MouseEvent): void {
  const entries = allCommands().filter((entry) =>
    ["shell.pane.split.right", "shell.pane.split.down", "shell.pane.close", "shell.tab.close"].includes(entry.id),
  );
  const doc = activeDoc(r.id);
  const surface = r.surface;
  // La vista sorgente si chiede a **questo** riquadro, non a quello col fuoco
  // come farebbe `available`: il menu si apre anche su un riquadro accanto.
  const sourceView = offeredSourceView(r);
  const sourceShown = tabOverride(activeTab(r.id)) !== null;
  showContextMenu(event, [
    ...entries.map((entry) => ({
      label: entry.title,
      run: () => {
        focusPane(r.id);
        void entry.run?.();
      },
    })),
    ...(sourceView || sourceShown ? [{
      label: t(sourceShown ? "commands.doc.source.close" : "commands.doc.source.open"),
      run: () => {
        focusPane(r.id);
        void showSourceView(r.id, sourceShown ? null : sourceView);
      },
    }] : []),
    ...(sourceView ? [{
      label: t("commands.doc.source.side"),
      run: () => {
        focusPane(r.id);
        void openSourceViewBeside(r.id);
      },
    }] : []),
    ...(doc && surface?.insertReferences ? [{
      label: t(r.disposeRecorder ? "pane.recorder.close" : "pane.recorder.open"),
      run: () => void toggleRecorder(r, doc),
    }] : []),
    ...(doc && surface?.mountPresentation ? [{ label: t("pane.slides"), run: () => presentSlides(r, doc) }] : []),
    ...(doc && surface?.printable ? [{ label: t("pane.print"), run: () => void presentPrint(r, doc) }] : []),
    ...(exportWindow(r) ? [{
      label: t("commands.doc.export"),
      run: () => {
        focusPane(r.id);
        void chooseExport(r.id);
      },
    }] : []),
    ...offeredExports(r).map((offered) => ({
      label: t("pane.export", { what: offered.label() }),
      run: () => {
        focusPane(r.id);
        if (r.shown?.k === "doc") void runExport(r.shown.doc, offered);
      },
    })),
  ]);
}

/// Banner conflitto persistente nel riquadro coinvolto (U59-U60): documento,
/// spiegazione, Mantieni mio / Usa disco, conferma esplicita con conseguenza,
/// comandi shell.doc.conflict.* esistenti. Mai merge finto, mai risoluzione
/// automatica; buffer recuperabile finché irrisolto (solo ridisegno + comandi).
/// I conflitti rimandati: il banner si riduce a una riga finché chi scrive non
/// torna a deciderlo. La decisione resta sua; rimandarla non la perde.
const deferredConflicts = new Set<string>();

function drawConflict(r: PaneFrame, doc: string | null): void {
  drawNotices(r, doc);
  const box = r.conflictEl;
  box.replaceChildren();
  if (!doc || documentSessions.saveState(doc) !== "conflitto") {
    if (doc) deferredConflicts.delete(doc);
    box.hidden = true;
    box.removeAttribute("role");
    return;
  }
  box.hidden = false;
  box.className = "conflict-banner";
  box.setAttribute("data-banner", "document.conflict.body");
  const current = doc;
  if (deferredConflicts.has(current)) {
    // Ridotto: una riga che dice che la scelta aspetta, e la riapre.
    box.dataset.collapsed = "";
    box.setAttribute("role", "status");
    const line = document.createElement("span");
    line.textContent = t("document.conflict.pending", { doc: docTitle(current) });
    const reopen = document.createElement("button");
    reopen.type = "button";
    reopen.className = "link-button";
    reopen.textContent = t("document.conflict.resume");
    reopen.addEventListener("click", () => {
      deferredConflicts.delete(current);
      drawConflict(r, current);
    });
    box.append(line, reopen);
    return;
  }
  delete box.dataset.collapsed;
  box.setAttribute("role", "alert");
  const title = document.createElement("strong");
  title.textContent = t("document.conflict.title", { doc: docTitle(current) });
  const body = document.createElement("p");
  body.textContent = t("document.conflict.body");
  body.setAttribute("data-doc", current);
  const actions = document.createElement("div");
  actions.className = "conflict-actions";
  const compare = document.createElement("button");
  compare.type = "button";
  compare.textContent = t("document.conflict.compare");
  const mine = document.createElement("button");
  mine.type = "button";
  mine.className = "primary";
  mine.dataset.choice = "mine";
  mine.textContent = t("document.conflict.keep_mine");
  const theirs = document.createElement("button");
  theirs.type = "button";
  theirs.dataset.choice = "theirs";
  theirs.textContent = t("document.conflict.use_disk");
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "link-button";
  cancel.textContent = t("document.conflict.cancel");
  const ask = async (choice: "mine" | "theirs"): Promise<void> => {
    const detail = choice === "mine"
      ? t("commands.doc.conflict.mine.desc")
      : t("commands.doc.conflict.theirs.desc");
    const ok = await confirm(
      `${t(choice === "mine" ? "commands.doc.conflict.mine" : "commands.doc.conflict.theirs")}\n${current}\n${detail}`,
      {
        title: t("document.conflict.title", { doc: current }),
        okLabel: t(choice === "mine" ? "commands.doc.conflict.mine" : "commands.doc.conflict.theirs"),
        danger: choice === "theirs",
      },
    );
    if (!ok) return;
    deferredConflicts.delete(current);
    if (choice === "mine") await resolveKeepingMine(current);
    else await resolveDiscardingMine(current);
  };
  compare.addEventListener("click", () => {
    // Il testo su disco si legge adesso, non da una copia: è quello che la
    // scelta «usa la versione su disco» metterebbe al posto del mio.
    void api.readDocument(current, documentSessions.vaultFor(current)).then(
      (source) => openCompare(t("document.conflict.compare_title", { doc: docTitle(current) }), source.text, documentSessions.text(current) ?? ""),
      (error: unknown) => notify(t("document.reload_failed", { doc: current }) + ` ${errorText(error)}`, "guasto"),
    );
  });
  mine.addEventListener("click", () => void ask("mine"));
  theirs.addEventListener("click", () => void ask("theirs"));
  cancel.addEventListener("click", () => {
    deferredConflicts.add(current);
    drawConflict(r, current);
  });
  actions.append(compare, mine, theirs, cancel);
  box.append(title, body, actions);
}

/// Gli avvisi della nota sotto il banner del conflitto. Alcuni si ricavano
/// dallo stato della sessione e durano quanto quello (errore di salvataggio,
/// sola lettura per una cancellazione che aspetta); altri sono fatti che il
/// controllore ha visto e che restano finché chi scrive non li chiude (bozza,
/// ricaricato, cambiato su disco). La modalità limitata è del vault, e si vede
/// in ogni foglio con una nota. Niente qui decide: ogni azione è un comando o
/// la chiusura dell'avviso.
interface SheetLine {
  readonly id: string;
  readonly tone: "info" | "warning" | "danger";
  readonly text: string;
  readonly action?: { readonly label: string; readonly run: () => void };
  readonly dismiss?: () => void;
}

const NOTICE_KEY = {
  recovered: "notice.recovered",
  changed_on_disk: "notice.changed_on_disk",
  overwritten: "notice.overwritten",
  reloaded: "notice.reloaded",
} as const satisfies Record<SheetNoticeKind, Key>;

function noticeLines(doc: string | null, pane: string): SheetLine[] {
  const lines: SheetLine[] = [];
  const removed = removedNoticeOf(pane);
  if (removed) {
    const recreate = removed.recreate;
    lines.push({
      id: "removed",
      tone: "warning",
      text: t("notice.removed", { doc: docTitle(removed.doc) }),
      ...(recreate
        ? {
            action: {
              label: t("document.recreate"),
              run: () => {
                clearRemovedNotice(pane);
                void recreate().then(() => openRecreated(removed.doc));
              },
            },
          }
        : {}),
      dismiss: () => {
        clearRemovedNotice(pane);
        const frame = frames.get(pane);
        if (frame) drawNotices(frame, doc);
      },
    });
  }
  if (doc) lines.push(...noticeLinesOf(doc));
  const limited = limitedMode();
  if (limited) {
    lines.push({ id: "limited", tone: "info", text: t("notice.limited", { reason: limited.reason ?? "" }).trim() });
  }
  return lines;
}

function noticeLinesOf(doc: string): SheetLine[] {
  const name = docTitle(doc);
  const lines: SheetLine[] = [];
  const saveState = documentSessions.saveState(doc);
  if (saveState === "fallito") {
    lines.push({
      id: "save_failed",
      tone: "danger",
      text: t("notice.save_failed", { doc: name }),
      action: {
        label: t("app.retry"),
        run: () => void allCommands().find((entry) => entry.id === "shell.doc.save")?.run?.(),
      },
    });
  }
  if (documentSessions.isDeletionPending(doc)) {
    lines.push({ id: "read_only", tone: "warning", text: t("notice.read_only", { doc: name }) });
  }
  for (const notice of sheetNoticesOf(doc)) {
    const detail = notice.detail ? t(notice.detail) : "";
    lines.push({
      id: notice.kind,
      tone: notice.kind === "reloaded" ? "info" : "warning",
      text: t(NOTICE_KEY[notice.kind], { doc: name, detail }).trim(),
      dismiss: () => {
        dismissSheetNotice(doc, notice.kind);
        for (const frame of frames.values()) drawNotices(frame, doc);
      },
    });
  }
  return lines;
}

function drawNotices(r: PaneFrame, doc: string | null): void {
  const box = r.noticeEl;
  const lines = noticeLines(doc, r.id);
  // Stessa firma = stesso disegno: un ridisegno dello stato non deve rifare i
  // nodi sotto un fuoco che sta sul pulsante di un avviso.
  const signature = lines.map((line) => `${line.id}:${line.text}`).join("\n");
  if (box.dataset.signature === signature) return;
  box.dataset.signature = signature;
  box.replaceChildren();
  box.hidden = lines.length === 0;
  for (const line of lines) {
    const row = document.createElement("div");
    row.className = "sheet-notice";
    row.dataset.tone = line.tone;
    row.dataset.notice = line.id;
    row.setAttribute("role", line.tone === "danger" ? "alert" : "status");
    const text = document.createElement("span");
    text.className = "sheet-notice-text";
    text.textContent = line.text;
    row.append(text);
    if (line.action) {
      const run = line.action.run;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "link-button";
      button.textContent = line.action.label;
      button.addEventListener("click", () => run());
      row.append(button);
    }
    if (line.dismiss) {
      const dismiss = line.dismiss;
      const close = document.createElement("button");
      close.type = "button";
      close.className = "link-button";
      close.textContent = t("notice.dismiss");
      close.addEventListener("click", () => dismiss());
      row.append(close);
    }
    box.append(row);
  }
}

/// Lo stato del salvataggio **del documento che si sta guardando**, nella
/// toolbar del riquadro col fuoco, accanto al suo percorso.
///
/// Lì e non sulla tab, perché la tab ha già il pallino del non salvato e ha
/// spazio per una parola sola: il pallino dice *quale* nota ha qualcosa da
/// scrivere, questa riga dice *cosa le è successo*. E lì e non in un pannello,
/// perché è una superficie che c'è sempre e che non chiede di essere aperta.
///
/// Se la shell non ha quell'elemento — un test, un host che monta un pezzo solo
/// — non succede niente: come per `notify`, il fatto non dipende dal suo disegno.
function drawSave(): void {
  const el = paneStatusEl?.querySelector<HTMLElement>("#save-state") ?? document.getElementById("save-state");
  if (!el) return;
  const doc = activeDoc();
  const state = doc ? documentSessions.saveState(doc) : null;
  if (!state) {
    el.textContent = "";
    delete el.dataset.state;
    return;
  }
  el.dataset.state = state;
  el.textContent = t(STATE_KEY[state]);
}

const STATE_KEY = {
  "salvato": "save.saved",
  "in_corso": "save.saving",
  "non_salvato": "save.unsaved",
  "fallito": "save.failed",
  "conflitto": "save.conflitto",
} as const;
