// Le punte delle linee: il marcatore che le disegna, coperto contro ogni
// estremo che una linea può avere; chi può averle e ciò che ne dice il
// pannello. Le operazioni che le danno, le cambiano e le tolgono stanno in
// `tips.ops.test.ts`; quelle che le tengono del colore della linea, dentro lo
// stesso passo, e il tempo di mille linee in `tips.follow.test.ts`. Ogni
// operazione si applica al motore, e un annulla riporta il testo al byte.

import { describe, expect, it } from "vitest";
import { FIDELITY } from "../../../../bench/fidelity-corpus";
import { parsePath } from "../scene/geometry";
import type { Op } from "../scene/ops";
import type { Elem } from "../scene/serialize";
import { doc } from "../scene/test-support";
import { arrowPath } from "./shapes";
import { LAYER, open } from "./test-support";
import { BLUE, CUSTOM, DEFS, ENDS, MARKER, markersIn, RED, written } from "./tip-support";
import { TIP_ENDS, TIP_SHAPES, TIP_SIZES, markerTip, tipElem, tippable, type MarkerTip, type Tip, type TipEnd, type TipShape } from "./tips";
import { applied, BRUSH, type Edit, INK, leaf, LINE, looks, oneLine, settled, SWATCH, tip } from "./tips/test-support";

// ---------------------------------------------------------------------------
// Il disegno di una punta, misurato.
// ---------------------------------------------------------------------------

type Spot = readonly [number, number];

/// Come è disegnata una punta, letta dal marcatore.
interface Drawing {
  readonly kind: "fill" | "round" | "butt" | "circle";
  /// I vertici, nelle coordinate del marcatore.
  readonly points: readonly Spot[];
  readonly radius: number;
  /// Il punto di riferimento: dove sta l'estremo della linea.
  readonly ref: Spot;
  readonly width: number;
  readonly height: number;
}

function drawingOf(marker: Elem): Drawing {
  const ref: Spot = [Number(marker.attrs.refX), Number(marker.attrs.refY)];
  const base = { ref, width: Number(marker.attrs.markerWidth), height: Number(marker.attrs.markerHeight) };
  const content = marker.children![0]!;
  if (content.tag === "circle") {
    return { ...base, kind: "circle", points: [[Number(content.attrs.cx), Number(content.attrs.cy)]], radius: Number(content.attrs.r) };
  }
  const points: Spot[] = [];
  for (const segment of parsePath(content.attrs.d!)!) if (segment.kind !== "close") points.push([segment.to[0], segment.to[1]]);
  const kind = content.attrs.fill !== "none" ? "fill" : content.attrs["stroke-linecap"] === "round" ? "round" : "butt";
  return { ...base, kind, points, radius: 0 };
}

/// I vertici di `drawing` nel riferimento della linea: l'estremo è l'origine.
const localPoints = (drawing: Drawing): Spot[] => drawing.points.map((p) => [p[0] - drawing.ref[0], p[1] - drawing.ref[1]]);

/// Quanto la forma sporge dai vertici, nei due assi.
function padOf(drawing: Drawing): Spot {
  switch (drawing.kind) {
    case "circle":
      return [drawing.radius, drawing.radius];
    case "round":
      return [0.5, 0.5];
    case "butt":
      return [0.5, 0];
    case "fill":
      return [0, 0];
  }
}

const EPS = 1e-6;

function distanceToSegment(p: Spot, a: Spot, b: Spot): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function insidePolygon(points: readonly Spot[], p: Spot): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/// Vero se il disegno, in coordinate della linea, ricopre il punto `p`.
function covers(drawing: Drawing, points: readonly Spot[], p: Spot): boolean {
  switch (drawing.kind) {
    case "circle":
      return Math.hypot(p[0] - points[0]![0], p[1] - points[0]![1]) <= drawing.radius + EPS;
    case "fill":
      return insidePolygon(points, p) || points.some((a, i) => distanceToSegment(p, a, points[(i + 1) % points.length]!) <= EPS);
    case "round":
      return points.slice(1).some((b, i) => distanceToSegment(p, points[i]!, b) <= 0.5 + EPS);
    case "butt": {
      // Un tratto solo con gli estremi netti: un rettangolo largo uno spessore.
      const a = points[0]!;
      const b = points[1]!;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const along = ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / length;
      const across = Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / length;
      return along >= -EPS && along <= length + EPS && across <= 0.5 + EPS;
    }
  }
}

