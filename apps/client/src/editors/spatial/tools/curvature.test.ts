// La Curvatura: i punti che si posano, le maniglie che ne vengono, e i
// tracciati che ci sono già ricalcolati attorno a un nodo.

import { describe, expect, it } from "vitest";
import { pointAt } from "../scene/curves";
import type { Matrix, Point } from "../scene/matrix";
import { pathData } from "../scene/serialize";
import { penKind, penPath } from "./bezier";
import { curved, freeHandle, recurve, smoothHandles, type DraftNode } from "./curvature";
import { curveAt, kindOf, nodeKey, readNodes, writeNodes, type KindOf, type Subpath } from "./nodes";
import { parsePath } from "../scene/geometry";

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const smooth = (x: number, y: number): DraftNode => ({ at: [x, y], in: null, out: null, curve: "smooth" });
const corner = (x: number, y: number): DraftNode => ({ at: [x, y], in: null, out: null, curve: "corner" });
const write = (nodes: readonly DraftNode[], closed: boolean): string => pathData(writeNodes([penPath(curved(nodes, closed), closed, IDENTITY)]));
const subsOf = (d: string): Subpath[] => readNodes(parsePath(d)!);
const written = (subs: readonly Subpath[]): string => pathData(writeNodes(subs));
const inferred = (subs: readonly Subpath[]): KindOf => (s, at) => {
  const sub = subs[s]!;
  return !sub.closed && (at === 0 || at === sub.nodes.length - 1) ? "corner" : kindOf(sub, at);
};

/// La distanza più grande dal centro `center`, e la più piccola, lungo i
/// segmenti di `sub`.
function radii(sub: Subpath, center: Point): { readonly min: number; readonly max: number } {
  let min = Infinity;
  let max = 0;
  sub.links.forEach((_, i) => {
    const { from, curve } = curveAt(sub, i);
    for (let k = 0; k <= 64; k++) {
      const [x, y] = pointAt(from, curve, k / 64);
      const r = Math.hypot(x - center[0], y - center[1]);
      min = Math.min(min, r);
      max = Math.max(max, r);
    }
  });
  return { min, max };
}

describe("le maniglie di un punto liscio", () => {
  it("su una retta, a passi uguali, stanno a un terzo delle corde", () => {
    expect(smoothHandles([0, 0], [30, 0], [60, 0])).toEqual({ in: [20, 0], out: [40, 0] });
  });

  it("girano con la tangente e si allungano quanto gira il tracciato", () => {
    // Un quarto di giro: la tangente orizzontale, le maniglie quelle del
    // cerchio per (0, 0), (50, 50) e (100, 0), di raggio 50.
    const { in: before, out: after } = smoothHandles([0, 0], [50, 50], [100, 0])!;
    const kappa = (4 / 3) * Math.tan(Math.PI / 8) * 50;
    expect(before[0]).toBeCloseTo(50 - kappa, 9);
    expect(before[1]).toBeCloseTo(50, 9);
    expect(after[0]).toBeCloseTo(50 + kappa, 9);
    expect(after[1]).toBeCloseTo(50, 9);
  });

  it("con i vicini a distanze molto diverse non vanno oltre metà della corda", () => {
    for (const [before, after] of [
      [[-1, 0], [0, 400]],
      [[-400, 0], [0, 1]],
      [[-3, 1], [200, 199]],
    ] as Array<[Point, Point]>) {
      const handles = smoothHandles(before, [0, 0], after)!;
      for (const [handle, other] of [[handles.in, before], [handles.out, after]] as Array<[Point, Point]>) {
        const along = (handle[0] * other[0] + handle[1] * other[1]) / (other[0] ** 2 + other[1] ** 2);
        expect(along).toBeLessThanOrEqual(0.5 + 1e-12);
      }
      // Le due maniglie stanno su una retta per il nodo: liscio.
      expect(Math.abs(handles.in[0] * handles.out[1] - handles.in[1] * handles.out[0])).toBeLessThan(1e-9);
    }
  });

  it("non ce ne sono se il punto coincide con un vicino, o i vicini fra loro", () => {
    expect(smoothHandles([0, 0], [0, 0], [10, 0])).toBeNull();
    expect(smoothHandles([0, 0], [10, 0], [10, 0])).toBeNull();
    expect(smoothHandles([0, 0], [10, 0], [0, 0])).toBeNull();
  });

  it("la maniglia libera rispecchia quella del vicino sull'asse della corda", () => {
    expect(freeHandle([0, 0], [30, 0], [20, 0])).toEqual([10, 0]);
    const kappa = (4 / 3) * Math.tan(Math.PI / 8) * 50;
    const free = freeHandle([0, 0], [50, 50], [50 - kappa, 50]);
    expect(free[0]).toBeCloseTo(0, 9);
    expect(free[1]).toBeCloseTo(kappa, 9);
    // Una maniglia del vicino che torna indietro non spinge il capo oltre.
    expect(freeHandle([0, 0], [30, 0], [40, 10])).toEqual([0, 10]);
  });
});

