// Le preferenze della lavagna su questo computer.
//
// - **Le due impostazioni** della macchina che il bundle `fub.lavagna`
//   dichiara (`crates/fub-features/src/lavagna.rs`), spente di serie:
//   `canvas.ink_mouse_remember` («Ricorda se scrivi col mouse») e
//   `canvas.finger_moves_card` («Il dito sposta le schede»). Si leggono dal
//   canale dati e si seguono con `setting_changed`, così un cambio nelle
//   Impostazioni, anche da un'altra finestra, vale subito nelle lavagne
//   aperte. Un valore che non è un interruttore vale spento.
// - **L'ultimo stato di «Scrivi col mouse»** è uno stato della vista,
//   `canvas.ink_mouse`, uno per computer: si scrive a ogni cambio, e una
//   lavagna che si apre lo riprende solo se «Ricorda se scrivi col mouse» è
//   acceso; altrimenti parte spento. Uno stato che manca o non si legge vale
//   spento.
//
// L'ultima lettura resta qui: una lavagna nuova parte da lì, e la lettura che
// fa la conferma o la corregge.

import { api } from "../../host/ipc";
import { settings } from "../../host/query";
import { onEvent } from "../../state/kernel";
import type { SettingEntry } from "../../host/contract";

/// Il bundle che dichiara le impostazioni della lavagna.
export const LAVAGNA_BUNDLE = "fub.lavagna";

/// L'impostazione «Ricorda se scrivi col mouse».
export const INK_MOUSE_REMEMBER_KEY = "canvas.ink_mouse_remember";

/// L'impostazione «Il dito sposta le schede».
export const FINGER_MOVES_CARD_KEY = "canvas.finger_moves_card";

/// La chiave dello stato di vista che ricorda «Scrivi col mouse».
export const INK_MOUSE_KEY = "canvas.ink_mouse";

/// Le impostazioni della lavagna, come le dice la macchina.
export interface CanvasPreferences {
  /// Una lavagna che si apre riprende l'ultimo «Scrivi col mouse».
  readonly inkMouseRemember: boolean;
  /// Il dito sposta la scheda che tocca, e la lavagna solo sul vuoto.
  readonly fingerMovesCard: boolean;
}

/// Le impostazioni di serie: tutte e due spente.
export const DEFAULT_PREFERENCES: CanvasPreferences = Object.freeze({ inkMouseRemember: false, fingerMovesCard: false });

let lastPreferences: CanvasPreferences = DEFAULT_PREFERENCES;
let preferenceReads = 0;
let preferenceRead = 0;

/// L'ultimo «Scrivi col mouse» scelto o letto: `null` prima del primo.
let lastInkMouse: boolean | null = null;
/// Le scritture di «Scrivi col mouse» in fila, e quante ne sono partite.
let inkSaving: Promise<void> = Promise.resolve();
let inkSaves = 0;

/// Le impostazioni dalle righe `entries` del bundle. Una chiave che manca, o
/// un valore che non è un interruttore, vale spento.
export function preferencesOf(entries: readonly SettingEntry[]): CanvasPreferences {
  const on = (key: string): boolean => entries.find((entry) => entry.spec.key === key)?.value === true;
  return { inkMouseRemember: on(INK_MOUSE_REMEMBER_KEY), fingerMovesCard: on(FINGER_MOVES_CARD_KEY) };
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

/// Legge le impostazioni adesso e a ogni cambio delle due chiavi, e le dà a
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
    if (event.key === INK_MOUSE_REMEMBER_KEY || event.key === FINGER_MOVES_CARD_KEY) read();
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
