// La selezione avanzata fuori dal foglio: i simili, l'inversa, e gli oggetti
// bloccati e nascosti uno per uno, con operazioni che il motore accetta così
// come sono e che un annulla disfa al byte.

import { describe, expect, it } from "vitest";
import { doc } from "../scene/test-support";
import type { ContainerNode } from "../scene/model";
import { nodeOf } from "./arrange";
import { gesture, NewIds } from "./edit";
import type { SceneIndex, Unit } from "./hit";
import { allUnits, flagged, flagOps, hasLikeness, inverseOf, nodesOf, similarTo, type Likeness } from "./selecting";
import { LAYER, open, type Opened } from "./test-support";

const INK = "1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8";
const BRUSH = (size: number): string => `pf1 size=${size} thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0`;

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);
const RECT = (id: string, fill: string, extra = ""): string => `<rect id="${id}" x="0" y="0" width="10" height="10" fill="${fill}"${extra}/>`;
const STROKE = (id: string, tool: "pen" | "highlighter", size: number, fill = "#000000"): string =>
  `<path id="${id}" fub:tool="${tool}" fub:brush="${BRUSH(size)}" d="M0 0 L10 10 Z" fill="${fill}" fub:ink="${INK}"/>`;

const keys = (units: readonly Unit[] | null): string[] | null => (units === null ? null : units.map((unit) => unit.key));

describe("i simili", () => {
  const SOURCE = doc(
    `${LAYER}${RECT("oa", "#d55e00", ' stroke="#000000" stroke-width="2"')}${RECT("ob", "#0072b2", ' stroke="#000000" stroke-width="4"')}` +
      `<g id="og">${RECT("oc", "#d55e00")}${RECT("od", "#0072b2")}</g>` +
      `<g id="oh">${RECT("oe", "#d55e00")}</g>` +
      `${STROKE("op", "pen", 4)}${STROKE("oq", "pen", 8)}${STROKE("or", "highlighter", 16, "#f0e442")}${STROKE("os", "pen", 4, "#0072b2")}</g>` +
      `<g id="l2" fub:layer="Due">${RECT("of", "#d55e00")}</g>`,
  );

  const similar = (by: Likeness, ...chosen: string[]): string[] | null => {
    const { engine, index } = open(SOURCE);
    return keys(similarTo(engine.model!, index, chosen.map((key) => index.get(key)!), by));
  };

  it("stesso riempimento: anche dentro i gruppi e negli altri livelli, ma non i gruppi interi", () => {
    expect(similar("fill", "oa")).toEqual(["oa", "oc", "oe", "of"]);
    // Più oggetti scelti: i riempimenti di ciascuno.
    expect(similar("fill", "oa", "od")).toEqual(["oa", "ob", "oc", "od", "oe", "of"]);
    // Un gruppo scelto conta coi gruppi come lui: «oh» è tutto vermiglio.
    expect(similar("fill", "oh")).toEqual(["oa", "oc", "oh", "oe", "of"]);
    // Il riempimento di un tratto a penna è il suo colore, che conta come contorno.
    expect(similar("fill", "op")).toBeNull();
  });

  it("stesso contorno e stesso spessore, come li legge il pannello", () => {
    expect(similar("stroke", "op")).toEqual(["oa", "ob", "op", "oq"]);
    expect(similar("width", "oa")).toEqual(["oa"]);
    expect(similar("width", "ob")).toEqual(["ob"]);
  });

  it("stesso tipo, con l'evidenziatore a parte, e stesso strumento con la stessa punta", () => {
    expect(similar("kind", "op")).toEqual(["op", "oq", "os"]);
    expect(similar("kind", "or")).toEqual(["or"]);
    expect(similar("kind", "og")).toEqual(["og", "oh"]);
    expect(similar("kind", "oc")).toEqual(["oa", "ob", "oc", "od", "oe", "of"]);
    expect(similar("tool", "op")).toEqual(["op", "os"]);
    expect(similar("tool", "op", "oq")).toEqual(["op", "oq", "os"]);
    expect(similar("tool", "oa")).toBeNull();
  });

  it("stesso livello: gli oggetti in cima", () => {
    expect(similar("layer", "of")).toEqual(["of"]);
    expect(similar("layer", "oc")).toEqual(["oa", "ob", "og", "oh", "op", "oq", "or", "os"]);
  });

  it("sa senza cercare se c'è qualcosa da confrontare", () => {
    const { engine, index } = open(SOURCE);
    const rect = [index.get("oa")!];
    expect(hasLikeness(engine.model!, index, rect, "tool")).toBe(false);
    expect(hasLikeness(engine.model!, index, rect, "fill")).toBe(true);
    expect(hasLikeness(engine.model!, index, [], "kind")).toBe(false);
  });

  it("nel gruppo isolato, solo lì dentro", () => {
    const opened = open(SOURCE);
    const group = nodeOf(opened.engine.model!, opened.index.get("og")!) as ContainerNode;
    const index = opened.reindex(group);
    expect(keys(similarTo(opened.engine.model!, index, [index.get("oc")!], "fill"))).toEqual(["oc"]);
    expect(keys(allUnits(index))).toEqual(["oc", "od"]);
  });
});