describe("il tracciato della Curvatura", () => {
  it("due punti fanno una linea, e uno spigolo fra spigoli anche", () => {
    expect(write([smooth(10, 10), smooth(90, 10)], false)).toBe("M10 10 L90 10");
    expect(write([smooth(0, 0), corner(50, 50), smooth(100, 0)], false)).toBe("M0 0 L50 50 L100 0");
  });

  it("tre punti fanno l'arco del cerchio per loro", () => {
    expect(write([smooth(0, 0), smooth(50, 50), smooth(100, 0)], false)).toBe("M0 0 C0 27.61 22.39 50 50 50 C77.61 50 100 27.61 100 0");
    // Punti in fila restano una retta, con le maniglie sulla retta.
    expect(write([smooth(0, 0), smooth(30, 0), smooth(60, 0)], false)).toBe("M0 0 C10 0 20 0 30 0 C40 0 50 0 60 0");
  });

  it("quattro punti chiusi fanno un cerchio", () => {
    const nodes = [smooth(0, -50), smooth(50, 0), smooth(0, 50), smooth(-50, 0)];
    expect(write(nodes, true)).toBe("M0 -50 C27.61 -50 50 -27.61 50 0 C50 27.61 27.61 50 0 50 C-27.61 50 -50 27.61 -50 0 C-50 -27.61 -27.61 -50 0 -50 Z");
    const { min, max } = radii(penPath(curved(nodes, true), true, IDENTITY), [0, 0]);
    expect(min).toBeGreaterThan(50 * (1 - 3e-4));
    expect(max).toBeLessThan(50 * (1 + 3e-4));
  });

  it("sei punti su un cerchio, a passi uguali, danno il cerchio", () => {
    const nodes = Array.from({ length: 6 }, (_, i) => smooth(100 + 40 * Math.cos((i * Math.PI) / 3), 100 + 40 * Math.sin((i * Math.PI) / 3)));
    const { min, max } = radii(penPath(curved(nodes, true), true, IDENTITY), [100, 100]);
    expect(min).toBeGreaterThan(40 * (1 - 1e-4));
    expect(max).toBeLessThan(40 * (1 + 1e-4));
  });

  it("i punti lisci sono lisci, gli spigoli spigoli, come li legge lo strumento Nodi", () => {
    const nodes = [smooth(0, 0), smooth(30, 30), corner(80, 0), smooth(130, 40), smooth(160, 0)];
    const resolved = curved(nodes, false);
    expect(resolved.map((node, i) => (i === 0 || i === 4 ? "end" : penKind(node)))).toEqual(["end", "smooth", "corner", "smooth", "end"]);
    const [sub] = subsOf(write(nodes, false));
    expect([1, 2, 3].map((at) => kindOf(sub!, at))).toEqual(["smooth", "corner", "smooth"]);
  });

  it("uno spigolo fra due punti lisci ha gli archi ai suoi lati", () => {
    expect(write([smooth(0, 0), smooth(50, 50), corner(100, 0), smooth(150, 50), smooth(200, 0)], false))
      .toBe("M0 0 C0 27.61 22.39 50 50 50 C77.61 50 100 27.61 100 0 C100 27.61 122.39 50 150 50 C177.61 50 200 27.61 200 0");
  });

  it("nessun segmento fa un cappio, con punti fitti e lontani mescolati", () => {
    const nodes = [smooth(0, 0), smooth(1, 0), smooth(300, 2), smooth(301, 40), smooth(0, 41), smooth(2, 300)];
    const sub = penPath(curved(nodes, false), false, IDENTITY);
    sub.links.forEach((link, i) => {
      if (link.kind !== "cubic") return;
      const a = sub.nodes[i]!;
      const b = sub.nodes[i + 1]!;
      const chord: Point = [b[0] - a[0], b[1] - a[1]];
      // Lungo la corda la curva va sempre avanti.
      let last = -Infinity;
      for (let k = 0; k <= 200; k++) {
        const [x, y] = pointAt(a, { kind: "cubic", c1: link.c1, c2: link.c2, to: b }, k / 200);
        const along = (x - a[0]) * chord[0] + (y - a[1]) * chord[1];
        expect(along).toBeGreaterThanOrEqual(last - 1e-9);
        last = along;
      }
    });
  });

  it("i nodi della penna restano come sono, quelli della Curvatura si adattano a loro", () => {
    // Un nodo simmetrico della penna fra due punti della Curvatura.
    const pen: DraftNode = { at: [50, 50], in: [30, 50], out: [70, 50] };
    expect(write([smooth(0, 0), pen, corner(100, 0)], false)).toBe("M0 0 C0 20 30 50 50 50 C70 50 100 20 100 0");
  });
});

