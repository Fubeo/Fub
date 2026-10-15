import { describe, expect, it } from "vitest";
import { readConnectorGeom, readLabelPlace, writeConnectorGeom } from "../scene/connectors";
import { translate, type Point } from "../scene/matrix";
import { roundHalfUp } from "../number";
import { doc } from "../scene/test-support";
import { connectOps, ConnectorPreview, followConnectors, labelNormal, labelsOf, route, Router, STUB, type EndSpec } from "./connectors";
import { destination, NewIds } from "./edit";
import { DEFAULT_TIP_SIZE, Shelf } from "./tips";
import { estimate } from "./measure";
import { LAYER, open, type Opened } from "./test-support";
import { applied } from "./tip-support";

/// Il motore di `body`, dentro il primo livello, coi connettori che seguono
/// gli oggetti, come lo installa l'editor.
function sheet(body: string, after = ""): Opened {
  const opened = open(doc(`${LAYER}${body}</g>${after}`));
  opened.engine.follow = (model, touched, op) => followConnectors(model, touched, (id) => opened.engine.holder(id), estimate, op);
  return opened;
}

/// Il valore dell'attributo `name` dell'elemento `id` nel testo del motore.
function attr(opened: Opened, id: string, name: string): string | null {
  const element = new RegExp(`<[a-zA-Z]+ id="${id}"[^>]*>`).exec(opened.engine.text)?.[0];
  if (element === undefined) throw new Error(`nessun elemento ${id}`);
  return new RegExp(` ${name}="([^"]*)"`).exec(element)?.[1] ?? null;
}

/// I punti di `fub:geom` del connettore `id`.
function points(opened: Opened, id = "c"): readonly Point[] {
  const geom = readConnectorGeom(attr(opened, id, "fub:geom") ?? "");
  if (geom === null) throw new Error(`nessuna geometria per ${id}`);
  return geom.points;
}

const A = '<rect id="a" x="100" y="100" width="200" height="120" fill="#e69f00"/>';
const B = '<rect id="b" x="500" y="400" width="200" height="120" fill="#009e73"/>';

/// Un connettore da `a` a `b` con una geometria vecchia, da ricalcolare.
const LINE = (kind = "elbow", from = "a auto", to = "b auto", extra = ""): string =>
  `<path id="c" fub:shape="connector" fub:geom="${kind === "curved" ? "curved 0 0 1 1 2 2 3 3" : `${kind} 0 0 10 10`}" fub:from="${from}" fub:to="${to}" d="${kind === "curved" ? "M0 0 C1 1 2 2 3 3" : "M0 0 L10 10"}" fill="none" stroke="#000000" stroke-width="2"${extra}/>`;

/// Il connettore ricalcolato da un cambiamento qualunque di `a`.
function routed(body: string): Opened {
  const opened = sheet(body);
  applied(opened, { op: "set", id: "a", attrs: { "fub:name": "A" } });
  return opened;
}

/// Il capo di un oggetto della scena per [`route`].
function end(opened: Opened, id: string | null, anchor: EndSpec["anchor"] = "auto", free: Point = [0, 0]): EndSpec {
  const router = new Router(estimate);
  return { outline: id === null ? null : router.outline(opened.engine.holder(id)!), anchor, free };
}

/// Vero se `p` sta dentro il rettangolo, bordi esclusi.
const inside = (p: Point, x: number, y: number, w: number, h: number): boolean => p[0] > x + 1e-6 && p[0] < x + w - 1e-6 && p[1] > y + 1e-6 && p[1] < y + h - 1e-6;

/// Vero se un tratto orizzontale o verticale da `p` a `q` passa dentro il
/// rettangolo.
function crosses(p: Point, q: Point, x: number, y: number, w: number, h: number): boolean {
  for (let k = 0; k <= 64; k++) {
    const t = k / 64;
    if (inside([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], x, y, w, h)) return true;
  }
  return false;
}

