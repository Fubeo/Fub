// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftInfo } from "../../../host/contract";
import { listenerLedger, press } from "../../../kit/testing";
import { activeMotions, createManualDriver, setMotionDriver, setMotionPreference, type ManualDriver } from "../../../moto";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";

type Entry = { id: string; title: string; binding: string | null; spec: null; run: (() => void) | null };

/// Lo stato finto della shell: ciò che i moduli veri direbbero.
const world = vi.hoisted(() => ({
  commands: [] as { id: string; title: string; binding: string | null; spec: null; run: (() => void) | null }[],
  recent: null as null | (() => Promise<string[]>),
  existing: null as null | ((docs: string[]) => Promise<Set<string>>),
  drafts: null as null | (() => Promise<unknown[]>),
  health: null as null | (() => Promise<{ items: { doc: string; detail: string | null }[] }>),
  dirty: new Set<string>(),
  state: { vaultRoot: "/vault", meta: { pinned: [] as string[] } },
  signals: new Map<string, Set<(...args: never[]) => void>>(),
  sessions: new Set<(event: { kind: string; id: string }) => void>(),
  languages: new Set<() => void>(),
  language: "it",
  log: [] as string[],
  layout: { focus: "p1" },
  open: null as null | ((doc: string) => Promise<void>),
  notices: [] as { message: string; tone: string }[],
  host: { marker: "palette-host" },
}));

vi.mock("../../../host/query", () => ({
  existingDocuments: (docs: string[]) => world.existing!(docs),
  unsavedDrafts: () => world.drafts!(),
  vaultHealth: () => world.health!(),
}));
vi.mock("../launcher/sources", () => ({ TEMPLATE_COMMAND: "note.from_template" }));
vi.mock("../../../state/recent", () => ({
  existingRecentNotes: () => world.recent!(),
}));
vi.mock("../../../state/document-controller", () => ({
  openDocument: (doc: string) => world.open!(doc),
}));
vi.mock("../../../state/document-session", () => ({
  documentSessions: {
    get: (doc: string) => (world.dirty.has(doc) ? { dirty: true } : undefined),
    subscribe: (listener: (event: { kind: string; id: string }) => void) => {
      world.sessions.add(listener);
      return () => void world.sessions.delete(listener);
    },
  },
}));
vi.mock("../../../state/layout", () => ({
  layout: world.layout,
  focusPane: (pane: string) => {
    world.log.push(`focus ${pane}`);
    world.layout.focus = pane;
  },
}));
vi.mock("../../../state/palette-host", () => ({ paletteHost: world.host }));
vi.mock("../../../state/store", () => ({
  state: world.state,
  on: (signal: string, listener: (...args: never[]) => void) => {
    const set = world.signals.get(signal) ?? new Set();
    world.signals.set(signal, set);
    set.add(listener);
    return () => void set.delete(listener);
  },
}));
vi.mock("../../../ui/commands", () => ({
  allCommands: () => world.commands,
  displayBinding: (binding: string | null) => binding ?? "",
}));
vi.mock("../../../ui/palette", () => ({
  startCommand: (entry: { id: string }, host: unknown) =>
    void world.log.push(`start ${entry.id}${host === world.host ? "" : " (altro host)"}`),
}));
vi.mock("../../../ui/notify", () => ({
  notify: (message: string, tone: string) => void world.notices.push({ message, tone }),
}));
vi.mock("../../../i18n/strings", () => ({
  t: (key: string, args?: Record<string, string>) =>
    `${world.language}:${key}${args ? ` ${Object.values(args).join(" | ")}` : ""}`,
  onLanguage: (listener: () => void) => {
    world.languages.add(listener);
    return () => void world.languages.delete(listener);
  },
}));
vi.mock("../../../ui/tooltip", () => ({ setTooltip: () => {}, attachTooltip: () => () => {} }));
vi.mock("../../../ui/icons", () => ({ iconEl: () => null }));

import { mountDesk } from "./desk";

