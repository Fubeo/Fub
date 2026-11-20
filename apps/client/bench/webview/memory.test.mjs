import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { COLLECT_SCRIPT, buildCollector, collect, pendenza, quiet } from "./memory.mjs";

describe("la raccolta forzata della WebView per R1 (#284)", () => {
  it("con il gancio spento non raccoglie niente e lo dice", async () => {
    const scripts = [];
    const session = { execute: async (script) => (scripts.push(script), null) };
    const result = await collect(session);
    expect(result.on).toBe(false);
    expect(result.did).toBeUndefined();
    expect(scripts).toEqual([COLLECT_SCRIPT]);
  });

  it("con il gancio acceso aspetta la risposta della pagina e dice che cosa ha fatto", async () => {
    const session = { execute: async () => 7 };
    const result = await collect(session);
    expect(result).toMatchObject({ on: true, did: 7 });
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });

  it("chiede la funzione della pagina solo se c'è", () => {
    expect(COLLECT_SCRIPT).toContain("typeof window.__fubBenchGc === 'function'");
    expect(COLLECT_SCRIPT).toContain(": null");
  });

  it("fuori da Linux non costruisce l'estensione", () => {
    const calls = [];
    const result = buildCollector("/non/usata", { platform: "win32", run: (...args) => calls.push(args) });
    expect(result.skipped).toMatch(/soltanto/);
    expect(calls).toEqual([]);
  });

  it("su Linux la costruisce con rustc come libreria condivisa", () => {
    const calls = [];
    const dir = "/cartella/finta";
    const result = buildCollector(dir, { platform: "linux", rustc: "rustc-finto", run: (...args) => calls.push(args) });
    expect(result).toEqual({ dir });
    const [[command, args]] = calls;
    expect(command).toBe("rustc-finto");
    expect(args).toEqual(expect.arrayContaining(["--crate-type", "cdylib", "-o", `${dir}/libfub-banco-raccolta.so`]));
    expect(args.at(-1)).toMatch(/raccolta\.rs$/);
  });

  it("se rustc fallisce lo dice invece di fermare il banco", () => {
    const dir = "/cartella/finta";
    const run = () => {
      const error = new Error("uscito con 1");
      error.stderr = Buffer.from("error[E0425]: qualcosa\nerror: aborting due to 1 previous error\n");
      throw error;
    };
    const result = buildCollector(dir, { platform: "linux", run });
    expect(result.skipped).toMatch(/non si costruisce: .*aborting/);
  });
});

/// Un orologio finto: `pause` lo fa avanzare, ogni lettura costa `readMs`.
function fakeClock(readMs = 0) {
  let t = 0;
  return {
    now: () => t,
    pause: async (ms) => {
      t += ms;
    },
    reader: (values) => {
      let i = 0;
      return async () => {
        t += readMs;
        const pss = values[Math.min(i++, values.length - 1)];
        return pss === null ? null : { pss };
      };
    },
  };
}

const QUIET = { since: 0, firstMs: 2_000, stepMs: 1_000, maxMs: 10_000, stillMiB: 4 };

describe("la quiete dopo una chiusura di R1", () => {
  it("finisce alla prima coppia di letture vicine e vale la più bassa", async () => {
    const clock = fakeClock();
    const result = await quiet(clock.reader([1300, 1260, 1250, 1248, 1100]), clock.pause, { ...QUIET, now: clock.now });
    expect(result.reads.map((r) => r.pss)).toEqual([1300, 1260, 1250, 1248]);
    expect(result.soon.pss).toBe(1300);
    expect(result.lowest.pss).toBe(1248);
    expect(result.stillAtMs).toBe(5_000);
    expect(result.reads[0].atMs).toBe(2_000);
  });

  it("una memoria che non si ferma finisce al tetto, senza dire ferma", async () => {
    const clock = fakeClock(500);
    const falling = Array.from({ length: 20 }, (_, i) => 1400 - 10 * i);
    const result = await quiet(clock.reader(falling), clock.pause, { ...QUIET, now: clock.now });
    expect(result.stillAtMs).toBeNull();
    expect(result.reads.at(-1).atMs).toBeLessThanOrEqual(QUIET.maxMs);
    expect(result.lowest.pss).toBe(falling[result.reads.length - 1]);
  });

  it("conta il tempo dalla chiusura, non dall'inizio della quiete", async () => {
    const clock = fakeClock();
    await clock.pause(1_500);
    const result = await quiet(clock.reader([1000, 1000]), clock.pause, { ...QUIET, now: clock.now });
    expect(result.reads.map((r) => r.atMs)).toEqual([2_000, 3_000]);
  });

  it("una raccolta più lunga del tetto non lascia il giro con una lettura sola", async () => {
    // Sotto carico una raccolta forzata è durata 70 s: la prima lettura
    // arriva dopo il tetto, e la seconda raccolta abbassa ancora la memoria.
    const clock = fakeClock(12_000);
    const result = await quiet(clock.reader([1400, 1340, 1300]), clock.pause, { ...QUIET, now: clock.now });
    expect(result.reads.map((r) => r.pss)).toEqual([1400, 1340]);
    expect(result.lowest.pss).toBe(1340);
    expect(result.stillAtMs).toBeNull();
  });

  it("senza letture la quiete finisce al tetto duro", async () => {
    const clock = fakeClock(1_000);
    const result = await quiet(clock.reader([null]), clock.pause, { ...QUIET, hardMaxMs: 20_000, now: clock.now });
    expect(result.lowest).toBeNull();
    // Non comincia una lettura dopo il tetto duro: l'ultima finisce entro una lettura.
    expect(result.reads.at(-1).atMs).toBeLessThanOrEqual(20_000 + 1_000);
  });

  it("una lettura che manca non ferma la quiete e non è la più bassa", async () => {
    const clock = fakeClock();
    const result = await quiet(clock.reader([1200, null, 1199]), clock.pause, { ...QUIET, now: clock.now });
    expect(result.reads.map((r) => r.pss)).toEqual([1200, null, 1199]);
    expect(result.lowest.pss).toBe(1199);
    expect(result.stillAtMs).toBe(4_000);
  });
});

describe("la soglia della pendenza di R1 scopre una perdita", () => {
  const ci = JSON.parse(readFileSync(new URL("./budgets.json", import.meta.url), "utf8")).ci["R1.giri.pendenza.MiB"];
  // I residui dei primi quindici giri della corsa più ripida delle dieci di
  // `main` dal 18 al 20 novembre 2026 con la raccolta forzata (run
  // 44484569519, lettura a 10 s, MiB interi): un salto di 65 MiB all'ottavo
  // giro e la crescita di fondo della WebView.
  const worst = [210, 212, 222, 233, 237, 240, 244, 309, 313, 313, 318, 316, 319, 329, 328];
  const leak = (mibPerRound) => worst.map((y, i) => y + mibPerRound * (i + 1));

  it("la corsa peggiore vista resta sotto la soglia", () => {
    expect(pendenza(worst)).toBeLessThan(ci);
  });

  it("la stessa corsa con 11 MiB lasciati a ogni giro la supera", () => {
    // La pendenza di Theil e Sen di y + k·giro è quella di y più k: la soglia
    // scopre ogni perdita sopra soglia meno la pendenza peggiore vista.
    expect(pendenza(leak(11))).toBeGreaterThan(ci);
    expect(pendenza(leak(11)) - pendenza(worst)).toBeCloseTo(11, 5);
  });
});
