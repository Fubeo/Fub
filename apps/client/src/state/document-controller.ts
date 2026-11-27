// I riquadri dell'area principale: editor, linguette, modalità e contesto.
//
// La sessione di un documento non è una superficie. `state/document-session.ts`
// possiede il testo autorevole, la base della scrittura, il dirty, la coda, i
// debounce e il lifecycle; questo modulo possiede soltanto ciò che è a schermo.
// Due riquadri possono quindi mostrare la stessa sessione senza duplicare testo
// o salvataggi, mentre ciascun editor conserva la propria history.
//
// Qui restano:
//   - layout, tab, focus, modalità e struttura DOM;
//   - il collegamento tra editor e sessione, inclusa la validazione delle
//     operazioni stantie;
//   - il disegno delle superfici e la pubblicazione del contesto.
//
// Il documento vive nella sessione finché il servizio lo tiene aperto. Quando
// l'ultima linguetta lo lascia, il servizio esegue il flush e chiude la sessione.
//
// La superficie pubblica di questo modulo continua a rispondere alle domande
// della shell — «apri», «è aperto», «chiudi», «metti in salvo» — senza esporre
// lo stato mutabile della sessione ai suoi clienti.
//
// Da quando le shell sono due, questo file è il **controller** dei riquadri:
// non crea e non disegna la loro cornice. Linguette, barre, banner e l'albero
// dei contenitori li disegna una vista, che arriva al montaggio e a cui si
// parla soltanto attraverso `PaneView`, dichiarata qui sotto. Della cornice
// restano qui i tre elementi che la vista consegna quando un riquadro nasce —
// la radice, il contenitore dell'editor e quello delle view — e nessuna classe,
// nessun selettore. La vista della shell di oggi è `panels/document.ts`.

import { createDocumentSurfaceRegistry } from "../editors/core/bootstrap";
import { mountComponents, onComponents } from "./components";
import { cachedGridSurfaces } from "./grid-surfaces";
import { offerDropTargets } from "../editors/core/registry";
import { pageName } from "../rules/organizer";
import { openResourcePort } from "../editors/media/resource-port";
import { vaultImageSource } from "../editors/text/profiles/markdown/media";
import { renderMarkdown } from "../editors/text/profiles/markdown/render";
import { mountMarkdown } from "../editors/text/profiles/markdown/mount";
import { openWebPage } from "../ui/web-viewer";
import { invalidateDocumentCaches, renameInDocumentCaches } from "./document-caches";
import { newSubpage, renamePage } from "./page-rename";
import { moveBlock, moveHeadings, moveNotes } from "./move-block";
import { tableToSheet } from "./table-sheet";
import { syncBlockPort } from "./sync-block";
import { boardBlockPort } from "./board-from-note";
import { vaultBlockPort } from "./vault-blocks";
import { linkedPageIcon } from "./page-icons";
import { createPerson, isPersonTarget, peopleFolder, searchPeople } from "./people";
import { dailyDate, dailyPath, firstWeekday } from "./dates";
import { linkCardView, requestLinkCard } from "./link-cards";
import { holdNoteCard, mountNoteCards, noteCardView, watchNoteCards } from "./note-cards";
import { themeSeries } from "../theme/theme";
import { api } from "../host/ipc";
import { WITHOUT_PAGE, existingDocuments, notesByName, renderPrint, resolvedReference, settings, vaultEntries, vaultTags } from "../host/query";
import { existingRecentNotes } from "./recent";
import { onEvent } from "./kernel";
import { drawingFonts } from "./drawing-fonts";
import { emit, on, readState, state, writeState } from "./store";
import { depositCanvasFiles, resolveCanvasPaths } from "./canvas-intake";
import { LAVAGNA_BUNDLE, preferencesOf } from "../rules/canvas-settings";
import { revealSetting } from "../panels/settings";
import { clearSheetNotices, moveSheetNotices, setRemovedNotice } from "./sheet-notices";
import { noteProperties } from "../host/query";
import type { Origin } from "../host/contract";
import { documentSessions, flushPendingSave } from "./document-session";
import { keepsDiscardedText } from "./conflict-keep";
import { setDocumentWindowKeeper, setDocumentWindowNavigation } from "./document-bridge";
import {
  activeDoc,
  documents,
  focusPane,
  layout,
  pane as paneState,
  panesWithDoc,
  panes as layoutPanes,
  rename,
  removeEverywhere,
} from "./layout";
import { handToSystem, loadCommandSpecs, openVaultRoot } from "./vault";
import { lendHeld, renameLend } from "./lend";
import { EXPORT_COMMAND } from "../ui/shell-ids.generated";
import { trashWithConfirm } from "../panels/trash";
import { nameJob } from "../panels/activity";
import { notify } from "../ui/notify";
import { applyIntent } from "../ui/intents";
import { slashContextDoc } from "./slash";
import { favoriteCommands, openSlashPalette, recentCommands, rememberCommand, toggleFavorite } from "../ui/palette";
import { slashCatalog, slashMenuEntries, type SlashUse } from "../panels/slash/entries";
import { hideSlashEntry, slashPrefs } from "../panels/slash/prefs";
import type * as SlashPanelModule from "../panels/slash/panel";
import { noteTargets } from "../editors/text/profiles/markdown/kinds";
import { unmountViewFromPane } from "../ui/views";
import { errorText } from "../host/errors";
import { writeChrome } from "./machine-chrome";
import { onLanguage, t } from "../i18n/strings";
import { type Lifetime } from "../ui/lifetime";

