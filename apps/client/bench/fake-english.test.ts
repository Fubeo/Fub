import { describe, expect, it } from "vitest";
import { ENGLISH, translated } from "./fake-english";

describe("l'inglese della scenografia", () => {
  it("traduce il testo dell'interfaccia e lascia i dati com'erano", () => {
    const setting = {
      spec: {
        key: "vault.daily_folder",
        label: "Cartella del diario",
        group: "Vault",
        kind: { kind: "choice", default: "Tema", options: [{ value: "Tema", label: "Tema" }] },
      },
      value: "Tema",
    };
    expect(translated(setting, ENGLISH)).toEqual({
      spec: {
        key: "vault.daily_folder",
        label: "Daily notes folder",
        group: "Vault",
        kind: { kind: "choice", default: "Tema", options: [{ value: "Tema", label: "Theme" }] },
      },
      value: "Tema",
    });
  });

  it("traduce soltanto una frase intera del dizionario", () => {
    const tree = { node: "text", content: "Struttura della nota" };
    expect(translated(tree, ENGLISH)).toEqual(tree);
  });

  it("scende negli alberi annidati", () => {
    const tree = {
      node: "section",
      title: "Filtro avanzato",
      children: [{ node: "empty_state", title: "Nessuna menzione non collegata.", detail: null }],
    };
    expect(translated(tree, ENGLISH)).toEqual({
      node: "section",
      title: "Advanced filter",
      children: [{ node: "empty_state", title: "No unlinked mentions.", detail: null }],
    });
  });

  it("non legge una chiave ereditata come una frase", () => {
    const tree = { title: "constructor" };
    expect(translated(tree, ENGLISH)).toEqual(tree);
  });
});
