# Changelog

Le modifiche degne di nota seguono
[Keep a Changelog](https://keepachangelog.com/it-IT/1.1.0/) e il versionamento
descritto in
[`docs/development/versioning-and-releases.md`](docs/development/versioning-and-releases.md).

## [Non rilasciato]

Non ci sono rilasci pubblicati. Il precedente release candidate è stato ritirato;
la sezione seguente raccoglie le modifiche per la prima versione.

### Aggiunto

- vault locali basati su file Markdown e frontmatter;
- parsing, modello comune, rendering e serializzazione tramite provider;
- wikilink, tag, backlink, ricerca full-text e Graph View;
- editor CodeMirror, live preview e modalità di lettura;
- motore testuale condiviso con profili Markdown, plain text e formula;
- diagrammi Mermaid in Live, Lettura e note trascluse, con sorgente recuperabile,
  errori visibili e resa coerente con la luce del tema;
- colorazione dei linguaggi nei blocchi di codice Markdown, caricata su richiesta;
- cestino, bozze, versioning, organizzazione e indici persistenti;
- snapshot e ripristino dei byte originali degli allegati binari, senza
  conversioni di BOM o terminatori di riga;
- comandi, query, view ed eventi attraverso registri generici;
- feature ufficiali abilitate con feature Cargo indipendenti;
- contratto WIT `fub:abi@0.2.0` con snapshot congelati e famiglia Grid v1
  verificata su provider nativo e proxy WASM;
- provider WASM inbound reali di indice ed eventi, con feed, query, flush,
  close, `up_to_date`, reconcile e consegna notifiche nello stesso registro
  del nativo;
- catalogo firmato di plugin e temi, con installazione, aggiornamento,
  rollback e revoca senza cancellare dati utente;
- acquisizione browser e CLI con template condivisi, pairing esplicito,
  policy callback deny-all e allegati verificati per digest;
- replica autenticata con protocollo causale, coda durevole, conflitti
  conservativi, cifratura con rotazione esplicita e inviti con ruoli;
- pubblicazione selettiva con manifest espliciti, preflight dei privati,
  commit atomici, rollback e client headless con dry-run;
- inventario WASM persistente separato dai dati del vault e avvio desktop dei
  soli componenti enabled con consenso concesso, prima di caricare il guest;
- limiti di tempo e memoria per i componenti WASM, con minaccia esplicita e
  senza quote assolute spacciate per per-store;
- cartelle nuove con `folder.create` dall'explorer e dalla palette, con
  preflight del nome e conflitto esplicito su un path occupato;
- allegati e file sconosciuti nell'albero dell'explorer, con apertura nel
  visualizzatore per immagini, audio, video e PDF, rinomina e cestino con
  ripristino;
- comando «Mostra la nota attiva nell'albero»;
- confronto riga per riga fra una versione e la nota attuale nella cronologia,
  e copia del testo di una versione negli appunti;
- impostazione `files.trash` per scegliere fra cestino del vault e cestino di
  sistema, con avviso quando il sistema non ne offre uno;
- snapshot completo offline del vault con `vault.snapshot.create` e
  ripristino con `vault.snapshot.apply`, che salva prima lo stato sostituito;
- commenti `%%…%%` nascosti nella resa e conservati nel file;
- immagini, audio e video del vault risolti e serviti nella resa Markdown, con
  dimensioni negli embed `![[file|120]]`;
- sintassi di ricerca con operatori, frasi, negazione, `OR`, gruppi, regex e
  filtri di proprietà, condivisa da barra, CLI e query incorporate;
- prefisso temporale configurabile per le note univoche;
- anteprima della nota collegata al passaggio su un wikilink, in Lettura e con
  Ctrl/Cmd in Live;

### Modificato

- resa Markdown condivisa fra Live e Lettura anche prima del salvataggio,
  con tipografia e colonna coerenti nelle tre modalità;
- blocchi Live virtualizzati, task modificabili anche in Lettura e passaggi di
  modalità che conservano posizione, selezione e cronologia della superficie;
- tema Lime con superfici scure più distinguibili, selezioni neutre,
  controlli e dialoghi più ariosi e titoli editoriali in Live e Lettura;
- modalità del documento raccolte nella barra del riquadro, senza duplicati
  nella barra della finestra;
- caricamento del motore del grafo su richiesta e bundle separati per runtime,
  con limiti vincolanti sulla dimensione del JavaScript.

### Corretto

- i tag dichiarati nel frontmatter contano nella ricerca, nel pannello tag e
  negli eventi come quelli nel testo;
- la palette permette di applicare i piani senza note (cartelle, collegamenti
  esterni, impostazioni) invece di disabilitare il pulsante;
- i titoli dei comandi di manutenzione escono tradotti in palette e CLI;
- in Live preview formule in riga, callout, diagrammi e ID di blocco seguono
  la resa della Lettura; i diagrammi Mermaid mantengono la loro larghezza;
- i titoli dei callout non vengono più trasformati in maiuscole e
  l'evidenziato in Lettura usa il colore dell'evidenziatore;
- un comando o una view di terzi non può più chiedere alla shell di scrivere
  negli appunti o di ricaricare la finestra;
- tradotte le etichette e i messaggi rimasti fissi in una lingua: profili e
  CSS nelle impostazioni, catalogo verificato, viste PDF, audio, video e
  immagini, registratore, menu delle schede, presentazioni, esportazioni,
  basi, shell mobile e comandi dell'host (cartelle, snapshot, cartelle
  esterne, cestino di sistema);
