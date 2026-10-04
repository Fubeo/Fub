// Il contorno degli oggetti scelti: i tratteggi misurati in spessori e
// uguali con ogni estremo, quali forme hanno un contorno, ciò che il menu
// mostra, e le operazioni, che il motore accetta così come sono e che un
// annulla disfa al byte.

import { describe, expect, it } from "vitest";
import { doc } from "../scene/test-support";
import { gesture, NewIds } from "./edit";
import { dashOf, dashValue, lookOf, outlineOps, outlinesOf, type OutlineChange, type Outlined } from "./outline";
import { arrowPath } from "./shapes";
import { LAYER, open, type Opened } from "./test-support";

const INK = "1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8";
const BRUSH = "pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

const RECT = (id: string, extra = ' fill="none" stroke="#000000" stroke-width="2"'): string => `<rect id="${id}" x="0" y="0" width="10" height="10"${extra}/>`;
const ARROW = `<path id="oarrow000" fub:shape="arrow" fub:geom="0 0 100 0" d="${arrowPath(0, 0, 100, 0, 2)}" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;

/// Le scelte su tutti gli oggetti del disegno.
function outlined(opened: Opened, change: OutlineChange): Outlined {
  return outlineOps(opened.engine.model!, opened.index.units, change, ids(opened));
}

/// Applica `outlined`, verifica che un annulla riporti il testo di prima, e
/// torna il testo di dopo.
function applied(opened: Opened, change: Outlined): string {
  const before = opened.engine.text;
  const outcome = opened.engine.apply(gesture(change.ops)!);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = opened.engine.text;
  expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(opened.engine.text).toBe(before);
  expect(opened.engine.apply(gesture(change.ops)!).outcome).toBe("applied");
  return after;
}

describe("i tratteggi", () => {
  it("si misurano in spessori", () => {
    expect(dashValue("solid", 2, "butt")).toBe("none");
    expect(dashValue("dashed", 2, "butt")).toBe("8 6");
    expect(dashValue("dashed", 8, "butt")).toBe("32 24");
    expect(dashValue("dotted", 2, "butt")).toBe("2 4");
    expect(dashValue("dashdot", 2, "butt")).toBe("8 4 2 4");
    expect(dashValue("dashed", 0.75, "butt")).toBe("3 2.25");
  });

  it("si vedono uguali con ogni estremo: gli estremi tondi e quadrati allungano il trattino di uno spessore", () => {
    expect(dashValue("dashed", 2, "round")).toBe("6 8");
    expect(dashValue("dashed", 2, "square")).toBe("6 8");
    // Un punto è un trattino lungo zero, che l'estremo fa tondo o quadrato.
    expect(dashValue("dotted", 2, "round")).toBe("0 6");
    expect(dashValue("dashdot", 4, "round")).toBe("12 12 0 12");
  });

  it("si riconoscono anche scritti in un altro modo, e solo per lo spessore e gli estremi giusti", () => {
    expect(dashOf("none", 2, "butt")).toBe("solid");
    expect(dashOf(" 8, 6 ", 2, "butt")).toBe("dashed");
    expect(dashOf("8.00 6", 2, "butt")).toBe("dashed");
    expect(dashOf("8 6", 2, "round")).toBeNull();
    expect(dashOf("8 6", 4, "butt")).toBeNull();
    expect(dashOf("5 1 2", 2, "butt")).toBeNull();
    expect(dashOf("0 6", 2, "round")).toBe("dotted");
  });
});

describe("i contorni della selezione", () => {
  it("sono le forme con un contorno che si vede, anche dentro un gruppo, in ordine di documento", () => {
    const opened = open(
      doc(
        `${LAYER}${RECT("oaaaaaaaa")}${RECT("obbbbbbbb", ' fill="#000000"')}` +
          `<path id="occcccccc" fub:tool="pen" fub:brush="${BRUSH}" d="M0 0 Z" fill="#000000" fub:ink="${INK}"/>` +
          `<text id="odddddddd" x="0" y="20" stroke="#000000">Ciao</text>` +
          `<g id="oeeeeeeee">${RECT("offfffff1")}<ellipse id="offfffff2" cx="5" cy="5" rx="5" ry="5" fill="none" stroke="#000000" stroke-width="0"/></g>` +
          `${ARROW}</g>`,
      ),
    );
    const found = outlinesOf(opened.engine.model!, opened.index.units).map((outline) => outline.node.facts.id);
    // Senza `stroke` non c'è contorno; con spessore zero non si vede; il
    // tratto a penna è riempimento, il testo non ha contorno.
    expect(found).toEqual(["oaaaaaaaa", "offfffff1", "oarrow000"]);
  });

  it("leggono ciò che ereditano dal gruppo, dal livello e dalla radice", () => {
    const opened = open(
      doc(
        `<g id="l1" fub:layer="Livello 1" stroke-linejoin="bevel">` +
          `<g id="oaaaaaaaa" stroke="#000000" stroke-width="4" stroke-dasharray="16 12"><rect id="obbbbbbbb" x="0" y="0" width="10" height="10"/></g></g>`,
      ),
    );
    const [outline] = outlinesOf(opened.engine.model!, opened.index.units);
    expect(outline).toMatchObject({ width: 4, cap: "butt", join: "bevel", dashes: "16 12" });
    expect(outline!.inherited).toEqual({ cap: "butt", join: "bevel", dashes: "16 12" });
    expect(lookOf([outline!])).toEqual({ dash: "dashed", custom: null, cap: "butt", join: "bevel" });
  });

  it("nel menu: ciò che hanno tutti uguale, un tratteggio che non è del menu col suo valore, niente dove sono diversi", () => {
    const of = (body: string) => {
      const opened = open(doc(`${LAYER}${body}</g>`));
      return lookOf(outlinesOf(opened.engine.model!, opened.index.units));
    };
    expect(of(`${RECT("oaaaaaaaa")}${RECT("obbbbbbbb")}`)).toEqual({ dash: "solid", custom: null, cap: "butt", join: "miter" });
    expect(of(RECT("oaaaaaaaa", ' stroke="#000000" stroke-width="2" stroke-dasharray="5,1 2"'))).toEqual({ dash: "custom", custom: "5 1 2", cap: "butt", join: "miter" });
    expect(of(`${RECT("oaaaaaaaa")}${ARROW}`)).toEqual({ dash: "solid", custom: null, cap: null, join: null });
    expect(of(`${RECT("oaaaaaaaa", ' stroke="#000000" stroke-width="2" stroke-dasharray="5 1"')}${RECT("obbbbbbbb", ' stroke="#000000" stroke-width="2" stroke-dasharray="1 5"')}`)).toEqual({
      dash: null,
      custom: null,
      cap: "butt",
      join: "miter",
    });
    expect(of(`${RECT("oaaaaaaaa")}${RECT("obbbbbbbb", ' stroke="#000000" stroke-width="2" stroke-dasharray="8 6"')}`).dash).toBeNull();
    expect(of(RECT("oaaaaaaaa", ' fill="#000000"'))).toEqual({ dash: null, custom: null, cap: null, join: null });
  });
});

describe("le scelte", () => {
  it("scrivono il tratteggio su ogni contorno col suo spessore, in un batch che si annulla al byte", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa")}${RECT("obbbbbbbb", ' stroke="#000000" stroke-width="8"')}</g>`));
    const change = outlined(opened, { dash: "dashed" });
    expect(change.ops).toEqual([
      { op: "set", id: "oaaaaaaaa", attrs: { "stroke-dasharray": "8 6" } },
      { op: "set", id: "obbbbbbbb", attrs: { "stroke-dasharray": "32 24" } },
    ]);
    expect(change.changed).toBe(2);
    expect(change.keys).toEqual(["oaaaaaaaa", "obbbbbbbb"]);
    const text = applied(opened, change);
    expect(text).toContain('stroke-width="2" stroke-dasharray="8 6"');
    expect(text).toContain('stroke-width="8" stroke-dasharray="32 24"');
  });

  it("il continuo toglie il tratteggio, o scrive none se lo erediterebbe", () => {
    const opened = open(
      doc(
        `${LAYER}${RECT("oaaaaaaaa", ' stroke="#000000" stroke-width="2" stroke-dasharray="8 6"')}` +
          `<g id="obbbbbbbb" stroke-dasharray="4 4">${RECT("occcccccc")}</g></g>`,
      ),
    );
    const change = outlined(opened, { dash: "solid" });
    expect(change.ops).toEqual([
      { op: "set", id: "oaaaaaaaa", attrs: { "stroke-dasharray": null } },
      { op: "set", id: "occcccccc", attrs: { "stroke-dasharray": "none" } },
    ]);
    // La selezione è il gruppo, che resta com'era.
    expect(change.keys).toEqual(["oaaaaaaaa", "obbbbbbbb"]);
    applied(opened, change);
  });

  it("un oggetto senza id ne riceve uno, e la selezione lo segue", () => {
    const opened = open(doc(`${LAYER}<rect x="0" y="0" width="10" height="10" fill="none" stroke="#000000" stroke-width="2"/>${RECT("obbbbbbbb")}</g>`));
    const change = outlined(opened, { join: "round" });
    const id = change.keys[0]!;
    expect(id).toMatch(/^o[a-z0-9]{8}$/);
    expect(change.ops).toEqual([
      { op: "ident", path: [0, 0], tag: "rect", id },
      { op: "set", id, attrs: { "stroke-linejoin": "round" } },
      { op: "set", id: "obbbbbbbb", attrs: { "stroke-linejoin": "round" } },
    ]);
    expect(change.keys).toEqual([id, "obbbbbbbb"]);
    applied(opened, change);
  });

  it("gli estremi riscrivono il tratteggio del menu, perché si veda uguale; uno su misura resta", () => {
    const opened = open(
      doc(`${LAYER}${RECT("oaaaaaaaa", ' stroke="#000000" stroke-width="2" stroke-dasharray="2 4"')}${RECT("obbbbbbbb", ' stroke="#000000" stroke-width="2" stroke-dasharray="5 1"')}</g>`),
    );
    const change = outlined(opened, { cap: "round" });
    expect(change.ops).toEqual([
      { op: "set", id: "oaaaaaaaa", attrs: { "stroke-linecap": "round", "stroke-dasharray": "0 6" } },
      { op: "set", id: "obbbbbbbb", attrs: { "stroke-linecap": "round" } },
    ]);
    applied(opened, change);
    const back = outlined(opened, { cap: "butt" });
    expect(back.ops).toEqual([
      { op: "set", id: "oaaaaaaaa", attrs: { "stroke-linecap": null, "stroke-dasharray": "2 4" } },
      { op: "set", id: "obbbbbbbb", attrs: { "stroke-linecap": null } },
    ]);
  });

  it("un valore che la forma vede comunque si toglie: gli angoli vivi di una freccia", () => {
    const opened = open(doc(`${LAYER}${ARROW}</g>`));
    const change = outlined(opened, { join: "miter" });
    expect(change.ops).toEqual([{ op: "set", id: "oarrow000", attrs: { "stroke-linejoin": null } }]);
    const text = applied(opened, change);
    expect(text).not.toContain("stroke-linejoin");
    // La geometria della freccia non cambia.
    expect(text).toContain(`d="${arrowPath(0, 0, 100, 0, 2)}"`);
  });

  it("un tratteggio scritto in un altro modo non si riscrive, e una scelta che non cambia niente non ha operazioni", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa", ' stroke="#000000" stroke-width="2" stroke-dasharray="8,6"')}${RECT("obbbbbbbb", ' fill="#000000"')}</g>`));
    expect(outlined(opened, { dash: "dashed" })).toEqual({ ops: [], keys: ["oaaaaaaaa", "obbbbbbbb"], changed: 0 });
    expect(outlined(opened, { cap: "butt" }).ops).toEqual([]);
  });
});
