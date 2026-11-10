import { mountMarkdownSurface, type EditorSlashHost, type PageIcons, type SystemTarget } from "../text/profiles/markdown/surface";
import type { CompletionSources } from "../text/profiles/markdown/completions";
import type { LinkCardSource } from "../text/profiles/markdown/link-card";
import { api } from "../../host/ipc";
import { openVaultRoot, state as shellState, vaultArg } from "../../state/store";
import type { GridHost } from "../grid/engine";
import type { GridDialogs, GridRibbon } from "../grid/ribbon/ribbon";
import type { GridMenuHost } from "../grid/menu";
import type { GridPalette } from "../grid/palette/commands";
import { onLanguage, resolvedLanguage, t, type Key } from "../../i18n/strings";
import { onEvent } from "../../state/kernel";
import { PROOF_NS, type ProofPorts } from "./proof-ports";
import { currentTheme } from "../../theme/theme";
import { mountBaseSurface } from "../base/surface";
import { BASE_OWNER, BASE_PROFILE, BASE_FORMAT } from "../base/data";
import { createTextEngine } from "../text/engine";
import { createPlainTextProfile } from "../text/profiles/plain-text";
import { mountMediaSurface, profileForKind, type MediaSurfaceDeps } from "../media/media-surface";
import { mediaKindOfId, mimeOfId } from "../media/media-types";
import { mountSvgSurface, SVG_PROFILE } from "../text/profiles/svg";
import {
  CRAFT_FAMILY, CRAFT_FORMATS, CRAFT_OWNER, CRAFT_PROFILE, MEDIA_RAW_PROFILE, RAW_PROFILE, XMP_PROFILE, mountCraftSurface,
  type CraftSurfaceDeps,
} from "../craft/index";
import { CRAFT_PREVIEW_COMMAND } from "../../host/craft";
import { isRawPhoto } from "../../ui/format-kind";
import { showPhotoData } from "../craft/photo-data";
import { makePdfJsLoader, pdfIdWithoutFragment, type PdfEngineLoader, type PdfJsModule } from "../media/pdf-view";
import type { CanvasAttachmentPort, CanvasCards, CanvasMediaPort } from "../canvas/engine";
import type { DrawingImagePort } from "../canvas/surface";
import type { CardEditorPort, CardMode, CardRenderer, CardSnapshots, CardView } from "../canvas/cards";
import type { NoteCardPort } from "../canvas/cards/note";
import type { WebCardPort } from "../canvas/cards/web";
import type { SheetCardPort } from "../grid/card";
import { openResourcePort, type ResourcePort, type ResourceTransport } from "../media/resource-port";
import { isErrorKind } from "../../host/errors";
import {
  CANVAS_FAMILY,
  CANVAS_FORMAT,
  CANVAS_OWNER,
  CANVAS_PROFILE,
  CANVAS_SOURCE_PROFILE,
  FUBANN_FORMAT,
  GRID_FAMILY,
  GRID_FORMAT,
  GRID_OWNER,
  GRID_PROFILE,
  MEDIA_PDF_PROFILE,
  PDF_PROFILE,
  RICH_FAMILY,
  RICH_FORMATS,
  RICH_OWNER,
  RICH_PROFILE,
  SVG_FORMAT,
  UI_CANVAS,
  UI_CRAFT,
  UI_GRID,
  UI_MEDIA,
  UI_RICH,
  UI_SPATIAL,
  UI_TEXT,
  VECTOR_PROFILE,
  VIEWER_OWNER,
} from "./component-surfaces";
import type { VaultFontPort } from "../spatial/fonts/vault";
import type { DrawingSurfaceCallbacks } from "../spatial/lazy";
import type { GridDialog, SyntaxForm } from "../../host/contract";
import { adaptedPaper, type Look } from "../../theme/content-look";
import {
  DocumentSurfaceRegistry,
  type EditorSurface,
  type SurfaceCallbacks,
  type SurfaceExport,
  type SurfaceMountContext,
  type SurfaceFactory,
  type SurfaceRegistration,
} from "./registry";

