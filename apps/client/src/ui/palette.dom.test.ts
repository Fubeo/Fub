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

import { drawingCreateSpec } from "../host/fake";
import { allCommands, registerCommandForm, resetCommandForms, type CommandEntry } from "./commands";
import { state } from "../state/store";
import { closeCommandPalette, deliverOutcome, openCommandPalette, startCommand } from "./palette";

function command(id: string, title: string): CommandSpec {
  return {
    id,
    title,
    description: `${title} description`,
    keybinding: null,
    params: [],
    scope: { writes: false, reach: "session", reversible: true },
    surfaces: [],
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
  resetCommandForms();
  state.commandSpecs = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
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
    const before = options(list);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));

    const afterArrow = options(list);
    expect(document.activeElement).toBe(input);
    expect(afterArrow[1]!.getAttribute("aria-selected")).toBe("true");
    expect(afterArrow.filter((row) => row.getAttribute("aria-selected") === "true")).toEqual([afterArrow[1]]);
    expect(input.getAttribute("aria-activedescendant")).toBe(afterArrow[1]!.id);
    // La freccia sposta la scelta sulle righe che ci sono, senza ricostruirle.
    expect(afterArrow).toEqual(before);
    afterArrow.forEach((row, index) => expect(row).toBe(before[index]));

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

  it("un kernel che non risponde non tiene chiusa la palette, e i suoi comandi arrivano dopo", async () => {
    await openPalette([command("cmd.old", "Vecchio")]);
    closeCommandPalette();
    vi.runAllTimers();
    let answer!: (value: CommandSpec[]) => void;
    fake.listCommands.mockReturnValue(new Promise<CommandSpec[]>((resolve) => { answer = resolve; }));
    fake.settings.mockResolvedValue([]);
    const opening = openCommandPalette(host);
    await vi.advanceTimersByTimeAsync(400);
    const overlay = document.getElementById("command-palette");
    expect(overlay).not.toBeNull();
    const titles = () => [...overlay!.querySelectorAll(".palette-title")].map((node) => node.textContent);
    expect(titles()).toContain("Vecchio");
    const input = overlay!.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    input.value = "uo";
    input.dispatchEvent(new Event("input"));
    answer([command("cmd.new", "Nuovo")]);
    await opening;
    // L'elenco nuovo, filtrato da ciò che era già scritto.
    expect(input.value).toBe("uo");
    expect(titles()).toContain("Nuovo");
    expect(titles()).not.toContain("Vecchio");
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

describe("il modulo proprio di un comando", () => {
  /// La voce di `drawing.create` come la vede la tastiera.
  function creation(): CommandEntry {
    state.commandSpecs = [drawingCreateSpec()];
    return allCommands().find((entry) => entry.id === "drawing.create")!;
  }

  it("Invio su un comando che ha un modulo chiude la palette e apre il modulo, senza invocare niente", async () => {
    const opened: Record<string, string>[] = [];
    registerCommandForm("drawing.create", (prefill) => opened.push({ ...prefill }));
    const { input } = await openPalette([drawingCreateSpec(), command("cmd.alpha", "Alpha")]);
    input.value = "nuovo disegno";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    vi.runAllTimers();
    await Promise.resolve();

    expect(opened).toEqual([{}]);
    expect(document.getElementById("command-palette")).toBeNull();
    expect(fake.invokeCommand).not.toHaveBeenCalled();
  });

  it("una scorciatoia lo apre senza passare dalla palette, col prefill di chi lo lancia", () => {
    const opened: Record<string, string>[] = [];
    registerCommandForm("drawing.create", (prefill) => opened.push({ ...prefill }));
    startCommand(creation(), host, { folder: "Schemi" });

    expect(opened).toEqual([{ folder: "Schemi" }]);
    expect(document.getElementById("command-palette")).toBeNull();
    expect(fake.invokeCommand).not.toHaveBeenCalled();
  });

  it("se la palette era aperta, la chiude e apre il modulo una volta sola", async () => {
    await openPalette([drawingCreateSpec()]);
    expect(document.getElementById("command-palette")).not.toBeNull();
    const opened: Record<string, string>[] = [];
    registerCommandForm("drawing.create", (prefill) => opened.push({ ...prefill }));
    startCommand(creation(), host);
    vi.runAllTimers();
    expect(opened).toEqual([{}]);
    expect(document.getElementById("command-palette")).toBeNull();
  });

  it("senza un modulo registrato il comando passa dal modulo generico, e il prefill riempie i campi", async () => {
    // happy-dom non mette `Option` fra i globali, e il modulo generico lo usa
    // per le scelte.
    vi.stubGlobal(
      "Option",
      function (text: string, value: string) {
        const option = document.createElement("option");
        option.textContent = text;
        option.value = value;
        return option;
      },
    );
    startCommand(creation(), host, { folder: "Schemi", template: "slide" });
    const overlay = document.getElementById("command-palette")!;
    const fields = [...overlay.querySelectorAll<HTMLInputElement | HTMLSelectElement>("form input, form select")];
    const byLabel = (title: string) =>
      fields.find((field) => field.closest("label")?.querySelector(".palette-label")?.textContent === title)!;
    expect(byLabel("Cartella").value).toBe("Schemi");
    expect(byLabel("Modello").value).toBe("slide");
    expect(byLabel("Nome").value).toBe("");
    expect(fake.invokeCommand).not.toHaveBeenCalled();

    overlay.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() =>
      expect(fake.invokeCommand).toHaveBeenCalledWith(
        "drawing.create",
        expect.objectContaining({ folder: "Schemi", template: "slide" }),
        "apply",
      ),
    );
  });

  it("un comando di shell non ha moduli: parte com'è", () => {
    const run = vi.fn();
    registerCommandForm("shell.qualcosa", () => {
      throw new Error("un comando di shell non ha un modulo");
    });
    startCommand(
      { id: "shell.qualcosa", title: "Qualcosa", description: "", layer: "global", binding: null, declared: null, spec: null, run },
      host,
    );
    expect(run).toHaveBeenCalledOnce();
  });
});

describe("consegnare l'esito di un comando", () => {
  it("avvisa, ricorda il comando e passa l'effetto alla shell: lo stesso giro della palette", async () => {
    const effect = { kind: "navigate" as const, doc: "Schemi/Disegno.svg" };
    await deliverOutcome({ notify: "Creato", effect, undo: null, partial: null }, host, "drawing.create");
    expect(host.notify).toHaveBeenCalledWith("Creato", "info");
    expect(host.onEffect).toHaveBeenCalledWith(effect);
  });

  it("un esito a metà si avvisa col tono del guasto", async () => {
    await deliverOutcome(
      { notify: "Creato a metà", effect: { kind: "done" }, undo: null, partial: { done: 1, total: 2 } as never },
      host,
    );
    expect(host.notify).toHaveBeenCalledWith("Creato a metà", "guasto");
  });
});
