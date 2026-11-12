// L'indice degli oggetti, i ritagli: ciò che si vede e si tocca di un oggetto
// ritagliato, nei contenitori, nei livelli, nelle pagine e con le punte. I
// documenti sono scene vere, aperte dal motore.

import { describe, expect, it } from "vitest";
import { apply, rotate, translate } from "../scene/matrix";
import { doc } from "../scene/test-support";
import { PaintBuilder } from "../painter/paint";
import { SceneEngine } from "../scene/engine";
import type { ContainerNode } from "../scene/model";
import { SceneIndexer } from "./hit";
import { LAYER, open } from "./test-support";
import { box, container } from "./hit/test-support";

describe("ciò che si vede di un oggetto ritagliato", () => {
  const CROP = '<defs id="fub-defs"><clipPath id="r1" fub:role="private"><rect x="20" y="20" width="30" height="30"/></clipPath></defs>';
  const cropped = (attrs = "") => open(doc(`${CROP}${LAYER}<image id="img" x="0" y="0" width="100" height="100" href="foto.png" clip-path="url(#r1)"${attrs}/></g>`));

  it("un'immagine ritagliata ha il riquadro, la geometria e la cornice del ritaglio", () => {
    const img = cropped().index.get("img")!;
    expect(img.bounds).toEqual(box(20, 20, 50, 50));
    expect(img.geometry).toEqual(box(20, 20, 50, 50));
    expect(img.frame()).toEqual(box(20, 20, 50, 50));
    expect(img.shapeFrame()).toEqual(box(20, 20, 50, 50));
    expect(img.clipped).toBe(true);
  });

  it("i clic sulla parte nascosta mancano, quelli sulla parte che si vede colpiscono", () => {
    const { index } = cropped();
    expect(index.at([10, 10], 0)).toBeNull();
    expect(index.at([60, 30], 0)).toBeNull();
    expect(index.at([30, 30], 0)?.key).toBe("img");
    // La tolleranza vale anche per il bordo del ritaglio, non oltre.
    expect(index.at([52, 30], 3)?.key).toBe("img");
    expect(index.at([60, 30], 3)).toBeNull();
    const img = index.get("img")!;
    expect(img.shapeAt([10, 10], 0)).toBeNull();
    expect(img.shapeAt([30, 30], 0)?.facts.id).toBe("img");
    expect(img.sampleAt([10, 10], 0)).toBeNull();
    expect(img.sampleAt([30, 30], 0)?.on).toBe("fill");
  });

  it("ruotata, la cornice è il ritaglio nelle coordinate dell'immagine, e il riquadro quello del ritaglio ruotato", () => {
    const opened = cropped(' transform="rotate(30)"');
    const img = opened.index.get("img")!;
    expect(img.frame()).toEqual(box(20, 20, 50, 50));
    expect(img.shapeFrame()).toEqual(box(20, 20, 50, 50));
    const turned = [[20, 20], [50, 20], [50, 50], [20, 50]].map(([x, y]) => apply(rotate(30), [x!, y!]));
    const xs = turned.map(([x]) => x);
    const ys = turned.map(([, y]) => y);
    const bounds = img.bounds!;
    expect(bounds.min[0]).toBeCloseTo(Math.min(...xs), 9);
    expect(bounds.min[1]).toBeCloseTo(Math.min(...ys), 9);
    expect(bounds.max[0]).toBeCloseTo(Math.max(...xs), 9);
    expect(bounds.max[1]).toBeCloseTo(Math.max(...ys), 9);
    // Il ritaglio gira con l'immagine: il suo centro colpisce, un punto fuori no.
    expect(opened.index.at(apply(rotate(30), [35, 35]), 0)?.key).toBe("img");
    expect(opened.index.at(apply(rotate(30), [10, 10]), 0)).toBeNull();
  });

  it("il riquadro di selezione prende l'oggetto per ciò che si vede", () => {
    const { index } = cropped();
    expect(index.within(box(0, 0, 60, 60)).map((unit) => unit.key)).toEqual(["img"]);
    expect(index.within(box(0, 0, 40, 60))).toEqual([]);
  });

  it("il lazo lo prende se contiene la parte che si vede", () => {
    const { index } = cropped();
    expect(index.inside([[10, 10], [60, 10], [60, 60], [10, 60]]).map((unit) => unit.key)).toEqual(["img"]);
    expect(index.inside([[25, 25], [45, 25], [45, 45], [25, 45]])).toEqual([]);
    // Un lato che attraversa la parte che si vede lo lascia fuori.
    expect(index.inside([[10, 10], [35, 10], [35, 60], [10, 60]])).toEqual([]);
  });

  it("la gomma passa senza toccare sulla parte nascosta", () => {
    const { index } = cropped();
    expect(index.along([0, 0], [10, 10], 1)).toEqual([]);
    expect(index.along([0, 35], [18, 35], 1)).toEqual([]);
    expect(index.along([0, 35], [30, 35], 1).map((unit) => unit.key)).toEqual(["img"]);
    expect(index.along([35, 35], [35, 35], 1).map((unit) => unit.key)).toEqual(["img"]);
    expect(index.along([60, 0], [60, 100], 1)).toEqual([]);
  });

  it("si sposta col suo ritaglio", () => {
    const { index } = cropped(' transform="translate(5 0)"');
    const img = index.get("img")!;
    expect(img.bounds).toEqual(box(25, 20, 55, 50));
    expect(img.boundsAfter(translate(10, 5))).toEqual(box(35, 25, 65, 55));
  });
});

