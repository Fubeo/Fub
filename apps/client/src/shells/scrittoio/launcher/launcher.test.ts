// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listenerLedger, press } from "../../../kit/testing";
import { trapFocus } from "../../../ui/a11y";
import { activeMotions, createManualDriver, setMotionDriver, setMotionPreference } from "../../../moto";
import {
  allCommands,
  registerShellCommand,
  resetShellCommands,
  type CommandEntry,
  type ShellCommand,
} from "../../../ui/commands";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { closeContextMenu, menuFind, showContextMenu } from "../../../ui/menu";
import { setSearchPort } from "../../../state/search-port";
import { state } from "../../../state/store";
import type { Listing, Row } from "./sources";

type Answer = Listing | Promise<Listing>;

const world = vi.hoisted(() => ({
  answer: null as unknown as (mode: string, text: string) => unknown,
  asked: [] as [string, string][],
  log: [] as string[],
  notices: [] as { text: string; tone: string }[],
  windows: true,
  split: "p1" as string | null,
  created: "Nuova.md" as string | null,
  openFails: false,
  languageListeners: new Set<() => void>(),
  render: null as unknown as (doc: string) => Promise<{ html: string; parts: [] }>,
  rendered: [] as string[],
}));

vi.mock("./sources", () => ({
  TEMPLATE_COMMAND: "note.from_template",
  answersAtOnce: (mode: string) => mode === "commands" || mode === "line",
  listing: (mode: string, text: string) => {
    world.asked.push([mode, text]);
    return world.answer(mode, text);
  },
}));
// Le parole sono le chiavi, con gli argomenti accanto.
vi.mock("../../../i18n/strings", () => ({
  t: (key: string, args?: Record<string, unknown>) => (args ? `${key} ${JSON.stringify(args)}` : key),
  onLanguage: (listener: () => void) => {
    world.languageListeners.add(listener);
    return () => world.languageListeners.delete(listener);
  },
}));
vi.mock("../../../ui/icons", () => ({
  iconEl: (name: string) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.dataset.icon = name;
    return svg;
  },
}));
vi.mock("../../../ui/notify", () => ({
  notify: (text: string, tone = "info") => world.notices.push({ text, tone }),
}));
vi.mock("../../../platform/capabilities", () => ({ platformSupports: () => world.windows }));
// La resa dell'anteprima: la decide il test, nota per nota.
vi.mock("../../../host/query", () => ({
  renderPreview: (doc: string) => {
    world.rendered.push(doc);
    return world.render(doc);
  },
}));
vi.mock("../../../host/ipc", () => ({
  api: {
    invokeCommand: async (id: string, args: unknown) => {
      world.log.push(`invoke ${id} ${JSON.stringify(args)}`);
      return { notify: "fatto", effect: { kind: "navigate", doc: "Da modello.md" }, undo: null };
    },
  },
}));
vi.mock("../../../state/document-controller", () => ({
  openDocument: async (doc: string) => {
    if (world.openFails) throw new Error("disco pieno");
    world.log.push(`open ${doc}`);
  },
  reveal: async (doc: string, location: { span: { start: number; end: number } }) => {
    world.log.push(`reveal ${doc} ${location.span.start}`);
  },
  focusEditor: () => world.log.push("focus editor"),
}));
vi.mock("../../../state/document-windows", () => ({
  openCurrentInNewWindow: async (doc: string) => {
    world.log.push(`window ${doc}`);
  },
}));
vi.mock("../../../state/layout", () => ({
  layout: { focus: "p0" },
  split: (id: string, direction: string) => {
    world.log.push(`split ${id} ${direction}`);
    return world.split;
  },
  closePane: (id: string) => world.log.push(`close pane ${id}`),
}));
vi.mock("../../../state/palette-host", () => ({
  paletteHost: {
    notify: (text: string) => world.log.push(`host notify ${text}`),
    onEffect: async (effect: { kind: string }) => {
      world.log.push(`effect ${effect.kind}`);
    },
  },
}));
vi.mock("../../../state/recent", () => ({
  rememberSearch: (text: string) => world.log.push(`remember search ${text}`),
}));
vi.mock("../../../state/vault", () => ({
  createNote: async (name?: string, folder?: string) => {
    world.log.push(`create ${name} in ${folder ?? "-"}`);
    return world.created;
  },
}));
vi.mock("../../../ui/palette", () => ({
  startCommand: (entry: { id: string }) => world.log.push(`start ${entry.id}`),
  rememberCommand: (id: string) => world.log.push(`remember command ${id}`),
  scopeLabel: () => "legge · una nota",
}));

import { ASK_DELAY_MS, SLOW_AFTER_MS, mountLauncher, type Launcher } from "./launcher";
import { PREVIEW_DELAY_MS, PREVIEW_SLOW_MS } from "./preview";

const nothing = (note: string | null = null): Listing => ({ rows: [], note, total: null });
const listed = (rows: Row[], total: number | null = null): Listing => ({ rows, note: null, total });
const note = (doc: string, extra: Partial<Extract<Row, { kind: "note" }>> = {}): Row => ({
  kind: "note",
  key: `n:${doc}`,
  doc,
  recent: false,
  at: null,
  snippet: null,
  ...extra,
});
function command(id: string, binding: string | null, run: (() => void) | null = () => {}): CommandEntry {
  return { id, title: `Titolo ${id}`, description: `Descrizione ${id}`, layer: "global", binding, declared: binding, spec: null, run };
}

/// Una risposta che arriva quando lo dice il test.
function pending(): { promise: Promise<Listing>; land(value: Listing): void; fail(error: unknown): void } {
  let land!: (value: Listing) => void;
  let fail!: (error: unknown) => void;
  const promise = new Promise<Listing>((resolve, reject) => {
    land = resolve;
    fail = reject;
  });
  return { promise, land, fail };
}

/// Lascia arrivare ciò che è già deciso.
async function settle(): Promise<void> {
  for (let turn = 0; turn < 6; turn++) await Promise.resolve();
}

const surface = (): HTMLElement | null => document.querySelector(".launcher");
const field = (): HTMLInputElement => document.querySelector(".launcher-input") as HTMLInputElement;
const veil = (): HTMLElement => document.querySelector(".launcher-veil") as HTMLElement;
const titles = (): string[] => [...document.querySelectorAll(".launcher-row-title")].map((each) => each.textContent ?? "");
const selectedMode = (): string | null =>
  document.querySelector('.launcher-modes [role="tab"][aria-selected="true"]')?.textContent ?? null;
const said = (): string => document.querySelector(".launcher-note")?.textContent ?? "";
const counted = (): string => document.querySelector(".launcher-status")?.textContent ?? "";
const pane = (): HTMLElement => document.querySelector(".launcher-preview") as HTMLElement;
const page = (): HTMLElement => document.querySelector(".launcher-preview-page") as HTMLElement;
const paneSays = (): string => {
  const words = document.querySelector(".launcher-preview-note") as HTMLElement;
  return words.hidden ? "" : (words.textContent ?? "");
};
const toPanel = (): HTMLButtonElement => document.querySelector(".launcher-panel") as HTMLButtonElement;

/// La finestra, con le misure che happy-dom non cambia da sé.
function resizeTo(width: number, height: number): void {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true, writable: true });
  window.dispatchEvent(new Event("resize"));
}

function type(text: string): void {
  field().value = text;
  field().dispatchEvent(new Event("input", { bubbles: true }));
}

