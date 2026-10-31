// Il registro degli strumenti, uno solo per il disegno e per le annotazioni
// di un PDF: ogni strumento dichiara id, profili, gruppo, icona, etichetta,
// scorciatoia e descrizione per lo screen reader. Non ci sono livelli (ADR
// 0231): lo spazio di lavoro sceglie che cosa si offre, «Completo» tutto e
// «Semplice» le parti per disegnare a mano o col dito.
//
// Lo spazio da cui uno strumento c'è dipende dal profilo: un disegno
// (`vector`) ha nel Semplice la penna, l'evidenziatore, la gomma e le forme;
// le annotazioni di un PDF (`pdf`) hanno nel Semplice penna, evidenziatore e
// gomma, e nel Completo anche le note, le forme e la copertura. Uno strumento
// senza spazio per un profilo non c'è.
//
// Il registro elenca anche le parti che uno spazio offre o no, strumenti e
// comandi (`FEATURES`). La Selezione c'è sempre, come i colori della
// tavolozza, gli spessori, annulla e la vista. Le annotazioni di un PDF hanno
// i loro strumenti e nessuno dei comandi.
//
// Le scorciatoie sono una lettera senza modificatori, quelle che chi disegna
// conosce già da altri programmi, e valgono solo col fuoco sulla superficie.
// Una lettera nomina uno strumento solo in ogni profilo.

import type { DrawKey } from "../strings";

export type ToolId =
  | "select"
  | "hand"
  | "zoom"
  | "pen"
  | "highlighter"
  | "eraser"
  | "note"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "cover";

/// I profili della famiglia `canvas` che hanno strumenti: il disegno e le
/// annotazioni di un PDF.
export type ToolProfile = "vector" | "pdf";

/// Come la barra raggruppa gli strumenti: scegliere, scrivere a mano, forme,
/// testo.
export type ToolGroup = "pick" | "ink" | "shape" | "text";

export interface ToolSpec {
  readonly id: ToolId;
  /// Lo spazio da cui c'è, per profilo: nel Semplice c'è anche nel
  /// Completo. Un profilo che manca non lo offre.
  readonly spaces: Readonly<Partial<Record<ToolProfile, Workspace>>>;
  readonly group: ToolGroup;
  /// Il nome di un'icona registrata (`ui/icons.ts`).
  readonly icon: string;
  readonly label: DrawKey;
  readonly description: DrawKey;
  /// Il tasto, come le scorciatoie della shell: la lettera minuscola, con
  /// `Shift-` davanti se va tenuto Maiuscolo (`Shift-p`).
  readonly shortcut: string;
  /// Altri tasti che lo scelgono, come N per i Nodi accanto ad A.
  readonly aliases?: readonly string[];
}

const BOTH = { vector: "simple", pdf: "simple" } as const;
const SHAPE = { vector: "simple", pdf: "full" } as const;

/// Nell'ordine della barra.
export const TOOLS: readonly ToolSpec[] = [
  { id: "select", spaces: BOTH, group: "pick", icon: "draw-select", label: "draw.tool.select", description: "draw.tool.select.hint", shortcut: "v" },
  // La mano e la lente muovono la vista, non il disegno: ci sono sempre.
  { id: "hand", spaces: BOTH, group: "pick", icon: "draw-hand", label: "draw.tool.hand", description: "draw.tool.hand.hint", shortcut: "h" },
  { id: "zoom", spaces: BOTH, group: "pick", icon: "draw-zoom", label: "draw.tool.zoom", description: "draw.tool.zoom.hint", shortcut: "z" },
  { id: "pen", spaces: BOTH, group: "ink", icon: "draw-pen", label: "draw.tool.pen", description: "draw.tool.pen.hint", shortcut: "p" },
  { id: "highlighter", spaces: BOTH, group: "ink", icon: "draw-highlighter", label: "draw.tool.highlighter", description: "draw.tool.highlighter.hint", shortcut: "Shift-p" },
  { id: "eraser", spaces: BOTH, group: "ink", icon: "draw-eraser", label: "draw.tool.eraser", description: "draw.tool.eraser.hint", shortcut: "e" },
  // Le note e la copertura sono soltanto del PDF.
  { id: "note", spaces: { pdf: "full" }, group: "ink", icon: "draw-note", label: "draw.tool.note", description: "draw.tool.note.hint", shortcut: "n" },
  { id: "rect", spaces: SHAPE, group: "shape", icon: "draw-rect", label: "draw.tool.rect", description: "draw.tool.rect.hint", shortcut: "r" },
  { id: "ellipse", spaces: SHAPE, group: "shape", icon: "draw-ellipse", label: "draw.tool.ellipse", description: "draw.tool.ellipse.hint", shortcut: "o" },
  { id: "line", spaces: SHAPE, group: "shape", icon: "draw-line", label: "draw.tool.line", description: "draw.tool.line.hint", shortcut: "l" },
  { id: "arrow", spaces: SHAPE, group: "shape", icon: "draw-arrow", label: "draw.tool.arrow", description: "draw.tool.arrow.hint", shortcut: "Shift-l" },
  { id: "cover", spaces: { pdf: "full" }, group: "shape", icon: "draw-cover", label: "draw.tool.cover", description: "draw.tool.cover.hint", shortcut: "c" },
];

