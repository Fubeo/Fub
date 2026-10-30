// Il menu del tasto destro negli editor: la superficie dice cosa offre
// (`SurfaceMenu`), questo modulo lo compone nell'anatomia di tutti i menu
// dell'editor e lo apre.
//
// # L'anatomia
//
// - la testata: che cosa c'è sotto il puntatore e il suo nome;
// - la riga degli appunti, quando ci sono almeno due gesti da fare: con uno
//   solo, «Incolla» è una voce come le altre;
// - le voci del posto, nei gruppi che la superficie dice;
// - «Formato ▸», «Trasforma in ▸», «Inserisci ▸» dove la superficie li
//   offre, e «Formato» soltanto dove non c'è la mini-barra;
// - «Dai plugin ▸», dopo le voci di Fub;
// - in fondo, in rosso, ciò che cancella.
//
// Tutto il resto — i comandi del vault, Cerca nel documento, Seleziona tutto,
// le voci in più della superficie — non ruba un posto: si trova scrivendo.
// Nessun tetto che taglia: un posto che passa nove voci o quattro gruppi lo
// dice il test del bilancio (`ui/menu-budget.test.ts`).
//
// # Senza IPC
//
// Il menu si apre con quello che la shell sa già: le azioni le dice la
// superficie, i comandi stanno nella cache (`state.commandSpecs`). Soltanto le
// voci dei plugin per una nota si chiedono quando si apre il loro sottomenu, e
// la loro attesa ha già un limite (`context-views.ts`).
import type { CommandSpec } from "../host/contract";
import type { EditorSurface, SurfacePoint } from "../editors/core/registry";
import { MENU_RULE, type SurfaceMenu, type SurfaceMenuEntry, type SurfaceMenuItem, type SurfaceMenuTargetKind } from "../editors/core/editor-menu";
import { t, type Key } from "../i18n/strings";
import { displayBinding, type CommandEntry } from "../ui/commands";
import { contextMenuItems, hasContextMenuViews } from "../ui/context-views";
import { canMenuFind, menuFind, menuPointFor, showContextMenu, type MenuHeader, type MenuItem, type MenuPoint } from "../ui/menu";
import { slashCandidates } from "../state/slash";
import { ACTION_LOOKS } from "./format-bar";

/// I comandi della shell che ogni superficie che li sa servire lascia
/// trovare scrivendo: la loro disponibilità la dice il comando stesso.
const UTILITIES = ["shell.doc.copy_anchor_link", "shell.doc.search"] as const;

/// L'icona della testata per ciò che sta sotto il puntatore.
const HEAD_ICONS: Partial<Record<SurfaceMenuTargetKind, string>> = {
  text: "notes", selection: "notes", page: "notes", link: "publish", wikilink: "backlinks", tag: "tag",
  heading: "fmt-h2", list: "fmt-bullets", task: "fmt-tasks", code: "fmt-codeblock", table: "fmt-table",
  image: "fmt-image", properties: "properties", block: "outline", cell: "format-sheet", row: "format-sheet",
  column: "format-sheet", corner: "format-sheet", sheet: "format-sheet", node: "format-drawing",
  edge: "format-drawing", group: "format-drawing", object: "format-drawing", media: "fmt-image",
};

/// Il tipo della testata, per ciò che lo ha uguale in ogni superficie.
const HEAD_LABELS: Partial<Record<SurfaceMenuTargetKind, Key>> = {
  text: "editor_menu.head.text", selection: "editor_menu.head.selection", link: "editor_menu.head.link",
  wikilink: "editor_menu.head.wikilink", tag: "editor_menu.head.tag", heading: "editor_menu.head.heading",
  list: "editor_menu.head.list", task: "editor_menu.head.task", code: "editor_menu.head.code",
  table: "editor_menu.head.table", image: "editor_menu.head.image", properties: "editor_menu.head.properties",
  spelling: "editor_menu.head.spelling", block: "editor_menu.head.block", cell: "editor_menu.head.cell",
  row: "editor_menu.head.row", column: "editor_menu.head.column", sheet: "editor_menu.head.sheet",
  edge: "editor_menu.head.edge", group: "editor_menu.head.group",
};

