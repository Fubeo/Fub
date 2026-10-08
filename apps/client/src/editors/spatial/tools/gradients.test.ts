// Le sfumature degli oggetti: come si leggono nella scena, i gesti sui
// loro punti, e le operazioni, che il motore accetta così come sono e che
// un annulla disfa al byte.

import { describe, expect, it } from "vitest";
import { FIDELITY } from "../../../../bench/fidelity-corpus";
import type { Point } from "../scene/matrix";
import { doc } from "../scene/test-support";
import { gesture, NewIds } from "./edit";
import {
  averageColor,
  constrained,
  defaultPlace,
  drawnPlace,
  fadeOf,
  FOCUS_LIMIT,
  gradientHandles,
  gradientOps,
  gradientPreview,
  gradientView,
  movedStop,
  paintedParts,
  placeAngle,
  placeAs,
  placeAt,
  placeTurned,
  placeWith,
  pointAt,
  reversedStops,
  sortedStops,
  stopAt,
  withStop,
  writtenPlace,
  type GradientChange,
  type GradientChanged,
  type GradientPlace,
  type GradientStop,
  type PaintChannel,
  type Painted,
} from "./gradients";
import { estimate } from "./measure";
import { LAYER, open, type Opened } from "./test-support";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

const RECT = (id: string, extra = ' fill="#d55e00"'): string => `<rect id="${id}" x="10" y="20" width="40" height="20"${extra}/>`;
const DEFS = (inner: string): string => `<defs id="fub-defs">${inner}</defs>`;
const LINEAR = (id: string, extra = ' fub:role="private" gradientUnits="userSpaceOnUse" x1="10" y1="30" x2="50" y2="30"'): string =>
  `<linearGradient id="${id}"${extra}><stop offset="0" stop-color="#0072b2"/><stop offset="1" stop-color="#ffffff"/></linearGradient>`;

const near = (p: Point, q: Point, digits = 2): void => {
  expect(p[0]).toBeCloseTo(q[0], digits);
  expect(p[1]).toBeCloseTo(q[1], digits);
};

const nearPlace = (a: GradientPlace | null, b: GradientPlace | null): void => {
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  expect(a!.kind).toBe(b!.kind);
  if (a!.kind === "linear" && b!.kind === "linear") {
    near(a!.start, b!.start);
    near(a!.end, b!.end);
    // La riga di uguale colore: la stessa direzione.
    const u = [a!.across[0] - a!.start[0], a!.across[1] - a!.start[1]];
    const v = [b!.across[0] - b!.start[0], b!.across[1] - b!.start[1]];
    expect(Math.abs(u[0]! * v[1]! - u[1]! * v[0]!) / (Math.hypot(u[0]!, u[1]!) * Math.hypot(v[0]!, v[1]!))).toBeLessThan(1e-3);
  } else if (a!.kind === "radial" && b!.kind === "radial") {
    near(a!.center, b!.center);
    near(a!.a, b!.a);
    near(a!.b, b!.b);
    near(a!.focus, b!.focus);
  }
};

/// Le parti del disegno che mostrano `channel`.
const painted = (opened: Opened, channel: PaintChannel = "fill"): Painted[] => paintedParts(opened.engine.model!, opened.reindex().units, channel);

/// Il cambio sugli oggetti `keys`, o su tutti.
function changed(opened: Opened, change: GradientChange, channel: PaintChannel = "fill", keys: readonly string[] | null = null): GradientChanged {
  const units = opened.reindex().units.filter((unit) => keys === null || keys.includes(unit.key));
  return gradientOps(opened.engine.model!, units, channel, change, estimate, ids(opened));
}

/// Applica `change`, verifica che un annulla riporti il testo di prima e
/// che un rifai torni a quello di dopo, e lascia il motore al dopo.
function applied(opened: Opened, change: GradientChanged): string {
  const before = opened.engine.text;
  const outcome = opened.engine.apply(gesture(change.ops)!);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = opened.engine.text;
  expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(opened.engine.text).toBe(before);
  expect(opened.engine.apply(gesture(change.ops)!).outcome).toBe("applied");
  expect(opened.engine.text).toBe(after);
  expect(opened.engine.scene().every((item) => item.kind !== "foreign")).toBe(true);
  return after;
}

type Linear = Extract<GradientPlace, { kind: "linear" }>;

/// L'elemento che un'operazione aggiunge, se ne aggiunge uno descritto.
const addedElem = (op: GradientChanged["ops"][number], tag?: string) =>
  op.op === "add" && "elem" in op && (tag === undefined ? op.elem.tag.endsWith("Gradient") : op.elem.tag === tag);

