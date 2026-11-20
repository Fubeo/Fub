// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { openLifetime, type Lifetime } from "../../../../../ui/lifetime";
import { liveReveal, mathHelp, mathSource, type MathHelp } from "../../../live-reveal";
import { markdownGrammar } from "../grammar";
import { livePreview } from "../livepreview";
import { MathEditor, type MathPreferences } from "./editor";
import { attachPalette } from "./palette";
import { drawn, MATH_READY_MS, mathReady } from "./test-drawn";

// KaTeX e i pezzi che arrivano con un `import()` (`ui/lazy-part.ts`) qui ci
// sono già, come dopo il riscaldamento: i gesti si guardano col loro codice.
beforeAll(mathReady, MATH_READY_MS);

// «Mostra il LaTeX», la scrittura veloce e le tre misure di aiuto (T63, E27):
// il campo del LaTeX sotto la formula, la formula che si tocca coi suoi tasti
// veloci, i tre puntini che scrivono le preferenze. Con KaTeX vero, perché
// gli spazi vuoti sono segni suoi.

const notices = vi.hoisted(() => ({ calls: [] as { message: string; tone?: string }[] }));
vi.mock("../../../../../ui/notify", () => ({
  notify: (message: string, tone?: string) => notices.calls.push({ message, tone }),
}));
const store = vi.hoisted(() => ({ saved: [] as [string, unknown][], fail: false }));
vi.mock("../../../../../host/ipc", () => ({
  api: {
    setSetting: async (key: string, value: unknown) => {
      if (store.fail) throw new Error("disco pieno");
      store.saved.push([key, value]);
    },
  },
}));

beforeEach(() => {
  // KaTeX non disegna in quirks mode, e happy-dom non dice il suo modo.
  Object.defineProperty(document, "compatMode", { configurable: true, value: "CSS1Compat" });
  notices.calls.length = 0;
  store.saved.length = 0;
  store.fail = false;
});

const lives: Lifetime[] = [];
const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  for (const life of lives.splice(0)) life.close();
  document.body.replaceChildren();
  Reflect.deleteProperty(document, "compatMode");
});

/// Un giro del ciclo degli eventi: il salvataggio finto delle impostazioni
/// risponde con una promessa già risolta.
const settle = () => new Promise((done) => setTimeout(done, 40));

interface Open {
  readonly preferences?: MathPreferences;
  readonly display?: boolean;
  readonly dots?: boolean;
}

async function open(tex: string, options: Open = {}) {
  const life = openLifetime();
  lives.push(life);
  const changes: string[] = [];
  const chosen: MathPreferences[] = [];
  const told: string[] = [];
  const left: string[] = [];
  const editor = new MathEditor({
    tex,
    display: options.display ?? false,
    start: "end",
    preferences: options.preferences,
    onPreferences: options.dots === false ? undefined : (next) => chosen.push(next),
    tell: (message) => told.push(message),
    onChange: (next) => changes.push(next),
    onLeave: (reason) => left.push(reason),
    lifetime: life,
  });
  attachPalette(editor, life);
  document.body.append(editor.element);
  editor.focus();
  await drawn(".cm-fub-mx-surface", editor.element);
  const root = editor.element;
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector);
  const field = () => root.querySelector<HTMLTextAreaElement>("textarea")!;
  const key = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    field().dispatchEvent(event);
    return event;
  };
  /// Un segno scritto nel campo del LaTeX: il tasto, poi (se il tasto non è
  /// stato preso) il segno entra al cursore e arriva l'`input`.
  const typeField = (text: string, init: { composing?: boolean } = {}) => {
    for (const ch of text) {
      const down = key(ch);
      if (down.defaultPrevented) continue;
      const input = field();
      const at = input.selectionStart;
      input.value = input.value.slice(0, at) + ch + input.value.slice(input.selectionEnd);
      input.setSelectionRange(at + 1, at + 1);
      input.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: ch,
        inputType: init.composing ? "insertCompositionText" : "insertText",
        isComposing: init.composing ?? false,
      }));
    }
  };
  /// I tasti nella formula che si tocca.
  const typeVisual = (keys: readonly string[]) => {
    for (const k of keys) key(k);
  };
  const shown = () => `${field().value.slice(0, field().selectionStart)}|${field().value.slice(field().selectionStart)}`;
  return { editor, root, field, $, key, typeField, typeVisual, shown, changes, chosen, told, left, life };
}

