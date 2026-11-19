// La spunta di un compito nel buffer, con la sua ricorrenza.
//
// Spuntare la casella nella nota (Scrittura, Lettura, il menu del compito,
// `Mod-Enter`) è una modifica del buffer della sessione, non una scrittura del
// file: la spunta non passa da `note.task.toggle`, che scrive il file. La
// regola della ricorrenza (`🔁`) però è una sola, ed è di Rust
// (`fub-features/src/commands/recurrence.rs`): qui la si chiede al componente
// dei compiti (`RemindersQuery::NextOccurrence`, dal canale dati) e la riga che
// risponde entra nella **stessa transazione** della spunta. Così la spunta e la
// riga nuova sono un solo passo della cronologia (un `Mod-z` le toglie
// insieme, come l'annulla di `note.task.toggle`), la sessione le salva come
// ogni battuta, e la vista dei compiti non scrive niente di suo.
//
// Chi monta l'editor dà la domanda con il facet [`taskRecurrence`]; senza (i
// test, una superficie senza vault) la spunta resta sincrona e non ricorre.
import { Facet, type ChangeSpec, type EditorState, type Transaction, type TransactionSpec } from "@codemirror/state";
import { taskChecked } from "../../../../rules/mirrored";

/// La riga del compito che nasce spuntando `line` (senza terminatore), o
/// `null` se `line` non ricorre.
export type NextOccurrence = (line: string) => Promise<string | null>;

/// La domanda della ricorrenza, data da chi monta l'editor.
export const taskRecurrence = Facet.define<NextOccurrence, NextOccurrence | null>({
  combine: (values) => values[0] ?? null,
});

/// Il segno della ricorrenza: solo un filtro per non fare una domanda per
/// ogni spunta. Se la riga ricorre davvero lo dice la regola, di là.
const RECURS = "🔁";

/// Una casella da scrivere: la posizione del simbolo fra le parentesi e il
/// simbolo nuovo.
export interface TaskSymbolEdit {
  readonly symbol: number;
  readonly insert: string;
}

/// Ciò su cui si scrive: una vista, o lo stato con il suo `dispatch` come lo
/// passa un `StateCommand`. `state` va riletto dopo l'attesa: per la vista e
/// per `TextEngine.runCommand` è sempre quello di adesso.
export interface TaskToggleTarget {
  readonly state: EditorState;
  dispatch(transaction: Transaction): void;
}

/// Il resto della transazione. Una funzione riceve come si spostano le
/// posizioni del documento di prima, per ciò che va detto nel documento
/// nuovo (il `lead` di un gesto di blocco): la riga che nasce sposta in giù
/// quella spuntata.
export type TaskToggleSpec =
  | Omit<TransactionSpec, "changes">
  | ((mapPos: (pos: number) => number) => Omit<TransactionSpec, "changes">);

/// Le righe con una spunta in corso, per testo di partenza: un secondo clic
/// sulla stessa casella mentre la domanda è in volo non chiede un'altra riga.
const pending = new WeakMap<object, Set<number>>();

/// Scrive le caselle `edits` (e le `extra`, già calcolate sullo stesso stato)
/// e, per ogni casella che diventa fatta su una riga che ricorre, la riga
/// successiva sopra di lei: tutto in una transazione, con `spec`.
///
/// Senza ricorrenze la transazione parte subito. Con una ricorrenza parte
/// quando la regola ha risposto, se il buffer nel frattempo non ha cambiato
/// quelle righe; se le ha cambiate non si scrive niente, perché la spunta e la
/// riga nuova vanno insieme o per niente. Una domanda che non riesce (il
/// componente dei compiti spento) lascia la sola spunta.
export function dispatchTaskToggles(
  target: TaskToggleTarget,
  edits: readonly TaskSymbolEdit[],
  spec: TaskToggleSpec = {},
  extra: readonly ChangeSpec[] = [],
): void {
  const start = target.state;
  const ask = start.facet(taskRecurrence);
  const doc = start.doc;
  const recurring = ask === null ? [] : edits
    .filter((edit) => taskChecked(edit.insert) && !taskChecked(doc.sliceString(edit.symbol, edit.symbol + 1)))
    .map((edit) => doc.lineAt(edit.symbol))
    .filter((line) => line.text.includes(RECURS));
  const boxes = edits.map((edit): ChangeSpec => ({ from: edit.symbol, to: edit.symbol + 1, insert: edit.insert }));
  if (ask === null || recurring.length === 0) {
    commit(target, start, spec, [...extra, ...boxes]);
    return;
  }
  const busy = pending.get(doc) ?? new Set<number>();
  if (recurring.some((line) => busy.has(line.number))) return;
  pending.set(doc, busy);
  for (const line of recurring) busy.add(line.number);
  void Promise.all(recurring.map((line) => ask(line.text).catch(() => null))).then((answers) => {
    for (const line of recurring) busy.delete(line.number);
    const now = target.state;
    if (now.readOnly) return;
    // Il buffer è cambiato mentre la regola rispondeva: le posizioni valgono
    // solo se ogni riga toccata è ancora quella, allo stesso posto.
    if (now.doc !== doc) {
      if (extra.length > 0 || now.doc.lines !== doc.lines) return;
      for (const edit of edits) {
        const before = doc.lineAt(edit.symbol);
        const after = now.doc.line(before.number);
        if (after.from !== before.from || after.text !== before.text) return;
      }
    }
    const born: ChangeSpec[] = [];
    recurring.forEach((line, i) => {
      const next = answers[i];
      if (typeof next === "string" && !/[\r\n]/.test(next)) born.push({ from: line.from, insert: `${next}\n` });
    });
    commit(target, now, spec, [...extra, ...born, ...boxes]);
  });
}

function commit(target: TaskToggleTarget, state: EditorState, spec: TaskToggleSpec, specs: readonly ChangeSpec[]): void {
  const changes = state.changes(specs);
  const rest = typeof spec === "function" ? spec((pos) => changes.mapPos(pos, 1)) : spec;
  target.dispatch(state.update({ ...rest, changes }));
}