export interface SurfaceBootstrapOptions extends SurfaceCallbacks {
  readonly onOpenWikilink: (page: string, heading: string | null, block: string | null) => void | Promise<void>;
  readonly onOpenPath: (path: string, from?: string) => void | Promise<void>;
  /// Il clic su una figura di una nota (un file Craft, un PDF): apre il suo
  /// documento col gesto e non crea mai una nota.
  readonly onOpenFigure?: (doc: string) => void | Promise<void>;
  /// «Apri a lato» dal menu di un wikilink: la nota in un riquadro accanto.
  readonly onOpenWikilinkBeside?: (page: string, heading: string | null, block: string | null) => void | Promise<void>;
  /// «Apri a lato» dal menu di una scheda della lavagna: il file `path` (con
  /// il suo `#…`) in un riquadro accanto, come `onOpenPath`.
  readonly onOpenPathBeside?: (path: string, from?: string) => void | Promise<void>;
  /// «Sposta anche il file nel cestino» dal menu di una scheda della lavagna:
  /// il documento `path` nel cestino col gesto dell'albero. `true` se ci è
  /// andato, `false` se è rimasto; un rifiuto dell'host è un errore.
  readonly onTrashPath?: (path: string) => Promise<boolean>;
  /// Un file nominato da una nota aperto con un'altra app o mostrato
  /// nell'esploratore.
  readonly onShowFile?: (target: SystemTarget, from: string, where: "app" | "explorer") => void | Promise<void>;
  /// Scarica nel vault un'immagine remota di una nota, col consenso
  /// dell'utente: il link relativo del file, o `null` se ha detto di no.
  readonly onImportRemoteImage?: (url: string, from: string) => Promise<string | null>;
  readonly onOpenDocument: (doc: string) => void | Promise<void>;
  readonly onSearchTag: (tag: string) => void;
  /// Apre le impostazioni sul gruppo della riga `key` (la scheda di un file
  /// Craft, per il consenso e il peso massimo).
  readonly onOpenSettings?: (key: string) => void;
  /// Rinomina una pagina dal titolo della testata dei Blocchi: `null` se è
  /// andata, altrimenti la frase che dice perché no.
  readonly onRenamePage?: (doc: string, name: string) => Promise<string | null>;
  /// «Nuova sottopagina» dalla testata dei Blocchi.
  readonly onNewSubpage?: (doc: string, name: string) => Promise<string | null>;
  /// Le icone delle pagine per i wikilink della Live.
  readonly pageIcons?: PageIcons;
  /// Le schede dei collegamenti della Live (K8).
  readonly linkCards?: LinkCardSource;
  /// Un comando della shell dato da dentro una superficie, come dalla
  /// palette: lo zoom della barra del documento.
  readonly runShellCommand?: (id: string) => void;
  /// Una superficie che chiede un'altra modalità, o un altro aspetto del
  /// contenuto, per il suo riquadro: come dal selettore della banda.
  readonly requestMode?: (paneId: string, mode: string) => void;
  readonly requestLook?: (paneId: string, look: Look) => void;
  readonly completions: CompletionSources;
  readonly slash?: EditorSlashHost;
  readonly gridHost?: GridHost;
  /// Un export registrato del documento `doc`, chiesto da dentro la
  /// superficie come dal menu del riquadro: se si può adesso, e come.
  readonly exportDocument?: { available(): boolean; run(doc: string, chosen: SurfaceExport): void };
  /// La revisione dei byte da cui il testo della sessione di `doc` discende
  /// adesso: una cartella di Excel ci apre il suo giornale.
  readonly documentBase?: (doc: string) => string | null;
  readonly media?: MediaSurfaceDeps;
  readonly canvasMedia?: CanvasMediaPort;
  readonly canvasAttachments?: CanvasAttachmentPort;
  readonly onCreateCanvasNote?: (text: string) => Promise<string>;
  /// Il file del vault per una scheda: scelto dall'utente. Con `name` (il nome
  /// di un file mancante, «Ritrova…») gli omonimi vengono per primi.
  readonly onPickCanvasFile?: (name?: string) => Promise<string | null>;
  /// Il documento a cui porta un collegamento del disegno `from`, scelto
  /// dall'utente; `current` è l'`href` del collegamento che si cambia.
  readonly onPickDrawingLink?: (from: string, current: string | null) => Promise<string | null>;
  /// Le immagini del vault dei disegni: aperte, lette e scelte dalla shell.
  readonly drawingImages?: DrawingImagePort;
  /// I file di caratteri del vault, che i testi dei disegni possono usare:
  /// elencati e letti dalla shell.
  readonly drawingFonts?: VaultFontPort;
  /// Ciò che la shell carica insieme al codice dei disegni, la prima volta che
  /// un disegno si apre (i comandi della sessione live): il disegno si monta
  /// quando è arrivato anche questo.
  readonly withDrawings?: () => Promise<void>;
  readonly renderCanvasMarkdown?: (
    nodeId: string,
    text: string,
    host: HTMLElement,
    documentId: string,
    forms: readonly SyntaxForm[] | undefined,
  ) => (() => void) | void;
  /// Le porte delle schede di file e di link della lavagna (N6). Le immagini
  /// e i PDF si leggono dalla `transport` di `media`, i fogli con le chiamate
  /// di `gridHost`. Assente (un'altra finestra, le prove vecchie): le schede
  /// hanno il corpo di sempre.
  readonly canvasCards?: CanvasCardPorts;
}

/// Ciò che la shell dà alle schede della lavagna. Ogni porta legge e basta:
/// nessun renderer scrive il file che mostra. Si scrive soltanto con
/// `editors`, sulla sessione del documento.
export interface CanvasCardPorts {
  /// La nota resa dentro la scheda: `renderEmbed` e la montatura delle schede
  /// di testo.
  readonly note: Pick<NoteCardPort, "show">;
  /// Il giornale, la base e il formato da cui una scheda di foglio apre la
  /// sua sessione (A-9).
  readonly sheet: Pick<SheetCardPort, "source">;
  /// Le schede delle pagine web: la cache delle schede di link e il visore.
  readonly web: WebCardPort;
  /// Apre il file di una scheda («Apri», il doppio clic).
  open(path: string, subpath: string | null): void;
  /// Avvisa quando il file `path` cambia, sparisce o cambia nome; restituisce
  /// come smettere.
  watch(path: string, changed: () => void): () => void;
  /// La porta per scrivere dentro le schede (T40): l'editor vero del file,
  /// sulla stessa sessione di un riquadro. Senza, le schede restano in lettura.
  readonly editors?: CardEditorPort;
}

/// Le porte del correttore legate al vault in cui la superficie nasce: le
/// impostazioni e il dizionario personale sono di quel vault.
function proofPorts(vault: string | null | undefined): ProofPorts {
  return {
    queryIndex: (query) => api.queryIndex(query, ...vaultArg(vault)),
    invokeCommand: (command, args) => api.invokeCommand(command, args, undefined, ...vaultArg(vault)),
    settings: async () => {
      const response = await api.queryIndex({ kind: "settings", plugin: PROOF_NS }, ...vaultArg(vault));
      return response.kind === "settings" ? response.value : [];
    },
    interfaceLanguage: resolvedLanguage,
    watch: (changed) => {
      const stops = [
        onEvent("setting_changed", ({ key }) => {
          if (key.startsWith("proof.") || key === "locale.language") changed();
        }),
        onEvent("vault_opened", changed),
        onLanguage(changed),
      ];
      return () => stops.forEach((stop) => stop());
    },
  };
}

