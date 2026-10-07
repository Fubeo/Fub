// Il registro degli strumenti: che cosa offre ogni livello, e con quali tasti.

import { describe, expect, it } from "vitest";
import { icon } from "../../../ui/icons";
import {
  CUSTOM_DEFAULT,
  DEFAULT_TOOL,
  FEATURES,
  featuresFor,
  isFeature,
  isLevel,
  levelsAbove,
  reaches,
  startTool,
  toolAfter,
  TOOLS,
  toolForKey,
  toolsFor,
  toolsOf,
  toolSpec,
} from "./registry";

describe("il registro degli strumenti", () => {
  it("dà all'Essenziale i sette strumenti, nell'ordine della barra", () => {
    expect(toolsFor("essential").map((tool) => tool.id)).toEqual(["select", "pen", "eraser", "rect", "ellipse", "line", "arrow"]);
    // Un livello sopra vede anche quelli sotto.
    expect(toolsFor("expert").length).toBeGreaterThanOrEqual(toolsFor("essential").length);
    expect(DEFAULT_TOOL).toBe("pen");
  });

  it("aggiunge allo Standard il lazo accanto alla selezione, l'evidenziatore dopo la penna, il poligono dopo le forme e il testo in fondo", () => {
    expect(toolsFor("standard").map((tool) => tool.id)).toEqual(["select", "lasso", "pen", "highlighter", "eraser", "rect", "ellipse", "line", "arrow", "polygon", "text"]);
    // Il tasto del lazo è quello di Illustrator.
    expect(toolSpec("lasso")).toMatchObject({ level: "standard", group: "pick", shortcut: "q" });
    expect(toolForKey(toolsFor("essential"), "q")).toBeNull();
    expect(toolSpec("highlighter").shortcut).toBe("h");
    expect(toolSpec("text").shortcut).toBe("t");
    // Il tasto del poligono è quello di CorelDRAW.
    expect(toolSpec("polygon")).toMatchObject({ level: "standard", group: "shape", shortcut: "y" });
    expect(toolForKey(toolsFor("essential"), "y")).toBeNull();
    expect(reaches("standard", "essential")).toBe(true);
    expect(reaches("standard", "standard")).toBe(true);
    expect(reaches("standard", "expert")).toBe(false);
    expect(reaches("essential", "standard")).toBe(false);
  });

  it("aggiunge all'Esperto i nodi e il Costruttore accanto alla selezione e la penna di Bézier dopo le forme", () => {
    expect(toolsFor("expert").map((tool) => tool.id)).toEqual([
      "select", "lasso", "nodes", "builder", "scissors", "width", "pen", "highlighter", "eraser", "rect", "ellipse", "line", "arrow", "polygon", "bezier", "text",
    ]);
    expect(toolSpec("nodes")).toMatchObject({ level: "expert", group: "pick", shortcut: "n" });
    expect(toolSpec("bezier")).toMatchObject({ level: "expert", group: "shape", shortcut: "b" });
    expect(toolForKey(toolsFor("standard"), "n")).toBeNull();
    expect(toolForKey(toolsFor("standard"), "b")).toBeNull();
    expect(toolForKey(toolsFor("expert"), "N")?.id).toBe("nodes");
    expect(toolForKey(toolsFor("expert"), "B")?.id).toBe("bezier");
    // Il Costruttore ha la lettera di Illustrator, senza Maiusc.
    expect(toolSpec("builder")).toMatchObject({ level: "expert", group: "pick", shortcut: "m" });
    expect(toolForKey(toolsFor("standard"), "m")).toBeNull();
    expect(toolForKey(toolsFor("expert"), "M")?.id).toBe("builder");
    expect(toolAfter(toolsFor("expert"), "builder")).toBe("select");
    // Le Forbici anche.
    expect(toolSpec("scissors")).toMatchObject({ level: "expert", group: "pick", shortcut: "c" });
    expect(toolForKey(toolsFor("standard"), "c")).toBeNull();
    expect(toolForKey(toolsFor("expert"), "C")?.id).toBe("scissors");
    // E lo Spessore, che in Illustrator è Maiusc+W.
    expect(toolSpec("width")).toMatchObject({ level: "expert", group: "pick", shortcut: "w" });
    expect(toolForKey(toolsFor("standard"), "w")).toBeNull();
    expect(toolForKey(toolsFor("expert"), "W")?.id).toBe("width");
  });

  it("riconosce i nomi dei livelli, e sa quali stanno sopra", () => {
    expect(["essential", "standard", "expert", "custom"].every(isLevel)).toBe(true);
    for (const other of ["Standard", "", "beginner", 1, null, undefined]) expect(isLevel(other)).toBe(false);
    expect(levelsAbove("essential")).toEqual(["standard", "expert"]);
    expect(levelsAbove("standard")).toEqual(["expert"]);
    expect(levelsAbove("expert")).toEqual([]);
    // Al Personalizzato può mancare una parte di ogni livello.
    expect(levelsAbove("custom")).toEqual(["essential", "standard", "expert"]);
  });

  it("elenca le parti per livello, prima gli strumenti nell'ordine della barra, ciascuna una volta", () => {
    expect(FEATURES.map((feature) => feature.id)).toEqual([
      "pen", "eraser", "rect", "ellipse", "line", "arrow",
      "lasso", "highlighter", "polygon", "text", "colors", "selection", "arrange", "layers", "grid", "guides", "rulers", "recognize", "gestures", "links", "images", "properties", "style", "history", "accessibility",
      "nodes", "builder", "scissors", "width", "bezier", "attributes", "outline", "transform", "apply", "path", "boolean", "trace", "typeset",
    ]);
    expect(new Set(FEATURES.map((feature) => feature.label)).size).toBe(FEATURES.length);
    // Ogni strumento è una parte, tranne la Selezione, che c'è sempre.
    for (const tool of TOOLS) expect(isFeature(tool.id)).toBe(tool.id !== "select");
    for (const other of ["select", "Pen", "", 1, null]) expect(isFeature(other)).toBe(false);
  });

  it("dà a un livello pronto le sue parti e quelle sotto, e al Personalizzato quelle scelte che conosce", () => {
    expect([...featuresFor("essential")]).toEqual(CUSTOM_DEFAULT);
    expect(featuresFor("standard").has("layers")).toBe(true);
    expect(featuresFor("standard").has("nodes")).toBe(false);
    expect(featuresFor("expert").size).toBe(FEATURES.length);
    expect([...featuresFor("custom", ["boolean", "pen", "futuro", 3, "select"])]).toEqual(["boolean", "pen"]);
    // Senza una scelta, il Personalizzato parte dall'Essenziale.
    expect(featuresFor("custom")).toEqual(featuresFor("essential"));
    expect(CUSTOM_DEFAULT).toEqual(["pen", "eraser", "rect", "ellipse", "line", "arrow"]);
  });

  it("dà sempre la Selezione, e comincia dalla penna o dal primo strumento che disegna", () => {
    expect(toolsOf(new Set()).map((tool) => tool.id)).toEqual(["select"]);
    expect(toolsOf(featuresFor("custom", ["text", "nodes"])).map((tool) => tool.id)).toEqual(["select", "nodes", "text"]);
    expect(startTool(toolsFor("essential"))).toBe(DEFAULT_TOOL);
    expect(startTool(toolsOf(featuresFor("custom", ["text", "nodes", "ellipse"])))).toBe("ellipse");
    expect(startTool(toolsOf(featuresFor("custom", ["nodes"])))).toBe("select");
  });

  it("dopo uno strumento che sceglie riprende la Selezione, dopo gli altri lo strumento di partenza", () => {
    expect(toolAfter(toolsFor("essential"), "lasso")).toBe("select");
    expect(toolAfter(toolsFor("standard"), "nodes")).toBe("select");
    expect(toolAfter(toolsFor("essential"), "highlighter")).toBe(DEFAULT_TOOL);
    expect(toolAfter(toolsOf(featuresFor("custom", ["text"])), "pen")).toBe("text");
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
