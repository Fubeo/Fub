// La registrazione delle modifiche nella superficie ricca: mentre il
// documento registra (`track`, l'impostazione di Word), ciò che si scrive
// diventa una revisione tracciata invece di cambiare il testo.
//
// Il motore passa qui ogni transazione dell'utente che cambia il documento e
// ne applica la versione registrata. Una transazione si registra se è fatta
// soltanto di sostituzioni (`ReplaceStep`) dentro i paragrafi: scrivere,
// cancellare, Invio, unire due paragrafi, incollare testo, trascinarlo. Per
// ognuna:
//
// - ciò che entra prende la marca `ins` di chi scrive, e un paragrafo nuovo
//   (il segno di fine che entra) l'attributo `ins`;
// - ciò che esce resta, con la marca `del`; un segno di fine che esce (due
//   paragrafi uniti) dà al paragrafo l'attributo `del`;
// - ciò che chi scrive aveva inserito si toglie davvero, come in Word.
//
// Tutto il resto (il formato, lo stile di un paragrafo, una tabella) non ha
// una revisione da scrivere: la transazione si rifiuta. Ciò che non è testo
// del documento passa com'è: la cronologia, i commenti, le revisioni
// accettate o rifiutate e la registrazione stessa (`untracked`).
import type { Node as PmNode, Slice } from "prosemirror-model";
import { isHistoryTransaction } from "prosemirror-history";
import { TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import { Mapping, ReplaceStep, type StepMap } from "prosemirror-transform";
import type { Rev } from "./projection";
import { richSchema } from "./schema";

const UNTRACKED = "fub-rich-untracked";
/// Da che parte cancella un tasto: il cursore resta da quella parte di ciò
/// che esce.
const DIRECTION = "fub-rich-direction";

/// Una transazione che non è testo scritto: non si registra.
export function untracked(tr: Transaction): Transaction {
  return tr.setMeta(UNTRACKED, true);
}

export function isUntracked(tr: Transaction): boolean {
  return tr.getMeta(UNTRACKED) === true;
}

/// Il documento registra le modifiche.
export function tracking(doc: PmNode): boolean {
  return doc.attrs.track === true;
}

/// Registra (o smette di registrare) le modifiche.
export function setTracking(on: boolean): Command {
  return (state, dispatch) => {
    if (tracking(state.doc) === on) return false;
    if (dispatch) dispatch(untracked(state.tr.setDocAttribute("track", on)));
    return true;
  };
}

/// Chi scrive le revisioni e i commenti nuovi: lo ricorda la sessione, non
/// il documento.
let author = "";

export function reviewAuthor(): string {
  return author;
}

export function setReviewAuthor(name: string): void {
  author = name.trim();
}

/// Un'ora come la scrive Word: al secondo, in UTC.
function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

const { para, atom, brk } = richSchema.nodes;
const { ins, del } = richSchema.marks;

const revOf = (node: PmNode | null | undefined, kind: "ins" | "del"): Rev | null =>
  (node?.marks.find((mark) => mark.type.name === kind)?.attrs.rev as Rev | undefined) ?? null;

const mine = (rev: Rev | null | undefined, by: string): boolean => !!rev && (rev.by ?? "") === by;

/// Una sostituzione da `from` a `to` che resta fra paragrafi vicini: i suoi
/// capi stanno in un paragrafo, quelli fra loro sono paragrafi dello stesso
/// contenitore, e ciò che entra è testo o paragrafi.
function inParagraphs(doc: PmNode, from: number, to: number, slice: Slice): boolean {
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  if ($from.parent.type !== para || $to.parent.type !== para) return false;
  if ($from.parent !== $to.parent) {
    const depth = $from.depth;
    if ($to.depth !== depth || $from.node(depth - 1) !== $to.node(depth - 1)) return false;
    const container = $from.node(depth - 1);
    for (let i = $from.index(depth - 1); i <= $to.index(depth - 1); i += 1) {
      if (container.child(i).type !== para) return false;
    }
  }
  let plain = true;
  slice.content.descendants((node) => {
    if (node.type !== para && node.type !== atom && node.type !== brk && !node.isText) plain = false;
    return plain;
  });
  return plain;
}

/// La transazione si registra così com'è: passa senza revisioni.
function passes(tr: Transaction): boolean {
  return !tr.docChanged || isUntracked(tr) || isHistoryTransaction(tr);
}

/// La transazione si può registrare, o passa senza bisogno di farlo.
export function trackable(tr: Transaction): boolean {
  if (passes(tr)) return true;
  return tr.steps.every(
    (step, i) => step instanceof ReplaceStep && inParagraphs(tr.docs[i]!, step.from, step.to, step.slice),
  );
}

/// La versione registrata di `tr`, scritta da `by`; `null` se non si può
/// registrare. Una transazione che passa torna com'è.
export function trackTransaction(state: EditorState, tr: Transaction, by: string, at: string = now()): Transaction | null {
  if (passes(tr)) return tr;
  if (!trackable(tr)) return null;
  const out = state.tr;
  // Dal documento di `tr` a ogni passo a quello di `out`, che tiene ciò che
  // esce.
  let maps: StepMap[] = [];
  let backward = false;
  for (const step of tr.steps) {
    const replace = step as ReplaceStep;
    const mapping = new Mapping(maps);
    const from = mapping.map(replace.from, 1);
    const to = Math.max(from, mapping.map(replace.to, -1));
    const start = out.steps.length;
    insert(out, to, replace.slice, by, at);
    remove(out, from, to, by, at);
    // Il cursore di un Backspace resta prima di ciò che esce, uno di Canc
    // dopo. Una cancellazione del browser lo dice dove stava il cursore.
    if (tr.steps.length === 1 && replace.slice.size === 0) {
      const direction = tr.getMeta(DIRECTION) as -1 | 1 | undefined;
      backward = direction !== undefined ? direction < 0 : state.selection.empty && state.selection.head === replace.to;
    }
    maps = [replace.getMap().invert(), ...maps, ...out.steps.slice(start).map((s) => s.getMap())];
  }
  const mapping = new Mapping(maps);
  const selection = tr.selection;
  if (selection instanceof TextSelection && selection.empty) {
    const bias = backward ? -1 : 1;
    out.setSelection(TextSelection.near(out.doc.resolve(mapping.map(selection.head, bias)), bias));
  } else {
    out.setSelection(selection.map(out.doc, mapping));
  }
  if (tr.storedMarksSet) out.setStoredMarks(tr.storedMarks);
  if (tr.scrolledIntoView) out.scrollIntoView();
  for (const key of ["uiEvent", "paste", "addToHistory", "composition"]) {
    const meta: unknown = tr.getMeta(key);
    if (meta !== undefined) out.setMeta(key, meta);
  }
  return out;
}

/// Ciò che entra a `pos`: la marca `ins` sul testo, l'attributo sui segni di
/// fine. La revisione è quella di chi scrive accanto, se è di `by`: una
/// parola battuta lettera per lettera resta una modifica sola.
function insert(out: Transaction, pos: number, slice: Slice, by: string, at: string): void {
  if (slice.size === 0) return;
  const size = out.doc.content.size;
  out.replace(pos, pos, slice);
  const end = pos + out.doc.content.size - size;
  const $pos = out.doc.resolve(pos);
  const near = [revOf($pos.nodeBefore, "ins"), revOf(out.doc.resolve(end).nodeAfter, "ins")].find((r) => mine(r, by) && !r!.mv);
  const rev: Rev = near ?? { ...(by ? { by } : {}), at };
  out.removeMark(pos, end, del);
  out.removeMark(pos, end, ins);
  out.addMark(pos, end, ins.create({ rev }));
  out.doc.nodesBetween(pos, end, (node, at) => {
    if (node.type !== para) return true;
    const close = at + node.nodeSize - 1;
    if (close >= pos && close < end) out.setNodeMarkup(at, null, { ...node.attrs, ins: rev, del: null });
    return false;
  });
}

/// Ciò che esce da `from` a `to`: resta con la marca `del`, e i segni di fine
/// con l'attributo; ciò che `by` aveva inserito si toglie.
function remove(out: Transaction, from: number, to: number, by: string, at: string): void {
  if (to <= from) return;
  const doc = out.doc;
  const near = [revOf(doc.resolve(from).nodeBefore, "del"), revOf(doc.resolve(to).nodeAfter, "del")].find((r) => mine(r, by) && !r!.mv);
  const rev: Rev = near ?? { ...(by ? { by } : {}), at };
  // Dall'ultimo al primo: ciò che si toglie non sposta ciò che viene prima.
  const gone: { from: number; to: number; join?: PmNode }[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type === para) {
      const close = pos + node.nodeSize - 1;
      if (close >= from && close < to) {
        const next = doc.nodeAt(close + 1);
        if (mine(node.attrs.ins as Rev | null, by) && next?.type === para) gone.push({ from: close + 1, to: close + 1, join: next });
        else if (!node.attrs.del) out.setNodeMarkup(pos, null, { ...node.attrs, del: rev });
      }
      return true;
    }
    if (!node.isInline) return true;
    const a = Math.max(from, pos);
    const b = Math.min(to, pos + node.nodeSize);
    if (mine(revOf(node, "ins"), by)) gone.push({ from: a, to: b });
    else if (!revOf(node, "del")) out.addMark(a, b, del.create({ rev }));
    return false;
  });
  for (const piece of gone.sort((x, y) => y.from - x.from)) {
    if (piece.join) {
      // Come rifiutare il paragrafo nuovo: il paragrafo unito ha le
      // proprietà del seguente.
      const first = out.doc.resolve(piece.from).nodeBefore!;
      out.join(piece.from);
      out.setNodeMarkup(piece.from - first.nodeSize, null, piece.join.attrs);
    } else {
      out.delete(piece.from, piece.to);
    }
  }
}

