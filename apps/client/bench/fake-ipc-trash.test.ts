// @vitest-environment happy-dom
// Il cestino vero del finto del banco (giro dei guasti, PA T30): si ridisegna
// solo quando cambia, rimette la nota dove il comando dice, non scrive sopra
// un'altra nota, e chiama le voci come la shell.
import { beforeAll, describe, expect, it } from "vitest";
import type { KernelEvent, UiNode } from "../src/host/contract";

type FakeIpc = typeof import("./fake-ipc");

let ipc: FakeIpc;
const events: KernelEvent[] = [];

beforeAll(async () => {
  window.history.replaceState(null, "", "/index.html");
  ipc = await import("./fake-ipc");
  await ipc.onKernelEvent(({ event }) => void events.push(event));
});

/// Gli eventi del cestino arrivati durante `run`.
async function trashEvents(run: () => Promise<unknown>): Promise<string[]> {
  const from = events.length;
  await run();
  return events.slice(from)
    .filter((event) => event.type === "index_updated" || (event.type === "view_invalidated" && event.view === "trash"))
    .map((event) => event.type);
}

/// I titoli delle righe del pannello del cestino.
async function trashTitles(): Promise<string[]> {
  const titles: string[] = [];
  const walk = (node: UiNode): void => {
    if (node.node === "list_item") titles.push(node.title);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const child of value) if (child && typeof child === "object" && "node" in child) walk(child as UiNode);
      if (value && typeof value === "object" && "node" in value) walk(value as UiNode);
    }
  };
  walk(await ipc.api.renderView("trash", "trash-1", null));
  return titles;
}

/// La voce del cestino che viene da `original`.
async function entryOf(original: string): Promise<string> {
  const tree = await ipc.api.renderView("trash", "trash-1", null);
  const found = JSON.stringify(tree).match(new RegExp(`"entry":"([^"]+)","original":"${original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  if (!found) throw new Error(`«${original}» non è nel cestino`);
  return found[1]!;
}

describe("il cestino vero del finto", () => {
  it("un comando del cestino che non lo cambia non ridisegna niente", async () => {
    expect(await trashEvents(() => ipc.api.invokeCommand("trash.empty"))).toEqual([]);
  });

  it("un comando che lo cambia ridisegna l'indice e il pannello", async () => {
    await ipc.api.writeDocument("Cestino/Uno.md", "# Uno\n", { kind: "dictated" });
    expect(await trashEvents(() => ipc.api.invokeCommand("note.trash", { doc: "Cestino/Uno.md" })))
      .toEqual(["index_updated", "view_invalidated"]);
  });

  it("chiama le voci col nome di pagina della shell, anche la pagina di una cartella", async () => {
    await ipc.api.writeDocument("Raccolta/_index.md", "# Raccolta\n", { kind: "dictated" });
    await ipc.api.invokeCommand("note.trash", { doc: "Raccolta/_index.md" });
    expect(await trashTitles()).toContain("Raccolta");
  });

  it("Ripristina porta dove la nota è tornata", async () => {
    await ipc.api.writeDocument("Cestino/Due.md", "# Due\n", { kind: "dictated" });
    await ipc.api.invokeCommand("note.trash", { doc: "Cestino/Due.md" });
    const entry = await entryOf("Cestino/Due.md");
    const update = await ipc.api.viewAction("trash", "trash-1", null, "restore", { entry, original: "Cestino/Due.md" }, []);
    expect(update).toEqual({ kind: "navigate", doc_id: "Cestino/Due.md" });
    expect((await ipc.api.readDocument("Cestino/Due.md")).text).toBe("# Due\n");
  });

  it("col nome di nuovo occupato non rimette la nota sopra l'altra", async () => {
    await ipc.api.writeDocument("Cestino/Tre.md", "# Tre di prima\n", { kind: "dictated" });
    await ipc.api.invokeCommand("note.trash", { doc: "Cestino/Tre.md" });
    await ipc.api.writeDocument("Cestino/Tre.md", "# Tre nuova\n", { kind: "dictated" });
    const entry = await entryOf("Cestino/Tre.md");
    await expect(ipc.api.viewAction("trash", "trash-1", null, "restore", { entry, original: "Cestino/Tre.md" }, []))
      .rejects.toMatchObject({ kind: "already_exists" });
    expect((await ipc.api.readDocument("Cestino/Tre.md")).text).toBe("# Tre nuova\n");
  });
});
