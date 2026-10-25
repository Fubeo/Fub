import { mountMarkdownSurface, type EditorSlashHost } from "../text/profiles/markdown/surface";
import type { CompletionSources } from "../text/profiles/markdown/completions";
import { api } from "../../host/ipc";
import { openVaultRoot, vaultArg } from "../../state/store";
import type { GridHost } from "../grid/engine";
import type { GridDialogs, GridRibbon } from "../grid/ribbon/ribbon";
import { onLanguage, resolvedLanguage, t, type Key } from "../../i18n/strings";
import { onEvent } from "../../state/kernel";
import { PROOF_NS, type ProofPorts } from "./proof-ports";
import { currentTheme } from "../../theme/theme";
import { GridEngine } from "../grid/engine";
import { gridContextMenu, gridMiniBar, type GridMenuHost } from "../grid/menu";
import { mountBaseSurface } from "../base/surface";
import { BASE_OWNER, BASE_PROFILE, BASE_FORMAT } from "../base/data";
import { createTextEngine } from "../text/engine";
import { createPlainTextProfile } from "../text/profiles/plain-text";
import { CANVAS_MOUNT, mountCanvasSurface } from "../canvas/surface";
import { mountRichSurface, RICH_FAMILY, RICH_FORMATS, RICH_OWNER, RICH_PROFILE } from "../rich/surface";
import { mountMediaSurface, profileForKind, type MediaSurfaceDeps } from "../media/media-surface";
import { mediaKindOfId, mimeOfId } from "../media/media-types";
import { mountSvgSurface, SVG_PROFILE } from "../text/profiles/svg";
import { makePdfJsLoader, pdfIdWithoutFragment, type PdfJsModule } from "../media/pdf-view";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { CanvasAttachmentPort, CanvasMediaPort } from "../canvas/engine";
import type { DrawingImagePort } from "../canvas/surface";
import type { VaultFontPort } from "../spatial/fonts/vault";
import type { SymbolLibraryPort } from "../spatial/tools/symbol-libraries";
import type { GridDialog, SyntaxForm } from "../../host/contract";
import {
  DocumentSurfaceRegistry,
  type EditorSurface,
  type SurfaceCallbacks,
  type SurfaceExport,
  type SurfaceMountContext,
} from "./registry";

export interface SurfaceBootstrapOptions extends SurfaceCallbacks {
  readonly onOpenWikilink: (page: string, heading: string | null, block: string | null) => void | Promise<void>;
  readonly onOpenPath: (path: string, from?: string) => void | Promise<void>;
  /// Scarica nel vault un'immagine remota di una nota, col consenso
  /// dell'utente: il link relativo del file, o `null` se ha detto di no.
  readonly onImportRemoteImage?: (url: string, from: string) => Promise<string | null>;
  readonly onOpenDocument: (doc: string) => void | Promise<void>;
  readonly onSearchTag: (tag: string) => void;
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
  readonly onPickCanvasFile?: () => Promise<string | null>;
  /// Il documento a cui porta un collegamento del disegno `from`, scelto
  /// dall'utente; `current` è l'`href` del collegamento che si cambia.
  readonly onPickDrawingLink?: (from: string, current: string | null) => Promise<string | null>;
  /// Le immagini del vault dei disegni: aperte, lette e scelte dalla shell.
  readonly drawingImages?: DrawingImagePort;
  /// I file di caratteri del vault, che i testi dei disegni possono usare:
  /// elencati e letti dalla shell.
  readonly drawingFonts?: VaultFontPort;
  /// Le librerie di simboli del vault: la cartella, i file e il loro testo,
  /// dalla shell.
  readonly drawingSymbols?: SymbolLibraryPort;
  readonly renderCanvasMarkdown?: (
    nodeId: string,
    text: string,
    host: HTMLElement,
    documentId: string,
    forms: readonly SyntaxForm[] | undefined,
  ) => (() => void) | void;
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
  { id: "source", label: () => t("mode.source"), presentation: "surface", contextMode: "source" },
] as const;

const GRID_MODES = [
  { id: "sheet", label: () => t("mode.sheet"), presentation: "surface", contextMode: "live_preview" },
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
  { id: "view", label: () => t("mode.reading"), presentation: "surface", contextMode: "reading" },
] as const;


