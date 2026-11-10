# Decisioni del lavoro a piani

Questo file serve al workflow a piani (`/pianifica`, `/orchestra`, vedi
`CLAUDE.md`). Dice che cosa l'orchestratore decide da solo e che cosa chiede,
e tiene il registro delle scelte fatte durante il lavoro, perché il piano dopo
ne tenga conto. Le scelte di architettura vere vanno in un ADR
(`docs/decisions/`); qui resta una riga che lo nomina.

## Il criterio

Il risultato migliore, anche quando costa più tempo, più lavoro o più coder:
fra due strade si sceglie quella più solida, non quella più corta. E poche
domande: l'utente decide ciò che vede e ciò che non si può disfare; il resto lo
decide l'orchestratore, lo scrive nel registro e lo dice nel resoconto. Nel
dubbio su una scelta tecnica si decide, non si chiede.

## L'orchestratore decide da solo

- l'ordine dei task pronti e quanti coder far lavorare insieme (al massimo tre);
- il come che il piano approvato lascia aperto: nomi, tipi, dove sta una
  funzione, la forma di un messaggio d'errore, la forma dei test;
- un piccolo refactor dentro i file del task;
- i formati interni che solo Fub legge e scrive (chiavi delle impostazioni,
  file di cache, il canale fra CLI e app), dentro ciò che il piano ha approvato;
- una dipendenza nuova fra crate del workspace che il piano implica, con il
  diagramma di `docs/architecture/overview.md` e `dependency_invariant`
  aggiornati;
- allargare il perimetro di un task a un file strettamente legato (il suo
  test, un chiamante, un file generato, la pagina di `docs/` che lo descrive),
  anche su richiesta del coder;
- i conflitti banali quando unisce (una riga in una lista, un indice, una
  tabella di testi);
- rilanciare un coder con un'indicazione più precisa, o finire da sé una
  correzione piccola;
- correggere un rosso di fmt, clippy o test causato dal task;
- dividere un task troppo grande in due, senza cambiarne il «Fatto quando».

Ogni decisione presa da solo che un altro piano dovrebbe conoscere va nel
registro.

## Chiede sempre

- ciò che chi usa Fub vede o fa in modo diverso da come dice il piano
  approvato;
- il contratto pubblico: ABI e WIT dei plugin, i comandi IPC del client che il
  piano non nomina, un formato su disco che leggono altri programmi o versioni
  già pubblicate;
- sicurezza e permessi;
- una dipendenza esterna nuova o una licenza;
- cambiare «Fatto quando» o «Fuori scope», saltare o rinviare un task;
- disattivare, saltare o mettere in quarantena un test;
- il merge.

Quando chiede: le domande di un momento tutte insieme, solo quelle la cui
risposta cambia davvero il risultato, con la conseguenza pratica di ogni
scelta e la raccomandazione per prima.

## Registro

La più recente in cima: data · piano · decisione · perché.

- 2026-11-10 · n6 · T71 integrato con guide d'accento e punti della griglia ogni 8 px, accesi di serie come dice il piano; l'aspetto (densità dei punti, griglia accesa di serie) è chiesto all'utente perché il prototipo T26 non lo mostra · Perché: è una scelta visibile su ogni lavagna, e il prototipo approvato ha lo sfondo liscio.
- 2026-11-10 · n6 · L'utente sceglie (a) per il tratto libero negli appunti lasciato fuori da T68: un campo `fub:ink` alla radice della forma, versione sempre 1; task nuovo T94, dopo il lazo (T86) · Perché: è la stessa forma del livello della radice del `.canvas`, e chi non conosce il campo lo ignora senza rompersi.
- 2026-11-10 · n6 · L'utente sceglie (a) per il doppio clic su una scheda mancante o illeggibile (diagnosi di T91): «Ritrova…» o «Apri» al posto del campo del percorso; task nuovo T93 · Perché: il campo del percorso lì non aiuta, i pulsanti di T16 dicono già che cosa fare.
- 2026-11-10 · n6 · T74 integrato: il selettore va sotto la scheda dove a destra non c'è posto, la lista non è virtualizzata, le sezioni si scrivono nell'ordine della nota · Perché: sotto è la variante approvata a 700 px; `kit/list` non virtualizza e 300 righe reggono; l'ordine della nota è quello che la scheda mostra.
- 2026-11-10 · n6 · T56 integrato: Alt+← e Alt+→ restano di `shell.pane.back`/`forward`, che chiedono prima alla lavagna e poi passano alla cronologia del riquadro · Perché: un tasto, un proprietario; un secondo comando sulla stessa chiave avrebbe litigato col registro dei tasti.
- 2026-11-10 · n6 · T59 diviso in due passate (opzione c): prima l'ispettore con una porta finta, poi, dopo T69, tre metodi pubblici del motore (`selection()`, `doc()`, `commitPatches()`) e il cablaggio nella superficie; «Avanzate» resta dentro «Scheda» come nel prototipo · Perché: il motore era in mano a T69 e T53; un commit e un annulla passano da `#commit`, senza una seconda strada per scrivere.
- 2026-11-10 · n6 · T72: «Spargi le pagine…» resta accesa finché un PDF non si è rivelato illeggibile, poi si spegne col perché; la soglia della conferma (200) conta le pagine scelte · Perché: il menu si costruisce senza aspettare pdf.js, e la conferma serve a non creare troppe schede, non a giudicare il file.
- 2026-11-10 · n6 · T91 aggiunto al piano dopo il collaudo dell'area 12, e fatto: i gruppi stanno sempre sotto i fili, le prese di riattacco sopra i punti, la scheda PDF chiude il task di pdf.js 6 · Perché: erano difetti visti sulla 1432; l'ordine del file decideva se un gruppo copriva i fili, e un gruppo sotto è ciò che la persona si aspetta.
- 2026-11-10 · n6 · L'utente sceglie (a) per la misura e l'allineamento del testo lasciati fuori da T50: un task nuovo, T92, con un campo `fub:text` accanto a `fub:ink` e `fub:parts` · Perché: il formato resta JSON Canvas, che Obsidian legge, e il campo nuovo sta fra quelli che gli altri programmi conservano o ignorano.
- 2026-11-10 · n6 · L'utente approva i prototipi T27 (la modifica) e T28 (gli estratti) con le varianti consigliate, sapendo che cambieranno più avanti · Perché: sbloccano T41–T46 e T74–T78.
- 2026-11-10 · n6 · T55: Nascondi e Mostra il navigatore sono due comandi del catalogo, non una spunta in un menu Vista che non c'è; i tratti d'inchiostro non contano per i bordi della mappa · Perché: esiste solo ciò che si può usare, e la mappa delle schede resta leggibile.
- 2026-11-10 · n6 · T69: il bordo del tratto in corso è fatto di quattro lati sulla scena e l'etichetta vive nella vista, in coordinate dello schermo; `#render` non toglie `.canvas-ink-frames` né la cornice della scelta di T66 · Perché: il contorno sulla scheda ridipingeva tutta la scena di S8 e creava nodi a ogni tratto; così S8 resta come prima.
- 2026-11-10 · n6 · T53: l'inerzia dopo uno spostamento viene solo dal dito, non dal
  touchpad; + e − e lo zoom della banda non volano, volano i salti (0, Maiusc+1, Maiusc+2).
  · Perché: il touchpad arriva come rotella e la tela non lo distingue dal mouse; un'inerzia
  nostra raddoppierebbe quella del sistema. I passi piccoli col volo sembrano lenti.

- 2026-11-10 · n6 · T66: la cornice di più schede scelte (non disegnata nel prototipo
  T25) è tratteggiata d'accento come il fantasma del rilascio, e i gruppi tengono le
  maniglie anche se il prototipo non le mostra. · Perché: il piano chiede la cornice, e
  senza maniglie un gruppo non si ridimensiona più; il linguaggio è quello già approvato.

