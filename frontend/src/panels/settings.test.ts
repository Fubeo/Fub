// Le due regole del pannello delle impostazioni (§11.1), provate senza DOM:
// **come si raggruppano le righe** e **cosa si dice della provenienza di un
// valore**. Il resto del modulo è DOM e IPC; queste due sono decisioni, e una
// decisione che si prova solo aprendo l'app non la prova nessuno.
import { describe, expect, it } from "vitest";
import type { SettingEntry, SettingSource, SettingScope } from "../host/contract";
import { sourceLabel, groupEntries } from "./settings";

function entry(
  key: string,
  group: string,
  source: SettingSource = "default",
  scope: SettingScope = "vault",
): SettingEntry {
  return {
    spec: {
      key,
      label: key,
      description: "",
      group,
      scope,
      kind: { kind: "toggle", default: false },
      program_writable: false,
    },
    value: false,
    source,
  };
}

describe("il form generato dallo schema", () => {
  it("i gruppi escono nell'ordine di prima apparizione, non in ordine alfabetico", () => {
    // Chi dichiara le proprie impostazioni le scrive nell'ordine in cui vanno
    // lette: ordinarle per nome metterebbe «Avanzate» prima di «Generali».
    const groups = groupEntries([
      entry("z", "Vault"),
      entry("a", "Componenti"),
      entry("b", "Vault"),
    ]);
    expect(groups.map((g) => g.title)).toEqual(["Vault", "Componenti"]);
    expect(groups[0].rows.map((r) => r.spec.key)).toEqual(["z", "b"]);
  });

  it("le righe senza gruppo vanno in fondo, sotto un'intestazione loro", () => {
    // In mezzo sembrerebbero del gruppo precedente, che è il modo più facile di
    // far credere a un utente che un'impostazione riguardi un'altra cosa.
    const groups = groupEntries([entry("sciolta", ""), entry("a", "Vault")]);
    expect(groups.map((g) => g.title)).toEqual(["Vault", "Altro"]);
    expect(groups[1].rows.map((r) => r.spec.key)).toEqual(["sciolta"]);
  });

  it("senza righe non ci sono gruppi, nemmeno quello di scarto", () => {
    expect(groupEntries([])).toEqual([]);
  });

  it("la provenienza dice se il valore viaggia col vault", () => {
    // È l'informazione che un utente non può dedurre: due righe identiche si
    // toccano allo stesso modo e si comportano diversamente su un'altra
    // macchina.
    expect(sourceLabel(entry("a", "", "default", "machine"))).toContain("questa macchina");
    expect(sourceLabel(entry("a", "", "default", "vault"))).toContain("questo vault");
    expect(sourceLabel(entry("a", "", "vault"))).toBe("scelto per questo vault");
    expect(sourceLabel(entry("a", "", "machine"))).toBe("scelto per questa macchina");
  });
});