describe("i ritagli dei contenitori", () => {
  const clipped = (defs: string, body: string) => open(doc(`<defs id="fub-defs">${defs}</defs>${body}`));
  const CIRCLE = '<clipPath id="c" fub:role="private"><circle cx="50" cy="50" r="30"/></clipPath>';
  const GROUP = `${LAYER}<g id="grp" clip-path="url(#c)"><image id="im" x="0" y="0" width="60" height="60" href="foto.png"/><rect id="rc" x="70" y="40" width="30" height="20" fill="#cc0000"/></g></g>`;

  it("un gruppo ritagliato ha il riquadro del ritaglio dentro quello del contenuto", () => {
    const grp = clipped(CIRCLE, GROUP).index.get("grp")!;
    expect(grp.bounds).toEqual(box(20, 20, 80, 60));
    expect(grp.geometry).toEqual(box(20, 20, 80, 60));
    expect(grp.frame()).toEqual(box(20, 20, 80, 60));
    expect(grp.clipped).toBe(true);
  });

  it("fuori dal cerchio non si colpisce nemmeno ciò che c'è sotto", () => {
    const { index } = clipped(CIRCLE, GROUP);
    expect(index.at([95, 50], 0)).toBeNull();
    // Dentro il riquadro del cerchio ma fuori dal cerchio, sull'immagine.
    expect(index.at([25, 25], 0)).toBeNull();
    expect(index.at([40, 40], 0)?.key).toBe("grp");
    expect(index.at([75, 50], 0)?.key).toBe("grp");
    expect(index.deepAt([75, 50], 0)?.key).toBe("rc");
  });

  it("il lazo e la gomma guardano la parte che si vede", () => {
    const { index } = clipped(CIRCLE, GROUP);
    expect(index.inside([[15, 15], [85, 15], [85, 65], [15, 65]]).map((unit) => unit.key)).toEqual(["grp"]);
    expect(index.inside([[25, 25], [85, 25], [85, 65], [25, 65]])).toEqual([]);
    expect(index.along([0, 55], [15, 55], 1)).toEqual([]);
    // La gomma scende nel gruppo e prende soltanto il figlio che tocca, nella
    // parte che si vede.
    expect(index.along([0, 55], [25, 55], 1).map((unit) => unit.key)).toEqual(["im"]);
    expect(index.along([85, 55], [100, 55], 1)).toEqual([]);
    expect(index.along([65, 55], [100, 55], 1).map((unit) => unit.key)).toEqual(["rc"]);
    expect(index.along([0, 55], [100, 55], 1).map((unit) => unit.key)).toEqual(["grp"]);
  });

  it("isolato il gruppo, i figli sono ritagliati dal suo cerchio, che non si sposta con loro", () => {
    const opened = clipped(CIRCLE, GROUP);
    const index = opened.reindex(container(opened, "grp"));
    expect(index.units.map((unit) => unit.key)).toEqual(["im", "rc"]);
    const im = index.get("im")!;
    const rc = index.get("rc")!;
    expect(im.bounds).toEqual(box(20, 20, 60, 60));
    expect(im.frame()).toEqual(box(20, 20, 60, 60));
    expect(rc.bounds).toEqual(box(70, 40, 80, 60));
    expect(im.boundsAfter(translate(10, 0))).toEqual(box(20, 20, 70, 60));
    expect(im.boundsAfter(translate(100, 0))).toBeNull();
    expect(index.at([95, 50], 0)).toBeNull();
    expect(index.at([75, 50], 0)?.key).toBe("rc");
    expect(index.at([25, 25], 0)).toBeNull();
    expect(index.along([0, 55], [15, 55], 1)).toEqual([]);
  });

  it("i ritagli di un gruppo dentro un altro si sommano", () => {
    const opened = clipped(
      `${CIRCLE}<clipPath id="q" fub:role="private"><rect x="0" y="0" width="50" height="100"/></clipPath>`,
      `${LAYER}<g id="out" clip-path="url(#q)"><g id="grp" clip-path="url(#c)"><rect id="a" x="0" y="0" width="100" height="100"/></g></g></g>`,
    );
    expect(opened.index.get("out")!.bounds).toEqual(box(20, 20, 50, 80));
    const inner = opened.reindex(container(opened, "grp"));
    expect(inner.get("a")!.bounds).toEqual(box(20, 20, 50, 80));
    expect(inner.at([60, 50], 0)).toBeNull();
  });

  it("i figli in un gruppo ritagliato condividono il ritaglio, letto una volta sola", () => {
    const rects = Array.from({ length: 30 }, (_, i) => `<rect id="r${i}" x="${i * 3}" y="0" width="3" height="100"/>`).join("");
    const opened = clipped(CIRCLE, `${LAYER}<g id="grp" clip-path="url(#c)">${rects}</g></g>`);
    const index = opened.reindex(container(opened, "grp"));
    const regions = index.units.flatMap((unit) => unit["parts"].flatMap((part) => part.regions ?? []));
    expect(regions).toHaveLength(30);
    expect(new Set(regions.map((region) => region.clip)).size).toBe(1);
    const clip = regions[0]!.clip;
    expect(clip.solids()).toBe(clip.solids());
  });

  it("un ritaglio con un tracciato evenodd lascia il buco", () => {
    const hole = (rule: string) => clipped(
      `<clipPath id="h" fub:role="private"><path d="M0 0 H100 V100 H0 Z M25 25 H75 V75 H25 Z" clip-rule="${rule}"/></clipPath>`,
      `${LAYER}<rect id="a" x="0" y="0" width="100" height="100" clip-path="url(#h)"/></g>`,
    );
    const even = hole("evenodd").index;
    expect(even.at([50, 50], 0)).toBeNull();
    expect(even.at([10, 10], 0)?.key).toBe("a");
    expect(even.get("a")!.bounds).toEqual(box(0, 0, 100, 100));
    expect(hole("nonzero").index.at([50, 50], 0)?.key).toBe("a");
  });

  it("un testo nel ritaglio vale il riquadro che gli si stima", () => {
    const plain = open(doc(`${LAYER}<text id="t" x="10" y="50" font-size="20" fill="#000000"><tspan x="10" dy="0">Ciao</tspan></text></g>`)).index.get("t")!.bounds!;
    const opened = clipped(
      '<clipPath id="t1" fub:role="private"><text x="10" y="50" font-size="20"><tspan x="10" dy="0">Ciao</tspan></text></clipPath>',
      `${LAYER}<rect id="a" x="0" y="0" width="200" height="200" clip-path="url(#t1)"/></g>`,
    );
    expect(opened.index.get("a")!.bounds).toEqual(plain);
    expect(opened.index.at([plain.min[0] + 1, plain.min[1] + 1], 0)?.key).toBe("a");
    expect(opened.index.at([150, 150], 0)).toBeNull();
  });
});

