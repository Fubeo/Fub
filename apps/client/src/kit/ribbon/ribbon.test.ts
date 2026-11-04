// @vitest-environment happy-dom
//
// La barra del kit con una vista che non è quella della griglia: un paragrafo
// e due specie di controllo, una del kit e una di chi la monta. Prova che la
// barra non sa di chi è: le classi portano il prefisso, il testo arriva da
// fuori, il catalogo decide che cosa si vede, e lo smontaggio non lascia niente.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mountRibbon, type Ribbon, type RibbonCommandState } from "./ribbon";
import type { ControlBase, KitControl, RibbonTab } from "./types";

interface View {
  readonly bold: boolean;
  readonly inTable: boolean;
}

type Key = "home" | "table" | "font" | "bold" | "italic" | "stamp" | "rows";

const WORDS: Record<Key, string> = {
  home: "Home",
  table: "Tabella",
  font: "Carattere",
  bold: "Grassetto",
  italic: "Corsivo",
  stamp: "Timbro",
  rows: "Righe",
};

/// Una specie che il kit non conosce: un timbro che dà il suo comando.
interface StampControl extends ControlBase<View, Key> {
  readonly kind: "stamp";
  readonly id: string;
}

type Control = KitControl<View, Key> | StampControl;

const TABS: readonly RibbonTab<Control, Key>[] = [
  {
    id: "home",
    label: "home",
    keytip: "H",
    groups: [
      {
        id: "font",
        label: "font",
        icon: "bold",
        keytip: "ZF",
        columns: [
          { kind: "button", id: "doc.bold", label: "bold", keytip: "1", glyph: "G", pressed: (view) => view.bold },
          { kind: "button", id: "doc.italic", label: "italic", keytip: "2", glyph: "C" },
          { kind: "stamp", id: "doc.stamp", label: "stamp", keytip: "3", glyph: "T" },
        ],
      },
    ],
  },
  {
    id: "table",
    label: "table",
    keytip: "JT",
    contextual: "table",
    groups: [{ id: "rows", label: "rows", icon: "table", keytip: "R", columns: [{ kind: "button", id: "table.addRow", label: "rows", keytip: "R" }] }],
  },
];

let host: HTMLElement;
let ribbon: Ribbon<View, Key>;
let view: View;
let states: RibbonCommandState[];
let calls: [string, string][];
let languages: (() => void)[];

beforeEach(() => {
  const root = document.createElement("div");
  host = document.createElement("div");
  root.append(host);
  document.body.append(root);
  view = { bold: true, inTable: false };
  states = [
    { id: "doc.bold", enabled: true },
    { id: "doc.italic", enabled: false, reason: "il documento è in sola lettura" },
    { id: "doc.stamp", enabled: true },
    { id: "table.addRow", enabled: true },
  ];
  calls = [];
  languages = [];
  ribbon = mountRibbon<View, Key, StampControl>({
    host,
    prefix: "doc-ribbon",
    menuPrefix: "doc.menu.",
    tabs: TABS,
    mini: ["doc.bold"],
    chevrons: { down: "chevron", up: "chevron" },
    strings: {
      label: () => "Barra",
      collapse: () => "Comprimi",
      expand: () => "Mostra",
      unavailable: (label, reason) => `${label}: ${reason}`,
      empty: () => "Nessuna voce",
      mini: () => "Mini-barra",
    },
    t: (key) => WORDS[key],
    commands: () => states,
    commandable: () => true,
    view: () => view,
    contextShown: (context, now) => context === "table" && now.inTable,
    command: (id, params) => {
      calls.push([id, params]);
    },
    openDialog: () => {},
    focus: () => {},
    languages: (listener) => {
      languages.push(listener);
      return () => languages.splice(languages.indexOf(listener), 1);
    },
    extra: (control, group, parts) => {
      const wrap = parts.wrap(control);
      const press = parts.button(control, () => parts.t(control.label), () => parts.give(control.id, { at: "qui" }));
      wrap.append(press);
      return {
        control,
        group,
        wrap,
        shown: true,
        update: () => parts.availability(press, control.id, parts.t(control.label)),
        activate: () => press.click(),
        relabel: () => {},
      };
    },
  });
});

