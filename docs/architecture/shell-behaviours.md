# Comportamenti della shell

> **Domanda:** che cosa fa la shell dello Scrittoio sopra le porte generiche,
> senza contratti propri: avvisi, menu, albero, linguette, avvisi nel foglio?
> **Fonti autorevoli:** `apps/client/src/desktop-shell.ts`,
> `apps/client/src/panels/`, `apps/client/src/state/`,
> `apps/client/src/ui/`, `apps/client/src/shells/scrittoio/`.
> **Contesto:** [Frontend e IPC](frontend-and-ipc.md#la-finestra-lo-scrittoio)
> descrive la finestra e le sue parti; questa pagina descrive ciò che la shell
> fa sopra di esse. Nessuno di questi comportamenti ha una porta IPC propria.

## I comportamenti

Ciò che la shell fa sopra le porte generiche, senza contratti propri:

- **Le finestre si aprono dall'inizio.** Le superfici modali (il dialogo del
  kit, i dialoghi della shell, la palette, le preferenze) tengono il fuoco con
  `trapFocus` di `ui/a11y.ts`: il fuoco iniziale va dove deve andare senza far
  scorrere la superficie (`preventScroll`), anche quando quel comando sta in
  fondo a un corpo lungo e resta fuori vista. Il giro del Tab invece scorre, e
  alla chiusura il fuoco torna al comando che ha aperto la superficie. Le
  guardie sono `ui/a11y.test.ts`, `kit/dialog.test.ts` e la scena
  `dialog-long` del banco.
- **Avvisi.** I toast si impilano (al più tre visibili), portano azioni e un
  «Annulla» generico quando l'esito del comando dichiara `outcome.undo`; il
  centro attività tiene lo storico dei lavori. Ogni lavoro ha un nome nella
  lingua dell'interfaccia: lo dà chi l'ha chiesto, appena l'esito del comando
  porta l'id del job (`fub.transfer.queued`), come «Esportazione di «Rossi»
  come PDF» o «Importazione di «Diario.enex»»; un nome che arriva dopo la fine
  del lavoro ridice l'esito ricordato. Il job dei trasferimenti senza un nome
  dato si chiama «Importazione o esportazione» e non scrive frasi
  d'avanzamento, che non saprebbe in che lingua dire; gli altri job si
  chiamano con la loro frase d'avanzamento, o col loro entry point. Cestinare più note insieme non
  ha un «Annulla» unico: l'annullamento del vault disfa l'ultima operazione, e
  le note tornano dal cestino una a una. Avvisi e attività dicono l'ora come
  «adesso», «2 min fa», poi l'ora senza secondi (i secondi nel suggerimento).
  Finché un menu è aperto la pila dei toast si fa da parte (`structure.css`)
  e torna quando si chiude: un menu non sta mai sotto un avviso, nemmeno quello
  della modalità che si apre dalla banda dove scende la pila. Un avviso che
  parla di uno **stato** di una nota (non si salva, la bozza non si scrive, è
  cambiata da fuori, è in conflitto) è uno per nota, la nomina col titolo e si ritira quando lo stato
  finisce; lo storico lo tiene. Il cambio da fuori e il conflitto lo dicono
  la riga del foglio e la barra del conflitto: l'avviso a galla c'è solo se la
  nota non si vede, e se ne va quando la si apre. Un vault senza rilevamento delle modifiche esterne lo dice in testa al
  centro con «Riapri il vault», che scrive ciò che è in sospeso, chiude il
  vault nell'host e lo riapre.
