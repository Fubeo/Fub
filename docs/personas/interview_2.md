---
progetto: FubMD — App di scrittura e knowledge management open source
data: 24 luglio 2026
intervistato: Lorenzo
ruolo: Scrittore freelance / copywriter — utente target
tipo_intervista: Esplorativa — raccolta requisiti da user persona
stato: bozza
---

# Brief Requisiti

## 1. Contesto e problema

### Problema principale
- Non esiste un tool open source che unisca la gestione di un progetto narrativo complesso (personaggi, timeline, worldbuilding) con un'esperienza di scrittura Markdown pulita e distraction-free. Devo scegliere tra app chiuse (Obsidian, Scrivener) o mettere insieme 4-5 strumenti diversi.

### Persone o ruoli coinvolti
- Scrittori di narrativa (thriller, fantasy, storici) con progetti multi-linea temporale
- Copywriter freelance che gestiscono più clienti e progetti in parallelo
- Editor e beta-reader che ricevono il manoscritto in formato esportato

### Situazione attuale
- Uso Obsidian per il vault del romanzo, ma mi pesa che il core non sia open source. Per l'export DOCX uso Pandoc da terminale, che funziona ma è scomodo. Per la sincronizzazione tra MacBook e iPhone mi affido a iCloud, ma ogni tanto i file si "sdoppiano" e devo risolvere conflitti a mano.

### Limiti della soluzione attuale
- Obsidian: plugin ecosystem frammentato, export nativo limitato, non posso verificare il codice
- Scrivener: troppo complesso, costoso (€55+), lock-in sul formato .scrivx, non è Markdown nativo
- Editor WYSIWYG (Word, Pages): la formattazione si rompe al copia-incolla, non ho controllo sul file sorgente
- Sincronizzazione cloud proprietaria: paura concreta di perdere capitoli se il servizio chiude o ha un bug

### Motivazione del progetto
- Voglio un'app che tratti i miei file come **file di testo in cartelle**, non come database proprietario. Se domani FubMD sparisce, apro la cartella con qualsiasi editor e ho tutto. Open source significa anche che la community può mantenerla viva.

## 2. Obiettivi

### Obiettivo principale
- Avere un unico ambiente open source dove gestire l'intera "bibbia" del romanzo (schede personaggio, timeline, luoghi, sottotrame) E scrivere i capitoli in Markdown, con link bidirezionali tra le note.

### Obiettivi secondari
- Scrivere in modalità Focus/distraction-free per sessioni di 2-3 ore senza notifiche, senza toolbar, solo testo e cursore
- Esportare il manoscritto finale in DOCX e PDF con formattazione editoriale (intestazioni, numerazione capitoli, margini) senza dover usare Pandoc da riga di comando
- Sincronizzare in modo affidabile tra MacBook Air e iPhone

### Risultati attesi
- Ridurre da 3 tool (Obsidian + Pandoc + iCloud workaround) a 1
- Zero ansia da "e se perdo il file?"
- Tempo di setup del progetto narrativo: da 2 giorni a mezza giornata

### Non-obiettivi
- Non mi serve un editor collaborativo in tempo reale (scrivo da solo)
- Non mi serve un CMS o un sistema di pubblicazione web
- Non mi servono funzionalità da project management (Kanban, Gantt) — al massimo una vista timeline semplice

## 3. Utenti e casi d'uso

### Utenti principali
- Scrittori di narrativa con progetti strutturati (10+ personaggi, 3+ linee temporali, 50+ note di worldbuilding)
- Livello tecnico medio: sanno cos'è il Markdown, usano wiki-link, ma non vogliono scrivere script

### Utenti secondari
- Copywriter che gestiscono brief, tone of voice, glossari cliente in vault separati
- Editor che ricevono l'export e devono lavorarci in Word

### Competenze degli utenti
- Markdown base (headings, bold, liste, link)
- Familiarità con wiki-link `[[Nome_Nota]]`
- Uso base del terminale (ma preferiscono GUI)
- macOS e iOS come ecosistema primario

### Contesto d'uso
- Mattina presto, al bar o in biblioteca, sessione di scrittura 2-3 ore su MacBook Air
- Pomeriggio, in treno o a casa, rilettura e annotazioni rapide su iPhone
- Fine progetto: export del manoscritto completo per invio a editor/agente letterario