export interface EditorMenuHost {
  /// La superficie del riquadro, se ce n'è una montata.
  surface(): EditorSurface | null;
  /// I comandi del registro, dalla cache.
  specs(): readonly CommandSpec[];
  /// I comandi della palette (registro e shell), per nome, accordo e gesto.
  commands(): readonly CommandEntry[];
  /// Il testo scelto adesso, per i comandi che lavorano su una selezione.
  selection(): string;
  /// Esegue un comando del registro per la via del «/»: moduli, piano e
  /// flush prima di scrivere.
  runSlash(id: string): void;
  /// Esegue un comando della palette.
  runCommand(id: string): void;
  /// Il riquadro diventa quello attivo, senza spostare il fuoco.
  focusPane(): void;
  /// La mini-barra da mostrare sopra il menu, se adesso ce n'è una.
  miniBar?(menu: SurfaceMenu): ((host: HTMLElement) => () => void) | null;
}

/// Il menu composto: le parti che `showContextMenu` disegna.
export interface ComposedEditorMenu {
  readonly header?: MenuHeader;
  /// La riga degli appunti: vuota con meno di due gesti.
  readonly clipboard: readonly MenuItem[];
  /// Il primo livello, coi gruppi segnati da `separator`.
  readonly items: readonly MenuItem[];
  /// Ciò che si trova soltanto scrivendo.
  readonly searchable: readonly MenuItem[];
}

/// I gesti degli appunti, coi loro nomi, accordi e icone.
const CLIPBOARD = [
  { op: "cut", label: "editor_menu.cut", chord: "Mod-x", icon: "cut" },
  { op: "copy", label: "editor_menu.copy", chord: "Mod-c", icon: "copy" },
  { op: "paste", label: "editor_menu.paste", chord: "Mod-v", icon: "template" },
] as const;

/// Le voci del menu, composte nelle sue parti. Pura rispetto al DOM: è la
/// regola che i test leggono.
export function composeEditorMenu(menu: SurfaceMenu, host: EditorMenuHost): ComposedEditorMenu {
  const surface = host.surface();
  const commands = new Map(host.commands().map((entry) => [entry.id, entry]));
  const titles = new Map(host.specs().map((spec) => [spec.id, spec.title]));
  const resolve = (entries: readonly SurfaceMenuEntry[] | undefined): MenuItem[] =>
    (entries ?? []).flatMap((entry) => {
      if (entry === MENU_RULE) return [];
      const item = resolveEntry(entry, surface, commands, titles, host);
      return item ? [item] : [];
    });
  const nest = (key: Key, icon: string | undefined, entries: readonly SurfaceMenuEntry[] | undefined): MenuItem[] => {
    const items = resolve(entries);
    return items.length === 0 ? [] : [{ label: t(key), icon, items }];
  };
  const groups: MenuItem[][] = [];
  const searchable: MenuItem[] = [];

  // Gli appunti: soltanto i gesti che adesso si possono fare.
  const offers = menu.clipboard?.offers ?? {};
  const quick: MenuItem[] = CLIPBOARD.filter(({ op }) => offers[op] === true).map(({ op, label, chord, icon }) => ({
    label: t(label),
    icon,
    hint: displayBinding(chord) || undefined,
    run: () => menu.clipboard!.run(op),
  }));
  const plain: MenuItem | null = offers["paste-plain"] === true
    ? { label: t("editor_menu.paste_plain"), hint: displayBinding("Mod-Shift-v") || undefined, run: () => menu.clipboard!.run("paste-plain") }
    : null;
  const row = quick.length >= 2 ? quick : [];
  const loose: MenuItem[] = row.length > 0 ? [] : [...quick, ...(plain ? [plain] : [])];
  if (row.length > 0 && plain) searchable.push(plain);
  const copyAs = resolve(menu.clipboard?.copyAs);
  if (copyAs.length > 0) loose.push({ label: t("editor_menu.copy_as"), items: copyAs });
  if (loose.length > 0) groups.push(loose);

  // Le voci del posto, nei gruppi della superficie.
  let group: MenuItem[] = [];
  for (const entry of menu.context ?? []) {
    if (entry === MENU_RULE) {
      if (group.length > 0) groups.push(group);
      group = [];
      continue;
    }
    const item = resolveEntry(entry, surface, commands, titles, host);
    if (item) group.push(item);
  }
  if (group.length > 0) groups.push(group);

  // Il formato: con la mini-barra si trova scrivendo, senza è un sottomenu.
  const format = resolve(menu.format);
  if (menu.miniBar) searchable.push(...format);
  const edit = [
    ...(menu.miniBar || format.length === 0 ? [] : [{ label: t("editor_menu.format"), icon: "fmt-bold", items: format }]),
    ...nest("editor_menu.transform", "fmt-quote", menu.transform),
    ...resolve(menu.edit),
    ...nest("editor_menu.insert", "fmt-table", menu.insert),
  ];
  if (edit.length > 0) groups.push(edit);

  // I plugin, dopo le voci di Fub.
  const note = menu.note;
  if (note && hasContextMenuViews()) {
    groups.push([{ label: t("editor_menu.plugins"), items: () => contextMenuItems({ kind: note.kind, id: note.id }) }]);
  }

  // Ciò che cancella, sempre in fondo e da solo.
  const danger = groups.flatMap((items) => items.filter((item) => item.danger));
  const kept = groups.map((items) => items.filter((item) => !item.danger)).filter((items) => items.length > 0);
  if (danger.length > 0) kept.push(danger);

  // Il resto si trova scrivendo: le voci in più, i comandi, le utilità.
  searchable.push(...resolve(menu.searchable));
  if (menu.commands) {
    const actions = surface?.editorActions;
    // Le azioni dell'editor offerte anche al «/» stanno già nel menu e nella
    // mini-barra: qui i comandi del vault.
    searchable.push(...slashCandidates([...host.specs()], host.selection())
      .filter((spec) => !actions?.has(spec.id) && !ACTION_LOOKS[spec.id])
      .map((spec): MenuItem => ({
        label: spec.title,
        description: spec.description || undefined,
        hint: displayBinding(commands.get(spec.id)?.binding ?? spec.keybinding) || undefined,
        run: () => host.runSlash(spec.id),
      })));
  }
  searchable.push(...resolve(menu.tail));
  for (const id of UTILITIES) {
    if (id === "shell.doc.copy_anchor_link" && !surface?.anchorHere) continue;
    // Cercare serve dove c'è del testo da cercare: dove la superficie ha la
    // sua barra (note, documenti, codice). Su un PDF, un'immagine, un foglio
    // o una lavagna la ricerca dell'indice non troverebbe niente da mostrare.
    if (id === "shell.doc.search" && !surface?.find) continue;
    const item = resolveEntry(id, surface, commands, titles, host);
    if (item) searchable.push(item);
  }
  if (offers["select-all"] === true) {
    searchable.push({
      label: t("editor_menu.select_all"),
      hint: displayBinding("Mod-a") || undefined,
      run: () => menu.clipboard!.run("select-all"),
    });
  }
  // Una voce che sta già nel menu non si ripete fra quelle da trovare.
  const shown = new Set(kept.flat().map((item) => item.label));
  const extra = searchable.filter((item, index) =>
    !shown.has(item.label) && searchable.findIndex((other) => other.label === item.label) === index);

  return {
    header: headerOf(menu),
    clipboard: row,
    items: kept.flatMap((items) => items.map((item, index) => (index === 0 ? { ...item, separator: true } : item))),
    searchable: extra,
  };
}

