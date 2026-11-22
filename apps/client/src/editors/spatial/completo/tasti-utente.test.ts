// I tasti dell'utente (`draw.keys`) e i file d'insieme del motore (K6 T9c):
// la versione, il valore rotto o più nuovo che non si riscrive, l'ultimo
// assegnato che vince, e un file rotto che non cambia niente.

import { afterEach, describe, expect, it, vi } from "vitest";
import { risolviTasti } from "./tasti";
import {
  TASTI_VUOTI,
  assegnaTasto,
  esportaInsieme,
  importaInsieme,
  leggiTasti,
  ripristinaTasto,
  scegliInsieme,
  scriviTasti,
  tastiVuoti,
  tastoMotore,
} from "./tasti-utente";

afterEach(() => vi.restoreAllMocks());

describe("il valore di draw.keys", () => {
  it("vuoto vale i tasti del motore", () => {
    expect(leggiTasti("")).toEqual({ stato: "vuoto", valore: TASTI_VUOTI });
    expect(tastiVuoti(TASTI_VUOTI)).toBe(true);
  });

  it("si scrive con la sua versione e si rilegge uguale", () => {
    const valore = assegnaTasto(scegliInsieme("classico"), "shape.round", "Mod-Alt-r");
    const testo = scriviTasti(valore);
    expect(JSON.parse(testo)).toEqual({ v: 1, insieme: "classico", tasti: { "shape.round": "Mod-Alt-r" } });
    expect(leggiTasti(testo)).toEqual({ stato: "ok", valore });
  });

  it("un valore rotto vale come vuoto, con un avviso", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const rotto of ["{", "[]", '{"tasti":{}}', '{"v":1,"tasti":{"a":3}}', '{"v":1,"insieme":"altro"}', 7]) {
      expect(leggiTasti(rotto).stato, String(rotto)).toBe("rotto");
      expect(leggiTasti(rotto).valore).toEqual(TASTI_VUOTI);
    }
    expect(warn).toHaveBeenCalled();
  });

  it("una versione più nuova si legge ma si dice", () => {
    const lettura = leggiTasti('{"v":2,"tasti":{"a":"Mod-j"},"altro":true}');
    expect(lettura).toEqual({ stato: "nuovo", versione: 2, valore: { insieme: null, tasti: { a: "Mod-j" } } });
    // Con una forma che non si conosce, i tasti restano quelli del motore.
    expect(leggiTasti('{"v":3,"tasti":[1]}').valore.tasti).toEqual({});
  });

  it("chi riassegna va in fondo, e vince il conflitto", () => {
    let valore = assegnaTasto(TASTI_VUOTI, "a", "Mod-j");
    valore = assegnaTasto(valore, "b", "Mod-j");
    expect(risolviTasti([{ id: "a", tasto: null }, { id: "b", tasto: null }], valore.tasti, "other", []).tasti.get("b")).toBe("Mod-j");
    valore = assegnaTasto(valore, "a", "Mod-j");
    expect(Object.keys(valore.tasti)).toEqual(["b", "a"]);
    const regola = risolviTasti([{ id: "a", tasto: null }, { id: "b", tasto: null }], valore.tasti, "other", []);
    expect(regola.tasti.get("a")).toBe("Mod-j");
    expect(regola.conflitti).toEqual([{ tasto: "Mod-j", vince: "a", perde: ["b"] }]);
  });

  it("ripristinare toglie la modifica; scegliere un insieme le toglie tutte", () => {
    const valore = assegnaTasto(assegnaTasto(TASTI_VUOTI, "a", null), "b", "Mod-j");
    expect(ripristinaTasto(valore, "a").tasti).toEqual({ b: "Mod-j" });
    expect(ripristinaTasto(valore, "c")).toBe(valore);
    expect(scegliInsieme("serie")).toEqual({ insieme: "serie", tasti: {} });
  });
});

describe("i file d'insieme del motore", () => {
  const noti = new Set(["shape.round", "edit.undo"]);

  it("si legge un file del motore, coi tasti del motore", () => {
    const testo = JSON.stringify({
      format: "vectorcraft-shortcuts",
      version: 1,
      set: "Custom",
      overrides: { "shape.round": "Cmd+Alt+R", "edit.undo": "", "altro.comando": "Cmd+J" },
    });
    expect(importaInsieme(testo, noti)).toEqual({
      ok: { valore: { insieme: null, tasti: { "shape.round": "Mod-Alt-R", "edit.undo": null } }, ignorati: 1 },
    });
  });

  it("un nome vecchio dell'insieme si legge come quello di oggi", () => {
    const testo = JSON.stringify({ format: "vectorcraft-shortcuts", version: 1, set: "Illustrator Defaults", overrides: {} });
    expect(importaInsieme(testo, noti)).toEqual({ ok: { valore: { insieme: "classico", tasti: {} }, ignorati: 0 } });
  });

  it("un file rotto dice perché, e non dà niente", () => {
    expect(importaInsieme("{", noti)).toEqual({ errore: { tipo: "json" } });
    expect(importaInsieme('{"format":"altro","version":1,"overrides":{}}', noti)).toEqual({ errore: { tipo: "formato" } });
    expect(importaInsieme('{"format":"vectorcraft-shortcuts","version":1}', noti)).toEqual({ errore: { tipo: "formato" } });
    expect(importaInsieme('{"format":"vectorcraft-shortcuts","version":1,"overrides":{"a":3}}', noti)).toEqual({ errore: { tipo: "formato" } });
    expect(importaInsieme('{"format":"vectorcraft-shortcuts","version":9,"overrides":{}}', noti)).toEqual({
      errore: { tipo: "versione", versione: 9 },
    });
    expect(importaInsieme('{"format":"vectorcraft-shortcuts","version":1,"overrides":{"edit.undo":"Cmd+Shift+1"}}', noti)).toEqual({
      errore: { tipo: "tasto", comando: "edit.undo", tasto: "Cmd+Shift+1" },
    });
    expect(importaInsieme(" ".repeat(1024 * 1024 + 1), noti)).toEqual({ errore: { tipo: "grande" } });
  });

  it("si esporta nel formato del motore, e si rilegge uguale", () => {
    const valore = assegnaTasto(assegnaTasto(TASTI_VUOTI, "shape.round", "Mod-Alt-r"), "edit.undo", null);
    const testo = esportaInsieme(valore);
    expect(JSON.parse(testo)).toEqual({
      format: "vectorcraft-shortcuts",
      version: 1,
      set: "Custom",
      overrides: { "shape.round": "Cmd+Alt+R", "edit.undo": "" },
    });
    const riletto = importaInsieme(testo, noti);
    expect("ok" in riletto && riletto.ok.valore.tasti).toEqual({ "shape.round": "Mod-Alt-R", "edit.undo": null });
    expect(JSON.parse(esportaInsieme(scegliInsieme("classico"))).set).toBe("Classic Defaults");
  });

  it("i tasti di Fub si scrivono come li scrive il motore", () => {
    expect(tastoMotore("Mod-Shift-k")).toBe("Cmd+Shift+K");
    expect(tastoMotore("Ctrl-Alt-ArrowLeft")).toBe("Ctrl+Alt+ArrowLeft");
    expect(tastoMotore("F5")).toBe("F5");
    expect(tastoMotore("Mod--")).toBe("Cmd+-");
    expect(tastoMotore("k")).toBeNull();
  });
});