const PLAIN_TEXT_MODES = [
  { id: "source", label: () => t("mode.source"), presentation: "surface", contextMode: "source", looks: ["tema"] },
] as const;

/// Il foglio sta sulla carta del file, o con i colori del file adattati alla
/// carta del tema; le intestazioni di righe e colonne sono cornice.
const GRID_MODES = [
  { id: "sheet", label: () => t("mode.sheet"), presentation: "surface", contextMode: "live_preview", looks: ["file", "adattato"] },
] as const;

/// La stampa in PDF di una cartella, con l'export dell'host (`xlsx.copy.pdf`):
/// la barra dei fogli la chiede come il menu del riquadro.
const GRID_EXPORTS: readonly SurfaceExport[] = [
  {
    target: "xlsx.copy.pdf",
    label: () => t("grid.export.pdf"),
    detail: () => t("grid.export.pdf.desc"),
    options: () => ({ sheets: "all" }),
  },
];

const VIEWER_MODES = [
  { id: "view", label: () => t("mode.reading"), presentation: "surface", contextMode: "reading", looks: ["file"] },
] as const;


const ERROR_MODES = [
  { id: "error", label: () => t("mode.source"), presentation: "surface", contextMode: "reading", looks: ["tema"] },
] as const;

function requireMode(modes: EditorSurface["modes"], mode: string): void {
  if (!modes.some((candidate) => candidate.id === mode)) {
    throw new RangeError(`surface mode ${mode} is not supported`);
  }
}

function staticSurface(
  family: "viewer" | "error",
  profile: string,
  context: SurfaceMountContext,
  messageKey: Key,
): EditorSurface {
  const element = document.createElement("div");
  element.className = `document-surface document-surface-${family}`;
  element.tabIndex = 0;
  element.setAttribute("role", family === "error" ? "alert" : "document");
  element.dataset.i18nLabel = messageKey;
  context.parent.replaceChildren(element);

  let active = true;
  const redraw = () => {
    if (!active) return;
    const message = t(messageKey);
    element.textContent = family === "error" && context.errorReason
      ? `${message}: ${context.errorReason}`
      : message;
    element.setAttribute("aria-label", message);
  };
  redraw();
  const stopLanguage = onLanguage(redraw);

  return {
    family,
    profile,
    surfaceId: context.paneId,
    modes: family === "viewer" ? VIEWER_MODES : ERROR_MODES,
    setMode(mode) {
      requireMode(family === "viewer" ? VIEWER_MODES : ERROR_MODES, mode);
      element.dataset.mode = mode;
    },
    focus() {
      element.focus();
    },
    setTheme(theme) {
      element.dataset.theme = theme;
    },
    destroy() {
      if (!active) return;
      active = false;
      stopLanguage();
      element.remove();
    },
  };
}

/// Le parole della banda per il modo della cella di una cartella.
const GRID_MODE_KEYS = { ready: "grid.mode.ready", insert: "grid.mode.insert", edit: "grid.mode.edit" } as const satisfies Record<string, Key>;

/// pdf.js e il suo worker arrivano con un `import()` quando un PDF si apre
/// davvero: il primo PDF, o la stampa di una cartella. L'indirizzo del worker è
/// un modulo anche lui, perché anche soltanto nominarlo all'avvio porterebbe
/// pdf.js nel grafo dei chunk iniziali (piano K2, D-1).
let pdfEngine: Promise<PdfEngineLoader> | null = null;

function pdfEngineLoader(): Promise<PdfEngineLoader> {
  pdfEngine ??= import("pdfjs-dist/build/pdf.worker.min.mjs?url").then(
    ({ default: workerUrl }) => makePdfJsLoader(
      () => import("pdfjs-dist/build/pdf.min.mjs") as unknown as Promise<PdfJsModule>,
      workerUrl,
    ),
    (error: unknown) => {
      pdfEngine = null;
      throw error;
    },
  );
  return pdfEngine;
}

const loadPdf: PdfEngineLoader = async (bytes) => (await pdfEngineLoader())(bytes);

/// Le immagini ferme delle schede: una cache sola per finestra, per tutte le
/// lavagne che vi si aprono, legata al vault in cui si sono fatte. Una lavagna
/// montata in un altro vault la svuota: lo stesso percorso è un altro file.
let windowSnapshots: { readonly cache: CardSnapshots & { clear(): void }; vault: string | undefined } | null = null;

/// Le schede di una superficie della lavagna, dato il suo contenitore.
type CanvasCardsFor = (context: SurfaceMountContext) => CanvasCards;