function run(id: string): void {
  void allCommands().find((entry) => entry.id === id)!.run!();
}

/// I due comandi come li dichiara la shell comune, prima che lo Scrittoio monti.
const common = { switcher: vi.fn(), palette: vi.fn() };
function declareCommon(): void {
  const declare = (id: ShellCommand["id"], title: ShellCommand["title"], runIt: () => void): void =>
    registerShellCommand({ id, title, description: title, layer: "global", run: runIt });
  declare("shell.switcher", "commands.switcher", common.switcher);
  declare("shell.palette", "commands.palette", common.palette);
}

let lifetime: Lifetime;
let launcher: Launcher;

beforeEach(() => {
  resetShellCommands();
  world.asked.length = 0;
  world.log.length = 0;
  world.notices.length = 0;
  world.windows = true;
  world.split = "p1";
  world.created = "Nuova.md";
  world.openFails = false;
  world.answer = () => nothing("niente");
  world.rendered.length = 0;
  world.render = async (doc) => ({ html: `<p>Resa di ${doc}</p>`, parts: [] });
  resizeTo(1280, 800);
  common.switcher.mockClear();
  common.palette.mockClear();
  document.body.innerHTML = '<button id="pill" type="button">Apri</button><button id="altrove" type="button">Altrove</button>';
  declareCommon();
  // Il fuoco è di qualcuno, come nella shell: è a lui che torna.
  document.getElementById("altrove")!.focus();
  lifetime = openLifetime();
  launcher = mountLauncher(lifetime);
});

afterEach(() => {
  lifetime.close();
  vi.useRealTimers();
  setMotionDriver(null);
  setMotionPreference("system");
  expect(world.languageListeners.size).toBe(0);
  document.body.replaceChildren();
});

describe("i comandi che lo aprono", () => {
  it("`shell.switcher` lo apre sui file e `shell.palette` sui comandi, senza chiamare i vecchi", () => {
    run("shell.switcher");
    expect(surface()).not.toBeNull();
    expect(selectedMode()).toBe("launcher.mode.files");
    expect(world.asked).toEqual([["files", ""]]);

    launcher.close();
    run("shell.palette");
    expect(selectedMode()).toContain("launcher.mode.commands");
    expect(common.switcher).not.toHaveBeenCalled();
    expect(common.palette).not.toHaveBeenCalled();
  });

  it("dai menu contestuali «Cerca fra tutti i comandi» apre i comandi con ciò che si è scritto, e smontato non risponde più", () => {
    showContextMenu(new MouseEvent("contextmenu", { clientX: 10, clientY: 10 }), [{ label: "Apri", run: () => {} }], { pointer: false });
    const foot = document.querySelector("#context-menu .menu-foot kbd");
    expect(foot?.textContent).toBe("Ctrl+Shift+P");
    for (const ch of "zz") document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true, cancelable: true }));
    document.querySelector<HTMLButtonElement>("#context-menu .menu-items [role=menuitem]")!.click();
    expect(selectedMode()).toContain("launcher.mode.commands");
    expect(world.asked[world.asked.length - 1]).toEqual(["commands", "zz"]);
    launcher.close();
    lifetime.close();
    showContextMenu(new MouseEvent("contextmenu", { clientX: 10, clientY: 10 }), [{ label: "Apri", run: () => {} }], { pointer: false });
    expect(document.querySelector("#context-menu .menu-foot kbd")).toBeNull();
    closeContextMenu();
    lifetime = openLifetime();
  });

  it("dai menu contestuali «Cerca nel vault» e i tag aprono la ricerca e i tag con il testo", () => {
    expect(menuFind("vault", "statistica")).toBe(true);
    expect(world.asked[world.asked.length - 1]).toEqual(["search", "statistica"]);
    expect(menuFind("tags", "esame")).toBe(true);
    expect(world.asked[world.asked.length - 1]).toEqual(["tags", "esame"]);
    launcher.close();
  });

  it("ognuno dei cinque suoi apre il suo modo", () => {
    const modes = { search: "search", headings: "headings", tags: "tags", line: "line", templates: "templates" };
    for (const [name, mode] of Object.entries(modes)) {
      world.asked.length = 0;
      run(`shell.launcher.${name}`);
      expect(world.asked[0]![0]).toBe(mode);
      launcher.close();
    }
  });

  it("un comando arrivato a lanciatore aperto cambia modo: la superficie resta una", () => {
    run("shell.switcher");
    const first = surface();
    run("shell.palette");
    expect(document.querySelectorAll(".launcher")).toHaveLength(1);
    expect(surface()).toBe(first);
    expect(selectedMode()).toContain("launcher.mode.commands");
    expect(document.activeElement).toBe(field());
  });

  it("i suoi comandi non hanno accordo, i due ridichiarati tengono quello di prima", () => {
    const entries = allCommands();
    for (const name of ["search", "headings", "tags", "line", "templates"]) {
      expect(entries.find((entry) => entry.id === `shell.launcher.${name}`)!.binding).toBeNull();
    }
    expect(entries.find((entry) => entry.id === "shell.switcher")!.binding).toBe("Mod-o");
    expect(entries.find((entry) => entry.id === "shell.palette")!.title).toBe("commands.palette");
  });
});

describe("il campo è un combobox, l'elenco un listbox", () => {
  it("dichiara chi controlla, se è aperto e qual è la riga attiva", () => {
    world.answer = () => listed([note("a/Uno.md"), note("Due.md")]);
    launcher.open("commands");
    const input = field();
    const list = document.querySelector(".launcher-list") as HTMLElement;
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-label")).toBe("launcher.field");
    expect(list.getAttribute("role")).toBe("listbox");
    expect(input.getAttribute("aria-controls")).toBe(list.id);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    const options = [...list.querySelectorAll('[role="option"]')];
    expect(options).toHaveLength(2);
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    expect(options[0]!.getAttribute("aria-selected")).toBe("true");

    press(input, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]!.id);
    expect(document.activeElement).toBe(input);
  });

  it("senza righe non è aperto, e la frase del vuoto è detta in una regione viva", () => {
    world.answer = () => nothing("launcher.note.commands.none");
    launcher.open("commands");
    expect(field().getAttribute("aria-expanded")).toBe("false");
    expect(field().hasAttribute("aria-activedescendant")).toBe(false);
    const empty = document.querySelector(".launcher-note") as HTMLElement;
    expect(empty.getAttribute("role")).toBe("status");
    expect(empty.hidden).toBe(false);
    expect(said()).toBe("launcher.note.commands.none");
    expect(counted()).toBe("");
  });

  it("il conto si dice: uno, tanti, una parte del totale", () => {
    world.answer = () => listed([note("Uno.md")]);
    launcher.open("commands");
    expect(counted()).toBe("launcher.status.one");
    expect((document.querySelector(".launcher-status") as HTMLElement).getAttribute("role")).toBe("status");

    world.answer = () => listed([note("Uno.md"), note("Due.md")]);
    type("x");
    expect(counted()).toBe('launcher.status.count {"count":2}');

    world.answer = () => listed([note("Uno.md"), note("Due.md")], 40);
    type("xy");
    expect(counted()).toBe('launcher.status.count_of {"count":2,"total":40}');
    expect(said()).toBe("");
  });

  it("la superficie è un dialogo con un nome, e la pillola dice che è aperto", () => {
    launcher.open("files");
    expect(surface()!.getAttribute("role")).toBe("dialog");
    expect(surface()!.getAttribute("aria-modal")).toBe("true");
    expect(surface()!.getAttribute("aria-label")).toBe("launcher.label");
    expect(document.getElementById("pill")!.getAttribute("aria-expanded")).toBe("true");
    launcher.close();
    expect(document.getElementById("pill")!.hasAttribute("aria-expanded")).toBe(false);
  });
});

