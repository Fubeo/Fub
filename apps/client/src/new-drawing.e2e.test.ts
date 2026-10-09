// @vitest-environment happy-dom
//
// **Le porte di «Nuovo disegno…»**, sulla shell vera (`index.html` con `main.ts`)
// e l'host finto: il menu File, il contestuale di una cartella e quello del
// titolo dell'albero, e il riquadro vuoto. La porta della shell mobile ha il suo
// banco (`shells/mobile/creation.test.ts`).
//
// Ogni porta si prova due volte, **visibile e nascosta**: il kernel dichiara
// `drawing.create` (la feature `draw` è accesa) o non lo dichiara, e una voce
// che non può riuscire non deve esserci. Poi si prova che cosa fa la porta: apre
// il modulo proprio del comando, con la cartella da cui parte, e se nessuno ne
// ha registrato uno ripiega sulla palette dello stesso comando.
//
// Come in `shell.e2e.test.ts` ciò che resta finto è il di là del confine, e in
// `happy-dom` non c'è né CSS né misura: si asserisce su *cosa* c'è. Nemmeno la
// rete c'è: la galleria vera chiede i caratteri dell'app con un indirizzo
// relativo, che sotto `happy-dom` sarebbe una connessione a `localhost:3000`, e
// il banco lo ferma e lo conta (`fetched`).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandSpec } from "./host/contract";
import type { FakeHost } from "./host/fake";

vi.setConfig({ testTimeout: 20_000 });

const box = vi.hoisted(() => ({ host: null as FakeHost | null }));

let activeStop: (() => void) | null = null;

vi.mock("./host/ipc", () => {
  const now = () => {
    if (!box.host) throw new Error("l'host finto non è stato montato");
    return box.host.module;
  };
  return {
    api: new Proxy(
      {},
      {
        get: (_t, name: string) => (...args: unknown[]) =>
          (now().api as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args),
      },
    ),
    onKernelEvent: (handler: (n: unknown) => void) => now().onKernelEvent(handler as never),
    onClose: (first: () => Promise<boolean>, onFailure: (reason: unknown) => void) => now().onClose(first, onFailure),
    window: {
      minimize: async () => {},
      toggleMaximize: async () => {},
      close: async () => {},
      isMaximized: async () => false,
      setTitle: async () => {},
      onResize: async () => async () => {},
    },
  };
});

vi.mock("./host/dialog", () => ({
  confirm: () => Promise.resolve(true),
  pickFolder: () => Promise.resolve("/vault"),
  pickFile: () => Promise.resolve(null),
}));

const { createFakeHost, drawingCreateSpec } = await import("./host/fake");
const rawHtml = (await import("../index.html?raw")).default;

function mountShell(): void {
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(rawHtml);
  if (!body) throw new Error("index.html non ha un body");
  document.body.innerHTML = body[1].replace(/<script[\s\S]*?<\/script>/g, "");
}

/// Monta la shell su un vault finto con questi comandi del kernel, e aspetta
/// che l'avvio sia finito.
async function start(file: Record<string, string>, commands: CommandSpec[]): Promise<FakeHost> {
  vi.resetModules();
  const host = createFakeHost({
    file,
    commands,
    // La feature `draw` accesa porta i due insieme: il comando e i `.svg`.
    draw: commands.some((command) => command.id === "drawing.create"),
  });
  box.host = host;
  mountShell();
  const main = await import("./main");
  const stop = await main.startup;
  activeStop = stop;
  await settle();
  return host;
}

async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

async function waitFor(thing: string, cond: () => boolean, within = 2000): Promise<void> {
  const deadline = Date.now() + within;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`non è mai successo: ${thing}`);
}

const labelOf = (b: Element): string => b.querySelector(".menu-label")?.textContent ?? b.textContent ?? "";

/// Le voci del menu aperto, nell'ordine in cui si vedono.
function menuLabels(): string[] {
  const menu = document.getElementById("context-menu");
  if (!menu) throw new Error("il menu non si è aperto");
  return [...menu.querySelectorAll("button")].map(labelOf);
}

/// Apre il contestuale di `on` e dice che voci ha.
function openContextMenu(on: HTMLElement): string[] {
  on.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  return menuLabels();
}

/// Sceglie la voce di quel nome nel menu già aperto.
async function choose(entry: string): Promise<void> {
  const menu = document.getElementById("context-menu");
  const selected = [...(menu?.querySelectorAll("button") ?? [])].find((b) => labelOf(b) === entry);
  if (!selected) throw new Error(`nel menu non c'è «${entry}», ci sono: ${menuLabels()}`);
  (selected as HTMLElement).click();
  await settle();
}

