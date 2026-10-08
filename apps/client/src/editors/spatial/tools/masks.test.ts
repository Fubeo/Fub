// Le maschere: il ritaglio con un oggetto, la maschera d'opacità e il
// rilascio di entrambi. Le operazioni le accetta il motore così come sono,
// un annulla le disfa al byte, e ciò che si vede resta dove era.

import { describe, expect, it } from "vitest";
import { parseBrush } from "../ink/brush";
import { decodeInk, inkToQuantized } from "../ink/codec";
import { pf1 } from "../ink/pf1";
import type { Bounds } from "../scene/geometry";
import { doc } from "../scene/test-support";
import type { Op } from "../scene/ops";
import { gesture, NewIds } from "./edit";
import { groupOps, type Arranged } from "./arrange";
import { clipMaskOps, opacityMaskOps, releasable, releaseOps, releaseRefusal, type MaskRefusal } from "./masks";
import { LAYER, open, type Opened } from "./test-support";
import { applied } from "./tip-support";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

const HREF = "data:image/png;base64,AA==";
const INK = "1 s100 cxypt 12050,3020,128,0 25,-3,2,8 31,-5,0,8";
const BRUSH = "pf1 size=4 thinning=0.5 smoothing=0.5 streamline=0.5 taperStart=0 taperEnd=0 capStart=1 capEnd=1 sim=0";

/// Un quadrato di 50 con id `id` in `x y`.
const RECT = (id: string, x: number, y = 0, extra = ""): string => `<rect id="${id}" x="${x}" y="${y}" width="50" height="50"${extra}/>`;

const IMAGE = (id = "i", extra = ""): string => `<image id="${id}" x="0" y="0" width="100" height="100" href="${HREF}"${extra}/>`;

const DEFS = (...inner: string[]): string => `<defs id="fub-defs">${inner.join("")}</defs>`;

const GRADIENT = '<linearGradient id="g1" fub:role="private" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="#ffffff"/></linearGradient>';

const PATTERN = '<pattern id="p1" fub:role="private" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="#d55e00"/></pattern>';

const MARKER = '<marker id="mk" fub:role="shared" fub:marker="triangle medium end" refX="3.44" refY="3" markerWidth="5.34" markerHeight="6" orient="auto"><path d="M4.84 3 L0.51 5.5 L0.51 0.5 Z" fill="#cc0000"/></marker>';

/// Il ritaglio privato di un cerchio, con id `id`.
const CIRCLE_CLIP = (id: string, extra = ""): string => `<clipPath id="${id}" fub:role="private"><circle cx="50" cy="50" r="30" fill="#ff0000"${extra}/></clipPath>`;

const NEW_ID = /\b([or])[0-9a-z]{8}\b/g;

/// Il testo con gli id nuovi (`r…` e `o…` di nove caratteri) chiamati R1, R2…
/// e O1, O2…, nell'ordine in cui compaiono.
function named(text: string): string {
  const seen = new Map<string, string>();
  const count = { o: 0, r: 0 };
  return text.replace(NEW_ID, (id, kind: "o" | "r") => {
    let name = seen.get(id);
    if (name === undefined) {
      name = `${kind.toUpperCase()}${++count[kind]}`;
      seen.set(id, name);
    }
    return name;
  });
}

/// Il disegno senza la radice e senza gli spazi fra gli elementi, con gli id
/// nuovi con un nome.
const flat = (opened: Opened): string => named(opened.engine.text).replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/>\s+</g, "><").trim();

/// Gli oggetti con le chiavi `keys`, nell'ordine dato.
const pick = (opened: Opened, ...keys: string[]) => keys.map((key) => opened.index.get(key)!);

/// Applica `result`, che dev'essere un comando, e torna il comando.
function run(opened: Opened, result: Arranged | MaskRefusal | null): Arranged {
  if (result === null || typeof result === "string") throw new Error(`rifiutato: ${String(result)}`);
  applied(opened, [...result.ops]);
  return result;
}

const clip = (opened: Opened, ...keys: string[]): Arranged => run(opened, clipMaskOps(opened.engine.model!, pick(opened, ...keys), ids(opened)));
const fade = (opened: Opened, ...keys: string[]): Arranged => run(opened, opacityMaskOps(opened.engine.model!, pick(opened, ...keys), ids(opened)));

/// Rilascia `keys` (o tutti gli oggetti che si rilasciano, se mancano).
function release(opened: Opened, ...keys: string[]): Arranged {
  const units = keys.length === 0 ? opened.reindex().units : keys.map((key) => opened.reindex().get(key)!);
  return run(opened, releaseOps(opened.engine.model!, units, ids(opened)));
}

/// Perché `result` non si crea, o "fatto" se si crea.
const outcome = (result: Arranged | MaskRefusal | null): string => (result === null ? "niente" : typeof result === "string" ? result : "fatto");

/// L'id del primo elemento `tag` del disegno ora.
const idOf = (opened: Opened, tag: string): string => {
  const found = new RegExp(`<${tag} id="([^"]+)"`).exec(opened.engine.text);
  if (found === null) throw new Error(`nessun ${tag}`);
  return found[1]!;
};

/// Il riquadro di `key` ora.
const boundsOf = (opened: Opened, key: string): Bounds => {
  const found = opened.reindex().get(key)?.bounds ?? null;
  if (found === null) throw new Error(`${key} non ha un riquadro`);
  return found;
};

/// Vero se i due riquadri coincidono fino a `digits` decimali: le matrici si
/// scrivono con quattro, e una rotazione perde qualcosa.
const close = (actual: Bounds, expected: Bounds, digits = 6): void => {
  [...actual.min, ...actual.max].forEach((value, at) => expect(value).toBeCloseTo([...expected.min, ...expected.max][at]!, digits));
};

/// Il tratto a penna di prova: `d` ridisegna l'inchiostro.
const PEN_D = pf1(inkToQuantized(decodeInk(INK)), parseBrush(BRUSH));
const PEN = (id = "s", extra = ""): string => `<path id="${id}" fub:tool="pen" fub:brush="${BRUSH}" fill="#000000" fub:ink="${INK}" d="${PEN_D}"${extra}/>`;
/// Lo stesso, come lo scrive il motore (e come finisce dentro una risorsa).
const PEN_CONTENT = (id: string): string => `<path${id === "" ? "" : ` id="${id}"`} fub:tool="pen" fub:brush="${BRUSH}" d="${PEN_D}" fill="#000000" fub:ink="${INK}"/>`;

