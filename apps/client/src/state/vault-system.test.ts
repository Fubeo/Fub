// Una voce del vault passata al sistema: la porta chiamata col vault aperto, e
// ogni esito che non è «aperto» detto a chi guarda.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RevealOutcome } from "../host/ipc";

const revealInSystem = vi.fn<(path: string, open: boolean, vault?: string | null) => Promise<RevealOutcome>>();
const notify = vi.fn();

vi.mock("../host/ipc", () => ({
  api: { revealInSystem: (path: string, open: boolean, vault?: string | null) => revealInSystem(path, open, vault) },
}));
vi.mock("../ui/notify", () => ({ notify: (...args: unknown[]) => notify(...args) }));
vi.mock("./store", () => ({
  emit: () => {},
  openVaultRoot: () => "/vault",
  setCommandSpecs: () => {},
  vaultArg: () => "/vault",
}));

const { handToSystem } = await import("./vault");

describe("una voce del vault al sistema", () => {
  beforeEach(() => {
    revealInSystem.mockReset();
    notify.mockReset();
  });

  it("si mostra e si apre nel vault aperto, senza dire niente", async () => {
    revealInSystem.mockResolvedValue({ status: "opened" });
    await handToSystem("cartella/nota.md", false);
    await handToSystem("cartella/nota.md", true);
    expect(revealInSystem.mock.calls).toEqual([
      ["cartella/nota.md", false, "/vault"],
      ["cartella/nota.md", true, "/vault"],
    ]);
    expect(notify).not.toHaveBeenCalled();
  });

  it("un programma si mostra invece di aprirsi, e lo si dice", async () => {
    revealInSystem.mockResolvedValueOnce({ status: "executable" }).mockResolvedValueOnce({ status: "opened" });
    await handToSystem("avvia.sh", true);
    expect(revealInSystem.mock.calls).toEqual([
      ["avvia.sh", true, "/vault"],
      ["avvia.sh", false, "/vault"],
    ]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![1]).toBe("info");
  });

  it("nessun programma, o un rifiuto, è un guasto detto", async () => {
    revealInSystem.mockResolvedValueOnce({ status: "no_opener" }).mockRejectedValueOnce(new Error("fuori"));
    await handToSystem("a.md", true);
    await handToSystem("../b.md", false);
    expect(notify.mock.calls.map((call) => call[1])).toEqual(["guasto", "guasto"]);
  });
});
