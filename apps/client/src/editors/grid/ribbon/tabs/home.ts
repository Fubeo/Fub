// La scheda Home della barra dei fogli, con i colori delle linguette, la
// Somma automatica e i menu della formattazione condizionale (`../tabs.ts`).

import { t, type RibbonKey } from "../strings";
import type { Params } from "../../../../kit/ribbon/types";
import { ACCOUNTING, FONT_SIZES, FONTS, type MenuEntry, NUMBER_FORMATS, numberFormatOf, type RibbonTab, style } from "./base";

// ── Home ────────────────────────────────────────────────────────────────

export const HOME: RibbonTab = {
  id: "home",
  label: "ribbon.tab.home",
  keytip: "H",
  groups: [
    {
      id: "font",
      label: "ribbon.group.font",
      icon: "gr-font",
      keytip: "ZF",
      columns: [
        {
          rows: [
            [
              {
                kind: "select",
                id: "home.fontName",
                label: "ribbon.font.name",
                keytip: "FF",
                width: 132,
                options: (view) =>
                  [...new Set([...FONTS, ...[view.style?.font, view.book?.font].filter((font): font is string => !!font)])]
                    .sort((a, b) => a.localeCompare(b))
                    .map((font) => ({ value: font, label: { raw: font } })),
                value: (view) => view.style?.font ?? view.book?.font ?? null,
                params: (name) => (name ? { name } : null),
              },
              {
                kind: "select",
                id: "home.fontSize",
                label: "ribbon.font.size",
                keytip: "FS",
                width: 56,
                options: (view) =>
                  [...new Set([...FONT_SIZES, ...[view.style?.font_size, view.book?.font_size].filter((size): size is number => !!size)])]
                    .sort((a, b) => a - b)
                    .map((size) => ({ value: String(size), label: { raw: String(size) } })),
                value: (view) => {
                  const size = view.style?.font_size ?? view.book?.font_size;
                  return size ? String(size) : null;
                },
                params: (value) => (Number(value) > 0 ? { size: Number(value) } : null),
              },
              { kind: "button", id: "home.increaseFontSize", label: "ribbon.font.grow", keytip: "FG", glyph: "A⁺" },
              { kind: "button", id: "home.decreaseFontSize", label: "ribbon.font.shrink", keytip: "FK", glyph: "A⁻" },
            ],
            [
              { kind: "button", id: "home.bold", label: "ribbon.font.bold", keytip: "1", glyph: () => t("ribbon.glyph.bold"), className: "grid-ribbon-bold", pressed: (v) => style(v)?.bold === true },
              { kind: "button", id: "home.italic", label: "ribbon.font.italic", keytip: "2", glyph: () => t("ribbon.glyph.italic"), className: "grid-ribbon-italic", pressed: (v) => style(v)?.italic === true },
              {
                kind: "split",
                id: "home.underline",
                label: "ribbon.font.underline",
                menuLabel: "ribbon.font.underline.menu",
                keytip: "3",
                glyph: () => t("ribbon.glyph.underline"),
                className: "grid-ribbon-underline",
                pressed: (v) => (style(v)?.underline ?? null) !== null,
                menu: (v) => [
                  { label: "ribbon.font.underline.single", id: "home.underline", params: { style: "single" }, choice: "radio", checked: style(v)?.underline === "single" },
                  { label: "ribbon.font.underline.double", id: "home.underline", params: { style: "double" }, choice: "radio", checked: style(v)?.underline === "double" },
                ],
              },
              { kind: "button", id: "home.strikethrough", label: "ribbon.font.strike", keytip: "4", glyph: "abc", className: "grid-ribbon-strike", pressed: (v) => style(v)?.strike === true },
              {
                kind: "split",
                id: "home.borders",
                label: "ribbon.borders",
                menuLabel: "ribbon.borders.menu",
                keytip: "B",
                icon: "gr-border-bottom",
                params: { preset: "bottom" },
                remember: true,
                menu: () => [
                  { label: "ribbon.borders.bottom", id: "home.borders", params: { preset: "bottom" }, icon: "gr-border-bottom" },
                  { label: "ribbon.borders.top", id: "home.borders", params: { preset: "top" }, icon: "gr-border-top" },
                  { label: "ribbon.borders.left", id: "home.borders", params: { preset: "left" }, icon: "gr-border-left" },
                  { label: "ribbon.borders.right", id: "home.borders", params: { preset: "right" }, icon: "gr-border-right" },
                  { label: "ribbon.borders.none", id: "home.borders", params: { preset: "none" }, icon: "gr-border-none", separator: true },
                  { label: "ribbon.borders.all", id: "home.borders", params: { preset: "all" }, icon: "gr-border-all" },
                  { label: "ribbon.borders.outside", id: "home.borders", params: { preset: "outside" }, icon: "gr-border-outside" },
                  { label: "ribbon.borders.thick_outside", id: "home.borders", params: { preset: "thickOutside" }, icon: "gr-border-thick" },
                  { label: "ribbon.borders.inside", id: "home.borders", params: { preset: "inside" }, icon: "gr-border-inside" },
                  { label: "ribbon.borders.double_bottom", id: "home.borders", params: { preset: "doubleBottom" }, icon: "gr-border-double", separator: true },
                  { label: "ribbon.borders.thick_bottom", id: "home.borders", params: { preset: "thickBottom" }, icon: "gr-border-thick-bottom" },
                  { label: "ribbon.borders.top_bottom", id: "home.borders", params: { preset: "topBottom" }, icon: "gr-border-top-bottom" },
                  { label: "ribbon.borders.top_thick_bottom", id: "home.borders", params: { preset: "topThickBottom" }, icon: "gr-border-top-bottom" },
                  { label: "ribbon.borders.top_double_bottom", id: "home.borders", params: { preset: "topDoubleBottom" }, icon: "gr-border-top-bottom" },
                  { label: "ribbon.borders.more", id: "home.formatCells", dialog: "formatCells", params: { tab: "border" }, separator: true },
                ],
              },
              { kind: "color", id: "home.fillColor", label: "ribbon.fill", keytip: "H", icon: "gr-fill", empty: { value: "none", label: "ribbon.fill.none" }, initial: "#FFFF00" },
              { kind: "color", id: "home.fontColor", label: "ribbon.font.color", keytip: "FC", glyph: "A", empty: { value: "auto", label: "ribbon.font.color.auto" }, initial: "#FF0000" },
            ],
          ],
        },
      ],
    },
    {
      id: "alignment",
      label: "ribbon.group.alignment",
      icon: "gr-align-center",
      keytip: "ZA",
      columns: [
        {
          rows: [
            [
              { kind: "button", id: "home.alignTop", label: "ribbon.align.top", keytip: "AT", icon: "gr-align-top", pressed: (v) => style(v)?.vertical === "top" },
              { kind: "button", id: "home.alignMiddle", label: "ribbon.align.middle", keytip: "AM", icon: "gr-align-middle", pressed: (v) => style(v)?.vertical === "center" },
              { kind: "button", id: "home.alignBottom", label: "ribbon.align.bottom", keytip: "AB", icon: "gr-align-bottom", pressed: (v) => (style(v)?.vertical ?? "bottom") === "bottom" },
              {
                kind: "menu",
                label: "ribbon.orientation",
                keytip: "FQ",
                icon: "gr-orientation",
                items: (v) => {
                  const rotation = style(v)?.rotation ?? 0;
                  const entry = (label: RibbonKey, angle: string | number, icon: string, at: number): MenuEntry => ({
                    label,
                    id: "home.orientation",
                    params: { angle },
                    icon,
                    choice: "radio",
                    checked: rotation === at,
                  });
                  return [
                    entry("ribbon.orientation.counterclockwise", "counterclockwise", "gr-orientation", 45),
                    entry("ribbon.orientation.clockwise", "clockwise", "gr-orientation-down", -45),
                    entry("ribbon.orientation.vertical", "vertical", "gr-orientation-vertical", 255),
                    entry("ribbon.orientation.up", "up", "gr-orientation-up", 90),
                    entry("ribbon.orientation.down", "down", "gr-orientation-down", -90),
                    { ...entry("ribbon.orientation.horizontal", 0, "gr-align-left", 0), separator: true },
                    { label: "ribbon.orientation.format", id: "home.formatCells", dialog: "formatCells", params: { tab: "alignment" }, separator: true },
                  ];
                },
              },
              { kind: "button", id: "home.wrapText", label: "ribbon.wrap", keytip: "W", icon: "gr-wrap", labelled: true, pressed: (v) => style(v)?.wrap === true },
            ],
            [
              { kind: "button", id: "home.alignLeft", label: "ribbon.align.left", keytip: "AL", icon: "gr-align-left", pressed: (v) => style(v)?.horizontal === "start" },
              { kind: "button", id: "home.alignCenter", label: "ribbon.align.center", keytip: "AC", icon: "gr-align-center", pressed: (v) => style(v)?.horizontal === "center" },
              { kind: "button", id: "home.alignRight", label: "ribbon.align.right", keytip: "AR", icon: "gr-align-right", pressed: (v) => style(v)?.horizontal === "end" },
              { kind: "button", id: "home.decreaseIndent", label: "ribbon.indent.decrease", keytip: "5", icon: "gr-indent-less" },
              { kind: "button", id: "home.increaseIndent", label: "ribbon.indent.increase", keytip: "6", icon: "gr-indent-more" },
              {
                kind: "split",
                id: "home.mergeCenter",
                label: "ribbon.merge",
                menuLabel: "ribbon.merge.menu",
                keytip: "M",
                icon: "gr-merge",
                labelled: true,
                menu: () => [
                  { label: "ribbon.merge", id: "home.mergeCenter", icon: "gr-merge" },
                  { label: "ribbon.merge.across", id: "home.mergeAcross", icon: "gr-merge-across" },
                  { label: "ribbon.merge.cells", id: "home.mergeCells", icon: "gr-merge-cells" },
                  { label: "ribbon.merge.unmerge", id: "home.unmergeCells", icon: "gr-unmerge" },
                ],
              },
            ],
          ],
        },
      ],
    },
    {
      id: "number",
      label: "ribbon.group.number",
      icon: "gr-number",
      keytip: "ZN",
      columns: [
        {
          rows: [
            [
              {
                kind: "select",
                id: "home.numberFormat",
                label: "ribbon.number.format",
                keytip: "N",
                width: 132,
                options: () => NUMBER_FORMATS.map(({ format, key }) => ({ value: format, label: key })),
                value: (view) => numberFormatOf(view.style?.number_format),
                params: (format) => (format ? { format } : null),
              },
            ],
            [
              {
                kind: "split",
                id: "home.accounting",
                label: "ribbon.accounting",
                menuLabel: "ribbon.accounting.menu",
                keytip: "AN",
                icon: "gr-accounting",
                menu: () => [
                  ...ACCOUNTING.map(({ key, code }): MenuEntry => ({ label: key, id: "home.numberFormat", params: { code } })),
                  { label: "ribbon.accounting.more", id: "home.formatCells", dialog: "formatCells", params: { tab: "number" }, separator: true },
                ],
              },
              { kind: "button", id: "home.percent", label: "ribbon.percent", keytip: "P", glyph: "%" },
              { kind: "button", id: "home.comma", label: "ribbon.comma", keytip: "K", glyph: "000" },
              { kind: "button", id: "home.increaseDecimal", label: "ribbon.decimal.increase", keytip: "0", icon: "gr-decimal-more" },
              { kind: "button", id: "home.decreaseDecimal", label: "ribbon.decimal.decrease", keytip: "9", icon: "gr-decimal-less" },
            ],
          ],
        },
      ],
    },
    {
      id: "styles",
      label: "ribbon.group.styles",
      icon: "gr-styles",
      keytip: "ZS",
      columns: [
        {
          kind: "menu",
          label: "ribbon.cf",
          keytip: "L",
          icon: "gr-cf",
          size: "large",
          items: () => conditionalMenu(),
        },
        {
          kind: "gallery",
          id: "home.formatAsTable",
          gallery: "table",
          label: "ribbon.format_as_table",
          keytip: "T",
          icon: "gr-table-style",
          size: "large",
          params: (name) => ({ style: name }),
        },
        {
          kind: "gallery",
          id: "home.cellStyle",
          gallery: "cell",
          label: "ribbon.cell_styles",
          keytip: "J",
          icon: "gr-cell-style",
          size: "large",
          params: (name) => ({ name }),
        },
      ],
    },
    {
      id: "cells",
      label: "ribbon.group.cells",
      icon: "gr-cells",
      keytip: "ZC",
      columns: [
        {
          kind: "menu",
          label: "ribbon.cells.insert",
          keytip: "I",
          icon: "gr-insert",
          size: "large",
          items: () => [
            { label: "ribbon.cells.insert.rows", id: "home.insertRows", icon: "gr-insert-row" },
            { label: "ribbon.cells.insert.columns", id: "home.insertColumns", icon: "gr-insert-column" },
            { label: "ribbon.cells.insert.down", id: "home.insertCells", params: { shift: "down" }, separator: true },
            { label: "ribbon.cells.insert.right", id: "home.insertCells", params: { shift: "right" } },
            { label: "ribbon.cells.insert.cells", id: "home.insertCells", dialog: "insertCells" },
            { label: "ribbon.cells.insert.sheet", id: "home.insertSheet", icon: "gr-sheet", separator: true },
          ],
        },
        {
          kind: "menu",
          label: "ribbon.cells.delete",
          keytip: "D",
          icon: "gr-delete",
          size: "large",
          items: () => [
            { label: "ribbon.cells.delete.rows", id: "home.deleteRows", icon: "gr-delete-row" },
            { label: "ribbon.cells.delete.columns", id: "home.deleteColumns", icon: "gr-delete-column" },
            { label: "ribbon.cells.delete.up", id: "home.deleteCells", params: { shift: "up" }, separator: true },
            { label: "ribbon.cells.delete.left", id: "home.deleteCells", params: { shift: "left" } },
            { label: "ribbon.cells.delete.cells", id: "home.deleteCells", dialog: "deleteCells" },
            { label: "ribbon.cells.delete.sheet", id: "home.deleteSheet", icon: "gr-sheet", separator: true },
          ],
        },
        {
          kind: "menu",
          label: "ribbon.cells.format",
          keytip: "O",
          icon: "gr-format",
          size: "large",
          items: (view) => [
            { label: "ribbon.cells.format.row_height", id: "home.rowHeight", dialog: "rowHeight" },
            { label: "ribbon.cells.format.autofit_rows", id: "home.autofitRowHeight" },
            { label: "ribbon.cells.format.column_width", id: "home.columnWidth", dialog: "columnWidth" },
            { label: "ribbon.cells.format.autofit_columns", id: "home.autofitColumnWidth" },
            { label: "ribbon.cells.format.default_width", id: "home.defaultWidth", dialog: "defaultWidth" },
            { label: "ribbon.cells.format.hide_rows", id: "home.hideRows", separator: true },
            { label: "ribbon.cells.format.hide_columns", id: "home.hideColumns" },
            { label: "ribbon.cells.format.unhide_rows", id: "home.unhideRows" },
            { label: "ribbon.cells.format.unhide_columns", id: "home.unhideColumns" },
            { label: "ribbon.cells.format.hide_sheet", id: "sheet.hide", separator: true },
            {
              label: "ribbon.cells.format.unhide_sheet",
              requires: ["sheet.unhide"],
              submenu: () => view.hidden.map((sheet) => ({ label: { raw: sheet.name }, id: "sheet.unhide", params: { sheet: sheet.name } })),
            },
            {
              label: "ribbon.cells.format.tab_color",
              requires: ["sheet.tabColor"],
              submenu: () => [
                { label: "ribbon.cells.format.tab_color.none", id: "sheet.tabColor", params: { color: "none" } },
                ...TAB_COLORS.map(({ key, hex }) => ({ label: key, id: "sheet.tabColor", params: { color: hex }, swatches: [hex] })),
              ],
            },
            { label: "ribbon.cells.format.rename_sheet", id: "sheet.rename", dialog: "renameSheet", separator: true },
            { label: "ribbon.cells.format.move_sheet", id: "sheet.move", dialog: "moveSheet" },
            { label: "ribbon.cells.format.protect_sheet", id: "review.protectSheet", dialog: "protectSheet", separator: true },
            { label: "ribbon.cells.format.lock", id: "home.lockCell" },
            { label: "ribbon.cells.format.cells", id: "home.formatCells", dialog: "formatCells", icon: "gr-format" },
          ],
        },
      ],
    },
    {
      id: "editing",
      label: "ribbon.group.editing",
      icon: "gr-sum",
      keytip: "ZE",
      columns: [
        {
          rows: [
            [
              {
                kind: "split",
                id: "formulas.autoSum",
                label: "ribbon.autosum",
                menuLabel: "ribbon.autosum.menu",
                keytip: "U",
                glyph: "Σ",
                labelled: true,
                menu: () => autoSumMenu(),
              },
            ],
            [
              {
                kind: "menu",
                label: "ribbon.fill_menu",
                keytip: "FI",
                icon: "gr-fill-down",
                labelled: true,
                items: () => [
                  { label: "ribbon.fill_menu.down", id: "edit.fillDown", icon: "gr-arrow-down" },
                  { label: "ribbon.fill_menu.right", id: "edit.fillRight", icon: "gr-arrow-right" },
                  { label: "ribbon.fill_menu.up", id: "edit.fillUp", icon: "gr-arrow-up" },
                  { label: "ribbon.fill_menu.left", id: "edit.fillLeft", icon: "gr-arrow-left" },
                  { label: "ribbon.fill_menu.series", id: "edit.fillSeries", dialog: "series", separator: true },
                  { label: "ribbon.fill_menu.flash", id: "edit.flashFill", icon: "gr-flash" },
                ],
              },
            ],
            [
              {
                kind: "menu",
                label: "ribbon.clear",
                keytip: "E",
                icon: "gr-clear",
                labelled: true,
                items: () => [
                  { label: "ribbon.clear.all", id: "edit.clearAll" },
                  { label: "ribbon.clear.formats", id: "edit.clearFormats" },
                  { label: "ribbon.clear.contents", id: "edit.clearContents" },
                  { label: "ribbon.clear.comments", id: "edit.clearComments" },
                  { label: "ribbon.clear.hyperlinks", id: "edit.clearHyperlinks" },
                ],
              },
            ],
          ],
        },
        {
          kind: "menu",
          label: "ribbon.sort_filter",
          keytip: "S",
          icon: "gr-sort-filter",
          size: "large",
          items: () => [
            { label: "ribbon.sort.ascending", id: "data.sortAscending", icon: "gr-sort-asc" },
            { label: "ribbon.sort.descending", id: "data.sortDescending", icon: "gr-sort-desc" },
            { label: "ribbon.sort.custom", id: "data.sort", dialog: "sort", icon: "gr-sort" },
            { label: "ribbon.filter", id: "data.filter", icon: "gr-filter", separator: true },
            { label: "ribbon.filter.clear", id: "data.clearFilter", icon: "gr-filter-clear" },
            { label: "ribbon.filter.reapply", id: "data.reapply", icon: "gr-reapply" },
          ],
        },
        {
          kind: "menu",
          label: "ribbon.find_select",
          keytip: "FD",
          icon: "gr-find",
          size: "large",
          items: () => [
            { label: "ribbon.find", id: "edit.find", dialog: "find", icon: "gr-find" },
            { label: "ribbon.replace", id: "edit.replace", dialog: "find", params: { replace: true } },
            { label: "ribbon.go_to", id: "edit.goTo", dialog: "goTo" },
            { label: "ribbon.go_to_special", id: "edit.goToSpecial", dialog: "goToSpecial" },
            { label: "ribbon.select.formulas", id: "edit.goToSpecial", params: { kind: "formulas" }, separator: true },
            { label: "ribbon.select.comments", id: "edit.goToSpecial", params: { kind: "comments" } },
            { label: "ribbon.select.conditional", id: "edit.goToSpecial", params: { kind: "conditionalFormats" } },
            { label: "ribbon.select.constants", id: "edit.goToSpecial", params: { kind: "constants" } },
            { label: "ribbon.select.validation", id: "edit.goToSpecial", params: { kind: "dataValidation" } },
            { label: "ribbon.select.blanks", id: "edit.goToSpecial", params: { kind: "blanks" }, separator: true },
            { label: "ribbon.select.errors", id: "edit.goToSpecial", params: { kind: "errors" } },
            { label: "ribbon.select.last", id: "edit.goToSpecial", params: { kind: "lastCell" } },
          ],
        },
      ],
    },
  ],
};

