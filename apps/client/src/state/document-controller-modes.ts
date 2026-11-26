// Il gestore del documento: le modalità, l'aspetto e il tema, il contesto
// della superficie col fuoco.

import {
  selectionSetOf,
  type SourceView,
  type SurfaceLocation,
  type SurfaceMode,
  type SurfaceAnchor,
  type SurfaceReference,
} from "../editors/core/registry";
import { modeById, modeForContext, readingToggleTarget } from "../editors/core/surface-modes";
import { pageName } from "../rules/organizer";
import { declaredFences } from "../rules/syntax";
import { lazyPart } from "../ui/lazy-part";
import { mountRenderedDocument } from "../editors/text/profiles/markdown/mount";
import { type Theme } from "../theme/theme";
import { contentLookPreference, markLook, resolveLook, type Look } from "../theme/content-look";
import { api } from "../host/ipc";
import { renderPrint, resolvedReference } from "../host/query";
import { type PaneMode, type ViewContext } from "../host/contract";
import { linkPreference, markdownDestination, wikiPathCandidates, type LinkFormat, type LinkPreference } from "./note-links";
import { emit } from "./store";
import { syntaxForms } from "../host/query";
import { documentSessions, flushPendingSave } from "./document-session";
import {
  openIn,
  split,
  activeDoc,
  focusPane,
  setMode as setPaneMode,
  setLook as setPaneLook,
  layout,
  pane as paneState,
  panes as layoutPanes,
  activateTab,
  sameOverride,
  tabOverride,
  activeTab,
  type Tab,
} from "./layout";
import { type CommandEntry } from "../ui/commands";
import { notify } from "../ui/notify";
import { applyIntent } from "../ui/intents";
import { slashContextDoc } from "./slash";
import { openSlashPalette } from "../ui/palette";
import type { SelectionBox } from "../editors/core/editor-actions";
import { errorText } from "../host/errors";
import { t } from "../i18n/strings";
import { writeClipboardText } from "../platform/clipboard";
import { Pane, panes, view } from "./document-controller-state";
import { notePeek, peekSurfaceIn, commandTarget, cardEditors, attachmentDeposit } from "./document-controller-ports";
import { synchronize } from "./document-controller-draw";
import { insertAttachmentLinks } from "./document-controller-surfaces";
import { openDocument } from "./document-controller-open";
import { showSourceView } from "./document-controller-save";

export let theme: Theme | null = null;

/// Pubblicazione del contesto: la selezione si muove a ogni tasto, il kernel
/// non deve saperlo a ogni tasto.
export let contextTimer: number | undefined;

/// Il contesto in attesa non si pubblica più (la shell si smonta).
export function cancelContextTimer(): void {
  window.clearTimeout(contextTimer);
  contextTimer = undefined;
}

/// La superficie del riquadro col fuoco (o della sua sbirciata) che sa dire
/// il punto sotto il cursore, col documento che mostra.
export function focusedAnchorSurface(): { doc: string; anchorHere: () => SurfaceAnchor | null } | null {
  const target = commandTarget();
  if (!target?.surface.anchorHere) return null;
  const surface = target.surface;
  return { doc: target.doc, anchorHere: () => surface.anchorHere?.() ?? null };
}

/// I comandi che la superficie del riquadro col fuoco aggiunge alla palette
/// (i comandi del foglio), come voci della palette: nessuna se il riquadro
/// non mostra un documento o la superficie non ne ha.
export function focusedSurfaceCommands(): CommandEntry[] {
  const surface = commandTarget()?.surface;
  if (!surface?.paletteCommands) return [];
  return surface.paletteCommands().map((command): CommandEntry => ({
    id: command.id,
    title: command.title,
    description: command.description,
    layer: "surface",
    binding: null,
    declared: null,
    spec: null,
    run: () => command.run(),
    group: command.group,
    unavailable: command.unavailable,
  }));
}

/// Ctrl+F fuori dal testo apre la stessa barra che apre dentro: quella della
/// superficie del riquadro col fuoco, se ne ha una nella modalità attuale.
export function findInFocusedSurface(): boolean {
  return commandTarget()?.surface.find?.() ?? false;
}

