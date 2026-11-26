// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../../../ui/lifetime";
import { DRAW_SCALE_LIMITS, ZOOM_STEP } from "../constants";
import type { EditorContext } from "../context";
import { adattaTavola, COMANDI_VISTA, creaMenuZoom, impostaZoom, isComandoVista } from "./zoom-menu";

/// Un editor finto con la camera e il fuoco del foglio: `zoomBy` fa lo stesso
/// limite del client (`DRAW_SCALE_LIMITS`), così il campo vede ciò che vedrebbe.
function fingi() {
  const root = document.createElement("div");
  document.body.append(root);
  const life = openLifetime();
  const camera = { scale: 1, angle: 0, tx: 0, ty: 0 };
  const ascoltatori = new Set<() => void>();
  const ctx = {
    disposed: false,
    root,
    life,
    camera,
    zoomBy: vi.fn((factor: number) => {
      camera.scale = Math.min(DRAW_SCALE_LIMITS.max, Math.max(DRAW_SCALE_LIMITS.min, camera.scale * factor));
    }),
    fit: vi.fn(),
    boardsNow: () => [],
    currentBoard: () => null,
    visitBoard: vi.fn(() => false),
    status: {
      items: () => [],
      subscribe: (listener: () => void) => {
        ascoltatori.add(listener);
        return () => ascoltatori.delete(listener);
      },
    },
  } as unknown as EditorContext;
  const bottone = document.createElement("button");
  bottone.dataset.surfaceItem = "zoom";
  root.append(bottone);
  const menu = creaMenuZoom(ctx, () => bottone);
  return { ctx, camera, life, bottone, menu, root, cambia: () => [...ascoltatori].forEach((a) => a()) };
}

function voce(id: string): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`.draw-zoom-popover [data-command="${id}"]`)!;
}

function campo(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(".draw-zoom-popover .kit-number-field input, .draw-zoom-popover input")!;
}

