// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnownVault } from "../../../host/contract";
import { state } from "../../../state/store";
import type { CommandEntry } from "../../../ui/commands";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { closeContextMenu } from "../../../ui/menu";

const world = vi.hoisted(() => ({
  commands: [] as unknown[],
  started: [] as string[],
  language: "it",
  languageListeners: new Set<() => void>(),
  knownVaults: (): Promise<unknown[]> => Promise.resolve([]),
  asked: 0,
  openVault: (_root: string): Promise<void> => Promise.resolve(),
  opened: [] as string[],
  notices: [] as { text: string; tone: string }[],
}));

vi.mock("../../../desktop-shell", () => ({
  openVault: (root: string) => {
    world.opened.push(root);
    return world.openVault(root);
  },
}));
vi.mock("../../../host/ipc", () => ({
  api: {
    knownVaults: () => {
      world.asked += 1;
      return world.knownVaults();
    },
  },
}));
vi.mock("../../../ui/notify", () => ({
  notify: (text: string, tone = "info") => world.notices.push({ text, tone }),
}));
vi.mock("../../../ui/commands", async (original) => ({
  ...(await original<typeof import("../../../ui/commands")>()),
  allCommands: () => world.commands,
}));
vi.mock("../../../ui/palette", () => ({
  startCommand: (entry: { id: string }) => world.started.push(entry.id),
}));
vi.mock("../../../state/palette-host", () => ({ paletteHost: {} }));
vi.mock("../../../i18n/strings", () => ({
  t: (key: string, args?: Record<string, unknown>) =>
    [key, args ? JSON.stringify(args) : "", world.language === "it" ? "" : `(${world.language})`].filter(Boolean).join(" "),
  onLanguage: (listener: () => void) => {
    world.languageListeners.add(listener);
    return () => world.languageListeners.delete(listener);
  },
}));

import { listedVaults, mountVaultChip } from "./vault-chip";

const OPEN = "shell.vault.open";

function command(id: string): CommandEntry {
  return { id, title: id, description: "", layer: "global", binding: null, declared: null, spec: null, run: () => {} };
}

function vault(root: string, extra: Partial<KnownVault> = {}): KnownVault {
  return { root, name: "", icon: null, favorite: false, last_opened: 0, keys_seen: {}, ...extra };
}

function changeLanguage(next: string): void {
  world.language = next;
  for (const listener of [...world.languageListeners]) listener();
}

/// Le promesse e gli osservatori consegnano a fine giro; il tempo è fermo,
/// quindi qui si aspettano i giri e non un timer.
async function settled(): Promise<void> {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
}

/// Il chip com'è scritto in `index.html`.
function markup(): void {
  document.body.innerHTML = `
    <button id="vault-chip" type="button" aria-haspopup="menu" aria-expanded="false">
      <span id="vault-path"></span>
      <span id="vault-chip-none" hidden>Apri vault…</span>
    </button>`;
  chip().getBoundingClientRect = () => ({ left: 40, top: 6, right: 180, bottom: 30, width: 140, height: 24 }) as DOMRect;
}

const chip = (): HTMLButtonElement => document.getElementById("vault-chip") as HTMLButtonElement;
const name = (): HTMLElement => document.getElementById("vault-path")!;
const none = (): HTMLElement => document.getElementById("vault-chip-none")!;

/// Il menu aperto adesso: uno che sta uscendo non conta.
function menu(): HTMLElement | null {
  const shown = document.getElementById("context-menu");
  return shown && shown.dataset.shellMotion !== "exit" ? shown : null;
}

/// Le voci del menu come le legge chi lo guarda.
function entries(): { role: string | null; label: string; description: string; checked: string | null }[] {
  return [...menu()!.querySelectorAll("button")].map((item) => ({
    role: item.getAttribute("role"),
    label: item.querySelector(".menu-label")?.textContent ?? "",
    description: item.querySelector(".menu-description")?.textContent ?? "",
    checked: item.getAttribute("aria-checked"),
  }));
}

function choose(label: string): void {
  const item = [...menu()!.querySelectorAll("button")].find(
    (candidate) => candidate.querySelector(".menu-label")?.textContent === label,
  );
  if (!item) throw new Error(`nessuna voce «${label}»`);
  item.click();
}

