// Il registro degli strumenti, uno solo per tutti i livelli: ogni strumento
// dichiara id, livello minimo, gruppo, icona, etichetta, scorciatoia e
// descrizione per lo screen reader, e i livelli filtrano: la barra e i tasti
// di un livello sono i suoi strumenti e quelli dei livelli sotto.
//
// Il livello minimo dipende dal profilo, perché profili e livelli sono
// indipendenti: un disegno (`vector`) ha all'Essenziale la penna, la gomma e
// le forme; le annotazioni di un PDF (`pdf`) hanno all'Essenziale penna,
// evidenziatore e gomma, e allo Standard le note, le forme e la copertura.
// Uno strumento senza livello per un profilo non c'è.
//
// Il registro elenca anche le parti che un livello offre o no, strumenti e
// comandi (`FEATURES`): un livello pronto ha quelle del suo livello e dei
// livelli sotto, il Personalizzato quelle scelte una per una. La Selezione
// c'è sempre, come i colori della tavolozza, gli spessori, annulla e la vista.
// Le annotazioni di un PDF hanno i loro strumenti e nessuno dei comandi: le
// parti dei livelli sono quelle del disegno.
//
// Le scorciatoie sono una lettera senza modificatori, quelle che chi disegna
// conosce già da altri programmi, e valgono solo col fuoco sulla superficie.
// Una lettera nomina uno strumento solo in ogni profilo.

import type { DrawKey } from "../strings";

/// I livelli pronti, dal più semplice al più ricco.
export type Preset = "essential" | "standard" | "expert";

/// I livelli dell'interfaccia: i tre pronti, e il Personalizzato, che ha le
/// parti scelte una per una.
export type Level = Preset | "custom";

const LEVEL_ORDER: readonly Preset[] = ["essential", "standard", "expert"];

export type ToolId =
  | "select"
  | "hand"
  | "zoom"
  | "lasso"
  | "board"
  | "eyedropper"
  | "gradient"
  | "pen"
  | "highlighter"
  | "eraser"
  | "note"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "connector"
  | "cover"
  | "polygon"
  | "text";

/// I profili della famiglia `canvas` che hanno strumenti: il disegno e le
/// annotazioni di un PDF.
export type ToolProfile = "vector" | "pdf";

/// Come la barra raggruppa gli strumenti: scegliere, scrivere a mano, forme,
/// testo.
export type ToolGroup = "pick" | "ink" | "shape" | "text";

export interface ToolSpec {
  readonly id: ToolId;
  /// Il livello minimo per profilo; un profilo che manca non lo offre.
  readonly levels: Readonly<Partial<Record<ToolProfile, Preset>>>;
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
  /// Nello spazio «Semplice».
  readonly simple?: true;
}

const BOTH = { vector: "essential", pdf: "essential" } as const;
const SHAPE = { vector: "essential", pdf: "standard" } as const;