const SOURCE: MathPreferences = { source: true, help: "piene" };

describe("«Mostra il LaTeX»", () => {
  it("sotto la formula il campo del suo LaTeX, coi tre puntini accanto", async () => {
    const { root, field, $ } = await open("x^{2}", { preferences: SOURCE });
    expect(root.dataset.mode).toBe("source");
    expect(field().classList.contains("cm-fub-mx-field")).toBe(true);
    expect(field().value).toBe("x^{2}");
    expect(field().tabIndex).toBe(0);
    expect(field().getAttribute("aria-label")).toBe("La formula in TeX");
    expect(field().placeholder).toBe("Scrivi, o scegli qui sotto");
    // La formula è disegnata sopra, il campo sotto.
    const surface = $(".cm-fub-mx-surface")!;
    expect(surface.dataset.state).toBe("ready");
    expect(surface.compareDocumentPosition(field()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const more = $(".cm-fub-mx-row .cm-fub-mx-more")!;
    expect(more.getAttribute("aria-label")).toBe("Opzioni della formula");
    expect(more.getAttribute("aria-expanded")).toBe("false");
  });

  it("il clic sulla formula porta soltanto agli spazi vuoti", async () => {
    const { $, field, root } = await open("\\frac{}{}+x", { preferences: SOURCE });
    const holes = [...root.querySelectorAll<HTMLElement>(".cm-fub-mx-surface [data-fubhole]")];
    // KaTeX scrive il denominatore prima del numeratore.
    expect(holes.map((hole) => hole.getAttribute("data-fubp")).sort()).toEqual(["6", "8"]);
    holes.find((hole) => hole.getAttribute("data-fubp") === "8")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    expect(field().selectionStart).toBe(8);
    expect(document.activeElement).toBe(field());
    // Altrove il clic non sposta il cursore, e il fuoco resta nel campo.
    field().setSelectionRange(2, 2);
    const katex = $(".cm-fub-mx-surface .katex")!;
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    katex.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(field().selectionStart).toBe(2);
  });

  it("scrivere nel campo cambia la formula; la scrittura veloce si annulla con Backspace", async () => {
    const { typeField, key, shown, changes, told } = await open("", { preferences: SOURCE });
    typeField("a/");
    expect(shown()).toBe("\\frac{a}{|}");
    expect(changes[changes.length - 1]).toBe("\\frac{a}{}");
    // La prima volta si spiega.
    expect(told).toEqual(["Scrittura veloce: l'ho trasformato in LaTeX. Backspace subito dopo lo rimette com'era."]);
    expect(key("Backspace").defaultPrevented).toBe(true);
    expect(shown()).toBe("a/|");
    expect(changes[changes.length - 1]).toBe("a/");
    // Un Backspace dopo è un Backspace qualunque.
    expect(key("Backspace").defaultPrevented).toBe(false);
  });

  it("le parentesi si chiudono da sole e si scavalcano; Backspace fra due vuote le toglie", async () => {
    const { typeField, key, shown } = await open("", { preferences: SOURCE });
    typeField("f(x");
    expect(shown()).toBe("f(x|)");
    typeField(")");
    expect(shown()).toBe("f(x)|");
    typeField("+(");
    expect(key("Backspace").defaultPrevented).toBe(true);
    expect(shown()).toBe("f(x)+|");
  });

  it("Tab va da uno spazio vuoto all'altro, poi fuori dalla formula", async () => {
    const { field, key, shown, left } = await open("\\frac{}{}", { preferences: SOURCE });
    field().setSelectionRange(0, 0);
    key("Tab");
    expect(shown()).toBe("\\frac{|}{}");
    key("Tab");
    expect(shown()).toBe("\\frac{}{|}");
    key("Tab");
    // Dopo l'ultima graffa il Tab segue la pagina: i tre puntini, poi fuori.
    expect(key("Tab").defaultPrevented).toBe(false);
    expect(left).toEqual([]);
  });

  it("senza i tre puntini, il Tab dopo l'ultimo spazio vuoto esce dalla formula", async () => {
    const { field, key, left } = await open("\\frac{}{}", { preferences: SOURCE, dots: false });
    field().setSelectionRange(9, 9);
    key("Tab");
    expect(left).toEqual(["after"]);
  });

  it("le proposte dicono anche il comando, e Invio lo mette", async () => {
    const { typeField, key, shown, $ } = await open("", { preferences: SOURCE });
    typeField("\\alp");
    const list = $(".cm-fub-mx-symbols")!;
    expect(list.hidden).toBe(false);
    expect(list.querySelector(".cm-fub-mx-symbol-code")?.textContent).toBe("\\alpha");
    key("Enter");
    expect(shown()).toBe("\\alpha|");
    expect(list.hidden).toBe(true);
  });

  it("con l'IME la scrittura veloce non trasforma niente", async () => {
    const { typeField, shown } = await open("", { preferences: SOURCE });
    typeField("->", { composing: true });
    expect(shown()).toBe("->|");
  });
});

describe("le tre misure di aiuto", () => {
  it("pieni: la tavolozza sotto, la scrittura veloce", async () => {
    const { root, $, typeField, shown } = await open("", { preferences: SOURCE });
    expect(root.dataset.help).toBe("piene");
    expect($<HTMLButtonElement>(".cm-fub-mx-palette-toggle")!.hidden).toBe(true);
    typeField("->");
    expect(shown()).toBe("\\to |");
  });

  it("discreti: parentesi e completamento, la tavolozza a richiesta, niente si trasforma", async () => {
    const { root, $, typeField, shown, field, key } = await open("", { preferences: { source: true, help: "discrete" } });
    expect(root.dataset.help).toBe("discrete");
    typeField("a/b->");
    expect(shown()).toBe("a/b->|");
    typeField("(");
    expect(shown()).toBe("a/b->(|)");
    field().value = "";
    field().setSelectionRange(0, 0);
    typeField("\\alp");
    expect($(".cm-fub-mx-symbols")!.hidden).toBe(false);
    key("Escape");
    // La tavolozza si apre a richiesta: col pulsante o con Alt ↓.
    const toggle = $<HTMLButtonElement>(".cm-fub-mx-palette-toggle")!;
    expect(toggle.hidden).toBe(false);
    expect(toggle.textContent).toBe("Simboli");
    expect(root.dataset.palette).toBeUndefined();
    toggle.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(root.dataset.palette).toBe("open");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    toggle.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(root.dataset.palette).toBeUndefined();
    key("ArrowDown", { altKey: true });
    expect(root.dataset.palette).toBe("open");
    expect(document.activeElement?.closest(".cm-fub-mx-quick")).not.toBeNull();
  });

  it("spenti: soltanto il LaTeX e la sua anteprima", async () => {
    const { root, $, typeField, shown, key, field } = await open("", { preferences: { source: true, help: "spente" } });
    expect(root.dataset.help).toBe("spente");
    expect(field().placeholder).toBe("LaTeX");
    expect($<HTMLButtonElement>(".cm-fub-mx-palette-toggle")!.hidden).toBe(true);
    typeField("a/(->");
    expect(shown()).toBe("a/(->|");
    typeField(" \\alp");
    expect($(".cm-fub-mx-symbols")!.hidden).toBe(true);
    // Alt ↓ non apre niente, e Backspace è un Backspace.
    expect(key("ArrowDown", { altKey: true }).defaultPrevented).toBe(false);
    expect(key("Backspace").defaultPrevented).toBe(false);
  });
});

describe("i tre puntini", () => {
  it("aprono «Mostra il LaTeX» e gli aiuti; una scelta vale subito e si scrive", async () => {
    const { root, $, chosen, told, field } = await open("x", { preferences: SOURCE });
    const more = $(".cm-fub-mx-more")!;
    more.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    const options = $(".cm-fub-mx-options")!;
    expect(options.hidden).toBe(false);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const rows = [...options.querySelectorAll(".cm-fub-mx-option")].map((row) => row.textContent);
    expect(rows).toEqual(["Mostra il LaTeXNoSì", "AiutiPieniDiscretiSpenti"]);
    options.querySelector<HTMLElement>("[data-help=spente]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(chosen).toEqual([{ source: true, help: "spente" }]);
    expect(root.dataset.help).toBe("spente");
    expect(options.querySelector("[data-help=spente]")!.getAttribute("aria-pressed")).toBe("true");
    expect(told[told.length - 1]).toBe("Aiuti spenti: il LaTeX che scrivi e la sua anteprima, nient'altro.");
    // «No» torna alla formula che si tocca, col suo TeX.
    options.querySelector<HTMLElement>("[data-source=off]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(chosen[chosen.length - 1]).toEqual({ source: false, help: "spente" });
    expect(root.dataset.mode).toBe("visual");
    expect(root.dataset.help).toBe("piene");
    expect(field().classList.contains("cm-fub-mx-input")).toBe(true);
    expect(options.hidden).toBe(true);
  });

  it("dalla tastiera: Maiusc F10 li apre col fuoco sulla scelta, Esc torna al campo", async () => {
    const { $, key, field } = await open("x", { preferences: SOURCE });
    key("F10", { shiftKey: true });
    expect($(".cm-fub-mx-options")!.hidden).toBe(false);
    expect(document.activeElement?.getAttribute("data-source")).toBe("on");
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect($(".cm-fub-mx-options")!.hidden).toBe(true);
    expect(document.activeElement).toBe(field());
  });

  it("nella formula che si tocca i tre puntini ci sono, gli aiuti no", async () => {
    const { $ } = await open("x");
    $(".cm-fub-mx-more")!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    const rows = [...$(".cm-fub-mx-options")!.querySelectorAll(".cm-fub-mx-option")].map((row) => row.textContent);
    expect(rows).toEqual(["Mostra il LaTeXNoSì"]);
  });

  it("le preferenze cambiate fuori cambiano la formula aperta, col suo TeX", async () => {
    const { editor, root, field } = await open("a+b", { preferences: SOURCE });
    editor.configure({ source: false, help: "piene" });
    expect(root.dataset.mode).toBe("visual");
    expect(editor.tex).toBe("a+b");
    editor.configure({ source: true, help: "discrete" });
    expect(root.dataset.mode).toBe("source");
    expect(root.dataset.help).toBe("discrete");
    expect(field().value).toBe("a+b");
  });
});

describe("la scrittura veloce nella formula che si tocca", () => {
  it("ogni tasto della tabella, e Backspace subito dopo lo rimette com'era", async () => {
    const cases: readonly (readonly [readonly string[], string, string])[] = [
      [["a", "/"], "\\frac{a}{}", "a/"],
      [["-", ">"], "\\to ", "->"],
      [["p", "i", " "], "\\pi ", "pi "],
      [["*"], "\\cdot ", "*"],
      [["3", ",", "1"], "3{,}1", "3,1"],
      [["\""], "\\text{}", "\""],
    ];
    for (const [keys, after, back] of cases) {
      const { typeVisual, key, editor, life } = await open("");
      typeVisual(keys);
      expect(editor.tex, keys.join("")).toBe(after);
      key("Backspace");
      expect(editor.tex, keys.join("")).toBe(back);
      life.close();
    }
  });

  it("`(` si chiude da sola, `)` la scavalca, `^` apre l'esponente", async () => {
    const { typeVisual, editor } = await open("");
    typeVisual(["f", "(", "x"]);
    expect(editor.tex).toBe("f(x)");
    typeVisual([")", "^", "2"]);
    expect(editor.tex).toBe("f(x)^{2}");
  });

  it("nel testo `->` resta com'è", async () => {
    const { typeVisual, editor } = await open("");
    typeVisual(["\"", "a", "-", ">"]);
    expect(editor.tex).toBe("\\text{a->}");
  });

  it("l'IME scrive il suo testo com'è", async () => {
    const { field, editor } = await open("");
    // happy-dom non dà il testo a `CompositionEvent`: un evento col suo `data`.
    field().dispatchEvent(Object.assign(new Event("compositionend", { bubbles: true }), { data: "->" }));
    expect(editor.tex).toBe("->");
  });
});

// ── Nella nota ───────────────────────────────────────────────────────────────

function mount(doc: string, anchor: number, source: boolean, help: MathHelp, compartment = new Compartment()): EditorView {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [
        markdown({ base: markdownGrammar }),
        livePreview({ openWikilink() {}, searchTag() {} }),
        Prec.highest(liveReveal.of("mai")),
        compartment.of([mathSource.of(source), mathHelp.of(help)]),
      ],
    }),
  });
  ensureSyntaxTree(view.state, view.state.doc.length, 1000);
  view.dispatch({});
  views.push(view);
  return view;
}

