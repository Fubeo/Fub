// Il registro degli strumenti: che cosa offre ogni spazio di ogni profilo, e
// con quali tasti.

import { describe, expect, it } from "vitest";
import { icon } from "../../../ui/icons";
import {
  DEFAULT_TOOL,
  defaultTool,
  FEATURES,
  featuresFor,
  isViewTool,
  isWorkspace,
  startTool,
  toolAfter,
  TOOLS,
  toolForKey,
  WORKSPACES,
  toolsFor,
  toolsOf,
  toolSpec,
} from "./registry";
import * as registry from "./registry";

describe("il registro degli strumenti", () => {
  it("dà al disegno, nel Completo come nel Semplice, i dieci strumenti nell'ordine della barra", () => {
    const ids = ["select", "hand", "zoom", "pen", "highlighter", "eraser", "rect", "ellipse", "line", "arrow"];
    expect(toolsFor("full").map((tool) => tool.id)).toEqual(ids);
    expect(toolsFor("simple").map((tool) => tool.id)).toEqual(ids);
    expect(toolsFor().map((tool) => tool.id), "il Completo è quello di serie").toEqual(ids);
    expect(DEFAULT_TOOL).toBe("pen");
    expect(toolSpec("highlighter").shortcut).toBe("Shift-p");
    // Le lettere degli strumenti che se ne sono andati non sono di nessuno
    // (ADR 0231).
    for (const key of ["q", "f", "i", "g", "x", "y", "t", "a", "n", "b", "m", "c", "w"]) expect(toolForKey(toolsFor("full"), key), key).toBeNull();
  });

  it("dà alle annotazioni di un PDF penna, evidenziatore e gomma nel Semplice, e note, forme e copertura nel Completo", () => {
    expect(toolsFor("simple", "pdf").map((tool) => tool.id)).toEqual(["select", "hand", "zoom", "pen", "highlighter", "eraser"]);
    expect(toolsFor("full", "pdf").map((tool) => tool.id)).toEqual([
      "select", "hand", "zoom", "pen", "highlighter", "eraser", "note", "rect", "ellipse", "line", "arrow", "cover",
    ]);
    // Nessun comando, soltanto strumenti.
    expect([...featuresFor("full", "pdf")].every((feature) => TOOLS.some((tool) => tool.id === feature))).toBe(true);
    // Note e copertura non sono del disegno, né sue parti.
    expect(toolsFor("full", "vector").some((tool) => tool.id === "note" || tool.id === "cover")).toBe(false);
    expect(FEATURES.some((feature) => feature.id === "note" || feature.id === "cover")).toBe(false);
    expect(defaultTool("vector")).toBe("pen");
    expect(defaultTool("pdf")).toBe("highlighter");
    expect(startTool(toolsFor("simple", "pdf"), "pdf")).toBe("highlighter");
    expect(toolAfter(toolsFor("full", "pdf"), "cover", "pdf")).toBe("highlighter");
    // La «N» e la «C» sono delle note e della copertura nel PDF; nel
    // disegno non sono di nessuno.
    expect(toolForKey(toolsFor("full", "pdf"), "n")?.id).toBe("note");
    expect(toolForKey(toolsFor("full", "pdf"), "C")?.id).toBe("cover");
    expect(toolForKey(toolsFor("full"), "n")).toBeNull();
    expect(toolForKey(toolsFor("full"), "c")).toBeNull();
  });

  it("non conosce livelli: niente nomi, niente Personalizzato (ADR 0231)", () => {
    for (const gone of ["isLevel", "levelsAbove", "reaches", "CUSTOM_DEFAULT", "workspaceLevel", "workspaceOfLevel", "SIMPLE_PARTS", "isFeature"]) {
      expect(gone in registry, gone).toBe(false);
    }
    for (const tool of TOOLS) expect("levels" in tool, tool.id).toBe(false);
    for (const feature of FEATURES) expect("level" in feature, feature.id).toBe(false);
  });

  it("elenca le parti, prima gli strumenti nell'ordine della barra, poi i comandi, ciascuna una volta", () => {
    expect(FEATURES.map((feature) => feature.id)).toEqual([
      "pen", "highlighter", "eraser", "rect", "ellipse", "line", "arrow",
      "colors", "tips", "selection", "arrange", "layers", "grid", "recognize", "gestures", "links", "images", "properties", "style", "history", "accessibility", "export",
    ]);
    expect(new Set(FEATURES.map((feature) => feature.label)).size).toBe(FEATURES.length);
    // Ogni strumento del disegno è una parte, tranne quelli della vista
    // (Selezione, Mano e Lente), che ci sono sempre.
    for (const tool of TOOLS) expect(FEATURES.some((feature) => feature.id === tool.id), tool.id).toBe(!isViewTool(tool.id) && tool.spaces.vector !== undefined);
  });

  it("offre lo spazio Completo con tutte le parti, e il Semplice con quelle per disegnare a mano", () => {
    expect(WORKSPACES).toEqual(["full", "simple"]);
    for (const each of WORKSPACES) expect(isWorkspace(each)).toBe(true);
    for (const other of ["Full", "", "essential", 1, null]) expect(isWorkspace(other)).toBe(false);
    expect(featuresFor("full").size, "Completo non nasconde niente").toBe(FEATURES.length);
    expect([...featuresFor("simple")]).toEqual(["pen", "highlighter", "eraser", "rect", "ellipse", "line", "arrow", "colors", "gestures", "images", "properties", "export"]);
  });

  it("dà sempre la Selezione, la Mano e la Lente, e comincia dalla penna o dal primo strumento che disegna", () => {
    expect(toolsOf(new Set()).map((tool) => tool.id)).toEqual(["select", "hand", "zoom"]);
    expect(toolsOf(new Set(["highlighter", "layers"])).map((tool) => tool.id)).toEqual(["select", "hand", "zoom", "highlighter"]);
    expect(startTool(toolsFor("simple"))).toBe(DEFAULT_TOOL);
    expect(startTool(toolsOf(new Set(["layers", "ellipse"])))).toBe("ellipse");
    expect(startTool(toolsOf(new Set(["layers"])))).toBe("select");
  });

  it("dopo uno strumento che sceglie riprende la Selezione, dopo gli altri lo strumento di partenza", () => {
    expect(toolAfter(toolsFor("simple"), "zoom")).toBe("select");
    expect(toolAfter(toolsFor("simple"), "highlighter")).toBe(DEFAULT_TOOL);
    expect(toolAfter(toolsOf(new Set(["highlighter"])), "pen")).toBe("highlighter");
  });

  it("dà a ogni strumento un tasto suo nel profilo, una lettera minuscola, con Maiuscolo o no", () => {
    for (const profile of ["vector", "pdf"] as const) {
      const keys = toolsFor("full", profile).flatMap((tool) => [tool.shortcut, ...(tool.aliases ?? [])]);
      expect(new Set(keys).size, profile).toBe(keys.length);
    }
    for (const tool of TOOLS) expect(tool.shortcut).toMatch(/^(Shift-)?[a-z]$/);
    for (const tool of TOOLS) for (const alias of tool.aliases ?? []) expect(alias).toMatch(/^(Shift-)?[a-z]$/);
    // Ogni strumento c'è almeno in un profilo.
    for (const tool of TOOLS) expect(Object.keys(tool.spaces).length, tool.id).toBeGreaterThan(0);
  });

  it("trova lo strumento di un tasto, maiuscolo o minuscolo", () => {
    const tools = toolsFor("simple");
    expect(toolForKey(tools, "r")?.id).toBe("rect");
    expect(toolForKey(tools, "R")?.id).toBe("rect");
    expect(toolForKey(tools, "x")).toBeNull();
    expect(toolForKey(tools, "Enter")).toBeNull();
    // I tasti della grafica: Maiuscolo con L per la freccia.
    expect(toolForKey(tools, "l")?.id).toBe("line");
    expect(toolForKey(tools, "L", true)?.id).toBe("arrow");
    const full = toolsFor("full");
    expect(toolForKey(full, "a")).toBeNull();
    expect(toolForKey(full, "P", true)?.id).toBe("highlighter");
    // H e Z sono la Mano e la Lente, come in Illustrator e Affinity.
    expect(toolForKey(full, "h")?.id).toBe("hand");
    expect(toolForKey(tools, "Z")?.id).toBe("zoom");
    expect(toolForKey(full, "H", true)).toBeNull();
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
