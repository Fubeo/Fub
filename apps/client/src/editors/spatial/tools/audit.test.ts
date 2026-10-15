// La verifica dell'accessibilità senza il pannello: i problemi della
// diagnostica con l'oggetto e la correzione, il colore più vicino che si
// legge, il corpo che arriva a 12 px, l'ordine di lettura e l'immagine
// dichiarata decorativa.

import { describe, expect, it } from "vitest";
import { outline } from "../describe";
import type { ElementItem } from "../scene/classify";
import { contrast, over } from "../scene/analysis";
import { auditScene, readScene } from "../scene/read";
import { doc } from "../scene/test-support";
import type { Rgb } from "../scene/values";
import { hex, legibleColor, legibleSize, overlaps, problemsOf, readingOrder, type Problem } from "./audit";
import { gesture, NewIds } from "./edit";
import { decorativeOps } from "./naming";
import { LAYER, open } from "./test-support";

const WHITE: Rgb = [255, 255, 255];

/// Un testo di una riga con gli attributi `attributes`, alla quota `y`.
function label(id: string, y: number, attributes: string, line: string): string {
  return `<text id="${id}" x="10" y="${y}" ${attributes}><tspan x="10" dy="0">${line}</tspan></text>`;
}

/// I problemi di `source`, ciascuno in una riga: il codice, la chiave e la
/// correzione.
function problems(source: string): Problem[] {
  const { scene, measures } = auditScene(source);
  return problemsOf(scene, measures);
}

/// Tinta, saturazione e luminosità di un colore, come le misura chi lo
/// guarda: per confrontare il colore proposto con quello di partenza.
function hsl([r8, g8, b8]: Rgb): [number, number, number] {
  const [r, g, b] = [r8 / 255, g8 / 255, b8 / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, d / (1 - Math.abs(2 * l - 1)), l];
}

