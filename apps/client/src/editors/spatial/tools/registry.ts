// Il registro degli strumenti, uno solo per tutti i livelli: ogni strumento
// dichiara id, livello minimo, gruppo, icona, etichetta, scorciatoia e
// descrizione per lo screen reader, e i livelli filtrano: la barra e i tasti
// di un livello sono i suoi strumenti e quelli dei livelli sotto.
//
// Il registro elenca anche le parti che un livello offre o no, strumenti e
// comandi (`FEATURES`): un livello pronto ha quelle del suo livello e dei
// livelli sotto, il Personalizzato quelle scelte una per una. La Selezione
// c'è sempre, come i colori della tavolozza, gli spessori, annulla e la vista.
//
// Le scorciatoie sono una lettera senza modificatori, quelle che chi disegna
// conosce già da altri programmi, e valgono solo col fuoco sulla superficie.

import type { DrawKey } from "../strings";

/// I livelli pronti, dal più semplice al più ricco.
export type Preset = "essential" | "standard" | "expert";

/// I livelli dell'interfaccia: i tre pronti, e il Personalizzato, che ha le
/// parti scelte una per una.
export type Level = Preset | "custom";

const LEVEL_ORDER: readonly Preset[] = ["essential", "standard", "expert"];

export type ToolId =
  | "select"
  | "lasso"
  | "nodes"
  | "builder"
  | "scissors"
  | "width"
  | "pen"
  | "highlighter"
  | "eraser"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "polygon"
  | "bezier"
  | "text";

/// Come la barra raggruppa gli strumenti: scegliere, scrivere a mano, forme,
/// testo.
export type ToolGroup = "pick" | "ink" | "shape" | "text";

export interface ToolSpec {
  readonly id: ToolId;
  readonly level: Preset;
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
  // Lo stesso tasto di Illustrator.
  { id: "lasso", level: "standard", group: "pick", icon: "draw-lasso", label: "draw.tool.lasso", description: "draw.tool.lasso.hint", shortcut: "q" },
  // Lo stesso tasto di Inkscape.
  { id: "nodes", level: "expert", group: "pick", icon: "draw-nodes", label: "draw.tool.nodes", description: "draw.tool.nodes.hint", shortcut: "n" },
  // La lettera di Illustrator, che la vuole con Maiusc: qui, come per gli
  // altri strumenti, da sola.
  { id: "builder", level: "expert", group: "pick", icon: "draw-builder", label: "draw.tool.builder", description: "draw.tool.builder.hint", shortcut: "m" },
  // La lettera di Illustrator. Un tocco taglia, un trascinamento è il
  // Coltello, che in Illustrator è uno strumento a parte.
  { id: "scissors", level: "expert", group: "pick", icon: "draw-scissors", label: "draw.tool.scissors", description: "draw.tool.scissors.hint", shortcut: "c" },
  // La lettera di Illustrator, che la vuole con Maiusc.
  { id: "width", level: "expert", group: "pick", icon: "draw-width", label: "draw.tool.width", description: "draw.tool.width.hint", shortcut: "w" },
  { id: "pen", level: "essential", group: "ink", icon: "draw-pen", label: "draw.tool.pen", description: "draw.tool.pen.hint", shortcut: "p" },
  { id: "highlighter", level: "standard", group: "ink", icon: "draw-highlighter", label: "draw.tool.highlighter", description: "draw.tool.highlighter.hint", shortcut: "h" },
  { id: "eraser", level: "essential", group: "ink", icon: "draw-eraser", label: "draw.tool.eraser", description: "draw.tool.eraser.hint", shortcut: "e" },
  { id: "rect", level: "essential", group: "shape", icon: "draw-rect", label: "draw.tool.rect", description: "draw.tool.rect.hint", shortcut: "r" },
  { id: "ellipse", level: "essential", group: "shape", icon: "draw-ellipse", label: "draw.tool.ellipse", description: "draw.tool.ellipse.hint", shortcut: "o" },
  { id: "line", level: "essential", group: "shape", icon: "draw-line", label: "draw.tool.line", description: "draw.tool.line.hint", shortcut: "l" },
  { id: "arrow", level: "essential", group: "shape", icon: "draw-arrow", label: "draw.tool.arrow", description: "draw.tool.arrow.hint", shortcut: "a" },
  // Lo stesso tasto di CorelDRAW. Premuto di nuovo, lo strumento passa dal
  // poligono alla stella e ritorno: etichetta e icona sono quelle del
  // poligono, l'editor le cambia per la stella.
  { id: "polygon", level: "standard", group: "shape", icon: "draw-polygon", label: "draw.tool.polygon", description: "draw.tool.polygon.hint", shortcut: "y" },
  // Lo stesso tasto di Inkscape, dove la penna di Bézier è «B».
  { id: "bezier", level: "expert", group: "shape", icon: "draw-bezier", label: "draw.tool.bezier", description: "draw.tool.bezier.hint", shortcut: "b" },
  { id: "text", level: "standard", group: "text", icon: "draw-text", label: "draw.tool.text", description: "draw.tool.text.hint", shortcut: "t" },
];

/// Lo strumento con cui si apre un disegno: la penna, perché un disegno si
/// apre per disegnare.
export const DEFAULT_TOOL: ToolId = "pen";

/// Una parte che un livello offre o no: uno strumento, tranne la Selezione,
/// o un comando con i suoi tasti.
export type Feature =
  | Exclude<ToolId, "select">
  | "colors"
  | "selection"
  | "arrange"
  | "layers"
  | "grid"
  | "guides"
  | "rulers"
  | "recognize"
  | "gestures"
  | "links"
  | "images"
  | "properties"
  | "style"
  | "history"
  | "accessibility"
  | "attributes"
  | "outline"
  | "transform"
  | "apply"
  | "path"
  | "boolean";

