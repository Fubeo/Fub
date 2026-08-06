// Le due risposte al tempo, provate costruendo l'ordine invece di aspettarlo.
//
// Nessun `setTimeout` e nessun `sleep`: ogni attesa di questi banchi è una
// promessa che il test risolve **quando decide lui**, così l'ordine di arrivo è
// scritto qui dentro invece che sperato. È la forma già usata in
// `state/salvataggio.test.ts`.
import { describe, expect, it, vi } from "vitest";
import { Coda, Corsa } from "./corsa";

/// Una promessa che si risolve (o si rigetta) su comando del banco.
function rinviata<T>(): {
  promessa: Promise<T>;
  risolvi: (v: T) => void;
  rigetta: (e: unknown) => void;
} {
  let risolvi!: (v: T) => void;
  let rigetta!: (e: unknown) => void;
  const promessa = new Promise<T>((res, rej) => {
    risolvi = res;
    rigetta = rej;
  });
  return { promessa, risolvi, rigetta };
}

describe("Corsa", () => {
  it("il giro scaduto non arriva a scrivere, anche se risponde per primo", async () => {
    const corsa = new Corsa();
    const scritte: string[] = [];
    const primo = rinviata<string>();
    const secondo = rinviata<string>();

    const a = corsa.ultimo(async (atteso) => {
      scritte.push(await atteso(primo.promessa));
    });
    // Il secondo giro comincia mentre il primo è ancora in volo: è la corsa, e
    // la si costruisce qui invece di sperare in due latenze diverse.
    const b = corsa.ultimo(async (atteso) => {
      scritte.push(await atteso(secondo.promessa));
    });

    // E risponde per primo il **vecchio**, che è il caso che il difetto
    // descriveva: senza il cancello, «vecchio» finirebbe sotto gli occhi di chi
    // ha già chiesto «nuovo».
    primo.risolvi("vecchio");
    secondo.risolvi("nuovo");
    await Promise.all([a, b]);

    expect(scritte).toEqual(["nuovo"]);
  });

  it("il corpo scaduto si ferma al primo `atteso`, non alla fine", async () => {
    const corsa = new Corsa();
    const dopo = vi.fn();
    const primo = rinviata<number>();

    const a = corsa.ultimo(async (atteso) => {
      await atteso(primo.promessa);
      // Non è una riga in più per bellezza: prova che ciò che il giro scaduto
      // non fa è *tutto il resto del corpo*, non solo l'ultima scrittura. È la
      // differenza fra questo e un `if (mio !== seq) return` in fondo.
      dopo();
    });
    const b = corsa.ultimo(async () => {});
    primo.risolvi(1);
    await Promise.all([a, b]);

    expect(dopo).not.toHaveBeenCalled();
  });

  it("un rigetto arrivato scaduto non è un errore da mostrare", async () => {
    const corsa = new Corsa();
    const primo = rinviata<number>();

    const a = corsa.ultimo(async (atteso) => await atteso(primo.promessa));
    const b = corsa.ultimo(async () => "nuovo");
    primo.rigetta(new Error("indice assente"));

    // Non rilancia: è la ricerca di due tasti fa che non ha trovato l'indice, e
    // dirlo adesso vorrebbe dire scrivere un guasto sopra un risultato buono.
    await expect(a).resolves.toBeUndefined();
    await expect(b).resolves.toBe("nuovo");
  });

  it("un rigetto arrivato mentre il giro è ancora l'ultimo passa intero", async () => {
    const corsa = new Corsa();
    const primo = rinviata<number>();
    const guasto = new Error("indice assente");

    const a = corsa.ultimo(async (atteso) => await atteso(primo.promessa));
    primo.rigetta(guasto);

    // Il rovescio del banco di sopra, e serve: un cancello che ingoiasse **ogni**
    // errore toglierebbe a chi cerca il solo modo di sapere che non si può
    // cercare, e passerebbe verde lo stesso al banco precedente.
    await expect(a).rejects.toBe(guasto);
  });

  it("`annulla` scade i giri in volo senza cominciarne uno", async () => {
    const corsa = new Corsa();
    const scritte: string[] = [];
    const primo = rinviata<string>();

    const a = corsa.ultimo(async (atteso) => {
      scritte.push(await atteso(primo.promessa));
    });
    // La casella si svuota: la risposta in volo non deve ripopolarla. È la sola
    // cosa che un contatore nudo non sa fare senza far partire un giro finto.
    corsa.annulla();
    primo.risolvi("vecchio");
    await a;

    expect(scritte).toEqual([]);
  });

  it("due corse sono due padroni: non si annullano a vicenda", async () => {
    // Due riquadri che mostrano due anteprime sono due corse. Con un contatore
    // unico di modulo — che è com'erano scritte due delle quattro
    // implementazioni a mano — la seconda anteprima cancellerebbe la prima.
    const sinistra = new Corsa();
    const destra = new Corsa();
    const scritte: string[] = [];
    const a = rinviata<string>();
    const b = rinviata<string>();

    const ga = sinistra.ultimo(async (atteso) => void scritte.push(await atteso(a.promessa)));
    const gb = destra.ultimo(async (atteso) => void scritte.push(await atteso(b.promessa)));
    a.risolvi("sinistra");
    b.risolvi("destra");
    await Promise.all([ga, gb]);

    expect(scritte.sort()).toEqual(["destra", "sinistra"]);
  });

  it("il giro che resta l'ultimo torna ciò che il corpo torna", async () => {
    const corsa = new Corsa();
    await expect(corsa.ultimo(async (atteso) => await atteso(Promise.resolve(7)))).resolves.toBe(7);
  });
});

describe("Coda", () => {
  it("i lavori non si accavallano: il secondo comincia dopo il primo", async () => {
    const coda = new Coda();
    const passi: string[] = [];
    const primo = rinviata<void>();

    const a = coda.accoda(async () => {
      passi.push("a: dentro");
      await primo.promessa;
      passi.push("a: fuori");
    });
    const b = coda.accoda(async () => {
      passi.push("b: dentro");
    });

    // Il momento che conta: `b` è stato accodato mentre `a` era sospeso, e non
    // è ancora entrato. È ciò che due `saveDoc` sullo stesso buffer facevano —
    // entrambi dentro, entrambi con la stessa `base` letta prima.
    await Promise.resolve();
    expect(passi).toEqual(["a: dentro"]);

    primo.risolvi();
    await Promise.all([a, b]);
    expect(passi).toEqual(["a: dentro", "a: fuori", "b: dentro"]);
  });

  it("chi accoda aspetta il **proprio** lavoro, e ne riceve il valore", async () => {
    const coda = new Coda();
    const a = coda.accoda(async () => "primo");
    const b = coda.accoda(async () => "secondo");
    await expect(a).resolves.toBe("primo");
    await expect(b).resolves.toBe("secondo");
  });

  it("uno sbaglio arriva a chi ha accodato e non ferma la coda", async () => {
    const coda = new Coda();
    const guasto = new Error("disco pieno");
    const a = coda.accoda(async () => {
      throw guasto;
    });
    const b = coda.accoda(async () => "dopo");

    // Le due metà insieme, e servono tutte e due: una coda che ingoiasse
    // l'errore trasformerebbe un salvataggio fallito in un salvataggio riuscito,
    // e una che si fermasse lo trasformerebbe nella morte di tutti quelli dopo.
    await expect(a).rejects.toBe(guasto);
    await expect(b).resolves.toBe("dopo");
  });
});
