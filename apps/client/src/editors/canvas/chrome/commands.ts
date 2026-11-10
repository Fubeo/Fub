// Il catalogo dei comandi della lavagna (R2 di `lavagna.md`, «Ogni funzione è
// un comando»): ogni cosa che la tela sa fare entra qui una volta, con un id
// stabile, il nome, il posto da cui viene e i suoi tasti. Lo leggono il menu
// del tasto destro, i tasti della tela e la ricerca dei comandi (Ctrl+/); la
// colonna, la riga delle opzioni e il menu radiale lo leggeranno allo stesso
// modo.
//
// Qui stanno i **dati** (`CANVAS_COMMANDS`) e le regole dei tasti; che cosa fa
// un comando lo dice la tela, che sola ne conosce lo stato
// (`buildCanvasCommands`). Un id comincia con `canvas.` ed è un dato stabile:
// lo ricordano i recenti e lo leggeranno le Impostazioni › Tasti.
//
// I tasti sono quelli della tabella «Tasti» di `lavagna.md` dove fanno la
// stessa cosa (gli stessi del disegno, ADR 0223); quelli che la tela usava già
// in un altro modo restano com'erano, e `docs/reference/canvas-cards.md` lo
// dice. Per adesso i tasti della lavagna non si cambiano, come quelli del
// disegno.

import type { Key } from "../../../i18n/strings";
import { keyName, keyboardPlatform, modifierName, type KeyboardPlatform } from "../../../ui/commands";

/// Quando un comando vale: sempre, con uno strumento, con una selezione.
export type CanvasCommandContext = "always" | "tool" | "selection";

/// Gli argomenti di un comando: dove (il punto della finestra del tasto
/// destro) e su quale collegamento. Senza, il comando vale per la selezione e
/// per il centro della vista.
export interface CanvasCommandArgs {
  readonly at?: { readonly x: number; readonly y: number };
  readonly edge?: string;
}

/// Un comando della lavagna, com'è adesso.
export interface CanvasCommand {
  /// Comincia con `canvas.`; stabile finché il comando c'è.
  readonly id: string;
  readonly label: string;
  /// Da dove viene: «Lavagna › Vista».
  readonly path: string;
  /// I tasti, nella sintassi delle scorciatoie (`Mod-z`, `Shift-1`, `Delete`);
  /// il primo è quello che si mostra.
  readonly keys: readonly string[];
  readonly context: CanvasCommandContext;
  /// I tasti valgono solo col fuoco sulla lavagna o su una scheda, non su un
  /// pulsante della tela (Invio).
  readonly boardKeys: boolean;
  /// Cancella qualcosa: il menu lo scrive in rosso.
  readonly danger: boolean;
  /// Perché adesso non si può, o `null` se si può.
  disabled(): string | null;
  run(args?: CanvasCommandArgs): void;
}

/// Il gruppo di un comando, come nella tabella «Tasti».
type Group = "tools" | "create" | "selection" | "color" | "arrange" | "view" | "find" | "always";

/// I dati di un comando: tutto tranne lo stato.
export interface CanvasCommandSpec {
  readonly id: string;
  readonly label: Key;
  readonly group: Group;
  readonly keys: readonly string[];
  readonly context: CanvasCommandContext;
  readonly boardKeys?: boolean;
  readonly danger?: boolean;
}

/// Il nome del gruppo, che fa da posto.
export const CANVAS_COMMAND_GROUPS: Readonly<Record<Group, Key>> = {
  tools: "canvas.commands.group.tools",
  create: "canvas.commands.group.create",
  selection: "canvas.commands.group.selection",
  color: "canvas_menu.color",
  arrange: "canvas.commands.group.arrange",
  view: "canvas.commands.group.view",
  find: "canvas.commands.group.find",
  always: "canvas.commands.group.always",
};

/// I colori delle schede e dei fili, nell'ordine del menu; `none` è il colore di serie.
export const CANVAS_COLORS = ["none", "1", "2", "3", "4", "5", "6"] as const;
export type CanvasColorId = (typeof CANVAS_COLORS)[number];

/// I lati e i modi di allineare, nell'ordine del menu.
export const CANVAS_ALIGN = ["left", "center", "right", "top", "middle", "bottom"] as const;
export type CanvasAlign = (typeof CANVAS_ALIGN)[number];

/// Le quattro direzioni delle frecce.
export const CANVAS_NUDGE = ["left", "right", "up", "down"] as const;
export type CanvasNudge = (typeof CANVAS_NUDGE)[number];

