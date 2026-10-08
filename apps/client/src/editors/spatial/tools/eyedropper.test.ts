// Il contagocce: dove guarda, il colore che si vede in un punto e il pixel
// di un'immagine.

import { describe, expect, it } from "vitest";
import type { Point } from "../scene/matrix";
import { doc } from "../scene/test-support";
import type { LeafNode } from "../scene/model";
import { imagePixel, paintAt, pixelColor, shownPaint, sightAt, sightStyle, type ImageSight, type ShapeSight, type Sight } from "./eyedropper";
import { LAYER, open, type Opened } from "./test-support";

/// Ciò che si vede nel punto `p` del disegno `opened`.
const sight = (opened: Opened, p: Point, tolerance = 0): Sight | null => sightAt(opened.seen(), opened.foreign(), p, tolerance);

/// La forma e ciò che la colora nel punto `p`, o il tipo di ciò che si vede.
function seen(opened: Opened, p: Point, tolerance = 0): string | null {
  const found = sight(opened, p, tolerance);
  if (found === null) return null;
  if (found.kind === "foreign") return "estraneo";
  return `${found.unit.key}/${found.sampled.leaf.facts.id}/${found.sampled.on}`;
}

/// Il colore che si vede nel punto `p` del disegno `source`.
function colorAt(source: string, p: Point): string | null {
  const opened = open(source);
  const found = sight(opened, p);
  if (found?.kind !== "shape") throw new Error("nessuna forma");
  return paintAt(opened.engine.model!, found, p);
}

describe("dove guarda il contagocce", () => {
  const SCENE = doc(
    `${LAYER}<rect id="sotto" x="0" y="0" width="100" height="100" fill="#0072b2"/>` +
      '<line id="linea" x1="0" y1="50" x2="100" y2="50" stroke="#000000" stroke-width="1"/>' +
      '<g id="gruppo"><rect id="primo" x="200" y="0" width="20" height="20" fill="#d55e00"/><circle id="secondo" cx="230" cy="10" r="10" fill="#009e73"/></g>' +
      '</g><g id="l2" fub:layer="Bloccato" fub:locked="true"><rect id="fermo" x="300" y="0" width="20" height="20" fill="#cc79a7"/></g>',
  );

  it("dentro una forma vince su chi le passa vicino più in alto; dove non tocca niente vale la tolleranza", () => {
    const opened = open(SCENE);
    expect(seen(opened, [50, 52], 3)).toBe("sotto/sotto/fill");
    expect(seen(opened, [50, 50.2], 3)).toBe("linea/linea/stroke");
    expect(seen(opened, [101, 50], 3)).toBe("linea/linea/stroke");
    expect(seen(opened, [150, 150], 3)).toBeNull();
  });

  it("dentro un gruppo guarda la forma sotto il puntatore, e legge anche ciò che è bloccato", () => {
    const opened = open(SCENE);
    expect(seen(opened, [230, 10])).toBe("gruppo/secondo/fill");
    expect(seen(opened, [205, 5])).toBe("gruppo/primo/fill");
    expect(seen(opened, [310, 10])).toBe("fermo/fermo/fill");
  });

  it("un blocco estraneo copre ciò che sta sotto e non si legge, dentro un gruppo o da solo", () => {
    const opened = open(
      doc(
        `${LAYER}<rect id="sotto" x="0" y="0" width="100" height="100" fill="#0072b2"/>` +
          '<rect class="a" x="0" y="0" width="40" height="40"/>' +
          '<g id="g"><rect class="b" x="60" y="0" width="40" height="40"/></g>' +
          '<rect id="sopra" x="10" y="10" width="10" height="10" fill="#d55e00"/></g>',
      ),
    );
    expect(seen(opened, [30, 30])).toBe("estraneo");
    expect(seen(opened, [70, 10])).toBe("estraneo");
    expect(seen(opened, [15, 15])).toBe("sopra/sopra/fill");
    expect(seen(opened, [50, 80])).toBe("sotto/sotto/fill");
  });

  it("sotto un oggetto guarda soltanto ciò che sta sotto di lui, blocchi estranei compresi", () => {
    const opened = open(
      doc(
        `${LAYER}<rect id="fondo" x="0" y="0" width="100" height="100" fill="#0072b2"/>` +
          '<rect class="a" x="0" y="0" width="40" height="40"/>' +
          '<rect id="sopra" x="0" y="0" width="100" height="100" fill="#d55e00"/><rect id="cima" x="0" y="0" width="10" height="10" fill="#000000"/></g>',
      ),
    );
    const units = opened.seen();
    const sopra = units.find((unit) => unit.key === "sopra")!;
    const under = (p: Point): string | null => {
      const found = sightAt(units, opened.foreign(), p, 0, { unit: sopra, leaf: sopra.node as LeafNode });
      return found === null ? null : found.kind === "foreign" ? "estraneo" : found.unit.key;
    };
    expect(seen(opened, [60, 60])).toBe("sopra/sopra/fill");
    expect(under([60, 60])).toBe("fondo");
    expect(under([20, 20])).toBe("estraneo");
    // Ciò che sta sopra non conta.
    expect(under([5, 5])).toBe("estraneo");
    expect(under([150, 150])).toBeNull();
  });

  it("sotto una forma di un gruppo guarda prima le forme del gruppo che le stanno sotto", () => {
    const opened = open(
      doc(
        `${LAYER}<rect id="fondo" x="0" y="0" width="100" height="100" fill="#0072b2"/>` +
          '<g id="g"><rect id="dentro" x="0" y="0" width="50" height="50" fill="#d55e00"/><rect id="coperchio" x="0" y="0" width="100" height="100" fill="#000000"/></g></g>',
      ),
    );
    const found = sight(opened, [20, 20]) as ShapeSight;
    expect(found.sampled.leaf.facts.id).toBe("coperchio");
    const under = (p: Point): string | null => {
      const below = sightAt(opened.seen(), [], p, 0, { unit: found.unit, leaf: found.sampled.leaf });
      return below?.kind === "shape" ? `${below.unit.key}/${below.sampled.leaf.facts.id}` : null;
    };
    expect(under([20, 20])).toBe("g/dentro");
    expect(under([70, 70])).toBe("fondo/fondo");
  });
});

