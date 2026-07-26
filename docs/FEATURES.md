# FubMD — Master Feature Document

**Versione:** 1.0 consolidata  
**Scope:** unire in un unico documento ordinato tutte le feature fondamentali di **FubMD** e della futura **FubSuite**, includendo sia la lista iniziale sia le feature aggiuntive emerse dopo.

---

## Legenda

- **Core** = funzionalità base dell’app
- **Suite** = plugin nativo ufficiale FubSuite
- **Plugin** = funzionalità estendibile via plugin
- **Opzionale** = attivabile/disattivabile dall’utente
- **Privacy** = funzionalità con impatto su privacy/sicurezza
- **Anti-predatorio** = vincolo di prodotto non negoziabile

---

# 1. Principi fondanti, licenza e modello non predatorio

## 1.1 Principi fondamentali

- [ ] Local-first
- [ ] Offline-first
- [ ] Markdown-first
- [ ] File locali leggibili
- [ ] Nessun formato proprietario obbligatorio
- [ ] Nessun account obbligatorio
- [ ] Nessuna connessione obbligatoria
- [ ] Nessun cloud obbligatorio
- [ ] Export completo sempre possibile
- [ ] Import completo sempre possibile
- [ ] Dati sempre di proprietà dell’utente
- [ ] Vault portabile
- [ ] Nessun lock-in
- [ ] Estendibilità nativa
- [ ] Plugin system aperto o comunque trasparente
- [ ] Gratuità completa del core
- [ ] Gratuità dei plugin nativi FubSuite
- [ ] Nessun paywall su funzioni essenziali
- [ ] Nessuna subscription obbligatoria
- [ ] Nessun acquisto in-app obbligatorio
- [ ] Nessun dark pattern
- [ ] Nessuna pubblicità
- [ ] Nessuna vendita dati
- [ ] Telemetria disattivata di default
- [ ] Telemetria solo opt-in
- [ ] Trasparenza totale su permessi e rete
- [ ] Longevità del progetto
- [ ] Fiducia come requisito di prodotto

## 1.2 Licenza e governance

- [ ] Se open source: licenza chiara
- [ ] Se closed source: comunque gratis completo
- [ ] Nessun feature gating predatorio
- [ ] Roadmap pubblica
- [ ] Issue tracker pubblico
- [ ] Feature request pubbliche
- [ ] Policy plugin trasparente
- [ ] Policy marketplace trasparente
- [ ] Security disclosure policy
- [ ] Privacy policy chiara
- [ ] Termini d’uso chiari
- [ ] Eventuali servizi cloud opzionali
- [ ] Eventuali servizi cloud self-hostable
- [ ] Eventuali donazioni opzionali
- [ ] Eventuale supporto a pagamento opzionale
- [ ] Nessun servizio essenziale bloccato dietro pagamento

## 1.3 Anti-feature esplicite

- [ ] Nessun account obbligatorio
- [ ] Nessun cloud obbligatorio
- [ ] Nessuna AI obbligatoria
- [ ] Nessun formato proprietario obbligatorio
- [ ] Nessun limite artificiale al numero di note
- [ ] Nessun limite artificiale alla dimensione del vault
- [ ] Nessun limite artificiale ai plugin
- [ ] Nessun watermark obbligatorio
- [ ] Nessun nag screen
- [ ] Nessuna pubblicità
- [ ] Nessun ad tracking
- [ ] Nessuna vendita di dati
- [ ] Nessuna telemetria obbligatoria
- [ ] Nessun dark pattern
- [ ] Nessun abbonamento obbligatorio
- [ ] Nessuna feature premium essenziale
- [ ] Nessun lock-in da sync proprietario
- [ ] Nessun lock-in da publishing proprietario
- [ ] Nessun lock-in da AI proprietaria
- [ ] Nessun lock-in da formato proprietario

---

# 2. Architettura, modello dati e file system

## 2.1 Architettura generale

- [ ] Core separato dalla UI
- [ ] Architettura modulare
- [ ] Plugin system nativo
- [ ] Event bus interno
- [ ] Command registry centralizzato
- [ ] API interne stabili
- [ ] API pubbliche documentate
- [ ] Worker/thread separati
- [ ] Parsing incrementale
- [ ] Indicizzazione incrementale
- [ ] Rendering lazy
- [ ] Cache intelligente
- [ ] Database locale opzionale per indici
- [ ] DB ricostruibile dai file Markdown
- [ ] Nessun dato essenziale solo nel DB
- [ ] File system watcher
- [ ] Rilevamento modifiche esterne
- [ ] Gestione conflitti file
- [ ] Scrittura atomica dei file
- [ ] Recovery dopo crash
- [ ] Safe mode
- [ ] Plugin isolation
- [ ] Crash buffer
- [ ] Autosave buffer
- [ ] Journaling
- [ ] Checksum verification
- [ ] Corruption detection
- [ ] Vault repair
- [ ] Index rebuild
- [ ] Diagnostic bundle

## 2.2 Modello dati

- [ ] Note in `.md` UTF-8
- [ ] Frontmatter YAML
- [ ] Frontmatter TOML opzionale
- [ ] Frontmatter JSON opzionale
- [ ] Metadata inline opzionali
- [ ] Block ID stabili
- [ ] Heading ID stabili
- [ ] Alias
- [ ] UUID opzionale per nota
- [ ] Timestamp creazione/modifica
- [ ] Sidecar file opzionali
- [ ] Sidecar non obbligatori
- [ ] Vault come cartella semplice
- [ ] Vault multipli
- [ ] Impostazioni per-vault
- [ ] Impostazioni globali
- [ ] Profili utente
- [ ] Configurazione esportabile
- [ ] Configurazione importabile
- [ ] Portable mode
- [ ] Config nella cartella vault
- [ ] Config esterna opzionale
- [ ] Nessun percorso hardcoded obbligatorio

## 2.3 File system edge cases

- [ ] Unicode NFC/NFD normalization
- [ ] Gestione caratteri invalidi
- [ ] Gestione nomi riservati
- [ ] Supporto percorsi lunghi
- [ ] Gestione case sensitivity
- [ ] Rilevamento file lock
- [ ] Supporto network drive
- [ ] Supporto symbolic link opzionale
- [ ] Rilevamento modifiche esterne
- [ ] Atomic rename
- [ ] Temp files cleanup
- [ ] Integrazione cestino OS
- [ ] Gestione file nascosti
- [ ] Esclusione file di sistema
- [ ] Scansione vault grandi
- [ ] Preservazione permessi
- [ ] Preservazione timestamp
- [ ] Encoding detection
- [ ] UTF-8 enforcement
- [ ] Gestione BOM
- [ ] Gestione line endings
- [ ] Normalizzazione CRLF/LF
- [ ] Gestione file read-only
- [ ] Vault su drive rimovibile
- [ ] Vault su cloud drive
- [ ] Vault su network share
- [ ] Vault relocation
- [ ] Vault rename
- [ ] Prevenzione vault annidati
- [ ] Vault integrity check

---

# 3. Vault, workspace, file explorer e organizzazione base

## 3.1 Vault

- [ ] Creazione nuovo vault
- [ ] Apertura vault esistente
- [ ] Vault multipli simultanei
- [ ] Switch rapido tra vault
- [ ] Vault recenti
- [ ] Vault preferiti
- [ ] Icona vault personalizzata
- [ ] Colore vault personalizzato
- [ ] Impostazioni separate per vault
- [ ] Vault read-only
- [ ] Vault archiviati
- [ ] Vault portabili su USB
- [ ] Vault sincronizzabili con tool esterni
- [ ] Vault cifrabili localmente
- [ ] Ignore file/cartelle
- [ ] Supporto `.gitignore` o equivalente
- [ ] Visualizzazione file nascosti opzionale
- [ ] Vault template
- [ ] Creazione vault da template
- [ ] Vault health dashboard
- [ ] Vault size diagnostics
- [ ] Vault repair wizard

## 3.2 File explorer

- [ ] Esplora file ad albero
- [ ] Cartelle annidate illimitate
- [ ] Creazione nota
- [ ] Creazione cartella
- [ ] Creazione file non-Markdown
- [ ] Rinomina file
- [ ] Spostamento drag & drop
- [ ] Aggiornamento link su rinomina
- [ ] Aggiornamento link su spostamento
- [ ] Cestino interno
- [ ] Ripristino dal cestino
- [ ] Eliminazione permanente
- [ ] Secure delete
- [ ] Preferiti
- [ ] File fissati
- [ ] Ordinamento personalizzato
- [ ] Ordinamento manuale
- [ ] Filtri file
- [ ] Ricerca nella sidebar file
- [ ] Visualizzazione allegati
- [ ] Anteprima file
- [ ] Gestione file orfani
- [ ] Rilevamento duplicati
- [ ] Gestione nomi case-sensitive
- [ ] Unicode completo
- [ ] Percorsi relativi
- [ ] Link assoluti interni opzionali
- [ ] File lock opzionale
- [ ] Rilevamento modifiche concorrenti
- [ ] Merge manuale conflitti
- [ ] Cronologia modifiche file

## 3.3 Workspace e layout

- [ ] Sidebar sinistra
- [ ] Sidebar destra
- [ ] Sidebar collassabili
- [ ] Sidebar auto-hide
- [ ] Topbar opzionale
- [ ] Status bar
- [ ] Breadcrumb
- [ ] Tab bar
- [ ] Tab groups
- [ ] Schede fissate
- [ ] Schede raggruppate
- [ ] Editor pop-out
- [ ] Finestre multiple
- [ ] Layout personalizzabili
- [ ] Workspace salvabili
- [ ] Switch workspace rapido
- [ ] Restore layout all’avvio
- [ ] Workspace per progetto
- [ ] Workspace per vault
- [ ] Workspace sync opzionale
- [ ] Drag & drop pannelli
- [ ] Pannelli flottanti
- [ ] Mini map
- [ ] Sticky scroll
- [ ] Empty states curati
- [ ] Sample vault
- [ ] Interactive tutorial
- [ ] Tooltips contestuali
- [ ] Undo toast
- [ ] Redo toast
- [ ] Context menus completi
- [ ] Quick actions
- [ ] Background task manager

---

# 4. Editor, scrittura e assistenza

## 4.1 Modalità editor

- [ ] Source mode
- [ ] Live Preview
- [ ] Reading mode
- [ ] WYSIWYG opzionale
- [ ] Block editor opzionale
- [ ] Focus mode
- [ ] Typewriter mode
- [ ] Zen mode
- [ ] Presentation mode
- [ ] Split verticale
- [ ] Split orizzontale
- [ ] Editor a schede
- [ ] Schede fissate
- [ ] Schede raggruppate
- [ ] Editor pop-out
- [ ] Finestre multiple
- [ ] Cambio modalità per nota
- [ ] Cambio modalità globale
- [ ] Fullscreen
- [ ] Distraction-free mode
- [ ] Reading mode immersivo
- [ ] Scroll sync editor/preview
- [ ] Jump to last edit position
- [ ] Note history per pane

## 4.2 Editing testo

- [ ] Syntax highlighting Markdown
- [ ] Autocompletamento link
- [ ] Autocompletamento tag
- [ ] Autocompletamento proprietà
- [ ] Autocompletamento emoji
- [ ] Autocompletamento snippet
- [ ] Autocompletamento blocchi
- [ ] Slash commands
- [ ] Multi-cursore
- [ ] Selezione multipla
- [ ] Selezione rettangolare opzionale
- [ ] Trova/sostituisci
- [ ] Trova/sostituisci regex
- [ ] Sostituzione in file corrente
- [ ] Sostituzione in più file
- [ ] Preview sostituzione multipla
- [ ] Undo/redo illimitato
- [ ] Cronologia undo per sessione
- [ ] Copia/incolla ricco
- [ ] Incolla HTML convertito in Markdown
- [ ] Incolla immagini dagli appunti
- [ ] Drag & drop immagini
- [ ] Drag & drop file
- [ ] Drag & drop blocchi
- [ ] Riordino paragrafi
- [ ] Indentazione intelligente
- [ ] Continuazione automatica liste
- [ ] Continuazione automatica task list
- [ ] Continuazione automatica blockquote
- [ ] Formattazione tabella assistita
- [ ] Folding heading
- [ ] Folding blocchi
- [ ] Folding codice
- [ ] Folding liste
- [ ] Numeri riga opzionali
- [ ] Guide indentazione
- [ ] Evidenziazione riga attiva
- [ ] Parentesi corrispondenti
- [ ] Selezione parola
- [ ] Selezione blocco
- [ ] Selezione paragrafo
- [ ] Scorciatoie personalizzabili
- [ ] Hotkey chords
- [ ] Mouse gestures opzionali
- [ ] Touch gestures
- [ ] Supporto trackpad

## 4.3 Assistenza alla scrittura

