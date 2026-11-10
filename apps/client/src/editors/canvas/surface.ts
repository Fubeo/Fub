// Superficie canvas della shell: monta CanvasEngine dentro il registro
// esistente senza toccarlo. La registrazione (owner/famiglia/profili/formati)
// resta di Main; qui solo la factory e i modes.
//
// Profilo `canvas`: tela interattiva. Profilo `source`: JSON grezzo in sola
// lettura come fallback quando la vista non è disponibile. Profilo `vector`:
// i disegni di FubDraw (`editors/spatial/surface.ts`), per il formato `svg`
// che il kernel monta con la feature `draw`; senza quel formato il profilo
// non riceve documenti. Profilo `pdf`: le annotazioni di un PDF
// (`editors/spatial/pdf/surface.ts`), per il formato `fubann` della stessa
// feature.

import type {
  EditorSurface,
  SurfaceMountContext,
} from "../core/registry";
import { CanvasEngine, type CanvasCards, type CanvasChange, type CanvasEngineOptions } from "./engine";
import type { CardEditing, CardEditorPort } from "./cards";
import { canvasCoreLoaded, canvasCoreReady } from "./wasm/core";
import { t } from "../../i18n/strings";
import { errorText } from "../../host/errors";
import { notify } from "../../ui/notify";
import type { SyntaxForm } from "../../host/contract";
import type { Theme } from "../../theme/theme";
import type { EditorChange, TextOperation } from "../core/text-operation";
import type { VaultFontPort } from "../spatial/fonts/vault";
import { mountDrawingSurface } from "../spatial/lazy";
import {
  CANVAS_FAMILY,
  CANVAS_FORMAT,
  CANVAS_OWNER,
  CANVAS_PROFILE,
  CANVAS_SOURCE_PROFILE,
  FUBANN_FORMAT,
  PDF_PROFILE,
  SVG_FORMAT,
  VECTOR_PROFILE,
} from "../core/component-surfaces";
import type { PdfPorts } from "../spatial/pdf/surface";
import type { Lifetime } from "../../ui/lifetime";
import { api } from "../../host/ipc";
import { createCanvasViewMemory } from "./view-state";
import { createCanvasInspector } from "./chrome/inspector";

// I descrittori stanno in un modulo leggero, che la shell legge all'avvio
// senza caricare la lavagna.
export { CANVAS_FAMILY, CANVAS_FORMAT, CANVAS_OWNER, CANVAS_PROFILE, CANVAS_SOURCE_PROFILE, FUBANN_FORMAT, SVG_FORMAT };

export interface CanvasSurfaceCallbacks {
  /** A drawing's change is a plain text operation; a board's is a `CanvasOperation`. */
  readonly onChange: (paneId: string, change: CanvasChange | EditorChange) => void;
  readonly onSelectionChange: (paneId: string) => void;
  /** The board's text turned out not to be a board after the core loaded: the shell shows its error surface. */
  readonly onFail?: (paneId: string, error: unknown) => void;
  readonly onOpenWikilink?: CanvasEngineOptions["onOpenWikilink"];
  readonly onOpenPath?: CanvasEngineOptions["onOpenPath"];
  /** «Apri a lato» dal menu di una scheda di file (T17). */
  readonly onOpenPathBeside?: CanvasEngineOptions["onOpenPathBeside"];
  /** «Sposta anche il file nel cestino» dal menu di una scheda (T17): il gesto dell'albero. */
  readonly onTrashPath?: CanvasEngineOptions["onTrashPath"];
  readonly onCreateNote?: CanvasEngineOptions["onCreateNote"];
  readonly onPickFile?: CanvasEngineOptions["onPickFile"];
  /** Apre le Impostazioni su una voce: la cartella dei file trascinati, dalla banda di stato. */
  readonly onOpenSettings?: (key: string) => void;
  /** The vault document a drawing's link goes to, chosen by the user: `from` is the drawing, `current` the `href` of the link being changed. */
  readonly onPickDrawingLink?: (from: string, current: string | null) => Promise<string | null>;
  /** The vault images of drawing `from`, resolved by the shell. */
  readonly drawingImages?: DrawingImagePort;
  /** The vault's font files, listed and read by the shell, that a drawing's text can use. */
  readonly drawingFonts?: VaultFontPort;
  readonly media?: CanvasEngineOptions["media"];
  readonly attachments?: CanvasEngineOptions["attachments"];
  readonly renderMarkdownForCard?: CanvasEngineOptions["renderMarkdownForCard"];
  /** Le schede di file e di link (N6): senza, il corpo di sempre. */
  readonly cards?: CanvasEngineOptions["cards"];
  /** La porta per scrivere dentro le schede (T40): arriva alla tela con `cards`. */
  readonly cardEditors?: CardEditorPort;
  /** La misura di un'immagine del vault, per la scheda che nasce dal rilascio (T15): senza, la misura di serie. */
  readonly measureImage?: CanvasEngineOptions["measureImage"];
  /** L'HTML degli appunti come Markdown, per le celle incollate (T15): senza, solo il testo a tabulazioni. */
  readonly clipboardMarkdown?: CanvasEngineOptions["clipboardMarkdown"];
  /** Where annotations read their PDF: without it the pages are blank. */
  readonly pdf?: PdfPorts;
  /** Runs a shell command, like the export window a drawing's «Export» opens. */
  readonly shellCommand?: (id: string) => void;
}

