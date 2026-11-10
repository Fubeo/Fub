// Le punte delle linee che seguono la linea: tenute del colore della linea
// dentro lo stesso passo, il seguito che non sbaglia, a caso, e il tempo di
// mille linee.

import { describe, expect, it } from "vitest";
import type { Op } from "../scene/ops";
import { doc, Mulberry32 } from "../scene/test-support";
import { plainAttributes } from "./arrange";
import { gesture, NewIds } from "./edit";
import { LAYER, open, type Opened } from "./test-support";
import { BLUE, CUSTOM, DEFS, ENDS, ids, MARKER, markersIn, RED } from "./tip-support";
import { TIP_ENDS, TIP_SHAPES, TIP_SIZES, followTips, tipOps, tipsLookOf, type TipChange } from "./tips";
import { adds, applied, everyId, flat, followed, given, LINE, looks, PINK, RAMP, sets, settled, shown, step, SWATCH, tip, tipped, usedBy } from "./tips/test-support";

// ---------------------------------------------------------------------------
// Seguire la linea.
// ---------------------------------------------------------------------------

describe.each([
  ["trovando gli elementi da sola", false],
  ["con l'indice del motore", true],
])("le punte seguono la linea, %s", (_, index) => {
  const marked = (extra = "", markers = MARKER("mr", "triangle", "medium", "end")): string =>
    doc(DEFS(markers) + LAYER + LINE("oa", ` stroke="${RED}" stroke-width="2"${ENDS(null, "mr")}${extra}`) + "</g>");

  it("cambiato il colore del contorno, la punta cambia nello stesso passo e nello stesso annulla", () => {
    const opened = followed(marked(), index);
    const forward = step(opened, { op: "set", id: "oa", attrs: { stroke: BLUE } });
    expect(shown(opened, "oa", "end")).toMatchObject({ tip: tip("triangle"), paint: BLUE, opacity: 1 });
    // La punta di prima non la usa più nessuno: se n'è andata.
    expect(markersIn(opened)).toHaveLength(1);
    expect(markersIn(opened)).not.toContain("mr");
    expect(adds(forward)).toHaveLength(1);
    expect(flat(forward).filter((op) => op.op === "remove")).toEqual([{ op: "remove", target: "mr" }]);
    settled(opened);
  });

  it("l'opacità del contorno cambia l'opacità della punta, e una linea invisibile la lascia", () => {
    const opened = followed(marked(), index);
    step(opened, { op: "set", id: "oa", attrs: { "stroke-opacity": "0.5" } });
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: RED, opacity: 0.5 });
    step(opened, { op: "set", id: "oa", attrs: { stroke: "none" } });
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: "none", opacity: 1 });
    step(opened, { op: "set", id: "oa", attrs: { stroke: PINK, "stroke-opacity": null } });
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: PINK, opacity: 1 });
    settled(opened);
  });

  it("il contorno che torna com'era riusa il marcatore di prima, se esiste ancora", () => {
    const opened = followed(marked(), index);
    const other = doc(DEFS(MARKER("mr", "triangle", "medium", "end"), MARKER("mb", "triangle", "medium", "end", BLUE)) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "mr")}`) + "</g>");
    const reuse = followed(other, index);
    const forward = step(reuse, { op: "set", id: "oa", attrs: { stroke: BLUE } });
    expect(adds(forward)).toHaveLength(0);
    expect(usedBy(reuse, "oa", "end")).toBe("mb");
    expect(markersIn(reuse)).toEqual(["mb"]);
    settled(opened);
    settled(reuse);
  });

  it("il colore passato da un gruppo cambia le punte di chi lo eredita, con un marcatore solo", () => {
    const source = doc(
      DEFS(MARKER("mr", "vee", "large", "end"), MARKER("ms", "vee", "large", "start")) +
        LAYER +
        `<g id="og" stroke="${RED}">${LINE("oa", ` stroke-width="2"${ENDS("ms", "mr")}`)}${LINE("ob", ` stroke-width="2"${ENDS("ms", "mr")}`, 20)}${LINE("oc", ` stroke="${BLUE}"`, 30)}</g>` +
        "</g>",
    );
    const opened = followed(source, index);
    const forward = step(opened, { op: "set", id: "og", attrs: { stroke: PINK } });
    expect(adds(forward)).toHaveLength(2);
    expect(shown(opened, "oa", "end")).toMatchObject({ tip: tip("vee", "large"), end: "end", paint: PINK });
    expect(shown(opened, "oa", "start")).toMatchObject({ tip: tip("vee", "large"), end: "start", paint: PINK });
    expect(usedBy(opened, "oa", "end")).toBe(usedBy(opened, "ob", "end"));
    expect(usedBy(opened, "oa", "start")).toBe(usedBy(opened, "ob", "start"));
    expect(sets(forward).map((op) => op.id).sort()).toEqual(["oa", "ob", "og"]);
    settled(opened);
  });

  it("una linea senza id, in un gruppo che cambia colore, riceve un id e la sua punta lo segue nello stesso passo", () => {
    const source = doc(
      DEFS(MARKER("mr", "triangle", "medium", "end")) +
        LAYER +
        `<g id="og" stroke="${RED}"><line x1="0" y1="10" x2="50" y2="10" stroke-width="2"${ENDS(null, "mr")}/></g>` +
        "</g>",
    );
    const opened = followed(source, index);
    const forward = step(opened, { op: "set", id: "og", attrs: { stroke: BLUE } });
    // L'id è dato prima di tutto, perché `set` indirizza per id.
    expect(flat(forward).map((op) => op.op).slice(0, 3)).toEqual(["set", "ident", "add"]);
    const id = /<line id="(o[0-9a-z]{8})"/.exec(opened.engine.text)?.[1];
    expect(id).toBeDefined();
    expect(shown(opened, id!, "end")).toMatchObject({ tip: tip("triangle"), paint: BLUE, opacity: 1 });
    expect(markersIn(opened)).toHaveLength(1);
    expect(markersIn(opened)).not.toContain("mr");
    settled(opened);
  });

  it("cambiato il contorno di un gruppo che passa lo stesso colore a una linea con il suo, questa resta com'è", () => {
    const source = doc(DEFS(MARKER("mb", "triangle", "medium", "end", BLUE)) + LAYER + `<g id="og" stroke="${RED}">${LINE("oa", ` stroke="${BLUE}"${ENDS(null, "mb")}`)}</g>` + "</g>");
    const opened = followed(source, index);
    const forward = step(opened, { op: "set", id: "og", attrs: { stroke: PINK } });
    expect(sets(forward).map((op) => op.id)).toEqual(["og"]);
    expect(usedBy(opened, "oa", "end")).toBe("mb");
  });



  it("una linea che passa a una sfumatura prende il colore del vertice, e lo cambia con lui", () => {
    const source = doc(DEFS(RAMP("rg"), MARKER("mr", "triangle", "medium", "end")) + LAYER + LINE("oa", ` stroke="${RED}" stroke-width="2"${ENDS(null, "mr")}`) + "</g>");
    const opened = followed(source, index);
    step(opened, { op: "set", id: "oa", attrs: { stroke: "url(#rg)", x2: "100" } });
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: BLUE });
    const back = shown(opened, "oa", "end")!.id;
    // Spostato l'estremo a metà della sfumatura, il colore è quello di metà.
    step(opened, { op: "set", id: "oa", attrs: { x2: "50" } });
    const middle = shown(opened, "oa", "end")!;
    expect(middle.id).not.toBe(back);
    expect(middle.paint).toMatch(/^#[0-9a-f]{6}$/);
    expect(middle.paint).not.toBe(BLUE);
    expect(middle.paint).not.toBe(RED);
    // A metà fra #d55e00 e #0072b2: 106,5 / 104 / 89.
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(middle.paint.slice(at, at + 2), 16));
    expect(Math.abs(r! - 106.5)).toBeLessThanOrEqual(1);
    expect(Math.abs(g! - 104)).toBeLessThanOrEqual(1);
    expect(Math.abs(b! - 89)).toBeLessThanOrEqual(1);
    settled(opened);
  });

  it("una sfumatura cambiata porta con sé le punte di chi la usa, anche in un gruppo e a ogni profondità", () => {
    const source = doc(
      DEFS(RAMP("rg")) +
        LAYER +
        `<line id="oa" x1="0" y1="10" x2="50" y2="10" stroke="url(#rg)" stroke-width="2"/>` +
        `<g id="og"><g id="oi"><line id="ob" x1="0" y1="20" x2="50" y2="20" stroke="url(#rg)" stroke-width="2"/></g></g>` +
        `<line id="oc" x1="0" y1="30" x2="50" y2="30" stroke="${RED}" stroke-width="2"/>` +
        "</g>",
    );
    const opened = followed(source, index);
    given(opened, { end: "end", shape: "triangle" });
    const before = shown(opened, "oa", "end")!;
    expect(before.paint).not.toBe(BLUE);
    // Il vertice di fine sta a metà della sfumatura: spostata la fine della sfumatura a 50, ne è il capo.
    step(opened, { op: "set", id: "rg", attrs: { x2: "50" } });
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: BLUE });
    expect(shown(opened, "ob", "end")).toMatchObject({ paint: BLUE });
    expect(shown(opened, "oc", "end")).toMatchObject({ paint: RED });
    settled(opened);
  });

  it("una punta tolta non torna: con il riferimento il marcatore se ne va", () => {
    const opened = followed(marked(), index);
    const forward = step(opened, { op: "set", id: "oa", attrs: { "marker-end": null } });
    expect(markersIn(opened)).toEqual([]);
    expect(adds(forward)).toHaveLength(0);
    expect(opened.engine.text).not.toContain("marker-end");
    settled(opened);
  });

  it("cambiare altro in una linea non fa niente alle punte", () => {
    const opened = followed(marked(), index);
    const forward = step(opened, { op: "set", id: "oa", attrs: { "stroke-width": "6", x2: "70" } });
    expect(forward).toEqual({ op: "set", id: "oa", attrs: { "stroke-width": "6", x2: "70" } });
    expect(markersIn(opened)).toEqual(["mr"]);
  });

  it("aggiungere una linea, o muoverla, non cambia punte che hanno già il colore giusto", () => {
    const opened = followed(marked(), index);
    const forward = step(opened, { op: "add", parent: "l1", pos: { last: true }, elem: { tag: "line", attrs: { id: "obbbbbbbb", x1: "0", y1: "0", x2: "5", y2: "5", stroke: RED, "marker-end": "url(#mr)" } } });
    expect(adds(forward)).toHaveLength(1);
    expect(usedBy(opened, "obbbbbbbb", "end")).toBe("mr");
    step(opened, { op: "set", id: "obbbbbbbb", attrs: { transform: "translate(5 5)" } });
    expect(markersIn(opened)).toEqual(["mr"]);
  });

  it("una linea incollata con una punta di un altro colore la prende del suo", () => {
    const opened = followed(marked(), index);
    step(opened, { op: "add", parent: "l1", pos: { last: true }, elem: { tag: "line", attrs: { id: "obbbbbbbb", x1: "0", y1: "0", x2: "5", y2: "5", stroke: BLUE, "marker-end": "url(#mr)" } } });
    expect(shown(opened, "obbbbbbbb", "end")).toMatchObject({ paint: BLUE });
    expect(usedBy(opened, "oa", "end")).toBe("mr");
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: RED });
    settled(opened);
  });

  it("una punta nominata dal capo sbagliato passa al marcatore del suo capo", () => {
    const opened = followed(marked(), index);
    step(opened, { op: "set", id: "oa", attrs: { "marker-start": "url(#mr)", "marker-end": null } });
    expect(shown(opened, "oa", "start")).toMatchObject({ tip: tip("triangle"), end: "start", paint: RED });
    expect(usedBy(opened, "oa", "start")).not.toBe("mr");
    settled(opened);
  });

  it("un marcatore custom e il marcatore di mezzo non si toccano, né le linee che non possono avere punte", () => {
    const source = doc(
      DEFS(MARKER("mr", "triangle", "medium", "end"), CUSTOM("cm")) +
        LAYER +
        LINE("oa", ` stroke="${RED}" marker-mid="url(#mr)"${ENDS("cm", null)}`) +
        `<path id="oc" d="M0 0 L10 0 L10 10 Z" fill="none" stroke="${RED}"/>` +
        "</g>",
    );
    const opened = followed(source, index);
    const forward = step(opened, { op: "set", id: "oa", attrs: { stroke: BLUE } });
    expect(forward).toEqual({ op: "set", id: "oa", attrs: { stroke: BLUE } });
    expect(opened.engine.text).toContain('marker-mid="url(#mr)"');
    expect(usedBy(opened, "oa", "start")).toBe("cm");
  });

  it("una parte sotto un livello bloccato non ferma le altre quando la sfumatura cambia", () => {
    const line = (id: string, y: number): string => `<line id="${id}" x1="0" y1="${y}" x2="50" y2="${y}" stroke="url(#rg)" stroke-width="2"/>`;
    const opened = followed(doc(DEFS(RAMP("rg")) + LAYER + line("oa", 10) + "</g>" + '<g id="l2" fub:layer="Secondo">' + line("ob", 20) + "</g>"), index);
    given(opened, { end: "end", shape: "triangle" });
    const second = shown(opened, "ob", "end")!;
    step(opened, { op: "set", id: "l2", attrs: { "fub:locked": "true" } });
    // Se il seguito scrivesse anche sotto il livello bloccato, il motore lo rifiuterebbe intero, e `oa` non cambierebbe.
    const forward = step(opened, { op: "set", id: "rg", attrs: { x2: "50" } });
    expect(adds(forward)).toHaveLength(1);
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: BLUE });
    // La linea bloccata resta com'era, con la sua punta.
    expect(usedBy(opened, "ob", "end")).toBe(second.id);
    expect(markersIn(opened)).toContain(second.id);
    settled(opened);
  });

  it("una linea bloccata di per sé, in un livello libero, segue: il motore la lascia scrivere", () => {
    const opened = followed(marked(` fub:locked="true"`), index);
    const forward = step(opened, { op: "set", id: "oa", attrs: { stroke: BLUE } });
    expect(adds(forward)).toHaveLength(1);
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: BLUE });
  });
});

describe("il seguito non sbaglia", () => {
  it("non fa niente senza punte della raccolta, senza ciò che è cambiato, o con ciò che non esiste", () => {
    const none = open(doc(DEFS() + LAYER + LINE("oa") + "</g>"));
    expect(followTips(none.engine.model!, new Set(["oa"]), ids(none))).toBeNull();
    const custom = open(doc(DEFS(CUSTOM("cm")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "cm")}`) + "</g>"));
    expect(followTips(custom.engine.model!, new Set(["oa", "cm"]), ids(custom))).toBeNull();
    const some = open(doc(DEFS(MARKER("mr", "triangle", "medium", "end", BLUE)) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "mr")}`) + "</g>"));
    expect(followTips(some.engine.model!, new Set(), ids(some))).toBeNull();
    expect(followTips(some.engine.model!, new Set(["nessuno", "mr"]), ids(some))).toBeNull();
    expect(followTips(some.engine.model!, new Set(["oa"]), ids(some))).not.toBeNull();
    // Un livello toccato porta con sé le sue linee.
    expect(followTips(some.engine.model!, new Set(["l1"]), ids(some))).not.toBeNull();
  });

  it("un seguito ha prima i marcatori e poi i set, e il motore lo accetta", () => {
    const opened = open(doc(DEFS(MARKER("mr", "triangle", "medium", "end", BLUE)) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "mr")}`) + LINE("ob", ` stroke="${RED}"${ENDS(null, "mr")}`, 20) + "</g>"));
    const op = followTips(opened.engine.model!, new Set(["oa", "ob"]), ids(opened), (id) => opened.engine.holder(id))!;
    expect(flat(op).map((each) => each.op)).toEqual(["add", "set", "set"]);
    expect(sets(op).map((each) => each.id)).toEqual(["oa", "ob"]);
    const before = opened.engine.text;
    const outcome = opened.engine.apply(op);
    expect(outcome.outcome).toBe("applied");
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: RED });
    expect(usedBy(opened, "oa", "end")).toBe(usedBy(opened, "ob", "end"));
    expect(markersIn(opened)).toHaveLength(1);
    if (outcome.outcome === "applied") expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
    expect(opened.engine.text).toBe(before);
  });

  it("dà lo stesso risultato con l'indice del motore e senza", () => {
    const opened = open(
      doc(
        DEFS(MARKER("mr", "triangle", "medium", "end", BLUE), MARKER("ms", "bar", "small", "start", BLUE)) +
          LAYER +
          `<g id="og" stroke="${RED}">${LINE("oa", ` stroke-width="2"${ENDS("ms", "mr")}`)}${LINE("ob", ` stroke-width="2"${ENDS(null, "mr")}`, 20)}</g>` +
          "</g>",
      ),
    );
    const touched = new Set(["og", "oa", "ob"]);
    const withIndex = followTips(opened.engine.model!, touched, new NewIds(() => false), (id) => opened.engine.holder(id));
    const without = followTips(opened.engine.model!, touched, new NewIds(() => false));
    // Gli id dei marcatori nuovi sono a caso: il resto è lo stesso.
    const plain = (op: Op | null): string => JSON.stringify(op).replace(/r[0-9a-z]{8}/g, "R");
    expect(plain(without)).toBe(plain(withIndex));
    expect(sets(withIndex!).map((op) => op.id)).toEqual(["oa", "ob"]);
  });

  it("un id che non c'è, o che è di un nodo tolto, si salta", () => {
    const opened = followed(doc(DEFS(MARKER("mr", "triangle", "medium", "end")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "mr")}`) + LINE("ob", ` stroke="${RED}"`, 20) + "</g>"));
    step(opened, { op: "remove", target: "ob" });
    expect(usedBy(opened, "oa", "end")).toBe("mr");
  });

  it("dati strani non lo fanno lanciare: percorsi, punti, coordinate e colori che non si leggono", () => {
    const odd = doc(
      DEFS(RAMP("rg"), MARKER("mr", "triangle", "medium", "end", BLUE), MARKER("ms", "vee", "small", "start", "none"), MARKER("mt", "circle", "large", "end", "url(#rg) #123456")) +
        LAYER +
        `<path id="o1" d="M" stroke="url(#rg)"${ENDS("ms", "mr")}/>` +
        `<path id="o2" d="M 1 2 L foo" stroke="url(#rg)"${ENDS("ms", "mr")}/>` +
        `<path id="o3" d="" stroke="url(#rg)"${ENDS("ms", "mr")}/>` +
        `<polyline id="o4" points="a b c" stroke="url(#rg)"${ENDS("ms", "mr")}/>` +
        `<polyline id="o5" points="" stroke="url(#rg)"${ENDS("ms", "mr")}/>` +
        `<polyline id="o6" points="1,2,3" stroke="url(#rg)"${ENDS("ms", "mr")}/>` +
        `<line id="o7" x1="foo" y1="bar" x2="" y2="1e999" stroke="url(#rg)"${ENDS("ms", "mr")}/>` +
        `<line id="o8" stroke="url(#)"${ENDS("ms", "mr")}/>` +
        `<line id="o9" x2="9" stroke="url(#nessuno) #zzz"${ENDS("ms", "mr")}/>` +
        `<line id="oa" x2="9" stroke="rgb(1,2)" stroke-opacity="x"${ENDS("ms", "mr")}/>` +
        `<line id="ob" x2="9" stroke="inherit"${ENDS("ms", "mr")}/>` +
        `<line id="oc" x2="9" stroke="currentColor"${ENDS("ms", "mt")}/>` +
        `<line id="od" x2="9" stroke=" url( #rg ) "${ENDS("ms", "mr")}/>` +
        `<line id="oe" x2="9" stroke="url(#rg)" marker-end="url(#mr)" marker-start="url(#mr)" marker-mid="url(#mr)" fub:locked="true"/>` +
        `<g id="og" stroke="${RED}"><g id="oh" stroke="bogus"><line id="oi" x2="9"${ENDS("ms", "mr")}/></g></g>` +
        "</g>",
    );
    const opened = followed(odd);
    const touched = everyId(opened);
    expect(() => followTips(opened.engine.model!, touched, ids(opened), (id) => opened.engine.holder(id))).not.toThrow();
    expect(() => followTips(opened.engine.model!, touched, ids(opened))).not.toThrow();
    expect(() => tipsLookOf(opened.engine.model!, opened.index.units)).not.toThrow();
    for (const change of [{ end: "end", shape: "triangle" }, { end: "start", size: "large" }, { swap: true }, { end: "end", shape: "none" }] as const) {
      expect(() => tipped(opened, change)).not.toThrow();
    }
    // Il motore applica anche un passo che le fa lavorare.
    expect(opened.engine.apply({ op: "set", id: "rg", attrs: { x2: "20" } }).outcome).toBe("applied");
    expect(opened.engine.apply({ op: "set", id: "og", attrs: { stroke: PINK } }).outcome).toBe("applied");
  });

  it("anche in un documento con marcatori estranei, custom o fuori dalle risorse", () => {
    const source = doc(
      `<marker id="mx" markerWidth="2" markerHeight="2"><circle cx="1" cy="1" r="1"/></marker>` +
        DEFS(MARKER("mr", "triangle", "medium", "end", BLUE), `<marker id="mx2"><foo/></marker>`) +
        LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "mr")}`) + "</g>",
    );
    const opened = followed(source);
    expect(opened.engine.apply({ op: "set", id: "oa", attrs: { stroke: PINK } }).outcome).toBe("applied");
    expect(shown(opened, "oa", "end")).toMatchObject({ paint: PINK });
  });
});

