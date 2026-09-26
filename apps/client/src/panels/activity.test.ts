// @vitest-environment happy-dom
// Le regole del centro attività (§10.3): come un evento cambia l'elenco dei
// lavori, e quando l'elenco va **richiesto da capo**.
//
// La seconda metà è quella che non si vede provando l'app a mano, perché
// richiede che uno dei due freni del canale (decisione 0034) abbia buttato
// qualcosa — cioè un vault sotto carico. Qui è un caso di test.
import { describe, expect, it, vi } from "vitest";
import type { KernelEvent, KernelNotice } from "../host/contract";
import { openLifetime } from "../ui/lifetime";
import { forwardNotice, onAnyEvent } from "../state/kernel";
import { apply, exportArtifacts, mountActivity, noticeOf, labelOf, type JobRow } from "./activity";
import { api } from "../host/ipc";
import samples from "../__fixtures__/mirror-samples.json";
import { ARTIFACT_JOB } from "../ui/shell-ids.generated";
import { clearHistory, recentNotices } from "../ui/notify";
import { t } from "../i18n/strings";

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

describe("durata degli ascolti del centro attività", () => {
  it("smonta la sola registrazione generica rimossa, anche con lo stesso callback", () => {
    const seen: KernelNotice[] = [];
    const handler = (value: KernelNotice) => seen.push(value);
    const first = onAnyEvent(handler);
    const second = onAnyEvent(handler);

    second();
    forwardNotice(STARTED);
    expect(seen).toEqual([STARTED]);

    first();
    forwardNotice(STARTED);
    expect(seen).toEqual([STARTED]);
  });
});

describe("rimontaggio del centro attività", () => {
  it("dopo dispose e remount una notifica torna una sola volta", () => {
    document.body.innerHTML = `
      <button id="activity-button"></button>
      <section id="activity-panel" hidden><ul id="activity-list"></ul></section>
    `;

    const first = openLifetime();
    mountActivity(first);
    first.close();

    const second = openLifetime();
    mountActivity(second);
    forwardNotice(STARTED);

    expect(document.getElementById("activity-button")?.classList.contains("in-corso")).toBe(true);
    second.close();
  });
});

describe("export artifacts from completed transfer jobs", () => {
  const complete = (artifact: unknown): KernelNotice =>
    notice({ type: "job_done", id: "9007199254740993", job: ARTIFACT_JOB,
      result: { Ok: { artifacts: [artifact], log: [] } } });
  it("reads the report exactly as Rust serializes it, and only from the transfer job", () => {
    const [report] = (samples as unknown as Record<string, unknown[]>).ExportReport;
    const done = (job: string) => notice({ type: "job_done", id: "3", job, result: { Ok: report } });
    expect(exportArtifacts(done(ARTIFACT_JOB))?.map((a) => a.content.kind)).toEqual(["bytes", "delivered"]);
    expect(exportArtifacts(done("export.run"))).toBeNull();
  });
  it("an export whose artifacts fail validation is reported, an import result is not", () => {
    document.body.innerHTML = `
      <button id="activity-button"></button>
      <section id="activity-panel" hidden><ul id="activity-list"></ul></section>
    `;
    vi.spyOn(api, "queryIndex").mockResolvedValue({ kind: "jobs", value: [] });
    const lifetime = openLifetime();
    mountActivity(lifetime);
    const invalid = () => recentNotices().filter((n) => n.text === t("activity.artifact_invalid")).length;
    clearHistory();
    forwardNotice(notice({ type: "job_done", id: "4", job: ARTIFACT_JOB,
      result: { Ok: { receipt: "r", log: [] } } }));
    expect(invalid()).toBe(0);
    forwardNotice(complete({ path: "../fuori.csv", media_type: "text/csv", content: { kind: "bytes", value: [1] } }));
    expect(invalid()).toBe(1);
    lifetime.close();
  });
  it("accepts only bounded byte artifacts and decimal-string delivered receipts", () => {
    expect(exportArtifacts(complete({
      path: "nested/export.csv", media_type: "text/csv",
      content: { kind: "bytes", value: [0, 255] },
    }))).toEqual([{ path: "nested/export.csv", media_type: "text/csv",
      content: { kind: "bytes", value: [0, 255] } }]);
    expect(exportArtifacts(complete({
      path: "nested/export.csv", media_type: "text/csv",
      content: { kind: "delivered", value: "9007199254740993" },
    }))?.[0]?.content).toEqual({ kind: "delivered", value: "9007199254740993" });
    expect(exportArtifacts(complete({
      path: "../outside.csv", media_type: "text/csv",
      content: { kind: "bytes", value: [1] },
    }))).toBeNull();
    expect(exportArtifacts(complete({
      path: "out.csv", media_type: "text/csv",
      content: { kind: "delivered", value: 9007199254740993 },
    }))).toBeNull();
  });

  it("offers Save only for bytes; native cancellation leaves bytes available and no success claim", async () => {
    document.body.innerHTML = `
      <button id="activity-button"></button>
      <section id="activity-panel" hidden><ul id="activity-list"></ul></section>
    `;
    const query = vi.spyOn(api, "queryIndex").mockResolvedValue({ kind: "jobs", value: [] });
    const save = vi.spyOn(api, "saveArtifact")
      .mockResolvedValueOnce({ status: "cancelled" })
      .mockResolvedValueOnce({ status: "saved", path: "/chosen/out.csv" });
    const lifetime = openLifetime();
    mountActivity(lifetime);
    forwardNotice(complete({
      path: "nested/out.csv", media_type: "text/csv",
      content: { kind: "bytes", value: [65, 66] },
    }));
    document.getElementById("activity-button")!.click();
    const saveButton = () => [...document.querySelectorAll<HTMLButtonElement>("#activity-list button")]
      .find((button) => button.textContent === "Salva…");
    saveButton()!.click();
    await vi.waitFor(() => expect(document.getElementById("activity-list")?.textContent).toContain("Salvataggio annullato"));
    expect(save).toHaveBeenCalledWith("out.csv", "text/csv", [65, 66]);
    expect(document.getElementById("activity-list")?.textContent).not.toContain("Salvato:");
    saveButton()!.click();
    await vi.waitFor(() => expect(document.getElementById("activity-list")?.textContent).toContain("Salvato: /chosen/out.csv"));
    expect(saveButton()).toBeUndefined();
    lifetime.close();
    save.mockRestore();
    query.mockRestore();
  });
});
