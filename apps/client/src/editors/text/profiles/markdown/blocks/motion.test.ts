// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { history } from "@codemirror/commands";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { markdownGrammar } from "../grammar";
import { livePreview } from "../livepreview";
import { liveReveal } from "../../../live-reveal";
import { blockGesture } from "../block-gesture";
import { liveStrings } from "../strings";
import { blocksMode } from "./index";
import { blockModel } from "./model";
import { moveSiblings, siblingsOf } from "./move";
import { blockAt, gesturePhrase, inferGesture, placeName } from "./motion";

// Il blocco vivo (N13): che cosa si muove, quando, e che cosa si dice.

const moto = vi.hoisted(() => ({ level: "full" as "full" | "calm" | "reduced", runs: [] as { el: Element; spec: Record<string, unknown> }[] }));
vi.mock("../../../../../moto", async (original) => {
  const real = await original<typeof import("../../../../../moto")>();
  return {
    ...real,
    motionLevel: () => moto.level,
    animate: (el: Element, spec: Record<string, unknown>) => {
      moto.runs.push({ el, spec });
      return real.animate(el, spec as never);
    },
  };
});

const views: EditorView[] = [];
beforeEach(() => {
  moto.level = "full";
  moto.runs = [];
  // happy-dom non impagina: ogni figlio del contenuto è una riga alta 20 px,
  // al posto che ha fra i fratelli.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const parent = this.parentElement;
    const index = parent?.classList.contains("cm-content") ? Array.from(parent.children).indexOf(this) : 0;
    return { left: 0, top: index * 20, right: 600, bottom: index * 20 + 20, width: 600, height: 20, x: 0, y: index * 20, toJSON() {} } as DOMRect;
  });
});
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function mount(doc: string, anchor = 0): EditorView {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [
        history(),
        markdown({ base: markdownGrammar }),
        livePreview({ openWikilink() {}, searchTag() {} }),
        Prec.highest(liveReveal.of("mai")),
        blocksMode({ page: () => "Nota" }),
      ],
    }),
  });
  ensureSyntaxTree(view.state, view.state.doc.length, 1000);
  view.dispatch({});
  views.push(view);
  return view;
}

const press = (view: EditorView, key: string, extra: KeyboardEventInit = {}) =>
  runScopeHandlers(view, new KeyboardEvent("keydown", { key, ...extra }), "editor");

/// Le misure di CodeMirror passano da un fotogramma.
const frame = () => new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));

/// Montata la vista, la pagina è arrivata: da qui contano soltanto i gesti.
async function mounted(doc: string, anchor = 0): Promise<EditorView> {
  const view = mount(doc, anchor);
  await frame();
  moto.runs = [];
  return view;
}

const live = (view: EditorView) => view.dom.querySelector(".cm-fub-block-live")?.textContent?.trim() ?? null;

describe("i gesti che si fanno scrivendo", () => {
  it("una battuta normale non è un gesto", () => {
    const view = mount("Uno\n\nDue", 3);
    let gesture: unknown = "non letto";
    view.dispatch({ changes: { from: 3, insert: "x" }, userEvent: "input.type" });
    const update = { transactions: [], state: view.state, startState: view.state } as never;
    expect(inferGesture(update)).toBeNull();
    const state = view.state;
    const tr = state.update({ changes: { from: 4, insert: "y" }, userEvent: "input.type" });
    gesture = inferGesture({ transactions: [tr], state: tr.state, startState: state, changes: tr.changes } as never);
    expect(gesture).toBeNull();
  });

  it("un a capo fa nascere, un Backspace che unisce le righe toglie, «## » trasforma", () => {
    const view = mount("Uno\n\nDue", 3);
    const state = view.state;
    const enter = state.update({ changes: { from: 3, insert: "\n" }, userEvent: "input" });
    expect(inferGesture({ transactions: [enter], state: enter.state, startState: state, changes: enter.changes } as never)?.kind).toBe("born");
    const back = state.update({ changes: { from: 3, to: 4 }, userEvent: "delete.backward" });
    expect(inferGesture({ transactions: [back], state: back.state, startState: state, changes: back.changes } as never)?.kind).toBe("gone");
    const heading = state.update({ changes: { from: 5, insert: "## " }, selection: { anchor: 8 }, userEvent: "input.type" });
    const gesture = inferGesture({ transactions: [heading], state: heading.state, startState: state, changes: heading.changes } as never);
    expect(gesture?.kind).toBe("transform");
    expect(gesture?.lead).toEqual({ from: 5, to: 11 });
  });

  it("annullare non è un gesto", () => {
    const view = mount("Uno", 3);
    const state = view.state;
    const undo = state.update({ changes: { from: 3, insert: "\n" }, userEvent: "undo" });
    expect(inferGesture({ transactions: [undo], state: undo.state, startState: state, changes: undo.changes } as never)).toBeNull();
  });
});

