// L'indice degli oggetti, ciò che c'è dentro: le punte delle linee, i testi,
// i blocchi estranei, le istanze dei simboli, le copie delle ripetizioni, le
// pagine di un PDF e l'evidenziatore. I documenti sono scene vere.

import { describe, expect, it } from "vitest";
import { PF1_DEFAULTS } from "../../../ink/brush";
import { quantizeInk, type InkSample } from "../../../ink/sample";
import { IDENTITY } from "../scene/matrix";
import { doc } from "../scene/test-support";
import { strokeElem } from "./edit";
import { PaintBuilder } from "../painter/paint";
import { SceneEngine } from "../scene/engine";
import { elementChildren, type ContainerNode, type LeafNode } from "../scene/model";
import { elemBounds, SceneIndexer } from "./hit";
import { LAYER, open } from "./test-support";
import { box, container } from "./hit/test-support";

describe("le punte delle linee", () => {
  /// Un triangolo col vertice sul punto di riferimento: largo 4 e lungo 4
  /// volte il contorno, girato col tracciato e al contrario all'inizio.
  const ARROW = '<marker id="m" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">'
    + '<path d="M0 0 L10 5 L0 10 Z" fill="#000000"/></marker>';
  const tipped = (defs: string, body: string) => open(doc(`<defs id="fub-defs">${defs}</defs>${LAYER}${body}</g>`));

  it("si toccano e stanno nel riquadro col contorno, ma non nella geometria", () => {
    const opened = tipped(ARROW, '<line id="a" x1="10" y1="50" x2="60" y2="50" stroke="#000000" stroke-width="2" marker-end="url(#m)"/>');
    const line = opened.index.get("a")!;
    // La punta va da x 52 a 60, alta da 46 a 54: fuori dal contorno della linea.
    expect(line.hits([54, 47.5], 0)).toBe(true);
    expect(line.hits([54, 46.5], 0)).toBe(false);
    expect(line.touches([55, 40], [55, 48], 0)).toBe(true);
    expect(line.bounds).toEqual({ min: [9, 46], max: [61, 54] });
    expect(line.frame()).toEqual({ min: [9, 46], max: [61, 54] });
    expect(opened.extent()).toEqual({ min: [9, 46], max: [61, 54] });
    expect(line.geometry).toEqual({ min: [10, 50], max: [60, 50] });
    expect(line.shapeFrame()).toEqual({ min: [10, 50], max: [60, 50] });
    // La punta non è una forma della linea, e il suo riempimento non è il suo.
    expect(line.shapes().map((shape) => shape.leaf.facts.id)).toEqual(["a"]);
    expect(line.filled).toBe(false);
  });

  it("si vedono come il contorno della linea che le porta", () => {
    const opened = tipped(ARROW, '<line id="a" x1="10" y1="50" x2="60" y2="50" stroke="#000000" stroke-width="2" marker-end="url(#m)"/>');
    const sampled = opened.index.get("a")!.sampleAt([54, 47.5], 0)!;
    expect([sampled.leaf.facts.id, sampled.on, sampled.matrix, sampled.segments.length]).toEqual(["a", "stroke", [1, 0, 0, 1, 0, 0], 2]);
  });

  it("si girano col tracciato, e all'inizio al contrario con auto-start-reverse", () => {
    const opened = tipped(ARROW, '<path id="v" d="M50 10 V60" fill="none" stroke="#000000" stroke-width="2" marker-start="url(#m)"/>');
    const path = opened.index.get("v")!;
    // All'inizio la punta guarda in su: sta da y 10 a 18, non sopra.
    expect(path.hits([51.5, 14], 0)).toBe(true);
    expect(path.hits([51.5, 6], 0)).toBe(false);
    expect(path.bounds).toEqual({ min: [46, 9], max: [54, 61] });
  });

  it("crescono col contorno che la linea eredita, e nella cornice seguono la sua trasformazione", () => {
    const opened = tipped(ARROW, '<g id="g" stroke-width="4"><line x1="10" y1="50" x2="60" y2="50" stroke="#000000" marker-end="url(#m)"/></g>'
      + '<line id="t" x1="10" y1="50" x2="60" y2="50" stroke="#000000" stroke-width="2" transform="translate(0 100)" marker-end="url(#m)"/>');
    expect(opened.index.get("g")!.bounds).toEqual({ min: [8, 42], max: [62, 58] });
    const moved = opened.index.get("t")!;
    expect(moved.frame()).toEqual({ min: [9, 46], max: [61, 54] });
    expect(moved.bounds).toEqual({ min: [9, 146], max: [61, 154] });
  });

  it("restano dentro la finestra del marcatore, che taglia il contenuto che ne esce", () => {
    const opened = tipped(
      '<marker id="o" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" markerUnits="userSpaceOnUse"><circle cx="5" cy="5" r="10" fill="#000000"/></marker>',
      '<line id="a" x1="10" y1="50" x2="60" y2="50" stroke="#000000" stroke-width="2" marker-end="url(#o)"/>',
    );
    // Il cerchio sarebbe largo 12; se ne vede il quadrato di 6 della finestra.
    expect(opened.index.get("a")!.bounds).toEqual({ min: [9, 47], max: [63, 53] });
  });

  it("stanno nel riquadro di una forma che uno strumento sta per scrivere al posto di una linea", () => {
    const source = doc(`<defs id="fub-defs">${ARROW}</defs>${LAYER}<line id="a" x1="10" y1="50" x2="60" y2="50" stroke="#000000" stroke-width="2" marker-end="url(#m)"/></g>`);
    const engine = SceneEngine.open(source);
    const builder = new PaintBuilder();
    builder.build(engine);
    const indexer = new SceneIndexer(builder, (id) => engine.holder(id));
    const leaf = engine.holder("a") as LeafNode;
    // I nodi la portano a 80: la punta con lei, fino a 81 col contorno.
    const after = { tag: "path", attrs: { id: "a", d: "M10 50 L80 50", fill: "none", stroke: "#000000", "stroke-width": "2", "marker-end": "url(#m)" } };
    expect(elemBounds(after, IDENTITY)).toEqual({ min: [9, 49], max: [81, 51] });
    expect(indexer.writtenBounds(after, IDENTITY, leaf)).toEqual({ min: [9, 46], max: [81, 54] });
    // Senza punte, o con una che non c'è, è il riquadro di prima.
    const bare = { d: "M10 50 L80 50", fill: "none", stroke: "#000000", "stroke-width": "2" };
    expect(indexer.writtenBounds({ tag: "path", attrs: bare }, IDENTITY, leaf)).toEqual({ min: [9, 49], max: [81, 51] });
    expect(indexer.writtenBounds({ tag: "path", attrs: { ...after.attrs, "marker-end": "url(#nessuno)" } }, IDENTITY, leaf)).toEqual({ min: [9, 49], max: [81, 51] });
  });

  it("non contano se il marcatore non disegna niente", () => {
    const opened = tipped(
      '<marker id="vuoto" markerWidth="0"><path d="M0 0 L10 5 L0 10 Z"/></marker>',
      '<line id="a" x1="10" y1="50" x2="60" y2="50" stroke="#000000" stroke-width="2" marker-end="url(#vuoto)"/>',
    );
    expect(opened.index.get("a")!.bounds).toEqual({ min: [9, 49], max: [61, 51] });
  });
});

