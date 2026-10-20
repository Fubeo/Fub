// `folder.rename` e `folder.trash` dell'host finto: la shell e il banco li
// usano come il comando vero, voce per voce con gli eventi e l'annullamento.
import { describe, expect, it } from "vitest";
import { createFakeHost } from "./fake";

function host() {
  return createFakeHost({ file: { "Libro/a.md": "uno", "Libro/Parte/b.md": "due", "altro.md": "tre" } }).module.api;
}

describe("le cartelle nell'host finto", () => {
  it("rinomina sposta ogni voce e torna l'annullamento simmetrico", async () => {
    const api = host();
    const outcome = await api.invokeCommand("folder.rename", { folder: "Libro", to: "Archivio/Libro" });
    expect(outcome.effect).toMatchObject({ kind: "custom", ns: "fub.folder.moved", payload: { from: "Libro", to: "Archivio/Libro" } });
    expect(outcome.undo?.steps).toEqual([{ kind: "command", command: "folder.rename", args: { folder: "Archivio/Libro", to: "Libro" } }]);
    expect((await api.readDocument("Archivio/Libro/Parte/b.md")).text).toBe("due");
    await expect(api.readDocument("Libro/a.md")).rejects.toBeTruthy();
  });

  it("una cartella non entra in sé stessa, e una destinazione piena si rifiuta", async () => {
    const api = host();
    await expect(api.invokeCommand("folder.rename", { folder: "Libro", to: "Libro/Parte/Libro" })).rejects.toMatchObject({ kind: "bad_args" });
    await expect(api.invokeCommand("folder.rename", { folder: "Libro/Parte", to: "Libro" })).rejects.toMatchObject({ kind: "already_exists" });
  });

  it("il cestino porta via tutto ciò che la cartella contiene", async () => {
    const api = host();
    const outcome = await api.invokeCommand("folder.trash", { folder: "Libro" });
    expect(outcome.effect).toMatchObject({ kind: "custom", ns: "fub.folder.trashed" });
    await expect(api.readDocument("Libro/Parte/b.md")).rejects.toBeTruthy();
    expect((await api.readDocument("altro.md")).text).toBe("tre");
  });
});
