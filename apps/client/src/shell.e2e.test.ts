// @vitest-environment happy-dom
//
// **I cinque gesti, dall'inizio alla fine** (§17.2): apri un vault, scrivi,
// rinomina, cerca, ripristina.
//
// # Cosa prova questo file, e perché nessun altro lo prova
//
// Gli altri presidi di questa shell provano dei *moduli*, e li provano bene:
// `rules/` è pura, `state/` è isolato, i due pannelli con una regola dentro
// hanno la loro. Ciò che nessuno guarda è il **cablaggio** — che il click su
// una riga apra quel documento, che la battuta successiva arrivi alla porta
// giusta con la base giusta, che una rinomina migri l'identità di ciò che è
// aperto, che una view del backend disegnata dalla shell rimandi la sua azione
// a chi l'ha disegnata. Sono tutte cose che vivono *fra* i moduli, e che oggi
// si scoprivano aprendo l'app.
//
// Qui si monta `main.ts` — il vero punto di montaggio, non una sua imitazione —
// sulla scocca vera (`index.html`), contro l'host finto (`host/fake.ts`). Ciò
// che resta finto è **il di là del confine**, e il §1.3 lo ha reso un file
// solo: è esattamente il modo in cui la
// [decisione 0015](../../docs/decisions/0190-sessioni-documento-e-undo.md) diceva
// che questi giri sarebbero diventati possibili.
//
// # Nessun gesto spento in silenzio
//
// La [0109](../../docs/decisions/0192-impostazioni-locale-e-temi.md) ha
// misurato che *una suite che si svuota in silenzio è indistinguibile da una
// suite verde*, e un file come questo si svuota nel modo più facile che ci sia
// — un `.skip` messo per sbloccare un giro e mai tolto. Nessun conteggio lo
// presidia: un `.skip`, `.only` o `.todo` qui si toglie prima di chiudere il
// giro, e `npm test` lo mostra fra i saltati.
//
// # I limiti, dichiarati qui perché nessuno li deduca
//
// Non è un E2E dell'**app**: il ponte Tauri, la webview e il kernel restano
// fuori (il perché sta in `host/fake.ts`). E non è un presidio di layout: in
// `happy-dom` non c'è né CSS né misura, quindi si asserisce su *cosa* c'è e
// mai su *dove*.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendToTextEditor as typeInEditor,
  mountedTextEditors as editorViews,
  undoDepth,
} from "./editors/text/test-support";
import type { FakeHost } from "./host/fake";
import type { KernelNotice, SettingEntry, CommandSpec, KnownVault } from "./host/contract";
import { SHELL_KEYS } from "./ui/shell-keys.generated";

// Ogni gesto monta la shell vera: qui un giro sta fra 0,5 e 3 s, sul runner CI
// è circa tre volte più lento e i 5 s del default li superava ora un gesto ora
// un altro. Il tetto vale per il file intero; un blocco vero resta fermo ben
// oltre.
vi.setConfig({ testTimeout: 20_000 });

// L'host finto vive in una scatola che `vi.mock` possa vedere: i factory dei
// mock sono issati sopra gli import, quindi non possono chiudere su una
// variabile normale di questo modulo. La scatola sì, perché a leggerla è la
// factory quando il modulo viene chiesto — cioè dopo che il test l'ha riempita.
const box = vi.hoisted(() => ({
  host: null as FakeHost | null,
  /// Cosa risponde la modale di conferma del sistema. È l'unica altra cosa che
  /// la shell chiede al di là del confine (§1.3), e negli e2e è un `true`.
  confirm: true,
  /// Quante volte la modale è stata chiesta.
  asked: 0,
  /// I vault che la macchina ricorda, per la schermata senza vault.
  known: [] as KnownVault[],
}));

let activeStop: (() => void) | null = null;

// Il modulo mimato è **uno solo per tutto il file**, e delega all'host di
// adesso a ogni chiamata. Non è un vezzo: `vi.resetModules()` svuota il
// registro dei moduli ma **non** quello dei mock, quindi una factory che
// restituisse `scatola.host.module` verrebbe eseguita una volta sola e ogni
// prova dalla seconda in poi parlerebbe col vault della prima — con la shell
// rimontata a dovere, che è il modo migliore per non accorgersene. È costato
// due giri di misura, e sta scritto qui perché al terzo nessuno lo rifaccia.
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
    onKernelEvent: (handler: (n: unknown) => void) =>
      now().onKernelEvent(handler as never),
    onClose: (first: () => Promise<boolean>, onFailure: (reason: unknown) => void) => now().onClose(first, onFailure),
    // `finestra` è il manico della titlebar custom (§Fase 1): in test non
    // tocchiamo finestre vere, e i metodi sono tutti no-op o ritornano
    // valori neutri.
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
  confirm: () => {
    box.asked++;
    return Promise.resolve(box.confirm);
  },
  pickFolder: () => Promise.resolve("/vault"),
  pickFile: () => Promise.resolve(null),
}));

const { createFakeHost, TRASH_VIEW, testViewSpec } = await import("./host/fake");
const rawHtml = (await import("../index.html?raw")).default;

/// La scocca vera, rimessa in piedi come la webview la trova.
function mountShell(): void {
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(rawHtml);
  if (!body) throw new Error("index.html non ha un body");
  document.body.innerHTML = body[1].replace(/<script[\s\S]*?<\/script>/g, "");
}

/// Monta la shell su un vault finto **senza aspettare l'avvio**, con le porte
/// nominate tenute in volo.
///
/// I freni vanno messi prima di importare `main.ts`, perché l'avvio parte
/// all'import: è l'unico modo di guardare *dentro* l'apertura di un vault
/// invece che a cose fatte. Chi non ne ha bisogno usa `avvia`.
async function mount(
  file: Record<string, string>,
  settings: SettingEntry[] = [],
  root: string | null | undefined = undefined,
  throttles: string[] = [],
  notice: KernelNotice | null = null,
  commands: CommandSpec[] = [],
): Promise<{ host: FakeHost; startup: Promise<() => void>; unlock: Map<string, () => void> }> {
  vi.resetModules();
  box.confirm = true;
  const host = createFakeHost({
    file,
    view: [testViewSpec(TRASH_VIEW, "left_sidebar")],
    settings,
    root,
    sessionNotice: notice,
    commands,
    knownVaults: box.known,
  });
  box.known = [];
  box.host = host;
  const unlock = new Map(throttles.map((p) => [p, host.throttle(p)]));
  mountShell();
  const main = await import("./main");
  const startup = main.startup.then((stop) => {
    const tracked = () => {
      stop();
      if (activeStop === tracked) activeStop = null;
    };
    activeStop = tracked;
    return tracked;
  });
  return { host, startup, unlock };
}

/// Monta la shell su un vault finto e **aspetta che l'avvio sia finito**.
async function start(
  file: Record<string, string>,
  settings: SettingEntry[] = [],
  root: string | null | undefined = undefined,
  notice: KernelNotice | null = null,
  commands: CommandSpec[] = [],
): Promise<FakeHost> {
  const { host, startup } = await mount(file, settings, root, [], notice, commands);
  await startup;
  await settle();
  return host;
}

/// Monta la shell su un vault finto e **aspetta che l'avvio sia finito**.
/// Lascia girare ciò che è stato messo in coda: la shell fa quasi tutto con
/// delle promesse, e un gesto ne accende sempre qualcuna che il gesto non
/// attende.
async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}
/// Flushes promise continuations without turning a timing guess into an
/// ordering primitive. Command gates below decide when the destructive action
/// runs; this helper only lets the shell observe already-resolved work.
async function microtasks(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

/// Aspetta che una condizione diventi vera, o fallisce dicendo cosa aspettava.
/// Serve ai due pezzi che hanno un timer loro — il debounce della ricerca e
/// quello del salvataggio — e a nient'altro.
async function waitFor(thing: string, cond: () => boolean, within = 2000): Promise<void> {
  const deadline = Date.now() + within;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`non è mai successo: ${thing}`);
}

function rowsOfNote(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("#file-list .tree-row.note")];
}

function row(name: string): HTMLElement {
  const found = rowsOfNote().find((r) => r.textContent?.trim() === name);
  if (!found) {
    const views = rowsOfNote().map((r) => r.textContent?.trim());
    throw new Error(`nell'albero non c'è «${name}», ci sono: ${views.join(", ")}`);
  }
  return found;
}

/// Apre il menu contestuale su una riga e sceglie la voce con quell'etichetta.
async function contextMenu(on: HTMLElement, entry: string): Promise<void> {
  on.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  const menu = document.getElementById("context-menu");
  if (!menu) throw new Error("il menu contestuale non si è aperto");
  const buttons = [...menu.querySelectorAll("button")];
  // L'etichetta, non il testo intero: accanto può esserci la scorciatoia.
  const label = (b: Element) => b.querySelector(".menu-label")?.textContent ?? b.textContent;
  const selected = buttons.find((b) => label(b) === entry);
  if (!selected) {
    throw new Error(`nel menu non c'è «${entry}», ci sono: ${buttons.map(label)}`);
  }
  selected.click();
  await settle();
}

/// Una riga di impostazione che è la scorciatoia di un comando **della shell**,
/// come la manda il backend: di macchina, col dichiarato per default.
function shortcut(id: keyof typeof SHELL_KEYS): SettingEntry {
  return {
    spec: {
      key: `keys.${id}`,
      label: id,
      description: "",
      group: "",
      scope: "machine",
      kind: { kind: "text", default: SHELL_KEYS[id] ?? "" },
      program_writable: false,
    },
    value: SHELL_KEYS[id] ?? "",
    source: "default",
  };
}

/// Apre le impostazioni sulla scheda delle scorciatoie e rende il campo della
/// riga che porta quel titolo.
async function shortcutField(label: string): Promise<HTMLInputElement> {
  document.querySelector<HTMLButtonElement>("#open-settings")!.click();
  await settle();
  document.querySelector<HTMLButtonElement>('#settings-tabs button[data-tab="shortcuts"]')!
    .click();
  await settle();
  const rows = [...document.querySelectorAll<HTMLElement>("#settings-body .setting-row")];
  const row = rows.find((r) => r.querySelector("label")?.textContent === label);
  if (!row) {
    const views = rows.map((r) => r.querySelector("label")?.textContent);
    throw new Error(`fra le scorciatoie non c'è «${label}», ci sono: ${views.join(", ")}`);
  }
  const field = row.querySelector("input");
  if (!field) throw new Error(`la scorciatoia «${label}» è di sola lettura: non ha un field`);
  return field;
}

/// Il testo dell'editor, letto dal DOM di CodeMirror come lo legge chi guarda.
function textToVideo(): string {
  const rows = [...document.querySelectorAll(".cm-content .cm-line")];
  return rows.map((r) => r.textContent).join("\n");
}

const VAULT = {
  "Benvenuto.md": "Il primo documento di questo vault.\n",
  "note/Riunione.md": "Appunti della riunione di martedì.\n",
  "note/Spesa.md": "pane, latte, arance\n",
};

function editorTexts(): string[] {
  return [...document.querySelectorAll(".cm-content")].map((content) =>
    [...content.querySelectorAll(".cm-line")].map((line) => line.textContent ?? "").join("\n"),
  );
}

beforeEach(() => {
  activeStop?.();
  activeStop = null;
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("la menubar applicativa", () => {
  it("apre File, seleziona una voce, si chiude e si rimonta senza errori", async () => {
    const first = await mount({});
    const stopFirst = await first.startup;
    await settle();
    const file = document.querySelector<HTMLButtonElement>("#app-menu > button");
    if (!file) throw new Error("il menu File non è stato montato");

    const errors: unknown[] = [];
    const rejections: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      event.preventDefault();
      errors.push(event.error ?? event.message);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      rejections.push(event.reason);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    let stopSecond: (() => void) | undefined;
    try {
      file.click();
      const menu = document.getElementById("context-menu");
      if (!menu) throw new Error("il menu File non si è aperto");
      menu.querySelector<HTMLButtonElement>("[role=menuitem]")!.click();
      await settle();
      expect(first.host.atGate("openVault").length).toBeGreaterThan(0);

      file.click();
      expect(file.getAttribute("aria-expanded")).toBe("true");
      file.click();
      expect(file.getAttribute("aria-expanded")).toBe("false");
      file.click();
      const openMenu = document.getElementById("context-menu");
      expect(openMenu).not.toBeNull();

      stopFirst();
      openMenu?.dispatchEvent(new Event("animationend"));
      file.click();
      expect(document.getElementById("context-menu")).toBeNull();

      const second = await mount({});
      stopSecond = await second.startup;
      await settle();
      const secondFile = document.querySelector<HTMLButtonElement>("#app-menu > button");
      if (!secondFile) throw new Error("il menu File non è stato rimontato");
      secondFile.click();
      expect(document.getElementById("context-menu")).not.toBeNull();
    } finally {
      const secondMenu = document.getElementById("context-menu");
      stopSecond?.();
      secondMenu?.dispatchEvent(new Event("animationend"));
      stopFirst();
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    }

    expect(errors).toEqual([]);
    expect(rejections).toEqual([]);
  });
});

describe("il pannello delle impostazioni", () => {
  it("si apre e si chiude senza una View Transition nativa", async () => {
    const mounted = await mount({});
    const stop = await mounted.startup;
    await settle();
    const start = vi.fn(() => {
      throw new Error("View Transition non disponibile nel WebKit della shell");
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: start,
    });

    try {
      const open = document.querySelector<HTMLButtonElement>("#open-settings");
      const close = document.querySelector<HTMLButtonElement>("#settings-close");
      const panel = document.querySelector<HTMLElement>("#settings-panel");
      if (!open || !close || !panel) throw new Error("il pannello impostazioni non è montato");

      open.click();
      await settle();
      expect(panel.hidden).toBe(false);
      expect(panel.dataset.shellMotion).toBe("enter");
      expect(start).not.toHaveBeenCalled();

      close.click();
      panel.dispatchEvent(new Event("animationend"));
      expect(panel.hidden).toBe(true);
      expect(start).not.toHaveBeenCalled();

      open.click();
      await settle();
      expect(panel.hidden).toBe(false);
      expect(start).not.toHaveBeenCalled();
    } finally {
      stop();
      Object.defineProperty(document, "startViewTransition", {
        configurable: true,
        value: undefined,
      });
    }
  });
});

describe("vita della finestra", () => {
  it("smette i gesti quando si smonta e non duplica al rimontaggio", async () => {
    const first = await mount({});
    const stopFirst = await first.startup;

    const firstOpenVaults = first.host.atGate("openVault").length;
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "o", ctrlKey: true, shiftKey: true }),
    );
    await settle();
    expect(first.host.atGate("openVault")).toHaveLength(firstOpenVaults + 1);

    stopFirst();
    stopFirst();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "o", ctrlKey: true, shiftKey: true }),
    );
    await settle();
    expect(first.host.atGate("openVault")).toHaveLength(firstOpenVaults + 1);

    const second = await mount({});
    const stopSecond = await second.startup;
    const secondOpenVaults = second.host.atGate("openVault").length;
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "o", ctrlKey: true, shiftKey: true }),
    );
    await settle();
    expect(second.host.atGate("openVault")).toHaveLength(secondOpenVaults + 1);

    stopSecond();
  });

  it("ignora una risposta IPC arrivata dopo la chiusura", async () => {
    const mounted = await mount({}, [], "/vault", ["listViews"]);
    await settle();
    expect(mounted.host.atGate("listViews")).toHaveLength(1);

    await mounted.host.close();
    mounted.unlock.get("listViews")!();
    await mounted.startup;
    await settle();

    expect(document.querySelector("#views-left")?.childElementCount).toBe(0);
    expect(mounted.host.atGate("renderView")).toHaveLength(0);
  });
});