describe("come si vede un testo", () => {
  const TEXTS = doc(
    `${LAYER}<text id="t" x="10" y="40" fill="#0072b2" font-family="Inter, sans-serif" font-size="20"><tspan x="10" dy="0">Ciao</tspan><tspan x="10" dy="30">a te</tspan></text>`
      + '<g id="g"><text id="dentro" x="0" y="0"><tspan x="0" dy="0">no</tspan></text></g></g>'
      + '<g id="l2" fub:layer="Stile" font-size="12" font-weight="700" fill="#d55e00" text-anchor="middle">'
      + '<text id="n" x="50" y="80" transform="rotate(90 50 80)"><tspan x="50" dy="0">x</tspan></text></g>',
  );

  it("sa dove comincia la prima riga, il corpo, il passo e lo stile che eredita", () => {
    const { index } = open(TEXTS);
    expect(index.get("t")?.look).toEqual({ x: 10, y: 40, size: 20, leading: 30, anchor: "start", family: "Inter, sans-serif", weight: null, color: "#0072b2", wrap: null, along: null });
    // Con una riga sola, il passo è quello che l'operazione `text` darà alla
    // seconda.
    expect(index.get("n")?.look).toEqual({ x: 50, y: 80, size: 12, leading: 15, anchor: "middle", family: null, weight: "700", color: "#d55e00", wrap: null, along: null });
    // Un gruppo si sceglie intero: il testo dentro non si cambia sul posto.
    expect(index.get("g")?.look).toBeNull();
  });

});

