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
  accordi, dice lo stato del documento (`standing`, da
  `editors/rich/standing.ts`: in sola lettura «Che cosa manca?» elenca le
  voci di `missing` della proiezione, con un «Vai» per quelle che stanno in
  un blocco) e mostra in una riga soltanto un testo
  illeggibile o un motore che non si è caricato.
  Il motore (`editors/rich/engine.ts`, ProseMirror) è un chunk caricato con un
  import dinamico; una superficie smontata prima che arrivi non monta niente.
- `editors/rich/closed.ts` tiene fuori dal buffer ciò che il formato
  rifiuterebbe al salvataggio (`host.rich.locked.*`). Un blocco chiuso
  (`locked`) si disegna segnato, senza cursore (`contenteditable="false"`), e
  ogni transazione dell'utente che lo cambia, lo toglie o ne scambia l'ordine
  con un altro chiuso non entra; spostarlo intero sì. Con `body_only` non
  entra nemmeno ciò che tocca la pagina dell'ultima sezione, le intestazioni
  e i piè di pagina, i commenti, la registrazione, l'insieme delle note o una
  specie di elenco che il documento non ha. Le azioni che scriverebbero
  qualcosa di tutto questo si spengono (`RichEngine.allows`), e il chip
  dello stato dice perché. Ciò che arriva da un altro riquadro o dal disco
  entra com'è.
