// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandSpec, SettingEntry } from "../host/contract";
import type { EditorSurface, SurfaceBlockGroup } from "../editors/core/registry";
import {
  ACTION_UNAVAILABLE,
  type EditorActionState,
  type SurfaceEditorActions,
} from "../editors/core/editor-actions";
import { MARKDOWN_ACTIONS } from "../editors/text/profiles/markdown/actions";
import { icon } from "../ui/icons";
import { closeContextMenu } from "../ui/menu";
import {
  ACTION_LOOKS,
  BLOCK_GROUP_PAUSE_MS,
  createFormatBar,
  FORMATBAR_EVENT,
  LEGACY_FORMATBAR_SETTING,
  registerFormatIcons,
  TOOLBAR_SETTING,
  toggledToolbarForm,
  toolbarFormOf,
  toolbarGroups,
  type FormatBar,
} from "./format-bar";

function spec(id: string, title = id, surfaces: CommandSpec["surfaces"] = ["toolbar"]): CommandSpec {
  return {
    id,
    title,
    description: "",
    keybinding: null,
    params: [],
    scope: { writes: false, reach: "session", reversible: true },
    surfaces,
  };
}

/// Una superficie che conosce un sottoinsieme delle azioni e ne tiene lo
/// stato in una tabella: la barra non deve sapere altro.
function fakeActions(known: readonly string[]) {
  const states = new Map<string, EditorActionState>();
  const listeners = new Set<() => void>();
  const runs: string[] = [];
  let editable = true;
  const actions: SurfaceEditorActions = {
    has: (id) => known.includes(id),
    editable: () => editable,
    state: (id) => (known.includes(id) ? states.get(id) ?? { enabled: true, active: false } : ACTION_UNAVAILABLE),
    run: (id) => {
      runs.push(id);
      return true;
    },
    chord: (id) => (id === "markdown.bold" ? "Mod-b" : null),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    actions,
    runs,
    listeners,
    set(id: string, state: EditorActionState) {
      states.set(id, state);
      for (const listener of listeners) listener();
    },
    setEditable(value: boolean) {
      editable = value;
    },
  };
}

function surfaceWith(actions: SurfaceEditorActions | undefined): EditorSurface {
  return {
    family: "text",
    profile: "markdown",
    surfaceId: "p1",
    modes: [],
    setMode: () => {},
    editorActions: actions,
    destroy: () => {},
  };
}

const SPECS = [
  spec("text.undo", "Annulla"),
  spec("markdown.paragraph", "Testo normale"),
  spec("markdown.heading.1", "Titolo 1"),
  spec("markdown.heading.2", "Titolo 2"),
  spec("markdown.bold", "Grassetto"),
  spec("markdown.italic", "Corsivo"),
  spec("markdown.table", "Inserisci tabella"),
  spec("markdown.table.row.after", "Riga sotto"),
  spec("fuori.dalla.barra", "Palette soltanto", []),
];

let retireIcons: () => void;
let bars: FormatBar[] = [];

beforeEach(() => {
  retireIcons = registerFormatIcons();
});

afterEach(() => {
  closeContextMenu();
  for (const bar of bars) bar.destroy();
  bars = [];
  retireIcons();
});

function mount(surface: EditorSurface | null, commands: string[] = []) {
  let writing = true;
  const bar = createFormatBar({
    surface: () => surface,
    writing: () => writing,
    focusPane: () => {},
    runCommand: (id) => commands.push(id),
  });
  document.body.append(bar.element);
  bars.push(bar);
  return {
    bar,
    setWriting(value: boolean) {
      writing = value;
    },
  };
}

function buttons(bar: FormatBar): HTMLButtonElement[] {
  return [...bar.element.querySelectorAll<HTMLButtonElement>("button")];
}

describe("i gruppi della barra", () => {
  it("seguono l'ordine del plugin e saltano ciò che la superficie non sa fare", () => {
    const { actions } = fakeActions(["markdown.bold", "markdown.italic", "markdown.heading.1", "markdown.paragraph"]);
    const groups = toolbarGroups(SPECS, actions);
    expect(groups.map((group) => group.id)).toEqual(["block", "inline"]);
    expect(groups[0]!.menu.map((entry) => entry.spec.id)).toEqual(["markdown.paragraph", "markdown.heading.1"]);
    expect(groups[1]!.inline.map((entry) => entry.spec.id)).toEqual(["markdown.bold", "markdown.italic"]);
  });

  it("un comando qualunque offerto nella barra è un pulsante col suo titolo", () => {
    const groups = toolbarGroups([spec("acme:data", "Inserisci data")], undefined);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.id).toBe("other");
    expect(groups[0]!.inline[0]!.action).toBeNull();
  });

  it("ogni azione disegnata è un'azione del profilo, e ogni azione del profilo ha una resa", () => {
    const drawn = Object.keys(ACTION_LOOKS).filter((id) => !id.startsWith("text."));
    expect(drawn.sort()).toEqual([...MARKDOWN_ACTIONS.keys()].sort());
    for (const [id, look] of Object.entries(ACTION_LOOKS)) {
      if (look.menu) continue;
      expect(icon(look.icon), `${id}: ${look.icon}`).not.toBe("");
    }
  });
});

