// Il piede della Base: quante note mostra la vista e i riepiloghi scritti nel
// file, ognuno sotto la sua colonna, coi numeri e le date nel formato della
// lingua.
//
// I valori li calcola il core (`derive`, in `fub-features/src/base.rs`): il
// piede li legge per nome (`label` di ogni riepilogo del piano) e li mette in
// fila. Non ricalcola niente: una cella mostrata non è la fonte.
import { plural, t } from "../../i18n/strings";
import type { BaseCellValue, BaseSummaryDef } from "./data";
import { cellText } from "./data";
import { sameKey } from "./sort";

export interface BaseFooterInput {
  /// Le colonne della vista, nell'ordine in cui si vedono.
  readonly columns: readonly string[];
  /// I riepiloghi del piano, nell'ordine del file.
  readonly summaries: readonly BaseSummaryDef[];
  /// I valori dei riepiloghi, per `label`, come li dà `derive`.
  readonly values: Readonly<Record<string, BaseCellValue>>;
  /// Quante note la vista mostra.
  readonly count: number;
  /// Quante note ha la vista senza la ricerca.
  readonly total: number;
  /// La ricerca della barra filtra le righe: i riepiloghi restano su tutte
  /// le note della vista, e il piede lo dice.
  readonly searching: boolean;
  /// La lingua dei numeri e delle date.
  readonly locale: string;
  /// Il nome di una colonna, per i riepiloghi che non stanno sotto una
  /// colonna mostrata.
  readonly labelOf: (key: string) => string;
}

// `useGrouping: "always"` è di Intl.NumberFormat v3 (Chrome 106, Safari
// 15.4): i tipi della libreria qui lo conoscono solo come booleano. Un motore
// che non lo sa lo legge come `true`, cioè il separatore da cinque cifre.
const ALWAYS_GROUPED = { maximumFractionDigits: 2, useGrouping: "always" } as unknown as Intl.NumberFormatOptions;

/// Il valore di un riepilogo come si legge: i numeri coi separatori della
/// lingua, le date come giorno e mese (e l'anno se non è questo), un errore
/// come la parola «errore».
export function summaryText(value: BaseCellValue | undefined, locale: string, now = new Date()): string {
  if (!value || value.kind === "empty") return "—";
  return shownText(value, locale, now);
}

/// Un valore come si legge in una cella o nel piede, nel formato della
/// lingua (le stesse regole del riepilogo). È solo da guardare: la cella che
/// si scrive, il CSV, le copie e la ricerca restano sul valore com'è
/// (`cellText`).
export function shownText(value: BaseCellValue | undefined, locale: string, now = new Date()): string {
  if (!value || value.kind === "empty") return "";
  switch (value.kind) {
    case "number":
    case "duration":
      // Il separatore delle migliaia anche a quattro cifre («2.600»), come
      // nel prototipo: l'italiano da solo lo mette solo da cinque.
      return new Intl.NumberFormat(locale, ALWAYS_GROUPED).format(value.value);
    case "date": {
      const date = new Date(value.value);
      const sameYear = date.getUTCFullYear() === now.getUTCFullYear();
      return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" }).format(date);
    }
    case "error":
      return t("base.footer.error");
    default:
      return cellText(value);
  }
}

/// Il nome di un riepilogo nel piede: il suo `name` se il file lo scrive,
/// altrimenti l'aggregato («Somma», «Piene»).
export function summaryName(summary: BaseSummaryDef): string {
  return summary.name ?? t(`base.summary.${summary.aggregate}`);
}

function part(summary: BaseSummaryDef, input: BaseFooterInput, withColumn: boolean): HTMLElement {
  const each = document.createElement("span");
  each.className = "base-foot-summary";
  each.dataset.summary = summary.label;
  const name = document.createElement("span");
  name.className = "base-foot-name";
  name.textContent = withColumn ? `${input.labelOf(summary.key)} · ${summaryName(summary)}` : summaryName(summary);
  const value = input.values[summary.label];
  const amount = document.createElement("span");
  amount.className = "base-foot-value";
  amount.textContent = summaryText(value, input.locale);
  if (value?.kind === "error") {
    amount.classList.add("base-foot-error");
    amount.title = value.value;
  }
  each.append(name, amount);
  if (input.searching) {
    // Il riepilogo non segue la ricerca: si vede più tenue e lo dice.
    const all = plural(input.total, "base.footer.on_all_one", "base.footer.on_all", { total: new Intl.NumberFormat(input.locale).format(input.total) });
    each.classList.add("base-foot-dimmed");
    if (!amount.title) amount.title = all;
    const note = document.createElement("span");
    note.className = "sr-only";
    note.textContent = ` (${all})`;
    each.append(note);
  }
  return each;
}

/// Il conteggio delle note della vista; con la ricerca, quante di quante
/// («3 di 50 note»).
export function countText(count: number, locale: string, total?: number): string {
  const format = new Intl.NumberFormat(locale);
  if (total !== undefined) return plural(total, "base.footer.count_of_one", "base.footer.count_of", { count: format.format(count), total: format.format(total) });
  return plural(count, "base.footer.count_one", "base.footer.count", { count: format.format(count) });
}

function footerCount(input: BaseFooterInput): string {
  return countText(input.count, input.locale, input.searching ? input.total : undefined);
}

/// I riepiloghi divisi per colonna: quelli di una colonna mostrata (senza
/// formula) stanno sotto di lei; gli altri in coda, col nome della colonna.
export function placeSummaries(columns: readonly string[], summaries: readonly BaseSummaryDef[]): { byColumn: Map<string, BaseSummaryDef[]>; loose: BaseSummaryDef[] } {
  const byColumn = new Map<string, BaseSummaryDef[]>();
  const loose: BaseSummaryDef[] = [];
  for (const summary of summaries) {
    const column = summary.expression === null ? columns.find((each) => sameKey(each, summary.key)) : undefined;
    if (column === undefined) { loose.push(summary); continue; }
    const list = byColumn.get(column) ?? [];
    list.push(summary);
    byColumn.set(column, list);
  }
  return { byColumn, loose };
}

/// Il piede della tabella: una riga, con il conteggio sotto la colonna della
/// nota e ogni riepilogo sotto la sua colonna. Quelli senza colonna mostrata
/// stanno accanto al conteggio.
export function tableFooter(input: BaseFooterInput): HTMLTableSectionElement {
  const foot = document.createElement("tfoot");
  foot.className = "base-foot";
  const row = foot.insertRow();
  const { byColumn, loose } = placeSummaries(input.columns, input.summaries);
  const first = row.insertCell();
  const count = document.createElement("span");
  count.className = "base-foot-count";
  count.textContent = footerCount(input);
  first.append(count, ...loose.map((summary) => part(summary, input, true)));
  for (const column of input.columns) {
    const cell = row.insertCell();
    cell.dataset.column = column;
    cell.append(...(byColumn.get(column) ?? []).map((summary) => part(summary, input, false)));
  }
  return foot;
}

/// Il piede delle altre viste (schede, elenco, bacheca, mappa): il conteggio
/// e i riepiloghi in fila, ognuno col nome della sua colonna.
export function listFooter(input: BaseFooterInput): HTMLElement {
  const foot = document.createElement("div");
  foot.className = "base-summaries";
  const count = document.createElement("span");
  count.className = "base-foot-count";
  count.textContent = footerCount(input);
  foot.append(count, ...input.summaries.map((summary) => part(summary, input, true)));
  return foot;
}
