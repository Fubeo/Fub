// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listenerLedger, press } from "../../../kit/testing";
import { activeMotions, createManualDriver, setMotionDriver, setMotionPreference, type ManualDriver } from "../../../moto";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";

type RenameOutcome = { kind: "renamed" | "already-renamed" | "missing" | "collision"; from: string; to: string };

/// Lo stato finto della shell: ciò che i moduli veri direbbero.
const world = vi.hoisted(() => ({
  docs: {} as Record<string, string | null>,
  flush: null as null | (() => Promise<string[]>),
  rename: null as null | ((from: string, to: string) => Promise<RenameOutcome>),
  notices: [] as { message: string; tone: string }[],
  tips: new Map<Element, string>(),
  languages: new Set<() => void>(),
}));

vi.mock("../../../state/layout", () => ({
  activeDoc: (pane: string) => world.docs[pane] ?? null,
}));
vi.mock("../../../state/document-session", () => ({
  flushPendingSave: () => world.flush!(),
  renameKeepingBuffer: (from: string, to: string) => world.rename!(from, to),
}));
vi.mock("../../../ui/notify", () => ({
  notify: (message: string, tone: string) => void world.notices.push({ message, tone }),
}));
vi.mock("../../../i18n/strings", () => ({
  t: (key: string, args?: Record<string, string>) => (args ? `${key} ${Object.values(args).join(" | ")}` : key),
  onLanguage: (listener: () => void) => {
    world.languages.add(listener);
    return () => void world.languages.delete(listener);
  },
}));
vi.mock("../../../ui/tooltip", () => ({
  setTooltip: (el: HTMLElement, text: string) => void world.tips.set(el, text),
  attachTooltip: () => () => {},
}));
vi.mock("../../../ui/icons", () => ({ iconEl: () => null }));

import { mountTitleRename } from "./title-rename";

let driver: ManualDriver;
let lifetime: Lifetime;
let panes: HTMLElement;

/// Una testata com'è scritta dalla vista: percorso, stato, menu.
function pane(id: string, doc: string | null, text = doc ?? ""): HTMLElement {
  world.docs[id] = doc;
  const root = document.createElement("section");
  root.className = "pane";
  root.dataset.pane = id;
  const bar = document.createElement("div");
  bar.className = "pane-toolbar";
  bar.setAttribute("role", "toolbar");
  const crumb = document.createElement("span");
  crumb.className = "muted";
  crumb.textContent = text;
  const menu = document.createElement("button");
  menu.dataset.paneMenu = "";
  bar.append(crumb, menu);
  root.append(bar);
  panes.append(root);
  return bar;
}

/// Ciò che fa `drawToolbar` della vista col titolo: riscrive il testo.
function redraw(bar: HTMLElement, path: string): void {
  crumbOf(bar).textContent = path;
}

const crumbOf = (bar: HTMLElement): HTMLElement => bar.querySelector<HTMLElement>(":scope > .muted")!;
const inputOf = (bar: HTMLElement): HTMLInputElement | null => bar.querySelector<HTMLInputElement>(".sheet-title-edit input");
const note = (): HTMLElement | null => document.querySelector<HTMLElement>(".kit-popover .sheet-title-error");

/// Gli osservatori consegnano a fine giro; le promesse pure.
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function dblclick(target: HTMLElement): void {
  target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 }));
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/// Una promessa che si scioglie quando lo dice il banco.
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let renames: { from: string; to: string }[];
let flushes: number;