/// Ctrl+Z da un pannello del documento, col fuoco fuori dal foglio: un passo
/// della storia della superficie del riquadro col fuoco, senza spostare il
/// fuoco. `null` se lì non c'è una superficie con una storia da guidare
/// (`ui/off-sheet-keys.ts`).
export function focusedDocumentHistory(step: "undo" | "redo"): boolean | null {
  const surface = commandTarget()?.surface;
  return surface?.history ? surface.history(step) : null;
}

/// F6 dentro il riquadro col fuoco: la superficie passa alla sua zona seguente
/// (la barra, il foglio). `null` se non ha zone sue, `false` se in quel verso
/// sono finite.
export function stepSurfaceZone(step: 1 | -1): boolean | null {
  const surface = panes.get(layout.focus)?.surface;
  return surface?.zone ? surface.zone(step) : null;
}

/// «Copia il link a questo punto»: `[[Nota#Titolo]]` o `[[Nota#^id]]` negli
/// appunti, scritto come vuole il vault, come per una nota trascinata; a un
/// blocco senza id la superficie ne scrive uno. Negli appunti un link Markdown
/// non sa ancora dove andrà, quindi parte dalla radice del vault.
export async function copyAnchorLink(): Promise<void> {
  const focused = focusedAnchorSurface();
  if (!focused) return;
  const anchor = focused.anchorHere();
  if (!anchor) {
    notify(t("document.anchor_none"), "info");
    return;
  }
  const preference = await linkPreference();
  let link: string;
  if (preference.style === "markdown") {
    const point = anchor.kind === "block" ? `^${anchor.id}` : encodeURIComponent(anchor.text);
    const title = anchor.kind === "heading" ? anchor.text : pageName(focused.doc);
    link = `[${title.replace(/[[\]\\]/g, "\\$&")}](${markdownDestination("", focused.doc, "absolute")}#${point})`;
  } else {
    // I caratteri che un wikilink usa per sé non possono stare in un titolo
    // citato: chiuderebbero il link o ne aprirebbero un altro campo.
    const fragment = anchor.kind === "block" ? `^${anchor.id}` : anchor.text.replace(/[[\]|#^]/g, " ").replace(/\s+/g, " ").trim();
    link = `[[${await wikiTarget(focused.doc, preference.format)}#${fragment}]]`;
  }
  await writeClipboardText(link).then(
    () => notify(t("document.anchor_copied", { link }), "info"),
    () => notify(t("tabmenu.copy_failed"), "guasto"),
  );
}

/// «Copia il link» dall'albero: un link per ogni voce, scritto come vuole il
/// vault, uno per riga. Come per «Copia il link a questo punto», un link
/// Markdown negli appunti non sa dove andrà e parte dalla radice.
export async function copyNoteLinks(docs: readonly string[]): Promise<void> {
  if (docs.length === 0) return;
  const preference = await linkPreference();
  const links = await Promise.all(docs.map(async (doc) => preference.style === "markdown"
    ? `[${pageName(doc).replace(/[[\]\\]/g, "\\$&")}](${markdownDestination("", doc, "absolute")})`
    : `[[${await wikiTarget(doc, preference.format)}]]`));
  const text = links.join("\n");
  await writeClipboardText(text).then(
    () => notify(links.length === 1 ? t("document.anchor_copied", { link: text }) : t("explorer.links_copied", { count: String(links.length) }), "info"),
    () => notify(t("tabmenu.copy_failed"), "guasto"),
  );
}

/// Il riferimento più corto che porta davvero alla nota: il nome, poi il nome
/// con l'estensione, poi il percorso senza estensione, poi il percorso intero.
/// Lo decide la risoluzione del vault, non una regola copiata qui.
async function wikiReference(doc: string): Promise<string> {
  const fileName = doc.slice(doc.lastIndexOf("/") + 1);
  const withoutExtension = doc.replace(/\.[^./]+$/, "");
  return firstResolving(doc, [pageName(doc), fileName, withoutExtension]);
}

/// Il primo candidato che il vault risolve davvero a `doc`; altrimenti il
/// percorso intero, che è sempre una risposta.
async function firstResolving(doc: string, candidates: readonly string[]): Promise<string> {
  for (const candidate of candidates) {
    const resolved = await resolvedReference(
      { kind: "wiki", value: { page: candidate, heading: null, block: null } },
    ).catch(() => null);
    if (resolved?.doc === doc) return candidate;
  }
  return doc;
}

/// Il bersaglio di un wikilink secondo `files.link-format`: il nome più corto,
/// o il percorso dalla radice (un wikilink non ha forma relativa).
function wikiTarget(doc: string, format: LinkFormat): Promise<string> {
  return format === "shortest" ? wikiReference(doc) : firstResolving(doc, wikiPathCandidates(doc));
}

/// Il rimando a una nota scritto da dentro `from` come vuole il vault.
export async function noteReference(from: string, doc: string, preference: LinkPreference): Promise<SurfaceReference> {
  if (preference.style === "markdown") {
    return { kind: "note", name: pageName(doc), link: markdownDestination(from, doc, preference.format) };
  }
  return { kind: "note", name: await wikiTarget(doc, preference.format) };
}

/// Il modo effettivo è quello che il riquadro ricorda per la famiglia della
/// superficie, quando la superficie lo dichiara (anche come id di prima: un
/// riquadro salvato nei Blocchi si apre in Scrittura); altrimenti la sua
/// predefinita, o la prima che supporta. Il fallback non riscrive il layout:
/// tornando a quella famiglia, il riquadro ritrova la sua modalità.
export function selectedMode(r: Pane | undefined): SurfaceMode | undefined {
  if (!r?.surface) return undefined;
  const { family, modes, defaultMode } = r.surface;
  const requested = paneState(r.id)?.modes[family];
  return modeById(modes, requested)
    ?? modes.find((mode) => mode.id === defaultMode)
    ?? modes[0];
}

/// Scrive sulla radice del riquadro la modalità montata (`data-mode`), e sulla
/// regione del contenuto la classe del suo aspetto (`look-*`).
export function markMode(r: Pane, mode: string | null): void {
  if (mode === null) delete r.root.dataset.mode;
  else r.root.dataset.mode = mode;
  markLook(r.editorEl, selectedLook(r));
}

/// L'aspetto del contenuto che il riquadro mostra: la scelta del riquadro per
/// la famiglia, se la modalità montata la offre, altrimenti l'impostazione o il
/// predefinito della modalità (`content-look.ts`). `null` senza superficie.
export function selectedLook(r: Pane | undefined): Look | null {
  if (!r?.surface) return null;
  const shown = r.root.dataset.mode;
  const mode = r.surface.modes.find((candidate) => candidate.id === shown) ?? selectedMode(r);
  const { preference, highContrast } = contentLookPreference();
  return resolveLook(mode?.looks, paneState(r.id)?.looks?.[r.surface.family], preference, highContrast);
}

/// Sceglie l'aspetto del contenuto nel riquadro col fuoco, per la famiglia
/// della sua superficie. Un aspetto che la modalità non offre non si prende.
export function setLook(next: Look): void {
  const r = panes.get(layout.focus);
  const mode = selectedMode(r);
  if (!r?.surface || !mode || !mode.looks.includes(next)) return;
  setPaneLook(layout.focus, r.surface.family, next);
  markLook(r.editorEl, selectedLook(r));
}

/// Ridice l'aspetto di ogni riquadro: l'impostazione o il contrasto sono
/// cambiati.
export function refreshLooks(): void {
  for (const r of panes.values()) markLook(r.editorEl, selectedLook(r));
}

/// Il contesto della modalità del riquadro col fuoco (sorgente, Live,
/// Lettura), se la sua superficie ne offre più d'uno: è ciò che il menu Vista
/// spunta.
export function focusedContextMode(): PaneMode | undefined {
  const r = panes.get(layout.focus);
  if ((r?.surface?.modes.length ?? 0) < 2) return undefined;
  return selectedMode(r)?.contextMode;
}

/// Le modalità della superficie del riquadro col fuoco; nessuna senza superficie.
export function focusedModes(): readonly SurfaceMode[] {
  return panes.get(layout.focus)?.surface?.modes ?? [];
}

/// Esegue un'azione dell'editor nella superficie del riquadro col fuoco: è
/// l'intento `fub.editor.action` di un comando invocato dalla palette o da una
/// scorciatoia. La barra non passa di qui: agisce sul proprio riquadro.
/// L'azione c'è nella superficie del riquadro col fuoco, e si può eseguire.
export function editorActionReady(action: string): boolean {
  const actions = commandTarget()?.surface.editorActions;
  return !!actions?.has(action) && actions.editable();
}

export function runEditorAction(action: string, params: Readonly<Record<string, unknown>> = {}): "done" | "nothing" | "unavailable" {
  const surface = commandTarget()?.surface;
  const actions = surface?.editorActions;
  if (!actions || !editorActionReady(action)) return "unavailable";
  if (!actions.run(action, params)) return "nothing";
  surface?.focus?.();
  return "done";
}

/// Il registratore, le slide e la stampa di un riquadro: arrivano con un
/// `import()`, fuori dal chunk che apre una nota. Il menu del riquadro, che
/// li offre, li chiede appena si apre (`loadPaneTools`).
const recorderPart = lazyPart(() => import("../editors/media/recorder-part"));
const slidesPart = lazyPart(() => import("../ui/slides"));
const printPart = lazyPart(() => import("../editors/media/print-view"));

/// Chiede il codice dei gesti del menu del riquadro: quando se ne sceglie
/// uno, c'è già.
export function loadPaneTools(): void {
  for (const part of [recorderPart, slidesPart, printPart]) void part.load().catch(() => {});
}

export async function toggleRecorder(r: Pane, doc: string): Promise<void> {
  if (r.disposeRecorder) {
    r.disposeRecorder();
    r.disposeRecorder = null;
    return;
  }
  const surface = r.surface;
  try {
    const [attachment, { createViewStateCrashDeposit, mountRecorderSurface }] = await Promise.all([attachmentDeposit(doc), recorderPart.load()]);
    if (r.surface !== surface || r.shown?.k !== "doc" || r.shown.doc !== doc) return;
    // Un secondo clic mentre il codice arrivava ha già aperto il registratore.
    if (r.disposeRecorder) return;
    r.disposeRecorder = mountRecorderSurface(view.recorderHost(r), {
      staging: createViewStateCrashDeposit({ get: (key) => api.viewState(key), set: api.setViewState }),
      attachment,
      onEmbed: (link) => {
        if (r.surface !== surface) throw new Error(t("errors.document.editor_closed"));
        insertAttachmentLinks(r, doc, [link]);
      },
    });
  } catch (error) {
    notify(t("document.recorder_unavailable", { reason: errorText(error) }), "guasto");
  }
}

/// Le slide spezzano la resa di presentazione che la superficie monta: cosa
/// sia quella resa lo sa la superficie, non il riquadro.
export function presentSlides(r: Pane, doc: string): void {
  const surface = r.surface;
  if (r.shown?.k !== "doc" || r.shown.doc !== doc || !surface?.mountPresentation) return;
  // Se il codice delle slide non è ancora arrivato, partono appena arriva,
  // purché il riquadro mostri ancora la stessa nota.
  slidesPart.run(({ mountSlidePresentation }) => {
    if (r.surface !== surface || r.shown?.k !== "doc" || r.shown.doc !== doc || !surface.mountPresentation) return;
    showSlides(r, surface, mountSlidePresentation);
  });
}

function showSlides(r: Pane, surface: NonNullable<Pane["surface"]>, mountSlidePresentation: typeof import("../ui/slides").mountSlidePresentation): void {
  if (!surface.mountPresentation) return;
  r.disposeSlides?.();
  const content = document.createElement("div");
  let contentStop: (() => void) | null = null;
  try {
    contentStop = surface.mountPresentation(content);
    const deck = mountSlidePresentation(document.body, content, {
      onClose: () => { contentStop?.(); contentStop = null; r.disposeSlides = null; },
    });
    r.disposeSlides = () => { deck.destroy(); contentStop?.(); contentStop = null; };
  } catch (error) {
    contentStop?.();
    notify(t("document.slides_unavailable", { reason: errorText(error) }), "guasto");
  }
}

export async function presentPrint(r: Pane, doc: string): Promise<void> {
  try {
    // La resa di stampa il kernel la legge dal disco: ciò che il buffer ha e
    // il disco non ancora ci arriva prima.
    await documentSessions.flush(doc);
    // La resa dell'host non marca i recinti che il vault dichiara: senza,
    // un diagramma si stamperebbe come codice.
    const declared = await syntaxForms(doc).then(
      (forms) => new Set(declaredFences(forms).map((info) => info.toLowerCase())),
      () => new Set<string>(),
    );
    const { printDocument } = await printPart.load();
    const stop = await printDocument(doc, pageName(doc), renderPrint, (container, rendered) =>
      mountRenderedDocument(container, rendered, { documentId: doc, declaredFences: declared, diagramAppearance: "light" }));
    if (r.shown?.k !== "doc" || r.shown.doc !== doc) {
      stop();
      return;
    }
    r.disposePrint?.();
    r.disposePrint = stop;
  } catch (error) {
    notify(t("document.print_unavailable", { reason: errorText(error) }), "guasto");
  }
}

/// Presidio locale: nessun mode con id ignoto persiste oltre il riquadro (U24).
/// Ritorna true se il mode persistito era sconosciuto (conservato, non cancellato).
export function hasUnknownPersistedMode(paneId: string): boolean {
  const r = panes.get(paneId);
  const modes = r?.surface?.modes ?? [];
  if (!r?.surface || modes.length === 0) return false;
  const requested = paneState(paneId)?.modes[r.surface.family];
  return requested !== undefined && !modes.some((mode) => mode.id === requested);
}

// --- contesto di sessione (decisione 0007) ----------------------------------
//
// La shell è l'unica a sapere quale riquadro ha il focus, che nota mostra, cosa
// c'è selezionato e in che modalità; il kernel lo custodisce e lo serve alle
// view via `HostApi::active_context`. Qui si decide solo *quando* pubblicarlo:
// **chi** ridisegnare lo dice il kernel, che conosce le `follows` di ogni view.
//
// Con N riquadri niente cambia di là dal confine, e questa è metà della
// decisione 0078: `ViewContext` porta un `pane` **dal primo giorno**, e il
// kernel custodisce «il contesto del riquadro col fuoco, e nient'altro». La
// domanda a cui risponde — cosa sta guardando l'utente adesso — è una sola per
// definizione, quanti che siano i riquadri.

/// Il contesto del riquadro col fuoco così com'è adesso.
///
/// Lo `span` della selezione c'è solo a buffer pulito: a buffer sporco gli
/// offset dell'editor sono di un testo che il kernel non ha, e uno span
/// mentitore farebbe tagliare i byte sbagliati a chiunque lo usi. Il testo
/// invece è sempre quello vero — ed è ciò che serve a contare le parole
/// selezionate o a mandarle a un comando.
function paneContext(): ViewContext {
  // La sbirciata che ha la scrittura è il documento dei comandi: le sue
  // selezioni, la sua nota.
  const peek = peekSurfaceIn(layout.focus);
  const peekDoc = peek ? notePeek?.shown()?.doc ?? null : null;
  if (peek && peekDoc) {
    const dirty = documentSessions.isDirty(peekDoc);
    return { pane: layout.focus, doc: peekDoc, selections: selectionSetOf(peek, dirty), mode: "live_preview" };
  }
  const doc = activeDoc();
  const r = panes.get(layout.focus);
  const mode = selectedMode(r);
  // Senza superficie (riquadro vuoto, view dichiarata) non c'è una modalità da
  // proiettare: vale la predefinita del contratto.
  const contextMode: PaneMode = mode?.contextMode ?? "live_preview";
  const editing = doc !== null && mode?.presentation !== "rendered";
  const dirty = doc ? documentSessions.isDirty(doc) : false;
  const selections = editing ? selectionSetOf(r?.surface ?? undefined, dirty) : null;
  return { pane: layout.focus, doc, selections, mode: contextMode };
}

/// Pubblica il contesto e annuncia **quali** view il kernel ha dichiarato
/// invecchiate. Chi le ridisegna è l'host dei pannelli (`ui/panel-host.ts`): il
/// verso passa dal bus e non da una chiamata, perché la catena che le monta
/// dipende già da questo modulo.
/// Esegue un comando del «/» scelto fuori dalla palette (il «/» nel testo,
/// «Comandi ▸» del tasto destro), per la stessa via della palette: il modulo
/// e il piano accanto ad `anchor`, il flush prima di scrivere, il contesto
/// pubblicato. Vale finché il documento del gesto resta quello a fuoco.
export function runSlashCommand(owner: HTMLElement, command: string, selection: string, anchor: SelectionBox | null): void {
  const doc = slashContextDoc();
  void openSlashPalette(
    owner,
    selection,
    () => owner.isConnected && slashContextDoc() === doc,
    { onEffect: applyIntent, notify, flushPendingSave, publishContext },
    undefined,
    anchor,
    command,
  );
}

export async function publishContext(): Promise<void> {
  window.clearTimeout(contextTimer);
  try {
    emit("stale-views", await api.setActiveContext(paneContext()));
  } catch (e) {
    // Un vault non ancora aperto non ha un workspace: il contesto non ha dove
    // andare, e non è un errore da mostrare.
    console.debug(`Fub: contesto non pubblicato: ${errorText(e)}`);
  }
}

/// Il cursore si muove a ogni tasto; il kernel non deve saperlo a ogni tasto.
export function scheduleContext(): void {
  window.clearTimeout(contextTimer);
  contextTimer = window.setTimeout(() => void publishContext(), 150);
}

/// Cambia la modalità del riquadro col fuoco (FEATURES 4.1) e la pubblica.
///
/// In lettura l'editor lascia il posto al documento **reso**: è la stessa cosa
/// che l'anteprima mostrava di lato, ma non è più un pannello sempre acceso
/// accanto all'editor — le tre modalità sono esclusive, e due superfici sullo
/// stesso documento sono due verità da tenere allineate.
///
/// Che sia **del riquadro** e non della finestra è la parte nuova, ed è ciò che
/// rende utile la divisione: la nota di lato in Lettura mentre si scrive è la
/// disposizione per cui si divide, e con una modalità globale non esisterebbe.
/// L'ultima modalità di scrittura di ogni riquadro, per famiglia di superfici,
/// per tornare dalla Lettura: come `PaneState.modes`, un id vale dentro la sua
/// famiglia, e il «source» del testo non è quello della tela. Vive quanto il
/// riquadro (`buildStructure` la toglie con lui).
export const writingModes = new Map<string, Map<string, string>>();

/// `Mod-e`: dalla scrittura alla prima lettura che la superficie dichiara,
/// dalla lettura alla scrittura di prima (`readingToggleTarget`).
export async function toggleReading(): Promise<void> {
  const r = panes.get(layout.focus);
  if (!r?.surface) return;
  const { family, modes, defaultMode } = r.surface;
  const target = readingToggleTarget(modes, selectedMode(r)?.id, writingModes.get(r.id)?.get(family), defaultMode);
  if (target) await setMode(target.id);
}

/// `shell.mode.live` e `shell.mode.source`: la modalità della superficie col
/// fuoco che ha quel ruolo, qualunque sia il suo id.
export async function setContextMode(context: PaneMode): Promise<void> {
  const r = panes.get(layout.focus);
  if (!r?.surface) return;
  const target = modeForContext(r.surface.modes, selectedMode(r)?.id, context);
  if (target) await setMode(target.id);
}

/// La vista sorgente che «Apri come sorgente» aprirebbe adesso nel riquadro:
/// la sua scheda attiva è il documento che mostra, non ne ha già scelta una,
/// e la superficie del documento ne dichiara una che si risolve.
export function offeredSourceView(r: Pane | undefined): SourceView | null {
  if (!r?.sourceView) return null;
  const tab = activeTab(r.id);
  if (tab?.k !== "doc" || tab.override || r.shown?.k !== "doc" || r.shown.doc !== tab.doc) return null;
  return r.sourceView;
}

export async function openSourceView(): Promise<void> {
  const view = offeredSourceView(panes.get(layout.focus));
  if (view) await showSourceView(layout.focus, view);
}

export async function closeSourceView(): Promise<void> {
  if (tabOverride(activeTab()) !== null) await showSourceView(layout.focus, null);
}

/// «Apri come sorgente accanto»: la vista sorgente della scheda attiva di un
/// riquadro, in un riquadro nuovo alla sua destra, sullo stesso documento e
/// sulla stessa sessione. La superficie resta dov'è e il testo le sta accanto,
/// nella modalità che lo mostra senza resa, perché la resa è già lì. Il fuoco
/// va sul testo, come dopo una divisione.
///
/// Se un altro riquadro ha già quella vista dello stesso documento si va lì,
/// invece di aprirne una seconda: chi ripete il gesto vuole il testo accanto,
/// non un terzo riquadro.
export async function openSourceViewBeside(id: string): Promise<void> {
  const view = offeredSourceView(panes.get(id));
  const doc = activeDoc(id);
  if (!view || !doc) return;
  const there = sourceTabElsewhere(id, doc, view);
  if (there) {
    activateTab(there.pane, there.index);
    await showSourceView(there.pane, view);
    return;
  }
  const added = split(id, "row");
  if (!added) return;
  openIn(added, doc);
  await showSourceView(added, view, "source");
}

/// La linguetta di un riquadro diverso da `id` che mostra `doc` nella vista
/// `view`: quella attiva, se c'è, altrimenti la prima.
function sourceTabElsewhere(id: string, doc: string, view: SourceView): { pane: string; index: number } | null {
  const shows = (tab: Tab): boolean => tab.k === "doc" && tab.doc === doc && sameOverride(tabOverride(tab), view);
  let first: { pane: string; index: number } | null = null;
  for (const other of layoutPanes()) {
    const p = paneState(other);
    if (other === id || !p) continue;
    if (p.active >= 0 && p.active < p.tabs.length && shows(p.tabs[p.active]!)) return { pane: other, index: p.active };
    const index = p.tabs.findIndex(shows);
    if (index >= 0) first ??= { pane: other, index };
  }
  return first;
}

export async function setMode(next: string): Promise<void> {
  const r = panes.get(layout.focus);
  const mode = r?.surface ? modeById(r.surface.modes, next) : undefined;
  if (!r?.surface || !mode) return;
  const doc = activeDoc();
  // Nessun salvataggio per cambiare modo: la lettura si monta dal buffer
  // corrente, e il cambio è immediato anche con modifiche non salvate.
  const previous = selectedMode(r);
  if (mode.contextMode === "reading" && previous && previous.contextMode !== "reading") {
    const remembered = writingModes.get(layout.focus) ?? new Map<string, string>();
    remembered.set(r.surface.family, previous.id);
    writingModes.set(layout.focus, remembered);
  }
  setPaneMode(layout.focus, r.surface.family, mode.id);
  markMode(r, mode.id);
  r.surface.setMode(mode.id);
  if (mode.presentation !== "rendered") r.surface.focus?.();
  view.drawToolbar(r);
  view.drawConflict(r, doc);
  await publishContext();
}

/// Porta a schermo un punto di un documento, nel riquadro che lo mostra.
///
/// Il riquadro è quello col fuoco se il documento è la sua tab attiva, poi il
/// primo altro che lo mostra — e prende il fuoco; altrimenti il documento si
/// apre nel riquadro col fuoco. Il punto si porta soltanto lì: mai in un
/// riquadro che mostra un altro documento, dove lo stesso offset nominerebbe
/// un altro testo. Cosa voglia dire «portarci» lo decide la superficie — il
/// cursore nel testo, la carta nella tela — e una che non ci arriva lo dice,
/// invece di lasciare il gesto senza risposta.
export async function reveal(doc: string, location: SurfaceLocation): Promise<void> {
  const showing = [layout.focus, ...layoutPanes()].find((id) => activeDoc(id) === doc);
  if (showing === undefined) {
    await openDocument(doc);
  } else if (showing !== layout.focus) {
    focusPane(showing);
    await synchronize();
    await publishContext();
  }
  const r = panes.get(layout.focus);
  // Un'apertura fallita o superata da un'altra lascia a fuoco un altro
  // documento, o nessuno: il punto non è di quel testo.
  if (activeDoc() !== doc || r?.shown?.k !== "doc" || r.shown.doc !== doc || !r.surface) return;
  if (!r.surface.reveal?.(location)) {
    notify(t("document.reveal_unavailable", { doc: pageName(doc) }), "info");
  }
}

export function focusEditor(): void {
  panes.get(layout.focus)?.surface?.focus?.();
}

/// Porta gli editor nell'altra luce (§12.4).
///
/// Passa da qui e non da `theme/theme.ts` perché gli editor sono di questo
/// modulo: il modulo del tema non li conosce, e non deve — sa solo che
/// *qualcuno* vuole essere avvisato. La luce si ricorda anche per i riquadri che
/// non esistono ancora: uno nato dopo il cambio deve nascere già nella luce
/// giusta, non correggersi al prossimo.
export function setEditorTheme(t: Theme): void {
  theme = t;
  // U26: solo `setTheme` sulla superficie viva, mai `setDoc`/rimonto:
  // selezione, scroll e history restano dove sono.
  for (const r of panes.values()) r.surface?.setTheme?.(t);
  cardEditors.setTheme(t);
}
