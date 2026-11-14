// Il rientro sospeso delle voci d'elenco in Live (D2): la prima riga parte dal
// segno, quelle che vanno a capo dal testo. La larghezza del prefisso (rientro,
// segno, casella) si misura sulla riga com'è disegnata, perché il pallino e la
// casella non sono larghi quanto i caratteri che sostituiscono; poi la riga
// prende `padding-left` pari al prefisso e `text-indent` negativo uguale.
//
// Le righe che continuano il primo paragrafo della voce (`- [ ] Spedire…`
// e sotto `  📅 2026-11-17`) sono righe a sé per CodeMirror, ma in Lettura
// sono lo stesso paragrafo: partono anch'esse dal testo della voce. Il loro
// rientro scritto si misura e si toglie dal prefisso, così il primo carattere
// cade sotto il testo della riga d'apertura qualunque rientro abbiano.
import { syntaxTree } from "@codemirror/language";
import { type ChangeSet, type Extension, type Range, StateEffect } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { openLifetime } from "../../../../ui/lifetime";

/// I blocchi che possono contenere voci: negli altri (paragrafi, titoli,
/// codice, tabelle) non si scende, e le loro parti in riga non si guardano.
const HOLDS_ITEMS = new Set(["Document", "Blockquote", "BulletList", "OrderedList"]);

/// Le righe d'apertura delle voci visibili e la fine del loro prefisso.
///
/// L'albero si scorre una volta sola, dal primo all'ultimo tratto visibile:
/// nella Live i blocchi resi spezzano la vista in molti tratti, e ripartire
/// dalla radice per ognuno costava più della lettura. Le voci che cadono
/// sotto un blocco reso restano fuori.
export function listPrefixes(view: EditorView): Prefix[] {
  const out: Prefix[] = [];
  const doc = view.state.doc;
  const visible = view.visibleRanges;
  if (visible.length === 0) return out;
  let index = 0;
  syntaxTree(view.state).iterate({
    from: visible[0]!.from,
    to: visible[visible.length - 1]!.to,
    enter(node) {
      if (node.name !== "ListItem") return HOLDS_ITEMS.has(node.name);
      const mark = node.node.getChild("ListMark");
      if (!mark) return;
      const line = doc.lineAt(node.from);
      if (doc.lineAt(mark.from).number !== line.number) return;
      // Soltanto le voci la cui riga d'apertura si disegna.
      while (index < visible.length && visible[index]!.to <= line.from) index++;
      if (index === visible.length || visible[index]!.from > line.from) return;
      let end = mark.to;
      const paragraph = node.node.getChild("Paragraph") ?? node.node.getChild("Task");
      const task = paragraph?.getChild("Task")?.getChild("TaskMarker") ?? paragraph?.getChild("TaskMarker");
      if (task && doc.lineAt(task.from).number === line.number) end = task.to;
      while (end < line.to && /[ \t]/.test(doc.sliceString(end, end + 1))) end++;
      if (end >= line.to) return;
      out.push({ line: line.from, end });
      // Le righe che continuano il paragrafo, se il paragrafo comincia sulla
      // riga d'apertura.
      if (!paragraph || doc.lineAt(paragraph.from).number !== line.number) return;
      const last = doc.lineAt(paragraph.to).number;
      for (let number = line.number + 1; number <= last; number++) {
        const next = doc.line(number);
        let text = next.from;
        // Il rientro, e in una citazione i suoi `>`: come quelli della riga
        // d'apertura, stanno nella misura.
        while (text < next.to && /[ \t>]/.test(doc.sliceString(text, text + 1))) text++;
        if (text < next.to) out.push({ line: next.from, end: text, of: line.from });
      }
    },
  });
  return out;
}

/// La riga d'apertura di una voce e la fine del suo prefisso; o una riga che
/// ne continua il paragrafo (`of` è la riga d'apertura) e la fine del suo
/// rientro scritto.
type Prefix = { line: number; end: number; of?: number };

