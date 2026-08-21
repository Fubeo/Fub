# 31. Roadmap consigliata

Questo elenco è stato rimisurato sul codice il 2026-08-14; una casella spuntata è un fatto, non un piano.

## Fase 1 — Core essenziale

- [x] Vault e file explorer
- [x] Editor Markdown eccellente
- [x] Live preview
- [x] Wikilink
- [x] Backlink
- [x] Tag
- [x] Proprietà base
  _Pannello `fub.properties` (sidebar destra) e comandi `note.property.set` / `note.property.remove`. Motore in `crates/fub-abi/src/rules/properties.rs`._
- [x] Ricerca full-text
- [x] Quick switcher
- [x] Command palette
- [x] Temi chiaro/scuro
- [x] Import/export Markdown
  _MarkdownImport/MarkdownExport montati in `crates/fub-host/src/mount.rs` sotto `fub.markdown`._
- [x] Autosave
- [x] Recovery
- [x] Plugin API iniziale
- [x] Accessibilità di base
- [x] Avvio e chiusura puliti
- [x] Dati sempre in file aperti

## Fase 2 — Potenza e organizzazione

- [x] Grafo
- [x] Outline
- [x] Template
- [x] Daily notes
- [x] Query engine
  _QueryExpr/IndexQuery più query salvate (`fub.queries`) e view collezioni._
- [ ] Task avanzati
  _Solo NOTE_TASK_TOGGLE (crates/fub-features/src/commands.rs), niente task avanzati._
- [ ] Canvas
- [ ] Database
- [ ] Allegati avanzati
- [ ] PDF annotations
- [x] Versioning
- [x] Backup
  _Snapshot locale in `.fub/data/plugins/fub.backup/` (niente scrittura fuori dal vault)._
- [x] Vault health
- [x] Bulk operations
  _`vault.replace` più UI palette (form, dry_run, piano). Nessun pannello dedicato._
- [x] Collezioni
  _View `collections` su `fub.queries`: le query salvate come elenco da sfogliare._
- [x] Dashboard
  _Pannello `fub.dashboard`: note/tag/file e link rotti da `IndexQuery::{Entries,Tags,VaultHealth}`._

## Fase 3 — Suite e collaborazione

- [ ] FubTasks
- [ ] FubDB
- [ ] FubCanvas
- [ ] FubCalendar
- [ ] FubProjects
- [ ] FubJournal
- [ ] FubFlashcards
- [ ] FubCharts
- [ ] FubMaps
- [ ] FubForms
- [ ] FubCRM
- [ ] FubFinance
- [ ] FubCollab
- [ ] FubPublish
- [ ] FubSync
- [ ] Diff/merge avanzato
- [ ] Git integration
- [ ] Team docs

## Fase 4 — Ecosistema, AI responsabile e servizi opzionali

- [ ] Marketplace plugin
- [ ] Temi community
- [ ] SDK completo
- [ ] CLI avanzata
- [ ] AI locale
- [ ] Ricerca semantica
- [ ] AI Q&A sul vault
- [ ] Centro di comando LLM
- [ ] Automazioni avanzate
- [ ] Pubblicazione statica avanzata
- [ ] Self-hosted services
- [ ] Web clipper
- [ ] Read-it-later
- [ ] Reference manager
- [ ] Audio/video transcription
- [ ] Notebooks/code execution
- [ ] ETL/data editor
- [ ] Forms/surveys
- [ ] Notifications center
- [ ] Cross-device handoff
- [ ] PWA/web offline
- [ ] Accessibility avanzata
- [ ] Security avanzata
- [ ] Privacy avanzata
- [ ] AI governance
- [ ] Plugin supply chain security
- [ ] Legal/compliance/governance
