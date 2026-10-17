import { describe, expect, it } from "vitest";
import { INK_MAX_SAMPLES, quantizeInk } from "../sample";
import { pointerSample, type PointerSample } from "./pointer";
import { Session, type Effect, type FinishedStroke } from "./session";

// Il nucleo senza il browser: la `Session` si guida con campioni costruiti a
// mano, come farebbe un altro toolkit. Gli scenari che Rust e TypeScript devono
// dare uguali stanno in `../mirror.test.ts`; qui le proprietà che valgono per
// la copia TypeScript da sola e i numeri grandi.

function mouse(pointerId: number, x: number, y: number, timeStamp: number): PointerSample {
  return pointerSample({ pointerId, pointerType: "mouse", x, y, timeStamp });
}

function pen(pointerId: number, x: number, y: number, timeStamp: number, pressure: number): PointerSample {
  return pointerSample({ pointerId, pointerType: "pen", x, y, timeStamp, pressure });
}

const ends = (effects: readonly Effect[]): FinishedStroke[] =>
  effects.flatMap((effect) => (effect.fx === "end" ? [effect] : []));

describe("la sessione dell'inchiostro, da sola", () => {
  it("lo stesso scenario dà gli stessi effetti, sempre", () => {
    const play = (): Effect[] => {
      const session = new Session({ stabilizer: { amount: 0.4, pulledString: false, catchUp: true, catchUpOnEnd: true } });
      return [
        ...session.pointerDown(pen(7, 0, 0, 0, 0.4)),
        ...session.pointerMove([pen(7, 1, 0, 4, 0.5)], pen(7, 2, 1, 8, 0.6), [pen(7, 3, 1, 12, 0.6)]),
        ...session.pointerMove([], pen(7, 5, 3, 16, 0.7), []),
        ...session.pointerUp(pen(7, 5, 3, 20, 0)),
      ];
    };
    expect(play()).toEqual(play());
  });

  it("un tratto di decine di migliaia di campioni si divide senza perdere niente", () => {
    const events = 25_000;
    const session = new Session();
    const effects: Effect[] = [...session.pointerDown(mouse(1, 0, 0, 0))];
    for (let i = 1; i <= events; i++) effects.push(...session.pointerMove([], mouse(1, i, i % 7, i), []));
    effects.push(...session.pointerUp(mouse(1, events + 1, 0, events + 1)));
    const pieces = ends(effects);
    expect(pieces.length).toBe(3);
    for (const piece of pieces) {
      expect(piece.samples.length).toBeLessThanOrEqual(INK_MAX_SAMPLES);
      expect(piece.samples[0]!.t).toBe(0);
      // Ogni pezzo è un tratto che il formato scrive.
      expect(() => quantizeInk(piece.samples)).not.toThrow();
    }
    expect(pieces.map((piece) => piece.split)).toEqual([true, true, false]);
    expect(pieces.map((piece) => piece.continued)).toEqual([false, true, true]);
    // La giunzione è condivisa: ogni pezzo riparte dall'ultimo punto del
    // precedente, e nessun campione si perde (il primo, 25 000 spostamenti,
    // l'alzata).
    for (let i = 1; i < pieces.length; i++) {
      const previous = pieces[i - 1]!.samples;
      expect(pieces[i]!.samples[0]).toMatchObject({ x: previous[previous.length - 1]!.x, y: previous[previous.length - 1]!.y });
    }
    const total = pieces.reduce((sum, piece) => sum + piece.samples.length, 0) - (pieces.length - 1);
    expect(total).toBe(events + 2);
  });

  it("un tratto brevissimo ha due campioni: un punto tondo, non un trattino", () => {
    const session = new Session();
    session.pointerDown(mouse(1, 5, 5, 0));
    const [done] = ends(session.pointerUp(mouse(1, 5, 5, 1)));
    expect(done!.samples).toEqual([{ x: 5, y: 5, t: 0 }, { x: 5, y: 5, t: 1 }]);
    const withPen = new Session();
    withPen.pointerDown(pen(7, 5, 5, 0, 0.5));
    const [penDone] = ends(withPen.pointerUp(pen(7, 5, 5, 1, 0)));
    expect(penDone!.samples).toEqual([{ x: 5, y: 5, p: 0.5, t: 0 }, { x: 5, y: 5, p: 0.5, t: 1 }]);
  });

  it("la curva della pressione dà la pressione scritta, e si cambia mentre la sessione vive", () => {
    const session = new Session({ curve: (pressure) => pressure * pressure });
    const first = session.pointerDown(pen(7, 0, 0, 0, 0.5));
    expect(first.find((effect) => effect.fx === "samples")).toMatchObject({ samples: [{ p: 0.25 }] });
    session.setCurve(null);
    const second = session.pointerMove([], pen(7, 1, 0, 8, 0.5), []);
    expect(second.find((effect) => effect.fx === "samples")).toMatchObject({ samples: [{ p: 0.5 }] });
    // Una curva che dà un numero fuori da 0…1 si porta al bordo, uno che non è
    // un numero lascia la pressione com'è.
    session.setCurve(() => 3);
    expect(session.pointerMove([], pen(7, 2, 0, 16, 0.5), []).find((e) => e.fx === "samples")).toMatchObject({ samples: [{ p: 1 }] });
    session.setCurve(() => Number.NaN);
    expect(session.pointerMove([], pen(7, 3, 0, 24, 0.5), []).find((e) => e.fx === "samples")).toMatchObject({ samples: [{ p: 0.5 }] });
  });

  it("dopo destroy la sessione non fa più niente, e destroy si può ripetere", () => {
    const session = new Session();
    session.pointerDown(mouse(1, 0, 0, 0));
    const first = session.destroy();
    expect(first.map((effect) => effect.fx)).toEqual(["release", "cancel"]);
    expect(first[1]).toEqual({ fx: "cancel", id: 1, reason: "destroy" });
    expect(session.destroy()).toEqual([]);
    expect(session.pointerDown(mouse(1, 0, 0, 5))).toEqual([]);
    expect(session.pointerMove([], mouse(1, 1, 0, 6), [])).toEqual([]);
    expect(session.pointerUp(mouse(1, 1, 0, 7))).toEqual([]);
    expect(session.cancel()).toEqual([]);
    expect(session.drawing).toBe(false);
  });

  it("il limite dei campioni ha un intervallo", () => {
    for (const bad of [0, 1, 2.5, Number.NaN, INK_MAX_SAMPLES + 1]) {
      expect(() => new Session({ maxSamples: bad })).toThrow(RangeError);
    }
    for (const good of [2, 3, INK_MAX_SAMPLES]) {
      expect(() => new Session({ maxSamples: good })).not.toThrow();
    }
  });

  it("dice di chi è il tratto in corso, annunciato o no", () => {
    const session = new Session();
    expect(session.tracks(1)).toBe(false);
    session.pointerDown(mouse(1, 0, 0, 0));
    expect(session.tracks(1)).toBe(true);
    expect(session.tracks(2)).toBe(false);
    session.pointerUp(mouse(1, 0, 0, 1));
    expect(session.tracks(1)).toBe(false);
    // Una penna che si appoggia senza premere ha il tratto, non ancora annunciato.
    const hover = new Session();
    hover.pointerDown(pen(7, 0, 0, 0, 0));
    expect(hover.tracks(7)).toBe(true);
    expect(hover.drawing).toBe(false);
  });

  it("un tratto annullato non lascia niente da scrivere e il puntatore non disegna finché non si alza", () => {
    const session = new Session();
    session.pointerDown(mouse(1, 0, 0, 0));
    const cancelled = session.pointerCancel(1);
    expect(cancelled.map((effect) => effect.fx)).toEqual(["release", "cancel"]);
    expect(session.drawing).toBe(false);
    expect(session.pointerMove([], mouse(1, 4, 0, 8), [])).toEqual([]);
    expect(session.pointerUp(mouse(1, 4, 0, 9))).toEqual([]);
  });
});
