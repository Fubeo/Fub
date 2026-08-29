import type { Extension } from "@codemirror/state";
import type { Theme } from "../../theme/theme";
import type { SyntaxForm } from "../../host/contract";
import type {
  EditorSurface,
  SurfaceFactory,
  SurfaceModeful,
  SurfaceModeSpec,
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
import { createPlainTextProfile } from "./profiles/plain-text";

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
  readonly profile: string;

  setDoc(text: string): void;
  syncDoc(update: DocumentUpdate | string): void;
  currentText(): string;
  undo(): boolean;
  redo(): boolean;
  selections(): EditorSelections;
  revealByteOffset(offset: number): void;
  reconfigure(): void;
}

export interface MarkdownEditorSurface extends TextEditorSurface, SurfaceModeful {
  readonly profile: "markdown";

  /// Replaces Markdown syntax declarations and reconfigures the profile.
  setSyntaxForms(forms: readonly SyntaxForm[]): void;
  /// Enables or disables Markdown live preview and reconfigures the profile.
  setLivePreview(on: boolean): void;
}

export interface PlainTextSurface extends TextEditorSurface, SurfaceModeful {
  readonly profile: "plain-text";
}

export interface TextSurfaceFactory extends SurfaceFactory {
  readonly family: "text";
  readonly profile: string;

  mount(request: SurfaceRequest, context: SurfaceMountContext): TextEditorSurface;
}

export interface MarkdownSurfaceFactory extends TextSurfaceFactory {
  readonly profile: "markdown";
  readonly modes: readonly SurfaceModeSpec[];
  readonly defaultMode: "live_preview";

  mount(request: SurfaceRequest, context: SurfaceMountContext): MarkdownEditorSurface;
}

export interface PlainTextSurfaceFactory extends TextSurfaceFactory {
  readonly profile: "plain-text";
  readonly modes: readonly SurfaceModeSpec[];
  readonly defaultMode: "source";

  mount(request: SurfaceRequest, context: SurfaceMountContext): PlainTextSurface;
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
const MARKDOWN_MODES = [
  { id: "source", labelKey: "mode.source", hintKey: "mode.source.hint" },
  { id: "live_preview", labelKey: "mode.live", hintKey: "mode.live.hint" },
  { id: "reading", labelKey: "mode.reading", hintKey: "mode.reading.hint" },
] as const satisfies readonly SurfaceModeSpec[];

const PLAIN_TEXT_MODES = [
  { id: "source", labelKey: "mode.source", hintKey: "mode.source.hint" },
] as const satisfies readonly SurfaceModeSpec[];


class TextSurface<Profile extends string> implements TextEditorSurface {
  readonly family = "text" as const;
  readonly profile: Profile;
  readonly surfaceId: string;

  private readonly engine: TextEngine;
  private readOnly = false;
  private suspended = false;
  private currentTheme: Theme | undefined;
  private destroyed = false;

  constructor(profile: Profile, engine: TextEngine, theme: Theme | undefined) {
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

class MarkdownSurface extends TextSurface<"markdown"> implements MarkdownEditorSurface {
  readonly modes = MARKDOWN_MODES;
  readonly defaultMode = "live_preview" as const;
  private currentMode: string = "live_preview";
  private readonly markdownProfile: MarkdownProfile;

  constructor(engine: TextEngine, theme: Theme | undefined, markdownProfile: MarkdownProfile) {
    super("markdown", engine, theme);
    this.markdownProfile = markdownProfile;
  }

  mode(): string {
    return this.currentMode;
  }

  setMode(id: string): void {
    switch (id) {
      case "live_preview":
        this.currentMode = id;
        this.setLivePreview(true);
        return;
      case "source":
      case "reading":
        this.currentMode = id;
        this.setLivePreview(false);
        return;
      default:
        return;
    }
  }

  setSyntaxForms(forms: readonly SyntaxForm[]): void {
    this.markdownProfile.setSyntaxForms(forms);
    this.reconfigure();
  }

  setLivePreview(on: boolean): void {
    this.markdownProfile.setLivePreview(on);
    this.reconfigure();
  }
}

class PlainTextSurfaceImpl extends TextSurface<"plain-text"> implements PlainTextSurface {
  readonly modes = PLAIN_TEXT_MODES;
  readonly defaultMode = "source" as const;
  private currentMode: string = "source";

  constructor(engine: TextEngine, theme: Theme | undefined) {
    super("plain-text", engine, theme);
  }

  mode(): string {
    return this.currentMode;
  }

  setMode(id: string): void {
    if (id !== "source") return;
    this.currentMode = id;
  }
}

interface TextProfile {
  extensions(): Extension;
}

function mountTextEngine(
  profile: TextProfile,
  context: SurfaceMountContext,
  options: TextSurfaceFactoryOptions,
): { engine: TextEngine; theme: Theme | undefined } {
  const textContext = context as TextSurfaceMountContext;
  const engine = createTextEngine(textContext.parent, {
    onChange: textContext.onChange ?? options.onChange ?? emptyChange,
    onSelectionChange:
      textContext.onSelectionChange ?? options.onSelectionChange ?? emptySelectionChange,
    theme: textContext.theme ?? options.theme,
    extensions: () => profile.extensions(),
  });
  if (textContext.initialText !== undefined) engine.setDoc(textContext.initialText);
  return { engine, theme: textContext.theme ?? options.theme };
}

export function createMarkdownSurfaceFactory(
  options: MarkdownSurfaceFactoryOptions = {},
): MarkdownSurfaceFactory {
  return {
    family: "text",
    profile: "markdown",
    supportedVersions: [1],
    modes: MARKDOWN_MODES,
    defaultMode: "live_preview",
    mount(_request: SurfaceRequest, context: SurfaceMountContext): MarkdownEditorSurface {
      const textContext = context as TextSurfaceMountContext;
      const profile = createMarkdownProfile({
        callbacks: textContext.markdownCallbacks ?? options.callbacks ?? emptyMarkdownCallbacks,
        completions: textContext.completions ?? options.completions ?? emptyCompletions,
      });
      const mounted = mountTextEngine(profile, context, options);
      return new MarkdownSurface(mounted.engine, mounted.theme, profile);
    },
  };
}

export function createPlainTextSurfaceFactory(
  options: TextSurfaceFactoryOptions = {},
): PlainTextSurfaceFactory {
  return {
    family: "text",
    profile: "plain-text",
    supportedVersions: [1],
    modes: PLAIN_TEXT_MODES,
    defaultMode: "source",
    mount(_request: SurfaceRequest, context: SurfaceMountContext): PlainTextSurface {
      const mounted = mountTextEngine(createPlainTextProfile(), context, options);
      return new PlainTextSurfaceImpl(mounted.engine, mounted.theme);
    },
  };
}

export const markdownSurfaceFactory = createMarkdownSurfaceFactory();
export const plainTextSurfaceFactory = createPlainTextSurfaceFactory();