describe("i modi", () => {
  it("il prefisso in testa cambia modo e non resta nella domanda", () => {
    launcher.open("files");
    type(">apri");
    expect(selectedMode()).toContain("launcher.mode.commands");
    expect(field().value).toBe("apri");
    expect(world.asked[world.asked.length - 1]).toEqual(["commands", "apri"]);

    type("@Titoli");
    expect(selectedMode()).toContain("launcher.mode.headings");
    expect(field().value).toBe("Titoli");
  });

  it("Tab va al modo dopo e Maiusc-Tab a quello prima, senza far uscire il fuoco", () => {
    launcher.open("files");
    const forward = press(field(), "Tab");
    expect(forward.defaultPrevented).toBe(true);
    expect(selectedMode()).toContain("launcher.mode.commands");
    press(field(), "Tab", { shiftKey: true });
    press(field(), "Tab", { shiftKey: true });
    expect(selectedMode()).toBe("launcher.mode.templates");
    expect(document.activeElement).toBe(field());
  });

  it("la fila è cliccabile, e porta scritto il prefisso di ogni modo", () => {
    launcher.open("files");
    const tabs = [...document.querySelectorAll<HTMLElement>('.launcher-modes [role="tab"]')];
    expect(tabs).toHaveLength(7);
    expect(tabs.map((tab) => tab.querySelector(".launcher-mode-prefix")?.textContent ?? "")).toEqual(["", ">", "?", "@", "#", ":", ""]);
    tabs[4]!.click();
    expect(selectedMode()).toContain("launcher.mode.tags");
    expect(world.asked[world.asked.length - 1]![0]).toBe("tags");
    expect(document.activeElement).toBe(field());
  });

  it("nessuna linguetta è una fermata del Tab: Tab qui cambia modo", () => {
    launcher.open("files");
    const stops = (): number[] => [...document.querySelectorAll<HTMLElement>('.launcher-modes [role="tab"]')].map((tab) => tab.tabIndex);
    expect(stops()).toEqual([-1, -1, -1, -1, -1, -1, -1]);
    press(field(), "Tab");
    expect(stops()).toEqual([-1, -1, -1, -1, -1, -1, -1]);
    (document.querySelectorAll<HTMLElement>('.launcher-modes [role="tab"]')[3] as HTMLElement).click();
    expect(stops()).toEqual([-1, -1, -1, -1, -1, -1, -1]);
  });

  it("il modo si dice: letto col campo, annunciato quando cambia", () => {
    launcher.open("files");
    const said = document.getElementById(field().getAttribute("aria-describedby") ?? "") as HTMLElement;
    expect(said.getAttribute("role")).toBe("status");
    expect(said.classList.contains("sr-only")).toBe(true);
    expect(said.textContent).toBe("launcher.mode.files");
    press(field(), "Tab");
    expect(said.textContent).toBe("launcher.mode.commands");
    type("?banco");
    expect(said.textContent).toBe("launcher.mode.search");
  });

  it("ogni modo ricorda la sua domanda, anche dopo una chiusura", () => {
    launcher.open("files");
    type("nota");
    press(field(), "Tab");
    expect(field().value).toBe("");
    type("apri");
    press(field(), "Tab", { shiftKey: true });
    expect(field().value).toBe("nota");
    // La domanda ritrovata è scelta tutta: scrivere la sostituisce.
    expect([field().selectionStart, field().selectionEnd]).toEqual([0, 4]);

    launcher.close();
    launcher.open("commands");
    expect(field().value).toBe("apri");
    expect(world.asked[world.asked.length - 1]).toEqual(["commands", "apri"]);
  });

  it("aprire con un testo chiede quello, e lo ricorda", () => {
    launcher.open("search", "banco");
    expect(field().value).toBe("banco");
    launcher.close();
    launcher.open("search");
    expect(field().value).toBe("banco");
  });

  it("cancellare a campo vuoto riporta ai file; con del testo cancella e basta", () => {
    launcher.open("commands");
    type("a");
    expect(press(field(), "Backspace").defaultPrevented).toBe(false);
    expect(selectedMode()).toContain("launcher.mode.commands");
    type("");
    expect(press(field(), "Backspace").defaultPrevented).toBe(true);
    expect(selectedMode()).toBe("launcher.mode.files");
  });

  it("il campo cambia invito e i tasti del piede col modo", () => {
    launcher.open("files");
    expect(field().placeholder).toBe("launcher.placeholder.files");
    const hints = (): string => document.querySelector(".launcher-hints")!.textContent ?? "";
    expect(hints()).toContain("launcher.hint.open");
    expect(hints()).toContain("launcher.hint.split");
    expect(hints()).toContain("launcher.hint.window");
    press(field(), "Tab");
    expect(field().placeholder).toBe("launcher.placeholder.commands");
    expect(hints()).toContain("launcher.hint.run");
    expect(hints()).not.toContain("launcher.hint.split");
  });

  it("dove c'è una finestra sola non la si offre", () => {
    world.windows = false;
    launcher.open("files");
    expect(document.querySelector(".launcher-hints")!.textContent).not.toContain("launcher.hint.window");
  });
});

