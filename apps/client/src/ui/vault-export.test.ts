// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandOutcome, CommandSpec } from "../host/contract";

const fake = vi.hoisted(() => ({
  invokeCommand: vi.fn<(command: string, args?: Record<string, unknown>, mode?: string) => Promise<CommandOutcome>>(),
  pickNewFolder: vi.fn<(title: string, name: string) => Promise<string | null>>(),
}));
vi.mock("../host/ipc", () => ({ api: { invokeCommand: fake.invokeCommand } }));
vi.mock("../host/query", () => ({ vaultFolders: () => Promise.resolve({ items: [{ path: "Diario" }], total: 1 }) }));
vi.mock("../host/dialog", () => ({ pickFolder: vi.fn(), pickNewFolder: fake.pickNewFolder }));

const { state } = await import("../state/store");
const { openVaultExport, VAULT_EXPORT } = await import("./vault-export");

const spec = {
  id: VAULT_EXPORT,
  title: "Esporta in una cartella",
  description: "",
  params: [
    {
      name: "format",
      title: "Formato",
      kind: {
        kind: "choice",
        value: [
          { value: "pdf.files", title: "PDF" },
          { value: "markdown.files", title: "Markdown (un file per nota)" },
        ],
      },
      required: true,
    },
    { name: "folder", title: "Cartella", kind: { kind: "text" }, required: false },
    { name: "target", title: "Destinazione", kind: { kind: "text" }, required: true },
    { name: "options_json", title: "Opzioni", kind: { kind: "text" }, required: false },
  ],
} as unknown as CommandSpec;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function host(unsaved: string[] = []) {
  return {
    onEffect: vi.fn(),
    notify: vi.fn(),
    listDocuments: () => Promise.resolve([]),
    flushPendingSave: () => Promise.resolve(unsaved),
  };
}

function dialog(): {
  format: HTMLSelectElement;
  folder: HTMLInputElement;
  target: HTMLInputElement;
  submit(): Promise<void>;
  switches: HTMLInputElement[];
} {
  const form = document.querySelector<HTMLFormElement>(".vault-export-form")!;
  const inputs = form.querySelectorAll<HTMLInputElement>("input[type=text]");
  return {
    format: form.querySelector("select")!,
    folder: inputs[0]!,
    target: inputs[1]!,
    switches: [...form.querySelectorAll<HTMLInputElement>("input[type=checkbox]")],
    submit: async () => {
      form.requestSubmit();
      await settle();
      await settle();
    },
  };
}

describe("la finestra «Esporta»", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    fake.invokeCommand.mockReset();
    state.commandSpecs = [spec];
  });

  it("parte dalla cartella da cui la si chiede, col Markdown scelto e le sue opzioni", async () => {
    openVaultExport({ folder: "Diario/" }, host());
    const ui = dialog();
    expect(ui.format.value).toBe("markdown.files");
    expect(ui.folder.value).toBe("Diario");
    expect(ui.switches).toHaveLength(2);
    ui.switches[1]!.checked = false;
    ui.target.value = "/fuori/Export";
    fake.invokeCommand.mockResolvedValue({
      notify: "Export scritto in «/fuori/Export»: 2 file, 1 avvisi su ciò che non è passato.",
      effect: {
        kind: "custom",
        ns: "fub.vault.exported",
        payload: {
          target: "/fuori/Export",
          artifacts: 2,
          log: [{ level: "warning", message: "allegato mancante", entry: "Diario/Oggi.md" }],
        },
      },
      undo: null,
      partial: null,
    } as unknown as CommandOutcome);
    await ui.submit();
    expect(fake.invokeCommand).toHaveBeenCalledWith(
      VAULT_EXPORT,
      {
        format: "markdown.files",
        folder: "Diario",
        target: "/fuori/Export",
        options_json: JSON.stringify({ frontmatter: true, attachments: false }),
      },
      "apply",
    );
    const result = document.querySelector(".vault-export-result")!;
    expect(result.textContent).toContain("2 file");
    expect(result.textContent).toContain("Diario/Oggi.md: allegato mancante");
  });

  it("un formato senza opzioni non ne manda", async () => {
    openVaultExport({}, host());
    const ui = dialog();
    ui.format.value = "pdf.files";
    ui.format.dispatchEvent(new Event("change"));
    expect(ui.switches).toHaveLength(2);
    expect(dialog().switches).toHaveLength(0);
    ui.target.value = "/fuori/Pdf";
    fake.invokeCommand.mockResolvedValue({ notify: "ok", effect: { kind: "done" }, undo: null, partial: null } as CommandOutcome);
    await ui.submit();
    expect(fake.invokeCommand.mock.calls[0]![1]).toEqual({ format: "pdf.files", folder: "", target: "/fuori/Pdf" });
  });

  it("senza destinazione, o con note non salvate, non parte; un errore resta nella finestra", async () => {
    openVaultExport({}, host(["Nota.md"]));
    let ui = dialog();
    await ui.submit();
    expect(document.querySelector(".vault-export-alert")!.textContent).not.toBe("");
    ui.target.value = "/fuori/X";
    await ui.submit();
    expect(fake.invokeCommand).not.toHaveBeenCalled();
    expect(document.querySelector(".vault-export-alert")!.textContent).toContain("Nota.md");

    document.body.replaceChildren();
    openVaultExport({}, host());
    ui = dialog();
    ui.target.value = "/fuori/X";
    fake.invokeCommand.mockRejectedValue({ kind: "already_exists", message: "/fuori/X esiste già" });
    await ui.submit();
    expect(document.querySelector(".vault-export-alert")!.textContent).toContain("esiste già");
  });
});
