import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { createMermaidView, type MermaidView } from "../../../../ui/mermaid";

// CM may keep the DOM while replacing an equivalent WidgetType instance.
const mounted = new WeakMap<HTMLElement, MermaidView>();

class MermaidWidget extends WidgetType {
  constructor(readonly source: string) { super(); }

  eq(other: MermaidWidget): boolean { return other.source === this.source; }

  toDOM(view: EditorView): HTMLElement {
    const diagram = createMermaidView(this.source, {
      revealSource: () => {
        const position = view.posAtDOM(diagram.element);
        // Resolve the current position from DOM: peer edits can move this widget
        // without replacing it. Never keep a stale source offset in a closure.
        const line = view.state.doc.lineAt(position);
        const anchor = line.number < view.state.doc.lines ? view.state.doc.line(line.number + 1).from : position;
        view.dispatch({ selection: { anchor }, scrollIntoView: true });
        view.focus();
      },
      onResize: () => view.requestMeasure(),
    });
    mounted.set(diagram.element, diagram);
    return diagram.element;
  }

  destroy(element: HTMLElement): void {
    mounted.get(element)?.destroy();
    mounted.delete(element);
  }

  ignoreEvent(): boolean { return true; }
}

interface DiagramFence {
  from: number;
  to: number;
  widget: MermaidWidget;
}

function diagramFences(state: EditorState): DiagramFence[] {
  const fences: DiagramFence[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "FencedCode") {
        // Only containers can contain a fenced block. Prose and nested code
        // language trees need no traversal, even in very large documents.
        return node.name === "Document" || node.name === "Blockquote" || node.name === "BulletList" ||
          node.name === "OrderedList" || node.name === "ListItem";
      }
      const info = node.node.getChild("CodeInfo");
      if (!info || state.sliceDoc(info.from, info.to).trim().split(/\s+/, 1)[0].toLowerCase() !== "mermaid") return false;
      // An unfinished fence stays source: typing a diagram must never swallow
      // the rest of the document behind an eager block replacement.
      if (node.node.getChildren("CodeMark").length !== 2) return false;
      const from = state.doc.lineAt(node.from).from;
      const to = state.doc.lineAt(node.to).to;
      // Lezer's CodeText children omit quote/list prefixes but retain newlines.
      const source = node.node.getChildren("CodeText").map((text) => state.sliceDoc(text.from, text.to)).join("");
      fences.push({ from, to, widget: new MermaidWidget(source) });
      return false;
    },
  });
  return fences;
}

function visibleDiagrams(state: EditorState, fences: readonly DiagramFence[]): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  for (const { from, to, widget } of fences) {
    const selected = state.selection.ranges.some((range) => range.empty
      ? range.from >= from && range.from <= to
      : range.from < to && range.to > from);
    if (!selected) decorations.push(Decoration.replace({ block: true, widget }).range(from, to));
  }
  return Decoration.set(decorations, true);
}

// Multiline replacements must be provided directly by state, before CM lays out
// the viewport; a ViewPlugin's decorations are too late for block widgets.
const renderedDiagrams = StateField.define<{ fences: DiagramFence[]; decorations: DecorationSet }>({
  create(state) {
    const fences = diagramFences(state);
    return { fences, decorations: visibleDiagrams(state, fences) };
  },
  update(value, transaction) {
    const treeChanged = transaction.docChanged ||
      syntaxTree(transaction.startState) !== syntaxTree(transaction.state);
    if (!treeChanged && !transaction.selection) return value;
    const fences = treeChanged ? diagramFences(transaction.state) : value.fences;
    return { fences, decorations: visibleDiagrams(transaction.state, fences) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

export function mermaidPreview(): Extension {
  return renderedDiagrams;
}