describe("navigazione accessibile dell'esploratore", () => {
  it("espande e richiude senza aprire la folder note né perdere il focus", async () => {
    await start({ ...VAULT, "note/note.md": "La folder note.\n" });
    const original = textToVideo();
    const chevron = () => document.querySelector<HTMLButtonElement>(
      '#file-list li[data-path="note"] > .tree-row > .chevron',
    )!;
    for (const [key, expanded] of [["Enter", "true"], [" ", "false"]]) {
      const control = chevron();
      control.focus();
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      control.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      // Happy DOM non esegue l'attivazione nativa predefinita del tasto.
      control.click();
      await settle();
      expect(chevron().getAttribute("aria-expanded")).toBe(expanded);
      expect(document.activeElement).toBe(chevron());
      expect(textToVideo()).toBe(original);
    }
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    chevron().dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
  });

  it("rivela la nota attiva dentro una cartella chiusa, senza togliere il fuoco all'editor", async () => {
    await start(VAULT);
    const noteItem = () =>
      document.querySelector<HTMLElement>('#file-list li[data-path="note/Riunione.md"]');
    const chevron = () =>
      document.querySelector<HTMLButtonElement>('#file-list li[data-path="note"] > .tree-row > .chevron')!;
    chevron().click();
    await waitFor("la cartella si apre", () => !!noteItem());
    noteItem()!.querySelector<HTMLElement>(".tree-row")!.click();
    await waitFor("la nota si apre", () => textToVideo().includes("riunione"));
    chevron().click();
    await waitFor("la cartella si richiude", () => !noteItem());
    const focused = document.activeElement;

    const registry = await import("./ui/commands");
    const reveal = registry.allCommands().find((e) => e.id === "shell.explorer.reveal");
    expect(reveal?.binding).toBeNull();
    await reveal!.run!();
    await settle();

    expect(noteItem()?.getAttribute("aria-selected")).toBe("true");
    expect(noteItem()?.tabIndex).toBe(0);
    expect(
      document.querySelector('#file-list li[data-path="note"]')?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(document.activeElement).toBe(focused);
  });
});

describe("rinomina e cestino dal registro dei comandi", () => {
  const noteItem = (path: string) =>
    document.querySelector<HTMLElement>(`#file-list li[data-path="${path}"]`);
  const command = async (id: string) => {
    const registry = await import("./ui/commands");
    return registry.allCommands().find((entry) => entry.id === id);
  };

  it("da fuori dell'albero rinomina la nota attiva, portandola in vista", async () => {
    await start(VAULT);
    const { openDocument } = await import("./panels/document");
    await openDocument("note/Riunione.md");
    await settle();
    expect(noteItem("note/Riunione.md")).toBeNull();

    const rename = await command("shell.explorer.rename");
    expect(rename?.binding).toBeNull();
    await rename!.run!();
    await settle();
    const field = noteItem("note/Riunione.md")?.querySelector<HTMLInputElement>("input");
    expect(field?.value).toBe("Riunione");
    expect(document.activeElement).toBe(field);
  });

  it("nell'albero F2, Canc e il comando agiscono sulla voce col fuoco", async () => {
    const host = await start(VAULT);
    // La nota attiva è Benvenuto; il fuoco va sulla cartella e poi su una
    // nota diversa, e i gesti devono seguire il fuoco e non l'attiva.
    const folder = noteItem("note")!;
    folder.querySelector<HTMLElement>(".tree-row")!.click();
    await waitFor("la cartella si apre", () => !!noteItem("note/Spesa.md"));
    noteItem("note")!.focus();
    const trash = await command("shell.explorer.trash");
    expect(trash).toBeUndefined();

    const spesa = noteItem("note/Spesa.md")!;
    spesa.focus();
    const f2 = new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true });
    spesa.dispatchEvent(f2);
    expect(f2.defaultPrevented).toBe(true);
    const field = spesa.querySelector<HTMLInputElement>("input")!;
    expect(field.value).toBe("Spesa");
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle();

    noteItem("note/Spesa.md")!.focus();
    await (await command("shell.explorer.trash"))!.run!();
    await waitFor("la voce col fuoco è nel cestino", () => host.trash().length === 1);

    const riunione = noteItem("note/Riunione.md")!;
    riunione.focus();
    const canc = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
    riunione.dispatchEvent(canc);
    expect(canc.defaultPrevented).toBe(true);
    await waitFor("anche la seconda è nel cestino", () => host.trash().length === 2);
    expect(host.atGate("invokeCommand").map((call) => call.args.slice(0, 2))).toEqual([
      ["note.trash", { doc: "note/Spesa.md" }],
      ["note.trash", { doc: "note/Riunione.md" }],
    ]);
    expect(Object.keys(host.files())).toContain("Benvenuto.md");
  });
});

describe("una conferma sola", () => {
  // Una domanda sì/no la fa sempre il dialogo di `host/dialog.ts`: prima
  // segnalibri e workspace ne disegnavano una loro nel DOM, e la stessa
  // eliminazione si chiedeva in due modi diversi a seconda di chi la offriva.
  it("eliminare un workspace lo chiede al dialogo dell'app, e un no lo lascia", async () => {
    await start(VAULT);
    const workspaces = await import("./state/workspaces");
    const ui = await import("./state/workspaces-ui");
    const { layout } = await import("./state/layout");
    const saved = workspaces.saveWorkspace("Sera", layout, [], null)!;
    ui.setCurrentWorkspace(saved.id);
    const registry = await import("./ui/commands");
    const remove = registry.allCommands().find((entry) => entry.id === "shell.workspace.delete")!;

    const asked = box.asked;
    box.confirm = false;
    await remove.run!();
    expect(box.asked).toBe(asked + 1);
    expect(document.querySelector(".shell-dialog")).toBeNull();
    expect(workspaces.getWorkspace(saved.id)).not.toBeNull();

    box.confirm = true;
    await remove.run!();
    expect(box.asked).toBe(asked + 2);
    expect(workspaces.getWorkspace(saved.id)).toBeNull();
  });
});

describe("un workspace salvato segue le rinomine", () => {
  // I89: il layout vivo migrava la chiave, i workspace salvati no — e al
  // ripristino la nota rinominata usciva dalle schede come «mancante».
  it("rinominata la nota, il ripristino la riapre col nome nuovo", async () => {
    const host = await start(VAULT);
    const workspaces = await import("./state/workspaces");
    const { defaultLayout, openIn } = await import("./state/layout");
    const assetto = defaultLayout();
    openIn("main", "note/Spesa.md", assetto);
    openIn("main", "Benvenuto.md", assetto);
    assetto.panes.main.history = { past: [{ k: "doc", doc: "note/Spesa.md" }], future: [] };
    const saved = workspaces.saveWorkspace("Mattina", assetto, [], null)!;

    host.renameFromOutside("note/Spesa.md", "note/Lista della spesa.md");
    await waitFor("il workspace salvato nomina la nota nuova", () =>
      workspaces.getWorkspace(saved.id)!.layout.panes.main.tabs
        .some((tab) => tab.k === "doc" && tab.doc === "note/Lista della spesa.md"));

    const applied = await workspaces.applyWorkspace(saved.id, defaultLayout());
    expect(applied?.report.missingDocs).toEqual([]);
    expect(applied?.layout.panes.main.tabs.map((tab) => tab.k === "doc" ? tab.doc : tab.view))
      .toEqual(["note/Lista della spesa.md", "Benvenuto.md"]);
    expect(applied?.layout.panes.main.history?.past).toEqual([{ k: "doc", doc: "note/Lista della spesa.md" }]);
    expect(applied?.report.prunedHistory).toBe(0);
  });
});

describe("i pannelli laterali ricordati sulla macchina", () => {
  // Stavano in `localStorage`: adesso sono `chrome.sidebar.visible` e
  // `chrome.inspector.visible`, impostazioni della macchina come il resto
  // della cornice.
  const chrome = (key: string, kind: SettingEntry["spec"]["kind"], value: SettingEntry["value"],
    source: SettingEntry["source"] = "default"): SettingEntry => ({
    spec: { key, label: key, description: "", group: "", scope: "machine", kind, program_writable: false },
    value,
    source,
  });

  it("chiuso nell'impostazione resta chiuso, e riaprirlo lo scrive lì", async () => {
    localStorage.clear();
    const host = await start(VAULT, [
      chrome("chrome.schema", { kind: "number", default: 1, min: 1, max: 1 }, 1),
      chrome("chrome.sidebar.visible", { kind: "toggle", default: true }, false, "machine"),
      chrome("chrome.inspector.visible", { kind: "toggle", default: true }, true),
    ]);
    const sidebar = document.getElementById("sidebar")!;
    await waitFor("la barra si chiude come dice la macchina", () => sidebar.hidden);

    const registry = await import("./ui/commands");
    registry.allCommands().find((entry) => entry.id === "shell.sidebar.toggle")!.run!();
    await settle();
    expect(sidebar.hidden).toBe(false);
    expect(host.calls.filter((call) => call.gate === "setSetting").map((call) => call.args))
      .toContainEqual(["chrome.sidebar.visible", true]);
    expect(localStorage.getItem("fub.layout.sidebar")).toBeNull();
  });
});

