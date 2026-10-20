// @vitest-environment happy-dom
// Gli spazi di lavoro di Obsidian diventano workspace di Fub: l'area
// principale con le sue divisioni e schede, le schede senza file nominate per
// tipo, e uno spazio col nome di un workspace che c'è già non si raddoppia.
import { beforeEach, describe, expect, it, vi } from "vitest";

const saved = new Map<string, unknown>();
vi.mock("./store", () => ({
  state: { vaultRoot: "/vault" },
  readState: async (key: string) => saved.get(key) ?? null,
  writeState: (key: string, value: unknown) => {
    saved.set(key, JSON.parse(JSON.stringify(value)));
  },
}));
vi.mock("../host/query", () => ({ existingDocuments: async () => new Set<string>() }));

const { importObsidianWorkspaces, translateObsidianWorkspaces } = await import("./obsidian-workspaces");
const { getWorkspace, workspaceLoadSnapshot } = await import("./workspaces");

const leaf = (type: string, file?: string, pinned?: boolean) => ({
  type: "leaf",
  ...(pinned ? { pinned } : {}),
  state: { type, state: file ? { file, mode: "source" } : {} },
});

const NAMED = {
  Scrivere: {
    main: {
      type: "split",
      direction: "vertical",
      children: [
        { type: "tabs", currentTab: 2, children: [leaf("markdown", "Uno.md", true), leaf("graph"), leaf("markdown", "Due.md")] },
        {
          type: "split",
          direction: "horizontal",
          children: [
            { type: "tabs", children: [leaf("canvas", "Tela.canvas")] },
            { type: "tabs", children: [leaf("empty")] },
          ],
        },
      ],
    },
    left: { type: "split", children: [] },
  },
  Vuoto: { main: { type: "split", children: [{ type: "tabs", children: [leaf("search")] }] } },
};

describe("gli spazi di lavoro di Obsidian", () => {
  beforeEach(() => saved.clear());

  it("l'area principale diventa l'albero dei riquadri", () => {
    const [scrivere, vuoto] = translateObsidianWorkspaces(NAMED);
    expect(scrivere!.lost).toEqual(["graph"]);
    expect(scrivere!.layout).toEqual({
      tree: { k: "split", dir: "row", children: [{ k: "leaf", pane: "main" }, { k: "leaf", pane: "pane-2" }] },
      panes: {
        main: { tabs: [{ k: "doc", doc: "Uno.md", pinned: true }, { k: "doc", doc: "Due.md" }], active: 1, modes: {} },
        "pane-2": { tabs: [{ k: "doc", doc: "Tela.canvas" }], active: 0, modes: {} },
      },
      focus: "main",
    });
    expect(vuoto).toEqual({ name: "Vuoto", layout: null, lost: ["search"] });
  });

  it("si scrivono fra i workspace, e una seconda volta non si raddoppiano", async () => {
    const first = await importObsidianWorkspaces(NAMED);
    expect(first).toEqual({ added: 1, same: 0, lost: ["Scrivere: graph", "Vuoto: search", "Vuoto"], refused: false });
    const snapshot = workspaceLoadSnapshot();
    expect(snapshot.kind).toBe("ok");
    const entry = snapshot.kind === "ok" ? snapshot.store.workspaces[0]! : null;
    expect(entry).toMatchObject({ name: "Scrivere", tabs: 3, panes: 2 });
    expect(getWorkspace(entry!.id)?.layout.focus).toBe("main");

    const again = await importObsidianWorkspaces(NAMED);
    expect(again).toMatchObject({ added: 0, same: 1 });
  });
});