describe("scegliere una riga", () => {
  beforeEach(() => {
    world.answer = () => listed([note("Guida/Uno.md"), note("Due.md")]);
  });

  it("Invio apre la riga attiva e chiude", async () => {
    launcher.open("commands");
    press(field(), "ArrowDown");
    press(field(), "Enter");
    await settle();
    expect(surface()).toBeNull();
    expect(world.log).toEqual(["open Due.md"]);
  });

  it("Mod-Invio divide il foglio a fuoco e apre lì", async () => {
    launcher.open("commands");
    press(field(), "Enter", { ctrlKey: true });
    await settle();
    expect(world.log).toEqual(["split p0 row", "open Guida/Uno.md"]);
  });

  it("una divisione che non apre richiude il riquadro, e il guasto si dice", async () => {
    world.openFails = true;
    launcher.open("commands");
    press(field(), "Enter", { metaKey: true });
    await settle();
    expect(world.log).toEqual(["split p0 row", "close pane p1"]);
    expect(world.notices).toEqual([{ text: 'launcher.failed {"reason":"disco pieno"}', tone: "guasto" }]);
  });

  it("Maiusc-Invio apre in una linguetta, senza dividere", async () => {
    launcher.open("commands");
    press(field(), "Enter", { shiftKey: true });
    await settle();
    expect(world.log).toEqual(["open Guida/Uno.md"]);
  });

  it("Alt-Invio apre una finestra, dove ce n'è più d'una", async () => {
    launcher.open("commands");
    press(field(), "Enter", { altKey: true });
    await settle();
    expect(world.log).toEqual(["window Guida/Uno.md"]);

    world.log.length = 0;
    world.windows = false;
    launcher.open("commands");
    press(field(), "Enter", { altKey: true });
    await settle();
    expect(world.log).toEqual(["open Guida/Uno.md"]);
  });

  it("un clic sulla riga la sceglie", async () => {
    launcher.open("commands");
    (document.querySelectorAll(".launcher-row")[1] as HTMLElement).click();
    await settle();
    expect(world.log).toEqual(["open Due.md"]);
    expect(surface()).toBeNull();
  });

  it("un risultato di ricerca si apre sul punto trovato, e la ricerca si ricorda", async () => {
    world.answer = () => listed([note("Uno.md", { at: 42, snippet: { text: "il banco vede", highlights: [{ start: 3, end: 8 }] } })]);
    launcher.open("commands");
    type("?banco");
    vi.useFakeTimers();
    type("banco ");
    vi.advanceTimersByTime(ASK_DELAY_MS);
    vi.useRealTimers();
    expect(document.querySelector(".launcher-row-detail mark")!.textContent).toBe("banco");
    press(field(), "Enter");
    await settle();
    expect(world.log).toEqual(["remember search banco ", "open Uno.md", "reveal Uno.md 42"]);
  });

  it("«Crea nota» crea, apre e porta il fuoco nell'editor", async () => {
    world.answer = () => listed([{ kind: "create", key: "create", name: "Idea nuova" }]);
    launcher.open("commands");
    expect(titles()).toEqual(['launcher.row.create {"name":"Idea nuova"}']);
    expect(counted()).toBe("launcher.status.create");
    press(field(), "Enter");
    await settle();
    expect(world.log).toEqual(["create Idea nuova in -", "open Nuova.md", "focus editor"]);
    expect(surface()).toBeNull();
  });

  it("una creazione rifiutata non apre niente", async () => {
    world.created = null;
    world.answer = () => listed([{ kind: "create", key: "create", name: "Idea" }]);
    launcher.open("commands");
    press(field(), "Enter");
    await settle();
    expect(world.log).toEqual(["create Idea in -"]);
  });

  it("un comando si avvia col modulo che esiste già; uno di shell si ricorda", async () => {
    const shell = command("shell.note.new", "Mod-N");
    const kernel = command("note.rename", null, null);
    kernel.spec = { id: "note.rename" } as CommandEntry["spec"];
    world.answer = () => listed([{ kind: "command", key: "c:1", entry: shell }, { kind: "command", key: "c:2", entry: kernel }]);
    launcher.open("commands");
    const rows = [...document.querySelectorAll<HTMLElement>(".launcher-row")];
    expect(rows[0]!.querySelector(".launcher-row-title")!.textContent).toBe("Titolo shell.note.new");
    expect(rows[0]!.querySelector(".launcher-row-detail")!.textContent).toBe("Descrizione shell.note.new");
    expect(rows[0]!.querySelector(".launcher-key")!.textContent).toBe("Ctrl+N");
    expect(rows[1]!.querySelector(".launcher-row-meta")!.textContent).toBe("legge · una nota");
    expect(rows[1]!.querySelector(".launcher-key")).toBeNull();

    press(field(), "Enter");
    expect(surface()).toBeNull();
    expect(world.log).toEqual(["remember command shell.note.new", "start shell.note.new"]);

    world.log.length = 0;
    launcher.open("commands");
    press(field(), "ArrowDown");
    press(field(), "Enter");
    expect(world.log).toEqual(["start note.rename"]);
  });

  it("un'etichetta porta alle sue note, e una ricerca recente torna nel campo: si resta aperti", () => {
    world.answer = () => listed([{ kind: "tag", key: "t:tema", name: "tema", count: 12 }]);
    launcher.open("tags");
    expect(titles()).toEqual(["#tema"]);
    press(field(), "Enter");
    expect(surface()).not.toBeNull();
    expect(selectedMode()).toContain("launcher.mode.search");
    expect(field().value).toBe("tag:#tema");

    world.answer = () => listed([{ kind: "query", key: "q:banco", query: "banco visivo" }]);
    type("");
    press(field(), "Enter");
    expect(field().value).toBe("banco visivo");
    expect(surface()).not.toBeNull();
  });

  it("un'intestazione e una riga portano il cursore nel punto", async () => {
    world.answer = () => listed([{ kind: "heading", key: "h:30", doc: "Uno.md", level: 3, text: "Riferimenti", at: 30 }]);
    launcher.open("commands");
    expect((document.querySelector(".launcher-row") as HTMLElement).style.getPropertyValue("--launcher-indent")).toBe("2");
    expect(document.querySelector(".launcher-row-meta")!.textContent).toBe("H3");
    press(field(), "Enter");
    await settle();
    expect(world.log).toEqual(["reveal Uno.md 30"]);

    world.log.length = 0;
    world.answer = () => listed([{ kind: "line", key: "line", doc: "Uno.md", line: 12, column: 5, lines: 67, at: 240 }]);
    launcher.open("line");
    expect(titles()).toEqual(['launcher.row.line_column {"line":12,"column":5}']);
    press(field(), "Enter");
    await settle();
    expect(world.log).toEqual(["reveal Uno.md 240"]);
  });

  it("un modello passa dal comando del kernel, e il suo effetto dalla shell", async () => {
    world.answer = () => listed([{ kind: "template", key: "m:1", doc: "Templates/Riunione.md" }]);
    launcher.open("templates");
    expect(titles()).toEqual(["Riunione"]);
    press(field(), "Enter");
    await settle();
    expect(world.log).toEqual([
      'invoke note.from_template {"template":"Templates/Riunione.md"}',
      "host notify fatto",
      "effect navigate",
    ]);
  });
});

describe("chiudere", () => {
  it("Esc chiude e restituisce il fuoco a chi l'aveva", () => {
    const elsewhere = document.getElementById("altrove")!;
    elsewhere.focus();
    launcher.open("files");
    expect(document.activeElement).toBe(field());
    const escape = press(field(), "Escape");
    expect(escape.defaultPrevented).toBe(true);
    expect(surface()).toBeNull();
    expect(document.querySelector(".launcher-layer")).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
    expect(launcher.isOpen).toBe(false);
  });

  it("senza nessuno a cui tornare il fuoco va all'editor", () => {
    (document.activeElement as HTMLElement | null)?.blur();
    launcher.open("files");
    press(field(), "Escape");
    expect(world.log).toEqual(["focus editor"]);
  });

  it("un Tab partito da fuori rientra nel campo, e non cambia modo", () => {
    launcher.open("files");
    const elsewhere = document.getElementById("altrove")!;
    elsewhere.focus();
    const tab = press(elsewhere, "Tab");
    expect(tab.defaultPrevented).toBe(true);
    expect(document.querySelector(".launcher")!.contains(document.activeElement)).toBe(true);
    expect(selectedMode()).toBe("launcher.mode.files");
  });

  it("Esc è di chi sta in cima: con una superficie sopra, il lanciatore resta", () => {
    launcher.open("files");
    const above = document.createElement("div");
    above.tabIndex = -1;
    document.body.append(above);
    const closeAbove = vi.fn();
    const release = trapFocus(above, closeAbove);
    press(above, "Escape");
    expect(closeAbove).toHaveBeenCalledTimes(1);
    expect(surface()).not.toBeNull();
    release();
    above.remove();
    press(field(), "Escape");
    expect(surface()).toBeNull();
  });

  it("un clic sul velo chiude; uno dentro la superficie no", () => {
    launcher.open("files");
    (document.querySelector(".launcher-foot") as HTMLElement).click();
    expect(surface()).not.toBeNull();
    veil().click();
    expect(surface()).toBeNull();
  });

  it("premere dentro la superficie non toglie il fuoco al campo", () => {
    launcher.open("files");
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    document.querySelector(".launcher-foot")!.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    const inField = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    field().dispatchEvent(inField);
    expect(inField.defaultPrevented).toBe(false);
  });

  it("una lingua che cambia lo chiude: riaperto parla quella nuova", () => {
    launcher.open("files");
    for (const listener of [...world.languageListeners]) listener();
    expect(surface()).toBeNull();
    expect(world.languageListeners.size).toBe(0);
  });
});

