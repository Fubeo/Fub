// I motivi degli oggetti: le campiture che il pannello dà, cambia e toglie,
// quelle che distinguono le aree, e i motivi del documento. Le operazioni le
// accetta il motore così come sono, un annulla le disfa al byte, e una
// campitura resta di FubDraw dopo ogni cambio.

import { describe, expect, it } from "vitest";
import { FIDELITY } from "../../../../bench/fidelity-corpus";
import { doc } from "../scene/test-support";
import type { Op } from "../scene/ops";
import { NewIds } from "./edit";
import { hatchFallback, hatchOf, type Hatch } from "./hatches";
import type { Unit } from "./hit";
import { estimate } from "./measure";
import {
  contentColor,
  deleteMotifOps,
  distinguishOps,
  documentPatterns,
  filledParts,
  hatchOps,
  hatchView,
  motifOps,
  renameMotifOps,
  type HatchChange,
  type HatchChanged,
} from "./patterns";
import { resourcesOf } from "./resources";
import { documentColors, linkSwatchOps, newSwatchOps } from "./swatches";
import { LAYER, open, type Opened } from "./test-support";
import { applied } from "./tip-support";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

const RECT = (id: string, extra = ' fill="#0072b2"'): string => `<rect id="${id}" x="10" y="20" width="40" height="20"${extra}/>`;
const DEFS = (inner: string): string => `<defs id="fub-defs">${inner}</defs>`;

/// Una campitura scritta come la scrive FubDraw.
const HATCH = (id: string, role = "private", value = "lines -45 8 1.5 #000000 #0072b2"): string => {
  const [, , s, w, color, background] = value.split(" ");
  const middle = (Number(s) - Number(w)) / 2;
  const fond = background === undefined ? "" : `<rect width="${s}" height="${s}" fill="${background}"/>`;
  return `<pattern id="${id}" fub:role="${role}" fub:pattern="${value}" patternUnits="userSpaceOnUse" width="${s}" height="${s}" patternTransform="rotate(-45)">${fond}<rect y="${middle}" width="${s}" height="${w}" fill="${color}"/></pattern>`;
};

/// Le unità di `keys`, o tutte.
const unitsOf = (opened: Opened, keys: readonly string[] | null = null): Unit[] => opened.reindex().units.filter((unit) => keys === null || keys.includes(unit.key));

function changed(opened: Opened, change: HatchChange, keys: readonly string[] | null = null): HatchChanged {
  return hatchOps(opened.engine.model!, unitsOf(opened, keys), change, estimate, ids(opened));
}

/// La campitura che usa l'oggetto `id`, se è di FubDraw.
function hatchOn(opened: Opened, id: string): Hatch | null {
  const part = filledParts(opened.engine.model!, unitsOf(opened, [id]))[0]!;
  return part.filling.kind === "hatch" ? part.filling.hatch : null;
}

/// Le campiture di FubDraw che il disegno ha adesso.
const hatchesIn = (opened: Opened): string[] => [...resourcesOf(opened.engine.model!)].filter(([, node]) => hatchOf(node) !== null).map(([id]) => id);

const adds = (ops: readonly Op[]): Op[] => ops.filter((op) => op.op === "add");

