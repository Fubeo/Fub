import { createEditor, type Editor, type EditorSlashHost } from "../../editor/editor";
import type { CompletionSources } from "../../editor/completions";
import type { SyntaxForm } from "../../host/contract";
import { api } from "../../host/ipc";
import type { GridHost } from "../grid/engine";
import { onLanguage, t, type Key } from "../../i18n/strings";
import { currentTheme } from "../../theme/theme";
import { GridEngine } from "../grid/engine";
import { mountBaseSurface } from "../base/surface";
import { BASE_OWNER, BASE_PROFILE, BASE_FORMAT } from "../base/data";
import { createTextEngine } from "../text/engine";
import { createPlainTextProfile } from "../text/profiles/plain-text";
import { CANVAS_MOUNT, mountCanvasSurface } from "../canvas/surface";
import { mountMediaSurface, profileForKind, type MediaSurfaceDeps } from "../media/media-surface";
import { mediaKindOfId } from "../media/media-types";
import { makePdfJsLoader, pdfIdWithoutFragment, type PdfJsModule } from "../media/pdf-view";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { CanvasAttachmentPort, CanvasMediaPort } from "../canvas/engine";
import {
  DocumentSurfaceRegistry,
  type EditorSurface,
  type SurfaceCallbacks,
  type SurfaceMountContext,
} from "./registry";

export interface MarkdownEditorSurface extends EditorSurface {
  readonly family: "text";
  readonly profile: "markdown";
  setSyntaxForms(forms: readonly SyntaxForm[]): void;
  insertAtCursor(text: string): boolean;
}

export function isMarkdownSurface(surface: EditorSurface | null): surface is MarkdownEditorSurface {
  return surface?.family === "text" && surface.profile === "markdown";
}

export interface SurfaceBootstrapOptions extends SurfaceCallbacks {
  readonly onOpenWikilink: (page: string, heading: string | null, block: string | null) => void | Promise<void>;
  readonly onOpenPath: (path: string, from?: string) => void | Promise<void>;
  readonly onOpenDocument: (doc: string) => void | Promise<void>;
  readonly onSearchTag: (tag: string) => void;
  readonly completions: CompletionSources;
  readonly slash?: EditorSlashHost;
  readonly gridHost?: GridHost;
  readonly media?: MediaSurfaceDeps;
  readonly canvasMedia?: CanvasMediaPort;
  readonly canvasAttachments?: CanvasAttachmentPort;
  readonly onCreateCanvasNote?: (text: string) => Promise<string>;
  readonly renderCanvasMarkdown?: (nodeId: string, text: string, host: HTMLElement, documentId: string) => (() => void) | void;
}

const MARKDOWN_MODES = [
  { id: "source", label: () => t("mode.source"), presentation: "surface", contextMode: "source" },
  {
    id: "live_preview",
    label: () => t("mode.live"),
    presentation: "surface",
    contextMode: "live_preview",
  },
  {
    id: "reading",
    label: () => t("mode.reading"),
    presentation: "rendered",
    contextMode: "reading",
  },
] as const;

const PLAIN_TEXT_MODES = [
  { id: "source", label: () => t("mode.source"), presentation: "surface", contextMode: "source" },
] as const;

const GRID_MODES = [
  { id: "sheet", label: () => t("mode.sheet"), presentation: "surface", contextMode: "source" },
] as const;

const VIEWER_MODES = [
  { id: "view", label: () => t("mode.reading"), presentation: "surface", contextMode: "reading" },
] as const;


const ERROR_MODES = [
  { id: "error", label: () => t("mode.source"), presentation: "surface", contextMode: "source" },
] as const;

function requireMode(modes: EditorSurface["modes"], mode: string): void {
  if (!modes.some((candidate) => candidate.id === mode)) {
    throw new RangeError(`surface mode ${mode} is not supported`);
  }
}

