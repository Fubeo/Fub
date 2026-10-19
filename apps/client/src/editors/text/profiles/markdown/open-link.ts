// `Alt-Invio`: apre il link sotto il cursore, come `Mod-click` lo apre col mouse.
//
// Vale in Live e in Sorgente — la tastiera non ha bisogno della resa — e passa
// dagli stessi due esiti del click: un wikilink va a `openWikilink` con pagina,
// sezione e blocco, un indirizzo esterno si apre solo se `isAllowedLink` lo
// lascia passare, che è la policy di Lettura.

import { Prec, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { wikilink } from "../../../../rules/syntax";
import { isAllowedLink } from "../../../../ui/sanitize";
import type { LivePreviewCallbacks } from "./livepreview";
import { isStrictlyInsideCode } from "./parser";

export type LinkAtCursor =
  | { kind: "wikilink"; page: string; heading: string | null; block: string | null }
  | { kind: "url"; href: string };

// `[testo](indirizzo "titolo")` e `<indirizzo>`; l'indirizzo nudo per ultimo,
// perché dentro le due forme precedenti c'è già.
const MARKDOWN_LINK = /!?\[[^\]\n]*\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"\n]*")?\s*\)/g;
const AUTOLINK = /<((?:https?:\/\/|mailto:)[^\s>]+)>/gi;
const BARE_URL = /(?:https?:\/\/|mailto:)[^\s<>()[\]]+/gi;

/// Il link che contiene la posizione `pos`, estremi compresi. Puro sullo stato.
export function linkAt(state: EditorState, pos: number): LinkAtCursor | null {
  if (isStrictlyInsideCode(state, pos)) return null;
  const line = state.doc.lineAt(pos);
  const column = pos - line.from;
  const covers = (from: number, to: number) => from <= column && column <= to;

  for (const found of wikilink(line.text)) {
    if (covers(found.from, found.to)) {
      return { kind: "wikilink", page: found.page, heading: found.heading, block: found.block };
    }
  }
  for (const pattern of [MARKDOWN_LINK, AUTOLINK, BARE_URL]) {
    pattern.lastIndex = 0;
    for (let m; (m = pattern.exec(line.text)); ) {
      if (!covers(m.index, m.index + m[0].length)) continue;
      // La punteggiatura in coda a un indirizzo nudo è della frase, non del link.
      const href = pattern === BARE_URL ? m[0].replace(/[.,;:!?'"]+$/u, "") : m[1];
      return { kind: "url", href };
    }
  }
  return null;
}

export function openLinkKeymap(callbacks: LivePreviewCallbacks): Extension {
  return Prec.high(keymap.of([{
    key: "Alt-Enter",
    run(view: EditorView) {
      const main = view.state.selection.main;
      const found = linkAt(view.state, main.head);
      if (!found) return false;
      if (found.kind === "wikilink") {
        callbacks.openWikilink(found.page, found.heading, found.block);
        return true;
      }
      if (!isAllowedLink(found.href)) return false;
      window.open(found.href, "_blank", "noopener,noreferrer");
      return true;
    },
  }]));
}
