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
  | "lasso"
  | "nodes"
  | "builder"
  | "scissors"
  | "width"
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
  | "bezier"
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
  /// Il tasto, minuscolo, come lo dà `KeyboardEvent.key`.
  readonly shortcut: string;
}

const BOTH = { vector: "essential", pdf: "essential" } as const;
const SHAPE = { vector: "essential", pdf: "standard" } as const;

/// Nell'ordine della barra.
export const TOOLS: readonly ToolSpec[] = [
  { id: "select", levels: BOTH, group: "pick", icon: "draw-select", label: "draw.tool.select", description: "draw.tool.select.hint", shortcut: "v" },
  // Lo stesso tasto di Illustrator.
  { id: "lasso", levels: { vector: "standard" }, group: "pick", icon: "draw-lasso", label: "draw.tool.lasso", description: "draw.tool.lasso.hint", shortcut: "q" },
  // Lo stesso tasto di Inkscape.
  { id: "nodes", levels: { vector: "expert" }, group: "pick", icon: "draw-nodes", label: "draw.tool.nodes", description: "draw.tool.nodes.hint", shortcut: "n" },
  // La lettera di Illustrator, che la vuole con Maiusc: qui, come per gli
  // altri strumenti, da sola.
  { id: "builder", levels: { vector: "expert" }, group: "pick", icon: "draw-builder", label: "draw.tool.builder", description: "draw.tool.builder.hint", shortcut: "m" },
  // La lettera di Illustrator. Un tocco taglia, un trascinamento è il
  // Coltello, che in Illustrator è uno strumento a parte.
  { id: "scissors", levels: { vector: "expert" }, group: "pick", icon: "draw-scissors", label: "draw.tool.scissors", description: "draw.tool.scissors.hint", shortcut: "c" },
  // La lettera di Illustrator, che la vuole con Maiusc.
  { id: "width", levels: { vector: "expert" }, group: "pick", icon: "draw-width", label: "draw.tool.width", description: "draw.tool.width.hint", shortcut: "w" },
  // La lettera del Frame di Figma, dove le cornici sono le tavole: quella di
  // Illustrator è la «O» con Maiusc, e qui la «O» è dell'ellisse.
  { id: "board", levels: { vector: "standard" }, group: "pick", icon: "draw-board", label: "draw.tool.board", description: "draw.tool.board.hint", shortcut: "f" },
  // La lettera di Illustrator e di Photoshop.
  { id: "eyedropper", levels: { vector: "standard" }, group: "pick", icon: "draw-eyedropper", label: "draw.tool.eyedropper", description: "draw.tool.eyedropper.hint", shortcut: "i" },
  // La lettera di Illustrator. Lo strumento porta con sé la sezione
  // «Sfumatura» del pannello delle proprietà: nel Personalizzato si
  // scelgono insieme.
  { id: "gradient", levels: { vector: "standard" }, group: "pick", icon: "draw-gradient", label: "draw.tool.gradient", description: "draw.tool.gradient.hint", shortcut: "g" },
  { id: "pen", levels: BOTH, group: "ink", icon: "draw-pen", label: "draw.tool.pen", description: "draw.tool.pen.hint", shortcut: "p" },
  { id: "highlighter", levels: { vector: "standard", pdf: "essential" }, group: "ink", icon: "draw-highlighter", label: "draw.tool.highlighter", description: "draw.tool.highlighter.hint", shortcut: "h" },
  { id: "eraser", levels: BOTH, group: "ink", icon: "draw-eraser", label: "draw.tool.eraser", description: "draw.tool.eraser.hint", shortcut: "e" },
  // Le note sono del PDF: nel disegno la «N» è dei Nodi.
  { id: "note", levels: { pdf: "standard" }, group: "ink", icon: "draw-note", label: "draw.tool.note", description: "draw.tool.note.hint", shortcut: "n" },
  { id: "rect", levels: SHAPE, group: "shape", icon: "draw-rect", label: "draw.tool.rect", description: "draw.tool.rect.hint", shortcut: "r" },
  { id: "ellipse", levels: SHAPE, group: "shape", icon: "draw-ellipse", label: "draw.tool.ellipse", description: "draw.tool.ellipse.hint", shortcut: "o" },
  { id: "line", levels: SHAPE, group: "shape", icon: "draw-line", label: "draw.tool.line", description: "draw.tool.line.hint", shortcut: "l" },
  { id: "arrow", levels: SHAPE, group: "shape", icon: "draw-arrow", label: "draw.tool.arrow", description: "draw.tool.arrow.hint", shortcut: "a" },
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
  // Lo stesso tasto di Inkscape, dove la penna di Bézier è «B».
  { id: "bezier", levels: { vector: "expert" }, group: "shape", icon: "draw-bezier", label: "draw.tool.bezier", description: "draw.tool.bezier.hint", shortcut: "b" },
  { id: "text", levels: { vector: "standard" }, group: "text", icon: "draw-text", label: "draw.tool.text", description: "draw.tool.text.hint", shortcut: "t" },
];

/// Lo strumento con cui si apre un disegno: la penna, perché un disegno si
/// apre per disegnare.
export const DEFAULT_TOOL: ToolId = "pen";

