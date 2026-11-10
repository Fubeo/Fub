// Le preferenze della lavagna su questo computer.
//
// - **Le dodici impostazioni** del gruppo «Lavagna» che il bundle `fub.lavagna`
//   dichiara (`crates/fub-features/src/lavagna.rs`), ciascuna col suo valore di
//   serie. Si leggono dal canale dati e si seguono con `setting_changed`, così
//   un cambio nelle Impostazioni, anche da un'altra finestra, vale subito nelle
//   lavagne aperte. Un valore che non regge la sua specie vale il suo di serie,
//   e la lettura non scrive niente. La cartella dei file trascinati si giudica
//   con le regole dei nomi nuovi (`dropFolderPathOf`).
// - **L'ultimo stato di «Scrivi col mouse»** è uno stato della vista,
//   `canvas.ink_mouse`, uno per computer: si scrive a ogni cambio, e una
//   lavagna che si apre lo riprende solo se «Ricorda se scrivi col mouse» è
//   acceso; altrimenti parte spento. Uno stato che manca o non si legge vale
//   spento.
// - **La penna scelta** nel menu della penna (A19) è lo stato della vista
//   `canvas.pen`, uno per computer: strumento, penna, colore e spessore della
//   Penna e dell'evidenziatore, che cosa cancella la gomma. Si scrive a ogni
//   scelta e una lavagna che si apre la riprende. Uno stato che manca, rotto o
//   di una versione futura vale la scelta di serie; un campo che non si legge
//   vale il suo di serie, uno spessore fuori dall'intervallo va al bordo.
//
// L'ultima lettura resta qui: una lavagna nuova parte da lì, e la lettura che
// fa la conferma o la corregge.

import { api } from "../../host/ipc";
import { settings } from "../../host/query";
import { isPenId } from "../../ink/pens";
import { nameFault, normalizedName } from "../../rules/mirrored";
import { onEvent } from "../../state/kernel";
import type { SettingEntry } from "../../host/contract";
import { DEFAULT_INK_CHOICE, inkWidthOf, type InkPenChoice, type InkPenKind } from "./ink-record";

/// Il bundle che dichiara le impostazioni della lavagna.
export const LAVAGNA_BUNDLE = "fub.lavagna";

/// L'impostazione «Ricorda se scrivi col mouse».
export const INK_MOUSE_REMEMBER_KEY = "canvas.ink_mouse_remember";

/// L'impostazione «Il dito sposta le schede».
export const FINGER_MOVES_CARD_KEY = "canvas.finger_moves_card";

/// L'impostazione «Il dito scrive».
export const FINGER_WRITES_KEY = "canvas.finger_writes";

/// L'impostazione «Il tasto della penna».
export const PEN_BUTTON_KEY = "canvas.pen_button";

/// L'impostazione «La rotella del mouse».
export const WHEEL_KEY = "canvas.wheel";

/// L'impostazione «Spazio di lavoro».
export const WORKSPACE_KEY = "canvas.workspace";

/// L'impostazione «Strumenti della colonna».
export const TOOLBAR_KEY = "canvas.toolbar";

/// L'impostazione «Griglia».
export const GRID_KEY = "canvas.grid";

/// L'impostazione «Aggancia le schede».
export const SNAP_KEY = "canvas.snap";

/// L'impostazione «Scegli le parti di una nota».
export const PARTS_PICKER_KEY = "canvas.parts_picker";

/// L'impostazione «Dove vanno i file trascinati».
export const DROP_FOLDER_KEY = "canvas.drop_folder";

/// L'impostazione «Cartella dei file trascinati».
export const DROP_FOLDER_PATH_KEY = "canvas.drop_folder_path";

/// Le chiavi che la lavagna segue: un cambio di una di queste rilegge.
const FOLLOWED_KEYS: ReadonlySet<string> = new Set([
  INK_MOUSE_REMEMBER_KEY,
  FINGER_MOVES_CARD_KEY,
  FINGER_WRITES_KEY,
  PEN_BUTTON_KEY,
  WHEEL_KEY,
  WORKSPACE_KEY,
  TOOLBAR_KEY,
  GRID_KEY,
  SNAP_KEY,
  PARTS_PICKER_KEY,
  DROP_FOLDER_KEY,
  DROP_FOLDER_PATH_KEY,
]);

/// Le scelte, come le scrive la macchina nel Rust; la prima è quella di serie.
export const PEN_BUTTON_VALUES = ["radial", "eraser", "pan"] as const;
export const WHEEL_VALUES = ["pan", "zoom"] as const;
export const WORKSPACE_VALUES = ["auto", "full", "simple"] as const;
export const DROP_FOLDER_VALUES = ["notes", "board", "folder"] as const;

