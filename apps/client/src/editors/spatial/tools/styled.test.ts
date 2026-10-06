// I comandi che spostano gli elementi e lo stile che si vede: dopo il
// comando ogni elemento si vede com'era, anche quando un foglio di stile del
// disegno sceglie per posizione o un gruppo che se ne va dava qualcosa a
// parti di un altro programma; le operazioni passano dal motore, un annulla
// riporta il testo identico, e ciò che non si sa scrivere non si fa.

import { describe, expect, it } from "vitest";
import { FIDELITY } from "../../../../bench/fidelity-corpus";
import { doc } from "../scene/test-support";
import type { Op } from "../scene/ops";
import { groupOps, linkOps, orderOps, ungroupOps, unlinkOps, type Arranged } from "./arrange";
import { gesture, NewIds } from "./edit";
import { intoLayerOps } from "./layers";
import { keepLook, refused, type Keeping, type Kept, type Refusal } from "./styled";
import { appearance, LAYER, open, type Opened } from "./test-support";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);
const keeping = (opened: Opened, containers: Keeping["containers"] = "keep"): Keeping => ({ containers, taken: (id) => opened.engine.holder(id) !== null });

/// Le operazioni del comando, che deve averne.
function opsOf(arranged: Arranged | "nested" | null): readonly Op[] {
  if (arranged === null || arranged === "nested") throw new Error("comando rifiutato");
  expect(arranged.ops.length).toBeGreaterThan(0);
  return arranged.ops;
}

/// `ops` con lo stile che resta, applicate al motore di `opened`: il testo
/// di dopo, dopo aver verificato che un annulla riporta quello di prima e
/// che si vede tutto com'era.
function kept(opened: Opened, ops: readonly Op[], containers: Keeping["containers"] = "keep"): [text: string, kept: Kept] {
  const before = opened.engine.text;
  const result = keepLook(before, opened.engine.model!, ops, keeping(opened, containers));
  if (refused(result)) throw new Error(`rifiutato: ${JSON.stringify(result)}`);
  const outcome = opened.engine.apply(gesture(result.ops)!);
  if (outcome.outcome !== "applied") throw new Error(`il motore rifiuta: ${outcome.detail}`);
  const after = opened.engine.text;
  if (containers === "keep") expect(appearance(after).sort()).toEqual(appearance(before).sort());
  expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(opened.engine.text).toBe(before);
  expect(opened.engine.apply(gesture(result.ops)!).outcome).toBe("applied");
  expect(opened.engine.text).toBe(after);
  return [after, result];
}

/// Il rifiuto di `ops` su `opened`, che deve esserci.
function refusal(opened: Opened, ops: readonly Op[], containers: Keeping["containers"] = "keep"): Refusal {
  const result = keepLook(opened.engine.text, opened.engine.model!, ops, keeping(opened, containers));
  if (!refused(result)) throw new Error(`fatto: ${JSON.stringify(result.ops)}`);
  return result;
}

/// Separa tutti i gruppi in cima al disegno, o al livello se c'è.
function ungrouping(source: string): [Opened, readonly Op[]] {
  const opened = open(source);
  return [opened, opsOf(ungroupOps(opened.engine.model!, opened.index.units, ids(opened)))];
}

/// Raggruppa gli oggetti `keys` del disegno `source`.
function grouping(source: string, ...keys: string[]): [Opened, readonly Op[]] {
  const opened = open(source);
  const units = opened.index.units.filter((unit) => keys.includes(unit.key));
  return [opened, opsOf(groupOps(opened.engine.model!, units, ids(opened)))];
}

const MERMAID = FIDELITY.find((scene) => scene.id === "mermaid")!.text;
const RECTS = '<rect id="oaaaaaaaa" width="1" height="1"/><rect id="obbbbbbbb" x="2" width="1" height="1"/>';

