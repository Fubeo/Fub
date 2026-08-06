// Il presidio di **un ordine**, dentro l'ascoltatore di `document_changed`.
//
// Il conto degli echi (`state/salvataggio.ts`) ha due metà: una scrittura ne
// mette uno prima di partire, e il primo `document_changed` non-watcher su quel
// documento lo consuma — «anche se non c'è niente da dire», che è la frase
// scritta sul campo `Buffer.echi`. Un eco che nessuno consuma **non si ripara
// più**: resta appeso, e il prossimo cambio vero — una riscrittura del kernel o
// di un plugin sotto le dita dell'utente — viene scambiato per il nostro. Cioè
// l'avviso che doveva comparire non compare, ed è il difetto che
// `consumaCambioSotto` esiste per non avere.
//
// Per un po' quella promessa è stata falsa, e per un motivo che nessuna delle
// due metà poteva vedere: nell'ascoltatore, **davanti** alla consumazione, c'era
// una guardia che chiedeva tutt'altro — se qualche riquadro stia mostrando quel
// documento. Le due domande non hanno niente in comune: il conto è del buffer,
// e un buffer esiste anche quando nessun riquadro lo mostra (fra la chiusura di
// una tab e il `flush` che la congeda, che è proprio il momento in cui una
// scrittura in volo produce il suo eco).
//
// # Perché questo presidio guarda il sorgente
//
// Perché è dove il difetto vive. Il conto `echi-fuori-dal-padrone`
// (`.github/scripts/conteggi.mjs`) tiene ferme le due metà nel file che le
// possiede, e non vede un ordine; `salvataggio.test.ts` prova la funzione, che
// è giusta e lo era già. Ciò che è sbagliato è **quale riga viene prima**, e
// l'unico attore che lo vede senza montare l'intero modulo dei riquadri — DOM,
// editor, layout, IPC — è chi legge il file. È la forma del presidio di
// `hidden` (`ui/hidden.test.ts`): `?raw` di Vite e non `node:fs`, perché
// `tsconfig.json` dichiara i soli tipi di Vite e un presidio della shell non
// deve essere il primo a usare un'API che nella webview non esiste.
//
// Zona cieca dichiarata: si guarda il **corpo dell'ascoltatore**, ritagliato
// fra la sua apertura e la successiva `onEvent(`. Una guardia scritta dentro una
// funzione chiamata da qui, invece che qui, non la vedrebbe — ed è il verso
// giusto in cui sbagliare, perché quella guardia dovrebbe essere scritta apposta.
import { describe, expect, it } from "vitest";

import sorgente from "./document.ts?raw";

/// Il corpo dell'ascoltatore di `document_changed`, dalla sua apertura al
/// prossimo `onEvent(`.
function corpo(): string {
  const apre = sorgente.indexOf('onEvent("document_changed"');
  expect(apre, "l'ascoltatore di `document_changed` non si chiama più così").toBeGreaterThan(-1);
  const dopo = sorgente.indexOf("onEvent(", apre + 1);
  return sorgente.slice(apre, dopo === -1 ? sorgente.length : dopo);
}

describe("l'ascoltatore di document_changed", () => {
  it("consuma l'eco prima di guardare se c'è un riquadro", () => {
    const testo = corpo();
    const consuma = testo.indexOf("avvisaSeIlBufferCopre(");
    const guardia = testo.indexOf("paneConDoc(");
    expect(consuma, "non consuma più l'eco").toBeGreaterThan(-1);
    expect(guardia, "non guarda più i riquadri").toBeGreaterThan(-1);
    expect(
      consuma,
      "la guardia sui riquadri sta davanti al conto degli echi: un documento " +
        "con un buffer e nessun riquadro non consuma il proprio eco, e quell'eco " +
        "appeso si mangia il prossimo avviso vero — «il file è cambiato sotto di " +
        "te» detto da un plugin o dal kernel, che non comparirà",
    ).toBeLessThan(guardia);
  });
});
