// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const world = vi.hoisted(() => ({
  folder: "" as unknown,
  invoked: [] as Array<Record<string, string> | undefined>,
}));

vi.mock("../host/ipc", () => ({
  api: {
    invokeCommand: async (_id: string, args?: Record<string, string>) => {
      world.invoked.push(args);
      return { effect: { kind: "navigate", doc: "x.md" } };
    },
  },
}));
vi.mock("../host/query", () => ({
  settings: async () => [{ spec: { key: "files.new-note-folder" }, value: world.folder }],
  vaultEntries: async () => [],
  vaultFolders: async () => [],
  WITHOUT_PAGE: {},
}));

import { state } from "./store";
import { createNote, folderOfOpenNote } from "./vault";

beforeEach(() => {
  world.invoked.length = 0;
  state.currentDoc = "Progetti/Alpha.md";
});

describe("la cartella delle nuove note con ./", () => {
  it("segue la nota aperta, o una sua sottocartella", async () => {
    world.folder = "./";
    expect(await folderOfOpenNote()).toBe("Progetti");
    world.folder = "./Bozze";
    expect(await folderOfOpenNote()).toBe("Progetti/Bozze");
    await createNote("Idea");
    expect(world.invoked[world.invoked.length - 1]).toEqual({ name: "Idea", folder: "Progetti/Bozze" });
  });

  it("una cartella del vault, o nessuna nota aperta, la lascia al kernel", async () => {
    world.folder = "Ingresso";
    expect(await folderOfOpenNote()).toBeUndefined();
    world.folder = "./";
    state.currentDoc = null;
    expect(await folderOfOpenNote()).toBeUndefined();
    await createNote("Idea");
    expect(world.invoked[world.invoked.length - 1]).toEqual({ name: "Idea" });
  });

  it("una cartella scelta da chi crea vince", async () => {
    world.folder = "./";
    await createNote("Idea", "Altrove");
    expect(world.invoked[world.invoked.length - 1]).toEqual({ name: "Idea", folder: "Altrove" });
  });
});
