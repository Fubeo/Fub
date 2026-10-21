# 0215 — Un salvataggio che tocca soltanto il corpo di un `.docx` è un innesto nel file com'era

- **Stato:** accolta
- **Data:** 2026-10-21
- **Ambito:** storage
- **Sostituisce:** —
- **Sostituita da:** —

## Contesto

Con la [0209](0209-videoscrittura-come-proiezione.md) il codec DOCX riscrive
il pacchetto intero dal suo modello a ogni salvataggio. La
[0212](0212-preservazione-misurata-sul-pacchetto.md) misura che la riscrittura
non perda niente di ciò che l'utente non ha toccato. Ma la riscrittura cambia
lo stesso ciò che il controllo non conta: l'ordine degli attributi, gli
`rsid`, gli spazi dei nomi dichiarati, i nomi e la compressione delle voci, i
segni che Word rigenera. Un paragrafo cambiato in un documento di cento
pagine dava un `document.xml` diverso dappertutto, e un confronto con il file
di prima, o la cronologia di un vault, non diceva dove l'utente aveva messo
mano.

## Decisione

- **Quando fuori dal corpo niente è cambiato, il salvataggio è un innesto**
  (`fub-format-rich/src/graft.rs`). Il file nuovo è il file com'era, con le
  sole **unità** toccate del corpo (un figlio di `w:body` con i segni che lo
  precedono) prese dai byte che il codec ha scritto per il documento voluto:
  - ogni altra voce dello zip resta i suoi byte, con la sua compressione e
    nel suo ordine; un'unità non toccata resta i byte del file, come il
    prologo, la sezione finale e la chiusura;
  - in un'unità scritta ogni riferimento del codec diventa quello del file:
    le relazioni (un link per tipo e destinazione, un'immagine per
    contenuto), i segnalibri per nome, i commenti, le note e i permessi per
    **identità**, cioè per posizione fra i riferimenti della stessa specie
    del modello e del file, mai per contenuto;
  - i numeri che devono essere unici (le revisioni, i disegni, i
    `w14:paraId`) ne prendono di nuovi che il file non usa;
  - un'immagine nuova entra con la sua relazione e il suo tipo di contenuto,
    e una relazione che il contenuto non nomina più se ne va con le parti
    raggiunte soltanto da lei;
  - gli spazi dei nomi che un'unità scritta usa si dichiarano sulla radice, e
    quelli che il codec dice ignorabili si aggiungono a `mc:Ignorable`.
- **L'innesto non si fida di sé.** Si rilegge con il modello come i byte del
  codec, e si controlla contro il file con l'inventario e il flusso della
  0212. Ogni forma che non sa trattare (un intervallo di spostamento che
  attraversa un'unità che resta, un prefisso che il file usa per un altro
  spazio dei nomi, un corpo che non si divide in unità) ripiega sulla
  scrittura intera, con i suoi controlli. L'utente non vede la differenza
  se non nei byte.
- **Il resto non cambia.** Un salvataggio che tocca intestazioni, note,
  commenti, stili, numerazione o impostazioni resta una scrittura intera,
  finché un caso reale non mostra come innestare anche quelle parti.
- **Ciò che il codec perderebbe si chiude, non chiude il file.** All'apertura
  la prova a vuoto si misura blocco per blocco del corpo e fuori dal corpo.
  Un blocco che perderebbe qualcosa porta `locked` nella proiezione
  (versione 3) e resta i byte del file: la shell lo mostra e non lo cambia,
  il codec rifiuta di toglierlo o cambiarlo e lo ritrova, spostato intero,
  come il primo blocco segnato uguale. Una perdita fuori dal corpo, o un
  blocco chiuso, porta `body_only`: la scrittura intera non si fa, e un
  salvataggio che non è un innesto viene rifiutato con un errore tipizzato
  (`Locked`). Soltanto un corpo che non si misura per blocchi apre ancora in
  sola lettura.

## Conseguenze

### Positive

- Ciò che l'utente non ha toccato resta i byte del file: un confronto fra
  due versioni mostra soltanto i paragrafi cambiati.
- Ciò che l'inventario non sa contare (un ordine fra elementi uguali, una
  normalizzazione dichiarata) resta com'era fuori dalle unità toccate.
- I dati che Word rigenera (statistiche, `rsid`) non cambiano dove l'utente
  non ha scritto.

- Un documento con una parte che il codec non tiene (una lingua dell'Asia
  orientale, wordcraft#3457) si scrive lo stesso dove quella parte non c'è.

### Negative

- Due strade di scrittura, con una regola su quale si prende; i controlli
  sono gli stessi, ma il codice dell'innesto è di Fub e va mantenuto.
- Il salvataggio fa più lavoro: legge il corpo del file come unità, scrive
  l'innesto e lo rilegge.
- Le statistiche di `app.xml` e i segni di Word del file restano quelli di
  prima: Word li aggiorna al suo prossimo salvataggio.
- In un documento con blocchi chiusi o `body_only` la pagina, le
  intestazioni, i commenti e le note non si cambiano da Fub.

## Alternative scartate

### La scrittura intera, sempre

Era il comportamento di prima. È più semplice e i controlli della 0212 la
rendono sicura, ma ogni salvataggio cambia tutto il pacchetto.

### Aprire in sola lettura il documento che il codec perderebbe

Era la regola della 0212. Protegge il file, ma un solo tratto con una lingua
che il codec non tiene rendeva illeggibile per la scrittura un documento
intero: con l'innesto il blocco resta i suoi byte, e il resto si scrive.

### Innestare per contenuto

Riconoscere una nota o un commento dal suo testo fallisce con due note uguali
(«Ivi»): l'innesto le riconosce per identità.

## Verifica

- `crates/fub-format-rich/tests/graft.rs`: i documenti modificabili del
  corpus, un elenco, un paragrafo diviso, un segnalibro, un commento e un
  permesso a cavallo di due paragrafi, tre note uguali, uno spazio dei nomi
  ignorabile, un'immagine nuova, uno spostamento a cavallo che ripiega e un
  blocco chiuso che resta i suoi byte, si sposta e non si cambia;
- lo stesso file, con `FUB_SOFFICE`, fa rileggere a LibreOffice ogni file
  innestato accanto a quello di partenza (il job `libreoffice` della CI);
- i test di `crates/fub-format-rich/src/flow.rs` sulle unità del corpo, e
  quelli di `preservation.rs` sui blocchi chiusi;
- `crates/fub-format-rich/tests/corpus.rs`: la modifica E6 cambia un blocco
  chiuso; `crates/fub-host/tests/rich_documents.rs`: l'errore arriva alla
  porta con il numero del blocco;
- `apps/client/src/__fixtures__/rich-closed.json`: la shell riscrive
  identici i segni della versione 3.