- **Scrittura.** La barra di formato ha tre forme (`editor.toolbar`:
  `compatta`, `completa`, `nascosta`; `chrome.formatbar.visible` spento da
  un Fub di prima vale `nascosta` finché quella non c'è). La shell la mette
  su `#app[data-toolbar]` e, nascosta, `data-formatbar-off`; il comando
  `shell.toolbar.toggle` alterna `nascosta` e l'ultima forma visibile. Sul testo
  scelto compare la mini-barra, tranne con la barra `completa`;
  l'impostazione `editor.minibar` (`auto`, `always`, `menu`, `off`) dice se
  compare anche col tasto destro e su ogni selezione. Il «/» a inizio riga o
  dopo uno spazio apre nella nota il menu dei blocchi e dei comandi, filtrato
  da ciò che si scrive dopo (`editor.slash` lo spegne); con una selezione il
  menu «/» ha il suo campo. Entrambi passano per l'interfaccia della
  superficie testuale, mai per oggetti CodeMirror.
- **Menu delle modalità.** La voce `#status-mode` della banda
  (`shells/scrittoio/frame/status-band.ts`) mostra la figura e il nome della
  modalità del riquadro a fuoco e apre il menu delle modalità, uno solo
  (`state/mode-menu.ts`); sul telefono lo apre il bottone `.pane-mode-current`,
  figlio del foglio dopo la barra di formato, che la cornice mostra solo dove
  la banda non c'è. L'ordine segue il ruolo: le modalità
  `live_preview` come la superficie le dichiara, il sorgente, una riga, la
  lettura; una nota dà Scrittura, Sorgente e Lettura (i Blocchi sono
  confluiti in Scrittura: un id vecchio si riconosce da `SurfaceMode.formerIds`).
  La figura è la `icon` della `SurfaceMode` se `ui/icons.ts` la sa disegnare,
  sennò quella del ruolo (penna, codice, occhio). La scorciatoia è quella del
  comando che porta alla modalità, anche se la persona l'ha cambiata: il
  comando del ruolo per la prima modalità di quel ruolo, nessuna per le altre;
  `shell.mode.blocks` resta e porta anche lui a Scrittura. Il menu dà il fuoco al suo riquadro all'apertura e di
  nuovo alla scelta, perché chiudendosi rende il fuoco a chi l'aveva.
- **Tasto destro negli editor.** Un solo ascoltatore sul riquadro
  (`panels/document.ts`) chiede alla superficie il suo `contextMenu(at)` e lo
  compone in `panels/editor-menu.ts` con le stesse sezioni, nello stesso
  ordine, in ogni editor: ciò che sta sotto il puntatore (prima le correzioni
  del correttore), gli appunti, «Formato», «Trasforma in» e «Inserisci»,
  «Comandi» (i comandi del registro dichiarati per il «/») con le voci dei
  plugin per la nota o il file, e le utilità. Al primo livello stanno al più
  dodici voci, il resto scende in «Altro». Un id d'azione o di comando prende
  nome, icona, stato e accordo da chi lo dichiara, e senza dichiarazione non
  si vede. Il menu si apre senza IPC; Maiusc+tasto destro e un evento già
  gestito (la griglia delle tabelle, il disegno) lasciano passare il menu del
  sistema o quello proprio; il tasto Menu e Maiusc+F10 lo aprono sotto il
  cursore. Sui collegamenti una scheda al passaggio mostra
  la destinazione (`render_embed`) con apri, di fianco e nuova linguetta; un
  collegamento irrisolto offre «Crea». In Live, col cursore in un
  collegamento, Maiusc+Alt+Invio apre la scheda col fuoco sulla prima azione;
  Esc riporta il fuoco nel testo.
- **Cerca.** Il cassetto espone le opzioni che la porta regge (maiuscole,
  regex, tolleranza, parola intera) e «Sostituisci nel vault»: prima il piano
  (`vault.replace` in `dry_run`), poi «Applica». La sostituzione è letterale e
  sensibile alle maiuscole, solo sulle note dei risultati. Una ricerca si
  salva come segnalibro.
- **Scrivania.** Il riquadro vuoto offre nota nuova, nota del giorno, da
  modello (solo se il comando è nel registro), recenti, bozze da recuperare e
  «Da sistemare» (una riga per nota con collegamenti rotti, da
  `vault_health`; se la query fallisce il gruppo manca).
- **Albero.** Ctrl/Cmd-clic e Ctrl-Spazio aggiungono o tolgono una nota dalla
  scelta, Maiusc-clic sceglie l'intervallo fra le note visibili, Esc la
  azzera. Una barra sopra l'albero dice quante sono e offre «Sposta in…»,
  «Sposta nel cestino» e «Deseleziona»; il tasto destro su una nota scelta
  apre lo stesso menu, con «Copia» e «In una cartella nuova». La scelta è solo
  su ciò che l'albero mostra, e ciò che esce dal DOM esce dalla scelta.
  Aprire o chiudere una cartella rifà solo il suo sottoalbero, e si muove
  solo ciò che si vede (`panels/explorer-view.ts`, `explorer-motion.ts`).
- **Binario.** Riordino e nascondimento sono `chrome.rail.order` e
  `chrome.rail.hidden`; la voce «Ripristina ordine e icone predefiniti» li
  riporta a `[]`. Il clic su Cerca o su Note fa la strada della loro
  scorciatoia (`enterPanel` in `panels/sidebar.ts`): la barra si apre e il
  fuoco entra nel campo della ricerca, col testo già scritto selezionato, o
  nell'albero; un secondo clic sull'icona del pannello davanti chiude la
  barra. Sul telefono la barra è un foglio dal basso e il fuoco resta alla
  sua maniglia, perché un campo col fuoco alzerebbe la tastiera.
- **Grafo.** La tela ha i comandi di zoom e «Inquadra tutto»; la legenda è un
  insieme di interruttori di visibilità per gruppo, che si compone con la
  maschera della linea del tempo.
- **Una view principale per finestra.** Rail, palette, menu Vista e
  `OpenView` aprono una view principale (il grafo) una volta sola: se è già
  in un riquadro il fuoco va lì, anche dopo una nota aperta dal grafo nel
  riquadro accanto (`openViewIn` in `state/layout.ts`). Indietro, Avanti e
  «Riapri la scheda chiusa» seguono la stessa regola: se la view che
  rimetterebbero nel riquadro sta già in un altro, il fuoco va lì (`goBack`,
  `goForward`, `reopenClosedTab`, con lo stesso `paneHolding`). Lo specchio
  di un riquadro collegato resta. Un layout salvato con due grafi dalle versioni di
  prima si rilegge col solo primo, e le altre schede restano (`parseLayout`).
- **Linguette.** Rilasciata sul corpo di un foglio, una linguetta si
  divide (quattro bordi) o si sposta in coda al riquadro (centro);
  `splitWithTab` in `state/layout.ts` è la regola pura. Fuori dalla finestra
  una linguetta di nota diventa finestra, solo con
  `platformSupports("multipleWindows")` e dove il motore consegna `dragend`
  fuori finestra. Ogni gesto ha il suo comando nel menu della linguetta.
  Una linguetta non scende sotto `--tab-min` (132 px, una decina di lettere
  oltre figura e chiusura): quelle che non ci stanno scorrono sotto il «+»,
  che si ferma accanto all'elenco e resta sempre a vista, e l'elenco in
  fondo alla striscia le nomina tutte. Il tasto centrale chiude la scheda,
  sulla linguetta come sulla ×, e non la attiva; gli altri tasti che non sono
  il sinistro non fanno niente (`ui/primary-clicks.ts`, lo stesso aiuto
  dell'albero: WebKitGTK manda un `click` anche dopo il centrale). Il secondo
  clic di un doppio clic vale solo sul controllo del primo: la vicina che
  scorre sotto la × appena premuta non si attiva, e il «+» non crea una nota.
  Chiudere un riquadro chiude le sue schede, e Ctrl+Maiusc+T le riapre nel
  riquadro col fuoco, prima quella che si guardava; il testo non salvato va
  sul disco prima che la sessione si chiuda, o si chiede. Un nome troppo lungo si taglia alla
  fine; se due nomi della striscia cominciano uguali (le note del diario,
  due omonime con la cartella in coda) la vista lo divide in testa e coda
  (`panels/tab-names.ts`) e a cedere con l'ellissi è la testa, così resta a
  vista la parte che li distingue. Il nome intero resta nel nome accessibile
  e nel suggerimento.
  Chiusa, aperta o spostata una linguetta, le altre (e il «+») scorrono dal
  posto di prima a quello nuovo in un passo solo: la misura è già quella
  finale dal primo fotogramma e si muove solo una trasformazione; col moto
  ridotto il passo è uno scatto unico (`shells/scrittoio/sheets/tab-strip.ts`).
  Le prime schede di un foglio nuovo arrivano col foglio, e lì non scorre
  niente.
- **Fuoco dopo un ridisegno.** Se un giro di disegno dei riquadri toglie o
  riappende ciò che aveva il fuoco (la superficie della scheda chiusa con la
  ×, l'editor che una divisione sposta), il fuoco torna nel riquadro col
  fuoco: all'elemento di prima se è ancora lì, altrimenti alla superficie
  della scheda attiva, alla linguetta attiva o al riquadro vuoto
  (`keepFocusInPanes` in `state/document-controller.ts`). Un fuoco andato
  altrove intanto non si tocca. Il divisore fra riquadri mosso con le
  frecce si rifà a ogni passo e il fuoco passa a quello nuovo nello stesso
  posto (`layoutTree`). Il lanciatore, aprendosi, chiude il menu aperto
  sotto: un Esc lo chiude, e il fuoco torna a chi aveva aperto il menu.
- **Fuoco dopo un cambio di scheda da tastiera.** Un comando che cambia la
  scheda attiva (Ctrl+W, Ctrl+Tab e Ctrl+Maiusc+Tab, Ctrl+PagGiù/PagSu,
  Ctrl+1…9, Ctrl+Maiusc+T, Ctrl+\ e «Dividi sotto», Ctrl+Maiusc+W,
  Alt+←/→ fra le schede), dalla tastiera, dalla palette o da un menu, porta a
  giro di disegno finito il fuoco nella superficie della scheda che diventa
  attiva: il testo col suo cursore, il foglio di un disegno, la pagina in
  Lettura. Se la superficie non lo prende va sulla linguetta attiva, mai sul
  `body` (`focusShownAfter` e `focusPaneSurface` in
  `state/document-controller.ts`). Vale anche se il fuoco era sulla
  linguetta o nell'albero; un fuoco andato intanto altrove fuori dai riquadri
  (un dialogo, il lanciatore) non si tocca. Un clic su una linguetta lascia
  invece il fuoco sulla linguetta, da cui le frecce della striscia
  continuano. WebKitGTK passa Maiusc+Tab come `Unidentified` col tasto
  fisico in `code`: la tastiera dell'app rilegge dal tasto fisico Tab, Invio
  ed Esc (`namedKey` in `ui/commands.ts`), e Ctrl+Maiusc+Tab arriva al suo
  comando.
- **Fuoco dopo un'apertura.** Quando `openDocument` finisce, il fuoco va
  all'editor del documento aperto, ma solo se nel frattempo nessuno l'ha
  portato altrove: se sta ancora dov'era al gesto, da nessuna parte o in un
  riquadro. Un documento lento da aprire (un `.docx` da impaginare) non toglie
  il fuoco al lanciatore, a un dialogo o a un campo aperti intanto, e il loro
  Invio non finisce nel documento. Se il fuoco sta già dentro il documento
  aperto (la superficie si monta prima che l'apertura finisca, e il Tab della
  lavagna vuota porta al suo primo pulsante), resta dov'è.
- **Tasti col fuoco fuori dal foglio.** Una regola sola, nell'unico `keydown`
  della shell, dopo i gestori locali e i comandi (`ui/off-sheet-keys.ts`,
  applicata da `ui/keyboard.ts`). Una lettera, un Backspace o un Canc premuti
  su un controllo che non scrive (una linguetta, un pulsante, l'albero) e che
  nessuno ha preso si fermano: WebKitGTK li manderebbe alla selezione rimasta
  nel testo della nota, che li scriverebbe portandoci il fuoco. Il controllo
  tiene le sue frecce, Home, Fine, lo spazio e Invio; un campo, una tendina e
  chi apre un campo al primo tasto (una cella) tengono il tasto. Ctrl+Z,
  Ctrl+Maiusc+Z e Ctrl+Y (⌘Z, ⇧⌘Z) premuti su un controllo di un riquadro di
  documento o dell'ispettore (Trova e sostituisci, Revisioni, le linguette)
  fanno un passo della storia della superficie del riquadro col fuoco
  (`EditorSurface.history`, nel Markdown e nel ricco), senza spostare il
  fuoco; il tasto è preso anche quando non c'è niente da annullare. In un
  campo di testo (la casella Trova, un campo delle Proprietà) Ctrl+Z resta
  del campo (`ui/field-history.ts`).
- **Doppio clic nei pannelli.** In ogni albero dichiarativo (le view dei
  pannelli) il secondo clic di un doppio clic vale solo sulla voce del primo,
  con la stessa azione (`guardClickRuns` in `ui/node.ts`): la voce che
  scorre sotto il puntatore quando il primo clic apre una nota e il pannello
  si ridisegna non si apre, e la seconda pressione non sposta il fuoco, che
  resta nell'editor della nota aperta. Il clic da tastiera non cambia.
- **Cassetti sopra i fogli.** Sotto i 960 px l'albero, e sotto i 1200
  l'ispettore, sono cassetti col velo (`desktop-shell.ts`), e il velo è
  modale: la tastiera non arriva a ciò che copre. Scegliere un documento
  dall'albero (clic, Invio, «Apri») chiude il cassetto subito, con lo stesso
  moto di Esc e del clic sul velo, e il fuoco va al documento aperto invece di
  tornare al bottone che aveva aperto il cassetto (`dismissSidePanel` in
  `ui/side-panels.ts`). Qualunque fuoco che entra sotto il velo (l'editor
  raggiunto da una voce dello schema o da un collegamento dell'ispettore, il
  Tab che esce dal cassetto) chiude il cassetto prima che arrivi una battuta,
  e resta dove è andato. Il fuoco sulla rail, sulla barra, in un menu o in un
  dialogo, che stanno sopra il velo, lo lascia aperto.
- **Aperture decise dalla shell.** Le aperture vanno in fila e vince l'ultima
  chiesta. La prima nota di un vault senza schede e la nota d'avvio
  (`files.startup`) la shell le decide da sola, prima di un'attesa
  sull'host: passano a `openDocument` il segno `openingsSoFar()` preso alla
  decisione (`unlessOpenedSince`), e se intanto è stata chiesta un'altra
  apertura non partono e non toccano schede, riquadro, contesto né fuoco.
  Mentre l'editor di un'apertura si carica, linguetta e percorso in testa
  sono già del documento chiesto (`show` ridisegna la testata appena cambia
  scheda).
- **Menu contestuale estendibile.** Le view sulla superficie `context_menu`
  (`ui/context-views.ts`) si aggiungono in coda al menu di una nota, di una
  cartella o di un file dell'albero. Il bersaglio del clic non è nel contesto
  di sessione: viaggia nei `params` di `render_view` e `view_action`, e la
  shell manda solo le chiavi che la view dichiara fra i propri `ParamSpec`
  (`target`, l'id cliccato; `target_kind`, `note`, `folder` o `file`). Dall'albero
  restituito si prendono i `button` e i `list_item` con un'azione, al più
  quattro view e otto voci per view, con trecento millisecondi per rispondere:
  una view che sbaglia o tarda non compare e il menu resta quello della shell.
- **Ricerca nel menu dell'applicazione.** «Cerca» è il sesto menu del
  marchio (`ui/app-menu-search.ts`): un campo con elenco che filtra, senza
  accenti né maiuscole, le voci di tutti gli altri menu, ciascuna col nome del
  suo menu e la sua scorciatoia. Non ha un elenco proprio: legge quelli dei
  menu.
- **Cartelle che si aprono sostando.** Trascinando una nota, una cartella
  chiusa si apre dopo 700 ms sopra di lei (`scheduleHoverOpen` in
  `panels/explorer.ts`); il timer è uno solo, e passare oltre, lasciare o
  finire il trascinamento lo azzera.
- **Rinomina nell'albero.** Un nome rifiutato (non valido, già in uso, errore
  del kernel) riapre il campo con ciò che è stato scritto e la frase accanto,
  `role="alert"`, che sparisce alla prima battuta; il toast non serve. Dopo
  Invio, Esc o un clic su qualcosa che non prende il fuoco, il fuoco resta
  sulla voce e la segue al nome nuovo quando l'albero la ridisegna; un clic su
  un controllo lo lascia a quel controllo.
- **Indice delle impostazioni.** «In questa pagina» (`panels/settings.ts`)
  segna la sezione in lettura. Una voce scelta col clic resta la voce attiva
  anche quando la sua sezione sta nell'ultimo schermo e lo scorrimento non può
  portarla in cima, finché chi legge non scorre di suo (rotella, dito, barra,
  tasti di scorrimento) o non cambia filtro o scheda. Scorrendo a mano è
  attiva l'ultima sezione il cui titolo è salito in cima, e in fondo l'ultima
  visibile.
- **Avvisi dentro il foglio.** Sotto il banner del conflitto (`drawNotices` in
  `panels/document.ts`) il foglio tiene una riga per avviso: errore di
  salvataggio con «Riprova» (`shell.doc.save`), sola lettura mentre una
  cancellazione aspetta la risposta, bozza ritrovata, nota cambiata o
  riscritta su disco con buffer sporco, nota ricaricata, e la modalità
  limitata dei componenti, che è del vault. Quelli derivati dalla sessione
  durano quanto il suo stato; gli altri sono fatti del controllore
  (`state/sheet-notices.ts`) che restano finché non si chiudono, e un
  salvataggio riuscito toglie «cambiato su disco» ma non la bozza. Una nota
  rimossa da fuori chiude la sua linguetta: l'avviso resta sul riquadro che la
  mostrava, con «Ricrea» se c'era testo non salvato, finché non si chiude;
  ricreata la nota con quel testo, la bozza se ne va.
