// Cosa sta sotto il puntatore in una nota Markdown, per il menu del tasto
// destro: un link, un tag, una casella, una voce di lista, un titolo, un
// blocco di codice, una riga di tabella. Letture pure dello stato: le voci le
// compone la superficie.
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { scanTags } from "../../../../rules/mirrored";

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

const LIST_ITEM = /^(\s*)(?:([-*+])|\d+[.)])\s+(\[[^\]\r\n]\]\s)?/;

/// La voce di lista sulla riga di `pos`: di che tipo è e se il rientro si può
/// cambiare. Si aumenta soltanto sotto una voce che sta almeno allo stesso
/// livello (la prima voce non ha dove entrare), si riduce da un livello in su.
export function listItemAt(state: EditorState, pos: number): {
  readonly kind: "bullet" | "ordered" | "task";
  readonly indent: boolean;
  readonly dedent: boolean;
} | null {
  const line = state.doc.lineAt(pos);
  const match = LIST_ITEM.exec(line.text);
  if (!match) return null;
  const depth = match[1]!.replace(/\t/g, "    ").length;
  let above: RegExpExecArray | null = null;
  for (let n = line.number - 1; n >= 1; n--) {
    const text = state.doc.line(n).text;
    if (text.trim() === "") continue;
    above = LIST_ITEM.exec(text);
    break;
  }
  return {
    kind: match[3] ? "task" : match[2] ? "bullet" : "ordered",
    indent: above !== null && above[1]!.replace(/\t/g, "    ").length >= depth,
    dedent: depth > 0,
  };
}

/// Il livello del titolo sulla riga di `pos`, o `null`.
export function headingLevelAt(state: EditorState, pos: number): number | null {
  const match = /^(#{1,6})\s/.exec(state.doc.lineAt(pos).text);
  return match ? match[1]!.length : null;
}

/// La riga di `pos` è un titolo.
export function headingAt(state: EditorState, pos: number): boolean {
  return headingLevelAt(state, pos) !== null;
}

/// Il testo del titolo sulla riga di `pos`, senza i cancelletti.
export function headingText(state: EditorState, pos: number): string {
  return state.doc.lineAt(pos).text.replace(/^#{1,6}\s+/, "").replace(/\s+#+\s*$/, "").trim();
}

/// La sezione del titolo sulla riga di `pos`: dal titolo fino al prossimo
/// dello stesso livello o di uno più alto, fuori dai blocchi di codice.
export function sectionAt(state: EditorState, pos: number): { readonly from: number; readonly to: number } | null {
  const level = headingLevelAt(state, pos);
  if (level === null) return null;
  const start = state.doc.lineAt(pos);
  let to = state.doc.length;
  for (let n = start.number + 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const next = /^(#{1,6})\s/.exec(line.text);
    if (next && next[1]!.length <= level && codeBlockAt(state, line.from) === null) {
      to = line.from;
      break;
    }
  }
  while (to > start.to && /\s/.test(state.sliceDoc(to - 1, to))) to--;
  return { from: start.from, to };
}

/// Il `#tag` che contiene `pos`, col suo posto (UTF-16 del testo normalizzato).
export function tagAt(state: EditorState, pos: number): { readonly name: string; readonly from: number; readonly to: number } | null {
  const line = state.doc.lineAt(pos);
  if (codeBlockAt(state, pos) !== null) return null;
  for (const tag of scanTags(line.text)) {
    if (pos >= line.from + tag.from && pos <= line.from + tag.to) {
      return { name: tag.name, from: line.from + tag.from, to: line.from + tag.to };
    }
  }
  return null;
}

/// La riga di `pos` è una riga di tabella (nel sorgente).
export function tableRowAt(state: EditorState, pos: number): boolean {
  return /^\s*\|/.test(state.doc.lineAt(pos).text);
}

/// Il blocco di codice recintato che contiene `pos`: il suo linguaggio e il
/// suo contenuto, senza i recinti, e dove stanno il blocco e il linguaggio.
export function codeBlockAt(state: EditorState, pos: number): {
  readonly language: string;
  readonly code: string;
  readonly from: number;
  readonly to: number;
  /// Dove sta scritto il linguaggio, subito dopo il recinto (vuoto se non c'è).
  readonly info: { readonly from: number; readonly to: number };
} | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1); node; node = node.parent) {
    if (node.name !== "FencedCode") continue;
    const info = node.getChild("CodeInfo");
    const text = node.getChild("CodeText");
    const fence = node.getChild("CodeMark");
    const at = fence?.to ?? node.from;
    return {
      language: info ? state.sliceDoc(info.from, info.to).trim() : "",
      code: text ? state.sliceDoc(text.from, text.to) : "",
      from: node.from,
      to: node.to,
      info: info ? { from: info.from, to: info.to } : { from: at, to: at },
    };
  }
  return null;
}
