// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { markdownGrammar } from "./grammar";
import { livePreview } from "./livepreview";
import { liveReveal, mathClassic } from "../../live-reveal";
import { mathEditing } from "./math-live";
import { parsedView } from "./test-support";

// Il riquadro che modifica una formula arriva con un `import()`
// (`math-editing.ts`). Qui il suo arrivo lo decide la prova (`gate`): i gesti
// arrivano prima del codice, a freddo, e nessuno si perde. Ogni file di prova
// ha i suoi moduli: il pezzo parte da vuoto.
const gate = vi.hoisted(() => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
});
vi.mock("./math-editing", async (importOriginal) => {
  await gate.opened;
  return importOriginal();
});

beforeEach(() => {
  Object.defineProperty(document, "compatMode", { configurable: true, value: "CSS1Compat" });
});

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  Reflect.deleteProperty(document, "compatMode");
});

function mount(doc: string, anchor: number): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [
        markdown({ base: markdownGrammar }),
        livePreview({ openWikilink() {}, searchTag() {} }),
        Prec.highest(liveReveal.of("mai")),
        mathClassic.of(false),
      ],
    }),
  });
  parsedView(view);
  views.push(view);
  return view;
}

const press = (view: EditorView, key: string) => runScopeHandlers(view, new KeyboardEvent("keydown", { key }), "editor");
const settle = () => new Promise((done) => setTimeout(done, 20));

describe("il gesto che arriva prima del riquadro della formula", () => {
  it("si fa appena il codice arriva; un cursore spostato nel frattempo lo annulla", async () => {
    expect(mathEditing.current()).toBeNull();

    // Una formula in riga toccata a freddo: → è preso subito, la nota non si
    // muove sotto il cursore, il riquadro aspetta il suo codice.
    const kept = mount("x $a+b$ y", 2);
    kept.focus();
    expect(press(kept, "ArrowRight")).toBe(true);
    expect(kept.state.selection.main.head).toBe(2);

    // Un'altra nota: toccata e poi lasciata (il cursore va altrove) prima che
    // il codice arrivi. Il tocco vecchio non le ruba il fuoco dopo.
    const left = mount("y $c$ z", 2);
    left.focus();
    expect(press(left, "ArrowRight")).toBe(true);
    left.dispatch({ selection: { anchor: 0 }, userEvent: "select" });

    // Un blocco `$$` col cursore dentro, a freddo: al suo posto la formula
    // resa, non un buco.
    const block = mount("a\n\n$$\nE = mc^2\n$$\n\nb", 0);
    block.dispatch({ selection: { anchor: 5 }, userEvent: "select" });
    await settle();
    expect(document.querySelector(".cm-fub-mx")).toBeNull();
    expect(document.querySelector(".cm-fub-mx-popover")).toBeNull();
    const waiting = block.dom.querySelector(".cm-fub-mx-block");
    expect(waiting?.querySelector(".cm-fub-math-preview .math-block")).not.toBeNull();

    // Il codice arriva.
    gate.open();
    await mathEditing.load();
    await vi.waitFor(() => expect(document.querySelectorAll(".cm-fub-mx-popover")).toHaveLength(1));
    // Il riquadro aperto è quello della nota che aspettava, sulla sua formula.
    expect(kept.dom.querySelector(".cm-fub-math.cm-fub-math-on")).not.toBeNull();
    expect(left.dom.querySelector(".cm-fub-math.cm-fub-math-on")).toBeNull();
    expect(left.state.selection.main.head).toBe(0);
    // Il blocco ha il suo riquadro, col TeX del blocco, al posto della resa.
    await vi.waitFor(() => expect(block.dom.querySelector(".cm-fub-mx-block .cm-fub-mx")).not.toBeNull());
    expect(block.dom.querySelector(".cm-fub-mx-block .cm-fub-math-preview")).toBeNull();
    expect(block.state.doc.toString()).toBe("a\n\n$$\nE = mc^2\n$$\n\nb");
  });
});
