// Il silenzio della penna: il lavoro pesante aspetta che la penna si alzi.
//
// Mentre una penna è giù ogni fotogramma è del tratto: un ridisegno della
// lavagna dopo una modifica arrivata da fuori, fatto in quel momento, è un
// tratto che scatta. `PenQuiet` tiene il conto delle penne giù (`enter` e
// `leave`) e lascia aspettare il lavoro che si può rimandare (`defer`):
//
// - **Per chiave.** Il lavoro rimandato si mette in coda con una chiave
//   (`"render"`), e una richiesta nuova con la stessa chiave prende il posto
//   della vecchia: dieci modifiche da fuori durante un tratto danno un
//   ridisegno solo, quello dell'ultima.
// - **Senza penna giù, subito.** Il silenzio non ritarda niente quando non c'è
//   niente da proteggere. Se intanto la stessa chiave aspettava la consegna,
//   la richiesta nuova la sostituisce anche lì: il lavoro vecchio non gira più
//   dopo quello nuovo.
// - **Una consegna sola.** All'ultimo `leave` la coda si affida allo
//   scheduler una volta (in un browser, quando il thread è libero: vedi
//   `dom/idle.ts`). Una penna che torna giù prima annulla la consegna, e la
//   coda aspetta il `leave` dopo.
// - **Una penna giù a metà.** Se un lavoro della consegna chiama `enter`, quelli
//   che non sono ancora girati restano in coda e aspettano il `leave` dopo.
// - **Un errore non ferma gli altri.** Girano tutti, poi si rilancia il primo
//   errore; gli altri si perdono, come nella consegna degli effetti di
//   `dom/pointer-adapter.ts`.
//
// È del nucleo: non conosce il DOM né il tempo. Quando girare la coda lo dice
// lo `Schedule` che riceve, e i test gliene passano uno finto.

/// Chiede di far girare `run` più tardi e dà la funzione che annulla la
/// richiesta. Annullare una richiesta già girata o già annullata non fa niente.
export type Schedule = (run: () => void) => () => void;

/// Una consegna affidata allo scheduler e non ancora girata.
interface Delivery {
  cancel: (() => void) | null;
}

export class PenQuiet {
  readonly #schedule: Schedule;
  #depth = 0;
  #queue = new Map<string, () => void>();
  #delivery: Delivery | null = null;
  #disposed = false;
  /// Vera mentre la coda gira: un `leave` fatto da un lavoro non chiede una
  /// consegna in più, perché il giro in corso prende anche ciò che c'è.
  #flushing = false;

  constructor(schedule: Schedule) {
    this.#schedule = schedule;
  }

  /// Vera mentre almeno una penna è giù.
  get active(): boolean {
    return this.#depth > 0;
  }

  /// Una penna è scesa. Una consegna in volo si annulla: la coda aspetta.
  enter(): void {
    if (this.#disposed) return;
    this.#depth++;
    this.#cancelDelivery();
  }

  /// Una penna si è alzata. All'ultima, la coda si affida allo scheduler. Un
  /// `leave` di troppo non fa niente: il conto non va sotto zero.
  leave(): void {
    if (this.#disposed || this.#depth === 0) return;
    this.#depth--;
    if (this.#depth === 0) this.#deliver();
  }

  /// Fa girare `work` adesso se nessuna penna è giù, altrimenti lo mette in
  /// coda con la chiave `key` al posto di quello che c'era. Un lavoro che
  /// lancia, fatto subito, lancia a chi ha chiamato.
  defer(key: string, work: () => void): void {
    if (this.#disposed) return;
    if (this.#depth > 0) {
      // `delete` e poi `set`: la richiesta nuova va in fondo, dove la mette il
      // momento in cui è arrivata.
      this.#queue.delete(key);
      this.#queue.set(key, work);
      return;
    }
    if (this.#queue.delete(key) && this.#queue.size === 0) this.#cancelDelivery();
    work();
  }

  /// Annulla la consegna in volo e svuota la coda. Dopo, niente fa niente.
  dispose(): void {
    this.#disposed = true;
    this.#depth = 0;
    this.#cancelDelivery();
    this.#queue.clear();
  }

  #deliver(): void {
    if (this.#flushing || this.#delivery !== null || this.#queue.size === 0) return;
    const delivery: Delivery = { cancel: null };
    this.#delivery = delivery;
    const cancel = this.#schedule(() => {
      // Una richiesta annullata che lo scheduler fa girare lo stesso non deve
      // consegnare: la consegna giusta, se c'è, è un'altra.
      if (this.#delivery !== delivery) return;
      this.#delivery = null;
      this.#flush();
    });
    // Uno scheduler che fa girare subito ha già consegnato: non c'è niente da
    // annullare.
    if (this.#delivery === delivery) delivery.cancel = cancel;
  }

  #cancelDelivery(): void {
    const delivery = this.#delivery;
    if (delivery === null) return;
    this.#delivery = null;
    delivery.cancel?.();
  }

  /// Fa girare la coda leggendola viva, un lavoro alla volta: un `defer` fatto
  /// da un lavoro trova ancora in coda quelli che non sono girati e, con la
  /// stessa chiave, li toglie invece di essere seguito da un lavoro più vecchio.
  /// Una penna scesa a metà ferma il giro e il resto aspetta in coda il `leave`
  /// dopo; un `dispose` lo ferma del tutto.
  #flush(): void {
    let failed = false;
    let failure: unknown;
    this.#flushing = true;
    try {
      while (!this.#disposed && this.#depth === 0) {
        const next = this.#queue.entries().next();
        if (next.done) break;
        const [key, work] = next.value;
        this.#queue.delete(key);
        try {
          work();
        } catch (error) {
          if (!failed) {
            failed = true;
            failure = error;
          }
        }
      }
    } finally {
      this.#flushing = false;
    }
    if (failed) throw failure;
  }
}
