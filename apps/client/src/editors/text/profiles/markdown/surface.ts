// La superficie Markdown: una scrittura e una lettura sullo stesso buffer,
// senza salvataggi per cambiare modo.
//
// Il `TextEngine` resta l'unico proprietario di testo, selezione e cronologia:
// qui si decide soltanto cosa si vede — sorgente, resa inline o documento
// reso — e la lettura si rimonta dal buffer corrente a ogni cambio che la
// riguarda. La vista di scrittura non si ricrea mai al cambio di modo.
//
// È anche il solo posto che sa come il Markdown accoglie ciò che la shell gli
// porta: un rimando si scrive con `markdownReference`, una presentazione è la
// sua resa, un punto del modello si raggiunge nella vista del modo corrente.
import { currentTheme as getCurrentTheme, type Theme } from "../../../../theme/theme";
import type { SyntaxForm } from "../../../../host/contract";
import { byteToNormalizedCharIndices, normalizeLineBreaks } from "../../../../rules/offsets";
import { taskChecked } from "../../../../rules/mirrored";
import { t } from "../../../../i18n/strings";
import { mountMarkdown, sourceElementAt, type MarkdownMountOptions } from "./mount";
import { acquireMarkdownResources } from "../../../../ui/markdown-resources";
import { settings } from "../../../../host/query";
import { onEvent } from "../../../../state/kernel";
import { openLifetime } from "../../../../ui/lifetime";
import { notify } from "../../../../ui/notify";
import { errorText } from "../../../../host/errors";
import { clipboardSupports, readClipboard, writeClipboardData, writeClipboardText } from "../../../../platform/clipboard";
import { closeSlashPalette, openSlashPalette } from "../../../../ui/palette";
import type {
  BufferedSurface,
  EditorSelections,
  SurfaceLocation,
  SurfaceMode,
  SurfaceMountContext,
  SurfaceAnchor,
  SurfacePoint,
  SurfaceReference,
  SurfaceScrollLink,
} from "../../../core/registry";
import type { EditorChange } from "../../../core/text-operation";
import { createTextEngine } from "../../engine";
import type { CompletionSources } from "./completions";
import { cursorIsLiteral, runSlashAction, type SlashMenuSource } from "./slash";
import type { SlashMenuHost } from "../../../core/editor-menu";
import { iconEl } from "../../../../ui/icons";

export { cursorIsLiteral };
import { createMarkdownProfile } from "./profile";
import { anchorAtCursor, writeAnchor } from "./anchor-link";
import type { TableGridActions } from "./table-grid";
import { deleteFootnoteAt, footnoteAt, MARKDOWN_ACTIONS, markdownActionState, relinkImage } from "./actions";
import { foldAll, unfoldAll } from "@codemirror/language";
import { foldLess, foldMore, toggleFold } from "../../fold-levels";
import type { EditorView } from "@codemirror/view";
import {
  ACTION_UNAVAILABLE,
  type EditorActionState,
  type SurfaceEditorActions,
} from "../../../core/editor-actions";
import { MARKDOWN_EXPORTS } from "./exports";
import { markdownReference } from "./references";
import { frontmatterRange, renderMarkdown } from "./render";
import { addProperty, clearProperties } from "./properties";
import { clipboardHtml } from "./copy-html";
import type { ProofPorts } from "../../../core/proof-ports";
import type { SurfaceMenu, SurfaceMenuEntry, SurfaceMenuItem } from "../../../core/editor-menu";
import { forEachDiagnostic } from "@codemirror/lint";
import { codeBlockAt, headingAt, linkAt, listAt, tableRowAt, taskAt, type MarkdownLinkAt } from "./menu";

/// Le tre viste esclusive sullo stesso buffer. `source` e `live_preview`
/// scrivono nella stessa vista; `reading` la nasconde e mostra il reso.
export type MarkdownMode = "source" | "live_preview" | "reading";

export const MARKDOWN_MODES: readonly SurfaceMode[] = [
  { id: "source", label: () => t("mode.source"), presentation: "surface", contextMode: "source", looks: ["tema"] },
  { id: "live_preview", label: () => t("mode.live"), presentation: "surface", contextMode: "live_preview", looks: ["tema"] },
  { id: "reading", label: () => t("mode.reading"), presentation: "rendered", contextMode: "reading", looks: ["tema"] },
];

/// Le sole capacità di shell necessarie alla palette slash.
export type EditorSlashHost = Parameters<typeof openSlashPalette>[3] & {
  currentDoc(): string | null;
  /// Il menu «/» nel testo: senza, il «/» senza selezione apre la palette.
  menu?: SlashMenuHost;
};

export interface MarkdownSurfaceOptions {
  /// Invocato a ogni modifica fatta dall'utente.
  onChange(change: EditorChange): void;
  /// Invocato quando cambia la selezione.
  onSelectionChange(): void;
  /// Click su un wikilink nella resa.
  onOpenWikilink(page: string, heading: string | null, block: string | null): void | Promise<void>;
  onOpenPath(path: string, from?: string): void | Promise<void>;
  /// Scarica nel vault l'immagine remota `url` per la nota `from`, dopo aver
  /// chiesto il consenso: il link relativo del file salvato, o `null` se
  /// l'utente non ha voluto. Senza, le immagini remote restano segnaposti.
  onImportRemoteImage?(url: string, from: string): Promise<string | null>;
  /// Click su un `#tag` nella resa.
  onSearchTag(tag: string): void;
  /// Sorgenti per i completamenti del profilo Markdown.
  completions: CompletionSources;
  /// La slash palette è disponibile solo se la shell ne fornisce le capacità.
  slash?: EditorSlashHost;
  /// Il correttore: le porte verso `fub.proof` del vault del documento. Senza,
  /// la superficie non segna niente.
  proof?: {
    readonly ports: ProofPorts;
    notify?(message: string): void;
  };
}