/// Le larghezze misurate valgono ancora dopo `changes` (già portate sulle
/// posizioni nuove): ogni voce visibile ne ha una e nessuna modifica cade fra
/// l'inizio della sua riga e il suo testo. Il prefisso (rientro, segno,
/// casella) si disegna uguale finché nessuno lo tocca, e rimisurarlo a ogni
/// battuta leggeva le coordinate di ogni voce visibile.
export function widthsHold(widths: ReadonlyMap<number, number>, prefixes: readonly Prefix[], changes: ChangeSet): boolean {
  const changed: { from: number; to: number }[] = [];
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => changed.push({ from: fromB, to: toB }));
  return prefixes.every(({ line, end }) => widths.has(line)
    && !changed.some((range) => range.from <= end && range.to >= line));
}

const measured = StateEffect.define<null>();

function hangOf(width: number): Decoration {
  const px = Math.round(width * 10) / 10;
  return Decoration.line({ class: "cm-fub-hanging", attributes: { style: `padding-left: ${px}px; text-indent: -${px}px` } });
}

/// Una riga che continua il paragrafo della voce: tutta spostata, perché il
/// suo primo carattere e quelli che vanno a capo stiano sotto il testo.
function continuedOf(shift: number): Decoration {
  const px = Math.round(shift * 10) / 10;
  return Decoration.line({ class: "cm-fub-hanging cm-fub-continued", attributes: { style: `padding-left: ${px}px` } });
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
          this.decorations = this.build().decorations;
          return;
        }
        if (update.docChanged) this.widths = new Map([...this.widths].map(([at, w]) => [update.changes.mapPos(at), w]));
        if (update.docChanged || update.viewportChanged || update.geometryChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
          const { decorations, prefixes } = this.build();
          this.decorations = decorations;
          if (!this.measuredStill(update, prefixes)) this.measure();
        }
      }
      measuredStill(update: ViewUpdate, prefixes: readonly Prefix[]): boolean {
        // Una modifica che cambia l'altezza può aver spostato le righe, e un
        // aggiornamento senza modifiche viene dalla vista (misura, tratto).
        if (!update.docChanged || update.viewportMoved || update.heightChanged) return false;
        return widthsHold(this.widths, prefixes, update.changes);
      }
      build(): { decorations: DecorationSet; prefixes: Prefix[] } {
        const out: Range<Decoration>[] = [];
        const prefixes = listPrefixes(this.view);
        for (const { line, of } of prefixes) {
          const width = this.widths.get(line);
          if (width && width > 0) out.push((of === undefined ? hangOf(width) : continuedOf(width)).range(line));
        }
        return { decorations: Decoration.set(out, true), prefixes };
      }
      measure(): void {
        this.view.requestMeasure({
          key: this,
          read: (view) => {
            const next = new Map<number, number>();
            const prefixes = listPrefixes(view);
            // Il rientro scritto di una riga che continua si misura senza lo
            // spostamento che le è già stato dato: il padding sposta l'inizio
            // della riga e il testo insieme, la differenza resta quella.
            for (const { line, end, of } of prefixes) {
              const start = view.coordsAtPos(line, 1);
              // Di una riga che continua conta dove finisce il rientro, non
              // dove comincia il primo carattere: se quel carattere apre una
              // pastiglia, il suo margine interno resterebbe fuori dal conto.
              const text = view.coordsAtPos(end, of !== undefined && end > line ? -1 : 1);
              // Soltanto se la prima riga visiva porta anche l'inizio del testo;
              // se no la voce resta senza rientro (larghezza zero), ma misurata.
              if (start && text) next.set(line, Math.abs(text.top - start.top) < 2 ? text.left - start.left : 0);
            }
            for (const { line, of } of prefixes) {
              if (of === undefined) continue;
              const width = next.get(of) ?? 0;
              next.set(line, Math.max(0, width - (next.get(line) ?? 0)));
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
