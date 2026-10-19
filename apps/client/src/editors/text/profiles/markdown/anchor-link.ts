// Il punto della nota a cui si può collegare: il titolo o il blocco dove sta
// il cursore, come lo nomina un `[[Nota#Titolo]]` o un `[[Nota#^id]]`.
//
// Un blocco senza id ne riceve uno nuovo, ` ^abc123` in coda al paragrafo:
// è la forma che il provider legge (`parse::trailing_anchor`), il `^`
// preceduto da uno spazio. Il resto del documento non si tocca.

import type { EditorState, StateCommand } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import type { SurfaceAnchor } from "../../../core/registry";
import { findTrailingAnchor } from "./render";

/// Dove il cursore ha un punto da collegare. `insert` c'è quando il blocco
/// non ha ancora un id: è la scrittura che glielo dà.
export interface AnchorAtCursor {
  readonly anchor: SurfaceAnchor;
  readonly insert: { readonly at: number; readonly text: string } | null;
}

const HEADING = /^(?:ATXHeading[1-6]|SetextHeading[12])$/;

function enclosingBlock(state: EditorState, pos: number): SyntaxNode | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (HEADING.test(node.name) || node.name === "Paragraph") return node;
  }
  // A inizio riga `resolveInner(pos, -1)` guarda la riga prima: si riprova in avanti.
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (HEADING.test(node.name) || node.name === "Paragraph") return node;
  }
  return null;
}

/// Il testo di un titolo come lo scrive un link: senza i `#` e senza
/// un'eventuale chiusura `###`.
function headingText(state: EditorState, node: SyntaxNode): string {
  const first = state.doc.lineAt(node.from).text;
  if (node.name.startsWith("Setext")) return first.trim();
  return first.replace(/^\s{0,3}#{1,6}(?:\s+|$)/u, "").replace(/\s+#+\s*$/u, "").trim();
}

function freshId(state: EditorState, random: () => number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const text = state.doc.toString();
  for (;;) {
    let id = "";
    for (let i = 0; i < 6; i++) id += alphabet[Math.floor(random() * alphabet.length)];
    // Almeno una lettera, e mai un id che il documento usa già.
    if (/[a-z]/.test(id) && !text.includes(`^${id}`)) return id;
  }
}

const cryptoRandom = (): number => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;

/// Il punto da collegare dove sta il cursore principale, o `null` fuori da un
/// titolo o da un paragrafo (una riga vuota, un blocco di codice, una tabella).
export function anchorAtCursor(state: EditorState, random: () => number = cryptoRandom): AnchorAtCursor | null {
  const node = enclosingBlock(state, state.selection.main.head);
  if (!node) return null;
  const slice = state.sliceDoc(node.from, node.to);
  const written = findTrailingAnchor(slice);
  if (HEADING.test(node.name)) {
    // Un titolo con un id scritto si risolve per quell'id, non per il testo.
    if (written) return { anchor: { kind: "block", id: written.raw }, insert: null };
    const text = headingText(state, node);
    return text === "" ? null : { anchor: { kind: "heading", text }, insert: null };
  }
  if (written) return { anchor: { kind: "block", id: written.raw }, insert: null };
  const id = freshId(state, random);
  const at = node.from + slice.replace(/\s+$/u, "").length;
  return { anchor: { kind: "block", id }, insert: { at, text: ` ^${id}` } };
}

/// Scrive l'id che `found` chiede, come una battuta dell'utente.
export function writeAnchor(found: AnchorAtCursor): StateCommand {
  return ({ state, dispatch }) => {
    if (!found.insert) return true;
    dispatch(state.update({ changes: { from: found.insert.at, insert: found.insert.text }, userEvent: "input" }));
    return true;
  };
}
