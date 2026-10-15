// Gli effetti degli oggetti: la grammatica di `fub:effect`, il filtro che ne
// discende, come si riconosce, le operazioni, che il motore accetta così
// come sono e che un annulla disfa al byte, e la regione che segue
// l'oggetto nello stesso passo.

import { describe, expect, it } from "vitest";
import { PF1_DEFAULTS } from "../ink/brush";
import { quantizeInk, type InkSample } from "../ink/sample";
import { parsePath } from "../scene/geometry";
import type { Elem } from "../scene/serialize";
import { doc } from "../scene/test-support";
import { applyOps } from "./apply";
import { duplicateOps, ungroupOps } from "./arrange";
import { NewIds, strokeElem } from "./edit";
import {
  defaultEffect,
  effectsOps,
  effectsRefusal,
  effectsState,
  filterElem,
  followEffects,
  MAX_EFFECTS,
  parseEffects,
  regionOf,
  regionReach,
  visibleReach,
  writeEffects,
  type Blur,
  type Effect,
  type Shadow,
} from "./effects";
import type { Unit } from "./hit";
import { estimate } from "./measure";
import { widthAttrs } from "./profile";
import { POLYGON_TOOL, shapeElem } from "./shapes";
import { LAYER, open, type Opened } from "./test-support";
import { applied, DEFS, written } from "./tip-support";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

/// Il motore di `body`, dentro il primo livello, con le regioni che seguono
/// gli oggetti, come lo installa l'editor.
function sheet(body: string, defs = ""): Opened {
  const opened = open(doc(`${defs}${LAYER}${body}</g>`));
  opened.engine.follow = (model, touched) => followEffects(model, touched, (id) => opened.engine.holder(id), estimate);
  return opened;
}

/// Le unità di `keys`, adesso.
function units(opened: Opened, ...keys: string[]): Unit[] {
  const index = opened.reindex();
  return keys.map((key) => {
    const unit = index.get(key);
    if (unit === null) throw new Error(`nessuna unità ${key}`);
    return unit;
  });
}

const SHADOW: Shadow = { kind: "shadow", dx: 0, dy: 4, blur: 8, color: "#000000", opacity: 0.25, hidden: false };
const BLUR: Blur = { kind: "blur", radius: 4, hidden: false };

/// Gli effetti di `id` adesso.
const stateOf = (opened: Opened, id: string): ReturnType<typeof effectsState> => effectsState(opened.engine.model!, opened.engine.holder(id)!);

/// L'elemento `tag` del testo, col suo id.
const elementOf = (text: string, tag: string): string => new RegExp(`<${tag}[ >][\\s\\S]*?</${tag}>`).exec(text)?.[0] ?? "";

/// Un elemento scritto, su una riga sola.
const flat = (elem: Parameters<typeof written>[0]): string => written(elem).replace(/\n\s*/g, "");

const RECT = '<rect id="r" x="10" y="20" width="100" height="50" fill="#0072b2"/>';

describe("la grammatica di fub:effect", () => {
  it("si legge e si riscrive uguale, in ordine, coi nascosti", () => {
    const text = "shadow 0 4 8 #000000 0.25; inner-shadow -1.5 2 4 #102030 0.5 hidden; glow 8 #ffd400 0.75; inner-glow 6 #ffffff 1; blur 4";
    const effects = parseEffects(text)!;
    expect(effects.map((effect) => effect.kind)).toEqual(["shadow", "inner-shadow", "glow", "inner-glow", "blur"]);
    expect(effects[1]).toEqual({ kind: "inner-shadow", dx: -1.5, dy: 2, blur: 4, color: "#102030", opacity: 0.5, hidden: true });
    expect(writeEffects(effects)).toBe(text);
    expect(parseEffects("")).toEqual([]);
    // Gli spazi in più si leggono; si scrive la forma sola.
    expect(writeEffects(parseEffects("  blur   4 ;shadow 0 4 8 #000000 0.25  ")!)).toBe("blur 4; shadow 0 4 8 #000000 0.25");
  });

  it("non legge ciò che FubDraw non scrive", () => {
    for (const wrong of [
      "shadow 0 4 8 #000 0.25",
      "shadow 0 4 8 #FF0000 0.25",
      "shadow 0 4 8 red 0.25",
      "shadow 0 4 -8 #000000 0.25",
      "shadow 0 4 8 #000000 1.5",
      "shadow 0 4 8 #000000",
      "shadow 0 4.125 8 #000000 0.25",
      "shadow 0 4 8 #000000 0.12345",
      "glow 8 #ffd400 0.75 hidden hidden",
      "blur 4; blur 2",
      "blur",
      "spark 4",
      "blur 4;",
      ";",
      "shadow 0 4 8 #000000 0.25 visible",
      Array.from({ length: MAX_EFFECTS + 1 }, () => "blur 1").join("; "),
    ]) {
      expect(parseEffects(wrong), wrong).toBeNull();
    }
    expect(parseEffects(Array.from({ length: MAX_EFFECTS }, () => "glow 1 #ffffff 1").join("; "))).toHaveLength(MAX_EFFECTS);
  });

  it("ogni effetto nuovo nasce coi suoi valori", () => {
    expect([defaultEffect("shadow"), defaultEffect("blur")]).toEqual([SHADOW, BLUR]);
    expect(writeEffects(["inner-shadow", "glow", "inner-glow"].map((kind) => defaultEffect(kind as Effect["kind"])))).toBe(
      "inner-shadow 0 2 4 #000000 0.25; glow 8 #ffd400 0.75; inner-glow 6 #ffffff 0.75",
    );
  });
});

