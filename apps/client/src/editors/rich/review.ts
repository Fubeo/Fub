// La revisione nella superficie ricca: trova e sostituisci, il conteggio
// delle parole, e le revisioni tracciate da accettare o rifiutare.
//
// Si cerca dentro un paragrafo alla volta, sul suo testo verbatim: un a-capo o
// un salto è `\n`, un oggetto o un segno (l'inizio di un commento, un
// segnalibro) è U+FFFC. Così un'occorrenza non scavalca mai un oggetto, e
// sostituirla non porta via un segno che non si vede. Ogni carattere del testo
// è una posizione del documento, come ogni foglia: l'occorrenza torna a un
// intervallo esatto.
//
// Le occorrenze si mostrano con decorazioni, perché la selezione del testo
// non si vede mentre il fuoco è nel modulo della ricerca. Una sostituzione è
// una battuta: entra nella cronologia, e il testo nuovo prende l'aspetto del
// primo carattere che sostituisce.
//
// Una revisione è un tratto inserito (`ins`) o eliminato (`del`), o il segno
// di fine di un paragrafo; tratti e segni vicini con la stessa revisione sono
// una modifica sola, come in Word. Accettare un inserimento o rifiutare
// un'eliminazione toglie la marca; il contrario toglie il testo, e per un
// segno di fine unisce il paragrafo al seguente, che gli dà le sue
// proprietà. I due capi di uno spostamento (lo stesso `mv`) vanno insieme.
import type { Node as PmNode, MarkType } from "prosemirror-model";
import { Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Rev } from "./projection";
import { revTitle, richSchema, sameRev } from "./schema";
import { untracked } from "./track";

export interface FindQuery {
  readonly text: string;
  /// Maiuscole e minuscole contano.
  readonly matchCase: boolean;
  /// Soltanto parole intere.
  readonly wholeWord: boolean;
}

export interface Match {
  readonly from: number;
  readonly to: number;
}

const OBJECT = "￼";
const WORD = /[\p{L}\p{N}\p{M}_]/u;

/// Il testo di un paragrafo e la posizione del documento di ogni sua unità.
function paragraphText(paragraph: PmNode, pos: number): { text: string; at: number[] } {
  let text = "";
  const at: number[] = [];
  paragraph.forEach((child, offset) => {
    const from = pos + 1 + offset;
    const piece = child.isText ? child.text ?? "" : child.type === richSchema.nodes.brk ? "\n" : OBJECT;
    for (let i = 0; i < piece.length; i += 1) at.push(from + i);
    text += piece;
  });
  return { text, at };
}

/// Minuscolo unità per unità: un carattere che in minuscolo cambia lunghezza
/// (la `İ` turca) resta com'è, perché gli indici tornino al documento.
function fold(text: string): string {
  let out = "";
  for (const ch of text) {
    const lower = ch.toLowerCase();
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
}

/// Le occorrenze di `query` nel documento, in ordine.
export function findMatches(doc: PmNode, query: FindQuery): Match[] {
  const needle = query.matchCase ? query.text : fold(query.text);
  if (needle === "" || needle.includes(OBJECT)) return [];
  const out: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const { text, at } = paragraphText(node, pos);
    const hay = query.matchCase ? text : fold(text);
    for (let start = hay.indexOf(needle); start >= 0; start = hay.indexOf(needle, start + 1)) {
      const end = start + needle.length;
      if (query.wholeWord && (WORD.test(hay[start - 1] ?? "") || WORD.test(hay[end] ?? ""))) continue;
      out.push({ from: at[start]!, to: at[end - 1]! + 1 });
    }
    return false;
  });
  return out;
}

/// La sostituzione di un'occorrenza: il testo nuovo con le marche del primo
/// carattere sostituito, o niente.
function replaceOne(tr: Transaction, match: Match, text: string): void {
  if (text === "") {
    tr.delete(match.from, match.to);
    return;
  }
  const marks = tr.doc.nodeAt(match.from)?.marks ?? [];
  tr.replaceWith(match.from, match.to, richSchema.text(text, marks));
}

/// Sostituisce l'occorrenza `match`, se c'è ancora, e seleziona il testo nuovo.
export function replaceMatch(query: FindQuery, match: Match, text: string): Command {
  return (state, dispatch) => {
    const still = findMatches(state.doc, query).some((m) => m.from === match.from && m.to === match.to);
    if (!still) return false;
    if (dispatch) {
      const tr = state.tr;
      replaceOne(tr, match, text);
      tr.setSelection(TextSelection.create(tr.doc, match.from, match.from + text.length)).scrollIntoView();
      dispatch(tr);
    }
    return true;
  };
}

