// Le interruzioni volute (E28, «Interruzioni»): ogni Titolo 2, il separatore,
// i punti scelti a mano (D17). Diventano scatole `break` e l'impaginatore le
// rispetta senza pagine bianche.

import { describe, expect, it } from "vitest";
import { A4_BODY, MM, h1, h2, h3, manualBreak, para, separator } from "./corpus";
import { CHAPTER_BREAK_PREFIX, applyBreaks } from "./breaks";
import type { Box, PageFrame } from "./model";
import { paginate } from "./rules";

const A4: PageFrame = { height: A4_BODY, columns: 1, noteMargin: 22 * MM };
const NONE = { everyHeading2: false, separator: false };

const kinds = (boxes: Box[]) => boxes.map((b) => (b.kind === "break" ? `break:${b.reason}` : b.kind));

describe("applyBreaks", () => {
  it("senza interruzioni scelte lascia le scatole come sono", () => {
    const boxes = [h1(), para(2), separator(), h2(), para(2)];
    expect(applyBreaks(boxes, NONE)).toEqual(boxes);
  });

  it("mette una pagina nuova prima di ogni Titolo 2, non degli altri titoli", () => {
    const boxes = [h1(), para(2), h2(), para(2), h3(), para(1), h2(), para(1)];
    expect(kinds(applyBreaks(boxes, { ...NONE, everyHeading2: true }))).toEqual([
      "heading", "paragraph", "break:titolo2", "heading", "paragraph", "heading", "paragraph", "break:titolo2", "heading", "paragraph",
    ]);
  });

  it("il separatore volta pagina al posto della linea", () => {
    const rule = separator();
    const out = applyBreaks([para(2), rule, para(2)], { ...NONE, separator: true });
    expect(out[1]).toEqual({ kind: "break", id: rule.id, reason: "separatore" });
  });

  it("il separatore fra due note di un libro volta sempre pagina", () => {
    const chapter = { kind: "separator", id: `${CHAPTER_BREAK_PREFIX}1`, height: 0 } as const;
    const boxes = [para(2), chapter, h1(), para(2)];
    expect(applyBreaks(boxes, NONE)[1]).toEqual({ kind: "break", id: chapter.id, reason: "capitolo" });
    const result = paginate(applyBreaks(boxes, NONE), A4);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[1].placements[0]).toMatchObject({ id: boxes[2]!.id, y: 0 });
  });

  it("le interruzioni a mano restano dove sono", () => {
    const boxes = [para(2), manualBreak(), para(2)];
    expect(applyBreaks(boxes, { everyHeading2: true, separator: true })).toEqual(boxes);
  });
});

describe("le interruzioni nell'impaginazione", () => {
  it("ogni Titolo 2 comincia una pagina, ma non lascia bianca la prima", () => {
    const first = h2();
    const second = h2();
    const boxes = applyBreaks([first, para(2), second, para(2)], { ...NONE, everyHeading2: true });
    const result = paginate(boxes, A4);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[1].placements[0]).toMatchObject({ id: second.id, y: 0 });
  });

  it("il separatore come interruzione non disegna niente", () => {
    const rule = separator();
    const result = paginate(applyBreaks([para(2), rule, para(2)], { ...NONE, separator: true }), A4);
    expect(result.pages).toHaveLength(2);
    expect(result.pages.flatMap((p) => p.placements).some((p) => p.id === rule.id)).toBe(false);
  });

  it("un Titolo 2 subito dopo un'interruzione a mano fa una pagina sola", () => {
    const boxes = applyBreaks([para(2), manualBreak(), h2(), para(2)], { ...NONE, everyHeading2: true });
    expect(paginate(boxes, A4).pages).toHaveLength(2);
  });

  it("un separatore in fondo alla nota non lascia una pagina bianca", () => {
    const boxes = applyBreaks([para(2), separator()], { ...NONE, separator: true });
    expect(paginate(boxes, A4).pages).toHaveLength(1);
  });

  it("un'interruzione prima delle note in fondo le porta nella pagina dopo", () => {
    const narrow: PageFrame = { ...A4, noteMargin: 10 * MM };
    const boxes = [para(2, [{ id: "n", height: 40 }]), manualBreak()];
    const result = paginate(boxes, narrow);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[1].placements).toEqual([expect.objectContaining({ part: "nota", note: "n", y: 0 })]);
  });
});