- [ ] Controllo ortografico
- [ ] Dizionari multipli
- [ ] Dizionari personalizzati
- [ ] Grammar checking opzionale
- [ ] Suggerimenti stile
- [ ] Linting Markdown
- [ ] Formattazione automatica
- [ ] Format on save
- [ ] Smart punctuation
- [ ] Conversione apici/pedici
- [ ] Conversione trattini/en-dash
- [ ] Conteggio parole
- [ ] Conteggio caratteri
- [ ] Tempo di lettura
- [ ] Statistiche testo
- [ ] Leggibilità
- [ ] Modalità revisione
- [ ] Commenti inline
- [ ] Highlight annotabili
- [ ] Note a margine
- [ ] Suggerimenti link interni
- [ ] Suggerimenti note correlate
- [ ] Completamento AI opzionale
- [ ] Riscrittura AI opzionale
- [ ] Traduzione AI opzionale
- [ ] Riassunto AI opzionale
- [ ] Modalità senza distrazioni
- [ ] Obiettivi di scrittura
- [ ] Timer scrittura
- [ ] Promemoria pause
- [ ] Salvataggio automatico
- [ ] Readability score
- [ ] Style guide
- [ ] Terminology consistency
- [ ] Dialogue formatting
- [ ] Footnotes narrative

## 4.4 Scrittura estesa / manuscript

- [ ] Word count goals
- [ ] Session goals
- [ ] Daily goals
- [ ] Writing streaks
- [ ] Writing statistics
- [ ] Typewriter scroll
- [ ] Manuscript compile
- [ ] Scenes
- [ ] Chapters
- [ ] Acts
- [ ] Character sheets
- [ ] Worldbuilding notes
- [ ] Timeline narrativa
- [ ] Corkboard
- [ ] Index cards
- [ ] Outline mode
- [ ] Name generator opzionale
- [ ] Export manuscript
- [ ] Export novel
- [ ] Export screenplay opzionale
- [ ] Export ebook
- [ ] Print layout

---

# 5. Markdown: standard, estensioni e sicurezza

## 5.1 Standard Markdown

- [ ] CommonMark completo
- [ ] GitHub Flavored Markdown
- [ ] Tabelle
- [ ] Task list
- [ ] Strike-through
- [ ] Autolink
- [ ] Code inline
- [ ] Code block
- [ ] Blockquote
- [ ] Liste ordinate
- [ ] Liste non ordinate
- [ ] Liste annidate
- [ ] Heading
- [ ] Horizontal rule
- [ ] Link
- [ ] Immagini
- [ ] Enfasi
- [ ] Grassetto
- [ ] Corsivo
- [ ] Bold+italic

## 5.2 Estensioni Markdown

- [ ] Wikilink
- [ ] Wikilink con alias
- [ ] Link a heading
- [ ] Link a blocco
- [ ] Embed di note
- [ ] Embed di blocchi
- [ ] Embed di heading
- [ ] Embed di immagini
- [ ] Embed audio
- [ ] Embed video
- [ ] Embed PDF
- [ ] Embed canvas
- [ ] Embed database
- [ ] Embed query
- [ ] Tag
- [ ] Tag annidati
- [ ] Footnotes
- [ ] Definition list
- [ ] Abbreviazioni
- [ ] Apici
- [ ] Pedici
- [ ] Evidenziazione
- [ ] Commenti
- [ ] Callout/admonition
- [ ] Callout personalizzati
- [ ] Metadata inline
- [ ] Attributi blocco
- [ ] ID blocco
- [ ] ID heading
- [ ] TOC automatica
- [ ] Indici personalizzati
- [ ] Citazioni bibliografiche
- [ ] Supporto BibTeX
- [ ] Supporto CSL
- [ ] Variabili documento
- [ ] Conditional content opzionale
- [ ] Include/transclusion multi-file
- [ ] Page break
- [ ] RTL
- [ ] CJK
- [ ] Emoji shortcode
- [ ] Unicode emoji
- [ ] Keyboard syntax
- [ ] Progress bar opzionali
- [ ] Badge opzionali
- [ ] Tabs opzionali
- [ ] Accordion opzionali
- [ ] Timeline opzionali
- [ ] Stepper opzionali
- [ ] File tree opzionali

## 5.3 Sicurezza Markdown

- [ ] XSS sanitization
- [ ] HTML allowlist
- [ ] Block remote images
- [ ] CSP
- [ ] rel=noopener per link esterni
- [ ] SVG script blocking
- [ ] Math sanitization
- [ ] Embed sandbox
- [ ] iframe sandbox
- [ ] data URI policy
- [ ] JavaScript URL blocking
- [ ] Link preview privacy
- [ ] Remote content permissions
- [ ] Mixed content blocking
- [ ] Safe HTML renderer
- [ ] Markdown parser fuzzing
- [ ] HTML parser fuzzing
- [ ] CSS sanitization
- [ ] Custom CSS safety warnings
- [ ] Plugin CSS isolation
- [ ] Theme CSP compatibility
- [ ] Secure code block rendering
- [ ] Secure diagram rendering
- [ ] Secure math rendering
- [ ] Secure embed rendering
- [ ] Secure attachment rendering
- [ ] Secure PDF rendering
- [ ] Secure media rendering
- [ ] Secure link resolution
- [ ] Secure file access

---

# 6. Rendering, preview, temi e stampa

## 6.1 Rendering

- [ ] Rendering Markdown fedele
- [ ] Live preview inline
- [ ] Reading mode pulito
- [ ] Syntax highlight code block
- [ ] Temi codice
- [ ] Numeri riga nei code block
- [ ] Copy button nei code block
- [ ] Code block eseguibili opzionali
- [ ] Rendering matematico KaTeX/MathJax
- [ ] Math inline
- [ ] Math block
- [ ] Mermaid
- [ ] PlantUML
- [ ] Graphviz
- [ ] D2
- [ ] Kroki opzionale
- [ ] Chart rendering
- [ ] SVG rendering
- [ ] Sanitizzazione HTML
- [ ] HTML embed sicuro
- [ ] iframe opzionali sandboxati
- [ ] Link esterni con icona
- [ ] Preview link al passaggio mouse
- [ ] Preview immagini
- [ ] Lightbox immagini
- [ ] Zoom immagini
- [ ] Caption immagini
- [ ] Alt text immagini
- [ ] Lazy loading immagini
- [ ] PDF embed
- [ ] Audio player
- [ ] Video player
- [ ] Sottotitoli
- [ ] Trascrizioni
- [ ] Rendering responsive
- [ ] Rendering mobile ottimizzato
- [ ] Rendering ad alto contrasto
- [ ] Rendering ridotto per motion
- [ ] Rendering accessibile

## 6.2 Personalizzazione rendering

- [ ] CSS personalizzato
- [ ] Temi
- [ ] Snippet CSS
- [ ] Font personalizzati
- [ ] Dimensione font
- [ ] Interlinea
- [ ] Larghezza contenuto
- [ ] Modalità chiara/scura
- [ ] Tema automatico da sistema
- [ ] CSS per nota
- [ ] CSS per cartella
- [ ] CSS per tipo nota
- [ ] Classi CSS da frontmatter
- [ ] Componenti UI personalizzati
- [ ] Stili di stampa
- [ ] Preview responsive
- [ ] Modalità mobile ottimizzata
- [ ] Alto contrasto
- [ ] Reduced motion
- [ ] Reduced transparency
- [ ] Colorblind palettes
- [ ] Dyslexia-friendly fonts
- [ ] Text spacing regolabile
- [ ] Line length regolabile

## 6.3 Print / PDF avanzato

- [ ] Page size selection
- [ ] Margins selection
- [ ] Headers/footers
- [ ] Page numbers
- [ ] Cover page
- [ ] TOC page
- [ ] Page breaks
- [ ] Widow/orphan control
- [ ] Print CSS
- [ ] Print preview
- [ ] PDF via Pandoc
- [ ] PDF via Typst
- [ ] PDF via WeasyPrint
- [ ] PDF via browser print
- [ ] Export con allegati
- [ ] Export senza allegati
- [ ] Export note selezionate
- [ ] Export collezione
- [ ] Export progetto
- [ ] Export book
- [ ] Export report
- [ ] Export thesis
- [ ] Export paper
- [ ] Export slides
- [ ] Export handouts
- [ ] Export con annotazioni
- [ ] Export con commenti
- [ ] Export con highlight
- [ ] Export con metadata
- [ ] Export con bibliografia

---

# 7. Link, backlink, transclusione e grafo

## 7.1 Link

- [ ] Wikilink
- [ ] Markdown link
- [ ] Link relativi
- [ ] Link assoluti interni opzionali
- [ ] Link esterni
- [ ] Link con alias
- [ ] Link a heading
- [ ] Link a blocco
- [ ] Link a riga
- [ ] Link a ricerca
- [ ] Link a tag
- [ ] Link a proprietà
- [ ] Link a canvas
- [ ] Link a database
- [ ] Link a file allegato
- [ ] Link a block embed
- [ ] Link a transclusione
- [ ] Link automatici da alias
- [ ] Suggerimento link durante digitazione
- [ ] Creazione nota da link mancante
- [ ] Auto-link termini da glossario
- [ ] Redirect da note rinominate
- [ ] Stable note ID
- [ ] Stable block ID
- [ ] Link preview
- [ ] Hover popover
- [ ] Apertura link in scheda
- [ ] Apertura link in split
- [ ] Apertura link in popup
- [ ] Navigazione back/forward
- [ ] Breadcrumb navigazione

## 7.2 Backlink

- [ ] Pannello backlink
- [ ] Backlink per nota
- [ ] Backlink per blocco
- [ ] Backlink per heading
- [ ] Backlink contestuali
- [ ] Conteggio backlink
- [ ] Backlink in linea
- [ ] Backlink raggruppati
- [ ] Filtri backlink
- [ ] Ordinamento backlink
- [ ] Menzioni non collegate
- [ ] Collegamento rapido da menzioni
- [ ] Outgoing links
- [ ] Link non risolti
- [ ] Link rotti
- [ ] Report link rotti
- [ ] Fix automatico link rotti opzionale
- [ ] Rinomina sicura
- [ ] Spostamento sicuro
- [ ] Alias multipli
- [ ] Redirect manager
- [ ] Broken links checker
- [ ] Orphan notes detector
- [ ] Unused attachments detector
- [ ] Duplicate notes detector
- [ ] Empty notes detector
- [ ] Missing frontmatter detector
- [ ] Missing tags detector
- [ ] Missing aliases detector
- [ ] Stale notes detector
- [ ] Note con review scaduta
- [ ] Note con metadata incompleti
- [ ] Note con titolo duplicato
- [ ] Note con nome file non conforme
- [ ] Cleanup wizard
- [ ] Bulk fix problemi
- [ ] Health score vault
- [ ] Health score nota
- [ ] Suggerimenti archiviazione
- [ ] Suggerimenti unione note duplicate
- [ ] Suggerimenti split note troppo lunghe
- [ ] Suggerimenti link interni mancanti
- [ ] Suggerimenti tag mancanti
- [ ] Suggerimenti proprietà mancanti

## 7.3 Grafo della conoscenza

- [ ] Grafo globale
- [ ] Grafo locale
- [ ] Grafo per nota
- [ ] Grafo per tag
- [ ] Grafo per cartella
- [ ] Grafo per proprietà
- [ ] Grafo per query
- [ ] Profondità regolabile
- [ ] Filtri nodi
- [ ] Filtri link
- [ ] Filtri tag
- [ ] Filtri cartelle
- [ ] Filtri tipo nota
- [ ] Gruppi colore
- [ ] Gruppi per proprietà
- [ ] Dimensione nodi per backlink
- [ ] Forza link regolabile
- [ ] Fisica simulata
- [ ] Layout statici
- [ ] Layout radiali
- [ ] Layout gerarchici
- [ ] Layout force-directed
- [ ] Ricerca nel grafo
- [ ] Focus nodo
- [ ] Espansione nodo
- [ ] Collapse nodo
- [ ] Hover preview
- [ ] Click apertura nota
- [ ] Multi-select
- [ ] Selezione gruppo
- [ ] Degree centrality
- [ ] Note più collegate
- [ ] Note orfane
- [ ] Cluster
- [ ] Comunità
- [ ] Bridge notes
- [ ] Dead ends
- [ ] Mappa note isolate
- [ ] Salvataggio viste grafo
- [ ] Esportazione grafo PNG
- [ ] Esportazione grafo SVG
- [ ] Esportazione dati grafo JSON
- [ ] Grafo 3D opzionale
- [ ] Minimap
- [ ] Zoom fluido
- [ ] Pan fluido
- [ ] Performance con vault grandi
- [ ] Accessibilità grafo
- [ ] Vista elenco alternativa al grafo
- [ ] Pathfinding
- [ ] Shortest path
- [ ] Semantic graph
- [ ] Concept graph
- [ ] Entity graph
- [ ] Timeline graph
- [ ] Graph annotations

---

# 8. Organizzazione, metadata, tassonomia e collezioni

## 8.1 Organizzazione base

- [ ] Cartelle
- [ ] Sottocartelle illimitate
- [ ] Tag
- [ ] Tag annidati
- [ ] Alias
- [ ] Preferiti
- [ ] Note fissate
- [ ] Archivio
- [ ] Inbox
- [ ] Cestino
- [ ] Note recenti
- [ ] Note modificate di recente
- [ ] Note create di recente
- [ ] Note aperte di recente
- [ ] Quick switcher
- [ ] Command palette
- [ ] Sidebar personalizzabili
- [ ] Pannello tag
- [ ] Pannello outline
- [ ] Pannello proprietà
- [ ] Favorites
- [ ] Pinned
- [ ] Recent
- [ ] Breadcrumbs
- [ ] Workspaces

