// L'albero degli oggetti: il disegno come elenco, sincronizzato con la scena
// e con la selezione. È la via al disegno per chi non vede il foglio, e per
// chi vuole scegliere un oggetto senza puntarlo.
//
// - **Il dato è quello della scena.** Le voci le dà l'editor, dalle voci del
//   testo e dall'indice degli oggetti che il foglio tocca: nessun secondo
//   calcolo, e un oggetto si sceglie qui solo se si sceglie sul foglio.
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
// - **Bloccare e nascondere da qui.** Ctrl o ⌘ con Maiusc e L blocca o
//   sblocca la riga attiva, con H la nasconde o la mostra; col puntatore, i
//   segni accanto al nome.
// - **Mai il solo colore.** Una riga scelta ha il segno di spunta; un livello
//   o un gruppo aperto o chiuso, la sua freccia; un oggetto bloccato o
//   nascosto, il suo segno, e il nome lo dice a parole; un oggetto che non si
//   sceglie, il corsivo, e chi lo contiene dice a parole perché.
// - **Virtualizzato** oltre [`VIRTUAL_AFTER`] righe: si disegnano quelle che si
//   vedono, più qualcuna, e la riga attiva.

import { plural, t } from "../strings";
import { identifier, stableIdentifier } from "../../../ui/a11y";
import { icon, iconEl, registerIcon } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";

/// Oltre questo numero di righe l'albero disegna solo quelle che si vedono.
export const VIRTUAL_AFTER = 500;

/// L'altezza di una riga quando l'albero è virtualizzato: un bersaglio da
/// 44 px, come ogni bersaglio del livello Essenziale.
export const ROW_PX = 44;

/// Le righe disegnate oltre quelle che si vedono, sopra e sotto.
const OVERSCAN = 8;

/// Le icone dei segni, col costrutto di `ui/icons.ts`: il lucchetto e
/// l'occhio sbarrato.
const ICONS: Readonly<Record<string, readonly string[]>> = {
  "draw-lock": ["M6 11h12v9H6z", "M8.5 11V8a3.5 3.5 0 0 1 7 0v3"],
  "draw-hidden": ["M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z", "M9.5 12a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0", "M4 4l16 16"],
};

/// Che cosa cambia un segno: il blocco o la visibilità.
export type TreeToggle = "lock" | "hide";

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
  /// I figli di un livello, o di un gruppo o di un collegamento che si apre.
  readonly children: readonly TreeEntry[];
  /// Il nome a parole; si chiede solo per le righe disegnate.
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
}

export interface ObjectTree {
  /// Il pannello: titolo, conteggio e albero.
  readonly element: HTMLElement;
  /// Le voci e la selezione di adesso. Se il fuoco non è nell'albero, la riga
  /// attiva va al primo oggetto scelto.
  update(entries: readonly TreeEntry[], selection: readonly string[], count: number): void;
  focus(): void;
  /// Riscrive i testi nella lingua di adesso.
  relabel(): void;
}

interface Row {
  readonly entry: TreeEntry;
  readonly level: number;
  readonly setsize: number;
  readonly posinset: number;
  /// L'indice della riga del livello che la contiene; `-1` in cima.
  readonly parent: number;
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
  const empty = document.createElement("p");
  empty.className = "draw-objects-empty";
  const scroller = document.createElement("div");
  scroller.className = "draw-objects-scroll";
  const tree = document.createElement("div");
  tree.className = "draw-objects-tree";
  tree.setAttribute("role", "tree");
  tree.setAttribute("aria-multiselectable", "true");
  tree.setAttribute("aria-labelledby", heading.id);
  tree.tabIndex = 0;
  scroller.append(tree);
  element.setAttribute("aria-labelledby", heading.id);
  element.append(header, empty, scroller);

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

  /// Vero se `entry` si apre: un livello, o un oggetto con dei figli.
  const expandable = (entry: TreeEntry): boolean => entry.layer || entry.children.length > 0;
  const isOpen = (entry: TreeEntry): boolean => (entry.layer ? !collapsed.has(entry.key) : opened.has(entry.key));

  const flatten = (): void => {
    rows = [];
    const visit = (list: readonly TreeEntry[], level: number, parent: number): void => {
      list.forEach((entry, index) => {
        const at = rows.length;
        rows.push({ entry, level, setsize: list.length, posinset: index + 1, parent });
        if (expandable(entry) && isOpen(entry)) visit(entry.children, level + 1, at);
      });
    };
    visit(entries, 1, -1);
  };

