// I gesti di formato in riga, come in Word: grassetto, corsivo, barrato,
// sottolineato, apice, pedice ed evidenziato. Ognuno guarda dove sta il
// cursore, o che cosa è scelto, e scrive soltanto segni che si rileggono
// come voluti, perché in Live non si vedono e un segno rimasto letterale
// sarebbe un simbolo a caso nel testo.
//
// - In mezzo a una parola la formatta tutta e il cursore resta dov'è; al
//   bordo di una parola, o fuori, apre una coppia vuota per ciò che si scrive.
// - Dentro l'elemento lo toglie; alla fine o all'inizio del suo testo ne esce,
//   così ciò che si scrive dopo è di nuovo normale.
// - Apice e pedice si escludono: uno sull'altro lo cambia, e alla fine del
//   testo dell'uno apre l'altro subito dopo (`x^2^~|~`).
// - Il testo di un apice o di un pedice è letterale (`^**x**^` mostra gli
//   asterischi): un altro formato lo avvolge da fuori.
// - Una selezione che contiene già pezzi dello stesso formato diventa tutta
//   di quel formato, come in Word.
// - I segni che non reggono (`^a b^`, `~~~x~~~`) lasciano il posto al tag
//   HTML gemello (`<sup>a b</sup>`), che la Live e la Lettura mostrano uguale.
import {
  ChangeSet, EditorSelection, EditorState, type Extension, type SelectionRange, type StateCommand, Text, Transaction,
} from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { Tree } from "@lezer/common";
import { markdownGrammar } from "./grammar";
import { nativeCuts, nativeInlines } from "./render-inline";
import { textSpans } from "../../../../rules/syntax";
import { type CursorElement, elementMarksAt, HTML_TWIN, type ElementMarks } from "./cursor-elements";
import { emptyPairsOf, heldPairAt, openedPair, type EmptyPair } from "./empty-pair";

export type FormatElement = "strong" | "em" | "strike" | "underline" | "sup" | "sub" | "highlight";

interface Form {
  readonly open: string;
  readonly close: string;
}

const SIGNS: Record<FormatElement, Form> = {
  strong: { open: "**", close: "**" },
  em: { open: "*", close: "*" },
  strike: { open: "~~", close: "~~" },
  underline: { open: "<u>", close: "</u>" },
  sup: { open: "^", close: "^" },
  sub: { open: "~", close: "~" },
  highlight: { open: "==", close: "==" },
};
const NODE: Partial<Record<FormatElement, string>> = {
  strong: "StrongEmphasis", em: "Emphasis", strike: "Strikethrough", sup: "Superscript", sub: "Subscript",
};
/// Apice e pedice: l'uno esclude l'altro, e il loro testo non porta segni.
const OTHER_LEAF: Partial<Record<FormatElement, FormatElement>> = { sup: "sub", sub: "sup" };
const SIGN_CHARS = new Set(["*", "_", "~", "^"]);
/// I caratteri dei segni che un gesto scrive, `=` dell'evidenziato compreso.
const WRITTEN_CHARS = new Set([...SIGN_CHARS, "="]);

function twin(element: FormatElement): Form | null {
  const tag = HTML_TWIN[element];
  return tag ? { open: `<${tag}>`, close: `</${tag}>` } : null;
}

/// Una modifica; `side` mette in fila due inserimenti nello stesso punto: la
/// chiusura di ciò che finisce prima dell'apertura di ciò che comincia.
interface Edit {
  readonly from: number;
  readonly to?: number;
  readonly insert?: string;
  readonly side?: 0 | 1;
}

function order(edits: readonly Edit[]): Edit[] {
  return edits
    .map((edit, index) => ({ edit, index }))
    .sort((a, b) => a.edit.from - b.edit.from || (a.edit.side ?? 0) - (b.edit.side ?? 0) || a.index - b.index)
    .map(({ edit }) => edit);
}

const specs = (edits: readonly Edit[], shift = 0) =>
  order(edits).map((edit) => ({ from: edit.from - shift, to: (edit.to ?? edit.from) - shift, insert: edit.insert ?? "" }));

// ── La prova che i segni reggono ─────────────────────────────────────────────

/// I segni veri del testo, letto da solo: le posizioni di `*_~^` che l'albero
/// legge come segno. Il rientro resta fuori, che non diventi codice.
export function readSigns(text: string): { signs: Set<number>; tree: Tree; indent: number; elements: Map<string, Read> } {
  const indent = /^[ \t]*/.exec(text)![0].length;
  const tree = markdownGrammar.parser.parse(text.slice(indent));
  const signs = new Set<number>();
  const elements = new Map<string, Read>();
  tree.iterate({
    enter: (node) => {
      const element = ELEMENT_OF[node.name];
      if (element) {
        const marks = node.node.getChildren(node.node.firstChild?.name ?? "");
        if (marks.length >= 2) {
          const read = {
            element,
            marks: { from: marks[0]!.from + indent, openTo: marks[0]!.to + indent, closeFrom: marks[marks.length - 1]!.from + indent, to: marks[marks.length - 1]!.to + indent },
          };
          elements.set(keyOf(read.marks), read);
        }
      }
      if (!node.name.endsWith("Mark")) return;
      for (let at = node.from + indent; at < node.to + indent; at++) if (SIGN_CHARS.has(text[at]!)) signs.add(at);
    },
  });
  // L'evidenziato non è nell'albero: i suoi `==` sono quelli che la Live
  // trova con la regola del provider (`textSpans`), soltanto nel testo del
  // modello: non contiene e non attraversa un altro elemento in riga
  // (`==**x**==` resta a vista, `**==x==**` no).
  const natives = nativeInlines(tree.topNode, 0, text.length - indent, (link) => ({ from: link.from, to: link.to }), []);
  const cuts = nativeCuts(natives).map((cut) => ({ from: cut.from + indent, to: cut.to + indent }));
  for (const span of textSpans(text, cuts)) {
    if (!span.name.endsWith(":highlight")) continue;
    for (const at of [span.from, span.from + 1, span.to - 2, span.to - 1]) signs.add(at);
    const marks = { from: span.from, openTo: span.contentFrom, closeFrom: span.contentTo, to: span.to };
    elements.set(keyOf(marks), { element: "highlight", marks });
  }
  return { signs, tree, indent, elements };
}

