// La diagnostica di §12: codici, gravità e il punto della sorgente a cui si
// riferiscono. È `diagnostics.rs` di `fub-scene`, con la stessa forma JSON:
// lo span, quando c'è, sta appiattito accanto al codice.

import type { Span } from "./text";

/// Un codice di §12.
export type Code = "S001" | "S002" | "S003" | "S004" | "S005" | "S006" | "S007" | "S008" | "S009" | "S010";

/// La gravità di una diagnostica.
export type Severity = "error" | "warning" | "info";

/// La gravità che §12 assegna al codice.
export function severityOf(code: Code): Severity {
  switch (code) {
    case "S003":
    case "S004":
      return "error";
    case "S001":
    case "S005":
    case "S006":
      return "warning";
    default:
      return "info";
  }
}

/// Che cosa vuol dire il codice, per chi lo legge.
export const CODE_MESSAGES: Readonly<Record<Code, string>> = {
  S001: "il disegno non ha un titolo: manca la descrizione accessibile",
  S002: "il documento contiene contenuto che FubDraw conserva ma non modifica",
  S003: "id duplicato: il documento si apre in sola lettura",
  S004: "inchiostro o pennello non validi: il tratto non si ridisegna",
  S005: "contenuto attivo conservato ma mai eseguito",
  S006: "immagine incorporata oltre 5 MiB",
  S007: "versione del formato più recente di quella supportata: sola lettura",
  S008: "il documento ha un DOCTYPE: sola lettura",
  S009: "il tratto contrasta con la carta meno di 3:1",
  S010: "canali d'inchiostro sconosciuti: il tratto non si ridisegna",
};

/// Una diagnostica: il codice, la sua gravità, l'elemento o il blocco a cui
/// si riferisce e un dettaglio leggibile da una macchina. Lo span manca per
/// le diagnostiche del documento intero.
export interface Diagnostic {
  readonly code: Code;
  readonly severity: Severity;
  readonly bytes?: readonly [number, number];
  readonly utf16?: readonly [number, number];
  /// Il dettaglio: l'id ripetuto, l'errore dell'inchiostro, il contrasto
  /// misurato.
  readonly detail?: string;
}

/// Una diagnostica con la gravità del suo codice. Le chiavi assenti non ci
/// sono proprio, come nel JSON di Rust.
export function diagnostic(code: Code, span: Span | null, detail?: string): Diagnostic {
  const result: { -readonly [K in keyof Diagnostic]: Diagnostic[K] } = { code, severity: severityOf(code) };
  if (span !== null) {
    result.bytes = span.bytes;
    result.utf16 = span.utf16;
  }
  if (detail !== undefined) result.detail = detail;
  return result;
}

/// Mette le diagnostiche in un ordine stabile: per codice, poi per posizione;
/// una diagnostica senza span viene prima delle altre dello stesso codice.
export function sortDiagnostics(diagnostics: Diagnostic[]): void {
  diagnostics.sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    const at = a.bytes === undefined ? -1 : a.bytes[0];
    const bt = b.bytes === undefined ? -1 : b.bytes[0];
    return at - bt;
  });
}
