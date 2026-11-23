/// Il livello corrente di un disegno (K6, opzione (a) di DECISIONS): sta nella
/// sessione del documento del client, non nell'editor. Gli editor sullo stesso
/// disegno (due riquadri, la superficie rimontata, il motore riaperto) leggono
/// e scrivono la stessa cella; la cella finisce con la `DocumentSession` (il
/// file chiuso, cancellato, il vault cambiato), e con il file rinominato resta.
///
/// La cella tiene la chiave del livello (il suo id di Fub, o `@posto` se non ne
/// ha) e il suo posto fra i figli della radice; chi la legge ritrova il livello
/// nella scena di adesso (`controls.ts`). Un livello che non c'è più non la
/// svuota: finché manca si disegna nel livello in cima, e se torna (annulla)
/// torna corrente.

/// Il livello scelto: la sua chiave e il suo posto fra i figli della radice.
export interface LivelloScelto {
  readonly key: string;
  readonly at: number;
}

/// La cella del livello corrente di un disegno.
export interface CellaLivello {
  get(): LivelloScelto | null;
  /// Scrive il livello scelto; chi ascolta lo sa solo se cambia.
  set(scelto: LivelloScelto | null): void;
  /// `ascolta` sente ogni cambio, anche quelli di un altro editor; il valore
  /// restituito smette.
  ascolta(ascolta: () => void): () => void;
}

/// Una cella da sola: per un editor senza sessione del documento (il banco, i
/// test, le annotazioni).
export function cellaLivello(): CellaLivello {
  let scelto: LivelloScelto | null = null;
  const chi = new Set<() => void>();
  return {
    get: () => scelto,
    set(nuovo) {
      if (nuovo === scelto || (nuovo !== null && scelto !== null && nuovo.key === scelto.key && nuovo.at === scelto.at)) return;
      scelto = nuovo;
      for (const ascolta of [...chi]) ascolta();
    },
    ascolta(ascolta) {
      chi.add(ascolta);
      return () => {
        chi.delete(ascolta);
      };
    },
  };
}

const celle = new WeakMap<object, CellaLivello>();

/// La cella del disegno della sessione `sessione`: la stessa per ogni editor
/// che la chiede finché la sessione c'è.
export function cellaLivelloDi(sessione: object): CellaLivello {
  let cella = celle.get(sessione);
  if (cella === undefined) {
    cella = cellaLivello();
    celle.set(sessione, cella);
  }
  return cella;
}
