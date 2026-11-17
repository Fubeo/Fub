// @vitest-environment happy-dom
// La finestra del risultato di un comando che legge: l'attesa, la tabella
// coi numeri a destra, i riferimenti che portano alla cella, «Copia»,
// l'errore con «Riprova», Esc e il fuoco; e che ogni chiave del risultato
// (`risultati.generated.json`) abbia il suo testo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import risultati from "./risultati.generated.json";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import type { GridRun } from "./engine";
import { fogliStrings } from "./palette/strings";
import { openResult, openResultWindow, resultSections, resultTsv, type ResultEngine } from "./risultato";

const clipboard = vi.hoisted(() => ({ write: vi.fn<(text: string) => Promise<void>>() }));
vi.mock("../../platform/clipboard", () => ({ writeClipboardText: (text: string) => clipboard.write(text) }));

interface Fake extends ResultEngine {
  runs: string[];
  commands: string[];
  focused: number;
  answer(run: GridRun): void;
}

/// Un motore che risponde quando gli si dice: ogni `run` aspetta `answer`.
function fakeEngine(sheets: readonly string[] = ["Foglio1", "Dati"]): Fake {
  const waiting: ((run: GridRun) => void)[] = [];
  const engine: Fake = {
    runs: [],
    commands: [],
    focused: 0,
    run: (id, params = "{}") => {
      engine.runs.push(`${id} ${params}`);
      return new Promise((resolve) => waiting.push(resolve));
    },
    command: (id, params = "{}") => {
      engine.commands.push(`${id} ${params}`);
      return true;
    },
    sheetNames: () => sheets,
    selectionRefs: () => ({ sheet: "Foglio1", range: "A1:B3", active: "A1" }),
    focus: () => {
      engine.focused += 1;
    },
    answer: (run) => waiting.shift()?.(run),
  };
  return engine;
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>(".grid-result-dialog button")].find((one) => one.textContent === label && !one.hidden) ?? null;

let life: Lifetime;
let opener: HTMLButtonElement;

beforeEach(() => {
  life = openLifetime();
  opener = document.createElement("button");
  opener.textContent = "apri";
  document.body.append(opener);
  opener.focus();
  clipboard.write.mockReset();
});

