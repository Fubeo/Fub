// Le regole con cui la shell rappresenta un'impostazione prima di disegnarla:
// quale controllo, quale passo, cosa dire del predefinito, cosa trova una
// ricerca. Senza DOM, perché sono decisioni.
import { describe, expect, it } from "vitest";
import type { SettingEntry, SettingKind } from "../host/contract";
import {
  controlFor,
  defaultText,
  isModified,
  isShortChoice,
  matchesSearch,
  normalizeSearch,
  numberStep,
  parseSettingNumber,
  sectionAnchor,
  searchTerms,
  shownChoice,
  visibleChoices,
} from "./settings-model";

function entry(
  kind: SettingKind,
  value: SettingEntry["value"],
  extra: Partial<SettingEntry["spec"]> = {},
  source: SettingEntry["source"] = "default",
): SettingEntry {
  return {
    spec: {
      key: "appearance.density",
      label: "Densità",
      description: "Compatta o allarga la spaziatura.",
      group: "Aspetto",
      scope: "machine",
      kind,
      program_writable: false,
      ...extra,
    },
    value,
    source,
  };
}

const number = (min: number | null, max: number | null, def: number) =>
  ({ kind: "number", default: def, min, max }) as const;

describe("il controllo si sceglie dalla forma del dato", () => {
  it("un interruttore è uno switch", () => {
    expect(controlFor(entry({ kind: "toggle", default: true }, true))).toEqual({ kind: "switch" });
  });

  it("una scelta da due o tre opzioni brevi è un segmentato, qualunque sia la chiave", () => {
    const options = [
      { value: "compact", label: "Compatta" },
      { value: "comfortable", label: "Comoda" },
      { value: "relaxed", label: "Rilassata" },
    ];
    expect(controlFor(entry({ kind: "choice", default: "comfortable", options }, "comfortable"))).toEqual({
      kind: "segmented",
      options,
    });
  });

  it("una scelta lunga, o con etichette lunghe, o di una sola opzione resta una tendina", () => {
    const many = ["", "240", "165", "144", "120"].map((value) => ({ value, label: `${value} fps` }));
    expect(controlFor(entry({ kind: "choice", default: "", options: many }, "")).kind).toBe("select");
    expect(isShortChoice([
      { value: "a", label: "Un'etichetta che non ci sta" },
      { value: "b", label: "B" },
    ])).toBe(false);
    expect(isShortChoice([{ value: "a", label: "A" }])).toBe(false);
  });

  it("un valore fuori dalle scelte resta visibile in una tendina", () => {
    const options = [{ value: "compact", label: "Compatta" }, { value: "relaxed", label: "Rilassata" }];
    expect(controlFor(entry({ kind: "choice", default: "compact", options }, "enorme")).kind).toBe("select");
  });

  // La modalità iniziale com'è dichiarata in `crates/fub-host/src/settings.rs`:
  // `blocks`, scelto da un Fub che aveva i Blocchi, resta valido in fondo con
  // l'etichetta di Scrittura (T4).
  const modes = [
    { value: "live_preview", label: "Scrittura" },
    { value: "source", label: "Sorgente" },
    { value: "reading", label: "Lettura" },
    { value: "blocks", label: "Scrittura" },
  ];
  const initialMode = (value: string) =>
    entry({ kind: "choice", default: "live_preview", options: modes }, value, { key: "editor.default-mode" }, "machine");

  it("due scelte con la stessa etichetta sono una: si mostra la prima", () => {
    expect(visibleChoices(modes).map((option) => option.value)).toEqual(["live_preview", "source", "reading"]);
    expect(controlFor(initialMode("source"))).toEqual({ kind: "segmented", options: modes.slice(0, 3) });
  });

  it("il valore di prima accende la scelta con la sua etichetta, e il valore resta quello scritto", () => {
    const blocks = initialMode("blocks");
    expect(shownChoice(blocks)).toBe("live_preview");
    expect(controlFor(blocks)).toEqual({ kind: "segmented", options: modes.slice(0, 3) });
    expect(blocks.value).toBe("blocks");
    expect(isModified(blocks), "la scelta resta della persona").toBe(true);
    expect(shownChoice(initialMode("reading"))).toBe("reading");
    // Un valore che non è fra le scelte resta com'è, in una tendina.
    expect(shownChoice(initialMode("pagine"))).toBe("pagine");
    expect(controlFor(initialMode("pagine")).kind).toBe("select");
  });

  it("un'opzione senza etichetta non rende lungo il segmentato: conta il ripiego", () => {
    expect(isShortChoice([{ value: "", label: "" }, { value: "dark", label: "" }])).toBe(true);
  });

  it("un numero con un intervallo dichiarato è un cursore, col passo ricavato dai numeri", () => {
    expect(controlFor(entry(number(12, 28, 16), 16))).toEqual({ kind: "range", min: 12, max: 28, step: 1 });
    expect(controlFor(entry(number(1.2, 2.4, 1.7), 1.7))).toEqual({ kind: "range", min: 1.2, max: 2.4, step: 0.1 });
  });

  it("senza uno dei due estremi, con un intervallo vuoto o con troppi passi, è un campo numerico", () => {
    expect(controlFor(entry(number(0, null, 10), 10))).toEqual({ kind: "number", min: 0, max: null });
    expect(controlFor(entry(number(1, 1, 1), 1)).kind).toBe("number");
    expect(controlFor(entry(number(0, 3650, 0), 0)).kind).toBe("number");
  });

  it("un intervallo più fine del centesimo resta un campo: il cursore non lo saprebbe rappresentare", () => {
    expect(controlFor(entry(number(0.001, 0.009, 0.005), 0.005)).kind).toBe("number");
    expect(controlFor(entry(number(0, 1, 0.5), 1e-7)).kind).toBe("number");
    expect(controlFor(entry(number(-1, 1, 0), 0.25)).kind).toBe("range");
  });

  it("testo ed elenchi restano testo ed elenchi", () => {
    expect(controlFor(entry({ kind: "text", default: "" }, "")).kind).toBe("text");
    expect(controlFor(entry({ kind: "list", default: [] }, [])).kind).toBe("list");
  });
});

