// L'ispettore della lavagna (T58): le schede che la lavagna porta
// nell'ispettore dello Scrittoio (`EditorSurface.panels`), come fa il disegno
// con `inspectorChrome`. La shell mette la testata, le linguette e il titolo
// del pannello; qui c'è il contenuto.
//
// Per ora c'è la parte «Schede»: tutte le schede in ordine di lettura
// (`reading-order.ts`), coi gruppi come cartelle, filtrabili per nome e per
// specie; un clic (o Invio) porta la vista sulla scheda e la sceglie. È anche
// il percorso del lettore di schermo. «Scheda» e «Fili» arrivano con T59,
// «Fonti» con T77: finché non ci sono, le loro linguette non nascono.
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
import { onLanguage, t } from "../../../i18n/strings";
import { identifier } from "../../../ui/a11y";
import { iconEl } from "../../../ui/icons";
import { openLifetime } from "../../../ui/lifetime";
import { cardKindOf } from "../cards";
import type { CanvasNode } from "../model";
import { readingOrder, type ReadingEntry } from "../reading-order";
import { ensureCanvasIcons } from "./icons";

/** L'id della linguetta «Schede»: l'ispettore lo ricorda. */
export const CARDS_PANEL_ID = "canvas.cards";

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

/** Ciò che l'ispettore chiede alla superficie. */
export interface CanvasInspectorPort {
  /** Il testo della lavagna adesso; `null` senza lavagna. */
  readonly source: () => string | null;
  /**
   * Porta la vista sulla scheda il cui oggetto comincia al byte `byte` e la
   * sceglie (`revealSource` della tela). `false` se non ci arriva.
   */
  readonly reveal: (byte: number) => boolean;
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

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  return {
    panels: {
      list: () => (offered && !disposed ? [tab] : []),
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
      notify();
    },
    changed() {
      stale = true;
      if (mounted.size === 0) return;
      for (const view of mounted) view.refresh();
    },
    selectionChanged() {
      if (picking || picked === null) return;
      picked = null;
      for (const view of mounted) view.mark();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      offered = false;
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

  /// La scelta e il fuoco sulle righe disegnate.
  const mark = (): void => {
    const picked = port.picked();
    const focusable = active !== null && shown.some((entry) => entry.node.id === active) ? active : shown[0]?.node.id ?? null;
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
    const current = shown.findIndex((entry) => entry.node.id === active);
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

/** Chi fa scorrere l'elenco: il primo antenato che scorre in verticale. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  const view = element.ownerDocument.defaultView;
  for (let up = element.parentElement; up; up = up.parentElement) {
    const overflow = view?.getComputedStyle(up).overflowY ?? "";
    if (overflow === "auto" || overflow === "scroll") return up;
  }
  return null;
}