describe("la barra di un riquadro", () => {
  it("è nascosta senza pulsanti, e compare coi comandi di un plugin", () => {
    const fake = fakeActions(["markdown.bold"]);
    const { bar } = mount(surfaceWith(fake.actions));
    bar.update([]);
    expect(bar.element.hidden).toBe(true);
    bar.update(SPECS);
    expect(bar.element.hidden).toBe(false);
    expect(bar.element.getAttribute("role")).toBe("toolbar");
    const bold = bar.element.querySelector<HTMLButtonElement>('[data-command="markdown.bold"]')!;
    expect(bold.getAttribute("aria-label")).toBe("Grassetto");
    expect(bold.getAttribute("aria-keyshortcuts")).toMatch(/^(Control|Meta)\+B$/);
  });

  it("in una resa da leggere, o senza superficie, non c'è", () => {
    const fake = fakeActions(["markdown.bold"]);
    const view = mount(surfaceWith(fake.actions));
    view.setWriting(false);
    view.bar.update(SPECS);
    expect(view.bar.element.hidden).toBe(true);
    const empty = mount(null);
    empty.bar.update(SPECS);
    expect(empty.bar.element.hidden).toBe(true);
  });

  it("su una superficie con la sua barra non c'è, e la bolla della selezione resta", () => {
    const fake = fakeActions(["markdown.bold"]);
    const own: EditorSurface = { ...surfaceWith(fake.actions), ownBar: true };
    const view = mount(own);
    view.bar.update(SPECS);
    expect(view.bar.element.hidden).toBe(true);
    const bubble = createFormatBar({ surface: () => own, writing: () => true, focusPane: () => {}, runCommand: () => {}, only: ["inline"] });
    bars.push(bubble);
    bubble.update(SPECS);
    expect(bubble.element.hidden).toBe(false);
    bubble.element.querySelector<HTMLButtonElement>('[data-command="markdown.bold"]')!.click();
    expect(fake.runs).toEqual(["markdown.bold"]);
  });

  it("dice premuto e spento come la superficie, e si aggiorna quando lei cambia", async () => {
    const fake = fakeActions(["markdown.bold", "markdown.italic"]);
    const { bar } = mount(surfaceWith(fake.actions));
    bar.update(SPECS);
    const bold = bar.element.querySelector<HTMLButtonElement>('[data-command="markdown.bold"]')!;
    expect(bold.getAttribute("aria-pressed")).toBe("false");
    fake.set("markdown.bold", { enabled: true, active: true });
    fake.set("markdown.italic", { enabled: false, active: false });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(bold.getAttribute("aria-pressed")).toBe("true");
    const italic = bar.element.querySelector<HTMLButtonElement>('[data-command="markdown.italic"]')!;
    expect(italic.disabled).toBe(true);
    // Chi non commuta niente non dichiara un «premuto».
    fake.set("markdown.bold", { enabled: true, active: null });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(bold.hasAttribute("aria-pressed")).toBe(false);
  });

  it("un aggiornamento senza cambi non tocca il DOM: in WebKit ogni attributo riscritto ridipinge", async () => {
    const fake = fakeActions(["markdown.paragraph", "markdown.heading.1", "markdown.heading.2", "markdown.bold", "markdown.italic", "markdown.table.row.after"]);
    const { bar } = mount(surfaceWith(fake.actions));
    bar.update(SPECS);
    fake.set("markdown.bold", { enabled: true, active: true });
    fake.set("markdown.heading.1", { enabled: true, active: true });
    fake.set("markdown.italic", { enabled: false, active: false });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(bar.element, { subtree: true, attributes: true, childList: true, characterData: true });
    // La superficie avvisa a ogni battuta e a ogni passo del cursore, ma lo
    // stato dei pulsanti resta quello: niente si riscrive.
    for (let step = 0; step < 3; step++) {
      fake.set("markdown.bold", { enabled: true, active: true });
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }
    records.push(...observer.takeRecords());
    expect(records.map((record) => `${record.type} ${record.attributeName ?? ""} ${(record.target as Element).className ?? ""}`)).toEqual([]);
    // Ciò che cambia, invece, si scrive.
    fake.set("markdown.bold", { enabled: true, active: false });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    records.push(...observer.takeRecords());
    observer.disconnect();
    expect(records.map((record) => record.attributeName)).toEqual(["aria-pressed"]);
  });

  it("un clic esegue l'azione nella superficie, senza passare dal kernel", () => {
    const fake = fakeActions(["markdown.bold"]);
    const commands: string[] = [];
    const { bar } = mount(surfaceWith(fake.actions), commands);
    bar.update([...SPECS, spec("acme:data", "Inserisci data")]);
    bar.element.querySelector<HTMLButtonElement>('[data-command="markdown.bold"]')!.click();
    expect(fake.runs).toEqual(["markdown.bold"]);
    expect(commands).toEqual([]);
    bar.element.querySelector<HTMLButtonElement>('[data-command="acme:data"]')!.click();
    expect(commands).toEqual(["acme:data"]);
  });

  it("il puntatore non toglie il fuoco al testo", () => {
    const fake = fakeActions(["markdown.bold"]);
    const { bar } = mount(surfaceWith(fake.actions));
    bar.update(SPECS);
    const bold = bar.element.querySelector<HTMLButtonElement>('[data-command="markdown.bold"]')!;
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    bold.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it("ha un solo punto di tabulazione, e le frecce vi si muovono dentro", () => {
    const fake = fakeActions(["markdown.bold", "markdown.italic"]);
    const { bar } = mount(surfaceWith(fake.actions));
    bar.update(SPECS);
    const controls = buttons(bar).filter((button) => !button.hidden && !button.closest("[hidden]"));
    expect(controls.filter((button) => button.tabIndex === 0)).toHaveLength(1);
    const [bold, italic] = controls;
    bold!.focus();
    bold!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(italic);
    expect(italic!.tabIndex).toBe(0);
    expect(bold!.tabIndex).toBe(-1);
    italic!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(document.activeElement).toBe(bold);
  });

  it("← e → girano ai capi, Fine va all'ultimo, e i pulsanti spenti si saltano", async () => {
    const fake = fakeActions(["markdown.bold", "markdown.italic", "markdown.table"]);
    const { bar } = mount(surfaceWith(fake.actions));
    bar.update(SPECS);
    fake.set("markdown.italic", { enabled: false, active: false });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const at = (id: string) => bar.element.querySelector<HTMLButtonElement>(`[data-command="${id}"]`)!;
    const bold = at("markdown.bold");
    const italic = at("markdown.italic");
    const reachable = buttons(bar).filter((button) => !button.disabled && !button.closest("[hidden]"));
    const last = reachable[reachable.length - 1]!;
    expect(italic.disabled).toBe(true);
    expect(reachable.filter((button) => button.tabIndex === 0)).toHaveLength(1);
    const press = (on: HTMLElement, key: string) =>
      on.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    bold.focus();
    press(bold, "ArrowRight");
    expect(document.activeElement, "lo spento si salta").not.toBe(italic);
    expect(document.activeElement).toBe(reachable[reachable.indexOf(bold) + 1]);
    press(document.activeElement as HTMLElement, "End");
    expect(document.activeElement).toBe(last);
    press(last, "ArrowRight");
    expect(document.activeElement, "dopo l'ultimo si torna al primo").toBe(reachable[0]);
    press(reachable[0]!, "ArrowLeft");
    expect(document.activeElement, "prima del primo si va all'ultimo").toBe(last);
    expect(last.tabIndex).toBe(0);
    expect(reachable.filter((button) => button.tabIndex === 0)).toHaveLength(1);
  });

  it("lo stile del paragrafo dice lo stile corrente e apre il menu dei titoli", () => {
    const fake = fakeActions(["markdown.paragraph", "markdown.heading.1", "markdown.heading.2"]);
    fake.set("markdown.heading.2", { enabled: true, active: true });
    const { bar } = mount(surfaceWith(fake.actions));
    bar.update(SPECS);
    const style = bar.element.querySelector<HTMLButtonElement>(".format-bar-style")!;
    expect(style.textContent).toContain("Titolo 2");
    expect(style.getAttribute("aria-haspopup")).toBe("menu");
    style.click();
    const items = [...document.querySelectorAll<HTMLButtonElement>("#context-menu [role=menuitem]")];
    expect(items.map((item) => item.textContent)).toEqual(["Testo normale", "Titolo 1", "Titolo 2"]);
    expect(style.getAttribute("aria-expanded")).toBe("true");
    items[1]!.click();
    expect(fake.runs).toEqual(["markdown.heading.1"]);
    expect(style.getAttribute("aria-expanded")).toBe("false");
  });

  it("ogni tendina si chiama col suo gruppo, non tutte «Operazioni sulla tabella»", () => {
    const fake = fakeActions(["markdown.embed", "markdown.table.row.after", "markdown.color.red"]);
    const { bar } = mount(surfaceWith(fake.actions));
    bar.update([
      spec("markdown.color.red", "Rosso"),
      spec("markdown.embed", "Incorpora"),
      spec("markdown.table.row.after", "Riga sotto"),
    ]);
    const names = [...bar.element.querySelectorAll<HTMLButtonElement>(".format-bar-menu:not(.format-bar-overflow)")].map((menu) =>
      menu.getAttribute("aria-label"),
    );
    expect(names).toEqual(["Colore e sfondo", "Altri collegamenti", "Operazioni sulla tabella"]);
  });

  it("veste la barra in una fila del kit, e la bolla resta senza vassoio", () => {
    const fake = fakeActions(["markdown.bold", "markdown.paragraph", "markdown.heading.1"]);
    const { bar } = mount(surfaceWith(fake.actions));
    bar.update(SPECS);
    expect(bar.element.classList.contains("format-bar")).toBe(true);
    expect(bar.element.classList.contains("kit-bar")).toBe(true);
    const groups = [...bar.element.querySelectorAll<HTMLElement>(".format-bar-group")];
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) expect(group.classList.contains("kit-bar-group"), group.dataset.group).toBe(true);
    // Ogni pulsante, il selettore dello stile e «…» compresi.
    for (const button of buttons(bar)) {
      expect(button.classList.contains("kit-bar-button"), button.className).toBe(true);
    }
    expect(bar.element.querySelector(".format-bar-style.kit-bar-button")).not.toBeNull();
    expect(bar.element.querySelector(".format-bar-overflow.kit-bar-button")).not.toBeNull();
    const bubble = createFormatBar({ surface: () => surfaceWith(fake.actions), writing: () => true, focusPane: () => {}, runCommand: () => {}, only: ["inline"] });
    bars.push(bubble);
    bubble.update(SPECS);
    expect(bubble.element.classList.contains("format-bar")).toBe(true);
    expect(bubble.element.classList.contains("kit-bar"), "la bolla non sta nel vassoio").toBe(false);
    expect(bubble.element.querySelector('[data-command="markdown.bold"]')!.classList.contains("kit-bar-button")).toBe(true);
  });

  it("Escape riporta il fuoco al testo", () => {
    const fake = fakeActions(["markdown.bold"]);
    let focused = 0;
    const surface: EditorSurface = { ...surfaceWith(fake.actions), focus: () => { focused += 1; } };
    const { bar } = mount(surface);
    bar.update(SPECS);
    const bold = bar.element.querySelector<HTMLButtonElement>('[data-command="markdown.bold"]')!;
    bold.focus();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    bold.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(focused).toBe(1);
  });

  it("il menu di un pulsante, chiuso, rende il fuoco al pulsante", () => {
    const fake = fakeActions(["markdown.paragraph", "markdown.heading.1"]);
    const { bar } = mount(surfaceWith(fake.actions));
    bar.update(SPECS);
    const style = bar.element.querySelector<HTMLButtonElement>(".format-bar-style")!;
    style.focus();
    style.click();
    expect(document.querySelector("#context-menu")).not.toBeNull();
    closeContextMenu();
    expect(document.activeElement).toBe(style);
    expect(style.tabIndex).toBe(0);
  });

  it("col dito e il cursore in una tabella, Tab, Invio e «+ riga» in testa alla barra", () => {
    const fake = fakeActions(["markdown.bold", "markdown.table", "markdown.table.row.after"]);
    let coarse = true;
    const make = () => {
      const bar = createFormatBar({
        surface: () => surfaceWith(fake.actions),
        writing: () => true,
        focusPane: () => {},
        runCommand: () => {},
        coarse: () => coarse,
      });
      document.body.append(bar.element);
      bars.push(bar);
      return bar;
    };
    // Il testo dove sta il cursore: riceve i tasti.
    const editor = document.createElement("div");
    editor.tabIndex = 0;
    document.body.append(editor);
    const keys: string[] = [];
    editor.addEventListener("keydown", (event) => keys.push(event.key));
    editor.focus();

    const bar = make();
    fake.set("markdown.table.row.after", { enabled: false, active: null });
    bar.update(SPECS);
    const touch = bar.element.querySelector<HTMLElement>(".format-bar-touch")!;
    expect(bar.element.firstElementChild).toBe(touch);
    // Fuori da una tabella il gruppo non si vede.
    expect(touch.hidden).toBe(true);
    fake.set("markdown.table.row.after", { enabled: true, active: null });
    bar.update(SPECS);
    expect(touch.hidden).toBe(false);
    const [tab, enter, add] = [...touch.querySelectorAll<HTMLButtonElement>("button")];
    expect([tab!.textContent, enter!.textContent, add!.textContent]).toEqual(["Tab", "Invio", "+ riga"]);
    tab!.click();
    enter!.click();
    add!.click();
    expect(keys).toEqual(["Tab", "Enter"]);
    expect(fake.runs).toEqual(["markdown.table.row.after"]);
    expect(document.activeElement).toBe(editor);

    // Col mouse non c'è.
    coarse = false;
    const desk = make();
    desk.update(SPECS);
    expect(desk.element.querySelector(".format-bar-touch")).toBeNull();
    editor.remove();
  });

  it("passando a un'altra superficie con la stessa barra, i pulsanti restano e seguono la nuova", async () => {
    const first = fakeActions(["markdown.bold", "markdown.italic"]);
    const second = fakeActions(["markdown.bold", "markdown.italic"]);
    let surface = surfaceWith(first.actions);
    const bar = createFormatBar({ surface: () => surface, writing: () => true, focusPane: () => {}, runCommand: () => {} });
    document.body.append(bar.element);
    bars.push(bar);
    bar.update(SPECS);
    const bold = bar.element.querySelector<HTMLButtonElement>('[data-command="markdown.bold"]')!;
    surface = surfaceWith(second.actions);
    second.set("markdown.bold", { enabled: true, active: true });
    bar.update(SPECS);
    // Lo stesso nodo, non uno rifatto: cambiare scheda non ridisegna la barra.
    expect(bar.element.querySelector('[data-command="markdown.bold"]')).toBe(bold);
    expect(bold.getAttribute("aria-pressed")).toBe("true");
    expect(first.listeners.size).toBe(0);
    expect(second.listeners.size).toBe(1);
    second.set("markdown.bold", { enabled: true, active: false });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(bold.getAttribute("aria-pressed")).toBe("false");
    // Una scorciatoia diversa è un'altra barra: il suggerimento la deve dire.
    const third = fakeActions(["markdown.bold", "markdown.italic"]);
    surface = surfaceWith({ ...third.actions, chord: (id) => (id === "markdown.bold" ? "Mod-g" : null) });
    bar.update(SPECS);
    const again = bar.element.querySelector<HTMLButtonElement>('[data-command="markdown.bold"]')!;
    expect(again).not.toBe(bold);
    expect(again.getAttribute("aria-keyshortcuts")).toBe("Control+G");
    expect(second.listeners.size).toBe(0);
  });

  it("misura la riga al fotogramma, non dentro il ridisegno", async () => {
    const fake = fakeActions(["markdown.bold", "markdown.italic"]);
    const { bar } = mount(surfaceWith(fake.actions));
    let reads = 0;
    Object.defineProperty(bar.element, "scrollWidth", { configurable: true, get: () => (reads++, 0) });
    bar.update(SPECS);
    bar.update(SPECS);
    expect(reads).toBe(0);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(reads).toBe(1);
  });

  it("smontata, non segue più la superficie", () => {
    const fake = fakeActions(["markdown.bold"]);
    const { bar } = mount(surfaceWith(fake.actions));
    bar.update(SPECS);
    expect(fake.listeners.size).toBe(1);
    bar.destroy();
    bars = bars.filter((candidate) => candidate !== bar);
    expect(fake.listeners.size).toBe(0);
    expect(bar.element.isConnected).toBe(false);
  });
});

function setting(key: string, value: SettingEntry["value"], source: SettingEntry["source"] = "machine"): SettingEntry {
  return { spec: { key } as SettingEntry["spec"], value, source };
}

describe("la forma della barra (`editor.toolbar`)", () => {
  it("legge le tre forme, e di serie è compatta", () => {
    expect(toolbarFormOf([])).toBe("compatta");
    expect(toolbarFormOf([setting(TOOLBAR_SETTING, "compatta", "default")])).toBe("compatta");
    expect(toolbarFormOf([setting(TOOLBAR_SETTING, "completa")])).toBe("completa");
    expect(toolbarFormOf([setting(TOOLBAR_SETTING, "nascosta")])).toBe("nascosta");
    expect(toolbarFormOf([setting(TOOLBAR_SETTING, "strana")])).toBe("compatta");
  });

  it("la barra spenta da un Fub di prima vale `nascosta` finché `editor.toolbar` non c'è", () => {
    const old = [setting("chrome.schema", 1), setting(LEGACY_FORMATBAR_SETTING, false)];
    expect(toolbarFormOf([...old, setting(TOOLBAR_SETTING, "compatta", "default")])).toBe("nascosta");
    // Scelta la forma, la chiave vecchia non conta più.
    expect(toolbarFormOf([...old, setting(TOOLBAR_SETTING, "completa")])).toBe("completa");
    // Accesa, o senza il formato dell'interfaccia, non dice niente.
    expect(toolbarFormOf([setting("chrome.schema", 1), setting(LEGACY_FORMATBAR_SETTING, true)])).toBe("compatta");
    expect(toolbarFormOf([setting(LEGACY_FORMATBAR_SETTING, false)])).toBe("compatta");
  });

  it("il comando del menu Vista alterna `nascosta` e l'ultima forma visibile", () => {
    expect(toggledToolbarForm("compatta", "compatta")).toBe("nascosta");
    expect(toggledToolbarForm("completa", "completa")).toBe("nascosta");
    expect(toggledToolbarForm("nascosta", "completa")).toBe("completa");
    expect(toggledToolbarForm("nascosta", "compatta")).toBe("compatta");
  });

  it("compatta tiene i gesti fissi, lo stile e i comandi dei plugin; completa tutto; nascosta niente", () => {
    const known = ["text.undo", "markdown.paragraph", "markdown.bold", "markdown.strikethrough", "markdown.list.task", "markdown.quote"];
    const specs = [...known.map((id) => spec(id)), spec("plugin.conta", "Conta parole")];
    const fake = fakeActions(known);
    const ids = (form: "compatta" | "completa" | "nascosta") =>
      toolbarGroups(specs, fake.actions, form).flatMap((group) => [...group.inline, ...group.menu].map((entry) => entry.spec.id));
    expect(ids("compatta")).toEqual(["text.undo", "markdown.paragraph", "markdown.bold", "markdown.list.task", "plugin.conta"]);
    expect(ids("completa")).toEqual([...known, "plugin.conta"]);
    expect(ids("nascosta")).toEqual([]);
  });
});

type Form = "compatta" | "completa" | "nascosta";

/// Una barra di riquadro che segue il blocco, con la forma scelta.
function mountFollowing(surface: EditorSurface, form: { value: Form } = { value: "compatta" }, commands: string[] = []) {
  const bar = createFormatBar({
    surface: () => surface,
    writing: () => true,
    focusPane: () => {},
    runCommand: (id) => commands.push(id),
    blocks: true,
    form: () => form.value,
  });
  document.body.append(bar.element);
  bars.push(bar);
  return bar;
}

const FOLLOW_SPECS = [
  spec("text.undo", "Annulla"),
  spec("markdown.paragraph", "Testo"),
  spec("markdown.heading.2", "Titolo 2"),
  spec("markdown.list.task", "Elenco di attività", ["toolbar", "slash"]),
  spec("markdown.bold", "Grassetto"),
  spec("markdown.strikethrough", "Barrato"),
  spec("markdown.table", "Tabella", ["slash"]),
  spec("markdown.underline", "Sottolineato", ["slash"]),
];
const FOLLOW_KNOWN = FOLLOW_SPECS.map((each) => each.id);

function menuItemsShown(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("#context-menu [role^=menuitem]")];
}