let driver: ManualDriver;
let lifetime: Lifetime;
let panes: HTMLElement;
let asked: { recent: number; existing: string[][]; drafts: number };

const entry = (id: string, title: string, binding: string | null = null): Entry => ({
  id,
  title,
  binding,
  spec: null,
  run: id.startsWith("shell.") ? () => {} : null,
});

/// Ciò che fa `drawEmptyPane` della vista: rifà da capo titolo e gesti.
function redraw(part: HTMLElement): void {
  const title = document.createElement("p");
  title.className = "pane-empty-title";
  title.textContent = "pane.empty.title";
  const actions = document.createElement("div");
  actions.className = "pane-empty-actions";
  actions.append(document.createElement("button"));
  part.replaceChildren(title, actions);
}

/// Un riquadro com'è scritto dalla vista, col suo vuoto.
function pane(id: string, empty = true): HTMLElement {
  const root = document.createElement("section");
  root.className = "pane";
  root.dataset.pane = id;
  const part = document.createElement("div");
  part.className = "pane-empty";
  part.hidden = !empty;
  if (empty) redraw(part);
  root.append(part);
  panes.append(root);
  return part;
}

function emit(signal: string): void {
  for (const listener of [...(world.signals.get(signal) ?? [])]) (listener as () => void)();
}

const draft = (doc: string, more: Partial<DraftInfo> = {}): DraftInfo =>
  ({ doc, at: 1, base: "7", exists: true, current: "7", text: "testo", ...more }) as DraftInfo;

const deskOf = (part: HTMLElement): HTMLElement | null => part.querySelector<HTMLElement>(":scope > .sheet-desk");
const buttons = (part: HTMLElement): HTMLButtonElement[] => [
  ...part.querySelectorAll<HTMLButtonElement>(".sheet-desk button"),
];
const keys = (part: HTMLElement): string[] => buttons(part).map((button) => button.dataset.key ?? "");
const byKey = (part: HTMLElement, key: string): HTMLButtonElement =>
  buttons(part).find((button) => button.dataset.key === key)!;
const groups = (part: HTMLElement): HTMLElement[] => [...part.querySelectorAll<HTMLElement>(".sheet-desk-group")];
const labelOf = (group: HTMLElement): string =>
  document.getElementById(group.getAttribute("aria-labelledby") ?? "")?.textContent ?? "";

/// Gli osservatori consegnano a fine giro; le promesse pure.
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  driver = createManualDriver();
  setMotionDriver(driver);
  asked = { recent: 0, existing: [], drafts: 0 };
  world.commands = [
    entry("shell.note.new", "Nuova nota", "Ctrl+N"),
    entry("shell.switcher", "Vai a…", "Ctrl+O"),
  ];
  world.recent = async () => (asked.recent++, []);
  world.existing = async (docs) => (asked.existing.push(docs), new Set(docs));
  world.drafts = async () => (asked.drafts++, []);
  world.health = async () => ({ items: [] });
  world.dirty = new Set();
  world.state.vaultRoot = "/vault";
  world.state.meta.pinned = [];
  world.signals = new Map();
  world.sessions = new Set();
  world.languages = new Set();
  world.language = "it";
  world.log = [];
  world.layout.focus = "p1";
  world.open = async (doc) => void world.log.push(`open ${doc}`);
  world.notices = [];
  document.body.innerHTML = '<div id="panes"></div>';
  panes = document.getElementById("panes")!;
  lifetime = openLifetime();
});

afterEach(() => {
  lifetime.close();
  driver.advance(5000);
  expect(activeMotions()).toBe(0);
  setMotionDriver(null);
  setMotionPreference("system");
  document.body.innerHTML = "";
});