describe("i capi", () => {
  it("una linea dritta tocca il bordo dei due rettangoli sulla linea fra i centri", () => {
    const opened = routed(`${A}${B}${LINE("straight")}`);
    const [p, q] = points(opened);
    // Dal centro (200, 160) verso (600, 460): esce dal lato basso, y = 220.
    expect(p![0]).toBeCloseTo(280, 2);
    expect(p![1]).toBeCloseTo(220, 2);
    expect(q![0]).toBeCloseTo(520, 2);
    expect(q![1]).toBeCloseTo(400, 2);
  });

  it("verso un cerchio tocca il cerchio, non il suo riquadro", () => {
    const opened = routed(`${A}<circle id="b" cx="600" cy="160" r="50"/>${LINE("straight")}`);
    const q = points(opened)[1]!;
    expect(Math.hypot(q[0] - 600, q[1] - 160)).toBeCloseTo(50, 0);
    expect(q[1]).toBeCloseTo(160, 1);
  });

  it("un capo verso un triangolo tocca il lato obliquo", () => {
    const opened = routed(`${A}<polygon id="b" points="600 100 700 300 500 300"/>${LINE("straight", "a auto", "b center")}`);
    const q = points(opened)[1]!;
    // Il centro del riquadro è (600, 200); il raggio verso (200, 160) esce
    // dal lato da (600, 100) a (500, 300), non dal bordo sinistro x = 500.
    expect(q[0]).toBeGreaterThan(540);
    expect(q[0] - 600 + (q[1] - 100) / 2).toBeCloseTo(0, 1);
  });

  it("mezzo spessore del contorno allontana il capo", () => {
    const opened = routed(`${A.replace("/>", ' stroke="#000000" stroke-width="10"/>')}${B}${LINE("elbow", "a bottom", "b top")}`);
    expect(points(opened)[0]).toEqual([200, 225]);
  });

  it("un lato scelto segue il verso dell'oggetto girato", () => {
    const opened = routed(`${A.replace("/>", ' transform="rotate(90 200 160)"/>')}${B}${LINE("straight", "a right", "b center")}`);
    // Girato di 90 gradi, il lato destro guarda in basso: mezza larghezza,
    // 100, sotto il centro.
    const [p] = points(opened);
    expect(p![0]).toBeCloseTo(200, 2);
    expect(p![1]).toBeCloseTo(260, 2);
  });

  it("un gruppo ha il contorno dei suoi oggetti", () => {
    const group = '<g id="g"><rect x="0" y="0" width="40" height="40"/><rect x="0" y="200" width="40" height="40"/></g>';
    const opened = sheet(`${group}<rect id="b" x="300" y="100" width="40" height="40"/>${LINE("straight", "g center", "b center").replace("fub:from=\"g center\"", 'fub:from="g center"')}`);
    applied(opened, { op: "set", id: "b", attrs: { "fub:name": "B" } });
    const [p] = points(opened);
    // Il centro del gruppo è (20, 120), fra i due quadrati: il raggio verso
    // destra non incontra niente e il capo è sul riquadro, x = 40.
    expect(p![0]).toBeCloseTo(40, 2);
  });

  it("una ripetizione ha il contorno delle sue copie", () => {
    const row = '<g id="g" fub:repeat="grid 1 2 0 200"><rect id="o" x="0" y="0" width="40" height="40"/><use id="k" transform="translate(0 200)" href="#o"/></g>';
    const opened = sheet(`${row}<rect id="b" x="0" y="400" width="40" height="40"/>${LINE("straight", "g auto", "b center")}`);
    applied(opened, { op: "set", id: "b", attrs: { "fub:name": "B" } });
    // Dal centro della ripetizione, (20, 120), il raggio scende ed esce dal
    // fondo della copia.
    expect(points(opened)[0]).toEqual([20, 240]);
    // Cambiato l'originale, il capo segue la copia.
    applied(opened, { op: "set", id: "o", attrs: { height: "60" } });
    expect(points(opened)[0]).toEqual([20, 260]);
  });

  it("l'etichetta di una forma non fa parte del contorno, nemmeno quando esce dalla forma", () => {
    const label = '<text id="t" fub:inside="r" fub:wrap="28" x="0" y="0" text-anchor="middle" transform="matrix(1 0 0 1 20 124)"><tspan x="0" dy="0">Unaparolalunghissima</tspan></text>';
    const group = `<g id="g"><rect id="r" x="0" y="100" width="40" height="40"/>${label}</g>`;
    const opened = sheet(`${group}<rect id="b" x="300" y="100" width="40" height="40"/>${LINE("straight", "g center", "b center")}`);
    applied(opened, { op: "set", id: "b", attrs: { "fub:name": "B" } });
    const [p] = points(opened);
    expect(p![0]).toBeCloseTo(40, 2);
    expect(p![1]).toBeCloseTo(120, 2);
    // Staccata dalla forma, è un testo qualunque del gruppo, e il capo lo tocca.
    const loose = sheet(`${group.replace(' fub:inside="r"', "")}<rect id="b" x="300" y="100" width="40" height="40"/>${LINE("straight", "g center", "b center")}`);
    applied(loose, { op: "set", id: "b", attrs: { "fub:name": "B" } });
    expect(points(loose)[0]![0]).toBeGreaterThan(60);
  });

  it("un capo verso un oggetto senza id, un livello o sé stesso è libero", () => {
    const opened = sheet(`${A}${B}${LINE("straight", "l1 auto", "c auto")}`);
    const before = opened.engine.text;
    applied(opened, { op: "set", id: "a", attrs: { "fub:name": "A" } });
    expect(opened.engine.text.replace(' fub:name="A"', "")).toBe(before);
  });
});