/// La superficie montata, con tutte le capacità che dichiara. Annullare e
/// ripetere non sono del contratto — la shell li raggiunge dalla tastiera
/// della superficie — ma restano qui per chi prova la lettura.
export interface MarkdownSurface extends BufferedSurface {
  focus(): void;
  reveal(location: SurfaceLocation): boolean;
  selections(): EditorSelections;
  setReadOnly(readOnly: boolean): void;
  setTheme(theme: Theme): void;
  setSyntaxForms(forms: readonly SyntaxForm[]): void;
  insertReferences(references: readonly SurfaceReference[], at?: SurfacePoint): boolean;
  anchorHere(): SurfaceAnchor | null;
  readonly scrollLink: SurfaceScrollLink;
  mountPresentation(host: HTMLElement): () => void;
  readonly editorActions: SurfaceEditorActions;
  undo(): boolean;
  redo(): boolean;
}

/// Piegare e aprire tutti i titoli, le liste e i blocchi della nota, o un
/// livello alla volta: azioni della superficie come annulla, fuori dalla
/// barra di formattazione.
/// «Piega le proprietà»: il frontmatter si chiude sotto la sua prima riga,
/// e lo stesso comando lo riapre.
const foldProperties = (view: EditorView): boolean => {
  const range = frontmatterRange(view.state.doc);
  if (!range) return false;
  const from = view.state.doc.lineAt(range.from).to;
  const to = view.state.doc.lineAt(Math.max(range.to - 1, range.from)).to;
  return to > from && toggleFold(view, { from, to });
};

const FOLDS = new Map<string, (view: EditorView) => boolean>([
  ["text.fold.all", foldAll],
  ["text.unfold.all", unfoldAll],
  ["text.fold.more", foldMore],
  ["text.fold.less", foldLess],
  ["text.fold.properties", foldProperties],
]);

/// La palette slash si apre a inizio riga o dopo uno spazio: dentro una
/// parola il `/` è testo («e/o», «km/h», 24/09).
export function slashOpensAt(lineBefore: string): boolean {
  return lineBefore === "" || /\s$/.test(lineBefore);
}

/// La finestra in cui la lettura raccoglie le modifiche arrivate da un altro
/// riquadro prima di ridisegnarsi.
const READING_SYNC_MS = 120;
/// Quanto un riquadro che ha seguito lo scorrimento di un altro tace: copre
/// lo scorrimento in due tempi del motore (il blocco, poi il pixel).
const FOLLOW_QUIET_MS = 150;
const STRICT_LINE_BREAKS_KEY = "editor.strict-line-breaks";
const RTL_KEY = "editor.rtl";

function isMarkdownMode(mode: string): mode is MarkdownMode {
  return MARKDOWN_MODES.some((candidate) => candidate.id === mode);
}

