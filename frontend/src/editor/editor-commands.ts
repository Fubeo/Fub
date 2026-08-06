// Comandi e scorciatoie in stile Obsidian: il Cantiere A del piano "Editor
// stile Obsidian" (docs/todo.md §6). Il modulo è autonomo — esporta una sola
// `Extension` che la shell monta in editor.ts, e non importa api.ts né lo
// stato dell'app. Tutta la logica è in `StateCommand` puri (stato →
// transazione): la view compare solo nell'auto-pair, e anche lì la *decisione*
// sta in una funzione pura (`autoPairDecision`), così i test girano in node
// senza mai istanziare una `EditorView`.
import {
  EditorSelection,
  EditorState,
  Prec,
  type ChangeSpec,
  type Extension,
  type Line,
  type StateCommand,
} from "@codemirror/state";
import { EditorView, keymap, type KeyBinding } from "@codemirror/view";
import { moveLineDown, moveLineUp } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { taskChecked } from "../rules/mirrored";
import { marcatoreSuccessivo, voceDiLista } from "../rules/sintassi";

// ── Formattazione inline ─────────────────────────────────────────────────────

/// Corsa di `*` contigui a ridosso di `pos`, verso sinistra o destra. Serve a
/// non scambiare il `**` del grassetto per un `*` di corsivo: `*x*`, `**x**` e
/// `***x***` si distinguono per la *parità* della corsa, non guardando un solo
/// carattere.
function starRun(state: EditorState, pos: number, dir: -1 | 1): number {
  let n = 0;
  for (;;) {
    const p = dir === -1 ? pos - n - 1 : pos + n;
    if (p < 0 || p >= state.doc.length) return n;
    if (state.sliceDoc(p, p + 1) !== "*") return n;
    n += 1;
  }
}

/// I marcatori stanno subito *fuori* da `[from,to)`? Per il corsivo il singolo
/// `*` conta solo se le corse ai due lati sono dispari: dentro `**…**` non c'è
/// un corsivo da togliere, c'è un grassetto da lasciare in pace.
function wrappedOutside(
  state: EditorState,
  from: number,
  to: number,
  open: string,
  close: string,
): boolean {
  if (from < open.length) return false;
  if (state.sliceDoc(from - open.length, from) !== open) return false;
  if (state.sliceDoc(to, to + close.length) !== close) return false;
  if (open !== "*") return true;
  return starRun(state, from, -1) % 2 === 1 && starRun(state, to, 1) % 2 === 1;
}

/// I marcatori stanno *dentro* la selezione (`‹**x**›`)? Stessa regola di
/// parità del caso "fuori" per il corsivo.
function wrappedInside(sel: string, open: string, close: string): boolean {
  if (sel.length < open.length + close.length) return false;
  if (!sel.startsWith(open) || !sel.endsWith(close)) return false;
  if (open !== "*") return true;
  let l = 0;
  while (l < sel.length && sel.charAt(l) === "*") l += 1;
  let r = 0;
  while (r < sel.length - l && sel.charAt(sel.length - 1 - r) === "*") r += 1;
  return l % 2 === 1 && r % 2 === 1;
}

/// Toggle di un marcatore inline sulla selezione — o sulla parola sotto il
/// cursore, o (senza parola) su una coppia vuota col cursore in mezzo. "Già
/// formattato" vale sia coi marcatori inclusi nella selezione sia con la
/// parola dentro i marcatori: nei due casi si tolgono, altrimenti si avvolge.
function toggleWrap(open: string, close: string = open): StateCommand {
  return ({ state, dispatch }) => {
    dispatch(
      state.update(
        state.changeByRange((range) => {
          let { from, to } = range;
          if (from === to) {
            const word = state.wordAt(range.head);
            if (!word) {
              return {
                changes: { from, insert: open + close },
                range: EditorSelection.cursor(from + open.length),
              };
            }
            ({ from, to } = word);
          }
          if (wrappedInside(state.sliceDoc(from, to), open, close)) {
            return {
              changes: [
                { from, to: from + open.length },
                { from: to - close.length, to },
              ],
              range: EditorSelection.range(from, to - open.length - close.length),
            };
          }
          if (wrappedOutside(state, from, to, open, close)) {
            return {
              changes: [
                { from: from - open.length, to: from },
                { from: to, to: to + close.length },
              ],
              range: EditorSelection.range(from - open.length, to - open.length),
            };
          }
          return {
            changes: [
              { from, insert: open },
              { from: to, insert: close },
            ],
            range: EditorSelection.range(from + open.length, to + open.length),
          };
        }),
        { scrollIntoView: true, userEvent: "input" },
      ),
    );
    return true;
  };
}

