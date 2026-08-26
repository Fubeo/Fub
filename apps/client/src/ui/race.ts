// Chi ha cominciato un giro, e chi decide che quel giro non conta più.
//
// Il difetto che questo modulo cancella si scriveva sempre nello stesso modo:
// *la mia risposta è scaduta e non me ne accorgo*. Una ricerca lenta che
// ripopola la casella dopo che l'utente ha già cambiato query; un'anteprima che
// si riempie del documento di prima; un esplora che si ridisegna con la risposta
// del giro sbagliato. Sono righe diverse in file diversi, e sono una frase sola.
//
// La risposta non è ricordarsi l'`if (mio !== seq) return` dopo ogni `await` —
// quella è la stessa promessa ripetuta, e in `apps/client/src/` era già scritto a
// mano **quattro** volte con tre nomi diversi (`searchSeq`, due `seq`,
// `generazione`). Una difesa che va ricordata quattro volte è una difesa che al
// quinto posto non c'è, e i posti che ne avrebbero bisogno sono trentanove.
//
// La risposta è che **il controllo non sia una riga che si scrive**: `awaited` è
// l'unico modo in cui il corpo di un giro ottiene il risultato di un'attesa, e
// se nel frattempo è cominciato un giro più nuovo `awaited` non torna affatto —
// interrompe il corpo prima che arrivi a scrivere. Chi aggiunge un `await` a un
// corpo già scritto eredita il controllo senza saperlo, che è la sola forma per
// cui il secondo chiamante non paga niente.
//
// È la forma della [0133](../../../docs/decisions/0193-ownership-lifecycle-e-teardown.md)
// applicata al tempo invece che alla vita: là non ci si registra senza nominare
// un padrone, qui non si aspetta senza nominare un giro. E come là, **niente
// marchio**: `awaited` arriva come parametro del corpo, cioè per averlo bisogna
// già essere dentro un giro, e un `unique symbol` non toglierebbe nessuna strada
// che il parametro non tolga già.
//
// # Due risposte, e sceglierne una è una decisione
//
// «La mia risposta è scaduta» e «il mio turno non è ancora arrivato» sembrano la
// stessa domanda e hanno risposte **opposte**. Con una `Race` il lavoro scaduto
// si **butta**, ed è giusto solo quando ciò che portava è un *disegno*: qualcosa
// che il giro nuovo rifarà comunque. Quando invece il lavoro deve arrivare a
// destinazione — una scrittura su disco, una mutazione del layout — buttarlo
// perde dati, e la risposta è **accodare**.
//
// Le due stanno in questo file, e sono due tipi e non due modalità di uno:
// scegliere è una decisione, e una decisione non si prende passando `true`. Chi
// ha in mano una `Race` non può accodare per sbaglio, e chi ha una `Queue` non
// può buttare per sbaglio.
//
// # La zona cieca, dichiarata
//
// Un `catch` che ingoia tutto, scritto **dentro** il corpo, ingoia anche il
// segnale di scadenza, e da lì in poi il corpo prosegue e scrive. È l'unico modo
// noto di scavalcare questa porta, e non è teorico: tutte e quattro le
// implementazioni a mano avevano un `try` attorno alla chiamata, perché tutte e
// quattro dovevano dire qualcosa quando la chiamata falliva.
//
// Per questo l'idioma è **l'errore diventa un valore prima del cancello** —
// `await awaited(promise.catch(…))` — e non un `try` attorno all'`awaited`: così
// il corpo non ha nessun `catch` in cui perdere il segnale, e il ramo d'errore
// passa dallo stesso cancello del ramo buono. Era la metà che le quattro
// implementazioni sbagliavano più spesso: tre su quattro ricontrollavano il
// numero d'ordine anche nel `catch`, la quarta se lo era dimenticato.
//
// A guardare che nessuno scavalchi è `.github/scripts/check-races.mjs`.

/// Il segnale che un giro è scaduto.
///
/// È un simbolo e non un `Error` di proposito: non è un guasto, non ha uno
/// stack che valga la pena guardare, e soprattutto non deve assomigliare a
/// niente che un `catch` scritto per gli errori veri voglia trattare.
const EXPIRED = Symbol("race: giro scaduto");

/// Come il corpo di un giro ottiene il risultato di un'attesa.
///
/// Si usa **al posto di `await`**: `const x = await awaited(promise)`. Se il
/// giro è ancora l'ultimo torna il valore, e se la promessa è stata rigettata
/// rilancia il rigetto come farebbe un `await` normale. Se invece nel frattempo
/// ne è cominciato uno più nuovo non torna e non rilancia niente di
/// intercettabile: il corpo finisce lì.
export type Expected = <T>(promise: Promise<T>) => Promise<T>;