describe("la scrivania: ciò che offre", () => {
  it("mette i gesti per cominciare nel riquadro vuoto, nell'ordine in cui si leggono", async () => {
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();

    expect(deskOf(part)).not.toBeNull();
    expect(keys(part)).toEqual(["command:shell.note.new", "command:shell.switcher"]);
    expect(buttons(part).map((button) => button.textContent)).toEqual([
      "it:commands.note.new (Ctrl+N)",
      "it:pane.empty.open (Ctrl+O)",
    ]);
    const bar = part.querySelector<HTMLElement>(".sheet-desk-actions")!;
    expect(bar.getAttribute("role")).toBe("group");
    expect(bar.getAttribute("aria-label")).toBe("it:sheet.desk.actions");
  });

  it("offre la nota del giorno soltanto se il registro ha il comando", async () => {
    world.commands.push(entry("note.daily", "Nota del giorno"));
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();

    expect(keys(part)).toEqual(["command:shell.note.new", "command:note.daily", "command:shell.switcher"]);
    expect(byKey(part, "command:note.daily").textContent).toBe("Nota del giorno");
  });

  it("tiene un solo titolo, quello della vista, e gruppi con la loro etichetta", async () => {
    world.recent = async () => ["Diario/Lunedì.md", "Idee.md"];
    world.state.meta.pinned = ["Progetti/Fub.md"];
    world.drafts = async () => [draft("Bozza.md")];
    world.dirty.add("Bozza.md");
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();

    const headings = part.querySelectorAll('[role="heading"], h1, h2, h3, h4, h5, h6');
    expect(headings).toHaveLength(1);
    expect(headings[0]).toBe(part.querySelector(".pane-empty-title"));
    expect(headings[0]!.getAttribute("aria-level")).toBe("2");

    expect(groups(part).map((group) => group.getAttribute("role"))).toEqual(["group", "group", "group"]);
    expect(groups(part).map(labelOf)).toEqual([
      "it:sheet.desk.drafts",
      "it:sheet.desk.recent",
      "it:explorer.pinned",
    ]);
    expect(keys(part).slice(2)).toEqual([
      "draft:Bozza.md",
      "recent:Diario/Lunedì.md",
      "recent:Idee.md",
      "pinned:Progetti/Fub.md",
    ]);
    // Il nome della pagina, e accanto la cartella quando ce n'è una.
    expect(byKey(part, "recent:Diario/Lunedì.md").textContent).toBe("LunedìDiario");
    expect(byKey(part, "recent:Idee.md").textContent).toBe("Idee");
    // La bozza dice che cosa c'è da decidere.
    expect(byKey(part, "draft:Bozza.md").textContent).toBe("Bozzait:draft.case.intatta");
  });

  it("non mostra un gruppo senza righe", async () => {
    world.recent = async () => ["Idee.md"];
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();

    expect(groups(part).map(labelOf)).toEqual(["it:sheet.desk.recent"]);
  });

  it("riprende poche note, e delle appuntate solo quelle che esistono", async () => {
    world.recent = async () => ["1.md", "2.md", "3.md", "4.md", "5.md", "6.md", "7.md", "8.md"];
    world.state.meta.pinned = ["C'è.md", "Cestinata.md"];
    world.existing = async (docs) => (asked.existing.push(docs), new Set(["C'è.md"]));
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();

    expect(keys(part).filter((key) => key.startsWith("recent:"))).toHaveLength(6);
    expect(keys(part).filter((key) => key.startsWith("pinned:"))).toEqual(["pinned:C'è.md"]);
    expect(asked.existing).toEqual([["C'è.md", "Cestinata.md"]]);
  });

  it("elenca solo le bozze che si recuperano aprendole", async () => {
    world.drafts = async () => [
      draft("Rientrata.md", { at: 5 }),
      draft("Vuota.md", { text: "  " }),
      draft("Mai rientrata.md"),
      draft("Nuova.md", { at: 9, exists: false, base: null }),
    ];
    world.dirty = new Set(["Rientrata.md", "Vuota.md", "Nuova.md"]);
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();

    // Dalla più recente; la vuota non è da recuperare, e quella che non è
    // rientrata in un buffer non avrebbe niente da mostrare.
    expect(keys(part).filter((key) => key.startsWith("draft:"))).toEqual(["draft:Nuova.md", "draft:Rientrata.md"]);
    expect(byKey(part, "draft:Nuova.md").textContent).toBe("Nuovait:draft.case.nuova");
  });

  it("offre «da un modello» soltanto se il registro ha il comando", async () => {
    world.commands.push(entry("note.from_template", "Nuova nota da modello"));
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();

    expect(keys(part)).toEqual(["command:shell.note.new", "command:note.from_template", "command:shell.switcher"]);
  });

  it("dice quali note hanno collegamenti rotti: la destinazione se è una, il conto se sono di più", async () => {
    world.health = async () => ({
      items: [
        { doc: "Sola.md", detail: "Assente" },
        { doc: "Doppia.md", detail: "Uno" },
        { doc: "Doppia.md", detail: "Due" },
      ],
    });
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();

    expect(groups(part).map(labelOf)).toEqual(["it:sheet.desk.health"]);
    expect(keys(part).filter((key) => key.startsWith("health:"))).toEqual(["health:Sola.md", "health:Doppia.md"]);
    expect(byKey(part, "health:Sola.md").textContent).toBe("Solait:sheet.desk.health_one Assente");
    expect(byKey(part, "health:Doppia.md").textContent).toBe("Doppiait:sheet.desk.health_many 2");
    byKey(part, "health:Doppia.md").click();
    expect(world.log).toContain("open Doppia.md");
  });

  it("elenca poche note da sistemare", async () => {
    world.health = async () => ({ items: ["1", "2", "3", "4", "5", "6", "7"].map((n) => ({ doc: `${n}.md`, detail: n })) });
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();

    expect(keys(part).filter((key) => key.startsWith("health:"))).toHaveLength(5);
  });

  it("un indice che non risponde sulla salute non toglie le altre sorgenti", async () => {
    world.health = async () => {
      throw new Error("indice assente");
    };
    world.recent = async () => ["Idee.md"];
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();

    expect(groups(part).map(labelOf)).toEqual(["it:sheet.desk.recent"]);
  });

  it("senza un riquadro vuoto a schermo non chiede niente", async () => {
    const part = pane("p1", false);
    mountDesk(lifetime);
    await settled();
    emit("active-doc");
    emit("documents");
    emit("organization");
    await settled();

    expect(deskOf(part)).toBeNull();
    expect(asked).toEqual({ recent: 0, existing: [], drafts: 0 });
  });

  it("una fonte che non risponde non toglie le altre", async () => {
    world.recent = async () => {
      throw new Error("indice assente");
    };
    world.state.meta.pinned = ["Fub.md"];
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();

    expect(groups(part).map(labelOf)).toEqual(["it:explorer.pinned"]);
  });
});

