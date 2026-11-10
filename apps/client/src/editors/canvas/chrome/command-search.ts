// La ricerca dei comandi della lavagna (Ctrl+/): un campo e il catalogo
// (`commands.ts`), col tasto e il posto di ogni comando, in un popover del
// kit sopra la tela. Cerca con `rankCommands` del disegno e ne veste
// l'aspetto (le stesse classi `draw-commands-*`), così le due ricerche sono
// una. Un comando spento si vede, col perché, e non si sceglie; i comandi
// usati di recente in quella lavagna stanno in cima. La palette dello
// Scrittoio (Ctrl+Maiusc+P) resta sua.
//
// I recenti sono una comodità di questo computer: stanno nello stato di vista
// `canvas.commands:<documento>`. Se non si leggono o non si scrivono, la
// ricerca va avanti con quelli della sessione.

import { api } from "../../../host/ipc";
import { t } from "../../../i18n/strings";
import { createList, openPopover } from "../../../kit";
import type { PopoverAnchor, PopoverCloseReason, PopoverHandle } from "../../../kit/popover";
import { rankCommands, type FoundCommand } from "../../spatial/tools/editor/chrome/command-search";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { commandHint, type CanvasCommand } from "./commands";

/// Quanti comandi recenti si ricordano per lavagna.
export const RECENT_COMMANDS_LIMIT = 5;

/// La versione dello stato dei recenti.
export const RECENT_COMMANDS_VERSION = 1;

/// La chiave dello stato di vista dei recenti della lavagna `documentId`.
export function recentCommandsKey(documentId: string): string {
  return `canvas.commands:${documentId}`;
}

/// Dove si leggono e si scrivono i recenti di una lavagna.
export interface RecentCommandsStore {
  read(documentId: string): Promise<unknown>;
  write(documentId: string, value: unknown): Promise<void>;
}

/// Gli id ricordati in `value`, se è uno stato che si legge: un id del
/// catalogo, al più `RECENT_COMMANDS_LIMIT`, senza doppi. Il resto non vale.
export function parseRecentCommands(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  const state = value as { version?: unknown; recent?: unknown };
  if (state.version !== RECENT_COMMANDS_VERSION || !Array.isArray(state.recent)) return [];
  const found: string[] = [];
  for (const id of state.recent) {
    if (typeof id === "string" && id.startsWith("canvas.") && !found.includes(id)) found.push(id);
    if (found.length === RECENT_COMMANDS_LIMIT) break;
  }
  return found;
}

/// I recenti di ogni lavagna: letti una volta, scritti a ogni scelta. Una
/// lettura o una scrittura che non riesce non dice niente.
export class RecentCommands {
  readonly #store: RecentCommandsStore | null;
  readonly #lists = new Map<string, string[]>();
  readonly #loading = new Map<string, Promise<void>>();

  constructor(store: RecentCommandsStore | null) {
    this.#store = store;
  }

  /// I recenti di `documentId`, dal più recente.
  list(documentId: string): readonly string[] {
    return this.#lists.get(documentId) ?? [];
  }

  /// Legge i recenti ricordati di `documentId`, una volta. Quelli scelti
  /// mentre si leggeva restano davanti.
  load(documentId: string): Promise<void> {
    const store = this.#store;
    if (store === null) return Promise.resolve();
    let loading = this.#loading.get(documentId);
    if (loading === undefined) {
      loading = Promise.resolve()
        .then(() => store.read(documentId))
        .then((value) => {
          const now = this.list(documentId);
          const merged = [...now, ...parseRecentCommands(value).filter((id) => !now.includes(id))];
          this.#lists.set(documentId, merged.slice(0, RECENT_COMMANDS_LIMIT));
        })
        .catch(() => undefined);
      this.#loading.set(documentId, loading);
    }
    return loading;
  }

  /// `id` è appena stato scelto in `documentId`: va in cima e si ricorda.
  remember(documentId: string, id: string): void {
    const next = [id, ...this.list(documentId).filter((one) => one !== id)].slice(0, RECENT_COMMANDS_LIMIT);
    this.#lists.set(documentId, next);
    const store = this.#store;
    if (store === null) return;
    // Una lettura in corso finisce prima: la scrittura non cancella i
    // ricordati che stanno arrivando, e scrive l'elenco unito.
    const before = this.#loading.get(documentId) ?? Promise.resolve();
    void before
      .then(() => store.write(documentId, { version: RECENT_COMMANDS_VERSION, recent: [...this.list(documentId)] }))
      .catch(() => undefined);
  }
}

