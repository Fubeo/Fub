// I nodi di ogni forma: quelli che lo strumento Nodi mostra, e ciò che la
// modifica fa dell'oggetto. La forma resta lei finché i nodi ne disegnano
// una come lei, altrimenti diventa un tracciato; una freccia resta una
// freccia e un tratto un tratto. Le operazioni il motore le accetta così
// come sono, e un annulla le disfa al byte.

import { describe, expect, it } from "vitest";
import { decodeInk, inkToQuantized } from "../ink/codec";
import { parseBrush } from "../ink/brush";
import { pf1 } from "../ink/pf1";
import { doc } from "../scene/test-support";
import { nodeOf, Plan, plainAttributes } from "./arrange";
import { joinAcross, joinEnds } from "./cut";
import { gesture, NewIds } from "./edit";
import { pooledTips, type EndTips } from "./endtips";
import { breakNodes, deleteNodes, inferred, insertNode, moveNodes, setLinks, type Edited, type NodeKey, type Subpath } from "./nodes";
import { draftOf, nodableOf, rewrite, rewriteOps, type Nodable } from "./nodable";
import { LAYER, open, type Opened } from "./test-support";
import { applied, attrOf, BLUE, DEFS, ENDS, followed, MARKER, markersIn, RED, tipOf } from "./tip-support";

const STROKE = 'fill="none" stroke="#000000" stroke-width="2"';
const BRUSH = "pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0";

/// Un tratto a penna lungo la linea da (0, 0) a (100, 0), un campione per
/// unità, con la mano che trema di ±0,3.
const INK = `1 s100 cxypt 0,30,128,0${" 100,-60,0,8 100,60,0,8".repeat(50)}`;

function stroke(id: string, ink = INK): string {
  const d = pf1(inkToQuantized(decodeInk(ink)), parseBrush(BRUSH));
  return `<path id="${id}" fub:tool="pen" fub:brush="${BRUSH}" fill="#000000" fub:ink="${ink}" d="${d}"/>`;
}

const opened = (source: string): Opened => open(doc(`${LAYER}${source}</g>`));

function nodable(o: Opened, id: string): Nodable {
  const found = nodableOf(o.engine.holder(id)!);
  if (typeof found === "string") throw new Error(`niente nodi: ${found}`);
  return found;
}

const all = (subs: readonly Subpath[]): Set<NodeKey> => new Set(subs.flatMap((sub, s) => sub.nodes.map((_, at) => `${s}:${at}`)));
const move = (subs: readonly Subpath[], keys: Iterable<NodeKey>, dx: number, dy: number): Subpath[] => moveNodes(subs, new Set(keys), [dx, dy], inferred(subs));

