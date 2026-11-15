import { describe, expect, it } from "vitest";
import { fillSeries, todayText } from "./series";

describe("il riempimento di serie", () => {
  it("continua i numeri col passo degli ultimi due, virgola e decimali compresi", () => {
    expect(fillSeries(["1", "3"], 3)).toEqual(["5", "7", "9"]);
    expect(fillSeries(["0,5", "1,0"], 2)).toEqual(["1,5", "2,0"]);
    expect(fillSeries(["7"], 2)).toEqual(["8", "9"]);
  });

  it("legge i numeri come la somma, nella lingua della tabella", () => {
    // All'italiana «1.000» è mille; all'inglese è uno con tre decimali.
    expect(fillSeries(["1.000"], 1, false, "it")).toEqual(["1.001"]);
    expect(fillSeries(["1.000"], 1, false, "en")).toEqual(["2.000"]);
    expect(fillSeries(["1.000", "2.000"], 2, false, "it")).toEqual(["3.000", "4.000"]);
    expect(fillSeries(["1.250,5", "1.500,5"], 1, false, "en")).toEqual(["1.750,5"]);
    expect(fillSeries(["0.1", "0.2"], 2, false, "it")).toEqual(["0.3", "0.4"]);
  });

  it("all'indietro la serie scende", () => {
    expect(fillSeries(["3", "4"], 2, true)).toEqual(["2", "1"]);
  });

  it("un testo con un numero in fondo cresce, con gli zeri davanti", () => {
    expect(fillSeries(["Voce 08"], 3)).toEqual(["Voce 09", "Voce 10", "Voce 11"]);
  });

  it("il resto si ripete in ciclo", () => {
    expect(fillSeries(["sì", "no"], 3)).toEqual(["sì", "no", "sì"]);
    expect(fillSeries([], 3)).toEqual([]);
  });

  it("continua i giorni della settimana, corti o interi, e dopo domenica torna a lunedì", () => {
    expect(fillSeries(["lun"], 3)).toEqual(["mar", "mer", "gio"]);
    expect(fillSeries(["venerdì"], 3)).toEqual(["sabato", "domenica", "lunedì"]);
    expect(fillSeries(["sab", "dom"], 2)).toEqual(["lun", "mar"]);
  });

  it("continua i mesi col passo della sorgente, e dopo dicembre torna a gennaio", () => {
    expect(fillSeries(["gennaio"], 2)).toEqual(["febbraio", "marzo"]);
    expect(fillSeries(["nov", "dic"], 2)).toEqual(["gen", "feb"]);
    // Ogni tre mesi, come i trimestri.
    expect(fillSeries(["gen", "apr"], 3)).toEqual(["lug", "ott", "gen"]);
  });

  it("i mesi e i giorni in inglese", () => {
    expect(fillSeries(["January"], 2)).toEqual(["February", "March"]);
    expect(fillSeries(["Nov", "Dec"], 2)).toEqual(["Jan", "Feb"]);
    expect(fillSeries(["friday"], 3)).toEqual(["saturday", "sunday", "monday"]);
  });

  it("tiene le maiuscole e ignora gli accenti scritti male", () => {
    expect(fillSeries(["Lun"], 2)).toEqual(["Mar", "Mer"]);
    expect(fillSeries(["GEN"], 1)).toEqual(["FEB"]);
    expect(fillSeries(["Lunedi"], 1)).toEqual(["Martedì"]);
  });

  it("una parola di due lingue segue la lingua di Fub: «mar» è martedì in italiano, marzo in inglese", () => {
    expect(fillSeries(["mar"], 1, false, "it")).toEqual(["mer"]);
    expect(fillSeries(["mar"], 1, false, "en-GB")).toEqual(["apr"]);
    // Con i mesi intorno la serie è dei mesi anche in italiano.
    expect(fillSeries(["feb", "mar"], 1, false, "it")).toEqual(["apr"]);
  });

  it("all'indietro i giorni e i mesi scendono", () => {
    expect(fillSeries(["lun"], 2, true)).toEqual(["dom", "sab"]);
    expect(fillSeries(["feb", "mar"], 2, true)).toEqual(["gen", "dic"]);
  });

  it("due giorni uguali non sono una serie: si ripetono", () => {
    expect(fillSeries(["lun", "lun"], 2)).toEqual(["lun", "lun"]);
  });
});

describe("la data di oggi", () => {
  const day = new Date(2026, 10, 15, 12);

  it("scrive il giorno, il mese corto e l'anno nella lingua di Fub", () => {
    expect(todayText(day, "it")).toBe(new Intl.DateTimeFormat("it", { day: "numeric", month: "short", year: "numeric" }).format(day));
    expect(todayText(day, "it")).toMatch(/^15 nov 2026$/);
    expect(todayText(day, "en")).toMatch(/Nov 15, 2026/);
  });
});
