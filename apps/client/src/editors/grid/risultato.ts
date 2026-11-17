// La finestra del risultato di un comando che legge.
//
// Un comando del catalogo con effetto `legge` (le statistiche della
// selezione, il controllo degli errori, l'elenco delle funzioni) rende un
// risultato e non cambia niente. Se non ha una finestra scritta a mano
// (`dialogs/`), la barra, il menu «Comandi» e la tavolozza lo mostrano qui,
// tutti e tre dallo stesso punto (`GridPalette.give`).
//
// La finestra dice che sta leggendo, poi mostra il risultato come una
// tabella: le chiavi di un oggetto sono righe (quelle di un oggetto dentro un
// oggetto si leggono di seguito, unite da « · »), un elenco di oggetti è una
// tabella con le sue colonne, e dentro una cella un oggetto non si apre. È la
// forma che `ts_risultati.rs` legge dal motore per scrivere le chiavi da
// tradurre (`risultati.generated.json`): le chiavi, le colonne e le parole
// fisse arrivano in italiano, i valori restano quelli della cartella. I
// numeri stanno a destra; un riferimento a una cella è un pulsante che la
// seleziona e chiude la finestra. «Copia» mette il risultato negli appunti
// come testo con le tabulazioni. Se il motore non risponde, la finestra lo
// dice e offre «Riprova».
//
// Una finestra sola alla volta: lo stesso comando chiesto di nuovo mentre
// la sua finestra è aperta non ne apre un'altra. Una risposta che arriva dopo
// «Riprova» o dopo la chiusura non scrive niente (il biglietto `ticket`).
import risultati from "./risultati.generated.json";
import { openDialog } from "../../kit/dialog";
import { resolvedLanguage } from "../../i18n/strings";
import { writeClipboardText } from "../../platform/clipboard";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { readResult } from "./dialogs/result";
import { t as dialogT } from "./dialogs/strings";
import type { GridRun } from "./engine";
import { motivo } from "./motivi";
import { fogliStrings, hasFogliKey, t, type FogliKey } from "./palette/strings";

/// Ciò che la finestra chiede al motore della griglia.
export interface ResultEngine {
  run(id: string, params?: string): Promise<GridRun>;
  command(id: string, params?: string): boolean;
  sheetNames(): readonly string[];
  selectionRefs(): { readonly sheet: string; readonly range: string; readonly active: string };
  focus(): void;
}

/// La forma del risultato di un comando, da `risultati.generated.json`.
interface Shape {
  readonly chiavi: Readonly<Record<string, string>>;
  readonly colonne: Readonly<Record<string, string>>;
  readonly parole: Readonly<Record<string, string>>;
}

const GENERATED = risultati as { readonly elenchi: readonly string[]; readonly comandi: Readonly<Record<string, Shape>> };
const LISTS: ReadonlySet<string> = new Set(GENERATED.elenchi);
const NO_SHAPE: Shape = { chiavi: {}, colonne: {}, parole: {} };

/// Le chiavi il cui valore può essere un riferimento a una cella o a un
/// intervallo.
const REF_KEYS: ReadonlySet<string> = new Set(["activeCell", "anchor", "at", "cell", "endOfSheet", "range", "selection", "spilledFrom", "usedRange"]);
const A1 = String.raw`\$?[A-Z]{1,3}\$?[1-9]\d*(?::\$?[A-Z]{1,3}\$?[1-9]\d*)?`;
const REF = new RegExp(String.raw`^(?:(?:'((?:[^']|'')+)'|([^'!]+))!)?(${A1})$`);

/// Un riferimento che porta alla cella: il foglio, se lo dice il risultato.
export interface ResultRef {
  readonly sheet: string | null;
  readonly range: string;
  /// Come lo scrive il risultato, per il nome del pulsante.
  readonly text: string;
}

export interface ResultCell {
  readonly text: string;
  readonly number: boolean;
  readonly ref: ResultRef | null;
}

