// Le due risposte al tempo, provate costruendo l'ordine invece di aspettarlo.
//
// Nessun `setTimeout` e nessun `sleep`: ogni attesa di questi banchi è una
// promessa che il test risolve **quando decide lui**, così l'ordine di arrivo è
// scritto qui dentro invece che sperato. È la forma già usata in
// `state/salvataggio.test.ts`.
import { describe, expect, it, vi } from "vitest";
import { Queue, CoalescingQueue, Race } from "./race";

/// Una promessa che si risolve (o si rigetta) su comando del banco.
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("Race", () => {
  it("il giro scaduto non arriva a scrivere, anche se risponde per primo", async () => {
    const race = new Race();
    const writtenItems: string[] = [];
    const first = deferred<string>();
    const secondRequest = deferred<string>();

    const a = race.last(async (expected) => {
      writtenItems.push(await expected(first.promise));
    });
    // Il secondo giro comincia mentre il primo è ancora in volo: è la corsa, e
    // la si costruisce qui invece di sperare in due latenze diverse.
    const b = race.last(async (expected) => {
      writtenItems.push(await expected(secondRequest.promise));
    });

    // E risponde per primo il **vecchio**, che è il caso che il difetto
    // descriveva: senza il cancello, «vecchio» finirebbe sotto gli occhi di chi
    // ha già chiesto «nuovo».
    first.resolve("vecchio");
    secondRequest.resolve("nuovo");
    await Promise.all([a, b]);

    expect(writtenItems).toEqual(["nuovo"]);
  });

  it("il corpo scaduto si ferma al primo `atteso`, non alla fine", async () => {
    const race = new Race();
    const after = vi.fn();
    const first = deferred<number>();

    const a = race.last(async (expected) => {
      await expected(first.promise);
      // Non è una riga in più per bellezza: prova che ciò che il giro scaduto
      // non fa è *tutto il resto del corpo*, non solo l'ultima scrittura. È la
      // differenza fra questo e un `if (mio !== seq) return` in fondo.
      after();
    });
    const b = race.last(async () => {});
    first.resolve(1);
    await Promise.all([a, b]);

    expect(after).not.toHaveBeenCalled();
  });

  it("un rigetto arrivato scaduto non è un errore da mostrare", async () => {
    const race = new Race();
    const first = deferred<number>();

    const a = race.last(async (expected) => await expected(first.promise));
    const b = race.last(async () => "nuovo");
    first.reject(new Error("indice assente"));

    // Non rilancia: è la ricerca di due tasti fa che non ha trovato l'indice, e
    // dirlo adesso vorrebbe dire scrivere un guasto sopra un risultato buono.
    await expect(a).resolves.toBeUndefined();
    await expect(b).resolves.toBe("nuovo");
  });

  it("un rigetto arrivato mentre il giro è ancora l'ultimo passa intero", async () => {
    const race = new Race();
    const first = deferred<number>();
    const failure = new Error("indice assente");

    const a = race.last(async (expected) => await expected(first.promise));
    first.reject(failure);

    // Il rovescio del banco di sopra, e serve: un cancello che ingoiasse **ogni**
    // errore toglierebbe a chi cerca il solo modo di sapere che non si può
    // cercare, e passerebbe verde lo stesso al banco precedente.
    await expect(a).rejects.toBe(failure);
  });

  it("`annulla` scade i giri in volo senza cominciarne uno", async () => {
    const race = new Race();
    const writtenItems: string[] = [];
    const first = deferred<string>();

    const a = race.last(async (expected) => {
      writtenItems.push(await expected(first.promise));
    });
    // La casella si svuota: la risposta in volo non deve ripopolarla. È la sola
    // cosa che un contatore nudo non sa fare senza far partire un giro finto.
    race.cancel();
    first.resolve("vecchio");
    await a;

    expect(writtenItems).toEqual([]);
  });

  it("due corse sono due padroni: non si annullano a vicenda", async () => {
    // Due riquadri che mostrano due anteprime sono due corse. Con un contatore
    // unico di modulo — che è com'erano scritte due delle quattro
    // implementazioni a mano — la seconda anteprima cancellerebbe la prima.
    const left = new Race();
    const right = new Race();
    const writtenItems: string[] = [];
    const a = deferred<string>();
    const b = deferred<string>();

    const ga = left.last(async (expected) => void writtenItems.push(await expected(a.promise)));
    const gb = right.last(async (expected) => void writtenItems.push(await expected(b.promise)));
    a.resolve("sinistra");
    b.resolve("destra");
    await Promise.all([ga, gb]);

    expect(writtenItems.sort()).toEqual(["destra", "sinistra"]);
  });

  it("il giro che resta l'ultimo torna ciò che il corpo torna", async () => {
    const race = new Race();
    await expect(race.last(async (expected) => await expected(Promise.resolve(7)))).resolves.toBe(7);
  });
});