describe("l'inversa", () => {
  it("sceglie tutto il resto: di un gruppo, gli altri oggetti", () => {
    const { index } = open(doc(`${LAYER}${RECT("oa", "#000000")}<g id="og">${RECT("ob", "#000000")}<g id="oi">${RECT("oc", "#000000")}${RECT("od", "#000000")}</g></g>${RECT("oe", "#000000")}</g>`));
    const inverse = (...chosen: string[]): string[] => keys(inverseOf(index, chosen.map((key) => index.get(key)!)))!;
    expect(inverse("oa")).toEqual(["og", "oe"]);
    expect(inverse("oc")).toEqual(["oa", "ob", "od", "oe"]);
    expect(inverse("oa", "og", "oe")).toEqual([]);
    expect(inverse()).toEqual(["oa", "og", "oe"]);
  });
});

/// Applica `ops`, verifica che un annulla riporti il testo di prima, e torna
/// l'indice di dopo.
function applied(opened: Opened, ops: Parameters<typeof gesture>[0]): SceneIndex {
  const before = opened.engine.text;
  const outcome = opened.engine.apply(gesture(ops)!);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = opened.engine.text;
  expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(opened.engine.text).toBe(before);
  expect(opened.engine.apply(gesture(ops)!).outcome).toBe("applied");
  expect(opened.engine.text).toBe(after);
  return opened.reindex();
}

describe("bloccare e nascondere", () => {
  it("scrive lo stato sull'oggetto, anche dentro un gruppo e senza id, e l'oggetto non si sceglie più", () => {
    const opened = open(doc(`${LAYER}${RECT("oa", "#000000")}<g id="og"><rect width="5" height="5"/>${RECT("ob", "#000000")}</g></g>`));
    const model = opened.engine.model!;
    const locked = flagOps(model, nodesOf(model, [opened.index.get("oa")!, opened.index.get("@0.1.0")!]), "locked", true, ids(opened));
    expect(locked.keys[0]).toBe("oa");
    expect(locked.keys[1]).toMatch(/^o[a-z0-9]{8}$/);
    expect(locked.ops).toEqual([
      { op: "ident", path: [0, 1, 0], tag: "rect", id: locked.keys[1] },
      { op: "set", id: "oa", attrs: { "fub:locked": "true" } },
      { op: "set", id: locked.keys[1], attrs: { "fub:locked": "true" } },
    ]);
    let index = applied(opened, locked.ops);
    expect(index.get("oa")).toBeNull();
    expect(index.get(locked.keys[1]!)).toBeNull();
    expect(index.children(index.get("og")!).map((unit) => unit.key)).toEqual(["ob"]);
    const hidden = flagOps(opened.engine.model!, nodesOf(opened.engine.model!, [index.get("ob")!]), "hidden", true, ids(opened));
    expect(hidden.ops).toEqual([{ op: "set", id: "ob", attrs: { display: "none" } }]);
    index = applied(opened, hidden.ops);
    expect(index.get("ob")).toBeNull();
    expect(opened.engine.text).toContain('<rect id="ob" x="0" y="0" width="10" height="10" fill="#000000" display="none"/>');
  });

  it("non scrive niente per chi è già così", () => {
    const opened = open(doc(`${LAYER}${RECT("oa", "#000000", ' fub:locked="true"')}</g>`));
    const model = opened.engine.model!;
    const node = nodeOf(model, { path: [0, 0] });
    expect(flagOps(model, [node], "locked", true, ids(opened))).toEqual({ ops: [], keys: [] });
    expect(flagOps(model, [node], "locked", false, ids(opened)).ops).toEqual([{ op: "set", id: "oa", attrs: { "fub:locked": null } }]);
  });

  it("«Sblocca tutto» e «Mostra tutto»: ciò che si vede e si cambia, il gruppo prima di ciò che contiene", () => {
    const opened = open(doc(
      `${LAYER}${RECT("oa", "#000000", ' fub:locked="true"')}` +
        `<g id="og" fub:locked="true">${RECT("ob", "#000000", ' fub:locked="true"')}${RECT("oc", "#000000", ' display="none"')}</g>` +
        `<g id="oh" display="none">${RECT("od", "#000000", ' fub:locked="true"')}${RECT("oe", "#000000", ' display="none"')}</g></g>` +
        `<g id="l2" fub:layer="Due" fub:locked="true">${RECT("of", "#000000", ' fub:locked="true"')}</g>` +
        `<g id="l3" fub:layer="Tre" display="none">${RECT("oi", "#000000", ' display="none"')}</g>` +
        RECT("oj", "#000000", ' display="none" fub:locked="true"'),
    ));
    const model = opened.engine.model!;
    const idsOf = (nodes: readonly { readonly facts: { readonly id: string | null } }[]): (string | null)[] => nodes.map((node) => node.facts.id);
    expect(idsOf(flagged(model, null, "locked"))).toEqual(["oa", "og", "ob", "oj"]);
    expect(idsOf(flagged(model, null, "hidden"))).toEqual(["oh", "oe", "oj"]);
    const unlocked = flagOps(model, flagged(model, null, "locked"), "locked", false, ids(opened));
    const index = applied(opened, unlocked.ops);
    expect(unlocked.keys).toEqual(["oa", "og", "ob", "oj"]);
    expect(["oa", "og", "ob"].map((key) => index.get(key)?.key ?? null)).toEqual(["oa", "og", "ob"]);
    // Dentro il gruppo isolato, solo lì.
    const group = nodeOf(opened.engine.model!, index.get("og")!) as ContainerNode;
    expect(idsOf(flagged(opened.engine.model!, group, "hidden"))).toEqual(["oc"]);
  });
});
