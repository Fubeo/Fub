import { getIndentUnit } from "@codemirror/language";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

/// Righe verticali sottili per ogni livello di rientro. Il rientro si misura
/// in colonne: un tab vale quanto l'unità di rientro. La riga è un fondo della
/// riga stessa, quindi non tocca il testo, la selezione né il documento. Le
/// colonne si disegnano in `ch`: valgono dove il carattere è a passo fisso,
/// cioè in Sorgente.
const GUIDE = "rgba(128, 128, 128, 0.28)";

function leadingColumns(text: string, unit: number): number {
  let columns = 0;
  for (const ch of text) {
    if (ch === " ") columns += 1;
    else if (ch === "\t") columns += unit;
    else break;
  }
  return columns;
}

function guides(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const unit = Math.max(1, getIndentUnit(view.state));
  let last = -1;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      pos = line.to + 1;
      if (line.from <= last) continue;
      last = line.from;
      const columns = leadingColumns(line.text, unit);
      if (columns < unit) continue;
      const width = Math.floor(columns / unit) * unit;
      const style = `background-image: repeating-linear-gradient(to right, ${GUIDE} 0 1px, transparent 1px ${unit}ch);`
        + ` background-size: ${width}ch 100%; background-repeat: no-repeat; background-position: 6px 0;`;
      builder.add(line.from, line.from, Decoration.line({ attributes: { style } }));
    }
  }
  return builder.finish();
}

export const indentGuides: Extension = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) {
    this.decorations = guides(view);
  }
  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) this.decorations = guides(update.view);
  }
}, { decorations: (plugin) => plugin.decorations });