/// L'id della sfumatura che `change` aggiunge.
const added = (change: GradientChanged): string[] =>
  change.ops.flatMap((op) => (op.op === "add" && "elem" in op && addedElem(op) ? [op.elem.attrs.id!] : []));

describe("una sfumatura nasce", () => {
  it("da un colore, come la sua dissolvenza, da sinistra a destra a metà altezza", () => {
    const opened = open(doc(`${LAYER}${RECT("oa")}</g>`));
    const change = changed(opened, { kind: "linear" });
    expect(change.reached).toBe(1);
    const [id] = added(change);
    expect(change.ops[0]).toEqual({ op: "add", parent: "#root", pos: { first: true }, elem: { tag: "defs", attrs: { id: "fub-defs" } } });
    expect(change.ops[1]).toEqual({
      op: "add",
      parent: "fub-defs",
      pos: { last: true },
      elem: {
        tag: "linearGradient",
        attrs: { id, "fub:role": "private", gradientUnits: "userSpaceOnUse", x1: "10", y1: "30", x2: "50", y2: "30" },
        children: [
          { tag: "stop", attrs: { offset: "0", "stop-color": "#d55e00" } },
          { tag: "stop", attrs: { offset: "1", "stop-color": "#d55e00", "stop-opacity": "0" } },
        ],
      },
    });
    const text = applied(opened, change);
    expect(text).toContain(`fill="url(#${id}) #d55e00"`);
    const [part] = painted(opened);
    expect(part!.gradient).toMatchObject({ id, own: true, look: { kind: "linear", spread: "pad", stops: fadeOf("#d55e00") } });
    nearPlace(part!.gradient!.place, { kind: "linear", start: [10, 30], end: [50, 30], across: [10, 70] });
  });

  it("radiale nell'ellisse dentro il riquadro, con una trasformazione che la schiaccia", () => {
    const opened = open(doc(`${LAYER}${RECT("oa")}</g>`));
    const change = changed(opened, { kind: "radial" });
    const elem = change.ops.find((op) => addedElem(op, "radialGradient"));
    expect(elem).toMatchObject({ elem: { attrs: { cx: "30", cy: "30", r: "20", gradientTransform: "matrix(1 0 0 0.5 0 15)" } } });
    applied(opened, change);
    nearPlace(painted(opened)[0]!.gradient!.place, { kind: "radial", center: [30, 30], a: [50, 30], b: [30, 40], focus: [30, 30] });
  });

  it("dal bianco al nero senza un colore, e da un campione col suo colore", () => {
    const opened = open(
      doc(`${DEFS('<linearGradient id="rs" fub:role="swatch" fub:name="Blu" gradientUnits="userSpaceOnUse"><stop stop-color="#0072b2"/></linearGradient>')}${LAYER}${RECT("oa", ' fill="none"')}${RECT("ob", ' fill="url(#rs) #0072b2"')}</g>`),
    );
    applied(opened, changed(opened, { kind: "linear" }));
    const [none, swatch] = painted(opened);
    expect(none!.gradient!.look.stops).toEqual(fadeOf(null));
    expect(swatch!.gradient!.look.stops).toEqual(fadeOf("#0072b2"));
    // Il campione resta: è un colore del documento.
    expect(opened.engine.holder("rs")).not.toBeNull();
  });

  it("da una campitura col suo fondo, o col colore delle righe, e da un motivo col suo ripiego", () => {
    const hatch = (id: string, value: string): string => {
      const [, , step, width, color, background] = value.split(" ");
      const fond = background === undefined ? "" : `<rect width="${step}" height="${step}" fill="${background}"/>`;
      const middle = (Number(step) - Number(width)) / 2;
      return `<pattern id="${id}" fub:role="private" fub:pattern="${value}" patternUnits="userSpaceOnUse" width="${step}" height="${step}" patternTransform="rotate(-45)">${fond}<rect y="${middle}" width="${step}" height="${width}" fill="${color}"/></pattern>`;
    };
    const defs = [
      hatch("rh", "lines -45 8 1.5 #000000 #0072b2"),
      hatch("rb", "lines -45 8 1.5 #009e73"),
      '<pattern id="rm" fub:role="swatch" fub:name="Motivo" patternUnits="userSpaceOnUse" width="10" height="10"><rect width="10" height="10" fill="#cc79a7"/></pattern>',
      '<pattern id="rp" fub:role="private" patternUnits="userSpaceOnUse" width="4" height="4"><circle cx="2" cy="2" r="1" fill="#000000"/></pattern>',
    ].join("");
    const fills = ["url(#rh) #003e60", "url(#rb) #009e73", "url(#rm) #cc79a7", "url(#rp) #e69f00"];
    const opened = open(doc(`${DEFS(defs)}${LAYER}${fills.map((fill, at) => RECT(`o${at}`, ` fill="${fill}"`)).join("")}</g>`));
    // Non hanno un tipo, e la sfumatura nasce dal loro colore.
    expect(gradientView(painted(opened))).toMatchObject({ kind: "other", based: true });
    applied(opened, changed(opened, { kind: "linear" }));
    // Il fondo è il colore che l'oggetto aveva, non il ripiego mescolato
    // alle righe.
    expect(painted(opened).map((part) => part.gradient!.look.stops)).toEqual(["#0072b2", "#009e73", "#cc79a7", "#e69f00"].map(fadeOf));
  });

  it("nelle coordinate dell'oggetto, che la porta con sé", () => {
    const opened = open(doc(`${LAYER}${RECT("oa", ' fill="#d55e00" transform="translate(5 5) rotate(30)"')}</g>`));
    const [before] = painted(opened);
    const expected = defaultPlace("linear", before!.matrix, before!.box);
    applied(opened, changed(opened, { kind: "linear" }));
    expect(opened.engine.text).toMatch(/x1="10" y1="30" x2="50" y2="30"/);
    nearPlace(painted(opened)[0]!.gradient!.place, expected);
  });

  it("nel contorno, senza toccare il riempimento", () => {
    const opened = open(doc(`${LAYER}${RECT("oa", ' fill="#d55e00" stroke="#000000" stroke-width="2"')}</g>`));
    const change = changed(opened, { kind: "linear" }, "stroke");
    const [id] = added(change);
    const text = applied(opened, change);
    expect(text).toContain(`fill="#d55e00" stroke="url(#${id}) #000000"`);
    expect(painted(opened, "fill")[0]!.gradient).toBeNull();
    expect(painted(opened, "stroke")[0]!.gradient!.own).toBe(true);
  });

  it("dai punti scelti, lineare", () => {
    const opened = open(doc(`${LAYER}${RECT("oa")}</g>`));
    const stops: GradientStop[] = [
      { offset: 1, color: "#000000", opacity: 1 },
      { offset: 0, color: "#FFFFFF", opacity: 1 },
    ];
    applied(opened, changed(opened, { stops }));
    expect(painted(opened)[0]!.gradient!.look).toEqual({
      kind: "linear",
      spread: "pad",
      stops: [
        { offset: 0, color: "#ffffff", opacity: 1 },
        { offset: 1, color: "#000000", opacity: 1 },
      ],
    });
  });

  it("tracciata, con le righe di uguale colore di traverso anche su un oggetto inclinato", () => {
    const opened = open(doc(`${LAYER}${RECT("oa", ' fill="#d55e00" transform="matrix(1 0 0.5 1 0 0)"')}</g>`));
    const place = drawnPlace("linear", [20, 20], [60, 40]) as Linear;
    const change = changed(opened, { place });
    expect(change.ops.find((op) => addedElem(op, "linearGradient"))).toMatchObject({ elem: { attrs: { gradientTransform: expect.stringMatching(/^matrix\(/) } } });
    applied(opened, change);
    // La trasformazione si scrive con quattro decimali.
    const read = painted(opened)[0]!.gradient!.place as Linear;
    near(read.start, place.start, 1);
    near(read.end, place.end, 1);
  });

  it("non nasce su ciò che non ha misura", () => {
    const opened = open(doc(`${LAYER}<line id="ol" x1="10" y1="10" x2="10" y2="10" stroke="#000000"/></g>`));
    expect(changed(opened, { kind: "linear" }, "stroke")).toMatchObject({ ops: [], reached: 0 });
  });
});

describe("una sfumatura sua cambia sul posto", () => {
  const SOURCE = doc(`${DEFS(LINEAR("rg"))}${LAYER}${RECT("oa", ' fill="url(#rg) #80b9d8"')}</g>`);

  it("si legge come sua, coi punti e dove sta", () => {
    const opened = open(SOURCE);
    const [part] = painted(opened);
    expect(part!.gradient).toMatchObject({
      id: "rg",
      own: true,
      parts: [0, 1],
      look: {
        kind: "linear",
        spread: "pad",
        stops: [
          { offset: 0, color: "#0072b2", opacity: 1 },
          { offset: 1, color: "#ffffff", opacity: 1 },
        ],
      },
    });
    nearPlace(part!.gradient!.place, { kind: "linear", start: [10, 30], end: [50, 30], across: [10, 70] });
    expect(gradientView(painted(opened))).toMatchObject({ count: 1, kind: "linear", angle: 0 });
  });

  it("i colori e le posizioni dei punti, con `set` e `part`", () => {
    const opened = open(SOURCE);
    const change = changed(opened, {
      stops: [
        { offset: 0.25, color: "#d55e00", opacity: 1 },
        { offset: 1, color: "#ffffff", opacity: 0.5 },
      ],
    });
    expect(change.ops.filter((op) => op.op === "set" && op.id === "rg")).toEqual([
      { op: "set", id: "rg", part: [0], attrs: { offset: "0.25", "stop-color": "#d55e00" } },
      { op: "set", id: "rg", part: [1], attrs: { "stop-opacity": "0.5" } },
    ]);
    const text = applied(opened, change);
    expect(text).toMatch(/<stop offset="0.25" stop-color="#d55e00"\/>\s*<stop offset="1" stop-color="#ffffff" stop-opacity="0.5"\/>/);
    // Il ripiego segue.
    expect(text).toContain(`fill="url(#rg) ${averageColor(painted(opened)[0]!.gradient!.look.stops)}"`);
  });

  it("dove sta, come continua oltre i capi e l'angolo", () => {
    const opened = open(SOURCE);
    applied(opened, changed(opened, { place: drawnPlace("linear", [10, 20], [10, 40])! }));
    expect(opened.engine.text).toContain('x1="10" y1="20" x2="10" y2="40"');
    applied(opened, changed(opened, { spread: "reflect" }));
    expect(opened.engine.text).toContain('spreadMethod="reflect"');
    applied(opened, changed(opened, { angle: 0 }));
    expect(opened.engine.text).toContain('x1="0" y1="30" x2="20" y2="30"');
    expect(gradientView(painted(opened)).angle).toBe(0);
    applied(opened, changed(opened, { spread: "pad" }));
    expect(opened.engine.text).not.toContain("spreadMethod");
  });

  it("niente, se è già così", () => {
    const opened = open(SOURCE);
    const same = changed(opened, { stops: painted(opened)[0]!.gradient!.look.stops });
    expect(same.ops.filter((op) => op.op === "set" && op.id === "rg")).toEqual([]);
  });

  it("un punto in più fa una sfumatura nuova al posto della vecchia, che se ne va", () => {
    const opened = open(SOURCE);
    const stops = withStop(painted(opened)[0]!.gradient!.look.stops, 0.5).stops;
    const change = changed(opened, { stops });
    const [id] = added(change);
    expect(change.ops.find((op) => op.op === "add")).toMatchObject({ parent: "fub-defs", pos: { after: "rg" } });
    const text = applied(opened, change);
    expect(opened.engine.holder("rg")).toBeNull();
    expect(text).toContain(`<linearGradient id="${id}" fub:role="private" x1="10" y1="30" x2="50" y2="30" gradientUnits="userSpaceOnUse">`);
    expect(painted(opened)[0]!.gradient!.look.stops).toHaveLength(3);
  });

  it("un altro tipo, dove stava: il mezzo della linea diventa il centro", () => {
    const opened = open(SOURCE);
    applied(opened, changed(opened, { kind: "radial" }));
    expect(opened.engine.holder("rg")).toBeNull();
    nearPlace(painted(opened)[0]!.gradient!.place, { kind: "radial", center: [30, 30], a: [50, 30], b: [30, 50], focus: [30, 30] });
    applied(opened, changed(opened, { kind: "linear" }));
    nearPlace(painted(opened)[0]!.gradient!.place, { kind: "linear", start: [10, 30], end: [50, 30], across: [10, 70] });
  });

  it("torna un colore, il primo, e la sfumatura se ne va", () => {
    const opened = open(SOURCE);
    const text = applied(opened, changed(opened, { kind: "color" }));
    expect(text).toContain('fill="#0072b2"');
    expect(opened.engine.holder("rg")).toBeNull();
  });
});

describe("una sfumatura che non è soltanto sua", () => {
  it("condivisa, cambia in una copia per chi la cambia, e resta agli altri", () => {
    const opened = open(doc(`${DEFS(LINEAR("rg", ' fub:role="shared" gradientUnits="userSpaceOnUse" x1="10" y1="30" x2="50" y2="30"'))}${LAYER}${RECT("oa", ' fill="url(#rg)"')}${RECT("ob", ' fill="url(#rg)"')}</g>`));
    expect(painted(opened).map((part) => part.gradient!.own)).toEqual([false, false]);
    const change = changed(opened, { spread: "repeat" }, "fill", ["oa"]);
    const [id] = added(change);
    const text = applied(opened, change);
    expect(text).toContain(`<rect id="oa" x="10" y="20" width="40" height="20" fill="url(#${id}) #80b9d9"/>`);
    expect(text).toContain('<rect id="ob" x="10" y="20" width="40" height="20" fill="url(#rg)"/>');
    expect(opened.engine.holder("rg")).not.toBeNull();
  });

  it("privata ma usata anche dall'altro colore, o ereditata, non cambia sul posto", () => {
    const opened = open(doc(`${DEFS(LINEAR("rg"))}${LAYER}${RECT("oa", ' fill="url(#rg)" stroke="url(#rg)"')}</g>`));
    expect(painted(opened)[0]!.gradient!.own).toBe(false);
    const inherited = open(doc(`${DEFS(LINEAR("rg"))}${LAYER}<g id="og" fill="url(#rg)">${RECT("oa", "")}</g></g>`));
    expect(painted(inherited)[0]!.gradient!.own).toBe(false);
    const change = changed(inherited, { spread: "reflect" });
    expect(added(change)).toHaveLength(1);
    const text = applied(inherited, change);
    expect(text).toContain('<g id="og" fill="url(#rg)">');
    expect(text).toMatch(/<rect id="oa" x="10" y="20" width="40" height="20" fill="url\(#r\w+\) #80b9d9"\/>/);
  });

  it("nelle unità del riquadro, si legge sul riquadro e si riscrive nelle coordinate dell'oggetto", () => {
    const opened = open(doc(`${DEFS('<linearGradient id="rg" x2="0" y2="1"><stop offset="0" stop-color="#0072b2"/><stop offset="100%" stop-color="#ffffff"/></linearGradient>')}${LAYER}${RECT("oa", ' fill="url(#rg)"')}</g>`));
    const [part] = painted(opened);
    expect(part!.gradient!.own).toBe(false);
    nearPlace(part!.gradient!.place, { kind: "linear", start: [10, 20], end: [10, 40], across: [-30, 20] });
    applied(opened, changed(opened, { spread: "reflect" }));
    expect(opened.engine.text).toContain('x1="10" y1="20" x2="10" y2="40" gradientUnits="userSpaceOnUse" spreadMethod="reflect"');
  });

  it("di un punto solo, e non campione, nasce dove nascerebbe", () => {
    const opened = open(doc(`${DEFS('<linearGradient id="rg" fub:role="private"><stop stop-color="#0072b2"/></linearGradient>')}${LAYER}${RECT("oa", ' fill="url(#rg)"')}</g>`));
    const [part] = painted(opened);
    nearPlace(part!.gradient!.place, { kind: "linear", start: [10, 30], end: [50, 30], across: [10, 70] });
    applied(opened, changed(opened, { stops: withStop(part!.gradient!.look.stops, 1).stops }));
    expect(opened.engine.text).toContain('x1="10" y1="30" x2="50" y2="30" gradientUnits="userSpaceOnUse"');
  });
});

describe("l'anteprima", () => {
  it("mostra la sfumatura intera che ogni parte avrebbe, o il colore", () => {
    const opened = open(doc(`${DEFS(LINEAR("rg"))}${LAYER}${RECT("oa", ' fill="url(#rg) #80b9d9"')}${RECT("ob")}</g>`));
    const units = opened.reindex().units;
    const model = opened.engine.model!;
    const [a, b] = painted(opened).map((part) => part.node);
    const stops: GradientStop[] = [
      { offset: 0, color: "#0072b2", opacity: 1 },
      { offset: 0.5, color: "#f0e442", opacity: 0.5 },
      { offset: 1, color: "#ffffff", opacity: 1 },
    ];
    const shown = gradientPreview(model, units, "fill", { stops });
    // La sua cambia dove sta, con tre punti; il colore diventa una lineare.
    expect(shown.get(a!)).toEqual({
      name: "fill",
      value: {
        tag: "linearGradient",
        attrs: { id: "preview", "fub:role": "private", gradientUnits: "userSpaceOnUse", x1: "10", y1: "30", x2: "50", y2: "30" },
        children: [
          { tag: "stop", attrs: { offset: "0", "stop-color": "#0072b2" } },
          { tag: "stop", attrs: { offset: "0.5", "stop-color": "#f0e442", "stop-opacity": "0.5" } },
          { tag: "stop", attrs: { offset: "1", "stop-color": "#ffffff" } },
        ],
      },
    });
    expect(shown.get(b!)).toMatchObject({ name: "fill", value: { tag: "linearGradient", attrs: { x1: "10", y1: "30", x2: "50", y2: "30" } } });
    // Pieno: il primo colore; una parte che resta com'è non c'è.
    const solid = gradientPreview(model, units, "fill", { kind: "color" });
    expect(solid.get(a!)).toEqual({ name: "fill", value: "#0072b2" });
    expect(solid.has(b!)).toBe(false);
    // Soltanto le parti chieste.
    expect([...gradientPreview(model, units, "fill", { stops }, new Set([b!])).keys()]).toEqual([b]);
    // L'anteprima non scrive niente.
    expect(opened.engine.text).not.toContain("#f0e442");
  });
});

describe("la selezione", () => {
  it("dice il tipo comune, la sfumatura comune e l'angolo comune", () => {
    const opened = open(doc(`${DEFS(LINEAR("rg") + LINEAR("rh"))}${LAYER}${RECT("oa", ' fill="url(#rg)"')}${RECT("ob", ' fill="url(#rh)"')}${RECT("oc")}</g>`));
    const parts = painted(opened);
    // L'angolo è quello delle parti con una sfumatura, anche se non tutte
    // ne hanno una.
    expect(gradientView(parts)).toEqual({ count: 3, gradients: 2, kind: null, based: true, look: null, angle: 0 });
    expect(gradientView(parts.slice(0, 2))).toMatchObject({ count: 2, gradients: 2, kind: "linear", angle: 0 });
    expect(gradientView(parts.slice(2))).toEqual({ count: 1, gradients: 0, kind: "color", based: true, look: null, angle: null });
    expect(gradientView([])).toEqual({ count: 0, gradients: 0, kind: null, based: false, look: null, angle: null });
    const other = open(doc(`${LAYER}${RECT("oa", ' fill="none"')}</g>`));
    expect(gradientView(painted(other))).toMatchObject({ kind: "other", based: false });
  });

  it("dà a ciascuna la dissolvenza del suo colore, e ne rovescia i punti", () => {
    const opened = open(doc(`${DEFS(LINEAR("rg"))}${LAYER}${RECT("oa", ' fill="url(#rg)"')}${RECT("ob")}</g>`));
    applied(opened, changed(opened, { fade: true }));
    expect(opened.engine.holder("rg")).not.toBeNull();
    expect(painted(opened).map((part) => part.gradient!.look.stops)).toEqual([fadeOf("#0072b2"), fadeOf("#d55e00")]);
    applied(opened, changed(opened, { reverse: true }));
    expect(painted(opened).map((part) => part.gradient!.look.stops)).toEqual([reversedStops(fadeOf("#0072b2")), reversedStops(fadeOf("#d55e00"))]);
  });

  it("mostra sul foglio una sfumatura per ogni posto", () => {
    const opened = open(doc(`${DEFS(LINEAR("rg") + LINEAR("rh") + LINEAR("ri", ' fub:role="private" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="10" y2="0"'))}${LAYER}${RECT("oa", ' fill="url(#rg)"')}${RECT("ob", ' fill="url(#rh)"')}${RECT("oc", ' fill="url(#ri)"')}</g>`));
    const handles = gradientHandles(painted(opened), 0.01);
    expect(handles.map((each) => each.parts.map((part) => part.gradient!.id))).toEqual([["rg", "rh"], ["ri"]]);
  });

  it("cambia tutto insieme, in un passo", () => {
    const opened = open(doc(`${LAYER}${RECT("oa")}${RECT("ob", ' fill="#0072b2"')}</g>`));
    const change = changed(opened, { kind: "linear" });
    expect(change.reached).toBe(2);
    expect(added(change)).toHaveLength(2);
    applied(opened, change);
    expect(painted(opened).map((part) => part.gradient!.look.stops[0]!.color)).toEqual(["#d55e00", "#0072b2"]);
  });
});

describe("dove sta", () => {
  const LINE: GradientPlace = { kind: "linear", start: [0, 0], end: [10, 0], across: [0, 10] };
  const ROUND: GradientPlace = { kind: "radial", center: [0, 0], a: [10, 0], b: [0, 5], focus: [2, 1] };

  it("un capo gira e allunga la linea attorno all'altro, con le sue righe", () => {
    nearPlace(placeWith(LINE, "end", [0, 20]), { kind: "linear", start: [0, 0], end: [0, 20], across: [-20, 0] });
    nearPlace(placeWith(LINE, "start", [5, 0]), { kind: "linear", start: [5, 0], end: [10, 0], across: [5, 5] });
    expect(placeWith(LINE, "end", [0, 0])).toBe(LINE);
  });

  it("il centro sposta, il primo raggio gira e scala, il secondo si allunga soltanto", () => {
    nearPlace(placeWith(ROUND, "center", [1, 1]), { kind: "radial", center: [1, 1], a: [11, 1], b: [1, 6], focus: [3, 2] });
    nearPlace(placeWith(ROUND, "a", [0, 20]), { kind: "radial", center: [0, 0], a: [0, 20], b: [-10, 0], focus: [-2, 4] });
    const longer = placeWith(ROUND, "b", [3, 10]) as Extract<GradientPlace, { kind: "radial" }>;
    near(longer.b, [0, 10]);
    near(longer.focus, [2, 2]);
  });

  it("il fuoco resta dentro il bordo", () => {
    const out = placeWith(ROUND, "focus", [30, 0]) as Extract<GradientPlace, { kind: "radial" }>;
    near(out.focus, [10 * FOCUS_LIMIT, 0]);
    const written = writtenPlace({ kind: "radial", center: [0, 0], a: [10, 0], b: [0, 10], focus: [10, 0] }, [1, 0, 0, 1, 0, 0])!;
    expect(written).toEqual({ cx: "0", cy: "0", r: "10", fx: "9.9", fy: "0" });
    const tiny = writtenPlace({ kind: "radial", center: [0, 0], a: [0.01, 0], b: [0, 0.01], focus: [0.01, 0] }, [1, 0, 0, 1, 0, 0])!;
    expect(tiny).toEqual({ cx: "0", cy: "0", r: "0.01" });
  });

  it("un cerchio girato tiene la sua trasformazione, per tenere dove stanno i capi", () => {
    const turned = writtenPlace({ kind: "radial", center: [0, 0], a: [0, 10], b: [-10, 0], focus: [0, 0] }, [1, 0, 0, 1, 0, 0])!;
    expect(turned).toEqual({ cx: "0", cy: "0", r: "10", gradientTransform: "matrix(0 1 -1 0 0 0)" });
  });

  it("l'angolo, girato attorno al mezzo o al centro", () => {
    expect(placeAngle(LINE)).toBe(0);
    expect(placeAngle({ ...LINE, end: [-10, 0] })).toBe(180);
    expect(placeAngle({ ...LINE, end: [0, -10] })).toBe(-90);
    nearPlace(placeTurned(LINE, 90), { kind: "linear", start: [5, -5], end: [5, 5], across: [-5, -5] });
    nearPlace(placeTurned(ROUND, 90), { kind: "radial", center: [0, 0], a: [0, 10], b: [-5, 0], focus: [-1, 2] });
  });

  it("dove sta un punto lungo la linea, anche con le righe inclinate", () => {
    expect(placeAt(LINE, [5, 7])).toBeCloseTo(0.5);
    const slanted: GradientPlace = { kind: "linear", start: [0, 0], end: [10, 0], across: [5, 10] };
    expect(placeAt(slanted, [5, 10])).toBeCloseTo(0);
    expect(placeAt(slanted, [10, 0])).toBeCloseTo(1);
    expect(placeAt(ROUND, [5, 3])).toBeCloseTo(0.5);
    near(pointAt(LINE, 0.25), [2.5, 0]);
    near(pointAt(ROUND, 0.5), [5, 0]);
  });

  it("tracciata, vincolata a 45°, e dell'altro tipo", () => {
    near(constrained([0, 0], [10, 1]), [10, 0]);
    near(constrained([0, 0], [10, 9]), [9.5, 9.5]);
    expect(drawnPlace("linear", [1, 1], [1, 1])).toBeNull();
    nearPlace(drawnPlace("radial", [0, 0], [10, 0]), { kind: "radial", center: [0, 0], a: [10, 0], b: [0, 10], focus: [0, 0] });
    nearPlace(placeAs(LINE, "radial"), { kind: "radial", center: [5, 0], a: [10, 0], b: [5, 5], focus: [5, 0] });
    nearPlace(placeAs(ROUND, "linear"), { kind: "linear", start: [-10, 0], end: [10, 0], across: [-10, 20] });
  });

  it("dove nasce, anche su un riquadro senza larghezza", () => {
    nearPlace(defaultPlace("linear", [1, 0, 0, 1, 0, 0], { min: [5, 0], max: [5, 10] }), { kind: "linear", start: [5, 0], end: [5, 10], across: [-5, 0] });
    nearPlace(defaultPlace("radial", [1, 0, 0, 1, 0, 0], { min: [5, 0], max: [5, 10] }), { kind: "radial", center: [5, 5], a: [10, 5], b: [5, 10], focus: [5, 5] });
    expect(defaultPlace("linear", [1, 0, 0, 1, 0, 0], { min: [5, 5], max: [5, 5] })).toBeNull();
    expect(defaultPlace("linear", [1, 0, 0, 1, 0, 0], null)).toBeNull();
  });

  it("non si scrive su un piano schiacciato", () => {
    expect(writtenPlace(LINE, [0, 0, 0, 0, 0, 0])).toBeNull();
    expect(writtenPlace({ kind: "linear", start: [0, 0], end: [0.001, 0], across: [0, 1] }, [1, 0, 0, 1, 0, 0])).toBeNull();
  });
});

describe("i punti", () => {
  const TWO: GradientStop[] = [
    { offset: 0, color: "#000000", opacity: 1 },
    { offset: 1, color: "#ffffff", opacity: 0 },
  ];

  it("un punto nuovo ha il colore che si vede lì", () => {
    expect(stopAt(TWO, 0.5)).toEqual({ color: "#808080", opacity: 0.5 });
    expect(withStop(TWO, 0.25)).toEqual({
      stops: [TWO[0], { offset: 0.25, color: "#404040", opacity: 0.75 }, TWO[1]],
      index: 1,
    });
    expect(withStop(TWO, 1).index).toBe(2);
  });

  it("un punto che si sposta si rimette in ordine, e fra gli uguali resta dalla sua parte", () => {
    const three: GradientStop[] = [TWO[0]!, { offset: 0.5, color: "#ff0000", opacity: 1 }, TWO[1]!];
    expect(movedStop(three, 1, 1.2)).toEqual({ stops: [TWO[0], { offset: 1, color: "#ff0000", opacity: 1 }, TWO[1]], index: 1 });
    expect(movedStop(three, 2, 0.5).index).toBe(2);
    expect(movedStop(three, 0, 0.5).index).toBe(0);
    expect(movedStop(three, 1, 0.5).index).toBe(1);
  });

  it("si rovesciano, si ordinano e si tengono fra 0 e 1", () => {
    expect(reversedStops(TWO)).toEqual([
      { offset: 0, color: "#ffffff", opacity: 0 },
      { offset: 1, color: "#000000", opacity: 1 },
    ]);
    expect(
      sortedStops([
        { offset: 2, color: "#FF0000", opacity: 3 },
        { offset: -1, color: "#00ff00", opacity: -1 },
        { offset: Number.NaN, color: "#0000ff", opacity: 1 },
      ]),
    ).toEqual([
      { offset: 0, color: "#00ff00", opacity: 0 },
      { offset: 0, color: "#0000ff", opacity: 1 },
      { offset: 1, color: "#ff0000", opacity: 1 },
    ]);
  });

  it("il ripiego è la media dei colori pesata sull'opacità", () => {
    expect(averageColor(TWO)).toBe("#555555");
    expect(averageColor(fadeOf("#d55e00"))).toBe("#d55e00");
    expect(averageColor([{ offset: 0.5, color: "#ffffff", opacity: 1 }])).toBe("#ffffff");
    expect(
      averageColor([
        { offset: 0, color: "#ff0000", opacity: 0 },
        { offset: 1, color: "#0000ff", opacity: 0 },
      ]),
    ).toBe("#800080");
    // I capi pieni contano.
    expect(
      averageColor([
        { offset: 0.5, color: "#000000", opacity: 1 },
        { offset: 0.5, color: "#ffffff", opacity: 1 },
      ]),
    ).toBe("#808080");
  });
});

describe("il banco di fedeltà", () => {
  it("ha le sfumature come le scrive l'editor: sue, che si leggono, col loro ripiego", () => {
    const opened = open(FIDELITY.find((scene) => scene.id === "sfumature")!.text);
    const parts = [...painted(opened), ...painted(opened, "stroke")].filter((part) => part.value.startsWith("url("));
    expect(parts.map((part) => part.gradient?.id).sort()).toEqual(["g1", "g2", "g3", "g4", "g5", "g6", "g7"]);
    for (const part of parts) {
      expect(part.gradient!.own).toBe(true);
      expect(part.gradient!.place).not.toBeNull();
      expect(part.value).toBe(`url(#${part.gradient!.id}) ${averageColor(part.gradient!.look.stops)}`);
    }
  });
});
