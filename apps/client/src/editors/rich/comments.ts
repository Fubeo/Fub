// I commenti nella superficie ricca: aggiungerli sulla selezione, rispondere,
// risolverli e toglierli.
//
// L'elenco dei commenti è un attributo del documento ProseMirror, così ogni
// gesto è una battuta sola con i segni nel testo e la cronologia lo disfa
// tutto insieme. Un commento segna il suo intervallo con due oggetti `marker`
// che portano il suo id: l'inizio e la fine (`end`). Una risposta ha i suoi
// segni accanto a quelli del commento a cui risponde, come li scrive Word.
//
// Il testo di un commento che c'era resta com'è: si cambia soltanto se è
// risolto. Togliere un commento toglie con lui le risposte e i loro segni.
import type { Node as PmNode } from "prosemirror-model";
import { Plugin, PluginKey, TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Anchor, CommentView } from "./projection";
import { richSchema } from "./schema";
import { untracked } from "./track";

/// Il testo più lungo di un commento nuovo, in byte UTF-8, come il codec.
export const MAX_COMMENT_BYTES = 64 * 1024;

/// I commenti del documento, nell'ordine in cui il documento li tiene.
export function commentsOf(doc: PmNode): readonly CommentView[] {
  return (doc.attrs.comments as readonly CommentView[] | undefined) ?? [];
}

/// Dove stanno i segni di inizio e di fine di ciascun commento.
export interface Place {
  start?: number;
  end?: number;
}

export function anchorsOf(doc: PmNode): Map<number, Place> {
  const out = new Map<number, Place>();
  doc.descendants((node, pos) => {
    const anchor = node.type === richSchema.nodes.atom ? (node.attrs.comment as Anchor | null) : null;
    if (anchor) {
      const place = out.get(anchor.id) ?? {};
      if (anchor.end) place.end = pos;
      else place.start = pos;
      out.set(anchor.id, place);
    }
    return true;
  });
  return out;
}

/// Il commento `id` e, di seguito, tutte le risposte che ha.
export function threadOf(comments: readonly CommentView[], id: number): Set<number> {
  const out = new Set<number>([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const comment of comments) {
      if (comment.parent !== undefined && out.has(comment.parent) && !out.has(comment.id)) {
        out.add(comment.id);
        grew = true;
      }
    }
  }
  return out;
}

/// Un filo del pannello: il commento, il testo che segna e le risposte, in
/// ordine.
export interface Thread {
  readonly comment: CommentView;
  /// Il testo commentato; vuoto quando i segni non lo racchiudono.
  readonly quote: string;
  /// Il testo si raggiunge: ha i suoi due segni.
  readonly placed: boolean;
  /// Le risposte, anche quelle alle risposte, nell'ordine in cui sono state
  /// scritte; `depth` 1 risponde al commento.
  readonly replies: readonly { readonly comment: CommentView; readonly depth: number }[];
}

/// I commenti nell'ordine in cui stanno nel testo, come li mostra Word; quelli
/// che non hanno un posto vanno in fondo, nell'ordine del documento.
export function commentThreads(doc: PmNode): Thread[] {
  const comments = commentsOf(doc);
  if (comments.length === 0) return [];
  const anchors = anchorsOf(doc);
  const ids = new Set(comments.map((c) => c.id));
  const roots = comments.filter((c) => c.parent === undefined || !ids.has(c.parent));
  const threads = roots.map((comment, order) => {
    const place = anchors.get(comment.id);
    const placed = place?.start !== undefined && place.end !== undefined && place.end > place.start;
    const quote = placed ? doc.textBetween(place.start! + 1, place.end!, " ", " ").trim() : "";
    const replies: { comment: CommentView; depth: number }[] = [];
    // Un file che fa rispondere un commento a sé stesso non gira in tondo.
    const seen = new Set([comment.id]);
    const walk = (parent: number, depth: number) => {
      for (const child of comments) {
        if (child.parent !== parent || seen.has(child.id)) continue;
        seen.add(child.id);
        replies.push({ comment: child, depth });
        walk(child.id, depth + 1);
      }
    };
    walk(comment.id, 1);
    return { thread: { comment, quote, placed, replies }, at: placed ? place.start! : Number.POSITIVE_INFINITY, order };
  });
  threads.sort((a, b) => a.at - b.at || a.order - b.order);
  return threads.map((each) => each.thread);
}

/// Il testo di un commento nuovo come il codec lo accetta: un a capo per
/// paragrafo, un tab come spazio, niente altri caratteri di controllo né
/// segni di oggetto. `null` se resta vuoto o è troppo lungo.
export function commentText(text: string): string | null {
  const clean = text.replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(/[\u0000-\u0009\u000b-\u001f\u007f￼]/g, "");
  if (clean.trim() === "" || new TextEncoder().encode(clean).length > MAX_COMMENT_BYTES) return null;
  return clean;
}

function marker(id: number, end: boolean): PmNode {
  return richSchema.nodes.atom.create({ kind: "marker", comment: end ? { id, end: true } : { id } });
}

function freshId(doc: PmNode): number {
  let max = 0;
  for (const comment of commentsOf(doc)) max = Math.max(max, comment.id);
  for (const id of anchorsOf(doc).keys()) max = Math.max(max, id);
  return max + 1;
}

/// Un'ora come la scrive Word: al secondo, in UTC.
function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/// Un commento non è testo scritto: non si registra come revisione.
function withComments(tr: Transaction, comments: readonly CommentView[]): Transaction {
  return untracked(tr.setDocAttribute("comments", comments));
}

