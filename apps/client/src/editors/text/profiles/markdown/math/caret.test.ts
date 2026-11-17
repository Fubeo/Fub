import { describe, expect, it } from "vitest";
import { instrument, nearestPoint, verticalPoint, type Marker } from "./caret";
import { mapFormula, stopsOf } from "./points";

// La geometria del cursore (T60): il clic e le frecce su e giù, sui segni di
// una formula disegnata. Le misure sono quelle di `x+\frac{a}{b}` resa in
// grande; le prova sul disegno vero il banco.

const tex = "x+\\frac{a}{b}";
// Gli indici del TeX: 0 x 1 + 2 \frac{ 8 a 9 }{ 11 b 12 } 13.
const markers: Marker[] = [
  { at: 0, left: 0, top: 10, bottom: 40 },
  { at: 1, left: 12, top: 10, bottom: 40 },
  { at: 2, left: 30, top: 10, bottom: 40 },
  // Il numeratore sta in alto, il denominatore in basso.
  { at: 8, left: 34, top: 0, bottom: 20 },
  { at: 9, left: 44, top: 0, bottom: 20 },
  { at: 11, left: 34, top: 30, bottom: 50 },
  { at: 12, left: 44, top: 30, bottom: 50 },
  { at: 13, left: 52, top: 10, bottom: 40 },
];

describe("il clic", () => {
  it("l'altezza decide fra numeratore e denominatore", () => {
    expect(nearestPoint(markers, 43, 5)).toBe(9);
    expect(nearestPoint(markers, 43, 46)).toBe(12);
    expect(nearestPoint(markers, 35, 4)).toBe(8);
    expect(nearestPoint(markers, 35, 48)).toBe(11);
  });

  it("fuori dalla formula va al capo più vicino", () => {
    expect(nearestPoint(markers, -40, 25)).toBe(0);
    expect(nearestPoint(markers, 200, 25)).toBe(13);
    expect(nearestPoint([], 0, 0)).toBeNull();
  });
});

describe("le frecce su e giù", () => {
  it("vanno al segno più vicino sopra o sotto, nel disegno", () => {
    expect(verticalPoint(markers, 9, 1)).toBe(12);
    expect(verticalPoint(markers, 12, -1)).toBe(9);
  });

  it("senza niente sopra o sotto non trovano niente: il cursore esce", () => {
    expect(verticalPoint(markers, 12, 1)).toBeNull();
    expect(verticalPoint(markers, 9, -1)).toBeNull();
  });
});

describe("i segni", () => {
  it("uno per ogni punto buono, coi quadretti negli spazi vuoti", () => {
    const marked = instrument("\\frac{}{b}");
    for (const at of stopsOf(mapFormula("\\frac{}{b}"))) expect(marked).toContain(`fubp=${at}`);
    expect(marked).toContain("fubhole=1");
    expect(marked).toContain("\\square");
  });

  it("le coordinate del modello sono punti buoni della formula", () => {
    const stops = new Set(stopsOf(mapFormula(tex)));
    for (const marker of markers) expect(stops.has(marker.at), String(marker.at)).toBe(true);
  });
});
