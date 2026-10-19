// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandOutcome } from "../host/contract";

const fake = vi.hoisted(() => ({
  invokeCommand: vi.fn<(command: string, args?: Record<string, unknown>, mode?: string) => Promise<CommandOutcome>>(),
}));
vi.mock("../host/ipc", () => ({ api: { invokeCommand: fake.invokeCommand } }));
vi.mock("../host/query", () => ({ vaultFolders: () => Promise.resolve({ items: [], total: 0 }) }));

const { forwardNotice } = await import("../state/kernel");
const { openNoteImport, planOf, queuedJob, sourceJson, tally } = await import("./note-import");

const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const queued = (id: string): CommandOutcome =>
  ({ notify: "queued", effect: { kind: "custom", ns: "fub.transfer.queued", payload: { job_id: id } }, undo: null, partial: null }) as unknown as CommandOutcome;

function done(id: string, result: unknown): void {
  forwardNotice({
    event: { type: "job_done", id, job: "import.transfer", result },
    origin: { actor: { kind: "user" }, batch: null },
  } as never);
}

function host() {
  return { onEffect: vi.fn(), notify: vi.fn(), listDocuments: () => Promise.resolve([]), flushPendingSave: () => Promise.resolve([]) };
}

const manifest = {
  preview: {
    mode: "preview",
    documents: [
      { doc: "Import/Kant.md", outcome: { kind: "created" }, entry: "Kant.md" },
      { doc: "Import/Hegel.md", outcome: { kind: "skipped" }, entry: "Hegel.md" },
    ],
    log: [{ level: "warning", message: "un allegato non c'è", entry: "Kant.md" }],
  },
  losses: ["le tabelle restano testo"],
};

describe("le regole della finestra d'import", () => {
  it("l'id del job viene dall'esito tipizzato, non dalla frase", () => {
    expect(queuedJob(queued("7"))).toBe("7");
    expect(queuedJob({ notify: "import.prepare queued (job 7)", effect: { kind: "done" }, undo: null, partial: null } as CommandOutcome)).toBeNull();
  });

  it("la sorgente è un ImportSource che si rilegge uguale", () => {
    const raw = sourceJson("a \"b\".md", null, new Uint8Array([0, 255, 10]));
    expect(JSON.parse(raw)).toEqual({ name: 'a "b".md', media_type: null, content: { kind: "bytes", value: [0, 255, 10] } });
  });

  it("il piano conta per esito e porta le perdite", () => {
    const plan = planOf(manifest);
    expect(tally(plan.documents)).toEqual({ created: 1, replaced: 0, skipped: 1, failed: 0 });
    expect(plan.losses).toEqual(["le tabelle restano testo"]);
    expect(planOf(null).documents).toEqual([]);
  });
});

describe("la finestra «Importa note»", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    fake.invokeCommand.mockReset();
  });

  it("anteprima, poi import, poi annullamento: ognuno aspetta il suo job", async () => {
    const file = new File(["# Kant\n"], "Kant.md", { type: "text/markdown" });
    openNoteImport({ folder: "Import/" }, host(), { file });
    const form = document.querySelector<HTMLFormElement>(".note-import-form")!;

    fake.invokeCommand.mockResolvedValueOnce(queued("1"));
    form.requestSubmit();
    await settle();
    const [command, args] = fake.invokeCommand.mock.calls[0]!;
    expect(command).toBe("import.prepare");
    expect(JSON.parse(String(args!.request_json))).toMatchObject({ mode: "apply", folder: "Import", on_conflict: "skip" });
    expect(JSON.parse(String(args!.source_json)).name).toBe("Kant.md");
    // Un job d'altri non è il nostro.
    done("99", { Ok: {} });
    done("1", { Ok: manifest });
    await settle();
    const plan = document.querySelector(".note-import-plan")!;
    expect(plan.textContent).toContain("Import/Kant.md");
    expect(plan.textContent).toContain("le tabelle restano testo");
    expect(plan.textContent).toContain("Kant.md: un allegato non c'è");
    const submit = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
    expect(submit.disabled).toBe(false);

    fake.invokeCommand.mockResolvedValueOnce(queued("2"));
    form.requestSubmit();
    await settle();
    expect(fake.invokeCommand.mock.calls[1]![0]).toBe("import.commit");
    done("2", { Ok: { mode: "apply", documents: [manifest.preview.documents[0]], log: [] } });
    await settle();
    expect(document.querySelector(".note-import-plan")!.textContent).toContain("Import/Kant.md");

    const undo = [...form.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Annulla l'import")!;
    expect(undo.hidden).toBe(false);
    fake.invokeCommand.mockResolvedValueOnce(queued("3"));
    undo.click();
    await settle();
    expect(fake.invokeCommand.mock.calls[2]).toEqual(["import.rollback", { job: fake.invokeCommand.mock.calls[0]![1]!.job }, "apply"]);
    done("3", { Ok: { rolled_back: true } });
    await settle();
    expect(undo.hidden).toBe(true);
  });

  it("chiudere dopo l'anteprima toglie la sorgente depositata", async () => {
    openNoteImport({}, host(), { file: new File(["x"], "x.md") });
    const form = document.querySelector<HTMLFormElement>(".note-import-form")!;
    fake.invokeCommand.mockResolvedValueOnce(queued("5"));
    form.requestSubmit();
    await settle();
    done("5", { Ok: manifest });
    await settle();
    fake.invokeCommand.mockResolvedValue({ notify: null, effect: { kind: "done" }, undo: null, partial: null } as CommandOutcome);
    form.querySelector<HTMLButtonElement>(".palette-actions button[type=button]:not([hidden])")!.click();
    await settle();
    const job = fake.invokeCommand.mock.calls[0]![1]!.job;
    expect(fake.invokeCommand.mock.calls[fake.invokeCommand.mock.calls.length - 1]).toEqual(["import.cancel", { job }, "apply"]);
  });

  it("un job che fallisce lascia l'errore nella finestra, e un file troppo grande non parte", async () => {
    openNoteImport({}, host(), { file: new File(["x"], "x.zip") });
    const form = document.querySelector<HTMLFormElement>(".note-import-form")!;
    fake.invokeCommand.mockResolvedValueOnce(queued("8"));
    form.requestSubmit();
    await settle();
    done("8", { Err: { kind: "bad_args", message: "no importer for `x.zip`" } });
    await settle();
    expect(document.querySelector(".note-import-alert")!.textContent).toContain("no importer");

    document.body.replaceChildren();
    const big = new File(["x"], "grande.zip");
    Object.defineProperty(big, "size", { value: 65 * 1024 * 1024 });
    fake.invokeCommand.mockClear();
    openNoteImport({}, host(), { file: big });
    document.querySelector<HTMLFormElement>(".note-import-form")!.requestSubmit();
    await settle();
    expect(fake.invokeCommand).not.toHaveBeenCalled();
    expect(document.querySelector(".note-import-alert")!.textContent).toContain("grande.zip");
  });
});
