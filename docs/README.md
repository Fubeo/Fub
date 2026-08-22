# Documentazione di Fub

Benvenuto nella documentazione di Fub. La documentazione è organizzata in cartelle tematiche per guidarti dal primo avvio fino ai dettagli architetturali più approfonditi.

---

## Mappa della documentazione

| Cartella | Descrizione |
|---|---|
| 🚀 [**`00-inizia-qui/`**](00-inizia-qui/01-cos-e-fub.md) | Cos'è Fub, come si compila/avvia e struttura del repository |
| 💡 [**`01-concetti/`**](01-concetti/01-il-vault.md) | Concetti chiave (Vault, Kernel, Plugin, Eventi) spiegati con analogie e schemi |
| 🧩 [**`02-componenti/`**](02-componenti/01-panoramica.md) | Scheda di dettaglio per ogni crate Rust, frontend ed esempi con path reali |
| 📊 [**`03-uml/`**](03-uml/01-trait-fub-abi.md) | Diagrammi architetturali (gerarchia trait, sequenza tasto-pixel, dipendenze, thread) |
| 🔌 [**`04-plugin/`**](04-plugin/01-nativo-vs-wasm.md) | Modello di estensione, HostApi, permessi e walkthrough passo-passo di `ping-wasm` |
| 💾 [**`05-disco/`**](05-disco/01-note-utente.md) | Formato note Markdown, cartella `.fub/` (autorevole vs derivata) e cestino |
| 📜 [**`06-contratto/`**](06-contratto/01-i-trait-in-rust.md) | Trait Rust in `fub-abi`, modello dati del documento e contratto WIT per WASM |
| 🖥️ [**`07-ui/`**](07-ui/01-la-shell-e-il-frontend.md) | Shell frontend TypeScript, protocollo dichiarativo `UiNode`, IPC e temi |
| 🏛️ [**`decisions/`**](decisions/README.md) | Registro delle decisioni architetturali (*ADR*), inclusi i **dieci** buchi dichiarati <!-- [conta: buchi-dichiarati] --> |
| 🎯 [**`milestones/`**](milestones/README.md) | Obiettivi di prodotto e traguardi delle release |
| 🗺️ [**`roadmap/`**](roadmap/README.md) | Sedute di progettazione e traguardi di contratto |
| 📝 [**`features/`**](features/01-principi-fondanti.md) | Capitolato funzionale e specifiche complete delle funzionalità di prodotto |
| 🔬 [**`microfeatures/`**](microfeatures/vault-ed-esploratore.md) | Scomposizione granulare dei gesti atomici di interazione utente |
| 📋 [**`todo.md`**](todo.md) | Registro delle attività aperte, stato di avanzamento e difetti misurati |
| 🏷️ [**`versionamento.md`**](versionamento.md) | Disciplina SemVer e versioni degli schemi persistenti su disco |

### Stato delle funzionalità

Le guide descrivono lo **stato implementato** salvo indicazione esplicita. Quando una parte è ancora in costruzione, usa queste etichette:

- **Implementato** — presente nel codice e, dove indicato, coperto da test/presìdi.
- **Parziale** — il percorso esiste, ma non tutte le superfici previste sono disponibili.
- **Contratto/design** — la forma è definita, ma non implica che l'intera feature sia già attraversabile dall'utente.
- **Pianificato** — obiettivo futuro; lo stato operativo resta in [`todo.md`](todo.md).

Questa distinzione è particolarmente importante per il runtime WASM di M5: il contratto è più ampio della porzione già attraversata in esecuzione.

---

## Documenti del repository

- [**`CONTRIBUTING.md`**](CONTRIBUTING.md): ciclo locale di sviluppo, controlli di qualità e linee guida per i contributi.
- [**`SECURITY.md`**](SECURITY.md): perimetro di sicurezza e segnalazione di vulnerabilità.
- [**`CODE_OF_CONDUCT.md`**](CODE_OF_CONDUCT.md): codice di condotta della community.
- [**`CHANGELOG.md`**](CHANGELOG.md): cronologia delle modifiche e delle versioni rilasciate.