afterEach(() => {
  ribbon.destroy();
  document.body.replaceChildren();
});

const tabNames = () => [...host.querySelectorAll<HTMLElement>(".kit-tab")].map((tab) => tab.textContent);
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

describe("la barra del kit", () => {
  it("porta il prefisso di chi la monta, e la scheda contestuale soltanto nel suo contesto", () => {
    expect(host.querySelector(".doc-ribbon")).not.toBeNull();
    expect(host.querySelector(".doc-ribbon-button")).not.toBeNull();
    expect(host.querySelector("[class*='grid-ribbon']")).toBeNull();
    expect(tabNames()).toEqual(["Home"]);
    view = { ...view, inTable: true };
    ribbon.refresh();
    expect(tabNames()).toEqual(["Home", "Tabella"]);
  });

  it("dice premuto e spento con la ragione del catalogo, e nasconde ciò che il catalogo non serve", () => {
    expect(button("Grassetto").getAttribute("aria-pressed")).toBe("true");
    expect(button("Corsivo").getAttribute("aria-disabled")).toBe("true");
    states = states.filter((state) => state.id !== "doc.bold");
    ribbon.refresh();
    expect((button("Grassetto").closest(".doc-ribbon-item") as HTMLElement).hidden).toBe(true);
  });

  it("dà i comandi dei suoi controlli e di quelli di chi la monta", () => {
    button("Grassetto").click();
    button("Timbro").click();
    expect(calls).toEqual([
      ["doc.bold", "{}"],
      ["doc.stamp", '{"at":"qui"}'],
    ]);
  });

  it("monta la mini-barra con i controlli della prima scheda", () => {
    const place = document.createElement("div");
    const remove = ribbon.mountMini(place);
    expect(place.querySelector(".doc-ribbon-mini [aria-label='Grassetto']")).not.toBeNull();
    remove();
    expect(place.childElementCount).toBe(0);
  });

  it("smontata, se ne va dal documento e smette di ascoltare la lingua", () => {
    expect(languages).toHaveLength(1);
    ribbon.destroy();
    expect(host.querySelector(".doc-ribbon")).toBeNull();
    expect(languages).toHaveLength(0);
  });
});

