// Le schede della barra dei fogli, la base: la forma dei controlli con la
// vista e le chiavi della griglia, i valori che il provider conosce e gli
// aiuti che più schede usano (`../tabs.ts`).

import type { GridBook, GridCellStyle, GridObject, GridSheetView, GridTable } from "../../../../host/contract";
import { resultList } from "../../dialogs/result";
import type { RibbonKey } from "../strings";
import type {
  ButtonControl as KitButtonControl,
  CheckControl as KitCheckControl,
  ControlBase,
  FieldControl as KitFieldControl,
  KitControl,
  MenuControl as KitMenuControl,
  MenuEntry as KitMenuEntry,
  Params,
  RibbonColumn as KitRibbonColumn,
  RibbonGroup as KitRibbonGroup,
  RibbonTab as KitRibbonTab,
  SelectControl as KitSelectControl,
  SplitControl as KitSplitControl,
  Text as KitText,
} from "../../../../kit/ribbon/types";

/// Un testo da mostrare: una chiave del catalogo, o un valore com'è (il nome
/// di una funzione, di un carattere, di un foglio).
export type Text = KitText<RibbonKey>;

/// Ciò che le schede leggono per dire lo stato dei controlli.
export interface RibbonView {
  /// Lo stile della cella attiva.
  readonly style: GridCellStyle | undefined;
  readonly sheet: GridSheetView;
  readonly book: GridBook | null;
  /// La tabella che contiene la cella attiva.
  readonly table: GridTable | null;
  /// L'oggetto selezionato sul foglio: un grafico, un'immagine, una forma.
  readonly object: GridObject | null;
  /// I dodici colori del tema della cartella.
  readonly theme: readonly string[];
  readonly hidden: readonly { readonly id: string; readonly name: string }[];
  /// La parte della griglia che si vede, per «Zoom selezione».
  readonly viewport: { readonly width: number; readonly height: number };
  /// Un comando che soltanto legge (`GridEngine.query`).
  query(id: string, params: Params): Promise<unknown>;
}

/// Una voce di menu: un comando con i suoi parametri, una finestra, una
/// formula da cominciare (`write`, scritta nella cella dopo `=`), o un menu
/// più in là.
export type MenuEntry = KitMenuEntry<RibbonKey>;

export type Base = ControlBase<RibbonView, RibbonKey>;

/// Un pulsante che dà un comando; `pressed` lo fa interruttore. Con `shell`
/// (`exportPdf`) chiede l'esportazione in PDF, che è un comando dell'host e
/// non della cartella.
export type ButtonControl = KitButtonControl<RibbonView, RibbonKey>;
export type SplitControl = KitSplitControl<RibbonView, RibbonKey>;
export type MenuControl = KitMenuControl<RibbonView, RibbonKey>;
export type SelectControl = KitSelectControl<RibbonView, RibbonKey>;
export type CheckControl = KitCheckControl<RibbonView, RibbonKey>;
export type FieldControl = KitFieldControl<RibbonView, RibbonKey>;

/// Un colore: la parte grande ripete l'ultimo, la freccia apre la tavolozza.
export interface ColorControl extends Base {
  readonly kind: "color";
  readonly id: string;
  /// Il valore che toglie il colore, e come si chiama.
  readonly empty: { readonly value: "auto" | "none"; readonly label: RibbonKey };
  readonly initial: string;
  /// I parametri oltre al colore: l'oggetto a cui va.
  readonly params?: (view: RibbonView) => Params;
  /// Il comando vuole un colore esadecimale, e un colore del tema si porta
  /// al suo valore.
  readonly hex?: boolean;
}

/// Una galleria di stili di tabella o di cella.
export interface GalleryControl extends Base {
  readonly kind: "gallery";
  readonly id: string;
  readonly gallery: "table" | "cell";
  readonly params: (name: string, view: RibbonView) => Params;
  readonly current?: (view: RibbonView) => string | null;
}

/// Le specie che disegna la griglia, oltre a quelle del kit.
export type GridExtraControl = ColorControl | GalleryControl;

export type RibbonControl = KitControl<RibbonView, RibbonKey> | GridExtraControl;

/// Una colonna di un gruppo: un controllo grande, o righe di controlli piccoli.
export type RibbonColumn = KitRibbonColumn<RibbonControl>;

export type RibbonGroup = KitRibbonGroup<RibbonControl, RibbonKey>;

export interface RibbonTab extends KitRibbonTab<RibbonControl, RibbonKey> {
  /// Una scheda che c'è soltanto quando la selezione è in una tabella, o
  /// quando è selezionato un grafico, o un oggetto qualsiasi.
  readonly contextual?: "table" | "chart" | "object";
}

// ── I valori che il provider conosce ────────────────────────────────────

/// I caratteri proposti sempre, come in GridCraft.
export const FONTS: readonly string[] = [
  "Aptos",
  "Aptos Narrow",
  "Arial",
  "Calibri",
  "Cambria",
  "Candara",
  "Consolas",
  "Courier New",
  "Garamond",
  "Georgia",
  "Helvetica",
  "Helvetica Neue",
  "Segoe UI",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
];

