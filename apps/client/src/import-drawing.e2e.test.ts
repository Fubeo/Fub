// @vitest-environment happy-dom
//
// **Le porte di «Importa disegno…»**, sulla shell vera (`index.html` con
// `main.ts`) e l'host finto: il menu File, la palette, il contestuale di una
// cartella e quello del titolo dell'albero, il contestuale di un file e il clic
// su un file che Fub non mostra ma sa importare. La finestra ha il suo banco
// (`editors/spatial/import/dialog.test.ts`); qui si prova che ogni porta la
// apre col file e la cartella giusti, che senza la feature `draw` non c'è
// nessuna porta, e che «Importa» scrive il disegno accanto e lo apre.
//
// Come in `new-drawing.e2e.test.ts` ciò che resta finto è il di là del confine,
// e la rete non c'è: l'anteprima chiede i caratteri dell'app, e il banco
// risponde che non ci sono. La scelta di un file dal disco è un `<input>` che
// il browser apre al clic: il banco prende il clic, e mette il file al posto
// dell'utente.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

async function waitFor(thing: string, cond: () => boolean, within = 4000): Promise<void> {
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

/// Un diagramma di draw.io con due forme, che entrano com'erano.
const DRAWIO = [
  '<mxfile host="app.diagrams.net"><diagram name="Pagina" id="p"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>',
  '<mxCell id="a" value="Server" style="rounded=0;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="120" height="60" as="geometry"/></mxCell>',
  '<mxCell id="b" value="" style="ellipse;" vertex="1" parent="1"><mxGeometry x="200" y="0" width="60" height="60" as="geometry"/></mxCell>',
  "</root></mxGraphModel></diagram></mxfile>",
].join("");

const VAULT = {
  "Benvenuto.md": "Il primo documento di questo vault.\n",
  "note/Riunione.md": "Appunti della riunione di martedì.\n",
  "rete.drawio": DRAWIO,
};

const folderRow = (path: string): HTMLElement =>
  document.querySelector<HTMLElement>(`#file-list li[data-path="${path}"] > .tree-row`)!;
const title = (): HTMLElement => document.querySelector<HTMLElement>("#files-title")!;

const importDialog = (): HTMLElement | null => document.querySelector<HTMLElement>(".draw-import-form");
const fieldInputs = (): HTMLInputElement[] => [...document.querySelectorAll<HTMLInputElement>(".draw-import-field input")];
const importButton = (): HTMLButtonElement | null =>
  importDialog()?.querySelector<HTMLButtonElement>('button[type="submit"]') ?? null;

/// Aspetta che la finestra abbia preparato il disegno.
async function importReady(): Promise<void> {
  await waitFor("la finestra di «Importa disegno» si apre", () => importDialog() !== null);
  await waitFor("il disegno è pronto", () => importButton()?.disabled === false);
}

/// Prende la scelta del file dal disco: ogni `<input type=file>` cliccato
/// finisce qui, invece che nella finestra del sistema.
function catchPicker(): HTMLInputElement[] {
  const picked: HTMLInputElement[] = [];
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
    if (this.type === "file") picked.push(this);
  });
  return picked;
}

/// Mette `file` nella scelta aperta, come farebbe l'utente.
function pick(input: HTMLInputElement, file: File): void {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
}

/// Gli indirizzi che il codice ha chiesto con `fetch` nel test che gira.
const fetched: string[] = [];
const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = ((input: RequestInfo | URL) => {
    fetched.push(String(input));
    return Promise.resolve({ ok: false } as Response);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  vi.restoreAllMocks();
  activeStop?.();
  activeStop = null;
  document.body.innerHTML = "";
  localStorage.clear();
  fetched.length = 0;
});

describe("il menu File e la palette", () => {
  it("offrono «Importa disegno…» dopo «Nuovo disegno…»; il file scelto dal disco diventa un disegno nella radice, che si apre", async () => {
    const host = await start(VAULT, [drawingCreateSpec()]);
    const picked = catchPicker();
    document.querySelector<HTMLButtonElement>("#app-menu-0")!.click();
    const labels = menuLabels();
    expect(labels.indexOf("Importa disegno…")).toBe(labels.indexOf("Nuovo disegno…") + 1);
    await choose("Importa disegno…");
    // La scelta si apre nel gesto, e chiede i file dei due programmi.
    expect(picked).toHaveLength(1);
    expect(picked[0]!.accept).toContain(".drawio");
    expect(picked[0]!.accept).toContain(".excalidraw");
    // Niente finestra finché il file non c'è: chi chiude la scelta non trova niente aperto.
    expect(importDialog()).toBeNull();

    pick(picked[0]!, new File([DRAWIO], "schema.drawio"));
    await importReady();
    expect(fieldInputs().map((input) => input.value)).toEqual(["schema", ""]);
    expect(document.querySelector(".draw-import-from")?.textContent).toBe("Da «schema.drawio», un disegno di draw.io.");

    importDialog()!.dispatchEvent(new Event("submit", { cancelable: true }));
    await waitFor("il disegno nasce nella radice", () => "schema.svg" in host.files());
    expect(host.files()["schema.svg"]).toContain("<svg");
    await waitFor("la finestra si chiude", () => importDialog() === null);
    const { state } = await import("./state/store");
    await waitFor("il disegno si apre", () => state.currentDoc === "schema.svg");
    const { recentNotices } = await import("./ui/notify");
    expect(recentNotices().map((notice) => notice.text)).toContain("Disegno importato in «schema.svg».");
    // L'originale del vault non c'entra, e non cambia.
    expect(host.files()["rete.drawio"]).toBe(DRAWIO);
  });

  it("la palette ha «Importa disegno», che sceglie dal disco", async () => {
    await start(VAULT, [drawingCreateSpec()]);
    const picked = catchPicker();
    const { allCommands } = await import("./ui/commands");
    const entry = allCommands().find((command) => command.id === "shell.draw.import");
    expect(entry?.title).toBe("Importa disegno");
    expect(entry?.binding).toBeNull();
    entry!.run!();
    expect(picked).toHaveLength(1);
  });

  it("senza il comando dei disegni non c'è né la voce né il comando", async () => {
    await start(VAULT, []);
    document.querySelector<HTMLButtonElement>("#app-menu-0")!.click();
    expect(menuLabels()).not.toContain("Importa disegno…");
    expect(menuLabels()).toContain("Nuova nota");
    const { allCommands } = await import("./ui/commands");
    expect(allCommands().map((command) => command.id)).not.toContain("shell.draw.import");
  });
});