describe("apri un vault", () => {
  it("la finestra parte sul vault iniziale, con l'albero e la prima nota aperta", async () => {
    // **Le domande che nessun dato lega partono insieme.** Aprire un vault
    // costava otto andate e ritorno sull'IPC in fila — quattro caricatori di
    // stato (`loadLayout` ne fa due di suo) e tre elenchi del kernel — per
    // otto risposte che non si leggono a vicenda. Adesso sono due attese.
    //
    // Il conto delle chiamate non lo vedrebbe: sono le stesse otto in tutti e
    // due i casi. Il predicato è l'**attesa**, e si costruisce coi freni
    // dell'host finto invece di sperarla: si tiene in volo la risposta di una
    // porta e si guarda chi è già partito. Rosso con la forma di prima:
    // `viewState` era chiesta una volta sola, e `listCommands` mai.
    const { host, startup, unlock } = await mount(VAULT, [], undefined, [
      "viewState",
      "listViews",
    ]);
    await settle();
    expect(host.atGate("viewState").map((c) => c.args[0])).toEqual(expect.arrayContaining([
      "layout",
      "mode",
      "expanded",
      "activeSpace",
    ]));

    unlock.get("viewState")!();
    await settle();
    expect(host.atGate("listViews")).toHaveLength(1);
    expect(host.atGate("listCommands")).toHaveLength(1);

    unlock.get("listViews")!();
    await startup;
    await settle();

    // Il vault che l'host propone all'avvio, non uno scelto da qui: la barra
    // ne mostra il nome (il percorso intero sta nel suggerimento), e il titolo
    // della finestra dice nota e vault.
    expect(document.querySelector("#vault-path")?.textContent).toBe("vault");
    expect(rowsOfNote().map((r) => r.textContent?.trim())).toEqual(["Benvenuto"]);
    expect(textToVideo()).toContain("Il primo documento");
    expect(document.title).toBe("Benvenuto — vault — Fub");

    // **Con una finestra da uno** (§14.4): l'apertura non chiede il vault
    // intero per aprire una nota. È la specie di fatto che si vede solo da
    // questa parte del confine, e che guardando lo schermo non si vede.
    const forNoteBefore = host
      .atGate("queryIndex")
      .map((c) => c.args[0] as { kind: string; page?: { limit: number } | null })
      .filter((q) => q.kind === "entries" && q.page?.limit === 1);
    expect(forNoteBefore.length).toBeGreaterThan(0);
  });

  it("una cartella si apre e mostra ciò che ha dentro, non prima", async () => {
    await start(VAULT);
    expect(rowsOfNote().map((r) => r.textContent?.trim())).toEqual(["Benvenuto"]);

    const folder = [...document.querySelectorAll<HTMLElement>("#file-list .tree-row.folder")].find(
      (r) => r.textContent?.includes("note"),
    );
    expect(folder).toBeDefined();
    folder?.click();
    await waitFor("la cartella si apre", () => rowsOfNote().length === 3);
    expect(rowsOfNote().map((r) => r.textContent?.trim()).sort()).toEqual([
      "Benvenuto",
      "Riunione",
      "Spesa",
    ]);
  });

  it("gli allegati stanno nell'albero: un media si apre nel visualizzatore, un file ignoto no", async () => {
    const host = await start({ ...VAULT, "note/foto.png": "png", "note/dati.zip": "zip" });
    const fileRows = () => [...document.querySelectorAll<HTMLElement>("#file-list .tree-row.file")];
    const folder = [...document.querySelectorAll<HTMLElement>("#file-list .tree-row.folder")].find(
      (r) => r.textContent?.includes("note"),
    );
    folder?.click();
    await waitFor("gli allegati compaiono", () => fileRows().length === 2);
    expect(fileRows().map((r) => r.querySelector(".row-name")?.textContent)).toEqual([
      "dati.zip",
      "foto.png",
    ]);
    expect(rowsOfNote()).toHaveLength(3);

    fileRows()[0]!.click();
    await settle();
    expect(host.atGate("readDocument").map((call) => call.args[0])).not.toContain("note/dati.zip");
    expect(host.atGate("resourceOpen")).toHaveLength(0);

    fileRows()[1]!.click();
    await waitFor("il visualizzatore chiede la risorsa", () => host.atGate("resourceOpen").length > 0);
    expect(host.atGate("resourceOpen")[0]!.args[0]).toBe("note/foto.png");
    expect(host.atGate("readDocument").map((call) => call.args[0])).not.toContain("note/foto.png");
  });

  it("un allegato si cestina dal suo menu contestuale, come una nota", async () => {
    const host = await start({ ...VAULT, "note/foto.png": "png" });
    const fileRow = () => document.querySelector<HTMLElement>('#file-list .tree-row.file[data-path="note/foto.png"]');
    const folder = [...document.querySelectorAll<HTMLElement>("#file-list .tree-row.folder")].find(
      (r) => r.textContent?.includes("note"),
    );
    folder?.click();
    await waitFor("l'allegato compare", () => !!fileRow());

    await contextMenu(fileRow()!, "Elimina");
    await waitFor("l'allegato è nel cestino", () => host.trash().length === 1);
    expect(Object.keys(host.files())).not.toContain("note/foto.png");
    expect(host.atGate("invokeCommand").map((call) => call.args.slice(0, 2))).toEqual([
      ["note.trash", { doc: "note/foto.png" }],
    ]);
    await waitFor("la riga sparisce", () => !fileRow());
  });

  it("il commutatore e le scorciatoie seguono la superficie attiva", async () => {
    const mounted = await mount({
      "Markdown.md": "# Titolo\n",
      "Plain.txt": "solo testo\n",
    });
    const stop = await mounted.startup;
    await settle();
    const modes = () =>
      [...document.querySelectorAll<HTMLElement>(".pane.focus .pane-toolbar button[data-mode]")].map(
        (button) => button.dataset.mode,
      );

    expect(modes()).toEqual(["source", "live_preview", "reading"]);
    // `start` rimonta i moduli dopo i mock: serve l'esemplare vivo del pannello,
    // non un import statico catturato prima di `vi.resetModules`.
    const { openDocument } = await import("./panels/document");
    await openDocument("Plain.txt");
    await settle();
    expect(modes()).toEqual([]);
    expect(document.querySelector<HTMLElement>(".pane.focus")?.dataset.mode).toBe("source");

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "l",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(document.querySelector<HTMLElement>(".pane.focus")?.dataset.mode).toBe("source");
    document.querySelector<HTMLElement>(".tab")?.click();
    await settle();
    expect(modes()).toEqual(["source", "live_preview", "reading"]);
    expect(
      document.querySelector<HTMLElement>(".pane.focus .pane-toolbar button[aria-pressed='true']")
        ?.dataset.mode,
    ).toBe("live_preview");
    stop();
  });
});

describe("scrivi", () => {
  it("ciò che si batte arriva al disco, e discende dalla revisione che si era letta", async () => {
    const host = await start(VAULT);
    const reads = host.atGate("readDocument");
    const read = reads[reads.length - 1];
    expect(read?.args[0]).toBe("Benvenuto.md");

    typeInEditor("Una riga nuova.");
    await waitFor("il salvataggio parte", () => host.atGate("writeDocument").length > 0);

    const written = host.atGate("writeDocument")[0];
    expect(written.args[0]).toBe("Benvenuto.md");
    expect(String(written.args[1])).toContain("Una riga nuova.");
    // **La guardia della 0092**: si scrive dichiarando da cosa si partiva, e
    // ciò da cui si partiva è la revisione che la lettura ha risposto — non un
    // `dictated` che copre in silenzio ciò che c'era.
    expect(written.args[2]).toEqual({ kind: "descends_from", value: "r1" });
    expect(host.files()["Benvenuto.md"]).toContain("Una riga nuova.");
  });
});

describe("i confini del buffer", () => {
  it("accorpa le battute ravvicinate in un solo debounce", async () => {
    const host = await start(VAULT);

    typeInEditor("prima battuta");
    typeInEditor(" e seconda battuta");
    await waitFor("il debounce parte", () => host.atGate("writeDocument").length === 1);
    // The integration exercises the real 400 ms app debounce; fake timers would
    // also freeze `waitFor`/`settle` and cannot observe the host gate naturally.
    await new Promise((resolve) => setTimeout(resolve, 450));
    await settle();

    expect(host.atGate("writeDocument")).toHaveLength(1);
    expect(host.files()["Benvenuto.md"]).toContain("prima battuta e seconda battuta");
  });

  it("mantiene il testo e lo stato quando una scrittura fallisce", async () => {
    const host = await start(VAULT);
    const repair = host.fault("writeDocument", "disco pieno");
    // `vi.resetModules` gives each mounted shell its own notification history.
    const { recentNotices } = await import("./ui/notify");

    typeInEditor("testo rifiutato dal disco");
    await waitFor(
      "la scrittura rifiutata parte",
      () => host.atGate("writeDocument").length === 1,
    );
    await waitFor(
      "lo stato diventa fallito",
      () => document.getElementById("save-state")?.dataset.state === "fallito",
    );

    expect(host.files()["Benvenuto.md"]).not.toContain("testo rifiutato dal disco");
    expect(
      recentNotices().some((notice) => notice.text.includes("non è stato salvato")),
      "il fallimento della scrittura non è visibile",
    ).toBe(true);
    repair();
  });

  it("ricarica un cambio watcher quando il buffer è pulito", async () => {
    const host = await start(VAULT);
    const readsBefore = host.atGate("readDocument").length;

    await host.module.api.writeDocument(
      "Benvenuto.md",
      "testo arrivato dal watcher\n",
      { kind: "dictated" },
    );
    expect(host.emit({ type: "document_changed", id: "Benvenuto.md" })).toBe(true);

    await waitFor(
      "il documento viene riletto dopo il cambio watcher",
      () => host.atGate("readDocument").length > readsBefore,
    );
    await waitFor(
      "il testo watcher arriva all'editor",
      () => textToVideo().includes("testo arrivato dal watcher"),
    );
    expect(textToVideo()).toContain("testo arrivato dal watcher");
  });

  it("non sovrascrive il buffer sporco quando il watcher cambia il file", async () => {
    const host = await start(VAULT);
    typeInEditor("testo locale non salvato");
    const readsBefore = host.atGate("readDocument").length;

    await host.module.api.writeDocument(
      "Benvenuto.md",
      "testo arrivato dal watcher\n",
      { kind: "dictated" },
    );
    expect(host.emit({ type: "document_changed", id: "Benvenuto.md" })).toBe(true);

    await settle();
    expect(host.atGate("readDocument").length).toBe(readsBefore);
    expect(textToVideo()).toContain("testo locale non salvato");
    expect(textToVideo()).not.toContain("testo arrivato dal watcher");
    await host.close();
  });

  it("rifiuta la scrittura su una revisione superata senza coprire il file", async () => {
    const host = await start(VAULT);

    typeInEditor("testo locale");
    await host.module.api.writeDocument(
      "Benvenuto.md",
      "testo scritto altrove\n",
      { kind: "dictated" },
    );

    const revisionOf = (call: { args: unknown[] }): string | undefined => {
      const base = call.args[2];
      if (typeof base !== "object" || base === null || !("kind" in base)) return undefined;
      if (base.kind !== "descends_from" || !("value" in base) || typeof base.value !== "string") {
        return undefined;
      }
      return base.value;
    };
    await waitFor(
      "la scrittura locale arriva con la base letta",
      () =>
        host
          .atGate("writeDocument")
          .some((call) => revisionOf(call) !== undefined),
    );
    await waitFor(
      "lo stato diventa conflitto",
      () => document.getElementById("save-state")?.dataset.state === "conflitto",
    );
    await waitFor("la bozza del conflitto parte", () => host.atGate("saveDraft").length > 0);

    const attempted = host
      .atGate("writeDocument")
      .find((call) => revisionOf(call) !== undefined);
    expect(attempted).toBeDefined();
    expect(revisionOf(attempted!)).toBe("r1");
    expect(host.files()["Benvenuto.md"]).toBe("testo scritto altrove\n");
  });
});

describe("undo locale tra riquadri", () => {
  it("condivide il testo ma non la cronologia, senza rileggere o lasciare timer", async () => {
    const host = await start(VAULT);
    const readsAtSplit = host.atGate("readDocument").length;
    const initial = editorTexts();
    expect(initial).toHaveLength(1);

    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "\\", ctrlKey: true }),
    );
    await waitFor("il secondo riquadro si apre", () => editorViews().length === 2);
    await settle();
    expect(host.atGate("readDocument").length).toBe(readsAtSplit);
    expect(editorTexts()).toEqual([initial[0], initial[0]]);

    const views = editorViews();
    views[0]!.dispatch({
      changes: { from: views[0]!.state.doc.length, insert: " [A]" },
    });
    views[1]!.dispatch({
      changes: { from: views[1]!.state.doc.length, insert: " [B]" },
    });
    await settle();
    const both = `${initial[0]} [A] [B]`;
    expect(editorTexts()).toEqual([both, both]);

    views[0]!.focus();
    views[0]!.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "z", ctrlKey: true }),
    );
    await settle();
    expect(editorTexts()).toEqual([`${initial[0]} [B]`, `${initial[0]} [B]`]);
    views[1]!.focus();
    views[1]!.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "z", ctrlKey: true }),
    );
    await settle();
    expect(editorTexts()).toEqual([initial[0], initial[0]]);

    views[1]!.focus();
    views[1]!.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "y", ctrlKey: true }),
    );
    await settle();
    expect(editorTexts()).toEqual([`${initial[0]} [B]`, `${initial[0]} [B]`]);

    const writesBeforeClose = host.atGate("writeDocument").length;
    await host.close();
    await settle();
    expect(host.atGate("writeDocument").length).toBe(writesBeforeClose + 1);
    await settle();
    expect(host.atGate("writeDocument").length).toBe(writesBeforeClose + 1);
  });
  it("un riquadro rimasto indietro fonde la sua battuta invece di perderla", async () => {
    await start(VAULT);
    const initial = editorTexts()[0]!;
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "\\", ctrlKey: true }),
    );
    await waitFor("il secondo riquadro si apre", () => editorViews().length === 2);
    await settle();

    const views = editorViews();
    views[0]!.dispatch({ changes: { from: views[0]!.state.doc.length, insert: " [A]" } });
    await settle();
    // Il secondo riquadro resta indietro — una sincronizzazione mancata —
    // senza che la sessione lo sappia: `sync` non torna alla sessione.
    const behind = views[1]!.state.doc.length;
    views[1]!.dispatch({
      changes: { from: behind - " [A]".length, to: behind },
      userEvent: "sync",
    });
    expect(editorTexts()[1]).toBe(initial);

    // La battuta parte da un testo stantio: la sessione la rifiuta, il
    // pannello la ribasa e la ripresenta. Prima si perdeva sotto il testo
    // autorevole, fuori dalla history.
    views[1]!.dispatch({ changes: { from: 0, insert: "[B] " } });
    await settle();
    const merged = `[B] ${initial} [A]`;
    expect(editorTexts()).toEqual([merged, merged]);

    // La battuta resta del riquadro che l'ha fatta: il suo undo toglie
    // soltanto quella, e l'altro riquadro la vede sparire.
    views[1]!.focus();
    views[1]!.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "z", ctrlKey: true }),
    );
    await settle();
    expect(editorTexts()).toEqual([`${initial} [A]`, `${initial} [A]`]);
  });
});

