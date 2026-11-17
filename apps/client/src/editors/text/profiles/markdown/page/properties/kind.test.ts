import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { propertyBlock, type PropertyEntry } from "../../properties";
import { initials, linkName, optionOf, parseNumber, parsePropertyTypes, rowKind, sameTypes, validDate, type PropertyTypes } from "./kind";

// Il tipo di una riga della testata (T8): il registro vince, se no il valore.

function entry(line: string): PropertyEntry {
  const block = propertyBlock(EditorState.create({ doc: `---\n${line}\n---\n` }));
  return block!.entries[0]!;
}
const kind = (line: string, types: PropertyTypes = new Map()) => rowKind(entry(line), types);

describe("il tipo letto dal valore", () => {
  it("riconosce casella, numero, data, data e ora, indirizzo, elenco, persone", () => {
    expect(kind("fatto: true").kind).toBe("checkbox");
    expect(kind("fatto: \"true\"").kind).toBe("text");
    expect(kind("pagine: 12").kind).toBe("number");
    expect(kind("pagine: -3.5").kind).toBe("number");
    expect(kind("codice: \"12\"").kind).toBe("text");
    expect(kind("scadenza: 2026-03-20").kind).toBe("date");
    expect(kind("scadenza: 2026-02-30").kind).toBe("text");
    expect(kind("inizio: 2026-03-20T10:30").kind).toBe("date_time");
    expect(kind("sito: https://example.org").kind).toBe("url");
    expect(kind("luoghi: [Torino, Roma]").kind).toBe("list");
    expect(kind("persone: [\"[[Anna]]\", \"[[Bruno|Bru]]\"]").kind).toBe("people");
    expect(kind("vuoto:").kind).toBe("text");
  });

  it("le chiavi convenzionali hanno il loro tipo anche senza registro", () => {
    expect(kind("tags: [a, b]").kind).toBe("tags");
    expect(kind("aliases: [Altro]").kind).toBe("list");
  });
});

describe("le opzioni del registro", () => {
  it("si leggono per chiave, nel loro ordine; colore e gruppo mancanti o sconosciuti valgono grigio e Da fare", () => {
    const types = parsePropertyTypes(JSON.stringify({
      version: 1,
      types: { stato: "status" },
      options: { stato: [{ name: "Fatto", color: "green", group: "done" }, { name: "Nuovo", color: "viola", group: "dopo" }, { color: "red" }, "x"] },
    }));
    expect(types.options?.get("stato")).toEqual([
      { name: "Fatto", color: "green", group: "done" },
      { name: "Nuovo", color: "gray", group: "todo" },
    ]);
    expect(optionOf(types, "stato", "Fatto")?.color).toBe("green");
    expect(optionOf(types, "stato", "fatto")).toBeNull();
    expect(optionOf(types, "altro", "Fatto")).toBeNull();
  });

  it("due registri con le stesse dichiarazioni ma opzioni diverse non sono uguali", () => {
    const a = parsePropertyTypes(JSON.stringify({ version: 1, types: { stato: "status" }, options: { stato: [{ name: "Fatto", color: "green" }] } }));
    const b = parsePropertyTypes(JSON.stringify({ version: 1, types: { stato: "status" }, options: { stato: [{ name: "Fatto", color: "red" }] } }));
    const c = parsePropertyTypes(JSON.stringify({ version: 1, types: { stato: "status" }, options: { stato: [{ name: "Fatto", color: "green" }] } }));
    expect(sameTypes(a, b)).toBe(false);
    expect(sameTypes(a, c)).toBe(true);
    expect(sameTypes(a, parsePropertyTypes(JSON.stringify({ version: 1, types: { stato: "status" } })))).toBe(false);
  });
});

describe("il registro dei tipi", () => {
  const types = parsePropertyTypes(JSON.stringify({ version: 1, types: { anno: "number", fatto: "checkbox", luoghi: "list", stato: "status" }, options: {} }));

  it("vince sul valore; un valore che non torna resta testo, segnato", () => {
    expect(kind("anno: 2026", types)).toEqual({ kind: "number", declared: "number", mismatch: null });
    expect(kind("anno: presto", types)).toEqual({ kind: "text", declared: "number", mismatch: "number" });
    expect(kind("fatto: forse", types).mismatch).toBe("checkbox");
    // Un testo solo è un elenco di una voce.
    expect(kind("luoghi: Torino", types)).toEqual({ kind: "list", declared: "list", mismatch: null });
    // Selezione e Stato arrivano coi loro editor: intanto testo, non segnato.
    expect(kind("stato: aperto", types)).toEqual({ kind: "text", declared: "status", mismatch: null });
    // Vuoto torna sempre.
    expect(kind("anno:", types).mismatch).toBeNull();
  });

  it("un registro che non si legge, o di un'altra versione, è vuoto: niente si perde", () => {
    expect(parsePropertyTypes("{rotto").size).toBe(0);
    expect(parsePropertyTypes(JSON.stringify({ version: 2, types: { a: "number" } })).size).toBe(0);
    expect(parsePropertyTypes(JSON.stringify({ version: 1, types: { a: "nuovo", b: "url" } }))).toEqual(new Map([["b", "url"]]));
    expect(parsePropertyTypes(undefined).size).toBe(0);
  });
});

describe("le letture degli editor", () => {
  it("un numero all'italiana o all'inglese", () => {
    expect(parseNumber("12")).toBe(12);
    expect(parseNumber("12,5")).toBe(12.5);
    expect(parseNumber("1.234,5")).toBe(1234.5);
    expect(parseNumber("1,234.5")).toBe(1234.5);
    expect(parseNumber("1.5")).toBe(1.5);
    expect(parseNumber("tanti")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });

  it("una data del calendario, un link, le iniziali", () => {
    expect(validDate("2024-02-29")).toBe(true);
    expect(validDate("2026-02-29")).toBe(false);
    expect(linkName("[[Persone/Anna Rossi]]")).toBe("Anna Rossi");
    expect(linkName("[[Bruno Neri|Bruno]]")).toBe("Bruno");
    expect(initials("Anna Maria Rossi")).toBe("AR");
    expect(initials("Élodie")).toBe("É");
  });

  it("le voci di un elenco, in riga o una per riga, con le virgolette", () => {
    expect(entry("a: [\"x, y\", 'z', w]").items).toEqual(["x, y", "z", "w"]);
    expect(entry("a:\n  - uno\n  - \"[[Due]]\"").items).toEqual(["uno", "[[Due]]"]);
    expect(entry("a:\n  - uno").blockIndent).toBe("  ");
    expect(entry("a: testo").items).toBeNull();
  });
});