describe("i ritagli e i blocchi estranei", () => {
  const CUT = '<defs id="fub-defs"><clipPath id="c" fub:role="private"><rect x="10" y="10" width="30" height="30"/></clipPath></defs>';

  it("un blocco estraneo in un contenitore ritagliato è ritagliato come gli altri", () => {
    const { index } = open(doc(`${CUT}${LAYER}<g id="w" clip-path="url(#c)"><rect class="a" x="0" y="0" width="100" height="100"/></g></g>`));
    expect(index.get("w")!.bounds).toEqual({ min: [10, 10], max: [40, 40] });
    expect(index.at([20, 20], 0)?.key).toBe("w");
    expect(index.at([60, 60], 0)).toBeNull();
    expect(index.get("w")!.touches([60, 0], [60, 100], 0)).toBe(false);
  });

  it("il ritaglio che un blocco estraneo scrive per sé resta ignorato: è una stima", () => {
    const { index } = open(doc(`${CUT}${LAYER}<g id="w"><rect class="a" x="0" y="0" width="100" height="100" clip-path="url(#c)"/></g></g>`));
    expect(index.get("w")!.bounds).toEqual({ min: [0, 0], max: [100, 100] });
    expect(index.get("w")!.clipped).toBe(false);
  });
});

describe("i ritagli che dipendono dalla scatola dell'oggetto", () => {
  const clipped = (defs: string, body: string) => open(doc(`<defs id="fub-defs">${defs}</defs>${LAYER}${body}</g>`));

  it("con objectBoundingBox la scatola vale prima della trasformazione del ritaglio", () => {
    const opened = clipped(
      '<clipPath id="c" fub:role="private" clipPathUnits="objectBoundingBox" transform="translate(10 0)"><rect x="0.25" y="0.25" width="0.5" height="0.5"/></clipPath>',
      '<rect id="a" x="20" y="10" width="40" height="80" clip-path="url(#c)"/>',
    );
    const a = opened.index.get("a")!;
    expect(a.bounds).toEqual(box(40, 30, 60, 70));
    expect(a.frame()).toEqual(box(40, 30, 60, 70));
    expect(opened.index.at([45, 50], 0)?.key).toBe("a");
    expect(opened.index.at([35, 50], 0)).toBeNull();
    expect(opened.index.at([65, 50], 0)).toBeNull();
  });

  it("la scatola è quella dell'oggetto senza contorno, e segue la sua trasformazione", () => {
    const opened = clipped(
      '<clipPath id="c" fub:role="private" clipPathUnits="objectBoundingBox"><rect x="0" y="0" width="0.5" height="1"/></clipPath>',
      '<rect id="a" x="10" y="10" width="40" height="40" stroke="#000000" stroke-width="10" clip-path="url(#c)" transform="translate(100 0)"/>',
    );
    // La metà sinistra della scatola, da 10 a 30: il contorno che la supera, in alto, in basso e a sinistra, è tagliato.
    expect(opened.index.get("a")!.bounds).toEqual(box(110, 10, 130, 50));
    expect(opened.index.get("a")!.frame()).toEqual(box(10, 10, 30, 50));
    // Il contorno a destra della metà non c'è più, quello dentro sì.
    expect(opened.index.at([128, 30], 0)?.key).toBe("a");
    expect(opened.index.at([132, 30], 0)).toBeNull();
  });

  it("un gruppo prende la scatola di tutto ciò che contiene", () => {
    const opened = clipped(
      '<clipPath id="c" fub:role="private" clipPathUnits="objectBoundingBox"><rect x="0" y="0" width="0.5" height="1"/></clipPath>',
      '<g id="g" clip-path="url(#c)"><rect x="0" y="0" width="60" height="10"/><rect x="60" y="0" width="20" height="10"/></g>',
    );
    // La scatola va da 0 a 80: se ne vede la metà.
    expect(opened.index.get("g")!.bounds).toEqual(box(0, 0, 40, 10));
  });

  it("una maschera su un gruppo in unità della pagina taglia sulla sua finestra", () => {
    const opened = clipped(
      '<mask id="m" fub:role="private" maskUnits="userSpaceOnUse" x="10" y="10" width="50" height="40"><rect x="30" y="0" width="100" height="100" fill="#ffffff"/></mask>',
      '<g id="g" mask="url(#m)"><rect id="a" x="0" y="0" width="80" height="80"/></g>',
    );
    const g = opened.index.get("g")!;
    // La finestra è 10..60 per 10..50, la forma della maschera va da x 30, il contenuto fino a 80.
    expect(g.bounds).toEqual(box(30, 10, 60, 50));
    expect(opened.index.at([20, 30], 0)).toBeNull();
    expect(opened.index.at([40, 30], 0)?.key).toBe("g");
    expect(opened.index.at([40, 55], 0)).toBeNull();
    expect(opened.index.at([70, 30], 0)).toBeNull();
    const inside = opened.reindex(container(opened, "g"));
    expect(inside.get("a")!.bounds).toEqual(box(30, 10, 60, 50));
  });

  it("senza unità scritte la finestra della maschera è la scatola, allargata di un decimo per lato", () => {
    const opened = clipped(
      '<mask id="m" fub:role="private"><rect x="0" y="0" width="200" height="200" fill="#ffffff"/></mask>',
      '<rect id="a" x="20" y="20" width="60" height="60" fill="#cc0000" stroke="#000000" stroke-width="20" mask="url(#m)"/>',
    );
    // Il contorno arriverebbe a 10..90, la finestra è 14..86.
    expect(opened.index.get("a")!.bounds).toEqual(box(14, 14, 86, 86));
    expect(opened.index.at([12, 50], 0)).toBeNull();
    expect(opened.index.at([20, 50], 0)?.key).toBe("a");
    expect(opened.index.at([88, 50], 0)).toBeNull();
  });

  it("con maskContentUnits in scatola il contenuto si misura sulla scatola dell'oggetto", () => {
    const opened = clipped(
      '<mask id="m" fub:role="private" maskContentUnits="objectBoundingBox"><rect x="0" y="0" width="0.5" height="0.5" fill="#ffffff"/></mask>',
      '<rect id="a" x="20" y="20" width="60" height="60" mask="url(#m)"/>',
    );
    expect(opened.index.get("a")!.bounds).toEqual(box(20, 20, 50, 50));
  });

  it("una maschera nera conta come una che si vede: la luminosità non si legge", () => {
    const opened = clipped(
      '<mask id="m" fub:role="private" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect x="0" y="0" width="50" height="50" fill="#000000"/></mask>',
      '<rect id="a" x="0" y="0" width="100" height="100" mask="url(#m)"/>',
    );
    expect(opened.index.get("a")!.bounds).toEqual(box(0, 0, 50, 50));
  });
});

