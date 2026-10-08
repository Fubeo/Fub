// Il connettore nelle proprietà: che cosa ne legge il pannello, e le
// operazioni che ne cambiano il tipo, gli agganci, l'etichetta e il verso. Le
// operazioni le accetta il motore con il seguito dei connettori, e un annulla
// le disfa al byte.

import { describe, expect, it } from "vitest";
import { readConnectorGeom } from "../scene/connectors";
import type { Op } from "../scene/ops";
import { doc } from "../scene/test-support";
import { connectorOps, connectorView, type ConnectorChange, type ConnectorChanged } from "./connector-ops";
import { followConnectors, LABEL_GAP } from "./connectors";
import type { Unit } from "./hit";
import { estimate } from "./measure";
import { LAYER, open, type Opened } from "./test-support";
import { applied, DEFS, ENDS, ids, MARKER } from "./tip-support";
import { tipOps } from "./tips";

/// Il motore di `body`, dentro il primo livello, coi connettori che seguono
/// gli oggetti, come lo installa l'editor.
function sheet(body: string, after = ""): Opened {
  const opened = open(doc(`${LAYER}${body}</g>${after}`));
  opened.engine.follow = (model, touched, op) => followConnectors(model, touched, (id) => opened.engine.holder(id), estimate, op);
  return opened;
}

const find = (opened: Opened) => (id: string) => opened.engine.holder(id);

/// Gli oggetti di `keys`, o tutti.
const unitsOf = (opened: Opened, keys: readonly string[] | null = null): Unit[] => opened.reindex().units.filter((unit) => keys === null || keys.includes(unit.key));

const view = (opened: Opened, keys: readonly string[] | null = null) => connectorView(opened.engine.model!, unitsOf(opened, keys), find(opened));

function changed(opened: Opened, change: ConnectorChange, keys: readonly string[] | null = ["c"]): ConnectorChanged {
  return connectorOps(opened.engine.model!, unitsOf(opened, keys), change, find(opened), estimate, ids(opened));
}

/// Le unità di `keys`, prese prima di bloccare gli oggetti `locks`: un oggetto
/// bloccato non entra nella scelta, ma il pannello deve saper leggere anche la
/// scelta di chi ha bloccato dopo.
function lockedUnits(opened: Opened, keys: readonly string[], locks: readonly string[]): Unit[] {
  const units = unitsOf(opened, keys);
  for (const id of locks) opened.engine.apply({ op: "set", id, attrs: { "fub:locked": "true" } });
  return units;
}

/// Il valore dell'attributo `name` dell'elemento `id` nel testo del motore.
function attr(opened: Opened, id: string, name: string): string | null {
  const element = new RegExp(`<[a-zA-Z]+ id="${id}"[^>]*>`).exec(opened.engine.text)?.[0];
  if (element === undefined) throw new Error(`nessun elemento ${id}`);
  return new RegExp(` ${name}="([^"]*)"`).exec(element)?.[1] ?? null;
}

const geomOf = (opened: Opened, id = "c") => readConnectorGeom(attr(opened, id, "fub:geom") ?? "")!;

const A = '<rect id="a" x="100" y="100" width="200" height="120" fill="#e69f00"/>';
const B = '<rect id="b" x="500" y="400" width="200" height="120" fill="#009e73"/>';
const D = '<rect id="d" x="100" y="400" width="200" height="120" fill="#56b4e9"/>';

/// Un connettore da `a` a `b`; `kind` ne dice il tipo e la geometria scritta,
/// che il seguito ricalcola.
const LINE = (id = "c", kind = "straight", from = "a auto", to = "b auto", extra = ""): string => {
  const geom = kind === "curved" ? "curved 0 0 1 1 2 2 3 3" : `${kind} 0 0 10 10`;
  const d = kind === "curved" ? "M0 0 C1 1 2 2 3 3" : "M0 0 L10 10";
  const ends = `${from === "" ? "" : ` fub:from="${from}"`}${to === "" ? "" : ` fub:to="${to}"`}`;
  return `<path id="${id}" fub:shape="connector" fub:geom="${geom}"${ends} d="${d}" fill="none" stroke="#0072b2" stroke-width="2"${extra}/>`;
};

