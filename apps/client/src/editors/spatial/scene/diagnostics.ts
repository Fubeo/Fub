// La diagnostica di §12: codici, gravità e il punto della sorgente a cui si
// riferiscono. È `diagnostics.rs` di `fub-scene`, con la stessa forma JSON:
// lo span, quando c'è, sta appiattito accanto al codice.

import type { Span } from "./text";

/// Un codice di §12.
export type Code =
  | "S001"
  | "S002"
  | "S003"
  | "S004"
  | "S005"
  | "S006"
  | "S007"
  | "S008"
  | "S009"
  | "S010"
  | "S011"
  | "S012"
  | "S013"
  | "S014"
  | "S015"
  | "S016";

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
    case "S012":
    case "S014":
    case "S016":
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
  S009: "contrasta poco con ciò che ha sotto: un tratto o un testo grande vogliono 3:1, un testo 4,5:1",
  S010: "canali d'inchiostro sconosciuti: il tratto non si ridisegna",
  S011: "unità o guide del documento non valide: si ignorano e restano nel file",
  S012: "immagine senza descrizione: chi non la vede non sa che cosa mostra",
  S013: "testo sotto i 12 px a grandezza naturale",
  S014: "riferimento a un id che il documento non ha: si disegna senza la risorsa",
  S015: "una carta che non va con la sua tavola",
  S016: "il nome della tavola è già del disegno o di una tavola prima: un riferimento a quel nome mostra l'altra",
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
  /// misurato, la grandezza del testo, l'attributo e l'id che manca.
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