afterEach(() => {
  life.close();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function open(engine: Fake, motore = "selection.stats", first?: GridRun) {
  return openResult({ motore, title: "Statistiche", params: "{}", engine, lifetime: life, first });
}

describe("la finestra del risultato", () => {
  it("dice che sta leggendo, poi mostra chiave e valore coi numeri a destra", async () => {
    const engine = fakeEngine();
    const window = open(engine);
    const dialog = window.element;
    expect(dialog.classList.contains("grid-result-dialog")).toBe(true);
    expect(dialog.querySelector(".grid-result")!.getAttribute("aria-busy")).toBe("true");
    expect(dialog.querySelector(".grid-dialog-note")!.textContent).toBe("Sto leggendo il risultato…");
    expect(dialog.querySelectorAll(".skeleton-line")).toHaveLength(6);
    expect(button("Copia")).toBeNull();
    expect(engine.runs).toEqual(["selection.stats {}"]);

    engine.answer({ ok: true, result: JSON.stringify({ count: 4, numeric: 3, sum: 1234.5, average: 411.5, min: 1, max: 1000 }) });
    await flush();
    expect(dialog.querySelector(".grid-result")!.hasAttribute("aria-busy")).toBe(false);
    const rows = [...dialog.querySelectorAll(".grid-result-table tbody tr")];
    expect(rows).toHaveLength(6);
    const first = rows[0]!;
    expect(first.querySelector("th.grid-result-key")!.getAttribute("scope")).toBe("row");
    expect(first.querySelector("th")!.textContent).toBe(fogliStrings.t("fogli.result.key.count"));
    expect(first.querySelector("td")!.classList.contains("grid-result-number")).toBe(true);
    expect(rows[2]!.querySelector("td")!.textContent).toBe((1234.5).toLocaleString("it"));
    expect(dialog.querySelector("caption")!.textContent).toBe("Statistiche");
    expect(dialog.querySelector(".grid-dialog-note")!.textContent).toBe("Foglio1!A1:B3: 4 celle con un valore.");
    expect(button("Copia")).not.toBeNull();
    expect(button("Riprova")).toBeNull();
  });

  it("un elenco di oggetti è una tabella con le sue colonne, e i riferimenti portano alla cella", async () => {
    const engine = fakeEngine();
    open(engine, "formulas.errorChecking");
    engine.answer({
      ok: true,
      result: JSON.stringify({ errors: [{ sheet: "Dati", cell: "B4", error: "#DIV/0!", formula: "=A4/0" }], circular: [] }),
    });
    await flush();
    const dialog = openResultWindow()!;
    const heads = [...dialog.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(heads).toEqual([
      fogliStrings.t("fogli.result.col.sheet"),
      fogliStrings.t("fogli.result.col.cell"),
      fogliStrings.t("fogli.result.col.error"),
      fogliStrings.t("fogli.result.col.formula"),
    ]);
    expect(dialog.querySelector(".grid-dialog-note")!.textContent).toBe("1 celle con un errore. Nessun riferimento circolare.");
    const ref = dialog.querySelector<HTMLButtonElement>(".grid-result-ref")!;
    expect(ref.textContent).toBe("B4");
    expect(ref.type).toBe("button");
    expect(ref.getAttribute("aria-label")).toBe("Vai a Dati!B4");
    ref.click();
    await flush();
    expect(engine.commands).toEqual([`selection.set ${JSON.stringify({ sheet: "Dati", range: "B4" })}`]);
    expect(openResultWindow()).toBeNull();
    expect(engine.focused).toBe(1);
  });

  it("un riferimento a un foglio che non c'è più dice perché non porta", async () => {
    const engine = fakeEngine(["Foglio1"]);
    open(engine, "formulas.errorChecking", {
      ok: true,
      result: JSON.stringify({ errors: [{ sheet: "Vecchio", cell: "C2", error: "#REF!", formula: "=X" }], circular: [] }),
    });
    const dialog = openResultWindow()!;
    dialog.querySelector<HTMLButtonElement>(".grid-result-ref")!.click();
    expect(engine.commands).toEqual([]);
    expect(openResultWindow()).toBe(dialog);
    expect(dialog.querySelector(".grid-dialog-note")!.textContent).toBe("Il foglio «Vecchio» non c'è più: non posso andare a C2.");
  });

  it("«Copia» mette il risultato come testo con le tabulazioni, e dice se gli appunti non si scrivono", async () => {
    const engine = fakeEngine();
    open(engine, "selection.stats", { ok: true, result: JSON.stringify({ count: 2, sum: 5 }) });
    clipboard.write.mockResolvedValueOnce(undefined);
    button("Copia")!.click();
    await flush();
    expect(clipboard.write).toHaveBeenCalledWith(
      `${fogliStrings.t("fogli.result.key.count")}\t2\n${fogliStrings.t("fogli.result.key.sum")}\t5`,
    );
    const note = openResultWindow()!.querySelector(".grid-dialog-note")!;
    expect(note.textContent).toBe(fogliStrings.t("fogli.result.copied"));
    // La finestra resta aperta.
    expect(openResultWindow()).not.toBeNull();

    clipboard.write.mockRejectedValueOnce(new Error("negato"));
    button("Copia")!.click();
    await flush();
    expect(note.textContent).toBe(fogliStrings.t("fogli.result.copy_failed"));
  });

  it("un errore dice che cosa è successo e offre «Riprova»; una risposta vecchia non scrive", async () => {
    const engine = fakeEngine();
    open(engine);
    engine.answer({ ok: false, error: "no workbook open" });
    await flush();
    const dialog = openResultWindow()!;
    const error = dialog.querySelector(".grid-dialog-error")!;
    expect(error.getAttribute("role")).toBe("alert");
    expect(error.textContent).toBe("Non sono riuscito a leggere il risultato. Non c'è una cartella aperta.");
    expect(button("Copia")).toBeNull();

    button("Riprova")!.click();
    expect(engine.runs).toHaveLength(2);
    expect(dialog.querySelector(".grid-dialog-note")!.textContent).toBe("Sto leggendo il risultato…");
    engine.answer({ ok: true, result: JSON.stringify({ count: 1 }) });
    await flush();
    expect(dialog.querySelector(".grid-result-table")).not.toBeNull();
    expect(button("Riprova")).toBeNull();
  });

  it("senza ragione dice che il comando non è arrivato", async () => {
    const engine = fakeEngine();
    open(engine, "selection.stats", { ok: false, error: null });
    expect(openResultWindow()!.querySelector(".grid-dialog-error")!.textContent).toBe(fogliStrings.t("fogli.result.failed"));
  });

  it("Esc chiude e rende il fuoco a chi l'ha aperta", async () => {
    const engine = fakeEngine();
    const window = open(engine, "selection.stats", { ok: true, result: JSON.stringify({ count: 1 }) });
    expect(document.activeElement?.textContent).toBe("Chiudi");
    window.element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await window.closed;
    expect(openResultWindow()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("un risultato vuoto ha una frase sua, non una tabella vuota", () => {
    for (const result of ["null", "[]", JSON.stringify({ errors: [], circular: [] }), JSON.stringify({ value: [] })]) {
      const window = open(fakeEngine(), "formulas.errorChecking", { ok: true, result });
      expect(window.element.querySelector(".grid-result-table"), result).toBeNull();
      expect(window.element.querySelector(".grid-dialog-note")!.textContent).toBe("Il comando non ha trovato niente da mostrare.");
      window.close();
    }
  });

  it("500 righe stanno tutte nella tabella, che scorre", () => {
    const issues = Array.from({ length: 500 }, (_, at) => ({ sheet: "Foglio1", issue: "Merged cells", count: at }));
    const window = open(fakeEngine(), "review.checkAccessibility", { ok: true, result: JSON.stringify(issues) });
    expect(window.element.querySelectorAll("tbody tr")).toHaveLength(500);
    expect(window.element.querySelector(".grid-dialog-results .grid-result-table thead")).not.toBeNull();
    expect(window.element.querySelector(".grid-dialog-note")!.textContent).toBe("500 righe.");
    // La parola fissa del motore arriva tradotta, il valore della cartella no.
    expect(window.element.querySelector("tbody td:nth-child(2)")!.textContent).toBe(fogliStrings.t("fogli.result.word.merged_cells"));
    expect(window.element.querySelector("thead th:nth-child(3)")!.classList.contains("grid-result-number")).toBe(true);
  });

  it("lo stesso comando chiesto due volte apre una finestra sola", () => {
    const engine = fakeEngine();
    const first = open(engine);
    const second = open(engine);
    expect(second).toBe(first);
    expect(document.querySelectorAll(".grid-result-dialog")).toHaveLength(1);
    expect(engine.runs).toHaveLength(1);
    // Un altro comando chiude la prima.
    open(engine, "formulas.errorChecking");
    expect(document.querySelectorAll(".grid-result-dialog")).toHaveLength(1);
  });

  it("si chiude quando si chiude chi l'ha aperta, e la risposta che arriva dopo non scrive", async () => {
    const engine = fakeEngine();
    const window = open(engine);
    life.close();
    await window.closed;
    expect(document.querySelector(".grid-result-dialog")).toBeNull();
    engine.answer({ ok: true, result: JSON.stringify({ count: 1 }) });
    await flush();
    expect(document.querySelector(".grid-result-table")).toBeNull();
  });
});

describe("la forma del risultato", () => {
  it("un oggetto dentro un oggetto si legge di seguito, e un valore lungo resta intero", () => {
    const long = "x".repeat(400);
    const sections = resultSections("document.inspect", { workbook: { title: long, sheets: 2 } });
    expect(sections).toHaveLength(1);
    const rows = sections[0]!.kind === "rows" ? sections[0]!.rows : [];
    expect(rows.map((row) => row.cell.text)).toEqual([long, "2"]);
    expect(rows[0]!.label).toContain(" · ");
  });

  it("vero e falso, e un valore che manca, si leggono in italiano", () => {
    const sections = resultSections("cell.get", { locked: true, hidden: false, formula: null });
    const rows = sections[0]!.kind === "rows" ? sections[0]!.rows : [];
    expect(rows.map((row) => row.cell.text)).toEqual(["sì", "no", "—"]);
  });

  it("il testo con le tabulazioni mette una riga per riga e una riga vuota fra le tabelle", () => {
    const sections = resultSections("formulas.errorChecking", {
      errors: [{ sheet: "A", cell: "B1", error: "#N/A", formula: "=X\t1" }],
      circular: ["A!C1"],
    });
    const tsv = resultTsv(sections);
    expect(tsv.split("\n\n")).toHaveLength(2);
    expect(tsv).toContain("A\tB1\t#N/A\t=X 1");
  });
});

describe("le chiavi del risultato", () => {
  it("ogni chiave, colonna e parola di risultati.generated.json ha il suo testo in italiano e in inglese", () => {
    const it = fogliStrings.catalogFor("it");
    const en = fogliStrings.catalogFor("en");
    const shapes = Object.values((risultati as { comandi: Record<string, Record<string, Record<string, string>>> }).comandi);
    expect(shapes.length).toBeGreaterThan(20);
    let keys = 0;
    for (const shape of shapes) {
      for (const part of ["chiavi", "colonne", "parole"]) {
        for (const key of Object.values(shape[part] ?? {})) {
          keys += 1;
          expect(it[key], key).toBeTruthy();
          expect(en[key], key).toBeTruthy();
        }
      }
    }
    expect(keys).toBeGreaterThan(100);
  });
});
