import { describe, expect, it } from "vitest";
import { type LiveDeco, wholePill, wholePills } from "./livepreview";

// La pastiglia della scadenza nella Live non sta mai a cavallo di un segno:
// CodeMirror la spezzerebbe in due toppe. Le posizioni sono quelle di
// "- [ ] Inviti `📅 2026-11-16`": il codice va da 13 a 29, i backtick sono
// nascosti, la data sta fra 14 e 28.

const pill: LiveDeco = { from: 14, to: 28, kind: "task-due" };
const hides: LiveDeco[] = [
  { from: 13, to: 14, kind: "hide" },
  { from: 28, to: 29, kind: "hide" },
];

describe("wholePill", () => {
  it("prende il codice che è tutto la scadenza, coi suoi segni nascosti", () => {
    // Il segno del codice ha lo stesso tratto della data: senza allargarsi la
    // pastiglia starebbe dentro il fondo grigio del codice.
    const code: LiveDeco = { from: 14, to: 28, kind: "code" };
    expect(wholePill(pill, [code, ...hides])).toMatchObject({ from: 13, to: 29 });
  });

  it("prende per intero un segno che ne attraversa il bordo", () => {
    const strong: LiveDeco = { from: 20, to: 32, kind: "strong" };
    expect(wholePill(pill, [strong])).toMatchObject({ from: 14, to: 32 });
  });

  it("resta dentro un segno che contiene anche altro testo", () => {
    const code: LiveDeco = { from: 8, to: 28, kind: "code" };
    expect(wholePill(pill, [code, { from: 7, to: 8, kind: "hide" }, hides[1]!])).toMatchObject({ from: 14, to: 28 });
  });
});

describe("wholePills", () => {
  // Un documento di mille compiti, una riga di 40 caratteri ciascuno: un
  // grassetto, un codice coi suoi backtick nascosti e la pastiglia dentro.
  const rows = 1000;
  const decos: LiveDeco[] = [];
  const pills: { pill: LiveDeco; from: number; to: number }[] = [];
  for (let row = 0; row < rows; row++) {
    const at = row * 40;
    decos.push(
      { from: at, to: at, kind: "list-bullet" },
      { from: at + 6, to: at + 10, kind: "strong" },
      { from: at + 13, to: at + 14, kind: "hide" },
      { from: at + 14, to: at + 28, kind: "code" },
      { from: at + 28, to: at + 29, kind: "hide" },
    );
    pills.push({ pill: { from: at + 14, to: at + 28, kind: "task-due" }, from: at, to: at + 39 });
  }

  it("dà le stesse pastiglie che guardando tutti i segni", () => {
    expect(wholePills(pills, decos)).toEqual(pills.map(({ pill }) => wholePill(pill, decos)));
  });

  it("guarda solo i segni del compito: mille compiti stanno nella battuta", () => {
    const started = performance.now();
    wholePills(pills, decos);
    const elapsed = performance.now() - started;
    // Guardando tutti i segni per ogni compito sono cinque milioni di passi;
    // col tratto del compito qualche migliaio.
    expect(elapsed).toBeLessThan(40);
  });
});
