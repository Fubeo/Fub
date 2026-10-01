// @vitest-environment happy-dom
// La stampa aspetta la resa completa — diagrammi, formule, immagini — ma non
// per sempre, e smonta ciò che ha montato quando la stampa finisce.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderedDocument } from "../../host/contract";
import { printRendered, settlePrint } from "./print-view";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("l'attesa prima della stampa", () => {
  it("aspetta embed e media, poi i segnaposti in caricamento, poi decodifica le immagini", async () => {
    const container = document.createElement("div");
    container.innerHTML = '<figure data-state="loading"></figure><img alt="foto" loading="lazy">';
    document.body.append(container);
    const image = container.querySelector("img")!;
    const decode = vi.fn(async () => {});
    Object.defineProperty(image, "decode", { configurable: true, value: decode });
    let arrive!: () => void;
    const ready = new Promise<void>((resolve) => { arrive = resolve; });
    let settled = false;
    const done = settlePrint(container, ready, 5_000).then(() => { settled = true; });

    await tick();
    expect(settled).toBe(false);
    arrive();
    await tick();
    expect(settled).toBe(false);
    expect(decode).not.toHaveBeenCalled();

    container.querySelector<HTMLElement>("figure")!.dataset.state = "ready";
    await done;
    expect(decode).toHaveBeenCalledOnce();
    expect(image.loading).toBe("eager");
    container.remove();
  });

  it("un diagramma che non arriva non ferma la stampa, e un'immagine rotta nemmeno", async () => {
    const container = document.createElement("div");
    container.innerHTML = '<figure data-state="loading"></figure><img alt="rotta">';
    Object.defineProperty(container.querySelector("img")!, "decode", {
      configurable: true,
      value: () => Promise.reject(new Error("EncodingError")),
    });
    const started = Date.now();
    await settlePrint(container, Promise.resolve(), 30);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });
});

describe("la stampa di una resa montata", () => {
  let print: ReturnType<typeof vi.fn>;
  const previous = Object.getOwnPropertyDescriptor(window, "print");

  beforeEach(() => {
    print = vi.fn();
    Object.defineProperty(window, "print", { configurable: true, value: print });
  });
  afterEach(() => {
    if (previous) Object.defineProperty(window, "print", previous);
    else Reflect.deleteProperty(window, "print");
    document.body.replaceChildren();
  });

  it("monta nel corpo, stampa quando è pronta, e su afterprint smonta e avvisa una volta", async () => {
    const dispose = vi.fn();
    let arrive!: () => void;
    const mount = vi.fn((container: HTMLElement, _rendered: RenderedDocument) => {
      container.innerHTML = "<p>Stampata</p>";
      return { ready: new Promise<void>((resolve) => { arrive = resolve; }), dispose };
    });
    const onAfterPrint = vi.fn();
    const printing = printRendered({ title: "Nota", rendered: { html: "<p>x</p>", parts: [] }, mount, onAfterPrint });

    await tick();
    expect(mount).toHaveBeenCalledOnce();
    expect(mount.mock.calls[0]![0].classList.contains("print-body")).toBe(true);
    expect(mount.mock.calls[0]![1]).toEqual({ html: "<p>x</p>", parts: [] });
    expect(print).not.toHaveBeenCalled();

    arrive();
    const teardown = await printing;
    expect(print).toHaveBeenCalledOnce();
    expect(document.querySelector(".print-host .print-page h1")?.textContent).toBe("Nota");
    expect(document.querySelector(".print-host .print-body")?.textContent).toBe("Stampata");

    window.dispatchEvent(new Event("afterprint"));
    expect(document.querySelector(".print-host")).toBeNull();
    expect(dispose).toHaveBeenCalledOnce();
    expect(onAfterPrint).toHaveBeenCalledOnce();
    teardown();
    expect(onAfterPrint).toHaveBeenCalledOnce();
  });

  it("se il montaggio fallisce non stampa e non lascia niente", async () => {
    const mount = vi.fn(() => {
      throw new Error("resa non montabile");
    });
    await expect(printRendered({ title: "Nota", rendered: { html: "", parts: [] }, mount }))
      .rejects.toThrow("resa non montabile");
    expect(print).not.toHaveBeenCalled();
    expect(document.querySelector(".print-host")).toBeNull();
  });
});
