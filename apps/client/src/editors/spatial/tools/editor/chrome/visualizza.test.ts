// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { EditorContext } from "../context";
import { voceClienteCompleto } from "./status";
import { COMANDI_VISUALIZZA, comandoVisualizza, FILE_VISUALIZZA, isComandoVisualizza, statoVisualizza, voceVisualizza } from "./visualizza";

/// La griglia del finto editor: gli interruttori della vista sono assenti se spenti.
interface GrigliaFinta {
  shown: boolean;
  snap: boolean;
  snapPixel?: boolean;
  smartGuidesOff?: boolean;
  snapPointOff?: boolean;
  snapGlyph?: boolean;
  transparencyGrid?: boolean;
  hideEdges?: boolean;
  hideBoundingBox?: boolean;
  hideArtboards?: boolean;
  livePaintGaps?: boolean;
}

/// Un editor finto con la griglia, il contorno, i righelli di bordo e la vista.
function fingi(angle = 0, tavole: readonly { id: string; name: string }[] = [{ id: "a", name: "Tavola 1" }]) {
  return {
    disposed: false,
    boardsNow: () => tavole,
    currentBoard: () => tavole[0] ?? null,
    visitBoard: vi.fn(() => true),
    camera: { scale: 1, angle, tx: 0, ty: 0 },
    grid: { shown: false, snap: false } as GrigliaFinta,
    outline: false,
    edgeRulers: false,
    changeGrid: vi.fn(),
    setOutline: vi.fn(),
    setEdgeRulers: vi.fn(),
    turnView: vi.fn(),
    preciseCursors: false,
    setPreciseCursors: vi.fn(),
    applyToolCursor: vi.fn(),
  };
}

