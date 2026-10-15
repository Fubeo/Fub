// Una forma delle raccolte che entra nel disegno: dal riquadro che deve
// occupare, nelle coordinate di chi la riceve, all'elemento da aggiungere.
// Niente DOM: l'editor dà il riquadro, lo stile e il nome, e riceve un
// elemento solo (un pezzo) o un gruppo (più pezzi) pronto per l'`add`.
//
// - **Coordinate assolute.** I pezzi si costruiscono nel riquadro da (0, 0) e
//   poi si portano al loro posto riscrivendo i numeri, mai con una
//   `transform`: un tracciato rilegge il suo `d` e lo riscrive, un'ellisse
//   sposta il centro, un poligono o una stella il centro della sua
//   geometria, una freccia i suoi quattro numeri. Chi apre il file vede una
//   forma come quelle disegnate a mano.
// - **Lo stile è quello delle forme disegnate.** Un contorno non ha
//   riempimento e prende il colore e lo spessore scelti; una linea di
//   servizio, come una tacca, lo stesso colore a metà spessore; le righe di
//   un foglio di quaderno sono d'un azzurro chiaro fisso e sottili; un testo
//   ha il colore scelto, i caratteri di uno nuovo e la misura del suo pezzo.
// - **Il nome.** È il primo figlio, un `<title>`: lo legge chi legge il file
//   e chi lo apre con un lettore dello schermo. Un pezzo solo è quell'elemento
//   col suo `<title>`; più pezzi sono un gruppo, che ha il `<title>` e poi i
//   pezzi.

import { formatNumber } from "../number";
import type { Bounds, Segment } from "../scene/geometry";
import { parsePath } from "../scene/geometry";
import { apply, type Matrix, type Point } from "../scene/matrix";
import { polygonalAttrs, readPolygonal, type PolygonalShape } from "../scene/parametric";
import { pathData, type Elem } from "../scene/serialize";
import type { NewIds } from "./edit";
import type { LibraryPiece, LibraryShape } from "./shape-library";
import { arrowPath, type ShapeStyle } from "./shapes";
import { TEXT_FAMILY } from "./text";

/// Il colore delle righe di un foglio di quaderno: fisso, perché sono un
/// fondo e non un contorno.
export const PAPER_COLOR = "#9ecbef";

/// Lo spessore delle righe di un foglio di quaderno.
export const PAPER_WIDTH = 1;

/// Un numero come lo scrive il file.
const n = (value: number): string => formatNumber(value, 2);

/// Le proprietà che dicono una posizione lungo x, e lungo y.
const ALONG_X: ReadonlySet<string> = new Set(["x", "cx", "x1", "x2"]);
const ALONG_Y: ReadonlySet<string> = new Set(["y", "cy", "y1", "y2"]);

/// Il tracciato `d` portato di (`dx`, `dy`): riletto, spostato e riscritto.
function shiftedPath(d: string, dx: number, dy: number): string {
  const segments = parsePath(d);
  if (segments === null) throw new Error(`tracciato della forma illeggibile: ${d}`);
  const by = ([x, y]: Point): Point => [x + dx, y + dy];
  return pathData(
    segments.map((segment): Segment => {
      switch (segment.kind) {
        case "move":
        case "line":
          return { kind: segment.kind, to: by(segment.to) };
        case "quad":
          return { kind: "quad", control: by(segment.control), to: by(segment.to) };
        case "cubic":
          return { kind: "cubic", c1: by(segment.c1), c2: by(segment.c2), to: by(segment.to) };
        case "arc":
          return { ...segment, to: by(segment.to) };
        case "close":
          return segment;
      }
    }),
  );
}

/// La geometria di `piece` portata di (`dx`, `dy`), con `width` lo spessore
/// con cui si disegna: un poligono o una stella rifanno `d` dalla loro
/// geometria, una freccia dai suoi quattro numeri.
function movedGeometry(piece: LibraryPiece, dx: number, dy: number, width: number): Record<string, string> {
  const kind = piece.attrs["fub:shape"];
  const geom = piece.attrs["fub:geom"] ?? "";
  if (kind === "polygon" || kind === "star") {
    const read = readPolygonal(kind as PolygonalShape, geom);
    const written = read === null ? null : polygonalAttrs({ ...read, cx: read.cx + dx, cy: read.cy + dy });
    if (written === null) throw new Error(`geometria della forma illeggibile: ${geom}`);
    return { ...written };
  }
  if (kind === "arrow") {
    const [x1, y1, x2, y2] = geom.split(" ").map(Number) as [number, number, number, number];
    // Gli estremi si arrotondano prima, come li rilegge chi apre il file.
    const ends = [x1 + dx, y1 + dy, x2 + dx, y2 + dy].map((value) => Number(n(value))) as [number, number, number, number];
    return { "fub:shape": "arrow", "fub:geom": ends.map(n).join(" "), d: arrowPath(...ends, width) };
  }
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(piece.attrs)) {
    if (name === "d") out.d = shiftedPath(value, dx, dy);
    else if (ALONG_X.has(name)) out[name] = n(Number(value) + dx);
    else if (ALONG_Y.has(name)) out[name] = n(Number(value) + dy);
    else out[name] = value;
  }
  return out;
}

