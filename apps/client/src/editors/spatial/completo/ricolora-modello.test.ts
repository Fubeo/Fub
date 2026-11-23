// Il modello di Ricolora grafica (K6 T14, giro 3): le chiavi del motore in esadecimale, i gruppi
// dalla lettura dei colori, le proposte di Riduci e Colori casuali, e la mappa che si manda.
import { describe, expect, it } from "vitest";
import {
  chiaveAHex,
  conProposta,
  gruppiIniziali,
  mappaCompleta,
  mappaDeiGruppi,
  metodoValido,
  normalizzaHex,
  type GruppoColore,
} from "./ricolora-modello";

const LETTURA = {
  colors: [
    { key: "rgb 255 0 0", hex: "#ff0000", count: 2 },
    { key: "rgb 0 0 0", hex: "#000000", count: 1 },
    { key: "rgb 0 0 255", hex: "#0000ff", count: 1 },
  ],
};

describe("le chiavi del motore in esadecimale", () => {
  it("legge rgb, gray, cmyk e lab come li scrive il motore", () => {
    expect(chiaveAHex("rgb 255 0 0")).toBe("#ff0000");
    expect(chiaveAHex("rgb 81.1 131.55 182")).toBe("#5184b6");
    expect(chiaveAHex("gray 50")).toBe("#808080");
    expect(chiaveAHex("cmyk 0 100 100 0")).toBe("#ff0000");
    expect(chiaveAHex("cmyk 0 0 0 100")).toBe("#000000");
    // Lab di un bianco è bianco (L 100, a e b a zero) e il nero è nero.
    expect(chiaveAHex("lab 100 0 0")).toBe("#ffffff");
    expect(chiaveAHex("lab 0 0 0")).toBe("#000000");
  });

  it("dice null per una chiave che non si legge", () => {
    expect(chiaveAHex("rgb 1 2")).toBeNull();
    expect(chiaveAHex("cmyk 1 2 3")).toBeNull();
    expect(chiaveAHex("spot Verde")).toBeNull();
    expect(chiaveAHex("rgb 1 x 3")).toBeNull();
    expect(chiaveAHex("")).toBeNull();
  });

  it("normalizza un colore esadecimale a #rrggbb minuscolo", () => {
    expect(normalizzaHex("#FF0000")).toBe("#ff0000");
    expect(normalizzaHex("#f00")).toBe("#ff0000");
    expect(normalizzaHex(" #00ff7f ")).toBe("#00ff7f");
    expect(normalizzaHex("rosso")).toBeNull();
    expect(normalizzaHex("#ggg")).toBeNull();
  });

  it("riconosce i metodi che il motore conosce", () => {
    expect(metodoValido("scaleTints")).toBe(true);
    expect(metodoValido("inesistente")).toBe(false);
    expect(metodoValido(3)).toBe(false);
  });
});

describe("i gruppi dalla lettura dei colori", () => {
  it("un gruppo per colore, nell'ordine del motore, col colore nuovo uguale all'attuale", () => {
    const gruppi = gruppiIniziali(LETTURA);
    expect(gruppi).toEqual([
      { chiavi: ["rgb 255 0 0"], attuali: ["#ff0000"], nuovo: "#ff0000" },
      { chiavi: ["rgb 0 0 0"], attuali: ["#000000"], nuovo: "#000000" },
      { chiavi: ["rgb 0 0 255"], attuali: ["#0000ff"], nuovo: "#0000ff" },
    ]);
  });

  it("dice null se la lettura non ha la forma dei colori", () => {
    expect(gruppiIniziali(null)).toBeNull();
    expect(gruppiIniziali({ colors: 5 })).toBeNull();
    expect(gruppiIniziali({ colors: [{ key: "rgb 1 2 3" }] })).toBeNull();
    expect(gruppiIniziali({ colors: [{ key: "rgb 1 2 3", hex: "rosso", count: 1 }] })).toBeNull();
  });

  it("una scelta senza colori dà una lista vuota, non un errore", () => {
    expect(gruppiIniziali({ colors: [] })).toEqual([]);
  });
});