describe("una campitura nasce", () => {
  it("dal colore dell'oggetto, che diventa il fondo, con le righe che vi si leggono meglio", () => {
    const opened = open(doc(`${LAYER}${RECT("oa")}</g>`));
    const change = changed(opened, { preset: "diagonal" });
    expect(change.reached).toBe(1);
    expect(change.preset).toBe("diagonal");
    const added = adds(change.ops);
    expect(added[0]).toEqual({ op: "add", parent: "#root", pos: { first: true }, elem: { tag: "defs", attrs: { id: "fub-defs" } } });
    const id = (added[1] as Extract<Op, { op: "add" }> & { elem: { attrs: Record<string, string> } }).elem.attrs.id!;
    const text = applied(opened, change.ops);
    expect(text).toContain(
      `  <defs id="fub-defs">
    <pattern id="${id}" fub:role="private" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)" fub:pattern="lines -45 8 1.5 #ffffff #0072b2">
      <rect width="8" height="8" fill="#0072b2"/>
      <rect y="3.25" width="8" height="1.5" fill="#ffffff"/>
    </pattern>
  </defs><g id="l1" fub:layer="Livello 1"><rect id="oa" x="10" y="20" width="40" height="20" fill="url(#${id}) #308cc0"/></g></svg>`,
    );
    expect(hatchOn(opened, "oa")).toEqual({ kind: "lines", angle: -45, spacing: 8, width: 1.5, color: "#ffffff", background: "#0072b2" });
    const view = hatchView(filledParts(opened.engine.model!, unitsOf(opened)));
    expect(view).toEqual({ count: 1, hatched: 1, choice: "diagonal", kind: "lines", angle: -45, spacing: 8, width: 1.5, color: "#ffffff", background: "#0072b2" });
  });

  it("senza colore, con righe nere su niente; da un campione, sul suo colore; da una sfumatura, sul suo colore medio", () => {
    const opened = open(
      doc(
        `${DEFS('<linearGradient id="rs" fub:role="swatch" fub:name="Giallo" gradientUnits="userSpaceOnUse"><stop stop-color="#f0e442"/></linearGradient><linearGradient id="rg" fub:role="private" gradientUnits="userSpaceOnUse" x1="10" y1="0" x2="50" y2="0"><stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="#ffffff"/></linearGradient>')}${LAYER}${RECT("oa", ' fill="none"')}${RECT("ob", ' fill="url(#rs) #f0e442"')}${RECT("oc", ' fill="url(#rg) #808080"')}</g>`,
      ),
    );
    applied(opened, changed(opened, { preset: "dots" }).ops);
    expect(hatchOn(opened, "oa")).toEqual({ kind: "dots", angle: 45, spacing: 8, width: 3, color: "#000000", background: null });
    expect(hatchOn(opened, "ob")).toMatchObject({ color: "#000000", background: "#f0e442" });
    expect(hatchOn(opened, "oc")).toMatchObject({ color: "#000000", background: "#808080" });
    // Il campione resta; la sfumatura, che nessuno usa più, se ne va.
    expect(opened.engine.holder("rs")).not.toBeNull();
    expect(opened.engine.holder("rg")).toBeNull();
  });

  it("in un testo, e nelle parti di un gruppo; una parte bloccata resta", () => {
    const opened = open(
      doc(
        `${LAYER}<g id="og" fill="#d55e00">${RECT("oa", "")}${RECT("ob", ' fill="#009e73" fub:locked="true"')}</g><text id="ot" x="0" y="80" font-size="20" fill="#cc79a7"><tspan x="0" dy="0">Ciao</tspan></text></g>`,
      ),
    );
    const change = changed(opened, { preset: "horizontal" });
    expect(change.reached).toBe(2);
    applied(opened, change.ops);
    expect(hatchOn(opened, "ot")).toMatchObject({ kind: "lines", angle: 0, background: "#cc79a7" });
    expect(opened.engine.text).toContain('<rect id="ob" x="10" y="20" width="40" height="20" fill="#009e73" fub:locked="true"/>');
    const inner = filledParts(opened.engine.model!, unitsOf(opened, ["og"]));
    expect(inner.map((part) => part.filling.kind)).toEqual(["hatch"]);
  });
});

