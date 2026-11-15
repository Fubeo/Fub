import { describe, expect, it } from "vitest";
import {
  allOf, conditionDef, conjuncts, filterOfSearch, filterOfVisual, filterValue, isOpaque, parseFilter, sameFilter,
  searchOf, typedValue, visualOf, withoutConjunct, type FilterDef,
} from "./filter";

const stato: FilterDef = { condition: { property: "stato", op: "contains", value: "Arrivata" } };
const artista: FilterDef = { condition: { property: "artista", op: "is", value: "Elena Sala" } };

describe("il filtro come lo legge il piano", () => {
  it("toglie i campi null che serde scrive, perché riscritto non porti righe vuote", () => {
    const raw = { and: [{ condition: { property: "stato", file: null, formula: null, tag: null, op: "contains", value: "Arrivata" } }] };
    expect(parseFilter(raw)).toEqual({ and: [stato] });
    expect(parseFilter("all")).toBe("all");
    expect(parseFilter(null)).toBe("all");
  });

  it("un valore lista resta com'è scritto e non si riscrive", () => {
    const raw = { condition: { property: "tags", op: "contains", value: ["a", "b"] } };
    const parsed = parseFilter(raw);
    expect(isOpaque(parsed)).toBe(true);
    expect(visualOf(parsed)).toBeNull();
    expect(searchOf(parsed)).toBeNull();
  });

  it("rifiuta una forma che il modello non produce", () => {
    expect(() => parseFilter({ condition: { property: "x", op: "matches" } })).toThrow();
    expect(() => parseFilter({ and: [], or: [] })).toThrow();
    expect(() => parseFilter([1])).toThrow();
  });
});

describe("le due forme del filtro", () => {
  it("una condizione di contenuto si dice a vista e come ricerca", () => {
    expect(visualOf(stato)).toEqual([{ subject: "stato", op: "contains", value: "Arrivata" }]);
    expect(searchOf(stato)).toBe("[stato:Arrivata]");
    expect(filterOfSearch("[stato:Arrivata]")).toEqual({ ok: stato });
  });

  it("«è» resta a vista: la ricerca sa dire solo «contiene»", () => {
    expect(visualOf(artista)).toEqual([{ subject: "artista", op: "is", value: "Elena Sala" }]);
    expect(searchOf(artista)).toBeNull();
  });

  it("un «oppure» resta come ricerca: la forma a vista non lo sa dire", () => {
    const either: FilterDef = { or: [stato, { condition: { property: "stato", op: "contains", value: "In prestito" } }] };
    expect(visualOf(either)).toBeNull();
    expect(searchOf(either)).toBe('[stato:Arrivata] OR [stato:"In prestito"]');
    expect(filterOfSearch('[stato:Arrivata] OR [stato:"In prestito"]')).toEqual({ ok: either });
  });

  it("la negazione, l'esistenza, i confronti e la cartella vanno e tornano", () => {
    const line = '-[stato:Arrivata] [consegna] [valore:>3000] folder:Opere -folder:Archivio';
    const parsed = filterOfSearch(line);
    expect("ok" in parsed).toBe(true);
    const filter = (parsed as { ok: FilterDef }).ok;
    expect(searchOf(filter)).toBe(line);
    expect(visualOf(filter)).toEqual([
      { subject: "stato", op: "not_contains", value: "Arrivata" },
      { subject: "consegna", op: "is_not_empty", value: "" },
      { subject: "valore", op: "greater_than", value: "3000" },
      { subject: null, op: "in_folder", value: "Opere" },
      { subject: null, op: "not_in_folder", value: "Archivio" },
    ]);
  });

  it("la forma a vista diventa l'albero del modello, senza le condizioni a metà", () => {
    expect(filterOfVisual([
      { subject: "stato", op: "is", value: "Arrivata" },
      { subject: "valore", op: "greater_than", value: "3000" },
      { subject: "artista", op: "contains", value: "" },
      { subject: null, op: "in_folder", value: "/Opere/" },
    ])).toEqual({ and: [
      { condition: { property: "stato", op: "is", value: "Arrivata" } },
      { condition: { property: "valore", op: "greater_than", value: 3000 } },
      { condition: { file: "path", op: "in_folder", value: "Opere" } },
    ] });
    expect(filterOfVisual([])).toBe("all");
    expect(conditionDef({ subject: "x", op: "is_empty", value: "ignorato" })).toEqual({ condition: { property: "x", op: "is_empty" } });
  });

  it("una ricerca nel testo o nei tag non diventa un filtro, e lo dice", () => {
    expect(filterOfSearch("tela")).toEqual({ problem: { kind: "unsupported", term: "tela" } });
    expect(filterOfSearch("tag:mostra")).toEqual({ problem: { kind: "unsupported", term: "tag:mostra" } });
    const broken = filterOfSearch("[stato:Arrivata");
    expect("problem" in broken && broken.problem.kind).toBe("syntax");
    expect(filterOfSearch("   ")).toEqual({ ok: "all" });
  });

  it("i valori scritti come numero e booleano restano tali; il resto è testo", () => {
    expect(typedValue("12")).toBe(12);
    expect(typedValue("true")).toBe(true);
    expect(typedValue("2026-11-10")).toBe("2026-11-10");
    expect(typedValue(" Arrivata ")).toBe("Arrivata");
  });
});

describe("le etichette del filtro", () => {
  it("togliere una condizione lascia le altre, nella forma più corta", () => {
    const both = allOf([stato, artista]);
    expect(conjuncts(both)).toEqual([stato, artista]);
    expect(withoutConjunct(both, 0)).toEqual(artista);
    expect(withoutConjunct(artista, 0)).toBe("all");
    expect(filterValue("all")).toBeNull();
    expect(sameFilter(both, { and: [stato, artista] })).toBe(true);
  });
});