/// I colori delle linguette dei fogli: quelli standard di Excel.
export const TAB_COLORS: readonly { readonly key: RibbonKey; readonly hex: string }[] = [
  { key: "ribbon.color.dark_red", hex: "#C00000" },
  { key: "ribbon.color.red", hex: "#FF0000" },
  { key: "ribbon.color.orange", hex: "#FFC000" },
  { key: "ribbon.color.yellow", hex: "#FFFF00" },
  { key: "ribbon.color.light_green", hex: "#92D050" },
  { key: "ribbon.color.green", hex: "#00B050" },
  { key: "ribbon.color.light_blue", hex: "#00B0F0" },
  { key: "ribbon.color.blue", hex: "#0070C0" },
  { key: "ribbon.color.dark_blue", hex: "#002060" },
  { key: "ribbon.color.purple", hex: "#7030A0" },
];

/// Le funzioni di Somma automatica.
export function autoSumMenu(): readonly MenuEntry[] {
  return [
    { label: "ribbon.autosum.sum", id: "formulas.autoSum", params: { function: "SUM" } },
    { label: "ribbon.autosum.average", id: "formulas.autoSum", params: { function: "AVERAGE" } },
    { label: "ribbon.autosum.count", id: "formulas.autoSum", params: { function: "COUNT" } },
    { label: "ribbon.autosum.max", id: "formulas.autoSum", params: { function: "MAX" } },
    { label: "ribbon.autosum.min", id: "formulas.autoSum", params: { function: "MIN" } },
  ];
}

