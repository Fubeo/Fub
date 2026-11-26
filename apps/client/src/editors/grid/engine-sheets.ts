// Il motore della griglia: i fogli e le linguette. Metodi della classe
// `GridEngine`, montati sul suo prototipo da `engine.ts`
// (`editors/core/mix-methods.ts`).

import { t } from "../../i18n/strings";
import { createTabs } from "../../kit";
import { openLifetime } from "../../ui/lifetime";
import { workbookView } from "./workbook";
import type { GridEngine } from "./engine";

export const sheetsMethods = {
  /// Ridisegna la cartella dalla sessione mostrata e dalle finestre lette.
  /// `loaded`: una finestra arrivata mentre si scorre. Si mostra subito, ma
  /// con le misure che il gestore dello scorrimento ha già letto, e le celle
  /// da misurare le misura il fotogramma chiesto: arriva fra uno scorrimento
  /// e il suo fotogramma, e non deve allungare quel giro.
  _showView(this: GridEngine, sheetId: string, top: boolean, loaded = false): void {
    const session = this._shownSession;
    if (!session) return;
    const view = workbookView(session, this._windows, this._view);
    this._view = view;
    this._workbook = view.workbook;
    const index = view.workbook.sheets.findIndex((sheet) => sheet.id === sheetId);
    this._sheetIndex = index >= 0 ? index : view.active;
    if (top) {
      this._selection = { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } };
      this._others = [];
    }
    this._showNotice();
    this._showSheetTabs();
    this._showSheet(top, loaded);
    this._options.onView?.();
  },

  /// Ridisegna il foglio `_sheetIndex`; `top` lo riporta in cima. `loaded`
  /// come in `_showView`.
  _showSheet(this: GridEngine, top: boolean, loaded = false): void {
    this._selection = this._clampedSelection(this._selection);
    this._rebuildLayout();
    this._selection = this._visibleSelection(this._selection);
    if (top) {
      this._viewport.scrollTop = 0;
      this._viewport.scrollLeft = 0;
    }
    if (!this._editing) this._syncFormulaBar();
    this._render(true, loaded && !top);
  },

  /// Le schede dei fogli, quando ce n'è più di uno da mostrare. Si rifanno
  /// soltanto se i fogli cambiano.
  _showSheetTabs(this: GridEngine): void {
    const sheets = this._workbook?.sheets ?? [];
    const names = JSON.stringify(sheets.map((sheet) => [sheet.id, sheet.name]));
    if (sheets.length < 2) {
      this._sheetTabs?.lifetime.close();
      this._sheetTabs = null;
      this._sheetBar.replaceChildren();
      this._sheetBar.hidden = true;
      return;
    }
    const selected = sheets[this._sheetIndex]?.id;
    if (this._sheetTabs?.names === names) {
      if (selected !== undefined) this._sheetTabs.handle.select(selected);
      return;
    }
    this._sheetTabs?.lifetime.close();
    const lifetime = openLifetime();
    const tablist = document.createElement("div");
    this._sheetBar.replaceChildren(tablist);
    this._sheetBar.hidden = false;
    const handle = createTabs({
      tablist,
      tabs: sheets.map((sheet) => ({ id: sheet.id, label: sheet.name })),
      selected,
      label: t("grid.workbook.sheets"),
      lifetime,
      onSelect: (id) => {
        const index = this._workbook?.sheets.findIndex((sheet) => sheet.id === id) ?? -1;
        if (index >= 0) this._showSheetAt(index);
      },
    });
    lifetime.add(() => tablist.remove());
    this._sheetTabs = { handle, names, lifetime };
  },

  /// Mostra il foglio `index`, dalla sua prima cella.
  _showSheetAt(this: GridEngine, index: number): void {
    if (index === this._sheetIndex) return;
    this._finishEditing(false, "input", false);
    this._finishObjectText(false);
    this._selectedObject = null;
    this._sheetIndex = index;
    this._selection = { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } };
    this._others = [];
    this._adding = false;
    this._showSheet(true);
    this._sheetTabs?.handle.select(this._sheet().id);
    void this._loadViewport();
    this._selectionChanged();
  },
};
export type SheetsMethods = typeof sheetsMethods;
