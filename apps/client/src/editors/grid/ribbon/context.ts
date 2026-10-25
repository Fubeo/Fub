// Il menu del tasto destro della griglia, come lo ha Excel: che cosa offre
// ogni bersaglio — una cella, l'intestazione di una riga o di una colonna,
// la linguetta di un foglio, un oggetto — con i comandi del catalogo e le
// finestre della barra multifunzione.
//
// È una dichiarazione come `tabs.ts` e non disegna niente: la barra la
// trasforma nelle voci del menu dell'editor. Una voce che il catalogo non
// serve non si vede; una spenta dice la ragione del provider. Gli appunti
// non stanno qui: li mette il menu dell'editor, come in ogni editor.
import { inTable, TAB_COLORS, theObject, type MenuEntry, type RibbonView } from "./tabs";

/// Ciò su cui si è premuto il tasto destro.
export type GridMenuTarget = "cell" | "row" | "column" | "corner" | "sheet" | "object";

/// I controlli della scheda Home che la mini-barra mostra, come la Mini
/// Toolbar di Excel: soltanto pulsanti e tendine, che agiscono subito.
export const MINI_CONTROLS: readonly string[] = [
  "home.fontName",
  "home.fontSize",
  "home.increaseFontSize",
  "home.decreaseFontSize",
  "home.bold",
  "home.italic",
  "home.percent",
  "home.comma",
  "home.increaseDecimal",
  "home.decreaseDecimal",
];

const CLEAR: readonly MenuEntry[] = [
  { label: "ribbon.clear.all", id: "edit.clearAll" },
  { label: "ribbon.clear.formats", id: "edit.clearFormats" },
  { label: "ribbon.clear.comments", id: "edit.clearComments" },
  { label: "ribbon.clear.hyperlinks", id: "edit.clearHyperlinks" },
];

const SORT: readonly MenuEntry[] = [
  { label: "ribbon.sort.ascending", id: "data.sortAscending", icon: "gr-sort-asc" },
  { label: "ribbon.sort.descending", id: "data.sortDescending", icon: "gr-sort-desc" },
  { label: "ribbon.sort.custom", id: "data.sort", dialog: "sort", icon: "gr-sort" },
];

const FILTER: readonly MenuEntry[] = [
  { label: "ribbon.filter", id: "data.filter", icon: "gr-filter" },
  { label: "ribbon.filter.clear", id: "data.clearFilter", icon: "gr-filter-clear" },
  { label: "ribbon.filter.reapply", id: "data.reapply", icon: "gr-reapply" },
];

const FORMAT_CELLS: MenuEntry = { label: "ribbon.cells.format.cells", id: "home.formatCells", dialog: "formatCells", icon: "gr-format" };

