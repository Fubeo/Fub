// Cosa sta sotto il puntatore in una nota Markdown, per il menu del tasto
// destro: un link, una casella, una voce di lista, un blocco di codice, una
// riga di tabella. Letture pure dello stato: le voci le compone la superficie.
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

/// Un link sotto il puntatore, con il suo posto nel documento (UTF-16 del
/// testo normalizzato).
export type MarkdownLinkAt =
  | {
      readonly kind: "wikilink";
      readonly embed: boolean;
      readonly page: string;
      readonly heading: string | null;
      readonly block: string | null;
      /// Ciò che si legge del link: l'alias, o il nome della pagina.
      readonly text: string;
      readonly from: number;
      readonly to: number;
    }
  | {
      readonly kind: "link";
      readonly embed: boolean;
      readonly url: string;
      readonly text: string;
      readonly from: number;
      readonly to: number;
    };

const WIKILINK = /(!?)\[\[([^\]\n]+?)\]\]/g;
const MARKDOWN_LINK = /(!?)\[([^\]\n]*)\]\(<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\)/g;
const BARE_URL = /\bhttps?:\/\/[^\s<>()\]]+/g;

/// Il link della riga che contiene `pos`, se ce n'è uno lì.
export function linkAt(state: EditorState, pos: number): MarkdownLinkAt | null {
  const line = state.doc.lineAt(pos);
  const column = pos - line.from;
  const text = line.text;
  for (const match of text.matchAll(WIKILINK)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (column < start || column > end) continue;
    const [target = "", alias] = match[2]!.split("|", 2);
    const hash = target.indexOf("#");
    const page = (hash >= 0 ? target.slice(0, hash) : target).trim();
    const anchor = hash >= 0 ? target.slice(hash + 1).trim() : "";
    return {
      kind: "wikilink",
      embed: match[1] === "!",
      page,
      heading: anchor && !anchor.startsWith("^") ? anchor : null,
      block: anchor.startsWith("^") ? anchor.slice(1) : null,
      text: (alias ?? "").trim() || (anchor && !page ? anchor : page),
      from: line.from + start,
      to: line.from + end,
    };
  }
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (column < start || column > end) continue;
    return { kind: "link", embed: match[1] === "!", url: match[3]!, text: match[2]!, from: line.from + start, to: line.from + end };
  }
  for (const match of text.matchAll(BARE_URL)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (column < start || column > end) continue;
    return { kind: "link", embed: false, url: match[0], text: match[0], from: line.from + start, to: line.from + end };
  }
  return null;
}

const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([^\]\r\n])\]/;
const LIST = /^\s*(?:[-*+]|\d+[.)])\s/;
const HEADING = /^#{1,6}\s/;

/// La casella della voce di lista sulla riga di `pos`: dove sta il suo
/// simbolo e se è segnata.
export function taskAt(state: EditorState, pos: number): { readonly symbol: number; readonly checked: boolean } | null {
  const line = state.doc.lineAt(pos);
  const match = TASK.exec(line.text);
  if (!match) return null;
  const symbol = line.from + match[1]!.length + 1;
  return { symbol, checked: match[2] !== " " };
}

/// La riga di `pos` è una voce di lista.
export function listAt(state: EditorState, pos: number): boolean {
  return LIST.test(state.doc.lineAt(pos).text);
}

/// La riga di `pos` è un titolo.
export function headingAt(state: EditorState, pos: number): boolean {
  return HEADING.test(state.doc.lineAt(pos).text);
}

/// La riga di `pos` è una riga di tabella (nel sorgente).
export function tableRowAt(state: EditorState, pos: number): boolean {
  return /^\s*\|/.test(state.doc.lineAt(pos).text);
}

/// Il blocco di codice recintato che contiene `pos`: il suo linguaggio e il
/// suo contenuto, senza i recinti.
export function codeBlockAt(state: EditorState, pos: number): { readonly language: string; readonly code: string } | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name !== "FencedCode") continue;
    const info = node.getChild("CodeInfo");
    const text = node.getChild("CodeText");
    return {
      language: info ? state.sliceDoc(info.from, info.to).trim() : "",
      code: text ? state.sliceDoc(text.from, text.to) : "",
    };
  }
  return null;
}
