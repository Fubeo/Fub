# 31. Roadmap consigliata

Questo elenco è stato rimisurato sul codice il 2026-08-14; una casella spuntata è un fatto, non un piano.

## Fase 1 — Core essenziale

- [x] Vault e file explorer
- [x] Editor Markdown eccellente
- [x] Live preview
- [x] Wikilink
- [x] Backlink
- [x] Tag
- [ ] Proprietà base
  _Motore presente (crates/fub-abi/src/rules/properties.rs + frontmatter), manca una UI di editing delle proprietà._
- [x] Ricerca full-text
- [x] Quick switcher
- [x] Command palette
- [x] Temi chiaro/scuro
- [ ] Import/export Markdown
  _MarkdownImport/MarkdownExport esistono (crates/fub-format-markdown/src/transfer.rs) ma non sono montati in crates/fub-host/src/mount.rs né esposti in UI._
- [x] Autosave
- [x] Recovery
- [x] Plugin API iniziale
- [x] Accessibilità di base
- [x] Avvio e chiusura puliti
- [x] Dati sempre in file aperti

## Fase 2 — Potenza e organizzazione

- [x] Grafo
- [x] Outline
- [ ] Template
- [ ] Daily notes
- [ ] Query engine
  _QueryExpr/IndexQuery ci sono (crates/fub-abi/src/query.rs, traits.rs), mancano query salvate e UI._
- [ ] Task avanzati
  _Solo NOTE_TASK_TOGGLE (crates/fub-features/src/commands.rs), niente task avanzati._
- [ ] Canvas
- [ ] Database
- [ ] Allegati avanzati
- [ ] PDF annotations
- [x] Versioning
- [ ] Backup
- [x] Vault health
- [ ] Bulk operations
  _Solo VAULT_REPLACE (crates/fub-features/src/commands.rs), niente UI bulk._
- [ ] Collezioni
- [ ] Dashboard

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
