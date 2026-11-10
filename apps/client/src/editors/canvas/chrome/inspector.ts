// L'ispettore della lavagna (T58): le schede che la lavagna porta
// nell'ispettore dello Scrittoio (`EditorSurface.panels`), come fa il disegno
// con `inspectorChrome`. La shell mette la testata, le linguette e il titolo
// del pannello; qui c'è il contenuto.
//
// Le parti: «Schede», tutte le schede in ordine di lettura (`reading-order.ts`),
// coi gruppi come cartelle, filtrabili per nome e per specie; un clic (o Invio)
// porta la vista sulla scheda e la sceglie, ed è anche il percorso del lettore
// di schermo. «Scheda» (i numeri, il colore, il file e «Avanzate», il nodo
// grezzo) e «Fili» (l'etichetta, le punte, i lati, l'inversione) T59: nascono
// solo con la porta `edit`, che la tela non dà ancora. «Fonti» arriva con T77.
//
// Le modifiche non le fa l'ispettore: chiede alla tela (`CanvasEditPort`) la
// scelta, il modello e un commit di toppe. Il commit è quello del nucleo di N3
// e il suo annulla sta nel motore.
//
// L'ispettore legge il documento (il testo della lavagna) e chiama la tela
// per il salto: non tocca il motore. Il salto passa dalla strada che la
// superficie ha già per portare la vista su una scheda (`revealSource`), che
// vuole il byte dove comincia l'oggetto della scheda nel sorgente: lo trova
// `boardCards`, leggendo il testo come lo legge il nucleo (`node_at`).
//
// L'elenco si rilegge quando la lavagna cambia, cioè a fine gesto (ogni
// commit) o quando arriva un testo nuovo. Oltre `VIRTUAL_AFTER` righe si
// disegnano solo quelle che si vedono, come i Livelli del disegno.

import type { SurfacePanel, SurfacePanels } from "../../core/registry";
import { onLanguage, t, type Key } from "../../../i18n/strings";
import { identifier } from "../../../ui/a11y";
import { iconEl } from "../../../ui/icons";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { createColorPicker, numberField, openPopover, type NumberField, type PopoverHandle } from "../../../kit";
import { cardKindOf } from "../cards";
import { colorChoiceOf, colorLook, colorMenuLabel, colorName, colorValueOf, NOTE_COLORS, writeColor, type CanvasColorChoice } from "../colors";
import { DROP_MIN_SIZE } from "../drop-layout";
import type { CanvasDocument, CanvasEdge, CanvasEdgeSide, CanvasNode } from "../model";
import { upsertEdgePatch, upsertNodePatch, type CanvasPatch } from "../operation";
import { pickerText } from "../pen-menu";
import { readingOrder, type ReadingEntry } from "../reading-order";
import { rawFields, setRawField, type RawProblem } from "./raw-node";
import { ensureCanvasIcons } from "./icons";

/** L'id della linguetta «Schede»: l'ispettore lo ricorda. */
export const CARDS_PANEL_ID = "canvas.cards";
/** L'id della linguetta «Scheda» (T59). */
export const CARD_PANEL_ID = "canvas.card";
/** L'id della linguetta «Fili» (T59). */
export const EDGE_PANEL_ID = "canvas.edge";

/** Oltre queste righe l'elenco disegna solo quelle che si vedono. */
export const VIRTUAL_AFTER = 500;

/** Le righe disegnate oltre quelle che si vedono, sopra e sotto. */
const OVERSCAN = 8;

/** Le righe che si disegnano quando l'elenco non ha ancora una misura. */
const VISIBLE_FALLBACK = 40;

/** Il passo di una riga quando non si può misurare: `--row-h` e il filo fra due righe. */
const ROW_STEP_FALLBACK = 29;

/** Il filo fra due righe (`gap` dell'elenco). */
const ROW_GAP = 1;

/** Fin dove l'elenco rientra: oltre, i gruppi più interni stanno al quarto rientro. */
const MAX_DEPTH = 4;

/** Quanto è lungo, al più, il nome di una riga: il resto lo taglia la pelle coi puntini. */
const NAME_MAX = 200;

/** Le specie del filtro, nell'ordine del menu. */
export const INSPECTOR_KINDS = ["all", "note", "text", "group", "pdf"] as const;
export type InspectorKind = (typeof INSPECTOR_KINDS)[number];

/** Le schede di una lavagna lette dal suo testo, con il byte dove comincia ciascuna. */
export interface BoardCards {
  readonly nodes: readonly CanvasNode[];
  /** Per ogni scheda, il byte (UTF-8, BOM compreso) dove comincia il suo oggetto. */
  readonly starts: readonly number[];
}

// --- la lettura del testo -------------------------------------------------------

const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);

/** Dopo gli spazi JSON da `at`. */
function skipBlank(text: string, at: number): number {
  while (at < text.length && WHITESPACE.has(text[at]!)) at++;
  return at;
}

/** La fine di una stringa JSON che comincia a `at` (sulle virgolette), o -1. */
function stringEnd(text: string, at: number): number {
  for (let i = at + 1; i < text.length; i++) {
    const char = text[i];
    if (char === "\\") i++;
    else if (char === "\"") return i + 1;
  }
  return -1;
}

