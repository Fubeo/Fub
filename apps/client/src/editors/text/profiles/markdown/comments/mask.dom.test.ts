// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap, runScopeHandlers } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { cursorCharLeft, cursorCharRight, defaultKeymap, deleteCharBackward, history, undo } from "@codemirror/commands";
import { getCM, vim, Vim } from "@replit/codemirror-vim";
import { markdownGrammar } from "../grammar";
import { livePreview } from "../livepreview";
import { liveReveal, type RevealPolicy } from "../../../live-reveal";
import { clipboardHtml } from "../copy-html";
import { renderMarkdown } from "../render";
import { markdownFromClipboard } from "../paste";
import { elementsTouching, toggleFormat } from "../format-toggle";
import { obsidianKeymap } from "../commands";
import { copiedMarkdown } from "./copy";
import { commentSource } from "./source";
import { parsedView } from "../test-support";

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
  parsedView(view);
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

  it("tagliare tutto il passo dice che il commento è andato col testo, e «Annulla» lo rimette", () => {
    const view = liveView(NOTE, FROM, "mai", TO);
    view.dispatch(view.state.replaceSelection(""), { userEvent: "delete.cut" });
    expect(view.state.doc.toString()).toBe("Il  poi.\n\nAltro.\n");
    expect(notices.calls).toHaveLength(1);
    expect(notices.calls[0]!.message).toMatch(/tagliato/i);
    expect(notices.calls[0]!.action.label).toBe("Annulla");
    notices.calls[0]!.action.run();
    expect(view.state.doc.toString()).toBe(NOTE);
  });

  it("una modifica che arriva da fuori non tocca i commenti", () => {
    const view = liveView(NOTE, NOTE.length);
    view.dispatch({ changes: { from: FROM, to: TO } });
    expect(view.state.doc.toString()).toBe(NOTE.replace("passo", ""));
    expect(notices.calls).toEqual([]);
  });
});

/// Una vista di Scrittura coi tasti di Fub, più cursori e, a richiesta, Vim.
function keyedView(doc: string, selection: EditorSelection, extra: Extension[] = []): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection,
      extensions: [
        ...extra,
        EditorState.allowMultipleSelections.of(true),
        history(),
        markdown({ base: markdownGrammar }),
        Prec.highest(liveReveal.of("mai")),
        livePreview({ openWikilink() {}, searchTag() {} }),
        keymap.of(obsidianKeymap),
        keymap.of(defaultKeymap),
      ],
    }),
  });
  views.push(view);
  parsedView(view);
  return view;
}

function press(view: EditorView, key: string, modifiers: { ctrlKey?: boolean; shiftKey?: boolean } = {}): void {
  runScopeHandlers(view, new KeyboardEvent("keydown", { key, ...modifiers }), "editor");
}

const TWO = `${NOTE}Ancora {==bis==}{>>@B: x<<} qui.\n`;
const OPEN2 = TWO.indexOf("{==bis");
const FROM2 = OPEN2 + 3;

