// Le regole del centro attività (§10.3): come un evento cambia l'elenco dei
// lavori, e quando l'elenco va **richiesto da capo**.
//
// La seconda metà è quella che non si vede provando l'app a mano, perché
// richiede che uno dei due freni del canale (decisione 0034) abbia buttato
// qualcosa — cioè un vault sotto carico. Qui è un caso di test.
import { describe, expect, it } from "vitest";
import type { KernelEvent, KernelNotice } from "../host/contract";
import { applica, avvisoDi, etichettaDi, type Lavoro } from "./activity";

function notice(event: KernelEvent): KernelNotice {
  return { event, origin: { actor: { kind: "kernel" }, batch: null } };
}

const AVVIATO = notice({ type: "job_started", id: "7", job: "export" });

function passo(id: string, done: number, total: number | null = 3, label: string | null = null) {
  return notice({ type: "job_progress", id, progress: { done, total, label } });
}

describe("l'elenco dei lavori in corso", () => {
  it("una riga compare quando il lavoro è accettato", () => {
    const { lavori, riconcilia } = applica([], AVVIATO);
    expect(lavori).toEqual([{ id: "7", job: "export", progress: null }]);
    expect(riconcilia).toBe(false);
  });

  it("il progresso sposta la riga, non ne aggiunge una", () => {
    const dopo = applica(applica([], AVVIATO).lavori, passo("7", 2, 3, "nota 2"));
    expect(dopo.lavori).toHaveLength(1);
    expect(dopo.lavori[0].progress).toEqual({ done: 2, total: 3, label: "nota 2" });
    expect(etichettaDi(dopo.lavori[0]), "l'etichetta la dà il job quando c'è").toBe("nota 2");
  });

  it("finito vuol dire sparito", () => {
    const vivo = applica([], AVVIATO).lavori;
    const { lavori } = applica(vivo, notice({ type: "job_done", id: "7", job: "export", result: null }));
    expect(lavori).toEqual([]);
  });

  it("un progresso per un lavoro che non conosciamo fa **richiedere** l'elenco", () => {
    // È il caso che i freni del canale rendono possibile: `job_started` è
    // recuperabile, quindi si può essere perso. Inventare una riga col solo id
    // mostrerebbe un nome che non esiste.
    const { lavori, riconcilia } = applica([], passo("9", 1));
    expect(lavori).toEqual([]);
    expect(riconcilia).toBe(true);
  });

  it("un overflow non svuota l'elenco: lo fa richiedere", () => {
    const vivo = applica([], AVVIATO).lavori;
    const { lavori, riconcilia } = applica(vivo, notice({ type: "overflow", dropped: 300 }));
    expect(lavori, "buttare le righe direbbe che i lavori sono finiti").toEqual(vivo);
    expect(riconcilia).toBe(true);
  });

  it("chiudere un vault porta via i suoi lavori, aprirne uno li fa richiedere", () => {
    const vivo = applica([], AVVIATO).lavori;
    expect(applica(vivo, notice({ type: "vault_closed", root: "/v" }))).toEqual({
      lavori: [],
      riconcilia: false,
    });
    expect(applica(vivo, notice({ type: "vault_opened", root: "/v" }))).toEqual({
      lavori: [],
      riconcilia: true,
    });
  });

  it("un avvio ripetuto non duplica la riga", () => {
    const una = applica([], AVVIATO).lavori;
    expect(applica(una, AVVIATO).lavori).toEqual(una);
  });

  it("gli altri eventi non la riguardano", () => {
    const vivo = applica([], AVVIATO).lavori;
    const fermo = applica(vivo, notice({ type: "index_updated" }));
    expect(fermo).toEqual({ lavori: vivo, riconcilia: false });
  });

  it("senza etichetta si mostra il nome dell'entry point", () => {
    const lavoro: Lavoro = { id: "1", job: "reindex", progress: { done: 4, total: null, label: null } };
    expect(etichettaDi(lavoro)).toBe("reindex");
  });
});

describe("l'esito di un lavoro lungo", () => {
  it("si annuncia anche quando è andato bene", () => {
    const avviso = avvisoDi(
      notice({ type: "job_done", id: "7", job: "export", result: { Ok: null } }),
    );
    expect(avviso).toEqual({ testo: "«export» è finito.", tono: "info" });
  });

  it("quando fallisce dice **perché**, e con un altro tono", () => {
    const avviso = avvisoDi(
      notice({
        type: "job_done",
        id: "7",
        job: "export",
        result: { Err: { Io: "disco pieno" } },
      }),
    );
    expect(avviso?.tono).toBe("guasto");
    expect(avviso?.testo).toContain("disco pieno");
  });

  it("un errore senza dettaglio nomina almeno la sua specie", () => {
    const avviso = avvisoDi(
      notice({ type: "job_done", id: "7", job: "export", result: { Err: { Cancelled: "" } } }),
    );
    expect(avviso?.testo).toContain("Cancelled");
  });

  it("gli altri eventi non sono avvisi", () => {
    expect(avvisoDi(AVVIATO)).toBeNull();
    expect(avvisoDi(passo("7", 1))).toBeNull();
  });
});