export type ResultSection =
  | { readonly kind: "rows"; readonly rows: readonly { readonly label: string; readonly cell: ResultCell }[] }
  | {
      readonly kind: "table";
      readonly caption: string | null;
      readonly columns: readonly { readonly label: string; readonly number: boolean }[] | null;
      readonly rows: readonly (readonly ResultCell[])[];
    };

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

const isObject = (value: unknown): value is Readonly<Record<string, Json>> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/// Un elenco che diventa una tabella: di oggetti, o di elenchi.
const isTable = (value: unknown): value is readonly Json[] => Array.isArray(value) && value.some((item) => item !== null && typeof item === "object");

function label(key: string, own: Readonly<Record<string, string>>, prefix: string): string {
  const named = own[key] ?? `${prefix}${key}`;
  return hasFogliKey(named) ? t(named) : key;
}

/// Una parola fissa del motore nella lingua della shell, soltanto sotto le
/// chiavi che il motore riempie con un elenco chiuso.
function word(key: string, text: string, shape: Shape): string {
  if (!LISTS.has(key)) return text;
  const named = shape.parole[text];
  return named && hasFogliKey(named) ? t(named) : text;
}

let numbers: { readonly language: string; readonly format: Intl.NumberFormat } | null = null;

function formatNumber(value: number): string {
  const language = resolvedLanguage();
  if (numbers?.language !== language) {
    numbers = { language, format: new Intl.NumberFormat(language, { maximumFractionDigits: 10 }) };
  }
  return numbers.format.format(value);
}

function refOf(key: string, text: string, sheet: string | null): ResultRef | null {
  if (!REF_KEYS.has(key)) return null;
  const found = REF.exec(text.trim());
  if (!found) return null;
  const named = found[1]?.replace(/''/g, "'") ?? found[2] ?? null;
  return { sheet: named ?? sheet, range: found[3]!.replace(/\$/g, ""), text };
}

function plain(value: Json, key: string, shape: Shape): string {
  if (value === null) return t("fogli.result.missing");
  if (typeof value === "boolean") return t(value ? "fogli.result.yes" : "fogli.result.no");
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "string") return word(key, value, shape);
  if (Array.isArray(value) && !isTable(value)) return (value as readonly Json[]).map((item) => plain(item, key, shape)).join(", ");
  return JSON.stringify(value);
}

function cellOf(key: string, value: Json | undefined, sheet: string | null, shape: Shape): ResultCell {
  if (value === undefined) return { text: "", number: false, ref: null };
  const text = plain(value, key, shape);
  return {
    text,
    number: typeof value === "number",
    ref: typeof value === "string" ? refOf(key, value, sheet) : null,
  };
}

const stringOf = (value: Json | undefined): string | null => (typeof value === "string" && value !== "" ? value : null);