- `editors/rich/schema.ts` traduce la proiezione in un documento ProseMirror
  e ritorno. Ogni nodo porta con sé il proprio `k`, i dati originali opachi
  che la shell non legge e copia così come sono. Il loro schema lo dichiara la
  proiezione (`opaque_schema`) e la shell lo ricopia; il formato
  (`fub-format-rich/src/blob.rs`) rifiuta uno schema più nuovo e, a ogni
  lettura, un dato che decodificato e riscritto non contiene più tutto ciò
  che diceva, invece di perderne un campo. `tests/opaque_schema.rs` tiene la
  superficie serde dei tipi che quei dati codificano, letta dai sorgenti, e
  quando cambia chiede di incrementare lo schema, di dire come si legge
  quello di prima e di scriverne la bozza. Una tabella, una riga o una
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
  nota uguale si riconosce a meno del numero della parte. Una nota tenuta
  porta anche, da leggere, il suo testo e se è di chiusura: la superficie
  ne fa il richiamo in apice, 1, 2, 3 a piè di pagina e i, ii, iii in
  chiusura nell'ordine del documento (`editors/rich/notes.ts`). Un'immagine
  tenuta porta, da vedere, i suoi byte in `data` quando il file la tiene in
  PNG, JPEG o GIF, intera (senza ritaglio), fino a 4 MiB l'una e 8 MiB per
  tutto il documento nell'ordine del testo (`MAX_SHOWN_IMAGE_BYTES`,
  `MAX_SHOWN_BYTES` in `projection.rs`): la superficie la disegna. Le altre
  restano segnaposti col nome e la misura. Il ritorno al documento ignora
  quei byte: vale l'immagine tenuta in `k`. Il codec ODT non li porta ancora.
  L'enfasi (`m`) e l'aspetto
  del carattere (`f`: tipo, dimensione, colore, colore dell'evidenziatore)
  sono marche **risolte**, scritte soltanto dove differiscono dal paragrafo;
  il ritorno al documento ne fa formattazione diretta, o la toglie quando
  basta toglierla. Allo stesso modo un paragrafo porta l'allineamento
  risolto (`align`), la disposizione (`p`: rientri, prima riga, spazi,
  interlinea, in punti) dove differisce da quella del suo stile, e lo stile
  di un paragrafo di corpo (`s`). Il carattere del documento (`f` in testa)
  la galleria degli stili (`styles`) e l'aspetto di ogni ruolo (`roles`:
  titoli, citazione, elenco) sono suggerimenti di resa che il ritorno
  ignora: un paragrafo che diventa titolo, sottotitolo o corpo prende subito
  il carattere e l'allineamento che il suo stile gli darà. Come in Word, il
  carattere, la dimensione e il colore scritti su più di metà del suo testo
  se ne vanno, e un allineamento scritto a mano resta. `BlockWriter` riscrive
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
  dopo l'apertura degli stessi byte non la rifà. Se ne ricordano al più
  otto, e quelle prima dell'ultima entro un peso di circa 350 MB: un documento
  da centomila paragrafi ne tiene da solo più di 400 MB. Le misure che non si
  parlano (i due inventari e i due flussi, la proiezione e la rilettura del
  codec, l'innesto e la sua rilettura) corrono su due thread (`parallel.rs`);
  all'apertura i byte si misurano soltanto dopo che la proiezione e la
  rilettura hanno lasciato la memoria. Un documento da centomila paragrafi apre in meno di cinque secondi con un
  picco di circa 1,3 GB, quasi tutto del modello del codec. Quando fuori dal corpo
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
  `w:id` e degli `id` dei disegni, il numero dei nomi «Picture N», i
  contenitori di proprietà vuoti (`w:rPr`, `w:pPr`, `w:trPr`, `w:tcPr` senza
  attributi né figli, che LibreOffice scrive). Cinque forme si contano come
  quelle che il codec scrive: i lati di ISO 29500 (`w:start`, `w:end`,
  `jc="start"`) come `left` e `right`, il `w:val` vero di un interruttore
  (`CT_OnOff`, `<w:keepNext w:val="true"/>`) come la sua assenza, lo
  sporgente nullo (`w:hanging="0"`) come la prima riga nulla, un
  `w:fldSimple` come il campo complesso, e un corpo che finisce con una tabella come se avesse il
  paragrafo vuoto che il modello le mette dopo, un blocco senza byte che
  l'innesto scrive soltanto se lo si tocca. Una parte di WordprocessingML
  senza `+xml` nel tipo (le impostazioni della stampante) si copia.
  L'esempio `misura` del crate stampa il resoconto per un file. Il filtro di ciò che si incolla
  (`editors/rich/paste.ts`) toglie i `k` che il documento non ha e i link non
  web; allineamento e disposizione di un paragrafo incollato restano.
- `editors/rich/commands.ts` esegue le azioni dell'editor con gli id della
  superficie Markdown che hanno lo stesso gesto; la barra, la bolla della selezione e
  l'intento `fub.editor.action` le usano senza saperlo. Ogni superficie ha la
  propria cronologia `prosemirror-history`; ciò che arriva da un altro riquadro
  o dal disco sostituisce i blocchi diversi fuori dalla cronologia.
  Come nell'editor di testo il Tab si ferma sul foglio che scorre
  (`.rich-page`, `role="document"`), non dentro il documento: Invio porta a
  scrivere, dove Tab scrive una tabulazione o sposta il livello di un
  elenco, e dopo un Esc, per due secondi, Tab esce.
- `editors/rich/ribbon.ts` è la barra multifunzione del documento, caricata
  col motore: la barra del kit (`kit/ribbon/ribbon.ts`, la stessa del
  foglio) con le schede Home, Inserisci, Layout, Revisione, Visualizza e la
  contestuale Tabella, Annulla e Ripeti accanto alle schede, le lettere con
  Alt o F10 e Ctrl+F1 per ritirarla. Ogni controllo è un'azione del motore
  (`RICH_ACTION_IDS`, con i suoi accordi), un valore che il motore scrive
  (tipo, dimensione, stile del paragrafo, con la galleria che scrive ogni
  nome nel carattere del documento), un riquadro di
  `editors/rich/panels.ts` o una scheda del pannello di destra
  (`side.ts`). Layout ha le gallerie veloci della pagina (Margini,
  Orientamento, Dimensione, Colonne), con ciò che c'è segnato e una voce
  «Altre opzioni di pagina…» che apre Proprietà; Conteggio apre Proprietà
  sul conteggio. Il catalogo della barra spegne col perché ciò
  che non si dà adesso: in sola lettura ciò che scrive (restano Trova,
  Conteggio, Commenti, scorrere le revisioni e lo zoom), mentre si registra
  il formato. La superficie dichiara `ownBar`, e la barra di formattazione
  della shell non si mostra sopra; la mini-barra del menu è quella della
  barra. Lo zoom è il comando della shell (`runShellCommand`). «Copia formato» lo tiene
  il motore e lo applica alla prossima selezione finita (puntatore o Maiusc
  rilasciati). **Immagine** sceglie un'immagine del vault con la porta delle
  immagini del disegno (`DrawingImagePort`: `pick`, poi `read` dal documento
  con il tetto di 16 MB), senza IPC propria.
- `editors/rich/review.ts` trova, sostituisce e conta sul testo verbatim di
  un paragrafo alla volta, con una foglia (a-capo, oggetto, segno) per
  posizione: un'occorrenza torna a un intervallo esatto e non porta via un
  segno. Le occorrenze sono decorazioni del plugin `findPlugin`, che il
  motore tiene sempre e la barra di ricerca accende con `RichEngine.find`; trova e
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
  lasciano il segno revisionato a chi chiude il testo. Come in Word la forma
  dice che cosa è successo (inserito sottolineato, tolto barrato) e il
  colore chi è stato: `authors.ts` dà agli autori un posto da 1 a 6
  nell'ordine in cui compaiono nel documento (revisioni e commenti nel loro
  punto, poi i commenti senza un posto; il settimo riprende dal primo), e
  `revisionPlugin` mette sul testo il posto come classe (`rich-autore-3`),
  non il colore, con una barra nel margine accanto a ogni paragrafo che ha
  una revisione (`rich-changed`). I colori sono i ruoli facoltativi
  `--doc-author-*` e `--paper-author-*`, a 4,5:1 sulle due carte; il
  pallino accanto al nome in Commenti e in Revisioni ha lo stesso colore.