describe("la scrivania: i gesti", () => {
  it("un gesto porta il fuoco sul suo riquadro e avvia il comando dalla strada di tutti", async () => {
    world.commands.push(entry("note.daily", "Nota del giorno"));
    pane("p1");
    const part = pane("p2");
    mountDesk(lifetime);
    await settled();

    byKey(part, "command:note.daily").click();
    byKey(part, "command:shell.switcher").click();

    expect(world.log).toEqual(["focus p2", "start note.daily", "focus p2", "start shell.switcher"]);
  });

  it("un comando sparito dal registro non parte", async () => {
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();
    const button = byKey(part, "command:shell.note.new");
    world.commands = [];

    button.click();

    expect(world.log).toEqual([]);
  });

  it("una riga apre la sua nota nel riquadro della scrivania", async () => {
    world.recent = async () => ["Diario/Lunedì.md"];
    pane("p1");
    const part = pane("p2");
    mountDesk(lifetime);
    await settled();

    byKey(part, "recent:Diario/Lunedì.md").click();
    await settled();

    expect(world.log).toEqual(["focus p2", "open Diario/Lunedì.md"]);
    expect(world.notices).toEqual([]);
  });

  it("un'apertura che fallisce lo dice", async () => {
    world.recent = async () => ["Idee.md"];
    world.open = async () => {
      throw new Error("non c'è più");
    };
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();

    byKey(part, "recent:Idee.md").click();
    await settled();

    expect(world.notices).toEqual([{ message: "it:preview.open_failed Idee.md | non c'è più", tone: "guasto" }]);
  });

  it("le frecce scorrono tutto ciò che si può premere", async () => {
    world.recent = async () => ["A.md", "B.md"];
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();
    const all = buttons(part);
    all[0]!.focus();

    press(all[0]!, "ArrowDown");
    expect(document.activeElement).toBe(all[1]);
    press(all[1]!, "End");
    expect(document.activeElement).toBe(all[3]);
    press(all[3]!, "ArrowDown");
    expect(document.activeElement).toBe(all[3]);
    press(all[3]!, "ArrowUp");
    expect(document.activeElement).toBe(all[2]);
    press(all[2]!, "Home");
    expect(document.activeElement).toBe(all[0]);
  });
});