/// Le voci per `target`, nell'ordine del menu di Excel.
export function contextEntries(target: GridMenuTarget, view: RibbonView): readonly MenuEntry[] {
  switch (target) {
    case "cell":
      return [
        { label: "ribbon.cells.insert.cells", id: "home.insertCells", dialog: "insertCells" },
        { label: "ribbon.cells.delete.cells", id: "home.deleteCells", dialog: "deleteCells" },
        { label: "ribbon.clear.contents", id: "edit.clearContents" },
        { label: "ribbon.clear", submenu: () => CLEAR },
        { label: "ribbon.filter", submenu: () => FILTER },
        { label: "ribbon.data.sort", submenu: () => SORT },
        ...(view.table
          ? [{
              label: "ribbon.context.table",
              submenu: () => [
                { label: "ribbon.table.resize", id: "table.resize", dialog: "tableResize", params: inTable(view) },
                { label: "ribbon.table.convert", id: "table.convertToRange", params: inTable(view) },
                { label: "ribbon.table.remove_duplicates", id: "table.removeDuplicates", params: inTable(view) },
              ],
            } satisfies MenuEntry]
          : []),
        { label: "ribbon.review.new_comment", id: "review.newComment", dialog: "comment", icon: "gr-comment-new" },
        { label: "ribbon.review.notes.new", id: "review.newNote", dialog: "note" },
        FORMAT_CELLS,
        { label: "ribbon.formulas.define_name", id: "formulas.defineName", dialog: "defineName", icon: "gr-name" },
        { label: "ribbon.insert.link", id: "insert.link", dialog: "insertLink", icon: "gr-link" },
      ];
    case "row":
      return [
        { label: "ribbon.cells.insert.rows", id: "home.insertRows", icon: "gr-insert-row" },
        { label: "ribbon.cells.delete.rows", id: "home.deleteRows", icon: "gr-delete-row" },
        { label: "ribbon.clear.contents", id: "edit.clearContents" },
        FORMAT_CELLS,
        { label: "ribbon.cells.format.row_height", id: "home.rowHeight", dialog: "rowHeight" },
        { label: "ribbon.cells.format.autofit_rows", id: "home.autofitRowHeight" },
        { label: "ribbon.cells.format.hide_rows", id: "home.hideRows" },
        { label: "ribbon.cells.format.unhide_rows", id: "home.unhideRows" },
      ];
    case "column": {
      const frozen = view.sheet.frozen_rows > 0 || view.sheet.frozen_columns > 0;
      return [
        { label: "ribbon.cells.insert.columns", id: "home.insertColumns", icon: "gr-insert-column" },
        { label: "ribbon.cells.delete.columns", id: "home.deleteColumns", icon: "gr-delete-column" },
        { label: "ribbon.clear.contents", id: "edit.clearContents" },
        FORMAT_CELLS,
        { label: "ribbon.cells.format.column_width", id: "home.columnWidth", dialog: "columnWidth" },
        { label: "ribbon.cells.format.autofit_columns", id: "home.autofitColumnWidth" },
        { label: "ribbon.cells.format.hide_columns", id: "home.hideColumns" },
        { label: "ribbon.cells.format.unhide_columns", id: "home.unhideColumns" },
        {
          label: "ribbon.view.freeze",
          submenu: () => [
            frozen
              ? { label: "ribbon.view.unfreeze", id: "view.unfreezePanes" }
              : { label: "ribbon.view.freeze_panes", id: "view.freezePanes" },
            { label: "ribbon.view.freeze_row", id: "view.freezeTopRow" },
            { label: "ribbon.view.freeze_column", id: "view.freezeFirstColumn" },
          ],
        },
      ];
    }
    case "sheet":
      return [
        { label: "ribbon.cells.insert.sheet", id: "home.insertSheet", icon: "gr-sheet" },
        { label: "ribbon.cells.delete.sheet", id: "home.deleteSheet" },
        { label: "ribbon.cells.format.rename_sheet", id: "sheet.rename", dialog: "renameSheet" },
        { label: "ribbon.cells.format.move_sheet", id: "sheet.move", dialog: "moveSheet" },
        {
          label: "ribbon.cells.format.tab_color",
          requires: ["sheet.tabColor"],
          submenu: () => [
            { label: "ribbon.cells.format.tab_color.none", id: "sheet.tabColor", params: { color: "none" } },
            ...TAB_COLORS.map(({ key, hex }) => ({ label: key, id: "sheet.tabColor", params: { color: hex }, swatches: [hex] })),
          ],
        },
        { label: "ribbon.cells.format.hide_sheet", id: "sheet.hide" },
        {
          label: "ribbon.cells.format.unhide_sheet",
          requires: ["sheet.unhide"],
          submenu: () => view.hidden.map((sheet) => ({ label: { raw: sheet.name }, id: "sheet.unhide", params: { sheet: sheet.name } })),
        },
        { label: "ribbon.cells.format.protect_sheet", id: "review.protectSheet", dialog: "protectSheet", icon: "gr-lock" },
      ];
    case "object":
      return [
        { label: "ribbon.arrange.forward", id: "arrange.bringForward", params: theObject(view), icon: "gr-bring-forward" },
        { label: "ribbon.arrange.front", id: "arrange.bringForward", params: { ...theObject(view), toFront: true }, icon: "gr-bring-front" },
        { label: "ribbon.arrange.backward", id: "arrange.sendBackward", params: theObject(view), icon: "gr-send-backward" },
        { label: "ribbon.arrange.back", id: "arrange.sendBackward", params: { ...theObject(view), toBack: true }, icon: "gr-send-back" },
        { label: "ribbon.object.delete", id: "object.delete", params: theObject(view), icon: "gr-delete" },
      ];
    case "corner":
      return [];
  }
}
