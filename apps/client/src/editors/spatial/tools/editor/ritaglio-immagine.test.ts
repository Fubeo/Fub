// @vitest-environment happy-dom
// Ritaglia immagine (`object.cropImage` e `ui.cropImage`) del Disegno completo: lo strumento
// di VectorCraft (`cropimage.rs`) sull'editor, con il ritaglio non distruttivo di `../crop.ts`.
// Le prove: le regole pure (maniglie, spostamento dentro l'immagine), poi lo strumento su un
// contesto finto con un motore vero: maniglie, spostamento, Invio, doppio clic, Esc, un
// riquadro uguale che non scrive niente, la scelta che cambia e chiude, e le voci del menu.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import { t } from "../../strings";
import type { Bounds } from "../../scene/geometry";
import { doc } from "../../scene/test-support";
import { cropState } from "../crop";
import { NewIds } from "../edit";
import { LAYER, open, type Opened } from "../test-support";
import { applied } from "../tip-support";
import type { EditorContext } from "./context";
import { comandoDiFub, voceImmagini } from "./chrome/status";
import { eseguiVoceClient } from "./chrome/commands";
import { embedOps, linkedImages } from "./vault-images";
import { handleAt, handleSpot, installCropImage, sameRect, slidWithin } from "./ritaglio-immagine";

const HREF = "data:image/png;base64,AA==";
const IMG = (id = "oi1i1i1i1"): string => `<image id="${id}" x="0" y="0" width="300" height="200" href="${HREF}"/>`;
const RECT = '<rect id="or1r1r1r1" x="400" y="0" width="20" height="20"/>';

const box = (x0: number, y0: number, x1: number, y1: number): Bounds => ({ min: [x0, y0], max: [x1, y1] });
const IDENTITA = (p: readonly [number, number]): [number, number] => [p[0], p[1]];

describe("le regole del riquadro", () => {
  it("le maniglie stanno su angoli e lati, e si prendono entro qualche pixel", () => {
    const r = box(10, 20, 110, 220);
    expect(handleSpot(r, "nw")).toEqual([10, 20]);
    expect(handleSpot(r, "e")).toEqual([110, 120]);
    expect(handleSpot(r, "s")).toEqual([60, 220]);
    expect(handleAt(r, IDENTITA, [113, 223])).toBe("se");
    expect(handleAt(r, IDENTITA, [60, 18])).toBe("n");
    expect(handleAt(r, IDENTITA, [60, 120])).toBeNull();
    expect(handleAt(r, IDENTITA, [130, 240])).toBeNull();
  });

  it("spostato, il riquadro tiene la misura e resta dentro l'immagine", () => {
    const tutta = box(0, 0, 300, 200);
    expect(slidWithin(box(10, 10, 110, 60), tutta, [20, 5])).toEqual(box(30, 15, 130, 65));
    expect(slidWithin(box(10, 10, 110, 60), tutta, [500, -50])).toEqual(box(200, 0, 300, 50));
    expect(sameRect(box(0, 0, 1, 1), box(0.0001, 0, 1, 1))).toBe(true);
    expect(sameRect(box(0, 0, 1, 1), box(0.1, 0, 1, 1))).toBe(false);
  });
});

let owner: Lifetime;
let root: HTMLElement;

beforeEach(() => {
  owner = openLifetime();
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  owner.close();
  root.remove();
});

interface Finto {
  readonly ctx: EditorContext;
  readonly opened: Opened;
  readonly surface: HTMLElement;
  readonly scritti: string[];
  readonly detti: string[];
  scegli(keys: string[]): void;
}

function fingi(corpo: string, scelti: string[], editabile = true): Finto {
  const opened = open(doc(`${LAYER}${corpo}</g>`));
  const surface = document.createElement("div");
  root.append(surface);
  const ascolta = new Set<() => void>();
  const scritti: string[] = [];
  const detti: string[] = [];
  const ctx = {
    disposed: false,
    loads: 1,
    asking: false,
    engine: opened.engine,
    camera: { scale: 1, angle: 0, tx: 0, ty: 0 },
    selection: scelti,
    root,
    surface,
    life: owner,
    options: {},
    status: { subscribe: (fn: () => void) => (ascolta.add(fn), () => ascolta.delete(fn)), items: () => [] },
    editable: () => editabile,
    currentIndex: () => opened.reindex(),
    selectedUnits: () => ctx.selection.map((key) => opened.reindex().get(key)).filter((u) => u !== null),
    select: (keys: readonly string[]) => scegli([...keys]),
    sceneAt: (x: number, y: number) => [x, y],
    measuresText: ([w, h]: readonly [number, number]) => `${w} × ${h}`,
    newIds: () => new NewIds((id) => opened.engine.holder(id) !== null),
    cancelGesture: () => undefined,
    announce: (text: string) => detti.push(text),
    arrange: (label: string, arranged: { ops: Parameters<typeof applied>[1] }) => {
      scritti.push(label);
      const prima = opened.engine.text;
      applied(opened, arranged.ops);
      // `applied` disfa e rifà: il disegno resta quello di dopo.
      expect(opened.engine.text).not.toBe(prima);
      return label;
    },
  } as unknown as EditorContext & { selection: string[] };
  const scegli = (keys: string[]): void => {
    ctx.selection = keys;
    for (const fn of [...ascolta]) fn();
  };
  installCropImage(ctx);
  return { ctx, opened, surface, scritti, detti, scegli };
}

