// Il ritaglio delle immagini: come si legge, i gesti sulle maniglie e sui
// margini, e le operazioni, che il motore accetta così come sono e che un
// annulla disfa al byte.

import { describe, expect, it } from "vitest";
import type { Bounds } from "../scene/geometry";
import { pathOf, type ContainerNode } from "../scene/model";
import { doc } from "../scene/test-support";
import { boundsOf, duplicateOps, nodeOf } from "./arrange";
import { copySvg, planPaste, readPaste } from "./clipboard";
import {
  cropOps,
  cropState,
  croppedImages,
  dragCrop,
  MIN_CROP,
  marginsOf,
  slideImage,
  uncropOps,
  withMargins,
  type Crop,
  type CropHandle,
  type CropState,
} from "./crop";
import { destinationIn, NewIds } from "./edit";
import { LAYER, open, type Opened } from "./test-support";
import { applied } from "./tip-support";

const ids = (opened: Opened): NewIds => new NewIds((id) => opened.engine.holder(id) !== null);

const HREF = "data:image/png;base64,AA==";

/// Il riquadro da `x0 y0` a `x1 y1`.
const box = (x0: number, y0: number, x1: number, y1: number): Bounds => ({ min: [x0, y0], max: [x1, y1] });

/// Un ritaglio dell'immagine `0 0 300 200`.
const crop = (x0: number, y0: number, x1: number, y1: number): Crop => ({ box: box(0, 0, 300, 200), rect: box(x0, y0, x1, y1) });

const FULL = crop(0, 0, 300, 200);

/// Un'immagine con l'id `id`.
const IMG = (id = "img", extra = ""): string => `<image id="${id}" x="0" y="0" width="300" height="200" href="${HREF}"${extra}/>`;

/// Un ritaglio nelle `defs` di FubDraw.
const CLIP = (id: string, rect = '<rect x="20" y="10" width="200" height="120"/>', attrs = ' fub:role="private"'): string => `<clipPath id="${id}"${attrs}>${rect}</clipPath>`;

const DEFS = (...inner: string[]): string => `<defs id="fub-defs">${inner.join("")}</defs>`;

/// Un disegno con `defs` e `body` dentro il primo livello.
const sheet = (defs: string, body: string): Opened => open(doc(`${defs}${LAYER}${body}</g>`));

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

/// Il corpo del documento: tutto dopo la radice.
const body = (opened: Opened): string => named(opened.engine.text).replace(/^<svg[^>]*>\n?/, "").replace(/<\/svg>$/, "");

/// Il ritaglio di `id` ora.
function stateOf(opened: Opened, id = "img"): CropState {
  const state = cropState(opened.engine.model!, opened.engine.holder(id)!);
  if (state === null) throw new Error(`${id} non è un'immagine`);
  return state;
}

/// Applica `ops` (annulla e rifai compresi) e torna il testo di dopo.
const run = (opened: Opened, ops: ReturnType<typeof cropOps>): string => applied(opened, ops);

