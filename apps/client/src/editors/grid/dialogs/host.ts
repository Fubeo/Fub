// Le finestre di dialogo dei fogli: quelle che un comando chiede alla shell
// (`GridCommandOutcome.dialog`) e quelle che la barra e le scorciatoie di
// Excel aprono da sé (`GridEngine.openDialog`).
//
// Una finestra raccoglie i parametri di un comando del catalogo e lo dà con
// `GridEngine.run`. Se il provider lo rifiuta, la ragione resta scritta nella
// finestra, che non si chiude: è Excel, che dice «Il riferimento non è
// valido» sotto il campo sbagliato. C'è una finestra alla volta; quella aperta
// da un'altra (Gestione nomi › Nuovo…) torna a quella quando si chiude.
//
// Le finestre che il catalogo non conosce (un file da aprire, un'immagine da
// scegliere) non si aprono: `open` rende falso e il comando resta com'era.
import type { GridBook, GridCellStyle, GridCommandState, GridDialog, GridSheetView, GridTable } from "../../../host/contract";
import { openDialog, type DialogActionKind, type DialogHandle } from "../../../kit";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import type { GridRun } from "../engine";
import { DIALOGS } from "./catalog";
import { readResult } from "./result";
import { t } from "./strings";

/// I parametri di un comando, che diventano il suo testo JSON.
export type Params = Readonly<Record<string, unknown>>;

export { readResult, resultList } from "./result";

/// Ciò che le finestre chiedono al motore della griglia.
export interface DialogEngine {
  commands(): readonly GridCommandState[];
  run(id: string, params?: string): Promise<GridRun>;
  query(id: string, params?: string): Promise<string | null>;
  selectionRefs(): { readonly sheet: string; readonly range: string; readonly active: string };
  selection(): { readonly focus: { readonly row: number; readonly column: number } };
  sheetNames(): readonly string[];
  hiddenSheets(): readonly { readonly id: string; readonly name: string }[];
  sheetView(): GridSheetView;
  tables(): readonly GridTable[];
  book(): GridBook | null;
  activeStyle(): GridCellStyle | undefined;
  viewportSize(): { width: number; height: number };
  lineSize(axis: "row" | "column", index: number): number | null;
  writeFormula(text: string): boolean;
  focus(): void;
}

/// Un'azione della finestra. Senza `run` la chiude e basta (Annulla, Chiudi).
export interface SpecAction {
  readonly id: string;
  readonly label: string;
  readonly kind?: DialogActionKind;
  /// Vero chiude la finestra; falso la tiene aperta, che dice da sé perché.
  readonly run?: () => boolean | Promise<boolean>;
}

/// Una finestra pronta da mostrare.
export interface DialogSpec {
  readonly title: string;
  readonly body: HTMLElement;
  readonly actions: readonly SpecAction[];
  /// L'azione che Invio in un campo preme.
  readonly submit?: string;
  /// Una classe in più: `grid-dialog-wide` per le finestre con le schede.
  readonly className?: string;
}

/// Ciò che una finestra sa fare mentre si costruisce e mentre è aperta.
export interface DialogContext {
  readonly engine: DialogEngine;
  readonly params: Params;
  /// Vive quanto la finestra.
  readonly life: Lifetime;
  /// Dice nella finestra perché il comando non è andato; `null` lo toglie.
  fail(text: string | null): void;
  /// Dà il comando `id`: vero se il provider l'ha preso, falso con la sua
  /// ragione scritta nella finestra.
  give(id: string, params: Params): Promise<boolean>;
  /// Dà il comando `id` e ne rende il risultato letto; `undefined` se non è
  /// andato, con la ragione scritta.
  ask(id: string, params: Params): Promise<unknown>;
  /// Un comando che soltanto legge: il risultato letto, o `null`.
  read(id: string, params?: Params): Promise<unknown>;
  /// Apre la finestra `id` al posto di questa; con `back`, questa torna
  /// quando l'altra si chiude.
  open(id: string, params?: Params, back?: boolean): void;
  /// Chiude la finestra.
  close(): void;
  /// Se il catalogo serve il comando `id`.
  serves(id: string): boolean;
}