describe("Queue", () => {
  it("i lavori non si accavallano: il secondo comincia dopo il primo", async () => {
    const queue = new Queue();
    const steps: string[] = [];
    const first = deferred<void>();

    const a = queue.enqueue(async () => {
      steps.push("a: dentro");
      await first.promise;
      steps.push("a: fuori");
    });
    const b = queue.enqueue(async () => {
      steps.push("b: dentro");
    });

    // Il momento che conta: `b` è stato accodato mentre `a` era sospeso, e non
    // è ancora entrato. È ciò che due `saveDoc` sullo stesso buffer facevano —
    // entrambi dentro, entrambi con la stessa `base` letta prima.
    await Promise.resolve();
    expect(steps).toEqual(["a: dentro"]);

    first.resolve();
    await Promise.all([a, b]);
    expect(steps).toEqual(["a: dentro", "a: fuori", "b: dentro"]);
  });

  it("chi accoda aspetta il **proprio** lavoro, e ne riceve il valore", async () => {
    const queue = new Queue();
    const a = queue.enqueue(async () => "primo");
    const b = queue.enqueue(async () => "secondo");
    await expect(a).resolves.toBe("primo");
    await expect(b).resolves.toBe("secondo");
  });

  it("uno sbaglio arriva a chi ha accodato e non ferma la coda", async () => {
    const queue = new Queue();
    const failure = new Error("disco pieno");
    const a = queue.enqueue(async () => {
      throw failure;
    });
    const b = queue.enqueue(async () => "dopo");

    // Le due metà insieme, e servono tutte e due: una coda che ingoiasse
    // l'errore trasformerebbe un salvataggio fallito in un salvataggio riuscito,
    // e una che si fermasse lo trasformerebbe nella morte di tutti quelli dopo.
    await expect(a).rejects.toBe(failure);
    await expect(b).resolves.toBe("dopo");
  });
});

describe("CoalescingQueue", () => {
  it("tre scritture accavallate della stessa chiave sono una scrittura sola, con l'ultimo valore", async () => {
    const queue = new CoalescingQueue();
    // Il conto delle scritture partite, e il banco lo nomina: senza
    // coalescenza qui ce ne sarebbero tre — «primo», «secondo» e «terzo» — e
    // il `toEqual(["terzo"])` in fondo sarebbe rosso. È il verso che la forma
    // esiste per chiudere: coalescere non è scartare, è partire una volta sola
    // con ciò che conta.
    const writtenItems: string[] = [];
    const first = deferred<void>();

    const a = queue.enqueueByKey("k", async () => {
      writtenItems.push("primo");
      await first.promise;
    });
    const b = queue.enqueueByKey("k", async () => {
      writtenItems.push("secondo");
    });
    const c = queue.enqueueByKey("k", async () => {
      writtenItems.push("terzo");
    });

    first.resolve();
    await Promise.all([a, b, c]);

    // Le prime due non partono perché il loro valore è già invecchiato, ma la
    // terza arriva — ed è arrivata per tutti e tre, chi ha accodato compreso.
    expect(writtenItems).toEqual(["terzo"]);
  });

  it("chi ha accodato prima aspetta il lavoro fuso, che porta l'ultimo valore", async () => {
    const queue = new CoalescingQueue();
    const steps: string[] = [];
    const throttle = deferred<void>();

    const a = queue.enqueueByKey("k", async () => {
      steps.push("vecchio");
    });
    const b = queue.enqueueByKey("k", async () => {
      steps.push("nuovo: dentro");
      await throttle.promise;
      steps.push("nuovo: fuori");
    });

    let toFinished = false;
    void a.then(() => {
      toFinished = true;
    });

    // Il lavoro di `a` è stato fuso in quello di `b`: se `a` si risolvesse da
    // sé sarebbe già finita qui — invece aspetta il lavoro partito, e quello
    // porta il valore nuovo, non il suo. È la metà che una coalescenza che
    // scarta l'ultima sbaglierebbe: lì partirebbe «vecchio».
    await Promise.resolve();
    expect(toFinished).toBe(false);
    expect(steps).toEqual(["nuovo: dentro"]);

    throttle.resolve();
    await Promise.all([a, b]);
    expect(toFinished).toBe(true);
    expect(steps).toEqual(["nuovo: dentro", "nuovo: fuori"]);
  });

  it("chiavi diverse non si mettono in coda a vicenda", async () => {
    const queue = new CoalescingQueue();
    const steps: string[] = [];
    const throttle = deferred<void>();

    const slow = queue.enqueueByKey("slow", async () => {
      steps.push("slow: dentro");
      await throttle.promise;
      steps.push("slow: fuori");
    });
    const fast = queue.enqueueByKey("veloce", async () => {
      steps.push("veloce");
    });

    await Promise.resolve();
    // La lenta è sospesa e la veloce è partita lo stesso: se le chiavi
    // condividessero una coda sola, qui ci sarebbe solo «lenta: dentro».
    expect(steps).toEqual(["slow: dentro", "veloce"]);

    throttle.resolve();
    await Promise.all([slow, fast]);
    expect(steps).toEqual(["slow: dentro", "veloce", "slow: fuori"]);
  });

  it("uno sbaglio arriva a chi ha accodato e non ferma la coda", async () => {
    const queue = new CoalescingQueue();
    const steps: string[] = [];
    const failure = new Error("disco pieno");

    const a = queue.enqueueByKey("k", async () => {
      throw failure;
    });
    // Un giro di microtask: il lavoro di `a` è partito, quindi `b` non lo
    // fonde — si accoda dopo, come in `Queue`.
    await Promise.resolve();
    const b = queue.enqueueByKey("k", async () => {
      steps.push("dopo");
    });
    const c = queue.enqueueByKey("altra", async () => {
      steps.push("altra chiave");
    });

    await expect(a).rejects.toBe(failure);
    await Promise.all([b, c]);
    // L'ordine fra le due non è la regola — `b` non può partire prima che la
    // catena di `a` si riarmi, e `c` parte su una coda nuova, quindi l'ordine
    // è stabile ma non dice niente. La regola è che ci sono **tutte e due**:
    // la chiave di `a` non è morta con lui, e le altre chiavi non l'hanno
    // nemmeno visto.
    expect(steps.sort()).toEqual(["altra chiave", "dopo"]);
  });
});
