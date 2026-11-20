// La pelle divisa della build (`skin-split.mjs`): i pezzi rimessi insieme sono
// la pelle intera, nell'ordine di `order.ts`, e i gruppi minimizzati rimessi
// insieme sono la pelle minimizzata intera, byte per byte.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assemble, ORDER } from "../src/theme/scrittoio/skin/order";
import { minifySkin } from "./skin-minify.mjs";
import { SKIN_GROUP_TARGET as TARGET, skinGroups, skinParts } from "./skin-split.mjs";

const SKIN = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/theme/scrittoio/skin.css"), "utf8");

/** Il margine che i gruppi devono lasciare sotto il budget di 500 000 byte. */
const MARGIN_LIMIT = 450_000;

describe("i pezzi della pelle", () => {
  it("sono i pezzi di order.ts, nel suo ordine, e rimessi insieme sono la pelle", () => {
    const parts = skinParts(SKIN);
    expect(parts.map((part) => part.name)).toEqual([...ORDER]);
    expect(parts.map((part) => part.text).join("")).toBe(SKIN);
  });

  it("si riconoscono dalle testate che scrive assemble", () => {
    const content = Object.fromEntries(ORDER.map((name) => [name, `.${name} { color: red; }\n`]));
    const css = assemble(content);
    const parts = skinParts(css);
    expect(parts.map((part) => part.name)).toEqual([...ORDER]);
    expect(parts.map((part) => part.text).join("")).toBe(css);
    // Ogni pezzo porta le sue regole e nessun'altra.
    for (const part of parts) expect(part.text.match(/\.[a-z-]+ \{/g)).toEqual([`.${part.name} {`]);
  });

  it("un testo senza testate non è una pelle composta", () => {
    expect(() => skinParts(".a { color: red; }")).toThrow(/nessuna testata/);
  });
});

// Minimizzano e passano dal cancello tutta la pelle: da soli stanno sotto il
// secondo, ma sotto il carico di un controllo completo superavano i 5 s di
// serie (corsa locale del 2026-11-19).
describe("i gruppi della pelle", { timeout: 30_000 }, () => {
  it("rimessi insieme sono la pelle minimizzata, coi pezzi in ordine e sotto il margine", () => {
    const groups = skinGroups(SKIN, TARGET);
    expect(groups.length).toBeGreaterThan(1);
    expect(groups.map((group) => group.text).join("")).toBe(minifySkin(SKIN));
    expect(groups.flatMap((group) => group.parts)).toEqual([...ORDER]);
    for (const group of groups) {
      expect(group.parts.length).toBeGreaterThan(0);
      // Nel chunk il testo è una stringa JSON: le virgolette e le barre
      // pesano un byte in più.
      expect(Buffer.byteLength(JSON.stringify(group.text), "utf8")).toBeLessThan(MARGIN_LIMIT);
    }
  });

  it("con un peso piccolo ogni pezzo fa un gruppo, e il testo resta lo stesso", () => {
    const groups = skinGroups(SKIN, 1);
    expect(groups.map((group) => group.parts)).toEqual(ORDER.map((name) => [name]));
    expect(groups.map((group) => group.text).join("")).toBe(minifySkin(SKIN));
  });

  it("con un peso grande resta un gruppo solo", () => {
    const groups = skinGroups(SKIN, 10_000_000);
    expect(groups).toHaveLength(1);
    expect(groups[0].text).toBe(minifySkin(SKIN));
  });

  it("rifiuta un peso che non è positivo", () => {
    expect(() => skinGroups(SKIN, 0)).toThrow(/positivo/);
  });
});