describe("le frasi della regione viva", () => {
  it("il posto si dice a parole fino a dieci, poi in cifre", () => {
    expect(placeName(0)).toBe(liveStrings.t("blocks.place.1"));
    expect(placeName(2)).toBe("terzo");
    expect(placeName(11)).toBe(liveStrings.t("blocks.place.n", { n: "12" }));
  });

  it("uno spostamento dice il posto nuovo fra i fratelli", () => {
    const view = mount("Uno\n\nDue\n\nTre", 0);
    const blocks = view.state.field(blockModel).blocks;
    const spec = moveSiblings(view.state, blocks, 0, 0, -1)!;
    const next = view.state.update(spec).state;
    expect(gesturePhrase(next, { kind: "swap", lead: spec.moved })).toBe("Blocco spostato: ora è il terzo");
  });

  it("una trasformazione dice la specie nuova; una frase vuota non dice niente", () => {
    const view = mount("## Titolo", 0);
    expect(gesturePhrase(view.state, { kind: "transform", lead: { from: 0, to: 9 } })).toMatch(/^Ora è /);
    expect(gesturePhrase(view.state, { kind: "drop", say: "" })).toBeNull();
  });

  it("i gesti la scrivono nella regione viva, anche col moto ridotto", () => {
    moto.level = "reduced";
    const view = mount("Uno\n\nDue\n\nTre", 1);
    press(view, "ArrowDown", { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString()).toBe("Due\n\nUno\n\nTre");
    expect(live(view)).toBe("Blocco spostato: ora è il secondo");
    expect(view.dom.querySelector(".cm-fub-block-live")?.getAttribute("aria-live")).toBe("polite");
  });
});

describe("lo spostamento all'indietro", () => {
  it("`origin` riporta ogni riga della finestra al suo posto di prima", () => {
    const view = mount("Uno\n\nDue\n\nTre", 0);
    const state = view.state;
    const blocks = state.field(blockModel).blocks;
    const spec = moveSiblings(state, blocks, 0, 0, -1)!;
    const next = state.update(spec).state;
    // «Due» era a 5 ed è a 0; «Uno» era a 0 ed è dove dice `moved`.
    expect(spec.origin(0)).toBe(5);
    expect(spec.origin(spec.moved.from)).toBe(0);
    expect(next.sliceDoc(spec.moved.from, spec.moved.to)).toBe("Uno");
    expect(spec.follow(0)).toBe(spec.moved.from);
  });

  it("`blockAt` trova il blocco più interno", () => {
    const view = mount("- a\n  - b\n- c", 0);
    const blocks = view.state.field(blockModel).blocks;
    expect(blockAt(blocks, 7)?.from).toBe(4);
    expect(blockAt(blocks, 1)?.from).toBe(0);
    expect(siblingsOf(blocks, 0)).toHaveLength(2);
  });
});

describe("che cosa si muove", () => {
  it("la pagina arriva: copertina, icona e titolo uno dopo l'altro, mai col moto ridotto", async () => {
    mount("---\nicon: 🌿\n---\nUno", 20);
    await frame();
    await new Promise((done) => setTimeout(done, 40));
    const parts = moto.runs.filter((run) => run.el.className.startsWith("cm-fub-page-"));
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.every((run) => run.spec.spring === "wide")).toBe(true);
    moto.runs = [];
    moto.level = "reduced";
    mount("---\nicon: 🌿\n---\nUno", 20);
    await frame();
    await new Promise((done) => setTimeout(done, 40));
    expect(moto.runs).toEqual([]);
  });

  it("lo scambio fa scorrere le righe dal posto vecchio, con la molla", async () => {
    const view = await mounted("Uno\n\nDue\n\nTre", 1);
    press(view, "ArrowDown", { ctrlKey: true, shiftKey: true });
    await frame();
    const lines = moto.runs.filter((run) => run.el.classList.contains("cm-line"));
    expect(lines.length).toBeGreaterThan(0);
    for (const run of lines) expect(run.spec.from).toHaveProperty("y");
    expect(lines.every((run) => run.spec.spring === "soft")).toBe(true);
  });

  it("col moto ridotto uno scambio non muove niente", async () => {
    moto.level = "reduced";
    const view = await mounted("Uno\n\nDue\n\nTre", 1);
    press(view, "ArrowDown", { ctrlKey: true, shiftKey: true });
    await frame();
    expect(moto.runs).toEqual([]);
  });

  it("col moto ridotto chi nasce appare soltanto in dissolvenza", async () => {
    moto.level = "reduced";
    const view = await mounted("Uno", 3);
    view.dispatch({ changes: { from: 3, insert: "\nDue" }, selection: { anchor: 7 }, userEvent: "input" });
    await frame();
    expect(moto.runs.length).toBeGreaterThan(0);
    for (const run of moto.runs) expect(run.spec.whenReduced).toBe("fade");
  });

  it("una battuta normale non muove niente", async () => {
    const view = await mounted("Uno\n\nDue", 3);
    view.dispatch({ changes: { from: 3, insert: "x" }, userEvent: "input.type" });
    await frame();
    expect(moto.runs).toEqual([]);
  });

  it("chi nasce scende di poco e appare", async () => {
    const view = await mounted("Uno", 3);
    view.dispatch({ changes: { from: 3, insert: "\n\nDue" }, selection: { anchor: 8 }, userEvent: "input" });
    await frame();
    const born = moto.runs.find((run) => run.el.textContent === "Due");
    expect(born?.spec.from).toEqual({ y: -8, opacity: 0 });
  });

  it("un gesto annotato senza testo cambiato (il ripiegabile) passa dal plugin", async () => {
    const view = await mounted("Uno\n\nDue", 1);
    view.dispatch({ annotations: blockGesture.of({ kind: "fold", say: "Aperto" }) });
    expect(live(view)).toBe("Aperto");
  });
});