/// I renderer delle schede, caricati col codice della lavagna (A-14): non
/// pesano sull'avvio di Fub. La scheda di foglio arriva con un suo `import()`
/// al primo foglio.
async function loadCanvasCards(options: SurfaceBootstrapOptions, ports: CanvasCardPorts): Promise<CanvasCardsFor> {
  const [cards, { CardCache }, note, image, pdf, web] = await Promise.all([
    import("../canvas/cards"),
    import("../canvas/card-cache"),
    import("../canvas/cards/note"),
    import("../canvas/cards/image"),
    import("../canvas/cards/pdf"),
    import("../canvas/cards/web"),
  ]);
  windowSnapshots ??= { cache: new CardCache(), vault: openVaultRoot() };
  const snapshots = windowSnapshots.cache;
  // Un file cambiato non mostra più l'immagine ferma di prima, in nessuna
  // scheda: la cache lo dimentica prima che la scheda lo rilegga.
  const watch = (path: string, changed: () => void): (() => void) =>
    ports.watch(path, () => {
      snapshots.forget(path);
      changed();
    });
  const open = (path: string, subpath: string | null): void => ports.open(path, subpath);
  const fixed: CardRenderer[] = [
    note.noteCardRenderer({ show: ports.note.show, watch, open }),
    web.webCardRenderer(ports.web),
  ];
  const media = options.media;
  if (media) {
    const transport = media.transport;
    fixed.push(
      image.imageCardRenderer({
        read: async (path) => {
          const port = await openCardResource(transport, path);
          if (!port) return null;
          try {
            // Oltre il tetto della scheda i byte non si leggono: la scheda
            // lo dice dal descrittore.
            const bytes = port.descriptor.len > image.IMAGE_CARD_MAX_BYTES ? new Uint8Array(0) : await port.readAll();
            return { bytes, descriptor: port.descriptor };
          } finally {
            await port.close();
          }
        },
        open: (path) => open(path, null),
        watch,
      }),
      pdf.pdfCardRenderer({
        read: async (path) => {
          const port = await openCardResource(transport, path);
          if (!port) return null;
          try {
            return await port.readAll();
          } finally {
            await port.close();
          }
        },
        load: media.pdfLoader ?? loadPdf,
        watch,
      }),
    );
  }
  const grid = options.gridHost;
  return (context) => {
    const vault = openVaultRoot();
    if (windowSnapshots && windowSnapshots.vault !== vault) {
      windowSnapshots.cache.clear();
      windowSnapshots.vault = vault;
    }
    const renderers = [...fixed];
    if (grid) {
      renderers.push(lazySheetRenderer(async () => {
        const { sheetCardRenderer } = await import("../grid/card");
        return sheetCardRenderer({
          host: grid,
          source: ports.sheet.source,
          // La carta del tema, se il riquadro della lavagna mostra l'aspetto
          // adattato.
          paper: () => adaptedPaper(context.parent) ?? undefined,
          watch,
          open,
        });
      }));
    }
    // Lo stesso ascolto dei renderer: una scheda mancante aspetta il file con questo.
    return { registry: cards.createCardRegistry(renderers), snapshots, watch };
  };
}

/// Apre i byte di una scheda nel vault di adesso; `null` se il file non c'è.
async function openCardResource(transport: ResourceTransport, path: string): Promise<ResourcePort | null> {
  try {
    return await openResourcePort(transport, path, openVaultRoot());
  } catch (error) {
    if (isErrorKind(error, "not_found")) return null;
    throw error;
  }
}

/// Il tetto dei byte che si leggono per misurare un'immagine: quello della
/// scheda d'immagine e del deposito.
const MEASURE_IMAGE_MAX_BYTES = 64 * 1024 * 1024;

/// La misura in pixel di un'immagine del vault, per la scheda che nasce dal
/// rilascio sulla lavagna (T15): dall'intestazione del file se la dice
/// (`decodeImage`), sennò dall'immagine decodificata. `null` se il file non
/// c'è, è oltre il tetto, o non si decodifica: la tela usa la misura di serie.
function measureCanvasImage(transport: ResourceTransport) {
  return async (path: string): Promise<{ width: number; height: number } | null> => {
    try {
      const port = await openCardResource(transport, path);
      if (!port) return null;
      let bytes: Uint8Array;
      try {
        if (port.descriptor.len > MEASURE_IMAGE_MAX_BYTES) return null;
        bytes = await port.readAll();
      } finally {
        await port.close().catch(() => undefined);
      }
      const { decodeImage } = await import("../media/image-view");
      const decoded = decodeImage(port.descriptor, bytes);
      try {
        if (decoded.width && decoded.height) return { width: decoded.width, height: decoded.height };
        const image = new Image();
        image.src = decoded.url;
        await image.decode();
        return image.naturalWidth > 0 && image.naturalHeight > 0
          ? { width: image.naturalWidth, height: image.naturalHeight }
          : null;
      } finally {
        URL.revokeObjectURL(decoded.url);
      }
    } catch {
      return null;
    }
  };
}

/// L'HTML degli appunti come Markdown, con la stessa conversione dell'incolla
/// dell'editor Markdown: il suo codice arriva al primo incolla di celle.
async function clipboardMarkdown(data: DataTransfer): Promise<string | null> {
  const { markdownFromClipboard } = await import("../text/profiles/markdown/paste");
  return markdownFromClipboard(data);
}

/// Il renderer delle schede di foglio, il cui codice arriva col primo foglio.
/// Finché non c'è, la vista tiene il modo che la tela le chiede e lo passa
/// alla scheda vera appena montata; una vista distrutta prima non monta
/// niente. Un `import()` fallito lascia la scheda com'è e si riprova alla
/// scheda dopo.
function lazySheetRenderer(load: () => Promise<CardRenderer>): CardRenderer {
  let loaded: CardRenderer | null = null;
  let loading: Promise<CardRenderer> | null = null;
  return {
    kinds: ["sheet"],
    mount(node, host, mode, context): CardView {
      if (loaded) return loaded.mount(node, host, mode, context);
      let view: CardView | null = null;
      let current: CardMode = mode;
      let destroyed = false;
      loading ??= load().then(
        (renderer) => (loaded = renderer),
        (error: unknown) => {
          loading = null;
          throw error;
        },
      );
      loading.then(
        (renderer) => {
          if (destroyed || context.lifetime.closed) return;
          try {
            view = renderer.mount(node, host, current, context);
          } catch (error) {
            console.warn(`canvas: la scheda ${node.id} non si mostra (sheet)`, error);
          }
        },
        (error: unknown) => console.warn("canvas: la scheda di foglio non si carica", error),
      );
      return {
        setMode(next) {
          current = next;
          view?.setMode(next);
        },
        resize: () => view?.resize?.(),
        enter: () => view?.enter?.() ?? false,
        leave: () => view?.leave?.(),
        key: (event) => view?.key?.(event) ?? false,
        destroy() {
          destroyed = true;
          const mounted = view;
          view = null;
          mounted?.destroy();
        },
      };
    },
  };
}

