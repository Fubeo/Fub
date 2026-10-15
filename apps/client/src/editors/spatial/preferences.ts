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
// - **I colori recenti** sono uno stato della vista come la griglia: quelli
//   scelti per ultimi, in qualunque disegno, che la sezione «Colori del
//   documento» e il menu radiale offrono in ogni disegno che si apre dopo.
// - **I suggerimenti brevi** si accendono con l'impostazione della macchina
//   `draw.suggestions`, che la loro casella scrive; quelli già visti sono uno
//   stato della vista, così nessuno torna in un altro disegno. Una superficie
//   che ne mostra uno lo dice alle altre aperte.
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
import { RECENT_COLORS } from "./tools/palette";
import { CUSTOM_DEFAULT, isLevel, type Level } from "./tools/registry";
import type { Suggested } from "./tools/suggestions";

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

/// La chiave dello stato di vista che ricorda i colori recenti.
export const COLORS_KEY = "draw.colors";

/// L'impostazione della macchina che accende i suggerimenti brevi.
export const SUGGESTIONS_KEY = "draw.suggestions";

/// La chiave dello stato di vista che ricorda i suggerimenti già visti, o
/// che non servono più.
export const SUGGESTED_KEY = "draw.suggested";

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
let lastColors: readonly string[] = [];
/// Le scritture dei colori recenti in fila, e quante ne sono partite.
let coloring: Promise<void> = Promise.resolve();
let colorSaves = 0;
/// I suggerimenti dell'ultima lettura o dell'ultima scelta: `null` prima
/// della prima lettura riuscita.
let lastSuggested: Suggested | null = null;
/// Le scritture dei suggerimenti visti in fila, e quante ne sono partite.
let suggesting: Promise<void> = Promise.resolve();
let suggestedSaves = 0;
/// Le superfici aperte che seguono i suggerimenti.
const suggestedWatchers = new Set<(suggested: Suggested) => void>();

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

/// `value` come colori recenti, dal più recente: i codici `#rrggbb` del suo
/// elenco, minuscoli e una volta sola, al più [`RECENT_COLORS`]; ciò che
/// non è un codice non conta.
export function recentColorsOf(value: unknown): readonly string[] {
  const colors = typeof value === "object" && value !== null ? (value as Record<string, unknown>).colors : undefined;
  if (!Array.isArray(colors)) return [];
  const out: string[] = [];
  for (const each of colors as unknown[]) {
    const code = typeof each === "string" && /^#[0-9a-fA-F]{6}$/.test(each) ? each.toLowerCase() : null;
    if (code === null || out.includes(code)) continue;
    out.push(code);
    if (out.length === RECENT_COLORS) break;
  }
  return out;
}

/// I colori recenti dell'ultima lettura o dell'ultima scelta.
export function currentRecentColors(): readonly string[] {
  return lastColors;
}

/// Legge i colori recenti ricordati: nessuno se non ce ne sono. Legge dopo
/// le scritture in corso, e se la lettura non riesce restano quelli di
/// prima.
export async function readRecentColors(): Promise<readonly string[]> {
  await coloring;
  const ticket = colorSaves;
  try {
    const read = recentColorsOf(await api.viewState<unknown>(COLORS_KEY));
    // Una scelta fatta mentre si leggeva è più recente di ciò che si è letto.
    if (ticket === colorSaves) lastColors = read;
  } catch {
    // Lo stato di vista che non si legge lascia gli ultimi colori.
  }
  return lastColors;
}

