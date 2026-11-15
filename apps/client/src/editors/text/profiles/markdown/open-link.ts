// `Alt-Invio` e i clic sui link della nota.
//
// `Alt-Invio` vale in Scrittura e in Sorgente — la tastiera non ha bisogno
// della resa. Su un wikilink apre la sbirciata (E11, T20: `state/note-peek.ts`),
// la nota sopra la destra del foglio; senza sbirciata (una finestra che non la
// offre) apre la nota. Su un `href` passa dagli stessi esiti del clic in
// Lettura: `isAllowedLink`, la policy di Lettura, e poi `routeHref`: ancora,
// documento del vault o indirizzo esterno.
//
// Col puntatore, su un wikilink della Scrittura: Alt col clic sbircia,
// Ctrl col clic (Cmd sul Mac) è il clic che apre. Che cosa fa il clic che apre
// lo dice `editor.link-click` (`followWikilink`): `apri`, di serie, porta la
// nota nel riquadro; `sbircia` la apre nella sbirciata. Il clic semplice resta
// del cursore, perché il link è testo che si scrive.

import { syntaxTree } from "@codemirror/language";
import { Prec, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { wikilink } from "../../../../rules/syntax";
import { isAllowedLink } from "../../../../ui/sanitize";
import { openWebLink } from "../../../../ui/web-viewer";
import { decodeDestination, normalizeLabel, routeHref } from "./link-syntax";
import type { LivePreviewCallbacks } from "./livepreview";
import { isStrictlyInsideCode } from "./parser";
import { linkReferences, renderMarkdownState } from "./render";

/// Il gesto con cui si segue un wikilink: il clic che apre (la regola la dice
/// `editor.link-click`), la sbirciata chiesta (Alt), l'apertura chiesta (il
/// menu «Apri»).
export type WikilinkGesture = "click" | "peek" | "open";

/// Chi segue un wikilink: aprire, sbirciare (se la finestra lo sa fare), e la
/// regola del clic.
export interface WikilinkFollow {
  openWikilink(page: string, heading: string | null, block: string | null): void | Promise<void>;
  peekWikilink?(page: string, heading: string | null, block: string | null): void | Promise<void>;
  linkClick?(): "apri" | "sbircia";
}

/// Segue il wikilink col gesto `gesture`: la sbirciata se è chiesta, o se il
/// clic che apre deve sbirciare; altrimenti la nota si apre. Senza
/// sbirciata, si apre sempre.
export function followWikilink(
  follow: WikilinkFollow,
  page: string,
  heading: string | null,
  block: string | null,
  gesture: WikilinkGesture,
): void | Promise<void> {
  const peek = follow.peekWikilink;
  const wantsPeek = gesture === "peek" || (gesture === "click" && follow.linkClick?.() === "sbircia");
  if (peek && wantsPeek) return peek(page, heading, block);
  return follow.openWikilink(page, heading, block);
}

export type LinkAtCursor =
  | { kind: "wikilink"; page: string; heading: string | null; block: string | null }
  | { kind: "url"; href: string };

// L'indirizzo nudo non ha un nodo nell'albero: lo si cerca sulla riga.
const BARE_URL = /(?:https?:\/\/|mailto:)[^\s<>()[\]]+/gi;
const FOOTNOTE_REFERENCE = /^\[\^[^\]\r\n]+\]$/;

/// Il link che contiene la posizione `pos`, estremi compresi. Puro sullo stato.
///
/// I link Markdown si leggono dall'albero sintattico, come li legge la resa:
/// destinazioni con parentesi bilanciate o fra `<…>`, link per riferimento
/// risolti con le definizioni del documento (D14).
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
  const node = enclosingLink(state, pos);
  if (node) {
    const href = hrefOf(state, node);
    return href ? { kind: "url", href } : null;
  }
  BARE_URL.lastIndex = 0;
  for (let m; (m = BARE_URL.exec(line.text)); ) {
    if (!covers(m.index, m.index + m[0].length)) continue;
    // La punteggiatura in coda a un indirizzo nudo è della frase, non del link.
    return { kind: "url", href: m[0].replace(/[.,;:!?'"]+$/u, "") };
  }
  return null;
}

function enclosingLink(state: EditorState, pos: number): SyntaxNode | null {
  const tree = syntaxTree(state);
  for (const side of [1, -1] as const) {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, side); node; node = node.parent) {
      if (node.name === "Link" || node.name === "Image" || node.name === "Autolink") return node;
    }
  }
  return null;
}

