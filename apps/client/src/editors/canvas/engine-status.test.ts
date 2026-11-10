// @vitest-environment happy-dom
// La banda di stato della lavagna nel motore (T52): la banda si rilegge a fine
// gesto, non a ogni fotogramma. Una rotella che gira non avvisa finché non si
// ferma; un clic avvisa al suo rilascio; lo zoom del menu e la sola lettura
// avvisano una volta; la cartella apre le Impostazioni.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n/strings";
import { CanvasEngine, type CanvasEngineOptions } from "./engine";
import { canvasCoreReady } from "./wasm/core";

beforeAll(async () => {
  await canvasCoreReady();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

const BOARD = JSON.stringify({
  nodes: [
    { id: "a", type: "text", x: 0, y: 0, width: 200, height: 100, text: "uno" },
    { id: "b", type: "text", x: 400, y: 0, width: 200, height: 100, text: "due" },
  ],
  edges: [],
});

// Una lavagna larga: adattata alla vista, esce sotto il 200%.
const WIDE = JSON.stringify({
  nodes: [
    { id: "a", type: "text", x: 0, y: 0, width: 200, height: 100, text: "uno" },
    { id: "b", type: "text", x: 4000, y: 0, width: 200, height: 100, text: "due" },
  ],
  edges: [],
});

/// Una lavagna montata con la banda: i suoi avvisi si contano in `calls`.
function mounted(extra: Partial<CanvasEngineOptions> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const calls: number[] = [];
  const engine = new CanvasEngine(host, {
    surfaceId: "status",
    formatId: "canvas",
    documentId: "Corsi/Lezioni.canvas",
    onChange: () => {},
    onSelectionChange: () => {},
    onStatusChange: () => calls.push(calls.length + 1),
    ...extra,
  });
  engine.setDoc(BOARD);
  calls.length = 0;
  const viewport = host.querySelector<HTMLElement>(".canvas-viewport")!;
  const card = (id: string) => host.querySelector<HTMLElement>(`.canvas-node[data-node="${id}"]`)!;
  return { engine, host, viewport, calls, card };
}

/// Il testo della voce della banda con questo id.
function item(engine: CanvasEngine, id: string) {
  return engine.statusItems().find((each) => each.id === id);
}

/// Un evento del mouse su `target` (il viewport, o una scheda che risale fino a lui).
function pointer(target: HTMLElement, type: "pointerdown" | "pointermove" | "pointerup", x: number, y: number): void {
  target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "mouse",
    clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1,
  }));
}

/// Una rotella con Ctrl: ingrandisce. `ctrlKey` si mette sull'evento a mano,
/// perché l'evento finto di happy-dom non lo porta.
function wheel(viewport: HTMLElement, deltaY: number): void {
  const event = new WheelEvent("wheel", {
    bubbles: true, cancelable: true, composed: true, deltaY, clientX: 200, clientY: 200,
  });
  Object.defineProperty(event, "ctrlKey", { value: true });
  viewport.dispatchEvent(event);
}

