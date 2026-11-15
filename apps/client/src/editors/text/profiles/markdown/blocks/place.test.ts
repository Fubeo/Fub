import { describe, expect, it } from "vitest";
import {
  besideSide, HELD_MAX, heldHeight, leanOf, magnet, NEST_PX, neighbourAt, nextPlace, type PlaceGeometry,
  shiftOf, shownTop, sideways, SIDEWAYS_MAX, slotTop, tailShift,
} from "./place";

// La regola del posto (E2): dove si apre lo spazio per il blocco in mano, e
// quando cambia. Senza DOM: soltanto le misure prese alla presa.

/// Dei fratelli alti `heights`, uno sotto l'altro con `gap` px fra due, con la
/// tratta in mano (alta `held`) al posto `origin`. Le misure dei vicini sono
/// quelle «come se la tratta non ci fosse».
function geometry(heights: readonly number[], origin: number, held: number, gap = 6, floor = 0): PlaceGeometry {
  const neighbours: { top: number; height: number }[] = [];
  let y = 0;
  let top = 0;
  heights.forEach((height, k) => {
    if (k === origin) {
      top = y;
      y += held + gap;
    }
    neighbours.push({ top: y, height });
    y += height + gap;
  });
  if (origin >= heights.length) top = y;
  // Come se la tratta non ci fosse: chi stava sotto risale.
  return {
    neighbours: neighbours.map((each, k) => (k >= origin ? { ...each, top: each.top - held - gap } : each)),
    origin,
    top,
    height: held,
    gap,
    floor,
  };
}

/// Il posto che si raggiunge muovendo il centro del blocco in mano lungo `path`.
function walk(geo: PlaceGeometry, path: readonly number[]): number[] {
  let s = geo.origin;
  return path.map((centre) => (s = nextPlace(geo, s, centre)));
}

describe("il blocco in mano", () => {
  it("non è mai più alto di 104 px", () => {
    expect(heldHeight(24)).toBe(24);
    expect(heldHeight(400)).toBe(HELD_MAX);
    expect(HELD_MAX).toBe(104);
  });

  it("segue il puntatore di lato per un terzo, fino a 28 px", () => {
    expect(sideways(30)).toBe(10);
    expect(sideways(-30)).toBe(-10);
    expect(sideways(300)).toBe(SIDEWAYS_MAX);
    expect(sideways(-300)).toBe(-SIDEWAYS_MAX);
  });

  it("vicino al posto la calamita lo accosta, lontano no", () => {
    expect(magnet(0)).toBe(0);
    expect(magnet(10)).toBeGreaterThan(0);
    expect(magnet(10)).toBeLessThan(10);
    expect(magnet(-10)).toBeLessThan(0);
    expect(magnet(40)).toBe(0);
  });
});

