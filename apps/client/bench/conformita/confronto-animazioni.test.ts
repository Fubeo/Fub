// **Il presidio del confronto delle animazioni.**
//
// Il banco vero (`animazioni.mjs`) apre un browser e non gira qui. Qui gira la
// sua parte pura, `confronto-animazioni.mjs`: una soglia sbagliata darebbe
// verde a ogni moto, o rosso a una molla che si muove come la curva del
// prototipo. In fondo, le voci dell'editor contro i loro valori estratti: una
// voce cambiata senza rigenerare l'estrazione si vede già in `npm test`.
import { describe, expect, it } from "vitest";

import {
  type Campione,
  type Corsa,
  type Elemento,
  type Voce,
  confrontaCampioni,
  confrontaCorse,
  confrontaCurve,
  confrontaPartenza,
  confrontaRidotto,
  copertureAnimazioni,
  progresso,
  scriviSelettore,
  validaVoci,
} from "./confronto-animazioni.mjs";
import { ANIMAZIONI, DA_COPRIRE_ANIMAZIONI, STATI } from "./mappa-editor.mjs";
import estratti from "./editor-animazioni.json";
import eccezioni from "./eccezioni-editor-animazioni.json";

const FOTOGRAMMA = 1000 / 60;

/// Una `cubic-bezier` come la calcola il browser: `x(s)` risolto per
/// bisezione, poi `y(s)`.
function bezier(a: number, b: number, c: number, d: number) {
  const coord = (p1: number, p2: number, s: number) => 3 * p1 * s * (1 - s) ** 2 + 3 * p2 * s * s * (1 - s) + s ** 3;
  return (x: number) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (coord(a, c, m) < x) lo = m;
      else hi = m;
    }
    return coord(b, d, (lo + hi) / 2);
  };
}

/// Una molla campionata come la scrive il moto (`linear(…)` a punti): la
/// stessa curva, spezzata in `punti` segmenti dritti.
function aPunti(f: (x: number) => number, punti: number) {
  const ys = Array.from({ length: punti + 1 }, (_, i) => f(i / punti));
  return (x: number) => {
    const i = Math.min(punti - 1, Math.floor(x * punti));
    const t = x * punti - i;
    return ys[i] + (ys[i + 1] - ys[i]) * t;
  };
}

/// I campioni di un elemento che sale di `corsa` px con la curva `f` in
/// `durata` ms dopo `ritardo` ms, letti ogni 4 ms come fa il banco intorno ai
/// punti del prototipo.
function campioni(f: (x: number) => number, { durata = 240, ritardo = 0, corsa = 20, fine = 400 } = {}): Campione[] {
  const out: Campione[] = [];
  for (let t = 0; t <= fine; t += 4) {
    const x = Math.min(1, Math.max(0, (t - ritardo) / durata));
    const y = 100 + corsa * (1 - f(x));
    out.push({ t, letture: { voce: { rect: [10, y, 200, 30], valori: {} } } });
  }
  return out;
}

const ELEMENTO: Elemento = { id: "voce", prototipo: ".a", app: ".b", proprieta: ["geometria"] };
const FINESTRA = [0, 60, 120, 180, 240];
const PROTO = bezier(0.2, 0.8, 0.2, 1);

describe("il progresso", () => {
  it("è la proiezione sulla corsa, e oltre 1 quando la molla oltrepassa", () => {
    expect(progresso([5], [0], [10])).toBe(0.5);
    expect(progresso([11], [0], [10])).toBeCloseTo(1.1);
    expect(progresso([0, 5], [0, 0], [0, 10])).toBe(0.5);
    // Una corsa nulla non divide per zero.
    expect(progresso([3], [2], [2])).toBe(0);
  });
});

