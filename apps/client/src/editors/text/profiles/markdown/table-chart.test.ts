// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { markdown } from "@codemirror/lang-markdown";
import { createTextEngine } from "../../engine";
import { closeContextMenu } from "../../../../ui/menu";
import { loadLazyParts } from "../../../../ui/lazy-part";
import { markdownGrammar } from "./grammar";
import { livePreview } from "./livepreview";
import { liveStrings } from "./strings";
import { generatedChartAfter, TABLE_CHART_MARK, tableChart, tableSeries } from "./table-chart";
import type { TableData } from "./table-model";

beforeAll(loadLazyParts);

const notices = vi.hoisted(() => [] as string[]);
vi.mock("../../../../ui/notify", async (original) => ({
  ...(await original<typeof import("../../../../ui/notify")>()),
  notify: (text: string) => void notices.push(text),
}));
vi.mock("mermaid", () => ({
  default: {
    initialize() {},
    render: async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>' }),
  },
}));

afterEach(() => {
  closeContextMenu();
  notices.length = 0;
});

const table = (rows: string[][]): TableData => ({ rows, aligns: rows[0]!.map(() => null) });
const NOTE = "Valori del 19 nov 2026";

describe("il grafico da una tabella (T54)", () => {
  it("una serie sola di poche parti è una torta, coi numeri all'italiana", () => {
    const spese = table([["Voce", "Importo"], ["Trasporti", "1.240,50 €"], ["**Stampa**", "860"], ["Sala", "(0)"]]);
    expect(tableChart(spese, "it", NOTE)).toBe([
      "```mermaid",
      "pie title Importo",
      `  ${TABLE_CHART_MARK}`,
      `  %% ${NOTE}`,
      '  "Trasporti" : 1240.5',
      '  "Stampa" : 860',
      '  "Sala" : 0',
      "```",
    ].join("\n"));
    // In inglese la virgola separa le migliaia.
    expect(tableSeries(table([["Voce", "Importo"], ["A", "1,240.50"]]), "en")!.series[0]!.values).toEqual([1240.5]);
    // In italiano «1.240» è milleduecentoquaranta, e «12.30» non è un numero.
    expect(tableSeries(table([["Voce", "Importo"], ["A", "1.240"]]), "it")!.series[0]!.values).toEqual([1240]);
    expect(tableSeries(table([["Voce", "Ora"], ["A", "12.30"]]), "it")).toBeNull();
  });

  it("valori negativi, molte righe o più serie sono barre o linee in `xychart-beta`", () => {
    const saldo = table([["Mese", "Saldo"], ["gen", "120"], ["feb", "-40"]]);
    expect(tableChart(saldo, "it", NOTE)).toBe([
      "```mermaid",
      "xychart-beta",
      `  ${TABLE_CHART_MARK}`,
      `  %% ${NOTE}`,
      '  title "Saldo"',
      '  x-axis ["gen", "feb"]',
      '  y-axis "Saldo"',
      "  bar [120, -40]",
      "```",
    ].join("\n"));
    // Gli anni sono numeri: con tutte le colonne di numeri la prima fa le
    // etichette. Più serie: una linea ciascuna, col suo nome in un commento.
    const anni = table([["Anno", "Entrate", "Uscite"], ["2024", "10", "8"], ["2025", "12", ""]]);
    expect(tableChart(anni, "it", NOTE)!.split("\n").slice(4)).toEqual([
      '  x-axis ["2024", "2025"]',
      "  %% Entrate",
      "  line [10, 12]",
      "  %% Uscite",
      "  line [8, 0]",
      "```",
    ]);
  });

  it("una tabella senza numeri non ha grafico; le percentuali si disegnano come si leggono; il barrato non conta", () => {
    expect(tableChart(table([["Nome", "Ruolo"], ["Ada", "autrice"]]), "it", NOTE)).toBeNull();
    expect(tableChart(table([["Nome", "Voto"]]), "it", NOTE)).toBeNull();
    // Una colonna con un testo fra i numeri non è di numeri.
    expect(tableChart(table([["Nome", "Voto"], ["Ada", "10"], ["Bea", "assente"]]), "it", NOTE)).toBeNull();
    expect(tableSeries(table([["Parte", "Quota"], ["A", "12,5%"], ["B", "87,5%"]]), "it")!.series[0]!.values).toEqual([12.5, 87.5]);
    expect(tableSeries(table([["Voce", "Importo"], ["A", "~~100~~"], ["B", "20"]]), "it")!.series[0]!.values).toEqual([null, 20]);
    // Una colonna sola di numeri: le etichette sono i numeri delle righe.
    expect(tableSeries(table([["Voto"], ["10"], ["9"]]), "it")!.labels).toEqual(["1", "2"]);
    // Le virgolette dentro un'etichetta diventano apostrofi.
    expect(tableChart(table([["Voce", "N"], ['Il "grande"', "3"]]), "it", NOTE)).toContain(`"Il 'grande'" : 3`);
  });

  it("ritrova il recinto scritto da lei subito sotto la tabella, e nessun altro", () => {
    const fence = ["```mermaid", "pie", `  ${TABLE_CHART_MARK}`, '  "A" : 1', "```"].join("\n");
    expect(generatedChartAfter(`\n\n${fence}\n\nDopo`)).toEqual({ from: 2, to: 2 + fence.length });
    expect(generatedChartAfter(`\n${fence}`)).toEqual({ from: 1, to: 1 + fence.length });
    // Un recinto senza il segno è di chi l'ha scritto; uno lontano non è suo.
    expect(generatedChartAfter("\n\n```mermaid\npie\n  \"A\" : 1\n```")).toBeNull();
    expect(generatedChartAfter(`\n\nTesto\n\n${fence}`)).toBeNull();
    expect(generatedChartAfter(`\n\n${fence.slice(0, -3)}`)).toBeNull();
  });
});