/// L'elemento di `piece`, con l'id `id`, portato di (`dx`, `dy`) e dipinto
/// con `style`.
function pieceElem(piece: LibraryPiece, dx: number, dy: number, style: ShapeStyle, id: string): Elem {
  switch (piece.paint) {
    case "outline": {
      const width = n(style.width);
      const arrow = piece.attrs["fub:shape"] === "arrow";
      const attrs = { id, ...movedGeometry(piece, dx, dy, Number(width)), fill: "none", stroke: style.color, "stroke-width": width };
      return { tag: piece.tag, attrs: arrow ? { ...attrs, "stroke-linecap": "round", "stroke-linejoin": "round" } : attrs };
    }
    case "fine": {
      const width = n(style.width / 2);
      return { tag: piece.tag, attrs: { id, ...movedGeometry(piece, dx, dy, Number(width)), fill: "none", stroke: style.color, "stroke-width": width } };
    }
    case "paper": {
      const width = n(PAPER_WIDTH);
      return { tag: piece.tag, attrs: { id, ...movedGeometry(piece, dx, dy, Number(width)), fill: "none", stroke: PAPER_COLOR, "stroke-width": width } };
    }
    case "text": {
      const moved = movedGeometry(piece, dx, dy, 0);
      const { "font-size": size, ...place } = moved;
      // Come scrive un testo nuovo lo strumento Testo: una riga in un `tspan`
      // sotto il `text`, ancorata dove il pezzo la mette.
      return {
        tag: "text",
        attrs: { id, ...place, fill: style.color, "font-family": TEXT_FAMILY, ...(size === undefined ? {} : { "font-size": size }) },
        children: [{ tag: "tspan", attrs: { x: place.x ?? "0", dy: "0" }, text: piece.text ?? "" }],
      };
    }
  }
}

/// L'elemento della forma `shape` nel riquadro `box`, con lo stile `style` e
/// il nome `name` nel `<title>`; ogni elemento, il gruppo compreso, ha un id
/// da `ids`, il `<title>` no. `box` è nelle coordinate di chi riceve la
/// forma.
export function libraryElem(shape: LibraryShape, box: Bounds, style: ShapeStyle, name: string, ids: NewIds): Elem {
  const [x, y] = box.min;
  const pieces = shape.build(box.max[0] - x, box.max[1] - y);
  const title: readonly Elem[] = name === "" ? [] : [{ tag: "title", attrs: {}, text: name }];
  if (pieces.length === 1) {
    const only = pieceElem(pieces[0]!, x, y, style, ids.next("object"));
    return { ...only, children: [...title, ...(only.children ?? [])] };
  }
  const id = ids.next("object");
  return { tag: "g", attrs: { id }, children: [...title, ...pieces.map((piece) => pieceElem(piece, x, y, style, ids.next("object")))] };
}

/// `elem` come lo si fa vedere mentre si sceglie dove metterlo: senza i
/// `<title>`, che il nome non deve ripetere, e senza gli id, che ancora non
/// ci sono; a ogni profondità.
export function forPreview(elem: Elem): Elem {
  const { id: _id, ...attrs } = elem.attrs;
  if (elem.children === undefined) return { ...elem, attrs };
  return { ...elem, attrs, children: elem.children.filter((child) => child.tag !== "title").map(forPreview) };
}

/// Il riquadro della forma `shape` nella scena, con il centro in `center`,
/// della misura con cui s'inserisce.
export function boxAround(shape: LibraryShape, center: Point): Bounds {
  const [width, height] = shape.size;
  return { min: [center[0] - width / 2, center[1] - height / 2], max: [center[0] + width / 2, center[1] + height / 2] };
}

/// Il riquadro `box`, della scena, nelle coordinate del livello che ha
/// `inverse`: i due angoli opposti, come un rettangolo tirato in diagonale.
/// Una scala del livello divide la misura; una rotazione la ruota con lui.
export function boxIn(box: Bounds, inverse: Matrix): Bounds {
  const a = apply(inverse, box.min);
  const b = apply(inverse, box.max);
  return { min: [Math.min(a[0], b[0]), Math.min(a[1], b[1])], max: [Math.max(a[0], b[0]), Math.max(a[1], b[1])] };
}