describe("i gesti che attraversano i segni nascosti", () => {
  it("con più cursori, cancellare o scrivere su un segno nascosto lascia ogni commento intero", () => {
    const ranges = () => EditorSelection.create([EditorSelection.range(1, FROM + 2), EditorSelection.range(OPEN2 - 2, FROM2 + 1)]);
    const erased = keyedView(TWO, ranges());
    press(erased, "Backspace");
    expect(erased.state.doc.toString()).toBe("I{==sso==}{>>@Anna 2026-11-08: va riscritto<<} poi.\n\nAltro.\nAncor{==is==}{>>@B: x<<} qui.\n");
    expect(erased.state.selection.ranges.map((range) => range.head)).toEqual([1, erased.state.doc.toString().indexOf("{==is")]);
    const typed = keyedView(TWO, ranges());
    typed.dispatch(typed.state.replaceSelection("Z"), { userEvent: "input.type" });
    expect(typed.state.doc.toString()).toBe("IZ{==sso==}{>>@Anna 2026-11-08: va riscritto<<} poi.\n\nAltro.\nAncorZ{==is==}{>>@B: x<<} qui.\n");
    expect(typed.state.selection.ranges.every((range) => typed.state.sliceDoc(range.head - 1, range.head) === "Z")).toBe(true);
    expect(notices.calls).toEqual([]);
  });

  it("trascinare un tratto che prende un segno nascosto lo sposta senza il segno", () => {
    const view = keyedView(TWO, EditorSelection.single(0));
    const at = TWO.indexOf("qui");
    // Il testo grezzo, come lo darebbe un motore che non passa dal filtro.
    view.dispatch({ changes: [{ from: 1, to: FROM + 2 }, { from: at, insert: TWO.slice(1, FROM + 2) }], selection: EditorSelection.single(at - FROM - 1, at), userEvent: "move.drop" });
    const doc = view.state.doc.toString();
    expect(doc).toBe("I{==sso==}{>>@Anna 2026-11-08: va riscritto<<} poi.\n\nAltro.\nAncora {==bis==}{>>@B: x<<} l paqui.\n");
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("l pa");
  });

  it("trascinare tutto il passo altrove toglie il commento con l'avviso, e Annulla rimette tutto", () => {
    const view = keyedView(TWO, EditorSelection.single(0));
    const at = TWO.indexOf("qui");
    view.dispatch({ changes: [{ from: FROM, to: TO }, { from: at, insert: "passo " }], userEvent: "move.drop" });
    expect(view.state.doc.toString()).toBe(TWO.replace("{==passo==}{>>@Anna 2026-11-08: va riscritto<<}", "").replace("qui", "passo qui"));
    expect(notices.calls).toHaveLength(1);
    undo(view);
    expect(view.state.doc.toString()).toBe(TWO);
  });

  it("Mod-Backspace dopo un commento e Mod-Canc prima arrivano alla parola che si vede", () => {
    const back = keyedView(NOTE, EditorSelection.single(END));
    press(back, "Backspace", { ctrlKey: true });
    expect(back.state.doc.toString()).toBe("Il  poi.\n\nAltro.\n");
    expect(notices.calls).toHaveLength(1);
    const forward = keyedView(NOTE, EditorSelection.single(OPEN));
    press(forward, "Delete", { ctrlKey: true });
    expect(forward.state.doc.toString()).toBe("Il  poi.\n\nAltro.\n");
    // Lontano dai segni la parola è quella di sempre.
    const plain = keyedView(NOTE, EditorSelection.single(NOTE.indexOf("\n\nAltro") + 7));
    press(plain, "Backspace", { ctrlKey: true });
    expect(plain.state.doc.toString()).toBe(NOTE.replace("Altro", ""));
  });

  it("Mod-Backspace accanto a un grassetto nascosto porta via la parola e i suoi segni", () => {
    const doc = "Un **forte** qui\n";
    const view = keyedView(doc, EditorSelection.single(doc.indexOf(" qui")));
    press(view, "Backspace", { ctrlKey: true });
    expect(view.state.doc.toString()).toBe("Un  qui\n");
  });

  it("Mod-d su una riga con un commento la copia intera, commento compreso", () => {
    const view = keyedView(NOTE, EditorSelection.single(FROM + 2));
    press(view, "d", { ctrlKey: true });
    const line = NOTE.slice(0, NOTE.indexOf("\n"));
    expect(view.state.doc.toString()).toBe(`${line}\n${NOTE}`);
    expect(view.contentDOM.querySelectorAll(".cm-fub-comment-range")).toHaveLength(2);
  });

  it("Vim non rompe i segni: x, dw, diw e l", () => {
    const vimView = (anchor: number) => {
      const view = keyedView(NOTE, EditorSelection.single(anchor), [vim()]);
      const cm = getCM(view)!;
      Vim.handleKey(cm, "<Esc>", "user");
      return { view, keys: (...keys: string[]) => keys.forEach((key) => Vim.handleKey(cm, key, "user")) };
    };
    // `l` dall'ultima lettera del passo non entra nella coda, `x` lì non tocca segni.
    const edge = vimView(TO - 1);
    edge.keys("l", "l", "x");
    expect(edge.view.state.doc.toString()).toBe(NOTE);
    // `x` sull'ultima lettera la toglie, e il commento resta.
    const last = vimView(TO - 1);
    last.keys("x");
    expect(last.view.state.doc.toString()).toBe(NOTE.replace("passo", "pass"));
    // `dw` e `diw` sulla parola del passo lo svuotano: il commento se ne va con l'avviso.
    for (const keys of [["d", "w"], ["d", "i", "w"]]) {
      notices.calls.length = 0;
      const word = vimView(FROM);
      word.keys(...keys);
      expect(word.view.state.doc.toString()).toBe("Il  poi.\n\nAltro.\n");
      expect(notices.calls).toHaveLength(1);
      undo(word.view);
      expect(word.view.state.doc.toString()).toBe(NOTE);
    }
  });
});

describe("i gesti di formato su un commento", () => {
  it("un tratto che taglia un commento si allarga al commento intero, nei due versi", () => {
    const tail = "{==passo==}{>>@Anna 2026-11-08: va riscritto<<}";
    const forward = keyedView(NOTE, EditorSelection.single(0, TO));
    expect(toggleFormat("strong")(forward)).toBe(true);
    expect(forward.state.doc.toString()).toBe(NOTE.replace(`Il ${tail}`, `**Il ${tail}**`));
    const backward = keyedView(NOTE, EditorSelection.single(END + 4, FROM));
    expect(toggleFormat("strong")(backward)).toBe(true);
    expect(backward.state.doc.toString()).toBe(NOTE.replace(`${tail} poi`, `**${tail} poi**`));
    // Il passo da solo si formatta dentro i segni.
    const inside = keyedView(NOTE, EditorSelection.single(FROM, TO));
    expect(toggleFormat("strong")(inside)).toBe(true);
    expect(inside.state.doc.toString()).toBe(NOTE.replace("passo", "**passo**"));
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
    parsedView(view);
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
