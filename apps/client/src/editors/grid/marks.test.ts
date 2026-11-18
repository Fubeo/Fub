import { describe, expect, it } from "vitest";
import {
  clipRect,
  cornerPiece,
  cornerSeen,
  cornerZone,
  edgeParts,
  looseRect,
  rectPieces,
  selectionParts,
  wholeRect,
  type Bands,
  type Rect,
} from "./marks";

// Una griglia di prova: intestazioni di 52 × 28 px, righe di 28 px, la
// colonna A di 140 px e le altre di 64. Con la riga 1 e la colonna A
// bloccate la testa è alta 56 px e la colonna ferma larga 192.
const HEAD_W = 52;
const HEAD_H = 28;
const ROW = 28;
const widths = [140, 64, 64, 64, 64, 64];
const colX = (c: number) => HEAD_W + widths.slice(0, c).reduce((a, b) => a + b, 0);
const rowY = (r: number) => HEAD_H + r * ROW;
/// Il rettangolo di un intervallo, da zero, nelle coordinate del piano.
const box = (r0: number, c0: number, r1: number, c1: number): Rect => ({
  x: colX(c0),
  y: rowY(r0),
  w: colX(c1 + 1) - colX(c0),
  h: rowY(r1 + 1) - rowY(r0),
});
const FROZEN: Bands = { top: rowY(1), left: colX(1) };
const ROW_ONLY: Bands = { top: rowY(1), left: HEAD_W };
const COLUMN_ONLY: Bands = { top: HEAD_H, left: colX(1) };
const NONE: Bands = { top: HEAD_H, left: HEAD_W };

const zones = (pieces: { zone: string }[]) => pieces.map((piece) => piece.zone).sort();

describe("rectPieces", () => {
  it("un intervallo tutto nel corpo è un pezzo solo, intero", () => {
    const rect = box(2, 2, 5, 3);
    const pieces = rectPieces(rect, FROZEN);
    expect(zones(pieces)).toEqual(["body"]);
    expect(pieces[0].rect).toEqual(rect);
    expect(pieces[0].cut).toEqual({ top: false, right: false, bottom: false, left: false });
  });

  it("senza nulla di bloccato ogni intervallo sta nel corpo", () => {
    for (const rect of [box(0, 0, 0, 0), box(0, 0, 8, 4), box(3, 2, 9, 5)]) {
      const pieces = rectPieces(rect, NONE);
      expect(zones(pieces)).toEqual(["body"]);
      expect(pieces[0].rect).toEqual(rect);
    }
  });

  it("un intervallo che passa la riga bloccata: la testa si ferma un pixel prima del filo", () => {
    const rect = box(0, 2, 8, 4);
    const pieces = rectPieces(rect, ROW_ONLY);
    expect(zones(pieces)).toEqual(["body", "top"]);
    const top = pieces.find((piece) => piece.zone === "top")!;
    expect(top.rect).toEqual({ x: rect.x, y: rect.y, w: rect.w, h: ROW - 1 });
    expect(top.cut.bottom).toBe(true);
    // Le altezze sulle zone: la testa più il corpo che le scorre sotto danno
    // le righe 1–9, meno il pixel del filo.
    const body = pieces.find((piece) => piece.zone === "body")!;
    expect(body.rect).toEqual(rect);
  });

  it("un intervallo che passa la colonna bloccata: la colonna ferma comincia sotto la testa", () => {
    const rect = box(3, 0, 6, 2);
    const pieces = rectPieces(rect, COLUMN_ONLY);
    expect(zones(pieces)).toEqual(["body", "left"]);
    const left = pieces.find((piece) => piece.zone === "left")!;
    expect(left.rect).toEqual({ x: rect.x, y: rect.y - COLUMN_ONLY.top, w: widths[0] - 1, h: rect.h });
    expect(left.cut).toEqual({ top: false, right: true, bottom: false, left: false });
  });

  it("un intervallo in tutte e quattro le zone", () => {
    const rect = box(0, 0, 5, 3);
    const pieces = rectPieces(rect, FROZEN);
    expect(zones(pieces)).toEqual(["body", "corner", "left", "top"]);
    const by = Object.fromEntries(pieces.map((piece) => [piece.zone, piece]));
    expect(by.corner.rect).toEqual({ x: colX(0), y: rowY(0), w: widths[0] - 1, h: ROW - 1 });
    expect(by.corner.cut).toEqual({ top: false, right: true, bottom: true, left: false });
    expect(by.top.rect).toEqual({ x: colX(0), y: rowY(0), w: rect.w, h: ROW - 1 });
    expect(by.left.rect).toEqual({ x: colX(0), y: 0, w: widths[0] - 1, h: rowY(6) - FROZEN.top });
    expect(by.left.cut.top).toBe(true);
    expect(by.body.rect).toEqual(rect);
  });

  it("un intervallo tutto in una fascia ferma non ha un pezzo nel corpo", () => {
    expect(zones(rectPieces(box(0, 2, 0, 3), FROZEN))).toEqual(["top"]);
    expect(zones(rectPieces(box(3, 0, 5, 0), FROZEN))).toEqual(["left"]);
    expect(zones(rectPieces(box(0, 0, 0, 0), FROZEN))).toEqual(["corner"]);
  });

  it("un lato tagliato passa oltre il taglio di `bleed`; gli altri no", () => {
    const rect = box(0, 0, 5, 3);
    const corner = clipRect("corner", rect, FROZEN, { bleed: 3 })!;
    expect(corner.rect).toEqual({ x: colX(0), y: rowY(0), w: widths[0] - 1 + 3, h: ROW - 1 + 3 });
    const left = clipRect("left", rect, FROZEN, { bleed: 3 })!;
    expect(left.rect.y).toBe(-3);
    expect(left.rect.h).toBe(rowY(6) - FROZEN.top + 3);
    expect(clipRect("body", rect, FROZEN, { bleed: 3 })!.rect).toEqual(rect);
  });

  it("una fascia delle intestazioni arriva al bordo della zona", () => {
    const band = { x: colX(2), y: 0, w: 64, h: HEAD_H };
    expect(clipRect("top", band, NONE, { band: true })?.rect).toEqual(band);
    expect(clipRect("top", band, NONE)?.rect.h).toBe(HEAD_H - 1);
  });

  it("un rettangolo vuoto non ha pezzi", () => {
    expect(rectPieces({ x: 10, y: 10, w: 0, h: 20 }, FROZEN)).toEqual([]);
  });
});

