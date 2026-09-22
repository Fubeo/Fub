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
- comandi, query, view ed eventi attraverso registri generici;
- feature ufficiali abilitate con feature Cargo indipendenti;
- contratto WIT `fub:abi@0.1.2` con snapshot congelati e famiglia Grid v1
  verificata su provider nativo e proxy WASM;
- inventario WASM persistente separato dai dati del vault e avvio desktop dei
  soli componenti enabled con consenso concesso, prima di caricare il guest;
- limiti di tempo e memoria per i componenti WASM;
- test Rust, frontend, visuali, accessibilità e guard architetturali;
- policy di sicurezza, supply chain e SBOM;
- documentazione canonica organizzata per prodotto, architettura, sviluppo,
  riferimento e stato;
- snapshot globali offline con manifest schema 1, validazione pre-commit,
  revisione di base SHA-256, staging sibling, record persistente e recovery
  prima del mount;
- temi installabili con contratto `theme-1`, preview isolata e ripristino della
  scelta autorevole;
- Graph View modularizzata con fixture 2k/10k, teardown verificato e gate hard
  sulla stabilizzazione dell'heap.

### Modificato

- tema Lime con superfici scure più distinguibili, selezioni neutre,
  controlli e dialoghi più ariosi e titoli editoriali in Live e Lettura;
- modalità del documento raccolte nella barra del riquadro, senza duplicati
  nella barra della finestra;
- caricamento del motore del grafo su richiesta e bundle separati per runtime,
  con limiti vincolanti sulla dimensione del JavaScript.

### Corretto

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
- isolati i temi illeggibili senza nascondere gli altri temi installati.

### In corso

- preparazione del primo release candidate, inclusi versione, artefatti firmati
  e matrice CI completa sullo SHA del candidato;
- follow-up espliciti per famiglie WASM differite e quote assolute di processo.

Lo stato operativo è in [`docs/project/status.md`](docs/project/status.md).
