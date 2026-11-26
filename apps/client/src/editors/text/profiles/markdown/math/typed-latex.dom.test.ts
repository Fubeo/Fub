// @vitest-environment happy-dom
// Il LaTeX scritto a mano nella formula che si tocca, tasto per tasto come
// la tastiera (IMP-420, IMP-719): i comandi per nome dentro uno spazio vuoto,
// le graffe del LaTeX, gli esponenti di un segno e la chiusura `$`/`$$`.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { openLifetime, type Lifetime } from "../../../../../ui/lifetime";
import { MathEditor, type LeaveReason } from "./editor";
import { drawn, MATH_READY_MS, mathReady } from "./test-drawn";

// KaTeX e i pezzi che arrivano con un `import()` qui ci sono già: il disegno
// dopo ogni tasto è un fotogramma.
beforeAll(mathReady, MATH_READY_MS);

const settle = () => new Promise((done) => setTimeout(done, 20));
const lives: Lifetime[] = [];
afterEach(() => {
  for (const life of lives.splice(0)) life.close();
  document.body.replaceChildren();
});

async function open(display: boolean) {
  Object.defineProperty(document, "compatMode", { configurable: true, value: "CSS1Compat" });
  const life = openLifetime();
  lives.push(life);
  const written: string[] = [];
  const left: LeaveReason[] = [];
  const editor = new MathEditor({
    tex: "",
    display,
    start: "end",
    onChange: (tex) => written.push(tex),
    onLeave: (reason) => left.push(reason),
    lifetime: life,
  });
  document.body.append(editor.element);
  editor.focus();
  await drawn(".cm-fub-mx-surface", editor.element);
  const field = editor.element.querySelector("textarea")!;
  /// Un tasto alla volta: keydown, e il testo nel campo se il tasto non è
  /// stato preso, come fa il navigatore.
  const type = async (text: string) => {
    for (const ch of text) {
      const event = new KeyboardEvent("keydown", { key: ch, bubbles: true, cancelable: true });
      field.dispatchEvent(event);
      if (!event.defaultPrevented) {
        field.value += ch;
        field.dispatchEvent(new InputEvent("input", { data: ch, inputType: "insertText", bubbles: true }));
      }
      await settle();
    }
  };
  return { type, tex: () => written[written.length - 1] ?? "", left };
}

describe("il LaTeX scritto a mano nella formula che si tocca", () => {
  it("un comando per nome dentro uno spazio vuoto resta lì, e le graffe scritte chiudono i pezzi", async () => {
    const formula = await open(true);
    await formula.type("r = \\frac{\\ln L_t}{t}");
    expect(formula.tex()).toBe("r=\\frac{\\ln L_{t}}{t}");
  });

  it("un esponente aperto col suo tasto si chiude col segno o lo spazio che segue", async () => {
    const formula = await open(true);
    await formula.type("x^2 + y_1=r^10");
    expect(formula.tex()).toBe("x^{2}+y_{1}=r^{10}");
  });

  it("con la graffa l'esponente prende tutto fino alla sua chiusura", async () => {
    const formula = await open(true);
    await formula.type("e^{-x+1}+1");
    expect(formula.tex()).toBe("e^{-x+1}+1");
  });

  it("in un blocco `$$` lascia la formula, e il TeX resta senza dollari", async () => {
    const formula = await open(true);
    await formula.type("a+b$$");
    expect(formula.tex()).toBe("a+b");
    expect(formula.left).toEqual(["close"]);
  });

  it("in un blocco una `$` sola resta un segno", async () => {
    const formula = await open(true);
    await formula.type("5$a");
    expect(formula.tex()).toBe("5\\$a");
    expect(formula.left).toEqual([]);
  });

  it("in riga una `$` chiude la formula", async () => {
    const formula = await open(false);
    await formula.type("\\pi r^2$");
    expect(formula.tex()).toBe("\\pi r^{2}");
    expect(formula.left).toEqual(["close"]);
  });
});
