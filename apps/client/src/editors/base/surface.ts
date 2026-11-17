// Named `.base` views on indexed notes. The surface owns only its local view
// choice and rendering; edits go through registered commands with CAS.
import { currentTheme, type Theme } from "../../theme/theme";
import { COMMANDS, EVERY_DOCUMENT } from "../../host/contract";
import { api } from "../../host/ipc";
import { settings } from "../../host/query";
import type { CustomRenderContext } from "../../ui/custom";
import { errorText, isErrorKind } from "../../host/errors";
import { onLanguage, resolvedLanguage, t } from "../../i18n/strings";
import { iconEl } from "../../ui/icons";
import type { DocumentUpdate } from "../core/text-operation";
import { onEvent } from "../../state/kernel";
import { vaultArg } from "../../state/vault";
import type { BufferedSurface, SurfaceCellSelectionSource, SurfaceMountContext } from "../core/registry";
import type { Cell, Range } from "../../tabella/navigation";
import { rangeBetween, selectedCells, selectsSeveral, touches } from "../../tabella/selection";
import type { SurfaceMenu, SurfaceMenuItem } from "../core/editor-menu";
import { uniformRowRange } from "../core/row-window";
import { LOCAL_FETCH } from "../core/local-fetch";
import {
  BASE_FORMAT, BASE_MAP_ATTRIBUTION_FALLBACK, BASE_RENDERER_NS, NEW_VIEW_KINDS,
  addBaseView, allowedBaseTileUrl, baseRowsToCsv, baseSurfaceModes, cellText, choiceLanes, deriveBaseRows, expectedProperty, groupBaseRows,
  fetchAllDocuments, linkedNotes, listBaseViews, parseBaseEmbed, persistBaseView,
  planBaseView, prepareBaseMutations, removeBaseView, restoreBaseView, setBaseViewKey, writtenLines,
  type BaseCellValue, type BaseDocumentWrites, type BaseExpected, type BaseGroupOrder, type BasePlan, type BaseRow, type BaseRowInput, type BaseSurfaceDeps, type BaseViewKey, type BaseViewKind, type BaseViewWrite,
} from "./data";
import { decimalOf, filterValue, isOpaque, propertyKind, propertyValues, type ValueKind } from "./filter";
import { mountBaseToolbar } from "./toolbar";
import { NOTE_COLUMN, columnKind, columnMenu, columnMenuItems, columnProperty, columnSurfaceItems, relationColumn, renamedInView, valueShape, type ColumnEntry } from "./column-menu";
import { listFooter, shownText, tableFooter } from "./footer";
import { columnIcon, viewIcon } from "./icons";
import { calendarState, firstWeekday, localDay, movedDateValue, renderCalendar, type CalendarState, type IsoDay } from "./calendar";
import { renderTimeline, timelineState, type TimelineRow, type TimelineState } from "./timeline";
import { sameKey, sortedBy } from "./sort";
import { freeColor, NO_TYPES, optionsOf, parsePropertyTypes, sameTypes, type PropertyOption, type PropertyTypes } from "../text/profiles/markdown/page/properties/kind";
import { closeContextMenu, showContextMenu, type MenuItem } from "../../ui/menu";
import { notify } from "../../ui/notify";
import { keyboardPlatform } from "../../ui/commands";
import { TEXT_INPUT_TYPES, fieldHistoryStep, isPlainTextField } from "../../ui/field-history";
import { writeClipboardText } from "../../platform/clipboard";

export interface BaseMountDeps extends BaseSurfaceDeps {
  readonly onOpenDocument: (doc: string) => void | Promise<void>;
  /** Trusted host-supplied exact-host allowlist; .base YAML cannot grant it. */
  readonly mapTileHosts?: readonly string[];
  /// La revisione del file `.base` che la superficie mostra: i gesti della
  /// barra la passano a `base.view.set`, che scrive solo se il file è ancora
  /// quello. Assente, il comando scrive senza confronto.
  readonly revision?: () => string | null;
  /// Le scritture dei documenti aperti: prima di un gesto si salva il
  /// `.base` se ha testo in sospeso, e la scrittura del gesto si annuncia
  /// perché la ricarica non si dica. Assente (una prova), il gesto scrive e
  /// basta.
  readonly documentWrites?: BaseDocumentWrites;
  /// Il registro dei tipi delle proprietà del vault (`properties.types`), il
  /// valore com'è nelle impostazioni: la Bacheca su una Selezione o uno Stato
  /// ne prende le corsie. Assente (una prova), le corsie sono i valori.
  readonly propertyTypes?: () => Promise<unknown>;
}
/// La cartella dei modelli, per «Nuova da un modello»: la convenzione di
/// `note.from_template` (`fub-features/src/template.rs`).
const TEMPLATES_FOLDER = "Templates";
const TEMPLATE_COMMAND = "note.from_template";
/// Quanti modelli offre il menu di «Nuova».
const TEMPLATE_LIMIT = 100;
/// Quanto aspetta la barra il file riscritto dopo un gesto, prima di
/// riaccendersi comunque: un host che non rimanda il testo non la lascia spenta.
const WRITE_SETTLE_MS = 4000;
/// Quante proprietà e quanti valori la barra raccoglie dalle righe.
const PROPERTY_LIMIT = 200;
/// Quanto aspetta, dopo la risposta di «Annulla», l'evento della riscrittura
/// del `.base` prima di ritirarne l'annuncio. L'esito di `vault.undo` non dice
/// quale file ha riscritto: se non era questo (niente da annullare, o
/// l'ultima operazione era su un altro file) l'annuncio non resta a zittire
/// per dieci secondi un cambio vero. L'evento parte mentre il comando scrive,
/// prima della risposta; uno in ritardo oltre l'attesa si dice soltanto.
const UNDO_EVENT_GRACE_MS = 1500;
const SUGGESTION_LIMIT = 50;
/// Un gesto della barra in volo: il testo di prima, quello che l'host ha
/// rimandato (prima o dopo la risposta), e se il comando ha risposto e il
/// piano del testo nuovo è letto.
interface WriteAttempt {
  readonly before: string;
  after: string | null;
  answered: boolean;
  planned: boolean;
  /// Dice a chi ha chiesto il gesto come è finito, quando la barra si
  /// riaccende: `true` se il file è stato scritto.
  readonly finish: (written: boolean) => void;
}
/// I comandi del vault che il menu della colonna usa (`fub-features`).
const PROPERTY_RENAME = "property.key.rename";
const PROPERTY_TYPE_SET = "property.type.set";
/// Il comando che aggiunge un'opzione di Selezione o di Stato al registro.
const PROPERTY_OPTION_SET = "property.option.set";
/// L'impostazione del registro dei tipi delle proprietà.
const PROPERTY_TYPES_KEY = "properties.types";
/// I nomi delle proprietà da cui una vista mappa nuova prende le coordinate,
/// se le righe le hanno.
const LATITUDE_KEYS = ["lat", "latitude", "latitudine"];
const LONGITUDE_KEYS = ["lon", "lng", "long", "longitude", "longitudine"];
const SVG = "http://www.w3.org/2000/svg";
const VISIBLE_STEP = 100;
const TABLE_ROW_HEIGHT = 38;
const TABLE_VIEWPORT_HEIGHT = 560;
/// Un campo vuoto o corto della tabella resta largo almeno così (lettere).
const CELL_MIN_CHARS = 6;
/// Il bordo e il margine interno di un campo della tabella, ai due lati.
const CELL_INSET_PX = 14;
/// Una cella della tabella al di là di un ridisegno: la nota della riga e la
/// chiave della colonna (`FILE_COLUMN` per la colonna della nota, che non è
/// una proprietà e non si confonde con nessuna).
interface CellKey { readonly doc: string; readonly column: string }
const FILE_COLUMN = NOTE_COLUMN;
/// La colonna `file.name` del file: nella tabella è la colonna della nota
/// (il titolo), non una seconda colonna col nome.
const NOTE_NAME = "file.name";
/// Il titolo di una nota in tabella: il nome del file senza cartella e
/// senza `.md`. Il percorso intero sta nel suggerimento.
/// Il registro dei tipi delle proprietà com'è nelle impostazioni del vault
/// aperto: la dipendenza `propertyTypes` della Base nell'app.
export async function vaultPropertyTypes(): Promise<unknown> {
  return (await settings()).find((entry) => entry.spec.key === PROPERTY_TYPES_KEY)?.value;
}

export function noteTitle(doc: string): string {
  return doc.slice(doc.lastIndexOf("/") + 1).replace(/\.md$/i, "");
}
const labels = () => ({
  view: t("menu.view"), search: t("rail.search"), retry: t("app.retry"),
  loading: t("search.loading"), more: t("search.more", { shown: VISIBLE_STEP, total: VISIBLE_STEP }),
});
/// I valori di ogni proprietà nelle righe lette, per nome: al più
/// `PROPERTY_LIMIT` nomi.
function readProperties(input: readonly BaseRowInput[]): Map<string, unknown[]> {
  const values = new Map<string, unknown[]>();
  for (const row of input) {
    for (const { key, value } of row.properties ?? []) {
      let list = values.get(key);
      if (list === undefined) {
        if (values.size >= PROPERTY_LIMIT) continue;
        list = [];
        values.set(key, list);
      }
      list.push(value);
    }
  }
  return values;
}

function button(text: string, action: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = text;
  element.addEventListener("click", action);
  return element;
}
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

