// Il gestore del documento: i comandi dei riquadri e delle linguette.

import { VECTOR_PROFILE } from "../editors/core/component-surfaces";
import { type SurfaceScrollLink } from "../editors/core/registry";
import { offersContext, offersMode, offersReadingToggle } from "../editors/core/surface-modes";
import { discardDescription } from "./conflict-keep";
import {
  openIn,
  closePane,
  closeTab,
  goBack,
  goForward,
  moveTab,
  moveTabToPane,
  setPinnedTab,
  reopenClosedTab,
  cycleTab,
  goToTab,
  setPaneLink,
  split,
  activeDoc,
  focusPane,
  setMode as setPaneMode,
  layout,
  pane as paneState,
  activePane,
  panes as layoutPanes,
  sameTab,
  activateTab,
  recentTabs,
  tabOverride,
  activeTab,
  type Tab,
} from "./layout";
import { registerShellCommand } from "../ui/commands";
import type { LiveCommandTargets } from "../editors/spatial/live/commands";
import { notify } from "../ui/notify";
import { unmountViewFromPane } from "../ui/views";
import { t } from "../i18n/strings";
import { openLifetime } from "../ui/lifetime";
import { panes, view } from "./document-controller-state";
import { exportableNote, presentExport, offeredExports, chooseExport } from "./document-controller-export";
import { synchronize, focusShownAfter, closeOthersAndRelease, closeUnpinnedAndRelease } from "./document-controller-draw";
import {
  focusedAnchorSurface,
  copyAnchorLink,
  selectedMode,
  focusedModes,
  editorActionReady,
  runEditorAction,
  toggleReading,
  setContextMode,
  offeredSourceView,
  openSourceView,
  closeSourceView,
  openSourceViewBeside,
  setMode,
} from "./document-controller-modes";
import { resolveKeepingMine, resolveDiscardingMine, releaseTab, dismissIfUnwatched, saveNow } from "./document-controller-save";

// --- i comandi dei riquadri (§18.2) -----------------------------------------
//
// Dividere, chiudere un riquadro, chiudere una linguetta sono **comandi** e non solo
// gesti del mouse, per la ragione della 0077: un gesto che vive solo in un
// listener è un gesto che non compare in nessun elenco e che nessuno può
// riconfigurare. Passano dalla stessa porta del click, così il cablaggio sta in
// un punto solo.

/// Il giro di `Ctrl+Tab`: l'ordine d'uso preso alla prima pressione e il punto
/// raggiunto. Finché il modificatore resta giù le pressioni scendono in quello
/// stesso ordine; lasciato, il giro finisce e la scheda scelta è la più recente.
export let recentRound: { pane: string; order: Tab[]; at: number } | null = null;

/// Il giro di `Ctrl+Tab` finisce: il modificatore lasciato, o la shell smontata.
export function endRecentRound(): void {
  recentRound = null;
}

function stepRecentTab(step: 1 | -1): void {
  const id = layout.focus;
  const p = layout.panes[id];
  if (!p || p.tabs.length < 2) return;
  const current = p.tabs[p.active];
  const round = recentRound;
  const going = round && round.pane === id && current && sameTab(current, round.order[round.at]!) ? round : null;
  const next = going ?? { pane: id, order: recentTabs(id).map((index) => p.tabs[index]!), at: 0 };
  next.at = (next.at + step + next.order.length) % next.order.length;
  recentRound = next;
  const index = p.tabs.findIndex((each) => sameTab(each, next.order[next.at]!));
  if (index < 0) return;
  activateTab(id, index);
  void focusShownAfter(synchronize());
}