/**
 * Registers the shell's built-in surface families. Every owner goes through
 * `register`, whose disposer takes down what the owner mounted; the owners are
 * the shell's own, because a third-party surface would need a declarative
 * surface contract that does not exist yet.
 */
export function createDocumentSurfaceRegistry(
  options: SurfaceBootstrapOptions,
): DocumentSurfaceRegistry {
  const registry = new DocumentSurfaceRegistry();
  registry.register({
    owner: "fub.shell.text",
    family: "text",
    defaultProfile: "plain-text",
    profiles: ["markdown", SVG_PROFILE],
    formats: { markdown: "markdown" },
    sources: { text: "plain-text" },
    // Un file che nessun formato serve si scrive col profilo che la tabella
    // MIME della shell gli dà: un SVG accanto alla sua anteprima, il resto
    // come testo semplice. Mai `null`: ciò che si legge come testo si mostra.
    selectSourceProfile: (request, fallback) =>
      request.documentId && mimeOfId(request.documentId) === "image/svg+xml" ? SVG_PROFILE : fallback,
    factory: {
      mount(profile, context) {
        context.parent.replaceChildren();
        if (profile === SVG_PROFILE) {
          return mountSvgSurface(context, {
            onChange: (change) => options.onChange(context.paneId, change),
            onSelectionChange: () => options.onSelectionChange(context.paneId),
          });
        }
        if (profile === "markdown") {
          return mountMarkdownSurface(context, {
            onChange: (change) => options.onChange(context.paneId, change),
            onSelectionChange: () => options.onSelectionChange(context.paneId),
            onOpenWikilink: options.onOpenWikilink,
            onOpenPath: options.onOpenPath,
            ...(options.onOpenFigure ? { onOpenFigure: options.onOpenFigure } : {}),
            onOpenWikilinkBeside: options.onOpenWikilinkBeside,
            onOpenDocument: options.onOpenDocument,
            onShowFile: options.onShowFile,
            onImportRemoteImage: options.onImportRemoteImage,
            onSearchTag: options.onSearchTag,
            onRenamePage: options.onRenamePage,
            onNewSubpage: options.onNewSubpage,
            pageIcons: options.pageIcons,
            linkCards: options.linkCards,
            completions: options.completions,
            slash: options.slash,
            proof: {
              ports: proofPorts(openVaultRoot()),
              notify: options.slash ? (message) => options.slash!.notify(message) : undefined,
            },
          });
        }
        if (profile !== "plain-text") {
          throw new Error(`text surface profile ${profile} is not registered`);
        }
        const plain = createPlainTextProfile();
        const engine = createTextEngine(context.parent, {
          onChange: (change) => options.onChange(context.paneId, change),
          onSelectionChange: () => options.onSelectionChange(context.paneId),
          theme: currentTheme(),
          extensions: () => plain.extensions(),
        });
        return {
          family: "text",
          profile: "plain-text",
          surfaceId: context.paneId,
          modes: PLAIN_TEXT_MODES,
          setMode(mode) {
            requireMode(PLAIN_TEXT_MODES, mode);
            context.parent.dataset.surfaceMode = mode;
          },
          buffer: {
            setDoc: (text) => engine.setDoc(text),
            syncDoc: (update) => engine.syncDoc(update),
            getDoc: () => engine.getDoc(),
          },
          focus: () => engine.focus(),
          find: () => engine.openFind(),
          reveal: ({ span }) => {
            engine.revealByteOffset(span.start);
            return true;
          },
          selections: () => engine.selections(),
          setReadOnly: (readOnly) => engine.setReadOnly(readOnly),
          setTheme: (theme) => engine.setTheme(theme),
          destroy: () => engine.destroy(),
        };
      },
    },
  });
  registry.register({
    owner: BASE_OWNER,
    family: "structured",
    defaultProfile: BASE_PROFILE,
    formats: { [BASE_FORMAT]: BASE_PROFILE },
    factory: {
      mount(profile, context) {
        // Il vault in cui la superficie nasce (FUB-001).
        const vault = openVaultRoot();
        return mountBaseSurface(profile, context, {
          queryIndex: (query) => api.queryIndex(query, ...vaultArg(vault)),
          invokeCommand: api.invokeCommand,
          viewState: api.viewState,
          setViewState: api.setViewState,
          onOpenDocument: options.onOpenDocument,
        });
      },
    },
  });
  const parts = new Map<string, () => void>();
  const craft = craftDeps(options);
  registry.register({
    owner: VIEWER_OWNER,
    family: "viewer",
    defaultProfile: "bytes-read-only",
    // Il profilo PDF è di `fub.pdf` (`COMPONENT_EDITORS`): un PDF col
    // componente spento non è di questa famiglia, e lo mostra il riquadro
    // «solo come file».
    profiles: ["media-image", "media-audio", "media-video", MEDIA_RAW_PROFILE],
    sources: { bytes: "bytes-read-only" },
    // L'unica classificazione di un file senza formato: la tabella MIME della
    // shell sceglie la vista, e ciò che nessuna vista sa mostrare non è di
    // questa famiglia. Un SVG è testo: lo prende la famiglia `text`, che lo
    // scrive con l'anteprima accanto invece di mostrarlo e basta.
    selectSourceProfile: (request, fallback) => {
      if (!request.documentId) return fallback;
      // Una foto RAW non ha un formato del vault: la prende il profilo
      // `media-raw`, che monta la scheda di `editors/craft` col profilo `raw`,
      // solo se il componente «File delle app Craft» risponde a
      // `craft.preview`. Spento, il RAW resta un file senza vista.
      if (isRawPhoto(request.documentId)) {
        return shellState.commandSpecs.some((spec) => spec.id === CRAFT_PREVIEW_COMMAND) ? MEDIA_RAW_PROFILE : null;
      }
      if (mimeOfId(request.documentId) === "image/svg+xml") return null;
      const kind = mediaKindOfId(pdfIdWithoutFragment(request.documentId));
      if (kind === "pdf" && !parts.has(MEDIA_PDF_PART)) return null;
      return kind === "other" ? null : profileForKind(kind);
    },
    factory: {
      mount(profile, context) {
        if (profile === MEDIA_RAW_PROFILE) {
          return mountCraftSurface(RAW_PROFILE, context, craft, { family: "viewer", profile: MEDIA_RAW_PROFILE });
        }
        return mountViewer(options, profile, context);
      },
    },
  });
  registry.register({
    owner: "fub.shell.error",
    family: "error",
    defaultProfile: "unsupported",
    factory: {
      mount(profile, context) {
        return staticSurface("error", profile, context, "surface.unavailable");
      },
    },
  });
  components.set(registry, { options, parts });
  setComponentEditors(registry, () => true);
  return registry;
}

