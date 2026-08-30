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
- la shell registra, seleziona e monta Markdown o testo piano tramite un registro
  interno delle superfici;
- il registro applica ownership esplicita a `destroy()`, riusa per chiave di
  selezione opaca e inferisce temporaneamente il formato da path ed estensione;
- i cataloghi `PaneMode` sono esposti soltanto dalle superfici modeful montate:
  Markdown dichiara sorgente, live preview e lettura; plain text sorgente;
- la tastiera distingue trap di focus, gesto realmente consumato dall'editor e
  dispatcher della shell per le scorciatoie e le sequenze rimanenti;
- formato `.fubsheet` testuale e versionato con identità stabili e proiezioni
  comuni per outline, ricerca e proprietà;
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
- estensione delle superfici condivise a griglia e contratto pubblico;
- modularizzazione e prova di scala della Graph View;
- definizione del contratto pubblico dei temi.

Lo stato operativo è in [`docs/project/status.md`](docs/project/status.md).