describe("la Curvatura sui tracciati che ci sono già", () => {
  it("spostare un punto ricalcola i segmenti attorno, non gli altri", () => {
    const before = subsOf(write([smooth(0, 0), smooth(50, 50), smooth(100, 0), smooth(150, 50), smooth(200, 0), smooth(250, 50)], false));
    // Il terzo nodo sale di 40.
    const moved: Subpath[] = [{ ...before[0]!, nodes: before[0]!.nodes.map((p, at): Point => (at === 2 ? [p[0], p[1] - 40] : p)) }];
    const after = recurve(moved, new Set([nodeKey(0, 2)]), inferred(before));
    const fresh = subsOf(write([smooth(0, 0), smooth(50, 50), smooth(100, -40), smooth(150, 50), smooth(200, 0), smooth(250, 50)], false));
    // I segmenti fino al vicino del vicino sono quelli della Curvatura coi
    // punti nuovi; l'ultimo segmento non cambia.
    expect(written([{ ...after[0]!, links: after[0]!.links.slice(0, 4) }])).toBe(written([{ ...fresh[0]!, links: fresh[0]!.links.slice(0, 4) }]));
    expect(after[0]!.links[4]).toEqual(before[0]!.links[4]);
  });

  it("un rettangolo resta di linee: fra due spigoli non cambia niente", () => {
    const rect = subsOf("M0 0 L100 0 L100 50 L0 50 Z");
    const kinds = inferred(rect);
    expect(recurve(rect, new Set([nodeKey(0, 1)]), kinds)).toEqual(rect);
  });

  it("un nodo fatto liscio in un rettangolo curva i suoi due lati", () => {
    const rect = subsOf("M0 0 L100 0 L100 50 L0 50 Z");
    const kinds: KindOf = (s, at) => (at === 1 ? "smooth" : inferred(rect)(s, at));
    // La tangente va di traverso, e i due lati diventano archi uguali: il
    // nodo è simmetrico.
    const after = recurve(rect, new Set([nodeKey(0, 1)]), kinds, new Set([nodeKey(0, 1)]));
    expect(written(after)).toBe("M0 0 C22.88 -22.88 77.12 -22.88 100 0 C116.18 16.18 116.18 33.82 100 50 L0 50 Z");
    expect(kindOf(after[0]!, 1)).toBe("smooth");
  });

  it("uno spigolo nuovo fra due spigoli fa due linee", () => {
    const arch = subsOf("M0 0 C0 27.61 22.39 50 50 50 C77.61 50 100 27.61 100 0");
    const kinds: KindOf = (s, at) => (at === 1 ? "corner" : inferred(arch)(s, at));
    expect(written(recurve(arch, new Set([nodeKey(0, 1)]), kinds, new Set([nodeKey(0, 1)])))).toBe("M0 0 L50 50 L100 0");
  });

  it("uno spigolo con le sue curve, spostato senza cambiarne il tipo, le tiene", () => {
    const shape = subsOf("M0 0 C20 -20 80 -20 100 0 L100 50 L0 50 Z");
    const kinds: KindOf = inferred(shape);
    expect(recurve(shape, new Set([nodeKey(0, 0)]), kinds)).toEqual(shape);
  });

  it("i nodi lisci lontani tengono le loro maniglie", () => {
    const wave = subsOf("M0 0 C10 -20 30 -20 40 0 C50 20 70 20 80 0 C90 -20 110 -20 120 0 C130 20 150 20 160 0");
    const after = recurve(wave, new Set([nodeKey(0, 1)]), inferred(wave));
    // Il nodo 3 è lontano due passi: la sua maniglia verso il nodo 2 resta.
    const link = after[0]!.links[2]!;
    expect(link.kind === "cubic" && link.c2).toEqual([110, -20]);
    expect(after[0]!.links[3]).toEqual(wave[0]!.links[3]);
  });
});
