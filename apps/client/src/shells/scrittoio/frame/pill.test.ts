// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { emit, state } from "../../../state/store";
import type { CommandEntry } from "../../../ui/commands";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";

const world = vi.hoisted(() => ({
  commands: [] as unknown[],
  started: [] as string[],
  language: "it",
  languageListeners: new Set<() => void>(),
}));

vi.mock("../../../ui/commands", async (original) => ({
  ...(await original<typeof import("../../../ui/commands")>()),
  allCommands: () => world.commands,
}));
vi.mock("../../../ui/palette", () => ({
  startCommand: (entry: { id: string }) => world.started.push(entry.id),
}));
vi.mock("../../../state/palette-host", () => ({ paletteHost: {} }));
// Le parole sono le chiavi, con gli argomenti accanto; in un'altra lingua
// portano il suo nome, così si vede chi ha ridisegnato.
vi.mock("../../../i18n/strings", () => ({
  t: (key: string, args?: Record<string, unknown>) =>
    [key, args ? JSON.stringify(args) : "", world.language === "it" ? "" : `(${world.language})`].filter(Boolean).join(" "),
  onLanguage: (listener: () => void) => {
    world.languageListeners.add(listener);
    return () => world.languageListeners.delete(listener);
  },
}));
vi.mock("../../../ui/tooltip", () => ({
  setTooltip: (el: HTMLElement, text: string) => {
    el.dataset.tip = text;
  },
}));
vi.mock("../../../ui/icons", () => ({ icon: (name: string) => `<svg data-icon="${name}"></svg>` }));

import { mountPill, PILL_COMMAND, PILL_COMMAND_WITHOUT_VAULT, pillPath } from "./pill";

function command(id: string, binding: string | null): CommandEntry {
  return { id, title: id, description: "", layer: "global", binding, declared: binding, spec: null, run: () => {} };
}

function changeLanguage(next: string): void {
  world.language = next;
  for (const listener of [...world.languageListeners]) listener();
}

/// La pillola com'è scritta in `index.html`.
function markup(): void {
  document.body.innerHTML = `
    <button id="pill" type="button">
      <span id="pill-icon" aria-hidden="true"></span>
      <span id="pill-path"></span>
      <span id="pill-title">Apri, cerca, comanda…</span>
      <kbd id="pill-key" aria-hidden="true"></kbd>
    </button>`;
}

const pill = (): HTMLButtonElement => document.getElementById("pill") as HTMLButtonElement;
const part = (id: string): HTMLElement => document.getElementById(id)!;

/// Ciò che la pillola dice, tutto insieme: serve a provare che non è cambiato.
function said(): Record<string, unknown> {
  return {
    path: part("pill-path").textContent,
    title: part("pill-title").textContent,
    key: part("pill-key").textContent,
    name: pill().getAttribute("aria-label"),
    tip: pill().dataset.tip,
    empty: pill().hasAttribute("data-empty"),
  };
}

let lifetime: Lifetime;
/// Un testimone fuori dalla pillola: i clic che arrivano fino al documento.
let witness: Lifetime;
let outside: Mock<() => void>;

beforeEach(() => {
  world.commands = [command(PILL_COMMAND, "Mod-O"), command(PILL_COMMAND_WITHOUT_VAULT, "Mod-Shift-P")];
  world.started.length = 0;
  world.language = "it";
  state.vaultRoot = "";
  state.currentDoc = null;
  markup();
  lifetime = openLifetime();
  witness = openLifetime();
  outside = vi.fn<() => void>();
  witness.listen(document, "click", outside);
});

afterEach(() => {
  lifetime.close();
  witness.close();
  expect(world.languageListeners.size).toBe(0);
  state.vaultRoot = "";
  state.currentDoc = null;
  document.body.replaceChildren();
});

describe("pillPath", () => {
  it("legge la cartella di un documento come una strada", () => {
    expect(pillPath("a/b/Nota.md")).toBe("a › b");
    expect(pillPath("Progetti/Alpha.md")).toBe("Progetti");
  });

  it("è vuota per un documento in radice", () => {
    expect(pillPath("Nota.md")).toBe("");
    expect(pillPath("")).toBe("");
  });

  it("non conta i segmenti vuoti", () => {
    expect(pillPath("/a//b/Nota.md")).toBe("a › b");
  });
});

describe("la pillola a riposo", () => {
  it("senza documento resta l'invito, e i tasti sono quelli del comando che preme", () => {
    mountPill(lifetime);
    expect(part("pill-icon").querySelector("svg")?.dataset.icon).toBe("search");
    expect(part("pill-title").textContent).toBe("frame.pill.empty");
    expect(part("pill-path").hidden).toBe(true);
    expect(part("pill-path").textContent).toBe("");
    expect(pill().hasAttribute("data-empty")).toBe(true);
    expect(pill().getAttribute("aria-label")).toBe("frame.pill");
    expect(part("pill-key").textContent).toBe("Ctrl+O");
    expect(part("pill-key").hidden).toBe(false);
    expect(pill().dataset.tip).toBe("frame.pill.hint (Ctrl+O)");
  });

  it("con un documento dice dove sei: la cartella, poi il titolo", () => {
    state.currentDoc = "Progetti/Alpha/Nota.md";
    mountPill(lifetime);
    expect(part("pill-path").textContent).toBe("Progetti › Alpha › ");
    expect(part("pill-path").hidden).toBe(false);
    expect(part("pill-title").textContent).toBe("Nota");
    expect(pill().hasAttribute("data-empty")).toBe(false);
    expect(pill().getAttribute("aria-label")).toBe('frame.pill.at {"title":"Nota"}');
  });

  it("un documento in radice non ha una cartella da mostrare", () => {
    state.currentDoc = "Nota.md";
    mountPill(lifetime);
    expect(part("pill-path").hidden).toBe(true);
    expect(part("pill-path").textContent).toBe("");
    expect(part("pill-title").textContent).toBe("Nota");
  });

  it("senza accordo i tasti spariscono, dalla pillola e dal suggerimento", () => {
    world.commands = [command(PILL_COMMAND, null)];
    mountPill(lifetime);
    expect(part("pill-key").hidden).toBe(true);
    expect(part("pill-key").textContent).toBe("");
    expect(pill().dataset.tip).toBe("frame.pill.hint");
  });
});