/// Un commento nuovo di `by` sulla selezione, che non sia vuota.
export function addComment(text: string, by: string, at: string = now()): Command {
  return (state, dispatch) => {
    const said = commentText(text);
    const { selection } = state;
    if (said === null || selection.empty || !selection.$from.parent.inlineContent || !selection.$to.parent.inlineContent) {
      return false;
    }
    if (dispatch) {
      const id = freshId(state.doc);
      const tr = state.tr.insert(selection.to, marker(id, true)).insert(selection.from, marker(id, false));
      const view: CommentView = { id, ...(by ? { by } : {}), at, text: said };
      dispatch(withComments(tr, [...commentsOf(state.doc), view]).scrollIntoView());
    }
    return true;
  };
}

/// Si può commentare la selezione.
export function canComment(state: EditorState): boolean {
  return addComment("·", "")(state);
}

/// Una risposta di `by` al commento `parent`, con i segni accanto ai suoi.
export function replyComment(parent: number, text: string, by: string, at: string = now()): Command {
  return (state, dispatch) => {
    const said = commentText(text);
    const comments = commentsOf(state.doc);
    if (said === null || !comments.some((c) => c.id === parent)) return false;
    if (dispatch) {
      const id = freshId(state.doc);
      const anchors = anchorsOf(state.doc);
      // Dopo l'ultimo segno del filo, di inizio e di fine.
      let start = -1;
      let end = -1;
      for (const member of threadOf(comments, parent)) {
        const place = anchors.get(member);
        if (place?.start !== undefined) start = Math.max(start, place.start);
        if (place?.end !== undefined) end = Math.max(end, place.end);
      }
      let tr = state.tr;
      if (start >= 0 && end > start) tr = tr.insert(end + 1, marker(id, true)).insert(start + 1, marker(id, false));
      const view: CommentView = { id, ...(by ? { by } : {}), at, parent, text: said };
      dispatch(withComments(tr, [...comments, view]));
    }
    return true;
  };
}

/// Toglie il commento `id` con le sue risposte e i loro segni.
export function deleteComment(id: number): Command {
  return (state, dispatch) => {
    const comments = commentsOf(state.doc);
    if (!comments.some((c) => c.id === id)) return false;
    if (dispatch) {
      const gone = threadOf(comments, id);
      const at: number[] = [];
      for (const [member, place] of anchorsOf(state.doc)) {
        if (!gone.has(member)) continue;
        if (place.start !== undefined) at.push(place.start);
        if (place.end !== undefined) at.push(place.end);
      }
      const tr = state.tr;
      // Dall'ultimo al primo: le posizioni prima restano quelle.
      for (const pos of at.sort((a, b) => b - a)) tr.delete(pos, pos + 1);
      dispatch(withComments(tr, comments.filter((c) => !gone.has(c.id))));
    }
    return true;
  };
}

/// Risolve (o riapre) il commento `id` con le sue risposte.
export function resolveComment(id: number, done: boolean): Command {
  return (state, dispatch) => {
    const comments = commentsOf(state.doc);
    const found = comments.find((c) => c.id === id);
    if (!found || (found.done === true) === done) return false;
    if (dispatch) {
      const thread = threadOf(comments, id);
      const next = comments.map((comment) => {
        if (!thread.has(comment.id)) return comment;
        const { done: _, ...rest } = comment;
        return done ? { ...rest, done: true } : rest;
      });
      dispatch(withComments(state.tr, next));
    }
    return true;
  };
}

/// Seleziona il testo che il commento `id` segna.
export function goToComment(id: number): Command {
  return (state, dispatch) => {
    const place = anchorsOf(state.doc).get(id);
    if (place?.start === undefined || place.end === undefined || place.end <= place.start) return false;
    if (dispatch) {
      const selection = TextSelection.create(state.doc, place.start + 1, place.end);
      dispatch(state.tr.setSelection(selection).scrollIntoView());
    }
    return true;
  };
}

// ── Gli intervalli mostrati ───────────────────────────────────────────────

export const commentKey = new PluginKey<DecorationSet>("fub-rich-comments");

/// Il testo di ogni commento aperto ha uno sfondo, e dice chi l'ha scritto a
/// chi ci passa sopra. Un commento risolto non si segna più.
export const commentPlugin = new Plugin<DecorationSet>({
  key: commentKey,
  state: {
    init: (_config, state) => ranges(state.doc),
    apply: (tr, set) => (tr.docChanged ? ranges(tr.doc) : set),
  },
  props: {
    decorations: (state) => commentKey.getState(state),
  },
});

function ranges(doc: PmNode): DecorationSet {
  const comments = commentsOf(doc);
  if (comments.length === 0) return DecorationSet.empty;
  const out: Decoration[] = [];
  for (const [id, place] of anchorsOf(doc)) {
    const comment = comments.find((c) => c.id === id);
    if (!comment || comment.done || comment.parent !== undefined) continue;
    if (place.start === undefined || place.end === undefined || place.end <= place.start + 1) continue;
    const title = comment.by ? `${comment.by}: ${comment.text ?? ""}` : (comment.text ?? "");
    out.push(Decoration.inline(place.start + 1, place.end, { class: "rich-comment", title, "data-rich-comment": String(id) }));
  }
  return DecorationSet.create(doc, out);
}
