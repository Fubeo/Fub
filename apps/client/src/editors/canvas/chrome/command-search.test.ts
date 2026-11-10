// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import type { CanvasCommand } from "./commands";
import {
  RECENT_COMMANDS_LIMIT,
  RECENT_COMMANDS_VERSION,
  RecentCommands,
  openCommandSearch,
  parseRecentCommands,
  type RecentCommandsStore,
} from "./command-search";

afterEach(() => {
  document.body.replaceChildren();
});

function command(id: string, label: string, extra: Partial<CanvasCommand> = {}, ran: string[] = []): CanvasCommand {
  return {
    id,
    label,
    path: "Lavagna › Vista",
    keys: [],
    context: "always",
    boardKeys: false,
    danger: false,
    disabled: () => null,
    run: () => ran.push(id),
    ...extra,
  };
}

/// Un posto dove ricordare in memoria, con le scritture che ha ricevuto.
function memoryStore(initial: Record<string, unknown> = {}): RecentCommandsStore & { writes: Array<[string, unknown]> } {
  const values = new Map(Object.entries(initial));
  const writes: Array<[string, unknown]> = [];
  return {
    writes,
    read: async (documentId) => values.get(documentId),
    write: async (documentId, value) => {
      writes.push([documentId, value]);
      values.set(documentId, value);
    },
  };
}

function opened(commands: CanvasCommand[], recent: readonly string[] = []) {
  const life = openLifetime();
  const closes: Array<{ reason: string; chosen: string | null }> = [];
  const anchor = document.createElement("button");
  document.body.append(anchor);
  anchor.focus();
  const handle = openCommandSearch({
    anchor,
    commands,
    recent: () => recent,
    lifetime: life,
    onClose: (reason, chosen) => closes.push({ reason, chosen: chosen?.id ?? null }),
  });
  const root = document.querySelector<HTMLElement>(".draw-commands-dialog")!;
  const input = root.querySelector<HTMLInputElement>(".draw-commands-field input")!;
  const labels = (): string[] => [...root.querySelectorAll(".draw-commands-label")].map((one) => one.textContent!);
  const type = (text: string): void => {
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  return { life, closes, anchor, handle, root, input, labels, type };
}

describe("la ricerca dei comandi della lavagna", () => {
  it("cerca coi nomi, dice quando non trova niente e mostra il tasto e il perché di un comando spento", () => {
    const commands = [
      command("canvas.fit", "Mostra tutta la lavagna", { keys: ["Shift-1", "Mod-0"] }),
      command("canvas.zoom_in", "Ingrandisci"),
      command("canvas.align.left", "Allinea a sinistra", { disabled: () => "Scegli almeno due schede." }),
    ];
    const search = opened(commands);
    expect(search.root.getAttribute("role")).toBe("dialog");
    expect(document.activeElement).toBe(search.input);
    expect(search.labels()).toEqual(["Mostra tutta la lavagna", "Ingrandisci", "Allinea a sinistra"]);
    expect(search.root.querySelector(".draw-commands-key")!.textContent).toBe("Shift+1");
    const why = search.root.querySelector(".draw-commands-why")!;
    expect(why.textContent).toBe("Scegli almeno due schede.");
    expect(why.closest("[aria-disabled=true]")).not.toBeNull();
    search.type("ingr");
    expect(search.labels()).toEqual(["Ingrandisci"]);
    expect(search.root.querySelector(".draw-commands-empty")!.textContent).toBe("");
    search.type("zzzz");
    expect(search.labels()).toEqual([]);
    expect(search.root.querySelector(".draw-commands-empty")!.textContent).toBe("Nessun comando per questa ricerca.");
    search.life.close();
    expect(document.querySelector(".draw-commands-dialog")).toBeNull();
  });

  it("i recenti stanno in cima; Invio sceglie, Esc chiude e il fuoco torna dov'era", () => {
    const commands = [command("canvas.fit", "Mostra tutta la lavagna"), command("canvas.zoom_in", "Ingrandisci"), command("canvas.zoom_out", "Riduci")];
    const first = opened(commands, ["canvas.zoom_out"]);
    expect(first.labels()).toEqual(["Riduci", "Mostra tutta la lavagna", "Ingrandisci"]);
    first.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(first.closes).toEqual([{ reason: "manual", chosen: "canvas.zoom_out" }]);
    const second = opened(commands);
    second.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(second.closes).toEqual([{ reason: "escape", chosen: null }]);
    expect(document.activeElement).toBe(second.anchor);
  });

  it("un comando spento non si sceglie", () => {
    const search = opened([command("canvas.align.left", "Allinea a sinistra", { disabled: () => "Scegli almeno due schede." })]);
    search.root.querySelector<HTMLElement>(".draw-commands-row")!.click();
    expect(search.closes).toEqual([]);
    search.life.close();
  });
});

describe("i recenti, per lavagna", () => {
  it("si ricordano per lavagna, al più cinque, senza doppi, e si scrivono", async () => {
    const store = memoryStore();
    const recents = new RecentCommands(store);
    for (const id of ["canvas.a", "canvas.b", "canvas.c", "canvas.d", "canvas.e", "canvas.f", "canvas.b"]) recents.remember("uno.canvas", id);
    expect(recents.list("uno.canvas")).toEqual(["canvas.b", "canvas.f", "canvas.e", "canvas.d", "canvas.c"]);
    expect(recents.list("due.canvas")).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.writes.at(-1)).toEqual(["uno.canvas", { version: RECENT_COMMANDS_VERSION, recent: ["canvas.b", "canvas.f", "canvas.e", "canvas.d", "canvas.c"] }]);
  });

  it("si leggono una volta; quelli scelti intanto restano davanti", async () => {
    const store = memoryStore({ "uno.canvas": { version: RECENT_COMMANDS_VERSION, recent: ["canvas.fit", "canvas.zoom_in"] } });
    const recents = new RecentCommands(store);
    const loading = recents.load("uno.canvas");
    recents.remember("uno.canvas", "canvas.zoom_out");
    await loading;
    expect(recents.list("uno.canvas")).toEqual(["canvas.zoom_out", "canvas.fit", "canvas.zoom_in"]);
  });

  it("uno stato che non si legge, o un posto che non risponde, non ferma niente", async () => {
    expect(parseRecentCommands(null)).toEqual([]);
    expect(parseRecentCommands({ version: 99, recent: ["canvas.fit"] })).toEqual([]);
    expect(parseRecentCommands({ version: RECENT_COMMANDS_VERSION, recent: ["canvas.fit", 3, "draw.undo", "canvas.fit"] })).toEqual(["canvas.fit"]);
    const many = Array.from({ length: 9 }, (_, at) => `canvas.c${at}`);
    expect(parseRecentCommands({ version: RECENT_COMMANDS_VERSION, recent: many })).toHaveLength(RECENT_COMMANDS_LIMIT);
    const broken = new RecentCommands({
      read: () => Promise.reject(new Error("no")),
      write: () => {
        throw new Error("no");
      },
    });
    await broken.load("uno.canvas");
    broken.remember("uno.canvas", "canvas.fit");
    expect(broken.list("uno.canvas")).toEqual(["canvas.fit"]);
  });
});