describe("le risposte che arrivano tardi", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("le battute si trattengono: una domanda sola per la parola finita", () => {
    launcher.open("files");
    world.asked.length = 0;
    type("n");
    type("no");
    type("not");
    expect(world.asked).toEqual([]);
    vi.advanceTimersByTime(ASK_DELAY_MS);
    expect(world.asked).toEqual([["files", "not"]]);
  });

  it("chi risponde subito non aspetta", () => {
    launcher.open("commands");
    world.asked.length = 0;
    type("a");
    expect(world.asked).toEqual([["commands", "a"]]);
  });

  it("una risposta vecchia non scrive sopra una più nuova", async () => {
    const first = pending();
    const second = pending();
    const answers: Answer[] = [nothing(), first.promise, second.promise];
    world.answer = () => answers.shift()!;
    launcher.open("files");
    type("a");
    vi.advanceTimersByTime(ASK_DELAY_MS);
    type("ab");
    vi.advanceTimersByTime(ASK_DELAY_MS);
    expect(world.asked).toEqual([["files", ""], ["files", "a"], ["files", "ab"]]);

    second.land(listed([note("Nuova risposta.md")]));
    await settle();
    expect(titles()).toEqual(["Nuova risposta"]);
    first.land(listed([note("Vecchia risposta.md")]));
    await settle();
    expect(titles()).toEqual(["Nuova risposta"]);
  });

  it("una risposta che arriva dopo la chiusura non tocca niente", async () => {
    const late = pending();
    world.answer = () => late.promise;
    launcher.open("files");
    launcher.close();
    late.land(listed([note("Tardi.md")]));
    await settle();
    expect(document.querySelector(".launcher-row")).toBeNull();
  });

  it("una sorgente lenta lo dice, senza cambiare ciò che c'è", async () => {
    const slow = pending();
    const answers: Answer[] = [listed([note("Prima.md")]), slow.promise];
    world.answer = () => answers.shift()!;
    launcher.open("files");
    await settle();
    expect(titles()).toEqual(["Prima"]);
    const wait = document.querySelector(".launcher-wait") as HTMLElement;
    expect(wait).not.toBeNull();
    expect(surface()!.hasAttribute("data-busy")).toBe(false);

    type("p");
    vi.advanceTimersByTime(ASK_DELAY_MS + SLOW_AFTER_MS - 1);
    expect(surface()!.hasAttribute("data-busy")).toBe(false);
    vi.advanceTimersByTime(1);
    expect(surface()!.hasAttribute("data-busy")).toBe(true);
    expect(counted()).toBe("launcher.status.waiting");
    // Le righe di prima restano dove sono finché arriva la risposta.
    expect(titles()).toEqual(["Prima"]);
    expect(document.querySelector(".launcher-wait")).toBe(wait);
    // Un elenco pieno non lascia il posto alla sagoma.
    expect(document.querySelector(".launcher-results .skeleton")).toBeNull();

    slow.land(listed([note("Poi.md"), note("Poi ancora.md")]));
    await settle();
    expect(surface()!.hasAttribute("data-busy")).toBe(false);
    expect(titles()).toEqual(["Poi", "Poi ancora"]);
    expect(counted()).toBe('launcher.status.count {"count":2}');
  });

  it("una prima risposta lenta mostra la sagoma delle righe, e la toglie quando arriva", async () => {
    const slow = pending();
    world.answer = () => slow.promise;
    launcher.open("files");
    await settle();
    expect(document.querySelector(".launcher-results .skeleton")).toBeNull();
    vi.advanceTimersByTime(ASK_DELAY_MS + SLOW_AFTER_MS);
    const shape = document.querySelector(".launcher-results .skeleton");
    expect(shape).not.toBeNull();
    expect(shape!.getAttribute("aria-hidden")).toBe("true");

    slow.land(listed([note("Poi.md")]));
    await settle();
    expect(document.querySelector(".launcher-results .skeleton")).toBeNull();
    expect(titles()).toEqual(["Poi"]);
  });

  it("una sorgente che fallisce lo dice al posto delle righe", async () => {
    const broken = pending();
    const answers: Answer[] = [listed([note("Prima.md")]), broken.promise];
    world.answer = () => answers.shift()!;
    launcher.open("files");
    await settle();
    type("x");
    vi.advanceTimersByTime(ASK_DELAY_MS);
    broken.fail(new Error("indice chiuso"));
    await settle();
    expect(titles()).toEqual([]);
    expect(said()).toBe('launcher.failed {"reason":"indice chiuso"}');
    expect(document.querySelector(".launcher-note")!.hasAttribute("data-failed")).toBe(true);
    expect(field().getAttribute("aria-expanded")).toBe("false");
  });

  it("un Invio dato prima della risposta apre la prima riga giusta, non quella vecchia", async () => {
    const coming = pending();
    const answers: Answer[] = [listed([note("Vecchia.md")]), coming.promise];
    world.answer = () => answers.shift()!;
    launcher.open("files");
    await settle();
    type("nuo");
    press(field(), "Enter", { ctrlKey: true });
    // L'Invio non aspetta il ritardo delle battute: la domanda parte subito.
    expect(world.asked[world.asked.length - 1]).toEqual(["files", "nuo"]);
    expect(world.log).toEqual([]);
    coming.land(listed([note("Nuova.md"), note("Altra.md")]));
    await settle();
    expect(world.log).toEqual(["split p0 row", "open Nuova.md"]);
    expect(surface()).toBeNull();
  });

  it("un Invio dato alla cieca non crea una nota", async () => {
    const coming = pending();
    const answers: Answer[] = [listed([note("Vecchia.md")]), coming.promise];
    world.answer = () => answers.shift()!;
    launcher.open("files");
    await settle();
    type("idea");
    press(field(), "Enter");
    coming.land(listed([{ kind: "create", key: "create", name: "idea" }]));
    await settle();
    expect(world.log).toEqual([]);
    expect(surface()).not.toBeNull();
    // Vista la riga, il secondo Invio la crea.
    press(field(), "Enter");
    await settle();
    expect(world.log[0]).toBe("create idea in -");
  });
});