export const toggleBold = toggleWrap("**");
export const toggleItalic = toggleWrap("*");
export const toggleStrikethrough = toggleWrap("~~");
export const toggleInlineCode = toggleWrap("`");
export const toggleWikilink = toggleWrap("[[", "]]");

// ── Liste ────────────────────────────────────────────────────────────────────

// La lettura di una voce di lista **non sta più qui**: sta in
// `rules/sintassi.ts`, che è il posto unico in cui la shell riconosce sintassi
// (§4.4, decisione 0115). Stava scritta due volte — qui per i gesti, in
// `livepreview.ts` per la casella — e le due non erano d'accordo: su
// `> - [ ] x` la live preview disegnava una checkbox e questo file leggeva una
// citazione, quindi `Mod-Enter` non la spuntava; su `-  [ ] x` (due spazi) la
// live preview vedeva una todo e questo file un bullet.

/// `Enter` dentro una lista: continua la voce (il testo dopo il cursore scende
/// sulla riga nuova), rinumera le numerate a valle, e su una voce vuota toglie
/// il marcatore chiudendo la lista. Fuori dalle liste — o con una selezione,
/// o col cursore ancora dentro il marcatore — restituisce `false`: lì l'Enter
/// di default fa già la cosa giusta.
export const smartListEnter: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main;
  if (state.selection.ranges.length !== 1 || !range.empty) return false;
  const line = state.doc.lineAt(range.head);
  const item = voceDiLista(line.text);
  if (!item) return false;
  if (range.head < line.from + item.markerEnd) return false;

  if (item.content.trim() === "") {
    dispatch(
      state.update({
        changes: { from: line.from, to: line.to },
        selection: { anchor: line.from },
        scrollIntoView: true,
        userEvent: "delete",
      }),
    );
    return true;
  }

  const insert = `\n${marcatoreSuccessivo(item)}`;
  const changes: ChangeSpec[] = [{ from: range.head, insert }];
  if (item.kind === "ordered") {
    // Le voci a valle dello stesso livello scalano di uno. Le sottoliste (più
    // indentate) si scavalcano senza toccarle; qualsiasi altra cosa — riga
    // vuota, testo, un livello più esterno, un puntato — chiude la lista.
    let expected = item.number! + 2;
    for (let n = line.number + 1; n <= state.doc.lines; n++) {
      const l = state.doc.line(n);
      const it = voceDiLista(l.text);
      if (!it) break;
      if (it.indent.length > item.indent.length) continue;
      if (it.indent.length < item.indent.length || it.kind !== "ordered") break;
      if (it.number !== expected) {
        const numeroDa = l.from + it.quote.length + it.indent.length;
        changes.push({
          from: numeroDa,
          to: numeroDa + String(it.number).length,
          insert: String(expected),
        });
      }
      expected += 1;
    }
  }
  dispatch(
    state.update({
      changes,
      selection: { anchor: range.head + insert.length },
      scrollIntoView: true,
      userEvent: "input",
    }),
  );
  return true;
};

/// Le righe toccate dalla selezione, una volta sola ciascuna. Un capolinea
/// posato esattamente a inizio riga non "seleziona" quella riga: è la stessa
/// convenzione dei comandi di riga di CodeMirror.
function selectedLines(state: EditorState): Line[] {
  const lines: Line[] = [];
  let last = 0;
  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from).number;
    const toL = state.doc.lineAt(range.to);
    let toLine = toL.number;
    if (!range.empty && range.to === toL.from) toLine -= 1;
    for (let n = Math.max(fromLine, last + 1); n <= toLine; n++) {
      lines.push(state.doc.line(n));
      last = n;
    }
  }
  return lines;
}

/// `Tab` su voci di lista: un livello in più a ogni riga selezionata che sia
/// una voce. Fuori dalle liste → `false`, e il Tab cade sul binding di default
/// (l'`indentWithTab` già montato in editor.ts).
export const indentListItem: StateCommand = ({ state, dispatch }) => {
  const lines = selectedLines(state).filter((l) => voceDiLista(l.text) !== null);
  if (lines.length === 0) return false;
  const unit = state.facet(indentUnit);
  dispatch(
    state.update({
      changes: lines.map((l) => ({ from: l.from, insert: unit })),
      scrollIntoView: true,
      userEvent: "input.indent",
    }),
  );
  return true;
};

