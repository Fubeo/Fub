// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { openLifetime, type Lifetime } from "../../../../../ui/lifetime";
import { liveReveal } from "../../../live-reveal";
import { markdownGrammar } from "../grammar";
import { livePreview } from "../livepreview";
import { editFormulaAt, placeFormulaAt } from "../math-live";
import { MathEditor, type MathPreferences } from "./editor";
import { formulaPaste } from "./paste";

// Copia e incolla, Invio che allinea, il posto della formula (T65, E27), col
// riquadro vero e KaTeX vero.

vi.mock("../../../../../ui/notify", () => ({ notify: () => undefined }));
vi.mock("../../../../../host/ipc", () => ({ api: { setSetting: async () => undefined } }));

beforeEach(() => {
  // KaTeX non disegna in quirks mode, e happy-dom non dice il suo modo.
  Object.defineProperty(document, "compatMode", { configurable: true, value: "CSS1Compat" });
});

const lives: Lifetime[] = [];
const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  for (const life of lives.splice(0)) life.close();
  document.body.replaceChildren();
  Reflect.deleteProperty(document, "compatMode");
});

const settle = () => new Promise((done) => setTimeout(done, 40));
async function drawn(): Promise<void> {
  await settle();
  for (let i = 0; i < 100 && document.querySelector(".cm-fub-mx-surface[data-state=loading]"); i++) await settle();
}

/// Un incolla col suo testo semplice.
function paste(target: EventTarget, text: string): Event {
  const data = new DataTransfer();
  data.setData("text/plain", text);
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: data });
  target.dispatchEvent(event);
  return event;
}

async function open(tex: string, options: { display?: boolean; preferences?: MathPreferences; place?: boolean } = {}) {
  const life = openLifetime();
  lives.push(life);
  const changes: string[] = [];
  const left: string[] = [];
  const told: string[] = [];
  const placed: boolean[] = [];
  const editor = new MathEditor({
    tex,
    display: options.display ?? false,
    start: "end",
    preferences: options.preferences,
    onPreferences: () => undefined,
    ...(options.place === false ? {} : { onPlace: (display: boolean) => placed.push(display) }),
    tell: (message) => told.push(message),
    onChange: (next) => changes.push(next),
    onLeave: (reason) => left.push(reason),
    lifetime: life,
  });
  document.body.append(editor.element);
  editor.focus();
  await drawn();
  const field = () => editor.element.querySelector<HTMLTextAreaElement>("textarea")!;
  const key = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    field().dispatchEvent(event);
    return event;
  };
  return { editor, field, key, changes, left, told, placed };
}

const SOURCE: MathPreferences = { source: true, help: "piene" };

describe("incollare nel riquadro", () => {
  it("nella formula che si tocca entra il TeX senza delimitatori", async () => {
    const { field, changes } = await open("");
    expect(paste(field(), "\\(\\frac{a}{b}\\)").defaultPrevented).toBe(true);
    expect(changes[changes.length - 1]).toBe("\\frac{a}{b}");
  });

  it("nel campo del LaTeX lo stesso, al posto della scelta", async () => {
    const { field, changes } = await open("x + y", { preferences: SOURCE });
    field().setSelectionRange(4, 5);
    expect(paste(field(), "$$\\sqrt{2}$$").defaultPrevented).toBe(true);
    expect(field().value).toBe("x + \\sqrt{2}");
    expect(changes[changes.length - 1]).toBe("x + \\sqrt{2}");
  });

  it("nel campo, il testo con dollari che non sono una formula segue la sua strada", async () => {
    const { field } = await open("x", { preferences: SOURCE });
    expect(paste(field(), "costa $5 e $6").defaultPrevented).toBe(false);
  });
});