/// Il valore di serie di «Cartella dei file trascinati».
export const DROP_FOLDER_PATH_DEFAULT = "Allegati";

/// Le scelte come le usa il client.
export type PenButtonAction = (typeof PEN_BUTTON_VALUES)[number];
export type WheelAction = (typeof WHEEL_VALUES)[number];
export type WorkspaceMode = (typeof WORKSPACE_VALUES)[number];
export type DropFolderTarget = (typeof DROP_FOLDER_VALUES)[number];

/// La chiave dello stato di vista che ricorda «Scrivi col mouse».
export const INK_MOUSE_KEY = "canvas.ink_mouse";

/// Le impostazioni della lavagna, come le dice la macchina.
export interface CanvasPreferences {
  /// Una lavagna che si apre riprende l'ultimo «Scrivi col mouse».
  readonly inkMouseRemember: boolean;
  /// Il dito sposta la scheda che tocca, e la lavagna solo sul vuoto.
  readonly fingerMovesCard: boolean;
  /// Su uno schermo touch il dito scrive con la penna scelta.
  readonly fingerWrites: boolean;
  /// Che cosa fa il tasto sul fianco della penna.
  readonly penButton: PenButtonAction;
  /// Che cosa fa la rotella fuori da una scheda attiva.
  readonly wheel: WheelAction;
  /// Quanti strumenti e pannelli mostra la lavagna.
  readonly workspace: WorkspaceMode;
  /// Gli strumenti della colonna, nell'ordine; una lista vuota vale quella di serie.
  readonly toolbar: readonly string[];
  /// Mostra i punti della griglia.
  readonly grid: boolean;
  /// I bordi di una scheda che si sposta si agganciano alle schede vicine e alla griglia.
  readonly snap: boolean;
  /// Una nota con titoli, portata sulla lavagna, apre l'elenco delle sue parti.
  readonly partsPicker: boolean;
  /// Dove si copiano i file portati sulla lavagna.
  readonly dropFolder: DropFolderTarget;
  /// La cartella per `folder`, già giudicata da `dropFolderPathOf`.
  readonly dropFolderPath: string;
}

/// Le impostazioni di serie, come le scrive la macchina.
export const DEFAULT_PREFERENCES: CanvasPreferences = Object.freeze<CanvasPreferences>({
  inkMouseRemember: false,
  fingerMovesCard: false,
  fingerWrites: false,
  penButton: "radial",
  wheel: "pan",
  workspace: "auto",
  toolbar: Object.freeze<string[]>([]),
  grid: true,
  snap: true,
  partsPicker: true,
  dropFolder: "notes",
  dropFolderPath: DROP_FOLDER_PATH_DEFAULT,
});

let lastPreferences: CanvasPreferences = DEFAULT_PREFERENCES;
let preferenceReads = 0;
let preferenceRead = 0;

/// L'ultimo «Scrivi col mouse» scelto o letto: `null` prima del primo.
let lastInkMouse: boolean | null = null;
/// Le scritture di «Scrivi col mouse» in fila, e quante ne sono partite.
let inkSaving: Promise<void> = Promise.resolve();
let inkSaves = 0;

/// Le impostazioni dalle righe `entries` del bundle. Una chiave che manca, o un
/// valore che non regge la sua specie, vale il suo di serie: spento per le
/// prime, acceso per `grid`, `snap` e `partsPicker`. La lista della barra si
/// copia, e tiene solo i testi.
export function preferencesOf(entries: readonly SettingEntry[]): CanvasPreferences {
  const valueOf = (key: string): unknown => entries.find((entry) => entry.spec.key === key)?.value;
  const flag = (key: string, fallback: boolean): boolean => {
    const value = valueOf(key);
    return typeof value === "boolean" ? value : fallback;
  };
  const choice = <T extends string>(key: string, values: readonly T[], fallback: T): T => {
    const value = valueOf(key);
    return typeof value === "string" && (values as readonly string[]).includes(value) ? (value as T) : fallback;
  };
  const toolbar = valueOf(TOOLBAR_KEY);
  return {
    inkMouseRemember: flag(INK_MOUSE_REMEMBER_KEY, DEFAULT_PREFERENCES.inkMouseRemember),
    fingerMovesCard: flag(FINGER_MOVES_CARD_KEY, DEFAULT_PREFERENCES.fingerMovesCard),
    fingerWrites: flag(FINGER_WRITES_KEY, DEFAULT_PREFERENCES.fingerWrites),
    penButton: choice(PEN_BUTTON_KEY, PEN_BUTTON_VALUES, DEFAULT_PREFERENCES.penButton),
    wheel: choice(WHEEL_KEY, WHEEL_VALUES, DEFAULT_PREFERENCES.wheel),
    workspace: choice(WORKSPACE_KEY, WORKSPACE_VALUES, DEFAULT_PREFERENCES.workspace),
    toolbar: Array.isArray(toolbar) ? toolbar.filter((tool): tool is string => typeof tool === "string") : [],
    grid: flag(GRID_KEY, DEFAULT_PREFERENCES.grid),
    snap: flag(SNAP_KEY, DEFAULT_PREFERENCES.snap),
    partsPicker: flag(PARTS_PICKER_KEY, DEFAULT_PREFERENCES.partsPicker),
    dropFolder: choice(DROP_FOLDER_KEY, DROP_FOLDER_VALUES, DEFAULT_PREFERENCES.dropFolder),
    dropFolderPath: dropFolderPathOf(valueOf(DROP_FOLDER_PATH_KEY)),
  };
}

