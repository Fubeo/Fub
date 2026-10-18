// Il correttore nel profilo Markdown: cosa è prosa in un buffer Markdown, e
// come un rilievo del motore torna a un punto del documento.
//
// Il client (`editors/core/proof.ts`) non sa niente del formato: riceve
// segmenti di testo e risponde con rilievi nel segmento. Qui si estrae un
// segmento per blocco di prosa (paragrafo, titolo, cella di tabella, nota) e
// se ne tiene la mappa a pezzi verso il buffer:
//
// - un pezzo **verbatim** è testo del buffer copiato com'è, e un rilievo che
//   ci sta dentro per intero torna a un intervallo esatto, correggibile;
// - un **segnaposto** (`PLACEHOLDER`) sta per ciò che non è prosa — codice in
//   linea, wikilink, tag, URL, HTML, formule — e il motore non lo segna;
// - un segno di markup (`**`, `> `, `#`) sparisce: la parola che racchiude
//   resta intera, e un rilievo che lo attraversa si mostra ma non si corregge.
//
// I segni sono diagnostiche di `@codemirror/lint`: tooltip, pannello e
// tastiera (`lintKeymap`, già nel motore) sono quelli di CodeMirror. Una
// correzione è una battuta dell'utente (`userEvent: "input.proof"`): entra
// nella cronologia della superficie e nella coda di salvataggio come le altre.
import { syntaxTree } from "@codemirror/language";
import { setDiagnostics, type Action, type Diagnostic } from "@codemirror/lint";
import type { EditorState, Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import {
  PLACEHOLDER,
  ProofClient,
  ignoreKey,
  locate,
  type ProofIssue,
  type ProofPorts,
  type ProseLocation,
  type ProsePiece,
  type ProseSegment,
} from "../../../core/proof";
import { inlineDelimiters, scanTags, spans, wikilink, type SyntaxForm } from "../../../../rules/syntax";
import { t } from "../../../../i18n/strings";
import { FOOTNOTE_DEFINITION } from "./grammar";
import { frontmatterRange } from "./render";

export { locate, type ProseLocation, type ProsePiece, type ProseSegment };

/// I blocchi che contengono prosa. Una voce di lista con casella è un
/// `Task`, non un paragrafo.
const PROSE_BLOCKS = new Set([
  "Paragraph",
  "ATXHeading1", "ATXHeading2", "ATXHeading3", "ATXHeading4", "ATXHeading5", "ATXHeading6",
  "SetextHeading1", "SetextHeading2",
  "TableCell",
  "Task",
  "FootnoteDefinition",
]);
/// I blocchi che non ne contengono, e dentro cui non si scende.
const LITERAL_BLOCKS = new Set([
  "FencedCode", "CodeBlock", "HTMLBlock", "CommentBlock", "ProcessingInstructionBlock",
  "LinkReference", "HorizontalRule", "TableDelimiter",
]);
/// Il markup che sparisce dal segmento senza lasciare niente.
const MARKS = new Set([
  "HeaderMark", "EmphasisMark", "StrikethroughMark", "QuoteMark", "ListMark", "TaskMarker",
  "LinkMark", "LinkTitle", "LinkLabel",
]);
/// I segni a inizio riga, che portano via anche lo spazio che li segue.
const LINE_MARKS = new Set(["HeaderMark", "QuoteMark", "ListMark", "TaskMarker"]);
/// Ciò che nel segmento diventa un segnaposto.
const OBJECTS = new Set([
  "InlineCode", "Autolink", "HTMLTag", "Comment", "Entity", "Image", "ProcessingInstruction",
]);
/// Le sintassi dichiarate il cui contenuto è prosa: cadono soltanto i
/// delimitatori. Il contenuto di ogni altra (un commento `%%…%%`, una sintassi
/// di terzi di cui non si sa niente) è un segnaposto.
const PROSE_INLINE = new Set(["fub:highlight"]);
/// La formula in linea, `$…$`, che Lezer non conosce.
const INLINE_MATH = /(?<![\\$])\$(?=\S)[^$\n]*?\S\$(?!\d)/g;
/// Il rimando a una nota, `[^1]`.
const FOOTNOTE_REF = /\[\^[^\]\s]+\]/g;
/// L'id di un blocco a fine riga, ` ^id`.
const BLOCK_ID = /[ \t]\^[A-Za-z0-9-]+[ \t]*$/gm;
/// Gli spazi di rientro dopo un a capo e quelli prima: non sono doppi spazi
/// della prosa.
const LINE_EDGES = /[ \t]+(?=\n)|(?<=\n)[ \t]+/g;
/// L'URL nudo, quando l'estensione GFM non l'ha già fatto nodo.
const BARE_URL = /\b(?:https?:\/\/|www\.)[^\s<>()]+/g;

