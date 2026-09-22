# Changelog

Le modifiche degne di nota seguono
[Keep a Changelog](https://keepachangelog.com/it-IT/1.1.0/) e il versionamento
descritto in
[`docs/development/versioning-and-releases.md`](docs/development/versioning-and-releases.md).

## [Non rilasciato]

Fub non ha ancora pubblicato un tag di rilascio. La sezione seguente descrive
ciò che formerà la prima versione.

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
- contratto WIT `fub:abi@0.1.1` con snapshot congelati;
- runtime WASM per `Plugin` e `CommandProvider`;
- inventario WASM persistente separato dai dati del vault e avvio desktop dei
  soli componenti enabled con consenso concesso, prima di caricare il guest;
- limiti di tempo e memoria per i componenti WASM;
- test Rust, frontend, visuali, accessibilità e guard architetturali;
- policy di sicurezza, supply chain e SBOM;
- documentazione canonica organizzata per prodotto, architettura, sviluppo,
  riferimento e stato.

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
  con riconvalida, rollback e isolamento dei panic.
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

### In corso

- completamento di M5: provider WASM aggiuntivi, UI non fidata e percorso
  installazione-esecuzione end-to-end;
- estensione delle superfici condivise a griglia e contratto pubblico;
- modularizzazione e prova di scala della Graph View;
- definizione del contratto pubblico dei temi.

Lo stato operativo è in [`docs/project/status.md`](docs/project/status.md).
