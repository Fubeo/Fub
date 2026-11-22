// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../../../ui/lifetime";
import { ZOOM_STEP } from "../constants";
import type { EditorContext } from "../context";
import { installStatus, voceClienteBanda, type DrawStatusItem, type StatusFrame } from "./status";

/// Un fotogramma finto: le richieste si accumulano, e `avanza` le esegue. Annullare
/// una richiesta la toglie, come fa il browser.
function fotogramma() {
  const richieste: Array<(() => void) | null> = [];
  const frame: StatusFrame = {
    request: vi.fn((richiesta: () => void) => {
      richieste.push(richiesta);
      return richieste.length;
    }),
    cancel: vi.fn((handle: number) => {
      richieste[handle - 1] = null;
    }),
  };
  const avanza = (): void => {
    const pendenti = richieste.splice(0);
    for (const richiesta of pendenti) richiesta?.();
  };
  return { frame, avanza };
}

/// Un editor finto con una camera, una selezione e una misura che si conta.
function fingi(opzioni: { readonly spazio?: string; readonly completo?: boolean } = {}) {
  const root = document.createElement("div");
  document.body.append(root);
  const life = openLifetime();
  const camera = { scale: 1, angle: 0, tx: 0, ty: 0 };
  let scelti: string[] = [];
  const { frame, avanza } = fotogramma();
  const frameOf = vi.fn(() => ({ matrix: [1, 0, 0, 1, 0, 0] as const, box: { min: [0, 0] as const, max: [30, 40] as const } }));
  const ctx = {
    disposed: false,
    root,
    life,
    camera,
    space: opzioni.spazio ?? "simple",
    completoVoci: opzioni.completo === true ? () => ({}) : () => null,
    statusPointer: null,
    outline: false,
    zoomText: () => `${Math.round(camera.scale * 100)} %`,
    zoomBy: vi.fn((factor: number) => {
      camera.scale *= factor;
    }),
    turnText: (angle: number) => String(angle),
    turnView: vi.fn(),
    setOutline: vi.fn(),
    coordText: (value: number) => String(Math.round(value)),
    lengthText: (value: number) => String(Math.round(value)),
    selectedUnits: () => scelti,
    frameOf,
    currentIndex: () => ({ units: [{}, {}, {}] }),
    fit: vi.fn(),
    announce: vi.fn(),
  } as unknown as EditorContext;
  installStatus(ctx, frame);
  const voci = (): readonly DrawStatusItem[] => ctx.status.items();
  const voce = (id: string): DrawStatusItem | undefined => voci().find((item) => item.id === id);
  return {
    ctx,
    life,
    camera,
    frameOf,
    voce,
    avanza,
    frame,
    seleziona: (ids: string[]) => {
      scelti = ids;
    },
  };
}

describe("la banda di stato del disegno", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("il puntatore e la misura della selezione sono una voce sola, accanto", () => {
    const { ctx, voce, avanza, seleziona } = fingi();
    seleziona(["a"]);
    ctx.statusPointer = [10, 20];
    ctx.statusChanged();
    avanza();
    expect(voce("info")?.text).toBe("X 10  Y 20 · 30 × 40");
    expect(voce("pointer")).toBeUndefined();
    expect(voce("size")).toBeUndefined();
  });

  it("senza selezione dice solo il puntatore, e fuori dal foglio solo la selezione", () => {
    const { ctx, voce, avanza, seleziona } = fingi();
    ctx.statusPointer = [10, 20];
    ctx.statusChanged();
    avanza();
    expect(voce("info")?.text).toBe("X 10  Y 20");
    seleziona(["a"]);
    ctx.statusPointer = null;
    ctx.statusChanged();
    avanza();
    expect(voce("info")?.text).toBe("30 × 40");
  });

  it("le misure si leggono al più una volta per fotogramma, anche con molti movimenti", () => {
    const { ctx, frame, frameOf, avanza, seleziona } = fingi();
    seleziona(["a", "b"]);
    for (let i = 0; i < 100; i += 1) {
      ctx.statusPointer = [i, i];
      ctx.statusChanged();
    }
    expect(frame.request).toHaveBeenCalledTimes(1);
    avanza();
    expect(frameOf).toHaveBeenCalledTimes(1);
  });

  it("una lettura di un disegno cambiato prima del fotogramma si butta, e non si mostra", () => {
    const { ctx, voce, avanza, seleziona, frameOf } = fingi();
    seleziona(["a"]);
    ctx.statusChanged();
    avanza();
    expect(voce("info")?.text).toBe("30 × 40");
    seleziona(["a", "b"]);
    ctx.statusChanged();
    // Prima del fotogramma la lettura è di un'altra versione: la misura non c'è.
    expect(voce("info")).toBeUndefined();
    avanza();
    expect(frameOf).toHaveBeenCalledTimes(2);
    expect(voce("info")?.text).toBe("30 × 40");
  });

  it("chiudere il disegno annulla il fotogramma in attesa", () => {
    const { ctx, life, frame, frameOf, avanza, seleziona } = fingi();
    seleziona(["a"]);
    ctx.statusChanged();
    life.close();
    expect(frame.cancel).toHaveBeenCalledWith(1);
    avanza();
    expect(frameOf).not.toHaveBeenCalled();
  });

  it("negli altri spazi la voce dello zoom torna al 100 % sul posto, come prima", () => {
    const { ctx, camera, voce } = fingi({ spazio: "simple" });
    const zoom = voce("zoom")!;
    expect(zoom.inPlace).toBe(true);
    camera.scale = 2;
    zoom.open?.();
    expect(ctx.zoomBy).toHaveBeenCalledWith(0.5);
    expect(camera.scale).toBeCloseTo(1);
    expect(document.querySelector(".draw-zoom-popover")).toBeNull();
  });

  it("nel Disegno completo la voce dello zoom apre il suo menu, e non agisce sul posto", () => {
    const { ctx, voce } = fingi({ spazio: "full", completo: true });
    const zoom = voce("zoom")!;
    expect(zoom.inPlace).toBeUndefined();
    expect(zoom.hint).toBe("100 %: scegli lo zoom");
    zoom.open?.();
    expect(ctx.zoomBy).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".draw-zoom-popover [role='menuitem']")).toHaveLength(4);
  });

  it("il Completo senza il suo spazio «Completo» resta come negli altri spazi", () => {
    const { voce } = fingi({ spazio: "full", completo: false });
    expect(voce("zoom")?.inPlace).toBe(true);
  });

  it("le voci del client della banda: lo zoom si fa, le misure si vedono già", () => {
    expect(voceClienteBanda("view.zoomIn")).toBeNull();
    expect(voceClienteBanda("view.setZoom")).toBeNull();
    expect(voceClienteBanda("info")).toBe("Si vede già nella banda di stato");
    expect(voceClienteBanda("tool.select")).toBeUndefined();
  });

  it("comandoVista fa lo zoom del comando", () => {
    const { ctx, camera } = fingi();
    ctx.comandoVista("view.zoomIn");
    expect(ctx.zoomBy).toHaveBeenCalledWith(ZOOM_STEP);
    expect(camera.scale).toBeCloseTo(ZOOM_STEP);
  });
});
