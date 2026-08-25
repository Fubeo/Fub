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
- cestino, bozze, versioning, organizzazione e indici persistenti;
- comandi, query, view ed eventi attraverso registri generici;
- feature ufficiali abilitate con feature Cargo indipendenti;
- contratto WIT `fub:abi@0.1.1` con snapshot congelati;
- runtime WASM per `Plugin` e `CommandProvider`;
- limiti di tempo e memoria per i componenti WASM;
- test Rust, frontend, visuali, accessibilità e guard architetturali;
- policy di sicurezza, supply chain e SBOM;
- documentazione canonica organizzata per prodotto, architettura, sviluppo,
  riferimento e stato.

### In corso

- completamento di M5: provider WASM aggiuntivi, UI non fidata e percorso
  installazione-esecuzione end-to-end;
- consolidamento delle superfici di editing dopo un secondo cliente reale;
- modularizzazione e prova di scala della Graph View;
- definizione del contratto pubblico dei temi.

Lo stato operativo è in [`docs/project/status.md`](docs/project/status.md).