/// Un'etichetta del connettore `of`, con le righe `rows`.
const LABEL = (id: string, of: string, rows: readonly string[], place = `${of} 0.5 4`): string =>
  `<text id="${id}" x="0" y="0" text-anchor="middle" fub:along="${place}" font-size="32">${rows.map((row) => `<tspan x="0" dy="0">${row}</tspan>`).join("")}</text>`;

/// Un connettore già ricalcolato dal seguito, per partire da una geometria
/// vera.
function ready(body: string): Opened {
  const opened = sheet(body);
  applied(opened, { op: "set", id: "a", attrs: { "fub:name": "A" } });
  return opened;
}

describe("quello che il pannello legge", () => {
  it("senza connettori non c'è niente da mostrare", () => {
    const opened = sheet(`${A}${B}`);
    expect(view(opened)).toBeNull();
    expect(view(opened, ["a"])).toBeNull();
  });

  it("di un connettore dice tipo, agganci ed etichetta", () => {
    const opened = sheet(`${A}${B}${LINE("c", "elbow", "a right", "b top")}`);
    expect(view(opened, ["c"])).toEqual({ count: 1, kind: "elbow", from: "right", to: "top", label: "", locked: 0 });
  });

  it("conta soltanto i connettori scelti, non gli oggetti accanto", () => {
    const opened = sheet(`${A}${B}${LINE()}`);
    expect(view(opened, ["a", "b", "c"])?.count).toBe(1);
  });

  it("un gruppo che contiene un connettore non conta", () => {
    const opened = sheet(`${A}${B}<g id="g">${LINE()}</g>`);
    expect(view(opened, ["g"])).toBeNull();
  });

  it("fra due connettori diversi dice «misto» là dove differiscono", () => {
    const opened = sheet(`${A}${B}${D}${LINE("c", "elbow", "a right", "b top")}${LINE("e", "curved", "a right", "d left")}`);
    expect(view(opened, ["c", "e"])).toEqual({ count: 2, kind: null, from: "right", to: null, label: "", locked: 0 });
  });

  it("un capo senza oggetto, o con un oggetto che non vale, è libero", () => {
    const opened = sheet(`${A}${LINE("c", "straight", "a auto", "")}${LINE("e", "straight", "nessuno left", "e top")}`);
    expect(view(opened, ["c"])).toMatchObject({ from: "auto", to: "free" });
    // Un id che non c'è, e un capo agganciato al connettore stesso.
    expect(view(opened, ["e"])).toMatchObject({ from: "free", to: "free" });
  });

  it("un capo e un altro libero insieme sono «misto»", () => {
    const opened = sheet(`${A}${B}${LINE("c", "straight", "a auto", "b auto")}${LINE("e", "straight", "a auto", "")}`);
    expect(view(opened, ["c", "e"])).toMatchObject({ from: "auto", to: null });
  });

  it("l'etichetta è il testo della prima, a capo come si scrive", () => {
    const opened = sheet(`${A}${B}${LINE()}${LABEL("t1", "c", ["Prima", "riga"])}${LABEL("t2", "c", ["Seconda"], "c 0.2 4")}`);
    expect(view(opened, ["c"])?.label).toBe("Prima\nriga");
  });

  it("l'etichetta è «misto» se i connettori ne hanno di diverse", () => {
    const opened = sheet(`${A}${B}${LINE("c")}${LINE("e")}${LABEL("t1", "c", ["Si"])}`);
    expect(view(opened, ["c"])?.label).toBe("Si");
    expect(view(opened, ["e"])?.label).toBe("");
    expect(view(opened, ["c", "e"])?.label).toBeNull();
    expect(view(opened, ["c", "e"])).toMatchObject({ count: 2 });
  });

  it("l'etichetta di un connettore in un gruppo si trova lo stesso", () => {
    const opened = sheet(`${A}${B}<g id="g">${LINE()}${LABEL("t1", "c", ["Nel gruppo"])}</g>`);
    expect(view(opened, ["c"])).toBeNull();
    const units = opened.reindex(opened.engine.holder("g") as never).units.filter((unit) => unit.key === "c");
    expect(connectorView(opened.engine.model!, units, find(opened))?.label).toBe("Nel gruppo");
  });

  it("dice quanti connettori sono bloccati, anche per il livello o il gruppo", () => {
    const opened = open(
      doc(`<g id="l1" fub:layer="Livello 1">${A}${B}${LINE("c")}${LINE("e")}<g id="g">${LINE("h")}</g></g><g id="l2" fub:layer="Livello 2">${LINE("f")}</g>`),
    );
    const units = lockedUnits(opened, ["c", "e", "f"], ["e", "l2"]);
    const read = (keys: readonly string[]) => connectorView(opened.engine.model!, units.filter((unit) => keys.includes(unit.key)), find(opened));
    expect(read(["c"])?.locked).toBe(0);
    expect(read(["e"])?.locked).toBe(1);
    expect(read(["c", "e"])).toMatchObject({ count: 2, locked: 1 });
    expect(read(["f"])).toMatchObject({ count: 1, locked: 1 });
    expect(read(["c", "e", "f"])).toMatchObject({ count: 3, locked: 2 });
  });
});