describe("una campitura sua cambia sul posto", () => {
  const SOURCE = doc(`${DEFS(HATCH("rh"))}${LAYER}${RECT("oa", ' fill="url(#rh) #0d64a0"')}</g>`);

  it("si legge come sua", () => {
    const opened = open(SOURCE);
    const [part] = filledParts(opened.engine.model!, unitsOf(opened));
    expect(part!.filling).toEqual({ kind: "hatch", id: "rh", own: true, hatch: { kind: "lines", angle: -45, spacing: 8, width: 1.5, color: "#000000", background: "#0072b2" } });
  });

  it("il passo, lo spessore, l'angolo e i colori, con `set` e `part`", () => {
    const opened = open(SOURCE);
    const spaced = changed(opened, { spacing: 12 });
    expect(adds(spaced.ops)).toEqual([]);
    expect(spaced.ops).toContainEqual({ op: "set", id: "rh", attrs: { "fub:pattern": "lines -45 12 1.5 #000000 #0072b2", width: "12", height: "12" } });
    expect(spaced.ops).toContainEqual({ op: "set", id: "rh", part: [0], attrs: { width: "12", height: "12" } });
    expect(spaced.ops).toContainEqual({ op: "set", id: "rh", part: [1], attrs: { y: "5.25", width: "12" } });
    const text = applied(opened, spaced.ops);
    expect(text).toContain('fill="url(#rh) #00649c"');
    applied(opened, changed(opened, { angle: 0 }).ops);
    expect(opened.engine.text).not.toContain("patternTransform");
    applied(opened, changed(opened, { width: 30 }).ops);
    applied(opened, changed(opened, { color: "#ffffff" }).ops);
    applied(opened, changed(opened, { background: "#d55e00" }).ops);
    expect(hatchOn(opened, "oa")).toEqual({ kind: "lines", angle: 0, spacing: 12, width: 12, color: "#ffffff", background: "#d55e00" });
    expect(hatchesIn(opened)).toEqual(["rh"]);
  });

  it("niente, se è già così; un passo più stretto dello spessore lo stringe", () => {
    const opened = open(SOURCE);
    expect(changed(opened, { spacing: 8 }).reached).toBe(0);
    expect(changed(opened, { preset: "diagonal" }).ops.filter((op) => op.op !== "ident")).toEqual([]);
    applied(opened, changed(opened, { spacing: 1 }).ops);
    expect(hatchOn(opened, "oa")).toMatchObject({ spacing: 1, width: 1 });
  });

  it("un'altra forma fa una campitura nuova accanto alla vecchia, che se ne va", () => {
    const opened = open(SOURCE);
    for (const change of [{ background: null }, { preset: "dots" }, { preset: "cross" }] as const) {
      const before = hatchesIn(opened)[0]!;
      const made = changed(opened, change);
      expect(adds(made.ops)).toMatchObject([{ parent: "fub-defs", pos: { after: before } }]);
      applied(opened, made.ops);
      expect(hatchesIn(opened)).toHaveLength(1);
      expect(opened.engine.holder(before)).toBeNull();
    }
    expect(hatchOn(opened, "oa")).toEqual({ kind: "cross", angle: 45, spacing: 8, width: 1.5, color: "#000000", background: null });
  });

  it("nessuna: resta il fondo, o niente", () => {
    const opened = open(SOURCE);
    expect(applied(opened, changed(opened, { none: true }).ops)).toContain('fill="#0072b2"');
    expect(opened.engine.holder("rh")).toBeNull();
    const bare = open(doc(`${DEFS(HATCH("rh", "private", "lines -45 8 1.5 #000000"))}${LAYER}${RECT("oa", ' fill="url(#rh) #000000"')}</g>`));
    expect(applied(bare, changed(bare, { none: true }).ops)).toContain('fill="none"');
  });
});

