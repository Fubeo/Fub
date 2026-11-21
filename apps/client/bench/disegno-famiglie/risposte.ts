// Le risposte del motore del banco ai comandi del Disegno completo (piano K6,
// T5): una cartella di file, uno per famiglia (`<famiglia>.json`), così le
// scene delle famiglie aggiungono le loro risposte senza toccare
// `bench/fake-ipc.ts`.
//
// Ogni file è `{ "risposte": [ … ] }`; una risposta è
// `{ "comando": "disegno.<id>", "argomenti"?: <valore>, "esito": { … } }`:
// vale per una richiesta con quel comando e, se ci sono, quegli argomenti
// (uguali come JSON); `esito` sono i campi del `DrawingOutcome` che cambiano
// rispetto a un esito vuoto. Un comando senza risposta rende `unserved`,
// come il Rust per una riga «da fare»; `disegno.famiglia.prepara` risponde
// sempre «pronta».

import {
  DRAWING_COMMAND_FAMILY_PREPARE,
  DRAWING_FAMILIES,
  type DrawingCommandRequest,
  type DrawingOutcome,
  type PluginError,
} from "../../src/host/contract";

export interface RispostaFamiglia {
  readonly comando: string;
  readonly argomenti?: unknown;
  readonly esito: Partial<DrawingOutcome>;
}

export interface FileRisposte {
  readonly risposte: readonly RispostaFamiglia[];
}

/// Le risposte di tutti i file della cartella, nell'ordine dei nomi.
export const RISPOSTE: readonly RispostaFamiglia[] = Object.entries(
  import.meta.glob<FileRisposte>("./*.json", { import: "default", eager: true }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .flatMap(([, file]) => file.risposte);

/// Il JSON di un valore con le chiavi in ordine: due argomenti uguali danno
/// lo stesso testo anche con le chiavi in un altro ordine.
function canonico(valore: unknown): string {
  return JSON.stringify(valore, (_chiave, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v);
}

/// L'esito di un comando del motore del banco, o il suo errore lanciato.
export function rispostaDiFamiglia(request: DrawingCommandRequest, risposte: readonly RispostaFamiglia[] = RISPOSTE): DrawingOutcome {
  const vuoto: DrawingOutcome = {
    revision: request.revision, preview: null, ops: null, selection: request.selection, losses: [], refused: null, frame: null,
  };
  if (request.id === DRAWING_COMMAND_FAMILY_PREPARE) {
    const famiglia = (request.value as { famiglia?: unknown } | null)?.famiglia;
    if (typeof famiglia !== "string" || !(DRAWING_FAMILIES as readonly string[]).includes(famiglia)) {
      throw { kind: "bad_args", message: `banco: la famiglia ${JSON.stringify(famiglia)} non c'è` } satisfies PluginError;
    }
    return { ...vuoto, reading: { famiglia, stato: "pronta" } };
  }
  const valore = canonico(request.value);
  const risposta = risposte.find((r) => r.comando === request.id && (r.argomenti === undefined || canonico(r.argomenti) === valore));
  if (risposta === undefined) {
    throw { kind: "unserved", message: `banco: ${request.id} non ha una risposta in bench/disegno-famiglie/` } satisfies PluginError;
  }
  return { ...vuoto, ...risposta.esito };
}