describe("il tipo", () => {
  it("riscrive il percorso del tipo nuovo, e un annulla torna al byte", () => {
    const opened = ready(`${A}${B}${LINE("c", "elbow")}`);
    const made = changed(opened, { kind: "curved" });
    expect(made.reached).toBe(1);
    expect(made.keys).toEqual(["c"]);
    // Applicato davvero: la scrittura è quella del tipo.
    applied(opened, made.ops);
    const geom = geomOf(opened);
    expect(geom.kind).toBe("curved");
    expect(geom.points).toHaveLength(4);
    expect(attr(opened, "c", "d")).toMatch(/^M[^C]*C/);
    expect(attr(opened, "c", "fub:from")).toBe("a auto");
  });

  it("tocca i bordi dei due oggetti nel tipo nuovo", () => {
    const opened = ready(`${A}${B}${LINE("c", "elbow", "a right", "b left")}`);
    applied(opened, changed(opened, { kind: "straight" }).ops);
    const points = geomOf(opened).points;
    expect(points).toHaveLength(2);
    // Dal lato destro di a (x = 300, y = 160) al sinistro di b (x = 500, y = 460).
    expect(points[0]![0]).toBeCloseTo(300, 2);
    expect(points[0]![1]).toBeCloseTo(160, 2);
    expect(points[1]![0]).toBeCloseTo(500, 2);
    expect(points[1]![1]).toBeCloseTo(460, 2);
  });

  it("lo stesso tipo non cambia niente", () => {
    const opened = ready(`${A}${B}${LINE("c", "elbow")}`);
    expect(changed(opened, { kind: "elbow" })).toEqual({ ops: [], keys: ["c"], reached: 0 });
  });

  it("un connettore bloccato resta com'è, e gli altri cambiano", () => {
    const opened = ready(`${A}${B}${LINE("c", "elbow")}${LINE("e", "elbow")}`);
    const units = lockedUnits(opened, ["c", "e"], ["e"]);
    const before = attr(opened, "e", "fub:geom");
    const made = connectorOps(opened.engine.model!, units, { kind: "straight" }, find(opened), estimate, ids(opened));
    expect(made.reached).toBe(1);
    applied(opened, made.ops);
    expect(attr(opened, "e", "fub:geom")).toBe(before);
    expect(geomOf(opened, "c").kind).toBe("straight");
  });

  it("un connettore che non è agganciato tiene i suoi capi dove sono", () => {
    const opened = sheet(`${A}${B}${LINE("c", "straight", "", "").replace('fub:geom="straight 0 0 10 10"', 'fub:geom="straight 50 60 70 80"')}`);
    applied(opened, changed(opened, { kind: "elbow" }).ops);
    const points = geomOf(opened).points;
    expect(points[0]).toEqual([50, 60]);
    expect(points[points.length - 1]).toEqual([70, 80]);
  });
});