describe("una campitura che non è soltanto sua", () => {
  it("condivisa, cambia in una copia per chi la cambia, e resta agli altri", () => {
    const opened = open(doc(`${DEFS(HATCH("rh", "shared"))}${LAYER}${RECT("oa", ' fill="url(#rh) #0d64a0"')}${RECT("ob", ' fill="url(#rh) #0d64a0"')}</g>`));
    expect(filledParts(opened.engine.model!, unitsOf(opened)).map((part) => part.filling.kind === "hatch" && part.filling.own)).toEqual([false, false]);
    const made = changed(opened, { spacing: 4 }, ["oa"]);
    expect(adds(made.ops)).toHaveLength(1);
    applied(opened, made.ops);
    expect(hatchOn(opened, "oa")).toMatchObject({ spacing: 4 });
    expect(hatchOn(opened, "ob")).toMatchObject({ spacing: 8 });
    expect(opened.engine.text).toContain('<rect id="ob" x="10" y="20" width="40" height="20" fill="url(#rh) #0d64a0"/>');
  });

  it("privata ma ereditata da un gruppo, o usata anche dal contorno, non cambia sul posto", () => {
    const inherited = open(doc(`${DEFS(HATCH("rh"))}${LAYER}<g id="og" fill="url(#rh) #0d64a0">${RECT("oa", "")}</g></g>`));
    const made = changed(inherited, { spacing: 4 }, ["og"]);
    expect(adds(made.ops)).toHaveLength(1);
    applied(inherited, made.ops);
    const stroked = open(doc(`${DEFS(HATCH("rh"))}${LAYER}${RECT("oa", ' fill="url(#rh) #0d64a0" stroke="url(#rh) #0d64a0"')}</g>`));
    expect(filledParts(stroked.engine.model!, unitsOf(stroked))[0]!.filling).toMatchObject({ kind: "hatch", own: false });
  });

  it("di un altro programma: si vede come altro motivo, e nessuna lascia il suo ripiego", () => {
    const opened = open(
      doc(`${DEFS('<pattern id="rp" fub:role="private" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="5" cy="5" r="2" fill="#d55e00"/></pattern>')}${LAYER}${RECT("oa", ' fill="url(#rp) #e6a37a"')}</g>`),
    );
    const parts = filledParts(opened.engine.model!, unitsOf(opened));
    expect(parts[0]!.filling).toEqual({ kind: "pattern", id: "rp", name: null, color: "#e6a37a" });
    expect(hatchView(parts)).toMatchObject({ choice: "other", hatched: 0, spacing: null });
    // Un campo non arriva a chi non ha una campitura di FubDraw.
    expect(changed(opened, { spacing: 4 }).reached).toBe(0);
    expect(applied(opened, changed(opened, { none: true }).ops)).toContain('fill="#e6a37a"');
  });
});

describe("la selezione", () => {
  it("dice la scelta comune, o misto, e i valori comuni delle campiture", () => {
    const opened = open(
      doc(
        `${DEFS(`${HATCH("ra")}${HATCH("rb", "private", "lines -45 8 1.5 #000000 #009e73")}`)}${LAYER}${RECT("oa", ' fill="url(#ra) #0d64a0"')}${RECT("ob", ' fill="url(#rb) #008a65"')}${RECT("oc")}</g>`,
      ),
    );
    const model = opened.engine.model!;
    expect(hatchView(filledParts(model, unitsOf(opened, ["oa", "ob"])))).toEqual({
      count: 2,
      hatched: 2,
      choice: "diagonal",
      kind: "lines",
      angle: -45,
      spacing: 8,
      width: 1.5,
      color: "#000000",
      background: null,
    });
    expect(hatchView(filledParts(model, unitsOf(opened)))).toMatchObject({ count: 3, hatched: 2, choice: null, spacing: 8 });
    expect(hatchView(filledParts(model, unitsOf(opened, ["oc"])))).toMatchObject({ choice: "none", hatched: 0, kind: null });
  });

  it("un campo cambia tutte le campiture insieme, in un passo, e lascia gli altri", () => {
    const opened = open(doc(`${DEFS(`${HATCH("ra")}${HATCH("rb")}`)}${LAYER}${RECT("oa", ' fill="url(#ra) #0d64a0"')}${RECT("ob", ' fill="url(#rb) #0d64a0"')}${RECT("oc")}</g>`));
    const made = changed(opened, { angle: 30 });
    expect(made.reached).toBe(2);
    applied(opened, made.ops);
    expect([hatchOn(opened, "oa")?.angle, hatchOn(opened, "ob")?.angle, hatchOn(opened, "oc")]).toEqual([30, 30, null]);
    expect(hatchView(filledParts(opened.engine.model!, unitsOf(opened, ["oa"])))).toMatchObject({ choice: "custom" });
  });
});