describe("la pillola segue la shell", () => {
  it("il documento a fuoco che cambia, o si chiude", () => {
    mountPill(lifetime);
    state.currentDoc = "Diario/Oggi.md";
    emit("active-doc", state.currentDoc);
    expect(part("pill-path").textContent).toBe("Diario › ");
    expect(part("pill-title").textContent).toBe("Oggi");
    expect(pill().hasAttribute("data-empty")).toBe(false);

    state.currentDoc = null;
    emit("active-doc", null);
    expect(part("pill-path").hidden).toBe(true);
    expect(part("pill-title").textContent).toBe("frame.pill.empty");
    expect(pill().hasAttribute("data-empty")).toBe(true);
    expect(pill().getAttribute("aria-label")).toBe("frame.pill");
  });

  it("il vault che si apre e l'elenco dei documenti che cambia", () => {
    mountPill(lifetime);
    state.currentDoc = "Nota.md";
    emit("vault", "/vault");
    expect(part("pill-title").textContent).toBe("Nota");

    state.currentDoc = "Rinominata.md";
    emit("documents");
    expect(part("pill-title").textContent).toBe("Rinominata");
  });

  it("gli accordi che cambiano", () => {
    mountPill(lifetime);
    world.commands = [command(PILL_COMMAND, "Mod-P")];
    emit("commands");
    expect(part("pill-key").textContent).toBe("Ctrl+P");
    expect(pill().dataset.tip).toBe("frame.pill.hint (Ctrl+P)");
  });

  it("la lingua che cambia", () => {
    mountPill(lifetime);
    changeLanguage("en");
    expect(part("pill-title").textContent).toBe("frame.pill.empty (en)");
    expect(pill().getAttribute("aria-label")).toBe("frame.pill (en)");
    expect(pill().dataset.tip).toBe("frame.pill.hint (en) (Ctrl+O)");
  });
});

describe("la pillola premuta", () => {
  it("con un vault apre il lanciatore", () => {
    state.vaultRoot = "/vault";
    mountPill(lifetime);
    pill().click();
    expect(world.started).toEqual([PILL_COMMAND]);
  });

  it("senza un vault restano i comandi", () => {
    mountPill(lifetime);
    pill().click();
    expect(world.started).toEqual([PILL_COMMAND_WITHOUT_VAULT]);
  });

  it("decide al momento del clic, non al montaggio", () => {
    mountPill(lifetime);
    state.vaultRoot = "/vault";
    pill().click();
    expect(world.started).toEqual([PILL_COMMAND]);
  });

  it("se il comando non c'è non succede niente", () => {
    world.commands = [];
    state.vaultRoot = "/vault";
    mountPill(lifetime);
    expect(() => pill().click()).not.toThrow();
    expect(world.started).toEqual([]);
  });

  it("il clic resta suo: non arriva a chi ascolta il documento", () => {
    mountPill(lifetime);
    pill().click();
    expect(outside).not.toHaveBeenCalled();
  });
});

describe("la pillola e il markup che manca", () => {
  it("senza `#pill` non monta niente", () => {
    document.body.replaceChildren();
    expect(() => mountPill(lifetime)).not.toThrow();
    expect(world.languageListeners.size).toBe(0);
    expect(() => emit("active-doc", null)).not.toThrow();
  });

  it("le parti interne sono facoltative: il nome e il gesto restano", () => {
    document.body.innerHTML = '<button id="pill" type="button"></button>';
    state.currentDoc = "a/Nota.md";
    mountPill(lifetime);
    expect(pill().getAttribute("aria-label")).toBe('frame.pill.at {"title":"Nota"}');
    expect(pill().dataset.tip).toBe("frame.pill.hint (Ctrl+O)");
    pill().click();
    expect(world.started).toEqual([PILL_COMMAND_WITHOUT_VAULT]);
  });
});

describe("la pillola smontata", () => {
  it("non preme più niente e non segue più nessuno", () => {
    state.vaultRoot = "/vault";
    mountPill(lifetime);
    const before = said();
    lifetime.close();

    pill().click();
    expect(world.started).toEqual([]);
    // Il clic non è più suo: torna a salire come quello di un bottone qualunque.
    expect(outside).toHaveBeenCalledTimes(1);

    state.currentDoc = "Diario/Oggi.md";
    world.commands = [command(PILL_COMMAND, "Mod-P")];
    emit("active-doc", state.currentDoc);
    emit("vault", "/altro");
    emit("documents");
    emit("commands");
    changeLanguage("en");
    expect(said()).toEqual(before);
  });
});