/// Registra un modulo proprio per `drawing.create` sul registro vivo della shell.
async function registerForm(): Promise<Record<string, string>[]> {
  const { registerCommandForm } = await import("./ui/commands");
  const opened: Record<string, string>[] = [];
  registerCommandForm("drawing.create", (prefill) => opened.push({ ...prefill }));
  return opened;
}

const VAULT = {
  "Benvenuto.md": "Il primo documento di questo vault.\n",
  "note/Riunione.md": "Appunti della riunione di martedì.\n",
};

const folderRow = (path: string): HTMLElement =>
  document.querySelector<HTMLElement>(`#file-list li[data-path="${path}"] > .tree-row`)!;

/// I gesti dello stato vuoto del riquadro, col loro testo.
const emptyPaneGestures = (): string[] =>
  [...document.querySelectorAll<HTMLElement>(".pane-empty-actions button")].map((b) => b.textContent ?? "");

/// Gli indirizzi che il codice ha chiesto con `fetch` nel test che gira.
const fetched: string[] = [];
const realFetch = globalThis.fetch;

beforeAll(() => {
  // Per tutto il file, non per un test: le anteprime della galleria leggono i
  // caratteri uno dopo l'altro anche quando il test è già finito, e non devono
  // trovare, a metà, il `fetch` vero. Un file che non si legge è un file che
  // manca: le anteprime restano senza quei caratteri, che qui non servono.
  globalThis.fetch = ((input: RequestInfo | URL) => {
    fetched.push(String(input));
    return Promise.resolve({ ok: false } as Response);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  activeStop?.();
  activeStop = null;
  document.body.innerHTML = "";
  localStorage.clear();
  fetched.length = 0;
});

describe("il menu File", () => {
  it("offre «Nuovo disegno…» dopo «Nuova nota» se il kernel ha il comando, e apre il modulo proprio", async () => {
    await start(VAULT, [drawingCreateSpec()]);
    const opened = await registerForm();
    document.querySelector<HTMLButtonElement>("#app-menu-0")!.click();
    const labels = menuLabels();
    expect(labels.indexOf("Nuovo disegno…")).toBe(labels.indexOf("Nuova nota") + 1);
    await choose("Nuovo disegno…");
    expect(opened).toEqual([{}]);
  });

  it("non lo offre se il kernel non dichiara il comando", async () => {
    await start(VAULT, []);
    document.querySelector<HTMLButtonElement>("#app-menu-0")!.click();
    expect(menuLabels()).not.toContain("Nuovo disegno…");
    expect(menuLabels()).toContain("Nuova nota");
  });
});

describe("il contestuale di una cartella", () => {
  it("offre «Nuovo disegno qui…» fra la nota e la cartella, e passa la cartella al modulo", async () => {
    await start(VAULT, [drawingCreateSpec()]);
    const opened = await registerForm();
    const labels = openContextMenu(folderRow("note"));
    expect(labels.indexOf("Nuovo disegno qui…")).toBe(labels.indexOf("Nuova nota qui") + 1);
    expect(labels.indexOf("Nuova cartella")).toBe(labels.indexOf("Nuovo disegno qui…") + 1);
    await choose("Nuovo disegno qui…");
    expect(opened).toEqual([{ folder: "note" }]);
  });

  it("non lo offre senza il comando", async () => {
    await start(VAULT, []);
    const labels = openContextMenu(folderRow("note"));
    expect(labels).toContain("Nuova nota qui");
    expect(labels).not.toContain("Nuovo disegno qui…");
  });

  it("senza un modulo registrato apre la palette sullo stesso comando, con la cartella nel campo, e confermarla crea il disegno lì", async () => {
    // happy-dom non mette `Option` fra i globali, e il modulo generico lo usa
    // per le scelte.
    vi.stubGlobal("Option", function (text: string, value: string) {
      const option = document.createElement("option");
      option.textContent = text;
      option.value = value;
      return option;
    });
    const host = await start(VAULT, [drawingCreateSpec()]);
    // L'avvio registra la galleria per `drawing.create`: per provare davvero il
    // ripiego la si toglie, come fa un banco che monta la shell senza.
    const { hasCommandForm, resetCommandForms } = await import("./ui/commands");
    expect(hasCommandForm("drawing.create")).toBe(true);
    resetCommandForms();
    expect(hasCommandForm("drawing.create")).toBe(false);
    openContextMenu(folderRow("note"));
    await choose("Nuovo disegno qui…");
    await waitFor("la palette si apre sul modulo del comando", () => document.getElementById("command-palette") !== null);
    expect(document.querySelector(".draw-new")).toBeNull();
    const overlay = document.getElementById("command-palette")!;
    const fields = [...overlay.querySelectorAll<HTMLInputElement | HTMLSelectElement>("form input, form select")];
    const folder = fields.find((field) => field.closest("label")?.querySelector(".palette-label")?.textContent === "Cartella");
    expect(folder?.value).toBe("note");
    // La porta ha solo aperto il modulo: il disegno nasce quando lo si conferma.
    expect(host.atGate("invokeCommand").filter((call) => call.args[0] === "drawing.create")).toHaveLength(0);
    expect(Object.keys(host.files())).not.toContain("note/Disegno.svg");

    overlay.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await waitFor("il disegno nasce nella cartella", () => "note/Disegno.svg" in host.files());
    expect(host.files()["note/Disegno.svg"]).toContain("<svg");
    expect(fetched).toEqual([]);
  });

  it("con la galleria registrata all'avvio apre la galleria, con la cartella nel campo, e confermarla crea il disegno lì", async () => {
    const host = await start(VAULT, [drawingCreateSpec()]);
    const { hasCommandForm } = await import("./ui/commands");
    expect(hasCommandForm("drawing.create")).toBe(true);
    openContextMenu(folderRow("note"));
    await choose("Nuovo disegno qui…");
    // Il codice della galleria si carica tardi, con un `import()`.
    await waitFor("la galleria si apre", () => document.querySelector(".draw-new") !== null);
    // Il suo posto non lo prende la palette.
    expect(document.getElementById("command-palette")).toBeNull();
    const dialog = document.querySelector<HTMLElement>(".draw-new")!;
    // La finestra è modale e ha un nome: quello del suo titolo.
    const overlay = document.querySelector<HTMLElement>(".draw-new-overlay")!;
    expect(overlay.getAttribute("role")).toBe("dialog");
    expect(overlay.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(overlay.getAttribute("aria-labelledby") ?? "")?.textContent).toBe("Nuovo disegno");
    const field = (label: string): HTMLInputElement | undefined =>
      [...dialog.querySelectorAll<HTMLLabelElement>("label.draw-new-field")]
        .find((candidate) => candidate.querySelector(".palette-label")?.textContent === label)
        ?.querySelector("input") ?? undefined;
    expect(field("Cartella")?.value).toBe("note");
    expect(field("Nome")?.value).toBe("");
    // «Vuoto» è la scelta della prima volta.
    await waitFor("la scelta di partenza", () => dialog.querySelector<HTMLInputElement>('input[type="radio"]:checked') !== null);
    expect(dialog.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.closest("label")?.getAttribute("data-template")).toBe("blank");
    // Le anteprime arrivano dai file dei modelli, uno per scheda, e per
    // metterci i caratteri dell'app chiedono i loro file: il banco li ferma.
    await waitFor("le sette anteprime", () => dialog.querySelectorAll("img.draw-new-image[src]").length === 7);
    expect(fetched.length).toBeGreaterThan(0);
    expect(fetched.every((url) => url.startsWith("/fonts/"))).toBe(true);
    // La porta ha solo aperto la galleria: il disegno nasce quando lo si conferma.
    expect(host.atGate("invokeCommand").filter((call) => call.args[0] === "drawing.create")).toHaveLength(0);
    expect(Object.keys(host.files())).not.toContain("note/Disegno.svg");

    dialog.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await waitFor("il disegno nasce nella cartella", () => "note/Disegno.svg" in host.files());
    expect(host.files()["note/Disegno.svg"]).toContain("<svg");
    // Creato, la galleria si chiude e non lascia la sua finestra.
    await waitFor("la galleria si chiude", () => document.querySelector(".draw-new") === null);
  });
});

describe("il contestuale del titolo dell'albero", () => {
  const title = (): HTMLElement => document.querySelector<HTMLElement>("#files-title")!;

  it("offre «Nuovo disegno qui…» prima della cartella: nella radice senza cartella, in uno spazio con la sua", async () => {
    await start(VAULT, [drawingCreateSpec()]);
    const opened = await registerForm();
    const labels = openContextMenu(title());
    expect(labels).toEqual(["Nuovo disegno qui…", "Nuova cartella"]);
    await choose("Nuovo disegno qui…");
    expect(opened).toEqual([{}]);

    const { state } = await import("./state/store");
    state.activeSpace = "note";
    openContextMenu(title());
    await choose("Nuovo disegno qui…");
    expect(opened).toEqual([{}, { folder: "note" }]);
  });

  it("senza il comando ha soltanto la cartella", async () => {
    await start(VAULT, []);
    expect(openContextMenu(title())).toEqual(["Nuova cartella"]);
  });
});

describe("il riquadro vuoto", () => {
  it("offre «Nuovo disegno…» fra la nota nuova e l'apertura, e apre il modulo proprio", async () => {
    await start({}, [drawingCreateSpec()]);
    const opened = await registerForm();
    await waitFor("il riquadro vuoto si disegna", () => emptyPaneGestures().length > 0);
    const gestures = emptyPaneGestures();
    expect(gestures).toHaveLength(3);
    expect(gestures[0]).toMatch(/^Nuova nota/);
    expect(gestures[1]).toBe("Nuovo disegno…");
    expect(gestures[2]).toMatch(/^Apri una nota/);
    document.querySelectorAll<HTMLElement>(".pane-empty-actions button")[1]!.click();
    expect(opened).toEqual([{}]);
  });

  it("senza il comando offre i due gesti di sempre", async () => {
    await start({}, []);
    await waitFor("il riquadro vuoto si disegna", () => emptyPaneGestures().length > 0);
    const gestures = emptyPaneGestures();
    expect(gestures).toHaveLength(2);
    expect(gestures.join("|")).not.toContain("disegno");
  });

  it("segue l'elenco dei comandi: arriva dopo e la porta compare, se ne va e sparisce", async () => {
    await start({}, []);
    await waitFor("il riquadro vuoto si disegna", () => emptyPaneGestures().length > 0);
    expect(emptyPaneGestures()).toHaveLength(2);
    const { setCommandSpecs } = await import("./state/store");
    setCommandSpecs([drawingCreateSpec()]);
    expect(emptyPaneGestures()).toHaveLength(3);
    setCommandSpecs([]);
    expect(emptyPaneGestures()).toHaveLength(2);
  });

  it("un elenco uguale non ridisegna i bottoni: chi ha il fuoco su uno lo tiene", async () => {
    await start({}, [drawingCreateSpec()]);
    await waitFor("il riquadro vuoto si disegna", () => emptyPaneGestures().length === 3);
    const buttons = [...document.querySelectorAll<HTMLElement>(".pane-empty-actions button")];
    buttons[1]!.focus();
    const { setCommandSpecs, state } = await import("./state/store");
    setCommandSpecs([...state.commandSpecs]);
    const after = [...document.querySelectorAll<HTMLElement>(".pane-empty-actions button")];
    expect(after[1]).toBe(buttons[1]);
    expect(document.activeElement).toBe(buttons[1]);
  });
});

describe("l'albero vuoto", () => {
  /// I gesti del vault senza note, nell'albero: la frase e i suoi bottoni.
  const treeGestures = (): string[] =>
    [...document.querySelectorAll<HTMLElement>("#file-list .tree-empty button")].map((b) => b.textContent ?? "");

  it("offre «Nuovo disegno…» dopo «Nuova nota», e apre il modulo proprio dalla radice", async () => {
    await start({}, [drawingCreateSpec()]);
    const opened = await registerForm();
    await waitFor("l'albero vuoto si disegna", () => treeGestures().length > 0);
    expect(treeGestures()).toEqual(["Nuova nota", "Nuovo disegno…"]);
    document.querySelectorAll<HTMLElement>("#file-list .tree-empty button")[1]!.click();
    expect(opened).toEqual([{}]);
  });

  it("senza il comando ha il solo gesto di sempre", async () => {
    await start({}, []);
    await waitFor("l'albero vuoto si disegna", () => treeGestures().length > 0);
    expect(treeGestures()).toEqual(["Nuova nota"]);
  });

  it("segue l'elenco dei comandi: arriva dopo e la porta compare, se ne va e sparisce", async () => {
    await start({}, []);
    await waitFor("l'albero vuoto si disegna", () => treeGestures().length > 0);
    expect(treeGestures()).toEqual(["Nuova nota"]);
    const { setCommandSpecs } = await import("./state/store");
    setCommandSpecs([drawingCreateSpec()]);
    expect(treeGestures()).toEqual(["Nuova nota", "Nuovo disegno…"]);
    setCommandSpecs([]);
    expect(treeGestures()).toEqual(["Nuova nota"]);
  });
});
