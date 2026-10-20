// @vitest-environment happy-dom
//
// L'aspetto del carattere nella superficie ricca: i valori che la proiezione
// porta in `f`, i gesti che li cambiano e «Copia formato».
import { afterEach, describe, expect, it } from "vitest";
import type { Node as PmNode } from "prosemirror-model";
import { clearFormatting, setFont, setHighlight, setSize } from "./commands";
import { RichEngine } from "./engine";
import { parseProjection, writeProjection, type Block, type TextInline } from "./projection";
import { mountStrip } from "./strip";

let engines: RichEngine[] = [];
afterEach(() => {
  for (const engine of engines) engine.destroy();
  engines = [];
  document.body.replaceChildren();
});

const BASE = { font: "Calibri", size: 11 };

function source(blocks: readonly Block[]): string {
  return JSON.stringify({ format: "fub-rich", version: 1, blocks });
}

function engine(blocks: readonly Block[]): RichEngine {
  const parent = document.createElement("div");
  document.body.append(parent);
  const made = new RichEngine(parent, { label: () => "documento", onChange: () => {}, onSelectionChange: () => {} });
  made.setDoc(source(blocks));
  engines.push(made);
  return made;
}

function at(doc: PmNode, needle: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(needle)) found = pos + node.text!.indexOf(needle);
    return found < 0;
  });
  if (found < 0) throw new Error(`${needle} non c'è`);
  return found;
}

function select(e: RichEngine, needle: string): void {
  const from = at(e.state.doc, needle);
  e.select(from, from + needle.length);
}

function texts(e: RichEngine, index = 0): TextInline[] {
  const block = parseProjection(e.getDoc()).blocks[index];
  if (block?.t !== "para") throw new Error("non è un paragrafo");
  return (block.c ?? []).filter((inline): inline is TextInline => inline.t === "text");
}

const para = (c: unknown[]): Block =>
  ({ t: "para", role: { kind: "body" }, f: BASE, c }) as Block;

