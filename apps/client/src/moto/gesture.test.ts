// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { drag, type DragInfo, type DragOptions } from "./gesture";

let el: HTMLElement;
let life: Lifetime;
let captured: Set<number>;
let log: string[];

/// Un evento del puntatore con l'istante che la prova decide.
function pointer(type: string, x: number, y: number, time: number, init: PointerEventInit = {}): PointerEvent {
  const event = new PointerEvent(type, {
    pointerId: 1,
    isPrimary: true,
    button: 0,
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  Object.defineProperty(event, "timeStamp", { value: time });
  return event;
}

function send(type: string, x: number, y: number, time: number, init?: PointerEventInit): PointerEvent {
  const event = pointer(type, x, y, time, init);
  // Si preme sull'elemento; il resto arriva dove capita, cioè al documento.
  (type === "pointerdown" ? el : document).dispatchEvent(event);
  return event;
}

function escape(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event;
}

function listen(extra: Partial<DragOptions> = {}): { infos: DragInfo[] } {
  const infos: DragInfo[] = [];
  const record = (name: string) => (info: DragInfo) => {
    log.push(name);
    infos.push(info);
  };
  drag(el, {
    onStart: record("start"),
    onMove: record("move"),
    onEnd: record("end"),
    onCancel: () => log.push("cancel"),
    lifetime: life,
    ...extra,
  });
  return { infos };
}

beforeEach(() => {
  el = document.createElement("div");
  document.body.append(el);
  life = openLifetime();
  log = [];
  // La cattura di happy-dom non interessa: basta sapere che cosa le si chiede.
  captured = new Set();
  el.setPointerCapture = (id) => void captured.add(id);
  el.hasPointerCapture = (id) => captured.has(id);
  el.releasePointerCapture = (id) => void captured.delete(id);
});

afterEach(() => {
  life.close();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("drag", () => {
  it("sotto la soglia il gesto non esiste: un clic resta un clic", () => {
    listen();
    const down = send("pointerdown", 10, 10, 0);
    send("pointermove", 12, 12, 10);
    send("pointermove", 13, 11, 20);
    const up = send("pointerup", 13, 11, 30);
    expect(log).toEqual([]);
    expect(captured.size).toBe(0);
    expect(down.defaultPrevented).toBe(false);
    expect(up.defaultPrevented).toBe(false);
  });

  it("oltre la soglia comincia, cattura il puntatore, segue e finisce al rilascio", () => {
    const { infos } = listen();
    send("pointerdown", 10, 10, 0);
    send("pointermove", 12, 10, 10);
    expect(log).toEqual([]);

    const move = send("pointermove", 13, 14, 20);
    expect(log).toEqual(["start", "move"]);
    expect(captured.has(1)).toBe(true);
    expect(infos[0]).toBe(infos[1]);
    expect(infos[0]).toMatchObject({ x: 13, y: 14, dx: 3, dy: 4, event: move });

    send("pointermove", 40, 0, 30);
    expect(log).toEqual(["start", "move", "move"]);
    expect(infos[2]).toMatchObject({ x: 40, y: 0, dx: 30, dy: -10 });

    send("pointerup", 42, 0, 40);
    expect(log).toEqual(["start", "move", "move", "end"]);
    expect(infos[3]).toMatchObject({ x: 42, y: 0, dx: 32, dy: -10 });
    expect(captured.size).toBe(0);

    // Finito: il documento non ascolta più niente per lui.
    send("pointermove", 90, 90, 50);
    send("pointerup", 90, 90, 60);
    expect(log).toHaveLength(4);
  });

  it("la soglia si sceglie", () => {
    listen({ threshold: 20 });
    send("pointerdown", 0, 0, 0);
    send("pointermove", 19, 0, 10);
    expect(log).toEqual([]);
    send("pointermove", 20, 0, 20);
    expect(log).toEqual(["start", "move"]);
  });

  it("stima la velocità in px al millisecondo sugli ultimi campioni", () => {
    const { infos } = listen();
    send("pointerdown", 0, 0, 0);
    send("pointermove", 10, 5, 16);
    send("pointermove", 20, 10, 32);
    send("pointermove", 30, 15, 48);
    expect(infos[infos.length - 1].velocity.x).toBeCloseTo(30 / 48, 9);
    expect(infos[infos.length - 1].velocity.y).toBeCloseTo(15 / 48, 9);

    // Ciò che è più vecchio della finestra non conta: resta l'ultima andatura.
    send("pointermove", 100, 15, 200);
    send("pointermove", 120, 15, 220);
    send("pointermove", 140, 15, 240);
    expect(infos[infos.length - 1].velocity).toEqual({ x: 1, y: 0 });

    send("pointerup", 160, 15, 260);
    expect(infos[infos.length - 1].velocity.x).toBeCloseTo(1, 9);
    expect(log[log.length - 1]).toBe("end");
  });

  it("un puntatore tenuto fermo prima del rilascio non ha velocità", () => {
    const { infos } = listen();
    send("pointerdown", 0, 0, 0);
    send("pointermove", 50, 0, 16);
    send("pointermove", 100, 0, 32);
    send("pointerup", 100, 0, 400);
    expect(log[log.length - 1]).toBe("end");
    expect(infos[infos.length - 1].velocity).toEqual({ x: 0, y: 0 });
  });

  it("Esc annulla il gesto cominciato e non arriva a nessun altro", () => {
    listen();
    const beyond = vi.fn();
    document.body.addEventListener("keydown", beyond);
    send("pointerdown", 0, 0, 0);
    send("pointermove", 30, 0, 16);

    const key = escape();
    expect(log).toEqual(["start", "move", "cancel"]);
    expect(key.defaultPrevented).toBe(true);
    expect(beyond).not.toHaveBeenCalled();
    expect(captured.size).toBe(0);

    // Annullato: né il seguito né il rilascio contano più.
    send("pointermove", 60, 0, 32);
    send("pointerup", 60, 0, 48);
    expect(log).toHaveLength(3);
    // E un Esc senza gesto è di chi lo vuole.
    expect(escape().defaultPrevented).toBe(false);
    expect(beyond).toHaveBeenCalledTimes(1);
    document.body.removeEventListener("keydown", beyond);
  });

  it("Esc prima della soglia scioglie il gesto senza consumare il tasto", () => {
    listen();
    send("pointerdown", 0, 0, 0);
    send("pointermove", 2, 0, 16);
    expect(escape().defaultPrevented).toBe(false);
    send("pointermove", 80, 0, 32);
    send("pointerup", 80, 0, 48);
    expect(log).toEqual([]);
  });

  it("un altro tasto non tocca il gesto", () => {
    listen();
    send("pointerdown", 0, 0, 0);
    send("pointermove", 30, 0, 16);
    const key = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    el.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(false);
    send("pointerup", 30, 0, 32);
    expect(log).toEqual(["start", "move", "end"]);
  });

  it("il sistema che si riprende il puntatore, o la finestra che perde il fuoco, annullano", () => {
    listen();
    send("pointerdown", 0, 0, 0);
    send("pointermove", 30, 0, 16);
    send("pointercancel", 30, 0, 32);
    expect(log).toEqual(["start", "move", "cancel"]);

    send("pointerdown", 0, 0, 100);
    send("pointermove", 30, 0, 116);
    window.dispatchEvent(new Event("blur"));
    expect(log).toEqual(["start", "move", "cancel", "start", "move", "cancel"]);
    send("pointerup", 30, 0, 132);
    expect(log).toHaveLength(6);
  });

  it("segue solo il puntatore principale premuto col tasto sinistro", () => {
    listen();
    send("pointerdown", 0, 0, 0, { button: 2 });
    send("pointermove", 30, 0, 16);
    send("pointerdown", 0, 0, 20, { isPrimary: false, pointerId: 7 });
    send("pointermove", 30, 0, 36, { pointerId: 7 });
    expect(log).toEqual([]);

    send("pointerdown", 0, 0, 100);
    send("pointermove", 30, 0, 116, { pointerId: 7 });
    send("pointerup", 30, 0, 120, { pointerId: 7 });
    send("pointercancel", 30, 0, 124, { pointerId: 7 });
    expect(log).toEqual([]);
    send("pointermove", 30, 0, 132);
    send("pointerup", 30, 0, 148);
    expect(log).toEqual(["start", "move", "end"]);
  });

  it("un rilascio mai arrivato non rende sordo l'elemento", () => {
    listen();
    send("pointerdown", 0, 0, 0);
    send("pointermove", 30, 0, 16);
    // Il rilascio si è perso (fuori dalla finestra): si preme di nuovo.
    send("pointerdown", 100, 100, 500);
    expect(log).toEqual(["start", "move", "cancel"]);
    const { length } = log;
    send("pointermove", 110, 100, 516);
    send("pointerup", 110, 100, 532);
    expect(log.slice(length)).toEqual(["start", "move", "end"]);
  });

  it("chiusa la vita annulla il gesto in corso e l'elemento non è più trascinabile", () => {
    const added = vi.spyOn(document, "addEventListener");
    const removed = vi.spyOn(document, "removeEventListener");
    listen();
    send("pointerdown", 0, 0, 0);
    send("pointermove", 30, 0, 16);
    expect(added.mock.calls.length).toBeGreaterThan(0);

    life.close();
    expect(log).toEqual(["start", "move", "cancel"]);
    expect(captured.size).toBe(0);
    expect(removed.mock.calls.length).toBe(added.mock.calls.length);

    send("pointermove", 60, 0, 32);
    send("pointerup", 60, 0, 48);
    send("pointerdown", 0, 0, 100);
    send("pointermove", 30, 0, 116);
    expect(log).toHaveLength(3);
    expect(added.mock.calls.length).toBe(removed.mock.calls.length);
  });

  it("senza gesto in corso chiudere la vita non annulla niente", () => {
    listen();
    send("pointerdown", 0, 0, 0);
    send("pointermove", 30, 0, 16);
    send("pointerup", 30, 0, 32);
    life.close();
    expect(log).toEqual(["start", "move", "end"]);
  });

  it("una cattura rifiutata non ferma il gesto", () => {
    el.setPointerCapture = () => {
      throw new DOMException("puntatore non attivo", "NotFoundError");
    };
    listen();
    send("pointerdown", 0, 0, 0);
    send("pointermove", 30, 0, 16);
    send("pointerup", 30, 0, 32);
    expect(log).toEqual(["start", "move", "end"]);
  });
});
