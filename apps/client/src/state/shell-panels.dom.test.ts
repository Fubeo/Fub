// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>();
  const on = vi.fn((event: string, callback: () => void) => {
    const set = listeners.get(event) ?? new Set<() => void>();
    set.add(callback);
    listeners.set(event, set);
    return () => set.delete(callback);
  });
  return { listeners, on, loadBookmarks: vi.fn(), loadWorkspaces: vi.fn() };
});
vi.mock("./store", () => ({ on: fake.on, state: { expanded: new Set(), activeSpace: null } }));
vi.mock("./kernel", () => ({ onEvent: () => () => {} }));
vi.mock("./layout", () => ({ layout: { focus: "main", panes: { main: { tabs: [] } } }, pane: () => null,
  activeTab: () => null, documents: () => [] }));
vi.mock("./bookmarks", () => ({ loadBookmarks: fake.loadBookmarks, bookmarkLoadSnapshot: () => ({ kind: "empty" }),
  listBookmarks: () => [], listGroups: () => [] }));
vi.mock("./workspaces", () => ({ loadWorkspaces: fake.loadWorkspaces,
  workspaceLoadSnapshot: () => ({ kind: "empty" }) }));
vi.mock("./shell-commands", () => ({ openBookmarkTarget: vi.fn(), applyWorkspaceById: vi.fn() }));
vi.mock("../ui/views", () => ({ primaryView: () => undefined }));
vi.mock("../ui/menu", () => ({ showContextMenu: vi.fn() }));
vi.mock("../ui/notify", () => ({ notify: vi.fn() }));
vi.mock("../ui/tooltip", () => ({ setTooltip: vi.fn() }));
vi.mock("../i18n/strings", () => ({ t: (key: string) => key }));

import { openLifetime } from "../ui/lifetime";
import { mountBookmarksPanel } from "./bookmarks-ui";
import { mountWorkspacesPanel } from "./workspaces-ui";

const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

afterEach(() => {
  fake.listeners.clear();
  fake.on.mockClear();
  document.body.replaceChildren();
});

describe("shell panel lifetimes", () => {
  it("remounts exactly one panel per owner and never resurrects panels after disposal", async () => {
    document.body.innerHTML = '<aside id="sidebar"></aside>';
    fake.loadBookmarks.mockResolvedValue({ kind: "empty" });
    fake.loadWorkspaces.mockResolvedValue({ kind: "empty" });
    const first = openLifetime();
    mountBookmarksPanel(first);
    mountWorkspacesPanel(first);
    await settle();
    expect(document.querySelectorAll("#bookmarks-panel, #workspaces-panel")).toHaveLength(2);
    first.close();
    for (const callback of fake.listeners.get("vault") ?? []) callback();
    await settle();
    expect(document.querySelectorAll("#bookmarks-panel, #workspaces-panel")).toHaveLength(0);

    const second = openLifetime();
    mountBookmarksPanel(second);
    mountWorkspacesPanel(second);
    await settle();
    expect(document.querySelectorAll("#bookmarks-panel, #workspaces-panel")).toHaveLength(2);
    second.close();
    expect(document.querySelectorAll("#bookmarks-panel, #workspaces-panel")).toHaveLength(0);
  });
});
