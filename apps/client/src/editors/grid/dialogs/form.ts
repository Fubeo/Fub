// Le finestre fatte di campi: la maggior parte. Una finestra dice i suoi
// campi a partire dai valori (Convalida dati cambia campi quando cambia
// «Consenti»), il comando dell'OK e come i valori diventano i suoi parametri.
//
// L'OK controlla i numeri, chiede i parametri (una stringa è la ragione per
// cui non si può ancora andare) e dà il comando: la finestra si chiude
// soltanto se il provider lo prende, e se no resta aperta con la sua ragione.
import { createTabs } from "../../../kit";
import { checkNumbers, controlOf, namedFields, renderFields, type FieldSpec, type Values } from "./fields";
import type { DialogContext, DialogSpec, Params, SpecAction } from "./host";
import { t } from "./strings";

export interface FormPage {
  readonly id: string;
  readonly label: string;
  readonly fields: (values: Values) => readonly FieldSpec[];
}

export interface FormOptions {
  readonly title: string;
  readonly values: Values;
  /// I campi, a partire dai valori. Senza, le schede di `pages`.
  readonly fields?: (values: Values) => readonly FieldSpec[];
  readonly pages?: readonly FormPage[];
  /// La scheda da cui si parte.
  readonly page?: string;
  /// Dopo ogni cambiamento dell'utente: può correggere gli altri valori. Vero
  /// ridisegna i campi.
  readonly change?: (key: string, values: Values) => boolean | void;
  /// Il comando dell'OK.
  readonly command: string | ((values: Values) => string);
  /// I parametri del comando, o la ragione per cui non si può ancora darlo.
  /// Senza, i valori dei campi che si vedono.
  readonly params?: (values: Values) => Params | string;
  /// Il risultato del comando: falso tiene aperta la finestra.
  readonly done?: (result: unknown) => boolean | void;
  readonly ok?: string;
  /// Azioni prima di Annulla («Cancella tutto», «Rimuovi collegamento»).
  readonly extra?: readonly SpecAction[];
  readonly className?: string;
}

export interface FormHandle {
  readonly spec: DialogSpec;
  readonly values: Values;
  /// Ridisegna i campi dai valori.
  redraw(): void;
}

/// I valori dei campi che si vedono, quelli spenti esclusi.
function shown(specs: readonly FieldSpec[], values: Values): Params {
  const params: Record<string, unknown> = {};
  for (const spec of namedFields(specs)) {
    if (!spec.disabled && values[spec.key] !== undefined) params[spec.key] = values[spec.key];
  }
  return params;
}

export function formHandle(context: DialogContext, options: FormOptions): FormHandle {
  const values = options.values;
  const body = document.createElement("div");
  body.className = "grid-dialog-form";
  const pages: readonly FormPage[] = options.pages ?? [{ id: "", label: "", fields: options.fields ?? (() => []) }];
  const panels = pages.map(() => {
    const panel = document.createElement("div");
    panel.className = "grid-dialog-fields";
    return panel;
  });
  const specs = (): readonly FieldSpec[] => pages.flatMap((page) => page.fields(values));

  const redraw = (): void => {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.key : undefined;
    pages.forEach((page, index) => renderFields(panels[index]!, page.fields(values), values, changed, context.life));
    if (active) controlOf(body, active)?.focus({ preventScroll: true });
  };
  const changed = (key: string): void => {
    if (options.change?.(key, values) === true) redraw();
  };

  if (options.pages) {
    const tablist = document.createElement("div");
    tablist.className = "grid-dialog-tabs";
    body.append(tablist, ...panels);
    createTabs({
      tablist,
      tabs: pages.map((page, index) => ({ id: page.id, label: page.label, panel: panels[index] })),
      selected: options.page,
      onSelect: () => {},
      lifetime: context.life,
    });
  } else {
    body.append(...panels);
  }
  redraw();

  const ok: SpecAction = {
    id: "ok",
    label: options.ok ?? t("grid.dialog.ok"),
    kind: "primary",
    run: async () => {
      const all = specs();
      const wrong = checkNumbers(all, values);
      if (wrong) {
        context.fail(wrong);
        return false;
      }
      const params = options.params ? options.params(values) : shown(all, values);
      if (typeof params === "string") {
        context.fail(params);
        return false;
      }
      const command = typeof options.command === "string" ? options.command : options.command(values);
      const result = await context.ask(command, params);
      if (result === undefined) return false;
      return options.done?.(result) !== false;
    },
  };
  return {
    values,
    redraw,
    spec: {
      title: options.title,
      body,
      actions: [...(options.extra ?? []), { id: "cancel", label: t("grid.dialog.cancel") }, ok],
      submit: "ok",
      className: options.className,
    },
  };
}

/// Una finestra di campi, pronta da mostrare.
export function formDialog(context: DialogContext, options: FormOptions): DialogSpec {
  return formHandle(context, options).spec;
}
