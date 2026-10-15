// Le Forbici, il Coltello e «Unisci» sul documento: i pezzi che diventano
// oggetti, col loro aspetto, e i tracciati che diventano uno. Ogni comando è
// un passo solo, e un annulla riporta tutto al byte.

import { describe, expect, it } from "vitest";
import { parsePath } from "../scene/geometry";
import { pathData } from "../scene/serialize";
import { doc } from "../scene/test-support";
import { nodeOf, Plan, type Arranged } from "./arrange";
import { cutAt, type Spot } from "./cut";
import { gesture, NewIds } from "./edit";
import { nodableOf } from "./nodable";
import { readNodes, writeNodes, type Subpath } from "./nodes";
import { dsOf, holdsOpenPath, joinOps, knifePieces, piecesOf, tipsOfCut, writePieces } from "./scissors";
import { LAYER, open, type Opened } from "./test-support";
import { applied, attrOf, BLUE, DEFS, ENDS, followed, MARKER, markersIn, RED, tipOf } from "./tip-support";

const subsOf = (d: string): Subpath[] => readNodes(parsePath(d)!);
const objects = (pieces: readonly (readonly Subpath[])[]): string[] => pieces.map((subs) => pathData(writeNodes(subs)));
const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

/// Scrive `change`, verifica che un annulla riporti il testo di prima, e
/// torna il testo di dopo.
function written(opened: Opened, change: Arranged): string {
  const before = opened.engine.text;
  const outcome = opened.engine.apply(gesture(change.ops)!);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = opened.engine.text;
  expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(opened.engine.text).toBe(before);
  return after;
}

/// I pezzi che lascia il Coltello, ognuno un `d`.
const knife = (subs: readonly Subpath[], cutter: readonly Subpath[]): string[] | null => knifePieces(subs, cutter)?.pieces ?? null;

const RECT = "M0 0 L100 0 L100 50 L0 50 Z";
/// Un tratto dritto, per il Coltello.
const blade = (d: string): Subpath[] => subsOf(d);

describe("i pezzi di un taglio", () => {
  it("il primo oggetto tiene i sottotracciati che il taglio non tocca", () => {
    const cut = cutAt(subsOf("M0 0 L10 0 M0 10 L10 10"), [{ sub: 1, link: 0, t: 0.5 }])!;
    expect(objects(piecesOf(cut))).toEqual(["M0 0 L10 0 M0 10 L5 10", "M5 10 L10 10"]);
  });

  it("un rettangolo aperto è un oggetto; tagliato due volte, due", () => {
    expect(objects(piecesOf(cutAt(subsOf(RECT), [{ sub: 0, link: 1, t: 0.5 }])!))).toEqual(["M100 25 L100 50 L0 50 L0 0 L100 0 L100 25"]);
    const twice = cutAt(subsOf(RECT), [{ sub: 0, link: 0, t: 0.5 }, { sub: 0, link: 2, t: 0.5 }])!;
    expect(dsOf(piecesOf(twice))).toEqual(["M50 0 L100 0 L100 50 L50 50", "M50 50 L0 50 L0 0 L50 0"]);
  });
});

describe("il Coltello", () => {
  it("divide una forma chiusa che attraversa da parte a parte", () => {
    expect(knife(subsOf(RECT), blade("M50 -10 L50 60"))).toEqual(["M0 0 L50 0 L50 50 L0 50 Z", "M100 0 L100 50 L50 50 L50 0 Z"]);
  });

  it("un tratto che entra e non esce, o che passa accanto, non taglia", () => {
    expect(knife(subsOf(RECT), blade("M50 -10 L50 25"))).toBeNull();
    expect(knife(subsOf(RECT), blade("M150 -10 L150 60"))).toBeNull();
  });

  it("taglia un tracciato aperto dove lo incrocia", () => {
    // Il zig-zag passa tre volte: a 25, a 50 di traverso e a 75.
    expect(knife(subsOf("M0 0 L100 0"), blade("M25 -10 L25 10 L75 -10 L75 10"))).toEqual(["M0 0 L25 0", "M25 0 L50 0", "M50 0 L75 0", "M75 0 L100 0"]);
    expect(knife(subsOf("M0 0 L100 0"), blade("M0 10 L100 10"))).toBeNull();
  });

  it("non taglia una forma con sottotracciati chiusi e aperti insieme", () => {
    expect(knife(subsOf(`${RECT} M0 80 L100 80`), blade("M50 -10 L50 90"))).toBeNull();
  });
});

