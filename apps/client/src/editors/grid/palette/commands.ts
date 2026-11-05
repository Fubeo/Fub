// I comandi dei fogli nella tavolozza dei comandi.
//
// Ogni comando del catalogo (`catalogo.generated.json`) che la sessione della
// cartella serve diventa una voce della tavolozza: il titolo tradotto, il
// gruppo «Foglio», la scheda della barra in cui lo si trova (se il gruppo del
// suo posto è nella barra). Se il motore lo dice spento
// (`GridEngine.commands`) la voce resta, col motivo tradotto (`motivi.ts`);
// in sola lettura lo sono soltanto i comandi che cambiano la cartella
// (`effetto` del catalogo), con un motivo solo: quelli che leggono o
// cambiano soltanto ciò che si vede restano accesi. Senza una cartella col
// fuoco non c'è nessuna voce: le chiede alla superficie del riquadro col
// fuoco la shell.
//
// Si danno da un punto solo, `GridPalette.give`, lo stesso della barra e del
// menu «Comandi»: la finestra scritta a mano se il comando ne ha una
// (`dialogs/`), altrimenti la finestra costruita dal catalogo (`form.ts`) se
// chiede un parametro obbligatorio, altrimenti subito sulla selezione con
// `GridEngine.command`, come un pulsante. Un comando che legge mostra il suo
// risultato nella finestra del risultato (`risultato.ts`): subito, o dopo
// la finestra dei parametri.
import catalogo from "../catalogo.generated.json";
import { openLifetime } from "../../../ui/lifetime";
import type { GridBook, GridCommandState } from "../../../host/contract";
import type { GridCommandEffect, GridRun } from "../engine";
import { motivo } from "../motivi";
import { openResult, type ResultWindow } from "../risultato";
import { needsForm, openCommandForm, type CatalogCommand, type FormEngine, type OpenForm } from "./form";
import { t, type FogliKey } from "./strings";

/// I comandi del catalogo, nell'ordine in cui li scrive.
export const CATALOG_COMMANDS: readonly CatalogCommand[] = (catalogo as { comandi: readonly CatalogCommand[] }).comandi;

const BY_MOTORE: ReadonlyMap<string, CatalogCommand> = new Map(CATALOG_COMMANDS.map((command) => [command.motore, command]));

/// Il comando del catalogo col nome `motore`.
export function catalogCommand(motore: string): CatalogCommand | undefined {
  return BY_MOTORE.get(motore);
}

/// L'effetto del comando `motore` secondo il catalogo.
export function effectOf(motore: string): GridCommandEffect | undefined {
  return BY_MOTORE.get(motore)?.effetto;
}

/// Una scheda del menu dei fogli: i suoi gruppi, `solo` se la barra non la
/// mostra, e la scheda contestuale (`table`, `chart`, `object`, `pivot`).
export interface CatalogTab {
  readonly id: string;
  readonly solo: boolean;
  readonly contesto: string | null;
  readonly gruppi: readonly { readonly id: string; readonly solo: boolean }[];
}

/// Le schede e i gruppi del menu, nell'ordine del menu.
export const CATALOG_TABS: readonly CatalogTab[] = (catalogo as { schede: readonly CatalogTab[] }).schede;

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
  /// Dice al motore che cosa fa ogni comando (`GridEngine.setCommandEffects`).
  setCommandEffects?(effectOf: (id: string) => GridCommandEffect | undefined, readOnlyDialogs: Iterable<string>): void;
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

/// Le finestre scritte a mano di comandi che non cambiano la cartella: in
/// sola lettura si aprono lo stesso.
export const READ_ONLY_DIALOGS: readonly string[] = Object.entries(OWN_DIALOGS).flatMap(([motore, own]) => {
  if (typeof own === "function" || effectOf(motore) === "cambia") return [];
  return [typeof own === "string" ? own : own[0]];
});

/// Perché un comando non si può dare adesso, nella lingua della shell, o
/// `null` se si può: in sola lettura soltanto quelli che cambiano.
export function commandUnavailable(motore: string, state: GridCommandState, writable: boolean): string | null {
  if (!writable && effectOf(motore) !== "legge" && effectOf(motore) !== "mostra") return t("fogli.palette.read_only");
  if (state.enabled) return null;
  return motivo(state.reason) ?? t("fogli.palette.off");
}

/// Il titolo del comando nella lingua dell'interfaccia.
export function commandTitle(command: CatalogCommand): string {
  return t(command.titolo as FogliKey);
}

