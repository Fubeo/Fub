// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { Lifetime } from "../ui/lifetime";
import { mountCssSnippets, previewCssSnippets, cancelCssSnippetsPreview, cssSnippetCatalog } from "./snippets";

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
  expect(document.head.querySelector('style[data-fub="snippets"]')?.textContent).toContain("#eee");

  expect(() => cancelCssSnippetsPreview()).not.toThrow();
  expect(document.head.querySelector('style[data-fub="snippets"]')).toBeNull();
  expect(cssSnippetCatalog()).toEqual([expect.objectContaining({
    id: "(stored)", enabled: false, trust: "local-user", error: expect.stringContaining("version"),
  })]);
  expect(machine.setSetting).not.toHaveBeenCalled();
  lifetime.close();
});