/// Quanto togliere dall'inizio riga per salire di un livello: l'unità
/// configurata se c'è, altrimenti un tab, altrimenti gli spazi che restano.
function dedentWidth(text: string, unit: string): number {
  if (text.startsWith(unit)) return unit.length;
  if (text.startsWith("\t")) return 1;
  let n = 0;
  while (n < unit.length && text.charAt(n) === " ") n += 1;
  return n;
}

/// `Shift-Tab`, speculare a `indentListItem`. Una voce già a filo del margine
/// resta com'è ma la battuta conta come gestita: de-indentare una lista non
/// deve mai degradare nel comando di indentazione generico.
export const dedentListItem: StateCommand = ({ state, dispatch }) => {
  const lines = selectedLines(state).filter((l) => voceDiLista(l.text) !== null);
  if (lines.length === 0) return false;
  const unit = state.facet(indentUnit);
  const changes: ChangeSpec[] = [];
  for (const l of lines) {
    const width = dedentWidth(l.text, unit);
    if (width > 0) changes.push({ from: l.from, to: l.from + width });
  }
  dispatch(state.update({ changes, scrollIntoView: true, userEvent: "delete.dedent" }));
  return true;
};

/// `Mod-Enter`: spunta/s-spunta le todo delle righe selezionate; una voce di
/// lista senza checkbox la guadagna, non spuntata. Righe che non sono voci
/// (citazioni comprese) non c'entrano: se non c'è nulla da fare → `false`.
export const toggleCheckbox: StateCommand = ({ state, dispatch }) => {
  const changes: ChangeSpec[] = [];
  for (const l of selectedLines(state)) {
    const item = voceDiLista(l.text);
    if (!item || item.kind === "quote") continue;
    if (item.symbol !== null) {
      // Il simbolo sta fra le parentesi, e `boxFrom` dice dove sono: leggerlo
      // contando all'indietro dal marcatore presupponeva che la casella fosse
      // sempre `[x] ` di quattro caratteri, che a fine riga è falso.
      const box = l.from + item.boxFrom;
      changes.push({ from: box + 1, to: box + 2, insert: taskChecked(item.symbol) ? " " : "x" });
    } else {
      changes.push({ from: l.from + item.markerEnd, insert: "[ ] " });
    }
  }
  if (changes.length === 0) return false;
  dispatch(state.update({ changes, scrollIntoView: true, userEvent: "input" }));
  return true;
};

/// `Mod-d`: duplica sotto la riga corrente (o il blocco di righe della
/// selezione). Il cursore scende sulla copia, così ripetere il comando
/// accumula copie invece di raddoppiare sempre l'originale.
export const duplicateLines: StateCommand = ({ state, dispatch }) => {
  dispatch(
    state.update(
      state.changeByRange((range) => {
        const first = state.doc.lineAt(range.from);
        const last = state.doc.lineAt(range.to);
        const copy = `\n${state.sliceDoc(first.from, last.to)}`;
        return {
          changes: { from: last.to, insert: copy },
          range: EditorSelection.range(range.anchor + copy.length, range.head + copy.length),
        };
      }),
      { scrollIntoView: true, userEvent: "input" },
    ),
  );
  return true;
};

/// `Mod-Shift-8/7`: le righe selezionate diventano elenco puntato/numerato.
/// Toggle: se lo sono già *tutte*, i marcatori si tolgono. La conversione da
/// un tipo all'altro sostituisce solo pallino/numero e conserva la checkbox
/// (una todo resta una todo); le righe vuote in mezzo si saltano.
function setListKind(kind: "bullet" | "ordered"): StateCommand {
  return ({ state, dispatch }) => {
    const lines = selectedLines(state).filter((l) => l.text.trim() !== "");
    if (lines.length === 0) return false;
    const items = lines.map((l) => voceDiLista(l.text));
    const allSame = items.every((it) => it !== null && it.kind === kind);
    const changes: ChangeSpec[] = [];
    let n = 1;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const it = items[i];
      if (allSame) {
        changes.push({ from: l.from + it!.quote.length + it!.indent.length, to: l.from + it!.markerEnd });
        continue;
      }
      const marker = kind === "bullet" ? "- " : `${n}. `;
      n += 1;
      if (it) {
        // La checkbox sopravvive: si sostituisce fino a **dove comincia la
        // casella**, che è un fatto letto, non i quattro caratteri che si
        // presumeva avesse sempre.
        const end = it.symbol !== null ? l.from + it.boxFrom : l.from + it.markerEnd;
        changes.push({ from: l.from + it.quote.length + it.indent.length, to: end, insert: marker });
      } else {
        const indentLen = /^\s*/.exec(l.text)![0].length;
        changes.push({ from: l.from + indentLen, insert: marker });
      }
    }
    dispatch(state.update({ changes, scrollIntoView: true, userEvent: "input" }));
    return true;
  };
}

