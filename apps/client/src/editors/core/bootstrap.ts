import { createEditor, type Editor } from "../../editor/editor";
import type { CompletionSources } from "../../editor/completions";
import type { SyntaxForm } from "../../host/contract";
import { currentTheme } from "../../theme/theme";
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
  setLivePreview(on: boolean): void;
}

export function isMarkdownSurface(surface: EditorSurface | null): surface is MarkdownEditorSurface {
  return surface?.family === "text" && surface.profile === "markdown";
}

export interface SurfaceBootstrapOptions extends SurfaceCallbacks {
  readonly onOpenWikilink: (page: string, heading: string | null, block: string | null) => void;
  readonly onSearchTag: (tag: string) => void;
  readonly completions: CompletionSources;
}

function markdownSurface(
  editor: Editor,
  context: SurfaceMountContext,
): MarkdownEditorSurface {
  return {
    family: "text",
    profile: "markdown",
    surfaceId: context.paneId,
    setSyntaxForms: (forms) => editor.setSyntaxForms(forms),
    setLivePreview: (on) => editor.setLivePreview(on),
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
  message: string,
): EditorSurface {
  const element = document.createElement("div");
  element.className = `document-surface document-surface-${family}`;
  element.tabIndex = 0;
  element.setAttribute("role", family === "error" ? "alert" : "document");
  element.textContent = message;
  context.parent.replaceChildren(element);
  let source = "";
  return {
    family,
    profile,
    surfaceId: context.paneId,
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
    owner: "fub.shell.viewer",
    family: "viewer",
    defaultProfile: "bytes-read-only",
    sources: { bytes: "bytes-read-only" },
    factory: {
      mount(profile, context) {
        return staticSurface("viewer", profile, context, "Anteprima binaria non disponibile");
      },
    },
  });
  registry.register({
    owner: "fub.shell.error",
    family: "error",
    defaultProfile: "unsupported",
    factory: {
      mount(profile, context) {
        return staticSurface("error", profile, context, "Nessuna superficie disponibile");
      },
    },
  });
  return registry;
}