- 2026-11-10 · n6 · T58: «prima i gruppi» resta alla lettera, e la regola
  «più di metà» vince sull'esempio del prototipo. · Perché: è quello che
  dice il piano, l'ordine serve anche al lettore di schermo (T61) e una
  regola scritta si prova; l'esempio del prototipo cadeva proprio sul
  confine della metà.

- 2026-11-10 · n6 · T62: «Aggiungi file…» col selettore del browser
  (`<input type="file">`) invece di `host/dialog.ts`. · Perché: il deposito
  vuole dei `File` come un rilascio, `pickFile` dà un percorso solo; lo fa
  già «Importa file…» dell'esplora, quindi non è una strada nuova.

- 2026-11-10 · n6 · T15b: «Fanne una copia» si offre anche quando il
  deposito si ferma a metà, per i file riusati prima dell'errore. · Perché:
  quelle schede nascono come nel deposito riuscito, e negare la copia solo
  perché un altro file è stato rifiutato lascerebbe la persona senza modo
  di separarle.

- 2026-11-10 · n6 · T47 integrato senza il caso del colore sconosciuto, che
  diventa T47b (sul nucleo); tolto il vecchio selettore dei colori della
  barra di N4. · Perché: il rifiuto viene da `validate_color` del nucleo,
  fuori dalla riga «Tocca» di T47; il colore resta raggiungibile dal menu e
  dalla riga delle opzioni con la stessa lista, quindi un secondo selettore
  diverso sarebbe un doppione.

- 2026-11-10 · n6 · T32b integrato con il ricordo di `reuse` tenuto da
  `host/ipc.ts`, fuori dalla riga «Tocca». · Perché: è l'unico chiamante
  di `writeResource` con la vita di una finestra; un globale di modulo
  non si potrebbe azzerare nei test.

- 2026-11-10 · n6 · T17 integrato con l'avviso di «Togli» senza stile suo
  e Ctrl+] che sulla tastiera italiana non si fa. · Perché: nessun file
  della pelle era nel task (lo stile arriva con T22/T89), e cambiare un
  tasto del catalogo è una scelta che il piano non ha fatto: resta scritta
  per chi rivede i tasti.

- 2026-11-10 · n6 · T73 integrato: `fub:parts` ha un lettore TypeScript in
  proprio accanto a quello Rust, tenuti uguali dai vettori comuni; ADR
  0242. · Perché: le schede leggono il campo senza aspettare il `.wasm`,
  e i vettori scritti a mano sono la prova del formato pubblico; il
  numero dell'ADR va ricontrollato quando N4 e N6 arrivano in `main`.

