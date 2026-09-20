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
  prima del mount (PR #65);
- temi installabili con contratto `theme-1`, preview isolata e ripristino della
  scelta autorevole;

### Corretto

- staccate da `Custody<Workspace>` le callback di produzione per lifecycle,
  restore, rename, watcher, manutenzione, flush degli indici e `BeforeWrite`,
  con riconvalida, rollback e isolamento dei panic;
- evitati i crash WebKitGTK di File e Impostazioni disabilitando le transizioni
  native sulle superfici problematiche senza rimuovere il moto CSS;
- legati i timer differiti dei tooltip alla finestra proprietaria per rendere
  sicuro il teardown dell'ambiente.

### In corso

- preparazione del primo release candidate, inclusi il ripristino atomico degli
  snapshot del database e la classificazione della guida plugin;
- follow-up espliciti per famiglie WASM differite e quote assolute di processo.

Lo stato operativo è in [`docs/project/status.md`](docs/project/status.md).