describe("la barra del kit, i gesti di Office", () => {
  let root: HTMLElement;
  let place: HTMLElement;
  let mounted: Ribbon<View, Key>;
  let gave: string[];
  let asked: [string, HTMLElement][];

  beforeEach(() => {
    ribbon.destroy();
    document.body.replaceChildren();
    root = document.createElement("div");
    place = document.createElement("div");
    const outside = document.createElement("textarea");
    root.append(place, outside);
    document.body.append(root);
    gave = [];
    asked = [];
    states = [
      { id: "doc.bold", enabled: true },
      { id: "doc.italic", enabled: false, reason: "spento" },
      { id: "doc.undo", enabled: true },
      { id: "doc.find", enabled: true },
    ];
    const tabs: readonly RibbonTab<KitControl<View, Key>, Key>[] = [
      {
        id: "home",
        label: "home",
        keytip: "H",
        groups: [
          {
            id: "font",
            label: "font",
            icon: "bold",
            keytip: "ZF",
            columns: [
              { kind: "button", id: "doc.bold", label: "bold", keytip: "1", glyph: "G" },
              { kind: "button", id: "doc.italic", label: "italic", keytip: "2", glyph: "C" },
              { kind: "button", id: "doc.find", dialog: "find", label: "stamp", keytip: "3", glyph: "T" },
            ],
          },
        ],
      },
    ];
    mounted = mountRibbon<View, Key>({
      host: place,
      prefix: "doc-ribbon",
      menuPrefix: "doc.menu.",
      tabs,
      quick: [{ kind: "button", id: "doc.undo", label: "rows", keytip: "1", glyph: "↶" }],
      mini: [],
      chevrons: { down: "chevron", up: "chevron" },
      strings: {
        label: () => "Barra",
        collapse: () => "Comprimi",
        expand: () => "Mostra",
        unavailable: (label, reason) => `${label}: ${reason}`,
        empty: () => "Nessuna voce",
        mini: () => "Mini-barra",
        quick: () => "Accesso rapido",
      },
      t: (key) => WORDS[key],
      commands: () => states,
      commandable: () => true,
      view: () => view,
      contextShown: () => false,
      command: (id) => {
        gave.push(id);
      },
      openDialog: (id, _params, anchor) => {
        asked.push([id, anchor]);
      },
      chord: (id) => (id === "doc.bold" ? { display: "Ctrl+B", aria: "Control+B" } : null),
      focus: () => {},
      languages: () => () => {},
    });
  });

  afterEach(() => mounted.destroy());

  const ribbonEl = () => place.querySelector<HTMLElement>(".doc-ribbon")!;
  const panels = () => place.querySelector<HTMLElement>(".doc-ribbon-panels")!;
  const press = (label: string) => place.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

  it("Ctrl+F1 ritira la barra e la riapre", () => {
    const f1 = () => root.dispatchEvent(new KeyboardEvent("keydown", { key: "F1", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(ribbonEl().dataset.collapsed).toBe("false");
    f1();
    expect(ribbonEl().dataset.collapsed).toBe("true");
    expect(panels().hidden).toBe(true);
    f1();
    expect(ribbonEl().dataset.collapsed).toBe("false");
    // Con Maiusc non è il suo gesto.
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "F1", ctrlKey: true, shiftKey: true, bubbles: true }));
    expect(ribbonEl().dataset.collapsed).toBe("false");
  });

  it("ritirata, una scheda scelta si apre per un gesto e si richiude fuori dalla barra", () => {
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "F1", ctrlKey: true, bubbles: true }));
    place.querySelector<HTMLElement>(".kit-tab")!.click();
    expect(ribbonEl().dataset.peek).toBe("true");
    expect(panels().hidden).toBe(false);
    root.querySelector("textarea")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(ribbonEl().dataset.peek).toBeUndefined();
    expect(panels().hidden).toBe(true);
    // Un comando dato dalla barra aperta per un gesto la richiude.
    place.querySelector<HTMLElement>(".kit-tab")!.click();
    press("Grassetto").click();
    expect(gave).toEqual(["doc.bold"]);
    expect(panels().hidden).toBe(true);
    expect(ribbonEl().dataset.collapsed).toBe("true");
  });

  it("ha l'accesso rapido accanto alle schede, con il suo nome e il suo punto del Tab", () => {
    const quick = place.querySelector<HTMLElement>(".doc-ribbon-quick")!;
    expect(quick.getAttribute("role")).toBe("toolbar");
    expect(quick.getAttribute("aria-label")).toBe("Accesso rapido");
    expect(quick.nextElementSibling?.getAttribute("role")).toBe("tablist");
    expect([...quick.querySelectorAll("button")].filter((b) => b.tabIndex === 0)).toHaveLength(1);
    press("Righe").click();
    expect(gave).toEqual(["doc.undo"]);
  });

  it("dice l'accordo, apre il riquadro sul suo pulsante e non preme uno spento", () => {
    expect(press("Grassetto").getAttribute("aria-keyshortcuts")).toBe("Control+B");
    press("Timbro").click();
    expect(asked).toEqual([["find", press("Timbro")]]);
    const off = press("Corsivo");
    off.click();
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    off.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(gave).toEqual([]);
  });
});

