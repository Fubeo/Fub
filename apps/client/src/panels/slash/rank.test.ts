import { describe, expect, it } from "vitest";
import { editDistanceAtMost1, fold, initials, rank, type RankContext } from "./rank";

const NONE: RankContext = { recency: () => 0, fits: () => 0 };
const entry = (label: string, aliases: readonly string[] = []) => ({ id: label, label, aliases });

describe("la classifica del «/»", () => {
  it("l'inizio del nome vale più dell'inizio di un'altra parola, e la parte trovata si colora", () => {
    expect(rank(entry("Tabella"), "ta", NONE)).toEqual({ score: 0, span: [0, 2] });
    expect(rank(entry("Elenco puntato"), "pu", NONE)).toEqual({ score: 1, span: [7, 9] });
    expect(rank(entry("Elenco puntato", ["bullet"]), "bu", NONE)).toEqual({ score: 1, span: null });
  });

  it("con due lettere niente lettere sparse e niente pezzi dentro le parole", () => {
    expect(rank(entry("Sottolineato"), "ti", NONE)).toBeNull();
    expect(rank(entry("Testo giallo"), "ti", NONE)).toBeNull();
    expect(rank(entry("Immagine", ["image", "img"]), "ti", NONE)).toBeNull();
    expect(rank(entry("Titolo 2"), "ti", NONE)?.score).toBe(0);
  });

  it("le iniziali, senza le parole piccole: «ea» è Elenco di attività", () => {
    expect(initials("Elenco di attività")).toBe("ea");
    expect(rank(entry("Elenco di attività"), "ea", NONE)).toMatchObject({ score: 1.5, why: "iniziali" });
  });

  it("da tre lettere anche dentro le parole, da quattro un errore di battitura", () => {
    expect(rank(entry("Sottolineato"), "lin", NONE)).toEqual({ score: 2, span: [5, 8] });
    expect(rank(entry("Tabella"), "tabela", NONE)).toMatchObject({ score: 3, why: "forse" });
    expect(rank(entry("Tabella"), "tbe", NONE)).toBeNull();
    expect(rank(entry("Tabella"), "tqxz", NONE)).toBeNull();
  });

  it("le abitudini e il posto contano, ma non scavalcano un inizio di parola", () => {
    const habit: RankContext = { recency: (id) => (id === "Citazione" ? 1 : 0), fits: () => 1 };
    const word = rank(entry("Citazione", ["quote"]), "qu", habit)!;
    const start = rank(entry("Quadrato"), "qu", NONE)!;
    expect(word.score).toBeLessThan(1);
    expect(start.score).toBeLessThan(word.score);
  });

  it("piega accenti e maiuscole, e la descrizione non conta mai", () => {
    expect(fold("Attività")).toBe("attivita");
    expect(rank(entry("Elenco di attività"), "ATTIVITA", NONE)?.score).toBe(1);
    expect(rank({ id: "x", label: "Riga", aliases: [], description: "tabella" } as never, "tab", NONE)).toBeNull();
  });

  it("la distanza di un errore: una lettera in più, in meno, cambiata o scambiata", () => {
    expect(editDistanceAtMost1("tabella", "tabela")).toBe(true);
    expect(editDistanceAtMost1("tabella", "tabellla")).toBe(true);
    expect(editDistanceAtMost1("tabella", "tabelta")).toBe(true);
    expect(editDistanceAtMost1("tabella", "tablela")).toBe(true);
    expect(editDistanceAtMost1("tabella", "tbela")).toBe(false);
  });
});
