// @vitest-environment happy-dom
// Le icone nascoste della rail sono un'impostazione della macchina
// (`chrome.rail.hidden`), come l'ordine: niente `localStorage`, e la chiave di
// prima si adotta una volta.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingEntry, SettingSource, SettingValue } from "../host/contract";

const fake = vi.hoisted(() => {
  document.body.innerHTML = `
  <nav id="views-ribbon"><div id="rail-shell"></div></nav>
  <div id="views-left"></div>
  <section id="files-panel"></section>
  <section id="search-panel"></section>`;
  return {
    entries: [] as SettingEntry[],
    writes: [] as Array<[string, unknown]>,
    menu: [] as Array<{ label?: string; run?: () => void }>,
  };
});
vi.mock("../host/query", () => ({ settings: async () => fake.entries }));
vi.mock("../host/ipc", () => ({
  api: {
    setSetting: async (key: string, value: unknown) => {
      fake.writes.push([key, value]);
    },
  },
}));
vi.mock("../state/kernel", () => ({ onEvent: () => () => {} }));
vi.mock("../ui/menu", () => ({
  showContextMenu: (_at: unknown, items: Array<{ label?: string; run?: () => void }>) => {
    fake.menu = items;
  },
}));

function entry(key: string, value: SettingValue, source: SettingSource = "machine"): SettingEntry {
  return { spec: { key, scope: "machine" }, value, source } as unknown as SettingEntry;
}

function button(panel: string): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`#views-ribbon .rail-btn[data-panel="${panel}"]`)!;
}

describe("le icone nascoste della rail", () => {
  let unmount: (() => void) | undefined;
  const PAGE = document.body.innerHTML;

  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = PAGE;
    localStorage.clear();
    fake.writes.length = 0;
    fake.menu = [];
  });

  afterEach(() => unmount?.());

  it("le dice l'impostazione della macchina", async () => {
    fake.entries = [entry("chrome.schema", 1), entry("chrome.rail.hidden", ["search"])];
    unmount = (await import("./rail")).mountRail();
    await vi.waitFor(() => expect(button("search").hidden).toBe(true));
    expect(button("files").hidden).toBe(false);
  });

  it("nasconderne una dalla rail la ricorda sulla macchina, non nella webview", async () => {
    fake.entries = [entry("chrome.schema", 1), entry("chrome.rail.hidden", [], "default")];
    unmount = (await import("./rail")).mountRail();
    await Promise.resolve();
    document.querySelector<HTMLButtonElement>(".rail-btn-manage")!.click();
    // La prima voce del menu nasconde la prima icona, «files».
    fake.menu[0]!.run!();
    expect(button("files").hidden).toBe(true);
    await vi.waitFor(() => expect(fake.writes).toEqual([["chrome.rail.hidden", ["files"]]]));
    expect(localStorage.length).toBe(0);
  });

  it("la chiave di prima si adotta una volta, se l'impostazione è ancora al default", async () => {
    localStorage.setItem("fub.shell.rail.v1", JSON.stringify({ order: ["search", "files"], hidden: ["search"] }));
    fake.entries = [entry("chrome.schema", 1), entry("chrome.rail.hidden", [], "default")];
    unmount = (await import("./rail")).mountRail();
    await vi.waitFor(() => expect(button("search").hidden).toBe(true));
    expect(fake.writes).toEqual([["chrome.rail.hidden", ["search"]]]);
    expect(localStorage.getItem("fub.shell.rail.v1")).toBeNull();
  });
});