/// Un elemento letto da `readSigns`, coi segni nel testo letto.
interface Read {
  readonly element: FormatElement;
  readonly marks: ElementMarks;
}

const ELEMENT_OF: Record<string, FormatElement> = {
  Emphasis: "em", StrongEmphasis: "strong", Strikethrough: "strike", Superscript: "sup", Subscript: "sub",
};
const keyOf = (marks: ElementMarks): string => `${marks.from}:${marks.openTo}:${marks.closeFrom}:${marks.to}`;

/// Gli elementi di `before` che `local` non tocca nei segni e che in `after`
/// non si leggono più com'erano.
function lostElements(before: string, after: string, local: ChangeSet): Read[] {
  const deleted = new Set<number>();
  local.iterChanges((fromA, toA) => {
    for (let at = fromA; at < toA; at++) deleted.add(at);
  });
  const now = readSigns(after).elements;
  const out: Read[] = [];
  for (const read of readSigns(before).elements.values()) {
    const { from, openTo, closeFrom, to } = read.marks;
    if ([from, openTo - 1, closeFrom, to - 1].some((at) => deleted.has(at))) continue;
    const mapped = {
      from: local.mapPos(from, 1),
      openTo: local.mapPos(openTo - 1, 1) + 1,
      closeFrom: local.mapPos(closeFrom, 1),
      to: local.mapPos(to - 1, 1) + 1,
    };
    if (now.get(keyOf(mapped))?.element === read.element) continue;
    // I segni si possono raggruppare in un altro modo (`*a*` dentro un
    // grassetto nuovo fa `***a***`): l'elemento resta se un altro dello
    // stesso tipo ha lo stesso testo, più soltanto segni.
    const same = [...now.values()].some((other) => other.element === read.element
      && other.marks.openTo <= mapped.openTo && mapped.closeFrom <= other.marks.closeFrom
      && onlySigns(after.slice(other.marks.openTo, mapped.openTo) + after.slice(mapped.closeFrom, other.marks.closeFrom)));
    if (!same) out.push(read);
  }
  return out;
}

const onlySigns = (text: string): boolean => [...text].every((char) => SIGN_CHARS.has(char));

/// Le modifiche reggono: rilette le righe toccate, ogni segno scritto è un
/// segno vero, i segni che lo erano lo restano, e attorno a ogni testo di
/// `contents` (posizioni del documento nuovo) c'è un nodo `node` fatto solo
/// dei suoi segni.
function sound(
  state: EditorState,
  edits: readonly Edit[],
  node: string,
  contents: (changes: ChangeSet) => readonly { from: number; to: number }[],
): boolean {
  const start = state.doc.lineAt(Math.min(...edits.map((edit) => edit.from))).from;
  const end = state.doc.lineAt(Math.max(...edits.map((edit) => edit.to ?? edit.from))).to;
  const before = state.sliceDoc(start, end);
  const local = ChangeSet.of(specs(edits, start), before.length);
  const after = local.apply(Text.of(before.split("\n"))).toString();
  const old = readSigns(before);
  const now = readSigns(after);
  const deleted = new Set<number>();
  local.iterChanges((fromA, toA) => {
    for (let at = fromA; at < toA; at++) deleted.add(at);
  });
  for (const at of old.signs) if (!deleted.has(at) && !now.signs.has(local.mapPos(at, 1))) return false;
  // E i tag restano tag: nel testo letterale di un apice `<u>` si vedrebbe.
  const tags = (read: { tree: Tree; indent: number }) => {
    const out = new Set<number>();
    read.tree.iterate({ enter: (node) => { if (node.name === "HTMLTag") out.add(node.from + read.indent); } });
    return out;
  };
  const nowTags = tags(now);
  for (const at of tags(old)) if (!deleted.has(at) && !nowTags.has(local.mapPos(at, 1))) return false;
  // I segni di una coppia vuota in attesa non si leggono ancora, ma con la
  // lettera di prova dentro devono leggersi: `alfa~~**x**~~` spegnerebbe il
  // barrato che aspetta.
  for (const pair of emptyPairsOf(state)) {
    const end = pair.from + pair.open + pair.close;
    if (!edits.some((edit) => edit.insert && pair.from < edit.from && edit.from < end)) continue;
    for (let at = pair.from; at < end; at++) {
      const inLine = at - start;
      if (inLine < 0 || inLine >= before.length || deleted.has(inLine) || !WRITTEN_CHARS.has(before[inLine]!)) continue;
      if (!now.signs.has(local.mapPos(inLine, 1))) return false;
    }
  }
  let written = true;
  local.iterChanges((_fromA, _toA, fromB, toB) => {
    for (let at = fromB; at < toB; at++) if (WRITTEN_CHARS.has(after[at]!) && !now.signs.has(at)) written = false;
  });
  if (!written) return false;
  if (!node) return true;
  return contents(state.changes(specs(edits))).every(({ from, to }) => {
    const textFrom = from - start;
    const textTo = to - start;
    let held = false;
    now.tree.iterate({
      from: textFrom - now.indent,
      to: textTo - now.indent,
      enter: (found) => {
        const nodeFrom = found.from + now.indent;
        const nodeTo = found.to + now.indent;
        if (found.name === node && nodeFrom <= textFrom && textTo <= nodeTo
          && onlySigns(after.slice(nodeFrom, textFrom)) && onlySigns(after.slice(textTo, nodeTo))) held = true;
      },
    });
    return held;
  });
}