/// Dove lo si trova nella barra, o che è un comando del foglio: la scheda
/// se la barra mostra la scheda e il gruppo del suo posto.
export function commandDescription(command: CatalogCommand): string {
  const { scheda, gruppo } = command.posto;
  const tab = CATALOG_TABS.find((candidate) => candidate.id === scheda);
  const onBar = tab !== undefined && !tab.solo && tab.gruppi.some((group) => group.id === gruppo && !group.solo);
  if (!onBar) return t("fogli.palette.only_here");
  return t("fogli.palette.in_tab", { tab: t(`fogli.palette.tab.${scheda}` as FogliKey) });
}

export interface GridPalette {
  /// Le voci per la tavolozza, lette adesso dal motore.
  commands(): readonly GridPaletteCommand[];
  /// Dà il comando `motore` con `params` come lo dà un pulsante della barra:
  /// il punto solo da cui la barra, il menu «Comandi» e la tavolozza aprono
  /// la finestra del risultato di un comando che legge. Falso se non è
  /// partito niente.
  give(motore: string, params?: string): boolean;
  /// La finestra costruita aperta, per le prove.
  current(): HTMLElement | null;
  destroy(): void;
}

export function mountGridPalette(engine: PaletteEngine): GridPalette {
  const life = openLifetime();
  engine.setCommandEffects?.(effectOf, READ_ONLY_DIALOGS);
  let form: OpenForm | null = null;
  let result: ResultWindow | null = null;

  /// Il motore per la finestra dei parametri: il rifiuto del motore passa
  /// tradotto, e un comando che legge tiene il suo risultato per mostrarlo.
  function formEngine(kept?: (params: string, run: Extract<GridRun, { ok: true }>) => void): FormEngine {
    return {
      run: async (id, params = "{}") => {
        const run = await engine.run(id, params);
        if (!run.ok) return { ok: false, error: motivo(run.error) };
        kept?.(params, run);
        return run;
      },
      selectionRefs: () => engine.selectionRefs(),
      sheetNames: () => engine.sheetNames(),
      focus: () => engine.focus(),
    };
  }

  function showResult(command: CatalogCommand, params: string, first?: GridRun): void {
    const opened = openResult({
      motore: command.motore,
      title: commandTitle(command),
      params,
      engine,
      lifetime: life,
      first,
    });
    result = opened;
    void opened.closed.then(() => {
      if (result === opened) result = null;
    });
  }

  function openForm(command: CatalogCommand): void {
    form?.close();
    let kept: { params: string; run: GridRun } | null = null;
    const reads = command.effetto === "legge";
    const opened = openCommandForm(
      command,
      commandTitle(command),
      formEngine(reads ? (params, run) => (kept = { params, run }) : undefined),
      life,
    );
    form = opened;
    void opened.closed.then(() => {
      if (form === opened) form = null;
      if (kept && !life.closed) showResult(command, kept.params, kept.run);
    });
  }

  /// Dà `command`: con `ask` (la tavolozza) prima la sua finestra scritta a
  /// mano, se ne ha una; un parametro obbligatorio che manca chiede la
  /// finestra dei parametri; un comando che legge mostra il risultato.
  function start(command: CatalogCommand, params: string, ask: boolean): boolean {
    const motore = command.motore;
    const empty = params.trim() === "" || params.trim() === "{}";
    const own = OWN_DIALOGS[motore];
    if (ask && own !== undefined) {
      const [id, extra] = typeof own === "function" ? [own(engine), {}] : typeof own === "string" ? [own, {}] : own;
      if (engine.openDialog(id, JSON.stringify(extra))) return true;
    }
    const reads = command.effetto === "legge" && own === undefined;
    if (empty && needsForm(command) && (ask || reads)) {
      openForm(command);
      return true;
    }
    if (reads) {
      const state = engine.commands().find((one) => one.id === motore);
      if (!state || commandUnavailable(motore, state, engine.writable()) !== null) return false;
      showResult(command, empty ? "{}" : params);
      return true;
    }
    return engine.command(motore, empty ? "{}" : params);
  }

  function give(motore: string, params = "{}"): boolean {
    if (life.closed) return false;
    const command = catalogCommand(motore);
    return command ? start(command, params, false) : engine.command(motore, params);
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
        entries.push({
          id: command.id,
          title: commandTitle(command),
          description: commandDescription(command),
          group: t("fogli.palette.group"),
          unavailable: commandUnavailable(command.motore, state, writable),
          run: () => {
            if (!life.closed) start(command, "{}", true);
          },
        });
      }
      return entries;
    },
    give,
    current: () => form?.element ?? result?.element ?? null,
    destroy() {
      form?.close();
      form = null;
      result?.close();
      result = null;
      life.close();
    },
  };
}