describe("la barra che segue il blocco", () => {
  it("lo stile dice il blocco del cursore e apre «Trasforma in»", () => {
    const fake = fakeActions(FOLLOW_KNOWN);
    const bar = mountFollowing(surfaceWith(fake.actions));
    bar.update(FOLLOW_SPECS);
    const style = bar.element.querySelector<HTMLButtonElement>(".format-bar-style")!;
    expect(style.textContent).toBe("Testo");
    fake.set("markdown.list.task", { enabled: true, active: true });
    // Il paragrafo di un compito è anche un paragrafo: la spunta resta una.
    fake.set("markdown.paragraph", { enabled: true, active: true });
    bar.update(FOLLOW_SPECS);
    expect(style.textContent).toBe("Compito");
    expect(style.getAttribute("aria-label")).toBe("Stile del blocco: Compito");
    style.click();
    expect(document.getElementById("context-menu")?.textContent).toContain("Trasforma in");
    const items = menuItemsShown();
    expect(items.map((item) => item.getAttribute("aria-label") ?? item.textContent)).toEqual([
      expect.stringContaining("Testo"),
      expect.stringContaining("Titolo 2"),
      expect.stringContaining("Elenco di attività"),
    ]);
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
    items[1]!.click();
    expect(fake.runs).toEqual(["markdown.heading.2"]);
  });

  it("i comandi dello stile sparsi fra altri danno un solo stile del blocco", () => {
    const scattered = [
      spec("markdown.paragraph", "Testo"),
      spec("markdown.bold", "Grassetto"),
      spec("markdown.heading.2", "Titolo 2"),
      spec("markdown.list.task", "Elenco di attività"),
    ];
    const fake = fakeActions(scattered.map((each) => each.id));
    const bar = mountFollowing(surfaceWith(fake.actions));
    bar.update(scattered);
    expect(bar.element.querySelectorAll(".format-bar-style")).toHaveLength(1);
    bar.element.querySelector<HTMLButtonElement>(".format-bar-style")!.click();
    expect(menuItemsShown()).toHaveLength(3);
  });

  it("compatta lascia il barrato alla forma completa, e cambia forma quando la shell lo dice", () => {
    const fake = fakeActions(FOLLOW_KNOWN);
    const form: { value: Form } = { value: "compatta" };
    const bar = mountFollowing(surfaceWith(fake.actions), form);
    bar.update(FOLLOW_SPECS);
    const has = (id: string) => bar.element.querySelector(`[data-command="${id}"]`) !== null;
    expect(has("markdown.bold")).toBe(true);
    expect(has("markdown.strikethrough")).toBe(false);
    form.value = "completa";
    window.dispatchEvent(new CustomEvent(FORMATBAR_EVENT));
    expect(has("markdown.strikethrough")).toBe(true);
    form.value = "nascosta";
    window.dispatchEvent(new CustomEvent(FORMATBAR_EVENT));
    expect(bar.element.hidden).toBe(true);
  });

  it("la bolla della selezione resta intera in ogni forma", () => {
    const fake = fakeActions(FOLLOW_KNOWN);
    const bar = createFormatBar({
      surface: () => surfaceWith(fake.actions),
      writing: () => true,
      focusPane: () => {},
      runCommand: () => {},
      only: ["inline"],
      blocks: true,
      form: () => "compatta",
    });
    bars.push(bar);
    bar.update(FOLLOW_SPECS);
    expect(bar.element.querySelector('[data-command="markdown.strikethrough"]')).not.toBeNull();
    expect(bar.element.querySelector(".format-bar-insert, .format-bar-context")).toBeNull();
  });

  it("«+ Inserisci» apre i blocchi del «/» coi nomi, senza gli stili, e li esegue", () => {
    const fake = fakeActions(FOLLOW_KNOWN);
    const bar = mountFollowing(surfaceWith(fake.actions));
    bar.update(FOLLOW_SPECS);
    const insert = bar.element.querySelector<HTMLButtonElement>(".format-bar-insert")!;
    expect(insert.textContent).toBe("Inserisci");
    insert.click();
    const items = menuItemsShown();
    const named = (text: string) => items.find((item) => item.textContent?.includes(text));
    expect(named("Elenco di attività")).toBeDefined();
    expect(named("Tabella")).toBeDefined();
    expect(named("Sottolineato")).toBeUndefined();
    named("Tabella")!.click();
    expect(fake.runs).toEqual(["markdown.table"]);
  });

  it("in sola lettura non offre ciò che scrive", () => {
    const fake = fakeActions(FOLLOW_KNOWN);
    fake.setEditable(false);
    const bar = mountFollowing(surfaceWith(fake.actions));
    bar.update(FOLLOW_SPECS);
    expect(bar.element.querySelector<HTMLButtonElement>(".format-bar-insert")!.disabled).toBe(true);
    expect(bar.element.querySelector<HTMLButtonElement>(".format-bar-style")!.disabled).toBe(true);
  });
});

