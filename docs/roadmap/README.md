# roadmap/

Una **seduta** (gruppo di voci correlate da decidere insieme) per file. I file sono numerati da `01` a `26`.
Una seduta raggruppa voci (argomenti) sulla stessa domanda vista da lati diversi. Conviene decidere le voci in una volta sola. Decisioni separate diventano decisioni sbagliate. Ogni file spiega in testa la ragione del raggruppamento.

## Indice

**L'indice principale è [../todo.md](../todo.md)**. Contiene:
- Le sedute.
- Le voci aperte (con strato, ovvero il livello dell'architettura, e priorità).
- Lo stato.

Evitiamo duplicazioni. Uno stato scritto in due posti diventa uno stato sbagliato in uno dei due.

## Chiusura

Quando una voce si chiude avvengono questi passaggi:
1. Il ragionamento diventa un verbale (documento di decisione) in [../decisions/](../decisions/README.md).
2. La voce **sparisce** da `todo.md` (dalla tabella, dal conteggio della sua seduta e dall'elenco).
3. L'assenza è il segnale del completamento.
4. Rimuovere una riga conferma lo spostamento del verbale.
5. Mantenere una casella spuntata rappresenta solo una promessa scritta.
6. Le spunte si trovano **qui**, nel file della seduta, per tracciare lo stato della singola voce.
7. Il file della seduta resta. È il posto dove la domanda è stata posta bene la prima volta.

## I tre allegati

I tre allegati sono tre modi diversi di attraversare lo stesso elenco.

- [leva.md](leva.md) — *Quali voci contano di più*. Mostra l'importanza delle voci. Una voce può essere P2 (priorità secondaria) e restare la più importante da capire, anche se altre scadono prima.
- [strozzature.md](strozzature.md) — L'**indice inverso**. Si entra da un capitolo di [FEATURES.md](../FEATURES.md). Spiega cosa impedisce oggi a quelle funzionalità (feature) di essere un provider (fornitore di servizi). Serve a chi parte dalla funzionalità.
- [numerazione.md](numerazione.md) — *Corrispondenza*. Mostra la corrispondenza fra la numerazione di prima della riorganizzazione e questa. È l'unico posto del repo (archivio del codice) dove i numeri vecchi restano validi. Serve a leggere i messaggi di commit e i commenti nel codice.