describe("i ritagli dei livelli e delle pagine", () => {
  const DEFS = '<defs id="fub-defs"><clipPath id="c" fub:role="private"><rect x="10" y="10" width="30" height="30"/></clipPath></defs>';

  it("un livello con un ritaglio ritaglia i suoi oggetti", () => {
    const opened = open(doc(`${DEFS}<g id="l1" fub:layer="Livello 1" clip-path="url(#c)"><rect id="a" x="0" y="0" width="100" height="100"/><rect id="b" x="60" y="60" width="20" height="20"/></g>`));
    const { index } = opened;
    expect(index.units.map((unit) => unit.key)).toEqual(["a", "b"]);
    expect(index.get("a")!.bounds).toEqual(box(10, 10, 40, 40));
    expect(index.get("b")!.bounds).toBeNull();
    expect(index.at([20, 20], 0)?.key).toBe("a");
    expect(index.at([70, 70], 0)).toBeNull();
    expect(index.at([5, 5], 0)).toBeNull();
    expect(opened.extent()).toEqual(box(10, 10, 40, 40));
    expect(index.within(box(0, 0, 50, 50)).map((unit) => unit.key)).toEqual(["a"]);
  });

  it("un livello dentro un gruppo isolato porta ancora il suo ritaglio", () => {
    const opened = open(doc(`${DEFS}<g id="l1" fub:layer="Livello 1" clip-path="url(#c)"><g id="g"><rect id="a" x="0" y="0" width="100" height="100"/></g></g>`));
    const index = opened.reindex(container(opened, "g"));
    expect(index.get("a")!.bounds).toEqual(box(10, 10, 40, 40));
    expect(index.get("a")!.boundsAfter(translate(5, 5))).toEqual(box(10, 10, 40, 40));
  });

  it("il gruppo di una pagina di un PDF ritaglia ciò che porta", () => {
    const engine = SceneEngine.open(doc(`${DEFS}<g id="p0001" fub:page="1" clip-path="url(#c)"><rect id="a" x="0" y="0" width="100" height="100"/></g>`));
    const builder = new PaintBuilder();
    builder.build(engine);
    const page = engine.holder("p0001") as ContainerNode;
    const index = new SceneIndexer(builder, (id) => engine.holder(id), () => [page]).index(engine.model!);
    expect(index.get("a")!.bounds).toEqual(box(10, 10, 40, 40));
    expect(index.at([60, 60], 0)).toBeNull();
  });
});