/// Le dimensioni dell'elenco di Excel.
export const FONT_SIZES: readonly number[] = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

/// I formati dell'elenco del gruppo Numeri, come li chiama il provider.
export const NUMBER_FORMATS: readonly { readonly format: string; readonly key: RibbonKey }[] = [
  { format: "General", key: "ribbon.number.general" },
  { format: "Number", key: "ribbon.number.number" },
  { format: "Currency", key: "ribbon.number.currency" },
  { format: "Accounting", key: "ribbon.number.accounting" },
  { format: "Short Date", key: "ribbon.number.short_date" },
  { format: "Long Date", key: "ribbon.number.long_date" },
  { format: "Time", key: "ribbon.number.time" },
  { format: "Percentage", key: "ribbon.number.percentage" },
  { format: "Fraction", key: "ribbon.number.fraction" },
  { format: "Scientific", key: "ribbon.number.scientific" },
  { format: "Text", key: "ribbon.number.text" },
];

/// Il valore dell'elenco per un codice di formato: la famiglia che si
/// riconosce, o `null` per un formato personalizzato.
export function numberFormatOf(code: string | null | undefined): string | null {
  const text = (code ?? "").trim();
  if (text === "" || /^general$/i.test(text)) return "General";
  if (text === "@") return "Text";
  const plain = text.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, (part) => (part.startsWith("[$") ? "$" : ""));
  if (/^_\(|^_-/.test(text) && /\*/.test(text)) return "Accounting";
  if (/%/.test(plain)) return "Percentage";
  if (/E[+-]/i.test(plain)) return "Scientific";
  if (/#?\s*\?+\/\?+/.test(plain)) return "Fraction";
  if (/[hs]/i.test(plain) && !/[dy]/i.test(plain)) return "Time";
  if (/mmmm|dddd/i.test(plain)) return "Long Date";
  if (/[dy]/i.test(plain)) return "Short Date";
  if (/[$€£¥₹]/.test(text)) return "Currency";
  if (/^[#0,.]+$/.test(plain.split(";")[0] ?? "")) return "Number";
  return null;
}

/// I formati contabili del menu, con i codici di Excel (gli stessi di
/// GridCraft, `ribbon::ACCOUNTING_SYMBOLS`).
export const ACCOUNTING: readonly { readonly key: RibbonKey; readonly code: string }[] = [
  { key: "ribbon.accounting.usd", code: '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)' },
  { key: "ribbon.accounting.gbp", code: '_-[$£-809]* #,##0.00_-;-[$£-809]* #,##0.00_-;_-[$£-809]* "-"??_-;_-@_-' },
  { key: "ribbon.accounting.eur", code: '_-[$€-x-euro2] * #,##0.00_-;-[$€-x-euro2] * #,##0.00_-;_-[$€-x-euro2] * "-"??_-;_-@_-' },
  { key: "ribbon.accounting.jpy", code: '_-[$¥-411]* #,##0_-;-[$¥-411]* #,##0_-;_-[$¥-411]* "-"_-;_-@_-' },
  { key: "ribbon.accounting.cny", code: '_-[$¥-804]* #,##0.00_-;-[$¥-804]* #,##0.00_-;_-[$¥-804]* "-"??_-;_-@_-' },
  { key: "ribbon.accounting.inr", code: '_-[$₹-4009]* #,##0.00_-;-[$₹-4009]* #,##0.00_-;_-[$₹-4009]* "-"??_-;_-@_-' },
  { key: "ribbon.accounting.chf", code: '_-[$CHF-807]* #,##0.00_-;-[$CHF-807]* #,##0.00_-;_-[$CHF-807]* "-"??_-;_-@_-' },
  { key: "ribbon.accounting.idr", code: '_-[$Rp-421]* #,##0.00_-;-[$Rp-421]* #,##0.00_-;_-[$Rp-421]* "-"??_-;_-@_-' },
  { key: "ribbon.accounting.krw", code: '_-[$₩-412]* #,##0_-;-[$₩-412]* #,##0_-;_-[$₩-412]* "-"_-;_-@_-' },
  { key: "ribbon.accounting.brl", code: '_-[$R$-416]* #,##0.00_-;-[$R$-416]* #,##0.00_-;_-[$R$-416]* "-"??_-;_-@_-' },
  { key: "ribbon.accounting.rub", code: '_-[$₽-419]* #,##0.00_-;-[$₽-419]* #,##0.00_-;_-[$₽-419]* "-"??_-;_-@_-' },
];

/// I temi del provider (`gridcraft_engine::cmd::view::themes`), con i sei
/// colori principali da mostrare.
export const THEMES: readonly { readonly name: string; readonly accents: readonly string[] }[] = [
  { name: "Craft", accents: ["#156082", "#E97132", "#196B24", "#0F9ED5", "#A02B93", "#4EA72E"] },
  { name: "Slate", accents: ["#4F6D8A", "#8AA1B8", "#C27C4C", "#6F9A72", "#9D6C9B", "#D3B25A"] },
  { name: "Meadow", accents: ["#4D8B3F", "#9BC53D", "#E4B33A", "#2E8C83", "#C4643C", "#7B6A9E"] },
  { name: "Ember", accents: ["#D9532B", "#F2994A", "#F2C94C", "#8C3B2E", "#4A6FA5", "#6F8F4E"] },
  { name: "Ocean", accents: ["#1F78B4", "#33A6CC", "#52C7B8", "#3B5BA5", "#F2A65A", "#8E6CB8"] },
  { name: "Orchid", accents: ["#8E44AD", "#C56CF0", "#F78FB3", "#3DC1D3", "#F5CD79", "#63CDDA"] },
  { name: "Graphite", accents: ["#595959", "#7F7F7F", "#A5A5A5", "#3C78D8", "#CC4125", "#6AA84F"] },
];

/// I formati della carta, come li chiama il provider.
export const PAPERS: readonly string[] = [
  "Letter",
  "Legal",
  "Tabloid",
  "Executive",
  "A3",
  "A4",
  "A5",
  "A6",
  "B4",
  "B5",
  "B6",
  "B4 (ISO)",
  "B5 (ISO)",
  "B6 (ISO)",
  "Japanese Postcard",
  "Japanese Double Postcard",
  "Japanese Envelope #3",
  "Japanese Envelope #4",
  "Japanese Envelope Kaku #2",
  "Japanese Envelope Kaku #3",
];

/// I simboli del menu Simbolo, come in GridCraft.
export const SYMBOLS: readonly string[] = [
  "€", "£", "¥", "©", "®", "™", "±", "≠", "≤", "≥", "÷", "×", "∞", "µ", "α",
  "β", "π", "Σ", "Ω", "°", "•", "…", "→", "←", "↑", "↓", "✓", "★", "½", "¼",
];

/// Le categorie delle funzioni, come le chiama `formulas.functions`.
export const FUNCTION_CATEGORIES = {
  financial: "Financial",
  logical: "Logical",
  text: "Text",
  dateTime: "DateTime",
  lookup: "Lookup",
  mathTrig: "MathTrig",
} as const;

/// Le categorie del menu «Altre funzioni».
export const MORE_CATEGORIES: readonly { readonly category: string; readonly key: RibbonKey }[] = [
  { category: "Statistical", key: "ribbon.formulas.more.statistical" },
  { category: "Engineering", key: "ribbon.formulas.more.engineering" },
  { category: "Information", key: "ribbon.formulas.more.information" },
  { category: "Database", key: "ribbon.formulas.more.database" },
  { category: "Compatibility", key: "ribbon.formulas.more.compatibility" },
  { category: "Web", key: "ribbon.formulas.more.web" },
  { category: "Cube", key: "ribbon.formulas.more.cube" },
];

export const FUNCTIONS = "formulas.functions";
export const RECENT = "formulas.recentlyUsed";

/// Le voci di una categoria di funzioni: il nome, e la firma sotto. Una
/// voce comincia la formula nella cella attiva.
export async function functionEntries(view: RibbonView, category: string): Promise<readonly MenuEntry[]> {
  const list = resultList(await view.query(FUNCTIONS, { category }));
  if (!list) return [];
  return list.flatMap((item): MenuEntry[] => {
    const name = (item as { name?: unknown }).name;
    if (typeof name !== "string" || name === "") return [];
    const signature = (item as { signature?: unknown }).signature;
    return [{ label: { raw: name }, write: `${name}(`, description: typeof signature === "string" ? signature : undefined }];
  });
}

/// Le funzioni usate di recente nella cartella.
export async function recentEntries(view: RibbonView): Promise<readonly MenuEntry[]> {
  const list = resultList(await view.query(RECENT, {}));
  if (!list) return [];
  return list.filter((name): name is string => typeof name === "string" && name !== "").map((name) => ({ label: { raw: name }, write: `${name}(` }));
}

/// Un menu di funzioni di una categoria.
export function functionMenu(label: RibbonKey, icon: string, keytip: string, category: string): MenuControl {
  return { kind: "menu", label, icon, keytip, size: "large", requires: [FUNCTIONS], items: (view) => functionEntries(view, category) };
}

export const style = (view: RibbonView) => view.style;
export const toggle = (on: boolean) => ({ on });

/// La tabella della selezione, per i comandi della scheda Struttura tabella.
export const inTable = (view: RibbonView) => ({ table: view.table?.name ?? "" });

/// Le voci di un'opzione di stile della tabella.
export function tableOption(id: string, label: RibbonKey, keytip: string, read: (table: GridTable) => boolean): CheckControl {
  return {
    kind: "check",
    id,
    label,
    keytip,
    checked: (view) => (view.table ? read(view.table) : false),
    params: (on, view) => ({ ...inTable(view), on }),
  };
}