/// Il padrone di una successione di giri, di cui conta solo l'ultimo.
///
/// Se ne apre una per **superficie**, non per modulo: due riquadri che
/// mostrano due anteprime sono due corse, e un contatore unico di modulo li
/// farebbe annullare a vicenda. Che l'oggetto sia una `const` di modulo, un
/// campo o una variabile di chiusura è una scelta di chi lo possiede — le
/// quattro implementazioni a mano si dividevano già a metà fra le prime due, ed
/// è la ragione per cui questo è un oggetto e non un contatore globale.
export class Race {
  #last = 0;

  /// Esegue `corpo` come giro più recente, e scarta ciò che restava dei giri
  /// di prima.
  ///
  /// Torna ciò che il corpo torna, oppure `undefined` se il giro è scaduto
  /// prima di finire — e i due casi si distinguono solo se al chiamante
  /// interessa, che di norma è mai: chi comincia un giro lo comincia per
  /// l'effetto che fa, non per il valore che rende.
  async last<T>(body: (expected: Expected) => Promise<T>): Promise<T | undefined> {
    const mine = ++this.#last;
    const expected = async <V,>(promise: Promise<V>): Promise<V> => {
      let value: V;
      try {
        value = await promise;
      } catch (e) {
        // Un rigetto arrivato quando il giro è già scaduto **non** è un errore
        // da mostrare: è la ricerca di due tasti fa che non ha trovato l'indice.
        // Le implementazioni a mano lo sapevano — tre su quattro ricontrollavano
        // il numero d'ordine anche nel ramo d'errore — e la quarta no.
        if (mine !== this.#last) throw EXPIRED;
        throw e;
      }
      if (mine !== this.#last) throw EXPIRED;
      return value;
    };
    try {
      return await body(expected);
    } catch (e) {
      if (e === EXPIRED) return undefined;
      throw e;
    }
  }

  /// I giri in volo scadono, e non ne comincia uno nuovo.
  ///
  /// È la sola cosa che un contatore nudo non sa fare senza far partire un giro
  /// finto, ed è il motivo per cui `Race` è un oggetto con due metodi invece di
  /// un `++`: fra le quattro implementazioni a mano una sola ce l'aveva
  /// (`clearSearch`, che azzera la casella e deve impedire alla risposta in volo
  /// di ripopolarla), e le altre tre non ce l'avevano perché la loro superficie
  /// si butta invece di riusarsi — cioè non per una scelta, ma per fortuna.
  cancel(): void {
    this.#last++;
  }
}

/// Il padrone di una successione di lavori che devono arrivare **tutti**, uno
/// alla volta e nell'ordine in cui sono stati chiesti.
///
/// È l'altra metà della domanda, ed è la risposta giusta quando ciò che il
/// lavoro porta non è un disegno ma un **effetto**: due salvataggi dello stesso
/// buffer partiti insieme leggono la stessa `base` e il secondo se la vede
/// rifiutare contro il primo, cioè l'utente riceve un «conflitto» su un file che
/// ha toccato solo lui.
///
/// Era già scritto a mano in `panels/document.ts` come una `let coda:
/// Promise<void>` con la sua catena di `.then`, e la ragione per cui now è un
/// tipo è che i posti che la vogliono sono sette e non uno.
export class Queue {
  #last: Promise<unknown> = Promise.resolve();

  /// Mette `lavoro` in fondo alla coda e torna la sua attesa.
  ///
  /// Chi aspetta aspetta **il proprio** lavoro, non la coda: è la differenza fra
  /// «il disco ha ricevuto il mio testo» e «il disco ha ricevuto qualcosa».
  ///
  /// Uno sbaglio non ferma la coda — `#last` riparte dalla catena catturata,
  /// non da `lavoro()` — ma **arriva** a chi ha accodato, che è l'unico che sa
  /// cosa farne. Una coda che si fermasse al primo errore trasformerebbe un
  /// salvataggio fallito nella morte di tutti quelli dopo, in silenzio.
  enqueue<T>(job: () => Promise<T>): Promise<T> {
    // `#last` non rigetta mai — sotto lo si tiene già disinnescato — quindi
    // qui basta un ramo solo. La forma a mano ne aveva due (`then(disegna,
    // disegna)`) perché teneva in catena la promessa *viva*, e con quella il
    // secondo ramo era l'unico modo di non fermarsi al primo errore.
    const mine = this.#last.then(job);
    // `catch` e non `then`: ciò che si vuole è che la catena prosegua, non che
    // il valore si propaghi. Il ramo tenuto per la catena è **un altro oggetto**
    // da quello tornato al chiamante, o il rigetto risulterebbe gestito qui e
    // chi ha accodato non lo vedrebbe mai.
    this.#last = mine.catch(() => {});
    return mine;
  }
}

/// Il lavoro di una chiave che aspetta il proprio turno. Sostituirne il
/// `lavoro` è coalescere: la promessa resta quella, e chi la tiene non sa di
/// essere stato fuso.
interface PendingEntry {
  job: () => Promise<void>;
  promise: Promise<void>;
}

/// Lo stato di una chiave: la coda dei suoi lavori già partiti, e l'ultimo
/// lavoro che aspetta di partire.
interface EntryByKey {
  queue: Queue;
  pending: PendingEntry | null;
}

/// Il padrone dei lavori per **chiave** in cui, per ogni chiave, conta solo
/// l'ultimo valore — e nessun valore si perde.
///
/// È ciò che la [0133](../../../docs/decisions/0193-ownership-lifecycle-e-teardown.md)
/// lasciava da decidere: una scrittura su disco si **accoda**, non si **scarta**.
/// Per ogni chiave la coda tiene **al più un lavoro in volo e al più uno che
/// aspetta**: quello che aspetta porta sempre il valore più recente, perché
/// ogni arrivo in attesa sostituisce il lavoro che c'era, e quello che è
/// partito arriva sempre. Un arrivo mentre un lavoro corre non si fonde — apre
/// un giro nuovo — e non è un limite ma la condizione per cui chi arriva in
/// volo aspetta **il proprio** esito; chi arriva mentre un lavoro aspetta, e lo
/// sostituisce, aspetta invece l'esito del lavoro fuso, come se fosse il suo.
/// Coalescere non è scartare: ciò che parte c'è e arriva, e ciò che si perde è
/// solo il valore intermedio, che nessuno ha chiesto di vedere.
///
/// È un tipo accanto a `Queue` e non un modo di `Queue`, per la stessa ragione
/// per cui `Race` e `Queue` sono due tipi: chiavi diverse non si bloccano fra
/// loro, e una coda sola le metterebbe in fila comunque. Ogni chiave ha la sua
/// `Queue`, e una scrittura lenta su una non ritarda l'altra.
export class CoalescingQueue {
  #byKey = new Map<string, EntryByKey>();

  /// Mette `lavoro` in coda per `chiave`, e torna l'attesa del lavoro che
  /// partirà — il proprio, o il lavoro fuso che lo ha sostituito.
  ///
  /// Se per quella chiave c'è già un lavoro in coda che non è partito, il
  /// valore nuovo prende il suo posto: chi aveva accodato prima aspetta il
  /// lavoro fuso, non il proprio, che non partirà mai. Se invece un lavoro
  /// sta già correndo, il nuovo si accoda e chi lo ha chiesto aspetta il
  /// proprio esito — la chiave non ha mai più di un lavoro in attesa. Un
  /// errore arriva a chi ha accodato e non ferma la coda, come in `Queue` —
  /// chi è stato fuso lo riceve insieme al primo, perché aspetta lo stesso
  /// lavoro.
  enqueueByKey(key: string, job: () => Promise<void>): Promise<void> {
    let entry = this.#byKey.get(key);
    if (!entry) {
      entry = { queue: new Queue(), pending: null };
      this.#byKey.set(key, entry);
    }
    const v = entry;
    if (v.pending) {
      // Un lavoro per questa chiave aspetta già il proprio turno: il valore
      // nuovo sostituisce il vecchio, e chi aspettava riceverà l'esito del
      // lavoro fuso — la promessa è la stessa, e non cambia.
      v.pending.job = job;
      return v.pending.promise;
    }
    const pending: PendingEntry = {
      job,
      // Le sostituzioni di qui sopra mutano `pending.job` nello stesso
      // oggetto, quindi chi parte legge il valore più recente. Svuotare la
      // voce prima di partire fa sì che un arrivo di mezzo apra un giro nuovo
      // invece di fondersi in questo.
      promise: v.queue.enqueue(async () => {
        v.pending = null;
        await pending.job();
      }),
    };
    v.pending = pending;
    return pending.promise;
  }
}
