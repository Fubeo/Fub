// Gli spazi del Disegno completo (piano K6, T7; `docs/product/drawing-custom.md`,
// «Gli spazi di lavoro»). Gli otto preset vengono da
// `crates/ui-egui/src/workspaces.rs` (`builtins()`), con i nomi di Fub:
// `open_panel` diventa una sezione, `dock_tab` una scheda, `rulers` i righelli,
// `control_bar` la fila delle opzioni, e le famiglie sono quelle che lo spazio usa.
//
// Ogni spazio è un dato. Applicarlo è una funzione pura su un'interfaccia
// (`EffettiSpazio`): la scheda, la sezione, e le famiglie da preparare in
// sottofondo, che non fanno un passo della cronologia e non cambiano il file.
// Una sezione che l'ispettore non ha (ancora) si salta, come una casella il cui
// strumento non è nell'indice.
//
// Il Completo arriva con un `import()` (`chrome/workspace.ts`): questo file sta
// nel suo chunk, e il chunk principale non lo importa. Gli id e le loro liste
// stanno in `tools/registry.ts` (`SPAZI_COMPLETO`), e il test qui li confronta.

import type { Caricatore } from "./carica";

/// Le schede che uno spazio apre: quelle dell'ispettore del disegno.
export type SchedaSpazio = "design" | "layers";

/// Un preset del Disegno completo, come dato.
export interface SpazioPreset {
  /// Lo stesso id che `draw.workspace` scrive (`SPAZI_COMPLETO`).
  readonly id: string;
  /// La scheda che apre (`dock_tab`: Livelli, o Design per gli altri).
  readonly scheda: SchedaSpazio;
  /// La sezione aperta nell'ispettore (`open_panel`), o `null`.
  readonly sezione: string | null;
  /// I righelli (`rulers`). La fila delle opzioni (`control_bar`) è sempre
  /// quella di Fub, ma il dato resta: i preset la chiedono tutti.
  readonly righelli: boolean;
  readonly fila: boolean;
  /// Le famiglie che lo spazio usa: si preparano in sottofondo quando lo si
  /// sceglie (`famiglia.prepara`), così il primo comando non aspetta.
  readonly famiglie: readonly string[];
}

/// Lo spazio «Completo» di serie: niente di particolare da aprire.
export const SPAZIO_COMPLETO: SpazioPreset = {
  id: "full",
  scheda: "design",
  sezione: null,
  righelli: false,
  fila: true,
  famiglie: [],
};

/// Gli otto preset, nell'ordine del menu (come `SPAZI_COMPLETO`).
export const PRESET: readonly SpazioPreset[] = [
  { id: "completo-classico", scheda: "design", sezione: "colore", righelli: true, fila: true, famiglie: ["colore"] },
  { id: "automazione", scheda: "layers", sezione: "azioni", righelli: false, fila: true, famiglie: ["automazione"] },
  { id: "impaginazione", scheda: "layers", sezione: "allinea", righelli: true, fila: true, famiglie: ["trasforma", "tavole"] },
  { id: "pittura", scheda: "design", sezione: "pennelli", righelli: false, fila: true, famiglie: ["pennelli", "colore"] },
  { id: "ricalco", scheda: "layers", sezione: null, righelli: false, fila: true, famiglie: ["immagini"] },
  { id: "stampa-e-prova", scheda: "design", sezione: "informazioni", righelli: true, fila: true, famiglie: ["stampa"] },
  { id: "tipografia", scheda: "design", sezione: "carattere", righelli: true, fila: true, famiglie: ["testo"] },
  { id: "web", scheda: "design", sezione: "simboli", righelli: true, fila: true, famiglie: ["web", "simboli"] },
];

/// Il preset con quell'id, o `null` se non è uno dei suoi.
export function presetDi(id: string): SpazioPreset | null {
  return PRESET.find((preset) => preset.id === id) ?? null;
}

/// Ciò che uno spazio fa all'editor. `sezione` torna `false` se l'ispettore non
/// ha quella sezione: lo spazio la salta.
export interface EffettiSpazio {
  scheda(scheda: SchedaSpazio): void;
  sezione(id: string): boolean;
}

/// Applica `spazio`: la scheda, la sezione se c'è, e le famiglie in sottofondo.
/// Il caricatore non rifiuta mai (la sua promessa si risolve con un esito),
/// quindi non si aspetta.
export function applicaSpazio(spazio: SpazioPreset, effetti: EffettiSpazio, caricatore: Caricatore): void {
  effetti.scheda(spazio.scheda);
  if (spazio.sezione !== null) effetti.sezione(spazio.sezione);
  for (const famiglia of spazio.famiglie) void caricatore.famiglia(famiglia);
}
