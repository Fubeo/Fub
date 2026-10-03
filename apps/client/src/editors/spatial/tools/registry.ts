// Il registro degli strumenti (piano §6, regola 1): ogni strumento dichiara
// id, livello minimo, gruppo, icona, etichetta, scorciatoia e descrizione per
// lo screen reader, e i livelli filtrano. Qui ci sono gli strumenti
// dell'Essenziale e dello Standard; l'Esperto si aggiunge alla stessa lista.
//
// Il livello minimo dipende dal profilo (piano §6, regola 4): un disegno
// (`vector`) ha all'Essenziale la penna, la gomma e le forme; le annotazioni
// di un PDF (`pdf`) hanno all'Essenziale penna, evidenziatore e gomma, e allo
// Standard le note, le forme e la copertura. Uno strumento senza livello per
// un profilo non c'è.
//
// Le scorciatoie sono una lettera senza modificatori, quelle che chi disegna
// conosce già da altri programmi, e valgono solo col fuoco sulla superficie.

import type { Key } from "../../../i18n/strings";

/// I livelli di DEC-13, in ordine.
export type Level = "essential" | "standard" | "expert";

const LEVEL_ORDER: readonly Level[] = ["essential", "standard", "expert"];

export type ToolId = "select" | "pen" | "highlighter" | "eraser" | "note" | "rect" | "ellipse" | "line" | "arrow" | "cover";

/// I profili della famiglia `canvas` che hanno strumenti.
export type ToolProfile = "vector" | "pdf";

/// Come la barra raggruppa gli strumenti: scegliere, scrivere, forme.
export type ToolGroup = "pick" | "ink" | "shape";

export interface ToolSpec {
  readonly id: ToolId;
  /// Il livello minimo per profilo; un profilo che manca non lo offre.
  readonly levels: Readonly<Partial<Record<ToolProfile, Level>>>;
  readonly group: ToolGroup;
  /// Il nome di un'icona registrata (`ui/icons.ts`).
  readonly icon: string;
  readonly label: Key;
  readonly description: Key;
  /// Il tasto, minuscolo, come lo dà `KeyboardEvent.key`.
  readonly shortcut: string;
}

const BOTH = { vector: "essential", pdf: "essential" } as const;
const SHAPE = { vector: "essential", pdf: "standard" } as const;

/// Nell'ordine della barra.
export const TOOLS: readonly ToolSpec[] = [
  { id: "select", levels: BOTH, group: "pick", icon: "draw-select", label: "draw.tool.select", description: "draw.tool.select.hint", shortcut: "v" },
  { id: "pen", levels: BOTH, group: "ink", icon: "draw-pen", label: "draw.tool.pen", description: "draw.tool.pen.hint", shortcut: "p" },
  { id: "highlighter", levels: { pdf: "essential" }, group: "ink", icon: "draw-highlighter", label: "draw.tool.highlighter", description: "draw.tool.highlighter.hint", shortcut: "h" },
  { id: "eraser", levels: BOTH, group: "ink", icon: "draw-eraser", label: "draw.tool.eraser", description: "draw.tool.eraser.hint", shortcut: "e" },
  { id: "note", levels: { pdf: "standard" }, group: "ink", icon: "draw-note", label: "draw.tool.note", description: "draw.tool.note.hint", shortcut: "n" },
  { id: "rect", levels: SHAPE, group: "shape", icon: "draw-rect", label: "draw.tool.rect", description: "draw.tool.rect.hint", shortcut: "r" },
  { id: "ellipse", levels: SHAPE, group: "shape", icon: "draw-ellipse", label: "draw.tool.ellipse", description: "draw.tool.ellipse.hint", shortcut: "o" },
  { id: "line", levels: SHAPE, group: "shape", icon: "draw-line", label: "draw.tool.line", description: "draw.tool.line.hint", shortcut: "l" },
  { id: "arrow", levels: SHAPE, group: "shape", icon: "draw-arrow", label: "draw.tool.arrow", description: "draw.tool.arrow.hint", shortcut: "a" },
  { id: "cover", levels: { pdf: "standard" }, group: "shape", icon: "draw-cover", label: "draw.tool.cover", description: "draw.tool.cover.hint", shortcut: "c" },
];

/// Lo strumento con cui si apre un disegno: la penna, perché un disegno si
/// apre per disegnare.
export const DEFAULT_TOOL: ToolId = "pen";

/// Lo strumento con cui si apre un profilo: un PDF si apre per evidenziare.
export function defaultTool(profile: ToolProfile): ToolId {
  return profile === "pdf" ? "highlighter" : DEFAULT_TOOL;
}

/// Gli strumenti di un livello in un profilo: i suoi e quelli dei livelli
/// sotto.
export function toolsFor(level: Level, profile: ToolProfile = "vector"): readonly ToolSpec[] {
  const rank = LEVEL_ORDER.indexOf(level);
  return TOOLS.filter((tool) => {
    const min = tool.levels[profile];
    return min !== undefined && LEVEL_ORDER.indexOf(min) <= rank;
  });
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
