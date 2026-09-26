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
import { refreshPanel, registeredPanels } from "../ui/panel-host";
import { mountBookmarksPanel, toggleBookmarksPanel } from "./bookmarks-ui";
import { mountWorkspacesPanel, toggleWorkspacesPanel } from "./workspaces-ui";

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

describe("segnalibri e workspace passano dal registro dei pannelli", () => {
  it("si dichiarano a panel-host, e l'host non ridisegna ciò che non si vede", async () => {
    document.body.innerHTML = '<aside id="sidebar"></aside>';
    fake.loadBookmarks.mockResolvedValue({ kind: "empty" });
    fake.loadWorkspaces.mockResolvedValue({ kind: "empty" });
    const life = openLifetime();
    mountBookmarksPanel(life);
    mountWorkspacesPanel(life);
    await settle();

    const bookmarks = registeredPanels().find((panel) => panel.id === "shell:bookmarks");
    const workspaces = registeredPanels().find((panel) => panel.id === "shell:workspaces");
    expect(bookmarks?.placement).toBe("left_sidebar");
    expect(workspaces?.placement).toBe("left_sidebar");
    // La rinomina invecchia i segnalibri per maschera dichiarata, non per
    // un'iscrizione privata al bus.
    expect(bookmarks?.refresh.kinds).toEqual(["document_renamed"]);
    expect(workspaces?.refresh.kinds).toEqual([]);
    expect(fake.on.mock.calls.map(([event]) => event)).not.toContain("document_renamed");

    // Nascosti: l'host non li ridisegna. La visibilità è il DOM, non un flag.
    const bookmarksEl = document.getElementById("bookmarks-panel")!;
    const workspacesEl = document.getElementById("workspaces-panel")!;
    expect(bookmarks?.visible?.()).toBe(false);
    await refreshPanel("shell:bookmarks");
    expect(bookmarksEl.childElementCount).toBe(0);

    toggleBookmarksPanel();
    toggleWorkspacesPanel();
    await settle();
    expect(bookmarks?.visible?.()).toBe(true);
    expect(workspaces?.visible?.()).toBe(true);
    expect(bookmarksEl.hidden).toBe(false);
    expect(workspacesEl.hidden).toBe(false);
    expect(bookmarksEl.querySelector(".panel-title")).not.toBeNull();
    expect(workspacesEl.querySelector(".panel-title")).not.toBeNull();

    life.close();
    expect(registeredPanels().map((panel) => panel.id)).not.toContain("shell:bookmarks");
    expect(registeredPanels().map((panel) => panel.id)).not.toContain("shell:workspaces");
  });
});