describe("crea maschera di ritaglio", () => {
  it("da un cerchio sopra due oggetti di livelli diversi: la forma diventa il ritaglio del gruppo, nel suo spazio", () => {
    // Il cerchio è in un livello spostato di 100: nello spazio del gruppo, in
    // quello del primo livello, porta quella trasformazione.
    const opened = open(doc(`${LAYER}${RECT("a", 0, 0, ' fill="#cc0000"')}${RECT("b", 60, 0, ' fill="#00cc00"')}</g><g id="l2" fub:layer="Due" transform="translate(100 0)"><circle id="c" cx="30" cy="25" r="20" fill="#0000cc"/></g>`));
    const before = boundsOf(opened, "c");
    const result = clip(opened, "a", "b", "c");
    expect(result.keys).toHaveLength(1);
    expect(flat(opened)).toBe(
      '<defs id="fub-defs"><clipPath id="R1" fub:role="private"><circle cx="30" cy="25" r="20" fill="#0000cc" transform="matrix(1 0 0 1 100 0)"/></clipPath></defs>' +
        '<g id="l1" fub:layer="Livello 1"><g id="O1" clip-path="url(#R1)"><rect id="a" x="0" y="0" width="50" height="50" fill="#cc0000"/><rect id="b" x="60" y="0" width="50" height="50" fill="#00cc00"/></g></g>' +
        '<g id="l2" fub:layer="Due" transform="translate(100 0)"></g>',
    );
    expect(opened.engine.holder(result.keys[0]!)).not.toBeNull();
    expect(opened.engine.holder("c")).toBeNull();
    // Rilasciato, il cerchio è dov'era nel disegno.
    const released = release(opened, result.keys[0]!);
    close(boundsOf(opened, released.keys[0]!), before);
  });

  it("le operazioni vanno nell'ordine che il motore vuole: prima la risorsa, poi il gruppo, poi la forma che se ne va", () => {
    const opened = open(doc(`${LAYER}${RECT("a", 0)}${RECT("b", 60)}<circle id="c" cx="30" cy="25" r="20"/></g>`));
    const result = clipMaskOps(opened.engine.model!, pick(opened, "a", "b", "c"), ids(opened)) as Arranged;
    const names = result.ops.map((op) => (op.op === "add" && "elem" in op ? `add ${op.elem.tag}` : op.op === "remove" ? `remove ${String(op.target)}` : op.op));
    expect(names.slice(0, 3)).toEqual(["add defs", "add clipPath", "add g"]);
    expect(names[names.length - 1]).toBe("remove c");
    expect(result.ops.find((op) => op.op === "add" && "elem" in op && op.elem.tag === "clipPath")).toMatchObject({ op: "add", parent: "fub-defs", pos: { last: true } });
  });

  it("con la defs di FubDraw già nel disegno, il ritaglio ci va e le sfumature restano a chi le usa", () => {
    const opened = open(doc(`${DEFS(GRADIENT)}${LAYER}${RECT("a", 0, 0, ' fill="url(#g1)"')}<circle id="c" cx="30" cy="25" r="20" fill="url(#g1)"/></g>`));
    clip(opened, "a", "c");
    const text = flat(opened);
    expect(text).toContain('<linearGradient id="g1" fub:role="private" x1="0"');
    expect(text).toMatch(/<clipPath id="R1" fub:role="private"><circle cx="30" cy="25" r="20" fill="url\(#g1\)"\/><\/clipPath>/);
    expect(text.match(/<defs /g)).toHaveLength(1);
  });

  it("da un testo: il testo entra nel ritaglio con le sue righe, senza id", () => {
    const opened = open(doc(`${LAYER}${RECT("a", 0)}${RECT("b", 60)}<text id="t" x="10" y="40" font-size="30" fill="#aa0000"><tspan x="10" dy="0">Ciao</tspan></text></g>`));
    const before = boundsOf(opened, "t");
    const result = clip(opened, "a", "b", "t");
    expect(flat(opened)).toBe(
      '<defs id="fub-defs"><clipPath id="R1" fub:role="private"><text x="10" y="40" fill="#aa0000" font-size="30"><tspan x="10" dy="0">Ciao</tspan></text></clipPath></defs>' +
        '<g id="l1" fub:layer="Livello 1"><g id="O1" clip-path="url(#R1)"><rect id="a" x="0" y="0" width="50" height="50"/><rect id="b" x="60" y="0" width="50" height="50"/></g></g>',
    );
    const released = release(opened, result.keys[0]!);
    expect(flat(opened)).toBe(
      '<g id="l1" fub:layer="Livello 1"><rect id="a" x="0" y="0" width="50" height="50"/><rect id="b" x="60" y="0" width="50" height="50"/>' +
        '<text id="O1" x="10" y="40" fill="#aa0000" font-size="30"><tspan x="10" dy="0">Ciao</tspan></text></g>',
    );
    close(boundsOf(opened, released.keys[0]!), before);
  });

  it("da un tratto a penna: l'inchiostro e il pennello vanno con lui, e tornano uguali", () => {
    const opened = open(doc(`${LAYER}${RECT("a", 0)}${RECT("b", 60)}${PEN()}</g>`));
    const result = clip(opened, "a", "b", "s");
    expect(flat(opened)).toContain(`<clipPath id="R1" fub:role="private">${PEN_CONTENT("")}</clipPath>`);
    release(opened, result.keys[0]!);
    expect(flat(opened)).toContain(PEN_CONTENT("O1"));
    expect(flat(opened)).not.toContain("clipPath");
  });

  it("scrive nel contenuto lo stile che la forma ereditava, senza toccare ciò che scrive da sé", () => {
    const body = `${LAYER}${RECT("a", 0)}<g id="gg" fill="#ff00ff" stroke="#00ffff" stroke-width="3">${RECT("d", 200, 0, ' fill="#123456"')}<circle id="c" cx="30" cy="25" r="20" stroke-width="6"/></g></g>`;
    const opened = open(doc(body));
    clip(opened, "a", "c");
    // Il cerchio scrive la sua larghezza: l'altro stile viene dal gruppo.
    expect(flat(opened)).toContain('<clipPath id="R1" fub:role="private"><circle cx="30" cy="25" r="20" fill="#ff00ff" stroke="#00ffff" stroke-width="6"/></clipPath>');
  });

  it("rilasciata, la forma torna con lo stesso aspetto e il gruppo si scioglie", () => {
    const opened = open(doc(`${LAYER}${RECT("a", 0)}<g id="gg" fill="#ff00ff" stroke="#00ffff" stroke-width="3">${RECT("d", 200)}<circle id="c" cx="30" cy="25" r="20"/></g></g>`));
    const result = clip(opened, "a", "c");
    expect(flat(opened)).toBe(
      '<defs id="fub-defs"><clipPath id="R1" fub:role="private"><circle cx="30" cy="25" r="20" fill="#ff00ff" stroke="#00ffff" stroke-width="3"/></clipPath></defs>' +
        '<g id="l1" fub:layer="Livello 1"><g id="O1" clip-path="url(#R1)"><rect id="a" x="0" y="0" width="50" height="50"/></g>' +
        '<g id="gg" fill="#ff00ff" stroke="#00ffff" stroke-width="3"><rect id="d" x="200" y="0" width="50" height="50"/></g></g>',
    );
    const back = release(opened, result.keys[0]!);
    expect(flat(opened)).toBe(
      '<g id="l1" fub:layer="Livello 1"><rect id="a" x="0" y="0" width="50" height="50"/>' +
        '<circle id="O1" cx="30" cy="25" r="20" fill="#ff00ff" stroke="#00ffff" stroke-width="3"/>' +
        '<g id="gg" fill="#ff00ff" stroke="#00ffff" stroke-width="3"><rect id="d" x="200" y="0" width="50" height="50"/></g></g>',
    );
    // Il gruppo non c'è più: restano il cerchio e il quadrato, e il motore non ha più risorse.
    expect(back.keys).toHaveLength(2);
    expect(back.keys).toContain("a");
    expect(opened.engine.text).not.toContain("fub-defs");
  });

  it("un motivo diventa il suo ripiego, o niente, e le punte se ne vanno", () => {
    const top = '<circle id="c" cx="30" cy="25" r="20" fill="url(#p1) #00ff00" stroke="url(#p1)" stroke-width="2"/>';
    const opened = open(doc(`${DEFS(PATTERN, MARKER)}${LAYER}${RECT("a", 0, 0, ' fill="url(#p1)"')}<path id="l" d="M0 0 L5 5" fill="none" stroke="#000000" marker-end="url(#mk)"/>${top}</g>`));
    clip(opened, "a", "c");
    expect(flat(opened)).toContain('<clipPath id="R1" fub:role="private"><circle cx="30" cy="25" r="20" fill="#00ff00" stroke="none" stroke-width="2"/></clipPath>');
    // Chi usava il motivo lo usa ancora.
    expect(flat(opened)).toContain('<pattern id="p1" fub:role="private"');
  });

  it("le punte di una linea spezzata o di un tracciato non entrano nel ritaglio", () => {
    const top = '<path id="p" d="M10 10 L90 90 L10 90 Z" fill="#336699" stroke="#000000" stroke-width="2" marker-end="url(#mk)" marker-start="url(#mk)"/>';
    const opened = open(doc(`${DEFS(MARKER)}${LAYER}${RECT("a", 0)}<path id="l" d="M0 0 L5 5" fill="none" stroke="#000000" marker-end="url(#mk)"/>${top}</g>`));
    clip(opened, "a", "p");
    expect(flat(opened)).toContain('<clipPath id="R1" fub:role="private"><path d="M10 10 L90 90 L10 90 Z" fill="#336699" stroke="#000000" stroke-width="2"/></clipPath>');
  });

  it("la trasformazione della forma e quella dei livelli si compongono nello spazio del gruppo", () => {
    const opened = open(
      doc(
        `<g id="l1" fub:layer="Uno" transform="scale(2)">${RECT("a", 0)}</g>` +
          '<g id="l2" fub:layer="Due" transform="translate(10 20) rotate(30)"><g id="gg" transform="translate(5 0)"><circle id="c" cx="30" cy="25" r="20" transform="scale(0.5)"/></g></g>',
      ),
    );
    const before = boundsOf(opened, "c");
    const result = clip(opened, "a", "c");
    const released = release(opened, result.keys[0]!);
    // Le matrici si scrivono con quattro decimali: la rotazione perde un poco.
    close(boundsOf(opened, released.keys.find((key) => key !== "a")!), before, 2);
    close(boundsOf(opened, "a"), { min: [0, 0], max: [100, 100] });
  });

  it("gli oggetti di livelli diversi tengono il loro posto, con le trasformazioni compensate", () => {
    const opened = open(
      doc(
        `<g id="l1" fub:layer="Uno" transform="translate(10 0)">${RECT("a", 0)}</g>` +
          `<g id="l2" fub:layer="Due" transform="scale(2)">${RECT("b", 5)}</g>` +
          `<g id="l3" fub:layer="Tre"><circle id="c" cx="30" cy="25" r="20"/></g>`,
      ),
    );
    const [a, b, c] = [boundsOf(opened, "a"), boundsOf(opened, "b"), boundsOf(opened, "c")];
    const result = clip(opened, "a", "b", "c");
    // Il gruppo è nel livello del più alto fra gli altri, il secondo.
    expect(flat(opened)).toMatch(/<g id="l2" fub:layer="Due" transform="scale\(2\)"><g id="O1" clip-path="url\(#R1\)">/);
    const released = release(opened, result.keys[0]!);
    close(boundsOf(opened, "a"), a);
    close(boundsOf(opened, "b"), b);
    close(boundsOf(opened, released.keys.find((key) => key !== "a" && key !== "b")!), c);
  });

  it("la selezione dopo è il gruppo nuovo", () => {
    const opened = open(doc(`${LAYER}${RECT("a", 0)}${RECT("b", 60)}<circle id="c" cx="30" cy="25" r="20"/></g>`));
    const result = clip(opened, "a", "b", "c");
    expect(result.keys).toHaveLength(1);
    expect(result.keys[0]).toMatch(/^o[0-9a-z]{8}$/);
    expect(opened.reindex().units.map((unit) => unit.key)).toEqual(result.keys);
  });

  it("un oggetto senza id ne riceve uno, e anche il più alto", () => {
    const opened = open(doc(`${LAYER}<rect x="0" y="0" width="50" height="50"/><circle cx="30" cy="25" r="20"/></g>`));
    const [rect, circle] = opened.index.units;
    const result = run(opened, clipMaskOps(opened.engine.model!, [rect!, circle!], ids(opened)));
    expect(result.keys).toHaveLength(1);
    expect(flat(opened)).toMatch(/^<defs id="fub-defs"><clipPath id="R1" fub:role="private"><circle cx="30" cy="25" r="20" fill="#000000"\/><\/clipPath><\/defs><g id="l1" fub:layer="Livello 1"><g id="O1" clip-path="url\(#R1\)"><rect id="O2" x="0" y="0" width="50" height="50"\/><\/g><\/g>$/);
  });

  it("una forma senza riempimento, nera per SVG, scrive il nero e rilasciata torna nera", () => {
    const opened = open(doc(`${LAYER}${RECT("a", 0)}<circle id="c" cx="30" cy="25" r="20" stroke="#0000cc"/></g>`));
    const result = clip(opened, "a", "c");
    expect(flat(opened)).toContain('<clipPath id="R1" fub:role="private"><circle cx="30" cy="25" r="20" fill="#000000" stroke="#0000cc"/></clipPath>');
    release(opened, result.keys[0]!);
    expect(flat(opened)).toBe(
      '<g id="l1" fub:layer="Livello 1"><rect id="a" x="0" y="0" width="50" height="50"/><circle id="O1" cx="30" cy="25" r="20" fill="#000000" stroke="#0000cc"/></g>',
    );
  });

  it("rifiuta ciò che non può fare, con la sua ragione", () => {
    const circle = '<circle id="c" cx="30" cy="25" r="20"/>';
    const refused = (top: string, defs = "", layer = LAYER, ...keys: string[]): string => {
      const opened = open(doc(`${defs}${layer}${RECT("a", 0)}${top}</g>`));
      return outcome(clipMaskOps(opened.engine.model!, pick(opened, ...(keys.length === 0 ? ["a", "c"] : keys)), ids(opened)));
    };
    const opened = open(doc(`${LAYER}${RECT("a", 0)}</g>`));
    expect(outcome(clipMaskOps(opened.engine.model!, pick(opened, "a"), ids(opened)))).toBe("few");
    expect(outcome(clipMaskOps(opened.engine.model!, [], ids(opened)))).toBe("few");
    expect(refused('<line id="c" x1="0" y1="0" x2="50" y2="50" stroke="#000000"/>')).toBe("line");
    expect(refused(IMAGE("c"))).toBe("top");
    expect(refused(`<g id="c">${circle.replace(' id="c"', "")}</g>`)).toBe("top");
    expect(refused(`<a id="c" href="nota.md">${circle.replace(' id="c"', "")}</a>`)).toBe("top");
    expect(refused(circle)).toBe("fatto");
    // Un ritaglio, una maschera o un filtro suoi.
    const own = DEFS(CIRCLE_CLIP("k1"));
    expect(refused(circle.replace("/>", ' clip-path="url(#k1)"/>'), own)).toBe("content");
    const mask = DEFS('<mask id="m1" fub:role="private" x="0" y="0" width="100" height="100" maskUnits="userSpaceOnUse"><rect width="100" height="100" fill="#ffffff"/></mask>');
    expect(refused(circle.replace("/>", ' mask="url(#m1)"/>'), mask)).toBe("content");
    // Un tratto il cui inchiostro non si legge non entra in una risorsa.
    expect(refused(PEN("c").replace(INK, "1 s100 cxyq 1,1,1 1,1,1"))).toBe("content");
  });

  it("rifiuta un testo su tracciato e un livello che schiaccia lo spazio", () => {
    const opened = open(doc(`${DEFS('<path id="rpppppppp" fub:role="private" d="M 0 50 L 200 50"/>')}${LAYER}${RECT("a", 0)}<text id="c" font-size="10"><textPath href="#rpppppppp">Sul colle</textPath></text></g>`));
    expect(outcome(clipMaskOps(opened.engine.model!, pick(opened, "a", "c"), ids(opened)))).toBe("top");
    const flat0 = open(doc(`<g id="l1" fub:layer="Uno" transform="scale(1 0)">${RECT("a", 0)}</g><g id="l2" fub:layer="Due"><circle id="c" cx="30" cy="25" r="20"/></g>`));
    expect(outcome(clipMaskOps(flat0.engine.model!, pick(flat0, "a", "c"), ids(flat0)))).toBe("plane");
  });
});

