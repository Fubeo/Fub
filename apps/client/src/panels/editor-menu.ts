// Il menu del tasto destro negli editor: la superficie dice cosa offre
// (`SurfaceMenu`), questo modulo lo compone nell'anatomia di tutti i menu
// dell'editor e lo apre.
//
// # L'anatomia
//
// Le sezioni stanno sempre nello stesso ordine, ognuna col suo gruppo per chi
// ascolta, e una sezione vuota non c'è:
//
// 1. ciò che sta sotto il puntatore, le correzioni per prime;
// 2. gli appunti: Taglia, Copia, Incolla, Incolla come testo semplice, «Copia
//    come ▸»;
// 3. il formato: «Formato ▸», «Trasforma in ▸» e le voci della superficie;
// 4. «Inserisci ▸»;
// 5. «Comandi ▸»: i comandi del registro dichiarati per il «/», gli stessi
//    del menu «/», e le voci dei plugin per la nota sotto il puntatore;
// 6. le utilità: Copia link a questo punto, Cerca nella nota, Seleziona tutto.
//
// Al primo livello stanno al più `MAX_TOP` voci: oltre, le utilità e la coda
// della prima sezione scendono in «Altro ▸». Sopra il menu, dove la superficie
// formatta, sta la mini-barra.
//
// # Senza IPC
//
// Il menu si apre con quello che la shell sa già: le azioni le dice la
// superficie, i comandi stanno nella cache (`state.commandSpecs`). Soltanto le
// voci dei plugin per una nota si chiedono quando si apre il loro sottomenu, e
// la loro attesa ha già un limite (`context-views.ts`).
import type { CommandSpec } from "../host/contract";
import type { EditorSurface, SurfacePoint } from "../editors/core/registry";
import type { SurfaceMenu, SurfaceMenuEntry, SurfaceMenuItem } from "../editors/core/editor-menu";
import { t } from "../i18n/strings";
import { displayBinding, type CommandEntry } from "../ui/commands";
import { contextMenuItems, hasContextMenuViews } from "../ui/context-views";
import { menuPointFor, showContextMenu, type MenuItem, type MenuPoint } from "../ui/menu";
import { slashCandidates } from "../state/slash";
import { ACTION_LOOKS } from "./format-bar";

/// Quante voci stanno al primo livello prima che il resto scenda in «Altro ▸».
export const MAX_TOP = 12;

/// Quante voci della prima sezione restano al primo livello quando il menu è
/// troppo lungo: le altre scendono in «Altro ▸».
const CONTEXT_KEPT = 7;

/// I comandi della shell che le utilità offrono a ogni superficie che li sa
/// servire: la loro disponibilità la dice il comando stesso.
const UTILITIES = ["shell.doc.copy_anchor_link", "shell.doc.search"] as const;

export interface EditorMenuHost {
  /// La superficie del riquadro, se ce n'è una montata.
  surface(): EditorSurface | null;
  /// I comandi del registro, dalla cache.
  specs(): readonly CommandSpec[];
  /// I comandi della palette (registro e shell), per nome, accordo e gesto.
  commands(): readonly CommandEntry[];
  /// Il testo scelto adesso, per i comandi che lavorano su una selezione.
  selection(): string;
  /// Esegue un comando del registro scelto da «Comandi ▸», per la stessa via
  /// del «/»: moduli, piano e flush prima di scrivere.
  runSlash(id: string): void;
  /// Esegue un comando della palette.
  runCommand(id: string): void;
  /// Il riquadro diventa quello attivo, senza spostare il fuoco.
  focusPane(): void;
  /// La mini-barra da mostrare sopra il menu, se adesso ce n'è una.
  miniBar?(menu: SurfaceMenu): ((host: HTMLElement) => () => void) | null;
}