/// Sostituisce tutte le occorrenze in una battuta sola.
export function replaceAll(query: FindQuery, text: string): Command {
  return (state, dispatch) => {
    const matches = findMatches(state.doc, query);
    if (matches.length === 0) return false;
    if (dispatch) {
      const tr = state.tr;
      // Dall'ultima alla prima: le posizioni prima restano quelle.
      for (const match of [...matches].reverse()) replaceOne(tr, match, text);
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

// ── Le occorrenze mostrate ────────────────────────────────────────────────

interface Shown {
  readonly query: FindQuery | null;
  /// L'occorrenza corrente, per indice.
  readonly current: number;
  readonly decorations: DecorationSet;
}

export const findKey = new PluginKey<Shown>("fub-rich-find");

function decorate(doc: PmNode, query: FindQuery | null, current: number): DecorationSet {
  if (!query) return DecorationSet.empty;
  const matches = findMatches(doc, query);
  return DecorationSet.create(
    doc,
    matches.map((m, i) =>
      Decoration.inline(m.from, m.to, {
        class: i === current ? "rich-find rich-find-current" : "rich-find",
      }),
    ),
  );
}

/// Il plugin che mostra le occorrenze della ricerca aperta.
export const findPlugin = new Plugin<Shown>({
  key: findKey,
  state: {
    init: () => ({ query: null, current: -1, decorations: DecorationSet.empty }),
    apply(tr, shown) {
      const meta = tr.getMeta(findKey) as { query: FindQuery | null; current: number } | undefined;
      if (meta) return { ...meta, decorations: decorate(tr.doc, meta.query, meta.current) };
      if (!tr.docChanged || !shown.query) return shown;
      return { ...shown, decorations: decorate(tr.doc, shown.query, shown.current) };
    },
  },
  props: {
    decorations: (state) => findKey.getState(state)?.decorations,
  },
});

/// Mostra le occorrenze di `query` (nessuna con `null`) e porta il cursore su
/// quella di indice `current`, se c'è.
export function showMatches(query: FindQuery | null, current = -1): Command {
  return (state, dispatch) => {
    if (dispatch) {
      const tr = state.tr.setMeta(findKey, { query, current }).setMeta("addToHistory", false);
      const match = query ? findMatches(state.doc, query)[current] : undefined;
      if (match) tr.setSelection(TextSelection.create(state.doc, match.from, match.to)).scrollIntoView();
      dispatch(tr);
    }
    return true;
  };
}

/// L'indice dell'occorrenza dopo (o prima) del cursore, girando in fondo.
export function nextMatch(state: EditorState, matches: readonly Match[], direction: 1 | -1): number {
  if (matches.length === 0) return -1;
  const { from, to } = state.selection;
  if (direction === 1) {
    const at = matches.findIndex((m) => m.from >= to);
    return at < 0 ? 0 : at;
  }
  for (let i = matches.length - 1; i >= 0; i -= 1) if (matches[i]!.to <= from) return i;
  return matches.length - 1;
}

// ── Il conteggio ──────────────────────────────────────────────────────────

export interface TextCount {
  readonly words: number;
  readonly characters: number;
  /// Caratteri senza gli spazi.
  readonly visible: number;
  /// I paragrafi con del testo.
  readonly paragraphs: number;
}

/// Parole, caratteri e paragrafi fra `from` e `to` (tutto il documento se
/// mancano), come li conta Word: una parola è ciò che sta fra due spazi, un
/// oggetto o un segno non è testo, un a-capo separa.
export function countText(doc: PmNode, from = 0, to = doc.content.size): TextCount {
  let words = 0;
  let characters = 0;
  let visible = 0;
  let paragraphs = 0;
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      const lo = Math.max(from, start) - start;
      const hi = Math.min(to, start + child.nodeSize) - start;
      if (hi <= lo) return;
      if (child.isText) text += (child.text ?? "").slice(lo, hi);
      else if (child.type === richSchema.nodes.brk) text += "\n";
      // Un oggetto separa le parole senza essere un carattere.
      else if (child.attrs.kind !== "marker") text += "\n";
    });
    const tokens = text.match(/\S+/gu);
    if (tokens) {
      words += tokens.length;
      paragraphs += 1;
    }
    for (const ch of text) {
      if (ch === "\n") continue;
      characters += 1;
      if (!/\s/u.test(ch)) visible += 1;
    }
    return false;
  });
  return { words, characters, visible, paragraphs };
}

// ── Le revisioni tracciate ────────────────────────────────────────────────

export type RevKind = "ins" | "del";

/// Un pezzo di una modifica: tratti vicini di un paragrafo, o il suo segno di
/// fine (`para` è la posizione del paragrafo).
type Piece = { readonly from: number; readonly to: number; readonly para?: number };

export interface Change {
  readonly kind: RevKind;
  readonly rev: Rev;
  readonly from: number;
  readonly to: number;
  readonly pieces: readonly Piece[];
}

const REV_KINDS: readonly RevKind[] = ["ins", "del"];

