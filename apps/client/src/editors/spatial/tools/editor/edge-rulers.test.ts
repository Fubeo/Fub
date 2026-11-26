// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../../ui/lifetime";
import { rulerTicks } from "../rulers";
import type { EditorContext } from "./context";
import { installEdgeRulers } from "./edge-rulers";

/// Un editor finto con una camera, un foglio di 400 × 300 px e le notifiche della banda.
function fingi() {
  const surface = document.createElement("div");
  document.body.append(surface);
  const life = openLifetime();
  const camera = { tx: 10, ty: 5, scale: 1, angle: 0 };
  const ascoltatori = new Set<() => void>();
  const ctx = {
    disposed: false,
    surface,
    life,
    camera,
    status: {
      subscribe: (listener: () => void) => {
        ascoltatori.add(listener);
        return () => ascoltatori.delete(listener);
      },
    },
    surfaceSize: () => ({ w: 400, h: 300 }),
    docUnit: () => "px" as const,
    announce: vi.fn(),
  } as unknown as EditorContext;
  installEdgeRulers(ctx);
  return { ctx, camera, life, surface, cambia: () => [...ascoltatori].forEach((ascolto) => ascolto()) };
}

const righe = (surface: HTMLElement, classe: string): SVGSVGElement => surface.querySelector<SVGSVGElement>(`svg.${classe}`)!;

describe("i righelli di bordo del foglio", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("non esistono finché non si accendono: il Semplice non li crea mai", () => {
    const { ctx, surface } = fingi();
    expect(ctx.edgeRulers).toBe(false);
    expect(surface.querySelector(".draw-ruler-x")).toBeNull();
    expect(surface.querySelector(".draw-ruler-y")).toBeNull();
  });

  it("accesi, le tacche sono quelle di rulerTicks su entrambi i lati del foglio", () => {
    const { ctx, surface } = fingi();
    ctx.setEdgeRulers(true);
    const x = righe(surface, "draw-ruler-x");
    const y = righe(surface, "draw-ruler-y");
    expect(x.hasAttribute("hidden")).toBe(false);
    expect(y.hasAttribute("hidden")).toBe(false);
    const attesaX = rulerTicks(10, 1, 400, "px");
    const attesaY = rulerTicks(5, 1, 300, "px");
    expect(x.querySelectorAll("line.draw-ruler-tick")).toHaveLength(attesaX.ticks.length);
    expect(y.querySelectorAll("line.draw-ruler-tick")).toHaveLength(attesaY.ticks.length);
    // Un numero per ogni tacca col valore (il livello 0).
    const numeri = attesaX.ticks.filter((tacca) => tacca.level === 0).length;
    expect(x.querySelectorAll("text.draw-ruler-label")).toHaveLength(numeri);
  });

  it("con la vista girata non ci sono tacche, e la riga in alto lo dice", () => {
    const { cambia, camera, surface, ctx } = fingi();
    ctx.setEdgeRulers(true);
    camera.angle = 30;
    cambia();
    const x = righe(surface, "draw-ruler-x");
    expect(x.querySelectorAll("line")).toHaveLength(0);
    expect(x.querySelector("text")?.textContent).toContain("Vista girata");
    expect(righe(surface, "draw-ruler-y").querySelectorAll("line")).toHaveLength(0);
  });

  it("spegnere le nasconde, e riaccendere le riusa: nessuna riga in più", () => {
    const { ctx, surface } = fingi();
    ctx.setEdgeRulers(true);
    const prima = righe(surface, "draw-ruler-x");
    ctx.setEdgeRulers(false);
    expect(prima.hasAttribute("hidden")).toBe(true);
    ctx.setEdgeRulers(true);
    expect(surface.querySelectorAll(".draw-ruler-x")).toHaveLength(1);
    expect(righe(surface, "draw-ruler-x")).toBe(prima);
  });

  it("le tacche si rifanno solo quando la vista o il foglio cambiano", () => {
    const { ctx, camera, cambia, surface } = fingi();
    ctx.setEdgeRulers(true);
    const tacca = righe(surface, "draw-ruler-x").querySelector("line");
    cambia();
    expect(righe(surface, "draw-ruler-x").querySelector("line")).toBe(tacca);
    camera.scale = 2;
    cambia();
    expect(righe(surface, "draw-ruler-x").querySelector("line")).not.toBe(tacca);
  });

  it("chiudere il disegno toglie le righe e smette di ascoltare", () => {
    const { ctx, life, surface, camera, cambia } = fingi();
    ctx.setEdgeRulers(true);
    life.close();
    expect(surface.querySelector(".draw-ruler-x")).toBeNull();
    expect(surface.querySelector(".draw-ruler-y")).toBeNull();
    camera.scale = 3;
    expect(() => cambia()).not.toThrow();
  });
});