describe("i ritagli delle linee con le punte", () => {
  const ARROW = '<marker id="m" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">'
    + '<path d="M0 0 L10 5 L0 10 Z" fill="#000000"/></marker>';
  const CUT = '<clipPath id="c" fub:role="private"><rect x="0" y="0" width="56" height="100"/></clipPath>';
  const tipped = (defs: string, body: string) => open(doc(`<defs id="fub-defs">${defs}</defs>${LAYER}${body}</g>`));

  it("il ritaglio della linea taglia anche la punta", () => {
    const opened = tipped(ARROW + CUT, '<line id="a" x1="10" y1="50" x2="60" y2="50" stroke="#000000" stroke-width="2" marker-end="url(#m)" clip-path="url(#c)"/>');
    const line = opened.index.get("a")!;
    expect(line.bounds).toEqual({ min: [9, 46], max: [56, 54] });
    expect(line.frame()).toEqual({ min: [9, 46], max: [56, 54] });
    // La geometria è quella della linea, tagliata alla stessa ascissa.
    expect(line.geometry).toEqual({ min: [10, 50], max: [56, 50] });
    expect(line.hits([54, 47.5], 0)).toBe(true);
    expect(line.hits([58, 50], 0)).toBe(false);
    expect(line.hits([58, 47.5], 0)).toBe(false);
    expect(line.touches([55, 40], [55, 48], 0)).toBe(true);
    expect(line.touches([58, 40], [58, 55], 0)).toBe(false);
  });

  it("senza il ritaglio la punta c'è tutta", () => {
    const opened = tipped(ARROW + CUT, '<line id="a" x1="10" y1="50" x2="60" y2="50" stroke="#000000" stroke-width="2" marker-end="url(#m)"/>');
    expect(opened.index.get("a")!.bounds).toEqual({ min: [9, 46], max: [61, 54] });
    expect(opened.index.get("a")!.clipped).toBe(false);
  });

  it("una linea in un gruppo ritagliato perde la punta che esce", () => {
    const opened = tipped(ARROW + CUT, '<g id="g" clip-path="url(#c)"><line id="a" x1="10" y1="50" x2="60" y2="50" stroke="#000000" stroke-width="2" marker-end="url(#m)"/></g>');
    expect(opened.index.get("g")!.bounds).toEqual({ min: [9, 46], max: [56, 54] });
    expect(opened.index.at([58, 47.5], 0)).toBeNull();
    expect(opened.index.at([54, 47.5], 0)?.key).toBe("g");
  });
});

