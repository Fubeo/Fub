// Le schede Dati, Revisione e Visualizza della barra dei fogli
// (`../tabs.ts`).

import { type MenuEntry, type RibbonTab, toggle } from "./base";

// ── Dati ────────────────────────────────────────────────────────────────

export const DATA: RibbonTab = {
  id: "data",
  label: "ribbon.tab.data",
  keytip: "A",
  groups: [
    {
      id: "sort",
      label: "ribbon.group.sort_filter",
      icon: "gr-sort-filter",
      keytip: "ZS",
      columns: [
        {
          rows: [
            [{ kind: "button", id: "data.sortAscending", label: "ribbon.sort.ascending", keytip: "SA", icon: "gr-sort-asc" }],
            [{ kind: "button", id: "data.sortDescending", label: "ribbon.sort.descending", keytip: "SD", icon: "gr-sort-desc" }],
          ],
        },
        { kind: "button", id: "data.sort", dialog: "sort", label: "ribbon.data.sort", keytip: "SS", icon: "gr-sort", size: "large" },
        { kind: "button", id: "data.filter", label: "ribbon.filter", keytip: "T", icon: "gr-filter", size: "large" },
        {
          rows: [
            [{ kind: "button", id: "data.clearFilter", label: "ribbon.filter.clear", keytip: "C", icon: "gr-filter-clear", labelled: true }],
            [{ kind: "button", id: "data.reapply", label: "ribbon.filter.reapply", keytip: "Y", icon: "gr-reapply", labelled: true }],
            [{ kind: "button", id: "data.advancedFilter", dialog: "advancedFilter", label: "ribbon.data.advanced", keytip: "Q", icon: "gr-filter-advanced", labelled: true }],
          ],
        },
      ],
    },
    {
      id: "tools",
      label: "ribbon.group.data_tools",
      icon: "gr-flash",
      keytip: "ZD",
      columns: [
        { kind: "button", id: "data.textToColumns", dialog: "textToColumns", label: "ribbon.data.text_to_columns", keytip: "E", icon: "gr-text-columns", size: "large" },
        { kind: "button", id: "data.flashFill", label: "ribbon.fill_menu.flash", keytip: "FF", icon: "gr-flash", size: "large" },
        { kind: "button", id: "data.removeDuplicates", dialog: "removeDuplicates", label: "ribbon.data.remove_duplicates", keytip: "M", icon: "gr-duplicates", size: "large" },
        { kind: "button", id: "data.validation", dialog: "dataValidation", label: "ribbon.data.validation", keytip: "V", icon: "gr-validation", size: "large" },
      ],
    },
    {
      id: "forecast",
      label: "ribbon.group.forecast",
      icon: "gr-what-if",
      keytip: "ZF",
      columns: [
        {
          kind: "menu",
          label: "ribbon.data.what_if",
          keytip: "W",
          icon: "gr-what-if",
          size: "large",
          items: () => [{ label: "ribbon.data.goal_seek", id: "data.goalSeek", dialog: "goalSeek" }],
        },
      ],
    },
    {
      id: "outline",
      label: "ribbon.group.outline",
      icon: "gr-group",
      keytip: "ZO",
      columns: [
        {
          kind: "split",
          id: "data.group",
          label: "ribbon.outline.group",
          menuLabel: "ribbon.outline.group.menu",
          keytip: "G",
          icon: "gr-group",
          size: "large",
          menu: () => [
            { label: "ribbon.outline.rows", id: "data.group", params: { by: "rows" } },
            { label: "ribbon.outline.columns", id: "data.group", params: { by: "cols" } },
          ],
        },
        {
          kind: "split",
          id: "data.ungroup",
          label: "ribbon.outline.ungroup",
          menuLabel: "ribbon.outline.ungroup.menu",
          keytip: "U",
          icon: "gr-ungroup",
          size: "large",
          menu: () => [
            { label: "ribbon.outline.rows", id: "data.ungroup", params: { by: "rows" } },
            { label: "ribbon.outline.columns", id: "data.ungroup", params: { by: "cols" } },
          ],
        },
        {
          rows: [
            [{ kind: "button", id: "data.showDetail", label: "ribbon.outline.show", keytip: "J", icon: "gr-plus", labelled: true }],
            [{ kind: "button", id: "data.hideDetail", label: "ribbon.outline.hide", keytip: "H", icon: "gr-minus", labelled: true }],
          ],
        },
        { kind: "button", id: "data.subtotal", dialog: "subtotal", label: "ribbon.data.subtotal", keytip: "B", icon: "gr-subtotal", size: "large" },
      ],
    },
  ],
};

// ── Revisione ───────────────────────────────────────────────────────────