export const toggleBulletList = setListKind("bullet");
export const toggleOrderedList = setListKind("ordered");

// ── Auto-pair dei marcatori Obsidian ─────────────────────────────────────────

/// Cosa fare al posto della battuta: `insert` la sostituisce (col cursore a
/// `cursor` code unit dall'inizio dell'inserito), `skip` scavalca il carattere
/// già presente senza scrivere nulla, `null` lascia l'inserimento normale.
export type PairDecision =
  | { action: "insert"; text: string; cursor: number }
  | { action: "skip" };

/// La decisione dell'auto-pair, separata dalla view così si testa a secco.
/// Copre `[[`→`]]`, `==` ed `$`; il singolo `*` non si auto-chiude apposta —
/// nel testo normale lo si digita di continuo, e una chiusura automatica
/// sarebbe più danno che aiuto.
export function autoPairDecision(
  state: EditorState,
  from: number,
  to: number,
  typed: string,
): PairDecision | null {
  // Solo battute singole a selezione vuota: incolla e IME non si toccano.
  if (from !== to || typed.length !== 1) return null;
  const next = (n: number) => state.sliceDoc(from, from + n);
  const prev = (n: number) => state.sliceDoc(Math.max(0, from - n), from);
  switch (typed) {
    case "[":
      // `[[` → chiudi subito con `]]`, se una chiusura non è già lì davanti.
      if (prev(1) === "[" && next(2) !== "]]") return { action: "insert", text: "[]]", cursor: 1 };
      return null;
    case "]":
      // Davanti a una `]` già presente si scavalca invece di raddoppiare.
      return next(1) === "]" ? { action: "skip" } : null;
    case "=":
      if (next(1) === "=" && (prev(1) === "=" || next(2) === "==")) return { action: "skip" };
      // `==` → chiudi con `==`, ma senza allungare corse di `=` già più lunghe.
      if (prev(1) === "=" && prev(2) !== "==" && next(1) !== "=") {
        return { action: "insert", text: "===", cursor: 1 };
      }
      return null;
    case "$":
      // `$|$` + `$` → si sale al math a blocco: `$$|$$`.
      if (prev(1) === "$" && next(1) === "$" && prev(2) !== "$$") {
        return { action: "insert", text: "$$", cursor: 1 };
      }
      if (next(1) === "$") return { action: "skip" };
      if (prev(1) === "$") return null;
      return { action: "insert", text: "$$", cursor: 1 };
  }
  return null;
}

// L'unico punto del modulo che tocca la view: applica la decisione presa
// sopra. `from + text.length` per lo skip = subito oltre il carattere gemello
// già presente (le battute qui sono sempre singole).
const autoPair = EditorView.inputHandler.of((view, from, to, text) => {
  const decision = autoPairDecision(view.state, from, to, text);
  if (decision === null) return false;
  view.dispatch(
    decision.action === "skip"
      ? { selection: { anchor: from + text.length }, scrollIntoView: true, userEvent: "input.type" }
      : {
          changes: { from, to, insert: decision.text },
          selection: { anchor: from + decision.cursor },
          scrollIntoView: true,
          userEvent: "input.type",
        },
  );
  return true;
});

// ── Il pacchetto ─────────────────────────────────────────────────────────────

const obsidianKeymap: KeyBinding[] = [
  { key: "Mod-b", run: toggleBold },
  { key: "Mod-i", run: toggleItalic },
  { key: "Mod-Shift-x", run: toggleStrikethrough },
  { key: "Mod-`", run: toggleInlineCode },
  { key: "Mod-k", run: toggleWikilink },
  { key: "Enter", run: smartListEnter },
  { key: "Mod-Enter", run: toggleCheckbox },
  { key: "Tab", run: indentListItem },
  { key: "Shift-Tab", run: dedentListItem },
  { key: "Mod-d", run: duplicateLines },
  { key: "Alt-ArrowUp", run: moveLineUp },
  { key: "Alt-ArrowDown", run: moveLineDown },
  { key: "Mod-Shift-8", run: toggleBulletList },
  { key: "Mod-Shift-7", run: toggleOrderedList },
];

/// Le estensioni del Cantiere A, pronte da montare in editor.ts. La keymap
/// sta in `Prec.high` così vince sui binding di `basicSetup` a prescindere
/// dall'ordine di montaggio; ogni comando che non riconosce il proprio
/// contesto restituisce `false` e lascia cadere la battuta sul default.
export function editingExtensions(): Extension {
  return [Prec.high(keymap.of(obsidianKeymap)), autoPair];
}