describe("i segni d'angolo", () => {
  // Il quadratino: 8 × 8 px col centro sull'angolo di fine.
  const handle = (x: number, y: number): Rect => ({ x: x - 4, y: y - 4, w: 8, h: 8 });

  it("sul filo della colonna bloccata: l'angolo d'inizio di B5 è del corpo, quello di fine di A5 della colonna ferma", () => {
    expect(cornerZone(colX(1), rowY(4), true, COLUMN_ONLY)).toBe("body");
    expect(cornerZone(colX(1), rowY(5), false, COLUMN_ONLY)).toBe("left");
  });

  it("B2 con la riga e la colonna bloccate: l'inizio è del corpo; A1 finisce nell'angolo", () => {
    expect(cornerZone(colX(1), rowY(1), true, FROZEN)).toBe("body");
    expect(cornerZone(colX(1), rowY(1), false, FROZEN)).toBe("corner");
    expect(cornerZone(colX(2), rowY(1), false, FROZEN)).toBe("top");
    expect(cornerZone(colX(1), rowY(2), false, FROZEN)).toBe("left");
  });

  it("un segno d'angolo è un pezzo solo e intero, anche sul filo", () => {
    for (const [x, y, bands] of [
      [colX(1), rowY(5), COLUMN_ONLY],
      [colX(2), rowY(1), FROZEN],
      [colX(1), rowY(1), FROZEN],
      [colX(3), rowY(6), FROZEN],
    ] as const) {
      const rect = handle(x, y);
      const piece = cornerPiece(rect, { x, y, start: false }, bands);
      expect(piece.rect.w).toBe(8);
      expect(piece.rect.h).toBe(8);
      expect(piece.rect).toEqual(wholeRect(piece.zone, rect, bands));
    }
  });

  it("il quadratino di A5 sta nella colonna ferma, sotto la testa", () => {
    const piece = cornerPiece(handle(colX(1), rowY(5)), { x: colX(1), y: rowY(5), start: false }, COLUMN_ONLY);
    expect(piece.zone).toBe("left");
    expect(piece.rect).toEqual({ x: colX(1) - 4, y: rowY(5) - 4 - COLUMN_ONLY.top, w: 8, h: 8 });
  });

  it("dopo uno scorrimento di lato l'inizio di B5 passa sotto la fascia, la fine di A5 resta sul filo", () => {
    const scroll = { left: 40, top: 0 };
    expect(cornerSeen(colX(1), rowY(4), true, COLUMN_ONLY, scroll)).toBeNull();
    expect(cornerSeen(colX(1), rowY(5), false, COLUMN_ONLY, scroll)).toEqual({ x: colX(1), y: rowY(5), zone: "left" });
    // Fermi, si vedono tutti e due sul filo.
    expect(cornerSeen(colX(1), rowY(4), true, COLUMN_ONLY, { left: 0, top: 0 })).toEqual({ x: colX(1), y: rowY(4), zone: "body" });
  });

  it("scorrendo in giù l'angolo della testa resta, quello del corpo passa sotto", () => {
    const scroll = { left: 0, top: 40 };
    expect(cornerSeen(colX(2), rowY(1), false, FROZEN, scroll)).toEqual({ x: colX(2), y: rowY(1), zone: "top" });
    expect(cornerSeen(colX(2), rowY(2), false, FROZEN, scroll)).toBeNull();
  });
});