/// Scrive i nodi `subs` di `id`, verifica che un annulla riporti il testo
/// di prima, e torna il testo di dopo.
function written(o: Opened, id: string, subs: readonly Subpath[], moved: ReadonlyMap<NodeKey, NodeKey> | null = null): string {
  const change = rewrite(nodable(o, id), subs, moved);
  if (change.kind !== "set" && change.kind !== "path") throw new Error(`niente da scrivere: ${change.kind}`);
  const plan = new Plan(o.engine.model!, new NewIds((name) => o.engine.holder(name) !== null));
  expect(rewriteOps(plan, o.engine.holder(id)!, change)).not.toBeNull();
  const ops = gesture(plan.finish([id]).ops)!;
  const before = o.engine.text;
  const outcome = o.engine.apply(ops);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = o.engine.text;
  expect(o.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(o.engine.text).toBe(before);
  expect(o.engine.apply(ops).outcome).toBe("applied");
  return after;
}

describe("i nodi di ogni forma", () => {
  it("di un rettangolo sono i quattro angoli, dall'alto a sinistra in senso orario", () => {
    const n = nodable(opened(`<rect id="r" x="0" y="0" width="10" height="5" ${STROKE}/>`), "r");
    expect(n.kind).toBe("shape");
    expect(n.subs).toEqual([{ nodes: [[0, 0], [10, 0], [10, 5], [0, 5]], links: Array(4).fill({ kind: "line" }), closed: true }]);
  });

  it("di un rettangolo arrotondato sono otto, con le maniglie agli angoli", () => {
    const n = nodable(opened(`<rect id="r" x="0" y="0" width="20" height="10" rx="2" ${STROKE}/>`), "r");
    expect(n.subs[0]!.nodes).toHaveLength(8);
    expect(n.subs[0]!.links.map((link) => link.kind)).toEqual(["line", "cubic", "line", "cubic", "line", "cubic", "line", "cubic"]);
  });

  it("di un'ellisse e di un cerchio sono quattro, con le maniglie", () => {
    for (const shape of ['<ellipse id="e" cx="10" cy="5" rx="10" ry="5"/>', '<circle id="e" cx="10" cy="5" r="5"/>']) {
      const n = nodable(opened(shape), "e");
      expect(n.subs[0]!.nodes).toHaveLength(4);
      expect(n.subs[0]!.links.every((link) => link.kind === "cubic")).toBe(true);
      expect(n.subs[0]!.closed).toBe(true);
    }
  });

  it("di una linea, una spezzata e un poligono sono i loro punti", () => {
    expect(nodable(opened('<line id="l" x1="0" y1="0" x2="10" y2="5"/>'), "l").subs).toEqual([{ nodes: [[0, 0], [10, 5]], links: [{ kind: "line" }], closed: false }]);
    expect(nodable(opened('<polyline id="p" points="0,0 10,0 10,10"/>'), "p").subs[0]!.nodes).toEqual([[0, 0], [10, 0], [10, 10]]);
    const polygon = nodable(opened('<polygon id="p" points="0,0 10,0 10,10"/>'), "p").subs[0]!;
    expect(polygon.nodes).toHaveLength(3);
    expect(polygon.closed).toBe(true);
  });

  it("di una freccia sono i due capi dell'asta", () => {
    const n = nodable(opened(`<path id="a" fub:shape="arrow" fub:geom="0 0 50 0" d="M0 0 L50 0" ${STROKE}/>`), "a");
    expect(n).toMatchObject({ kind: "arrow", width: 2 });
    expect(n.subs).toEqual([{ nodes: [[0, 0], [50, 0]], links: [{ kind: "line" }], closed: false }]);
  });

  it("di un tratto a penna sono quelli della sua spina", () => {
    const n = nodable(opened(stroke("s")), "s");
    expect(n.kind).toBe("stroke");
    expect(n.subs).toEqual([{ nodes: [[0, 0.3], [100, 0.3]], links: [{ kind: "line" }], closed: false }]);
  });

  it("non ci sono in un testo, in un'immagine, in un gruppo, né in una forma che non si disegna", () => {
    const o = opened(
      '<text id="t" x="0" y="10"><tspan>Ciao</tspan></text><image id="i" x="0" y="0" width="10" height="10" href="data:image/png;base64,AA=="/>' +
      '<g id="g"><rect id="in" x="0" y="0" width="1" height="1"/></g><rect id="z" x="0" y="0" width="0" height="5"/>',
    );
    expect(nodableOf(o.engine.holder("t")!)).toBe("text");
    expect(nodableOf(o.engine.holder("i")!)).toBe("image");
    expect(nodableOf(o.engine.holder("g")!)).toBe("other");
    expect(nodableOf(o.engine.holder("z")!)).toBe("empty");
  });

  it("non ci sono in una parte di un altro programma, che resta com'è", () => {
    const o = opened('<g id="g"><path id="f" style="fill:none;stroke:#000000" d="M0 0 L10 0"/><rect id="k" class="box" x="0" y="0" width="5" height="5"/></g>');
    expect(nodableOf(o.engine.holder("f")!)).toBe("foreign");
    expect(nodableOf(o.engine.holder("k")!)).toBe("foreign");
  });

  it("non ci sono in un tratto che non si ridisegna", () => {
    const o = opened(`<path id="s" fub:tool="pen" fub:brush="${BRUSH}" fill="#000000" fub:ink="1 s100 cxyq 0,0,1 100,0,1" d="M0 0 L1 0 L1 1 Z"/>`);
    expect(nodableOf(o.engine.holder("s")!)).toBe("stroke");
  });
});

describe("la forma resta lei finché può", () => {
  it("un rettangolo coi due nodi di destra spostati di lato resta un rettangolo, più largo", () => {
    const o = opened(`<rect id="r" x="0" y="0" width="10" height="5" ${STROKE}/>`);
    expect(written(o, "r", move(nodable(o, "r").subs, ["0:1", "0:2"], 5, 0))).toContain(`<rect id="r" x="0" y="0" width="15" height="5" ${STROKE}/>`);
  });

  it("un rettangolo arrotondato spostato tutto resta lui, coi suoi raggi", () => {
    const o = opened(`<rect id="r" x="0" y="0" width="20" height="10" rx="2" ${STROKE}/>`);
    const subs = nodable(o, "r").subs;
    expect(written(o, "r", move(subs, all(subs), 3.5, -1))).toContain(`<rect id="r" x="3.5" y="-1" width="20" height="10" rx="2" ${STROKE}/>`);
  });

  it("un rettangolo con un angolo tirato diventa un tracciato, con lo stesso id e gli stessi attributi", () => {
    const o = opened(`<rect id="r" x="0" y="0" width="10" height="5" ${STROKE} transform="rotate(30)"/>`);
    const text = written(o, "r", move(nodable(o, "r").subs, ["0:1"], 2, 0));
    expect(text).toContain(`<path id="r" d="M0 0 L12 0 L10 5 L0 5 Z" ${STROKE} transform="rotate(30)"/>`);
  });

  it("un'ellisse spostata tutta resta un'ellisse; con un nodo solo diventa un tracciato di curve", () => {
    let o = opened(`<ellipse id="e" cx="10" cy="5" rx="10" ry="5" ${STROKE}/>`);
    let subs = nodable(o, "e").subs;
    expect(written(o, "e", move(subs, all(subs), 1, 2))).toContain(`<ellipse id="e" cx="11" cy="7" rx="10" ry="5" ${STROKE}/>`);
    o = opened(`<ellipse id="e" cx="10" cy="5" rx="10" ry="5" ${STROKE}/>`);
    subs = nodable(o, "e").subs;
    const text = written(o, "e", move(subs, ["0:0"], 5, 0));
    expect(text).toMatch(/<path id="e" d="M25 5 C[^"]* Z" fill="none"/);
    expect(text).not.toContain("rx=");
  });

  it("un cerchio spostato tutto resta un cerchio", () => {
    const o = opened(`<circle id="c" cx="10" cy="5" r="5" ${STROKE}/>`);
    const subs = nodable(o, "c").subs;
    expect(written(o, "c", move(subs, all(subs), -10, 0))).toContain(`<circle id="c" cx="0" cy="5" r="5" ${STROKE}/>`);
  });

  it("una linea resta una linea coi capi nuovi; con un nodo in mezzo diventa un tracciato", () => {
    let o = opened(`<line id="l" x1="0" y1="0" x2="10" y2="5" ${STROKE}/>`);
    expect(written(o, "l", move(nodable(o, "l").subs, ["0:1"], 10, 5))).toContain(`<line id="l" x1="0" y1="0" x2="20" y2="10" ${STROKE}/>`);
    o = opened(`<line id="l" x1="0" y1="0" x2="10" y2="5" ${STROKE}/>`);
    const edited = insertNode(nodable(o, "l").subs, 0, 0, 0.5);
    expect(written(o, "l", edited.subs, edited.moved)).toContain(`<path id="l" d="M0 0 L5 2.5 L10 5" ${STROKE}/>`);
  });

  it("una spezzata e un poligono tengono i punti nuovi finché i segmenti sono linee", () => {
    let o = opened(`<polyline id="p" points="0,0 10,0 10,10" ${STROKE}/>`);
    const edited = insertNode(nodable(o, "p").subs, 0, 0, 0.5);
    expect(written(o, "p", edited.subs, edited.moved)).toContain(`<polyline id="p" points="0,0 5,0 10,0 10,10" ${STROKE}/>`);
    o = opened(`<polygon id="p" points="0,0 10,0 10,10" ${STROKE}/>`);
    expect(written(o, "p", move(nodable(o, "p").subs, ["0:2"], -5, 0))).toContain(`<polygon id="p" points="0,0 10,0 5,10" ${STROKE}/>`);
    o = opened(`<polygon id="p" points="0,0 10,0 10,10" ${STROKE}/>`);
    const curved = setLinks(nodable(o, "p").subs, new Set(["0:0", "0:1"]), "curve");
    expect(written(o, "p", curved.subs, curved.moved)).toMatch(/<path id="p" d="M0 0 C[^"]*" fill="none"/);
  });

  it("un poligono regolare spostato tutto resta lui; con un nodo solo perde la regola", () => {
    const geom = "50 50 40 6 0 0";
    const d = "M30 84.64 L10 50 L30 15.36 L70 15.36 L90 50 L70 84.64 Z";
    let o = opened(`<path id="n" fub:shape="polygon" fub:geom="${geom}" d="${d}" ${STROKE}/>`);
    let subs = nodable(o, "n").subs;
    expect(nodable(o, "n").kind).toBe("polygonal");
    expect(written(o, "n", move(subs, all(subs), 10, 0))).toContain('fub:geom="60 50 40 6 0 0" d="M40 84.64 L20 50 L40 15.36 L80 15.36 L100 50 L80 84.64 Z"');
    o = opened(`<path id="n" fub:shape="polygon" fub:geom="${geom}" d="${d}" ${STROKE}/>`);
    subs = nodable(o, "n").subs;
    const text = written(o, "n", move(subs, ["0:0"], 0, 10));
    expect(text).toContain(`<path id="n" d="M30 94.64 L10 50 L30 15.36 L70 15.36 L90 50 L70 84.64 Z" ${STROKE}/>`);
  });
});

describe("una freccia resta una freccia", () => {
  const ARROW = `<path id="a" fub:shape="arrow" fub:geom="0 0 50 0" d="M0 0 L50 0" ${STROKE}/>`;

  it("e la punta segue il capo spostato", () => {
    const o = opened(ARROW);
    const text = written(o, "a", move(nodable(o, "a").subs, ["0:1"], 0, 50));
    expect(text).toContain('fub:geom="0 0 50 50"');
    expect(text).toMatch(/d="M0 0 L50 50 M[^"]* L50 50 L[^"]*"/);
  });

  it("e non prende curve né altri nodi", () => {
    const o = opened(ARROW);
    const n = nodable(o, "a");
    expect(rewrite(n, setLinks(n.subs, new Set(["0:0", "0:1"]), "curve").subs, null)).toEqual({ kind: "refused", reason: "arrow" });
    const edited = insertNode(n.subs, 0, 0, 0.5);
    expect(rewrite(n, edited.subs, edited.moved)).toEqual({ kind: "refused", reason: "arrow" });
  });

  it("e mentre la si tira si vede con la punta", () => {
    const n = nodable(opened(ARROW), "a");
    expect(draftOf(n, move(n.subs, ["0:1"], 0, 50))).toMatch(/^M0 0 L50 50 M/);
  });
});

describe("un testo su tracciato ha i nodi del suo tracciato", () => {
  const ALONG = doc(
    '<defs id="fub-defs"><path id="rk" fub:role="private" d="M 0 50 L 100 50"/></defs>' +
      `${LAYER}<text id="t" font-size="10"><textPath href="#rk">Sul colle</textPath></text></g>`,
  );
  const tracks = new Map([["rk", "M 0 50 L 100 50"]]);

  it("li mostra se gli si dà il tracciato, e la modifica cambia il tracciato", () => {
    const o = open(ALONG);
    const text = o.engine.holder("t")!;
    expect(nodableOf(text)).toBe("text");
    expect(nodableOf(text, undefined, () => null)).toBe("unreadable");
    const n = nodableOf(text, undefined, (id) => tracks.get(id) ?? null);
    if (typeof n === "string") throw new Error(n);
    expect(n.kind).toBe("track");
    expect(n.subs[0]!.nodes).toEqual([[0, 50], [100, 50]]);
    expect(rewrite(n, move(n.subs, ["0:1"], 0, -20), null)).toEqual({ kind: "track", target: "rk", d: "M0 50 L100 30" });
    expect(draftOf(n, move(n.subs, ["0:1"], 0, -20))).toBe("M0 50 L100 30");
  });

  it("e il tracciato resta lungo più di zero", () => {
    const n = nodableOf(open(ALONG).engine.holder("t")!, undefined, (id) => tracks.get(id) ?? null) as Nodable;
    expect(rewrite(n, move(n.subs, ["0:1"], -100, 0), null)).toEqual({ kind: "refused", reason: "track" });
    expect(rewrite(n, [], null)).toEqual({ kind: "refused", reason: "track" });
  });
});

describe("un tratto a penna resta un tratto", () => {
  it("e l'inchiostro segue la spina, col contorno ricalcolato dal motore", () => {
    const o = opened(stroke("s"));
    const n = nodable(o, "s");
    const text = written(o, "s", move(n.subs, ["0:1"], 0, 100));
    const ink = decodeInk(/fub:ink="([^"]*)"/.exec(text)![1]!);
    // L'ultimo campione è dove è finito il nodo, e il tempo non cambia.
    expect(ink.values.slice(-4)).toEqual([10000, 10030, 128, 800]);
    expect(text).toContain(`fub:brush="${BRUSH}"`);
    expect(text).toContain(`d="${pf1(inkToQuantized(ink), parseBrush(BRUSH))}"`);
  });

  it("e non si spezza né si chiude", () => {
    const n = nodable(opened(stroke("s")), "s");
    const edited = insertNode(n.subs, 0, 0, 0.5);
    expect(rewrite(n, breakNodes(edited.subs, new Set(["0:1"])).subs, null)).toEqual({ kind: "refused", reason: "stroke" });
  });

  it("e mentre lo si tira si vede col contorno del pennello", () => {
    const n = nodable(opened(stroke("s")), "s");
    expect(draftOf(n, move(n.subs, ["0:1"], 0, 100))).toMatch(/^M[^Z]* Z$/);
  });
});

