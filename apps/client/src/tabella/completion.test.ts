import { describe, expect, it } from "vitest";
import { columnCompletion } from "./completion";

describe("il completamento dalla colonna", () => {
  const cities = columnCompletion(["Roma", "Milano", "Napoli", "", "milano"]);

  it("propone il solo valore che comincia così, tenendo ciò che si è scritto", () => {
    expect(cities.suggest("Mi")).toBe("Milano");
    expect(cities.suggest("mi")).toBe("milano");
    expect(cities.suggest("N")).toBe("Napoli");
  });

  it("tace se due valori cominciano così, come Excel", () => {
    const both = columnCompletion(["Roma", "Romagna"]);
    expect(both.suggest("Rom")).toBeNull();
    // Chi scrive «Roma» non si trova «Romagna» sotto le dita.
    expect(both.suggest("Roma")).toBeNull();
    expect(both.suggest("Romag")).toBe("Romagna");
  });

  it("tace sul valore già intero, sul vuoto, sugli spazi davanti e sui numeri scritti", () => {
    expect(cities.suggest("Milano")).toBeNull();
    expect(cities.suggest("")).toBeNull();
    expect(cities.suggest(" M")).toBeNull();
    expect(columnCompletion(["12 mesi"]).suggest("12")).toBeNull();
  });

  it("non propone i numeri della colonna", () => {
    expect(columnCompletion(["105", "1.240,5"]).suggest("1")).toBeNull();
    expect(columnCompletion(["105", "10 euro"]).suggest("10 ")).toBe("10 euro");
  });

  it("una colonna di mille valori si legge una volta, e ogni battuta cerca in fretta", () => {
    const values = Array.from({ length: 1000 }, (_, i) => `Voce ${String(i).padStart(4, "0")}`);
    values.push("Zaffiro");
    const thousand = columnCompletion(values);
    const start = performance.now();
    for (let i = 0; i < 200; i++) {
      expect(thousand.suggest("Za")).toBe("Zaffiro");
      expect(thousand.suggest("Voce")).toBeNull();
    }
    // Ogni battuta ben sotto il tempo di un fotogramma.
    expect((performance.now() - start) / 200).toBeLessThan(16);
  });

  it("i caratteri dell'IME e gli accenti si confrontano come gli altri", () => {
    const words = columnCompletion(["東京", "大阪", "Perché", "Èrica"]);
    expect(words.suggest("東")).toBe("東京");
    expect(words.suggest("è")).toBe("èrica");
    expect(words.suggest("Perc")).toBe("Perché");
  });
});