describe("separare", () => {
  it("il diagramma di Mermaid del banco di fedeltà si separa e si vede com'era", () => {
    const [opened, ops] = ungrouping(MERMAID);
    const [after, result] = kept(opened, ops);
    expect(after).not.toContain('id="m"');
    // Ogni forma ha su di sé ciò che le dava il foglio passando dal gruppo.
    expect(after).toContain('<rect x="10" y="50" width="90" height="40" rx="5" fill="#ECECFF" stroke="#9370DB"/>');
    expect(after).toContain('<text class="label" x="55" y="75" text-anchor="middle" font-size="14px" fill="#333" font-family="Inter">Inizio</text>');
    expect(after).toContain('<path class="edge" d="M 100 70 L 140 70" fill="none" stroke="#333" stroke-width="2px"/>');
    // La punta della freccia, un oggetto, non ne aveva bisogno.
    expect(after).toMatch(/<path id="o[a-z0-9]{8}" d="M 140 64 L 150 70 L 140 76 Z" fill="#333"\/>/);
    expect(result.written).toBe(5);
  });

  it("porta su parti estranee la trasformazione, l'opacità e lo stile del gruppo, senza fogli", () => {
    const [opened, ops] = ungrouping(doc(`${LAYER}<g id="og1g1g1g1" transform="translate(5 0)" opacity="0.5" fill="#d55e00"><rect id="oaaaaaaaa" width="5" height="5"/><circle class="x" r="2"/></g></g>`));
    const [after] = kept(opened, ops);
    expect(after).toContain('<rect id="oaaaaaaaa" width="5" height="5" fill="#d55e00" opacity="0.5" transform="matrix(1 0 0 1 5 0)"/>');
    expect(after).toContain('<circle class="x" r="2" transform="matrix(1 0 0 1 5 0)" opacity="0.5" fill="#d55e00"/>');
  });

  it("una copia collegata che mostra un figlio del gruppo compensa la sua trasformazione", () => {
    const [opened, ops] = ungrouping(doc(`${LAYER}<g id="og1g1g1g1" transform="translate(5 0)"><rect id="oaaaaaaaa" width="5" height="5"/></g><use href="#oaaaaaaaa" x="20"/></g>`));
    const [after] = kept(opened, ops);
    expect(after).toContain('<use href="#oaaaaaaaa" x="20" transform="matrix(1 0 0 1 -5 0)"/>');
  });

  it("col foglio di un SVG incollato, chiuso nel suo gruppo, i figli tengono il suo stile", () => {
    const [opened, ops] = ungrouping(doc(`${LAYER}<g id="p"><style>#p rect{fill:red}</style><rect id="oaaaaaaaa" width="1" height="1"/><circle id="obbbbbbbb" r="1"/></g></g>`));
    const [after] = kept(opened, ops);
    expect(after).toContain('<rect id="oaaaaaaaa" width="1" height="1" fill="red"/>');
    expect(after).toContain('<circle id="obbbbbbbb" r="1"/>');
  });

  it("un foglio che sceglie per classe, come quelli di Illustrator, non chiede niente", () => {
    const [opened, ops] = ungrouping(doc(`<style>.st0{fill:#FF0000}.st1{stroke:#000}</style>${LAYER}<g id="m"><rect class="st0" width="1" height="1"/><path class="st1" d="M0 0L1 1"/></g></g>`));
    const [after, result] = kept(opened, ops);
    expect(result.written).toBe(0);
    expect(after).toContain('<rect class="st0" width="1" height="1"/>');
  });

  it("su una parte estranea che un'altra regola sceglierebbe lo stile va in `style`, che la batte", () => {
    const [opened, ops] = ungrouping(doc(`<style>#m .a{fill:red} rect{fill:blue}</style>${LAYER}<g id="m"><rect class="a" width="1" height="1"/><rect id="oaaaaaaaa" x="2" width="1" height="1"/></g></g>`));
    const [after] = kept(opened, ops);
    expect(after).toContain('<rect class="a" width="1" height="1" style="fill:red"/>');
  });

  it("non si fa se un oggetto prenderebbe uno stile che un attributo non batte, e lo dice", () => {
    const [opened, ops] = ungrouping(doc(`<style>#m rect{fill:red} rect{fill:blue}</style>${LAYER}<g id="m"><rect id="oaaaaaaaa" width="1" height="1"/></g></g>`));
    expect(refusal(opened, ops)).toEqual({ kind: "object", property: "fill" });
  });
});

