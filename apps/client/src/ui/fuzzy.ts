// La ricerca a sottosequenza delle palette: una funzione pura, senza la shell,
// così la usa anche chi arriva quando serve, come l'editor del disegno.

/// La query è una **sottosequenza** di questo testo? E quanto bene?
///
/// `null` se non lo è. Altrimenti un punteggio in cui **più basso è meglio**,
/// come il rango di `filterCommands`, perché i due si sommano: conta quanti
/// buchi ci sono fra un carattere trovato e il successivo, e da dove comincia il
/// primo. È ciò che fa vincere «nuova nota» su «rinomina» per la query `nn`
/// senza una tabella di casi speciali.
export function fuzzyScore(text: string, query: string): number | null {
  const t = text.toLowerCase();
  let i = 0;
  let points = 0;
  let previous = -1;
  for (const c of query) {
    const found = t.indexOf(c, i);
    if (found < 0) return null;
    // Un carattere attaccato al precedente non costa niente; uno lontano costa
    // la distanza. Il primo costa da dove comincia.
    points += previous < 0 ? found : found - previous - 1;
    previous = found;
    i = found + 1;
  }
  return points;
}
