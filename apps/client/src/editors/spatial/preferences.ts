// Il livello e la griglia con cui la superficie apre l'editor del disegno.
//
// - **Il livello** è l'impostazione del vault `draw.level`, che dichiara il
//   bundle `fub.draw`: si legge dal canale dati e si segue con
//   `setting_changed`, così un cambio nelle Impostazioni vale subito anche
//   nei disegni aperti. Un valore che l'editor non conosce vale l'Essenziale.
// - **La griglia** è uno stato della vista, della macchina e non del vault:
//   l'ultima scelta, con cui si apre ogni disegno dopo. Non entra né nel file
//   del disegno né in quello delle impostazioni del vault, che a ogni `#`
//   cambierebbe, e su un vault condiviso cambierebbe la griglia degli altri.
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
import { DEFAULT_GRID, validStep, type Grid } from "./tools/grid";
import { isLevel, type Level } from "./tools/registry";

/// Il bundle che dichiara il livello.
const DRAW_BUNDLE = "fub.draw";

/// L'impostazione del livello.
export const LEVEL_KEY = "draw.level";

/// La chiave dello stato di vista che ricorda la griglia.
export const GRID_KEY = "draw.grid";

/// Il livello di partenza, quando l'impostazione non dice niente.
const DEFAULT_LEVEL: Level = "essential";

let lastLevel: Level = DEFAULT_LEVEL;
/// Quante letture del livello sono partite, e quale ha dato l'ultimo letto.
let levelReads = 0;
let levelRead = 0;
let lastGrid: Grid = DEFAULT_GRID;
/// Le scritture della griglia in fila, e quante ne sono partite.
let saving: Promise<void> = Promise.resolve();
let saves = 0;

/// Il livello dell'ultima lettura.
export function currentLevel(): Level {
  return lastLevel;
}

/// La griglia dell'ultima lettura o dell'ultima scelta.
export function currentGrid(): Grid {
  return lastGrid;
}

/// Legge il livello. Se la lettura non riesce, vale l'ultimo letto.
async function readLevel(): Promise<Level> {
  const ticket = ++levelReads;
  try {
    const value = (await settings(DRAW_BUNDLE)).find((entry) => entry.spec.key === LEVEL_KEY)?.value;
    const level = isLevel(value) ? value : DEFAULT_LEVEL;
    // Una lettura partita prima di quella che ha già risposto è più vecchia.
    if (ticket > levelRead) {
      levelRead = ticket;
      lastLevel = level;
    }
    return level;
  } catch {
    // Senza vault, o con le impostazioni guaste.
    return lastLevel;
  }
}

/// Legge il livello adesso e a ogni suo cambio, e lo dà a `apply`; una
/// lettura superata da una più recente non arriva. Torna la funzione che
/// smette di ascoltare.
export function watchLevel(apply: (level: Level) => void): () => void {
  let generation = 0;
  let stopped = false;
  const read = (): void => {
    const ticket = ++generation;
    void readLevel().then((level) => {
      if (!stopped && ticket === generation) apply(level);
    });
  };
  const stop = onEvent("setting_changed", (event) => {
    if (event.key === LEVEL_KEY) read();
  });
  read();
  return () => {
    stopped = true;
    stop();
  };
}

/// `value` come griglia, se lo è.
function gridOf(value: unknown): Grid | null {
  if (typeof value !== "object" || value === null) return null;
  const { shown, snap, step } = value as Record<string, unknown>;
  if (typeof shown !== "boolean" || typeof snap !== "boolean" || typeof step !== "number" || !validStep(step)) return null;
  return { shown, snap, step };
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
