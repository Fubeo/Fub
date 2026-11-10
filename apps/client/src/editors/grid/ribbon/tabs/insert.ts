// La scheda Inserisci della barra dei fogli, con le forme, le icone e i
// grafici (`../tabs.ts`).

import type { RibbonKey } from "../strings";
import type { Params } from "../../../../kit/ribbon/types";
import { type MenuControl, type MenuEntry, type RibbonTab, type RibbonView, SYMBOLS } from "./base";

// ── Inserisci ───────────────────────────────────────────────────────────

/// Le forme del menu Forme, come le chiama `insert.shape`.
export const SHAPES: readonly { readonly kind: string; readonly key: RibbonKey; readonly icon: string }[] = [
  { kind: "rectangle", key: "ribbon.shape.rectangle", icon: "gr-shape-rectangle" },
  { kind: "roundedRectangle", key: "ribbon.shape.rounded_rectangle", icon: "gr-shape-rounded" },
  { kind: "ellipse", key: "ribbon.shape.ellipse", icon: "gr-shape-ellipse" },
  { kind: "triangle", key: "ribbon.shape.triangle", icon: "gr-shape-triangle" },
  { kind: "line", key: "ribbon.shape.line", icon: "gr-shape-line" },
  { kind: "arrow", key: "ribbon.shape.arrow", icon: "gr-arrow-right" },
  { kind: "textBox", key: "ribbon.shape.text_box", icon: "gr-text-box" },
];

/// Le icone che `insert.icons` disegna.
export const ICON_NAMES: readonly { readonly name: string; readonly key: RibbonKey }[] = [
  { name: "check", key: "ribbon.icon.check" },
  { name: "chart", key: "ribbon.icon.chart" },
  { name: "table", key: "ribbon.icon.table" },
  { name: "sum", key: "ribbon.icon.sum" },
  { name: "filter", key: "ribbon.icon.filter" },
  { name: "lock", key: "ribbon.icon.lock" },
  { name: "comment", key: "ribbon.icon.comment" },
  { name: "picture", key: "ribbon.icon.picture" },
  { name: "book", key: "ribbon.icon.book" },
  { name: "folder", key: "ribbon.icon.folder" },
  { name: "search", key: "ribbon.icon.search" },
  { name: "calc", key: "ribbon.icon.calc" },
];

/// Un tipo di grafico, come lo chiamano `insert.chart` e `chart.changeType`.
export interface ChartKind {
  readonly type: string;
  readonly subtype?: string;
  readonly key: RibbonKey;
  readonly separator?: boolean;
}

export const COLUMN_CHARTS: readonly ChartKind[] = [
  { type: "column", subtype: "clustered", key: "ribbon.chart.column_clustered" },
  { type: "column", subtype: "stacked", key: "ribbon.chart.column_stacked" },
  { type: "column", subtype: "stacked100", key: "ribbon.chart.column_stacked100" },
  { type: "bar", subtype: "clustered", key: "ribbon.chart.bar_clustered", separator: true },
  { type: "bar", subtype: "stacked", key: "ribbon.chart.bar_stacked" },
  { type: "bar", subtype: "stacked100", key: "ribbon.chart.bar_stacked100" },
];

export const LINE_CHARTS: readonly ChartKind[] = [
  { type: "line", key: "ribbon.chart.line" },
  { type: "line", subtype: "markers", key: "ribbon.chart.line_markers" },
  { type: "line", subtype: "stacked", key: "ribbon.chart.line_stacked" },
  { type: "area", key: "ribbon.chart.area", separator: true },
  { type: "area", subtype: "stacked", key: "ribbon.chart.area_stacked" },
  { type: "area", subtype: "stacked100", key: "ribbon.chart.area_stacked100" },
];

export const PIE_CHARTS: readonly ChartKind[] = [
  { type: "pie", key: "ribbon.chart.pie" },
  { type: "doughnut", key: "ribbon.chart.doughnut" },
];

export const SCATTER_CHARTS: readonly ChartKind[] = [
  { type: "scatter", key: "ribbon.chart.scatter" },
  { type: "bubble", key: "ribbon.chart.bubble" },
];

export const OTHER_CHARTS: readonly ChartKind[] = [
  { type: "radar", key: "ribbon.chart.radar" },
  { type: "combo", key: "ribbon.chart.combo" },
  { type: "stock", key: "ribbon.chart.stock" },
  { type: "histogram", key: "ribbon.chart.histogram", separator: true },
  { type: "boxWhisker", key: "ribbon.chart.box_whisker" },
  { type: "waterfall", key: "ribbon.chart.waterfall" },
  { type: "funnel", key: "ribbon.chart.funnel" },
  { type: "treemap", key: "ribbon.chart.treemap", separator: true },
  { type: "sunburst", key: "ribbon.chart.sunburst" },
];

