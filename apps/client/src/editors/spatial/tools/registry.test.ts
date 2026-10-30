// Il registro degli strumenti: che cosa offre ogni livello di ogni profilo, e
// con quali tasti.

import { describe, expect, it } from "vitest";
import { icon } from "../../../ui/icons";
import {
  CUSTOM_DEFAULT,
  DEFAULT_TOOL,
  defaultTool,
  FEATURES,
  featuresFor,
  isFeature,
  isLevel,
  isViewTool,
  isWorkspace,
  levelsAbove,
  reaches,
  startTool,
  toolAfter,
  TOOLS,
  toolForKey,
  SIMPLE_PARTS,
  workspaceLevel,
  workspaceOfLevel,
  WORKSPACES,
  toolsFor,
  toolsOf,
  toolSpec,
} from "./registry";

describe("il registro degli strumenti", () => {
  it("dà all'Essenziale i sette strumenti, nell'ordine della barra", () => {
    expect(toolsFor("essential").map((tool) => tool.id)).toEqual(["select", "hand", "zoom", "pen", "eraser", "rect", "ellipse", "line", "arrow"]);
    // Un livello sopra vede anche quelli sotto.
    expect(toolsFor("expert").length).toBeGreaterThanOrEqual(toolsFor("essential").length);
    expect(DEFAULT_TOOL).toBe("pen");
  });

  it("dà alle annotazioni di un PDF penna, evidenziatore e gomma all'Essenziale, e note, forme e copertura allo Standard", () => {
    expect(toolsFor("essential", "pdf").map((tool) => tool.id)).toEqual(["select", "hand", "zoom", "pen", "highlighter", "eraser"]);
    expect(toolsFor("standard", "pdf").map((tool) => tool.id)).toEqual([
      "select", "hand", "zoom", "pen", "highlighter", "eraser", "note", "rect", "ellipse", "line", "arrow", "cover",
    ]);
    // L'Esperto e il Personalizzato non aggiungono niente, e nessun comando.
    expect(toolsFor("expert", "pdf")).toEqual(toolsFor("standard", "pdf"));
    expect(featuresFor("custom", ["layers", "text"], "pdf")).toEqual(featuresFor("standard", [], "pdf"));
    expect([...featuresFor("expert", [], "pdf")].some((feature) => FEATURES.some((spec) => spec.id === feature && !TOOLS.some((tool) => tool.id === feature)))).toBe(false);
    // Note e copertura non sono del disegno, né parti del Personalizzato.
    expect(toolsFor("expert", "vector").some((tool) => tool.id === "note" || tool.id === "cover")).toBe(false);
    expect(isFeature("note")).toBe(false);
    expect(isFeature("cover")).toBe(false);
    expect(defaultTool("vector")).toBe("pen");
    expect(defaultTool("pdf")).toBe("highlighter");
    expect(startTool(toolsFor("essential", "pdf"), "pdf")).toBe("highlighter");
    expect(toolAfter(toolsFor("standard", "pdf"), "cover", "pdf")).toBe("highlighter");
    // La «N» e la «C» sono delle note e della copertura nel PDF; nel
    // disegno non sono di nessuno.
    expect(toolForKey(toolsFor("standard", "pdf"), "n")?.id).toBe("note");
    expect(toolForKey(toolsFor("standard", "pdf"), "C")?.id).toBe("cover");
    expect(toolForKey(toolsFor("standard"), "n")).toBeNull();
    expect(toolForKey(toolsFor("standard"), "c")).toBeNull();
  });

  it("aggiunge allo Standard il lazo, la Tavola, il contagocce e la Sfumatura accanto alla selezione, l'evidenziatore dopo la penna, il Connettore dopo la freccia, il poligono dopo il Connettore e il testo in fondo", () => {
    expect(toolsFor("standard").map((tool) => tool.id)).toEqual([
      "select", "hand", "zoom", "lasso", "board", "eyedropper", "gradient", "pen", "highlighter", "eraser", "rect", "ellipse", "line", "arrow", "connector", "polygon", "text",
    ]);
    // Il tasto del lazo è quello di Illustrator.
    expect(toolSpec("lasso")).toMatchObject({ levels: { vector: "standard" }, group: "pick", shortcut: "q" });
    expect(toolForKey(toolsFor("essential"), "q")).toBeNull();
    expect(toolSpec("highlighter").shortcut).toBe("Shift-p");
    expect(toolSpec("text").shortcut).toBe("t");
    // Il tasto del poligono è quello di CorelDRAW.
    expect(toolSpec("polygon")).toMatchObject({ levels: { vector: "standard" }, group: "shape", shortcut: "y" });
    expect(toolForKey(toolsFor("essential"), "y")).toBeNull();
    // Il tasto della Tavola è quello del Frame di Figma.
    expect(toolSpec("board")).toMatchObject({ levels: { vector: "standard" }, group: "pick", shortcut: "f" });
    expect(toolForKey(toolsFor("essential"), "f")).toBeNull();
    expect(toolForKey(toolsFor("standard"), "F")?.id).toBe("board");
    // Quello del contagocce è di Illustrator e di Photoshop.
    expect(toolSpec("eyedropper")).toMatchObject({ levels: { vector: "standard" }, group: "pick", shortcut: "i" });
    expect(toolForKey(toolsFor("essential"), "i")).toBeNull();
    expect(toolForKey(toolsFor("standard"), "I")?.id).toBe("eyedropper");
    // E quello della Sfumatura è di Illustrator.
    expect(toolSpec("gradient")).toMatchObject({ levels: { vector: "standard" }, group: "pick", shortcut: "g" });
    expect(toolForKey(toolsFor("essential"), "g")).toBeNull();
    expect(toolForKey(toolsFor("standard"), "G")?.id).toBe("gradient");
    // Il Connettore è una forma, sulla X.
    expect(toolSpec("connector")).toMatchObject({ levels: { vector: "standard" }, group: "shape", shortcut: "x" });
    expect(toolForKey(toolsFor("essential"), "x")).toBeNull();
    expect(toolForKey(toolsFor("standard"), "X")?.id).toBe("connector");
    expect(reaches("standard", "essential")).toBe(true);
    expect(reaches("standard", "standard")).toBe(true);
    expect(reaches("standard", "expert")).toBe(false);
    expect(reaches("essential", "standard")).toBe(false);
  });

  it("all'Esperto non aggiunge più niente: i suoi strumenti se ne sono andati (ADR 0231)", () => {
    expect(toolsFor("expert").map((tool) => tool.id)).toEqual(toolsFor("standard").map((tool) => tool.id));
    expect([...featuresFor("expert")]).toEqual([...featuresFor("standard")]);
    for (const key of ["a", "n", "b", "m", "c", "w"]) expect(toolForKey(toolsFor("expert"), key)).toBeNull();
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
      "lasso", "board", "eyedropper", "gradient", "highlighter", "connector", "polygon", "text", "colors", "swatches", "styles", "tips", "hatches", "selection", "arrange", "layers", "grid", "guides", "rulers", "recognize", "symmetry", "gestures", "links", "images", "crop", "library", "properties", "style", "history", "accessibility", "export", "present",
    ]);
    expect(new Set(FEATURES.map((feature) => feature.label)).size).toBe(FEATURES.length);
    // Ogni strumento del disegno è una parte, tranne quelli della vista
    // (Selezione, Mano e Lente), che ci sono sempre. Quelli delle sole
    // annotazioni di un PDF no: il Personalizzato è del disegno.
    for (const tool of TOOLS) expect(isFeature(tool.id)).toBe(!isViewTool(tool.id) && tool.levels.vector !== undefined);
    for (const other of ["select", "hand", "zoom", "Pen", "", 1, null]) expect(isFeature(other)).toBe(false);
  });

  it("dà a un livello pronto le sue parti e quelle sotto, e al Personalizzato quelle scelte che conosce", () => {
    expect([...featuresFor("essential")]).toEqual(CUSTOM_DEFAULT);
    expect(featuresFor("standard").has("layers")).toBe(true);
    expect(featuresFor("expert").size).toBe(FEATURES.length);
    expect([...featuresFor("custom", ["boolean", "pen", "futuro", 3, "select"])]).toEqual(["pen"]);
    // Senza una scelta, il Personalizzato parte dall'Essenziale.
    expect(featuresFor("custom")).toEqual(featuresFor("essential"));
    expect(CUSTOM_DEFAULT).toEqual(["pen", "eraser", "rect", "ellipse", "line", "arrow"]);
  });

  it("offre lo spazio Completo con tutte le parti, e il Semplice con quelle per disegnare a mano", () => {
    expect(WORKSPACES).toEqual(["full", "simple"]);
    for (const each of WORKSPACES) expect(isWorkspace(each)).toBe(true);
    for (const other of ["Full", "", "essential", 1, null]) expect(isWorkspace(other)).toBe(false);
    expect(SIMPLE_PARTS).toEqual(["pen", "eraser", "rect", "ellipse", "line", "arrow", "highlighter", "text", "colors", "gestures", "images", "properties", "export"]);
    const full = workspaceLevel("full");
    expect(featuresFor(full.level, full.custom).size, "Completo non nasconde niente").toBe(FEATURES.length);
    const simple = workspaceLevel("simple");
    expect([...featuresFor(simple.level, simple.custom)]).toEqual(SIMPLE_PARTS);
    expect(toolsOf(featuresFor(simple.level, simple.custom)).map((tool) => tool.id)).toEqual([
      "select", "hand", "zoom", "pen", "highlighter", "eraser", "rect", "ellipse", "line", "arrow", "text",
    ]);
    // Nelle annotazioni di un PDF il Semplice è l'Essenziale.
    expect(workspaceLevel("simple", "pdf").level).toBe("essential");
    // Un livello delle versioni precedenti: l'Essenziale è Semplice.
    expect(workspaceOfLevel("essential")).toBe("simple");
    for (const level of ["standard", "expert", "custom"] as const) expect(workspaceOfLevel(level)).toBe("full");
  });

  it("dà sempre la Selezione, la Mano e la Lente, e comincia dalla penna o dal primo strumento che disegna", () => {
    expect(toolsOf(new Set()).map((tool) => tool.id)).toEqual(["select", "hand", "zoom"]);
    expect(toolsOf(featuresFor("custom", ["text", "lasso"])).map((tool) => tool.id)).toEqual(["select", "hand", "zoom", "lasso", "text"]);
    expect(startTool(toolsFor("essential"))).toBe(DEFAULT_TOOL);
    expect(startTool(toolsOf(featuresFor("custom", ["text", "lasso", "ellipse"])))).toBe("ellipse");
    expect(startTool(toolsOf(featuresFor("custom", ["lasso"])))).toBe("select");
  });

  it("dopo uno strumento che sceglie riprende la Selezione, dopo gli altri lo strumento di partenza", () => {
    expect(toolAfter(toolsFor("essential"), "lasso")).toBe("select");
    expect(toolAfter(toolsFor("standard"), "board")).toBe("select");
    expect(toolAfter(toolsFor("essential"), "highlighter")).toBe(DEFAULT_TOOL);
    expect(toolAfter(toolsOf(featuresFor("custom", ["text"])), "pen")).toBe("text");
  });

  it("dà a ogni strumento un tasto suo nel profilo, una lettera minuscola, con Maiuscolo o no", () => {
    for (const profile of ["vector", "pdf"] as const) {
      const keys = toolsFor("expert", profile).flatMap((tool) => [tool.shortcut, ...(tool.aliases ?? [])]);
      expect(new Set(keys).size, profile).toBe(keys.length);
    }
    for (const tool of TOOLS) expect(tool.shortcut).toMatch(/^(Shift-)?[a-z]$/);
    for (const tool of TOOLS) for (const alias of tool.aliases ?? []) expect(alias).toMatch(/^(Shift-)?[a-z]$/);
    // Ogni strumento c'è almeno in un profilo.
    for (const tool of TOOLS) expect(Object.keys(tool.levels).length, tool.id).toBeGreaterThan(0);
  });

  it("trova lo strumento di un tasto, maiuscolo o minuscolo", () => {
    const tools = toolsFor("essential");
    expect(toolForKey(tools, "r")?.id).toBe("rect");
    expect(toolForKey(tools, "R")?.id).toBe("rect");
    expect(toolForKey(tools, "x")).toBeNull();
    expect(toolForKey(tools, "Enter")).toBeNull();
    // I tasti della grafica: Maiuscolo con L per la freccia.
    expect(toolForKey(tools, "l")?.id).toBe("line");
    expect(toolForKey(tools, "L", true)?.id).toBe("arrow");
    const expert = toolsFor("expert");
    expect(toolForKey(expert, "a")).toBeNull();
    expect(toolForKey(expert, "P", true)?.id).toBe("highlighter");
    // H e Z sono la Mano e la Lente, come in Illustrator e Affinity.
    expect(toolForKey(expert, "h")?.id).toBe("hand");
    expect(toolForKey(tools, "Z")?.id).toBe("zoom");
    expect(toolForKey(expert, "H", true)).toBeNull();
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
