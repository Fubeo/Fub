// L'aspetto della selezione per il pannello delle proprietà: chi ha un
// riempimento, un contorno, uno spessore e un testo; ciò che è comune e ciò
// che è misto; e le operazioni, che il motore accetta così come sono e che un
// annulla disfa al byte.

import { describe, expect, it } from "vitest";
import { doc } from "../scene/test-support";
import { gesture, NewIds } from "./edit";
import { followEffects, type Effect, type Shadow } from "./effects";
import { hatchOf } from "./hatches";
import { lookOf, lookOps, opacityOf, paintText, styleOf, styleOps, type LookChange, type Restyled, type Style } from "./look";
import { estimate } from "./measure";
import { resourcesOf } from "./resources";
import { arrowPath } from "./shapes";
import { LAYER, open, type Opened } from "./test-support";
import { BLUE, CUSTOM, DEFS, GREEN, MARKER, RED } from "./tip-support";
import { followTips, type TipEnd } from "./tips";

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
  return lookOps(opened.engine.model!, opened.index.units, change, estimate, ids(opened));
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

  it("mostrano una risorsa col suo id, qualunque sia il ripiego, e col suo campione", () => {
    expect(paintText("url(#rgggggggg) #ff0000")).toBe("url(#rgggggggg)");
    expect(paintText(" url( #rgggggggg ) none")).toBe("url(#rgggggggg)");
    const opened = open(
      doc(
        '<defs id="fub-defs"><linearGradient id="rgggggggg"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/></linearGradient>' +
          '<pattern id="rpppppppp" width="0.5" height="0.5"><rect x="0" y="0" width="0.25" height="0.25" fill="#000000"/></pattern></defs>' +
          `${LAYER}${RECT("oaaaaaaaa", ' fill="url(#rgggggggg) #ff0000" stroke="url(#rpppppppp)"')}${RECT("obbbbbbbb", ' fill="url(#rgggggggg)" stroke="url(#rpppppppp)"')}</g>`,
      ),
    );
    const seen = look(opened);
    expect(seen.fill).toEqual({ count: 2, value: "url(#rgggggggg)" });
    expect(seen.stroke).toEqual({ count: 2, value: "url(#rpppppppp)" });
    expect(seen.samples).toEqual(
      new Map([
        ["url(#rgggggggg)", { kind: "gradient", image: "linear-gradient(to right, rgb(255 255 255 / 1) 0%, rgb(0 0 0 / 1) 100%)" }],
        ["url(#rpppppppp)", { kind: "pattern", image: null }],
      ]),
    );
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

  it("rilegge un gruppo che un'operazione cambia sul posto, e ciò che passa alle parti", () => {
    const opened = open(doc(`${LAYER}<g id="ogroup000" fill="#009e73">${RECT("oaaaaaaaa", "")}</g></g>`));
    const rect = (): Parameters<typeof lookOf>[1] => [opened.reindex().get("oaaaaaaaa")!];
    expect(lookOf(opened.engine.model!, rect()).fill.value).toBe("#009e73");
    expect(opened.engine.apply({ op: "set", id: "ogroup000", attrs: { fill: "#d55e00", opacity: "0.5" } }).outcome).toBe("applied");
    expect(lookOf(opened.engine.model!, rect()).fill.value).toBe("#d55e00");
    expect(lookOf(opened.engine.model!, [opened.reindex().get("ogroup000")!]).opacity.value).toBe(0.5);
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

  it("leggono il testo intero: una parola di un altro colore o in grassetto lo fa misto", () => {
    const opened = open(
      doc(
        `${LAYER}<text id="oaaaaaaaa" x="10" y="40" font-size="20"><tspan x="10" dy="0">Uno <tspan fill="#0072b2" font-weight="bold">due</tspan></tspan><tspan x="10" dy="25" letter-spacing="1">tre</tspan></text></g>`,
      ),
    );
    const seen = look(opened);
    expect(seen.fill).toEqual({ count: 1, value: null });
    expect(seen.weight).toEqual({ count: 1, value: null });
    expect(seen.size).toEqual({ count: 1, value: 20 });
    expect(seen.italic).toEqual({ count: 1, value: false });
    expect(seen.underline).toEqual({ count: 1, value: false });
    expect(seen.leading).toEqual({ count: 1, value: 1.25 });
    expect(seen.spacing).toEqual({ count: 1, value: null });
    // Un testo di una riga non ha interlinea.
    expect(look(open(doc(`${LAYER}${TEXT("obbbbbbbb", ["Uno"])}</g>`))).leading).toEqual({ count: 0, value: null });
  });

  it("danno un valore al testo intero: righe e pezzi lasciano il loro, in un passo", () => {
    const source = doc(
      `${LAYER}<text id="oaaaaaaaa" x="10" y="40" font-size="20"><tspan x="10" dy="0">Uno <tspan fill="#0072b2" font-weight="bold">due</tspan></tspan><tspan x="10" dy="25" fill="#d55e00">tre</tspan></text></g>`,
    );
    const opened = open(source);
    const blue = applied(opened, restyled(opened, { fill: "#009e73" }));
    expect(blue).toContain('<text id="oaaaaaaaa" x="10" y="40" fill="#009e73" font-size="20">\n  <tspan x="10" dy="0">Uno <tspan font-weight="bold">due</tspan></tspan>\n  <tspan x="10" dy="25">tre</tspan>\n</text>');
    expect(look(open(blue)).fill).toEqual({ count: 1, value: "#009e73" });
    const heavy = open(source);
    const bold = applied(heavy, restyled(heavy, { weight: 700 }));
    expect(bold).toContain('font-size="20" font-weight="bold">\n  <tspan x="10" dy="0">Uno <tspan fill="#0072b2">due</tspan></tspan>');
    const thin = open(source);
    const light = applied(thin, restyled(thin, { weight: 300 }));
    expect(light).toContain('font-weight="300"');
    // Un testo che cambia soltanto i suoi attributi resta lui.
    const plain = open(doc(`${LAYER}${TEXT("obbbbbbbb", ["Uno", "Due"])}</g>`));
    const change = restyled(plain, { italic: true });
    expect(change.ops.map((op) => op.op)).toEqual(["set"]);
    expect(applied(plain, change)).toContain('font-size="32" font-style="italic">');
  });

  it("l'interlinea e la spaziatura in volte il corpo; uno stile dà corpo e peso insieme", () => {
    const source = doc(`${LAYER}${TEXT("oaaaaaaaa", ["Uno", "Due", "Tre"])}</g>`);
    const opened = open(source);
    const loose = applied(opened, restyled(opened, { leading: 1.5 }));
    expect(loose).toContain('<tspan x="10" dy="48">Due</tspan>\n  <tspan x="10" dy="48">Tre</tspan>');
    expect(look(open(loose)).leading).toEqual({ count: 1, value: 1.5 });
    const tight = open(source);
    const spaced = applied(tight, restyled(tight, { spacing: 0.05 }));
    expect(spaced).toContain('font-size="32" letter-spacing="1.6">');
    expect(look(open(spaced)).spacing).toEqual({ count: 1, value: 0.05 });
    // La spaziatura nulla è quella di SVG: non si scrive.
    const back = open(spaced);
    expect(applied(back, restyled(back, { spacing: 0 }))).toContain('font-size="32">');
    const big = open(source);
    const title = applied(big, restyled(big, { preset: { size: 64, weight: 700 } }));
    expect(title).toContain('font-size="64" font-weight="bold">\n  <tspan x="10" dy="0">Uno</tspan>\n  <tspan x="10" dy="80">Due</tspan>');
  });

  it("sottolineato e barrato: il testo tira la linea, righe e pezzi la lasciano", () => {
    const opened = open(doc(`${LAYER}<text id="oaaaaaaaa" x="10" y="40" font-size="20"><tspan x="10" dy="0">Uno <tspan text-decoration="line-through">due</tspan></tspan></text></g>`));
    expect(look(opened).strike).toEqual({ count: 1, value: null });
    const under = applied(opened, restyled(opened, { underline: true }));
    expect(under).toContain('<text id="oaaaaaaaa" x="10" y="40" font-size="20" text-decoration="underline">\n  <tspan x="10" dy="0">Uno <tspan text-decoration="line-through">due</tspan></tspan>');
    const struck = open(under);
    const all = applied(struck, restyled(struck, { strike: true }));
    expect(all).toContain('text-decoration="underline line-through">\n  <tspan x="10" dy="0">Uno due</tspan>');
    const none = open(all);
    expect(applied(none, restyled(none, { underline: false }))).toContain('font-size="20" text-decoration="line-through">');
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
    styleOps(opened.engine.model!, keys.map((key) => opened.index.get(key)!), style, estimate, ids(opened));

  it("copia ciò che si vede, anche ciò che viene dal gruppo", () => {
    const opened = open(doc(`${LAYER}<g id="ogroup000" stroke="#e69f00" stroke-dasharray="8 6" opacity="0.5">${RECT("oaaaaaaaa", ' fill="#0072b2" stroke-width="4" stroke-linecap="round"')}</g></g>`));
    expect(copied(opened, "ogroup000")).toEqual({
      fill: "#0072b2",
      stroke: "#e69f00",
      outline: { width: "4", dashes: "8 6", cap: "round", join: "miter" },
      opacity: 0.5,
      blend: null,
      effects: [],
      font: null,
      box: null,
      tips: null,
      resources: new Map(),
      swatches: new Map(),
    });
  });

  it("copia il colore di un tratto a penna come contorno, e di un testo il carattere", () => {
    const opened = open(doc(`${LAYER}${PEN("oaaaaaaaa")}${TEXT("obbbbbbbb", ["Uno"], ' font-family="Literata, serif" font-size="24" font-weight="bold"')}</g>`));
    expect(copied(opened, "oaaaaaaaa")).toEqual({ fill: null, stroke: "#d55e00", outline: null, opacity: 1, blend: null, effects: [], font: null, box: null, tips: null, resources: new Map(), swatches: new Map() });
    expect(copied(opened, "obbbbbbbb")).toEqual({
      fill: "#000000",
      stroke: null,
      outline: null,
      opacity: 1,
      blend: null,
      effects: [],
      font: { family: "Literata, serif", size: 24, weight: "bold", style: "normal", spacing: 0, underline: false, strike: false, leading: null },
      box: null,
      tips: null,
      resources: new Map(),
      swatches: new Map(),
    });
  });

  it("di un testo a pezzi copia il primo carattere, con corsivo, spaziatura, linee e interlinea, e lo dà intero", () => {
    const opened = open(
      doc(
        `${LAYER}<text id="oaaaaaaaa" x="10" y="40" font-size="20" letter-spacing="1"><tspan x="10" dy="0"><tspan font-style="italic" text-decoration="underline">Uno</tspan> due</tspan><tspan x="10" dy="30">Tre</tspan></text>` +
          `${TEXT("obbbbbbbb", ["Uno", "Due"])}</g>`,
      ),
    );
    const style = copied(opened, "oaaaaaaaa")!;
    expect(style.font).toEqual({ family: "", size: 20, weight: "normal", style: "italic", spacing: 0.05, underline: true, strike: false, leading: 1.5 });
    const after = applied(opened, pasted(opened, ["obbbbbbbb"], style));
    expect(after).toContain(
      '<text id="obbbbbbbb" x="10" y="40" font-size="20" font-style="italic" letter-spacing="1" text-decoration="underline">\n  <tspan x="10" dy="0">Uno</tspan>\n  <tspan x="10" dy="30">Due</tspan>\n</text>',
    );
  });

  it("una risorsa che il disegno non ha lascia il ripiego, e un campione il suo colore o il campione con lo stesso nome e colore", () => {
    const opened = open(
      doc(
        '<defs id="fub-defs"><linearGradient id="rmare0000" fub:role="swatch" fub:name="BLU  mare" gradientUnits="userSpaceOnUse"><stop stop-color="#0072b2"/></linearGradient></defs>' +
          `${LAYER}${RECT("oaaaaaaaa")}${RECT("obbbbbbbb")}</g>`,
      ),
    );
    const style = (fill: string, stroke: string, swatches: ReadonlyArray<readonly [string, string, string]> = []): Style => ({
      fill,
      stroke,
      outline: null,
      opacity: 1,
      blend: null,
      effects: [],
      font: null,
      box: null,
      tips: null,
      resources: new Map(),
      swatches: new Map(swatches.map(([id, name, color]) => [id, { name, color }])),
    });
    // Una sfumatura di un altro disegno: il ripiego, o niente se non ce l'ha,
    // che per il contorno è come non scriverlo.
    expect(applied(opened, pasted(opened, ["oaaaaaaaa"], style("url(#raltro000) #009e73", "url(#raltro000)")))).toContain(
      '<rect id="oaaaaaaaa" x="0" y="0" width="10" height="10" fill="#009e73" stroke-width="2"/>',
    );
    // Un campione di un altro disegno: quello di qui col nome uguale, spazi e
    // maiuscole a parte, se ha lo stesso colore; altrimenti il suo colore,
    // anche se il ripiego scritto era rimasto indietro.
    const swatches = [["rblu00000", "Blu mare", "#0072b2"], ["rrosso000", "Blu mare", "#d55e00"]] as const;
    expect(applied(opened, pasted(opened, ["obbbbbbbb"], style("url(#rblu00000) #0072b2", "url(#rrosso000) #000000", swatches)))).toContain(
      '<rect id="obbbbbbbb" x="0" y="0" width="10" height="10" fill="url(#rmare0000) #0072b2" stroke="#d55e00" stroke-width="2"/>',
    );
    // Un campione di qui porta il suo colore di adesso.
    expect(applied(opened, pasted(opened, ["obbbbbbbb"], style("url(#rmare0000) #ffffff", "#000000")))).toContain('fill="url(#rmare0000) #0072b2"');
  });

  it("di un'immagine copia soltanto l'opacità", () => {
    const opened = open(doc(`${LAYER}<image id="oaaaaaaaa" x="0" y="0" width="10" height="10" href="foto.png" opacity="0.25"/></g>`));
    expect(copied(opened, "oaaaaaaaa")).toEqual({ fill: null, stroke: null, outline: null, opacity: 0.25, blend: null, effects: [], font: null, box: null, tips: null, resources: new Map(), swatches: new Map() });
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

  describe("con una risorsa privata", () => {
    const GRADIENT =
      '<defs id="fub-defs"><linearGradient id="rgggggggg" fub:role="private" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="10" y2="0">' +
      '<stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/></linearGradient></defs>';
    const SOURCE = '<rect id="oaaaaaaaa" x="0" y="0" width="10" height="10" fill="url(#rgggggggg) #0072b2"/>';
    const TARGETS = '<rect id="obbbbbbbb" x="100" y="0" width="20" height="10"/><rect id="occcccccc" x="0" y="50" width="10" height="40"/>';
    /// Gli id delle sfumature di `text`, nell'ordine del file.
    const gradients = (text: string): string[] => [...text.matchAll(/<linearGradient id="(\w+)"/g)].map((match) => match[1]!);

    it("ne dà a ciascuno una copia sua, adattata al suo riquadro, e chi la usa già la tiene", () => {
      const opened = open(doc(`${GRADIENT}${LAYER}${SOURCE}${TARGETS}</g>`));
      const style = copied(opened, "oaaaaaaaa")!;
      expect(style.box).toEqual({ min: [0, 0], max: [10, 10] });
      expect([...style.resources.keys()]).toEqual(["rgggggggg"]);
      const after = applied(opened, pasted(opened, ["oaaaaaaaa", "obbbbbbbb", "occcccccc"], style));
      const [own, b, c] = gradients(after);
      expect(own).toBe("rgggggggg");
      expect(after).toContain('<rect id="oaaaaaaaa" x="0" y="0" width="10" height="10" fill="url(#rgggggggg) #0072b2"/>');
      expect(after).toContain(`<rect id="obbbbbbbb" x="100" y="0" width="20" height="10" fill="url(#${b}) #0072b2"/>`);
      expect(after).toContain(`<rect id="occcccccc" x="0" y="50" width="10" height="40" fill="url(#${c}) #0072b2"/>`);
      expect(after).toContain(`<linearGradient id="${b}" fub:role="private" x1="0" y1="0" x2="10" y2="0" gradientUnits="userSpaceOnUse" gradientTransform="matrix(2 0 0 1 100 0)">`);
      expect(after).toContain(`<linearGradient id="${c}" fub:role="private" x1="0" y1="0" x2="10" y2="0" gradientUnits="userSpaceOnUse" gradientTransform="matrix(1 0 0 4 0 50)">`);
    });

    it("la porta com'era anche se l'oggetto copiato non c'è più", () => {
      const opened = open(doc(`${GRADIENT}${LAYER}${SOURCE}${TARGETS}</g>`));
      const style = copied(opened, "oaaaaaaaa")!;
      expect(opened.engine.apply(gesture([{ op: "remove", target: opened.index.get("oaaaaaaaa")!.target }])!).outcome).toBe("applied");
      // Senza chi la usava, la sfumatura privata se n'è andata.
      expect(gradients(opened.engine.text)).toEqual([]);
      const index = opened.reindex();
      const restyled = styleOps(opened.engine.model!, [index.get("obbbbbbbb")!], style, estimate, ids(opened));
      const after = applied(opened, restyled);
      const [copy] = gradients(after);
      expect(after).toContain(`fill="url(#${copy}) #0072b2"`);
      expect(after).toContain('gradientTransform="matrix(2 0 0 1 100 0)"');
    });

    it("un colore dato a tutti la copia per ciascuno", () => {
      const opened = open(doc(`${GRADIENT}${LAYER}${SOURCE}${TARGETS}</g>`));
      const after = applied(opened, lookOps(opened.engine.model!, [opened.index.get("obbbbbbbb")!, opened.index.get("occcccccc")!], { fill: "url(#rgggggggg) #0072b2" }, estimate, ids(opened)));
      const [, b, c] = gradients(after);
      expect(new Set([b, c, "rgggggggg"]).size).toBe(3);
      // Senza il riquadro di chi la dava, la copia resta com'era.
      expect(after).not.toContain("gradientTransform");
    });
  });

  describe("con una campitura o un motivo del documento", () => {
    const DEFS_HATCH =
      '<defs id="fub-defs"><pattern id="rhhhhhhhh" fub:role="private" width="8" height="8" patternUnits="userSpaceOnUse" fub:pattern="lines 0 8 2 #000000 #56b4e9">' +
      '<rect width="8" height="8" fill="#56b4e9"/><rect y="3" width="8" height="2" fill="#000000"/></pattern>' +
      '<pattern id="rmmmmmmmm" fub:role="swatch" fub:name="Pois" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="5" cy="5" r="2" fill="#d55e00"/></pattern></defs>';
    const SOURCES =
      '<rect id="oaaaaaaaa" x="0" y="0" width="10" height="10" fill="url(#rhhhhhhhh) #4087af"/><rect id="odddddddd" x="0" y="20" width="10" height="10" fill="url(#rmmmmmmmm) #d55e00"/>';
    const TARGETS = '<rect id="obbbbbbbb" x="100" y="0" width="20" height="10"/><rect id="occcccccc" x="0" y="50" width="10" height="40"/>';
    /// Gli id delle campiture di `text`, nell'ordine del file.
    const hatches = (text: string): string[] => [...text.matchAll(/<pattern id="(\w+)"[^>]* fub:pattern=/g)].map((match) => match[1]!);

    it("la campitura arriva come copia per ciascuno, ancora una campitura, nelle sue coordinate", () => {
      const opened = open(doc(`${DEFS_HATCH}${LAYER}${SOURCES}${TARGETS}</g>`));
      const after = applied(opened, pasted(opened, ["obbbbbbbb", "occcccccc"], copied(opened, "oaaaaaaaa")!));
      const [own, b, c] = hatches(after);
      expect(own).toBe("rhhhhhhhh");
      expect(new Set([own, b, c]).size).toBe(3);
      expect(after).toContain(`<rect id="obbbbbbbb" x="100" y="0" width="20" height="10" fill="url(#${b}) #4087af"/>`);
      expect(after).toContain(`<rect id="occcccccc" x="0" y="50" width="10" height="40" fill="url(#${c}) #4087af"/>`);
      // Una campitura non segue il riquadro: si ripete uguale dovunque.
      const resources = resourcesOf(opened.engine.model!);
      expect([b, c].map((id) => hatchOf(resources.get(id!)!))).toEqual([0, 1].map(() => hatchOf(resources.get("rhhhhhhhh")!)));
      expect(after).toContain(
        `<pattern id="${b}" fub:role="private" width="8" height="8" patternUnits="userSpaceOnUse" fub:pattern="lines 0 8 2 #000000 #56b4e9">`,
      );
    });

    it("e un colore dato a tutti, come il contagocce con Maiusc, la copia allo stesso modo", () => {
      const opened = open(doc(`${DEFS_HATCH}${LAYER}${SOURCES}${TARGETS}</g>`));
      const after = applied(opened, lookOps(opened.engine.model!, [opened.index.get("obbbbbbbb")!, opened.index.get("occcccccc")!], { fill: "url(#rhhhhhhhh) #4087af" }, estimate, ids(opened)));
      expect(new Set(hatches(after)).size).toBe(3);
    });

    it("il motivo del documento resta lo stesso; in un altro disegno, che non lo ha, lascia il suo ripiego", () => {
      const opened = open(doc(`${DEFS_HATCH}${LAYER}${SOURCES}${TARGETS}</g>`));
      const style = copied(opened, "odddddddd")!;
      const after = applied(opened, pasted(opened, ["obbbbbbbb"], style));
      expect(after).toContain('<rect id="obbbbbbbb" x="100" y="0" width="20" height="10" fill="url(#rmmmmmmmm) #d55e00"/>');
      expect(after.match(/<pattern /g)).toHaveLength(2);
      const other = open(doc(`${LAYER}${TARGETS}</g>`));
      expect(applied(other, pasted(other, ["obbbbbbbb"], style))).toContain('<rect id="obbbbbbbb" x="100" y="0" width="20" height="10" fill="#d55e00"/>');
    });
  });

  it("dà a un testo a pezzi il colore intero", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa", ' fill="#009e73"')}<text id="obbbbbbbb" x="10" y="40"><tspan x="10" dy="0">Uno <tspan fill="#d55e00">due</tspan></tspan></text></g>`));
    const after = applied(opened, pasted(opened, ["obbbbbbbb"], copied(opened, "oaaaaaaaa")!));
    expect(after).toContain('fill="#009e73"');
    expect(after).not.toContain("#d55e00");
  });

  it("dà l'opacità all'oggetto scelto, e lascia com'è ciò che è bloccato dentro di lui", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa", ' fill="#cc79a7" opacity="0.5"')}<g id="ogroup000">${RECT("obbbbbbbb")}${RECT("occcccccc", ' fill="#000000" fub:locked="true"')}</g></g>`));
    const after = applied(opened, pasted(opened, ["ogroup000"], copied(opened, "oaaaaaaaa")!));
    expect(after).toContain('<g id="ogroup000" opacity="0.5">');
    expect(after).toContain('<rect id="obbbbbbbb" x="0" y="0" width="10" height="10" fill="#cc79a7"/>');
    expect(after).toContain('<rect id="occcccccc" x="0" y="0" width="10" height="10" fill="#000000" fub:locked="true"/>');
  });
});

describe("il testo in area", () => {
  // Corpo 10, a stima: ogni carattere largo 6, dieci per riga.
  const AREA = (extra = ""): string =>
    `<text id="oaaaaaaaa" fub:wrap="60" x="20" y="40" font-size="10"${extra}><tspan x="20" dy="0">Il testo</tspan><tspan fub:join="space" x="20" dy="12.5">va a capo</tspan></text>`;
  /// Il testo di `text` senza gli a capo e i rientri.
  const flat = (text: string): string => text.replace(/\n\s*/g, "");

  it("si legge col suo tipo e la larghezza del riquadro; un testo su tracciato non ha né l'uno né l'altra", () => {
    const opened = open(
      doc(
        '<defs id="fub-defs"><path id="rpppppppp" fub:role="private" d="M 0 50 L 200 50"/></defs>' +
          `${LAYER}${AREA()}${TEXT("obbbbbbbb", ["Uno"])}<text id="occcccccc"><textPath href="#rpppppppp">Lungo</textPath></text></g>`,
      ),
    );
    expect(look(opened).form).toEqual({ count: 2, value: null });
    expect(look(opened).wrap).toEqual({ count: 1, value: 60 });
  });

  it("va di nuovo a capo quando cambia il carattere, e lo dice se un carattere non ci sta", () => {
    const opened = open(doc(`${LAYER}${AREA()}</g>`));
    const after = flat(applied(opened, restyled(opened, { size: 20 })));
    expect(after).toContain(
      '<tspan x="20" dy="0">Il</tspan><tspan fub:join="space" x="20" dy="25">testo</tspan><tspan fub:join="space" x="20" dy="25">va a</tspan><tspan fub:join="space" x="20" dy="25">capo</tspan>',
    );
    expect(restyled(opened, { size: 20 }).overflow).toBe(false);
    expect(restyled(open(doc(`${LAYER}${AREA()}</g>`)), { size: 120 }).overflow).toBe(true);
  });

  it("un colore o una linea non rifanno gli a capo che il file ha", () => {
    // Una riga sola più larga del riquadro, come l'ha scritta un altro.
    const opened = open(doc(`${LAYER}${AREA().replace(/<tspan fub:join="space" x="20" dy="12.5">va a capo<\/tspan>/, "").replace("Il testo", "Il testo va a capo")}</g>`));
    const after = flat(applied(opened, restyled(opened, { fill: "#0072b2" })));
    expect(after).toContain('<tspan x="20" dy="0">Il testo va a capo</tspan></text>');
    const lined = open(after);
    expect(flat(applied(lined, restyled(lined, { underline: true })))).toContain(">Il testo va a capo</tspan></text>");
  });

  it("con l'allineamento e la larghezza il riquadro tiene il bordo sinistro", () => {
    const opened = open(doc(`${LAYER}${AREA()}</g>`));
    // Al centro: x va a metà del riquadro, e le righe con lei.
    const centered = flat(applied(opened, restyled(opened, { anchor: "middle" })));
    expect(centered).toMatch(/<text id="oaaaaaaaa" fub:wrap="60" x="50" y="40" font-size="10" text-anchor="middle"><tspan x="50" dy="0">Il testo<\/tspan><tspan fub:join="space" x="50" dy="12.5">/);
    // Allineato a destra e largo 100: x è il bordo destro, da -40 a 60, e
    // le righe vanno di nuovo a capo.
    const ended = open(doc(`${LAYER}${AREA(' text-anchor="end"').replace(/x="20"/g, 'x="20"')}</g>`));
    const wider = flat(applied(ended, restyled(ended, { wrap: 100 })));
    expect(wider).toContain('fub:wrap="100" x="60"');
    expect(wider).toContain('<tspan x="60" dy="0">Il testo va a</tspan><tspan fub:join="space" x="60" dy="12.5">capo</tspan>');
  });

  it("un testo da punto diventa in area largo quanto la riga più larga, e torna da punto, senza muoversi", () => {
    const opened = open(doc(`${LAYER}<text id="oaaaaaaaa" x="20" y="40" font-size="10"><tspan x="20" dy="0">Sul colle</tspan><tspan x="20" dy="12.5">e oltre</tspan></text></g>`));
    const area = flat(applied(opened, restyled(opened, { form: "area" })));
    expect(area).toContain('<text id="oaaaaaaaa" fub:wrap="54" x="20" y="40" font-size="10"><tspan x="20" dy="0">Sul colle</tspan><tspan x="20" dy="12.5">e oltre</tspan></text>');
    expect(look(open(area)).form).toEqual({ count: 1, value: "area" });
    const back = open(doc(`${LAYER}${AREA()}</g>`));
    const point = flat(applied(back, restyled(back, { form: "point" })));
    expect(point).toContain('<text id="oaaaaaaaa" x="20" y="40" font-size="10"><tspan x="20" dy="0">Il testo</tspan><tspan x="20" dy="12.5">va a capo</tspan></text>');
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

describe("lo stile con le punte", () => {
  /// Una linea orizzontale spessa 2 del colore `stroke`, con gli attributi `extra`.
  const LINE = (id: string, stroke: string, extra = "", y = 10): string => `<line id="${id}" x1="0" y1="${y}" x2="50" y2="${y}" stroke="${stroke}" stroke-width="2"${extra}/>`;
  /// Le punte della raccolta: un triangolo di fine e un cerchio d'inizio, rossi.
  const TIPS = DEFS(MARKER("mt", "triangle", "medium", "end"), MARKER("mc", "circle", "medium", "start"));
  const BOTH = ' marker-start="url(#mc)" marker-end="url(#mt)"';

  /// Il motore di `source` con le punte che seguono la linea, come lo installa
  /// l'editor.
  function following(source: string): Opened {
    const opened = open(source);
    opened.engine.follow = (model, touched) => followTips(model, touched, ids(opened), (id) => opened.engine.holder(id));
    return opened;
  }
  const copied = (opened: Opened, key: string): Style | null => styleOf(opened.engine.model!, opened.index.get(key)!);
  const pasted = (opened: Opened, keys: readonly string[], style: Style): Restyled =>
    styleOps(opened.engine.model!, keys.map((key) => opened.index.get(key)!), style, estimate, ids(opened));
  /// Gli attributi dell'elemento di id `id` in `text`.
  function attrsOf(text: string, id: string): Record<string, string> {
    const found = new RegExp(`<[a-z]+ id="${id}"([^>]*?)/?>`).exec(text);
    if (found === null) throw new Error(`nessun elemento ${id}`);
    const attrs: Record<string, string> = {};
    for (const [, name, value] of found[1]!.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs[name!] = value!;
    return attrs;
  }
  /// I marcatori di `text`: id, forma e capo.
  const markersIn = (text: string): Array<{ id: string; kind: string; paint: string }> =>
    [...text.matchAll(/<marker id="([^"]+)"[^>]*fub:marker="([^"]+)"[^>]*>\s*<[a-z]+ [^>]*?(?:fill|stroke)="(#\w+)"/g)].map((m) => ({ id: m[1]!, kind: m[2]!, paint: m[3]! }));
  /// Il marcatore che la linea `id` di `text` usa al capo `end`, com'è scritto.
  const used = (text: string, id: string, end: TipEnd): { id: string; kind: string; paint: string } | null => {
    const url = /url\(#([^)]+)\)/.exec(attrsOf(text, id)[`marker-${end}`] ?? "");
    return url === null ? null : markersIn(text).find((marker) => marker.id === url[1]) ?? null;
  };

  it("copia le punte di una linea, capo per capo, e il capo senza punta dice che non ne ha", () => {
    const opened = open(doc(`${TIPS}${LAYER}${LINE("oaaaaaaaa", RED, BOTH)}${LINE("obbbbbbbb", BLUE, "", 30)}${LINE("occcccccc", GREEN, ' marker-end="url(#mt)"', 50)}</g>`));
    expect(copied(opened, "oaaaaaaaa")!.tips).toEqual({ start: { shape: "circle", size: "medium" }, end: { shape: "triangle", size: "medium" } });
    expect(copied(opened, "obbbbbbbb")!.tips).toEqual({ start: "none", end: "none" });
    expect(copied(opened, "occcccccc")!.tips).toEqual({ start: "none", end: { shape: "triangle", size: "medium" } });
  });

  it("un capo con un marcatore di un altro programma non si copia, e una forma che non può averle non ha niente da copiare", () => {
    const opened = open(doc(`${DEFS(MARKER("mt", "triangle", "medium", "end"), CUSTOM("mx"))}${LAYER}${LINE("oaaaaaaaa", RED, ' marker-start="url(#mx)" marker-end="url(#mt)"')}${RECT("obbbbbbbb")}${PEN("occcccccc")}${ARROW}</g>`));
    expect(copied(opened, "oaaaaaaaa")!.tips).toEqual({ start: null, end: { shape: "triangle", size: "medium" } });
    expect(copied(opened, "obbbbbbbb")!.tips).toBeNull();
    expect(copied(opened, "occcccccc")!.tips).toBeNull();
    expect(copied(opened, "oarrow000")!.tips).toBeNull();
  });

  it("di un gruppo copia le punte della sua prima linea, come il resto dello stile", () => {
    const opened = open(doc(`${TIPS}${LAYER}<g id="ogroup000">${LINE("oaaaaaaaa", RED, BOTH)}</g></g>`));
    expect(copied(opened, "ogroup000")!.tips).toEqual({ start: { shape: "circle", size: "medium" }, end: { shape: "triangle", size: "medium" } });
  });

  it("incollate su una linea, le punte arrivano del colore del contorno nuovo, e il marcatore che non serve se ne va", () => {
    const opened = following(doc(`${TIPS}${LAYER}${LINE("oaaaaaaaa", RED, BOTH)}${LINE("obbbbbbbb", BLUE, "", 30)}</g>`));
    const after = applied(opened, pasted(opened, ["obbbbbbbb"], copied(opened, "oaaaaaaaa")!));
    const attrs = attrsOf(after, "obbbbbbbb");
    expect(attrs.stroke).toBe(RED);
    // Le punte rosse della prima linea servono anche alla seconda: nessun
    // marcatore blu resta, e non se ne aggiungono.
    expect(attrs["marker-start"]).toBe("url(#mc)");
    expect(attrs["marker-end"]).toBe("url(#mt)");
    expect(markersIn(after).map((marker) => marker.id)).toEqual(["mt", "mc"]);
  });

  it("incollate con un contorno di un altro colore, le punte prendono quel colore: marcatori nuovi, e quelli della prima linea restano", () => {
    const opened = following(doc(`${TIPS}${LAYER}${LINE("oaaaaaaaa", RED, BOTH)}${LINE("obbbbbbbb", BLUE, "", 30)}</g>`));
    const style: Style = { ...copied(opened, "oaaaaaaaa")!, stroke: GREEN };
    const after = applied(opened, pasted(opened, ["obbbbbbbb"], style));
    const [start, end] = [used(after, "obbbbbbbb", "start")!, used(after, "obbbbbbbb", "end")!];
    expect([start.kind, start.paint]).toEqual(["circle medium start", GREEN]);
    expect([end.kind, end.paint]).toEqual(["triangle medium end", GREEN]);
    // Quelle rosse restano alla prima linea, e quelle blu non ci sono.
    expect(markersIn(after)).toHaveLength(4);
    expect(markersIn(after).some((marker) => marker.paint === BLUE)).toBe(false);
  });

  it("senza il seguito delle punte il marcatore ha il colore di prima e basta", () => {
    const opened = open(doc(`${TIPS}${LAYER}${LINE("oaaaaaaaa", RED, BOTH)}${LINE("obbbbbbbb", BLUE, "", 30)}</g>`));
    const after = applied(opened, pasted(opened, ["obbbbbbbb"], copied(opened, "oaaaaaaaa")!));
    expect(used(after, "obbbbbbbb", "end")).toMatchObject({ kind: "triangle medium end", paint: BLUE });
  });

  it("una linea senza punte le toglie a chi le ha, e il marcatore rimasto solo se ne va", () => {
    const opened = following(doc(`${TIPS}${LAYER}${LINE("oaaaaaaaa", RED, BOTH)}${LINE("obbbbbbbb", BLUE, "", 30)}</g>`));
    const after = applied(opened, pasted(opened, ["oaaaaaaaa"], copied(opened, "obbbbbbbb")!));
    expect(attrsOf(after, "oaaaaaaaa")).not.toHaveProperty("marker-start");
    expect(attrsOf(after, "oaaaaaaaa")).not.toHaveProperty("marker-end");
    expect(after).not.toContain("<marker");
    expect(after).not.toContain("fub-defs");
  });

  it("un capo che non si copia lascia quello che c'è, e le altre forme non hanno punte da cambiare", () => {
    const defs = DEFS(MARKER("mt", "triangle", "medium", "end"), MARKER("mc", "circle", "medium", "start"), CUSTOM("mx"));
    const opened = following(doc(`${defs}${LAYER}${LINE("oaaaaaaaa", RED, ' marker-start="url(#mc)" marker-end="url(#mx)"')}${LINE("obbbbbbbb", RED, ' marker-end="url(#mt)"', 30)}${RECT("occcccccc")}</g>`));
    const style = copied(opened, "oaaaaaaaa")!;
    expect(style.tips).toEqual({ start: { shape: "circle", size: "medium" }, end: null });
    const after = applied(opened, pasted(opened, ["obbbbbbbb", "occcccccc"], style));
    expect(attrsOf(after, "obbbbbbbb")).toMatchObject({ "marker-start": "url(#mc)", "marker-end": "url(#mt)" });
    expect(attrsOf(after, "occcccccc")).not.toHaveProperty("marker-start");
    expect(after).toContain('<marker id="mx"');
  });

  it("dentro un gruppo le punte vanno alle linee che si possono toccare, e non a quelle bloccate né a quelle che non le hanno", () => {
    const opened = following(
      doc(`${TIPS}${LAYER}${LINE("oaaaaaaaa", RED, BOTH)}<g id="ogroup000">${LINE("obbbbbbbb", BLUE, "", 30)}${LINE("occcccccc", BLUE, ' fub:locked="true"', 50)}${RECT("odddddddd")}${PEN("oeeeeeeee")}</g></g>`),
    );
    const after = applied(opened, pasted(opened, ["ogroup000"], copied(opened, "oaaaaaaaa")!));
    expect(attrsOf(after, "obbbbbbbb")).toMatchObject({ "marker-start": "url(#mc)", "marker-end": "url(#mt)" });
    expect(attrsOf(after, "occcccccc")).not.toHaveProperty("marker-end");
    expect(attrsOf(after, "occcccccc")["fub:locked"]).toBe("true");
    expect(attrsOf(after, "odddddddd")).not.toHaveProperty("marker-end");
    expect(markersIn(after).map((marker) => marker.id).sort()).toEqual(["mc", "mt"]);
  });

  it("in un disegno senza risorse la defs nasce una volta sola, e la punta è una per tutte le linee che la usano", () => {
    const source = following(doc(`${DEFS(MARKER("mt", "triangle", "large", "end"))}${LAYER}${LINE("oaaaaaaaa", RED, ' marker-end="url(#mt)"')}</g>`));
    const style = copied(source, "oaaaaaaaa")!;
    const target = following(doc(`${LAYER}${LINE("obbbbbbbb", BLUE, "", 30)}${LINE("occcccccc", GREEN, "", 50)}</g>`));
    const after = applied(target, pasted(target, ["obbbbbbbb", "occcccccc"], style));
    // Due linee con la stessa punta dello stesso colore la dividono. Nasce
    // nel disegno di arrivo: l'id del disegno di partenza non viaggia.
    expect(after.match(/<defs /g)).toHaveLength(1);
    const [first, second] = [used(after, "obbbbbbbb", "end")!, used(after, "occcccccc", "end")!];
    expect(first.kind).toBe("triangle large end");
    expect(first.paint).toBe(RED);
    expect(second.kind).toBe("triangle large end");
    expect(markersIn(after)).toHaveLength(1);
    expect(markersIn(after)[0]!.id).toBe(first.id);
    expect(first.id).toBe(second.id);
    expect(first.id).not.toBe("mt");
    // La punta rossa è del contorno rosso che lo stile dà.
    expect(attrsOf(after, "obbbbbbbb").stroke).toBe(RED);
  });

  it("le risorse private dello stile e le punte stanno nella stessa defs, aperta una volta sola", () => {
    const GRADIENT =
      `<linearGradient id="rgggggggg" fub:role="private" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="50" y2="0"><stop offset="0" stop-color="${RED}"/><stop offset="1" stop-color="${BLUE}"/></linearGradient>`;
    const source = following(doc(`${DEFS(GRADIENT, MARKER("mt", "triangle", "medium", "end", BLUE))}${LAYER}${LINE("oaaaaaaaa", "url(#rgggggggg) #d55e00", ' marker-end="url(#mt)"')}</g>`));
    const style = copied(source, "oaaaaaaaa")!;
    expect([...style.resources.keys()]).toEqual(["rgggggggg"]);
    const target = following(doc(`${LAYER}${LINE("obbbbbbbb", BLUE, "", 30)}</g>`));
    const after = applied(target, pasted(target, ["obbbbbbbb"], style));
    expect(after.match(/<defs /g)).toHaveLength(1);
    expect(after.match(/<linearGradient /g)).toHaveLength(1);
    expect(after.match(/<marker /g)).toHaveLength(1);
    expect(used(after, "obbbbbbbb", "end")!.kind).toBe("triangle medium end");
  });
});

describe("la fusione", () => {
  const GROUP = (id: string, extra = "", inner = ""): string => `<g id="${id}"${extra}>${inner || RECT(`${id}r`)}</g>`;

  it("si legge dallo style: comune, mista, e normale se manca; l'isolamento è dei gruppi e dei collegamenti", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa", ' fill="#0072b2" style="mix-blend-mode: multiply"')}${RECT("obbbbbbbb")}</g>`));
    const seen = look(opened);
    expect(seen.blend).toEqual({ count: 2, value: null });
    expect(seen.isolate).toEqual({ count: 0, value: null });
    const same = open(doc(`${LAYER}${RECT("oaaaaaaaa", ' fill="#0072b2" style="mix-blend-mode: screen"')}${RECT("obbbbbbbb", ' fill="#d55e00" style="mix-blend-mode:screen"')}</g>`));
    expect(look(same).blend).toEqual({ count: 2, value: "screen" });
    const none = open(doc(`${LAYER}${RECT("oaaaaaaaa")}</g>`));
    expect(look(none).blend).toEqual({ count: 1, value: "normal" });
    const groups = open(doc(`${LAYER}${GROUP("ogroup001", ' style="mix-blend-mode: multiply; isolation: isolate"')}${GROUP("ogroup002", ' style="isolation: isolate"')}</g>`));
    expect(look(groups).isolate).toEqual({ count: 2, value: true });
    expect(look(groups).blend).toEqual({ count: 2, value: null });
    const mixed = open(doc(`${LAYER}${GROUP("ogroup001", ' style="isolation: isolate"')}${GROUP("ogroup002")}</g>`));
    expect(look(mixed).isolate).toEqual({ count: 2, value: null });
  });

  it("scrive lo style come lo vuole il formato, e un annulla lo disfa al byte", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa")}</g>`));
    const after = applied(opened, restyled(opened, { blend: "multiply" }));
    expect(after).toContain('stroke-width="2" style="mix-blend-mode: multiply"/>');
    expect(look(opened).blend).toEqual({ count: 1, value: "multiply" });
    // Normale toglie l'attributo, e il motore resta com'era.
    const back = applied(opened, restyled(opened, { blend: "normal" }));
    expect(back).not.toContain("style=");
    expect(look(opened).blend).toEqual({ count: 1, value: "normal" });
    // Cambiare soltanto la fusione rifà lo style con le due metà in ordine.
    const odd = open(doc(`${LAYER}${GROUP("ogroup001", ' style="isolation:isolate;mix-blend-mode:screen"')}</g>`));
    expect(applied(odd, restyled(odd, { blend: "overlay" }))).toContain('style="mix-blend-mode: overlay; isolation: isolate"');
  });

  it("tutti e sedici i modi si scrivono, e si rileggono", () => {
    const modes = ["normal", "darken", "multiply", "color-burn", "lighten", "screen", "color-dodge", "overlay", "soft-light", "hard-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"];
    expect(modes).toHaveLength(16);
    for (const mode of modes) {
      const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa")}</g>`));
      // Normale è ciò che l'oggetto già ha: niente da scrivere.
      if (mode === "normal") {
        expect(restyled(opened, { blend: mode }).ops).toEqual([]);
        continue;
      }
      const after = applied(opened, restyled(opened, { blend: mode }));
      expect(look(open(after)).blend).toEqual({ count: 1, value: mode });
    }
  });

  it("un modo che il formato non ha non si scrive", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa")}</g>`));
    expect(restyled(opened, { blend: "plus-lighter" }).ops).toEqual([]);
    expect(restyled(opened, { blend: "inherit" }).ops).toEqual([]);
  });

  it("isola un gruppo, tiene la fusione che ha, e toglie l'isolamento senza toccare il resto", () => {
    const opened = open(doc(`${LAYER}${GROUP("ogroup001", ' style="mix-blend-mode: multiply"')}</g>`));
    const group = (): ReturnType<typeof look> => lookOf(opened.engine.model!, [opened.reindex().get("ogroup001")!]);
    const on = applied(opened, lookOps(opened.engine.model!, [opened.reindex().get("ogroup001")!], { isolate: true }, estimate, ids(opened)));
    expect(on).toContain('<g id="ogroup001" style="mix-blend-mode: multiply; isolation: isolate">');
    expect(group().isolate).toEqual({ count: 1, value: true });
    expect(group().blend.value).toBe("multiply");
    const off = applied(opened, lookOps(opened.engine.model!, [opened.reindex().get("ogroup001")!], { isolate: false }, estimate, ids(opened)));
    expect(off).toContain('<g id="ogroup001" style="mix-blend-mode: multiply">');
    // Con un gruppo solo isolato, tolta la riga non resta lo style.
    const alone = open(doc(`${LAYER}${GROUP("ogroup001", ' style="isolation: isolate"')}</g>`));
    const bare = applied(alone, lookOps(alone.engine.model!, [alone.reindex().get("ogroup001")!], { isolate: false }, estimate, ids(alone)));
    expect(bare).toContain('<g id="ogroup001">');
  });

  it("l'isolamento di un oggetto che non è un gruppo non c'è e non si scrive", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa")}</g>`));
    expect(restyled(opened, { isolate: true }).ops).toEqual([]);
    expect(look(opened).isolate).toEqual({ count: 0, value: null });
  });

  it("dà la fusione a tutti, ognuno col suo style, in un passo", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa", ' fill="#0072b2" style="mix-blend-mode: screen"')}${GROUP("ogroup001", ' style="isolation: isolate"')}${RECT("occcccccc")}</g>`));
    const after = applied(opened, restyled(opened, { blend: "difference" }));
    expect(after).toContain('<rect id="oaaaaaaaa" x="0" y="0" width="10" height="10" fill="#0072b2" style="mix-blend-mode: difference"/>');
    expect(after).toContain('<g id="ogroup001" style="mix-blend-mode: difference; isolation: isolate">');
    expect(after).toContain('stroke-width="2" style="mix-blend-mode: difference"/></g></svg>');
    expect(look(opened).blend).toEqual({ count: 3, value: "difference" });
  });

  it("l'opacità di opacityOf è quella di lookOf, e la leggono mille oggetti entro un fotogramma", () => {
    const opened = open(doc(`${LAYER}${RECT("oaaaaaaaa", ' fill="#000000" opacity="0.5"')}${RECT("obbbbbbbb", ' fill="#000000" opacity="0.25"')}${RECT("occcccccc")}</g>`));
    const model = opened.engine.model!;
    const units = opened.index.units;
    expect(opacityOf(model, units)).toEqual(look(opened).opacity);
    expect(opacityOf(model, units)).toEqual({ count: 3, value: null });
    expect(opacityOf(model, [])).toEqual({ count: 0, value: null });
    expect(opacityOf(model, [opened.index.get("oaaaaaaaa")!])).toEqual({ count: 1, value: 0.5 });
    const rects = Array.from({ length: 1000 }, (_, i) => RECT(`o${String(i).padStart(8, "0")}`, ' fill="#000000" opacity="0.5"')).join("");
    const many = open(doc(`${LAYER}${rects}</g>`));
    let warm = Infinity;
    for (let run = 0; run < 6; run++) {
      const start = performance.now();
      opacityOf(many.engine.model!, many.index.units);
      warm = Math.min(warm, performance.now() - start);
    }
    expect(opacityOf(many.engine.model!, many.index.units)).toEqual({ count: 1000, value: 0.5 });
    expect(warm).toBeLessThan(16);
  });
});

describe("la fusione e gli effetti nello stile copiato", () => {
  const SHADOW: Shadow = { kind: "shadow", dx: 0, dy: 4, blur: 8, color: "#000000", opacity: 0.25, hidden: false };

  /// Il motore di `body` con le regioni degli effetti che seguono gli oggetti, come lo installa l'editor.
  function sheet(body: string, defs = ""): Opened {
    const opened = open(doc(`${defs}${LAYER}${body}</g>`));
    opened.engine.follow = (model, touched) => followEffects(model, touched, (id) => opened.engine.holder(id), estimate);
    return opened;
  }
  const copied = (opened: Opened, key: string): Style | null => styleOf(opened.engine.model!, opened.reindex().get(key)!);
  const pasted = (opened: Opened, keys: readonly string[], style: Style): Restyled => {
    const index = opened.reindex();
    return styleOps(opened.engine.model!, keys.map((key) => index.get(key)!), style, estimate, ids(opened));
  };
  /// Lo stato degli effetti di `id`, com'è scritto.
  const effectOf = (text: string, id: string): string | null => new RegExp(`<[a-z]+ id="${id}"[^>]*? fub:effect="([^"]*)"`).exec(text)?.[1] ?? null;

  /// Un rettangolo con un'ombra, già col suo filtro, e uno senza nulla.
  function shadowed(): Opened {
    const opened = sheet(RECT("oaaaaaaaa", ' fill="#0072b2" style="mix-blend-mode: multiply"') + RECT("obbbbbbbb") + RECT("occcccccc"));
    const given = pasted(opened, ["oaaaaaaaa"], { ...copied(opened, "oaaaaaaaa")!, effects: [SHADOW] });
    expect(opened.engine.apply(gesture(given.ops)!).outcome).toBe("applied");
    return opened;
  }

  it("copia la fusione e gli effetti di ciò che si vede", () => {
    const opened = shadowed();
    const style = copied(opened, "oaaaaaaaa")!;
    expect(style.blend).toBe("multiply");
    expect(style.effects).toEqual([SHADOW]);
    expect(copied(opened, "obbbbbbbb")!.blend).toBeNull();
    expect(copied(opened, "obbbbbbbb")!.effects).toEqual([]);
  });

  it("incolla fusione ed effetti in un passo solo, e un annulla torna al byte", () => {
    const opened = shadowed();
    const style = copied(opened, "oaaaaaaaa")!;
    const after = applied(opened, pasted(opened, ["obbbbbbbb", "occcccccc"], style));
    for (const id of ["obbbbbbbb", "occcccccc"]) {
      expect(effectOf(after, id)).toBe("shadow 0 4 8 #000000 0.25");
      expect(new RegExp(`<rect id="${id}"[^>]* style="mix-blend-mode: multiply"`).test(after)).toBe(true);
      expect(new RegExp(`<rect id="${id}"[^>]* filter="url\\(#r[0-9a-z]{8}\\)"`).test(after)).toBe(true);
    }
    expect(after.match(/<defs /g)).toHaveLength(1);
    expect(after.match(/<filter /g)).toHaveLength(3);
    // Incollato di nuovo, non c'è niente da cambiare.
    const again = pasted(opened, ["obbbbbbbb"], style);
    expect(again.changed).toBe(0);
    expect(again.ops).toEqual([]);
  });

  it("un stile normale toglie la fusione e gli effetti di chi li ha", () => {
    const opened = shadowed();
    const plain = copied(opened, "obbbbbbbb")!;
    const after = applied(opened, pasted(opened, ["oaaaaaaaa"], plain));
    expect(after).not.toContain("mix-blend-mode");
    expect(after).not.toContain("fub:effect");
    expect(after).not.toContain("<filter");
  });

  it("un gruppo isolato tiene l'isolamento quando prende un'altra fusione", () => {
    const opened = sheet(`<g id="ogroup001" style="mix-blend-mode: screen; isolation: isolate">${RECT("oaaaaaaaa")}</g>${RECT("obbbbbbbb", ' fill="#0072b2" style="mix-blend-mode: multiply"')}`);
    const after = applied(opened, pasted(opened, ["ogroup001"], copied(opened, "obbbbbbbb")!));
    expect(after).toContain('<g id="ogroup001" style="mix-blend-mode: multiply; isolation: isolate">');
  });

  it("chi ha un ritaglio prende la fusione ma non gli effetti, e lo stile dice gli effetti degli altri", () => {
    const clip = '<clipPath id="rclip0000"><rect x="0" y="0" width="5" height="5"/></clipPath>';
    const opened = sheet(RECT("oaaaaaaaa", ' fill="#0072b2" style="mix-blend-mode: multiply"') + RECT("obbbbbbbb", ' clip-path="url(#rclip0000)"'), `<defs id="fub-defs">${clip}</defs>`);
    const style: Style = { ...copied(opened, "oaaaaaaaa")!, effects: [SHADOW] };
    const after = applied(opened, pasted(opened, ["obbbbbbbb"], style));
    expect(effectOf(after, "obbbbbbbb")).toBeNull();
    expect(after).toMatch(/<rect id="obbbbbbbb"[^>]* style="mix-blend-mode: multiply"/);
  });

  it("senza effetti nello stile, il filtro di un altro programma resta, e quello di FubDraw se ne va", () => {
    const other = '<filter id="x" x="0" y="0" width="200" height="200" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="2"/></filter>';
    const opened = sheet(RECT("oaaaaaaaa", ' filter="url(#x)"') + RECT("obbbbbbbb") + RECT("occcccccc"), `<defs id="fub-defs">${other}</defs>`);
    // Il filtro dell'altro programma resta dov'è: lo stile di chi lo ha non cambia niente.
    const own = copied(opened, "oaaaaaaaa")!;
    expect(own.effects).toBeNull();
    expect(pasted(opened, ["oaaaaaaaa"], { ...own, effects: [] }).ops).toEqual([]);
    // Un'ombra a "obbbbbbbb", poi uno stile senza effetti su di lui: se ne va.
    const plain = { ...copied(opened, "obbbbbbbb")!, effects: [] as readonly Effect[] };
    const give = pasted(opened, ["obbbbbbbb"], { ...plain, effects: [SHADOW] });
    expect(opened.engine.apply(gesture(give.ops)!).outcome).toBe("applied");
    const after = applied(opened, pasted(opened, ["obbbbbbbb"], plain));
    expect(after).not.toContain("fub:effect");
    expect(after).toContain('<filter id="x"');
  });

  it("un oggetto senza id che prende gli effetti e la fusione ne riceve uno solo", () => {
    const opened = sheet('<rect x="0" y="0" width="10" height="10" fill="#0072b2"/>' + RECT("oaaaaaaaa", ' fill="#0072b2" style="mix-blend-mode: screen"'));
    const target = opened.reindex().units.find((unit) => unit.key !== "oaaaaaaaa")!;
    const style: Style = { ...copied(opened, "oaaaaaaaa")!, effects: [SHADOW] };
    const done = styleOps(opened.engine.model!, [target], style, estimate, ids(opened));
    const after = applied(opened, done);
    const rect = /<rect id="([^"]+)"[^>]* style="mix-blend-mode: screen"/.exec(after);
    expect(rect).not.toBeNull();
    expect(effectOf(after, rect![1]!)).toBe("shadow 0 4 8 #000000 0.25");
    expect(after.match(new RegExp(` id="${rect![1]}"`, "g"))).toHaveLength(1);
    expect(done.keys).toEqual([rect![1]!]);
  });

  it("un testo senza id, che si riscrive e prende gli effetti, tiene il suo id e il suo posto", () => {
    const text = '<text x="10" y="40" fill="#000000" font-family="Inter, sans-serif" font-size="32"><tspan x="10" dy="0">Uno</tspan><tspan x="10" dy="40">Due</tspan></text>';
    const opened = sheet(RECT("oaaaaaaaa", ' fill="#0072b2" style="mix-blend-mode: screen"') + text + RECT("obbbbbbbb"));
    const target = opened.reindex().units.find((unit) => !["oaaaaaaaa", "obbbbbbbb"].includes(unit.key))!;
    const font = { family: "Inter, sans-serif", size: 16, weight: "normal", style: "normal", spacing: 0, underline: false, strike: false, leading: null };
    const style: Style = { ...copied(opened, "oaaaaaaaa")!, effects: [SHADOW], font };
    const done = styleOps(opened.engine.model!, [target], style, estimate, ids(opened));
    const after = applied(opened, done);
    expect(done.keys).toHaveLength(1);
    const id = done.keys[0]!;
    expect(after.match(new RegExp(` id="${id}"`, "g"))).toHaveLength(1);
    expect(after.indexOf('id="oaaaaaaaa"')).toBeLessThan(after.indexOf(`id="${id}"`));
    expect(after.indexOf(`id="${id}"`)).toBeLessThan(after.indexOf('id="obbbbbbbb"'));
    expect(effectOf(after, id)).toBe("shadow 0 4 8 #000000 0.25");
    // Le righe si sono riscritte sul corpo nuovo.
    expect(after).toContain(`dy="20"`);
    expect(after.match(/<defs /g)).toHaveLength(1);
  });

  it("incolla su mille oggetti con gli effetti entro un tempo ragionevole", () => {
    const rects = Array.from({ length: 1000 }, (_, i) => RECT(`o${String(i).padStart(8, "0")}`)).join("");
    const opened = sheet(rects);
    const style: Style = { ...copied(opened, "o00000000")!, blend: "multiply", effects: [SHADOW] };
    const start = performance.now();
    const done = styleOps(opened.engine.model!, opened.index.units, style, estimate, ids(opened));
    const took = performance.now() - start;
    expect(done.changed).toBe(1000);
    expect(done.ops.filter((op) => op.op === "add" && "elem" in op && op.elem.tag === "filter")).toHaveLength(1000);
    expect(took).toBeLessThan(2000);
  });
});