describe("una sessione e le sue superfici", () => {
  it("dopo il rimonto della linguetta il secondo riquadro continua a seguire", async () => {
    await start(VAULT);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "\\", ctrlKey: true }),
    );
    await waitFor("il secondo riquadro si apre", () => editorViews().length === 2);
    await settle();

    // Il secondo riquadro mostra un altro documento e poi torna: la
    // registrazione alla sessione si toglie e si rifà. Ciò che si guarda è
    // che **dopo** il rimonto la sessione raggiunge ancora entrambe le
    // superfici — una registrazione persa qui non si riparebbe più.
    const folder = document.querySelector<HTMLElement>("#file-list .tree-row.folder");
    folder?.click();
    await waitFor("la cartella si apre", () => rowsOfNote().length === 3);
    const panes = [...document.querySelectorAll<HTMLElement>(".pane")];
    panes[1]?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    row("Spesa").click();
    await waitFor(
      "la nota della cartella arriva nel secondo riquadro",
      () => editorViews()[1]?.state.doc.toString().includes("pane, latte") === true,
    );
    const tabs = [...document.querySelectorAll<HTMLElement>(".pane")][1]!.querySelectorAll<HTMLElement>(".tab");
    tabs[0]?.click();
    await waitFor(
      "il secondo riquadro torna sul documento di partenza",
      () => editorViews()[1]?.state.doc.toString().includes("Il primo documento") === true,
    );
    await settle();

    const views = editorViews();
    views[0]!.dispatch({ changes: { from: views[0]!.state.doc.length, insert: " [dopo il rimonto]" } });
    await settle();
    const texts = editorTexts();
    expect(texts).toEqual([texts[0], texts[0]]);
    expect(texts[0]).toContain(" [dopo il rimonto]");
  });

  it("la rinomina non stacca le superfici: due riquadri restano una sessione", async () => {
    const host = await start(VAULT);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "\\", ctrlKey: true }),
    );
    await waitFor("il secondo riquadro si apre", () => editorViews().length === 2);
    await settle();

    await contextMenu(row("Benvenuto"), "Rinomina");
    const field = document.querySelector<HTMLInputElement>("#file-list input");
    if (!field) throw new Error("la riga non è diventata un campo");
    field.value = "Indice";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await waitFor("la rinomina arriva al kernel", () => host.atGate("invokeCommand").length > 0);
    await settle();
    // La barriera è la **linguetta**: l'albero si riscrive con un evento, la
    // migrazione dell'identità aperta (evento `document_renamed` → layout →
    // sessione) con un altro. Battere nel mezzo scriverebbe col nome di
    // prima — una corsa del sistema, non ciò che questo banco prova.
    await waitFor("la linguetta segue la rinomina", () =>
      [...document.querySelectorAll<HTMLElement>(".tab-name")].some(
        (el) => el.textContent === "Indice",
      ),
    );
    await settle();

    const views = editorViews();
    views[0]!.dispatch({ changes: { from: views[0]!.state.doc.length, insert: " dopo la rinomina" } });
    await settle();
    const texts = editorTexts();
    expect(texts).toEqual([texts[0], texts[0]]);
    expect(texts[0]).toContain(" dopo la rinomina");
    // Il salvataggio parte col nome nuovo: la sessione è quella, se ne è
    // costruita una seconda le due superfici starebbero su due buffer.
    await waitFor(
      "il salvataggio parte col nome nuovo",
      () => host.atGate("writeDocument").some((w) => w.args[0] === "Indice.md"),
    );
  });
});

describe("due salvataggi della stessa nota", () => {
  it("non si accavallano: chi flussa non ne fa partire un secondo", async () => {
    // Il difetto 0030, **costruito** e non aspettato. La prima stesura di questo
    // banco batteva due volte e sperava che i due salvataggi si sovrapponessero:
    // passava verde anche togliendo la coda, perché il debounce di 400 ms li
    // metteva in fila da sé. Non provava niente, ed è stato quel verde a dire
    // dove la finestra è davvero.
    //
    // È qui: `flushPendingSave` — che parte a ogni cambio documento, a ogni
    // rinomina, a ogni azione di view che scrive — chiama `saveDoc` **subito**,
    // e il `clearTimeout` che fa prima non richiama indietro un salvataggio che
    // il timer ha già fatto partire. Senza coda erano due scritture in volo con
    // la **stessa** `base` letta tutte e due prima, e la seconda si prendeva un
    // `conflict` dal kernel su un file che aveva toccato solo l'utente.
    const host = await start(VAULT);

    const unlock = host.throttle("writeDocument");
    typeInEditor("Prima battuta.");
    await waitFor("la prima scrittura parte", () => host.atGate("writeDocument").length === 1);

    // Il gesto vero che flussa: si apre un'altra nota mentre la scrittura è
    // ancora in volo. Non si aspetta — `openDocument` è ferma dentro il flush,
    // che è ferma dentro la scrittura frenata, ed è esattamente il momento.
    const folder = document.querySelector<HTMLElement>("#file-list .tree-row.folder");
    folder?.click();
    await waitFor("la cartella si apre", () => rowsOfNote().length === 3);
    void row("Riunione").click();
    await settle();

    // **Il momento che conta.** Senza la coda qui le scritture sono due.
    expect(host.atGate("writeDocument").length).toBe(1);

    unlock();
    await waitFor("la nota si apre", () => host.atGate("readDocument").length > 1);
    await settle();

    // Una scrittura sola, e nessun conflitto: il flush ha aspettato quella in
    // volo invece di affiancarle una gemella con la base di prima.
    expect(host.atGate("writeDocument").length).toBe(1);
    expect(host.files()["Benvenuto.md"]).toContain("Prima battuta.");
  });
});

describe("rinomina", () => {
  it("il nome pagina cambia, cartella ed estensione restano, e la nota aperta segue", async () => {
    const host = await start(VAULT);

    await contextMenu(row("Benvenuto"), "Rinomina");
    const field = document.querySelector<HTMLInputElement>("#file-list input");
    if (!field) throw new Error("la riga non è diventata un campo");
    field.value = "Indice";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    await waitFor("la rinomina arriva al kernel", () => host.atGate("invokeCommand").length > 0);
    await settle();

    const invoked = host.atGate("invokeCommand")[0];
    expect(invoked.args[0]).toBe("note.rename");
    expect(invoked.args[1]).toEqual({ doc: "Benvenuto.md", to: "Indice.md" });
    expect(Object.keys(host.files())).toContain("Indice.md");

    // L'identità del documento aperto la migra **l'evento**, non il chiamante
    // (§13.1): il buffer che si salverà dopo deve avere il nome nuovo, o la
    // prima battuta successiva ricreerebbe la nota vecchia.
    await waitFor("l'albero si riscrive", () =>
      rowsOfNote().some((r) => r.textContent?.trim() === "Indice"),
    );
    typeInEditor("dopo la rinomina");
    await waitFor("il salvataggio parte", () => host.atGate("writeDocument").length > 0);
    const written = host.atGate("writeDocument")[0];
    expect(written.args[0]).toBe("Indice.md");
    // **E col nome nuovo segue anche la base.** Il path da solo non basta a
    // provarlo: senza la migrazione del buffer, la battuta dopo la rinomina ne
    // fa nascere uno nuovo — che scrive sul path giusto, ma `dictated`, cioè
    // coprendo qualunque cosa ci sia senza guardare. Misurato: togliendo la
    // migrazione, un presidio che guardasse solo il path resterebbe **verde**.
    expect(written.args[2]).toEqual({ kind: "descends_from", value: "r1" });
  });
});

describe("nuova cartella", () => {
  it("nasce dal kernel dentro una cartella o nella radice, e un nome occupato non lascia il campo", async () => {
    const host = await start(VAULT);
    const folderRow = (path: string) =>
      document.querySelector<HTMLElement>(`#file-list li[data-path="${path}"] > .tree-row`);
    const typeFolder = async (name: string) => {
      const field = document.querySelector<HTMLInputElement>("#file-list input.new-folder");
      if (!field) throw new Error("il campo della cartella nuova non c'è");
      field.value = name;
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await settle();
    };

    await contextMenu(folderRow("note")!, "Nuova cartella");
    await typeFolder("Progetti");
    await waitFor("la sottocartella compare aperta sotto la madre", () => !!folderRow("note/Progetti"));
    expect(host.atGate("invokeCommand").map((call) => call.args.slice(0, 2))).toEqual([
      ["folder.create", { path: "note/Progetti" }],
    ]);

    await contextMenu(document.querySelector<HTMLElement>("#files-title")!, "Nuova cartella");
    await typeFolder("Archivio");
    await waitFor("la cartella di radice compare", () => !!folderRow("Archivio"));

    await contextMenu(document.querySelector<HTMLElement>("#files-title")!, "Nuova cartella");
    await typeFolder("note");
    await waitFor("il rifiuto chiude il campo", () => !document.querySelector("input.new-folder"));
    expect(host.atGate("invokeCommand")).toHaveLength(3);
    expect(document.querySelectorAll('#file-list li[data-path="note"]')).toHaveLength(1);
  });
});

describe("rinomina durante un salvataggio in volo", () => {
  it("aspetta il salvataggio e non ricrea il nome vecchio", async () => {
    const host = await start(VAULT);
    const unlock = host.throttle("writeDocument");

    typeInEditor("testo prima della rinomina");
    await waitFor(
      "la prima scrittura è in volo",
      () => host.atGate("writeDocument").length === 1,
    );

    await contextMenu(row("Benvenuto"), "Rinomina");
    const field = document.querySelector<HTMLInputElement>("#file-list input");
    if (!field) throw new Error("la riga non è diventata un campo");
    field.value = "Indice";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(host.atGate("invokeCommand").filter((c) => c.args[0] === "note.rename")).toHaveLength(0);

    unlock();
    await waitFor(
      "la rinomina parte dopo il salvataggio",
      () => host.atGate("invokeCommand").some((c) => c.args[0] === "note.rename"),
    );
    await settle();

    expect(host.atGate("writeDocument")).toHaveLength(1);
    expect(Object.keys(host.files())).toContain("Indice.md");
    expect(Object.keys(host.files())).not.toContain("Benvenuto.md");
    expect(host.files()["Indice.md"]).toContain("testo prima della rinomina");
  });
});

describe("chiudere la finestra col ritardo che corre", () => {
  /// I due ritardi della shell — 400 ms il salvataggio, un secondo la bozza —
  /// non hanno un dopo quando la finestra si chiude, e non lo aveva nessuno:
  /// `RunEvent::Exit` di `fub-app` chiude gli indici quando la webview sta già
  /// morendo, e ciò che era in RAM non lo chiedeva più nessuno (difetto 0205).
  ///
  /// I banchi non aspettano il ritardo: chiudono **mentre corre**, che è
  /// esattamente il caso, e guardano cos'è arrivato all'host.
  it("l'ultima battuta va sul disco invece di sparire", async () => {
    const host = await start(VAULT);
    typeInEditor("l'ultima riga prima di chiudere");

    await host.close();

    // Il testo battuto si aggiunge in fondo alla nota, quindi ciò che parte per
    // il disco è **tutto** il documento: si guarda dentro, non uguale.
    const writtenItems = host.atGate("writeDocument").map((c) => String(c.args[1]));
    expect(
      writtenItems.join("\n--- e poi ---\n"),
      "la finestra si è chiusa mentre il ritardo del salvataggio correva: " +
        "l'ultima battuta non è arrivata al disco",
    ).toContain("l'ultima riga prima di chiudere");
  });

  /// L'altra metà, e la ragione per cui la chiusura non chiede conferma: se il
  /// disco rifiuta, il testo deve restare **nella bozza**, che è la rete tesa
  /// apposta sotto questo caso (§15.2).
  ///
  /// La domanda qui non è «la bozza c'è» — il ramo di fallimento di `saveDoc` la
  /// scrive comunque — ma **se la chiusura l'ha aspettata**: una scrittura
  /// lanciata e non attesa, in questa riga, corre contro la distruzione della
  /// finestra, e chi arriva secondo non arriva. Quindi la bozza si tiene in volo
  /// e si guarda se la chiusura è già finita senza di lei.
  it("la chiusura aspetta la bozza, invece di lanciarla e andarsene", async () => {
    const host = await start(VAULT);
    typeInEditor("la riga che il disco non vuole");
    const repair = host.fault("writeDocument", "disco pieno");
    const unlock = host.throttle("saveDraft");

    let closed = false;
    const close = host.close().then(() => {
      closed = true;
    });
    await settle();

    const drafts = host.atGate("saveDraft").map((c) => String(c.args[1]));
    expect(
      drafts.join("\n--- e poi ---\n"),
      "il salvataggio è fallito chiudendo e nessuno ha scritto la bozza: " +
        "l'ultima battuta non è in nessuno dei due posti",
    ).toContain("la riga che il disco non vuole");
    expect(
      closed,
      "la finestra si è chiusa mentre la bozza era ancora in volo: la battuta " +
        "che il disco ha rifiutato corre contro la distruzione della webview",
    ).toBe(false);

    unlock();
    await close;
    repair();
  });
});

