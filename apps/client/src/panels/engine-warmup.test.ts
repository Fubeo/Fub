import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { engineExtension, engineWarmup, WARM_HOVER_MS } from "./engine-warmup";

describe("scaldare i motori dall'albero", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("scalda dopo il ritardo del puntatore, non prima", () => {
    const warm = vi.fn(async () => {});
    const warmup = engineWarmup(warm);
    warmup.hover("Conti/Bilancio.xlsx");
    vi.advanceTimersByTime(WARM_HOVER_MS - 1);
    expect(warm).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(warm).toHaveBeenCalledWith("xlsx");
    warmup.dispose();
  });

  it("il puntatore che esce prima annulla", () => {
    const warm = vi.fn(async () => {});
    const warmup = engineWarmup(warm);
    warmup.hover("Lettera.docx");
    vi.advanceTimersByTime(WARM_HOVER_MS / 2);
    warmup.leave();
    vi.advanceTimersByTime(WARM_HOVER_MS * 4);
    expect(warm).not.toHaveBeenCalled();
    // Passare a un'altra riga annulla la prima: si scalda l'ultima.
    warmup.hover("Lettera.docx");
    warmup.hover("Verbale.odt");
    vi.advanceTimersByTime(WARM_HOVER_MS);
    expect(warm.mock.calls).toEqual([["odt"]]);
    warmup.dispose();
  });

  it("una sola chiamata per estensione, finché il vault non cambia", () => {
    const warm = vi.fn(async () => {});
    const warmup = engineWarmup(warm);
    for (const id of ["A.docx", "B.DOCX", "c/D.docx"]) {
      warmup.hover(id);
      vi.advanceTimersByTime(WARM_HOVER_MS);
    }
    warmup.folder(["E.docx", "F.xlsx", "G.xlsx", "nota.md", "foto.png"]);
    expect(warm.mock.calls).toEqual([["docx"], ["xlsx"]]);
    warmup.reset();
    warmup.folder(["E.docx"]);
    expect(warm.mock.calls).toEqual([["docx"], ["xlsx"], ["docx"]]);
    warmup.dispose();
  });

  it("un file senza motore non chiama, e un errore dell'host non esce", async () => {
    const warm = vi.fn(async () => {
      throw new Error("host spento");
    });
    const warmup = engineWarmup(warm);
    warmup.hover("nota.md");
    warmup.hover("foto.png");
    vi.advanceTimersByTime(WARM_HOVER_MS * 2);
    expect(warm).not.toHaveBeenCalled();
    warmup.folder(["Lettera.docx"]);
    await vi.runAllTimersAsync();
    expect(warm).toHaveBeenCalledTimes(1);
    warmup.dispose();
  });

  it("chiuso, il timer si ferma e niente parte più", () => {
    const warm = vi.fn(async () => {});
    const warmup = engineWarmup(warm);
    warmup.hover("Lettera.docx");
    warmup.dispose();
    vi.advanceTimersByTime(WARM_HOVER_MS * 2);
    warmup.folder(["Bilancio.xlsx"]);
    expect(warm).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("l'estensione è quella dei formati con un motore", () => {
    expect(engineExtension("a/Lettera.DOCX")).toBe("docx");
    expect(engineExtension("Vecchio.rtf")).toBe("rtf");
    expect(engineExtension("Bilancio.xlsm")).toBe("xlsm");
    expect(engineExtension("nota.md")).toBeNull();
    expect(engineExtension("disegno.svg")).toBeNull();
    expect(engineExtension("senza")).toBeNull();
  });
});
