// @vitest-environment happy-dom
// I modelli di diagramma: quattordici tipi, ognuno un diagramma che Mermaid
// accetta davvero in tutte e due le lingue, trovati per tipo o per nome.

import { describe, expect, it } from "vitest";
import mermaid from "mermaid";
import { DIAGRAM_TEMPLATES, matchTemplates, templateText } from "./diagram-templates";
import { catalogFor, t } from "../../../../i18n/strings";

const ids = (found: readonly { id: string }[]) => found.map((template) => template.id);

describe("i modelli di diagramma", () => {
  it("sono quattordici tipi diversi, e ogni corpo comincia col suo tipo", () => {
    expect(ids(DIAGRAM_TEMPLATES)).toEqual([
      "flowchart", "sequence", "class", "state", "er", "gantt", "pie",
      "mindmap", "timeline", "git", "journey", "quadrant", "xychart", "sankey",
    ]);
    expect(new Set(DIAGRAM_TEMPLATES.map((template) => template.keyword)).size).toBe(14);
    for (const template of DIAGRAM_TEMPLATES) {
      for (const body of [template.body.it, template.body.en]) {
        expect(body.split(/\s/)[0], template.id).toBe(template.keyword);
        expect(body.endsWith("\n"), template.id).toBe(false);
      }
    }
  });

  it("ogni corpo, in italiano e in inglese, è un diagramma che Mermaid accetta", async () => {
    mermaid.initialize({ startOnLoad: false });
    // Il parser rifiuta davvero: senza, la prova sotto passerebbe a vuoto.
    expect(await mermaid.parse("flowchart LR\n  A -->", { suppressErrors: true })).toBe(false);
    for (const template of DIAGRAM_TEMPLATES) {
      for (const language of ["it", "en"]) {
        const parsed = await mermaid.parse(templateText(template, language), { suppressErrors: true });
        expect(parsed, `${template.id} in ${language}`).not.toBe(false);
      }
    }
  });

  it("hanno nome e descrizione in ogni catalogo", () => {
    for (const language of ["it", "en"]) {
      const catalog = catalogFor(language);
      for (const template of DIAGRAM_TEMPLATES) {
        expect(catalog[template.name], `${template.name} in ${language}`).toBeTruthy();
        expect(catalog[template.description], `${template.description} in ${language}`).toBeTruthy();
      }
    }
    expect(t("mermaid.template.pie")).toBe("Torta");
  });
});

describe("la scelta di un modello da ciò che si scrive", () => {
  const name = (template: (typeof DIAGRAM_TEMPLATES)[number]) => t(template.name);

  it("una parola vuota li vuole tutti, nell'ordine della lista", () => {
    expect(ids(matchTemplates("", name))).toEqual(ids(DIAGRAM_TEMPLATES));
    expect(ids(matchTemplates("   ", name))).toEqual(ids(DIAGRAM_TEMPLATES));
  });

  it("prima il tipo che comincia così, poi i nomi, poi chi la contiene", () => {
    expect(ids(matchTemplates("seq", name))).toEqual(["sequence"]);
    expect(ids(matchTemplates("st", name))[0]).toBe("state");
    // `flowchart` per tipo; poi i nomi e gli alias che cominciano con `fl`
    // (Sankey: `flussi`, `flows`).
    expect(ids(matchTemplates("fl", name))).toEqual(["flowchart", "sankey"]);
    // `chart` sta dentro `flowchart` e `quadrantChart`, ma `xychart` ha
    // l'alias `chart`: comincia così, quindi viene prima.
    expect(ids(matchTemplates("chart", name))).toEqual(["xychart", "flowchart", "quadrant"]);
  });

  it("trova per nome in tutte e due le lingue, senza badare ad accenti e maiuscole", () => {
    expect(ids(matchTemplates("torta", name))).toEqual(["pie"]);
    expect(ids(matchTemplates("Pie", name))).toEqual(["pie"]);
    expect(ids(matchTemplates("entita", name))).toEqual(["er"]);
    expect(ids(matchTemplates("ENTITÀ", name))).toEqual(["er"]);
    expect(ids(matchTemplates("mappa", name))).toEqual(["mindmap"]);
    expect(ids(matchTemplates("mind", name))).toEqual(["mindmap"]);
  });

  it("una parola che non nomina niente non trova niente", () => {
    expect(matchTemplates("zzz", name)).toEqual([]);
  });
});

describe("il testo di un modello", () => {
  const gantt = DIAGRAM_TEMPLATES.find((template) => template.id === "gantt")!;
  const flowchart = DIAGRAM_TEMPLATES.find((template) => template.id === "flowchart")!;

  it("un Gantt parte da oggi, nel formato che dichiara", () => {
    const text = templateText(gantt, "it", "", new Date(2026, 9, 1));
    expect(text).toContain("dateFormat YYYY-MM-DD");
    expect(text).toContain("Ricerca :done, r1, 2026-10-01, 5d");
    expect(text).not.toContain("{today}");
  });

  it("parla la lingua chiesta, e una lingua senza corpo cade sull'italiano", () => {
    expect(templateText(flowchart, "en")).toContain("A[Start]");
    expect(templateText(flowchart, "it")).toContain("A[Inizio]");
    expect(templateText(flowchart, "de")).toContain("A[Inizio]");
  });

  it("dalla seconda riga porta il rientro di una lista o di una citazione", () => {
    const text = templateText(flowchart, "it", "> ");
    const rows = text.split("\n");
    expect(rows[0]).toBe("flowchart LR");
    expect(rows.slice(1).every((row) => row.startsWith(">   "))).toBe(true);
  });
});
