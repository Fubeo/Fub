# Fub

Fub è un workspace desktop locale per note e documenti Markdown. Mantiene i file in una cartella normale, applica le regole del vault in un kernel indipendente dal formato e consente a provider e funzionalità di estendere il sistema attraverso un contratto comune.

## Stato

Il progetto è in sviluppo alla versione `0.1.0`. Non esistono ancora release pubbliche o installer ufficiali.

La fotografia verificata delle funzioni presenti, dei limiti e del percorso plugin/WASM è in [`docs/STATO.md`](docs/STATO.md).

## Caratteristiche della base corrente

- vault locali e provider Markdown;
- modello dei documenti e kernel agnostici rispetto al formato;
- ricerca, versioning, backlink, tag, proprietà, query, backup, grafo e altri bundle ufficiali;
- shell Tauri con editor, anteprima, esplora file, apertura rapida e viste dichiarative;
- contratto Rust e WIT con controlli di conformità e compatibilità;
- host separato da Tauri e runtime WASM isolato nel proprio crate;
- test multi-piattaforma, supply-chain, documentazione, resa visuale e accessibilità in CI.

## Avvio dal sorgente

Requisiti verificati dalla CI: Rust 1.89, Node.js 22, npm, Tauri CLI 2 e i tool di compilazione della piattaforma.

```bash
npm --prefix frontend ci
cargo tauri dev --config crates/fub-app/tauri.conf.json
```

Per aprire subito un vault:

```bash
FUB_VAULT="/percorso/assoluto/del/vault" \
  cargo tauri dev --config crates/fub-app/tauri.conf.json
```

Le dipendenze Linux, il packaging e i problemi comuni sono documentati in [`docs/guida/installazione-e-avvio.md`](docs/guida/installazione-e-avvio.md).

## Architettura

```text
frontend → fub-app → fub-host → fub-kernel → provider definiti da fub-abi
```

- [`fub-abi`](crates/fub-abi/) definisce tipi, trait e WIT;
- [`fub-kernel`](crates/fub-kernel/) applica le regole del vault;
- [`fub-host`](crates/fub-host/) assembla provider, sessioni e servizi;
- [`fub-app`](crates/fub-app/) è il sottile adattatore Tauri;
- [`frontend`](frontend/) contiene la shell TypeScript;
- [`fub-wasm-host`](crates/fub-wasm-host/) contiene il runtime dei componenti.

La spiegazione completa è in [`docs/architecture/`](docs/architecture/README.md); il grafo dei crate è confrontato automaticamente con i manifest in [`docs/03-uml/03-componenti-e-dipendenze.md`](docs/03-uml/03-componenti-e-dipendenze.md).

## Documentazione

- [indice completo](docs/README.md)
- [guida pratica](docs/guida/README.md)
- [stato del progetto](docs/STATO.md)
- [riferimento tecnico](docs/riferimento/README.md)
- [contribuire](docs/CONTRIBUTING.md)
- [sicurezza](docs/SECURITY.md)

Specifiche, piani e verbali sono separati dalla documentazione del comportamento corrente per evitare che una funzione prevista sembri già disponibile.

## Licenza

Fub è distribuito con doppia licenza MIT oppure Apache-2.0.