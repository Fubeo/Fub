// I commenti in Scrittura: i segni non si vedono, il passo ha il suo fondo, e
// il cursore salta ogni segno come un pezzo solo.
//
// Le decorazioni nascono dentro `computeDecorations` (`livepreview.ts`), che
// per ogni contenitore chiede i commenti a `containerComments` e qui come
// disegnarli: la resa incrementale resta quella di oggi, e una battuta rifà
// soltanto i blocchi che tocca. I segni nascosti sono `hide`, cioè atomici:
// `{==` è un pezzo, la chiusura `==}` coi messaggi che la seguono un altro.
// Scrivere dentro il passo è scrivere nel testo della nota.
//
// Cancellare tutto il testo di un passo toglie anche il commento, nello
// stesso passo d'annullamento, e un avviso lo dice con «Annulla».
import { undo } from "@codemirror/commands";
import { EditorSelection, EditorState, StateEffect, Transaction, type Extension, type Text, type TransactionSpec } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { SyntaxForm } from "../../../../../host/contract";
import { notify } from "../../../../../ui/notify";
import type { LiveDeco, Reveal } from "../livepreview";
import { liveStrings } from "../strings";
import { liveReveal } from "../../../live-reveal";
import { copiedMarkdown } from "./copy";
import { MARK_LEN, mayHaveComments, threadCuts, threadTail, type CommentThread } from "./syntax";
import { threadsIn } from "./threads";

/// Come si disegna un commento con la rivelazione `reveal`. Con `mai`
/// spariscono `{==` e la coda (`==}` e i messaggi); con `riga` ed `elemento`
/// i segni restano, più chiari, e i messaggi a voce bassa come i commenti
/// `%%…%%`. Il passo ha il fondo del commento, più pieno col cursore dentro.
export function commentDecorations(thread: CommentThread, reveal: Reveal, doc: Text): LiveDeco[] {
  const out: LiveDeco[] = [];
  const shown = reveal.marks(thread.from, thread.to, thread.from);
  const passage = thread.passage;
  if (passage) {
    if (shown) {
      out.push({ from: passage.from, to: passage.contentFrom, kind: "near" });
      out.push({ from: passage.contentTo, to: passage.to, kind: "near" });
    } else {
      out.push({ from: passage.from, to: passage.contentFrom, kind: "hide" });
    }
    const on = reveal.near(passage.contentFrom, passage.contentTo);
    // Un segno non attraversa il fine riga: il passo che va a capo ne ha uno
    // per riga.
    for (let at = passage.contentFrom; at < passage.contentTo;) {
      const end = Math.min(doc.lineAt(at).to, passage.contentTo);
      if (end > at) out.push({ from: at, to: end, kind: "comment-range", ...(on ? { data: "on" } : {}) });
      at = end + 1;
    }
  }
  if (shown) {
    for (const message of thread.messages) out.push({ from: message.from, to: message.to, kind: "highlight", data: "comment" });
  } else {
    out.push({ ...threadTail(thread), kind: "hide" });
  }
  return out;
}

/// Il commento tolto con una cancellazione: dove stava nel testo di dopo, e
/// i messaggi che portava.
interface Removed {
  readonly at: number;
  readonly messages: string;
}

const commentRemoved = StateEffect.define<Removed>({
  map: (value, changes) => ({ ...value, at: changes.mapPos(value.at) }),
});

/// I commenti che la modifica lascia col passo vuoto: il passo aveva testo,
/// la modifica lo cancella tutto e non ne scrive altro, e non tocca i segni
/// né i messaggi. `null` se non ce n'è.
export function emptiedThreads(tr: Transaction, forms?: readonly SyntaxForm[]): CommentThread[] | null {
  if (!tr.docChanged) return null;
  let low = Infinity;
  let high = -1;
  tr.changes.iterChangedRanges((fromA, toA) => {
    if (toA > fromA) {
      low = Math.min(low, fromA);
      high = Math.max(high, toA);
    }
  });
  if (high < 0) return null;
  const doc = tr.startState.doc;
  // La chiusura del passo e il primo messaggio stanno sulla riga dove la
  // cancellazione finisce: senza `{>>` lì, non c'è niente da togliere.
  if (!mayHaveComments(doc.sliceString(doc.lineAt(low).from, doc.lineAt(high).to))) return null;
  const emptied: CommentThread[] = [];
  for (const thread of threadsIn(tr.startState, low, high, forms)) {
    const passage = thread.passage;
    if (!passage || passage.contentFrom === passage.contentTo) continue;
    let marksTouched = false;
    tr.changes.iterChangedRanges((fromA, toA) => {
      if (fromA < passage.contentFrom && toA > passage.from) marksTouched = true;
      if (fromA < thread.to && toA > passage.contentTo) marksTouched = true;
    });
    if (marksTouched) continue;
    const open = tr.changes.mapPos(passage.from, 1);
    const close = tr.changes.mapPos(passage.contentTo, 1);
    if (open + MARK_LEN !== close) continue;
    if (tr.newDoc.sliceString(open, close + MARK_LEN) !== "{====}") continue;
    emptied.push(thread);
  }
  return emptied.length > 0 ? emptied : null;
}

