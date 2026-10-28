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