describe("il filtro", () => {
  const region = { x: "0", y: "0", width: "10", height: "10" };

  it("un'ombra è l'alfa sfocato e spostato, del suo colore, sotto l'oggetto", () => {
    expect(flat(filterElem("f1", [SHADOW], region))).toBe(
      '<filter id="f1" fub:role="private" x="0" y="0" width="10" height="10" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">'
        + '<feGaussianBlur in="SourceAlpha" result="b1" stdDeviation="4"/>'
        + '<feOffset dx="0" dy="4" in="b1" result="o1"/>'
        + '<feFlood flood-color="#000000" flood-opacity="0.25"/>'
        + '<feComposite in2="o1" result="e1" operator="in"/>'
        + '<feMerge><feMergeNode in="e1"/><feMergeNode in="SourceGraphic"/></feMerge>'
        + "</filter>",
    );
  });

  it("gli effetti interni capovolgono l'alfa e si ritagliano sulla forma, sopra l'oggetto; la sfocatura va su tutto", () => {
    const effects: Effect[] = [defaultEffect("inner-glow"), SHADOW, BLUR];
    expect(flat(filterElem("f1", effects, region))).toBe(
      '<filter id="f1" fub:role="private" x="0" y="0" width="10" height="10" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">'
        + '<feColorMatrix in="SourceAlpha" result="a1" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -1 1"/>'
        + '<feGaussianBlur in="a1" result="b1" stdDeviation="3"/>'
        + '<feFlood flood-color="#ffffff" flood-opacity="0.75"/>'
        + '<feComposite in2="b1" operator="in"/>'
        + '<feComposite in2="SourceAlpha" result="e1" operator="in"/>'
        + '<feGaussianBlur in="SourceAlpha" result="b2" stdDeviation="4"/>'
        + '<feOffset dx="0" dy="4" in="b2" result="o2"/>'
        + '<feFlood flood-color="#000000" flood-opacity="0.25"/>'
        + '<feComposite in2="o2" result="e2" operator="in"/>'
        + '<feMerge><feMergeNode in="e2"/><feMergeNode in="SourceGraphic"/><feMergeNode in="e1"/></feMerge>'
        + '<feGaussianBlur stdDeviation="2"/>'
        + "</filter>",
    );
  });

  it("una sfocatura o uno scostamento di zero non si scrivono, e i nascosti non ci sono", () => {
    const plain: Effect = { kind: "shadow", dx: 0, dy: 0, blur: 0, color: "#ff0000", opacity: 1, hidden: false };
    const text = flat(filterElem("f1", [plain, { ...SHADOW, hidden: true }], region));
    expect(text).not.toContain("feGaussianBlur");
    expect(text).not.toContain("feOffset");
    expect(text).toContain('<feFlood flood-color="#ff0000" flood-opacity="1"/><feComposite in2="SourceAlpha" result="e1" operator="in"/>');
    expect(text.match(/feMergeNode/g)).toHaveLength(2);
    expect(written(filterElem("f1", [{ kind: "blur", radius: 0, hidden: false }], region))).toContain('<feOffset in="SourceGraphic"/>');
  });

  it("ogni filtro che scrive è del formato, e al più di 64 primitive", () => {
    const worst = Array.from({ length: MAX_EFFECTS }, () => defaultEffect("inner-shadow"));
    const elem = filterElem("f1", worst, region);
    const count = (elem.children ?? []).reduce((sum, child) => sum + 1 + (child.children?.length ?? 0), 0);
    expect(count).toBeLessThanOrEqual(64);
    const opened = sheet(`<rect id="r" width="10" height="10" filter="url(#f1)" fub:effect="${writeEffects(worst)}"/>`, DEFS(written(elem)));
    expect(opened.engine.scene().every((item) => item.kind !== "foreign")).toBe(true);
    expect(stateOf(opened, "r")).toEqual({ kind: "effects", effects: worst, filter: "f1" });
  });
});

