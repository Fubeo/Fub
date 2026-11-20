// @vitest-environment happy-dom
// Il ritaglio di un'immagine (T78): i conti del gesto (la rotazione e
// ritorno, le maniglie con l'angolo opposto fermo, il minimo di 1/100 del
// lato, i bordi dell'immagine, le proporzioni della zona ruotata, i numeri
// come si scrivono) e il ritaglio sopra la scheda (le classi del prototipo,
// ↺ ↻, Invio, Esc, «Togli il ritaglio», le frecce, il trascinamento,
// l'immagine intera ruotata, la riga dell'inchiostro).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CROP_MIN,
  WHOLE_ZONE,
  cropTurn,
  dragCorner,
  fromViewRect,
  isWholeZone,
  moveRect,
  nudgeCorner,
  openCropEditor,
  turnRect,
  turnZone,
  viewRect,
  writtenRect,
  zoneKey,
  zoneOf,
  zoneParts,
  zoneRatio,
  type CropEditorOptions,
  type CropTurn,
  type ImageZone,
} from "./crop";
import { writeParts, type PartRect } from "./parts";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { t } from "../../i18n/strings";

const close = (actual: readonly number[], expected: readonly number[]): void => {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 9));
};

describe("la rotazione", () => {
  it("porta ogni numero al quarto di giro più vicino, fra 0 e 270", () => {
    expect([90, -90, 450, 180, 360, 44, 46, -1, Number.NaN, null, undefined].map((value) => cropTurn(value))).toEqual(
      [90, 270, 90, 180, 0, 0, 90, 0, 0, 0, 0],
    );
  });

  it("il rettangolo dell'immagine dritta si vede ruotato, e torna", () => {
    const rect: PartRect = [0.1, 0.2, 0.3, 0.4];
    close(turnRect(rect, 90), [0.4, 0.1, 0.4, 0.3]);
    close(turnRect(rect, 180), [0.6, 0.4, 0.3, 0.4]);
    close(turnRect(rect, 270), [0.2, 0.6, 0.4, 0.3]);
    for (const turn of [0, 90, 180, 270] as CropTurn[]) close(fromViewRect(turnRect(rect, turn), turn), rect);
    // Quattro quarti di giro sono un giro: la zona vista torna la stessa.
    let zone: ImageZone = { rect, turn: 0 };
    for (let i = 0; i < 4; i += 1) zone = turnZone(zone, 90);
    expect(zone).toEqual({ rect, turn: 0 });
    expect(turnZone({ rect, turn: 0 }, -90).turn).toBe(270);
  });

  it("le proporzioni della zona ruotata", () => {
    const natural = { width: 400, height: 300 };
    // 200 × 240 px; ruotata 240 × 200.
    expect(zoneRatio({ rect: [0.45, 0.1, 0.5, 0.8], turn: 0 }, natural)).toBeCloseTo(200 / 240);
    expect(zoneRatio({ rect: [0.45, 0.1, 0.5, 0.8], turn: 90 }, natural)).toBeCloseTo(240 / 200);
    expect(zoneRatio(WHOLE_ZONE, natural)).toBeCloseTo(4 / 3);
  });
});

