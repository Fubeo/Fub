// Il completamento dalla colonna, come nei fogli di calcolo: scrivendo in
// una cella, la Tabella propone un valore già scritto nella stessa colonna,
// col resto selezionato. Invio o Tab accetta, continuare a scrivere lo
// ignora, Canc lo toglie. Solo testo, mai i numeri; mai nell'intestazione.
//
// La colonna si legge una volta, quando la cella si apre
// (`columnCompletion`); a ogni battuta si cerca soltanto fra i valori già
// letti (`suggest`), senza toccare la tabella.

import { isNumberText } from "./sum";

export interface ColumnCompletion {
  /// Il valore intero da proporre per `typed` (ciò che si è scritto, poi il
  /// resto del valore della colonna), o `null`. Si propone soltanto quando un
  /// valore solo comincia così, come in Excel: con «Roma» e «Romagna» nella
  /// colonna, «Rom» non propone niente, e chi scrive «Roma» non si trova
  /// «Romagna» sotto le dita.
  suggest(typed: string): string | null;
}

/// La lingua che confronta le lettere: le maiuscole non contano.
const fold = (text: string) => text.toLocaleLowerCase();

/// Il completamento per una cella della colonna di `values`: i valori delle
/// altre celle del corpo, senza la cella che si scrive. Le celle vuote e i
/// numeri non si propongono; due valori che differiscono solo per le
/// maiuscole sono uno solo (il primo).
export function columnCompletion(values: readonly string[]): ColumnCompletion {
  const seen = new Set<string>();
  const entries: { readonly value: string; readonly key: string }[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (value === "" || isNumberText(value)) continue;
    const key = fold(value);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ value, key });
  }
  return {
    suggest(typed) {
      // Chi scrive un numero vuole quel numero: «12» e Invio non diventa
      // «12 mesi». Con uno spazio dopo («12 ») si sta scrivendo un testo.
      if (typed === "" || /^\s/.test(typed) || (!/\s$/.test(typed) && isNumberText(typed))) return null;
      const prefix = fold(typed);
      let found: { readonly value: string; readonly key: string } | null = null;
      for (const entry of entries) {
        if (!entry.key.startsWith(prefix)) continue;
        if (found) return null;
        found = entry;
      }
      if (!found || found.value.length <= typed.length) return null;
      // Una lettera che cambia lunghezza col minuscolo (la «İ» turca) non
      // lascia tagliare il valore al punto giusto: niente proposta.
      if (fold(found.value.slice(0, typed.length)) !== prefix) return null;
      return typed + found.value.slice(typed.length);
    },
  };
}