describe("il gomito", () => {
  it("unisce due rettangoli coi lati che si guardano, per la via di mezzo", () => {
    const opened = routed(`${A}${B}${LINE()}`);
    expect(attr(opened, "c", "fub:geom")).toBe("elbow 200 220 200 310 600 310 600 400");
    expect(attr(opened, "c", "d")).toBe("M200 220 L200 310 L600 310 L600 400");
  });

  it("fra due lati allineati è una linea sola", () => {
    const opened = routed(`<rect id="a" x="0" y="0" width="100" height="100"/><rect id="b" x="300" y="0" width="100" height="100"/>${LINE("elbow", "a right", "b left")}`);
    expect(points(opened)).toEqual([[100, 50], [300, 50]]);
  });

  it("fra due lati sfalsati è una Z con la curva a metà", () => {
    const opened = routed(`<rect id="a" x="0" y="0" width="100" height="100"/><rect id="b" x="300" y="100" width="100" height="100"/>${LINE("elbow", "a right", "b left")}`);
    expect(points(opened)).toEqual([[100, 50], [200, 50], [200, 150], [300, 150]]);
  });

  it("gira attorno agli oggetti quando i lati si danno le spalle", () => {
    const opened = routed(`<rect id="a" x="300" y="0" width="100" height="100"/><rect id="b" x="0" y="0" width="100" height="100"/>${LINE("elbow", "a right", "b left")}`);
    const path = points(opened);
    expect(path[0]).toEqual([400, 50]);
    expect(path[path.length - 1]).toEqual([0, 50]);
    expect(path[1]).toEqual([400 + STUB, 50]);
    for (let i = 1; i < path.length; i++) {
      const [p, q] = [path[i - 1]!, path[i]!];
      expect(p[0] === q[0] || p[1] === q[1]).toBe(true);
      expect(crosses(p, q, 300, 0, 100, 100)).toBe(false);
      expect(crosses(p, q, 0, 0, 100, 100)).toBe(false);
    }
  });

  it("fra due oggetti più vicini di due uscite passa in mezzo, senza girare loro attorno", () => {
    const opened = sheet(`<rect id="a" x="0" y="0" width="120" height="60"/><rect id="b" x="100" y="90" width="100" height="60"/>`);
    const path = route("elbow", end(opened, "a", "bottom"), end(opened, "b", "top"));
    expect(path).toEqual([[60, 60], [60, 75], [150, 75], [150, 90]]);
  });

  it("per ogni coppia di lati i tratti sono dritti, fuori dagli oggetti, e al più sei vertici", () => {
    const sides = ["auto", "top", "right", "bottom", "left"] as const;
    const places: ReadonlyArray<readonly [number, number]> = [[400, 0], [400, 300], [0, 300], [-300, -300], [60, 160], [130, 0]];
    for (const [x, y] of places) {
      for (const from of sides) {
        for (const to of sides) {
          const opened = sheet(`<rect id="a" x="0" y="0" width="100" height="100"/><rect id="b" x="${x}" y="${y}" width="120" height="80"/>`);
          const path = route("elbow", end(opened, "a", from), end(opened, "b", to));
          const label = `${from} → ${to} verso (${x}, ${y})`;
          expect(path.length, label).toBeGreaterThanOrEqual(2);
          expect(path.length, label).toBeLessThanOrEqual(6);
          for (let i = 1; i < path.length; i++) {
            const [p, q] = [path[i - 1]!, path[i]!];
            expect(Math.abs(p[0] - q[0]) < 1e-6 || Math.abs(p[1] - q[1]) < 1e-6, label).toBe(true);
            // Due oggetti che si toccano quasi lasciano un'uscita corta: si
            // guarda che la linea non attraversi l'interno.
            expect(crosses(p, q, 1, 1, 98, 98), label).toBe(false);
            expect(crosses(p, q, x + 1, y + 1, 118, 78), label).toBe(false);
          }
        }
      }
    }
  });

  it("un capo libero esce verso l'altro", () => {
    const opened = sheet(`<rect id="a" x="0" y="0" width="100" height="100"/>`);
    const path = route("elbow", end(opened, "a", "right"), end(opened, null, "auto", [300, 300]));
    expect(path[0]).toEqual([100, 50]);
    expect(path[path.length - 1]).toEqual([300, 300]);
    for (let i = 1; i < path.length; i++) expect(path[i - 1]![0] === path[i]![0] || path[i - 1]![1] === path[i]![1]).toBe(true);
  });
});

describe("la curva", () => {
  it("esce da ogni capo agganciato nella sua direzione", () => {
    const opened = routed(`<rect id="a" x="0" y="0" width="100" height="100"/><rect id="b" x="400" y="200" width="100" height="100"/>${LINE("curved", "a right", "b left")}`);
    const [p, c1, c2, q] = points(opened);
    expect(p).toEqual([100, 50]);
    expect(q).toEqual([400, 250]);
    expect(c1![1]).toBe(50);
    expect(c1![0]).toBeGreaterThan(100);
    expect(c2![1]).toBe(250);
    expect(c2![0]).toBeLessThan(400);
    expect(c1![0] - 100).toBeCloseTo(400 - c2![0], 2);
  });

  it("fra due capi liberi è dritta", () => {
    const opened = sheet("");
    const path = route("curved", end(opened, null, "auto", [0, 0]), end(opened, null, "auto", [90, 30]));
    expect(path).toEqual([[0, 0], [30, 10], [60, 20], [90, 30]]);
  });
});