describe("i ritagli che non lasciano niente", () => {
  const empty = (clip: string, element = '<rect id="a" x="0" y="0" width="100" height="100" clip-path="url(#c)"/>') =>
    open(doc(`<defs id="fub-defs">${clip}</defs>${LAYER}${element}</g>`));

  for (const [name, clip] of [
    ["un ritaglio vuoto", '<clipPath id="c" fub:role="private"/>'],
    ["un ritaglio con solo ciò che non si disegna", '<clipPath id="c" fub:role="private"><rect x="0" y="0" width="50" height="50" display="none"/></clipPath>'],
    ["un ritaglio con una forma senza area", '<clipPath id="c" fub:role="private"><rect x="0" y="0" width="0" height="50"/></clipPath>'],
  ] as const) {
    it(`${name} non lascia vedere niente, ma l'oggetto resta nell'albero`, () => {
      const opened = empty(clip);
      const a = opened.index.get("a")!;
      expect(a).not.toBeNull();
      expect(a.bounds).toBeNull();
      expect(a.geometry).toBeNull();
      expect(a.frame()).toBeNull();
      expect(a.shapeFrame()).toBeNull();
      expect(a.boundsAfter(translate(5, 5))).toBeNull();
      expect(opened.index.at([50, 50], 5)).toBeNull();
      expect(a.hits([50, 50], 5)).toBe(false);
      expect(a.shapeAt([50, 50], 5)).toBeNull();
      expect(a.sampleAt([50, 50], 5)).toBeNull();
      expect(a.touches([0, 50], [100, 50], 5)).toBe(false);
      expect(opened.index.within({ min: [-10, -10], max: [200, 200] })).toEqual([]);
      expect(opened.extent()).toBeNull();
    });
  }

  it("un gruppo ritagliato a niente nasconde anche i figli, e un figlio isolato non si vede", () => {
    const opened = empty('<clipPath id="c" fub:role="private"/>', '<g id="g" clip-path="url(#c)"><rect id="a" x="0" y="0" width="100" height="100"/></g>');
    expect(opened.index.get("g")!.bounds).toBeNull();
    const index = opened.reindex(container(opened, "g"));
    expect(index.get("a")!.bounds).toBeNull();
    expect(index.at([50, 50], 5)).toBeNull();
  });

  it("none non toglie niente", () => {
    const bare = open(doc(`${LAYER}<rect id="a" x="0" y="0" width="100" height="100"/></g>`)).index.get("a")!;
    const a = open(doc(`${LAYER}<rect id="a" x="0" y="0" width="100" height="100" clip-path="none" mask="none"/></g>`)).index.get("a")!;
    expect(a.bounds).toEqual(bare.bounds);
    expect(a.frame()).toEqual(bare.frame());
    expect(a.geometry).toEqual(bare.geometry);
    expect(a.clipped).toBe(false);
  });
});