describe("il gruppo del blocco", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /// Una superficie che dichiara il gruppo del blocco in cui sta il cursore.
  function blockSurface(fake: ReturnType<typeof fakeActions>) {
    const ran: string[] = [];
    let current: SurfaceBlockGroup | null = null;
    let version = 0;
    const task = (seen: number): SurfaceBlockGroup => ({
      id: "task",
      label: "Compito",
      items: [{ id: "markdown.date", label: "Scadenza", icon: "fmt-date", run: () => ran.push(`scadenza@${seen}`) }],
    });
    const code = (language: string): SurfaceBlockGroup => ({
      id: "code",
      label: "Codice",
      items: [
        {
          id: "markdown.code.language",
          label: language,
          items: [
            { id: "markdown.code.language.rust", label: "Rust", radio: true, checked: language === "Rust", run: () => ran.push("rust") },
            { id: "markdown.code.language.python", label: "Python", radio: true, checked: language === "Python", run: () => ran.push("python") },
          ],
        },
        { id: "markdown.code.copy", label: "Copia", icon: "copy", run: () => ran.push("copia") },
      ],
    });
    const surface: EditorSurface = { ...surfaceWith(fake.actions), blockGroup: () => current };
    return {
      surface,
      ran,
      move(group: "task" | "code" | null, language = "Rust") {
        version += 1;
        current = group === "task" ? task(version) : group === "code" ? code(language) : null;
        for (const listener of fake.listeners) listener();
      },
    };
  }

  const context = (bar: FormatBar) => bar.element.querySelector<HTMLElement>(".format-bar-context")!;

  it("compare col suo nome e i suoi gesti, e senza un blocco non c'è", () => {
    const fake = fakeActions(FOLLOW_KNOWN);
    const block = blockSurface(fake);
    block.move("task");
    const bar = mountFollowing(block.surface);
    bar.update(FOLLOW_SPECS);
    const box = context(bar);
    expect(box.hidden).toBe(false);
    expect(box.getAttribute("aria-label")).toBe("Compito");
    expect(box.querySelector(".format-bar-context-name")?.textContent).toBe("Compito");
    expect([...box.querySelectorAll("button")].map((each) => each.textContent)).toEqual(["Scadenza"]);
    // Un solo punto di tabulazione per tutta la barra.
    expect(buttons(bar).filter((each) => each.tabIndex === 0)).toHaveLength(1);
  });

  it("cambia soltanto dopo una pausa, e il gruppo nuovo si annuncia una volta", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fake = fakeActions(FOLLOW_KNOWN);
    const block = blockSurface(fake);
    block.move("task");
    const bar = mountFollowing(block.surface);
    bar.update(FOLLOW_SPECS);
    const status = bar.element.querySelector("[role=status]")!;
    expect(status.textContent).toBe("");
    block.move("code");
    vi.advanceTimersByTime(BLOCK_GROUP_PAUSE_MS - 10);
    expect(context(bar).dataset.block).toBe("task");
    // Ogni avviso fa ripartire la pausa: chi scrive di fila non fa lavoro.
    block.move("code");
    vi.advanceTimersByTime(BLOCK_GROUP_PAUSE_MS - 10);
    expect(context(bar).dataset.block).toBe("task");
    vi.advanceTimersByTime(20);
    expect(context(bar).dataset.block).toBe("code");
    expect(status.textContent).toBe("Strumenti del blocco: Codice");
    // Lo stesso blocco con un altro linguaggio: si ridisegna, non si annuncia.
    status.textContent = "";
    block.move("code", "Python");
    vi.advanceTimersByTime(BLOCK_GROUP_PAUSE_MS);
    expect(context(bar).querySelector('[data-command="markdown.code.language"]')?.textContent).toBe("Python");
    expect(status.textContent).toBe("");
    block.move(null);
    vi.advanceTimersByTime(BLOCK_GROUP_PAUSE_MS);
    expect(context(bar).hidden).toBe(true);
  });

  it("resta quello di partenza mentre il fuoco è nella barra", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fake = fakeActions(FOLLOW_KNOWN);
    const block = blockSurface(fake);
    block.move("code");
    const bar = mountFollowing(block.surface);
    bar.update(FOLLOW_SPECS);
    const copy = context(bar).querySelector<HTMLButtonElement>('[data-command="markdown.code.copy"]')!;
    copy.focus();
    block.move("task");
    vi.advanceTimersByTime(BLOCK_GROUP_PAUSE_MS * 2);
    expect(context(bar).dataset.block).toBe("code");
    copy.blur();
    vi.advanceTimersByTime(BLOCK_GROUP_PAUSE_MS);
    expect(context(bar).dataset.block).toBe("task");
  });

  it("resta quello di partenza mentre un suo menu è aperto", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fake = fakeActions(FOLLOW_KNOWN);
    const block = blockSurface(fake);
    block.move("code");
    const bar = mountFollowing(block.surface);
    bar.update(FOLLOW_SPECS);
    context(bar).querySelector<HTMLButtonElement>('[data-command="markdown.code.language"]')!.click();
    block.move("task");
    vi.advanceTimersByTime(BLOCK_GROUP_PAUSE_MS * 2);
    expect(context(bar).dataset.block).toBe("code");
  });

  it("un gesto si esegue com'è adesso, non com'era quando la barra l'ha disegnato", () => {
    const fake = fakeActions(FOLLOW_KNOWN);
    const block = blockSurface(fake);
    block.move("task");
    const bar = mountFollowing(block.surface);
    bar.update(FOLLOW_SPECS);
    const due = context(bar).querySelector<HTMLButtonElement>('[data-command="markdown.date"]')!;
    block.move("task");
    due.click();
    expect(block.ran).toEqual(["scadenza@2"]);
  });

  it("il linguaggio del codice apre le sue scelte, con quella di ora segnata", () => {
    const fake = fakeActions(FOLLOW_KNOWN);
    const block = blockSurface(fake);
    block.move("code");
    const bar = mountFollowing(block.surface);
    bar.update(FOLLOW_SPECS);
    const language = context(bar).querySelector<HTMLButtonElement>('[data-command="markdown.code.language"]')!;
    expect(language.getAttribute("aria-haspopup")).toBe("menu");
    language.click();
    const items = menuItemsShown();
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    items[1]!.click();
    expect(block.ran).toEqual(["python"]);
  });

  it("smontata la barra, la pausa in corso non chiede più niente", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fake = fakeActions(FOLLOW_KNOWN);
    const block = blockSurface(fake);
    let asked = 0;
    const surface: EditorSurface = {
      ...block.surface,
      blockGroup: () => {
        asked += 1;
        return null;
      },
    };
    const bar = mountFollowing(surface);
    bar.update(FOLLOW_SPECS);
    const before = asked;
    block.move("task");
    bar.destroy();
    bars = bars.filter((candidate) => candidate !== bar);
    vi.advanceTimersByTime(BLOCK_GROUP_PAUSE_MS * 2);
    expect(asked).toBe(before);
  });
});
