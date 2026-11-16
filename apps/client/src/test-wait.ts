// Le attese dei banchi di prova. Lo importano solo i `*.test.ts`: nell'app
// non entra.

/// Ogni quanto si riguarda la condizione: un giro del ciclo degli eventi.
export const TURN_MS = 10;

/// Il limite di chi aspetta un modulo che arriva con un `import()` la prima
/// volta (il codice del disegno, della lavagna, del visore PDF): la prima
/// volta Vite lo trasforma tutto, e con la suite intera che gira accanto ci
/// vuole più dei due secondi degli altri. È un tetto di sicurezza: un modulo
/// già pronto passa al primo giro, uno che non arriva mai fallisce lo stesso
/// col suo nome, prima del tempo della prova.
export const FIRST_IMPORT_MS = 15_000;

/// L'attesa di un banco: aspetta che una condizione diventi vera, o fallisce
/// dicendo cosa aspettava. `within` è il limite che il banco usa quando la
/// chiamata non ne dà uno suo.
export type WaitFor = (thing: string, cond: () => boolean, within?: number) => Promise<void>;

/// Il `waitFor` di un banco, col suo limite di partenza.
///
/// Il limite si conta in **giri** concessi alla pagina, non sull'orologio:
/// `within` vale `within / TURN_MS` giri, e ognuno rende il turno al ciclo
/// degli eventi per almeno `TURN_MS`. Da sola la macchina fa un giro ogni
/// `TURN_MS` circa, e il limite dura quanto diceva; molto carica, il processo
/// ha meno CPU, il lavoro della pagina fra due giri dura di più e i giri
/// arrivano più radi: l'attesa si allunga con il lavoro invece di scadere a
/// metà di un gesto che sta andando. Una condizione che non arriva mai
/// fallisce lo stesso, col suo nome; il tetto di sicurezza resta il tempo
/// della prova (#396).
///
/// I giri si allungano solo col lavoro di **questo** processo. Il primo
/// `import()` di un editor aspetta invece Vite, che trasforma il modulo in un
/// altro processo: intanto la pagina è ferma, i giri passano a vuoto e con la
/// suite intera accanto il limite scade prima del modulo. Chi aspetta un
/// codice caricato la prima volta usa [`FIRST_IMPORT_MS`].
export function waiter(defaultWithin: number): WaitFor {
  return async (thing, cond, within = defaultWithin) => {
    for (let turns = Math.ceil(within / TURN_MS); turns > 0; turns -= 1) {
      if (cond()) return;
      await new Promise((resolve) => setTimeout(resolve, TURN_MS));
    }
    if (cond()) return;
    throw new Error(`non è mai successo: ${thing}`);
  };
}