/// I recenti di tutte le lavagne di questa finestra, negli stati di vista.
export const SHARED_RECENT_COMMANDS = new RecentCommands({
  read: (documentId) => api.viewState<unknown>(recentCommandsKey(documentId)),
  write: (documentId, value) => api.setViewState(recentCommandsKey(documentId), value),
});

/// Un comando come lo cerca `rankCommands`.
function found(command: CanvasCommand): FoundCommand {
  const why = command.disabled();
  const hint = commandHint(command);
  return {
    key: command.id,
    label: command.label,
    path: command.path,
    ...(hint === "" ? {} : { hint }),
    disabled: why !== null,
    ...(why === null ? {} : { description: why }),
    run: () => command.run(),
  };
}

export interface CommandSearchOptions {
  /// Dove si apre: sopra la tela, in alto al centro.
  anchor: PopoverAnchor;
  /// Il catalogo di adesso.
  commands: readonly CanvasCommand[];
  /// Gli id usati di recente, dal più recente: si rileggono a ogni `refresh`.
  recent: () => readonly string[];
  /// Chiuderla chiude la ricerca.
  lifetime: Lifetime;
  /// La ricerca si è chiusa: con un comando scelto (`chosen`), o no. Il
  /// comando lo esegue chi l'ha aperta, dopo che il fuoco è tornato.
  onClose: (reason: PopoverCloseReason, chosen: CanvasCommand | null) => void;
}

/// La ricerca aperta.
export interface CommandSearchHandle {
  readonly popover: PopoverHandle;
  /// Rifà l'elenco: i recenti sono cambiati.
  refresh(): void;
  close(): void;
}

/// Apre la ricerca dei comandi. Esc la chiude e rimette il fuoco dov'era.
export function openCommandSearch(options: CommandSearchOptions): CommandSearchHandle {
  const own = openLifetime();
  options.lifetime.add(() => own.close());
  const byId = new Map(options.commands.map((command) => [command.id, command]));
  const all = options.commands.map(found);

  const body = document.createElement("div");
  body.className = "draw-commands";
  const field = document.createElement("label");
  field.className = "draw-commands-field";
  const name = document.createElement("span");
  name.textContent = t("canvas.commands.search");
  const input = document.createElement("input");
  input.type = "search";
  input.autocomplete = "off";
  input.spellcheck = false;
  field.append(name, input);
  // Lo scorrimento sta fuori dalla lista: dentro un contenitore alto al più
  // mezza finestra le righe della lista (in colonna flessibile) si
  // stringerebbero, e il perché di un comando spento finirebbe sotto la riga
  // dopo.
  const scroller = document.createElement("div");
  scroller.className = "draw-commands-list";
  const rows = document.createElement("div");
  rows.setAttribute("aria-label", t("canvas.commands"));
  scroller.append(rows);
  const empty = document.createElement("p");
  empty.className = "draw-commands-empty";
  empty.setAttribute("role", "status");
  body.append(field, scroller, empty);

  let chosen: CanvasCommand | null = null;
  const popover = openPopover({
    anchor: options.anchor,
    content: body,
    placement: "bottom",
    align: "center",
    label: t("canvas.commands"),
    className: "draw-commands-dialog",
    lifetime: own,
    onClose: (reason) => {
      own.close();
      options.onClose(reason, chosen);
    },
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
      chosen = byId.get(one.key) ?? null;
      popover.close("manual");
    },
    lifetime: own,
  });
  const refresh = (): void => {
    if (popover.closed) return;
    const shown = rankCommands(all, input.value, options.recent());
    list.setItems(shown);
    empty.textContent = shown.length === 0 ? t("canvas.commands.none") : "";
    popover.reposition();
  };
  own.listen(input, "input", refresh);
  refresh();
  input.focus();
  return { popover, refresh, close: () => popover.close("manual") };
}