describe("quanto arrivano", () => {
  it("un'ombra arriva tre deviazioni oltre il suo scostamento; gli interni non dipingono fuori, ma la regione li contiene", () => {
    expect(visibleReach([SHADOW])).toEqual({ left: 12, top: 8, right: 12, bottom: 16 });
    const inside = defaultEffect("inner-shadow");
    expect(visibleReach([inside])).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
    expect(regionReach([inside])).toEqual({ left: 8, top: 8, right: 8, bottom: 8 });
    // La sfocatura allarga tutto il resto.
    expect(visibleReach([SHADOW, BLUR])).toEqual({ left: 18, top: 14, right: 18, bottom: 22 });
    expect(visibleReach([{ ...SHADOW, hidden: true }])).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });

  it("la regione è il riquadro dell'oggetto, contorno compreso, allargato e portato ai centesimi per eccesso", () => {
    const opened = sheet('<rect id="r" x="10.004" y="20" width="100" height="50" stroke="#000000" stroke-width="3" stroke-linejoin="round"/>');
    const region = regionOf(opened.engine.model!, opened.engine.holder("r")!, [SHADOW], estimate)!;
    // Il contorno arriva 3·√½ ≈ 2,12 oltre; l'ombra 12 a sinistra e 8 sopra,
    // 12 a destra e 16 sotto; e 2 di margine.
    const side = 3 * Math.SQRT1_2;
    expect(Number(region.x)).toBe(Math.floor((10.004 - side - 14) * 100) / 100);
    expect(Number(region.y)).toBe(Math.floor((20 - side - 10) * 100) / 100);
    expect(Number(region.x) + Number(region.width)).toBeGreaterThanOrEqual(110.004 + side + 14);
    expect(Number(region.y) + Number(region.height)).toBeGreaterThanOrEqual(70 + side + 18);
  });
});