describe("chiudere linguette e superfici", () => {
  it("mantiene il focus al ridisegno e permette frecce, attivazione e chiusura", async () => {
    await start(VAULT);
    const { openDocument, synchronize } = await import("./panels/document");
    await openDocument("note/Riunione.md");
    await settle();
    const tabs = () => [...document.querySelectorAll<HTMLButtonElement>(".pane .tab")];
    tabs()[1]!.focus();
    await synchronize();
    await synchronize();
    expect(document.activeElement).toBe(tabs()[1]);
    expect(document.querySelectorAll("[data-tab-menu]")).toHaveLength(1);

    tabs()[1]!.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowLeft", bubbles: true, cancelable: true,
    }));
    expect(document.activeElement).toBe(tabs()[0]);
    expect(textToVideo()).toContain("Appunti della riunione");
    tabs()[0]!.click();
    await settle();
    expect(textToVideo()).toContain("Il primo documento");
    expect(document.activeElement).toBe(tabs()[0]);

    tabs()[0]!.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Delete", bubbles: true, cancelable: true,
    }));
    await settle();
    expect(tabs().map((tab) => tab.textContent)).toEqual(["Riunione"]);
    expect(document.activeElement).toBe(tabs()[0]);
    expect(textToVideo()).toContain("Appunti della riunione");
    const close = document.querySelector<HTMLButtonElement>(".pane .tab-close")!;
    close.focus();
    close.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", bubbles: true, cancelable: true,
    }));
    await settle();
    expect(document.activeElement).toBe(
      document.querySelector('.pane-toolbar button[aria-haspopup="menu"]'),
    );
  });

  it("chiude una linguetta senza chiudere le altre", async () => {
    const host = await start(VAULT);
    const folder = document.querySelector<HTMLElement>("#file-list .tree-row.folder");
    folder?.click();
    await waitFor("la cartella si apre", () => rowsOfNote().length === 3);

    row("Riunione").click();
    await waitFor("la seconda linguetta si apre", () =>
      textToVideo().includes("Appunti della riunione"),
    );
    const tabs = [...document.querySelectorAll<HTMLElement>(".pane .tab")];
    expect(tabs).toHaveLength(2);

    const tab = tabs[1];
    const tabId = tab?.id;
    const close = tabId
      ? document.querySelector<HTMLElement>(`.pane .tab-close[data-tab-id="${tabId}"]`)
      : null;
    expect(close?.classList.contains("tab-close")).toBe(true);
    // La chiusura scatta al `click` e non al `mousedown` (WCAG 2.5.2): premere
    // e trascinare fuori dalla × annulla il gesto.
    close?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(document.querySelectorAll(".pane .tab")).toHaveLength(2);
    close?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(
      "resta la linguetta iniziale",
      () => document.querySelectorAll(".pane .tab").length === 1,
    );
    expect(textToVideo()).toContain("Il primo documento");
    expect(host.files()["Benvenuto.md"]).toBe(VAULT["Benvenuto.md"]);
  });

  it("chiude l'ultima linguetta, salva una volta e non lascia timer", async () => {
    const host = await start(VAULT);
    typeInEditor("testo prima di chiudere la linguetta");

    const close = document.querySelector<HTMLElement>(".pane .tab-close");
    close?.click();
    await waitFor(
      "l'ultima linguetta si chiude",
      () => document.querySelectorAll(".pane .tab").length === 0,
    );
    await waitFor("il salvataggio della linguetta parte", () =>
      host.atGate("writeDocument").length === 1,
    );
    expect(host.files()["Benvenuto.md"]).toContain("testo prima di chiudere la linguetta");

    // This integration must let the real save/debounce deadlines pass: a
    // residual timer is the behavior under test, not an injectable callback.
    await new Promise((resolve) => setTimeout(resolve, 450));
    await settle();
    expect(host.atGate("writeDocument")).toHaveLength(1);
  });

  it("una linguetta che non si salva non butta il buffer alla chiusura", async () => {
    const host = await start(VAULT);
    const { documentSessions } = await import("./state/document-session");
    const repair = host.fault("writeDocument", "disco pieno");
    box.confirm = false;
    const asked = box.asked;
    typeInEditor("lavoro che il disco rifiuta");

    document.querySelector<HTMLElement>(".pane .tab-close")?.click();
    await waitFor("la chiusura chiede cosa fare", () => box.asked === asked + 1);
    // Senza un «scarta» esplicito la nota torna aperta, col suo buffer.
    await waitFor("la nota torna aperta", () =>
      document.querySelectorAll(".pane .tab").length === 1 &&
      textToVideo().includes("lavoro che il disco rifiuta"),
    );
    expect(documentSessions.inspect("Benvenuto.md")).toMatchObject({ dirty: true });

    // Scartare è una scelta: allora la sessione se ne va davvero.
    box.confirm = true;
    document.querySelector<HTMLElement>(".pane .tab-close")?.click();
    await waitFor("la sessione se ne va", () => documentSessions.get("Benvenuto.md") === undefined);
    expect(document.querySelectorAll(".pane .tab")).toHaveLength(0);
    repair();
    expect(host.files()["Benvenuto.md"]).toBe(VAULT["Benvenuto.md"]);
  });

  it("una riapertura prenotata durante il flush conserva lo stesso owner", async () => {
    const host = await start(VAULT);
    const { documentSessions } = await import("./state/document-session");
    const owner = documentSessions.get("Benvenuto.md");
    if (!owner) throw new Error("sessione non costruita");
    const unlock = host.throttle("writeDocument");

    typeInEditor("battuta prima di chiudere");
    await waitFor("la prima scrittura parte", () => host.atGate("writeDocument").length === 1);

    const close = document.querySelector<HTMLElement>(".pane .tab-close");
    close?.click();
    await waitFor(
      "la linguetta si chiude",
      () => document.querySelectorAll(".pane .tab").length === 0,
    );

    // Il click arriva mentre il rilascio dell'ultima linguetta aspetta la
    // scrittura frenata: l'intento di apertura deve precederla, non arrivare
    // dopo che l'owner è già stato chiuso.
    row("Benvenuto").click();
    await settle();
    expect(documentSessions.get("Benvenuto.md")).toBe(owner);

    unlock();
    await waitFor(
      "la nota si riapre",
      () =>
        document.querySelectorAll(".pane .tab").length === 1 &&
        textToVideo().includes("battuta prima di chiudere"),
    );
    expect(documentSessions.get("Benvenuto.md")).toBe(owner);

    const writesBeforeReopen = host.atGate("writeDocument").length;
    typeInEditor(" e dopo la riapertura");
    await waitFor(
      "la battuta dopo la riapertura viene salvata",
      () => host.atGate("writeDocument").length === writesBeforeReopen + 1,
    );
    expect(host.files()["Benvenuto.md"]).toContain("e dopo la riapertura");
  });

  it("distrugge la superficie del riquadro chiuso", async () => {
    await start(VAULT);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "\\", ctrlKey: true }),
    );
    await waitFor("il secondo riquadro si apre", () => editorViews().length === 2);

    const panes = [...document.querySelectorAll<HTMLElement>(".pane")];
    const removed = editorViews()[1]!;
    panes[1]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "w",
        ctrlKey: true,
        shiftKey: true,
      }),
    );

    await waitFor("il riquadro si chiude", () => document.querySelectorAll(".pane").length === 1);
    expect(editorViews()).toHaveLength(1);
    expect(removed.dom.isConnected).toBe(false);
  });

  it("non fa risorgere una nota sporca appena cancellata", async () => {
    const host = await start(VAULT);
    typeInEditor("testo della nota cancellata");
    const unlock = host.throttle("invokeCommand");

    await contextMenu(row("Benvenuto"), "Elimina");
    await waitFor(
      "la cancellazione arriva al kernel",
      () => host.atGate("invokeCommand").some((c) => c.args[0] === "note.trash"),
    );

    // Keep the delete command in flight past the save debounce. If the delete
    // left a timer armed, its write would recreate the now-missing path here.
    await new Promise((resolve) => setTimeout(resolve, 450));
    await settle();
    expect(host.atGate("writeDocument")).toHaveLength(0);
    expect(Object.keys(host.files())).toContain("Benvenuto.md");

    unlock();
    await waitFor("la bozza viene scartata", () => host.atGate("discardDraft").length > 0);
    await settle();
    expect(Object.keys(host.files())).not.toContain("Benvenuto.md");
  });

  it("blocca un input reale durante una cancellazione lenta e non resuscita la bozza", async () => {
    const host = await start(VAULT);
    // Dynamic imports are required because `start` resets the shell module graph
    // for every isolated fake host.
    const { documentSessions } = await import("./state/document-session");
    const { trashWithConfirm } = await import("./panels/trash");
    const view = editorViews()[0];
    if (!view) throw new Error("l'editor non è montato");
    view.dispatch({
      changes: { from: view.state.doc.length, insert: " testo da cancellare" },
      userEvent: "input.type",
    });
    const before = view.state.doc.toString();
    const unlock = host.throttle("invokeCommand");

    const deleting = trashWithConfirm("Benvenuto.md");
    await microtasks();
    expect(host.atGate("invokeCommand").some((c) => c.args[0] === "note.trash")).toBe(true);
    expect(view.state.readOnly).toBe(true);

    view.focus();
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(view.state.doc.toString()).toBe(before);
    expect(host.atGate("writeDocument")).toHaveLength(0);

    unlock();
    await deleting;
    await microtasks();
    expect(host.atGate("writeDocument")).toHaveLength(0);
    expect(host.atGate("saveDraft")).toHaveLength(0);
    expect(Object.keys(host.files())).not.toContain("Benvenuto.md");
    expect(documentSessions.get("Benvenuto.md")).toBeUndefined();
  });

  it("scongela lo stesso owner dopo un rifiuto e salva il primo input successivo", async () => {
    const host = await start(VAULT);
    // Dynamic imports are required because `start` resets the shell module graph
    // for every isolated fake host.
    const { documentSessions } = await import("./state/document-session");
    const { trashWithConfirm } = await import("./panels/trash");
    const view = editorViews()[0];
    if (!view) throw new Error("l'editor non è montato");
    view.dispatch({
      changes: { from: view.state.doc.length, insert: " testo da conservare" },
      userEvent: "input.type",
    });
    const before = view.state.doc.toString();
    const owner = documentSessions.get("Benvenuto.md");
    if (!owner) throw new Error("sessione non costruita");
    const historyBefore = undoDepth(view.state);
    const unlock = host.throttle("invokeCommand");
    const repair = host.fault("invokeCommand", "cancellazione rifiutata");

    const deleting = trashWithConfirm("Benvenuto.md");
    await microtasks();
    expect(view.state.readOnly).toBe(true);
    expect(host.files()["Benvenuto.md"]).toBe(VAULT["Benvenuto.md"]);
    expect(host.trash()).toHaveLength(0);
    view.focus();
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    expect(view.state.doc.toString()).toBe(before);
    unlock();
    await expect(deleting).rejects.toThrow("cancellazione rifiutata");
    repair();

    expect(documentSessions.get("Benvenuto.md")).toBe(owner);
    expect(view.state.readOnly).toBe(false);
    expect(view.state.doc.toString()).toBe(before);
    expect(documentSessions.inspect("Benvenuto.md")).toMatchObject({
      dirty: true,
      pendingDeletion: false,
      text: before,
    });
    expect(undoDepth(view.state)).toBe(historyBefore);

    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
    const after = view.state.doc.toString();
    expect(after).not.toBe(before);
    await waitFor(
      "il primo input dopo il rifiuto viene salvato",
      () => host.atGate("writeDocument").length > 0,
    );
    expect(host.files()["Benvenuto.md"]).toBe(after);
    expect(documentSessions.inspect("Benvenuto.md")?.dirty).toBe(false);
  });
});

describe("spostare linguette dal registro dei comandi", () => {
  const press = (on: Element, key: string, mods: KeyboardEventInit): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods });
    on.dispatchEvent(event);
    return event;
  };
  const names = (pane: Element) =>
    [...pane.querySelectorAll<HTMLElement>(".tab")].map((tab) => tab.textContent?.trim());

  it("l'accordo del registro sposta la linguetta col fuoco, non quella attiva", async () => {
    await start(VAULT);
    const { openDocument } = await import("./panels/document");
    await openDocument("note/Riunione.md");
    await settle();
    const pane = document.querySelector<HTMLElement>(".pane")!;
    expect(names(pane)).toEqual(["Benvenuto", "Riunione"]);

    // Le frecce della striscia portano il fuoco sulla prima senza attivarla.
    const first = pane.querySelector<HTMLElement>(".tab")!;
    first.focus();
    const registry = await import("./ui/commands");
    const chord = { key: "PageDown", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false };
    expect(registry.advance(registry.allCommands(), null, chord)).toMatchObject({
      type: "esegue",
      entry: { id: "shell.tab.move.right" },
    });
    press(first, "PageDown", { ctrlKey: true, shiftKey: true });
    await waitFor("la linguetta col fuoco si sposta", () => names(pane)[1] === "Benvenuto");
    expect(names(pane)).toEqual(["Riunione", "Benvenuto"]);
    expect(textToVideo()).toContain("Appunti della riunione");
    expect(first.getAttribute("aria-keyshortcuts")).toContain("Control+Shift+PageDown");

    // Il gesto di prima non è più un tasto locale che aggira il registro.
    const old = press(pane.querySelectorAll<HTMLElement>(".tab")[1]!, "ArrowLeft", { altKey: true, shiftKey: true });
    await settle();
    expect(old.defaultPrevented).toBe(false);
    expect(names(pane)).toEqual(["Riunione", "Benvenuto"]);
  });

  it("porta la linguetta nel riquadro dopo, in giro, e l'appuntata resta", async () => {
    await start(VAULT);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "\\", ctrlKey: true }),
    );
    await waitFor("il secondo riquadro si apre", () => document.querySelectorAll(".pane").length === 2);
    await settle();
    const { openDocument } = await import("./panels/document");
    await openDocument("note/Riunione.md");
    await settle();
    const panes = () => [...document.querySelectorAll<HTMLElement>(".pane")];
    const focused = panes().find((pane) => pane.classList.contains("focus"))!;
    const other = panes().find((pane) => pane !== focused)!;
    const before = names(other).length;

    const registry = await import("./ui/commands");
    const next = registry.allCommands().find((entry) => entry.id === "shell.tab.move.pane.next")!;
    expect(next.binding).toBe("Mod-Alt-PageDown");
    await next.run!();
    await waitFor("la linguetta arriva nell'altro riquadro", () => names(other).length === before + 1);
    expect(names(other)).toContain("Riunione");
    expect(names(focused)).not.toContain("Riunione");

    // Un'appuntata è appuntata al suo riquadro: il comando non la porta via.
    const { pinCurrentTab } = await import("./panels/document");
    other.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await settle();
    pinCurrentTab(true);
    await settle();
    const pinned = names(other);
    await next.run!();
    await settle();
    expect(names(other)).toEqual(pinned);
  });
});