describe("il testo in area e su tracciato", () => {
  const FORMS = doc(
    '<defs id="fub-defs"><path id="r1" fub:role="private" d="M 0 100 L 200 100"/><path id="r2" fub:role="private" d="M 100 0 L 100 200"/></defs>'
      + `${LAYER}<text id="a" fub:wrap="100" x="10" y="20" font-size="10"><tspan x="10" dy="0">Il testo</tspan><tspan x="10" dy="12.5" fub:join="space">in area</tspan></text>`
      + '<text id="p" font-size="10" text-anchor="middle"><textPath href="#r1" startOffset="25%">abcdefghij</textPath></text>'
      + "</g>",
  );



  it("le lettere che cadono fuori dal tracciato non si toccano", () => {
    const { index } = open(FORMS.replace('startOffset="25%"', 'startOffset="195"'));
    const path = index.get("p")!;
    // Da 165 a 225: la lettera da 195 a 201 ha il centro sul tracciato, le
    // altre dopo no.
    expect(path.bounds!.max[0]).toBeCloseTo(201, 6);
  });
});

describe("un blocco estraneo dentro un oggetto", () => {
  // Un `class` o uno `style` fanno di un elemento un blocco estraneo.
  const FOREIGN = doc(
    `${LAYER}<g id="w">`
      + '<rect class="a" x="10" y="10" width="20" height="10"/>'
      + '<path style="fill: none; stroke: #000000; stroke-width: 4 !important" d="M 40 10 L 80 10"/>'
      + '<g class="b" transform="translate(0 50)"><circle cx="5" cy="5" r="5"/></g>'
      + '</g><rect class="sciolto" x="200" y="200" width="10" height="10"/></g>',
  );

  it("conta nella geometria dell'oggetto, ma da solo non è un oggetto", () => {
    const { index } = open(FOREIGN);
    expect(index.units.map((unit) => unit.key)).toEqual(["w"]);
    // Il tracciato senza riempimento conta col suo contorno, come lo dice lo
    // `style`.
    expect(index.get("w")?.bounds).toEqual({ min: [0, 8], max: [82, 60] });
    expect(index.get("w")?.geometry).toEqual({ min: [0, 10], max: [80, 60] });
  });

  it("si tocca dove si dipinge", () => {
    const { index } = open(FOREIGN);
    for (const p of [[20, 15], [60, 11], [5, 55]] as const) expect(index.at(p, 0.5)?.key).toBe("w");
    for (const p of [[60, 15], [35, 40]] as const) expect(index.at(p, 0.5)).toBeNull();
    // Il pezzo toccato non è un tracciato da modificare.
    expect(index.get("w")!.shapeAt([20, 15], 0.5)?.details).toBeNull();
  });

  it("dà al riquadro di tutto il disegno anche quando sta da solo", () => {
    expect(open(FOREIGN).extent()).toEqual({ min: [0, 8], max: [210, 210] });
  });

  it("non conta ciò che è nascosto, ma un figlio può tornare visibile", () => {
    const { index } = open(doc(
      `${LAYER}<g id="v">`
        + '<rect class="x" x="0" y="0" width="10" height="10" visibility="hidden"/>'
        + '<g class="y" style="visibility: hidden"><rect x="20" y="0" width="5" height="5" visibility="visible"/><rect x="0" y="40" width="5" height="5"/></g>'
        + '<rect class="z" x="100" y="100" width="5" height="5" style="display:none"/>'
        + '<g class="nulla"><rect x="0" y="80" width="5" height="5" fill="none"/></g>'
        + '</g></g>',
    ));
    expect(index.get("v")?.bounds).toEqual({ min: [20, 0], max: [25, 5] });
  });

  it("dà il riquadro di testi, immagini e documenti annidati", () => {
    const { index } = open(doc(
      `${LAYER}<g id="t"><text class="c" x="10" y="20" font-size="10">Ciao</text></g>`
        + '<g id="righe"><text class="c" style="font-size: 10px"><tspan x="0" y="10">ab</tspan><tspan x="0" y="30">abcd</tspan></text></g>'
        + '<g id="b"><foreignObject x="0" y="0" width="10" height="10"/><svg x="20" y="0" width="5" height="5"><rect width="100" height="100"/></svg></g>'
        + '</g>',
    ));
    // 0,6 em per carattere, da 0,8 em sopra la linea di base a 0,25 sotto.
    expect(index.get("t")?.bounds).toEqual({ min: [10, 12], max: [34, 22.5] });
    expect(index.get("righe")?.bounds).toEqual({ min: [0, 2], max: [24, 32.5] });
    expect(index.get("b")?.bounds).toEqual({ min: [0, 0], max: [25, 10] });
  });

  it("allarga le righe con la spaziatura delle lettere e coi pezzi, ciascuno col suo corpo", () => {
    const { index } = open(doc(
      `${LAYER}<text id="p" x="0" y="20" font-size="10" letter-spacing="1">`
        + '<tspan x="0" dy="0">ab<tspan font-size="20" letter-spacing="0">cd</tspan></tspan>'
        + '<tspan x="0" dy="30" letter-spacing="-1">ef</tspan></text></g>',
    ));
    // «ab» 2 × (6 + 1), «cd» 2 × 12 e la riga alta quanto il pezzo più
    // grande; «ef» 2 × (6 − 1).
    expect(index.get("p")?.bounds).toEqual({ min: [0, 4], max: [38, 52.5] });
  });

  it("segue un `use` fino al simbolo, anche in un altro blocco, e se ne accorge quando cambia", () => {
    const opened = open(doc(
      `${LAYER}<g id="u"><defs id="d"><symbol id="s" viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10"/></symbol></defs>`
        + '<use href="#s" x="5" y="5" width="40" height="20"/></g>'
        + '<g id="x"><use xlink:href="#s" transform="translate(100 0)"/><use href="https://example.com/a.svg#s"/></g></g>',
    ));
    // Il `viewBox` sta intero nel riquadro, al centro.
    expect(opened.index.get("u")?.bounds).toEqual({ min: [15, 5], max: [35, 25] });
    // Senza misure, il simbolo resta com'è; una risorsa esterna non si legge.
    expect(opened.index.get("x")?.bounds).toEqual({ min: [100, 0], max: [110, 10] });
    expect(opened.engine.apply({ op: "remove", target: "d" }).outcome).toBe("applied");
    const index = opened.reindex();
    expect(index.get("u")?.bounds).toBeNull();
    expect(index.get("x")?.bounds).toBeNull();
  });

  it("con tante forme conta come il suo riquadro", () => {
    const rects = Array.from({ length: 3000 }, (_, i) => `<rect x="${i % 100}" y="${Math.floor(i / 100)}" width="0.5" height="0.5"/>`).join("");
    const { index } = open(doc(`${LAYER}<g id="m"><g class="tanti">${rects}</g></g></g>`));
    const unit = index.get("m")!;
    expect(unit.shapes()).toHaveLength(1);
    expect(unit.bounds).toEqual({ min: [0, 0], max: [99.5, 29.5] });
    expect(unit.hits([50.75, 10.75], 0)).toBe(true);
  });

  it("si sposta con l'oggetto", () => {
    const opened = open(FOREIGN);
    expect(opened.engine.apply({ op: "set", id: "w", attrs: { transform: "matrix(1 0 0 1 100 0)" } }).outcome).toBe("applied");
    const index = opened.reindex();
    expect(index.get("w")?.bounds).toEqual({ min: [100, 8], max: [182, 60] });
    expect(index.at([120, 15], 0.5)?.key).toBe("w");
  });
});