## 8.2 Metadata e proprietà

- [ ] Frontmatter YAML
- [ ] Proprietà typed
- [ ] Proprietà testo
- [ ] Proprietà numero
- [ ] Proprietà checkbox
- [ ] Proprietà data
- [ ] Proprietà data/ora
- [ ] Proprietà elenco
- [ ] Proprietà tag
- [ ] Proprietà alias
- [ ] Proprietà link
- [ ] Proprietà colore
- [ ] Proprietà icona
- [ ] Proprietà rating
- [ ] Proprietà URL
- [ ] Proprietà email
- [ ] Proprietà file
- [ ] Proprietà immagine
- [ ] Proprietà calcolo
- [ ] Proprietà rollup
- [ ] Proprietà relazione
- [ ] Proprietà formula
- [ ] Validazione proprietà
- [ ] Schema per tipo nota
- [ ] Template proprietà
- [ ] Proprietà obbligatorie
- [ ] Proprietà suggerite
- [ ] Proprietà nascoste
- [ ] Proprietà calcolate
- [ ] Metadata automatici
- [ ] Folder-level metadata
- [ ] Inherited metadata
- [ ] Computed properties
- [ ] Rollup properties
- [ ] Note classes
- [ ] Note schemas
- [ ] Required properties
- [ ] Suggested properties
- [ ] Hidden properties
- [ ] Property types personalizzati
- [ ] Relation types personalizzati
- [ ] Metadata audit
- [ ] Metadata history
- [ ] Metadata rollback

## 8.3 Note types e smart organization

- [ ] Tipi nota
- [ ] Icona per tipo nota
- [ ] Colore per tipo nota
- [ ] Template per tipo nota
- [ ] Cartella default per tipo nota
- [ ] Regole auto-archiviazione
- [ ] Regole auto-spostamento
- [ ] Regole auto-tag
- [ ] Smart folder
- [ ] Saved search
- [ ] Viste salvate
- [ ] Dashboard personalizzate
- [ ] Note giornaliere
- [ ] Note settimanali
- [ ] Note mensili
- [ ] Note annuali
- [ ] Periodic notes
- [ ] Naming automatico note periodiche
- [ ] Template note periodiche
- [ ] Zettelkasten ID
- [ ] ID univoco nota
- [ ] Numerazione progressiva opzionale
- [ ] Naming file automatico
- [ ] Slugify titoli
- [ ] Prevenzione duplicati
- [ ] Gestione note orfane
- [ ] Gestione note vuote
- [ ] Note in evidenza
- [ ] Note correlate
- [ ] Note simili
- [ ] Map of Content
- [ ] Hub notes
- [ ] Index notes
- [ ] Structure notes
- [ ] Note sets
- [ ] Note sequences
- [ ] Learning paths

## 8.4 Collezioni e smart collection

- [ ] Collezioni manuali
- [ ] Collezioni automatiche
- [ ] Smart collections
- [ ] Collezioni annidate
- [ ] Collezioni temporanee
- [ ] Collezioni condivise
- [ ] Collezioni salvate
- [ ] Collezioni dinamiche da query
- [ ] Collezioni da tag
- [ ] Collezioni da proprietà
- [ ] Collezioni da ricerca
- [ ] Collezioni da cartella
- [ ] Collezioni da tipo nota
- [ ] Collezioni da stato
- [ ] Collezioni da review
- [ ] Collezioni da progetto
- [ ] Collezioni da archive
- [ ] Collezioni da inbox
- [ ] Collezioni da stale
- [ ] Collezioni da orfane

## 8.5 Tassonomia, ontologia e linked data

- [ ] Controlled vocabularies
- [ ] Tag manager
- [ ] Alias manager
- [ ] Thesaurus
- [ ] Ontologie leggere
- [ ] Relation types
- [ ] Custom predicates
- [ ] Schema.org mapping
- [ ] JSON-LD export
- [ ] RDF export opzionale
- [ ] Dublin Core metadata
- [ ] Linked data support
- [ ] Entity resolution
- [ ] Entity linking
- [ ] Person entities
- [ ] Organization entities
- [ ] Place entities
- [ ] Event entities
- [ ] Concept entities
- [ ] Work entities
- [ ] Entity graph
- [ ] Taxonomy browser
- [ ] Ontology editor
- [ ] Vocabulary import
- [ ] SKOS support
- [ ] Wikidata import opzionale
- [ ] Authority control
- [ ] Name disambiguation
- [ ] Canonical entities
- [ ] Entity aliases

---

# 9. Ricerca, query, discovery e knowledge lifecycle

## 9.1 Ricerca base e avanzata

- [ ] Ricerca globale
- [ ] Ricerca rapida
- [ ] Full-text
- [ ] Fuzzy
- [ ] Esatta
- [ ] Operatori
- [ ] Regex
- [ ] Wildcard
- [ ] Prossimità
- [ ] Field-specific
- [ ] Ricerca per percorso
- [ ] Ricerca per nome file
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
- [ ] Saved search
- [ ] Highlight risultati
- [ ] Anteprima risultati
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
- [ ] Snippet contestuali
- [ ] Ranking personalizzabile
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

---

# 10. Task, calendario, produttività e notifiche

## 10.1 Task base

- [ ] Checkbox Markdown
- [ ] Task annidati
- [ ] Sotto-task
- [ ] Stato completato
- [ ] Stato non completato
- [ ] Stati personalizzati
- [ ] Stato in corso
- [ ] Stato cancellato
- [ ] Stato bloccato
- [ ] Stato in attesa
- [ ] Data completamento
- [ ] Data creazione task
- [ ] Data modifica task
- [ ] Task ID
- [ ] Task ricorrenti
- [ ] Ricorrenza giornaliera
- [ ] Ricorrenza settimanale
- [ ] Ricorrenza mensile
- [ ] Ricorrenza annuale
- [ ] Ricorrenza personalizzata

## 10.2 Metadata task

- [ ] Due date
- [ ] Scheduled date
- [ ] Start date
- [ ] Priority
- [ ] Tags task
- [ ] Context
- [ ] Energy level
- [ ] Time estimate
- [ ] Time spent
- [ ] Dipendenze
- [ ] Task bloccati da altri task
- [ ] Task collegati a note
- [ ] Task collegati a progetti
- [ ] Task collegati a proprietà
- [ ] Task con allegati
- [ ] Task con commenti
- [ ] Task con checklist
- [ ] Task con progress
- [ ] Task completamento automatico
- [ ] Task in blocco

## 10.3 Viste task

- [ ] Lista task globale
- [ ] Task per nota
- [ ] Task per tag
- [ ] Task per cartella
- [ ] Task per data
- [ ] Task scaduti
- [ ] Task oggi
- [ ] Task domani
- [ ] Task settimana
- [ ] Task completati
- [ ] Task in backlog
- [ ] Kanban task
- [ ] Calendar task
- [ ] Timeline task
- [ ] Task query
- [ ] Task embed
- [ ] Task reminders
- [ ] Notifiche task
- [ ] Pomodoro opzionale
- [ ] Time tracking opzionale

## 10.4 Calendario e agenda

- [ ] Calendario integrato
- [ ] Vista mese
- [ ] Vista settimana
- [ ] Vista giorno
- [ ] Vista agenda
- [ ] Eventi da note
- [ ] Eventi da task
- [ ] Eventi da proprietà data
- [ ] Import iCal
- [ ] Export iCal
- [ ] Promemoria calendario
- [ ] Timezone management
- [ ] World clock
- [ ] Date math
- [ ] Workweek localization
- [ ] First day of week
- [ ] Regional holidays
- [ ] Calendar localization
- [ ] Calendar sync opzionale
- [ ] CalDAV
- [ ] Google Calendar import/export opzionale

## 10.5 Notifiche e promemoria

- [ ] Notification center
- [ ] Notifiche desktop
- [ ] Notifiche mobile
- [ ] Notifiche email opzionali
- [ ] Notifiche webhook
- [ ] Digest giornaliero
- [ ] Digest settimanale
- [ ] Quiet hours
- [ ] Do not disturb
- [ ] Promemoria nota
- [ ] Promemoria task
- [ ] Promemoria evento
- [ ] Promemoria review
- [ ] Snooze
- [ ] Recurrence reminders
- [ ] Relative reminders
- [ ] Absolute reminders
- [ ] Reminder da proprietà data
- [ ] Reminder da task due
- [ ] Reminder da calendario
- [ ] Alert stale notes
- [ ] Alert broken links
- [ ] Alert sync errors
- [ ] Alert backup errors
- [ ] Alert plugin errors
- [ ] Notification filters
- [ ] Notification rules
- [ ] Notification history

---

# 11. Database, data editor, ETL e dashboard

## 11.1 Database engine

- [ ] Database nativo come plugin Suite
- [ ] Database basato su file Markdown/CSV/JSON
- [ ] Indice locale SQLite opzionale
- [ ] Nessun database proprietario obbligatorio
- [ ] Righe come note o record
- [ ] Colonne come proprietà
- [ ] Tipi colonna
- [ ] Colonne testo
- [ ] Colonne numero
- [ ] Colonne select
- [ ] Colonne multi-select
- [ ] Colonne checkbox
- [ ] Colonne data
- [ ] Colonne data/ora
- [ ] Colonne persona
- [ ] Colonne file
- [ ] Colonne URL
- [ ] Colonne email
- [ ] Colonne rating
- [ ] Colonne formula
- [ ] Colonne rollup
- [ ] Colonne relazione
- [ ] Relazioni bidirezionali
- [ ] Relazioni multiple
- [ ] Self relation
- [ ] Lookup
- [ ] Validazione dati
- [ ] Campi obbligatori
- [ ] Campi unici
- [ ] Default values

## 11.2 Viste database

- [ ] Vista tabella
- [ ] Vista board
- [ ] Vista calendario
- [ ] Vista gallery
- [ ] Vista lista
- [ ] Vista timeline
- [ ] Vista form
- [ ] Vista mappa opzionale
- [ ] Vista chart
- [ ] Vista pivot opzionale
- [ ] Filtri per vista
- [ ] Ordinamento per vista
- [ ] Raggruppamento per vista
- [ ] Colonne visibili per vista
- [ ] Larghezza colonne
- [ ] Freeze colonne
- [ ] Calcoli in fondo colonna
- [ ] Formule per vista
- [ ] Vista salvata
- [ ] Viste multiple per database

## 11.3 Editing database

- [ ] Editing inline
- [ ] Editing modale
- [ ] Editing bulk
- [ ] Drag & drop righe
- [ ] Drag & drop colonne
- [ ] Duplicazione record
- [ ] Eliminazione record
- [ ] Undo/redo database
- [ ] Import CSV
- [ ] Export CSV
- [ ] Import JSON
- [ ] Export JSON
- [ ] Import da query
- [ ] Database da cartella
- [ ] Database da tag
- [ ] Database da proprietà
- [ ] Database relazionali tra vault
- [ ] Database embed
- [ ] Database sincronizzati
- [ ] Database template

## 11.4 Data editor / ETL

- [ ] CSV editor
- [ ] TSV editor
- [ ] JSON editor
- [ ] YAML editor
- [ ] TOML editor
- [ ] XML editor opzionale
- [ ] Schema editor
- [ ] JSON Schema validation
- [ ] CSV schema validation
- [ ] Data validation rules
- [ ] Data grid virtualizzata
- [ ] Column types
- [ ] Column resize
- [ ] Column freeze
- [ ] Column sort
- [ ] Column filter
- [ ] Column formulas
- [ ] Data transforms
- [ ] Import mapping
- [ ] Import profiles
- [ ] Field mapping UI
- [ ] Dedupe data
- [ ] Normalize data
- [ ] Join data
- [ ] Aggregate data
- [ ] SQL over local index
- [ ] Query parameters
- [ ] Parameterized forms for queries
- [ ] ETL leggero
- [ ] Data import scheduler
- [ ] Data export scheduler
- [ ] Data sync da CSV
- [ ] Data sync da JSON
- [ ] Data sync da API
- [ ] Data cleaning wizard
- [ ] Data preview before import
- [ ] Rollback import

## 11.5 Dashboard e widget

- [ ] Dashboard personalizzabili
- [ ] Widget testo
- [ ] Widget Markdown
- [ ] Widget query
- [ ] Widget tabella
- [ ] Widget chart
- [ ] Widget task
- [ ] Widget calendario
- [ ] Widget database
- [ ] Widget counter
- [ ] Widget progress
- [ ] Widget heatmap
- [ ] Widget sparkline
- [ ] Widget stat card
- [ ] Widget image
- [ ] Widget canvas embed
- [ ] Widget note preview
- [ ] Widget quick capture
- [ ] Dashboard per progetto
- [ ] Dashboard per vault
- [ ] Dashboard per workspace
- [ ] Dashboard mobile
- [ ] Dashboard fullscreen
- [ ] Dashboard presentation mode