- 2026-11-10 · n6 · T34 integrato; la banda di T52 segue subito
  `canvas.drop_folder` (correzione dell'orchestratore), e l'avviso della
  cartella esclusa uscirà a ogni deposito in una cartella esclusa (in
  T32b, che tocca lo stesso file). · Perché: banda e deposito devono dire
  la stessa cartella; e un avviso solo la prima volta tacerebbe proprio
  quando la cartella cambia verso una esclusa.

- 2026-11-10 · n6 · T52 integrato: la banda dice la cartella dove il
  deposito scrive davvero oggi, non quella che `canvas.drop_folder`
  prometterà con T34. · Perché: una banda che dice una cartella sbagliata
  inganna; T34 cambia il deposito e `dropFolderOf` insieme.

- 2026-11-10 · n6 · T50 integrato senza misura e allineamento del testo,
  in attesa della risposta dell'utente. · Perché: servono un campo nuovo
  nel `.canvas`, formato che leggono altri programmi (Obsidian): è fra le
  cose che si chiedono sempre.

- 2026-11-10 · n6 · T32 diviso in T32 (il riuso chiesto all'host, fatto) e
  T32b («Fanne una copia» con la scheda ripuntata, e il ricordo della
  seduta per l'host senza `reuse`), stesso «Fatto quando». · Perché:
  l'azione richiede una porta in `engine.ts`, che T32 non poteva toccare
  e che T50 e T52 stavano cambiando; T32b parte dopo di loro. Fino ad
  allora, sul ramo, un file già nel vault non si ricopia dalla lavagna.

- 2026-11-10 · n6 · T40 integrato: le battute di una scheda passano dal
  registro delle superfici della finestra (`onChange` con un id
  `card-editor:<n>`) e la porta le smista, invece di un registro a parte.
  · Perché: una sola strada per le modifiche, la stessa dei riquadri;
  i due casi rari della rinomina e di `release` diretto restano scritti
  nello `Stato:` per T41, che è il primo a usare la porta.

- 2026-11-10 · n6 · T49 integrato: la colonna degli strumenti affianca la
  barra di N4 invece di toglierla subito, e la sola lettura spegne tutti
  gli strumenti che scrivono. · Perché: il menu della penna e le azioni
  della barra hanno già i loro task (T50, T51), e spostarli qui avrebbe
  rifatto il loro lavoro; spegnere e non nascondere segue il prototipo
  approvato.

- 2026-11-10 · n6 · T31 integrato: il riuso è un parametro esplicito del
  trait `ResourceWrite` (non un default nascosto), e il client rifà il
  deposito senza `reuse` quando l'host risponde `bad_args`. · Perché: la
  forma deve dire sempre che cosa fa un deposito, come `expected`; e un
  host di prima rifiuta il campo che non conosce: per lui è un «non so»,
  e nel dubbio si scrive.
- 2026-11-10 · n6 · T48 integrato. (1) I tasti valgono solo coi
  modificatori scritti, anche se Ctrl+Maiusc+A e Alt+frecce smettono di
  fare ciò che facevano. (2) «Entrare e uscire», «La rotella» e «Comandi e
  tasti» passano da `canvas-cards.md` a `canvas-input.md`. · Perché: (1)
  un tasto con un modificatore in più è un altro tasto, e Alt+← è
  Indietro dello Scrittoio (ADR 0223); (2) con T35 e T48 la pagina era a
  573 righe su 550, e quelle tre sezioni parlano della tela, non dei
  renderer.
- 2026-11-10 · n6 · T35 integrato così com'è: anche in `pan` le righe e
  le pagine della rotella si convertono in pixel. · Perché: un mouse che
  manda righe spostava la lavagna di pochi pixel a scatto; la conversione
  è la stessa della lavagna del grafo.
- 2026-11-10 · n6 · T30 integrato: l'impronta calcolata da «lo stesso
  contenuto» si registra con un append fuori dal lucchetto del workspace,
  dopo aver riosservato il file e riletto la coda, invece di rientrare
  nella custodia come diceva il piano. · Perché: è la stessa disciplina
  che `EntryStore::store` già segue (0067) per un dato ricostruibile; il
  caso peggiore è un'impronta persa o una voce vecchia, che la prossima
  scansione rifà, mai una risposta sbagliata (i byte decidono sempre).
- 2026-11-10 · n6 · T33 integrato: il campo «Strumenti della colonna» usa
  le caselle a chip della skin (come `draw.toolbar`), non le caselle
  grigie del prototipo, e a valore vuoto mostra accesi i sette strumenti di
  serie. · Perché: `.setting-features` è condiviso con `draw.toolbar`,
  l'esclusione della sincronizzazione e gli indirizzi permessi; cambiarlo
  per una riga li cambierebbe tutti, e il pannello deve avere un solo
  aspetto per le liste. Le caselle accese dicono che cosa c'è davvero.
- 2026-11-10 · n6 · T36 integrato: la vista ricordata si applica quando
  arriva, ma solo a ciò che nessuno ha cambiato dall'apertura (camera,
  scelta); se la lettura fallisce non si scrive fino alla prossima
  apertura. Le rinominate ripartono dalla vista intera e lasciano una
  chiave orfana: la shell non porta gli stati di vista con il nome. ·
  Perché: lo stato si legge in modo asincrono e non deve coprire un gesto
  dell'utente né uno stato di un'altra versione; spostare gli stati con il
  nome è lavoro della shell, fuori da T36.
- 2026-11-10 · n6 · T33: (1) `canvas.toolbar` si registra in
  `panels/settings.ts` come `draw.toolbar`, con le caselle del prototipo
  approvato (il piano diceva che il pannello disegna le righe da sé, ma per
  le liste serve la registrazione). (2) Un `canvas.drop_folder_path` che
  non vale (vuoto, `..`, assoluto, dentro `.fub/`) vale `Allegati`, il
  valore di serie della chiave; il testo approvato della riga non cambia,
  e a dire dove sono andati i file ci pensa la notifica di T34. T34
  aggiornato: la cartella delle note solo se la pulizia svuota il percorso.
  Perché: fedeltà al prototipo approvato, e una regola sola per il valore
  che non vale (quella di ogni impostazione: vale quello di serie).

- 2026-11-10 · n6 · T16: se il file torna o la scheda cambia mentre
  «Ritrova…» è aperto, la scelta si scarta. Perché: regola di CLAUDE.md,
  un risultato vecchio non sovrascrive lo stato nuovo; il file tornato
  rimonta già la scheda da sé. Primo task di un Haiku a effort xhigh:
  diff pulito, un commento vecchio in `cards.ts` sistemato da me.

- 2026-11-10 · n6 · T14 provato in un Chromium vero (link non seguiti
  fuori dalla scheda attiva, Ctrl+clic li segue, rotella dentro e fuori,
  Esc, visore dell'immagine, «Apri»): un difetto, corretto prima di
  chiudere (il fuoco andava al link e non alla scheda). Perché: i test di
  jsdom non vedono il fuoco vero; la prova nel browser sì.

- 2026-11-10 · n6 · T15 integrato senza il caso «l'host rifiuta un file a
  metà»: va al task nuovo T15b, dopo T32 e T34. Perché: serve un errore
  tipizzato in `canvas-intake.ts`, che T15 non poteva toccare e che T32 e
  T34 cambiano prima; farlo dopo di loro evita conflitti, e intanto
  l'errore si vede come prima (nessuna scheda nasce, i file copiati restano
  nel vault). Ho anche rimesso al suo posto il commento di `isVaultPath`,
  spostato per sbaglio sopra `measuredImage`.

- 2026-11-10 · N6 · T14 integrato tenendo Ctrl+trascinare per spostare
  la lavagna (il piano diceva che Ctrl+clic «oggi aggiunge alla scelta», il
  codice invece sposta): Ctrl+clic senza movimento aggiunge o toglie dalla
  scelta, Ctrl+clic su un link lo segue · Perché: togliere uno spostamento
  che c'era è un cambio non chiesto; così valgono tutte e tre le cose. Una
  scheda ferma ha il contenuto `inert`: Ctrl+clic sui suoi link non li
  trova (solo le schede vive, cioè in vista, li seguono).
- 2026-11-10 · N6 · T13 integrato con gli scostamenti del coder: la
  scelta delle schede vive si rifà anche dopo ogni resa e con lo zoom da
  pulsanti e tasti; la lavagna conta nascosta se un antenato è `[hidden]` o
  `checkVisibility()` è falso (una vista nascosta con `visibility` o fuori
  schermo resta trattata come visibile: le schede in vista restano vive,
  niente si perde); la sezione nuova della pagina si chiama «Quando la tela
  cambia il modo», per non confondersi con «Schede vive e ferme» · Perché:
  ogni cambio di camera e di documento deve finire in una scelta nuova, e
  il caso scoperto costa solo memoria.
- 2026-11-10 · N6 · T29 integrato seguendo «Cosa fare» e non il «Fatto
  quando»: le misure di nascita si arrotondano a interi anche per PDF e
  immagini (PDF 360×509, non 512), e il test di T9 che le agganciava è
  riscritto; anche il rettangolo del gruppo resta coi lati interi, non
  multipli di 8. Superano il registro del 2026-11-02 («480×304»,
  «agganciate a 8 px») · Perché: è A-16 (le misure di nascita non si
  agganciano, le posizioni sì); il «Fatto quando» aveva contato solo il
  foglio.
- 2026-11-10 · N6 · T28 fatto, da approvare: `PLAN-ui/lavagna-estratti.html`
  con otto stati (selettore di nota e di PDF, blocchi, scheda-estratto,
  lettore, fonti, ritaglio, menu) e quattro note «Da decidere guardando»
  (consigliate: al rilascio, la testata con le parti, «Mostra tutto il
  file» nel menu, sotto la scheda a 700 px); una lavagna senza file dice
  una riga nella linguetta Fonti invece di togliere la sezione. · Perché:
  A-26 vuole la pagina prima di T74–T85; la quarta nota nasce dal caso
  limite dei 700 px, e una linguetta vuota senza parole sembrava rotta.

- 2026-11-10 · N6 · T12 integrato con due scostamenti accettati: `watch`
  delle schede ascolta `document_changed/removed/renamed` oltre agli
  `entry_*` (una nota cambiata manda solo `document_*`: col solo
  `entry_changed` la scheda non si rifarebbe mai), e `snapshots.forget`
  lo chiama `bootstrap.ts`, che tiene la cache · Perché: il piano diceva
  `entry_changed` pensando ai file senza formato; il comportamento chiesto
  (la scheda segue il file) vuole tutti e due.
- 2026-11-10 · N6 · prototipo T26 (`PLAN-ui/lavagna-impianto.html`)
  approvato con le varianti consigliate: la colonna del disegno con le
  tendine, il navigatore in basso a destra, l'ispettore chiuso la prima
  volta e poi come lo si lascia, sei strumenti nello spazio Semplice; il
  menu delle penne nella riga delle opzioni è solo da guardare · parole
  dell'utente: «accetto i tuoi consigli per tutte e 5». Perché: A-26, da
  qui T49–T65 possono partire quando le loro dipendenze ci sono.
- 2026-11-10 · N6 (A-15) · Riallineato a `piano/n4-inchiostro` @ bd38a567
  (N4 fino a T22 e T15, N3 dentro) prima di T11, con un merge. Conflitti:
  `PLAN.md` e `DECISIONS.md` restano quelli di N6; `i18n/catalog.ts` e
  `docs/README.md` prendono le due parti. Perché: A-15, T11 lavora sopra
  l'`engine.ts` di N4. Prove sul merge: `check.sh --rapido` verde (un
  rosso noto e instabile, `new-drawing.e2e`, verde da solo), vitest intero
  660 file / 11 620 test verdi.
- 2026-11-09 · N6 · prototipo T26 (`PLAN-ui/lavagna-impianto.html`) fatto,
  da approvare: l'impianto della lavagna copia i valori del disegno con
  classi `canvas-*` nuove (`editors/spatial/` non si tocca, K5); il menu
  delle penne di N4 passa nella riga delle opzioni; cinque note «Da
  decidere guardando», consigliate: la colonna del disegno con le tendine,
  il navigatore in basso a destra, l'ispettore chiuso la prima volta, sei
  strumenti nello spazio Semplice · Perché: T49–T65 aspettano la riga
  «Approvato» (A-26).
- 2026-11-04 · N6 · prototipo T25 (`PLAN-ui/lavagna-schede.html`)
  approvato con le varianti consigliate: titolo sopra la scheda (D-21 (a)
  confermata), gemelle con la luce calda, «Esc per uscire» nella testata,
  nomi delle impostazioni come frasi, notifica col percorso, colori come
  oggi (il filo non prende il colore) · parole dell'utente: «preferisco
  quella del piano originale. Mi piace il piano in schede della lavagna».
- 2026-11-03 · N6 · merge di piano/n4-inchiostro (509772da) in
  piano/n6-lavagna, come chiede A-15 prima di T11: PLAN.md resta quello di
  N6, DECISIONS.md tiene le voci dei due rami in ordine di data, PLAN-
  ui/lavagna-penne.html resta solo su N4; la PR #302 ora punta a
  piano/n4-inchiostro. · Perché: T11, T73 e gli altri task che usano fub-
  canvas-core e fub:ink hanno bisogno della base di N4.
- 2026-11-03 · N6 · le risposte dell'utente alle domande nuove: D-20 (a), i
  CSV in un piano suo che finisce con T88; D-21 (a), il titolo sopra la
  scheda, come Obsidian (da rivedere sul prototipo T25; N4 lo usa per il
  riquadro dell'inchiostro); D-22 (a), lazo e forme adesso sull'inchiostro
  di N4 · le consigliate, accettate dall'utente («ci sto»).
- 2026-11-03 · N4 · D-13 (a), nuova: il cursore dello spessore anche nei
  disegni e nei documenti, non solo sulla lavagna; il task lo scrive il
  pianificatore · parole dell'utente («si»): la stessa penna si usa allo
  stesso modo in tutta Fub.
- 2026-11-03 · N4 · terzo merge di `piano/n3-logica-in-rust` (fino a N3 T17
  e alla fusione di main con #303, `async-executor` 1.14.1) dentro
  `piano/n4-inchiostro`; PLAN.md resta quello di N4 e DECISIONS.md tiene le
  righe di tutti e due · senza main la versione ritirata 1.14.0 teneva rosso
  il controllo delle librerie, e N4 riceve main solo attraverso N3.
- 2026-11-02 · N6 · Le risposte dell'utente a D-1…D-19 (e merge-n3n4,
  ci-soglia): la v1 intera di `lavagna.md` (gli estratti di PDF aspettano
  PdfCraft); i file trascinati vanno dove dice un'impostazione della
  lavagna, che di serie segue quella delle note; «già nel vault» vuol dire
  lo stesso contenuto ovunque, con l'impronta come dato derivato, i byte
  provati uno per uno e dei limiti, e nel dubbio si copia; la pagina del PDF
  sta nello stato della vista; l'inchiostro si attacca alla pagina e alla
  cella; si scrive dentro le schede, sulla stessa sessione del riquadro; S9
  nasce accanto a S3; i sei colori e in più ogni colore esatto; il CSV
  aspetta il motore dei fogli (D-20); la rotella ha un'impostazione;
  Ctrl+clic apre un link; il foglio nasce 480×300; N6 va avanti sopra il
  ramo di N4 e si fonde dopo N3 e N4, con la CI completa e la revisione
  (T90). Restano D-20, D-21 e D-22 · l'utente ha risposto, e dove la
  risposta lasciava la scelta il piano ha preso la strada più sicura: nessun
  byte perso, nessun formato rotto, Obsidian vede la stessa lavagna.
- 2026-11-02 · N6 · T10: le porte della lavagna stanno in `state/canvas-
  intake.ts`. Dall'albero si tengono solo gli id che l'host conferma: una
  domanda sola a `existingDocuments` per tutte le voci, e per i file che
  l'indice dei documenti non conosce (immagini, PDF) una domanda
  `vaultEntries` per cartella invece di un `resourceOpen` per file; una nota
  non confermata si scarta. Dal computer ogni file passa da
  `depositOrReuse`; le notifiche («N file già nel vault, uso quelli», e la
  prima volta «Copiati in cartella/» con «Cambia cartella») dicono anche ciò
  che è stato fatto prima di un errore. `revealSetting` sceglie la scheda
  dalla chiave (permessi → Componenti, scorciatoie → Scorciatoie, il resto →
  Impostazioni) e apre un eventuale `<details>`. Resta in `engine.ts` (fuori
  da T10): se nessuna voce dell'albero è confermata e il trascinamento porta
  anche `text/plain`, nasce una scheda di testo. Perché: un trascinamento è
  un dato che chiunque può scrivere, e un file non si copia due volte.
- 2026-11-02 · N6 · T7: la scheda di foglio legge solo le finestre di celle
  in vista (al massimo 256×128, scorrimento a righe e colonne intere), riusa
  paintCell e le classi del foglio, chiude la sessione da ferma e a destroy
  una volta sola e non chiama mai applyGridBytes; Stale arriva come errore
  "conflict" e si riprova una volta. La copia: in produzione
  writeClipboardText scrive con navigator.clipboard, che non accetta
  un'attesa, quindi la selezione si allarga solo su celle già lette e Ctrl+C
  non scrive niente se ne trova una non letta (l'orchestratore ha rimandato
  indietro la prima versione, che copiava vuote le celle mai lette). In v1
  non mostra grafici, immagini, barre di dati, icone, commenti, riquadri
  bloccati né lo zoom; il bordo d'accento e «Esc per uscire» li disegna la
  tela (data-card-entered). Perché: una copia non deve mai contenere dati
  diversi dal file.
- 2026-11-02 · N6 · T9: le schede portate sulla lavagna nascono in griglia
  per righe (ogni colonna larga quanto la sua scheda più larga), ordinate
  per nome e poi per percorso, agganciate a 8 px e mai sotto 40; il foglio
  nasce 480×304 invece di 480×300 di D-11, perché 300 non è multiplo di 8;
  un'immagine senza misura nasce 480×360 (4:3); un PDF largo 360 con
  l'altezza della prima pagina (senza misura 360×480); un file Craft
  320×160. DROP_SNAP e DROP_MIN_SIZE copiano le costanti di engine.ts (che
  porta il DOM) e un test le tiene uguali. Perché: tutto ciò che nasce sta
  sulla griglia della tela.
- 2026-11-02 · N6 · T8: la scheda web non fa richieste da sé: mostra
  indirizzo e dominio, e l'anteprima solo con «Mostra l'anteprima» (una
  richiesta per clic); l'icona passa solo se è un data: di immagine raster
  (la regola di safeIcon delle note, perché isAllowedLink ammetterebbe icone
  http che farebbero rete); un'anteprima fallita resta sobria, col motivo
  nel suggerimento e il pulsante per riprovare; un indirizzo non valido non
  ha pulsanti. Tutte le schede dicono lo stato in data-card-state e la
  specie in data-card-kind (allineate dall'orchestratore: l'immagine usava
  data-state). Manca una chiave «Scarico l'anteprima…»: per ora «Apro…».
  Perché: una lavagna aperta non contatta nessun sito senza che lo si
  chieda.
- 2026-11-02 · N6 · T6: la scheda PDF disegna la pagina in un canvas fuori
  dal DOM e la copia in quello visibile (la cache chiude le immagini che
  scarta), larga scheda × zoom × densità, al più 2× la scheda; la parte in
  cache è snapshotPart("page-N", larghezza); la pagina di partenza viene da
  #page con pdfPageFromFragment di pdf-view.ts; PgSu/PgGiù/Home/Fine senza
  modificatori; un PDF rotto o cifrato dice «Non riesco a mostrare…». Da
  decidere in T12/T13: un cambio di zoom ridisegna solo se la tela chiama
  resize() o setMode. Perché: una scheda ferma resta leggibile senza tenere
  aperto il motore PDF.
- 2026-11-02 · N6 · T5: la scheda d'immagine riduce alla misura della scheda
  con una sola decodifica (per JPEG, WebP e BMP la larghezza si legge
  dall'intestazione), tiene in cache la parte `whole@<larghezza>` come dice
  canvas-cards.md, mostra l'SVG solo come <img> da blob (mai svg o script
  nel DOM) e, dipinto, lo tiene in cache come canvas; oltre 64 MiB, HEIC e
  AVIF dicono «Non riesco a mostrare…» con «Apri». Rischio: il canvas della
  scheda è una copia del bitmap in cache, quindi la memoria per scheda viva
  raddoppia; lo stile delle classi nuove spetta a T12/T22. Perché: una foto
  grande non pesa sulla tela più della sua scheda.
- 2026-11-02 · N6 · T4: la scheda di nota non rende da sé ma chiede alla
  shell (NoteCardPort.show, più watch e un open facoltativo per «Apri»);
  ogni accensione rifà la resa, una scheda ferma non tiene ascoltatori e
  mostra la resa di prima inerte, un contatore di generazione scarta le
  risposte tardive; lo stato sta in data-card-state; `#A#B` mostra la
  sezione più interna. Perché: la tela non importa l'editor di testo e la
  scheda legge senza mai scrivere il file.
- 2026-11-02 · N6 · T3: depositOrReuse riusa un file già depositato con gli
  stessi byte (ricevuta ReusableReceipt, esito SameFile) invece di
  duplicarlo. Perché: incollare due volte la stessa immagine non riempie il
  vault di copie.
- 2026-11-02 · N6 · T1: il contratto delle schede
  (`editors/canvas/cards.ts`, `docs/reference/canvas-cards.md`). PenQuiet
  non c'è ancora in main: `cards.ts` ha un tipo strutturale suo, `CardQuiet
  { defer(key, work) }`, con la chiave `cards`. `snapshotPart` dà sempre
  `prefisso@larghezza` (multiplo di 32, minimo 32). «Più vicine al centro»
  si misura dal centro della vista al punto più vicino della scheda; se un
  `setMode` lancia, le altre schede cambiano lo stesso e l'errore esce alla
  fine; lo stesso renderer che nomina due volte una specie non è un
  doppione.
- 2026-11-02 · N6 · T2: la cache delle immagini ferme
  (`editors/canvas/card-cache.ts`) ha un tipo suo, `CardCacheSnapshot`,
  uguale per forma a quello del contratto di T1 senza importarlo; percorso e
  parte restano chiavi separate (mai unite in una stringa); rimettere la
  stessa immagine sotto la sua chiave non la chiude; un tetto negativo o NaN
  vale 0, i byte 0, negativi o NaN contano 1. Il tetto di 64 MiB è un valore
  di partenza.
- 2026-11-02 · N4 · T20: l'utente approva il prototipo delle penne con una
  modifica: lo spessore si sceglie con un cursore (la penna da 0,5 a 20
  pixel, l'evidenziatore da 4 a 48), non con Sottile, Medio e Spesso;
  A19–A23 valgono; nei disegni e nei documenti restano i tre spessori finché
  l'utente non dice altro · l'ha chiesto guardando il prototipo, e un
  cursore dà più scelta; il prototipo ora fa anche scrivere col mouse,
  perché l'utente voleva provare le penne e non solo guardarle.
- 2026-11-02 · N4 · Le risposte dell'utente a D-1…D-11: il posto
  dell'inchiostro si decide dopo la prova con Obsidian (fino ad allora il
  `.canvas`; D-12 se si perde); il menu delle penne e la gomma che taglia
  già in N4, dopo il prototipo; due impostazioni spente di serie (ricorda
  «Scrivi col mouse», il dito sposta le schede); su immagini e PDF
  l'inchiostro scala senza deformarsi, sulle altre schede resta fermo; due
  misure, la seconda sul foglio vero con N6; N4 in `main` solo dopo N3, con
  la CI completa · D-1, D-4–D-7, D-9, D-10 e merge-n3n4 sono diverse dalla
  prima opzione con cui il piano era andato avanti: task nuovi T17–T25, T4
  e T5 da rivedere.
- 2026-11-02 · N4 · T11: la toppa ink nel client sta in `operation.ts`, con
  i costruttori dei tratti e `eraseStrokePatches` per la gomma; i vettori di
  T10 passano anche dal lato della shell. `operation.ts` e `ink-record.ts`
  si importano a vicenda, ma usano i valori dell'altro solo dentro le
  funzioni, mai al caricamento del modulo, quindi il ciclo non rompe
  l'ordine ESM. Perché: la tela e il nucleo devono costruire la stessa
  toppa.
- 2026-11-02 · N4 · T10: la toppa `ink` e le operazioni
  `add_strokes`/`erase_strokes` stanno nel nucleo; l'id di un tratto nuovo
  nasce dal seme dell'operazione, così due giri con lo stesso seme danno lo
  stesso file. Due errori nuovi, `E_OP_UNKNOWN_STROKE` ed
  `E_OP_FOREIGN_LAYER`, con le frasi anche in `fub-features` (lavagna.rs e
  lavagna/apply.rs), che altrimenti non compilava. `source.rs` non si tocca:
  il test prova che gli array annidati si accoppiano già per id. I vettori
  ink sono numerati 46–62, dopo il 45 di N3, per non avere doppioni dopo la
  fusione. Misura: su una scheda con 2000 tratti spostare la scheda dà una
  toppa d'annulla di circa 6 MB mentre il file cambia di 1 byte; un tratto
  nuovo aggiunge circa 1,5 KB al file. Perché: un agente deve poter
  aggiungere e cancellare tratti con la stessa strada dell'annulla.
- 2026-11-02 · N4 · T8: l'inchiostro fub:ink sta in fub-canvas-core (modulo
  ink), che ora dipende anche da fub-ink-codec; i campi noti di un tratto
  sono Option<Value>, così un tratto non valido si conserva com'era e il suo
  stato si calcola a parte (Drawn o Kept con il perché); la versione del
  livello resta il Number del file (1.0 resta 1.0). Aggiunti
  InkAnchor::card_of/to_value e InkLayer::is_bare per T10. Perché: leggere
  l'inchiostro non deve mai riscrivere ciò che non si capisce, e 28 vettori
  danno lo stesso esito del TypeScript.
- 2026-11-02 · N4 · T6: il codec dell'inchiostro in un crate suo,
  `fub-ink-codec`, spostato con git mv; fub-scene lo riesporta e non dipende
  più da fub-ink (`SCENE_ALLOWED_DIRECT=[fub-ink-codec, quick-xml, serde]`,
  `INK_ALLOWED_DEPENDENTS=[fub-ink-codec, fub-format-rich]`,
  `INK_CODEC_ALLOWED_DIRECT=[fub-ink]`, clienti `[fub-scene,
  fub-canvas-core]`); in overview.md un quinto diagramma, perché il primo
  era già a 20 nodi · la lavagna e il disegno leggono l'inchiostro dallo
  stesso codec senza tirarsi dietro la scena. Nel check, fub-cli
  `second_process_cannot_take_writer_and_sigint_exits_repl` è caduto per il
  timeout di 10 s sotto carico e passa da solo (3 su 3); i commenti TS
  dicono ancora «di fub-scene».
- 2026-11-02 · N4 · secondo merge di `piano/n3-logica-in-rust` (fino a N3
  T7, il commit e i vettori delle toppe) dentro `piano/n4-inchiostro`;
  PLAN.md resta quello di N4 e DECISIONS.md tiene le righe di tutti e due:
  senza il merge la PR #298 era in conflitto con la sua base e la CI non
  partiva.
- 2026-11-02 · N3 · Le risposte dell'utente a D-1…D-8 e a merge-n3n4: le non
  ovvie sono tre. D-5 (c): il testo di una scheda si registra a pause di
  circa 250 ms, Esc registra invece di buttare (la D-10 nuova chiede
  conferma), il testo ancora nel campo va nelle bozze, e il ritardo della
  bozza diventa una cadenza per ogni documento (T16, T19). D-7 (c): Fub
  riscrive conservando i null dei campi noti, gli array assenti e il posto
  degli archi, l'annulla della tela torna ai byte di prima, e una lavagna
  che non si riscrive senza perdere niente si apre in sola lettura (T20–T22;
  i valori sconosciuti dei campi noti restano fuori, D-9). merge-n3n4 (b):
  N3 entra in main solo finito, dopo la CI completa e una revisione riga per
  riga (T23) · non perdere dati e non cambiare senza dirlo i file degli
  altri programmi vengono prima della comodità, e N3 a metà in main
  lascerebbe due copie della logica.
- 2026-11-02 · N3 · T17: fatto con D-4 (a), solo la misura: il banco
  `tools/ink-wasm-banco/` (nessuna crate nuova nel lock) e `wasm.bench.ts`,
  che si salta senza il `.wasm`. Il primo giro era a macchina carica; la
  pagina tiene i tre giri rifatti con il carico sotto 2,5. La condizione del
  passo 12a non è vera per intero: un evento per chiamata, il WebAssembly è
  4,3 volte più lento col mouse e il 16% con lo stabilizzatore, pari con la
  penna; il riduttore da solo è pari o più veloce. La pagina non dice che
  cosa fare: resta all'utente con D-4.
- 2026-11-02 · N3 · ADR 0234 allineato: la lavagna non è più fra i
  componenti senza bundle, perché da T10 è il bundle fub.lavagna. Perché:
  l'ADR deve dire com'è fatto il codice.
- 2026-11-02 · N3 · T12: gli strumenti MCP fub_canvas_create e
  fub_canvas_apply chiamano canvas.create e canvas.apply con gli id scritti
  come costanti, come note.create, perché fub-cli non dipende da fub-
  features; fub_canvas_apply risponde {doc, dry_run, outcome} in prova e
  {doc, dry_run, created, revision} applicato, e check_read più check_write
  valgono anche in prova (in sola lettura nemmeno la prova passa); l'MCP non
  passa il seme, quindi gli id nuovi vengono dalla revisione. Se
  fub_canvas_create crea un nome diverso da quello provato, lo dice invece
  di tacerlo. Perché: un agente crea e riempie una lavagna con le stesse
  regole di accesso degli altri strumenti.
- 2026-11-02 · N3 · T11: canvas.create scrive come sorgente la lavagna vuota
  del nucleo (patch_source su Canvas::default, riletta con Core::open prima
  di scrivere), perché il nucleo non ha una funzione apposta; senza nome
  prende il primo libero («Lavagna», «Lavagna 1», in inglese «Whiteboard»),
  e un nome preso è un conflitto che non sovrascrive. Il codice dei nomi è
  una copia di drawing.create, perché le feature non si importano fra loro;
  l'annulla porta la lavagna nel cestino e richiede la feature commands,
  come drawing.create. Perché: un file nuovo è già una lavagna che il nucleo
  apre.
- 2026-11-02 · N3 · T10: il componente «Lavagna» (fub.lavagna) porta
  canvas.apply; il seme degli id usa l'Fnv1a del contratto; spegnere
  fub.lavagna toglie solo canvas.apply, e il test fub-cli
  spegnere_la_lavagna_dice_che_la_penna_non_serve_piu è stato aggiornato di
  conseguenza (opzione a: dice con precisione che cosa sparisce, non è
  indebolito). Resta da allineare l'ADR 0234, che mette ancora la Lavagna
  fra i componenti senza bundle. Perché: la lavagna diventa un componente
  che si scrive come gli altri, e un componente spento toglie solo ciò che
  porta.
- 2026-11-02 · N3 · T9: lo specchio a caso fra fub-canvas-core e la lavagna
  TypeScript ha 2051 casi (1333 sorgenti, 718 prove con toppe) in una
  fixture di 501 KB, un sorgente per riga con le sue prove per stare sotto i
  512 KB. Ha trovato una divergenza (26 casi): in una toppa il TS trattava
  un campo noto a null diversamente dal nucleo Rust; corretto il lato TS
  secondo R7 (null vale come assente, sia nel dopo sia nel confronto del
  prima), vettori 44 e 45.
- 2026-11-02 · N3 T7 · il commit in Rust (`fub-canvas-core/src/commit.rs`:
  `Core`, `Committed{source,inverse,edit}`, `Edit::between/apply` ai confini
  di carattere, `CommitError` Stale/Invalid/Rejected/Unstable con
  `reason()`) e 43 vettori in `apps/client/src/__fixtures__/canvas-patches/`
  letti da Rust e da TS; in TS `canvasCommitOutcome` accanto a
  `commitCanvasPatches`, che non cambia; `parseNode` di `model.ts` allineato
  a Rust (limiti solo per il campo del tipo della scheda, niente limite
  sullo sfondo) · i due lati devono dare gli stessi byte; rischi: il TS ora
  scrive i campi nuovi nell'ordine di Rust (stesso valore, byte diversi),
  un'immagine con le chiavi in un altro ordine e uno sfondo di 9000 byte ora
  si aprono; manca un vettore «unstable»; una lista di toppe vuota fa in
  Rust un commit che non cambia niente, in TS dà null.
- 2026-11-02 · N4 T9 · la lettura e la scrittura dei record nel client
  (`editors/canvas/ink-record.ts`): `readInkLayers` nell'ordine dei vettori
  di T5, `inkLayerWritable`, `defaultInkLook(zoom, pressure)` con la biro di
  4 px dello schermo, `strokeRecord` coi rifiuti `full`, `failed`, `empty`,
  `toDry` e `dryStroke` con la cache dei percorsi; `ink-vectors.test.ts`
  legge i 28 vettori · lo strato chiama `look()` all'inizio del tratto: T12
  deve applicare `joined` ai pezzi `continued`.
- 2026-11-02 · N4 T7 · il kit della prova con Obsidian in
  `tools/prova-obsidian/` (una lavagna con l'inchiostro, `confronta.mjs` che
  confronta per valore prima e dopo, coi suoi test `node --test`) e la
  sezione «Obsidian» in `canvas-ink.md`; si confronta anche il `fub:ink` di
  un arco come prova sui campi sconosciuti; il test del kit non entra in CI,
  si lancia a mano · i nomi dei menu di Obsidian nel README sono in inglese
  e non verificati su un Obsidian vero.
- 2026-11-02 · N4 · merge di `piano/n3-logica-in-rust` (fino a T8) dentro
  `piano/n4-inchiostro`, con un merge e non un rebase: PLAN.md resta quello
  di N4, DECISIONS.md e `docs/README.md` tengono le righe di tutti e due ·
  senza, la PR #298 era in conflitto con la sua base e la CI non partiva; va
  rifatto quando N3 cambia di nuovo PLAN.md o DECISIONS.md.
- 2026-11-02 · N4 T5 · la forma `fub:ink` in `docs/reference/canvas-ink.md`
  con 28 vettori, uno per file, in
  `apps/client/src/__fixtures__/canvas-ink/`; ADR 0238 «proposta» (0236 è di
  K3, 0237 di N3 T15); le ragioni si guardano nell'ordine tool, anchor,
  color, brush, ink; un canale sconosciuto vale `ink`; id vuoto, tratto non
  oggetto, `fub:ink` non oggetto o `v` assente fanno il livello estraneo,
  con `strokes: []`; i livelli nell'ordine di `nodes`, poi la radice; i
  campi sconosciuti dell'ancora restano dopo kind, width, height · T8 in
  Rust e T9 in TypeScript leggono gli stessi vettori e devono dire le stesse
  ragioni.
- 2026-11-02 · N4 T4 · lo strato d'inchiostro
  (`editors/canvas/ink-layer.ts`, `ink-paint.ts`): una penna alla volta,
  perché la sessione fa un tratto alla volta (la seconda è fermata e
  ignorata); i suoi eventi si fermano con `stopImmediatePropagation` prima
  della lavagna, i click solo con `detail > 0`; un SVG annidato per ogni
  gruppo consecutivo di tratti con la stessa misura; `InkPathCache` con
  `sweep()`; `INK_ASPECT = "none"` (D-9 a); `data-ink-stroke` sui tratti per
  la gomma di T13 · la lavagna non vede mai un tratto come un trascinamento;
  rischio: l'SVG sta in `inset: 0` e un bordo vero della scheda (T16) lo
  sposterebbe.
- 2026-11-02 · N4 T3 · la scheda sotto il tratto
  (`editors/canvas/anchor.ts`): solo geometria sulle coordinate della
  lavagna, il riquadro del tratto allargato di metà spessore, nessun `NaN`
  (punti non finiti saltati, riquadro che trabocca = tratto libero) · lo
  chiede lo strato una volta sola, quando la penna si alza.
- 2026-11-02 · N4 T1 · la politica del mouse in `fub-ink` (`roles.rs`,
  `setMousePolicy`): `ink` di serie, `ignore` lascia il tasto principale a
  chi sta sotto; vale dal prossimo appoggio; un puntatore di tipo
  sconosciuto segue il mouse · la regola di serie resta com'era per i
  disegni, e la lavagna può tenere il mouse per selezionare.
- 2026-11-02 · N4 T2 · `PenQuiet` (`ink/quiet.ts`) con la coda per chiave letta viva mentre gira (un `defer` da un lavoro toglie il vecchio della stessa chiave e gira subito; un `enter` da un lavoro ferma il giro), `dispose` azzera il conto; `idleSchedule` (`ink/dom/idle.ts`) usa la `Lifetime` di `ui/lifetime.ts` con un solo smontaggio per tutte le richieste in attesa · così un lavoro vecchio non gira mai dopo uno nuovo della stessa chiave, e una lavagna aperta a lungo non accumula smontaggi; più errori nello stesso giro: si rilancia il primo e gli altri si perdono, come in `dom/pointer-adapter.ts`.
- 2026-11-02 · N4 · piano: il formato `fub:ink` sulla lavagna (campi nel
  `.canvas`, strada A, con la stringa dei punti della §5 dei disegni e la
  misura della scheda al momento del tratto) è un'assunzione del
  pianificatore, scritta di notte: l'utente la conferma (D-1, D-2) prima
  dell'ondata 2, perché altri programmi leggeranno il file e cambiarlo dopo
  vuol dire una `v: 2` e una conversione.
- 2026-11-02 · N4 · piano: il codice dei punti e dei pennelli (`ink.rs`,
  `brush.rs` di `fub-scene`) passa in un crate piccolo, `fub-ink-codec`, che
  dipende solo da `fub-ink`; il nucleo della lavagna lo usa con
  un'eccezione nominata nell'invariante delle dipendenze: il nucleo non può
  portarsi dietro il lettore XML dei disegni, e una seconda copia del codec
  sarebbe una divergenza da tenere d'occhio per sempre.
- 2026-11-02 · N4 · piano: ogni tratto è una toppa `ink` sul suo livello
  (`LayerRef`: la lavagna o una scheda), non un `upsert-node` della scheda
  intera: con 2000 tratti l'annulla terrebbe due copie della scheda intera
  per ogni tratto (la misura dei byte la fa T10).
- 2026-11-02 · N4 · piano: `PenQuiet` è puro, con lo scheduler passato da
  fuori e una chiave per lavoro: il nucleo dell'inchiostro non usa globali
  del DOM (ADR 0204), i timer passano da una `Lifetime`, e due richieste per
  la stessa cosa ne fanno una.
- 2026-11-02 · N3 T8 · operazioni d'intento (`ops.rs`): un id che non è né
  scheda né arco in `remove`/`set` dà `UnknownEdge`; `set` vale anche sugli
  archi; un id dato già preso o ripetuto in `ids` dà `DuplicateId`; `reorder
  {ids}` porta in cima gli id dati, nell'ordine dato; gli id nuovi vengono
  da SplitMix64 sul seme (`IdSource`, sedici cifre esadecimali); ogni scheda
  e arco messi passano `Canvas::validate`; l'`at` delle `remove-node` è la
  posizione all'inizio della serie, anche fra due operazioni; i vettori
  hanno l'esito `malformed` per un'operazione che non si legge · così il
  TypeScript (T14, T16) rifà lo stesso generatore e le stesse posizioni dai
  vettori, e l'inversa rimette ogni scheda al suo posto.
- 2026-11-02 · N3 · T5: `patch_source` ritocca il sorgente con uno
  scanner suo, più severo di quello TypeScript (rifiuta virgola finale e
  valori vuoti, si ferma a 256 livelli, `SourceError::TooDeep`); gli archi
  nuovi si scrivono nell'ordine di R10 (fromNode, fromSide, fromEnd,
  toNode…), costruito in `edge_value` e non dall'ordine della struct; una
  radice ricomposta senza `edges` lo riceve in fondo, come in TypeScript; un
  array che non corrisponde al modello di prima si riscrive per intero. Le
  schede si confrontano come struct e diventano JSON solo se cambiate: 2000
  schede, una cambiata, ~0,8 ms in release (macchina carica). Il confronto
  per valore è uno solo, `patch::same_value`, usato anche dal ritocco.
  Perché: stessi byte di TypeScript dove TypeScript segue R1–R10; T7 porta
  il TypeScript all'ordine R10 degli archi e lo specchio di T9 lo controlla.
- 2026-11-02 · N3 · T6: `PatchError` ha una variante per ogni rifiuto
  (`Stale` con il soggetto, `AtOutOfRange`, `NodeHasEdges`,
  `MissingEndpoint`, `NotAPermutation`), tutte con la posizione della toppa,
  dove TypeScript dà solo `null`; `after: null` si legge solo da `null`;
  `at` negativo o con la virgola è un errore di lettura (TypeScript lo
  scarta nella bozza); `draft` non chiama `Canvas::validate`, come
  `canvasDraft`: il modello di dopo lo controlla il commit (T7). Portate
  anche `upsert_node_patch` e le sorelle, che servono a T8. Restano come in
  TypeScript l'inversa di un inserimento senza `at` e l'arco rimesso in
  fondo, fissati da un test. Perché: errori tipati e stessa forma JSON.
- 2026-11-02 · N3 · T3: in Rust R2 è un solo visitor (`SafeInteger`) che
  porta il nome del campo nell'errore, R7 un `null_as_empty` su `nodes` ed
  `edges`; il nucleo espone `read::is_blank` (la regola di
  `isBlankCanvasSource`) e `model::MAX_SAFE_INTEGER`, nessuna variante nuova
  di `CanvasError`. R3, R4 e R5 li rifiutava già `serde_json`: i test li
  fissano. Fuori da R1-R10 la validazione diverge ancora: TypeScript limita
  `background` a 8192 byte e `subpath`/`url` su ogni scheda, Rust no e solo
  sul loro tipo; per la regola «nel dubbio si apre» si allinea il
  TypeScript a Rust in T7, e lo specchio di T9 lo controlla.

- 2026-11-02 · N3 · T4: `js.rs` espone, oltre a `js_number`, `js_string`,
  `encode` ed `encode_pretty`, anche `js_json_number`, `is_array_index` e
  `js_entries` (l'ordine delle chiavi di JavaScript, che serve a T5 per
  R10); `encode_pretty` non mette il `"\n"` finale, lo aggiunge chi scrive il
  file; `js_number` su `NaN` e infiniti fa come `String(x)`. Il pareggio
  esatto si cerca sull'espansione decimale solo quando è possibile
  (`x = M·2^E` con `E = unit − 1`): in release un numero costava circa 2 µs,
  ora 0,1-0,3; i test confrontano la strada veloce con l'espansione intera su
  202 000 numeri, e fuori dal repo 400 000 numeri contro Node non danno
  differenze.

- 2026-11-02 · N3 · T1: `fub-canvas-core` ha un blocco suo nel grafo delle
  dipendenze di `overview.md` (il quarto diagramma), perché il primo era già
  a 20 riquadri; `read.rs` tiene il BOM e gli spazi come li leggeva
  `fub-format-canvas` (le regole di R1-R8 sono di T3); il nucleo riesporta
  `PresetColor` e `parse`, e `fub-format-canvas/src/model.rs` è un `pub use`
  del nucleo più `FORMAT_ID` e `SCHEMA_VERSION`. Il controllo per
  `wasm32-unknown-unknown` sta nel giro completo di `scripts/check.sh` e nel
  job `invariants` della CI, che l'orchestratore ha aggiunto.

- 2026-11-02 · N3 · T2: in TypeScript i controlli di R3, R4 e R5 stanno
  nello scanner di `source-edit.ts` (`inspectCanvasJson`), una passata sola
  sul testo dopo `JSON.parse`, e non in un reviver: misurato a 2000 schede,
  il reviver portava la lettura da circa 17 a 23 ms, lo scanner la lascia a
  13-14. La regola del vuoto (`isBlankCanvasSource`) è una sola, per il
  lettore e per il riscrittore. `backgroundStyle` è qualunque stringa senza
  limite suo (resta quello di 16 MiB del file), come in Rust; `-0` si legge
  `0`, come un intero Rust.

- 2026-11-01 · regole · L'orchestratore e i coder decidono da soli il come
  tecnico, i formati interni, le dipendenze fra crate del workspace e i file
  legati al task; «Chiede sempre» resta per ciò che si vede, il contratto
  pubblico, sicurezza, dipendenze esterne, scope, test e merge; il criterio è
  il risultato migliore, non la strada più corta · fonte: l'utente («mi stai
  facendo troppe domande … ti voglio più autonomo»; «voglio sempre ottenere il
  risultato migliore, non importa se ci mettiamo più tempo o più risorse»).
- 2026-11-01 · K1 · L'assunzione A2 era sbagliata: un campo in coda a un
  record rompe i plugin compilati prima (il guest a undici campi del manifest
  non si istanzia nell'host a sedici); `0.2.0` non è pubblicata e K1 resta, ma
  dal primo rilascio un record pubblicato non cresce e le novità passano da
  interfacce nuove · fonte: prova dell'orchestratore con `ping-wasm` compilato
  su `d235d3f6`, decisione con l'utente; ADR 0235. Fuori dal Tocca, con
  l'OK dell'utente: la riga dell'esempio in `exclude` del `Cargo.toml` della
  radice e la frase sull'additività in `docs/architecture/document-model.md`.
- 2026-11-01 · K1 · Via MCP accendere e spegnere un componente con `apply`
  vogliono tutto il vault fra le radici di scrittura, come un piano che non
  dice quali note tocca: un componente cambia il comportamento di tutto il
  vault · fonte: revisione dell'orchestratore su T4 (il coder chiedeva una
  radice qualsiasi); ADR 0234.
- 2026-11-01 · K1 · `fub-cli` dipende da `fub-componenti` (con la freccia nel
  grafo di `overview.md`): i tipi del risolutore (`Stato`, `Effetto`,
  `Perche`, `Errore`) non sono riesportati da `fub-features` e la CLI li
  usa nelle firme e nei `match` · fonte: blocco del coder di T4, scelta
  dell'orchestratore (l'alternativa toccava `fub-features`, fuori dal Tocca).
- 2026-11-01 · K1 · La mappa vera (`fub-features::componenti`): le righe
  senza feature Cargo sono 7, non 4 (anche `fub.core`, `fub.maintenance`,
  `fub.importers`, che oggi si compilano sempre); `SOLO_DELLA_MAPPA` è
  `fub.markdown`, `fub.dizionari`, `fub.penna` e i due motori, ognuno col suo
  perché; una feature marcatore nuova `http-client` per le righe di sync,
  publish, updates e linkcard; `rich` e `xlsx` portano con sé i loro motori ·
  fonte: report del coder di T3; il codice vince sul «Fatto quando» del piano.
- 2026-11-01 · K1 · I requisiti che esistono solo per la mappa
  (`fub.markdown`, `fub.dizionari`: nucleo e componenti senza bundle) stanno
  nella riga di `fub-features::componenti`, non nel manifest; il manifest tiene
  i `requires` di oggi, perché il kernel soddisfa un requisito solo col
  `provides` di un bundle montato (`provider_of`) · fonte: risposta
  dell'utente al blocco del coder di T3; altrimenti le feature delle note non
  si monterebbero più.
- 2026-11-01 · K1 · T3 tocca anche i due blocchi di `mount.rs` che montano
  `fub.rich` e `fub.xlsx` fuori dal ciclo ufficiale (~376–404), solo per i
  campi della riga; righe anche per `fub.core` e `fub.maintenance` (il nucleo
  deve avere una riga); `fub.draw` resta fuori dal `default` come oggi e non
  richiede `fub.markdown` · fonte: risposta dell'utente; il resto deciso
  dall'orchestratore (il codice vince).
- 2026-11-01 · K1 · `Delivery` nel JSON è un enum con tag interno `kind`
  (`{"kind":"download","url":…}`), e la validazione di `fub-wasm-host` accetta
  lo sha256 in esadecimale maiuscolo o minuscolo; la conversione WIT → Rust di
  0.2.0 sta in `translate.rs`, `compat.rs` (ABI legacy) prende i default ·
  fonte: report del coder di T1.
- 2026-11-01 · K1 · Le regole di `fub-componenti` che il piano lasciava aperte:
  un requisito offerto via `provides` da più componenti è un errore della mappa
  (`RequisitoAmbiguo`); `attivi` segue i `requires` anche dal nucleo;
  `applica_profilo` svuota `in_attesa`; `Richiesto { da }` elenca i dipendenti
  a catena, e `spegni_con_dipendenti` dà `Nucleo` se la catena lo tocca;
  `perche` ha anche `Nucleo` e `Sconosciuto` · fonte: report del coder di T2,
  accettato dall'orchestratore; chi costruisce la mappa (T3) non può dichiarare
  due offerenti dello stesso requisito.
- 2026-11-01 · K1 · T1 tocca anche `crates/fub-abi/src/lib.rs` (`ComponentKind`
  e `Delivery` nel `pub use`, per `superficie_della_radice`) e
  `apps/client/src/host/enums.generated.ts`, solo rigenerato con
  `UPDATE_MIRROR=1 cargo test -p fub-abi --test ts_enums` · fonte: risposta
  dell'utente al blocco del coder; un enum senza payload in `fub-abi` porta
  sempre con sé la sua riga nel derivato TS.
- 2026-11-01 · K1 · Le PR #261–#269 (N13, N1, N2, K0) sono tutte in `main`:
  #269 è stata unita con lo stack intero, le altre chiuse perché contenute,
  #264 unita il 31/10 · fonte: `gh pr list`; nessun task di K1 aspetta una PR.
- 2026-10-31 · K0 · Il livello 3 della consegna sono le **edizioni**; niente
  librerie caricate a runtime (ADR 0233) · fonte: `piani/STATO.md`, risposte
  del 31/10 mattina; in K1 è il caso `Delivery::Edition` del manifest.
- 2026-10-31 · K0 · La tolleranza di R1 sta in
  `apps/client/bench/webview/budgets.json` (residuo 50 MiB, pendenza 1 MiB a
  giro; nella CI 480 e 20) · fonte: `piani/STATO.md`; è il metro di «spento non
  costa» per i task che misurano.
- 2026-10-31 · N2 · Il server MCP sta in `fub-cli mcp` sulla stessa
  `Connection` (passa dall'app se tiene il vault), protocollo scritto a mano
  (stdio, JSON-RPC sincrono), niente `rmcp` (ADR 0232,
  `docs/reference/mcp-server.md`) · fonte: `piani/STATO.md`; gli strumenti
  nuovi (i componenti di K1) seguono la stessa forma e i nomi `fub_*`.
- 2026-10-31 · N2 · Senza `--automation-write-root` il server è in sola
  lettura; senza `--automation-read-root` si legge tutto il vault;
  `fub_invoke` senza `apply` è una prova · fonte: `piani/STATO.md`; vale anche
  per accendere e spegnere componenti via MCP.
- 2026-10-30 · tasto destro (piano 2) · Le parole dei componenti sono
  Accendi, Spegni, Serve a…, Non serve più, Togli, Tienili, «Accendi…»; regola
  12: un componente spento non ha voci · fonte: `piani/STATO.md`; K1 le usa
  nei testi della CLI, K2 nel client.
- 2026-10-31 · piani · Le domande aperte dei piani seguono il loro
  «Consiglio» se l'utente non dice altro · fonte: `piani/STATO.md`,
  «Questions for the user».

- 2026-10-31 · workflow · Il piano vive in `PLAN.md` (e il prototipo in
  `PLAN-ui/`) sul branch del piano, e se ne va con l'ultimo commit prima del
  merge · una sessione sul web vede solo ciò che è su GitHub; dopo il merge
  restano il codice e questo registro.
- 2026-10-31 · workflow · Una PR in bozza ha la CI corta (Linux); segnata
  pronta ha la CI completa. I banchi del client girano sulle PR pronte solo se
  cambia `apps/client/`; su `main` gira sempre tutto · Windows, macOS e banchi
  costano tanto e servono una volta per piano, prima del merge.
- 2026-10-31 · workflow · I coder non lanciano altri agenti, non pushano e non
  toccano la CI; pusha solo l'orchestratore, una volta per task unito · un solo
  punto che integra, e la CI di ogni push copre tutto ciò che c'è prima.
