// Quanto vive un ascolto, e chi lo possiede.
//
// Il difetto che questo modulo cancella si scriveva sempre nello stesso modo:
// *chi si registra non ha modo di disiscriversi*. Un menu che aggiunge un
// `click` su `document` e si chiude con Escape; un selettore di icona che
// rimuove il proprio nodo senza sciogliere la trappola del fuoco; un modulo che
// espone `onQualcosa(cb)` e non torna niente. Sono quattro righe diverse in
// quattro file diversi, e sono una frase sola.
//
// La risposta non è ricordarsi il `removeEventListener` gemello — quella è la
// stessa promessa ripetuta, e la promessa ripetuta è la specie di difetto che
// nasce di nuovo al prossimo posto che registra. La risposta è che **non
// esista un modo di registrarsi che non nomini un padrone**: `ascolta` è un
// metodo di `Vita`, cioè non lo si può chiamare senza avere in mano l'oggetto
// che sa anche smettere. Chi apre una `Vita` la chiude; ciò che c'è dentro non
// si conta e non si ricorda.
//
// È la forma della [0125](../../../docs/decisions/0125-un-albero-riusato-riceve-una-porta-non-un-handler.md)
// applicata al terzo lato: là ciò che circolava nel riconciliatore non era un
// handler ma una porta, qui ciò che si passa a chi ascolta non è un
// `EventTarget` ma una vita. In tutti e due i casi il tipo toglie di mezzo il
// momento in cui ci si poteva dimenticare, invece di sorvegliarlo.
//
// Il compilatore prende metà della domanda: non si registra senza una `Vita`.
// L'altra metà — *nessuno scavalca la porta chiamando `document.addEventListener`
// per conto suo* — il compilatore non può prenderla, perché quella funzione è
// del DOM e non nostra. La prende un conto, `.github/scripts/check-ascoltatori.mjs`,
// e questo file è la sua unica eccezione dichiarata.

/// Come si disfa una cosa registrata: la si chiama una volta e non torna
/// niente. È il tipo che `intrappolaFuoco` e `onLingua` già producevano, e che
/// una `Vita` raccoglie invece di lasciare al chiamante.
export type Smontaggio = () => void;

/// Il padrone di un insieme di ascolti.
///
/// Si apre con `apriVita()`, si chiude una volta sola, e dopo la chiusura è
/// **inerte**: `ascolta` non registra più niente e `aggiungi` esegue subito lo
/// smontaggio che riceve. Non è una comodità, è ciò che chiude il difetto del
/// menu contestuale: là il `document.addEventListener` arrivava da un
/// `setTimeout` che poteva scattare *dopo* la chiusura, e restava appeso per
/// sempre. Su una vita chiusa quella riga non fa niente, e non c'è un caso da
/// ricordarsi di gestire.
export class Vita {
  #smontaggi: Smontaggio[] = [];
  #chiusa = false;

  /// Vera dal momento in cui `chiudi()` è stata chiamata la prima volta.
  get chiusa(): boolean {
    return this.#chiusa;
  }

  /// Registra un ascoltatore che vive quanto questa vita.
  ///
  /// Le firme tipizzate ci sono per la ragione per cui esistono in `lib.dom`:
  /// senza, `(e) => e.clientX` su un `"click"` non sarebbe un errore. L'ultima
  /// è la valvola per i bersagli che non hanno una mappa di eventi
  /// (`MediaQueryList`, `AbortSignal`).
  ascolta<K extends keyof DocumentEventMap>(
    bersaglio: Document,
    tipo: K,
    ascoltatore: (e: DocumentEventMap[K]) => void,
    opzioni?: AddEventListenerOptions,
  ): void;
  ascolta<K extends keyof WindowEventMap>(
    bersaglio: Window,
    tipo: K,
    ascoltatore: (e: WindowEventMap[K]) => void,
    opzioni?: AddEventListenerOptions,
  ): void;
  ascolta<K extends keyof HTMLElementEventMap>(
    bersaglio: HTMLElement,
    tipo: K,
    ascoltatore: (e: HTMLElementEventMap[K]) => void,
    opzioni?: AddEventListenerOptions,
  ): void;
  ascolta(
    bersaglio: EventTarget,
    tipo: string,
    ascoltatore: (e: never) => void,
    opzioni?: AddEventListenerOptions,
  ): void;
  ascolta(
    bersaglio: EventTarget,
    tipo: string,
    ascoltatore: (e: never) => void,
    opzioni?: AddEventListenerOptions,
  ): void {
    if (this.#chiusa) return;
    const listener = ascoltatore as EventListener;
    bersaglio.addEventListener(tipo, listener, opzioni);
    // Le stesse `opzioni` alle due chiamate, ed è la ragione per cui sono un
    // parametro solo: un `removeEventListener` che perde il `capture` non
    // toglie niente e non lo dice — e la trappola del fuoco e il selettore di
    // icona ascoltano tutti e due in cattura. Che siano identiche non lo prova
    // nessun banco, e non per una svista: `happy-dom` toglie l'ascoltatore
    // anche senza la fase giusta, quindi la prova ci sarebbe passata verde
    // mentre in un browser vero sarebbe stata rossa. Lo tiene la forma — una
    // variabile, letta due volte — e questa riga.
    this.#smontaggi.push(() => bersaglio.removeEventListener(tipo, listener, opzioni));
  }

  /// Affida a questa vita uno smontaggio prodotto da qualcun altro: la trappola
  /// del fuoco, un `onLingua`, il `destroy` di un editor, la rimozione di un
  /// nodo.
  aggiungi(smontaggio: Smontaggio): void {
    if (this.#chiusa) {
      smontaggio();
      return;
    }
    this.#smontaggi.push(smontaggio);
  }

  /// Disfa tutto, **in ordine inverso** e una volta sola.
  ///
  /// Inverso perché è l'ordine in cui le cose sono state costruite letto a
  /// ritroso, ed è l'unico che non fa girare uno smontaggio in un mondo che un
  /// altro smontaggio ha già smontato a metà.
  ///
  /// Uno sbaglio non ferma gli altri, per la regola del §20.3 che vale già in
  /// `state/store.ts` e in `state/kernel.ts`: metà pulizia saltata sarebbe
  /// esattamente il difetto che questa classe esiste per non avere, e sarebbe
  /// invisibile. Qui non si può nemmeno notificare — una `Vita` si chiude anche
  /// mentre la finestra sta andando via — quindi si prosegue e basta.
  chiudi(): void {
    this.#chiusa = true;
    // Prendere la lista e lasciarne una vuota è **l'unico** modo in cui questa
    // funzione è idempotente, ed è voluto che sia uno solo: c'era anche un
    // `if (this.#chiusa) return` in testa, e con due difese nessun banco poteva
    // diventare rosso togliendone una — cioè la proprietà non era presidiata da
    // niente, era solo vera due volte. Serve comunque, e non per l'idempotenza:
    // una vita chiusa che tenesse ancora i suoi smontaggi terrebbe in vita ciò
    // che hanno catturato.
    const smontaggi = this.#smontaggi;
    this.#smontaggi = [];
    for (let i = smontaggi.length - 1; i >= 0; i--) {
      try {
        smontaggi[i]!();
      } catch {
        // vedi sopra
      }
    }
  }
}

/// Apre una vita. L'unica fabbrica: `new Vita()` funzionerebbe, e non è
/// nascosta perché nascondere una `class` costa un tipo in più senza togliere
/// niente — ciò che conta è che per registrare ne serva *una*, non da dove
/// venga.
export function apriVita(): Vita {
  return new Vita();
}
