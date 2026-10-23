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
import type { GridBook, GridCellStyle, GridObject, GridSheetView, GridTable } from "../../../host/contract";
import { resultList } from "../dialogs/result";
import type { RibbonKey } from "./strings";

/// I parametri di un comando, che diventano il suo testo JSON.
export type Params = Readonly<Record<string, unknown>>;

/// Un testo da mostrare: una chiave del catalogo, o un valore com'è (il nome
/// di una funzione, di un carattere, di un foglio).
export type Text = RibbonKey | { readonly raw: string };

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
/// formula da cominciare, o un menu più in là.
export interface MenuEntry {
  readonly label: Text;
  readonly id?: string;
  readonly params?: Params;
  /// Apre questa finestra con `params` invece di dare il comando `id`.
  readonly dialog?: string;
  /// Scrive nella cella `=` e questo testo invece di dare un comando.
  readonly write?: string;
  /// Un menu che si apre al posto di questo, con i comandi che lo fanno vedere.
  readonly submenu?: () => readonly MenuEntry[] | Promise<readonly MenuEntry[]>;
  readonly requires?: readonly string[];
  readonly icon?: string;
  readonly swatches?: readonly string[];
  readonly description?: string;
  readonly separator?: boolean;
  readonly checked?: boolean;
  readonly choice?: "radio" | "checkbox";
}

interface Base {
  readonly label: RibbonKey;
  /// I tasti dopo la lettera della scheda.
  readonly keytip: string;
  /// Un'icona di `icons.ts`, o un segno scritto come «B».
  readonly icon?: string;
  readonly glyph?: string;
  /// Grande: icona sopra il nome. Piccolo: in una fila, con il nome soltanto
  /// se `labelled`.
  readonly size?: "large" | "small";
  readonly labelled?: boolean;
  /// Una classe in più sul controllo, per il segno («grassetto»).
  readonly className?: string;
  /// Si vede soltanto se vale, oltre al catalogo: un controllo che serve a un
  /// tipo di oggetto e non agli altri.
  readonly when?: (view: RibbonView) => boolean;
}

/// Un pulsante che dà un comando; `pressed` lo fa interruttore.
export interface ButtonControl extends Base {
  readonly kind: "button";
  readonly id: string;
  readonly params?: Params | ((view: RibbonView) => Params);
  /// Apre questa finestra con `params` invece di dare il comando `id`.
  readonly dialog?: string;
  /// Chiede alla shell un'azione sua invece di dare il comando `id`, che
  /// resta la condizione perché il pulsante si veda: l'esportazione in PDF è
  /// un comando dell'host, non della cartella.
  readonly shell?: "exportPdf";
  readonly pressed?: (view: RibbonView) => boolean;
}

/// Un pulsante diviso: la parte grande dà il comando, la freccia apre un menu
/// di varianti. Con `remember`, la parte grande ripete l'ultima scelta.
export interface SplitControl extends Base {
  readonly kind: "split";
  readonly id: string;
  readonly params?: Params;
  readonly menu: (view: RibbonView) => readonly MenuEntry[];
  readonly menuLabel: RibbonKey;
  readonly remember?: boolean;
  readonly pressed?: (view: RibbonView) => boolean;
}

/// Un pulsante che apre soltanto un menu.
export interface MenuControl extends Base {
  readonly kind: "menu";
  readonly items: (view: RibbonView) => readonly MenuEntry[] | Promise<readonly MenuEntry[]>;
  /// I comandi che lo fanno vedere, quando le voci arrivano dopo.
  readonly requires?: readonly string[];
}

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

/// Un elenco a discesa nativo: il carattere, la dimensione, il formato.
export interface SelectControl extends Base {
  readonly kind: "select";
  readonly id: string;
  readonly width: number;
  readonly options: (view: RibbonView) => readonly { readonly value: string; readonly label: Text }[];
  readonly value: (view: RibbonView) => string | null;
  readonly params: (value: string) => Params | null;
}

/// Una casella da spuntare.
export interface CheckControl extends Base {
  readonly kind: "check";
  readonly id: string;
  readonly checked: (view: RibbonView) => boolean;
  readonly params: (on: boolean, view: RibbonView) => Params;
}

/// Una galleria di stili di tabella o di cella.
export interface GalleryControl extends Base {
  readonly kind: "gallery";
  readonly id: string;
  readonly gallery: "table" | "cell";
  readonly params: (name: string, view: RibbonView) => Params;
  readonly current?: (view: RibbonView) => string | null;
}

