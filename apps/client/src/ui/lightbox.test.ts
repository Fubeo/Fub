// @vitest-environment happy-dom
// La lightbox: una sola aperta, modale vera (fuoco dentro, Escape chiude, il
// fuoco torna), e il contenuto con una vita sua — revocato alla chiusura, mai
// montato se la chiusura arriva prima di lui.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeLightbox, openLightbox, svgSource } from "./lightbox";
import type { Lifetime } from "./lifetime";
import { setReducedMotionPreference } from "../theme/reduced-motion";

beforeEach(() => {
  setReducedMotionPreference(true);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:diagramma");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  closeLightbox();
  document.body.replaceChildren();
  setReducedMotionPreference(false);
  vi.restoreAllMocks();
});

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function escape(): void {
  document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
}

describe("la lightbox", () => {
  it("è una modale col suo nome, e mostra il contenuto nella vista che ingrandisce", async () => {
    const box = openLightbox({ source: () => "blob:foto", label: "Il porto al tramonto", caption: "foto/porto.jpg", backdrop: "checker" });
    expect(box.element.getAttribute("role")).toBe("dialog");
    expect(box.element.getAttribute("aria-modal")).toBe("true");
    expect(box.element.getAttribute("aria-label")).toBe("Il porto al tramonto");
    expect(box.element.querySelector(".lightbox-caption")!.textContent).toBe("foto/porto.jpg");
    await settle();
    const image = box.element.querySelector<HTMLImageElement>(".zoom-content")!;
    expect(image.getAttribute("src")).toBe("blob:foto");
    expect(image.alt).toBe("Il porto al tramonto");
    expect(document.activeElement).toBe(box.element.querySelector(".zoom-stage"));
  });

  it("ne resta aperta una sola", async () => {
    const first = openLightbox({ source: () => "blob:uno", label: "uno" });
    const second = openLightbox({ source: () => "blob:due", label: "due" });
    await settle();
    expect(first.element.isConnected).toBe(false);
    expect(second.element.isConnected).toBe(true);
    expect(document.querySelectorAll(".lightbox")).toHaveLength(1);
  });

  it("Escape chiude, il fuoco torna, e il blob del diagramma si revoca", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const box = openLightbox({ source: svgSource("<svg/>"), label: "Flusso", background: "rgb(250, 250, 250)" });
    await settle();
    const image = box.element.querySelector<HTMLImageElement>(".zoom-content")!;
    expect(image.getAttribute("src")).toBe("blob:diagramma");
    expect(image.style.backgroundColor).toBe("rgb(250, 250, 250)");
    escape();
    expect(box.element.isConnected).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:diagramma");
  });

  it("il bottone di chiusura e un clic sul fondo chiudono; un trascinamento no", async () => {
    const box = openLightbox({ source: () => "blob:foto", label: "foto" });
    expect(box.element.querySelector(".lightbox-close")!.getAttribute("aria-label")).toBe("Chiudi (Esc)");
    await settle();
    const stage = box.element.querySelector<HTMLElement>(".zoom-stage")!;
    stage.dispatchEvent(new PointerEvent("pointerdown", { clientX: 10, clientY: 10, bubbles: true }));
    stage.dispatchEvent(new PointerEvent("pointerup", { clientX: 80, clientY: 10, bubbles: true }));
    expect(box.element.isConnected).toBe(true);
    stage.dispatchEvent(new PointerEvent("pointerdown", { clientX: 10, clientY: 10, bubbles: true }));
    stage.dispatchEvent(new PointerEvent("pointerup", { clientX: 11, clientY: 10, bubbles: true }));
    expect(box.element.isConnected).toBe(false);

    const again = openLightbox({ source: () => "blob:foto", label: "foto" });
    again.element.querySelector<HTMLButtonElement>(".lightbox-close")!.click();
    expect(again.element.isConnected).toBe(false);
  });

  it("un contenuto che non c'è più lo dice", async () => {
    const box = openLightbox({ source: async () => null, label: "sparita.png" });
    await settle();
    const alert = box.element.querySelector("[role=alert]");
    expect(alert?.textContent).toContain("sparita.png");
    const failing = openLightbox({ source: async () => { throw new Error("lease negato"); }, label: "negata.png" });
    await settle();
    expect(failing.element.querySelector("[role=alert]")?.textContent).toContain("negata.png");
  });

  it("chiusa prima che il contenuto arrivi, non monta niente e rilascia ciò che ha preso", async () => {
    let release: (url: string) => void = () => {};
    const released: string[] = [];
    const box = openLightbox({
      label: "lenta",
      source: (life: Lifetime) => new Promise<string>((resolve) => {
        life.add(() => released.push("lease"));
        release = resolve;
      }),
    });
    await settle();
    box.close();
    release("blob:tardi");
    await settle();
    expect(box.element.querySelector(".zoom-view")).toBeNull();
    expect(released).toEqual(["lease"]);
  });
});
