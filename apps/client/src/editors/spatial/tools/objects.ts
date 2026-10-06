// L'albero degli oggetti: il disegno come elenco, sincronizzato con la scena
// e con la selezione. È la via al disegno per chi non vede il foglio, e per
// chi vuole scegliere un oggetto senza puntarlo.
//
// - **Il dato è quello della scena.** Le voci le dà l'editor, dalle voci del
//   testo e dall'indice degli oggetti che il foglio tocca: nessun secondo
//   calcolo, e un oggetto si sceglie qui solo se si sceglie sul foglio.
// - **Dal davanti.** Le righe vanno da ciò che sta davanti a ciò che sta
//   dietro, come i livelli nel loro menu: in cima c'è quello che copre gli
//   altri. La selezione si dice sempre in ordine di documento, anche per gli
//   oggetti che una riga chiusa o il filtro non mostrano.
// - **Un albero ARIA.** `role="tree"` con più scelte, il fuoco sull'albero e la
//   riga attiva in `aria-activedescendant`: le righe non prendono il fuoco,
//   quindi possono sparire e tornare senza che il fuoco si perda. Livello,
//   posizione e numero dei fratelli sono attributi, così anche le righe non
//   disegnate contano.
// - **La selezione segue il fuoco.** Le frecce scelgono la riga a cui
//   arrivano; con Ctrl o ⌘ ci arrivano soltanto, Spazio aggiunge o toglie,
//   Maiusc estende. Un livello non è un oggetto: arrivarci non sceglie niente,
//   e Spazio sceglie i suoi oggetti. Un gruppo o un collegamento si apre
//   anche lui, quando l'editor dà le sue voci: i suoi oggetti si scelgono uno
//   per uno. Un livello nasce aperto, un gruppo chiuso; quando la selezione
//   cambia da fuori, si apre ciò che contiene la prima riga scelta.
// - **Il nome si cambia qui.** F2, o un doppio clic sul nome, apre sulla riga
//   il campo del nome: Invio lo scrive, Esc lo lascia com'era, e uscire dal
//   campo lo scrive anche lui. Il doppio clic altrove sulla riga apre le
//   proprietà, come Invio.
// - **Il filtro**, quando l'editor lo offre: una ricerca e un tipo. Restano le
//   righe che hanno nel nome tutte le parole cercate, maiuscole e accenti a
//   parte, e sono del tipo scelto; con loro, aperto, ciò che le contiene. Un
//   livello, un gruppo o un collegamento trovato porta con sé ciò che
//   contiene. Una riga di stato dice quanti oggetti ha trovato.
// - **Bloccare e nascondere da qui.** Ctrl o ⌘ con Maiusc e L blocca o
//   sblocca la riga attiva, con H la nasconde o la mostra; col puntatore, i
//   segni accanto al nome.
// - **Mai il solo colore.** Una riga scelta ha il segno di spunta; un livello
//   o un gruppo aperto o chiuso, la sua freccia; un oggetto bloccato o
//   nascosto, il suo segno, e il nome lo dice a parole; un oggetto che non si
//   sceglie, il corsivo, e chi lo contiene dice a parole perché.
// - **Virtualizzato** oltre [`VIRTUAL_AFTER`] righe: si disegnano quelle che si
//   vedono, più qualcuna, e la riga attiva.

import { plural, t, type DrawKey } from "../strings";
import { identifier, stableIdentifier } from "../../../ui/a11y";
import { icon, iconEl, registerIcon } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";
import { MAX_LAYER_NAME } from "./layers";
import { cleanName, NAME_MAX } from "./naming";

/// Oltre questo numero di righe l'albero disegna solo quelle che si vedono.
export const VIRTUAL_AFTER = 500;

/// L'altezza di una riga quando l'albero è virtualizzato: un bersaglio da
/// 44 px, come ogni bersaglio del livello Essenziale.
export const ROW_PX = 44;

/// Le righe disegnate oltre quelle che si vedono, sopra e sotto.
const OVERSCAN = 8;

/// Con più voci di [`VIRTUAL_AFTER`] la ricerca aspetta che si smetta di
/// scrivere, per questi millisecondi.
const SEARCH_WAIT_MS = 150;

/// Le icone dei segni, col costrutto di `ui/icons.ts`: il lucchetto e
/// l'occhio sbarrato.
const ICONS: Readonly<Record<string, readonly string[]>> = {
  "draw-lock": ["M6 11h12v9H6z", "M8.5 11V8a3.5 3.5 0 0 1 7 0v3"],
  "draw-hidden": ["M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z", "M9.5 12a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0", "M4 4l16 16"],
};

