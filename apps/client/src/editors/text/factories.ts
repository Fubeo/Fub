import type { Theme } from "../../theme/theme";
import type {
  EditorSurface,
  SurfaceFactory,
  SurfaceMountContext,
  SurfaceRequest,
  SurfaceViewState,
} from "../core/registry";
import {
  createTextEngine,
  type DocumentUpdate,
  type EditorChange,
  type EditorSelections,
  type TextEngine,
} from "./engine";
import {
  createMarkdownProfile,
  type MarkdownProfile,
} from "./profiles/markdown/profile";
import type { CompletionSources } from "./profiles/markdown/completions";
import type { LivePreviewCallbacks } from "./profiles/markdown/livepreview";
import {
  createPlainTextProfile,
  type PlainTextProfile,
} from "./profiles/plain-text";

export interface TextSurfaceMountContext extends SurfaceMountContext {
  readonly initialText?: string;
  readonly onChange?: (change: EditorChange) => void;
  readonly onSelectionChange?: () => void;
  readonly theme?: Theme;
  readonly markdownCallbacks?: LivePreviewCallbacks;
  readonly completions?: CompletionSources;
}

export interface TextSurfaceFactoryOptions {
  readonly onChange?: (change: EditorChange) => void;
  readonly onSelectionChange?: () => void;
  readonly theme?: Theme;
}

export interface MarkdownSurfaceFactoryOptions extends TextSurfaceFactoryOptions {
  readonly callbacks?: LivePreviewCallbacks;
  readonly completions?: CompletionSources;
}

export interface TextEditorSurface extends EditorSurface {
  readonly family: "text";
  readonly profile: "markdown" | "plain-text";

  setDoc(text: string): void;
  syncDoc(update: DocumentUpdate | string): void;
  currentText(): string;
  undo(): boolean;
  redo(): boolean;
  selections(): EditorSelections;
  revealByteOffset(offset: number): void;
  reconfigure(): void;
}
export interface TextSurfaceFactory extends SurfaceFactory {
  readonly family: "text";
  readonly profile: "markdown" | "plain-text";

  mount(request: SurfaceRequest, context: SurfaceMountContext): TextEditorSurface;
}

const emptyMarkdownCallbacks: LivePreviewCallbacks = {
  openWikilink: () => {},
  searchTag: () => {},
};

const emptyCompletions: CompletionSources = {
  searchNotes: async () => [],
  listTags: async () => [],
};

const emptyChange: (change: EditorChange) => void = () => {};
const emptySelectionChange: () => void = () => {};

let nextTextSurfaceId = 1;

class TextSurface implements TextEditorSurface {
  readonly family = "text" as const;
  readonly profile: "markdown" | "plain-text";
  readonly surfaceId: string;

  private readonly engine: TextEngine;
  private readOnly = false;
  private suspended = false;
  private currentTheme: Theme | undefined;
  private destroyed = false;

  constructor(
    profile: "markdown" | "plain-text",
    engine: TextEngine,
    theme: Theme | undefined,
  ) {
    this.profile = profile;
    this.engine = engine;
    this.currentTheme = theme;
    this.surfaceId = `text-surface-${nextTextSurfaceId++}`;
  }

  setDoc(text: string): void {
    this.engine.setDoc(text);
  }

  syncDoc(update: DocumentUpdate | string): void {
    this.engine.syncDoc(update);
  }

  currentText(): string {
    return this.engine.getDoc();
  }

  undo(): boolean {
    return this.engine.undo();
  }

  redo(): boolean {
    return this.engine.redo();
  }

  selections(): EditorSelections {
    return this.engine.selections();
  }

  revealByteOffset(offset: number): void {
    this.engine.revealByteOffset(offset);
  }

  reconfigure(): void {
    this.engine.reconfigure();
  }

  focus(_target?: unknown): void {
    this.engine.focus();
  }

  setReadOnly(readOnly: boolean): void {
    if (this.destroyed) return;
    this.readOnly = readOnly;
    this.engine.setReadOnly(this.suspended || readOnly);
  }

  setTheme(theme: unknown): void {
    if (this.destroyed || (theme !== "light" && theme !== "dark")) return;
    this.currentTheme = theme;
    this.engine.setTheme(theme);
  }

  captureViewState(): SurfaceViewState {
    return {
      version: 1,
      value: {
        readOnly: this.readOnly,
        suspended: this.suspended,
        theme: this.currentTheme,
      },
    };
  }

  restoreViewState(state: SurfaceViewState): void {
    if (this.destroyed || state.version !== 1) return;
    if (typeof state.value !== "object" || state.value === null) return;
    const value = state.value as {
      readOnly?: unknown;
      suspended?: unknown;
      theme?: unknown;
    };
    if (typeof value.readOnly === "boolean") this.setReadOnly(value.readOnly);
    if (value.theme === "light" || value.theme === "dark") this.setTheme(value.theme);
    if (typeof value.suspended === "boolean") {
      if (value.suspended) this.suspend();
      else this.resume();
    }
  }

  suspend(): void {
    if (this.destroyed) return;
    this.suspended = true;
    this.engine.setReadOnly(true);
  }

  resume(): void {
    if (this.destroyed) return;
    this.suspended = false;
    this.engine.setReadOnly(this.readOnly);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.engine.destroy();
  }
}

function mountTextSurface(
  profileName: "markdown" | "plain-text",
  profile: MarkdownProfile | PlainTextProfile,
  context: SurfaceMountContext,
  options: TextSurfaceFactoryOptions,
): TextEditorSurface {
  const textContext = context as TextSurfaceMountContext;
  const engine = createTextEngine(textContext.parent, {
    onChange: textContext.onChange ?? options.onChange ?? emptyChange,
    onSelectionChange:
      textContext.onSelectionChange ?? options.onSelectionChange ?? emptySelectionChange,
    theme: textContext.theme ?? options.theme,
    extensions: () => profile.extensions(),
  });
  if (textContext.initialText !== undefined) engine.setDoc(textContext.initialText);
  return new TextSurface(profileName, engine, textContext.theme ?? options.theme);
}

export function createMarkdownSurfaceFactory(
  options: MarkdownSurfaceFactoryOptions = {},
): TextSurfaceFactory {
  return {
    family: "text",
    profile: "markdown",
    version: 1,
    mount(_request: SurfaceRequest, context: SurfaceMountContext): TextEditorSurface {
      const textContext = context as TextSurfaceMountContext;
      const profile = createMarkdownProfile({
        callbacks: textContext.markdownCallbacks ?? options.callbacks ?? emptyMarkdownCallbacks,
        completions: textContext.completions ?? options.completions ?? emptyCompletions,
      });
      return mountTextSurface("markdown", profile, context, options);
    },
  };
}

export function createPlainTextSurfaceFactory(
  options: TextSurfaceFactoryOptions = {},
): TextSurfaceFactory {
  return {
    family: "text",
    profile: "plain-text",
    version: 1,
    mount(_request: SurfaceRequest, context: SurfaceMountContext): TextEditorSurface {
      return mountTextSurface("plain-text", createPlainTextProfile(), context, options);
    },
  };
}

export const markdownSurfaceFactory = createMarkdownSurfaceFactory();
export const plainTextSurfaceFactory = createPlainTextSurfaceFactory();