/// Apre il vault, scrive il suo nome come fa la shell comune, e preme il chip.
async function openChipMenu(): Promise<void> {
  chip().click();
  await settled();
}

let lifetime: Lifetime;

beforeEach(() => {
  vi.useFakeTimers();
  world.commands = [command(OPEN)];
  world.started.length = 0;
  world.language = "it";
  world.knownVaults = () => Promise.resolve([]);
  world.asked = 0;
  world.openVault = () => Promise.resolve();
  world.opened.length = 0;
  world.notices.length = 0;
  state.vaultRoot = "";
  markup();
  lifetime = openLifetime();
});

afterEach(() => {
  lifetime.close();
  closeContextMenu();
  vi.runAllTimers();
  vi.useRealTimers();
  expect(world.languageListeners.size).toBe(0);
  state.vaultRoot = "";
  document.body.replaceChildren();
});

describe("listedVaults", () => {
  it("mette i preferiti in testa, e dentro ogni gruppo i più recenti", () => {
    const known = [
      vault("/vecchio", { last_opened: 1 }),
      vault("/preferito-vecchio", { favorite: true, last_opened: 2 }),
      vault("/recente", { last_opened: 9 }),
      vault("/preferito-recente", { favorite: true, last_opened: 5 }),
    ];
    expect(listedVaults(known).map((entry) => entry.root)).toEqual([
      "/preferito-recente",
      "/preferito-vecchio",
      "/recente",
      "/vecchio",
    ]);
  });

  it("ne propone al più otto, e sono i primi di quell'ordine", () => {
    const known = Array.from({ length: 12 }, (_, index) => vault(`/v${index}`, { last_opened: index }));
    known[0] = vault("/v0", { favorite: true, last_opened: 0 });
    const listed = listedVaults(known).map((entry) => entry.root);
    expect(listed).toEqual(["/v0", "/v11", "/v10", "/v9", "/v8", "/v7", "/v6", "/v5"]);
  });

  it("non riordina l'elenco che riceve", () => {
    const known = [vault("/a", { last_opened: 1 }), vault("/b", { last_opened: 2 })];
    listedVaults(known);
    expect(known.map((entry) => entry.root)).toEqual(["/a", "/b"]);
  });
});

describe("il nome del chip", () => {
  it("senza un vault invita ad aprirne uno", () => {
    mountVaultChip(lifetime);
    expect(chip().hasAttribute("data-empty")).toBe(true);
    expect(none().hidden).toBe(false);
    expect(chip().getAttribute("aria-label")).toBe("frame.vault_chip");
  });

  it("montato con un nome già scritto lo porta nel nome accessibile", () => {
    name().textContent = "  Appunti  ";
    mountVaultChip(lifetime);
    expect(chip().hasAttribute("data-empty")).toBe(false);
    expect(none().hidden).toBe(true);
    expect(chip().getAttribute("aria-label")).toBe('frame.vault_chip.named {"name":"Appunti"}');
  });

  it("segue il nome che la shell comune scrive in `#vault-path`", async () => {
    mountVaultChip(lifetime);
    name().textContent = "Appunti";
    await settled();
    expect(chip().hasAttribute("data-empty")).toBe(false);
    expect(none().hidden).toBe(true);
    expect(chip().getAttribute("aria-label")).toBe('frame.vault_chip.named {"name":"Appunti"}');

    name().textContent = "";
    await settled();
    expect(chip().hasAttribute("data-empty")).toBe(true);
    expect(none().hidden).toBe(false);
    expect(chip().getAttribute("aria-label")).toBe("frame.vault_chip");
  });

  it("si rinomina quando cambia la lingua", () => {
    mountVaultChip(lifetime);
    changeLanguage("en");
    expect(chip().getAttribute("aria-label")).toBe("frame.vault_chip (en)");
  });

  it("senza `#vault-chip-none` il nome e lo stato vuoto restano", () => {
    none().remove();
    expect(() => mountVaultChip(lifetime)).not.toThrow();
    expect(chip().hasAttribute("data-empty")).toBe(true);
    expect(chip().getAttribute("aria-label")).toBe("frame.vault_chip");
  });
});