describe("la banda di stato della lavagna (T52)", () => {
  it("una rotella che gira non avvisa finché non si ferma, poi avvisa una volta", () => {
    vi.useFakeTimers();
    const { engine, viewport, calls } = mounted();
    expect(item(engine, "zoom")?.text).toBe("100%");
    wheel(viewport, -100);
    wheel(viewport, -100);
    wheel(viewport, -100);
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(2000);
    expect(calls).toHaveLength(1);
    expect(item(engine, "zoom")?.text).not.toBe("100%");
  });

  it("una panoramica non cambia la banda: nessun avviso, né a metà né alla fine", () => {
    const { viewport, calls } = mounted();
    pointer(viewport, "pointerdown", 600, 500);
    pointer(viewport, "pointermove", 620, 510);
    pointer(viewport, "pointermove", 650, 520);
    pointer(viewport, "pointermove", 700, 530);
    expect(calls).toHaveLength(0);
    pointer(viewport, "pointerup", 700, 530);
    expect(calls).toHaveLength(0);
  });

  it("una scelta avvisa al rilascio del clic, non al suo inizio", () => {
    const { engine, calls, card } = mounted();
    expect(item(engine, "chosen")).toBeUndefined();
    // Il clic parte dalla scheda, come quello vero: il viewport la raggiunge per risalita.
    const target = card("a");
    pointer(target, "pointerdown", 100, 50);
    expect(calls).toHaveLength(0);
    pointer(target, "pointerup", 100, 50);
    expect(calls).toHaveLength(1);
    expect(item(engine, "chosen")?.text).toBe(t("canvas.status.chosen.one"));
  });

  it("la sola lettura avvisa una volta e dice perché", () => {
    const { engine, calls } = mounted();
    engine.setReadOnly(true);
    expect(calls).toHaveLength(1);
    expect(item(engine, "readonly")).toMatchObject({ text: t("canvas.status.readonly"), hint: t("canvas.status.readonly.panel") });
    engine.setReadOnly(false);
    expect(item(engine, "readonly")).toBeUndefined();
  });

  it("un file con una chiave doppia dice in banda che è di sola lettura, e lo toglie quando torna scrivibile", () => {
    const { engine, calls } = mounted();
    engine.syncDoc(BOARD.replace(/}$/, ',"fub:k":1,"fub:k":2}'));
    expect(calls).toHaveLength(1);
    expect(item(engine, "readonly")).toMatchObject({ text: t("canvas.status.readonly"), hint: t("canvas.unwritable") });
    engine.syncDoc(BOARD);
    expect(item(engine, "readonly")).toBeUndefined();
    // La banda ha avvisato anche al ritorno: tornato scrivibile, la vista lo dice.
    expect(calls).toHaveLength(2);
  });

  it("un documento nuovo rilegge lo zoom che la vista ha adesso, non quello di prima", () => {
    const { engine, calls } = mounted();
    item(engine, "zoom")!.open!();
    [...document.querySelectorAll<HTMLButtonElement>("#context-menu button")]
      .find((button) => button.textContent?.includes(t("canvas.zoom.preset", { n: 200 })))!
      .click();
    expect(item(engine, "zoom")?.text).toBe("200%");
    calls.length = 0;
    // Una lavagna larga: il documento nuovo si adatta alla vista, e la banda lo dice.
    engine.setDoc(WIDE);
    expect(calls.length).toBeGreaterThan(0);
    expect(item(engine, "zoom")?.text).not.toBe("200%");
  });

  it("il menu dello zoom cambia lo zoom e avvisa una volta", () => {
    const { engine, calls, host } = mounted();
    item(engine, "zoom")!.open!();
    const at200 = [...document.querySelectorAll<HTMLButtonElement>("#context-menu button")]
      .find((button) => button.textContent?.includes(t("canvas.zoom.preset", { n: 200 })));
    expect(at200).toBeDefined();
    at200!.click();
    expect(calls).toHaveLength(1);
    expect(item(engine, "zoom")?.text).toBe("200%");
    const transform = host.querySelector<HTMLElement>(".canvas-stage")!.style.transform;
    expect(transform).toContain("scale(2)");
  });

  it("la cartella dei file trascinati apre le Impostazioni su canvas.drop_folder (T34)", () => {
    const opened: string[] = [];
    const { engine } = mounted({ onOpenSettings: (key) => opened.push(key) });
    const folder = item(engine, "folder");
    expect(folder?.text).toBe("attachments");
    folder!.open!();
    expect(opened).toEqual(["canvas.drop_folder"]);
  });

  it("senza un modo per aprire le Impostazioni la cartella resta testo", () => {
    const { engine } = mounted();
    expect(item(engine, "folder")?.open).toBeUndefined();
  });

  it("distrutta la lavagna la banda è vuota e non avvisa più", () => {
    vi.useFakeTimers();
    const { engine, viewport, calls } = mounted();
    engine.destroy();
    expect(engine.statusItems()).toEqual([]);
    wheel(viewport, -100);
    vi.advanceTimersByTime(2000);
    expect(calls).toHaveLength(0);
  });
});