describe("le punte quando si modificano i nodi", () => {
  const MARKERS: Record<string, string> = {
    ms: MARKER("ms", "circle", "small", "start"),
    me: MARKER("me", "triangle", "large", "end"),
    mb: MARKER("mb", "square", "medium", "end", BLUE),
    mbs: MARKER("mbs", "vee", "medium", "start", BLUE),
  };
  const START = "circle small start #d55e00";
  const END = "triangle large end #d55e00";

  const path = (id: string, d: string, stroke = RED, tips = ENDS("ms", "me")): string => `<path id="${id}" d="${d}" fill="none" stroke="${stroke}" stroke-width="2"${tips}/>`;

  /// Il disegno con `body` e i marcatori che `body` usa, col seguito delle
  /// punte: un marcatore che già in partenza nessuno usa non lo raccoglie
  /// nessun comando.
  const sheet = (body: string): Opened =>
    followed(doc(DEFS(...Object.entries(MARKERS).filter(([id]) => body.includes(`url(#${id})`)).map(([, marker]) => marker)) + LAYER + body + "</g>"));

  /// Scrive `edit` su `id` come lo scrive l'editor, in un passo, e torna il
  /// testo di dopo.
  function edited(o: Opened, id: string, edit: Edited, tips?: EndTips): string {
    const change = rewrite(nodable(o, id), edit.subs, edit.moved, tips);
    if (change.kind !== "set" && change.kind !== "path") throw new Error(`niente da scrivere: ${change.kind}`);
    const plan = new Plan(o.engine.model!, new NewIds((name) => o.engine.holder(name) !== null));
    expect(rewriteOps(plan, o.engine.holder(id)!, change)).not.toBeNull();
    return applied(o, plan.finish([id]).ops);
  }

  const subsOf = (o: Opened, id: string): readonly Subpath[] => nodable(o, id).subs;
  const OPEN = "M0 0 L50 0 L100 0 L100 50";

  it("chiudere l'unico sottotracciato aperto toglie le punte, e i marcatori che non servono più", () => {
    const o = sheet(path("oa", OPEN));
    const text = edited(o, "oa", joinEnds(subsOf(o, "oa"), "0:0", "0:3", 0.5)!);
    expect(text).toContain(`<path id="oa" d="M0 0 L50 0 L100 0 L100 50 Z" fill="none" stroke="${RED}" stroke-width="2"/>`);
    expect(markersIn(o)).toEqual([]);
  });

  it("un capo che si chiude con un nodo solo, a metà strada, toglie le punte allo stesso modo", () => {
    const o = sheet(path("oa", "M0 0 L50 0 L50 40 L0.2 0.2"));
    const text = edited(o, "oa", joinEnds(subsOf(o, "oa"), "0:0", "0:3", 0.5)!);
    expect(text).toContain(" Z");
    expect(attrOf(o, "oa", "marker-start")).toBeNull();
    expect(attrOf(o, "oa", "marker-end")).toBeNull();
    expect(markersIn(o)).toEqual([]);
  });

  it("se resta un sottotracciato aperto, le punte restano", () => {
    const o = sheet(path("oa", "M0 0 L50 0 L100 0 M200 0 L250 0"));
    const text = edited(o, "oa", joinEnds(subsOf(o, "oa"), "0:0", "0:2", 0.5)!);
    expect(text).toContain(`d="M0 0 L50 0 L100 0 Z M200 0 L250 0"`);
    expect([tipOf(o, "oa", "start"), tipOf(o, "oa", "end")]).toEqual([START, END]);
    expect(markersIn(o)).toEqual(["ms", "me"]);
  });

  it("inserire, togliere, spezzare o spostare nodi lascia le punte com'erano: cambia solo `d`", () => {
    const cases: Array<[string, (subs: readonly Subpath[]) => Edited]> = [
      ["inserire in mezzo", (subs) => insertNode(subs, 0, 1, 0.5)],
      ["togliere il primo", (subs) => deleteNodes(subs, new Set(["0:0"]))],
      ["togliere l'ultimo", (subs) => deleteNodes(subs, new Set(["0:3"]))],
      ["togliere i due in mezzo", (subs) => deleteNodes(subs, new Set(["0:1", "0:2"]))],
      ["spezzare in un nodo", (subs) => breakNodes(subs, new Set(["0:1"]))],
      ["spezzare in un altro", (subs) => breakNodes(subs, new Set(["0:2"]))],
      ["spezzare in due", (subs) => breakNodes(subs, new Set(["0:1", "0:2"]))],
    ];
    for (const [name, edit] of cases) {
      const o = sheet(path("oa", OPEN));
      const done = edit(subsOf(o, "oa"));
      const change = rewrite(nodable(o, "oa"), done.subs, done.moved);
      expect([name, change.kind]).toEqual([name, "set"]);
      expect([name, "tips" in change]).toEqual([name, false]);
      const before = o.engine.text;
      const text = edited(o, "oa", done);
      expect(text, name).not.toBe(before);
      expect([name, attrOf(o, "oa", "marker-start"), attrOf(o, "oa", "marker-end")]).toEqual([name, "url(#ms)", "url(#me)"]);
      expect([name, markersIn(o)]).toEqual([name, ["ms", "me"]]);
    }
  });

  it("togliere il primo nodo lascia la punta d'inizio al vertice che prende il suo posto", () => {
    const o = sheet(path("oa", OPEN));
    const text = edited(o, "oa", deleteNodes(subsOf(o, "oa"), new Set(["0:0"])));
    expect(text).toContain(`<path id="oa" d="M50 0 L100 0 L100 50" fill="none" stroke="${RED}" stroke-width="2" marker-start="url(#ms)" marker-end="url(#me)"/>`);
  });

  it("due capi di sottotracciati diversi che si uniscono: la punta del capo che non lo è più se ne va", () => {
    // L'inizio con l'inizio: il primo si percorre al contrario e l'inizio di prima è in mezzo.
    const o = sheet(path("oa", "M0 0 L50 0 M0 10 L50 10"));
    const text = edited(o, "oa", joinEnds(subsOf(o, "oa"), "0:0", "1:0", 0.5)!);
    expect(text).toContain(`d="M50 0 L0 0 L0 10 L50 10"`);
    expect(attrOf(o, "oa", "marker-start")).toBeNull();
    expect(tipOf(o, "oa", "end")).toBe(END);
    expect(markersIn(o)).toEqual(["me"]);
  });

  it("la fine con la fine: la fine di prima è in mezzo, e la fine nuova non ha punta", () => {
    const o = sheet(path("oa", "M0 0 L50 0 M100 0 L50 0"));
    const text = edited(o, "oa", joinEnds(subsOf(o, "oa"), "0:1", "1:1", 0.5)!);
    expect(text).toContain(`d="M0 0 L50 0 L100 0"`);
    expect(tipOf(o, "oa", "start")).toBe(START);
    expect(attrOf(o, "oa", "marker-end")).toBeNull();
    expect(markersIn(o)).toEqual(["ms"]);
  });

  it("la fine con l'inizio, in ordine: capo e coda restano com'erano", () => {
    const o = sheet(path("oa", "M0 0 L50 0 M50 0 L100 0"));
    const done = joinEnds(subsOf(o, "oa"), "0:1", "1:0", 0.5)!;
    expect("tips" in rewrite(nodable(o, "oa"), done.subs, done.moved)).toBe(false);
    const text = edited(o, "oa", done);
    expect(text).toContain(`d="M0 0 L50 0 L100 0"`);
    expect([tipOf(o, "oa", "start"), tipOf(o, "oa", "end")]).toEqual([START, END]);
  });

  it("l'inizio con la fine: tutti e due i capi che avevano la punta finiscono in mezzo", () => {
    const o = sheet(path("oa", "M50 0 L100 0 M0 0 L50 0"));
    const text = edited(o, "oa", joinEnds(subsOf(o, "oa"), "0:0", "1:1", 0.5)!);
    // Tutti e due si percorrono al contrario, e il tracciato nuovo comincia e finisce
    // nei capi che non erano né il primo vertice né l'ultimo.
    expect(text).toContain(`d="M100 0 L50 0 L0 0"`);
    // Il primo vertice di prima era 50 0 e l'ultimo 50 0: tutti e due in mezzo adesso.
    expect(attrOf(o, "oa", "marker-start")).toBeNull();
    expect(attrOf(o, "oa", "marker-end")).toBeNull();
    expect(markersIn(o)).toEqual([]);
  });

  it("una spezzata chiusa diventa un tracciato senza punte, con lo stesso id", () => {
    const o = sheet(`<polyline id="op" points="0,0 50,0 50,50" fill="none" stroke="${RED}" stroke-width="2"${ENDS("ms", "me")}/>`);
    const text = edited(o, "op", joinEnds(subsOf(o, "op"), "0:0", "0:2", 0.5)!);
    expect(text).not.toContain("<polyline");
    expect(text).toContain(`<path id="op" d="M0 0 L50 0 L50 50 Z" fill="none" stroke="${RED}" stroke-width="2"/>`);
    expect(markersIn(o)).toEqual([]);
  });

  it("una linea con un nodo in più diventa un tracciato che tiene le punte", () => {
    const o = sheet(`<line id="ol" x1="0" y1="0" x2="100" y2="0" stroke="${RED}" stroke-width="2"${ENDS("ms", "me")}/>`);
    const done = insertNode(subsOf(o, "ol"), 0, 0, 0.5);
    const text = edited(o, "ol", done);
    expect(text).not.toContain("<line");
    expect(text).toContain(`<path id="ol" d="M0 0 L50 0 L100 0" stroke="${RED}" stroke-width="2" marker-start="url(#ms)" marker-end="url(#me)"/>`);
    expect([tipOf(o, "ol", "start"), tipOf(o, "ol", "end")]).toEqual([START, END]);
    expect(markersIn(o)).toEqual(["ms", "me"]);
  });

  it("una spezzata senza l'ultimo nodo tiene la punta di fine sul vertice che prende il suo posto", () => {
    const o = sheet(`<polyline id="op" points="0,0 50,0 50,50" fill="none" stroke="${RED}" stroke-width="2"${ENDS("ms", "me")}/>`);
    edited(o, "op", deleteNodes(subsOf(o, "op"), new Set(["0:2"])));
    expect([tipOf(o, "op", "start"), tipOf(o, "op", "end")]).toEqual([START, END]);
  });

  it("senza punte, i nodi non scrivono nessun attributo di punta", () => {
    const o = sheet(path("oa", OPEN, RED, ""));
    const text = edited(o, "oa", joinEnds(subsOf(o, "oa"), "0:0", "0:3", 0.5)!);
    expect(text).not.toContain("marker-");
    expect(text).toContain(" Z");
  });

  it("un marcatore che non è della raccolta segue le stesse regole", () => {
    const custom = `<marker id="cm" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto"><circle cx="2" cy="2" r="2" fill="#000000"/></marker>`;
    const body = path("oa", OPEN, RED, ` marker-start="url(#cm)" marker-end="url(#cm)"`);
    const o = followed(doc(DEFS(custom) + LAYER + body + "</g>"));
    edited(o, "oa", joinEnds(subsOf(o, "oa"), "0:0", "0:3", 0.5)!);
    expect(attrOf(o, "oa", "marker-start")).toBeNull();
    expect(attrOf(o, "oa", "marker-end")).toBeNull();
  });

  describe("uniti da un tracciato all'altro", () => {
    /// Come `joinTwo` dell'editor: il primo prende il sottotracciato del
    /// secondo, che lo perde, e se è il solo se ne va.
    function across(o: Opened, firstId: string, a: NodeKey, secondId: string, b: NodeKey): string {
      const model = o.engine.model!;
      const first = nodable(o, firstId);
      const second = nodable(o, secondId);
      const joined = joinAcross(first.subs, a, second.subs, b, [1, 0, 0, 1, 0, 0], 0.5)!;
      const plan = new Plan(model, new NewIds((name) => o.engine.holder(name) !== null));
      const firstNode = nodeOf(model, { path: o.index.get(firstId)!.path });
      const secondNode = nodeOf(model, { path: o.index.get(secondId)!.path });
      const kept = rewrite(first, joined.kept.subs, joined.kept.moved, pooledTips([plainAttributes(secondNode)], joined.tips.kept));
      if (kept.kind !== "set" && kept.kind !== "path") throw new Error(kept.kind);
      expect(rewriteOps(plan, firstNode, kept)).not.toBeNull();
      const rest = rewrite(second, joined.rest.subs, joined.rest.moved, joined.tips.rest);
      if (rest.kind === "remove") plan.ops.push({ op: "remove", target: secondId });
      else if (rest.kind === "set" || rest.kind === "path") expect(rewriteOps(plan, secondNode, rest)).not.toBeNull();
      else throw new Error(rest.kind);
      return applied(o, plan.finish([firstId]).ops);
    }

    it("la fine di uno con l'inizio dell'altro: l'inizio è del primo, la fine del secondo, nel colore del primo", () => {
      const o = sheet(path("oa", "M0 0 L50 0") + path("ob", "M50 0 L100 0", BLUE, ENDS(null, "mb")));
      const text = across(o, "oa", "0:1", "ob", "0:0");
      expect(text).toContain(`d="M0 0 L50 0 L100 0"`);
      expect(text).not.toContain(`id="ob"`);
      expect(tipOf(o, "oa", "start")).toBe(START);
      expect(tipOf(o, "oa", "end")).toBe("square medium end #d55e00");
    });

    it("il secondo si percorre al contrario: la sua punta d'inizio diventa la fine del primo", () => {
      const o = sheet(path("oa", "M0 0 L50 0", RED, ENDS("ms", null)) + path("ob", "M100 0 L50 0", BLUE, ENDS("mbs", null)));
      const text = across(o, "oa", "0:1", "ob", "0:1");
      expect(text).toContain(`d="M0 0 L50 0 L100 0"`);
      expect(tipOf(o, "oa", "start")).toBe(START);
      expect(tipOf(o, "oa", "end")).toBe("vee medium end #d55e00");
    });

    it("il primo si percorre al contrario: la sua fine diventa l'inizio", () => {
      const o = sheet(path("oa", "M50 0 L0 0", RED, ENDS("ms", "me")) + path("ob", "M50 0 L100 0", BLUE, ENDS(null, "mb")));
      const text = across(o, "oa", "0:0", "ob", "0:0");
      expect(text).toContain(`d="M0 0 L50 0 L100 0"`);
      expect(tipOf(o, "oa", "start")).toBe("triangle large start #d55e00");
      expect(tipOf(o, "oa", "end")).toBe("square medium end #d55e00");
    });

    it("un capo senza punta non ne prende: la togliamo dal primo", () => {
      const o = sheet(path("oa", "M0 0 L50 0", RED, ENDS("ms", "me")) + path("ob", "M50 0 L100 0", BLUE, ENDS("mbs", null)));
      across(o, "oa", "0:1", "ob", "0:0");
      expect(tipOf(o, "oa", "start")).toBe(START);
      expect(attrOf(o, "oa", "marker-end")).toBeNull();
      expect(markersIn(o)).toEqual(["ms"]);
    });

    it("l'altro, con altri sottotracciati, resta; ma senza la punta del capo che ha dato", () => {
      const o = sheet(path("oa", "M0 0 L50 0", RED, ENDS("ms", "me")) + path("ob", "M50 0 L100 0 M300 0 L350 0", BLUE, ENDS("mbs", "mb")));
      const text = across(o, "oa", "0:1", "ob", "0:0");
      expect(text).toContain(`<path id="oa" d="M0 0 L50 0 L100 0"`);
      expect(text).toContain(`<path id="ob" d="M300 0 L350 0"`);
      // Il primo ha l'inizio suo e la fine di prima rimpiazzata dal capo di arrivo, senza punta in B alla sua fine di sottotracciato.
      expect(tipOf(o, "oa", "start")).toBe(START);
      expect(attrOf(o, "oa", "marker-end")).toBeNull();
      // L'altro ha perso la punta d'inizio, che stava nel capo che ha dato, e tiene la fine.
      expect(attrOf(o, "ob", "marker-start")).toBeNull();
      expect(tipOf(o, "ob", "end")).toBe("square medium end #0072b2");
    });
  });
});