describe("l'aggancio", () => {
  it("cambia il punto d'aggancio del capo e porta il capo sul bordo", () => {
    const opened = ready(`${A}${B}${LINE("c", "straight")}`);
    const made = changed(opened, { end: "from", anchor: "right" });
    expect(made.reached).toBe(1);
    applied(opened, made.ops);
    expect(attr(opened, "c", "fub:from")).toBe("a right");
    expect(attr(opened, "c", "fub:to")).toBe("b auto");
    const [p] = geomOf(opened).points;
    expect(p![0]).toBeCloseTo(300, 2);
    expect(p![1]).toBeCloseTo(160, 2);
  });

  it("l'altro capo si cambia da solo", () => {
    const opened = ready(`${A}${B}${LINE("c", "straight")}`);
    const made = changed(opened, { end: "to", anchor: "top" });
    applied(opened, made.ops);
    expect(attr(opened, "c", "fub:to")).toBe("b top");
    expect(attr(opened, "c", "fub:from")).toBe("a auto");
    const points = geomOf(opened).points;
    expect(points[points.length - 1]![0]).toBeCloseTo(600, 2);
    expect(points[points.length - 1]![1]).toBeCloseTo(400, 2);
  });

  it("si annulla al byte", () => {
    const opened = ready(`${A}${B}${LINE("c", "elbow")}`);
    applied(opened, changed(opened, { end: "from", anchor: "bottom" }).ops);
  });

  it("un capo libero si ignora", () => {
    const opened = sheet(`${A}${LINE("c", "straight", "a auto", "")}`);
    expect(changed(opened, { end: "to", anchor: "top" })).toEqual({ ops: [], keys: ["c"], reached: 0 });
  });

  it("un capo verso un oggetto che non c'è si ignora", () => {
    const opened = sheet(`${A}${LINE("c", "straight", "a auto", "nessuno left")}`);
    expect(changed(opened, { end: "to", anchor: "top" }).reached).toBe(0);
  });

  it("lo stesso aggancio non cambia niente", () => {
    const opened = ready(`${A}${B}${LINE("c", "straight", "a right", "b auto")}`);
    expect(changed(opened, { end: "from", anchor: "right" }).reached).toBe(0);
  });

  it("cambia i connettori scelti che hanno il capo agganciato, e conta soltanto quelli", () => {
    const opened = ready(`${A}${B}${LINE("c", "straight")}${LINE("e", "straight", "", "b auto")}`);
    const made = changed(opened, { end: "from", anchor: "left" }, ["c", "e"]);
    expect(made.reached).toBe(1);
    expect(made.keys).toEqual(["c", "e"]);
    applied(opened, made.ops);
  });
});