type Cut =
  | { readonly from: number; readonly to: number; readonly kind: "drop" }
  | { readonly from: number; readonly to: number; readonly kind: "object" }
  | { readonly from: number; readonly to: number; readonly kind: "text"; readonly text: string };

/// I tagli che vengono dall'albero dentro `[from, to)`.
function treeCuts(state: EditorState, from: number, to: number): Cut[] {
  const cuts: Cut[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.from < from || node.to > to) return;
      if (node.from === from && node.to === to) return;
      const name = node.name;
      if (MARKS.has(name)) {
        let end = node.to;
        if (LINE_MARKS.has(name)) {
          while (end < to && /[ \t]/.test(state.doc.sliceString(end, end + 1))) end += 1;
        }
        cuts.push({ from: node.from, to: end, kind: "drop" });
        return false;
      }
      if (name === "Link") {
        // Di un link si legge il testo fra `[` e `]`: da `]` in poi (indirizzo,
        // titolo, etichetta) non è prosa.
        const marks = node.node.getChildren("LinkMark");
        if (marks.length >= 2) cuts.push({ from: marks[1].from, to: node.to, kind: "drop" });
        return undefined;
      }
      if (name === "URL") {
        // L'indirizzo di un link non si legge; un URL nudo sta al posto di una parola.
        const parent = node.node.parent?.name;
        cuts.push({ from: node.from, to: node.to, kind: parent === "Link" ? "drop" : "object" });
        return false;
      }
      if (OBJECTS.has(name)) {
        cuts.push({ from: node.from, to: node.to, kind: "object" });
        return false;
      }
      if (name === "Escape") {
        cuts.push({ from: node.from, to: node.to, kind: "text", text: state.doc.sliceString(node.from + 1, node.to) });
        return false;
      }
      if (name === "HardBreak") {
        cuts.push({ from: node.from, to: node.to, kind: "text", text: "\n" });
        return false;
      }
      return undefined;
    },
  });
  return cuts;
}

/// I tagli che l'albero non vede, dentro un tratto di testo semplice che
/// comincia a `offset` nel buffer.
function textCuts(text: string, offset: number, declared: ReturnType<typeof inlineDelimiters>): Cut[] {
  const cuts: Cut[] = [];
  const add = (from: number, to: number, kind: "drop" | "object") => {
    cuts.push({ from: offset + from, to: offset + to, kind });
  };
  for (const pattern of [INLINE_MATH, BARE_URL]) {
    pattern.lastIndex = 0;
    for (let m; (m = pattern.exec(text)); ) add(m.index, m.index + m[0].length, "object");
  }
  for (const pattern of [BLOCK_ID, LINE_EDGES]) {
    pattern.lastIndex = 0;
    for (let m; (m = pattern.exec(text)); ) add(m.index, m.index + m[0].length, "drop");
  }
  let lineStart = 0;
  for (const row of text.split("\n")) {
    for (const span of spans(row, declared)) {
      if (PROSE_INLINE.has(span.name)) {
        add(lineStart + span.from, lineStart + span.contentFrom, "drop");
        add(lineStart + span.contentTo, lineStart + span.to, "drop");
      } else {
        add(lineStart + span.from, lineStart + span.to, "object");
      }
    }
    for (const tag of scanTags(row)) add(lineStart + tag.from, lineStart + tag.to, "object");
    lineStart += row.length + 1;
  }
  return cuts;
}

/// I tagli che vincono sull'albero: Lezer legge `[[Nota]]` e `[^1]` come
/// link, e la loro parte fra parentesi non è prosa.
function bracketCuts(text: string, offset: number): Cut[] {
  const cuts: Cut[] = [];
  let lineStart = 0;
  for (const row of text.split("\n")) {
    for (const found of wikilink(row)) {
      cuts.push({ from: offset + lineStart + found.from, to: offset + lineStart + found.to, kind: "object" });
    }
    FOOTNOTE_REF.lastIndex = 0;
    for (let m; (m = FOOTNOTE_REF.exec(row)); ) {
      cuts.push({ from: offset + lineStart + m.index, to: offset + lineStart + m.index + m[0].length, kind: "object" });
    }
    lineStart += row.length + 1;
  }
  return cuts;
}

function overlaps(a: { from: number; to: number }, b: { from: number; to: number }): boolean {
  return a.from < b.to && b.from < a.to;
}

