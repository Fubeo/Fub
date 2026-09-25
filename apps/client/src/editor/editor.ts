// La superficie Markdown: una scrittura e una lettura sullo stesso buffer,
// senza salvataggi per cambiare modo.
//
// Il `TextEngine` resta l'unico proprietario di testo, selezione e cronologia:
// qui si decide soltanto cosa si vede — sorgente, resa inline o documento
// reso — e la lettura si rimonta dal buffer corrente a ogni cambio che la
// riguarda. La vista di scrittura non si ricrea mai al cambio di modo.
import { currentTheme as getCurrentTheme, type Theme } from "../theme/theme";
import { createMarkdownProfile } from "../editors/text/profiles/markdown/profile";
import { renderMarkdown } from "../editors/text/profiles/markdown/render";
import type { CompletionSources } from "./completions";
import { createTextEngine } from "../editors/text/engine";
import type { DocumentUpdate, EditorChange, EditorSelections } from "../editors/text/engine";
import type { SyntaxForm } from "../host/contract";
import { byteToNormalizedCharIndices, normalizeLineBreaks } from "../rules/offsets";
import { taskChecked } from "../rules/mirrored";
import { mountMarkdown, sourceElementAt } from "../ui/markdown";
import { acquireMarkdownResources } from "../ui/markdown-resources";
import { openLifetime } from "../ui/lifetime";
import { closeSlashPalette, openSlashPalette } from "../ui/palette";

export type {
  DocumentUpdate,
  EditorChange,
  EditorChangeOrigin,
  EditorRange,
  EditorSelections,
} from "../editors/text/engine";

/// Le tre viste esclusive sullo stesso buffer. `source` e `live_preview`
/// scrivono nella stessa vista; `reading` la nasconde e mostra il reso.
export type MarkdownMode = "source" | "live_preview" | "reading";
/// Le sole capacità di shell necessarie alla palette slash.
export type EditorSlashHost = Parameters<typeof openSlashPalette>[3] & {
  currentDoc(): string | null;
};

export interface Editor {
  /// Aggiorna la dichiarazione sintattica letta dal canale runtime.
  setSyntaxForms(forms: readonly SyntaxForm[]): void;
  /// Mette nell'editor un testo che **l'utente non ha scritto**.
  setDoc(text: string): void;
  /// Porta l'editor su un testo scritto da un'altra superficie.
  syncDoc(update: DocumentUpdate | string): void;
  undo(): boolean;
  redo(): boolean;
  getDoc(): string;
  focus(): void;
  /// Porta la vista su un offset in **byte UTF-8** del documento.
  revealByteOffset(byteOffset: number): void;
  /// Le selezioni correnti in byte UTF-8.
  selections(): EditorSelections;
  /// Inserisce testo al cursore come battuta dell'utente (undo, sessione,
  /// conversione CRLF/offset interne al motore). Ritorna false se sola
  /// lettura, smontato o intervallo invalido.
  insertAtCursor(text: string): boolean;
  /// Inserisce testo nel punto dello schermo `(x, y)`: è il gesto del
  /// trascinamento, che lascia qualcosa dove cade e non dove sta il cursore.
  insertAtPoint(x: number, y: number, text: string): boolean;
  /// Cambia modo sul buffer corrente, senza ricreare la vista di scrittura.
  setMode(mode: MarkdownMode): void;
  setReadOnly(readOnly: boolean): void;
  /// Smonta l'editor e rilascia la vista e i suoi ascoltatori.
  destroy(): void;
  /// Passa all'altra luce.
  setTheme(theme: Theme): void;
}

export interface EditorOptions {
  /// Invocato a ogni modifica fatta dall'utente.
  onChange(change: EditorChange): void;
  /// Invocato quando cambia la selezione.
  onSelectionChange(): void;
  /// Click su un wikilink nella resa.
  onOpenWikilink(page: string, heading: string | null, block: string | null): void | Promise<void>;
  onOpenPath(path: string, from?: string): void | Promise<void>;
  /// Click su un `#tag` nella resa.
  onSearchTag(tag: string): void;
  /// Il documento reso, per gli embed: arriva dal contesto di montaggio.
  documentId?: string;
  /// Sorgenti per i completamenti del profilo Markdown.
  completions: CompletionSources;
  /// La slash palette è disponibile solo se la shell ne fornisce le capacità.
  slash?: EditorSlashHost;
}


/// La palette slash si apre a inizio riga o dopo uno spazio: dentro una
/// parola il `/` è testo («e/o», «km/h», 24/09).
export function slashOpensAt(lineBefore: string): boolean {
  return lineBefore === "" || /\s$/.test(lineBefore);
}