/// Il risultato `value` del comando `motore` come righe e tabelle, nella
/// forma di `ts_risultati.rs`.
export function resultSections(motore: string, value: unknown): ResultSection[] {
  const shape = GENERATED.comandi[motore] ?? NO_SHAPE;
  const keyLabel = (key: string) => label(key, shape.chiavi, "fogli.result.key.");
  const colLabel = (key: string) => label(key, shape.colonne, "fogli.result.col.");
  const rows: { label: string; cell: ResultCell }[] = [];
  const tables: ResultSection[] = [];

  function table(list: readonly Json[], caption: string | null, owner: string, sheet: string | null): void {
    const columns: string[] = [];
    for (const item of list) {
      if (isObject(item)) for (const key of Object.keys(item)) if (!columns.includes(key)) columns.push(key);
    }
    const sheetOf = (item: Readonly<Record<string, Json>>): string | null =>
      stringOf(item.sheet) ?? (owner === "sheets" ? stringOf(item.name) : null) ?? sheet;
    const body = list.map((item): ResultCell[] => {
      if (isObject(item)) return columns.map((key) => cellOf(key, item[key], sheetOf(item), shape));
      if (Array.isArray(item)) return item.map((one) => cellOf("", one, sheet, shape));
      return [cellOf(owner, item, sheet, shape)];
    });
    const heads =
      columns.length === 0
        ? null
        : columns.map((key, at) => {
            const filled = body.map((cells) => cells[at]).filter((cell) => cell !== undefined && cell.text !== "" && cell.text !== t("fogli.result.missing"));
            return { label: colLabel(key), number: filled.length > 0 && filled.every((cell) => cell!.number) };
          });
    tables.push({ kind: "table", caption, columns: heads, rows: body });
  }

  function walk(object: Readonly<Record<string, Json>>, path: readonly string[], sheet: string | null): void {
    const here = stringOf(object.sheet) ?? stringOf(object.activeSheet) ?? sheet;
    for (const [key, item] of Object.entries(object)) {
      const named = [...path, key];
      if (isObject(item)) {
        walk(item, named, here);
      } else if (isTable(item)) {
        if (item.length > 0) table(item, named.map(keyLabel).join(" · "), key, here);
      } else if (!(Array.isArray(item) && item.length === 0)) {
        rows.push({ label: named.map(keyLabel).join(" · "), cell: cellOf(key, item, here, shape) });
      }
    }
  }

  const top = isObject(value) && Object.keys(value).length === 1 && "value" in value ? value.value : (value as Json);
  if (isObject(top)) walk(top, [], null);
  else if (Array.isArray(top)) {
    if (top.length > 0) table(top, null, "value", null);
  } else if (top !== null && top !== undefined) rows.push({ label: keyLabel("value"), cell: cellOf("value", top, null, shape) });
  return rows.length > 0 ? [{ kind: "rows", rows }, ...tables] : tables;
}

/// Il risultato come testo con le tabulazioni: una riga per riga, una
/// tabella dopo l'altra separate da una riga vuota.
export function resultTsv(sections: readonly ResultSection[]): string {
  const clean = (text: string) => text.replace(/[\t\r\n]+/g, " ");
  return sections
    .map((section) => {
      if (section.kind === "rows") return section.rows.map((row) => `${clean(row.label)}\t${clean(row.cell.text)}`).join("\n");
      const lines = section.rows.map((cells) => cells.map((cell) => clean(cell.text)).join("\t"));
      return section.columns ? [section.columns.map((column) => clean(column.label)).join("\t"), ...lines].join("\n") : lines.join("\n");
    })
    .join("\n\n");
}

/// La nota sopra il risultato: quella del comando, o quante righe ha la
/// sua tabella.
function noteFor(motore: string, value: unknown, sections: readonly ResultSection[], refs: ResultEngine["selectionRefs"] extends () => infer R ? R : never): string {
  if (motore === "selection.stats" && isObject(value) && typeof value.count === "number") {
    const range = refs.sheet ? `${refs.sheet}!${refs.range}` : refs.range;
    return t("fogli.result.stats.note", { range, count: value.count });
  }
  if (motore === "formulas.errorChecking" && isObject(value)) {
    const errors = Array.isArray(value.errors) ? value.errors.length : 0;
    const circular = Array.isArray(value.circular) ? value.circular.length : 0;
    const loop = circular === 0 ? t("fogli.result.circular.none") : t("fogli.result.circular.some", { count: circular });
    return `${t("fogli.result.errors.note", { count: errors })} ${loop}`;
  }
  const only = sections.length === 1 ? sections[0] : undefined;
  if (only?.kind === "table") return fogliStrings.plural(only.rows.length, "fogli.result.rows.one", "fogli.result.rows.many");
  return "";
}

export interface ResultRequest {
  readonly motore: string;
  readonly title: string;
  readonly params: string;
  readonly engine: ResultEngine;
  /// Chiuderla chiude la finestra: la barra o la tavolozza che l'ha aperta.
  readonly lifetime: Lifetime;
  /// Il risultato già arrivato (dalla finestra dei parametri): niente attesa.
  readonly first?: GridRun;
}

