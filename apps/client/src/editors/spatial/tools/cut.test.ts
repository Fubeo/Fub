// Le Forbici, il Coltello e «Unisci» sui nodi: dove si taglia, che cosa
// resta, e come si uniscono i capi.

import { describe, expect, it } from "vitest";
import { parsePath } from "../scene/geometry";
import type { Matrix } from "../scene/matrix";
import { pathData } from "../scene/serialize";
import { crossings, cutAt, followEnds, joinAcross, joinEnds, joinPaths, mapSubs, nodeSpot, tipKeys, tipsAfter } from "./cut";
import { breakNodes, deleteNodes, insertNode, joinNodes, readNodes, writeNodes, type Subpath } from "./nodes";

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

describe("dove stanno le punte quando si unisce", () => {
  /// Il capo che è diventato l'inizio e quello che è diventato la fine.
  const ends = (d: string, merge = 0.5): [string, string] | null => {
    const joined = joinPaths(subsOf(d), merge)!;
    return joined.start === null || joined.end === null ? null : [`${joined.start.piece}:${joined.start.end}`, `${joined.end.piece}:${joined.end.end}`];
  };

  it("due pezzi uno dopo l'altro tengono l'inizio del primo e la fine del secondo", () => {
    expect(ends("M0 0 L10 0 M10 0 L20 0")).toEqual(["0:start", "1:end"]);
    // Nell'ordine in cui sono dati, non in quello del documento: il secondo
    // è quello che continua il primo.
    expect(ends("M10 0 L20 0 M0 0 L10 0")).toEqual(["1:start", "0:end"]);
  });

  it("un pezzo percorso al contrario porta il suo capo opposto", () => {
    // Fine con fine: il secondo si percorre al contrario, e la sua fine è l'inizio.
    expect(ends("M0 0 L10 0 M20 0 L10 0")).toEqual(["0:start", "1:start"]);
    // Inizio con inizio: il primo si percorre al contrario.
    expect(ends("M10 0 L0 0 M10 0 L20 0")).toEqual(["0:end", "1:end"]);
    // Il secondo finisce dove il primo comincia: viene prima, e nessuno si
    // percorre al contrario.
    expect(ends("M10 0 L0 0 M20 0 L10 0")).toEqual(["1:start", "0:end"]);
  });

  it("uniti da una linea, i capi liberi restano quelli di prima", () => {
    expect(ends("M0 0 L10 0 M30 0 L40 0")).toEqual(["0:start", "1:end"]);
    expect(ends("M0 0 L10 0 M40 0 L30 0")).toEqual(["0:start", "1:start"]);
  });

  it("tre pezzi in fila: i capi liberi sono il primo e l'ultimo della catena", () => {
    expect(ends("M0 0 L10 0 M30 0 L40 0 M10.2 0 L29.9 0")).toEqual(["0:start", "1:end"]);
    // Il pezzo in mezzo è rovesciato, e i capi liberi sono quelli dei due esterni.
    expect(ends("M0 0 L10 0 M30 0 L40 0 M29.9 0 L10.2 0")).toEqual(["0:start", "1:end"]);
    // La catena comincia dove comincia il primo pezzo e finisce dove finisce il
    // secondo, quello in mezzo (il terzo) li lega senza che i suoi capi restino.
    expect(ends("M40 0 L30 0 M10 0 L0 0 M10.1 0 L29.9 0")).toEqual(["0:start", "1:end"]);
  });

  it("un tracciato che si chiude non ha né inizio né fine", () => {
    const closed = joinPaths(subsOf("M0 0 L50 0 L50 50"), 0.5)!;
    expect([closed.start, closed.end]).toEqual([null, null]);
    const circle = joinPaths(subsOf("M0 0 A50 50 0 0 1 100 0 M100 0 A50 50 0 0 1 0 0"), 0.5)!;
    expect(circle.closed).toBe(true);
    expect([circle.start, circle.end]).toEqual([null, null]);
  });
});

