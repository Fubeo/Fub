// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandSpec } from "../host/contract";

const fake = vi.hoisted(() => ({
  listCommands: vi.fn(),
  invokeCommand: vi.fn(),
  settings: vi.fn(),
}));

vi.mock("../host/ipc", () => ({ api: fake }));
vi.mock("../host/query", () => ({ settings: fake.settings }));

import { closeCommandPalette, openCommandPalette } from "./palette";

function command(id: string, title: string): CommandSpec {
  return {
    id,
    title,
    description: `${title} description`,
    keybinding: null,
    params: [],
    scope: { writes: false, reach: "session", reversible: true },
  };
}

const specs = [command("cmd.alpha", "Alpha"), command("cmd.beta", "Beta"), command("cmd.gamma", "Gamma")];
const host = {
  onEffect: vi.fn(),
  notify: vi.fn(),
  listDocuments: vi.fn(async () => []),
  flushPendingSave: vi.fn(async () => []),
};

async function openPalette(entries = specs): Promise<{
  overlay: HTMLElement;
  input: HTMLInputElement;
  list: HTMLUListElement;
}> {
  fake.listCommands.mockResolvedValue(entries);
  fake.settings.mockResolvedValue([]);
  await openCommandPalette(host);
  const overlay = document.getElementById("command-palette")!;
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
  fake.listCommands.mockReset();
  fake.invokeCommand.mockReset();
  fake.settings.mockReset();
  fake.invokeCommand.mockResolvedValue({ notify: null, effect: { kind: "done" }, undo: null, partial: null });
  host.onEffect.mockReset();
  host.notify.mockReset();
});

afterEach(() => {
  closeCommandPalette();
  vi.runAllTimers();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("combobox della palette", () => {
  it("dichiara il popup e mantiene il fuoco sull'input", async () => {
    const { input, list } = await openPalette();
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-controls")).toBe(list.id);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(list.id).toBe("command-palette-list");
    expect(list.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(input);

    const rows = options(list);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(input.getAttribute("aria-activedescendant")).toBe(rows[0]!.id);
    expect(rows.filter((row) => row.getAttribute("aria-selected") === "true")).toEqual([rows[0]]);
  });

  it("Arrow aggiorna la selezione, conserva gli id nel filtro e non sposta il fuoco", async () => {
    const { input, list } = await openPalette();
    const alphaId = options(list)[0]!.id;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));

    const afterArrow = options(list);
    expect(document.activeElement).toBe(input);
    expect(afterArrow[1]!.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(afterArrow[1]!.id);

    input.value = "alpha";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(options(list)).toHaveLength(1);
    expect(options(list)[0]!.id).toBe(alphaId);
    expect(input.getAttribute("aria-activedescendant")).toBe(alphaId);
    expect(document.activeElement).toBe(input);
  });

  it("rende un vuoto non selezionabile e toglie il descendant attivo", async () => {
    const { input, list } = await openPalette();
    input.value = "missing";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const empty = list.querySelector<HTMLElement>(".palette-empty")!;
    expect(empty.getAttribute("role")).toBe("option");
    expect(empty.getAttribute("aria-disabled")).toBe("true");
    expect(empty.getAttribute("aria-selected")).toBe("false");
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
    expect(document.activeElement).toBe(input);
  });

  it("Enter attiva il comando evidenziato", async () => {
    const { input } = await openPalette();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(fake.invokeCommand).toHaveBeenCalledWith("cmd.beta", {}, "apply");
  });

  it("un piano sul vault senza note si approva e poi si applica", async () => {
    const vaultCommand: CommandSpec = {
      ...command("vault.cmd", "Sul vault"),
      scope: { writes: true, reach: "vault", reversible: true },
    };
    fake.invokeCommand.mockImplementation(async (_id: string, _args: unknown, mode: string) =>
      mode === "dry_run"
        ? {
            notify: null,
            effect: { kind: "plan", summary: "Crea la cartella «a»", docs: [], edits: [] },
            undo: null,
            partial: null,
          }
        : { notify: null, effect: { kind: "done" }, undo: null, partial: null },
    );
    const { overlay, input } = await openPalette([vaultCommand]);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(overlay.querySelector(".palette-summary")).not.toBeNull());

    expect(overlay.querySelector(".palette-summary")?.textContent).toBe("Crea la cartella «a»");
    const apply = overlay.querySelector<HTMLButtonElement>(".palette-actions button.primary")!;
    expect(apply.disabled).toBe(false);
    apply.click();
    await vi.waitFor(() =>
      expect(fake.invokeCommand).toHaveBeenLastCalledWith("vault.cmd", {}, "apply"),
    );
    expect(fake.invokeCommand.mock.calls.map((call) => call[2])).toEqual(["dry_run", "apply"]);
  });

  it("chiudendo rimuove la superficie e restituisce il fuoco", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    await openPalette();
    closeCommandPalette();
    vi.runAllTimers();

    expect(document.getElementById("command-palette")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
