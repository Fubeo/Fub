// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { history, redo, undo, undoDepth } from "@codemirror/commands";
import { markdownGrammar } from "../grammar";
import { livePreview } from "../livepreview";
import { renderMarkdown } from "../render";
import { forgetSigner } from "./author";
import { markdownComments, type MarkdownComments } from "./discussions";

// I gesti dei commenti sulla vista vera: il primo messaggio, la risposta,
// Risolvi, Elimina, «Svuota i risolti», ciascuno un passo d'annullamento; il
// nome chiesto al primo commento; la nota cambiata da fuori; la sola lettura.

const notices = vi.hoisted(() => ({ calls: [] as { message: string; action?: { label: string; run: () => void } }[] }));
vi.mock("../../../../../ui/notify", () => ({
  notify: (message: string, _tone: string, action?: { label: string; run: () => void }) => notices.calls.push({ message, action }),
}));
const store = vi.hoisted(() => ({ name: "Anna Bianchi", mode: "nome", saved: [] as [string, unknown][], fail: false }));
vi.mock("../../../../../host/query", () => ({
  settings: async () => [
    { spec: { key: "profile.name" }, value: store.name },
    { spec: { key: "comments.author" }, value: store.mode },
  ],
}));
vi.mock("../../../../../host/ipc", () => ({
  api: {
    setSetting: async (key: string, value: unknown) => {
      if (store.fail) throw new Error("disco pieno");
      store.saved.push([key, value]);
      if (key === "profile.name") store.name = String(value);
    },
  },
}));
vi.mock("mermaid", () => ({
  default: { initialize() {}, render: async () => ({ svg: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>" }) },
}));

interface Harness {
  view: EditorView;
  comments: MarkdownComments;
  reading: HTMLElement;
  setReadOnly(value: boolean): void;
  setMode(mode: "source" | "live_preview" | "reading"): void;
}

const mounted: Harness[] = [];

function mount(doc: string, from = 0, to = from): Harness {
  const parent = document.createElement("div");
  const reading = document.createElement("div");
  document.body.append(parent, reading);
  let readOnly = false;
  let mode: "source" | "live_preview" | "reading" = "live_preview";
  let view: EditorView | null = null;
  const comments = markdownComments({
    forms: () => undefined,
    mode: () => mode,
    readOnly: () => readOnly,
    withView: (run) => (view ? run(view) : null),
    reading: () => reading,
    focus: () => view?.focus(),
  });
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(from, to),
      extensions: [history(), markdown({ base: markdownGrammar }), livePreview({ openWikilink() {}, searchTag() {} }), comments.extension()],
    }),
  });
  if (ensureSyntaxTree(view.state, view.state.doc.length, 10_000)) view.dispatch({});
  const harness: Harness = {
    view,
    comments,
    reading,
    setReadOnly: (value) => { readOnly = value; },
    setMode: (next) => { mode = next; },
  };
  mounted.push(harness);
  return harness;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const popover = () => document.querySelector<HTMLElement>(".cm-fub-comment-popover");
/// L'ultimo avviso.
const last = () => notices.calls[notices.calls.length - 1]!;

/// Scrive nel campo del riquadro aperto e invia con Mod-Invio.
function typeAndSend(text: string): void {
  const input = popover()!.querySelector<HTMLTextAreaElement>(".cm-fub-comment-input")!;
  input.value = text;
  input.dispatchEvent(new Event("input"));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
}

function press(label: string): void {
  const button = [...popover()!.querySelectorAll<HTMLButtonElement>("button")].find((each) => each.textContent === label);
  if (!button) throw new Error(`nessun pulsante «${label}»`);
  button.click();
}

/// La data scritta nel file, al posto di quella di adesso.
const dated = (text: string) => text.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/g, "DATA");

beforeEach(() => {
  notices.calls.length = 0;
  store.name = "Anna Bianchi";
  store.mode = "nome";
  store.saved.length = 0;
  store.fail = false;
  forgetSigner();
});
afterEach(() => {
  for (const each of mounted.splice(0)) {
    each.comments.destroy();
    each.view.destroy();
  }
  document.body.innerHTML = "";
});