describe("le righe view.* di ≡ › Visualizza del Disegno completo", () => {
  it("il client fa griglia, agganci, guide sensibili, trasparenza, contorno, righelli, bordi, riquadro, ruota vista e rotateReset, e nessun'altra", () => {
    expect(COMANDI_VISUALIZZA).toEqual([
      "view.grid",
      "view.snapToGrid",
      "view.snapToPixel",
      "view.smartGuides",
      "view.snapToPoint",
      "view.snapToGlyph",
      "view.transparencyGrid",
      "view.outline",
      "view.rulers",
      "view.edges",
      "view.boundingBox",
      "view.artboards",
      "view.livePaintGaps",
      "view.preciseCursors",
      "view.rotate",
      "view.rotateReset",
      "view.goToArtboard",
    ]);
    expect(isComandoVisualizza("view.grid")).toBe(true);
    expect(isComandoVisualizza("view.snapToPixel")).toBe(true);
    expect(isComandoVisualizza("view.transparencyGrid")).toBe(true);
    expect(isComandoVisualizza("view.edges")).toBe(true);
    expect(isComandoVisualizza("view.boundingBox")).toBe(true);
    expect(isComandoVisualizza("view.smartGuides")).toBe(true);
    expect(isComandoVisualizza("view.snapToPoint")).toBe(true);
    // Il widget d'angolo resta «da fare» in mappa.
    expect(isComandoVisualizza("view.cornerWidget")).toBe(false);
    expect(isComandoVisualizza("view.rotate")).toBe(true);
    expect(isComandoVisualizza("tool.select")).toBe(false);
  });

  it("le file del menu portano ognuna voce una volta sola, nell'ordine dei comandi", () => {
    expect(FILE_VISUALIZZA.flat()).toEqual([...COMANDI_VISUALIZZA]);
    expect(FILE_VISUALIZZA.map((file) => file.length)).toEqual([3, 3, 3, 4, 1, 2, 1]);
  });

  it("una voce che il client fa è attiva; rotateReset è spenta col perché se la vista non è girata", () => {
    const dritta = fingi(0) as unknown as EditorContext;
    expect(voceVisualizza(dritta, "view.grid")).toBeNull();
    expect(voceVisualizza(dritta, "view.transparencyGrid")).toBeNull();
    expect(voceVisualizza(dritta, "view.edges")).toBeNull();
    expect(voceVisualizza(dritta, "view.boundingBox")).toBeNull();
    expect(voceVisualizza(dritta, "view.rotateReset")).toBe("La vista non è girata.");
    const girata = fingi(30) as unknown as EditorContext;
    expect(voceVisualizza(girata, "view.rotateReset")).toBeNull();
    expect(voceVisualizza(dritta, "tool.select")).toBeUndefined();
  });

  it("nella regola combinata del Completo una voce fatta resta attiva, e non è «non collegata»", () => {
    const dritta = fingi(0) as unknown as EditorContext;
    // `null` è «si fa»: la voce della griglia non dev'essere scambiata per assente.
    expect(voceClienteCompleto(dritta, "view.grid")).toBeNull();
    expect(voceClienteCompleto(dritta, "view.rulers")).toBeNull();
    expect(voceClienteCompleto(dritta, "view.transparencyGrid")).toBeNull();
    expect(voceClienteCompleto(dritta, "view.edges")).toBeNull();
    expect(voceClienteCompleto(dritta, "view.boundingBox")).toBeNull();
    expect(voceClienteCompleto(dritta, "view.rotateReset")).toBe("La vista non è girata.");
    expect(voceClienteCompleto(dritta, "view.zoomIn")).toBeNull();
    expect(voceClienteCompleto(dritta, "navigator")).toBeNull();
    expect(voceClienteCompleto(dritta, "tool.select")).toBeUndefined();
  });

  it("le voci con la spunta mostrano lo stato vero della superficie", () => {
    const ctx = fingi();
    ctx.grid = { shown: true, snap: false };
    ctx.outline = true;
    ctx.edgeRulers = true;
    const editor = ctx as unknown as EditorContext;
    expect(statoVisualizza(editor, "view.grid")).toBe(true);
    expect(statoVisualizza(editor, "view.snapToGrid")).toBe(false);
    expect(statoVisualizza(editor, "view.outline")).toBe(true);
    expect(statoVisualizza(editor, "view.rulers")).toBe(true);
    expect(statoVisualizza(editor, "view.rotateReset")).toBeUndefined();
  });

  it("la griglia di trasparenza ha la spunta quando è accesa, e spenta lo è falsa", () => {
    const ctx = fingi();
    const editor = ctx as unknown as EditorContext;
    expect(statoVisualizza(editor, "view.transparencyGrid")).toBe(false);
    ctx.grid = { shown: false, snap: false, transparencyGrid: true };
    expect(statoVisualizza(editor, "view.transparencyGrid")).toBe(true);
  });

  it("«Nascondi bordi» e «Nascondi riquadro» hanno la spunta quando ciò che nascondono è nascosto", () => {
    const ctx = fingi();
    const editor = ctx as unknown as EditorContext;
    // Assenti, come una griglia ricordata prima di loro: si vedono, quindi la spunta è spenta.
    expect(statoVisualizza(editor, "view.edges")).toBe(false);
    expect(statoVisualizza(editor, "view.boundingBox")).toBe(false);
    ctx.grid = { shown: false, snap: false, hideEdges: true, hideBoundingBox: true };
    expect(statoVisualizza(editor, "view.edges")).toBe(true);
    expect(statoVisualizza(editor, "view.boundingBox")).toBe(true);
  });

  it("l'aggancio al pixel (K6 T11) ha la spunta quando è acceso, e lo accende o spegne come la griglia, nella stessa scrittura", () => {
    const acceso = fingi();
    acceso.grid = { shown: false, snap: false, snapPixel: true };
    const editorAcceso = acceso as unknown as EditorContext;
    expect(statoVisualizza(editorAcceso, "view.snapToPixel")).toBe(true);
    comandoVisualizza(editorAcceso, "view.snapToPixel");
    expect(acceso.changeGrid).toHaveBeenLastCalledWith({ shown: false, snap: false, snapPixel: false });

    const spento = fingi();
    const editorSpento = spento as unknown as EditorContext;
    expect(statoVisualizza(editorSpento, "view.snapToPixel")).toBe(false);
    comandoVisualizza(editorSpento, "view.snapToPixel");
    expect(spento.changeGrid).toHaveBeenLastCalledWith({ shown: false, snap: false, snapPixel: true });
    // È una scrittura della griglia: il contorno e i righelli non si toccano.
    expect(spento.setOutline).not.toHaveBeenCalled();
    expect(spento.setEdgeRulers).not.toHaveBeenCalled();
  });

  it("guide sensibili e aggancio al punto sono accesi di serie, l'aggancio ai glifi spento, come in VectorCraft", () => {
    const ctx = fingi();
    const editor = ctx as unknown as EditorContext;
    // Assenti, come una griglia ricordata prima di loro.
    expect(statoVisualizza(editor, "view.smartGuides")).toBe(true);
    expect(statoVisualizza(editor, "view.snapToPoint")).toBe(true);
    expect(statoVisualizza(editor, "view.snapToGlyph")).toBe(false);
    ctx.grid = { shown: false, snap: false, smartGuidesOff: true, snapPointOff: true, snapGlyph: true };
    expect(statoVisualizza(editor, "view.smartGuides")).toBe(false);
    expect(statoVisualizza(editor, "view.snapToPoint")).toBe(false);
    expect(statoVisualizza(editor, "view.snapToGlyph")).toBe(true);
  });

  it("guide sensibili, aggancio al punto e ai glifi si scambiano nella griglia, senza toccare il resto", () => {
    const ctx = fingi();
    const editor = ctx as unknown as EditorContext;
    comandoVisualizza(editor, "view.smartGuides");
    expect(ctx.changeGrid).toHaveBeenLastCalledWith({ shown: false, snap: false, smartGuidesOff: true });
    comandoVisualizza(editor, "view.snapToPoint");
    expect(ctx.changeGrid).toHaveBeenLastCalledWith({ shown: false, snap: false, snapPointOff: true });
    comandoVisualizza(editor, "view.snapToGlyph");
    expect(ctx.changeGrid).toHaveBeenLastCalledWith({ shown: false, snap: false, snapGlyph: true });
    ctx.grid = { shown: false, snap: false, smartGuidesOff: true, snapPointOff: true, snapGlyph: true };
    comandoVisualizza(editor, "view.smartGuides");
    expect(ctx.changeGrid).toHaveBeenLastCalledWith({ shown: false, snap: false, smartGuidesOff: false, snapPointOff: true, snapGlyph: true });
    expect(ctx.setOutline).not.toHaveBeenCalled();
    expect(ctx.turnView).not.toHaveBeenCalled();
  });

  it("Mostra spazi vuoti pittura dinamica parte spenta e si scambia nella griglia", () => {
    const ctx = fingi();
    const editor = ctx as unknown as EditorContext;
    expect(isComandoVisualizza("view.livePaintGaps")).toBe(true);
    expect(statoVisualizza(editor, "view.livePaintGaps")).toBe(false);
    comandoVisualizza(editor, "view.livePaintGaps");
    expect(ctx.changeGrid).toHaveBeenLastCalledWith({ shown: false, snap: false, livePaintGaps: true });
    ctx.grid = { shown: false, snap: false, livePaintGaps: true };
    expect(statoVisualizza(editor, "view.livePaintGaps")).toBe(true);
    comandoVisualizza(editor, "view.livePaintGaps");
    expect(ctx.changeGrid).toHaveBeenLastCalledWith({ shown: false, snap: false, livePaintGaps: false });
  });

  it("ogni comando cambia lo stato che gli compete, senza toccare gli altri", () => {
    const ctx = fingi();
    const editor = ctx as unknown as EditorContext;
    comandoVisualizza(editor, "view.grid");
    expect(ctx.changeGrid).toHaveBeenLastCalledWith({ shown: true, snap: false });
    comandoVisualizza(editor, "view.snapToGrid");
    expect(ctx.changeGrid).toHaveBeenLastCalledWith({ shown: false, snap: true });
    comandoVisualizza(editor, "view.transparencyGrid");
    expect(ctx.changeGrid).toHaveBeenLastCalledWith({ shown: false, snap: false, transparencyGrid: true });
    comandoVisualizza(editor, "view.outline");
    expect(ctx.setOutline).toHaveBeenCalledWith(true);
    comandoVisualizza(editor, "view.rulers");
    expect(ctx.setEdgeRulers).toHaveBeenCalledWith(true);
    comandoVisualizza(editor, "view.edges");
    expect(ctx.changeGrid).toHaveBeenLastCalledWith({ shown: false, snap: false, hideEdges: true });
    comandoVisualizza(editor, "view.boundingBox");
    expect(ctx.changeGrid).toHaveBeenLastCalledWith({ shown: false, snap: false, hideBoundingBox: true });
    comandoVisualizza(editor, "view.rotateReset");
    expect(ctx.turnView).toHaveBeenCalledWith(0);
  });

  it("accendere e spegnere la trasparenza, i bordi e il riquadro sono scritture della griglia, mai del contorno o della rotazione", () => {
    const ctx = fingi();
    ctx.grid = { shown: true, snap: false, transparencyGrid: true, hideEdges: true, hideBoundingBox: true };
    const editor = ctx as unknown as EditorContext;
    comandoVisualizza(editor, "view.transparencyGrid");
    expect(ctx.changeGrid).toHaveBeenLastCalledWith({ shown: true, snap: false, transparencyGrid: false, hideEdges: true, hideBoundingBox: true });
    comandoVisualizza(editor, "view.edges");
    expect(ctx.changeGrid).toHaveBeenLastCalledWith({ shown: true, snap: false, transparencyGrid: true, hideEdges: false, hideBoundingBox: true });
    comandoVisualizza(editor, "view.boundingBox");
    expect(ctx.changeGrid).toHaveBeenLastCalledWith({ shown: true, snap: false, transparencyGrid: true, hideEdges: true, hideBoundingBox: false });
    expect(ctx.setOutline).not.toHaveBeenCalled();
    expect(ctx.setEdgeRulers).not.toHaveBeenCalled();
    expect(ctx.turnView).not.toHaveBeenCalled();
  });
});