export function registerCommands(): void {
  // Le modalità come comandi (§18.2): erano bottoni nel commutatore, cioè
  // raggiungibili col mouse e con nient'altro. Passano dalla stessa porta del
  // click (`setMode`), che è dove sta il cablaggio — classe attiva, resa
  // inline, superficie di lettura, contesto pubblicato — e non da una seconda
  // via che deve restare d'accordo con la prima.
  //
  // Un comando nomina un ruolo e non un id: la superficie dichiara il ruolo di
  // ogni sua modalità (`contextMode`), e il comando raggiunge la modalità che
  // ce l'ha — la «canvas» della tela per Live, la «read» di un profilo che
  // chiama così la sua lettura. C'è soltanto dove porterebbe a qualcosa: una
  // superficie con una modalità sola non ne offre nessuno (`surface-modes.ts`).
  // Solo `Mod-e` ha un accordo: chi passa da Lettura a scrittura lo fa cento
  // volte al giorno, chi guarda il sorgente nudo lo fa per capire cosa c'è
  // scritto. Dalla scrittura porta in Lettura, dalla Lettura torna alla
  // modalità di scrittura da cui si era partiti.
  registerShellCommand({
    id: "shell.mode.reading",
    title: "commands.mode.reading",
    description: "commands.mode.reading.desc",
    layer: "surface",
    available: () => offersReadingToggle(focusedModes()),
    run: () => void toggleReading(),
  });
  registerShellCommand({
    id: "shell.mode.live",
    title: "commands.mode.live",
    description: "commands.mode.live.desc",
    layer: "profile",
    available: () => offersContext(focusedModes(), "live_preview"),
    run: () => void setContextMode("live_preview"),
  });
  registerShellCommand({
    id: "shell.mode.source",
    title: "commands.mode.source",
    description: "commands.mode.source.desc",
    layer: "profile",
    available: () => offersContext(focusedModes(), "source"),
    run: () => void setContextMode("source"),
  });
  // I Blocchi (N13) sono dentro Scrittura: la nota dichiara `blocks` fra gli
  // id di prima della sua Scrittura (`formerIds`), e il comando, che lo
  // nomina, porta lì e c'è soltanto dove una superficie lo dichiara.
  registerShellCommand({
    id: "shell.mode.blocks",
    title: "commands.mode.blocks",
    description: "commands.mode.blocks.desc",
    layer: "profile",
    available: () => offersMode(focusedModes(), "blocks"),
    run: () => void setMode("blocks"),
  });
  // La vista sorgente di una scheda (ADR 0203): lo stesso documento, sulla
  // stessa sessione, nella superficie che la sua dichiara come sorgente — un
  // disegno come testo SVG. Aprirla, lì o accanto, si può dove la superficie
  // la offre e la scheda non la mostra già; tornare indietro, dove la scheda
  // la mostra: mai le due cose insieme.
  registerShellCommand({
    id: "shell.doc.source.open",
    title: "commands.doc.source.open",
    description: "commands.doc.source.open.desc",
    layer: "document",
    available: () => offeredSourceView(panes.get(layout.focus)) !== null,
    run: () => void openSourceView(),
  });
  registerShellCommand({
    id: "shell.doc.source.side",
    title: "commands.doc.source.side",
    description: "commands.doc.source.side.desc",
    layer: "document",
    available: () => offeredSourceView(panes.get(layout.focus)) !== null,
    run: () => void openSourceViewBeside(layout.focus),
  });
  registerShellCommand({
    id: "shell.doc.source.close",
    title: "commands.doc.source.close",
    description: "commands.doc.source.close.desc",
    layer: "document",
    available: () => tabOverride(activeTab()) !== null,
    run: () => void closeSourceView(),
  });
  // Gli export che la superficie del documento dichiara (`exports`): la sua
  // finestra, se ne ha una; se no, con uno solo il comando lo esegue, con più
  // d'uno chiede quale. Nel menu del riquadro sono una voce ciascuno, dopo
  // quella della finestra.
  registerShellCommand({
    id: "shell.doc.export",
    title: "commands.doc.export",
    description: "commands.doc.export.desc",
    layer: "document",
    available: () => offeredExports(panes.get(layout.focus)).length > 0,
    run: () => void chooseExport(layout.focus),
  });
  registerShellCommand({
    id: "shell.doc.export_pdf",
    title: "commands.doc.export_pdf",
    description: "commands.doc.export_pdf.desc",
    layer: "document",
    available: () => {
      const pane = panes.get(layout.focus);
      return pane?.shown?.k === "doc" && exportableNote(pane.surface);
    },
    run: () => {
      const pane = panes.get(layout.focus);
      if (pane?.shown?.k === "doc" && exportableNote(pane.surface)) void presentExport(pane, pane.shown.doc);
    },
  });
  registerShellCommand({
    id: "shell.doc.copy_anchor_link",
    title: "commands.doc.copy_anchor_link",
    description: "commands.doc.copy_anchor_link.desc",
    layer: "document",
    available: () => focusedAnchorSurface() !== null,
    run: () => void copyAnchorLink(),
  });
  registerShellCommand({
    id: "shell.doc.save",
    title: "commands.doc.save",
    description: "commands.doc.save.desc",
    layer: "document",
    run: () => void saveNow(),
  });
  registerShellCommand({
    id: "shell.tab.reopen",
    title: "commands.tab.reopen",
    description: "commands.tab.reopen.desc",
    layer: "global",
    run: () => {
      if (reopenClosedTab()) void focusShownAfter(synchronize());
    },
  });
  registerShellCommand({
    id: "shell.tab.next",
    title: "commands.tab.next",
    description: "commands.tab.next.desc",
    layer: "global",
    run: () => {
      if (cycleTab(layout.focus, 1)) void focusShownAfter(synchronize());
    },
  });
  registerShellCommand({
    id: "shell.tab.previous",
    title: "commands.tab.previous",
    description: "commands.tab.previous.desc",
    layer: "global",
    run: () => {
      if (cycleTab(layout.focus, -1)) void focusShownAfter(synchronize());
    },
  });
  for (const [id, step] of [["shell.tab.recent", 1], ["shell.tab.recent.back", -1]] as const) {
    registerShellCommand({
      id,
      title: step === 1 ? "commands.tab.recent" : "commands.tab.recent.back",
      description: step === 1 ? "commands.tab.recent.desc" : "commands.tab.recent.back.desc",
      layer: "global",
      run: () => stepRecentTab(step),
    });
  }
  for (const [id, action, title, description] of [
    ["shell.fold.all", "text.fold.all", "commands.fold.all", "commands.fold.all.desc"],
    ["shell.unfold.all", "text.unfold.all", "commands.unfold.all", "commands.unfold.all.desc"],
    ["shell.fold.more", "text.fold.more", "commands.fold.more", "commands.fold.more.desc"],
    ["shell.fold.less", "text.fold.less", "commands.fold.less", "commands.fold.less.desc"],
    ["shell.fold.properties", "text.fold.properties", "commands.fold.properties", "commands.fold.properties.desc"],
  ] as const) {
    registerShellCommand({
      id,
      title,
      description,
      layer: "global",
      available: () => editorActionReady(action),
      run: () => void runEditorAction(action),
    });
  }
  for (const position of [1, 2, 3, 4, 5, 6, 7, 8, "last"] as const) {
    registerShellCommand({
      id: `shell.tab.go.${position}`,
      title: `commands.tab.go.${position}`,
      description: `commands.tab.go.${position}.desc`,
      layer: "global",
      run: () => {
        if (goToTab(layout.focus, position === "last" ? "last" : position - 1)) void focusShownAfter(synchronize());
      },
    });
  }
  registerShellCommand({
    id: "shell.pane.split.right",
    title: "commands.pane.split.right",
    description: "commands.pane.split.right.desc",
    layer: "pane",
    run: () => splitPane("row"),
  });
  registerShellCommand({
    id: "shell.pane.split.down",
    title: "commands.pane.split.down",
    description: "commands.pane.split.down.desc",
    layer: "pane",
    run: () => splitPane("col"),
  });
  registerShellCommand({
    id: "shell.pane.close",
    title: "commands.pane.close",
    description: "commands.pane.close.desc",
    layer: "pane",
    run: () => void closeCurrentPane(),
  });
  registerShellCommand({
    id: "shell.tab.close",
    title: "commands.tab.close",
    description: "commands.tab.close.desc",
    layer: "document",
    run: () => void closeCurrentTab(),
  });
  // Le due vie d'uscita da un conflitto (§18.1), e sono comandi e non un
  // dialogo per la ragione della 0088: la decisione è dell'utente, e un modale
  // che scatta durante un autosave con debounce la chiede in un momento che
  // l'utente non ha scelto. Il buffer sporco resta lì e aspetta, come una bozza
  // recuperata — e chi ha deciso lo dice quando ha deciso.
  registerShellCommand({
    id: "shell.doc.conflict.mine",
    title: "commands.doc.conflict.mine",
    description: "commands.doc.conflict.mine.desc",
    layer: "document",
    run: () => void resolveKeepingMine(activeDoc()),
  });
  registerShellCommand({
    id: "shell.doc.conflict.theirs",
    title: "commands.doc.conflict.theirs",
    // Dice se il testo resterà nella Cronologia come lo dice la conferma.
    description: () => discardDescription(activeDoc()),
    layer: "document",
    run: () => void resolveDiscardingMine(activeDoc()),
  });
  liveCommands = null;
}