export interface ResultWindow {
  readonly element: HTMLElement;
  readonly closed: Promise<void>;
  close(): void;
}

let current: { readonly motore: string; readonly window: ResultWindow } | null = null;

/// La finestra del risultato aperta, per le prove.
export function openResultWindow(): HTMLElement | null {
  return current?.window.element ?? null;
}

type Action = "copy" | "retry" | "close";

/// Apre la finestra del risultato di `request.motore`, o rende quella già
/// aperta per lo stesso comando.
export function openResult(request: ResultRequest): ResultWindow {
  if (current?.motore === request.motore) return current.window;
  current?.window.close();
  const { engine, motore, params } = request;
  const refs = engine.selectionRefs();
  const life = openLifetime();
  request.lifetime.add(() => life.close());

  const body = document.createElement("div");
  body.className = "grid-dialog grid-result";
  const note = document.createElement("p");
  note.className = "grid-dialog-note";
  note.setAttribute("role", "status");
  const area = document.createElement("div");
  area.className = "grid-result-area";
  body.append(note, area);

  const handle = openDialog<Action>({
    title: request.title,
    body,
    className: "grid-dialog-wide grid-result-dialog",
    actions: [
      { id: "copy", label: t("fogli.result.copy"), value: "copy" },
      { id: "retry", label: t("fogli.result.retry"), value: "retry" },
      { id: "close", label: dialogT("grid.dialog.close"), kind: "primary", value: "close", autofocus: true },
    ],
    dismissValue: "close",
    lifetime: life,
    confirm: (action) => {
      if (action === "copy") copy();
      else if (action === "retry") load();
      return action === "close";
    },
  });
  const element = handle.element;
  const button = (id: Action) => element.querySelector<HTMLButtonElement>(`[data-action="${id}"]`)!;
  const closeButton = button("close");

  let ticket = 0;
  let tsv = "";

  const say = (text: string): void => {
    note.textContent = text;
    note.hidden = text === "";
  };
  const show = (actions: { copy: boolean; retry: boolean }): void => {
    const focused = document.activeElement;
    button("copy").hidden = !actions.copy;
    button("retry").hidden = !actions.retry;
    if (focused instanceof HTMLElement && focused.hidden) closeButton.focus();
  };

  function loading(): void {
    body.setAttribute("aria-busy", "true");
    say(t("fogli.result.loading"));
    const skeleton = document.createElement("div");
    skeleton.className = "skeleton-rows";
    skeleton.setAttribute("aria-hidden", "true");
    for (let at = 0; at < 6; at++) {
      const line = document.createElement("span");
      line.className = "skeleton-line";
      skeleton.append(line);
    }
    area.replaceChildren(skeleton);
    show({ copy: false, retry: false });
  }

  function failed(run: Extract<GridRun, { ok: false }>): void {
    body.removeAttribute("aria-busy");
    say("");
    const error = document.createElement("p");
    error.className = "grid-dialog-error";
    error.setAttribute("role", "alert");
    const reason = motivo(run.error);
    error.textContent = reason ? t("fogli.result.refused", { reason }) : t("fogli.result.failed");
    area.replaceChildren(error);
    show({ copy: false, retry: true });
    if (document.activeElement === document.body || document.activeElement === null) button("retry").focus();
  }

  function go(ref: ResultRef): void {
    if (ref.sheet !== null && !engine.sheetNames().includes(ref.sheet)) {
      say(t("fogli.result.sheet_missing", { sheet: ref.sheet, ref: ref.text }));
      return;
    }
    handle.close("close");
    engine.command("selection.set", JSON.stringify(ref.sheet === null ? { range: ref.range } : { sheet: ref.sheet, range: ref.range }));
    engine.focus();
  }

  function cellElement(tag: "td" | "th", cell: ResultCell): HTMLElement {
    const el = document.createElement(tag);
    if (cell.number) el.className = "grid-result-number";
    if (cell.ref) {
      const ref = cell.ref;
      const link = document.createElement("button");
      link.type = "button";
      link.className = "grid-result-ref";
      link.textContent = cell.text;
      const where = ref.sheet === null ? ref.text : ref.text.includes("!") ? ref.text : `${ref.sheet}!${ref.text}`;
      link.setAttribute("aria-label", t("fogli.result.go", { ref: where }));
      life.listen(link, "click", () => go(ref));
      el.append(link);
    } else {
      el.textContent = cell.text;
    }
    return el;
  }

  function tableElement(section: ResultSection): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "grid-dialog-results";
    const table = document.createElement("table");
    table.className = "grid-result-table";
    const caption = document.createElement("caption");
    caption.className = "sr-only";
    caption.textContent = section.kind === "table" && section.caption ? `${request.title} · ${section.caption}` : request.title;
    table.append(caption);
    const tbody = document.createElement("tbody");
    if (section.kind === "rows") {
      for (const row of section.rows) {
        const tr = document.createElement("tr");
        const th = document.createElement("th");
        th.className = "grid-result-key";
        th.scope = "row";
        th.textContent = row.label;
        tr.append(th, cellElement("td", row.cell));
        tbody.append(tr);
      }
    } else {
      if (section.columns) {
        const thead = document.createElement("thead");
        const tr = document.createElement("tr");
        for (const column of section.columns) {
          const th = document.createElement("th");
          th.scope = "col";
          if (column.number) th.className = "grid-result-number";
          th.textContent = column.label;
          tr.append(th);
        }
        thead.append(tr);
        table.append(thead);
      }
      for (const cells of section.rows) {
        const tr = document.createElement("tr");
        for (const cell of cells) tr.append(cellElement("td", cell));
        tbody.append(tr);
      }
    }
    table.append(tbody);
    wrap.append(table);
    return wrap;
  }

  function shown(run: Extract<GridRun, { ok: true }>): void {
    body.removeAttribute("aria-busy");
    const value = readResult(run.result);
    const sections = resultSections(motore, value).filter((section) => section.rows.length > 0);
    if (sections.length === 0) {
      tsv = "";
      say(t("fogli.result.empty"));
      area.replaceChildren();
      show({ copy: false, retry: false });
      return;
    }
    tsv = resultTsv(sections);
    say(noteFor(motore, value, sections, refs));
    area.replaceChildren(...sections.map(tableElement));
    show({ copy: true, retry: false });
  }

  function settle(run: GridRun): void {
    if (run.ok) shown(run);
    else failed(run);
  }

  function load(): void {
    const mine = ++ticket;
    loading();
    void engine.run(motore, params).then(
      (run) => {
        if (mine === ticket && !life.closed) settle(run);
      },
      () => {
        if (mine === ticket && !life.closed) settle({ ok: false, error: null });
      },
    );
  }

  function copy(): void {
    if (tsv === "") return;
    const mine = ticket;
    void writeClipboardText(tsv).then(
      () => {
        if (mine === ticket && !life.closed) say(t("fogli.result.copied"));
      },
      () => {
        if (mine === ticket && !life.closed) say(t("fogli.result.copy_failed"));
      },
    );
  }

  if (request.first) settle(request.first);
  else load();

  const closed = handle.result.then(() => {
    ticket += 1;
    life.close();
    if (current?.window === window) current = null;
  });
  const window: ResultWindow = { element, closed, close: () => handle.close("close") };
  current = { motore, window };
  return window;
}

/// Le chiavi di testo che la finestra usa da sé, per il presidio.
export const RESULT_KEYS: readonly FogliKey[] = [
  "fogli.result.copy",
  "fogli.result.copied",
  "fogli.result.copy_failed",
  "fogli.result.retry",
  "fogli.result.loading",
  "fogli.result.failed",
  "fogli.result.refused",
  "fogli.result.empty",
  "fogli.result.go",
  "fogli.result.sheet_missing",
];
