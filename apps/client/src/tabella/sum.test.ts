import { describe, expect, it } from "vitest";
import { decimalMarkOf, isNumberText, readNumber, readNumbers, sumAbove, writeNumber } from "./sum";

describe("la somma come valore", () => {
  it("legge i numeri all'italiana e all'inglese", () => {
    expect(readNumber("1.240,50", ",")).toEqual({ value: 1240.5, places: 2, grouped: true });
    expect(readNumber("1,240.50", ".")).toEqual({ value: 1240.5, places: 2, grouped: true });
    expect(readNumber("-3,5", ",")).toEqual({ value: -3.5, places: 1, grouped: false });
    expect(readNumber("−7", ",")?.value).toBe(-7);
  });

  it("non legge ciò che non è soltanto un numero", () => {
    expect(readNumber("12 €", ",")).toBeNull();
    expect(readNumber("1.24.0", ",")).toBeNull();
    expect(readNumber("12,5,1", ",")).toBeNull();
    expect(readNumber("", ",")).toBeNull();
    expect(isNumberText("Roma")).toBe(false);
    expect(isNumberText("1.240")).toBe(true);
  });

  it("il segno dei decimali viene dalla colonna, e se la colonna non lo dice dalla lingua", () => {
    expect(decimalMarkOf(["1.240,5", "860"], "en")).toBe(",");
    expect(decimalMarkOf(["1,240.5", "860"], "it")).toBe(".");
    // «1.240» può essere mille e duecentoquaranta o 1,24: decide la lingua.
    expect(decimalMarkOf(["1.240", "860"], "it")).toBe(",");
    expect(decimalMarkOf(["1.240", "860"], "en-US")).toBe(".");
    expect(decimalMarkOf(["0.5"], "it")).toBe(".");
    expect(decimalMarkOf(["1.000.000"], "en")).toBe(",");
  });

  it("all'italiana «1.240» è milleduecentoquaranta, all'inglese 1,24", () => {
    expect(sumAbove(["1.240", "860"], "it")).toBe("2.100");
    expect(sumAbove(["1.240", "860"], "en")).toBe("861.240");
  });

  it("somma i numeri sopra fino al primo che non lo è, coi decimali e le migliaia della colonna", () => {
    expect(sumAbove(["860", "1.240,5", "Importo"], "en")).toBe("2.100,5");
    expect(sumAbove(["860", "1,240.5", "Cost"], "it")).toBe("2,100.5");
    expect(sumAbove(["2", "3", "", "100"], "it")).toBe("5");
    expect(sumAbove(["0,1", "0,2"], "it")).toBe("0,3");
    expect(sumAbove(["-5", "3"], "it")).toBe("-2");
  });

  it("il segno dei decimali lo dicono i soli numeri sommati, non quelli oltre un testo", () => {
    // «3.5» e «0.25» stanno sopra «Importo»: non contano per «1.240».
    expect(sumAbove(["860", "1.240", "Importo", "0.25", "3.5"], "it")).toBe("2.100");
    expect(sumAbove(["860", "1.240", "", "0,25", "3,5"], "en")).toBe("861.240");
  });

  it("legge un gruppo di numeri con lo stesso segno, come la serie", () => {
    expect(readNumbers(["1.000", "2.000"], "it")).toEqual({ decimal: ",", numbers: [{ value: 1000, places: 0, grouped: true }, { value: 2000, places: 0, grouped: true }] });
    expect(readNumbers(["1.5", "2"], "it")?.decimal).toBe(".");
    expect(readNumbers(["1", "Roma"], "it")).toBeNull();
  });

  it("niente somma se subito sopra non c'è un numero", () => {
    expect(sumAbove(["Voce", "12"], "it")).toBeNull();
    expect(sumAbove(["", "12"], "it")).toBeNull();
    expect(sumAbove([], "it")).toBeNull();
  });

  it("scrive il numero coi decimali e le migliaia chiesti", () => {
    expect(writeNumber(1234567.891, 2, ",", true)).toBe("1.234.567,89");
    expect(writeNumber(1234567.891, 2, ".", true)).toBe("1,234,567.89");
    expect(writeNumber(1234, 0, ",", false)).toBe("1234");
    expect(writeNumber(-0.001, 2, ",", false)).toBe("0,00");
  });
});
