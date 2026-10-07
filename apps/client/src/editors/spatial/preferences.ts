// Il livello e la griglia con cui la superficie apre l'editor del disegno.
//
// - **Il livello** è l'impostazione del vault `draw.level`, che dichiara il
//   bundle `fub.draw`, e le parti del Personalizzato sono `draw.custom`: si
//   leggono dal canale dati e si seguono con `setting_changed`, così un
//   cambio nelle Impostazioni vale subito anche nei disegni aperti. Un
//   livello che l'editor non conosce vale l'Essenziale; senza `draw.custom`
//   il Personalizzato ha le parti dell'Essenziale.
// - **La griglia**, con le guide intelligenti, è uno stato della vista, della
//   macchina e non del vault: l'ultima scelta, con cui si apre ogni disegno
//   dopo. Non entra né nel file del disegno né in quello delle impostazioni
//   del vault, che a ogni `#` cambierebbe, e su un vault condiviso
//   cambierebbe la griglia degli altri.
// - **Le scelte di «Esporta»** sono anche loro uno stato della vista, per
//   disegno: gli ultimi disegni esportati, ognuno con le sue.
//
// L'ultima lettura resta qui: una superficie nuova parte da lì, e la lettura
// che fa la conferma o la corregge, senza che la barra cambi sotto gli occhi
// a ogni disegno che si apre.

import { errorText } from "../../host/errors";
import { api } from "../../host/ipc";
import { settings } from "../../host/query";
import { t } from "../../i18n/strings";
import { onEvent } from "../../state/kernel";
import { notify } from "../../ui/notify";
import { validCurve } from "./pen/pressure";
import { exportMemoryOf, type ExportMemory } from "./tools/export-plan";
import { DEFAULT_GRID, validClosed, validStep, validSteps, type Grid } from "./tools/grid";
import { CUSTOM_DEFAULT, isLevel, type Level } from "./tools/registry";

/// Il bundle che dichiara il livello.
const DRAW_BUNDLE = "fub.draw";

/// L'impostazione del livello.
export const LEVEL_KEY = "draw.level";

/// L'impostazione delle parti del Personalizzato.
export const CUSTOM_KEY = "draw.custom";

/// La chiave dello stato di vista che ricorda la griglia.
export const GRID_KEY = "draw.grid";

/// La chiave dello stato di vista che ricorda le scelte di «Esporta».
export const EXPORT_KEY = "draw.export";

/// Di quanti disegni si ricordano le scelte di «Esporta»: gli ultimi
/// esportati.
export const EXPORT_MEMORIES = 100;

/// Il livello di partenza, quando l'impostazione non dice niente.
const DEFAULT_LEVEL: Level = "essential";

/// Il livello e le parti del Personalizzato, come li dicono le impostazioni.
interface LevelChoice {
  readonly level: Level;
  readonly custom: readonly string[];
}

let lastLevel: Level = DEFAULT_LEVEL;
let lastCustom: readonly string[] = CUSTOM_DEFAULT;
/// Quante letture del livello sono partite, e quale ha dato l'ultimo letto.
let levelReads = 0;
let levelRead = 0;
let lastGrid: Grid = DEFAULT_GRID;
/// Le scritture della griglia in fila, e quante ne sono partite.
let saving: Promise<void> = Promise.resolve();
let saves = 0;
/// Le scritture delle scelte di «Esporta» in fila.
let exporting: Promise<void> = Promise.resolve();

/// Il livello dell'ultima lettura.
export function currentLevel(): Level {
  return lastLevel;
}

/// Le parti del Personalizzato dell'ultima lettura.
export function currentCustom(): readonly string[] {
  return lastCustom;
}

/// `value` come parti del Personalizzato: i nomi di un elenco, senza ciò che
/// non è un nome. Un nome che l'editor non conosce resta: non conta, e una
/// versione più nuova lo conosce.
function customOf(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : CUSTOM_DEFAULT;
}

/// La griglia dell'ultima lettura o dell'ultima scelta.
export function currentGrid(): Grid {
  return lastGrid;
}

/// Legge il livello e le parti del Personalizzato. Se la lettura non
/// riesce, valgono gli ultimi letti.
async function readLevel(): Promise<LevelChoice> {
  const ticket = ++levelReads;
  try {
    const entries = await settings(DRAW_BUNDLE);
    const value = (key: string): unknown => entries.find((entry) => entry.spec.key === key)?.value;
    const level = value(LEVEL_KEY);
    const choice: LevelChoice = { level: isLevel(level) ? level : DEFAULT_LEVEL, custom: customOf(value(CUSTOM_KEY)) };
    // Una lettura partita prima di quella che ha già risposto è più vecchia.
    if (ticket > levelRead) {
      levelRead = ticket;
      lastLevel = choice.level;
      lastCustom = choice.custom;
    }
    return choice;
  } catch {
    // Senza vault, o con le impostazioni guaste.
    return { level: lastLevel, custom: lastCustom };
  }
}

/// Legge il livello e le parti del Personalizzato adesso e a ogni loro
/// cambio, e li dà a `apply`; una lettura superata da una più recente non
/// arriva. Torna la funzione che smette di ascoltare.
export function watchLevel(apply: (level: Level, custom: readonly string[]) => void): () => void {
  let generation = 0;
  let stopped = false;
  const read = (): void => {
    const ticket = ++generation;
    void readLevel().then(({ level, custom }) => {
      if (!stopped && ticket === generation) apply(level, custom);
    });
  };
  const stop = onEvent("setting_changed", (event) => {
    if (event.key === LEVEL_KEY || event.key === CUSTOM_KEY) read();
  });
  read();
  return () => {
    stopped = true;
    stop();
  };
}

