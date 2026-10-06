// Spostare nell'albero: le operazioni di ogni gesto, che il motore le accetta
// così come sono, che ciò che si vede resta com'era e che un annulla riporta
// il testo identico.

import { describe, expect, it } from "vitest";
import { elementChildren, type ContainerNode, type ElementPart } from "../scene/model";
import { doc } from "../scene/test-support";
import type { Arranged } from "./arrange";
import { gesture, NewIds } from "./edit";
import type { SceneIndex } from "./hit";
import { placeOps, type Place } from "./place";
import { LAYER, open, type Opened } from "./test-support";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

/// Applica `arranged` e verifica che un annulla riporti il testo di prima.
function applied(opened: Opened, arranged: Arranged): SceneIndex {
  const before = opened.engine.text;
  const outcome = opened.engine.apply(gesture(arranged.ops)!);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = opened.engine.text;
  expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(opened.engine.text).toBe(before);
  expect(opened.engine.apply(gesture(arranged.ops)!).outcome).toBe("applied");
  expect(opened.engine.text).toBe(after);
  return opened.reindex();
}

/// L'elemento di id `id`.
function node(opened: Opened, id: string): ElementPart {
  const found = opened.engine.holder(id);
  if (found === null) throw new Error(`nessun elemento ${id}`);
  return found;
}

/// Il contenitore di id `id`, o la radice per `#root`.
const container = (opened: Opened, id: string): ContainerNode => (id === "#root" ? opened.engine.model!.root : (node(opened, id) as ContainerNode));

/// Gli id dei figli di `id`, in ordine di documento.
const children = (opened: Opened, id: string): (string | null)[] => elementChildren(container(opened, id)).map((child) => child.facts.id);

function place(opened: Opened, moving: readonly string[], parent: string, at: Place): Arranged {
  const out = placeOps(opened.engine.model!, moving.map((id) => node(opened, id)), container(opened, parent), at, ids(opened));
  if (out === null) throw new Error("impossibile");
  return out;
}

const RECT = (id: string, x: number, extra = ""): string => `<rect id="${id}" x="${x}" y="0" width="10" height="10"${extra}/>`;

