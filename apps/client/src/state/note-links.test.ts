import { describe, expect, it } from "vitest";

import { linkPreferenceOf, markdownDestination, wikiPathCandidates } from "./note-links";

describe("come nasce il link a una nota", () => {
  it("legge la preferenza del vault e torna al default su un valore sconosciuto", () => {
    const of = (values: Record<string, unknown>) => linkPreferenceOf((key) => values[key]);
    expect(of({})).toEqual({ style: "wiki", format: "shortest" });
    expect(of({ "files.link-style": "markdown", "files.link-format": "absolute" })).toEqual({ style: "markdown", format: "absolute" });
    expect(of({ "files.link-style": "html", "files.link-format": "corto" })).toEqual({ style: "wiki", format: "shortest" });
  });

  it("un link Markdown è relativo alla nota, o parte dalla radice con la barra", () => {
    expect(markdownDestination("Diario/oggi.md", "Progetti/Alpha beta.md", "relative")).toBe("../Progetti/Alpha%20beta.md");
    expect(markdownDestination("Diario/oggi.md", "Progetti/Alpha beta.md", "shortest")).toBe("../Progetti/Alpha%20beta.md");
    expect(markdownDestination("Diario/oggi.md", "Progetti/Alpha beta.md", "absolute")).toBe("/Progetti/Alpha%20beta.md");
    expect(markdownDestination("Diario/oggi.md", "Diario/ieri.md", "relative")).toBe("ieri.md");
  });

  it("un wikilink per percorso prova prima senza estensione", () => {
    expect(wikiPathCandidates("Progetti/Alpha.md")).toEqual(["Progetti/Alpha", "Progetti/Alpha.md"]);
    expect(wikiPathCandidates("Progetti/tavola")).toEqual(["Progetti/tavola"]);
  });
});
