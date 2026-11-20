// @vitest-environment happy-dom
// La stampa aspetta la resa completa — diagrammi, formule, immagini — ma non
// per sempre, e smonta ciò che ha montato quando la stampa finisce.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderedDocument } from "../../host/contract";
import { copyRenderedText, mountPrintSurface, printRendered, settlePrint } from "./print-view";
import { writeClipboardText } from "../../platform/clipboard";
import { errorText } from "../../host/errors";
import { t } from "../../i18n/strings";

vi.mock("../../platform/clipboard", async (original) => ({
  ...(await original<typeof import("../../platform/clipboard")>()),
  writeClipboardText: vi.fn(async () => {}),
}));

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

describe("copiare il testo reso", () => {
  // Gli appunti che dicono di no arrivano con la prosa inglese del motore
  // («NotAllowedError…»): la riga dice che cosa non è riuscito e la specie,
  // nella lingua di chi legge.
  it("un rifiuto degli appunti dice che cosa non è riuscito, senza la prosa del motore", async () => {
    const refused = new DOMException("Write permission denied.", "NotAllowedError");
    vi.mocked(writeClipboardText).mockRejectedValue(refused);
    const said = await copyRenderedText("ciao").then(() => "", (error: Error) => error.message);
    expect(said).toBe(t("errors.print.copy_failed", { reason: errorText(refused, "specie") }));
    expect(said).not.toContain("cannot copy");
    expect(said).not.toContain("permission denied");
  });
});

describe("la resa per la stampa da misurare", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("ciò che non arriva entro l'attesa diventa un riquadro col nome e «non disegnato»", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const mount = vi.fn((body: HTMLElement) => {
      body.innerHTML = [
        '<p data-md-from="0">Testo</p>',
        '<div class="mermaid-diagram" data-state="loading" data-md-from="10"><span>…</span></div>',
        '<div class="math-block" data-state="loading"></div>',
        '<figure data-vault-media="pending" data-vault-id="allegati/grafico%20vendite.png"><img alt=""></figure>',
        '<img alt="Il porto" src="porto.jpg">',
        '<img alt="Arrivata" src="ok.png">',
      ].join("");
      const [broken, fine] = body.querySelectorAll<HTMLImageElement>(":scope > img");
      Object.defineProperty(broken, "complete", { configurable: true, value: true });
      Object.defineProperty(broken, "naturalWidth", { configurable: true, value: 0 });
      Object.defineProperty(fine, "complete", { configurable: true, value: true });
      Object.defineProperty(fine, "naturalWidth", { configurable: true, value: 40 });
      for (const image of body.querySelectorAll("img")) Object.defineProperty(image, "decode", { configurable: true, value: async () => {} });
      return { ready: Promise.resolve(), dispose: vi.fn() };
    });
    const surface = mountPrintSurface(container, { title: "Nota", rendered: { html: "", parts: [] }, mount, limit: 20 });
    expect(container.querySelector(".print-page h1")?.textContent).toBe("Nota");
    expect(await surface.settled).toBe(4);
    const boxes = [...surface.body.querySelectorAll<HTMLElement>(".print-undrawn")];
    expect(boxes.map((box) => box.querySelector(".print-undrawn-name")?.textContent)).toEqual([
      t("print.undrawn.diagram"),
      t("print.undrawn.formula"),
      "grafico vendite.png",
      "Il porto",
    ]);
    for (const box of boxes) {
      expect(box.querySelector(".print-undrawn-state")?.textContent).toBe(t("print.undrawn"));
      expect(box.getAttribute("role")).toBe("img");
    }
    expect(boxes[0].getAttribute("aria-label")).toBe(t("print.undrawn.label", { name: t("print.undrawn.diagram") }));
    // Il riquadro tiene il posto del blocco nel sorgente: l'indice e il clic
    // sulla pagina lo ritrovano.
    expect(boxes[0].dataset.mdFrom).toBe("10");
    expect(surface.body.querySelector("[data-state='loading'], [data-vault-media='pending']")).toBeNull();
    expect(surface.body.querySelector("img[alt='Arrivata']")).not.toBeNull();
    surface.dispose();
    expect(container.children).toHaveLength(0);
    expect(mount.mock.results[0]!.value.dispose).toHaveBeenCalledOnce();
  });

  it("senza chi idrata monta l'HTML sanificato; un montaggio che fallisce non lascia niente", async () => {
    const container = document.createElement("div");
    const surface = mountPrintSurface(container, { title: "Nota", rendered: { html: "<p>uno</p><script>x()</script>", parts: [] } });
    expect(await surface.settled).toBe(0);
    expect(surface.body.innerHTML).toBe("<p>uno</p>");
    surface.dispose();
    expect(() => mountPrintSurface(container, { title: "Nota", rendered: { html: "", parts: [] }, mount: () => { throw new Error("no"); } })).toThrow("no");
    expect(container.children).toHaveLength(0);
  });
});