/// Monta la superficie Markdown dentro `context.parent`.
export function mountMarkdownSurface(context: SurfaceMountContext, opts: MarkdownSurfaceOptions): MarkdownSurface {
  const parent = context.parent;
  const documentId = context.documentId;
  const resources = acquireMarkdownResources(documentId);
  const openWikilink = (page: string, heading?: string | null, block?: string | null) =>
    opts.onOpenWikilink(page, heading ?? null, block ?? null);
  /// La griglia di tabella che ha il fuoco: le azioni della barra agiscono
  /// sulle sue celle invece che sul cursore del testo.
  let tableGrid: TableGridActions | null = null;
  // Il menu «/» nel testo: le voci le dà la shell, la superficie le esegue.
  // Spento (`editor.slash`), in lettura, in sola lettura o su un documento
  // che non è più quello del riquadro, non ha voci e il «/» resta testo.
  const slashHost = opts.slash?.menu;
  const slashMenu: SlashMenuSource | undefined = slashHost && {
    entries: (query) =>
      !slashHost.enabled() || readOnly || mode === "reading" || opts.slash?.currentDoc() !== documentId
        ? []
        : slashHost.entries(query, (id) => editorActions.has(id) && editorActions.state(id).enabled),
    choose: (view, entry, from, to) => {
      if (entry.action) runSlashAction(view, entry.id, from, to);
      else view.dispatch({ changes: { from, to }, userEvent: "input.complete" });
      slashHost.chosen(entry, parent, engine.anchorBox());
    },
    icon: (name) => iconEl(name),
  };
  const profile = createMarkdownProfile({
    callbacks: {
      openWikilink,
      searchTag: opts.onSearchTag,
      // Come in Lettura: il percorso si risolve rispetto a questo documento,
      // e un documento che non c'è lo dice invece di tacere.
      openPath: (path) => {
        void Promise.resolve()
          .then(() => opts.onOpenPath(path, resources?.documentId ?? documentId))
          .catch((error: unknown) => {
            if (!life.closed) notify(t("preview.open_failed", { page: path, reason: errorText(error) }), "guasto");
          });
      },
      tableGrid: {
        active: (grid) => {
          tableGrid = grid;
          actionsChanged();
        },
        changed: () => actionsChanged(),
      },
      mountRendered: (container, html, actions) => mountMarkdown(container, html, {
        ...actions,
        get documentId() { return resources?.documentId ?? documentId; },
        resources,
        openWikilink,
        openPath: opts.onOpenPath,
        searchTag: opts.onSearchTag,
        toggleTask: readOnly ? undefined : actions.toggleTask,
        editFence: readOnly ? undefined : actions.editFence,
        importRemoteImage: readOnly ? undefined : importRemoteImage,
      }),
    },
    completions: slashMenu ? { ...opts.completions, slash: slashMenu } : opts.completions,
  });
  let mode: MarkdownMode = "live_preview";
  let forms: readonly SyntaxForm[] | undefined;
  let readOnly = false;
  let unmountReading: (() => void) | null = null;
  const life = openLifetime();
  /// Chi segue lo stato delle azioni (la barra del riquadro). Un insieme e
  /// non un callback: la stessa superficie può essere guardata da più parti.
  const actionListeners = new Set<() => void>();
  const actionsChanged = () => {
    for (const listener of [...actionListeners]) listener();
  };
  // Copiare o tagliare una selezione porta anche l'HTML, per incollare con la
  // formattazione fuori da Fub. Il testo si legge prima di CodeMirror, perché
  // un taglio lo toglie dal documento; l'HTML si aggiunge dopo, perché
  // CodeMirror svuota gli appunti prima di scriverci il testo semplice.
  let copied: string | null = null;
  const beforeCopy = (event: ClipboardEvent) => {
    copied = null;
    if (mode === "reading" || !(event.target instanceof Element) || !event.target.closest(".cm-content")) return;
    // La griglia di una tabella copia le sue celle da sé.
    if (event.target.closest(".tb-frame")) return;
    copied = engine.readState((state) => {
      const parts = state.selection.ranges.filter((range) => !range.empty)
        .map((range) => state.sliceDoc(range.from, range.to));
      return parts.length > 0 ? parts.join(state.lineBreak) : null;
    });
  };
  const afterCopy = (event: ClipboardEvent) => {
    const text = copied;
    copied = null;
    if (text === null || !event.defaultPrevented || !event.clipboardData) return;
    event.clipboardData.setData("text/html", clipboardHtml(text, forms));
  };
  life.listen(parent, "copy", beforeCopy, { capture: true });
  life.listen(parent, "cut", beforeCopy, { capture: true });
  life.listen(parent, "copy", afterCopy);
  life.listen(parent, "cut", afterCopy);
  life.listen(parent, "keydown", (event) => {
    const slash = opts.slash;
    if (
      !slash || event.key !== "/" || event.defaultPrevented || event.isComposing ||
      event.altKey || event.ctrlKey || event.metaKey || readOnly || mode === "reading" ||
      !(event.target instanceof Element) || !event.target.closest(".cm-content") ||
      // Una griglia di tabella scrive le sue celle: il `/` è testo.
      event.target.closest(".tb-frame")
    ) return;
    if (slash.currentDoc() !== documentId) return;
    // «e/o», 24/09, URL, path e codice restano testo: la palette si apre su
    // una selezione oppure a inizio parola, fuori da codice e link.
    const cursor = engine.cursorContext();
    if (cursor.empty && (cursorIsLiteral(cursor) || !slashOpensAt(cursor.lineBefore))) return;
    // Senza selezione il «/» si scrive, e il menu nel testo lo prende da lì;
    // spento, resta testo. La palette resta per la selezione.
    if (cursor.empty && slash.menu) return;
    event.preventDefault();
    event.stopPropagation();
    const text = engine.getDoc();
    const typed = cursor.empty;
    const anchor = engine.anchorBox();
    void openSlashPalette(
      parent,
      engine.selections().primary.text,
      () => !life.closed && parent.isConnected && engine.getDoc() === text &&
        slash.currentDoc() === documentId,
      slash,
      // Chiusa senza scelta, la palette restituisce la battuta.
      typed ? () => {
        if (!life.closed && engine.getDoc() === text) engine.insertAt(cursor.head, "/");
      } : undefined,
      anchor,
    );
  }, { capture: true });

  const engine = createTextEngine(parent, {
    onChange: (change) => {
      closeSlashPalette(parent);
      opts.onChange(change);
      // Una modifica locale in lettura (il task cliccato, un undo da
      // scorciatoia) ridisegna la resa dal buffer corrente.
      if (mode === "reading") renderReading();
    },
    onSelectionChange: () => {
      closeSlashPalette(parent);
      opts.onSelectionChange();
      actionsChanged();
    },
    theme: getCurrentTheme(),
    extensions: () => profile.extensions(),
  });

  const reading = document.createElement("div");
  reading.className = "pane-preview markdown-preview markdown-rendered";
  reading.tabIndex = 0;
  reading.setAttribute("role", "document");
  parent.append(reading);
  parent.dataset.markdownMode = mode;
  // «Interruzioni di riga rigorose» spente: in Lettura un a capo singolo
  // resta un'interruzione. La resa lo dice con un attributo, e la pelle lo
  // legge; il testo del documento non cambia. «Testo da destra a sinistra»
  // gira la Lettura; l'editor lo legge da sé.
  let breaksRead = 0;
  const readLineBreaks = async (): Promise<void> => {
    const mine = ++breaksRead;
    const entries = await settings().catch(() => null);
    if (!entries || mine !== breaksRead || life.closed) return;
    const strict = entries.find((entry) => entry.spec.key === STRICT_LINE_BREAKS_KEY)?.value;
    if (strict === false) parent.dataset.lineBreaks = "keep";
    else delete parent.dataset.lineBreaks;
    if (entries.find((entry) => entry.spec.key === RTL_KEY)?.value === true) reading.dir = "rtl";
    else reading.removeAttribute("dir");
  };
  void readLineBreaks();
  life.add(onEvent("setting_changed", (event) => {
    if (event.key === STRICT_LINE_BREAKS_KEY || event.key === RTL_KEY) void readLineBreaks();
  }));

  // Reading owns browser selection; only history commands reach the hidden editor.
  life.listen(reading, "keydown", (event) => {
    if (event.defaultPrevented || (!event.ctrlKey && !event.metaKey) || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-ui-slot], input:not([type=checkbox]), textarea, [contenteditable=true]")) return;
    const key = event.key.toLowerCase();
    if (key === "z" || key === "y") {
      event.preventDefault();
      if (!readOnly) {
        if (key === "y" || event.shiftKey) engine.redo();
        else engine.undo();
      }
    } else if (key === "a" && !event.shiftKey) {
      event.preventDefault();
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(reading);
      selection.removeAllRanges();
      selection.addRange(range);
    } else if (key === "c" && !event.shiftKey) {
      // Senza niente di selezionato nella resa, Ctrl+C copia il sorgente
      // della nota, com'è nel buffer: una selezione vera resta del browser.
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.anchorNode && reading.contains(selection.anchorNode)) return;
      event.preventDefault();
      void writeClipboardText(engine.getDoc()).then(
        () => notify(t("mode.reading.source_copied"), "info"),
        () => notify(t("mode.reading.copy_failed"), "guasto"),
      );
    }
  });

  /// Il primo blocco visibile della lettura e la sua distanza dalla cima:
  /// l'ancoraggio che conserva la posizione al ridisegno.
  function captureReadingAnchor(): { from: number; top: number } | null {
    const rect = reading.getBoundingClientRect();
    for (const element of reading.querySelectorAll<HTMLElement>("[data-md-from]")) {
      // Transclusions and provider components own another coordinate space.
      if (element.parentElement?.closest(".embed-loaded") || element.closest("[data-ui-slot]")) continue;
      if (!/^\d+$/.test(element.dataset.mdFrom ?? "")) continue;
      const box = element.getBoundingClientRect();
      if (box.bottom > rect.top) {
        return { from: Number(element.dataset.mdFrom), top: box.top - rect.top };
      }
    }
    return null;
  }

  function scrollReadingTo(from: number, top: number): void {
    const element = sourceElementAt(reading, from);
    if (!element) return;
    element.scrollIntoView({ block: "start" });
    if (!Number.isFinite(top)) return;
    try {
      const rect = reading.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      reading.scrollTop += box.top - rect.top - top;
    } catch {
      // La misura è decorativa: l'ancoraggio per blocco è già a posto.
    }
  }

  /// Scrive il simbolo dentro `[ ]`/`[x]`: solo quel carattere, solo se il
  /// buffer ha ancora una casella lì. Resta una battuta come le altre —
  /// annullabile e diffusa alla sessione.
  function toggleTaskAt(symbolOffset: number): void {
    if (readOnly) return;
    const text = normalizeLineBreaks(engine.getDoc());
    if (!Number.isSafeInteger(symbolOffset) || symbolOffset < 0 || symbolOffset >= text.length) {
      return;
    }
    if (!/^\[[^\]\r\n]\]$/u.test(text.slice(symbolOffset - 1, symbolOffset + 2))) return;
    const symbol = text[symbolOffset] ?? "";
    engine.applyUserEdit(
      symbolOffset,
      symbolOffset + 1,
      taskChecked(symbol) ? " " : "x",
    );
    reading.focus({ preventScroll: true });
  }

  /// Scarica un'immagine remota nel vault e riscrive la nota verso il file:
  /// il consenso e il deposito sono della shell, la riscrittura è una battuta
  /// di questa superficie.
  async function importRemoteImage(url: string): Promise<void> {
    const download = opts.onImportRemoteImage;
    if (readOnly || !download) return;
    try {
      const link = await download(url, resources?.documentId ?? documentId);
      if (link === null || life.closed || readOnly) return;
      engine.runCommand(relinkImage(url, link));
    } catch (error) {
      if (!life.closed) notify(t("markdown.image_remote_failed", { reason: errorText(error) }), "guasto");
    }
  }

  /// Lo scorrimento di questo riquadro nelle coordinate della sorgente, per
  /// un riquadro collegato sullo stesso documento (L03): il blocco in cima e
  /// la sua distanza, presi dalla Lettura o dal motore secondo il modo. Lo
  /// scorrimento che arriva da un altro riquadro non si ridice: per un attimo
  /// questo riquadro non avvisa, così due riquadri non si rincorrono.
  let followedUntil = 0;
  const scrollLink: SurfaceScrollLink = {
    point: () => {
      if (life.closed) return null;
      if (mode !== "reading") return engine.getScrollAnchor();
      const anchor = captureReadingAnchor();
      return anchor ? { offset: anchor.from, top: anchor.top } : null;
    },
    follow: (point) => {
      if (life.closed) return;
      followedUntil = performance.now() + FOLLOW_QUIET_MS;
      if (mode === "reading") scrollReadingTo(point.offset, point.top);
      else engine.restoreScrollAnchor(point);
    },
    onScroll: (listener) => {
      const scrolled = () => {
        if (performance.now() >= followedUntil) listener();
      };
      const own = openLifetime();
      own.listen(reading, "scroll", scrolled, { passive: true });
      own.add(engine.listenScroll(scrolled));
      return () => own.close();
    },
  };

  /// Le opzioni con cui si monta ogni resa di questo documento. L'id si legge
  /// a ogni richiesta: una rinomina lo cambia mentre la resa è montata.
  function renderedOptions(toggleTask?: (sourceOffset: number) => void): MarkdownMountOptions {
    return {
      get documentId() { return resources?.documentId ?? documentId; },
      resources,
      openWikilink,
      openPath: opts.onOpenPath,
      searchTag: opts.onSearchTag,
      toggleTask,
      importRemoteImage: toggleTask ? importRemoteImage : undefined,
    };
  }

  /// Le sincronizzazioni da un altro riquadro arrivano a ogni sua battuta; la
  /// lettura le raccoglie e si ridisegna al più una volta per finestra.
  /// Ridisegnarla (Markdown intero, diagrammi, embed) a ogni carattere teneva
  /// occupato anche il riquadro che scrive.
  let readingSyncTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelReadingSync(): void {
    if (readingSyncTimer === null) return;
    clearTimeout(readingSyncTimer);
    readingSyncTimer = null;
  }

  /// Rimonta la lettura dal buffer corrente. Chi chiama conserva la
  /// posizione; qui si ridisegna e basta. Il punto di lettura si cattura sul
  /// DOM disegnato, che è ancora quello del testo di prima.
  function renderReading(): void {
    cancelReadingSync();
    const text = normalizeLineBreaks(engine.getDoc());
    const anchor = captureReadingAnchor();
    unmountReading?.();
    // In sola lettura vera le caselle risultano disabilitate, così la
    // superficie non sembra interattiva mentre la cancellazione è sospesa.
    unmountReading = mountMarkdown(
      reading,
      renderMarkdown(text, forms).html,
      renderedOptions(readOnly ? undefined : toggleTaskAt),
    );
    if (anchor) scrollReadingTo(anchor.from, anchor.top);
  }

  function setMode(next: MarkdownMode): void {
    closeSlashPalette(parent);
    if (next === mode) return;
    const previous = mode;
    if (previous !== "reading" && next === "reading") {
      const anchor = engine.getScrollAnchor();
      mode = next;
      parent.dataset.markdownMode = next;
      profile.setLivePreview(false);
      engine.reconfigure();
      renderReading();
      scrollReadingTo(anchor.offset, anchor.top);
      return;
    }
    if (previous === "reading" && next !== "reading") {
      const anchor = captureReadingAnchor();
      mode = next;
      parent.dataset.markdownMode = next;
      unmountReading?.();
      unmountReading = null;
      profile.setLivePreview(next === "live_preview");
      engine.reconfigure();
      // La selezione di scrittura non si è mai mossa: la lettura non la
      // tocca, e qui si rimette solo la vista dov'era.
      if (anchor) {
        engine.restoreScrollAnchor({
          offset: anchor.from,
          top: anchor.top,
        });
      }
      return;
    }
    const anchor = engine.getScrollAnchor();
    mode = next;
    parent.dataset.markdownMode = next;
    profile.setLivePreview(next === "live_preview");
    engine.reconfigure();
    engine.restoreScrollAnchor(anchor);
  }

  function syncReading(): void {
    if (mode !== "reading") return;
    renderReading();
  }

  /// Le azioni dell'editor: il catalogo del profilo più annulla e ripeti, che
  /// sono del motore. Si scrive soltanto in una modalità di scrittura e fuori
  /// dalla sola lettura; negli altri casi ogni azione è spenta, non assente.
  // Il correttore si carica dopo la superficie: la scrittura non lo aspetta,
  // e un guasto nel caricarlo lascia l'editor com'era.
  const proof = opts.proof;
  if (proof) {
    void import("./proof").then(
      ({ mountMarkdownProof }) => {
        if (life.closed) return;
        const mounted = mountMarkdownProof(proof.ports, { notify: proof.notify, forms: () => forms });
        life.add(() => mounted.dispose());
        profile.setProof(mounted.extension);
        engine.reconfigure();
      },
      () => {},
    );
  }
  const editable = () => !readOnly && mode !== "reading" && !life.closed;
  const editorActions: SurfaceEditorActions = {
    has: (id) => MARKDOWN_ACTIONS.has(id) || id === "text.undo" || id === "text.redo" || FOLDS.has(id),
    editable,
    state(id): EditorActionState {
      if (!editable()) return ACTION_UNAVAILABLE;
      if (FOLDS.has(id)) return { enabled: true, active: null };
      if (id === "text.undo" || id === "text.redo") {
        const depth = engine.historyDepth();
        return { enabled: (id === "text.undo" ? depth.undo : depth.redo) > 0, active: null };
      }
      if (tableGrid) return tableGrid.actionState(id);
      const action = MARKDOWN_ACTIONS.get(id);
      if (!action) return ACTION_UNAVAILABLE;
      return engine.readState((state) => markdownActionState(action, state));
    },
    run(id) {
      if (!editable()) return false;
      closeSlashPalette(parent);
      if (id === "text.undo") return engine.undo();
      if (id === "text.redo") return engine.redo();
      const fold = FOLDS.get(id);
      if (fold) return engine.runViewCommand(fold);
      if (tableGrid) return tableGrid.runAction(id);
      const action = MARKDOWN_ACTIONS.get(id);
      if (!action) return false;
      if (!engine.readState((state) => markdownActionState(action, state)).enabled) return false;
      return engine.runCommand(action.run);
    },
    chord(id) {
      if (id === "text.undo") return "Mod-z";
      if (id === "text.redo") return "Mod-y";
      return MARKDOWN_ACTIONS.get(id)?.chord ?? null;
    },
    subscribe(listener) {
      actionListeners.add(listener);
      return () => {
        actionListeners.delete(listener);
      };
    },
    // La bolla di selezione compare solo dove si scrive con la resa accanto:
    // nella lettura la selezione non ha niente da formattare.
    selectionBox: () => (editable() ? engine.selectionBox() : null),
  };


  /// I gesti di formato del menu: gli stessi id della barra, divisi come in
  /// un elaboratore di testi fra il carattere e il blocco.
  const FORMAT_IDS = [
    "markdown.bold", "markdown.italic", "markdown.strikethrough", "markdown.highlight",
    "markdown.code", "markdown.math", "markdown.comment", "markdown.clear",
  ];
  const TRANSFORM_IDS = [
    "markdown.paragraph", "markdown.heading.1", "markdown.heading.2", "markdown.heading.3",
    "markdown.heading.4", "markdown.heading.5", "markdown.heading.6",
    "markdown.list.bullet", "markdown.list.ordered", "markdown.list.task",
    "markdown.quote", "markdown.callout", "markdown.codeblock",
  ];
  const INSERT_IDS = [
    "markdown.table", "markdown.rule", "markdown.codeblock", "markdown.diagram", "markdown.mathblock",
    "markdown.image", "markdown.link", "markdown.wikilink", "markdown.embed", "markdown.footnote",
    "markdown.property.add",
  ];
  const TABLE_IDS = [
    "markdown.table.row.before", "markdown.table.row.after", "markdown.table.row.up", "markdown.table.row.down",
    "markdown.table.row.delete", "markdown.table.column.before", "markdown.table.column.after",
    "markdown.table.column.left", "markdown.table.column.right", "markdown.table.column.delete",
    "markdown.table.sort.ascending", "markdown.table.sort.descending",
  ];

  const copyText = (text: string, done: string): void => {
    void writeClipboardText(text).then(
      () => notify(done, "info"),
      () => notify(t("editor_menu.copy_failed"), "guasto"),
    );
  };

  /// Copia `text` con anche l'HTML dove gli appunti lo accettano, come Mod-c.
  const copyRich = (text: string): Promise<void> => {
    if (!clipboardSupports("text/html")) return writeClipboardText(text);
    return writeClipboardData({
      "text/plain": new Blob([text], { type: "text/plain" }),
      "text/html": new Blob([clipboardHtml(text, forms)], { type: "text/html" }),
    });
  };

  const selectedSource = (): string =>
    engine.readState((state) =>
      state.selection.ranges.filter((range) => !range.empty).map((range) => state.sliceDoc(range.from, range.to)).join(state.lineBreak),
    );

  /// Il testo di una resa senza i segni del Markdown, per «Copia come testo».
  const plainText = (markdown: string): string => {
    const html = renderMarkdown(normalizeLineBreaks(markdown), forms).html;
    const parsed = new DOMParser().parseFromString(html, "text/html");
    return (parsed.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
  };

  /// Incolla dagli appunti: tutti i tipi, o soltanto il testo.
  const pasteFromClipboard = (plain: boolean): void => {
    void readClipboard().then(async (entries) => {
      let text: string | null = null;
      let html: string | null = null;
      for (const entry of entries) {
        if (text === null && entry.types.includes("text/plain")) text = await (await entry.getType("text/plain")).text();
        if (!plain && html === null && entry.types.includes("text/html")) html = await (await entry.getType("text/html")).text();
      }
      if (life.closed || (text === null && html === null)) return;
      engine.paste(text ?? "", plain ? null : html);
    }).catch(() => notify(t("editor_menu.paste_failed"), "guasto"));
  };

  const linkItems = (link: MarkdownLinkAt): SurfaceMenuItem[] => {
    const items: SurfaceMenuItem[] = [];
    const where = resources?.documentId ?? documentId;
    if (link.kind === "wikilink") {
      if (link.page !== "" || link.heading !== null || link.block !== null) {
        items.push({
          id: "markdown.link.open",
          label: t("editor_menu.link.open"),
          run: () => void openWikilink(link.page || where.replace(/\.md$/i, ""), link.heading, link.block),
        });
      }
      const target = `${link.page}${link.heading ? `#${link.heading}` : ""}${link.block ? `#^${link.block}` : ""}`;
      items.push({ id: "markdown.link.copy", label: t("editor_menu.link.copy_target"), run: () => copyText(target, t("editor_menu.copied")) });
    } else {
      const external = /^[a-z][a-z0-9+.-]*:/i.test(link.url);
      if (!external) {
        items.push({
          id: "markdown.link.open",
          label: t("editor_menu.link.open"),
          run: () => void Promise.resolve(opts.onOpenPath(decodeURI(link.url), where)).catch(() => {}),
        });
      }
      items.push({ id: "markdown.link.copy", label: t("editor_menu.link.copy_url"), run: () => copyText(link.url, t("editor_menu.copied")) });
    }
    if (!link.embed) {
      items.push({
        id: "markdown.link.remove",
        label: t("editor_menu.link.remove"),
        enabled: editable(),
        run: () => void engine.applyUserEdit(link.from, link.to, link.text),
      });
    }
    return items;
  };

  /// Il menu dove si scrive: Sorgente e Live.
  function writingMenu(at: SurfacePoint | null): SurfaceMenu | null {
    let pos = engine.readState((state) => state.selection.main.head);
    if (at) {
      const element = document.elementFromPoint(at.x, at.y);
      if (!element || !parent.contains(element) || !element.closest(".cm-editor")) return null;
      // Le proprietà rese hanno i loro gesti, e soltanto quelli.
      if (element.closest(".cm-fub-properties")) {
        return {
          target: { kind: "properties" },
          context: [
            { id: "markdown.property.add", label: t("editor.properties.add"), enabled: editable(), run: () => void engine.runCommand(addProperty) },
            { id: "markdown.property.clear", label: t("editor.properties.clear"), enabled: editable(), run: () => void engine.runCommand(clearProperties) },
          ],
        };
      }
      const point = engine.posAtPoint(at.x, at.y);
      if (point !== null) {
        // Il tasto destro dentro la selezione la lascia com'è; fuori porta il
        // cursore lì, come il clic, perché le voci parlino di quel punto.
        const inside = engine.readState((state) => state.selection.ranges.some((range) => !range.empty && range.from <= point && point <= range.to));
        if (!inside) engine.placeCursor(point);
        pos = inside ? pos : point;
      }
    }
    const hasSelection = engine.readState((state) => state.selection.ranges.some((range) => !range.empty));
    const writable = editable();
    const context: SurfaceMenuEntry[] = [];
    // Le correzioni del correttore, per prime.
    engine.readState((state) => {
      forEachDiagnostic(state, (diagnostic, from, to) => {
        if (pos < from || pos > to) return;
        for (const action of diagnostic.actions ?? []) {
          context.push({
            id: "proof.action",
            label: action.name,
            enabled: writable,
            run: () => void engine.runViewCommand((view) => {
              action.apply(view, from, to);
              return true;
            }),
          });
        }
      });
    });
    const link = engine.readState((state) => linkAt(state, pos));
    if (link) context.push(...linkItems(link));
    const footnote = engine.readState((state) => footnoteAt(state, pos));
    if (footnote !== null) {
      context.push({ id: "markdown.footnote.delete", label: t("editor.footnote.delete"), enabled: writable, danger: true, run: () => void engine.runCommand(deleteFootnoteAt(pos)) });
    }
    const task = engine.readState((state) => taskAt(state, pos));
    if (task) {
      context.push({
        id: "markdown.task.toggle",
        label: t(task.checked ? "editor_menu.task.undone" : "editor_menu.task.done"),
        enabled: writable,
        run: () => void engine.applyUserEdit(task.symbol, task.symbol + 1, task.checked ? " " : "x"),
      });
    }
    if (engine.readState((state) => listAt(state, pos))) context.push("markdown.list.indent", "markdown.list.dedent");
    const code = engine.readState((state) => codeBlockAt(state, pos));
    if (code) {
      context.push({ id: "markdown.code.copy", label: t("editor_menu.code.copy"), run: () => copyText(code.code, t("editor_menu.copied")) });
    }
    if (mode === "source" && engine.readState((state) => tableRowAt(state, pos))) {
      context.push({ id: "markdown.table.menu", label: t("editor_menu.table"), icon: "fmt-table", items: TABLE_IDS });
    }
    const kind = link ? "link" : code ? "code" : task || engine.readState((state) => listAt(state, pos)) ? "list"
      : engine.readState((state) => headingAt(state, pos)) ? "heading" : hasSelection ? "selection" : "text";
    const box = engine.anchorBox();
    return {
      target: { kind },
      at: box ? { x: Math.round(box.left), y: Math.round(box.bottom) + 4 } : undefined,
      context,
      clipboard: {
        offers: { cut: writable && hasSelection, copy: hasSelection, paste: writable, "paste-plain": writable, "select-all": true },
        run(op) {
          if (op === "select-all") engine.selectAll();
          else if (op === "paste" || op === "paste-plain") pasteFromClipboard(op === "paste-plain");
          else {
            const text = selectedSource();
            void copyRich(text).then(
              () => {
                if (op === "cut" && !life.closed) engine.deleteSelection();
              },
              () => notify(t("editor_menu.copy_failed"), "guasto"),
            );
          }
        },
        copyAs: hasSelection
          ? [
              { id: "markdown.copy.markdown", label: t("editor_menu.copy_as.markdown"), run: () => copyText(selectedSource(), t("editor_menu.copied")) },
              { id: "markdown.copy.html", label: t("editor_menu.copy_as.html"), run: () => copyText(clipboardHtml(selectedSource(), forms), t("editor_menu.copied")) },
              { id: "markdown.copy.text", label: t("editor_menu.copy_as.text"), run: () => copyText(plainText(selectedSource()), t("editor_menu.copied")) },
            ]
          : [],
      },
      format: FORMAT_IDS,
      transform: TRANSFORM_IDS,
      insert: INSERT_IDS,
      commands: writable,
      miniBar: writable,
    };
  }

  /// Il menu della Lettura: copiare, e tornare a scrivere da quel punto.
  function readingMenu(at: SurfacePoint | null): SurfaceMenu | null {
    const element = at ? document.elementFromPoint(at.x, at.y) : null;
    if (at && (!element || !reading.contains(element))) return null;
    const selection = window.getSelection();
    const selected = selection && !selection.isCollapsed && selection.anchorNode && reading.contains(selection.anchorNode)
      ? selection.toString() : "";
    const source = element?.closest<HTMLElement>("[data-md-from]");
    const from = source && !source.closest(".embed-loaded") && /^\d+$/.test(source.dataset.mdFrom ?? "")
      ? Number(source.dataset.mdFrom) : null;
    const context: SurfaceMenuEntry[] = [];
    if (!readOnly) {
      context.push({
        id: "markdown.edit_here",
        label: t("editor_menu.edit_here"),
        run: () => {
          if (from !== null) engine.placeCursor(from);
        },
        command: "shell.mode.reading",
      });
    }
    return {
      target: { kind: "page" },
      context,
      clipboard: {
        offers: { copy: selected !== "", "select-all": true },
        run(op) {
          if (op === "copy") copyText(selected, t("editor_menu.copied"));
          else if (op === "select-all") {
            const range = document.createRange();
            range.selectNodeContents(reading);
            selection?.removeAllRanges();
            selection?.addRange(range);
          }
        },
        copyAs: [
          { id: "markdown.copy.source", label: t("editor_menu.copy_as.source"), run: () => copyText(engine.getDoc(), t("mode.reading.source_copied")) },
        ],
      },
      tail: ["shell.doc.export"],
    };
  }

  return {
    family: "text",
    profile: "markdown",
    surfaceId: context.paneId,
    modes: MARKDOWN_MODES,
    // Si scrive con la resa accanto: il sorgente nudo e la sola lettura sono
    // scelte, non il punto di partenza.
    defaultMode: "live_preview",
    setMode(next) {
      if (!isMarkdownMode(next)) throw new RangeError(`surface mode ${next} is not supported`);
      setMode(next);
      actionsChanged();
    },
    buffer: {
      setDoc: (text) => {
        closeSlashPalette(parent);
        engine.setDoc(text);
        syncReading();
      },
      syncDoc: (update) => {
        closeSlashPalette(parent);
        engine.syncDoc(update);
        if (mode !== "reading" || readingSyncTimer !== null) return;
        // La sincronizzazione esterna in lettura conserva il punto: il
        // ridisegno lo cattura sul DOM di prima e lo rimette dopo.
        readingSyncTimer = setTimeout(() => {
          readingSyncTimer = null;
          if (mode === "reading") renderReading();
        }, READING_SYNC_MS);
      },
      getDoc: () => engine.getDoc(),
    },
    setSyntaxForms(next) {
      if (forms !== undefined && forms !== next) resources?.invalidate();
      forms = next;
      profile.setSyntaxForms(next);
      engine.reconfigure();
      syncReading();
    },
    undo: () => engine.undo(),
    redo: () => engine.redo(),
    focus: () => {
      if (mode === "reading") reading.focus();
      else engine.focus();
    },
    reveal: ({ span }) => {
      // In lettura la selezione di scrittura non si tocca: scorre il DOM reso,
      // convertendo i byte UTF-8 del testo originale nell'offset UTF-16 del
      // normalizzato LF. Le selezioni native della lettura non diventano mai
      // contesto di scrittura.
      if (mode === "reading") {
        const normalized = byteToNormalizedCharIndices(engine.getDoc(), [span.start])[0];
        const element = sourceElementAt(reading, normalized);
        element?.scrollIntoView({ block: "start" });
        return element !== null;
      }
      engine.revealByteOffset(span.start);
      return true;
    },
    selections: () => engine.selections(),
    insertReferences: (references, at) => {
      if (!references.length) return false;
      const text = references.map(markdownReference).join("\n");
      return at ? engine.insertAtPoint(at.x, at.y, text) : engine.insertAtCursor(text);
    },
    mountPresentation(host) {
      // In lettura la resa è già a schermo, embed compresi: se ne porta una
      // copia. Negli altri modi si rende il buffer corrente.
      if (mode === "reading") {
        host.replaceChildren(...Array.from(reading.childNodes, (node) => node.cloneNode(true)));
        return () => host.replaceChildren();
      }
      return mountMarkdown(host, renderMarkdown(normalizeLineBreaks(engine.getDoc()), forms).html, renderedOptions());
    },
    printable: true,
    exports: MARKDOWN_EXPORTS,
    setReadOnly: (value) => {
      closeSlashPalette(parent);
      readOnly = value;
      engine.setReadOnly(value);
      // Senza callback le caselle risultano disabilitate.
      syncReading();
      actionsChanged();
    },
    setTheme: (theme) => engine.setTheme(theme),
    editorActions,
    contextMenu: (at) => {
      if (life.closed) return null;
      return mode === "reading" ? readingMenu(at) : writingMenu(at);
    },
    find: () => !life.closed && mode !== "reading" && engine.openFind(),
    anchorHere: () => {
      if (life.closed) return null;
      const found = engine.readState((state) => anchorAtCursor(state));
      if (!found) return null;
      // L'id nuovo si scrive solo dove si scrive: in Lettura o in sola lettura
      // un blocco senza id non ha ancora un link.
      if (found.insert && (!editable() || !engine.runCommand(writeAnchor(found)))) return null;
      return found.anchor;
    },
    scrollLink,
    destroy: () => {
      actionListeners.clear();
      closeSlashPalette(parent);
      cancelReadingSync();
      life.close();
      unmountReading?.();
      unmountReading = null;
      reading.remove();
      engine.destroy();
      resources?.release();
      delete parent.dataset.markdownMode;
    },
  };
}
