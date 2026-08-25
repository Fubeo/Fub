# Documentazione di Fub

Questa cartella separa in modo esplicito tre cose diverse:

1. **guida corrente**, che descrive il sistema com'è oggi;
2. **stato del progetto**, che dice cosa è completo e cosa resta aperto;
3. **memoria storica**, che conserva decisioni e ragionamenti senza fingere di essere una roadmap viva.

Ogni informazione operativa deve avere una sola fonte canonica. Gli altri file
la collegano, non la riscrivono.

## Da dove iniziare

| Esigenza | Documento canonico |
|---|---|
| Capire cos'è Fub | [`00-inizia-qui/01-cos-e-fub.md`](00-inizia-qui/01-cos-e-fub.md) |
| Installare dipendenze e avviare il progetto | [`00-inizia-qui/02-come-si-avvia.md`](00-inizia-qui/02-come-si-avvia.md) |
| Orientarsi nel repository | [`00-inizia-qui/03-struttura-del-repo.md`](00-inizia-qui/03-struttura-del-repo.md) |
| Capire l'architettura | [`02-componenti/01-panoramica.md`](02-componenti/01-panoramica.md) |
| Leggere i diagrammi | [`03-uml/01-trait-fub-abi.md`](03-uml/01-trait-fub-abi.md) |
| Sviluppare un plugin | [`04-plugin/01-nativo-vs-wasm.md`](04-plugin/01-nativo-vs-wasm.md) |
| Capire cosa viene scritto sul disco | [`05-disco/01-note-utente.md`](05-disco/01-note-utente.md) |
| Studiare il contratto Rust/WIT | [`06-contratto/01-i-trait-in-rust.md`](06-contratto/01-i-trait-in-rust.md) |
| Capire shell, IPC, viste e temi | [`07-ui/01-la-shell-e-il-frontend.md`](07-ui/01-la-shell-e-il-frontend.md) |
| Vedere le funzionalità del prodotto | [`FEATURES.md`](FEATURES.md) |
| Vedere il piano corrente | [`PIANO.md`](PIANO.md) |
| Vedere solo il lavoro aperto | [`todo.md`](todo.md) |

## Struttura

### Guida corrente

| Percorso | Contenuto |
|---|---|
| [`00-inizia-qui/`](00-inizia-qui/01-cos-e-fub.md) | Panoramica, avvio e mappa del repository. |
| [`01-concetti/`](01-concetti/01-il-vault.md) | Vault, kernel, provider, eventi e altri concetti di base. |
| [`02-componenti/`](02-componenti/01-panoramica.md) | Responsabilità dei crate, del frontend e degli esempi. |
| [`03-uml/`](03-uml/01-trait-fub-abi.md) | Diagrammi che accompagnano la guida tecnica. |
| [`04-plugin/`](04-plugin/01-nativo-vs-wasm.md) | Estensioni native e WASM, capacità, permessi e percorso di un plugin. |
| [`05-disco/`](05-disco/01-note-utente.md) | Note utente, dati interni, cache e cestino. |
| [`06-contratto/`](06-contratto/01-i-trait-in-rust.md) | Trait Rust, modello comune e contratto WIT. |
| [`07-ui/`](07-ui/01-la-shell-e-il-frontend.md) | Frontend, protocollo dichiarativo, IPC e temi. |

### Stato corrente

| Documento | Ruolo |
|---|---|
| [`FEATURES.md`](FEATURES.md) | Sintesi delle funzionalità realmente disponibili, parziali o pianificate. |
| [`PIANO.md`](PIANO.md) | Milestone, obiettivi correnti e ordine di lavoro. |
| [`todo.md`](todo.md) | Decisioni aperte, residui già decisi e difetti misurati. |
| [`milestones/README.md`](milestones/README.md) | Indice dei documenti di milestone. |

### Inventari di prodotto

| Percorso | Ruolo |
|---|---|
| [`features/`](features/README.md) | Capitolato funzionale: descrive ciò che il prodotto deve saper fare. |
| [`microfeatures/`](microfeatures/README.md) | Inventario dei gesti atomici dell'utente. |

Le caselle presenti in questi inventari sono requisiti e criteri di copertura;
non sono una misura affidabile dello stato di implementazione. Per lo stato si
usano `FEATURES.md`, `PIANO.md` e `todo.md`.

### Memoria storica

| Percorso | Ruolo |
|---|---|
| [`decisions/`](decisions/README.md) | ADR chiusi: decisione, alternative e motivazione. |
| [`roadmap/`](roadmap/README.md) | Sedute di progettazione storiche, non roadmap operativa. |

I file in [`architecture/`](architecture/README.md) e
[`appendix/`](appendix/README.md) sono punti di compatibilità per collegamenti
storici. La documentazione corrente vive nelle cartelle numerate e nei documenti
di stato elencati sopra.

## Etichette di stato

- **Implementato**: il percorso è disponibile nel codice.
- **Parziale**: esiste un percorso funzionante, ma manca parte della copertura prevista.
- **Pianificato**: il lavoro non è ancora disponibile come percorso completo.
- **Storico**: il documento spiega perché una scelta è stata fatta; non descrive il lavoro corrente.

Il contratto può essere più ampio di ciò che la shell attraversa già. In
particolare, l'esistenza di un tipo Rust o WIT non implica automaticamente che
la relativa esperienza utente sia completa.

## Regole di manutenzione

- Aggiornare la fonte canonica, poi correggere i link che la citano.
- Preferire un link a una seconda spiegazione quasi identica.
- Non usare ADR e sedute storiche come lista di lavoro.
- Dichiarare lo stato quando una pagina mescola parti disponibili e parti future.
- Mantenere validi link, tabelle e conteggi meccanici.

Controlli documentali principali:

```bash
node .github/scripts/check-doc-links.mjs
node .github/scripts/check-prose.mjs
node .github/scripts/check-tables.mjs
```

Il ciclo completo è in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Governo del progetto

- [`CONTRIBUTING.md`](CONTRIBUTING.md): sviluppo, controlli e contributi.
- [`SECURITY.md`](SECURITY.md): segnalazione privata delle vulnerabilità.
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md): regole della community.
- [`CHANGELOG.md`](CHANGELOG.md): modifiche per versione.
- [`versionamento.md`](versionamento.md): versioni del prodotto, del contratto e degli schemi persistenti.