describe("effectsOps", () => {
  it("dà un'ombra: fub:effect sull'oggetto e il filtro privato, del formato, e la selezione resta", () => {
    const opened = sheet(RECT);
    const out = effectsOps(opened.engine.model!, units(opened, "r"), { kind: "add", effect: SHADOW }, estimate, ids(opened));
    if (typeof out === "string") throw new Error(out);
    expect(out.keys).toEqual(["r"]);
    const after = applied(opened, out.ops);
    expect(after).toMatch(/<rect id="r" x="10" y="20" width="100" height="50" fill="#0072b2" filter="url\(#r[0-9a-z]{8}\)" fub:effect="shadow 0 4 8 #000000 0.25"\/>/);
    const state = stateOf(opened, "r");
    expect(state.kind).toBe("effects");
    expect(elementOf(after, "filter")).toContain('fub:role="private"');
  });

  it("cambia un valore sul posto, e un effetto in più rifà il filtro", () => {
    const opened = sheet(RECT);
    const add = (effect: Effect): void => {
      const out = effectsOps(opened.engine.model!, units(opened, "r"), { kind: "add", effect }, estimate, ids(opened));
      if (typeof out === "string") throw new Error(out);
      applied(opened, out.ops);
    };
    add(SHADOW);
    const first = stateOf(opened, "r");
    if (first.kind !== "effects") throw new Error("niente effetti");
    const change = effectsOps(opened.engine.model!, units(opened, "r"), { kind: "set", effects: [{ ...SHADOW, color: "#d55e00" }] }, estimate, ids(opened));
    if (typeof change === "string") throw new Error(change);
    // Il colore cambia nel filtro che c'è, con un `set` sulla sua parte.
    expect(change.ops.filter((op) => op.op === "set" && op.id === first.filter)).toHaveLength(1);
    applied(opened, change.ops);
    expect(stateOf(opened, "r")).toEqual({ kind: "effects", effects: [{ ...SHADOW, color: "#d55e00" }], filter: first.filter });
    add(BLUR);
    const second = stateOf(opened, "r");
    expect(second.kind === "effects" && second.filter !== first.filter).toBe(true);
    // Il filtro di prima, che nessuno usa più, se ne va nello stesso passo.
    expect(opened.engine.text.match(/<filter /g)).toHaveLength(1);
  });

  it("con gli effetti tutti nascosti il filtro se ne va, e tornano visibili con un filtro nuovo", () => {
    const opened = sheet(RECT);
    const set = (effects: readonly Effect[]): void => {
      const out = effectsOps(opened.engine.model!, units(opened, "r"), { kind: "set", effects }, estimate, ids(opened));
      if (typeof out === "string") throw new Error(out);
      applied(opened, out.ops);
    };
    set([SHADOW]);
    set([{ ...SHADOW, hidden: true }]);
    expect(opened.engine.text).not.toContain("<filter");
    expect(opened.engine.text).toContain('fub:effect="shadow 0 4 8 #000000 0.25 hidden"');
    expect(stateOf(opened, "r")).toEqual({ kind: "effects", effects: [{ ...SHADOW, hidden: true }], filter: null });
    set([SHADOW]);
    expect(stateOf(opened, "r").kind).toBe("effects");
    set([]);
    expect(opened.engine.text).not.toContain("fub:effect");
    expect(opened.engine.text).not.toContain("<filter");
  });

  it("un filtro d'un altro programma si vede come tale, e un effetto lo sostituisce", () => {
    const other = '<filter id="x" x="0" y="0" width="200" height="200" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="2"/></filter>';
    const opened = sheet('<rect id="r" width="10" height="10" filter="url(#x)"/>', DEFS(other));
    expect(stateOf(opened, "r")).toEqual({ kind: "other", filter: "x" });
    const out = effectsOps(opened.engine.model!, units(opened, "r"), { kind: "add", effect: SHADOW }, estimate, ids(opened));
    if (typeof out === "string") throw new Error(out);
    applied(opened, out.ops);
    expect(stateOf(opened, "r").kind).toBe("effects");
    // Il filtro dell'altro programma resta fra le risorse: non è privato.
    expect(opened.engine.text).toContain('<filter id="x"');
  });

  it("un filtro che non è quello che FubDraw scrive non è suo, nemmeno con fub:effect", () => {
    const opened = sheet(RECT);
    const out = effectsOps(opened.engine.model!, units(opened, "r"), { kind: "add", effect: SHADOW }, estimate, ids(opened));
    if (typeof out === "string") throw new Error(out);
    applied(opened, out.ops);
    const state = stateOf(opened, "r");
    if (state.kind !== "effects") throw new Error("niente effetti");
    const changed = opened.engine.apply({ op: "set", id: state.filter!, part: [3], attrs: { operator: "out" } });
    expect(changed.outcome).toBe("applied");
    expect(stateOf(opened, "r")).toEqual({ kind: "other", filter: state.filter });
  });

  it("non li dà a un oggetto ritagliato, a un livello, né oltre il massimo o con una seconda sfocatura", () => {
    const clip = '<clipPath id="c" fub:role="private"><rect width="5" height="5"/></clipPath>';
    const full = Array.from({ length: MAX_EFFECTS }, () => "glow 1 #ffffff 1 hidden").join("; ");
    const opened = sheet(`<rect id="r" width="10" height="10" clip-path="url(#c)"/><rect id="s" width="10" height="10" fub:effect="${full}"/><rect id="t" width="10" height="10" fub:effect="blur 2 hidden"/>`, DEFS(clip));
    const add = (key: string, effect: Effect): ReturnType<typeof effectsOps> => effectsOps(opened.engine.model!, units(opened, key), { kind: "add", effect }, estimate, ids(opened));
    expect(add("r", SHADOW)).toBe("clipped");
    expect(effectsRefusal(opened.engine.model!, opened.engine.holder("l1")!, estimate)).toBe("kind");
    expect(add("s", SHADOW)).toBe("full");
    expect(add("t", BLUR)).toBe("full");
    expect(typeof add("t", SHADOW)).toBe("object");
    // Toglierli si può sempre, anche a chi è ritagliato.
    expect(typeof effectsOps(opened.engine.model!, units(opened, "r"), { kind: "clear" }, estimate, ids(opened))).toBe("object");
  });

  it("su più oggetti, ciascuno ha il suo filtro", () => {
    const opened = sheet(`${RECT}<ellipse id="e" cx="50" cy="50" rx="10" ry="5"/>`);
    const out = effectsOps(opened.engine.model!, units(opened, "r", "e"), { kind: "set", effects: [SHADOW] }, estimate, ids(opened));
    if (typeof out === "string") throw new Error(out);
    applied(opened, out.ops);
    const a = stateOf(opened, "r");
    const b = stateOf(opened, "e");
    expect(a.kind === "effects" && b.kind === "effects" && a.filter !== b.filter).toBe(true);
  });

  it("li prende ogni cosa che si disegna: un tratto a penna, una freccia, un poligono, una stella, una linea a spessore variabile", () => {
    const samples: InkSample[] = [];
    for (let i = 0; i <= 25; i++) samples.push({ x: 10 + 2 * i, y: 50, p: 0.5, t: 8 * i });
    const brush = { ...PF1_DEFAULTS, size: 8, thinning: 0, taperStart: 0, taperEnd: 0 };
    const style = { color: "#0072b2", width: 4 };
    const straight = { ...POLYGON_TOOL, straight: false };
    const width = widthAttrs({ cap: "round", join: "miter", profile: [[0, 2, 2], [1, 0, 0]], spine: parsePath("M0 0 L100 0")! })!;
    const drawn: [string, Elem][] = [
      ["stroke", strokeElem("o1a2b3c4k", "#000000", brush, quantizeInk(samples), null)],
      ["arrow", shapeElem("arrow", "o1a2b3c4a", [10, 20], [110, 20], style, 4)!],
      ["ngon", shapeElem("polygon", "o1a2b3c4p", [100, 100], [100, 50], style, 4, straight)!],
      ["star", shapeElem("polygon", "o1a2b3c4s", [0, 0], [0, -40], style, 4, { ...straight, shape: "star" })!],
      ["width", { tag: "path", attrs: { id: "o1a2b3c4w", "fub:shape": "width", "fub:geom": width.geom, d: width.d, fill: "#000000" } }],
    ];
    const opened = sheet("");
    for (const [, elem] of drawn) expect(opened.engine.apply({ op: "add", parent: "l1", pos: { last: true }, elem }).outcome).toBe("applied");
    for (const [role, elem] of drawn) {
      const node = opened.engine.holder(elem.attrs.id!)!;
      expect(node.details?.role).toBe(role);
      expect(effectsRefusal(opened.engine.model!, node, estimate)).toBeNull();
    }
    const out = effectsOps(opened.engine.model!, units(opened, ...drawn.map(([, elem]) => elem.attrs.id!)), { kind: "add", effect: SHADOW }, estimate, ids(opened));
    if (typeof out === "string") throw new Error(out);
    applied(opened, out.ops);
    for (const [, elem] of drawn) {
      const state = stateOf(opened, elem.attrs.id!);
      expect(state.kind === "effects" && state.filter !== null).toBe(true);
    }
  });
});

