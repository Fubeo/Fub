// Il presidio delle schede: ogni comando che la barra dà è nel catalogo del
// provider, le lettere di una scheda non si confondono, e i formati dei
// numeri si riconoscono come li riconosce Excel.
import { describe, expect, it } from "vitest";
import fixture from "../../../__fixtures__/xlsx-grid.json";
import { RIBBON_ICONS } from "./icons";
import {
  RIBBON_TABS,
  entryIds,
  groupControls,
  numberFormatOf,
  type MenuEntry,
  type RibbonControl,
  type RibbonView,
} from "./tabs";

const CATALOG = new Set(fixture.session.commands.map((command) => command.id));

/// Una vista senza niente: basta per aprire i menu che non leggono.
const VIEW: RibbonView = {
  style: undefined,
  sheet: {
    frozen_rows: 0,
    frozen_columns: 0,
    gridlines: true,
    headings: true,
    zoom: 100,
    right_to_left: false,
    mode: "normal",
    formulas: false,
    protected: false,
    print_gridlines: false,
    print_headings: false,
  },
  book: { theme_colors: [], names: ["Totale"], calculation: "automatic", protected: false, font: "Calibri", font_size: 11 },
  table: null,
  theme: [],
  hidden: [{ id: "s2", name: "Nascosto" }],
  viewport: { width: 800, height: 600 },
  query: async () => null,
};

/// Le voci di un menu, con quelle dei menu che apre, finché arrivano subito.
function allEntries(entries: readonly MenuEntry[]): MenuEntry[] {
  return entries.flatMap((entry) => {
    const inner = entry.submenu?.();
    return [entry, ...(inner && !(inner instanceof Promise) ? allEntries(inner) : [])];
  });
}

function controlEntries(control: RibbonControl): MenuEntry[] {
  if (control.kind === "split") return allEntries(control.menu(VIEW));
  if (control.kind !== "menu") return [];
  const items = control.items(VIEW);
  return items instanceof Promise ? [] : allEntries(items);
}

describe("le schede della barra", () => {
  const controls = RIBBON_TABS.flatMap((tab) => tab.groups.flatMap(groupControls));

  it("danno soltanto comandi del catalogo del provider", () => {
    for (const control of controls) {
      const ids = [
        ...("id" in control ? [control.id] : []),
        ...(control.kind === "menu" ? control.requires ?? [] : []),
        ...entryIds(controlEntries(control)),
      ];
      for (const id of ids) expect(CATALOG.has(id), `«${id}» (${control.label}) non è nel catalogo`).toBe(true);
    }
  });

  it("hanno lettere che non si confondono dentro una scheda", () => {
    const tabs = RIBBON_TABS.map((tab) => tab.keytip);
    for (const a of tabs) for (const b of tabs) if (a !== b) expect(b.startsWith(a), `${a} e ${b}`).toBe(false);
    for (const tab of RIBBON_TABS) {
      const tips = [...new Set([...tab.groups.map((group) => group.keytip), ...tab.groups.flatMap(groupControls).map((c) => c.keytip)])];
      const all = [...tab.groups.map((group) => group.keytip), ...tab.groups.flatMap(groupControls).map((c) => c.keytip)];
      expect(all.length, `una lettera doppia nella scheda ${tab.id}`).toBe(tips.length);
      for (const a of tips) {
        expect(a).toMatch(/^[A-Z0-9]{1,2}$/);
        for (const b of tips) if (a !== b) expect(b.startsWith(a), `${tab.id}: ${a} è l'inizio di ${b}`).toBe(false);
      }
    }
  });

  it("chiedono il comando di un menu le cui voci arrivano dopo", () => {
    for (const control of controls) {
      if (control.kind !== "menu" || control.requires) continue;
      expect(control.items(VIEW) instanceof Promise, `${control.label} non dice che cosa chiede`).toBe(false);
    }
  });

  it("disegnano soltanto figure che la barra conosce", () => {
    const named = [
      ...RIBBON_TABS.flatMap((tab) => tab.groups.map((group) => group.icon)),
      ...controls.flatMap((control) => [control.icon, ...controlEntries(control).map((entry) => entry.icon)]),
    ].filter((name): name is string => name !== undefined);
    for (const name of named) expect(RIBBON_ICONS[name], `l'icona ${name} manca`).toBeDefined();
  });

  it("hanno ciascuna id diversi", () => {
    for (const tab of RIBBON_TABS) {
      const ids = tab.groups.map((group) => group.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("il formato dei numeri della cella", () => {
  it("si riconosce dalla famiglia", () => {
    expect(numberFormatOf(undefined)).toBe("General");
    expect(numberFormatOf("General")).toBe("General");
    expect(numberFormatOf("@")).toBe("Text");
    expect(numberFormatOf("0.00")).toBe("Number");
    expect(numberFormatOf("#,##0")).toBe("Number");
    expect(numberFormatOf("0%")).toBe("Percentage");
    expect(numberFormatOf("0.00E+00")).toBe("Scientific");
    expect(numberFormatOf("# ?/?")).toBe("Fraction");
    expect(numberFormatOf("h:mm:ss")).toBe("Time");
    expect(numberFormatOf("dddd, mmmm d, yyyy")).toBe("Long Date");
    expect(numberFormatOf("m/d/yyyy")).toBe("Short Date");
    expect(numberFormatOf('"$"#,##0.00')).toBe("Currency");
    expect(numberFormatOf("[$€-x-euro2] #,##0.00")).toBe("Currency");
    expect(numberFormatOf('_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)')).toBe("Accounting");
  });

  it("dice `null` per un formato suo", () => {
    expect(numberFormatOf('0 "kg"')).toBe(null);
  });
});
