# Superficie ricca e correttore

> **Domanda:** come la shell modifica un documento di videoscrittura, e come il
> correttore serve ogni superficie di prosa senza conoscerne il formato?
> **Fonti autorevoli:** `apps/client/src/editors/rich/`,
> `apps/client/src/editors/core/proof.ts`, `crates/fub-features/src/proof.rs`.

Questa pagina approfondisce [Superfici editor](editor-surfaces.md). Il
comportamento per chi scrive sta in [Documenti di Word](../product/word-documents.md)
e [Correttore](../product/proofing.md).

## Documenti di videoscrittura: la superficie ricca

I documenti di videoscrittura (formati `docx`, `odt`, `rtf`, `doc`) hanno una
famiglia propria, `rich` (owner `fub.shell.rich`, profilo `document`), risolta
per formato esatto prima della specie `bytes`. La sorgente della sessione è la
**proiezione** che l'host dà del file
([contratto IPC](../reference/ipc-contract.md#documenti-di-videoscrittura)):
la `DocumentSession`, il salvataggio, le bozze, i conflitti e gli eventi
esterni sono quelli di ogni documento testuale, e nessuna battuta attraversa
l'IPC.

- `editors/rich/surface.ts` è statico e leggero: tiene il buffer finché il
  motore non arriva, dichiara subito gli id delle azioni (spente) e i loro
  accordi, mostra il motivo di una sola lettura o di un testo illeggibile.
  Il motore (`editors/rich/engine.ts`, ProseMirror) è un chunk caricato con un
  import dinamico; una superficie smontata prima che arrivi non monta niente.
- `editors/rich/schema.ts` traduce la proiezione in un documento ProseMirror
  e ritorno. Ogni nodo porta con sé il proprio `k`, i dati originali opachi
  che la shell non legge e copia così come sono. Il loro schema lo dichiara la
  proiezione (`opaque_schema`) e la shell lo ricopia; il formato
  (`fub-format-rich/src/blob.rs`) rifiuta uno schema più nuovo e, a ogni
  lettura, un dato che decodificato e riscritto non contiene più tutto ciò
  che diceva, invece di perderne un campo. `tests/opaque_schema.rs` tiene la
  forma dei dati del corpus e chiede di incrementare lo schema quando cambia. Una tabella, una riga o una
  cella nuova non ha `k`: il formato la scrive con le sue proprietà
  predefinite (la griglia di Word, le colonne e un bordo in ODF), e una riga
  che ProseMirror crea riparando una tabella esistente prende il `k` della
  vicina (`fillTableKeys`). Una cella unita in larghezza porta le colonne che
  copre (`span`), che la superficie disegna e il formato scrive. Un oggetto
  e la fine di una sezione portano nel `k` anche le storie che mostrano
  (note, caselle di testo, intestazioni e piè di pagina) con il loro
  contenuto: il file riletto dopo un salvataggio numera le parti di nuovo, e
  un id del buffer nominerebbe la storia di un altro. Al salvataggio ogni
  storia riprende l'id che ha nel documento se lì è identica, altrimenti un
  id nuovo (`fub-format-rich/src/stories.rs`); le parti che il documento
  mostrava e non mostra più si tolgono. Un oggetto senza `k` è nuovo:
  un'immagine con i suoi byte in base64 (`data`, PNG, JPEG o GIF) e la sua
  misura in punti (`w`, `h`), una nota con il suo testo (`note`), di
  chiusura se `end`, o un campo sommario dei titoli fino al livello `toc`
  (1–9), che il codec Word scrive da ricalcolare all'apertura e il codec ODT
  rifiuta; il formato lo scrive alla sua maniera e lo rilegge con
  un `k`. Finché la shell tiene il proprio buffer l'oggetto resta nuovo e ogni
  salvataggio lo riscrive: l'immagine prende il nome dei suoi byte, e una
  nota uguale si riconosce a meno del numero della parte.
  L'enfasi (`m`) e l'aspetto
  del carattere (`f`: tipo, dimensione, colore, colore dell'evidenziatore)
  sono marche **risolte**, scritte soltanto dove differiscono dal paragrafo;
  il ritorno al documento ne fa formattazione diretta, o la toglie quando
  basta toglierla. Allo stesso modo un paragrafo porta l'allineamento
  risolto (`align`), la disposizione (`p`: rientri, prima riga, spazi,
  interlinea, in punti) dove differisce da quella del suo stile, e lo stile
  di un paragrafo di corpo (`s`). Il carattere del documento (`f` in testa)
  e la galleria degli stili (`styles`) sono suggerimenti di resa che il
  ritorno ignora. `BlockWriter` riscrive
  soltanto i blocchi cambiati. Per un `.docx` la rilettura del modello non
  basta, perché un lettore non vede ciò che lui stesso salta: il controllo di
  Fub (`fub-format-rich/src/preservation.rs`, sull'inventario di
  `inventory.rs`) conta elementi e attributi per nome espanso e classe di
  parte, con il **valore** in forma canonica (`canonical.rs`: booleani,
  colori, numeri, misure, percentuali), il testo di ogni paragrafo per
  impronta, le relazioni con la loro destinazione (un `r:id` vale la
  relazione che nomina) e le parti copiate per impronta sha256. Dentro un
  paragrafo la forma dei run conta una volta, perché il codec unisce i run
  uguali. All'apertura la prova a vuoto del codec si misura fuori dal corpo e
  blocco per blocco del corpo: un blocco che perderebbe qualcosa si
  **chiude** (`locked` nella proiezione) e resta i byte del file; una perdita
  fuori dal corpo, o un blocco chiuso, vieta la scrittura intera
  (`body_only`), e si salva soltanto per innesto. Un blocco chiuso si
  ritrova nel documento voluto, in ordine, come il primo blocco segnato
  uguale a quello del file; toglierlo o cambiarlo è un errore `Locked`. Un
  corpo che non si misura per blocchi apre in sola lettura (`codec`); a ogni
  salvataggio i blocchi del corpo che il modello voluto ha uguali alla base
  (allineati per prefisso, suffisso e sottosequenza comune; i figli di un
  content control di blocco o di un contenitore trasparente contano uno per
  uno, e un segnalibro fra due blocchi va con il blocco che segue) e le parti
  il cui dato non è cambiato devono uscire uguali alla prova a vuoto della
  base, senza parti copiate in più e senza riferimenti pendenti nuovi.
  L'inventario conta e non dice dove: il **flusso** (`flow.rs`) legge ogni
  blocco del corpo come sequenza di caratteri, oggetti e strutture, ciascuno
  con le proprietà che lo riguardano, senza i run. All'apertura la prova a
  vuoto porta il flusso di ogni blocco nello stesso ordine (un segnalibro
  spostato di un carattere è una perdita); a ogni salvataggio un blocco non
  toccato porta quello del file, e nei blocchi toccati ogni carattere,
  oggetto e paragrafo che resta tiene le voci che la proiezione non porta
  (la lingua o la disposizione dell'Asia orientale di un tratto). Un corpo
  che non si legge come flusso con i blocchi del modello apre in sola
  lettura. La prova a vuoto accettata si ricorda per l'impronta dei byte del file (il
  writer è deterministico, e il banco del corpus lo prova): il salvataggio
  dopo l'apertura degli stessi byte non la rifà. Quando fuori dal corpo
  niente è cambiato, il salvataggio è un **innesto** (`graft.rs`,
  [0215](../decisions/0215-salvataggio-docx-per-innesto.md)): il file
  com'era, con le sole unità toccate del corpo prese dai byte del codec e i
  loro riferimenti riportati a quelli del file (relazioni; segnalibri per
  nome; commenti, note e permessi per identità; numeri unici nuovi). Si
  rilegge e si controlla contro il file come i byte del codec, e ciò che non
  sa trattare ripiega sulla scrittura intera. Le normalizzazioni
  dichiarate (`NORMALIZATIONS` in `inventory.rs`, ciascuna con la sua
  ragione) non si contano: gli `w:rsid*`, `w:proofErr`,
  `w:lastRenderedPageBreak`, gli `w14:paraId`/`w14:textId` e i loro rimandi
  nei commenti, le statistiche di `app.xml`, il numero (non la presenza) di
  `w:id` e degli `id` dei disegni, il numero dei nomi «Picture N».
  L'esempio `misura` del crate stampa il resoconto per un file. Il filtro di ciò che si incolla
  (`editors/rich/paste.ts`) toglie i `k` che il documento non ha e i link non
  web; allineamento e disposizione di un paragrafo incollato restano.
- `editors/rich/commands.ts` esegue le azioni dell'editor con gli id della
  superficie Markdown che hanno lo stesso gesto; la barra di formattazione e
  l'intento `fub.editor.action` le usano senza saperlo. Ogni superficie ha la
  propria cronologia `prosemirror-history`; ciò che arriva da un altro riquadro
  o dal disco sostituisce i blocchi diversi fuori dalla cronologia.
- `editors/rich/strip.ts` è la striscia del carattere e del paragrafo,
  caricata col motore: i valori (tipo, dimensione, colori, stile del
  paragrafo, spaziature) non sono gesti che commutano e non passano dalla
  barra di formattazione dei plugin. «Copia formato» lo tiene
  il motore e lo applica alla prossima selezione finita (puntatore o Maiusc
  rilasciati). **Immagine** sceglie un'immagine del vault con la porta delle
  immagini del disegno (`DrawingImagePort`: `pick`, poi `read` dal documento
  con il tetto di 16 MB), senza IPC propria.
- `editors/rich/review.ts` trova, sostituisce e conta sul testo verbatim di
  un paragrafo alla volta, con una foglia (a-capo, oggetto, segno) per
  posizione: un'occorrenza torna a un intervallo esatto e non porta via un
  segno. Le occorrenze sono decorazioni del plugin `findPlugin`, che il
  motore tiene sempre e la striscia accende con `RichEngine.find`; trova e
  sostituisci è un'azione che chiede (`ASK_ACTIONS`, come il link), aperta
  da chi la sa chiedere.
- Le revisioni tracciate attraversano la proiezione come `ins` e `del`
  (chi, quando, spostamento) su un tratto, un oggetto e il segno di fine di
  un paragrafo: nello schema sono le marche `ins` e `del` e gli attributi
  omonimi del paragrafo. Il ritorno al documento ritrova una revisione per
  uguaglianza, non per indice, e il confronto canonico le rinumera per uso:
  il file riletto le rinumera, e un'accettata non lascia indici vecchi. Il
  documento resta in sola lettura (`revisions`) soltanto per ciò che la
  superficie non mostra: modifiche di formato e revisioni fuori dal corpo.
  Accettare e rifiutare sono comandi di `review.ts` (`rich.rev.*`); il
  plugin `revisionPlugin` disegna il segno di fine revisionato e toglie la
  revisione da ciò che si scrive dentro, e a capo e unione di due paragrafi
  lasciano il segno revisionato a chi chiude il testo.
- I commenti attraversano la proiezione come elenco `comments` in testa e
  come segni `marker` con `comment` (`id`, `end`) nel testo. Uno tenuto porta
  il commento e le sue parti in `k`, e di lui cambia soltanto `done`; uno
  nuovo è testo semplice, e il ritorno al documento ne fa la parte con un
  paragrafo per riga. Un segno il cui commento non c'è più se ne va con lui.
  Nello schema l'elenco è l'attributo `comments` del documento, così un gesto
  di `comments.ts` cambia segni ed elenco in una battuta (`setDocAttribute`);
  `commentPlugin` dà lo sfondo agli intervalli aperti. Il controllo di
  rilettura accetta l'id durevole e la data UTC che il codec dà a un
  commento nuovo. La striscia offre commenti nuovi soltanto ai formati di
  `RICH_REVIEW_FORMATS` (`docx`).
- Registrare le modifiche è il campo `track` della proiezione
  (`settings.track_changes` del documento), nello schema l'attributo `track`
  del documento. Mentre è acceso, il motore passa ogni transazione
  dell'utente che cambia il documento da `track.ts`, che ne applica la
  versione registrata: si registra soltanto una transazione di sole
  sostituzioni dentro paragrafi dello stesso contenitore, passo per passo,
  con ciò che entra marcato `ins` e ciò che esce lasciato con `del` (o tolto,
  se era un inserimento dello stesso autore); ogni altra si rifiuta, e
  `actionState` spegne le azioni che ne farebbero una. Passano senza
  registrarsi la cronologia, la sincronizzazione e le transazioni segnate da
  `untracked` (commenti, accettare e rifiutare, l'interruttore). Backspace e
  Canc cancellano un carattere da sé (`deleteChar`), per scavalcare il testo
  già eliminato. L'autore è della sessione (`reviewAuthor`), condiviso con i
  commenti. Il codec ODT rifiuta `track`, e un `.odt` che registra resta in
  sola lettura (`track_changes`).
- La pagina di una sezione è il campo `page` della proiezione: sul paragrafo
  che la chiude, accanto a `sect`, e in testa per l'ultima
  (`document.last_section`). Nello schema è l'attributo `page` del nodo
  `section` e del documento; `page.ts` la legge per la sezione del cursore e
  la cambia con le regole del codec (`Page::write`): lati fra 7,2 e 1584 pt,
  margini che lasciano 36 pt al testo, da 1 a 12 colonne, valori al
  ventesimo di punto come li conserva un `.docx`. Le carte vengono da
  `wordcraft_geom::PAPER_SIZES` attraverso `paper.generated.ts`
  (`UPDATE_MIRROR=1 cargo test -p fub-format-rich --test ts_paper`). Non è una
  sostituzione, quindi mentre si registra si rifiuta. Il codec ODT rifiuta
  una pagina. Il foglio (`.rich-content`) prende da `pageStyle` la pagina
  del documento come stile in linea: larghezza della carta, margini (i
  laterali in proporzione quando il riquadro è più stretto) e un bordo.
- L'intestazione e il piè di pagina di una sezione (la storia `default`)
  sono `header` e `footer` accanto a `page`: righe di testo e campi
  `page`/`pages`, `locked` quando la storia ha altro (`running.rs`). Una
  storia che non cambia resta quella che è; una cambiata diventa una storia
  nuova con l'aspetto della prima riga di prima, o con gli stili `Header` e
  `Footer`. Nello schema sono attributi del nodo `section` e del documento;
  `page.ts` li scrive come testo con i codici `{PAGE}` e `{NUMPAGES}`
  (`runningText`, `runningOf`, `setRunning`).
- `editors/rich/toc.ts` (`insertToc`) mette prima del blocco del cursore, o
  al posto del sommario che c'è, un paragrafo `TOCHeading` che finisce con il
  campo `toc` e una voce `TOC1`…`TOC3` per titolo, come li scrive Word; il
  codec aggiunge al documento gli stili che mancano. Un sommario scritto da
  Word senza il campo nel suo titolo non si riconosce e resta.

Gli import `prosemirror-*` stanno sotto `editors/rich/`, ma nessun guard lo
verifica ancora come per CodeMirror. Il Markdown non dipende da questa famiglia;
senza la feature `rich` dell'host questi documenti tornano file a byte.

## Correttore condiviso

Il correttore ha un motore e un client per tutte le superfici di prosa, e un
adattatore per formato.

- Il motore è la feature `fub.proof`, una route `query_index` custom chiusa e
  versionata (`languages`, `check`). Riceve segmenti di testo, una lingua, le
  opzioni e le parole del dizionario personale; risponde con rilievi in byte
  UTF-8 dentro ogni segmento. Il dizionario personale è l'impostazione del
  vault `proof.words`, scritta soltanto dai comandi `proof.word.add` e
  `proof.word.remove`. I dizionari Hunspell della macchina li legge soltanto
  il collegamento dell'host (`HostWiring::MachineDictionaries`).
- Il client, `apps/client/src/editors/core/proof.ts`, non conosce CodeMirror
  né formati. Legge le impostazioni, spezza le richieste entro i limiti della
  route, ricorda i segmenti già controllati, converte gli offset in code unit
  UTF-16 e scarta le risposte arrivate dopo un cambio di configurazione. Senza
  la feature (`unserved`) risponde `null`.
- L'adattatore del formato estrae la prosa e tiene la mappa a pezzi verso il
  buffer. Quello Markdown
  (`apps/client/src/editors/text/profiles/markdown/proof.ts`) mette `U+FFFC`
  al posto di codice, link, tag e formule, e offre una sostituzione soltanto
  per un rilievo che sta in un pezzo copiato dal buffer. I segni sono
  diagnostiche di `@codemirror/lint`; una correzione è una transazione
  `input.proof`, quindi entra nella cronologia della superficie e nella coda
  della `DocumentSession`.

L'adattatore della superficie ricca (`apps/client/src/editors/rich/proof.ts`)
usa lo stesso client e la stessa mappa a pezzi: un segmento per paragrafo, con
il testo verbatim, gli oggetti come `U+FFFC` e gli a-capo e i salti come
separatori. I segni sono decorazioni ProseMirror e una correzione è una
transazione della superficie, nella sua cronologia e nella sessione.

La superficie Markdown carica client e adattatore con un import dinamico e li monta con
`MarkdownProfile.setProof` e `TextEngine.reconfigure()`; la sua `Lifetime`
chiude il client. Le porte (`editors/core/proof-ports.ts`) le compone
`editors/core/bootstrap.ts` sul vault in cui la superficie nasce.

## Dove si trova

- `apps/client/src/editors/rich/`: superficie, motore, schema, comandi,
  incolla e correttore della superficie ricca;
- `apps/client/src/editors/core/proof.ts` e `proof-ports.ts`;
- `apps/client/src/editors/text/profiles/markdown/proof.ts`;
- `crates/fub-features/src/proof.rs` e `crates/fub-format-rich/`.

Il perché della garanzia sul pacchetto è nell'[ADR
0212](../decisions/0212-preservazione-misurata-sul-pacchetto.md), quello della
copia di WordCraft nell'[ADR 0213](../decisions/0213-provenienza-dei-motori-esterni.md).