describe("followEffects", () => {
  /// Un rettangolo con un'ombra, e il suo filtro.
  function shadowed(body = RECT): { opened: Opened; filter: string } {
    const opened = sheet(body);
    const out = effectsOps(opened.engine.model!, units(opened, "r"), { kind: "add", effect: SHADOW }, estimate, ids(opened));
    if (typeof out === "string") throw new Error(out);
    applied(opened, out.ops);
    const state = stateOf(opened, "r");
    if (state.kind !== "effects" || state.filter === null) throw new Error("niente filtro");
    return { opened, filter: state.filter };
  }

  const regionIn = (opened: Opened, filter: string): string => /<filter id="[^"]+" fub:role="private" (x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*")/.exec(elementOf(opened.engine.text, "filter"))?.[1] ?? `nessun ${filter}`;

  it("la regione segue la geometria nello stesso passo, e un annulla la riporta", () => {
    const { opened, filter } = shadowed();
    const before = regionIn(opened, filter);
    const after = applied(opened, { op: "set", id: "r", attrs: { width: "300" } });
    expect(regionIn(opened, filter)).not.toBe(before);
    expect(after).toContain('width="300"');
    // Il file è quello che si scrive aggiungendo l'ombra al rettangolo largo.
    const fresh = shadowed(RECT.replace('width="100"', 'width="300"'));
    expect(regionIn(fresh.opened, fresh.filter)).toBe(regionIn(opened, filter));
  });

  it("uno spostamento con la trasformazione non la cambia", () => {
    const { opened, filter } = shadowed();
    const before = opened.engine.text;
    const outcome = opened.engine.apply({ op: "set", id: "r", attrs: { transform: "matrix(1 0 0 1 40 40)" } });
    expect(outcome.outcome).toBe("applied");
    expect(regionIn(opened, filter)).toBe(/<filter[^>]*?(x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*")/.exec(before)![1]);
  });

  it("il contorno di un gruppo cambia la regione degli effetti dentro, e un figlio cambia quella del gruppo", () => {
    const opened = sheet(`<g id="g">${RECT}<rect id="s" x="200" y="0" width="10" height="10"/></g>`);
    const out = effectsOps(opened.engine.model!, units(opened, "g"), { kind: "add", effect: SHADOW }, estimate, ids(opened));
    if (typeof out === "string") throw new Error(out);
    applied(opened, out.ops);
    const group = stateOf(opened, "g");
    if (group.kind !== "effects") throw new Error("niente effetti");
    const before = regionIn(opened, group.filter!);
    applied(opened, { op: "set", id: "s", attrs: { x: "400" } });
    expect(regionIn(opened, group.filter!)).not.toBe(before);
    const grown = regionIn(opened, group.filter!);
    applied(opened, { op: "set", id: "g", attrs: { stroke: "#000000", "stroke-width": "20" } });
    expect(regionIn(opened, group.filter!)).not.toBe(grown);
  });

  it("non tocca niente quando nessuno ha effetti", () => {
    const opened = sheet(RECT);
    expect(followEffects(opened.engine.model!, new Set(["r"]), (id) => opened.engine.holder(id), estimate)).toBeNull();
  });
});

