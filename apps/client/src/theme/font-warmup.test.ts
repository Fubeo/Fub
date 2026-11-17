// I caratteri del tema caricati a riposo: una faccia per passo, solo quelle
// ancora da caricare.
import { describe, expect, it, vi } from "vitest";
import { warmFonts } from "./font-warmup";

const face = (status: FontFaceLoadStatus, fails = false) => {
  const self = {
    status,
    load: vi.fn(async () => {
      if (fails) throw new Error("file assente");
      self.status = "loaded" as FontFaceLoadStatus;
      return self as unknown as FontFace;
    }),
  };
  return self;
};

describe("warmFonts", () => {
  it("carica ogni faccia da caricare, ciascuna dopo il suo passo", async () => {
    const faces = [face("loaded"), face("unloaded"), face("loading"), face("unloaded", true), face("unloaded")];
    const order: string[] = [];
    const next = vi.fn(async () => {
      order.push(`passo ${faces.filter((f) => f.load.mock.calls.length > 0).length}`);
    });
    await warmFonts(next, faces);
    expect(faces.map((f) => f.load.mock.calls.length)).toEqual([0, 1, 0, 1, 1]);
    expect(order, "un passo prima di ogni faccia, e la faccia che fallisce non ferma le altre").toEqual(["passo 0", "passo 1", "passo 2"]);
  });

  it("una faccia caricata da qualcun altro durante l'attesa non si ricarica", async () => {
    const only = face("unloaded");
    await warmFonts(async () => {
      only.status = "loading";
    }, [only]);
    expect(only.load).not.toHaveBeenCalled();
  });

  it("si ferma quando il passo rifiuta", async () => {
    const faces = [face("unloaded"), face("unloaded")];
    let steps = 0;
    await expect(
      warmFonts(async () => {
        steps += 1;
        if (steps === 2) throw new Error("fermo");
      }, faces),
    ).rejects.toThrow("fermo");
    expect(faces.map((f) => f.load.mock.calls.length)).toEqual([1, 0]);
  });
});