function markdownSurface(
  editor: Editor,
  context: SurfaceMountContext,
): MarkdownEditorSurface {
  return {
    family: "text",
    profile: "markdown",
    surfaceId: context.paneId,
    modes: MARKDOWN_MODES,
    setMode(mode) {
      requireMode(MARKDOWN_MODES, mode);
      editor.setMode(mode as "source" | "live_preview" | "reading");
    },
    setSyntaxForms: (forms) => editor.setSyntaxForms(forms),
    setDoc: (text) => editor.setDoc(text),
    syncDoc: (update) => editor.syncDoc(update),
    getDoc: () => editor.getDoc(),
    focus: () => editor.focus(),
    revealByteOffset: (byteOffset) => editor.revealByteOffset(byteOffset),
    selections: () => editor.selections(),
    insertAtCursor: (text) => editor.insertAtCursor(text),
    setReadOnly: (readOnly) => editor.setReadOnly(readOnly),
    setTheme: (theme) => editor.setTheme(theme),
    destroy: () => editor.destroy(),
  };
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

  let source = "";
  return {
    family,
    profile,
    surfaceId: context.paneId,
    modes: family === "viewer" ? VIEWER_MODES : ERROR_MODES,
    setMode(mode) {
      requireMode(family === "viewer" ? VIEWER_MODES : ERROR_MODES, mode);
      element.dataset.mode = mode;
    },
    setDoc(text) {
      source = text;
    },
    syncDoc(update) {
      source = typeof update === "string" ? update : update.text;
    },
    getDoc() {
      return source;
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

/** Registers the shell's built-in surface families; plugins use the same registry seam. */
export function createDocumentSurfaceRegistry(
  options: SurfaceBootstrapOptions,
): DocumentSurfaceRegistry {
  const registry = new DocumentSurfaceRegistry();
  registry.register({
    owner: "fub.shell.text",
    family: "text",
    defaultProfile: "plain-text",
    profiles: ["markdown"],
    formats: { markdown: "markdown" },
    sources: { text: "plain-text" },
    factory: {
      mount(profile, context) {
        context.parent.replaceChildren();
        if (profile === "markdown") {
          return markdownSurface(
            createEditor(context.parent, {
              onChange: (change) => options.onChange(context.paneId, change),
              onSelectionChange: () => options.onSelectionChange(context.paneId),
              onOpenWikilink: options.onOpenWikilink,
              onOpenPath: options.onOpenPath,
              onSearchTag: options.onSearchTag,
              documentId: context.documentId,
              completions: options.completions,
              slash: options.slash,
            }),
            context,
          );
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
          setDoc: (text) => engine.setDoc(text),
          syncDoc: (update) => engine.syncDoc(update),
          getDoc: () => engine.getDoc(),
          focus: () => engine.focus(),
          revealByteOffset: (byteOffset) => engine.revealByteOffset(byteOffset),
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
        return mountBaseSurface(profile, context, {
          queryIndex: api.queryIndex,
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
    defaultProfile: "sheet",
    formats: { fubsheet: "sheet" },
    factory: {
      mount(profile, context) {
        if (profile !== "sheet") throw new Error(`grid surface profile ${profile} is not registered`);
        const engine = new GridEngine(context.parent, {
          surfaceId: context.paneId,
          formatId: context.formatId,
          revision: context.revision,
          onChange: (change) => options.onChange(context.paneId, change),
          onSelectionChange: () => options.onSelectionChange(context.paneId),
          grid: options.gridHost,
          theme: currentTheme(),
        });
        return {
          family: "grid",
          profile,
          surfaceId: context.paneId,
          modes: GRID_MODES,
          setMode(mode) {
            requireMode(GRID_MODES, mode);
            context.parent.dataset.surfaceMode = mode;
          },
          setDoc: (text) => engine.setDoc(text),
          syncDoc: (update) => engine.syncDoc(update),
          getDoc: () => engine.getDoc(),
          focus: () => engine.focus(),
          setReadOnly: (readOnly) => engine.setReadOnly(readOnly),
          setTheme: (theme) => engine.setTheme(theme),
          destroy: () => engine.destroy(),
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
    factory: {
      mount(profile, context) {
        return mountCanvasSurface(profile, context, {
          onChange: options.onChange,
          onSelectionChange: options.onSelectionChange,
          onOpenWikilink: options.onOpenWikilink,
          onOpenPath: options.onOpenPath,
          onCreateNote: options.onCreateCanvasNote,
          renderMarkdownForCard: options.renderCanvasMarkdown
            ? (nodeId, text, host) => options.renderCanvasMarkdown!(nodeId, text, host, context.documentId)
            : undefined,
          media: options.canvasMedia,
          attachments: options.canvasAttachments,
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
    selectSourceProfile: (request, fallback) =>
      request.documentId ? profileForKind(mediaKindOfId(pdfIdWithoutFragment(request.documentId))) : fallback,
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