function revOf(node: PmNode, kind: RevKind): Rev | null {
  const mark = node.marks.find((m) => m.type.name === kind);
  return mark ? (mark.attrs.rev as Rev) : null;
}

/// Le modifiche del documento, in ordine. Un tratto che è inserito ed
/// eliminato insieme ne fa parte due volte, una per specie.
export function revisions(doc: PmNode): Change[] {
  const out: Change[] = [];
  for (const kind of REV_KINDS) {
    let open: { rev: Rev; from: number; to: number; pieces: Piece[] } | null = null;
    const add = (rev: Rev, piece: Piece) => {
      if (open && open.to === piece.from && sameRev(open.rev, rev)) {
        open.to = piece.to;
        open.pieces.push(piece);
        return;
      }
      if (open) out.push({ kind, ...open });
      open = { rev, from: piece.from, to: piece.to, pieces: [piece] };
    };
    doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      node.forEach((child, offset) => {
        const rev = revOf(child, kind);
        const from = pos + 1 + offset;
        if (rev) add(rev, { from, to: from + child.nodeSize });
      });
      const mark = node.attrs[kind] as Rev | null;
      // Il segno sta fra la fine del paragrafo e l'inizio del seguente: un
      // tratto del seguente in testa lo continua.
      if (mark) add(mark, { from: pos + node.nodeSize - 1, to: pos + node.nodeSize + 1, para: pos });
      return false;
    });
    if (open) out.push({ kind, ...(open as { rev: Rev; from: number; to: number; pieces: Piece[] }) });
  }
  return out.sort((a, b) => a.from - b.from || a.to - b.to);
}

/// La selezione di una modifica: un segno di fine in coda finisce nel suo
/// paragrafo, non dentro ciò che segue.
function select(tr: Transaction, change: Change): Transaction {
  const last = change.pieces[change.pieces.length - 1]!;
  const to = last.para !== undefined ? last.from : change.to;
  return tr.setSelection(TextSelection.create(tr.doc, change.from, Math.max(change.from, to)));
}

/// Le modifiche sotto la selezione, o quella del cursore.
function changesAt(state: EditorState, all: readonly Change[]): Change[] {
  const { from, to, empty } = state.selection;
  return all.filter((c) => (empty ? c.from <= from && from <= c.to : c.from < to && from < c.to));
}

/// Con i capi degli spostamenti che toccano.
function withMoves(all: readonly Change[], chosen: readonly Change[]): Change[] {
  const moves = new Set(chosen.map((c) => c.rev.mv).filter((mv): mv is string => mv !== undefined));
  return all.filter((c) => chosen.includes(c) || (c.rev.mv !== undefined && moves.has(c.rev.mv)));
}

/// Applica `accept` (o rifiuta) le modifiche, dall'ultima alla prima.
function resolve(tr: Transaction, changes: readonly Change[], accept: boolean): void {
  const ops: { piece: Piece; kind: RevKind }[] = [];
  for (const change of changes) for (const piece of change.pieces) ops.push({ piece, kind: change.kind });
  ops.sort((a, b) => b.piece.from - a.piece.from);
  for (const { piece, kind } of ops) {
    // Tenere: l'inserimento accettato, l'eliminazione rifiutata.
    const keep = accept === (kind === "ins");
    if (piece.para === undefined) {
      const from = tr.mapping.map(piece.from, 1);
      const to = tr.mapping.map(piece.to, -1);
      if (to <= from) continue;
      if (keep) tr.removeMark(from, to, richSchema.marks[kind] as MarkType);
      else tr.delete(from, to);
      continue;
    }
    const at = tr.mapping.map(piece.para, 1);
    const paragraph = tr.doc.nodeAt(at);
    if (!paragraph || !paragraph.isTextblock || !paragraph.attrs[kind]) continue;
    const end = at + paragraph.nodeSize;
    const next = tr.doc.nodeAt(end);
    if (keep || !next || next.type !== richSchema.nodes.para) {
      // Senza un paragrafo dopo, il segno resta: il paragrafo non si unisce
      // a una tabella o a una sezione.
      tr.setNodeAttribute(at, kind, null);
      continue;
    }
    const attrs = next.attrs;
    tr.join(end);
    tr.setNodeMarkup(at, null, attrs);
  }
}

/// Accetta (o rifiuta) la modifica sotto il cursore, o quelle della
/// selezione, poi va alla seguente.
export function resolveRevision(accept: boolean): Command {
  return (state, dispatch) => {
    const all = revisions(state.doc);
    const chosen = changesAt(state, all);
    if (chosen.length === 0) return false;
    if (dispatch) {
      const tr = state.tr;
      const changes = withMoves(all, chosen);
      resolve(tr, changes, accept);
      const after = tr.mapping.map(Math.max(...chosen.map((c) => c.to)));
      const next = revisions(tr.doc).find((c) => c.from >= after);
      if (next) select(tr, next);
      else tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(after, tr.doc.content.size))));
      // Accettare o rifiutare non è una modifica da registrare.
      dispatch(untracked(tr.scrollIntoView()));
    }
    return true;
  };
}

