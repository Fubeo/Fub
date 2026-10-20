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

vi.mock("../host/query", () => ({
  notesByNameWithAliases: async (text: string) =>
    ((await fake.notesByName(text)) as (string | { doc: string; aliases: string[] })[])
      .map((found) => (typeof found === "string" ? { doc: found, aliases: [] } : found)),
  settings: fake.settings,
}));
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
vi.mock("../state/document-controller", () => ({ openDocument: fake.openDocument }));

import { closeQuickSwitcher, mountQuickSwitcher, openQuickSwitcher } from "./quick-switcher";

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
  fake.rememberOpens.mockReset().mockReturnValue(() => {});
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

  it("Maiusc+Invio crea la nota col nome scritto anche se qualcosa combacia", async () => {
    fake.createNote.mockResolvedValue("Riunione.md");
    const { input, list } = await openSwitcher(["notes/Riunione di marzo.md"]);
    input.value = "Riunione";
    input.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(200);
    await settleSearch();
    // Il nome proposto segna le parole scritte.
    expect(list.querySelector(".palette-title mark")?.textContent).toBe("Riunione");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
    await settleSearch();
    expect(fake.createNote).toHaveBeenCalledWith("Riunione");
    expect(fake.openDocument).toHaveBeenCalledWith("Riunione.md");
  });

  it("una nota trovata per un alias mostra l'alias e di chi è", async () => {
    const { input, list } = await openSwitcher();
    fake.notesByName.mockResolvedValue([
      { doc: "persone/Mario Rossi.md", aliases: ["Il capo", "MR"] },
      { doc: "notes/Capodanno.md", aliases: ["Il capo"] },
    ]);
    input.value = "capo";
    input.dispatchEvent(new Event("input"));
    vi.advanceTimersByTime(200);
    await settleSearch();
    const [first, second] = options(list);
    expect(first!.querySelector(".palette-title")?.textContent).toBe("Il capo");
    expect(first!.querySelector(".palette-title mark")?.textContent).toBe("capo");
    expect(first!.querySelector(".palette-desc")?.textContent).toContain("persone/Mario Rossi.md");
    // Il nome combacia già: l'alias non serve a spiegare la riga.
    expect(second!.querySelector(".palette-title")?.textContent).toBe("Capodanno");
    expect(second!.querySelector(".palette-desc")?.textContent).toBe("notes/Capodanno.md");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settleSearch();
    expect(fake.openDocument).toHaveBeenCalledWith("persone/Mario Rossi.md");
  });

  it("dispatches here, split and window from distinct keyboard modifiers", async () => {
    const dispatch = vi.fn();
    const unmount = mountQuickSwitcher(dispatch);
    try {
      for (const [modifiers, mode] of [
        [{}, "here"],
        [{ ctrlKey: true }, "split"],
        [{ metaKey: true, shiftKey: true }, "window"],
      ] as const) {
        const { input } = await openSwitcher(["notes/Alpha.md"]);
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...modifiers }));
        expect(dispatch).toHaveBeenLastCalledWith("notes/Alpha.md", mode);
      }
    } finally {
      unmount();
    }
  });

  it("disposing and remounting a switcher drops the prior dispatcher and overlay", async () => {
    const first = vi.fn();
    const stop = mountQuickSwitcher(first);
    await openSwitcher();
    stop();
    expect(document.getElementById("quick-switcher")?.querySelector("input")).toBeNull();
    const second = vi.fn();
    const stopAgain = mountQuickSwitcher(second);
    const { input } = await openSwitcher(["notes/Beta.md"]);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    stopAgain();
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

  it("un risultato si trascina fuori come la nota: la modale lascia passare il rilascio e poi si chiude", async () => {
    const { overlay, list } = await openSwitcher();
    const button = options(list)[1]!.querySelector<HTMLButtonElement>("button")!;
    expect(button.draggable).toBe(true);
    const offered = new Map<string, string>();
    const start = new Event("dragstart", { bubbles: true }) as DragEvent;
    Object.defineProperty(start, "dataTransfer", {
      value: { effectAllowed: "none", setData: (type: string, value: string) => offered.set(type, value) },
    });
    button.dispatchEvent(start);
    expect(offered.get("application/x-fub-note")).toBe("notes/Beta.md");
    expect(overlay.style.pointerEvents).toBe("");
    button.dispatchEvent(new Event("drag", { bubbles: true }));
    expect(overlay.style.pointerEvents).toBe("none");
    expect(fake.openDocument).not.toHaveBeenCalled();
    button.dispatchEvent(new Event("dragend", { bubbles: true }));
    vi.runAllTimers();
    expect(document.getElementById("quick-switcher")).toBeNull();
  });
});