describe("placeOps", () => {
  it("riordina fra i fratelli con un `move` solo, davanti a chi si sceglie", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa", 0)}${RECT("obbbbbbbb", 20)}${RECT("occcccccc", 40)}</g>`));
    const arranged = place(opened, ["oaaaaaaaa"], "l1", { after: node(opened, "occcccccc") });
    expect(arranged.ops).toEqual([{ op: "move", target: "oaaaaaaaa", parent: "l1", pos: { after: "occcccccc" } }]);
    expect(arranged.keys).toEqual(["oaaaaaaaa"]);
    applied(opened, arranged);
    expect(children(opened, "l1")).toEqual(["obbbbbbbb", "occcccccc", "oaaaaaaaa"]);
  });

  it("porta più oggetti insieme, nel loro ordine, dietro a tutti o davanti a tutti", () => {
    const opened = open(doc(`${LAYER}<title>Livello</title>${RECT("oaaaaaaaa", 0)}${RECT("obbbbbbbb", 20)}${RECT("occcccccc", 40)}${RECT("odddddddd", 60)}</g>`));
    // Vanno nell'ordine del documento; le chiavi tornano in quello dato.
    const back = place(opened, ["odddddddd", "obbbbbbbb"], "l1", "first");
    expect(back.keys).toEqual(["odddddddd", "obbbbbbbb"]);
    applied(opened, back);
    // Dietro a tutti, ma dopo il titolo.
    expect(children(opened, "l1")).toEqual([null, "obbbbbbbb", "odddddddd", "oaaaaaaaa", "occcccccc"]);
    applied(opened, place(opened, ["obbbbbbbb", "odddddddd"], "l1", "last"));
    expect(children(opened, "l1")).toEqual([null, "oaaaaaaaa", "occcccccc", "obbbbbbbb", "odddddddd"]);
  });

  it("non fa niente se gli oggetti sono già lì, e salta chi si sposta quando è il riferimento", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa", 0)}${RECT("obbbbbbbb", 20)}${RECT("occcccccc", 40)}</g>`));
    expect(place(opened, ["obbbbbbbb"], "l1", { after: node(opened, "oaaaaaaaa") })).toEqual({ ops: [], keys: ["obbbbbbbb"] });
    // Davanti a sé stesso è dove sta già.
    expect(place(opened, ["obbbbbbbb", "occcccccc"], "l1", { after: node(opened, "occcccccc") }).ops).toEqual([]);
    expect(place(opened, ["occcccccc"], "l1", "last").ops).toEqual([]);
  });

  it("dà un id a chi non ce l'ha, e lo torna come chiave", () => {
    const opened = open(doc(`${LAYER}<rect width="1" height="1"/>${RECT("obbbbbbbb", 20)}</g>`));
    const rect = elementChildren(container(opened, "l1"))[0]!;
    const arranged = placeOps(opened.engine.model!, [rect], container(opened, "l1"), "last", ids(opened))!;
    expect(arranged.keys[0]).toMatch(/^o[a-z0-9]{8}$/);
    applied(opened, arranged);
    expect(children(opened, "l1")).toEqual(["obbbbbbbb", arranged.keys[0]]);
  });

  it("dà un id anche a chi va con un altro, e torna le chiavi nell'ordine dato", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa", 0)}<g id="og1g1g1g1"><rect width="1" height="1"/></g></g>`));
    const inner = elementChildren(container(opened, "og1g1g1g1"))[0]!;
    const arranged = placeOps(opened.engine.model!, [inner, node(opened, "og1g1g1g1")], container(opened, "l1"), "first", ids(opened))!;
    expect(arranged.keys[0]).toMatch(/^o[a-z0-9]{8}$/);
    expect(arranged.keys[1]).toBe("og1g1g1g1");
    applied(opened, arranged);
    expect(children(opened, "l1")).toEqual(["og1g1g1g1", "oaaaaaaaa"]);
    expect(children(opened, "og1g1g1g1")).toEqual([arranged.keys[0]]);
  });

  it("entrando in un gruppo trasformato resta dove si vedeva", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa", 40)}<g id="og1g1g1g1" transform="translate(100 0) scale(2)">${RECT("obbbbbbbb", 0)}</g></g>`));
    const before = opened.index.get("oaaaaaaaa")!.bounds;
    const arranged = place(opened, ["oaaaaaaaa"], "og1g1g1g1", "first");
    expect(arranged.ops).toEqual([
      { op: "set", id: "oaaaaaaaa", attrs: { transform: "matrix(0.5 0 0 0.5 -50 0)" } },
      { op: "move", target: "oaaaaaaaa", parent: "og1g1g1g1", pos: { first: true } },
    ]);
    applied(opened, arranged);
    expect(children(opened, "og1g1g1g1")).toEqual(["oaaaaaaaa", "obbbbbbbb"]);
    const inner = opened.seen(new Set([container(opened, "og1g1g1g1")])).find((unit) => unit.key === "oaaaaaaaa")!;
    expect(inner.bounds).toEqual(before);
  });

  it("uscendo da un gruppo si porta lo stile che ereditava, e in uno nuovo resta del suo colore", () => {
    const opened = open(
      doc(
        `${LAYER}<g id="og1g1g1g1" fill="#d55e00" stroke="#000000" font-size="30"><rect id="oaaaaaaaa" width="10" height="10"/>` +
          `<text id="otttttttt" x="0" y="20"><tspan x="0" dy="0">Ciao</tspan></text></g>` +
          `<g id="og2g2g2g2" fill="#0072b2"><rect id="obbbbbbbb" width="10" height="10"/></g></g>`,
      ),
    );
    const out = place(opened, ["oaaaaaaaa", "otttttttt"], "l1", "last");
    expect(out.ops).toEqual([
      { op: "set", id: "oaaaaaaaa", attrs: { fill: "#d55e00", stroke: "#000000" } },
      { op: "move", target: "oaaaaaaaa", parent: "l1", pos: { last: true } },
      { op: "set", id: "otttttttt", attrs: { fill: "#d55e00", stroke: "#000000", "font-size": "30" } },
      { op: "move", target: "otttttttt", parent: "l1", pos: { after: "oaaaaaaaa" } },
    ]);
    applied(opened, out);
    // Dal livello, che non scrive il riempimento, a un gruppo che lo scrive:
    // il nero di partenza.
    const into = place(opened, ["obbbbbbbb"], "l1", "last");
    expect(into.ops[0]).toEqual({ op: "set", id: "obbbbbbbb", attrs: { fill: "#0072b2" } });
    const black = open(doc(`${LAYER}<rect id="oaaaaaaaa" width="10" height="10"/><g id="og2g2g2g2" fill="#0072b2"/></g>`));
    expect(place(black, ["oaaaaaaaa"], "og2g2g2g2", "last").ops[0]).toEqual({ op: "set", id: "oaaaaaaaa", attrs: { fill: "#000000" } });
  });

  it("lascia al contenitore l'opacità e ciò che un oggetto scrive già di suo", () => {
    const opened = open(doc(`${LAYER}<g id="og1g1g1g1" opacity="0.5" fill="#d55e00"><rect id="oaaaaaaaa" width="10" height="10" fill="#000000"/></g></g>`));
    expect(place(opened, ["oaaaaaaaa"], "l1", "last").ops).toEqual([{ op: "move", target: "oaaaaaaaa", parent: "l1", pos: { last: true } }]);
  });

  it("sposta un livello sopra o sotto un altro, dopo titolo e carta", () => {
    const opened = open(
      doc(
        `<title>Disegno</title><rect fub:role="paper" width="100" height="100" fill="#ffffff"/>` +
          `<g id="l1" fub:layer="Uno"/><g id="l2" fub:layer="Due"/><g id="l3" fub:layer="Tre"/>`,
      ),
    );
    const up = place(opened, ["l1"], "#root", { after: node(opened, "l3") });
    expect(up.ops).toEqual([{ op: "move", target: "l1", parent: "#root", pos: { after: "l3" } }]);
    applied(opened, up);
    expect(elementChildren(opened.engine.model!.root).map((child) => child.facts.id)).toEqual([null, null, "l2", "l3", "l1"]);
    applied(opened, place(opened, ["l1"], "#root", "first"));
    expect(elementChildren(opened.engine.model!.root).map((child) => child.facts.id)).toEqual([null, null, "l1", "l2", "l3"]);
  });

  it("rifiuta di portare un gruppo dentro di sé", () => {
    const opened = open(doc(`${LAYER}<g id="og1g1g1g1"><g id="og2g2g2g2">${RECT("oaaaaaaaa", 0)}</g></g></g>`));
    const model = opened.engine.model!;
    expect(placeOps(model, [node(opened, "og1g1g1g1")], container(opened, "og2g2g2g2"), "last", ids(opened))).toBeNull();
    expect(placeOps(model, [node(opened, "og1g1g1g1")], container(opened, "og1g1g1g1"), "last", ids(opened))).toBeNull();
    // Chi sta dentro un altro che si sposta va con lui, e tiene la sua chiave.
    const both = placeOps(model, [node(opened, "oaaaaaaaa"), node(opened, "og1g1g1g1")], container(opened, "l1"), "first", ids(opened))!;
    expect(both.keys).toEqual(["oaaaaaaaa", "og1g1g1g1"]);
  });

  it("rifiuta un contenitore che schiaccia il piano", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa", 0)}<g id="og1g1g1g1" transform="scale(0)"/></g>`));
    expect(placeOps(opened.engine.model!, [node(opened, "oaaaaaaaa")], container(opened, "og1g1g1g1"), "last", ids(opened))).toBeNull();
  });
});