// ---------------------------------------------------------------------------
// A caso.
// ---------------------------------------------------------------------------

describe("a caso", () => {
  const COLORS = [RED, BLUE, PINK, "#000000", "#009e73"];
  /// I contorni: colori, nessuno, una sfumatura e due campioni.
  const STROKES = [...COLORS, "none", "red", "#abc", "url(#rg)", "url(#rs)", "url(#rs) #0072b2", "url(#rt) #123456"];
  /// Contorni che il disegno non accetta: il motore li rifiuta interi.
  const WRONG = ["currentColor", "url(#manca)"];
  const MARKERS = ["m0", "m1", "m2", "m3", "m4", "m5", "cm"];

  /// Un disegno a caso: sei marcatori della raccolta e uno no; linee,
  /// spezzate e tracciati aperti e chiusi, nel livello, in due gruppi
  /// annidati, in un terzo e in un livello bloccato, con contorni, opacità e
  /// marcatori qualunque. Per ogni linea, i contenitori sopra di lei.
  function drawing(rng: Mulberry32): { source: string; lines: string[]; above: Map<string, string[]> } {
    const pick = <T,>(list: readonly T[]): T => list[rng.below(list.length)]!;
    const chance = (p: number): boolean => rng.below(1000) < p * 1000;
    const lines: string[] = [];
    const above = new Map<string, string[]>();
    const defs = [RAMP("rg"), SWATCH("rs", BLUE), SWATCH("rt", "#123456"), CUSTOM("cm")];
    for (let at = 0; at < 6; at++) {
      const paint = chance(0.2) ? "url(#rs) #0072b2" : pick(COLORS);
      defs.push(MARKER(`m${at}`, pick(TIP_SHAPES), pick(TIP_SIZES), pick(TIP_ENDS), paint, chance(0.3) ? 0.5 : 1));
    }
    const line = (chain: string[]): string => {
      const id = `o${String(lines.length + 1).padStart(2, "0")}`;
      lines.push(id);
      above.set(id, chain);
      const y = 10 * lines.length;
      let attrs = "";
      if (chance(0.6)) attrs += ` stroke="${pick(STROKES)}"`;
      if (chance(0.25)) attrs += ` stroke-opacity="${pick(["0.5", "0.25", "1", "0.3333"])}"`;
      if (chance(0.5)) attrs += ` marker-end="url(#${pick(MARKERS)})"`;
      if (chance(0.4)) attrs += ` marker-start="url(#${pick(MARKERS)})"`;
      switch (rng.below(5)) {
        case 0:
        case 1:
          return `<line id="${id}" x1="0" y1="${y}" x2="${30 + 10 * (lines.length % 7)}" y2="${y}" stroke-width="2"${attrs}/>`;
        case 2:
          return `<polyline id="${id}" points="0,${y} 20,${y + 5} 40,${y}" fill="none" stroke-width="2"${attrs}/>`;
        case 3:
          return `<path id="${id}" d="M0 ${y} L30 ${y + 4} L60 ${y}${chance(0.3) ? " Z" : ""}" fill="none" stroke-width="2"${attrs}/>`;
        default:
          return `<polygon id="${id}" points="0,${y} 20,${y + 5} 40,${y}" fill="none" stroke-width="2"${attrs}/>`;
      }
    };
    const group = (id: string, inner: () => string): string => {
      const stroke = chance(0.7) ? ` stroke="${pick(STROKES)}"` : "";
      const opacity = chance(0.25) ? ` stroke-opacity="${pick(["0.5", "1"])}"` : "";
      return `<g id="${id}"${stroke}${opacity}>${inner()}</g>`;
    };
    let body = line(["l1"]) + line(["l1"]) + line(["l1"]);
    body += group("g1", () => line(["g1", "l1"]) + line(["g1", "l1"]) + group("g2", () => line(["g2", "g1", "l1"]) + line(["g2", "g1", "l1"])));
    body += group("g3", () => line(["g3", "l1"]));
    const locked = `<g id="l2" fub:layer="Bloccato" fub:locked="true">${line(["l2"])}${line(["l2"])}</g>`;
    return { source: doc(DEFS(...defs) + LAYER + body + "</g>" + locked), lines, above };
  }

  /// Il colore che deve avere la punta di una linea col contorno `stroke`,
  /// dove si dice senza leggere la sfumatura: `null` se non si dice.
  function expected(opened: Opened, stroke: string): string | null {
    if (stroke === "none" || /^#[0-9a-f]{6}$/.test(stroke)) return stroke;
    if (stroke === "red") return "#ff0000";
    if (stroke === "#abc") return "#aabbcc";
    const swatch = /^url\(#(rs|rt)\)/.exec(stroke)?.[1];
    if (swatch === undefined) return null;
    const color = new RegExp(`<linearGradient id="${swatch}"[^>]*>\\s*<stop[^>]*stop-color="(#[0-9a-f]{6})"`).exec(opened.engine.text)?.[1];
    return color === undefined ? null : `url(#${swatch}) ${color}`;
  }

  /// Ogni riferimento a un marcatore c'è, il seguito non ha niente da fare, e
  /// ogni punta della raccolta fuori dal livello bloccato ha il colore e
  /// l'opacità del contorno della sua linea.
  function check(opened: Opened, lines: readonly string[], above: ReadonlyMap<string, string[]>): void {
    const present = everyId(opened);
    for (const match of opened.engine.text.matchAll(/marker-(?:start|mid|end)="url\(#([^)]+)\)"/g)) expect(present.has(match[1]!), match[1]).toBe(true);
    settled(opened);
    const seen = (line: string, name: string): string | undefined => {
      for (const id of [line, ...above.get(line)!]) {
        const node = opened.engine.holder(id);
        const value = node === null ? undefined : plainAttributes(node).get(name);
        if (value !== undefined) return value;
      }
      return undefined;
    };
    for (const line of lines) {
      const node = opened.engine.holder(line);
      if (node === null || above.get(line)!.includes("l2") || !["line", "polyline", "path"].includes(node.details?.role ?? "")) continue;
      for (const end of TIP_ENDS) {
        const tip = shown(opened, line, end);
        if (tip === null) continue;
        const stroke = (seen(line, "stroke") ?? "none").trim();
        const paint = expected(opened, stroke);
        if (paint === null) continue;
        expect([line, end, tip.end, tip.paint, tip.opacity]).toEqual([line, end, end, paint, stroke === "none" ? 1 : Number(Number(seen(line, "stroke-opacity") ?? "1").toFixed(4))]);
      }
    }
  }


  // Sessanta semi in sei prove da dieci: lo stesso caso, ma nessuna prova
  // da sola porta tutto il lavoro (1500 operazioni, ognuna fatta, annullata e
  // rifatta), che nella corsa intera con molti worker passava i 5 s (#286).
  it.each([1, 11, 21, 31, 41, 51])("le punte restano del colore della linea, il motore non rifiuta il seguito, e un annulla torna al byte (semi da %i)", (first) => {
    let applied = 0;
    for (let seed = first; seed < first + 10; seed++) {
      const rng = new Mulberry32(seed);
      const pick = <T,>(list: readonly T[]): T => list[rng.below(list.length)]!;
      const { source, lines, above } = drawing(rng);
      const opened = followed(source, seed % 2 === 0);
      // Un primo passo tocca tutte le linee libere, e il seguito le mette a posto.
      const settle = lines.filter((line) => !above.get(line)!.includes("l2")).map((id): Op => ({ op: "set", id, attrs: { "stroke-linecap": "butt" } }));
      expect(opened.engine.apply({ op: "batch", ops: settle }).outcome).toBe("applied");
      check(opened, lines, above);
      for (let at = 0; at < 25; at++) {
        const line = pick(lines);
        const target = pick([line, line, line, "g1", "g2", "g3"]);
        let op: Op | null;
        switch (rng.below(10)) {
          case 0:
          case 1:
          case 6:
            op = { op: "set", id: target, attrs: { stroke: rng.below(10) === 0 ? null : rng.below(10) === 0 ? pick(WRONG) : pick(STROKES) } };
            break;
          case 2:
            op = { op: "set", id: target, attrs: { "stroke-opacity": rng.below(3) === 0 ? null : pick(["0.5", "0.25", "1", "0.6667"]) } };
            break;
          case 3:
            op = { op: "set", id: line, attrs: { [`marker-${pick(TIP_ENDS)}`]: rng.below(3) === 0 ? null : `url(#${pick(MARKERS)})` } };
            break;
          case 4:
          case 5: {
            const units = opened.reindex().units.filter(() => rng.below(2) === 0);
            const change = pick<TipChange>([
              { end: pick(TIP_ENDS), shape: pick(TIP_SHAPES) },
              { end: pick(TIP_ENDS), shape: "none" },
              { end: pick(TIP_ENDS), size: pick(TIP_SIZES) },
              { swap: true },
            ]);
            op = gesture(tipped(opened, change, units).ops);
            break;
          }
          case 7:
            op = { op: "set", id: "rg", attrs: { x2: pick(["20", "50", "100", "200"]) } };
            break;
          case 8:
            op = { op: "set", id: target, attrs: { transform: pick(["translate(5 5)", "rotate(30)", null]) } };
            break;
          default:
            op = { op: "set", id: pick(["l1", "l2"]), attrs: { "fub:locked": rng.below(2) === 0 ? "true" : null } };
        }
        if (op === null) continue;
        const before = opened.engine.text;
        const outcome = opened.engine.apply(op);
        if (outcome.outcome !== "applied") {
          expect(opened.engine.text).toBe(before);
          continue;
        }
        applied++;
        const after = opened.engine.text;
        const back = opened.engine.undo(outcome.undo);
        expect([back.outcome, opened.engine.text === before]).toEqual(["applied", true]);
        const again = opened.engine.undo(back.outcome === "applied" ? back.undo : outcome.undo);
        expect([again.outcome, opened.engine.text === after]).toEqual(["applied", true]);
        expect(opened.engine.scene().every((item) => item.kind !== "foreign")).toBe(true);
        check(opened, lines, above);
      }
    }
    // Il caso deve arrivare a operazioni vere, non soltanto rifiutate.
    expect(applied, `applicate ${applied}`).toBeGreaterThan(100);
  });
});

// ---------------------------------------------------------------------------
// Mille linee.
// ---------------------------------------------------------------------------

describe("mille linee", () => {
  const COUNT = 1000;
  const COLORS = [RED, BLUE, PINK, "#009e73"];

  /// Mille linee, ognuna di un colore su quattro, con una punta di fine e a metà con una d'inizio.
  function thousand(match = true): Opened {
    const markers: string[] = [];
    COLORS.forEach((color, at) => {
      markers.push(MARKER(`me${at}`, "triangle", "medium", "end", match ? color : "#000000"), MARKER(`ms${at}`, "vee", "small", "start", match ? color : "#000000"));
    });
    let body = "";
    for (let i = 0; i < COUNT; i++) {
      body += `<line id="l${String(i).padStart(4, "0")}" x1="0" y1="${i}" x2="50" y2="${i}" stroke="${COLORS[i % 4]}" stroke-width="2"${ENDS(i % 2 === 0 ? `ms${i % 4}` : null, `me${i % 4}`)}/>`;
    }
    return open(doc(DEFS(...markers) + LAYER + body + "</g>"));
  }

  /// Il tempo tipico di `run`: la mediana di cinque prove dopo una di prova.
  function median(run: () => void): number {
    run();
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      run();
      runs.push(performance.now() - t);
    }
    runs.sort((a, b) => a - b);
    return runs[2]!;
  }

  it("si leggono in meno di un fotogramma", () => {
    const opened = thousand();
    const units = opened.index.units;
    expect(units).toHaveLength(COUNT);
    const look = tipsLookOf(opened.engine.model!, units);
    expect(look).toEqual({ count: COUNT, start: { shape: null, size: "small" }, end: { shape: "triangle", size: "medium" } });
    expect(median(() => void tipsLookOf(opened.engine.model!, units))).toBeLessThan(16);
  });

  it("si tengono del colore della linea, di colpo, in meno di un fotogramma, e il seguito aggiunge i marcatori una volta sola", () => {
    const opened = thousand(false);
    const touched = everyId(opened);
    const model = opened.engine.model!;
    const find = (id: string) => opened.engine.holder(id);
    const op = followTips(model, touched, ids(opened), find)!;
    expect(op).not.toBeNull();
    // Quattro colori in fondo; in testa solo due, perché le linee pari sono quelle dei colori 0 e 2.
    expect(adds(op)).toHaveLength(6);
    expect(sets(op)).toHaveLength(COUNT);
    expect(median(() => void followTips(model, touched, ids(opened), find))).toBeLessThan(16);
    expect(median(() => void followTips(model, touched, ids(opened)))).toBeLessThan(16);
  });

  it("e quando sono già a posto, il seguito non trova niente da fare, subito", () => {
    const opened = thousand();
    const touched = everyId(opened);
    const model = opened.engine.model!;
    expect(followTips(model, touched, ids(opened), (id) => opened.engine.holder(id))).toBeNull();
    expect(median(() => void followTips(model, touched, ids(opened), (id) => opened.engine.holder(id)))).toBeLessThan(16);
    expect(median(() => void followTips(model, touched, ids(opened)))).toBeLessThan(16);
  });

  it("si cambiano insieme in meno di un fotogramma, con un marcatore per colore", () => {
    const opened = thousand();
    const units = opened.index.units;
    const model = opened.engine.model!;
    const made = tipOps(model, units, { end: "end", shape: "diamond" }, ids(opened));
    expect(made.changed).toBe(COUNT);
    expect(adds(made.ops)).toHaveLength(4);
    expect(median(() => void tipOps(model, units, { end: "end", shape: "diamond" }, ids(opened)))).toBeLessThan(16);
    expect(median(() => void tipOps(model, units, { swap: true }, ids(opened)))).toBeLessThan(16);
    expect(tipOps(model, units, { end: "end", shape: "none" }, ids(opened)).changed).toBe(COUNT);
  });

  it("e il motore le accetta in un passo solo, e un annulla le riporta al byte", () => {
    const opened = thousand();
    const made = tipped(opened, { end: "end", shape: "circle" });
    const text = applied(opened, made.ops);
    expect(text.match(/fub:marker="circle medium end"/g)).toHaveLength(4);
    expect(looks(opened).end).toEqual({ shape: "circle", size: "medium" });
  });
});