describe("il colore che si vede in un punto", () => {
  it("è il contorno dove sta sopra il riempimento, come lo scrive il file", () => {
    const rect = doc(`${LAYER}<rect id="r" x="0" y="0" width="40" height="40" fill="red" stroke="#0072B2" stroke-width="4"/></g>`);
    expect(colorAt(rect, [20, 20])).toBe("#ff0000");
    expect(colorAt(rect, [1, 20])).toBe("#0072b2");
  });

  it("di un tratto a penna è il suo inchiostro, e di un testo il colore delle lettere", () => {
    expect(colorAt(doc(`${LAYER}<path id="p" fub:tool="pen" d="M0 0 H10 V10 H0 Z" fill="#d55e00"/></g>`), [5, 5])).toBe("#d55e00");
    expect(colorAt(doc(`${LAYER}<text id="t" x="0" y="20" fill="#009e73"><tspan x="0" dy="0">Ciao</tspan></text></g>`), [5, 15])).toBe("#009e73");
  });

  it("di una sfumatura è il colore in quel punto, nel riquadro della forma o nelle sue coordinate", () => {
    const stops = '<stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/>';
    const box = doc(
      `<defs id="fub-defs"><linearGradient id="rgggggggg">${stops}</linearGradient></defs>` +
        `${LAYER}<rect id="r" x="100" y="0" width="100" height="10" transform="translate(-100 0)" fill="url(#rgggggggg) #0072b2"/></g>`,
    );
    expect(colorAt(box, [25, 5])).toBe("#bfbfbf");
    const user = doc(
      `<defs id="fub-defs"><radialGradient id="rgggggggg" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="10">${stops}</radialGradient></defs>` +
        `${LAYER}<g id="g" transform="translate(50 50)"><circle id="c" cx="0" cy="0" r="20" fill="url(#rgggggggg)"/></g></g>`,
    );
    expect(colorAt(user, [55, 50])).toBe("#808080");
    expect(colorAt(user, [65, 50])).toBe("#000000");
  });

  it("di un campione del documento è il campione, e di un motivo il motivo", () => {
    const defs =
      '<defs id="fub-defs"><linearGradient id="rssssssss" fub:role="swatch" fub:name="Blu" gradientUnits="userSpaceOnUse"><stop stop-color="#0072b2"/></linearGradient>' +
      '<pattern id="rpppppppp" width="0.5" height="0.5"><rect x="0" y="0" width="0.25" height="0.25" fill="#000000"/></pattern></defs>';
    const at = (fill: string): string | null => colorAt(doc(`${defs}${LAYER}<rect id="r" x="0" y="0" width="10" height="10" fill="${fill}"/></g>`), [5, 5]);
    expect(at("url(#rssssssss) #0072b2")).toBe("url(#rssssssss) #0072b2");
    expect(at("url(#rpppppppp)")).toBe("url(#rpppppppp)");
  });

  it("si mostra col nome del campione, col colore della sfumatura nel punto, come motivo o come nessuno", () => {
    const defs =
      '<defs id="fub-defs"><linearGradient id="rssssssss" fub:role="swatch" fub:name="  Blu   marca " gradientUnits="userSpaceOnUse"><stop stop-color="#0072B2"/></linearGradient>' +
      '<linearGradient id="rgggggggg"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/></linearGradient>' +
      '<pattern id="rpppppppp" width="0.5" height="0.5"><rect x="0" y="0" width="0.25" height="0.25" fill="#000000"/></pattern></defs>';
    const opened = open(doc(`${defs}${LAYER}<rect id="r" x="0" y="0" width="100" height="10" fill="#d55e00"/></g>`));
    const found = sight(opened, [25, 5]) as ShapeSight;
    const shown = (value: string): unknown => shownPaint(opened.engine.model!, found, [25, 5], value);
    expect(shown("#D55E00")).toEqual({ kind: "color", code: "#d55e00" });
    expect(shown("url(#rssssssss) #0072b2")).toEqual({ kind: "swatch", id: "rssssssss", name: "Blu marca", code: "#0072b2" });
    expect(shown("url(#rgggggggg)")).toEqual({ kind: "gradient", code: "#bfbfbf" });
    expect(shown("url(#rpppppppp)")).toEqual({ kind: "pattern" });
    expect(shown(" none ")).toEqual({ kind: "none" });
    // Una risorsa che non c'è si mostra col suo ripiego.
    expect(shown("url(#rmancante) #009e73")).toEqual({ kind: "color", code: "#009e73" });
    expect(shown("url(#rmancante) none")).toEqual({ kind: "none" });
    expect(shown("url(#rmancante)")).toBeNull();
    expect(shown("currentColor")).toBeNull();
  });

  it("l'aspetto è quello della forma sotto il puntatore, con l'opacità dell'oggetto", () => {
    const opened = open(
      doc(`${LAYER}<g id="g" opacity="0.5"><rect id="a" x="0" y="0" width="10" height="10" fill="#0072b2"/><rect id="b" x="20" y="0" width="10" height="10" fill="#d55e00" stroke="#000000"/></g></g>`),
    );
    const style = sightStyle(opened.engine.model!, sight(opened, [25, 5]) as ShapeSight)!;
    expect([style.fill, style.stroke, style.opacity]).toEqual(["#d55e00", "#000000", 0.5]);
  });
});