describe("seguire", () => {
  it("spostare un oggetto rifà il percorso nello stesso passo, e un annulla lo riporta", () => {
    const opened = routed(`${A}${B}${LINE()}`);
    const before = opened.engine.text;
    const out = opened.engine.apply({ op: "set", id: "b", attrs: { transform: "translate(0 100)" } });
    expect(out.outcome).toBe("applied");
    expect(attr(opened, "c", "fub:geom")).toBe("elbow 200 220 200 360 600 360 600 500");
    expect(attr(opened, "c", "fub:from")).toBe("a auto");
    if (out.outcome !== "applied") return;
    expect(opened.engine.undo(out.undo).outcome).toBe("applied");
    expect(opened.engine.text).toBe(before);
  });

  it("spostare il gruppo che contiene un oggetto rifà il percorso", () => {
    const opened = routed(`<g id="g">${A}</g>${B}${LINE()}`);
    applied(opened, { op: "set", id: "g", attrs: { transform: "translate(0 -100)" } });
    expect(points(opened)[0]).toEqual([200, 120]);
  });

  it("un connettore in un gruppo spostato scrive il percorso nelle sue coordinate", () => {
    const opened = routed(`${A}${B}<g id="g" transform="translate(50 50)">${LINE()}</g>`);
    expect(attr(opened, "c", "fub:geom")).toBe("elbow 150 170 150 260 550 260 550 350");
  });

  it("spostato da solo, il connettore si stacca e resta dove lo si è messo", () => {
    const opened = routed(`${A}${B}${LINE()}`);
    const geom = attr(opened, "c", "fub:geom");
    applied(opened, { op: "set", id: "c", attrs: { transform: "translate(30 0)" } });
    expect(attr(opened, "c", "fub:from")).toBeNull();
    expect(attr(opened, "c", "fub:to")).toBeNull();
    expect(attr(opened, "c", "fub:geom")).toBe(geom);
  });

  it("spostato coi suoi oggetti, resta agganciato", () => {
    const opened = routed(`${A}${B}${LINE()}`);
    const move = (id: string) => ({ op: "set" as const, id, attrs: { transform: "translate(30 0)" } });
    applied(opened, { op: "batch", ops: [move("a"), move("b"), move("c")] });
    expect(attr(opened, "c", "fub:from")).toBe("a auto");
    expect(attr(opened, "c", "fub:geom")).toBe("elbow 200 220 200 310 600 310 600 400");
  });

  it("togliere un oggetto stacca il capo, e la linea tiene l'ultima geometria", () => {
    const opened = routed(`${A}${B}${LINE()}`);
    const geom = attr(opened, "c", "fub:geom");
    applied(opened, { op: "remove", target: "b" });
    expect(attr(opened, "c", "fub:from")).toBe("a auto");
    expect(attr(opened, "c", "fub:to")).toBeNull();
    expect(attr(opened, "c", "fub:geom")).toBe(geom);
  });

  it("un connettore in un livello bloccato non si riscrive, e l'oggetto si sposta", () => {
    const opened = sheet(`${A}${B}`, `<g id="l2" fub:layer="Livello 2" fub:locked="true">${LINE()}</g>`);
    const before = attr(opened, "c", "fub:geom");
    applied(opened, { op: "set", id: "a", attrs: { transform: "translate(10 0)" } });
    expect(attr(opened, "a", "transform")).toBe("translate(10 0)");
    expect(attr(opened, "c", "fub:geom")).toBe(before);
  });

  it("non c'è niente da fare senza connettori", () => {
    const opened = sheet(`${A}${B}`);
    expect(followConnectors(opened.engine.model!, new Set(["a"]), (id) => opened.engine.holder(id), estimate)).toBeNull();
  });
});

