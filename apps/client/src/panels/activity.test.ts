// Le regole del centro attività (§10.3): come un evento cambia l'elenco dei
// lavori, e quando l'elenco va **richiesto da capo**.
//
// La seconda metà è quella che non si vede provando l'app a mano, perché
// richiede che uno dei due freni del canale (decisione 0034) abbia buttato
// qualcosa — cioè un vault sotto carico. Qui è un caso di test.
import { describe, expect, it } from "vitest";
import type { KernelEvent, KernelNotice } from "../host/contract";
import { apply, noticeOf, labelOf, type JobRow } from "./activity";

function notice(event: KernelEvent): KernelNotice {
  return { event, origin: { actor: { kind: "kernel" }, batch: null } };
}

const STARTED = notice({ type: "job_started", id: "7", job: "export" });

function step(id: string, done: number, total: number | null = 3, label: string | null = null) {
  return notice({ type: "job_progress", id, progress: { done, total, label } });
}

describe("l'elenco dei lavori in corso", () => {
  it("una riga compare quando il lavoro è accettato", () => {
    const { jobs, reconcile } = apply([], STARTED);
    expect(jobs).toEqual([{ id: "7", job: "export", progress: null }]);
    expect(reconcile).toBe(false);
  });

  it("il progresso sposta la riga, non ne aggiunge una", () => {
    const after = apply(apply([], STARTED).jobs, step("7", 2, 3, "nota 2"));
    expect(after.jobs).toHaveLength(1);
    expect(after.jobs[0].progress).toEqual({ done: 2, total: 3, label: "nota 2" });
    expect(labelOf(after.jobs[0]), "l'etichetta la dà il job quando c'è").toBe("nota 2");
  });

  it("finito vuol dire sparito", () => {
    const activeJobs = apply([], STARTED).jobs;
    const { jobs } = apply(activeJobs, notice({ type: "job_done", id: "7", job: "export", result: null }));
    expect(jobs).toEqual([]);
  });

  it("un progresso per un lavoro che non conosciamo fa **richiedere** l'elenco", () => {
    // È il caso che i freni del canale rendono possibile: `job_started` è
    // recuperabile, quindi si può essere perso. Inventare una riga col solo id
    // mostrerebbe un nome che non esiste.
    const { jobs, reconcile } = apply([], step("9", 1));
    expect(jobs).toEqual([]);
    expect(reconcile).toBe(true);
  });

  it("un overflow non svuota l'elenco: lo fa richiedere", () => {
    const activeJobs = apply([], STARTED).jobs;
    const { jobs, reconcile } = apply(activeJobs, notice({ type: "overflow", dropped: 300 }));
    expect(jobs, "buttare le righe direbbe che i lavori sono finiti").toEqual(activeJobs);
    expect(reconcile).toBe(true);
  });

  it("chiudere un vault porta via i suoi lavori, aprirne uno li fa richiedere", () => {
    const activeJobs = apply([], STARTED).jobs;
    expect(apply(activeJobs, notice({ type: "vault_closed", root: "/v" }))).toEqual({
      jobs: [],
      reconcile: false,
    });
    expect(apply(activeJobs, notice({ type: "vault_opened", root: "/v" }))).toEqual({
      jobs: [],
      reconcile: true,
    });
  });

  it("un avvio ripetuto non duplica la riga", () => {
    const oneStart = apply([], STARTED).jobs;
    expect(apply(oneStart, STARTED).jobs).toEqual(oneStart);
  });

  it("gli altri eventi non la riguardano", () => {
    const activeJobs = apply([], STARTED).jobs;
    const unchanged = apply(activeJobs, notice({ type: "index_updated" }));
    expect(unchanged).toEqual({ jobs: activeJobs, reconcile: false });
  });

  it("senza etichetta si mostra il nome dell'entry point", () => {
    const job: JobRow = { id: "1", job: "reindex", progress: { done: 4, total: null, label: null } };
    expect(labelOf(job)).toBe("reindex");
  });
});

describe("l'esito di un lavoro lungo", () => {
  it("si annuncia anche quando è andato bene", () => {
    const noticeResult = noticeOf(
      notice({ type: "job_done", id: "7", job: "export", result: { Ok: null } }),
    );
    expect(noticeResult).toEqual({ text: "«export» è finito.", tone: "info" });
  });

  it("quando fallisce dice **perché**, e con un altro tono", () => {
    const noticeResult = noticeOf(
      notice({
        type: "job_done",
        id: "7",
        job: "export",
        result: { Err: { Io: "disco pieno" } },
      }),
    );
    expect(noticeResult?.tone).toBe("guasto");
    expect(noticeResult?.text).toContain("disco pieno");
  });

  it("un errore senza dettaglio nomina almeno la sua specie", () => {
    const noticeResult = noticeOf(
      notice({ type: "job_done", id: "7", job: "export", result: { Err: { Cancelled: "" } } }),
    );
    expect(noticeResult?.text).toContain("Cancelled");
  });

  it("gli altri eventi non sono avvisi", () => {
    expect(noticeOf(STARTED)).toBeNull();
    expect(noticeOf(step("7", 1))).toBeNull();
  });
});