describe("la scrivania: il vuoto è della vista", () => {
  it("dopo un ridisegno della vista torna lo stesso nodo, e il titolo resta titolo", async () => {
    world.recent = async () => ["Idee.md"];
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();
    const desk = deskOf(part)!;
    const before = buttons(part);

    redraw(part);
    await settled();

    expect(deskOf(part)).toBe(desk);
    expect(part.lastElementChild).toBe(desk);
    expect(buttons(part)).toEqual(before);
    expect(part.querySelector(".pane-empty-title")!.getAttribute("role")).toBe("heading");
    expect(part.querySelectorAll(".sheet-desk")).toHaveLength(1);
  });

  /// Ciò che fa il browser quando la vista stacca un nodo col fuoco dentro: il
  /// fuoco se ne va **prima** che il nodo esca dal documento, nello stesso giro.
  function redrawFocused(part: HTMLElement, focused: HTMLElement): void {
    focused.blur();
    redraw(part);
  }

  it("chi era su una riga ritrova il fuoco quando la vista stacca la scrivania", async () => {
    world.recent = async () => ["Idee.md"];
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();
    const row = byKey(part, "recent:Idee.md");
    row.focus();

    redrawFocused(part, row);
    expect(document.activeElement).not.toBe(row);
    await settled();

    expect(document.activeElement).toBe(row);
  });

  it("non riprende il fuoco a chi se n'era andato prima del ridisegno", async () => {
    world.recent = async () => ["Idee.md"];
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();
    const row = byKey(part, "recent:Idee.md");
    row.focus();
    row.blur();
    await settled();

    redraw(part);
    await settled();

    expect(document.activeElement).not.toBe(row);
  });

  it("non riprende il fuoco quando il riquadro col fuoco è diventato un altro", async () => {
    world.recent = async () => ["Idee.md"];
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();
    const row = byKey(part, "recent:Idee.md");
    row.focus();

    // Si sta premendo in un altro riquadro: il layout ha già spostato il fuoco.
    world.layout.focus = "p2";
    redrawFocused(part, row);
    await settled();

    expect(document.activeElement).not.toBe(row);
  });

  it("una pressione su un bottone non arriva al riquadro finché non è un clic", async () => {
    world.recent = async () => ["Idee.md"];
    world.layout.focus = "p1";
    const part = pane("p2");
    mountDesk(lifetime);
    await settled();
    const row = byKey(part, "recent:Idee.md");
    // Ciò che fa la vista: toccare un riquadro gli dà il fuoco, e lo ridisegna.
    const root = part.parentElement!;
    const touched: string[] = [];
    root.addEventListener("mousedown", () => touched.push("mousedown"));
    root.addEventListener("focusin", () => touched.push("focusin"));

    row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    row.focus();
    expect(touched).toEqual([]);
    expect(world.log).toEqual([]);

    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    row.click();
    await settled();

    // Il fuoco al riquadro lo dà il gesto, prima di aprire.
    expect(world.log).toEqual(["focus p2", "open Idee.md"]);

    // Fuori dalla pressione il riquadro sente di nuovo tutto.
    row.blur();
    row.focus();
    expect(touched).toEqual(["focusin"]);
  });

  it("una pressione sul vuoto della scrivania arriva al riquadro come sempre", async () => {
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();
    let touched = 0;
    part.parentElement!.addEventListener("mousedown", () => touched++);

    deskOf(part)!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

    expect(touched).toBe(1);
  });

  it("non riscrive ciò che non è cambiato", async () => {
    world.recent = async () => ["Idee.md"];
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();
    const before = buttons(part);
    let writes = 0;
    const observer = new MutationObserver((records) => (writes += records.length));
    observer.observe(part, { childList: true, subtree: true, attributes: true });

    emit("active-doc");
    emit("commands");
    await settled();
    await settled();

    expect(writes).toBe(0);
    expect(buttons(part)).toEqual(before);
    observer.disconnect();
  });

  it("un riquadro che si riempie non si porta dietro niente; quando si svuota la scrivania torna", async () => {
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();
    const round = asked.recent;

    part.hidden = true;
    await settled();
    emit("active-doc");
    await settled();
    expect(asked.recent).toBe(round);

    world.recent = async () => (asked.recent++, ["Idee.md"]);
    part.hidden = false;
    redraw(part);
    await settled();
    await settled();

    expect(asked.recent).toBe(round + 1);
    expect(keys(part)).toContain("recent:Idee.md");
  });

  it("segue un riquadro nuovo e lascia andare quello che non c'è più", async () => {
    const first = pane("p1");
    mountDesk(lifetime);
    await settled();
    const gone = deskOf(first)!;

    first.parentElement!.remove();
    const second = pane("p2");
    await settled();

    expect(gone.isConnected).toBe(false);
    expect(deskOf(second)).not.toBeNull();
    byKey(second, "command:shell.note.new").click();
    expect(world.log).toEqual(["focus p2", "start shell.note.new"]);
  });
});