describe("quando niente è ritagliato", () => {
  const BODY = `${LAYER}<rect id="a" x="0" y="0" width="40" height="40"/><g id="g" transform="translate(50 0)"><circle id="c" cx="20" cy="20" r="10"/><text id="t" x="0" y="80" font-size="10">Ciao</text></g></g>`;

  it("nessuna parte porta ritagli, e i risultati sono quelli di un documento che scrive none", () => {
    const plain = open(doc(BODY));
    const named = open(doc(BODY.replace('<rect id="a"', '<rect id="a" clip-path="none" mask="none"').replace('<g id="g"', '<g id="g" clip-path="none"')));
    for (const opened of [plain, named]) {
      for (const unit of opened.index.units) {
        expect(unit.clipped, unit.key).toBe(false);
        expect(unit["parts"].every((part) => part.regions === null), unit.key).toBe(true);
      }
    }
    for (const unit of plain.index.units) {
      const other = named.index.get(unit.key)!;
      expect(other.bounds, unit.key).toEqual(unit.bounds);
      expect(other.geometry, unit.key).toEqual(unit.geometry);
      expect(other.frame(), unit.key).toEqual(unit.frame());
      expect(other.shapeFrame(), unit.key).toEqual(unit.shapeFrame());
      expect(other.boundsAfter(translate(3, 4)), unit.key).toEqual(unit.boundsAfter(translate(3, 4)));
    }
    for (const p of [[10, 10], [70, 20], [55, 78], [90, 90]] as const) {
      expect(named.index.at(p, 2)?.key, String(p)).toBe(plain.index.at(p, 2)?.key);
    }
    expect(named.index.within({ min: [0, 0], max: [100, 100] }).map((unit) => unit.key)).toEqual(plain.index.within({ min: [0, 0], max: [100, 100] }).map((unit) => unit.key));
    expect(named.index.inside([[-5, -5], [200, -5], [200, 200], [-5, 200]]).map((unit) => unit.key)).toEqual(plain.index.inside([[-5, -5], [200, -5], [200, 200], [-5, 200]]).map((unit) => unit.key));
  });
});
