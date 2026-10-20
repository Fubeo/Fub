import { describe, expect, it } from "vitest";
import { foreignDrawing } from "./foreign";

describe("un disegno di un altro programma negli appunti", () => {
  it("riconosce gli appunti di Excalidraw e l'XML di draw.io, anche codificato", () => {
    const clip = JSON.stringify({ type: "excalidraw/clipboard", elements: [] });
    expect(foreignDrawing(clip)).toEqual({ source: "excalidraw", text: clip });
    const xml = "<mxGraphModel><root/></mxGraphModel>";
    expect(foreignDrawing(xml)).toEqual({ source: "drawio", text: xml });
    expect(foreignDrawing(encodeURIComponent(xml))).toEqual({ source: "drawio", text: xml });
  });

  it("lascia stare un testo qualunque, un URL rotto e un SVG di draw.io, che entra come SVG", () => {
    expect(foreignDrawing("ciao")).toBeNull();
    expect(foreignDrawing("%3C%E0%A4%A")).toBeNull();
    expect(foreignDrawing('<svg xmlns="http://www.w3.org/2000/svg" content="&lt;mxfile host=&quot;x&quot;&gt;"></svg>')).toBeNull();
  });
});
