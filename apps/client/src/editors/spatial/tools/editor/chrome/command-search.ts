// La ricerca dei comandi del disegno (E3): Ctrl+/ apre un campo e il catalogo
// dei comandi (`commands.ts`), col tasto e il posto da cui vengono. Un comando spento si
// vede col perché, e non si sceglie. I comandi usati da poco stanno in cima.
// La palette dello Scrittoio (Ctrl+Maiusc+P) resta sua.

import { createList, openDialog } from "../../../../../kit";
import { fuzzyScore } from "../../../../../ui/fuzzy";
import { openLifetime } from "../../../../../ui/lifetime";
import { t } from "../../../strings";
import type { EditorContext } from "../context";
import type { DrawCommand } from "./commands";

export interface CommandSearchContext {
  /// Apre la ricerca dei comandi.
  searchCommands: () => void;
}

/// Un comando che si cerca: quelli del catalogo.
export type FoundCommand = Pick<DrawCommand, "label" | "path" | "hint" | "disabled" | "description" | "run"> & {
  /// L'id del catalogo: ciò che i recenti ricordano.
  readonly key: string;
};

/// Quanti comandi recenti si ricordano.
const RECENT_LIMIT = 5;

/// I comandi per `query`, dai più pertinenti: prima quelli il cui nome
/// comincia con la ricerca, poi quelli che la contengono, poi quelli che ne
/// hanno le lettere in ordine, nel nome o nel posto; a parità i più compatti.
/// Senza ricerca, i recenti in cima e poi tutti nel loro ordine.
export function rankCommands(all: readonly FoundCommand[], query: string, recent: readonly string[]): FoundCommand[] {
  const q = query.trim().toLowerCase();
  if (q === "") {
    const first = recent.flatMap((key) => all.find((one) => one.key === key) ?? []);
    return [...first, ...all.filter((one) => !recent.includes(one.key))];
  }
  const scored: { one: FoundCommand; rank: number; score: number; at: number }[] = [];
  all.forEach((one, at) => {
    const label = one.label.toLowerCase();
    if (label.startsWith(q)) scored.push({ one, rank: 0, score: 0, at });
    else if (label.includes(q)) scored.push({ one, rank: 1, score: label.indexOf(q), at });
    else {
      const sparse = fuzzyScore(one.label, q);
      const placed = sparse === null ? fuzzyScore(`${one.path} ${one.label}`, q) : null;
      if (sparse !== null) scored.push({ one, rank: 2, score: sparse, at });
      else if (placed !== null) scored.push({ one, rank: 3, score: placed, at });
    }
  });
  scored.sort((a, b) => a.rank - b.rank || a.score - b.score || a.at - b.at);
  return scored.map(({ one }) => one);
}

export function installCommandSearch(ctx: EditorContext): void {
  const recent: string[] = [];
  /// La vita della ricerca aperta: chiudere l'editor la chiude.
  let open: ReturnType<typeof openLifetime> | null = null;
  ctx.life.add(() => open?.close());

  /// Il catalogo com'è adesso.
  const commands = (): FoundCommand[] => ctx.commands().map((one) => ({ ...one, key: one.id }));

  ctx.searchCommands = () => {
    if (ctx.asking || ctx.disposed) return;
    ctx.asking = true;
    ctx.cancelGesture();
    const own = openLifetime();
    open = own;
    const all = commands();
    const body = document.createElement("div");
    body.className = "draw-commands";
    const field = document.createElement("label");
    field.className = "draw-commands-field";
    const name = document.createElement("span");
    name.textContent = t("draw.commands.search");
    const input = document.createElement("input");
    input.type = "search";
    input.autocomplete = "off";
    input.spellcheck = false;
    field.append(name, input);
    const rows = document.createElement("div");
    rows.className = "draw-commands-list";
    rows.setAttribute("aria-label", t("draw.commands"));
    const empty = document.createElement("p");
    empty.className = "draw-commands-empty";
    empty.setAttribute("role", "status");
    body.append(field, rows, empty);

    let chosen: FoundCommand | null = null;
    const dialog = openDialog<null>({
      title: t("draw.commands"),
      body,
      actions: [{ id: "close", label: t("draw.commands.close"), value: null }],
      dismissValue: null,
      lifetime: own,
      className: "draw-commands-dialog",
    });
    const list = createList<FoundCommand>({
      container: rows,
      role: "listbox",
      items: [],
      owner: input,
      key: (one) => one.key,
      disabled: (one) => one.disabled,
      render: (one, row) => {
        row.classList.add("draw-commands-row");
        const label = document.createElement("span");
        label.className = "draw-commands-label";
        label.textContent = one.label;
        const where = document.createElement("span");
        where.className = "draw-commands-path";
        where.textContent = one.path;
        row.append(label, where);
        if (one.hint !== undefined && one.hint !== "") {
          const kbd = document.createElement("kbd");
          kbd.className = "draw-commands-key";
          kbd.textContent = one.hint;
          row.append(kbd);
        }
        if (one.disabled && one.description !== undefined) {
          const why = document.createElement("span");
          why.className = "draw-commands-why";
          why.textContent = one.description;
          row.append(why);
        }
      },
      onActivate: (one) => {
        if (one.disabled) return;
        chosen = one;
        dialog.close(null);
      },
      lifetime: own,
    });
    const refresh = (): void => {
      const shown = rankCommands(all, input.value, recent);
      list.setItems(shown);
      empty.textContent = shown.length === 0 ? t("draw.commands.none") : "";
    };
    own.listen(input, "input", refresh);
    refresh();
    input.focus();
    void dialog.result.then(() => {
      ctx.asking = false;
      own.close();
      if (open === own) open = null;
      const run = chosen;
      if (run === null || ctx.disposed) return;
      const at = recent.indexOf(run.key);
      if (at >= 0) recent.splice(at, 1);
      recent.unshift(run.key);
      recent.length = Math.min(recent.length, RECENT_LIMIT);
      run.run();
    });
  };
}
