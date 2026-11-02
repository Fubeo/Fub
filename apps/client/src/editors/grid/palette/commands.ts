// I comandi dei fogli nella tavolozza dei comandi.
//
// Ogni comando del catalogo (`catalogo.generated.json`) che la sessione della
// cartella serve diventa una voce della tavolozza: il titolo tradotto, il
// gruppo «Foglio», la scheda della barra in cui lo si trova. Se il motore lo
// dice spento (`GridEngine.commands`) la voce resta, col motivo; in sola
// lettura lo sono tutti, con un motivo solo. Senza una cartella col fuoco non
// c'è nessuna voce: le chiede alla superficie del riquadro col fuoco la shell.
//
// Si danno come li dà la barra: la finestra scritta a mano se il comando ne
// ha una (`dialogs/`), altrimenti la finestra costruita dal catalogo
// (`form.ts`) se chiede un parametro obbligatorio, altrimenti subito sulla
// selezione con `GridEngine.command`, come un pulsante.
import catalogo from "../catalogo.generated.json";
import { openLifetime } from "../../../ui/lifetime";
import type { GridBook, GridCommandState } from "../../../host/contract";
import type { GridRun } from "../engine";
import { needsForm, openCommandForm, type CatalogCommand, type OpenForm } from "./form";
import { t, type FogliKey } from "./strings";

/// I comandi del catalogo, nell'ordine in cui li scrive.
export const CATALOG_COMMANDS: readonly CatalogCommand[] = (catalogo as { comandi: readonly CatalogCommand[] }).comandi;

/// Una voce della tavolozza (`SurfacePaletteCommand` della superficie).
export interface GridPaletteCommand {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly group: string;
  /// Perché adesso non si può dare; `null` se si può.
  readonly unavailable: string | null;
  run(): void;
}

/// Ciò che i comandi chiedono al motore della griglia.
export interface PaletteEngine {
  commands(): readonly GridCommandState[];
  writable(): boolean;
  command(id: string, params?: string): boolean;
  run(id: string, params?: string): Promise<GridRun>;
  openDialog(id: string, params?: string): boolean;
  selectionRefs(): { readonly sheet: string; readonly range: string; readonly active: string };
  sheetNames(): readonly string[];
  book(): GridBook | null;
  focus(): void;
}

/// La finestra scritta a mano di un comando, con i parametri con cui la
/// apre la barra: gli stessi nomi di `ribbon/tabs.ts` e `ribbon/context.ts`
/// (`palette.test.ts` lo controlla).
type OwnDialog = string | readonly [string, Readonly<Record<string, unknown>>] | ((engine: PaletteEngine) => string);

export const OWN_DIALOGS: Readonly<Record<string, OwnDialog>> = {
  "data.advancedFilter": "advancedFilter",
  "data.goalSeek": "goalSeek",
  "data.removeDuplicates": "removeDuplicates",
  "data.sort": "sort",
  "data.subtotal": "subtotal",
  "data.textToColumns": "textToColumns",
  "data.validation": "dataValidation",
  "edit.fillSeries": "series",
  "edit.find": "find",
  "edit.goTo": "goTo",
  "edit.goToSpecial": "goToSpecial",
  "edit.replace": ["find", { replace: true }],
  "file.printPreview": "printPreview",
  "formulas.defineName": "defineName",
  "formulas.insertFunction": "insertFunction",
  "formulas.nameManager": "nameManager",
  "home.columnWidth": "columnWidth",
  "home.conditionalFormat": "newFormattingRule",
  "home.defaultWidth": "defaultWidth",
  "home.deleteCells": "deleteCells",
  "home.formatCells": "formatCells",
  "home.insertCells": "insertCells",
  "home.manageRules": "manageRules",
  "home.rowHeight": "rowHeight",
  "insert.link": "insertLink",
  "pageLayout.pageSetup": "pageSetup",
  "review.newComment": "comment",
  "review.newNote": "note",
  "review.protectSheet": "protectSheet",
  "review.protectWorkbook": (engine) => (engine.book()?.protected === true ? "unprotectWorkbook" : "protectWorkbook"),
  "review.unprotectSheet": "unprotectSheet",
  "sheet.move": "moveSheet",
  "sheet.rename": "renameSheet",
  "table.resize": "tableResize",
  "view.zoom": "zoom",
};

/// Il titolo del comando nella lingua dell'interfaccia.
export function commandTitle(command: CatalogCommand): string {
  return t(command.titolo as FogliKey);
}

/// Dove lo si trova nella barra, o che è un comando del foglio.
export function commandDescription(command: CatalogCommand): string {
  if (!command.posto) return t("fogli.palette.only_here");
  return t("fogli.palette.in_tab", { tab: t(`fogli.palette.tab.${command.posto.scheda}` as FogliKey) });
}

export interface GridPalette {
  /// Le voci per la tavolozza, lette adesso dal motore.
  commands(): readonly GridPaletteCommand[];
  /// La finestra costruita aperta, per le prove.
  current(): HTMLElement | null;
  destroy(): void;
}

export function mountGridPalette(engine: PaletteEngine): GridPalette {
  const life = openLifetime();
  let form: OpenForm | null = null;

  function give(command: CatalogCommand, title: string): void {
    if (life.closed) return;
    const own = OWN_DIALOGS[command.motore];
    if (own !== undefined) {
      const [id, params] = typeof own === "function" ? [own(engine), {}] : typeof own === "string" ? [own, {}] : own;
      if (engine.openDialog(id, JSON.stringify(params))) return;
    }
    if (needsForm(command)) {
      form?.close();
      const opened = openCommandForm(command, title, engine, life);
      form = opened;
      void opened.closed.then(() => {
        if (form === opened) form = null;
      });
      return;
    }
    engine.command(command.motore, "{}");
  }

  return {
    commands() {
      const states = engine.commands();
      if (states.length === 0 || life.closed) return [];
      const byId = new Map(states.map((state) => [state.id, state]));
      const writable = engine.writable();
      const entries: GridPaletteCommand[] = [];
      for (const command of CATALOG_COMMANDS) {
        const state = byId.get(command.motore);
        if (!state) continue;
        const title = commandTitle(command);
        const unavailable = !writable
          ? t("fogli.palette.read_only")
          : state.enabled
            ? null
            : state.reason?.trim() || t("fogli.palette.off");
        entries.push({
          id: command.id,
          title,
          description: commandDescription(command),
          group: t("fogli.palette.group"),
          unavailable,
          run: () => give(command, title),
        });
      }
      return entries;
    },
    current: () => form?.element ?? null,
    destroy() {
      form?.close();
      form = null;
      life.close();
    },
  };
}