/// La sessione live di un disegno (ADR 0205): i comandi pesano poco, la
/// sessione arriva quando si avvia. Sono dei disegni (`editors/spatial`), e
/// arrivano con un `import()` insieme al loro codice, la prima volta che un
/// disegno si apre: prima non servono, perché «Avvia» vuole un disegno a
/// fuoco e gli altri due una sessione, che nasce solo da lì.
let liveCommands: Promise<void> | null = null;

const LIVE_TARGETS: LiveCommandTargets = {
  focusedDoc: () => activeDoc(),
  focusedDrawing: () => {
    const pane = panes.get(layout.focus);
    return pane?.surface?.profile === VECTOR_PROFILE && pane.shown?.k === "doc" ? pane.shown.doc : null;
  },
};

export function loadLiveCommands(): Promise<void> {
  if (liveCommands) return liveCommands;
  const mine = import("../editors/spatial/live/commands").then(({ registerLiveCommands }) => {
    if (liveCommands === mine) registerLiveCommands(LIVE_TARGETS);
  });
  liveCommands = mine;
  return mine.catch((error: unknown) => {
    if (liveCommands === mine) liveCommands = null;
    console.error(error);
  });
}

/// Divide il riquadro col fuoco e ci porta dentro **lo stesso documento**.
///
/// È ciò che serve nove volte su dieci — la stessa nota di lato, in Lettura,
/// mentre si scrive — ed è anche il primo cliente vero della regola del buffer
/// unico: le due superfici mostrano lo stesso testo perché *è* lo stesso testo.
/// Un riquadro nuovo e vuoto lo si ottiene chiudendo la linguetta, che è un gesto in
/// meno di quello che servirebbe per il contrario. Il documento ci arriva sulla
/// sua superficie, senza la vista sorgente della scheda di partenza: il disegno
/// da una parte e il suo testo dall'altra è proprio la disposizione per cui si
/// divide.
function splitPane(dir: "row" | "col"): void {
  const toSplit = layout.focus;
  const current = activeDoc(toSplit);
  const newItem = split(toSplit, dir);
  if (!newItem) return;
  if (current) openIn(newItem, current);
  void focusShownAfter(synchronize());
}

