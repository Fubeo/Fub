// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  notesByName: vi.fn(),
  settings: vi.fn(),
  existingRecentNotes: vi.fn(),
  recentSearches: vi.fn(),
  rememberSearch: vi.fn(),
  rememberOpens: vi.fn(),
  forgetAll: vi.fn(),
  createNote: vi.fn(),
  openDocument: vi.fn(),
  notify: vi.fn(),
  setTooltip: vi.fn(),
}));

vi.mock("../host/query", () => ({ notesByName: fake.notesByName, settings: fake.settings }));
vi.mock("../state/recent", () => ({
  existingRecentNotes: fake.existingRecentNotes,
  recentSearches: fake.recentSearches,
  rememberSearch: fake.rememberSearch,
  rememberOpens: fake.rememberOpens,
  forgetAll: fake.forgetAll,
}));
vi.mock("../state/vault", () => ({ createNote: fake.createNote }));
vi.mock("../ui/notify", () => ({ notify: fake.notify }));
vi.mock("../ui/tooltip", () => ({ setTooltip: fake.setTooltip }));
vi.mock("./document", () => ({ openDocument: fake.openDocument }));

import { closeQuickSwitcher, openQuickSwitcher } from "./quick-switcher";

const hostEntries = ["notes/Alpha.md", "notes/Beta.md", "notes/Gamma.md"];

async function settleSearch(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

async function openSwitcher(entries = hostEntries): Promise<{
  overlay: HTMLElement;
  input: HTMLInputElement;
  list: HTMLUListElement;
}> {
  fake.existingRecentNotes.mockResolvedValue(entries);
  fake.recentSearches.mockReturnValue([]);
  fake.notesByName.mockResolvedValue(entries);
  openQuickSwitcher();
  await settleSearch();
  const overlay = document.getElementById("quick-switcher")!;
  const input = overlay.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  const list = overlay.querySelector<HTMLUListElement>('ul[role="listbox"]')!;
  return { overlay, input, list };
}

function options(list: HTMLUListElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>('li[role="option"]:not(.palette-empty)'));
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
  fake.notesByName.mockReset();
  fake.existingRecentNotes.mockReset();
  fake.recentSearches.mockReset();
  fake.rememberSearch.mockReset();
  fake.rememberOpens.mockReset();
  fake.forgetAll.mockReset();
  fake.createNote.mockReset();
  fake.openDocument.mockReset();
  fake.notify.mockReset();
  fake.setTooltip.mockReset();
  fake.settings.mockReset();
});

afterEach(() => {
  closeQuickSwitcher();
  vi.runAllTimers();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("combobox del quick switcher", () => {
  it("dichiara il popup e tiene la selezione sull'input", async () => {
    const { input, list } = await openSwitcher();
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-controls")).toBe(list.id);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(list.id).toBe("quick-switcher-list");
    expect(list.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(input);

    const rows = options(list);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(input.getAttribute("aria-activedescendant")).toBe(rows[0]!.id);
    expect(rows.filter((row) => row.getAttribute("aria-selected") === "true")).toEqual([rows[0]]);
  });

  it("Arrow aggiorna il descendant e il filtro mantiene l'id della voce", async () => {
    const { input, list } = await openSwitcher();
    const alphaId = options(list)[0]!.id;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-activedescendant")).toBe(options(list)[1]!.id);

    fake.notesByName.mockResolvedValue(["notes/Alpha.md"]);
    input.value = "Alpha";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    vi.advanceTimersByTime(180);
    await settleSearch();

    expect(options(list)).toHaveLength(1);
    expect(options(list)[0]!.id).toBe(alphaId);
    expect(input.getAttribute("aria-activedescendant")).toBe(alphaId);
    expect(document.activeElement).toBe(input);
  });

  it("mostra un vuoto valido senza descendant attivo", async () => {
    const { input, list } = await openSwitcher();
    fake.notesByName.mockResolvedValue([]);
    input.value = ".";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    vi.advanceTimersByTime(180);
    await settleSearch();

    const empty = list.querySelector<HTMLElement>(".palette-empty")!;
    expect(empty.getAttribute("role")).toBe("option");
    expect(empty.getAttribute("aria-disabled")).toBe("true");
    expect(empty.getAttribute("aria-selected")).toBe("false");
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
    expect(document.activeElement).toBe(input);
  });

  it("Enter apre la nota selezionata", async () => {
    const { input } = await openSwitcher();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settleSearch();

    expect(fake.openDocument).toHaveBeenCalledWith("notes/Beta.md");
    expect(fake.rememberSearch).toHaveBeenCalledWith("");
  });

  it("chiudendo rimuove la superficie e restituisce il fuoco", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    await openSwitcher();
    closeQuickSwitcher();
    vi.runAllTimers();

    expect(document.getElementById("quick-switcher")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