/// Le punte dei fili che lo strumento Collega tira (T50): nessuna, una
/// all'inizio, una alla fine (quella di serie, come JSON Canvas).
export const CANVAS_TIPS = ["none", "start", "end"] as const;
export type CanvasTip = (typeof CANVAS_TIPS)[number];

/// Gli strumenti della colonna (T49), nell'ordine della colonna di serie. Il
/// lazo (Q) arriva con T86.
export const CANVAS_TOOL_IDS = ["select", "hand", "pen", "highlighter", "eraser", "text", "connect"] as const;
export type CanvasToolId = (typeof CANVAS_TOOL_IDS)[number];

/// Il tasto di ogni strumento, come nella tabella «Tasti» (gli stessi del
/// disegno). D tenuto non è uno strumento: presta la penna (N4).
export const CANVAS_TOOL_KEYS: Readonly<Record<CanvasToolId, string>> = {
  select: "v",
  hand: "h",
  pen: "p",
  highlighter: "Shift-p",
  eraser: "e",
  text: "t",
  connect: "c",
};

/// L'id del comando che sceglie lo strumento `tool`.
export function toolCommandId(tool: CanvasToolId): string {
  return `canvas.tool.${tool}`;
}

/// Lo strumento che il comando `id` sceglie, o `null` se non ne sceglie uno.
export function toolOfCommand(id: string): CanvasToolId | null {
  const tool = id.startsWith("canvas.tool.") ? id.slice("canvas.tool.".length) : "";
  return (CANVAS_TOOL_IDS as readonly string[]).includes(tool) ? (tool as CanvasToolId) : null;
}