describe("crea maschera d'opacità", () => {
  const FADE = (top: string, defs = DEFS(GRADIENT), under = IMAGE()): Opened => open(doc(`${defs}${LAYER}${under}${top}</g>`));

  it("da un rettangolo con una sfumatura sopra un'immagine: la regione è dove il rettangolo disegna, in fuori", () => {
    const opened = FADE('<rect id="m" x="10.004" y="20" width="60.003" height="40" fill="url(#g1) #888888"/>');
    const result = fade(opened, "i", "m");
    expect(result.keys).toHaveLength(1);
    expect(flat(opened)).toBe(
      `<defs id="fub-defs">${GRADIENT}<mask id="R1" fub:role="private" x="10" y="20" width="60.01" height="40" maskUnits="userSpaceOnUse">` +
        '<rect x="10.004" y="20" width="60.003" height="40" fill="url(#g1) #888888"/></mask></defs>' +
        `<g id="l1" fub:layer="Livello 1"><g id="O1" mask="url(#R1)">${IMAGE()}</g></g>`,
    );
    expect(opened.engine.holder("m")).toBeNull();
  });

  it("rilasciata, la maschera torna il rettangolo con la sua sfumatura, sopra l'immagine", () => {
    const opened = FADE('<rect id="m" x="10.004" y="20" width="60.003" height="40" fill="url(#g1) #888888"/>');
    const result = fade(opened, "i", "m");
    const back = release(opened, result.keys[0]!);
    expect(flat(opened)).toBe(
      `<defs id="fub-defs">${GRADIENT}</defs><g id="l1" fub:layer="Livello 1">${IMAGE()}<rect id="O1" x="10.004" y="20" width="60.003" height="40" fill="url(#g1) #888888"/></g>`,
    );
    expect(back.keys).toHaveLength(2);
    expect(back.keys).toContain("i");
  });

  it("la regione comprende il contorno, anche la punta di una giunzione ad angolo retto", () => {
    const opened = FADE('<rect id="m" x="10" y="20" width="60" height="40" fill="#ffffff" stroke="#000000" stroke-width="4"/>', "");
    fade(opened, "i", "m");
    // Metà tratto per √2 attorno al rettangolo, arrotondato in fuori ai centesimi.
    expect(flat(opened)).toContain('<mask id="R1" fub:role="private" x="7.17" y="17.17" width="65.66" height="45.66" maskUnits="userSpaceOnUse"><rect x="10" y="20" width="60" height="40" fill="#ffffff" stroke="#000000" stroke-width="4"/></mask>');
  });

  it("la regione è nello spazio del gruppo, anche se la forma sta in un livello con una trasformazione", () => {
    const opened = open(doc(`${LAYER}${IMAGE()}</g><g id="l2" fub:layer="Due" transform="translate(30 5) scale(2)"><rect id="m" x="5" y="10" width="10" height="20" fill="#ffffff"/></g>`));
    const before = boundsOf(opened, "m");
    const result = fade(opened, "i", "m");
    expect(flat(opened)).toContain('<mask id="R1" fub:role="private" x="40" y="25" width="20" height="40" maskUnits="userSpaceOnUse"><rect x="5" y="10" width="10" height="20" fill="#ffffff" transform="matrix(2 0 0 2 30 5)"/></mask>');
    const back = release(opened, result.keys[0]!);
    close(boundsOf(opened, back.keys.find((key) => key !== "i")!), before);
  });

  it("da un testo: la regione segue il suo riquadro", () => {
    const opened = FADE('<text id="t" x="10" y="60" font-size="40" fill="#ffffff"><tspan x="10" dy="0">Fub</tspan></text>', "");
    const bounds = boundsOf(opened, "t");
    fade(opened, "i", "t");
    const found = /<mask id="R1" fub:role="private" x="([^"]*)" y="([^"]*)" width="([^"]*)" height="([^"]*)" maskUnits="userSpaceOnUse"><text x="10" y="60" fill="#ffffff" font-size="40"><tspan x="10" dy="0">Fub<\/tspan><\/text><\/mask>/.exec(flat(opened));
    expect(found).not.toBeNull();
    const [x, y, w, h] = found!.slice(1).map(Number) as [number, number, number, number];
    // La stima del riquadro sta dentro la regione, che per il testo è larga
    // quanto un corpo per carattere e sale di un corpo, scende di 0,35.
    expect(x).toBeLessThanOrEqual(bounds.min[0]);
    expect(y).toBeLessThanOrEqual(bounds.min[1]);
    expect(x + w).toBeGreaterThanOrEqual(bounds.max[0]);
    expect(y + h).toBeGreaterThanOrEqual(bounds.max[1]);
    expect([x, y, w, h]).toEqual([10, 20, 120, 54]);
  });

  it("da un gruppo di forme e testi, anche annidati: il gruppo entra nella maschera con la sua trasformazione", () => {
    const group = '<g id="m" transform="translate(5 5)"><rect x="0" y="0" width="30" height="30" fill="#ffffff"/><g opacity="0.5"><circle cx="50" cy="50" r="10" fill="#cccccc"/></g></g>';
    const opened = FADE(group, "");
    const before = boundsOf(opened, "m");
    const result = fade(opened, "i", "m");
    expect(flat(opened)).toContain(
      '<mask id="R1" fub:role="private" x="5" y="5" width="60" height="60" maskUnits="userSpaceOnUse"><g transform="matrix(1 0 0 1 5 5)"><rect x="0" y="0" width="30" height="30" fill="#ffffff"/><g opacity="0.5"><circle cx="50" cy="50" r="10" fill="#cccccc"/></g></g></mask>',
    );
    const back = release(opened, result.keys[0]!);
    close(boundsOf(opened, back.keys.find((key) => key !== "i")!), before);
    expect(flat(opened)).toContain('<g id="O1" transform="matrix(1 0 0 1 5 5)"><rect id="O2"');
  });

  it("un gruppo annidato fino al limite del formato si accetta, uno più profondo no", () => {
    const nested = (depth: number): string => `<g id="m">${"<g>".repeat(depth - 1)}<rect x="0" y="0" width="30" height="30" fill="#ffffff"/>${"</g>".repeat(depth - 1)}</g>`;
    const ok = FADE(nested(32), "");
    expect(outcome(opacityMaskOps(ok.engine.model!, pick(ok, "i", "m"), ids(ok)))).toBe("fatto");
    applied(ok, [...(opacityMaskOps(ok.engine.model!, pick(ok, "i", "m"), ids(ok)) as Arranged).ops]);
    const deep = FADE(nested(33), "");
    expect(outcome(opacityMaskOps(deep.engine.model!, pick(deep, "i", "m"), ids(deep)))).toBe("content");
  });

  it("rifiuta ciò che cambierebbe ciò che la maschera fa, o che non c'è", () => {
    const refused = (top: string, defs = DEFS(GRADIENT, PATTERN, MARKER)): string => {
      const opened = FADE(top, defs);
      return outcome(opacityMaskOps(opened.engine.model!, pick(opened, "i", "m"), ids(opened)));
    };
    expect(refused('<rect id="m" x="0" y="0" width="30" height="30" fill="#ffffff"/>')).toBe("fatto");
    expect(refused('<rect id="m" x="0" y="0" width="30" height="30" fill="url(#p1) #ffffff"/>')).toBe("content");
    expect(refused('<rect id="m" x="0" y="0" width="30" height="30" fill="#ffffff" stroke="url(#p1)"/>')).toBe("content");
    expect(refused('<path id="m" d="M0 0 L50 50" fill="none" stroke="#ffffff" marker-end="url(#mk)"/>')).toBe("content");
    expect(refused(`<g id="m"><rect x="0" y="0" width="30" height="30" fill="#ffffff" clip-path="url(#k1)"/></g>`, DEFS(CIRCLE_CLIP("k1")))).toBe("content");
    expect(refused('<rect id="m" x="0" y="0" width="30" height="30" fill="#ffffff" clip-path="url(#k1)"/>', DEFS(CIRCLE_CLIP("k1")))).toBe("content");
    expect(refused('<g id="m" fill="url(#p1) #ffffff"><rect x="0" y="0" width="30" height="30"/></g>')).toBe("content");
    expect(refused(`<g id="m"><rect x="0" y="0" width="30" height="30" fill="#ffffff"/>${IMAGE("j")}</g>`)).toBe("top");
    expect(refused(`<g id="m"><a href="nota.md"><rect x="0" y="0" width="30" height="30" fill="#ffffff"/></a></g>`)).toBe("top");
    expect(refused(IMAGE("m"))).toBe("top");
    expect(refused('<line id="m" x1="0" y1="0" x2="50" y2="50" stroke="#ffffff"/>')).toBe("line");
    const own = DEFS('<mask id="m1" fub:role="private" x="0" y="0" width="100" height="100" maskUnits="userSpaceOnUse"><rect width="100" height="100" fill="#ffffff"/></mask>');
    expect(refused('<g id="m" mask="url(#m1)"><rect x="0" y="0" width="30" height="30" fill="#ffffff"/></g>', own)).toBe("content");
  });

  it("rifiuta un motivo che la forma eredita dal suo gruppo", () => {
    const opened = open(doc(`${DEFS(PATTERN)}${LAYER}${IMAGE()}<g id="gg" fill="url(#p1) #ffffff"><rect id="m" x="0" y="0" width="30" height="30"/></g></g>`));
    expect(outcome(opacityMaskOps(opened.engine.model!, pick(opened, "i", "m"), ids(opened)))).toBe("content");
    // Un ritaglio lo accetta, col ripiego.
    const result = clip(opened, "i", "m");
    expect(result.keys).toHaveLength(1);
    expect(flat(opened)).toContain('<clipPath id="R1" fub:role="private"><rect x="0" y="0" width="30" height="30" fill="#ffffff"/></clipPath>');
  });

  it("una sfumatura che la forma eredita si porta nella maschera", () => {
    const opened = open(doc(`${DEFS(GRADIENT)}${LAYER}${IMAGE()}<g id="gg" fill="url(#g1) #888888">${RECT("d", 200)}<rect id="m" x="0" y="0" width="30" height="30"/></g></g>`));
    fade(opened, "i", "m");
    expect(flat(opened)).toContain('<rect x="0" y="0" width="30" height="30" fill="url(#g1) #888888"/></mask>');
  });
});