/// Il visore di immagini, audio, video e PDF: senza le porte dei media dice
/// soltanto che non può mostrare il file.
function mountViewer(options: SurfaceBootstrapOptions, profile: string, context: SurfaceMountContext): EditorSurface {
  return options.media
    ? mountMediaSurface(profile, context, {
      ...options.media,
      pdfLoader: options.media.pdfLoader ?? loadPdf,
      // I dati di LightCraft sotto la foto, solo col componente «File delle
      // app Craft» acceso: spento, il kernel non elenca `craft.photo` e la
      // foto non chiede niente; acceso dopo, la riga arriva da sola
      // (`state/craft-photos.ts`).
      photoData: options.media.photoData ?? {
        show: (root, doc, life) =>
          showPhotoData(root, doc, { onOpenDocument: options.onOpenDocument, onSearchTag: options.onSearchTag }, life),
      },
    })
    : staticSurface("viewer", profile, context, "viewer.unavailable");
}

type GridModule = typeof import("../grid/engine");
type GridMenuModule = typeof import("../grid/menu");

function mountGrid(
  options: SurfaceBootstrapOptions,
  grid: GridModule,
  menu: GridMenuModule,
  profile: string,
  context: SurfaceMountContext,
): EditorSurface {
    if (profile !== GRID_PROFILE) throw new Error(`grid surface profile ${profile} is not registered`);
    // La barra multifunzione e le finestre arrivano con un `import()`: chi
    // non apre una cartella di Excel non le scarica. La barra si aggiorna
    // con i richiami del motore, al più una volta per fotogramma; una
    // finestra chiesta prima che arrivino aspetta e si apre con loro.
    let ribbon: GridRibbon | null = null;
    let dialogs: GridDialogs | null = null;
    let waiting: GridDialog | null = null;
    let destroyed = false;
    // Il modo della cella, nella banda di stato: «Pronto», «Inserisci» o
    // «Modifica», come nei fogli di calcolo.
    const statusListeners = new Set<() => void>();
    const engine = new grid.GridEngine(context.parent, {
      surfaceId: context.paneId,
      formatId: context.formatId,
      revision: context.revision,
      documentId: context.documentId,
      base: () => options.documentBase?.(context.documentId) ?? context.revision ?? null,
      onChange: (change) => options.onChange(context.paneId, change),
      onSelectionChange: () => {
        options.onSelectionChange(context.paneId);
        ribbon?.schedule();
      },
      onCommands: () => ribbon?.schedule(),
      onView: () => ribbon?.schedule(),
      onEditMode: () => {
        for (const listener of statusListeners) listener();
      },
      onDialog: (dialog) => {
        if (dialogs) dialogs.open(dialog);
        else waiting = dialog;
      },
      grid: options.gridHost,
      theme: currentTheme(),
      pdf: options.media?.pdfLoader ?? loadPdf,
      exportPdf: options.exportDocument && {
        available: () => options.exportDocument!.available(),
        run: () => options.exportDocument!.run(context.documentId, GRID_EXPORTS[0]!),
      },
    });
    // L'aspetto lo decide la shell con la classe `look-*` del contenitore:
    // nell'adattato le celle portano i colori del file sulla carta del tema.
    const looks = new MutationObserver(() => engine.setPaper(adaptedPaper(context.parent)));
    looks.observe(context.parent, { attributes: true, attributeFilter: ["class"] });
    engine.setPaper(adaptedPaper(context.parent));
    // I comandi del catalogo nella tavolozza arrivano allo stesso modo.
    let palette: GridPalette | null = null;
    void import("../grid/palette/commands").then(
      ({ mountGridPalette }) => {
        if (!destroyed) palette = mountGridPalette(engine);
      },
      () => {},
    );
    void import("../grid/ribbon/ribbon").then(
      ({ mountRibbon, mountGridDialogs }) => {
        if (destroyed) return;
        ribbon = mountRibbon(engine);
        dialogs = mountGridDialogs(engine);
        if (waiting) dialogs.open(waiting);
        waiting = null;
      },
      () => {},
    );
    const menuHost: GridMenuHost = {
      engine,
      ribbon: () => ribbon,
      notify: options.slash ? (message) => options.slash!.notify(message) : undefined,
    };
    return {
      family: GRID_FAMILY,
      profile,
      surfaceId: context.paneId,
      modes: GRID_MODES,
      exports: GRID_EXPORTS,
      setMode(mode) {
        requireMode(GRID_MODES, mode);
        context.parent.dataset.surfaceMode = mode;
      },
      buffer: {
        setDoc: (text) => engine.setDoc(text),
        syncDoc: (update) => engine.syncDoc(update),
        getDoc: () => engine.getDoc(),
      },
      focus: () => engine.focus(),
      selectedText: () => engine.selectedText(),
      setReadOnly: (readOnly) => engine.setReadOnly(readOnly),
      setTheme: (theme) => {
        engine.setTheme(theme);
        engine.setPaper(adaptedPaper(context.parent));
      },
      contextMenu: (at) => menu.gridContextMenu(menuHost, at),
      miniBar: () => menu.gridMiniBar(menuHost),
      paletteCommands: () => palette?.commands() ?? [],
      status: {
        counts: false,
        items: () => [{
          id: "grid-mode",
          text: t(GRID_MODE_KEYS[engine.editMode()]),
          hint: t("grid.mode.hint"),
        }],
        subscribe(listener) {
          statusListeners.add(listener);
          return () => statusListeners.delete(listener);
        },
      },
      destroy: () => {
        destroyed = true;
        statusListeners.clear();
        looks.disconnect();
        ribbon?.destroy();
        ribbon = null;
        palette?.destroy();
        palette = null;
        dialogs?.destroy();
        dialogs = null;
        waiting = null;
        engine.destroy();
      },
    };
}

