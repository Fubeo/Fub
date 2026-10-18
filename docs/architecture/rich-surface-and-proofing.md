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
  che la shell non legge e copia così come sono. Una tabella, una riga o una
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
  misura in punti (`w`, `h`), o una nota con il suo testo (`note`), di
  chiusura se `end`; il formato lo scrive alla sua maniera e lo rilegge con
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
  soltanto i blocchi cambiati. Il filtro di ciò che si incolla
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