describe("«Usa cursori di precisione» (K6 T11, cursori): la voce di ≡ › Visualizza", () => {
  it("la voce è attiva anche senza motore, e la spunta dice se i cursori sono accesi", () => {
    // La voce non chiede il motore: la scelta è della superficie. Senza motore non si sceglie uno strumento
    // che disegna, ma la spunta e il comando funzionano lo stesso.
    const ctx = fingi(0);
    expect(voceVisualizza(ctx as unknown as EditorContext, "view.preciseCursors")).toBeNull();
    expect(statoVisualizza(ctx as unknown as EditorContext, "view.preciseCursors")).toBe(false);
    ctx.preciseCursors = true;
    expect(statoVisualizza(ctx as unknown as EditorContext, "view.preciseCursors")).toBe(true);
  });

  it("ogni scelta chiede il contrario di ciò che è acceso, e la scrittura la fa il contesto", () => {
    const ctx = fingi(0);
    comandoVisualizza(ctx as unknown as EditorContext, "view.preciseCursors");
    expect(ctx.setPreciseCursors).toHaveBeenLastCalledWith(true);
    ctx.preciseCursors = true;
    comandoVisualizza(ctx as unknown as EditorContext, "view.preciseCursors");
    expect(ctx.setPreciseCursors).toHaveBeenLastCalledWith(false);
  });
});

