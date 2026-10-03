// Il codec di `fub:ink`: gli stessi casi di `crates/fub-scene/tests/ink.rs`,
// con lo stesso generatore, più i controlli che servono solo a TypeScript
// (gli interi in un `number`, il passaggio da e verso `QuantizedInk`).

import { describe, expect, it } from "vitest";
import {
  createInk,
  decodeInk,
  encodeInk,
  INK_MAX_BYTES,
  inkChannel,
  inkDuration,
  inkFromQuantized,
  inkFromSamples,
  inkLength,
  inkPoint,
  inkSample,
  inkToQuantized,
  unknownChannels,
  type Ink,
} from "./codec";
import { INK_MAX_INTEGER, INK_MAX_SAMPLES, InkError, quantizeInk, type InkSample, type InkScale } from "./sample";

/// xorshift64*, come `Rng` di `tests/ink.rs`: stesso seme, stessi numeri.
class Rng {
  private state: bigint;

  constructor(seed: bigint) {
    this.state = seed;
  }

  next(): number {
    const mask = (1n << 64n) - 1n;
    let s = this.state;
    s ^= s >> 12n;
    s = (s ^ (s << 25n)) & mask;
    s ^= s >> 27n;
    this.state = s;
    return Number(((s * 0x2545f4914f6cdd1dn) & mask) >> 11n) / 2 ** 53;
  }

  between(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
}

/// Un tratto che va avanti e indietro, con pressione e inclinazione a scelta.
function stroke(rng: Rng, count: number, pressure: boolean, tilt: boolean): InkSample[] {
  let x = rng.between(-500, 500);
  let y = rng.between(-500, 500);
  let t = 0;
  const samples: InkSample[] = [];
  for (let i = 0; i < count; i++) {
    if (i > 0) {
      x += rng.between(-3, 3);
      y += rng.between(-3, 3);
      t += rng.between(0, 12);
    }
    // Nell'ordine dei campi di `Sample`, come Rust li valuta.
    const p = pressure ? rng.between(-0.1, 1.1) : undefined;
    if (tilt) {
      const a = rng.between(0, 95);
      const z = rng.between(-10, 370);
      samples.push(p === undefined ? { x, y, t, a, z } : { x, y, p, t, a, z });
    } else {
      samples.push(p === undefined ? { x, y, t } : { x, y, p, t });
    }
  }
  return samples;
}

/// L'errore che lancia `run`, o un fallimento se non ne lancia.
function failure(run: () => unknown): { kind: string; sample: number | null; channel: string | null } {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(InkError);
    const { kind, sample, channel } = error as InkError;
    return { kind, sample, channel };
  }
  throw new Error("nessun errore");
}

const err = (kind: string, sample: number | null = null, channel: string | null = null) => ({ kind, sample, channel });