/// Le voci del menu, composte nelle sezioni. Pura rispetto al DOM: è la
/// regola che i test leggono.
export function composeEditorMenu(menu: SurfaceMenu, host: EditorMenuHost): MenuItem[] {
  const surface = host.surface();
  const commands = new Map(host.commands().map((entry) => [entry.id, entry]));
  const titles = new Map(host.specs().map((spec) => [spec.id, spec.title]));
  const resolve = (entries: readonly SurfaceMenuEntry[] | undefined): MenuItem[] =>
    (entries ?? []).flatMap((entry) => {
      const item = resolveEntry(entry, surface, commands, titles, host);
      return item ? [item] : [];
    });
  const sections: { name: string; items: MenuItem[] }[] = [];
  const section = (name: string, items: MenuItem[]): void => {
    if (items.length > 0) sections.push({ name, items });
  };
  const nest = (key: Parameters<typeof t>[0], icon: string | undefined, entries: readonly SurfaceMenuEntry[] | undefined): MenuItem[] => {
    const items = resolve(entries);
    return items.length === 0 ? [] : [{ label: t(key), icon, items }];
  };

  // 1. Sotto il puntatore.
  const context = resolve(menu.context);
  // 2. Gli appunti.
  const clipboard: MenuItem[] = [];
  const offers = menu.clipboard?.offers ?? {};
  const op = (key: "cut" | "copy" | "paste" | "paste-plain", label: Parameters<typeof t>[0], chord: string | null): void => {
    const enabled = offers[key];
    if (enabled === undefined) return;
    clipboard.push({
      label: t(label),
      hint: displayBinding(chord) || undefined,
      disabled: !enabled,
      run: () => menu.clipboard!.run(key),
    });
  };
  op("cut", "editor_menu.cut", "Mod-x");
  op("copy", "editor_menu.copy", "Mod-c");
  op("paste", "editor_menu.paste", "Mod-v");
  op("paste-plain", "editor_menu.paste_plain", "Mod-Shift-v");
  const copyAs = resolve(menu.clipboard?.copyAs);
  if (copyAs.length > 0) clipboard.push({ label: t("editor_menu.copy_as"), items: copyAs });
  // 3. Il formato.
  const edit = [
    ...nest("editor_menu.format", "fmt-bold", menu.format),
    ...nest("editor_menu.transform", "fmt-quote", menu.transform),
    ...resolve(menu.edit),
  ];
  // 4. Inserisci.
  const insert = nest("editor_menu.insert", "fmt-table", menu.insert);
  // 5. I comandi del vault e dei plugin.
  const vault: MenuItem[] = [];
  if (menu.commands) {
    const selection = host.selection();
    const slash = slashCandidates([...host.specs()], selection).map((spec): MenuItem => ({
      label: spec.title,
      description: spec.description || undefined,
      hint: displayBinding(commands.get(spec.id)?.binding ?? spec.keybinding) || undefined,
      run: () => host.runSlash(spec.id),
    }));
    if (slash.length > 0) vault.push({ label: t("editor_menu.commands"), items: slash });
  }
  const note = menu.note;
  if (note && hasContextMenuViews()) {
    vault.push({ label: t("editor_menu.plugins"), items: () => contextMenuItems({ kind: note.kind, id: note.id }) });
  }
  // 6. Le utilità.
  const tail = resolve(menu.tail);
  for (const id of UTILITIES) {
    if (id === "shell.doc.copy_anchor_link" && !surface?.anchorHere) continue;
    const item = resolveEntry(id, surface, commands, titles, host);
    if (item) tail.push(item);
  }
  if (offers["select-all"] !== undefined) {
    tail.push({
      label: t("editor_menu.select_all"),
      hint: displayBinding("Mod-a") || undefined,
      disabled: !offers["select-all"],
      run: () => menu.clipboard!.run("select-all"),
    });
  }

  // Troppo lungo: la coda della prima sezione e le utilità scendono in «Altro».
  const count = context.length + clipboard.length + edit.length + insert.length + vault.length + tail.length;
  const more: MenuItem[] = [];
  let kept = context;
  if (count > MAX_TOP) {
    kept = context.slice(0, CONTEXT_KEPT);
    more.push(...context.slice(CONTEXT_KEPT), ...tail.map((item, index) => ({ ...item, separator: index === 0 && more.length > 0 })));
  }
  section(t("editor_menu.group.context"), kept);
  section(t("editor_menu.group.clipboard"), clipboard);
  section(t("editor_menu.group.edit"), [...edit, ...insert]);
  section(t("editor_menu.group.commands"), vault);
  if (more.length > 0) section(t("editor_menu.group.more"), [{ label: t("editor_menu.more"), items: more }]);
  else section(t("editor_menu.group.utilities"), tail);
  return sections.flatMap(({ name, items }) => items.map((item) => ({ ...item, group: name })));
}

/// Una voce della superficie come voce del menu, o `null` se adesso non
/// c'è: un id che non è né un'azione della superficie né un comando
/// disponibile, un sottomenu rimasto vuoto.
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
    const state = actions.editable() ? actions.state(entry) : { enabled: false, active: null };
    const icon = ACTION_LOOKS[entry]?.icon || undefined;
    return {
      label,
      icon,
      hint: displayBinding(actions.chord(entry)) || undefined,
      disabled: !state.enabled,
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
  const base: MenuItem = {
    label: entry.label,
    icon: entry.icon,
    hint: displayBinding(entry.chord) || undefined,
    description: entry.description,
    disabled: entry.enabled === false,
    danger: entry.danger,
    ...(entry.checked === undefined ? {} : { choice: "checkbox" as const, checked: entry.checked }),
  };
  if (entry.items !== undefined) {
    const items = entry.items.flatMap((child) => {
      const item = resolveEntry(child, surface, commands, titles, host);
      return item ? [item] : [];
    });
    return items.length === 0 ? null : { ...base, items };
  }
  const then = entry.command;
  return {
    ...base,
    run: () => {
      entry.run?.();
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
  const items = composeEditorMenu(menu, host);
  if (items.length === 0) return false;
  event.preventDefault();
  host.focusPane();
  const strip = menu.miniBar ? host.miniBar?.(menu) ?? null : null;
  showContextMenu(pointOf(keyboard ? null : event, menu, pane), items, {
    ...(strip ? { strip, stripLabel: t("editor_menu.mini_bar") } : {}),
  });
  return true;
}
