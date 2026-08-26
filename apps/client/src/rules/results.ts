// Le righe di un elenco di risultati di ricerca: **solo logica**, il DOM sta in
// `panels/search.ts`.
//
// Sta qui e non dentro il pannello per la ragione di `organizer.ts`: il modulo
// del pannello prende gli elementi della pagina al primo import, quindi ciò che
// vive lì dentro si prova solo aprendo l'app — e una decisione che si prova solo
// aprendo l'app non la prova nessuno.
import type { DocumentMatch, Span } from "../host/contract";

/// Una riga dell'elenco: o una **nota** (titolo ed estratto), o una delle sue
/// occorrenze successive.
export interface ResultRow {
  doc: string;
  /// Dove portare il cursore, se si sa. Assente = si apre la nota e basta, che
  /// è ciò che questo pannello faceva per **tutti** i risultati prima della
  /// §21.3.
  byteOffset?: number;
  /// Il numero dell'occorrenza (2, 3, …) per le righe che ne sono una; assente
  /// per la riga della nota.
  occurrence?: number;
  snippet?: string;
  highlights?: Span[];
}

/// Da N risultati a N + (occorrenze successive) righe.
///
/// Omnisearch mostra N punti per nota e lascia saltare all'uno o all'altro, ed è
/// precisamente ciò che `DocumentMatch.occurrences` esiste per rendere
/// esprimibile: prima della [0049](../../../docs/decisions/0181-modello-documento-e-arene.md)
/// la seconda occorrenza non era «difficile da mostrare» — non c'era modo di
/// **dirla**.
///
/// Sta fuori dal disegno perché è la regola, e una regola si prova senza un DOM.
export function rowsToShow(hits: DocumentMatch[]): ResultRow[] {
  const rows: ResultRow[] = [];
  for (const hit of hits) {
    const occurrences = hit.occurrences ?? [];
    rows.push({
      doc: hit.doc,
      byteOffset: occurrences[0]?.span.start,
      snippet: hit.snippet,
      highlights: hit.highlights,
    });
    occurrences.slice(1).forEach((position, i) => {
      rows.push({ doc: hit.doc, byteOffset: position.span.start, occurrence: i + 2 });
    });
  }
  return rows;
}
