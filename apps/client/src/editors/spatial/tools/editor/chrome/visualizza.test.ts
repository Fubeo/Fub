// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { EditorContext } from "../context";
import { voceClienteCompleto } from "./status";
import { COMANDI_VISUALIZZA, comandoVisualizza, isComandoVisualizza, statoVisualizza, voceVisualizza } from "./visualizza";

/// Un editor finto con la griglia, il contorno, i righelli di bordo e la vista.
function fingi(angle = 0) {
  return {
    camera: { scale: 1, angle, tx: 0, ty: 0 },
    grid: { shown: false, snap: false },
    outline: false,
    edgeRulers: false,
    changeGrid: vi.fn(),
    setOutline: vi.fn(),
    setEdgeRulers: vi.fn(),
    turnView: vi.fn(),
  };
}

describe("le righe view.* di ≡ › Visualizza del Disegno completo", () => {
  it("il client fa grid, snapToGrid, outline, rulers e rotateReset, e nessun'altra", () => {
    expect(COMANDI_VISUALIZZA).toEqual(["view.grid", "view.snapToGrid", "view.outline", "view.rulers", "view.rotateReset"]);
    expect(isComandoVisualizza("view.grid")).toBe(true);
    expect(isComandoVisualizza("view.rotate")).toBe(false);
    expect(isComandoVisualizza("tool.select")).toBe(false);
  });

  it("una voce che il client fa è attiva; rotateReset è spenta col perché se la vista non è girata", () => {
    const dritta = fingi(0) as unknown as EditorContext;
    expect(voceVisualizza(dritta, "view.grid")).toBeNull();
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

  it("ogni comando cambia lo stato che gli compete, senza toccare gli altri", () => {
    const ctx = fingi();
    const editor = ctx as unknown as EditorContext;
    comandoVisualizza(editor, "view.grid");
    expect(ctx.changeGrid).toHaveBeenLastCalledWith({ shown: true, snap: false });
    comandoVisualizza(editor, "view.snapToGrid");
    expect(ctx.changeGrid).toHaveBeenLastCalledWith({ shown: false, snap: true });
    comandoVisualizza(editor, "view.outline");
    expect(ctx.setOutline).toHaveBeenCalledWith(true);
    comandoVisualizza(editor, "view.rulers");
    expect(ctx.setEdgeRulers).toHaveBeenCalledWith(true);
    comandoVisualizza(editor, "view.rotateReset");
    expect(ctx.turnView).toHaveBeenCalledWith(0);
  });
});
