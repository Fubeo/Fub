// «Oggetto in tracciato»: ogni forma diventa il tracciato con cui SVG 2 la
// definisce, con lo stesso id, allo stesso posto, e ciò che si vede resta.
// Le operazioni il motore le accetta così come sono, e un annulla le disfa
// al byte.

import { describe, expect, it } from "vitest";
import type { Bounds } from "../scene/geometry";
import { doc } from "../scene/test-support";
import { gesture, NewIds } from "./edit";
import type { SceneIndex } from "./hit";
import { LAYER, open, type Opened } from "./test-support";
import { pathOps, type Traced } from "./topath";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

const STROKE = 'fill="none" stroke="#000000" stroke-width="2"';
const INKSCAPE = "http://www.inkscape.org/namespaces/inkscape";

/// Il comando su `keys`, o su tutti gli oggetti del disegno.
function traced(opened: Opened, keys?: readonly string[]): Traced {
  const units = keys === undefined ? opened.index.units : keys.map((key) => opened.index.get(key)!);
  return pathOps(opened.engine.model!, units, ids(opened));
}

/// Scrive `change`, verifica che un annulla riporti il testo di prima, e
/// torna il testo di dopo.
function written(opened: Opened, change: Traced): string {
  const before = opened.engine.text;
  const outcome = opened.engine.apply(gesture(change.ops)!);
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  const after = opened.engine.text;
  expect(opened.engine.undo(outcome.undo).outcome).toBe("applied");
  expect(opened.engine.text).toBe(before);
  expect(opened.engine.apply(gesture(change.ops)!).outcome).toBe("applied");
  return after;
}

/// Verifica che ogni oggetto stia dov'era, nello stesso ordine, contorno
/// compreso, al centesimo.
function sameLook(before: SceneIndex, after: SceneIndex): void {
  const near = (a: Bounds | null, b: Bounds | null): void => {
    expect(a === null).toBe(b === null);
    if (a === null || b === null) return;
    [...a.min, ...a.max].forEach((value, at) => expect(Math.abs(value - [...b.min, ...b.max][at]!)).toBeLessThanOrEqual(0.01));
  };
  expect(after.units).toHaveLength(before.units.length);
  after.units.forEach((unit, at) => {
    const was = before.units[at]!;
    near(unit.geometry, was.geometry);
    near(unit.bounds, was.bounds);
  });
}

/// Applica a `keys`, o a tutto, e scrive, verificando che ciò che si vede
/// resti.
function trace(source: string, keys?: readonly string[]): { text: string; change: Traced } {
  const opened = open(doc(`${LAYER}${source}</g>`));
  const change = traced(opened, keys);
  const text = written(opened, change);
  sameLook(opened.index, opened.reindex());
  return { text, change };
}

