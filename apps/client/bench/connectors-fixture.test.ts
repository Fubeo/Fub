import { describe, expect, it } from "vitest";

import { SceneEngine } from "../src/editors/spatial/scene/engine";
import { connectorPath, readConnectorGeom, readLabelPlace } from "../src/editors/spatial/scene/connectors";
import type { Matrix } from "../src/editors/spatial/scene/matrix";
import { MAX_EDIT_BYTES, MAX_ELEMENTS, openSource, readScene } from "../src/editors/spatial/scene/read";
import { ConnectorPreview, followConnectors, Router } from "../src/editors/spatial/tools/connectors";
import { estimate } from "../src/editors/spatial/tools/measure";
import { markerTip, followTips } from "../src/editors/spatial/tools/tips";
import { NewIds } from "../src/editors/spatial/tools/edit";
import { CONNECTOR_LIMITS, connectorsFixture, fnv } from "./connectors-fixture";

/// L'attributo `name` dell'elemento `id` del motore.
function attr(engine: SceneEngine, id: string, name: string): string | null {
  const node = engine.holder(id);
  if (node === null) throw new Error(`nessun elemento ${id}`);
  const element = new RegExp(`<[a-zA-Z]+ [^>]*\\bid="${id}"[^>]*>`).exec(engine.text)?.[0];
  if (element === undefined) throw new Error(`nessun elemento ${id} nel testo`);
  return new RegExp(`\\s${name}="([^"]*)"`).exec(element)?.[1] ?? null;
}