/// Lo strumento con cui si apre un disegno: la penna, perché un disegno si
/// apre per disegnare.
export const DEFAULT_TOOL: ToolId = "pen";

/// Lo strumento con cui si apre un profilo: un PDF si apre per evidenziare.
export function defaultTool(profile: ToolProfile): ToolId {
  return profile === "pdf" ? "highlighter" : DEFAULT_TOOL;
}

/// Gli strumenti che ci sono in ogni spazio, come parti di nessuno: la
/// Selezione, la Mano e la Lente.
export type ViewTool = "select" | "hand" | "zoom";

const VIEW_TOOLS: readonly ToolId[] = ["select", "hand", "zoom"];

/// Vero per uno strumento che c'è in ogni spazio.
export function isViewTool(id: ToolId): id is ViewTool {
  return VIEW_TOOLS.includes(id);
}

/// Una parte che uno spazio offre o no: uno strumento, tranne quelli di
/// `ViewTool`, o un comando con i suoi tasti.
export type Feature =
  | Exclude<ToolId, ViewTool>
  | "colors"
  | "tips"
  | "selection"
  | "arrange"
  | "layers"
  | "grid"
  | "recognize"
  | "gestures"
  | "links"
  | "images"
  | "properties"
  | "style"
  | "history"
  | "accessibility"
  | "export";

export interface FeatureSpec {
  readonly id: Feature;
  readonly label: DrawKey;
  /// Nello spazio «Semplice»; in «Completo» ci sono tutte.
  readonly simple?: true;
}

/// I comandi, nell'ordine della barra.
const COMMANDS: readonly FeatureSpec[] = [
  { id: "colors", label: "draw.feature.colors", simple: true },
  // Le punte delle linee sono due campi del pannello delle proprietà, e i
  // comandi che le cambiano.
  { id: "tips", label: "draw.feature.tips" },
  { id: "selection", label: "draw.feature.selection" },
  { id: "arrange", label: "draw.feature.arrange" },
  { id: "layers", label: "draw.feature.layers" },
  { id: "grid", label: "draw.feature.grid" },
  { id: "recognize", label: "draw.feature.recognize" },
  { id: "gestures", label: "draw.feature.gestures", simple: true },
  { id: "links", label: "draw.feature.links" },
  { id: "images", label: "draw.feature.images", simple: true },
  { id: "properties", label: "draw.feature.properties", simple: true },
  { id: "style", label: "draw.feature.style" },
  { id: "history", label: "draw.feature.history" },
  { id: "accessibility", label: "draw.feature.accessibility" },
  { id: "export", label: "draw.feature.export", simple: true },
];

/// Tutte le parti del disegno: prima gli strumenti nell'ordine della barra,
/// poi i comandi.
export const FEATURES: readonly FeatureSpec[] = [
  ...TOOLS.filter((tool) => !isViewTool(tool.id) && tool.spaces.vector !== undefined).map(
    (tool): FeatureSpec => ({ id: tool.id as Feature, label: tool.label, ...(tool.spaces.vector === "simple" ? { simple: true } : {}) }),
  ),
  ...COMMANDS,
];