describe("il passo di un cursore", () => {
  it("è uno se tutti i numeri sono interi", () => {
    expect(numberStep(number(0, 360, 130), 130)).toBe(1);
  });

  it("è la decina del numero più fine, fino al centesimo", () => {
    expect(numberStep(number(0.5, 2, 1), 1)).toBe(0.1);
    expect(numberStep(number(0.5, 2, 1), 1.25)).toBe(0.01);
    expect(numberStep(number(0, 1, 0.5), 0.3333)).toBe(0.01);
  });
});

describe("il predefinito come si vedrebbe", () => {
  it("una scelta dice l'etichetta dell'opzione, non il valore", () => {
    const kind: SettingKind = {
      kind: "choice",
      default: "",
      options: [{ value: "", label: "Come il sistema" }, { value: "dark", label: "Scuro" }],
    };
    expect(defaultText(entry(kind, "dark"))).toBe("Come il sistema");
  });

  it("un interruttore dice acceso o spento, un testo vuoto dice vuoto", () => {
    expect(defaultText(entry({ kind: "toggle", default: true }, false))).toBe("acceso");
    expect(defaultText(entry({ kind: "text", default: "" }, "x"))).toBe("vuoto");
    expect(defaultText(entry({ kind: "list", default: [] }, ["a"]))).toBe("niente");
    expect(defaultText(entry(number(12, 28, 16), 20))).toBe("16");
    expect(defaultText(entry({ kind: "text", default: "" }, "it"), "Come il sistema")).toBe("Come il sistema");
  });
});

describe("modificata vuol dire scelta a qualche livello", () => {
  it("anche se il valore scelto coincide col predefinito", () => {
    expect(isModified(entry({ kind: "toggle", default: true }, true, {}, "machine"))).toBe(true);
    expect(isModified(entry({ kind: "toggle", default: true }, true, {}, "vault"))).toBe(true);
    expect(isModified(entry({ kind: "toggle", default: true }, false))).toBe(false);
  });
});

