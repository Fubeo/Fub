# 9. Ricerca, query, discovery e knowledge lifecycle

*Microfeature essenziali: [ricerca-e-task.md](../microfeatures/ricerca-e-task.md).*

## 9.1 Ricerca base e avanzata

**Questa sezione è Core, e la ricerca predefinita è di classe *omnisearch*.** Il
comportamento che gli utenti di Obsidian conoscono da quell'estensione — refusi
perdonati, prefisso mentre si digita, estratti ordinati per rilevanza con i
termini evidenziati, un modale per il vault e uno per la nota aperta — **è** la
ricerca di Fub, non un plugin da installare: sotto non c'è una ricerca "base"
da migliorare, e dalla stessa porta passano il quick switcher (8.1), la command
palette, le collezioni (8.4) e le viste salvate (8.3). Il verbale, con ciò che
resta fuori e perché, è la
[decisione 0025](../decisions/0025-la-ricerca-predefinita.md); ciò che manca al
contratto perché quella frase sia vera è la
[seduta 21](../roadmap/21-la-ricerca-predefinita.md). Resta **Opzionale** come tutto
ciò che sta oltre il nucleo — ma spenta vuol dire *senza ricerca*, non con una
ricerca peggiore.

- [ ] Ricerca globale
- [ ] Ricerca rapida
- [ ] Full-text
- [ ] Fuzzy
- [ ] Fuzzy di default nella casella di ricerca
- [ ] Esattezza richiedibile per singola query
- [ ] Prefisso mentre si digita
- [ ] Esatta
- [ ] Operatori
- [ ] Regex
- [ ] Wildcard
- [ ] Prossimità
- [ ] Field-specific
- [ ] Ricerca per percorso
- [ ] Ricerca per nome file
- [ ] Ricerca per heading
- [ ] Ricerca per tag
- [ ] Ricerca per proprietà
- [ ] Ricerca per data creazione
- [ ] Ricerca per data modifica
- [ ] Ricerca per tipo nota
- [ ] Ricerca per alias
- [ ] Ricerca per link
- [ ] Ricerca per backlink
- [ ] Ricerca per allegati
- [ ] Ricerca per task
- [ ] Ricerca per stato task
- [ ] Ricerca per priorità
- [ ] Ricerca per scadenza
- [ ] Ricerca per commento
- [ ] Ricerca per highlight
- [ ] Ricerca dentro canvas
- [ ] Ricerca dentro database
- [ ] Ricerca dentro PDF
- [ ] Ricerca OCR
- [ ] Ricerca dentro immagini
- [ ] Ricerca dentro audio trascritti
- [ ] Ricerca dentro video trascritti
- [ ] Ricerca dentro commenti
- [ ] Ricerca dentro annotazioni
- [ ] Ricerca dentro form submissions
- [ ] Ricerca dentro la nota aperta
- [ ] Saved search
- [ ] Highlight risultati
- [ ] Anteprima risultati
- [ ] Occorrenze multiple per nota nei risultati
- [ ] Vai all'occorrenza nel testo
- [ ] Ricerca dell'occorrenza successiva/precedente
- [ ] Ranking risultati
- [ ] Pesi personalizzati
- [ ] Sinonimi opzionali
- [ ] Ricerca multilingua
- [ ] Stemming multilingua
- [ ] Ricerca fonetica opzionale
- [ ] Ricerca senza connessione
- [ ] Indice ricostruibile
- [ ] Esclusione cartelle dalla ricerca
- [ ] Esclusione termini
- [ ] Recent searches
- [ ] Search suggestions
- [ ] Search history opzionale
- [ ] Crea la nota cercata dal risultato vuoto
- [ ] Snippet contestuali
- [ ] Ranking personalizzabile
- [ ] Pesi per campo configurabili
- [ ] Pesi per cartella/tag/proprietà
- [ ] Ricerca per similarità nota
- [ ] Ricerca per blocchi simili
- [ ] Ricerca per concetti correlati
- [ ] Ricerca per entità
- [ ] Ricerca per persone/luoghi/organizzazioni
- [ ] Ricerca per date assolute e relative
- [ ] Faceted search
- [ ] Filtri rapidi ricerca
- [ ] Query builder visuale
- [ ] Natural language search
- [ ] Semantic search
- [ ] Vector search locale
- [ ] Hybrid search
- [ ] Reranking
- [ ] Search templates
- [ ] Search aliases
- [ ] Search audit
- [ ] Porta unica: casella, quick switcher e palette sullo stesso indice
- [ ] API di ricerca per i plugin
- [ ] Ordinamento dei risultati di ricerca (per data, per titolo, per percorso)
- [ ] Esporta i risultati di ricerca in testo o Markdown
- [ ] Filtro per cartella nella ricerca