describe("la zona dalle parti", () => {
  it("legge le parti di un'immagine; le altre specie e nessuna parte sono l'immagine intera", () => {
    expect(zoneOf(null)).toBe(WHOLE_ZONE);
    expect(zoneOf({ kind: "pages", pages: [1, 2], layout: null, extra: {} })).toBe(WHOLE_ZONE);
    expect(zoneOf({ kind: "image", rect: [0, 0.25, 1, 0.5], rotate: -90, extra: {} })).toEqual({ rect: [0, 0.25, 1, 0.5], turn: 270 });
    expect(isWholeZone(WHOLE_ZONE)).toBe(true);
    expect(isWholeZone({ rect: [0, 0, 1, 1], turn: 90 })).toBe(false);
  });

  it("il nome della zona nella cache distingue due tagli dello stesso file", () => {
    expect(zoneKey(WHOLE_ZONE)).toBe("whole");
    const keys = new Set([
      zoneKey({ rect: [0, 0, 0.5, 0.5], turn: 0 }),
      zoneKey({ rect: [0.5, 0, 0.5, 0.5], turn: 0 }),
      zoneKey({ rect: [0, 0, 0.5, 0.5], turn: 90 }),
    ]);
    expect(keys.size).toBe(3);
    for (const key of keys) expect(key).not.toContain("@");
  });

  it("si scrive a quattro cifre, dentro l'immagine, e writeParts la accetta", () => {
    const rect = writtenRect([1 / 3, 0, 2 / 3, 1]);
    expect(rect).toEqual([0.3333, 0, 0.6667, 1]);
    expect(rect[0] + rect[2]).toBeLessThanOrEqual(1 + 1e-6);
    const turned = writeParts("foto.png", zoneParts({ rect: [1 / 3, 0, 2 / 3, 1], turn: 270 }, { "x-mio": 1 }));
    expect(turned).toEqual({ outcome: "written", subpath: null, parts: { kind: "image", rect: [0.3333, 0, 0.6667, 1], rotate: 270, "x-mio": 1 } });
    const straight = writeParts("foto.png", zoneParts({ rect: [0, 0.25, 1, 0.5], turn: 0 }));
    expect(straight).toEqual({ outcome: "written", subpath: null, parts: { kind: "image", rect: [0, 0.25, 1, 0.5] } });
    // Un lato troppo corto si allarga al minimo.
    expect(writtenRect([0.5, 0.5, 0.00001, 0.00001])).toEqual([0.5, 0.5, CROP_MIN, CROP_MIN]);
    expect(writtenRect([0.99999, 0.99999, 0.00001, 0.00001])).toEqual([0.99, 0.99, CROP_MIN, CROP_MIN]);
  });
});

describe("il gesto", () => {
  const rect: PartRect = [0.1, 0.1, 0.5, 0.5];

  it("una maniglia sposta il suo angolo, l'opposto resta fermo", () => {
    close(dragCorner(rect, "se", [0.8, 0.9]), [0.1, 0.1, 0.7, 0.8]);
    close(dragCorner(rect, "nw", [0.3, 0.2]), [0.3, 0.2, 0.3, 0.4]);
    close(dragCorner(rect, "ne", [0.9, 0]), [0.1, 0, 0.8, 0.6]);
    close(dragCorner(rect, "sw", [0, 0.7]), [0, 0.1, 0.6, 0.6]);
  });

  it("oltre l'angolo opposto si ferma a 1/100 del lato: un taglio di un pixel non c'è", () => {
    close(dragCorner(rect, "se", [0, 0]), [0.1, 0.1, CROP_MIN, CROP_MIN]);
    close(dragCorner(rect, "nw", [0.6, 0.6]), [0.6 - CROP_MIN, 0.6 - CROP_MIN, CROP_MIN, CROP_MIN]);
  });

  it("non esce dall'immagine", () => {
    close(dragCorner(rect, "se", [3, 3]), [0.1, 0.1, 0.9, 0.9]);
    close(dragCorner(rect, "nw", [-1, -1]), [0, 0, 0.6, 0.6]);
    close(moveRect(rect, 0.9, -0.9), [0.5, 0, 0.5, 0.5]);
    close(moveRect(rect, -0.05, 0.05), [0.05, 0.15, 0.5, 0.5]);
  });

  it("una freccia sposta un angolo di un passo", () => {
    close(nudgeCorner(rect, "se", 0.01, 0), [0.1, 0.1, 0.51, 0.5]);
    close(nudgeCorner(rect, "nw", 0, -0.1), [0.1, 0, 0.5, 0.6]);
  });

  it("le maniglie lavorano sull'immagine ruotata, la zona resta in quella dritta", () => {
    const zone: ImageZone = { rect: [0, 0, 0.5, 1], turn: 90 };
    // Ruotata di 90°, la metà sinistra è la metà di sopra.
    close(viewRect(zone), [0, 0, 1, 0.5]);
    const dragged = dragCorner(viewRect(zone), "se", [1, 0.25]);
    close(fromViewRect(dragged, zone.turn), [0, 0, 0.25, 1]);
  });
});

// --- il ritaglio sopra la scheda ----------------------------------------------

