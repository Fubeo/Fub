// La configurazione del grafo: carica, salva e applica.
//
// La distinzione delle responsabilità è quella del §9 di `../../../docs/product/search-links-and-graph.md`: la
// **forma** dei valori sta in `sim/types.ts` (ghiacciata durante lo sviluppo
// in parallelo), qui c'è la vita di una conf — da dove viene, dove va a
// finire, e come nasce un preset. `chart.ts` la consuma, `panels/graph.ts`
// la fa scorrere, `physics-panel.ts` la edita.
//
// Il supporto di salvataggio è `localStorage`, non le impostazioni di vault
// (0076): la conf del grafo è una preferenza di **questa macchina**, come la
// lingua e il tema — lo stesso vault aperto su due macchine può avere due
// sguardi diversi senza che la configurazione viaggi nel kernel.

import type { PhysicsConfig, GraphConfig } from "./sim/types";
import { PRESETS, clampPhysicsConfig, clampGraphicsConfig, defaultGraphicsConfig, organicConfig } from "./sim/types";

/// La chiave in `localStorage`. Versionata: un formato diverso (campi nuovi,
/// scale cambiate) deve ripartire dai default invece di clampare alla cieca
/// valori che non significano più quello che dicevano.
export const CONFIG_KEY = "fub.graph.conf.v1";

/// La conf di ripartenza: il preset «organica» — il punto di partenza
/// provato — e le impostazioni grafiche predefinite. È anche ciò che il
/// pannello ripristina con «Reimposta».
export function defaultConfig(): GraphConfig {
  return { physics: organicConfig(), graphics: defaultGraphicsConfig(), preset: "organica" };
}

/// Legge la conf dal `localStorage`. Non si fida di nulla: un `localStorage`
/// può essere assente (webview senza persistenza, test), pieno di spazzatura,
/// o scritto da una versione diversa di questo codice — ogni campo passa da
/// `clampPhysicsConfig`/`clampGraphicsConfig`, che riporta ai default ciò che non è un numero finito o un
/// booleano, e il preset ignoto ripiega su `organica` (la personalità fisica
/// predefinita) senza inventare una voce nuova nell'elenco.
export function loadConfig(storage: Storage | undefined = localStorage): GraphConfig {
  if (!storage) return defaultConfig();
  let raw: unknown = null;
  try {
    raw = storage.getItem(CONFIG_KEY);
  } catch {
    // `localStorage` che lancia (modalità privata, quota): si parte dai
    // default e si continua a funzionare — il salvataggio riproverà al
    // prossimo cambiamento, e se fallisce si vivrà senza memoria.
    return defaultConfig();
  }
  if (typeof raw !== "string" || raw.length === 0) return defaultConfig();
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return defaultConfig();
  }
  if (!o || typeof o !== "object") return defaultConfig();
  const c = o as Partial<GraphConfig>;
  // «custom» è un preset legittimo ma non sta in `PRESETS` (non ha una
  // funzione che lo produce): si accetta esplicitamente, e in quel caso
  // la fisica si rilegge dai numeri salvati. Per ogni altro preset noto, la
  // fisica viene ricostruita dalla funzione del preset — i numeri salvati
  // sono ignorati, perché il preset vince (se no cambiare preset non
  // cambierebbe la fisica).
  const rawPreset = typeof c.preset === "string" ? c.preset : "organica";
  const preset = rawPreset === "custom" || rawPreset in PRESETS ? rawPreset : "organica";
  const physics = preset === "custom" ? clampPhysicsConfig(c.physics ?? {}) : PRESETS[preset]();
  // `clampGraphicsConfig` accetta parziali e completa coi default: la grafica
  // è indipendente dal preset (si può volere la costellazione senza il
  // pulse), quindi si rilegge sempre dai numeri salvati.
  return {
    physics,
    graphics: clampGraphicsConfig(c.graphics ?? {}),
    preset,
  };
}

/// Salva la conf, dopo averla riportata alla forma valida. Un dato che esce
/// dal pannello passa già dai clamp, ma `saveConfig` è anche il confine verso
/// l'esterno: chi la chiama con una conf di mano propria non deve poter
/// scrivere spazzatura nel supporto.
export function saveConfig(config: GraphConfig, storage: Storage | undefined = localStorage): void {
  if (!storage) return;
  const toSave: GraphConfig = {
    physics: clampPhysicsConfig(config.physics),
    graphics: clampGraphicsConfig(config.graphics),
    preset: config.preset in PRESETS || config.preset === "custom" ? config.preset : "organica",
  };
  try {
    storage.setItem(CONFIG_KEY, JSON.stringify(toSave));
  } catch {
    // La quota è piena o il supporto è vietato: il grafo vive anche senza
    // memoria, e lanciare qui interromperebbe un gesto che è riuscito.
  }
}

/// Applica un preset: la fisica nuova è la personalità del preset, la
/// grafica non si tocca (è un'altra dimensione — si può volere la
/// costellazione senza rinunciare al pulse). Il preset «organica» è la
/// funzione già pronta di `types.ts`; gli altri sono nel `Record` che il
/// lotto A ha dichiarato e che il pannello elenca.
export function applyPreset(name: string): PhysicsConfig {
  const fn = PRESETS[name];
  // Un nome fuori dall'elenco (preset di terzi rimosso, refuso della
  // select) ripiega su «organica» invece di lanciare: la fisica
  // predefinita è meglio di un pannello rotto.
  return fn ? fn() : organicConfig();
}