/// Una modifica può spegnere i segni che tocca senza toglierli: dopo
/// `*b</del>*` la `a` fa di `*a` un'apertura mancata, e `al*<sub>fa</sub>*`
/// non è più corsivo. Gli elementi coi segni spenti passano al tag gemello,
/// che regge qualunque vicino: i loro tag, nelle posizioni di prima, vuoti
/// se ogni segno rimasto regge ancora. Vanno messi dopo `changes`.
export function brokenTwins(state: EditorState, changes: ChangeSet): Edit[] {
  const lines = new Set<number>();
  let multiline = false;
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (inserted.lines > 1) multiline = true;
    for (let line = state.doc.lineAt(fromA).number; line <= state.doc.lineAt(toA).number; line++) lines.add(line);
  });
  if (multiline) return [];
  const after = changes.apply(state.doc);
  const tags: Edit[] = [];
  for (const number of lines) {
    const line = state.doc.line(number);
    const start = changes.mapPos(line.from, -1);
    const text = after.sliceString(start, changes.mapPos(line.to, 1));
    // Le modifiche della riga, nelle posizioni della riga.
    const specsOf: { from: number; to: number; insert: string }[] = [];
    changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      if (fromA >= line.from && toA <= line.to) specsOf.push({ from: fromA - line.from, to: toA - line.from, insert: inserted.toString() });
    });
    const local = ChangeSet.of(specsOf, line.length);
    if (local.apply(Text.of([line.text])).toString() !== text) continue;
    for (const { element, marks } of lostElements(line.text, text, local)) {
      const tag = HTML_TWIN[element];
      if (!tag) continue;
      tags.push(
        { from: line.from + marks.from, to: line.from + marks.openTo, insert: `<${tag}>`, side: 1 },
        { from: line.from + marks.closeFrom, to: line.from + marks.to, insert: `</${tag}>`, side: 1 },
      );
    }
  }
  return tags;
}

/// Le modifiche non cambiano i blocchi delle righe che toccano: `~~~~` a
/// inizio riga apre un blocco di codice, `====` sotto una riga ne fa un
/// titolo.
function blocksHold(state: EditorState, edits: readonly Edit[]): boolean {
  const start = state.doc.lineAt(Math.min(...edits.map((edit) => edit.from)));
  const from = start.number > 1 ? state.doc.line(start.number - 1).from : start.from;
  const end = state.doc.lineAt(Math.max(...edits.map((edit) => edit.to ?? edit.from))).to;
  const before = state.sliceDoc(from, end);
  const after = ChangeSet.of(specs(edits, from), before.length).apply(Text.of(before.split("\n"))).toString();
  const shape = (text: string) => {
    const names: string[] = [];
    for (let node = markdownGrammar.parser.parse(text).topNode.firstChild; node; node = node.nextSibling) names.push(node.name);
    return names.join(" ");
  };
  return shape(before) === shape(after);
}

/// I tag dei vicini spenti dalle modifiche, vuote (`edits`) o con la lettera
/// di prova dentro (`probe`): devono reggere in tutte e due.
function bothTwins(state: EditorState, edits: readonly Edit[], probe: readonly Edit[]): Edit[] {
  const out = brokenTwins(state, state.changes(specs(probe)));
  for (const tag of brokenTwins(state, state.changes(specs(edits)))) if (!out.some((seen) => seen.from === tag.from)) out.push(tag);
  return out;
}

/// I tag degli strati di una coppia vuota in attesa che `probe`, con la sua
/// lettera di prova, spegne: `alfa~~<strong>x</strong>~~` non è barrato, e
/// il barrato che aspetta passa a `<del>`.
function heldTwins(state: EditorState, probe: readonly Edit[]): Edit[] {
  const pairs = emptyPairsOf(state);
  if (!pairs.length) return [];
  const start = state.doc.lineAt(Math.min(...probe.map((edit) => edit.from))).from;
  const end = state.doc.lineAt(Math.max(...probe.map((edit) => edit.to ?? edit.from))).to;
  const before = state.sliceDoc(start, end);
  const local = ChangeSet.of(specs(probe, start), before.length);
  const now = readSigns(local.apply(Text.of(before.split("\n"))).toString()).elements;
  // Lo strato si legge come sé stesso, non coi segni di un altro
  // (`*<sub>x</sub>*alfa … *`).
  const reads = (element: FormatElement, marks: ElementMarks) => now.get(keyOf({
    from: local.mapPos(marks.from - start, 1),
    openTo: local.mapPos(marks.openTo - start, -1),
    closeFrom: local.mapPos(marks.closeFrom - start, 1),
    to: local.mapPos(marks.to - start, -1),
  }))?.element === element;
  const out: Edit[] = [];
  for (const pair of pairs) {
    if (pair.from < start || pair.from + pair.open + pair.close > end) continue;
    // Una coppia che `probe` toglie o cambia non aspetta più.
    if (probe.some((edit) => edit.to !== undefined && edit.from < pair.from + pair.open + pair.close && pair.from < edit.to)) continue;
    for (const { element, marks } of layersOf(state, pair) ?? []) {
      const tag = HTML_TWIN[element];
      if (!tag || !WRITTEN_CHARS.has(state.sliceDoc(marks.from, marks.from + 1))) continue;
      if (reads(element, marks)) continue;
      out.push({ from: marks.from, to: marks.openTo, insert: `<${tag}>`, side: 1 }, { from: marks.closeFrom, to: marks.to, insert: `</${tag}>`, side: 1 });
    }
  }
  return out;
}

/// I tag dei segni rotti e degli strati in attesa, ognuno una volta sola.
function twinsOf(state: EditorState, edits: readonly Edit[], probe: readonly Edit[]): Edit[] {
  const out = bothTwins(state, edits, probe);
  for (const tag of heldTwins(state, probe)) if (!out.some((seen) => seen.from === tag.from)) out.push(tag);
  return out;
}

