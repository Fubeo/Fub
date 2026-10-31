// Gli id di blocco in Live: un `^id` è l'indirizzo con cui altre note
// puntano a un blocco, non testo da leggere. Con la politica `mai` non si
// vede — quello in coda alla riga e quello su una riga sua, con la riga
// vuota che lo precede —; con `elemento` e `riga` resta, in grigio. Il
// frontmatter e il codice non ne hanno.
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { liveReveal } from "../../live-reveal";
import { frontmatterRange } from "./render";

const AT_END = /[ \t]\^[A-Za-z0-9-]+[ \t]*$/;
const LONE = /^\^[A-Za-z0-9-]+[ \t]*$/;
const SKIP = new Set(["FencedCode", "CodeBlock", "HTMLBlock", "CommentBlock"]);

const hidden = Decoration.replace({});
const faint = Decoration.mark({ class: "cm-fub-block-id" });

function inCode(state: EditorState, pos: number): boolean {
  for (let node = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent!) {
    if (SKIP.has(node.name)) return true;
    if (!node.parent) break;
  }
  return false;
}

/// Una riga che può portare un id, a guardare soltanto il suo testo.
function candidate(text: string): boolean {
  return text.includes("^") && (LONE.test(text) || AT_END.test(text));
}

/// Gli inizi delle righe candidate fra `from` e `to`, comprese.
function scan(state: EditorState, from: number, to: number): number[] {
  const out: number[] = [];
  const last = state.doc.lineAt(to).number;
  for (let n = state.doc.lineAt(from).number; n <= last; n++) {
    const line = state.doc.line(n);
    if (candidate(line.text)) out.push(line.from);
  }
  return out;
}

function decorate(state: EditorState, lines: readonly number[]): DecorationSet {
  if (lines.length === 0) return Decoration.none;
  const hide = state.facet(liveReveal) === "mai";
  const yaml = frontmatterRange(state.doc);
  const out: Range<Decoration>[] = [];
  for (const start of lines) {
    const line = state.doc.lineAt(start);
    const n = line.number;
    if (yaml && line.from < yaml.to) continue;
    if (LONE.test(line.text) && n > 2 && state.doc.line(n - 1).text.trim() === "" && state.doc.line(n - 2).text.trim() !== "") {
      if (inCode(state, line.from)) continue;
      if (hide) {
        // La riga vuota e quella dell'id vanno via insieme: il blocco sopra
        // resta attaccato al suo indirizzo, senza un vuoto in più.
        out.push(Decoration.replace({ block: true }).range(state.doc.line(n - 1).from, line.to));
      } else {
        out.push(faint.range(line.from, line.to));
      }
      continue;
    }
    const tail = AT_END.exec(line.text);
    if (!tail || inCode(state, line.from)) continue;
    const from = line.from + tail.index;
    out.push((hide ? hidden : faint).range(hide ? from : from + 1, line.to));
  }
  return Decoration.set(out, true);
}

interface BlockIds {
  /// Gli inizi delle righe che, dal testo, possono portare un id: una battuta
  /// riguarda soltanto le righe che tocca, e il resto si sposta.
  readonly lines: readonly number[];
  readonly decorations: DecorationSet;
}

function create(state: EditorState): BlockIds {
  const lines = scan(state, 0, state.doc.length);
  return { lines, decorations: decorate(state, lines) };
}

/// Il campo e non un plugin: le righe dell'id tolte sono decorazioni di
/// blocco, che soltanto lo stato può dare.
const blockIdField = StateField.define<BlockIds>({
  create,
  update(value, tr) {
    const tree = syntaxTree(tr.state) !== syntaxTree(tr.startState);
    const policy = tr.state.facet(liveReveal) !== tr.startState.facet(liveReveal);
    if (!tr.docChanged) {
      return tree || policy ? { lines: value.lines, decorations: decorate(tr.state, value.lines) } : value;
    }
    // Le righe toccate, più due prima e dopo: la riga vuota e il blocco sopra
    // decidono se un `^id` su una riga sua è un id.
    const doc = tr.state.doc;
    const touched: { from: number; to: number }[] = [];
    tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      const first = Math.max(1, doc.lineAt(fromB).number - 2);
      const last = Math.min(doc.lines, doc.lineAt(toB).number + 2);
      touched.push({ from: doc.line(first).from, to: doc.line(last).to });
    });
    const inside = (pos: number) => touched.some((range) => pos >= range.from && pos <= range.to);
    const kept = value.lines.map((pos) => tr.changes.mapPos(pos, 1)).filter((pos) => !inside(pos) && doc.lineAt(pos).from === pos);
    const found = touched.flatMap((range) => scan(tr.state, range.from, range.to));
    const lines = [...new Set([...kept, ...found])].sort((a, b) => a - b);
    return { lines, decorations: decorate(tr.state, lines) };
  },
  // Con `mai` ogni decorazione è un id tolto, che il cursore salta intero.
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => (view.state.facet(liveReveal) === "mai" ? view.state.field(field).decorations : Decoration.none)),
  ],
});

export const blockIdMarks: Extension = blockIdField;