---

# 12. Canvas, whiteboard, diagrammi e presentazioni

## 12.1 Canvas base

- [ ] Canvas infinito
- [ ] Nodo nota
- [ ] Nodo testo
- [ ] Nodo immagine
- [ ] Nodo PDF
- [ ] Nodo audio
- [ ] Nodo video
- [ ] Nodo embed
- [ ] Nodo query
- [ ] Nodo database
- [ ] Nodo web embed opzionale
- [ ] Connessioni tra nodi
- [ ] Frecce direzionali
- [ ] Linee libere
- [ ] Gruppi
- [ ] Frame
- [ ] Layer
- [ ] Colori
- [ ] Stili bordo
- [ ] Ombre

## 12.2 Canvas avanzato

- [ ] Griglia
- [ ] Snap to grid
- [ ] Allineamento
- [ ] Distribuzione
- [ ] Raggruppamento
- [ ] Blocco elementi
- [ ] Minimap
- [ ] Zoom
- [ ] Pan
- [ ] Ricerca nodi
- [ ] Filtri nodi
- [ ] Collegamento a note
- [ ] Navigazione da canvas
- [ ] Canvas template
- [ ] Canvas embed in nota
- [ ] Esportazione PNG
- [ ] Esportazione SVG
- [ ] Esportazione PDF
- [ ] Formato canvas aperto
- [ ] Versioning canvas
- [ ] Commenti su canvas
- [ ] Collaborazione canvas opzionale
- [ ] Presentazione da canvas
- [ ] Mindmap mode
- [ ] Flowchart mode
- [ ] Diagram mode
- [ ] Sticky notes
- [ ] Drawing a mano libera
- [ ] Supporto penna/stilo
- [ ] Pressure sensitivity
- [ ] Canvas accessibility alternatives

## 12.3 Diagrammi e visual thinking

- [ ] Mermaid live editor
- [ ] PlantUML editor
- [ ] Graphviz editor
- [ ] D2 support
- [ ] Kroki support opzionale
- [ ] Excalidraw-like drawing
- [ ] draw.io import
- [ ] draw.io export
- [ ] tldraw-like drawing opzionale
- [ ] SVG editing
- [ ] Shapes library
- [ ] Connectors
- [ ] Arrows labels
- [ ] Layers
- [ ] Frames
- [ ] Groups
- [ ] Snap
- [ ] Align
- [ ] Distribute
- [ ] Grid
- [ ] Minimap
- [ ] Zoom
- [ ] Pan
- [ ] Pen drawing
- [ ] Eraser
- [ ] Pressure sensitivity
- [ ] Sticky notes
- [ ] Text boxes
- [ ] Image nodes
- [ ] Note nodes
- [ ] Query nodes
- [ ] Database nodes
- [ ] Canvas templates
- [ ] Canvas export
- [ ] Canvas publish
- [ ] Canvas collaboration
- [ ] Canvas versioning
- [ ] Canvas comments
- [ ] Canvas presentation
- [ ] Canvas accessibility alternatives

## 12.4 Presentazioni e slide

- [ ] Slide mode da headings
- [ ] Slide mode da note
- [ ] Slide mode da canvas
- [ ] Speaker notes
- [ ] Presenter view
- [ ] Timer
- [ ] Slide transitions
- [ ] Slide themes
- [ ] Slide export PDF
- [ ] Slide export PPTX opzionale
- [ ] Slide export HTML
- [ ] Slide remote control
- [ ] Slide laser pointer
- [ ] Slide annotations
- [ ] Slide black screen
- [ ] Slide overview
- [ ] Slide search
- [ ] Slide embed
- [ ] Slide publishing
- [ ] Slide collaboration
- [ ] Slide from query
- [ ] Slide from database
- [ ] Slide from canvas frames
- [ ] Slide from outline
- [ ] Slide from markdown
- [ ] Slide notes separation
- [ ] Slide incremental lists
- [ ] Slide code highlighting
- [ ] Slide math rendering
- [ ] Slide diagrams rendering

---

# 13. Allegati, media, annotazioni e audio/video

## 13.1 Gestione allegati

- [ ] Allegati locali
- [ ] Cartella allegati configurabile
- [ ] Regole per sottocartelle allegati
- [ ] Rinomina allegati
- [ ] Aggiornamento riferimenti su rinomina
- [ ] Spostamento allegati
- [ ] Eliminazione allegati
- [ ] Rilevamento allegati orfani
- [ ] Deduplicazione allegati
- [ ] Hash/checksum file
- [ ] Metadata file
- [ ] Dimensione file
- [ ] Tipo MIME
- [ ] Data creazione
- [ ] Data modifica
- [ ] EXIF immagini
- [ ] ID3 audio
- [ ] Metadata video
- [ ] Preview file
- [ ] Thumbnail automatiche
- [ ] Encrypted thumbnails
- [ ] Attachment compression
- [ ] Attachment conversion
- [ ] Attachment rename references
- [ ] Alt text
- [ ] Caption
- [ ] Media metadata
- [ ] OCR
- [ ] Transcription
- [ ] Thumbnail cache management

## 13.2 Media

- [ ] Visualizzazione immagini
- [ ] Zoom immagini
- [ ] Rotazione immagini
- [ ] Crop base immagini
- [ ] Compressione immagini opzionale
- [ ] Conversione formati immagini
- [ ] Audio player
- [ ] Video player
- [ ] Sottotitoli
- [ ] Trascrizione audio opzionale
- [ ] PDF viewer
- [ ] Annotazioni PDF
- [ ] Highlight PDF
- [ ] Note da selezione PDF
- [ ] OCR immagini opzionale
- [ ] OCR PDF opzionale
- [ ] Ricerca testo in immagini
- [ ] Ricerca testo in PDF
- [ ] SVG sanitizzato
- [ ] Embed sicuri

## 13.3 Annotazioni profonde

- [ ] Highlight PDF testuali
- [ ] Highlight PDF ad area
- [ ] Commenti PDF
- [ ] Forme su PDF
- [ ] Frecce su PDF
- [ ] Timbri su PDF
- [ ] Note adesive su PDF
- [ ] Deep link a pagina PDF
- [ ] Deep link a selezione PDF
- [ ] Deep link ad annotazione PDF
- [ ] Export annotazioni PDF in Markdown
- [ ] Sincronizzazione annotazioni PDF
- [ ] Annotazioni EPUB
- [ ] Highlight EPUB
- [ ] Note EPUB
- [ ] Deep link a posizione EPUB
- [ ] Annotazioni web
- [ ] Highlight web persistenti
- [ ] Commenti web salvati localmente
- [ ] Annotazioni immagini
- [ ] Regioni immagine annotabili
- [ ] OCR layer per immagini
- [ ] OCR per PDF scansionati
- [ ] Ricerca dentro annotazioni
- [ ] Colori annotazione semanticamente assegnabili
- [ ] Tag per annotazione
- [ ] ID univoco annotazione
- [ ] Versioning annotazioni
- [ ] Revisione annotazioni

## 13.4 Audio, video e meeting

- [ ] Registratore audio integrato
- [ ] Registrazione vocale in nota
- [ ] Timestamp durante registrazione
- [ ] Marker durante registrazione
- [ ] Trascrizione audio locale
- [ ] Trascrizione audio cloud opzionale
- [ ] Trascrizione video
- [ ] Sottotitoli
- [ ] Speaker diarization
- [ ] Riconoscimento parlanti
- [ ] Riassunto automatico riunione
- [ ] Estrazione action items
- [ ] Collegamento audio a trascrizione
- [ ] Ricerca dentro trascrizioni
- [ ] Clip audio annotabili
- [ ] Clip video annotabili
- [ ] Voice memo con template
- [ ] Voice commands
- [ ] Dettatura vocale
- [ ] Dettatura offline
- [ ] Conversione voce-testo in nota
- [ ] Meeting notes template
- [ ] Verbale riunione strutturato
- [ ] Partecipanti riunione
- [ ] Decisioni riunione
- [ ] Follow-up riunione
- [ ] Allegato registrazione riunione
- [ ] Privacy mode per trascrizioni

---

# 14. Cattura, inbox, web clipper, email e read-it-later

## 14.1 Quick capture

- [ ] Quick capture globale
- [ ] Finestra floating di cattura rapida
- [ ] Hotkey globale
- [ ] Cattura da tray/menu bar
- [ ] Cattura da notifica
- [ ] Cattura da lock screen mobile
- [ ] Cattura da share sheet
- [ ] Cattura da clipboard
- [ ] Clipboard watcher opzionale
- [ ] Cattura vocale
- [ ] Cattura foto
- [ ] Scanner documenti
- [ ] OCR da screenshot
- [ ] OCR da fotocamera
- [ ] Inbox unica di raccolta
- [ ] Triage dell’inbox
- [ ] Regole automatiche di smistamento inbox
- [ ] Nota “al volo” senza aprire il vault
- [ ] Cattura con template rapido
- [ ] Cattura con tag rapido

## 14.2 Web clipper

- [ ] Browser extension ufficiale
- [ ] Clip di selezione testo
- [ ] Clip di pagina intera
- [ ] Clip in modalità lettura semplificata
- [ ] Clip di articoli con metadata
- [ ] Clip di highlight web
- [ ] Clip di screenshot
- [ ] Clip di PDF online
- [ ] Salvataggio offline della pagina
- [ ] Archiviazione permanente della pagina
- [ ] Import da Pocket
- [ ] Import da Instapaper
- [ ] Import da Raindrop
- [ ] Import da Readwise
- [ ] Import da Hypothesis
- [ ] Import da RSS/Atom
- [ ] Read-it-later integrato
- [ ] Modalità articolo pulito
- [ ] Gestione “da leggere”
- [ ] Stato di lettura
- [ ] Tempo di lettura stimato
- [ ] Highlight web sincronizzati
- [ ] Annotazioni web salvate in Markdown
- [ ] Canonical URL e metadata automatici
- [ ] Autore, data, sito, lingua automatici

## 14.3 Email e fonti esterne

- [ ] Import EML
- [ ] Import MBOX
- [ ] Email-to-note opzionale
- [ ] Inoltro email a vault locale/self-hosted
- [ ] Import thread email
- [ ] Conversione email in Markdown
- [ ] Allegati email importati
- [ ] Import da client email via file
- [ ] Import da chat export
- [ ] Import da social/post
- [ ] Import da newsletter
- [ ] Import da feed RSS
- [ ] Import da podcast/show notes
- [ ] Import da trascrizioni
- [ ] Import da sottotitoli
- [ ] Import da URL con metadata
- [ ] Import da SingleFile
- [ ] Import da archivi web
- [ ] Import da bookmark HTML
- [ ] Import da CSV di servizi esterni

---

# 15. Reference manager, accademia e ricerca

## 15.1 Reference manager

- [ ] Gestione bibliografia integrata
- [ ] Supporto BibTeX
- [ ] Supporto BibLaTeX
- [ ] Supporto CSL JSON
- [ ] Supporto CSL styles
- [ ] Citation picker
- [ ] Autocompletamento citazioni
- [ ] Citation keys
- [ ] Inserimento citazioni in nota
- [ ] Bibliografia automatica
- [ ] Note a piè di pagina accademiche
- [ ] Stili citazionali configurabili
- [ ] Integrazione Zotero
- [ ] Integrazione Mendeley opzionale
- [ ] Import da Zotero
- [ ] Export verso Zotero
- [ ] Collegamento PDF a riferimento
- [ ] Annotazioni PDF collegate a reference
- [ ] Letterature review matrix
- [ ] Evidence table
- [ ] Quote bank
- [ ] Gestione fonti
- [ ] DOI resolver
- [ ] ISBN metadata fetch opzionale
- [ ] ORCID supporto
- [ ] Crossref metadata opzionale
- [ ] Note bibliografiche strutturate
- [ ] Export bibliografico
- [ ] Bibliografia per progetto
- [ ] Bibliografia per vault

## 15.2 Scrittura accademica avanzata

- [ ] Equazioni numerate
- [ ] Riferimenti incrociati
- [ ] Cross-reference a figure
- [ ] Cross-reference a tabelle
- [ ] Cross-reference a sezioni
- [ ] Cross-reference a equazioni
- [ ] Elenco figure automatico
- [ ] Elenco tabelle automatico
- [ ] Indice analitico
- [ ] Glossario
- [ ] Lista abbreviazioni
- [ ] Teoremi/lemma/definizione
- [ ] Blocchi proof
- [ ] Ambienti matematici personalizzati
- [ ] Supporto mhchem
- [ ] Supporto physics notation
- [ ] Macro LaTeX-like
- [ ] Export LaTeX
- [ ] Export Typst
- [ ] Export Pandoc avanzato
- [ ] Template documento accademico
- [ ] Template tesi
- [ ] Template paper
- [ ] Template report
- [ ] Gestione capitoli
- [ ] Compilazione manuscript
- [ ] Note a margine accademiche
- [ ] Commenti revisione accademica

## 15.3 Ricerca e knowledge synthesis