const punta = (bersaglio: HTMLElement, tipo: string, x: number, y: number, extra: PointerEventInit = {}): void => {
  bersaglio.dispatchEvent(new PointerEvent(tipo, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1, ...extra }));
};
const tira = (f: Finto, da: [number, number], a: [number, number], extra: PointerEventInit = {}): void => {
  punta(f.surface, "pointerdown", ...da, extra);
  punta(f.surface, "pointermove", ...a, extra);
  punta(f.surface, "pointerup", ...a, extra);
};
const tasto = (key: string): void => {
  root.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
};
const riquadroDi = (f: Finto, id = "oi1i1i1i1"): Bounds => {
  const state = cropState(f.opened.engine.model!, f.opened.engine.holder(id)!);
  if (state === null || state.kind === "other") throw new Error("non è un ritaglio");
  return state.crop.rect;
};

describe("lo strumento sul foglio", () => {
  it("parte dall'immagine intera, la maniglia la stringe e Invio ritaglia in un passo", () => {
    const f = fingi(IMG(), ["oi1i1i1i1"]);
    f.ctx.cropImage();
    expect(f.ctx.croppingImage()).toBe(true);
    expect(f.detti).toContain(t("draw.crop.hint"));
    expect(f.surface.querySelector(".draw-ritaglio-ombra")).not.toBeNull();
    expect(f.surface.querySelectorAll(".draw-ritaglio-maniglia")).toHaveLength(8);
    tira(f, [300, 200], [200, 150]);
    tasto("Enter");
    expect(f.ctx.croppingImage()).toBe(false);
    expect(f.scritti).toEqual(["draw.action.cropImage"]);
    expect(riquadroDi(f)).toEqual(box(0, 0, 200, 150));
    // L'immagine non cambia: stessi byte, stessa misura.
    expect(f.opened.engine.text).toContain(`href="${HREF}"`);
    expect(f.opened.engine.text).toContain('width="300" height="200"');
    expect(f.surface.querySelector(".draw-ritaglio-ombra")).toBeNull();
  });

  it("l'interno sposta il riquadro, che non esce dall'immagine; il doppio clic ritaglia", () => {
    const f = fingi(IMG(), ["oi1i1i1i1"]);
    f.ctx.cropImage();
    tira(f, [300, 200], [100, 100]);
    tira(f, [50, 50], [400, 400]);
    f.surface.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: 250, clientY: 150 }));
    expect(riquadroDi(f)).toEqual(box(200, 100, 300, 200));
  });

  it("Maiusc tiene le proporzioni, e un ritaglio già fatto si riapre col suo riquadro", () => {
    const f = fingi(IMG(), ["oi1i1i1i1"]);
    f.ctx.cropImage();
    tira(f, [300, 200], [150, 180], { shiftKey: true });
    tasto("Enter");
    const r = riquadroDi(f);
    expect((r.max[0] - r.min[0]) / (r.max[1] - r.min[1])).toBeCloseTo(1.5, 5);
    f.ctx.cropImage();
    // Il lato destro torna fuori: la parte tolta c'è ancora.
    tira(f, [r.max[0], (r.min[1] + r.max[1]) / 2], [300, (r.min[1] + r.max[1]) / 2]);
    tasto("Enter");
    expect(riquadroDi(f).max[0]).toBe(300);
  });

  it("Esc lascia l'immagine com'era, e un riquadro uguale non scrive niente", () => {
    const f = fingi(IMG(), ["oi1i1i1i1"]);
    const prima = f.opened.engine.text;
    f.ctx.cropImage();
    tira(f, [300, 200], [100, 100]);
    tasto("Escape");
    expect(f.ctx.croppingImage()).toBe(false);
    expect(f.detti).toContain(t("draw.crop.cancelled"));
    f.ctx.cropImage();
    tasto("Enter");
    expect(f.scritti).toEqual([]);
    expect(f.opened.engine.text).toBe(prima);
  });

  it("un clic fuori dal riquadro non fa niente, e cambiare la scelta chiude senza scrivere", () => {
    const f = fingi(IMG() + RECT, ["oi1i1i1i1"]);
    f.ctx.cropImage();
    tira(f, [380, 300], [10, 10]);
    expect(f.ctx.croppingImage()).toBe(true);
    f.scegli(["or1r1r1r1"]);
    expect(f.ctx.croppingImage()).toBe(false);
    expect(f.scritti).toEqual([]);
  });

  it("senza immagine scelta, o in sola lettura, non parte", () => {
    const f = fingi(IMG() + RECT, ["or1r1r1r1"]);
    f.ctx.cropImage();
    expect(f.ctx.croppingImage()).toBe(false);
    expect(f.detti).toEqual([t("draw.crop.none")]);
    const sola = fingi(IMG(), ["oi1i1i1i1"], false);
    sola.ctx.cropImage();
    expect(sola.ctx.croppingImage()).toBe(false);
  });

  it("con la scelta di più oggetti prende la prima immagine e stringe la scelta a lei", () => {
    const f = fingi(RECT + IMG(), ["or1r1r1r1", "oi1i1i1i1"]);
    f.ctx.cropImage();
    expect(f.ctx.croppingImage()).toBe(true);
    expect(f.ctx.selection).toEqual(["oi1i1i1i1"]);
  });
});

