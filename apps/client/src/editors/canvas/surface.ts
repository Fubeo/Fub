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
import { CanvasEngine, type CanvasChange, type CanvasEngineOptions } from "./engine";
import { t } from "../../i18n/strings";
import type { EditorChange, TextOperation } from "../core/text-operation";
import type { VaultFontPort } from "../spatial/fonts/vault";
import type { SymbolLibraryPort } from "../spatial/tools/symbol-libraries";
import { mountPdfSurfaceLazily, mountVectorSurfaceLazily } from "../spatial/lazy";
import { PDF_PROFILE, VECTOR_PROFILE } from "../spatial/modes";
import type { PdfPorts } from "../spatial/pdf/surface";
import type { Lifetime } from "../../ui/lifetime";

export const CANVAS_OWNER = "fub.shell.canvas";
export const CANVAS_FAMILY = "canvas" as const;
export const CANVAS_PROFILE = "canvas";
export const CANVAS_SOURCE_PROFILE = "source";
export const CANVAS_FORMAT = "canvas";
export const SVG_FORMAT = "svg";
export const FUBANN_FORMAT = "fubann";

export interface CanvasSurfaceCallbacks {
  /** A drawing's change is a plain text operation; a board's is a `CanvasOperation`. */
  readonly onChange: (paneId: string, change: CanvasChange | EditorChange) => void;
  readonly onSelectionChange: (paneId: string) => void;
  readonly onOpenWikilink?: CanvasEngineOptions["onOpenWikilink"];
  readonly onOpenPath?: CanvasEngineOptions["onOpenPath"];
  readonly onCreateNote?: CanvasEngineOptions["onCreateNote"];
  readonly onPickFile?: CanvasEngineOptions["onPickFile"];
  /** The vault document a drawing's link goes to, chosen by the user: `from` is the drawing, `current` the `href` of the link being changed. */
  readonly onPickDrawingLink?: (from: string, current: string | null) => Promise<string | null>;
  /** The vault images of drawing `from`, resolved by the shell. */
  readonly drawingImages?: DrawingImagePort;
  /** The vault's font files, listed and read by the shell, that a drawing's text can use. */
  readonly drawingFonts?: VaultFontPort;
  /** The vault's symbol libraries, listed and read by the shell, that a drawing can take symbols from. */
  readonly drawingSymbols?: SymbolLibraryPort;
  readonly media?: CanvasEngineOptions["media"];
  readonly attachments?: CanvasEngineOptions["attachments"];
  readonly renderMarkdownForCard?: CanvasEngineOptions["renderMarkdownForCard"];
  /** Where annotations read their PDF: without it the pages are blank. */
  readonly pdf?: PdfPorts;
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
  if (profile === VECTOR_PROFILE) {
    // I collegamenti di un disegno sono percorsi relativi al disegno: la shell
    // li risolve da lì, come quelli di una nota.
    const openPath = callbacks.onOpenPath;
    const pickLink = callbacks.onPickDrawingLink;
    const images = callbacks.drawingImages;
    const pickImage = images?.pick;
    return mountVectorSurfaceLazily(context, {
      onChange: (change) => callbacks.onChange(context.paneId, change),
      onSelectionChange: () => callbacks.onSelectionChange(context.paneId),
      onOpenPath: openPath === undefined ? undefined : async (path) => {
        await openPath(path, context.documentId);
      },
      onPickLink: pickLink === undefined ? undefined : (current) => pickLink(context.documentId, current),
      // Le immagini, come i collegamenti, si risolvono dal disegno.
      images: images === undefined ? undefined : {
        url: (path, life) => images.url(path, context.documentId, life),
        read: (path, limit) => images.read(path, context.documentId, limit),
        pick: pickImage === undefined ? undefined : () => pickImage(context.documentId),
      },
      vaultFonts: callbacks.drawingFonts,
      // Il disegno aperto non è una libreria per sé stesso.
      symbolLibraries: callbacks.drawingSymbols === undefined ? undefined : { ...callbacks.drawingSymbols, here: context.documentId },
    });
  }
  if (profile === PDF_PROFILE) {
    return mountPdfSurfaceLazily(context, {
      onChange: (change) => callbacks.onChange(context.paneId, change),
      onSelectionChange: () => callbacks.onSelectionChange(context.paneId),
      pdf: callbacks.pdf,
    });
  }
  const host = document.createElement("div");
  host.className = "canvas-surface-host";
  const source = document.createElement("pre");
  source.className = "canvas-source";
  source.tabIndex = 0;
  source.setAttribute("role", "document");
  context.parent.append(host, source);
  const engine = new CanvasEngine(host, {
    surfaceId: context.paneId,
    formatId: context.formatId,
    revision: context.revision,
    documentId: context.documentId,
    onChange: (change) => callbacks.onChange(context.paneId, change),
    onSelectionChange: () => callbacks.onSelectionChange(context.paneId),
    onOpenWikilink: callbacks.onOpenWikilink,
    onOpenPath: callbacks.onOpenPath,
    onCreateNote: callbacks.onCreateNote,
    onPickFile: callbacks.onPickFile,
    media: callbacks.media,
    attachments: callbacks.attachments,
    renderMarkdownForCard: callbacks.renderMarkdownForCard,
  });
  let mode: "canvas" | "source" = profile === CANVAS_SOURCE_PROFILE ? "source" : "canvas";
  const modes = [
    { id: "canvas", label: () => t("mode.canvas"), presentation: "surface" as const, contextMode: "live_preview" as const },
    { id: "source", label: () => t("mode.source"), presentation: "surface" as const, contextMode: "source" as const },
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
      source.hidden = next !== "source";
    },
    buffer: {
      setDoc: (text: string): void => {
        source.textContent = canvasSourceFallback(text);
        engine.setDoc(text);
      },
      syncDoc: (update: { readonly text: string; readonly operation: TextOperation | null } | string): void => {
        engine.syncDoc(update);
        source.textContent = canvasSourceFallback(typeof update === "string" ? update : update.text);
      },
      getDoc: (): string => engine.getDoc(),
    },
    focus: (): void => mode === "source" ? source.focus() : engine.focus(),
    // Un punto del modello è dentro una carta: la tela la seleziona e la
    // inquadra. Il sorgente grezzo non ha un cursore da portarci.
    reveal: ({ span }) => mode === "canvas" && engine.revealSource(span.start),
    // Le carte scelte, col loro testo; il sorgente grezzo non seleziona niente.
    selectedText: () => mode === "canvas" ? engine.selectedText() : null,
    // La stampa la disegna il provider del canvas (`render_html`).
    printable: true,
    setReadOnly: (readOnly: boolean): void => engine.setReadOnly(readOnly),
    setTheme: (theme): void => engine.setTheme(theme),
    // Le card di testo sono Markdown: le sintassi sono quelle del vault.
    setSyntaxForms: (forms): void => engine.setSyntaxForms(forms),
    destroy: (): void => engine.destroy(),
  };
  surface.setMode(mode);
  return surface;
}

/** Fallback sorgente: testo grezzo quando la vista canvas non è disponibile. */
export function canvasSourceFallback(source: string): string {
  return source;
}