/// Backspace (`-1`) o Canc (`1`) mentre si registra: cancella un carattere,
/// scavalcando ciò che è già eliminato, come Word. Senza registrare lo fa il
/// browser.
export function deleteChar(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const { selection, doc } = state;
    if (!tracking(doc) || !(selection instanceof TextSelection) || !selection.empty || !selection.$head.parent.inlineContent) {
      return false;
    }
    const $head = selection.$head;
    const start = $head.start();
    const end = $head.end();
    let pos = $head.pos;
    for (;;) {
      if (dir < 0 ? pos <= start : pos >= end) {
        // In capo al paragrafo: il prossimo tasto lo unisce.
        if (dispatch && pos !== $head.pos) dispatch(state.tr.setSelection(TextSelection.create(doc, pos)));
        return pos !== $head.pos;
      }
      const $pos = doc.resolve(pos);
      const node = dir < 0 ? $pos.nodeBefore! : $pos.nodeAfter!;
      if (!revOf(node, "del")) break;
      pos += dir;
    }
    if (dispatch) {
      // Una coppia surrogata è un carattere solo.
      const $pos = doc.resolve(pos);
      const node = dir < 0 ? $pos.nodeBefore! : $pos.nodeAfter!;
      let size = 1;
      if (node.isText) {
        const offset = dir < 0 ? $pos.textOffset || node.nodeSize : $pos.textOffset;
        const unit = node.text!.charCodeAt(dir < 0 ? offset - 1 : offset);
        if (dir < 0 ? unit >= 0xdc00 && unit <= 0xdfff : unit >= 0xd800 && unit <= 0xdbff) size = 2;
      }
      const tr = state.tr.setSelection(TextSelection.create(doc, pos));
      tr.delete(dir < 0 ? pos - size : pos, dir < 0 ? pos : pos + size);
      dispatch(tr.setMeta(DIRECTION, dir).scrollIntoView());
    }
    return true;
  };
}