export type DialogBuilder = (context: DialogContext) => DialogSpec | null | Promise<DialogSpec | null>;

export interface GridDialogs {
  /// Apre la finestra chiesta. Falso se non la conosce o il suo comando non
  /// c'è.
  open(dialog: GridDialog): boolean;
  /// La finestra aperta, per le prove.
  current(): HTMLElement | null;
  destroy(): void;
}

function paramsOf(text: string): Params {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Params) : {};
  } catch {
    return {};
  }
}

interface Shown {
  readonly id: string;
  readonly params: Params;
  readonly handle: DialogHandle<string>;
  readonly life: Lifetime;
}

export function mountGridDialogs(engine: DialogEngine): GridDialogs {
  const life = openLifetime();
  let shown: Shown | null = null;
  /// Le finestre da cui si è venuti, la più vicina in cima.
  let back: { id: string; params: Params }[] = [];
  /// Cresce a ogni apertura: una finestra che si costruisce tardi e non è
  /// più l'ultima chiesta non si mostra.
  let ticket = 0;

  const serves = (id: string): boolean => engine.commands().some((command) => command.id === id);

  function close(): void {
    shown?.handle.close("");
  }

  function show(id: string, params: Params, remember: boolean): boolean {
    const builder = DIALOGS[id];
    if (!builder || life.closed) return false;
    if (shown) {
      if (remember) back.push({ id: shown.id, params: shown.params });
      else back = [];
      const leaving = shown;
      shown = null;
      leaving.handle.close("");
    } else if (!remember) {
      back = [];
    }
    const mine = ++ticket;
    const own = openLifetime();
    life.add(() => own.close());
    const error = document.createElement("p");
    error.className = "grid-dialog-error";
    error.setAttribute("role", "alert");
    error.hidden = true;
    const fail = (text: string | null): void => {
      error.textContent = text ?? "";
      error.hidden = text === null || text === "";
    };
    const give = async (command: string, args: Params): Promise<GridRun> => {
      fail(null);
      const run = await engine.run(command, JSON.stringify(args));
      if (!run.ok) fail(run.error ?? t("grid.dialog.error.lost"));
      return run;
    };
    const context: DialogContext = {
      engine,
      params,
      life: own,
      fail,
      give: async (command, args) => (await give(command, args)).ok,
      ask: async (command, args) => {
        const run = await give(command, args);
        return run.ok ? readResult(run.result) ?? {} : undefined;
      },
      read: async (command, args = {}) => readResult(await engine.query(command, JSON.stringify(args))),
      open: (next, args = {}, remember = false) => {
        queueMicrotask(() => show(next, args, remember));
      },
      close: () => {
        if (shown?.life === own) close();
      },
      serves,
    };
    const finish = (spec: DialogSpec | null): void => {
      if (!spec || mine !== ticket || life.closed) {
        own.close();
        return;
      }
      const body = document.createElement("div");
      body.className = "grid-dialog";
      body.append(spec.body, error);
      const actions = new Map(spec.actions.map((action) => [action.id, action]));
      const handle = openDialog<string>({
        title: spec.title,
        body,
        className: spec.className,
        actions: spec.actions.map((action) => ({
          id: action.id,
          label: action.label,
          kind: action.kind,
          value: action.id,
        })),
        submit: spec.submit,
        dismissValue: "",
        lifetime: own,
        confirm: (value) => actions.get(value)?.run?.() ?? true,
      });
      const entry: Shown = { id, params, handle, life: own };
      shown = entry;
      void handle.result.then(() => {
        own.close();
        if (shown !== entry) return;
        shown = null;
        const previous = back.pop();
        if (previous && !life.closed) show(previous.id, previous.params, false);
        else engine.focus();
      });
    };
    let built: DialogSpec | null | Promise<DialogSpec | null>;
    try {
      built = builder(context);
    } catch {
      built = null;
    }
    if (built instanceof Promise) built.then(finish, () => finish(null));
    else finish(built);
    return true;
  }

  return {
    open(dialog) {
      if (!DIALOGS[dialog.id]) return false;
      return show(dialog.id, paramsOf(dialog.params), false);
    },
    current: () => shown?.handle.element ?? null,
    destroy() {
      back = [];
      close();
      life.close();
    },
  };
}
