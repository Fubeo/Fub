// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { cursorCharLeft, cursorCharRight, deleteCharBackward, history, undo } from "@codemirror/commands";
import { markdownGrammar } from "../grammar";
import { livePreview } from "../livepreview";
import { liveReveal, type RevealPolicy } from "../../../live-reveal";
import { clipboardHtml } from "../copy-html";
import { renderMarkdown } from "../render";
import { markdownFromClipboard } from "../paste";
import { elementsTouching } from "../format-toggle";
import { copiedMarkdown } from "./copy";
import { commentSource } from "./source";

// I commenti in Scrittura, nella vista vera: i segni non si vedono, il cursore
// li salta, scrivere nel passo è scrivere nella nota, e cancellare tutto il
// passo toglie il commento con un avviso che sa annullare.

const notices = vi.hoisted(() => ({ calls: [] as { message: string; action: { label: string; run: () => void } }[] }));
vi.mock("../../../../../ui/notify", () => ({
  notify: (message: string, _tone: string, action: { label: string; run: () => void }) => notices.calls.push({ message, action }),
}));
vi.mock("mermaid", () => ({
  default: { initialize() {}, render: async () => ({ svg: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>" }) },
}));

const views: EditorView[] = [];
beforeEach(() => {
  notices.calls.length = 0;
});
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.innerHTML = "";
});

const NOTE = "Il {==passo==}{>>@Anna 2026-11-08: va riscritto<<} poi.\n\nAltro.\n";
const OPEN = NOTE.indexOf("{==");
const FROM = OPEN + 3;
const TO = NOTE.indexOf("==}");
const END = NOTE.indexOf(" poi");

function liveView(doc: string, anchor: number, policy: RevealPolicy = "mai", head = anchor): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(anchor, head),
      extensions: [history(), markdown({ base: markdownGrammar }), Prec.highest(liveReveal.of(policy)), livePreview({ openWikilink() {}, searchTag() {} })],
    }),
  });
  views.push(view);
  if (ensureSyntaxTree(view.state, view.state.doc.length, 10_000)) view.dispatch({});
  return view;
}

/// Il testo che si vede nella riga del commento.
function visibleLine(view: EditorView): string {
  return view.contentDOM.querySelector(".cm-line")!.textContent ?? "";
}

describe("i commenti in Scrittura", () => {
  it("i segni e i messaggi non si vedono, il passo ha il fondo del commento", () => {
    const view = liveView(NOTE, NOTE.length);
    expect(visibleLine(view)).toBe("Il passo poi.");
    const range = view.contentDOM.querySelector(".cm-fub-comment-range");
    expect(range?.textContent).toBe("passo");
    expect(range?.classList.contains("cm-fub-comment-range-on")).toBe(false);
  });

  it("col cursore dentro il passo il fondo è più pieno, e i segni restano nascosti", () => {
    const view = liveView(NOTE, FROM + 2);
    expect(view.contentDOM.querySelector(".cm-fub-comment-range-on")?.textContent).toBe("passo");
    expect(visibleLine(view)).toBe("Il passo poi.");
  });

  it("con la rivelazione per riga i segni si vedono sulla riga del cursore", () => {
    const view = liveView(NOTE, FROM + 2, "riga");
    expect(visibleLine(view)).toBe(NOTE.slice(0, NOTE.indexOf("\n")));
    expect(view.contentDOM.querySelector(".cm-fub-comment")?.textContent).toBe("{>>@Anna 2026-11-08: va riscritto<<}");
  });

  it("il cursore salta un segno nascosto come un pezzo solo", () => {
    const view = liveView(NOTE, TO);
    cursorCharRight(view);
    expect(view.state.selection.main.head).toBe(END);
    cursorCharLeft(view);
    expect(view.state.selection.main.head).toBe(TO);
    const before = liveView(NOTE, OPEN);
    cursorCharRight(before);
    expect(before.state.selection.main.head).toBe(FROM);
  });

  it("scrivere nel passo è scrivere nella nota, e il commento resta", () => {
    const view = liveView(NOTE, FROM + 2);
    view.dispatch(view.state.replaceSelection("XY"), { userEvent: "input.type" });
    expect(view.state.doc.toString()).toBe(NOTE.replace("passo", "paXYsso"));
    expect(view.contentDOM.querySelector(".cm-fub-comment-range")?.textContent).toBe("paXYsso");
    expect(notices.calls).toEqual([]);
  });

  it("cancellare tutto il passo toglie il commento, e «Annulla» lo rimette", () => {
    const view = liveView(NOTE, FROM, "mai", TO);
    deleteCharBackward(view);
    expect(view.state.doc.toString()).toBe("Il  poi.\n\nAltro.\n");
    expect(notices.calls).toHaveLength(1);
    expect(notices.calls[0]!.message).toMatch(/commento/i);
    notices.calls[0]!.action.run();
    expect(view.state.doc.toString()).toBe(NOTE);
  });

  it("dopo la cancellazione un solo annullamento rimette testo e commento", () => {
    const view = liveView(NOTE, FROM, "mai", TO);
    deleteCharBackward(view);
    undo(view);
    expect(view.state.doc.toString()).toBe(NOTE);
  });

  it("se il testo è cambiato dopo, «Annulla» rimette i messaggi sul punto senza toccare il resto", () => {
    const view = liveView(NOTE, FROM, "mai", TO);
    deleteCharBackward(view);
    view.dispatch({ changes: { from: view.state.doc.length, insert: "Nuovo" }, userEvent: "input.type" });
    notices.calls[0]!.action.run();
    expect(view.state.doc.toString()).toBe("Il {>>@Anna 2026-11-08: va riscritto<<} poi.\n\nAltro.\nNuovo");
  });

  it("cancellare il passo un carattere alla volta lo toglie all'ultimo", () => {
    const view = liveView("{==ab==}{>>m<<}\n", 5);
    deleteCharBackward(view);
    expect(view.state.doc.toString()).toBe("{==a==}{>>m<<}\n");
    expect(notices.calls).toEqual([]);
    deleteCharBackward(view);
    expect(view.state.doc.toString()).toBe("\n");
    expect(notices.calls).toHaveLength(1);
  });

  it("una selezione che prende un segno nascosto cancella il testo e lascia il commento", () => {
    // Da «Il » fino a metà del passo: dentro c'è `{==`, che non si vede.
    const view = liveView(NOTE, 1, "mai", FROM + 2);
    deleteCharBackward(view);
    expect(view.state.doc.toString()).toBe("I{==sso==}{>>@Anna 2026-11-08: va riscritto<<} poi.\n\nAltro.\n");
  });

  it("una modifica che arriva da fuori non tocca i commenti", () => {
    const view = liveView(NOTE, NOTE.length);
    view.dispatch({ changes: { from: FROM, to: TO } });
    expect(view.state.doc.toString()).toBe(NOTE.replace("passo", ""));
    expect(notices.calls).toEqual([]);
  });
});

