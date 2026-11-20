// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, runScopeHandlers } from "@codemirror/view";
import { defaultKeymap, history, indentWithTab, undo, undoDepth } from "@codemirror/commands";
import { markdownGrammar } from "./grammar";
import { livePreview } from "./livepreview";
import { liveReveal, type RevealPolicy } from "../../live-reveal";
import { parseImage, rewriteImage, writeImage } from "./image-live";
import { mountMarkdown } from "./mount";
import { parsedView } from "./test-support";

// L'immagine in Live: selezione, riquadro e maniglia (D8, D9).

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

function mount(doc: string, policy: RevealPolicy = "mai"): EditorView {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [history(), markdown({ base: markdownGrammar }), livePreview({ openWikilink() {}, searchTag() {} }), Prec.highest(liveReveal.of(policy))],
    }),
  });
  parsedView(view);
  views.push(view);
  return view;
}
const image = () => document.querySelector<HTMLElement>(".cm-fub-image");
const press = (view: EditorView, key: string) => runScopeHandlers(view, new KeyboardEvent("keydown", { key }), "editor");
const click = (target: Element, detail = 1) =>
  target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, detail }));

describe("le regole", () => {
  it("legge le due scritture, con dimensione, titolo e destinazione fra parentesi angolari", () => {
    expect(parseImage('![Il logo|320x200](<Risorse/il logo.png> "Titolo")')).toMatchObject({
      syntax: "markdown", alt: "Il logo", file: "Risorse/il logo.png", width: 320, height: 200, rest: ' "Titolo"',
    });
    expect(parseImage("![[foto.png|120]]")).toMatchObject({ syntax: "wiki", file: "foto.png", width: 120, rest: "" });
    expect(parseImage("![[foto.png|Una foto]]")).toMatchObject({ syntax: "wiki", width: null, rest: "Una foto" });
    expect(parseImage("![a](b.png) e altro")).toBeNull();
  });

  it("scrive soltanto ciò che cambia: il resto resta com'era, una larghezza nuova toglie l'altezza", () => {
    const md = parseImage('![C:\\x|320x200](<a b.png> "T")')!;
    expect(writeImage(md, {})).toBe('![C:\\x|320x200](<a b.png> "T")');
    expect(writeImage(md, { width: 400 })).toBe('![C:\\x|400](<a b.png> "T")');
    expect(writeImage(md, { width: null, alt: "Due ] parole" })).toBe('![Due \\] parole](<a b.png> "T")');
    expect(writeImage(md, { file: "nuova cartella/c.png" })).toBe('![C:\\x|320x200](<nuova cartella/c.png> "T")');
    expect(writeImage(parseImage("![[foto.png]]")!, { width: 240 })).toBe("![[foto.png|240]]");
    expect(writeImage(parseImage("![[foto.png|240]]")!, { width: null })).toBe("![[foto.png]]");
  });

  it("la modifica copre soltanto i byte dell'immagine, e niente se non cambia niente", () => {
    const doc = "Prima ![a](b.png) dopo";
    const state = EditorState.create({ doc });
    const from = doc.indexOf("!");
    const to = doc.indexOf(" dopo");
    const spec = rewriteImage(state, from, to, { width: 50 })!;
    expect(spec.changes).toEqual({ from, to, insert: "![a|50](b.png)" });
    expect(state.update(spec).state.doc.toString()).toBe("Prima ![a|50](b.png) dopo");
    expect(rewriteImage(state, from, to, { alt: "a" })).toBeNull();
  });

  it("in una nota CRLF un alt su due righe resta su due righe, e la selezione copre l'immagine (#394)", () => {
    for (const nl of ["\n", "\r\n"]) {
      const state = EditorState.create({ doc: `x${nl}![a${nl}b](p.png)`, extensions: nl === "\n" ? [] : [EditorState.lineSeparator.of(nl)] });
      const next = state.update(rewriteImage(state, 2, state.doc.length, { width: 300 })!).state;
      expect(next.sliceDoc()).toBe(`x${nl}![a${nl}b|300](p.png)`);
      expect(next.doc.sliceString(next.selection.main.from, next.selection.main.to)).toBe("![a\nb|300](p.png)");
    }
  });
});