### Attività principali
- Creare e aggiornare schede personaggio (nome, aspetto, arco narrativo, relazioni)
- Scrivere capitoli in Markdown con link ai personaggi/luoghi citati
- Navigare tra note tramite wiki-link e backlink per verificare coerenza
- Costruire e consultare una timeline degli eventi (3 linee temporali intrecciate)
- Esportare il manoscritto in DOCX/PDF formattato

### Difficoltà attuali
- Verificare la coerenza dei dettagli (es. "Elena ha gli occhi verdi nel cap. 3 ma castani nel cap. 12") richiede ricerca manuale tra decine di file
- L'export in DOCX con Pandoc richiede configurazione YAML, template LaTeX — troppo tecnico per la mattina al bar
- La modalità Focus di Obsidian è migliorabile: voglio nascondere **tutto** tranne il paragrafo corrente
- Sincronizzazione iPhone: a volte le note non compaiono per minuti, e nel frattempo ho scritto a mano su un taccuino

## 4. Ambito del progetto

### Incluso nello scope
- Editor Markdown con anteprima live e wiki-link `[[...]]`
- Gestione vault come cartella di file `.md` locali
- Modalità Focus / distraction-free (nasconde sidebar, menu, altre note)
- Grafo dei link e vista backlink
- Export nativo in DOCX e PDF (senza dipendenze esterne da installare)
- Sincronizzazione tra dispositivi (anche solo via cartella locale + iCloud Drive, ma affidabile)
- Template per schede personaggio, timeline, worldbuilding

### Desiderabile ma non prioritario
- Vista timeline visuale (orizzontale, con eventi posizionati)
- Modalità "typewriter" (il paragrafo attivo resta centrato verticalmente)
- Statistiche di scrittura (parole/giorno, streak, conteggio per capitolo)
- Tema scuro/sepia personalizzabile per la scrittura notturna

### Esplicitamente escluso
- Editor WYSIWYG / rich text
- Collaborazione multi-utente in tempo reale
- Pubblicazione web / blog integrato
- Plugin system complesso (almeno in v1)
- Supporto Windows/Android in questa release

### MVP minimo ipotizzato
- Vault locale di file `.md` con wiki-link funzionanti
- Editor Markdown con modalità Focus
- Backlink e ricerca full-text
- Export DOCX base (titoli, capitoli, paragrafi)
- Funziona su macOS (MacBook Air)

## 5. Requisiti funzionali

- REQ-001: L'utente può creare un vault come cartella locale contenente file `.md` e sottocartelle; l'app non genera file proprietari di progetto.
- REQ-002: L'utente può inserire wiki-link `[[Nome_Nota]]` nel testo; il link è cliccabile e apre la nota collegata; i backlink sono visibili in un pannello dedicato.
- REQ-003: L'utente può attivare una modalità Focus che nasconde sidebar, toolbar, menu e mostra solo il testo del file corrente; uscita con `Esc` o shortcut.
- REQ-004: L'utente può esportare l'intero vault (o una selezione di file) in DOCX e PDF con formattazione editoriale (pagina titolo, capitoli numerati, margini standard).
- REQ-005: L'utente può cercare in full-text tra tutte le note del vault con risultati istantanei (< 200 ms per vault fino a 500 file).
- REQ-006: L'utente può applicare template predefiniti (scheda personaggio, evento timeline, luogo) alla creazione di una nuova nota.
- REQ-007: L'utente può sincronizzare il vault tra MacBook e iPhone in modo automatico e con gestione dei conflitti (merge o notifica).

## 6. Requisiti non funzionali

### Performance
- Apertura vault con 500+ file `.md` in < 2 secondi
- Ricerca full-text con risultati in < 200 ms
- Scrittura fluida a 60 fps anche con file da 10.000+ parole

### Sicurezza
- Nessun dato inviato a server terzi senza consenso esplicito
- Vault cifrabile opzionalmente (AES-256) per file sensibili (trame, spoiler)

### Privacy e compliance
- Zero telemetria obbligatoria; opt-in esplicito per crash report anonimi
- Nessun account richiesto per l'uso base
- GDPR-friendly: nessun dato personale raccolto

### Disponibilità
- Funziona 100% offline; la sincronizzazione è un optional, non un requisito
- Se il servizio di sync è down, l'utente continua a lavorare in locale senza interruzioni

### Dispositivi e piattaforme
- macOS 13+ (MacBook Air M1/M2/M3)
- iOS 16+ (iPhone 13 e successivi)
- File system: APFS, compatibile con iCloud Drive come trasporto