describe("le voci del menu", () => {
  it("Ritaglia immagine del motore e dell'interfaccia aprono lo strumento, con lo stato giusto", () => {
    const f = fingi(IMG() + RECT, ["or1r1r1r1"]);
    expect(voceImmagini(f.ctx, "ui.cropImage")).toBe(t("draw.crop.none"));
    f.scegli(["oi1i1i1i1"]);
    expect(voceImmagini(f.ctx, "ui.cropImage")).toBeNull();
    eseguiVoceClient(f.ctx, "ui.cropImage");
    expect(f.ctx.croppingImage()).toBe(true);
    // Di nuovo, ritaglia: come Invio.
    expect(comandoDiFub(f.ctx, "disegno.object.cropImage")).toBe(true);
    expect(f.ctx.croppingImage()).toBe(false);
  });

  it("Inserisci… e Incorpora immagine passano dal client", () => {
    const vaultImage = vi.fn(async () => undefined);
    const embedImages = vi.fn(async () => undefined);
    const ctx = { vaultImage, embedImages, editable: () => true, insertsImages: () => false, features: new Set() } as unknown as EditorContext;
    expect(voceImmagini(ctx, "file.place")).toBe(t("draw.place.off"));
    eseguiVoceClient(ctx, "file.place");
    expect(comandoDiFub(ctx, "disegno.file.place")).toBe(true);
    expect(comandoDiFub(ctx, "disegno.links.embed")).toBe(true);
    expect(vaultImage).toHaveBeenCalledTimes(2);
    expect(embedImages).toHaveBeenCalledTimes(1);
  });
});

describe("Incorpora immagine", () => {
  const PNG = "data:image/png;base64,iVBORw0KGgo=";
  const COLLEGATE =
    '<image id="oa1a1a1a1" x="0" y="0" width="30" height="20" href="foto/uno.png"/>' +
    '<image x="40" y="0" width="30" height="20" xlink:href="foto/due.png"/>' +
    `<image id="oc1c1c1c1" x="80" y="0" width="30" height="20" href="${HREF}"/>` +
    RECT;

  it("prende solo le immagini collegate a un file, e scrive i byte al posto del collegamento", () => {
    const opened = open(doc(`${LAYER}${COLLEGATE}</g>`));
    const units = opened.seen();
    const linked = linkedImages(opened.engine.model!, units);
    expect(linked.map(({ href }) => href)).toEqual(["foto/uno.png", "foto/due.png"]);
    const ids = new NewIds((id) => opened.engine.holder(id) !== null);
    const arranged = embedOps(opened.engine.model!, linked, [PNG, PNG], ids);
    const dopo = applied(opened, arranged.ops);
    expect(dopo).not.toContain("foto/");
    expect(dopo.split(`href="${PNG}"`)).toHaveLength(3);
    expect(dopo).toContain(`xlink:href="${PNG}"`);
    // La misura non cambia, e l'immagine senza id ne riceve uno, che la scelta tiene.
    expect(dopo).toContain('x="40" y="0" width="30" height="20"');
    expect(arranged.keys[0]).toBe("oa1a1a1a1");
    expect(opened.engine.holder(arranged.keys[1]!)).not.toBeNull();
  });
});