describe("la corsa dalla pillola", () => {
  const PILL = { left: 430, top: 6, width: 420, height: 28 };
  const PLACE = { left: 320, top: 48, width: 640, height: 452 };

  function fakeBoxes(): void {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const box = this.id === "pill" ? PILL : this.classList.contains("launcher") ? PLACE : { left: 0, top: 0, width: 1280, height: 800 };
      return { ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => box } as DOMRect;
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /// Le due scale di ogni fotogramma di una corsa: una sola misura per i due
  /// assi vuol dire che niente, lì dentro, si vede schiacciato.
  function scales(keyframes: readonly Keyframe[]): [number, number][] {
    return keyframes.flatMap((frame) => {
      const found = /scale\(([\d.]+), ([\d.]+)\)/.exec(String(frame.transform ?? ""));
      return found ? [[Number(found[1]), Number(found[2])] as [number, number]] : [];
    });
  }

  it("esce dalla pillola intera: larga quanto lei, e mai schiacciata", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    setMotionPreference("system");
    fakeBoxes();
    launcher.open("commands");
    const grown = driver.plays.find((play) => play.el === surface())!;
    const first = grown.keyframes[0]!;
    // Con l'origine nell'angolo comincia dove comincia la pillola, larga
    // quanto lei, ed è ancora trasparente.
    expect(String(first.transform)).toContain(`translate(${PILL.left - PLACE.left}px, ${PILL.top - PLACE.top}px)`);
    expect(first.opacity).toBe(0);
    const all = scales(grown.keyframes);
    // Il moto scrive le scale con quattro decimali.
    expect(all[0]![0]).toBeCloseTo(PILL.width / PLACE.width, 3);
    expect(all.length).toBeGreaterThan(4);
    for (const [wide, tall] of all) expect(tall).toBe(wide);
    // Ciò che sta dentro non ha una corsa sua: si muove con la superficie.
    expect(driver.plays.every((play) => play.el === surface() || play.el === veil())).toBe(true);
    expect(driver.plays.some((play) => play.el === veil())).toBe(true);

    driver.advance(2000);
    expect(activeMotions()).toBe(0);
    expect(surface()!.getAttribute("style")).toBeNull();
    expect(veil().getAttribute("style")).toBeNull();
  });

  it("chiudendo torna alla pillola un'immagine: la superficie vera è già via", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    setMotionPreference("system");
    fakeBoxes();
    launcher.open("files");
    driver.advance(2000);
    const before = driver.plays.length;
    launcher.close();
    expect(document.querySelector(".launcher-layer")).toBeNull();
    const ghost = document.querySelector("body > .launcher") as HTMLElement;
    expect(ghost).not.toBeNull();
    expect(ghost.hasAttribute("inert")).toBe(true);
    expect(ghost.querySelector("[id]")).toBeNull();
    const leaving = driver.plays.slice(before).find((play) => play.el === ghost)!;
    const end = String(leaving.keyframes[leaving.keyframes.length - 1]!.transform);
    expect(end).toContain(`translate(${PILL.left - PLACE.left}px, ${PILL.top - PLACE.top}px)`);
    // Anche tornando la misura è una sola: l'immagine rimpicciolisce intera.
    const all = scales(leaving.keyframes);
    expect(all[all.length - 1]![0]).toBeCloseTo(PILL.width / PLACE.width, 3);
    for (const [wide, tall] of all) expect(tall).toBe(wide);

    driver.advance(2000);
    expect(document.querySelector(".launcher")).toBeNull();
    expect(document.querySelector(".launcher-veil")).toBeNull();
    expect(activeMotions()).toBe(0);
  });

  it("si vede subito: l'opacità arriva prima della misura", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    setMotionPreference("system");
    fakeBoxes();
    launcher.open("commands");
    const grown = driver.plays.find((play) => play.el === surface())!;
    // A un decimo di secondo (sei campioni) la superficie è quasi piena,
    // mentre la scala è ancora in viaggio.
    const early = grown.keyframes[6]!;
    expect(Number(early.opacity)).toBeGreaterThan(0.8);
    expect(scales([early])[0]![0]).toBeLessThan(0.9);
  });

  it("riaperto a metà dell'uscita non resta niente di troppo", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    setMotionPreference("system");
    fakeBoxes();
    launcher.open("files");
    launcher.close();
    launcher.open("commands");
    driver.advance(2000);
    expect(document.querySelectorAll(".launcher")).toHaveLength(1);
    expect(document.querySelectorAll(".launcher-veil")).toHaveLength(1);
    expect(surface()!.closest(".launcher-layer")).not.toBeNull();
  });

  it("col moto ridotto resta una dissolvenza, e lo stato finale è lo stesso", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    setMotionPreference("reduced");
    fakeBoxes();
    launcher.open("files");
    for (const play of driver.plays) {
      for (const frame of play.keyframes) expect(frame.transform ?? "none").toBe("none");
    }
    driver.advance(2000);
    expect(surface()!.getAttribute("style")).toBeNull();
    launcher.close();
    expect(document.querySelector(".launcher")).toBeNull();
    expect(document.querySelector(".launcher-veil")).toBeNull();
  });

  it("senza una pillola da cui partire entra lo stesso", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    setMotionPreference("system");
    document.getElementById("pill")!.remove();
    launcher.open("files");
    expect(surface()).not.toBeNull();
    driver.advance(2000);
    launcher.close();
    driver.advance(2000);
    expect(document.querySelector(".launcher")).toBeNull();
  });
});

