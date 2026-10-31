import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { foldService, syntaxTree } from "@codemirror/language";
import { Prec, RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxForm } from "../../../../host/contract";
import { markdownEditingExtensions } from "./commands";
import { markdownCompletions, type CompletionSources } from "./completions";
import { linkDialog } from "./link-dialog";
import { livePreview, type LivePreviewCallbacks } from "./livepreview";
import { cursorElements } from "./cursor-elements";
import { markdownPaste } from "./paste";
import { openLinkKeymap } from "./open-link";
import { markdownGrammar } from "./grammar";
import { frontmatterRange } from "./render";
import { liveReveal } from "../../live-reveal";
import { blockIdMarks } from "./block-id";
import { transformKeymap } from "./blocks/transform";

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

/// Il frontmatter si piega dalla sua prima riga fino al `---` che lo chiude.
const frontmatterFold = foldService.of((state, lineStart, lineEnd) => {
  if (lineStart !== 0) return null;
  const range = frontmatterRange(state.doc);
  if (!range) return null;
  const end = state.doc.lineAt(Math.max(range.to - 1, 0)).to;
  return end > lineEnd ? { from: lineEnd, to: end } : null;
});

const frontmatter: Extension = [
  frontmatterFold,
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
  /// I Blocchi (H1): `null` spenti; altrimenti le loro estensioni, sopra la
  /// Live, con la politica `mai` qualunque sia `editor.live-reveal`. Si
  /// caricano a richiesta: fino ad allora `[]` tiene già la politica.
  setBlocks(extension: Extension | null): void;
  /// Replaces the syntax declaration used by live preview on the next reconfigure.
  setSyntaxForms(forms: readonly SyntaxForm[]): void;
  /// Mounts the proofing extension (`./proof`) on the next reconfigure. It is
  /// loaded after the surface, so it arrives here instead of in the options.
  setProof(extension: Extension): void;
}

/// Owns Markdown-specific CodeMirror configuration while leaving document,
/// selection, and history to TextEngine. Callers update the profile and then
/// invoke the engine's generic `reconfigure()` seam.
export function createMarkdownProfile(options: MarkdownProfileOptions): MarkdownProfile {
  let previewOn = true;
  let blocks: Extension | null = null;
  let syntaxForms: readonly SyntaxForm[] | undefined;
  // Un'estensione sola per la vita del profilo: un `reconfigure` (Live ↔
  // Sorgente) tiene la stessa istanza del plugin, e con lei le parole
  // ignorate in questa sessione.
  let proof: Extension = [];

  return {
    extensions() {
      return [
        typography,
        monospaceCode,
        frontmatter,
        markdownEditingExtensions(),
        markdownPaste,
        openLinkKeymap(options.callbacks),
        markdown({ base: markdownGrammar, codeLanguages: languages }),
        cursorElements,
        // «Trasforma in» da tastiera (Mod-Alt-0…8) vale in Live e in Blocchi.
        previewOn ? [livePreview(options.callbacks, syntaxForms), linkDialog(options.completions.searchNotes), blockIdMarks, Prec.high(keymap.of(transformKeymap))] : [],
        previewOn && blocks !== null ? [Prec.highest(liveReveal.of("mai")), blocks] : [],
        markdownCompletions(options.completions),
        proof,
      ];
    },
    setLivePreview(on) {
      previewOn = on;
    },
    setBlocks(extension) {
      blocks = extension;
    },
    setSyntaxForms(forms) {
      syntaxForms = forms;
    },
    setProof(extension) {
      proof = extension;
    },
  };
}