- I commenti attraversano la proiezione come elenco `comments` in testa e
  come segni `marker` con `comment` (`id`, `end`) nel testo. Uno tenuto porta
  il commento e le sue parti in `k`, e di lui cambia soltanto `done`; uno
  nuovo è testo semplice, e il ritorno al documento ne fa la parte con un
  paragrafo per riga. Un segno il cui commento non c'è più se ne va con lui.
  Nello schema l'elenco è l'attributo `comments` del documento, così un gesto
  di `comments.ts` cambia segni ed elenco in una battuta (`setDocAttribute`);
  `commentPlugin` dà lo sfondo agli intervalli aperti. Il controllo di
  rilettura accetta l'id durevole e la data UTC che il codec dà a un
  commento nuovo. I commenti si leggono e si scrivono nella scheda Commenti
  dell'ispettore (`editors/rich/side.ts`, la capacità `panels` della
  superficie): i fili nell'ordine del testo (`commentThreads`), con chi,
  quando, il testo commentato e le risposte; un clic sul testo commentato lo
  seleziona. Nuovo, Rispondi, Risolvi ed Elimina ci sono quando il documento
  si scrive; un filo si ridisegna soltanto quando cambia. «Nuovo commento» e
  «Commenti» della barra aprono la scheda. Commenti nuovi soltanto per i
  formati di `RICH_REVIEW_FORMATS` (`docx`).
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
  sola lettura (`track_changes`). La scheda Revisioni dell'ispettore ha
  l'interruttore (una casella con il ruolo `switch`), il nome di chi scrive,
  senza il quale non si comincia, e le modifiche nell'ordine del testo, con
  che cosa, chi, quando e il testo toccato (`changeText`); un clic sul testo
  lo seleziona, Accetta e Rifiuta valgono per una (`resolveChange`) o per
  tutte. Una voce si riconosce da ciò che dice, non dal posto, e resta la
  stessa mentre il testo prima di lei cambia. «Registra modifiche» della
  barra alterna la registrazione, e senza un nome apre la scheda sul nome.
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
  una pagina, e un formato senza la sua (l'ODT) vale `DEFAULT_PAGE`, un A4
  con i margini di 2 cm che Proprietà dice senza scriverlo. La scheda
  Proprietà del documento (`editors/rich/properties.ts`) ha la pagina della
  sezione del cursore (carta coi nomi italiani, orientamento, margini in
  centimetri, colonne) con l'anteprima del foglio (`previewVariables`), il
  formato e la lingua che il file dice per il testo, e il conteggio del
  documento e della selezione, rifatto quando cambia l'uno o l'altra. Mentre
  si registra, o in sola lettura, la pagina si legge e basta.
  `pageVariables` mette la pagina sul testo (`.rich-content`) come variabili
  di dato in punti (`--page-w`, `--page-top`, …), che la carta di Pagina e di
  Lettura legge in `structure.css`: la carta è grande quanto quella vera e
  non si stringe col riquadro. `start` dice dove comincia la sezione: la fine
  della sezione prima lo mostra nel suo nome («Fine sezione · continua»,
  `breaks.ts`), come i salti pagina e di colonna mostrano il loro.
- I fogli sono della vista (`editors/rich/sheets.ts`). `sheetPlan` legge dal
  documento un foglio per salto pagina e per fine di sezione che comincia a
  pagina nuova, con la pagina, l'intestazione e il piè che valgono lì.
  `SheetDesk` misura una volta per fotogramma, e soltanto quando la carta si
  vede: scrive l'altezza degli spazi (`.rich-sheet-gap`, decorazioni
  `aria-hidden`), così il testo dopo un taglio comincia al margine del foglio
  dopo, e disegna i fogli (`.rich-sheet`) dietro il testo con i numeri veri.
  Un foglio il cui testo non ci sta si allunga. In Scrittura i tagli restano
  righe con il loro nome. Lo zoom (`fitScale`, «Adatta larghezza» e «Pagina
  intera» dalla banda di stato con `SurfacePaperFit`) è lo `zoom` CSS della
  scrivania, e le misure lette tornano in px della carta.