// Il pannello del «/», coi passi e l'anteprima, è un chunk suo: si chiede
// quando si monta il controllore dei documenti, e finché non c'è il «/»
// resta testo.
let slashPanelModule: typeof SlashPanelModule | null = null;
let slashPanelLoading: Promise<void> | null = null;
function slashPanelReady(): boolean {
  slashPanelLoading ??= import("../panels/slash/panel").then(
    (module) => void (slashPanelModule = module),
    (error: unknown) => {
      slashPanelLoading = null;
      console.warn("Fub: il pannello del «/» non si carica.", error);
    },
  );
  return slashPanelModule !== null;
}
import { writeClipboardText } from "../platform/clipboard";
import {
  DocumentDeps,
  PaneView,
  panes,
  sessionEventsStop,
  deps,
  view,
  bindController,
  setSurfaceRegistry,
  setSessionEventsStop,
} from "./document-controller-state";
import {
  canvasNotes,
  pickCanvasFile,
  pickDrawingLink,
  mediaTransport,
  canvasMarkdownMount,
  dismissNotePeek,
  peekSurfaceIn,
  linkClick,
  watchLinkClick,
  peekLink,
  cardEditors,
  canvasCards,
  pickDrawingImage,
  drawingImageId,
  attachmentDeposit,
  excludedFolders,
  importRemoteImage,
  droppedFiles,
  noteHeadings,
  noteBlocks,
  vaultHeadings,
} from "./document-controller-ports";
import { headlessExportPart, exportMountOf, printPdfPages, printVaultFonts, runExport } from "./document-controller-export";
import { endRecentRound, registerCommands, loadLiveCommands, scrollLinks } from "./document-controller-commands";
import { synchronize, enqueueDraw, render } from "./document-controller-draw";
import {
  refreshNoteClasses,
  commandsChanged,
  heldEditors,
  componentsChanged,
  followRemote,
  failSurface,
  detachSurface,
  destroySurface,
  sessionBase,
  followRenameInPanes,
  dropParked,
} from "./document-controller-surfaces";
import {
  invalidateLoads,
  openDocument,
  boardOffers,
  openDocumentBeside,
  openPathBeside,
  isOpen,
  mountDocumentLends,
  openWikilink,
  linkedPdfPage,
  openFigure,
} from "./document-controller-open";
import {
  cancelContextTimer,
  setLook,
  runSlashCommand,
  publishContext,
  scheduleContext,
  setMode,
  reveal,
} from "./document-controller-modes";
import {
  endCloseDraining,
  keepDiscardedText,
  withdrawUnsavedQuestion,
  keepOrDiscardUnsaved,
  paintedSessions,
  deniedSaves,
  withdrawStateNotices,
  moveStateNotices,
  withdrawAllStateNotices,
  syncBlindDraftNotice,
  handleSessionEvent,
  setReadOnlyForDocument,
  heldReadOnly,
  heldWhy,
  written,
  applyExternalChange,
  reloadDocument,
} from "./document-controller-save";
export { type DocumentDeps, type PaneElements, type PaneView, type FileOnly, type Pane, paneOf } from "./document-controller-state";
export {
  canvasFreeName,
  peekSurfaceIn,
  peekLink,
  peekDocument,
  notePeekState,
  sheetCellOf,
} from "./document-controller-ports";
export {
  presentExport,
  presentBookExport,
  offeredExports,
  exportWindow,
  chooseExport,
  runExport,
} from "./document-controller-export";
export {
  closeCurrentTab,
  pinCurrentTab,
  moveCurrentTab,
  moveCurrentTabToPane,
  closeOtherTabs,
  closeUnpinnedTabs,
  paneBack,
  paneForward,
  linkCurrentPane,
  showReadingBeside,
} from "./document-controller-commands";
export {
  describeTab,
  synchronize,
  resetDocumentsForVault,
  renderPane,
  closeTabAt,
  closeRightAndRelease,
  closeOthersAndRelease,
  closeUnpinnedAndRelease,
  closeAllAndRelease,
  nameTab,
  docTitle,
} from "./document-controller-draw";
export { canShowFile, showsFileBytes, textProfileFor, FILE_ONLY_FAMILY } from "./document-controller-surfaces";
export {
  type OpenOptions,
  openingsSoFar,
  openDocument,
  openFromView,
  type BesideOptions,
  openDocumentBeside,
  openPathBeside,
  closeDocument,
  isOpen,
  openWikilink,
  linkedPdfPage,
  openFigure,
} from "./document-controller-open";
export {
  focusedSurfaceCommands,
  findInFocusedSurface,
  focusedDocumentHistory,
  stepSurfaceZone,
  copyNoteLinks,
  selectedMode,
  selectedLook,
  setLook,
  refreshLooks,
  focusedContextMode,
  editorActionReady,
  runEditorAction,
  loadPaneTools,
  toggleRecorder,
  presentSlides,
  presentPrint,
  hasUnknownPersistedMode,
  runSlashCommand,
  publishContext,
  offeredSourceView,
  openSourceViewBeside,
  setMode,
  reveal,
  focusEditor,
  setEditorTheme,
} from "./document-controller-modes";
export {
  resolveKeepingMine,
  resolveDiscardingMine,
  releaseTab,
  freezeDocumentSurfaces,
  recoverDrafts,
  showSourceView,
} from "./document-controller-save";