- [ ] Source matrix
- [ ] Evidence table
- [ ] Quote bank
- [ ] Claim/evidence structure
- [ ] Annotation taxonomy
- [ ] Literature notes
- [ ] Permanent notes
- [ ] Reference links
- [ ] Citation graph
- [ ] Related papers
- [ ] Concept extraction
- [ ] Argument mapping
- [ ] Pros/cons tables
- [ ] Decision matrix
- [ ] SWOT
- [ ] Comparison tables
- [ ] Synthesis notes
- [ ] Meta-notes
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

---

# 16. Template, snippet, automazioni e scripting

## 16.1 Template

- [ ] Template nota
- [ ] Template cartella
- [ ] Template globale
- [ ] Template giornaliero
- [ ] Template settimanale
- [ ] Template mensile
- [ ] Template annuale
- [ ] Template database
- [ ] Template canvas
- [ ] Template task
- [ ] Template progetto
- [ ] Template riunione
- [ ] Template diario
- [ ] Template flashcard
- [ ] Template contatto
- [ ] Variabili template
- [ ] Variabili data
- [ ] Variabili vault
- [ ] Variabili clipboard
- [ ] Variabili selezione
- [ ] Prompt input
- [ ] Cursor placement
- [ ] Inclusione template
- [ ] Template annidati
- [ ] Template condizionali
- [ ] Template con query
- [ ] Template con script
- [ ] Template da nota esistente
- [ ] Template marketplace
- [ ] Template utente condivisibili
- [ ] Template localizzati

## 16.2 Automazioni

- [ ] Comandi personalizzati
- [ ] Macro
- [ ] Catene di comandi
- [ ] Hotkey personalizzate
- [ ] Trigger su creazione nota
- [ ] Trigger su modifica nota
- [ ] Trigger su apertura nota
- [ ] Trigger su chiusura nota
- [ ] Trigger su salvataggio
- [ ] Trigger su tag aggiunto
- [ ] Trigger su proprietà cambiata
- [ ] Trigger su task completato
- [ ] Trigger su file importato
- [ ] Trigger su orario
- [ ] Trigger su data
- [ ] Trigger su intervallo
- [ ] Automazioni locali
- [ ] Automazioni condizionali
- [ ] Azioni automatiche
- [ ] Log automazioni
- [ ] Undo automazioni
- [ ] Automazioni disattivabili
- [ ] Automazioni per vault
- [ ] Automazioni per cartella
- [ ] Automazioni per tipo nota
- [ ] Scripting plugin
- [ ] URI actions
- [ ] CLI actions
- [ ] Webhook locali opzionali
- [ ] Integrazione con strumenti esterni opzionale

## 16.3 Automazione avanzata / no-code

- [ ] Automation builder visuale
- [ ] Trigger multipli
- [ ] Condizioni
- [ ] Azioni
- [ ] Delay
- [ ] Schedule
- [ ] File watchers
- [ ] Webhooks
- [ ] Local API triggers
- [ ] CLI triggers
- [ ] URI triggers
- [ ] Macro recorder
- [ ] Script runner
- [ ] JavaScript scripts
- [ ] Python scripts opzionali
- [ ] Lua scripts opzionali
- [ ] Sandbox scripts
- [ ] Automation logs
- [ ] Automation undo
- [ ] Automation disable
- [ ] Automation templates
- [ ] Automation marketplace
- [ ] Automation permissions
- [ ] Automation rate limits
- [ ] Automation error handling
- [ ] Automation retries
- [ ] Automation notifications
- [ ] Automation testing
- [ ] Automation versioning
- [ ] Automation export/import
- [ ] Automation sharing

---

# 17. Import, export, migration e interoperabilità

## 17.1 Import

- [ ] Import Markdown
- [ ] Import cartella Markdown
- [ ] Import ZIP
- [ ] Import Obsidian vault
- [ ] Import Notion export
- [ ] Import Evernote export
- [ ] Import Joplin export
- [ ] Import Bear export
- [ ] Import Roam export
- [ ] Import Logseq export
- [ ] Import HTML
- [ ] Import EPUB
- [ ] Import DOCX
- [ ] Import ODT
- [ ] Import PDF come allegato
- [ ] Import PDF con estrazione testo opzionale
- [ ] Import CSV
- [ ] Import JSON
- [ ] Import OPML
- [ ] Import org-mode
- [ ] Import reStructuredText
- [ ] Import LaTeX opzionale
- [ ] Import BibTeX
- [ ] Import RSS/Atom opzionale
- [ ] Import da URL
- [ ] Import da clipboard
- [ ] Import immagini con OCR
- [ ] Import audio con trascrizione
- [ ] Import video con trascrizione
- [ ] Import da API esterne opzionale
- [ ] Import EML
- [ ] Import MBOX
- [ ] Import SingleFile
- [ ] Import Hypothesis
- [ ] Import Readwise
- [ ] Import Zotero
- [ ] Import Anki .apkg
- [ ] Import GPX
- [ ] Import GeoJSON
- [ ] Import KML
- [ ] Import vCard
- [ ] Import iCal
- [ ] Import RIS
- [ ] Import CSL JSON
- [ ] Import XML
- [ ] Import YAML
- [ ] Import TOML

## 17.2 Export

- [ ] Export Markdown
- [ ] Export vault completo
- [ ] Export ZIP
- [ ] Export HTML
- [ ] Export PDF
- [ ] Export DOCX
- [ ] Export ODT
- [ ] Export EPUB
- [ ] Export LaTeX
- [ ] Export CSV
- [ ] Export JSON
- [ ] Export OPML
- [ ] Export PNG
- [ ] Export SVG
- [ ] Export canvas
- [ ] Export database
- [ ] Export query results
- [ ] Export note selezionate
- [ ] Export cartella
- [ ] Export con allegati
- [ ] Export senza allegati
- [ ] Export con metadati
- [ ] Export senza metadati
- [ ] Export per pubblicazione
- [ ] Export static site
- [ ] Export Pandoc
- [ ] Export print-friendly
- [ ] Export note versionate
- [ ] Export backup completo
- [ ] Export portable vault
- [ ] Export Typst
- [ ] Export AsciiDoc
- [ ] Export TEI opzionale
- [ ] Export JATS opzionale
- [ ] Export GeoJSON
- [ ] Export GPX
- [ ] Export KML
- [ ] Export vCard
- [ ] Export iCal
- [ ] Export RIS
- [ ] Export CSL JSON
- [ ] Export XML
- [ ] Export YAML
- [ ] Export TOML

## 17.3 Migration assistant

- [ ] Pre-migration report
- [ ] Link conversion
- [ ] Attachment mapping
- [ ] Frontmatter mapping
- [ ] Tag normalization
- [ ] Duplicate handling
- [ ] Rollback
- [ ] Migration logs
- [ ] Migration profiles
- [ ] Migration preview
- [ ] Migration validation
- [ ] Migration retry
- [ ] Migration resume
- [ ] Migration audit
- [ ] Migration templates
- [ ] Migration da Obsidian
- [ ] Migration da Notion
- [ ] Migration da Evernote
- [ ] Migration da Joplin
- [ ] Migration da Bear
- [ ] Migration da Roam
- [ ] Migration da Logseq
- [ ] Migration da HTML
- [ ] Migration da DOCX
- [ ] Migration da EPUB
- [ ] Migration da PDF

---

# 18. Sync, backup, versioning, diff/merge

## 18.1 Sync

- [ ] Sync opzionale
- [ ] Sync non obbligatorio
- [ ] Sync locale via file system
- [ ] Sync con Syncthing
- [ ] Sync con Git
- [ ] Sync con WebDAV
- [ ] Sync con S3 compatibile
- [ ] Sync con Dropbox cartella
- [ ] Sync con OneDrive cartella
- [ ] Sync con iCloud cartella
- [ ] Sync ufficiale opzionale
- [ ] Sync E2EE
- [ ] Sync self-hosted
- [ ] Sync peer-to-peer opzionale
- [ ] Sync LAN
- [ ] Sync mobile
- [ ] Sync selettivo
- [ ] Esclusione cartelle
- [ ] Risoluzione conflitti
- [ ] Merge note conflittuali
- [ ] Cronologia sync
- [ ] Stato sync visibile
- [ ] Errori sync dettagliati
- [ ] Retry automatico
- [ ] Sync offline-first
- [ ] Sync differenziale
- [ ] Compressione sync
- [ ] Bandwidth limiting
- [ ] Sync in background
- [ ] Sync manuale
- [ ] CRDT sync
- [ ] Selective sync
- [ ] Ignored files
- [ ] Proxy support
- [ ] Offline queue
- [ ] Per-file status
- [ ] Large files handling
- [ ] Mobile background sync
- [ ] Conflict copies
- [ ] Sync logs
- [ ] Sync health
- [ ] Sync pause/resume
- [ ] Sync scheduling
- [ ] Sync on demand
- [ ] Sync only on Wi-Fi
- [ ] Sync metered network warning
- [ ] Sync battery saver
- [ ] Sync data saver
- [ ] Sync encryption key management
- [ ] Sync device revocation
- [ ] Sync session management
- [ ] Sync conflict UI
- [ ] Sync merge preview
- [ ] Sync history

## 18.2 Backup e versioning

- [ ] Backup automatico
- [ ] Backup manuale
- [ ] Snapshot vault
- [ ] Snapshot programmati
- [ ] Versioning note
- [ ] Cronologia note
- [ ] Diff versioni
- [ ] Ripristino versione
- [ ] Checkpoint manuali
- [ ] Checkpoint automatici
- [ ] Cestino versionato
- [ ] Recupero file eliminati
- [ ] Recupero dopo corruzione
- [ ] Export backup cifrato
- [ ] Verifica integrità backup
- [ ] Retention policy
- [ ] Pulizia vecchie versioni
- [ ] Backup su disco esterno
- [ ] Backup su cloud personale
- [ ] Ripristino completo vault
- [ ] 3-2-1 backup strategy
- [ ] Incremental backups
- [ ] Encrypted backups
- [ ] Deduplication
- [ ] Compression
- [ ] Offsite backups
- [ ] External drive backups
- [ ] Cloud adapters
- [ ] Retention policies
- [ ] Verification
- [ ] Restore test
- [ ] Snapshot browser
- [ ] Backup health
- [ ] Backup logs
- [ ] Backup notifications
- [ ] Backup exclusions
- [ ] Backup inclusions
- [ ] Backup per vault
- [ ] Backup per cartella
- [ ] Backup attachments separately
- [ ] Backup index optional
- [ ] Backup settings
- [ ] Backup encryption key management
- [ ] Backup recovery key
- [ ] Backup integrity checks
- [ ] Backup versioning
- [ ] Backup pruning
- [ ] Backup resume after interruption
- [ ] Backup bandwidth limits

## 18.3 Diff / merge avanzato

- [ ] Diff tra due note
- [ ] Diff tra versioni nota
- [ ] Diff side-by-side
- [ ] Diff inline
- [ ] Diff word-level
- [ ] Diff block-level
- [ ] Diff frontmatter
- [ ] Diff proprietà
- [ ] Diff tag
- [ ] Diff allegati
- [ ] Diff canvas
- [ ] Diff database
- [ ] Three-way merge
- [ ] Merge manuale conflitti
- [ ] Merge automatico sicuro
- [ ] Conflict copies
- [ ] Selective restore
- [ ] Version labels
- [ ] Named snapshots
- [ ] Snapshot browser
- [ ] Rollback a snapshot
- [ ] Confronto vault
- [ ] Confronto cartelle
- [ ] Confronto backup
- [ ] Restore puntuale
- [ ] Restore massivo
- [ ] Version history ricercabile
- [ ] Version history filtrabile
- [ ] Export diff
- [ ] Commenti su diff
- [ ] Review changes
- [ ] Accept/reject changes

---

# 19. Collaborazione, team docs e publishing

## 19.1 Condivisione

- [ ] Condivisione nota via file
- [ ] Condivisione cartella via file
- [ ] Condivisione vault via file
- [ ] Export per email
- [ ] Link di condivisione opzionale
- [ ] Link read-only
- [ ] Link editabile opzionale
- [ ] Password protezione link
- [ ] Scadenza link
- [ ] Revoca link
- [ ] Condivisione LAN
- [ ] Condivisione P2P opzionale
- [ ] Condivisione self-hosted
- [ ] Condivisione senza cloud proprietario
- [ ] Permessi granulari
- [ ] Ruoli utente
- [ ] Lettore
- [ ] Commentatore
- [ ] Editor
- [ ] Admin

## 19.2 Collaborazione

- [ ] Commenti
- [ ] Commenti inline
- [ ] Commenti risolti
- [ ] Mention utenti
- [ ] Suggestions mode
- [ ] Track changes
- [ ] Review mode
- [ ] Presenza utenti opzionale
- [ ] Real-time editing opzionale
- [ ] CRDT sync opzionale
- [ ] Merge automatico
- [ ] Conflitti visivi
- [ ] Cronologia collaborativa
- [ ] Audit log
- [ ] Notifiche collaborazione
- [ ] Shared vault
- [ ] Vault team
- [ ] Permessi per cartella
- [ ] Permessi per nota
- [ ] Offline collaboration recovery
- [ ] Approval workflow
- [ ] Real-time cursors
- [ ] Guest links
- [ ] Shared templates
- [ ] Team workspace
- [ ] Admin dashboard
- [ ] Shared inbox
- [ ] Shared tasks
- [ ] Shared databases
- [ ] Shared canvas
- [ ] Shared dashboards
- [ ] Shared forms
- [ ] Shared publishing
- [ ] Shared sync server
- [ ] Self-hosted collaboration
- [ ] P2P collaboration
- [ ] Conflict annotations
- [ ] Review history
- [ ] Ownership transfer