describe("dove stanno le punte dopo una modifica dei nodi", () => {
  const open = subsOf("M0 0 L10 0 L20 0 L30 0");

  it("il primo e l'ultimo vertice, chiuso o aperto", () => {
    expect(tipKeys(open)).toEqual({ start: "0:0", end: "0:3" });
    expect(tipKeys(subsOf("M0 0 L10 0 M20 0 L30 0 L40 0"))).toEqual({ start: "0:0", end: "1:2" });
    // L'ultimo vertice di un chiuso è il suo primo.
    expect(tipKeys(subsOf("M0 0 L10 0 L10 10 Z"))).toEqual({ start: "0:0", end: "0:0" });
    expect(tipKeys([])).toBeNull();
  });

  it("inserire, spostare, togliere o spezzare nodi lascia le punte dov'erano", () => {
    expect(tipsAfter(open, insertNode(open, 0, 1, 0.5).subs, insertNode(open, 0, 1, 0.5).moved)).toBeUndefined();
    expect(tipsAfter(open, open, null)).toBeUndefined();
    // Si toglie il primo nodo: il vertice che prende il suo posto tiene la punta.
    const noFirst = deleteNodes(open, new Set(["0:0"]));
    expect(tipsAfter(open, noFirst.subs, noFirst.moved)).toBeUndefined();
    const noLast = deleteNodes(open, new Set(["0:3"]));
    expect(tipsAfter(open, noLast.subs, noLast.moved)).toBeUndefined();
    // Si spezza in mezzo: due sottotracciati, e la punta d'inizio sta sul primo, quella di fine sull'ultimo.
    const broken = breakNodes(open, new Set(["0:1"]));
    expect(broken.subs).toHaveLength(2);
    expect(tipsAfter(open, broken.subs, broken.moved)).toBeUndefined();
  });

  it("chiudere l'ultimo sottotracciato aperto toglie le punte", () => {
    const closed = joinNodes(open, new Set(["0:0", "0:3"]))!;
    expect(closed.subs[0]!.closed).toBe(true);
    expect(tipsAfter(open, closed.subs, closed.moved)).toEqual({ start: null, end: null });
    // Con un altro aperto, no.
    const two = subsOf("M0 0 L10 0 L20 0 M50 0 L60 0");
    const first = joinNodes(two, new Set(["0:0", "0:2"]))!;
    expect(tipsAfter(two, first.subs, first.moved)).toBeUndefined();
    // Un tracciato che era già chiuso resta com'è.
    const ring = subsOf("M0 0 L10 0 L10 10 Z");
    expect(tipsAfter(ring, ring, new Map([["0:0", "0:0"], ["0:1", "0:1"], ["0:2", "0:2"]]))).toBeUndefined();
  });

  it("aprire un sottotracciato chiuso toglie le sue punte, da qualunque nodo si apra", () => {
    const square = subsOf("M0 0 L10 0 L10 10 L0 10 Z");
    for (const key of ["0:0", "0:1", "0:3"]) {
      const broken = breakNodes(square, new Set([key]));
      expect(broken.subs[0]!.closed).toBe(false);
      expect(tipsAfter(square, broken.subs, broken.moved)).toEqual({ start: null, end: null });
    }
    // Il chiuso in testa perde la punta d'inizio; la fine, su un aperto, resta.
    const mixed = subsOf("M0 0 L10 0 L10 10 Z M50 0 L60 0");
    const head = breakNodes(mixed, new Set(["0:1"]));
    expect(tipsAfter(mixed, head.subs, head.moved)).toEqual({ start: null, end: "end" });
  });

  it("un capo che si unisce a un altro non è più un capo, e la sua punta se ne va", () => {
    // Due pezzi: A..B e C..D. B con C: l'inizio e la fine restano.
    const two = subsOf("M0 0 L10 0 M20 0 L30 0");
    const middle = joinNodes(two, new Set(["0:1", "1:0"]))!;
    expect(tipsAfter(two, middle.subs, middle.moved)).toBeUndefined();
    // A con C: il primo pezzo si rovescia, e l'inizio di prima (A) è dentro.
    const inner = joinNodes(two, new Set(["0:0", "1:0"]))!;
    expect(each(inner.subs)).toEqual(["M10 0 L0 0 L20 0 L30 0"]);
    expect(tipsAfter(two, inner.subs, inner.moved)).toEqual({ start: null, end: "end" });
    // A con D: il secondo si rovescia.
    const other = joinNodes(two, new Set(["0:0", "1:1"]))!;
    expect(each(other.subs)).toEqual(["M10 0 L0 0 L30 0 L20 0"]);
    expect(tipsAfter(two, other.subs, other.moved)).toEqual({ start: null, end: null });
    // B con D: nessun rovescio nel primo, il secondo è rovesciato; la fine di
    // prima (D) è dentro e la fine nuova è C.
    const last = joinNodes(two, new Set(["0:1", "1:1"]))!;
    expect(each(last.subs)).toEqual(["M0 0 L10 0 L30 0 L20 0"]);
    expect(tipsAfter(two, last.subs, last.moved)).toEqual({ start: "start", end: null });
  });

  it("le punte di un tracciato che si riscrive seguono i nodi di cui sono", () => {
    const spots = [{ owner: 0, end: "start", key: "0:0" }, { owner: 0, end: "end", key: "0:3" }] as const;
    const reversed = new Map([["0:0", "0:3"], ["0:1", "0:2"], ["0:2", "0:1"], ["0:3", "0:0"]]);
    expect(followEnds(spots, open, reversed)).toEqual({ start: { owner: 0, end: "end" }, end: { owner: 0, end: "start" } });
    expect(followEnds(spots, open, null)).toEqual({ start: { owner: 0, end: "start" }, end: { owner: 0, end: "end" } });
    expect(followEnds(spots, [], null)).toEqual({ start: null, end: null });
  });

  it("l'unione di capi di due tracciati: le punte del primo prendono i capi del primo o del secondo", () => {
    const m: Matrix = [1, 0, 0, 1, 0, 0];
    // A..B con C..D, B con C: l'inizio è quello del primo, la fine quella del secondo.
    const across = joinAcross(subsOf("M0 0 L10 0"), "0:1", subsOf("M10 0 L20 0"), "0:0", m, 0.5)!;
    expect(each(across.kept.subs)).toEqual(["M0 0 L10 0 L20 0"]);
    expect(across.tips.kept).toEqual({ start: { owner: 0, end: "start" }, end: { owner: 1, end: "end" } });
    // Il secondo non ha più il sottotracciato, e con lui le sue punte.
    expect(across.tips.rest).toEqual({ start: null, end: null });
    // A con C: il primo si rovescia, e l'inizio nuovo è la fine del primo.
    const flipped = joinAcross(subsOf("M0 0 L10 0"), "0:0", subsOf("M0 0 L10 0"), "0:0", m, 0.5)!;
    expect(each(flipped.kept.subs)).toEqual(["M10 0 L0 0 L10 0"]);
    expect(flipped.tips.kept).toEqual({ start: { owner: 0, end: "end" }, end: { owner: 1, end: "end" } });
    // Fine con fine: la fine nuova è l'inizio del secondo.
    const ends = joinAcross(subsOf("M0 0 L10 0"), "0:1", subsOf("M20 0 L10 0"), "0:1", m, 0.5)!;
    expect(ends.tips.kept).toEqual({ start: { owner: 0, end: "start" }, end: { owner: 1, end: "start" } });
  });

  it("del secondo restano le punte dei capi che non sono passati nel primo", () => {
    const m: Matrix = [1, 0, 0, 1, 0, 0];
    const first = subsOf("M0 0 L10 0");
    // Il secondo ha tre sottotracciati: quello unito è in mezzo, e i suoi capi non hanno punte.
    const middle = joinAcross(first, "0:1", subsOf("M50 0 L60 0 M10 0 L20 0 M70 0 L80 0"), "1:0", m, 0.5)!;
    expect(middle.tips.kept).toEqual({ start: { owner: 0, end: "start" }, end: null });
    expect(middle.tips.rest).toEqual({ start: "start", end: "end" });
    // Se è il primo, il secondo perde la punta d'inizio; se è l'ultimo, quella di fine.
    const head = joinAcross(first, "0:1", subsOf("M10 0 L20 0 M70 0 L80 0"), "0:0", m, 0.5)!;
    expect(head.tips.kept).toEqual({ start: { owner: 0, end: "start" }, end: null });
    expect(head.tips.rest).toEqual({ start: null, end: "end" });
    const tail = joinAcross(first, "0:1", subsOf("M70 0 L80 0 M10 0 L20 0"), "1:0", m, 0.5)!;
    expect(tail.tips.kept).toEqual({ start: { owner: 0, end: "start" }, end: { owner: 1, end: "end" } });
    expect(tail.tips.rest).toEqual({ start: "start", end: null });
  });
});
