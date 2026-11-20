// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { markdownGrammar } from "../grammar";
import { livePreview } from "../livepreview";
import { liveReveal, mathClassic, type RevealPolicy } from "../../../live-reveal";
import { CORPUS, LONG_FORMULA } from "./corpus";
import { MathEditor } from "./editor";
import { openLifetime } from "../../../../../ui/lifetime";
import { MATH_READY_MS, mathReady } from "./test-drawn";

// KaTeX e i pezzi che arrivano con un `import()` (`ui/lazy-part.ts`) qui ci
// sono già, come dopo il riscaldamento: i gesti si guardano col loro codice.
beforeAll(mathReady, MATH_READY_MS);

// La formula che si modifica toccandola (T60, E27), dentro la nota: con KaTeX
// vero, perché i segni del cursore sono suoi. La geometria (il clic su
// numeratore e denominatore) la prova il banco, che ha un motore di layout.

// KaTeX non disegna in quirks mode, e happy-dom non dice il suo modo.
beforeEach(() => {
  Object.defineProperty(document, "compatMode", { configurable: true, value: "CSS1Compat" });
});

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  Reflect.deleteProperty(document, "compatMode");
});

interface Mount {
  readonly policy?: RevealPolicy;
  readonly classic?: boolean;
  readonly readOnly?: boolean;
}

function mount(doc: string, anchor: number, options: Mount = {}): EditorView {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [
        markdown({ base: markdownGrammar }),
        livePreview({ openWikilink() {}, searchTag() {} }),
        Prec.highest(liveReveal.of(options.policy ?? "mai")),
        mathClassic.of(options.classic ?? false),
        EditorState.readOnly.of(options.readOnly ?? false),
      ],
    }),
  });
  ensureSyntaxTree(view.state, view.state.doc.length, 1000);
  view.dispatch({});
  views.push(view);
  return view;
}

const press = (view: EditorView, key: string) => runScopeHandlers(view, new KeyboardEvent("keydown", { key }), "editor");
/// Il disegno al fotogramma dopo (KaTeX è già caricato da `mathReady`).
const settle = () => new Promise((done) => setTimeout(done, 40));
const input = () => document.querySelector<HTMLTextAreaElement>(".cm-fub-mx-input");
const status = () => document.querySelector(".cm-fub-mx [role=status]")?.textContent ?? "";
function type(keys: readonly string[], options: KeyboardEventInit = {}): void {
  for (const key of keys) {
    input()!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }));
  }
}

