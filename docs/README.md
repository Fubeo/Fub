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
| 📦 [**`archivio/`**](archivio/decisions/README.md) | Registro storico delle decisioni architetturali, roadmap, milestone e piano |

---

## Documenti del repository

- [**`CONTRIBUTING.md`**](CONTRIBUTING.md): ciclo locale di sviluppo, controlli di qualità e linee guida per i contributi.
- [**`SECURITY.md`**](SECURITY.md): perimetro di sicurezza e segnalazione di vulnerabilità.
- [**`CODE_OF_CONDUCT.md`**](CODE_OF_CONDUCT.md): codice di condotta della community.
- [**`CHANGELOG.md`**](CHANGELOG.md): cronologia delle modifiche e delle versioni rilasciate.
