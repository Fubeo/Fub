// I comandi che spostano gli elementi e i fogli di stile del disegno: un
// comando che farebbe scegliere altro a un foglio si riconosce, uno che non
// cambia ciò che il foglio sceglie passa.

import { describe, expect, it } from "vitest";
import { doc } from "../scene/test-support";
import { groupOps, orderOps, ungroupOps, type Arranged } from "./arrange";
import { NewIds } from "./edit";
import { restyles } from "./styled";
import { LAYER, open, type Opened } from "./test-support";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

/// Le operazioni del comando, che deve averne.
function opsOf(arranged: Arranged | "foreign" | null): Arranged["ops"] {
  if (arranged === null || arranged === "foreign") throw new Error("comando rifiutato");
  expect(arranged.ops.length).toBeGreaterThan(0);
  return arranged.ops;
}

/// Separa tutti i gruppi in cima al disegno `source`.
function ungrouping(source: string): [Opened, Arranged["ops"]] {
  const opened = open(source);
  return [opened, opsOf(ungroupOps(opened.engine.model!, opened.index.units, ids(opened)))];
}

/// Raggruppa gli oggetti `keys` del disegno `source`.
function grouping(source: string, ...keys: string[]): [Opened, Arranged["ops"]] {
  const opened = open(source);
  const units = opened.index.units.filter((unit) => keys.includes(unit.key));
  return [opened, opsOf(groupOps(opened.engine.model!, units, ids(opened)))];
}

const MERMAID = doc(
  '<style>#m .node rect{fill:#ECECFF;stroke:#9370DB}#m .label{font-family:Inter}#m .edge{stroke:#333;fill:none}</style>'
    + '<g id="m"><g class="node"><rect x="10" y="50" width="90" height="40"/><text class="label" x="55" y="75">Inizio</text></g>'
    + '<path class="edge" d="M 100 70 L 140 70"/><path d="M 140 64 L 150 70 L 140 76 Z" fill="#333"/></g>',
);

describe("separare", () => {
  it("si riconosce quando un foglio sceglie ciò che contiene passando dal gruppo, come in Mermaid", () => {
    const [opened, ops] = ungrouping(MERMAID);
    expect(restyles(opened.engine.text, ops)).toBe(true);
  });

  it("passa senza fogli, e con un foglio che sceglie per classe, come quelli di Illustrator", () => {
    const [plain, plainOps] = ungrouping(doc('<g id="m"><rect id="oaaaaaaaa" width="1" height="1"/><rect id="obbbbbbbb" width="1" height="1"/></g>'));
    expect(restyles(plain.engine.text, plainOps)).toBe(false);
    const [classes, classOps] = ungrouping(doc('<style>.st0{fill:#FF0000}.st1{stroke:#000}</style><g id="m"><rect class="st0" width="1" height="1"/><path class="st1" d="M0 0L1 1"/></g>'));
    expect(restyles(classes.engine.text, classOps)).toBe(false);
  });

  it("si riconosce col foglio di un SVG incollato, chiuso nel suo gruppo", () => {
    const [opened, ops] = ungrouping(doc('<g id="p"><style>#p rect{fill:red}</style><rect id="oaaaaaaaa" width="1" height="1"/><circle id="obbbbbbbb" r="1"/></g>'));
    expect(restyles(opened.engine.text, ops)).toBe(true);
  });

  it("si riconosce quando il foglio sceglie il gruppo stesso, da cui i figli ereditano", () => {
    const [opened, ops] = ungrouping(doc('<style>#m{font-family:Inter}</style><g id="m"><text id="oaaaaaaaa" x="0" y="10"><tspan>Ciao</tspan></text><rect id="obbbbbbbb" width="1" height="1"/></g>'));
    expect(restyles(opened.engine.text, ops)).toBe(true);
  });

  it("passa quando il foglio sceglie solo oggetti fuori dal gruppo", () => {
    const [opened, ops] = ungrouping(doc('<style>#solo{fill:red}</style><rect id="solo" width="1" height="1"/><g id="m"><rect id="oaaaaaaaa" width="1" height="1"/><rect id="obbbbbbbb" width="1" height="1"/></g>'));
    expect(restyles(opened.engine.text, ops)).toBe(false);
  });
});

