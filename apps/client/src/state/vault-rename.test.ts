// Rinominare una nota: la rinomina è fatta comunque, ma i collegamenti nelle
// proprietà rimasti col nome vecchio si dicono, e non si tacciono (IMP-2805).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandOutcome } from "../host/contract";

const invokeCommand = vi.fn<(...args: unknown[]) => Promise<CommandOutcome>>();
const notify = vi.fn();

vi.mock("../host/ipc", () => ({
  api: { invokeCommand: (...args: unknown[]) => invokeCommand(...args) },
}));
vi.mock("../ui/notify", () => ({ notify: (...args: unknown[]) => notify(...args) }));
vi.mock("./store", () => ({
  emit: () => {},
  openVaultRoot: () => "/vault",
  setCommandSpecs: () => {},
  vaultArg: () => "/vault",
}));

const { renameNote } = await import("./vault");

const done = (notice: string | null, partial: CommandOutcome["partial"]): CommandOutcome =>
  ({ notify: notice, effect: { kind: "done" }, undo: null, partial }) as CommandOutcome;

describe("rinominare una nota", () => {
  beforeEach(() => {
    invokeCommand.mockReset();
    notify.mockReset();
  });

  it("riuscita del tutto non dice niente qui: la frase la mostra chi la chiede", async () => {
    invokeCommand.mockResolvedValue(done("«a.md» rinominata in «b.md»", null));
    await renameNote("a.md", "b.md");
    expect(invokeCommand.mock.calls[0]![1]).toEqual({ doc: "a.md", to: "b.md" });
    expect(notify).not.toHaveBeenCalled();
  });

  it("i collegamenti rimasti vecchi sono un guasto detto con la frase del comando", async () => {
    const said = "«a.md» rinominata in «b.md» · Collegamenti nelle proprietà da guardare: c.md";
    invokeCommand.mockResolvedValue(done(said, { attempted: 2, done: 1, failures: [] } as unknown as CommandOutcome["partial"]));
    await renameNote("a.md", "b.md");
    expect(notify.mock.calls).toEqual([[said, "guasto"]]);
  });
});
