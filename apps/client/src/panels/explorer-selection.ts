// Più note scelte insieme nell'albero.
//
// Ctrl/Cmd-clic aggiunge o toglie una nota dalla scelta, Maiusc-clic sceglie
// tutte le note visibili fra l'ultima toccata e questa, Ctrl-Spazio fa come il
// Ctrl-clic da tastiera. Una barra sopra l'albero dice quante sono e offre i
// gesti che hanno senso su un gruppo — **sposta in…**, **in una cartella
// nuova** e **cestina** — più «deseleziona»; Esc la azzera. Un clic normale riprende a funzionare com'è:
// azzera la scelta e apre la nota.
//
// # Solo ciò che si vede
//
// La scelta è sulle note che l'albero disegna adesso. Una cartella che si
// chiude, una rinomina, un vault che cambia: ciò che esce dal DOM esce dalla
// scelta, perché un gesto distruttivo non deve mai toccare una nota che chi
// lo fa non sta guardando.
//
// # Chi fa che cosa
//
// Questo file possiede la scelta e la sua resa. I gesti sulla scelta (cestina,
// sposta) restano dell'esploratore, che li passa dentro: qui non si sa niente
// di sessioni, di cestino o di rinomina.
import { t } from "../i18n/strings";
import type { Lifetime } from "../ui/lifetime";
import type { MenuItem } from "../ui/menu";

export interface TreeSelectionHost {
  /// L'albero (`#file-list`).
  readonly list: HTMLElement;
  /// La nota aperta: la sua riga è già «selezionata» per un altro motivo.
  currentDoc(): string | null;
  trash(paths: string[]): Promise<unknown>;
  move(paths: string[]): Promise<unknown>;
  /// Una cartella nuova, con dentro le note scelte.
  group(paths: string[]): Promise<unknown>;
  /// Le note scelte negli appunti dell'albero, per incollarle altrove.
  copy(paths: string[]): void;
  readonly lifetime: Lifetime;
}

export interface TreeSelection {
  /// Ridisegna lo stato dopo che l'albero è stato rifatto.
  repaint(): void;
  clear(): void;
  paths(): string[];
  /// Il menu del tasto destro su `path` quando è scelta insieme ad altre: i
  /// gesti del gruppo, che valgono per tutte. `null` se `path` non è in una
  /// scelta di almeno due, e allora vale il menu della nota.
  menuFor(path: string): MenuItem[] | null;
}