describe("le etichette", () => {
  const LABEL = '<text id="t" fub:along="c 0.5 4" x="0" y="0" text-anchor="middle"><tspan x="0" dy="0">sì</tspan></text>';

  it("la normale positiva guarda in alto a destra", () => {
    const plain = (p: Point): Point => [p[0] + 0, p[1] + 0];
    expect(plain(labelNormal([1, 0]))).toEqual([0, -1]);
    expect(plain(labelNormal([-1, 0]))).toEqual([0, -1]);
    expect(plain(labelNormal([0, 1]))).toEqual([1, 0]);
    expect(plain(labelNormal([0, -1]))).toEqual([1, 0]);
    // Una linea obliqua che sale verso destra ha l'etichetta in alto a
    // sinistra, da qualunque parte la si percorra.
    expect(plain(labelNormal([1, -1]))).toEqual([-1, -1]);
    expect(plain(labelNormal([-1, 1]))).toEqual([-1, -1]);
    expect(plain(labelNormal([Math.SQRT1_2, -Math.SQRT1_2]))).toEqual(plain(labelNormal([-Math.SQRT1_2, Math.SQRT1_2])));
  });

  it("la normale non dipende dal verso in cui si percorre la linea", () => {
    const directions: Point[] = [[1, 0], [0, 1], [1, 1], [1, -1], [3, -3], [2, -1], [1, -2], [-1, -2], [5, 4], [0.5, -0.5], [1, -1.0000001], [1, -0.9999999]];
    for (const [dx, dy] of directions) {
      const there = labelNormal([dx, dy]);
      const back = labelNormal([-dx, -dy]);
      expect(there[0], `(${dx}, ${dy})`).toBeCloseTo(back[0], 9);
      expect(there[1], `(${dx}, ${dy})`).toBeCloseTo(back[1], 9);
    }
  });

  it("una linea da (0, 100) a (100, 0) tiene l'etichetta dalla stessa parte da qualunque capo parta", () => {
    const place = (geom: string, d: string, along: string): string => {
      const opened = sheet(`<path id="c" fub:shape="connector" fub:geom="${geom}" d="${d}" fill="none" stroke="#000000" stroke-width="2"/>${LABEL.replace("c 0.5 4", along)}`);
      applied(opened, { op: "set", id: "c", attrs: { "fub:name": "linea" } });
      return attr(opened, "t", "transform")!;
    };
    const rising = place("straight 0 100 100 0", "M0 100 L100 0", "c 0.25 4");
    // Gli stessi punti dall'altro capo, con `t` che vale `1 - t`.
    const falling = place("straight 100 0 0 100", "M100 0 L0 100", "c 0.75 4");
    expect(falling).toBe(rising);
    // Sopra la linea, dalla parte in alto a sinistra: la somma delle
    // coordinate sta sotto quella dei punti della linea, 100.
    const [, , , , x, y] = rising.match(/matrix\(([^)]*)\)/)![1]!.split(" ").map(Number) as [number, number, number, number, number, number];
    expect(x + y).toBeLessThan(100);
  });

  it("seguono la linea, a metà e appena sopra", () => {
    const opened = routed(`${A}${B}${LINE()}${LABEL}`);
    // A metà dei 580 della linea, (400, 310); con il corpo di 16 il riquadro
    // del testo va da -12,8 a 4 attorno alla linea di base, e la distanza di
    // 4 lo porta a finire a y 306.
    expect(attr(opened, "t", "transform")).toBe("matrix(1 0 0 1 400 302)");
    applied(opened, { op: "set", id: "b", attrs: { transform: "translate(0 100)" } });
    expect(attr(opened, "t", "transform")).toBe("matrix(1 0 0 1 400 352)");
  });

  it("spostata da sola prende il posto nuovo lungo la linea", () => {
    const opened = routed(`${A}${B}${LINE()}${LABEL}`);
    applied(opened, { op: "set", id: "t", attrs: { transform: "matrix(1 0 0 1 500 330)" } });
    const place = readLabelPlace(attr(opened, "t", "fub:along")!);
    // Il centro (500, 325,6) sta sotto il tratto orizzontale, a 3/4 della
    // linea: 90 + 300 su 580.
    expect(place!.t).toBeCloseTo(390 / 580, 3);
    expect(place!.offset).toBeLessThan(0);
    expect(attr(opened, "t", "transform")).toBe("matrix(1 0 0 1 500 330)");
  });

  it("togliere il connettore toglie il posto, e l'etichetta resta un testo", () => {
    const opened = routed(`${A}${B}${LINE()}${LABEL}`);
    applied(opened, { op: "remove", target: "c" });
    expect(attr(opened, "t", "fub:along")).toBeNull();
    expect(attr(opened, "t", "transform")).toBe("matrix(1 0 0 1 400 302)");
  });
});

