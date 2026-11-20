// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../../../ui/lifetime";
import { MathEditor } from "./editor";
import { SYMBOLS } from "./symbols";
import { drawn, drawnWhen, MATH_READY_MS, mathReady } from "./test-drawn";

// Scegliere un pezzo, le celle delle matrici, il tocco (T66, E27): la formula
// che si tocca col suo DOM, con KaTeX vero. Il disegno di happy-dom non ha
// misure: per il puntatore ogni segno sta a 10 px per offset del TeX, così il
// clic e il trascinamento cadono dove dice il test. Il disegno vero lo
// guardano le scene del banco.

// KaTeX e i pezzi che arrivano con un `import()` (`ui/lazy-part.ts`) qui ci
// sono già: i gesti si guardano col loro codice.
beforeAll(mathReady, MATH_READY_MS);

const lives: Lifetime[] = [];
let rects: ReturnType<typeof vi.spyOn> | null = null;
beforeEach(() => {
  // KaTeX non disegna in quirks mode, e happy-dom non dice il suo modo.
  Object.defineProperty(document, "compatMode", { configurable: true, value: "CSS1Compat" });
  rects = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const at = Number(this.getAttribute("data-fubp"));
    const left = Number.isFinite(at) ? at * 10 : 0;
    return { left, right: left, top: 0, bottom: 20, x: left, y: 0, width: 0, height: 20, toJSON: () => ({}) } as DOMRect;
  });
});
afterEach(() => {
  for (const life of lives.splice(0)) life.close();
  rects?.mockRestore();
  document.body.replaceChildren();
  Reflect.deleteProperty(document, "compatMode");
});

async function open(tex: string, display = false) {
  const life = openLifetime();
  lives.push(life);
  const changes: string[] = [];
  const left: string[] = [];
  const editor = new MathEditor({ tex, display, start: "end", onChange: (next) => changes.push(next), onLeave: (reason) => left.push(reason), lifetime: life });
  document.body.append(editor.element);
  editor.focus();
  await drawn(".cm-fub-mx-surface", editor.element);
  const field = editor.element.querySelector("textarea")!;
  const press = (key: string, init: KeyboardEventInit = {}) => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  };
  const status = () => editor.element.querySelector("[role=status]")!.textContent ?? "";
  const chosen = () => editor.element.querySelector("[data-fubsel]")?.textContent ?? null;
  return { editor, field, press, status, chosen, changes, left };
}