/// Nell'ordine della barra.
export const TOOLS: readonly ToolSpec[] = [
  { id: "select", levels: BOTH, group: "pick", icon: "draw-select", label: "draw.tool.select", description: "draw.tool.select.hint", shortcut: "v" },
  // La mano e la lente muovono la vista, non il disegno: ci sono sempre.
  { id: "hand", levels: BOTH, group: "pick", icon: "draw-hand", label: "draw.tool.hand", description: "draw.tool.hand.hint", shortcut: "h" },
  { id: "zoom", levels: BOTH, group: "pick", icon: "draw-zoom", label: "draw.tool.zoom", description: "draw.tool.zoom.hint", shortcut: "z" },
  // Lo stesso tasto di Illustrator.
  { id: "lasso", levels: { vector: "standard" }, group: "pick", icon: "draw-lasso", label: "draw.tool.lasso", description: "draw.tool.lasso.hint", shortcut: "q" },
  // La lettera del Frame di Figma, dove le cornici sono le tavole: quella di
  // Illustrator è la «O» con Maiusc, e qui la «O» è dell'ellisse.
  { id: "board", levels: { vector: "standard" }, group: "pick", icon: "draw-board", label: "draw.tool.board", description: "draw.tool.board.hint", shortcut: "f" },
  // La lettera di Illustrator e di Photoshop.
  { id: "eyedropper", levels: { vector: "standard" }, group: "pick", icon: "draw-eyedropper", label: "draw.tool.eyedropper", description: "draw.tool.eyedropper.hint", shortcut: "i" },
  // La lettera di Illustrator. Lo strumento porta con sé la sezione
  // «Sfumatura» del pannello delle proprietà: nel Personalizzato si
  // scelgono insieme.
  { id: "gradient", levels: { vector: "standard" }, group: "pick", icon: "draw-gradient", label: "draw.tool.gradient", description: "draw.tool.gradient.hint", shortcut: "g" },
  { id: "pen", levels: BOTH, group: "ink", icon: "draw-pen", label: "draw.tool.pen", description: "draw.tool.pen.hint", shortcut: "p", simple: true },
  { id: "highlighter", levels: { vector: "standard", pdf: "essential" }, group: "ink", icon: "draw-highlighter", label: "draw.tool.highlighter", description: "draw.tool.highlighter.hint", shortcut: "Shift-p", simple: true },
  { id: "eraser", levels: BOTH, group: "ink", icon: "draw-eraser", label: "draw.tool.eraser", description: "draw.tool.eraser.hint", shortcut: "e", simple: true },
  // Le note sono del PDF: nel disegno la «N» è dei Nodi.
  { id: "note", levels: { pdf: "standard" }, group: "ink", icon: "draw-note", label: "draw.tool.note", description: "draw.tool.note.hint", shortcut: "n" },
  { id: "rect", levels: SHAPE, group: "shape", icon: "draw-rect", label: "draw.tool.rect", description: "draw.tool.rect.hint", shortcut: "r", simple: true },
  { id: "ellipse", levels: SHAPE, group: "shape", icon: "draw-ellipse", label: "draw.tool.ellipse", description: "draw.tool.ellipse.hint", shortcut: "o", simple: true },
  { id: "line", levels: SHAPE, group: "shape", icon: "draw-line", label: "draw.tool.line", description: "draw.tool.line.hint", shortcut: "l", simple: true },
  { id: "arrow", levels: SHAPE, group: "shape", icon: "draw-arrow", label: "draw.tool.arrow", description: "draw.tool.arrow.hint", shortcut: "Shift-l", simple: true },
  // La lettera di FigJam. Lo strumento porta con sé la sezione «Connettore»
  // del pannello delle proprietà e «Collega le forme scelte»: nel
  // Personalizzato si scelgono insieme.
  { id: "connector", levels: { vector: "standard" }, group: "shape", icon: "draw-connector", label: "draw.tool.connector", description: "draw.tool.connector.hint", shortcut: "x" },
  // La copertura è del PDF: nel disegno la «C» è delle Forbici.
  { id: "cover", levels: { pdf: "standard" }, group: "shape", icon: "draw-cover", label: "draw.tool.cover", description: "draw.tool.cover.hint", shortcut: "c" },
  // Lo stesso tasto di CorelDRAW. Premuto di nuovo, lo strumento passa dal
  // poligono alla stella e ritorno: etichetta e icona sono quelle del
  // poligono, l'editor le cambia per la stella.
  { id: "polygon", levels: { vector: "standard" }, group: "shape", icon: "draw-polygon", label: "draw.tool.polygon", description: "draw.tool.polygon.hint", shortcut: "y" },
  { id: "text", levels: { vector: "standard" }, group: "text", icon: "draw-text", label: "draw.tool.text", description: "draw.tool.text.hint", shortcut: "t", simple: true },
];

/// Lo strumento con cui si apre un disegno: la penna, perché un disegno si
/// apre per disegnare.
export const DEFAULT_TOOL: ToolId = "pen";

/// Lo strumento con cui si apre un profilo: un PDF si apre per evidenziare.
export function defaultTool(profile: ToolProfile): ToolId {
  return profile === "pdf" ? "highlighter" : DEFAULT_TOOL;
}

/// Gli strumenti che ci sono a ogni livello, come parti di nessuno: la
/// Selezione, la Mano e la Lente.
export type ViewTool = "select" | "hand" | "zoom";

const VIEW_TOOLS: readonly ToolId[] = ["select", "hand", "zoom"];

/// Vero per uno strumento che c'è a ogni livello.
export function isViewTool(id: ToolId): id is ViewTool {
  return VIEW_TOOLS.includes(id);
}

/// Una parte che un livello offre o no: uno strumento, tranne quelli di
/// `ViewTool`, o un comando con i suoi tasti.
export type Feature =
  | Exclude<ToolId, ViewTool>
  | "colors"
  | "swatches"
  | "styles"
  | "tips"
  | "hatches"
  | "selection"
  | "arrange"
  | "layers"
  | "grid"
  | "guides"
  | "rulers"
  | "recognize"
  | "symmetry"
  | "gestures"
  | "links"
  | "images"
  | "crop"
  | "library"
  | "properties"
  | "style"
  | "history"
  | "accessibility"
  | "export"
  | "present";