describe("il menu dello zoom della banda", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("apre con le cinque voci e il campo, e il fuoco entra nella prima voce", () => {
    const { menu, bottone } = fingi();
    bottone.focus();
    menu.apri();
    const voci = [...document.querySelectorAll<HTMLButtonElement>(".draw-zoom-popover [role='menuitem']")];
    expect(voci.map((v) => v.dataset.command)).toEqual(["view.zoomIn", "view.zoomOut", "view.actualSize", "view.fitArtboard", "view.fitAll"]);
    expect(campo().value).toBe("100");
    expect(document.activeElement).toBe(voci[0]);
    expect(bottone.getAttribute("aria-expanded")).toBe("true");
  });

  it("le voci fanno lo zoom e il menu si chiude", () => {
    const { menu, camera, ctx } = fingi();
    menu.apri();
    voce("view.zoomIn").click();
    expect(camera.scale).toBeCloseTo(ZOOM_STEP);
    expect(document.querySelector(".draw-zoom-popover")).toBeNull();
    menu.apri();
    voce("view.zoomOut").click();
    expect(camera.scale).toBeCloseTo(1);
    menu.apri();
    voce("view.actualSize").click();
    expect(camera.scale).toBeCloseTo(1);
    menu.apri();
    voce("view.fitAll").click();
    expect(ctx.fit).toHaveBeenCalledTimes(1);
  });

  it("il campo imposta lo zoom in percento e rifiuta un valore fuori dai limiti, senza cambiarlo", () => {
    const { menu, camera } = fingi();
    menu.apri();
    campo().value = "250";
    campo().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(camera.scale).toBeCloseTo(2.5);

    campo().value = "5";
    campo().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(camera.scale).toBeCloseTo(2.5);
    const errore = document.querySelector(".kit-number-error")!;
    expect(errore.textContent).toContain("non è cambiato");
    expect(campo().getAttribute("aria-invalid")).toBe("true");
  });

  it("impostaZoom dice i limiti della vista e non tocca lo zoom fuori", () => {
    const { ctx, camera } = fingi();
    expect(impostaZoom(ctx, 9)).toContain("10");
    expect(impostaZoom(ctx, 3201)).toContain("3200");
    expect(impostaZoom(ctx, 0)).toBeTypeOf("string");
    expect(camera.scale).toBe(1);
    expect(impostaZoom(ctx, 10)).toBeUndefined();
    expect(camera.scale).toBeCloseTo(0.1);
  });

  it("le frecce spostano il fuoco fra le voci, Home e Fine vanno alla prima e all'ultima", () => {
    const { menu } = fingi();
    menu.apri();
    const primo = voce("view.zoomIn");
    primo.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(voce("view.zoomOut"));
    voce("view.zoomOut").dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement).toBe(voce("view.fitAll"));
    voce("view.fitAll").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(primo);
    primo.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(document.activeElement).toBe(primo);
  });

  it("la voce della banda è un interruttore: a menu aperto lo chiude", () => {
    const { menu, bottone } = fingi();
    menu.apri();
    expect(document.querySelector(".draw-zoom-popover")).not.toBeNull();
    menu.apri();
    expect(document.querySelector(".draw-zoom-popover")).toBeNull();
    expect(bottone.getAttribute("aria-expanded")).toBe("false");
  });

  it("Esc chiude il menu e riporta il fuoco alla voce della banda", () => {
    const { menu, bottone } = fingi();
    bottone.focus();
    menu.apri();
    voce("view.zoomIn").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".draw-zoom-popover")).toBeNull();
    expect(document.activeElement).toBe(bottone);
    expect(bottone.getAttribute("aria-expanded")).toBe("false");
  });

  it("chiudere il disegno chiude il menu", () => {
    const { menu, life } = fingi();
    menu.apri();
    life.close();
    expect(document.querySelector(".draw-zoom-popover")).toBeNull();
  });

  it("il campo segue lo zoom mentre il menu è aperto", () => {
    const { menu, camera, cambia } = fingi();
    menu.apri();
    camera.scale = 2;
    cambia();
    expect(campo().value).toBe("200");
  });

  it("comando(view.setZoom) apre il menu col fuoco nel campo; gli altri comandi non lo aprono", () => {
    const { menu, camera } = fingi();
    menu.comando("view.zoomIn");
    expect(camera.scale).toBeCloseTo(ZOOM_STEP);
    expect(document.querySelectorAll(".draw-zoom-popover")).toHaveLength(0);
    menu.comando("view.setZoom");
    expect(document.querySelectorAll(".draw-zoom-popover")).toHaveLength(1);
    expect(document.activeElement).toBe(campo());
    // Con il menu già aperto, un altro comando non ne apre un secondo.
    menu.comando("view.setZoom");
    expect(document.querySelectorAll(".draw-zoom-popover")).toHaveLength(1);
  });

  it("ogni comando della vista è il suo id della mappa, e nessun altro lo è", () => {
    expect(COMANDI_VISTA).toEqual(["view.zoomIn", "view.zoomOut", "view.actualSize", "view.fitArtboard", "view.fitAll", "view.setZoom"]);
    expect(isComandoVista("view.fitAll")).toBe(true);
    expect(isComandoVista("tool.select")).toBe(false);
  });
});

describe("Adatta tavola alla finestra (view.fitArtboard)", () => {
  const tavola = (id: string) => ({ id, name: id, rect: [0, 0, 10, 10] });

  it("inquadra la tavola di adesso, nel suo posto fra le tavole", () => {
    const visitBoard = vi.fn(() => true);
    const fit = vi.fn();
    const ctx = { boardsNow: () => [tavola("a"), tavola("b")], currentBoard: () => tavola("b"), visitBoard, fit } as unknown as EditorContext;
    adattaTavola(ctx);
    expect(visitBoard).toHaveBeenCalledWith(1, true);
    expect(fit).not.toHaveBeenCalled();
  });

  it("senza tavole, o se la tavola non si raggiunge, inquadra tutto", () => {
    const fit = vi.fn();
    adattaTavola({ boardsNow: () => [], currentBoard: () => null, visitBoard: vi.fn(), fit } as unknown as EditorContext);
    expect(fit).toHaveBeenCalledTimes(1);
    const visitBoard = vi.fn(() => false);
    adattaTavola({ boardsNow: () => [tavola("a")], currentBoard: () => tavola("a"), visitBoard, fit } as unknown as EditorContext);
    expect(visitBoard).toHaveBeenCalledWith(0, true);
    expect(fit).toHaveBeenCalledTimes(2);
  });

  it("la voce del menu la fa", () => {
    const { menu, ctx } = fingi();
    menu.apri();
    voce("view.fitArtboard").click();
    expect(ctx.fit).toHaveBeenCalledTimes(1);
  });
});
