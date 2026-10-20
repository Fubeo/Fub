// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  pickFolder: vi.fn<(title?: string) => Promise<string | null>>(),
  pickNewFolder: vi.fn<(title: string, name: string) => Promise<string | null>>(),
}));
vi.mock("../host/dialog", () => fake);

const { withPathPicker } = await import("./path-fields");

function field(command: string, param: string): { input: HTMLInputElement; browse: HTMLButtonElement | null } {
  const input = document.createElement("input");
  const shown = withPathPicker(command, param, "Cartella", input);
  document.body.replaceChildren(shown);
  return { input, browse: shown.querySelector("button") };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("le cartelle del disco nei moduli dei comandi", () => {
  beforeEach(() => {
    fake.pickFolder.mockReset();
    fake.pickNewFolder.mockReset();
  });

  it("lo snapshot si scrive in una cartella nuova scelta col dialogo, col nome proposto", async () => {
    fake.pickNewFolder.mockResolvedValue("/copie/Snapshot");
    const { input, browse } = field("vault.snapshot.create", "target");
    let typed = 0;
    input.addEventListener("input", () => typed++);
    browse!.click();
    await settle();
    expect(fake.pickNewFolder).toHaveBeenCalledOnce();
    expect(fake.pickNewFolder.mock.calls[0]![1]).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(input.value).toBe("/copie/Snapshot");
    expect(typed).toBe(1);
  });

  it("il ripristino legge una cartella che c'è e salva lo stato attuale in una nuova", async () => {
    fake.pickFolder.mockResolvedValue("/copie/vecchio");
    fake.pickNewFolder.mockResolvedValue("/copie/prima");
    const source = field("vault.snapshot.apply", "source");
    source.browse!.click();
    await settle();
    expect(source.input.value).toBe("/copie/vecchio");
    const backup = field("vault.snapshot.apply", "backup");
    backup.browse!.click();
    await settle();
    expect(backup.input.value).toBe("/copie/prima");
  });

  it("annullare il dialogo lascia il campo com'era", async () => {
    fake.pickNewFolder.mockResolvedValue(null);
    const { input, browse } = field("vault.snapshot.create", "target");
    input.value = "/scritto/a/mano";
    browse!.click();
    await settle();
    expect(input.value).toBe("/scritto/a/mano");
  });

  it("un parametro che non è una cartella del disco resta un campo e basta", () => {
    expect(field("note.rename", "target").browse).toBeNull();
    expect(field("vault.snapshot.create", "altro").browse).toBeNull();
  });
});