/** La fine del valore JSON che comincia a `at`, o -1 se non si legge. */
function valueEnd(text: string, at: number): number {
  const first = text[at];
  if (first === "\"") return stringEnd(text, at);
  if (first === "{" || first === "[") {
    let depth = 0;
    for (let i = at; i < text.length; i++) {
      const char = text[i];
      if (char === "\"") {
        const end = stringEnd(text, i);
        if (end < 0) return -1;
        i = end - 1;
      } else if (char === "{" || char === "[") depth++;
      else if (char === "}" || char === "]") {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
    return -1;
  }
  let i = at;
  while (i < text.length && !WHITESPACE.has(text[i]!) && text[i] !== "," && text[i] !== "}" && text[i] !== "]") i++;
  return i > at ? i : -1;
}

/** Gli oggetti dell'array `nodes` della radice: dove comincia e finisce ciascuno, in caratteri. */
function nodeSpans(text: string): [number, number][] | null {
  let at = skipBlank(text, text.startsWith("﻿") ? 1 : 0);
  if (text[at] !== "{") return null;
  at = skipBlank(text, at + 1);
  if (text[at] === "}") return [];
  for (;;) {
    if (text[at] !== "\"") return null;
    const keyEnd = stringEnd(text, at);
    if (keyEnd < 0) return null;
    const key: unknown = JSON.parse(text.slice(at, keyEnd));
    at = skipBlank(text, keyEnd);
    if (text[at] !== ":") return null;
    at = skipBlank(text, at + 1);
    const end = valueEnd(text, at);
    if (end < 0) return null;
    // La prima chiave `nodes`, come il nucleo (`node_at`).
    if (key === "nodes") return text[at] === "[" ? arrayItems(text, at) : null;
    at = skipBlank(text, end);
    if (text[at] === "}") return [];
    if (text[at] !== ",") return null;
    at = skipBlank(text, at + 1);
  }
}

/** Gli elementi dell'array che comincia a `at`. */
function arrayItems(text: string, at: number): [number, number][] | null {
  const items: [number, number][] = [];
  at = skipBlank(text, at + 1);
  if (text[at] === "]") return items;
  for (;;) {
    const end = valueEnd(text, at);
    if (end < 0) return null;
    items.push([at, end]);
    at = skipBlank(text, end);
    if (text[at] === "]") return items;
    if (text[at] !== ",") return null;
    at = skipBlank(text, at + 1);
  }
}

/** I byte UTF-8 dei caratteri `at` (in ordine crescente) contati dall'inizio del testo. */
function utf8Offsets(text: string, at: readonly number[]): number[] {
  const out: number[] = [];
  let bytes = 0;
  let next = 0;
  for (let i = 0; i < text.length && next < at.length; i++) {
    while (next < at.length && at[next] === i) {
      out.push(bytes);
      next++;
    }
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      // Una coppia di surrogati è un carattere solo, di quattro byte.
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  while (next++ < at.length) out.push(bytes);
  return out;
}

/** Una scheda che si può mettere in elenco: un id, una specie, un rettangolo. */
function isCard(value: unknown): value is CanvasNode {
  if (typeof value !== "object" || value === null) return false;
  const node = value as Record<string, unknown>;
  return typeof node.id === "string" && ["text", "file", "link", "group"].includes(node.type as string)
    && [node.x, node.y, node.width, node.height].every((each) => typeof each === "number" && Number.isFinite(each));
}

/**
 * Le schede della lavagna `source` nell'ordine dell'array del file, ognuna col
 * byte dove comincia il suo oggetto: è il byte che `revealSource` della tela
 * porta alla scheda. `null` se il testo non è una lavagna che si legge. Una
 * voce che non è una scheda (senza id o senza rettangolo) si salta.
 */
export function boardCards(source: string): BoardCards | null {
  const spans = nodeSpans(source);
  if (spans === null) return null;
  const nodes: CanvasNode[] = [];
  const at: number[] = [];
  for (const [start, end] of spans) {
    let value: unknown;
    try {
      value = JSON.parse(source.slice(start, end));
    } catch {
      return null;
    }
    if (!isCard(value)) continue;
    nodes.push(value);
    at.push(start);
  }
  return { nodes, starts: utf8Offsets(source, at) };
}

// --- come si chiama una scheda ----------------------------------------------------

/** Il nome di un file senza le cartelle e, per una nota, senza `.md`. */
function fileTitle(file: string): string {
  const hash = file.indexOf("#");
  const path = hash < 0 ? file : file.slice(0, hash);
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.(md|markdown)$/i, "");
}

/**
 * Il nome di una scheda nell'elenco: l'etichetta di un gruppo, la prima riga
 * di un testo (senza i `#` di un titolo), il file senza le cartelle (una nota
 * anche senza `.md`), l'host di una pagina web. `""` se non ne ha.
 */
export function cardName(node: CanvasNode): string {
  let name = "";
  if (node.type === "group") name = typeof node.label === "string" ? node.label : "";
  else if (node.type === "text") {
    const line = (typeof node.text === "string" ? node.text : "").split("\n").map((each) => each.trim()).find(Boolean) ?? "";
    name = line.replace(/^#{1,6}\s+/, "");
  } else if (node.type === "file") name = fileTitle(typeof node.file === "string" ? node.file : "");
  else {
    const url = typeof node.url === "string" ? node.url : "";
    try {
      name = new URL(url).host || url;
    } catch {
      name = url;
    }
  }
  name = name.trim();
  return name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1).trimEnd()}…` : name;
}

/** La specie di una scheda come la dice la riga: `null` per un gruppo. */
export function cardKindName(node: CanvasNode): string | null {
  if (node.type === "group") return null;
  if (node.type === "text") return t("canvas.kind.text");
  switch (cardKindOf(node)) {
    case "note":
      return t("canvas.kind.note");
    case "document":
      return t("canvas.kind.document");
    case "sheet":
      return t("canvas.kind.sheet");
    case "pdf":
      return t("canvas.kind.pdf");
    case "image":
      return t("canvas.kind.image");
    case "web":
      return t("canvas.kind.web");
    case "craft":
      return t("canvas.kind.craft");
    default:
      return t("canvas.kind.file");
  }
}

/** La figura di una riga. */
function rowIcon(node: CanvasNode): string {
  if (node.type === "group") return "draw-group";
  if (node.type === "text") return "fmt-text";
  switch (cardKindOf(node)) {
    case "document":
      return "format-word";
    case "sheet":
      return "format-sheet";
    case "image":
      return "format-photo";
    case "craft":
      return "format-drawing";
    default:
      return "notes";
  }
}

/** La scheda è della specie `kind` del filtro. */
export function matchesKind(node: CanvasNode, kind: InspectorKind): boolean {
  switch (kind) {
    case "all":
      return true;
    case "group":
    case "text":
      return node.type === kind;
    case "note":
    case "pdf":
      return cardKindOf(node) === kind;
  }
}

/**
 * Le righe che restano col filtro: le schede col nome che contiene `query`
 * (senza badare a maiuscole e accenti) e della specie `kind`, coi gruppi che
 * le contengono, perché si capisca dove stanno. Senza filtro, tutte.
 */
export function filterEntries(entries: readonly ReadingEntry[], query: string, kind: InspectorKind): ReadingEntry[] {
  const needle = fold(query.trim());
  if (needle === "" && kind === "all") return [...entries];
  const byId = new Map(entries.map((entry) => [entry.node.id, entry]));
  const keep = new Set<ReadingEntry>();
  for (const entry of entries) {
    if (!matchesKind(entry.node, kind) || !fold(cardName(entry.node)).includes(needle)) continue;
    keep.add(entry);
    for (let up = entry.parent === null ? undefined : byId.get(entry.parent); up && !keep.has(up); up = up.parent === null ? undefined : byId.get(up.parent)) keep.add(up);
  }
  return entries.filter((entry) => keep.has(entry));
}

/** Il testo per il confronto: minuscolo e senza accenti. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
}

// --- l'ispettore ------------------------------------------------------------------

/** La scelta della lavagna adesso: le id delle schede e dei fili scelti. */
export interface CanvasSelection {
  readonly nodes: readonly string[];
  readonly edges: readonly string[];
}

/**
 * Ciò che le parti «Scheda» e «Fili» chiedono alla tela (T59). Senza, l'ispettore
 * offre solo «Schede». Il commit è un solo passo del nucleo di N3, col suo
 * annulla: l'ispettore non scrive il file da sé.
 */
export interface CanvasEditPort {
  readonly selection: () => CanvasSelection;
  /** Il modello della lavagna adesso; `null` senza lavagna. */
  readonly doc: () => CanvasDocument | null;
  /** Le toppe, mai vuote: un commit solo, col suo annulla. */
  readonly commit: (patches: readonly CanvasPatch[]) => void;
  /** Vero in sola lettura: tutto si legge, niente si cambia. */
  readonly readOnly: () => boolean;
}

/** Ciò che l'ispettore chiede alla superficie. */
export interface CanvasInspectorPort {
  /** Il testo della lavagna adesso; `null` senza lavagna. */
  readonly source: () => string | null;
  /**
   * Porta la vista sulla scheda il cui oggetto comincia al byte `byte` e la
   * sceglie (`revealSource` della tela). `false` se non ci arriva.
   */
  readonly reveal: (byte: number) => boolean;
  /** La scelta e le modifiche per «Scheda» e «Fili» (T59); senza, solo «Schede». */
  readonly edit?: CanvasEditPort;
}

export interface CanvasInspector {
  /** Le linguette della lavagna nell'ispettore (`EditorSurface.panels`). */
  readonly panels: SurfacePanels;
  /** La lavagna c'è e si guarda (non il sorgente): le linguette si offrono. */
  offer(on: boolean): void;
  /** La lavagna è cambiata (fine di un gesto, un testo nuovo): l'elenco si rilegge. */
  changed(): void;
  /** La scelta della lavagna è cambiata. */
  selectionChanged(): void;
  /** La superficie se ne va: niente più linguette, niente più avvisi. */
  dispose(): void;
}

/** Un elenco montato in una linguetta. */
interface Mounted {
  refresh(): void;
  mark(): void;
}

/** Le schede lette l'ultima volta. */
interface Read {
  readonly entries: readonly ReadingEntry[];
  /** Il byte di ogni scheda, per la sua posizione nell'array. */
  readonly starts: readonly number[];
}

export function createCanvasInspector(port: CanvasInspectorPort): CanvasInspector {
  const listeners = new Set<() => void>();
  const reveals = new Set<(id: string) => void>();
  const mounted = new Set<Mounted>();
  let offered = false;
  let disposed = false;
  let read: Read | null = null;
  let stale = true;
  /// La scheda scelta dall'elenco, finché la scelta della lavagna non cambia
  /// per un'altra strada.
  let picked: string | null = null;
  /// Vera mentre il salto chiesto dall'elenco cambia la scelta.
  let picking = false;

  const current = (): Read => {
    if (!stale && read) return read;
    stale = false;
    const source = port.source();
    const cards = source === null ? null : boardCards(source);
    read = cards ? { entries: readingOrder(cards.nodes), starts: cards.starts } : { entries: [], starts: [] };
    return read;
  };

  const jump = (entry: ReadingEntry): void => {
    const start = current().starts[entry.index];
    if (start === undefined) return;
    picking = true;
    try {
      if (port.reveal(start)) picked = entry.node.id;
    } finally {
      picking = false;
    }
    for (const view of mounted) view.mark();
  };

  const tab: SurfacePanel = {
    id: CARDS_PANEL_ID,
    title: () => t("canvas.inspector.cards"),
    icon: "outline",
    mount(host) {
      if (disposed) return () => {};
      const view = mountCards(host, { entries: () => current().entries, picked: () => picked, jump });
      mounted.add(view.handle);
      return () => {
        mounted.delete(view.handle);
        view.unmount();
      };
    },
  };

  /// «Scheda» e «Fili» (T59): montano chi sta scelto, e se non c'è niente da
  /// scegliere non si offrono.
  const editing = (mountPart: (host: HTMLElement, edit: CanvasEditPort) => { readonly handle: Mounted; unmount(): void }): ((host: HTMLElement) => () => void) => (host) => {
    const edit = port.edit;
    if (disposed || !edit) return () => {};
    const view = mountPart(host, edit);
    mounted.add(view.handle);
    return () => {
      mounted.delete(view.handle);
      view.unmount();
    };
  };
  const card: SurfacePanel = { id: CARD_PANEL_ID, title: () => t("canvas.inspector.card"), icon: "properties", mount: editing(mountCard) };
  const edge: SurfacePanel = { id: EDGE_PANEL_ID, title: () => t("canvas.inspector.edges"), icon: "canvas-connect", mount: editing(mountEdge) };

  /// Le linguette che si offrono adesso: «Schede», poi «Scheda» se c'è una
  /// scheda scelta, «Fili» se c'è un filo scelto.
  const tabs = (): SurfacePanel[] => {
    const out = [tab];
    if (!port.edit) return out;
    const { nodes, edges } = chosenOf(port.edit);
    if (nodes.length > 0) out.push(card);
    if (edges.length > 0) out.push(edge);
    return out;
  };

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  /// La lista delle linguette è cambiata: lo dice la shell, una volta sola.
  let announced = "";
  const announce = (): void => {
    const key = offered && !disposed ? tabs().map((each) => each.id).join(" ") : "";
    if (key === announced) return;
    announced = key;
    notify();
  };

  return {
    panels: {
      list: () => (offered && !disposed ? tabs() : []),
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      onShow(listener) {
        reveals.add(listener);
        return () => reveals.delete(listener);
      },
      // I titoli, le note a piè di pagina e le proprietà di una nota non
      // dicono niente di una lavagna, come di un disegno.
      covers: ["outline", "footnotes", "properties"],
    },
    offer(on) {
      if (disposed || on === offered) return;
      offered = on;
      announce();
    },
    changed() {
      stale = true;
      announce();
      if (mounted.size === 0) return;
      for (const view of mounted) view.refresh();
    },
    selectionChanged() {
      if (!picking && picked !== null) picked = null;
      announce();
      for (const view of mounted) view.mark();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      offered = false;
      announced = "";
      notify();
      listeners.clear();
      reveals.clear();
      read = null;
    },
  };
}

// --- la parte «Schede» ----------------------------------------------------------

interface CardsPort {
  readonly entries: () => readonly ReadingEntry[];
  readonly picked: () => string | null;
  readonly jump: (entry: ReadingEntry) => void;
}

/** Disegna «Schede» dentro `host`: il filtro, il titoletto, l'elenco. */
function mountCards(host: HTMLElement, port: CardsPort): { readonly handle: Mounted; unmount(): void } {
  ensureCanvasIcons();
  const life = openLifetime();
  const doc = host.ownerDocument;
  const box = doc.createElement("div");
  box.className = "canvas-inspector";
  box.dataset.part = "cards";

  const filter = doc.createElement("div");
  filter.className = "canvas-inspector-filter";
  const search = doc.createElement("input");
  search.type = "search";
  search.autocomplete = "off";
  search.spellcheck = false;
  const kind = doc.createElement("select");
  for (const each of INSPECTOR_KINDS) {
    const option = doc.createElement("option");
    option.value = each;
    kind.append(option);
  }
  filter.append(search, kind);

  const heading = doc.createElement("h3");
  heading.className = "canvas-inspector-heading";
  heading.id = identifier("canvas-inspector-order");
  const list = doc.createElement("div");
  list.className = "canvas-inspector-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-labelledby", heading.id);
  list.tabIndex = -1;
  const note = doc.createElement("p");
  note.className = "canvas-inspector-note";
  note.hidden = true;
  box.append(filter, heading, list, note);
  host.append(box);

  /// Le righe dopo il filtro, e quelle disegnate adesso per posizione.
  let shown: ReadingEntry[] = [];
  let drawn = new Map<number, HTMLElement>();
  /// La riga che tiene il fuoco dell'elenco (per id): una sola, come nel kit.
  let active: string | null = null;
  let step = ROW_STEP_FALLBACK;

  const label = (): void => {
    search.placeholder = t("canvas.inspector.filter");
    search.setAttribute("aria-label", t("canvas.inspector.filter"));
    kind.setAttribute("aria-label", t("canvas.inspector.kind"));
    for (const option of kind.options) option.textContent = t(`canvas.inspector.kind.${option.value as InspectorKind}`);
    heading.textContent = t("canvas.inspector.order");
  };

  const virtual = (): boolean => shown.length > VIRTUAL_AFTER;

  const rowOf = (entry: ReadingEntry, at: number): HTMLElement => {
    const row = doc.createElement("div");
    row.className = "canvas-inspector-row";
    row.setAttribute("role", "option");
    row.dataset.node = entry.node.id;
    row.dataset.at = String(at);
    row.dataset.depth = String(Math.min(entry.depth, MAX_DEPTH));
    if (entry.node.type === "group") row.dataset.group = "";
    const figure = iconEl(rowIcon(entry.node));
    if (figure) {
      figure.setAttribute("aria-hidden", "true");
      row.append(figure);
    }
    const name = doc.createElement("span");
    name.className = "canvas-inspector-name";
    name.textContent = cardName(entry.node) || t("canvas.inspector.unnamed");
    row.append(name);
    const kindName = cardKindName(entry.node);
    if (kindName !== null) {
      const tag = doc.createElement("span");
      tag.className = "canvas-inspector-kind";
      tag.textContent = kindName;
      row.append(tag);
    }
    // Nell'elenco virtuale le righe non sono tutte: chi legge con la voce
    // sente comunque dove sta.
    if (virtual()) {
      row.setAttribute("aria-setsize", String(shown.length));
      row.setAttribute("aria-posinset", String(at + 1));
    }
    return row;
  };

  /// Dove sta la fermata del Tab: la riga attiva se c'è ancora, se no la prima.
  const stopAt = (): number => {
    const at = active === null ? -1 : shown.findIndex((entry) => entry.node.id === active);
    return at >= 0 ? at : shown.length > 0 ? 0 : -1;
  };

  /// La scelta e il fuoco sulle righe disegnate.
  const mark = (): void => {
    const picked = port.picked();
    const focusable = shown[stopAt()]?.node.id ?? null;
    for (const row of drawn.values()) {
      row.setAttribute("aria-selected", String(row.dataset.node === picked));
      row.tabIndex = row.dataset.node === focusable ? 0 : -1;
    }
  };

  /// Le posizioni da disegnare: tutte, o quelle che si vedono più la riga attiva.
  const windowOf = (): number[] => {
    if (!virtual()) return shown.map((_, at) => at);
    const rect = list.getBoundingClientRect();
    const view = scrollerOf(list);
    const top = view ? view.getBoundingClientRect().top : 0;
    const bottom = view ? view.getBoundingClientRect().bottom : (doc.defaultView?.innerHeight ?? 0);
    const seen = bottom - top;
    const first = seen > 0 ? Math.max(0, Math.floor((top - rect.top) / step) - OVERSCAN) : 0;
    const count = seen > 0 ? Math.ceil(seen / step) + 2 * OVERSCAN : VISIBLE_FALLBACK;
    const last = Math.min(shown.length - 1, first + count);
    const out: number[] = [];
    for (let at = first; at <= last; at++) out.push(at);
    // La fermata del Tab resta disegnata anche fuori dalla finestra: senza,
    // l'elenco scorso non si raggiungerebbe più da tastiera.
    const current = stopAt();
    if (current >= 0 && (current < first || current > last)) out.push(current);
    return out;
  };

  /// Disegna le righe della finestra, tenendo quelle che c'erano già.
  const paint = (): void => {
    const big = virtual();
    list.toggleAttribute("data-virtual", big);
    list.style.height = big ? `${shown.length * step}px` : "";
    const next = new Map<number, HTMLElement>();
    const rows = windowOf().map((at) => {
      const row = drawn.get(at) ?? rowOf(shown[at]!, at);
      row.style.top = big ? `${at * step}px` : "";
      next.set(at, row);
      return row;
    });
    for (const [at, row] of drawn) if (!next.has(at)) row.remove();
    drawn = next;
    rows.forEach((row, index) => {
      if (list.children[index] !== row) list.insertBefore(row, list.children[index] ?? null);
    });
    mark();
  };

  /// Rilegge le schede e il filtro, e rifà le righe da capo.
  const refresh = (): void => {
    if (life.closed) return;
    const all = port.entries();
    shown = filterEntries(all, search.value, kind.value as InspectorKind);
    const hadFocus = list.contains(doc.activeElement);
    for (const row of drawn.values()) row.remove();
    drawn = new Map();
    // Il passo di una riga: la misura di una riga vera, quando c'è.
    if (shown.length > VIRTUAL_AFTER && shown[0]) {
      const probe = rowOf(shown[0], 0);
      list.append(probe);
      const height = probe.getBoundingClientRect().height;
      probe.remove();
      step = height > 0 ? height + ROW_GAP : ROW_STEP_FALLBACK;
    }
    note.hidden = shown.length > 0;
    note.textContent = all.length === 0 ? t("canvas.inspector.empty") : t("canvas.inspector.none_found");
    paint();
    // Le righe sono nuove: il fuoco che stava nell'elenco torna alla sua fermata.
    if (hadFocus) drawn.get(stopAt())?.focus({ preventScroll: true });
  };

  /// Porta il fuoco sulla riga `at` dell'elenco, disegnandola se serve.
  const focusAt = (at: number): void => {
    const entry = shown[at];
    if (!entry) return;
    active = entry.node.id;
    if (virtual()) {
      const view = scrollerOf(list);
      if (view) {
        const rowTop = list.getBoundingClientRect().top + at * step;
        const viewRect = view.getBoundingClientRect();
        if (rowTop < viewRect.top) view.scrollTop -= viewRect.top - rowTop;
        else if (rowTop + step > viewRect.bottom) view.scrollTop += rowTop + step - viewRect.bottom;
      }
      paint();
    } else mark();
    const row = drawn.get(at);
    row?.focus({ preventScroll: virtual() });
    if (!virtual()) row?.scrollIntoView?.({ block: "nearest" });
  };

  const atOf = (target: EventTarget | null): number => {
    const row = target instanceof Element ? target.closest<HTMLElement>(".canvas-inspector-row") : null;
    return row && list.contains(row) ? Number(row.dataset.at) : -1;
  };

  life.listen(search, "input", refresh);
  life.listen(kind, "change", refresh);
  life.listen(list, "click", (event) => {
    const at = atOf(event.target);
    const entry = shown[at];
    if (!entry) return;
    active = entry.node.id;
    port.jump(entry);
  });
  life.listen(list, "focusin", (event) => {
    const at = atOf(event.target);
    if (at < 0 || shown[at]?.node.id === active) return;
    active = shown[at]!.node.id;
    mark();
  });
  life.listen(list, "keydown", (event) => {
    const at = atOf(event.target);
    if (at < 0 || event.ctrlKey || event.metaKey || event.altKey) return;
    const room = scrollerOf(list)?.clientHeight ?? 0;
    const page = room > 0 ? Math.max(1, Math.floor(room / step) - 1) : 10;
    let next: number;
    switch (event.key) {
      case "ArrowDown":
        next = Math.min(shown.length - 1, at + 1);
        break;
      case "ArrowUp":
        next = Math.max(0, at - 1);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = shown.length - 1;
        break;
      case "PageDown":
        next = Math.min(shown.length - 1, at + page);
        break;
      case "PageUp":
        next = Math.max(0, at - page);
        break;
      case "Enter":
      case " ": {
        event.preventDefault();
        const entry = shown[at];
        if (entry) port.jump(entry);
        return;
      }
      default:
        return;
    }
    event.preventDefault();
    focusAt(next);
  });
  // Un elenco lungo segue lo scorrimento di chi lo contiene, qualunque sia.
  life.listen(doc, "scroll", () => {
    if (virtual()) paint();
  }, { capture: true, passive: true });
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => {
      if (virtual()) paint();
    });
    observer.observe(host);
    life.add(() => observer.disconnect());
  }
  life.add(onLanguage(() => {
    label();
    refresh();
  }));
  life.add(() => box.remove());

  label();
  refresh();
  return {
    handle: { refresh, mark },
    unmount: () => life.close(),
  };
}

// --- la parte «Scheda» e «Fili» (T59) -------------------------------------------------

/** Un pezzo montato: il suo aggiornamento e la sua fine. */
interface Mount {
  readonly handle: Mounted;
  unmount(): void;
}

/** Le schede e i fili scelti, nell'ordine del documento; senza lavagna, niente. */
function chosenOf(edit: CanvasEditPort): { readonly nodes: CanvasNode[]; readonly edges: CanvasEdge[] } {
  const doc = edit.doc();
  if (doc === null) return { nodes: [], edges: [] };
  const picked = edit.selection();
  const nodeIds = new Set(picked.nodes);
  const edgeIds = new Set(picked.edges);
  return {
    nodes: doc.nodes.filter((node) => nodeIds.has(node.id)),
    edges: doc.edges.filter((edge) => edgeIds.has(edge.id)),
  };
}

/** Il valore che hanno tutti, o `null` se sono diversi (o non ce n'è nessuno). */
export function commonValue<T>(values: readonly T[]): T | null {
  const first = values[0];
  if (first === undefined) return null;
  return values.every((value) => value === first) ? first : null;
}

/** Le toppe che fanno `change` alle schede `ids`: una per scheda che cambia davvero. */
export function nodePatches(doc: CanvasDocument, ids: readonly string[], change: (node: CanvasNode) => CanvasNode): CanvasPatch[] {
  const patches: CanvasPatch[] = [];
  for (const id of ids) {
    const node = doc.nodes.find((each) => each.id === id);
    if (node === undefined) continue;
    const patch = upsertNodePatch(doc, change({ ...node }));
    if (patch !== null) patches.push(patch);
  }
  return patches;
}

/** Come `nodePatches`, per i fili `ids`. */
export function edgePatches(doc: CanvasDocument, ids: readonly string[], change: (edge: CanvasEdge) => CanvasEdge): CanvasPatch[] {
  const patches: CanvasPatch[] = [];
  for (const id of ids) {
    const edge = doc.edges.find((each) => each.id === id);
    if (edge === undefined) continue;
    const patch = upsertEdgePatch(doc, change({ ...edge }));
    if (patch !== null) patches.push(patch);
  }
  return patches;
}

/** Un commit solo sulle schede `ids`; niente se non cambia qualcosa o se è sola lettura. */
function writeNodes(edit: CanvasEditPort, ids: readonly string[], change: (node: CanvasNode) => CanvasNode): void {
  const doc = edit.doc();
  if (doc === null || edit.readOnly()) return;
  const patches = nodePatches(doc, ids, change);
  if (patches.length > 0) edit.commit(patches);
}

/** Come `writeNodes`, per i fili. */
function writeEdges(edit: CanvasEditPort, ids: readonly string[], change: (edge: CanvasEdge) => CanvasEdge): void {
  const doc = edit.doc();
  if (doc === null || edit.readOnly()) return;
  const patches = edgePatches(doc, ids, change);
  if (patches.length > 0) edit.commit(patches);
}

/** La scheda col colore `color` (`undefined`: quello di serie, il campo se ne va). */
export function withColor(node: CanvasNode, color: string | undefined): CanvasNode {
  const next = { ...node };
  if (color === undefined) delete next.color;
  else next.color = color;
  return next;
}

/** Il colore comune delle schede: `undefined` quello di serie, `null` se sono diversi. */
export function colorOf(nodes: readonly CanvasNode[]): string | undefined | null {
  const common = commonValue(nodes.map((node) => node.color ?? ""));
  if (common === null) return null;
  return common === "" ? undefined : common;
}

/** Le punte di un filo, come le sceglie «Punte». */
export type EdgeTips = "none" | "start" | "end";

/**
 * Le punte di un filo come le sceglie «Punte»; `null` se ne ha due, che la
 * scelta non dice. Senza `fromEnd` e `toEnd` il filo è come JSON Canvas lo
 * legge: nessuna punta all'inizio, una alla fine.
 */
export function tipsOf(edge: CanvasEdge): EdgeTips | null {
  const from = edge.fromEnd ?? "none";
  const to = edge.toEnd ?? "arrow";
  if (from === to) return from === "none" ? "none" : null;
  return from === "arrow" ? "start" : "end";
}

/** Il filo con le punte `tips`, scritte per intero da tutte e due le parti. */
export function withTips(edge: CanvasEdge, tips: EdgeTips): CanvasEdge {
  return { ...edge, fromEnd: tips === "start" ? "arrow" : "none", toEnd: tips === "end" ? "arrow" : "none" };
}

/** Le scelte di «Lato»: `auto` toglie il lato dal file. */
export type SideChoice = "auto" | CanvasEdgeSide;
export const SIDE_CHOICES: readonly SideChoice[] = ["auto", "top", "right", "bottom", "left"];

/** Il filo con il lato `side` di una sua estremità; `auto` lo toglie. */
export function withSide(edge: CanvasEdge, end: "from" | "to", side: SideChoice): CanvasEdge {
  const next = { ...edge };
  const key = end === "from" ? "fromSide" : "toSide";
  if (side === "auto") delete next[key];
  else next[key] = side;
  return next;
}

/** Il filo con la direzione invertita: le estremità scambiate, con le punte al loro posto. */
export function reversedEdge(edge: CanvasEdge): CanvasEdge {
  const next: CanvasEdge = {
    ...edge,
    fromNode: edge.toNode,
    toNode: edge.fromNode,
    fromEnd: edge.toEnd ?? "arrow",
    toEnd: edge.fromEnd ?? "none",
  };
  if (edge.toSide === undefined) delete next.fromSide;
  else next.fromSide = edge.toSide;
  if (edge.fromSide === undefined) delete next.toSide;
  else next.toSide = edge.fromSide;
  return next;
}

/** Il filo con l'etichetta `label`; il testo vuoto la toglie. */
export function withLabel(edge: CanvasEdge, label: string): CanvasEdge {
  const next = { ...edge };
  if (label === "") delete next.label;
  else next.label = label;
  return next;
}

/** Il valore del pozzo: `undefined` quello di serie, `null` se è misto. */
type WellValue = string | undefined | null;

interface ColorWell {
  readonly element: HTMLElement;
  setValue(value: WellValue): void;
  setDisabled(disabled: boolean): void;
}

/**
 * Il pozzo del colore della scheda (T47): un pulsante col colore e il suo
 * nome, che apre la lista delle scelte del menu della tela; «Altro…» mette il
 * selettore del kit nella stessa finestra. `write` riceve il colore da
 * scrivere, `undefined` per toglierlo.
 */
function colorWell(life: Lifetime, dom: Document, write: (color: string | undefined) => void, readOnly: () => boolean): ColorWell {
  let value: WellValue = undefined;
  let popover: PopoverHandle | null = null;

  const element = dom.createElement("div");
  element.className = "kit-color-well";
  const button = dom.createElement("button");
  button.type = "button";
  button.className = "kit-color-well-button";
  button.id = identifier("canvas-inspector-color");
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  const chip = dom.createElement("span");
  chip.className = "kit-color-chip";
  chip.setAttribute("aria-hidden", "true");
  const name = dom.createElement("span");
  button.append(chip, name);
  element.append(button);

  const paint = (): void => {
    chip.classList.toggle("none", value === undefined);
    chip.classList.toggle("mixed", value === null);
    const look = typeof value === "string" ? colorLook(value) : null;
    if (look) chip.dataset.canvasColor = look.key;
    else delete chip.dataset.canvasColor;
    if (look?.custom) chip.style.setProperty("--canvas-color", look.custom);
    else chip.style.removeProperty("--canvas-color");
    const shown = value === null ? t("canvas.inspector.color_mixed") : colorName(value);
    name.textContent = shown;
    button.setAttribute("aria-label", t("canvas.options.color_value", { name: shown }));
  };

  const close = (): void => {
    popover?.close();
  };

  const pick = (list: HTMLElement, own: Lifetime): void => {
    const current = typeof value === "string" && value.startsWith("#") ? value : null;
    const picker = createColorPicker({
      value: current,
      text: pickerText(),
      free: true,
      lifetime: own,
      onChange: (color) => {
        const written = writeColor(color);
        if (written !== null) write(written);
        close();
      },
    });
    list.replaceChildren(picker.element);
    picker.focus();
  };

  const open = (): void => {
    if (popover !== null || readOnly()) return;
    const own = openLifetime();
    const list = dom.createElement("div");
    list.className = "canvas-inspector-swatches";
    list.setAttribute("role", "radiogroup");
    list.setAttribute("aria-label", t("canvas_menu.color"));
    const chosen = value === null ? null : colorChoiceOf(value ?? undefined);
    const swatch = (choice: CanvasColorChoice): HTMLButtonElement => {
      const item = dom.createElement("button");
      item.type = "button";
      item.className = "canvas-inspector-swatch";
      item.setAttribute("role", "radio");
      item.setAttribute("aria-checked", String(choice === chosen));
      const dot = dom.createElement("span");
      dot.className = "kit-color-chip";
      dot.setAttribute("aria-hidden", "true");
      const color = colorValueOf(choice);
      if (choice === "none") dot.classList.add("none");
      else if (typeof color === "string") {
        const look = colorLook(color);
        if (look) dot.dataset.canvasColor = look.key;
      }
      const label = dom.createElement("span");
      label.textContent = colorMenuLabel(choice);
      item.append(dot, label);
      own.listen(item, "click", () => {
        if (choice === "other") {
          pick(list, own);
          return;
        }
        write(colorValueOf(choice) ?? undefined);
        close();
      });
      return item;
    };
    const notes = dom.createElement("p");
    notes.className = "canvas-inspector-heading";
    notes.textContent = t("canvas_menu.color.notes");
    const plain: CanvasColorChoice[] = ["none", "1", "2", "3", "4", "5", "6"];
    list.append(
      ...plain.map(swatch),
      notes,
      ...NOTE_COLORS.map((note) => swatch(note.id)),
      swatch("other"),
    );
    popover = openPopover({
      anchor: button,
      content: list,
      label: t("canvas_menu.color"),
      className: "canvas-inspector-popover",
      lifetime: own,
      onClose: () => {
        button.setAttribute("aria-expanded", "false");
        popover = null;
        own.close();
      },
    });
    button.setAttribute("aria-expanded", "true");
  };

  life.listen(button, "click", () => {
    if (popover !== null) close();
    else open();
  });
  life.add(close);
  paint();

  return {
    element,
    setValue(next) {
      value = next;
      paint();
    },
    setDisabled(disabled) {
      button.disabled = disabled;
      if (disabled) close();
    },
  };
}

/** Il nome di un problema del nodo grezzo, per chi legge. */
function rawProblemText(problem: RawProblem): string {
  switch (problem) {
    case "json":
      return t("canvas.inspector.raw.problem.json");
    case "number":
      return t("canvas.inspector.raw.problem.number");
    case "text":
      return t("canvas.inspector.raw.problem.text");
    case "small":
      return t("canvas.inspector.raw.problem.small", { min: String(DROP_MIN_SIZE) });
    case "id":
      return t("canvas.inspector.raw.problem.id");
    case "type":
      return t("canvas.inspector.raw.problem.type");
    case "ink":
      return t("canvas.inspector.raw.problem.ink");
    case "shape":
      return t("canvas.inspector.raw.problem.shape");
  }
}

/** La tabella di «Avanzate»: i campi del nodo, ognuno col suo JSON, scritto a mano. */
interface RawTable {
  readonly element: HTMLElement;
  /** Il nodo com'è adesso: i campi che non si stanno scrivendo si rileggono. */
  sync(node: CanvasNode): void;
}

function rawTable(dom: Document, life: Lifetime, edit: CanvasEditPort, node: CanvasNode): RawTable {
  let current = node;
  /// I campi con un JSON che non si è preso: restano scritti finché non si corregge.
  const drafts = new Set<string>();
  const inputs = new Map<string, HTMLInputElement>();

  const table = dom.createElement("table");
  table.className = "canvas-inspector-raw";
  const error = dom.createElement("p");
  error.className = "canvas-inspector-note";
  error.setAttribute("aria-live", "polite");
  error.hidden = true;
  const show = (message: string | null): void => {
    error.textContent = message ?? "";
    error.hidden = message === null;
  };
  const textOf = (key: string): string => rawFields(current).find((field) => field.key === key)?.text ?? "";

  const commit = (key: string, input: HTMLInputElement): void => {
    const now = edit.doc()?.nodes.find((each) => each.id === current.id);
    if (now === undefined || edit.readOnly()) return;
    const edited = setRawField(now, key, input.value);
    if ("problem" in edited) {
      drafts.add(key);
      input.setAttribute("aria-invalid", "true");
      show(t("canvas.inspector.raw.field_problem", { field: key, problem: rawProblemText(edited.problem) }));
      return;
    }
    drafts.delete(key);
    input.removeAttribute("aria-invalid");
    show(null);
    writeNodes(edit, [now.id], () => edited.node);
  };

  for (const field of rawFields(node)) {
    const row = dom.createElement("tr");
    const head = dom.createElement("th");
    head.scope = "row";
    const id = identifier("canvas-inspector-raw");
    const name = dom.createElement("label");
    name.htmlFor = id;
    name.textContent = field.key;
    head.append(name);
    const cell = dom.createElement("td");
    if (field.lock === "ink" || field.lock === "shape") {
      row.dataset.locked = "";
      cell.textContent = t(field.lock === "ink" ? "canvas.inspector.ink_locked" : "canvas.inspector.shape_locked");
    } else {
      const input = dom.createElement("input");
      input.type = "text";
      input.id = id;
      input.value = field.text;
      input.spellcheck = false;
      input.autocomplete = "off";
      // `id` e `type` si leggono e si copiano, non si scrivono.
      input.readOnly = field.lock !== null;
      inputs.set(field.key, input);
      if (field.lock === null) {
        const key = field.key;
        life.listen(input, "change", () => commit(key, input));
        life.listen(input, "keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(key, input);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            drafts.delete(key);
            input.removeAttribute("aria-invalid");
            show(null);
            input.value = textOf(key);
          }
        });
      }
      cell.append(input);
    }
    row.append(head, cell);
    table.append(row);
  }

  const wrap = dom.createElement("div");
  const note = dom.createElement("p");
  note.className = "canvas-inspector-note";
  note.textContent = t("canvas.inspector.raw_note");
  wrap.append(table, error, note);

  return {
    element: wrap,
    sync(next) {
      current = next;
      for (const field of rawFields(next)) {
        const input = inputs.get(field.key);
        if (input === undefined || input === dom.activeElement || drafts.has(field.key)) continue;
        input.value = field.text;
      }
    },
  };
}

/** I numeri della scheda: la chiave del campo. */
type GeometryKey = "x" | "y" | "width" | "height";

/** I campi dei numeri, nell'ordine di «Scheda», con la loro etichetta. */
const GEOMETRY: readonly (readonly [GeometryKey, Key])[] = [
  ["x", "canvas.inspector.x"],
  ["y", "canvas.inspector.y"],
  ["width", "canvas.inspector.width"],
  ["height", "canvas.inspector.height"],
];

/** Un campo con la sua etichetta, come una `label` sul controllo. */
function labelled(dom: Document, text: string, control: HTMLElement): HTMLElement {
  const field = dom.createElement("div");
  field.className = "canvas-inspector-field";
  const name = dom.createElement("label");
  name.htmlFor = control.id;
  name.textContent = text;
  field.append(name, control);
  return field;
}

/** La parte «Scheda»: i numeri, il colore, il file e «Avanzate», il nodo grezzo di una scheda sola. */
function mountCard(host: HTMLElement, edit: CanvasEditPort): Mount {
  ensureCanvasIcons();
  const life = openLifetime();
  const dom = host.ownerDocument;
  const box = dom.createElement("div");
  box.className = "canvas-inspector";
  box.dataset.part = "card";
  host.append(box);
  life.add(() => box.remove());

  /// Le schede scelte, nell'ordine del documento: si costruisce di nuovo solo
  /// quando la scelta cambia, così il pozzo e i numeri (col fuoco) restano.
  let built: string | null = null;
  /// Gli ascolti dell'ultima costruzione.
  let inner: Lifetime | null = null;
  /// «Avanzate» aperto: si ricorda da una scelta all'altra.
  let advanced = false;
  let numbers: Record<GeometryKey, NumberField> | null = null;
  let well: ColorWell | null = null;
  let path: HTMLElement | null = null;
  let raw: RawTable | null = null;
  /// La tabella di «Avanzate» e i suoi ascolti, con i campi che mostra.
  let rawBody: HTMLElement | null = null;
  let rawLife: Lifetime | null = null;
  let rawKeys: string | null = null;

  /// La tabella di «Avanzate»: si rifà solo quando cambiano i campi del nodo (un
  /// colore nuovo aggiunge `color`), senza toccare il pozzo né i numeri.
  const showRaw = (only: CanvasNode): void => {
    if (rawBody === null) return;
    const keys = Object.keys(only).join("\n");
    if (keys === rawKeys) return;
    rawLife?.close();
    rawLife = openLifetime();
    rawKeys = keys;
    rawBody.replaceChildren();
    raw = rawTable(dom, rawLife, edit, only);
    rawBody.append(raw.element);
  };

  const build = (nodes: CanvasNode[]): void => {
    inner?.close();
    const own = openLifetime();
    inner = own;
    box.replaceChildren();
    numbers = null;
    well = null;
    path = null;
    raw = null;
    rawLife?.close();
    rawLife = null;
    rawKeys = null;
    rawBody = null;
    const [only] = nodes;
    if (nodes.length === 0) {
      const gone = dom.createElement("p");
      gone.className = "canvas-inspector-note";
      gone.textContent = t("canvas.inspector.card_gone");
      box.append(gone);
      return;
    }
    const ids = nodes.map((node) => node.id);
    if (nodes.length > 1) {
      const many = dom.createElement("p");
      many.className = "canvas-inspector-note";
      many.textContent = t("canvas.inspector.many", { n: String(nodes.length) });
      box.append(many);
    }

    const grid = dom.createElement("div");
    grid.className = "canvas-inspector-numbers";
    const made = {} as Record<GeometryKey, NumberField>;
    for (const [key, labelKey] of GEOMETRY) {
      const field = numberField({
        label: t(labelKey),
        value: commonValue(nodes.map((node) => node[key])),
        unit: "px",
        places: 2,
        ...(key === "width" || key === "height" ? { min: DROP_MIN_SIZE } : {}),
        mixedText: t("canvas.inspector.mixed"),
        problem: (problem) => t(`canvas.inspector.problem.${problem}`),
        onCommit: (next) => writeNodes(edit, ids, (node) => ({ ...node, [key]: next })),
        lifetime: own,
      });
      made[key] = field;
      grid.append(field.element);
    }
    numbers = made;
    box.append(grid);

    const colorRow = dom.createElement("div");
    colorRow.className = "canvas-inspector-field";
    colorRow.dataset.wide = "";
    const colorLabel = dom.createElement("span");
    colorLabel.textContent = t("canvas_menu.color");
    well = colorWell(own, dom, (color) => writeNodes(edit, ids, (node) => withColor(node, color)), () => edit.readOnly());
    colorRow.append(colorLabel, well.element);
    box.append(colorRow);

    if (only !== undefined && nodes.length === 1) {
      if (only.type === "file") {
        const row = dom.createElement("div");
        row.className = "canvas-inspector-field";
        row.dataset.wide = "";
        const label = dom.createElement("span");
        label.textContent = t("canvas.inspector.file");
        path = dom.createElement("span");
        path.className = "canvas-inspector-path";
        row.append(label, path);
        box.append(row);
      }
      const panelId = identifier("canvas-inspector-advanced");
      const toggle = dom.createElement("button");
      toggle.type = "button";
      toggle.className = "canvas-inspector-disclosure";
      toggle.setAttribute("aria-expanded", String(advanced));
      toggle.setAttribute("aria-controls", panelId);
      const toggleText = dom.createElement("span");
      toggleText.textContent = t("canvas.inspector.advanced");
      toggle.append(toggleText);
      const chevron = iconEl("draw-section");
      if (chevron) {
        chevron.setAttribute("aria-hidden", "true");
        toggle.append(chevron);
      }
      const heading = dom.createElement("h3");
      heading.className = "canvas-inspector-heading";
      heading.append(toggle);
      const body = dom.createElement("div");
      body.id = panelId;
      body.hidden = !advanced;
      own.listen(toggle, "click", () => {
        advanced = !advanced;
        toggle.setAttribute("aria-expanded", String(advanced));
        body.hidden = !advanced;
      });
      rawBody = body;
      showRaw(only);
      box.append(heading, body);
    }
  };

  const sync = (nodes: CanvasNode[]): void => {
    if (numbers === null || well === null) return;
    const readOnly = edit.readOnly();
    for (const [key] of GEOMETRY) {
      numbers[key].setValue(commonValue(nodes.map((node) => node[key])));
      numbers[key].setDisabled(readOnly);
    }
    well.setValue(colorOf(nodes));
    well.setDisabled(readOnly);
    const [only] = nodes;
    if (path !== null && only !== undefined) path.textContent = typeof only.file === "string" ? only.file : "";
    if (only !== undefined && nodes.length === 1) showRaw(only);
    if (raw !== null && only !== undefined) raw.sync(only);
  };

  const refresh = (): void => {
    if (life.closed) return;
    const { nodes } = chosenOf(edit);
    const signature = nodes.map((node) => node.id).join("\n");
    if (signature !== built) {
      built = signature;
      build(nodes);
    }
    sync(nodes);
  };

  life.add(() => {
    inner?.close();
    inner = null;
    rawLife?.close();
    rawLife = null;
  });
  refresh();
  return {
    handle: { refresh, mark: refresh },
    unmount: () => life.close(),
  };
}

/** Il filo scelto: l'etichetta, le punte, i lati e l'inversione. */
interface EdgeParts {
  readonly label: HTMLInputElement;
  readonly tips: ReadonlyMap<EdgeTips, HTMLButtonElement>;
  readonly from: HTMLSelectElement;
  readonly to: HTMLSelectElement;
  readonly reverse: HTMLButtonElement;
}

/** La parte «Fili»: il filo scelto, con la sua etichetta, le punte, i lati e l'inversione. */
function mountEdge(host: HTMLElement, edit: CanvasEditPort): Mount {
  ensureCanvasIcons();
  const life = openLifetime();
  const dom = host.ownerDocument;
  const box = dom.createElement("div");
  box.className = "canvas-inspector";
  box.dataset.part = "edge";
  host.append(box);
  life.add(() => box.remove());

  let built: string | null = null;
  let inner: Lifetime | null = null;
  let parts: EdgeParts | null = null;

  const build = (edges: CanvasEdge[]): void => {
    inner?.close();
    const own = openLifetime();
    inner = own;
    box.replaceChildren();
    parts = null;
    const [only] = edges;
    if (only === undefined || edges.length > 1) {
      const note = dom.createElement("p");
      note.className = "canvas-inspector-note";
      note.textContent = only === undefined ? t("canvas.inspector.edge_gone") : t("canvas.inspector.edges_many", { n: String(edges.length) });
      box.append(note);
      return;
    }
    const id = only.id;

    const label = dom.createElement("input");
    label.type = "text";
    label.id = identifier("canvas-inspector-edge-label");
    label.autocomplete = "off";
    label.spellcheck = false;
    own.listen(label, "change", () => writeEdges(edit, [id], (edge) => withLabel(edge, label.value)));

    const tipsHeading = dom.createElement("h3");
    tipsHeading.className = "canvas-inspector-heading";
    tipsHeading.textContent = t("canvas.options.tips");
    const group = dom.createElement("div");
    group.className = "segmented canvas-inspector-tips";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", t("canvas.options.tips"));
    const tips = new Map<EdgeTips, HTMLButtonElement>();
    for (const choice of ["none", "start", "end"] as const) {
      const option = dom.createElement("button");
      option.type = "button";
      option.className = "segmented-option";
      option.setAttribute("role", "radio");
      option.textContent = t(`canvas.options.tips.${choice}`);
      own.listen(option, "click", () => writeEdges(edit, [id], (edge) => withTips(edge, choice)));
      tips.set(choice, option);
      group.append(option);
    }

    const side = (end: "from" | "to"): HTMLSelectElement => {
      const select = dom.createElement("select");
      select.id = identifier("canvas-inspector-side");
      for (const choice of SIDE_CHOICES) {
        const option = dom.createElement("option");
        option.value = choice;
        option.textContent = t(`canvas.inspector.side.${choice}`);
        select.append(option);
      }
      own.listen(select, "change", () => {
        const choice = SIDE_CHOICES.find((each) => each === select.value);
        if (choice !== undefined) writeEdges(edit, [id], (edge) => withSide(edge, end, choice));
      });
      return select;
    };
    const from = side("from");
    const to = side("to");
    const sides = dom.createElement("div");
    sides.className = "canvas-inspector-fields";
    sides.append(
      labelled(dom, t("canvas.edge_from_side"), from),
      labelled(dom, t("canvas.edge_to_side"), to),
    );

    const actions = dom.createElement("div");
    actions.className = "canvas-inspector-actions";
    const reverse = dom.createElement("button");
    reverse.type = "button";
    reverse.className = "kit-button";
    reverse.dataset.kind = "normal";
    reverse.textContent = t("canvas_menu.reverse");
    own.listen(reverse, "click", () => writeEdges(edit, [id], reversedEdge));
    actions.append(reverse);

    box.append(labelled(dom, t("canvas.edge_label"), label), tipsHeading, group, sides, actions);
    parts = { label, tips, from, to, reverse };
  };

  const sync = (edges: CanvasEdge[]): void => {
    const [only] = edges;
    if (parts === null || only === undefined || edges.length !== 1) return;
    const readOnly = edit.readOnly();
    if (parts.label !== dom.activeElement) parts.label.value = only.label ?? "";
    parts.label.readOnly = readOnly;
    const current = tipsOf(only);
    for (const [choice, option] of parts.tips) {
      option.setAttribute("aria-checked", String(choice === current));
      option.disabled = readOnly;
    }
    if (parts.from !== dom.activeElement) parts.from.value = only.fromSide ?? "auto";
    if (parts.to !== dom.activeElement) parts.to.value = only.toSide ?? "auto";
    parts.from.disabled = readOnly;
    parts.to.disabled = readOnly;
    parts.reverse.disabled = readOnly;
  };

  const refresh = (): void => {
    if (life.closed) return;
    const { edges } = chosenOf(edit);
    const signature = edges.map((edge) => edge.id).join("\n");
    if (signature !== built) {
      built = signature;
      build(edges);
    }
    sync(edges);
  };

  life.add(() => {
    inner?.close();
    inner = null;
  });
  refresh();
  return {
    handle: { refresh, mark: refresh },
    unmount: () => life.close(),
  };
}

/** Chi fa scorrere l'elenco: il primo antenato che scorre in verticale. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  const view = element.ownerDocument.defaultView;
  for (let up = element.parentElement; up; up = up.parentElement) {
    const overflow = view?.getComputedStyle(up).overflowY ?? "";
    if (overflow === "auto" || overflow === "scroll") return up;
  }
  return null;
}
