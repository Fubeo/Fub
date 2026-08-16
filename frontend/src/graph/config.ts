// La configurazione del grafo: carica, salva e applica.
//
// La distinzione delle responsabilità è quella del §9 di `graph.md`: la
// **forma** dei valori sta in `sim/tipi.ts` (ghiacciata durante lo sviluppo
// in parallelo), qui c'è la vita di una conf — da dove viene, dove va a
// finire, e come nasce un preset. `grafico.ts` la consuma, `panels/graph.ts`
// la fa scorrere, `pannello-fisica.ts` la edita.
//
// Il supporto di salvataggio è `localStorage`, non le impostazioni di vault
// (0076): la conf del grafo è una preferenza di **questa macchina**, come la
// lingua e il tema — lo stesso vault aperto su due macchine può avere due
// sguardi diversi senza che la configurazione viaggi nel kernel.

import type { ConfFisica, ConfGrafo } from "./sim/tipi";
import { PRESETTI, clampConfFisica, clampConfGrafica, confGraficaPredefinita, confOrganica } from "./sim/tipi";

/// La chiave in `localStorage`. Versionata: un formato diverso (campi nuovi,
/// scale cambiate) deve ripartire dai default invece di clampare alla cieca
/// valori che non significano più quello che dicevano.
export const CHIAVE_CONF = "fub.graph.conf.v1";

/// La conf di ripartenza: il preset «organica» — il punto di partenza
/// provato — e le impostazioni grafiche predefinite. È anche ciò che il
/// pannello ripristina con «Reimposta».
export function confPredefinita(): ConfGrafo {
  return { fisica: confOrganica(), grafica: confGraficaPredefinita(), preset: "organica" };
}

/// Legge la conf dal `localStorage`. Non si fida di nulla: un `localStorage`
/// può essere assente (webview senza persistenza, test), pieno di spazzatura,
/// o scritto da una versione diversa di questo codice — ogni campo passa da
/// `clampConf*`, che riporta ai default ciò che non è un numero finito o un
/// booleano, e il preset ignoto ripiega su `organica` (la personalità fisica
/// predefinita) senza inventare una voce nuova nell'elenco.
export function caricaConf(storage: Storage | undefined = localStorage): ConfGrafo {
  if (!storage) return confPredefinita();
  let raw: unknown = null;
  try {
    raw = storage.getItem(CHIAVE_CONF);
  } catch {
    // `localStorage` che lancia (modalità privata, quota): si parte dai
    // default e si continua a funzionare — il salvataggio riproverà al
    // prossimo cambiamento, e se fallisce si vivrà senza memoria.
    return confPredefinita();
  }
  if (typeof raw !== "string" || raw.length === 0) return confPredefinita();
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return confPredefinita();
  }
  if (!o || typeof o !== "object") return confPredefinita();
  const c = o as Partial<ConfGrafo>;
  // «custom» è un preset legittimo ma non sta in `PRESETTI` (non ha una
  // funzione che lo produce): si accetta esplicitamente, e in quel caso
  // la fisica si rilegge dai numeri salvati. Per ogni altro preset noto, la
  // fisica viene ricostruita dalla funzione del preset — i numeri salvati
  // sono ignorati, perché il preset vince (se no cambiare preset non
  // cambierebbe la fisica).
  const presetGrezzo = typeof c.preset === "string" ? c.preset : "organica";
  const preset = presetGrezzo === "custom" || presetGrezzo in PRESETTI ? presetGrezzo : "organica";
  const fisica = preset === "custom" ? clampConfFisica(c.fisica ?? {}) : PRESETTI[preset]();
  // `clampConfGrafica` accetta parziali e completa coi default: la grafica
  // è indipendente dal preset (si può volere la costellazione senza il
  // pulse), quindi si rilegge sempre dai numeri salvati.
  return {
    fisica,
    grafica: clampConfGrafica(c.grafica ?? {}),
    preset,
  };
}

/// Salva la conf, dopo averla riportata alla forma valida. Un dato che esce
/// dal pannello passa già dai clamp, ma `salvaConf` è anche il confine verso
/// l'esterno: chi la chiama con una conf di mano propria non deve poter
/// scrivere spazzatura nel supporto.
export function salvaConf(conf: ConfGrafo, storage: Storage | undefined = localStorage): void {
  if (!storage) return;
  const daSalvare: ConfGrafo = {
    fisica: clampConfFisica(conf.fisica),
    grafica: clampConfGrafica(conf.grafica),
    preset: conf.preset in PRESETTI || conf.preset === "custom" ? conf.preset : "organica",
  };
  try {
    storage.setItem(CHIAVE_CONF, JSON.stringify(daSalvare));
  } catch {
    // La quota è piena o il supporto è vietato: il grafo vive anche senza
    // memoria, e lanciare qui interromperebbe un gesto che è riuscito.
  }
}

/// Applica un preset: la fisica nuova è la personalità del preset, la
/// grafica non si tocca (è un'altra dimensione — si può volere la
/// costellazione senza rinunciare al pulse). Il preset «organica» è la
/// funzione già pronta di `tipi.ts`; gli altri sono nel `Record` che il
/// lotto A ha dichiarato e che il pannello elenca.
export function applicaPreset(nome: string): ConfFisica {
  const fn = PRESETTI[nome];
  // Un nome fuori dall'elenco (preset di terzi rimosso, refuso della
  // select) ripiega su «organica» invece di lanciare: la fisica
  // predefinita è meglio di un pannello rotto.
  return fn ? fn() : confOrganica();
}
