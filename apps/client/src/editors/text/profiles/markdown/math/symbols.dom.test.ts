// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openLifetime, type Lifetime } from "../../../../../ui/lifetime";
import { MathEditor } from "./editor";

// Le proposte dei simboli nella formula toccata (T61, E27): `\` e le prime
// lettere mostrano i simboli disegnati, col nome; Invio, Tab o lo spazio
// mettono quello scelto, coi suoi spazi vuoti.

beforeEach(() => {
  // KaTeX non disegna in quirks mode, e happy-dom non dice il suo modo.
  Object.defineProperty(document, "compatMode", { configurable: true, value: "CSS1Compat" });
});

const lives: Lifetime[] = [];
afterEach(() => {
  for (const life of lives.splice(0)) life.close();
  document.body.replaceChildren();
  Reflect.deleteProperty(document, "compatMode");
});

/// KaTeX si carica a parte e disegna al fotogramma dopo.
const settle = () => new Promise((done) => setTimeout(done, 40));

async function open(tex: string, inTable = false) {
  const life = openLifetime();
  lives.push(life);
  const changes: string[] = [];
  const editor = new MathEditor({ tex, display: false, start: "end", inTable, onChange: (next) => changes.push(next), onLeave: () => {}, lifetime: life });
  document.body.append(editor.element);
  editor.focus();
  await settle();
  const field = editor.element.querySelector("textarea")!;
  const type = (...keys: string[]) => {
    for (const key of keys) field.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  };
  const list = () => editor.element.querySelector<HTMLElement>(".cm-fub-mx-symbols")!;
  const names = () => [...list().querySelectorAll(".cm-fub-mx-symbol-name")].map((name) => name.textContent);
  const chosen = () => list().querySelector("[aria-selected=true] .cm-fub-mx-symbol-name")?.textContent;
  return { editor, field, type, list, names, chosen, changes };
}

describe("le proposte dei simboli", () => {
  it("compaiono con `\\` e le prime lettere, col simbolo disegnato e il nome, senza il comando", async () => {
    const { type, list, names, chosen, field, changes } = await open("x");
    type("+", "\\", "a", "l");
    expect(list().hidden).toBe(false);
    expect(names()).toContain("Alfa");
    expect(chosen()).toBe("Alfa");
    expect(list().querySelector(".cm-fub-mx-symbol-glyph .katex")).not.toBeNull();
    expect(list().textContent).not.toContain("\\alpha");
    // Il campo nomina la proposta scelta, per il lettore di schermo.
    expect(field.getAttribute("aria-activedescendant")).toBe(list().querySelector("[aria-selected=true]")!.id);
    // Finché non si sceglie, la nota non cambia: il nome sta nella pastiglia.
    expect(changes[changes.length - 1]).toBe("x+");
    type("p", "Enter");
    expect(list().hidden).toBe(true);
    expect(field.hasAttribute("aria-activedescendant")).toBe(false);
    expect(changes[changes.length - 1]).toBe("x+\\alpha");
  });

  it("↑ e ↓ scelgono, Tab mette quella scelta", async () => {
    const { editor, type, chosen } = await open("");
    type("\\", "s", "q", "r", "t");
    expect(chosen()).toBe("Radice quadrata");
    type("ArrowDown");
    expect(chosen()).toBe("Radice ennesima");
    type("ArrowDown");
    expect(chosen()).toBe("Radice quadrata");
    type("ArrowUp", "Tab", "3");
    expect(editor.tex).toBe("\\sqrt[n]{3}");
  });

  it("lo spazio mette un pezzo coi suoi spazi vuoti, e Tab va dall'uno all'altro", async () => {
    const { editor, type } = await open("");
    type("\\", "s", "u", "m", " ", "i", "Tab", "n");
    expect(editor.tex).toBe("\\sum_{i}^{n}");
  });

  it("un nome che non esiste propone il più vicino", async () => {
    const { editor, type, names } = await open("");
    type("\\", "a", "l", "f", "a");
    expect(names()).toEqual(["Alfa"]);
    type(" ");
    expect(editor.tex).toBe("\\alpha");
  });

  it("il clic su una proposta la mette", async () => {
    const { editor, type, list } = await open("");
    type("\\", "f", "r");
    list().querySelector("[role=option]")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    expect(editor.tex).toBe("\\frac{}{}");
  });

  it("Esc chiude le proposte, la lettera dopo le riapre, un secondo Esc toglie il nome", async () => {
    const { editor, type, list } = await open("y");
    type("\\", "a");
    expect(list().hidden).toBe(false);
    type("Escape");
    expect(list().hidden).toBe(true);
    type("l");
    expect(list().hidden).toBe(false);
    type("Escape", "Escape");
    expect(editor.tex).toBe("y");
  });

  it("con le proposte chiuse un pezzo del catalogo entra lo stesso coi suoi spazi vuoti", async () => {
    const { editor, type } = await open("");
    type("\\", "l", "i", "m", "Escape", " ", "x");
    expect(editor.tex).toBe("\\lim_{x}");
  });

  it("Ctrl Z dopo un simbolo torna a prima della barra", async () => {
    const { editor, type, field } = await open("a");
    type("\\", "f", "r", "a", "c", " ");
    expect(editor.tex).toBe("a\\frac{}{}");
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(editor.tex).toBe("a");
  });
});