/// Che cosa cambia un segno: il blocco o la visibilità.
export type TreeToggle = "lock" | "hide";

/// Il tipo di una voce, per il filtro.
export type TreeKind = "layer" | "stroke" | "shape" | "text" | "image" | "group" | "link";

/// I tipi che il filtro offre, nel suo ordine, col loro nome.
const FILTER_KINDS: readonly (readonly [TreeKind | "all", DrawKey])[] = [
  ["all", "draw.objects.kind.all"],
  ["stroke", "draw.objects.kind.stroke"],
  ["shape", "draw.objects.kind.shape"],
  ["text", "draw.objects.kind.text"],
  ["image", "draw.objects.kind.image"],
  ["group", "draw.objects.kind.group"],
  ["link", "draw.objects.kind.link"],
];

/// Una voce dell'albero.
export interface TreeEntry {
  readonly key: string;
  /// Un livello: si apre e si chiude, e non si sceglie.
  readonly layer: boolean;
  /// Si sceglie: un oggetto di un livello bloccato o nascosto no.
  readonly selectable: boolean;
  /// Bloccato con `fub:locked`, nascosto con `display="none"`: un segno
  /// accanto al nome, che il nome dice anche a parole.
  readonly locked: boolean;
  readonly hidden: boolean;
  /// Si blocca e si nasconde da qui.
  readonly toggles: boolean;
  /// Il nome che qualcuno le ha dato: quello del livello, il primo `title`
  /// dell'oggetto. `null` se non ne ha; il campo del nome parte da qui.
  readonly name: string | null;
  /// Si rinomina da qui, se l'editor lo concede quando si comincia.
  readonly renames: boolean;
  /// Il tipo, per il filtro.
  readonly kind: TreeKind;
  /// I figli di un livello, o di un gruppo o di un collegamento che si apre,
  /// in ordine di documento.
  readonly children: readonly TreeEntry[];
  /// Il nome a parole; si chiede per le righe disegnate e per il filtro.
  label(): string;
}

export interface ObjectTreeOptions {
  /// La selezione nuova, in ordine di documento.
  onSelect(keys: readonly string[]): void;
  /// Invio su un oggetto: le sue proprietà.
  onActivate(): void;
  onDelete(): void;
  /// Esc: il fuoco torna al foglio.
  onLeave(): void;
  /// Blocca o sblocca, nasconde o mostra la voce `key`.
  onToggle?(key: string, what: TreeToggle): void;
  /// Vero se la voce `key` si rinomina adesso; se no, l'editor dice perché.
  canRename?(key: string): boolean;
  /// Il nome nuovo della voce `key`, ripulito; vuoto toglie quello che c'è.
  /// La chiave della voce dopo, che cambia se riceve un id; `null` se non è
  /// cambiato niente.
  onRename?(key: string, name: string): string | null;
}

export interface ObjectTree {
  /// Il pannello: titolo, conteggio, filtro e albero.
  readonly element: HTMLElement;
  /// Le voci e la selezione di adesso. Se il fuoco non è nell'albero, la riga
  /// attiva va al primo oggetto scelto.
  update(entries: readonly TreeEntry[], selection: readonly string[], count: number): void;
  focus(): void;
  /// Mostra o nasconde il filtro; nascosto, si svuota.
  setFiltering(on: boolean): void;
  /// Porta in vista la voce `key` e ne apre il campo del nome. Falso se la
  /// voce non c'è o non si rinomina.
  rename(key: string): boolean;
  /// Riscrive i testi nella lingua di adesso.
  relabel(): void;
}

interface Row {
  readonly entry: TreeEntry;
  readonly level: number;
  readonly setsize: number;
  readonly posinset: number;
  /// L'indice della riga che la contiene; `-1` in cima.
  readonly parent: number;
  /// Si apre e si chiude, ed è aperta.
  readonly branch: boolean;
  readonly open: boolean;
  /// Col filtro, una riga che c'è per ciò che contiene: non è trovata lei.
  readonly context: boolean;
}

/// Una voce che il filtro lascia, con i figli che lascia, dal davanti.
interface Kept {
  readonly entry: TreeEntry;
  readonly found: boolean;
  readonly children: readonly Kept[];
}

/// Un testo da confrontare: minuscolo, senza accenti, con un apostrofo solo.
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/[‘’ʼ]/g, "'").toLowerCase();
}

