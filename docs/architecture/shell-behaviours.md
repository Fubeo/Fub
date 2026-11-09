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

- **Avvisi.** I toast si impilano (al più tre visibili), portano azioni e un
  «Annulla» generico quando l'esito del comando dichiara `outcome.undo`; il
  centro attività tiene lo storico dei lavori. Cestinare più note insieme non
  ha un «Annulla» unico: l'annullamento del vault disfa l'ultima operazione, e
  le note tornano dal cestino una a una. Avvisi e attività dicono l'ora come
  «adesso», «2 min fa», poi l'ora senza secondi (i secondi nel suggerimento).
  Un vault senza rilevamento delle modifiche esterne lo dice in testa al
  centro con «Riapri il vault», che scrive ciò che è in sospeso, chiude il
  vault nell'host e lo riapre.
- **Scrittura.** Con la barra di formattazione spenta
  (`chrome.formatbar.visible`) compare la mini-barra sulla selezione;
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
  lettura; una nota dà Live, Blocchi, Sorgente e Lettura. La figura è la
  `icon` della `SurfaceMode` se `ui/icons.ts` la sa disegnare, sennò quella
  del ruolo (penna, codice, occhio). La scorciatoia è quella del comando che
  porta alla modalità, anche se la persona l'ha cambiata: `shell.mode.blocks`
  per i Blocchi, il comando del ruolo per la prima modalità di quel ruolo,
  nessuna per le altre. Il menu dà il fuoco al suo riquadro all'apertura e di
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
- **Binario.** Riordino e nascondimento sono `chrome.rail.order` e
  `chrome.rail.hidden`; la voce «Ripristina ordine e icone predefiniti» li
  riporta a `[]`.
- **Grafo.** La tela ha i comandi di zoom e «Inquadra tutto»; la legenda è un
  insieme di interruttori di visibilità per gruppo, che si compone con la
  maschera della linea del tempo.
- **Linguette.** Rilasciata sul corpo di un foglio, una linguetta si
  divide (quattro bordi) o si sposta in coda al riquadro (centro);
  `splitWithTab` in `state/layout.ts` è la regola pura. Fuori dalla finestra
  una linguetta di nota diventa finestra, solo con
  `platformSupports("multipleWindows")` e dove il motore consegna `dragend`
  fuori finestra. Ogni gesto ha il suo comando nel menu della linguetta.
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
  `role="alert"`, che sparisce alla prima battuta; il toast non serve.
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
  mostrava, con «Ricrea» se c'era testo non salvato, finché non si chiude.