describe("i pezzi della selezione", () => {
  it("i quattro lati sono simmetrici: uno spessore sul filo di ogni lato e uno dentro", () => {
    const b = box(1, 1, 3, 2);
    const parts = edgeParts("rect", "edge", { L: b.x, T: b.y, R: b.x + b.w, B: b.y + b.h }, 2);
    const by = Object.fromEntries(parts.map((part) => [part.name, part.rect]));
    // Il filo a sinistra di una cella è il suo pixel prima; quello a destra
    // il suo ultimo.
    expect(by["rect-top"]).toEqual({ x: b.x - 1, y: b.y - 1, w: b.w + 1, h: 2 });
    expect(by["rect-bottom"]).toEqual({ x: b.x - 1, y: b.y + b.h - 2, w: b.w + 1, h: 2 });
    expect(by["rect-left"]).toEqual({ x: b.x - 1, y: b.y - 1, w: 2, h: b.h + 1 });
    expect(by["rect-right"]).toEqual({ x: b.x + b.w - 2, y: b.y - 1, w: 2, h: b.h + 1 });
  });

  it("dai dieci numeri: lati, anello, velo intorno alla cella attiva, quadratino e fasce", () => {
    const b = box(1, 1, 3, 2);
    const a = box(2, 1, 2, 1);
    const g = [b.x, b.y, b.x + b.w, b.y + b.h, a.x, a.y, a.x + a.w, a.y + a.h, b.x + b.w, b.y + b.h];
    const parts = selectionParts(g, { lone: false, edges: true, handle: true, header: { width: HEAD_W, height: HEAD_H } });
    const by = Object.fromEntries(parts.map((part) => [part.name, part]));
    expect(parts.filter((part) => part.kind === "edge")).toHaveLength(4);
    expect(parts.filter((part) => part.kind === "ring")).toHaveLength(4);
    // Il velo copre il rettangolo tranne la cella attiva.
    const veil = parts.filter((part) => part.kind === "veil").reduce((sum, part) => sum + part.rect.w * part.rect.h, 0);
    expect(veil).toBe(b.w * b.h - a.w * a.h);
    expect(by.handle!.rect).toEqual({ x: b.x + b.w - 5, y: b.y + b.h - 5, w: 8, h: 8 });
    expect(by.handle!.corner).toEqual({ x: b.x + b.w, y: b.y + b.h, start: false });
    expect(by["band-col"]!.rect).toEqual({ x: b.x, y: 0, w: b.w, h: HEAD_H });
    expect(by["band-row"]!.rect).toEqual({ x: 0, y: b.y, w: HEAD_W, h: b.h });
    // Su una cella sola l'anello e il velo non hanno un posto d'arrivo.
    const lone = selectionParts(g, { lone: true, edges: false, handle: false, header: { width: 0, height: 0 } });
    expect(lone.every((part) => part.rest === false)).toBe(true);
    expect(lone.some((part) => part.kind === "edge" || part.kind === "handle")).toBe(false);
  });

  it("un pezzo fuori dalla zona diventa una riga vuota sul suo bordo, da cui entra", () => {
    // Un lato del corpo che sta tutto sotto la testa ferma: nella testa è una
    // riga vuota sul filo, non un pezzo grande.
    const rect = box(4, 2, 4, 2);
    const flat = looseRect("top", rect, FROZEN);
    expect(flat.h).toBe(0);
    expect(flat.y).toBe(FROZEN.top - 1);
    // Nel corpo resta com'è.
    expect(looseRect("body", rect, FROZEN)).toEqual(rect);
  });
});
