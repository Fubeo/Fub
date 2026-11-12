// Le schede della barra multifunzione dei fogli, come le ha GridCraft: che
// cosa c'è in ogni gruppo, con quale comando del catalogo, quali parametri e
// quale tasto (`keytip`) dopo Alt e la lettera della scheda.
//
// È una dichiarazione e non disegna niente: la disegna `ribbon.ts`. Un
// controllo si vede se il catalogo della sessione serve il suo comando, e si
// spegne con la ragione del provider quando il comando è spento. Un controllo
// con `dialog` apre una finestra (`dialogs/`), che raccoglie i parametri e dà
// il comando `id`: il comando resta quello che lo fa vedere e spegnere.
//
// I nomi che il provider conosce (gli stili, i temi, i formati) restano quelli
// del file, in inglese: sono valori, non testo. Si traduce ciò che si legge.
//
// Le schede stanno in `tabs/`, una o poche per file, con la forma dei
// controlli e i valori che il provider conosce in `tabs/base.ts`. Questo file
// ne ri-esporta i nomi pubblici e le mette nell'ordine della barra.

import type { Params } from "../../../kit/ribbon/types";
import type { MenuEntry, RibbonControl, RibbonTab, RibbonView } from "./tabs/base";
import { HOME } from "./tabs/home";
import { INSERT } from "./tabs/insert";
import { FORMULAS, PAGE_LAYOUT } from "./tabs/page-formulas";
import { DATA, REVIEW, VIEW } from "./tabs/data-review-view";
import { CHART_DESIGN, OBJECT_FORMAT, TABLE_DESIGN } from "./tabs/contextual";

export {
  FONTS,
  FONT_SIZES,
  NUMBER_FORMATS,
  numberFormatOf,
  ACCOUNTING,
  THEMES,
  PAPERS,
  SYMBOLS,
  FUNCTION_CATEGORIES,
  MORE_CATEGORIES,
  inTable,
  type Text,
  type RibbonView,
  type MenuEntry,
  type ButtonControl,
  type SplitControl,
  type MenuControl,
  type SelectControl,
  type CheckControl,
  type FieldControl,
  type ColorControl,
  type GalleryControl,
  type GridExtraControl,
  type RibbonControl,
  type RibbonColumn,
  type RibbonGroup,
  type RibbonTab,
} from "./tabs/base";
export { TAB_COLORS } from "./tabs/home";
export { theObject } from "./tabs/insert";
export { ZOOMS } from "./tabs/data-review-view";

// La forma delle schede è quella del kit (`kit/ribbon/types.ts`), con la vista
// e le chiavi della griglia; la tavolozza e le gallerie sono specie sue.
export { columnControls, groupControls } from "../../../kit/ribbon/types";
export type { Params };

/// Le schede, nell'ordine della barra.
export const RIBBON_TABS: readonly RibbonTab[] = [HOME, INSERT, PAGE_LAYOUT, FORMULAS, DATA, REVIEW, VIEW, TABLE_DESIGN, CHART_DESIGN, OBJECT_FORMAT];

/// I comandi che un controllo dà o che lo fanno vedere, senza aprire i menu
/// che arrivano dopo.
export function controlIds(control: RibbonControl, view: RibbonView): readonly string[] {
  switch (control.kind) {
    case "menu": {
      if (control.requires) return control.requires;
      const items = control.items(view);
      return items instanceof Promise ? [] : entryIds(items);
    }
    case "split":
      return [control.id, ...entryIds(control.menu(view))];
    default:
      return [control.id];
  }
}

/// I comandi delle voci di un menu.
export function entryIds(entries: readonly MenuEntry[]): readonly string[] {
  return entries.flatMap((entry) => [...(entry.id ? [entry.id] : []), ...(entry.requires ?? [])]);
}