const ERROR_MODES = [
  { id: "error", label: () => t("mode.source"), presentation: "surface", contextMode: "reading" },
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

const loadPdf = makePdfJsLoader(
  () => import("pdfjs-dist/build/pdf.min.mjs") as unknown as Promise<PdfJsModule>,
  pdfWorkerUrl,
);

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
            onImportRemoteImage: options.onImportRemoteImage,
            onSearchTag: options.onSearchTag,
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
  registry.register({
    owner: "fub.shell.grid",
    family: "grid",
    defaultProfile: "workbook",
    // Una cartella di Excel si apre sui suoi byte con il protocollo a byte
    // (`editors/grid/workbook.ts`).
    profiles: ["workbook"],
    formats: { xlsx: "workbook" },
    factory: {
      mount(profile, context) {
        if (profile !== "workbook") throw new Error(`grid surface profile ${profile} is not registered`);
        // La barra multifunzione e le finestre arrivano con un `import()`: chi
        // non apre una cartella di Excel non le scarica. La barra si aggiorna
        // con i richiami del motore, al più una volta per fotogramma; una
        // finestra chiesta prima che arrivino aspetta e si apre con loro.
        let ribbon: GridRibbon | null = null;
        let dialogs: GridDialogs | null = null;
        let waiting: GridDialog | null = null;
        let destroyed = false;
        const engine = new GridEngine(context.parent, {
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
          family: "grid",
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
          setTheme: (theme) => engine.setTheme(theme),
          contextMenu: (at) => gridContextMenu(menuHost, at),
          miniBar: () => gridMiniBar(menuHost),
          destroy: () => {
            destroyed = true;
            ribbon?.destroy();
            ribbon = null;
            dialogs?.destroy();
            dialogs = null;
            waiting = null;
            engine.destroy();
          },
        };
      },
    },
  });
  registry.register({
    owner: CANVAS_MOUNT.owner,
    family: CANVAS_MOUNT.family,
    defaultProfile: CANVAS_MOUNT.defaultProfile,
    profiles: CANVAS_MOUNT.profiles,
    formats: CANVAS_MOUNT.formats,
    sourceViews: CANVAS_MOUNT.sourceViews,
    factory: {
      mount(profile, context) {
        return mountCanvasSurface(profile, context, {
          onChange: options.onChange,
          onSelectionChange: options.onSelectionChange,
          onOpenWikilink: options.onOpenWikilink,
          onOpenPath: options.onOpenPath,
          onCreateNote: options.onCreateCanvasNote,
          onPickFile: options.onPickCanvasFile,
          onPickDrawingLink: options.onPickDrawingLink,
          drawingImages: options.drawingImages,
          drawingFonts: options.drawingFonts,
          drawingSymbols: options.drawingSymbols,
          renderMarkdownForCard: options.renderCanvasMarkdown
            ? (nodeId, text, host, forms) => options.renderCanvasMarkdown!(nodeId, text, host, context.documentId, forms)
            : undefined,
          media: options.canvasMedia,
          attachments: options.canvasAttachments,
          // Le annotazioni leggono il PDF come il visore: stessi byte, stesso
          // pdf.js.
          pdf: options.media ? { transport: options.media.transport, loader: options.media.pdfLoader ?? loadPdf } : undefined,
        });
      },
    },
  });
  registry.register({
    owner: RICH_OWNER,
    family: RICH_FAMILY,
    defaultProfile: RICH_PROFILE,
    formats: RICH_FORMATS,
    factory: {
      mount(profile, context) {
        return mountRichSurface(profile, context, {
          onChange: options.onChange,
          onSelectionChange: options.onSelectionChange,
          images: options.drawingImages,
          proof: {
            ports: proofPorts(openVaultRoot()),
            notify: options.slash ? (message) => options.slash!.notify(message) : undefined,
          },
        });
      },
    },
  });
  registry.register({
    owner: "fub.shell.viewer",
    family: "viewer",
    defaultProfile: "bytes-read-only",
    profiles: ["media-image", "media-audio", "media-video", "media-pdf"],
    sources: { bytes: "bytes-read-only" },
    // L'unica classificazione di un file senza formato: la tabella MIME della
    // shell sceglie la vista, e ciò che nessuna vista sa mostrare non è di
    // questa famiglia. Un SVG è testo: lo prende la famiglia `text`, che lo
    // scrive con l'anteprima accanto invece di mostrarlo e basta.
    selectSourceProfile: (request, fallback) => {
      if (!request.documentId) return fallback;
      if (mimeOfId(request.documentId) === "image/svg+xml") return null;
      const kind = mediaKindOfId(pdfIdWithoutFragment(request.documentId));
      return kind === "other" ? null : profileForKind(kind);
    },
    factory: {
      mount(profile, context) {
        return options.media
          ? mountMediaSurface(profile, context, { ...options.media, pdfLoader: options.media.pdfLoader ?? loadPdf })
          : staticSurface("viewer", profile, context, "viewer.unavailable");
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
  return registry;
}