describe("le bozze di crash che smettono di arrivare sul disco", () => {
  /// Il buffer di crash (§15.2) è una rete: gira di fianco al lavoro vero e non
  /// racconta i propri inciampi, per la ragione scritta accanto a `writeDraft` —
  /// un avviso per ogni bozza non scritta insegnerebbe a ignorare gli avvisi.
  ///
  /// Ciò che invece va detto è il **passaggio**: un vault in sola lettura, un
  /// disco pieno, una share caduta spengono la rete mentre chi scrive continua a
  /// credere di averla, e lo scopre al riavvio dopo il crash, cioè quando non
  /// può più farci niente (difetto 0209). Le due metà si guardano insieme,
  /// perché sono l'una il limite dell'altra: **lo dice**, e **lo dice una volta
  /// sola** — il debounce ci riprova a ogni battuta, e una riga per tentativo
  /// sarebbe di nuovo il rumore che il silenzio voleva evitare.
  it("lo dicono la prima volta, e non a ogni tentativo", async () => {
    const host = await start(VAULT);
    const { recentNotices } = await import("./ui/notify");
    const blind = () =>
      recentNotices().filter((a) => a.text.includes("non arriva più sul disco"));
    // Il vault diventa di sola lettura sotto i piedi: la nota non si salva e la
    // bozza nemmeno. Il primo guasto è ciò che porta la bozza al disco senza
    // aspettare il secondo — `scriviBuffer`, fallendo, la scrive subito.
    const repairDisk = host.fault("writeDocument", "vault in sola lettura");
    const repairDraft = host.fault("saveDraft", "vault in sola lettura");

    typeInEditor("la prima riga");
    await waitFor("la prima bozza tentata", () => host.atGate("saveDraft").length >= 1);
    expect(
      blind().length,
      "le bozze non arrivano più sul disco e nessuno l'ha detto: la rete di " +
        "sicurezza è spenta mentre chi scrive crede di averla",
    ).toBe(1);

    typeInEditor(" e la seconda");
    await waitFor("la seconda bozza tentata", () => host.atGate("saveDraft").length >= 2);
    expect(
      blind().length,
      "una riga di avviso per ogni bozza tentata: è il rumore che insegna a " +
        "ignorare gli avvisi",
    ).toBe(1);

    // E la terza metà, senza la quale la prima diventa «lo dice una volta e poi
    // mai più»: una share che va e viene se ne va più di una volta, e la
    // seconda caduta è una notizia come la prima. La nota continua a non
    // salvarsi — è ciò che porta la bozza al disco — ma la bozza sì, e con lei
    // il silenzio riparte da capo.
    repairDraft();
    typeInEditor(" con la rete tornata");
    await waitFor("la bozza scritta davvero", () => host.atGate("saveDraft").length >= 3);
    host.fault("saveDraft", "la share se n'è andata di nuovo");
    typeInEditor(" e la rete di nuovo caduta");
    await waitFor("la bozza tentata da capo", () => host.atGate("saveDraft").length >= 4);
    expect(
      blind().length,
      "la rete è caduta due volte e l'ha detto una: dopo il primo guasto il " +
        "canale resta muto per sempre",
    ).toBe(2);

    repairDisk();
  });
});

describe("le bozze e il salvataggio vanno in fila", () => {
  /// `writeDraft`/`dropDraft` chiamano gli IPC `save_draft`/`discard_draft`
  /// dalla stessa `Coda` che serializza i salvataggi di quel buffer, e non per
  /// conto loro: senza fila, un `discard_draft` può arrivare al kernel prima
  /// di un `save_draft` già in volo, e la bozza stantia sopravvive al buffer
  /// pulito — al riavvio la si ripropone sopra contenuto buono.
  ///
  /// La corsa la scrive il banco, non la spera: `frena` tiene lo `save_draft`
  /// in volo finché non lo si libera, e si guarda cosa parte e in che ordine.
  it("un discard non scavalca uno save_draft in volo", async () => {
    const host = await start(VAULT);
    // Metto in volo uno save_draft e lo tengo fermo. Parte subito, perché il
    // salvataggio fallendo lo scrive senza aspettare il debounce di un secondo.
    const repairDisk = host.fault("writeDocument", "disco pieno");
    const unlockDraft = host.throttle("saveDraft");
    typeInEditor("testo che il disco rifiuta");
    await waitFor(
      "la bozza parte dopo il salvataggio fallito",
      () => host.atGate("saveDraft").length === 1,
    );
    // Lo save_draft è in volo, trattenuto dal freno.

    // Riparo il disco e batto ancora: il salvataggio riuscirebbe e, pulendo
    // il buffer, scatenerebbe il discard. Senza fila il discard partiva subito
    // — mentre lo save_draft era ancora in volo.
    repairDisk();
    typeInEditor(" e adesso il disco lo prende");
    // Sotto la fila il secondo salvataggio resta in coda dietro lo save_draft
    // in volo, e il suo discard non parte; senza fila partiva subito — mentre
    // lo save_draft era ancora in volo. `attendi` fallisce se la condizione non
    // si avvera entro il debounce, ed è l'esito giusto: il discard non deve
    // partire. Si ribalta l'eccezione in «non partito».
    let discardInFlight = true;
    try {
      await waitFor(
        "il discard NON parte mentre save_draft è in volo",
        () => host.atGate("discardDraft").length > 0,
        700,
      );
    } catch {
      discardInFlight = false;
    }
    expect(
      discardInFlight,
      "il discard è partito mentre lo save_draft era ancora in volo: le bozze " +
        "non vanno in fila col salvataggio",
    ).toBe(false);

    // Libero lo save_draft: il discard ha il suo turno, e gli arriva DOPO.
    unlockDraft();
    await waitFor(
      "il discard parte dopo lo save_draft",
      () => host.atGate("discardDraft").length === 1,
    );
    const beforeDraft = host.calls.findIndex((c) => c.gate === "saveDraft");
    const afterDiscard = host.calls.findIndex((c) => c.gate === "discardDraft");
    expect(
      afterDiscard,
      "lo save_draft è arrivato al kernel dopo il discard: l'ordine non è FIFO",
    ).toBeGreaterThan(beforeDraft);
  });

  /// L'altra metà di una fila che non si avvelena: uno `save_draft` rifiutato
  /// non deve fermare ciò che viene dopo. Il rigetto è inghiottito dentro
  /// `writeDraft` (la singola bozza non racconta i propri inciampi), e la
  /// `Coda` prosegue comunque — ma se così non fosse, il discard successivo
  /// non partirebbe mai, ed è ciò che si guarda.
  it("uno save_draft rifiutato non avvelena la fila", async () => {
    const host = await start(VAULT);
    // Anche la bozza viene rifiutata: save_draft rigetta.
    const repairDisk = host.fault("writeDocument", "disco pieno");
    const repairDraft = host.fault("saveDraft", "disco pieno");
    typeInEditor("testo che né il disco né la bozza accettano");
    await waitFor(
      "il primo save_draft rifiutato parte",
      () => host.atGate("saveDraft").length === 1,
    );

    // Se il rigetto avvelenasse la coda, ciò che viene dopo non partirebbe mai.
    repairDisk();
    repairDraft();
    typeInEditor(" e invece tutto riparte");
    // Il salvataggio riesce → pulisce il buffer → discard della bozza. Che la
    // fila sia viva dopo il rifiuto lo dice il fatto che il discard arrivi.
    await waitFor(
      "il discard parte dopo lo save_draft rifiutato",
      () => host.atGate("discardDraft").length === 1,
    );
    expect(
      host.atGate("discardDraft").length,
      "il discard non è partito: la fila si è avvelenata al save_draft rifiutato",
    ).toBe(1);
  });
});

describe("spostare un file col testo non ancora sul disco", () => {
  /// Il gesto è la rinomina, e ciò che si guarda è **se parte**.
  ///
  /// `flushPendingSave` esiste per una ragione sola: il kernel, muovendo un
  /// file, riscrive i wikilink entranti di file di terzi, e un buffer rimasto
  /// sporco li ricopre col testo di prima al salvataggio successivo. La
  /// funzione però non alzava mai — un salvataggio fallito lo dice il buffer,
  /// che resta sporco — quindi chi la chiamava proseguiva identico che i byte
  /// fossero sul disco o no: una precondizione di cui nessuno leggeva l'esito
  /// (difetto 0206).
  it("la rinomina non parte, e lo dice", async () => {
    const host = await start(VAULT);
    typeInEditor("testo che il disco rifiuta");
    const repair = host.fault("writeDocument", "disco pieno");

    await contextMenu(row("Benvenuto"), "Rinomina");
    const field = document.querySelector<HTMLInputElement>("#file-list input");
    if (!field) throw new Error("la riga non è diventata un campo");
    field.value = "Indice";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle(20);

    const renames = host.atGate("invokeCommand").filter((c) => c.args[0] === "note.rename");
    expect(
      renames,
      "il file si è mosso mentre il testo battuto era solo in RAM: la " +
        "riscrittura dei wikilink del kernel finirà sotto il salvataggio dopo",
    ).toEqual([]);
    expect(Object.keys(host.files())).toContain("Benvenuto.md");
    // E chi guarda lo sa: il rifiuto è una frase, non un gesto che non fa niente.
    expect(document.body.textContent).toContain("Benvenuto.md non è sul disco");

    repair();
  });

  /// L'altra metà: `convertToFolder` sposta il file esattamente come la
  /// rinomina — è una rinomina — e non metteva in salvo niente affatto.
  it("la conversione in cartella mette in salvo prima di muovere", async () => {
    const host = await start(VAULT);
    typeInEditor("battuta prima di convertire");

    await contextMenu(row("Benvenuto"), "Converti in cartella");
    await settle(20);

    const writing = host.calls.findIndex((c) => c.gate === "writeDocument");
    const moved = host.calls.findIndex(
      (c) => c.gate === "invokeCommand" && c.args[0] === "note.rename",
    );
    expect(moved, "la conversione non è arrivata al kernel").toBeGreaterThan(-1);
    expect(
      writing,
      "il file è stato mosso senza mettere in salvo il buffer: il testo battuto " +
        "è ancora solo in RAM mentre il kernel riscrive i wikilink",
    ).toBeGreaterThan(-1);
    expect(writing).toBeLessThan(moved);
  });
});

describe("cerca", () => {
  it("la casella trova, e il risultato apre il documento", async () => {
    const host = await start(VAULT);
    const field = document.querySelector<HTMLInputElement>("#search-input");
    if (!field) throw new Error("la casella di ricerca non c'è");

    field.value = "arance";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await waitFor(
      "i risultati arrivano",
      () => document.querySelectorAll("#search-results li").length > 0,
    );

    const results = [
      ...document.querySelectorAll<HTMLButtonElement>(
        "#search-results li > button.search-result",
      ),
    ];
    expect(results.map((r) => r.textContent)).toHaveLength(1);
    expect(results[0].textContent).toContain("Spesa");

    results[0].click();
    await waitFor("il documento cercato si apre", () =>
      host.atGate("readDocument").some((c) => c.args[0] === "note/Spesa.md"),
    );
    await settle();
    expect(textToVideo()).toContain("pane, latte, arance");
  });
});

describe("ripristina", () => {
  it("una nota cestinata torna dalla view del cestino, che la shell non conosce", async () => {
    const host = await start(VAULT);

    await contextMenu(row("Benvenuto"), "Elimina");
    await waitFor("la nota è nel cestino", () => host.trash().length === 1);
    expect(Object.keys(host.files())).not.toContain("Benvenuto.md");

    // Il cestino è un `ViewProvider`: la shell disegna l'albero che riceve e
    // rimanda l'azione a chi l'ha disegnato, **senza sapere cosa faccia**. È il
    // percorso di un plugin, ed è il solo dei cinque gesti che non passa da una
    // riga di questo bundle.
    await waitFor("la view del cestino si disegna", () => trashEntries().length === 1);
    trashEntries()[0].click();
    await waitFor("la nota è tornata", () => Object.keys(host.files()).includes("Benvenuto.md"));

    const actions = host.atGate("viewAction");
    const action = actions[actions.length - 1];
    expect(action?.args[0]).toBe(TRASH_VIEW);
    expect(action?.args[3]).toBe("restore");
  });
});

describe("il cestino scelto", () => {
  it("con il cestino di sistema la cancellazione passa da trash.os e il ripiego si dice", async () => {
    const choice: SettingEntry = {
      spec: {
        key: "files.trash",
        label: "Note cancellate",
        description: "",
        group: "",
        scope: "vault",
        kind: {
          kind: "choice",
          default: "vault",
          options: [
            { value: "vault", label: "Cestino del vault" },
            { value: "system", label: "Cestino del sistema" },
          ],
        },
        program_writable: false,
      },
      value: "system",
      source: "vault",
    } as SettingEntry;
    const host = await start(VAULT, [choice]);

    await contextMenu(row("Benvenuto"), "Elimina");
    await waitFor("la nota è nel cestino", () => host.trash().length === 1);
    expect(host.atGate("invokeCommand").map((call) => call.args[0])).toEqual(["trash.os"]);
    const { recentNotices } = await import("./ui/notify");
    expect(recentNotices().some((a) => a.text.includes("cestino del vault"))).toBe(true);
  });
});

function trashEntries(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("#views-left .ui-list-item")];
}