describe("i pezzi scritti nel documento", () => {
  it("il primo al posto della forma, col suo id; gli altri sopra, col suo aspetto", () => {
    const opened = open(doc(`${LAYER}<rect id="oa1a1a1a1" x="0" y="0" width="100" height="50" fill="#d55e00" opacity="0.5" transform="translate(10 0)"/><circle id="ob1b1b1b1" cx="0" cy="0" r="5"/></g>`));
    const model = opened.engine.model!;
    const plan = new Plan(model, ids(opened));
    const node = nodeOf(model, opened.index.get("oa1a1a1a1")!);
    const keys = writePieces(plan, node, ["M0 0 L50 0 L50 50 L0 50 Z", "M100 0 L100 50 L50 50 L50 0 Z"], [{ start: false, end: false }, { start: false, end: false }])!;
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe("oa1a1a1a1");
    const text = written(opened, plan.finish(keys));
    expect(text).toContain(`<path id="oa1a1a1a1" d="M0 0 L50 0 L50 50 L0 50 Z" fill="#d55e00" opacity="0.5" transform="translate(10 0)"/>`);
    expect(text).toContain(`<path id="${keys[1]}" d="M100 0 L100 50 L50 50 L50 0 Z" fill="#d55e00" opacity="0.5" transform="translate(10 0)"/>`);
    expect([...text.matchAll(/ id="(o[^"]+)"/g)].map((found) => found[1])).toEqual(["oa1a1a1a1", keys[1], "ob1b1b1b1"]);
  });
});

describe("«Unisci»", () => {
  const A = "oa2a2a2a2";
  const B = "ob2b2b2b2";
  const run = (body: string, keys: readonly string[]) => {
    const opened = open(doc(`${LAYER}${body}</g>`));
    const done = joinOps(opened.engine.model!, keys.map((key) => opened.index.get(key)!), 0.5, ids(opened));
    return { done, text: "reason" in done ? opened.engine.text : written(opened, done), opened };
  };

  it("tiene il tracciato più in basso, e i capi degli altri arrivano nelle sue coordinate", () => {
    const { done, text } = run(
      `<line id="${A}" x1="0" y1="0" x2="50" y2="0" stroke="#000000"/><path id="${B}" d="M0 50 L0 0" transform="translate(50 0)" fill="none" stroke="#0072b2"/>`,
      [A, B],
    );
    expect(text).toContain(`<path id="${A}" d="M0 0 L50 0 L50 50" stroke="#000000"/>`);
    expect(text).not.toContain(B);
    expect("reason" in done ? null : done.joined).toMatchObject({ closed: false, lines: 0 });
  });

  it("i capi dentro la distanza della scena si incontrano a metà, in qualunque coordinata", () => {
    // Il tracciato in basso è ingrandito due volte: nelle sue coordinate,
    // mezzo punto della scena è un quarto.
    const scaled = (x: number): string => run(
      `<path id="${A}" d="M0 0 L25 0" transform="scale(2)" fill="none" stroke="#000000"/><path id="${B}" d="M${x} 0 L${x} 50" fill="none" stroke="#000000"/>`,
      [A, B],
    ).text;
    expect(scaled(50.4)).toContain(`<path id="${A}" d="M0 0 L25.1 0 L25.2 25" fill="none" stroke="#000000" transform="scale(2)"/>`);
    expect(scaled(50.8)).toContain(`<path id="${A}" d="M0 0 L25 0 L25.4 0 L25.4 25" fill="none" stroke="#000000" transform="scale(2)"/>`);
  });

  it("un tracciato solo si chiude", () => {
    const { done, text } = run(`<path id="${A}" d="M0 0 L50 0 L50 50" fill="none" stroke="#000000"/>`, [A]);
    expect(text).toContain(`d="M0 0 L50 0 L50 50 Z"`);
    expect("reason" in done ? null : done.joined).toMatchObject({ closed: true, lines: 1 });
  });

  it("dice perché non unisce", () => {
    const body = `<line id="${A}" x1="0" y1="0" x2="50" y2="0" stroke="#000000"/><rect id="${B}" x="0" y="0" width="10" height="10"/>`
      + `<text id="ot2t2t2t2" x="0" y="40"><tspan x="0" dy="0">Ciao</tspan></text>`;
    expect(run(body, []).done).toEqual({ reason: "none" });
    expect(run(body, [A]).done).toEqual({ reason: "line" });
    expect(run(body, [A, B]).done).toEqual({ reason: "closed" });
    expect(run(body, [A, "ot2t2t2t2"]).done).toEqual({ reason: "not_paths", count: 1 });
  });

  it("si offre soltanto con un tracciato aperto fra gli scelti", () => {
    const opened = open(doc(`${LAYER}<line id="${A}" x1="0" y1="0" x2="50" y2="0" stroke="#000000"/><rect id="${B}" x="0" y="0" width="10" height="10"/></g>`));
    const model = opened.engine.model!;
    expect(holdsOpenPath(model, [opened.index.get(B)!])).toBe(false);
    expect(holdsOpenPath(model, [opened.index.get(B)!, opened.index.get(A)!])).toBe(true);
    expect(holdsOpenPath(model, [])).toBe(false);
  });
});

describe("le punte nei tagli", () => {
  const MS = MARKER("ms", "circle", "small", "start");
  const ME = MARKER("me", "triangle", "large", "end");
  const TIPPED = (id: string, d = "M0 0 L100 0 L100 50"): string => `<path id="${id}" d="${d}" fill="none" stroke="${RED}" stroke-width="2"${ENDS("ms", "me")}/>`;
  const sheet = (body: string): string => doc(DEFS(MS, ME) + LAYER + body + "</g>");
  const START = "circle small start #d55e00";
  const END = "triangle large end #d55e00";

  /// Le Forbici in `spots` su `id`, come le fa l'editor: gli id dei pezzi e
  /// le operazioni che li scrivono.
  function snipped(opened: Opened, id: string, spots: readonly Spot[]): { keys: string[]; ops: Arranged["ops"]; tips: ReturnType<typeof tipsOfCut> } {
    const model = opened.engine.model!;
    const node = nodeOf(model, opened.index.get(id)!);
    const nodable = nodableOf(node);
    if (typeof nodable === "string") throw new Error(nodable);
    const cut = cutAt(nodable.subs, spots)!;
    const plan = new Plan(model, ids(opened));
    const tips = tipsOfCut(cut);
    const keys = writePieces(plan, node, dsOf(piecesOf(cut))!, tips)!;
    return { keys, ops: plan.finish(keys).ops, tips };
  }

  /// Il Coltello lungo `cutter` su `id`.
  function knifed(opened: Opened, id: string, cutter: string): { keys: string[]; ops: Arranged["ops"] } {
    const model = opened.engine.model!;
    const node = nodeOf(model, opened.index.get(id)!);
    const nodable = nodableOf(node);
    if (typeof nodable === "string") throw new Error(nodable);
    const made = knifePieces(nodable.subs, subsOf(cutter))!;
    const plan = new Plan(model, ids(opened));
    const keys = writePieces(plan, node, made.pieces, made.tips)!;
    return { keys, ops: plan.finish(keys).ops };
  }

  it("la punta d'inizio resta al pezzo che comincia dove cominciava la forma, quella di fine all'ultimo", () => {
    const cut = cutAt(subsOf("M0 0 L100 0 L100 50"), [{ sub: 0, link: 0, t: 0.5 }, { sub: 0, link: 1, t: 0.5 }])!;
    expect(tipsOfCut(cut)).toEqual([{ start: true, end: false }, { start: false, end: false }, { start: false, end: true }]);
    // Un solo taglio: il primo pezzo ha l'inizio, il secondo la fine.
    expect(tipsOfCut(cutAt(subsOf("M0 0 L100 0"), [{ sub: 0, link: 0, t: 0.5 }])!)).toEqual([{ start: true, end: false }, { start: false, end: true }]);
  });

  it("un taglio su un nodo non toglie la punta del capo che non ha toccato", () => {
    // Si taglia sul nodo di mezzo: il primo pezzo è M0 0 L100 0, il secondo il resto.
    const cut = cutAt(subsOf("M0 0 L100 0 L100 50"), [{ sub: 0, link: 0, t: 1 }])!;
    expect(tipsOfCut(cut)).toEqual([{ start: true, end: false }, { start: false, end: true }]);
  });

  it("un sottotracciato chiuso che si taglia lascia pezzi senza punte; quelli che non tocca restano com'erano", () => {
    expect(tipsOfCut(cutAt(subsOf(RECT), [{ sub: 0, link: 1, t: 0.5 }])!)).toEqual([{ start: false, end: false }]);
    expect(tipsOfCut(cutAt(subsOf(RECT), [{ sub: 0, link: 0, t: 0.5 }, { sub: 0, link: 2, t: 0.5 }])!)).toEqual([{ start: false, end: false }, { start: false, end: false }]);
    // Il chiuso è il primo sottotracciato e l'aperto il secondo: la forma comincia ancora nel chiuso.
    const mixed = cutAt(subsOf("M0 0 L10 0 L10 10 Z M20 0 L40 0"), [{ sub: 1, link: 0, t: 0.5 }])!;
    expect(tipsOfCut(mixed)).toEqual([{ start: true, end: false }, { start: false, end: true }]);
  });

  it("con più sottotracciati, l'oggetto che porta il primo vertice e l'ultimo tiene tutte e due le punte", () => {
    // Il taglio nel sottotracciato di mezzo: il primo oggetto ha anche il primo e l'ultimo sottotracciato.
    const cut = cutAt(subsOf("M0 0 L10 0 M20 0 L30 0 M40 0 L50 0"), [{ sub: 1, link: 0, t: 0.5 }])!;
    expect(dsOf(piecesOf(cut))).toEqual(["M0 0 L10 0 M20 0 L25 0 M40 0 L50 0", "M25 0 L30 0"]);
    expect(tipsOfCut(cut)).toEqual([{ start: true, end: true }, { start: false, end: false }]);
    // Il taglio nell'ultimo: la fine passa al pezzo dopo.
    const last = cutAt(subsOf("M0 0 L10 0 M20 0 L30 0"), [{ sub: 1, link: 0, t: 0.5 }])!;
    expect(tipsOfCut(last)).toEqual([{ start: true, end: false }, { start: false, end: true }]);
  });

  it("le Forbici su un tracciato con più sottotracciati e le punte: ognuna al pezzo che ha il suo vertice", () => {
    const opened = followed(sheet(TIPPED("oa1a1a1a1", "M0 0 L10 0 M20 0 L30 0 M40 0 L50 0")));
    const { keys, ops } = snipped(opened, "oa1a1a1a1", [{ sub: 1, link: 0, t: 0.5 }]);
    expect(keys).toHaveLength(2);
    applied(opened, ops);
    expect([tipOf(opened, keys[0]!, "start"), tipOf(opened, keys[0]!, "end")]).toEqual([START, END]);
    expect([tipOf(opened, keys[1]!, "start"), tipOf(opened, keys[1]!, "end")]).toEqual([null, null]);
    expect(markersIn(opened)).toEqual(["ms", "me"]);
  });

  it("il Coltello: sul tracciato aperto, la punta d'inizio al primo pezzo e quella di fine all'ultimo", () => {
    const cutter = subsOf("M25 -10 L25 10 L75 -10 L75 10");
    expect(knifePieces(subsOf("M0 0 L100 0"), cutter)!.tips).toEqual([
      { start: true, end: false },
      { start: false, end: false },
      { start: false, end: false },
      { start: false, end: true },
    ]);
  });

  it("il Coltello: sulla forma chiusa i pezzi sono regioni, senza punte", () => {
    expect(knifePieces(subsOf(RECT), subsOf("M50 -10 L50 60"))!.tips).toEqual([{ start: false, end: false }, { start: false, end: false }]);
  });

  it("le Forbici sul tracciato con le punte: ognuna resta a un pezzo solo, senza copie", () => {
    const opened = followed(sheet(TIPPED("oa1a1a1a1")));
    const { keys, ops } = snipped(opened, "oa1a1a1a1", [{ sub: 0, link: 0, t: 0.5 }]);
    expect(keys).toHaveLength(2);
    const text = applied(opened, ops);
    expect(tipOf(opened, keys[0]!, "start")).toBe(START);
    expect(tipOf(opened, keys[0]!, "end")).toBeNull();
    expect(tipOf(opened, keys[1]!, "start")).toBeNull();
    expect(tipOf(opened, keys[1]!, "end")).toBe(END);
    expect(text).toContain(`<path id="oa1a1a1a1" d="M0 0 L50 0" fill="none" stroke="${RED}" stroke-width="2" marker-start="url(#ms)"/>`);
    expect(text).toContain(`<path id="${keys[1]}" d="M50 0 L100 0 L100 50" fill="none" stroke="${RED}" stroke-width="2" marker-end="url(#me)"/>`);
    // I marcatori sono quelli di prima, condivisi, e nessuno è rimasto senza chi lo usa.
    expect(markersIn(opened)).toEqual(["ms", "me"]);
  });

  it("le Forbici in due punti: il pezzo in mezzo non ha punte", () => {
    const opened = followed(sheet(TIPPED("oa1a1a1a1")));
    const { keys, ops } = snipped(opened, "oa1a1a1a1", [{ sub: 0, link: 0, t: 0.5 }, { sub: 0, link: 1, t: 0.5 }]);
    expect(keys).toHaveLength(3);
    applied(opened, ops);
    expect(keys.map((key) => [tipOf(opened, key, "start"), tipOf(opened, key, "end")])).toEqual([[START, null], [null, null], [null, END]]);
    expect(attrOf(opened, keys[1]!, "marker-start")).toBeNull();
    expect(attrOf(opened, keys[1]!, "marker-end")).toBeNull();
    expect(markersIn(opened)).toEqual(["ms", "me"]);
  });

  it("senza il seguito, le Forbici scrivono i riferimenti com'erano, e solo dove restano", () => {
    const opened = open(sheet(TIPPED("oa1a1a1a1")));
    const { keys, ops } = snipped(opened, "oa1a1a1a1", [{ sub: 0, link: 0, t: 0.5 }]);
    const outcome = opened.engine.apply(gesture(ops)!);
    expect(outcome.outcome).toBe("applied");
    expect(attrOf(opened, keys[0]!, "marker-start")).toBe("url(#ms)");
    expect(attrOf(opened, keys[0]!, "marker-end")).toBeNull();
    expect(attrOf(opened, keys[1]!, "marker-start")).toBeNull();
    expect(attrOf(opened, keys[1]!, "marker-end")).toBe("url(#me)");
  });

  it("una linea con le punte, tagliata, diventa due tracciati: l'inizio al primo, la fine al secondo", () => {
    const opened = followed(sheet(`<line id="oa1a1a1a1" x1="0" y1="0" x2="100" y2="0" stroke="${RED}" stroke-width="2"${ENDS("ms", "me")}/>`));
    const { keys, ops } = snipped(opened, "oa1a1a1a1", [{ sub: 0, link: 0, t: 0.5 }]);
    const text = applied(opened, ops);
    expect(text).not.toContain("<line");
    expect(keys[0]).toBe("oa1a1a1a1");
    expect([tipOf(opened, keys[0]!, "start"), tipOf(opened, keys[0]!, "end")]).toEqual([START, null]);
    expect([tipOf(opened, keys[1]!, "start"), tipOf(opened, keys[1]!, "end")]).toEqual([null, END]);
    expect(markersIn(opened)).toEqual(["ms", "me"]);
  });

  it("un marcatore che non è della raccolta segue lo stesso la parte a cui spetta", () => {
    const body = `<path id="oa1a1a1a1" d="M0 0 L100 0" fill="none" stroke="${RED}" marker-end="url(#cm)"/>`;
    const opened = followed(doc(DEFS(`<marker id="cm" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto"><circle cx="2" cy="2" r="2" fill="#000000"/></marker>`) + LAYER + body + "</g>"));
    const { keys, ops } = snipped(opened, "oa1a1a1a1", [{ sub: 0, link: 0, t: 0.5 }]);
    applied(opened, ops);
    expect(attrOf(opened, keys[0]!, "marker-end")).toBeNull();
    expect(attrOf(opened, keys[1]!, "marker-end")).toBe("url(#cm)");
    expect(markersIn(opened)).toEqual(["cm"]);
  });

  it("marker-mid non lo tocca nessun taglio", () => {
    const opened = followed(sheet(`<path id="oa1a1a1a1" d="M0 0 L50 0 L100 0" fill="none" stroke="${RED}" marker-mid="url(#ms)" marker-end="url(#me)"/>`));
    const { keys, ops } = snipped(opened, "oa1a1a1a1", [{ sub: 0, link: 0, t: 0.5 }]);
    applied(opened, ops);
    expect(keys.map((key) => attrOf(opened, key, "marker-mid"))).toEqual(["url(#ms)", "url(#ms)"]);
    expect(keys.map((key) => attrOf(opened, key, "marker-end") === null)).toEqual([true, false]);
  });

  it("tagliando una forma chiusa che aveva una punta, i pezzi non ne hanno e il marcatore se ne va", () => {
    const opened = followed(sheet(`<path id="oa1a1a1a1" d="${RECT}" fill="none" stroke="${RED}"${ENDS("ms", "me")}/>`));
    const { keys, ops } = snipped(opened, "oa1a1a1a1", [{ sub: 0, link: 1, t: 0.5 }]);
    expect(keys).toHaveLength(1);
    applied(opened, ops);
    expect(attrOf(opened, keys[0]!, "marker-start")).toBeNull();
    expect(attrOf(opened, keys[0]!, "marker-end")).toBeNull();
    expect(markersIn(opened)).toEqual([]);
  });

  it("il Coltello su un tracciato aperto con le punte", () => {
    const opened = followed(sheet(TIPPED("oa1a1a1a1", "M0 0 L100 0")));
    const { keys, ops } = knifed(opened, "oa1a1a1a1", "M25 -10 L25 10 L75 -10 L75 10");
    expect(keys).toHaveLength(4);
    applied(opened, ops);
    expect(keys.map((key) => [tipOf(opened, key, "start"), tipOf(opened, key, "end")])).toEqual([[START, null], [null, null], [null, null], [null, END]]);
    expect(markersIn(opened)).toEqual(["ms", "me"]);
  });

  it("il Coltello su una forma chiusa con punte: regioni senza punte, e i marcatori se ne vanno", () => {
    const opened = followed(sheet(`<path id="oa1a1a1a1" d="${RECT}" fill="${RED}" stroke="${RED}"${ENDS("ms", "me")}/>`));
    const { keys, ops } = knifed(opened, "oa1a1a1a1", "M50 -10 L50 60");
    expect(keys).toHaveLength(2);
    const text = applied(opened, ops);
    for (const key of keys) {
      expect(attrOf(opened, key, "marker-start")).toBeNull();
      expect(attrOf(opened, key, "marker-end")).toBeNull();
    }
    expect(text).not.toContain("marker-");
    expect(markersIn(opened)).toEqual([]);
  });
});

describe("le punte in «Unisci»", () => {
  const A = "oa3a3a3a3";
  const B = "ob3b3b3b3";
  const MARKERS: Record<string, string> = {
    ms: MARKER("ms", "circle", "small", "start"),
    me: MARKER("me", "triangle", "large", "end"),
    mb: MARKER("mb", "square", "medium", "end", BLUE),
    mbs: MARKER("mbs", "vee", "medium", "start", BLUE),
  };
  const START = "circle small start #d55e00";

  const path = (id: string, d: string, stroke: string, tips = ""): string => `<path id="${id}" d="${d}" fill="none" stroke="${stroke}"${tips}/>`;

  /// I marcatori che `body` usa: il disegno non ne tiene altri, perché uno
  /// che nessuno usa già in partenza non lo raccoglie nessun comando.
  const defsFor = (body: string): string => DEFS(...Object.entries(MARKERS).filter(([id]) => body.includes(`url(#${id})`)).map(([, marker]) => marker));

  /// «Unisci» su `keys`, col seguito delle punte; i testi di prima e di dopo.
  function joined(body: string, keys: readonly string[]): { opened: Opened; text: string } {
    const opened = followed(doc(defsFor(body) + LAYER + body + "</g>"));
    const done = joinOps(opened.engine.model!, keys.map((key) => opened.index.get(key)!), 0.5, ids(opened));
    if ("reason" in done) throw new Error(done.reason);
    return { opened, text: applied(opened, done.ops) };
  }

  it("un tracciato dopo l'altro: l'inizio è quello del primo, la fine quella del secondo, nel colore del primo", () => {
    const { opened, text } = joined(path(A, "M0 0 L50 0", RED, ENDS("ms", "me")) + path(B, "M50 0 L100 0", BLUE, ENDS(null, "mb")), [A, B]);
    expect(text).toContain(`d="M0 0 L50 0 L100 0"`);
    expect(text).not.toContain(B);
    expect(tipOf(opened, A, "start")).toBe(START);
    expect(tipOf(opened, A, "end")).toBe("square medium end #d55e00");
    // La fine che aveva, `me`, e il marcatore blu dell'altro non servono più.
    expect(markersIn(opened)).toHaveLength(2);
    expect(markersIn(opened)).toContain("ms");
    expect(markersIn(opened)).not.toContain("me");
  });

  it("l'altro si percorre al contrario: la sua punta d'inizio diventa la fine, del lato giusto", () => {
    const { opened } = joined(path(A, "M0 0 L50 0", RED, ENDS("ms", "me")) + path(B, "M100 0 L50 0", BLUE, ENDS("mbs", null)), [A, B]);
    expect(opened.engine.text).toContain(`d="M0 0 L50 0 L100 0"`);
    expect(tipOf(opened, A, "start")).toBe(START);
    expect(tipOf(opened, A, "end")).toBe("vee medium end #d55e00");
    expect(markersIn(opened)).toHaveLength(2);
  });

  it("il primo si percorre al contrario: la sua fine diventa l'inizio", () => {
    const { opened } = joined(path(A, "M50 0 L0 0", RED, ENDS("ms", "me")) + path(B, "M50 0 L100 0", BLUE, ENDS(null, "mb")), [A, B]);
    expect(opened.engine.text).toContain(`d="M0 0 L50 0 L100 0"`);
    // L'inizio nuovo è la fine di prima: la sua punta, riportata all'inizio.
    expect(tipOf(opened, A, "start")).toBe("triangle large start #d55e00");
    expect(tipOf(opened, A, "end")).toBe("square medium end #d55e00");
    expect(markersIn(opened)).toHaveLength(2);
  });

  it("un capo senza punta non ne eredita: la togliamo dal tracciato che resta", () => {
    const { opened } = joined(path(A, "M0 0 L50 0", RED, ENDS("ms", "me")) + path(B, "M50 0 L100 0", BLUE, ENDS("mbs", null)), [A, B]);
    expect(tipOf(opened, A, "start")).toBe(START);
    expect(attrOf(opened, A, "marker-end")).toBeNull();
    // La punta d'inizio di B stava nel punto di unione, e se n'è andata con B.
    expect(markersIn(opened)).toEqual(["ms"]);
  });

  it("un tracciato che si chiude da solo non ha più punte, e i marcatori che servivano a lui se ne vanno", () => {
    const { opened, text } = joined(path(A, "M0 0 L50 0 L50 50", RED, ENDS("ms", "me")), [A]);
    expect(text).toContain(`d="M0 0 L50 0 L50 50 Z"`);
    expect(text).not.toContain("marker-");
    expect(markersIn(opened)).toEqual([]);
  });

  it("due tracciati che chiudono un anello non hanno più punte", () => {
    const { opened, text } = joined(path(A, "M0 0 L50 0", RED, ENDS("ms", "me")) + path(B, "M50 0 L0 0", BLUE, ENDS("mbs", "mb")), [A, B]);
    expect(text).not.toContain("marker-");
    expect(text).not.toContain(B);
    expect(markersIn(opened)).toEqual([]);
  });

  it("le punte che stavano a metà di un oggetto con più sottotracciati non passano al risultato", () => {
    // A ha due sottotracciati: il primo è 0..50 e il secondo -200..-150; B li lega.
    // Il tracciato unito comincia dove comincia il secondo di A e finisce dove finisce il primo:
    // né l'una né l'altra sono il primo e l'ultimo vertice di A, e A perde le punte.
    const { opened, text } = joined(
      path(A, "M0 0 L50 0 M-200 0 L-150 0", RED, ENDS("ms", "me")) + path(B, "M-150 0 L0 0", BLUE, ENDS("mbs", "mb")),
      [A, B],
    );
    expect(text).toContain(`d="M-200 0 L-150 0 L0 0 L50 0"`);
    expect(text).not.toContain("marker-");
    expect(markersIn(opened)).toEqual([]);
  });

  it("le punte di un oggetto con più sottotracciati restano se il tracciato unito comincia e finisce nel suo primo e ultimo vertice", () => {
    const { opened } = joined(path(A, "M0 0 L50 0 M200 0 L250 0", RED, ENDS("ms", "me")) + path(B, "M50 0 L200 0", BLUE), [A, B]);
    expect(opened.engine.text).toContain(`d="M0 0 L50 0 L200 0 L250 0"`);
    expect(tipOf(opened, A, "start")).toBe(START);
    expect(tipOf(opened, A, "end")).toBe("triangle large end #d55e00");
    expect(markersIn(opened)).toEqual(["ms", "me"]);
  });

  it("un tracciato senza punte che si unisce a uno che ne ha prende quelle dei suoi capi", () => {
    const { opened } = joined(path(A, "M0 0 L50 0", RED, "") + path(B, "M50 0 L100 0", BLUE, ENDS("mbs", "mb")), [A, B]);
    // L'inizio di B sta in mezzo; la fine di B è la fine nuova.
    expect(attrOf(opened, A, "marker-start")).toBeNull();
    expect(tipOf(opened, A, "end")).toBe("square medium end #d55e00");
    expect(markersIn(opened)).toHaveLength(1);
  });

  it("le operazioni, senza il seguito, copiano il riferimento com'è scritto e tolgono quelli che cadono", () => {
    const body = path(A, "M0 0 L50 0", RED, ENDS("ms", "me")) + path(B, "M50 0 L100 0", BLUE, ENDS(null, "mb"));
    const opened = open(doc(defsFor(body) + LAYER + body + "</g>"));
    const done = joinOps(opened.engine.model!, [A, B].map((key) => opened.index.get(key)!), 0.5, ids(opened));
    if ("reason" in done) throw new Error(done.reason);
    const text = written(opened, done);
    expect(text).toContain(`<path id="${A}" d="M0 0 L50 0 L100 0" fill="none" stroke="${RED}" marker-start="url(#ms)" marker-end="url(#mb)"/>`);
    // Nessuna operazione scrive un marcatore o un colore.
    expect(done.ops.filter((op) => op.op === "add")).toEqual([]);
  });
});