describe("il pixel di un'immagine", () => {
  /// Ciò che si vede nel punto `p` di un'immagine nel riquadro 40×40 in
  /// (10, 10), col `preserveAspectRatio` `aspect`.
  const image = (p: Point, aspect = ""): ImageSight => {
    const ratio = aspect === "" ? "" : ` preserveAspectRatio="${aspect}"`;
    const opened = open(doc(`${LAYER}<image id="i" x="10" y="10" width="40" height="40" href="foto.png"${ratio}/></g>`));
    const found = sightAt(opened.seen(), [], p, 2);
    if (found?.kind !== "image") throw new Error("nessuna immagine");
    return found;
  };

  it("sta dove il riquadro la mostra, intera e al centro se non lo dice", () => {
    // 4×2 pixel in 40×40: larga 40, alta 20, da y = 20 a y = 40.
    expect(image([15, 25]).local).toEqual([15, 25]);
    expect(imagePixel(image([15, 25]), [4, 2])).toEqual([0, 0]);
    expect(imagePixel(image([49, 39]), [4, 2])).toEqual([3, 1]);
    expect(imagePixel(image([15, 15]), [4, 2])).toBeNull();
    // Riempita e tagliata: alta 40, larga 80, la metà in mezzo.
    expect(imagePixel(image([10, 15], "xMidYMid slice"), [4, 2])).toEqual([1, 0]);
    expect(imagePixel(image([20, 20], "none"), [4, 2])).toEqual([1, 0]);
  });

  it("appena fuori dal riquadro legge il pixel del bordo", () => {
    expect(imagePixel(image([9, 30]), [4, 2])).toEqual([0, 1]);
  });

  it("dà il colore senza l'opacità; un pixel trasparente non dà niente", () => {
    expect(pixelColor([255, 128, 0, 64])).toBe("#ff8000");
    expect(pixelColor([255, 128, 0, 0])).toBeNull();
    expect(pixelColor([])).toBeNull();
  });
});
