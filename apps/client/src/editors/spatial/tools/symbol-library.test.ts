// Le librerie di simboli: l'impronta, l'origine scritta in `fub:source`, la
// lettura di una libreria, la copia di un suo simbolo, che il disegno
// riceve come un incolla, e l'aggiornamento di una copia.

import { describe, expect, it } from "vitest";
import { elementChildren, rawOf, type ContainerNode } from "../scene/model";
import type { Op } from "../scene/ops";
import { doc } from "../scene/test-support";
import { nodeOf } from "./arrange";
import { planPaste, readPaste } from "./clipboard";
import { destinationIn, NewIds } from "./edit";
import { fnv1a64, libraryCopy, miniature, originSymbol, readLibrary, readOrigin, sourceValue, symbolCopy, symbolPicture, symbolPrint, symbolSheet, updateOps, type Library } from "./symbol-library";
import { documentSymbols, renameSymbolOps } from "./symbols";
import { LAYER, open, type Opened } from "./test-support";

/// Una presa che usa una sfumatura privata e un punto, un altro simbolo;
/// `fill` è il colore della sfumatura, `r` il raggio del punto.
const PRESA = (fill = "#ffffff", r = 5): string =>
  '<defs id="fub-defs"><symbol id="rpresa000" overflow="visible"><title>Presa</title>' +
  '<rect id="osssssss1" x="-10" y="-10" width="20" height="20" fill="url(#rgrad0000)"/><use id="oinner001" transform="translate(10 0)" href="#rpunto000"/></symbol>' +
  `<symbol id="rpunto000" overflow="visible"><title>Punto</title><circle id="oppppppp1" r="${r}" fill="#000000"/></symbol>` +
  `<linearGradient id="rgrad0000" fub:role="private"><stop offset="0" stop-color="${fill}"/></linearGradient></defs>`;
const LIBRARY = (fill?: string, r?: number): string => doc(`${PRESA(fill, r)}${LAYER}</g>`);
const TARGET = doc(`${LAYER}<rect id="ozzzzzzzz" x="0" y="0" width="5" height="5"/></g>`);

/// Il testo di `id` nel disegno di `text`, dal `<` all'ultimo `>`.
const slice = (text: string, start: string): string => {
  const from = text.indexOf(start);
  const tag = /^<(\w+)/.exec(start)![1]!;
  const end = text.indexOf(`</${tag}>`, from) + tag.length + 3;
  return text.slice(from, end);
};

/// Incolla `svg` nel primo livello di `opened`, in un `batch` solo; torna gli
/// id scelti dopo.
function paste(opened: Opened, svg: string): string[] {
  const source = readPaste(svg);
  if (typeof source === "string") throw new Error(source);
  const ids = new NewIds((id) => opened.engine.holder(id) !== null);
  const layer = opened.index.layers[0]!;
  const model = opened.engine.model!;
  const run = planPaste(source, { model, container: nodeOf(model, layer) as ContainerNode, to: destinationIn(layer, ids)!, ids, delta: [0, 0], href: () => null });
  let next = run.next();
  while (next.done !== true) next = run.next();
  apply(opened, next.value.ops);
  return next.value.keys;
}