/// I tagli senza sovrapposizioni: vince il primo, e un oggetto vince su ciò
/// che comincia dentro di lui.
function disjoint(cuts: Cut[]): Cut[] {
  cuts.sort((a, b) => a.from - b.from || b.to - a.to);
  const out: Cut[] = [];
  let end = -1;
  for (const cut of cuts) {
    if (cut.from < end) continue;
    out.push(cut);
    end = cut.to;
  }
  return out;
}

function segmentOf(
  state: EditorState,
  from: number,
  to: number,
  declared: ReturnType<typeof inlineDelimiters>,
): ProseSegment | null {
  const doc = state.doc;
  const brackets = bracketCuts(doc.sliceString(from, to), from);
  const base = [
    ...brackets,
    ...treeCuts(state, from, to).filter((cut) => !brackets.some((bracket) => overlaps(cut, bracket))),
  ];
  base.sort((a, b) => a.from - b.from);
  // Il testo semplice fra un taglio dell'albero e l'altro.
  const cuts = [...base];
  let at = from;
  for (const cut of [...base, { from: to, to, kind: "drop" } as Cut]) {
    if (at < cut.from) cuts.push(...textCuts(doc.sliceString(at, cut.from), at, declared));
    at = Math.max(at, cut.to);
  }
  const pieces: ProsePiece[] = [];
  let text = "";
  const push = (piece: string, docFrom: number, docTo: number, verbatim: boolean) => {
    if (piece === "") return;
    pieces.push({ start: text.length, end: text.length + piece.length, docFrom, docTo, verbatim });
    text += piece;
  };
  at = from;
  for (const cut of disjoint(cuts)) {
    if (at < cut.from) push(doc.sliceString(at, cut.from), at, cut.from, true);
    if (cut.kind === "object") push(PLACEHOLDER, cut.from, cut.to, false);
    else if (cut.kind === "text") push(cut.text, cut.from, cut.to, false);
    at = Math.max(at, cut.to);
  }
  if (at < to) push(doc.sliceString(at, to), at, to, true);
  if (!/[\p{L}]/u.test(text)) return null;
  return { text, from, to, pieces };
}

/// I blocchi di prosa che toccano `ranges`, in ordine di documento.
export function extractProse(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  forms?: readonly SyntaxForm[],
): ProseSegment[] {
  const declared = inlineDelimiters(forms);
  const front = frontmatterRange(state.doc);
  const blocks: { from: number; to: number; name: string }[] = [];
  const seen = new Set<number>();
  for (const range of ranges) {
    syntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (LITERAL_BLOCKS.has(node.name)) return false;
        if (!PROSE_BLOCKS.has(node.name)) return undefined;
        if (!seen.has(node.from)) {
          seen.add(node.from);
          blocks.push({ from: node.from, to: node.to, name: node.name });
        }
        return false;
      },
    });
  }
  blocks.sort((a, b) => a.from - b.from);
  const out: ProseSegment[] = [];
  for (const block of blocks) {
    if (front && block.from < front.to) continue;
    // L'etichetta di una nota (`[^a]: `), che il blocco sia il nodo della
    // nota o un paragrafo che la porta in testa.
    const label = FOOTNOTE_DEFINITION.exec(state.doc.sliceString(block.from, block.to));
    const from = block.from + (label ? label[0].length : 0);
    const segment = segmentOf(state, from, block.to, declared);
    if (segment) out.push(segment);
  }
  return out;
}

/// La lingua dichiarata dal frontmatter (`lang: it-IT`), se c'è.
export function frontmatterLanguage(state: EditorState): string | null {
  const range = frontmatterRange(state.doc);
  if (!range) return null;
  const match = /^lang(?:uage)?[ \t]*:[ \t]*["']?([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{1,8})*)["']?[ \t]*$/m.exec(
    state.doc.sliceString(range.from, range.to),
  );
  return match ? match[1] : null;
}

/// Quanto si aspetta dopo l'ultima battuta prima di chiedere.
const QUIET_MS = 400;
/// Quanto testo oltre la parte visibile si controlla, sopra e sotto.
const MARGIN = 4000;
/// Quanti suggerimenti diventano azioni.
const SUGGESTED_ACTIONS = 4;

export interface MarkdownProofOptions {
  readonly client: ProofClient;
  /// Le sintassi dichiarate del documento, per sapere cosa non è prosa.
  readonly forms?: () => readonly SyntaxForm[] | undefined;
  /// L'avviso di un comando del correttore (la parola aggiunta).
  readonly notify?: (message: string) => void;
}

/// Sostituisce `from..to` se contiene ancora `expected`: un'azione rimasta
/// aperta su un testo nel frattempo cambiato non scrive niente.
export function replaceChecked(view: EditorView, from: number, to: number, expected: string, insert: string): boolean {
  if (view.state.readOnly || view.state.sliceDoc(from, to) !== expected) return false;
  view.dispatch({ changes: { from, to, insert }, userEvent: "input.proof", scrollIntoView: true });
  return true;
}

