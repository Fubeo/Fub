import { describe, expect, it } from "vitest";
import { importedName, sourceOf } from "./sources";

describe("sourceOf", () => {
  it("riconosce le estensioni dei due programmi, maiuscole comprese", () => {
    const names = ["a.excalidraw", "A.Excalidraw.JSON", "a.drawio", "a.dio", "a.drawio.xml", "a.drawio.svg", "a.DRAWIO.PNG", "a.json", "a.svg", "a.png", "a.xml", "excalidraw"];
    expect(names.map(sourceOf)).toEqual(["excalidraw", "excalidraw", "drawio", "drawio", "drawio", "drawio", "drawio", null, null, null, null, null]);
  });
});

describe("importedName", () => {
  it("toglie la cartella e l'estensione intera del programma", () => {
    expect(["schemi/rete.drawio", "a/b/flusso.drawio.png", "Lavagna.Excalidraw.json", "idea.excalidraw", "x.dio"].map(importedName)).toEqual(["rete", "flusso", "Lavagna", "idea", "x"]);
  });

  it("di un altro nome toglie l'ultima estensione, e tiene un nome che comincia col punto", () => {
    expect(["export.json", "schema.v2.xml", "senza", ".drawio", " spazi .svg"].map(importedName)).toEqual(["export", "schema.v2", "senza", ".drawio", "spazi"]);
  });
});