describe("l'anteprima di un gesto", () => {
  it("mostra il percorso e l'etichetta che l'operazione scriverà", () => {
    const opened = routed(`${A}${B}${LINE()}<text id="t" fub:along="c 0.5 4" x="0" y="0" text-anchor="middle"><tspan x="0" dy="0">sì</tspan></text>`);
    const preview = new ConnectorPreview(opened.engine.model!, new Set([opened.engine.holder("b")!]), (id) => opened.engine.holder(id), estimate);
    expect(preview.empty).toBe(false);
    const draft = preview.at([1, 0, 0, 1, 0, 100]);
    applied(opened, { op: "set", id: "b", attrs: { transform: "translate(0 100)" } });
    expect(draft.paths.get("c")).toBe(attr(opened, "c", "d"));
    expect(draft.transforms.get("t")).toBe(attr(opened, "t", "transform"));
  });

  it("un gesto che non tocca gli oggetti agganciati non ha niente da mostrare", () => {
    const opened = routed(`${A}${B}<rect id="z" x="0" y="0" width="10" height="10"/>${LINE()}`);
    expect(new ConnectorPreview(opened.engine.model!, new Set([opened.engine.holder("z")!]), (id) => opened.engine.holder(id), estimate).empty).toBe(true);
  });

  it("200 oggetti e 300 connettori: un fotogramma e un'operazione restano veloci", () => {
    const shapes: string[] = [];
    const lines: string[] = [];
    for (let i = 0; i < 200; i++) shapes.push(`<rect id="s${i}" x="${(i % 20) * 160}" y="${Math.floor(i / 20) * 120}" width="100" height="60"/>`);
    for (let i = 0; i < 300; i++) {
      const from = i % 200;
      const to = (i * 7 + 1) % 200;
      const kind = ["elbow", "straight", "curved"][i % 3]!;
      lines.push(LINE(kind, `s${from} auto`, `s${to} auto`).replace('id="c"', `id="c${i}"`));
    }
    const opened = sheet(`<g id="all">${shapes.join("")}</g>${lines.join("")}`);
    const moving = new Set([opened.engine.holder("all")!]);
    const preview = new ConnectorPreview(opened.engine.model!, moving, (id) => opened.engine.holder(id), estimate);
    preview.at([1, 0, 0, 1, 1, 1]);
    let slowest = 0;
    for (let k = 0; k < 5; k++) {
      const started = performance.now();
      preview.at([1, 0, 0, 1, 10 * k, 5 * k]);
      slowest = Math.max(slowest, performance.now() - started);
    }
    const started = performance.now();
    const out = opened.engine.apply({ op: "set", id: "all", attrs: { transform: "translate(10 10)" } });
    const took = performance.now() - started;
    expect(out.outcome).toBe("applied");
    expect(slowest).toBeLessThan(60);
    expect(took).toBeLessThan(1500);
  });
});