describe("raggruppare", () => {
  it("i figli diretti del livello che il foglio sceglie tengono il loro stile nel gruppo", () => {
    const [opened, ops] = grouping(doc(`<style>#l1 > rect{fill:red}</style>${LAYER}${RECTS}</g>`), "oaaaaaaaa", "obbbbbbbb");
    const [after, result] = kept(opened, ops);
    expect(after).toContain('<rect id="oaaaaaaaa" width="1" height="1" fill="red"/>');
    expect(result.written).toBe(2);
  });

  it("i discendenti del livello restano tali, e non chiedono niente", () => {
    const [opened, ops] = grouping(doc(`<style>#l1 rect{fill:red}</style>${LAYER}${RECTS}</g>`), "oaaaaaaaa", "obbbbbbbb");
    expect(kept(opened, ops)[1].written).toBe(0);
  });

  it("non si fa se il foglio darebbe al gruppo nuovo un effetto per tutto ciò che contiene", () => {
    const [opacity, opacityOps] = grouping(doc(`<style>g g{opacity:.5}</style>${LAYER}${RECTS}</g>`), "oaaaaaaaa", "obbbbbbbb");
    expect(refusal(opacity, opacityOps)).toEqual({ kind: "new", property: "opacity" });
    const [filter, filterOps] = grouping(doc(`<style>#l1 g{filter:blur(2px)}</style>${LAYER}${RECTS}</g>`), "oaaaaaaaa", "obbbbbbbb");
    expect(refusal(filter, filterOps)).toEqual({ kind: "new", property: "filter" });
  });
});

describe("riordinare", () => {
  const BODY = `${LAYER}<rect id="oaaaaaaaa" width="1" height="1"/><rect id="obbbbbbbb" x="2" width="1" height="1"/><rect id="occcccccc" x="4" width="1" height="1"/></g>`;

  /// Le operazioni che portano in primo piano il primo rettangolo.
  function fronting(source: string): [Opened, readonly Op[]] {
    const opened = open(source);
    const units = opened.index.units.filter((unit) => unit.key === "oaaaaaaaa");
    return [opened, opsOf(orderOps(opened.engine.model!, opened.index, units, "front", ids(opened)))];
  }

  it("chi perde la posizione che il foglio sceglie ne tiene lo stile, e chi la prende non lo prende", () => {
    const [opened, ops] = fronting(doc(`<style>#l1 > :first-child{stroke:red}</style>${LAYER}<rect id="oaaaaaaaa" width="1" height="1"/><circle class="c" r="1"/><rect id="obbbbbbbb" width="1" height="1"/></g>`));
    const [after] = kept(opened, ops);
    expect(after).toContain('<circle class="c" r="1" style="stroke:none"/>');
    expect(after).toContain('<rect id="oaaaaaaaa" width="1" height="1" stroke="red"/>');
  });

  it("non si fa se il foglio darebbe a un oggetto uno stile che un attributo non batte, e lo dice", () => {
    const [opened, ops] = fronting(doc(`<style>rect + rect{fill:red}</style>${BODY}`));
    expect(refusal(opened, ops)).toEqual({ kind: "object", property: "fill" });
  });
});

describe("collegare e togliere il collegamento", () => {
  it("dentro e fuori da un collegamento lo stile resta", () => {
    const opened = open(doc(`<style>#l1 > rect{stroke:#0072b2}</style>${LAYER}${RECTS}</g>`));
    const units = opened.index.units.filter((unit) => unit.key === "oaaaaaaaa");
    const [linked] = kept(opened, opsOf(linkOps(opened.engine.model!, units, "nota.md", ids(opened))));
    expect(linked).toContain('<rect id="oaaaaaaaa" width="1" height="1" stroke="#0072b2"/>');
    const again = open(linked);
    kept(again, opsOf(unlinkOps(again.engine.model!, again.reindex().units, ids(again))));
  });
});