describe("nella nota", () => {
  it("un blocco `$$` con «Mostra il LaTeX» si apre col campo, e le impostazioni lo cambiano", async () => {
    const doc = "a\n\n$$\nx^{2}\n$$\n";
    const preferences = new Compartment();
    const view = mount(doc, 0, true, "piene", preferences);
    view.dispatch({ selection: { anchor: doc.indexOf("x") } });
    await drawn(".cm-fub-mx-block .cm-fub-mx .cm-fub-mx-surface");
    const editor = document.querySelector<HTMLElement>(".cm-fub-mx-block .cm-fub-mx")!;
    expect(editor.dataset.mode).toBe("source");
    expect(editor.querySelector("textarea")!.value).toBe("x^{2}");
    view.dispatch({ effects: preferences.reconfigure([mathSource.of(false), mathHelp.of("piene")]) });
    expect(editor.dataset.mode).toBe("visual");
    view.dispatch({ effects: preferences.reconfigure([mathSource.of(true), mathHelp.of("spente")]) });
    expect(editor.dataset.mode).toBe("source");
    expect(editor.dataset.help).toBe("spente");
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("i tre puntini scrivono le impostazioni; se non si può, torna la scelta di prima", async () => {
    const doc = "a\n\n$$\nx\n$$\n";
    const view = mount(doc, 0, true, "piene");
    view.dispatch({ selection: { anchor: doc.indexOf("x") } });
    await drawn(".cm-fub-mx-block .cm-fub-mx .cm-fub-mx-surface");
    const editor = document.querySelector<HTMLElement>(".cm-fub-mx-block .cm-fub-mx")!;
    editor.querySelector<HTMLElement>(".cm-fub-mx-more")!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    editor.querySelector<HTMLElement>("[data-help=discrete]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(store.saved).toEqual([["editor.math.help", "discrete"]]);
    expect(editor.dataset.help).toBe("discrete");
    store.fail = true;
    editor.querySelector<HTMLElement>("[data-source=off]")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(editor.dataset.mode).toBe("visual");
    await settle();
    // Le impostazioni dicono ancora «Sì» e «Pieni»: torna quello.
    expect(editor.dataset.mode).toBe("source");
    expect(editor.dataset.help).toBe("piene");
    expect(notices.calls.some((call) => call.tone === "guasto" && call.message.startsWith("Non ho potuto salvare la scelta"))).toBe(true);
  });
});