/// Un campo di testo che dà il comando quando cambia.
export interface FieldControl extends Base {
  readonly kind: "field";
  readonly id: string;
  readonly width: number;
  readonly value: (view: RibbonView) => string;
  readonly params: (value: string, view: RibbonView) => Params;
}

export type RibbonControl =
  | ButtonControl
  | SplitControl
  | MenuControl
  | ColorControl
  | SelectControl
  | CheckControl
  | GalleryControl
  | FieldControl;

/// Una colonna di un gruppo: un controllo grande, o righe di controlli piccoli.
export type RibbonColumn = RibbonControl | { readonly rows: readonly (readonly RibbonControl[])[] };

export interface RibbonGroup {
  readonly id: string;
  readonly label: RibbonKey;
  /// L'icona del gruppo raccolto, quando la barra è stretta.
  readonly icon: string;
  /// Il tasto del gruppo raccolto.
  readonly keytip: string;
  readonly columns: readonly RibbonColumn[];
}

export interface RibbonTab {
  readonly id: string;
  readonly label: RibbonKey;
  readonly keytip: string;
  readonly groups: readonly RibbonGroup[];
  /// Una scheda che c'è soltanto quando la selezione è in una tabella, o
  /// quando è selezionato un grafico, o un oggetto qualsiasi.
  readonly contextual?: "table" | "chart" | "object";
}

/// I controlli di una colonna, nell'ordine in cui si leggono.
export function columnControls(column: RibbonColumn): readonly RibbonControl[] {
  return "rows" in column ? column.rows.flat() : [column];
}

