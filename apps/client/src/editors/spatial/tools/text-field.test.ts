// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { lineRuns, richLine, richText, type Rich } from "./rich";
import { createTextField, type TextField } from "./text-field";

const BOLD = { "font-weight": "bold" };
const BLUE = { fill: "#0072b2" };

/// Due righe: «Evaporazione» e «in pioggia», con «pioggia» blu e in
/// grassetto.
const TWO: Rich = {
  attrs: { id: "o1", x: "10", y: "40", "font-size": "20" },
  inherited: { fill: "#000000", "font-family": "", "font-size": "16", "font-weight": "normal", "font-style": "normal", "letter-spacing": "normal" },
  lines: [richLine({ x: "10", dy: "0" }, "Evaporazione"), richLine({ x: "10", dy: "25" }, ["in ", { text: "pioggia", attrs: { ...BLUE, ...BOLD } }])],
};

let life: Lifetime | null = null;
let field: TextField;
let finished = 0;
let said: string[] = [];
let changed = 0;

function mount(rich: Rich): void {
  if (life !== null) {
    life.close();
    field.element.remove();
  }
  life = openLifetime();
  finished = 0;
  changed = 0;
  said = [];
  field = createTextField(life, {
    onChange: () => changed++,
    onFinish: () => finished++,
    announce: (text) => said.push(text),
  });
  document.body.append(field.element);
  field.open(rich);
  field.element.focus();
}

afterEach(() => {
  life?.close();
  life = null;
  field.element.remove();
});

const rows = (): HTMLElement[] => [...field.element.querySelectorAll<HTMLElement>(".draw-text-line")];

/// Il punto del DOM del carattere `offset` della riga `line`.
function point(line: number, offset: number): [Node, number] {
  const row = rows()[line]!;
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  let left = offset;
  let last: Text | null = null;
  for (let node = walker.nextNode() as Text | null; node !== null; node = walker.nextNode() as Text | null) {
    if (left <= node.data.length && (left > 0 || last === null)) return [node, left];
    left -= node.data.length;
    last = node;
  }
  return last === null ? [row, 0] : [last, last.data.length];
}

/// Sceglie da `from` a `to`, ciascuno [riga, carattere].
function choose(from: [number, number], to: [number, number] = from): void {
  const [a, ao] = point(...from);
  const [b, bo] = point(...to);
  document.getSelection()!.setBaseAndExtent(a, ao, b, bo);
}

/// Un `beforeinput` come quello del browser; vero se il campo l'ha fatto
/// da sé.
function input(inputType: string, data: string | null = null): boolean {
  const event = new InputEvent("beforeinput", { inputType, data, bubbles: true, cancelable: true });
  field.element.dispatchEvent(event);
  return event.defaultPrevented;
}

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  field.element.dispatchEvent(event);
  return event;
}

describe("scrivere", () => {
  it("si scrive nel modello: il pezzo che continua resta uno, e il campo lo mostra col suo aspetto", () => {
    mount(TWO);
    expect(rows().map((row) => row.textContent)).toEqual(["Evaporazione", "in pioggia"]);
    const piece = rows()[1]!.querySelector<HTMLElement>(".draw-text-piece")!;
    expect(piece.textContent).toBe("pioggia");
    expect(piece.style.fontWeight).toBe("bold");
    expect(piece.style.color).toMatch(/^(#0072b2|rgb\(0, 114, 178\))$/);
    choose([1, 10]);
    expect(input("insertText", "n")).toBe(true);
    expect(input("insertText", "e")).toBe(true);
    expect(lineRuns(field.rich.lines[1]!)).toEqual(["in ", { text: "pioggiane", attrs: { ...BLUE, ...BOLD } }]);
    expect(rows()[1]!.querySelectorAll(".draw-text-piece")).toHaveLength(1);
    expect(changed).toBe(2);
  });

  it("Invio spezza la riga, che scende dell'interlinea; cancellare all'inizio la riunisce", () => {
    mount(TWO);
    choose([1, 3]);
    expect(input("insertParagraph")).toBe(true);
    expect(rows().map((row) => row.textContent)).toEqual(["Evaporazione", "in ", "pioggia"]);
    expect(field.rich.lines.map((line) => line.attrs)).toEqual([{ x: "10", dy: "0" }, { x: "10", dy: "25" }, { x: "10", dy: "25" }]);
    expect(input("deleteContentBackward")).toBe(true);
    expect(richText(field.rich)).toBe("Evaporazione\nin pioggia");
    // Indietro di una parola.
    choose([0, 12]);
    expect(input("deleteWordBackward")).toBe(true);
    expect(richText(field.rich)).toBe("\nin pioggia");
    // Una riga vuota ha la sua altezza.
    expect(rows()[0]!.querySelector("br")).not.toBeNull();
  });

  it("incollare incolla il testo, anche su più righe, con lo stile di dove arriva", () => {
    mount(TWO);
    choose([1, 5], [1, 8]);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: (type: string) => (type === "text/plain" ? "AB\nC\u0007D" : "<b>no</b>") } });
    field.element.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(field.rich.lines.map(lineRuns)).toEqual(["Evaporazione", ["in ", { text: "piAB", attrs: { ...BLUE, ...BOLD } }], [{ text: "CDia", attrs: { ...BLUE, ...BOLD } }]]);
  });

  it("una composizione la fa il browser, e il campo la rilegge quando finisce", () => {
    mount(TWO);
    choose([1, 10]);
    field.element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const piece = rows()[1]!.querySelector<HTMLElement>(".draw-text-piece")!;
    piece.firstChild!.nodeValue = "pioggiaè";
    expect(input("insertCompositionText", "è")).toBe(false);
    field.element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: "è", isComposing: true }));
    field.element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "è" }));
    expect(lineRuns(field.rich.lines[1]!)).toEqual(["in ", { text: "pioggiaè", attrs: { ...BLUE, ...BOLD } }]);
    // Le righe tengono i loro attributi.
    expect(field.rich.lines[1]!.attrs).toEqual({ x: "10", dy: "25" });
  });
});

