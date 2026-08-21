# Documentazione di Fub

Benvenuto nella documentazione di Fub. La documentazione è organizzata in cartelle tematiche per guidarti dal primo avvio fino ai dettagli architetturali più approfonditi.

---

## Mappa della documentazione

| Cartella | Argomento | A chi serve |
|---|---|---|
| 🚀 [**`00-inizia-qui/`**](00-inizia-qui/01-cos-e-fub.md) | Cos'è Fub, come si compila/avvia e struttura del repository | Chi apre il progetto per la prima volta |
| 🎓 [**`01-per-studenti/`**](01-per-studenti/01-il-vault.md) | Concetti chiave (Vault, Kernel, Plugin, Eventi) spiegati con analogie | Studenti delle superiori e principianti |
| 🧩 [**`02-componenti/`**](02-componenti/01-panoramica.md) | Scheda di dettaglio per ogni crate Rust, frontend ed esempi con path reali | Sviluppatori che lavorano sul codice |
| 📊 [**`03-uml/`**](03-uml/01-trait-fub-abi.md) | Diagrammi Mermaid (gerarchia trait, sequenza tasto-pixel, dipendenze, thread) | Chi vuole comprendere visivamente i flussi |
| 🔌 [**`04-plugin/`**](04-plugin/01-nativo-vs-wasm.md) | Modello di estensione, HostApi, permessi e walkthrough passo-passo di `ping-wasm` | Chi vuole creare o estendere un plugin |
| 💾 [**`05-disco/`**](05-disco/01-note-utente.md) | Formato note Markdown, cartella `.fub/` (autorevole vs derivata) e cestino | Chi gestisce file e persistenza su disco |
| 📜 [**`06-contratto/`**](06-contratto/01-i-trait-in-rust.md) | Trait Rust in `fub-abi`, modello dati del documento e contratto WIT per WASM | Chi progetta nuove API e interfacce |
| 🖥️ [**`07-ui/`**](07-ui/01-la-shell-e-il-frontend.md) | Shell frontend TypeScript, protocollo dichiarativo `UiNode`, IPC e temi | Chi sviluppa l'interfaccia utente |
| 📦 [**`archivio/`**](archivio/decisions/README.md) | Registro storico delle decisioni architetturali, roadmap, milestone e piano | Consultazione storica del progetto |

---

## Documenti del repository

- [**`CONTRIBUTING.md`**](CONTRIBUTING.md): ciclo locale di sviluppo, controlli di qualità e linee guida per i contributi.
- [**`SECURITY.md`**](SECURITY.md): perimetro di sicurezza e segnalazione di vulnerabilità.
- [**`CODE_OF_CONDUCT.md`**](CODE_OF_CONDUCT.md): codice di condotta della community.
- [**`CHANGELOG.md`**](CHANGELOG.md): cronologia delle modifiche e delle versioni rilasciate.