/// I controlli di un gruppo.
export function groupControls(group: RibbonGroup): readonly RibbonControl[] {
  return group.columns.flatMap(columnControls);
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

const FUNCTIONS = "formulas.functions";
const RECENT = "formulas.recentlyUsed";

/// Le voci di una categoria di funzioni: il nome, e la firma sotto. Una
/// voce comincia la formula nella cella attiva.
async function functionEntries(view: RibbonView, category: string): Promise<readonly MenuEntry[]> {
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
async function recentEntries(view: RibbonView): Promise<readonly MenuEntry[]> {
  const list = resultList(await view.query(RECENT, {}));
  if (!list) return [];
  return list.filter((name): name is string => typeof name === "string" && name !== "").map((name) => ({ label: { raw: name }, write: `${name}(` }));
}

/// Un menu di funzioni di una categoria.
function functionMenu(label: RibbonKey, icon: string, keytip: string, category: string): MenuControl {
  return { kind: "menu", label, icon, keytip, size: "large", requires: [FUNCTIONS], items: (view) => functionEntries(view, category) };
}

const style = (view: RibbonView) => view.style;
const toggle = (on: boolean) => ({ on });

/// La tabella della selezione, per i comandi della scheda Struttura tabella.
const inTable = (view: RibbonView) => ({ table: view.table?.name ?? "" });

/// Le voci di un'opzione di stile della tabella.
function tableOption(id: string, label: RibbonKey, keytip: string, read: (table: GridTable) => boolean): CheckControl {
  return {
    kind: "check",
    id,
    label,
    keytip,
    checked: (view) => (view.table ? read(view.table) : false),
    params: (on, view) => ({ ...inTable(view), on }),
  };
}

// ── Home ────────────────────────────────────────────────────────────────

const HOME: RibbonTab = {
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
              { kind: "button", id: "home.bold", label: "ribbon.font.bold", keytip: "1", glyph: "B", className: "grid-ribbon-bold", pressed: (v) => style(v)?.bold === true },
              { kind: "button", id: "home.italic", label: "ribbon.font.italic", keytip: "2", glyph: "I", className: "grid-ribbon-italic", pressed: (v) => style(v)?.italic === true },
              {
                kind: "split",
                id: "home.underline",
                label: "ribbon.font.underline",
                menuLabel: "ribbon.font.underline.menu",
                keytip: "3",
                glyph: "U",
                className: "grid-ribbon-underline",
                pressed: (v) => (style(v)?.underline ?? null) !== null,
                menu: (v) => [
                  { label: "ribbon.font.underline.single", id: "home.underline", params: { style: "single" }, choice: "radio", checked: style(v)?.underline === "single" },
                  { label: "ribbon.font.underline.double", id: "home.underline", params: { style: "double" }, choice: "radio", checked: style(v)?.underline === "double" },
                ],
              },
              { kind: "button", id: "home.strikethrough", label: "ribbon.font.strike", keytip: "4", glyph: "S", className: "grid-ribbon-strike", pressed: (v) => style(v)?.strike === true },
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
const TAB_COLORS: readonly { readonly key: RibbonKey; readonly hex: string }[] = [
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
function autoSumMenu(): readonly MenuEntry[] {
  return [
    { label: "ribbon.autosum.sum", id: "formulas.autoSum", params: { function: "SUM" } },
    { label: "ribbon.autosum.average", id: "formulas.autoSum", params: { function: "AVERAGE" } },
    { label: "ribbon.autosum.count", id: "formulas.autoSum", params: { function: "COUNT" } },
    { label: "ribbon.autosum.max", id: "formulas.autoSum", params: { function: "MAX" } },
    { label: "ribbon.autosum.min", id: "formulas.autoSum", params: { function: "MIN" } },
  ];
}

const CF = "home.conditionalFormat";
const rule = (value: Params): Params => ({ rule: value });

/// Una regola rapida, chiesta dalla sua finestra (`cfQuick`).
const quick = (label: RibbonKey, params: Params, separator = false): MenuEntry => ({ label, id: CF, dialog: "cfQuick", params, separator });

/// La formattazione condizionale: le regole con un valore da scrivere
/// (Maggiore di…, Primi 10…) aprono la loro finestra; quelle senza si danno
/// subito.
function conditionalMenu(): readonly MenuEntry[] {
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

const DATA_BARS: readonly { readonly key: RibbonKey; readonly color: string }[] = [
  { key: "ribbon.cf.bar.blue", color: "#638EC6" },
  { key: "ribbon.cf.bar.green", color: "#63BE7B" },
  { key: "ribbon.cf.bar.red", color: "#F8696B" },
  { key: "ribbon.cf.bar.orange", color: "#FFB628" },
  { key: "ribbon.cf.bar.light_blue", color: "#008AEF" },
  { key: "ribbon.cf.bar.purple", color: "#D6007B" },
];

const COLOR_SCALES: readonly { readonly key: RibbonKey; readonly colors: readonly string[] }[] = [
  { key: "ribbon.cf.scale.gyr", colors: ["#63BE7B", "#FFEB84", "#F8696B"] },
  { key: "ribbon.cf.scale.ryg", colors: ["#F8696B", "#FFEB84", "#63BE7B"] },
  { key: "ribbon.cf.scale.gwr", colors: ["#63BE7B", "#FCFCFF", "#F8696B"] },
  { key: "ribbon.cf.scale.bwr", colors: ["#5A8AC6", "#FCFCFF", "#F8696B"] },
  { key: "ribbon.cf.scale.wg", colors: ["#FCFCFF", "#63BE7B"] },
  { key: "ribbon.cf.scale.wr", colors: ["#FCFCFF", "#F8696B"] },
];

const ICON_SETS: readonly { readonly key: RibbonKey; readonly set: string }[] = [
  { key: "ribbon.cf.icons.arrows3", set: "3Arrows" },
  { key: "ribbon.cf.icons.traffic3", set: "3TrafficLights1" },
  { key: "ribbon.cf.icons.symbols3", set: "3Symbols" },
  { key: "ribbon.cf.icons.rating4", set: "4Rating" },
  { key: "ribbon.cf.icons.arrows5", set: "5Arrows" },
  { key: "ribbon.cf.icons.quarters5", set: "5Quarters" },
];

// ── Inserisci ───────────────────────────────────────────────────────────

/// Le forme del menu Forme, come le chiama `insert.shape`.
const SHAPES: readonly { readonly kind: string; readonly key: RibbonKey; readonly icon: string }[] = [
  { kind: "rectangle", key: "ribbon.shape.rectangle", icon: "gr-shape-rectangle" },
  { kind: "roundedRectangle", key: "ribbon.shape.rounded_rectangle", icon: "gr-shape-rounded" },
  { kind: "ellipse", key: "ribbon.shape.ellipse", icon: "gr-shape-ellipse" },
  { kind: "triangle", key: "ribbon.shape.triangle", icon: "gr-shape-triangle" },
  { kind: "line", key: "ribbon.shape.line", icon: "gr-shape-line" },
  { kind: "arrow", key: "ribbon.shape.arrow", icon: "gr-arrow-right" },
  { kind: "textBox", key: "ribbon.shape.text_box", icon: "gr-text-box" },
];

/// Le icone che `insert.icons` disegna.
const ICON_NAMES: readonly { readonly name: string; readonly key: RibbonKey }[] = [
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
interface ChartKind {
  readonly type: string;
  readonly subtype?: string;
  readonly key: RibbonKey;
  readonly separator?: boolean;
}

const COLUMN_CHARTS: readonly ChartKind[] = [
  { type: "column", subtype: "clustered", key: "ribbon.chart.column_clustered" },
  { type: "column", subtype: "stacked", key: "ribbon.chart.column_stacked" },
  { type: "column", subtype: "stacked100", key: "ribbon.chart.column_stacked100" },
  { type: "bar", subtype: "clustered", key: "ribbon.chart.bar_clustered", separator: true },
  { type: "bar", subtype: "stacked", key: "ribbon.chart.bar_stacked" },
  { type: "bar", subtype: "stacked100", key: "ribbon.chart.bar_stacked100" },
];

const LINE_CHARTS: readonly ChartKind[] = [
  { type: "line", key: "ribbon.chart.line" },
  { type: "line", subtype: "markers", key: "ribbon.chart.line_markers" },
  { type: "line", subtype: "stacked", key: "ribbon.chart.line_stacked" },
  { type: "area", key: "ribbon.chart.area", separator: true },
  { type: "area", subtype: "stacked", key: "ribbon.chart.area_stacked" },
  { type: "area", subtype: "stacked100", key: "ribbon.chart.area_stacked100" },
];

const PIE_CHARTS: readonly ChartKind[] = [
  { type: "pie", key: "ribbon.chart.pie" },
  { type: "doughnut", key: "ribbon.chart.doughnut" },
];

const SCATTER_CHARTS: readonly ChartKind[] = [
  { type: "scatter", key: "ribbon.chart.scatter" },
  { type: "bubble", key: "ribbon.chart.bubble" },
];

const OTHER_CHARTS: readonly ChartKind[] = [
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
const theChart = (view: RibbonView): Params => (view.object?.kind === "chart" ? { chart: view.object.id } : {});

/// L'oggetto selezionato, per `object.*` e `arrange.*`.
const theObject = (view: RibbonView): Params => (view.object ? { kind: view.object.kind, id: view.object.id } : {});

const chartSelected = (view: RibbonView) => view.object?.kind === "chart";
const shapeSelected = (view: RibbonView) => view.object?.kind === "shape";

/// Le voci dei tipi di grafico: `insert.chart` sulla selezione, o
/// `chart.changeType` sul grafico selezionato.
function chartEntries(id: string, kinds: readonly ChartKind[], view: RibbonView): readonly MenuEntry[] {
  const target = id === "insert.chart" ? {} : theChart(view);
  return kinds.map(({ type, subtype, key, separator }) => ({
    label: key,
    id,
    params: { ...target, type, ...(subtype ? { subtype } : {}) },
    separator,
  }));
}

function chartMenu(id: string, label: RibbonKey, keytip: string, icon: string, kinds: readonly ChartKind[]): MenuControl {
  return { kind: "menu", label, keytip, icon, labelled: true, items: (view) => chartEntries(id, kinds, view) };
}

const INSERT: RibbonTab = {
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

// ── Layout di pagina ────────────────────────────────────────────────────

const PAGE_LAYOUT: RibbonTab = {
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

const FORMULAS: RibbonTab = {
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

// ── Dati ────────────────────────────────────────────────────────────────

const DATA: RibbonTab = {
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

const REVIEW: RibbonTab = {
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
        { kind: "button", id: "review.unprotectSheet", label: "ribbon.review.unprotect_sheet", keytip: "PS", icon: "gr-unlock", size: "large" },
        {
          kind: "button",
          id: "review.protectWorkbook",
          label: "ribbon.review.protect_workbook",
          keytip: "PW",
          icon: "gr-lock",
          size: "large",
          params: (view) => ({ on: !(view.book?.protected ?? false) }),
          pressed: (view) => view.book?.protected === true,
        },
      ],
    },
  ],
};

// ── Visualizza ──────────────────────────────────────────────────────────

/// Gli ingrandimenti del menu Zoom.
export const ZOOMS: readonly number[] = [200, 150, 125, 100, 90, 75, 50, 25];

const VIEW: RibbonTab = {
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

// ── Struttura tabella ───────────────────────────────────────────────────

const TABLE_DESIGN: RibbonTab = {
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
const chartElement = (key: RibbonKey, element: string, on: boolean, extra: Params = {}, separator = false) =>
  (view: RibbonView): MenuEntry => ({ label: key, id: "chart.addElement", params: { ...theChart(view), element, on, ...extra }, separator });

const CHART_DESIGN: RibbonTab = {
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

const OBJECT_FORMAT: RibbonTab = {
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