describe("formattare", () => {
  it("Ctrl+B su una scelta accende il grassetto e lo dice; senza scelta vale per ciò che si scriverà", () => {
    mount(TWO);
    choose([0, 0], [0, 4]);
    const bold = press("b", { ctrlKey: true });
    expect(bold.defaultPrevented).toBe(true);
    expect(lineRuns(field.rich.lines[0]!)).toEqual([{ text: "Evap", attrs: BOLD }, "orazione"]);
    expect(said).toEqual(["Grassetto attivato."]);
    // La scelta resta.
    press("b", { ctrlKey: true });
    expect(lineRuns(field.rich.lines[0]!)).toBe("Evaporazione");
    expect(said[said.length - 1]).toBe("Grassetto disattivato.");

    choose([0, 12]);
    press("i", { metaKey: true });
    expect(said[said.length - 1]).toBe("Corsivo attivato.");
    expect(lineRuns(field.rich.lines[0]!)).toBe("Evaporazione");
    input("insertText", "x");
    expect(lineRuns(field.rich.lines[0]!)).toEqual(["Evaporazione", { text: "x", attrs: { "font-style": "italic" } }]);
    // Dentro il grassetto, il pezzo nuovo lo spegne.
    choose([1, 10]);
    press("b", { ctrlKey: true });
    input("insertText", "y");
    expect(lineRuns(field.rich.lines[1]!)).toEqual(["in ", { text: "pioggia", attrs: { ...BLUE, ...BOLD } }, { text: "y", attrs: BLUE }]);
  });

  it("i comandi di formato del browser, e il barrato con Ctrl+Maiusc+X", () => {
    mount(TWO);
    choose([0, 0], [0, 3]);
    expect(input("formatUnderline")).toBe(true);
    expect(press("x", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(lineRuns(field.rich.lines[0]!)).toEqual([{ text: "Eva", attrs: { "text-decoration": "underline line-through" } }, "porazione"]);
    expect(rows()[0]!.querySelector<HTMLElement>(".draw-text-piece")!.style.textDecorationLine).toBe("underline line-through");
  });

  it("dalla barra: il colore va su ciò che è scelto o su ciò che si scriverà; sul testo intero cambia anche le righe", () => {
    mount(TWO);
    choose([0, 0], [0, 4]);
    field.restyle("fill", "#d55e00");
    expect(lineRuns(field.rich.lines[0]!)).toEqual([{ text: "Evap", attrs: { fill: "#d55e00" } }, "orazione"]);
    choose([0, 12]);
    field.restyleWhole("font-size", "40");
    expect(field.rich.attrs["font-size"]).toBe("40");
    // Il corpo doppio raddoppia l'interlinea.
    expect(field.rich.lines[1]!.attrs.dy).toBe("50");
    expect(field.element.style.fontSize).toBe("40px");
  });
});

describe("annullare e concludere", () => {
  it("le battute di seguito sono un passo, che Ctrl+Z annulla e Ctrl+Maiusc+Z ripete", () => {
    mount(TWO);
    choose([0, 12]);
    for (const letter of "abc") input("insertText", letter);
    input("insertText", " ");
    input("insertText", "d");
    expect(lineRuns(field.rich.lines[0]!)).toBe("Evaporazioneabc d");
    expect(press("z", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(lineRuns(field.rich.lines[0]!)).toBe("Evaporazioneabc ");
    press("z", { ctrlKey: true });
    press("z", { ctrlKey: true });
    expect(lineRuns(field.rich.lines[0]!)).toBe("Evaporazione");
    expect(input("historyRedo")).toBe(true);
    expect(lineRuns(field.rich.lines[0]!)).toBe("Evaporazioneabc");
    press("y", { ctrlKey: true });
    press("z", { ctrlKey: true, shiftKey: true });
    expect(lineRuns(field.rich.lines[0]!)).toBe("Evaporazioneabc d");
  });

  it("Esc, Tab e Ctrl+Invio concludono; Invio no", () => {
    mount(TWO);
    expect(press("Escape").defaultPrevented).toBe(true);
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(press("Enter", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(finished).toBe(3);
    expect(press("Enter").defaultPrevented).toBe(false);
    expect(finished).toBe(3);
  });
});

describe("misurare", () => {
  it("ogni riga scende del suo dy, e un pezzo più grande la fa più alta tenendo la linea di base", () => {
    mount(TWO);
    const flat = field.layout(2, () => 0.3);
    // Il corpo 20 a 2 pixel per unità: righe di 50 pixel, la linea di base a
    // metà più 0,3 volte il corpo.
    expect(flat.height).toBe(100);
    expect(flat.baseline).toBe(37);
    expect(rows()[1]!.style.marginTop).toBe("0px");

    mount({ ...TWO, lines: [TWO.lines[0]!, richLine({ x: "10", dy: "25" }, ["in ", { text: "pioggia", attrs: { "font-size": "40" } }])] });
    const tall = field.layout(2, () => 0.3);
    // La seconda riga è alta 100 e la sua linea di base è a 74 dalla cima:
    // sale di 37 per restare 50 sotto la prima.
    expect(rows()[1]!.style.marginTop).toBe("-37px");
    expect(tall.height).toBe(113);
  });
});
