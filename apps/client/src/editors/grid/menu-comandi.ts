// Il menu «Comandi» dei fogli: tutti i comandi della cartella in un menu,
// scheda per scheda e gruppo per gruppo, anche quelli che la barra non mostra.
//
// L'albero si compone dalle schede della barra (`ribbon/tabs.ts`) e dal
// catalogo (`catalogo.generated.json`), nell'ordine delle sue `schede`. In un
// gruppo vengono prima i controlli della barra, con le loro varianti (le voci
// di un pulsante diviso, i colori, gli stili), poi «Altri comandi del gruppo»:
// i comandi del catalogo che stanno in quel gruppo e che la barra non ha. Le
// schede contestuali (tabella, grafico, oggetto, pivot) stanno sotto «Per ciò
// che hai selezionato»: senza il loro contesto i controlli della barra sono
// spenti, col perché.
//
// Una voce fa ciò che fa la barra: dà lo stesso comando con gli stessi
// parametri, o apre la stessa finestra. Un comando che la barra non ha si dà
// come lo dà la tavolozza (`palette/commands.ts`). Una voce spenta resta, con
// il suo perché nella descrizione: la sola lettura, il contesto che manca, la
// ragione del motore. Un sottomenu è spento soltanto quando ogni sua voce lo è
// per lo stesso perché.
//
// Lo stato si legge quando il menu si apre; finché resta aperto la barra gli
// passa la vista nuova (`MenuSession.update`), e le voci si rileggono senza
// chiudere il menu.
import type { GridCommandState } from "../../host/contract";
import type { MenuOpening, MenuSession } from "../../kit/ribbon/types";
import { showContextMenu, type MenuItem } from "../../ui/menu";
import { CATALOG_COMMANDS, CATALOG_TABS, commandTitle, type GridPaletteCommand } from "./palette/commands";
import { t as fogliT, type FogliKey } from "./palette/strings";
import { CELL_STYLE_GROUPS, STANDARD_COLORS, TABLE_FAMILIES } from "./ribbon/palette";
import { t, type RibbonKey } from "./ribbon/strings";
import { shortcutCommand } from "./shortcuts";
import {
  RIBBON_TABS,
  groupControls,
  type ColorControl,
  type MenuEntry,
  type Params,
  type RibbonControl,
  type RibbonView,
  type Text,
} from "./ribbon/tabs";

/// Ciò che il menu chiede al motore della griglia.
export interface CommandMenuEngine {
  commands(): readonly GridCommandState[];
  /// Se la cartella si può cambiare; senza, come se si potesse.
  writable?(): boolean;
  command(id: string, params?: string): boolean;
  openDialog(id: string, params?: string): boolean;
  writeFormula(text: string): boolean;
  pdfExport?(): (() => void) | null;
}

/// Ciò che il menu chiede alla barra che lo apre.
export interface CommandMenuHost {
  readonly engine: CommandMenuEngine;
  /// Le voci della tavolozza: i comandi che la barra non ha si danno con loro.
  palette(): readonly GridPaletteCommand[];
  /// Se una scheda contestuale ha il suo contesto.
  contextShown(context: string, view: RibbonView): boolean;
  /// Il nome di uno stile di cella nella lingua della shell.
  cellStyleName(name: string): string;
  /// La tavolozza intera di un colore, sotto `anchor`.
  moreColors?(control: ColorControl, anchor: HTMLElement, view: RibbonView): void;
}

/// I nomi dei colori standard, nell'ordine di `STANDARD_COLORS`.
export const STANDARD_NAMES: readonly RibbonKey[] = [
  "ribbon.color.dark_red",
  "ribbon.color.red",
  "ribbon.color.orange",
  "ribbon.color.yellow",
  "ribbon.color.light_green",
  "ribbon.color.green",
  "ribbon.color.light_blue",
  "ribbon.color.blue",
  "ribbon.color.dark_blue",
  "ribbon.color.purple",
];

/// Una voce composta, col perché se è spenta.
interface Built {
  readonly item: MenuItem;
  readonly off: string | null;
}

const EFFECTS: ReadonlyMap<string, string> = new Map(CATALOG_COMMANDS.map((command) => [command.motore, command.effetto]));

let hints: ReadonlyMap<string, string> | null = null;