describe("la scrivania: i dati che cambiano", () => {
  it("più segnali nello stesso giro fanno una domanda sola", async () => {
    pane("p1");
    mountDesk(lifetime);
    await settled();
    const round = asked.recent;

    emit("active-doc");
    emit("documents");
    emit("organization");
    await settled();

    expect(asked.recent).toBe(round + 1);
    expect(asked.drafts).toBe(round + 1);
  });

  it("le appuntate seguono l'organizzazione", async () => {
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();
    expect(groups(part)).toHaveLength(0);

    world.state.meta.pinned = ["Fub.md"];
    emit("organization");
    await settled();

    expect(keys(part)).toContain("pinned:Fub.md");
  });

  it("una bozza elencata che viene salvata non è più da recuperare", async () => {
    world.drafts = async () => (asked.drafts++, [draft("Bozza.md")]);
    world.dirty.add("Bozza.md");
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();
    expect(keys(part)).toContain("draft:Bozza.md");
    const round = asked.drafts;

    // Il salvataggio di un'altra nota non riguarda la scrivania.
    for (const listener of world.sessions) listener({ kind: "saved", id: "Altra.md" });
    await settled();
    expect(asked.drafts).toBe(round);

    world.drafts = async () => (asked.drafts++, []);
    for (const listener of world.sessions) listener({ kind: "saved", id: "Bozza.md" });
    await settled();

    expect(asked.drafts).toBe(round + 1);
    expect(keys(part)).not.toContain("draft:Bozza.md");
  });

  it("un comando che arriva dopo compare", async () => {
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();

    world.commands = [...world.commands, entry("note.daily", "Nota del giorno")];
    emit("commands");

    expect(keys(part)).toContain("command:note.daily");
  });

  it("al cambio di lingua riscrive le etichette e chi era dentro ci resta", async () => {
    world.recent = async () => ["Idee.md"];
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();
    byKey(part, "recent:Idee.md").focus();

    world.language = "en";
    for (const listener of world.languages) listener();

    expect(groups(part).map(labelOf)).toEqual(["en:sheet.desk.recent"]);
    expect(byKey(part, "command:shell.note.new").textContent).toBe("en:commands.note.new (Ctrl+N)");
    expect(document.activeElement).toBe(byKey(part, "recent:Idee.md"));
  });
});