describe("scegliere un pezzo", () => {
  it("Maiusc ← sceglie un pezzo intero alla volta; il pezzo si colora e si dice", async () => {
    const { editor, press, status, chosen } = await open("a+\\frac{b}{c}");
    press("ArrowLeft", { shiftKey: true });
    expect(editor.element.dataset.chosen).toBe("true");
    expect(status()).toBe("pezzo scelto");
    await drawn("[data-fubsel] .mfrac", editor.element);
    // Il segno della scelta abbraccia la frazione disegnata.
    expect(editor.element.querySelector("[data-fubsel] .mfrac")).not.toBeNull();
    expect(editor.element.querySelector(".cm-fub-mx-caret")).toBeNull();
    // Il browser manda Maiusc da solo prima di ogni ←: la scelta resta.
    press("Shift", { shiftKey: true });
    expect(editor.element.dataset.chosen).toBe("true");
    press("ArrowLeft", { shiftKey: true });
    await drawnWhen("la scelta allargata al +", () => chosen()?.includes("+") ?? false, editor.element);
    // La scelta si è allargata al +, con la frazione.
    expect(chosen()).toContain("+");
    expect(editor.element.querySelector("[data-fubsel] .mfrac")).not.toBeNull();
    press("ArrowRight", { shiftKey: true });
    await drawnWhen("la scelta ristretta dalla sua fine", () => chosen() !== null && !chosen()!.includes("+"), editor.element);
    expect(chosen()).not.toBeNull();
    // → lascia la scelta dalla sua fine; il cursore torna.
    press("ArrowRight");
    expect(editor.element.dataset.chosen).toBeUndefined();
    await drawnWhen("la scelta lasciata col cursore di nuovo", () => chosen() === null && editor.element.querySelector(".cm-fub-mx-caret") !== null, editor.element);
    expect(chosen()).toBeNull();
    expect(editor.element.querySelector(".cm-fub-mx-caret")).not.toBeNull();
  });

  it("Esc lascia la scelta senza uscire dalla formula; Ctrl A sceglie tutto", async () => {
    const { editor, press, left } = await open("x+y");
    press("a", { ctrlKey: true });
    expect(editor.element.dataset.chosen).toBe("true");
    press("Escape");
    expect(editor.element.dataset.chosen).toBeUndefined();
    expect(left).toEqual([]);
    press("Escape");
    expect(left).toEqual(["escape"]);
  });

  it("/, ^ e la tavolozza mettono il pezzo in una frazione, in un esponente, sotto una radice", async () => {
    const fraction = await open("a+bc");
    // Un pezzo alla volta: c, poi bc.
    fraction.press("ArrowLeft", { shiftKey: true });
    fraction.press("ArrowLeft", { shiftKey: true });
    fraction.press("/");
    expect(fraction.editor.tex).toBe("a+\\frac{bc}{}");
    expect(fraction.status()).toBe("denominatore, spazio vuoto");

    const power = await open("x+\\alpha");
    power.press("ArrowLeft", { shiftKey: true });
    power.press("^");
    expect(power.editor.tex).toBe("x+^{\\alpha}");

    const root = await open("a+bc");
    root.press("ArrowLeft", { shiftKey: true });
    root.press("ArrowLeft", { shiftKey: true });
    expect(root.editor.insert(SYMBOLS.find((symbol) => symbol.template === "\\sqrt{}")!)).toBe(true);
    expect(root.editor.tex).toBe("a+\\sqrt{bc}");
    expect(root.changes[root.changes.length - 1]).toBe("a+\\sqrt{bc}");
  });

  it("un segno sostituisce il pezzo, e Ctrl Z lo rimette in un passo solo; Backspace lo toglie", async () => {
    const { editor, press } = await open("a+\\frac{b}{c}");
    press("ArrowLeft", { shiftKey: true });
    press("y");
    expect(editor.tex).toBe("a+y");
    press("z", { ctrlKey: true });
    expect(editor.tex).toBe("a+\\frac{b}{c}");
    press("End");
    press("ArrowLeft", { shiftKey: true });
    press("Backspace");
    expect(editor.tex).toBe("a+");
  });

  it("Ctrl C copia il LaTeX del pezzo; Ctrl X lo copia e lo toglie", async () => {
    const { editor, field, press } = await open("a+\\frac{b}{c}");
    press("ArrowLeft", { shiftKey: true });
    press("c", { ctrlKey: true });
    // Per la copia del sistema il campo ha il LaTeX, scelto.
    expect(field.value).toBe("\\frac{b}{c}");
    const copy = new DataTransfer();
    const copied = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: copy });
    field.dispatchEvent(copied);
    expect(copied.defaultPrevented).toBe(true);
    expect(copy.getData("text/plain")).toBe("\\frac{b}{c}");
    expect(field.value).toBe("");
    expect(editor.tex).toBe("a+\\frac{b}{c}");
    const cut = new DataTransfer();
    field.dispatchEvent(new ClipboardEvent("cut", { bubbles: true, cancelable: true, clipboardData: cut }));
    expect(cut.getData("text/plain")).toBe("\\frac{b}{c}");
    expect(editor.tex).toBe("a+");
  });

  it("senza un pezzo scelto Ctrl C resta dell'app", async () => {
    const { field, press } = await open("a+b");
    press("c", { ctrlKey: true });
    expect(field.value).toBe("");
    const data = new DataTransfer();
    const event = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data });
    field.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("il puntatore", () => {
  const pointer = (target: Element, type: string, x: number, pointerType: string, init: PointerEventInit = {}) => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 10, pointerId: 1, isPrimary: true, button: 0, pointerType, ...init }));
  };

  it("il mouse trascinando sceglie pezzi interi; Maiusc clic allarga la scelta", async () => {
    // 0 a 1 + 2 \frac{ 8 b 9 }{ 11 c 12 } 13
    const { editor, chosen } = await open("a+\\frac{b}{c}");
    const surface = editor.element.querySelector(".cm-fub-mx-surface")!;
    pointer(surface, "pointerdown", 20, "mouse");
    pointer(surface, "pointermove", 85, "mouse");
    pointer(surface, "pointerup", 85, "mouse");
    // Dal + alla metà del numeratore: la frazione intera.
    expect(editor.element.dataset.chosen).toBe("true");
    await drawn("[data-fubsel] .mfrac", editor.element);
    expect(chosen()).not.toBeNull();
    expect(editor.element.querySelector("[data-fubsel] .mfrac")).not.toBeNull();
    pointer(surface, "pointerdown", 0, "mouse");
    pointer(surface, "pointerup", 0, "mouse");
    expect(editor.element.dataset.chosen).toBeUndefined();
    pointer(surface, "pointerdown", 20, "mouse", { shiftKey: true });
    pointer(surface, "pointerup", 20, "mouse");
    expect(editor.element.dataset.chosen).toBe("true");
  });

  it("il dito porta il cursore con sé, senza scegliere", async () => {
    const { editor, status } = await open("a+\\frac{b}{c}");
    const surface = editor.element.querySelector<HTMLElement>(".cm-fub-mx-surface")!;
    // Sulla formula il dito non fa scorrere la nota.
    expect(surface.style.touchAction).toBe("none");
    pointer(surface, "pointerdown", 0, "touch");
    expect(status()).toBe("inizio della formula");
    pointer(surface, "pointermove", 90, "touch");
    expect(status()).toBe("numeratore");
    pointer(surface, "pointermove", 115, "touch");
    expect(status()).toBe("denominatore");
    pointer(surface, "pointerup", 115, "touch");
    expect(editor.element.dataset.chosen).toBeUndefined();
    // Il clic che segue il tocco, nello stesso punto, non sposta niente.
    surface.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: 115, clientY: 10 }));
    expect(status()).toBe("denominatore");
  });
});

