// Le Forbici, il Coltello e «Unisci» sui nodi: dove si taglia, che cosa
// resta, e come si uniscono i capi.

import { describe, expect, it } from "vitest";
import { parsePath } from "../scene/geometry";
import type { Matrix } from "../scene/matrix";
import { pathData } from "../scene/serialize";
import { crossings, cutAt, joinAcross, joinEnds, joinPaths, mapSubs, nodeSpot } from "./cut";
import { readNodes, writeNodes, type Subpath } from "./nodes";

const subsOf = (d: string): Subpath[] => readNodes(parsePath(d)!);
const each = (subs: readonly Subpath[]): string[] => subs.map((sub) => pathData(writeNodes([sub])));

describe("le Forbici", () => {
  it("tagliano una linea in due", () => {
    const cut = cutAt(subsOf("M0 0 L100 0"), [{ sub: 0, link: 0, t: 0.25 }])!;
    expect(each(cut.subs)).toEqual(["M0 0 L25 0", "M25 0 L100 0"]);
    expect(cut.origin).toEqual([0, 0]);
    expect(cut.ends).toEqual(["0:1", "1:0"]);
    expect(cut.count).toBe(1);
  });

  it("aprono un rettangolo nel punto tagliato, che diventa i due capi", () => {
    const cut = cutAt(subsOf("M0 0 L100 0 L100 50 L0 50 Z"), [{ sub: 0, link: 1, t: 0.5 }])!;
    expect(each(cut.subs)).toEqual(["M100 25 L100 50 L0 50 L0 0 L100 0 L100 25"]);
    expect(cut.ends).toEqual(["0:0", "0:5"]);
  });

  it("tagliano in un nodo, anche dato come nodo", () => {
    const rect = subsOf("M0 0 L100 0 L100 50 L0 50 Z");
    expect(each(cutAt(rect, [nodeSpot(rect, 0, 2)])!.subs)).toEqual(["M100 50 L0 50 L0 0 L100 0 L100 50"]);
    const open = subsOf("M0 0 L50 0 L50 50");
    expect(each(cutAt(open, [nodeSpot(open, 0, 1)])!.subs)).toEqual(["M0 0 L50 0", "M50 0 L50 50"]);
    // Un punto a meno di un centesimo e mezzo dal nodo è il nodo.
    expect(each(cutAt(open, [{ sub: 0, link: 0, t: 0.9999 }])!.subs)).toEqual(["M0 0 L50 0", "M50 0 L50 50"]);
  });

  it("i capi di un tracciato aperto non hanno niente da tagliare", () => {
    const open = subsOf("M0 0 L50 0 L50 50");
    expect(cutAt(open, [nodeSpot(open, 0, 0)])).toBeNull();
    expect(cutAt(open, [nodeSpot(open, 0, 2)])).toBeNull();
    expect(cutAt(open, [])).toBeNull();
  });

  it("dividono le curve esatte: ciò che si vede non cambia", () => {
    const cut = cutAt(subsOf("M0 0 C0 50 100 50 100 0"), [{ sub: 0, link: 0, t: 0.5 }])!;
    expect(each(cut.subs)).toEqual(["M0 0 C0 25 25 37.5 50 37.5", "M50 37.5 C75 37.5 100 25 100 0"]);
    const arc = cutAt(subsOf("M0 0 A50 50 0 0 1 100 0"), [{ sub: 0, link: 0, t: 0.5 }])!;
    expect(each(arc.subs)).toEqual(["M0 0 A50 50 0 0 1 50 -50", "M50 -50 A50 50 0 0 1 100 0"]);
  });

  it("più tagli nello stesso segmento, e due troppo vicini sono uno", () => {
    const line = subsOf("M0 0 L100 0");
    expect(each(cutAt(line, [{ sub: 0, link: 0, t: 0.75 }, { sub: 0, link: 0, t: 0.25 }])!.subs)).toEqual(["M0 0 L25 0", "M25 0 L75 0", "M75 0 L100 0"]);
    const close = cutAt(line, [{ sub: 0, link: 0, t: 0.5 }, { sub: 0, link: 0, t: 0.50005 }])!;
    expect(close.count).toBe(1);
    expect(each(close.subs)).toEqual(["M0 0 L50 0", "M50 0 L100 0"]);
  });

  it("un rettangolo tagliato due volte fa due pezzi aperti", () => {
    const cut = cutAt(subsOf("M0 0 L100 0 L100 50 L0 50 Z"), [{ sub: 0, link: 0, t: 0.5 }, { sub: 0, link: 2, t: 0.5 }])!;
    expect(each(cut.subs)).toEqual(["M50 0 L100 0 L100 50 L50 50", "M50 50 L0 50 L0 0 L50 0"]);
    expect(cut.ends).toEqual(["0:0", "0:3", "1:0", "1:3"]);
  });

  it("gli altri sottotracciati restano, e si sa da quale viene ogni pezzo", () => {
    const cut = cutAt(subsOf("M0 0 L10 0 M0 10 L10 10"), [{ sub: 1, link: 0, t: 0.5 }])!;
    expect(each(cut.subs)).toEqual(["M0 0 L10 0", "M0 10 L5 10", "M5 10 L10 10"]);
    expect(cut.origin).toEqual([0, 1, 1]);
    expect(cut.ends).toEqual(["1:1", "2:0"]);
  });
});

