// @vitest-environment happy-dom
// I frammenti CSS di Obsidian passano dallo stesso vaglio dei frammenti di
// Fub: chi regge si accende se era acceso, chi nomina agganci che Fub non ha
// entra spento e si nomina, e un id che c'è già non si riscrive.
import { beforeEach, expect, it, vi } from "vitest";

const machine = vi.hoisted(() => ({ value: '{"version":1,"snippets":[]}', writes: [] as string[] }));
vi.mock("../host/query", () => ({
  settings: async () => [{ spec: { key: "appearance.css-snippets" }, value: machine.value }],
}));
vi.mock("../host/ipc", () => ({
  api: {
    setSetting: async (_key: string, value: string) => {
      machine.writes.push(value);
      machine.value = value;
    },
  },
}));
vi.mock("../state/kernel", () => ({ onEvent: () => () => {} }));

const { importObsidianSnippets, obsidianSnippetId } = await import("./snippets");

const PAYLOAD = {
  files: [
    { name: "Lettura larga", css: ".markdown-preview { background: #fafafa; }" },
    { name: "spenta", css: ".markdown-preview { color: #333; }" },
    { name: "obsidian", css: ".workspace-leaf-content { color: red; }" },
  ],
  enabled: ["Lettura larga", "obsidian", "sparito"],
};

beforeEach(() => {
  machine.value = '{"version":1,"snippets":[]}';
  machine.writes.length = 0;
});

it("l'id è quello di un frammento di Fub", () => {
  expect(obsidianSnippetId("Lettura larga")).toBe("obsidian-lettura-larga");
  expect(obsidianSnippetId("--")).toBe("obsidian-frammento");
  expect(obsidianSnippetId("x".repeat(80))).toHaveLength(64);
});

it("chi regge si accende come in Obsidian, chi no entra spento e si nomina", async () => {
  const done = await importObsidianSnippets(PAYLOAD);
  expect(done).toEqual({ added: 3, on: 1, same: 0, lost: ["sparito", "obsidian"] });
  const written = JSON.parse(machine.writes[machine.writes.length - 1]!) as { snippets: { id: string; enabled: boolean }[] };
  expect(written.snippets.map((s) => [s.id, s.enabled])).toEqual([
    ["obsidian-lettura-larga", true],
    ["obsidian-spenta", false],
    ["obsidian-obsidian", false],
  ]);

  const again = await importObsidianSnippets(PAYLOAD);
  expect(again).toMatchObject({ added: 0, same: 3 });
  expect(machine.writes).toHaveLength(1);
});

it("un documento di una versione futura non si riscrive", async () => {
  machine.value = '{"version":9,"snippets":[]}';
  await expect(importObsidianSnippets(PAYLOAD)).rejects.toThrow(/version/);
  expect(machine.writes).toHaveLength(0);
});
