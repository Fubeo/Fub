// La ricerca nel vault, vista da chi la chiede senza conoscerne il pannello.
//
// Un intento (`run_search`) e un segnalibro di ricerca vogliono la stessa cosa:
// che la domanda finisca nella casella e parta come se l'avesse scritta
// l'utente. Dove sia quella casella lo sa la shell, che monta qui la sua porta;
// senza una shell che l'abbia montata la richiesta non ha dove andare, e non
// fa niente.
import type { Teardown } from "../ui/lifetime";

/// Ciò che la shell offre a chi vuole avviare una ricerca.
export interface SearchPort {
  /// Mette la domanda nella casella della ricerca e la esegue.
  searchFor(query: string): void;
}

let port: SearchPort | null = null;

/// La shell dichiara la sua ricerca; il disposer la toglie, se è ancora la sua.
export function setSearchPort(next: SearchPort): Teardown {
  port = next;
  return () => {
    if (port === next) port = null;
  };
}

/// Avvia una ricerca da fuori, attraverso la porta della shell.
export function searchFor(query: string): void {
  port?.searchFor(query);
}