interface Open {
  readonly editor: ReturnType<typeof openCropEditor>;
  readonly card: HTMLElement;
  /// La zona della vista che non scala: il piede ci sta.
  readonly chrome: HTMLElement;
  readonly frame: HTMLElement;
  readonly life: Lifetime;
  readonly done: ReturnType<typeof vi.fn>;
  readonly cancel: ReturnType<typeof vi.fn>;
  readonly remove: ReturnType<typeof vi.fn>;
  readonly turned: ReturnType<typeof vi.fn>;
  readonly measured: ReturnType<typeof vi.fn>;
  readonly overlay: () => HTMLElement;
  readonly box: () => HTMLElement;
  readonly handle: (corner: string) => HTMLElement;
  readonly button: (name: string) => HTMLButtonElement;
}

let rotations: number[];
let draws: unknown[][];

beforeEach(() => {
  rotations = [];
  draws = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({
      save: () => {},
      restore: () => {},
      translate: () => {},
      rotate: (angle: number) => void rotations.push(angle),
      drawImage: (...args: unknown[]) => void draws.push(args),
    }) as unknown as CanvasRenderingContext2D,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/// Una scheda col suo corpo; `picture` è l'immagine intera nel corpo.
function open(zone: ImageZone = { rect: [0.45, 0.1, 0.5, 0.8], turn: 0 }, extra: Partial<CropEditorOptions> = {}, picture: HTMLCanvasElement | null = null): Open {
  const card = document.createElement("article");
  const frame = document.createElement("div");
  card.append(frame);
  const chrome = document.createElement("div");
  document.body.append(card, chrome);
  const life = openLifetime();
  const done = vi.fn();
  const cancel = vi.fn();
  const remove = vi.fn();
  const turned = vi.fn();
  const measured = vi.fn();
  const editor = openCropEditor({
    frame,
    chrome,
    zone,
    ink: false,
    picture: () => picture,
    lifetime: life,
    onDone: done,
    onCancel: cancel,
    onRemove: remove,
    onTurn: turned,
    onMeasured: measured,
    ...extra,
  });
  return {
    editor, card, chrome, frame, life, done, cancel, remove, turned, measured,
    overlay: () => frame.querySelector<HTMLElement>(".canvas-crop")!,
    box: () => frame.querySelector<HTMLElement>(".canvas-crop-box")!,
    handle: (corner) => frame.querySelector<HTMLElement>(`.canvas-crop-handle[data-corner="${corner}"]`)!,
    button: (name) => chrome.querySelector<HTMLButtonElement>(`.canvas-crop-bar [data-crop="${name}"]`)!,
  };
}

const press = (target: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

/// Dà al ritaglio una misura: `width` × `height` px, allo zoom `zoom`.
function size(made: Open, width: number, height: number, zoom = 1): void {
  const overlay = made.overlay();
  Object.defineProperty(overlay, "clientWidth", { configurable: true, value: width });
  Object.defineProperty(overlay, "clientHeight", { configurable: true, value: height });
  overlay.getBoundingClientRect = () => ({ left: 100, top: 50, width: width * zoom, height: height * zoom, right: 100 + width * zoom, bottom: 50 + height * zoom, x: 100, y: 50, toJSON: () => ({}) });
  made.editor.layout();
}

describe("il ritaglio sopra la scheda", () => {
  it("ha le parti del prototipo: la zona con le quattro maniglie, la barra sotto la scheda", () => {
    const made = open();
    expect(made.overlay().parentElement).toBe(made.frame);
    expect(made.box().getAttribute("role")).toBe("group");
    expect(made.box().tabIndex).toBe(0);
    expect(made.box().getAttribute("aria-label")).toBe(t("canvas.crop.box"));
    const handles = [...made.box().querySelectorAll<HTMLElement>(".canvas-crop-handle")];
    expect(handles.map((handle) => handle.dataset.corner)).toEqual(["nw", "ne", "sw", "se"]);
    for (const handle of handles) {
      expect(handle.getAttribute("role")).toBe("slider");
      expect(handle.tabIndex).toBe(-1);
    }
    expect(made.handle("nw").getAttribute("aria-label")).toBe(t("canvas.crop.handle", { corner: t("canvas.crop.corner.nw") }));
    expect(made.handle("nw").getAttribute("aria-valuenow")).toBe("45");
    expect(made.handle("se").getAttribute("aria-valuenow")).toBe("95");
    const bar = made.chrome.querySelector<HTMLElement>(":scope > .canvas-crop-foot > .canvas-crop-bar")!;
    // Il piede sta fuori dalla scheda, nella zona che non scala.
    expect(made.card.querySelector(".canvas-crop-bar, .canvas-crop-foot")).toBeNull();
    expect(bar.getAttribute("role")).toBe("toolbar");
    expect([...bar.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? button.textContent)).toEqual([
      t("canvas.crop.rotate_left"), t("canvas.crop.rotate_right"), t("canvas.crop.remove"), t("canvas.crop.done"),
    ]);
    expect(made.button("done").dataset.kind).toBe("primary");
    expect(made.button("done").getAttribute("aria-keyshortcuts")).toBe("Enter");
    // Senza inchiostro sulla scheda, niente riga.
    expect(made.chrome.querySelector(".canvas-crop-note")).toBeNull();
    made.editor.close();
    expect(document.querySelector(".canvas-crop, .canvas-crop-foot, .canvas-crop-bar")).toBeNull();
    expect(made.editor.closed).toBe(true);
  });

  it("con l'inchiostro sulla scheda il piede dice che il tratto resta", () => {
    const made = open(undefined, { ink: true });
    expect(made.chrome.querySelector(".canvas-crop-foot > .canvas-crop-note")!.textContent).toBe(t("canvas.crop.ink"));
  });

  it("↺ e ↻ girano la zona di un quarto, la dicono e la disegnano ruotata", () => {
    const picture = document.createElement("canvas");
    picture.width = 400;
    picture.height = 300;
    const made = open(undefined, {}, picture);
    expect(made.measured).toHaveBeenCalledTimes(1);
    expect(made.editor.natural()).toEqual({ width: 400, height: 300 });
    const drawn = made.overlay().querySelector<HTMLCanvasElement>(".canvas-crop-picture")!;
    expect([drawn.width, drawn.height]).toEqual([400, 300]);
    expect(rotations).toEqual([]);
    made.button("rotate-right").click();
    expect(made.editor.zone().turn).toBe(90);
    expect(made.turned).toHaveBeenLastCalledWith({ rect: [0.45, 0.1, 0.5, 0.8], turn: 90 });
    expect([drawn.width, drawn.height]).toEqual([300, 400]);
    expect(rotations).toEqual([Math.PI / 2]);
    made.button("rotate-left").click();
    made.button("rotate-left").click();
    expect(made.editor.zone().turn).toBe(270);
    // La zona nell'immagine dritta non cambia.
    expect(made.editor.zone().rect).toEqual([0.45, 0.1, 0.5, 0.8]);
    expect(made.done).not.toHaveBeenCalled();
  });

  it("Invio e «Fatto» danno la zona, Esc lascia com'era, «Togli il ritaglio» lo dice", () => {
    const made = open();
    made.button("rotate-right").click();
    const enter = press(made.box(), "Enter");
    expect(enter.defaultPrevented).toBe(true);
    expect(made.done).toHaveBeenLastCalledWith({ rect: [0.45, 0.1, 0.5, 0.8], turn: 90 });
    made.button("done").click();
    expect(made.done).toHaveBeenCalledTimes(2);
    press(made.box(), "Escape");
    expect(made.cancel).toHaveBeenCalledTimes(1);
    made.button("remove").click();
    expect(made.remove).toHaveBeenCalledTimes(1);
    // Invio su un pulsante della barra è il suo clic, non «Fatto».
    expect(made.editor.key(new KeyboardEvent("keydown", { key: "Enter" }))).toBe(true);
    const onButton = press(made.button("rotate-left"), "Enter");
    expect(onButton.defaultPrevented).toBe(false);
  });

  it("le frecce spostano la zona, con Alt ne allargano l'angolo in basso a destra, su una maniglia muovono lei", () => {
    const made = open({ rect: [0.2, 0.2, 0.5, 0.5], turn: 0 });
    press(made.box(), "ArrowRight");
    close(made.editor.zone().rect, [0.21, 0.2, 0.5, 0.5]);
    press(made.box(), "ArrowDown", { shiftKey: true });
    close(made.editor.zone().rect, [0.21, 0.3, 0.5, 0.5]);
    press(made.box(), "ArrowLeft", { altKey: true });
    close(made.editor.zone().rect, [0.21, 0.3, 0.49, 0.5]);
    made.handle("nw").focus();
    press(made.handle("nw"), "ArrowUp");
    close(made.editor.zone().rect, [0.21, 0.29, 0.49, 0.51]);
    // Fermo al bordo.
    for (let i = 0; i < 10; i += 1) press(made.box(), "ArrowRight", { shiftKey: true });
    close(made.editor.zone().rect, [0.51, 0.29, 0.49, 0.51]);
  });

  it("trascinando una maniglia l'angolo segue il puntatore, anche con la lavagna in scala", () => {
    const picture = document.createElement("canvas");
    picture.width = 400;
    picture.height = 300;
    const made = open({ rect: [0.25, 0.25, 0.5, 0.5], turn: 0 }, {}, picture);
    // Il ritaglio è 400 × 300 px, allo zoom 0,5: 200 × 150 sullo schermo.
    size(made, 400, 300, 0.5);
    expect(made.box().style.left).toBe("100px");
    expect(made.box().style.width).toBe("200px");
    const handle = made.handle("se");
    const pointer = (type: string, x: number, y: number): PointerEvent => {
      const event = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7, button: 0 });
      return event;
    };
    const seen = vi.fn();
    made.card.addEventListener("pointerdown", seen);
    handle.dispatchEvent(pointer("pointerdown", 100 + 150, 50 + 112.5));
    // La lavagna non vede il gesto: non sposta la scheda.
    expect(seen).not.toHaveBeenCalled();
    made.overlay().dispatchEvent(pointer("pointermove", 100 + 180, 50 + 135));
    close(made.editor.zone().rect, [0.25, 0.25, 0.65, 0.65]);
    made.overlay().dispatchEvent(pointer("pointerup", 100 + 180, 50 + 135));
    made.overlay().dispatchEvent(pointer("pointermove", 100 + 10, 50 + 10));
    close(made.editor.zone().rect, [0.25, 0.25, 0.65, 0.65]);
    // La zona presa nel mezzo si sposta tutta, fino al bordo.
    made.box().dispatchEvent(pointer("pointerdown", 150, 100));
    made.overlay().dispatchEvent(pointer("pointermove", 150 - 100, 100));
    close(made.editor.zone().rect, [0, 0.25, 0.65, 0.65]);
  });

  it("con l'immagine ruotata la zona sta dove si vede e si lascia nell'immagine dritta", () => {
    const picture = document.createElement("canvas");
    picture.width = 400;
    picture.height = 200;
    const made = open({ rect: [0, 0, 0.5, 1], turn: 90 }, {}, picture);
    // Ruotata è 200 × 400: in un ritaglio 400 × 400 sta al centro, larga 200.
    size(made, 400, 400);
    const drawn = made.overlay().querySelector<HTMLCanvasElement>(".canvas-crop-picture")!;
    expect([drawn.style.left, drawn.style.width, drawn.style.height]).toEqual(["100px", "200px", "400px"]);
    // La metà sinistra dell'immagine dritta è la metà di sopra di quella ruotata.
    expect([made.box().style.left, made.box().style.top, made.box().style.width, made.box().style.height]).toEqual(["100px", "0px", "200px", "200px"]);
  });

  it("l'immagine che arriva dopo si misura e si disegna", () => {
    let picture: HTMLCanvasElement | null = null;
    const made = open(undefined, { picture: () => picture });
    expect(made.measured).not.toHaveBeenCalled();
    expect(made.overlay().querySelector<HTMLCanvasElement>(".canvas-crop-picture")!.hidden).toBe(true);
    picture = document.createElement("canvas");
    picture.width = 10;
    picture.height = 20;
    made.editor.layout();
    expect(made.measured).toHaveBeenCalledTimes(1);
    expect(made.overlay().querySelector<HTMLCanvasElement>(".canvas-crop-picture")!.hidden).toBe(false);
    expect(draws).toHaveLength(1);
    made.editor.layout();
    expect(made.measured).toHaveBeenCalledTimes(1);
  });

  it("chiusa la vita di chi lo apre, il ritaglio sparisce", () => {
    const made = open();
    made.life.close();
    expect(made.editor.closed).toBe(true);
    expect(document.querySelector(".canvas-crop, .canvas-crop-foot, .canvas-crop-bar")).toBeNull();
    expect(made.editor.key(new KeyboardEvent("keydown", { key: "Escape" }))).toBe(false);
  });
});
