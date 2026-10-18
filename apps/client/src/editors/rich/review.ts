// La revisione nella superficie ricca: trova e sostituisci, e il conteggio
// delle parole.
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
import type { Node as PmNode } from "prosemirror-model";
import { Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { richSchema } from "./schema";

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

const ALL_STYLE = "background-color: var(--accent-wash)";
const CURRENT_STYLE = "background-color: var(--accent-soft); outline: 1px solid var(--accent)";

function decorate(doc: PmNode, query: FindQuery | null, current: number): DecorationSet {
  if (!query) return DecorationSet.empty;
  const matches = findMatches(doc, query);
  return DecorationSet.create(
    doc,
    matches.map((m, i) =>
      Decoration.inline(m.from, m.to, {
        class: i === current ? "rich-find rich-find-current" : "rich-find",
        style: i === current ? CURRENT_STYLE : ALL_STYLE,
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