beforeEach(() => {
  driver = createManualDriver();
  setMotionDriver(driver);
  world.docs = {};
  world.notices = [];
  world.tips = new Map();
  renames = [];
  flushes = 0;
  world.flush = () => {
    flushes += 1;
    return Promise.resolve([]);
  };
  world.rename = (from, to) => {
    renames.push({ from, to });
    return Promise.resolve({ kind: "renamed", from, to });
  };
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

describe("il titolo che si può premere", () => {
  it("il titolo di un documento prende ruolo, fuoco e nome; quello di una vista resta testo", () => {
    const doc = pane("main", "Guida/Nota.md");
    const view = pane("side", null, "Grafo");
    const empty = pane("empty", null);
    mountTitleRename(lifetime);
    const title = crumbOf(doc);
    expect(title.getAttribute("role")).toBe("button");
    expect(title.tabIndex).toBe(0);
    expect(title.getAttribute("aria-label")).toBe("sheet.title.button Guida/Nota.md");
    expect(world.tips.get(title)).toBe("sheet.title.hint Guida/Nota.md");
    for (const other of [view, empty]) {
      expect(crumbOf(other).hasAttribute("role")).toBe(false);
      expect(crumbOf(other).hasAttribute("tabindex")).toBe(false);
    }
  });

  it("segue la vista quando il foglio passa a un altro documento, o a una vista", async () => {
    const bar = pane("main", "Guida/Nota.md");
    mountTitleRename(lifetime);
    world.docs.main = "Altra.md";
    redraw(bar, "Altra.md");
    await settled();
    expect(crumbOf(bar).getAttribute("aria-label")).toBe("sheet.title.button Altra.md");
    world.docs.main = null;
    redraw(bar, "Grafo");
    await settled();
    expect(crumbOf(bar).hasAttribute("role")).toBe(false);
    expect(crumbOf(bar).hasAttribute("aria-label")).toBe(false);
    expect(world.tips.get(crumbOf(bar))).toBe("Grafo");
  });

  it("veste anche la testata di un foglio nato dopo", async () => {
    mountTitleRename(lifetime);
    const bar = pane("main", "Guida/Nota.md");
    await settled();
    expect(crumbOf(bar).getAttribute("role")).toBe("button");
  });

  it("non riscrive ciò che non è cambiato", async () => {
    const bar = pane("main", "Guida/Nota.md");
    mountTitleRename(lifetime);
    const seen: MutationRecord[] = [];
    const watch = new MutationObserver((records) => seen.push(...records));
    watch.observe(crumbOf(bar), { attributes: true });
    redraw(bar, "Guida/Nota.md");
    await settled();
    await settled();
    watch.disconnect();
    expect(seen).toEqual([]);
  });
});

describe("aprire il campo", () => {
  it("il doppio clic mette al posto del titolo un campo col nome della pagina, selezionato", () => {
    const bar = pane("main", "Guida/Nota.md");
    mountTitleRename(lifetime);
    dblclick(crumbOf(bar));
    const input = inputOf(bar)!;
    expect(input.value).toBe("Nota");
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(4);
    expect(crumbOf(bar).hidden).toBe(true);
    expect(crumbOf(bar).nextElementSibling!.className).toBe("sheet-title-edit");
    const label = bar.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`)!;
    expect(label.textContent).toBe("sheet.title.field Nota");
  });

  it("F2 col fuoco sul titolo apre il campo; F2 altrove no", () => {
    const bar = pane("main", "Guida/Nota.md");
    mountTitleRename(lifetime);
    press(bar.querySelector("button")!, "F2");
    expect(inputOf(bar)).toBeNull();
    crumbOf(bar).focus();
    const event = press(crumbOf(bar), "F2");
    expect(event.defaultPrevented).toBe(true);
    expect(inputOf(bar)).not.toBeNull();
  });

  it("Invio e Spazio premono il titolo: un clic ciascuno, e il campo si apre", () => {
    const bar = pane("main", "Guida/Nota.md");
    mountTitleRename(lifetime);
    for (const key of ["Enter", " "]) {
      let clicks = 0;
      const count = (): void => void (clicks += 1);
      document.addEventListener("click", count, true);
      crumbOf(bar).focus();
      press(crumbOf(bar), key);
      document.removeEventListener("click", count, true);
      expect(clicks).toBe(1);
      expect(inputOf(bar)).not.toBeNull();
      press(inputOf(bar)!, "Escape");
      expect(inputOf(bar)).toBeNull();
    }
  });

  it("un clic del puntatore non rinomina, e il titolo di una vista non si apre", () => {
    const bar = pane("main", "Guida/Nota.md");
    const view = pane("side", null, "Grafo");
    mountTitleRename(lifetime);
    crumbOf(bar).dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(inputOf(bar)).toBeNull();
    dblclick(crumbOf(view));
    press(crumbOf(view), "F2");
    expect(inputOf(view)).toBeNull();
  });

  it("un campo solo alla volta", () => {
    const first = pane("main", "Guida/Nota.md");
    const second = pane("side", "Altra.md");
    mountTitleRename(lifetime);
    dblclick(crumbOf(first));
    dblclick(crumbOf(second));
    expect(inputOf(first)).toBeNull();
    expect(crumbOf(first).hidden).toBe(false);
    expect(inputOf(second)!.value).toBe("Altra");
  });
});

describe("rinominare", () => {
  it("Invio mette in salvo il testo e rinomina per la strada della sessione: stessa cartella, stessa estensione", async () => {
    const bar = pane("main", "Guida/Nota.md");
    mountTitleRename(lifetime);
    dblclick(crumbOf(bar));
    type(inputOf(bar)!, "  Appunti  ");
    press(inputOf(bar)!, "Enter");
    await settled();
    expect(flushes).toBe(1);
    expect(renames).toEqual([{ from: "Guida/Nota.md", to: "Guida/Appunti.md" }]);
    expect(inputOf(bar)).toBeNull();
    expect(crumbOf(bar).hidden).toBe(false);
    expect(document.activeElement).toBe(crumbOf(bar));
    expect(world.notices).toEqual([]);
  });

  it("Esc annulla senza chiamare nessuno, e il fuoco torna al titolo", async () => {
    const bar = pane("main", "Guida/Nota.md");
    mountTitleRename(lifetime);
    dblclick(crumbOf(bar));
    type(inputOf(bar)!, "Appunti");
    const event = press(inputOf(bar)!, "Escape");
    await settled();
    expect(event.defaultPrevented).toBe(true);
    expect(inputOf(bar)).toBeNull();
    expect(crumbOf(bar).hidden).toBe(false);
    expect(document.activeElement).toBe(crumbOf(bar));
    expect(flushes).toBe(0);
    expect(renames).toEqual([]);
  });

  it("la perdita del fuoco annulla senza chiamare nessuno", async () => {
    const bar = pane("main", "Guida/Nota.md");
    mountTitleRename(lifetime);
    dblclick(crumbOf(bar));
    type(inputOf(bar)!, "Appunti");
    bar.querySelector<HTMLElement>("button")!.focus();
    await settled();
    expect(inputOf(bar)).toBeNull();
    expect(crumbOf(bar).hidden).toBe(false);
    expect(flushes).toBe(0);
    expect(renames).toEqual([]);
  });

  it("un nome vuoto o uguale non fa nessuna chiamata", async () => {
    const bar = pane("main", "Guida/Nota.md");
    mountTitleRename(lifetime);
    for (const name of ["", "   ", "Nota", " Nota "]) {
      dblclick(crumbOf(bar));
      type(inputOf(bar)!, name);
      press(inputOf(bar)!, "Enter");
      await settled();
      expect(inputOf(bar)).toBeNull();
    }
    expect(flushes).toBe(0);
    expect(renames).toEqual([]);
  });

  it("un nome che non si può usare resta nel campo, col perché sotto e legato al campo", async () => {
    const bar = pane("main", "Guida/Nota.md");
    mountTitleRename(lifetime);
    dblclick(crumbOf(bar));
    type(inputOf(bar)!, "Che: cosa?");
    press(inputOf(bar)!, "Enter");
    await settled();
    const input = inputOf(bar)!;
    expect(input.value).toBe("Che: cosa?");
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(note()!.textContent).toBe("explorer.bad_name Che: cosa? | name_fault.reserved");
    expect(input.getAttribute("aria-describedby")).toBe(note()!.id);
    expect(note()!.closest(".kit-popover")!.getAttribute("role")).toBe("alert");
    expect(flushes).toBe(0);
    expect(renames).toEqual([]);
    // Si corregge: il messaggio se ne va, e il nome buono passa.
    type(input, "Che cosa");
    expect(note()).toBeNull();
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(input.hasAttribute("aria-describedby")).toBe(false);
    press(input, "Enter");
    await settled();
    expect(renames).toEqual([{ from: "Guida/Nota.md", to: "Guida/Che cosa.md" }]);
  });

  it("un rifiuto del kernel lascia il campo aperto col testo scritto e il motivo sotto", async () => {
    const bar = pane("main", "Guida/Nota.md");
    world.rename = () => Promise.reject(new Error("esiste già"));
    mountTitleRename(lifetime);
    dblclick(crumbOf(bar));
    type(inputOf(bar)!, "Appunti");
    press(inputOf(bar)!, "Enter");
    await settled();
    const input = inputOf(bar)!;
    expect(input.value).toBe("Appunti");
    expect(input.readOnly).toBe(false);
    expect(note()!.textContent).toBe("explorer.rename_failed Guida/Nota.md | Guida/Appunti.md | esiste già");
    expect(input.getAttribute("aria-describedby")).toBe(note()!.id);
    expect(world.notices).toEqual([]);
  });

  it("una collisione con un documento aperto è un esito, e si dice sotto il campo", async () => {
    const bar = pane("main", "Guida/Nota.md");
    world.rename = (from, to) => Promise.resolve({ kind: "collision", from, to });
    mountTitleRename(lifetime);
    dblclick(crumbOf(bar));
    type(inputOf(bar)!, "Appunti");
    press(inputOf(bar)!, "Enter");
    await settled();
    expect(inputOf(bar)).not.toBeNull();
    expect(note()!.textContent).toBe(
      "explorer.rename_failed Guida/Nota.md | Guida/Appunti.md | explorer.destination_open",
    );
  });

  it("col testo che non si riesce a mettere in salvo la rinomina non parte", async () => {
    const bar = pane("main", "Guida/Nota.md");
    world.flush = () => Promise.resolve(["Guida/Nota.md"]);
    mountTitleRename(lifetime);
    dblclick(crumbOf(bar));
    type(inputOf(bar)!, "Appunti");
    press(inputOf(bar)!, "Enter");
    await settled();
    expect(renames).toEqual([]);
    expect(note()!.textContent).toBe("document.unsaved_blocks Guida/Nota.md");
    expect(inputOf(bar)!.value).toBe("Appunti");
  });
});

describe("le corse", () => {
  it("la vista ridisegna la testata a metà: il campo tiene testo e fuoco, e rinomina il suo documento", async () => {
    const bar = pane("main", "Guida/Nota.md");
    mountTitleRename(lifetime);
    dblclick(crumbOf(bar));
    const input = inputOf(bar)!;
    type(input, "Appu");
    redraw(bar, "Guida/Nota.md");
    await settled();
    expect(inputOf(bar)).toBe(input);
    expect(input.value).toBe("Appu");
    expect(document.activeElement).toBe(input);
    expect(crumbOf(bar).hidden).toBe(true);
    type(input, "Appunti");
    press(input, "Enter");
    await settled();
    expect(renames).toEqual([{ from: "Guida/Nota.md", to: "Guida/Appunti.md" }]);
  });

  it("il foglio passa a un altro documento sotto il campo: si chiude, e non rinomina nessuno", async () => {
    const bar = pane("main", "Guida/Nota.md");
    mountTitleRename(lifetime);
    dblclick(crumbOf(bar));
    type(inputOf(bar)!, "Appunti");
    world.docs.main = "Altra.md";
    redraw(bar, "Altra.md");
    await settled();
    expect(inputOf(bar)).toBeNull();
    expect(crumbOf(bar).hidden).toBe(false);
    expect(renames).toEqual([]);
  });

  it("l'identità è quella dell'apertura: Invio premuto prima del ridisegno rinomina il documento di prima", async () => {
    const bar = pane("main", "Guida/Nota.md");
    mountTitleRename(lifetime);
    dblclick(crumbOf(bar));
    type(inputOf(bar)!, "Appunti");
    // Il layout ha già un altro documento, la testata non è ancora ridisegnata.
    world.docs.main = "Altra.md";
    press(inputOf(bar)!, "Enter");
    await settled();
    expect(renames).toEqual([{ from: "Guida/Nota.md", to: "Guida/Appunti.md" }]);
  });

  it("due Invio di fila fanno una rinomina sola, ed Esc non annulla una rinomina partita", async () => {
    const bar = pane("main", "Guida/Nota.md");
    const answer = deferred<RenameOutcome>();
    world.rename = (from, to) => {
      renames.push({ from, to });
      return answer.promise;
    };
    mountTitleRename(lifetime);
    dblclick(crumbOf(bar));
    const input = inputOf(bar)!;
    type(input, "Appunti");
    press(input, "Enter");
    press(input, "Enter");
    await settled();
    expect(input.readOnly).toBe(true);
    expect(input.closest(".sheet-title-edit")!.getAttribute("aria-busy")).toBe("true");
    press(input, "Enter");
    press(input, "Escape");
    expect(inputOf(bar)).toBe(input);
    answer.resolve({ kind: "renamed", from: "Guida/Nota.md", to: "Guida/Appunti.md" });
    await settled();
    expect(flushes).toBe(1);
    expect(renames).toHaveLength(1);
    expect(inputOf(bar)).toBeNull();
  });

  it("la vista ridisegna col nome nuovo prima che la risposta torni: il campo si chiude una volta sola", async () => {
    const bar = pane("main", "Guida/Nota.md");
    const answer = deferred<RenameOutcome>();
    world.rename = () => answer.promise;
    mountTitleRename(lifetime);
    dblclick(crumbOf(bar));
    type(inputOf(bar)!, "Appunti");
    press(inputOf(bar)!, "Enter");
    await settled();
    world.docs.main = "Guida/Appunti.md";
    redraw(bar, "Guida/Appunti.md");
    await settled();
    expect(inputOf(bar)).toBeNull();
    answer.resolve({ kind: "renamed", from: "Guida/Nota.md", to: "Guida/Appunti.md" });
    await settled();
    expect(inputOf(bar)).toBeNull();
    expect(crumbOf(bar).getAttribute("aria-label")).toBe("sheet.title.button Guida/Appunti.md");
    expect(world.notices).toEqual([]);
  });

  it("un rifiuto che arriva a campo chiuso non riapre niente e non tocca il campo nuovo: si dice con un avviso", async () => {
    const bar = pane("main", "Guida/Nota.md");
    const other = pane("side", "Altra.md");
    const answer = deferred<RenameOutcome>();
    world.rename = () => answer.promise;
    mountTitleRename(lifetime);
    dblclick(crumbOf(bar));
    type(inputOf(bar)!, "Appunti");
    press(inputOf(bar)!, "Enter");
    await settled();
    // Si va altrove mentre la rinomina è in volo, e si apre un altro campo.
    dblclick(crumbOf(other));
    const fresh = inputOf(other)!;
    type(fresh, "Bozza");
    answer.reject(new Error("disco pieno"));
    await settled();
    expect(inputOf(bar)).toBeNull();
    expect(inputOf(other)).toBe(fresh);
    expect(fresh.value).toBe("Bozza");
    expect(fresh.hasAttribute("aria-invalid")).toBe(false);
    expect(note()).toBeNull();
    expect(world.notices).toEqual([
      { message: "explorer.rename_failed Guida/Nota.md | Guida/Appunti.md | disco pieno", tone: "guasto" },
    ]);
  });

  it("il foglio sparisce col campo aperto: niente resta appeso", async () => {
    const bar = pane("main", "Guida/Nota.md");
    mountTitleRename(lifetime);
    dblclick(crumbOf(bar));
    type(inputOf(bar)!, "Appunti");
    press(inputOf(bar)!, "Enter");
    panes.replaceChildren();
    await settled();
    // Un campo nuovo altrove funziona: quello di prima non occupa più il posto.
    const other = pane("side", "Altra.md");
    await settled();
    dblclick(crumbOf(other));
    expect(inputOf(other)!.value).toBe("Altra");
  });
});

describe("lo smontaggio", () => {
  it("toglie campo, messaggio, ruolo e ascolti, e rende il titolo alla vista", async () => {
    const bar = pane("main", "Guida/Nota.md");
    const listening = listenerLedger(document, window, panes);
    mountTitleRename(lifetime);
    dblclick(crumbOf(bar));
    type(inputOf(bar)!, "Che: cosa?");
    press(inputOf(bar)!, "Enter");
    await settled();
    expect(note()).not.toBeNull();
    lifetime.close();
    driver.advance(5000);
    expect(inputOf(bar)).toBeNull();
    expect(note()).toBeNull();
    const title = crumbOf(bar);
    expect(title.hidden).toBe(false);
    expect(title.className).toBe("muted");
    expect(title.hasAttribute("role")).toBe(false);
    expect(title.hasAttribute("tabindex")).toBe(false);
    expect(title.hasAttribute("aria-label")).toBe(false);
    expect(world.tips.get(title)).toBe("Guida/Nota.md");
    expect(listening()).toBe(0);
    expect(world.languages.size).toBe(0);
    vi.restoreAllMocks();
    // Dopo lo smontaggio la vista ridisegna e nessuno risponde più.
    redraw(bar, "Altra.md");
    dblclick(title);
    await settled();
    expect(title.hasAttribute("role")).toBe(false);
    expect(inputOf(bar)).toBeNull();
  });

  it("senza i fogli non monta niente", () => {
    document.body.innerHTML = "";
    mountTitleRename(lifetime);
    expect(world.languages.size).toBe(0);
  });
});
