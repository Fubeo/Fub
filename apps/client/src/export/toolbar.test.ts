// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { createToolbar } from "./toolbar";

function actions() {
  return { back: vi.fn(), zoom: vi.fn(), view: vi.fn(), profile: vi.fn(), print: vi.fn(), exportPdf: vi.fn() };
}

describe("la barra dello spazio", () => {
  it("ogni controllo ha un nome", () => {
    const toolbar = createToolbar("Relazione", actions());
    toolbar.setProfile("Di serie", false);
    for (const control of toolbar.element.querySelectorAll("button")) {
      const name = control.getAttribute("aria-label") ?? control.textContent ?? "";
      expect(name.trim(), control.className).not.toBe("");
    }
    expect(toolbar.element.querySelector(".export-title-note")?.textContent).toBe("Relazione");
    expect(toolbar.element.querySelector(".export-profile")?.getAttribute("aria-label")).toBe("Profilo di esportazione: Di serie");
  });

  it("le viste dicono quale è premuta e passano il gesto", () => {
    const handlers = actions();
    const toolbar = createToolbar("Nota", handlers);
    const views = [...toolbar.element.querySelectorAll<HTMLButtonElement>(".export-segment")];
    expect(views.map((view) => view.textContent)).toEqual(["Una", "Due", "Tutte"]);
    expect(views.map((view) => view.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
    views[2]!.click();
    expect(handlers.view).toHaveBeenCalledWith("tutte");
    toolbar.setView("tutte");
    expect(views.map((view) => view.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);
    toolbar.setView("libera");
    expect(views.every((view) => view.getAttribute("aria-pressed") === "false")).toBe(true);
  });

  it("zoom, indietro, stampa ed esporta arrivano a chi monta", () => {
    const handlers = actions();
    const toolbar = createToolbar("Nota", handlers);
    const [out, inn] = toolbar.element.querySelectorAll<HTMLButtonElement>(".export-zoom-button");
    out!.click();
    inn!.click();
    expect(handlers.zoom.mock.calls).toEqual([[-1], [1]]);
    toolbar.setZoom(0.734);
    expect(toolbar.element.querySelector(".export-zoom-value")?.textContent).toBe("73%");
    toolbar.element.querySelector<HTMLButtonElement>(".export-back")!.click();
    toolbar.element.querySelector<HTMLButtonElement>(".export-print")!.click();
    toolbar.element.querySelector<HTMLButtonElement>(".export-go")!.click();
    expect(handlers.back).toHaveBeenCalledOnce();
    expect(handlers.print).toHaveBeenCalledOnce();
    expect(handlers.exportPdf).toHaveBeenCalledOnce();
  });
});