/// Ricorda `colors`, dal più recente, per i disegni che si aprono dopo. Le
/// scritture vanno in fila, così resta l'ultima; una che non riesce non dice
/// niente, perché i recenti sono una comodità.
export function saveRecentColors(colors: readonly string[]): void {
  lastColors = colors;
  colorSaves += 1;
  coloring = coloring.then(() => api.setViewState(COLORS_KEY, { colors })).catch(() => undefined);
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

/// I suggerimenti dell'ultima lettura o dell'ultima scelta: `null` prima
/// della prima lettura riuscita.
export function currentSuggested(): Suggested | null {
  return lastSuggested;
}

/// `value` come suggerimenti visti: i nomi del suo elenco, una volta sola;
/// ciò che non è un nome non conta. Un nome che l'editor non conosce resta,
/// per una versione più nuova.
export function suggestedOf(value: unknown): readonly string[] {
  const seen = typeof value === "object" && value !== null ? (value as Record<string, unknown>).seen : undefined;
  if (!Array.isArray(seen)) return [];
  return [...new Set((seen as unknown[]).filter((item): item is string => typeof item === "string"))];
}

/// Legge l'impostazione e i suggerimenti visti, dopo le scritture in corso.
/// Un'impostazione che non si legge vale come l'ultima, o accesa; uno stato
/// di vista che non si legge lascia gli ultimi visti, e prima della prima
/// lettura riuscita dà `null`: senza memoria un suggerimento tornerebbe in
/// ogni disegno.
async function readSuggested(): Promise<Suggested | null> {
  await suggesting;
  const ticket = suggestedSaves;
  let on = lastSuggested?.on ?? true;
  try {
    const value = (await settings(DRAW_BUNDLE)).find((entry) => entry.spec.key === SUGGESTIONS_KEY)?.value;
    if (typeof value === "boolean") on = value;
  } catch {
    // Senza le impostazioni, vale l'ultima lettura.
  }
  let seen: readonly string[] | null = lastSuggested?.seen ?? null;
  try {
    const read = suggestedOf(await api.viewState<unknown>(SUGGESTED_KEY));
    // Uno visto mentre si leggeva è più recente di ciò che si è letto.
    seen = ticket === suggestedSaves ? read : (lastSuggested?.seen ?? read);
  } catch {
    // Lo stato di vista che non si legge lascia gli ultimi visti.
  }
  if (seen === null) return null;
  lastSuggested = { on, seen };
  return lastSuggested;
}

/// Legge i suggerimenti adesso e a ogni cambio dell'impostazione, e li dà a
/// `apply`, come ciò che un'altra superficie aperta ha visto; una lettura
/// superata da una più recente non arriva. Torna la funzione che smette.
export function watchSuggested(apply: (suggested: Suggested | null) => void): () => void {
  let generation = 0;
  let stopped = false;
  const read = (): void => {
    const ticket = ++generation;
    void readSuggested().then((suggested) => {
      if (!stopped && ticket === generation) apply(suggested);
    });
  };
  suggestedWatchers.add(apply);
  const stop = onEvent("setting_changed", (event) => {
    if (event.key === SUGGESTIONS_KEY) read();
  });
  read();
  return () => {
    stopped = true;
    suggestedWatchers.delete(apply);
    stop();
  };
}

/// Ricorda i suggerimenti visti `seen` per i disegni che si aprono dopo, e
/// lo dice alle superfici aperte. Le scritture vanno in fila; una che non
/// riesce non dice niente: un suggerimento tornerà una volta di più.
export function saveSuggested(seen: readonly string[]): void {
  const suggested: Suggested = { on: lastSuggested?.on ?? true, seen };
  lastSuggested = suggested;
  suggestedSaves += 1;
  suggesting = suggesting.then(() => api.setViewState(SUGGESTED_KEY, { seen })).catch(() => undefined);
  for (const watcher of [...suggestedWatchers]) watcher(suggested);
}

/// Accende o spegne i suggerimenti, dalla loro casella: scrive
/// l'impostazione, e le superfici aperte la rileggono col suo cambio. Una
/// scrittura che non riesce lo dice, e la casella torna com'era.
export function switchSuggestions(on: boolean): void {
  if (lastSuggested !== null) lastSuggested = { ...lastSuggested, on };
  void Promise.resolve()
    .then(() => api.setSetting(SUGGESTIONS_KEY, on))
    .catch((error: unknown) => {
      notify(t("vector.suggestions.save_failed", { reason: errorText(error) }), "guasto");
      if (lastSuggested === null) return;
      const back: Suggested = { ...lastSuggested, on: !on };
      lastSuggested = back;
      for (const watcher of [...suggestedWatchers]) watcher(back);
    });
}