/**
 * The vault images of a drawing: `path` is an image `href` as the drawing
 * `from` writes it, relative to the drawing or from the vault root.
 */
export interface DrawingImagePort {
  /** The image's URL, opened for `life`; `null` when it does not resolve. */
  url(path: string, from: string, life: Lifetime): Promise<string | null>;
  /**
   * The image's bytes, with their type; `null` when it does not resolve, or
   * when it weighs more than `limit` bytes, which are then not read.
   */
  read(path: string, from: string, limit?: number): Promise<Blob | null>;
  /** Asks the user for a vault image to put in the drawing: its `DocId`, or `null`. */
  pick?(from: string): Promise<string | null>;
}

/** Signature precisa del mount per Main: factory + modes + fallback. */
export interface CanvasMountSignature {
  readonly owner: typeof CANVAS_OWNER;
  readonly family: typeof CANVAS_FAMILY;
  readonly defaultProfile: typeof CANVAS_PROFILE;
  readonly profiles: readonly [typeof CANVAS_PROFILE, typeof CANVAS_SOURCE_PROFILE, typeof VECTOR_PROFILE, typeof PDF_PROFILE];
  readonly formats: {
    readonly [CANVAS_FORMAT]: typeof CANVAS_PROFILE;
    readonly [SVG_FORMAT]: typeof VECTOR_PROFILE;
    readonly [FUBANN_FORMAT]: typeof PDF_PROFILE;
  };
  readonly modes: readonly [
    { id: "canvas"; presentation: "surface"; contextMode: "live_preview" },
    { id: "source"; presentation: "surface"; contextMode: "source" },
    { id: "draw"; presentation: "surface"; contextMode: "live_preview" },
    { id: "read"; presentation: "rendered"; contextMode: "reading" },
  ];
  /** «Apri come sorgente»: a drawing, and annotations, are also SVG text, with the preview beside. */
  readonly sourceViews: {
    readonly [VECTOR_PROFILE]: { readonly family: "text"; readonly profile: "svg" };
    readonly [PDF_PROFILE]: { readonly family: "text"; readonly profile: "svg" };
  };
}

export const CANVAS_MOUNT: CanvasMountSignature = {
  owner: CANVAS_OWNER,
  family: CANVAS_FAMILY,
  defaultProfile: CANVAS_PROFILE,
  profiles: [CANVAS_PROFILE, CANVAS_SOURCE_PROFILE, VECTOR_PROFILE, PDF_PROFILE],
  formats: { [CANVAS_FORMAT]: CANVAS_PROFILE, [SVG_FORMAT]: VECTOR_PROFILE, [FUBANN_FORMAT]: PDF_PROFILE },
  modes: [
    { id: "canvas", presentation: "surface", contextMode: "live_preview" },
    { id: "source", presentation: "surface", contextMode: "source" },
    { id: "draw", presentation: "surface", contextMode: "live_preview" },
    { id: "read", presentation: "rendered", contextMode: "reading" },
  ],
  sourceViews: {
    [VECTOR_PROFILE]: { family: "text", profile: "svg" },
    [PDF_PROFILE]: { family: "text", profile: "svg" },
  },
};