describe("il posto", () => {
  it("alla presa sta sull'origine, e soltanto un blocco alto fa salire ciò che sta sotto", () => {
    const low = geometry([24, 24, 24], 1, 24);
    expect(nextPlace(low, 1, low.top + 12)).toBe(1);
    expect(slotTop(low, 1)).toBe(low.top);
    // Un blocco basso: niente si muove.
    for (let k = 0; k < 3; k++) expect(shiftOf(low, k, 1)).toBe(0);
    expect(tailShift(low)).toBe(0);
    // Un blocco alto 300 px: il suo spazio si stringe a 104 e ciò che sta sotto sale.
    const tall = geometry([24, 24, 24], 1, 300);
    expect(shiftOf(tall, 0, 1), "ciò che sta sopra resta fermo").toBe(0);
    expect(shiftOf(tall, 1, 1)).toBe(-(300 - HELD_MAX));
    expect(shiftOf(tall, 2, 1)).toBe(-(300 - HELD_MAX));
    expect(tailShift(tall)).toBe(-(300 - HELD_MAX));
  });

  it("cambia quando il centro supera il centro del vicino, avanti e indietro", () => {
    const geo = geometry([24, 24, 24, 24], 0, 24);
    // Il vicino 0 si vede scostato sotto il posto: il suo centro è a 30 + 12.
    expect(nextPlace(geo, 0, 41)).toBe(0);
    expect(nextPlace(geo, 0, 43)).toBe(1);
    // Per tornare si ripassa il centro del vicino, che ora sta sopra il posto: 12.
    expect(nextPlace(geo, 1, 20)).toBe(1);
    expect(nextPlace(geo, 1, 11)).toBe(0);
    // Un salto lungo passa più vicini in una volta.
    expect(nextPlace(geo, 0, 500)).toBe(4);
    expect(nextPlace(geo, 4, -50)).toBe(0);
  });

  it("non trema sul confine: avanti e indietro di un pixel non lo cambia", () => {
    const geo = geometry([24, 24, 24], 0, 24);
    const path = [42, 43, 42, 43, 42, 41, 42, 43];
    const seen = walk(geo, path);
    // Passato il centro una volta, il posto resta finché non si ripassa quello di sopra.
    expect(seen).toEqual([0, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("accanto a un blocco alto il posto non trema, e chiede di ripassarne il centro", () => {
    // Un blocco piccolo trascinato oltre una tabella alta 300 px.
    const geo = geometry([300, 24], 0, 24);
    const centre = 30 + 150;
    expect(nextPlace(geo, 0, centre - 1)).toBe(0);
    expect(nextPlace(geo, 0, centre + 1)).toBe(1);
    // Tornando, il confine è il centro della tabella che ora sta sopra: 150.
    const back = walk({ ...geo, origin: 0 }, [centre + 1, centre - 1, 160, 151, 149]);
    expect(back).toEqual([1, 1, 1, 1, 0]);
  });

  it("il posto apre lo spazio: i vicini dal posto in giù scendono di quanto è alto", () => {
    const geo = geometry([24, 24, 24], 0, 24);
    expect(slotTop(geo, 2)).toBe(geo.neighbours[2]!.top);
    expect(shownTop(geo, 1, 2)).toBe(geo.neighbours[1]!.top);
    expect(shownTop(geo, 2, 2)).toBe(geo.neighbours[2]!.top + 30);
    // In fondo, dopo l'ultimo vicino e il suo margine.
    expect(slotTop(geo, 3)).toBe(geo.neighbours[2]!.top + 24 + 6);
    // Le righe vere dei vicini sotto l'origine stavano 30 px più in basso.
    expect(shiftOf(geo, 0, 2)).toBe(-30);
    expect(shiftOf(geo, 2, 2)).toBe(0);
  });

  it("il frontmatter resta primo: il posto non va mai prima di lui, e lui non si sposta", () => {
    const geo = geometry([60, 24, 24], 2, 24, 6, 1);
    expect(nextPlace(geo, 2, -100)).toBe(1);
    const pinned = { ...geometry([24, 24], 0, 60), fixed: true };
    expect(nextPlace(pinned, 0, 500)).toBe(0);
  });

  it("un blocco solo, o l'ultimo, ha un posto solo o arriva in fondo", () => {
    const alone = geometry([], 0, 24);
    expect(nextPlace(alone, 0, 300)).toBe(0);
    expect(slotTop(alone, 0)).toBe(alone.top);
    const last = geometry([24, 24], 2, 24);
    expect(nextPlace(last, 2, 1000)).toBe(2);
    expect(nextPlace(last, 2, -1000)).toBe(0);
  });

  it("trova il vicino che si vede a un'altezza", () => {
    const geo = geometry([24, 24, 24], 0, 24);
    expect(neighbourAt(geo, 0, geo.neighbours[0]!.top + 30 + 5)).toBe(0);
    expect(neighbourAt(geo, 3, geo.neighbours[1]!.top + 5)).toBe(1);
    expect(neighbourAt(geo, 0, -50)).toBe(-1);
  });
});

describe("di lato", () => {
  it("in un elenco 24 px a destra annidano, 24 a sinistra portano fuori", () => {
    const can = { list: true, canNest: true, canOutdent: true };
    expect(leanOf(NEST_PX - 1, can)).toBe("none");
    expect(leanOf(NEST_PX, can)).toBe("nest");
    expect(leanOf(-NEST_PX, can)).toBe("outdent");
    expect(leanOf(NEST_PX, { ...can, canNest: false })).toBe("none");
    expect(leanOf(-NEST_PX, { ...can, canOutdent: false })).toBe("none");
    expect(leanOf(100, { ...can, list: false })).toBe("none");
  });

  it("sull'ultimo ottavo a destra, o portato oltre il bordo sinistro, il posto diventa «Accanto»", () => {
    expect(besideSide(790, 760, 0, 800, false)).toBe("right");
    expect(besideSide(699, 660, 0, 800, false)).toBeNull();
    expect(besideSide(50, 20, 0, 800, false), "la presa porta il puntatore sul testo: non è «Accanto»").toBeNull();
    expect(besideSide(-50, -24, 0, 800, false), "portato oltre il bordo sinistro").toBe("left");
    expect(besideSide(-50, -23, 0, 800, false)).toBeNull();
    expect(besideSide(-50, -40, 0, 800, true), "in un elenco la sinistra porta fuori").toBeNull();
    expect(besideSide(790, 760, 0, 800, true)).toBe("right");
  });
});