describe("il primo messaggio", () => {
  it("scrive il commento sulla selezione, firmato col nome, in un passo d'annullamento", async () => {
    const doc = "Un paragrafo da commentare.\n";
    const { view, comments } = mount(doc, 3, 12);
    expect(comments.comment()).toBe(true);
    await settle();
    expect(popover()!.querySelector(".cm-fub-comment-quote")!.textContent).toBe("paragrafo");
    // Il passo che si commenta resta acceso mentre si scrive.
    expect(view.contentDOM.querySelector(".cm-fub-comment-range-on")?.textContent).toBe("paragrafo");
    typeAndSend("Da rivedere");
    expect(dated(view.state.doc.toString())).toBe("Un {==paragrafo==}{>>@Anna Bianchi DATA: Da rivedere<<} da commentare.\n");
    expect(popover()).toBeNull();
    expect(undoDepth(view.state)).toBe(1);
    undo(view);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("senza nome lo chiede, avvisa che finisce nel file e lo salva nelle Impostazioni", async () => {
    store.name = "";
    const { view, comments } = mount("Un paragrafo.\n", 3, 12);
    comments.comment();
    await settle();
    expect(popover()!.textContent).toContain("Il nome finisce nel file della nota");
    const name = popover()!.querySelector<HTMLInputElement>(".kit-field-input")!;
    expect(document.activeElement).toBe(name);
    name.value = "Luca Ferri";
    typeAndSend("Ok");
    await settle();
    expect(dated(view.state.doc.toString())).toBe("Un {==paragrafo==}{>>@Luca Ferri DATA: Ok<<}.\n");
    expect(store.saved).toEqual([["profile.name", "Luca Ferri"]]);
  });

  it("un nome che non si salva lo dice, e il commento lo porta lo stesso", async () => {
    store.name = "";
    store.fail = true;
    const { view, comments } = mount("Un paragrafo.\n", 3, 12);
    comments.comment();
    await settle();
    popover()!.querySelector<HTMLInputElement>(".kit-field-input")!.value = "Luca";
    typeAndSend("Ok");
    await settle();
    expect(dated(view.state.doc.toString())).toContain("{>>@Luca DATA: Ok<<}");
    expect(last().message).toContain("disco pieno");
  });

  it("con la firma «niente» il messaggio non ha autore e il nome non si chiede", async () => {
    store.name = "";
    store.mode = "niente";
    const { view, comments } = mount("Un paragrafo.\n", 3, 12);
    comments.comment();
    await settle();
    expect(popover()!.querySelector(".kit-field-input")).toBeNull();
    typeAndSend("Anonimo");
    expect(dated(view.state.doc.toString())).toBe("Un {==paragrafo==}{>>DATA: Anonimo<<}.\n");
  });

  it("con la firma «iniziali» scrive le iniziali", async () => {
    store.mode = "iniziali";
    const { view, comments } = mount("Un paragrafo.\n", 3, 12);
    comments.comment();
    await settle();
    typeAndSend("Ok");
    expect(dated(view.state.doc.toString())).toBe("Un {==paragrafo==}{>>@AB DATA: Ok<<}.\n");
  });

  it("una selezione su più blocchi diventa un commento nel primo, e il riquadro lo dice", async () => {
    const doc = "Primo blocco.\n\nSecondo blocco.\n";
    const { view, comments } = mount(doc, 6, doc.indexOf("Secondo") + 7);
    comments.comment();
    await settle();
    expect(popover()!.querySelector(".cm-fub-comment-note")!.textContent).toContain("più blocchi");
    typeAndSend("Uno");
    expect(dated(view.state.doc.toString())).toBe("Primo {==blocco.==}{>>@Anna Bianchi DATA: Uno<<}\n\nSecondo blocco.\n");
  });

  it("nel codice il commento va su un punto dopo il blocco, e il riquadro lo dice", async () => {
    const doc = "```js\nlet a = 1;\n```\n";
    const { view, comments } = mount(doc, 8, 12);
    comments.comment();
    await settle();
    expect(popover()!.querySelector(".cm-fub-comment-note")!.textContent).toContain("Nel codice");
    typeAndSend("Perché 1?");
    expect(dated(view.state.doc.toString())).toBe("```js\nlet a = 1;\n```\n\n{>>@Anna Bianchi DATA: Perché 1?<<}\n");
  });

  it("chiuso senza inviare non scrive niente", async () => {
    const doc = "Un paragrafo.\n";
    const { view, comments } = mount(doc, 3, 12);
    comments.comment();
    await settle();
    popover()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle();
    expect(view.state.doc.toString()).toBe(doc);
    expect(view.contentDOM.querySelector(".cm-fub-comment-range-on")).toBeNull();
  });

  it("il testo cambiato mentre si scrive: il commento va sul passo, dov'è adesso", async () => {
    const { view, comments } = mount("Un paragrafo.\n", 3, 12);
    comments.comment();
    await settle();
    view.dispatch({ changes: { from: 0, insert: "Prima. " } });
    typeAndSend("Ok");
    expect(dated(view.state.doc.toString())).toBe("Prima. Un {==paragrafo==}{>>@Anna Bianchi DATA: Ok<<}.\n");
  });
});

describe("la discussione", () => {
  const NOTE = "Il {==passo==}{>>@Anna Bianchi 2026-11-08 17:40: Va riscritto.<<}{>>@Luca Ferri 2026-11-09 09:12: Sì.<<} poi.\n";
  const ANCHOR = NOTE.indexOf("passo");

  it("mostra la citazione e i messaggi; la risposta si accoda, un passo d'annullamento", async () => {
    const { view, comments } = mount(NOTE, 0);
    comments.open(ANCHOR);
    await settle();
    const box = popover()!;
    expect(box.querySelector(".cm-fub-comment-quote")!.textContent).toBe("passo");
    expect([...box.querySelectorAll(".cm-fub-comment-message b")].map((b) => b.firstChild!.textContent)).toEqual(["Anna", "Luca"]);
    expect([...box.querySelectorAll(".cm-fub-comment-message .cm-fub-comment-avatar")].map((a) => a.textContent)).toEqual(["AB", "LF"]);
    typeAndSend("Fatto");
    expect(dated(view.state.doc.toString())).toBe(dated(NOTE).replace("Sì.<<}", "Sì.<<}{>>@Anna Bianchi DATA: Fatto<<}"));
    // La discussione aperta segue il testo: il messaggio nuovo è lì.
    expect(popover()!.querySelectorAll(".cm-fub-comment-message")).toHaveLength(3);
    expect(undoDepth(view.state)).toBe(1);
  });

  it("Risolvi toglie i segni, archivia in fondo, e Annulla torna indietro di un passo", async () => {
    const { view, comments } = mount(NOTE, 0);
    comments.open(ANCHOR);
    await settle();
    press("Risolvi");
    expect(dated(view.state.doc.toString())).toBe(
      "Il passo poi.\n\n%%fub:risolto DATA: passo%%\n%%> @Anna Bianchi DATA: Va riscritto.%%\n%%> @Luca Ferri DATA: Sì.%%\n",
    );
    expect(popover()).toBeNull();
    expect(undoDepth(view.state)).toBe(1);
    const notice = last();
    expect(notice.message).toContain("Risolto");
    notice.action!.run();
    expect(view.state.doc.toString()).toBe(NOTE);
    redo(view);
    expect(view.state.doc.toString()).toContain("%%fub:risolto");
  });

  it("Annulla dopo altre modifiche toglie soltanto il gesto", async () => {
    const { view, comments } = mount(NOTE, 0);
    comments.open(ANCHOR);
    await settle();
    press("Elimina");
    expect(view.state.doc.toString()).toBe("Il passo poi.\n");
    view.dispatch({ changes: { from: 0, insert: "Ecco. " } });
    last().action!.run();
    expect(view.state.doc.toString()).toBe(`Ecco. ${NOTE}`);
  });

  it("Risolvi con la nota cambiata da fuori risolve il commento dov'è adesso", async () => {
    const { view, comments } = mount(NOTE, 0);
    comments.open(ANCHOR);
    await settle();
    // Un'altra superficie, il disco: testo nuovo prima del commento e una
    // risposta arrivata nel frattempo.
    view.dispatch({ changes: [{ from: 0, insert: "Titolo nuovo.\n\n" }, { from: NOTE.indexOf(" poi"), insert: "{>>@Bea: anche io<<}" }] });
    expect(popover()!.querySelectorAll(".cm-fub-comment-message")).toHaveLength(3);
    press("Risolvi");
    const out = dated(view.state.doc.toString());
    expect(out.startsWith("Titolo nuovo.\n\nIl passo poi.\n\n%%fub:risolto DATA: passo%%\n")).toBe(true);
    expect(out).toContain("%%> @Bea: anche io%%");
  });

  it("il commento tolto da fuori chiude la discussione e lo dice", async () => {
    const { view, comments } = mount(NOTE, 0);
    comments.open(ANCHOR);
    await settle();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "Riscritta da un'altra parte.\n" } });
    expect(popover()).toBeNull();
    expect(last().message).toContain("non c'è più");
  });

  it("le modifiche che spostano, tagliano o raddoppiano il testo commentato", async () => {
    const { view, comments } = mount(NOTE, 0);
    // Spostato: un paragrafo nuovo prima.
    view.dispatch({ changes: { from: 0, insert: "Nuovo.\n\n" } });
    expect(comments.snapshot().open.map((each) => each.quote)).toEqual(["passo"]);
    // Raddoppiato: la stessa riga incollata sotto.
    view.dispatch({ changes: { from: view.state.doc.length, insert: `\n${NOTE}` } });
    ensureSyntaxTree(view.state, view.state.doc.length, 5_000);
    expect(comments.snapshot().open.map((each) => each.quote)).toEqual(["passo", "passo"]);
    // Tagliato: via tutto il secondo paragrafo, commento compreso.
    const second = view.state.doc.toString().lastIndexOf("Il {==");
    view.dispatch({ changes: { from: second, to: view.state.doc.length } });
    ensureSyntaxTree(view.state, view.state.doc.length, 5_000);
    expect(comments.snapshot().open).toHaveLength(1);
    // La discussione si apre ancora dal passo, dov'è adesso.
    comments.open(view.state.doc.toString().indexOf("passo"));
    await settle();
    expect(popover()!.querySelector(".cm-fub-comment-quote")!.textContent).toBe("passo");
  });

  it("in sola lettura si legge, non si scrive", async () => {
    const harness = mount(NOTE, 0);
    harness.setReadOnly(true);
    harness.comments.open(ANCHOR);
    await settle();
    const box = popover()!;
    expect(box.querySelectorAll(".cm-fub-comment-message")).toHaveLength(2);
    expect(box.querySelector(".cm-fub-comment-input")).toBeNull();
    expect(box.querySelector(".cm-fub-comment-action")).toBeNull();
    // E un commento nuovo non si scrive: lo dice.
    harness.view.dispatch({ selection: { anchor: NOTE.indexOf("poi"), head: NOTE.indexOf("poi") + 3 } });
    expect(harness.comments.canComment()).toBe(false);
    harness.comments.comment();
    expect(last().message).toContain("sola lettura");
    expect(harness.view.state.doc.toString()).toBe(NOTE);
  });
});