describe("la scrivania: le corse", () => {
  it("una risposta vecchia non scrive sopra quella nuova", async () => {
    const slow = deferred<string[]>();
    world.recent = () => slow.promise;
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();

    world.recent = async () => ["Nuova.md"];
    emit("active-doc");
    await settled();
    expect(keys(part)).toContain("recent:Nuova.md");

    slow.resolve(["Vecchia.md"]);
    await settled();

    expect(keys(part)).toContain("recent:Nuova.md");
    expect(keys(part)).not.toContain("recent:Vecchia.md");
  });

  it("al cambio di vault le righe di prima spariscono subito e la risposta in volo non le riporta", async () => {
    world.recent = async () => ["Di prima.md"];
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();
    expect(keys(part)).toContain("recent:Di prima.md");

    const slow = deferred<string[]>();
    world.recent = () => slow.promise;
    emit("active-doc");
    await settled();

    world.state.vaultRoot = "/altro";
    const next = deferred<string[]>();
    world.recent = () => next.promise;
    emit("vault");
    expect(groups(part)).toHaveLength(0);

    slow.resolve(["Di prima.md"]);
    await settled();
    expect(groups(part)).toHaveLength(0);

    next.resolve(["Del nuovo.md"]);
    await settled();
    expect(keys(part)).toContain("recent:Del nuovo.md");
  });

  it("una risposta arrivata dopo lo smontaggio non disegna niente", async () => {
    const slow = deferred<string[]>();
    world.recent = () => slow.promise;
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();

    lifetime.close();
    slow.resolve(["Tardi.md"]);
    await settled();

    expect(part.querySelector(".sheet-desk")).toBeNull();
  });

  it("un'apertura che fallisce dopo lo smontaggio non avvisa nessuno", async () => {
    const slow = deferred<void>();
    world.recent = async () => ["Idee.md"];
    world.open = () => slow.promise;
    const part = pane("p1");
    mountDesk(lifetime);
    await settled();
    byKey(part, "recent:Idee.md").click();

    lifetime.close();
    slow.reject(new Error("tardi"));
    await settled();

    expect(world.notices).toEqual([]);
  });
});

describe("la scrivania: lo smontaggio", () => {
  it("non lascia niente: né nodi, né ascolti, né iscrizioni", async () => {
    const part = pane("p1");
    const listening = listenerLedger(document, window, panes, part);
    world.recent = async () => ["Idee.md"];
    mountDesk(lifetime);
    await settled();
    expect(deskOf(part)).not.toBeNull();

    lifetime.close();

    expect(part.querySelector(".sheet-desk")).toBeNull();
    const title = part.querySelector(".pane-empty-title")!;
    expect(title.hasAttribute("role")).toBe(false);
    expect(title.hasAttribute("aria-level")).toBe(false);
    expect(listening()).toBe(0);
    expect([...world.signals.values()].every((set) => set.size === 0)).toBe(true);
    expect(world.sessions.size).toBe(0);
    expect(world.languages.size).toBe(0);
    vi.restoreAllMocks();

    // La vista continua a ridisegnare: nessuno rimette la scrivania.
    redraw(part);
    await settled();
    expect(part.querySelector(".sheet-desk")).toBeNull();
  });

  it("senza i fogli non monta niente", () => {
    document.body.innerHTML = "";
    mountDesk(lifetime);

    expect(world.signals.size).toBe(0);
    expect(world.sessions.size).toBe(0);
  });
});