describe("l'etichetta", () => {
  it("senza etichette ne aggiunge una subito dopo il connettore, a metà e sopra la linea", () => {
    const opened = ready(`${A}${B}${LINE("c", "straight")}${B.replace('id="b"', 'id="z"')}`);
    const made = changed(opened, { label: "Costa" });
    expect(made.reached).toBe(1);
    expect(made.ops).toHaveLength(1);
    const add = made.ops[0]!;
    if (add.op !== "add" || !("parent" in add)) throw new Error("atteso un add");
    expect(add.parent).toBe("l1");
    expect(add.pos).toEqual({ after: "c" });
    const after = applied(opened, made.ops);
    expect(after).toMatch(/\/>\s*<text id="o[a-z0-9]+"/);
    const id = /<text id="(o[a-z0-9]+)"/.exec(after)![1]!;
    expect(attr(opened, id, "fub:along")).toBe(`c 0.5 ${LABEL_GAP}`);
    expect(attr(opened, id, "text-anchor")).toBe("middle");
    expect(attr(opened, id, "x")).toBe("0");
    expect(attr(opened, id, "y")).toBe("0");
    // Il colore della linea, e il posto lungo la linea che dà il seguito.
    expect(attr(opened, id, "fill")).toBe("#0072b2");
    expect(attr(opened, id, "transform")).toMatch(/^matrix\(/);
    expect(after).toMatch(new RegExp(`<tspan x="0" dy="0">Costa</tspan>`));
  });

  it("un testo a capo diventa una riga per tspan", () => {
    const opened = ready(`${A}${B}${LINE("c")}`);
    const after = applied(opened, changed(opened, { label: "Uno\nDue\n\nQuattro" }).ops);
    const tspans = [...after.matchAll(/<tspan [^>]*>([^<]*)<\/tspan>/g)].map((match) => match[1]);
    expect(tspans).toEqual(["Uno", "Due", expect.any(String), "Quattro"]);
    expect(after).toMatch(/<tspan x="0" dy="0">Uno<\/tspan>/);
    expect(after).toMatch(/<tspan x="0" dy="[0-9.]+">Due<\/tspan>/);
  });

  it("un connettore senza un colore pieno dà all'etichetta il colore del testo", () => {
    const opened = ready(`${A}${B}${LINE("c").replace('stroke="#0072b2"', 'stroke="none"')}`);
    const made = connectorOps(opened.engine.model!, unitsOf(opened, ["c"]), { label: "Senza" }, find(opened), estimate, ids(opened), { color: "#d55e00", size: 20 });
    const after = applied(opened, made.ops);
    expect(after).toMatch(/<text id="o[a-z0-9]+"[^>]* fill="#d55e00"[^>]* font-size="20"/);
  });

  it("con un'etichetta già scritta ne cambia le righe, non ne aggiunge un'altra", () => {
    const opened = ready(`${A}${B}${LINE("c")}${LABEL("t1", "c", ["Prima"])}`);
    const made = changed(opened, { label: "Nuova\nriga" });
    expect(made.ops).toEqual([{ op: "text", id: "t1", lines: ["Nuova", "riga"] }]);
    const after = applied(opened, made.ops);
    expect(after.match(/<text /g)).toHaveLength(1);
    expect(after).toContain(">Nuova</tspan>");
    expect(view(opened, ["c"])?.label).toBe("Nuova\nriga");
  });

  it("lo stesso testo non cambia niente", () => {
    const opened = ready(`${A}${B}${LINE("c")}${LABEL("t1", "c", ["Uguale"])}`);
    expect(changed(opened, { label: "Uguale" })).toEqual({ ops: [], keys: ["c"], reached: 0 });
  });

  it("vuoto toglie tutte le etichette del connettore, e un annulla le riporta", () => {
    const opened = ready(`${A}${B}${LINE("c")}${LABEL("t1", "c", ["Prima"])}${LABEL("t2", "c", ["Seconda"], "c 0.2 4")}${LINE("e")}${LABEL("t3", "e", ["Altra"])}`);
    const made = changed(opened, { label: "  " }, ["c"]);
    expect(made.reached).toBe(1);
    expect(made.ops.filter((op) => op.op === "remove")).toHaveLength(2);
    const after = applied(opened, made.ops);
    expect(after).not.toContain('id="t1"');
    expect(after).not.toContain('id="t2"');
    expect(after).toContain('id="t3"');
    expect(view(opened, ["c"])?.label).toBe("");
  });

  it("vuoto, su un connettore senza etichette, non cambia niente", () => {
    const opened = ready(`${A}${B}${LINE("c")}`);
    expect(changed(opened, { label: "" }).reached).toBe(0);
  });

  it("più connettori: riscrive dove c'è, aggiunge dove manca", () => {
    const opened = ready(`${A}${B}${LINE("c")}${LINE("e", "straight", "a auto", "b auto")}${LABEL("t1", "c", ["Vecchia"])}`);
    const made = changed(opened, { label: "Tutti" }, ["c", "e"]);
    expect(made.reached).toBe(2);
    const after = applied(opened, made.ops);
    expect(after.match(/>Tutti<\/tspan>/g)).toHaveLength(2);
    expect(after.match(/<text /g)).toHaveLength(2);
  });

  it("un connettore senza id lo riceve, e la nuova etichetta lo nomina", () => {
    const opened = sheet(`${A}${B}${LINE("c").replace(' id="c"', "")}`);
    const units = unitsOf(opened).filter((unit) => unit.role === "connector");
    const made = connectorOps(opened.engine.model!, units, { label: "Nome" }, find(opened), estimate, ids(opened));
    expect(made.ops[0]).toMatchObject({ op: "ident", tag: "path" });
    expect(made.ops.filter((op) => op.op === "ident")).toHaveLength(1);
    expect(made.keys).toEqual([(made.ops[0] as Extract<Op, { op: "ident" }>).id]);
    const after = applied(opened, made.ops);
    const given = (made.ops[0] as Extract<Op, { op: "ident" }>).id!;
    expect(after).toContain(`id="${given}"`);
    expect(after).toContain(`fub:along="${given} 0.5 4"`);
  });

  it("un'etichetta bloccata non si cambia", () => {
    const opened = ready(`${A}${B}${LINE("c")}${LABEL("t1", "c", ["Ferma"]).replace("<text ", '<text fub:locked="true" ')}`);
    expect(changed(opened, { label: "Altra" }).reached).toBe(0);
    expect(changed(opened, { label: "" }).reached).toBe(0);
  });
});

describe("il verso", () => {
  it("scambia i capi e rovescia il percorso", () => {
    const opened = ready(`${A}${B}${LINE("c", "straight", "a right", "b left")}`);
    const before = geomOf(opened).points;
    const made = changed(opened, { invert: true });
    expect(made.reached).toBe(1);
    expect(made.keys).toEqual(["c"]);
    applied(opened, made.ops);
    expect(attr(opened, "c", "fub:from")).toBe("b left");
    expect(attr(opened, "c", "fub:to")).toBe("a right");
    expect(geomOf(opened).points).toEqual([...before].reverse());
  });

  it("le punte restano dove sono scritte: quella di fine resta di fine, e va al capo nuovo", () => {
    const opened = ready(`${A}${B}${LINE("c", "straight", "a right", "b left")}`);
    applied(opened, tipsOps(opened, "c"));
    const tip = attr(opened, "c", "marker-end");
    expect(tip).not.toBeNull();
    expect(attr(opened, "c", "marker-start")).toBeNull();
    const markers = opened.engine.text.match(/<marker [^>]*>/g);
    const first = geomOf(opened).points[0]!;
    const last = geomOf(opened).points[geomOf(opened).points.length - 1]!;
    applied(opened, changed(opened, { invert: true }).ops);
    // La punta è ancora in fondo, e il capo di fine è quello che era l'inizio.
    expect(attr(opened, "c", "marker-end")).toBe(tip);
    expect(attr(opened, "c", "marker-start")).toBeNull();
    expect(opened.engine.text.match(/<marker [^>]*>/g)).toEqual(markers);
    expect(geomOf(opened).points[0]).toEqual(last);
    expect(geomOf(opened).points[geomOf(opened).points.length - 1]).toEqual(first);
    expect(attr(opened, "c", "fub:to")).toBe("a right");
  });

  it("due punte diverse non si scambiano fra loro", () => {
    const opened = sheet(`${A}${B}${LINE("c", "straight", "a right", "b left", ENDS("m0", "m1"))}`, DEFS(MARKER("m0", "circle", "small", "start") + MARKER("m1", "triangle", "medium", "end")));
    const before = [attr(opened, "c", "marker-start"), attr(opened, "c", "marker-end")];
    applied(opened, changed(opened, { invert: true }).ops);
    expect([attr(opened, "c", "marker-start"), attr(opened, "c", "marker-end")]).toEqual(before);
  });

  it("l'etichetta passa dall'altra parte, alla stessa distanza", () => {
    const opened = ready(`${A}${B}${LINE("c")}${LABEL("t1", "c", ["Si"], "c 0.25 6")}${LABEL("t2", "c", ["Metà"], "c 0.5 4")}`);
    const after = applied(opened, changed(opened, { invert: true }).ops);
    expect(after).toContain('fub:along="c 0.75 6"');
    expect(after).toContain('fub:along="c 0.5 4"');
  });

  it("invertire due volte torna al connettore di prima", () => {
    const opened = ready(`${A}${B}${LINE("c", "elbow", "a right", "b top")}${LABEL("t1", "c", ["Si"], "c 0.25 6")}`);
    const first = opened.engine.text;
    applied(opened, changed(opened, { invert: true }).ops);
    expect(opened.engine.text).not.toBe(first);
    applied(opened, changed(opened, { invert: true }).ops);
    expect(attr(opened, "c", "fub:from")).toBe("a right");
    expect(attr(opened, "c", "fub:to")).toBe("b top");
    expect(attr(opened, "c", "fub:geom")).toBe(new RegExp(` fub:geom="([^"]*)"`).exec(first.match(/<path id="c"[^>]*>/)![0])![1]);
  });

  it("un connettore con un capo libero scambia lo stesso i due capi", () => {
    const opened = ready(`${A}${B}${LINE("c", "straight", "a auto", "")}`);
    const made = changed(opened, { invert: true });
    expect(made.reached).toBe(1);
    applied(opened, made.ops);
    expect(attr(opened, "c", "fub:from")).toBeNull();
    expect(attr(opened, "c", "fub:to")).toBe("a auto");
  });

  it("un connettore bloccato non si inverte", () => {
    const opened = ready(`${A}${B}${LINE("c", "straight")}`);
    const units = lockedUnits(opened, ["c"], ["c"]);
    const made = connectorOps(opened.engine.model!, units, { invert: true }, find(opened), estimate, ids(opened));
    expect(made).toEqual({ ops: [], keys: ["c"], reached: 0 });
  });

  it("un connettore senza id lo riceve una volta sola, e le sue punte non cambiano", () => {
    const opened = sheet(`${A}${B}${LINE("c", "straight", "a right", "b left", ENDS(null, "m1")).replace(' id="c"', "")}`, DEFS(MARKER("m1", "triangle", "medium", "end")));
    const units = unitsOf(opened).filter((unit) => unit.role === "connector");
    expect(units).toHaveLength(1);
    const made = connectorOps(opened.engine.model!, units, { invert: true }, find(opened), estimate, ids(opened));
    expect(made.ops.filter((op) => op.op === "ident")).toHaveLength(1);
    const after = applied(opened, made.ops);
    expect(after).toMatch(/<path id="[^"]+"[^>]* marker-end="url\(#m1\)"/);
    expect(after).not.toMatch(/<path [^>]*marker-start=/);
  });
});

/// Le punte «fine» alla linea `id`, per partire da un connettore che ne ha.
function tipsOps(opened: Opened, id: string): readonly Op[] {
  return tipOps(opened.engine.model!, unitsOf(opened, [id]), { end: "end", shape: "triangle" }, ids(opened)).ops;
}
