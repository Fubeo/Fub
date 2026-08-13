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
- [ ] Frontmatter TOML opzionale
- [ ] Frontmatter JSON opzionale
- [ ] Metadata inline opzionali
- [ ] Block ID stabili
- [ ] Heading ID stabili
- [ ] UUID opzionale per nota
- [ ] Timestamp creazione/modifica
- [ ] Sidecar file opzionali
- [ ] Sidecar non obbligatori
- [ ] Vault come cartella semplice
- [ ] Impostazioni per-vault
- [ ] Profili utente
- [ ] Configurazione esportabile
- [ ] Configurazione importabile
- [ ] Versione dello schema dei dati di servizio (`.fub/`)
- [ ] Compatibilità retroattiva del formato dati

## 2.3 File system edge cases

**Sul case, la gestione c'è per intero da un lato e per scelta non c'è
dall'altro.** La risoluzione dei link resta case-insensitive — un vault
sincronizzato fra macOS e Linux è lo stesso vault
([decisione 0004](../decisions/0004-il-grafo-e-i-link-non-wiki.md)) — ma su un
filesystem case-sensitive `Nota.md` e `nota.md` sono due file veri, e la
[decisione 0107](../decisions/0107-il-caso-di-una-lettera.md) ha separato le due
domande che prima erano una: `resolution_key` dice chi è candidato, `exact_key`
dice chi ha ragione fra i candidati. Dove nemmeno la seconda può decidere — due
file così nella **radice** del vault, che nessun wikilink sa distinguere — il
vault lo **dice**, con `HealthCheck::CollidingPaths` fra i controlli di salute
(7.2). Ciò che non c'è, e non per dimenticanza, è la **riparazione**: rinominare
uno dei due vuol dire scegliere quale abbia il nome sbagliato, che è una
decisione dell'utente sui suoi dati. Questa casella è quindi piena sulla
risoluzione e sulla segnalazione, e volutamente vuota sulla correzione
automatica.

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
- [ ] Normalizzazione CRLF/LF solo su richiesta esplicita
- [ ] Gestione file read-only
- [ ] Vault su drive rimovibile
- [ ] Vault su cloud drive
- [ ] Vault su network share
- [ ] Vault relocation
- [ ] Vault rename
- [ ] Rilevamento file rinominati esternamente (reconcile per path)
- [ ] Rilevamento cartelle spostate/rinominate esternamente
- [ ] Prevenzione vault annidati
- [ ] Vault integrity check
- [ ] Gestione file speciali (FIFO, socket, device file)
- [ ] Gestione file di dimensione zero
- [ ] Gestione file inaccessibili per permessi di sistema

## 2.4 Fedeltà del file

**Un file che Fub non ha modificato resta identico byte per byte; uno che ha
modificato differisce solo dove la modifica è avvenuta.** È la condizione perché
«file locali leggibili» e «nessun lock-in» (1.1) valgano anche per chi tiene il
vault sotto controllo di versione: un `git diff` che mostra righe che l'utente
non ha scritto è un difetto di prodotto, non un dettaglio di formattazione. Le
modifiche programmatiche a un documento esistente si fanno come **patch
chirurgiche sulla sorgente**, mai rigenerando il file dal modello — che è lossy
per costruzione: la primitiva, con la revisione su cui si applica, è la
[decisione 0008](../decisions/0008-modifica-chirurgica.md). Ciò che questa sezione
chiede non è una funzionalità che si accende, ma una proprietà che si perde in
silenzio: se nessuna riga la nomina, nessuno si accorge del giorno in cui non
vale più.

### Non scrivere se non ti si chiede

- [ ] Aprire una nota non la riscrive
- [ ] Chiudere una nota non modificata non tocca il file
- [ ] Nessuna riscrittura di massa all'apertura del vault
- [ ] Nessuna migrazione silenziosa del contenuto delle note
- [ ] L'mtime non cambia se il contenuto non cambia
- [ ] I derivati non si scrivono mai fra i file dell'utente
- [ ] Nessuna formattazione implicita al salvataggio
- [ ] Ogni normalizzazione è esplicita e disattivata di default

### Cosa si preserva quando invece si scrive

- [ ] Ordine delle chiavi del frontmatter preservato
- [ ] Commenti nel frontmatter preservati
- [ ] Stile YAML preservato (virgolette, blocchi, rientri)
- [ ] Line ending preservate per file, non normalizzate d'ufficio
- [ ] BOM preservato se c'era, mai aggiunto se non c'era
- [ ] Newline finale né aggiunta né tolta
- [ ] Trailing whitespace non rimosso d'ufficio
- [ ] Stile dei marcatori di lista preservato
- [ ] Stile dell'enfasi preservato
- [ ] Simbolo dello stato di un task preservato
- [ ] Un wikilink resta un wikilink, un link Markdown resta tale
- [ ] Nessuna modifica fuori dallo span dichiarato

### Il diff come superficie di verifica

- [ ] Una modifica produce un diff grande quanto la modifica
- [ ] Anteprima del diff prima di un'operazione in blocco
- [ ] Rapporto di ciò che una normalizzazione cambierebbe, prima di applicarla
- [ ] Apri-e-salva non cambia il file (presidio su corpus)
- [ ] Round-trip verificato su vault reali
- [ ] Un vault sotto git non accumula rumore
- [ ] Segnalazione quando un'operazione tocca più di quanto dichiara