describe("le istanze dei simboli", () => {
  const SYMBOLS = doc(
    '<defs id="fub-defs"><symbol id="r1" overflow="visible"><title>Presa</title><rect id="o1" x="0" y="0" width="10" height="10"/>'
      + '<g id="og" transform="translate(20 0)"><circle id="o2" cx="0" cy="5" r="5"/></g></symbol>'
      + '<symbol id="r2" overflow="visible"><use id="o3" href="#r1"/><rect id="o4" x="0" y="20" width="5" height="5"/>'
      + '<a id="o5" href="uno.md"><rect x="40" y="0" width="5" height="5"/></a></symbol></defs>'
      + `${LAYER}<use id="i1" transform="translate(100 0)" href="#r1"/><use id="i2" transform="matrix(2 0 0 2 0 100)" href="#r1"/>`
      + '<g id="g" transform="translate(200 200)"><use id="i3" href="#r2"/></g><use id="i4" href="#r1" display="none"/></g>',
  );
  const leaf = (opened: ReturnType<typeof open>, id: string): LeafNode => opened.engine.holder(id) as LeafNode;

  it("si toccano dove si vede il contenuto del simbolo, portato dalla loro trasformazione", () => {
    const { index } = open(SYMBOLS);
    expect(index.units.map((unit) => unit.key)).toEqual(["i1", "i2", "g"]);
    expect(index.get("i1")?.bounds).toEqual({ min: [100, 0], max: [125, 10] });
    expect(index.get("i2")?.bounds).toEqual({ min: [0, 100], max: [50, 120] });
    expect(index.at([105, 5], 0)?.key).toBe("i1");
    expect(index.at([119, 5], 0)?.key).toBe("i1");
    // Fra il quadrato e il cerchio non c'è niente.
    expect(index.at([113, 5], 0)).toBeNull();
    expect(index.at([10, 110], 0)?.key).toBe("i2");
    expect(index.at([42, 108], 0)?.key).toBe("i2");
  });

  it("anche attraverso le istanze del contenuto", () => {
    const { index } = open(SYMBOLS);
    const g = index.get("g")!;
    expect(index.deepAt([205, 205], 0)?.key).toBe("i3");
    expect(index.deepAt([202, 222], 0)?.key).toBe("i3");
    expect(g.bounds).toEqual({ min: [200, 200], max: [245, 225] });
    // Il contenuto non si sceglie da fuori.
    expect(index.children(g).map((unit) => unit.key)).toEqual(["i3"]);
    for (const key of ["o1", "og", "o2", "o3", "o4", "r1"]) expect(index.get(key), key).toBeNull();
  });

  it("per chi cambia una forma sono una forma sola, ma si vede che cosa c'è sotto il punto", () => {
    const opened = open(SYMBOLS);
    const i3 = opened.index.get("i3")!;
    expect(i3.shapes().map(({ leaf, matrix }) => [leaf.facts.id, matrix])).toEqual([["i3", [1, 0, 0, 1, 200, 200]]]);
    expect(i3.shapeAt([205, 205], 0)?.facts.id).toBe("i3");
    expect(i3.shapeAt([215, 215], 0)).toBeNull();
    expect(i3.sampleAt([205, 205], 0)?.leaf.facts.id).toBe("o1");
    expect(i3.sampleAt([220, 205], 0)?.matrix).toEqual([1, 0, 0, 1, 220, 200]);
  });

  it("seguono il simbolo quando cambia", () => {
    const opened = open(SYMBOLS);
    expect(opened.engine.apply({ op: "set", id: "o1", attrs: { width: "30" } }).outcome).toBe("applied");
    let index = opened.reindex();
    expect(index.get("i1")?.bounds).toEqual({ min: [100, 0], max: [130, 10] });
    expect(index.get("g")?.bounds).toEqual({ min: [200, 200], max: [245, 225] });
    expect(opened.engine.apply({ op: "set", id: "o1", attrs: { width: "60" } }).outcome).toBe("applied");
    index = opened.reindex();
    expect(index.get("g")?.bounds).toEqual({ min: [200, 200], max: [260, 225] });
    // Anche la miniatura, attraverso un altro simbolo.
    expect(opened.frame("i3")).toEqual({ min: [200, 200], max: [260, 225] });
  });

  it("con troppe forme, un'istanza si tocca nel riquadro del suo simbolo", () => {
    const rects = Array.from({ length: 70 }, (_, i) => `<rect x="${2 * i}" y="0" width="1" height="1"/>`).join("");
    const rows = Array.from({ length: 70 }, (_, i) => `<use href="#r5" transform="translate(0 ${2 * i})"/>`).join("");
    const { index } = open(doc(
      `<defs id="fub-defs"><symbol id="r5" overflow="visible">${rects}</symbol><symbol id="r6" overflow="visible">${rows}</symbol></defs>`
        + `${LAYER}<use id="i" href="#r6"/></g>`,
    ));
    const unit = index.get("i")!;
    expect(unit.bounds).toEqual({ min: [0, 0], max: [139, 139] });
    // Le prime righe si toccano dove disegnano, le ultime nel loro riquadro.
    expect(unit.hits([0.5, 0.5], 0)).toBe(true);
    expect(unit.hits([1.5, 0.5], 0)).toBe(false);
    expect(unit.hits([1.5, 138.5], 0)).toBe(true);
    expect(unit.hits([1.5, 137.5], 0)).toBe(false);
  });

  it("isolato un simbolo da un'istanza, il contenuto si sceglie dov'è in lei", () => {
    const opened = open(SYMBOLS);
    const i1 = leaf(opened, "i1");
    const r1 = container(opened, "r1");
    expect(opened.opens(r1)).toBe(false);
    expect(opened.opens(r1, [i1])).toBe(true);
    expect(opened.opens(r1, [leaf(opened, "i4")])).toBe(false);
    const index = opened.reindex(r1, [i1]);
    expect(index.units.map((unit) => [unit.key, unit.bounds])).toEqual([
      ["o1", { min: [100, 0], max: [110, 10] }],
      ["og", { min: [115, 0], max: [125, 10] }],
    ]);
    expect(index.units[0]!.path).toEqual([0, 0, 1]);
    expect(index.get("o2")?.bounds).toEqual({ min: [115, 0], max: [125, 10] });
    expect(index.get("i1")).toBeNull();
    expect(index.at([105, 5], 0)?.key).toBe("o1");
    // Il simbolo, come oggetto, riceve ciò che si disegna nelle coordinate
    // dell'istanza.
    const scope = index.scope()!;
    expect([scope.key, scope.role, scope.matrix]).toEqual(["r1", "symbol", [1, 0, 0, 1, 100, 0]]);
    // Da un'altra istanza, il contenuto sta in lei.
    expect(opened.reindex(r1, [leaf(opened, "i2")]).get("o1")?.bounds).toEqual({ min: [0, 100], max: [20, 120] });
    // Un gruppo del contenuto si isola anche lui, dalla stessa istanza.
    expect(opened.opens(container(opened, "og"), [i1])).toBe(true);
    expect(opened.reindex(container(opened, "og"), [i1]).units.map((unit) => [unit.key, unit.bounds])).toEqual([["o2", { min: [115, 0], max: [125, 10] }]]);
    expect(opened.reindex(container(opened, "og"), [i1]).scope()?.matrix).toEqual([1, 0, 0, 1, 120, 0]);
  });

  it("isolato un simbolo dentro un altro, il contenuto passa da tutte e due le istanze", () => {
    const opened = open(SYMBOLS);
    const through = [leaf(opened, "i3"), leaf(opened, "o3")];
    const index = opened.reindex(container(opened, "r1"), through);
    expect(index.get("o1")?.bounds).toEqual({ min: [200, 200], max: [210, 210] });
    expect(opened.opens(container(opened, "r1"), [leaf(opened, "o3")])).toBe(false);
    // Bloccata l'istanza, non si entra più.
    expect(opened.engine.apply({ op: "set", id: "i3", attrs: { "fub:locked": "true" } }).outcome).toBe("applied");
    expect(opened.opens(container(opened, "r2"), [leaf(opened, "i3")])).toBe(false);
  });

  it("le guide vedono il contenuto del simbolo che si modifica, e i collegamenti si aprono da ogni istanza", () => {
    const opened = open(SYMBOLS);
    const i1 = leaf(opened, "i1");
    expect(opened.seen(new Set(), [i1]).map((unit) => unit.key)).toEqual(["o1", "og", "i2", "g"]);
    expect(opened.links().map((unit) => [unit.key, unit.bounds])).toEqual([["o5", { min: [240, 200], max: [245, 205] }]]);
  });
});