describe("riconfigura una scorciatoia", () => {
  it("una scorciatoia della shell si cambia dal pannello, e da lì risponde la nuova", async () => {
    // L'ottavo gesto, e il primo che attraversa il pannello delle impostazioni.
    // È la casella che la 0090 aveva trasferito alla §16.3: la chiave
    // `keys.shell.*` la dichiara il bundle di core ed è di **macchina**, perché
    // un comando di shell esiste prima di ogni vault. Qui il gesto è quello che
    // l'utente fa — apri le impostazioni, vai alle scorciatoie, scrivi una
    // combinazione — e ciò che si asserisce è che la tastiera la onori.
    const host = await start(VAULT, [shortcut("shell.palette")]);

    const field = await shortcutField("Apri la palette dei comandi");
    expect(field.value).toBe(SHELL_KEYS["shell.palette"]);
    field.value = "Mod-Alt-p";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();

    // È arrivata alla porta con la chiave giusta: senza questa riga il gesto
    // potrebbe scrivere la chiave di un altro comando e sembrare a posto.
    const writtenItems = host.atGate("setSetting");
    const written = writtenItems[writtenItems.length - 1];
    expect(written?.args[0]).toBe("keys.shell.palette");
    expect(written?.args[1]).toBe("Mod-Alt-p");

    // Il pannello intrappola il fuoco, quindi si chiude prima di premere —
    // come fa chi ha finito di configurare.
    document.querySelector<HTMLButtonElement>("#settings-close")!.click();
    await settle();

    // La combinazione nuova apre la palette, premuta sul documento come da un
    // browser: è la riga che dice che il giro è chiuso — scritta, riletta, e
    // onorata senza riavviare niente.
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "p", ctrlKey: true, altKey: true }),
    );
    await settle();
    expect(document.getElementById("command-palette")).not.toBeNull();

    // E la vecchia non è più di nessuno. La domanda si pone al **registro** e
    // non premendola, per un limite di questo banco che vale la pena scrivere:
    // `document` è uno solo per tutto il file e nessuno smonta i suoi
    // ascoltatori, quindi ogni `start()` ne lascia uno addosso — premere
    // `Mod-Shift-p` qui farebbe rispondere la tastiera di un gesto precedente,
    // che ha un registro suo e non sa niente di questa scrittura. È un fatto
    // del banco, non della shell.
    const registry = await import("./ui/commands");
    expect(
      registry.advance(registry.allCommands(), null, {
        key: "p",
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        altKey: false,
      }),
    ).toEqual({ type: "passa" });
  });
});

describe("la finestra senza vault", () => {
  it("conosce comunque le scorciatoie riconfigurate, che sono della macchina", async () => {
    // Il caso per cui la famiglia `keys.shell.*` è di macchina e non di vault
    // (§16.3): `shell.vault.open` è il comando che serve ad aprire il primo
    // vault, e una sua chiave che vivesse dentro un vault esisterebbe solo dopo
    // — cioè quando serve meno. Qui non c'è nessun vault, e l'accordo che
    // l'utente ha scelto è già quello che vale.
    const chord = { ...shortcut("shell.palette"), value: "Mod-Alt-p", source: "machine" };
    await start({}, [chord as SettingEntry], null);
    expect(document.querySelector("#vault-path")?.textContent).not.toBe("/vault");

    // La domanda si pone al **registro** e non premendo, per il limite del banco
    // scritto qui sopra: su un `document` che nessuno smonta, un tasto premuto
    // qui lo riceve anche la tastiera dei gesti precedenti. Ciò che questa riga
    // difende è l'**ordine dell'avvio** — gli accordi si rileggono prima di
    // sapere se un vault c'è — e quello si vede dal registro.
    const registry = await import("./ui/commands");
    const palette = registry.allCommands().find((e) => e.id === "shell.palette");
    expect(palette?.binding).toBe("Mod-Alt-p");
    expect(palette?.declared).toBe(SHELL_KEYS["shell.palette"]);
  });

  it("chiede l'avviso di sessione all'avvio, e lo mostra se c'è", async () => {
    // §25.5: la diagnosi «la cartella di configurazione non si può scrivere»
    // nasce all'avvio del backend, quando nessun ascoltatore esiste — una
    // spinta sarebbe persa, e la porta è un tiraggio. Questo gesto tiene ferma
    // la catena intera: la shell lo chiede (il registro del finto lo vede),
    // e lo consegna al router come un evento qualunque (lo storico dei toast
    // lo mostra). Si fa rosso in due versi: senza la chiamata in `init()`
    // il registro non vede nulla, senza l'inoltro il toast non appare.
    const notice: KernelNotice = {
      event: {
        type: "trouble",
        severity: "warning",
        subject: null,
        error: { kind: "io", message: "`/config` non si può scrivere" },
        gate: null,
      },
      origin: { actor: { kind: "kernel" }, batch: null },
    };
    const host = await start({}, [], null, notice);

    expect(host.atGate("sessionNotice").length).toBe(1);
    const { recentNotices } = await import("./ui/notify");
    expect(recentNotices().some((a) => a.text.includes("non si può scrivere"))).toBe(true);

    // E una sessione sana non dice niente: il tiraggio c'è, la risposta è
    // vuota, e lo storico resta pulito. `recentNotices` si ri-importa dopo
    // ogni `start`: `vi.resetModules` ricarica i moduli, e l'istanza di prima
    // è quella della sessione con l'avviso.
    const healthy = await start({}, [], null);
    const { recentNotices: healthyRecent } = await import("./ui/notify");
    expect(healthy.atGate("sessionNotice").length).toBe(1);
    expect(healthyRecent().some((a) => a.text.includes("non si può scrivere"))).toBe(false);
  });
});

describe("i vault recenti nella schermata senza vault", () => {
  it("si tolgono dall'elenco senza toccare la cartella, e il fuoco resta nell'elenco", async () => {
    const vault = (root: string, name: string): KnownVault => ({
      root, name, icon: null, favorite: false, last_opened: 0, keys_seen: {},
    });
    box.known = [vault("/Vecchio", "Vecchio"), vault("/Appunti", "Appunti")];
    const host = await start({}, [], null);
    await waitFor("i recenti", () => document.querySelectorAll("#onboarding-recent li").length === 2);
    const forget = document.querySelector<HTMLButtonElement>("#onboarding-recent li .onboarding-forget")!;
    expect(forget.getAttribute("aria-label")).toContain("Vecchio");
    forget.focus();
    forget.click();
    await waitFor("l'elenco ridisegnato", () => document.querySelectorAll("#onboarding-recent li").length === 1);
    expect(host.atGate("forgetVault").map((call) => call.args[0])).toEqual(["/Vecchio"]);
    expect(document.querySelector("#onboarding-recent li")?.textContent).toContain("Appunti");
    await waitFor("il fuoco nell'elenco", () => document.activeElement?.closest("#onboarding-recent") !== null);
  });
});

describe("una rinomina che questa finestra non ha chiesto", () => {
  it("porta con sé il buffer sporco, e il salvataggio in attesa con lui", async () => {
    // Un `mv` da terminale, un'altra applicazione, un sync: la rinomina arriva
    // come evento mentre qui c'è del testo battuto e non ancora salvato. È il
    // caso che `renameDoc` non produce mai — chi rinomina da questa finestra
    // mette in salvo i buffer prima di chiedere — e quindi il solo modo di
    // provarlo è dall'evento.
    const host = await start(VAULT);
    typeInEditor("testo non ancora salvato");
    host.renameFromOutside("Benvenuto.md", "Fuori.md");

    await waitFor("il salvataggio in attesa arriva", () => host.atGate("writeDocument").length > 0);
    const written = host.atGate("writeDocument")[0];
    expect(written.args[0]).toBe("Fuori.md");
    expect(String(written.args[1])).toContain("testo non ancora salvato");
    // E il path vecchio **non** rinasce: era il difetto gemello, e sarebbe
    // passato per una nota duplicata invece che per una battuta persa.
    expect(Object.keys(host.files())).not.toContain("Benvenuto.md");
  });
});

describe("segui un link dentro la nota", () => {
  it("un `[[#Sezione]]` chiede al kernel col documento che lo ospita", async () => {
    // Il gesto è il click sul wikilink **reso** senza pagina, e la cosa che si
    // guarda sta di qua dal confine: *quale domanda* è partita. Un
    // `[[#Sezione]]` non nomina una nota, nomina questa — e chi lo risolve non
    // può saperlo se non gli si dice da dove si sta guardando.
    const host = await start({
      "Benvenuto.md": "Vedi [[#Appunti]] più sotto.\n\n## Appunti\n\nEccoli.\n",
    });
    const { setMode } = await import("./panels/document");
    await setMode("reading");
    await settle();
    const link = document.querySelector<HTMLElement>(".pane-preview.markdown-rendered a.wikilink");
    expect(link, "la lettura non ha reso il wikilink").not.toBeNull();
    link!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await settle();

    const requested = host
      .atGate("queryIndex")
      .map((c) => c.args[0] as { kind: string; target?: { value: { page: string } }; from?: string | null })
      .filter((q) => q.kind === "resolve");
    expect(requested).toHaveLength(1);
    expect(requested[0]!.target?.value.page).toBe("");
    expect(requested[0]!.from).toBe("Benvenuto.md");
  });
});

describe("la palette flussa prima di un comando che scrive", () => {
  // Il flush-before-patch di M3: un comando che scrive documenti riscrive
  // file — il kernel muove i wikilink entranti, la rinomina sposta la nota —
  // e un buffer rimasto sporco li ricoprirebbe col testo di prima al
  // salvataggio successivo. È la stessa guardia di `nonInSalvo`
  // dell'esploratore, e si prova qui perché la palette è l'altro posto in cui
  // un comando parte: la spec dichiara `writes`, e chi invoca deve salvare
  // prima di calcolare le patch.
  //
  // La spec è quella vera di `note.create` (commands.rs): un parametro `name`
  // facoltativo, raggio `document` — quindi niente piano, apply diretto.
  const specNoteCreate: CommandSpec = {
    id: "note.create",
    title: "Nuova nota",
    description: "",
    keybinding: null,
    params: [{ name: "name", title: "Nome", description: "", kind: { kind: "text" }, required: false }],
    scope: { writes: true, reach: "document", reversible: true },
    surfaces: [],
  };

  it("un buffer sporco si salva prima che note.create parta", async () => {
    const host = await start(VAULT, [], undefined, null, [specNoteCreate]);
    typeInEditor("testo non ancora salvato");

    // La palette si apre con la scorciatoia di default, come da un browser.
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "p", ctrlKey: true, shiftKey: true }),
    );
    await settle();
    expect(document.getElementById("command-palette")).not.toBeNull();

    const input = document.querySelector<HTMLInputElement>(".palette-input")!;
    input.value = "Nuova nota";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await settle();

    // Il comando ha un parametro facoltativo: la palette mostra il form.
    const field = document.querySelector<HTMLInputElement>(".palette-form input")!;
    field.value = "Appunti.md";
    const form = document.querySelector<HTMLFormElement>(".palette-form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();

    const flush = host.calls.findIndex((c) => c.gate === "writeDocument");
    const invoked = host.calls.findIndex(
      (c) => c.gate === "invokeCommand" && c.args[0] === "note.create",
    );
    expect(invoked, "note.create non è arrivato al kernel").toBeGreaterThan(-1);
    expect(flush, "il buffer sporco non è stato salvato affatto").toBeGreaterThan(-1);
    // **Il momento che conta.** Senza il flush, `writeDocument` non c'è (il
    // debounce di 400 ms non è scaduto) e il comando parte col testo solo in
    // RAM: `flush` sarebbe -1 e questa riga rossa.
    expect(flush, "il comando è partito prima del flush").toBeLessThan(invoked);
  });

  it("un comando di sola lettura non flussa", async () => {
    // La spec è quella vera di `search.open` (commands.rs): nessuno scope
    // dichiarato, quindi `read_only` per default. Un comando che non scrive
    // non deve pagare il giro del flush — e il banco lo prova col buffer
    // sporco: se la palette flussasse comunque, `writeDocument` avrebbe una
    // chiamata.
    const specSearchOpen: CommandSpec = {
      id: "search.open",
      title: "Cerca nel vault",
      description: "",
      keybinding: null,
      params: [{ name: "query", title: "Query", description: "", kind: { kind: "text" }, required: true }],
      scope: { writes: false, reach: "session", reversible: true },
      surfaces: [],
    };
    const host = await start(VAULT, [], undefined, null, [specSearchOpen]);
    typeInEditor("testo non ancora salvato");

    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "p", ctrlKey: true, shiftKey: true }),
    );
    await settle();
    const input = document.querySelector<HTMLInputElement>(".palette-input")!;
    input.value = "Cerca nel vault";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    await settle();

    const field = document.querySelector<HTMLInputElement>(".palette-form input")!;
    field.value = "rust";
    const form = document.querySelector<HTMLFormElement>(".palette-form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();

    expect(host.atGate("invokeCommand").some((c) => c.args[0] === "search.open")).toBe(true);
    expect(
      host.atGate("writeDocument"),
      "un comando di sola lettura non deve salvare i buffer",
    ).toHaveLength(0);
  });
});

/// Divide dal registro e non col tasto: una tastiera dei gesti precedenti,
/// su un `document` che nessuno smonta, riceverebbe anche lei l'accordo.
async function splitRight(): Promise<void> {
  const registry = await import("./ui/commands");
  await registry.allCommands().find((entry) => entry.id === "shell.pane.split.right")?.run?.();
}

/// Due riquadri: il primo su Benvenuto, il secondo su Riunione, col fuoco.
async function twoPanes(): Promise<void> {
  await splitRight();
  await waitFor("il secondo riquadro si apre", () => editorViews().length === 2);
  await settle();
  document.querySelector<HTMLElement>("#file-list .tree-row.folder")?.click();
  await waitFor("la cartella si apre", () => rowsOfNote().length === 3);
  [...document.querySelectorAll<HTMLElement>(".pane")][1]!
    .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  row("Riunione").click();
  await waitFor(
    "Riunione arriva nel secondo riquadro",
    () => editorViews()[1]?.state.doc.toString().includes("Appunti") === true,
  );
  await settle();
}

