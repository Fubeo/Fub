// Il pezzetto di DOM che tutti usano.

/// L'elemento di `index.html` con quel selettore.
///
/// Lancia se non c'è, invece di restituire `null` travestito da elemento con un
/// cast: un id sbagliato (o rimosso da un ritocco al markup) diventa un errore
/// che si legge, con dentro il selettore, al posto di un
/// «cannot read properties of null» tre chiamate più in là. Costa una riga ed
/// è la stessa disciplina che il §20 chiede al backend.
export function $<T extends HTMLElement>(sel: string): T {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`Fub: l'elemento «${sel}» non esiste in index.html`);
  return el as T;
}