/// La cartella dei file trascinati come si usa, da ciò che è scritto nelle
/// Impostazioni. Vale `Allegati` se non è testo, se è vuota, se è assoluta (con
/// una barra o una barra rovesciata in testa, o una lettera di drive), o se
/// `nameFault` la respinge come un nome nuovo: un `..`, dentro `.fub` o
/// `.trash`, nascosta, con un carattere che un filesystem si riserva, troppo
/// lunga. Il testo si scrive nella forma di un nome nuovo (`normalizedName`:
/// spazi ai bordi, NFC) e una barra in coda, che indica una cartella, si toglie.
/// Il Rust tiene il testo com'è scritto e non lo giudica.
export function dropFolderPathOf(value: unknown): string {
  if (typeof value !== "string") return DROP_FOLDER_PATH_DEFAULT;
  const typed = value.trim();
  // Assoluta: si guarda prima di togliere le barre, altrimenti `/Foto` diventerebbe
  // `Foto`, un percorso del vault che l'utente non ha scritto.
  if (/^([\\/]|[A-Za-z]:)/.test(typed)) return DROP_FOLDER_PATH_DEFAULT;
  const path = normalizedName(typed).replace(/\/+$/, "");
  return path !== "" && nameFault(path, "new") === null ? path : DROP_FOLDER_PATH_DEFAULT;
}

/// Le impostazioni dell'ultima lettura: quelle di serie prima della prima.
export function currentPreferences(): CanvasPreferences {
  return lastPreferences;
}

/// Legge le impostazioni adesso. Una lettura superata da una più recente non
/// cambia l'ultima; una che non riesce lascia le ultime lette.
async function readPreferences(): Promise<CanvasPreferences> {
  const reading = ++preferenceReads;
  try {
    const read = preferencesOf(await settings(LAVAGNA_BUNDLE));
    if (reading > preferenceRead) {
      preferenceRead = reading;
      lastPreferences = read;
    }
    return read;
  } catch {
    return lastPreferences;
  }
}

/// Legge le impostazioni adesso e a ogni cambio delle dodici chiavi, e le dà a
/// `apply`; una lettura superata da una più recente non arriva. Torna la
/// funzione che smette: chi chiama ne è il proprietario.
export function watchPreferences(apply: (preferences: CanvasPreferences) => void): () => void {
  let generation = 0;
  let stopped = false;
  const read = (): void => {
    const ticket = ++generation;
    void readPreferences().then((preferences) => {
      if (!stopped && ticket === generation) apply(preferences);
    });
  };
  const stop = onEvent("setting_changed", (event) => {
    if (FOLLOWED_KEYS.has(event.key)) read();
  });
  read();
  return () => {
    stopped = true;
    stop();
  };
}

/// `value` come stato ricordato di «Scrivi col mouse»: acceso solo se è
/// `{ on: true }`; ogni altra cosa vale spento.
export function inkMouseOf(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as Record<string, unknown>).on === true;
}

/// Lo stato con cui una lavagna che si apre comincia «Scrivi col mouse»:
/// spento se «Ricorda se scrivi col mouse» è spento, altrimenti l'ultimo
/// ricordato. Legge dopo le scritture in corso; uno stato che non si legge
/// lascia l'ultimo, o spento.
export async function readInkMouse(): Promise<boolean> {
  const { inkMouseRemember } = await readPreferences();
  await inkSaving;
  const ticket = inkSaves;
  try {
    const read = inkMouseOf(await api.viewState<unknown>(INK_MOUSE_KEY));
    // Una scelta fatta mentre si leggeva è più recente di ciò che si è letto.
    if (ticket === inkSaves) lastInkMouse = read;
  } catch {
    // Lo stato di vista che non si legge lascia l'ultimo.
  }
  return inkMouseRemember && (lastInkMouse ?? false);
}

