// Le Forbici, il Coltello e «Unisci» sul documento: i pezzi che diventano
// oggetti, col loro aspetto, e i tracciati che diventano uno. Ogni comando è
// un passo solo, e un annulla riporta tutto al byte.

import { describe, expect, it } from "vitest";
import { parsePath } from "../scene/geometry";
import { pathData } from "../scene/serialize";
import { doc } from "../scene/test-support";
import { nodeOf, Plan, type Arranged } from "./arrange";
import { cutAt } from "./cut";
import { gesture, NewIds } from "./edit";
import { readNodes, writeNodes, type Subpath } from "./nodes";
import { dsOf, holdsOpenPath, joinOps, knifePieces, piecesOf, writePieces } from "./scissors";
import { LAYER, open, type Opened } from "./test-support";

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
    expect(knifePieces(subsOf(RECT), blade("M50 -10 L50 60"))).toEqual(["M0 0 L50 0 L50 50 L0 50 Z", "M100 0 L100 50 L50 50 L50 0 Z"]);
  });

  it("un tratto che entra e non esce, o che passa accanto, non taglia", () => {
    expect(knifePieces(subsOf(RECT), blade("M50 -10 L50 25"))).toBeNull();
    expect(knifePieces(subsOf(RECT), blade("M150 -10 L150 60"))).toBeNull();
  });

  it("taglia un tracciato aperto dove lo incrocia", () => {
    // Il zig-zag passa tre volte: a 25, a 50 di traverso e a 75.
    expect(knifePieces(subsOf("M0 0 L100 0"), blade("M25 -10 L25 10 L75 -10 L75 10"))).toEqual(["M0 0 L25 0", "M25 0 L50 0", "M50 0 L75 0", "M75 0 L100 0"]);
    expect(knifePieces(subsOf("M0 0 L100 0"), blade("M0 10 L100 10"))).toBeNull();
  });

  it("non taglia una forma con sottotracciati chiusi e aperti insieme", () => {
    expect(knifePieces(subsOf(`${RECT} M0 80 L100 80`), blade("M50 -10 L50 90"))).toBeNull();
  });
});

describe("i pezzi scritti nel documento", () => {
  it("il primo al posto della forma, col suo id; gli altri sopra, col suo aspetto", () => {
    const opened = open(doc(`${LAYER}<rect id="oa1a1a1a1" x="0" y="0" width="100" height="50" fill="#d55e00" opacity="0.5" transform="translate(10 0)"/><circle id="ob1b1b1b1" cx="0" cy="0" r="5"/></g>`));
    const model = opened.engine.model!;
    const plan = new Plan(model, ids(opened));
    const node = nodeOf(model, opened.index.get("oa1a1a1a1")!);
    const keys = writePieces(plan, node, ["M0 0 L50 0 L50 50 L0 50 Z", "M100 0 L100 50 L50 50 L50 0 Z"])!;
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
