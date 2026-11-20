// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openLifetime, type Lifetime } from "../../../../../ui/lifetime";
import { MathEditor } from "./editor";
import { attachPalette } from "./palette";
import { drawn, MATH_READY_MS, mathReady } from "./test-drawn";

// La tavolozza sotto la formula toccata (T62, E27): gli otto pezzi e «Tutti»,
// i sette gruppi, la ricerca a parole, il nome in fondo; tutta da tastiera.

// KaTeX e i pezzi che arrivano con un `import()` qui ci sono già.
beforeAll(mathReady, MATH_READY_MS);

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

/// Il disegno al fotogramma dopo (KaTeX è già caricato da `mathReady`).
const settle = () => new Promise((done) => setTimeout(done, 40));

async function open(tex: string) {
  const life = openLifetime();
  lives.push(life);
  const changes: string[] = [];
  const editor = new MathEditor({ tex, display: false, start: "end", onChange: (next) => changes.push(next), onLeave: () => {}, lifetime: life });
  const palette = attachPalette(editor, life);
  document.body.append(editor.element);
  editor.focus();
  await drawn(".cm-fub-mx-surface", editor.element);
  const root = editor.element;
  const field = root.querySelector<HTMLTextAreaElement>(".cm-fub-mx-input")!;
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const $$ = (selector: string) => [...root.querySelectorAll<HTMLElement>(selector)];
  const key = (target: Element, key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };
  /// Un clic dalla tastiera (Invio o spazio su un pulsante): `detail` 0.
  const press = (element: HTMLElement) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
  const grid = () => $$(".cm-fub-mx-grid .cm-fub-mx-tile").map((tile) => tile.getAttribute("aria-label"));
  return { editor, palette, root, field, $, $$, key, press, grid, changes, life };
}

