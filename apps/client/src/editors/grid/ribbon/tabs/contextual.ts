// Le schede contestuali della barra dei fogli: Struttura tabella, Struttura
// grafico e Formato dell'oggetto (`../tabs.ts`).

import type { RibbonKey } from "../strings";
import type { Params } from "../../../../kit/ribbon/types";
import { inTable, type MenuEntry, type RibbonTab, type RibbonView, tableOption } from "./base";
import { chartEntries, chartSelected, COLUMN_CHARTS, LINE_CHARTS, OTHER_CHARTS, PIE_CHARTS, SCATTER_CHARTS, shapeSelected, theChart, theObject } from "./insert";

// ── Struttura tabella ───────────────────────────────────────────────────

export const TABLE_DESIGN: RibbonTab = {
  id: "table",
  label: "ribbon.tab.table",
  keytip: "JT",
  contextual: "table",
  groups: [
    {
      id: "properties",
      label: "ribbon.group.properties",
      icon: "gr-table",
      keytip: "ZP",
      columns: [
        {
          kind: "field",
          id: "table.rename",
          label: "ribbon.table.name",
          keytip: "A",
          width: 120,
          value: (view) => view.table?.name ?? "",
          params: (name, view) => ({ ...inTable(view), name }),
        },
        { kind: "button", id: "table.resize", dialog: "tableResize", label: "ribbon.table.resize", keytip: "E", icon: "gr-resize", labelled: true },
      ],
    },
    {
      id: "tools",
      label: "ribbon.group.tools",
      icon: "gr-convert",
      keytip: "ZT",
      columns: [
        { kind: "button", id: "table.removeDuplicates", label: "ribbon.table.remove_duplicates", keytip: "M", icon: "gr-duplicates", size: "large", params: inTable },
        { kind: "button", id: "table.convertToRange", label: "ribbon.table.convert", keytip: "G", icon: "gr-convert", size: "large", params: inTable },
      ],
    },
    {
      id: "options",
      label: "ribbon.group.table_options",
      icon: "gr-checkbox",
      keytip: "ZO",
      columns: [
        {
          rows: [
            [tableOption("table.headerRow", "ribbon.table.header_row", "H", (table) => table.header_row)],
            [tableOption("table.totalRow", "ribbon.table.total_row", "T", (table) => table.totals_row)],
            [tableOption("table.bandedRows", "ribbon.table.banded_rows", "R", (table) => table.banded_rows)],
          ],
        },
        {
          rows: [
            [tableOption("table.firstColumn", "ribbon.table.first_column", "F", (table) => table.first_column)],
            [tableOption("table.lastColumn", "ribbon.table.last_column", "L", (table) => table.last_column)],
            [tableOption("table.bandedColumns", "ribbon.table.banded_columns", "B", (table) => table.banded_columns)],
          ],
        },
      ],
    },
    {
      id: "styles",
      label: "ribbon.group.table_styles",
      icon: "gr-table-style",
      keytip: "ZS",
      columns: [
        {
          kind: "gallery",
          id: "table.style",
          gallery: "table",
          label: "ribbon.table.styles",
          keytip: "S",
          icon: "gr-table-style",
          size: "large",
          params: (name, view) => ({ ...inTable(view), style: name }),
          current: (view) => view.table?.style || null,
        },
      ],
    },
  ],
};

// ── Struttura grafico ───────────────────────────────────────────────────

/// Un elemento del grafico, acceso o spento.
export const chartElement = (key: RibbonKey, element: string, on: boolean, extra: Params = {}, separator = false) =>
  (view: RibbonView): MenuEntry => ({ label: key, id: "chart.addElement", params: { ...theChart(view), element, on, ...extra }, separator });