describe("Invio a blocco", () => {
  it("va a capo e allinea gli uguali; Ctrl Invio finisce", async () => {
    const { key, changes, left, told } = await open("x = 1", { display: true });
    expect(key("Enter").defaultPrevented).toBe(true);
    expect(changes[changes.length - 1]).toBe("\\begin{aligned}\nx &= 1 \\\\\n&= \n\\end{aligned}");
    expect(left).toEqual([]);
    expect(told).toEqual(["Invio in una formula a blocco va a capo e allinea gli uguali. Ctrl Invio o Esc per finire."]);
    key("2");
    expect(changes[changes.length - 1]).toMatch(/&= \n2\\end\{aligned\}$/);
    key("Enter");
    expect(changes[changes.length - 1]!.match(/\\\\/g)).toHaveLength(2);
    key("Enter", { ctrlKey: true });
    expect(left).toEqual(["enter"]);
  });

  it("nel campo del LaTeX lo stesso; Esc finisce", async () => {
    const { key, field, left } = await open("a = b", { display: true, preferences: SOURCE });
    key("Enter");
    expect(field().value).toBe("\\begin{aligned}\na &= b \\\\\n&= \n\\end{aligned}");
    expect(field().value.slice(0, field().selectionStart).endsWith("&= ")).toBe(true);
    key("Escape");
    expect(left).toEqual(["escape"]);
  });

  it("in riga Invio finisce, come prima", async () => {
    const { key, left, changes } = await open("x = 1");
    key("Enter");
    expect(left).toEqual(["enter"]);
    expect(changes).toEqual([]);
  });
});

describe("«Posto» nei tre puntini", () => {
  it("In riga e A blocco, col posto di adesso premuto; l'altro lo chiede a chi chiama", async () => {
    const { editor, placed } = await open("x");
    editor.element.querySelector<HTMLElement>(".cm-fub-mx-more")!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    const inline = editor.element.querySelector<HTMLElement>("[data-place=inline]")!;
    const block = editor.element.querySelector<HTMLElement>("[data-place=block]")!;
    expect(inline.textContent).toBe("In riga");
    expect(inline.getAttribute("aria-pressed")).toBe("true");
    expect(block.textContent).toBe("A blocco");
    inline.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(placed).toEqual([]);
    block.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(placed).toEqual([true]);
  });

  it("senza chi cambia il posto la riga non c'è", async () => {
    const { editor } = await open("x", { place: false });
    editor.element.querySelector<HTMLElement>(".cm-fub-mx-more")!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(editor.element.querySelector("[data-place]")).toBeNull();
  });
});

// ── Nella nota ───────────────────────────────────────────────────────────────

function mount(doc: string, anchor = 0): EditorView {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [
        markdown({ base: markdownGrammar }),
        formulaPaste,
        livePreview({ openWikilink() {}, searchTag() {} }),
        Prec.highest(liveReveal.of("mai")),
      ],
    }),
  });
  ensureSyntaxTree(view.state, view.state.doc.length, 1000);
  view.dispatch({});
  views.push(view);
  return view;
}

describe("incollare nella nota", () => {
  it("le formule di un assistente diventano quelle di Fub", () => {
    const view = mount("Testo\n", 6);
    const event = paste(view.contentDOM, "Sia \\(x^2\\):\n\n\\[\nx = 1\n\\]");
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("Testo\nSia $x^2$:\n\n$$\nx = 1\n$$");
  });

  it("il testo con dollari che non sono formule entra com'è", () => {
    const view = mount("Testo\n", 6);
    paste(view.contentDOM, "costa $5 e $6");
    expect(view.state.doc.toString()).toBe("Testo\ncosta $5 e $6");
  });
});

describe("il posto dal tasto destro", () => {
  it("da riga a blocco si riapre a blocco; e indietro si riapre in riga", async () => {
    const doc = "Sia $a=b$ ok\n";
    const view = mount(doc);
    expect(placeFormulaAt(view, doc.indexOf("a=b"), true)).toBe(true);
    expect(view.state.doc.toString()).toBe("Sia\n\n$$\na=b\n$$\n\nok\n");
    await drawn();
    expect(document.querySelector(".cm-fub-mx-block")).not.toBeNull();
    const at = view.state.doc.toString().indexOf("$$");
    expect(placeFormulaAt(view, at, false)).toBe(true);
    expect(view.state.doc.toString()).toBe("Sia\n\n$a=b$\n\nok\n");
    await drawn();
    expect(document.querySelector(".cm-fub-mx-popover .cm-fub-mx, .cm-fub-mx[data-display=inline]")).not.toBeNull();
  });

  it("«Modifica» apre la formula in riga e lascia la nota com'è", async () => {
    const doc = "Sia $x^2$ ok\n";
    const view = mount(doc);
    expect(editFormulaAt(view, doc.indexOf("x"))).toBe(true);
    await drawn();
    expect(document.querySelector(".cm-fub-mx[data-display=inline]")).not.toBeNull();
    expect(view.state.doc.toString()).toBe(doc);
  });
});