- Le voci della banda di stato vengono da `EditorSurface.status`
  (`editors/rich/status.ts`): il foglio del cursore (`RichEngine.sheetOf`), le
  parole di `countText`, le stesse del Conteggio, la lingua e «Registra». La
  superficie dichiara `counts`, e la banda nasconde la view `stats` di
  `fub.stats` finché il documento ha il fuoco. «Registra» è una voce con
  `beat`: quando si accende nello stesso documento entra con un battito della
  molla elastica, e spegnendosi esce come immagine; passando a un documento
  che registra già non batte.
- Mentre si scrive l'intestazione o il piè, il corpo è a 0,45
  (`.rich-desk-running`) e `RichMotion.running` ne segue il cambio in 220 ms;
  passare dall'intestazione al piè non lo riaccende.
- F6 e Maiusc+F6 (`shell.zone.next`/`prev`, dichiarati in
  `crates/fub-host/src/shell.rs`) girano le zone della finestra
  (`shells/scrittoio/zones.ts`): il pannello dei file, il foglio col fuoco,
  l'ispettore, la banda. Dentro il foglio la superficie gira le sue con
  `EditorSurface.zone`: la barra, la ricerca se è aperta, la pagina; quando
  in quel verso sono finite risponde `false` e la shell va avanti. Un tasto
  funzione può stare nudo in una scorciatoia (`fub_abi::rules::keys`), perché
  non scrive.
- L'intestazione e il piè di pagina di una sezione (la storia `default`)
  sono `header` e `footer` accanto a `page`: righe di testo e campi
  `page`/`pages`, `locked` quando la storia ha altro (`running.rs`). Una
  storia che non cambia resta quella che è; una cambiata diventa una storia
  nuova con l'aspetto della prima riga di prima, o con gli stili `Header` e
  `Footer`. Nello schema sono attributi del nodo `section` e del documento.
  Si scrivono sul posto (`editors/rich/running.ts`): un doppio clic nel
  margine di un foglio (`SheetDesk.zoneAt`) o i bottoni della barra aprono
  sopra il margine un campo con i numeri come gettoni, e chiudendolo
  `setRunning` scrive la storia con un passo solo. `page.ts` tiene la forma
  di testo con i codici `{PAGE}` e `{NUMPAGES}` (`runningText`,
  `runningOf`).
- `editors/rich/toc.ts` (`insertToc`) mette prima del blocco del cursore, o
  al posto del sommario che c'è, un paragrafo `TOCHeading` che finisce con il
  campo `toc` e una voce `TOC1`…`TOC3` per titolo, come li scrive Word; il
  codec aggiunge al documento gli stili che mancano. Un sommario scritto da
  Word senza il campo nel suo titolo non si riconosce e resta.