describe("«Svuota i risolti»", () => {
  it("toglie l'archivio con un passo d'annullamento", () => {
    const doc = "Testo.\n\n%%fub:risolto 2026-11-16 14:02: q%%\n%%> @A: m%%\n";
    const { view, comments } = mount(doc, 0);
    expect(comments.snapshot().resolved).toHaveLength(1);
    comments.clearResolved();
    expect(view.state.doc.toString()).toBe("Testo.\n");
    expect(comments.snapshot().resolved).toHaveLength(0);
    last().action!.run();
    expect(view.state.doc.toString()).toBe(doc);
  });
});

describe("il margine", () => {
  const NOTE = "Il {==passo==}{>>@Anna Bianchi 2026-11-08 17:40: Va riscritto.<<}{>>@Luca: Sì.<<} poi.\n\nAltro {>>senza nome<<}.\n";

  it("quando non ha posto il segno sta nel testo: iniziali di chi ha cominciato e numero dei messaggi", async () => {
    const { view } = mount(NOTE, NOTE.length);
    view.contentDOM.style.paddingRight = "20px";
    view.requestMeasure();
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await settle();
    const signs = [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-fub-comment-sign")];
    expect(signs.map((sign) => sign.textContent)).toEqual(["AB2", "?1"]);
    expect(signs[0]!.getAttribute("aria-label")).toBe("Commento di Anna Bianchi: 2 messaggi");
    expect(signs[1]!.getAttribute("aria-label")).toBe("Commento di Senza nome: 1 messaggio");
    signs[0]!.click();
    await settle();
    expect(popover()!.querySelector(".cm-fub-comment-quote")!.textContent).toBe("passo");
  });

  it("col margine il segno è un pulsante accanto alla pagina, acceso con la discussione aperta", async () => {
    const { view, comments } = mount(NOTE, NOTE.length);
    view.contentDOM.style.paddingRight = "96px";
    view.requestMeasure();
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const margin = view.scrollDOM.querySelector<HTMLElement>(".cm-fub-comment-margin")!;
    const bubbles = [...margin.querySelectorAll<HTMLElement>(".cm-fub-comment-bubble")];
    expect(bubbles.map((bubble) => bubble.textContent)).toEqual(["AB2", "?1"]);
    expect(view.contentDOM.querySelector(".cm-fub-comment-sign")).toBeNull();
    comments.open(Number(bubbles[0]!.dataset.anchor));
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(margin.querySelector("[data-active]")?.textContent).toBe("AB2");
  });

  it("l'archivio in fondo non si vede in Scrittura; col cursore dentro torna", () => {
    const doc = "Testo.\n\n%%fub:risolto 2026-11-16 14:02: q%%\n%%> @A: m%%\n";
    const { view } = mount(doc, 0);
    const shown = () => view.contentDOM.textContent ?? "";
    expect(shown()).not.toContain("fub:risolto");
    expect(view.contentDOM.querySelectorAll(".cm-line").length).toBeLessThan(4);
    view.dispatch({ selection: { anchor: doc.indexOf("%%fub") + 3 } });
    expect(view.state.doc.toString()).toBe(doc);
    expect(view.contentDOM.querySelectorAll(".cm-line").length).toBeGreaterThanOrEqual(4);
  });
});

describe("la Lettura", () => {
  it("il segno sta accanto al passo, l'archivio non occupa posto, e la discussione si legge", async () => {
    const doc = "Il {==passo==}{>>@Anna Bianchi 2026-11-08 17:40: Va riscritto.<<} poi.\n\n%%fub:risolto 2026-11-16 14:02: q%%\n%%> @A: m%%\n";
    const harness = mount(doc, 0);
    harness.setMode("reading");
    harness.reading.innerHTML = renderMarkdown(doc).html;
    const unmount = harness.comments.readingRendered();
    // Senza margine (la resa del banco non ha padding) il segno è nel testo.
    const sign = harness.reading.querySelector<HTMLElement>("mark.comment-range + .cm-fub-comment-sign")!;
    expect(sign.textContent).toBe("AB1");
    expect(harness.reading.querySelector<HTMLElement>(`p[data-md-from="${doc.indexOf("%%fub")}"]`)!.hidden).toBe(true);
    sign.click();
    await settle();
    expect(popover()!.querySelector(".cm-fub-comment-quote")!.textContent).toBe("passo");
    unmount();
    expect(harness.reading.querySelector(".cm-fub-comment-sign")).toBeNull();
  });
});

describe("il pannello", () => {
  it("le discussioni aperte in ordine, poi i risolti, e il vuoto che dice come si comincia", async () => {
    const doc = "Il {==a==}{>>@Anna: uno<<}{>>@Luca: due<<} e {==b==}{>>@Bea: tre<<}.\n\n%%fub:risolto 2026-11-16 14:02: c%%\n%%> @A: m%%\n%%> @B: n%%\n";
    const { comments } = mount(doc, 0);
    const panel = comments.panels.list()[0]!;
    expect(panel.title()).toBe("Commenti");
    const host = document.createElement("div");
    document.body.append(host);
    const unmount = panel.mount(host);
    expect([...host.querySelectorAll(".cm-fub-comments-head")].map((h) => h.textContent)).toEqual(["Aperti2", "Risolti1"]);
    const cards = [...host.querySelectorAll<HTMLElement>(".cm-fub-comments-card[data-anchor]")];
    expect(cards.map((card) => card.querySelector(".cm-fub-comments-quote")!.textContent)).toEqual(["a", "b"]);
    expect(cards[0]!.querySelector(".cm-fub-comments-replies")!.textContent).toBe("1 risposta");
    expect(host.querySelector(".cm-fub-comments-archived")!.textContent).toBe("2 messaggi, archiviati in fondo alla nota in un commento %%");
    host.querySelector<HTMLButtonElement>("[data-action=clear]")!.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(host.querySelector(".cm-fub-comments-archived")).toBeNull();
    unmount();
    expect(host.childElementCount).toBe(0);

    const empty = mount("Senza commenti.\n", 0);
    const other = document.createElement("div");
    empty.comments.panels.list()[0]!.mount(other);
    expect(other.querySelector(".cm-fub-comments-empty")!.textContent).toMatch(/^Nessun commento aperto\. Seleziona del testo e premi .+M\.$/);
  });
});