describe("rilascia", () => {
  it("un gruppo con un titolo resta un gruppo, senza il ritaglio", () => {
    const opened = open(doc(`${DEFS(CIRCLE_CLIP("k1"))}${LAYER}<g id="gg" clip-path="url(#k1)"><title>Foto</title>${RECT("a", 0)}</g></g>`));
    const result = release(opened, "gg");
    expect(flat(opened)).toBe(
      `<g id="l1" fub:layer="Livello 1"><g id="gg"><title>Foto</title>${RECT("a", 0)}</g><circle id="O1" cx="50" cy="50" r="30" fill="#ff0000"/></g>`,
    );
    expect(result.keys).toEqual([idOf(opened, "circle"), "gg"]);
  });

  it("un gruppo con altro di suo resta un gruppo", () => {
    for (const extra of [' opacity="0.5"', ' fill="#00ff00"', ' fub:name="Foto"', ' stroke-width="2"']) {
      const opened = open(doc(`${DEFS(CIRCLE_CLIP("k1"))}${LAYER}<g id="gg" clip-path="url(#k1)"${extra}>${RECT("a", 0)}</g></g>`));
      release(opened, "gg");
      expect(flat(opened), extra).toMatch(/<g id="gg"[^>]*><rect id="a"/);
      expect(flat(opened), extra).not.toContain("clip-path");
    }
  });

  it("un gruppo che dopo non ha più niente di suo si scioglie, e i figli prendono la sua trasformazione", () => {
    const opened = open(doc(`${DEFS(CIRCLE_CLIP("k1"))}${LAYER}<g id="gg" transform="translate(10 0)" clip-path="url(#k1)">${RECT("a", 0)}${RECT("b", 60)}</g></g>`));
    const result = release(opened, "gg");
    expect(flat(opened)).toBe(
      '<g id="l1" fub:layer="Livello 1">' +
        '<rect id="a" x="0" y="0" width="50" height="50" transform="matrix(1 0 0 1 10 0)"/>' +
        '<rect id="b" x="60" y="0" width="50" height="50" transform="matrix(1 0 0 1 10 0)"/>' +
        '<circle id="O1" cx="50" cy="50" r="30" fill="#ff0000" transform="matrix(1 0 0 1 10 0)"/></g>',
    );
    close(boundsOf(opened, "a"), { min: [10, 0], max: [60, 50] });
    close(boundsOf(opened, "b"), { min: [70, 0], max: [120, 50] });
    // La selezione dopo: il pezzo e i figli, nell'ordine del disegno.
    expect(result.keys).toHaveLength(3);
    expect(result.keys.slice(1)).toEqual(["a", "b"]);
  });

  it("un oggetto che non è un gruppo resta dov'è, senza il ritaglio", () => {
    const opened = open(doc(`${DEFS(CIRCLE_CLIP("k1"))}${LAYER}<rect id="r" x="0" y="0" width="100" height="100" fill="#0000ff" clip-path="url(#k1)"/></g>`));
    const result = release(opened, "r");
    expect(flat(opened)).toBe(
      '<g id="l1" fub:layer="Livello 1"><rect id="r" x="0" y="0" width="100" height="100" fill="#0000ff"/><circle id="O1" cx="50" cy="50" r="30" fill="#ff0000"/></g>',
    );
    expect(result.keys).toEqual([idOf(opened, "circle"), "r"]);
  });

  it("una maschera e un ritaglio insieme: prima i pezzi della maschera, poi quelli del ritaglio, sopra l'oggetto", () => {
    const mask = '<mask id="m1" fub:role="private" x="0" y="0" width="100" height="100" maskUnits="userSpaceOnUse"><rect x="0" y="0" width="100" height="100" fill="#ffffff"/><circle cx="5" cy="5" r="5" fill="#444444"/></mask>';
    const opened = open(doc(`${DEFS(CIRCLE_CLIP("k1"), mask)}${LAYER}${IMAGE("i", ' clip-path="url(#k1)" mask="url(#m1)"')}<rect id="z" x="0" y="0" width="5" height="5"/></g>`));
    const result = release(opened, "i");
    expect(flat(opened)).toBe(
      `<g id="l1" fub:layer="Livello 1">${IMAGE()}<rect id="O1" x="0" y="0" width="100" height="100" fill="#ffffff"/><circle id="O2" cx="5" cy="5" r="5" fill="#444444"/><circle id="O3" cx="50" cy="50" r="30" fill="#ff0000"/><rect id="z" x="0" y="0" width="5" height="5"/></g>`,
    );
    expect(result.keys).toHaveLength(4);
    expect(result.keys[3]).toBe("i");
  });

  it("più oggetti insieme, anche nello stesso gruppo, e quelli senza niente da rilasciare restano scelti", () => {
    const opened = open(
      doc(
        `${DEFS(CIRCLE_CLIP("k1"), CIRCLE_CLIP("k2"))}${LAYER}` +
          `<g id="g1" clip-path="url(#k1)">${RECT("a", 0)}</g>` +
          `${RECT("plain", 200)}` +
          `<g id="g2"><rect id="r2" x="0" y="0" width="100" height="100" clip-path="url(#k2)"/><rect id="r3" x="150" y="0" width="10" height="10"/></g></g>`,
      ),
    );
    const g2 = opened.index.get("g2")!;
    expect(releasable(opened.engine.model!, opened.index.get("g1")!)).toBe(true);
    expect(releasable(opened.engine.model!, opened.index.get("plain")!)).toBe(false);
    expect(releasable(opened.engine.model!, g2)).toBe(false);
    const result = run(opened, releaseOps(opened.engine.model!, [opened.index.get("g1")!, opened.index.get("plain")!], ids(opened)));
    expect(result.keys).toHaveLength(3);
    expect(result.keys).toContain("plain");
    expect(result.keys).toContain("a");
    expect(opened.engine.text).toContain('id="k2"');
    expect(opened.engine.text).not.toContain('id="k1"');
  });

  it("niente da rilasciare: null", () => {
    const opened = open(doc(`${DEFS(GRADIENT)}${LAYER}${RECT("a", 0, 0, ' fill="url(#g1)"')}${RECT("b", 60)}</g>`));
    expect(releaseOps(opened.engine.model!, opened.index.units, ids(opened))).toBeNull();
    expect(releaseOps(opened.engine.model!, [], ids(opened))).toBeNull();
    for (const unit of opened.index.units) expect(releasable(opened.engine.model!, unit)).toBe(false);
  });

  it("un ritaglio scritto da un altro, con le unità del riquadro e una trasformazione, rilascia dove si vedeva", () => {
    const foreign = '<clipPath id="k1" clipPathUnits="objectBoundingBox" transform="translate(10 5)"><rect x="0" y="0" width="0.5" height="0.5" fill="#ff0000" clip-rule="evenodd"/></clipPath>';
    const opened = open(doc(`${DEFS(foreign)}${LAYER}<rect id="r" x="20" y="40" width="100" height="60" fill="#0000ff" clip-path="url(#k1)"/></g>`));
    expect(releasable(opened.engine.model!, opened.index.get("r")!)).toBe(true);
    const result = release(opened, "r");
    // Le unità si applicano prima della trasformazione del ritaglio: il
    // quadrato è metà riquadro, spostato di (10, 5).
    // Il ritaglio di un altro resta com'è, con la sua regola.
    expect(flat(opened)).toBe(
      `${DEFS(foreign)}<g id="l1" fub:layer="Livello 1"><rect id="r" x="20" y="40" width="100" height="60" fill="#0000ff"/>` +
        '<rect id="O1" x="0" y="0" width="0.5" height="0.5" fill="#ff0000" transform="matrix(100 0 0 60 30 45)"/></g>',
    );
    close(boundsOf(opened, result.keys[0]!), { min: [30, 45], max: [80, 75] });
  });

  it("la trasformazione dell'oggetto si compone con quella del ritaglio e delle unità", () => {
    const foreign = '<clipPath id="k1" clipPathUnits="objectBoundingBox" transform="translate(10 5)"><rect x="0" y="0" width="0.5" height="0.5" fill="#ff0000" transform="rotate(0)"/></clipPath>';
    const opened = open(doc(`${DEFS(foreign)}${LAYER}<rect id="r" x="20" y="40" width="100" height="60" fill="#0000ff" transform="translate(5 5)" clip-path="url(#k1)"/></g>`));
    const result = release(opened, "r");
    expect(flat(opened)).toContain('<rect id="O1" x="0" y="0" width="0.5" height="0.5" fill="#ff0000" transform="matrix(100 0 0 60 35 50)"/>');
    close(boundsOf(opened, result.keys[0]!), { min: [35, 50], max: [85, 80] });
    // Il ritaglio di un altro resta, ora senza chi lo usava.
    expect(opened.engine.text).toContain('id="k1"');
  });

  it("un pezzo del ritaglio senza riempimento non ne ha, e perde la regola", () => {
    const clipPath = '<clipPath id="k1" fub:role="private"><rect x="0" y="0" width="40" height="40" clip-rule="evenodd"/><circle cx="60" cy="60" r="10" stroke="#00ff00"/></clipPath>';
    const opened = open(doc(`${DEFS(clipPath)}${LAYER}${IMAGE("i", ' clip-path="url(#k1)"')}</g>`));
    release(opened, "i");
    expect(flat(opened)).toBe(
      `<g id="l1" fub:layer="Livello 1">${IMAGE()}<rect id="O1" x="0" y="0" width="40" height="40" fill="none"/><circle id="O2" cx="60" cy="60" r="10" fill="none" stroke="#00ff00"/></g>`,
    );
  });

  it("un ritaglio condiviso con altri resta a chi lo usa, e il pezzo ne è una copia", () => {
    const opened = open(doc(`${DEFS(CIRCLE_CLIP("k1"))}${LAYER}${RECT("a", 0, 0, ' clip-path="url(#k1)"')}${RECT("b", 100, 0, ' clip-path="url(#k1)"')}</g>`));
    release(opened, "a");
    expect(flat(opened)).toBe(
      `${DEFS(CIRCLE_CLIP("k1"))}<g id="l1" fub:layer="Livello 1">${RECT("a", 0)}<circle id="O1" cx="50" cy="50" r="30" fill="#ff0000"/>${RECT("b", 100, 0, ' clip-path="url(#k1)"')}</g>`,
    );
    expect(opened.engine.holder("k1")).not.toBeNull();
  });

  it("le sfumature private che il ritaglio condiviso usa passano al pezzo come copie", () => {
    const clipPath = '<clipPath id="k1" fub:role="private"><circle cx="50" cy="50" r="30" fill="url(#g1)"/></clipPath>';
    const opened = open(doc(`${DEFS(GRADIENT, clipPath)}${LAYER}${RECT("a", 0, 0, ' clip-path="url(#k1)"')}${RECT("b", 100, 0, ' clip-path="url(#k1)"')}</g>`));
    release(opened, "a");
    const text = flat(opened);
    expect(text.match(/<linearGradient /g)).toHaveLength(2);
    expect(text).toContain('<circle id="O1" cx="50" cy="50" r="30" fill="url(#R1)"/>');
    expect(text).toMatch(/<linearGradient id="R1" fub:role="private"/);
    // La copia viene prima di chi la usa; l'originale serve ancora al ritaglio.
    expect(text.indexOf('<linearGradient id="R1"')).toBeLessThan(text.indexOf('<circle id="O1"'));
    expect(text).toContain('<clipPath id="k1" fub:role="private"><circle cx="50" cy="50" r="30" fill="url(#g1)"/></clipPath>');
  });

  it("un ritaglio solo suo passa com'è ai pezzi, con le sue sfumature", () => {
    const clipPath = '<clipPath id="k1" fub:role="private"><circle cx="50" cy="50" r="30" fill="url(#g1)"/></clipPath>';
    const opened = open(doc(`${DEFS(GRADIENT, clipPath)}${LAYER}${RECT("a", 0, 0, ' clip-path="url(#k1)"')}</g>`));
    release(opened, "a");
    expect(flat(opened)).toBe(`${DEFS(GRADIENT)}<g id="l1" fub:layer="Livello 1">${RECT("a", 0)}<circle id="O1" cx="50" cy="50" r="30" fill="url(#g1)"/></g>`);
  });

  it("i pezzi con id nel contenuto ne ricevono di nuovi, a ogni livello, anche rilasciando la stessa risorsa due volte", () => {
    const mask = '<mask id="m1" fub:role="private" x="0" y="0" width="100" height="100" maskUnits="userSpaceOnUse"><g id="gm" opacity="0.5"><rect id="rm" x="0" y="0" width="100" height="100" fill="#ffffff"/></g></mask>';
    const opened = open(doc(`${DEFS(mask)}${LAYER}${RECT("a", 0, 0, ' mask="url(#m1)"')}${RECT("b", 100, 0, ' mask="url(#m1)"')}</g>`));
    release(opened, "a");
    // Chi l'usa ancora la tiene; rilasciata anche da lui, se ne va.
    expect(flat(opened)).toMatch(/^<defs id="fub-defs"><mask id="m1"/);
    release(opened, "b");
    const text = flat(opened);
    expect(text).not.toContain("<mask");
    expect(text).not.toContain('id="gm"');
    expect(text).not.toContain('id="rm"');
    const pieces = [...opened.engine.text.matchAll(/<g id="(o[0-9a-z]{8})" opacity="0.5">\s*<rect id="(o[0-9a-z]{8})"/g)];
    expect(pieces).toHaveLength(2);
    expect(new Set(pieces.flatMap((piece) => [piece[1], piece[2]])).size).toBe(4);
  });

  it("un collegamento con una maschera resta un collegamento", () => {
    const mask = '<mask id="m1" fub:role="private" x="0" y="0" width="100" height="100" maskUnits="userSpaceOnUse"><rect x="0" y="0" width="100" height="100" fill="#ffffff"/></mask>';
    const opened = open(doc(`${DEFS(mask)}${LAYER}<a id="ln" href="nota.md" mask="url(#m1)">${RECT("a", 0)}</a></g>`));
    expect(releasable(opened.engine.model!, opened.index.get("ln")!)).toBe(true);
    release(opened, "ln");
    expect(flat(opened)).toContain(`<a id="ln" href="nota.md">${RECT("a", 0)}</a>`);
    expect(flat(opened)).toContain('<rect id="O1" x="0" y="0" width="100" height="100" fill="#ffffff"/>');
  });

  it("un ritaglio nelle unità del riquadro di un oggetto senza area non si rilascia", () => {
    // Un tracciato piatto non ha un riquadro con un'area: le unità non danno niente.
    const foreign = '<clipPath id="k1" clipPathUnits="objectBoundingBox"><rect x="0" y="0" width="0.5" height="0.5"/></clipPath>';
    const opened = open(doc(`${DEFS(foreign)}${LAYER}<path id="r" d="M10 10 L60 10" fill="none" stroke="#000000" clip-path="url(#k1)"/></g>`));
    const unit = opened.index.get("r")!;
    expect(releasable(opened.engine.model!, unit)).toBe(false);
    expect(releaseOps(opened.engine.model!, [unit], ids(opened))).toBeNull();
  });

  it("creare e rilasciare, due volte di fila, dà sempre lo stesso disegno", () => {
    const opened = open(doc(`${LAYER}${RECT("a", 0, 0, ' fill="#cc0000"')}${RECT("b", 60, 0, ' fill="#00cc00"')}<circle id="c" cx="30" cy="25" r="20" fill="#0000cc" stroke="#000000" stroke-width="2"/></g>`));
    const start = flat(opened);
    let keys = ["a", "b", "c"];
    for (let turn = 0; turn < 2; turn++) {
      const made = clip(opened, ...keys);
      const back = release(opened, ...made.keys);
      keys = opened.reindex().units.map((unit) => unit.key);
      expect([...back.keys].sort()).toEqual([...keys].sort());
      expect(keys).toHaveLength(3);
      // Il cerchio ha un id nuovo; il resto è com'era.
      expect(flat(opened).replace(/id="O\d"/g, 'id="c"')).toBe(start);
      keys = ["a", "b", keys.find((key) => key !== "a" && key !== "b")!];
    }
  });
});