describe("spostare in un livello", () => {
  it("chi cambia livello tiene lo stile che ereditava, e prende l'opacità del livello nuovo", () => {
    const opened = open(doc(`<g id="l1" fub:layer="A" fill="#d55e00">${RECTS}</g><g id="l2" fub:layer="B" opacity="0.5"/>`));
    const layer = opened.index.layers.find((each) => each.id === "l2")!;
    const units = opened.index.units.filter((unit) => unit.key === "oaaaaaaaa");
    const [after] = kept(opened, opsOf(intoLayerOps(opened.engine.model!, units, layer, ids(opened))), "take");
    expect(after).toMatch(/<g id="l2" fub:layer="B" opacity="0.5">\s*<rect id="oaaaaaaaa" width="1" height="1" fill="#d55e00"\/>\s*<\/g>/);
  });

  it("anche quando lo stile glielo dava un foglio, per il livello in cui stava", () => {
    const opened = open(doc(`<style>#l1 > rect{fill:#d55e00}</style><g id="l1" fub:layer="A">${RECTS}</g><g id="l2" fub:layer="B" opacity="0.5"/>`));
    const layer = opened.index.layers.find((each) => each.id === "l2")!;
    const units = opened.index.units.filter((unit) => unit.key === "oaaaaaaaa");
    const [after, result] = kept(opened, opsOf(intoLayerOps(opened.engine.model!, units, layer, ids(opened))), "take");
    expect(after).toMatch(/<g id="l2" fub:layer="B" opacity="0.5">\s*<rect id="oaaaaaaaa" width="1" height="1" fill="#d55e00"\/>\s*<\/g>/);
    expect(result.written).toBe(1);
  });
});

describe("nel dubbio non si fa, e si dice perché", () => {
  const GROUP = `${LAYER}<g id="m"><rect class="a" width="1" height="1"/><rect id="oaaaaaaaa" x="2" width="1" height="1"/></g></g>`;

  it("uno stile che dipende da dove si guarda il disegno", () => {
    const [opened, ops] = ungrouping(doc(`<style>@media (min-width: 400px){#m rect{fill:red}}</style>${GROUP}`));
    expect(refusal(opened, ops)).toEqual({ kind: "condition", text: "@media (min-width: 400px)" });
  });

  it("un selettore che non si legge; uno che sceglie col puntatore no, perché un disegno non lo vede", () => {
    const [unknown, unknownOps] = ungrouping(doc(`<style>#m rect:frobnicate{fill:red}</style>${GROUP}`));
    expect(refusal(unknown, unknownOps)).toEqual({ kind: "selector", text: "#m rect:frobnicate" });
    const [opened, ops] = ungrouping(doc(`<style>#m rect:hover{fill:red}</style>${GROUP}`));
    expect(kept(opened, ops)[1].written).toBe(0);
  });

  it("un effetto del gruppo che se ne va", () => {
    const [opened, ops] = ungrouping(doc(`<style>#m{filter:blur(1px)}</style>${GROUP}`));
    expect(refusal(opened, ops)).toEqual({ kind: "lost", property: "filter" });
  });

  it("un foglio importato che non si legge; uno di caratteri sì", () => {
    const [opened, ops] = ungrouping(doc(`<style>@import url(altro.css);</style>${GROUP}`));
    expect(refusal(opened, ops)).toEqual({ kind: "import" });
    const [fonts, fontOps] = ungrouping(doc(`<style>@import url(https://fonts.googleapis.com/css2?family=Inter);#m rect{fill:red}</style>${GROUP}`));
    kept(fonts, fontOps);
  });

  it("una copia collegata di un elemento che cambierebbe stile", () => {
    const [opened, ops] = ungrouping(doc(`<style>#m rect{fill:red}</style>${LAYER}<g id="m"><rect id="oaaaaaaaa" width="1" height="1"/></g></g><use href="#oaaaaaaaa" x="5"/>`));
    expect(refusal(opened, ops)).toEqual({ kind: "copy" });
  });
});

describe("senza fogli", () => {
  it("le operazioni passano come sono", () => {
    const [opened, ops] = ungrouping(doc(`${LAYER}<g id="og1g1g1g1" fill="#d55e00"><rect id="oaaaaaaaa" width="1" height="1"/></g></g>`));
    const [, result] = kept(opened, ops);
    expect(result.ops).toEqual(ops);
    expect(result.written).toBe(0);
  });

  it("i fogli che non sono CSS non contano", () => {
    const [opened, ops] = ungrouping(doc(`<style type="text/x-other">#m rect{fill:red}</style>${LAYER}<g id="m"><rect id="oaaaaaaaa" width="1" height="1"/><rect id="obbbbbbbb" width="1" height="1"/></g></g>`));
    expect(kept(opened, ops)[1].written).toBe(0);
  });
});