async function closeCurrentPane(): Promise<void> {
  const origin = document.activeElement;
  const id = layout.focus;
  const tabs = paneState(id)?.tabs ?? [];
  if (!closePane(id)) return;
  // Il riquadro non c'è più: le sue linguette possono essere rimaste senza
  // nessuno che le guardi, e allora si smonta una view o si mette in salvo un buffer.
  for (const tab of tabs) {
    if (tab.k === "view") unmountViewFromPane(tab.view, id);
    else await dismissIfUnwatched(tab.doc);
  }
  await focusShownAfter(synchronize(), origin);
}

export async function closeCurrentTab(): Promise<void> {
  const origin = document.activeElement;
  const id = layout.focus;
  const p = activePane();
  const tab = activeTab(id);
  if (p.active < 0) return;
  closeTab(id, p.active);
  await releaseTab(id, tab);
  // Chi scriveva e chiude una nota che non si è potuta salvare se la ritrova
  // davanti («Tienila aperta», o un cambio da fuori): il fuoco torna nella
  // superficie della linguetta attiva di adesso, il testo col suo cursore.
  await focusShownAfter(synchronize(), origin);
}

/// Appunta o stacca la tab corrente (shell.tab.pin/unpin): stesso `run` di
/// contestuale, tastiera e palette, per la regola del §18.2.
export function pinCurrentTab(pinned: boolean): void {
  const id = layout.focus;
  const p = paneState(id);
  if (!p || p.active < 0) return;
  setPinnedTab(id, p.active, pinned);
  void synchronize();
}

/// La tab su cui agisce un comando di tab: quella col fuoco della tastiera, se
/// il fuoco è su una linguetta — le frecce della striscia la raggiungono senza
/// attivarla —, altrimenti l'attiva del riquadro col fuoco.
function commandTab(): { pane: string; index: number } | null {
  const focused = view.focusedTab();
  if (focused) return focused;
  const p = paneState(layout.focus);
  return p && p.active >= 0 ? { pane: layout.focus, index: p.active } : null;
}

/// Sposta la tab corrente di `delta` posizioni (shell.tab.move.left/right):
/// `-1` a sinistra, `+1` a destra. Fuori dai bordi = niente da fare.
export function moveCurrentTab(delta: -1 | 1): void {
  const at = commandTab();
  if (at && moveTab(at.pane, at.index, at.index + delta)) void synchronize();
}