export function mountTreeSelection(host: TreeSelectionHost): TreeSelection {
  const { list, lifetime } = host;
  const picked = new Set<string>();
  let anchor: string | null = null;

  const bar = document.createElement("div");
  bar.className = "tree-selection";
  bar.setAttribute("role", "toolbar");
  bar.hidden = true;
  const count = document.createElement("span");
  count.className = "tree-selection-count";
  count.setAttribute("aria-live", "polite");
  const button = (label: string, className: string, run: () => void): HTMLButtonElement => {
    const each = document.createElement("button");
    each.type = "button";
    each.className = `tree-selection-action ${className}`;
    each.textContent = label;
    lifetime.listen(each, "click", run);
    return each;
  };
  const move = button("", "tree-selection-move", () => void act(host.move));
  const group = button("", "tree-selection-group", () => void act(host.group));
  const trash = button("", "tree-selection-trash", () => void act(host.trash));
  const clearButton = button("", "tree-selection-clear", () => clear());
  bar.append(count, move, group, trash, clearButton);
  list.before(bar);
  lifetime.add(() => bar.remove());
  list.setAttribute("aria-multiselectable", "true");
  lifetime.add(() => list.removeAttribute("aria-multiselectable"));

  /// Le note che l'albero mostra, in ordine di lettura. Cartelle e file che non
  /// sono note non si scelgono: i gesti della barra sono per le note.
  const notes = (): HTMLElement[] =>
    [...list.querySelectorAll<HTMLElement>('li[role="treeitem"]')].filter(
      (li) => li.dataset.path !== undefined && li.querySelector(":scope > .tree-row.note") !== null,
    );

  const label = (): void => {
    bar.setAttribute("aria-label", t("explorer.selection.label"));
    move.textContent = t("explorer.selection.move");
    group.textContent = t("explorer.selection.group");
    trash.textContent = t("explorer.selection.trash");
    clearButton.textContent = t("explorer.selection.clear");
    count.textContent = t("explorer.selection.count", { n: String(picked.size) });
  };

  const repaint = (): void => {
    const visible = notes();
    const here = new Set(visible.map((li) => li.dataset.path!));
    for (const path of [...picked]) if (!here.has(path)) picked.delete(path);
    if (anchor !== null && !here.has(anchor)) anchor = null;
    for (const li of visible) {
      const on = picked.has(li.dataset.path!);
      if (on) {
        li.dataset.picked = "true";
        li.setAttribute("aria-selected", "true");
      } else if (li.dataset.picked !== undefined) {
        delete li.dataset.picked;
        if (li.dataset.path !== host.currentDoc()) li.removeAttribute("aria-selected");
      }
    }
    bar.hidden = picked.size === 0;
    label();
  };

  function clear(): void {
    if (picked.size === 0) return;
    picked.clear();
    anchor = null;
    repaint();
  }

  const toggle = (li: HTMLElement): void => {
    const path = li.dataset.path!;
    if (picked.has(path)) picked.delete(path);
    else picked.add(path);
    anchor = path;
    repaint();
  };

  const range = (li: HTMLElement): void => {
    const visible = notes();
    const to = visible.indexOf(li);
    const from = anchor === null ? -1 : visible.findIndex((each) => each.dataset.path === anchor);
    if (from < 0) {
      toggle(li);
      return;
    }
    picked.clear();
    const [a, b] = from < to ? [from, to] : [to, from];
    for (const each of visible.slice(a, b + 1)) picked.add(each.dataset.path!);
    repaint();
  };

  async function act(run: (paths: string[]) => Promise<unknown>): Promise<void> {
    const paths = [...picked];
    if (paths.length === 0) return;
    try {
      await run(paths);
    } finally {
      // Qualunque cosa sia successa, la scelta ha fatto il suo lavoro: le note
      // rimaste (un rifiuto, un guasto) si riscelgono guardandole.
      if (!lifetime.closed) clear();
    }
  }

  const rowOf = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    const li = target.closest<HTMLElement>('li[role="treeitem"]');
    // La riga della nota, non quella di una nota annidata sotto una cartella.
    return li && notes().includes(li) ? li : null;
  };

  lifetime.listen(
    list,
    "click",
    (event) => {
      const li = rowOf(event.target);
      const modified = event.ctrlKey || event.metaKey || event.shiftKey;
      if (li && modified) {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) range(li);
        else toggle(li);
        return;
      }
      // Un clic normale apre la nota e lascia la scelta: la scelta era di prima.
      if (picked.size > 0) clear();
    },
    { capture: true },
  );
  lifetime.listen(
    list,
    "keydown",
    (event) => {
      if (event.key === " " && event.ctrlKey) {
        const li = rowOf(event.target);
        if (!li) return;
        event.preventDefault();
        event.stopPropagation();
        toggle(li);
      }
    },
    { capture: true },
  );
  lifetime.listen(
    bar.parentElement ?? list,
    "keydown",
    (event) => {
      if (event.key !== "Escape" || picked.size === 0) return;
      const target = event.target;
      if (!(target instanceof Node) || !(list.contains(target) || bar.contains(target))) return;
      event.preventDefault();
      clear();
    },
  );
  lifetime.add(() => picked.clear());
  repaint();

  const menuFor = (path: string): MenuItem[] | null => {
    if (!picked.has(path) || picked.size < 2) return null;
    return [
      { label: t("explorer.copy"), run: () => host.copy([...picked]) },
      { label: t("explorer.selection.move"), run: () => void act(host.move) },
      { label: t("explorer.selection.group"), run: () => void act(host.group) },
      { label: t("explorer.selection.clear"), run: () => clear() },
      { separator: true, label: t("explorer.selection.trash"), hint: "Del", danger: true, run: () => void act(host.trash) },
    ];
  };

  return { repaint, clear, paths: () => [...picked], menuFor };
}