describe("distinguere le aree", () => {
  it("dà la campitura che il disegno non usa ancora, sul colore di ciascuna, col passo misurato sulla scena", () => {
    const opened = open(
      doc(
        `${LAYER}<rect id="oa" x="0" y="0" width="60" height="9" fill="#a6cee3"/><rect id="ob" x="0" y="20" width="60" height="60" fill="#a6cee3" transform="scale(2)"/><rect id="oc" x="0" y="200" width="60" height="60" fill="#b2df8a"/><rect id="od" x="100" y="200" width="60" height="60" fill="#b2df8a"/></g>`,
      ),
    );
    const first = distinguishOps(opened.engine.model!, unitsOf(opened, ["oa", "ob"]), estimate, ids(opened));
    expect([first.reached, first.preset]).toEqual([2, "diagonal"]);
    applied(opened, first.ops);
    // Un terzo del lato più corto, fra 3 e 8 nella scena: 3 per 9; 8 per
    // 120, che nelle coordinate dell'oggetto scalato sono 4.
    expect(hatchOn(opened, "oa")).toEqual({ kind: "lines", angle: -45, spacing: 3, width: 0.56, color: "#000000", background: "#a6cee3" });
    expect(hatchOn(opened, "ob")).toMatchObject({ spacing: 4, width: 0.75 });
    const second = distinguishOps(opened.engine.model!, unitsOf(opened, ["oc", "od"]), estimate, ids(opened));
    expect(second.preset).toBe("dots");
    applied(opened, second.ops);
    expect(hatchOn(opened, "od")).toEqual({ kind: "dots", angle: 45, spacing: 8, width: 3, color: "#000000", background: "#b2df8a" });
  });

  it("lascia chi ha già una campitura, una sfumatura o niente", () => {
    const opened = open(doc(`${DEFS(HATCH("rh"))}${LAYER}${RECT("oa", ' fill="url(#rh) #0d64a0"')}${RECT("ob", ' fill="none"')}</g>`));
    const made = distinguishOps(opened.engine.model!, unitsOf(opened), estimate, ids(opened));
    expect([made.reached, made.preset, made.ops]).toEqual([0, null, []]);
  });
});