/// La testata: il tipo dal catalogo, o quello che dice la superficie. Un
/// tipo senza nome qui (una pagina, che è di una nota come di un PDF) ha la
/// testata soltanto se la superficie lo nomina.
function headerOf(menu: SurfaceMenu): MenuHeader | undefined {
  const { kind, label, name } = menu.target;
  const known = HEAD_LABELS[kind];
  const text = label ?? (known === undefined ? null : t(known));
  if (text === null) return undefined;
  return { icon: HEAD_ICONS[kind], kind: text, ...(name ? { name } : {}) };
}

/// Una voce della superficie come voce del menu, o `null` se adesso non
/// c'è: un id che non è né un'azione della superficie né un comando
/// disponibile, un gesto che adesso non si fa, un sottomenu rimasto vuoto.
function resolveEntry(
  entry: SurfaceMenuEntry,
  surface: EditorSurface | null,
  commands: ReadonlyMap<string, CommandEntry>,
  titles: ReadonlyMap<string, string>,
  host: EditorMenuHost,
): MenuItem | null {
  if (typeof entry !== "string") return itemOf(entry, surface, commands, titles, host);
  const actions = surface?.editorActions;
  if (actions?.has(entry)) {
    // Il nome è quello del comando che dichiara l'azione: spento il plugin
    // che la offre, la voce non c'è, come il suo pulsante nella barra.
    const label = titles.get(entry);
    if (label === undefined) return null;
    // Una voce che adesso non si può fare non resta grigia senza dire perché:
    // non c'è.
    const state = actions.editable() ? actions.state(entry) : { enabled: false, active: null };
    if (!state.enabled) return null;
    const icon = ACTION_LOOKS[entry]?.icon || undefined;
    return {
      label,
      icon,
      hint: displayBinding(actions.chord(entry)) || undefined,
      ...(state.active === null ? {} : { choice: "checkbox" as const, checked: state.active }),
      run: () => {
        host.focusPane();
        surface?.focus?.();
        actions.run(entry);
      },
    };
  }
  const command = commands.get(entry);
  if (!command) return null;
  return {
    label: command.title,
    hint: displayBinding(command.binding) || undefined,
    run: () => host.runCommand(entry),
  };
}