type Cap = "butt" | "round" | "square";

/// I punti dell'estremo di una linea di spessore 1 che finisce nell'origine,
/// con l'estremo `cap`, sul capo `end`: la linea arriva da −x per un capo di
/// fine e da +x per uno d'inizio, e l'estremo sporge oltre l'origine.
function capRegion(cap: Cap, end: TipEnd): Spot[] {
  const toward = end === "end" ? 1 : -1;
  const out: Spot[] = [];
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const y = -0.5 + i / steps;
    if (cap === "butt") out.push([0, y]);
    for (let j = 1; j <= steps; j++) {
      const x = (0.5 * j) / steps;
      if (cap === "square") out.push([toward * x, y]);
      else if (cap === "round" && Math.hypot(x, y) <= 0.5) out.push([toward * x, y]);
    }
  }
  return out;
}

describe("la punta come è scritta", () => {
  it("è un marcatore condiviso: l'estremo della linea è il suo punto di riferimento, e il margine è di mezzo spessore", () => {
    expect(oneLine(tipElem("r1", tip("triangle"), "end", RED, 1))).toBe(
      '<marker id="r1" fub:role="shared" fub:marker="triangle medium end" refX="3.44" refY="3" markerWidth="5.34" markerHeight="6" orient="auto">' +
        `<path d="M4.84 3 L0.51 5.5 L0.51 0.5 Z" fill="${RED}"/></marker>`,
    );
    expect(oneLine(tipElem("r2", tip("vee"), "end", RED, 1))).toBe(
      '<marker id="r2" fub:role="shared" fub:marker="vee medium end" refX="4.84" refY="3.5" markerWidth="6.34" markerHeight="7" orient="auto">' +
        `<path d="M1.01 1 L5.34 3.5 L1.01 6" fill="none" stroke="${RED}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></marker>`,
    );
    expect(oneLine(tipElem("r3", tip("circle", "large"), "end", RED, 1))).toBe(
      '<marker id="r3" fub:role="shared" fub:marker="circle large end" refX="3.3" refY="3.3" markerWidth="6.6" markerHeight="6.6" orient="auto">' +
        `<circle cx="3.3" cy="3.3" r="2.8" fill="${RED}"/></marker>`,
    );
  });

  it("la punta d'inizio è il capovolto di quella di fine, perché SVG 1.1 non rovescia la punta", () => {
    expect(oneLine(tipElem("r1", tip("triangle", "small"), "start", RED, 1))).toBe(
      '<marker id="r1" fub:role="shared" fub:marker="triangle small start" refX="1.9" refY="2.25" markerWidth="4.04" markerHeight="4.5" orient="auto">' +
        `<path d="M0.5 2.25 L3.53 4 L3.53 0.5 Z" fill="${RED}"/></marker>`,
    );
    expect(oneLine(tipElem("r4", tip("vee", "small"), "start", RED, 1))).toBe(
      '<marker id="r4" fub:role="shared" fub:marker="vee small start" refX="1.5" refY="2.75" markerWidth="5.04" markerHeight="5.5" orient="auto">' +
        `<path d="M4.03 1 L1 2.75 L4.03 4.5" fill="none" stroke="${RED}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></marker>`,
    );
    expect(oneLine(tipElem("r2", tip("bar", "small"), "start", RED, 1))).toBe(
      '<marker id="r2" fub:role="shared" fub:marker="bar small start" refX="1" refY="2.25" markerWidth="2" markerHeight="4.5" orient="auto">' +
        `<path d="M1 0.5 L1 4" fill="none" stroke="${RED}" stroke-width="1" stroke-linecap="butt"/></marker>`,
    );
    const gaps: string[] = [];
    for (const shape of TIP_SHAPES) {
      for (const size of TIP_SIZES) {
        const last = drawingOf(tipElem("a", tip(shape, size), "end", RED, 1));
        const first = drawingOf(tipElem("b", tip(shape, size), "start", RED, 1));
        const mine = localPoints(last);
        const flipped = localPoints(first);
        const same = first.kind === last.kind && first.radius === last.radius && mine.length === flipped.length;
        if (!same || mine.some((p, i) => Math.abs(p[0] + flipped[i]![0]) > 0.0101 || Math.abs(p[1] - flipped[i]![1]) > 0.0101)) gaps.push(`${shape} ${size}`);
        // Il riquadro è lo stesso, a meno dell'arrotondamento ai centesimi.
        if (Math.abs(first.width - last.width) > 0.0101 || Math.abs(first.height - last.height) > 0.0101) gaps.push(`${shape} ${size} riquadro`);
      }
    }
    expect(gaps).toEqual([]);
  });

  it("ha un solo elemento di forma: un path, o un circle per il cerchio", () => {
    for (const shape of TIP_SHAPES) {
      for (const end of TIP_ENDS) {
        const marker = tipElem("a", tip(shape), end, RED, 1);
        expect(marker.tag).toBe("marker");
        expect(marker.children).toHaveLength(1);
        expect(marker.children![0]!.tag).toBe(shape === "circle" ? "circle" : "path");
        expect(marker.attrs).toMatchObject({ "fub:role": "shared", "fub:marker": `${shape} medium ${end}`, orient: "auto" });
        // La misura è in spessori, il default di SVG: niente `markerUnits` né `viewBox`.
        expect(Object.keys(marker.attrs).sort()).toEqual(["fub:marker", "fub:role", "id", "markerHeight", "markerWidth", "orient", "refX", "refY"]);
      }
    }
  });

  it("la testa è larga 3,5, 5 o 7 spessori, e ogni forma sta in proporzione", () => {
    const head = { small: 3.5, medium: 5, large: 7 };
    // La metà della larghezza della forma, in teste.
    const across: Record<TipShape, number> = { triangle: 0.5, vee: 0.5, circle: 0.4, square: 0.35, diamond: 0.3, bar: 0.5 };
    const wrong: string[] = [];
    for (const shape of TIP_SHAPES) {
      let before = 0;
      for (const size of TIP_SIZES) {
        const drawing = drawingOf(tipElem("a", tip(shape, size), "end", RED, 1));
        const half = Math.max(...localPoints(drawing).map((p) => Math.abs(p[1]))) + (drawing.kind === "circle" ? drawing.radius : 0);
        // I vertici sono scritti al centesimo.
        if (Math.abs(half - across[shape] * head[size]) > 0.0101) wrong.push(`${shape} ${size}: ${half}`);
        // Una misura più grande ha un riquadro più grande.
        if (drawing.width * drawing.height <= before) wrong.push(`${shape} ${size}: riquadro`);
        before = drawing.width * drawing.height;
      }
    }
    expect(wrong).toEqual([]);
  });

  it("il contenuto sta dentro il riquadro, con almeno un quarto di spessore di margine e non molto di più", () => {
    const wrong: string[] = [];
    for (const shape of TIP_SHAPES) {
      for (const size of TIP_SIZES) {
        for (const end of TIP_ENDS) {
          const drawing = drawingOf(tipElem("a", tip(shape, size), end, RED, 1));
          const [padX, padY] = padOf(drawing);
          const xs = drawing.points.map((p) => p[0]);
          const ys = drawing.points.map((p) => p[1]);
          const margins = [Math.min(...xs) - padX, Math.min(...ys) - padY, drawing.width - Math.max(...xs) - padX, drawing.height - Math.max(...ys) - padY];
          if (margins.some((margin) => margin < 0.25 || margin > 0.55)) wrong.push(`${shape} ${size} ${end}: ${margins.map((m) => m.toFixed(3)).join(" ")}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it("riferimento e riquadro sono multipli di un centesimo, perché l'estremo resti sul riferimento", () => {
    for (const shape of TIP_SHAPES) {
      for (const size of TIP_SIZES) {
        for (const end of TIP_ENDS) {
          const marker = tipElem("a", tip(shape, size), end, RED, 1);
          for (const name of ["refX", "refY", "markerWidth", "markerHeight"]) expect(marker.attrs[name]).toMatch(/^\d+(\.\d{1,2})?$/);
        }
      }
    }
  });

  it("porta l'opacità sul riempimento di una forma piena e sul contorno di una tracciata, solo se minore di uno", () => {
    const content = (shape: TipShape, opacity: number): Record<string, string> => tipElem("a", tip(shape), "end", RED, opacity).children![0]!.attrs;
    expect(content("triangle", 1)).not.toHaveProperty("fill-opacity");
    expect(content("triangle", 0.5)).toMatchObject({ fill: RED, "fill-opacity": "0.5" });
    expect(content("circle", 0.3333)).toMatchObject({ "fill-opacity": "0.3333" });
    expect(content("vee", 1)).not.toHaveProperty("stroke-opacity");
    expect(content("vee", 0.25)).toMatchObject({ fill: "none", stroke: RED, "stroke-opacity": "0.25" });
    expect(content("bar", 0.5)).toMatchObject({ "stroke-opacity": "0.5" });
    expect(content("bar", 0.5)).not.toHaveProperty("fill-opacity");
    // Un valore che non è un'opacità non si scrive.
    expect(content("square", Number.NaN)).not.toHaveProperty("fill-opacity");
    expect(content("square", 7)).not.toHaveProperty("fill-opacity");
    expect(content("square", -1)).toMatchObject({ "fill-opacity": "0" });
  });

  it("scrive il colore dove la forma lo porta: riempimento per le piene, contorno per la punta aperta e la barra", () => {
    expect(tipElem("a", tip("diamond"), "end", BLUE, 1).children![0]!.attrs).toMatchObject({ fill: BLUE });
    expect(tipElem("a", tip("vee"), "end", BLUE, 1).children![0]!.attrs).toMatchObject({ fill: "none", stroke: BLUE });
    expect(tipElem("a", tip("bar"), "end", "none", 1).children![0]!.attrs).toMatchObject({ fill: "none", stroke: "none" });
    expect(tipElem("a", tip("square"), "end", "url(#rs) #0072b2", 1).children![0]!.attrs).toMatchObject({ fill: "url(#rs) #0072b2" });
  });
});

describe("la punta copre il capo della linea", () => {
  it("il controllo si accorge di una punta troppo corta", () => {
    const short: Drawing = { kind: "fill", points: [[0, 0], [-4, 2], [-4, -2]], radius: 0, ref: [0, 0], width: 0, height: 0 };
    expect(covers(short, short.points, [0.5, 0.5])).toBe(false);
    expect(covers(short, short.points, [-1, 0.5])).toBe(true);
    // Con la cima sull'estremo restano scoperti i canti di ogni estremo.
    for (const cap of ["butt", "round", "square"] as const) expect(capRegion(cap, "end").some((p) => !covers(short, short.points, p))).toBe(true);
    // E l'estremo d'inizio sta dall'altra parte.
    expect(capRegion("round", "start").every((p) => p[0] <= 0)).toBe(true);
    expect(capRegion("round", "end").every((p) => p[0] >= 0)).toBe(true);
    expect(capRegion("round", "end").length).toBeGreaterThan(100);
  });

  it.each([...TIP_SHAPES])("%s, di ogni misura e su ogni capo, copre l'estremo quadrato, tondo e netto", (shape) => {
    const gaps: string[] = [];
    for (const size of TIP_SIZES) {
      for (const end of TIP_ENDS) {
        const drawing = drawingOf(tipElem("a", tip(shape, size), end, RED, 1));
        const points = localPoints(drawing);
        for (const cap of ["butt", "round", "square"] as const) {
          const bare = capRegion(cap, end).filter((p) => !covers(drawing, points, p));
          if (bare.length > 0) gaps.push(`${shape} ${size} ${end} ${cap}: ${bare.length} punti scoperti, il primo ${bare[0]!.join(",")}`);
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  it("la punta guarda oltre l'estremo: la cima sta davanti all'origine", () => {
    for (const shape of ["triangle", "diamond", "vee"] as const) {
      const end = localPoints(drawingOf(tipElem("a", tip(shape), "end", RED, 1)));
      const start = localPoints(drawingOf(tipElem("a", tip(shape), "start", RED, 1)));
      expect(Math.max(...end.map((p) => p[0]))).toBeGreaterThan(0.45);
      expect(Math.min(...start.map((p) => p[0]))).toBeLessThan(-0.45);
    }
  });
});

describe("riconoscere una punta della raccolta", () => {
  /// Un documento con i marcatori `markers`, e quello di id `m0` letto.
  function read(...markers: string[]): MarkerTip | null {
    const opened = open(doc(DEFS(...markers) + LAYER + LINE("oa") + "</g>"));
    return markerTip(leaf(opened, "m0"));
  }

  const base = (): Edit => structuredClone(tipElem("m0", tip("triangle", "large"), "end", RED, 1)) as Edit;

  it("ogni forma, misura e capo, col colore e l'opacità del suo contenuto, torna com'è stata scritta", () => {
    const paints = [RED, "none", "url(#rs) #0072b2"];
    const opacities = [1, 0.5, 0.3333];
    const all: Array<{ readonly id: string; readonly tip: Tip; readonly end: TipEnd; readonly paint: string; readonly opacity: number }> = [];
    for (const shape of TIP_SHAPES) {
      for (const size of TIP_SIZES) {
        for (const end of TIP_ENDS) {
          for (const paint of paints) for (const opacity of opacities) all.push({ id: `m${all.length}`, tip: tip(shape, size), end, paint, opacity });
        }
      }
    }
    const opened = open(doc(DEFS(SWATCH("rs", BLUE), ...all.map((each) => written(tipElem(each.id, each.tip, each.end, each.paint, each.opacity)))) + LAYER + LINE("oa") + "</g>"));
    expect(opened.engine.scene().every((item) => item.kind !== "foreign")).toBe(true);
    const wrong = all.filter((each) => {
      const read = markerTip(leaf(opened, each.id));
      return read === null || read.tip.shape !== each.tip.shape || read.tip.size !== each.tip.size || read.end !== each.end || read.paint !== each.paint || read.opacity !== each.opacity;
    });
    expect(wrong).toEqual([]);
    expect(all).toHaveLength(6 * 3 * 2 * 3 * 3);
  });

  it("si riconosce in qualunque ordine siano scritti gli attributi", () => {
    const markup = written(base());
    // Gli attributi di ogni tag, dall'ultimo al primo.
    const reversed = markup.replace(/<(\w+)((?: [\w:-]+="[^"]*")+)( ?\/?)>/g, (_, tag: string, attrs: string, close: string) => `<${tag}${(attrs.match(/ [\w:-]+="[^"]*"/g) ?? []).reverse().join("")}${close}>`);
    expect(reversed).not.toBe(markup);
    expect(reversed).toContain('orient="auto" markerHeight=');
    expect(read(reversed)).toMatchObject({ tip: tip("triangle", "large"), end: "end", paint: RED, opacity: 1 });
  });

  it("ogni altro marcatore è custom, anche se ne ha il nome", () => {
    const variants: Array<[string, (marker: Edit) => void]> = [
      ["un attributo in più", (marker) => (marker.attrs.markerUnits = "userSpaceOnUse")],
      ["un riquadro diverso", (marker) => (marker.attrs.markerWidth = "9")],
      ["un riferimento diverso", (marker) => (marker.attrs.refX = "1")],
      ["un orientamento diverso", (marker) => (marker.attrs.orient = "0")],
      ["la forma ritoccata", (marker) => (marker.children![0]!.attrs.d = "M0 0 L1 1 Z")],
      ["un attributo in più nel contenuto", (marker) => (marker.children![0]!.attrs["stroke-width"] = "2")],
      ["due forme", (marker) => marker.children!.push(structuredClone(marker.children![0]!))],
      ["nessuna forma", (marker) => (marker.children = [])],
      ["un nome che non è della raccolta", (marker) => (marker.attrs["fub:marker"] = "blob large end")],
      ["un nome senza il capo", (marker) => (marker.attrs["fub:marker"] = "triangle large")],
      ["un nome con altro in coda", (marker) => (marker.attrs["fub:marker"] = "triangle large end now")],
      ["un nome con spazi doppi", (marker) => (marker.attrs["fub:marker"] = "triangle  large end")],
      ["un nome vuoto", (marker) => (marker.attrs["fub:marker"] = "")],
      ["una misura che non c'è", (marker) => (marker.attrs["fub:marker"] = "triangle huge end")],
      ["un nome di un'altra forma", (marker) => (marker.attrs["fub:marker"] = "vee large end")],
      ["un nome di un'altra misura", (marker) => (marker.attrs["fub:marker"] = "triangle small end")],
      ["un nome dell'altro capo", (marker) => (marker.attrs["fub:marker"] = "triangle large start")],
      ["senza il ruolo di risorsa condivisa", (marker) => delete marker.attrs["fub:role"]],
      ["senza il colore", (marker) => delete marker.children![0]!.attrs.fill],
      ["un'opacità che non si legge", (marker) => (marker.children![0]!.attrs["fill-opacity"] = "molto")],
    ];
    const wrong: string[] = [];
    for (const [what, change] of variants) {
      const marker = base();
      change(marker);
      if (read(written(marker)) !== null) wrong.push(what);
    }
    expect(wrong).toEqual([]);
    // Il controllo di base: il marcatore intatto è della raccolta.
    expect(read(written(base()))).not.toBeNull();
    expect(read(CUSTOM("m0"))).toBeNull();
  });

  it("un marcatore con l'opacità scritta in un altro modo è custom, perché non è quello che FubDraw scriverebbe", () => {
    const marker = base();
    marker.children![0]!.attrs["fill-opacity"] = "0.50";
    expect(read(written(marker))).toBeNull();
    marker.children![0]!.attrs["fill-opacity"] = "0.5";
    expect(read(written(marker))).toMatchObject({ opacity: 0.5 });
  });

  it("l'engine accetta l'add di ogni punta, prima della linea che la nomina", () => {
    const opened = open(doc(DEFS() + LAYER + LINE("oa") + "</g>"));
    const marker = tipElem("rmmmmmmmm", tip("diamond", "small"), "start", RED, 1);
    const adding: Op = { op: "add", parent: "fub-defs", pos: { last: true }, elem: marker };
    const naming: Op = { op: "set", id: "oa", attrs: { "marker-start": "url(#rmmmmmmmm)" } };
    expect(applied(opened, [adding, naming])).toContain('<marker id="rmmmmmmmm" fub:role="shared" fub:marker="diamond small start"');
    expect(markerTip(leaf(opened, "rmmmmmmmm"))).toMatchObject({ tip: tip("diamond", "small"), end: "start", paint: RED, opacity: 1 });
    // E senza la linea che lo nomina un marcatore nuovo, che nessuno usa, il motore lo lascia dov'è.
    const alone = open(doc(DEFS() + LAYER + LINE("oa") + "</g>"));
    expect(applied(alone, [{ op: "add", parent: "fub-defs", pos: { last: true }, elem: marker }])).toContain('id="rmmmmmmmm"');
  });
});

describe("chi può avere le punte", () => {
  const SOURCE = doc(
    DEFS(MARKER("m1", "triangle", "medium", "end"), MARKER("m1s", "triangle", "medium", "start")) +
      LAYER +
      LINE("ol") +
      `<polyline id="op" points="0,0 10,10 20,0" fill="none" stroke="${RED}"/>` +
      `<path id="oo" d="M0 0 L10 10 L20 0" fill="none" stroke="${RED}"/>` +
      `<path id="oc" d="M0 0 L10 10 L20 0 Z" fill="none" stroke="${RED}"/>` +
      `<path id="oz" d="M0 0 L10 10 L20 0 z" fill="none" stroke="${RED}"/>` +
      `<path id="ok" d="M0 0 L10 10 L20 0 Z" fill="none" stroke="${RED}" marker-end="url(#m1)"/>` +
      `<polygon id="og" points="0,0 10,0 10,10" fill="none" stroke="${RED}"/>` +
      `<polygon id="oh" points="0,0 10,0 10,10" fill="none" stroke="${RED}" marker-start="url(#m1s)"/>` +
      `<rect id="or" x="0" y="0" width="10" height="10" fill="none" stroke="${RED}"/>` +
      `<text id="ot" x="0" y="20" stroke="${RED}">Ciao</text>` +
      `<path id="oa" fub:shape="arrow" fub:geom="0 0 100 0" d="${arrowPath(0, 0, 100, 0, 2)}" fill="none" stroke="${RED}" stroke-width="2"/>` +
      `<path id="oi" fub:tool="pen" fub:brush="${BRUSH}" d="M0 0 Z" fill="${RED}" fub:ink="${INK}"/>` +
      `<g id="oy">${LINE("o1")}</g>` +
      "</g>",
  );

  it("sono le linee, le spezzate e i tracciati aperti, e chi ne ha già, per poterle togliere", () => {
    const opened = open(SOURCE);
    const can = (id: string): boolean => tippable(opened.engine.holder(id)!);
    expect(["ol", "op", "oo", "ok", "oh", "o1"].filter(can)).toEqual(["ol", "op", "oo", "ok", "oh", "o1"]);
    expect(["oc", "oz", "og", "or", "ot", "oa", "oi", "oy"].filter(can)).toEqual([]);
  });

  it("il pannello conta le parti, non gli oggetti scelti, e un gruppo conta per le sue", () => {
    const opened = open(SOURCE);
    expect(looks(opened).count).toBe(6);
    const group = opened.reindex().units.filter((unit) => unit.id === "oy");
    expect(looks(opened, group).count).toBe(1);
    const closed = opened.reindex().units.filter((unit) => unit.id === "oc" || unit.id === "or" || unit.id === "ot");
    expect(looks(opened, closed)).toEqual({ count: 0, start: { shape: null, size: null }, end: { shape: null, size: null } });
  });
});

describe("le punte della selezione", () => {
  it("nessuna selezione non dice niente", () => {
    const opened = open(doc(DEFS() + LAYER + LINE("oa") + "</g>"));
    expect(looks(opened, [])).toEqual({ count: 0, start: { shape: null, size: null }, end: { shape: null, size: null } });
  });

  it("senza punte i capi sono «none» e la misura non c'è", () => {
    const opened = open(doc(DEFS() + LAYER + LINE("oa") + LINE("ob") + "</g>"));
    expect(looks(opened)).toEqual({ count: 2, start: { shape: "none", size: null }, end: { shape: "none", size: null } });
  });

  it("forma e misura in comune si dicono, per ogni capo", () => {
    const opened = open(
      doc(
        DEFS(MARKER("ma", "vee", "large", "end"), MARKER("mb", "vee", "large", "end", BLUE), MARKER("mc", "circle", "small", "start")) +
          LAYER + LINE("oa", ` stroke="${RED}"${ENDS("mc", "ma")}`) + LINE("ob", ` stroke="${BLUE}"${ENDS("mc", "mb")}`) + "</g>",
      ),
    );
    expect(looks(opened)).toEqual({ count: 2, start: { shape: "circle", size: "small" }, end: { shape: "vee", size: "large" } });
  });

  it("forme diverse non sono d'accordo, e una misura diversa lascia la forma", () => {
    const opened = open(
      doc(
        DEFS(MARKER("ma", "vee", "large", "end"), MARKER("mb", "vee", "small", "end"), MARKER("mc", "bar", "small", "end")) +
          LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "ma")}`) + LINE("ob", ` stroke="${RED}"${ENDS(null, "mb")}`) + "</g>",
      ),
    );
    expect(looks(opened).end).toEqual({ shape: "vee", size: null });
    const mixed = open(
      doc(
        DEFS(MARKER("ma", "vee", "large", "end"), MARKER("mc", "bar", "large", "end")) +
          LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "ma")}`) + LINE("ob", ` stroke="${RED}"${ENDS(null, "mc")}`) + "</g>",
      ),
    );
    expect(looks(mixed).end).toEqual({ shape: null, size: "large" });
  });

  it("una linea con la punta e una senza non sono d'accordo, ma la misura delle punte c'è", () => {
    const opened = open(doc(DEFS(MARKER("ma", "square", "small", "end")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "ma")}`) + LINE("ob") + "</g>"));
    expect(looks(opened).end).toEqual({ shape: null, size: "small" });
    expect(looks(opened).start).toEqual({ shape: "none", size: null });
  });

  it("un marcatore che non è della raccolta è «custom», e non dà misura", () => {
    const opened = open(doc(DEFS(CUSTOM("cm"), MARKER("ma", "vee", "large", "end")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "cm")}`) + LINE("ob", ` stroke="${RED}"${ENDS(null, "cm")}`) + "</g>"));
    expect(looks(opened).end).toEqual({ shape: "custom", size: null });
    const mixed = open(doc(DEFS(CUSTOM("cm"), MARKER("ma", "vee", "large", "end")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS(null, "cm")}`) + LINE("ob", ` stroke="${RED}"${ENDS(null, "ma")}`) + "</g>"));
    expect(looks(mixed).end).toEqual({ shape: null, size: "large" });
  });

  it("una punta nominata sul capo sbagliato si legge per quello che è, forma e misura", () => {
    const opened = open(doc(DEFS(MARKER("ma", "diamond", "medium", "end")) + LAYER + LINE("oa", ` stroke="${RED}"${ENDS("ma", null)}`) + "</g>"));
    expect(looks(opened).start).toEqual({ shape: "diamond", size: "medium" });
  });

  it("il marcatore di mezzo non conta", () => {
    const opened = open(doc(DEFS(MARKER("ma", "diamond", "medium", "end")) + LAYER + LINE("oa", ` stroke="${RED}" marker-mid="url(#ma)"`) + "</g>"));
    expect(looks(opened)).toEqual({ count: 1, start: { shape: "none", size: null }, end: { shape: "none", size: null } });
  });

  it("una parte bloccata dentro un gruppo scelto non conta, e un oggetto bloccato non si sceglie", () => {
    const opened = open(
      doc(
        DEFS() + LAYER +
          `<g id="og">${LINE("oa")}${LINE("ob", ` stroke="${RED}" fub:locked="true"`, 20)}${LINE("oc", ` stroke="${RED}"`, 30)}</g>` +
          "</g>",
      ),
    );
    expect(looks(opened).count).toBe(2);
  });
});

describe("il banco di fedeltà", () => {
  it("ha le punte come le scrive l'editor: ogni marcatore è della raccolta, e il seguito non ha niente da fare", () => {
    const opened = open(FIDELITY.find((scene) => scene.id === "punte")!.text);
    const markers = markersIn(opened);
    expect(markers).toHaveLength(14);
    for (const id of markers) expect(markerTip(leaf(opened, id)), id).not.toBeNull();
    settled(opened);
  });
});