describe("l'anteprima, fotogramma per fotogramma", () => {
  /// Venti forme di ogni specie, in griglia, e trenta connettori di ogni tipo
  /// e aggancio, quindici con la loro etichetta.
  function diagram(): string {
    const shapes: string[] = [];
    for (let i = 0; i < 20; i++) {
      const x = (i % 5) * 230;
      const y = Math.floor(i / 5) * 170;
      if (i % 3 === 0) shapes.push(`<rect id="s${i}" x="${x}" y="${y}" width="120" height="70"/>`);
      else if (i % 3 === 1) shapes.push(`<ellipse id="s${i}" cx="${x + 60}" cy="${y + 35}" rx="60" ry="35"/>`);
      else shapes.push(`<polygon id="s${i}" points="${x + 60},${y} ${x + 120},${y + 70} ${x},${y + 70}"/>`);
    }
    const anchors = ["auto", "center", "top", "right", "bottom", "left"];
    const kinds = ["straight", "elbow", "curved"];
    const lines: string[] = [];
    const labels: string[] = [];
    for (let k = 0; k < 30; k++) {
      const from = (k * 3) % 20;
      const to = (k * 7 + 1 + (from === (k * 7 + 1) % 20 ? 1 : 0)) % 20;
      lines.push(LINE(kinds[k % 3]!, `s${from} ${anchors[k % 6]}`, `s${to} ${anchors[(k * 5 + 2) % 6]}`).replace('id="c"', `id="c${k}"`));
      if (k % 2 === 0) {
        labels.push(`<text id="t${k}" fub:along="c${k} 0.4 6" x="0" y="0" text-anchor="middle"><tspan x="0" dy="0">linea ${k}</tspan></text>`);
      }
    }
    return `${shapes.join("")}${lines.join("")}${labels.join("")}`;
  }

  it("mostra gli stessi percorsi e le stesse etichette dell'operazione, per ogni gesto", () => {
    const body = diagram();
    const gestures: ReadonlyArray<readonly [string, readonly string[], number, number]> = [
      ["una forma", ["s3"], 37, -21],
      ["tre forme", ["s0", "s5", "s6"], -100, 55],
      ["una colonna", ["s0", "s5", "s10", "s15"], 3, 2],
      ["tutte", Array.from({ length: 20 }, (_, i) => `s${i}`), 41, 17],
    ];
    let shown = 0;
    for (const [name, ids, dx, dy] of gestures) {
      const drag = sheet(body);
      const preview = new ConnectorPreview(drag.engine.model!, new Set(ids.map((id) => drag.engine.holder(id)!)), (id) => drag.engine.holder(id), estimate);
      // Due fotogrammi prima di quello giusto: la memoria dei contorni non
      // lascia traccia.
      preview.at(translate(dx * 3, dy * 3));
      preview.at(translate(-dx, dy));
      const draft = preview.at(translate(dx, dy));
      const done = sheet(body);
      applied(done, { op: "batch", ops: ids.map((id) => ({ op: "set", id, attrs: { transform: `translate(${dx} ${dy})` } })) });
      for (let k = 0; k < 30; k++) {
        const shape = (id: string): boolean => ids.includes(id);
        const line = readConnectorEnds(drag, `c${k}`);
        const follows = shape(line[0]) || shape(line[1]);
        expect(draft.paths.has(`c${k}`), `${name}: c${k}`).toBe(follows);
        if (!follows) {
          expect(attr(done, `c${k}`, "d"), `${name}: c${k} fermo`).toBe(attr(drag, `c${k}`, "d"));
          continue;
        }
        shown++;
        expect(draft.paths.get(`c${k}`), `${name}: c${k}`).toBe(attr(done, `c${k}`, "d"));
        if (k % 2 === 0) expect(draft.transforms.get(`t${k}`), `${name}: t${k}`).toBe(attr(done, `t${k}`, "transform"));
      }
    }
    expect(shown).toBeGreaterThan(50);
  });

  /// Gli id degli oggetti a cui `id` è agganciato.
  function readConnectorEnds(opened: Opened, id: string): [string, string] {
    const [from, to] = ["from", "to"].map((end) => attr(opened, id, `fub:${end}`)!.split(" ")[0]!);
    return [from!, to!];
  }

  it("un connettore che non si inverte non rompe il fotogramma, e la sua etichetta resta dov'è", () => {
    const label = '<text id="t" fub:along="c 0.5 4" x="0" y="0" text-anchor="middle"><tspan x="0" dy="0">sì</tspan></text>';
    const opened = sheet(`${A}${B}${LINE("elbow", "a auto", "b auto", ' transform="scale(0)"')}${label}`);
    const preview = new ConnectorPreview(opened.engine.model!, new Set([opened.engine.holder("b")!]), (id) => opened.engine.holder(id), estimate);
    const draft = preview.at(translate(0, 100));
    expect(draft.paths.has("c")).toBe(false);
    expect(draft.transforms.has("t")).toBe(false);
  });

  it("un contorno si ricalcola soltanto se la matrice è cambiata", () => {
    const opened = sheet(`${A}${B}`);
    const a = opened.engine.holder("a")!;
    let shift: [number, number, number, number, number, number] | null = null;
    const router = new Router(estimate);
    router.shift = () => shift;
    const first = router.outline(a)!;
    expect(router.outline(a)).toBe(first);
    shift = [1, 0, 0, 1, 10, 5];
    const moved = router.outline(a)!;
    expect(moved).not.toBe(first);
    expect(router.outline(a)).toBe(moved);
    expect(moved.centre).toEqual([first.centre[0] + 10, first.centre[1] + 5]);
    // Tornata dov'era, è quella di chi la legge da capo.
    shift = null;
    expect(router.outline(a)).toEqual(new Router(estimate).outline(a));
    expect(router.outline(opened.engine.holder("b")!)).toBe(router.outline(opened.engine.holder("b")!));
  });

  it("i punti si arrotondano come si scrivono e si rileggono", () => {
    let seed = 7;
    const random = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 20000; i++) {
      const value = (random() - 0.5) * 10 ** Math.floor(random() * 7);
      const read = readConnectorGeom(writeConnectorGeom({ kind: "straight", points: [[value, -value], [value / 3, value * 1.005]] }))!;
      expect(roundHalfUp(value, 100) / 100, `${value}`).toBe(read.points[0]![0]);
      expect(roundHalfUp(-value, 100) / 100, `${-value}`).toBe(read.points[0]![1]);
      expect(roundHalfUp(value / 3, 100) / 100, `${value / 3}`).toBe(read.points[1]![0]);
      expect(roundHalfUp(value * 1.005, 100) / 100, `${value * 1.005}`).toBe(read.points[1]![1]);
    }
  });
});

