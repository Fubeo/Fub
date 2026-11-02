// La finestra che la tavolozza costruisce per un comando dei fogli che non ne
// ha una scritta a mano: un campo per parametro, letto dal catalogo.
//
// Si compila come le finestre di `dialogs/`: le stesse classi, gli stessi
// campi (`renderFields`), il rifiuto del motore scritto dentro la finestra,
// che resta aperta. Le regole sono quelle del catalogo:
//
// - un parametro facoltativo lasciato vuoto non va nei parametri, e una
//   casella facoltativa ci va solo se la si è toccata;
// - una cella o un intervallo obbligatori partono dalla selezione;
// - un JSON si legge prima di partire, e se non si legge lo si dice;
// - i campi di un gruppo «uno fra» stanno insieme, e se ne manda solo quello
//   compilato: due compilati sono un errore, nessuno lo è se il gruppo ha un
//   campo obbligatorio.
//
// Per un comando con più forme (`altreForme`) la finestra è quella della
// forma principale; un comando «aperto» accetta anche parametri che il
// catalogo non elenca, e la finestra chiede soltanto quelli elencati.
import { openDialog } from "../../../kit";
import { identifier } from "../../../ui/a11y";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { renderFields, readNumber, type FieldSpec, type Values } from "../dialogs/fields";
import type { GridRun } from "../engine";
import { t, type FogliKey } from "./strings";

/// Un parametro di un comando, come lo scrive il catalogo.
export interface CatalogField {
  readonly nome: string;
  readonly tipo: "testo" | "segreto" | "numero" | "sino" | "cella" | "intervallo" | "foglio" | "scelta" | "json";
  readonly facoltativo: boolean;
  readonly valori?: readonly string[];
  readonly aperta?: boolean;
  /// Il gruppo «uno fra» di cui fa parte, se ne fa parte.
  readonly unoFra?: number;
}

/// Un comando del catalogo.
export interface CatalogCommand {
  readonly motore: string;
  readonly id: string;
  readonly titolo: string;
  readonly etichetta: string;
  readonly posto: { readonly scheda: string; readonly gruppo: string | null } | null;
  readonly campi: readonly CatalogField[];
  readonly aperto?: boolean;
  readonly altreForme?: readonly (readonly CatalogField[])[];
}

/// Ciò che la finestra chiede al motore della griglia.
export interface FormEngine {
  run(id: string, params?: string): Promise<GridRun>;
  selectionRefs(): { readonly sheet: string; readonly range: string; readonly active: string };
  sheetNames(): readonly string[];
  focus(): void;
}

/// Il nome di un parametro nella lingua dell'interfaccia.
export function fieldLabel(field: CatalogField): string {
  const label = t(`fogli.campo.${field.nome}` as FogliKey);
  return field.facoltativo ? t("fogli.form.optional", { label }) : label;
}

/// Il nome senza «(facoltativo)», per gli errori.
function bareLabel(field: CatalogField): string {
  return t(`fogli.campo.${field.nome}` as FogliKey);
}

/// Se il comando chiede almeno un parametro che non si può lasciare vuoto:
/// solo allora la tavolozza apre la finestra, e altrimenti lo dà subito sulla
/// selezione, come il pulsante della barra.
export function needsForm(command: CatalogCommand): boolean {
  return command.campi.some((field) => !field.facoltativo);
}