export const REVIEW: RibbonTab = {
  id: "review",
  label: "ribbon.tab.review",
  keytip: "R",
  groups: [
    {
      id: "comments",
      label: "ribbon.group.comments",
      icon: "gr-comment",
      keytip: "ZC",
      columns: [
        { kind: "button", id: "review.newComment", dialog: "comment", label: "ribbon.review.new_comment", keytip: "C", icon: "gr-comment-new", size: "large" },
        { kind: "button", id: "review.deleteComment", label: "ribbon.review.delete", keytip: "D", icon: "gr-comment-delete", size: "large" },
        {
          rows: [
            [{ kind: "button", id: "review.previousComment", label: "ribbon.review.previous", keytip: "V", icon: "gr-arrow-left", labelled: true }],
            [{ kind: "button", id: "review.nextComment", label: "ribbon.review.next", keytip: "N", icon: "gr-arrow-right", labelled: true }],
          ],
        },
      ],
    },
    {
      id: "notes",
      label: "ribbon.group.notes",
      icon: "gr-note",
      keytip: "ZN",
      columns: [
        {
          kind: "menu",
          label: "ribbon.review.notes",
          keytip: "T",
          icon: "gr-note",
          size: "large",
          items: () => [
            { label: "ribbon.review.notes.new", id: "review.newNote", dialog: "note" },
            { label: "ribbon.review.notes.show", id: "review.showNote", separator: true },
            { label: "ribbon.review.notes.convert", id: "review.convertToComments", separator: true },
          ],
        },
      ],
    },
    {
      id: "protect",
      label: "ribbon.group.protect",
      icon: "gr-lock",
      keytip: "ZP",
      columns: [
        { kind: "button", id: "review.protectSheet", dialog: "protectSheet", label: "ribbon.review.protect_sheet", keytip: "PP", icon: "gr-lock", size: "large" },
        { kind: "button", id: "review.unprotectSheet", dialog: "unprotectSheet", label: "ribbon.review.unprotect_sheet", keytip: "PS", icon: "gr-unlock", size: "large" },
        {
          kind: "button",
          id: "review.protectWorkbook",
          label: "ribbon.review.protect_workbook",
          keytip: "PW",
          icon: "gr-lock",
          size: "large",
          // Protetta, la stessa finestra la toglie, e chiede la password
          // soltanto se ce n'è una.
          dialog: (view) => (view.book?.protected === true ? "unprotectWorkbook" : "protectWorkbook"),
          pressed: (view) => view.book?.protected === true,
        },
      ],
    },
  ],
};

// ── Visualizza ──────────────────────────────────────────────────────────

/// Gli ingrandimenti del menu Zoom.
export const ZOOMS: readonly number[] = [200, 150, 125, 100, 90, 75, 50, 25];

export const VIEW: RibbonTab = {
  id: "view",
  label: "ribbon.tab.view",
  keytip: "W",
  groups: [
    {
      id: "views",
      label: "ribbon.group.workbook_views",
      icon: "gr-view-normal",
      keytip: "ZV",
      columns: [
        { kind: "button", id: "view.normal", label: "ribbon.view.normal", keytip: "L", icon: "gr-view-normal", size: "large", pressed: (v) => v.sheet.mode === "normal" },
        { kind: "button", id: "view.pageBreakPreview", label: "ribbon.view.break_preview", keytip: "I", icon: "gr-breaks", size: "large", pressed: (v) => v.sheet.mode === "page_break_preview" },
        { kind: "button", id: "view.pageLayout", label: "ribbon.view.page_layout", keytip: "P", icon: "gr-page", size: "large", pressed: (v) => v.sheet.mode === "page_layout" },
      ],
    },
    {
      id: "show",
      label: "ribbon.group.show",
      icon: "gr-gridlines",
      keytip: "ZS",
      columns: [
        {
          rows: [
            [{ kind: "check", id: "view.gridlines", label: "ribbon.view.gridlines", keytip: "VG", checked: (v) => v.sheet.gridlines, params: toggle }],
            [{ kind: "check", id: "view.headings", label: "ribbon.view.headings", keytip: "VH", checked: (v) => v.sheet.headings, params: toggle }],
          ],
        },
      ],
    },
    {
      id: "zoom",
      label: "ribbon.group.zoom",
      icon: "gr-zoom",
      keytip: "ZZ",
      columns: [
        {
          kind: "menu",
          label: "ribbon.view.zoom",
          keytip: "Q",
          icon: "gr-zoom",
          size: "large",
          items: (view) => [
            ...ZOOMS.map((percent): MenuEntry => ({
              label: { raw: `${percent}%` },
              id: "view.zoom",
              params: { percent },
              choice: "radio",
              checked: view.sheet.zoom === percent,
            })),
            { label: "ribbon.view.zoom_dialog", id: "view.zoom", dialog: "zoom", separator: true },
          ],
        },
        { kind: "button", id: "view.zoom100", label: "ribbon.view.zoom100", keytip: "J", icon: "gr-zoom-100", size: "large" },
        {
          kind: "button",
          id: "view.zoomToSelection",
          label: "ribbon.view.zoom_selection",
          keytip: "G",
          icon: "gr-zoom-selection",
          size: "large",
          params: (view) => ({ viewWidth: view.viewport.width, viewHeight: view.viewport.height }),
        },
      ],
    },
    {
      id: "window",
      label: "ribbon.group.window",
      icon: "gr-freeze",
      keytip: "ZW",
      columns: [
        {
          kind: "menu",
          label: "ribbon.view.freeze",
          keytip: "F",
          icon: "gr-freeze",
          size: "large",
          items: (view) => {
            const frozen = view.sheet.frozen_rows > 0 || view.sheet.frozen_columns > 0;
            return [
              frozen
                ? { label: "ribbon.view.unfreeze", id: "view.unfreezePanes" }
                : { label: "ribbon.view.freeze_panes", id: "view.freezePanes" },
              { label: "ribbon.view.freeze_row", id: "view.freezeTopRow" },
              { label: "ribbon.view.freeze_column", id: "view.freezeFirstColumn" },
            ];
          },
        },
      ],
    },
  ],
};
