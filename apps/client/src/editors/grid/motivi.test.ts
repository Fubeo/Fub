// I perché del motore dei fogli nella lingua della shell: ogni frase che il
// motore e l'adattatore possono dire (`motivi.generated.json`) ha la sua
// chiave in ogni lingua, e una frase che non si conosce non si perde.
import { afterEach, describe, expect, it, vi } from "vitest";
import generated from "./motivi.generated.json";
import { MOTIVI, motivo, motivoKey } from "./motivi";
import { fogliStrings } from "./palette/strings";

const FRASI = (generated as { frasi: readonly { frase: string }[] }).frasi.map((one) => one.frase);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("i perché del motore", () => {
  it("il file generato ha delle frasi, e ognuna è fra quelle note", () => {
    expect(FRASI.length).toBeGreaterThan(10);
    const known = new Set(MOTIVI.map((one) => one.frase));
    for (const frase of FRASI) expect(known.has(frase), frase).toBe(true);
  });

  it("ogni frase ha la sua chiave, scritta in italiano e in inglese", () => {
    const it = fogliStrings.catalogFor("it");
    const en = fogliStrings.catalogFor("en");
    for (const one of MOTIVI) {
      expect(it[one.chiave], one.chiave).toBeTruthy();
      expect(en[one.chiave], one.chiave).toBeTruthy();
      // I segnaposti della frase passano nella traduzione.
      for (const [, name] of one.frase.matchAll(/\{(\w+)\}/g)) {
        expect(it[one.chiave], `${one.chiave} {${name}}`).toContain(`{${name}}`);
        expect(en[one.chiave], `${one.chiave} {${name}}`).toContain(`{${name}}`);
      }
    }
  });

  it("riconosce ogni frase, anche con i parametri dentro", () => {
    for (const one of MOTIVI) {
      const sample = one.frase.replace(/\{(\w+)\}/g, (_, name: string) => `valore-${name}`);
      expect(motivoKey(sample)?.key, one.frase).toBe(one.chiave);
    }
  });

  it("traduce una frase semplice, senza badare alle maiuscole e al punto", () => {
    expect(motivo("nothing to undo")).toBe("Non c'è niente da annullare.");
    expect(motivo("Nothing to undo.")).toBe("Non c'è niente da annullare.");
  });

  it("una frase con un numero lo porta nella traduzione", () => {
    expect(motivo("rewriting the workbook would lose 2 item(s)")).toBe(
      "Riscrivere la cartella perderebbe delle parti che Fub non sa scrivere (elementi: 2).",
    );
    expect(motivo("the workbook cannot be rewritten: disk full")).toBe("Non riesco a riscrivere la cartella: disk full");
  });

  it("un perché dentro un perché si traduce, e il nome del comando diventa il suo titolo", () => {
    expect(motivo("command `edit.undo` is not available right now: nothing to undo")).toBe(
      "«Annulla» adesso non si può usare: Non c'è niente da annullare.",
    );
    // Un comando che il catalogo non conosce resta col suo nome.
    expect(motivo("unknown command `nuovo.comando`")).toBe("Il comando «nuovo.comando» non esiste.");
  });

  it("dopo una frase nota il dettaglio resta", () => {
    expect(motivo("select a cell in a table: Table1 is hidden")).toBe("Seleziona una cella di una tabella. (Table1 is hidden)");
  });

  it("trova la frase nota dopo un prefisso di chi la passa", () => {
    expect(motivo("bad_args: nothing to redo")).toBe("Non c'è niente da ripetere.");
  });

  it("una frase sconosciuta non si perde: la cita la frase generica", () => {
    const said = motivo("the moon is in the wrong phase.");
    expect(said).toBe("Il motore dei fogli non lo permette e dice: «the moon is in the wrong phase».");
    expect(motivo("")).toBeNull();
    expect(motivo(null)).toBeNull();
    expect(motivo("   ")).toBeNull();
  });

  it("parla inglese quando l'interfaccia lo parla", () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("en-US");
    expect(motivo("nothing to undo")).toBe(fogliStrings.catalogFor("en")["fogli.motivo.nothing_to_undo"]);
    expect(motivo("something new")).toContain("something new");
  });
});