describe("il chip premuto senza un vault", () => {
  it("apre una cartella, senza menu e senza chiedere l'elenco", async () => {
    mountVaultChip(lifetime);
    await openChipMenu();
    expect(world.started).toEqual([OPEN]);
    expect(world.asked).toBe(0);
    expect(menu()).toBeNull();
    expect(chip().getAttribute("aria-expanded")).toBe("false");
  });

  it("se il comando non c'è non succede niente", async () => {
    world.commands = [];
    mountVaultChip(lifetime);
    await openChipMenu();
    expect(world.started).toEqual([]);
    expect(menu()).toBeNull();
  });
});

describe("il chip premuto con un vault aperto", () => {
  beforeEach(() => {
    state.vaultRoot = "/home/io/Appunti";
    name().textContent = "Appunti";
    world.knownVaults = () =>
      Promise.resolve([
        vault("/home/io/Appunti", { last_opened: 3 }),
        vault("/home/io/Lavoro", { name: "Ufficio", icon: "💼", favorite: true, last_opened: 1 }),
        vault("C:\\Users\\io\\Diario", { last_opened: 2 }),
      ]);
  });

  it("propone i vault conosciuti e, in fondo, l'apertura di una cartella", async () => {
    mountVaultChip(lifetime);
    await openChipMenu();
    expect(world.asked).toBe(1);
    expect(entries()).toEqual([
      // Il preferito in testa, con la sua icona e il nome che gli è stato dato.
      { role: "menuitemradio", label: "💼 Ufficio", description: "/home/io/Lavoro", checked: "false" },
      // Senza nome vale quello della cartella; quello aperto è il segnato.
      { role: "menuitemradio", label: "Appunti", description: "/home/io/Appunti", checked: "true" },
      // Anche per un path scritto alla maniera di Windows.
      { role: "menuitemradio", label: "Diario", description: "C:\\Users\\io\\Diario", checked: "false" },
      { role: "menuitem", label: "app.open_vault", description: "", checked: null },
    ]);
    // Una riga separa i vault dal gesto che ne apre un altro.
    const separator = menu()!.querySelector('[role="separator"]')!;
    expect(separator.nextElementSibling).toBe(menu()!.querySelector('[role="menuitem"]'));
  });

  it("si dichiara aperto, e il menu è il suo: legato al chip, sotto di lui, col fuoco sul vault aperto", async () => {
    mountVaultChip(lifetime);
    await openChipMenu();
    expect(chip().getAttribute("aria-expanded")).toBe("true");
    expect(menu()!.getAttribute("aria-labelledby")).toBe("vault-chip");
    expect(menu()!.style.left).toBe("40px");
    expect(menu()!.style.top).toBe("34px");
    expect(document.activeElement?.querySelector(".menu-label")?.textContent).toBe("Appunti");
  });

  it("un altro vault scelto si apre, e il chip torna chiuso", async () => {
    mountVaultChip(lifetime);
    await openChipMenu();
    choose("💼 Ufficio");
    expect(world.opened).toEqual(["/home/io/Lavoro"]);
    expect(chip().getAttribute("aria-expanded")).toBe("false");
    expect(menu()).toBeNull();
  });

  it("scegliere quello già aperto non riapre niente", async () => {
    mountVaultChip(lifetime);
    await openChipMenu();
    choose("Appunti");
    expect(world.opened).toEqual([]);
    expect(chip().getAttribute("aria-expanded")).toBe("false");
  });

  it("un vault che non si apre lo dice, come guasto", async () => {
    world.openVault = () => Promise.reject(new Error("cartella sparita"));
    mountVaultChip(lifetime);
    await openChipMenu();
    choose("Diario");
    await settled();
    expect(world.opened).toEqual(["C:\\Users\\io\\Diario"]);
    expect(world.notices).toEqual([{ text: "cartella sparita", tone: "guasto" }]);
  });

  it("l'ultima voce apre una cartella", async () => {
    mountVaultChip(lifetime);
    await openChipMenu();
    choose("app.open_vault");
    expect(world.started).toEqual([OPEN]);
    expect(world.opened).toEqual([]);
    expect(chip().getAttribute("aria-expanded")).toBe("false");
  });

  it("Escape lo richiude, e il chip lo sa", async () => {
    mountVaultChip(lifetime);
    await openChipMenu();
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(menu()).toBeNull();
    expect(chip().getAttribute("aria-expanded")).toBe("false");
    expect(world.opened).toEqual([]);
    expect(world.started).toEqual([]);
  });

  it("se il registro non risponde resta la sola voce che apre una cartella", async () => {
    world.knownVaults = () => Promise.reject(new Error("registro illeggibile"));
    mountVaultChip(lifetime);
    await openChipMenu();
    expect(entries()).toEqual([{ role: "menuitem", label: "app.open_vault", description: "", checked: null }]);
    expect(menu()!.querySelector('[role="separator"]')).toBeNull();
    expect(chip().getAttribute("aria-expanded")).toBe("true");
    expect(world.notices).toEqual([]);
    choose("app.open_vault");
    expect(world.started).toEqual([OPEN]);
  });

  it("un registro vuoto dà lo stesso menu di una voce sola", async () => {
    world.knownVaults = () => Promise.resolve([]);
    mountVaultChip(lifetime);
    await openChipMenu();
    expect(entries().map((entry) => entry.label)).toEqual(["app.open_vault"]);
    expect(menu()!.querySelector('[role="separator"]')).toBeNull();
  });

  it("rilegge il registro a ogni apertura", async () => {
    mountVaultChip(lifetime);
    await openChipMenu();
    closeContextMenu();
    world.knownVaults = () => Promise.resolve([vault("/home/io/Nuovo", { last_opened: 9 })]);
    await openChipMenu();
    expect(world.asked).toBe(2);
    expect(entries().map((entry) => entry.label)).toEqual(["Nuovo", "app.open_vault"]);
  });

  it("il clic resta suo: non arriva a chi ascolta il documento", async () => {
    const witness = openLifetime();
    const outside = vi.fn();
    witness.listen(document, "click", outside);
    mountVaultChip(lifetime);
    await openChipMenu();
    witness.close();
    expect(outside).not.toHaveBeenCalled();
  });

  // DIFETTO (vault-chip.ts:72-76). `aria-expanded="true"` è scritto prima di
  // `showContextMenu`, che per prima cosa chiude il menu precedente e ne chiama
  // `onClose`: quello riscrive `"false"`. Un secondo clic a menu aperto lascia
  // quindi un menu aperto dichiarato chiuso. `ui/app-menu.ts` si protegge con
  // una generazione nel suo `onClose`; qui non c'è. La prova chiede solo che
  // ciò che il chip dichiara sia ciò che si vede: vale sia che il secondo clic
  // riapra il menu, sia che lo chiuda.
  it("premuto di nuovo a menu aperto, dichiara ancora ciò che si vede", async () => {
    mountVaultChip(lifetime);
    await openChipMenu();
    // Il menu ha già il suo ascolto sul documento: il secondo clic non lo
    // raggiunge, perché il chip lo ferma.
    vi.advanceTimersByTime(0);
    await openChipMenu();
    expect(chip().getAttribute("aria-expanded")).toBe(String(menu() !== null));
  });
});