export interface FeatureSpec {
  readonly id: Feature;
  /// Il livello pronto da cui la parte c'è.
  readonly level: Preset;
  readonly label: DrawKey;
}

/// I comandi, nell'ordine della barra: quelli dello Standard, poi quelli
/// dell'Esperto.
const COMMANDS: readonly FeatureSpec[] = [
  { id: "colors", level: "standard", label: "draw.feature.colors" },
  { id: "selection", level: "standard", label: "draw.feature.selection" },
  { id: "arrange", level: "standard", label: "draw.feature.arrange" },
  { id: "layers", level: "standard", label: "draw.feature.layers" },
  { id: "grid", level: "standard", label: "draw.feature.grid" },
  { id: "guides", level: "standard", label: "draw.feature.guides" },
  { id: "rulers", level: "standard", label: "draw.feature.rulers" },
  { id: "recognize", level: "standard", label: "draw.feature.recognize" },
  { id: "gestures", level: "standard", label: "draw.feature.gestures" },
  { id: "links", level: "standard", label: "draw.feature.links" },
  { id: "images", level: "standard", label: "draw.feature.images" },
  { id: "properties", level: "standard", label: "draw.feature.properties" },
  { id: "style", level: "standard", label: "draw.feature.style" },
  { id: "history", level: "standard", label: "draw.feature.history" },
  { id: "accessibility", level: "standard", label: "draw.feature.accessibility" },
  { id: "attributes", level: "expert", label: "draw.feature.attributes" },
  { id: "outline", level: "expert", label: "draw.feature.outline" },
  { id: "transform", level: "expert", label: "draw.feature.transform" },
  { id: "apply", level: "expert", label: "draw.feature.apply" },
  { id: "path", level: "expert", label: "draw.feature.path" },
  { id: "boolean", level: "expert", label: "draw.feature.boolean" },
];

/// Tutte le parti, per livello, e in un livello prima gli strumenti
/// nell'ordine della barra: l'ordine in cui il Personalizzato le propone.
export const FEATURES: readonly FeatureSpec[] = LEVEL_ORDER.flatMap((level) => [
  ...TOOLS.filter((tool) => tool.id !== "select" && tool.level === level).map(
    (tool): FeatureSpec => ({ id: tool.id as Feature, level, label: tool.label }),
  ),
  ...COMMANDS.filter((command) => command.level === level),
]);

/// Le parti del Personalizzato quando nessuno le ha scelte: quelle
/// dell'Essenziale.
export const CUSTOM_DEFAULT: readonly Feature[] = FEATURES.filter((feature) => feature.level === "essential").map((feature) => feature.id);

/// Vero se `value` è il nome di un livello.
export function isLevel(value: unknown): value is Level {
  return value === "custom" || (typeof value === "string" && (LEVEL_ORDER as readonly string[]).includes(value));
}

/// Vero se `value` è il nome di una parte.
export function isFeature(value: unknown): value is Feature {
  return FEATURES.some((feature) => feature.id === value);
}

/// Vero se ciò che chiede il livello `minimum` c'è al livello `level`.
export function reaches(level: Preset, minimum: Preset): boolean {
  return LEVEL_ORDER.indexOf(minimum) <= LEVEL_ORDER.indexOf(level);
}

/// I livelli pronti sopra `level`, dal più vicino; per il Personalizzato
/// tutti, perché ognuno può avere parti che non sono state scelte.
export function levelsAbove(level: Level): readonly Preset[] {
  return level === "custom" ? LEVEL_ORDER : LEVEL_ORDER.slice(LEVEL_ORDER.indexOf(level) + 1);
}

/// Le parti che l'editor offre al livello `level`: per un livello pronto le
/// sue e quelle dei livelli sotto, per il Personalizzato quelle di `custom`
/// che l'editor conosce. Un nome che non conosce, di una versione più nuova o
/// scritto a mano, non conta.
export function featuresFor(level: Level, custom: readonly unknown[] = CUSTOM_DEFAULT): ReadonlySet<Feature> {
  if (level === "custom") return new Set(custom.filter(isFeature));
  return new Set(FEATURES.filter((feature) => reaches(level, feature.level)).map((feature) => feature.id));
}

/// Gli strumenti delle parti `features`, nell'ordine della barra: la
/// Selezione c'è sempre.
export function toolsOf(features: ReadonlySet<Feature>): readonly ToolSpec[] {
  return TOOLS.filter((tool) => tool.id === "select" || features.has(tool.id));
}

/// Gli strumenti di un livello pronto: i suoi e quelli dei livelli sotto.
export function toolsFor(level: Preset): readonly ToolSpec[] {
  return toolsOf(featuresFor(level));
}

/// Lo strumento con cui si comincia fra `tools`: la penna, se c'è; altrimenti
/// il primo con cui si disegna, nell'ordine della barra; altrimenti la
/// Selezione.
export function startTool(tools: readonly ToolSpec[]): ToolId {
  if (tools.some((tool) => tool.id === DEFAULT_TOOL)) return DEFAULT_TOOL;
  return tools.find((tool) => tool.group !== "pick")?.id ?? "select";
}

/// Lo strumento che prende il posto di `lost` quando se ne va, fra `tools`:
/// dopo uno strumento che sceglie, il Lazo, i Nodi o il Costruttore, la
/// Selezione, così chi sceglieva non si ritrova a disegnare; dopo gli altri,
/// quello con cui si comincia.
export function toolAfter(tools: readonly ToolSpec[], lost: ToolId): ToolId {
  return toolSpec(lost).group === "pick" ? "select" : startTool(tools);
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