## 9.2 Query engine

- [ ] Query live
- [ ] Query language dichiarativo
- [ ] Query su proprietà
- [ ] Query su tag
- [ ] Query su link
- [ ] Query su backlink
- [ ] Query su task
- [ ] Query su date
- [ ] Query su file
- [ ] Query su allegati
- [ ] Filtri multipli
- [ ] Ordinamento
- [ ] Raggruppamento
- [ ] Aggregazioni
- [ ] Count
- [ ] Sum
- [ ] Average
- [ ] Min/max
- [ ] Formule
- [ ] Campi calcolati
- [ ] Join tra note
- [ ] Relazioni
- [ ] Rollup
- [ ] Output tabella
- [ ] Output lista
- [ ] Output task
- [ ] Output calendario
- [ ] Output kanban
- [ ] Output gallery
- [ ] Output timeline
- [ ] Esportazione risultati CSV
- [ ] Esportazione risultati JSON
- [ ] Query embed
- [ ] Query salvate
- [ ] Query parametriche
- [ ] Query con input utente
- [ ] Query ricorsive
- [ ] Query su note figlie
- [ ] Query su note correlate
- [ ] Query performance ottimizzata
- [ ] SQL-like query
- [ ] Formula language
- [ ] Computed fields
- [ ] Group by
- [ ] Having
- [ ] Joins
- [ ] Subqueries
- [ ] Window functions opzionali
- [ ] Parameters
- [ ] Prepared queries
- [ ] Query templates
- [ ] Query caching
- [ ] Query scheduling
- [ ] Query alerts
- [ ] Query export
- [ ] Query visualization
- [ ] Query dashboard widgets
- [ ] Query forms
- [ ] Query permissions
- [ ] Query audit
- [ ] Query debugger
- [ ] Query profiler
- [ ] Query explain plan
- [ ] Query performance metrics
- [ ] Query versioning
- [ ] Query sharing
- [ ] Query marketplace

## 9.3 Knowledge lifecycle

- [ ] Inbox triage
- [ ] Note maturity
- [ ] Review schedule
- [ ] Spaced repetition per note
- [ ] Stale detection
- [ ] Archive suggestions
- [ ] Note expiry
- [ ] Retention policies
- [ ] Ownership
- [ ] Note health score
- [ ] Progressive summarization
- [ ] Evergreen notes
- [ ] MOC generator
- [ ] Topic clusters
- [ ] Knowledge gaps
- [ ] Open questions
- [ ] Hypothesis tracking
- [ ] Research logs
- [ ] Lab notes
- [ ] Experiment tracking
- [ ] Results tables
- [ ] Figures management
- [ ] Data provenance
- [ ] Reproducibility notes
- [ ] Review queues
- [ ] Next actions
- [ ] Someday/maybe lists
- [ ] Waiting-for lists
- [ ] Agenda lists
- [ ] Contexts
- [ ] Energy tags
- [ ] Time estimates
- [ ] Review checklists
- [ ] Weekly review
- [ ] Monthly review
- [ ] Quarterly review
- [ ] Yearly review