/// Ricorda `on`, l'interruttore «Scrivi col mouse» appena cambiato, per le
/// lavagne che si aprono dopo: si scrive sempre, così quando «Ricorda» si
/// accende vale l'ultima scelta. Le scritture vanno in fila, così resta
/// l'ultima; una che non riesce non dice niente, perché è una comodità e il
/// tasto D funziona sempre.
export function saveInkMouse(on: boolean): void {
  lastInkMouse = on;
  inkSaves += 1;
  inkSaving = inkSaving.then(() => api.setViewState(INK_MOUSE_KEY, { on })).catch(() => undefined);
}

/// La chiave dello stato di vista che ricorda la penna scelta.
export const PEN_KEY = "canvas.pen";

/// La versione della forma di `canvas.pen` che questo client scrive e legge.
export const PEN_STATE_VERSION = 1;

/// Lo stato di vista `canvas.pen` come si scrive.
export interface PenState {
  readonly version: typeof PEN_STATE_VERSION;
  readonly tool: InkPenChoice["tool"];
  readonly pen: InkPenKind;
  readonly penColor: string;
  readonly penWidth: number;
  readonly highlighterColor: string;
  readonly highlighterWidth: number;
  readonly eraser: InkPenChoice["eraser"];
}

/// L'ultima penna scelta o letta: `null` prima della prima.
let lastPen: InkPenChoice | null = null;
let penSaving: Promise<void> = Promise.resolve();
let penSaves = 0;

const HEX6 = /^#[0-9a-f]{6}$/i;

/// Lo stato di vista della scelta `choice`.
export function penStateOf(choice: InkPenChoice): PenState {
  return {
    version: PEN_STATE_VERSION,
    tool: choice.tool,
    pen: choice.pen,
    penColor: choice.color.pen,
    penWidth: choice.width.pen,
    highlighterColor: choice.color.highlighter,
    highlighterWidth: choice.width.highlighter,
    eraser: choice.eraser,
  };
}

/// `value` come penna scelta. Uno stato che non è un oggetto o non è della
/// versione di questo client vale la scelta di serie, senza errore; un campo
/// che non si legge vale il suo di serie; uno spessore fuori dall'intervallo
/// va al bordo e al passo del cursore (A19).
export function penChoiceOf(value: unknown): InkPenChoice {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return DEFAULT_INK_CHOICE;
  const state = value as Record<string, unknown>;
  if (state.version !== PEN_STATE_VERSION) return DEFAULT_INK_CHOICE;
  const base = DEFAULT_INK_CHOICE;
  const tool = state.tool === "pen" || state.tool === "highlighter" || state.tool === "eraser" ? state.tool : base.tool;
  const pen = typeof state.pen === "string" && isPenId(state.pen) && state.pen !== "highlighter" ? state.pen : base.pen;
  const color = (field: unknown, fallback: string): string => (typeof field === "string" && HEX6.test(field) ? field.toLowerCase() : fallback);
  const eraser = state.eraser === "stroke" || state.eraser === "piece" ? state.eraser : base.eraser;
  return {
    tool,
    pen,
    color: { pen: color(state.penColor, base.color.pen), highlighter: color(state.highlighterColor, base.color.highlighter) },
    width: {
      pen: inkWidthOf("pen", state.penWidth) ?? base.width.pen,
      highlighter: inkWidthOf("highlighter", state.highlighterWidth) ?? base.width.highlighter,
    },
    eraser,
  };
}

/// La penna con cui una lavagna che si apre comincia: l'ultima ricordata su
/// questo computer, o quella di serie. Legge dopo le scritture in corso; uno
/// stato che non si legge lascia l'ultimo.
export async function readPen(): Promise<InkPenChoice> {
  await penSaving;
  const ticket = penSaves;
  try {
    const read = penChoiceOf(await api.viewState<unknown>(PEN_KEY));
    // Una scelta fatta mentre si leggeva è più recente di ciò che si è letto.
    if (ticket === penSaves) lastPen = read;
  } catch {
    // Lo stato di vista che non si legge lascia l'ultimo.
  }
  return lastPen ?? DEFAULT_INK_CHOICE;
}

/// Ricorda la penna `choice`, appena scelta, per le lavagne che si aprono
/// dopo. Le scritture vanno in fila, così resta l'ultima; una che non riesce
/// non dice niente: la lavagna aperta tiene la sua scelta.
export function savePen(choice: InkPenChoice): void {
  lastPen = choice;
  penSaves += 1;
  const state = penStateOf(choice);
  penSaving = penSaving.then(() => api.setViewState(PEN_KEY, state)).catch(() => undefined);
}