export interface FeatureSpec {
  readonly id: Feature;
  /// Il livello pronto da cui la parte c'è: conta soltanto per leggere il
  /// livello delle versioni precedenti (`draw.level`).
  readonly level: Preset;
  readonly label: DrawKey;
  /// Nello spazio «Semplice»; in «Completo» ci sono tutte.
  readonly simple?: true;
}

/// I comandi, nell'ordine della barra.
const COMMANDS: readonly FeatureSpec[] = [
  { id: "colors", level: "standard", label: "draw.feature.colors", simple: true },
  // I colori del documento sono una sezione del pannello delle proprietà:
  // nel Personalizzato si vedono con lui.
  { id: "swatches", level: "standard", label: "draw.feature.swatches" },
  // Gli stili del documento sono due righe del pannello delle proprietà e i
  // comandi del loro menu: nel Personalizzato si vedono con lui.
  { id: "styles", level: "standard", label: "draw.feature.styles" },
  // Le punte delle linee sono due campi del pannello delle proprietà, e i
  // comandi che le cambiano: nel Personalizzato si vedono con lui.
  { id: "tips", level: "standard", label: "draw.feature.tips" },
  // La campitura è una sezione del pannello delle proprietà: nel
  // Personalizzato si vede con lui.
  { id: "hatches", level: "standard", label: "draw.feature.hatches" },
  { id: "selection", level: "standard", label: "draw.feature.selection" },
  { id: "arrange", level: "standard", label: "draw.feature.arrange" },
  { id: "layers", level: "standard", label: "draw.feature.layers" },
  { id: "grid", level: "standard", label: "draw.feature.grid" },
  { id: "guides", level: "standard", label: "draw.feature.guides" },
  { id: "rulers", level: "standard", label: "draw.feature.rulers" },
  { id: "recognize", level: "standard", label: "draw.feature.recognize" },
  // La simmetria della penna è una sezione del pannello delle proprietà,
  // con la penna e l'evidenziatore: nel Personalizzato si vede con lui.
  { id: "symmetry", level: "standard", label: "draw.feature.symmetry" },
  { id: "gestures", level: "standard", label: "draw.feature.gestures", simple: true },
  { id: "links", level: "standard", label: "draw.feature.links" },
  { id: "images", level: "standard", label: "draw.feature.images", simple: true },
  { id: "crop", level: "standard", label: "draw.feature.crop" },
  { id: "library", level: "standard", label: "draw.feature.library" },
  { id: "properties", level: "standard", label: "draw.feature.properties", simple: true },
  { id: "style", level: "standard", label: "draw.feature.style" },
  { id: "history", level: "standard", label: "draw.feature.history" },
  { id: "accessibility", level: "standard", label: "draw.feature.accessibility" },
  { id: "export", level: "standard", label: "draw.feature.export", simple: true },
  { id: "present", level: "standard", label: "draw.feature.present" },
];

/// Tutte le parti del disegno, per livello, e in un livello prima gli
/// strumenti nell'ordine della barra: l'ordine in cui il Personalizzato le
/// propone.
export const FEATURES: readonly FeatureSpec[] = LEVEL_ORDER.flatMap((level) => [
  ...TOOLS.filter((tool) => !isViewTool(tool.id) && tool.levels.vector === level).map(
    (tool): FeatureSpec => ({ id: tool.id as Feature, level, label: tool.label, ...(tool.simple === true ? { simple: true } : {}) }),
  ),
  ...COMMANDS.filter((command) => command.level === level),
]);

/// Le parti del Personalizzato quando nessuno le ha scelte: quelle
/// dell'Essenziale.
export const CUSTOM_DEFAULT: readonly Feature[] = FEATURES.filter((feature) => feature.level === "essential").map((feature) => feature.id);

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

/// Le parti dello spazio «Semplice», nell'ordine delle parti.
export const SIMPLE_PARTS: readonly Feature[] = FEATURES.filter((feature) => feature.simple === true).map((feature) => feature.id);