describe("con gli altri comandi", () => {
  const HIDDEN = 'fub:effect="shadow 0 4 8 #000000 0.25 hidden"';

  it("un gruppo con degli effetti, anche nascosti, non si separa", () => {
    const opened = sheet(`<g id="g" ${HIDDEN}>${RECT}</g><g id="h">${RECT.replace('"r"', '"s"')}</g>`);
    expect(ungroupOps(opened.engine.model!, units(opened, "g"), ids(opened)).ops).toEqual([]);
    expect(ungroupOps(opened.engine.model!, units(opened, "h"), ids(opened)).ops).not.toEqual([]);
  });

  it("la copia di un oggetto con degli effetti ha il suo filtro, e restano di FubDraw tutt'e due", () => {
    const opened = sheet(RECT);
    const out = effectsOps(opened.engine.model!, units(opened, "r"), { kind: "add", effect: SHADOW }, estimate, ids(opened));
    if (typeof out === "string") throw new Error(out);
    applied(opened, out.ops);
    const copy = duplicateOps(opened.engine.model!, units(opened, "r"), 20, 20, ids(opened));
    if (copy === null) throw new Error("niente copia");
    applied(opened, copy.ops);
    const [key] = copy.keys;
    const a = stateOf(opened, "r");
    const b = stateOf(opened, key!);
    expect(a.kind === "effects" && b.kind === "effects" && a.filter !== null && b.filter !== null && a.filter !== b.filter).toBe(true);
  });

  it("chi ha degli effetti, anche nascosti, tiene la sua trasformazione: sono nelle sue coordinate", () => {
    const scene = (effect: string): string => `<rect id="r" width="10" height="10" transform="matrix(0 1 -1 0 50 0)" ${effect}/><g id="g" transform="matrix(2 0 0 2 0 0)" ${effect}><rect id="s" width="10" height="10"/></g>`;
    const opened = sheet(scene(HIDDEN));
    const out = applyOps(opened.engine.model!, units(opened, "r", "g"), ids(opened));
    expect([out.changed, out.kept]).toEqual([0, 2]);
    const plain = sheet(scene(""));
    expect(applyOps(plain.engine.model!, units(plain, "r", "g"), ids(plain)).changed).toBe(2);
  });
});