## 19.3 Team docs / operations

- [ ] SOP templates
- [ ] Runbooks
- [ ] Policies
- [ ] Ownership
- [ ] Review dates
- [ ] Approval workflow
- [ ] Style guide
- [ ] Linting
- [ ] Vale rules
- [ ] Terminology glossary
- [ ] Internal docs search
- [ ] Onboarding checklists
- [ ] Incident postmortems
- [ ] ADRs
- [ ] Decision logs
- [ ] RACI
- [ ] Org chart notes
- [ ] Meeting cadence
- [ ] OKRs
- [ ] KPIs
- [ ] Project dashboards
- [ ] Team dashboards
- [ ] Shared glossaries
- [ ] Shared templates
- [ ] Shared snippets
- [ ] Shared forms
- [ ] Shared databases
- [ ] Shared publishing
- [ ] Permissions
- [ ] Audit logs

## 19.4 Publishing

- [ ] Pubblicazione note selezionate
- [ ] Pubblicazione cartelle
- [ ] Pubblicazione vault
- [ ] Sito statico generato localmente
- [ ] Hosting self-hosted
- [ ] Hosting statico compatibile
- [ ] Deploy manuale
- [ ] Deploy automatico opzionale
- [ ] Custom domain
- [ ] HTTPS
- [ ] Tema pubblicazione
- [ ] CSS personalizzato
- [ ] JS personalizzato opzionale
- [ ] Navbar personalizzata
- [ ] Sidebar personalizzata
- [ ] Footer personalizzato
- [ ] Homepage personalizzata
- [ ] Blog mode
- [ ] Docs mode
- [ ] Wiki mode
- [ ] Ricerca nel sito
- [ ] Indice automatico
- [ ] Breadcrumb
- [ ] SEO metadata
- [ ] Open Graph
- [ ] Sitemap
- [ ] RSS feed
- [ ] Atom feed
- [ ] Commenti opzionali
- [ ] Analytics privacy-friendly
- [ ] Nessun tracking invasivo
- [ ] Password protezione sito
- [ ] Accesso a pagamento opzionale
- [ ] Accesso gratuito
- [ ] Bozze non pubblicate
- [ ] Pubblicazione programmata
- [ ] Revisioni pubblicate
- [ ] Redirect
- [ ] Slug personalizzati
- [ ] i18n publishing
- [ ] Versioned docs
- [ ] Multi-version publishing
- [ ] Changelog publishing
- [ ] Feedback widget
- [ ] Comments moderation
- [ ] Privacy-friendly analytics
- [ ] Search index publishing
- [ ] Custom components
- [ ] MDX/interactive components opzionali
- [ ] Code playground
- [ ] Embed sicuri
- [ ] Membership opzionale
- [ ] Newsletters
- [ ] Static export
- [ ] Draft/preview mode
- [ ] Publishing audit log
- [ ] Publishing permissions
- [ ] Publishing templates
- [ ] Publishing themes

---

# 20. Plugin system, marketplace e supply chain

## 20.1 Plugin core

- [ ] Plugin API pubblica
- [ ] Manifest plugin
- [ ] Versioning plugin
- [ ] Dipendenze plugin
- [ ] Conflitti plugin
- [ ] Enable/disable plugin
- [ ] Impostazioni plugin
- [ ] Comandi plugin
- [ ] View plugin
- [ ] Sidebar plugin
- [ ] Ribbon plugin
- [ ] Status bar plugin
- [ ] Settings tab plugin
- [ ] Eventi plugin
- [ ] Lifecycle plugin
- [ ] Sandbox plugin
- [ ] Permessi plugin
- [ ] Permissioni file
- [ ] Permessi rete
- [ ] Permessi clipboard
- [ ] Plugin worker
- [ ] Plugin UI components
- [ ] Plugin themes
- [ ] Plugin snippets
- [ ] Plugin commands
- [ ] Plugin hotkeys
- [ ] Plugin menu
- [ ] Plugin context menu
- [ ] Plugin markdown extensions
- [ ] Plugin custom renderers
- [ ] Plugin custom views
- [ ] Plugin database columns
- [ ] Plugin query functions
- [ ] Plugin importers
- [ ] Plugin exporters
- [ ] Plugin sync providers
- [ ] Plugin publish themes
- [ ] Plugin AI providers
- [ ] Plugin mobile compatibility
- [ ] Plugin desktop compatibility

## 20.2 Marketplace

- [ ] Marketplace integrato
- [ ] Marketplace opzionale
- [ ] Installazione plugin
- [ ] Aggiornamento plugin
- [ ] Disinstallazione plugin
- [ ] Review plugin
- [ ] Rating plugin
- [ ] Segnalazione plugin
- [ ] Plugin verificati
- [ ] Plugin open source badge
- [ ] Firma plugin
- [ ] Hash plugin
- [ ] Installazione offline
- [ ] Installazione da URL
- [ ] Installazione da repository
- [ ] Plugin locali
- [ ] Developer mode
- [ ] Hot reload plugin
- [ ] Debug plugin
- [ ] Log plugin

## 20.3 Supply chain security

- [ ] Plugin sandbox
- [ ] Plugin permissions
- [ ] Network allowlist
- [ ] File allowlist
- [ ] No eval policy
- [ ] WASM plugins opzionali
- [ ] Plugin signatures
- [ ] Reproducible builds
- [ ] SBOM plugin
- [ ] Dependency audit
- [ ] Update channels
- [ ] Rollback plugin
- [ ] Conflict detection
- [ ] Telemetry opt-in plugin
- [ ] Plugin health monitor
- [ ] Plugin crash isolation
- [ ] Plugin resource limits
- [ ] Plugin permission revocation
- [ ] Plugin install review
- [ ] Plugin code inspection
- [ ] Plugin open source badge
- [ ] Plugin verified badge
- [ ] Plugin report abuse
- [ ] Plugin security advisories
- [ ] Plugin deprecation policy

---

# 21. FubSuite — Plugin nativi ufficiali

## 21.1 Foundation Suite

- [ ] Architettura FubSuite modulare
- [ ] Ogni plugin Suite installabile separatamente
- [ ] Ogni plugin Suite disattivabile
- [ ] Plugin Suite gratuiti
- [ ] Plugin Suite con API condivise
- [ ] Plugin Suite con UI coerente
- [ ] Plugin Suite con permessi trasparenti
- [ ] Plugin Suite offline-first
- [ ] Plugin Suite con dati esportabili
- [ ] Plugin Suite senza lock-in

## 21.2 Moduli FubSuite

### FubTasks
- [ ] Task manager avanzato
- [ ] Kanban
- [ ] Calendar tasks
- [ ] Timeline tasks
- [ ] Dipendenze task
- [ ] Ricorrenze
- [ ] Promemoria
- [ ] Time tracking
- [ ] Report produttività
- [ ] Dashboard task

### FubDB
- [ ] Database relazionale locale
- [ ] Viste multiple
- [ ] Formule
- [ ] Rollup
- [ ] Relazioni
- [ ] Validazione
- [ ] Form input
- [ ] Import/export CSV
- [ ] Database embed
- [ ] Query builder visuale

### FubCanvas
- [ ] Whiteboard infinito
- [ ] Nodi note
- [ ] Nodi database
- [ ] Nodi query
- [ ] Drawing
- [ ] Sticky notes
- [ ] Presentazioni
- [ ] Esportazione visuale
- [ ] Canvas collaboration
- [ ] Canvas template gallery

### FubCalendar
- [ ] Calendario integrato
- [ ] Vista mese
- [ ] Vista settimana
- [ ] Vista giorno
- [ ] Eventi da note
- [ ] Eventi da task
- [ ] Eventi da proprietà data
- [ ] Import iCal
- [ ] Export iCal
- [ ] Promemoria calendario

### FubProjects
- [ ] Gestione progetti
- [ ] Milestone
- [ ] Roadmap
- [ ] Backlog
- [ ] Sprint
- [ ] Board
- [ ] Burndown chart
- [ ] Risorse
- [ ] Dipendenze
- [ ] Report progetto

### FubJournal
- [ ] Diario giornaliero
- [ ] Journaling guidato
- [ ] Prompt
- [ ] Mood tracking
- [ ] Habit tracking
- [ ] Statistiche personali
- [ ] Timeline personale
- [ ] Review settimanale
- [ ] Review mensile
- [ ] Export diario

### FubFlashcards
- [ ] Flashcard da note
- [ ] Flashcard da blocchi
- [ ] Spaced repetition
- [ ] Cloze deletion
- [ ] Mazzo
- [ ] Tag deck
- [ ] Statistiche apprendimento
- [ ] Review giornaliera
- [ ] Import Anki opzionale
- [ ] Export flashcard

### FubCharts
- [ ] Chart da query
- [ ] Chart da proprietà
- [ ] Bar chart
- [ ] Line chart
- [ ] Pie chart
- [ ] Scatter chart
- [ ] Heatmap
- [ ] Histogram
- [ ] Dashboard chart
- [ ] Export chart

### FubMaps
- [ ] Note geolocalizzate
- [ ] Proprietà lat/long
- [ ] Mappa interattiva
- [ ] Mappe offline opzionali
- [ ] Cluster marker
- [ ] Filtri per luogo
- [ ] Route planning opzionale
- [ ] Import GPX
- [ ] Export GPX
- [ ] Mappe embed

### FubAI
- [ ] AI opzionale
- [ ] AI locale
- [ ] BYO API key
- [ ] Semantic search
- [ ] Summarization
- [ ] Auto tagging
- [ ] Auto linking
- [ ] Q&A sul vault
- [ ] RAG locale
- [ ] Redaction privacy
- [ ] Embedding locali
- [ ] Modelli scaricabili
- [ ] Nessun invio dati obbligatorio
- [ ] Prompt personalizzati
- [ ] AI commands
- [ ] Centro di comando LLM
- [ ] Operazioni multi-nota guidate da AI
- [ ] Gestione impostazioni via AI con conferma

### FubDev
- [ ] Code notebook
- [ ] Esecuzione codice locale
- [ ] Linguaggi multipli
- [ ] REPL
- [ ] Snippet eseguibili
- [ ] Output inline
- [ ] Variabili ambiente
- [ ] Sandbox esecuzione
- [ ] API locale
- [ ] Script automation

### FubForms
- [ ] Form da database
- [ ] Form pubblici opzionali
- [ ] Form locali
- [ ] Validazione campi
- [ ] Conditional fields
- [ ] Upload file
- [ ] Risposte in note
- [ ] Risposte in database
- [ ] Export risposte
- [ ] Form template

### FubCRM
- [ ] Contatti
- [ ] Organizzazioni
- [ ] Relazioni persone
- [ ] Interazioni
- [ ] Follow-up
- [ ] Pipeline
- [ ] Tag contatti
- [ ] Note meeting
- [ ] Timeline contatti
- [ ] Export contatti

### FubFinance
- [ ] Budget personale
- [ ] Spese
- [ ] Entrate
- [ ] Categorie
- [ ] Conti
- [ ] Report mensili
- [ ] Chart spese
- [ ] Import CSV banca
- [ ] Export CSV
- [ ] Dati locali cifrabili

### FubCollab
- [ ] Shared vault
- [ ] Real-time editing
- [ ] Commenti
- [ ] Presenza
- [ ] Permessi
- [ ] Ruoli
- [ ] Audit log
- [ ] Self-hosted server
- [ ] P2P sync
- [ ] Offline merge

### FubPublish
- [ ] Sito statico
- [ ] Blog
- [ ] Docs
- [ ] Wiki
- [ ] Knowledge base
- [ ] Temi
- [ ] Custom domain
- [ ] Search
- [ ] RSS
- [ ] Analytics privacy

### FubSync
- [ ] Sync E2EE
- [ ] Sync self-hosted
- [ ] Sync mobile
- [ ] Sync conflict resolution
- [ ] Sync history
- [ ] Sync selettivo
- [ ] Sync LAN
- [ ] Sync P2P
- [ ] Sync relay opzionale
- [ ] Sync senza account obbligatorio

---

# 22. AI, assistenza intelligente e governance

## 22.1 AI privacy-first

- [ ] AI completamente opzionale
- [ ] AI disattivata di default
- [ ] AI locale supportata
- [ ] Modelli locali scaricabili
- [ ] Supporto Ollama o equivalente
- [ ] BYO cloud API key
- [ ] Nessun invio dati senza consenso
- [ ] Consenso esplicito per AI cloud
- [ ] Redaction automatica opzionale
- [ ] Masking dati sensibili
- [ ] Log AI locale
- [ ] Cancellazione cache AI
- [ ] Modelli offline
- [ ] Embedding offline
- [ ] Indice semantico locale

## 22.2 Funzioni AI

