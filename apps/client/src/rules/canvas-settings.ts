// Le impostazioni della lavagna come le legge il client, senza la lavagna: il
// nome del bundle `fub.lavagna`, le chiavi delle dodici impostazioni del gruppo
// «Lavagna» (`crates/fub-features/src/lavagna.rs`), le loro scelte, i valori di
// serie e la lettura pura delle righe (`preferencesOf`): un valore che non regge
// la sua specie vale il suo di serie.
//
// Sta qui, fuori da `editors/canvas/`, per il caricamento. Lo stato di documento
// e l'importazione dei file trascinati le leggono già all'avvio, e non devono
// portarsi dietro la lavagna, l'inchiostro e il disegno, che arrivano soltanto
// quando servono. `editors/canvas/preferences.ts` riesporta tutto e aggiunge ciò
// che legge, segue e ricorda. `canvas-settings.test.ts` tiene il taglio: questo
// file non importa niente dell'editor né dell'inchiostro.
import type { SettingEntry } from "../host/contract";
import { nameFault, normalizedName } from "./mirrored";

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