describe("i motivi del documento", () => {
  const SOURCE = doc(`${LAYER}<rect id="oa" x="10" y="20" width="10" height="10" fill="#d55e00"/><g id="og" opacity="0.5" fill="#0072b2"><circle id="ob" cx="40" cy="25" r="5" transform="translate(0 5)"/></g></g>`);

  it("«Motivo dalla selezione» copia gli oggetti dove sono, nel riquadro di ciò che disegnano; la selezione resta", () => {
    const opened = open(SOURCE);
    const units = unitsOf(opened, ["oa", "ob"]);
    expect(units).toHaveLength(1);
    const chosen = [...units, ...opened.reindex().units.filter((unit) => unit.key === "og")];
    const made = motifOps(opened.engine.model!, chosen, "Motivo", ids(opened));
    if (typeof made === "string") throw new Error(made);
    expect(made.name).toBe("Motivo");
    expect(made.keys).toEqual(["oa", "og"]);
    const text = applied(opened, made.ops);
    expect(text).toContain(
      `    <pattern id="${made.id}" fub:role="swatch" fub:name="Motivo" x="10" y="20" width="35" height="15" patternUnits="userSpaceOnUse">
      <rect x="10" y="20" width="10" height="10" fill="#d55e00" transform="matrix(1 0 0 1 -10 -20)"/>
      <g fill="#0072b2" opacity="0.5" transform="matrix(1 0 0 1 -10 -20)">
        <circle cx="40" cy="25" r="5" transform="translate(0 5)"/>
      </g>
    </pattern>`,
    );
    const [motif] = documentPatterns(opened.engine.model!);
    expect(motif).toEqual({ id: made.id, name: "Motivo", color: expect.stringMatching(/^#[0-9a-f]{6}$/) });
    // Un altro prende il primo nome libero.
    const again = motifOps(opened.engine.model!, unitsOf(opened, ["oa"]), "Motivo", ids(opened));
    expect(typeof again !== "string" && again.name).toBe("Motivo 2");
  });

  it("si applica col suo colore medio come ripiego, si rinomina e si elimina", () => {
    const opened = open(
      doc(
        `${DEFS('<pattern id="rm" fub:role="swatch" fub:name="Pois" patternUnits="userSpaceOnUse" width="10" height="10"><rect width="10" height="5" fill="#ff0000"/><rect y="5" width="10" height="5" fill="#0000ff"/></pattern>')}${LAYER}${RECT("oa")}${RECT("ob", ' fill="#d55e00" fub:locked="true"')}</g>`,
      ),
    );
    expect(documentPatterns(opened.engine.model!)).toEqual([{ id: "rm", name: "Pois", color: "#800080" }]);
    expect(applied(opened, changed(opened, { pattern: "rm" }).ops)).toContain('<rect id="oa" x="10" y="20" width="40" height="20" fill="url(#rm) #800080"/>');
    expect(hatchView(filledParts(opened.engine.model!, unitsOf(opened, ["oa"])))).toMatchObject({ choice: "pattern:rm" });
    applied(opened, renameMotifOps(opened.engine.model!, "rm", "Quadri", unitsOf(opened), ids(opened)).ops);
    expect(documentPatterns(opened.engine.model!)[0]!.name).toBe("Quadri");
    const removed = deleteMotifOps(opened.engine.model!, "rm", unitsOf(opened), ids(opened));
    expect(removed.kept).toBe(0);
    expect(applied(opened, removed.ops)).toContain('<rect id="oa" x="10" y="20" width="40" height="20" fill="#800080"/>');
    expect(opened.engine.holder("rm")).toBeNull();
  });

  it("chi lo usa e non si riscrive lo tiene: il motivo resta condiviso, senza nome", () => {
    const opened = open(
      doc(
        `${DEFS('<pattern id="rm" fub:role="swatch" fub:name="Pois" patternUnits="userSpaceOnUse" width="10" height="10"><rect width="10" height="10" fill="#ff0000"/></pattern>')}${LAYER}${RECT("oa", ' fill="url(#rm) #ff0000" fub:locked="true"')}</g>`,
      ),
    );
    const removed = deleteMotifOps(opened.engine.model!, "rm", [], ids(opened));
    expect(removed.kept).toBe(1);
    expect(applied(opened, removed.ops)).toContain('<pattern id="rm" fub:role="shared" width="10" height="10" patternUnits="userSpaceOnUse">');
    expect(documentPatterns(opened.engine.model!)).toEqual([]);
  });

  it("non si fa con ciò che un motivo non contiene", () => {
    const refusal = (body: string, keys: readonly string[], defs = ""): string | null => {
      const opened = open(doc(`${defs === "" ? "" : DEFS(defs)}${LAYER}${body}</g>`));
      const made = motifOps(opened.engine.model!, unitsOf(opened, keys), "Motivo", ids(opened));
      return typeof made === "string" ? made : null;
    };
    expect(refusal('<image id="oi" x="0" y="0" width="10" height="10" href="data:image/png;base64,AA=="/>', ["oi"])).toBe("kind");
    // Una campitura o un motivo, anche ereditati: il formato non lascia che
    // il contenuto di un motivo ne usi un altro.
    const MOTIF = '<pattern id="rm" fub:role="swatch" fub:name="Pois" patternUnits="userSpaceOnUse" width="10" height="10"><rect width="5" height="5" fill="#ff0000"/></pattern>';
    expect(refusal(RECT("oa", ' fill="url(#rh) #0d64a0"'), ["oa"], HATCH("rh"))).toBe("content");
    expect(refusal(`<g id="og" fill="url(#rh) #0d64a0">${RECT("oa", "")}</g>`, ["og"], HATCH("rh"))).toBe("content");
    expect(refusal(RECT("oa", ' fill="url(#rm) #ff0000"'), ["oa"], MOTIF)).toBe("content");
    expect(refusal(RECT("oa", ' clip-path="url(#rc)"'), ["oa"], '<clipPath id="rc" fub:role="private"><rect x="10" y="20" width="5" height="5"/></clipPath>')).toBe("content");
    expect(refusal(`<g id="og" filter="url(#rf)">${RECT("oa")}</g>`, ["og"], '<filter id="rf" fub:role="private"><feGaussianBlur stdDeviation="2"/></filter>')).toBe("content");
    expect(refusal("", [])).toBe("empty");
  });

  it("le sfumature private degli oggetti diventano copie del motivo", () => {
    const opened = open(
      doc(
        `${DEFS('<linearGradient id="rg" fub:role="private" gradientUnits="userSpaceOnUse" x1="10" y1="0" x2="50" y2="0"><stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="#ffffff"/></linearGradient>')}${LAYER}${RECT("oa", ' fill="url(#rg) #808080"')}</g>`,
      ),
    );
    const made = motifOps(opened.engine.model!, unitsOf(opened), "Motivo", ids(opened));
    if (typeof made === "string") throw new Error(made);
    const text = applied(opened, made.ops);
    const copies = [...text.matchAll(/<linearGradient id="([^"]+)"/g)].map((match) => match[1]);
    expect(copies).toHaveLength(2);
    expect(text).toContain(`<rect x="10" y="20" width="40" height="20" fill="url(#${copies[1]}) #808080" transform="matrix(1 0 0 1 -10 -20)"/>`);
  });

  it("il colore medio pesa le aree e l'opacità; senza riempimenti, i contorni; altrimenti il nero", () => {
    expect(contentColor([{ tag: "rect", attrs: { width: "30", height: "10", fill: "#ffffff" } }, { tag: "rect", attrs: { width: "10", height: "10", fill: "#000000" } }])).toBe("#bfbfbf");
    expect(contentColor([{ tag: "g", attrs: { opacity: "0.5", fill: "#ff0000" }, children: [{ tag: "rect", attrs: { width: "10", height: "10" } }] }, { tag: "rect", attrs: { width: "10", height: "5", fill: "#0000ff" } }])).toBe("#800080");
    expect(contentColor([{ tag: "path", attrs: { d: "M0 0 L10 10", fill: "none", stroke: "#009e73" } }])).toBe("#009e73");
    expect(contentColor([])).toBe("#000000");
  });
});

describe("i colori del documento e le campiture", () => {
  it("i colori di una campitura si contano, ma un campione nuovo non li riscrive", () => {
    const opened = open(doc(`${DEFS(HATCH("rh"))}${LAYER}${RECT("oa", ' fill="url(#rh) #0d64a0"')}${RECT("ob", ' fill="#0072b2"')}</g>`));
    expect(documentColors(opened.engine.model!).used.map((used) => used.color)).toEqual(["#0072b2", "#000000"]);
    const made = newSwatchOps(opened.engine.model!, "#0072b2", "Blu", true, [], ids(opened));
    expect(made.kept).toBe(1);
    applied(opened, made.ops);
    expect(hatchOn(opened, "oa")).toMatchObject({ background: "#0072b2" });
    expect(linkSwatchOps(opened.engine.model!, made.id, [], ids(opened)).ops).toEqual([]);
  });
});

describe("il banco di fedeltà", () => {
  it("scrive le campiture e il motivo come li scrive FubDraw, coi loro ripieghi", () => {
    const opened = open(FIDELITY.find((scene) => scene.id === "campiture")!.text);
    expect(opened.engine.scene().every((item) => item.kind !== "foreign")).toBe(true);
    const parts = filledParts(opened.engine.model!, unitsOf(opened));
    expect(parts.map((part) => (part.filling.kind === "plain" ? null : part.filling.id))).toEqual(["h1", null, "h2", "h3", "h4", "h5", "h6", "m1"]);
    for (const part of parts) {
      if (part.filling.kind === "hatch") expect(part.value).toBe(`url(#${part.filling.id}) ${hatchFallback(part.filling.hatch)}`);
    }
    expect(documentPatterns(opened.engine.model!)).toEqual([{ id: "m1", name: "Pois", color: "#5e79a8" }]);
    expect(parts[parts.length - 1].value).toBe("url(#m1) #5e79a8");
  });
});