/// Il grafico selezionato, per i comandi `chart.*`.
export const theChart = (view: RibbonView): Params => (view.object?.kind === "chart" ? { chart: view.object.id } : {});

/// L'oggetto selezionato, per `object.*` e `arrange.*`.
export const theObject = (view: RibbonView): Params => (view.object ? { kind: view.object.kind, id: view.object.id } : {});

export const chartSelected = (view: RibbonView) => view.object?.kind === "chart";
export const shapeSelected = (view: RibbonView) => view.object?.kind === "shape";

/// Le voci dei tipi di grafico: `insert.chart` sulla selezione, o
/// `chart.changeType` sul grafico selezionato.
export function chartEntries(id: string, kinds: readonly ChartKind[], view: RibbonView): readonly MenuEntry[] {
  const target = id === "insert.chart" ? {} : theChart(view);
  return kinds.map(({ type, subtype, key, separator }) => ({
    label: key,
    id,
    params: { ...target, type, ...(subtype ? { subtype } : {}) },
    separator,
  }));
}

export function chartMenu(id: string, label: RibbonKey, keytip: string, icon: string, kinds: readonly ChartKind[]): MenuControl {
  return { kind: "menu", label, keytip, icon, labelled: true, items: (view) => chartEntries(id, kinds, view) };
}

export const INSERT: RibbonTab = {
  id: "insert",
  label: "ribbon.tab.insert",
  keytip: "N",
  groups: [
    {
      id: "tables",
      label: "ribbon.group.tables",
      icon: "gr-table",
      keytip: "ZT",
      columns: [{ kind: "button", id: "insert.table", label: "ribbon.insert.table", keytip: "T", icon: "gr-table", size: "large" }],
    },
    {
      id: "illustrations",
      label: "ribbon.group.illustrations",
      icon: "gr-shapes",
      keytip: "ZI",
      columns: [
        {
          kind: "menu",
          label: "ribbon.insert.shapes",
          keytip: "SH",
          icon: "gr-shapes",
          size: "large",
          items: () => SHAPES.map(({ kind, key, icon }) => ({ label: key, id: "insert.shape", params: { kind }, icon })),
        },
        {
          kind: "menu",
          label: "ribbon.insert.icons",
          keytip: "Y1",
          icon: "gr-icons",
          size: "large",
          items: () => ICON_NAMES.map(({ name, key }) => ({ label: key, id: "insert.icons", params: { name } })),
        },
      ],
    },
    {
      id: "charts",
      label: "ribbon.group.charts",
      icon: "gr-chart-column",
      keytip: "ZC",
      columns: [
        { kind: "button", id: "insert.recommendedCharts", label: "ribbon.insert.recommended_charts", keytip: "R", icon: "gr-chart-recommended", size: "large" },
        {
          rows: [
            [chartMenu("insert.chart", "ribbon.chart.family.column", "C1", "gr-chart-column", COLUMN_CHARTS)],
            [chartMenu("insert.chart", "ribbon.chart.family.line", "N", "gr-chart-line", LINE_CHARTS)],
            [chartMenu("insert.chart", "ribbon.chart.family.pie", "Q", "gr-chart-pie", PIE_CHARTS)],
          ],
        },
        {
          rows: [
            [chartMenu("insert.chart", "ribbon.chart.family.scatter", "D", "gr-chart-scatter", SCATTER_CHARTS)],
            [chartMenu("insert.chart", "ribbon.chart.family.other", "A", "gr-chart-other", OTHER_CHARTS)],
          ],
        },
      ],
    },
    {
      id: "controls",
      label: "ribbon.group.cell_controls",
      icon: "gr-checkbox",
      keytip: "ZK",
      columns: [{ kind: "button", id: "insert.checkbox", label: "ribbon.insert.checkbox", keytip: "CB", icon: "gr-checkbox", size: "large" }],
    },
    {
      id: "symbols",
      label: "ribbon.group.symbols",
      icon: "gr-symbol",
      keytip: "ZY",
      columns: [
        {
          kind: "menu",
          label: "ribbon.insert.symbol",
          keytip: "U",
          icon: "gr-symbol",
          size: "large",
          items: () => SYMBOLS.map((char) => ({ label: { raw: char }, id: "insert.symbol", params: { char } })),
        },
      ],
    },
    {
      id: "links",
      label: "ribbon.group.links",
      icon: "gr-link",
      keytip: "ZL",
      columns: [{ kind: "button", id: "insert.link", dialog: "insertLink", label: "ribbon.insert.link", keytip: "I", icon: "gr-link", size: "large" }],
    },
    {
      id: "text",
      label: "ribbon.group.text",
      icon: "gr-text-box",
      keytip: "ZX",
      columns: [{ kind: "button", id: "insert.textBox", label: "ribbon.insert.text_box", keytip: "X", icon: "gr-text-box", size: "large" }],
    },
  ],
};