describe("l'anteprima accanto all'elenco", () => {
  /// Una resa che arriva quando lo dice il test.
  function rendering(): { promise: Promise<{ html: string; parts: [] }>; land(html: string): void; fail(): void } {
    let land!: (html: string) => void;
    let fail!: () => void;
    const promise = new Promise<{ html: string; parts: [] }>((resolve, reject) => {
      land = (html) => resolve({ html, parts: [] });
      fail = () => reject(new Error("provider caduto"));
    });
    return { promise, land, fail };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    world.answer = () => listed([note("a/Uno.md"), note("Due.md")]);
  });

  it("nel modo dei file mostra la nota della riga attiva, dopo un momento", async () => {
    launcher.open("files");
    expect(surface()!.hasAttribute("data-preview")).toBe(true);
    expect(pane().hidden).toBe(false);
    vi.advanceTimersByTime(PREVIEW_DELAY_MS - 1);
    expect(world.rendered).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(world.rendered).toEqual(["a/Uno.md"]);
    await settle();
    expect(page().textContent).toBe("Resa di a/Uno.md");
    expect(paneSays()).toBe("");

    press(field(), "ArrowDown");
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    await settle();
    expect(world.rendered).toEqual(["a/Uno.md", "Due.md"]);
    expect(page().textContent).toBe("Resa di Due.md");
  });

  it("chi scorre in fretta non fa partire una resa per riga", async () => {
    world.answer = () => listed([note("Uno.md"), note("Due.md"), note("Tre.md")]);
    launcher.open("files");
    press(field(), "ArrowDown");
    vi.advanceTimersByTime(PREVIEW_DELAY_MS - 10);
    press(field(), "ArrowDown");
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    await settle();
    expect(world.rendered).toEqual(["Tre.md"]);
    expect(page().textContent).toBe("Resa di Tre.md");
  });

  it("una resa superata da una riga più nuova non si disegna", async () => {
    const first = rendering();
    const second = rendering();
    world.render = (doc) => (doc === "a/Uno.md" ? first.promise : second.promise);
    launcher.open("files");
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    press(field(), "ArrowDown");
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    expect(world.rendered).toEqual(["a/Uno.md", "Due.md"]);

    second.land("<p>La seconda</p>");
    await settle();
    expect(page().textContent).toBe("La seconda");
    first.land("<p>La prima, in ritardo</p>");
    await settle();
    expect(page().textContent).toBe("La seconda");
  });

  it("finché la resa nuova non arriva resta quella di prima, e se tarda si attenua", async () => {
    const slow = rendering();
    world.render = async (doc) => (doc === "Due.md" ? slow.promise : { html: "<p>Subito</p>", parts: [] });
    launcher.open("files");
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    await settle();
    expect(page().textContent).toBe("Subito");

    press(field(), "ArrowDown");
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    await settle();
    expect(page().textContent).toBe("Subito");
    expect(pane().hasAttribute("data-waiting")).toBe(false);
    vi.advanceTimersByTime(PREVIEW_SLOW_MS);
    expect(pane().hasAttribute("data-waiting")).toBe(true);

    slow.land("<p>Infine</p>");
    await settle();
    expect(page().textContent).toBe("Infine");
    expect(pane().hasAttribute("data-waiting")).toBe(false);
  });

  it("la prima resa che tarda mostra lo scheletro di una pagina, e lo toglie quando arriva", async () => {
    const slow = rendering();
    world.render = async () => slow.promise;
    launcher.open("files");
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    await settle();
    expect(page().querySelector(".skeleton")).toBeNull();
    vi.advanceTimersByTime(PREVIEW_SLOW_MS);
    expect(page().querySelector(".skeleton")).not.toBeNull();
    expect(pane().hasAttribute("data-waiting")).toBe(true);

    slow.land("<p>Infine</p>");
    await settle();
    expect(page().querySelector(".skeleton")).toBeNull();
    expect(page().textContent).toBe("Infine");
  });

  it("una resa che non riesce è una frase nel riquadro, non un avviso", async () => {
    world.render = () => Promise.reject(new Error("provider caduto"));
    launcher.open("files");
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    await settle();
    expect(page().childNodes).toHaveLength(0);
    expect(paneSays()).toBe("launcher.preview.failed");
    expect(world.notices).toEqual([]);
    expect(surface()).not.toBeNull();

    // La riga dopo si rende, e la frase se ne va.
    world.render = async () => ({ html: "<p>Questa sì</p>", parts: [] });
    press(field(), "ArrowDown");
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    await settle();
    expect(page().textContent).toBe("Questa sì");
    expect(paneSays()).toBe("");
  });

  it("una nota senza niente dentro lo dice", async () => {
    world.render = async () => ({ html: "<p> </p>", parts: [] });
    launcher.open("files");
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    await settle();
    expect(paneSays()).toBe("launcher.preview.empty");
  });

  it("ciò che arriva passa dal varco dell'HTML", async () => {
    world.render = async () => ({ html: '<p onclick="x()">Testo</p><script>window.rotto = true</script>', parts: [] });
    launcher.open("files");
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    await settle();
    expect(page().querySelector("script")).toBeNull();
    expect(page().querySelector("p")!.hasAttribute("onclick")).toBe(false);
    expect(page().textContent).toBe("Testo");
  });

  it("è uno sguardo: inerte, fuori dall'albero, e il fuoco resta nel campo", async () => {
    world.render = async () => ({ html: '<p><a href="#altrove">Un collegamento</a></p>', parts: [] });
    launcher.open("files");
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    await settle();
    expect(pane().getAttribute("aria-hidden")).toBe("true");
    expect(pane().hasAttribute("inert")).toBe(true);
    expect(pane().hasAttribute("tabindex")).toBe(false);
    expect(document.activeElement).toBe(field());
    // Tab continua a cambiare modo, non entra nel riquadro.
    press(field(), "Tab");
    expect(selectedMode()).toContain("launcher.mode.commands");
    expect(document.activeElement).toBe(field());
  });

  it("la riga «Crea nota» non ha una nota da mostrare: il riquadro resta, vuoto", async () => {
    launcher.open("files");
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    await settle();
    expect(page().textContent).toBe("Resa di a/Uno.md");

    world.answer = () => listed([{ kind: "create", key: "create", name: "Nuova" }]);
    type("Nuova");
    vi.advanceTimersByTime(ASK_DELAY_MS);
    await settle();
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    expect(world.rendered).toEqual(["a/Uno.md"]);
    expect(page().childNodes).toHaveLength(0);
    expect(surface()!.hasAttribute("data-preview")).toBe(true);
    expect(pane().hidden).toBe(false);
  });

  it("dentro il modo la superficie non cambia misura, con esiti o senza", async () => {
    launcher.open("files");
    const wide = (): boolean => surface()!.hasAttribute("data-preview");
    expect(wide()).toBe(true);
    world.answer = () => nothing("niente");
    type("zzz");
    vi.advanceTimersByTime(ASK_DELAY_MS);
    await settle();
    expect(wide()).toBe(true);
    world.answer = () => listed([note("Zeta.md")]);
    type("zeta");
    vi.advanceTimersByTime(ASK_DELAY_MS);
    await settle();
    expect(wide()).toBe(true);
  });

  it("nei modi senza una nota da mostrare il riquadro non c'è", async () => {
    for (const mode of ["commands", "search", "headings", "tags", "line", "templates"] as const) {
      launcher.open(mode);
      expect(surface()!.hasAttribute("data-preview")).toBe(false);
      expect(pane().hidden).toBe(true);
    }
    // Nemmeno le note trovate da una ricerca la fanno partire.
    launcher.open("search", "mela");
    await settle();
    vi.advanceTimersByTime(PREVIEW_DELAY_MS + PREVIEW_SLOW_MS);
    expect(world.rendered).toEqual([]);
  });

  it("passando dai file a un altro modo e tornando, riparte dalla riga attiva", async () => {
    launcher.open("files");
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    await settle();
    press(field(), "Tab");
    expect(pane().hidden).toBe(true);
    expect(page().childNodes).toHaveLength(0);
    press(field(), "Tab", { shiftKey: true });
    expect(pane().hidden).toBe(false);
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    await settle();
    expect(world.rendered).toEqual(["a/Uno.md", "a/Uno.md"]);
    expect(page().textContent).toBe("Resa di a/Uno.md");
  });

  it("in una finestra stretta non c'è, e torna quando la finestra si allarga", async () => {
    resizeTo(800, 500);
    launcher.open("files");
    expect(surface()!.hasAttribute("data-preview")).toBe(false);
    expect(pane().hidden).toBe(true);
    vi.advanceTimersByTime(PREVIEW_DELAY_MS + PREVIEW_SLOW_MS);
    expect(world.rendered).toEqual([]);

    resizeTo(1280, 800);
    expect(surface()!.hasAttribute("data-preview")).toBe(true);
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    await settle();
    expect(page().textContent).toBe("Resa di a/Uno.md");

    resizeTo(800, 500);
    expect(pane().hidden).toBe(true);
    expect(page().childNodes).toHaveLength(0);
  });

  it("chiuso, una resa ancora in arrivo non tocca più niente", async () => {
    const late = rendering();
    world.render = () => late.promise;
    launcher.open("files");
    vi.advanceTimersByTime(PREVIEW_DELAY_MS);
    const kept = page();
    launcher.close();
    late.land("<p>Troppo tardi</p>");
    await settle();
    expect(kept.childNodes).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("«Apri nel pannello», dal modo Cerca", () => {
  const carried: string[] = [];
  let withdraw: () => void;

  /// La shell comune come la vede il lanciatore: la porta della ricerca, che
  /// riempie la casella, e il comando che mostra il pannello e ci porta il fuoco.
  function declarePanel(): void {
    registerShellCommand({
      id: "shell.panel.search",
      title: "commands.panel.search",
      description: "commands.panel.search.desc",
      layer: "global",
      run: () => {
        world.log.push("show panel");
        const input = document.getElementById("search-input") as HTMLInputElement;
        input.focus();
        input.select();
      },
    });
  }

  beforeEach(() => {
    carried.length = 0;
    state.vaultRoot = "/vault";
    const input = document.createElement("input");
    input.id = "search-input";
    document.body.append(input);
    withdraw = setSearchPort({
      searchFor: (query) => {
        carried.push(query);
        input.value = query;
      },
    });
    declarePanel();
    world.answer = (mode) => (mode === "search" ? listed([note("Mele.md", { at: 12 })]) : listed([note("Uno.md")]));
  });

  afterEach(() => {
    withdraw();
    state.vaultRoot = "";
  });

  it("il controllo c'è solo nel modo Cerca, e porta scritto il suo accordo", () => {
    launcher.open("files");
    expect(toPanel().hidden).toBe(true);
    press(field(), "Tab");
    expect(toPanel().hidden).toBe(true);
    launcher.open("search", "mela");
    const button = toPanel();
    expect(button.hidden).toBe(false);
    expect(button.disabled).toBe(false);
    expect(button.closest(".launcher-foot")).not.toBeNull();
    expect(button.textContent).toContain("launcher.panel");
    expect(button.querySelector("kbd")!.textContent).toContain("Shift");
    expect(button.querySelector("kbd")!.textContent).toContain("↵");
    expect(button.getAttribute("aria-keyshortcuts")).toMatch(/^(Control|Meta)\+Shift\+Enter$/);
    // Tab qui cambia modo: il controllo non è una sua fermata.
    expect(button.tabIndex).toBe(-1);
  });

  it("senza una domanda è spento ma resta al suo posto", () => {
    launcher.open("search");
    expect(toPanel().hidden).toBe(false);
    expect(toPanel().disabled).toBe(true);
    type("mela");
    expect(toPanel().disabled).toBe(false);
    type("   ");
    expect(toPanel().disabled).toBe(true);
    expect(toPanel().hidden).toBe(false);
  });

  it("premuto porta la domanda nella casella del pannello, chiude e lascia lì il fuoco", async () => {
    launcher.open("search", "  mela verde ");
    toPanel().click();
    await settle();
    expect(surface()).toBeNull();
    expect(carried).toEqual(["mela verde"]);
    const input = document.getElementById("search-input") as HTMLInputElement;
    expect(input.value).toBe("mela verde");
    expect(document.activeElement).toBe(input);
    expect(world.log).toEqual(["show panel"]);
    expect(world.notices).toEqual([]);
  });

  it("l'accordo fa lo stesso, e non sceglie la riga attiva", async () => {
    launcher.open("search", "mela");
    await settle();
    expect(titles()).toEqual(["Mele"]);
    const pressed = press(field(), "Enter", { ctrlKey: true, shiftKey: true });
    await settle();
    expect(pressed.defaultPrevented).toBe(true);
    expect(surface()).toBeNull();
    expect(carried).toEqual(["mela"]);
    expect(document.activeElement).toBe(document.getElementById("search-input"));
    // Nessuna nota aperta, nessun riquadro diviso.
    expect(world.log).toEqual(["show panel"]);
  });

  it("senza una domanda l'accordo non fa niente: né porta, né apre", async () => {
    world.answer = () => listed([{ kind: "query", key: "q:pere", query: "pere" }]);
    launcher.open("search");
    await settle();
    const pressed = press(field(), "Enter", { ctrlKey: true, shiftKey: true });
    await settle();
    expect(pressed.defaultPrevented).toBe(true);
    expect(surface()).not.toBeNull();
    expect(carried).toEqual([]);
    expect(world.log).toEqual([]);
    expect(field().value).toBe("");
  });

  it("fuori dal modo Cerca lo stesso accordo resta quello di sempre", async () => {
    launcher.open("files");
    await settle();
    press(field(), "Enter", { ctrlKey: true, shiftKey: true });
    await settle();
    expect(carried).toEqual([]);
    expect(world.log).toEqual(["split p0 row", "open Uno.md"]);
  });

  it("senza un vault, o senza il comando del pannello, è spento e l'accordo non porta niente", async () => {
    state.vaultRoot = "";
    launcher.open("search", "mela");
    expect(toPanel().disabled).toBe(true);
    launcher.close();

    state.vaultRoot = "/vault";
    resetShellCommands();
    lifetime.close();
    lifetime = openLifetime();
    launcher = mountLauncher(lifetime);
    launcher.open("search", "mela");
    expect(toPanel().disabled).toBe(true);
    press(field(), "Enter", { ctrlKey: true, shiftKey: true });
    await settle();
    expect(surface()).not.toBeNull();
    expect(carried).toEqual([]);
  });

  it("se il pannello non si apre lo dice un avviso, e il lanciatore è già chiuso", async () => {
    registerShellCommand({
      id: "shell.panel.search",
      title: "commands.panel.search",
      description: "commands.panel.search.desc",
      layer: "global",
      run: () => {
        throw new Error("pannello smontato");
      },
    });
    launcher.open("search", "mela");
    toPanel().click();
    await settle();
    expect(surface()).toBeNull();
    expect(world.notices).toHaveLength(1);
    expect(world.notices[0]!.tone).toBe("guasto");
  });
});

describe("smontato", () => {
  it("aperto o chiuso non lascia nodi né ascoltatori", () => {
    lifetime.close();
    resetShellCommands();
    declareCommon();
    const live = listenerLedger(document, window, document.body);
    lifetime = openLifetime();
    launcher = mountLauncher(lifetime);
    launcher.open("files");
    launcher.close();
    launcher.open("commands");
    expect(surface()).not.toBeNull();

    lifetime.close();
    expect(document.querySelector(".launcher-layer")).toBeNull();
    expect(document.querySelector(".launcher")).toBeNull();
    expect(document.querySelector(".launcher-veil")).toBeNull();
    expect(live()).toBe(0);
    expect(world.languageListeners.size).toBe(0);
    expect(document.getElementById("pill")!.hasAttribute("aria-expanded")).toBe(false);
    expect(launcher.isOpen).toBe(false);
  });

  it("non lascia un'immagine a metà corsa", () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    setMotionPreference("system");
    launcher.open("files");
    lifetime.close();
    expect(document.querySelector(".launcher")).toBeNull();
    expect(activeMotions()).toBe(0);
  });

  it("ritira i suoi comandi e rimette quelli della shell comune", () => {
    lifetime.close();
    const ids = allCommands().map((entry) => entry.id);
    expect(ids.filter((id) => id.startsWith("shell.launcher."))).toEqual([]);
    expect(ids).toEqual(["shell.switcher", "shell.palette"]);

    run("shell.switcher");
    run("shell.palette");
    expect(common.switcher).toHaveBeenCalledTimes(1);
    expect(common.palette).toHaveBeenCalledTimes(1);
    expect(surface()).toBeNull();
    const palette = allCommands().find((entry) => entry.id === "shell.palette")!;
    expect(palette.title).toBe("commands.palette");
    expect(palette.layer).toBe("global");
  });

  it("dove la shell comune non li aveva dichiarati non ne lascia", () => {
    lifetime.close();
    resetShellCommands();
    lifetime = openLifetime();
    launcher = mountLauncher(lifetime);
    expect(allCommands().map((entry) => entry.id)).toContain("shell.switcher");
    lifetime.close();
    expect(allCommands()).toEqual([]);
  });

  it("una dichiarazione arrivata dopo la sua resta dov'è", () => {
    const newer = vi.fn();
    registerShellCommand({ id: "shell.switcher", title: "commands.switcher", description: "commands.switcher.desc", layer: "global", run: newer });
    lifetime.close();
    run("shell.switcher");
    expect(newer).toHaveBeenCalledTimes(1);
    expect(common.switcher).not.toHaveBeenCalled();
  });

  it("dopo lo smontaggio non si apre più", () => {
    lifetime.close();
    launcher.open("files");
    expect(surface()).toBeNull();
  });
});