describe("le curve", () => {
  it("le parole chiave valgono le loro cubic-bezier, una molla non si confronta", () => {
    expect(confrontaCurve("ease", "cubic-bezier(0.25, 0.1, 0.25, 1)")).toBeNull();
    expect(confrontaCurve("cubic-bezier(0.2, 0.8, 0.2, 1)", "cubic-bezier(0.2, 0.85, 0.25, 1)")).not.toBeNull();
    expect(confrontaCurve("linear(0, 0.4, 1)", "ease")).toBeNull();
    expect(confrontaCurve("steps(4)", "steps(4)")).toBeNull();
    expect(confrontaCurve("steps(4)", "steps(5)")).not.toBeNull();
  });
});

describe("i campioni", () => {
  const confronta = (app: Campione[]) =>
    confrontaCampioni({ elemento: ELEMENTO, finestra: FINESTRA, proto: campioni(PROTO), app, fotogramma: FOTOGRAMMA }).differenze;

  it("una molla a punti che si muove come la cubic-bezier è verde", () => {
    expect(confronta(campioni(aPunti(PROTO, 20)))).toEqual([]);
  });

  it("un fotogramma di ritardo sta dentro la finestra", () => {
    expect(confronta(campioni(PROTO, { ritardo: 16 }))).toEqual([]);
  });

  it("la stessa corsa da un altro punto di partenza è verde: conta il progresso", () => {
    expect(confronta(campioni(PROTO, { corsa: 35 }))).toEqual([]);
  });

  it("una corsa più corta è rossa, col punto peggiore", () => {
    const d = confronta(campioni(bezier(0.2, 0.85, 0.25, 1), { durata: 140 }));
    expect(d.map((x) => x.proprieta)).toEqual(["campioni.geometria.y"]);
    expect(d[0].motivo).toMatch(/progresso al \d+ %/);
  });

  it("una molla che oltrepassa dove il prototipo non lo fa è rossa", () => {
    const molla = (x: number) => 1 - Math.exp(-6 * x) * Math.cos(9 * x);
    expect(confronta(campioni(molla)).map((x) => x.proprieta)).toEqual(["campioni.geometria.y"]);
  });

  it("un salto subito all'arrivo è rosso: nell'app il canale non si muove", () => {
    const d = confronta(campioni(() => 1));
    expect(d).toHaveLength(1);
    expect(d[0].trovato).toBe("fermo");
  });
});

describe("la partenza", () => {
  it("lo scarto di partenza conta, tranne per un elemento in corsa", () => {
    const proto = campioni(PROTO);
    const app = campioni(PROTO, { corsa: 35 });
    expect(confrontaPartenza({ elemento: ELEMENTO, proto, app }).map((d) => d.proprieta)).toEqual(["da.geometria.y"]);
    expect(confrontaPartenza({ elemento: { ...ELEMENTO, corsa: true }, proto, app })).toEqual([]);
  });
});

describe("le corse", () => {
  const corsa = (c: Partial<Corsa>): Corsa => ({ proprieta: ["transform"], ritardo: 0, durata: 240, iterazioni: 1, curva: "ease", ...c });

  it("durata e curva diverse con i campioni dentro sono note, non differenze", () => {
    const esito = confrontaCorse({
      elemento: ELEMENTO,
      proto: [corsa({})],
      app: [corsa({ durata: 250, curva: "ease-out" })],
      campioniRossi: new Set(),
    });
    expect(esito.differenze).toEqual([]);
    expect(esito.note).toHaveLength(2);
  });

  it("con i campioni fuori soglia dicono il perché", () => {
    const esito = confrontaCorse({
      elemento: ELEMENTO,
      proto: [corsa({})],
      app: [corsa({ durata: 140 })],
      campioniRossi: new Set(["geometria"]),
    });
    expect(esito.differenze.map((d) => d.proprieta)).toEqual(["durata.geometria"]);
  });

  it("il ritardo, lo scaglionamento, resta stretto anche coi campioni dentro", () => {
    const esito = confrontaCorse({ elemento: ELEMENTO, proto: [corsa({ ritardo: 50 })], app: [corsa({ ritardo: 30 })], campioniRossi: new Set() });
    expect(esito.differenze.map((d) => d.proprieta)).toEqual(["ritardo.geometria"]);
  });

  it("una molla non ha durata né curva da confrontare", () => {
    const esito = confrontaCorse({ elemento: ELEMENTO, proto: [corsa({})], app: [corsa({ durata: 500, curva: "linear(0, 0.6, 1)" })] });
    expect(esito.differenze).toEqual([]);
  });

  it("una corsa da un lato solo è una nota: può muoverla un antenato", () => {
    const esito = confrontaCorse({ elemento: ELEMENTO, proto: [corsa({})], app: [] });
    expect(esito.differenze).toEqual([]);
    expect(esito.note[0]).toMatch(/solo nel prototipo/);
  });

  it("col moto ridotto una corsa rimasta da un lato solo è rossa", () => {
    expect(confrontaRidotto({ elemento: ELEMENTO, proto: [corsa({ durata: 0 })], app: [] })).toEqual([]);
    expect(confrontaRidotto({ elemento: ELEMENTO, proto: [], app: [corsa({})] })).toHaveLength(1);
  });
});