export const CF = "home.conditionalFormat";
export const rule = (value: Params): Params => ({ rule: value });

/// Una regola rapida, chiesta dalla sua finestra (`cfQuick`).
export const quick = (label: RibbonKey, params: Params, separator = false): MenuEntry => ({ label, id: CF, dialog: "cfQuick", params, separator });

/// La formattazione condizionale: le regole con un valore da scrivere
/// (Maggiore di…, Primi 10…) aprono la loro finestra; quelle senza si danno
/// subito.
export function conditionalMenu(): readonly MenuEntry[] {
  const more: MenuEntry = { label: "ribbon.cf.more_rules", id: CF, dialog: "newFormattingRule", separator: true };
  return [
    {
      label: "ribbon.cf.highlight",
      requires: [CF],
      icon: "gr-cf",
      submenu: () => [
        quick("ribbon.cf.greater", { type: "cellIs", operator: "greater" }),
        quick("ribbon.cf.less", { type: "cellIs", operator: "less" }),
        quick("ribbon.cf.between", { type: "cellIs", operator: "between" }),
        quick("ribbon.cf.equal", { type: "cellIs", operator: "equal" }),
        quick("ribbon.cf.text", { type: "containsText" }),
        quick("ribbon.cf.date", { type: "timePeriod" }),
        quick("ribbon.cf.duplicates", { type: "duplicate" }),
        { label: "ribbon.cf.duplicate", id: CF, params: rule({ type: "duplicate", preset: "lightRedFillDarkRedText" }), separator: true },
        { label: "ribbon.cf.unique", id: CF, params: rule({ type: "unique", preset: "lightRedFillDarkRedText" }) },
        { label: "ribbon.cf.blanks", id: CF, params: rule({ type: "blanks", preset: "yellowFill" }) },
        { label: "ribbon.cf.errors", id: CF, params: rule({ type: "errors", preset: "lightRedFillDarkRedText" }) },
        more,
      ],
    },
    {
      label: "ribbon.cf.top_bottom",
      requires: [CF],
      icon: "gr-cf-top",
      submenu: () => [
        quick("ribbon.cf.top10", { type: "top10", rank: 10 }),
        quick("ribbon.cf.top10_percent", { type: "top10", rank: 10, percent: true }),
        quick("ribbon.cf.bottom10", { type: "top10", rank: 10, bottom: true }),
        quick("ribbon.cf.bottom10_percent", { type: "top10", rank: 10, bottom: true, percent: true }),
        quick("ribbon.cf.above_average", { type: "aboveAverage" }, true),
        quick("ribbon.cf.below_average", { type: "aboveAverage", below: true }),
        more,
      ],
    },
    {
      label: "ribbon.cf.data_bars",
      requires: [CF],
      icon: "gr-cf-bars",
      submenu: () =>
        DATA_BARS.map(({ key, color }) => ({ label: key, id: CF, params: rule({ type: "dataBar", color }), swatches: [color] })),
    },
    {
      label: "ribbon.cf.color_scales",
      requires: [CF],
      icon: "gr-cf-scale",
      submenu: () =>
        COLOR_SCALES.map(({ key, colors }) => ({ label: key, id: CF, params: rule({ type: "colorScale", colors }), swatches: colors })),
    },
    {
      label: "ribbon.cf.icon_sets",
      requires: [CF],
      icon: "gr-cf-icons",
      submenu: () => ICON_SETS.map(({ key, set }) => ({ label: key, id: CF, params: rule({ type: "iconSet", set }) })),
    },
    {
      label: "ribbon.cf.clear",
      requires: ["home.clearRules"],
      separator: true,
      submenu: () => [
        { label: "ribbon.cf.clear.selection", id: "home.clearRules" },
        { label: "ribbon.cf.clear.sheet", id: "home.clearRules", params: { sheet: true } },
      ],
    },
    { label: "ribbon.cf.new_rule", id: CF, dialog: "newFormattingRule", separator: true },
    { label: "ribbon.cf.manage", id: "home.manageRules", dialog: "manageRules" },
  ];
}