/**
 * La vista ricordata delle lavagne (T36), negli stati di vista di questo
 * computer: una sola memoria per tutte le superfici, così la lavagna
 * riaperta legge dopo l'ultima scrittura di quella chiusa.
 */
const VIEW_MEMORY = createCanvasViewMemory({
  get: (key) => api.viewState<unknown>(key),
  set: (key, value) => api.setViewState(key, value),
});

/**
 * Le schede della tela con la porta per scriverci dentro (T40), se la shell
 * la dà: la tela la trova accanto al registro (`CardEditing`) e non importa
 * nessun editor. Senza porta, le schede di sempre.
 */
function withEditors(cards: CanvasCards, editors: CardEditorPort | undefined): CanvasCards {
  if (!editors) return cards;
  const editing: CanvasCards & CardEditing = { ...cards, editors };
  return editing;
}

/** Crea la superficie canvas per un profilo; la registrazione resta a Main. */
export function mountCanvasSurface(
  profile: string,
  context: SurfaceMountContext,
  callbacks: CanvasSurfaceCallbacks,
): EditorSurface {
  if (profile !== CANVAS_PROFILE && profile !== CANVAS_SOURCE_PROFILE && profile !== VECTOR_PROFILE && profile !== PDF_PROFILE) {
    throw new Error(`canvas surface profile ${profile} is not registered`);
  }
  context.parent.replaceChildren();
  if (profile === VECTOR_PROFILE || profile === PDF_PROFILE) {
    return mountDrawingSurface(profile, context, callbacks);
  }
  const host = document.createElement("div");
  host.className = "canvas-surface-host";
  const source = document.createElement("pre");
  source.className = "canvas-source";
  source.tabIndex = 0;
  source.setAttribute("role", "document");
  context.parent.append(host, source);
  // Chi ascolta il testo in sospeso delle schede: la sessione, tramite il controller.
  const pendingWatchers = new Set<(pending: boolean) => void>();
  // Chi ascolta la banda di stato (T52): la shell, quando la lavagna ha il fuoco.
  const statusWatchers = new Set<() => void>();
  // L'ispettore (T58): legge il testo della lavagna e porta la vista su una
  // scheda per la strada di `reveal`. Si offre solo con la tela in vista.
  const inspector = createCanvasInspector({
    source: () => engine?.getDoc() ?? null,
    reveal: (byte) => mode === "canvas" && engine !== null && engine.revealSource(byte),
  });
  const offerInspector = (): void => inspector.offer(!destroyed && !failed && engine !== null && mode === "canvas");
  const createEngine = (): CanvasEngine => new CanvasEngine(host, {
    surfaceId: context.paneId,
    formatId: context.formatId,
    revision: context.revision,
    documentId: context.documentId,
    onChange: (change) => {
      inspector.changed();
      callbacks.onChange(context.paneId, change);
    },
    onSelectionChange: () => {
      inspector.selectionChanged();
      callbacks.onSelectionChange(context.paneId);
    },
    onOpenWikilink: callbacks.onOpenWikilink,
    onOpenPath: callbacks.onOpenPath,
    ...(callbacks.onOpenPathBeside ? { onOpenPathBeside: callbacks.onOpenPathBeside } : {}),
    ...(callbacks.onTrashPath ? { onTrashPath: callbacks.onTrashPath } : {}),
    onCreateNote: callbacks.onCreateNote,
    onPickFile: callbacks.onPickFile,
    media: callbacks.media,
    attachments: callbacks.attachments,
    renderMarkdownForCard: callbacks.renderMarkdownForCard,
    ...(callbacks.cards ? { cards: withEditors(callbacks.cards, callbacks.cardEditors) } : {}),
    ...(callbacks.measureImage ? { measureImage: callbacks.measureImage } : {}),
    ...(callbacks.clipboardMarkdown ? { clipboardMarkdown: callbacks.clipboardMarkdown } : {}),
    viewMemory: VIEW_MEMORY,
    onPendingChange: (pending) => {
      for (const watcher of [...pendingWatchers]) watcher(pending);
    },
    onStatusChange: () => {
      for (const watcher of [...statusWatchers]) watcher();
    },
    ...(callbacks.onOpenSettings ? { onOpenSettings: callbacks.onOpenSettings } : {}),
  });
  // La tela usa il nucleo, che si carica alla prima lavagna aperta e poi
  // resta. Finché non c'è la superficie tiene ciò che la shell le dice, e lo
  // consegna alla tela appena montata, nello stesso ordine.
  let engine: CanvasEngine | null = canvasCoreLoaded() ? createEngine() : null;
  let destroyed = false;
  let failed = false;
  let held: string | null = null;
  let heldReadOnly = false;
  let heldTheme: Theme | null = null;
  let heldForms: readonly SyntaxForm[] | null = null;
  let heldReveal: number | null = null;
  const settle = (): void => {
    if (destroyed || engine) return;
    host.removeAttribute("aria-busy");
    const focused = host === document.activeElement;
    host.removeAttribute("tabindex");
    const mounted = createEngine();
    engine = mounted;
    try {
      if (held !== null) mounted.setDoc(held);
    } catch (error) {
      broken(error);
      return;
    }
    if (heldReadOnly) mounted.setReadOnly(true);
    if (heldTheme) mounted.setTheme(heldTheme);
    if (heldForms) mounted.setSyntaxForms(heldForms);
    if (focused && mode === "canvas") mounted.focus();
    if (heldReveal !== null && !mounted.revealSource(heldReveal)) {
      notify(t("document.reveal_unavailable", { doc: docTitle(context.documentId) }), "info");
    }
    heldReveal = null;
    inspector.changed();
    offerInspector();
  };
  // Il testo tenuto durante il caricamento non è una lavagna: lo stesso esito
  // di un `setDoc` che lancia, la superficie d'errore della shell. Il motore
  // fatto a metà se ne va prima; senza chi ascolta resta l'avviso.
  const broken = (error: unknown): void => {
    if (destroyed) return;
    engine?.destroy();
    engine = null;
    offerInspector();
    if (callbacks.onFail) callbacks.onFail(context.paneId, error);
    else fail(error);
  };
  const fail = (error: unknown): void => {
    if (destroyed) return;
    engine?.destroy();
    engine = null;
    // Il testo resta della sessione: la vista Sorgente lo mostra comunque.
    host.removeAttribute("aria-busy");
    const notice = document.createElement("div");
    notice.className = "vector-notice";
    const text = document.createElement("p");
    text.className = "vector-notice-text";
    text.textContent = t("canvas.core_unavailable");
    notice.append(text);
    host.replaceChildren(notice);
    failed = true;
    offerInspector();
    source.hidden = false;
    notify(errorText(error), "guasto");
  };
  if (!engine) {
    host.setAttribute("aria-busy", "true");
    // Raggiungibile col fuoco come il resto del riquadro, anche prima.
    host.tabIndex = -1;
    void canvasCoreReady().then(settle, fail);
  }
  let mode: "canvas" | "source" = profile === CANVAS_SOURCE_PROFILE ? "source" : "canvas";
  const modes = [
    { id: "canvas", label: () => t("mode.canvas"), presentation: "surface" as const, contextMode: "live_preview" as const, looks: ["tema"] as const },
    { id: "source", label: () => t("mode.source"), presentation: "surface" as const, contextMode: "source" as const, looks: ["tema"] as const },
  ];
  const surface: EditorSurface = {
    family: CANVAS_FAMILY,
    profile: profile === CANVAS_SOURCE_PROFILE ? CANVAS_SOURCE_PROFILE : CANVAS_PROFILE,
    surfaceId: context.paneId,
    modes,
    setMode(next: string): void {
      if (next !== "canvas" && next !== "source") {
        throw new Error(`canvas surface mode ${next} is not registered`);
      }
      mode = next;
      context.parent.dataset.surfaceMode = next;
      host.hidden = next === "source";
      // Senza tela il testo resta in vista.
      source.hidden = next !== "source" && !failed;
      offerInspector();
    },
    buffer: {
      setDoc: (text: string): void => {
        source.textContent = canvasSourceFallback(text);
        if (engine) {
          engine.setDoc(text);
          inspector.changed();
          return;
        }
        // Mentre il nucleo si carica il testo si tiene: se non è una lavagna,
        // `settle` lo dice alla shell (`onFail`), che mostra la superficie
        // d'errore come per un `setDoc` che lancia.
        held = text;
      },
      syncDoc: (update: { readonly text: string; readonly operation: TextOperation | null } | string): void => {
        const text = typeof update === "string" ? update : update.text;
        if (engine) engine.syncDoc(update);
        else held = text;
        inspector.changed();
        source.textContent = canvasSourceFallback(text);
      },
      getDoc: (): string => engine?.getDoc() ?? held ?? "",
      pendingText: (): string | null => engine?.pendingText() ?? null,
      commitPending: (): void => engine?.commitPending(),
      watchPending: (listener: (pending: boolean) => void): (() => void) => {
        pendingWatchers.add(listener);
        return () => pendingWatchers.delete(listener);
      },
    },
    // Le voci della banda (zoom, schede scelte, sola lettura, cartella) le
    // legge la tela adesso; la shell le disegna e le rilegge ad ogni avviso.
    status: {
      counts: true,
      items: () => engine?.statusItems() ?? [],
      subscribe(listener) {
        statusWatchers.add(listener);
        return () => {
          statusWatchers.delete(listener);
        };
      },
    },
    focus: (): void => {
      if (mode === "source") source.focus();
      else if (engine) engine.focus();
      else host.focus({ preventScroll: true });
    },
    // F6 dentro la lavagna: la vista, poi il navigatore se si vede (T55). Il
    // resto del giro (l'ispettore, la banda) è della shell.
    zone: (step): boolean => (mode === "canvas" && engine ? engine.zone(step) : false),
    // Un punto del modello è dentro una carta: la tela la seleziona e la
    // inquadra. Il sorgente grezzo non ha un cursore da portarci.
    reveal: ({ span }) => {
      if (mode !== "canvas") return false;
      if (engine) return engine.revealSource(span.start);
      if (destroyed || host.getAttribute("aria-busy") !== "true") return false;
      heldReveal = span.start;
      return true;
    },
    // Le carte scelte, col loro testo; il sorgente grezzo non seleziona niente.
    selectedText: () => mode === "canvas" ? engine?.selectedText() ?? null : null,
    contextMenu: (at) => mode === "canvas" ? engine?.contextMenu(at) ?? null : null,
    // «Schede» nell'ispettore (T58), come le linguette del disegno.
    panels: inspector.panels,
    // La stampa la disegna il provider del canvas (`render_html`).
    printable: true,
    setReadOnly: (readOnly: boolean): void => {
      heldReadOnly = readOnly;
      engine?.setReadOnly(readOnly);
    },
    setTheme: (theme): void => {
      heldTheme = theme;
      engine?.setTheme(theme);
    },
    // Le card di testo sono Markdown: le sintassi sono quelle del vault.
    setSyntaxForms: (forms): void => {
      heldForms = forms;
      engine?.setSyntaxForms(forms);
    },
    destroy: (): void => {
      destroyed = true;
      engine?.destroy();
      engine = null;
      pendingWatchers.clear();
      statusWatchers.clear();
      inspector.dispose();
    },
  };
  surface.setMode(mode);
  return surface;
}

/** Il nome con cui la shell chiama il documento negli avvisi: il file senza estensione. */
function docTitle(id: string): string {
  const base = id.split("/").pop() || id;
  const point = base.lastIndexOf(".");
  return point > 0 ? base.slice(0, point) : base;
}

/** Fallback sorgente: testo grezzo quando la vista canvas non è disponibile. */
export function canvasSourceFallback(source: string): string {
  return source;
}