/// Un campo di testo con dei suggerimenti (una scelta aperta) o con un
/// esempio (un JSON): disegnato qui, con la stessa forma dei campi di
/// `renderFields`.
function freeField(field: CatalogField, label: string, multiline: boolean): FieldSpec {
  return {
    kind: "custom",
    key: field.nome,
    label,
    render: (values, onChange, life) => {
      const row = document.createElement("div");
      row.className = "grid-dialog-field";
      const control = multiline ? document.createElement("textarea") : document.createElement("input");
      control.id = identifier("grid-dialog-field");
      control.dataset.key = field.nome;
      control.spellcheck = false;
      if (control instanceof HTMLTextAreaElement) {
        control.className = "grid-dialog-area";
        control.rows = 3;
        control.placeholder = t("fogli.form.json_hint");
      } else {
        control.className = "grid-dialog-input";
        control.autocomplete = "off";
      }
      control.value = typeof values[field.nome] === "string" ? (values[field.nome] as string) : "";
      life.listen(control, "input", () => {
        values[field.nome] = control.value;
        onChange(field.nome);
      });
      const name = document.createElement("label");
      name.className = "grid-dialog-label";
      name.htmlFor = control.id;
      name.textContent = label;
      row.append(name, control);
      if (!multiline && field.valori && field.valori.length > 0) {
        const list = document.createElement("datalist");
        list.id = identifier("grid-dialog-values");
        for (const value of field.valori) {
          const option = document.createElement("option");
          option.value = value;
          list.append(option);
        }
        control.setAttribute("list", list.id);
        row.append(list);
      }
      return row;
    },
  };
}

/// Il campo di un parametro.
function specOf(field: CatalogField, sheets: readonly string[]): FieldSpec {
  const label = fieldLabel(field);
  const key = field.nome;
  switch (field.tipo) {
    case "segreto":
      return { kind: "password", key, label };
    case "numero":
      return { kind: "number", key, label };
    case "sino":
      return { kind: "check", key, label };
    case "cella":
      return { kind: "text", key, label, placeholder: "A1" };
    case "intervallo":
      return { kind: "text", key, label, placeholder: "A1:B2" };
    case "foglio": {
      const options = sheets.map((name) => ({ value: name, label: name }));
      return { kind: "select", key, label, options: field.facoltativo ? [{ value: "", label: t("fogli.form.none") }, ...options] : options };
    }
    case "scelta": {
      if (field.aperta) return freeField(field, label, false);
      const options = (field.valori ?? []).map((value) => ({ value, label: value }));
      return { kind: "select", key, label, options: field.facoltativo ? [{ value: "", label: t("fogli.form.none") }, ...options] : options };
    }
    case "json":
      return freeField(field, label, true);
    case "testo":
    default:
      return { kind: "text", key, label };
  }
}

/// I campi della finestra, nell'ordine del catalogo: quelli di un gruppo
/// «uno fra» insieme, dove compare il primo.
export function formSpecs(fields: readonly CatalogField[], sheets: readonly string[]): FieldSpec[] {
  const specs: FieldSpec[] = [];
  const placed = new Set<number>();
  for (const field of fields) {
    if (field.unoFra === undefined) {
      specs.push(specOf(field, sheets));
      continue;
    }
    if (placed.has(field.unoFra)) continue;
    placed.add(field.unoFra);
    const members = fields.filter((each) => each.unoFra === field.unoFra);
    specs.push({ kind: "section", label: t("fogli.form.one_of"), fields: members.map((each) => specOf(each, sheets)) });
  }
  return specs;
}

/// I valori di partenza: la selezione per una cella o un intervallo
/// obbligatori, il foglio mostrato e la prima scelta per un foglio o una
/// scelta obbligatori.
export function startValues(fields: readonly CatalogField[], engine: Pick<FormEngine, "selectionRefs" | "sheetNames">): Values {
  const refs = engine.selectionRefs();
  const values: Values = {};
  for (const field of fields) {
    if (field.facoltativo || field.unoFra !== undefined) continue;
    if (field.tipo === "cella") values[field.nome] = refs.active;
    else if (field.tipo === "intervallo") values[field.nome] = refs.range;
    else if (field.tipo === "foglio") values[field.nome] = refs.sheet || (engine.sheetNames()[0] ?? "");
    else if (field.tipo === "scelta" && !field.aperta) values[field.nome] = field.valori?.[0] ?? "";
  }
  return values;
}

