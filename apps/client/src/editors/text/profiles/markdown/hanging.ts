// Il rientro sospeso delle voci d'elenco in Live (D2): la prima riga parte dal
// segno, quelle che vanno a capo dal testo. La larghezza del prefisso (rientro,
// segno, casella) si misura sulla riga com'è disegnata, perché il pallino e la
// casella non sono larghi quanto i caratteri che sostituiscono; poi la riga
// prende `padding-left` pari al prefisso e `text-indent` negativo uguale.
import { syntaxTree } from "@codemirror/language";
import { type Extension, type Range, StateEffect } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { openLifetime } from "../../../../ui/lifetime";

/// Le righe d'apertura delle voci visibili e la fine del loro prefisso.
export function listPrefixes(view: EditorView): { line: number; end: number }[] {
  const out: { line: number; end: number }[] = [];
  const doc = view.state.doc;
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from, to,
      enter(node) {
        if (node.name === "FencedCode" || node.name === "CodeBlock" || node.name === "HTMLBlock") return false;
        if (node.name !== "ListItem") return;
        const mark = node.node.getChild("ListMark");
        if (!mark) return;
        const line = doc.lineAt(node.from);
        if (doc.lineAt(mark.from).number !== line.number) return;
        let end = mark.to;
        const task = node.node.getChild("Paragraph")?.getChild("Task")?.getChild("TaskMarker")
          ?? node.node.getChild("Task")?.getChild("TaskMarker");
        if (task && doc.lineAt(task.from).number === line.number) end = task.to;
        while (end < line.to && /[ \t]/.test(doc.sliceString(end, end + 1))) end++;
        if (end >= line.to) return;
        out.push({ line: line.from, end });
      },
    });
  }
  return out;
}

const measured = StateEffect.define<null>();

function hangOf(width: number): Decoration {
  const px = Math.round(width * 10) / 10;
  return Decoration.line({ class: "cm-fub-hanging", attributes: { style: `padding-left: ${px}px; text-indent: -${px}px` } });
}

// Il rientro negativo è della riga: i pezzi in blocco dentro di lei (il
// pallino disegnato, la casella, le pastiglie) non lo ereditano.
const theme = EditorView.baseTheme({
  ".cm-fub-hanging *, .cm-fub-hanging *::before": { textIndent: "0" },
});

/// Il rientro sospeso: decorazioni di riga dalle larghezze misurate.
export function hangingIndent(): Extension {
  return [theme, ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      widths = new Map<number, number>();
      readonly life = openLifetime();
      constructor(readonly view: EditorView) { this.measure(); }
      update(update: ViewUpdate): void {
        if (update.transactions.some((tr) => tr.effects.some((e) => e.is(measured)))) {
          this.decorations = this.build();
          return;
        }
        if (update.docChanged) this.widths = new Map([...this.widths].map(([at, w]) => [update.changes.mapPos(at), w]));
        if (update.docChanged || update.viewportChanged || update.geometryChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
          this.decorations = this.build();
          this.measure();
        }
      }
      build(): DecorationSet {
        const out: Range<Decoration>[] = [];
        for (const { line } of listPrefixes(this.view)) {
          const width = this.widths.get(line);
          if (width && width > 0) out.push(hangOf(width).range(line));
        }
        return Decoration.set(out, true);
      }
      measure(): void {
        this.view.requestMeasure({
          key: this,
          read: (view) => {
            const next = new Map<number, number>();
            for (const { line, end } of listPrefixes(view)) {
              const start = view.coordsAtPos(line, 1);
              const text = view.coordsAtPos(end, 1);
              // Soltanto se la prima riga visiva porta anche l'inizio del testo.
              if (start && text && Math.abs(text.top - start.top) < 2) next.set(line, text.left - start.left);
            }
            return next;
          },
          write: (next) => {
            let same = next.size === this.widths.size;
            for (const [at, w] of next) if (Math.abs((this.widths.get(at) ?? -1) - w) > 0.5) same = false;
            if (same) return;
            this.widths = next;
            queueMicrotask(() => { if (!this.life.closed) this.view.dispatch({ effects: measured.of(null) }); });
          },
        });
      }
      destroy(): void { this.life.close(); }
    },
    { decorations: (value) => value.decorations },
  )];
}