describe("con `mai`", () => {
  const doc = "Testo ![Il logo](logo.png) qui";
  const from = doc.indexOf("!");
  const to = doc.indexOf(" qui");

  it("un clic seleziona l'immagine: la selezione copre i suoi byte e il widget resta", () => {
    const view = mount(doc);
    click(image()!);
    expect(view.state.selection.main).toMatchObject({ from, to });
    expect(image()?.classList.contains("cm-fub-image-selected")).toBe(true);
  });

  it("Invio apre «Immagine»; il testo alternativo nuovo riscrive soltanto l'immagine", () => {
    const view = mount(doc);
    view.dispatch({ selection: { anchor: from, head: to } });
    expect(press(view, "Enter")).toBe(true);
    const alt = document.querySelector<HTMLInputElement>(".cm-fub-image-dialog input")!;
    expect(alt.value).toBe("Il logo");
    alt.value = "Il marchio";
    alt.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(view.state.doc.toString()).toBe("Testo ![Il marchio](logo.png) qui");
    expect(document.querySelector(".cm-fub-image-dialog")).toBeNull();
    expect(view.state.selection.main).toMatchObject({ from, to: from + "![Il marchio](logo.png)".length });
  });

  it("il doppio clic apre il riquadro anch'esso; Esc lo chiude e lascia il testo", () => {
    const view = mount(doc);
    click(image()!, 2);
    const field = document.querySelector<HTMLInputElement>(".cm-fub-image-dialog input")!;
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".cm-fub-image-dialog")).toBeNull();
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("tirare la maniglia scrive la larghezza una volta sola, al rilascio: un passo di annulla", () => {
    const view = mount(doc);
    click(image()!);
    const handle = image()!.querySelector<HTMLElement>(".cm-fub-image-handle")!;
    handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 0, pointerId: 1 }));
    handle.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 120, pointerId: 1 }));
    expect(document.querySelector(".cm-fub-image-size")?.textContent).toBe("120 px");
    handle.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 240, pointerId: 1 }));
    expect(view.state.doc.toString()).toBe(doc);
    handle.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 240, pointerId: 1 }));
    expect(view.state.doc.toString()).toBe("Testo ![Il logo|240](logo.png) qui");
    expect(undoDepth(view.state)).toBe(1);
    undo(view);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("da sola nel suo paragrafo è una figura con la didascalia dal testo alternativo", () => {
    mount("Sopra\n\n![Il ponte|300](ponte.png)\n\nSotto");
    expect(document.querySelector(".cm-fub-image figure figcaption")?.textContent).toBe("Il ponte");
    expect(document.querySelector(".cm-markdown-block")).toBeNull();
  });
});

describe("con `elemento`", () => {
  it("il clic seleziona senza aprire la sorgente; Invio mette il cursore nella sorgente", () => {
    const doc = "Testo ![Il logo](logo.png) qui";
    const view = mount(doc, "elemento");
    click(image()!);
    expect(image()?.classList.contains("cm-fub-image-selected")).toBe(true);
    expect(press(view, "Enter")).toBe(true);
    expect(view.state.selection.main.head).toBe(doc.indexOf("!") + 2);
    expect(image()).toBeNull();
  });
});

describe("i pulsanti dentro un'immagine (#454)", () => {
  // La Live vera: i tasti dell'editor (a capo, rientro) e una resa che offre
  // «Scarica nel vault» come la superficie Markdown.
  function live(doc: string): EditorView {
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, indentWithTab]),
          markdown({ base: markdownGrammar }),
          livePreview({
            openWikilink() {},
            searchTag() {},
            mountRendered: (container, html) => mountMarkdown(container, html, { importRemoteImage: async () => {} }),
          }),
          Prec.highest(liveReveal.of("mai")),
        ],
      }),
    });
    parsedView(view);
    views.push(view);
    return view;
  }
  const keys: KeyboardEventInit[] = [{ key: "Enter" }, { key: " " }, { key: "Tab" }, { key: "Tab", shiftKey: true }];

  for (const [name, doc, selector] of [
    ["«Scarica nel vault» di un'immagine remota", "Testo ![gatto](https://e.it/a.png) qui", ".image-remote-load"],
    ["«Carica» di una pagina incorporata", "Testo ![](https://www.youtube.com/watch?v=abc) qui", ".web-embed-load"],
  ] as const) {
    it(`${name}: Invio, Spazio, Tab e Maiusc+Tab non cambiano la nota`, () => {
      const view = live(doc);
      const button = document.querySelector<HTMLButtonElement>(`.cm-fub-image ${selector}`)!;
      expect(button).not.toBeNull();
      button.focus();
      for (const init of keys) {
        button.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true }));
      }
      expect(view.state.doc.toString()).toBe(doc);
      expect(undoDepth(view.state)).toBe(0);
    });
  }
});