describe("il codec di fub:ink (§5)", () => {
  it("l'esempio della specifica si legge e si riscrive identico", () => {
    const text = "1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8";
    const ink = decodeInk(text);
    expect(ink.scale).toBe(100);
    expect(ink.channels).toBe("xypt");
    expect(inkLength(ink)).toBe(3);
    expect(inkSample(ink, 1)).toEqual([12075, 3017, 130, 8]);
    expect(inkSample(ink, 2)).toEqual([12106, 3012, 130, 16]);
    expect(inkPoint(ink, 0)).toEqual([120.5, 30.2]);
    expect(inkDuration(ink)).toBe(16);
    expect(encodeInk(ink)).toBe(text);
  });

  it("gli interi seguono la grammatica", () => {
    const first = (value: string): number => inkSample(decodeInk(`1 s100 cxy ${value},0`), 0)[0]!;
    expect(first("0")).toBe(0);
    expect(Object.is(first("-0"), 0)).toBe(true);
    expect(first("007")).toBe(7);
    expect(first("9007199254740991")).toBe(INK_MAX_INTEGER);
    expect(first("-9007199254740991")).toBe(-INK_MAX_INTEGER);
    expect(first("0000000000000000000009007199254740991")).toBe(INK_MAX_INTEGER);
    expect(failure(() => first("9007199254740992"))).toEqual(err("overflow", 0));
    expect(failure(() => first("99999999999999999999999"))).toEqual(err("overflow", 0));
    for (const malformed of ["-", "+1", "1.0", "1e3", "--1", "0x10", "١", "1_0", "Infinity"]) {
      expect(failure(() => first(malformed)), malformed).toEqual(err("integer", 0));
    }
  });

  it("un'andata e ritorno perde solo la quantizzazione", () => {
    const rng = new Rng(0x00f0bd4a20261002n);
    for (const scale of [10, 100] as const) {
      for (const [pressure, tilt] of [[false, false], [true, false], [false, true], [true, true]] as const) {
        for (const count of [1, 2, 137, INK_MAX_SAMPLES]) {
          const samples = stroke(rng, count, pressure, tilt);
          const ink = inkFromSamples(samples, scale);
          const text = encodeInk(ink);
          expect(text.length).toBeLessThanOrEqual(INK_MAX_BYTES);
          const read = decodeInk(text);
          expect(read).toEqual(ink);
          expect(encodeInk(read)).toBe(text);
          expect(inkLength(read)).toBe(count);
          const half = 0.5 / scale + 1e-9;
          const p = inkChannel(read, "p");
          const t = inkChannel(read, "t")!;
          for (let i = 0; i < samples.length; i++) {
            const sample = samples[i]!;
            const [x, y] = inkPoint(read, i);
            expect(Math.abs(x - sample.x) <= half && Math.abs(y - sample.y) <= half).toBe(true);
            expect(Math.abs(inkSample(read, i)[t]! - sample.t)).toBeLessThanOrEqual(0.5);
            if (p !== null && sample.p !== undefined) {
              const quantized = inkSample(read, i)[p]! / 255;
              const clamped = Math.min(Math.max(sample.p, 0), 1);
              expect(Math.abs(quantized - clamped)).toBeLessThanOrEqual(0.5 / 255 + 1e-9);
            }
          }
          if (count > 1) {
            // I tratti vanno anche indietro: ci sono delta negativi.
            expect(text.split(" ").slice(4).some((sample) => sample.includes("-"))).toBe(true);
          }
          // La forma della penna è la stessa, e torna indietro identica.
          expect(inkFromQuantized(quantizeInk(samples, scale))).toEqual(ink);
          expect(inkFromQuantized(inkToQuantized(ink))).toEqual(ink);
        }
      }
    }
  });

  it("la quantizzazione segue le regole di TypeScript", () => {
    const sample = (x: number, p?: number, tilt?: [number, number]): InkSample => {
      const base = p === undefined ? { x, y: 0, t: 0 } : { x, y: 0, p, t: 0 };
      return tilt === undefined ? base : { ...base, a: tilt[0], z: tilt[1] };
    };
    const quantize = (s: InkSample): Ink => inkFromSamples([s], 100);
    // `floor(v × 100 + 0,5)`: i mezzi vanno verso l'alto, anche sotto zero.
    expect(inkSample(quantize(sample(0.005)), 0)[0]).toBe(1);
    expect(inkSample(quantize(sample(-0.005)), 0)[0]).toBe(0);
    expect(inkSample(quantize(sample(-0.0051)), 0)[0]).toBe(-1);
    expect(quantize(sample(120.5)).channels).toBe("xyt");
    // Pressione portata in 0…1, poi per 255.
    expect(inkSample(quantize(sample(0, 1.5)), 0)[2]).toBe(255);
    expect(inkSample(quantize(sample(0, -1)), 0)[2]).toBe(0);
    expect(inkSample(quantize(sample(0, 0.5)), 0)[2]).toBe(128);
    // Altitudine portata in 0…90, azimut modulo 360.
    const tilted = quantize(sample(0, 0.5, [120, 359.5]));
    expect(tilted.channels).toBe("xyptaz");
    expect(inkSample(tilted, 0).slice(4)).toEqual([90, 0]);
    expect(inkSample(quantize(sample(0, undefined, [-5, -1])), 0).slice(3)).toEqual([0, 359]);
    expect(inkSample(quantize(sample(0, undefined, [45.4, 720.6])), 0).slice(3)).toEqual([45, 1]);
  });

  it("la quantizzazione rifiuta ciò che non potrebbe scrivere, con l'errore di Rust", () => {
    const base: InkSample = { x: 0, y: 0, t: 0 };
    const quantize = (samples: InkSample[], scale: InkScale = 100) => failure(() => inkFromSamples(samples, scale));
    expect(quantize([])).toEqual(err("no-samples"));
    expect(quantize([{ ...base, t: 0.3 }])).toEqual(err("first-time"));
    expect(quantize([{ ...base, t: Number.NaN }])).toEqual(err("first-time"));
    expect(quantize(new Array<InkSample>(INK_MAX_SAMPLES + 1).fill(base))).toEqual(err("too-many-samples"));
    expect(quantize([base, { ...base, p: 0.5 }], 10)).toEqual(err("mixed-channels", 1));
    expect(quantize([base, { ...base, a: 1, z: 2 }], 10)).toEqual(err("mixed-channels", 1));
    expect(quantize([base, { ...base, y: Number.NaN }], 10)).toEqual(err("non-finite", 1));
    expect(quantize([base, { ...base, x: Number.POSITIVE_INFINITY }], 10)).toEqual(err("non-finite", 1));
    expect(quantize([base, { ...base, x: 1e15 }])).toEqual(err("overflow", 1));
    // Prima ogni valore finito, poi gli interi; le differenze alla fine.
    expect(quantize([base, { ...base, x: 1e15, y: Number.NaN }])).toEqual(err("non-finite", 1));
    expect(quantize([{ ...base, x: 9e13 }, { ...base, x: -9e13 }, { ...base, y: Number.NaN }])).toEqual(
      err("non-finite", 2),
    );
    expect(quantize([{ ...base, x: 9e13 }, { ...base, x: -9e13 }])).toEqual(err("overflow", 1));
    // Un azimut enorme non è un intero sicuro, anche se il modulo lo sarebbe.
    expect(quantize([{ ...base, a: 0, z: 1e300 }])).toEqual(err("overflow", 0));
  });

  it("ogni inchiostro malformato ha il suo errore", () => {
    const cases: [string, ReturnType<typeof err>][] = [
      ["", err("syntax")],
      ["1", err("syntax")],
      ["1 s100", err("syntax")],
      ["1  s100 cxy 0,0", err("syntax")],
      [" 1 s100 cxy 0,0", err("syntax")],
      ["1 s100 cxy 0,0 ", err("syntax")],
      ["1 s100 cxy 0,0  1,1", err("syntax")],
      ["2 s100 cxy 0,0", err("version")],
      ["01 s100 cxy 0,0", err("version")],
      ["1 s1000 cxy 0,0", err("scale")],
      ["1 S100 cxy 0,0", err("scale")],
      ["1 s100 xy 0,0", err("channels")],
      ["1 s100 cyx 0,0", err("channels")],
      ["1 s100 cx 0", err("channels")],
      ["1 s100 cxyy 0,0,0", err("channels")],
      ["1 s100 cxypp 0,0,0,0", err("channels")],
      ["1 s100 cxy1 0,0,0", err("channels")],
      ["1 s100 Cxy 0,0", err("channels")],
      ["1 s100 cxya 0,0,0", err("tilt")],
      ["1 s100 cxyz 0,0,0", err("tilt")],
      ["1 s100 cxy", err("no-samples")],
      ["1 s100 cxy 0", err("arity", 0)],
      ["1 s100 cxy 0,0 1,1,1", err("arity", 1)],
      ["1 s100 cxy 0,0 1", err("arity", 1)],
      ["1 s100 cxy 0,0 1,", err("integer", 1)],
      ["1 s100 cxy 0,0 ,1", err("integer", 1)],
      ["1 s100 cxy 0,0 +1,1", err("integer", 1)],
      ["1 s100 cxy 0.5,0", err("integer", 0)],
      ["1 s100 cxy 1e3,0", err("integer", 0)],
      ["1 s100 cxy -,0", err("integer", 0)],
      ["1 s100 cxy 0,0\t1,1", err("integer", 0)],
      ["1 s100 cxy 9007199254740992,0", err("overflow", 0)],
      ["1 s100 cxy 9007199254740991,0 1,0", err("overflow", 1)],
      ["1 s100 cxy -9007199254740991,0 -1,0", err("overflow", 1)],
      ["1 s100 cxyt 0,0,5", err("first-time")],
      ["1 s100 cxypt 0,0,256,0", err("range", 0, "p")],
      ["1 s100 cxypt 0,0,255,0 0,0,-256,1", err("range", 1, "p")],
      ["1 s100 cxyaz 0,0,91,0", err("range", 0, "a")],
      ["1 s100 cxyaz 0,0,0,359 0,0,0,1", err("range", 1, "z")],
      ["1 s100 cxyaz 0,0,0,-1", err("range", 0, "z")],
      // Solo in TypeScript: lettere non ASCII, che una RegExp senza `u` o un
      // `toLowerCase` lascerebbero passare.
      ["1 s100 cxyé 0,0,0", err("channels")],
      ["1 s100 cxy 0,0 1,1 ", err("syntax")],
    ];
    for (const [text, error] of cases) expect(failure(() => decodeInk(text)), JSON.stringify(text)).toEqual(error);
  });

  it("il dettaglio di S004 è quello di Rust", () => {
    expect(new InkError("arity", 1).detail).toBe("fub:ink arity 1");
    expect(new InkError("range", 0, "p").detail).toBe("fub:ink range 0 p");
    expect(new InkError("missing").detail).toBe("fub:ink missing");
    expect(new InkError("version").message).toBe("versione di fub:ink sconosciuta");
    expect(new InkError("integer", 3).message).toBe("un valore di fub:ink non è un intero (campione 3)");
  });

  it("i limiti sono inclusi", () => {
    // 10 000 campioni sì, 10 001 no.
    const samples = (n: number): string => `1 s10 cxy 0,0${" 1,-1".repeat(n - 1)}`;
    expect(inkLength(decodeInk(samples(INK_MAX_SAMPLES)))).toBe(INK_MAX_SAMPLES);
    expect(failure(() => decodeInk(samples(INK_MAX_SAMPLES + 1)))).toEqual(err("too-many-samples"));
    // 512 KiB sì, un byte in più no: gli zeri in testa sono ammessi.
    const sized = (bytes: number): string => {
      const head = "1 s100 cxy 0,";
      return `${head}${"0".repeat(bytes - head.length - 1)}1`;
    };
    expect(sized(INK_MAX_BYTES)).toHaveLength(INK_MAX_BYTES);
    expect(() => decodeInk(sized(INK_MAX_BYTES))).not.toThrow();
    expect(failure(() => decodeInk(sized(INK_MAX_BYTES + 1)))).toEqual(err("too-large"));
    // I byte sono UTF-8: un carattere di due byte conta due.
    const wide = `1 s100 cxy 0,0 ${"é".repeat(INK_MAX_BYTES / 2 - 7)}`;
    expect(wide.length).toBeLessThan(INK_MAX_BYTES);
    expect(failure(() => decodeInk(wide))).toEqual(err("too-large"));
    // Gli interi al bordo dei numeri sicuri di JavaScript.
    const max = INK_MAX_INTEGER;
    const ink = decodeInk(`1 s100 cxy ${max},-${max} -1,1`);
    expect(inkSample(ink, 1)).toEqual([max - 1, -max + 1]);
  });

  it("canali facoltativi e sconosciuti", () => {
    let ink = decodeInk("1 s10 cxy 5,-5");
    expect([inkLength(ink), inkDuration(ink), unknownChannels(ink)]).toEqual([1, null, ""]);
    ink = decodeInk("1 s10 cxyqtWp 0,0,7,0,1,255 1,1,-7,30,2,-255");
    expect(unknownChannels(ink)).toBe("qW");
    expect(inkDuration(ink)).toBe(30);
    expect(inkSample(ink, 1)).toEqual([1, 1, 0, 30, 3, 0]);
    // Un canale noto si controlla anche in mezzo agli sconosciuti.
    expect(failure(() => decodeInk("1 s10 cxyqp 0,0,0,300"))).toEqual(err("range", 0, "p"));
    // Per `pf1` restano i canali noti; senza `t` il tempo vale 0.
    expect(inkToQuantized(decodeInk("1 s10 cxyqp 0,0,7,255 2,-1,0,-5"))).toEqual({
      scale: 10,
      samples: [{ x: 0, y: 0, p: 255, t: 0 }, { x: 2, y: -1, p: 250, t: 0 }],
    });
  });

  it("createInk controlla ciò che encodeInk scriverà", () => {
    expect(() => createInk(10, "xy", [0, 0, -3, 4])).not.toThrow();
    expect(failure(() => createInk(10, "xy", []))).toEqual(err("no-samples"));
    expect(failure(() => createInk(10, "xy", [0, 0, 1]))).toEqual(err("arity", 1));
    expect(failure(() => createInk(10, "yx", [0, 0]))).toEqual(err("channels"));
    const max = INK_MAX_INTEGER;
    expect(failure(() => createInk(10, "xy", [max, 0, -max, 0]))).toEqual(err("overflow", 1));
    expect(failure(() => createInk(10, "xy", [-(2 ** 63), 0]))).toEqual(err("overflow", 0));
    expect(failure(() => createInk(10, "xyt", [0, 0, 1]))).toEqual(err("first-time"));
    // Solo in TypeScript: un `number` può non essere un intero.
    expect(failure(() => createInk(10, "xy", [0, 0.5]))).toEqual(err("integer", 0));
    expect(failure(() => createInk(10, "xy", [0, 0, Number.NaN, 0]))).toEqual(err("integer", 1));
    expect(failure(() => createInk(10, "xy", [Number.NEGATIVE_INFINITY, 0]))).toEqual(err("overflow", 0));
    // `-0` si conserva come `0`.
    expect(Object.is(createInk(10, "xy", [-0, 0]).values[0], 0)).toBe(true);
    expect(encodeInk(createInk(10, "xy", [-0, 0, -0, -0]))).toBe("1 s10 cxy 0,0 0,0");
  });
});