describe("«Grafico da questa tabella» nella nota (T54)", () => {
  function editorWith(doc: string, readOnly = false) {
    const parent = document.createElement("div");
    document.body.append(parent);
    const engine = createTextEngine(parent, {
      onChange() {},
      onSelectionChange() {},
      extensions: () => [markdown({ base: markdownGrammar }), livePreview({ openWikilink() {}, searchTag() {} })],
    });
    engine.setDoc(doc);
    if (readOnly) engine.setReadOnly(true);
    const cell = (row: number, col: number) => parent.querySelector<HTMLElement>(`.tb-grid [data-row="${row}"][data-col="${col}"]`)!;
    const menu = () => {
      cell(1, 0).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
      return [...document.querySelectorAll<HTMLButtonElement>("#context-menu [role=menuitem]")];
    };
    return { engine, cell, menu, cleanup: () => { engine.destroy(); parent.remove(); } };
  }
  const SPESE = "Spese\n\n| Voce | Importo |\n| --- | --- |\n| Trasporti | 860 |\n| Stampa | 120 |\n\nDopo la tabella\n";

  it("scrive il recinto sotto la tabella in un passo d'annullamento, lo dice, e la seconda volta lo rigenera al suo posto", () => {
    const { engine, menu, cleanup } = editorWith(SPESE);
    try {
      const voice = menu().find((button) => button.textContent === liveStrings.t("table_chart.menu"));
      expect(voice, "la voce c'è").toBeDefined();
      voice!.click();
      const written = engine.getDoc();
      const fence = /```mermaid\n[\s\S]*?\n```/u.exec(written)![0];
      expect(written).toBe(SPESE.replace("| Stampa | 120 |\n\n", `| Stampa | 120 |\n\n${fence}\n\n`));
      expect(fence).toContain(TABLE_CHART_MARK);
      expect(fence).toContain('"Trasporti" : 860');
      expect(notices).toEqual([liveStrings.t("table_chart.written")]);

      // La tabella cambia: il grafico no, finché non si rigenera.
      engine.setDoc(written.replace("| Stampa | 120 |", "| Stampa | 300 |"));
      const again = menu().find((button) => button.textContent === liveStrings.t("table_chart.menu.again"));
      expect(again, "la voce dice che rigenera").toBeDefined();
      again!.click();
      const regenerated = engine.getDoc();
      expect(regenerated.match(/```mermaid/gu)).toHaveLength(1);
      expect(regenerated).toContain('"Stampa" : 300');
      expect(regenerated.endsWith("```\n\nDopo la tabella\n")).toBe(true);
      expect(notices.at(-1)).toBe(liveStrings.t("table_chart.rewritten"));
    } finally {
      cleanup();
    }
  });

  it("l'annulla toglie il grafico in un passo", () => {
    const { engine, menu, cleanup } = editorWith(SPESE);
    try {
      menu().find((button) => button.textContent === liveStrings.t("table_chart.menu"))!.click();
      expect(engine.getDoc()).not.toBe(SPESE);
      engine.undo();
      expect(engine.getDoc()).toBe(SPESE);
    } finally {
      cleanup();
    }
  });

  it("in sola lettura la voce non c'è", () => {
    const { menu, cleanup } = editorWith(SPESE, true);
    try {
      expect(menu().map((button) => button.textContent)).not.toContain(liveStrings.t("table_chart.menu"));
    } finally {
      cleanup();
    }
  });

  it("una tabella senza numeri non ha la voce", () => {
    const { menu, cleanup } = editorWith("| Nome | Ruolo |\n| --- | --- |\n| Ada | autrice |\n");
    try {
      const labels = menu().map((button) => button.textContent);
      expect(labels).not.toContain(liveStrings.t("table_chart.menu"));
    } finally {
      cleanup();
    }
  });

  it("una tabella in fondo alla nota prende il grafico dopo una riga vuota", () => {
    const doc = "| Voce | Importo |\n| --- | --- |\n| A | 1 |\n| B | 2 |";
    const { engine, menu, cleanup } = editorWith(doc);
    try {
      menu().find((button) => button.textContent === liveStrings.t("table_chart.menu"))!.click();
      expect(engine.getDoc().startsWith(`${doc}\n\n\`\`\`mermaid\npie title Importo\n`)).toBe(true);
      expect(engine.getDoc().endsWith("```")).toBe(true);
    } finally {
      cleanup();
    }
  });
});