/// Con i segni nascosti (`mai`) una modifica dell'utente non ne porta via
/// metà: se tocca i segni di un commento senza prenderlo tutto, cancella il
/// testo che si vede e lascia i segni e i messaggi dove sono. Così selezionare
/// il passo e cancellarlo, anche con un segno nascosto dentro la selezione,
/// svuota il passo invece di rompere il commento. La regola vale per ogni
/// pezzo di una modifica: più cursori, un trascinamento (`move.drop`, che
/// toglie da un posto e scrive in un altro). Ciò che un pezzo scrive entra al
/// primo carattere visibile che cancella; il testo trascinato, se è quello
/// tolto, perde i segni dei commenti che taglia, come una copia. Le modifiche
/// con effetti oltre all'annuncio per il lettore di schermo (che resta)
/// restano come sono. `null` se la modifica non tocca segni. Un gesto che,
/// tolti i segni, non cancella né scrive niente (prende soltanto un segno
/// nascosto) non cambia il testo: i gesti di tastiera accanto ai segni li
/// salta prima `livepreview.ts`, fino al testo che si vede.
export function keepCommentMarks(tr: Transaction, forms?: readonly SyntaxForm[]): TransactionSpec | null {
  if (tr.effects.some((effect) => !effect.is(EditorView.announce))) return null;
  const doc = tr.startState.doc;
  interface Piece {
    readonly fromA: number;
    readonly toA: number;
    readonly fromB: number;
    readonly toB: number;
    inserted: string;
    /// I tratti che restano da cancellare, e dove entra ciò che si scrive.
    readonly cuts: readonly { from: number; to: number }[];
    readonly insertAt: number;
  }
  const pieces: Piece[] = [];
  let touched = false;
  tr.changes.iterChanges((fromA, toA, fromB, toB, text) => {
    const inserted = text.toString();
    const unchanged = { fromA, toA, fromB, toB, inserted, cuts: toA > fromA ? [{ from: fromA, to: toA }] : [], insertAt: fromA };
    if (toA <= fromA || !mayHaveComments(doc.sliceString(doc.lineAt(fromA).from, doc.lineAt(toA).to))) {
      pieces.push(unchanged);
      return;
    }
    const kept: { from: number; to: number }[] = [];
    for (const thread of threadsIn(tr.startState, fromA, toA, forms)) {
      if (fromA <= thread.from && thread.to <= toA) continue;
      for (const cut of threadCuts(thread)) if (cut.from < toA && fromA < cut.to) kept.push(cut);
    }
    if (kept.length === 0) {
      pieces.push(unchanged);
      return;
    }
    touched = true;
    kept.sort((a, b) => a.from - b.from);
    const cuts: { from: number; to: number }[] = [];
    let at = fromA;
    for (const cut of kept) {
      if (cut.from > at) cuts.push({ from: at, to: Math.min(cut.from, toA) });
      at = Math.max(at, cut.to);
    }
    if (at < toA) cuts.push({ from: at, to: toA });
    // Un pezzo tutto dentro i segni scrive dopo di loro, al bordo del primo
    // segno che lo contiene: mai in mezzo a un segno.
    const insertAt = cuts[0]?.from ?? at;
    pieces.push({ fromA, toA, fromB, toB, inserted, cuts, insertAt });
  });
  if (!touched) return null;
  // Il testo trascinato arriva dagli appunti del trascinamento, già ripulito
  // (`commentCopy`); un motore che portasse il sorgente grezzo scriverebbe
  // altrove un `{==` senza il resto.
  if (tr.isUserEvent("move.drop")) {
    for (const piece of pieces) {
      if (piece.inserted === "") continue;
      const source = pieces.find((other) => other.toA > other.fromA && doc.sliceString(other.fromA, other.toA) === piece.inserted);
      if (source) piece.inserted = copiedMarkdown(tr.startState, source.fromA, source.toA, forms);
    }
  }
  const specs: { from: number; to?: number; insert?: string }[] = [];
  for (const piece of pieces) {
    let wrote = piece.inserted === "";
    for (const cut of piece.cuts) {
      if (!wrote && cut.from === piece.insertAt) {
        specs.push({ from: cut.from, to: cut.to, insert: piece.inserted });
        wrote = true;
      } else {
        specs.push({ from: cut.from, to: cut.to });
      }
    }
    if (!wrote) specs.push({ from: piece.insertAt, insert: piece.inserted });
  }
  const changes = tr.startState.changes(specs);
  // Dove va un punto del testo di dopo: dentro o al bordo di un pezzo, nello
  // stesso posto del pezzo rifatto (ciò che si scrive resta intero); fra un
  // pezzo e l'altro, il testo di prima che non cambia.
  const inverse = tr.changes.invertedDesc;
  const mapB = (pos: number): number => {
    for (const piece of pieces) {
      if (pos < piece.fromB || pos > piece.toB) continue;
      const start = changes.mapPos(piece.insertAt, -1);
      if (pos === piece.toB) return start + piece.inserted.length;
      return start + Math.min(pos - piece.fromB, piece.inserted.length);
    }
    return changes.mapPos(inverse.mapPos(pos));
  };
  const selection = tr.selection
    ? EditorSelection.create(
        tr.selection.ranges.map((range) => EditorSelection.range(mapB(range.anchor), mapB(range.head))),
        tr.selection.mainIndex,
      )
    : undefined;
  const userEvent = tr.annotation(Transaction.userEvent);
  return {
    changes,
    ...(selection ? { selection } : {}),
    scrollIntoView: tr.scrollIntoView,
    effects: tr.effects,
    ...(userEvent ? { userEvent } : {}),
  };
}