/// I segni del correttore per i blocchi di prosa visibili.
export function markdownProof(options: MarkdownProofOptions): Extension {
  const ignored = new Set<string>();
  return ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | undefined;
      private generation = 0;
      private destroyed = false;
      private marked = false;
      private readonly stopClient: () => void;

      constructor(private readonly view: EditorView) {
        this.stopClient = options.client.onChange(() => this.schedule(0));
        this.schedule(0);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) this.schedule(QUIET_MS);
      }

      destroy(): void {
        this.destroyed = true;
        clearTimeout(this.timer);
        this.stopClient();
      }

      private schedule(delay: number): void {
        if (this.destroyed) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.run(), delay);
      }

      private async run(): Promise<void> {
        const view = this.view;
        const state = view.state;
        const generation = ++this.generation;
        const ranges = view.visibleRanges.map((range) => ({
          from: Math.max(0, range.from - MARGIN),
          to: Math.min(state.doc.length, range.to + MARGIN),
        }));
        const segments = extractProse(state, ranges, options.forms?.());
        let result;
        try {
          result = await options.client.check(segments.map((segment) => segment.text), frontmatterLanguage(state));
        } catch {
          // Un guasto del canale non deve rompere la scrittura: si riprova
          // alla prossima battuta.
          return;
        }
        // Il buffer è cambiato durante l'attesa: la prossima battuta
        // riprogramma il controllo, e questo risultato non vale più.
        if (this.destroyed || generation !== this.generation || view.state.doc !== state.doc) return;
        const diagnostics = result ? this.diagnostics(state, segments, result.segments) : [];
        if (diagnostics.length === 0 && !this.marked) return;
        this.marked = diagnostics.length > 0;
        view.dispatch(setDiagnostics(view.state, diagnostics));
      }

      private diagnostics(
        state: EditorState,
        segments: readonly ProseSegment[],
        issues: readonly (readonly ProofIssue[])[],
      ): Diagnostic[] {
        const out: Diagnostic[] = [];
        segments.forEach((segment, i) => {
          for (const issue of issues[i] ?? []) {
            const where = locate(segment, issue.start, issue.end);
            if (!where) continue;
            const text = state.sliceDoc(where.from, where.to);
            const key = ignoreKey(issue, text);
            if (ignored.has(key)) continue;
            out.push({
              from: where.from,
              to: where.to,
              severity: issue.kind === "spelling" ? "error" : "warning",
              markClass: `cm-fub-proof cm-fub-proof-${issue.kind}`,
              source: t("proof.source"),
              message: issue.message,
              actions: this.actions(state, issue, where, text, key),
            });
          }
        });
        return out;
      }

      private actions(state: EditorState, issue: ProofIssue, where: ProseLocation, text: string, key: string): Action[] {
        const actions: Action[] = [];
        if (where.exact && !state.readOnly) {
          for (const suggestion of issue.suggestions.slice(0, SUGGESTED_ACTIONS)) {
            actions.push({
              name: suggestion,
              apply: (view, from, to) => {
                replaceChecked(view, from, to, text, suggestion);
              },
            });
          }
        }
        if (issue.kind === "spelling") {
          actions.push({
            name: t("proof.add_word"),
            apply: () => {
              ignored.add(key);
              this.schedule(0);
              options.client.addWord(text).then(
                (message) => {
                  if (message) options.notify?.(message);
                },
                (error: unknown) => options.notify?.(error instanceof Error ? error.message : String(error)),
              );
            },
          });
        }
        actions.push({
          name: t("proof.ignore"),
          apply: () => {
            ignored.add(key);
            this.schedule(0);
          },
        });
        return actions;
      }
    },
  );
}

/// L'aspetto dei segni: un'ondina sotto la parola, del colore del tema.
export const proofTheme = EditorView.baseTheme({
  ".cm-lintRange.cm-fub-proof-spelling": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--danger, #d33) 1px",
    textUnderlineOffset: "3px",
  },
  ".cm-lintRange.cm-fub-proof-grammar": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--warning, #c80) 1px",
    textUnderlineOffset: "3px",
  },
});

/// Il correttore di una superficie Markdown: il client legato alle sue porte e
/// l'estensione da dare al profilo. `dispose` chiude il client.
export function mountMarkdownProof(
  ports: ProofPorts,
  options: Omit<MarkdownProofOptions, "client">,
): { readonly extension: Extension; dispose(): void } {
  const client = new ProofClient(ports);
  return {
    extension: [markdownProof({ ...options, client }), proofTheme],
    dispose: () => client.dispose(),
  };
}