describe("i problemi", () => {
  it("prima il disegno senza titolo, poi gli oggetti in ordine di documento, ciascuno con la sua correzione", () => {
    const source = doc(
      `${LAYER}${label("o1a1a1a1a", 20, 'fill="#f0e442"', "Sole")}` +
        `<image id="o2b2b2b2b" x="0" y="30" width="10" height="10" href="foto.png"/>` +
        `${label("o3c3c3c3c", 60, 'font-size="8" fill="#f0e442"', "Nota")}</g>`,
    );
    const found = problems(source);
    expect(found.map((problem) => [problem.code, problem.key, problem.severity, problem.fix?.kind ?? null])).toEqual([
      ["S001", null, "warning", "title"],
      ["S009", "o1a1a1a1a", "info", "color"],
      ["S012", "o2b2b2b2b", "warning", "describe"],
      // Un oggetto con più problemi li ha in fila, nell'ordine dei codici.
      ["S009", "o3c3c3c3c", "info", "color"],
      ["S013", "o3c3c3c3c", "info", "size"],
    ]);
    const sun = found[1]!;
    expect(sun.role).toBe("text");
    expect(sun.detail).toBe("1.32");
    expect(sun.threshold).toBe(4.5);
    // La correzione proposta si legge davvero: riletta, il problema non c'è.
    if (sun.fix?.kind !== "color") throw new Error("nessun colore");
    expect(sun.fix.paint).toBe("fill");
    expect(sun.fix.ratio).toBeGreaterThanOrEqual(4.5);
    const fixed = problems(source.replace(label("o1a1a1a1a", 20, 'fill="#f0e442"', "Sole"), label("o1a1a1a1a", 20, `fill="${sun.fix.color}"`, "Sole")));
    expect(fixed.some((problem) => problem.code === "S009" && problem.key === "o1a1a1a1a")).toBe(false);
    const note = found[4]!;
    expect(note.fix).toEqual({ kind: "size", size: 12 });
  });

  it("un tratto a penna si corregge col suo colore, e un colore o un corpo di una riga sola non si corregge dal testo", () => {
    const pen = `<path id="o1a1a1a1a" fub:tool="pen" fub:brush="pf1" fub:ink="1 s10 cxy 0,0" d="M10 10 L90 10 L90 12 L10 12 Z" fill="#f0e442"/>`;
    const found = problems(doc(`<title>Prova</title>${LAYER}${pen}</g>`));
    expect(found.map((problem) => [problem.code, problem.key, problem.role, problem.severity, problem.threshold])).toEqual([["S009", "o1a1a1a1a", "stroke", "info", 3]]);
    const fix = found[0]!.fix;
    if (fix?.kind !== "color") throw new Error("nessun colore");
    expect(fix.paint).toBe("stroke");
    expect(problems(doc(`<title>Prova</title>${LAYER}${pen.replace("#f0e442", fix.color)}</g>`))).toEqual([]);
    const lines = problems(
      doc(`<title>Prova</title>${LAYER}<text id="o2b2b2b2b" x="10" y="20"><tspan x="10" dy="0" fill="#f0e442" font-size="9">riga</tspan></text></g>`),
    );
    expect(lines.map((problem) => [problem.code, problem.fix])).toEqual([
      ["S009", null],
      ["S013", null],
    ]);
  });

  it("due colori di codice che si distinguono soltanto per la tinta: ogni colore ha una campitura per tutte le sue aree", () => {
    const box = (id: string, x: number, fill: string): string => `<rect id="${id}" x="${x}" y="0" width="10" height="10" fill="${fill}"/>`;
    // Il blu e il verde chiari, due aree ciascuno, una in un gruppo: la
    // chiave di ognuna sta nella correzione del suo colore, non soltanto la
    // prima.
    const source = doc(
      `<title>Prova</title>${LAYER}${box("o1a1a1a1a", 0, "#a6cee3")}${box("o2b2b2b2b", 20, "#b2df8a")}` +
        `<g id="og1g1g1g1">${box("o3c3c3c3c", 40, "#a6cee3")}</g>${box("o4d4d4d4d", 60, "#b2df8a")}</g>`,
    );
    const found = problems(source);
    expect(found.map((problem) => [problem.code, problem.key, problem.role, problem.severity, problem.detail, problem.threshold])).toEqual([
      ["S017", "o1a1a1a1a", "rect", "info", "#a6cee3 #b2df8a 1.10", 3],
      ["S017", "o2b2b2b2b", "rect", "info", "#b2df8a #a6cee3 1.10", 3],
    ]);
    expect(found.map((problem) => problem.fix)).toEqual([
      { kind: "hatch", color: "#a6cee3", keys: ["o1a1a1a1a", "o3c3c3c3c"] },
      { kind: "hatch", color: "#b2df8a", keys: ["o2b2b2b2b", "o4d4d4d4d"] },
    ]);
    // Un colore composto con l'opacità è il colore che si vede, sulla carta.
    const translucent = doc(
      `<title>Prova</title><rect id="fub-paper" fub:role="paper" width="100" height="100" fill="#f0f0f0"/>${LAYER}` +
        `<g id="og1g1g1g1" opacity="0.5">${box("o1a1a1a1a", 0, "#1f78b4")}${box("o2b2b2b2b", 20, "#1f78b4")}</g>${box("o3c3c3c3c", 40, "#a6cee3")}${box("o4d4d4d4d", 60, "#a6cee3")}</g>`,
    );
    expect(problems(translucent).map((problem) => [problem.detail, problem.fix])).toEqual([
      ["#88b4d2 #a6cee3 1.32", { kind: "hatch", color: "#88b4d2", keys: ["o1a1a1a1a", "o2b2b2b2b"] }],
      ["#a6cee3 #88b4d2 1.32", { kind: "hatch", color: "#a6cee3", keys: ["o3c3c3c3c", "o4d4d4d4d"] }],
    ]);
  });

  it("un disegno che si legge non ha problemi", () => {
    expect(problems(doc(`<title>Prova</title>${LAYER}${label("o1a1a1a1a", 20, "", "Testo")}<image x="0" y="30" width="10" height="10" href="foto.png" aria-hidden="true"/></g>`))).toEqual([]);
  });
});

