// L'aspetto della selezione per il pannello delle proprietà: chi ha un
// riempimento, un contorno, uno spessore e un testo; ciò che è comune e ciò
// che è misto; e le operazioni, che il motore accetta così come sono e che un
// annulla disfa al byte.

import { describe, expect, it } from "vitest";
import { doc } from "../scene/test-support";
import { gesture, NewIds } from "./edit";
import { lookOf, lookOps, paintText, styleOf, styleOps, type LookChange, type Restyled, type Style } from "./look";
import { arrowPath } from "./shapes";
import { LAYER, open, type Opened } from "./test-support";

const INK = "1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8";
const BRUSH = "pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

const RECT = (id: string, extra = ' fill="#0072b2" stroke="#000000" stroke-width="2"'): string => `<rect id="${id}" x="0" y="0" width="10" height="10"${extra}/>`;
const PEN = (id: string, fill = "#d55e00"): string => `<path id="${id}" fub:tool="pen" fub:brush="${BRUSH}" d="M0 0 L10 10 Z" fill="${fill}" fub:ink="${INK}"/>`;
const ARROW = `<path id="oarrow000" fub:shape="arrow" fub:geom="0 0 100 0" d="${arrowPath(0, 0, 100, 0, 2)}" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
const TEXT = (id: string, lines: readonly string[], extra = ' font-family="Inter, sans-serif" font-size="32"'): string =>
  `<text id="${id}" x="10" y="40" fill="#000000"${extra}>${lines.map((line, i) => `<tspan x="10" dy="${i === 0 ? 0 : 40}">${line}</tspan>`).join("")}</text>`;

/// Il cambio su tutti gli oggetti del disegno.
function restyled(opened: Opened, change: LookChange): Restyled {
  return lookOps(opened.engine.model!, opened.index.units, change, ids(opened));
}

/// Applica `change`, verifica che un annulla riporti il testo di prima, e
/// torna il testo di dopo.
function applied(opened: Opened, change: Restyled): string {
  const before = opened.engine.text;
  const outcome = opened.engine.apply(gesture(change.ops)!);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = opened.engine.text;
  expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(opened.engine.text).toBe(before);
  expect(opened.engine.apply(gesture(change.ops)!).outcome).toBe("applied");
  return after;
}

const look = (opened: Opened): ReturnType<typeof lookOf> => lookOf(opened.engine.model!, opened.index.units);

describe("i colori", () => {
  it("si mostrano come li scrive il file", () => {
    expect(paintText("#0072B2")).toBe("#0072b2");
    expect(paintText(" red ")).toBe("#ff0000");
    expect(paintText("none")).toBe("none");
    expect(paintText("currentColor")).toBe("currentColor");
  });
});

describe("l'aspetto della selezione", () => {
  it("è comune quando tutte le parti hanno lo stesso valore, e misto quando no", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa")}${RECT("obbbbbbbb")}</g>`));
    expect(look(opened).fill).toEqual({ count: 2, value: "#0072b2" });
    expect(look(opened).width).toEqual({ count: 2, value: 2 });
    const mixed = open(doc(`${LAYER}${RECT("oaaaaaaaa")}${RECT("obbbbbbbb", ' fill="#009e73" stroke="#000000" stroke-width="4"')}</g>`));
    expect(look(mixed).fill).toEqual({ count: 2, value: null });
    expect(look(mixed).width).toEqual({ count: 2, value: null });
    expect(look(mixed).stroke).toEqual({ count: 2, value: "#000000" });
  });

  it("legge il colore di un tratto a penna come contorno, senza riempimento né spessore", () => {
    const opened = open(doc(`${LAYER}${PEN("oaaaaaaaa")}</g>`));
    const seen = look(opened);
    expect(seen.stroke).toEqual({ count: 1, value: "#d55e00" });
    expect(seen.fill.count).toBe(0);
    expect(seen.width.count).toBe(0);
  });

  it("dà a una freccia e a una linea il contorno e non il riempimento", () => {
    const opened = open(doc(`${LAYER}${ARROW}<line id="oline0000" x1="0" y1="0" x2="10" y2="0" stroke="#000000" stroke-width="2"/></g>`));
    const seen = look(opened);
    expect(seen.fill.count).toBe(0);
    expect(seen.stroke).toEqual({ count: 2, value: "#000000" });
    expect(seen.width).toEqual({ count: 2, value: 2 });
  });

  it("dà a un poligono regolare e a una stella riempimento e contorno", () => {
    const opened = open(
      doc(
        `${LAYER}<path id="opolygon0" fub:shape="polygon" fub:geom="0 0 10 4 0 0" d="M-7.07 7.07 L-7.07 -7.07 L7.07 -7.07 L7.07 7.07 Z" fill="#0072b2" stroke="#000000" stroke-width="2"/>` +
          `<path id="ostar0000" fub:shape="star" fub:geom="0 0 10 3 0.5 0 0" d="M0 -10 L4.33 -2.5 L8.66 5 L0 5 L-8.66 5 L-4.33 -2.5 Z" fill="#0072b2" stroke="#000000" stroke-width="2"/></g>`,
      ),
    );
    const seen = look(opened);
    expect(seen.fill).toEqual({ count: 2, value: "#0072b2" });
    expect(seen.stroke).toEqual({ count: 2, value: "#000000" });
    expect(seen.width).toEqual({ count: 2, value: 2 });
  });

  it("conta lo spessore solo dei contorni che si vedono", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa", ' fill="#000000"')}${RECT("obbbbbbbb")}</g>`));
    const seen = look(opened);
    expect(seen.stroke).toEqual({ count: 2, value: null });
    expect(seen.width).toEqual({ count: 1, value: 2 });
  });

  it("scende nei gruppi e legge ciò che le parti ereditano", () => {
    const opened = open(doc(`${LAYER}<g id="ogroup000" fill="#009e73" font-size="24">${RECT("oaaaaaaaa", "")}${RECT("obbbbbbbb", "")}${TEXT("otext0000", ["Ciao"], "")}</g></g>`));
    const seen = look(opened);
    // Il testo ha il suo colore, i rettangoli quello del gruppo.
    expect(seen.fill).toEqual({ count: 3, value: null });
    expect(lookOf(opened.engine.model!, []).fill).toEqual({ count: 0, value: null });
    expect(seen.size).toEqual({ count: 1, value: 24 });
    expect(seen.family).toEqual({ count: 1, value: "" });
    expect(seen.anchor).toEqual({ count: 1, value: "start" });
    expect(seen.opacity).toEqual({ count: 1, value: 1 });
  });

  it("legge l'opacità degli oggetti scelti, immagini comprese", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa", ' fill="#000000" opacity="0.5"')}<image id="oimage000" x="0" y="0" width="10" height="10" href="data:image/png;base64,iVBORw0KGgo=" opacity="0.5"/></g>`));
    expect(look(opened).opacity).toEqual({ count: 2, value: 0.5 });
  });

  it("legge il testo: carattere, corpo e allineamento", () => {
    const opened = open(doc(`${LAYER}${TEXT("oaaaaaaaa", ["Uno"])}${TEXT("obbbbbbbb", ["Due"], ' font-family="Literata, serif" font-size="32" text-anchor="middle"')}</g>`));
    const seen = look(opened);
    expect(seen.family).toEqual({ count: 2, value: null });
    expect(seen.size).toEqual({ count: 2, value: 32 });
    expect(seen.anchor).toEqual({ count: 2, value: null });
    expect(seen.fill).toEqual({ count: 2, value: "#000000" });
  });
});

