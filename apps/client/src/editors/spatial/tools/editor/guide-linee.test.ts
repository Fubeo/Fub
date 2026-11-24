// @vitest-environment happy-dom
// Le guide del righello nel client del Disegno completo, come in VectorCraft (`rulerguide.rs`):
// si vedono, si prendono con le Selezioni, si spostano, si copiano con Alt, se ne vanno sul
// righello e nascono tirandole da un righello; Nascondi e Blocca guide.
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../../ui/lifetime";
import type { RulerGuide } from "../../scene/rulers";
import { toScene, type View } from "../../view";
import { rulerTicks } from "../rulers";
import type { EditorContext } from "./context";
import {
  agganciata,
  guidaSotto,
  guideSulloSchermo,
  installGuideLines,
  lasciataSulRighello,
  righelloSotto,
  type StatoGuide,
} from "./guide-linee";

const camera = (): View => ({ tx: 0, ty: 0, scale: 1, angle: 0 }) as View;

function stato(guide: readonly RulerGuide[], piu: Partial<StatoGuide> = {}): StatoGuide {
  return {
    camera: camera(),
    larghezza: 400,
    altezza: 300,
    guide,
    tavole: new Map(),
    livelli: new Map(),
    nascoste: false,
    bloccate: false,
    ...piu,
  };
}

interface Finto {
  readonly ctx: EditorContext;
  readonly surface: HTMLElement;
  readonly esegui: ReturnType<typeof vi.fn>;
  readonly dopo: ReturnType<typeof vi.fn>;
}

/// Un editor finto: un foglio di 400 × 300 px senza spostamenti, col motore, coi righelli
/// accesi e la Selezione scelta.
function fingi(guide: RulerGuide[], piu: Record<string, unknown> = {}): Finto {
  const surface = document.createElement("div");
  document.body.append(surface);
  const esegui = vi.fn();
  const view = camera();
  const ctx = {
    disposed: false,
    surface,
    life: openLifetime(),
    camera: view,
    status: { subscribe: () => () => undefined },
    surfaceSize: () => ({ w: 400, h: 300 }),
    docUnit: () => "px" as const,
    announce: vi.fn(),
    completoMotore: () => ({ conMotore: () => true, eseguiComando: esegui }),
    boardsNow: () => [{ id: "b1", box: { min: [100, 100], max: [200, 200] } }],
    currentIndex: () => ({ layers: [{ id: "l1", hidden: false, locked: false }, { id: "l2", hidden: false, locked: true }] }),
    scene: { root: { guides: guide } },
    editable: () => true,
    edgeRulers: true,
    grid: { snap: false, snapPixel: false },
    motoreTool: "selection",
    tool: "select",
    boards: null,
    localPoint: (x: number, y: number) => ({ x, y }),
    sceneAt: (x: number, y: number) => toScene(view, [x, y]),
    ...piu,
  } as unknown as EditorContext;
  installGuideLines(ctx);
  ctx.showGuides();
  // Ciò che arriva dopo le guide: gli strumenti.
  const dopo = vi.fn();
  surface.addEventListener("pointerdown", dopo);
  return { ctx, surface, esegui, dopo };
}

const evento = (tipo: string, x: number, y: number, tasti: { alt?: boolean; shift?: boolean } = {}): PointerEvent =>
  new PointerEvent(tipo, { clientX: x, clientY: y, button: 0, buttons: tipo === "pointerup" ? 0 : 1, pointerId: 1, bubbles: true, altKey: tasti.alt === true, shiftKey: tasti.shift === true });

/// Un trascinamento da `da` ad `a`, coi tasti tenuti fino al rilascio.
function trascina(surface: HTMLElement, da: [number, number], a: [number, number], tasti: { alt?: boolean; shift?: boolean } = {}): void {
  surface.dispatchEvent(evento("pointerdown", da[0], da[1], tasti));
  surface.dispatchEvent(evento("pointermove", (da[0] + a[0]) / 2, (da[1] + a[1]) / 2, tasti));
  surface.dispatchEvent(evento("pointermove", a[0], a[1], tasti));
  surface.dispatchEvent(evento("pointerup", a[0], a[1], tasti));
}