export const CHART_DESIGN: RibbonTab = {
  id: "chart",
  label: "ribbon.tab.chart",
  keytip: "JC",
  contextual: "chart",
  groups: [
    {
      id: "layouts",
      label: "ribbon.group.chart_layouts",
      icon: "gr-chart-element",
      keytip: "ZL",
      columns: [
        {
          kind: "menu",
          label: "ribbon.chart.add_element",
          keytip: "A",
          icon: "gr-chart-element",
          size: "large",
          items: (view) => [
            chartElement("ribbon.chart.element.title", "title", true)(view),
            chartElement("ribbon.chart.element.no_title", "title", false)(view),
            ...(["bottom", "top", "left", "right"] as const).map((position, at) => ({
              label: `ribbon.chart.legend.${position}` as RibbonKey,
              id: "chart.set",
              params: { ...theChart(view), legend: position },
              separator: at === 0,
            })),
            { label: "ribbon.chart.legend.none", id: "chart.set", params: { ...theChart(view), legend: "none" } },
            chartElement("ribbon.chart.element.data_labels", "dataLabels", true, {}, true)(view),
            chartElement("ribbon.chart.element.no_data_labels", "dataLabels", false)(view),
            chartElement("ribbon.chart.element.gridlines", "gridlines", true, {}, true)(view),
            chartElement("ribbon.chart.element.no_gridlines", "gridlines", false)(view),
            chartElement("ribbon.chart.element.axis_titles", "axisTitles", true, {}, true)(view),
            chartElement("ribbon.chart.element.no_axis_titles", "axisTitles", false)(view),
            chartElement("ribbon.chart.element.trendline", "trendline", true, { type: "linear" }, true)(view),
            chartElement("ribbon.chart.element.no_trendline", "trendline", false)(view),
          ],
        },
        {
          kind: "menu",
          label: "ribbon.chart.quick_layout",
          keytip: "L",
          icon: "gr-chart-layout",
          size: "large",
          items: (view) => [1, 2, 3, 4, 5, 6].map((layout) => ({
            label: { raw: `Layout ${layout}` },
            id: "chart.quickLayout",
            params: { ...theChart(view), layout },
          })),
        },
      ],
    },
    {
      id: "styles",
      label: "ribbon.group.chart_styles",
      icon: "gr-theme",
      keytip: "ZS",
      columns: [
        {
          kind: "menu",
          label: "ribbon.chart.change_colors",
          keytip: "H",
          icon: "gr-theme",
          size: "large",
          items: (view) => [
            { label: "ribbon.chart.colors.colorful", id: "chart.changeColors", params: { ...theChart(view), palette: "colorful" } },
            { label: "ribbon.chart.colors.monochrome", id: "chart.changeColors", params: { ...theChart(view), palette: "monochrome" } },
            ...[1, 2, 3, 4, 5, 6].map((n, at) => ({
              label: `ribbon.chart.colors.accent${n}` as RibbonKey,
              id: "chart.changeColors",
              params: { ...theChart(view), palette: `accent${n}` },
              separator: at === 0,
            })),
          ],
        },
      ],
    },
    {
      id: "data",
      label: "ribbon.group.chart_data",
      icon: "gr-chart-switch",
      keytip: "ZD",
      columns: [
        { kind: "button", id: "chart.switchRowColumn", label: "ribbon.chart.switch_row_column", keytip: "W", icon: "gr-chart-switch", size: "large", params: theChart },
      ],
    },
    {
      id: "type",
      label: "ribbon.group.chart_type",
      icon: "gr-chart-column",
      keytip: "ZT",
      columns: [
        {
          kind: "menu",
          label: "ribbon.chart.change_type",
          keytip: "C",
          icon: "gr-chart-column",
          size: "large",
          items: (view) => [COLUMN_CHARTS, LINE_CHARTS, PIE_CHARTS, SCATTER_CHARTS, OTHER_CHARTS].flatMap((kinds, at) =>
            chartEntries("chart.changeType", kinds, view).map((entry, index) => ({ ...entry, separator: entry.separator || (at > 0 && index === 0) }))),
        },
      ],
    },
  ],
};

// ── Formato dell'oggetto ────────────────────────────────────────────────

export const OBJECT_FORMAT: RibbonTab = {
  id: "object",
  label: "ribbon.tab.object",
  keytip: "JA",
  contextual: "object",
  groups: [
    {
      id: "shape_styles",
      label: "ribbon.group.shape_styles",
      icon: "gr-fill",
      keytip: "ZS",
      columns: [
        {
          rows: [
            [{
              kind: "color",
              id: "chart.shapeFill",
              label: "ribbon.object.fill",
              keytip: "SF",
              icon: "gr-fill",
              labelled: true,
              empty: { value: "none", label: "ribbon.object.fill.none" },
              initial: "#4472C4",
              hex: true,
              when: (view) => chartSelected(view) || shapeSelected(view),
              params: (view) => (chartSelected(view) ? theChart(view) : { kind: "shape", id: view.object?.id }),
            }],
            [{
              kind: "color",
              id: "chart.shapeOutline",
              label: "ribbon.object.outline",
              keytip: "SO",
              icon: "gr-shape-outline",
              labelled: true,
              empty: { value: "none", label: "ribbon.object.outline.none" },
              initial: "#2F5597",
              hex: true,
              when: shapeSelected,
              params: (view) => ({ kind: "shape", id: view.object?.id }),
            }],
          ],
        },
      ],
    },
    {
      id: "arrange",
      label: "ribbon.group.arrange",
      icon: "gr-bring-forward",
      keytip: "ZA",
      columns: [
        {
          rows: [
            [{ kind: "button", id: "arrange.bringForward", label: "ribbon.arrange.forward", keytip: "AF", icon: "gr-bring-forward", labelled: true, params: theObject }],
            [{ kind: "button", id: "arrange.bringForward", label: "ribbon.arrange.front", keytip: "AT", icon: "gr-bring-front", labelled: true, params: (view) => ({ ...theObject(view), toFront: true }) }],
          ],
        },
        {
          rows: [
            [{ kind: "button", id: "arrange.sendBackward", label: "ribbon.arrange.backward", keytip: "AE", icon: "gr-send-backward", labelled: true, params: theObject }],
            [{ kind: "button", id: "arrange.sendBackward", label: "ribbon.arrange.back", keytip: "AB", icon: "gr-send-back", labelled: true, params: (view) => ({ ...theObject(view), toBack: true }) }],
          ],
        },
        { kind: "button", id: "object.delete", label: "ribbon.object.delete", keytip: "D", icon: "gr-delete", size: "large", params: theObject },
      ],
    },
  ],
};