describe("raggruppare", () => {
  const RECTS = '<rect id="oaaaaaaaa" width="1" height="1"/><rect id="obbbbbbbb" x="2" width="1" height="1"/></g>';

  it("si riconosce quando il foglio sceglie i figli diretti del livello", () => {
    const [opened, ops] = grouping(doc(`<style>#l1 > rect{fill:red}</style>${LAYER}${RECTS}`), "oaaaaaaaa", "obbbbbbbb");
    expect(restyles(opened.engine.text, ops)).toBe(true);
  });

  it("passa quando il foglio sceglie i discendenti del livello, che restano tali", () => {
    const [opened, ops] = grouping(doc(`<style>#l1 rect{fill:red}</style>${LAYER}${RECTS}`), "oaaaaaaaa", "obbbbbbbb");
    expect(restyles(opened.engine.text, ops)).toBe(false);
  });

  it("si riconosce quando il foglio sceglie il gruppo nuovo, da cui i figli erediterebbero", () => {
    const [opened, ops] = grouping(doc(`<style>g g{opacity:.5}</style>${LAYER}${RECTS}`), "oaaaaaaaa", "obbbbbbbb");
    expect(restyles(opened.engine.text, ops)).toBe(true);
  });
});

describe("riordinare", () => {
  const BODY = `${LAYER}<rect id="oaaaaaaaa" width="1" height="1"/><rect id="obbbbbbbb" x="2" width="1" height="1"/><rect id="occcccccc" x="4" width="1" height="1"/></g>`;

  /// Porta in primo piano il primo rettangolo.
  function fronting(source: string): [Opened, Arranged["ops"]] {
    const opened = open(source);
    const units = opened.index.units.filter((unit) => unit.key === "oaaaaaaaa");
    return [opened, opsOf(orderOps(opened.engine.model!, opened.index, units, "front", ids(opened)))];
  }

  it("si riconosce quando il foglio sceglie per posizione fra i fratelli", () => {
    for (const css of ["rect:first-child{fill:red}", "#oaaaaaaaa + rect{fill:red}", "rect:nth-child(2n){fill:red}"]) {
      const [opened, ops] = fronting(doc(`<style>${css}</style>${BODY}`));
      expect(restyles(opened.engine.text, ops), css).toBe(true);
    }
  });

  it("passa quando il foglio non guarda la posizione", () => {
    const [opened, ops] = fronting(doc(`<style>#l1 rect{fill:red} #oaaaaaaaa{stroke:blue}</style>${BODY}`));
    expect(restyles(opened.engine.text, ops)).toBe(false);
  });
});

describe("nel dubbio", () => {
  it("un foglio che non si legge del tutto vale come un cambiamento", () => {
    const [nested, nestedOps] = ungrouping(doc('<style>.x{ .y{fill:red} }</style><g id="m"><rect id="oaaaaaaaa" width="1" height="1"/><rect id="obbbbbbbb" width="1" height="1"/></g>'));
    expect(restyles(nested.engine.text, nestedOps)).toBe(true);
    const [has, hasOps] = ungrouping(doc('<style>svg:has(> rect){fill:red}</style><g id="m"><rect id="oaaaaaaaa" width="1" height="1"/><rect id="obbbbbbbb" width="1" height="1"/></g>'));
    expect(restyles(has.engine.text, hasOps)).toBe(true);
  });

  it("i fogli che cambiano ordine fra loro sono un cambiamento", () => {
    const opened = open(doc('<style>rect{fill:red}</style><style>rect{fill:blue}</style><rect id="oaaaaaaaa" width="1" height="1"/>'));
    expect(restyles(opened.engine.text, [{ op: "move", target: { path: [0], tag: "style" }, parent: "#root", pos: { last: true } }])).toBe(true);
  });

  it("i fogli che non sono CSS non contano", () => {
    const [opened, ops] = ungrouping(doc('<style type="text/x-other">#m rect{fill:red}</style><g id="m"><rect id="oaaaaaaaa" width="1" height="1"/><rect id="obbbbbbbb" width="1" height="1"/></g>'));
    expect(restyles(opened.engine.text, ops)).toBe(false);
  });
});
