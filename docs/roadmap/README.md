# roadmap/

Una **seduta** per file, numerate da `01` a `22`. Una seduta è un insieme di
voci che conviene decidere in una volta sola, perché sono la stessa domanda
vista da lati diversi e deciderle separate significa deciderle male: ogni file
ha in testa la ragione per cui quelle voci stanno insieme.

**L'indice è [../todo.md](../todo.md)**, e non questo file: lì ci sono le sedute,
le voci ancora aperte con strato e priorità, e lo stato. Qui non si duplica —
uno stato scritto in due posti è uno stato sbagliato in uno dei due, e non si sa
quale.

Quando una voce si chiude, il ragionamento diventa un verbale in
[../decisions/](../decisions/README.md) e la voce **sparisce** da `todo.md` —
dalla tabella, dal conteggio della sua seduta e dall'elenco delle voci. Non si
spunta: in `todo.md` non ci sono spunte da leggere, e l'assenza è il segnale,
perché una casella spuntata resta una promessa scritta da qualcuno mentre una
riga che non c'è più è stata tolta da chi ha spostato il verbale. Le spunte
stanno **qui**, nel file della seduta, e dicono a che punto è la singola voce. Il
file della seduta resta: è il posto dove la domanda è stata posta bene la prima
volta.

## I tre allegati

Non sono sedute e non contengono lavoro da fare; sono tre modi diversi di
attraversare lo stesso elenco.

- [leva.md](leva.md) — *quali voci contano di più*, che non è quali scadono
  prima: una voce può essere P2 e restare la più importante da capire.
- [strozzature.md](strozzature.md) — l'**indice inverso**: si entra da un
  capitolo di [FEATURES.md](../FEATURES.md) e si legge cosa impedisce oggi a
  quelle funzionalità di essere un provider. Serve a chi parte dalla feature e
  non dal contratto.
- [numerazione.md](numerazione.md) — la corrispondenza fra la numerazione di
  prima della riorganizzazione e questa. È l'unico posto del repo dove i numeri
  vecchi restano validi, e serve a leggere i messaggi di commit e i commenti nel
  codice che li nominano ancora.
