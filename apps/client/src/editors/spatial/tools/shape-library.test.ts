// Le raccolte di forme: il catalogo è fatto di ricette, e ogni ricetta deve
// stare nel suo riquadro a ogni misura, scrivere i numeri come il file e dare
// un `d` che si rilegge identico. I nomi vengono dal catalogo del disegno, in
// italiano e in inglese.

import { describe, expect, it } from "vitest";
import { BoundsBuilder, parsePath } from "../scene/geometry";
import { IDENTITY } from "../scene/matrix";
import { polygonalPath, readPolygonal, STAR_RATIO } from "../scene/parametric";
import { pathData } from "../scene/serialize";
import { formatNumber } from "../number";
import { drawStrings } from "../strings";
import { d, LIBRARY, LIBRARY_GROUPS, libraryShape, polygonPath, type LibraryPiece, type LibraryShape } from "./shape-library";

const IT = drawStrings.catalogFor("it");
const EN = drawStrings.catalogFor("en");

/// Il riquadro è rispettato entro questo scarto: il file scrive due decimali.
const SLACK = 0.01 + 1e-9;

/// Le misure con cui si prova ogni forma: quella di partenza, larga il doppio
/// e bassa la metà, due strette (alta e bassa), e una coi decimali.
function sizes(shape: LibraryShape): [number, number][] {
  const [w, h] = shape.size;
  return [[w, h], [2 * w, h / 2], [20, 200], [600, 30], [133.37, 77.77]];
}

const each = (run: (shape: LibraryShape, w: number, h: number) => void): void => {
  for (const shape of LIBRARY) for (const [w, h] of sizes(shape)) run(shape, w, h);
};

/// Il testo con cui il file scrive il numero `token`, a `decimals` decimali: se
/// è diverso, il numero ha più decimali o è «-0».
const written = (token: string, decimals = 2): string => formatNumber(Number(token), decimals);

/// Dove sta un pezzo, se ha una geometria: gli estremi `[x0, y0, x1, y1]`.
function extent(piece: LibraryPiece): [number, number, number, number] | null {
  const a = piece.attrs;
  const num = (name: string): number => Number(a[name]);
  switch (piece.tag) {
    case "rect": return [num("x"), num("y"), num("x") + num("width"), num("y") + num("height")];
    case "ellipse": return [num("cx") - num("rx"), num("cy") - num("ry"), num("cx") + num("rx"), num("cy") + num("ry")];
    case "circle": return [num("cx") - num("r"), num("cy") - num("r"), num("cx") + num("r"), num("cy") + num("r")];
    case "line": return [Math.min(num("x1"), num("x2")), Math.min(num("y1"), num("y2")), Math.max(num("x1"), num("x2")), Math.max(num("y1"), num("y2"))];
    case "text": return [num("x"), num("y"), num("x"), num("y")];
    case "path": {
      if (a["d"] === undefined) {
        // Una freccia sintetica: i due capi.
        const [x1, y1, x2, y2] = a["fub:geom"]!.split(" ").map(Number) as [number, number, number, number];
        return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
      }
      const segments = parsePath(a["d"]);
      if (segments === null) return null;
      const builder = new BoundsBuilder();
      builder.path(segments, IDENTITY);
      const bounds = builder.finish();
      return bounds === null ? null : [bounds.min[0], bounds.min[1], bounds.max[0], bounds.max[1]];
    }
  }
}

/// Vero se il pezzo è chiuso: un rettangolo, un'ellisse, un cerchio, un
/// poligono o una stella, o un tracciato con un sottotracciato chiuso da `Z`.
function closedPiece(piece: LibraryPiece): boolean {
  if (piece.tag === "rect" || piece.tag === "ellipse" || piece.tag === "circle") return true;
  if (piece.tag !== "path") return false;
  const shape = piece.attrs["fub:shape"];
  if (shape === "polygon" || shape === "star") return true;
  return /Z/.test(piece.attrs["d"] ?? "");
}

/// I sottotracciati del pezzo, uno per `M`.
const subpaths = (piece: LibraryPiece): string[] => (piece.attrs["d"] ?? "").split(/(?=M)/).map((part) => part.trim());