describe("la ricerca", () => {
  const density = entry(
    {
      kind: "choice",
      default: "comfortable",
      options: [{ value: "compact", label: "Compatta" }, { value: "relaxed", label: "Rilassata" }],
    },
    "comfortable",
  );

  it("ignora maiuscole e diacritici", () => {
    expect(normalizeSearch("Densità")).toBe("densita");
    expect(matchesSearch(density, "DENSITA")).toBe(true);
  });

  it("trova per etichetta, prosa, chiave, gruppo ed etichette delle opzioni", () => {
    expect(matchesSearch(density, "spaziatura")).toBe(true);
    expect(matchesSearch(density, "appearance.density")).toBe(true);
    expect(matchesSearch(density, "aspetto")).toBe(true);
    expect(matchesSearch(density, "rilassata")).toBe(true);
  });

  it("vuole ogni parola, in qualunque ordine", () => {
    expect(matchesSearch(density, "spaziatura densità")).toBe(true);
    expect(matchesSearch(density, "densità editor")).toBe(false);
  });

  it("una ricerca vuota trova tutto, «solo modificate» solo ciò che è stato scelto", () => {
    expect(searchTerms("   ")).toEqual([]);
    expect(matchesSearch(density, "")).toBe(true);
    expect(matchesSearch(density, "", true)).toBe(false);
    expect(matchesSearch({ ...density, source: "machine" }, "", true)).toBe(true);
  });
});

describe("le ancore delle sezioni", () => {
  it("sono stabili, uniche per posizione e senza caratteri da temere", () => {
    expect(sectionAnchor("Template e giornaliere", 13)).toBe("settings-section-13-template-e-giornaliere");
    expect(sectionAnchor("Proprietà", 10)).toBe("settings-section-10-proprieta");
    expect(sectionAnchor("…", 2)).toBe("settings-section-2");
  });
});

describe("il numero scritto nel campo di una riga", () => {
  const open = { kind: "number", default: 10, min: 0, max: null } as const;
  const read = (text: string, language = "en", kind: Extract<SettingKind, { kind: "number" }> = open) =>
    parseSettingNumber(text, kind, language);

  it("la virgola e il punto separano i decimali, in ogni lingua", () => {
    for (const language of ["en", "it"]) {
      expect(read("1,5", language)).toEqual({ value: 1.5 });
      expect(read("1.5", language)).toEqual({ value: 1.5 });
      expect(read(" 12 ", language)).toEqual({ value: 12 });
    }
  });

  it("ciò che non è il numero scritto si rifiuta col suo motivo", () => {
    expect(read("")).toEqual({ problem: "empty" });
    expect(read("   ")).toEqual({ problem: "empty" });
    expect(read("abc")).toEqual({ problem: "syntax" });
    expect(read("12px")).toEqual({ problem: "syntax" });
    expect(read("1e400")).toEqual({ problem: "finite" });
    expect(read("99999999999999999999")).toEqual({ problem: "precision" });
    expect(read("100000000000000000000")).toEqual({ problem: "precision" });
    expect(read("0.1234567890123456")).toEqual({ problem: "precision" });
    expect(read("123456789012345")).toEqual({ value: 123456789012345 });
  });

  it("un numero che nella lingua si legge anche come migliaia non si indovina", () => {
    expect(read("1,500", "en")).toEqual({ problem: "ambiguous" });
    expect(read("1,500", "it")).toEqual({ value: 1.5 });
    expect(read("1.500", "it")).toEqual({ problem: "ambiguous" });
    expect(read("1.500", "en")).toEqual({ value: 1.5 });
    expect(read("0,500", "en")).toEqual({ value: 0.5 });
    expect(read("1,5000", "en")).toEqual({ value: 1.5 });
  });

  it("gli estremi sono quelli dello schema", () => {
    const bounded = { kind: "number", default: 16, min: 12, max: 28 } as const;
    expect(read("-7")).toEqual({ problem: "min", min: 0 });
    expect(read("11", "en", bounded)).toEqual({ problem: "min", min: 12 });
    expect(read("29", "en", bounded)).toEqual({ problem: "max", max: 28 });
    expect(read("28", "en", bounded)).toEqual({ value: 28 });
  });
});