describe("le tavole nel menu Visualizza (view.artboards, view.goToArtboard)", () => {
  it("«Nascondi tavole da disegno» ha la spunta quando sono nascoste e si scambia nella griglia", () => {
    const ctx = fingi();
    const editor = ctx as unknown as EditorContext;
    expect(voceVisualizza(editor, "view.artboards")).toBeNull();
    expect(statoVisualizza(editor, "view.artboards")).toBe(false);
    comandoVisualizza(editor, "view.artboards");
    expect(ctx.changeGrid).toHaveBeenLastCalledWith({ shown: false, snap: false, hideArtboards: true });
    ctx.grid = { shown: false, snap: false, hideArtboards: true };
    expect(statoVisualizza(editor, "view.artboards")).toBe(true);
    comandoVisualizza(editor, "view.artboards");
    expect(ctx.changeGrid).toHaveBeenLastCalledWith({ shown: false, snap: false, hideArtboards: false });
  });

  it("«Vai alla tavola» è spenta col perché senza tavole, e non ha spunta", () => {
    expect(voceVisualizza(fingi(0, []) as unknown as EditorContext, "view.goToArtboard")).toBe("Il disegno non ha tavole.");
    expect(voceVisualizza(fingi() as unknown as EditorContext, "view.goToArtboard")).toBeNull();
    expect(statoVisualizza(fingi() as unknown as EditorContext, "view.goToArtboard")).toBeUndefined();
  });

  it("«Vai alla tavola» chiede quale e la inquadra nella finestra", async () => {
    const ctx = fingi(0, [
      { id: "a", name: "Copertina" },
      { id: "b", name: "Retro" },
    ]);
    comandoVisualizza(ctx as unknown as EditorContext, "view.goToArtboard");
    const finestra = document.querySelector<HTMLElement>('[role="dialog"]')!;
    finestra.querySelector<HTMLSelectElement>("select")!.value = "1";
    finestra.querySelector<HTMLButtonElement>('[data-action="apply"]')!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.visitBoard).toHaveBeenCalledWith(1, true);
  });
});