describe("«Oggetto in tracciato» nelle forme", () => {
  it("fa di un rettangolo il suo tracciato, con lo stesso id, gli stessi attributi e lo stesso posto", () => {
    const { text, change } = trace(
      `\n<rect id="a" x="1" y="2" width="10" height="5"/>\n<rect id="r" x="0" y="0" width="10" height="5" ${STROKE} transform="rotate(30)"/>\n<rect id="b" x="1" y="2" width="10" height="5"/>\n`,
      ["r"],
    );
    expect(text).toContain(
      `\n<rect id="a" x="1" y="2" width="10" height="5"/>\n<path id="r" d="M0 0 L10 0 L10 5 L0 5 Z" ${STROKE} transform="rotate(30)"/>\n<rect id="b" x="1" y="2" width="10" height="5"/>\n</g>`,
    );
    expect(change).toMatchObject({ changed: 1, refused: 0, keys: ["r"] });
  });

  it("parte dall'angolo arrotondato in alto a sinistra, e salta i lati che gli angoli consumano", () => {
    expect(trace(`<rect id="r" x="0" y="0" width="20" height="10" rx="2" ${STROKE} stroke-dasharray="4 3"/>`).text).toContain(
      'd="M2 0 L18 0 A2 2 0 0 1 20 2 L20 8 A2 2 0 0 1 18 10 L2 10 A2 2 0 0 1 0 8 L0 2 A2 2 0 0 1 2 0 Z"',
    );
    // Un raggio solo vale per tutti e due, e un raggio oltre metà lato si
    // riduce come in SVG.
    expect(trace(`<rect id="r" x="0" y="0" width="20" height="10" ry="8" ${STROKE}/>`).text).toContain(
      'd="M8 0 L12 0 A8 5 0 0 1 20 5 A8 5 0 0 1 12 10 L8 10 A8 5 0 0 1 0 5 A8 5 0 0 1 8 0 Z"',
    );
    // Un raggio nullo lascia gli angoli vivi.
    expect(trace(`<rect id="r" x="0" y="0" width="20" height="10" rx="3" ry="0" ${STROKE}/>`).text).toContain('d="M0 0 L20 0 L20 10 L0 10 Z"');
  });

  it("fa di ellissi e cerchi quattro archi, da destra in senso orario", () => {
    expect(trace(`<ellipse id="e" cx="10" cy="5" rx="4" ry="2" ${STROKE}/>`).text).toContain(
      `<path id="e" d="M14 5 A4 2 0 0 1 10 7 A4 2 0 0 1 6 5 A4 2 0 0 1 10 3 A4 2 0 0 1 14 5 Z" ${STROKE}/>`,
    );
    expect(trace(`<circle id="c" cx="0" cy="0" r="3" fill="#ff0000"/>`).text).toContain(
      '<path id="c" d="M3 0 A3 3 0 0 1 0 3 A3 3 0 0 1 -3 0 A3 3 0 0 1 0 -3 A3 3 0 0 1 3 0 Z" fill="#ff0000"/>',
    );
  });

  it("fa di linee, spezzate e poligoni i loro segmenti; solo il poligono si chiude", () => {
    const { text } = trace(
      `<line id="l" x1="0" y1="0" x2="10" y2="5" ${STROKE}/><polyline id="p" points="0,0 5,5 10,0" ${STROKE}/><polygon id="g" points="0 0 5 5 10 0" fill="#00ff00"/>`,
    );
    expect(text).toContain(`<path id="l" d="M0 0 L10 5" ${STROKE}/>`);
    expect(text).toContain(`<path id="p" d="M0 0 L5 5 L10 0" ${STROKE}/>`);
    expect(text).toContain('<path id="g" d="M0 0 L5 5 L10 0 Z" fill="#00ff00"/>');
  });

  it("legge le unità assolute e scrive i numeri del formato", () => {
    expect(trace(`<rect id="r" x="1in" y="0" width="0.5in" height="10.126"/>`).text).toContain('d="M96 0 L144 0 L144 10.13 L96 10.13 Z"');
    // Un lato consumato dagli angoli si riconosce anche quando il calcolo
    // sbaglia l'ultima cifra: 0,1 + 0,2 − 0,1 non fa 0,2.
    expect(trace(`<rect id="r" x="0.1" y="0" width="0.2" height="1" rx="0.1"/>`).text).toContain(
      'd="M0.2 0 A0.1 0.1 0 0 1 0.3 0.1 L0.3 0.9 A0.1 0.1 0 0 1 0.2 1 A0.1 0.1 0 0 1 0.1 0.9 L0.1 0.1 A0.1 0.1 0 0 1 0.2 0 Z"',
    );
    // Un tracciato con numeri oltre quelli del formato non si scrive.
    const huge = open(doc(`${LAYER}<rect id="r" x="3e38" y="0" width="3e38" height="1"/></g>`));
    expect(traced(huge)).toEqual({ ops: [], keys: ["r"], changed: 0, refused: 1 });
  });

  it("tiene il titolo, gli attributi di altri programmi e lo stile", () => {
    const source = doc(`${LAYER}<rect id="r" inkscape:label="Porta" x="0" y="0" width="4" height="4" fill="#0000ff" opacity="0.5"><title>Porta</title></rect></g>`).replace(
      "<svg ",
      `<svg xmlns:inkscape="${INKSCAPE}" `,
    );
    const opened = open(source);
    const text = written(opened, traced(opened));
    expect(text).toMatch(/<path id="r" [^>]*d="M0 0 L4 0 L4 4 L0 4 Z"[^>]*fill="#0000ff"[^>]*>\s*<title>Porta<\/title>\s*<\/path>/);
    expect(text).toMatch(/<path [^>]*inkscape:label="Porta"/);
    expect(text).toMatch(/<path [^>]*opacity="0.5"/);
    // Un prefisso dichiarato sull'elemento stesso un'operazione non lo sa
    // scrivere: l'elemento resta com'è.
    const local = open(doc(`${LAYER}<rect xmlns:inkscape="${INKSCAPE}" id="r" inkscape:label="Porta" x="0" y="0" width="4" height="4"/></g>`));
    expect(traced(local)).toEqual({ ops: [], keys: ["r"], changed: 0, refused: 1 });
  });
});