/// Lo strumento con cui si apre un profilo: un PDF si apre per evidenziare.
export function defaultTool(profile: ToolProfile): ToolId {
  return profile === "pdf" ? "highlighter" : DEFAULT_TOOL;
}

/// Una parte che un livello offre o no: uno strumento, tranne la Selezione,
/// o un comando con i suoi tasti.
export type Feature =
  | Exclude<ToolId, "select">
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
  | "attributes"
  | "outline"
  | "transform"
  | "apply"
  | "path"
  | "boolean"
  | "trace"
  | "masks"
  | "typeset"
  | "fonts"
  | "effects"
  | "blend"
  | "motifs"
  | "print"
  | "symbols"
  | "repeat";

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
  { id: "gestures", level: "standard", label: "draw.feature.gestures" },
  { id: "links", level: "standard", label: "draw.feature.links" },
  { id: "images", level: "standard", label: "draw.feature.images" },
  { id: "crop", level: "standard", label: "draw.feature.crop" },
  { id: "library", level: "standard", label: "draw.feature.library" },
  { id: "properties", level: "standard", label: "draw.feature.properties" },
  { id: "style", level: "standard", label: "draw.feature.style" },
  { id: "history", level: "standard", label: "draw.feature.history" },
  { id: "accessibility", level: "standard", label: "draw.feature.accessibility" },
  { id: "export", level: "standard", label: "draw.feature.export" },
  { id: "attributes", level: "expert", label: "draw.feature.attributes" },
  { id: "outline", level: "expert", label: "draw.feature.outline" },
  { id: "transform", level: "expert", label: "draw.feature.transform" },
  { id: "apply", level: "expert", label: "draw.feature.apply" },
  { id: "path", level: "expert", label: "draw.feature.path" },
  { id: "boolean", level: "expert", label: "draw.feature.boolean" },
  { id: "trace", level: "expert", label: "draw.feature.trace" },
  { id: "masks", level: "expert", label: "draw.feature.masks" },
  { id: "typeset", level: "expert", label: "draw.feature.typeset" },
  // I caratteri del vault sono voci del menu «Carattere», nel pannello delle
  // proprietà e negli attributi: nel Personalizzato si vedono con loro. Un
  // disegno che li usa li mostra a ogni livello.
  { id: "fonts", level: "expert", label: "draw.feature.fonts" },
  // Gli effetti e la fusione sono sezioni e campi del pannello delle
  // proprietà: nel Personalizzato si vedono con lui.
  { id: "effects", level: "expert", label: "draw.feature.effects" },
  { id: "blend", level: "expert", label: "draw.feature.blend" },
  // I motivi del documento sono una voce del menu della campitura e due
  // campi, il nome e l'eliminazione, nel pannello delle proprietà: nel
  // Personalizzato si vedono con lui.
  { id: "motifs", level: "expert", label: "draw.feature.motifs" },
  // La pagina di stampa è il gruppo «Pagina» della finestra «Esporta», per
  // il PDF: nel Personalizzato si vede con lei.
  { id: "print", level: "expert", label: "draw.feature.print" },
  // I simboli sono «Crea simbolo» e «Scollega» nella barra della selezione
  // e nel menu, la riga «Simbolo» del pannello delle proprietà e il pannello
  // dei simboli. Un'istanza si apre per modificare il suo simbolo dove si
  // isola un gruppo, a ogni livello che ha la selezione avanzata.
  { id: "symbols", level: "expert", label: "draw.feature.symbols" },
  // Le ripetizioni sono il menu «Ripeti» nella barra della selezione e nel
  // menu, e la sezione «Ripetizione» del pannello delle proprietà. Una
  // ripetizione si apre per modificare i suoi originali dove si isola un
  // gruppo, e si separa come un gruppo, a ogni livello.
  { id: "repeat", level: "expert", label: "draw.feature.repeat" },
];

/// Tutte le parti del disegno, per livello, e in un livello prima gli
/// strumenti nell'ordine della barra: l'ordine in cui il Personalizzato le
/// propone.
export const FEATURES: readonly FeatureSpec[] = LEVEL_ORDER.flatMap((level) => [
  ...TOOLS.filter((tool) => tool.id !== "select" && tool.levels.vector === level).map(
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
      TOOLS.filter((tool) => tool.id !== "select" && tool.levels.pdf !== undefined && reaches(preset, tool.levels.pdf)).map((tool) => tool.id as Feature),
    );
  }
  if (level === "custom") return new Set(custom.filter(isFeature));
  return new Set(FEATURES.filter((feature) => reaches(level, feature.level)).map((feature) => feature.id));
}

/// Gli strumenti delle parti `features`, nell'ordine della barra: la
/// Selezione c'è sempre.
export function toolsOf(features: ReadonlySet<Feature>): readonly ToolSpec[] {
  return TOOLS.filter((tool) => tool.id === "select" || features.has(tool.id));
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

/// Lo strumento di un tasto premuto senza modificatori, fra quelli di
/// `tools`.
export function toolForKey(tools: readonly ToolSpec[], key: string): ToolSpec | null {
  const lower = key.toLowerCase();
  return tools.find((tool) => tool.shortcut === lower) ?? null;
}
