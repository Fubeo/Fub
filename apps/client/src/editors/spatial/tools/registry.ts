// Il registro degli strumenti, uno solo per tutti i livelli: ogni strumento
// dichiara id, livello minimo, gruppo, icona, etichetta, scorciatoia e
// descrizione per lo screen reader, e i livelli filtrano: la barra e i tasti
// di un livello sono i suoi strumenti e quelli dei livelli sotto.
//
// Le scorciatoie sono una lettera senza modificatori, quelle che chi disegna
// conosce già da altri programmi, e valgono solo col fuoco sulla superficie.

import type { DrawKey } from "../strings";

/// I livelli dell'interfaccia, dal più semplice al più ricco.
export type Level = "essential" | "standard" | "expert";

const LEVEL_ORDER: readonly Level[] = ["essential", "standard", "expert"];

export type ToolId = "select" | "pen" | "highlighter" | "eraser" | "rect" | "ellipse" | "line" | "arrow";

/// Come la barra raggruppa gli strumenti: scegliere, scrivere, forme.
export type ToolGroup = "pick" | "ink" | "shape";

export interface ToolSpec {
  readonly id: ToolId;
  readonly level: Level;
  readonly group: ToolGroup;
  /// Il nome di un'icona registrata (`ui/icons.ts`).
  readonly icon: string;
  readonly label: DrawKey;
  readonly description: DrawKey;
  /// Il tasto, minuscolo, come lo dà `KeyboardEvent.key`.
  readonly shortcut: string;
}

export const TOOLS: readonly ToolSpec[] = [
  { id: "select", level: "essential", group: "pick", icon: "draw-select", label: "draw.tool.select", description: "draw.tool.select.hint", shortcut: "v" },
  { id: "pen", level: "essential", group: "ink", icon: "draw-pen", label: "draw.tool.pen", description: "draw.tool.pen.hint", shortcut: "p" },
  { id: "highlighter", level: "standard", group: "ink", icon: "draw-highlighter", label: "draw.tool.highlighter", description: "draw.tool.highlighter.hint", shortcut: "h" },
  { id: "eraser", level: "essential", group: "ink", icon: "draw-eraser", label: "draw.tool.eraser", description: "draw.tool.eraser.hint", shortcut: "e" },
  { id: "rect", level: "essential", group: "shape", icon: "draw-rect", label: "draw.tool.rect", description: "draw.tool.rect.hint", shortcut: "r" },
  { id: "ellipse", level: "essential", group: "shape", icon: "draw-ellipse", label: "draw.tool.ellipse", description: "draw.tool.ellipse.hint", shortcut: "o" },
  { id: "line", level: "essential", group: "shape", icon: "draw-line", label: "draw.tool.line", description: "draw.tool.line.hint", shortcut: "l" },
  { id: "arrow", level: "essential", group: "shape", icon: "draw-arrow", label: "draw.tool.arrow", description: "draw.tool.arrow.hint", shortcut: "a" },
];

/// Lo strumento con cui si apre un disegno: la penna, perché un disegno si
/// apre per disegnare.
export const DEFAULT_TOOL: ToolId = "pen";

/// Vero se ciò che chiede il livello `minimum` c'è al livello `level`.
export function reaches(level: Level, minimum: Level): boolean {
  return LEVEL_ORDER.indexOf(minimum) <= LEVEL_ORDER.indexOf(level);
}

/// Gli strumenti di un livello: i suoi e quelli dei livelli sotto.
export function toolsFor(level: Level): readonly ToolSpec[] {
  return TOOLS.filter((tool) => reaches(level, tool.level));
}

export function toolSpec(id: ToolId): ToolSpec {
  return TOOLS.find((tool) => tool.id === id)!;
}

/// Lo strumento di un tasto premuto senza modificatori, fra quelli di
/// `tools`.
export function toolForKey(tools: readonly ToolSpec[], key: string): ToolSpec | null {
  const lower = key.toLowerCase();
  return tools.find((tool) => tool.shortcut === lower) ?? null;
}