describe("«Oggetto in tracciato» nelle forme di FubDraw", () => {
  it("toglie a una freccia la sua geometria, e il `d` resta", () => {
    const d = "M0 0 L20 0 M12.2 -4.5 L20 0 L12.2 4.5";
    const { text, change } = trace(
      `<path id="f" fub:shape="arrow" fub:geom="0 0 20 0" d="${d}" fill="none" stroke="#000000" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
    expect(text).toContain(`<path id="f" d="${d}" fill="none" stroke="#000000" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>`);
    expect(change).toMatchObject({ changed: 1, refused: 0 });
  });

  it("toglie a un poligono regolare e a una stella i loro parametri, e il `d` resta", () => {
    const d = "M-7.07 7.07 L-7.07 -7.07 L7.07 -7.07 L7.07 7.07 Z";
    const polygon = trace(`<path id="p" fub:shape="polygon" fub:geom="0 0 10 4 0 0" d="${d}" fill="#0000ff"/>`);
    expect(polygon.text).toContain(`<path id="p" d="${d}" fill="#0000ff"/>`);
    expect(polygon.change).toMatchObject({ changed: 1, refused: 0 });
    const star = "M0 -10 L2.94 -4.05 L9.51 -3.09 L4.76 1.55 L5.88 8.09 L0 5 L-5.88 8.09 L-4.76 1.55 L-9.51 -3.09 L-2.94 -4.05 Z";
    expect(trace(`<path id="s" fub:shape="star" fub:geom="0 0 10 5 0.5 0 0" d="${star}" fill="#0000ff"/>`).text).toContain(
      `<path id="s" d="${star}" fill="#0000ff"/>`,
    );
  });

  it("toglie a un tratto l'inchiostro, il pennello, lo strumento e l'ora", () => {
    const { text, change } = trace(
      '<path id="s" fub:tool="highlighter" fub:at="2026-10-01T09:20:31.250Z" fub:brush="pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0" d="M0 0 L4 0 L4 4 Z" fill="#ffff00" fill-opacity="0.4" fub:ink="1 s100 cxypt 0,0,128,0 25,-3,2,8"/>',
    );
    expect(text).toContain('<path id="s" d="M0 0 L4 0 L4 4 Z" fill="#ffff00" fill-opacity="0.4"/>');
    expect(change).toMatchObject({ changed: 1, refused: 0 });
    // L'ora è facoltativa: se manca, non si toglie.
    const opened = open(doc(`${LAYER}<path id="s" fub:tool="pen" d="M0 0 L4 0 L4 4 Z" fill="#000000" fub:ink="1 s100 cxypt 0,0,128,0 25,-3,2,8"/></g>`));
    expect(traced(opened).ops).toEqual([{ op: "set", id: "s", attrs: { "fub:tool": null, "fub:ink": null } }]);
  });
});

describe("«Oggetto in tracciato» nei gruppi e fra le parti estranee", () => {
  it("passa il comando alle parti di un gruppo e di un collegamento", () => {
    const { text, change } = trace(
      `<g id="g"><title>Casa</title><desc>Una casa</desc><rect id="r" x="0" y="0" width="4" height="4"/><text id="t" x="0" y="20"><tspan x="0" dy="0">Ciao</tspan></text></g><a id="k" href="nota.md"><circle id="c" cx="0" cy="0" r="1"/></a>`,
    );
    expect(text).toContain('<path id="r" d="M0 0 L4 0 L4 4 L0 4 Z"/>');
    expect(text).toContain('<path id="c" d="M1 0 A1 1 0 0 1 0 1 A1 1 0 0 1 -1 0 A1 1 0 0 1 0 -1 A1 1 0 0 1 1 0 Z"/>');
    expect(change).toMatchObject({ changed: 2, refused: 1, keys: ["g", "k"] });
  });

  it("nomina con un id ciò che cambia e il gruppo che lo riceve, e tiene il posto accanto a una parte estranea", () => {
    const opened = open(doc(`${LAYER}<g><use href="#x"/><rect x="0" y="0" width="4" height="4"/><use href="#y"/></g></g>`));
    const change = traced(opened);
    const text = written(opened, change);
    expect(text).toMatch(/<g id="o[a-z0-9]{8}">\s*<use href="#x"\/>\s*<path id="o[a-z0-9]{8}" d="M0 0 L4 0 L4 4 L0 4 Z"\/>\s*<use href="#y"\/>\s*<\/g>/);
    expect(change.keys).toEqual([/<g id="(o[a-z0-9]{8})"/.exec(text)![1]]);
    sameLook(opened.index, opened.reindex());
  });

  it("dà a un oggetto senza id quello che resta dopo", () => {
    const opened = open(doc(`${LAYER}<line x1="0" y1="0" x2="4" y2="4" ${STROKE}/></g>`));
    const change = traced(opened);
    const text = written(opened, change);
    const id = /<path id="(o[a-z0-9]{8})" d="M0 0 L4 4"/.exec(text)![1]!;
    expect(change.keys).toEqual([id]);
    expect(opened.reindex().get(id)).toBeDefined();
  });
});

describe("«Oggetto in tracciato» quando non c'è niente da fare", () => {
  it("lascia un tracciato com'è", () => {
    const opened = open(doc(`${LAYER}<path id="p" d="M0 0 L4 4" ${STROKE}/></g>`));
    expect(traced(opened)).toEqual({ ops: [], keys: ["p"], changed: 0, refused: 0 });
  });

  it("non fa tracciati di testi, immagini e forme che non si disegnano", () => {
    const opened = open(
      doc(
        `${LAYER}<text id="t" x="0" y="20"><tspan x="0" dy="0">Ciao</tspan></text><image id="i" x="0" y="0" width="4" height="4" href="data:image/png;base64,iVBORw0KGgo="/><rect id="r" x="0" y="0" width="0" height="4"/><ellipse id="e" cx="0" cy="0" rx="0" ry="2"/><polyline id="p" points=""/></g>`,
      ),
    );
    expect(traced(opened)).toEqual({ ops: [], keys: ["t", "i", "r", "e", "p"], changed: 0, refused: 5 });
  });

  it("salta un blocco estraneo in un gruppo, che non è un oggetto e non si conta", () => {
    const foreign = '<rect id="f" x="0" y="0" width="4" height="4"><x:note xmlns:x="urn:x">memo</x:note></rect>';
    const { text, change } = trace(`<g id="g">${foreign}<rect id="r" x="5" y="0" width="4" height="4"/></g>`);
    expect(change).toMatchObject({ changed: 1, refused: 0, keys: ["g"] });
    expect(text).toContain(foreign);
    expect(text).toContain('<path id="r" d="M5 0 L9 0 L9 4 L5 4 Z"/>');
  });
});