describe("i riquadri dopo un'attesa", () => {
  it("il banner del conflitto risolve la nota che nomina, non quella col fuoco", async () => {
    const host = await start(VAULT);
    await twoPanes();
    const views = editorViews();
    views[0]!.dispatch({ changes: { from: 0, insert: "mio A " } });
    views[1]!.dispatch({ changes: { from: 0, insert: "mio B " } });
    await host.module.api.writeDocument("Benvenuto.md", "disco A\n", { kind: "dictated" });
    await host.module.api.writeDocument("note/Riunione.md", "disco B\n", { kind: "dictated" });
    const banners = () => [...document.querySelectorAll<HTMLElement>(".pane")]
      .map((pane) => pane.querySelector<HTMLElement>("[data-banner='document.conflict.body']"));
    await waitFor("entrambe le note vanno in conflitto", () => banners().every((b) => b && !b.hidden));

    // Il fuoco resta sul secondo riquadro: si sceglie dal banner del primo.
    const useDisk = banners()[0]!.querySelector<HTMLButtonElement>("button[data-choice='theirs']")!;
    useDisk.click();
    await waitFor("Benvenuto torna al disco", () => editorTexts()[0]?.startsWith("disco A") === true);
    await settle();

    expect(editorTexts()[1]).toContain("mio B");
    expect(banners()[1]?.hidden, "il conflitto di Riunione resta da decidere").toBe(false);
    expect(host.files()["note/Riunione.md"]).toBe("disco B\n");
  });

  it("una lettura fallita non lascia la linguetta mostrata senza editor", async () => {
    const host = await start(VAULT);
    const { openDocument, synchronize } = await import("./panels/document");
    const restore = host.fault("readDocument");
    await openDocument("note/Spesa.md").catch(() => {});
    expect(textToVideo()).not.toContain("pane, latte");
    restore();

    await synchronize();
    await settle();

    expect(textToVideo()).toContain("pane, latte");
  });

  const errorSurfaces = () => [...document.querySelectorAll<HTMLElement>(".document-surface-error")];

  it("un canvas rotto da fuori passa alla superficie d'errore e torna quando guarisce", async () => {
    const good = JSON.stringify({
      nodes: [{ id: "a", type: "text", text: "ciao", x: 0, y: 0, width: 10, height: 10 }],
      edges: [],
    });
    const host = await start({ ...VAULT, "lavagna.canvas": good });
    const { openDocument } = await import("./panels/document");
    await openDocument("lavagna.canvas");
    await waitFor("il canvas si monta", () => document.querySelector(".canvas-surface-host") !== null);

    // Un'altra app lo riscrive male: la superficie non resta coi nodi di
    // prima, dove una modifica sembrerebbe presa e non si salverebbe.
    host.writeFromOutside("lavagna.canvas", "{rotto");
    await waitFor("la superficie d'errore prende il posto del canvas", () => errorSurfaces().length === 1);
    expect(document.querySelector(".canvas-surface-host")).toBeNull();

    host.writeFromOutside("lavagna.canvas", good);
    await waitFor("il canvas torna", () => document.querySelector(".canvas-surface-host") !== null);
    expect(errorSurfaces()).toHaveLength(0);
  });

  it("uno sheet rotto mostra la superficie d'errore, non un riquadro vuoto", async () => {
    await start({ ...VAULT, "conti.fubsheet": "{rotto" });
    const { openDocument } = await import("./panels/document");
    await openDocument("conti.fubsheet");
    await settle();

    expect(errorSurfaces()).toHaveLength(1);
    expect(errorSurfaces()[0]!.textContent).not.toBe("");
  });

  it("un riquadro che non si monta non ferma l'altro", async () => {
    await start({ ...VAULT, "conti.fubsheet": "{rotto" });
    await splitRight();
    await waitFor("il secondo riquadro si apre", () => editorViews().length === 2);
    await settle();
    const { openDocument } = await import("./panels/document");
    const { state } = await import("./state/store");
    const panes = () => [...document.querySelectorAll<HTMLElement>(".pane")];

    panes()[0]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await openDocument("conti.fubsheet");
    await waitFor("il primo riquadro mostra l'errore", () => errorSurfaces().length === 1);

    panes()[1]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await openDocument("note/Spesa.md");
    await settle();

    expect(panes()[1]!.querySelector(".cm-content")?.textContent).toContain("pane, latte");
    expect(state.currentDoc).toBe("note/Spesa.md");
    expect(panes()[0]!.querySelector(".document-surface-error")).not.toBeNull();
  });

  it("il secondo editor si monta col testo che la sessione ha adesso", async () => {
    const host = await start(VAULT);
    // Le forme sintattiche passano da `queryIndex`: frenarlo ferma il secondo
    // riquadro dopo aver letto il buffer e prima di montare l'editor.
    const unlock = host.throttle("queryIndex");
    await splitRight();
    await settle();
    const first = editorViews()[0]!;
    first.dispatch({ changes: { from: first.state.doc.length, insert: " [durante il montaggio]" } });
    unlock();
    await waitFor("il secondo riquadro si apre", () => editorViews().length === 2);
    await settle();

    const texts = editorTexts();
    expect(texts[1]).toBe(texts[0]);
    expect(texts[1]).toContain("[durante il montaggio]");
  });
});

/// Un foglio minimo che la superficie a griglia accetta.
const SHEET = JSON.stringify({
  version: 1,
  sheets: [{
    id: "main",
    name: "Main",
    rows: [{ id: "r0", hidden: false }],
    columns: [{ id: "c0", hidden: false }],
    cells: [{ row: "r0", column: "c0", input: "1" }],
  }],
});

/// Una tela con due carte: la seconda lontana dalla prima.
const BOARD = JSON.stringify({
  nodes: [
    { id: "prima", type: "text", text: "prima", x: 0, y: 0, width: 10, height: 10 },
    { id: "seconda", type: "text", text: "seconda", x: 900, y: 700, width: 10, height: 10 },
  ],
  edges: [],
});

describe("portare a schermo un punto", () => {
  const panes = () => [...document.querySelectorAll<HTMLElement>(".pane")];
  const cursor = (index: number) => editorViews()[index]!.state.selection.main.head;
  const toast = () => document.getElementById("toast")?.textContent ?? "";

  it("il punto va al riquadro che mostra il documento, non a quello col fuoco", async () => {
    await start(VAULT);
    await twoPanes();
    const { applyIntent } = await import("./ui/intents");
    expect(panes()[1]!.classList.contains("focus")).toBe(true);
    const before = cursor(1);

    // Lo span nomina Benvenuto, che sta nel primo riquadro: l'offset misurato
    // su quel testo non deve finire nel testo di Riunione.
    await applyIntent({ kind: "reveal", doc_id: "Benvenuto.md", span: { start: 10, end: 10 } });
    await settle();

    expect(panes()[0]!.classList.contains("focus"), "il riquadro di Benvenuto prende il fuoco").toBe(true);
    expect(cursor(0)).toBe(10);
    expect(cursor(1), "il cursore di Riunione resta dov'era").toBe(before);
    expect(editorTexts()[1]).toContain("Appunti");
  });

  it("una linguetta dietro un'altra torna davanti prima di portarci il punto", async () => {
    await start(VAULT);
    const { openDocument } = await import("./panels/document");
    const { applyIntent } = await import("./ui/intents");
    const { state } = await import("./state/store");
    await openDocument("note/Riunione.md");
    await settle();
    expect(state.currentDoc).toBe("note/Riunione.md");

    await applyIntent({ kind: "reveal", doc: "Benvenuto.md", span: { start: 9, end: 9 } });
    await settle();

    expect(state.currentDoc).toBe("Benvenuto.md");
    expect(editorTexts()).toHaveLength(1);
    expect(editorTexts()[0]).toContain("Il primo documento");
    expect(cursor(0)).toBe(9);
    expect(panes()[0]!.querySelectorAll(".tab"), "nessuna linguetta in più").toHaveLength(2);
  });

  it("una superficie che non sa portarci lo dice, invece di non fare niente", async () => {
    await start({ ...VAULT, "conti.fubsheet": SHEET });
    const { applyIntent } = await import("./ui/intents");
    const { t } = await import("./i18n/strings");

    await applyIntent({ kind: "reveal", doc: "conti.fubsheet", span: { start: 3, end: 3 } });
    await settle();

    expect(panes()[0]!.querySelector("[data-surface-mode='sheet']"), "lo sheet è aperto").not.toBeNull();
    expect(toast()).toContain(t("document.reveal_unavailable", { doc: "conti" }));
  });

  it("sulla tela il punto è la carta che lo contiene", async () => {
    await start({ ...VAULT, "lavagna.canvas": BOARD });
    const { applyIntent } = await import("./ui/intents");
    const { t } = await import("./i18n/strings");
    const at = BOARD.indexOf('"seconda"');

    await applyIntent({ kind: "reveal", doc: "lavagna.canvas", span: { start: at, end: at } });
    await waitFor("una carta è selezionata", () => document.querySelector(".canvas-node.selected") !== null);

    expect([...document.querySelectorAll<HTMLElement>(".canvas-node.selected")].map((node) => node.dataset.node))
      .toEqual(["seconda"]);
    expect(toast()).not.toContain(t("document.reveal_unavailable", { doc: "lavagna" }));
  });

  it("il menu del riquadro offre ciò che la superficie dichiara di saper fare", async () => {
    await start({ ...VAULT, "lavagna.canvas": BOARD, "conti.fubsheet": SHEET });
    const { openDocument } = await import("./panels/document");
    const { t } = await import("./i18n/strings");
    const { closeContextMenu } = await import("./ui/menu");
    const gestures = [t("pane.recorder.open"), t("pane.slides"), t("pane.print")];
    const offered = async (): Promise<string[]> => {
      panes()[0]!.querySelector<HTMLButtonElement>("[data-pane-menu]")!.click();
      await settle();
      const menus = [...document.querySelectorAll<HTMLElement>("#context-menu")];
      const labels = [...(menus[menus.length - 1]?.querySelectorAll("button") ?? [])]
        .map((button) => button.querySelector(".menu-label")?.textContent ?? button.textContent ?? "");
      closeContextMenu();
      await settle();
      return gestures.filter((gesture) => labels.includes(gesture));
    };

    expect(await offered(), "la nota Markdown").toEqual(gestures);
    await openDocument("lavagna.canvas");
    await settle();
    // La tela si stampa dal suo provider; non ha una resa da presentare né
    // una sintassi in cui scrivere un rimando.
    expect(await offered(), "la tela").toEqual([t("pane.print")]);
    await openDocument("conti.fubsheet");
    await settle();
    expect(await offered(), "lo sheet, che non ha un provider di stampa").toEqual([]);
  });
});

describe("la modalità di ogni famiglia di superfici", () => {
  const paneMode = () => document.querySelector<HTMLElement>(".pane.focus")?.dataset.mode;
  const choose = async (mode: string) => {
    document.querySelector<HTMLButtonElement>(`.pane.focus .pane-toolbar button[data-mode="${mode}"]`)!.click();
    await settle();
  };

  it("una nota in Sorgente non fa aprire la tela seguente come JSON", async () => {
    await start({ ...VAULT, "lavagna.canvas": BOARD });
    const { openDocument } = await import("./panels/document");
    await choose("source");
    expect(paneMode()).toBe("source");

    await openDocument("lavagna.canvas");
    await settle();
    expect(paneMode(), "la tela si apre sulla tela").toBe("canvas");
    expect(document.querySelector(".pane.focus [data-surface-mode='canvas']")).not.toBeNull();

    await openDocument("Benvenuto.md");
    await settle();
    expect(paneMode(), "la nota ritrova la Sorgente scelta").toBe("source");
  });

  it("la modalità scelta sulla tela non decide come si apre la nota", async () => {
    await start({ ...VAULT, "lavagna.canvas": BOARD });
    const { openDocument } = await import("./panels/document");
    expect(paneMode()).toBe("live_preview");
    await openDocument("lavagna.canvas");
    await settle();
    await choose("source");
    await choose("canvas");

    await openDocument("Benvenuto.md");
    await settle();
    expect(paneMode(), "non la Sorgente, prima modalità del testo").toBe("live_preview");

    await openDocument("lavagna.canvas");
    await settle();
    await choose("source");
    await openDocument("Benvenuto.md");
    await settle();
    expect(paneMode()).toBe("live_preview");
    await openDocument("lavagna.canvas");
    await settle();
    expect(paneMode(), "la tela ritrova il suo sorgente").toBe("source");
  });

  // Il contratto non nomina le modalità di una superficie: dice che vista è.
  // La tela e il foglio si scrivono attraverso una resa, non sul sorgente.
  it("il contesto pubblicato dice che vista è, non una modalità Markdown", async () => {
    const host = await start({ ...VAULT, "lavagna.canvas": BOARD, "conti.fubsheet": SHEET });
    const { openDocument } = await import("./panels/document");
    const published = () => {
      const calls = host.atGate("setActiveContext");
      return (calls[calls.length - 1]?.args[0] as { doc: string | null; mode: string } | undefined);
    };

    await openDocument("lavagna.canvas");
    await settle();
    expect(published()).toMatchObject({ doc: "lavagna.canvas", mode: "live_preview" });
    await choose("source");
    expect(published()).toMatchObject({ doc: "lavagna.canvas", mode: "source" });

    await openDocument("conti.fubsheet");
    await settle();
    expect(published()).toMatchObject({ doc: "conti.fubsheet", mode: "live_preview" });

    await openDocument("Benvenuto.md");
    await settle();
    await choose("reading");
    expect(published()).toMatchObject({ doc: "Benvenuto.md", mode: "reading" });
  });
});
