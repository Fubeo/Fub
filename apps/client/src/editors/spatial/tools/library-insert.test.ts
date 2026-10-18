// Una forma delle raccolte che entra nel disegno: l'elemento scritto in
// coordinate assolute, lo stile delle forme disegnate, il nome nel `<title>`,
// che il motore lo accetti, lo riscriva uguale e lo riconosca per quello
// che è, e che una forma chiusa possa avere un'etichetta.

import { describe, expect, it } from "vitest";
import type { Bounds } from "../scene/geometry";
import { parsePath } from "../scene/geometry";
import { IDENTITY } from "../scene/matrix";
import { readPolygonal } from "../scene/parametric";
import { doc } from "../scene/test-support";
import { drawStrings } from "../strings";
import type { Elem } from "../scene/serialize";
import { NewIds } from "./edit";
import { labelable, textBox } from "./label-hosts";
import { boxAround, boxIn, libraryElem, PAPER_COLOR, PAPER_WIDTH, forPreview } from "./library-insert";
import { LIBRARY, libraryShape, type LibraryShape } from "./shape-library";
import { arrowPath } from "./shapes";
import { TEXT_FAMILY } from "./text";
import { LAYER, open, type Opened } from "./test-support";

const IT = drawStrings.catalogFor("it");
const STYLE = { color: "#0072b2", width: 3 };

/// Il riquadro con l'angolo in (`x`, `y`), spostato di mezzo e di un quarto
/// di unità: i numeri non cadono mai su un intero.
const ORIGIN: readonly [number, number] = [37.5, -12.25];

const boxOf = (width: number, height: number, [x, y]: readonly [number, number] = ORIGIN): Bounds => ({ min: [x, y], max: [x + width, y + height] });

/// Le due misure con cui si prova ogni forma: quella di partenza e una
/// dispari, stretta da una parte e coi decimali.
function boxes(shape: LibraryShape): Bounds[] {
  const [w, h] = shape.size;
  return [boxOf(w, h), boxOf(133.37, 77.77), boxOf(w * 0.6, h * 1.7)];
}

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

const EMPTY = (): string => doc(`${LAYER}</g>`);

/// Aggiunge `elem` al livello del documento di prova e dà il motore aperto.
function inserted(elem: Elem, opened = open(EMPTY())): Opened {
  const outcome = opened.engine.apply({ op: "add", parent: "l1", pos: { last: true }, elem });
  if (outcome.outcome !== "applied") throw new Error(`rifiutato: ${outcome.detail}`);
  return opened;
}

/// Il ruolo con cui il motore deve riconoscere la forma.
function roleOf(shape: LibraryShape, box: Bounds): string {
  const pieces = shape.build(box.max[0] - box.min[0], box.max[1] - box.min[1]);
  if (pieces.length > 1) return "group";
  const piece = pieces[0]!;
  const kind = piece.attrs["fub:shape"];
  if (kind === "polygon") return "ngon";
  return kind ?? piece.tag;
}

/// Tutti gli elementi di `elem`, lui compreso, in ordine di documento.
function walk(elem: Elem): Elem[] {
  return [elem, ...(elem.children ?? []).flatMap(walk)];
}

/// I decimali con cui `value` è scritto.
const decimals = (value: string): number => (value.split(".")[1] ?? "").length;