  /// Apre ciò che contiene la voce `key`, a ogni profondità. Vero se l'ha
  /// trovata.
  const unfold = (key: string): boolean => {
    const visit = (list: readonly TreeEntry[]): boolean => list.some((entry) => {
      if (entry.key === key) return true;
      if (!visit(entry.children)) return false;
      if (entry.layer) collapsed.delete(entry.key);
      else opened.add(entry.key);
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
    if (expandable(entry)) item.setAttribute("aria-expanded", String(isOpen(entry)));
    else item.removeAttribute("aria-expanded");
    if (entry.layer) item.removeAttribute("aria-selected");
    else item.setAttribute("aria-selected", String(selected.has(entry.key)));
    if (!entry.layer && !entry.selectable) item.setAttribute("aria-disabled", "true");
    else item.removeAttribute("aria-disabled");
    item.toggleAttribute("data-active", entry.key === active);
    item.toggleAttribute("data-toggles", entry.toggles && options.onToggle !== undefined);
    const [twisty, mark, label, signs] = item.children as unknown as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    const arrow = expandable(entry) ? (isOpen(entry) ? "▾" : "▸") : "";
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
    empty.hidden = rows.length > 0;
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

  /// La selezione in ordine di righe, che è l'ordine del documento.
  const ordered = (keys: Set<string>): string[] => rows.filter((row) => keys.has(row.entry.key)).map((row) => row.entry.key);

  const choose = (keys: Set<string>): void => {
    selected = keys;
    options.onSelect(ordered(keys));
  };

  /// Le righe che si scelgono fra `from` e `to`, comprese.
  const range = (from: number, to: number): Set<string> => {
    const keys = new Set<string>();
    for (let index = Math.min(from, to); index <= Math.max(from, to); index++) if (selectable(index)) keys.add(rows[index]!.entry.key);
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
      choose(new Set(row.entry.children.filter((child) => child.selectable).map((child) => child.key)));
    } else if (row.entry.selectable) {
      const next = new Set(selected);
      if (!next.delete(row.entry.key)) next.add(row.entry.key);
      choose(next);
    }
    render();
  };

  const setExpanded = (entry: TreeEntry, open: boolean): void => {
    if (entry.layer) {
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

  life.listen(tree, "keydown", (event) => {
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
        if (row !== undefined && expandable(row.entry)) {
          if (!isOpen(row.entry)) setExpanded(row.entry, true);
          else if (row.entry.children.length > 0) moveTo(at + 1, mode);
        }
        break;
      case "ArrowLeft":
        if (row !== undefined && expandable(row.entry) && isOpen(row.entry)) setExpanded(row.entry, false);
        else if (row !== undefined && row.parent >= 0) moveTo(row.parent, mode);
        break;
      case " ":
        if (at >= 0) toggle(at);
        break;
      case "Enter":
        if (row?.entry.layer) {
          setExpanded(row.entry, !isOpen(row.entry));
        } else if (row !== undefined && row.entry.selectable) {
          if (!selected.has(row.entry.key)) {
            anchor = row.entry.key;
            choose(new Set([row.entry.key]));
            render();
          }
          options.onActivate();
        }
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

  life.listen(tree, "click", (event) => {
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
    if (row.entry.layer || (twisty && expandable(row.entry))) {
      active = row.entry.key;
      setExpanded(row.entry, !isOpen(row.entry));
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      active = row.entry.key;
      toggle(index);
      return;
    }
    moveTo(index, event.shiftKey ? "extend" : "select");
  });

  life.listen(tree, "dblclick", (event) => {
    const row = rows[rowOf(event.target)];
    if (row !== undefined && !row.entry.layer && row.entry.selectable) options.onActivate();
  });

  life.listen(scroller, "scroll", () => {
    if (rows.length > VIRTUAL_AFTER) render();
  });

  const relabel = (): void => {
    heading.textContent = t("draw.objects");
    empty.textContent = t("draw.objects.empty");
    render();
  };

  return {
    element,
    update(next, selection, total) {
      entries = next;
      count = total;
      selected = new Set(selection);
      const following = !tree.contains(document.activeElement);
      const keys = selection.join("\n");
      if (following && keys !== followed && selection.length > 0) unfold(selection[0]!);
      followed = keys;
      flatten();
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
    relabel,
  };
}