const linee = (surface: HTMLElement) => [...surface.querySelectorAll<SVGLineElement>("svg.draw-guides line")];

afterEach(() => {
  document.body.innerHTML = "";
});

describe("le guide sullo schermo (view.guides le nasconde)", () => {
  it("una guida del foglio attraversa la vista, una di tavola sta lungo la sua tavola", () => {
    const fuori = guideSulloSchermo(
      stato([{ axis: "x", at: 50, locked: false }, { axis: "y", at: 150, locked: false, board: "b1" }], {
        tavole: new Map([["b1", { min: [100, 100], max: [200, 200] }]]),
      }),
    );
    expect(fuori).toHaveLength(2);
    expect(fuori[0]!.a[0]).toBe(50);
    expect(fuori[0]!.a[1]).toBeLessThan(0);
    expect(fuori[0]!.b[1]).toBeGreaterThan(300);
    expect(fuori[1]!.a).toEqual([100, 150]);
    expect(fuori[1]!.b).toEqual([200, 150]);
  });

  it("si nascondono con Nascondi guide e col loro livello; le bloccate non si prendono", () => {
    const guide: RulerGuide[] = [
      { axis: "x", at: 10, locked: false, layer: "nascosto" },
      { axis: "x", at: 20, locked: true },
      { axis: "x", at: 30, locked: false, layer: "chiuso" },
      { axis: "x", at: 40, locked: false },
    ];
    const livelli = new Map([
      ["nascosto", { hidden: true, locked: false }],
      ["chiuso", { hidden: false, locked: true }],
    ]);
    const fuori = guideSulloSchermo(stato(guide, { livelli }));
    expect(fuori.map((g) => [g.index, g.modificabile])).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ]);
    expect(guideSulloSchermo(stato(guide, { livelli, bloccate: true })).every((g) => !g.modificabile)).toBe(true);
    expect(guideSulloSchermo(stato(guide, { nascoste: true }))).toEqual([]);
  });

  it("con la vista girata la guida resta dritta nel disegno", () => {
    const girata = { tx: 200, ty: 150, scale: 1, angle: 90 } as View;
    const [g] = guideSulloSchermo(stato([{ axis: "x", at: 0, locked: false }], { camera: girata }));
    // Girata di un quarto, una guida verticale sta in orizzontale sullo schermo.
    expect(Math.abs(g!.a[1] - g!.b[1])).toBeLessThan(1e-9);
  });

  it("si prende entro 4 pixel, e fra due la più nuova", () => {
    const fuori = guideSulloSchermo(stato([{ axis: "x", at: 100, locked: false }, { axis: "x", at: 102, locked: false }, { axis: "x", at: 200, locked: true }]));
    expect(guidaSotto(fuori, [101, 50])?.index).toBe(1);
    expect(guidaSotto(fuori, [97, 50])?.index).toBe(0);
    expect(guidaSotto(fuori, [107, 50])).toBeNull();
    expect(guidaSotto(fuori, [200, 50])).toBeNull();
  });

  it("i righelli: in alto le guide orizzontali, a sinistra le verticali, e lì se ne vanno", () => {
    expect(righelloSotto([100, 10], true)).toBe("y");
    expect(righelloSotto([10, 100], true)).toBe("x");
    expect(righelloSotto([10, 10], true)).toBe("y");
    expect(righelloSotto([100, 100], true)).toBeNull();
    expect(righelloSotto([100, 10], false)).toBeNull();
    expect(lasciataSulRighello("x", [20, 100], true)).toBe(true);
    expect(lasciataSulRighello("x", [20, 100], false)).toBe(false);
    expect(lasciataSulRighello("x", [-1, 100], false)).toBe(true);
    expect(lasciataSulRighello("y", [100, 15], true)).toBe(true);
  });

  it("l'aggancio: Maiusc sulle tacche del righello, la griglia, due decimali", () => {
    const base = { maiusc: false, passo: null, camera: camera(), larghezza: 400, altezza: 300, unita: "px" as const };
    expect(agganciata("x", 12.3456, base)).toBe(12.35);
    expect(agganciata("x", 23, { ...base, passo: 10 })).toBe(20);
    const tacche = rulerTicks(0, 1, 400, "px").ticks.map((t) => t.at);
    const conMaiusc = agganciata("x", 23, { ...base, maiusc: true });
    expect(tacche).toContain(conMaiusc);
    expect(Math.min(...tacche.map((t) => Math.abs(t - 23)))).toBe(Math.abs(conMaiusc - 23));
  });
});