/// `x y width height` del rettangolo del ritaglio, come sono scritti.
function writtenRect(opened: Opened): [number, number, number, number] {
  const found = /<rect x="([^"]*)" y="([^"]*)" width="([^"]*)" height="([^"]*)"\/>/.exec(opened.engine.text);
  if (found === null) throw new Error("nessun rettangolo");
  return found.slice(1).map(Number) as [number, number, number, number];
}

describe("cropState", () => {
  it("un'immagine senza ritaglio è libera, col suo riquadro", () => {
    const opened = sheet("", IMG());
    expect(stateOf(opened)).toEqual({ kind: "free", crop: FULL });
  });

  it("la posizione che manca vale 0, e le misure si leggono con le unità", () => {
    const opened = sheet("", `<image id="img" x="10.5" width="30" height="20" href="${HREF}"/>`);
    expect(stateOf(opened)).toEqual({ kind: "free", crop: { box: box(10.5, 0, 40.5, 20), rect: box(10.5, 0, 40.5, 20) } });
  });

  it("clip-path none è nessun ritaglio", () => {
    expect(stateOf(sheet("", IMG("img", ' clip-path="none"')))).toEqual({ kind: "free", crop: FULL });
  });

  it("un ritaglio con un rettangolo, privato, condiviso o di un altro programma, è un ritaglio", () => {
    for (const attrs of [' fub:role="private"', ' fub:role="shared"', ""]) {
      const opened = sheet(DEFS(CLIP("c1", '<rect x="20" y="10" width="200" height="120"/>', attrs)), IMG("img", ' clip-path="url(#c1)"'));
      expect(stateOf(opened)).toEqual({ kind: "crop", crop: crop(20, 10, 220, 130), clip: "c1" });
    }
  });

  it("titolo e descrizione del ritaglio non contano, e il rettangolo senza x e y parte da 0", () => {
    const clip = `<clipPath id="c1" fub:role="private"><title>Ritaglio</title><desc>…</desc><rect width="100" height="50"/></clipPath>`;
    expect(stateOf(sheet(DEFS(clip), IMG("img", ' clip-path="url(#c1)"')))).toEqual({ kind: "crop", crop: crop(0, 0, 100, 50), clip: "c1" });
  });

  it("si vede soltanto la parte del rettangolo dentro l'immagine", () => {
    const opened = sheet(DEFS(CLIP("c1", '<rect x="-20" y="150" width="100" height="100"/>')), IMG("img", ' clip-path="url(#c1)"'));
    expect(stateOf(opened)).toEqual({ kind: "crop", crop: crop(0, 150, 80, 200), clip: "c1" });
  });

  it("ogni altro ritaglio è un altro", () => {
    const others: Array<readonly [string, string]> = [
      ["con angoli arrotondati", CLIP("c1", '<rect x="20" y="10" width="200" height="120" rx="8"/>')],
      ["con un ry", CLIP("c1", '<rect x="20" y="10" width="200" height="120" ry="8"/>')],
      ["nelle unità del riquadro", CLIP("c1", '<rect x="0.1" y="0.1" width="0.5" height="0.5"/>', ' fub:role="private" clipPathUnits="objectBoundingBox"')],
      ["con una trasformazione", CLIP("c1", '<rect x="20" y="10" width="200" height="120"/>', ' fub:role="private" transform="translate(5 5)"')],
      ["con un rettangolo che si trasforma", CLIP("c1", '<rect x="20" y="10" width="200" height="120" transform="rotate(10)"/>')],
      ["con due rettangoli", CLIP("c1", '<rect x="20" y="10" width="50" height="50"/><rect x="100" y="10" width="50" height="50"/>')],
      ["con un cerchio", CLIP("c1", '<circle cx="100" cy="100" r="50"/>')],
      ["con un rettangolo e un cerchio", CLIP("c1", '<rect x="20" y="10" width="50" height="50"/><circle cx="100" cy="100" r="50"/>')],
      ["con un rettangolo senza larghezza", CLIP("c1", '<rect x="20" y="10" height="50"/>')],
      ["con un rettangolo piatto", CLIP("c1", '<rect x="20" y="10" width="0" height="50"/>')],
      ["con un rettangolo nascosto", CLIP("c1", '<rect x="20" y="10" width="50" height="50" display="none"/>')],
      ["con un rettangolo fuori dall'immagine", CLIP("c1", '<rect x="400" y="10" width="50" height="50"/>')],
      ["vuoto", CLIP("c1", "")],
    ];
    for (const [name, clip] of others) {
      const opened = sheet(DEFS(clip), IMG("img", ' clip-path="url(#c1)"'));
      expect(stateOf(opened), name).toEqual({ kind: "other" });
    }
  });

  it("un ritaglio che il motore non riconosce rende l'immagine non modificabile: niente stato", () => {
    const mask = '<mask id="m1" fub:role="private" x="0" y="0" width="300" height="200" maskUnits="userSpaceOnUse"><rect width="10" height="10"/></mask>';
    const pct = CLIP("c1", '<rect x="20" y="10" width="50%" height="50"/>');
    for (const [defs, ref] of [[DEFS(CLIP("c1")), "#nessuno"], [DEFS(mask), "#m1"], [DEFS(pct), "#c1"]] as const) {
      const opened = sheet(defs, IMG("img", ` clip-path="url(${ref})"`));
      expect(cropState(opened.engine.model!, opened.engine.holder("img")!), ref).toBeNull();
    }
  });

  it("non è un'immagine con un riquadro che si legge: niente stato", () => {
    const opened = sheet("", `<rect id="r" x="0" y="0" width="10" height="10"/>${IMG("flat").replace('height="200"', 'height="0"')}${IMG("wide").replace('width="300"', 'width="30%"')}`);
    const model = opened.engine.model!;
    expect(cropState(model, opened.engine.holder("r")!)).toBeNull();
    expect(cropState(model, opened.engine.holder("flat")!)).toBeNull();
    expect(cropState(model, opened.engine.holder("wide")!)).toBeNull();
  });
});

describe("margini", () => {
  it("si leggono dai bordi dell'immagine", () => {
    expect(marginsOf(crop(20, 10, 220, 130))).toEqual({ top: 10, right: 80, bottom: 70, left: 20 });
    expect(marginsOf(FULL)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("scritti danno il ritaglio, e un giro li riporta uguali", () => {
    const margins = { top: 10, right: 80, bottom: 70, left: 20 };
    expect(withMargins(FULL, margins)).toEqual(crop(20, 10, 220, 130));
    expect(marginsOf(withMargins(FULL, margins)!)).toEqual(margins);
  });

  it("nessun margine è l'immagine intera", () => {
    expect(withMargins(crop(20, 10, 220, 130), { top: 0, right: 0, bottom: 0, left: 0 })).toEqual(FULL);
  });

  it("un margine negativo o che non si legge si rifiuta", () => {
    expect(withMargins(FULL, { top: -1, right: 0, bottom: 0, left: 0 })).toBeNull();
    expect(withMargins(FULL, { top: 0, right: -0.01, bottom: 0, left: 0 })).toBeNull();
    expect(withMargins(FULL, { top: 0, right: 0, bottom: 0, left: Number.NaN })).toBeNull();
    expect(withMargins(FULL, { top: 0, right: Number.POSITIVE_INFINITY, bottom: 0, left: 0 })).toBeNull();
  });

  it("margini che lasciano meno di MIN_CROP per lato si rifiutano", () => {
    expect(MIN_CROP).toBe(0.01);
    expect(withMargins(FULL, { top: 0, right: 150, bottom: 0, left: 150 })).toBeNull();
    expect(withMargins(FULL, { top: 0, right: 150, bottom: 0, left: 149.995 })).toBeNull();
    expect(withMargins(FULL, { top: 100, right: 0, bottom: 100, left: 0 })).toBeNull();
    expect(withMargins(FULL, { top: 100, right: 0, bottom: 99.995, left: 0 })).toBeNull();
    expect(withMargins(FULL, { top: 99, right: 0, bottom: 99, left: 0 })).not.toBeNull();
    expect(withMargins(FULL, { top: 0, right: 299.5, bottom: 0, left: 0 })).not.toBeNull();
  });
});

describe("dragCrop", () => {
  // L'immagine 0 0 300 200, il ritaglio 100 60 → 200 140 (100 × 80, 5:4).
  const start = crop(100, 60, 200, 140);
  const plain = { ratio: false, centered: false, min: 10 };
  const handles: CropHandle[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

  it("ogni maniglia porta i suoi lati al puntatore, e lascia gli altri", () => {
    const expected: Record<CropHandle, Bounds> = {
      n: box(100, 30, 200, 140),
      ne: box(100, 30, 230, 140),
      e: box(100, 60, 230, 140),
      se: box(100, 60, 230, 170),
      s: box(100, 60, 200, 170),
      sw: box(70, 60, 200, 170),
      w: box(70, 60, 200, 140),
      nw: box(70, 30, 200, 140),
    };
    for (const handle of handles) {
      const to: [number, number] = [handle.includes("w") ? 70 : 230, handle.includes("n") ? 30 : 170];
      expect(dragCrop(start, handle, to, plain), handle).toEqual({ box: start.box, rect: expected[handle] });
    }
  });

  it("una maniglia di un lato guarda un asse solo", () => {
    expect(dragCrop(start, "n", [999, 30], plain).rect).toEqual(box(100, 30, 200, 140));
    expect(dragCrop(start, "e", [230, 999], plain).rect).toEqual(box(100, 60, 230, 140));
    expect(dragCrop(start, "s", [-5, 170], plain).rect).toEqual(box(100, 60, 200, 170));
    expect(dragCrop(start, "w", [70, -5], plain).rect).toEqual(box(70, 60, 200, 140));
  });

  it("resta dentro l'immagine", () => {
    expect(dragCrop(start, "nw", [-50, -50], plain).rect).toEqual(box(0, 0, 200, 140));
    expect(dragCrop(start, "se", [999, 999], plain).rect).toEqual(box(100, 60, 300, 200));
    expect(dragCrop(start, "n", [0, -1], plain).rect).toEqual(box(100, 0, 200, 140));
    expect(dragCrop(start, "e", [301, 0], plain).rect).toEqual(box(100, 60, 300, 140));
  });

  it("ogni lato è lungo almeno min, anche oltre il lato opposto", () => {
    expect(dragCrop(start, "w", [500, 0], plain).rect).toEqual(box(190, 60, 200, 140));
    expect(dragCrop(start, "e", [-500, 0], plain).rect).toEqual(box(100, 60, 110, 140));
    expect(dragCrop(start, "n", [0, 500], plain).rect).toEqual(box(100, 130, 200, 140));
    expect(dragCrop(start, "s", [0, -500], plain).rect).toEqual(box(100, 60, 200, 70));
    expect(dragCrop(start, "se", [0, 0], { ...plain, min: 25 }).rect).toEqual(box(100, 60, 125, 85));
  });

  it("con centered il lato opposto va dalla parte opposta del centro", () => {
    const centered = { ...plain, centered: true };
    expect(dragCrop(start, "e", [230, 0], centered).rect).toEqual(box(70, 60, 230, 140));
    expect(dragCrop(start, "w", [120, 0], centered).rect).toEqual(box(120, 60, 180, 140));
    expect(dragCrop(start, "n", [0, 40], centered).rect).toEqual(box(100, 40, 200, 160));
    expect(dragCrop(start, "s", [0, 120], centered).rect).toEqual(box(100, 80, 200, 120));
    expect(dragCrop(start, "se", [220, 150], centered).rect).toEqual(box(80, 50, 220, 150));
    expect(dragCrop(start, "nw", [130, 70], centered).rect).toEqual(box(130, 70, 170, 130));
    expect(dragCrop(start, "ne", [180, 80], centered).rect).toEqual(box(120, 80, 180, 120));
    expect(dragCrop(start, "sw", [80, 120], centered).rect).toEqual(box(80, 80, 220, 120));
  });

  it("con centered si ferma dove il primo lato tocca l'immagine, e tiene min", () => {
    const centered = { ...plain, centered: true };
    // Il centro è a 150 su 300: si allarga fino a 0 e a 300.
    expect(dragCrop(start, "e", [999, 0], centered).rect).toEqual(box(0, 60, 300, 140));
    // Il centro è a 100 su 200: in altezza fino a 0 e a 200.
    expect(dragCrop(start, "s", [0, 999], centered).rect).toEqual(box(100, 0, 200, 200));
    expect(dragCrop(start, "w", [999, 0], centered).rect).toEqual(box(145, 60, 155, 140));
  });

  it("con ratio tiene le proporzioni, dall'angolo opposto", () => {
    const keep = { ...plain, ratio: true };
    // 5:4, come il ritaglio di partenza.
    expect(dragCrop(start, "se", [250, 100], keep).rect).toEqual(box(100, 60, 250, 180));
    // Vince l'asse che il puntatore ha allontanato di più.
    // 2 volte in altezza, ma l'immagine finisce a 200: 1,75 volte, 175 × 140.
    expect(dragCrop(start, "se", [210, 220], keep).rect).toEqual(box(100, 60, 275, 200));
    expect(dragCrop(start, "se", [210, 140], keep).rect).toEqual(box(100, 60, 210, 148));
    expect(dragCrop(start, "nw", [50, 50], keep).rect).toEqual(box(50, 20, 200, 140));
    expect(dragCrop(start, "ne", [250, 20], keep).rect).toEqual(box(100, 20, 225 + 25, 140));
    expect(dragCrop(start, "sw", [50, 150], keep).rect).toEqual(box(50, 60, 200, 180));
  });

  it("con ratio una maniglia di un lato cambia l'altro asse attorno al suo centro", () => {
    const keep = { ...plain, ratio: true };
    // e: 100 → 150 di larghezza, e 80 → 120 di altezza attorno a y = 100.
    expect(dragCrop(start, "e", [250, 0], keep).rect).toEqual(box(100, 40, 250, 160));
    // w: stesso, dal lato destro.
    expect(dragCrop(start, "w", [50, 0], keep).rect).toEqual(box(50, 40, 200, 160));
    // s: 80 → 120 di altezza, e 100 → 150 di larghezza attorno a x = 150.
    expect(dragCrop(start, "s", [0, 180], keep).rect).toEqual(box(75, 60, 225, 180));
    expect(dragCrop(start, "n", [0, 20], keep).rect).toEqual(box(75, 20, 225, 140));
  });

  it("con ratio e centered scala attorno al centro", () => {
    const both = { ratio: true, centered: true, min: 10 };
    expect(dragCrop(start, "se", [225, 0], both).rect).toEqual(box(75, 40, 225, 160));
    expect(dragCrop(start, "nw", [75, 60], both).rect).toEqual(box(75, 40, 225, 160));
    expect(dragCrop(start, "e", [225, 0], both).rect).toEqual(box(75, 40, 225, 160));
    expect(dragCrop(start, "n", [0, 40], both).rect).toEqual(box(75, 40, 225, 160));
  });

  it("con ratio resta dentro l'immagine e tiene le proporzioni", () => {
    const keep = { ...plain, ratio: true };
    // L'altezza arriva al fondo (200) prima della larghezza: 100 × 80 → 175 × 140.
    const low = dragCrop(start, "se", [999, 999], keep).rect;
    expect(low.max[1]).toBeCloseTo(200, 9);
    expect((low.max[0] - low.min[0]) / (low.max[1] - low.min[1])).toBeCloseTo(100 / 80, 9);
    const wide = dragCrop(start, "e", [999, 0], keep).rect;
    // L'altezza, attorno a y = 100, arriva a 0 e a 200 con 125: 200 × 160 non ci sta?
    expect(wide.min[1]).toBeGreaterThanOrEqual(0);
    expect(wide.max[1]).toBeLessThanOrEqual(200);
    expect((wide.max[0] - wide.min[0]) / (wide.max[1] - wide.min[1])).toBeCloseTo(100 / 80, 9);
  });

  it("ogni maniglia, in ogni modo, resta dentro l'immagine con lati di almeno min e le proporzioni che deve", () => {
    const targets: Array<readonly [number, number]> = [[-80, -80], [150, 100], [400, 400], [210, 30], [0, 400], [300, 0]];
    for (const handle of handles) {
      for (const ratio of [false, true]) {
        for (const centered of [false, true]) {
          for (const to of targets) {
            const out = dragCrop(start, handle, to, { ratio, centered, min: 10 });
            const label = `${handle} ratio=${ratio} centered=${centered} a ${to.join(",")}`;
            expect(out.box, label).toEqual(start.box);
            const { min: lo, max: hi } = out.rect;
            expect(lo[0], label).toBeGreaterThanOrEqual(0);
            expect(lo[1], label).toBeGreaterThanOrEqual(0);
            expect(hi[0], label).toBeLessThanOrEqual(300);
            expect(hi[1], label).toBeLessThanOrEqual(200);
            expect(hi[0] - lo[0], label).toBeGreaterThanOrEqual(10 - 1e-9);
            expect(hi[1] - lo[1], label).toBeGreaterThanOrEqual(10 - 1e-9);
            if (ratio) expect((hi[0] - lo[0]) / (hi[1] - lo[1]), label).toBeCloseTo(100 / 80, 9);
            if (centered) {
              // Il centro non si muove, tranne il lato che una maniglia di un
              // lato lascia stare con ratio.
              expect((lo[0] + hi[0]) / 2, label).toBeCloseTo(150, 9);
              expect((lo[1] + hi[1]) / 2, label).toBeCloseTo(100, 9);
            }
          }
        }
      }
    }
  });

  it("un ritaglio che c'è già non si muove senza gesto: la maniglia nel suo punto lo lascia com'è", () => {
    expect(dragCrop(start, "se", [200, 140], plain)).toEqual(start);
    expect(dragCrop(start, "se", [200, 140], { ratio: true, centered: false, min: 10 }).rect).toEqual(start.rect);
    expect(dragCrop(start, "n", [0, 60], { ratio: true, centered: true, min: 10 }).rect).toEqual(start.rect);
  });
});

describe("slideImage", () => {
  const cropped = crop(20, 10, 220, 130);

  it("sposta l'immagine e lascia fermo il ritaglio", () => {
    const out = slideImage(cropped, [-10, 5]);
    expect(out.rect).toEqual(cropped.rect);
    expect(out.box).toEqual(box(-10, 5, 290, 205));
  });

  it("si ferma dove il ritaglio toccherebbe il bordo dell'immagine", () => {
    // Il lato sinistro dell'immagine non supera il 20 del ritaglio, il destro
    // non scende sotto il 220; in alto 10, in basso 130.
    expect(slideImage(cropped, [500, 500]).box).toEqual(box(20, 10, 320, 210));
    expect(slideImage(cropped, [-500, -500]).box).toEqual(box(-80, -70, 220, 130));
    expect(slideImage(cropped, [50, -100]).box).toEqual(box(20, -70, 320, 130));
  });

  it("un ritaglio che tocca già un bordo non lascia andare l'immagine da quella parte", () => {
    const touching = crop(0, 0, 100, 100);
    expect(slideImage(touching, [10, 10]).box).toEqual(box(0, 0, 300, 200));
    expect(slideImage(touching, [-30, -30]).box).toEqual(box(-30, -30, 270, 170));
  });

  it("un ritaglio intero non lascia muovere l'immagine", () => {
    expect(slideImage(FULL, [30, -30]).box).toEqual(FULL.box);
  });
});

describe("cropOps", () => {
  it("da un'immagine libera crea un ritaglio privato con un rettangolo solo", () => {
    const opened = sheet("", IMG());
    const ops = cropOps(opened.engine.model!, opened.engine.holder("img")!, crop(20, 10, 220, 130), ids(opened));
    expect(ops.map((op) => op.op)).toEqual(["add", "add", "set"]);
    expect(body(opened)).toBe(`${LAYER}${IMG()}</g>`);
    run(opened, ops);
    expect(body(opened)).toBe(
      [
        '  <defs id="fub-defs">',
        '    <clipPath id="R1" fub:role="private">',
        '      <rect x="20" y="10" width="200" height="120"/>',
        "    </clipPath>",
        `  </defs>${LAYER}<image id="img" x="0" y="0" width="300" height="200" clip-path="url(#R1)" href="${HREF}"/></g>`,
      ].join("\n"),
    );
    expect(stateOf(opened)).toEqual({ kind: "crop", crop: crop(20, 10, 220, 130), clip: expect.stringMatching(/^r[0-9a-z]{8}$/) });
  });

  it("l'immagine non cambia: i byte e l'href restano com'erano", () => {
    const opened = sheet("", IMG());
    const before = opened.engine.text;
    run(opened, cropOps(opened.engine.model!, opened.engine.holder("img")!, crop(20, 10, 220, 130), ids(opened)));
    const href = /href="([^"]*)"/.exec(opened.engine.text)![1];
    expect(href).toBe(HREF);
    expect(before).toContain(`href="${HREF}"`);
  });

  it("senza una defs di FubDraw ne mette il ritaglio nella prima che ha un id", () => {
    const opened = open(doc(`<defs id="altre"><linearGradient id="g1"><stop stop-color="#000000"/></linearGradient></defs>${LAYER}${IMG()}</g>`));
    run(opened, cropOps(opened.engine.model!, opened.engine.holder("img")!, crop(20, 10, 220, 130), ids(opened)));
    expect(body(opened)).not.toContain("fub-defs");
    expect(body(opened)).toMatch(/<\/linearGradient>\s*<clipPath id="R1" fub:role="private">/);
  });

  it("un ritaglio privato e solo suo cambia sul posto, con part sul rettangolo", () => {
    const opened = sheet(DEFS(CLIP("c1")), IMG("img", ' clip-path="url(#c1)"'));
    const ops = cropOps(opened.engine.model!, opened.engine.holder("img")!, crop(40, 10, 220, 150), ids(opened));
    expect(ops).toEqual([{ op: "set", id: "c1", part: [0], attrs: { x: "40", width: "180", height: "140" } }]);
    run(opened, ops);
    expect(body(opened)).toBe(
      [
        '<defs id="fub-defs"><clipPath id="c1" fub:role="private">',
        '  <rect x="40" y="10" width="180" height="140"/>',
        `</clipPath></defs>${LAYER}<image id="img" x="0" y="0" width="300" height="200" href="${HREF}" clip-path="url(#c1)"/></g>`,
      ].join("\n"),
    );
  });

  it("il rettangolo si trova anche dopo titolo e descrizione", () => {
    const clip = '<clipPath id="c1" fub:role="private"><title>Ritaglio</title><rect x="20" y="10" width="200" height="120"/></clipPath>';
    const opened = sheet(DEFS(clip), IMG("img", ' clip-path="url(#c1)"'));
    const ops = cropOps(opened.engine.model!, opened.engine.holder("img")!, crop(30, 10, 220, 130), ids(opened));
    expect(ops).toEqual([{ op: "set", id: "c1", part: [1], attrs: { x: "30", width: "190" } }]);
    run(opened, ops);
    expect(body(opened)).toMatch(/<title>Ritaglio<\/title>\s*<rect x="30" y="10" width="190" height="120"\/>/);
  });

  it("un ritaglio che non cambia, scritto, non fa niente", () => {
    const opened = sheet(DEFS(CLIP("c1")), IMG("img", ' clip-path="url(#c1)"'));
    const model = opened.engine.model!;
    const node = opened.engine.holder("img")!;
    expect(cropOps(model, node, crop(20, 10, 220, 130), ids(opened))).toEqual([]);
    // Un cambio più piccolo di un centesimo si scrive uguale.
    expect(cropOps(model, node, crop(20.004, 9.996, 219.996, 130.004), ids(opened))).toEqual([]);
    const free = sheet("", IMG());
    expect(cropOps(free.engine.model!, free.engine.holder("img")!, FULL, ids(free))).toEqual([]);
  });

  it("un ritaglio condiviso con un altro oggetto è copiato per questa immagine", () => {
    const opened = sheet(DEFS(CLIP("c1")), `${IMG("img", ' clip-path="url(#c1)"')}${IMG("other", ' clip-path="url(#c1)"')}`);
    const ops = cropOps(opened.engine.model!, opened.engine.holder("img")!, crop(40, 10, 220, 130), ids(opened));
    expect(ops.map((op) => op.op)).toEqual(["add", "set"]);
    run(opened, ops);
    expect(body(opened)).toBe(
      [
        '<defs id="fub-defs"><clipPath id="c1" fub:role="private"><rect x="20" y="10" width="200" height="120"/></clipPath>',
        '<clipPath id="R1" fub:role="private">',
        '  <rect x="40" y="10" width="180" height="120"/>',
        `</clipPath></defs>${LAYER}<image id="img" x="0" y="0" width="300" height="200" clip-path="url(#R1)" href="${HREF}"/>`,
        `<image id="other" x="0" y="0" width="300" height="200" href="${HREF}" clip-path="url(#c1)"/></g>`,
      ].join("\n").replace("/>\n<image", "/><image"),
    );
    // L'altra tiene il suo.
    expect(stateOf(opened, "other")).toEqual({ kind: "crop", crop: crop(20, 10, 220, 130), clip: "c1" });
  });

  it("un ritaglio che non è di FubDraw non si cambia: l'immagine ne riceve uno suo", () => {
    const opened = sheet(DEFS(CLIP("c1", '<rect x="20" y="10" width="200" height="120"/>', "")), IMG("img", ' clip-path="url(#c1)"'));
    const ops = cropOps(opened.engine.model!, opened.engine.holder("img")!, crop(40, 10, 220, 130), ids(opened));
    run(opened, ops);
    const text = body(opened);
    expect(text).toContain('<clipPath id="c1"><rect x="20" y="10" width="200" height="120"/></clipPath>');
    expect(text).toContain('clip-path="url(#R1)"');
    expect(text).toContain('<clipPath id="R1" fub:role="private">');
    expect(stateOf(opened)).toMatchObject({ kind: "crop", crop: crop(40, 10, 220, 130) });
  });

  it("un ritaglio condiviso (fub:role shared) resta agli altri", () => {
    const opened = sheet(DEFS(CLIP("c1", '<rect x="20" y="10" width="200" height="120"/>', ' fub:role="shared"')), IMG("img", ' clip-path="url(#c1)"'));
    run(opened, cropOps(opened.engine.model!, opened.engine.holder("img")!, crop(40, 10, 220, 130), ids(opened)));
    // Nessuno lo usa più: il motore lo toglie, come ogni risorsa condivisa.
    expect(body(opened)).not.toContain('id="c1"');
    expect(body(opened)).toContain('<rect x="40" y="10" width="180" height="120"/>');
  });

  it("un ritaglio uguale all'immagine intera toglie il clip-path, e il motore il ritaglio", () => {
    const opened = sheet(DEFS(CLIP("c1")), IMG("img", ' clip-path="url(#c1)"'));
    const ops = cropOps(opened.engine.model!, opened.engine.holder("img")!, FULL, ids(opened));
    expect(ops).toEqual([{ op: "set", id: "img", attrs: { "clip-path": null } }]);
    run(opened, ops);
    expect(body(opened)).toBe(`${LAYER}${IMG()}</g>`);
  });

  it("l'ultimo ritaglio che se ne va porta via anche la fub-defs vuota, ma non le altre risorse", () => {
    const gradient = '<linearGradient id="g1" fub:role="private"><stop stop-color="#000000"/></linearGradient>';
    const opened = sheet(DEFS(gradient, CLIP("c1")), `${IMG("img", ' clip-path="url(#c1)"')}<rect id="r" x="0" y="0" width="5" height="5" fill="url(#g1) #000000"/>`);
    run(opened, cropOps(opened.engine.model!, opened.engine.holder("img")!, FULL, ids(opened)));
    expect(body(opened)).toContain('<defs id="fub-defs"><linearGradient id="g1"');
    expect(body(opened)).not.toContain("clipPath");
  });

  it("un ritaglio tornato intero dopo l'arrotondamento è nessun ritaglio", () => {
    const opened = sheet(DEFS(CLIP("c1")), IMG("img", ' clip-path="url(#c1)"'));
    // Mezzo centesimo dai bordi: si scriverebbe come l'immagine intera.
    const ops = cropOps(opened.engine.model!, opened.engine.holder("img")!, crop(0.004, 0.004, 299.996, 199.996), ids(opened));
    expect(ops).toEqual([{ op: "set", id: "img", attrs: { "clip-path": null } }]);
  });

  it("un ritaglio libero e intero non scrive niente, e un'immagine libera che si sposta cambia la posizione", () => {
    const opened = sheet("", IMG());
    const model = opened.engine.model!;
    const node = opened.engine.holder("img")!;
    expect(cropOps(model, node, FULL, ids(opened))).toEqual([]);
    // Un'immagine libera che si sposta, senza ritaglio, cambia soltanto x e y.
    const moved = box(10, 5, 310, 205);
    expect(cropOps(model, node, { box: moved, rect: moved }, ids(opened))).toEqual([{ op: "set", id: "img", attrs: { x: "10", y: "5" } }]);
  });

  it("l'immagine scivola sotto il ritaglio: cambiano x e y, il rettangolo resta", () => {
    const opened = sheet(DEFS(CLIP("c1")), IMG("img", ' clip-path="url(#c1)"'));
    const slid = slideImage(crop(20, 10, 220, 130), [-30, -20]);
    const ops = cropOps(opened.engine.model!, opened.engine.holder("img")!, slid, ids(opened));
    expect(ops).toEqual([{ op: "set", id: "img", attrs: { x: "-30", y: "-20" } }]);
    run(opened, ops);
    expect(body(opened)).toContain(`<image id="img" x="-30" y="-20" width="300" height="200" clip-path="url(#c1)" href="${HREF}"/>`);
    expect(body(opened)).toContain('<rect x="20" y="10" width="200" height="120"/>');
    expect(stateOf(opened)).toMatchObject({ kind: "crop", crop: { box: box(-30, -20, 270, 180), rect: box(20, 10, 220, 130) } });
  });

  it("l'immagine scivola e il ritaglio cambia nello stesso passo", () => {
    const opened = sheet(DEFS(CLIP("c1")), IMG("img", ' clip-path="url(#c1)"'));
    const next: Crop = { box: box(-5, -5, 295, 195), rect: box(10, 10, 230, 130) };
    const ops = cropOps(opened.engine.model!, opened.engine.holder("img")!, next, ids(opened));
    expect(ops).toEqual([
      { op: "set", id: "c1", part: [0], attrs: { x: "10", width: "220" } },
      { op: "set", id: "img", attrs: { x: "-5", y: "-5" } },
    ]);
    run(opened, ops);
    expect(stateOf(opened)).toMatchObject({ kind: "crop", crop: next });
  });

  it("l'arrotondamento non porta mai il rettangolo fuori dall'immagine", () => {
    // L'immagine comincia a 10,004: 10,00 sarebbe un centesimo fuori.
    const opened = open(doc(`${DEFS(CLIP("c1", '<rect x="20" y="10" width="50" height="50"/>'))}${LAYER}<image id="img" x="10.004" y="20.004" width="100" height="50" href="${HREF}" clip-path="url(#c1)"/></g>`));
    const model = opened.engine.model!;
    const node = opened.engine.holder("img")!;
    const state = stateOf(opened);
    expect(state.kind).toBe("crop");
    const box0 = (state as Extract<CropState, { kind: "crop" }>).crop.box;
    const next: Crop = { box: box0, rect: box(box0.min[0], box0.min[1] + 5, box0.min[0] + 40.004, box0.max[1]) };
    const ops = cropOps(model, node, next, ids(opened));
    run(opened, ops);
    // Il lato sinistro, che è il bordo dell'immagine, 10,004, si scrive 10,01:
    // dentro. Il fondo, 70,004, si scrive 70: dentro. Il lato in alto, che è
    // del ritaglio, si arrotonda al più vicino.
    expect(body(opened)).toContain('<rect x="10.01" y="25" width="40" height="45"/>');
    const [x, y, w, h] = writtenRect(opened);
    expect(x).toBeGreaterThanOrEqual(10.004);
    expect(y).toBeGreaterThanOrEqual(20.004);
    expect(x + w).toBeLessThanOrEqual(110.004);
    expect(y + h).toBeLessThanOrEqual(70.004);
  });

  it("l'arrotondamento resta dentro il riquadro scritto quando l'immagine scivola", () => {
    const opened = sheet(DEFS(CLIP("c1", '<rect x="20" y="10" width="200" height="120"/>')), IMG("img", ' clip-path="url(#c1)"'));
    // Il ritaglio tocca il bordo sinistro dell'immagine che scivola a 20,006:
    // 20,006 si scrive 20,01, e il rettangolo parte da 20,01, non da 20.
    const slid: Crop = { box: box(20.006, 0, 320.006, 200), rect: box(20.006, 10, 220, 130) };
    const ops = cropOps(opened.engine.model!, opened.engine.holder("img")!, slid, ids(opened));
    run(opened, ops);
    expect(body(opened)).toContain('<image id="img" x="20.01" y="0"');
    expect(body(opened)).toContain('<rect x="20.01" y="10" width="199.99" height="120"/>');
  });

  it("scritti, il rettangolo e l'immagine non lasciano margini trasparenti: ogni lato del rettangolo sta nel riquadro", () => {
    const cases: Crop[] = [
      crop(0.004, 0.004, 100.006, 100.006),
      crop(0.006, 0.006, 299.994, 199.994),
      crop(33.333333, 22.222222, 266.666666, 177.777777),
      { box: box(-0.006, 0.006, 299.994, 200.006), rect: box(10.1234, 10.1234, 20.5678, 20.5678) },
    ];
    for (const next of cases) {
      const fresh = sheet(DEFS(CLIP("c1")), IMG("img", ' clip-path="url(#c1)"'));
      const ops = cropOps(fresh.engine.model!, fresh.engine.holder("img")!, next, ids(fresh));
      run(fresh, ops);
      const after = stateOf(fresh);
      if (after.kind !== "crop") {
        expect(after.kind).toBe("free");
        continue;
      }
      const [x, y, w, h] = writtenRect(fresh);
      const image = /<image id="img" x="([^"]*)" y="([^"]*)"/.exec(fresh.engine.text)!;
      const [ix, iy] = [Number(image[1]), Number(image[2])];
      expect(x).toBeGreaterThanOrEqual(ix - 1e-9);
      expect(y).toBeGreaterThanOrEqual(iy - 1e-9);
      expect(x + w).toBeLessThanOrEqual(ix + 300 + 1e-9);
      expect(y + h).toBeLessThanOrEqual(iy + 200 + 1e-9);
    }
  });

  it("un altro ritaglio non si cambia: niente operazioni", () => {
    const clip = CLIP("c1", '<rect x="20" y="10" width="200" height="120" rx="8"/>');
    const opened = sheet(DEFS(clip), IMG("img", ' clip-path="url(#c1)"'));
    expect(cropOps(opened.engine.model!, opened.engine.holder("img")!, crop(30, 10, 220, 130), ids(opened))).toEqual([]);
  });

  it("non è un'immagine: niente operazioni", () => {
    const opened = sheet("", '<rect id="r" x="0" y="0" width="10" height="10"/>');
    expect(cropOps(opened.engine.model!, opened.engine.holder("r")!, crop(1, 1, 5, 5), ids(opened))).toEqual([]);
  });

  it("un'immagine senza id ne riceve uno, e il ritaglio si scrive", () => {
    const opened = sheet("", `<image x="0" y="0" width="300" height="200" href="${HREF}"/>`);
    const node = nodeOf(opened.engine.model!, opened.index.units[0]!);
    const ops = cropOps(opened.engine.model!, node, crop(20, 10, 220, 130), ids(opened));
    expect(ops[0]!.op).toBe("ident");
    run(opened, ops);
    expect(body(opened)).toMatch(/<image id="O1" x="0" y="0" width="300" height="200" clip-path="url\(#R1\)"/);
  });

  it("le immagini ruotate o scalate si ritagliano nelle loro coordinate", () => {
    const opened = sheet("", IMG("img", ' transform="rotate(30) scale(2)"'));
    run(opened, cropOps(opened.engine.model!, opened.engine.holder("img")!, crop(20, 10, 220, 130), ids(opened)));
    expect(body(opened)).toContain('<rect x="20" y="10" width="200" height="120"/>');
    expect(body(opened)).toContain('transform="rotate(30) scale(2)"');
  });

  it("un giro: ritaglia, sposta, allarga e toglie, e annulla riporta ogni testo", () => {
    const opened = sheet("", IMG());
    const texts = [opened.engine.text];
    const steps: Crop[] = [crop(20, 10, 220, 130), slideImage(crop(20, 10, 220, 130), [-10, -10]), { box: box(-10, -10, 290, 190), rect: box(0, 0, 230, 140) }, { box: box(-10, -10, 290, 190), rect: box(-10, -10, 290, 190) }];
    for (const next of steps) {
      const ops = cropOps(opened.engine.model!, opened.engine.holder("img")!, next, ids(opened));
      run(opened, ops);
      texts.push(opened.engine.text);
    }
    expect(texts[1]).toContain("clipPath");
    expect(texts[3]).toContain('<rect x="0" y="0" width="230" height="140"/>');
    expect(texts[4]).not.toContain("clipPath");
    expect(texts[4]).toContain('<image id="img" x="-10" y="-10"');
  });
});

describe("croppedImages e uncropOps", () => {
  const defs = DEFS(CLIP("c1"), CLIP("c2", '<rect x="20" y="10" width="200" height="120" rx="8"/>'));
  const doc3 = (): Opened =>
    sheet(
      defs,
      [IMG("a", ' clip-path="url(#c1)"'), IMG("b", ' clip-path="url(#c2)"'), IMG("c"), '<rect id="r" x="0" y="0" width="10" height="10"/>'].join(""),
    );

  it("sceglie le immagini che hanno un clip-path, ritaglio o no", () => {
    const opened = doc3();
    expect(croppedImages(opened.engine.model!, opened.index.units).map((unit) => unit.key)).toEqual(["a", "b"]);
    expect(croppedImages(opened.engine.model!, [opened.index.get("c")!, opened.index.get("r")!])).toEqual([]);
  });

  it("toglie il clip-path a tutte, e la selezione resta la stessa", () => {
    const opened = doc3();
    const units = opened.index.units;
    const change = uncropOps(opened.engine.model!, units, ids(opened));
    expect(change.keys).toEqual(units.map((unit) => unit.key));
    expect(change.ops).toEqual([
      { op: "set", id: "a", attrs: { "clip-path": null } },
      { op: "set", id: "b", attrs: { "clip-path": null } },
    ]);
    run(opened, [...change.ops]);
    expect(body(opened)).toBe(`${LAYER}${IMG("a")}${IMG("b")}${IMG("c")}<rect id="r" x="0" y="0" width="10" height="10"/></g>`);
  });

  it("un ritaglio condiviso resta alle altre immagini", () => {
    const opened = sheet(DEFS(CLIP("c1")), `${IMG("a", ' clip-path="url(#c1)"')}${IMG("b", ' clip-path="url(#c1)"')}`);
    const change = uncropOps(opened.engine.model!, [opened.index.get("a")!], ids(opened));
    run(opened, [...change.ops]);
    expect(body(opened)).toContain('<clipPath id="c1"');
    expect(body(opened)).toContain(IMG("b", ' clip-path="url(#c1)"').replace("img", "b"));
  });

  it("senza niente da togliere non scrive niente", () => {
    const opened = doc3();
    const change = uncropOps(opened.engine.model!, [opened.index.get("c")!, opened.index.get("r")!], ids(opened));
    expect(change).toEqual({ ops: [], keys: ["c", "r"] });
  });

  it("un'immagine senza id che si scopre riceve un id, e la selezione la segue", () => {
    const opened = sheet(DEFS(CLIP("c1")), `<image x="0" y="0" width="300" height="200" href="${HREF}" clip-path="url(#c1)"/>`);
    const unit = opened.index.units[0]!;
    const change = uncropOps(opened.engine.model!, [unit], ids(opened));
    expect(change.keys).toHaveLength(1);
    expect(change.keys[0]).toMatch(/^o[0-9a-z]{8}$/);
    run(opened, [...change.ops]);
    expect(opened.engine.holder(change.keys[0]!)).not.toBeNull();
    expect(opened.engine.text).not.toContain("clipPath");
  });
});

describe("duplicare e copiare un'immagine ritagliata", () => {
  const CROPPED = (): Opened => sheet(DEFS(CLIP("c1")), IMG("img", ' clip-path="url(#c1)"'));

  it("il duplicato ha un ritaglio privato suo, con un id nuovo", () => {
    const opened = CROPPED();
    const unit = opened.index.get("img")!;
    const copy = duplicateOps(opened.engine.model!, [unit], 10, 10, ids(opened))!;
    run(opened, [...copy.ops]);
    const text = named(opened.engine.text);
    expect(text.match(/<clipPath /g)).toHaveLength(2);
    expect(text).toContain('<clipPath id="c1" fub:role="private">');
    expect(text).toMatch(/<clipPath id="R1" fub:role="private">\s*<rect x="20" y="10" width="200" height="120"\/>/);
    expect(text).toContain(`<image id="O1" x="0" y="0" width="300" height="200" clip-path="url(#R1)" transform="matrix(1 0 0 1 10 10)" href="${HREF}"/>`);
    // L'originale tiene il suo, e ognuno è solo di chi lo usa.
    expect(text).toContain(`<image id="img" x="0" y="0" width="300" height="200" href="${HREF}" clip-path="url(#c1)"`);
    expect(stateOf(opened, "img")).toMatchObject({ kind: "crop", clip: "c1" });
  });

  it("cambiare il ritaglio del duplicato non tocca l'originale", () => {
    const opened = CROPPED();
    const copy = duplicateOps(opened.engine.model!, [opened.index.get("img")!], 10, 10, ids(opened))!;
    run(opened, [...copy.ops]);
    const key = copy.keys[0]!;
    run(opened, cropOps(opened.engine.model!, opened.engine.holder(key)!, crop(50, 50, 100, 100), ids(opened)));
    expect(stateOf(opened, "img")).toMatchObject({ crop: crop(20, 10, 220, 130) });
    expect(stateOf(opened, key)).toMatchObject({ crop: crop(50, 50, 100, 100) });
  });

  it("copiare e incollare in un altro disegno porta il ritaglio con un id nuovo", () => {
    const source = CROPPED();
    const unit = source.index.get("img")!;
    const svg = copySvg({ text: source.engine.text, paths: [pathOf(nodeOf(source.engine.model!, unit))], bounds: boundsOf([unit])! });
    expect(svg).not.toBeNull();
    expect(svg).toContain("<clipPath");
    const target = open(doc(`${LAYER}<rect id="base" x="0" y="0" width="5" height="5"/></g>`));
    const pasted = readPaste(svg!, null);
    if (typeof pasted === "string") throw new Error(`non si incolla: ${pasted}`);
    const newIds = new NewIds((id) => target.engine.holder(id) !== null);
    const layer = target.index.layers[0]!;
    const model = target.engine.model!;
    const run0 = planPaste(pasted, { model, container: nodeOf(model, layer) as ContainerNode, to: destinationIn(layer, newIds)!, ids: newIds, delta: [0, 0], href: () => null });
    let next = run0.next();
    while (next.done !== true) next = run0.next();
    applied(target, [...next.value.ops]);
    const text = named(target.engine.text);
    expect(text.match(/<clipPath /g)).toHaveLength(1);
    expect(text).toMatch(/<clipPath id="R1" fub:role="private">\s*<rect x="20" y="10" width="200" height="120"\/>\s*<\/clipPath>/);
    expect(text).toMatch(/<image id="O1" [^>]*clip-path="url\(#R1\)"/);
    expect(text).not.toContain('id="c1"');
    // Incollato, è un ritaglio che FubDraw cambia.
    const id = /<image id="(o[0-9a-z]{8})"/.exec(target.engine.text)![1]!;
    expect(stateOf(target, id).kind).toBe("crop");
  });
});