describe("le copie delle ripetizioni", () => {
  const REPEATS = doc(
    `${LAYER}<g id="p1" fub:repeat="grid 3 1 20 0"><rect id="a" x="0" y="0" width="10" height="10"/>`
      + '<use id="c1" transform="translate(20 0)" href="#a"/><use id="c2" transform="translate(40 0)" href="#a"/></g>'
      + '<g id="p2" transform="translate(0 100)" fub:repeat="radial 4 0 0"><g id="o"><rect id="b" x="10" y="-2" width="20" height="4"/></g>'
      + '<use id="c3" transform="matrix(0 1 -1 0 0 0)" href="#o"/></g></g>',
  );

  it("si toccano dove si vede l'originale, portato dalla loro trasformazione", () => {
    const opened = open(REPEATS);
    const { index } = opened;
    expect(index.units.map((unit) => unit.key)).toEqual(["p1", "p2"]);
    expect(index.get("p1")?.bounds).toEqual(box(0, 0, 50, 10));
    expect(index.get("p2")?.bounds).toEqual(box(-2, 98, 30, 130));
    expect(index.at([25, 5], 0)?.key).toBe("p1");
    expect(index.at([45, 5], 0)?.key).toBe("p1");
    // Fra l'originale e la prima copia non c'è niente.
    expect(index.at([15, 5], 0)).toBeNull();
    expect(index.at([0, 120], 0)?.key).toBe("p2");
    expect(index.along([15, 5], [25, 5], 0).map((unit) => unit.key)).toEqual(["p1"]);
    expect(opened.frame("p1")).toEqual(box(0, 0, 50, 10));
    expect(opened.extent()).toEqual(box(-2, 0, 50, 130));
  });

  it("per chi cambia una forma una copia è una forma sola, ma si vede che cosa c'è sotto il punto", () => {
    const p1 = open(REPEATS).index.get("p1")!;
    expect(p1.shapes().map(({ leaf, matrix }) => [leaf.facts.id, matrix])).toEqual([
      ["a", IDENTITY],
      ["c1", [1, 0, 0, 1, 20, 0]],
      ["c2", [1, 0, 0, 1, 40, 0]],
    ]);
    expect(p1.shapeAt([25, 5], 0)?.facts.id).toBe("c1");
    expect(p1.sampleAt([25, 5], 0)?.leaf.facts.id).toBe("a");
    expect(p1.sampleAt([25, 5], 0)?.matrix).toEqual([1, 0, 0, 1, 20, 0]);
  });

  it("non sono oggetti: nella ripetizione isolata un clic su una copia dà l'originale", () => {
    const opened = open(REPEATS);
    const p1 = opened.index.get("p1")!;
    expect(opened.index.children(p1).map((unit) => unit.key)).toEqual(["a"]);
    expect(opened.index.get("c1")).toBeNull();
    expect(opened.index.deepAt([45, 5], 0)?.key).toBe("a");
    expect(opened.index.deepAt([0, 120], 0)?.key).toBe("o");
    const index = opened.reindex(container(opened, "p1"));
    expect(index.units.map((unit) => unit.key)).toEqual(["a"]);
    expect(index.get("c1")).toBeNull();
    expect(index.at([5, 5], 0)?.key).toBe("a");
    expect(index.at([25, 5], 0)?.key).toBe("a");
    expect(index.at([15, 5], 0)).toBeNull();
    expect(index.within(box(18, -1, 32, 11))).toEqual([]);
    // Le guide vedono l'originale, non le copie che lo seguono.
    expect(opened.seen(new Set([container(opened, "p1")])).map((unit) => unit.key)).toEqual(["a", "p2"]);
  });

  it("un originale nascosto nasconde le copie, e uno che cambia le cambia", () => {
    const opened = open(REPEATS);
    expect(opened.engine.apply({ op: "set", id: "a", attrs: { width: "15" } }).outcome).toBe("applied");
    expect(opened.reindex().get("p1")?.bounds).toEqual(box(0, 0, 55, 10));
    expect(opened.engine.apply({ op: "set", id: "a", attrs: { display: "none" } }).outcome).toBe("applied");
    const index = opened.reindex();
    expect(index.get("p1")?.bounds).toBeNull();
    expect(index.at([25, 5], 0)).toBeNull();
  });

  it("con troppe forme, una copia si tocca nel riquadro dell'originale", () => {
    const rects = Array.from({ length: 70 }, (_, i) => `<rect x="${2 * i}" y="0" width="1" height="1"/>`).join("");
    const copies = Array.from({ length: 69 }, (_, i) => `<use id="c${i}" transform="translate(0 ${2 * (i + 1)})" href="#o"/>`).join("");
    const { index } = open(doc(`${LAYER}<g id="p" fub:repeat="grid 1 70 0 2"><g id="o">${rects}</g>${copies}</g></g>`));
    const unit = index.get("p")!;
    expect(unit.bounds).toEqual(box(0, 0, 139, 139));
    expect(unit.hits([0.5, 0.5], 0)).toBe(true);
    expect(unit.hits([1.5, 0.5], 0)).toBe(false);
    expect(unit.hits([1.5, 138.5], 0)).toBe(true);
    expect(unit.hits([1.5, 137.5], 0)).toBe(false);
  });

  it("un ritaglio con objectBoundingBox prende la scatola delle copie", () => {
    const { index } = open(doc(
      '<defs id="fub-defs"><clipPath id="k" fub:role="private" clipPathUnits="objectBoundingBox"><rect x="0" y="0" width="0.5" height="1"/></clipPath></defs>'
        + `${LAYER}<g id="p1" fub:repeat="grid 3 1 20 0" clip-path="url(#k)"><rect id="a" x="0" y="0" width="10" height="10"/>`
        + '<use id="c1" transform="translate(20 0)" href="#a"/><use id="c2" transform="translate(40 0)" href="#a"/></g></g>',
    ));
    expect(index.get("p1")?.bounds).toEqual(box(0, 0, 25, 10));
    expect(index.at([22, 5], 0)?.key).toBe("p1");
    expect(index.at([45, 5], 0)).toBeNull();
  });
});