/// Dove porta il nodo di un link: la destinazione scritta, quella della sua
/// definizione, o l'indirizzo di un autolink. `null` se non porta da nessuna parte.
function hrefOf(state: EditorState, node: SyntaxNode): string | null {
  const source = (from: number, to: number) => state.sliceDoc(from, to);
  const url = node.getChild("URL");
  if (node.name === "Autolink") {
    const label = source(url?.from ?? node.from, url?.to ?? node.to).replace(/^<|>$/g, "");
    return label.includes("@") && !/^[a-z][\w+.-]*:/i.test(label) ? `mailto:${label}` : label;
  }
  if (FOOTNOTE_REFERENCE.test(source(node.from, node.to))) return null;
  const marks = node.getChildren("LinkMark");
  const opener = marks[0];
  const closer = marks.find((mark) => source(mark.from, mark.from + 1) === "]");
  if (!opener || !closer) return null;
  if (marks.some((mark) => mark.from > closer.from && source(mark.from, mark.from + 1) === "(")) {
    return url ? decodeDestination(source(url.from, url.to)) || null : null;
  }
  const reference = node.getChild("LinkLabel");
  const label = reference ? source(reference.from + 1, reference.to - 1) || source(opener.to, closer.from) : source(opener.to, closer.from);
  return linkReferences(state).get(normalizeLabel(label))?.href || null;
}

/// Segue un `href` dall'editor come lo segue la Lettura: un'ancora porta il
/// cursore al suo titolo, un percorso relativo apre il documento del vault,
/// una pagina web va al visore o al browser (D15).
function followHref(view: EditorView, href: string, callbacks: LivePreviewCallbacks): boolean {
  if (!isAllowedLink(href)) return false;
  const route = routeHref(href);
  if (route.kind === "fragment") {
    let id = route.id;
    try { id = decodeURIComponent(id); } catch { return false; }
    const position = renderMarkdownState(view.state).anchors.get(id);
    if (position === undefined) return false;
    view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: "start" }), userEvent: "select" });
    return true;
  }
  if (route.kind === "path") {
    if (!callbacks.openPath || route.path === "") return false;
    callbacks.openPath(route.path);
    return true;
  }
  if (route.kind === "web") openWebLink(href, false);
  else window.open(href, "_blank", "noopener,noreferrer");
  return true;
}

/// Il wikilink della Scrittura sotto il puntatore (una decorazione del testo,
/// non un blocco reso: quelli li apre la resa, `mount.ts`), letto dagli
/// attributi che la Scrittura gli dà.
function wikilinkUnder(view: EditorView, event: MouseEvent): { page: string; heading: string | null; block: string | null } | null {
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest<HTMLElement>(".cm-fub-wikilink[data-wikilink-page]");
  if (!link || !view.contentDOM.contains(link) || link.closest(".cm-markdown-block")) return null;
  return {
    page: link.dataset.wikilinkPage ?? "",
    heading: link.dataset.wikilinkHeading ?? null,
    block: link.dataset.wikilinkBlock ?? null,
  };
}

export function openLinkKeymap(callbacks: LivePreviewCallbacks): Extension {
  return [
    Prec.high(keymap.of([{
      key: "Alt-Enter",
      run(view: EditorView) {
        const main = view.state.selection.main;
        const found = linkAt(view.state, main.head);
        if (!found) return false;
        if (found.kind === "wikilink") {
          void followWikilink(callbacks, found.page, found.heading, found.block, "peek");
          return true;
        }
        return followHref(view, found.href, callbacks);
      },
    }])),
    // Il `mousedown` e non il `click`: il cursore non deve spostarsi né
    // aggiungere una seconda selezione (Ctrl col clic, in CodeMirror) sul link
    // che si sta seguendo.
    Prec.high(EditorView.domEventHandlers({
      mousedown(event, view) {
        if (event.button !== 0 || event.shiftKey) return false;
        const mod = event.ctrlKey || event.metaKey;
        if (mod === event.altKey) return false;
        const link = wikilinkUnder(view, event);
        if (!link) return false;
        event.preventDefault();
        void followWikilink(callbacks, link.page, link.heading, link.block, event.altKey ? "peek" : "click");
        return true;
      },
    })),
  ];
}