describe("la barra del kit, il gruppo raccolto", () => {
  type Room = { width: number };
  const GROUPS = ["uno", "due", "tre", "quattro"] as const;
  let root: HTMLElement;
  let place: HTMLElement;
  let mounted: Ribbon<View, Key>;
  let focused: number;
  let room: Room;
  let scrolled: Element[];
  const originalScroll = HTMLElement.prototype.scrollIntoView;

  // Ogni foglietto aperto è largo 100 (70 con `data-dense`), uno raccolto 40:
  // la fila trabocca quando la somma passa la larghezza della barra.
  function measure(toolbar: HTMLElement): void {
    Object.defineProperty(toolbar, "clientWidth", { configurable: true, get: () => room.width });
    Object.defineProperty(toolbar, "scrollWidth", {
      configurable: true,
      get: () => {
        const dense = toolbar.closest<HTMLElement>("[data-dense]")?.dataset.dense === "true";
        return [...toolbar.children]
          .filter((group) => !(group as HTMLElement).hidden)
          .reduce((sum, group) => sum + ((group as HTMLElement).dataset.collapsed === "true" ? 40 : dense ? 70 : 100), 0);
      },
    });
  }

  function mount(openInPlace: boolean): void {
    const tab = (id: string, keytip: string): RibbonTab<KitControl<View, Key>, Key> => ({
      id,
      label: id === "home" ? "home" : "table",
      keytip,
      groups: GROUPS.map((name, at) => ({
        id: `${id}-${name}`,
        label: "font",
        icon: "bold",
        keytip: `Z${at + 1}`,
        columns: [
          { kind: "button", id: `${id}.${name}.a`, label: "bold", keytip: `${at + 1}A`, glyph: "A" },
          { kind: "button", id: `${id}.${name}.b`, label: "italic", keytip: `${at + 1}B`, glyph: "B" },
        ],
      })),
    });
    const tabs = [tab("home", "H"), tab("view", "W")];
    states = tabs.flatMap((one) => one.groups.flatMap((group) => group.columns.map((control) => ({ id: (control as { id: string }).id, enabled: true }))));
    mounted = mountRibbon<View, Key>({
      host: place,
      prefix: "doc-ribbon",
      menuPrefix: "doc.menu.",
      tabs,
      mini: [],
      chevrons: { down: "chevron", up: "chevron" },
      strings: {
        label: () => "Barra",
        collapse: () => "Comprimi",
        expand: () => "Mostra",
        unavailable: (label, reason) => `${label}: ${reason}`,
        empty: () => "Nessuna voce",
        mini: () => "Mini-barra",
      },
      t: (key) => WORDS[key],
      commands: () => states,
      commandable: () => true,
      view: () => view,
      contextShown: () => false,
      command: () => {},
      openDialog: () => {},
      focus: () => {
        focused += 1;
      },
      languages: () => () => {},
      openInPlace,
    });
    for (const toolbar of place.querySelectorAll<HTMLElement>(".doc-ribbon-toolbar")) measure(toolbar);
  }

  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  /// Rilegge la barra e aspetta che si raccolga.
  async function settle(width: number): Promise<void> {
    room.width = width;
    mounted.refresh();
    await frame();
  }
  const panel = () => place.querySelector<HTMLElement>('.doc-ribbon-panel[data-tab="home"]')!;
  const group = (name: string) => panel().querySelector<HTMLElement>(`[data-group="home-${name}"]`)!;
  const toggleOf = (name: string) => group(name).querySelector<HTMLButtonElement>(".doc-ribbon-group-toggle")!;
  const collapsedNames = () => GROUPS.filter((name) => group(name).dataset.collapsed === "true");
  const aloneNames = () => GROUPS.filter((name) => group(name).dataset.alone === "true");
  const openNames = () => GROUPS.filter((name) => group(name).dataset.open === "true");
  const key = (target: EventTarget, name: string) =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  const badges = (container: Element) => [...container.querySelectorAll(".doc-ribbon-keytip")].map((badge) => badge.textContent);

  beforeEach(() => {
    ribbon.destroy();
    document.body.replaceChildren();
    root = document.createElement("div");
    place = document.createElement("div");
    root.append(place);
    document.body.append(root);
    focused = 0;
    room = { width: 1000 };
    scrolled = [];
    HTMLElement.prototype.scrollIntoView = function (this: HTMLElement, options?: boolean | ScrollIntoViewOptions) {
      expect(options).toEqual({ block: "nearest", inline: "nearest" });
      scrolled.push(this);
    };
  });

  afterEach(() => {
    mounted.destroy();
    HTMLElement.prototype.scrollIntoView = originalScroll;
  });

  it("senza l'opzione apre il gruppo raccolto nel riquadro di sempre", async () => {
    mount(false);
    await settle(300);
    expect(collapsedNames()).toEqual(["tre", "quattro"]);
    const toggle = toggleOf("tre");
    expect(toggle.getAttribute("aria-haspopup")).toBe("dialog");
    expect(toggle.hasAttribute("aria-controls")).toBe(false);
    expect(panel().hasAttribute("data-dense")).toBe(false);
    expect(group("quattro").hasAttribute("data-alone")).toBe(false);
    toggle.click();
    const box = document.querySelector<HTMLElement>(".doc-ribbon-popup-group")!;
    expect(box).not.toBeNull();
    expect(box.querySelector('[aria-label="Grassetto"]')).not.toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(group("tre").hasAttribute("data-open")).toBe(false);
  });

  it("nomina il corpo del gruppo e lo apre sul posto, col fuoco sul primo comando", async () => {
    mount(true);
    await settle(300);
    expect(collapsedNames()).toEqual(["tre", "quattro"]);
    const toggle = toggleOf("tre");
    expect(toggle.hasAttribute("aria-haspopup")).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const body = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(body.parentElement).toBe(group("tre"));
    expect(body.id.startsWith("doc-ribbon-body-home-home-tre")).toBe(true);
    toggle.click();
    expect(openNames()).toEqual(["tre"]);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // Il corpo resta nel gruppo, nessun riquadro.
    expect(body.parentElement).toBe(group("tre"));
    expect(document.querySelector(".doc-ribbon-popup-group")).toBeNull();
    // Gli altri gli fanno posto da destra: 100 + 3 × 40 = 220.
    expect(collapsedNames()).toEqual(["due", "quattro"]);
    expect(document.activeElement).toBe(body.querySelector('[aria-label="Grassetto"]'));
    expect(scrolled).toContain(group("tre"));
  });

  it("si apre con ↓ e con Invio, uno alla volta", async () => {
    mount(true);
    await settle(250);
    expect(collapsedNames()).toEqual(["due", "tre", "quattro"]);
    toggleOf("tre").focus();
    key(toggleOf("tre"), "ArrowDown");
    expect(openNames()).toEqual(["tre"]);
    // Un altro richiude il primo.
    toggleOf("due").click();
    expect(openNames()).toEqual(["due"]);
    expect(toggleOf("tre").getAttribute("aria-expanded")).toBe("false");
    expect(collapsedNames()).toEqual(["uno", "tre", "quattro"]);
    // Invio e Spazio restano al pulsante vero, che li trasforma in un clic:
    // la barra non li trattiene.
    toggleOf("tre").focus();
    for (const name of ["Enter", " "]) {
      const press = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
      toggleOf("tre").dispatchEvent(press);
      expect(press.defaultPrevented).toBe(false);
    }
    expect(toggleOf("tre").tagName).toBe("BUTTON");
    toggleOf("tre").click();
    expect(openNames()).toEqual(["tre"]);
  });

  it("Esc richiude il gruppo aperto e torna al suo pulsante; il secondo Esc torna all'editor", async () => {
    mount(true);
    await settle(250);
    toggleOf("tre").click();
    const first = document.activeElement as HTMLElement;
    expect(group("tre").contains(first)).toBe(true);
    key(first, "Escape");
    expect(openNames()).toEqual([]);
    expect(toggleOf("tre").getAttribute("aria-expanded")).toBe("false");
    expect(collapsedNames()).toEqual(["due", "tre", "quattro"]);
    expect(document.activeElement).toBe(toggleOf("tre"));
    expect(focused).toBe(0);
    key(toggleOf("tre"), "Escape");
    expect(focused).toBe(1);
  });

  it("segna l'ultimo raccolto di una fila dispari, e nessun altro", async () => {
    mount(true);
    await settle(300);
    // Due raccolti di fila: a pila, nessuno solo.
    expect(collapsedNames()).toEqual(["tre", "quattro"]);
    expect(aloneNames()).toEqual([]);
    await settle(250);
    // Tre di fila: due a pila, il terzo solo.
    expect(collapsedNames()).toEqual(["due", "tre", "quattro"]);
    expect(aloneNames()).toEqual(["quattro"]);
    // Uno aperto in mezzo spezza la fila: «due» resta solo fra due aperti,
    // «quattro» solo in fondo.
    toggleOf("tre").click();
    expect(collapsedNames()).toEqual(["uno", "due", "quattro"]);
    expect(aloneNames()).toEqual(["quattro"]);
    await settle(300);
    expect(openNames()).toEqual(["tre"]);
    expect(collapsedNames()).toEqual(["due", "quattro"]);
    expect(aloneNames()).toEqual(["due", "quattro"]);
    // Uno solo smette di esserlo quando un altro si raccoglie accanto a lui.
    await settle(230);
    expect(collapsedNames()).toEqual(["uno", "due", "quattro"]);
    expect(aloneNames()).toEqual(["quattro"]);
  });

  it("quando nemmeno così la fila ci sta, il pannello si fa denso", async () => {
    mount(true);
    await settle(300);
    expect(panel().dataset.dense).toBe("false");
    toggleOf("tre").click();
    expect(panel().dataset.dense).toBe("false");
    await settle(200);
    // 100 + 3 × 40 = 220 > 200: il gruppo aperto resta aperto, i gettoni
    // perdono il nome.
    expect(openNames()).toEqual(["tre"]);
    expect(collapsedNames()).toEqual(["uno", "due", "quattro"]);
    expect(panel().dataset.dense).toBe("true");
  });

  it("una sezione cambiata, la barra ritirata o una larghezza che basta lo richiudono", async () => {
    mount(true);
    await settle(250);
    toggleOf("tre").click();
    place.querySelector<HTMLElement>('.kit-tab[data-tab="view"], .kit-tab:nth-of-type(2)')!.click();
    await frame();
    place.querySelector<HTMLElement>(".kit-tab")!.click();
    await frame();
    expect(openNames()).toEqual([]);
    toggleOf("tre").click();
    expect(openNames()).toEqual(["tre"]);
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "F1", ctrlKey: true, bubbles: true }));
    expect(openNames()).toEqual([]);
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "F1", ctrlKey: true, bubbles: true }));
    await frame();
    toggleOf("tre").click();
    await settle(1000);
    expect(collapsedNames()).toEqual([]);
    expect(openNames()).toEqual([]);
    expect(toggleOf("tre").getAttribute("aria-expanded")).toBe("false");
  });

  it("la lettera di Alt di un gruppo raccolto lo apre e mostra le lettere dei suoi comandi", async () => {
    mount(true);
    await settle(250);
    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Alt", bubbles: true }));
    root.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt", bubbles: true, cancelable: true }));
    key(document, "H");
    expect(badges(group("tre"))).toEqual(["Z3"]);
    key(document, "Z");
    key(document, "3");
    expect(openNames()).toEqual(["tre"]);
    expect(badges(group("tre"))).toEqual(["3A", "3B"]);
    // Esc lo richiude e torna alle lettere della scheda.
    key(document, "Escape");
    expect(openNames()).toEqual([]);
    expect(badges(group("tre"))).toEqual(["Z3"]);
  });
});