/// La scorciatoia di un comando, come la scrive il menu: quelle di Excel che
/// la griglia legge (`shortcuts.ts`) con Ctrl e un tasto, più Annulla e
/// Ripeti, che sono della griglia.
export function commandHint(id: string): string | undefined {
  if (hints === null) {
    const found = new Map<string, string>([
      ["edit.undo", "Ctrl+Z"],
      ["edit.redo", "Ctrl+Y"],
    ]);
    const context = { wholeRows: false, wholeColumns: false, currency: "€" };
    const keys = [
      ...Array.from({ length: 26 }, (_, at) => [`Key${String.fromCharCode(65 + at)}`, String.fromCharCode(65 + at)] as const),
      ...Array.from({ length: 10 }, (_, at) => [`Digit${at}`, String(at)] as const),
    ];
    for (const [code, key] of keys) {
      const command = shortcutCommand(new KeyboardEvent("keydown", { code, ctrlKey: true }), context);
      if (command && command.params === "{}" && !found.has(command.id)) found.set(command.id, `Ctrl+${key}`);
    }
    hints = found;
  }
  return hints.get(id);
}

/// Le voci del menu per la vista `view`, con lo stato letto adesso. In
/// `seen` finiscono i comandi che le voci danno, anche quelle dei sottomenu
/// che si compongono dopo, quando si compongono: per il presidio di copertura.
export function commandMenuItems(view: RibbonView, host: CommandMenuHost, anchor: HTMLElement, seen?: Set<string>): MenuItem[] {
  const { engine } = host;
  const states = new Map(engine.commands().map((state) => [state.id, state]));
  if (states.size === 0) return [];
  const served = (id: string): boolean => states.has(id);
  const writable = engine.writable?.() ?? true;
  let palette: ReadonlyMap<string, GridPaletteCommand> | null = null;
  const paletteEntry = (motore: string): GridPaletteCommand | undefined => {
    palette ??= new Map(host.palette().map((entry) => [entry.id, entry]));
    return palette.get(`fogli.${motore}`);
  };

  const text = (label: Text): string => (typeof label === "string" ? t(label) : label.raw);
  const params = (value: Params | null | undefined): string => JSON.stringify(value ?? {});
  const give = (id: string, value?: Params | null) => () => {
    engine.command(id, params(value));
  };
  const ask = (dialog: string, value?: Params | null) => () => {
    engine.openDialog(dialog, params(value));
  };
  const entryServed = (entry: MenuEntry): boolean => (entry.id === undefined || served(entry.id)) && (entry.requires ?? []).every(served);

  /// Il perché una voce è spenta, o `null`. `context` è il contesto che
  /// manca a un controllo della barra.
  function reason(id: string | undefined, context: string | null): string | null {
    const changes = id === undefined ? true : EFFECTS.get(id) === "cambia";
    if (!writable && changes) return fogliT("fogli.palette.read_only");
    if (context !== null) return fogliT(`fogli.motivo.context.${context}` as FogliKey);
    const state = id === undefined ? undefined : states.get(id);
    if (state && !state.enabled) return state.reason?.trim() || fogliT("fogli.palette.off");
    return null;
  }

  function leaf(
    label: string,
    id: string | undefined,
    context: string | null,
    run: () => void,
    extra: Partial<Pick<MenuItem, "choice" | "checked" | "swatches" | "description" | "separator">> = {},
  ): Built {
    const off = reason(id, context);
    const hint = id === undefined ? undefined : commandHint(id);
    if (id !== undefined) seen?.add(id);
    return {
      item: {
        label,
        ...extra,
        ...(hint ? { hint } : {}),
        ...(off !== null ? { disabled: true, description: off } : {}),
        run,
      },
      off,
    };
  }

  /// Un sottomenu: spento soltanto se ogni sua voce lo è per lo stesso perché.
  function branch(label: string, children: readonly Built[], description?: string, separator = false): Built {
    const first = children[0]?.off ?? null;
    const off = first !== null && children.every((child) => child.off === first) ? first : null;
    return {
      item: {
        label,
        items: children.map((child) => child.item),
        ...(separator ? { separator } : {}),
        ...(off !== null ? { disabled: true, description: off } : description ? { description } : {}),
      },
      off,
    };
  }

  /// Un sottomenu che si compone quando serve: le voci che arrivano dopo, o
  /// un menu dentro un menu. Spento soltanto dal contesto che manca.
  function later(label: string, context: string | null, source: () => readonly MenuEntry[] | Promise<readonly MenuEntry[]>, separator = false): Built {
    const off = context !== null ? reason(undefined, context) : null;
    return {
      item: {
        label,
        ...(separator ? { separator } : {}),
        ...(off !== null ? { disabled: true, description: off } : {}),
        items: async () => entries(await source(), context).map((built) => built.item),
      },
      off,
    };
  }

  /// Le voci di un menu della barra che il catalogo serve. Il separatore di
  /// una voce che non c'è passa alla prossima che c'è.
  function entries(list: readonly MenuEntry[], context: string | null): Built[] {
    const out: Built[] = [];
    let separate = false;
    for (const entry of list) {
      separate ||= entry.separator === true;
      if (!entryServed(entry)) continue;
      const separator = separate && out.length > 0;
      separate = false;
      const label = text(entry.label);
      if (entry.submenu) {
        out.push(later(label, context, entry.submenu, separator));
        continue;
      }
      const { write, id } = entry;
      let run: () => void;
      if (write !== undefined) {
        run = () => {
          engine.writeFormula(write);
        };
      } else if (id !== undefined) run = entry.dialog ? ask(entry.dialog, entry.params) : give(id, entry.params);
      else continue;
      out.push(
        leaf(label, entry.id, context, run, {
          ...(separator ? { separator } : {}),
          ...(entry.choice ? { choice: entry.choice, checked: entry.checked === true } : {}),
          ...(entry.swatches ? { swatches: entry.swatches } : {}),
          ...(entry.description ? { description: entry.description } : {}),
        }),
      );
    }
    return out;
  }

  /// Se la barra mostrerebbe il controllo. Senza il suo contesto il
  /// controllo resta, spento: `when` vale soltanto col contesto.
  function visible(control: RibbonControl, context: string | null): boolean {
    if (context === null && control.when && !control.when(view)) return false;
    switch (control.kind) {
      case "button":
        if (control.shell) return served(control.id) && (control.shell !== "exportPdf" || (engine.pdfExport?.() ?? null) !== null);
        return served(control.id);
      case "menu": {
        if (control.requires) return control.requires.every(served);
        if (control.open) return false;
        const items = control.items(view);
        return !(items instanceof Promise) && items.some(entryServed);
      }
      case "field":
        return served(control.id) && paletteEntry(control.id) !== undefined;
      default:
        return served(control.id);
    }
  }

  /// I comandi che un controllo dà, per sapere quali comandi del gruppo la
  /// barra ha già.
  function covers(control: RibbonControl, into: Set<string>): void {
    if ("id" in control && typeof control.id === "string") into.add(control.id);
    const list = control.kind === "split" ? control.menu(view) : control.kind === "menu" && !control.open ? control.items(view) : [];
    if (list instanceof Promise) return;
    for (const entry of list) if (entry.id) into.add(entry.id);
  }

  function control(one: RibbonControl, context: string | null): Built {
    const label = t(one.label);
    switch (one.kind) {
      case "button": {
        const value = typeof one.params === "function" ? one.params(view) : one.params;
        const dialog = typeof one.dialog === "function" ? one.dialog(view) : one.dialog;
        const run = one.shell ? () => engine.pdfExport?.()?.() : dialog ? ask(dialog, value) : give(one.id, value);
        return leaf(label, one.id, context, run, one.pressed ? { choice: "checkbox", checked: one.pressed(view) } : {});
      }
      case "split": {
        const menu = one.menu(view);
        // La parte grande, se le varianti non danno già lo stesso comando.
        const main = menu.some((entry) => entry.id === one.id)
          ? []
          : [leaf(label, one.id, context, give(one.id, one.params), one.pressed ? { choice: "checkbox", checked: one.pressed(view) } : {})];
        return branch(label, [...main, ...entries(menu, context)]);
      }
      case "menu": {
        const items = one.items(view);
        if (items instanceof Promise) return later(label, context, () => one.items(view));
        return branch(label, entries(items, context));
      }
      case "select": {
        const current = one.value(view);
        const options = one.options(view).map((option) => {
          const chosen = one.params(option.value);
          return leaf(text(option.label), one.id, context, chosen ? give(one.id, chosen) : () => {}, {
            choice: "radio",
            checked: option.value === current,
          });
        });
        return branch(label, options);
      }
      case "check": {
        const checked = one.checked(view);
        return leaf(label, one.id, context, give(one.id, one.params(!checked, view)), { choice: "checkbox", checked });
      }
      case "field": {
        const entry = paletteEntry(one.id);
        return leaf(`${label}…`, one.id, context, () => entry?.run());
      }
      case "color": {
        const colorParams = (color: string) => ({ ...one.params?.(view), color });
        const swatches = STANDARD_COLORS.map((hex, at) =>
          leaf(t(STANDARD_NAMES[at]!), one.id, context, give(one.id, colorParams(hex)), { swatches: [hex] }),
        );
        const more = host.moreColors
          ? [leaf(fogliT("fogli.menu.more_colors"), one.id, context, () => host.moreColors?.(one, anchor, view), { separator: true })]
          : [];
        return branch(label, [leaf(t(one.empty.label), one.id, context, give(one.id, colorParams(one.empty.value))), ...swatches, ...more]);
      }
      case "gallery": {
        const current = one.current?.(view) ?? null;
        const style = (name: string, styleLabel: string): Built =>
          leaf(styleLabel, one.id, context, give(one.id, one.params(name, view)), current === null ? {} : { choice: "radio", checked: name === current });
        if (one.gallery === "table") {
          return branch(
            label,
            TABLE_FAMILIES.map(({ family, count }) => {
              const familyName = t(`ribbon.gallery.${family.toLowerCase()}` as RibbonKey);
              return branch(
                familyName,
                Array.from({ length: count }, (_, at) =>
                  style(`TableStyle${family}${at + 1}`, t("ribbon.gallery.table_style", { family: familyName, n: at + 1 })),
                ),
              );
            }),
          );
        }
        return branch(
          label,
          CELL_STYLE_GROUPS.map(({ group, names }) =>
            branch(
              t(`ribbon.cell_group.${group}` as RibbonKey),
              names.map((name) => style(name, host.cellStyleName(name))),
            ),
          ),
        );
      }
    }
  }

  const main: Built[] = [];
  const contextual: Built[] = [];
  const more = fogliT("fogli.menu.more");
  for (const tab of CATALOG_TABS) {
    const ribbonTab = RIBBON_TABS.find((candidate) => candidate.id === tab.id);
    const context = tab.contesto;
    const missing = context !== null && !host.contextShown(context, view) ? context : null;
    const groups: Built[] = [];
    for (const group of tab.gruppi) {
      const ribbonGroup = ribbonTab?.groups.find((candidate) => candidate.id === group.id);
      const controls = ribbonGroup ? groupControls(ribbonGroup).filter((one) => visible(one, missing)) : [];
      const covered = new Set<string>();
      for (const one of controls) covers(one, covered);
      const rows = controls.map((one) => control(one, missing));
      const extras = CATALOG_COMMANDS.filter(
        (command) => command.posto.scheda === tab.id && command.posto.gruppo === group.id && served(command.motore) && !covered.has(command.motore),
      ).map((command) => {
        const entry = paletteEntry(command.motore);
        const built = leaf(commandTitle(command), command.motore, null, () => entry?.run());
        return { ...built, item: { ...built.item, group: more } };
      });
      if (rows.length + extras.length === 0) continue;
      const groupLabel = ribbonGroup ? t(ribbonGroup.label) : fogliT(`fogli.menu.group.${tab.id}.${group.id}` as FogliKey);
      groups.push(branch(groupLabel, [...rows, ...extras]));
    }
    if (groups.length === 0) continue;
    const tabLabel = ribbonTab ? t(ribbonTab.label) : fogliT(`fogli.menu.tab.${tab.id}` as FogliKey);
    if (context === null) {
      main.push(branch(tabLabel, groups));
      continue;
    }
    const description =
      context === "table" && missing === null && view.table
        ? fogliT("fogli.menu.now.table", { name: view.table.name })
        : fogliT(`fogli.menu.when.${context}` as FogliKey);
    const built = branch(tabLabel, groups, description);
    contextual.push({ ...built, item: { ...built.item, group: fogliT("fogli.menu.contextual") } });
  }
  return [...main, ...contextual].map((built) => built.item);
}

/// Apre il menu sotto `anchor` e torna come rileggerlo finché resta aperto.
export function openCommandMenu(anchor: HTMLElement, view: RibbonView, how: MenuOpening, host: CommandMenuHost): MenuSession<RibbonView> {
  const handle = showContextMenu(anchor, commandMenuItems(view, host, anchor), {
    search: true,
    fullSearch: true,
    reachDisabled: true,
    label: fogliT("fogli.menu.label"),
    pointer: how.pointer,
    onClose: how.closed,
  });
  return { update: (next) => handle.update(commandMenuItems(next, host, anchor)) };
}