describe("le proposte del motore applicate ai gruppi", () => {
  const iniziali = gruppiIniziali(LETTURA)!;

  it("Riduci colori raggruppa le chiavi della riga, e i gruppi che non tocca restano", () => {
    const proposta = {
      map: [{ from: ["rgb 255 0 0", "rgb 0 0 255"], to: "rgb 255 0 0" }],
      preserved: ["rgb 0 0 0"],
      method: "scaleTints",
    };
    const nuovi = conProposta(iniziali, proposta);
    expect(nuovi).toEqual([
      { chiavi: ["rgb 255 0 0", "rgb 0 0 255"], attuali: ["#ff0000", "#0000ff"], nuovo: "#ff0000" },
      { chiavi: ["rgb 0 0 0"], attuali: ["#000000"], nuovo: "#000000" },
    ]);
  });

  it("i colori casuali danno un colore nuovo a ogni riga, anche in rgb con decimali", () => {
    const proposta = {
      map: [
        { from: ["rgb 255 0 0"], to: "rgb 81.1 131.55 182" },
        { from: ["rgb 0 0 255"], to: "cmyk 100 50 0 0" },
      ],
    };
    const nuovi = conProposta(iniziali, proposta)!;
    expect(nuovi.find((g) => g.chiavi[0] === "rgb 255 0 0")!.nuovo).toBe("#5184b6");
    expect(nuovi.find((g) => g.chiavi[0] === "rgb 0 0 255")!.nuovo).toBe("#0080ff");
  });

  it("una proposta che non si capisce dà null: niente cambia", () => {
    expect(conProposta(iniziali, { map: [{ from: ["rgb 1 2 3"], to: "spot Verde" }] })).toBeNull();
    expect(conProposta(iniziali, { map: [{ from: [], to: "rgb 1 2 3" }] })).toBeNull();
    expect(conProposta(iniziali, { nessuna: true })).toBeNull();
  });
});

describe("la mappa che si manda a recolor.apply", () => {
  const gruppi: readonly GruppoColore[] = [
    { chiavi: ["rgb 255 0 0"], attuali: ["#ff0000"], nuovo: "#ff0000" },
    { chiavi: ["rgb 0 0 0", "rgb 40 40 40"], attuali: ["#000000", "#282828"], nuovo: "#333333" },
    { chiavi: ["rgb 0 0 255"], attuali: ["#0000ff"], nuovo: "#00ff00" },
  ];

  it("solo i gruppi che cambiano, con tutte le loro chiavi", () => {
    expect(mappaDeiGruppi(gruppi)).toEqual([
      { from: ["rgb 0 0 0", "rgb 40 40 40"], to: "#333333" },
      { from: ["rgb 0 0 255"], to: "#00ff00" },
    ]);
  });

  it("la mappa completa ha tutti i gruppi, anche quelli che non cambiano", () => {
    expect(mappaCompleta(gruppi)).toHaveLength(3);
  });

  it("senza cambiamenti la mappa è vuota; un gruppo di più colori cambia se uno solo di loro cambia", () => {
    // Un colore nuovo uguale a ciascuno dei colori attuali del gruppo: nessun cambiamento.
    const fermi = gruppi.filter((g) => g.chiavi.length === 1).map((g) => ({ ...g, nuovo: g.attuali[0]! }));
    expect(mappaDeiGruppi(fermi)).toEqual([]);
    // Un gruppo con #000000 e #282828 e colore nuovo #000000: il secondo cambia, quindi il gruppo entra.
    const misto = gruppi.find((g) => g.chiavi.length === 2)!;
    expect(mappaDeiGruppi([{ ...misto, nuovo: "#000000" }])).toEqual([{ from: ["rgb 0 0 0", "rgb 40 40 40"], to: "#000000" }]);
  });
});