const ARROW: Readonly<Record<CanvasNudge, string>> = { left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown" };

/// Il catalogo: tutti i comandi della lavagna, nell'ordine in cui la ricerca
/// li mostra senza una parola.
export const CANVAS_COMMANDS: readonly CanvasCommandSpec[] = [
  { id: "canvas.undo", label: "canvas.commands.undo", group: "always", keys: ["Mod-z"], context: "always" },
  { id: "canvas.redo", label: "canvas.commands.redo", group: "always", keys: ["Mod-Shift-z", "Mod-y"], context: "always" },
  { id: "canvas.commands", label: "canvas.commands.open", group: "find", keys: ["Mod-/"], context: "always" },
  ...CANVAS_TOOL_IDS.map((tool): CanvasCommandSpec => ({
    id: toolCommandId(tool), label: `canvas.tool.${tool}`, group: "tools", keys: [CANVAS_TOOL_KEYS[tool]], context: "always",
  })),
  // Esc toglie la scelta; senza scelta torna alla Selezione (la tabella «Tasti»).
  { id: "canvas.escape", label: "canvas.commands.escape", group: "selection", keys: ["Escape"], context: "always" },
  { id: "canvas.add.text", label: "canvas.add_text", group: "create", keys: [], context: "always" },
  { id: "canvas.add.file", label: "canvas.add_file", group: "create", keys: [], context: "always" },
  { id: "canvas.add.link", label: "canvas.add_link", group: "create", keys: [], context: "always" },
  { id: "canvas.add.group", label: "canvas.add_group", group: "create", keys: [], context: "always" },
  { id: "canvas.duplicate", label: "canvas.duplicate", group: "create", keys: ["Mod-d"], context: "selection" },
  { id: "canvas.select_all", label: "canvas.commands.select_all", group: "selection", keys: ["Mod-a"], context: "always" },
  { id: "canvas.enter", label: "canvas.commands.enter", group: "selection", keys: ["Enter"], context: "selection", boardKeys: true },
  { id: "canvas.edit", label: "canvas_menu.edit", group: "selection", keys: [], context: "selection" },
  { id: "canvas.open", label: "canvas_menu.open", group: "selection", keys: [], context: "selection" },
  { id: "canvas.open_url", label: "canvas.open_url", group: "selection", keys: [], context: "selection" },
  ...CANVAS_NUDGE.map((way): CanvasCommandSpec => ({
    id: `canvas.nudge.${way}`, label: `canvas.commands.nudge.${way}`, group: "selection", keys: [ARROW[way]], context: "selection",
  })),
  ...CANVAS_NUDGE.map((way): CanvasCommandSpec => ({
    id: `canvas.nudge.${way}.far`, label: `canvas.commands.nudge.${way}.far`, group: "selection", keys: [`Shift-${ARROW[way]}`], context: "selection",
  })),
  { id: "canvas.edge.reverse", label: "canvas_menu.reverse", group: "selection", keys: [], context: "selection" },
  { id: "canvas.delete", label: "canvas.delete", group: "selection", keys: ["Delete", "Backspace"], context: "selection", danger: true },
  ...CANVAS_COLORS.map((color): CanvasCommandSpec => ({
    id: `canvas.color.${color}`, label: color === "none" ? "canvas.default" : `canvas_menu.color.${color}`, group: "color", keys: [], context: "selection",
  })),
  { id: "canvas.bring_front", label: "canvas.bring_front", group: "arrange", keys: ["Mod-]"], context: "selection" },
  { id: "canvas.send_back", label: "canvas.send_back", group: "arrange", keys: ["Mod-["], context: "selection" },
  ...CANVAS_ALIGN.map((axis): CanvasCommandSpec => ({
    id: `canvas.align.${axis}`, label: `canvas.align_${axis}`, group: "arrange", keys: [], context: "selection",
  })),
  { id: "canvas.distribute_x", label: "canvas.distribute_x", group: "arrange", keys: [], context: "selection" },
  { id: "canvas.distribute_y", label: "canvas.distribute_y", group: "arrange", keys: [], context: "selection" },
  { id: "canvas.fit", label: "canvas.fit", group: "view", keys: ["Shift-1", "Mod-0"], context: "always" },
  { id: "canvas.fit_selection", label: "canvas.fit_selection", group: "view", keys: ["Shift-2"], context: "selection" },
  { id: "canvas.zoom_in", label: "canvas.zoom_in", group: "view", keys: ["+", "Mod-=", "Mod-+"], context: "always" },
  { id: "canvas.zoom_out", label: "canvas.zoom_out", group: "view", keys: ["-", "Mod--"], context: "always" },
  // La riga delle opzioni (T50): i menu che apre e le punte di Collega.
  { id: "canvas.pen_menu", label: "canvas.options.pen_menu", group: "tools", keys: [], context: "always" },
  { id: "canvas.color_menu", label: "canvas.options.color_menu", group: "color", keys: [], context: "selection" },
  { id: "canvas.align_menu", label: "canvas.options.align_menu", group: "arrange", keys: [], context: "selection" },
  ...CANVAS_TIPS.map((tip): CanvasCommandSpec => ({
    id: `canvas.tips.${tip}`, label: `canvas.options.tips.${tip}`, group: "tools", keys: [], context: "tool",
  })),
];

/// I tasti dello Scrittoio che la lavagna prende, col fuoco su di sé, per
/// dichiarazione (ADR 0223): lo zoom della tela al posto di quello della
/// finestra, com'era già prima del catalogo.
export const CANVAS_DECLARED_SHELL_KEYS: readonly string[] = ["Mod-=", "Mod--", "Mod-0"];

/// Che cosa fa un comando: lo dà la tela.
export interface CanvasCommandBehaviour {
  disabled(): string | null;
  run(args?: CanvasCommandArgs): void;
}

/// I comandi di adesso: i dati del catalogo col comportamento della tela e i
/// nomi nella lingua di adesso. Un comando senza comportamento non c'è.
export function buildCanvasCommands(
  behaviour: (id: string) => CanvasCommandBehaviour | null,
  text: (key: Key) => string,
): CanvasCommand[] {
  const root = text("canvas.surface");
  const found: CanvasCommand[] = [];
  for (const spec of CANVAS_COMMANDS) {
    const does = behaviour(spec.id);
    if (does === null) continue;
    found.push({
      id: spec.id,
      label: text(spec.label),
      path: `${root} › ${text(CANVAS_COMMAND_GROUPS[spec.group])}`,
      keys: spec.keys,
      context: spec.context,
      boardKeys: spec.boardKeys === true,
      danger: spec.danger === true,
      disabled: () => does.disabled(),
      run: (args) => does.run(args),
    });
  }
  return found;
}

// --- i tasti ---------------------------------------------------------------

/// Un tasto della lavagna, scomposto. Diversamente dalle scorciatoie della
/// shell un tasto può essere nudo (`Delete`, `+`): vale solo fuori dalla
/// scrittura.
export interface CanvasKey {
  /// Il tasto, minuscolo, come lo scrive `KeyboardEvent.key`.
  readonly key: string;
  /// Ctrl, o Cmd sul Mac.
  readonly mod: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}

/// Il tasto `binding`, o `null` se non si legge. `Mod--` è Ctrl col meno, `-`
/// il meno da solo.
export function parseCanvasKey(binding: string): CanvasKey | null {
  const text = binding.trim();
  if (text === "" || /\s/.test(text)) return null;
  const minus = text === "-" || text.endsWith("--");
  const parts = minus ? text.slice(0, -2).split("-").filter(Boolean) : text.split("-");
  const key = minus ? "-" : parts.pop();
  if (!key) return null;
  const mods = parts.map((part) => part.toLowerCase());
  if (mods.some((mod) => mod !== "mod" && mod !== "shift" && mod !== "alt")) return null;
  if (new Set(mods).size !== mods.length) return null;
  return { key: key.toLowerCase(), mod: mods.includes("mod"), shift: mods.includes("shift"), alt: mods.includes("alt") };
}

/// Un tasto senza Ctrl né Alt: scrive, e mentre si scrive non vale.
export function writesText(key: CanvasKey): boolean {
  return !key.mod && !key.alt;
}

/// I tasti dove la tastiera li ha, per chi non li scrive con quel tasto: sulla
/// tastiera italiana le quadre sono «è» e «+», la barra è Maiusc+7, e con
/// Maiusc le cifre scrivono un segno.
const KEY_CODES: Readonly<Record<string, string>> = {
  "[": "BracketLeft",
  "]": "BracketRight",
  "/": "Slash",
  ...Object.fromEntries([..."0123456789"].map((digit) => [digit, `Digit${digit}`])),
};

/// I tasti premuti, come li dice un evento della tastiera.
export interface CanvasKeyPress {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/// Il tasto premuto è `binding`? Ctrl e Cmd valgono tutti e due per `Mod`.
/// Un segno che non è una lettera né una cifra (`+`, `/`) si scrive con o
/// senza Maiusc secondo la tastiera, e allora Maiusc non conta. Con `byPlace`
/// una cifra o un segno si riconosce anche dal posto del tasto (`code`):
/// serve dove il tasto scrive altro (Maiusc+1 scrive «!»).
export function matchesCanvasKey(press: CanvasKeyPress, binding: string, byPlace = true): boolean {
  const want = parseCanvasKey(binding);
  if (want === null) return false;
  if ((press.ctrlKey || press.metaKey) !== want.mod || press.altKey !== want.alt) return false;
  const pressed = press.key.toLowerCase();
  const symbol = want.key.length === 1 && !/[a-z0-9]/.test(want.key);
  if (pressed === want.key && (symbol || press.shiftKey === want.shift)) return true;
  if (!byPlace) return false;
  const code = KEY_CODES[want.key];
  return code !== undefined && press.code === code && press.shiftKey === want.shift;
}

/// Dove arriva il tasto: in un campo dove si scrive, sulla lavagna o su una
/// scheda col fuoco.
export interface CanvasKeyTarget {
  readonly writing: boolean;
  readonly onBoard: boolean;
}

/// Il comando del tasto premuto, o `null`. Mentre si scrive un tasto senza
/// Ctrl né Alt non vale (una lettera, Canc, le frecce sono del testo).
export function commandForKey(
  commands: readonly CanvasCommand[],
  press: CanvasKeyPress,
  where: CanvasKeyTarget,
): CanvasCommand | null {
  // Prima il tasto che si legge, poi il posto: sulla tastiera italiana il
  // «+» sta dove l'americana ha «]», e Ctrl++ resta lo zoom.
  for (const byPlace of [false, true]) {
    for (const command of commands) {
      if (command.boardKeys && !where.onBoard) continue;
      for (const binding of command.keys) {
        const key = parseCanvasKey(binding);
        if (key === null || (where.writing && writesText(key))) continue;
        if (matchesCanvasKey(press, binding, byPlace)) return command;
      }
    }
  }
  return null;
}

/// Il tasto come si legge: `Ctrl+Z`, `Shift+1`, `Del`, `+`; `⌘Z` sul Mac.
export function displayCanvasKey(
  binding: string,
  platform: KeyboardPlatform = keyboardPlatform(globalThis.navigator?.platform ?? ""),
): string {
  const key = parseCanvasKey(binding);
  if (key === null) return binding;
  const parts: string[] = [];
  if (key.mod) parts.push(modifierName("mod", platform)!);
  if (key.alt) parts.push(modifierName("alt", platform)!);
  if (key.shift) parts.push(modifierName("shift", platform)!);
  parts.push(keyName(key.key, platform));
  return parts.join(platform === "mac" ? "" : "+");
}

/// Il tasto da mostrare di un comando, o `""` se non ne ha.
export function commandHint(command: Pick<CanvasCommand, "keys">): string {
  const first = command.keys[0];
  return first === undefined ? "" : displayCanvasKey(first);
}

/// Il tasto premuto apre la ricerca dei comandi?
export function isCommandSearchKey(press: CanvasKeyPress): boolean {
  return matchesCanvasKey(press, "Mod-/");
}