Gli import `prosemirror-*` stanno sotto `editors/rich/`, ma nessun guard lo
verifica ancora come per CodeMirror. Il Markdown non dipende da questa famiglia;
senza la feature `rich` dell'host questi documenti tornano file a byte.

L'aspetto del contenuto
([ADR 0222](../decisions/0222-tre-strati-e-l-aspetto-del-contenuto.md)): le
modalità `document` (Pagina) e `reading` (Lettura) offrono `file` e
`adattato`, `writing` (Scrittura) offre `tema`. I valori del file (carattere,
misura, colore, evidenziato, spazi, interlinea) stanno sull'elemento come
variabili di dato `--file-*`, e li disegna la meccanica di `structure.css`
sotto `look-file` e `look-adattato`; in Scrittura nessuna regola li legge, e
cambiare modalità non ridisegna il documento. Nell'aspetto adattato
`editors/rich/tints.ts` porta ogni colore del file sulla carta del tema con
`theme/adapt.ts`, come decorazione, perché il colore dipende dalla carta e
non dal documento. Le regole della pelle sul contenuto valgono solo sotto
`.look-tema`, e il gate del sanitizer lo fa rispettare. I segni del documento
(revisioni, correttore, ricerca, commenti) prendono i ruoli della carta su
cui stanno, dalla pelle, e la superficie non scrive ruoli del tema
sull'elemento.

Il moto della carta (`editors/rich/rich-motion.ts`) segue la regola del palco:
il testo è sempre al suo posto finale, e si muove la sagoma di ogni foglio
(`.rich-sheet-paper`). `RichMotion` osserva la classe `look-*`,
`data-mode` e la barra, e tiene una fotografia del «prima» aggiornata a ogni
scorrimento e a ogni misura: il paragrafo in cima alla vista resta in cima
(`readingPoint`, `keepReadingPoint`), e ogni sagoma va dal rettangolo che si
vedeva, anche a metà di una corsa, a quello nuovo. Lo zoom e i fogli rifatti
da una modifica scritta li annuncia il motore: lo zoom tiene il centro della
vista, un foglio nuovo esce da quello sopra, di uno tolto resta una sagoma
(`.rich-sheet-ghost`) che si dissolve. Un documento aperto o cambiato da
fuori non muove niente; le coreografie `rich-*` di `bench/motion-rules.mjs`
lo misurano.

Andare a un punto (Trova, la revisione dopo o prima, una voce di Commenti o
di Revisioni) è una transazione col segno `GO_TO`. Il motore la scorre da sé,
anche quando il fuoco è nella barra o nel pannello: se il punto non si vede
già, `RichMotion.goTo` lo porta a un terzo della vista con un valore a molla
che si ferma quando chi legge scorre; arrivato, un anello per riga
(`.rich-goto-ring`, al più quattro) sta sulla scrivania sopra il testo, si
stringe e sfuma in `DURATION.large`, poi se ne va. Trova che resta sulla
stessa occorrenza mentre si scrive la parola non riaccende l'anello. Nel
moto ridotto lo scorrimento salta e l'anello non c'è.

Nelle schede Commenti e Revisioni si muovono le voci soltanto per un gesto
del pannello (aggiungere, rispondere, risolvere, togliere, accettare,
rifiutare): una battuta nel documento rifà l'elenco e basta. La voce che se
ne va esce come immagine (`prepareExit`) in `DURATION.swap`, le altre vanno
al loro posto con `flip`, entro lo stesso tempo quando qualcosa esce, e una
voce nuova entra di 4 px. Il testo sul foglio cambia subito. La coreografia
`rich-review-list` lo misura.

Una vista più stretta di `NARROW_PX` (600 px) tiene la carta larga quanto lei
finché chi legge non sceglie un altro adattamento. La finestra desktop non
scende sotto gli 800 px, quindi lo stretto è il telefono: lì l'ispettore è un
foglio che sale dal basso (`shells/scrittoio/mobile/bottom-sheets.ts`), e il
pulsante `.rich-side-open` sulla carta, col numero dei fili di commento, lo
apre sulla scheda Commenti. Fuori dalla shell del telefono il pulsante non si
vede. Le scene `mobile-document` e `mobile-document-panel` del banco lo
fotografano.

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