describe("Collega le forme scelte", () => {

  const rect = (id: string | null, x: number, y: number): string =>
    `<rect${id === null ? "" : ` id="${id}"`} x="${x}" y="${y}" width="100" height="60" fill="#e69f00"/>`;

  /// «Collega le forme scelte» su tutti gli oggetti di `body`, applicato.
  function connected(body: string, kind: "straight" | "elbow" | "curved" = "elbow"): { opened: Opened; skipped: number; lines: readonly string[] } | null {
    const opened = sheet(body);
    const ids = new NewIds((id) => opened.engine.holder(id) !== null);
    const to = destination(opened.index, ids)!;
    // Come l'editor: la punta viene dalla raccolta, e si aggiunge prima.
    const shelf = new Shelf(opened.engine.model!, ids);
    const tip = shelf.idFor({ shape: "triangle", size: DEFAULT_TIP_SIZE }, "end", { paint: "#000000", opacity: 1 });
    const made = connectOps(opened.engine.model!, opened.index.units, kind, { paint: "#000000", width: 2, tip }, to, ids, estimate);
    if (made === null) return null;
    if (made.adds.length > 0) applied(opened, [...to.prelude, ...made.idents, ...shelf.ops(), ...made.adds]);
    return { opened, skipped: made.skipped, lines: made.lines };
  }

  it("unisce da sinistra a destra quando gli oggetti sono distesi in larghezza, qualunque sia l'ordine nel file", () => {
    const out = connected(`${rect("c3", 500, 120)}${rect("c1", 100, 100)}${rect("c2", 300, 80)}`)!;
    expect(out.lines).toHaveLength(2);
    const [first, second] = out.lines;
    expect(attr(out.opened, first!, "fub:from")).toBe("c1 auto");
    expect(attr(out.opened, first!, "fub:to")).toBe("c2 auto");
    expect(attr(out.opened, second!, "fub:from")).toBe("c2 auto");
    expect(attr(out.opened, second!, "fub:to")).toBe("c3 auto");
    expect(attr(out.opened, first!, "marker-end")).toMatch(/^url\(#r[a-z0-9]+\)$/);
    expect(attr(out.opened, first!, "fill")).toBe("none");
  });

  it("unisce dall'alto in basso quando sono distesi in altezza", () => {
    const out = connected(`${rect("b", 120, 300)}${rect("c", 80, 500)}${rect("a", 100, 100)}`)!;
    expect(out.lines.map((id) => [attr(out.opened, id, "fub:from"), attr(out.opened, id, "fub:to")])).toEqual([
      ["a auto", "b auto"],
      ["b auto", "c auto"],
    ]);
  });

  it("il capo tocca il lato rivolto verso l'altro oggetto", () => {
    const out = connected(`${rect("a", 100, 100)}${rect("b", 300, 100)}`, "straight")!;
    const geom = points(out.opened, out.lines[0]!);
    expect(geom[0]).toEqual([200, 130]);
    expect(geom[geom.length - 1]).toEqual([300, 130]);
  });

  it("non unisce di nuovo due oggetti già uniti, in un verso o nell'altro", () => {
    const back = '<path id="k" fub:shape="connector" fub:geom="straight 300 130 200 130" fub:from="b auto" fub:to="a auto" d="M300 130 L200 130" fill="none" stroke="#000000"/>';
    const out = connected(`${rect("a", 100, 100)}${rect("b", 300, 100)}${rect("c", 500, 100)}${back}`)!;
    expect(out.skipped).toBe(1);
    expect(out.lines).toHaveLength(1);
    expect(attr(out.opened, out.lines[0]!, "fub:from")).toBe("b auto");
    expect(attr(out.opened, out.lines[0]!, "fub:to")).toBe("c auto");
  });

  it("dice quando non c'è niente di nuovo da unire", () => {
    const back = '<path id="k" fub:shape="connector" fub:geom="straight 200 130 300 130" fub:from="a auto" fub:to="b auto" d="M200 130 L300 130" fill="none" stroke="#000000"/>';
    const out = connected(`${rect("a", 100, 100)}${rect("b", 300, 100)}${back}`)!;
    expect(out.lines).toEqual([]);
    expect(out.skipped).toBe(1);
  });

  it("vuole almeno due oggetti a cui agganciarsi: i connettori non contano", () => {
    const line = '<path id="k" fub:shape="connector" fub:geom="straight 0 0 10 10" d="M0 0 L10 10" fill="none" stroke="#000000"/>';
    expect(connected(`${rect("a", 100, 100)}${line}`)).toBeNull();
    expect(connected("")).toBeNull();
  });

  it("dà un id all'oggetto che non lo ha, nello stesso passo", () => {
    const out = connected(`${rect("a", 100, 100)}${rect(null, 300, 100)}`)!;
    const to = attr(out.opened, out.lines[0]!, "fub:to")!;
    const [id, anchor] = to.split(" ");
    expect(anchor).toBe("auto");
    expect(out.opened.engine.text).toContain(`<rect id="${id}" x="300"`);
  });
});

describe("le etichette che vanno col loro connettore", () => {
  const LABEL = (id: string, line: string): string =>
    `<text id="${id}" fub:along="${line} 0.5 4" x="0" y="0" text-anchor="middle" transform="matrix(1 0 0 1 400 302)"><tspan x="0" dy="0">sì</tspan></text>`;

  it("sono quelle dei connettori dati, e non quelle degli altri", () => {
    const opened = sheet(`${A}${B}${LINE()}${LABEL("e1", "c")}${LABEL("e2", "altro")}`);
    const model = opened.engine.model!;
    expect(labelsOf(model, [opened.engine.holder("c")!]).map((node) => node.facts.id)).toEqual(["e1"]);
    expect(labelsOf(model, [opened.engine.holder("a")!])).toEqual([]);
  });

  it("valgono anche per un connettore dentro un gruppo, se l'etichetta sta fuori", () => {
    const opened = sheet(`${A}${B}<g id="g">${LINE()}</g>${LABEL("e1", "c")}`);
    expect(labelsOf(opened.engine.model!, [opened.engine.holder("g")!]).map((node) => node.facts.id)).toEqual(["e1"]);
  });

  it("non ripetono un'etichetta che sta già fra gli oggetti dati", () => {
    const opened = sheet(`${A}${B}<g id="g">${LINE()}${LABEL("e1", "c")}</g>`);
    expect(labelsOf(opened.engine.model!, [opened.engine.holder("g")!])).toEqual([]);
  });
});