describe("il chip smontato", () => {
  it("non apre più niente e non segue più il nome", async () => {
    state.vaultRoot = "/home/io/Appunti";
    mountVaultChip(lifetime);
    lifetime.close();

    await openChipMenu();
    expect(world.asked).toBe(0);
    expect(menu()).toBeNull();
    expect(chip().getAttribute("aria-expanded")).toBe("false");

    name().textContent = "Appunti";
    changeLanguage("en");
    await settled();
    expect(chip().hasAttribute("data-empty")).toBe(true);
    expect(chip().getAttribute("aria-label")).toBe("frame.vault_chip");
  });

  it("smontato mentre l'elenco è in viaggio, il menu non si apre", async () => {
    state.vaultRoot = "/home/io/Appunti";
    let arrive: (known: KnownVault[]) => void = () => {};
    world.knownVaults = () => new Promise<unknown[]>((resolve) => (arrive = resolve));
    mountVaultChip(lifetime);
    chip().click();
    await settled();
    expect(world.asked).toBe(1);

    lifetime.close();
    arrive([vault("/home/io/Lavoro")]);
    await settled();
    expect(menu()).toBeNull();
    expect(chip().getAttribute("aria-expanded")).toBe("false");
  });

  it("senza il chip o senza il suo nome non monta niente", async () => {
    name().remove();
    state.vaultRoot = "/home/io/Appunti";
    mountVaultChip(lifetime);
    expect(chip().hasAttribute("aria-label")).toBe(false);
    await openChipMenu();
    expect(world.asked).toBe(0);
    expect(world.languageListeners.size).toBe(0);
  });
});
