// Il catalogo dei comandi del disegno (B2): un elenco solo di ciò che il
// disegno sa fare adesso, ognuno con un id, il nome, il posto da cui viene, il
// tasto e se si può. Lo alimentano gli strumenti, Annulla e Ripeti, il menu
// «Disegno» coi suoi sottomenu e la barra della selezione; lo leggono la
// ricerca dei comandi (Ctrl+/) e il menu radiale. Un comando nuovo entra da
// uno di quei posti, e la ricerca lo trova senza altro lavoro.

import { displayBinding } from "../../../../../ui/commands";
import type { MenuItem } from "../../../../../ui/menu";
import { t } from "../../../strings";
import { toolsOf, toolSpec, type ToolId } from "../../registry";
import type { EditorContext } from "../context";

/// Quando un comando vale: sempre, con uno strumento, con una selezione.
export type CommandContext = "always" | "tool" | "selection";

export interface DrawCommand {
  /// Stabile finché il comando c'è: ciò che i recenti ricordano.
  readonly id: string;
  readonly label: string;
  /// Da dove viene: «Disegno › Vista».
  readonly path: string;
  readonly icon?: string;
  /// Il tasto, scritto come si preme.
  readonly hint?: string;
  readonly context: CommandContext;
  readonly disabled: boolean;
  /// Perché è spento, o che cosa fa.
  readonly description?: string;
  readonly run: () => void;
}

export interface CommandsContext {
  /// I comandi di adesso, nell'ordine dei loro posti.
  commands: () => DrawCommand[];
  /// Il comando `id`, se adesso c'è.
  command: (id: string) => DrawCommand | null;
}

/// L'id di uno strumento nel catalogo.
export const toolCommand = (id: ToolId): string => `draw.tool.${id}`;

/// Il nome di una voce di menu ridotto a id: minuscole, senza accenti né
/// segni, coi trattini.
const slug = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/// Le voci di un menu che si possono eseguire, coi sottomenu già pronti
/// aperti dentro: un sottomenu che si prepara quando serve si salta. L'id è il
/// posto e il nome.
export function menuCommands(items: readonly MenuItem[], path: readonly string[], prefix: string): DrawCommand[] {
  const found: DrawCommand[] = [];
  for (const item of items) {
    if (Array.isArray(item.items)) {
      found.push(...menuCommands(item.items as readonly MenuItem[], [...path, item.label], prefix));
      continue;
    }
    const run = item.run;
    if (run === undefined) continue;
    found.push({
      id: `${prefix}${[...path.slice(1), item.label].map(slug).join("/")}`,
      label: item.label,
      path: path.join(" › "),
      ...(item.icon === undefined ? {} : { icon: item.icon }),
      ...(item.hint === undefined ? {} : { hint: item.hint }),
      context: "always",
      disabled: item.disabled === true,
      ...(item.description === undefined ? {} : { description: item.description }),
      run,
    });
  }
  return found;
}

/// Se il pulsante `control` si vede, a parte il «…» della riga delle opzioni
/// e l'interfaccia nascosta, che non tolgono un comando.
function shown(ctx: EditorContext, control: HTMLElement): boolean {
  for (let at: HTMLElement | null = control; at !== null && at !== ctx.root; at = at.parentElement) {
    if (at.classList.contains("draw-options-item") || at === ctx.header) return true;
    if (at.hidden) return false;
  }
  return true;
}

export function installCommands(ctx: EditorContext): void {
  const commands = (): DrawCommand[] => {
    if (ctx.disposed) return [];
    const tools = t("draw.keys.tools");
    const menu = t("draw.chrome.menu");
    const found: DrawCommand[] = toolsOf(ctx.features).map((spec) => ({
      id: toolCommand(spec.id),
      label: t(spec.label),
      path: tools,
      icon: ctx.toolIcon(spec.id),
      hint: displayBinding(toolSpec(spec.id).shortcut),
      context: "tool",
      disabled: !ctx.editable() && spec.id !== "select" && spec.id !== "hand" && spec.id !== "zoom",
      description: t(spec.description),
      run: () => ctx.setTool(spec.id),
    }));
    found.push(
      { id: "draw.undo", label: t("draw.undo"), path: menu, icon: "draw-undo", hint: displayBinding("Mod-z"), context: "always", disabled: !ctx.editable() || !ctx.undoable(), run: () => ctx.undo() },
      { id: "draw.redo", label: t("draw.redo"), path: menu, icon: "draw-redo", hint: displayBinding("Mod-Shift-z"), context: "always", disabled: !ctx.editable() || !ctx.redoable(), run: () => ctx.redo() },
    );
    // Il menu radiale da tastiera: in mezzo alla vista.
    if (ctx.radialHere()) {
      found.push({
        id: "draw.radial",
        label: t("draw.radial"),
        path: menu,
        context: "always",
        disabled: false,
        run: () => {
          const area = ctx.viewArea();
          const box = ctx.surface.getBoundingClientRect();
          ctx.showRadial(box.left + area.x + area.w / 2, box.top + area.y + area.h / 2, null, true);
        },
      });
    }
    found.push(...menuCommands(ctx.drawMenuItems(), [menu], "draw.menu:"));
    // La barra della selezione: le azioni che si vedono adesso, anche quelle
    // nel suo «…».
    const bar = t("draw.arrange");
    if (!ctx.arrangeBar.hidden) {
      for (const command of ctx.barCommands) {
        if (command.control.hidden) continue;
        found.push({
          id: command.id,
          label: command.label(),
          path: bar,
          icon: command.icon,
          ...(command.binding === null ? {} : { hint: displayBinding(command.binding) }),
          context: "selection",
          disabled: command.control.disabled,
          run: command.run,
        });
      }
    }
    // I pulsanti della barra e della colonna che si vedono adesso, anche
    // quelli finiti nel «…» della riga delle opzioni o con l'interfaccia
    // nascosta; il menu, Annulla e Ripeti ci sono già.
    for (const command of ctx.toolbarCommands) {
      const { control } = command;
      if (control === ctx.menuButton || control === ctx.undoButton || control === ctx.redoButton || !shown(ctx, control)) continue;
      const label = command.label();
      if (label === "") continue;
      found.push({
        id: `draw.button:${command.icon ?? slug(label)}`,
        label,
        path: control.closest("[role=group], [role=radiogroup]")?.getAttribute("aria-label") ?? menu,
        ...(command.icon === null ? {} : { icon: command.icon }),
        context: "always",
        disabled: control.disabled,
        run: command.run,
      });
    }
    // Un id doppio resta al primo posto da cui viene.
    const seen = new Set<string>();
    return found.filter((one) => !seen.has(one.id) && seen.add(one.id) !== null);
  };
  ctx.commands = commands;
  ctx.command = (id) => commands().find((one) => one.id === id) ?? null;
}