export function mountBaseSurface(
  profile: string, context: SurfaceMountContext, deps: BaseMountDeps,
  options: {
    view?: string | null; persistSelection?: boolean; container?: string | null;
    /// La Base è scritta dentro una nota (un blocco ```base```): i comandi
    /// della vista riscrivono solo i file `.base`, quindi la barra la mostra
    /// ma non la cambia.
    sourceInNote?: boolean;
  } = {},
): BufferedSurface {
  if (profile !== "base") throw new Error(`base surface profile ${profile} is not registered`);
  const root = document.createElement("div");
  root.className = "base-surface";
  root.dataset.format = BASE_FORMAT;
  root.dataset.theme = currentTheme();
  // «Raggruppa»: una scelta della superficie, ricordata per vista come le
  // corsie della bacheca; il file `.base` non si riscrive. Sta in «Ordina».
  const groupControls = document.createElement("div");
  groupControls.className = "base-grouping";
  const groupBy = document.createElement("select");
  groupBy.className = "base-group-by";
  const groupOrder = document.createElement("select");
  groupOrder.className = "base-group-order";
  groupControls.append(groupBy, groupOrder);
  const toolbar = mountBaseToolbar({
    chooseView: (name) => chooseView(name),
    write: (key, value) => void writeView(key, value),
    search: () => { displayed = VISIBLE_STEP; forgetPick(); draw(); },
    create: () => void createNote(),
    templates: () => listTemplates(),
    createFrom: (template) => void createFromTemplate(template),
    more: () => [
      { label: t("base.csv.copy"), run: () => void copyResults() },
      { label: t("base.csv.export"), run: exportResults },
    ],
    grouping: groupControls,
    openFile: (doc) => open(doc),
    newViews: () => newViewItems(),
  });
  const { search, status } = toolbar;
  const body = document.createElement("div");
  body.className = "base-body";
  root.append(toolbar.bar, toolbar.searchRow, toolbar.strip, body, toolbar.written);
  context.parent.replaceChildren(root);

  let destroyed = false;
  let readOnly = false;
  /// Il registro dei tipi del vault, per le corsie di Selezione e Stato.
  let propertyTypes: PropertyTypes = NO_TYPES;
  let source = "";
  let names: string[] = [];
  let viewTypes: (string | null)[] = [];
  // Una scrittura della barra in corso: la barra resta spenta finché il file
  // riscritto non torna e il suo piano non è letto (`settle`).
  let busy = false;
  let creating = false;
  let writing: WriteAttempt | null = null;
  let settleTimer = 0;
  // Gli annunci di «Annulla» che aspettano il loro evento (`UNDO_EVENT_GRACE_MS`).
  const undoGraces = new Map<number, () => void>();
  // L'esito dell'ultimo gesto che non ha scritto: resta nella riga di stato
  // finché un gesto nuovo non lo sostituisce.
  let notice: string | null = null;
  let activeView: string | null = options.view ?? null;
  let plan: BasePlan | null = null;
  let rows: BaseRow[] = [];
  // Le proprietà lette per l'ultima ricarica, prima del filtro: le scelte e la
  // specie di ogni proprietà non dipendono dal filtro di adesso, così un
  // filtro che non trova niente si corregge con le stesse scelte.
  let read: Map<string, unknown[]> = new Map();
  // La specie di ogni proprietà, ricavata una volta per ricarica.
  let kindCache = new Map<string, ValueKind>();
  let summaries: Record<string, BaseCellValue> = {};
  let displayed = VISIBLE_STEP;
  let error: string | null = null;
  let generation = 0;
  // Il piano va riletto (il testo è cambiato) e nessuna ricarica l'ha ancora
  // finito: vale anche per la ricarica che supera quella che l'aveva chiesto.
  let replanWanted = false;
  let pending: AbortController | null = null;
  let tileCleanup: (() => void) | null = null;
  let writeEpoch = 0;
  let persistQueue = Promise.resolve();
  const localLanes = new Map<string, Set<string>>();
  // I gruppi chiusi di tabella, schede ed elenco, per vista: stato della
  // superficie, come lo scroll, che il file `.base` non conosce.
  const collapsedGroups = new Map<string, Set<string>>();
  // Le celle scelte nella tabella (E24), con le regole della Tabella
  // (`tabella/selection.ts`): righe di `tableItems`, colonne con la nota per
  // prima e poi `plan.columns`. Un clic sceglie una cella, Maiusc+clic o il
  // trascinamento allargano fino a un'altra, Maiusc con le frecce (dalla
  // cella, non dal campo aperto) riga per riga, Esc torna alla cella. La banda
  // somma i valori mostrati: nessuna IPC per una selezione.
  //
  // Una tabella ridisegnata (una ricarica per un'altra nota salvata, un
  // gruppo chiuso, la lingua) rimette la scelta se le sue due celle d'angolo
  // ci sono ancora: stessa nota, stessa colonna. Se ne va con Esc, con la
  // ricerca, cambiando vista, o quando una delle due non c'è più.
  let tableItems: readonly ({ group: string; count: number } | BaseRow)[] = [];
  // Dove era scorsa la tabella: un ridisegno (il file riscritto da un gesto,
  // una nota salvata) la rimette lì. Cambiare vista la riporta in cima.
  let tableScroll = { top: 0, left: 0 };
  // La vista è cambiata: il prossimo disegno non legge la tabella di prima,
  // che è ancora lì, e parte dall'alto.
  let scrollReset = false;
  let picked: { anchor: Cell; focus: Cell } | null = null;
  let pickedKeys: { anchor: CellKey; focus: CellKey } | null = null;
  let picking = false;
  let paintPicked: () => void = () => {};
  const cellListeners = new Set<() => void>();
  const cellsChanged = (): void => {
    for (const listener of [...cellListeners]) listener();
  };
  // Le colonne della tabella dopo quella della nota: quelle della vista,
  // tolto `file.name` che è la colonna della nota stessa.
  const gridColumns = (): string[] => (plan?.columns ?? []).filter((column) => column !== NOTE_NAME);
  const columnKey = (column: number): string | null => (column === 0 ? FILE_COLUMN : gridColumns()[column - 1] ?? null);
  const keyOf = (cell: Cell): CellKey | null => {
    const item = tableItems[cell.row];
    const column = columnKey(cell.column);
    return item && !("group" in item) && column !== null ? { doc: item.doc, column } : null;
  };
  const pick = (next: { anchor: Cell; focus: Cell } | null): void => {
    const same = next !== null && picked !== null
      && next.anchor.row === picked.anchor.row && next.anchor.column === picked.anchor.column
      && next.focus.row === picked.focus.row && next.focus.column === picked.focus.column;
    if (same || (next === null && picked === null)) return;
    picked = next;
    const anchor = next && keyOf(next.anchor);
    const focus = next && keyOf(next.focus);
    pickedKeys = anchor && focus ? { anchor, focus } : null;
    paintPicked();
    cellsChanged();
  };
  /// Le celle scelte se ne vanno anche dopo il prossimo ridisegno: la ricerca
  /// e il cambio di vista.
  const forgetPick = (): void => {
    pickedKeys = null;
  };
  /// La scelta di prima nelle righe di adesso, se le sue celle d'angolo ci
  /// sono ancora.
  const restorePick = (items: readonly ({ group: string; count: number } | BaseRow)[]): void => {
    const keys = pickedKeys;
    if (!keys) return;
    const find = (key: CellKey): Cell | null => {
      const row = items.findIndex((item) => !("group" in item) && item.doc === key.doc);
      const column = key.column === FILE_COLUMN ? 0 : gridColumns().indexOf(key.column) + 1;
      return row >= 0 && (column > 0 || key.column === FILE_COLUMN) ? { row, column } : null;
    };
    const anchor = find(keys.anchor);
    const focus = find(keys.focus);
    if (anchor && focus) picked = { anchor, focus };
    else pickedKeys = null;
  };
  const pickedRanges = (): Range[] => (picked ? [rangeBetween(picked.anchor, picked.focus)] : []);
  /// Il valore che una cella mostra: un numero come numero, il resto come
  /// testo. Un errore non è un valore da sommare.
  const shownValue = (row: BaseRow, column: number): string | number => {
    if (column === 0) return row.doc;
    const key = gridColumns()[column - 1];
    const value = key === undefined ? undefined : row.values[key];
    if (value?.kind === "number") return value.value;
    if (value?.kind === "error") return "";
    return cellText(value);
  };
  const cellSelection: SurfaceCellSelectionSource = {
    read: () => {
      const ranges = pickedRanges();
      if (plan?.viewType !== "table" || !selectsSeveral(ranges)) return null;
      const items = tableItems;
      return {
        locale: resolvedLanguage(),
        *values() {
          for (const { row, column } of selectedCells(ranges)) {
            const item = items[row];
            if (item && !("group" in item)) yield shownValue(item, column);
          }
        },
      };
    },
    subscribe: (listener) => {
      cellListeners.add(listener);
      return () => cellListeners.delete(listener);
    },
  };
  const groupToggle = (name: string, count: number): HTMLButtonElement => {
    const view = plan?.view ?? "";
    const closed = collapsedGroups.get(view)?.has(name) === true;
    const toggle = button(`${name || "∅"} (${count})`, () => {
      let names = collapsedGroups.get(view);
      if (!names) { names = new Set(); collapsedGroups.set(view, names); }
      if (!names.delete(name)) names.add(name);
      draw();
    });
    toggle.className = "base-group-toggle";
    toggle.setAttribute("aria-expanded", String(!closed));
    return toggle;
  };
  const groupOpen = (name: string) => collapsedGroups.get(plan?.view ?? "")?.has(name) !== true;
  // Assente: vale il `group:` del file; "" è «senza gruppi».
  const groupChoices = new Map<string, string>();
  // Toglie la scelta di questa finestra per la vista: vale il `group:` del
  // file.
  const forgetGroupChoice = (view: string): void => {
    if (!groupChoices.has(view)) return;
    groupChoices.delete(view);
    persistQueue = persistQueue.then(() => destroyed ? undefined : deps.setViewState(`base.group:${context.documentId}:${view}`, null)).catch(presentError);
  };
  const groupOrders = new Map<string, BaseGroupOrder>();
  const orderOf = (): BaseGroupOrder => groupOrders.get(plan?.view ?? "") ?? "rows";
  const regroupable = () => plan?.viewType === "table" || plan?.viewType === "cards" || plan?.viewType === "list";
  const grouping = (): string | null => {
    if (!plan || !regroupable()) return plan?.group ?? null;
    const choice = groupChoices.get(plan.view);
    if (choice === undefined) return plan.group;
    if (choice === "") return null;
    return plan.columns.includes(choice) || choice === plan.group ? choice : plan.group;
  };
  const fillGroupBy = (): void => {
    groupControls.hidden = !regroupable();
    groupBy.hidden = !regroupable();
    groupOrder.hidden = !regroupable() || grouping() === null;
    const order = orderOf();
    groupOrder.replaceChildren(...(["rows", "asc", "desc"] as const).map((value) => {
      const each = document.createElement("option");
      each.value = value;
      each.textContent = t(`base.group.order.${value}`);
      each.selected = value === order;
      return each;
    }));
    const current = grouping() ?? "";
    const keys = [...(plan?.columns ?? [])];
    if (plan?.group && !keys.includes(plan.group)) keys.push(plan.group);
    const option = (value: string, label: string) => {
      const each = document.createElement("option");
      each.value = value;
      each.textContent = label;
      each.selected = value === current;
      return each;
    };
    groupBy.replaceChildren(
      option("", t("base.group.none")),
      ...keys.map((key) => option(key, t("base.group.by_named", { name: plan?.columnLabels[key] ?? key }))),
    );
  };
  const downloads = new Map<string, number>();
  const saveLanes = (view: string) => {
    const laneNames = [...(localLanes.get(view) ?? [])];
    persistQueue = persistQueue.then(() => destroyed ? undefined : deps.setViewState(`base.kanban-lanes:${context.documentId}:${view}`, laneNames)).catch(presentError);
  };
  const container = options.container === undefined ? context.documentId || null : options.container;
  const valid = (ticket: number) => !destroyed && generation === ticket;
  const filteredRows = (): BaseRow[] => {
    const needle = search.value.trim().toLocaleLowerCase();
    return needle ? rows.filter((row) => row.doc.toLocaleLowerCase().includes(needle) || Object.values(row.values).some((value) => cellText(value).toLocaleLowerCase().includes(needle))) : rows;
  };
  const presentError = (reason: unknown): void => {
    error = errorText(reason);
    status.textContent = error;
    body.replaceChildren(button(labels().retry, () => void reload(true)));
  };
  // Chi può riscrivere il file `.base`, e se no perché.
  const lock = () => readOnly ? "read_only" as const : options.sourceInNote ? "embedded" as const : null;
  // Le proprietà che le righe hanno e i valori di ognuna: le scelte del filtro
  // e delle colonne. Le raccoglie la barra quando le serve.
  const rowProperties = (): string[] => [...read.keys()].slice(0, PROPERTY_LIMIT);
  // I valori di una proprietà nelle righe, nella forma in cui si scrivono nel
  // filtro (una data come 2026-03-18, un numero coi decimali della lingua lo
  // mostra la barra).
  const suggestions = (key: string): string[] => {
    const values = new Set<string>();
    for (const raw of read.get(key) ?? []) {
      for (const { value } of propertyValues(raw)) {
        values.add(String(value));
        if (values.size >= SUGGESTION_LIMIT) return [...values];
      }
    }
    return [...values].sort((a, b) => a.localeCompare(b));
  };
  const kinds = (key: string): ValueKind => {
    let kind = kindCache.get(key);
    if (kind === undefined) {
      kind = propertyKind(read.get(key) ?? []);
      kindCache.set(key, kind);
    }
    return kind;
  };
  // Il pulsante della riga «Nuova nota» della tabella disegnata, se c'è.
  let newRowButton: HTMLButtonElement | null = null;
  const pushModel = (): void => {
    if (newRowButton) newRowButton.disabled = readOnly || creating;
    toolbar.update({
      views: names.map((name, index) => ({ name, type: viewTypes[index] ?? null })),
      active: activeView,
      plan,
      lock: lock(),
      canCreate: !readOnly && !creating,
      busy: busy || sequencing > 0,
      properties: rowProperties(),
      suggestions,
      kinds,
      decimal: decimalOf(resolvedLanguage()),
      containerFile: options.sourceInNote ? container : null,
    });
  };
  const fillOptions = (): void => { pushModel(); };
  const reload = async (replan: boolean): Promise<void> => {
    const ticket = ++generation;
    pending?.abort();
    const request = new AbortController();
    pending = request;
    status.textContent = labels().loading;
    const definition = source;
    try {
      // Una ricarica che ne supera una col piano da rileggere (le righe
      // cambiate subito dopo il testo nuovo, come il `document_changed` del
      // file stesso) rilegge anche il piano: altrimenti la barra resterebbe
      // sul piano del testo di prima.
      if (replan) replanWanted = true;
      if (replanWanted || !plan) {
        const listed = await listBaseViews(deps, definition);
        const nextNames = listed.names;
        if (!valid(ticket)) return;
        if (options.persistSelection === false && options.view && !nextNames.includes(options.view)) {
          throw new Error(`base: vista inesistente ${options.view}`);
        }
        let chosen = activeView;
        if (!chosen || !nextNames.includes(chosen)) {
          const restored = options.persistSelection === false ? null : await restoreBaseView(deps, context.documentId);
          if (!valid(ticket)) return;
          chosen = restored && nextNames.includes(restored) ? restored : (nextNames[0] ?? null);
        }
        if (!chosen) throw new Error("base: nessuna vista definita");
        const nextPlan = await planBaseView(deps, definition, chosen);
        if (!valid(ticket)) return;
        names = nextNames;
        viewTypes = listed.types;
        activeView = chosen;
        plan = nextPlan;
        // Il piano del file riscritto è letto: la barra parte da lui.
        planRead(definition);
        const savedGroup = await deps.viewState<unknown>(`base.group:${context.documentId}:${nextPlan.view}`);
        if (!valid(ticket)) return;
        if (savedGroup === null) groupChoices.delete(nextPlan.view);
        else if (typeof savedGroup === "string" && savedGroup.length <= 256) groupChoices.set(nextPlan.view, savedGroup);
        else throw new Error("base: gruppo salvato malformato");
        const savedOrder = await deps.viewState<unknown>(`base.group-order:${context.documentId}:${nextPlan.view}`);
        if (!valid(ticket)) return;
        if (savedOrder === "asc" || savedOrder === "desc" || savedOrder === "rows") groupOrders.set(nextPlan.view, savedOrder);
        else groupOrders.delete(nextPlan.view);
        if (nextPlan.viewType === "kanban") {
          const saved = await deps.viewState<unknown>(`base.kanban-lanes:${context.documentId}:${nextPlan.view}`);
          if (!valid(ticket)) return;
          if (saved === null) localLanes.set(nextPlan.view, new Set());
          else if (Array.isArray(saved) && saved.length <= 128 && saved.every((lane) => typeof lane === "string" && lane.length <= 256)) localLanes.set(nextPlan.view, new Set(saved));
          else throw new Error("base: corsie salvate malformate");
        }
        fillOptions();
        fillGroupBy();
        replanWanted = false;
      }
      const nextPlan = plan;
      if (!nextPlan) throw new Error("base: piano assente");
      const found = await fetchAllDocuments(deps, EVERY_DOCUMENT, nextPlan.allProperties ? { kind: "all" } : { kind: "keys", keys: nextPlan.requiredProps }, { offset: 0, limit: 256 }, request.signal);
      if (!valid(ticket)) return;
      // Le note legate dai riepiloghi di Relazione (T35): nessuna domanda in
      // più se la vista non ne ha.
      const linked = await linkedNotes(deps, nextPlan, found.rows, request.signal);
      if (!valid(ticket)) return;
      const result = await deriveBaseRows(deps, definition, nextPlan.view, found.rows, Date.now(), container, linked);
      if (!valid(ticket)) return;
      rows = result.rows;
      read = readProperties(found.rows);
      kindCache = new Map();
      summaries = result.summaries;
      displayed = VISIBLE_STEP;
      error = null;
      draw();
      pushModel();
    } catch (failure) {
      if (!valid(ticket) || request.signal.aborted) return;
      planRead(definition);
      presentError(failure);
    } finally {
      if (pending === request) pending = null;
    }
  };
  const open = (doc: string): void => { void Promise.resolve(deps.onOpenDocument(doc)).catch(presentError); };
  const editCell = async (row: BaseRow, column: string, value: string | null): Promise<void> => {
    if (readOnly || !plan || column.startsWith("formula.") || column.startsWith("file.")) return;
    const expected = expectedProperty(row, column);
    const view = plan.view;
    const epoch = writeEpoch;
    const definition = source;
    try {
      const mutations = await prepareBaseMutations(deps, definition, view, [{ doc: row.doc, key: column, expected, value }]);
      if (destroyed || readOnly || writeEpoch !== epoch || source !== definition || plan?.view !== view) return;
      for (const mutation of mutations) {
        if (destroyed || readOnly || writeEpoch !== epoch || source !== definition || plan?.view !== view) return;
        await deps.invokeCommand(mutation.command, mutation.args);
      }
      if (!destroyed) await reload(true);
    } catch (failure) {
      if (destroyed) return;
      // No optimistic overwrite. The original observation stays on screen and
      // the next explicit reload will fetch the conflicting authoritative note.
      if (isErrorKind(failure, "conflict")) {
        draw();
        status.textContent = errorText(failure);
      } else presentError(failure);
    }
  };
  // ---- I gesti della barra ------------------------------------------------
  // Ogni gesto riscrive una sola chiave della vista, con la revisione del file
  // che la superficie mostra. Il testo nuovo arriva come per ogni altra
  // modifica (`syncDoc`), prima o dopo la risposta del comando: allora «Nel
  // file .base» mostra le righe cambiate. La barra si riaccende quando ci sono
  // tutte e tre le cose: la risposta, il testo nuovo e il suo piano.
  // La barra si riaccende: il gesto in volo è finito, scritto o no.
  const settle = (written = false): void => {
    window.clearTimeout(settleTimer);
    settleTimer = 0;
    const attempt = writing;
    writing = null;
    attempt?.finish(written);
    if (!busy) return;
    busy = false;
    pushModel();
  };
  const maybeSettle = (): void => {
    if (writing && writing.answered && writing.after !== null && writing.planned) settle(true);
  };
  // «Annulla» dopo un gesto: `vault.undo` disfa l'ultima operazione del
  // vault, come dalla palette; anche la sua riscrittura si annuncia.
  const undoWrite = async (): Promise<void> => {
    const withdraw = deps.documentWrites?.expect(context.documentId);
    try {
      const outcome = await deps.invokeCommand(COMMANDS.undo);
      if (outcome?.notify) notify(outcome.notify, "info");
      if (withdraw) {
        if (destroyed) withdraw();
        else {
          const timer = window.setTimeout(() => { undoGraces.delete(timer); withdraw(); }, UNDO_EVENT_GRACE_MS);
          undoGraces.set(timer, withdraw);
        }
      }
    } catch (failure) {
      withdraw?.();
      notify(t("commands.undo_failed", { reason: errorText(failure) }), "guasto");
    }
  };
  // Ctrl+Z fuori da un campo di testo chiede lo stesso «Annulla» del vault,
  // anche quando non c'è niente da disfare: il tasto è della Base (IMP-124).
  // Dentro un campo resta del campo (`ui/field-history.ts`). Ctrl+Maiusc+Z e
  // Ctrl+Y non passano di qui: il vault non ha un «rifai» da chiamare.
  const undoKey = (event: KeyboardEvent): void => {
    if (readOnly || event.defaultPrevented || event.isComposing) return;
    if (fieldHistoryStep(event, keyboardPlatform(navigator.platform)) !== "undo") return;
    if (isPlainTextField(event.target, TEXT_INPUT_TYPES)) return;
    if (event.target instanceof HTMLElement && event.target.isContentEditable) return;
    event.preventDefault();
    void undoWrite();
  };
  root.addEventListener("keydown", undoKey);
  // Un gesto che scrive il `.base` con un comando (`invoke`, che riceve la
  // revisione da confrontare). Torna quando la barra si riaccende: `true` se
  // il file è stato scritto. `quiet` tace la frase del comando (un passo di
  // un gesto che ne fa più d'uno, che dice la sua alla fine); `before` è il
  // testo da cui «Nel file .base» conta le righe cambiate.
  const perform = (invoke: (base: string | null) => Promise<BaseViewWrite>, options: { quiet?: boolean; before?: string } = {}): Promise<boolean> => new Promise<boolean>((resolve) => {
    if (!plan || lock() !== null || busy || destroyed) { resolve(false); return; }
    let finished = false;
    const attempt: WriteAttempt = {
      before: options.before ?? source, after: null, answered: false, planned: false,
      finish: (written) => { if (!finished) { finished = true; resolve(written); } },
    };
    writing = attempt;
    busy = true;
    notice = null;
    pushModel();
    void run(attempt, invoke, options.quiet === true).finally(() => { if (writing !== attempt) attempt.finish(false); });
  });
  // I gesti di più passi (una vista nuova, una proprietà rinominata) tengono
  // la barra spenta fra un passo e l'altro: un gesto che entrasse fra due
  // passi partirebbe da un piano a metà.
  let sequencing = 0;
  const writeView = async (key: BaseViewKey, value: unknown): Promise<void> => {
    if (!plan || sequencing > 0) return;
    const view = plan.view;
    const local = groupChoices.get(view);
    // Togliere un gruppo scelto solo in questa finestra (in «Ordina») toglie
    // la scelta, non il `group:` del file.
    if (key === "group" && value === null && local && !(plan.group !== null && sameKey(plan.group, local))) {
      forgetGroupChoice(view);
      fillGroupBy();
      draw();
      pushModel();
      return;
    }
    // Raggruppare dal menu della colonna scrive `group` nel file: la scelta
    // di questa finestra non gli resta sopra. Si toglie prima del comando,
    // perché la rilettura del piano nuovo non la ritrovi; se il file non è
    // scritto, torna com'era.
    const forgotten = key === "group" ? local : undefined;
    if (forgotten !== undefined) {
      forgetGroupChoice(view);
      await persistQueue;
      if (destroyed) return;
    }
    const written = await perform((base) => setBaseViewKey(deps, context.documentId, view, key, value, base));
    if (forgotten !== undefined && !written && !destroyed && !groupChoices.has(view)) {
      groupChoices.set(view, forgotten);
      persistQueue = persistQueue.then(() => destroyed ? undefined : deps.setViewState(`base.group:${context.documentId}:${view}`, forgotten)).catch(presentError);
      if (plan?.view === view) { fillGroupBy(); draw(); pushModel(); }
    }
  };
  const run = async (attempt: WriteAttempt, invoke: (base: string | null) => Promise<BaseViewWrite>, quiet: boolean): Promise<void> => {
    const writes = deps.documentWrites;
    let withdraw: (() => void) | undefined;
    try {
      // Il `.base` aperto anche come testo, con modifiche non ancora sul
      // disco: prima si salvano. Se restano non salvate il gesto si ferma,
      // perché scriverebbe sopra un file che non è quello sullo schermo.
      if (writes) {
        const unsaved = await writes.flush();
        if (destroyed || writing !== attempt) return;
        if (unsaved.includes(context.documentId)) {
          notice = t("base.write.unsaved");
          status.textContent = notice;
          settle();
          return;
        }
      }
      // Annunciata prima del comando: il suo evento arriva mentre scrive.
      withdraw = writes?.expect(context.documentId);
      const written = await invoke(deps.revision?.() ?? null);
      // Nessuna revisione: il file non è cambiato (o l'host non lo dice), e
      // nessun evento consumerà l'annuncio.
      if (written.revision === null) withdraw?.();
      if (written.notify && !quiet) {
        notify(written.notify, "info", written.undo
          ? { label: t("app.undo"), hint: written.undo.label, run: () => void undoWrite() }
          : undefined);
      }
      lastWrite = written;
      if (destroyed || writing !== attempt) return;
      // Niente scritto, niente testo nuovo da aspettare: la barra si riaccende.
      if (written.revision === null && written.undo === null) { settle(); return; }
      attempt.answered = true;
      maybeSettle();
      // Un host che non rimanda il testo non lascia la barra spenta: dopo un
      // po' si riaccende, e il gesto dopo, con la revisione vecchia, andrà in
      // conflitto invece di scrivere sopra.
      if (writing === attempt) settleTimer = window.setTimeout(() => { settleTimer = 0; settle(true); }, WRITE_SETTLE_MS);
    } catch (failure) {
      withdraw?.();
      if (destroyed || writing !== attempt) return;
      // Niente è stato scritto: il comando ha rifiutato il valore, o il file
      // è cambiato altrove. La vista resta quella del file com'è.
      notice = isErrorKind(failure, "conflict") ? t("base.write.conflict") : t("base.write.rejected", { reason: errorText(failure) });
      status.textContent = notice;
      settle();
    }
  };
  // Il testo del file è cambiato: se è la risposta a un gesto, le righe
  // scritte si mostrano.
  const sourceArrived = (next: string): void => {
    if (!writing || writing.after !== null) return;
    writing.after = next;
    toolbar.showWritten(writtenLines(writing.before, next));
  };
  // Il piano del testo `definition` è letto: se è quello del gesto, la barra
  // può ripartire da lui.
  const planRead = (definition: string): void => {
    if (!writing || writing.after !== definition) return;
    writing.planned = true;
    maybeSettle();
  };
  // L'esito dell'ultimo comando scritto: la frase e l'annulla di un gesto di
  // più passi si dicono alla fine.
  let lastWrite: BaseViewWrite | null = null;
  // ---- «+»: una vista nuova --------------------------------------------
  // Il nome libero per una vista del tipo detto: «Tabella», «Tabella 2»…
  const freeName = (type: BaseViewKind): string => {
    const base = t(`base.view.kind.${type}`);
    if (!names.includes(base)) return base;
    for (let n = 2; ; n++) if (!names.includes(`${base} ${n}`)) return `${base} ${n}`;
  };
  // Le proprietà delle righe che fanno da latitudine e longitudine.
  const coordinates = (): { lat_key: string; lon_key: string } | null => {
    if (plan?.map) return { lat_key: plan.map.lat_key, lon_key: plan.map.lon_key };
    const keys = rowProperties();
    const find = (names: readonly string[]) => keys.find((key) => names.includes(key.toLowerCase()));
    const lat = find(LATITUDE_KEYS), lon = find(LONGITUDE_KEYS);
    return lat && lon ? { lat_key: lat, lon_key: lon } : null;
  };
  // Le corsie di una bacheca nuova: il gruppo della vista aperta, o la prima
  // colonna che è una proprietà.
  const lanes = (): string | null => grouping() ?? plan?.group ?? plan?.columns.find((column) => columnProperty(column) !== null) ?? null;
  // Le proprietà delle righe i cui valori sono date: la data di un calendario.
  const dateProperties = (): string[] => rowProperties().filter((key) => kinds(key) === "date");
  // La data di un calendario nuovo: quella della vista aperta, o la prima
  // proprietà data delle righe.
  const calendarDate = (): string | null => plan?.dateKey ?? dateProperties()[0] ?? null;
  // Inizio e fine di una linea del tempo nuova: quelli della vista aperta, o
  // le prime due proprietà data delle righe (con una sola, ogni nota è un
  // punto).
  const timelineDates = (): { start: string; end: string | null } | null => {
    const start = plan?.startKey ?? calendarDate();
    if (start === null) return null;
    const end = plan?.startKey ? plan.endKey : dateProperties().find((key) => key !== start) ?? null;
    return { start, end };
  };
  const newViewItems = (): MenuItem[] => NEW_VIEW_KINDS.map((type): MenuItem => {
    const missing = type === "kanban" && lanes() === null ? t("base.view.needs_lanes")
      : type === "map" && coordinates() === null ? t("base.view.needs_coordinates")
        : (type === "calendar" || type === "timeline") && calendarDate() === null ? t("base.view.needs_date") : null;
    return {
      label: t(`base.view.kind.${type}`), icon: viewIcon(type),
      ...(missing === null ? { run: () => void addView(type) } : { disabled: true, description: missing }),
    };
  });
  // La vista nuova eredita il filtro e le colonne di quella aperta; una
  // bacheca anche le corsie, una mappa le coordinate. Sono più scritture, una
  // chiave per volta come ogni gesto: alla fine la vista si apre, e
  // «Annulla» la toglie con tutte le sue chiavi.
  const addView = async (type: BaseViewKind): Promise<void> => {
    if (!plan || sequencing > 0 || busy) return;
    const from = plan;
    const name = freeName(type);
    const keys: [BaseViewKey, unknown][] = [];
    // Un filtro che la Base non sa ridire si copia com'è scritto nel file.
    const filters = isOpaque(from.filters) ? from.filters.opaque : filterValue(from.filters);
    if (filters !== null && filters !== undefined) keys.push(["filters", filters]);
    const columns = from.order.length ? from.order : from.columns;
    if (columns.length) keys.push(["order", [...columns]]);
    if (type === "kanban") { const key = lanes(); if (key) keys.push(["group", { key }]); }
    if (type === "map") { const map = coordinates(); if (map) keys.push(["map", map]); }
    if (type === "calendar") { const date = calendarDate(); if (date) keys.push(["date", date]); }
    if (type === "timeline") {
      const dates = timelineDates();
      if (dates) { keys.push(["start", dates.start]); if (dates.end) keys.push(["end", dates.end]); }
    }
    const start = source;
    sequencing++;
    try {
      if (!await perform((base) => addBaseView(deps, context.documentId, name, type, base), { quiet: true, before: start })) return;
      const added = lastWrite;
      let complete = true;
      for (const [key, value] of keys) {
        if (!await perform((base) => setBaseViewKey(deps, context.documentId, name, key, value, base), { quiet: true, before: start })) { complete = false; break; }
      }
      if (destroyed) return;
      const undo = {
        label: t("app.undo"), hint: t("base.view.remove_hint", { name }),
        run: () => void perform((base) => removeBaseView(deps, context.documentId, name, base)),
      };
      // Un passo rifiutato: la vista c'è ma non ha tutto. Il motivo resta
      // sotto la barra (la vista aperta non cambia), e l'avviso lo dice.
      if (!complete) {
        notify(t("base.view.added_partly", { name }), "guasto", undo);
        return;
      }
      if (names.includes(name)) chooseView(name);
      notify(added?.notify ?? t("base.view.added", { name }), "info", undo);
    } finally { sequencing--; pushModel(); }
  };

  // ---- Il menu della colonna -------------------------------------------
  const labelOf = (key: string): string => key === NOTE_COLUMN ? plan?.columnLabels[NOTE_NAME] ?? t("menu.file") : plan?.columnLabels[key] ?? plan?.columnLabels[`prop.${key.replace(/^prop\./, "")}`] ?? key.replace(/^prop\./, "");
  // Il menu della colonna e quello di «+» sono di un piano: quando la vista
  // cambia o il file ne dà uno diverso, si chiudono, e una scelta arrivata
  // dopo non scrive. Lo stesso piano riletto (un'altra nota cambiata) li
  // lascia com'erano.
  const planKey = (of: BasePlan | null): string => of === null ? "" : JSON.stringify(of);
  let menuOpen = false;
  const closeMenus = (): void => {
    toolbar.closeMenu();
    if (!menuOpen) return;
    menuOpen = false;
    closeContextMenu();
  };
  const columnEntries = (column: string): ColumnEntry[] | null => {
    if (!plan) return null;
    const opened = planKey(plan);
    // Una scelta fatta da un menu di un piano che non c'è più non scrive:
    // il valore sarebbe del piano vecchio, con la revisione nuova.
    const current = () => !destroyed && planKey(plan) === opened;
    return columnMenu({
      plan, column, label: labelOf(column), kind: column === NOTE_COLUMN ? "text" : columnKind(rows, column),
      grouping: grouping(), regroupable: regroupable(), lock: lock(), busy: busy || sequencing > 0, readOnly,
      relation: column === NOTE_COLUMN ? null : relationColumn(propertyTypes, column),
    }, {
      write: (key, value) => { if (current()) void writeView(key, value); },
      rename: (key) => { if (current()) startRename(key); },
      setType: (key, type) => { if (current()) void setPropertyType(key, type); },
      copy: (key) => copy(filteredRows().map((row) => key === NOTE_COLUMN ? row.doc : cellText(row.values[key])).join("\n")),
    });
  };
  const openColumnMenu = (anchor: HTMLElement, column: string): void => {
    const entries = columnEntries(column);
    if (!entries) return;
    anchor.setAttribute("aria-expanded", "true");
    menuOpen = true;
    showContextMenu(anchor, columnMenuItems(entries), {
      label: t("base.column.menu", { name: labelOf(column) }),
      header: { icon: "base-table", kind: t("base.column.kind"), name: labelOf(column) },
      onClose: () => { menuOpen = false; anchor.setAttribute("aria-expanded", "false"); },
    });
  };
  // Il nome nuovo della proprietà, chiesto accanto all'intestazione.
  const startRename = (column: string): void => {
    const property = columnProperty(column);
    if (property === null || readOnly || lock() !== null) return;
    const anchor = body.querySelector<HTMLElement>(`th[data-column="${CSS.escape(column)}"] .base-head`) ?? toolbar.bar;
    toolbar.openRename(anchor, property, (next) => void renameProperty(property, next));
  };
  // Rinomina la proprietà in ogni nota (`property.key.rename`), poi le viste
  // di questo file che la nominano: ogni chiave toccata, una per volta, con
  // la revisione. Le altre Basi del vault non si toccano.
  const renameProperty = async (from: string, to: string): Promise<void> => {
    if (readOnly || lock() !== null || sequencing > 0 || busy) return;
    sequencing++;
    pushModel();
    try {
      let said: string | null = null;
      try {
        const outcome = await deps.invokeCommand(PROPERTY_RENAME, { old_key: from, new_key: to });
        said = typeof outcome?.notify === "string" && outcome.notify ? outcome.notify : null;
      } catch (failure) {
        if (destroyed) return;
        notice = t("base.rename.failed", { reason: errorText(failure) });
        status.textContent = notice;
        return;
      }
      if (destroyed) return;
      // Le viste riscritte per intero, e quelle rimaste col nome vecchio in
      // tutto o in parte.
      const done: string[] = [];
      const missed: string[] = [];
      let reason: string | null = null;
      const start = source;
      for (const view of [...names]) {
        let viewPlan: BasePlan;
        try { viewPlan = await planBaseView(deps, source, view); } catch (failure) {
          if (destroyed) return;
          missed.push(view);
          reason ??= errorText(failure);
          continue;
        }
        if (destroyed) return;
        const keys = renamedInView(viewPlan, from, to);
        if (keys.length === 0) continue;
        let whole = true;
        for (const [key, value] of keys) {
          if (!await perform((base) => setBaseViewKey(deps, context.documentId, view, key, value, base), { quiet: true, before: start })) { whole = false; break; }
        }
        if (destroyed) return;
        if (whole) done.push(view);
        else { missed.push(view); reason ??= notice; }
      }
      if (destroyed) return;
      if (missed.length) {
        // L'errore resta: le note hanno il nome nuovo, queste viste no.
        notice = t("base.rename.views_missed", { views: missed.join(", "), reason: reason ?? "" });
        status.textContent = notice;
        notify(t("base.rename.partly", { from, to }), "guasto");
        return;
      }
      notify(said ?? t("base.rename.done", { from, to }), "info");
      notice = done.length ? t("base.rename.views", { count: done.length }) : null;
      if (notice) status.textContent = notice;
    } finally { sequencing--; if (!destroyed) pushModel(); }
  };
  const setPropertyType = async (column: string, type: string): Promise<void> => {
    const property = columnProperty(column);
    if (property === null || readOnly || lock() !== null) return;
    try {
      const outcome = await deps.invokeCommand(PROPERTY_TYPE_SET, { key: property, type });
      if (typeof outcome?.notify === "string" && outcome.notify) notify(outcome.notify, "info");
      if (!destroyed) void reload(false);
    } catch (failure) {
      if (destroyed) return;
      notice = t("base.type.failed", { reason: errorText(failure) });
      status.textContent = notice;
    }
  };
  function chooseView(name: string): void {
    if (name === activeView || !names.includes(name)) return;
    closeMenus();
    activeView = name;
    plan = null;
    tableScroll = { top: 0, left: 0 };
    scrollReset = true;
    forgetPick();
    notice = null;
    toolbar.showWritten(null);
    const chosen = activeView;
    if (options.persistSelection !== false) {
      persistQueue = persistQueue.then(() => destroyed ? undefined : persistBaseView(deps, context.documentId, chosen)).catch(presentError);
    }
    pushModel();
    void reload(true);
  }
  async function listTemplates(): Promise<{ path: string; label: string }[]> {
    const response = await deps.queryIndex({
      kind: "documents",
      matching: { any: [{ all: [{ negated: false, predicate: { kind: "folder", path: TEMPLATES_FOLDER, descendants: true } }] }] },
      sort: null, select: { kind: "keys", keys: [] }, page: { offset: 0, limit: TEMPLATE_LIMIT }, excerpts: "omit",
    });
    if (response.kind !== "documents") throw new Error("base: risposta modelli fuori tema");
    return response.value.items
      .filter((item) => typeof item.doc === "string" && /\.md$/i.test(item.doc))
      .map((item) => ({ path: item.doc, label: item.doc.slice(item.doc.lastIndexOf("/") + 1).replace(/\.md$/i, "") }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
  async function createFromTemplate(template: string): Promise<void> {
    if (readOnly || creating) return;
    creating = true;
    pushModel();
    try {
      await deps.invokeCommand(TEMPLATE_COMMAND, { template });
      if (!destroyed) await reload(true);
    } catch (failure) { if (!destroyed) presentError(failure); }
    finally { creating = false; if (!destroyed) pushModel(); }
  }
  const editable = (row: BaseRow, column: string): HTMLElement => {
    const field = document.createElement("span");
    field.className = "base-cell";
    field.dataset.column = column;
    const value = row.values[column];
    const writable = !readOnly && !column.startsWith("formula.") && !column.startsWith("file.") && value?.kind !== "error";
    if (value?.kind === "bool") {
      const control = document.createElement("input");
      control.type = "checkbox";
      control.checked = value.value;
      control.disabled = !writable;
      control.setAttribute("aria-label", `${row.doc} ${column}`);
      control.addEventListener("change", () => void editCell(row, column, control.checked ? "true" : "false"));
      field.append(control);
    } else if (writable && (!value || value.kind === "empty" || value.kind === "text" || value.kind === "number")) {
      const control = document.createElement("input");
      control.type = "text";
      control.value = cellText(value);
      // Il valore di partenza: Esc ci torna senza scrivere niente.
      control.defaultValue = control.value;
      control.setAttribute("aria-label", `${row.doc} ${column}`);
      control.addEventListener("change", () => void editCell(row, column, control.value === "" ? null : JSON.stringify(control.value)));
      // Un numero si legge coi separatori della lingua; col fuoco il campo
      // torna al valore com'è, quello che si scrive.
      const shown = shownText(value, resolvedLanguage());
      if (value?.kind === "number" && shown !== control.value) {
        const raw = control.value;
        control.value = shown;
        control.addEventListener("focus", () => { if (control.value === shown) control.value = raw; });
        control.addEventListener("blur", () => { if (control.value === raw) control.value = shown; });
      }
      // La tabella si allarga col suo contenuto, come nel prototipo: il campo
      // è largo quanto il valore che mostra, non le venti lettere di un campo
      // vuoto, e non si stringe sotto il testo (un valore non si taglia: se
      // non ci sta, la tabella scorre di lato). Il resto della cella lo
      // riempie comunque.
      const chars = Math.max(CELL_MIN_CHARS, control.value.length + 1);
      control.size = chars;
      control.style.minWidth = `calc(${chars}ch + ${CELL_INSET_PX}px)`;
      field.append(control);
    } else {
      field.textContent = shownText(value, resolvedLanguage());
      if (value?.kind === "error") field.classList.add("base-cell-error");
    }
    return field;
  };
  const newNoteRow = (columns: number): HTMLTableRowElement => {
    const tr = document.createElement("tr");
    tr.className = "base-add-row";
    const cell = tr.insertCell();
    cell.colSpan = columns;
    const add = button(t("base.table.new_row"), () => void createNote());
    add.className = "base-add-row-button";
    add.disabled = creating;
    const figure = iconEl("base-plus");
    if (figure) { figure.setAttribute("aria-hidden", "true"); add.prepend(figure); }
    newRowButton = add;
    cell.append(add);
    return tr;
  };
  const drawTable = (page: BaseRow[]): void => {
    const viewport = document.createElement("div");
    viewport.className = "base-table-viewport";
    viewport.style.cssText = `max-height:${TABLE_VIEWPORT_HEIGHT}px;overflow:auto;`;
    const table = document.createElement("table");
    table.className = "base-table";
    const head = table.createTHead().insertRow();
    // L'intestazione di una colonna apre il suo menu: Ordina, Raggruppa,
    // Riepilogo, Rinomina, Tipo, Nascondi.
    for (const column of [NOTE_COLUMN, ...gridColumns()]) {
      const th = document.createElement("th");
      th.dataset.column = column;
      const label = labelOf(column);
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "base-head";
      trigger.setAttribute("aria-haspopup", "menu");
      trigger.setAttribute("aria-expanded", "false");
      trigger.setAttribute("aria-label", t("base.column.menu", { name: label }));
      const name = document.createElement("span");
      name.className = "base-head-label";
      name.textContent = label;
      // La figura della specie dei valori, davanti al nome.
      const shape = valueShape(rows, column);
      trigger.dataset.shape = shape;
      const figure = iconEl(columnIcon(shape));
      if (figure) {
        figure.classList.add("base-head-icon");
        figure.setAttribute("aria-hidden", "true");
        trigger.append(figure);
      }
      trigger.append(name);
      const sorted = plan ? sortedBy(plan.sort, column === NOTE_COLUMN ? "file.name" : column) : null;
      if (sorted) {
        const mark = document.createElement("span");
        mark.className = "base-head-sort";
        mark.textContent = sorted.descending ? "↓" : "↑";
        trigger.append(mark);
      }
      trigger.addEventListener("click", () => openColumnMenu(trigger, column));
      th.append(trigger);
      head.append(th);
    }
    const tableBody = table.createTBody();
    const spacer = (height: number): HTMLTableRowElement => {
      const tr = document.createElement("tr");
      tr.setAttribute("aria-hidden", "true");
      const td = tr.insertCell();
      td.colSpan = gridColumns().length + 1;
      td.style.cssText = `height:${height}px;padding:0;border:0`;
      return tr;
    };
    // Con un gruppo la tabella intercala una riga d'intestazione per gruppo,
    // alta come le altre: la finestra virtuale resta a righe uniformi.
    const key = grouping();
    const items: ({ group: string; count: number } | BaseRow)[] = key
      ? groupBaseRows(page, key, orderOf()).flatMap(({ name, rows }) => [{ group: name, count: rows.length }, ...(groupOpen(name) ? rows : [])])
      : page;
    tableItems = items;
    restorePick(items);
    const columns = gridColumns().length + 1;
    // «Nuova nota» in fondo alle righe: la stessa cosa di «Nuova» nella barra,
    // che non c'è in sola lettura.
    const addRow = readOnly ? null : newNoteRow(columns);
    const renderWindow = (top = viewport.scrollTop) => {
      // La finestra è alta quanto il suo contenuto fino al tetto: al primo
      // disegno la tabella è ancora vuota e `clientHeight` ne direbbe solo
      // l'intestazione, così le righe sotto le prime non comparirebbero mai
      // senza uno scorrimento. Le righe da disegnare sono quelle del tetto.
      const range = uniformRowRange(items.length, top, Math.max(viewport.clientHeight, TABLE_VIEWPORT_HEIGHT), TABLE_ROW_HEIGHT);
      if (!range) { tableBody.replaceChildren(...(addRow ? [addRow] : [])); return; }
      const fragment = document.createDocumentFragment();
      if (range.start) fragment.append(spacer(range.start * TABLE_ROW_HEIGHT));
      for (let index = range.start; index <= range.end; index++) {
        const item = items[index]!;
        if ("group" in item) {
          const tr = document.createElement("tr");
          tr.className = "base-group-row";
          tr.dataset.group = item.group;
          tr.style.height = `${TABLE_ROW_HEIGHT}px`;
          const cell = tr.insertCell();
          cell.colSpan = columns;
          cell.append(groupToggle(item.group, item.count));
          fragment.append(tr);
          continue;
        }
        const row = item;
        const tr = document.createElement("tr");
        tr.dataset.doc = row.doc;
        tr.dataset.index = String(index);
        tr.style.height = `${TABLE_ROW_HEIGHT}px`;
        const fileCell = tr.insertCell();
        fileCell.dataset.cell = "0";
        // Il titolo della nota, in grassetto, apre la nota.
        const title = button(noteTitle(row.doc), () => open(row.doc));
        title.className = "base-title";
        title.title = row.doc;
        fileCell.append(title);
        for (const [position, column] of gridColumns().entries()) {
          const cell = tr.insertCell();
          cell.dataset.cell = String(position + 1);
          cell.append(editable(row, column));
        }
        fragment.append(tr);
      }
      if (range.end + 1 < items.length) fragment.append(spacer((items.length - range.end - 1) * TABLE_ROW_HEIGHT));
      if (addRow) fragment.append(addRow);
      tableBody.replaceChildren(fragment);
      paint();
    };
    // Le celle scelte si segnano solo fra le righe disegnate: con ventimila
    // righe la finestra resta di poche decine, e così il lavoro.
    const paint = (): void => {
      const ranges = pickedRanges();
      // Una cella sola si segna quando il fuoco è sulla tabella e non in un
      // campo: è la cella da cui Maiusc con le frecce parte.
      const range = selectsSeveral(ranges) || (ranges.length > 0 && document.activeElement === viewport) ? ranges[0]! : null;
      for (const cell of tableBody.querySelectorAll<HTMLTableCellElement>("tr[data-index] > td[data-cell]")) {
        const inside = range !== null && touches(range, Number(cell.parentElement!.dataset.index), Number(cell.dataset.cell));
        if (inside !== cell.hasAttribute("data-picked")) cell.toggleAttribute("data-picked", inside);
      }
    };
    paintPicked = paint;
    const cellAt = (target: EventTarget | null): Cell | null => {
      const cell = target instanceof Element ? target.closest<HTMLElement>("tr[data-index] > td[data-cell]") : null;
      if (!cell || !tableBody.contains(cell)) return null;
      return { row: Number(cell.parentElement!.dataset.index), column: Number(cell.dataset.cell) };
    };
    // La riga del fuoco resta in vista quando le frecce la portano fuori.
    const reveal = (row: number): void => {
      const top = row * TABLE_ROW_HEIGHT;
      const height = viewport.clientHeight || TABLE_VIEWPORT_HEIGHT;
      if (top < viewport.scrollTop) viewport.scrollTop = top;
      else if (top + TABLE_ROW_HEIGHT > viewport.scrollTop + height) viewport.scrollTop = top + TABLE_ROW_HEIGHT - height;
      else return;
      renderWindow();
    };
    // Una riga d'intestazione di gruppo non è una cella: le frecce la
    // saltano.
    const dataRow = (from: number, by: -1 | 1): number => {
      for (let row = from + by; row >= 0 && row < items.length; row += by) if (!("group" in items[row]!)) return row;
      return from;
    };
    // La tabella prende il fuoco quando la selezione esce dal campo aperto:
    // Maiusc con le frecce ed Esc continuano da lì.
    viewport.tabIndex = -1;
    viewport.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const cell = cellAt(event.target);
      if (!cell) return;
      if (event.shiftKey && picked) {
        // Maiusc+clic allarga senza aprire la cella sotto il puntatore.
        event.preventDefault();
        pick({ anchor: picked.anchor, focus: cell });
        return;
      }
      pick({ anchor: cell, focus: cell });
      picking = true;
    });
    viewport.addEventListener("pointermove", (event) => {
      if (!picking || !picked) return;
      if ((event.buttons & 1) === 0) { picking = false; return; }
      const cell = cellAt(document.elementFromPoint(event.clientX, event.clientY));
      if (!cell || (cell.row === picked.focus.row && cell.column === picked.focus.column)) return;
      // Uscito dalla cella di partenza, il trascinamento sceglie celle e non
      // più testo: il campo aperto si lascia.
      if (document.activeElement !== viewport && root.contains(document.activeElement)) {
        window.getSelection()?.removeAllRanges();
        viewport.focus({ preventScroll: true });
      }
      event.preventDefault();
      pick({ anchor: picked.anchor, focus: cell });
    });
    const stopPicking = () => { picking = false; };
    viewport.addEventListener("pointerup", stopPicking);
    viewport.addEventListener("pointercancel", stopPicking);
    viewport.addEventListener("focusin", (event) => {
      // Col Tab in una cella, quella cella diventa la scelta; un fuoco che
      // arriva dentro una selezione di più celle non la disfa.
      if (picking || event.target === viewport || selectsSeveral(pickedRanges())) return;
      const cell = cellAt(event.target);
      if (cell) pick({ anchor: cell, focus: cell });
    });
    viewport.addEventListener("focus", paint);
    viewport.addEventListener("blur", paint);
    viewport.addEventListener("keydown", (event) => {
      if (!picked || event.altKey || event.ctrlKey || event.metaKey) return;
      const several = selectsSeveral(pickedRanges());
      const field = event.target instanceof HTMLInputElement && event.target.type === "text" ? event.target : null;
      if (event.key === "Escape" && field) {
        // Esc nel campo aperto lo lascia senza scriverlo, e porta alla cella:
        // da lì Maiusc con le frecce sceglie le celle.
        event.preventDefault();
        event.stopPropagation();
        field.value = field.defaultValue;
        viewport.focus({ preventScroll: true });
        return;
      }
      if (event.key === "Escape" && several) {
        event.preventDefault();
        event.stopPropagation();
        pick({ anchor: picked.anchor, focus: picked.anchor });
        return;
      }
      // Nel campo aperto Maiusc con le frecce resta al campo: sceglie il
      // testo, non le celle.
      if (!event.shiftKey || field) return;
      const { focus } = picked;
      let next: Cell | null = null;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") next = { row: dataRow(focus.row, event.key === "ArrowDown" ? 1 : -1), column: focus.column };
      // Di lato solo con più celle già scelte: in un campo Maiusc con le
      // frecce laterali sceglie ancora il testo.
      else if (several && event.key === "ArrowRight") next = { row: focus.row, column: Math.min(focus.column + 1, columns - 1) };
      else if (several && event.key === "ArrowLeft") next = { row: focus.row, column: Math.max(focus.column - 1, 0) };
      if (!next) return;
      event.preventDefault();
      if (document.activeElement !== viewport) viewport.focus({ preventScroll: true });
      pick({ anchor: picked.anchor, focus: next });
      reveal(next.row);
    });
    viewport.addEventListener("scroll", () => renderWindow());
    // Il piede: il conteggio sotto la nota, i riepiloghi del core sotto le
    // loro colonne. Resta in fondo alla finestra mentre si scorre.
    table.append(tableFooter({
      columns: gridColumns(), summaries: plan?.summaries ?? [], values: summaries, count: page.length,
      total: rows.length, searching: search.value.trim() !== "", locale: resolvedLanguage(), labelOf,
    }));
    viewport.append(table);
    body.append(viewport);
    // Il primo disegno parte da dove la tabella di prima era scorsa: le righe
    // di quel punto, poi lo scorrimento (che il browser ferma alla fine).
    const { top, left } = tableScroll;
    renderWindow(top);
    viewport.scrollTop = top;
    viewport.scrollLeft = left;
  };
  const drawCards = (page: BaseRow[], list: boolean): void => {
    const key = grouping();
    if (!key) { body.append(gallery(page, list)); return; }
    // Un gruppo è una sezione col suo titolo, che apre e chiude le sue schede.
    for (const { name, rows } of groupBaseRows(page, key, orderOf())) {
      const section = document.createElement("section");
      section.className = "base-group";
      section.dataset.group = name;
      const heading = document.createElement("h3");
      heading.append(groupToggle(name, rows.length));
      section.append(heading);
      if (groupOpen(name)) section.append(gallery(rows, list));
      body.append(section);
    }
  };
  const gallery = (page: BaseRow[], list: boolean): HTMLElement => {
    const gallery = document.createElement("div");
    gallery.className = list ? "base-list" : "base-cards";
    for (const row of page) {
      const card = document.createElement("article");
      card.className = "base-card";
      card.dataset.doc = row.doc;
      card.append(button(row.doc, () => open(row.doc)));
      for (const column of plan?.columns ?? []) {
        const field = document.createElement("div");
        field.className = "base-field";
        const label = document.createElement("span");
        label.textContent = plan?.columnLabels[column] ?? column;
        field.append(label, editable(row, column));
        card.append(field);
      }
      gallery.append(card);
    }
    return gallery;
  };
  const drawKanban = (page: BaseRow[]): void => {
    const key = plan?.group, view = plan?.view;
    if (!key || !view) throw new Error("base: board senza gruppo");
    const groups = new Map<string, BaseRow[]>();
    for (const row of page) {
      const name = cellText(row.values[key]);
      const members = groups.get(name) ?? [];
      members.push(row);
      groups.set(name, members);
    }
    for (const name of localLanes.get(view) ?? []) if (!groups.has(name)) groups.set(name, []);
    // Una Selezione o uno Stato (T9): le corsie sono le opzioni del registro,
    // anche vuote, nel loro ordine e (lo Stato) nei tre gruppi; poi i valori
    // fuori dalle opzioni. Per ogni altro tipo, i valori come compaiono.
    const property = columnProperty(key);
    const choice = property === null ? null : choiceLanes(propertyTypes, property, [...groups.keys()]);
    const lanes: { name: string; members: BaseRow[]; option: PropertyOption | null }[] = choice
      ? choice.lanes.map((lane) => ({ name: lane.name, members: groups.get(lane.name) ?? [], option: lane.option }))
      : [...groups].map(([name, members]) => ({ name, members, option: null }));
    const board = document.createElement("div");
    board.className = "base-kanban";
    const writable = !readOnly && !key.startsWith("formula.") && !key.startsWith("file.");
    /// Sposta una scheda in una corsia: scrive il valore nella nota, con la
    /// revisione letta (`editCell`).
    const move = (row: BaseRow, name: string) => {
      if (cellText(row.values[key]) !== name) void editCell(row, key, JSON.stringify(name));
    };
    const remember = (name: string) => {
      let lanes = localLanes.get(view);
      if (!lanes) { lanes = new Set(); localLanes.set(view, lanes); }
      if (lanes.size >= 128 && !lanes.has(name)) throw new Error("base: troppe corsie");
      lanes.add(name);
      saveLanes(view);
    };
    lanes.forEach(({ name, members, option }, index) => {
      const lane = document.createElement("section");
      lane.className = "base-kanban-column";
      lane.dataset.group = name;
      const heading = document.createElement("h3");
      // Sotto il titolo della scheda (h1) la Base non ha un h2: la corsia è
      // il secondo livello per chi legge i titoli.
      heading.setAttribute("aria-level", "2");
      if (option && choice) {
        // L'opzione come pastiglia del suo colore, col pallino dello Stato
        // (`.lane-h .opt` del prototipo), e quante schede ha.
        lane.dataset.option = "";
        if (choice.kind === "status") lane.dataset.statusGroup = option.group;
        const pill = document.createElement("span");
        pill.className = "cm-fub-prop-opt";
        pill.dataset.color = option.color;
        if (choice.kind === "status") pill.dataset.status = "";
        pill.textContent = name;
        heading.append(pill, ` ${members.length}`);
      } else {
        // Fuori dalle opzioni il valore resta testo, come nella nota.
        if (choice) lane.dataset.outside = "";
        heading.textContent = `${name || "∅"} (${members.length})`;
      }
      lane.append(heading);
      // Un'opzione si rinomina nel registro, non qui: rinominare la corsia
      // riscriverebbe le note con un valore fuori dalle opzioni.
      if (writable && name && !option) {
        lane.append(button(t("base.lane.rename"), () => {
          const input = document.createElement("input");
          input.value = name;
          input.setAttribute("aria-label", t("base.lane.rename_named", { name }));
          heading.replaceWith(input);
          input.focus();
          input.select();
          let finished = false;
          const commit = () => {
            if (finished) return;
            finished = true;
            const next = input.value.trim();
            if (!next || next === name) { draw(); return; }
            if (next.length > 256 || groups.has(next)) { status.textContent = t("base.lane.taken"); draw(); return; }
            remember(next);
            localLanes.get(view)?.delete(name);
            saveLanes(view);
            void (async () => {
              try {
                await persistQueue;
                for (const member of rows.filter((row) => cellText(row.values[key]) === name)) {
                  const [mutation] = await prepareBaseMutations(deps, source, view, [{ doc: member.doc, key, expected: expectedProperty(member, key), value: JSON.stringify(next) }]);
                  if (destroyed || readOnly || !mutation) return;
                  await deps.invokeCommand(mutation.command, mutation.args);
                }
                await reload(true);
              } catch (failure) { if (!destroyed) { status.textContent = errorText(failure); void reload(true); } }
            })();
          };
          input.addEventListener("keydown", (event) => { if (event.key === "Enter") commit(); else if (event.key === "Escape") { finished = true; draw(); } });
          input.addEventListener("blur", () => { if (input.isConnected) commit(); });
        }));
      }
      if (writable) lane.append(button(t("base.card.add"), () => void createNote(name)));
      for (const row of members) {
        const card = document.createElement("article");
        card.className = "base-kanban-card";
        card.dataset.doc = row.doc;
        card.draggable = writable;
        const opener = button(row.doc, () => open(row.doc));
        card.append(opener);
        if (writable) {
          card.addEventListener("dragstart", (event) => event.dataTransfer?.setData("application/x-fub-base-doc", row.doc));
          // Da tastiera: Alt ← e Alt → spostano la scheda nella corsia
          // accanto, come il trascinamento.
          opener.setAttribute("aria-keyshortcuts", "Alt+ArrowLeft Alt+ArrowRight");
          opener.addEventListener("keydown", (event) => {
            if (!event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
            const next = lanes[index + (event.key === "ArrowLeft" ? -1 : 1)];
            if (!next) return;
            event.preventDefault();
            move(row, next.name);
          });
        }
        lane.append(card);
      }
      if (writable) {
        lane.addEventListener("dragover", (event) => event.preventDefault());
        lane.addEventListener("drop", (event) => {
          event.preventDefault();
          const target = page.find((row) => row.doc === event.dataTransfer?.getData("application/x-fub-base-doc"));
          if (target) move(target, name);
        });
      }
      board.append(lane);
    });
    if (writable) {
      const add = document.createElement("input");
      add.placeholder = t("base.lane.add_placeholder");
      add.setAttribute("aria-label", t("base.lane.add"));
      add.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        const name = add.value.trim();
        if (!name || name.length > 256 || lanes.some((lane) => lane.name === name)) { status.textContent = t("base.lane.taken"); return; }
        // Su una Selezione o uno Stato la corsia nuova è un'opzione nuova
        // del registro (lo Stato in Da fare, con un colore libero).
        if (choice && property !== null) {
          void addLaneOption(property, name, choice.kind);
          return;
        }
        remember(name);
        draw();
      });
      board.append(add);
    }
    body.append(board);
  };
  /// Aggiunge un'opzione al registro dei tipi (`property.option.set`) e
  /// rilegge il registro: la corsia nuova compare. Un registro che non si
  /// scrive (illeggibile, di una versione futura) lo dice la barra.
  const addLaneOption = async (property: string, name: string, kind: "select" | "status"): Promise<void> => {
    try {
      await deps.invokeCommand(PROPERTY_OPTION_SET, { key: property, option: name, color: freeColor(optionsOf(propertyTypes, property)), ...(kind === "status" ? { group: "todo" } : {}) });
      await readPropertyTypes();
    } catch (failure) {
      if (!destroyed) status.textContent = errorText(failure);
    }
  };
  /// Rilegge il registro dei tipi; se cambia, la Bacheca si ridisegna.
  let typesRead = 0;
  const readPropertyTypes = async (): Promise<void> => {
    if (!deps.propertyTypes) return;
    const mine = ++typesRead;
    const raw = await deps.propertyTypes().catch(() => undefined);
    if (destroyed || mine !== typesRead) return;
    const next = parsePropertyTypes(raw);
    if (sameTypes(next, propertyTypes)) return;
    propertyTypes = next;
    if (plan?.viewType === "kanban") draw();
  };
  const drawMap = (page: BaseRow[]): void => {
    const config = plan?.map;
    if (!config) throw new Error("base: coordinate non configurate");
    const wrapper = document.createElement("div");
    wrapper.className = "base-map";
    wrapper.dataset.provider = "offline";
    const atlas = svg("svg", { viewBox: "0 0 720 360", role: "img", "aria-label": t("base.map.label"), tabindex: "0" });
    atlas.classList.add("base-map-atlas");
    const world = svg("g", {});
    const tiles = svg("g", { class: "base-map-tiles" });
    const grid = svg("g", { class: "base-map-grid" });
    const mercatorY = (lat: number) => {
      const phi = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180;
      return (1 - Math.asinh(Math.tan(phi)) / Math.PI) * 180;
    };
    world.append(tiles);
    for (let lon = -150; lon <= 150; lon += 30) grid.append(svg("line", { x1: String((lon + 180) * 2), x2: String((lon + 180) * 2), y1: "0", y2: "360", stroke: "currentColor", opacity: ".25" }));
    for (let lat = -60; lat <= 60; lat += 30) grid.append(svg("line", { x1: "0", x2: "720", y1: String(mercatorY(lat)), y2: String(mercatorY(lat)), stroke: "currentColor", opacity: ".25" }));
    world.append(grid);
    for (const row of page) {
      const lat = row.values[config.lat_key], lon = row.values[config.lon_key];
      if (lat?.kind !== "number" || lon?.kind !== "number" || !Number.isFinite(lat.value) || !Number.isFinite(lon.value) || Math.abs(lat.value) > 90 || Math.abs(lon.value) > 180) continue;
      const name = config.label_key ? cellText(row.values[config.label_key]) || row.doc : row.doc;
      const marker = svg("circle", { cx: String((lon.value + 180) * 2), cy: String(mercatorY(lat.value)), r: "5", class: "base-map-marker", role: "button", tabindex: "0", "aria-label": name });
      const color = config.color_key ? row.values[config.color_key] : undefined;
      if (color?.kind === "text" && /^#[0-9a-fA-F]{3,8}$/.test(color.value)) marker.setAttribute("fill", color.value);
      marker.append(svg("title", {}));
      marker.querySelector("title")!.textContent = name;
      marker.addEventListener("click", () => open(row.doc));
      marker.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(row.doc); } });
      world.append(marker);
    }
    atlas.append(world);
    let zoom = 1, x = 0, y = 0;
    const update = () => { world.setAttribute("transform", `translate(${x} ${y}) scale(${zoom})`); };
    const provider = config.provider;
    const allowedHosts = deps.mapTileHosts ?? [];
    const template = provider?.url_template;
    const firstTile = provider?.network && provider.kind !== "offline" && template
      ? allowedBaseTileUrl(template, provider.kind, allowedHosts, 1, 0, 0) : null;
    const attribution = document.createElement("p");
    attribution.className = "base-map-attribution";
    let tileRequest: AbortController | null = null;
    const tileUrls = new Set<string>();
    const releaseTiles = () => {
      tileRequest?.abort();
      tileRequest = null;
      for (const url of tileUrls) URL.revokeObjectURL(url);
      tileUrls.clear();
      tiles.replaceChildren();
    };
    tileCleanup = releaseTiles;
    const paintTiles = async () => {
      if (!provider || provider.kind === "offline" || !template || !firstTile || wrapper.dataset.provider === "offline") return;
      releaseTiles();
      const request = new AbortController();
      tileRequest = request;
      const level = Math.min(3, Math.floor(Math.log2(zoom)) + 1), count = 2 ** level;
      try {
        const images = document.createDocumentFragment();
        // Browser <image href=https:> follows redirects past the allowlist.
        // Fetch without redirects/credentials, bound bytes, then paint local blobs.
        for (let col = 0; col < count; col++) for (let row = 0; row < count; row++) {
          const url = allowedBaseTileUrl(template, provider.kind, allowedHosts, level, col, row);
          if (!url) throw new Error("tile endpoint outside allowlist");
          const response = await fetch(url, { ...LOCAL_FETCH, signal: request.signal });
          const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
          const types = provider.kind === "vector" ? ["image/svg+xml"] : ["image/png", "image/jpeg", "image/webp"];
          if (!response.ok || !mime || !types.includes(mime) || !response.body || Number(response.headers.get("content-length") ?? 0) > 1024 * 1024) throw new Error("tile response unavailable or unsupported");
          const reader = response.body.getReader();
          const chunks: ArrayBuffer[] = [];
          let size = 0;
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > 1024 * 1024) throw new Error("tile exceeds 1 MiB");
              chunks.push(new Uint8Array(value).buffer as ArrayBuffer);
            }
          } finally { reader.releaseLock(); }
          if (request.signal.aborted || !wrapper.isConnected) return;
          const blobUrl = URL.createObjectURL(new Blob(chunks, { type: mime }));
          tileUrls.add(blobUrl);
          images.append(svg("image", { x: String(col * 720 / count), y: String(row * 360 / count), width: String(720 / count), height: String(360 / count), href: blobUrl }));
        }
        if (!request.signal.aborted && wrapper.isConnected) tiles.replaceChildren(images);
      } catch (reason) {
        if (request.signal.aborted) return;
        wrapper.dataset.provider = "offline";
        releaseTiles();
        attribution.textContent = t("base.map.tiles_failed", { reason: errorText(reason) });
      }
    };
    const zoomBy = (factor: number) => { zoom = Math.max(1, Math.min(8, zoom * factor)); update(); if (wrapper.dataset.provider !== "offline") void paintTiles(); };
    let drag: { x: number; y: number } | null = null;
    atlas.addEventListener("pointerdown", (event) => { if (event.target !== atlas && event.target !== grid && !(event.target instanceof SVGLineElement)) return; drag = { x: event.clientX, y: event.clientY }; atlas.setPointerCapture(event.pointerId); });
    atlas.addEventListener("pointermove", (event) => { if (!drag) return; const bounds = atlas.getBoundingClientRect(); x += (event.clientX - drag.x) * 720 / bounds.width; y += (event.clientY - drag.y) * 360 / bounds.height; drag = { x: event.clientX, y: event.clientY }; update(); });
    atlas.addEventListener("pointerup", () => { drag = null; });
    atlas.addEventListener("lostpointercapture", () => { drag = null; });
    atlas.addEventListener("wheel", (event) => { event.preventDefault(); zoomBy(event.deltaY < 0 ? 1.2 : 1 / 1.2); }, { passive: false });
    atlas.addEventListener("keydown", (event) => {
      if (event.target !== atlas) return;
      if (event.key === "+" || event.key === "=") zoomBy(1.2);
      else if (event.key === "-") zoomBy(1 / 1.2);
      else if (event.key === "ArrowLeft") x += 25;
      else if (event.key === "ArrowRight") x -= 25;
      else if (event.key === "ArrowUp") y += 25;
      else if (event.key === "ArrowDown") y -= 25;
      else return;
      event.preventDefault(); update();
    });
    if (firstTile && provider) {
      attribution.textContent = t("base.map.offline", { provider: provider.attribution ?? new URL(firstTile).hostname });
      wrapper.append(button(t("base.map.enable"), () => {
        wrapper.dataset.provider = provider.kind;
        void paintTiles();
        attribution.textContent = provider.attribution ?? new URL(firstTile).hostname;
      }));
    } else {
      attribution.textContent = provider?.kind && provider.kind !== "offline"
        ? t("base.map.tiles_denied")
        : BASE_MAP_ATTRIBUTION_FALLBACK;
    }
    const zoomIn = button("+", () => zoomBy(1.2));
    zoomIn.setAttribute("aria-label", t("base.map.zoom_in"));
    const zoomOut = button("−", () => zoomBy(1 / 1.2));
    zoomOut.setAttribute("aria-label", t("base.map.zoom_out"));
    wrapper.append(zoomIn, zoomOut, atlas, attribution);
    body.append(wrapper);
  };
  // ---- Il calendario ----------------------------------------------------
  // Il mese mostrato, il fuoco e i giorni aperti restano fra un ridisegno e
  // l'altro; nascono col primo calendario disegnato, sul mese di oggi.
  let calendar: CalendarState | null = null;
  // Una nota in viaggio verso un altro giorno: niente altri gesti finché la
  // sua scrittura non è finita.
  let moving = false;
  const dateFormat = (day: IsoDay): string => new Intl.DateTimeFormat(resolvedLanguage(), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${day}T00:00:00Z`));
  // La data di una nota spostata su un altro giorno, con `note.property.set`:
  // il valore letto fa da confronto (una nota cambiata nel frattempo non si
  // sovrascrive), la data resta nella sua forma (l'ora resta), e l'avviso
  // offre l'annulla del vault.
  const moveNote = async (row: BaseRow, day: IsoDay): Promise<void> => {
    const key = plan?.dateKey;
    if (!plan || !key || readOnly || moving || destroyed) return;
    const value = movedDateValue(row.properties[key], day);
    if (value === null) return;
    const view = plan.view;
    const definition = source;
    const name = noteTitle(row.doc);
    moving = true;
    notice = null;
    draw();
    try {
      const [mutation] = await prepareBaseMutations(deps, definition, view, [{ doc: row.doc, key, expected: expectedProperty(row, key), value: JSON.stringify(value) }]);
      if (destroyed || readOnly || !mutation || source !== definition || plan?.view !== view) return;
      const outcome = await deps.invokeCommand(mutation.command, mutation.args);
      if (destroyed) return;
      const undo = outcome?.undo;
      notify(t("base.calendar.moved", { note: name, date: dateFormat(day) }), "info", undo
        ? { label: t("app.undo"), hint: typeof undo.label === "string" ? undo.label : undefined, run: () => void undoNoteMove() }
        : undefined);
    } catch (failure) {
      if (destroyed) return;
      // Niente è stato scritto: la nota resta dov'era, e il calendario la
      // rilegge com'è ora.
      notice = isErrorKind(failure, "conflict") ? t("base.calendar.conflict", { note: name }) : t("base.calendar.failed", { note: name, reason: errorText(failure) });
      if (calendar && row.day) calendar.focus = row.day;
    } finally {
      moving = false;
      if (!destroyed) await reload(false);
    }
  };
  // «Annulla» di uno spostamento: l'annulla del vault, una volta per ogni
  // proprietà scritta (le due date di una barra sono due scritture).
  const undoNoteMove = async (count = 1, quiet = false): Promise<void> => {
    try {
      let said: string | null = null;
      for (let index = 0; index < count; index++) {
        const outcome = await deps.invokeCommand(COMMANDS.undo);
        if (typeof outcome?.notify === "string" && outcome.notify !== "") said = outcome.notify;
      }
      if (said && !quiet) notify(said, "info");
    } catch (failure) {
      notify(t("commands.undo_failed", { reason: errorText(failure) }), "guasto");
    }
  };
  const drawCalendar = (page: BaseRow[]): void => {
    const today = localDay();
    calendar ??= calendarState(today);
    const key = plan?.dateKey ?? null;
    const writableKey = key !== null && !key.startsWith("file.") && !key.startsWith("formula.");
    body.append(renderCalendar({
      rows: page, state: calendar, locale: resolvedLanguage(), today, dateKey: key,
      title: noteTitle,
      movable: (row) => writableKey && !readOnly && /\.md$/i.test(row.doc) && movedDateValue(row.properties[key!], row.day ?? today) !== null,
      busy: moving || busy,
      dateChoices: lock() === null ? dateProperties() : null,
      chooseDateKey: (date) => void writeView("date", date),
      open,
      move: (row, day) => void moveNote(row, day),
      redraw: () => draw(),
    }));
  };
  // ---- La linea del tempo -----------------------------------------------
  // La scala, i giorni mostrati e la riga col fuoco restano fra un ridisegno
  // e l'altro; nascono col primo disegno, con oggi nella seconda colonna.
  let timeline: TimelineState | null = null;
  // Le date di una barra spostata: una `note.property.set` per proprietà,
  // ognuna col valore letto come confronto e la data nella sua forma. Se la
  // seconda non passa, la prima si disfa: la barra non resta a metà. Una
  // sola «Annulla» disfa tutte e due.
  const moveSpan = async (row: TimelineRow, dates: { start?: IsoDay; end?: IsoDay }): Promise<void> => {
    if (!plan || readOnly || moving || destroyed) return;
    const keys = { start: plan.startKey, end: plan.endKey };
    const edits: { doc: string; key: string; expected: BaseExpected; value: string }[] = [];
    for (const edge of ["start", "end"] as const) {
      const day = dates[edge];
      const key = keys[edge];
      if (day === undefined) continue;
      if (!key) return;
      // Inizio e fine sulla stessa proprietà: una data sola.
      if (edits.some((edit) => edit.key === key)) continue;
      const value = movedDateValue(row.properties[key], day);
      if (value === null) return;
      edits.push({ doc: row.doc, key, expected: expectedProperty(row, key), value: JSON.stringify(value) });
    }
    if (edits.length === 0) return;
    const view = plan.view;
    const definition = source;
    const name = noteTitle(row.doc);
    const both = row.span.start !== null && row.span.end !== null;
    const start = dates.start ?? row.span.start, end = dates.end ?? row.span.end;
    const said = !both ? t("base.timeline.moved_point", { note: name, date: dateFormat((dates.start ?? dates.end)!) })
      : dates.start !== undefined && dates.end !== undefined ? t("base.timeline.moved_span", { note: name, start: dateFormat(start!), end: dateFormat(end!) })
        : dates.start !== undefined ? t("base.timeline.moved_start", { note: name, date: dateFormat(start!) })
          : t("base.timeline.moved_end", { note: name, date: dateFormat(end!) });
    moving = true;
    notice = null;
    draw();
    let written = 0;
    let undoable = true;
    let hint: string | undefined;
    try {
      const mutations = await prepareBaseMutations(deps, definition, view, edits);
      for (const mutation of mutations) {
        if (destroyed || readOnly || source !== definition || plan?.view !== view) break;
        const outcome = await deps.invokeCommand(mutation.command, mutation.args);
        written++;
        if (!outcome?.undo) undoable = false;
        else if (typeof outcome.undo.label === "string") hint ??= outcome.undo.label;
      }
      if (destroyed || written === 0) return;
      // La vista è cambiata fra le due scritture: la barra non resta a metà.
      if (written < mutations.length) { await undoNoteMove(written, true); return; }
      const count = written;
      notify(said, "info", undoable
        ? { label: t("app.undo"), hint, run: () => void undoNoteMove(count) }
        : undefined);
    } catch (failure) {
      if (destroyed) return;
      // Ciò che è già scritto si disfa, perché la barra non resti a metà;
      // poi la linea del tempo rilegge la nota com'è.
      if (written > 0) await undoNoteMove(written, true);
      notice = isErrorKind(failure, "conflict") ? t("base.timeline.conflict", { note: name }) : t("base.timeline.failed", { note: name, reason: errorText(failure) });
    } finally {
      moving = false;
      if (!destroyed) await reload(false);
    }
  };
  const drawTimeline = (page: BaseRow[], undated: number): void => {
    const today = localDay();
    timeline ??= timelineState(today, firstWeekday(resolvedLanguage()));
    const startKey = plan?.startKey ?? null, endKey = plan?.endKey ?? null;
    const writableKey = (key: string | null): key is string => key !== null && !key.startsWith("file.") && !key.startsWith("formula.");
    body.append(renderTimeline({
      rows: page, undated, state: timeline, locale: resolvedLanguage(), today, startKey, endKey,
      title: noteTitle,
      writable: (row, edge) => {
        const key = edge === "start" ? startKey : endKey;
        return writableKey(key) && !readOnly && /\.md$/i.test(row.doc) && movedDateValue(row.properties[key], today) !== null;
      },
      busy: moving || busy,
      dateChoices: lock() === null ? dateProperties() : null,
      chooseStartKey: (key) => void writeView("start", key),
      open,
      move: (row, dates) => void moveSpan(row, dates),
      redraw: () => draw(),
    }));
  };
  // Un piano diverso (un'altra vista, o il file cambiato) chiude i menu
  // aperti su quello di prima; lo stesso piano riletto no.
  let drawnPlan = "";
  const draw = (): void => {
    const drawing = planKey(plan);
    if (drawing !== drawnPlan) { closeMenus(); drawnPlan = drawing; }
    tileCleanup?.();
    tileCleanup = null;
    // Il fuoco dentro il calendario torna dov'era dopo il ridisegno: sul
    // giorno, o sulla nota se aveva quella.
    const active = document.activeElement;
    if (calendar && active instanceof HTMLElement && body.querySelector(".base-calendar")?.contains(active)) {
      const note = active.closest<HTMLElement>(".base-cal-event")?.dataset.doc;
      if (note !== undefined) calendar.chosen = note;
      calendar.refocus ??= note !== undefined ? "note" : "day";
    }
    // E nella linea del tempo, sulla riga.
    if (timeline && active instanceof HTMLElement && body.querySelector(".base-timeline")?.contains(active)) {
      const doc = active.closest<HTMLElement>(".base-tl-row")?.dataset.doc;
      if (doc !== undefined) { timeline.focus = doc; timeline.refocus = true; }
    }
    const shown = body.querySelector<HTMLElement>(".base-table-viewport");
    if (scrollReset) tableScroll = { top: 0, left: 0 };
    else if (shown) tableScroll = { top: shown.scrollTop, left: shown.scrollLeft };
    scrollReset = false;
    body.replaceChildren();
    // Le righe di prima non ci sono più: la scelta torna, se le sue celle ci
    // sono ancora, quando la tabella nuova si disegna (`restorePick`).
    const hadPick = picked !== null;
    tableItems = [];
    paintPicked = () => {};
    picking = false;
    picked = null;
    try {
      drawView();
    } finally {
      // Anche le stesse celle possono mostrare valori nuovi: chi le somma
      // rilegge.
      if (hadPick || picked !== null) cellsChanged();
    }
  };
  const drawView = (): void => {
    if (error) { body.append(button(labels().retry, () => void reload(true))); return; }
    const matches = filteredRows();
    // La tabella ha la sua finestra di righe e il calendario mostra un mese:
    // tutte e due prendono tutte le righe, le altre viste cento per volta.
    const whole = plan?.viewType === "table" || plan?.viewType === "calendar";
    // La linea del tempo mostra cento note con le date per volta; quelle
    // senza date le conta in testa.
    const pool = plan?.viewType === "timeline" ? matches.filter((row) => row.span && (row.span.start !== null || row.span.end !== null)) : matches;
    const page = whole ? pool : pool.slice(0, displayed);
    try {
      if (plan?.viewType === "table") drawTable(page);
      else if (plan?.viewType === "calendar") drawCalendar(page);
      else if (plan?.viewType === "timeline") drawTimeline(page, matches.length - pool.length);
      else if (plan?.viewType === "cards") drawCards(page, false);
      else if (plan?.viewType === "list") drawCards(page, true);
      else if (plan?.viewType === "kanban") drawKanban(page);
      else if (plan?.viewType === "map") drawMap(page);
      if (!whole && displayed < pool.length) body.append(button(t("search.more", { shown: Math.min(displayed, pool.length), total: pool.length }), () => { displayed += VISIBLE_STEP; draw(); }));
      if (plan && plan.viewType !== "table") {
        body.append(listFooter({ columns: plan.columns, summaries: plan.summaries, values: summaries, count: matches.length, total: rows.length, searching: search.value.trim() !== "", locale: resolvedLanguage(), labelOf }));
      }
      status.textContent = notice ?? t("search.count_limited", { shown: matches.length, total: rows.length });
    } catch (failure) { presentError(failure); }
  };
  async function createNote(lane?: string): Promise<void> {
    if (readOnly || creating) return;
    creating = true;
    pushModel();
    try {
      const defaults: Record<string, unknown> = Object.assign(Object.create(null), plan?.createDefaults ?? {});
      if (lane !== undefined && plan?.group) {
        const key = plan.group.replace(/^prop\./, "");
        if (Object.prototype.hasOwnProperty.call(defaults, key) && defaults[key] !== lane) throw new Error("base: corsia incompatibile con il filtro");
        defaults[key] = lane;
      }
      await deps.invokeCommand("note.create", Object.keys(defaults).length ? { properties: JSON.stringify(defaults) } : {});
      if (!destroyed) await reload(true);
    }
    catch (failure) { presentError(failure); }
    finally { creating = false; if (!destroyed) pushModel(); }
  }
  async function copyResults(): Promise<void> {
    try { await writeClipboardText(baseRowsToCsv(filteredRows(), plan?.columns ?? [])); status.textContent = t("base.csv.copied"); }
    catch (failure) { presentError(failure); }
  }
  function exportResults(): void {
    try {
      const csv = baseRowsToCsv(filteredRows(), plan?.columns ?? []);
      const filename = `${(plan?.view ?? "base").replace(/[^a-zA-Z0-9_-]+/g, "_")}.csv`;
      const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.hidden = true;
      root.append(link);
      try { link.click(); status.textContent = filename; }
      finally {
        link.remove();
        const timer = window.setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 30_000);
        downloads.set(url, timer);
      }
    } catch (failure) { presentError(failure); }
  }
  // Base owns no derived index. Member changes and index completion invalidate
  // every open view, including embeds. Coalesce one event burst and let the
  // generation/AbortController discard stale in-flight derivations.
  let refreshQueued = false;
  const memberChanged = () => {
    writeEpoch++;
    if (destroyed || !source || refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      if (!destroyed) void reload(false);
    });
  };
  void readPropertyTypes();
  const stopEvents = [
    onEvent("setting_changed", (event) => { if (event.key === PROPERTY_TYPES_KEY) void readPropertyTypes(); }),
    onEvent("document_changed", (event) => { if (!event.changes || event.changes.aspects.length) memberChanged(); }),
    onEvent("document_removed", memberChanged),
    onEvent("document_renamed", memberChanged),
    onEvent("index_updated", memberChanged),
    onEvent("batch_ended", memberChanged),
    onEvent("overflow", memberChanged),
  ];
  const relabel = () => {
    groupBy.setAttribute("aria-label", t("base.group.by"));
    groupOrder.setAttribute("aria-label", t("base.group.order"));
    if (plan) fillGroupBy();
    toolbar.relabel();
    if (!error && rows.length) draw();
  };
  const stopLanguage = onLanguage(relabel);
  relabel();
  groupBy.addEventListener("change", () => {
    const view = plan?.view;
    if (!view) return;
    const choice = groupBy.value;
    groupChoices.set(view, choice);
    persistQueue = persistQueue.then(() => destroyed ? undefined : deps.setViewState(`base.group:${context.documentId}:${view}`, choice)).catch(presentError);
    fillGroupBy();
    draw();
  });
  groupOrder.addEventListener("change", () => {
    const view = plan?.view;
    const order = groupOrder.value;
    if (!view || (order !== "rows" && order !== "asc" && order !== "desc")) return;
    groupOrders.set(view, order);
    persistQueue = persistQueue.then(() => destroyed ? undefined : deps.setViewState(`base.group-order:${context.documentId}:${view}`, order)).catch(presentError);
    draw();
  });

  // Il tasto destro: la riga o la scheda sotto il puntatore (la sua nota), la
  // cella (il suo valore), l'intestazione (la sua colonna), o la vista intera.
  // Le scritture passano dalla stessa via CAS dei campi.
  const copy = (text: string): void => {
    void writeClipboardText(text).then(() => { status.textContent = t("editor_menu.copied"); }, presentError);
  };
  const searchFor = (text: string): void => { search.value = text; displayed = VISIBLE_STEP; draw(); toolbar.openSearch(); };
  const viewItems = (): SurfaceMenuItem[] => {
    const items: SurfaceMenuItem[] = [];
    if (names.length > 1) {
      items.push({
        id: "base.view",
        label: labels().view,
        items: names.map((name) => ({
          id: `base.view.${name}`,
          label: name,
          checked: name === activeView,
          run: () => chooseView(name),
        })),
      });
    }
    items.push(
      { id: "base.note.new", label: t("explorer.new.hint"), enabled: !readOnly, run: () => void createNote() },
      { id: "base.csv.copy", label: t("base.csv.copy"), run: () => void copyResults() },
      { id: "base.csv.export", label: t("base.csv.export"), run: exportResults },
    );
    return items;
  };
  const menuAt = (at: { x: number; y: number } | null): SurfaceMenu | null => {
    if (!plan || error) return null;
    const under = at ? document.elementFromPoint(at.x, at.y) : document.activeElement;
    if (!(under instanceof Element) || !root.contains(under)) return null;
    // Un campo con del testo scelto tiene il menu del sistema: taglia, incolla,
    // il correttore. Senza scelta vale il menu della cella.
    if (under instanceof HTMLInputElement && under.type === "text" && under.selectionStart !== under.selectionEnd) return null;
    if (under instanceof HTMLSelectElement || under === search) return null;
    if (!body.contains(under)) return null;
    // L'intestazione: le stesse voci del clic, nello stesso ordine.
    const header = under.closest<HTMLElement>("th[data-column]");
    if (header) {
      const column = header.dataset.column!;
      const entries = columnEntries(column) ?? [];
      return { target: { kind: "column", ref: column, name: labelOf(column) }, context: columnSurfaceItems(entries), tail: viewItems() };
    }
    const doc = under.closest<HTMLElement>("[data-doc]")?.dataset.doc;
    const row = doc === undefined ? undefined : rows.find((each) => each.doc === doc);
    if (!row) return { target: { kind: "empty" }, context: viewItems() };
    const items: SurfaceMenuItem[] = [
      { id: "base.row.open", label: t("base_menu.open"), run: () => open(row.doc) },
      { id: "base.row.copy_link", label: t("base_menu.copy_link"), run: () => copy(`[[${row.doc.replace(/\.md$/i, "")}]]`) },
      {
        id: "base.row.copy",
        label: t("base_menu.row.copy"),
        run: () => copy([row.doc, ...(plan?.columns ?? []).map((column) => cellText(row.values[column]))].join("\t")),
      },
    ];
    const column = under.closest<HTMLElement>(".base-cell[data-column]")?.dataset.column;
    if (column !== undefined) {
      const value = cellText(row.values[column]);
      const writable = !readOnly && !column.startsWith("formula.") && !column.startsWith("file.") && row.values[column]?.kind !== "error";
      items.unshift(
        { id: "base.cell.copy", label: t("base_menu.cell.copy"), enabled: value !== "", run: () => copy(value) },
        { id: "base.cell.search", label: t("base_menu.cell.search"), enabled: value !== "", run: () => searchFor(value) },
        { id: "base.cell.clear", label: t("base_menu.cell.clear"), enabled: writable && value !== "", danger: true, run: () => void editCell(row, column, null) },
      );
    }
    return {
      target: column === undefined ? { kind: "row", ref: row.doc } : { kind: "cell", ref: column },
      context: items,
      note: /\.md$/i.test(row.doc) ? { kind: "note", id: row.doc } : { kind: "file", id: row.doc },
      tail: viewItems(),
    };
  };
  const modes = baseSurfaceModes();
  return {
    family: "structured", profile: "base", surfaceId: context.paneId, modes,
    setMode(mode: string) { if (!modes.some((candidate) => candidate.id === mode)) throw new RangeError(`surface mode ${mode} is not supported`); root.dataset.surfaceMode = mode; },
    buffer: {
      setDoc(text: string) { sourceArrived(text); source = text; void reload(true); },
      syncDoc(update: DocumentUpdate | string) { const next = typeof update === "string" ? update : update.text; if (next !== source) { sourceArrived(next); source = next; void reload(true); } },
      getDoc() { return source; },
    },
    focus() {
      if (!toolbar.searchRow.hidden) { search.focus(); return; }
      (toolbar.bar.querySelector<HTMLElement>('button[tabindex="0"]') ?? toolbar.bar.querySelector<HTMLElement>("button"))?.focus();
    },
    contextMenu: menuAt,
    cellSelection,
    setReadOnly(next: boolean) {
      if (readOnly === next) return;
      if (next) { writeEpoch++; toolbar.closePopover(); }
      readOnly = next;
      root.dataset.readOnly = String(next);
      pushModel();
      draw();
    },
    setTheme(theme: Theme) { root.dataset.theme = theme; },
    destroy() {
      closeMenus();
      destroyed = true; generation++; pending?.abort(); tileCleanup?.(); cellListeners.clear();
      window.clearTimeout(settleTimer);
      for (const [timer, withdraw] of undoGraces) { window.clearTimeout(timer); withdraw(); }
      undoGraces.clear();
      toolbar.destroy();
      for (const stop of stopEvents) stop();
      for (const [url, timer] of downloads) { window.clearTimeout(timer); URL.revokeObjectURL(url); }
      downloads.clear();
      stopLanguage(); root.removeEventListener("keydown", undoKey); root.remove();
    },
  };
}

/// Una Base incorporata in una nota, da un blocco ```` ```base ```` o da un
/// `![[Nome.base]]`: la stessa superficie e le stesse porte di un `.base`
/// aperto. La monta la resa registrata da `renderer.ts` quando questo modulo
/// è arrivato; `vault` è quello in cui la resa è partita (FUB-001). Torna come
/// smontarla, o niente se il payload non è una Base.
export function mountBaseEmbed(host: HTMLElement, payload: unknown, context: CustomRenderContext, vault: string | undefined, onOpenDocument: (doc: string) => void | Promise<void>, documentWrites?: BaseDocumentWrites): (() => void) | undefined {
  const parsed = parseBaseEmbed({ node: "custom", ns: BASE_RENDERER_NS, payload, fallback: [] });
  if (!parsed) return;
  // Una base incorporata deriva `file.*` dalla nota che la contiene, non dal
  // suo path `.base`: la nota la dice chi monta la resa.
  const embed = { ...parsed, container: context.container ?? parsed.container };
  let disposed = false;
  // La revisione del file `.base` letto: i gesti della barra la confrontano.
  let revision: string | null = null;
  const surface = mountBaseSurface("base", {
    paneId: `base:embed:${crypto.randomUUID()}`,
    documentId: embed.base ?? embed.container ?? "",
    parent: host,
  }, {
    queryIndex: (query) => api.queryIndex(query, ...vaultArg(vault)),
    invokeCommand: (command, args, mode) => api.invokeCommand(command, args, mode, ...vaultArg(vault)),
    viewState: api.viewState,
    setViewState: api.setViewState,
    onOpenDocument,
    revision: () => revision,
    documentWrites,
    propertyTypes: vaultPropertyTypes,
  }, { view: embed.view, persistSelection: false, container: embed.container ?? embed.base ?? null, sourceInNote: embed.source !== undefined });
  // La scatola della Base dentro una nota sta in colonna col testo (la pelle).
  host.querySelector<HTMLElement>(":scope > .base-surface")?.setAttribute("data-embedded", "true");
  if (embed.source !== undefined) {
    surface.buffer.setDoc(embed.source);
    return () => { disposed = true; surface.destroy(); };
  }
  // Una Base da file si rilegge quando il file cambia: un gesto della sua
  // barra, un'altra finestra, il sorgente. Una lettura vecchia che arriva
  // dopo una nuova non la sovrascrive.
  let reading = 0;
  let loaded = false;
  const read = (): void => {
    const ticket = ++reading;
    api.readDocument(embed.base!, vault).then((document) => {
      if (disposed || ticket !== reading) return;
      revision = document.revision;
      if (!loaded) { loaded = true; surface.buffer.setDoc(document.text); }
      else surface.buffer.syncDoc(document.text);
    }, (error: unknown) => {
      if (disposed || ticket !== reading || loaded) return;
      disposed = true;
      stopChanges();
      surface.destroy();
      host.textContent = errorText(error);
    });
  };
  const stopChanges = onEvent("document_changed", (event) => { if (event.id === embed.base) read(); });
  read();
  return () => { disposed = true; stopChanges(); surface.destroy(); };
}
