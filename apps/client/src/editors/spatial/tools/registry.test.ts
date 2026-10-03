// Il registro degli strumenti: che cosa offre ogni livello di ogni profilo, e
// con quali tasti.

import { describe, expect, it } from "vitest";
import { icon } from "../../../ui/icons";
import { DEFAULT_TOOL, defaultTool, TOOLS, toolForKey, toolsFor, toolSpec } from "./registry";

describe("il registro degli strumenti", () => {
  it("dà all'Essenziale i sette strumenti, nell'ordine della barra", () => {
    expect(toolsFor("essential").map((tool) => tool.id)).toEqual(["select", "pen", "eraser", "rect", "ellipse", "line", "arrow"]);
    // Un livello sopra vede anche quelli sotto.
    expect(toolsFor("expert").length).toBeGreaterThanOrEqual(toolsFor("essential").length);
    expect(DEFAULT_TOOL).toBe("pen");
  });

  it("dà alle annotazioni di un PDF penna, evidenziatore e gomma all'Essenziale, e note, forme e copertura allo Standard", () => {
    expect(toolsFor("essential", "pdf").map((tool) => tool.id)).toEqual(["select", "pen", "highlighter", "eraser"]);
    expect(toolsFor("standard", "pdf").map((tool) => tool.id)).toEqual([
      "select", "pen", "highlighter", "eraser", "note", "rect", "ellipse", "line", "arrow", "cover",
    ]);
    // Il disegno non cambia: evidenziatore, note e copertura sono del PDF.
    expect(toolsFor("expert", "vector").map((tool) => tool.id)).toEqual(["select", "pen", "eraser", "rect", "ellipse", "line", "arrow"]);
    expect(defaultTool("vector")).toBe("pen");
    expect(defaultTool("pdf")).toBe("highlighter");
  });

  it("dà a ogni strumento un tasto suo, una lettera minuscola", () => {
    const keys = TOOLS.map((tool) => tool.shortcut);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z]$/);
  });

  it("trova lo strumento di un tasto, maiuscolo o minuscolo", () => {
    const tools = toolsFor("essential");
    expect(toolForKey(tools, "r")?.id).toBe("rect");
    expect(toolForKey(tools, "R")?.id).toBe("rect");
    expect(toolForKey(tools, "x")).toBeNull();
    expect(toolForKey(tools, "Enter")).toBeNull();
  });

  it("nomina etichetta e descrizione diverse per ogni strumento", () => {
    for (const tool of TOOLS) {
      expect(toolSpec(tool.id)).toBe(tool);
      expect(tool.description).not.toBe(tool.label);
    }
  });

  it("nomina icone che non sono della shell, così l'editor le può registrare", () => {
    // `trash` è della shell; le altre arrivano con l'editor.
    for (const tool of TOOLS) expect(icon(tool.icon), tool.icon).toBe("");
  });
});