/// Lo spazio di lavoro: «Completo» ha tutto, «Semplice» le parti per
/// disegnare a mano o col dito, con pulsanti grandi. Nessuno dei due toglie
/// una funzione a chi la cerca: «Completo» è a un clic.
export type Workspace = "full" | "simple";

/// Gli spazi di lavoro, il primo è quello di serie.
export const WORKSPACES: readonly Workspace[] = ["full", "simple"];

/// Vero se `value` è il nome di uno spazio di lavoro.
export function isWorkspace(value: unknown): value is Workspace {
  return typeof value === "string" && (WORKSPACES as readonly string[]).includes(value);
}

/// Le parti che l'editor offre nello spazio `workspace` del profilo
/// `profile`. Le annotazioni di un PDF hanno solo i loro strumenti.
export function featuresFor(workspace: Workspace = "full", profile: ToolProfile = "vector"): ReadonlySet<Feature> {
  const offers = (space: Workspace | undefined): boolean => space !== undefined && (workspace === "full" || space === "simple");
  if (profile === "pdf") {
    return new Set(TOOLS.filter((tool) => !isViewTool(tool.id) && offers(tool.spaces.pdf)).map((tool) => tool.id as Feature));
  }
  return new Set(FEATURES.filter((feature) => workspace === "full" || feature.simple === true).map((feature) => feature.id));
}

/// Gli strumenti delle parti `features`, nell'ordine della barra: la
/// Selezione, la Mano e la Lente ci sono sempre.
export function toolsOf(features: ReadonlySet<Feature>): readonly ToolSpec[] {
  return TOOLS.filter((tool) => (isViewTool(tool.id) ? true : features.has(tool.id)));
}

/// Gli strumenti di uno spazio in un profilo.
export function toolsFor(workspace: Workspace = "full", profile: ToolProfile = "vector"): readonly ToolSpec[] {
  return toolsOf(featuresFor(workspace, profile));
}

/// Lo strumento con cui si comincia fra `tools`: quello con cui si apre il
/// profilo, se c'è; altrimenti il primo con cui si disegna, nell'ordine della
/// barra; altrimenti la Selezione.
export function startTool(tools: readonly ToolSpec[], profile: ToolProfile = "vector"): ToolId {
  const first = defaultTool(profile);
  if (tools.some((tool) => tool.id === first)) return first;
  return tools.find((tool) => tool.group !== "pick")?.id ?? "select";
}

/// Lo strumento che prende il posto di `lost` quando se ne va, fra `tools`:
/// dopo uno strumento che sceglie, la Selezione, così chi sceglieva non si ritrova a disegnare; dopo gli altri,
/// quello con cui si comincia.
export function toolAfter(tools: readonly ToolSpec[], lost: ToolId, profile: ToolProfile = "vector"): ToolId {
  return toolSpec(lost).group === "pick" ? "select" : startTool(tools, profile);
}

export function toolSpec(id: ToolId): ToolSpec {
  return TOOLS.find((tool) => tool.id === id)!;
}

/// Lo strumento di un tasto premuto senza modificatori, o col solo
/// Maiuscolo (`shift`), fra quelli di `tools`: prima il suo tasto, poi gli
/// altri, così un tasto proprio vince sull'alias di un altro.
export function toolForKey(tools: readonly ToolSpec[], key: string, shift = false): ToolSpec | null {
  const pressed = `${shift ? "Shift-" : ""}${key.toLowerCase()}`;
  return tools.find((tool) => tool.shortcut === pressed) ?? tools.find((tool) => tool.aliases?.includes(pressed)) ?? null;
}

/// Un tasto di strumento come si legge, che è anche la forma di
/// `aria-keyshortcuts`: `Shift-p` è «Shift+P».
export function toolKeyText(binding: string): string {
  const shift = binding.startsWith("Shift-");
  const letter = (shift ? binding.slice("Shift-".length) : binding).toUpperCase();
  return shift ? `Shift+${letter}` : letter;
}

/// I tasti di uno strumento per l'elenco dei tasti: il suo, poi gli altri.
export function toolKeys(spec: ToolSpec): string {
  return [spec.shortcut, ...(spec.aliases ?? [])].join(" ");
}

/// Una riga dell'elenco dei tasti: i tasti, nella forma delle scorciatoie
/// della shell, e che cosa fanno.
export type KeyRow = readonly [keys: string, label: DrawKey];