/// Un pezzo di un editor legato a un componente: la sua registrazione, che
/// porta formati, famiglia e profili senza il codice, che arriva col suo
/// `import()` (`LazySurfaceFactory`) soltanto quando un file lo chiede.
interface EditorPart {
  /// Il nome del pezzo, unico fra tutti.
  readonly id: string;
  /// Gli altri pezzi di interfaccia che devono essere accesi anche loro.
  readonly alsoNeeds?: readonly string[];
  registration(options: SurfaceBootstrapOptions): SurfaceRegistration;
}

const MEDIA_PDF_PART = "media.pdf";

/// Ciò che la scheda dei file Craft chiede alla shell.
function craftDeps(options: SurfaceBootstrapOptions): CraftSurfaceDeps {
  return {
    onOpenDocument: options.onOpenDocument,
    onSearchTag: options.onSearchTag,
    ...(options.onOpenSettings ? { onOpenSettings: options.onOpenSettings } : {}),
  };
}

/// I collegamenti, le immagini e i caratteri di un disegno o delle
/// annotazioni di un PDF, come per la lavagna.
function drawingCallbacks(options: SurfaceBootstrapOptions): DrawingSurfaceCallbacks {
  return {
    onChange: options.onChange,
    onSelectionChange: options.onSelectionChange,
    onOpenPath: options.onOpenPath,
    onPickDrawingLink: options.onPickDrawingLink,
    drawingImages: options.drawingImages,
    drawingFonts: options.drawingFonts,
    shellCommand: options.runShellCommand,
    // Le annotazioni leggono il PDF come il visore: stessi byte, stesso
    // pdf.js.
    pdf: options.media ? { transport: options.media.transport, loader: options.media.pdfLoader ?? loadPdf } : undefined,
  };
}