- [ ] Ricerca semantica
- [ ] Note correlate
- [ ] Suggerimenti link
- [ ] Suggerimenti tag
- [ ] Suggerimenti proprietà
- [ ] Riassunti
- [ ] Riscrittura
- [ ] Correzione bozze
- [ ] Traduzione
- [ ] Brainstorming
- [ ] Outline generation
- [ ] Domande sul vault
- [ ] Risposte con citazioni
- [ ] Citazioni da note
- [ ] Chat con vault
- [ ] Chat con nota
- [ ] Chat con selezione
- [ ] Auto completamento
- [ ] Auto riassunto in frontmatter
- [ ] Auto keyword
- [ ] Auto classificazione
- [ ] OCR AI opzionale
- [ ] Trascrizione audio
- [ ] Trascrizione video
- [ ] Estrazione entità

## 22.3 AI governance

- [ ] Model manager
- [ ] Local model download
- [ ] Model checksums
- [ ] Model quantization options
- [ ] Token budget
- [ ] Cost estimator
- [ ] Chunking configurabile
- [ ] Embeddings locali
- [ ] Vector DB locale
- [ ] Reranker locale
- [ ] Citations from vault
- [ ] Confidence score
- [ ] Hallucination warnings
- [ ] Prompt library
- [ ] Prompt templates
- [ ] Redaction before AI
- [ ] Private AI mode
- [ ] AI logs
- [ ] AI disable per vault
- [ ] AI disable per plugin
- [ ] AI provider abstraction
- [ ] BYO API key
- [ ] Local LLM support
- [ ] Offline embeddings
- [ ] Semantic cache
- [ ] AI usage dashboard
- [ ] AI permission matrix
- [ ] AI data access scope
- [ ] AI exclusion rules
- [ ] AI auditability

## 22.4 Centro di comando LLM

- [ ] Centro di comando LLM
- [ ] Comandi in linguaggio naturale
- [ ] Barra comando AI dedicata
- [ ] Chat operativa (non solo conversazionale)
- [ ] AI come esecutore di comandi del command registry
- [ ] Nessuna capacità implicita: solo comandi esposti esplicitamente
- [ ] Operazioni su nota singola
- [ ] Operazioni su più note
- [ ] Operazioni su selezione di note
- [ ] Operazioni su risultati di ricerca
- [ ] Operazioni su risultati di query
- [ ] Operazioni su cartella
- [ ] Operazioni su tag
- [ ] Operazioni su intero vault
- [ ] Creazione note in blocco
- [ ] Modifica contenuto in blocco
- [ ] Rinomina in blocco
- [ ] Spostamento in blocco
- [ ] Eliminazione in blocco (con cestino)
- [ ] Modifica frontmatter/proprietà in blocco
- [ ] Aggiunta/rimozione tag in blocco
- [ ] Riscrittura link in blocco
- [ ] Riorganizzazione struttura cartelle
- [ ] Applicazione template in blocco
- [ ] Split/merge note guidati da AI
- [ ] Gestione allegati in blocco
- [ ] Lettura impostazioni
- [ ] Modifica impostazioni su richiesta
- [ ] Modifica impostazioni vault
- [ ] Modifica impostazioni editor/tema/hotkey
- [ ] Gestione plugin (abilita/disabilita) su richiesta
- [ ] Creazione automazioni da linguaggio naturale
- [ ] Creazione query/view da linguaggio naturale
- [ ] Impostazioni protette non modificabili dall'AI
- [ ] Impostazioni privacy/AI mai auto-modificabili
- [ ] Piano di esecuzione prima dell'azione
- [ ] Anteprima del piano in linguaggio naturale
- [ ] Elenco file impattati
- [ ] Dry-run obbligatorio opzionale
- [ ] Diff per singola nota prima dell'applicazione
- [ ] Approvazione esplicita dell'utente
- [ ] Approvazione per singola operazione
- [ ] Approvazione in blocco
- [ ] Modifica manuale del piano prima dell'esecuzione
- [ ] Esecuzione parziale/selettiva
- [ ] Interruzione a metà esecuzione
- [ ] Modalità step-by-step
- [ ] Modalità autonoma opt-in esplicita
- [ ] Nessuna scrittura senza consenso
- [ ] Transazione atomica per operazione batch
- [ ] Rollback completo dell'operazione
- [ ] Undo di un intero comando AI
- [ ] Snapshot/checkpoint pre-esecuzione
- [ ] Integrazione con versioning note
- [ ] Integrazione con cestino
- [ ] Limite massimo di note per operazione
- [ ] Conferma rafforzata per operazioni distruttive
- [ ] Ambito di scrittura configurabile (scope)
- [ ] Whitelist/blacklist cartelle
- [ ] Note escluse dalle operazioni AI
- [ ] Permessi granulari per tipo di operazione
- [ ] Permessi separati lettura/scrittura/impostazioni
- [ ] Centro di comando disattivabile
- [ ] Centro di comando disattivabile per vault
- [ ] Funziona con LLM locale
- [ ] Funziona con BYO API key
- [ ] Nessun invio contenuto oltre lo scope dichiarato
- [ ] Redaction prima dell'invio
- [ ] Log completo dei comandi eseguiti
- [ ] Log delle modifiche applicate
- [ ] Audit trail esportabile
- [ ] Cronologia comandi AI
- [ ] Ripetizione di un comando precedente
- [ ] Salvataggio comando come macro
- [ ] Comandi AI riutilizzabili come automazione
- [ ] Gestione errori e report finale
- [ ] Report riepilogativo post-esecuzione
- [ ] API plugin per esporre comandi all'AI
- [ ] Plugin dichiarano capacità e permessi
- [ ] Rate limit sulle operazioni AI

---

# 23. Sicurezza, privacy e compliance

## 23.1 Sicurezza

- [ ] Nessun malware
- [ ] Nessun tracking nascosto
- [ ] Aggiornamenti firmati
- [ ] Verifica integrità aggiornamenti
- [ ] Secure storage credenziali
- [ ] Keychain OS
- [ ] Crittografia at-rest opzionale
- [ ] Vault password
- [ ] Blocco biometrico mobile
- [ ] Auto-lock
- [ ] Timeout blocco
- [ ] Crittografia backup
- [ ] Crittografia export
- [ ] Crittografia sync E2EE
- [ ] Zero-knowledge sync
- [ ] Gestione chiavi
- [ ] Recovery key
- [ ] Rotazione chiavi
- [ ] Audit sicurezza
- [ ] Security disclosure policy
- [ ] Per-note encryption
- [ ] Per-folder encryption
- [ ] Encrypted fields
- [ ] Password-protected notes
- [ ] Hidden vault
- [ ] Secure delete
- [ ] Secure trash
- [ ] PII detection
- [ ] Secrets detection
- [ ] Redaction tool
- [ ] Audit log
- [ ] Session timeout
- [ ] Hardware key support
- [ ] Key rotation
- [ ] CSP
- [ ] Sandbox
- [ ] Network permissions
- [ ] File permissions
- [ ] Clipboard permissions
- [ ] Camera/mic permissions
- [ ] Plugin permission prompts
- [ ] Encrypted cache
- [ ] Encrypted thumbnails
- [ ] Encrypted search index opzionale
- [ ] Duress mode opzionale
- [ ] Security dashboard

## 23.2 Privacy

- [ ] Offline completo
- [ ] Nessun account obbligatorio
- [ ] Telemetria opt-in
- [ ] Telemetria anonima
- [ ] Telemetria disattivabile
- [ ] Nessun crash report obbligatorio
- [ ] Crash report opt-in
- [ ] Nessun invio note
- [ ] Nessun invio metadata
- [ ] Nessun invio search query
- [ ] Nessun advertising ID
- [ ] Nessun fingerprinting
- [ ] Privacy manifest
- [ ] Elenco permessi
- [ ] Cancellazione dati locali
- [ ] Cancellazione indici
- [ ] Cancellazione cache AI
- [ ] Cancellazione thumbnail
- [ ] Modalità privata
- [ ] Vault nascosti opzionali
- [ ] Remote content blocking
- [ ] Block external images by default
- [ ] Block external fonts by default
- [ ] Local fonts only mode
- [ ] Anonymized logs
- [ ] Privacy dashboard
- [ ] Data inventory
- [ ] Export all data
- [ ] Delete all data
- [ ] Model cards for AI
- [ ] AI opt-in esplicito
- [ ] Offline OCR
- [ ] Offline STT
- [ ] Offline TTS
- [ ] No fingerprinting
- [ ] No advertising ID
- [ ] Privacy report
- [ ] Permission report
- [ ] Network activity monitor
- [ ] Telemetry transparency
- [ ] Telemetry opt-in
- [ ] Telemetry audit log
- [ ] Local-only mode
- [ ] Airplane mode friendly
- [ ] No hidden endpoints

## 23.3 Compliance e governance

- [ ] SBOM
- [ ] License compliance
- [ ] SPDX identifiers
- [ ] CVE/security advisories
- [ ] GDPR compliance
- [ ] CCPA compliance
- [ ] DPA per servizi hosted
- [ ] Retention policies
- [ ] Legal hold
- [ ] Audit logs
- [ ] Data classification
- [ ] Privacy impact assessment
- [ ] Open governance
- [ ] RFC process
- [ ] Community voting
- [ ] Security disclosure policy
- [ ] Bug bounty opzionale
- [ ] Transparency report
- [ ] Algorithmic transparency
- [ ] AI model cards
- [ ] Data processing documentation
- [ ] User data export
- [ ] User data deletion
- [ ] Consent management
- [ ] Cookie-less analytics
- [ ] Terms of service chiari
- [ ] Privacy policy chiara
- [ ] Plugin policy chiara
- [ ] Marketplace policy chiara
- [ ] DMCA/abuse policy opzionale

---

# 24. Performance, affidabilità e diagnostica

## 24.1 Performance

- [ ] Avvio rapido
- [ ] Apertura nota istantanea
- [ ] Ricerca rapida
- [ ] Indicizzazione incrementale
- [ ] Lazy loading
- [ ] Virtualizzazione liste
- [ ] Virtualizzazione tabelle
- [ ] Rendering efficiente
- [ ] Parsing efficiente
- [ ] Basso uso RAM
- [ ] Basso uso CPU idle
- [ ] GPU acceleration opzionale
- [ ] Supporto vault piccoli
- [ ] Supporto vault medi
- [ ] Supporto vault grandi
- [ ] Supporto vault enormi
- [ ] Gestione file grandi
- [ ] Gestione allegati numerosi
- [ ] Gestione canvas grandi
- [ ] Gestione database grandi
- [ ] Task manager interno
- [ ] Indexing progress
- [ ] Memory usage monitor
- [ ] CPU usage monitor
- [ ] Cache size monitor
- [ ] Rebuild index
- [ ] Low-power mode
- [ ] Large file mode
- [ ] Virtualization
- [ ] GPU toggle
- [ ] Background priority
- [ ] Network throttling
- [ ] Sync bandwidth limits
- [ ] Lazy loading
- [ ] Incremental parsing
- [ ] Incremental saving
- [ ] Streaming large files
- [ ] Cache eviction policies
- [ ] Index compression
- [ ] Thumbnail cache management
- [ ] Search index optimization
- [ ] Database vacuum
- [ ] Performance profiler
- [ ] Startup time metrics
- [ ] Note open time metrics
- [ ] Search latency metrics
- [ ] Render time metrics
- [ ] Plugin performance metrics
- [ ] Battery usage mobile
- [ ] Data usage mobile

## 24.2 Affidabilità

- [ ] Crash recovery
- [ ] Autosave
- [ ] Atomic writes
- [ ] File integrity checks
- [ ] Corruption detection
- [ ] Safe mode
- [ ] Plugin safe mode
- [ ] Rollback plugin
- [ ] Rollback update
- [ ] Beta channel
- [ ] Stable channel
- [ ] Portable mode
- [ ] Low resource mode
- [ ] Offline resilience
- [ ] Battery friendly mobile
- [ ] Background sync efficiente
- [ ] Error reporting chiaro
- [ ] Diagnostic tools
- [ ] Vault health check
- [ ] Repair tools
- [ ] Plugin isolation
- [ ] Crash buffer
- [ ] Autosave recovery
- [ ] Vault repair
- [ ] Index rebuild
- [ ] File lock detection
- [ ] Journaling
- [ ] Diagnostic bundle
- [ ] Health check
- [ ] Repair wizard
- [ ] Checksum verification
- [ ] Backup verification
- [ ] Restore test
- [ ] Sync logs
- [ ] Plugin logs
- [ ] Error reporting opt-in
- [ ] Crash reports opt-in
- [ ] Offline diagnostics
- [ ] Network diagnostics
- [ ] Permission diagnostics
- [ ] File system diagnostics
- [ ] Vault size diagnostics
- [ ] Attachment diagnostics
- [ ] Database diagnostics
- [ ] Search index diagnostics
- [ ] AI diagnostics
- [ ] Publishing diagnostics

---

# 25. Accessibilità, inclusività e localizzazione

## 25.1 Accessibilità