/// Applica `ops` in un passo, e verifica che annulla e rifai tornino.
function apply(opened: Opened, ops: readonly Op[]): void {
  const before = opened.engine.text;
  const outcome = opened.engine.apply({ op: "batch", ops: [...ops] });
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.reason} (${outcome.detail})`);
  const after = opened.engine.text;
  expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(opened.engine.text).toBe(before);
  expect(opened.engine.apply({ op: "batch", ops: [...ops] }).outcome).toBe("applied");
  expect(opened.engine.text).toBe(after);
}

const library = (text = LIBRARY(), path = "Simboli/Impianti elettrici.svg"): Library => {
  const read = readLibrary(path, text);
  if (typeof read === "string") throw new Error(read);
  return read;
};

describe("l'impronta", () => {
  it("è FNV-1a a 64 bit dei byte UTF-8, in 16 cifre minuscole", () => {
    expect(fnv1a64("")).toBe("cbf29ce484222325");
    expect(fnv1a64("a")).toBe("af63dc4c8601ec8c");
    expect(fnv1a64("foobar")).toBe("85944171f73967e8");
    expect(fnv1a64("é → 😀")).toBe("24d8fa308c5b85d8");
  });

  it("copre il simbolo e ciò che usa, anche attraverso altri, a LF", () => {
    const text = LIBRARY();
    const presa = slice(text, '<symbol id="rpresa000"');
    const gradient = slice(text, '<linearGradient id="rgrad0000"');
    const punto = slice(text, '<symbol id="rpunto000"');
    expect(library().symbols).toEqual([
      { id: "rpresa000", name: "Presa", print: fnv1a64(`${presa}\n${gradient}\n${punto}`) },
      { id: "rpunto000", name: "Punto", print: fnv1a64(punto) },
    ]);
    // Una sfumatura che cambia cambia l'impronta di chi la usa.
    expect(library(LIBRARY("#ff0000")).symbols[0]!.print).not.toBe(library().symbols[0]!.print);
    expect(library(LIBRARY("#ff0000")).symbols[1]!.print).toBe(library().symbols[1]!.print);
    // Gli a capo di Windows non la cambiano.
    const crlf = doc(`${PRESA().replace("<title>Presa</title>", "\r\n<title>Presa</title>\r\n")}${LAYER}</g>`);
    const lf = doc(`${PRESA().replace("<title>Presa</title>", "\n<title>Presa</title>\n")}${LAYER}</g>`);
    expect(library(crlf).symbols[0]!.print).toBe(library(lf).symbols[0]!.print);
    expect(symbolPrint(open(lf).engine.model!, "rpresa000")).toBe(library(lf).symbols[0]!.print);
  });
});

describe("l'origine", () => {
  it("si legge dalla fine: il percorso può avere spazi e #", () => {
    expect(readOrigin("Simboli/Impianti elettrici.svg#r00000004 9f3a6c01d2e4b587")).toEqual({ path: "Simboli/Impianti elettrici.svg", id: "r00000004", print: "9f3a6c01d2e4b587" });
    expect(readOrigin("Uno#due.svg#rid 0123456789abcdef")).toEqual({ path: "Uno#due.svg", id: "rid", print: "0123456789abcdef" });
    expect(sourceValue("a b.svg", "rid", "0123456789abcdef")).toBe("a b.svg#rid 0123456789abcdef");
  });

  it("un valore senza la forma del formato non dice niente", () => {
    for (const value of [null, "", "a.svg#rid", "a.svg#rid 0123", "a.svg#rid 0123456789ABCDEF", "a.svg# 0123456789abcdef", "#rid 0123456789abcdef", "a.svg 0123456789abcdef"]) {
      expect(readOrigin(value)).toBeNull();
    }
  });
});

describe("leggere una libreria", () => {
  it("un file troppo grande o che non è un disegno non è una libreria", () => {
    expect(readLibrary("a.svg", '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="s"/></svg>')).toBe("not-drawing");
    expect(readLibrary("a.svg", "non è un SVG")).toBe("not-drawing");
    expect(readLibrary("a.svg", doc(`${LAYER}<desc>${"x".repeat(21 * 1024 * 1024)}</desc></g>`))).toBe("too-large");
  });

  it("un disegno senza simboli è una libreria vuota", () => {
    expect(library(TARGET).symbols).toEqual([]);
  });
});

describe("copiare un simbolo da una libreria", () => {
  it("la copia porta un'istanza e i simboli con la loro origine", () => {
    const lib = library();
    const copy = libraryCopy(lib, "rpresa000")!;
    const [presa, punto] = lib.symbols as unknown as readonly [{ print: string }, { print: string }];
    expect(copy.svg).toContain(`<symbol id="rpresa000" fub:source="Simboli/Impianti elettrici.svg#rpresa000 ${presa.print}" overflow="visible">`);
    expect(copy.svg).toContain(`<symbol id="rpunto000" fub:source="Simboli/Impianti elettrici.svg#rpunto000 ${punto.print}" overflow="visible">`);
    expect(copy.svg).toContain('<linearGradient id="rgrad0000" fub:role="private">');
    expect(copy.svg).toMatch(/<use id="o[0-9a-z]{8}" href="#rpresa000"\/>/);
    // Il quadrato e il punto spostato a destra.
    expect(copy.frame).toEqual({ min: [-10, -10], max: [15, 10] });
    expect(libraryCopy(lib, "rnessuno0")).toBeNull();
  });

  it("la copia parte da un disegno piccolo: la radice e ciò che il simbolo usa", () => {
    // Un altro simbolo e un'altra sfumatura, che il punto non usa.
    const text = LIBRARY().replace("</defs>", '<symbol id="raltro000" overflow="visible"><title>Altro</title><rect id="oaaaaaaa1" width="1" height="1" fill="url(#raltrog00)"/></symbol><linearGradient id="raltrog00"/></defs>');
    const lib = library(text);
    const small = miniature(lib.sheet, "rpunto000")!;
    expect(small.startsWith(text.slice(text.indexOf("<svg"), text.indexOf(">", text.indexOf("<svg")) + 1))).toBe(true);
    expect(small).toContain('<symbol id="rpunto000"');
    expect(small).not.toContain("rpresa000");
    expect(small).not.toContain("raltro");
    expect(miniature(lib.sheet, "rpresa000")).toContain('<linearGradient id="rgrad0000"');
    expect(miniature(lib.sheet, "rnessuno0")).toBeNull();
    // La copia dal disegno piccolo è quella da tutto il disegno, con le
    // risorse nell'ordine in cui il simbolo le nomina.
    const copy = libraryCopy(lib, "rpresa000")!;
    const whole = symbolCopy(text, "rpresa000", new Map(lib.symbols.slice(0, 2).map((symbol) => [symbol.id, sourceValue(lib.path, symbol.id, symbol.print)])))!;
    const lines = (svg: string): string[] => svg.replace(/o[0-9a-z]{8}/g, "o").split("\n").sort();
    expect(lines(copy.svg)).toEqual(lines(whole.svg));
    expect(copy.frame).toEqual(whole.frame);
  });

  it("una dichiarazione che non sta sulla radice: la copia parte da tutta la libreria", () => {
    const text = LIBRARY().replace('<defs id="fub-defs">', '<defs id="fub-defs" xmlns:x="urn:x">').replace('<title>Punto</title>', '<title>Punto</title><x:dato/>');
    const lib = library(text);
    expect(() => symbolCopy(miniature(lib.sheet, "rpunto000")!, "rpunto000")).not.toThrow();
    expect(symbolCopy(miniature(lib.sheet, "rpunto000")!, "rpunto000")).toBeNull();
    const copy = libraryCopy(lib, "rpunto000")!;
    expect(copy.svg).toContain("<x:dato");
    expect(copy.frame).toEqual({ min: [-5, -5], max: [5, 5] });
  });

  it("l'anteprima di un simbolo del disegno aperto", () => {
    const opened = open(LIBRARY());
    const sheet = symbolSheet(opened.engine.model!);
    const picture = symbolPicture(sheet, "rpresa000")!;
    expect(picture.svg).not.toContain("fub:source");
    expect(picture.frame).toEqual({ min: [-10, -10], max: [15, 10] });
    expect(symbolPicture(sheet, "rgrad0000")).toBeNull();
  });

  it("un simbolo del disegno si copia senza origine", () => {
    const copy = symbolCopy(LIBRARY(), "rpunto000")!;
    expect(copy.svg).not.toContain("fub:source");
    expect(copy.frame).toEqual({ min: [-5, -5], max: [5, 5] });
    expect(symbolCopy(LIBRARY(), "rgrad0000")).toBeNull();
  });

  it("nel disegno arriva una volta: la seconda copia è un'istanza dello stesso", () => {
    const opened = open(TARGET);
    const lib = library();
    const [first] = paste(opened, libraryCopy(lib, "rpresa000")!.svg) as [string];
    const symbols = documentSymbols(opened.engine.model!);
    expect(symbols.map((symbol) => symbol.name)).toEqual(["Punto", "Presa"]);
    const presa = originSymbol(opened.engine.model!, lib.path, "rpresa000")!;
    expect(presa.name).toBe("Presa");
    expect(rawOf(opened.engine.holder(first)!)).toContain(`href="#${presa.id}"`);
    const [second] = paste(opened, libraryCopy(lib, "rpresa000")!.svg) as [string];
    expect(documentSymbols(opened.engine.model!)).toHaveLength(2);
    expect(rawOf(opened.engine.holder(second)!)).toContain(`href="#${presa.id}"`);
    expect(originSymbol(opened.engine.model!, lib.path, "rnessuno0")).toBeNull();
    expect(originSymbol(opened.engine.model!, "Altro.svg", "rpresa000")).toBeNull();
  });
});

describe("aggiornare un simbolo dalla libreria", () => {
  it("il simbolo tiene id, nome e istanze, e prende il contenuto e l'impronta di adesso", () => {
    const opened = open(TARGET);
    const [instance] = paste(opened, libraryCopy(library(), "rpresa000")!.svg) as [string];
    const ids = new NewIds((id) => opened.engine.holder(id) !== null);
    // Nel disegno il simbolo ha un altro nome, che resta.
    const named = renameSymbolOps(opened.engine.model!, originSymbol(opened.engine.model!, "Simboli/Impianti elettrici.svg", "rpresa000")!, "Presa di casa", ids);
    if (named === "foreign") throw new Error("foreign");
    apply(opened, named.ops);
    const presa = originSymbol(opened.engine.model!, "Simboli/Impianti elettrici.svg", "rpresa000")!;
    const changed = library(LIBRARY("#ff0000"));
    const ops = updateOps(opened.engine.model!, presa, changed, "rpresa000", ids)!;
    apply(opened, ops);
    const after = originSymbol(opened.engine.model!, changed.path, "rpresa000")!;
    expect(after.id).toBe(presa.id);
    expect(after.name).toBe("Presa di casa");
    expect(readOrigin(after.source)!.print).toBe(changed.symbols[0]!.print);
    expect(rawOf(opened.engine.holder(instance)!)).toContain(`href="#${presa.id}"`);
    // Il contenuto nuovo usa una sfumatura rossa; quella bianca, che nessuno
    // usa più, se n'è andata.
    const text = opened.engine.text;
    expect(text).toContain('stop-color="#ff0000"');
    expect(text).not.toContain('stop-color="#ffffff"');
    const content = elementChildren(after.node).map((child) => child.facts.local);
    expect(content).toEqual(["title", "rect", "use"]);
    // Il punto non è cambiato: resta quello.
    expect(documentSymbols(opened.engine.model!).map((symbol) => symbol.name)).toEqual(["Punto", "Presa di casa"]);
  });

  it("un simbolo della libreria che il disegno ha già resta il suo, anche se è cambiato", () => {
    const opened = open(TARGET);
    paste(opened, libraryCopy(library(), "rpunto000")!.svg);
    const punto = originSymbol(opened.engine.model!, "Simboli/Impianti elettrici.svg", "rpunto000")!;
    // Nella libreria il punto cresce: la presa che arriva usa il punto del
    // disegno, e lo stesso il suo aggiornamento.
    const grown = library(LIBRARY("#ffffff", 6));
    paste(opened, libraryCopy(grown, "rpresa000")!.svg);
    const presa = originSymbol(opened.engine.model!, grown.path, "rpresa000")!;
    expect(documentSymbols(opened.engine.model!).map((symbol) => symbol.name)).toEqual(["Punto", "Presa"]);
    expect(rawOf(presa.node)).toContain(`href="#${punto.id}"`);
    const ids = new NewIds((id) => opened.engine.holder(id) !== null);
    apply(opened, updateOps(opened.engine.model!, presa, library(LIBRARY("#ff0000", 7)), "rpresa000", ids)!);
    expect(documentSymbols(opened.engine.model!).map((symbol) => symbol.name)).toEqual(["Punto", "Presa"]);
    expect(rawOf(originSymbol(opened.engine.model!, grown.path, "rpresa000")!.node)).toContain(`href="#${punto.id}"`);
    expect(rawOf(originSymbol(opened.engine.model!, grown.path, "rpunto000")!.node)).toContain('r="5"');
  });

  it("senza il simbolo nella libreria non si aggiorna", () => {
    const opened = open(TARGET);
    paste(opened, libraryCopy(library(), "rpresa000")!.svg);
    const presa = originSymbol(opened.engine.model!, "Simboli/Impianti elettrici.svg", "rpresa000")!;
    const ids = new NewIds((id) => opened.engine.holder(id) !== null);
    expect(updateOps(opened.engine.model!, presa, library(TARGET), "rpresa000", ids)).toBeNull();
  });
});