describe("la tavolozza", () => {
  it("sotto la formula gli otto pezzi disegnati, col nome per chi ascolta, e «Tutti»", async () => {
    const { $, $$ } = await open("x");
    const quick = $$(".cm-fub-mx-quick .cm-fub-mx-tile");
    expect(quick.map((tile) => tile.getAttribute("aria-label"))).toEqual([
      "Frazione", "Potenza", "Pedice", "Radice quadrata", "Sommatoria", "Integrale", "Limite", "Testo",
    ]);
    for (const tile of quick) expect(tile.querySelector(".katex")).not.toBeNull();
    // Il LaTeX non si vede: solo il disegno.
    expect($(".cm-fub-mx-quick").textContent).not.toContain("\\frac");
    expect($(".cm-fub-mx-quick").getAttribute("role")).toBe("toolbar");
    expect($(".cm-fub-mx-all").textContent).toBe("Tutti");
    expect($(".cm-fub-mx-all").getAttribute("aria-expanded")).toBe("false");
    expect($(".cm-fub-mx-full").hidden).toBe(true);
  });

  it("in fondo il nome del simbolo sotto il puntatore, o l'invito", async () => {
    const { $, $$ } = await open("x");
    const tip = $(".cm-fub-mx-tip");
    expect(tip.textContent).toBe("Passa su un simbolo per vedere come si chiama");
    $$(".cm-fub-mx-quick .cm-fub-mx-tile")[3]!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(tip.querySelector(".cm-fub-mx-tip-name")!.textContent).toBe("Radice quadrata");
    // La sua scrittura veloce (T63), e niente LaTeX: la formula si tocca.
    expect(tip.querySelector(".cm-fub-mx-tip-quick")!.textContent).toBe("veloce: sqrt");
    expect(tip.querySelector("code")).toBeNull();
    $(".cm-fub-mx-all").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(tip.textContent).toBe("Passa su un simbolo per vedere come si chiama");
  });

  it("un pezzo scelto entra dove sta il cursore, coi suoi spazi vuoti, e il fuoco resta nella formula", async () => {
    const { $$, changes, field, editor } = await open("x+");
    const fraction = $$(".cm-fub-mx-quick .cm-fub-mx-tile")[0]!;
    // Il clic non ruba il fuoco alla formula.
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    fraction.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    fraction.click();
    expect(changes[changes.length - 1]).toBe("x+\\frac{}{}");
    expect(document.activeElement).toBe(field);
    // Il cursore nel primo spazio vuoto: il numeratore.
    await settle();
    expect(editor.element.querySelector("[role=status]")!.textContent).toBe("numeratore, spazio vuoto");
  });

  it("«Tutti» apre i sette gruppi, la ricerca e la griglia del primo gruppo", async () => {
    const { $, $$, grid } = await open("x");
    $(".cm-fub-mx-all").click();
    expect($(".cm-fub-mx-all").getAttribute("aria-expanded")).toBe("true");
    expect($(".cm-fub-mx-full").hidden).toBe(false);
    const tabs = $$(".cm-fub-mx-group");
    expect(tabs.map((tab) => tab.getAttribute("aria-label"))).toEqual([
      "Struttura", "Lettere greche", "Operatori", "Relazioni", "Frecce", "Insiemi e logica", "Parentesi e matrici",
    ]);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(grid()).toHaveLength(16);
    tabs[1]!.click();
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
    expect(grid()).toContain("Alfa");
    expect(grid()).toHaveLength(19);
    expect($(".cm-fub-mx-grid").getAttribute("aria-labelledby")).toBe(tabs[1]!.id);
  });

  it("la ricerca a parole cambia la griglia; senza risultati lo dice", async () => {
    const { $, root, grid, changes } = await open("x");
    $(".cm-fub-mx-all").click();
    const find = $<HTMLInputElement>(".cm-fub-mx-find-input");
    expect(find.placeholder).toBe("Cerca: alfa, radice, freccia…");
    find.value = "radice";
    find.dispatchEvent(new Event("input", { bubbles: true }));
    expect(grid()).toEqual(["Radice quadrata", "Radice ennesima"]);
    expect(root.querySelector(".cm-fub-mx-searching")).not.toBeNull();
    find.value = "zzz";
    find.dispatchEvent(new Event("input", { bubbles: true }));
    expect(grid()).toEqual([]);
    expect($(".cm-fub-mx-none").textContent).toContain("Nessun simbolo con questo nome");
    expect($(".cm-fub-mx-none").getAttribute("role")).toBe("status");
    // Un gruppo toglie la ricerca.
    $$group(root, 4).click();
    expect(find.value).toBe("");
    expect(grid()[0]).toBe("Freccia a destra");
    // Invio nel campo mette il primo trovato.
    find.value = "alfa";
    find.dispatchEvent(new Event("input", { bubbles: true }));
    // Invio ed Esc che chiudono una composizione (WebKit: codice 229) restano
    // del campo: niente simbolo, la tavolozza resta.
    const before = changes.length;
    for (const name of ["Enter", "Escape"]) {
      const composing = new KeyboardEvent("keydown", { key: name, keyCode: 229, bubbles: true, cancelable: true });
      find.dispatchEvent(composing);
      expect(composing.defaultPrevented, name).toBe(false);
    }
    expect(changes.length).toBe(before);
    find.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(changes[changes.length - 1]).toBe("x\\alpha");
  });

  it("tutta da tastiera: Alt ↓ porta ai pezzi, le frecce li scorrono, Esc torna alla formula", async () => {
    const { field, key, $, $$, press, changes } = await open("x");
    expect(key(field, "ArrowDown", { altKey: true }).defaultPrevented).toBe(true);
    const quick = $$(".cm-fub-mx-quick .cm-fub-mx-tile");
    expect(document.activeElement).toBe(quick[0]);
    // Un solo Tab nella fila.
    expect(quick[0]!.tabIndex).toBe(0);
    expect(quick[1]!.tabIndex).toBe(-1);
    key(quick[0]!, "ArrowRight");
    expect(document.activeElement).toBe(quick[1]);
    // Il nome si legge anche per il pezzo col fuoco.
    expect($(".cm-fub-mx-tip .cm-fub-mx-tip-name").textContent).toBe("Potenza");
    key(quick[1]!, "End");
    expect(document.activeElement).toBe($(".cm-fub-mx-all"));
    key($(".cm-fub-mx-all"), "Escape");
    expect(document.activeElement).toBe(field);
    // Maiusc Tab dalla fila torna alla formula.
    key(field, "ArrowDown", { altKey: true });
    key(document.activeElement!, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(field);
    // La fila ricorda dov'era; Home torna al primo pezzo, Invio lo mette e
    // il fuoco torna nella formula.
    key(field, "ArrowDown", { altKey: true });
    expect(document.activeElement).toBe($(".cm-fub-mx-all"));
    key(document.activeElement!, "Home");
    expect(document.activeElement).toBe(quick[0]);
    press(quick[0]!);
    expect(changes[changes.length - 1]).toBe("x\\frac{}{}");
    expect(document.activeElement).toBe(field);
  });

  it("da tastiera «Tutti» porta al campo; ↓ alla griglia, le frecce in due dimensioni, ↑ ai gruppi", async () => {
    const { field, key, $, $$, press, changes } = await open("x");
    key(field, "ArrowDown", { altKey: true });
    press($(".cm-fub-mx-all"));
    const find = $<HTMLInputElement>(".cm-fub-mx-find-input");
    expect(document.activeElement).toBe(find);
    // Le lettere nel campo non arrivano alla nota né all'app.
    const letter = key(find, "a");
    expect(letter.defaultPrevented).toBe(false);
    key(find, "ArrowDown");
    const tiles = $$(".cm-fub-mx-grid .cm-fub-mx-tile");
    expect(document.activeElement).toBe(tiles[0]);
    key(tiles[0]!, "ArrowRight");
    expect(document.activeElement).toBe(tiles[1]);
    key(tiles[1]!, "ArrowDown");
    expect(document.activeElement).toBe(tiles[11]);
    key(tiles[11]!, "ArrowUp");
    expect(document.activeElement).toBe(tiles[1]);
    key(tiles[1]!, "ArrowUp");
    const tabs = $$(".cm-fub-mx-group");
    expect(document.activeElement).toBe(tabs[0]);
    // Fra i gruppi le frecce scelgono.
    key(tabs[0]!, "ArrowRight");
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
    expect(tabs[1]!.tabIndex).toBe(0);
    expect(tabs[0]!.tabIndex).toBe(-1);
    // Il Tab dalla griglia segue la pagina: la tavolozza non lo trattiene.
    const greek = $$(".cm-fub-mx-grid .cm-fub-mx-tile");
    greek[0]!.focus();
    expect(key(greek[0]!, "Tab").defaultPrevented).toBe(false);
    // Un simbolo della griglia, da tastiera.
    greek[0]!.focus();
    press(greek[0]!);
    expect(changes[changes.length - 1]).toBe("x\\alpha");
    expect(document.activeElement).toBe(field);
  });

  it("si toglie con la sua vita", async () => {
    const { $, life, field, key } = await open("x");
    const tile = $(".cm-fub-mx-quick .cm-fub-mx-tile");
    life.close();
    key(field, "ArrowDown", { altKey: true });
    expect(document.activeElement).not.toBe(tile);
  });
});

function $$group(root: HTMLElement, index: number): HTMLElement {
  return root.querySelectorAll<HTMLElement>(".cm-fub-mx-group")[index]!;
}
