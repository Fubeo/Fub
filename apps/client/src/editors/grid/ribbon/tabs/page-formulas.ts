// Le schede Layout di pagina e Formule della barra dei fogli (`../tabs.ts`).

import type { RibbonKey } from "../strings";
import {
  FUNCTION_CATEGORIES,
  functionEntries,
  functionMenu,
  FUNCTIONS,
  type MenuEntry,
  MORE_CATEGORIES,
  PAPERS,
  RECENT,
  recentEntries,
  type RibbonTab,
  THEMES,
  toggle,
} from "./base";
import { autoSumMenu } from "./home";

// ── Layout di pagina ────────────────────────────────────────────────────

export const PAGE_LAYOUT: RibbonTab = {
  id: "page",
  label: "ribbon.tab.page",
  keytip: "P",
  groups: [
    {
      id: "themes",
      label: "ribbon.group.themes",
      icon: "gr-theme",
      keytip: "ZH",
      columns: [
        {
          kind: "menu",
          label: "ribbon.page.themes",
          keytip: "TH",
          icon: "gr-theme",
          size: "large",
          items: () => THEMES.map(({ name, accents }) => ({ label: { raw: name }, id: "pageLayout.theme", params: { name }, swatches: accents })),
        },
      ],
    },
    {
      id: "setup",
      label: "ribbon.group.page_setup",
      icon: "gr-page",
      keytip: "ZP",
      columns: [
        {
          kind: "menu",
          label: "ribbon.page.margins",
          keytip: "M",
          icon: "gr-margins",
          size: "large",
          items: () => [
            { label: "ribbon.page.margins.normal", id: "pageLayout.margins", params: { preset: "normal" } },
            { label: "ribbon.page.margins.wide", id: "pageLayout.margins", params: { preset: "wide" } },
            { label: "ribbon.page.margins.narrow", id: "pageLayout.margins", params: { preset: "narrow" } },
          ],
        },
        {
          kind: "menu",
          label: "ribbon.page.orientation",
          keytip: "O",
          icon: "gr-page-orientation",
          size: "large",
          items: () => [
            { label: "ribbon.page.orientation.portrait", id: "pageLayout.orientation", params: { orientation: "portrait" }, icon: "gr-page" },
            { label: "ribbon.page.orientation.landscape", id: "pageLayout.orientation", params: { orientation: "landscape" }, icon: "gr-page-landscape" },
          ],
        },
        {
          kind: "menu",
          label: "ribbon.page.size",
          keytip: "SZ",
          icon: "gr-paper",
          size: "large",
          items: () => PAPERS.map((paper) => ({ label: { raw: paper }, id: "pageLayout.size", params: { paper } })),
        },
        {
          kind: "menu",
          label: "ribbon.page.print_area",
          keytip: "R",
          icon: "gr-print-area",
          size: "large",
          items: () => [
            { label: "ribbon.page.print_area.set", id: "pageLayout.printArea" },
            { label: "ribbon.page.print_area.clear", id: "pageLayout.printArea", params: { clear: true } },
          ],
        },
        {
          kind: "menu",
          label: "ribbon.page.breaks",
          keytip: "B",
          icon: "gr-breaks",
          size: "large",
          items: () => [
            { label: "ribbon.page.breaks.insert", id: "pageLayout.breaks", params: { insert: true } },
            { label: "ribbon.page.breaks.remove", id: "pageLayout.breaks", params: { remove: true } },
            { label: "ribbon.page.breaks.reset", id: "pageLayout.breaks", params: { reset: true } },
          ],
        },
        {
          kind: "button",
          id: "pageLayout.pageSetup",
          dialog: "pageSetup",
          params: { page: "sheet" },
          label: "ribbon.page.print_titles",
          keytip: "I",
          icon: "gr-print-titles",
          size: "large",
        },
      ],
    },
    {
      id: "print",
      label: "ribbon.group.print",
      icon: "gr-print-preview",
      keytip: "ZS",
      columns: [
        { kind: "button", id: "file.printPreview", dialog: "printPreview", label: "ribbon.page.preview", keytip: "AP", icon: "gr-print-preview", size: "large" },
        { kind: "button", id: "file.exportPdf", shell: "exportPdf", label: "ribbon.page.export_pdf", keytip: "E", icon: "gr-pdf", size: "large" },
        { kind: "button", id: "pageLayout.pageSetup", dialog: "pageSetup", label: "ribbon.page.setup", keytip: "SP", icon: "gr-page-setup", size: "large" },
      ],
    },
    {
      id: "options",
      label: "ribbon.group.sheet_options",
      icon: "gr-gridlines",
      keytip: "ZO",
      columns: [
        {
          rows: [
            [{ kind: "check", id: "view.gridlines", label: "ribbon.page.gridlines.view", keytip: "VG", checked: (v) => v.sheet.gridlines, params: toggle }],
            [{ kind: "check", id: "pageLayout.printGridlines", label: "ribbon.page.gridlines.print", keytip: "PG", checked: (v) => v.sheet.print_gridlines, params: toggle }],
          ],
        },
        {
          rows: [
            [{ kind: "check", id: "view.headings", label: "ribbon.page.headings.view", keytip: "VH", checked: (v) => v.sheet.headings, params: toggle }],
            [{ kind: "check", id: "pageLayout.printHeadings", label: "ribbon.page.headings.print", keytip: "PH", checked: (v) => v.sheet.print_headings, params: toggle }],
          ],
        },
      ],
    },
  ],
};