describe("l'aspetto del carattere", () => {
  it("la proiezione porta f nei due versi, e il documento la mostra", () => {
    const blocks = [
      para([
        { t: "text", x: "uno " },
        { t: "text", x: "due", m: ["h", "caps"], f: { font: "Georgia", size: 18, color: "#c00000", hl: "#00ff00" } },
      ]),
    ];
    const text = source(blocks);
    expect(writeProjection(parseProjection(text))).toBe(
      '{"format":"fub-rich","version":1,"blocks":[{"t":"para","role":{"kind":"body"},"f":{"font":"Calibri","size":11.0},' +
        '"c":[{"t":"text","x":"uno "},{"t":"text","x":"due","m":["h","caps"],"f":{"font":"Georgia","size":18.0,"color":"#c00000","hl":"#00ff00"}}]}]}',
    );
    const e = engine(blocks);
    const span = document.querySelector("[data-rich-font]") as HTMLElement;
    expect(span.textContent).toBe("due");
    expect(span.style.fontFamily).toContain("Georgia");
    // La misura in proporzione al paragrafo (`calc` con `var`) la prova il
    // banco: happy-dom non la tiene.
    expect(document.querySelector("[data-rich-size]")?.getAttribute("data-rich-size")).toBe("18");
    expect((document.querySelector("mark") as HTMLElement).style.backgroundColor).not.toBe("");
    expect(document.querySelector("[data-rich-caps]")).not.toBeNull();
    select(e, "due");
    expect(e.look()).toEqual({ font: "Georgia", size: 18, color: "#c00000", hl: "#00ff00" });
  });

  it("un valore uguale a quello del paragrafo non si scrive: il tratto torna a seguirlo", () => {
    const e = engine([para([{ t: "text", x: "testo", f: { font: "Georgia" } }])]);
    select(e, "testo");
    expect(e.apply(setFont("Calibri"))).toBe(true);
    expect(texts(e)).toEqual([{ t: "text", x: "testo" }]);
    expect(e.apply(setSize(14))).toBe(true);
    expect(texts(e)[0]?.f).toEqual({ size: 14 });
    expect(e.apply(setSize(11))).toBe(true);
    expect(texts(e)[0]?.f).toBeUndefined();
  });

  it("una selezione mista non ha un valore, e un passo di dimensione vale per ogni tratto", () => {
    const e = engine([para([{ t: "text", x: "piccolo " }, { t: "text", x: "grande", f: { size: 20 } }])]);
    e.select(1, at(e.state.doc, "grande") + 6);
    expect(e.look().size).toBeNull();
    expect(e.look().font).toBe("Calibri");
    expect(e.run("rich.font.grow")).toBe(true);
    expect(texts(e).map((t) => t.f?.size)).toEqual([12, 22]);
    expect(e.run("rich.font.shrink")).toBe(true);
    expect(texts(e).map((t) => t.f?.size)).toEqual([undefined, 20]);
  });

  it("l'evidenziatore giallo non scrive il colore, un altro sì; cancella formattazione toglie tutto", () => {
    const e = engine([para([{ t: "text", x: "parola" }])]);
    select(e, "parola");
    e.apply(setHighlight("#ffff00"));
    expect(texts(e)[0]).toEqual({ t: "text", x: "parola", m: ["h"] });
    e.apply(setHighlight("#00ffff"));
    expect(texts(e)[0]).toEqual({ t: "text", x: "parola", m: ["h"], f: { hl: "#00ffff" } });
    e.run("rich.caps");
    e.run("rich.superscript");
    e.apply(setFont("Georgia"));
    e.apply(clearFormatting);
    expect(texts(e)).toEqual([{ t: "text", x: "parola" }]);
  });

  it("apice e pedice si escludono; il sottolineato ha l'accordo di Word", () => {
    const e = engine([para([{ t: "text", x: "x2" }])]);
    select(e, "2");
    e.run("rich.superscript");
    e.run("rich.subscript");
    expect(texts(e)[1]?.m).toEqual(["sub"]);
    expect(e.run("rich.underline")).toBe(true);
    expect(texts(e)[1]?.m).toEqual(["u", "sub"]);
  });

  it("copia formato prende l'aspetto e lo dà alla prossima selezione finita, una volta", () => {
    const e = engine([
      para([
        { t: "text", x: "fonte", m: ["b"], f: { color: "#c00000" } },
        { t: "text", x: " e meta" },
      ]),
    ]);
    e.select(at(e.state.doc, "fonte") + 1);
    e.togglePainter();
    expect(e.painterArmed()).toBe(true);
    select(e, "meta");
    expect(e.painterArmed()).toBe(false);
    expect(texts(e)[texts(e).length - 1]).toEqual({ t: "text", x: "meta", m: ["b"], f: { color: "#c00000" } });
    // Un secondo tocco lo lascia, ed Esc anche.
    e.togglePainter();
    e.togglePainter();
    expect(e.painterArmed()).toBe(false);
  });

  it("la striscia mostra l'aspetto della selezione e sparisce in sola lettura", () => {
    const e = engine([para([{ t: "text", x: "testo", m: ["u"], f: { font: "Georgia", size: 14 } }])]);
    select(e, "testo");
    const strip = mountStrip(e, () => null);
    document.body.append(strip.element);
    const font = strip.element.querySelector<HTMLSelectElement>(".rich-strip-font")!;
    const size = strip.element.querySelector<HTMLSelectElement>(".rich-strip-size")!;
    expect(font.value).toBe("Georgia");
    expect(size.value).toBe("14");
    expect(strip.element.querySelector('[data-action="rich.underline"]')?.getAttribute("aria-pressed")).toBe("true");
    // Ogni controllo ha un nome; uno solo è nel Tab.
    for (const control of strip.element.querySelectorAll("select")) {
      expect(strip.element.querySelector(`label[for="${control.id}"]`)?.textContent).not.toBe("");
    }
    expect([...strip.element.querySelectorAll("button, select")].filter((c) => (c as HTMLElement).tabIndex === 0)).toHaveLength(1);
    size.value = "20";
    size.dispatchEvent(new Event("change"));
    expect(texts(e)[0]?.f).toEqual({ font: "Georgia", size: 20 });
    e.setReadOnly(true);
    expect(strip.element.hidden).toBe(true);
    strip.destroy();
    expect(strip.element.isConnected).toBe(false);
  });
});