/// Il disegno con `top` sopra l'immagine `under`, nel livello; `before` sta prima del livello.
const stacked = (top: string, before = "", under = IMAGE()): Opened => open(doc(`${before}${LAYER}${under}${top}</g>`));

/// La regione [x, y, larghezza, altezza] della maschera ora nel disegno.
function regionIn(opened: Opened): [number, number, number, number] {
  const found = /<mask [^>]*\bx="([^"]*)" y="([^"]*)" width="([^"]*)" height="([^"]*)" maskUnits="userSpaceOnUse"/.exec(opened.engine.text);
  if (found === null) throw new Error("nessuna maschera con una regione");
  return found.slice(1).map(Number) as [number, number, number, number];
}

/// Vero se la regione di `opened` contiene il riquadro [x0, y0, x1, y1] di ciò che la maschera disegna davvero.
function holds(opened: Opened, x0: number, y0: number, x1: number, y1: number): void {
  const [x, y, w, h] = regionIn(opened);
  expect(x).toBeLessThanOrEqual(x0);
  expect(y).toBeLessThanOrEqual(y0);
  expect(x + w).toBeGreaterThanOrEqual(x1);
  expect(y + h).toBeGreaterThanOrEqual(y1);
}

describe("la regione di una maschera d'opacità è per eccesso", () => {
  const regionOfTop = (top: string): [number, number, number, number] => {
    const opened = stacked(top);
    fade(opened, "i", "m");
    return regionIn(opened);
  };

  it("una scala non uniforme allarga il contorno di più su un asse: il contorno intero sta dentro", () => {
    // Il tratto di 10 è largo 20 sull'asse x, dopo la scala di 4; il disegno vero va da 20 a 100.
    const opened = stacked('<rect id="m" x="10" y="10" width="10" height="10" fill="#ffffff" stroke="#000000" stroke-width="10" transform="matrix(4 0 0 1 0 0)"/>');
    fade(opened, "i", "m");
    holds(opened, 20, 5, 100, 25);
    expect(regionIn(opened)).toEqual([11.71, 2.92, 96.58, 24.16]);
  });

  it("un quadrato ruotato di 45° con un contorno spesso ha le punte fuori dal riquadro girato", () => {
    const opened = stacked('<rect id="m" x="-10" y="-10" width="20" height="20" fill="#ffffff" stroke="#000000" stroke-width="10" transform="matrix(0.7071 0.7071 -0.7071 0.7071 100 100)"/>');
    fade(opened, "i", "m");
    // Il quadrato con il contorno ha lato 30: ruotato, la sua metà diagonale è 21,21.
    holds(opened, 78.79, 78.79, 121.21, 121.21);
  });

  it("il testo con un contorno è largo al più un corpo per carattere, sale di un corpo e scende di 0,35, col contorno di una giunzione a spigolo", () => {
    const opened = stacked('<text id="m" x="10" y="60" font-size="40" fill="#ffffff" stroke="#000000" stroke-width="10"><tspan x="10" dy="0">Fub</tspan></text>');
    fade(opened, "i", "m");
    // Mezzo tratto, 5, per il limite delle punte, 4: 20 attorno a [10, 20, 130, 74].
    expect(regionIn(opened)).toEqual([-10, 0, 160, 94]);
  });

  it("un testo centrato o a destra, con la spaziatura fra le lettere, sta dentro dall'ancora verso il suo lato", () => {
    const middle = stacked('<text id="m" x="100" y="50" font-size="20" letter-spacing="5" text-anchor="middle" fill="#ffffff"><tspan x="100" dy="0">AB</tspan></text>');
    fade(middle, "i", "m");
    expect(regionIn(middle)).toEqual([75, 30, 50, 27]);
    const end = stacked('<text id="m" x="100" y="50" font-size="20" text-anchor="end" fill="#ffffff"><tspan x="100" dy="0">AB</tspan></text>');
    fade(end, "i", "m");
    expect(regionIn(end)).toEqual([60, 30, 40, 27]);
  });

  it("un triangolo con le giunzioni a punta ha la punta in alto fuori dal suo riquadro", () => {
    const opened = stacked('<polygon id="m" points="100,20 120,60 80,60" fill="#ffffff" stroke="#000000" stroke-width="10"/>');
    fade(opened, "i", "m");
    // La punta in cima sta a 5 per √5 sopra il vertice, a y = 8,82.
    holds(opened, 70, 8.82, 130, 66);
    expect(regionIn(opened)).toEqual([60, 0, 80, 80]);
  });

  it("un capo squadrato in diagonale esce di mezzo tratto per √2", () => {
    const opened = stacked('<path id="m" d="M20 20 L100 100" fill="none" stroke="#ffffff" stroke-width="20" stroke-linecap="square" stroke-linejoin="bevel"/>');
    fade(opened, "i", "m");
    holds(opened, 5.86, 5.86, 114.14, 114.14);
    expect(regionIn(opened)).toEqual([5.85, 5.85, 108.3, 108.3]);
  });

  it("una giunzione a spigolo, che è quella predefinita, esce fino al limite: un tratto aperto non ne ha, ma la regione è per eccesso", () => {
    // Mezzo tratto di 10 per il limite predefinito, 4: 40 attorno a [20, 20, 100, 100].
    expect(regionOfTop('<path id="m" d="M20 20 L100 100" fill="none" stroke="#ffffff" stroke-width="20"/>')).toEqual([-20, -20, 160, 160]);
  });

  it("un contorno tondo o smussato esce solo di mezzo tratto; un ellisse non ha spigoli", () => {
    expect(regionOfTop('<polygon id="m" points="100,20 120,60 80,60" fill="#ffffff" stroke="#000000" stroke-width="10" stroke-linejoin="round"/>')).toEqual([75, 15, 50, 50]);
    expect(regionOfTop('<polygon id="m" points="100,20 120,60 80,60" fill="#ffffff" stroke="#000000" stroke-width="10" stroke-linejoin="bevel"/>')).toEqual([75, 15, 50, 50]);
    expect(regionOfTop('<ellipse id="m" cx="50" cy="50" rx="20" ry="10" fill="#ffffff" stroke="#000000" stroke-width="6"/>')).toEqual([27, 37, 46, 26]);
  });

  it("senza `stroke` la larghezza del contorno non conta, e un contorno ereditato dal gruppo sì", () => {
    expect(regionOfTop('<rect id="m" x="10" y="20" width="60" height="40" fill="#ffffff" stroke-width="10"/>')).toEqual([10, 20, 60, 40]);
    const opened = open(doc(`${LAYER}${IMAGE()}<g id="gg" stroke="#000000" stroke-width="2" stroke-linejoin="round"><rect id="m" x="10" y="20" width="60" height="40" fill="#ffffff"/></g></g>`));
    fade(opened, "i", "m");
    // Il contorno del gruppo lo scrive il contenuto: mezzo tratto di 1 attorno.
    expect(regionIn(opened)).toEqual([9, 19, 62, 42]);
  });

  it("un gruppo si guarda forma per forma, con la trasformazione di ciascuna e lo stile che eredita", () => {
    const group = '<g id="m" transform="translate(5 5)" stroke="#000000" stroke-width="4" stroke-linejoin="round"><rect x="0" y="0" width="30" height="30" fill="#ffffff"/><g transform="scale(2)"><circle cx="40" cy="40" r="10" fill="#cccccc" stroke-width="2"/></g></g>';
    const opened = stacked(group);
    fade(opened, "i", "m");
    // Il rettangolo: da 5 a 35 con 2 attorno; il cerchio, nel gruppo scalato: da 80 a 100, più 5 = da 85 a 105, col contorno di 1 per 2.
    holds(opened, 3, 3, 107, 107);
    expect(regionIn(opened)).toEqual([3, 3, 104, 104]);
  });
});

describe("l'opacità dei contenitori da cui la forma esce", () => {

  it("l'opacità del gruppo da cui esce la forma passa al contenuto della maschera", () => {
    const opened = open(doc(`${LAYER}${IMAGE()}<g id="gg" opacity="0.5"><rect id="m" x="10" y="10" width="50" height="50" fill="#ffffff"/></g></g>`));
    const result = fade(opened, "i", "m");
    expect(flat(opened)).toBe(
      '<defs id="fub-defs"><mask id="R1" fub:role="private" x="10" y="10" width="50" height="50" maskUnits="userSpaceOnUse"><rect x="10" y="10" width="50" height="50" fill="#ffffff" opacity="0.5"/></mask></defs>' +
        `<g id="l1" fub:layer="Livello 1"><g id="O1" mask="url(#R1)">${IMAGE()}</g><g id="gg" opacity="0.5"></g></g>`,
    );
    // Rilasciata, la forma ha quell'opacità da sé.
    release(opened, result.keys[0]!);
    expect(flat(opened)).toContain('<rect id="O1" x="10" y="10" width="50" height="50" fill="#ffffff" opacity="0.5"/>');
  });

  it("i contenitori annidati si moltiplicano, anche con l'opacità della forma, a quattro decimali", () => {
    const opened = open(doc(`${LAYER}${IMAGE()}<g id="g1" opacity="0.5"><g id="g2" opacity="0.4"><rect id="m" x="10" y="10" width="50" height="50" fill="#ffffff" opacity="0.3333"/></g></g></g>`));
    fade(opened, "i", "m");
    expect(flat(opened)).toContain('fill="#ffffff" opacity="0.0667"/></mask>');
  });

  it("l'opacità dei contenitori che il gruppo nuovo ha anche lui non si porta: vale per il gruppo intero", () => {
    const opened = open(doc(`<g id="l1" fub:layer="Livello 1" opacity="0.5">${IMAGE()}<rect id="m" x="10" y="10" width="50" height="50" fill="#ffffff"/></g>`));
    fade(opened, "i", "m");
    expect(flat(opened)).toContain('<rect x="10" y="10" width="50" height="50" fill="#ffffff"/></mask>');
  });

  it("un ritaglio guarda solo la geometria: niente opacità", () => {
    const opened = open(doc(`${LAYER}${IMAGE()}<g id="gg" opacity="0.5"><rect id="m" x="10" y="10" width="50" height="50" fill="#ffffff"/></g></g>`));
    clip(opened, "i", "m");
    expect(flat(opened)).toContain('<clipPath id="R1" fub:role="private"><rect x="10" y="10" width="50" height="50" fill="#ffffff"/></clipPath>');
  });

  it("un contenitore con un ritaglio o una maschera non si lascia: la forma si vedrebbe diversa", () => {
    const refusing = (attrs: string, make: typeof opacityMaskOps = opacityMaskOps): string => {
      const defs = DEFS(CIRCLE_CLIP("k1"), '<mask id="k2" fub:role="private"><rect x="0" y="0" width="90" height="90" fill="#ffffff"/></mask>');
      const opened = open(doc(`${defs}${LAYER}${IMAGE()}<g id="gg"${attrs}><rect id="m" x="10" y="10" width="50" height="50" fill="#ffffff"/></g></g>`));
      return outcome(make(opened.engine.model!, pick(opened, "i", "m"), ids(opened)));
    };
    expect(refusing(' clip-path="url(#k1)"')).toBe("container");
    expect(refusing(' mask="url(#k2)"')).toBe("container");
    expect(refusing(' clip-path="url(#k1)"', clipMaskOps)).toBe("container");
    // Un contenitore senza niente di tutto questo non lo impedisce.
    expect(refusing(' clip-path="none"')).toBe("fatto");
    expect(refusing(' opacity="0.5"')).toBe("fatto");
  });

  it("come «Raggruppa»: gli altri oggetti di altri livelli entrano nel gruppo con le stesse operazioni, e un contenitore che resta vuoto resta", () => {
    const source = doc(`${LAYER}${IMAGE()}</g><g id="l2" fub:layer="Due" opacity="0.5" transform="translate(10 0)">${RECT("b", 0, 0, ' fill="#00cc00"')}</g><g id="l3" fub:layer="Tre"><rect id="m" x="10" y="10" width="50" height="50" fill="#ffffff"/></g>`);
    const opened = open(source);
    const kinds = (ops: readonly Op[]): string[] => ops.map((op) => (op.op === "add" && "elem" in op ? `add ${op.elem.tag}` : op.op));
    const grouped = groupOps(opened.engine.model!, pick(opened, "i", "b"), ids(opened))!;
    const masked = opacityMaskOps(opened.engine.model!, pick(opened, "i", "b", "m"), ids(opened)) as Arranged;
    const from = kinds(masked.ops).indexOf("add g");
    // Dopo la risorsa: il gruppo, poi gli spostamenti e la compensazione, come con «Raggruppa»; infine la forma che se ne va.
    expect(kinds(masked.ops).slice(from, -1)).toEqual(kinds(grouped.ops).slice(kinds(grouped.ops).indexOf("add g")));
    applied(opened, [...masked.ops]);
    // Il livello di «m» resta, vuoto.
    expect(flat(opened)).toContain('<g id="l3" fub:layer="Tre"></g>');
  });
});

describe("rilasciare dove il riquadro dell'oggetto serve", () => {
  const CLIP_BOX = '<clipPath id="k1" clipPathUnits="objectBoundingBox"><rect x="0" y="0" width="0.5" height="0.5"/></clipPath>';
  const CLIP_PLAIN = '<clipPath id="k1"><rect x="0" y="0" width="40" height="40"/></clipPath>';
  const TEXT = (extra = ""): string => `<text id="t" x="10" y="40" font-size="20" fill="#000000"${extra}><tspan x="10" dy="0">Ciao</tspan></text>`;
  const refusal = (opened: Opened, ...keys: string[]): string | null => {
    const units = keys.map((key) => opened.index.get(key)!);
    return releaseRefusal(opened.engine.model!, units, ids(opened));
  };

  it("un testo con un ritaglio nelle unità del riquadro si può rilasciare, ma non si sa dove: si rifiuta, con la ragione", () => {
    const opened = open(doc(`${DEFS(CLIP_BOX)}${LAYER}${TEXT(' clip-path="url(#k1)"')}</g>`));
    const unit = opened.index.get("t")!;
    expect(releasable(opened.engine.model!, unit)).toBe(true);
    expect(releaseOps(opened.engine.model!, [unit], ids(opened))).toBeNull();
    expect(refusal(opened, "t")).toBe("box");
  });

  it("un gruppo con un testo dentro ha un riquadro che dipende dalle lettere: si rifiuta", () => {
    const opened = open(doc(`${DEFS(CLIP_BOX)}${LAYER}<g id="gg" clip-path="url(#k1)">${RECT("a", 0, 0, ' fill="#cc0000"')}${TEXT()}</g></g>`));
    expect(releasable(opened.engine.model!, opened.index.get("gg")!)).toBe(true);
    expect(refusal(opened, "gg")).toBe("box");
    expect(releaseOps(opened.engine.model!, [opened.index.get("gg")!], ids(opened))).toBeNull();
  });

  it("un gruppo con una parte di un altro programma dipende da ciò che non si legge: si rifiuta", () => {
    const opened = open(doc(`${DEFS(CLIP_BOX)}${LAYER}<g id="gg" clip-path="url(#k1)">${RECT("a", 0, 0, ' fill="#cc0000"')}<rect id="f" class="x" x="60" y="0" width="50" height="50"/></g></g>`));
    expect(refusal(opened, "gg")).toBe("box");
  });

  it("un testo nascosto, un titolo o un elemento senza disegno non contano: il riquadro è esatto", () => {
    const hidden = open(doc(`${DEFS(CLIP_BOX)}${LAYER}<g id="gg" clip-path="url(#k1)"><title>x</title>${RECT("a", 0, 0, ' fill="#cc0000"')}${TEXT(' display="none"')}</g></g>`));
    expect(refusal(hidden, "gg")).toBeNull();
    const result = release(hidden, "gg");
    // Il riquadro è quello del rettangolo, 50 per 50: il ritaglio ne è un quarto.
    expect(flat(hidden)).toContain('<rect id="O1" x="0" y="0" width="0.5" height="0.5" fill="none" transform="matrix(50 0 0 50 0 0)"/>');
    expect(result.keys).toHaveLength(2);
  });

  it("le forme e le immagini hanno il riquadro esatto, con le trasformazioni dei figli", () => {
    const opened = open(doc(`${DEFS(CLIP_BOX)}${LAYER}<g id="gg" clip-path="url(#k1)">${RECT("a", 0, 0, ' fill="#cc0000"')}${RECT("b", 0, 0, ' fill="#00cc00" transform="translate(60 10)"')}</g></g>`));
    release(opened, "gg");
    // Il gruppo va da (0, 0) a (110, 60): w = 110, h = 60.
    expect(flat(opened)).toContain('<rect id="O1" x="0" y="0" width="0.5" height="0.5" fill="none" transform="matrix(110 0 0 60 0 0)"/>');
  });

  it("un testo con un ritaglio nelle unità dell'utente si rilascia: non serve il riquadro", () => {
    const opened = open(doc(`${DEFS(CLIP_PLAIN)}${LAYER}${TEXT(' clip-path="url(#k1)"')}</g>`));
    expect(refusal(opened, "t")).toBeNull();
    release(opened, "t");
    expect(flat(opened)).toContain('<rect id="O1" x="0" y="0" width="40" height="40" fill="none"/>');
  });

  it("il rilascio è tutto o niente: un oggetto che si rifiuta ferma anche gli altri, e da solo l'altro si rilascia", () => {
    const opened = open(doc(`${DEFS(CLIP_BOX, CIRCLE_CLIP("k2"))}${LAYER}${TEXT(' clip-path="url(#k1)"')}${IMAGE("i", ' clip-path="url(#k2)"')}</g>`));
    expect(refusal(opened, "t", "i")).toBe("box");
    expect(releaseOps(opened.engine.model!, [opened.index.get("t")!, opened.index.get("i")!], ids(opened))).toBeNull();
    expect(refusal(opened, "i")).toBeNull();
    release(opened, "i");
    expect(flat(opened)).toContain('<circle id="O1" cx="50" cy="50" r="30" fill="#ff0000"/>');
  });

  it("un ritaglio senza oggetti da rilasciare non è un rifiuto: niente", () => {
    const opened = open(doc(`${LAYER}${RECT("a", 0, 0, ' fill="#cc0000"')}</g>`));
    expect(refusal(opened, "a")).toBeNull();
  });
});

describe("rilasciare lo stile che i pezzi avevano dentro la risorsa", () => {
  const MASK = '<mask id="k1" fub:role="private"><rect x="0" y="0" width="40" height="40"/></mask>';
  const under = (attrs: string, resource = MASK): Opened => open(doc(`${DEFS(resource)}<g id="l1" fub:layer="Livello 1"${attrs}>${IMAGE("i", ' mask="url(#k1)"')}</g>`));

  it("un pezzo che dentro la risorsa era nero ed era senza contorno lo resta, anche se il livello ha altro", () => {
    const opened = under(' fill="#0000ff" stroke="#ff0000"');
    release(opened, "i");
    expect(flat(opened)).toContain('<rect id="O1" x="0" y="0" width="40" height="40" fill="#000000" stroke="none"/>');
  });

  it("se il livello dà già lo stesso, non si scrive niente", () => {
    const opened = under(' fill="#000000"');
    release(opened, "i");
    expect(flat(opened)).toContain('<rect id="O1" x="0" y="0" width="40" height="40"/>');
  });

  it("lo stile scritto dal pezzo è suo e non si tocca", () => {
    const opened = under(' fill="#0000ff"', '<mask id="k1" fub:role="private"><rect x="0" y="0" width="40" height="40" fill="#123456"/></mask>');
    release(opened, "i");
    expect(flat(opened)).toContain('<rect id="O1" x="0" y="0" width="40" height="40" fill="#123456"/>');
  });

  it("un ritaglio non ha riempimento: il pezzo lo scrive nullo e non eredita il colore del livello", () => {
    const clipPath = '<clipPath id="k1" fub:role="private"><circle cx="50" cy="50" r="30"/></clipPath>';
    const opened = open(doc(`${DEFS(clipPath)}<g id="l1" fub:layer="Livello 1" fill="#0000ff">${IMAGE("i", ' clip-path="url(#k1)"')}</g>`));
    release(opened, "i");
    expect(flat(opened)).toContain('<circle id="O1" cx="50" cy="50" r="30" fill="none"/>');
  });

  it("un testo che dentro la risorsa aveva i caratteri del font predefinito, e fuori ne eredita un altro, non si può riscrivere: si rifiuta", () => {
    const resource = '<mask id="k1" fub:role="private"><text x="5" y="30" font-size="20" fill="#ffffff"><tspan x="5" dy="0">Ciao</tspan></text></mask>';
    const opened = under(' font-family="serif"', resource);
    const unit = opened.index.get("i")!;
    expect(releasable(opened.engine.model!, unit)).toBe(true);
    expect(releaseRefusal(opened.engine.model!, [unit], ids(opened))).toBe("style");
    expect(releaseOps(opened.engine.model!, [unit], ids(opened))).toBeNull();
  });

  it("un testo senza famiglia di caratteri in un livello che non ne ha, si rilascia com'è", () => {
    const resource = '<mask id="k1" fub:role="private"><text x="5" y="30" font-size="20" fill="#ffffff"><tspan x="5" dy="0">Ciao</tspan></text></mask>';
    const opened = under("", resource);
    release(opened, "i");
    expect(flat(opened)).toContain('<text id="O1" x="5" y="30" fill="#ffffff" font-size="20"><tspan x="5" dy="0">Ciao</tspan></text>');
  });
});

describe("i fogli di stile non cambiano ciò che la maschera mostra", () => {
  const sheet = (css: string): string => `<style>${css}</style>`;
  const TOP = '<rect id="m" x="20" y="20" width="40" height="40" fill="#ffffff"/>';
  /// Applica `result` come `applied`, ma in un disegno che ha parti di un altro programma (il foglio).
  const settle = (opened: Opened, result: Arranged): void => {
    const before = opened.engine.text;
    const done = opened.engine.apply(gesture([...result.ops])!);
    if (done.outcome !== "applied") throw new Error(`il motore rifiuta: ${done.detail}`);
    const after = opened.engine.text;
    expect(opened.engine.undo(done.undo).outcome).toBe("applied");
    expect(opened.engine.text).toBe(before);
    expect(opened.engine.apply(gesture([...result.ops])!).outcome).toBe("applied");
    expect(opened.engine.text).toBe(after);
  };
  const outcomeOf = (css: string, top = TOP, make: typeof opacityMaskOps = opacityMaskOps): { readonly result: string; readonly opened: Opened } => {
    const opened = stacked(top, sheet(css));
    const result = make(opened.engine.model!, pick(opened, "i", "m"), ids(opened));
    if (result !== null && typeof result !== "string") settle(opened, result);
    return { result: outcome(result), opened };
  };
  const content = (opened: Opened): string => /<(?:mask|clipPath) [^>]*>(.*)<\/(?:mask|clipPath)>/.exec(flat(opened))![1]!;

  it("un foglio che non tocca la forma non cambia niente: come in un disegno senza foglio", () => {
    const plain = stacked(TOP);
    fade(plain, "i", "m");
    const { result, opened } = outcomeOf(".zzz { fill: #123456 }");
    expect(result).toBe("fatto");
    expect(content(opened)).toBe(content(plain));
    expect(flat(opened)).toContain("<style>.zzz { fill: #123456 }</style>");
  });

  it("una regola che dà il riempimento alla forma per il suo id si scrive nel contenuto, che non ha id", () => {
    const { result, opened } = outcomeOf("#m { fill: #123456 }");
    expect(result).toBe("fatto");
    expect(content(opened)).toBe('<rect x="20" y="20" width="40" height="40" fill="#123456"/>');
  });

  it("una regola per un antenato non arriva dentro la risorsa: si scrive ciò che dava", () => {
    const { result, opened } = outcomeOf("#l1 rect { fill: #123456 }");
    expect(result).toBe("fatto");
    expect(content(opened)).toBe('<rect x="20" y="20" width="40" height="40" fill="#123456"/>');
  });

  it("una regola per il tipo arriva anche dentro la risorsa: il contenuto si vede uguale, e non si scrive niente", () => {
    const { result, opened } = outcomeOf("rect { fill: #123456 }");
    expect(result).toBe("fatto");
    expect(content(opened)).toBe('<rect x="20" y="20" width="40" height="40" fill="#ffffff"/>');
  });

  it("una regola che dentro la risorsa cambierebbe il contenuto, e che un attributo non batte, si rifiuta", () => {
    const { result } = outcomeOf("mask rect { fill: #000000 }");
    expect(result).toBe("style");
  });

  it("l'opacità data da una regola passa al contenuto", () => {
    const { result, opened } = outcomeOf("#m { opacity: 0.5 }");
    expect(result).toBe("fatto");
    expect(content(opened)).toBe('<rect x="20" y="20" width="40" height="40" fill="#ffffff" opacity="0.5"/>');
  });

  it("una trasformazione data da una regola non si porta: si rifiuta", () => {
    expect(outcomeOf("#m { transform: translate(5px, 5px) }").result).toBe("style");
  });

  it("per un ritaglio il colore non conta: una regola sul riempimento non lo impedisce, e non si scrive", () => {
    const { result, opened } = outcomeOf("#m { fill: #123456 }", TOP, clipMaskOps);
    expect(result).toBe("fatto");
    expect(content(opened)).toBe('<rect x="20" y="20" width="40" height="40" fill="#ffffff"/>');
  });

  it("la regione di una maschera misura il contorno che una regola dà: lo scrive il contenuto e la regione lo comprende", () => {
    const top = '<rect id="m" x="20" y="20" width="40" height="40" fill="#ffffff" stroke="#000000"/>';
    const { result, opened } = outcomeOf("#m { stroke-width: 10 }", top);
    expect(result).toBe("fatto");
    expect(content(opened)).toBe('<rect x="20" y="20" width="40" height="40" fill="#ffffff" stroke="#000000" stroke-width="10"/>');
    // Mezzo tratto, 5, per √2 agli angoli: 7,07 attorno al rettangolo.
    expect(regionIn(opened)).toEqual([12.92, 12.92, 54.16, 54.16]);
  });

  it("una trasformazione del livello non si perde con il foglio: la regione è nel suo spazio come senza foglio", () => {
    const opened = open(doc(`${sheet(".zzz { fill: #123456 }")}${LAYER}${IMAGE()}</g><g id="l2" fub:layer="Due" transform="translate(100 0)">${TOP}</g>`));
    const result = opacityMaskOps(opened.engine.model!, pick(opened, "i", "m"), ids(opened));
    if (result === null || typeof result === "string") throw new Error(`rifiutato: ${String(result)}`);
    settle(opened, result);
    expect(regionIn(opened)).toEqual([120, 20, 40, 40]);
  });

  describe("rilasciando", () => {
    const MASK = '<mask id="k1" fub:role="private"><rect x="0" y="0" width="40" height="40"/></mask>';
    const opening = (css: string): Opened => open(doc(`${sheet(css)}${DEFS(MASK)}${LAYER}${IMAGE("i", ' mask="url(#k1)"')}</g>`));
    const releasing = (opened: Opened): void => {
      const result = releaseOps(opened.engine.model!, [opened.index.get("i")!], ids(opened));
      if (result === null) throw new Error("niente da rilasciare");
      settle(opened, result);
    };

    it("un foglio che non tocca i pezzi non cambia niente", () => {
      const opened = opening(".zzz { fill: #123456 }");
      releasing(opened);
      expect(flat(opened)).toContain('<rect id="O1" x="0" y="0" width="40" height="40"/>');
    });

    it("una regola per i figli del livello darebbe ai pezzi ciò che dentro la risorsa non avevano, e un attributo non la batte: si rifiuta", () => {
      const opened = opening("#l1 > rect { stroke: #ff0000 }");
      const unit = opened.index.get("i")!;
      expect(releasable(opened.engine.model!, unit)).toBe(true);
      expect(releaseRefusal(opened.engine.model!, [unit], ids(opened))).toBe("style");
      expect(releaseOps(opened.engine.model!, [unit], ids(opened))).toBeNull();
    });

    it("una regola per i gruppi dà il riempimento ai pezzi per eredità, e un attributo lo batte: si scrive ciò che avevano", () => {
      const opened = opening("g { fill: #123456 }");
      releasing(opened);
      expect(flat(opened)).toContain('<rect id="O1" x="0" y="0" width="40" height="40" fill="#000000"/>');
    });
  });
});