// ── Formule ─────────────────────────────────────────────────────────────

export const FORMULAS: RibbonTab = {
  id: "formulas",
  label: "ribbon.tab.formulas",
  keytip: "M",
  groups: [
    {
      id: "library",
      label: "ribbon.group.function_library",
      icon: "gr-function",
      keytip: "ZL",
      columns: [
        { kind: "button", id: "formulas.insertFunction", dialog: "insertFunction", label: "ribbon.formulas.insert_function", keytip: "F", glyph: "fx", size: "large" },
        { kind: "split", id: "formulas.autoSum", label: "ribbon.autosum", menuLabel: "ribbon.autosum.menu", keytip: "U", glyph: "Σ", size: "large", menu: () => autoSumMenu() },
        { kind: "menu", label: "ribbon.formulas.recent", keytip: "R", icon: "gr-recent", size: "large", requires: [RECENT], items: (view) => recentEntries(view) },
        functionMenu("ribbon.formulas.financial", "gr-financial", "I", FUNCTION_CATEGORIES.financial),
        functionMenu("ribbon.formulas.logical", "gr-logical", "L", FUNCTION_CATEGORIES.logical),
        functionMenu("ribbon.formulas.text", "gr-text", "T", FUNCTION_CATEGORIES.text),
        functionMenu("ribbon.formulas.date_time", "gr-date", "E", FUNCTION_CATEGORIES.dateTime),
        functionMenu("ribbon.formulas.lookup", "gr-lookup", "O", FUNCTION_CATEGORIES.lookup),
        functionMenu("ribbon.formulas.math", "gr-math", "G", FUNCTION_CATEGORIES.mathTrig),
        {
          kind: "menu",
          label: "ribbon.formulas.more",
          keytip: "Q",
          icon: "gr-more",
          size: "large",
          requires: [FUNCTIONS],
          items: (view) =>
            MORE_CATEGORIES.map(({ category, key }) => ({ label: key, requires: [FUNCTIONS], submenu: () => functionEntries(view, category) })),
        },
      ],
    },
    {
      id: "names",
      label: "ribbon.group.defined_names",
      icon: "gr-name",
      keytip: "ZD",
      columns: [
        { kind: "button", id: "formulas.nameManager", dialog: "nameManager", label: "ribbon.formulas.name_manager", keytip: "N", icon: "gr-name", size: "large" },
        {
          rows: [
            [{ kind: "button", id: "formulas.defineName", dialog: "defineName", label: "ribbon.formulas.define_name", keytip: "A", icon: "gr-name", labelled: true }],
            [
              {
                kind: "menu",
                label: "ribbon.formulas.use_in_formula",
                keytip: "S",
                icon: "gr-function",
                labelled: true,
                requires: ["formulas.useInFormula"],
                items: (view) => (view.book?.names ?? []).map((name) => ({ label: { raw: name }, write: name })),
              },
            ],
            [{ kind: "button", id: "formulas.createFromSelection", label: "ribbon.formulas.create_from_selection", keytip: "C", icon: "gr-name", labelled: true }],
          ],
        },
      ],
    },
    {
      id: "auditing",
      label: "ribbon.group.auditing",
      icon: "gr-precedents",
      keytip: "ZU",
      columns: [
        {
          rows: [
            [{ kind: "button", id: "formulas.selectPrecedents", label: "ribbon.formulas.precedents", keytip: "P", icon: "gr-precedents", labelled: true }],
            [{ kind: "button", id: "formulas.selectDependents", label: "ribbon.formulas.dependents", keytip: "D", icon: "gr-dependents", labelled: true }],
            [{ kind: "button", id: "formulas.showFormulas", label: "ribbon.formulas.show", keytip: "H", icon: "gr-show-formulas", labelled: true, pressed: (v) => v.sheet.formulas }],
          ],
        },
      ],
    },
    {
      id: "calculation",
      label: "ribbon.group.calculation",
      icon: "gr-calc",
      keytip: "ZX",
      columns: [
        {
          kind: "menu",
          label: "ribbon.formulas.calc_options",
          keytip: "X",
          icon: "gr-calc",
          size: "large",
          items: (view) => {
            const mode = view.book?.calculation ?? "automatic";
            const option = (label: RibbonKey, value: string, current: string): MenuEntry => ({
              label,
              id: "formulas.calculationOptions",
              params: { mode: value },
              choice: "radio",
              checked: mode === current,
            });
            return [
              option("ribbon.formulas.calc.automatic", "automatic", "automatic"),
              option("ribbon.formulas.calc.except_tables", "automaticExceptTables", "automatic_except_tables"),
              option("ribbon.formulas.calc.manual", "manual", "manual"),
            ];
          },
        },
        {
          rows: [
            [{ kind: "button", id: "formulas.calculateNow", label: "ribbon.formulas.calc_now", keytip: "B", icon: "gr-calc-now", labelled: true }],
            [{ kind: "button", id: "formulas.calculateSheet", label: "ribbon.formulas.calc_sheet", keytip: "J", icon: "gr-sheet", labelled: true }],
          ],
        },
      ],
    },
  ],
};