/// Costruisce l'area principale e attacca i riquadri agli eventi che li
/// riguardano.
export function mountDocumentController(lifetime: Lifetime, d: DocumentDeps, paneView: PaneView): void {
  bindController(d, paneView);
  slashPanelReady();
  // Una finestra documento a parte non apre niente da sé: i link e i tag che
  // vi si cliccano tornano qui, dove ci sono i riquadri e la ricerca.
  setDocumentWindowNavigation({ navigate: followRemote });
  lifetime.add(() => setDocumentWindowNavigation(null));
  // Né può conservare da sé il testo che sta per scartare: lo conserva qui la
  // stessa regola di «Usa la versione su disco», e la finestra scarta soltanto
  // dopo la risposta.
  setDocumentWindowKeeper({
    keeps: keepsDiscardedText,
    keep: async (doc, text) => {
      await keepDiscardedText(doc, text);
      notify(t("document.conflict.kept", { doc: pageName(doc) }), "info");
    },
  });
  lifetime.add(() => setDocumentWindowKeeper(null));
  lifetime.add(() => scrollLinks.close());
  // Il giro di Ctrl+Tab finisce quando si lascia il modificatore.
  lifetime.listen(document, "keyup", (event) => {
    if (event.key === "Control" || event.key === "Meta") endRecentRound();
  });
  lifetime.add(() => {
    endRecentRound();
  });
  // Il contesto in attesa muore con la shell: un timer rimasto pubblicherebbe
  // dopo lo smontaggio, verso un host che non c'è più.
  lifetime.add(() => {
    cancelContextTimer();
  });
  // Gli editor dentro le schede muoiono con la shell, come i riquadri; la
  // sbirciata, che ne usa uno, prima di loro.
  lifetime.add(() => cardEditors.destroyAll());
  // La finestra che se ne va non fa domande: la bozza di un salvataggio
  // fallito resta, come per le schede (`destroyAll`).
  lifetime.add(() => {
    dismissNotePeek();
  });
  mountNoteCards(lifetime);
  watchLinkClick(lifetime);
 // L'esportazione chiesta da fuori (T79): finché la shell è aperta dice al
  // core che sa impaginare, e impagina fuori dallo schermo le note che un
  // agente chiede col comando `pdf.export_note`.
  let headlessGone = false;
  let stopHeadless: (() => void) | null = null;
  lifetime.add(() => {
    headlessGone = true;
    stopHeadless?.();
  });
  void headlessExportPart.load().then(({ LISTEN_COMMAND, startHeadlessExport }) => {
    if (headlessGone) return;
    stopHeadless = startHeadlessExport({
      render: renderPrint,
      mount: exportMountOf,
      save: async (doc) => {
        await documentSessions.flush(doc);
      },
      properties: (doc) => noteProperties(doc),
      title: pageName,
      invoke: (command, args, mode) => api.invokeCommand(command, args, mode),
      listen: (handler) => onEvent("custom", (event) => handler(event.topic, event.payload)),
      notify: (message, kind) => {
        notify(message, kind);
      },
      queued: (id, request) => nameJob(id, () => t("pdf_export.headless.job", { doc: pageName(request.note) })),
      fontFaces: () => [themeSeries().fonts],
      // Gli stessi caratteri del vault e gli stessi PDF incorporati dello
      // spazio: il PDF chiesto da fuori è quello che lo spazio esporterebbe.
      vaultFonts: printVaultFonts,
      pdf: printPdfPages,
      available: () => state.commandSpecs.some((spec) => spec.id === LISTEN_COMMAND),
      onAvailability: (changed) => on("commands", changed),
    });
  }, () => {
    // Senza il modulo la shell non dice al core che sa impaginare: il
    // comando risponde che serve l'app, come con la shell chiusa.
  });
  // Le lavagne aperte a lato sono bersagli di un blocco staccato dal testo
  // (T48, «Porta su una lavagna»).
  lifetime.add(offerDropTargets({ offers: boardOffers }));
 setSurfaceRegistry(createDocumentSurfaceRegistry({
    // Una superficie di scheda scrive dalla sua porta; le altre sono riquadri.
    onChange: (paneId, change, from) => {
      if (!cardEditors.written(paneId, change)) written(paneId, change, from);
    },
    onSelectionChange: (paneId) => {
      if (layout.focus === paneId || peekSurfaceIn(layout.focus)?.surfaceId === paneId) scheduleContext();
    },
    onFail: (paneId, error) => {
      if (cardEditors.failed(paneId, error)) return;
      const r = panes.get(paneId);
      if (r?.shown?.k === "doc") failSurface(r, r.shown.doc, error);
    },
    // Il clic su un link è un gesto: la scheda che nasce lo sa (T23).
    // Il nome si risolve dalla nota che contiene il link (una sbirciata, una
    // scheda della lavagna), non dal riquadro col fuoco.
    onOpenWikilink: (page, heading, block, from) =>
      openWikilink(page, heading ?? undefined, block ?? undefined, from, { gesture: true }),
    onPeekLink: (link, from) =>
      peekLink({ link, from }).catch((error: unknown) => {
        notify(errorText(error), "guasto");
      }),
    linkClick: () => linkClick,
    onOpenWikilinkBeside: async (page, heading, block, from) => {
      const target = await resolvedReference({ kind: "wiki", value: { page, heading, block } }, from ?? activeDoc() ?? undefined);
      if (!target) throw new Error(t("preview.target_missing"));
      const pdfPage = linkedPdfPage(target.doc, heading);
      await openDocumentBeside(target.doc, "row", pdfPage === null ? {} : { page: pdfPage });
      if (target.at) await reveal(target.doc, { span: target.at.span });
    },
    onShowFile: async (file, from, where) => {
      const id = file.kind === "vault" ? file.value : (await resolvedReference(
        file.kind === "wiki" ? { kind: "wiki", value: { page: file.value, heading: null, block: null } } : { kind: "path", value: file.value },
        from,
      ))?.doc;
      if (!id) throw new Error(t("preview.target_missing"));
      if (where === "app") await handToSystem(id, true);
      else emit("reveal-path", id);
    },
    onOpenDocument: (doc) => openDocument(doc),
    onOpenFigure: openFigure,
    onOpenPath: async (path, from) => {
      const target = await resolvedReference({ kind: "path", value: path }, from ?? activeDoc() ?? undefined);
      if (!target) throw new Error(t("preview.target_missing"));
      await openDocument(target.doc, { gesture: true });
      if (target.at) await reveal(target.doc, { span: target.at.span });
    },
    // Il menu di una scheda della lavagna (T17) e «Apri a lato per questo»
    // (T45): accanto, allo stesso punto.
    onOpenPathBeside: openPathBeside,
    // Un link di una scheda della lavagna (N6 T57) porta al file del vault che
    // risolve, come un link di una nota: `null` se non c'è (un link rotto). Chi
    // sceglie se la scheda è già sulla lavagna lo decide la tela.
    resolveCardLink: async (link, from) => {
      const target = await resolvedReference(
        link.kind === "wiki"
          ? { kind: "wiki", value: { page: link.page, heading: link.heading, block: link.block } }
          : { kind: "path", value: link.path },
        from ?? activeDoc() ?? undefined,
      );
      return target?.doc ?? null;
    },
    // «Sposta anche il file nel cestino»: lo stesso gesto dell'albero
    // (`note.trash`, la domanda del cestino di sistema, l'avviso con
    // «Annulla»). Se dopo il file c'è ancora, è rimasto: una domanda a cui si
    // è detto di no, o un gesto già in corso.
    onTrashPath: async (path) => {
      try {
        await trashWithConfirm(path);
      } catch (error) {
        throw new Error(errorText(error));
      }
      return !(await existingDocuments([path])).has(path);
    },
    onImportRemoteImage: importRemoteImage,
    canvasNotes,
    onPickCanvasFile: pickCanvasFile,
    onPickDrawingLink: pickDrawingLink,
    drawingImages: {
      url: async (path, from, owner) => {
        const id = await drawingImageId(path, from);
        return id === null ? null : vaultImageSource(id)(owner);
      },
      read: async (path, from, limit) => {
        const id = await drawingImageId(path, from);
        if (id === null) return null;
        const port = await openResourcePort(mediaTransport, id);
        try {
          if (limit !== undefined && port.descriptor.len > limit) return null;
          return new Blob([(await port.readAll()) as BlobPart], { type: port.descriptor.mime });
        } finally {
          await port.close();
        }
      },
      pick: () => pickDrawingImage(),
    },
    drawingFonts,
    withDrawings: loadLiveCommands,
    renderCanvasMarkdown: (_nodeId, text, host, documentId, forms) =>
      mountMarkdown(host, renderMarkdown(text, forms).html, canvasMarkdownMount(documentId)),
    canvasCards,
    canvasMedia: {
      openExternal: async () => { throw new Error(t("errors.document.no_external")); },
      // Il consenso, la barra e gli errori sono del visore della finestra.
      openViewer: async (url) => { await openWebPage(url); },
    },
    canvasAttachments: {
      expandFiles: droppedFiles,
      // Dall'albero: solo gli id che il vault conferma (G1).
      resolvePaths: (data) => resolveCanvasPaths(data, {
        existingDocuments,
        folderEntries: async (folder) => new Set((await vaultEntries(WITHOUT_PAGE, undefined, { path: folder, descendants: false })).items.map((entry) => entry.id)),
      }),
      // Dal computer: una copia sola per file, e lo stesso file si riusa (G2).
      // Il vault che ha già quei byte lo dice l'host (`reuse`), non il client.
      // La cartella la sceglie `canvas.drop_folder`, letta a ogni trascinamento.
      deposit: (files, documentId, cards) => depositCanvasFiles(files, documentId, {
        deposit: attachmentDeposit,
        dropFolder: async () => preferencesOf(await settings(LAVAGNA_BUNDLE)),
        excludedFolders,
        notify,
        readState,
        writeState,
        revealSetting,
      }, cards),
    },
    onSearchTag: (tag) => deps.searchTag(tag),
    onRenamePage: renamePage,
    onNewSubpage: newSubpage,
    moveBlock: { notes: moveNotes, headings: moveHeadings, move: moveBlock },
    tableSheet: { turn: tableToSheet },
    // La lavagna nuova si apre a lato, o nel vicino che la mostra già.
    boardBlock: boardBlockPort((doc) => openDocumentBeside(doc, "row", { reuse: true })),
    syncBlock: syncBlockPort,
    pageIcons: {
      icon: linkedPageIcon,
      isPerson: (page) => isPersonTarget(page),
      watch: (changed) => {
        const icons = on("page-icons", changed);
        const people = on("people", changed);
        return () => {
          icons();
          people();
        };
      },
    },
    linkCards: {
      view: linkCardView,
      request: requestLinkCard,
      // Il wikilink da solo in un paragrafo è la scheda della nota (T20).
      note: noteCardView,
      holdNote: holdNoteCard,
      watch: (changed) => {
        const web = on("link-cards", changed);
        const notes = watchNoteCards(changed);
        return () => {
          web();
          notes();
        };
      },
    },
    // La trasclusione viva (E14): le sessioni, la sola lettura e il conflitto
    // di un riquadro, come per una scheda della lavagna.
    transclusion: {
      sessions: documentSessions,
      held: heldReadOnly,
      heldWhy,
      shownInPane: isOpen,
      conflict: (box, path) => view.drawCardConflict(box, path),
      unsaved: (path) => keepOrDiscardUnsaved(path, layout.focus),
    },
    runShellCommand: (id) => deps.runCommand(id),
    ...(deps.openSettings ? { onOpenSettings: (key: string) => deps.openSettings?.(key) } : {}),
    requestMode: (paneId, mode) => {
      if (layout.focus !== paneId) focusPane(paneId);
      void setMode(mode);
    },
    requestLook: (paneId, look) => {
      if (layout.focus !== paneId) focusPane(paneId);
      setLook(look);
    },
    slash: {
      currentDoc: slashContextDoc,
      onEffect: applyIntent,
      notify,
      flushPendingSave,
      publishContext,
      menu: {
        enabled: () => slashPanelReady() && document.getElementById("app")?.dataset["slash"] !== "off",
        panel: (events, has, scope) => {
          const use = (): SlashUse => ({ recent: recentCommands(), favorites: favoriteCommands(), chord: () => null, today: new Date(), ...slashPrefs(), commands: scope?.commands ?? true });
          return slashPanelModule!.createSlashPanel(events, {
            entries: (query, place) => slashMenuEntries(state.commandSpecs, query, has, place, use()),
            favorite: (id) => favoriteCommands().includes(id),
            toggleFavorite,
            hide: (entry) => {
              hideSlashEntry(entry.id, writeChrome).then(
                () => notify(t("slash.panel.hidden", { label: entry.label }), "info"),
                (error: unknown) => notify(t("slash.panel.hide_failed", { label: entry.label, reason: errorText(error) }), "guasto"),
              );
            },
            today: () => new Date(),
            colors: () => {
              const { colors } = slashCatalog(state.commandSpecs, has, use());
              return {
                text: colors.filter((entry) => entry.id.startsWith("markdown.color.")),
                fill: colors.filter((entry) => entry.id.startsWith("markdown.background.")),
              };
            },
            notes: async (query) => noteTargets(await (query ? notesByName(query) : existingRecentNotes()).catch(() => [])),
            headings: (target) => noteHeadings(target).catch(() => []),
          });
        },
        chosen: (entry, owner, anchor, selection) => {
          rememberCommand(entry.id);
          if (!entry.action) runSlashCommand(owner, entry.id, selection ?? "", anchor);
        },
        palette: (query, owner, anchor) => {
          const doc = slashContextDoc();
          void openSlashPalette(
            owner,
            "",
            () => owner.isConnected && slashContextDoc() === doc,
            { onEffect: applyIntent, notify, flushPendingSave, publishContext },
            undefined,
            anchor,
            null,
            query,
          );
        },
      },
    },
    completions: {
      searchNotes: (prefix: string) =>
        (prefix.trim() ? notesByName(prefix) : existingRecentNotes()).catch(() => []),
      listTags: () => vaultTags(WITHOUT_PAGE).catch(() => []),
      headingsOf: (page: string) => noteHeadings(page).catch(() => []),
      searchHeadings: (text: string) => vaultHeadings(text).catch(() => []),
      blocksOf: (page: string) => noteBlocks(page).catch(() => []),
      vaultBlocks: vaultBlockPort,
      people: { folder: peopleFolder, search: searchPeople, create: createPerson },
      dates: { dailyPath, dailyDate, firstDay: firstWeekday },
    },
    gridHost: cachedGridSurfaces(api, lifetime),
    exportDocument: {
      available: () => state.commandSpecs.some((spec) => spec.id === EXPORT_COMMAND),
      run: (doc, chosen) => void runExport(doc, chosen),
    },
    documentBase: sessionBase,
    documentDiskRevision: (doc) => api.readDocument(doc, documentSessions.vaultFor(doc)).then((source) => source.revision),
    documentWriting: (doc) => documentSessions.writing(doc),
    documentWrites: { flush: flushPendingSave, expect: (doc) => documentSessions.expectWrite(doc) },
    media: {
      transport: mediaTransport,
      assetUrl: api.assetUrl,
      // «Apri con un'altra app» sull'immagine o sul PDF mostrato, come
      // nell'albero: l'app del sistema, e con un'app Craft il sottomenu.
      openExternal: (id) => handToSystem(id, true),
      copyText: writeClipboardText,
      // Il comando del kernel, come dalla palette: crea le annotazioni accanto
      // al PDF, o apre quelle che ci sono.
      annotate: {
        available: () => state.commandSpecs.some((spec) => spec.id === "pdf.annotate"),
        // L'elenco dei comandi arriva dopo le schede ripristinate all'avvio,
        // e cambia quando un componente si accende o si spegne.
        watch: (changed) => on("commands", changed),
        run: async (pdf) => {
          try {
            const outcome = await api.invokeCommand("pdf.annotate", { pdf }, "apply");
            if (outcome.notify) notify(outcome.notify, outcome.partial ? "guasto" : "info");
            await applyIntent(outcome.effect);
          } catch (error) {
            notify(errorText(error), "guasto");
          }
        },
      },
    },
  }));
  view.attach();
  // I componenti accesi (K2): la mappa del vault, e il registro, i riquadri
  // e i comandi dei disegni che la seguono.
  heldEditors.clear();
  mountComponents(lifetime);
  lifetime.add(onComponents((next) => {
    void enqueueDraw(async () => {
      await componentsChanged(next);
      await render();
    }).catch((error: unknown) => {
      notify(t("panes.redraw_failed", { reason: errorText(error) }), "guasto");
    });
  }));
  sessionEventsStop?.();
  paintedSessions.clear();
  deniedSaves.clear();
  withdrawAllStateNotices();
  const stopSessionEvents = documentSessions.subscribe(handleSessionEvent);
  setSessionEventsStop(stopSessionEvents);
  syncBlindDraftNotice();
  lifetime.add(() => {
    endCloseDraining();
    stopSessionEvents();
    paintedSessions.clear();
    deniedSaves.clear();
    withdrawAllStateNotices();
    if (sessionEventsStop === stopSessionEvents) setSessionEventsStop(undefined);
    for (const r of panes.values()) {
      if (r.shown?.k === "view") unmountViewFromPane(r.shown.view, r.id);
      detachSurface(r);
      destroySurface(r);
      dropParked(r);
      view.releaseFrame(r);
    }
  });


  // Il layout è cambiato — qualcuno ha diviso, chiuso, cambiato linguetta — e il DOM
  // lo insegue. Il verso passa dal bus e non da una chiamata perché chi muta il
  // layout è anche il pannello delle impostazioni, la palette, un comando: tutti
  // punti che non devono conoscere questo modulo.
  // Un disegno che va storto si **dice**, e non alla console: dei riquadri che
  // non si ridisegnano l'utente si accorge comunque — sono metà della finestra —
  // e non avere dove leggerne la causa è l'esito buttato via del §20.3. Il
  // centro notifiche è la superficie che il §20.4 chiedeva e che dal §10.3 c'è.
  // La coda intanto si riprende al giro dopo (la coda dei disegni).
  lifetime.add(
    on("layout", () => {
      void synchronize().catch((e) => {
        notify(t("panes.redraw_failed", { reason: errorText(e) }), "guasto");
      });
    }),
  );
  mountDocumentLends(lifetime);
  lifetime.add(on("commands", commandsChanged));
  for (const event of ["index_updated", "batch_ended"] as const) {
    lifetime.add(onEvent(event, () => {
      for (const r of panes.values()) {
        if (r.shown?.k === "doc") refreshNoteClasses(r, r.shown.doc);
      }
    }));
  }

  // Un file che nessun formato serve — un `.svg`, un `.txt` aperto come
  // testo — non manda `document_*` ma `entry_*` (vedi `KernelEvent`): per chi
  // lo tiene aperto sono gli stessi tre fatti, e passano dalla stessa via. Per
  // un'immagine aperta nel visualizzatore la sessione non c'è, e resta il
  // riquadro: segue la rinomina e si chiude se il file sparisce.
  const changed = (id: string, origin: Origin): void => {
    void documentSessions.handleExternalChange(id, origin).then((outcome) => {
      void applyExternalChange(id, outcome);
    });
  };
  // `recreate` riceve il vault **in cui la rimozione è stata vista**: l'utente
  // può cliccare «ricrea» dopo aver aperto un altro vault, e la nota deve
  // tornare dove è sparita, non in un omonimo del vault nuovo (FUB-001).
  const removed = (id: string, write: (text: string, vault: string | undefined) => Promise<unknown>): void => {
    const vault = openVaultRoot();
    // Riscritto il file, la bozza che teneva lo stesso testo se ne va: alla
    // riapertura non resta un conflitto con un disco che le è uguale (IMP-047).
    // Una scrittura fallita la lascia, col testo ancora da recuperare.
    const recreate = async (text: string, at: string | undefined): Promise<void> => {
      await write(text, at);
      // La nota è tornata: uno scarto non riuscito non la fa sembrare persa,
      // e alla riapertura il confronto mostra due testi uguali.
      await documentSessions.discardRemovedDraft(id, at, text).catch((error: unknown) => console.error(error));
    };
    const shownIn = panesWithDoc(id);
    withdrawUnsavedQuestion(id, { kind: "removed" });
    const outcome = documentSessions.handleExternalRemoval(id);
    clearSheetNotices(id);
    // Il file non c'è più: ciò che si diceva sul suo salvataggio è passato, e
    // l'avviso della rimozione qui sotto prende il suo posto.
    withdrawStateNotices(id);
    invalidateDocumentCaches(id);
    invalidateLoads(id);
    if (outcome.dirty && outcome.text !== undefined) {
      const text = outcome.text;
      notify(t("document.deleted_dirty", { doc: pageName(id) }), "guasto", {
        label: t("document.recreate"),
        run: async () => {
          await recreate(text, vault);
          // Se nel frattempo si è aperto un altro vault, la nota è tornata nel
          // suo: aprire `id` qui aprirebbe un documento omonimo.
          if (openVaultRoot() === vault) await openDocument(id);
        },
      });
    }
    removeEverywhere(id);
    // La linguetta se n'è andata: l'avviso resta sul riquadro che la mostrava.
    const text = outcome.dirty ? outcome.text : undefined;
    for (const paneId of shownIn) {
      setRemovedNotice(paneId, text === undefined ? { doc: id } : { doc: id, recreate: async () => void (await recreate(text, vault)) });
      const r = panes.get(paneId);
      if (r) view.drawConflict(r, activeDoc(paneId));
    }
  };
  const renamed = (from: string, to: string): void => {
    const outcome = documentSessions.rename(from, to);
    // «Modifiche non salvate» su `from` non può più scartare né tenere quel
    // nome: si ritira, e la nota torna col nome che la sessione ha adesso.
    withdrawUnsavedQuestion(from, {
      kind: "reopen",
      doc: outcome.kind === "collision" ? from : to,
      conflict: false,
    });
    if (outcome.kind !== "collision") {
      // Le schede che scrivono nella nota tengono la sessione col nome nuovo
      // (anche se la rinomina l'ha già fatta la sessione, `already-renamed`).
      cardEditors.renamed();
      moveSheetNotices(from, to);
      // Gli avvisi a galla seguono la nota, col nome nuovo.
      moveStateNotices(from, to);
      renameInDocumentCaches(from, to);
      // Il prestito segue il file col nome nuovo, come le schede qui sotto.
      renameLend(from, to);
      // The layout still names the old path until `rename` below runs. Keep
      // those editors read-only across that tiny migration window.
      setReadOnlyForDocument(from, documentSessions.isDeletionPending(to) || lendHeld(to));
      // Prima del layout: il giro di disegno che `rename` annuncia trova le
      // superfici che reggono il nome nuovo già sulla scheda nuova, e non le
      // rimonta (fuoco, cursore, annulla e scorrimento restano).
      followRenameInPanes(from, to);
      rename(from, to);
    }
  };

  lifetime.add(onEvent("document_changed", (e, origin) => changed(e.id, origin)));
  lifetime.add(onEvent("entry_changed", (e, origin) => changed(e.id, origin)));
  lifetime.add(
    onEvent("document_removed", (e) =>
      removed(e.id, (text, vault) => api.writeDocument(e.id, text, { kind: "dictated" }, vault))),
  );
  // Ricreare un file senza formato è una creazione esclusiva a byte: se nel
  // frattempo qualcuno l'ha rifatto, la scrittura lo dice invece di coprirlo.
  lifetime.add(
    onEvent("entry_removed", (e) =>
      removed(e.id, (text, vault) => api.resourceWrite(e.id, new TextEncoder().encode(text), null, vault))),
  );
  lifetime.add(onEvent("document_renamed", (e) => renamed(e.from, e.to)));
  lifetime.add(onEvent("entry_renamed", (e) => renamed(e.from, e.to)));

  lifetime.add(
    onEvent("overflow", () => {
      // Eventi persi (coda troncata): ciò che deriviamo dagli eventi va
      // riconciliato da zero, non aggiornato.
      for (const id of openDocuments()) void reloadDocument(id);
    }),
  );

  // Le schede portano l'icona della pagina (K9): cambiata nell'indice, si
  // ridipingono.
  lifetime.add(on("page-icons", () => {
    for (const id of layoutPanes()) {
      const pane = panes.get(id);
      const current = paneState(id);
      if (pane && current) view.drawTabs(pane, current.tabs, current.active);
    }
  }));

  // Lo stato di salvataggio e le etichette delle modalità sono disegnati da
  // questo modulo, quindi seguono esplicitamente il cambio di lingua.
  lifetime.add(
    onLanguage(() => {
      view.drawSave();
      // I titoli dei comandi (e dei pulsanti della barra) li traduce il kernel
      // quando li elenca: si richiedono nella lingua nuova.
      void loadCommandSpecs().catch((error: unknown) => {
        notify(t("commands.list_failed", { reason: errorText(error) }), "guasto");
      });
      for (const pane of panes.values()) view.drawToolbar(pane);
      for (const id of layoutPanes()) {
        const pane = panes.get(id);
        const current = paneState(id);
        if (pane && current) view.drawTabs(pane, current.tabs, current.active);
      }
    }),
  );

  registerCommands();
}

/// I documenti aperti in un riquadro qualunque, senza ripetizioni.
function openDocuments(): string[] {
  const p = layoutPanes().flatMap((id) => {
    const state = paneState(id);
    return state ? documents(state) : [];
  });
  return [...new Set(p)];
}
