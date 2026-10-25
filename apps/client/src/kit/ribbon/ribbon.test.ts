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
