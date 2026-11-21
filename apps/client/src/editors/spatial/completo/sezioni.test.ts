// Il registro delle sezioni dell'ispettore (piano K6, T10): un id per scheda,
// l'ordine della mappa, gli avvisi e la chiusura.
import { describe, expect, it, vi } from "vitest";
import { creaSezioni, registraSezione, type Sezione } from "./sezioni";

const voce = (id: string, extra: Partial<Sezione> = {}): Sezione => ({
  id,
  scheda: "risorse",
  titolo: id,
  disegna: () => undefined,
  ...extra,
});

describe("il registro delle sezioni", () => {
  it("rifiuta una seconda sezione con lo stesso id nella stessa scheda", () => {
    const sezioni = creaSezioni();
    expect(sezioni.registra(voce("campioni", { titolo: "prima" }))).toBe(true);
    expect(sezioni.registra(voce("campioni", { titolo: "seconda" }))).toBe(false);
    expect(sezioni.di("risorse").map((each) => each.titolo)).toEqual(["prima"]);
  });

  it("accetta lo stesso id in un'altra scheda", () => {
    const sezioni = creaSezioni();
    expect(sezioni.registra(voce("stili", { scheda: "risorse" }))).toBe(true);
    expect(sezioni.registra(voce("stili", { scheda: "design" }))).toBe(true);
    expect(sezioni.di("design").map((each) => each.id)).toEqual(["stili"]);
  });

  it("mette le sezioni con ordine prima, per numero, poi quelle senza, per arrivo", () => {
    const sezioni = creaSezioni();
    sezioni.registra(voce("senza-uno"));
    sezioni.registra(voce("venti", { ordine: 20 }));
    sezioni.registra(voce("senza-due"));
    sezioni.registra(voce("cinque", { ordine: 5 }));
    expect(sezioni.di("risorse").map((each) => each.id)).toEqual(["cinque", "venti", "senza-uno", "senza-due"]);
  });

  it("separa le schede", () => {
    const sezioni = creaSezioni();
    sezioni.registra(voce("campioni", { scheda: "risorse" }));
    sezioni.registra(voce("documento", { scheda: "design" }));
    expect(sezioni.di("risorse").map((each) => each.id)).toEqual(["campioni"]);
    expect(sezioni.di("livelli")).toEqual([]);
  });

  it("avvisa a ogni sezione nuova, e il disposer toglie l'ascolto", () => {
    const sezioni = creaSezioni();
    const ascolto = vi.fn();
    const via = sezioni.ascolta(ascolto);
    sezioni.registra(voce("uno"));
    expect(ascolto).toHaveBeenCalledTimes(1);
    via();
    sezioni.registra(voce("due"));
    expect(ascolto).toHaveBeenCalledTimes(1);
  });

  it("chiudi svuota il registro, avvisa una volta e non accetta più sezioni", () => {
    const sezioni = creaSezioni();
    sezioni.registra(voce("uno"));
    const ascolto = vi.fn();
    sezioni.ascolta(ascolto);
    sezioni.chiudi();
    expect(ascolto).toHaveBeenCalledTimes(1);
    expect(sezioni.di("risorse")).toEqual([]);
    expect(sezioni.registra(voce("due"))).toBe(false);
    sezioni.chiudi();
    expect(ascolto).toHaveBeenCalledTimes(1);
  });

  it("registraSezione passa la sezione al registro del contesto", () => {
    const sezioni = creaSezioni();
    expect(registraSezione({ sezioni }, voce("campioni"))).toBe(true);
    expect(registraSezione({ sezioni }, voce("campioni"))).toBe(false);
    expect(sezioni.di("risorse")).toHaveLength(1);
  });
});