function itemOf(
  entry: SurfaceMenuItem,
  surface: EditorSurface | null,
  commands: ReadonlyMap<string, CommandEntry>,
  titles: ReadonlyMap<string, string>,
  host: EditorMenuHost,
): MenuItem | null {
  const actions = surface?.editorActions;
  const action = entry.action !== undefined && actions?.has(entry.action) ? entry.action : null;
  // Una voce che esegue un'azione o un comando che qui non c'è non si vede.
  if (entry.action !== undefined && action === null) return null;
  if (entry.slash !== undefined && !titles.has(entry.slash)) return null;
  if (entry.find !== undefined && !canMenuFind()) return null;
  const state = action === null ? null : actions!.editable() ? actions!.state(action) : { enabled: false, active: null };
  const checked = entry.checked ?? (entry.radio ? state?.active === true : undefined);
  const disabled = entry.enabled === false || state?.enabled === false;
  // Grigia soltanto con un motivo da leggere; altrimenti non c'è.
  if (disabled && !entry.description) return null;
  const base: MenuItem = {
    label: entry.label,
    icon: entry.icon,
    hint: displayBinding(entry.chord ?? (action === null ? null : actions!.chord(action))) || undefined,
    description: entry.description,
    disabled,
    danger: entry.danger,
    ...(checked === undefined ? {} : { choice: entry.radio ? "radio" as const : "checkbox" as const, checked }),
  };
  if (entry.items !== undefined) {
    const items: MenuItem[] = [];
    let rule = false;
    for (const child of entry.items) {
      if (child === MENU_RULE) {
        rule = items.length > 0;
        continue;
      }
      const item = resolveEntry(child, surface, commands, titles, host);
      if (!item) continue;
      items.push(rule ? { ...item, separator: true } : item);
      rule = false;
    }
    return items.length === 0 ? null : { ...base, items };
  }
  const then = entry.command;
  const find = entry.find;
  return {
    ...base,
    run: () => {
      if (action !== null) {
        host.focusPane();
        surface?.focus?.();
      }
      entry.run?.();
      if (action !== null) actions!.run(action);
      if (entry.slash !== undefined) host.runSlash(entry.slash);
      if (find !== undefined) menuFind(find.where, find.query);
      if (then !== undefined) host.runCommand(then);
    },
  };
}

/// Il punto da cui si apre il menu: il gesto, o quello che dice la
/// superficie, o il riquadro.
function pointOf(event: MouseEvent | null, menu: SurfaceMenu, pane: HTMLElement): MenuPoint {
  if (event) return { x: event.clientX, y: event.clientY };
  if (menu.at) return menu.at;
  const box = pane.getBoundingClientRect();
  return menuPointFor({ left: box.left + 24, bottom: box.top + 24 });
}

/// Un `contextmenu` nato dalla tastiera (il tasto Menu, Maiusc+F10) e non dal
/// puntatore: il suo punto non dice dove si è cliccato.
export function fromKeyboard(event: MouseEvent): boolean {
  return event.button !== 2 || (event.clientX === 0 && event.clientY === 0);
}

/// Apre il menu dell'editor per un `contextmenu` sul riquadro `pane`. `false`
/// quando la superficie non ne ha uno qui: allora resta quello del sistema.
export function openEditorMenu(event: MouseEvent, pane: HTMLElement, host: EditorMenuHost): boolean {
  const surface = host.surface();
  if (!surface?.contextMenu) return false;
  const keyboard = fromKeyboard(event);
  const at: SurfacePoint | null = keyboard ? null : { x: event.clientX, y: event.clientY };
  const menu = surface.contextMenu(at);
  if (!menu) return false;
  const composed = composeEditorMenu(menu, host);
  if (composed.items.length === 0 && composed.clipboard.length === 0) return false;
  event.preventDefault();
  host.focusPane();
  const strip = menu.miniBar ? host.miniBar?.(menu) ?? null : null;
  showContextMenu(pointOf(keyboard ? null : event, menu, pane), [...composed.items], {
    pointer: !keyboard,
    ...(composed.header ? { header: composed.header } : {}),
    clipboard: composed.clipboard,
    searchable: composed.searchable,
    ...(strip ? { strip, stripLabel: t("editor_menu.mini_bar") } : {}),
  });
  return true;
}