describe("la forma delle voci", () => {
  const voce = (elemento: Partial<Elemento>): Voce => ({
    id: "prova.voce",
    prototipo: { gesto: () => {} },
    app: { scena: "s", gesto: () => {} },
    elementi: [{ ...ELEMENTO, ...elemento }],
  });

  it("un selettore per testo vale per la geometria, con css e testo", () => {
    expect(validaVoci([voce({ app: { css: ".riga", testo: "Prenotare" } })], {})).toEqual([]);
    expect(validaVoci([voce({ app: { css: ".riga", testo: "Prenotare" }, proprieta: ["opacity"] })], {})).toHaveLength(1);
    expect(validaVoci([voce({ app: { css: ".riga", testo: "" } })], {})).toHaveLength(1);
    expect(scriviSelettore({ css: ".riga", testo: "Prenotare" })).toBe(".riga «Prenotare»");
  });

  it("una proprietà che non si campiona è un errore", () => {
    expect(validaVoci([voce({ proprieta: ["width"] })], {})).toHaveLength(1);
  });

  it("una copertura nomina un elemento vero, un aspetto noto e un perché", () => {
    const voci = [voce({})];
    expect(copertureAnimazioni([{ id: "prova.voce.voce", proprieta: ["durata.geometria"], perche: "x" }], voci).errori).toEqual([]);
    expect(copertureAnimazioni([{ id: "prova.voce.altro", proprieta: ["durata.geometria"], perche: "x" }], voci).errori).toHaveLength(1);
    expect(copertureAnimazioni([{ id: "prova.voce.voce", proprieta: ["durata.opacity"], perche: "x" }], voci).errori).toHaveLength(1);
    expect(copertureAnimazioni([{ id: "prova.voce.voce", proprieta: ["durata.geometria"], perche: " " }], voci).errori).toHaveLength(1);
  });
});

describe("le animazioni dell'editor", () => {
  it("le voci hanno la forma giusta e le coperture nominano differenze possibili", () => {
    expect(validaVoci(ANIMAZIONI, STATI)).toEqual([]);
    expect(copertureAnimazioni(DA_COPRIRE_ANIMAZIONI, ANIMAZIONI).errori).toEqual([]);
    expect(Array.isArray(eccezioni)).toBe(true);
  });

  it("i valori estratti sono delle voci di adesso (sennò: `--estrai editor`)", () => {
    expect(Object.keys(estratti.voci).sort()).toEqual(ANIMAZIONI.map((v) => v.id).sort());
    for (const v of ANIMAZIONI) {
      const misure = (estratti.voci as Record<string, Record<string, { pieno: { elementi: unknown } }>>)[v.id];
      for (const stato of Object.values(misure)) {
        expect(Object.keys(stato.pieno.elementi as object).sort()).toEqual(v.elementi.map((e) => e.id).sort());
      }
    }
  });
});