export const DATA_BARS: readonly { readonly key: RibbonKey; readonly color: string }[] = [
  { key: "ribbon.cf.bar.blue", color: "#638EC6" },
  { key: "ribbon.cf.bar.green", color: "#63BE7B" },
  { key: "ribbon.cf.bar.red", color: "#F8696B" },
  { key: "ribbon.cf.bar.orange", color: "#FFB628" },
  { key: "ribbon.cf.bar.light_blue", color: "#008AEF" },
  { key: "ribbon.cf.bar.purple", color: "#D6007B" },
];

export const COLOR_SCALES: readonly { readonly key: RibbonKey; readonly colors: readonly string[] }[] = [
  { key: "ribbon.cf.scale.gyr", colors: ["#63BE7B", "#FFEB84", "#F8696B"] },
  { key: "ribbon.cf.scale.ryg", colors: ["#F8696B", "#FFEB84", "#63BE7B"] },
  { key: "ribbon.cf.scale.gwr", colors: ["#63BE7B", "#FCFCFF", "#F8696B"] },
  { key: "ribbon.cf.scale.bwr", colors: ["#5A8AC6", "#FCFCFF", "#F8696B"] },
  { key: "ribbon.cf.scale.wg", colors: ["#FCFCFF", "#63BE7B"] },
  { key: "ribbon.cf.scale.wr", colors: ["#FCFCFF", "#F8696B"] },
];

export const ICON_SETS: readonly { readonly key: RibbonKey; readonly set: string }[] = [
  { key: "ribbon.cf.icons.arrows3", set: "3Arrows" },
  { key: "ribbon.cf.icons.traffic3", set: "3TrafficLights1" },
  { key: "ribbon.cf.icons.symbols3", set: "3Symbols" },
  { key: "ribbon.cf.icons.rating4", set: "4Rating" },
  { key: "ribbon.cf.icons.arrows5", set: "5Arrows" },
  { key: "ribbon.cf.icons.quarters5", set: "5Quarters" },
];