describe("il colore più vicino", () => {
  it("tiene la tinta e cambia la luminosità quanto basta, verso dove serve meno", () => {
    // Il giallo su bianco diventa un ocra, non un nero.
    const yellow: Rgb = [0xf0, 0xe4, 0x42];
    const darker = legibleColor({ color: [yellow, 1], under: WHITE, threshold: 4.5 })!;
    expect(darker.ratio).toBeGreaterThanOrEqual(4.5);
    expect(darker.ratio).toBeLessThan(4.8);
    expect(contrast(over(darker.rgb, 1, WHITE), WHITE)).toBe(darker.ratio);
    const [hue, , light] = hsl(darker.rgb);
    expect(Math.abs(hue - hsl(yellow)[0])).toBeLessThan(3);
    expect(light).toBeLessThan(hsl(yellow)[2]);
    expect(light).toBeGreaterThan(0.15);
    // Il blu scuro su un fondo nero diventa più chiaro.
    const navy: Rgb = [0x10, 0x20, 0x60];
    const lighter = legibleColor({ color: [navy, 1], under: [0, 0, 0], threshold: 4.5 })!;
    expect(hsl(lighter.rgb)[2]).toBeGreaterThan(hsl(navy)[2]);
    expect(lighter.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("si misura con l'opacità dell'oggetto, e non c'è se nessuna luminosità basta", () => {
    const half = legibleColor({ color: [[0x80, 0x80, 0x80], 0.5], under: WHITE, threshold: 3 })!;
    expect(contrast(over(half.rgb, 0.5, WHITE), WHITE)).toBeGreaterThanOrEqual(3);
    expect(legibleColor({ color: [[0x80, 0x80, 0x80], 0.05], under: WHITE, threshold: 4.5 })).toBeNull();
  });

  it("si scrive come lo scrive il file", () => {
    expect(hex([0, 114, 178])).toBe("#0072b2");
  });
});

describe("il corpo giusto", () => {
  it("arriva a 12 px a grandezza naturale, al centesimo per eccesso", () => {
    expect(legibleSize(1)).toBe(12);
    expect(legibleSize(0.5)).toBe(24);
    expect(legibleSize(3)).toBe(4);
    expect(legibleSize(0.7)).toBe(17.15);
    for (const scale of [0.3, 0.7, 1.1, 2.9]) expect(legibleSize(scale)! * scale).toBeGreaterThanOrEqual(12);
    for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(legibleSize(scale)).toBeNull();
  });
});

describe("l'ordine di lettura", () => {
  it("è l'ordine del documento, in profondità, coi primi e gli ultimi fra i vicini", () => {
    const source = doc(
      `${LAYER}<rect id="oa1a1a1a1" x="0" y="0" width="5" height="5"/><g id="og1g1g1g1"><rect id="ob2b2b2b2" x="10" y="0" width="5" height="5"/>` +
        `<rect id="oc3c3c3c3" x="20" y="0" width="5" height="5"/></g></g>`,
    );
    const rows = readingOrder(outline(readScene(source).items));
    expect(rows.map((row) => [row.node.key, row.depth, row.parent, row.first, row.last])).toEqual([
      ["l1", 0, null, true, true],
      ["oa1a1a1a1", 1, "l1", true, false],
      ["og1g1g1g1", 1, "l1", false, true],
      ["ob2b2b2b2", 2, "og1g1g1g1", true, false],
      ["oc3c3c3c3", 2, "og1g1g1g1", false, true],
    ]);
  });

  it("due oggetti si sovrappongono solo con un'area", () => {
    const box = (x: number, y: number, size = 10) => ({ min: [x, y] as const, max: [x + size, y + size] as const });
    expect(overlaps(box(0, 0), box(5, 5))).toBe(true);
    expect(overlaps(box(0, 0), box(10, 0))).toBe(false);
    expect(overlaps(box(0, 0), box(20, 20))).toBe(false);
    expect(overlaps(null, box(0, 0))).toBe(false);
  });
});

describe("l'immagine decorativa", () => {
  it("riceve aria-hidden in un passo, che un annulla disfa al byte; una lo è già", () => {
    const source = doc(`<title>Prova</title>${LAYER}<image x="0" y="0" width="10" height="10" href="foto.png"/></g>`);
    const opened = open(source);
    const item = opened.engine.scene().find((entry): entry is ElementItem => entry.kind === "element" && entry.role === "image")!;
    const change = decorativeOps(opened.engine.model!, item, new NewIds((id) => opened.engine.holder(id) !== null));
    expect(change.keys).toHaveLength(1);
    const outcome = opened.engine.apply(gesture(change.ops)!);
    if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.outcome}`);
    expect(opened.engine.text).toContain('aria-hidden="true"');
    expect(problems(opened.engine.text)).toEqual([]);
    const again = opened.engine.scene().find((entry): entry is ElementItem => entry.kind === "element" && entry.role === "image")!;
    expect(decorativeOps(opened.engine.model!, again, new NewIds(() => false)).ops).toEqual([]);
    expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
    expect(opened.engine.text).toBe(source);
  });
});