describe("i contestuali dell'albero", () => {
  it("«Importa un disegno qui…» di una cartella sceglie dal disco e fa nascere il disegno in quella cartella", async () => {
    const host = await start(VAULT, [drawingCreateSpec()]);
    const picked = catchPicker();
    openContextMenu(folderRow("note"));
    await choose("Importa un disegno qui…");
    pick(picked[0]!, new File([DRAWIO], "flusso.drawio.xml"));
    await importReady();
    expect(fieldInputs().map((input) => input.value)).toEqual(["flusso", "note"]);
    importDialog()!.dispatchEvent(new Event("submit", { cancelable: true }));
    await waitFor("il disegno nasce nella cartella", () => "note/flusso.svg" in host.files());
  });

  it("quello del titolo sceglie dal disco: nella radice senza spazio, nello spazio se c'è", async () => {
    await start(VAULT, [drawingCreateSpec()]);
    const picked = catchPicker();
    openContextMenu(title());
    await choose("Importa un disegno qui…");
    pick(picked[0]!, new File([DRAWIO], "a.drawio"));
    await importReady();
    expect(fieldInputs()[1]!.value).toBe("");
    document.querySelector<HTMLElement>(".draw-import-form")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await waitFor("la finestra si chiude", () => importDialog() === null);

    const { state } = await import("./state/store");
    state.activeSpace = "note";
    openContextMenu(title());
    await choose("Importa un disegno qui…");
    pick(picked[1]!, new File([DRAWIO], "b.drawio"));
    await importReady();
    expect(fieldInputs()[1]!.value).toBe("note");
  });

  it("un file che si importa offre per primo «Importa in un disegno…», e il disegno nasce accanto", async () => {
    const host = await start(VAULT, [drawingCreateSpec()]);
    expect(openContextMenu(folderRow("rete.drawio"))[0]).toBe("Importa in un disegno…");
    await choose("Importa in un disegno…");
    await importReady();
    expect(fieldInputs().map((input) => input.value)).toEqual(["rete", ""]);
    importDialog()!.dispatchEvent(new Event("submit", { cancelable: true }));
    await waitFor("il disegno nasce accanto", () => "rete.svg" in host.files());
    expect(host.files()["rete.drawio"]).toBe(DRAWIO);
  });

  it("una nota non lo offre, né lo offre un file che si importa senza il comando dei disegni", async () => {
    await start(VAULT, [drawingCreateSpec()]);
    expect(openContextMenu(folderRow("Benvenuto.md"))).not.toContain("Importa in un disegno…");
    expect(openContextMenu(folderRow("note"))).toContain("Importa un disegno qui…");

    await start(VAULT, []);
    expect(openContextMenu(folderRow("rete.drawio"))).not.toContain("Importa in un disegno…");
    expect(openContextMenu(folderRow("note"))).not.toContain("Importa un disegno qui…");
    expect(openContextMenu(title())).toEqual(["Nuova cartella"]);
  });
});

describe("il clic su un file", () => {
  it("apre la finestra su un file che Fub non mostra ma sa importare, senza scrivere niente", async () => {
    const host = await start(VAULT, [drawingCreateSpec()]);
    const before = Object.keys(host.files()).sort();
    folderRow("rete.drawio").click();
    await importReady();
    expect(fieldInputs()[0]!.value).toBe("rete");
    expect(Object.keys(host.files()).sort()).toEqual(before);
    const { recentNotices } = await import("./ui/notify");
    expect(recentNotices().map((notice) => notice.text).join("|")).not.toContain("visualizzatore");
  });

  it("senza il comando dei disegni dice, come prima, che non c'è chi lo mostri", async () => {
    await start(VAULT, []);
    folderRow("rete.drawio").click();
    await settle();
    expect(importDialog()).toBeNull();
    const { recentNotices } = await import("./ui/notify");
    expect(recentNotices().map((notice) => notice.text)).toContain("Fub non ha un visualizzatore per rete.drawio: il file resta sul disco com'è.");
  });
});