/// La tabella sola che lega il campo `ui` di una riga di `components_map` al
/// codice del suo editor e alla sua registrazione. `editors/text` è del nucleo
/// e non c'è: le sue superfici si registrano sempre.
export const COMPONENT_EDITORS: Readonly<Record<string, readonly EditorPart[]>> = {
  [UI_GRID]: [{
    id: "grid",
    registration: (options) => ({
      owner: GRID_OWNER,
      family: GRID_FAMILY,
      defaultProfile: GRID_PROFILE,
      // Una cartella di Excel si apre sui suoi byte con il protocollo a byte
      // (`editors/grid/workbook.ts`).
      profiles: [GRID_PROFILE],
      formats: { [GRID_FORMAT]: GRID_PROFILE },
      factory: {
        load: async () => {
          const [grid, menu] = await Promise.all([import("../grid/engine"), import("../grid/menu")]);
          return { mount: (profile, context) => mountGrid(options, grid, menu, profile, context) };
        },
      },
    }),
  }],
  [UI_RICH]: [{
    id: "rich",
    registration: (options) => ({
      owner: RICH_OWNER,
      family: RICH_FAMILY,
      defaultProfile: RICH_PROFILE,
      formats: RICH_FORMATS,
      factory: {
        load: async () => {
          const { mountRichSurface } = await import("../rich/surface");
          return {
            mount: (profile, context) => mountRichSurface(profile, context, {
              onChange: options.onChange,
              onSelectionChange: options.onSelectionChange,
              images: options.drawingImages,
              shellCommand: options.runShellCommand ? (id) => () => options.runShellCommand!(id) : undefined,
              requestMode: options.requestMode ? (mode) => options.requestMode!(context.paneId, mode) : undefined,
              requestLook: options.requestLook ? (look) => options.requestLook!(context.paneId, look) : undefined,
              proof: {
                ports: proofPorts(openVaultRoot()),
                notify: options.slash ? (message) => options.slash!.notify(message) : undefined,
              },
            }),
          };
        },
      },
    }),
  }],
  // I file delle app Craft e gli XMP (`fub.craft`), in sola lettura: la
  // superficie arriva con un `import()` alla prima scheda (`editors/craft/`).
  [UI_CRAFT]: [{
    id: "craft",
    registration: (options) => ({
      owner: CRAFT_OWNER,
      family: CRAFT_FAMILY,
      defaultProfile: CRAFT_PROFILE,
      profiles: [XMP_PROFILE],
      formats: CRAFT_FORMATS,
      factory: {
        mount: (profile, context) => mountCraftSurface(profile, context, craftDeps(options)),
      },
    }),
  }],
  // La lavagna (`fub.lavagna`): la tela e il suo sorgente.
  [UI_CANVAS]: [{
    id: "canvas.board",
    registration: (options) => ({
      owner: CANVAS_OWNER,
      family: CANVAS_FAMILY,
      defaultProfile: CANVAS_PROFILE,
      profiles: [CANVAS_PROFILE, CANVAS_SOURCE_PROFILE],
      formats: { [CANVAS_FORMAT]: CANVAS_PROFILE },
      factory: {
        load: async () => {
          const [{ mountCanvasSurface }, cards] = await Promise.all([
            import("../canvas/surface"),
            options.canvasCards ? loadCanvasCards(options, options.canvasCards) : null,
          ]);
          return {
            mount: (profile, context) => mountCanvasSurface(profile, context, {
              onChange: options.onChange,
              onSelectionChange: options.onSelectionChange,
              onFail: options.onFail,
              onOpenWikilink: options.onOpenWikilink,
              onOpenPath: options.onOpenPath,
              ...(options.onOpenPathBeside ? { onOpenPathBeside: options.onOpenPathBeside } : {}),
              ...(options.onTrashPath ? { onTrashPath: options.onTrashPath } : {}),
              onCreateNote: options.onCreateCanvasNote,
              onPickFile: options.onPickCanvasFile,
              ...(options.onOpenSettings ? { onOpenSettings: options.onOpenSettings } : {}),
              onPickDrawingLink: options.onPickDrawingLink,
              drawingImages: options.drawingImages,
              drawingFonts: options.drawingFonts,
              shellCommand: options.runShellCommand,
              renderMarkdownForCard: options.renderCanvasMarkdown
                ? (nodeId, text, host, forms) => options.renderCanvasMarkdown!(nodeId, text, host, context.documentId, forms)
                : undefined,
              media: options.canvasMedia,
              attachments: options.canvasAttachments,
              cards: cards?.(context),
              cardEditors: options.canvasCards?.editors,
              ...(options.media ? { measureImage: measureCanvasImage(options.media.transport) } : {}),
              clipboardMarkdown: clipboardMarkdown,
            }),
          };
        },
      },
    }),
  }],
  // I disegni (`fub.draw`), nella stessa famiglia della lavagna ma senza di
  // lei; le annotazioni di un PDF vogliono anche il lettore PDF.
  [UI_SPATIAL]: [{
    id: "spatial.vector",
    registration: (options) => ({
      owner: CANVAS_OWNER,
      family: CANVAS_FAMILY,
      defaultProfile: VECTOR_PROFILE,
      formats: { [SVG_FORMAT]: VECTOR_PROFILE },
      sourceViews: { [VECTOR_PROFILE]: { family: "text", profile: SVG_PROFILE } },
      factory: { load: () => drawingFactory(options) },
    }),
  }, {
    id: "spatial.pdf",
    alsoNeeds: [UI_MEDIA],
    registration: (options) => ({
      owner: CANVAS_OWNER,
      family: CANVAS_FAMILY,
      defaultProfile: PDF_PROFILE,
      formats: { [FUBANN_FORMAT]: PDF_PROFILE },
      sourceViews: { [PDF_PROFILE]: { family: "text", profile: SVG_PROFILE } },
      factory: { load: () => drawingFactory(options) },
    }),
  }],
  // Il lettore PDF (`fub.pdf`): soltanto il profilo PDF del visore, con
  // pdf.js e il suo worker. Immagini, audio e video sono del nucleo.
  [UI_MEDIA]: [{
    id: MEDIA_PDF_PART,
    registration: (options) => ({
      owner: VIEWER_OWNER,
      family: "viewer",
      defaultProfile: MEDIA_PDF_PROFILE,
      factory: {
        load: async () => {
          await pdfEngineLoader();
          return { mount: (profile, context) => mountViewer(options, profile, context) };
        },
      },
    }),
  }],
};

async function drawingFactory(options: SurfaceBootstrapOptions): Promise<SurfaceFactory> {
  const [{ mountDrawingSurface }] = await Promise.all([import("../spatial/lazy"), options.withDrawings?.()]);
  return {
    mount(profile: string, context: SurfaceMountContext): EditorSurface {
      context.parent.replaceChildren();
      return mountDrawingSurface(profile, context, drawingCallbacks(options));
    },
  };
}

interface ComponentEditorState {
  readonly options: SurfaceBootstrapOptions;
  /// I pezzi registrati adesso, col disposer della loro registrazione.
  readonly parts: Map<string, () => void>;
}

const components = new WeakMap<DocumentSurfaceRegistry, ComponentEditorState>();
const unknownLogged = new Set<string>();

/// `ui` ha il suo caricatore: è del nucleo o sta in `COMPONENT_EDITORS`.
export function hasComponentEditor(ui: string): boolean {
  return ui === UI_TEXT || Object.prototype.hasOwnProperty.call(COMPONENT_EDITORS, ui);
}

/// Registra i pezzi degli editor i cui `ui` sono accesi e toglie gli altri,
/// insieme a ciò che avevano montato: chi spegne un componente col suo file
/// aperto porta prima il riquadro altrove (`document-controller.ts`). Un `ui`
/// che `named` nomina e che la tabella non conosce si ignora, e lo si dice nei
/// log di sviluppo.
export function setComponentEditors(
  registry: DocumentSurfaceRegistry,
  uiOn: (ui: string) => boolean,
  named: Iterable<string> = [],
): void {
  const state = components.get(registry);
  if (!state) throw new Error("the registry was not created by createDocumentSurfaceRegistry");
  for (const ui of named) {
    if (hasComponentEditor(ui) || unknownLogged.has(ui)) continue;
    unknownLogged.add(ui);
    if (import.meta.env.DEV) console.warn(`Fub: nessun editor per il pezzo di interfaccia «${ui}»: si ignora.`);
  }
  for (const [ui, editorParts] of Object.entries(COMPONENT_EDITORS)) {
    for (const part of editorParts) {
      const wanted = uiOn(ui) && (part.alsoNeeds ?? []).every(uiOn);
      const unregister = state.parts.get(part.id);
      if (wanted && !unregister) {
        state.parts.set(part.id, registry.register(part.registration(state.options)));
      } else if (!wanted && unregister) {
        state.parts.delete(part.id);
        unregister();
      }
    }
  }
}