/// Porta la tab corrente nel riquadro prima o dopo, in giro
/// (shell.tab.move.pane.previous/next). Un'appuntata resta dov'è: lo decide
/// `moveTabToPane`, come per il trascinamento e il contestuale.
export function moveCurrentTabToPane(delta: -1 | 1): void {
  const at = commandTab();
  if (!at) return;
  const order = layoutPanes();
  if (order.length < 2) return;
  const to = order[(order.indexOf(at.pane) + delta + order.length) % order.length]!;
  if (moveTabToPane(at.pane, at.index, to)) void synchronize();
}

/// Chiude le altre tab tenendo corrente + appuntate (shell.tab.close.others).
export function closeOtherTabs(): void {
  const id = layout.focus;
  const p = paneState(id);
  if (!p || p.active < 0) return;
  void closeOthersAndRelease(id, p.active);
}

/// Chiude le non appuntate del riquadro col fuoco (shell.tab.close.unpinned).
export function closeUnpinnedTabs(): void {
  void closeUnpinnedAndRelease(layout.focus);
}

/// Cronologia avanti/indietro del riquadro col fuoco (shell.pane.back/forward).
/// Prima chiede alla superficie del riquadro, che può avere una storia sua (i
/// salti della vista di una lavagna, T56); solo se lei dice `false` vale la
/// cronologia del riquadro.
export function paneBack(): void {
  if (panes.get(layout.focus)?.surface?.jumps?.back()) return;
  if (goBack(layout.focus)) void focusShownAfter(synchronize());
}

export function paneForward(): void {
  if (panes.get(layout.focus)?.surface?.jumps?.forward()) return;
  if (goForward(layout.focus)) void focusShownAfter(synchronize());
}

/// Collega o scollega il riquadro col fuoco (shell.pane.link/unlink): il
/// nome di default è `linked` — un gruppo solo, senza una seconda superficie
/// che deve restare d’accordo. Nome vuoto = scollegato.
export function linkCurrentPane(linked: boolean): void {
  setPaneLink(layout.focus, linked ? "linked" : null);
  void synchronize();
}

/// La Lettura accanto al testo (L03): il riquadro col fuoco resta nel modo in
/// cui si scrive (la Sorgente, se era in Lettura), quello nuovo a destra
/// mostra la Lettura dello stesso documento, e i due si collegano: scorrono
/// insieme (`linkScrolls`) e seguono le stesse aperture. Il collegamento è
/// quello che il riquadro aveva già, se ne aveva uno.
export async function showReadingBeside(): Promise<void> {
  const id = layout.focus;
  const r = panes.get(id);
  const doc = activeDoc(id);
  const surface = r?.surface;
  const reading = surface?.modes.find((mode) => mode.contextMode === "reading");
  const current = selectedMode(r);
  const writing = current && current.contextMode !== "reading"
    ? current
    : surface?.modes.find((mode) => mode.contextMode === "source") ?? surface?.modes.find((mode) => mode.contextMode !== "reading");
  if (!surface?.scrollLink || !doc || !reading || !writing) {
    notify(t("commands.pane.reading_beside.unavailable"), "info");
    return;
  }
  if (current?.id !== writing.id) await setMode(writing.id);
  const link = paneState(id)?.link ?? "linked";
  const added = split(id, "row");
  if (!added) return;
  setPaneMode(added, surface.family, reading.id);
  setPaneLink(id, link);
  setPaneLink(added, link);
  openIn(added, doc);
  focusPane(id);
  await synchronize();
  const point = surface.scrollLink.point();
  if (point) panes.get(added)?.surface?.scrollLink?.follow(point);
}

/// Gli ascolti che fanno scorrere insieme i riquadri collegati che mostrano
/// lo stesso documento: rifatti a ogni disegno, perché a ogni disegno possono
/// cambiare collegamenti, documenti e superfici. Il punto passa nelle
/// coordinate della sorgente, quindi Sorgente, Live e Lettura si seguono
/// anche con altezze diverse.
export let scrollLinks = openLifetime();

export function linkScrolls(): void {
  scrollLinks.close();
  const life = scrollLinks = openLifetime();
  const groups = new Map<string, SurfaceScrollLink[]>();
  for (const id of layoutPanes()) {
    const r = panes.get(id);
    const name = paneState(id)?.link;
    const link = r?.surface?.scrollLink;
    if (!name || !link || r?.shown?.k !== "doc") continue;
    const key = JSON.stringify([name, r.shown.doc]);
    groups.set(key, [...(groups.get(key) ?? []), link]);
  }
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    for (const member of members) {
      life.add(member.onScroll(() => {
        const point = member.point();
        if (!point) return;
        for (const other of members) if (other !== member) other.follow(point);
      }));
    }
  }
}
