import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxTree } from "@codemirror/language";
import { Prec, RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxForm } from "../../../../host/contract";
import { markdownEditingExtensions } from "./commands";
import { markdownCompletions, type CompletionSources } from "./completions";
import { livePreview, type LivePreviewCallbacks } from "./livepreview";
import { markdownPaste } from "./paste";
import { frontmatterRange } from "./render";

const typography = Prec.high(EditorView.theme({
  ".cm-content": {
    fontFamily: "var(--font-reading)",
    fontSize: "var(--text-reading)",
    lineHeight: "var(--leading-relaxed)",
  },
}));

/// Il codice resta monospaziato in Sorgente e in Live: il corpo di lettura
/// vale per la prosa, non per l'indentazione di un blocco di codice.
const codeLine = Decoration.line({ class: "cm-fub-code-line" });

function codeLines(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  let last = -1;
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name !== "FencedCode" && node.name !== "CodeBlock") return;
        const doc = view.state.doc;
        for (let line = doc.lineAt(Math.max(node.from, from)); ; line = doc.line(line.number + 1)) {
          if (line.from > last) {
            builder.add(line.from, line.from, codeLine);
            last = line.from;
          }
          if (line.to >= Math.min(node.to, to) || line.number >= doc.lines) break;
        }
        return false;
      },
    });
  }
  return builder.finish();
}

const monospaceCode: Extension = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = codeLines(view);
      }
      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || syntaxTree(update.state) !== syntaxTree(update.startState)) {
          this.decorations = codeLines(update.view);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  ),
  Prec.high(EditorView.theme({
    ".cm-fub-code-line": {
      fontFamily: "var(--font-mono, monospace)",
      fontSize: "0.9em",
      lineHeight: "var(--leading-normal)",
    },
  })),
];

/// Il frontmatter YAML resta YAML: il parser Markdown di CodeMirror non lo
/// conosce, e senza questa riga `---` diventa una riga orizzontale e la
/// chiave sopra il secondo `---` un titolo Setext. La regola che lo riconosce
/// è la stessa della resa (`detectFrontmatter`).
const frontmatterLine = Decoration.line({ class: "cm-fub-frontmatter" });

function frontmatterLines(view: EditorView): DecorationSet {
  const range = frontmatterRange(view.state.doc);
  if (!range) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  for (let line = doc.lineAt(range.from); ; line = doc.line(line.number + 1)) {
    builder.add(line.from, line.from, frontmatterLine);
    if (line.to + 1 >= range.to || line.number >= doc.lines) break;
  }
  return builder.finish();
}

const frontmatter: Extension = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = frontmatterLines(view);
      }
      update(update: ViewUpdate): void {
        if (update.docChanged) this.decorations = frontmatterLines(update.view);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  ),
  Prec.highest(EditorView.theme({
    ".cm-fub-frontmatter": {
      fontFamily: "var(--font-mono, monospace)",
      fontSize: "0.85em",
      lineHeight: "var(--leading-normal)",
      color: "var(--syn-comment, var(--doc-muted))",
      background: "var(--doc-fill-soft, rgba(135, 135, 135, 0.08))",
    },
    ".cm-fub-frontmatter *": {
      fontWeight: "inherit !important",
      fontSize: "inherit !important",
      color: "inherit !important",
      textDecoration: "none !important",
    },
  })),
];

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
        monospaceCode,
        frontmatter,
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