/// Accetta (o rifiuta) ogni modifica del documento in una battuta.
export function resolveAll(accept: boolean): Command {
  return (state, dispatch) => {
    const all = revisions(state.doc);
    if (all.length === 0) return false;
    if (dispatch) {
      const tr = state.tr;
      resolve(tr, all, accept);
      dispatch(untracked(tr.scrollIntoView()));
    }
    return true;
  };
}

/// La modifica di specie `kind` che comincia in `from`, come l'ha data
/// `revisions`: chi l'ha mostrata la ritrova anche se nel frattempo le altre
/// sono cambiate.
function changeAt(doc: PmNode, kind: RevKind, from: number): { all: Change[]; change: Change } | null {
  const all = revisions(doc);
  const change = all.find((c) => c.kind === kind && c.from === from);
  return change ? { all, change } : null;
}

/// Seleziona una modifica dell'elenco.
export function goToChange(kind: RevKind, from: number): Command {
  return (state, dispatch) => {
    const found = changeAt(state.doc, kind, from);
    if (!found) return false;
    if (dispatch) dispatch(select(state.tr, found.change).scrollIntoView());
    return true;
  };
}

/// Accetta (o rifiuta) una modifica dell'elenco, con l'altro capo se è uno
/// spostamento.
export function resolveChange(kind: RevKind, from: number, accept: boolean): Command {
  return (state, dispatch) => {
    const found = changeAt(state.doc, kind, from);
    if (!found) return false;
    if (dispatch) {
      const tr = state.tr;
      resolve(tr, withMoves(found.all, [found.change]), accept);
      dispatch(untracked(tr));
    }
    return true;
  };
}

/// Il testo di una modifica, per l'elenco: vuoto per il solo segno di fine
/// di un paragrafo.
export function changeText(doc: PmNode, change: Change): string {
  return change.pieces
    .filter((piece) => piece.para === undefined)
    .map((piece) => doc.textBetween(piece.from, piece.to, " ", " "))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/// Seleziona la modifica dopo (o prima) della selezione, girando in fondo.
export function goToRevision(direction: 1 | -1): Command {
  return (state, dispatch) => {
    const all = revisions(state.doc);
    if (all.length === 0) return false;
    const { from, to, empty } = state.selection;
    // Dal cursore all'inizio di una modifica, la seguente è quella.
    const change = direction === 1
      ? all.find((c) => (empty ? c.from >= to : c.from >= to || c.from > from)) ?? all[0]!
      : [...all].reverse().find((c) => c.from < from) ?? all[all.length - 1]!;
    if (dispatch) dispatch(select(state.tr, change).scrollIntoView());
    return true;
  };
}

/// Il segno di fine dei paragrafi revisionati, e il testo scritto dentro una
/// revisione che non la prende.
const revisionKey = new PluginKey<DecorationSet>("fub-rich-revisions");

export const revisionPlugin = new Plugin<DecorationSet>({
  key: revisionKey,
  state: {
    init: (_config, state) => markWidgets(state.doc),
    apply: (tr, set) => (tr.docChanged ? markWidgets(tr.doc) : set),
  },
  props: {
    decorations: (state) => revisionKey.getState(state),
    handleTextInput(view, from, to, _text, deflt) {
      const tr = deflt();
      const end = tr.mapping.map(to);
      const start = tr.mapping.map(from, -1);
      if (!tr.doc.rangeHasMark(start, end, richSchema.marks.ins) && !tr.doc.rangeHasMark(start, end, richSchema.marks.del)) return false;
      // Quello che chi scrive aggiunge è suo, non di chi ha fatto la
      // revisione intorno.
      tr.removeMark(start, end, richSchema.marks.ins).removeMark(start, end, richSchema.marks.del);
      view.dispatch(tr);
      return true;
    },
  },
});

function markWidgets(doc: PmNode): DecorationSet {
  const widgets: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    for (const kind of REV_KINDS) {
      const rev = node.attrs[kind] as Rev | null;
      if (!rev) continue;
      const end = pos + node.nodeSize - 1;
      widgets.push(
        Decoration.widget(
          end,
          () => {
            const span = document.createElement("span");
            span.className = `rich-${kind}-mark`;
            span.textContent = "¶";
            span.title = revTitle(kind, rev);
            span.setAttribute("aria-hidden", "true");
            return span;
          },
          { side: 1, marks: [], key: `${kind}:${JSON.stringify(rev)}`, ignoreSelection: true },
        ),
      );
    }
    return false;
  });
  return DecorationSet.create(doc, widgets);
}
