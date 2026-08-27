import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { Extension } from "@codemirror/state";
import type { SyntaxForm } from "../../../../host/contract";
import { markdownEditingExtensions } from "./commands";
import { markdownCompletions, type CompletionSources } from "./completions";
import { livePreview, type LivePreviewCallbacks } from "./livepreview";

export interface MarkdownProfileOptions {
  readonly callbacks: LivePreviewCallbacks;
  readonly completions: CompletionSources;
}

export interface MarkdownProfile {
  /// Produces the complete Markdown extension for the TextEngine profile seam.
  extensions(): Extension;
  /// Changes whether live-preview decorations are mounted on the next reconfigure.
  setLivePreview(on: boolean): void;
  /// Replaces the syntax declaration used by live preview on the next reconfigure.
  setSyntaxForms(forms: readonly SyntaxForm[]): void;
}

/// Owns Markdown-specific CodeMirror configuration while leaving document,
/// selection, and history to TextEngine. Callers update the profile and then
/// invoke the engine's generic `reconfigure()` seam.
export function createMarkdownProfile(options: MarkdownProfileOptions): MarkdownProfile {
  let previewOn = true;
  let syntaxForms: readonly SyntaxForm[] | undefined;

  return {
    extensions() {
      return [
        markdownEditingExtensions(),
        markdown({ base: markdownLanguage }),
        previewOn ? livePreview(options.callbacks, syntaxForms) : [],
        markdownCompletions(options.completions),
      ];
    },
    setLivePreview(on) {
      previewOn = on;
    },
    setSyntaxForms(forms) {
      syntaxForms = forms;
    },
  };
}
