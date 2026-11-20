// **Il presidio degli esiti del fotografo**: quando una foto si rifà, come si
// sommano i due scatti, che cosa fa cadere il banco e che cosa dice il
// riepilogo. Il fotografo vero (`photos.mjs`) apre un browser e non gira qui.
import { describe, expect, it } from "vitest";

import {
  OUTCOMES,
  combineShots,
  failures,
  needsSecondShot,
  stepSummary,
  unstableRecord,
  verifySummary,
  type Outcome,
  type PhotoRow,
} from "./photos-outcomes.mjs";

const row = (outcome: Outcome, extra: Partial<PhotoRow> = {}): PhotoRow => ({
  scene: { id: "mini-barra-colore" },
  light: "dark",
  name: "mini-barra-colore-dark.png",
  outcome,
  different: 0,
  totale: 1_024_000,
  ...extra,
});

const changed = row(OUTCOMES.changed, { different: 4304, reason: "4304 pixel diversi su 1024000 (0.42%)" });
const timeout = row(OUTCOMES.unstable, { reason: "page.waitForSelector: Timeout 30000ms exceeded." });
const HINT = "npm run bench:update";

describe("il secondo scatto", () => {
  it("si fa per una foto cambiata o non arrivata allo scatto, soltanto in verifica", () => {
    expect(needsSecondShot(changed, { update: false })).toBe(true);
    expect(needsSecondShot(timeout, { update: false })).toBe(true);
    expect(needsSecondShot(changed, { update: true })).toBe(false);
    expect(needsSecondShot(timeout, { update: true })).toBe(false);
  });

  it("non si fa per una foto uguale, scritta o senza baseline", () => {
    for (const outcome of [OUTCOMES.equal, OUTCOMES.written, OUTCOMES.withoutBaseline, OUTCOMES.recovered]) {
      expect(needsSecondShot(row(outcome), { update: false }), outcome).toBe(false);
    }
  });

  it("uguale alla baseline: instabile ma ripresa, col motivo del primo", () => {
    const merged = combineShots(changed, row(OUTCOMES.equal, { different: 12 }));
    expect(merged.outcome).toBe(OUTCOMES.recovered);
    expect(merged.different).toBe(12);
    expect(merged.first).toEqual({ outcome: OUTCOMES.changed, reason: changed.reason, different: 4304 });
    expect(combineShots(timeout, row(OUTCOMES.equal)).first?.outcome).toBe(OUTCOMES.unstable);
  });

  it("diverso anche il secondo: resta cambiata, con la differenza del secondo", () => {
    const second = row(OUTCOMES.changed, { different: 4100, reason: "4100 pixel diversi" });
    expect(combineShots(changed, second)).toBe(second);
    expect(combineShots(timeout, second)).toBe(second);
  });

  it("il secondo non arriva allo scatto: vale il primo", () => {
    expect(combineShots(changed, timeout)).toBe(changed);
    expect(combineShots(timeout, row(OUTCOMES.unstable, { reason: "altro" }))).toBe(timeout);
  });

  it("un secondo scatto non si rifà: la foto combinata non chiede un terzo", () => {
    for (const second of [row(OUTCOMES.equal), changed, timeout]) {
      const merged = combineShots(changed, second);
      // Il fotografo chiama `needsSecondShot` sul primo soltanto; qui si dice
      // che anche chi la richiamasse sulla foto ripresa non ne otterrebbe un altro.
      if (merged.outcome === OUTCOMES.recovered) expect(needsSecondShot(merged, { update: false })).toBe(false);
    }
  });
});

describe("il riepilogo", () => {
  const recovered = combineShots(changed, row(OUTCOMES.equal));
  const equal = row(OUTCOMES.equal, { scene: { id: "kit" }, name: "kit-dark.png" });

  it("una foto ripresa non fa cadere il banco, ma ha la sua riga", () => {
    expect(failures([equal, recovered])).toBe(0);
    const { lines, exitCode } = verifySummary([equal, recovered], { updateHint: HINT });
    expect(exitCode).toBe(0);
    expect(lines[0]).toBe("2/2 foto uguali alle baseline");
    expect(lines[1]).toContain("1 instabili ma riprese al secondo scatto");
    expect(lines[1]).toContain("mini-barra-colore-dark.png (4304 pixel diversi su 1024000 (0.42%))");
    expect(lines.join("\n")).not.toContain(HINT);
  });

  it("cambiata, senza baseline e instabile fanno cadere il banco", () => {
    const report = [equal, changed, timeout, row(OUTCOMES.withoutBaseline), recovered];
    expect(failures(report)).toBe(3);
    const { lines, exitCode } = verifySummary(report, { updateHint: HINT });
    expect(exitCode).toBe(1);
    expect(lines[0]).toBe("2/5 foto uguali alle baseline · 3 da guardare");
    expect(lines[lines.length - 1]).toContain(HINT);
  });

  it("tutto uguale: una riga sola, nessun file delle instabili", () => {
    const { lines, exitCode } = verifySummary([equal], { updateHint: HINT });
    expect(exitCode).toBe(0);
    expect(lines).toEqual(["1/1 foto uguali alle baseline"]);
    expect(unstableRecord([equal])).toEqual([]);
    expect(stepSummary([equal])).toBe("");
  });

  it("instabili.json dice scena, luce, foto e il primo scatto", () => {
    expect(unstableRecord([equal, changed, recovered])).toEqual([
      {
        scena: "mini-barra-colore",
        luce: "dark",
        foto: "mini-barra-colore-dark.png",
        primo: { esito: OUTCOMES.changed, motivo: changed.reason, pixel: 4304 },
      },
    ]);
  });

  it("la pagina della corsa elenca le cadute e le riprese", () => {
    const text = stepSummary([equal, timeout, recovered]);
    expect(text).toContain("✗ `mini-barra-colore-dark.png`: instabile · page.waitForSelector");
    expect(text).toContain("⚠ `mini-barra-colore-dark.png`: instabile ma ripresa · al primo scatto 4304 pixel");
    expect(text).not.toContain("kit-dark.png");
  });
});