describe("le celle di una matrice", () => {
  it("Tab passa alla cella dopo, Invio alla riga dopo; dall'ultima riga ne nasce una", async () => {
    const tex = "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}";
    const { editor, press, status, left } = await open(tex);
    press("Home");
    press("ArrowRight");
    expect(status()).toBe("riga 1, colonna 1");
    press("Tab");
    expect(status()).toBe("riga 1, colonna 2");
    press("Enter");
    expect(status()).toBe("riga 2, colonna 2");
    press("Enter");
    expect(editor.tex).toBe("\\begin{pmatrix} a & b \\\\ c & d \\\\ & \\end{pmatrix}");
    expect(status()).toBe("riga 3, colonna 1, spazio vuoto");
    press("x");
    press("Tab");
    expect(status()).toBe("riga 3, colonna 2, spazio vuoto");
    expect(editor.tex).toBe("\\begin{pmatrix} a & b \\\\ c & d \\\\ x& \\end{pmatrix}");
    expect(left).toEqual([]);
  });

  it("una matrice vuota della tavolozza ha un quadretto per cella", async () => {
    const { editor } = await open("");
    expect(editor.insert(SYMBOLS.find((symbol) => symbol.template.startsWith("\\begin{pmatrix} § &  \\\\"))!)).toBe(true);
    await drawnWhen("i quattro quadretti della matrice", () => editor.element.querySelectorAll(".cm-fub-mx-surface [data-fubhole]").length === 4, editor.element);
    expect(editor.element.querySelectorAll(".cm-fub-mx-surface [data-fubhole]")).toHaveLength(4);
  });
});