- conservate prima del salvataggio anche le modifiche esterne non ancora
  notificate; l'annullamento del ripristino recupera la preimmagine effettiva;
- recuperata la cronologia dai dati autorevoli anche quando l'indice derivato
  non è scrivibile, con controllo d'integrità anche nelle letture native;
- ripristinato il viewer Mermaid per i diagrammi restituiti dal backend come
  nodi UI, mantenendo il ripiego degli altri motori;
- risolti heading e ancore di blocco nei link Markdown con frammento, anche
  percent-encoded, senza confondere le ancore delle note incorporate;
- staccate da `Custody<Workspace>` le callback di produzione per lifecycle,
  restore, rename, watcher, manutenzione, flush degli indici e `BeforeWrite`,
  con riconvalida, rollback e isolamento dei panic;
- evitati i crash WebKitGTK di File e Impostazioni disabilitando le transizioni
  native sulle superfici problematiche senza rimuovere il moto CSS;
- legati i timer differiti dei tooltip alla finestra proprietaria per rendere
  sicuro il teardown dell'ambiente;
- campionato l'heap del banco grafo dopo lo stop dei frame, non durante;
- corretti nella Graph View l'inquadratura iniziale, i tempi dello zoom, i click
  sull'elenco delle note e l'associazione tra etichette e parametri fisici.
- impedito ai filtri dei profili di alterare il buffer ricevuto dalla sessione
  o contaminare la cronologia locale durante la sincronizzazione.
- corretti Enter nelle liste, rinumerazione multi-cursore, posizionamento CRLF
  e delimitatori del codice inline, preservando le selezioni inverse;
- rispettata la sola lettura nei comandi Markdown e nelle checkbox Live,
  comprese la spunta visibile e la cronologia di undo e redo;
- allineata la navigazione dei link Live alla policy di Lettura ed escluso
  il markup HTML dalla sintassi aggiuntiva; la resa segue anche il
  completamento asincrono del parser;
- corrette semantica e chiusura delle linguette, conservazione del focus,
  navigazione dell'albero e accessibilità dei divisori, anche con zoom;
- isolati i campioni posizionati del catalogo visuale, senza coperture globali,
  con regioni scorrevoli raggiungibili da tastiera.
- mantenuti distinti focus e attivazione delle tab e instradati Invio e Spazio
  attraverso i controlli nativi;
- impediti aggiornamenti regressivi dei cursori persistenti dei timer anche
  nel percorso di scrittura esterno al lock del workspace;
- corretti su Windows gli spostamenti senza sovrascrittura, conservando
  l'ancoraggio alla directory aperta e un solo successo fra writer concorrenti;
- esclusi dal censimento del cestino i lock persistenti dello storage,
  preservandoli sul disco e mantenendo visibili i file utente sconosciuti;
- isolati i temi illeggibili senza nascondere gli altri temi installati.

### In corso

- preparazione del primo release candidate, inclusi versione, artefatti firmati
  e matrice CI completa sullo SHA del candidato;
- follow-up espliciti per famiglie WASM differite e quote assolute di processo.

Lo stato operativo è in [`docs/project/status.md`](docs/project/status.md).