describe("una formula in riga", () => {
  it("→ la apre col cursore all'inizio; scrivere cambia la formula nella frase", async () => {
    const view = mount("x $a+b$ y", 2);
    view.focus();
    expect(press(view, "ArrowRight")).toBe(true);
    // La prima formula del file carica KaTeX: sulla CI, a freddo, ci mette
    // più di un fotogramma. Si aspetta la superficie pronta, non un tempo.
    await vi.waitFor(() => expect(document.querySelector(".cm-fub-mx-surface")?.getAttribute("data-state")).toBe("ready"));
    expect(document.querySelector(".cm-fub-mx-popover")).not.toBeNull();
    expect(document.activeElement).toBe(input());
    // Nella frase la formula che si modifica ha il suo segno.
    expect(document.querySelector(".cm-fub-math.cm-fub-math-on")).not.toBeNull();
    expect(document.querySelector(".cm-fub-mx-surface")?.getAttribute("data-state")).toBe("ready");
    type(["c"]);
    expect(view.state.doc.toString()).toBe("x $ca+b$ y");
    type(["^", "2"]);
    expect(view.state.doc.toString()).toBe("x $c^{2}a+b$ y");
    expect(status()).toContain("c");
    type([" ", "Escape"]);
    expect(document.querySelector(".cm-fub-mx-popover")).toBeNull();
    expect(view.state.selection.main.head).toBe("x $c^{2}a+b$".length);
  });

  it("aperta e chiusa senza toccarla resta byte per byte", async () => {
    const doc = "x $\\frac{a}{b}$ e $\\sqrt{2}$ y";
    const view = mount(doc, 2);
    // Nessuna modifica, nemmeno una che riscrive gli stessi byte.
    const before = view.state.doc;
    view.focus();
    press(view, "ArrowRight");
    await settle();
    type(["ArrowRight", "ArrowRight", "ArrowLeft", "Home", "End", "Tab"]);
    expect(input()).toBeNull();
    await settle();
    expect(view.state.doc).toBe(before);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("si apre col clic, e Backspace fino in fondo toglie la formula; scrivere la rimette", async () => {
    const view = mount("x $ab$ y", 0);
    view.focus();
    const formula = document.querySelector<HTMLElement>(".cm-fub-math")!;
    formula.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    await settle();
    expect(input()).not.toBeNull();
    type(["End", "Backspace", "Backspace"]);
    expect(view.state.doc.toString()).toBe("x  y");
    type(["z"]);
    expect(view.state.doc.toString()).toBe("x $z$ y");
  });

  it("un comando scritto per nome entra quando è finito, coi suoi spazi vuoti", async () => {
    const view = mount("x $a$ y", 2);
    view.focus();
    press(view, "ArrowRight");
    await settle();
    type(["End", "+", "\\", "f", "r", "a", "c"]);
    // A metà del nome la nota non cambia: `\fr` non si legge.
    expect(view.state.doc.toString()).toBe("x $a+$ y");
    type([" ", "1", "Tab", "2"]);
    expect(view.state.doc.toString()).toBe("x $a+\\frac{1}{2}$ y");
    expect(status()).toBe("denominatore");
  });

  it("Ctrl Z torna indietro dentro la formula", async () => {
    const view = mount("x $a$ y", 2);
    view.focus();
    press(view, "ArrowRight");
    await settle();
    type(["End", "b"]);
    expect(view.state.doc.toString()).toBe("x $ab$ y");
    type(["z"], { ctrlKey: true });
    expect(view.state.doc.toString()).toBe("x $a$ y");
    type(["y"], { ctrlKey: true });
    expect(view.state.doc.toString()).toBe("x $ab$ y");
  });

  it("una formula con un errore si apre col suo LaTeX a vista", async () => {
    const view = mount("x $\\frac{a}$ y", 2);
    view.focus();
    press(view, "ArrowRight");
    await settle();
    const latex = document.querySelector<HTMLTextAreaElement>(".cm-fub-mx-latex");
    expect(latex?.value).toBe("\\frac{a}");
    // Sotto, che cosa non va, in chiaro (T64), al posto della nota generica.
    expect(document.querySelector(".cm-fub-mx-error:not([hidden]) .cm-fub-mx-error-text")?.textContent).toBe("A \\frac manca un pezzo.");
    expect(document.querySelector(".cm-fub-mx-note")?.hasAttribute("hidden")).toBe(true);
    latex!.value = "\\frac{a}{b}";
    latex!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(view.state.doc.toString()).toBe("x $\\frac{a}{b}$ y");
  });
});

describe("un blocco $$", () => {
  it("col cursore dentro si modifica sul posto, e il LaTeX non si vede", async () => {
    const doc = "a\n\n$$\nE = mc^2\n$$\n\nb";
    const view = mount(doc, 0);
    view.dispatch({ selection: { anchor: doc.indexOf("mc") } });
    await settle();
    // happy-dom non regge la selezione della nota dentro un riquadro: il
    // fuoco lo dà il test.
    input()!.focus();
    const block = document.querySelector(".cm-fub-mx-block");
    expect(block).not.toBeNull();
    expect(view.contentDOM.textContent).not.toContain("E = mc^2");
    // Si entra da sopra: il cursore è all'inizio della formula.
    type(["End", "+", "1"]);
    expect(view.state.doc.toString()).toBe("a\n\n$$\nE = mc^2+1\n$$\n\nb");
    // Il riquadro resta lo stesso mentre si scrive.
    expect(document.querySelector(".cm-fub-mx-block")).toBe(block);
    type(["Escape"]);
    expect(view.state.selection.main.head).toBe("a\n\n$$\nE = mc^2+1\n$$\n".length);
    expect(document.querySelector(".cm-fub-mx-block")).toBeNull();
  });

  it("in fondo alla nota, uscire prende una riga nuova", async () => {
    const doc = "a\n\n$$x$$";
    const view = mount(doc, 0);
    view.dispatch({ selection: { anchor: doc.indexOf("x") } });
    await settle();
    type(["Escape"]);
    expect(view.state.doc.toString()).toBe("a\n\n$$x$$\n");
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });

  it("scritto a mano nella nota resta testo finché il cursore non ne esce (IMP-719)", async () => {
    const view = mount("a\n\n", 3);
    // I dollari e la formula scritti nella nota: la formula da toccare
    // prenderebbe a metà i tasti che seguono.
    view.dispatch({ changes: { from: 3, insert: "$$x^2$$" }, selection: { anchor: 8 }, userEvent: "input.type" });
    await settle();
    expect(document.querySelector(".cm-fub-mx-block")).toBeNull();
    view.dispatch({ changes: { from: 8, insert: " +" }, selection: { anchor: 10 }, userEvent: "input.type" });
    await settle();
    expect(document.querySelector(".cm-fub-mx-block")).toBeNull();
    // Fuori, e di nuovo dentro: si tocca come sempre.
    view.dispatch({ selection: { anchor: 0 }, userEvent: "select" });
    await settle();
    view.dispatch({ selection: { anchor: 6 }, userEvent: "select" });
    await settle();
    expect(document.querySelector(".cm-fub-mx-block")).not.toBeNull();
  });

  it("chiuso scrivendo `$$`, il cursore va in una riga nuova e non davanti al testo dopo", async () => {
    const doc = "a\n\n$$x$$\n# T";
    const view = mount(doc, 0);
    view.dispatch({ selection: { anchor: doc.indexOf("x") } });
    await settle();
    input()!.focus();
    type(["End", "$", "$"]);
    expect(view.state.doc.toString()).toBe("a\n\n$$x$$\n\n# T");
    expect(view.state.selection.main.head).toBe("a\n\n$$x$$\n".length);
  });
});

describe("restano com'erano", () => {
  it("coi tasti di Vim → apre il riquadro col TeX", async () => {
    const view = mount("x $a$ y", 2, { classic: true });
    view.focus();
    press(view, "ArrowRight");
    expect(document.querySelector<HTMLInputElement>(".cm-fub-math-popover input")?.value).toBe("a");
    expect(document.querySelector(".cm-fub-mx")).toBeNull();
  });

  it("in sola lettura la formula non si tocca", async () => {
    const doc = "a\n\n$$\nx\n$$\n";
    const view = mount(doc, 0, { readOnly: true });
    view.dispatch({ selection: { anchor: doc.indexOf("x") } });
    await settle();
    expect(document.querySelector(".cm-fub-mx-block")).toBeNull();
  });

  it("con `elemento` la sorgente si vede col cursore dentro", async () => {
    const doc = "a\n\n$$\nx\n$$\n";
    const view = mount(doc, 0, { policy: "elemento" });
    view.dispatch({ selection: { anchor: doc.indexOf("x") } });
    await settle();
    expect(document.querySelector(".cm-fub-mx-block")).toBeNull();
  });
});

describe("l'editor da solo", () => {
  it("dice dove sta il cursore, una volta per posto", async () => {
    const life = openLifetime();
    const seen: string[] = [];
    const editor = new MathEditor({ tex: "x^{2}", display: true, start: "start", onChange: () => {}, onLeave: () => {}, lifetime: life });
    document.body.append(editor.element);
    editor.focus();
    await settle();
    const live = editor.element.querySelector("[role=status]")!;
    for (let i = 0; i < 3; i++) {
      editor.element.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
      seen.push(live.textContent ?? "");
    }
    expect(seen).toEqual(["esponente di x", "esponente di x", "fine della formula"]);
    life.close();
  });

  it("ogni formula del corpus, percorsa da capo a fondo senza scrivere, non cambia di un byte", async () => {
    const touched: string[] = [];
    for (const { tex, display } of [...CORPUS, { tex: LONG_FORMULA, display: true }]) {
      const life = openLifetime();
      let left = 0;
      // Le frecce sono regole senza disegno: si parte dalla fine e si torna
      // indietro un pezzo alla volta, fino a uscire dall'inizio.
      const editor = new MathEditor({ tex, display: display ?? false, start: "end", onChange: () => touched.push(tex), onLeave: () => left++, lifetime: life });
      document.body.append(editor.element);
      const field = editor.element.querySelector("textarea")!;
      const press = (key: string) => field.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      for (let i = 0; i < 2000 && left === 0; i++) press("ArrowLeft");
      expect(left, tex).toBe(1);
      left = 0;
      for (const key of ["Home", "End", "ArrowUp", "ArrowDown", "Escape"]) press(key);
      expect(editor.tex).toBe(tex);
      life.close();
      editor.element.remove();
    }
    expect(touched).toEqual([]);
  });
});