describe("le raccolte di forme", () => {
  it("hanno id diversi, in minuscolo e coi trattini, e nome diverso", () => {
    const ids = LIBRARY.map((shape) => shape.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(/^[a-z]+(-[a-z]+)+$/);
    for (const catalog of [IT, EN]) {
      const names = LIBRARY.map((shape) => catalog[shape.name]);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("vanno nell'ordine delle raccolte, e ogni raccolta ha forme", () => {
    const order = LIBRARY.map((shape) => LIBRARY_GROUPS.indexOf(shape.group));
    expect(order).not.toContain(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const group of LIBRARY_GROUPS) {
      expect(LIBRARY.filter((shape) => shape.group === group).length, group).toBeGreaterThan(0);
      expect(IT[`draw.library.group.${group}`], group).toBeDefined();
      expect(EN[`draw.library.group.${group}`], group).toBeDefined();
    }
  });

  it("ogni forma è fra le sue, col suo id", () => {
    for (const shape of LIBRARY) expect(libraryShape(shape.id)).toBe(shape);
    expect(libraryShape("non-ce")).toBeNull();
  });

  it("hanno il nome e le parole di ricerca nel catalogo, in italiano e in inglese", () => {
    for (const shape of LIBRARY) {
      expect(shape.name).toBe(`draw.library.${shape.id}`);
      for (const [lingua, catalog] of [["italiano", IT], ["inglese", EN]] as const) {
        expect(catalog[shape.name], `${shape.id} in ${lingua}`).toBeTruthy();
        expect(catalog[shape.name], `${shape.id} in ${lingua}`).not.toBe(shape.name);
        if (shape.words === undefined) continue;
        expect(shape.words).toBe(`${shape.name}.words`);
        const words = catalog[shape.words];
        expect(words, `le parole di ${shape.id} in ${lingua}`).toBeTruthy();
        expect(words, `le parole di ${shape.id} in ${lingua}`).not.toBe(shape.words);
        for (const word of words!.split(",")) expect(word.trim(), `una parola vuota in ${shape.id}`).not.toBe("");
      }
    }
  });

  it("non lasciano voci del catalogo senza forma", () => {
    const keys = new Set<string>(LIBRARY_GROUPS.map((group) => `draw.library.group.${group}`));
    for (const shape of LIBRARY) {
      keys.add(shape.name);
      if (shape.words !== undefined) keys.add(shape.words);
    }
    for (const catalog of [IT, EN]) {
      const own = Object.keys(catalog).filter((key) => key.startsWith("draw.library."));
      expect(own.sort()).toEqual([...keys].sort());
    }
  });

  it("partono da una misura di almeno 20 unità per lato", () => {
    for (const shape of LIBRARY) {
      expect(shape.size[0], shape.id).toBeGreaterThanOrEqual(20);
      expect(shape.size[1], shape.id).toBeGreaterThanOrEqual(20);
    }
  });

  it("danno pezzi uguali a ogni costruzione", () => {
    each((shape, w, h) => expect(shape.build(w, h), `${shape.id} ${w}×${h}`).toEqual(shape.build(w, h)));
  });

  it("danno almeno un pezzo, e il testo solo ai pezzi di testo, d'una riga", () => {
    each((shape, w, h) => {
      const pieces = shape.build(w, h);
      expect(pieces.length, `${shape.id} ${w}×${h}`).toBeGreaterThan(0);
      for (const piece of pieces) {
        if (piece.tag === "text") {
          expect(piece.paint).toBe("text");
          expect(piece.text, shape.id).toMatch(/^[^\n\r]+$/);
          expect(["start", "middle", "end"]).toContain(piece.attrs["text-anchor"]);
          expect(Number(piece.attrs["font-size"]), shape.id).toBeGreaterThan(0);
        } else {
          expect(piece.paint, shape.id).not.toBe("text");
          expect(piece.text, shape.id).toBeUndefined();
        }
      }
    });
  });

  it("scrivono i `d` coi soli comandi M, L, C e Z, e li rileggono identici", () => {
    each((shape, w, h) => {
      for (const piece of shape.build(w, h)) {
        const data = piece.attrs["d"];
        if (data === undefined) continue;
        const where = `${shape.id} ${w}×${h}`;
        expect(data, where).toMatch(/^[MLCZ0-9 .-]+$/);
        const segments = parsePath(data);
        expect(segments, where).not.toBeNull();
        for (const segment of segments!) expect(["move", "line", "cubic", "close"], where).toContain(segment.kind);
        expect(pathData(segments!), where).toBe(data);
      }
    });
  });

  it("scrivono ogni numero con al più due decimali, e mai «-0»", () => {
    each((shape, w, h) => {
      for (const piece of shape.build(w, h)) {
        for (const [name, value] of Object.entries(piece.attrs)) {
          if (name === "text-anchor" || name === "fub:shape") continue;
          const tokens = value.match(/-?\d+(?:\.\d+)?/g) ?? [];
          expect(tokens.length, `${shape.id} ${name}`).toBeGreaterThan(0);
          expect(value, `${shape.id} ${name}`).not.toMatch(/NaN|Infinity|e[+-]?\d/);
          // Il rapporto di una stella, nella sua geometria, ha quattro decimali.
          const ratio = piece.attrs["fub:shape"] === "star" && name === "fub:geom" ? 4 : -1;
          tokens.forEach((token, i) => expect(token, `${shape.id} ${w}×${h} ${name}=${value}`).toBe(written(token, i === ratio ? 4 : 2)));
        }
      }
    });
  });

  it("stanno nel riquadro, a ogni misura", () => {
    each((shape, w, h) => {
      for (const piece of shape.build(w, h)) {
        const at = extent(piece);
        const where = `${shape.id} ${w}×${h} ${piece.tag}`;
        expect(at, where).not.toBeNull();
        const [x0, y0, x1, y1] = at!;
        expect(x0, where).toBeGreaterThanOrEqual(-SLACK);
        expect(y0, where).toBeGreaterThanOrEqual(-SLACK);
        expect(x1, where).toBeLessThanOrEqual(w + SLACK);
        expect(y1, where).toBeLessThanOrEqual(h + SLACK);
      }
    });
  });

  it("riempiono il riquadro: toccano tutti e quattro i lati, tranne le forme regolari e i fogli", () => {
    const regular = new Set(["basic-pentagon", "basic-hexagon", "basic-octagon", "basic-star", "school-axes", "school-number-line", "school-squared", "school-lined", "callout-thought"]);
    each((shape, w, h) => {
      if (regular.has(shape.id)) return;
      const boxes = shape.build(w, h).filter((piece) => piece.tag !== "text").map(extent);
      const left = Math.min(...boxes.map((b) => b![0]));
      const top = Math.min(...boxes.map((b) => b![1]));
      const right = Math.max(...boxes.map((b) => b![2]));
      const bottom = Math.max(...boxes.map((b) => b![3]));
      const where = `${shape.id} ${w}×${h}`;
      expect(left, where).toBeLessThan(0.02);
      expect(top, where).toBeLessThan(0.02);
      expect(right, where).toBeGreaterThan(w - 0.02);
      expect(bottom, where).toBeGreaterThan(h - 0.02);
    });
  });

  it("sono chiuse come dicono: un pezzo solo, chiuso, e le forme della scuola nessun pezzo chiuso", () => {
    each((shape, w, h) => {
      const built = shape.build(w, h);
      const where = `${shape.id} ${w}×${h}`;
      expect(built.length === 1 && closedPiece(built[0]!), where).toBe(shape.closed);
      if (!shape.closed) expect(built.some(closedPiece), where).toBe(false);
    });
    for (const shape of LIBRARY) expect(shape.closed, shape.id).toBe(shape.group !== "school");
  });

  it("non hanno punte rovesciate: il contorno principale non si attorciglia", () => {
    // Un tracciato chiuso di soli segmenti dritti, come i poligoni della
    // raccolta, ha area diversa da 0 a ogni misura: non collassa.
    each((shape, w, h) => {
      for (const piece of shape.build(w, h)) {
        const data = piece.attrs["d"];
        if (data === undefined || /C/.test(data) || !data.endsWith("Z") || (data.match(/M/g) ?? []).length !== 1) continue;
        const points = [...data.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m): [number, number] => [Number(m[1]), Number(m[2])]);
        let area = 0;
        points.forEach(([x, y], i) => {
          const [nx, ny] = points[(i + 1) % points.length]!;
          area += x * ny - nx * y;
        });
        expect(Math.abs(area) / 2, `${shape.id} ${w}×${h}`).toBeGreaterThan(0.1);
      }
    });
  });
});

describe("le forme sintetiche", () => {
  const polygons: [string, "polygon" | "star", number][] = [
    ["basic-pentagon", "polygon", 5],
    ["basic-hexagon", "polygon", 6],
    ["basic-octagon", "polygon", 8],
    ["basic-star", "star", 5],
  ];

  it("il poligono e la stella si rileggono con la geometria sintetica, a ogni misura", () => {
    for (const [id, kind, count] of polygons) {
      const shape = libraryShape(id)!;
      for (const [w, h] of sizes(shape)) {
        const pieces = shape.build(w, h);
        expect(pieces, `${id} ${w}×${h}`).toHaveLength(1);
        const attrs = pieces[0]!.attrs;
        expect(attrs["fub:shape"]).toBe(kind);
        const read = readPolygonal(kind, attrs["fub:geom"]!);
        expect(read, `${id} ${w}×${h}`).not.toBeNull();
        expect(read!.count).toBe(count);
        expect(read!.rotation).toBe(0);
        expect(read!.corner).toBe(0);
        if (kind === "star") expect(read!.ratio).toBe(STAR_RATIO);
        expect(attrs["d"], `${id} ${w}×${h}`).toBe(polygonalPath(read!));
      }
    }
  });

  it("il poligono prende il raggio più grande che sta nel riquadro, a centro del riquadro", () => {
    // Un esagono ha i vertici a destra e a sinistra, larghi due raggi, e i lati
    // piatti in alto e in basso, alti √3 raggi: in 160 × 139 sta quasi giusto.
    const hexagon = libraryShape("basic-hexagon")!;
    const read = readPolygonal("polygon", hexagon.build(160, 139)[0]!.attrs["fub:geom"]!)!;
    expect(read.r).toBeGreaterThan(79.9);
    expect(read.r).toBeLessThanOrEqual(80);
    expect(read.cx).toBeCloseTo(80, 1);
    expect(read.cy).toBeCloseTo(69.5, 1);
    // In un riquadro largo il limite è l'altezza, e la forma resta al centro.
    const wide = readPolygonal("polygon", hexagon.build(600, 100)[0]!.attrs["fub:geom"]!)!;
    expect(wide.r).toBeCloseTo(100 / Math.sqrt(3), 1);
    expect(wide.cx).toBeCloseTo(300, 1);
    expect(wide.cy).toBeCloseTo(50, 1);
  });

  it("le frecce sono frecce sintetiche con quattro numeri, senza `d`", () => {
    for (const id of ["school-axes", "school-number-line"]) {
      const shape = libraryShape(id)!;
      for (const [w, h] of sizes(shape)) {
        const arrows = shape.build(w, h).filter((piece) => piece.attrs["fub:shape"] === "arrow");
        expect(arrows.length, id).toBeGreaterThan(0);
        for (const arrow of arrows) {
          expect(arrow.tag).toBe("path");
          expect(arrow.attrs["d"]).toBeUndefined();
          expect(arrow.attrs["fub:geom"]!.split(" "), id).toHaveLength(4);
          expect(arrow.paint).toBe("outline");
        }
      }
    }
  });
});

describe("le forme, una per una", () => {
  const pieces = (id: string, w?: number, h?: number): readonly LibraryPiece[] => {
    const shape = libraryShape(id)!;
    return shape.build(w ?? shape.size[0], h ?? shape.size[1]);
  };

  it("il rettangolo arrotondato ha gli angoli del 15% del lato corto, il terminatore a capsula", () => {
    expect(pieces("basic-rounded")[0]!.attrs).toEqual({ x: "0", y: "0", width: "160", height: "100", rx: "15", ry: "15" });
    expect(pieces("basic-rounded", 20, 200)[0]!.attrs["rx"]).toBe("3");
    expect(pieces("flow-terminator")[0]!.attrs).toMatchObject({ width: "160", height: "70", rx: "35", ry: "35" });
    expect(pieces("flow-terminator", 20, 200)[0]!.attrs["rx"]).toBe("10");
  });

  it("l'ellisse e il cerchio riempiono il riquadro", () => {
    expect(pieces("basic-ellipse")[0]).toEqual({ tag: "ellipse", attrs: { cx: "80", cy: "50", rx: "80", ry: "50" }, paint: "outline" });
    expect(pieces("basic-circle")[0]!.attrs).toEqual({ cx: "50", cy: "50", rx: "50", ry: "50" });
  });

  it("il triangolo ha la punta in alto, quello rettangolare l'angolo retto in basso a sinistra", () => {
    expect(pieces("basic-triangle")[0]!.attrs["d"]).toBe(polygonPath([[70, 0], [140, 120], [0, 120]]));
    expect(pieces("basic-right-triangle")[0]!.attrs["d"]).toBe("M0 0 L120 120 L0 120 Z");
  });

  it("il trapezio ha la base lunga in basso, l'operazione manuale in alto", () => {
    expect(pieces("basic-trapezoid")[0]!.attrs["d"]).toBe("M32 0 L128 0 L160 100 L0 100 Z");
    expect(pieces("flow-manual-operation")[0]!.attrs["d"]).toBe("M0 0 L160 0 L128 90 L32 90 Z");
  });

  it("la croce ha le braccia di un terzo", () => {
    expect(pieces("basic-cross")[0]!.attrs["d"]).toBe("M40 0 L80 0 L80 40 L120 40 L120 80 L80 80 L80 120 L40 120 L40 80 L0 80 L0 40 L40 40 Z");
  });

  it("il cuore e le curve dei fumetti usano solo curve di Bézier", () => {
    expect(pieces("basic-heart")[0]!.attrs["d"]).toMatch(/^M70 126 C/);
    expect(pieces("callout-oval")[0]!.attrs["d"]).toMatch(/C/);
    expect(pieces("callout-oval")[0]!.attrs["d"]).not.toMatch(/A/);
  });

  it("il processo predefinito ha due righe verticali, la memoria interna una in alto e una a sinistra, nel tracciato del riquadro", () => {
    expect(pieces("flow-predefined").map((piece) => piece.attrs["d"])).toEqual(["M0 0 L160 0 L160 100 L0 100 Z M16 0 L16 100 M144 0 L144 100"]);
    expect(pieces("flow-internal-storage").map((piece) => piece.attrs["d"])).toEqual(["M0 0 L160 0 L160 100 L0 100 Z M0 15 L160 15 M19.2 0 L19.2 100"]);
  });

  it("il documento ha il fondo a onda e il database un tracciato, chiuso e poi aperto", () => {
    const document = pieces("flow-document")[0]!.attrs["d"]!;
    expect(document.match(/C/g)).toHaveLength(2);
    expect(document.endsWith("Z")).toBe(true);
    const database = pieces("flow-database");
    expect(database).toHaveLength(1);
    // Il profilo, chiuso, e la parte anteriore del disco, aperta.
    expect(subpaths(database[0]!).map((part) => part.endsWith("Z"))).toEqual([true, false]);
  });

  it("più documenti sono un tracciato: quello davanti, chiuso, e il margine degli altri due, aperto", () => {
    const multi = pieces("flow-multidocument");
    expect(multi).toHaveLength(1);
    expect(subpaths(multi[0]!).map((part) => part.endsWith("Z"))).toEqual([true, false, false]);
  });

  it("i fumetti hanno il corpo nei tre quarti in alto e la coda in basso a sinistra", () => {
    for (const id of ["callout-rectangle", "callout-rounded", "callout-oval"]) {
      const piece = pieces(id)[0]!;
      const segments = parsePath(piece.attrs["d"]!)!;
      // L'ultimo punto prima di chiudere, o il più basso, è la punta: sta in
      // fondo al riquadro e a sinistra del suo centro.
      const points = segments.flatMap((s) => (s.kind === "close" ? [] : [s.to]));
      const tip = points.reduce((low, p) => (p[1] > low[1] ? p : low));
      expect(tip[1], id).toBeCloseTo(120, 2);
      expect(tip[0], id).toBeLessThan(80);
      // Il corpo, senza la coda, non scende oltre i tre quarti.
      const body = points.filter((p) => p !== tip && p[1] <= 90.01);
      expect(body.length, id).toBeGreaterThan(2);
    }
  });

  it("la nuvoletta del pensiero è una nuvola e due cerchi piccoli in basso a sinistra, ognuno chiuso, in un tracciato", () => {
    const thought = pieces("callout-thought");
    expect(thought).toHaveLength(1);
    const [cloud, big, small] = subpaths(thought[0]!).map((part) => {
      expect(part.endsWith("Z"), part).toBe(true);
      return extent({ tag: "path", attrs: { d: part }, paint: "outline" })!;
    });
    expect(small![2] - small![0]).toBeLessThan(big![2] - big![0]);
    for (const circle of [big!, small!]) {
      // Tondi, a sinistra del centro, e sotto la nuvola.
      expect(circle[2] - circle[0]).toBeCloseTo(circle[3] - circle[1], 1);
      expect((circle[0] + circle[2]) / 2).toBeLessThan(80);
      expect(circle[1]).toBeGreaterThan(cloud![3]);
    }
  });

  it("la nuvola e l'esplosione sono un solo tracciato chiuso", () => {
    expect(pieces("callout-cloud")).toHaveLength(1);
    expect(pieces("callout-burst")).toHaveLength(1);
    expect(pieces("callout-burst")[0]!.attrs["d"]).not.toMatch(/C/);
    expect(pieces("callout-cloud")[0]!.attrs["d"]).toMatch(/C/);
  });

  it("le frecce piene hanno l'asta di metà altezza e la punta di un terzo della lunghezza", () => {
    expect(pieces("arrow-right")[0]!.attrs["d"]).toBe("M0 25 L106.67 25 L106.67 0 L160 50 L106.67 100 L106.67 75 L0 75 Z");
    expect(pieces("arrow-left")[0]!.attrs["d"]).toBe("M160 25 L53.33 25 L53.33 0 L0 50 L53.33 100 L53.33 75 L160 75 Z");
    expect(pieces("arrow-up")[0]!.attrs["d"]).toBe("M25 160 L25 53.33 L0 53.33 L50 0 L100 53.33 L75 53.33 L75 160 Z");
    expect(pieces("arrow-down")[0]!.attrs["d"]).toBe("M25 0 L25 106.67 L0 106.67 L50 160 L100 106.67 L75 106.67 L75 0 Z");
  });

  it("le frecce a due punte, a quattro direzioni, il gallone e il pentagono sono un solo tracciato chiuso", () => {
    for (const id of ["arrow-left-right", "arrow-up-down", "arrow-quad", "arrow-chevron", "arrow-pentagon", "arrow-u-turn"]) {
      const shape = pieces(id);
      expect(shape, id).toHaveLength(1);
      expect(closedPiece(shape[0]!), id).toBe(true);
      expect((shape[0]!.attrs["d"]!.match(/M/g) ?? []).length, id).toBe(1);
    }
    expect(pieces("arrow-quad")[0]!.attrs["d"]!.match(/L/g)).toHaveLength(23);
    expect(pieces("arrow-chevron")[0]!.attrs["d"]).toBe("M0 0 L100 0 L140 50 L100 100 L0 100 L40 50 Z");
    expect(pieces("arrow-pentagon")[0]!.attrs["d"]).toBe("M0 0 L100 0 L140 50 L100 100 L0 100 Z");
  });

  it("gli assi hanno le tacche ogni 40 unità dall'origine, e le lettere x, y e O", () => {
    const axes = pieces("school-axes");
    expect(axes.map((piece) => piece.paint)).toEqual(["outline", "outline", "fine", "text", "text", "text"]);
    expect(axes[0]!.attrs["fub:geom"]).toBe("0 200 400 200");
    expect(axes[1]!.attrs["fub:geom"]).toBe("200 400 200 0");
    const ticks = axes[2]!.attrs["d"]!;
    expect(ticks.match(/M/g)).toHaveLength(16);
    expect(ticks).toContain("M160 196 L160 204");
    expect(ticks).toContain("M360 196 L360 204");
    expect(ticks).toContain("M196 40 L204 40");
    expect(ticks).toContain("M196 360 L204 360");
    expect(ticks).not.toContain("M200 196");
    expect(axes.slice(3).map((piece) => piece.text)).toEqual(["x", "y", "O"]);
    // In un riquadro più largo l'origine resta su un multiplo di 40.
    expect(pieces("school-axes", 600, 400)[0]!.attrs["fub:geom"]).toBe("0 200 600 200");
    expect(pieces("school-axes", 600, 400)[1]!.attrs["fub:geom"]).toBe("320 400 320 0");
  });

  it("la retta dei numeri ha undici tacche, una ogni passo, e i numeri da 0 a 10 sotto", () => {
    const line = pieces("school-number-line");
    expect(line[0]!.attrs["fub:shape"]).toBe("arrow");
    expect(line[1]!.paint).toBe("fine");
    expect(line[1]!.attrs["d"]!.match(/M/g)).toHaveLength(11);
    const numbers = line.slice(2);
    expect(numbers.map((piece) => piece.text)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    for (const piece of numbers) expect(piece.attrs["font-size"]).toBe("16");
    const xs = numbers.map((piece) => Number(piece.attrs["x"]));
    expect(xs[0]).toBe(30);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeCloseTo(40, 6);
    // I numeri stanno sotto le tacche.
    const tickBottom = Math.max(...[...line[1]!.attrs["d"]!.matchAll(/L[\d.]+ ([\d.]+)/g)].map((m) => Number(m[1])));
    for (const piece of numbers) expect(Number(piece.attrs["y"])).toBeGreaterThan(tickBottom + 8);
  });

  it("i numeri della retta si rimpiccioliscono in un riquadro basso o stretto, e non si toccano", () => {
    for (const [w, h] of [[207, 72], [828, 24], [20, 200]] as const) {
      const numbers = pieces("school-number-line", w, h).filter((piece) => piece.tag === "text");
      const size = Number(numbers[0]!.attrs["font-size"]);
      const step = Number(numbers[1]!.attrs["x"]) - Number(numbers[0]!.attrs["x"]);
      expect(size, `${w}×${h}`).toBeGreaterThan(0);
      expect(size, `${w}×${h}`).toBeLessThan(16);
      expect(size * 1.2 + 0.01, `${w}×${h}`).toBeLessThan(step);
    }
  });

  it("il foglio a quadretti ha quadretti di 20 unità, e quello a righe una riga ogni 30", () => {
    const squared = pieces("school-squared");
    expect(squared).toHaveLength(1);
    expect(squared[0]!.paint).toBe("paper");
    const vertical = [...squared[0]!.attrs["d"]!.matchAll(/M([\d.]+) 0 L[\d.]+ 280/g)].map((m) => Number(m[1]));
    const horizontal = [...squared[0]!.attrs["d"]!.matchAll(/M0 ([\d.]+) L400 [\d.]+/g)].map((m) => Number(m[1]));
    expect(vertical).toEqual(Array.from({ length: 21 }, (_, i) => 20 * i));
    expect(horizontal).toEqual(Array.from({ length: 15 }, (_, i) => 20 * i));
    // Un riquadro che non è un multiplo di 20 ha il bordo in fondo.
    expect(pieces("school-squared", 410, 270)[0]!.attrs["d"]).toContain("M410 0 L410 270");
    expect(pieces("school-squared", 410, 270)[0]!.attrs["d"]).toContain("M0 270 L410 270");
    const lined = pieces("school-lined");
    expect(lined).toHaveLength(1);
    expect(lined[0]!.paint).toBe("paper");
    const rows = [...lined[0]!.attrs["d"]!.matchAll(/M0 ([\d.]+) L400 [\d.]+/g)].map((m) => Number(m[1]));
    expect(rows).toEqual(Array.from({ length: 11 }, (_, i) => 30 * i));
  });

  it("un foglio enorme non diventa mille righe", () => {
    const huge = pieces("school-squared", 100000, 100000)[0]!.attrs["d"]!;
    expect((huge.match(/M/g) ?? []).length).toBeLessThanOrEqual(1010);
    expect(parsePath(huge)).not.toBeNull();
  });
});

describe("gli aiuti dei tracciati", () => {
  it("`d` attacca il comando al numero che segue e scrive i numeri come il file", () => {
    expect(d("M", 0, 0, "L", 10, 0, "Z")).toBe("M0 0 L10 0 Z");
    expect(d("M", 1.006, -0.001, "C", 1, 2, 3, 4, 5.678, 6)).toBe("M1.01 0 C1 2 3 4 5.68 6");
    expect(d()).toBe("");
  });

  it("`polygonPath` chiude il tracciato dai punti", () => {
    expect(polygonPath([[0, 0], [10, 0], [5, 8.5]])).toBe("M0 0 L10 0 L5 8.5 Z");
  });
});