/// Toglie i segni e i messaggi dei passi che una cancellazione svuota, nella
/// stessa transazione: un annullamento rimette testo e commento insieme. Le
/// modifiche che arrivano da fuori (un'altra superficie, il disco) restano
/// come sono.
function removeEmptied(forms?: readonly SyntaxForm[]): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || !(tr.isUserEvent("delete") || tr.isUserEvent("input") || tr.isUserEvent("move"))) return tr;
    const reshaped = tr.startState.facet(liveReveal) === "mai" ? keepCommentMarks(tr, forms) : null;
    const effective = reshaped ? tr.startState.update({ ...reshaped, filter: false }) : tr;
    const emptied = emptiedThreads(effective, forms);
    if (!emptied) return reshaped ?? tr;
    const changes: { from: number; to: number }[] = [];
    const effects: StateEffect<Removed>[] = [];
    const start = effective.startState.doc;
    for (const thread of emptied) {
      const passage = thread.passage!;
      const open = effective.changes.mapPos(passage.from, 1);
      const end = open + 2 * MARK_LEN + (thread.to - passage.to);
      changes.push({ from: open, to: end });
      effects.push(commentRemoved.of({ at: open, messages: start.sliceString(passage.to, thread.to) }));
    }
    const removal: TransactionSpec = { changes, effects, sequential: true };
    return [reshaped ?? tr, removal];
  });
}

/// L'avviso dopo un commento tolto (o portato via da un taglio, che dice
/// dove è andato), con «Annulla»: se il testo non è cambiato
/// da allora, annulla la cancellazione (testo e commento tornano); altrimenti
/// rimette i messaggi dove stava il passo, come commento sul punto, perché la
/// discussione non vada persa e nessun testo scritto dopo si raddoppi.
const removalNotice = ViewPlugin.fromClass(class {
  private pending: { at: number; messages: string; doc: Text } | null = null;
  constructor(private readonly view: EditorView) {}
  update(update: ViewUpdate): void {
    // La posizione segue il testo; l'avviso riconosce il suo commento
    // dall'oggetto, che resta lo stesso.
    if (this.pending && update.docChanged) this.pending.at = update.changes.mapPos(this.pending.at);
    for (const tr of update.transactions) {
      const removed = tr.effects.filter((effect) => effect.is(commentRemoved)).map((effect) => effect.value as Removed);
      if (removed.length === 0) continue;
      const first = removed[0]!;
      const pending = { at: first.at, messages: removed.map((value) => value.messages).join(""), doc: update.state.doc };
      this.pending = pending;
      const view = this.view;
      // Un taglio porta il commento negli appunti (`copy.ts`): l'avviso lo dice.
      const cut = tr.isUserEvent("delete.cut");
      const message = cut
        ? removed.length > 1 ? "comments.cut.many" : "comments.cut"
        : removed.length > 1 ? "comments.removed.many" : "comments.removed";
      notify(liveStrings.t(message), "info", {
        label: liveStrings.t("comments.removed.undo"),
        hint: liveStrings.t("comments.removed.undo.hint"),
        run: () => {
          if (this.pending !== pending || view.state.readOnly) return;
          this.pending = null;
          if (view.state.doc === pending.doc) {
            undo(view);
            return;
          }
          const at = Math.min(pending.at, view.state.doc.length);
          view.dispatch({ changes: { from: at, insert: pending.messages }, userEvent: "input.comment" });
        },
      });
    }
  }
  destroy(): void {
    this.pending = null;
  }
});

/// Le estensioni dei commenti in Scrittura: la cancellazione che porta via il
/// commento rimasto senza testo, e il suo avviso.
export function commentEditing(forms?: readonly SyntaxForm[]): Extension {
  return [removeEmptied(forms), removalNotice];
}
