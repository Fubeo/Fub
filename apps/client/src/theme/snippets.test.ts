// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { Lifetime } from "../ui/lifetime";
import { mountCssSnippets, previewCssSnippets, cancelCssSnippetsPreview, cssSnippetCatalog, saveCssSnippets } from "./snippets";
import { mountedCss } from "./loader";

const machine = vi.hoisted(() => ({
  value: '{"version":999,"snippets":[]}',
  setSetting: vi.fn(async () => {}),
}));
vi.mock("../host/query", () => ({
  settings: async () => [{ spec: { key: "appearance.css-snippets" }, value: machine.value }],
}));
vi.mock("../host/ipc", () => ({ api: { setSetting: machine.setSetting } }));
vi.mock("../state/kernel", () => ({ onEvent: () => () => {} }));


it("cancels a CSS preview despite a future persisted document without modifying it", async () => {
  const lifetime = new Lifetime();
  mountCssSnippets(lifetime);
  await Promise.resolve();
  await Promise.resolve();
  previewCssSnippets('{"version":1,"snippets":[{"id":"preview","css":".markdown-preview { color: #eee; }","enabled":true}]}');
  expect(mountedCss("snippets")).toContain("#eee");

  expect(() => cancelCssSnippetsPreview()).not.toThrow();
  expect(mountedCss("snippets")).toBeNull();
  expect(cssSnippetCatalog()).toEqual([expect.objectContaining({
    id: "(stored)", enabled: false, trust: "local-user", error: expect.stringContaining("version"),
  })]);
  expect(machine.setSetting).not.toHaveBeenCalled();
  lifetime.close();
});

it("un frammento rifiutato dice perché nella lingua dell'interfaccia, una volta per colpa (IMP-023)", async () => {
  const raw = '{"version":1,"snippets":[{"id":"i4","enabled":true,"css":"p{margin:0}"}]}';
  const refused = await saveCssSnippets(raw).then(() => null, (error: unknown) => (error as Error).message);
  expect(refused).toBe(
    "i4: riga 1, colonna 1: il selettore «p» non è fra quelli ammessi; " +
      "riga 1, colonna 3: la proprietà «margin» non è ammessa",
  );
  expect(machine.setSetting).not.toHaveBeenCalled();
});

it("un documento che non è JSON lo dice con parole dell'interfaccia", async () => {
  const refused = await saveCssSnippets("{non json").then(() => null, (error: unknown) => (error as Error).message);
  expect(refused).toBe("il testo non è un JSON valido");
});