/// `value` come griglia, se lo è. Ciò che una griglia ricordata prima non
/// aveva vale come la prima volta: le guide intelligenti accese, i righelli
/// spenti e le loro guide accese, in ogni unità il passo di serie, il
/// pannello delle proprietà come lo vuole la larghezza dell'editor, la barra
/// accanto alla selezione, le dita che girano e toccano, e la pressione della
/// penna com'è. Un passo ricordato che la griglia non accetta non conta.
function gridOf(value: unknown): Grid | null {
  if (typeof value !== "object" || value === null) return null;
  const { shown, snap, step, steps, guides, rulers, rulerGuides, panel, bar, shapes, closed, twist, taps, pen } = value as Record<string, unknown>;
  if (typeof shown !== "boolean" || typeof snap !== "boolean" || typeof step !== "number" || !validStep(step)) return null;
  for (const flag of [guides, rulers, rulerGuides, bar, shapes, twist, taps]) if (flag !== undefined && typeof flag !== "boolean") return null;
  if (panel !== undefined && panel !== null && typeof panel !== "boolean") return null;
  if (steps !== undefined && (typeof steps !== "object" || steps === null)) return null;
  const sections = closed === undefined ? DEFAULT_GRID.closed : validClosed(closed);
  if (sections === null) return null;
  const curve = pen === undefined ? DEFAULT_GRID.pen : validCurve(pen);
  if (curve === null) return null;
  return {
    shown,
    snap,
    step,
    steps: validSteps(steps),
    guides: (guides as boolean | undefined) ?? DEFAULT_GRID.guides,
    rulers: (rulers as boolean | undefined) ?? DEFAULT_GRID.rulers,
    rulerGuides: (rulerGuides as boolean | undefined) ?? DEFAULT_GRID.rulerGuides,
    panel: (panel as boolean | null | undefined) ?? DEFAULT_GRID.panel,
    bar: (bar as boolean | undefined) ?? DEFAULT_GRID.bar,
    shapes: (shapes as boolean | undefined) ?? DEFAULT_GRID.shapes,
    closed: sections,
    twist: (twist as boolean | undefined) ?? DEFAULT_GRID.twist,
    taps: (taps as boolean | undefined) ?? DEFAULT_GRID.taps,
    pen: curve,
  };
}

/// Legge la griglia ricordata: quella di serie se non ce n'è una, o se non
/// si legge come griglia. Legge dopo le scritture in corso, e se la lettura
/// non riesce resta quella di prima.
export async function readGrid(): Promise<Grid> {
  await saving;
  const ticket = saves;
  try {
    const read = gridOf(await api.viewState<unknown>(GRID_KEY)) ?? DEFAULT_GRID;
    // Una scelta fatta mentre si leggeva è più recente di ciò che si è letto.
    if (ticket === saves) lastGrid = read;
  } catch {
    // Lo stato di vista che non si legge lascia l'ultima griglia.
  }
  return lastGrid;
}

/// Ricorda `grid` per i disegni che si aprono dopo. Le scritture vanno in
/// fila, così resta l'ultima; una che non riesce lo dice.
export function saveGrid(grid: Grid): void {
  lastGrid = grid;
  saves += 1;
  saving = saving
    .then(() => api.setViewState(GRID_KEY, grid))
    .catch((error: unknown) => notify(t("vector.grid.save_failed", { reason: errorText(error) }), "guasto"));
}

/// Un disegno ricordato da «Esporta»: il suo `DocId` e le sue scelte.
interface ExportEntry {
  readonly doc: string;
  readonly memory: ExportMemory;
}

/// `value` come disegni ricordati, dal più recente: quelli che non si leggono
/// come scelte non contano, e di un disegno conta il primo.
function exportEntriesOf(value: unknown): ExportEntry[] {
  const drawings = typeof value === "object" && value !== null ? (value as Record<string, unknown>).drawings : undefined;
  if (!Array.isArray(drawings)) return [];
  const entries: ExportEntry[] = [];
  const seen = new Set<string>();
  for (const entry of drawings as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const { doc, memory } = entry as Record<string, unknown>;
    const read = exportMemoryOf(memory);
    if (typeof doc !== "string" || read === null || seen.has(doc)) continue;
    seen.add(doc);
    entries.push({ doc, memory: read });
  }
  return entries;
}

/// Le scelte di «Esporta» ricordate per il disegno `doc`; `null` se non ce ne
/// sono, o se lo stato di vista non si legge. Legge dopo le scritture in
/// corso.
export async function readExportMemory(doc: string): Promise<ExportMemory | null> {
  await exporting;
  try {
    return exportEntriesOf(await api.viewState<unknown>(EXPORT_KEY)).find((entry) => entry.doc === doc)?.memory ?? null;
  } catch {
    return null;
  }
}

/// Ricorda `memory` per il disegno `doc`, davanti agli altri: oltre gli
/// ultimi `EXPORT_MEMORIES` il più vecchio si dimentica. Le scritture vanno in
/// fila; una che non riesce non dice niente, perché l'export è partito e le
/// scelte sono una comodità.
export function saveExportMemory(doc: string, memory: ExportMemory): Promise<void> {
  exporting = exporting
    .then(async () => {
      const others = exportEntriesOf(await api.viewState<unknown>(EXPORT_KEY).catch(() => null)).filter((entry) => entry.doc !== doc);
      await api.setViewState(EXPORT_KEY, { drawings: [{ doc, memory }, ...others].slice(0, EXPORT_MEMORIES) });
    })
    .catch(() => undefined);
  return exporting;
}
