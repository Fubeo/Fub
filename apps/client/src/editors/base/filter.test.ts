import { describe, expect, it } from "vitest";
import {
  allOf, conditionDef, conjuncts, filterOfSearch, filterOfVisual, filterProperties, filterValue, isOpaque, numberAsText, parseFilter, sameFilter,
  propertyKind, propertyOps, propertyValues, readNumber, searchOf, typedValue, valueProblem, visualOf, withoutConjunct,
  type FilterDef, type ValueTyping,
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

describe("i valori nella loro specie", () => {
  const typing = (kinds: Record<string, "date" | "number">, decimal: "," | "." = ","): ValueTyping =>
    ({ kind: (key) => kinds[key] ?? "other", decimal });

  it("un numero si legge coi decimali della lingua e si scrive come numero", () => {
    expect(readNumber("3,5", ",")).toBe(3.5);
    expect(readNumber("1.000", ",")).toBe(1000);
    expect(readNumber("1.000,25", ",")).toBe(1000.25);
    // «3.5» in italiano non si sa se è tre e mezzo o trentacinque.
    expect(readNumber("3.5", ",")).toBeNull();
    expect(readNumber("3.5", ".")).toBe(3.5);
    const valore = typing({ valore: "number" });
    expect(filterOfVisual([{ subject: "valore", op: "greater_than", value: "3000,5" }], valore))
      .toEqual({ condition: { property: "valore", op: "greater_than", value: 3000.5 } });
    expect(visualOf({ condition: { property: "valore", op: "less_than", value: 2.5 } }, valore))
      .toEqual([{ subject: "valore", op: "less_than", value: "2,5" }]);
    expect(valueProblem({ subject: "valore", op: "greater_than", value: "tremila" }, valore)).toBe("number");
    expect(valueProblem({ subject: "valore", op: "greater_than", value: "3000" }, valore)).toBeNull();
  });

  it("una data si scrive ISO, e una data che non c'è sul calendario non passa", () => {
    const consegna = typing({ consegna: "date" });
    expect(filterOfVisual([{ subject: "consegna", op: "less_than", value: "2026-03-18" }], consegna))
      .toEqual({ condition: { property: "consegna", op: "less_than", value: "2026-03-18" } });
    expect(valueProblem({ subject: "consegna", op: "is", value: "2026-02-30" }, consegna)).toBe("date");
    expect(valueProblem({ subject: "consegna", op: "is", value: "18/03/2026" }, consegna)).toBe("date");
    // Un numero e una data non si «contengono».
    expect(propertyOps("date")).not.toContain("contains");
    expect(propertyOps("number")).not.toContain("not_contains");
    expect(propertyOps("other")).toContain("contains");
  });

  it("la specie di una proprietà viene dai valori delle righe, nella forma del contratto", () => {
    const date = { kind: "date", value: { year: 2026, month: 3, day: 8, time: null } };
    expect(propertyValues(date)).toEqual([{ value: "2026-03-08", kind: "date" }]);
    expect(propertyValues({ kind: "list", value: [{ kind: "text", value: "a" }, { kind: "number", value: 2 }] }))
      .toEqual([{ value: "a", kind: "other" }, { value: 2, kind: "number" }]);
    expect(propertyValues({ kind: "unknown", value: { a: 1 } })).toEqual([]);
    expect(propertyKind([date, undefined, date])).toBe("date");
    expect(propertyKind([{ kind: "number", value: 3 }, 4])).toBe("number");
    expect(propertyKind([date, { kind: "text", value: "presto" }])).toBe("other");
    expect(propertyKind([undefined])).toBe("other");
  });

  it("una data con l'orario è il suo giorno, come la confronta il modello", () => {
    // Il giorno scritto, anche quando il fuso lo sposterebbe in UTC: il
    // modello confronta una data senza orario col giorno civile
    // (`civil_days` in `crates/fub-features/src/base.rs`).
    const early = { kind: "date", value: { year: 2026, month: 3, day: 18, time: { hour: 1, minute: 30, second: 0, offset_minutes: 120 } } };
    const local = { kind: "date", value: { year: 2026, month: 3, day: 18, time: { hour: 9, minute: 0, second: 0, offset_minutes: null } } };
    expect(propertyValues(early)).toEqual([{ value: "2026-03-18", kind: "date" }]);
    expect(propertyValues(local)).toEqual([{ value: "2026-03-18", kind: "date" }]);
    expect(propertyKind([early, local])).toBe("date");
  });

  it("un numero della lingua in una proprietà mista si cerca come testo, e la barra lo dice", () => {
    const mixed = typing({});
    const italian: ValueTyping = { kind: mixed.kind, decimal: "," };
    expect(numberAsText({ subject: "valore", op: "is", value: "3000,5" }, italian)).toBe("3000.5");
    expect(filterOfVisual([{ subject: "valore", op: "is", value: "3000,5" }], italian))
      .toEqual({ condition: { property: "valore", op: "is", value: "3000,5" } });
    // La forma canonica è già un numero; un testo non è un numero; col punto
    // la lingua e il file dicono lo stesso.
    expect(numberAsText({ subject: "valore", op: "is", value: "3000" }, italian)).toBeNull();
    expect(numberAsText({ subject: "valore", op: "is", value: "presto" }, italian)).toBeNull();
    expect(numberAsText({ subject: "valore", op: "is", value: "3000,5" }, { kind: mixed.kind, decimal: "." })).toBeNull();
    expect(numberAsText({ subject: "valore", op: "is_empty", value: "3,5" }, italian)).toBeNull();
    // Una proprietà numero legge la lingua: niente da dire.
    expect(numberAsText({ subject: "valore", op: "is", value: "3000,5" }, { ...typing({ valore: "number" }), decimal: "," })).toBeNull();
  });
});

describe("la forma di ricerca dei valori", () => {
  const round = (value: string): void => {
    const filter: FilterDef = { condition: { property: "nota", op: "contains", value } };
    const line = searchOf(filter);
    expect(line, value).not.toBeNull();
    expect(filterOfSearch(line!), value).toEqual({ ok: filter });
  };

  it("un valore torna uguale dalla riga di ricerca: virgolette, due punti, accenti, parole della sintassi", () => {
    for (const value of ['di "lui"', '"tutto fra virgolette"', "a:b", "città è", "-meno", "OR", "(fra parentesi)", "In prestito", ">tre", "2026-03-18"]) round(value);
  });

  it("un valore che la riga non sa dire resta solo a vista", () => {
    for (const value of ["con ] dentro", " spazio in testa", "12", "true"]) {
      expect(searchOf({ condition: { property: "nota", op: "contains", value } }), value).toBeNull();
    }
  });

  it("un nome di proprietà che le righe non hanno resta un filtro: la barra avverte, non ferma", () => {
    expect(filterOfSearch("[sttao:Arrivata]")).toEqual({ ok: { condition: { property: "sttao", op: "contains", value: "Arrivata" } } });
  });

  it("le proprietà che un filtro nomina, una volta ciascuna, senza cartelle né tag", () => {
    const filter: FilterDef = { and: [
      { condition: { property: "stato", op: "is", value: "a" } },
      { or: [{ condition: { property: "valore", op: "greater_than", value: 3 } }, { not: { condition: { property: "stato", op: "is_empty" } } }] },
      { condition: { file: "path", op: "in_folder", value: "Opere" } },
      { condition: { tag: "lavoro", op: "has_tag" } },
    ] };
    expect(filterProperties(filter)).toEqual(["stato", "valore"]);
    expect(filterProperties("all")).toEqual([]);
    expect(filterProperties({ opaque: [1] })).toEqual([]);
  });
});