describe("i commenti fra gli elementi in riga", () => {
  it("`{==passo==}` non è un evidenziato, né per la Live né per i gesti di formato", () => {
    const view = liveView(NOTE, NOTE.length);
    expect(view.contentDOM.querySelector(".cm-fub-highlight")).toBeNull();
    expect(elementsTouching(view.state, FROM, TO, "highlight")).toEqual([]);
    // Un evidenziato vero dentro il passo resta un evidenziato.
    const inside = liveView("{==a ==b== c==}{>>m<<}\n", 0);
    expect(elementsTouching(inside.state, 7, 8, "highlight")).toHaveLength(1);
  });

  it("in Sorgente si vede tutto, e il commento ha il suo colore", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({ parent, state: EditorState.create({ doc: NOTE, extensions: [markdown({ base: markdownGrammar }), commentSource()] }) });
    views.push(view);
    if (ensureSyntaxTree(view.state, view.state.doc.length, 10_000)) view.dispatch({});
    expect(visibleLine(view)).toBe(NOTE.slice(0, NOTE.indexOf("\n")));
    expect(view.contentDOM.querySelector(".cm-fub-comment-source")?.textContent).toBe(NOTE.slice(OPEN, END));
  });
});

describe("copiare e incollare i commenti", () => {
  it("il passo copiato da solo è testo, il commento intero resta Markdown", () => {
    const view = liveView(NOTE, 0);
    expect(copiedMarkdown(view.state, FROM, TO)).toBe("passo");
    // La selezione che prende anche la coda nascosta, fino a « poi».
    expect(copiedMarkdown(view.state, FROM, END + 4)).toBe("passo poi");
    expect(copiedMarkdown(view.state, 0, END)).toBe(NOTE.slice(0, END));
  });

  it("l'HTML che va fuori da Fub non ha né segni né messaggi", () => {
    const html = clipboardHtml(NOTE.slice(0, END + 5));
    expect(html).toBe("<p>Il passo poi.</p>");
  });

  it("un testo con dei commenti incollato da Fub resta Markdown", async () => {
    const plain = NOTE.slice(0, END);
    const data = { getData: (type: string) => (type === "text/plain" ? plain : type === "text/html" ? "<p>Il passo</p>" : "") } as DataTransfer;
    expect(await markdownFromClipboard(data)).toBeNull();
  });
});

describe("i commenti in Lettura", () => {
  it("il passo ha il fondo, i segni e i messaggi non ci sono", () => {
    const html = renderMarkdown(NOTE).html;
    expect(html).toContain(`<mark class="comment-range" data-md-from="${FROM}" data-md-to="${TO}"><span data-md-from="${FROM}" data-md-to="${TO}">passo</span></mark>`);
    expect(html).not.toContain("riscritto");
    expect(html).not.toContain("{==");
  });

  it("un commento su un punto non lascia niente, e il titolo non porta il messaggio", () => {
    const html = renderMarkdown("# Titolo {==t==}{>>@Anna: sul titolo<<}\n\nQui {>>nota<<} e basta.\n").html;
    expect(html).not.toContain("sul titolo");
    expect(html).not.toContain("nota");
    expect(html).toMatch(/<h1[^>]*id="[^"]*titolo-t"/);
  });

  it("senza la sintassi dei commenti i segni sono testo", () => {
    expect(renderMarkdown(NOTE, []).html).toContain("riscritto");
  });
});
