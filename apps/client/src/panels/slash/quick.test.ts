import { describe, expect, it } from "vitest";
import { quickCommand } from "./quick";

// Giovedì 29 ottobre 2026.
const TODAY = new Date(2026, 9, 29);

describe("i comandi rapidi del «/»", () => {
  it("la tabella con righe e colonne, nei limiti", () => {
    expect(quickCommand("tab 3x4", TODAY)).toMatchObject({ id: "markdown.table", params: { rows: 3, cols: 4 } });
    expect(quickCommand("tabella 2×2", TODAY)).toMatchObject({ params: { rows: 2, cols: 2 } });
    expect(quickCommand("table 99*99", TODAY)).toMatchObject({ params: { rows: 50, cols: 12 } });
    expect(quickCommand("tab 3x", TODAY)).toBeNull();
  });

  it("le colonne da due a quattro, il codice col linguaggio, i titoli", () => {
    expect(quickCommand("col 3", TODAY)).toMatchObject({ id: "markdown.columns", params: { count: 3 } });
    expect(quickCommand("col 5", TODAY)).toBeNull();
    expect(quickCommand("code py", TODAY)).toMatchObject({ id: "markdown.codeblock", params: { language: "python" } });
    expect(quickCommand("codice rust", TODAY)).toMatchObject({ params: { language: "rust" } });
    expect(quickCommand("h2", TODAY)).toMatchObject({ id: "markdown.heading.2", params: {} });
    expect(quickCommand("h7", TODAY)).toBeNull();
  });

  it("le date dette a parole, rispetto a oggi", () => {
    expect(quickCommand("oggi", TODAY)).toMatchObject({ id: "markdown.date", params: { date: "2026-10-29" } });
    expect(quickCommand("domani", TODAY)).toMatchObject({ params: { date: "2026-10-30" } });
    expect(quickCommand("venerdì", TODAY)).toMatchObject({ params: { date: "2026-10-30" } });
    expect(quickCommand("venerdi", TODAY)).toMatchObject({ params: { date: "2026-10-30" } });
    expect(quickCommand("giovedì", TODAY)).toMatchObject({ params: { date: "2026-11-05" } });
    expect(quickCommand("fra una settimana", TODAY)).toMatchObject({ params: { date: "2026-11-05" } });
    expect(quickCommand("dom", TODAY)).toBeNull();
  });

  it("il riquadro col suo tipo, detto in italiano o col nome di Markdown", () => {
    expect(quickCommand("riquadro attenzione", TODAY)).toMatchObject({ id: "markdown.callout", params: { type: "warning" } });
    expect(quickCommand("callout tip", TODAY)).toMatchObject({ params: { type: "tip" } });
    expect(quickCommand("riquadro boh", TODAY)).toBeNull();
  });

  it("ogni comando rapido dice che cosa farà", () => {
    expect(quickCommand("tab 3x4", TODAY)!.label).toMatch(/3.*4/);
    expect(quickCommand("venerdì", TODAY)!.label).toMatch(/30/);
  });
});