describe("i gesti delle guide", () => {
  it("si disegnano sopra il foglio: le bloccate tratteggiate a parte", () => {
    const { surface } = fingi([{ axis: "x", at: 50, locked: false }, { axis: "y", at: 80, locked: true }]);
    const [a, b] = linee(surface);
    expect(linee(surface)).toHaveLength(2);
    expect(a!.getAttribute("class")).toBe("draw-guide-line");
    expect(b!.getAttribute("class")).toContain("draw-guide-line-locked");
    expect(surface.querySelector("svg.draw-guides")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("dal righello in alto nasce una guida orizzontale dove si lascia; con Alt verticale", () => {
    const { surface, esegui, dopo } = fingi([]);
    trascina(surface, [100, 10], [150, 120.004]);
    expect(esegui).toHaveBeenLastCalledWith("guide.add", { vertical: false, pos: 120 });
    expect(dopo).not.toHaveBeenCalled();
    trascina(surface, [100, 10], [150, 120], { alt: true });
    expect(esegui).toHaveBeenLastCalledWith("guide.add", { vertical: true, pos: 150 });
    trascina(surface, [10, 100], [60, 100]);
    expect(esegui).toHaveBeenLastCalledWith("guide.add", { vertical: true, pos: 60 });
  });

  it("lasciata sul righello o fuori dal foglio non nasce", () => {
    const { surface, esegui } = fingi([]);
    trascina(surface, [100, 10], [150, 15]);
    trascina(surface, [100, 10], [150, 500]);
    expect(esegui).not.toHaveBeenCalled();
    expect(linee(surface)).toHaveLength(0);
  });

  it("con lo strumento Tavola nasce una guida della tavola sotto il punto", () => {
    const { surface, esegui } = fingi([], { motoreTool: "artboard" });
    trascina(surface, [100, 10], [150, 150]);
    expect(esegui).toHaveBeenLastCalledWith("guide.add", { vertical: false, pos: 150, artboard: 0 });
  });

  it("con la Selezione una guida si sposta, con Alt se ne sposta una copia", () => {
    const { surface, esegui, dopo } = fingi([{ axis: "x", at: 100, locked: false }]);
    trascina(surface, [101, 150], [141, 160]);
    expect(esegui).toHaveBeenLastCalledWith("guide.move", { index: 0, pos: 140 });
    expect(dopo).not.toHaveBeenCalled();
    trascina(surface, [100, 150], [130, 150], { alt: true });
    expect(esegui).toHaveBeenLastCalledWith("guide.move", { guides: [0], dx: 30, dy: 0, copy: true });
  });

  it("un clic senza trascinare non cambia la guida", () => {
    const { surface, esegui } = fingi([{ axis: "y", at: 100, locked: false }]);
    trascina(surface, [200, 100], [201, 101]);
    expect(esegui).not.toHaveBeenCalled();
  });

  it("lasciata sul suo righello se ne va", () => {
    const { surface, esegui } = fingi([{ axis: "y", at: 100, locked: false }]);
    trascina(surface, [200, 100], [200, 8]);
    expect(esegui).toHaveBeenLastCalledWith("guide.remove", { index: 0 });
  });

  it("una guida bloccata, gli altri strumenti, Blocca guide e Nascondi guide la lasciano agli strumenti", () => {
    const bloccata = fingi([{ axis: "x", at: 100, locked: true }]);
    trascina(bloccata.surface, [100, 150], [140, 150]);
    expect(bloccata.esegui).not.toHaveBeenCalled();
    expect(bloccata.dopo).toHaveBeenCalled();

    const penna = fingi([{ axis: "x", at: 100, locked: false }], { motoreTool: "pen", tool: "pen" });
    trascina(penna.surface, [100, 150], [140, 150]);
    expect(penna.esegui).not.toHaveBeenCalled();

    const chiuse = fingi([{ axis: "x", at: 100, locked: false }]);
    chiuse.ctx.setGuidesLocked(true);
    expect(chiuse.ctx.guidesLocked).toBe(true);
    trascina(chiuse.surface, [100, 150], [140, 150]);
    expect(chiuse.esegui).not.toHaveBeenCalled();
    expect(linee(chiuse.surface)).toHaveLength(1);

    const nascoste = fingi([{ axis: "x", at: 100, locked: false }]);
    nascoste.ctx.setGuidesHidden(true);
    expect(linee(nascoste.surface)).toHaveLength(0);
    trascina(nascoste.surface, [100, 150], [140, 150]);
    trascina(nascoste.surface, [100, 10], [140, 150]);
    expect(nascoste.esegui).not.toHaveBeenCalled();
    nascoste.ctx.setGuidesHidden(false);
    expect(linee(nascoste.surface)).toHaveLength(1);
  });

  it("un clic in un campo sopra il foglio resta al campo", () => {
    const { surface, esegui } = fingi([{ axis: "x", at: 100, locked: false }]);
    const campo = document.createElement("input");
    surface.append(campo);
    campo.dispatchEvent(evento("pointerdown", 100, 150));
    surface.dispatchEvent(evento("pointermove", 140, 150));
    surface.dispatchEvent(evento("pointerup", 140, 150));
    expect(esegui).not.toHaveBeenCalled();
  });

  it("senza il motore, o in sola lettura, le guide si vedono ma non si toccano", () => {
    const sola = fingi([{ axis: "x", at: 100, locked: false }], { editable: () => false });
    trascina(sola.surface, [100, 150], [140, 150]);
    trascina(sola.surface, [100, 10], [140, 150]);
    expect(sola.esegui).not.toHaveBeenCalled();
    expect(linee(sola.surface)).toHaveLength(1);
  });

  it("il puntatore sopra una guida che si prende la accende e cambia il cursore", () => {
    const { surface } = fingi([{ axis: "x", at: 100, locked: false }]);
    surface.dispatchEvent(new PointerEvent("pointermove", { clientX: 102, clientY: 150, buttons: 0, pointerId: 1, bubbles: true }));
    expect(surface.dataset.guidaSotto).toBe("x");
    expect(linee(surface)[0]!.getAttribute("class")).toContain("draw-guide-line-hot");
    surface.dispatchEvent(new PointerEvent("pointermove", { clientX: 140, clientY: 150, buttons: 0, pointerId: 1, bubbles: true }));
    expect(surface.dataset.guidaSotto).toBeUndefined();
    expect(linee(surface)[0]!.getAttribute("class")).toBe("draw-guide-line");
  });

  it("durante il trascinamento la guida si mostra dove va, senza il motore", () => {
    const { surface, esegui } = fingi([{ axis: "x", at: 100, locked: false }]);
    surface.dispatchEvent(evento("pointerdown", 100, 150));
    surface.dispatchEvent(evento("pointermove", 160, 150));
    expect(esegui).not.toHaveBeenCalled();
    const [mobile] = linee(surface);
    expect(linee(surface)).toHaveLength(1);
    expect(mobile!.getAttribute("x1")).toBe("160");
    expect(mobile!.getAttribute("class")).toContain("draw-guide-line-hot");
    surface.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1, bubbles: true }));
    expect(linee(surface)[0]!.getAttribute("x1")).toBe("100");
  });
});