/// La finestra in cui la lettura raccoglie le modifiche arrivate da un altro
/// riquadro prima di ridisegnarsi.
const READING_SYNC_MS = 120;

/// Costruisce l'adapter compatibile con i chiamanti esistenti.
export function createEditor(parent: HTMLElement, opts: EditorOptions): Editor {
  const resources = opts.documentId ? acquireMarkdownResources(opts.documentId) : undefined;
  const openWikilink = (page: string, heading?: string | null, block?: string | null) =>
    opts.onOpenWikilink(page, heading ?? null, block ?? null);
  const profile = createMarkdownProfile({
    callbacks: {
      openWikilink,
      searchTag: opts.onSearchTag,
      mountRendered: (container, html, actions) => mountMarkdown(container, html, {
        ...actions,
        get documentId() { return resources?.documentId ?? opts.documentId; },
        resources,
        openWikilink,
        openPath: opts.onOpenPath,
        searchTag: opts.onSearchTag,
        toggleTask: readOnly ? undefined : actions.toggleTask,
      }),
    },
    completions: opts.completions,
  });
  let mode: MarkdownMode = "live_preview";
  let forms: readonly SyntaxForm[] | undefined;
  let readOnly = false;
  let unmountReading: (() => void) | null = null;
  const life = openLifetime();
  life.listen(parent, "keydown", (event) => {
    const slash = opts.slash;
    if (
      !slash || event.key !== "/" || event.defaultPrevented || event.isComposing ||
      event.altKey || event.ctrlKey || event.metaKey || readOnly || mode === "reading" ||
      !(event.target instanceof Element) || !event.target.closest(".cm-content")
    ) return;
    const doc = opts.documentId;
    if (doc && slash.currentDoc() !== doc) return;
    // «e/o», 24/09, URL, path e codice restano testo: la palette si apre su
    // una selezione oppure a inizio parola, fuori da codice e link.
    const context = engine.cursorContext();
    if (context.empty && (context.literal || !slashOpensAt(context.lineBefore))) return;
    event.preventDefault();
    event.stopPropagation();
    const text = engine.getDoc();
    const typed = context.empty;
    void openSlashPalette(
      parent,
      engine.selections().primary.text,
      () => !life.closed && parent.isConnected && engine.getDoc() === text &&
        (!doc || slash.currentDoc() === doc),
      slash,
      // Chiusa senza scelta, la palette restituisce la battuta.
      typed ? () => {
        if (!life.closed && engine.getDoc() === text) engine.insertAt(context.head, "/");
      } : undefined,
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
    unmountReading = mountMarkdown(reading, renderMarkdown(text, forms).html, {
      get documentId() { return resources?.documentId ?? opts.documentId; },
      resources,
      openWikilink,
      openPath: opts.onOpenPath,
      searchTag: opts.onSearchTag,
      // In sola lettura vera le caselle risultano disabilitate, così la
      // superficie non sembra interattiva mentre la cancellazione è sospesa.
      toggleTask: readOnly ? undefined : toggleTaskAt,
    });
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

  return {
    setSyntaxForms(next) {
      if (forms !== undefined && forms !== next) resources?.invalidate();
      forms = next;
      profile.setSyntaxForms(next);
      engine.reconfigure();
      syncReading();
    },
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
    undo: () => engine.undo(),
    redo: () => engine.redo(),
    getDoc: () => engine.getDoc(),
    focus: () => {
      if (mode === "reading") reading.focus();
      else engine.focus();
    },
    revealByteOffset: (byteOffset) => {
      // In lettura la selezione di scrittura non si tocca: scorre il DOM reso,
      // convertendo i byte UTF-8 del testo originale nell'offset UTF-16 del
      // normalizzato LF. Le selezioni native della lettura non diventano mai
      // contesto di scrittura.
      if (mode === "reading") {
        const original = engine.getDoc();
        const normalized = byteToNormalizedCharIndices(original, [byteOffset])[0];
        sourceElementAt(reading, normalized)?.scrollIntoView({ block: "start" });
        return;
      }
      engine.revealByteOffset(byteOffset);
    },
    selections: () => engine.selections(),
    insertAtCursor: (text) => engine.insertAtCursor(text),
    insertAtPoint: (x, y, text) => engine.insertAtPoint(x, y, text),
    setMode,
    setReadOnly: (value) => {
      closeSlashPalette(parent);
      readOnly = value;
      engine.setReadOnly(value);
      // Senza callback le caselle risultano disabilitate.
      syncReading();
    },
    destroy: () => {
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
    setTheme: (theme) => engine.setTheme(theme),
  };
}