describe("le operazioni", () => {
  it("danno il riempimento a ogni parte, e lo tolgono dove la parte lo eredita già", () => {
    const opened = open(doc(`${LAYER}<g id="ogroup000" fill="#009e73">${RECT("oaaaaaaaa", ' fill="#000000"')}${RECT("obbbbbbbb", "")}</g>${RECT("occcccccc")}</g>`));
    const blue = applied(opened, restyled(opened, { fill: "#0072b2" }));
    expect(blue).toContain('<rect id="oaaaaaaaa" x="0" y="0" width="10" height="10" fill="#0072b2"/>');
    expect(blue).toContain('<rect id="obbbbbbbb" x="0" y="0" width="10" height="10" fill="#0072b2"/>');
    expect(blue).toContain('<g id="ogroup000" fill="#009e73">');
    const green = open(blue);
    const back = applied(green, restyled(green, { fill: "#009e73" }));
    expect(back).toContain('<rect id="oaaaaaaaa" x="0" y="0" width="10" height="10"/>');
    expect(back).toContain('<rect id="occcccccc" x="0" y="0" width="10" height="10" fill="#009e73"');
  });

  it("scrivono il contorno di un tratto a penna nel suo riempimento", () => {
    const opened = open(doc(`${LAYER}${PEN("oaaaaaaaa")}${RECT("obbbbbbbb")}</g>`));
    const after = applied(opened, restyled(opened, { stroke: "#cc79a7" }));
    expect(after).toContain('fill="#cc79a7" fub:ink=');
    expect(after).toContain('<rect id="obbbbbbbb" x="0" y="0" width="10" height="10" fill="#0072b2" stroke="#cc79a7" stroke-width="2"/>');
    expect(look(open(after)).stroke).toEqual({ count: 2, value: "#cc79a7" });
  });

  it("non scrivono niente se il valore c'è già", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa")}</g>`));
    expect(restyled(opened, { fill: "#0072B2" })).toMatchObject({ ops: [], changed: 0 });
  });

  it("danno un id a una parte che non l'ha, e la selezione la segue", () => {
    const opened = open(doc(`${LAYER}<rect x="0" y="0" width="10" height="10" fill="#000000"/></g>`));
    const change = restyled(opened, { fill: "#0072b2" });
    expect(change.ops[0]).toMatchObject({ op: "ident" });
    expect(change.keys).toEqual([(change.ops[0] as { id: string }).id]);
    applied(opened, change);
  });

  it("cambiano lo spessore col tratteggio, misurato in spessori, e la punta di una freccia", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa", ' fill="none" stroke="#000000" stroke-width="2" stroke-dasharray="8 6"')}${ARROW}${PEN("obbbbbbbb")}</g>`));
    const after = applied(opened, restyled(opened, { width: 4 }));
    expect(after).toContain('stroke-width="4" stroke-dasharray="16 12"');
    expect(after).toContain(`d="${arrowPath(0, 0, 100, 0, 4)}"`);
    // Il tratto a penna resta com'era.
    expect(after).toContain(`fill="#d55e00" fub:ink="${INK}"`);
  });

  it("danno l'opacità agli oggetti scelti e la tolgono quando è piena", () => {
    const opened = open(doc(`${LAYER}<g id="ogroup000">${RECT("oaaaaaaaa")}</g>${RECT("obbbbbbbb", ' fill="#000000" opacity="0.4"')}</g>`));
    const half = applied(opened, restyled(opened, { opacity: 0.5 }));
    expect(half).toContain('<g id="ogroup000" opacity="0.5">');
    expect(half).toContain('fill="#000000" opacity="0.5"');
    const full = open(half);
    const after = applied(full, restyled(full, { opacity: 1 }));
    expect(after).not.toContain("opacity=");
  });

  it("cambiano il carattere e l'allineamento dei testi, anche dentro un gruppo", () => {
    const opened = open(doc(`${LAYER}<g id="ogroup000">${TEXT("oaaaaaaaa", ["Uno"])}</g>${TEXT("obbbbbbbb", ["Due"])}</g>`));
    const serif = applied(opened, restyled(opened, { family: "Literata, serif" }));
    expect(serif.match(/font-family="Literata, serif"/g)).toHaveLength(2);
    const centered = open(serif);
    const after = applied(centered, restyled(centered, { anchor: "middle" }));
    expect(after.match(/text-anchor="middle"/g)).toHaveLength(2);
    // Il punto d'ancoraggio resta dov'era.
    expect(after.match(/<text id="o[ab]{8}" x="10" y="40"/g)).toHaveLength(2);
  });

  it("cambiano il corpo e, nella stessa proporzione, l'interlinea delle righe", () => {
    const opened = open(doc(`${LAYER}${TEXT("oaaaaaaaa", ["Uno", "Due", "Tre"])}${TEXT("obbbbbbbb", ["Sola"])}</g>`));
    const change = restyled(opened, { size: 48 });
    expect(change.changed).toBe(2);
    const after = applied(opened, change);
    expect(after).toContain('<text id="oaaaaaaaa" x="10" y="40" fill="#000000" font-family="Inter, sans-serif" font-size="48">\n  <tspan x="10" dy="0">Uno</tspan>\n  <tspan x="10" dy="60">Due</tspan>\n  <tspan x="10" dy="60">Tre</tspan>\n</text>');
    // Una riga sola non scende: basta il `text`.
    expect(after).toContain('<text id="obbbbbbbb" x="10" y="40" fill="#000000" font-family="Inter, sans-serif" font-size="48">\n  <tspan x="10" dy="0">Sola</tspan>\n</text>');
    expect(look(open(after)).size).toEqual({ count: 2, value: 48 });
  });

  it("tengono l'ordine dei fratelli quando riscrivono un testo", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa")}${TEXT("obbbbbbbb", ["Uno", "Due"])}${RECT("occcccccc")}</g>`));
    const after = applied(opened, restyled(opened, { size: 16 }));
    expect(after.indexOf('id="oaaaaaaaa"')).toBeLessThan(after.indexOf('id="obbbbbbbb"'));
    expect(after.indexOf('id="obbbbbbbb"')).toBeLessThan(after.indexOf('id="occcccccc"'));
    expect(after).toContain('dy="20"');
  });
});

