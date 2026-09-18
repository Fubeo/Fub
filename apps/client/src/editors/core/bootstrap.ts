import { createEditor, type Editor } from "../../editor/editor";
import type { CompletionSources } from "../../editor/completions";
import type { SyntaxForm } from "../../host/contract";
import type { GridHost } from "../grid/engine";
import { onLanguage, t, type Key } from "../../i18n/strings";
import { currentTheme } from "../../theme/theme";
import { GridEngine } from "../grid/engine";
import { createTextEngine } from "../text/engine";
import { createPlainTextProfile } from "../text/profiles/plain-text";
import {
  DocumentSurfaceRegistry,
  type EditorSurface,
  type SurfaceCallbacks,
  type SurfaceFamily,
  type SurfaceMountContext,
} from "./registry";

export interface MarkdownEditorSurface extends EditorSurface {
  readonly family: "text";
  readonly profile: "markdown";
  setSyntaxForms(forms: readonly SyntaxForm[]): void;
}

export function isMarkdownSurface(surface: EditorSurface | null): surface is MarkdownEditorSurface {
  return surface?.family === "text" && surface.profile === "markdown";
}

export interface SurfaceBootstrapOptions extends SurfaceCallbacks {
  readonly onOpenWikilink: (page: string, heading: string | null, block: string | null) => void;
  readonly onSearchTag: (tag: string) => void;
  readonly completions: CompletionSources;
  readonly gridHost?: GridHost;
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
      editor.setLivePreview(mode === "live_preview");
    },
    setSyntaxForms: (forms) => editor.setSyntaxForms(forms),
    setDoc: (text) => editor.setDoc(text),
    syncDoc: (update) => editor.syncDoc(update),
    getDoc: () => editor.getDoc(),
    focus: () => editor.focus(),
    revealByteOffset: (byteOffset) => editor.revealByteOffset(byteOffset),
    selections: () => editor.selections(),
    setReadOnly: (readOnly) => editor.setReadOnly(readOnly),
    setTheme: (theme) => editor.setTheme(theme),
    destroy: () => editor.destroy(),
  };
}

function staticSurface(
  family: Extract<SurfaceFamily, "viewer" | "error">,
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
    element.textContent = message;
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

/** Registers the shell's built-in surface families; plugins use the same registry seam. */
export function createDocumentSurfaceRegistry(
  options: SurfaceBootstrapOptions,
): DocumentSurfaceRegistry {
  const registry = new DocumentSurfaceRegistry();
  registry.register({
    owner: "fub.shell.text",
    family: "text",
    defaultProfile: "plain-text",
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
              onSearchTag: options.onSearchTag,
              completions: options.completions,
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
    owner: "fub.shell.viewer",
    family: "viewer",
    defaultProfile: "bytes-read-only",
    sources: { bytes: "bytes-read-only" },
    factory: {
      mount(profile, context) {
        return staticSurface("viewer", profile, context, "viewer.unavailable");
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