/// I parametri da mandare, o la ragione per cui non si parte. `touched` sono
/// le caselle che si sono toccate: una casella facoltativa intatta non va.
export function formParams(
  fields: readonly CatalogField[],
  values: Values,
  touched: ReadonlySet<string>,
): { readonly ok: true; readonly params: Record<string, unknown> } | { readonly ok: false; readonly error: string } {
  const params: Record<string, unknown> = {};
  const filled = new Set<string>();
  for (const field of fields) {
    const raw = values[field.nome];
    const label = bareLabel(field);
    if (field.tipo === "sino") {
      if (!field.facoltativo && field.unoFra === undefined) params[field.nome] = raw === true;
      else if (touched.has(field.nome)) {
        params[field.nome] = raw === true;
        filled.add(field.nome);
      }
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : raw === undefined || raw === null ? "" : raw;
    if (text === "") {
      if (!field.facoltativo && field.unoFra === undefined) return { ok: false, error: t("fogli.form.error.required", { label }) };
      continue;
    }
    if (field.tipo === "numero") {
      const value = typeof text === "number" ? text : readNumber(String(text));
      if (typeof value !== "number") return { ok: false, error: t("fogli.form.error.number", { label }) };
      params[field.nome] = value;
    } else if (field.tipo === "json") {
      try {
        params[field.nome] = JSON.parse(String(text)) as unknown;
      } catch {
        return { ok: false, error: t("fogli.form.error.json", { label }) };
      }
    } else {
      params[field.nome] = text;
    }
    filled.add(field.nome);
  }
  const groups = new Set(fields.flatMap((field) => (field.unoFra === undefined ? [] : [field.unoFra])));
  for (const group of groups) {
    const members = fields.filter((field) => field.unoFra === group);
    const labels = members.map((field) => `«${bareLabel(field)}»`).join(", ");
    const given = members.filter((field) => filled.has(field.nome));
    if (given.length > 1) return { ok: false, error: t("fogli.form.error.one_of", { labels }) };
    if (given.length === 0 && members.some((field) => !field.facoltativo)) {
      return { ok: false, error: t("fogli.form.error.one_of_none", { labels }) };
    }
  }
  return { ok: true, params };
}

/// La finestra aperta, per chiuderla e per le prove.
export interface OpenForm {
  readonly element: HTMLElement;
  readonly closed: Promise<void>;
  close(): void;
}

/// Apre la finestra del comando `command` con il titolo `title`. Applica dà
/// il comando con `engine.run`; il rifiuto del motore resta scritto dentro.
/// Chiusa, il fuoco torna alla griglia.
export function openCommandForm(command: CatalogCommand, title: string, engine: FormEngine, parent: Lifetime): OpenForm {
  const life = openLifetime();
  parent.add(() => life.close());
  const fields = command.campi;
  const values = startValues(fields, engine);
  const touched = new Set<string>();
  const body = document.createElement("div");
  body.className = "grid-dialog grid-command-form";
  const list = document.createElement("div");
  list.className = "grid-command-fields";
  const error = document.createElement("p");
  error.className = "grid-dialog-error";
  error.setAttribute("role", "alert");
  error.hidden = true;
  const fail = (text: string | null): void => {
    error.textContent = text ?? "";
    error.hidden = !text;
  };
  renderFields(list, formSpecs(fields, engine.sheetNames()), values, (key) => {
    touched.add(key);
    fail(null);
  }, life);
  body.append(list, error);
  const handle = openDialog<string>({
    title,
    body,
    className: "grid-command-dialog",
    actions: [
      { id: "cancel", label: t("fogli.form.cancel"), kind: "normal", value: "cancel" },
      { id: "apply", label: t("fogli.form.apply"), kind: "primary", value: "apply" },
    ],
    submit: "apply",
    dismissValue: "",
    lifetime: life,
    confirm: async (value) => {
      if (value !== "apply") return true;
      const read = formParams(fields, values, touched);
      if (!read.ok) {
        fail(read.error);
        return false;
      }
      fail(null);
      const run = await engine.run(command.motore, JSON.stringify(read.params));
      if (!run.ok) fail(run.error ?? t("fogli.form.error.lost"));
      return run.ok;
    },
  });
  const closed = handle.result.then(() => {
    life.close();
    engine.focus();
  });
  return { element: handle.element, closed, close: () => handle.close("") };
}