describe("sulle pagine di un PDF", () => {
  it("gli oggetti sono solo quelli dei gruppi della pagina, trattati come livelli", () => {
    const engine = SceneEngine.open(
      doc('<g id="p0001" fub:page="1"><rect id="a" x="0" y="0" width="5" height="5"/></g><g id="p0002" fub:page="2"><rect id="b" x="0" y="0" width="5" height="5"/><rect x="9" y="9" width="5" height="5"/></g><rect id="c" x="0" y="0" width="5" height="5"/>'),
    );
    const builder = new PaintBuilder();
    builder.build(engine);
    const pages = elementChildren(engine.model!.root).filter((child): child is ContainerNode => child.kind === "container");
    const index = new SceneIndexer(builder, null, () => [pages[1]!]).index(engine.model!);
    expect(index.units.map((unit) => [unit.key, unit.layer])).toEqual([["b", "p0002"], ["@1.1", "p0002"]]);
    expect(index.layers.map((layer) => [layer.id, layer.path, layer.locked, layer.hidden])).toEqual([["p0002", [1], false, false]]);
    // Un oggetto di un'altra pagina, o fuori dalle pagine, non si trova.
    expect(index.get("a")).toBeNull();
    expect(index.get("c")).toBeNull();
    expect(new SceneIndexer(builder, null, () => []).index(engine.model!).units).toEqual([]);
  });
});

describe("l'evidenziatore", () => {
  it("scrive il tratto col suo strumento e trasparente, il resto come la penna", () => {
    const samples: InkSample[] = [{ x: 10, y: 50, p: 0.5, t: 0 }, { x: 40, y: 50, p: 0.5, t: 16 }];
    const brush = { ...PF1_DEFAULTS, size: 16, thinning: 0 };
    const pen = strokeElem("o1", "#f0e442", brush, quantizeInk(samples), null);
    const marker = strokeElem("o1", "#f0e442", brush, quantizeInk(samples), null, "highlighter");
    expect(pen.attrs["fub:tool"]).toBe("pen");
    expect(pen.attrs["fill-opacity"]).toBeUndefined();
    expect(marker.attrs).toEqual({ ...pen.attrs, "fub:tool": "highlighter", "fill-opacity": "0.5", style: "mix-blend-mode: multiply" });
    expect(Object.keys(marker.attrs)).toEqual(["id", "fub:tool", "fub:brush", "fill", "fill-opacity", "style", "fub:ink"]);
  });
});
