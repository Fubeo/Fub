// Superficie canvas della shell: monta CanvasEngine dentro il registro
// esistente senza toccarlo. La registrazione (owner/famiglia/profili/formati)
// resta di Main; qui solo la factory e i modes.
//
// Profilo `canvas`: tela interattiva. Profilo `source`: JSON grezzo in sola
// lettura come fallback quando la vista non è disponibile.

import type {
  EditorSurface,
  SurfaceMountContext,
} from "../core/registry";
import { CanvasEngine, type CanvasChange, type CanvasEngineOptions } from "./engine";
import { t } from "../../i18n/strings";
import type { TextOperation } from "../core/text-operation";

export const CANVAS_OWNER = "fub.shell.canvas";
export const CANVAS_FAMILY = "canvas" as const;
export const CANVAS_PROFILE = "canvas";
export const CANVAS_SOURCE_PROFILE = "source";
export const CANVAS_FORMAT = "canvas";

export interface CanvasSurfaceCallbacks {
  readonly onChange: (paneId: string, change: CanvasChange) => void;
  readonly onSelectionChange: (paneId: string) => void;
  readonly onOpenWikilink?: CanvasEngineOptions["onOpenWikilink"];
  readonly onOpenPath?: CanvasEngineOptions["onOpenPath"];
  readonly onCreateNote?: CanvasEngineOptions["onCreateNote"];
  readonly onPickFile?: CanvasEngineOptions["onPickFile"];
  readonly media?: CanvasEngineOptions["media"];
  readonly attachments?: CanvasEngineOptions["attachments"];
  readonly renderMarkdownForCard?: CanvasEngineOptions["renderMarkdownForCard"];
}

/** Signature precisa del mount per Main: factory + modes + fallback. */
export interface CanvasMountSignature {
  readonly owner: typeof CANVAS_OWNER;
  readonly family: typeof CANVAS_FAMILY;
  readonly defaultProfile: typeof CANVAS_PROFILE;
  readonly profiles: readonly [typeof CANVAS_PROFILE, typeof CANVAS_SOURCE_PROFILE];
  readonly formats: Record<typeof CANVAS_FORMAT, typeof CANVAS_PROFILE>;
  readonly modes: readonly [
    { id: "canvas"; presentation: "surface"; contextMode: "live_preview" },
    { id: "source"; presentation: "surface"; contextMode: "source" },
  ];
}

export const CANVAS_MOUNT: CanvasMountSignature = {
  owner: CANVAS_OWNER,
  family: CANVAS_FAMILY,
  defaultProfile: CANVAS_PROFILE,
  profiles: [CANVAS_PROFILE, CANVAS_SOURCE_PROFILE],
  formats: { canvas: CANVAS_PROFILE },
  modes: [
    { id: "canvas", presentation: "surface", contextMode: "live_preview" },
    { id: "source", presentation: "surface", contextMode: "source" },
  ],
};

/** Crea la superficie canvas per un profilo; la registrazione resta a Main. */
export function mountCanvasSurface(
  profile: string,
  context: SurfaceMountContext,
  callbacks: CanvasSurfaceCallbacks,
): EditorSurface {
  if (profile !== CANVAS_PROFILE && profile !== CANVAS_SOURCE_PROFILE) {
    throw new Error(`canvas surface profile ${profile} is not registered`);
  }
  context.parent.replaceChildren();
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
