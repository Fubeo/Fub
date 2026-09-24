import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { Prec, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { SyntaxForm } from "../../../../host/contract";
import { markdownEditingExtensions } from "./commands";
import { markdownCompletions, type CompletionSources } from "./completions";
import { livePreview, type LivePreviewCallbacks } from "./livepreview";
import { markdownPaste } from "./paste";

const typography = Prec.high(EditorView.theme({
  ".cm-content": {
    fontFamily: "var(--font-reading)",
    fontSize: "var(--text-reading)",
    lineHeight: "var(--leading-relaxed)",
  },
}));

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
        typography,
        markdownEditingExtensions(),
        markdownPaste,
        markdown({ base: markdownLanguage, codeLanguages: languages }),
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