describe("lo stile copiato e incollato", () => {
  /// Lo stile dell'oggetto di chiave `key`.
  const copied = (opened: Opened, key: string): Style | null => styleOf(opened.engine.model!, opened.index.get(key)!);
  /// `style` incollato sugli oggetti di chiave `keys`.
  const pasted = (opened: Opened, keys: readonly string[], style: Style): Restyled =>
    styleOps(opened.engine.model!, keys.map((key) => opened.index.get(key)!), style, ids(opened));

  it("copia ciò che si vede, anche ciò che viene dal gruppo", () => {
    const opened = open(doc(`${LAYER}<g id="ogroup000" stroke="#e69f00" stroke-dasharray="8 6" opacity="0.5">${RECT("oaaaaaaaa", ' fill="#0072b2" stroke-width="4" stroke-linecap="round"')}</g></g>`));
    expect(copied(opened, "ogroup000")).toEqual({
      fill: "#0072b2",
      stroke: "#e69f00",
      outline: { width: "4", dashes: "8 6", cap: "round", join: "miter" },
      opacity: 0.5,
      font: null,
    });
  });

  it("copia il colore di un tratto a penna come contorno, e di un testo il carattere", () => {
    const opened = open(doc(`${LAYER}${PEN("oaaaaaaaa")}${TEXT("obbbbbbbb", ["Uno"], ' font-family="Literata, serif" font-size="24" font-weight="bold"')}</g>`));
    expect(copied(opened, "oaaaaaaaa")).toEqual({ fill: null, stroke: "#d55e00", outline: null, opacity: 1, font: null });
    expect(copied(opened, "obbbbbbbb")).toEqual({
      fill: "#000000",
      stroke: null,
      outline: null,
      opacity: 1,
      font: { family: "Literata, serif", size: 24, weight: "bold" },
    });
  });

  it("di un'immagine copia soltanto l'opacità", () => {
    const opened = open(doc(`${LAYER}<image id="oaaaaaaaa" x="0" y="0" width="10" height="10" href="foto.png" opacity="0.25"/></g>`));
    expect(copied(opened, "oaaaaaaaa")).toEqual({ fill: null, stroke: null, outline: null, opacity: 0.25, font: null });
  });

  it("incolla tutto in un passo, e toglie ciò che la parte eredita già", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa", ' fill="#cc79a7" stroke="#e69f00" stroke-width="3" stroke-dasharray="1 2" stroke-linejoin="bevel" opacity="0.7"')}<g id="ogroup000" stroke="#e69f00">${RECT("obbbbbbbb")}</g></g>`));
    const style = copied(opened, "oaaaaaaaa")!;
    const after = applied(opened, pasted(opened, ["obbbbbbbb"], style));
    expect(after).toContain('<rect id="obbbbbbbb" x="0" y="0" width="10" height="10" fill="#cc79a7" stroke-width="3" stroke-linejoin="bevel" stroke-dasharray="1 2" opacity="0.7"/>');
    expect(copied(open(after), "obbbbbbbb")).toEqual(style);
  });

  it("dà a un tratto a penna e a un testo il colore che si vede", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa", ' fill="none" stroke="#009e73" stroke-width="2"')}${PEN("obbbbbbbb")}${TEXT("occcccccc", ["Uno"])}</g>`));
    const after = applied(opened, pasted(opened, ["obbbbbbbb", "occcccccc"], copied(opened, "oaaaaaaaa")!));
    expect(after).toContain(`fill="#009e73" fub:ink="${INK}"`);
    expect(after).toContain('<text id="occcccccc" x="10" y="40" fill="#009e73"');
    // Un testo non ha contorno.
    expect(after).not.toContain('<text id="occcccccc" x="10" y="40" fill="#009e73" font-family="Inter, sans-serif" font-size="32" stroke');
  });

  it("dà a una forma il colore di un tratto a penna come contorno, e il resto lo lascia", () => {
    const opened = open(doc(`${LAYER}${PEN("oaaaaaaaa")}${RECT("obbbbbbbb")}</g>`));
    const after = applied(opened, pasted(opened, ["obbbbbbbb"], copied(opened, "oaaaaaaaa")!));
    expect(after).toContain('<rect id="obbbbbbbb" x="0" y="0" width="10" height="10" fill="#0072b2" stroke="#d55e00" stroke-width="2"/>');
  });

  it("dà il carattere ai testi, con l'interlinea, e ridisegna la punta di una freccia", () => {
    const opened = open(doc(`${LAYER}${TEXT("oaaaaaaaa", ["Uno"], ' font-family="Literata, serif" font-size="16" font-weight="bold"')}${TEXT("obbbbbbbb", ["Uno", "Due"])}${RECT("occcccccc", ' fill="none" stroke="#000000" stroke-width="4"')}${ARROW}</g>`));
    const text = applied(opened, pasted(opened, ["obbbbbbbb"], copied(opened, "oaaaaaaaa")!));
    // Il nero e il corpo di 16 sono quelli di SVG: non si scrivono.
    expect(text).toContain('<text id="obbbbbbbb" x="10" y="40" font-family="Literata, serif" font-weight="bold">\n  <tspan x="10" dy="0">Uno</tspan>\n  <tspan x="10" dy="20">Due</tspan>\n</text>');
    const next = open(text);
    const arrow = applied(next, pasted(next, ["oarrow000"], copied(next, "occcccccc")!));
    expect(arrow).toContain(`d="${arrowPath(0, 0, 100, 0, 4)}"`);
    // Gli estremi e gli angoli tornano quelli di SVG.
    expect(arrow).toContain('fill="none" stroke="#000000" stroke-width="4"/>');
  });

  it("dà l'opacità all'oggetto scelto, e lascia com'è ciò che è bloccato dentro di lui", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa", ' fill="#cc79a7" opacity="0.5"')}<g id="ogroup000">${RECT("obbbbbbbb")}${RECT("occcccccc", ' fill="#000000" fub:locked="true"')}</g></g>`));
    const after = applied(opened, pasted(opened, ["ogroup000"], copied(opened, "oaaaaaaaa")!));
    expect(after).toContain('<g id="ogroup000" opacity="0.5">');
    expect(after).toContain('<rect id="obbbbbbbb" x="0" y="0" width="10" height="10" fill="#cc79a7"/>');
    expect(after).toContain('<rect id="occcccccc" x="0" y="0" width="10" height="10" fill="#000000" fub:locked="true"/>');
  });
});

describe("mille oggetti scelti", () => {
  it("si leggono entro un fotogramma", () => {
    const rects = Array.from({ length: 1000 }, (_, i) => RECT(`o${String(i).padStart(8, "0")}`)).join("");
    const opened = open(doc(`${LAYER}${rects}</g>`));
    const model = opened.engine.model!;
    const units = opened.index.units;
    expect(units).toHaveLength(1000);
    const first = performance.now();
    lookOf(model, units);
    const cold = performance.now() - first;
    let warm = Infinity;
    for (let run = 0; run < 5; run++) {
      const start = performance.now();
      lookOf(model, units);
      warm = Math.min(warm, performance.now() - start);
    }
    expect(warm).toBeLessThan(16);
    // La prima lettura legge anche gli attributi di ogni parte e costa dieci
    // volte tanto, una trentina di millisecondi. La soglia guarda che non
    // cresca col quadrato degli oggetti, che sarebbero secondi, con il
    // margine per una macchina lenta o carica di altri test.
    expect(cold).toBeLessThan(250);
  });
});