describe("dove il Coltello attraversa", () => {
  it("una linea, una curva, un rettangolo", () => {
    expect(crossings(subsOf("M0 0 L100 0"), subsOf("M50 -10 L50 10"))).toEqual([{ sub: 0, link: 0, t: 0.5 }]);
    const [spot] = crossings(subsOf("M0 0 C0 50 100 50 100 0"), subsOf("M50 -10 L50 60"));
    expect(spot!.link).toBe(0);
    expect(spot!.t).toBeCloseTo(0.5, 4);
    expect(crossings(subsOf("M0 0 L100 0 L100 50 L0 50 Z"), subsOf("M-10 20 L110 30")).map(({ link, t }) => [link, Number(t.toFixed(4))]))
      .toEqual([[1, 0.5833], [3, 0.5833]]);
  });

  it("un tratto che corre accanto senza attraversare non taglia", () => {
    expect(crossings(subsOf("M0 0 L100 0"), subsOf("M0 1 L100 1"))).toEqual([]);
    expect(crossings(subsOf("M0 0 L100 0"), subsOf("M120 -10 L120 10"))).toEqual([]);
  });

  it("un tratto a zig-zag taglia ogni volta che passa", () => {
    const spots = crossings(subsOf("M0 0 L100 0"), subsOf("M10 -10 L20 10 L30 -10 L40 10"));
    expect(spots.map(({ t }) => Number(t.toFixed(4)))).toEqual([0.15, 0.25, 0.35]);
  });
});

describe("Unisci", () => {
  it("due linee che si toccano diventano un tracciato col nodo comune", () => {
    expect(each([joinPaths(subsOf("M0 0 L50 0 M50 0 L50 50"), 0.5)!.sub])).toEqual(["M0 0 L50 0 L50 50"]);
  });

  it("i capi più vicini, in qualunque verso", () => {
    const joined = joinPaths(subsOf("M50 50 L50 0 M0 0 L49 0"), 0.5)!;
    expect(each([joined.sub])).toEqual(["M50 50 L50 0 L49 0 L0 0"]);
    expect(joined.lines).toBe(1);
    expect(joined.closed).toBe(false);
  });

  it("due capi entro la distanza si incontrano a metà strada", () => {
    expect(each([joinPaths(subsOf("M0 0 L49.5 0 M50 0.5 L50 50"), 1)!.sub])).toEqual(["M0 0 L49.75 0.25 L50 50"]);
  });

  it("due metà di un cerchio tornano un cerchio chiuso", () => {
    const joined = joinPaths(subsOf("M0 0 A50 50 0 0 1 100 0 M100 0 A50 50 0 0 1 0 0"), 0.5)!;
    expect(joined.closed).toBe(true);
    expect(each([joined.sub])).toEqual(["M0 0 A50 50 0 0 1 100 0 A50 50 0 0 1 0 0 Z"]);
  });

  it("tre pezzi in fila, nell'ordine dei capi più vicini", () => {
    const joined = joinPaths(subsOf("M0 0 L10 0 M30 0 L40 0 M10.2 0 L29.9 0"), 0.5)!;
    expect(each([joined.sub])).toEqual(["M0 0 L10.1 0 L29.95 0 L40 0"]);
    expect(joined.lines).toBe(0);
  });

  it("un tracciato solo si chiude, con una linea se i capi sono lontani", () => {
    const joined = joinPaths(subsOf("M0 0 L50 0 L50 50"), 0.5)!;
    expect(joined.closed).toBe(true);
    expect(joined.lines).toBe(1);
    expect(each([joined.sub])).toEqual(["M0 0 L50 0 L50 50 Z"]);
    // Una linea sola non ha niente da chiudere; un pezzo chiuso non si unisce.
    expect(joinPaths(subsOf("M0 0 L50 0"), 0.5)).toBeNull();
    expect(joinPaths(subsOf("M0 0 L50 0 L50 50 Z M60 0 L70 0"), 0.5)).toBeNull();
  });

  it("due capi scelti si uniscono: vicini in un nodo, lontani con una linea", () => {
    const two = subsOf("M0 0 L50 0 M50 0.5 L50 50");
    expect(each(joinEnds(two, "0:1", "1:0", 1)!.subs)).toEqual(["M0 0 L50 0.25 L50 50"]);
    expect(each(joinEnds(two, "0:1", "1:0", 0.1)!.subs)).toEqual(["M0 0 L50 0 L50 0.5 L50 50"]);
    // I due capi di un tracciato lo chiudono; quelli di una linea sola no,
    // anche vicini, che non si perda.
    expect(each(joinEnds(subsOf("M0 0 L50 0 L50 50"), "0:0", "0:2", 0.5)!.subs)).toEqual(["M0 0 L50 0 L50 50 Z"]);
    expect(joinEnds(two, "0:1", "0:1", 1)).toBeNull();
    expect(joinEnds(two, "0:1", "2:0", 1)).toBeNull();
  });

  it("un capo di un altro tracciato porta il suo sottotracciato nel primo", () => {
    const m: Matrix = [1, 0, 0, 1, 50, 0];
    const joined = joinAcross(subsOf("M0 0 L50 0"), "0:1", subsOf("M0 0 L0 50 M100 100 L120 100"), "0:0", m, 0.5)!;
    expect(each(joined.kept.subs)).toEqual(["M0 0 L50 0 L50 50"]);
    // Nel secondo resta l'altro sottotracciato, coi nodi rinumerati.
    expect(each(joined.rest.subs)).toEqual(["M100 100 L120 100"]);
    expect([...joined.rest.moved]).toEqual([["1:0", "0:0"], ["1:1", "0:1"]]);
    expect(joinAcross(subsOf("M0 0 L50 0"), "0:1", subsOf("M0 0 L0 50"), "3:0", m, 0.5)).toBeNull();
  });

  it("i pezzi vengono da altre coordinate", () => {
    const m: Matrix = [2, 0, 0, 2, 10, 0];
    expect(each(mapSubs(subsOf("M0 0 L10 0 A5 5 0 0 1 20 0"), m))).toEqual(["M10 0 L30 0 A10 10 0 0 1 50 0"]);
  });
});