/// Il livello con cui l'editor offre lo spazio `workspace`: «Completo» è
/// l'Esperto, che ha tutte le parti; «Semplice» il Personalizzato con le
/// parti semplici, e nelle annotazioni di un PDF l'Essenziale.
export function workspaceLevel(workspace: Workspace, profile: ToolProfile = "vector"): { readonly level: Level; readonly custom: readonly Feature[] } {
  if (workspace === "full") return { level: "expert", custom: CUSTOM_DEFAULT };
  return profile === "pdf" ? { level: "essential", custom: CUSTOM_DEFAULT } : { level: "custom", custom: SIMPLE_PARTS };
}

/// Lo spazio di lavoro che vale per un livello delle versioni precedenti:
/// l'Essenziale è «Semplice», gli altri «Completo».
export function workspaceOfLevel(level: Level): Workspace {
  return level === "essential" ? "simple" : "full";
}

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

/// Le parti che l'editor offre al livello `level` nel profilo `profile`:
/// per un livello pronto le sue e quelle dei livelli sotto, per il
/// Personalizzato quelle di `custom` che l'editor conosce. Un nome che non
/// conosce, di una versione più nuova o scritto a mano, non conta.
///
/// Le annotazioni di un PDF hanno solo i loro strumenti, e il Personalizzato
/// vale per loro come lo Standard, che li ha già tutti.
export function featuresFor(level: Level, custom: readonly unknown[] = CUSTOM_DEFAULT, profile: ToolProfile = "vector"): ReadonlySet<Feature> {
  if (profile === "pdf") {
    const preset = level === "custom" ? "standard" : level;
    return new Set(
      TOOLS.filter((tool) => !isViewTool(tool.id) && tool.levels.pdf !== undefined && reaches(preset, tool.levels.pdf)).map((tool) => tool.id as Feature),
    );
  }
  if (level === "custom") return new Set(custom.filter(isFeature));
  return new Set(FEATURES.filter((feature) => reaches(level, feature.level)).map((feature) => feature.id));
}

/// Gli strumenti delle parti `features`, nell'ordine della barra: la
/// Selezione, la Mano e la Lente ci sono sempre.
export function toolsOf(features: ReadonlySet<Feature>): readonly ToolSpec[] {
  return TOOLS.filter((tool) => (isViewTool(tool.id) ? true : features.has(tool.id)));
}

/// Gli strumenti di un livello pronto in un profilo: i suoi e quelli dei
/// livelli sotto.
export function toolsFor(level: Preset, profile: ToolProfile = "vector"): readonly ToolSpec[] {
  return toolsOf(featuresFor(level, CUSTOM_DEFAULT, profile));
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
/// dopo uno strumento che sceglie, il Lazo, i Nodi o il Costruttore, la
/// Selezione, così chi sceglieva non si ritrova a disegnare; dopo gli altri,
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

/// I tasti che presentano, col fuoco sul foglio.
const PRESENT_START_KEYS: readonly KeyRow[] = [
  ["F5", "draw.keys.present.start"],
  ["Shift-F5", "draw.keys.present.here"],
];

/// I tasti della presentazione, che sta in un modulo suo e arriva solo
/// quando si presenta: l'elenco dei tasti dell'editor li legge da qui.
const PRESENT_KEYS: readonly KeyRow[] = [
  ["ArrowRight ArrowDown Space PageDown Enter n", "draw.keys.present.forward"],
  ["ArrowLeft ArrowUp PageUp Backspace p", "draw.keys.present.back"],
  ["Home End", "draw.keys.present.ends"],
  ["0…9", "draw.keys.present.number"],
  ["b .", "draw.keys.present.black"],
  ["w ,", "draw.keys.present.white"],
  ["l", "draw.keys.present.laser"],
  ["e", "draw.keys.present.erase"],
  ["Escape", "draw.keys.present.exit"],
];

/// Le parole dei tasti: `t` di `strings.ts`, che l'editor passa.
type Say = (key: DrawKey) => string;

/// Le righe dei tasti che presentano, per il gruppo della vista dell'elenco
/// dei tasti, se fra le parti `at` c'è «Presentare».
export const presentStartRows = (at: ReadonlySet<Feature>, say: Say): (readonly [string, string])[] =>
  at.has("present") ? PRESENT_START_KEYS.map(([keys, label]) => [keys, say(label)] as const) : [];

/// Il gruppo dei tasti della presentazione, per l'elenco dei tasti, se fra le
/// parti `at` c'è «Presentare».
export const presentKeyGroups = (at: ReadonlySet<Feature>, say: Say): { title: string; rows: (readonly [string, string])[] }[] =>
  at.has("present") ? [{ title: say("draw.keys.present"), rows: PRESENT_KEYS.map(([keys, label]) => [keys, say(label)] as const) }] : [];