export function createObjectTree(life: Lifetime, options: ObjectTreeOptions): ObjectTree {
  for (const [name, paths] of Object.entries(ICONS)) if (icon(name) === "") registerIcon(name, paths);
  const element = document.createElement("section");
  element.className = "draw-objects";
  element.id = identifier("draw-objects");
  const header = document.createElement("div");
  header.className = "draw-objects-header";
  const heading = document.createElement("h2");
  heading.className = "draw-objects-title";
  heading.id = identifier("draw-objects-title");
  const counter = document.createElement("span");
  counter.className = "draw-objects-count";
  header.append(heading, counter);
  const filterBar = document.createElement("div");
  filterBar.className = "draw-objects-filter";
  filterBar.hidden = true;
  const search = document.createElement("input");
  search.type = "search";
  search.className = "draw-objects-search";
  search.autocomplete = "off";
  search.spellcheck = false;
  const kindSelect = document.createElement("select");
  kindSelect.className = "draw-objects-kind";
  for (const [value] of FILTER_KINDS) {
    const option = document.createElement("option");
    option.value = value;
    kindSelect.append(option);
  }
  filterBar.append(search, kindSelect);
  const status = document.createElement("p");
  status.className = "draw-objects-status";
  status.setAttribute("role", "status");
  const empty = document.createElement("p");
  empty.className = "draw-objects-empty";
  const scroller = document.createElement("div");
  scroller.className = "draw-objects-scroll";
  const tree = document.createElement("div");
  tree.className = "draw-objects-tree";
  tree.id = identifier("draw-objects-tree");
  tree.setAttribute("role", "tree");
  tree.setAttribute("aria-multiselectable", "true");
  tree.setAttribute("aria-labelledby", heading.id);
  tree.tabIndex = 0;
  search.setAttribute("aria-controls", tree.id);
  kindSelect.setAttribute("aria-controls", tree.id);
  scroller.append(tree);
  element.setAttribute("aria-labelledby", heading.id);
  element.append(header, filterBar, status, empty, scroller);

  const prefix = identifier("draw-object");
  let entries: readonly TreeEntry[] = [];
  let rows: Row[] = [];
  let count = 0;
  let selected = new Set<string>();
  /// I livelli chiusi, e i gruppi aperti: un livello nuovo nasce aperto, un
  /// gruppo chiuso.
  const collapsed = new Set<string>();
  const opened = new Set<string>();
  let active: string | null = null;
  let anchor: string | null = null;
  /// La selezione dell'ultimo `update`: quando cambia da fuori, la prima riga
  /// scelta si apre.
  let followed = "";
  /// Il posto di ogni voce nel documento, per dire la selezione in ordine.
  let docOrder = new Map<string, number>();

  /// Il filtro: le parole cercate, già piegate, e il tipo. Mentre vale, le
  /// righe che lo soddisfano dentro qualcosa lo aprono; chiuse a mano, restano
  /// chiuse finché il filtro non cambia.
  let words: string[] = [];
  let kind: TreeKind | "all" = "all";
  const shut = new Set<string>();
  /// Le voci trovate, e quante sono oggetti.
  let hits = new Set<string>();
  let found = 0;
  /// I nomi piegati, per voce: le voci cambiano con la scena, i nomi con la
  /// lingua.
  let folded = new WeakMap<TreeEntry, string>();
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  life.add(() => clearTimeout(searchTimer));

  /// Il campo del nome, uno solo: sta sulla riga della voce `renaming`
  /// mentre la si rinomina.
  const field = document.createElement("input");
  field.type = "text";
  field.className = "draw-object-rename";
  field.autocomplete = "off";
  let renaming: string | null = null;

  const filtering = (): boolean => words.length > 0 || kind !== "all";

  const matches = (entry: TreeEntry): boolean => {
    if (words.length === 0) return true;
    let text = folded.get(entry);
    if (text === undefined) {
      text = fold(entry.label());
      folded.set(entry, text);
    }
    return words.every((word) => text.includes(word));
  };

  /// Le voci di `list` che il filtro lascia, dal davanti; `inherited` se
  /// chi le contiene ha già le parole cercate.
  const sift = (list: readonly TreeEntry[], inherited: boolean): Kept[] => {
    const kept: Kept[] = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const entry = list[i]!;
      const worded = inherited || matches(entry);
      const hit = worded && !entry.layer && (kind === "all" || entry.kind === kind);
      const children = sift(entry.children, worded);
      if (hit) {
        hits.add(entry.key);
        found++;
      }
      if (hit || children.length > 0) kept.push({ entry, found: hit, children });
    }
    return kept;
  };

  /// Vero se `entry` si apre senza filtro: un livello, o un oggetto con dei
  /// figli.
  const expandable = (entry: TreeEntry): boolean => entry.layer || entry.children.length > 0;
  const isOpen = (entry: TreeEntry): boolean => (entry.layer ? !collapsed.has(entry.key) : opened.has(entry.key));

  const flatten = (): void => {
    rows = [];
    hits = new Set();
    found = 0;
    if (!filtering()) {
      const visit = (list: readonly TreeEntry[], level: number, parent: number): void => {
        for (let i = list.length - 1; i >= 0; i--) {
          const entry = list[i]!;
          const at = rows.length;
          const branch = expandable(entry);
          const open = branch && isOpen(entry);
          rows.push({ entry, level, setsize: list.length, posinset: list.length - i, parent, branch, open, context: false });
          if (open) visit(entry.children, level + 1, at);
        }
      };
      visit(entries, 1, -1);
      return;
    }
    const place = (list: readonly Kept[], level: number, parent: number): void => {
      list.forEach((kept, index) => {
        const at = rows.length;
        const branch = kept.children.length > 0;
        const open = branch && !shut.has(kept.entry.key);
        rows.push({ entry: kept.entry, level, setsize: list.length, posinset: index + 1, parent, branch, open, context: !kept.found });
        if (open) place(kept.children, level + 1, at);
      });
    };
    place(sift(entries, false), 1, -1);
  };

  /// Apre ciò che contiene la voce `key`, a ogni profondità. Vero se l'ha
  /// trovata.
  const unfold = (key: string): boolean => {
    const visit = (list: readonly TreeEntry[]): boolean => list.some((entry) => {
      if (entry.key === key) return true;
      if (!visit(entry.children)) return false;
      if (entry.layer) collapsed.delete(entry.key);
      else opened.add(entry.key);
      shut.delete(entry.key);
      return true;
    });
    return visit(entries);
  };

  const indexOf = (key: string | null): number => (key === null ? -1 : rows.findIndex((row) => row.entry.key === key));

  const rowId = (key: string): string => stableIdentifier(prefix, key);

  /// Le righe disegnate per chiave: una riga che resta è lo stesso nodo, e
  /// uno screen reader non la sente cambiare.
  let rendered = new Map<string, HTMLElement>();

  /// Un segno della riga: il lucchetto o l'occhio sbarrato.
  const signOf = (what: TreeToggle): HTMLElement => {
    const sign = document.createElement("span");
    sign.className = "draw-object-sign";
    sign.dataset.sign = what;
    const svg = iconEl(what === "lock" ? "draw-lock" : "draw-hidden");
    if (svg !== null) sign.append(svg);
    return sign;
  };

  /// Il suggerimento di un segno che si tocca: che cosa farebbe.
  const signTitle = (sign: HTMLElement, on: boolean, toggles: boolean, what: TreeToggle): void => {
    const title = !toggles ? "" : t(what === "lock" ? (on ? "draw.unlock" : "draw.lock") : on ? "draw.show" : "draw.hide");
    if (sign.title !== title) sign.title = title;
    sign.toggleAttribute("data-on", on);
  };

  /// Scrive `row` nel nodo `item`, nuovo o di prima.
  const paintRow = (item: HTMLElement, row: Row, index: number, virtual: boolean): void => {
    const { entry } = row;
    if (item.childElementCount === 0) {
      item.className = "draw-object";
      item.setAttribute("role", "treeitem");
      const twisty = document.createElement("span");
      twisty.className = "draw-object-twisty";
      const mark = document.createElement("span");
      mark.className = "draw-object-mark";
      const label = document.createElement("span");
      label.className = "draw-object-label";
      // I segni sono per gli occhi: il nome li dice a parole, e la tastiera
      // ha i suoi tasti.
      const signs = document.createElement("span");
      signs.className = "draw-object-signs";
      signs.append(signOf("lock"), signOf("hide"));
      for (const part of [twisty, mark, signs]) part.setAttribute("aria-hidden", "true");
      item.append(twisty, mark, label, signs);
    }
    item.id = rowId(entry.key);
    item.dataset.key = entry.key;
    item.dataset.index = String(index);
    item.setAttribute("aria-level", String(row.level));
    item.setAttribute("aria-setsize", String(row.setsize));
    item.setAttribute("aria-posinset", String(row.posinset));
    item.style.setProperty("--draw-depth", String(row.level - 1));
    if (row.branch) item.setAttribute("aria-expanded", String(row.open));
    else item.removeAttribute("aria-expanded");
    if (entry.layer) item.removeAttribute("aria-selected");
    else item.setAttribute("aria-selected", String(selected.has(entry.key)));
    if (!entry.layer && !entry.selectable) item.setAttribute("aria-disabled", "true");
    else item.removeAttribute("aria-disabled");
    item.toggleAttribute("data-active", entry.key === active);
    item.toggleAttribute("data-toggles", entry.toggles && options.onToggle !== undefined);
    item.toggleAttribute("data-context", row.context);
    // Il campo del nome sta in fondo alla riga, dopo i segni: le prime quattro
    // parti restano al loro posto.
    const [twisty, mark, label, signs] = item.children as unknown as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    const arrow = row.branch ? (row.open ? "▾" : "▸") : "";
    if (twisty.textContent !== arrow) twisty.textContent = arrow;
    const glyph = entry.layer ? "" : "✓";
    if (mark.textContent !== glyph) mark.textContent = glyph;
    const text = entry.label();
    if (label.textContent !== text) label.textContent = text;
    const [lock, hide] = signs.children as unknown as [HTMLElement, HTMLElement];
    const toggles = entry.toggles && options.onToggle !== undefined;
    signTitle(lock, entry.locked, toggles, "lock");
    signTitle(hide, entry.hidden, toggles, "hide");
    item.style.position = virtual ? "absolute" : "";
    item.style.top = virtual ? `${index * ROW_PX}px` : "";
    item.style.height = virtual ? `${ROW_PX}px` : "";
  };

  /// Le righe da disegnare: tutte, o quelle che si vedono e l'attiva.
  const windowOf = (virtual: boolean): number[] => {
    if (!virtual) return rows.map((_, index) => index);
    const first = Math.max(0, Math.floor(scroller.scrollTop / ROW_PX) - OVERSCAN);
    const visible = Math.ceil((scroller.clientHeight || ROW_PX * 12) / ROW_PX);
    const last = Math.min(rows.length - 1, first + visible + 2 * OVERSCAN);
    const indices: number[] = [];
    for (let index = first; index <= last; index++) indices.push(index);
    const current = indexOf(active);
    if (current >= 0 && (current < first || current > last)) indices.push(current);
    return indices;
  };

  const render = (): void => {
    counter.textContent = plural(count, "draw.describe.parts.one", "draw.describe.parts.other");
    const said = !filtering() ? "" : found === 0 ? t("draw.objects.found.none") : plural(found, "draw.objects.found.one", "draw.objects.found.other");
    if (status.textContent !== said) status.textContent = said;
    empty.hidden = entries.length > 0;
    scroller.hidden = rows.length === 0;
    if (indexOf(active) < 0) active = rows[0]?.entry.key ?? null;
    const virtual = rows.length > VIRTUAL_AFTER;
    tree.toggleAttribute("data-virtual", virtual);
    tree.style.height = virtual ? `${rows.length * ROW_PX}px` : "";
    const next = new Map<string, HTMLElement>();
    const nodes = windowOf(virtual).map((index) => {
      const row = rows[index]!;
      const item = rendered.get(row.entry.key) ?? document.createElement("div");
      paintRow(item, row, index, virtual);
      next.set(row.entry.key, item);
      return item;
    });
    for (const [key, item] of rendered) if (!next.has(key)) item.remove();
    rendered = next;
    nodes.forEach((node, index) => {
      if (tree.children[index] !== node) tree.insertBefore(node, tree.children[index] ?? null);
    });
    if (active === null) tree.removeAttribute("aria-activedescendant");
    else tree.setAttribute("aria-activedescendant", rowId(active));
  };

  /// Porta in vista la riga attiva.
  const reveal = (): void => {
    const index = indexOf(active);
    if (index < 0) return;
    if (rows.length > VIRTUAL_AFTER) {
      const top = index * ROW_PX;
      const height = scroller.clientHeight;
      if (top < scroller.scrollTop) scroller.scrollTop = top;
      else if (height > 0 && top + ROW_PX > scroller.scrollTop + height) scroller.scrollTop = top + ROW_PX - height;
      render();
    } else {
      tree.querySelector(`[data-index="${index}"]`)?.scrollIntoView?.({ block: "nearest" });
    }
  };

  const selectable = (index: number): boolean => {
    const row = rows[index];
    return row !== undefined && !row.entry.layer && row.entry.selectable;
  };

  /// La selezione in ordine di documento, anche per le voci che non hanno
  /// una riga.
  const ordered = (keys: Set<string>): string[] =>
    [...keys].filter((key) => docOrder.has(key)).sort((a, b) => docOrder.get(a)! - docOrder.get(b)!);

  const choose = (keys: Set<string>): void => {
    selected = keys;
    options.onSelect(ordered(keys));
  };

  /// Le righe che si scelgono fra `from` e `to`, comprese; col filtro, solo
  /// quelle trovate.
  const range = (from: number, to: number): Set<string> => {
    const keys = new Set<string>();
    for (let index = Math.min(from, to); index <= Math.max(from, to); index++) {
      if (selectable(index) && !rows[index]!.context) keys.add(rows[index]!.entry.key);
    }
    return keys;
  };

  /// Porta la riga attiva a `index`: `select` la sceglie da sola, `extend`
  /// sceglie dall'ancora fin lì, `focus` ci arriva soltanto.
  const moveTo = (index: number, mode: "select" | "extend" | "focus"): void => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (row === undefined) return;
    active = row.entry.key;
    const at = indexOf(active);
    if (mode === "extend") {
      const from = indexOf(anchor);
      choose(range(from < 0 ? at : from, at));
    } else if (mode === "select") {
      anchor = active;
      choose(selectable(at) ? new Set([active]) : new Set());
    }
    render();
    reveal();
  };

  const toggle = (index: number): void => {
    const row = rows[index];
    if (row === undefined) return;
    anchor = row.entry.key;
    if (row.entry.layer) {
      // Col filtro, gli oggetti del livello che ha trovato.
      const keep = filtering() ? (child: TreeEntry) => hits.has(child.key) : () => true;
      choose(new Set(row.entry.children.filter((child) => child.selectable && keep(child)).map((child) => child.key)));
    } else if (row.entry.selectable) {
      const next = new Set(selected);
      if (!next.delete(row.entry.key)) next.add(row.entry.key);
      choose(next);
    }
    render();
  };

  const setExpanded = (row: Row, open: boolean): void => {
    const { entry } = row;
    if (filtering()) {
      if (open) shut.delete(entry.key);
      else shut.add(entry.key);
    } else if (entry.layer) {
      if (open) collapsed.delete(entry.key);
      else collapsed.add(entry.key);
    } else if (open) {
      opened.add(entry.key);
    } else {
      opened.delete(entry.key);
    }
    flatten();
    render();
  };

  /// Le righe che stanno in una pagina dell'albero.
  const page = (): number => Math.max(1, Math.floor((scroller.clientHeight || ROW_PX * 10) / ROW_PX) - 1);

  /// La voce di chiave `key` fra quelle di adesso, anche senza riga.
  const entryOf = (key: string): TreeEntry | null => {
    const visit = (list: readonly TreeEntry[]): TreeEntry | null => {
      for (const entry of list) {
        if (entry.key === key) return entry;
        const inner = visit(entry.children);
        if (inner !== null) return inner;
      }
      return null;
    };
    return visit(entries);
  };

  /// Chiude il campo del nome: con `write` dà il nome scritto, se è un
  /// altro; con `refocus` il fuoco torna all'albero.
  const finishRename = (write: boolean, refocus: boolean): void => {
    const key = renaming;
    if (key === null) return;
    renaming = null;
    const name = cleanName(field.value);
    field.parentElement?.removeAttribute("data-renaming");
    // Prima il fuoco, poi via il campo: un campo che sparisce col fuoco lo
    // lascerebbe alla pagina.
    if (refocus && document.activeElement === field) tree.focus({ preventScroll: true });
    field.remove();
    const entry = entryOf(key);
    if (!write || entry === null || name === cleanName(entry.name ?? "")) return;
    const wasActive = active === key;
    const now = options.onRename?.(key, name) ?? null;
    // La riga resta quella attiva, anche con la chiave nuova.
    if (now !== null && now !== key && indexOf(now) >= 0) {
      if (wasActive) active = now;
      if (anchor === key) anchor = now;
      render();
    }
  };

  /// Apre il campo del nome sulla riga della voce `key`, che diventa quella
  /// attiva.
  const startRename = (key: string): boolean => {
    const row = rows[indexOf(key)];
    if (row === undefined || !row.entry.renames || options.onRename === undefined) return false;
    if (options.canRename !== undefined && !options.canRename(key)) return false;
    finishRename(true, false);
    active = key;
    render();
    reveal();
    const item = rendered.get(key);
    if (item === undefined) return false;
    field.value = row.entry.name ?? "";
    field.maxLength = row.entry.layer ? MAX_LAYER_NAME : NAME_MAX;
    field.setAttribute("aria-label", t("draw.objects.rename", { name: row.entry.label() }));
    renaming = key;
    item.toggleAttribute("data-renaming", true);
    item.append(field);
    field.focus({ preventScroll: true });
    field.select();
    return true;
  };

  life.listen(field, "keydown", (event) => {
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    finishRename(event.key === "Enter", true);
  });
  // Uscire dal campo scrive il nome; passare a un'altra finestra no, e al
  // ritorno il campo è ancora lì.
  life.listen(field, "blur", () => {
    if (typeof document.hasFocus === "function" && !document.hasFocus()) return;
    finishRename(true, false);
  });

  /// Applica il filtro scritto adesso; un filtro nuovo riapre ciò che era
  /// stato chiuso col vecchio.
  const applyFilter = (): void => {
    clearTimeout(searchTimer);
    searchTimer = undefined;
    const next = fold(search.value).split(/\s+/).filter((word) => word !== "");
    const nextKind = kindSelect.value as TreeKind | "all";
    if (next.join(" ") === words.join(" ") && nextKind === kind) return;
    finishRename(true, false);
    words = next;
    kind = nextKind;
    shut.clear();
    flatten();
    render();
  };

  /// Col disegno grande, la ricerca aspetta che si smetta di scrivere.
  const scheduleFilter = (): void => {
    clearTimeout(searchTimer);
    if (docOrder.size <= VIRTUAL_AFTER) applyFilter();
    else searchTimer = setTimeout(applyFilter, SEARCH_WAIT_MS);
  };

  /// Il fuoco va all'albero, sulla riga attiva o sulla prima.
  const enterTree = (): void => {
    if (rows.length === 0) return;
    if (indexOf(active) < 0) active = rows[0]!.entry.key;
    tree.focus({ preventScroll: true });
    render();
    reveal();
  };

  life.listen(search, "input", scheduleFilter);
  life.listen(kindSelect, "change", applyFilter);
  life.listen(search, "keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "Enter") {
      applyFilter();
      enterTree();
    } else if (event.key === "Escape") {
      // Esc svuota la ricerca; vuota, porta all'albero.
      if (search.value !== "") {
        search.value = "";
        applyFilter();
      } else {
        enterTree();
      }
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  });

  life.listen(tree, "keydown", (event) => {
    // I tasti del campo del nome sono suoi.
    if (event.target !== tree) return;
    const at = indexOf(active);
    const row = rows[at];
    const mod = event.ctrlKey || event.metaKey;
    const mode = event.shiftKey ? "extend" : mod ? "focus" : "select";
    switch (event.key) {
      case "ArrowDown":
        moveTo(at + 1, mode);
        break;
      case "ArrowUp":
        moveTo(at - 1, mode);
        break;
      case "PageDown":
        moveTo(at + page(), mode);
        break;
      case "PageUp":
        moveTo(at - page(), mode);
        break;
      case "Home":
        moveTo(0, mode);
        break;
      case "End":
        moveTo(rows.length - 1, mode);
        break;
      case "ArrowRight":
        if (row !== undefined && row.branch) {
          if (!row.open) setExpanded(row, true);
          else if (rows[at + 1]?.parent === at) moveTo(at + 1, mode);
        }
        break;
      case "ArrowLeft":
        if (row !== undefined && row.branch && row.open) setExpanded(row, false);
        else if (row !== undefined && row.parent >= 0) moveTo(row.parent, mode);
        break;
      case " ":
        if (at >= 0) toggle(at);
        break;
      case "Enter":
        if (row?.entry.layer) {
          if (row.branch) setExpanded(row, !row.open);
        } else if (row !== undefined && row.entry.selectable) {
          if (!selected.has(row.entry.key)) {
            anchor = row.entry.key;
            choose(new Set([row.entry.key]));
            render();
          }
          options.onActivate();
        }
        break;
      case "F2":
        if (row === undefined || !row.entry.renames || options.onRename === undefined) return;
        startRename(row.entry.key);
        break;
      case "Delete":
      case "Backspace":
        if (selected.size === 0) return;
        options.onDelete();
        break;
      case "Escape":
        options.onLeave();
        break;
      case "a":
      case "A":
        if (!mod || event.shiftKey || event.altKey) return;
        choose(range(0, rows.length - 1));
        render();
        break;
      case "f":
      case "F":
        if (!mod || event.shiftKey || event.altKey || filterBar.hidden) return;
        search.focus();
        search.select();
        break;
      case "l":
      case "L":
      case "h":
      case "H":
        if (!mod || !event.shiftKey || event.altKey || row === undefined || !row.entry.toggles || options.onToggle === undefined) return;
        options.onToggle(row.entry.key, event.key.toLowerCase() === "l" ? "lock" : "hide");
        break;
      default:
        return;
    }
    event.preventDefault();
    // L'editor non deve vedere il tasto: le frecce, qui, non spostano niente.
    event.stopPropagation();
  });

  const rowOf = (target: EventTarget | null): number => {
    const item = target instanceof Element ? target.closest<HTMLElement>(".draw-object") : null;
    return item === null ? -1 : Number(item.dataset.index);
  };

  /// Vero se `target` è nel campo del nome: il clic lì muove il cursore.
  const inField = (target: EventTarget | null): boolean => target instanceof Element && target.closest(".draw-object-rename") !== null;

  life.listen(tree, "click", (event) => {
    if (inField(event.target)) return;
    const index = rowOf(event.target);
    const row = rows[index];
    if (row === undefined) return;
    tree.focus({ preventScroll: true });
    const sign = event.target instanceof Element ? event.target.closest<HTMLElement>(".draw-object-sign") : null;
    if (sign !== null && row.entry.toggles && options.onToggle !== undefined) {
      active = row.entry.key;
      render();
      options.onToggle(row.entry.key, sign.dataset.sign === "lock" ? "lock" : "hide");
      return;
    }
    const twisty = event.target instanceof Element && event.target.closest(".draw-object-twisty") !== null;
    if (row.entry.layer || (twisty && row.branch)) {
      active = row.entry.key;
      if (row.branch) setExpanded(row, !row.open);
      else render();
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      active = row.entry.key;
      toggle(index);
      return;
    }
    moveTo(index, event.shiftKey ? "extend" : "select");
  });

  // Il doppio clic sul nome lo cambia; altrove apre le proprietà.
  life.listen(tree, "dblclick", (event) => {
    if (inField(event.target)) return;
    const row = rows[rowOf(event.target)];
    if (row === undefined) return;
    const onLabel = event.target instanceof Element && event.target.closest(".draw-object-label") !== null;
    if (onLabel && row.entry.renames && options.onRename !== undefined) {
      startRename(row.entry.key);
      return;
    }
    if (!row.entry.layer && row.entry.selectable) options.onActivate();
  });

  life.listen(scroller, "scroll", () => {
    if (rows.length > VIRTUAL_AFTER) render();
  });

  const relabel = (): void => {
    heading.textContent = t("draw.objects");
    empty.textContent = t("draw.objects.empty");
    search.placeholder = t("draw.objects.search");
    search.setAttribute("aria-label", t("draw.objects.search.label"));
    kindSelect.setAttribute("aria-label", t("draw.objects.kind"));
    FILTER_KINDS.forEach(([, label], index) => {
      kindSelect.options[index]!.textContent = t(label);
    });
    // I nomi cambiano con la lingua: il filtro li ripiega.
    folded = new WeakMap();
    if (filtering()) flatten();
    render();
  };

  return {
    element,
    update(next, selection, total) {
      entries = next;
      count = total;
      selected = new Set(selection);
      docOrder = new Map();
      const number = (list: readonly TreeEntry[]): void => {
        for (const entry of list) {
          docOrder.set(entry.key, docOrder.size);
          number(entry.children);
        }
      };
      number(entries);
      const following = !tree.contains(document.activeElement);
      const keys = selection.join("\n");
      if (following && keys !== followed && selection.length > 0) unfold(selection[0]!);
      followed = keys;
      flatten();
      // Una voce che se ne va si porta via il suo campo del nome.
      if (renaming !== null && indexOf(renaming) < 0) finishRename(false, true);
      const first = following ? rows.find((row) => selected.has(row.entry.key))?.entry.key ?? null : null;
      if (first !== null && first !== active) {
        active = first;
        anchor = first;
        render();
        reveal();
      } else {
        render();
      }
    },
    focus() {
      tree.focus({ preventScroll: true });
    },
    setFiltering(on) {
      if (filterBar.hidden === !on) return;
      filterBar.hidden = !on;
      if (on) return;
      search.value = "";
      kindSelect.value = "all";
      applyFilter();
    },
    rename(key) {
      if (indexOf(key) < 0) {
        unfold(key);
        flatten();
        // Una voce che il filtro non mostra lo svuota.
        if (indexOf(key) < 0 && filtering()) {
          search.value = "";
          kindSelect.value = "all";
          applyFilter();
        }
        render();
      }
      return startRename(key);
    },
    relabel,
  };
}
