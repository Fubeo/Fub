// Il registro degli strumenti: che cosa offre ogni livello, e con quali tasti.

import { describe, expect, it } from "vitest";
import { icon } from "../../../ui/icons";
import { DEFAULT_TOOL, isLevel, levelsAbove, reaches, TOOLS, toolForKey, toolsFor, toolSpec } from "./registry";

describe("il registro degli strumenti", () => {
  it("dà all'Essenziale i sette strumenti, nell'ordine della barra", () => {
    expect(toolsFor("essential").map((tool) => tool.id)).toEqual(["select", "pen", "eraser", "rect", "ellipse", "line", "arrow"]);
    // Un livello sopra vede anche quelli sotto.
    expect(toolsFor("expert").length).toBeGreaterThanOrEqual(toolsFor("essential").length);
    expect(DEFAULT_TOOL).toBe("pen");
  });

  it("aggiunge allo Standard l'evidenziatore, dopo la penna, e il testo in fondo", () => {
    expect(toolsFor("standard").map((tool) => tool.id)).toEqual(["select", "pen", "highlighter", "eraser", "rect", "ellipse", "line", "arrow", "text"]);
    expect(toolSpec("highlighter").shortcut).toBe("h");
    expect(toolSpec("text").shortcut).toBe("t");
    expect(reaches("standard", "essential")).toBe(true);
    expect(reaches("standard", "standard")).toBe(true);
    expect(reaches("standard", "expert")).toBe(false);
    expect(reaches("essential", "standard")).toBe(false);
  });

  it("aggiunge all'Esperto i nodi accanto alla selezione e la penna di Bézier dopo le forme, coi tasti di Inkscape", () => {
    expect(toolsFor("expert").map((tool) => tool.id)).toEqual(["select", "nodes", "pen", "highlighter", "eraser", "rect", "ellipse", "line", "arrow", "bezier", "text"]);
    expect(toolSpec("nodes")).toMatchObject({ level: "expert", group: "pick", shortcut: "n" });
    expect(toolSpec("bezier")).toMatchObject({ level: "expert", group: "shape", shortcut: "b" });
    expect(toolForKey(toolsFor("standard"), "n")).toBeNull();
    expect(toolForKey(toolsFor("standard"), "b")).toBeNull();
    expect(toolForKey(toolsFor("expert"), "N")?.id).toBe("nodes");
    expect(toolForKey(toolsFor("expert"), "B")?.id).toBe("bezier");
  });

  it("riconosce i nomi dei livelli, e sa quali stanno sopra", () => {
    expect(["essential", "standard", "expert"].every(isLevel)).toBe(true);
    for (const other of ["Standard", "", "beginner", 1, null, undefined]) expect(isLevel(other)).toBe(false);
    expect(levelsAbove("essential")).toEqual(["standard", "expert"]);
    expect(levelsAbove("standard")).toEqual(["expert"]);
    expect(levelsAbove("expert")).toEqual([]);
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