### Accessibilità
- Supporto VoiceOver su macOS e iOS
- Contrasto testo/sfondo conforme WCAG AA
- Font size regolabile senza rompere il layout

### Usabilità
- Curva di apprendimento: un utente che conosce Markdown deve essere produttivo in < 15 minuti
- Modalità Focus attivabile con una singola shortcut (es. `Cmd+Shift+F`)
- Nessuna configurazione obbligatoria al primo avvio

### Scalabilità
- Vault fino a 2.000 file `.md` senza degrado percepibile
- File singoli fino a 50.000 parole gestiti senza lag

## 7. Dati e integrazioni

### Dati principali
- File `.md` in testo puro (UTF-8)
- Metadati YAML in frontmatter (titolo, tags, data, tipo: personaggio/luogo/evento/capitolo)
- Indice dei link (grafo) generato dinamicamente, non persistito come file proprietario

### Origine dei dati
- Creati dall'utente nell'app
- Importati da cartelle esistenti (migrazione da Obsidian: stessa struttura di vault)
- Template inclusi nell'app

### Sistemi esterni
- iCloud Drive (come trasporto per la sync, non come backend)
- Pandoc (opzionale, per export avanzato; ma l'export base deve funzionare senza)

### API o servizi da integrare
- Nessuna API cloud proprietaria
- Eventuale supporto futuro per Syncthing / git come alternativa di sync

### Vincoli tecnici
- I file DEVONO restare `.md` leggibili da qualsiasi editor di testo
- Nessun database binario (no SQLite nascosto, no formato .fub)
- Frontmatter YAML compatibile con lo standard Obsidian (migrazione zero-friction)

### Dipendenze
- Framework UI nativo (SwiftUI per macOS/iOS) per performance e integrazione OS
- Libreria di parsing Markdown (es. swift-markdown o cmark)
- Libreria di export DOCX (es. docx4j via wrapper, o generazione XML diretta)

## 8. Vincoli e ipotesi

### Vincoli di business
- Open source (licenza GPL-3.0 o MIT) — il codice deve essere pubblico e forkabile
- Gratuito per l'uso personale; eventuale modello di sostenibilità: donazioni, supporto premium, hosting sync opzionale
- Community-driven: le decisioni di roadmap passano da discussioni pubbliche (GitHub Discussions)

### Vincoli tecnici
- Deve girare su MacBook Air M1 con 8 GB RAM senza swap
- L'app iOS deve pesare < 80 MB
- Nessun Electron / wrapper web: nativo o al massimo Tauri

### Vincoli temporali
- MVP (macOS, editor + wiki-link + Focus + export DOCX base): 4-5 mesi
- v1.0 (aggiunta iOS, sync, export PDF, template): +3 mesi
- Beta pubblica entro fine 2026

### Vincoli legali o compliance
- Licenza open source compatibile con le librerie utilizzate
- Nessun contenuto generato dall'utente transitato su server senza consenso
- Rispetto del diritto d'autore: nessun scraping, nessun training AI sui vault

### Ipotesi attuali
- L'utente ha già familiarità con il concetto di vault e wiki-link (viene da Obsidian o simili)
- iCloud Drive è accettabile come meccanismo di sync per la v1
- L'export DOCX "base" (senza template LaTeX complessi) copre l'80% dei casi d'uso editoriali

### Regole di business
- I file dell'utente sono dell'utente: nessun lock-in, nessun formato proprietario
- L'app deve funzionare anche se il progetto viene abbandonato (i file restano leggibili)
- Nessuna feature "premium" che blocchi l'accesso ai propri file

## 9. Priorità

### Must have
- Vault locale di file `.md` con wiki-link e backlink
- Editor Markdown con modalità Focus
- Ricerca full-text
- Export DOCX base
- Funziona offline al 100%

### Should have
- Export PDF con formattazione editoriale
- Template per schede personaggio / timeline / worldbuilding
- Sincronizzazione macOS ↔ iPhone
- Grafo visuale dei link

### Could have
- Vista timeline orizzontale
- Statistiche di scrittura (parole/giorno, streak)
- Modalità typewriter
- Temi personalizzabili (seppia, notturno)

### Won't have in questa release
- Collaborazione multi-utente
- Plugin system
- Supporto Windows / Android / Linux
- Editor WYSIWYG
- Pubblicazione web
- Integrazione AI (riassunti, suggerimenti)

## 10. Criteri di successo

### Successo del progetto
- Lorenzo (e utenti simili) completa un intero romanzo (80.000+ parole, 30+ note collegate) usando solo FubMD, dalla prima bozza all'export finale per l'editore.
- La community open source contribuisce con almeno 5 PR significative nei primi 6 mesi.

### Criteri di accettazione generali
- Un utente che migra da Obsidian apre il suo vault esistente in FubMD in < 5 minuti senza modificare i file
- L'export DOCX si apre in Word/LibreOffice senza errori di formattazione
- La modalità Focus si attiva in < 1 secondo e non mostra **nessun** elemento UI non testuale

### Metriche di valutazione
- Tempo medio per verificare la coerenza di un dettaglio personaggio: da 10 min (ricerca manuale) a < 1 min (backlink + ricerca)
- Numero di tool necessari per il workflow completo: da 3 a 1
- Crash rate: < 0,1% delle sessioni
- Soddisfazione utente (survey post-beta): ≥ 4/5

## 11. Rischi e domande aperte

### Rischi principali
- L'export DOCX/PDF "nativo" senza Pandoc è tecnicamente complesso; rischio di formattazione imperfetta
- La sync via iCloud Drive ha limiti noti (conflitti, latenza); potrebbe non bastare per la v1
- Community open source piccola nelle fasi iniziali → bus factor = 1-2 sviluppatori
- Rischio di "feature creep" verso Scrivener: troppi pannelli, troppa complessità

### Domande aperte
- Come gestire i conflitti di sync in modo comprensibile per un utente non tecnico? (merge automatico vs. "quale versione tieni?")
- L'export PDF deve supportare template personalizzabili (font, margini, intestazioni) o basta un preset "manoscritto standard"?
- Serve un formato di backup/versioning integrato (tipo git automatico) o basta affidarsi a Time Machine?
- La vista timeline è un "nice to have" o è fondamentale per chi scrive su 3 linee temporali?

### Informazioni mancanti
- Feedback da editor/agenti letterari sul formato DOCX "accettabile" per una submission
- Dati reali su quanti file/peso ha un vault narrativo "grande" (oltre 500 note?)
- Esperienza di altri scrittori con la sync iCloud: è davvero inaffidabile o è un problema del mio setup?

### Decisioni da prendere
- Licenza: GPL-3.0 (copyleft forte) vs. MIT (permissiva)? Impatto sulla community e su eventuali fork commerciali
- Architettura sync: solo iCloud Drive in v1, o investire subito su un protocollo proprio / Syncthing?
- Nome e branding: "FubMD" è definitivo? (suona tecnico, poco "scrittore")
- Lingua UI: solo inglese, o anche italiano da subito?

## 12. Note grezze

- La citazione che mi guida: *"I miei file sono miei. Se domani l'app chiude, io ho ancora tutto in cartelle di testo."* — questo deve essere il principio architetturale n.1, non uno slogan.
- Al bar alle 7 di mattina non voglio pensare a YAML, a Pandoc, a conflitti di merge. Voglio aprire, scrivere, linkare `[[Elena_Vivaldi]]`, e sapere che i suoi occhi sono verdi. Punto.
- Scrivener ha 200 opzioni nel menu. Non ne voglio 200. Ne voglio 15, fatte bene.
- Il grafo dei link è bello da guardare, ma quello che uso davvero è il pannello backlink: "dove altro compare Elena?" — quello è il killer feature per la coerenza narrativa.
- Se FubMD mi fa risparmiare anche solo 20 minuti al giorno di "caccia al dettaglio", in un mese ho guadagnato 10 ore di scrittura. È quello che conta.
- Open source non è solo una licenza: è la garanzia che tra 5 anni, se il maintainer molla, qualcuno può forkare e continuare. I miei romanzi devono sopravvivere all'app.
- Per l'iPhone: non devo scrivere capitoli. Devo rileggere, annotare, controllare un dettaglio. Un reader con ricerca e backlink basta. Non serve l'editor completo.
- Il DOCX in uscita deve avere: pagina titolo, indice, capitoli con "Capitolo 1" come Heading 1, corpo testo in Times New Roman 12pt, interlinea 1.5, margini 2.5 cm. È lo standard che chiedono le agenzie italiane. Se non esce così, devo comunque riaprire Word e sistemare — e allora tanto valeva usare Word dall'inizio.

---