- [ ] Screen reader support
- [ ] ARIA labels
- [ ] Navigazione tastiera
- [ ] Focus visibile
- [ ] Focus trap modali
- [ ] Contrasto sufficiente
- [ ] Alto contrasto
- [ ] Text scaling
- [ ] Zoom UI
- [ ] Riduzione movimento
- [ ] Animazioni disattivabili
- [ ] Font leggibili
- [ ] Font dyslexia-friendly opzionali
- [ ] Spaziatura regolabile
- [ ] Sottotitoli media
- [ ] Trascrizioni
- [ ] Alt text obbligatorio suggerito
- [ ] Accessible canvas alternative
- [ ] Accessible graph alternative
- [ ] Accessible tables
- [ ] Text-to-speech
- [ ] Speech-to-text
- [ ] Dettatura vocale
- [ ] Voice control
- [ ] Voice navigation
- [ ] Screen reader ottimizzato
- [ ] ARIA completo
- [ ] Keyboard-only mode
- [ ] Focus visible
- [ ] Focus trap
- [ ] Skip links
- [ ] High contrast
- [ ] Colorblind palettes
- [ ] Dyslexia-friendly fonts
- [ ] Text spacing regolabile
- [ ] Line length regolabile
- [ ] Reduced motion
- [ ] Reduced transparency
- [ ] Captions
- [ ] Transcripts
- [ ] Audio descriptions opzionali
- [ ] Accessible canvas alternative
- [ ] Accessible graph alternative
- [ ] Accessible charts
- [ ] Accessible tables
- [ ] Accessible forms
- [ ] Accessible notifications
- [ ] Accessible drag & drop
- [ ] Accessible command palette
- [ ] Accessible settings

## 25.2 Localizzazione

- [ ] Multi-language UI
- [ ] RTL support
- [ ] CJK support
- [ ] Unicode completo
- [ ] Date/time localization
- [ ] Number localization
- [ ] Calendar localization
- [ ] Spellcheck multilingua
- [ ] Dizionari locali
- [ ] Traduzioni community
- [ ] Locale-aware sorting
- [ ] Locale-aware collation
- [ ] Pluralization
- [ ] Bidi support
- [ ] Timezone management
- [ ] World clock
- [ ] Date math
- [ ] Currency formatting
- [ ] Measurement units
- [ ] Number formatting
- [ ] Calendar localization
- [ ] Translation memory
- [ ] Community translations
- [ ] Pseudo-locale testing
- [ ] RTL editor
- [ ] CJK optimization
- [ ] Unicode normalization
- [ ] Locale-aware search
- [ ] Locale-aware stemming
- [ ] Locale-aware synonyms
- [ ] Regional holidays
- [ ] Workweek localization
- [ ] Time format 12/24
- [ ] First day of week
- [ ] Date picker localization
- [ ] Currency conversion opzionale
- [ ] Unit conversion opzionale
- [ ] Localized templates
- [ ] Localized prompts
- [ ] Localized AI responses opzionali

---

# 26. Piattaforme, mobile, web, OS integration

## 26.1 Desktop

- [ ] Windows
- [ ] macOS
- [ ] Linux
- [ ] Installer Windows
- [ ] Portable Windows
- [ ] DMG macOS
- [ ] Universal binary macOS
- [ ] AppImage
- [ ] Flatpak
- [ ] Snap opzionale
- [ ] DEB package
- [ ] RPM package
- [ ] Auto-update
- [ ] Update manuale
- [ ] Release notes
- [ ] Canali stable/beta
- [ ] Firma codice
- [ ] Notarization macOS
- [ ] Supporto multi-monitor
- [ ] Supporto HiDPI

## 26.2 Mobile

- [ ] iOS
- [ ] iPadOS
- [ ] Android
- [ ] Mobile offline
- [ ] Quick capture
- [ ] Share extension
- [ ] Widget
- [ ] Home screen actions
- [ ] Fotocamera per allegati
- [ ] Scanner documenti
- [ ] Voice memo
- [ ] Trascrizione voice memo
- [ ] Biometric lock
- [ ] Dark mode mobile
- [ ] Gesture mobile
- [ ] Keyboard toolbar
- [ ] Supporto tastiere esterne
- [ ] Supporto stilo
- [ ] Supporto split screen
- [ ] Background sync
- [ ] Quick capture da notification shade
- [ ] Quick capture da lock screen
- [ ] Widget home screen
- [ ] Widget quick capture
- [ ] Widget task oggi
- [ ] Widget nota rapida
- [ ] Share extension avanzata
- [ ] Document scanner
- [ ] OCR da fotocamera
- [ ] Voice recorder
- [ ] Audio transcription offline
- [ ] Offline vault completo
- [ ] Selective vault download
- [ ] Background sync
- [ ] Biometric lock
- [ ] Face unlock
- [ ] Fingerprint unlock
- [ ] Stylus support
- [ ] Handwriting recognition opzionale
- [ ] Keyboard shortcuts
- [ ] External keyboard support
- [ ] Split screen
- [ ] Multi-window
- [ ] Drag & drop cross-app
- [ ] Mobile command palette
- [ ] Mobile gestures
- [ ] Offline AI models opzionali
- [ ] Mobile performance mode
- [ ] Battery saver mode
- [ ] Data saver mode

## 26.3 Web / PWA

- [ ] PWA installabile
- [ ] Offline web mode
- [ ] File System Access API
- [ ] OPFS storage
- [ ] IndexedDB cache
- [ ] Service worker
- [ ] Install prompt
- [ ] Responsive UI
- [ ] Keyboard shortcuts web
- [ ] Dark mode web
- [ ] No account required
- [ ] Export from web
- [ ] Import from web
- [ ] Local vault from browser
- [ ] Cache management
- [ ] Offline conflict handling
- [ ] Progressive enhancement
- [ ] Web share target
- [ ] Web clipboard permissions
- [ ] Secure context only

## 26.4 Integrazioni OS

- [ ] File handler Markdown
- [ ] Apri con FubMD
- [ ] URI scheme `fubmd://`
- [ ] Deep linking
- [ ] Notifiche OS
- [ ] Menu tray
- [ ] Menu bar macOS
- [ ] Global hotkeys
- [ ] Clipboard monitoring opzionale
- [ ] Drag & drop da OS

---

# 27. CLI, API, developer experience e testing

## 27.1 CLI

- [ ] CLI ufficiale
- [ ] Apri vault
- [ ] Crea nota
- [ ] Modifica nota
- [ ] Cerca note
- [ ] Esporta note
- [ ] Importa note
- [ ] Sync trigger
- [ ] Backup trigger
- [ ] Health check
- [ ] Rebuild index
- [ ] Run command
- [ ] Run automation
- [ ] Plugin management
- [ ] Theme management
- [ ] Publish build
- [ ] Publish deploy
- [ ] Query execution
- [ ] JSON output
- [ ] Scripting friendly

## 27.2 API

- [ ] API locale
- [ ] API plugin
- [ ] API eventi
- [ ] API comandi
- [ ] API note
- [ ] API file
- [ ] API search
- [ ] API query
- [ ] API database
- [ ] API canvas
- [ ] AI API provider abstraction
- [ ] Webhook locali opzionali
- [ ] REST locale opzionale
- [ ] WebSocket locale opzionale
- [ ] IPC sicuro
- [ ] Auth token locale
- [ ] Rate limiting
- [ ] Logging API
- [ ] API docs
- [ ] SDK plugin

## 27.3 Developer experience

- [ ] Template progetto plugin
- [ ] CLI create-plugin
- [ ] Hot reload
- [ ] Debugger
- [ ] Console plugin
- [ ] Log viewer
- [ ] Event inspector
- [ ] Command inspector
- [ ] API explorer
- [ ] Type definitions
- [ ] Documentation
- [ ] Examples
- [ ] Unit test utilities
- [ ] E2E test utilities
- [ ] Plugin linting
- [ ] Plugin packaging
- [ ] Plugin signing
- [ ] Plugin publishing
- [ ] Version compatibility
- [ ] Deprecation policy
- [ ] Custom commands
- [ ] Custom views
- [ ] Custom widgets
- [ ] Custom settings
- [ ] Custom markdown blocks
- [ ] Custom renderers
- [ ] Custom importers
- [ ] Custom exporters
- [ ] Custom sync adapters
- [ ] Custom AI adapters

## 27.4 Testing e QA

- [ ] Unit test
- [ ] Integration test
- [ ] E2E test
- [ ] UI test
- [ ] Accessibility test
- [ ] Performance test
- [ ] Stress test vault grandi
- [ ] Memory leak test
- [ ] Crash recovery test
- [ ] Sync conflict test
- [ ] Plugin sandbox test
- [ ] Security test
- [ ] Fuzzing parser
- [ ] Markdown conformance test
- [ ] Import/export round-trip test
- [ ] Cross-platform test
- [ ] Mobile test
- [ ] Localization test
- [ ] Backup restore test
- [ ] Upgrade migration test
- [ ] CI/CD
- [ ] Release automatizzate
- [ ] Canary builds
- [ ] Beta builds
- [ ] Stable builds
- [ ] Changelog
- [ ] Migration notes
- [ ] Dependency updates
- [ ] Security patches
- [ ] Long-term support plan

---

# 28. Configurazione, profili e portabilità

- [ ] Impostazioni globali
- [ ] Impostazioni vault
- [ ] Impostazioni plugin
- [ ] Impostazioni tema
- [ ] Impostazioni editor
- [ ] Impostazioni sync
- [ ] Impostazioni AI
- [ ] Impostazioni privacy
- [ ] Impostazioni backup
- [ ] Impostazioni publishing
- [ ] Ricerca impostazioni
- [ ] Reset impostazioni
- [ ] Import impostazioni
- [ ] Export impostazioni
- [ ] Profili configurazione
- [ ] Profili vault
- [ ] Profili sincronizzazione
- [ ] Profili pubblicazione
- [ ] Profili AI
- [ ] Profili hotkeys
- [ ] Portable mode
- [ ] Config nella cartella vault
- [ ] Config esterna opzionale
- [ ] Vault portabile su USB
- [ ] Plugin portabili
- [ ] Temi portabili
- [ ] Backup portabile
- [ ] Ripristino portabile
- [ ] Migrazione facile tra OS
- [ ] Nessun percorso hardcoded obbligatorio

---

# 29. Community, documentazione e supporto

- [ ] Repository pubblica
- [ ] Issue tracker
- [ ] Feature request
- [ ] Bug reporting
- [ ] Discussion forum
- [ ] Community plugins
- [ ] Community themes
- [ ] Template gallery
- [ ] Showcase
- [ ] Contributor guidelines
- [ ] Code of conduct
- [ ] Security disclosure
- [ ] Translation program
- [ ] Plugin review process
- [ ] Theme review process
- [ ] Docs utente
- [ ] Docs plugin
- [ ] Docs API
- [ ] Docs CLI
- [ ] Docs sync
- [ ] Docs publishing
- [ ] Docs security
- [ ] Docs privacy
- [ ] FAQ
- [ ] Troubleshooting
- [ ] Migration guides
- [ ] Video tutorial
- [ ] Esempi vault
- [ ] Template starter
- [ ] Docs offline

---

# 30. Feature “definitive” per diventare la nota Markdown definitiva

## 30.1 Esperienza definitiva

- [ ] Avvio istantaneo
- [ ] Ricerca istantanea
- [ ] Editor perfetto
- [ ] Live preview perfetto
- [ ] Wikilink perfetti
- [ ] Backlink perfetti
- [ ] Embed perfetti
- [ ] Grafo utile e veloce
- [ ] Canvas integrato
- [ ] Database integrato
- [ ] Task manager integrato
- [ ] Calendario integrato
- [ ] Query potenti
- [ ] Automazioni potenti
- [ ] Plugin ecosystem
- [ ] Temi bellissimi
- [ ] Mobile eccellente
- [ ] Desktop eccellente
- [ ] Sync affidabile
- [ ] Backup affidabile

## 30.2 Fiducia definitiva

- [ ] Dati sempre esportabili
- [ ] Dati sempre leggibili
- [ ] Dati sempre migrabili
- [ ] Privacy by default
- [ ] Security by design
- [ ] Offline by default
- [ ] Open formats
- [ ] No predatory monetization
- [ ] Community trust
- [ ] Longevità del progetto

---

# 31. Roadmap consigliata

## Fase 1 — Core essenziale

- [ ] Vault e file explorer
- [ ] Editor Markdown eccellente
- [ ] Live preview
- [ ] Wikilink
- [ ] Backlink
- [ ] Tag
- [ ] Proprietà base
- [ ] Ricerca full-text
- [ ] Quick switcher
- [ ] Command palette
- [ ] Temi chiaro/scuro
- [ ] Import/export Markdown
- [ ] Autosave
- [ ] Recovery
- [ ] Plugin API iniziale

## Fase 2 — Potenza e organizzazione

- [ ] Grafo
- [ ] Outline
- [ ] Template
- [ ] Daily notes
- [ ] Query engine
- [ ] Task avanzati
- [ ] Canvas
- [ ] Database
- [ ] Allegati avanzati
- [ ] PDF annotations
- [ ] Versioning
- [ ] Backup
- [ ] Vault health
- [ ] Bulk operations
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

---