/// Avvolge ogni tratto coi segni `signs` di `element`, o col tag gemello se i
/// segni non reggono. Un tratto vuoto è una coppia vuota, provata con una
/// lettera dentro. `extra` va insieme: i segni tolti, di solito.
function wrapping(
  state: EditorState,
  element: FormatElement,
  spans: readonly { from: number; to: number }[],
  extra: readonly Edit[] = [],
  signs: Form = SIGNS[element],
  /// Dove va la lettera di prova quando il tratto è una coppia vuota di un
  /// altro elemento (`^|^`), che da vuota non si legge.
  probeAt?: number,
): { edits: Edit[]; form: Form } {
  const build = (form: Form, probe = false): Edit[] => [
    ...extra,
    ...(probe && probeAt !== undefined ? [{ from: probeAt, insert: "x" }] : []),
    ...spans.flatMap((span): Edit[] => span.from === span.to
      ? [{ from: span.from, insert: `${form.open}${probe ? "x" : ""}${form.close}`, side: 1 }]
      : [{ from: span.from, insert: form.open, side: 1 }, { from: span.to, insert: form.close, side: 0 }]),
  ];
  const html = twin(element);
  const node = NODE[element];
  // Senza un nodo da provare (il sottolineato, l'evidenziato, i tag) basta
  // che i segni accanto reggano.
  if (!html || signs.open === html.open || !blocksHold(state, build(signs))) {
    if (html && signs.open !== html.open) signs = html;
    const probe = build(signs, true);
    return { edits: [...build(signs), ...twinsOf(state, build(signs), probe)], form: signs };
  }
  // `~` e `^` contro altri uguali fanno corse che si leggono in più modi
  // (`~~2~|~~~`): meglio il tag.
  // Il testo di un apice o di un pedice coi segni è letterale: ciò che vi
  // sta di formato (`^~~|~~^`, una coppia in attesa) vuole il tag.
  // I vicini si guardano dopo `extra`: tolta una coppia (`~|~^ax^` → `^|^`),
  // accanto viene ciò che le stava dopo.
  const pre = state.changes(specs(extra));
  const doc = pre.apply(state.doc);
  const crowded = (/[~^=]/.test(signs.open[0]!) && spans.some((span) => {
    const from = pre.mapPos(span.from, -1);
    const to = pre.mapPos(span.to, 1);
    return doc.sliceString(Math.max(0, from - 1), from) === signs.open[0] || doc.sliceString(to, to + 1) === signs.close[signs.close.length - 1];
  }))
    || (element in OTHER_LEAF && spans.some((span) => /[*_~^=<>`[\]$]/.test(state.sliceDoc(span.from, span.to))));
  const fits = !crowded && sound(state, build(signs, true), node ?? "", (changes) => spans.map((span) => {
    if (span.from !== span.to) return { from: changes.mapPos(span.from, 1), to: changes.mapPos(span.to, -1) };
    const at = changes.mapPos(span.from, -1) + signs.open.length;
    return { from: at, to: at + 1 };
  }));
  // Anche vuota, la coppia non spegne i vicini: `alfaa**|*****m` farebbe
  // tornare a vista gli asterischi di dopo finché non si scrive.
  const empty = spans.some((span) => span.from === span.to);
  if (fits && (!empty || !brokenTwins(state, state.changes(specs(build(signs)))).length)) return { edits: build(signs), form: signs };
  // Anche il tag può spegnere i segni accanto (`*2a<del></del>*b`): passano
  // al loro tag anche loro.
  const probe = build(html, true);
  return { edits: [...build(html), ...twinsOf(state, build(html), probe)], form: html };
}

// ── Dove sta il cursore ──────────────────────────────────────────────────────

interface Outcome {
  readonly changes: readonly Edit[];
  readonly range: SelectionRange;
  readonly pair?: EmptyPair;
}

function run(state: EditorState, pos: number, dir: -1 | 1, char: string): number {
  let n = 0;
  for (;;) {
    const at = dir === -1 ? pos - n - 1 : pos + n;
    if (at < 0 || at >= state.doc.length || state.sliceDoc(at, at + 1) !== char) return n;
    n += 1;
  }
}

/// La coppia vuota di `element` attorno a `pos`, coi segni o coi tag. Per i
/// segni conta la corsa intera: `**|**` non è una coppia di corsivo, `~~|~~`
/// non lo è di pedice.
function emptyPairAt(state: EditorState, pos: number, element: FormatElement): { from: number; to: number } | null {
  // La coppia aperta da un gesto si sa che cos'è, anche quando la corsa dei
  // segni attorno non lo dice (`~x~~|~`).
  for (const held of emptyPairsOf(state)) {
    if (held.from + held.open !== pos) continue;
    const inner = layersOf(state, held)?.slice(-1)[0];
    if (inner) return inner.element === element ? { from: inner.marks.from, to: inner.marks.to } : null;
  }
  const signs = SIGNS[element];
  const forms = [signs, twin(element)].filter((form): form is Form => form !== null);
  for (const form of forms) {
    if (state.sliceDoc(pos - form.open.length, pos) !== form.open) continue;
    if (state.sliceDoc(pos, pos + form.close.length) !== form.close) continue;
    const char = form.open[0]!;
    if (form === signs && SIGN_CHARS.has(char)) {
      const left = run(state, pos, -1, char);
      const right = run(state, pos, 1, char);
      const fits = element === "em" ? left % 2 === 1 && right % 2 === 1
        : element === "strong" ? left >= 2 && right >= 2
        : left === form.open.length && right === form.close.length;
      if (!fits) continue;
    }
    return { from: pos - form.open.length, to: pos + form.close.length };
  }
  return null;
}

/// L'apice o il pedice coi segni (non coi tag) che contiene `range`.
function leafAt(state: EditorState, range: { from: number; to: number; empty: boolean }): ElementMarks | null {
  for (const leaf of ["sup", "sub"] as const) {
    const marks = elementMarksAt(state, range, leaf);
    if (marks && state.sliceDoc(marks.from, marks.openTo) === SIGNS[leaf].open) return marks;
  }
  return null;
}

/// Gli elementi `element` che toccano `[from, to)`: quelli dell'albero e
/// quelli coi tag gemelli.
export function elementsTouching(state: EditorState, from: number, to: number, element: FormatElement): ElementMarks[] {
  const found: ElementMarks[] = [];
  const node = NODE[element];
  if (node) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (ref) => {
        if (ref.name !== node || ref.to <= from || ref.from >= to) return;
        const marks = ref.node.getChildren(ref.node.firstChild?.name ?? "");
        if (marks.length < 2) return;
        found.push({ from: marks[0]!.from, openTo: marks[0]!.to, closeFrom: marks[marks.length - 1]!.from, to: marks[marks.length - 1]!.to });
      },
    });
  }
  if (element === "highlight") {
    for (let line = state.doc.lineAt(from); ; line = state.doc.line(line.number + 1)) {
      // Gli stessi che legge la Live, con la regola del provider.
      for (const read of readSigns(line.text).elements.values()) {
        if (read.element !== "highlight") continue;
        const marks = read.marks;
        if (line.from + marks.to > from && line.from + marks.from < to) {
          found.push({ from: line.from + marks.from, openTo: line.from + marks.openTo, closeFrom: line.from + marks.closeFrom, to: line.from + marks.to });
        }
      }
      if (line.to >= to || line.number === state.doc.lines) break;
    }
  }
  const form = element === "underline" ? SIGNS[element] : twin(element);
  if (form) {
    for (let line = state.doc.lineAt(from); ; line = state.doc.line(line.number + 1)) {
      // I tag uguali si annidano (`<sub><sub></sub>a</sub>`): ogni chiusura
      // va con l'ultima apertura ancora libera.
      const opened: number[] = [];
      for (let at = 0; at < line.text.length;) {
        if (line.text.startsWith(form.open, at)) {
          opened.push(at);
          at += form.open.length;
        } else if (line.text.startsWith(form.close, at)) {
          const open = opened.pop();
          if (open !== undefined) {
            const start = line.from + open;
            const stop = line.from + at + form.close.length;
            if (stop > from && start < to) found.push({ from: start, openTo: start + form.open.length, closeFrom: line.from + at, to: stop });
          }
          at += form.close.length;
        } else at++;
      }
      if (line.to >= to || line.number === state.doc.lines) break;
    }
  }
  return found;
}

/// Toglie i segni di `marks`.
const unmark = (marks: ElementMarks): Edit[] => [
  { from: marks.from, to: marks.openTo },
  { from: marks.closeFrom, to: marks.to },
];

/// Apre una coppia vuota di `element` in `at`, col cursore dentro.
function openPair(state: EditorState, at: number, element: FormatElement, extra: readonly Edit[] = []): Outcome {
  const { edits, form } = wrapping(state, element, [{ from: at, to: at }], extra);
  const changes = state.changes(specs(edits));
  const start = changes.mapPos(at, -1);
  const cursor = start + form.open.length;
  // Dentro un'altra coppia in attesa (`~~|~~`) le due diventano una, anche
  // quando i suoi segni sono passati ai tag.
  const outer = emptyPairsOf(state).find((pair) => pair.from < at && at < pair.from + pair.open + pair.close);
  if (outer) {
    const from = changes.mapPos(outer.from, -1);
    const to = changes.mapPos(outer.from + outer.open + outer.close, 1);
    return {
      changes: edits,
      range: EditorSelection.cursor(cursor),
      pair: { from, open: cursor - from, close: to - cursor, elements: [...(outer.elements ?? []), element] },
    };
  }
  return {
    changes: edits,
    range: EditorSelection.cursor(cursor),
    pair: { from: start, open: form.open.length, close: form.close.length, elements: [element] },
  };
}

/// Avvolge `[from, to)` con `element`: gli elementi uguali che tocca entrano
/// nel tratto e perdono i loro segni. `place` dice dove va la selezione.
function wrapSpan(
  state: EditorState,
  from: number,
  to: number,
  element: FormatElement,
  place: (changes: ChangeSet) => SelectionRange,
  probeAt?: number,
): Outcome {
  const inner = elementsTouching(state, from, to, element);
  for (const marks of inner) {
    from = Math.min(from, marks.from);
    to = Math.max(to, marks.to);
  }
  const { spans, swapped } = pieces(state, from, to, element);
  if (!spans.length) return { changes: [], range: place(state.changes([])) };
  const { edits } = wrapping(state, element, spans, [...inner, ...swapped].flatMap(unmark), SIGNS[element], probeAt);
  return { changes: edits, range: place(state.changes(specs(edits))) };
}

const ELEMENTS: readonly FormatElement[] = ["strong", "em", "strike", "underline", "sup", "sub", "highlight"];

/// I pezzi di `[from, to)` da avvolgere: tutto, se non taglia nessun altro
/// elemento; se no i tratti di testo fra i segni di chi taglia, come le
/// corse di Word. `*2~b~` scelto con l'apertura del corsivo e non la sua
/// chiusura dà `*~2b~*`, e non un pedice che scavalca il corsivo.
function pieces(
  state: EditorState,
  from: number,
  to: number,
  element: FormatElement,
): { spans: { from: number; to: number }[]; swapped: ElementMarks[] } {
  const cuts = new Set<number>();
  for (const kind of ELEMENTS) {
    if (kind === element) continue;
    for (const marks of elementsTouching(state, from, to, kind)) {
      const inside = from <= marks.from && marks.to <= to;
      const around = marks.openTo <= from && to <= marks.closeFrom;
      if (inside || around) continue;
      for (let at = marks.from; at < marks.openTo; at++) cuts.add(at);
      for (let at = marks.closeFrom; at < marks.to; at++) cuts.add(at);
    }
  }
  if (!cuts.size) return { spans: [{ from, to }], swapped: [] };
  const out: { from: number; to: number }[] = [];
  const swapped: ElementMarks[] = [];
  const other = OTHER_LEAF[element];
  for (let at = from; at < to;) {
    if (cuts.has(at)) { at++; continue; }
    let end = at;
    while (end < to && !cuts.has(end)) end++;
    const text = state.sliceDoc(at, end);
    const lead = text.length - text.trimStart().length;
    if (lead < text.length) {
      const span = { from: at + lead, to: end - (text.length - text.trimEnd().length) };
      // Il testo di un apice o di un pedice è letterale: lo si avvolge tutto.
      const leaf = other ? null : leafAt(state, { ...span, empty: false });
      // Nel pedice un apice prende il pedice tutto, e ne toglie i segni.
      const swap = other ? elementMarksAt(state, { ...span, empty: false }, other) : null;
      if (swap && !swapped.some((seen) => seen.from === swap.from)) swapped.push(swap);
      const whole = leaf ? { from: leaf.from, to: leaf.to } : swap ? { from: swap.openTo, to: swap.closeFrom } : span;
      const last = out[out.length - 1];
      if ((leaf || swap) && last && last.to >= whole.from) out[out.length - 1] = { from: last.from, to: Math.max(last.to, whole.to) };
      else out.push(whole);
    }
    at = end;
  }
  return { spans: out, swapped };
}

/// Toglie `was` da `[from, to)`, che ci sta dentro, e ci mette `becomes`: i
/// pezzi di `was` fuori dal tratto restano com'erano scritti.
function reform(
  state: EditorState,
  marks: ElementMarks,
  from: number,
  to: number,
  was: FormatElement,
  becomes: FormatElement | null,
  place: (changes: ChangeSet, from: number, to: number) => SelectionRange,
): Outcome {
  let start = Math.max(from, marks.openTo);
  let end = Math.min(to, marks.closeFrom);
  // I pezzi che restano non tagliano gli elementi dentro: `<u>==^a^==</u>`
  // senza sottolineato sulla `a` lo perde su tutto l'evidenziato.
  for (let grown = true; grown;) {
    grown = false;
    for (const kind of ELEMENTS) {
      for (const inner of elementsTouching(state, Math.max(marks.openTo, start - 1), Math.min(marks.closeFrom, end + 1), kind)) {
        if (inner.from < marks.openTo || inner.to > marks.closeFrom || (start <= inner.from && inner.to <= end)) continue;
        if (!(inner.from < end && start < inner.to) && !(start === end && inner.from < start && start < inner.to)) continue;
        start = Math.min(start, inner.from);
        end = Math.max(end, inner.to);
        grown = true;
      }
    }
  }
  const written = { open: state.sliceDoc(marks.from, marks.openTo), close: state.sliceDoc(marks.closeFrom, marks.to) };
  const pieces = [
    ...(marks.openTo < start ? [{ from: marks.openTo, to: start }] : []),
    ...(end < marks.closeFrom ? [{ from: end, to: marks.closeFrom }] : []),
  ];
  let edits: Edit[] = unmark(marks);
  if (pieces.length) edits = wrapping(state, was, pieces, edits, written).edits;
  if (becomes) edits = wrapping(state, becomes, [{ from: start, to: end }], edits).edits;
  // Senza i segni tolti i vicini possono spegnersi (`**~b~^|^**alfa`): passano
  // ai tag.
  const tags = brokenTwins(state, state.changes(specs(edits))).filter((tag) => !edits.some((edit) => edit.from === tag.from));
  edits = [...edits, ...tags];
  // E una coppia in attesa rimasta a inizio riga può fare un blocco
  // (`~~|~~b`, un recinto): passa ai tag.
  if (!blocksHold(state, edits)) {
    for (const pair of emptyPairsOf(state)) {
      for (const { element, marks } of layersOf(state, pair) ?? []) {
        const tag = HTML_TWIN[element];
        if (!tag || !WRITTEN_CHARS.has(state.sliceDoc(marks.from, marks.from + 1)) || edits.some((edit) => edit.from === marks.from)) continue;
        edits.push({ from: marks.from, to: marks.openTo, insert: `<${tag}>`, side: 1 }, { from: marks.closeFrom, to: marks.to, insert: `</${tag}>`, side: 1 });
      }
    }
  }
  return { changes: edits, range: place(state.changes(specs(edits)), start, end) };
}

/// Gli strati di una coppia vuota fatta di più elementi (`**~|~**`), da
/// fuori a dentro, coi loro segni o tag; `null` se il testo non torna.
function layersOf(state: EditorState, pair: EmptyPair): { element: FormatElement; marks: ElementMarks }[] | null {
  let from = pair.from;
  let to = pair.from + pair.open + pair.close;
  const out: { element: FormatElement; marks: ElementMarks }[] = [];
  for (const element of (pair.elements ?? []) as FormatElement[]) {
    const form = [SIGNS[element], twin(element)].find((candidate): candidate is Form => candidate !== null
      && state.sliceDoc(from, from + candidate.open.length) === candidate.open
      && state.sliceDoc(to - candidate.close.length, to) === candidate.close);
    if (!form) return null;
    out.push({ element, marks: { from, openTo: from + form.open.length, closeFrom: to - form.close.length, to } });
    from += form.open.length;
    to -= form.close.length;
  }
  return from === to ? out : null;
}

/// Il gesto di un elemento già nella coppia vuota a più strati in cui sta il
/// cursore: quello strato se ne va, gli altri restano in attesa.
function peel(state: EditorState, pos: number, element: FormatElement): Outcome | null {
  const pair = emptyPairsOf(state).find((candidate) => candidate.from + candidate.open === pos && (candidate.elements?.length ?? 0) > 1);
  const layers = pair ? layersOf(state, pair) : null;
  const layer = layers?.find((candidate) => candidate.element === element);
  if (!layers || !layer) return null;
  let changes: Edit[] = unmark(layer.marks);
  const rest = layers.filter((candidate) => candidate !== layer);
  // Gli strati che restano, da soli, possono fare un blocco (`~~~~` a inizio
  // riga): passano ai tag.
  // E con la lettera dentro devono leggersi: `b2~~x~~` non è barrato.
  const probe = [...changes, { from: pos, insert: "x" }];
  const line = state.doc.lineAt(pos);
  const local = ChangeSet.of(specs(probe, line.from), line.length);
  const now = readSigns(local.apply(Text.of([line.text])).toString()).elements;
  // Lo strato si legge come sé stesso, coi suoi segni: non basta che i suoi
  // segni siano segni di qualcun altro (`*<sub>x</sub>*b`).
  const at = (pos: number, side: -1 | 1) => local.mapPos(pos - line.from, side);
  const reads = (kind: FormatElement, marks: ElementMarks) => now.get(keyOf({
    from: at(marks.from, 1), openTo: at(marks.openTo - 1, 1) + 1, closeFrom: at(marks.closeFrom, 1), to: at(marks.to - 1, 1) + 1,
  }))?.element === kind;
  const blocks = blocksHold(state, changes);
  for (const { element: kind, marks } of rest) {
    const tag = twin(kind);
    if (blocks && (state.sliceDoc(marks.from, marks.openTo).startsWith("<") || reads(kind, marks))) continue;
    if (tag && !state.sliceDoc(marks.from, marks.openTo).startsWith("<")) {
      changes = [...changes, { from: marks.from, to: marks.openTo, insert: tag.open }, { from: marks.closeFrom, to: marks.to, insert: tag.close }];
    }
  }
  // Senza lo strato possono spegnersi anche gli elementi attorno.
  changes = [...changes, ...twinsOf(state, changes, [...changes, { from: pos, insert: "x" }]).filter((tag) => !changes.some((edit) => edit.from === tag.from))];
  const after = state.changes(specs(changes));
  const from = after.mapPos(pair!.from, -1);
  const cursor = after.mapPos(pos, -1);
  const to = after.mapPos(pair!.from + pair!.open + pair!.close, 1);
  return {
    changes,
    range: EditorSelection.cursor(cursor),
    pair: { from, open: cursor - from, close: to - cursor, elements: rest.map((candidate) => candidate.element) },
  };
}

/// La coppia in attesa in cui sta il cursore resta in attesa anche se il
/// gesto ne cambia i segni (`*==|==*` → `<em>==|==</em>`).
function stillHeld(state: EditorState, pos: number, outcome: Outcome): Outcome {
  const held = emptyPairsOf(state).find((pair) => pair.from + pair.open === pos);
  if (!held || outcome.pair) return outcome;
  const changes = state.changes(specs(outcome.changes));
  // I segni della coppia possono cambiare (`*` → `<em>`), e restano suoi; ciò
  // che le si scrive accanto (`<sub>` → `<sup>`) no.
  const end = held.from + held.open + held.close;
  let from = changes.mapPos(held.from, 1);
  let to = changes.mapPos(end, -1);
  changes.iterChanges((fromA, toA, fromB, toB) => {
    if (fromA === held.from && toA > fromA) from = fromB;
    if (toA === end && fromA < toA) to = toB;
  });
  const cursor = outcome.range.head;
  if (!(from < cursor && cursor < to)) return outcome;
  return { ...outcome, pair: { ...held, from, open: cursor - from, close: to - cursor } };
}

function atCursor(state: EditorState, pos: number, element: FormatElement): Outcome {
  const here = { from: pos, to: pos, empty: true };
  const stay = (changes: ChangeSet) => EditorSelection.cursor(changes.mapPos(pos, 1));
  const peeled = peel(state, pos, element);
  if (peeled) return peeled;
  const pair = emptyPairAt(state, pos, element);
  if (pair) return { changes: [{ from: pair.from, to: pair.to }], range: EditorSelection.cursor(pair.from) };
  const other = OTHER_LEAF[element];
  const otherPair = other ? emptyPairAt(state, pos, other) : null;
  if (otherPair) return openPair(state, otherPair.from, element, [{ from: otherPair.from, to: otherPair.to }]);
  // Nella coppia vuota di un apice o di un pedice un altro formato va fuori,
  // e le due coppie diventano una: se ne vanno insieme.
  const leafKind = other ? null : emptyPairAt(state, pos, "sup") ? "sup" : emptyPairAt(state, pos, "sub") ? "sub" : null;
  const leafPair = leafKind ? emptyPairAt(state, pos, leafKind) : null;
  if (leafPair && leafKind) {
    // La coppia in attesa può avere altri strati fuori (`==^|^==`): restano
    // fuori, e il nuovo va subito attorno all'apice.
    const held = emptyPairsOf(state).find((pair) => pair.from + pair.open === pos && pair.from <= leafPair.from);
    const spanFrom = held?.from ?? leafPair.from;
    const spanTo = held ? held.from + held.open + held.close : leafPair.to;
    // Dentro l'elemento la coppia ne esce: `*ab^|^*` → `*ab*^|^`, e in mezzo
    // lo divide, come in Word.
    const own = elementMarksAt(state, { from: spanFrom, to: spanTo, empty: false }, element);
    if (own && own.openTo <= spanFrom && spanTo <= own.closeFrom) {
      const out = reform(state, own, spanFrom, spanTo, element, null, (changes) => EditorSelection.cursor(changes.mapPos(pos, 1)));
      const changes = state.changes(specs(out.changes));
      const from = changes.mapPos(spanFrom, 1);
      const to = changes.mapPos(spanTo, -1);
      // I segni della coppia possono essere passati ai tag: il cursore si
      // ritrova dove si incontrano.
      const cursor = changes.mapPos(pos, -1);
      return { changes: out.changes, range: EditorSelection.cursor(cursor), pair: { from, open: cursor - from, close: to - cursor, elements: held?.elements ?? [leafKind] } };
    }
    const outer = wrapSpan(state, leafPair.from, leafPair.to, element, stay, pos);
    const changes = state.changes(specs(outer.changes));
    const from = changes.mapPos(held?.from ?? leafPair.from, -1);
    const to = changes.mapPos(held ? held.from + held.open + held.close : leafPair.to, 1);
    const open = outer.range.head - from;
    const layers: CursorElement[] = [...(held?.elements ?? [leafKind]).filter((kind) => kind !== leafKind), element, leafKind];
    return { ...outer, pair: { from, open, close: to - from - open, elements: layers } };
  }
  const own = elementMarksAt(state, here, element);
  if (own) {
    if (pos === own.closeFrom) return { changes: [], range: EditorSelection.cursor(own.to) };
    if (pos === own.openTo) return { changes: [], range: EditorSelection.cursor(own.from) };
    return stillHeld(state, pos, reform(state, own, own.openTo, own.closeFrom, element, null, (changes) => stay(changes)));
  }
  const otherLeaf = other ? elementMarksAt(state, here, other) : null;
  if (otherLeaf && other) {
    if (pos === otherLeaf.closeFrom) return openPair(state, otherLeaf.to, element);
    if (pos === otherLeaf.openTo) return openPair(state, otherLeaf.from, element);
    return stillHeld(state, pos, reform(state, otherLeaf, otherLeaf.openTo, otherLeaf.closeFrom, other, element, (changes) => stay(changes)));
  }
  const leaf = other ? null : leafAt(state, here);
  if (leaf) {
    if (pos === leaf.closeFrom) return openPair(state, leaf.to, element);
    if (pos === leaf.openTo) return openPair(state, leaf.from, element);
    return wrapSpan(state, leaf.from, leaf.to, element, stay);
  }
  const word = state.wordAt(pos);
  if (word && word.from < pos && pos < word.to) return wrapSpan(state, word.from, word.to, element, stay);
  return openPair(state, pos, element);
}

function onSelection(state: EditorState, range: SelectionRange, from: number, to: number, element: FormatElement): Outcome {
  const span = { from, to, empty: false };
  const backward = range.anchor > range.head;
  const orient = (a: number, b: number) => (backward ? EditorSelection.range(b, a) : EditorSelection.range(a, b));
  const chosen = (changes: ChangeSet, a: number, b: number) => orient(changes.mapPos(a, 1), changes.mapPos(b, -1));
  // Dentro l'elemento lo si toglie; una scelta che ne esce lo estende.
  const found = elementMarksAt(state, span, element);
  const own = found && found.from <= from && to <= found.to ? found : null;
  if (own) return reform(state, own, from, to, element, null, chosen);
  const other = OTHER_LEAF[element];
  const otherLeaf = other ? elementMarksAt(state, span, other) : null;
  if (otherLeaf && other) return reform(state, otherLeaf, from, to, other, element, chosen);
  const leaf = other ? null : leafAt(state, span);
  const [wrapFrom, wrapTo] = leaf ? [leaf.from, leaf.to] : [from, to];
  return wrapSpan(state, wrapFrom, wrapTo, element, (changes) => chosen(changes, from, to));
}

/// Una scelta di soli segni e tag, che in Live non si vedono, e spazi: non
/// c'è testo da formattare.
function onlyMarks(state: EditorState, from: number, to: number): boolean {
  const line = state.doc.lineAt(from);
  if (to > line.to) return false;
  const read = readSigns(line.text);
  const hidden = new Set(read.signs);
  read.tree.iterate({
    enter: (node) => {
      if (node.name === "HTMLTag") for (let at = node.from; at < node.to; at++) hidden.add(at + read.indent);
    },
  });
  for (let at = from; at < to; at++) if (!hidden.has(at - line.from) && !/\s/.test(line.text[at - line.from]!)) return false;
  return true;
}

function toggleRange(state: EditorState, range: SelectionRange, element: FormatElement): Outcome {
  if (range.empty) return atCursor(state, range.head, element);
  // Gli spazi ai bordi della selezione restano fuori dai segni: `**parola **`
  // non è grassetto, e `* parola*` a inizio riga è una voce. Una selezione di
  // soli spazi non ha niente da formattare: vale il cursore alla sua fine.
  const text = state.sliceDoc(range.from, range.to);
  const lead = text.length - text.trimStart().length;
  if (lead === text.length || onlyMarks(state, range.from, range.to)) return atCursor(state, range.to, element);
  const trail = text.length - text.trimEnd().length;
  return onSelection(state, range, range.from + lead, range.to - trail, element);
}

/// Il gesto di `element` su ogni selezione.
export function toggleFormat(element: FormatElement): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false;
    dispatch(state.update(
      state.changeByRange((range) => {
        const outcome = toggleRange(state, range, element);
        return {
          changes: specs(outcome.changes),
          range: outcome.range,
          effects: outcome.pair ? openedPair.of(outcome.pair) : [],
        };
      }),
      { scrollIntoView: true, userEvent: "input" },
    ));
    return true;
  };
}

// ── La prima lettera ─────────────────────────────────────────────────────────

/// La coppia vuota che ha preso i tag solo perché vuota non reggeva (`****`
/// da solo in una riga è una linea): con la prima lettera i segni tornano
/// segni, se ora si leggono, e il file resta Markdown.
const firstLetter = EditorState.transactionFilter.of((tr) => {
  if (!tr.isUserEvent("input.type") || tr.startState.selection.ranges.length > 1) return tr;
  const state = tr.startState;
  const pair = heldPairAt(state);
  if (!pair) return tr;
  const pos = pair.from + pair.open;
  const cuts: { from: number; to: number; text: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => cuts.push({ from: fromA, to: toA, text: inserted.toString() }));
  const typed = cuts[0];
  if (cuts.length !== 1 || !typed || typed.from !== pos || typed.to !== pos || !typed.text || typed.text.includes("\n")) return tr;
  const layers = layersOf(state, pair);
  const tagged = ({ element, marks }: { element: FormatElement; marks: ElementMarks }) =>
    !SIGNS[element].open.startsWith("<") && state.sliceDoc(marks.from, marks.openTo) === twin(element)?.open;
  if (!layers?.some(tagged)) return tr;
  const edits: Edit[] = [{ from: pos, insert: typed.text }];
  for (const { element, marks } of layers) {
    const signs = SIGNS[element];
    if (!tagged({ element, marks })) continue;
    // Il testo di un apice coi segni è letterale, e senza spazi.
    if (element in OTHER_LEAF && /[\s*_~^=<>`[\]$]/.test(typed.text)) return tr;
    // `~` e `^` contro altri uguali fanno corse che si leggono in più modi.
    if (/[~^=]/.test(signs.open[0]!) && (state.sliceDoc(marks.from - 1, marks.from) === signs.open[0] || state.sliceDoc(marks.to, marks.to + 1) === signs.close[signs.close.length - 1])) return tr;
    edits.push({ from: marks.from, to: marks.openTo, insert: signs.open, side: 1 }, { from: marks.closeFrom, to: marks.to, insert: signs.close, side: 1 });
  }
  if (!blocksHold(state, edits) || !sound(state, edits, "", () => [])) return tr;
  const changes = state.changes(specs(edits));
  if (brokenTwins(state, changes).length) return tr;
  // Ogni strato si legge come sé stesso.
  const line = state.doc.lineAt(pos);
  const local = ChangeSet.of(specs(edits, line.from), line.length);
  const read = readSigns(local.apply(Text.of([line.text])).toString()).elements;
  // Dove va a finire un tratto della riga: rimpiazzato, o soltanto spostato.
  const moved = (from: number, to: number): [number, number] => {
    let out: [number, number] = [local.mapPos(from - line.from, 1), local.mapPos(to - line.from, -1)];
    local.iterChanges((fromA, toA, fromB, toB) => {
      if (fromA === from - line.from && toA === to - line.from) out = [fromB, toB];
    }, true);
    return out;
  };
  for (const { element, marks } of layers) {
    if (!tagged({ element, marks })) continue;
    const [from, openTo] = moved(marks.from, marks.openTo);
    const [closeFrom, to] = moved(marks.closeFrom, marks.to);
    if (read.get(keyOf({ from, openTo, closeFrom, to }))?.element !== element) return tr;
  }
  return {
    changes,
    selection: EditorSelection.cursor(changes.mapPos(pos, -1) + typed.text.length),
    scrollIntoView: tr.scrollIntoView,
    userEvent: tr.annotation(Transaction.userEvent) ?? "input.type",
  };
});

/// I segni che tornano con la prima lettera, per la Live.
export function signsOnFirstLetter(): Extension {
  return firstLetter;
}