describe("il disegno del banco dei connettori", () => {
  const fixture = connectorsFixture(300);
  const engine = SceneEngine.open(fixture.text);

  it.each([6, 30, 300, 1000])("con %i connettori si apre modificabile e pulito", (count) => {
    const made = connectorsFixture(count);
    const scene = readScene(made.text);
    expect(scene.status).toBe("fubdraw");
    expect(scene.readOnly).toEqual([]);
    // Un diagramma con otto riempimenti e tre inchiostri è un codice di
    // colori, e alcuni si distinguono soltanto per la tinta: la nota S017 è
    // giusta, e non dice niente del formato.
    expect(scene.diagnostics.filter((each) => each.code !== "S017")).toEqual([]);
    expect(scene.items.filter((item) => item.kind === "foreign")).toEqual([]);
    expect(openSource(made.text).doc.elements).toBe(made.elements);
    expect(made.elements).toBeLessThan(MAX_ELEMENTS);
    expect(new TextEncoder().encode(made.text).length).toBeLessThan(MAX_EDIT_BYTES);
    expect(made.connectors).toHaveLength(count);
    expect(made.shapes).toHaveLength(Math.round((count * 2) / 3));
  });

  it("a 300 connettori ha 200 forme, una trentina di etichette e dei nodi", () => {
    expect(fixture.shapes).toHaveLength(200);
    expect(fixture.connectors).toHaveLength(300);
    expect(fixture.labels).toHaveLength(30);
    expect(fixture.hubs.length).toBeGreaterThanOrEqual(5);
    for (const hub of fixture.hubs) {
      const degree = fixture.connectors.filter((line) => line.from.id === hub || line.to.id === hub).length;
      expect(degree, hub).toBeGreaterThanOrEqual(15);
    }
  });

  it("le forme hanno un id e un nome, e sono rettangoli, ellissi e poligoni, con e senza contorno", () => {
    expect(new Set(fixture.shapes.map((shape) => shape.id)).size).toBe(200);
    expect(new Set(fixture.shapes.map((shape) => shape.name)).size).toBe(200);
    expect(new Set(fixture.shapes.map((shape) => shape.kind))).toEqual(new Set(["rect", "ellipse", "polygon"]));
    expect(new Set(fixture.shapes.map((shape) => shape.reach))).toEqual(new Set([0, 1]));
    for (const shape of fixture.shapes) {
      expect(attr(engine, shape.id, "fub:name"), shape.id).toBe(shape.name);
    }
  });

  it("i connettori sono dritti, a gomito e curvi, con agganci automatici e di lato, e la punta alla fine", () => {
    const kinds = new Map<string, number>();
    for (const line of fixture.connectors) kinds.set(line.kind, (kinds.get(line.kind) ?? 0) + 1);
    expect([...kinds.keys()].sort()).toEqual(["curved", "elbow", "straight"]);
    for (const count of kinds.values()) expect(count).toBeGreaterThan(60);
    const anchors = new Set(fixture.connectors.flatMap((line) => [line.from.anchor, line.to.anchor]));
    expect(anchors).toEqual(new Set(["auto", "center", "top", "right", "bottom", "left"]));
    const auto = fixture.connectors.filter((line) => line.from.anchor === "auto" && line.to.anchor === "auto").length;
    expect(auto).toBeGreaterThan(80);
    const tipped = fixture.connectors.filter((line) => line.tip);
    expect(tipped.length).toBeGreaterThan(200);
    expect(tipped.length).toBeLessThan(300);
    for (const line of fixture.connectors) {
      const id = /^url\(#([^)]+)\)$/.exec(attr(engine, line.id, "marker-end") ?? "")?.[1];
      if (!line.tip) {
        expect(id, line.id).toBeUndefined();
        continue;
      }
      const marker = engine.holder(id!);
      expect(marker, line.id).not.toBeNull();
      // Una punta della raccolta, condivisa: FubDraw la riconosce.
      expect(markerTip(marker as never)?.end, line.id).toBe("end");
    }
  });

  it("non unisce due volte le stesse forme, né una forma a sé stessa", () => {
    const pairs = new Set(fixture.connectors.map((line) => [line.from.id, line.to.id].sort().join(" ")));
    expect(pairs.size).toBe(300);
    expect(fixture.connectors.every((line) => line.from.id !== line.to.id)).toBe(true);
  });

  it("ogni connettore rigenerato da fub:geom dà lo stesso d", () => {
    for (const line of fixture.connectors) {
      const geom = readConnectorGeom(attr(engine, line.id, "fub:geom") ?? "");
      expect(geom, line.id).not.toBeNull();
      expect(geom!.kind).toBe(line.kind);
      expect(connectorPath(geom!), line.id).toBe(attr(engine, line.id, "d"));
    }
  });

  it("ogni capo sta sul contorno della sua forma, al più mezzo spessore fuori", () => {
    const router = new Router(estimate);
    for (const line of fixture.connectors) {
      const geom = readConnectorGeom(attr(engine, line.id, "fub:geom")!)!;
      const ends = [geom.points[0]!, geom.points[geom.points.length - 1]!];
      for (const [at, end] of [[line.from.id, ends[0]!], [line.to.id, ends[1]!]] as const) {
        const outline = router.outline(engine.holder(at)!)!;
        let nearest = Infinity;
        for (const [a, b] of outline.chords) {
          const [ex, ey] = [b[0] - a[0], b[1] - a[1]];
          const along = Math.max(0, Math.min(1, ((end[0] - a[0]) * ex + (end[1] - a[1]) * ey) / (ex * ex + ey * ey || 1)));
          nearest = Math.min(nearest, Math.hypot(end[0] - (a[0] + ex * along), end[1] - (a[1] + ey * along)));
        }
        // Il capo esce dal contorno lungo un raggio, di mezzo spessore: dal
        // contorno disegnato sta a meno, quando il raggio è obliquo.
        expect(nearest, `${line.id} verso ${at}`).toBeLessThanOrEqual(outline.reach + 0.02);
      }
    }
  });

  it("le etichette stanno sul connettore che dicono, nel posto che dicono", () => {
    expect(new Set(fixture.connectors.flatMap((line) => (line.label === null ? [] : [line.label]))).size).toBe(30);
    for (const line of fixture.connectors) {
      if (line.label === null) continue;
      const place = readLabelPlace(attr(engine, line.label, "fub:along") ?? "");
      expect(place?.id, line.label).toBe(line.id);
      expect(attr(engine, line.label, "transform"), line.label).toMatch(/^matrix\(1 0 0 1 [-\d.]+ [-\d.]+\)$/);
    }
  });

  it("è un punto fisso del seguito del motore: toccare tutte le forme non cambia niente", () => {
    const touched = new Set(fixture.shapes.map((shape) => shape.id));
    const find = (id: string) => engine.holder(id);
    expect(followConnectors(engine.model!, touched, find, estimate)).toBeNull();
    expect(followTips(engine.model!, new Set(fixture.connectors.map((line) => line.id)), new NewIds((id) => find(id) !== null), find)).toBeNull();
  });

  it("è lo stesso disegno a ogni chiamata, e un altro con un altro numero", () => {
    const again = connectorsFixture(300);
    expect(again.text).toBe(fixture.text);
    expect(again.digest).toBe(fixture.digest);
    expect(connectorsFixture(301).digest).not.toBe(fixture.digest);
  });

  it("non fa disegni con meno o più connettori di quanti ne riceve", () => {
    const [least, most] = CONNECTOR_LIMITS;
    for (const count of [0, -1, 1.5, Number.NaN, least - 1, most + 1]) {
      expect(() => connectorsFixture(count)).toThrow(RangeError);
    }
  });
});

/// Le geometrie che il disegno dei trecento connettori ha con ogni gesto:
/// le impronte di ciò che l'anteprima mostra e di ciò che il passo scrive,
/// prese dal calcolo che legge ogni contorno da capo a ogni fotogramma e a
/// ogni operazione. Chi lo rende più veloce deve ottenere gli stessi numeri;
/// chi cambia le geometrie, di proposito, cambia anche queste.
describe("le geometrie dei connettori non cambiano con la velocità", () => {
  const fixture = connectorsFixture(300);
  const cos = Math.cos((7 * Math.PI) / 180);
  const sin = Math.sin((7 * Math.PI) / 180);
  const MOVES: readonly Matrix[] = [
    [1, 0, 0, 1, 10, 5],
    [1, 0, 0, 1, -33.37, 12.5],
    [1, 0, 0, 1, 0.005, 0.004],
    [1, 0, 0, 1, 411.1, -97.3],
    [1.1, 0, 0, 0.9, 5, -7],
    [cos, sin, -sin, cos, 40, 3],
    [0.5, 0, 0, 0.5, 100, 100],
  ];
  let seed = 12345;
  const random = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const SETS: Readonly<Record<string, readonly string[]>> = {
    all: fixture.shapes.map((shape) => shape.id),
    hub: [fixture.hubs[0]!],
    hubs: fixture.hubs.slice(1, 3),
    random: fixture.shapes.filter(() => random() < 0.1).map((shape) => shape.id),
    // Forme e connettori insieme, come con «Seleziona tutto»: i connettori si
    // spostano coi loro oggetti.
    everything: [...fixture.shapes.map((shape) => shape.id), ...fixture.connectors.map((line) => line.id)],
  };

  /// L'impronta di ciò che l'anteprima mostra se `ids` si portano di `MOVES[move]`.
  function previewed(ids: readonly string[], moves: readonly number[]): string[] {
    const engine = SceneEngine.open(fixture.text);
    const find = (id: string) => engine.holder(id);
    const preview = new ConnectorPreview(engine.model!, new Set(ids.map((id) => find(id)!)), find, estimate);
    return moves.map((move) => {
      const draft = preview.at(MOVES[move]!);
      return fnv(JSON.stringify({ paths: [...draft.paths], transforms: [...draft.transforms] }));
    });
  }

  /// L'impronta del disegno dopo aver portato `ids` di (13, -7) col seguito del motore.
  function moved(ids: readonly string[]): string {
    const engine = SceneEngine.open(fixture.text);
    engine.follow = (model, touched, op) => followConnectors(model, touched, (id) => engine.holder(id), estimate, op);
    const done = engine.apply({ op: "batch", ops: ids.map((id) => ({ op: "set", id, attrs: { transform: "translate(13 -7)" } })) } as never);
    expect(done.outcome).toBe("applied");
    return fnv(engine.text);
  }

  it("l'anteprima di un gesto mostra gli stessi percorsi e le stesse etichette", () => {
    expect(previewed(SETS.all!, [0, 1, 4, 5])).toEqual(["46f0e093", "0e3d1f2d", "6f749e12", "cdea3883"]);
    expect(previewed(SETS.hub!, [0, 5])).toEqual(["2d10d45b", "61f4d855"]);
    expect(previewed(SETS.hubs!, [2])).toEqual(["2f32d430"]);
    expect(previewed(SETS.random!, [1])).toEqual(["417dd50e"]);
    expect(previewed(SETS.everything!, [0, 4])).toEqual(["b6867e58", "d1d0c12a"]);
  });

  it("l'anteprima non dipende dai fotogrammi che l'hanno preceduta", () => {
    const before = [0, 1, 4, 5, 3, 2, 6];
    const after = [5, 6, 2, 3, 5, 4, 1, 0];
    const first = previewed(SETS.all!, before);
    const second = previewed(SETS.all!, after);
    after.forEach((move, at) => expect(second[at], `movimento ${move}`).toBe(first[before.indexOf(move)]));
  });

  it("il seguito di un'operazione scrive gli stessi connettori e le stesse etichette", () => {
    expect([moved(SETS.all!), moved(SETS.hub!), moved(SETS.random!)]).toEqual(["4c66fe1c", "054f6541", "7398e652"]);
  });
});