describe("libraryElem", () => {
  it("scrive ogni forma in coordinate assolute, che il motore accetta e riconosce", () => {
    for (const shape of LIBRARY) {
      for (const box of boxes(shape)) {
        const opened = open(EMPTY());
        const elem = libraryElem(shape, box, STYLE, "Prova", ids(opened));
        const where = `${shape.id} ${box.max[0] - box.min[0]}×${box.max[1] - box.min[1]}`;
        for (const each of walk(elem)) expect(each.attrs.transform, where).toBeUndefined();
        inserted(elem, opened);
        const index = opened.reindex();
        const unit = index.units.find((each) => each.id === elem.attrs.id);
        expect(unit, where).toBeDefined();
        expect(unit!.role, where).toBe(roleOf(shape, box));
        expect(index.units, where).toHaveLength(1);
      }
    }
  });

  it("si rilegge uguale, senza residui, e il suo annulla riporta il testo di prima", () => {
    for (const shape of LIBRARY) {
      const opened = open(EMPTY());
      const before = opened.engine.text;
      const elem = libraryElem(shape, boxes(shape)[1]!, STYLE, "Prova", ids(opened));
      const outcome = opened.engine.apply({ op: "add", parent: "l1", pos: { last: true }, elem });
      if (outcome.outcome !== "applied") throw new Error(`${shape.id} rifiutata: ${outcome.detail}`);
      const again = open(opened.engine.text);
      expect(again.engine.status, shape.id).toBe("fubdraw");
      expect(again.engine.text, shape.id).toBe(opened.engine.text);
      expect(again.foreign(), shape.id).toHaveLength(0);
      expect(again.reindex().units, shape.id).toHaveLength(1);
      expect(opened.engine.undo(outcome.undo).outcome, shape.id).toBe("applied");
      expect(opened.engine.text, shape.id).toBe(before);
    }
  });

  it("sta tutta nel riquadro, entro lo scarto dei due decimali", () => {
    const slack = 0.01 + 1e-9;
    for (const shape of LIBRARY) {
      for (const box of boxes(shape)) {
        const where = `${shape.id} ${box.max[0] - box.min[0]}×${box.max[1] - box.min[1]}`;
        const opened = inserted(libraryElem(shape, box, STYLE, "Prova", new NewIds(() => false)));
        const index = opened.reindex();
        const top = index.units[0]!;
        const leaves = top.role === "group" ? index.children(top) : [top];
        for (const leaf of leaves) {
          // Un testo ha l'ingombro dei suoi caratteri: se ne guarda l'àncora, sotto.
          if (leaf.role === "text" || leaf.geometry === null) continue;
          const { min, max } = leaf.geometry;
          expect(min[0], where).toBeGreaterThanOrEqual(box.min[0] - slack);
          expect(min[1], where).toBeGreaterThanOrEqual(box.min[1] - slack);
          expect(max[0], where).toBeLessThanOrEqual(box.max[0] + slack);
          expect(max[1], where).toBeLessThanOrEqual(box.max[1] + slack);
        }
      }
    }
  });

  it("tiene le àncore dei testi dentro il riquadro", () => {
    for (const id of ["school-axes", "school-number-line"]) {
      const shape = libraryShape(id)!;
      for (const box of boxes(shape)) {
        const elem = libraryElem(shape, box, STYLE, "Prova", new NewIds(() => false));
        const texts = walk(elem).filter((each) => each.tag === "text");
        expect(texts.length, id).toBeGreaterThan(0);
        for (const each of texts) {
          const [x, y] = [Number(each.attrs.x), Number(each.attrs.y)];
          expect(x, id).toBeGreaterThanOrEqual(box.min[0] - 0.01);
          expect(x, id).toBeLessThanOrEqual(box.max[0] + 0.01);
          expect(y, id).toBeGreaterThanOrEqual(box.min[1] - 0.01);
          expect(y, id).toBeLessThanOrEqual(box.max[1] + 0.01);
        }
      }
    }
  });

  it("mette il nome nel `<title>`, primo figlio, che non ha id", () => {
    for (const shape of LIBRARY) {
      const opened = open(EMPTY());
      const elem = libraryElem(shape, boxes(shape)[0]!, STYLE, "Processo & «prova»", ids(opened));
      expect(elem.children?.[0], shape.id).toEqual({ tag: "title", attrs: {}, text: "Processo & «prova»" });
      expect(walk(elem).filter((each) => each.tag === "title"), shape.id).toHaveLength(1);
      inserted(elem, opened);
      const text = opened.engine.text;
      const at = text.indexOf(`id="${elem.attrs.id}"`);
      expect(text.slice(at).replace(/^[^>]*>\s*/, "").startsWith("<title>Processo &amp; «prova»</title>"), shape.id).toBe(true);
    }
  });

  it("dà un id a ogni elemento, il gruppo compreso, e a nessun `title` o riga", () => {
    for (const shape of LIBRARY) {
      const opened = open(EMPTY());
      const elem = libraryElem(shape, boxes(shape)[0]!, STYLE, "Prova", ids(opened));
      const all = walk(elem);
      const withId = all.filter((each) => each.attrs.id !== undefined);
      expect(withId.every((each) => each.tag !== "title" && each.tag !== "tspan"), shape.id).toBe(true);
      expect(all.filter((each) => each.tag !== "title" && each.tag !== "tspan" && each.attrs.id === undefined), shape.id).toHaveLength(0);
      expect(new Set(withId.map((each) => each.attrs.id)).size, shape.id).toBe(withId.length);
      expect(elem.tag === "g", shape.id).toBe(shape.build(10, 10).length > 1);
    }
  });

  it("scrive i numeri con al più due decimali, la stella con quattro per il raggio interno", () => {
    for (const shape of LIBRARY) {
      for (const box of boxes(shape)) {
        const elem = libraryElem(shape, box, STYLE, "Prova", new NewIds(() => false));
        for (const each of walk(elem)) {
          for (const [name, value] of Object.entries(each.attrs)) {
            if (name === "id" || name === "font-family" || /^#[0-9a-f]{6}$/.test(value)) continue;
            const star = each.attrs["fub:shape"] === "star";
            for (const [i, token] of (value.match(/-?\d+(?:\.\d+)?/g) ?? []).entries()) {
              const allowed = name === "fub:geom" && star && i === 4 ? 4 : 2;
              expect(decimals(token), `${shape.id} ${name}=${value}`).toBeLessThanOrEqual(allowed);
              expect(token, `${shape.id} ${name}=${value}`).not.toBe("-0");
            }
          }
        }
      }
    }
  });

  it("scrive due inserimenti uguali con lo stesso testo", () => {
    for (const shape of LIBRARY) {
      const texts = [0, 1].map(() => {
        const opened = open(EMPTY());
        // Gli id li sceglie il motore a caso: si confrontano numerati.
        let count = 0;
        return inserted(libraryElem(shape, boxes(shape)[1]!, STYLE, "Prova", ids(opened)), opened).engine.text.replace(/ id="o[a-z0-9]+"/g, () => ` id="n${count++}"`);
      });
      expect(texts[0], shape.id).toBe(texts[1]);
    }
  });

  it("porta ogni forma dov'è il riquadro: lo stesso disegno, spostato", () => {
    const dx = 100.25;
    const dy = -40.5;
    for (const shape of LIBRARY) {
      const [w, h] = shape.size;
      const home = libraryElem(shape, boxOf(w, h, [0, 0]), STYLE, "Prova", new NewIds(() => false));
      const away = libraryElem(shape, boxOf(w, h, [dx, dy]), STYLE, "Prova", new NewIds(() => false));
      const a = walk(home);
      const b = walk(away);
      expect(b.length, shape.id).toBe(a.length);
      a.forEach((one, i) => {
        const other = b[i]!;
        expect(other.tag, shape.id).toBe(one.tag);
        const d1 = one.attrs.d === undefined ? null : parsePath(one.attrs.d);
        const d2 = other.attrs.d === undefined ? null : parsePath(other.attrs.d);
        if (d1 !== null && d2 !== null) {
          expect(d2.length, shape.id).toBe(d1.length);
          const points = (segments: typeof d1): number[] =>
            segments.flatMap((segment) => (segment.kind === "close" ? [] : segment.kind === "cubic" ? [...segment.c1, ...segment.c2, ...segment.to] : segment.kind === "quad" ? [...segment.control, ...segment.to] : segment.kind === "arc" ? [...segment.to] : [...segment.to]));
          const p1 = points(d1);
          const p2 = points(d2);
          p1.forEach((value, k) => expect(Math.abs(p2[k]! - value - (k % 2 === 0 ? dx : dy)), `${shape.id} d[${k}]`).toBeLessThanOrEqual(0.011));
        }
        for (const [name, value] of Object.entries(one.attrs)) {
          const shifted = other.attrs[name];
          if (["x", "cx", "x1", "x2"].includes(name)) expect(Math.abs(Number(shifted) - Number(value) - dx), `${shape.id} ${name}`).toBeLessThanOrEqual(0.011);
          else if (["y", "cy", "y1", "y2"].includes(name)) expect(Math.abs(Number(shifted) - Number(value) - dy), `${shape.id} ${name}`).toBeLessThanOrEqual(0.011);
          else if (name !== "id" && name !== "d" && name !== "fub:geom") expect(shifted, `${shape.id} ${name}`).toBe(value);
        }
      });
    }
  });

  describe("lo stile", () => {
    it("dà al contorno il colore e lo spessore scelti, senza riempimento", () => {
      const elem = libraryElem(libraryShape("basic-rectangle")!, boxOf(160, 100), STYLE, "Rettangolo", new NewIds(() => false));
      expect(elem).toEqual({
        tag: "rect",
        attrs: { id: elem.attrs.id, x: "37.5", y: "-12.25", width: "160", height: "100", fill: "none", stroke: "#0072b2", "stroke-width": "3" },
        children: [{ tag: "title", attrs: {}, text: "Rettangolo" }],
      });
    });

    it("scrive una stella come lo strumento Poligono, con il centro portato dov'è il riquadro", () => {
      const star = libraryElem(libraryShape("basic-star")!, boxOf(120, 114), STYLE, "Stella", new NewIds(() => false));
      expect(star.attrs["fub:shape"]).toBe("star");
      const read = readPolygonal("star", star.attrs["fub:geom"]!)!;
      expect(read.cx).toBeCloseTo(37.5 + 60, 1);
      expect(read.count).toBe(5);
      expect(star.attrs.fill).toBe("none");
      expect(star.attrs.stroke).toBe("#0072b2");
      expect(star.attrs["stroke-width"]).toBe("3");
    });

    it("dà alle linee di servizio lo stesso colore a metà spessore", () => {
      const axes = libraryElem(libraryShape("school-axes")!, boxOf(300, 300), STYLE, "Assi", new NewIds(() => false));
      const ticks = axes.children!.filter((child) => child.tag === "path" && child.attrs["fub:shape"] === undefined);
      expect(ticks.length).toBeGreaterThan(0);
      for (const tick of ticks) {
        expect(tick.attrs.stroke).toBe("#0072b2");
        expect(tick.attrs["stroke-width"]).toBe("1.5");
        expect(tick.attrs.fill).toBe("none");
      }
    });

    it("scrive le frecce dei due assi come lo strumento Freccia, col `d` dello spessore scelto", () => {
      const axes = libraryElem(libraryShape("school-axes")!, boxOf(300, 300), STYLE, "Assi", new NewIds(() => false));
      const arrows = axes.children!.filter((child) => child.attrs["fub:shape"] === "arrow");
      expect(arrows).toHaveLength(2);
      for (const arrow of arrows) {
        const [x1, y1, x2, y2] = arrow.attrs["fub:geom"]!.split(" ").map(Number) as [number, number, number, number];
        expect(arrow.attrs.d).toBe(arrowPath(x1, y1, x2, y2, 3));
        expect(arrow.attrs["stroke-linecap"]).toBe("round");
        expect(arrow.attrs["stroke-linejoin"]).toBe("round");
        expect(arrow.attrs["stroke-width"]).toBe("3");
      }
      // Il primo asse parte dal bordo sinistro del riquadro, portato a 37.5.
      expect(arrows[0]!.attrs["fub:geom"]!.startsWith("37.5 ")).toBe(true);
    });

    it("dipinge il foglio del quaderno d'azzurro chiaro e sottile, qualunque sia il colore scelto", () => {
      for (const id of ["school-squared", "school-lined"]) {
        const sheet = libraryElem(libraryShape(id)!, boxOf(400, 300), { color: "#000000", width: 8 }, "Foglio", new NewIds(() => false));
        expect(sheet.attrs.stroke, id).toBe(PAPER_COLOR);
        expect(sheet.attrs["stroke-width"], id).toBe(String(PAPER_WIDTH));
        expect(sheet.attrs.fill, id).toBe("none");
      }
    });

    it("scrive i testi come un testo nuovo: colore scelto, caratteri del testo, misura del pezzo", () => {
      const line = libraryElem(libraryShape("school-number-line")!, boxOf(500, 80), { color: "#d55e00", width: 2 }, "Retta", new NewIds(() => false));
      const texts = line.children!.filter((child) => child.tag === "text");
      expect(texts).toHaveLength(11);
      texts.forEach((text, i) => {
        expect(text.attrs.fill).toBe("#d55e00");
        expect(text.attrs["font-family"]).toBe(TEXT_FAMILY);
        expect(Number(text.attrs["font-size"])).toBeGreaterThan(0);
        expect(text.attrs["text-anchor"]).toBe("middle");
        expect(text.children).toEqual([{ tag: "tspan", attrs: { x: text.attrs.x, dy: "0" }, text: String(i) }]);
      });
    });

    it("dà al testo un `tspan` che il motore rilegge, dopo il `<title>` della forma", () => {
      const opened = inserted(libraryElem(libraryShape("school-number-line")!, boxOf(500, 80), STYLE, "Retta", new NewIds(() => false)));
      const text = opened.engine.text;
      expect(text).toContain("<title>Retta</title>");
      expect(text).toMatch(/<text [^>]*text-anchor="middle"[^>]*>\s*<tspan x="[^"]+" dy="0">0<\/tspan>\s*<\/text>/);
    });

    it("segue il nome nella lingua: l'inglese e l'italiano dei nomi del catalogo entrano nel `<title>`", () => {
      const shape = libraryShape("flow-decision")!;
      const name = IT[shape.name];
      expect(name).toBeDefined();
      const elem = libraryElem(shape, boxOf(...shape.size), STYLE, name!, new NewIds(() => false));
      expect(elem.children![0]).toEqual({ tag: "title", attrs: {}, text: name });
    });

    it("non scrive il `<title>` se il nome è vuoto", () => {
      const elem = libraryElem(libraryShape("basic-rectangle")!, boxOf(160, 100), STYLE, "", new NewIds(() => false));
      expect(elem.children).toEqual([]);
    });
  });

  describe("una forma di più pezzi", () => {
    it("è un gruppo con il `<title>` e poi i pezzi, nell'ordine in cui la forma li dà", () => {
      const shape = libraryShape("school-axes")!;
      const group = libraryElem(shape, boxOf(...shape.size), STYLE, "Assi cartesiani", new NewIds(() => false));
      expect(group.tag).toBe("g");
      expect(group.children![0]!.tag).toBe("title");
      expect(group.children!.length - 1).toBe(shape.build(...shape.size).length);
      expect(group.children!.slice(1).map((child) => child.tag)).toEqual(shape.build(...shape.size).map((piece) => piece.tag));
    });
  });
});

describe("forPreview", () => {
  it("toglie i `<title>` e gli id a ogni profondità e lascia il resto com'è", () => {
    const shape = libraryShape("school-number-line")!;
    const elem = libraryElem(shape, boxOf(...shape.size), STYLE, "Retta", new NewIds(() => false));
    expect(walk(elem).some((each) => each.tag === "title")).toBe(true);
    const plain = forPreview(elem);
    expect(walk(plain).some((each) => each.tag === "title")).toBe(false);
    expect(walk(plain).some((each) => each.attrs.id !== undefined)).toBe(false);
    expect(walk(plain).length).toBe(walk(elem).length - 1);
    // Il resto è uguale, riga per riga.
    const kept = walk(elem).filter((each) => each.tag !== "title");
    walk(plain).forEach((each, i) => {
      const { id: _id, ...attrs } = kept[i]!.attrs;
      expect(each.attrs).toEqual(attrs);
      expect(each.tag).toBe(kept[i]!.tag);
      expect(each.text).toBe(kept[i]!.text);
    });
    const rect = libraryElem(libraryShape("basic-rectangle")!, boxOf(10, 10), STYLE, "", new NewIds(() => false));
    expect(forPreview(rect).attrs).toEqual({ x: "37.5", y: "-12.25", width: "10", height: "10", fill: "none", stroke: "#0072b2", "stroke-width": "3" });
  });
});

describe("boxAround e boxIn", () => {
  it("mette il centro dov'è chiesto, con la misura con cui la forma s'inserisce", () => {
    const shape = libraryShape("basic-rectangle")!;
    expect(boxAround(shape, [100, 50])).toEqual({ min: [20, 0], max: [180, 100] });
  });

  it("riporta il riquadro della scena a un livello che lo ingrandisce o lo gira", () => {
    const box = { min: [20, 0], max: [180, 100] } as const;
    expect(boxIn(box, IDENTITY)).toEqual(box);
    // Un livello in scala 2: lo stesso riquadro nella scena è la metà nelle sue coordinate.
    expect(boxIn(box, [0.5, 0, 0, 0.5, 0, 0])).toEqual({ min: [10, 0], max: [90, 50] });
    // Un livello girato di 90°: la larghezza e l'altezza si scambiano, e il riquadro resta ordinato.
    const turned = boxIn(box, [0, -1, 1, 0, 0, 0]);
    expect(turned.max[0] - turned.min[0]).toBe(100);
    expect(turned.max[1] - turned.min[1]).toBe(160);
  });
});

describe("le etichette nelle forme delle raccolte", () => {
  it("ogni forma chiusa ne riceve una, in un riquadro del testo dentro di lei; quelle della scuola no", () => {
    for (const shape of LIBRARY) {
      const opened = open(EMPTY());
      const elem = libraryElem(shape, boxOf(...shape.size), STYLE, "x", ids(opened));
      expect(opened.engine.apply({ op: "add", parent: "l1", pos: { last: true }, elem }).outcome, shape.id).toBe("applied");
      const node = opened.engine.holder(elem.attrs.id!)!;
      expect(labelable(node), shape.id).toBe(shape.closed);
      if (!shape.closed) continue;
      // Il riquadro sta nella forma e non è una fessura: le righe ci entrano.
      const box = textBox(node)!;
      const [w, h] = shape.size;
      expect(box.min[0], shape.id).toBeGreaterThanOrEqual(ORIGIN[0] - 1e-6);
      expect(box.max[0], shape.id).toBeLessThanOrEqual(ORIGIN[0] + w + 1e-6);
      expect(box.min[1], shape.id).toBeGreaterThanOrEqual(ORIGIN[1] - 1e-6);
      expect(box.max[1], shape.id).toBeLessThanOrEqual(ORIGIN[1] + h + 1e-6);
      expect(box.max[0] - box.min[0], shape.id).toBeGreaterThan(0.15 * w);
      expect(box.max[1] - box.min[1], shape.id).toBeGreaterThan(0.15 * h);
    }
  });
});
