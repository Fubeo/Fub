---
progetto: Fub
data: 2026-07-24
intervistato: Giulia — UX Designer / PKM enthusiast
ruolo: User persona PKM & life management, livello tecnico medio
tipo_intervista: Intervista semi-strutturata per discovery requisiti
stato: bozza
---

# Brief Requisiti

## 1. Contesto e problema

### Problema principale
- Giulia usa il vault come “sistema operativo personale”: journaling, habit tracker, ricette, liste di libri, note di design, riflessioni sui podcast e note di lavoro.
- Vuole un unico sistema open source che sostituisca o riduca drasticamente Notion, Todoist, Day One e Readwise.
- Ha bisogno di automatizzare la cattura, in particolare Kindle highlights → Readwise → vault, senza perdere il controllo dei propri dati.
- Il suo problema non è solo catturare, ma anche mantenere il sistema curato, navigabile e non eccessivamente complicato.

### Persone o ruoli coinvolti
- Appassionati di PKM e produttività personale.
- UX designer, creator, freelancer, knowledge worker.
- Utenti che fanno journaling, habit tracking e reading workflow.
- Lettori forti che evidenziano su Kindle o Readwise.
- Utenti Obsidian o simili che usano Dataview, Templater, dashboard e temi.

### Situazione attuale
- Giulia ha un vault con oltre 3.000 note.
- Usa il vault per vita personale e lavoro.
- Ha letto *Building a Second Brain* e segue contenuti su Obsidian, PKM e produttività.
- Usa MacBook Pro, iPhone e Kindle.
- Ha una dashboard settimanale generata con Dataview.
- Importa highlight di libri e li collega a note concettuali come `[[Design_System]]`.
- Personalizza molto estetica, icone, temi e dashboard.

### Limiti della soluzione attuale
- Passa più tempo a configurare il sistema che a usarlo davvero.
- Il rischio “productivity porn” è alto: ottimizzare il sistema diventa un fine, non un mezzo.
- La sincronizzazione tra iPhone e Mac a volte crea conflitti di file.
- Il vault sta crescendo troppo e non ha sempre visibilità su cosa contiene.
- Dashboard e query richiedono manutenzione.
- Alcuni flussi dipendono da plugin esterni fragili o complessi.
- L’estetica personalizzata può rompersi dopo aggiornamenti o cambiamenti dei plugin.

### Motivazione del progetto
- Creare in Fub un’esperienza PKM open source, bella, personalizzabile ma più stabile e sostenibile.
- Ridurre la frizione tra cattura, organizzazione, revisione e utilizzo reale.
- Offrire dashboard, template, query e integrazioni senza obbligare l’utente a configurazioni continue.
- Aiutare l’utente a “potare” il vault con strumenti di pulizia, revisione e salute del knowledge base.
- Mantenere il vault come giardino digitale: curato, vivo, navigabile, non una giungla.

## 2. Obiettivi

### Obiettivo principale
- Permettere a Giulia di gestire vita personale e lavoro in un unico vault Markdown open source, con cattura automatica, dashboard personalizzabili, sync affidabile e strumenti di manutenzione del vault.

### Obiettivi secondari
- Automatizzare l’importazione di highlight da Kindle/Readwise.
- Avere dashboard settimanali e giornaliere pronte all’uso.
- Gestire journaling, habit tracker, task leggere e liste di lettura.
- Personalizzare temi, icone e layout senza fragilità eccessiva.
- Ridurre il tempo speso in configurazione e manutenzione.
- Migliorare la ritrovabilità delle note in un vault grande.
- Sincronizzare in modo robusto tra Mac e iPhone.
- Avere strumenti di “vault hygiene”: note orfane, note stale, tag inutilizzati, link rotti.

### Risultati attesi
- La domenica mattina Giulia apre una dashboard settimanale chiara e utile.
- Vede libri finiti, abitudini completate, note create nella settimana e prompt di journaling.
- Importa gli highlight del Kindle in pochi passaggi.
- Collega rapidamente gli highlight a note come `[[Design_System]]`.
- Il vault resta personalizzato ma più stabile.
- I conflitti di sincronizzazione diventano rari e gestibili.
- Giulia riesce a capire cosa c’è nel vault senza sentirsi sopraffatta.
- Il sistema supporta revisione settimanale, potatura e crescita sostenibile.

### Non-obiettivi
- Diventare un clone completo di Notion con database relazionali complessi e UI enterprise.
- Sostituire completamente Todoist con project management avanzato, team task, dipendenze complesse o automazioni enterprise.
- Diventare un servizio cloud proprietario obbligatorio.
- Obbligare l’utente a usare plugin fragili o configurazioni avanzate.
- Trasformare Fub in un tool di collaborazione real-time.
- Creare un sistema di automazione opaco che modifica note senza controllo utente.
- Gestire nativamente flussi editoriali complessi o CRM personali avanzati.

## 3. Utenti e casi d’uso

### Utenti principali
- PKM nerd e appassionati di produttività personale.
- UX designer, creator, freelancer.
- Utenti con livello tecnico medio.
- Persone che usano Markdown, template, query e dashboard.
- Utenti che vogliono un “second brain” personale e life OS.

### Utenti secondari
- Lettori forti che evidenziano su Kindle.
- Utenti di journaling e habit tracking.
- Studenti o professionisti che vogliono un sistema personale.
- Utenti in migrazione da Notion, Day One, Todoist o Readwise.
- Persone che usano Mac e iPhone come ecosistema principale.

### Competenze degli utenti
- Conoscenza base o intermedia di Markdown.
- Familiarità con concetti PKM: note, link, tag, MOC, review settimanale.
- Uso di plugin o estensioni, ma non necessariamente competenze di sviluppo.
- Comprensione di template, query, dashboard e automazioni leggere.
- Sensibilità estetica e attenzione a UI, icone, temi e layout.
- Desiderio di personalizzare, ma anche bisogno di stabilità.

### Contesto d’uso
- MacBook Pro per scrittura, organizzazione e configurazione.
- iPhone per cattura rapida, consultazione, journaling e task.
- Kindle per lettura ed evidenziazione.
- Review settimanale la domenica mattina.
- Uso quotidiano per journaling, abitudini, note di design, podcast, libri e progetti.
- Vault usato come archivio personale, diario, sistema di task leggere e cruscotto di vita.

### Attività principali
- Catturare pensieri veloci da iPhone.
- Scrivere journal quotidiano o settimanale.
- Tracciare abitudini.
- Creare dashboard con query.
- Importare highlight da Kindle o Readwise.
- Collegare highlight a note tematiche.
- Gestire liste di libri, ricette, podcast, riflessioni.
- Personalizzare temi, icone e template.
- Fare revisione settimanale e potatura del vault.
- Cercare note vecchie in un vault ampio.

### Difficoltà attuali
- Troppo tempo speso a configurare invece di usare.
- Dashboard e query diventano fragili o complesse.
- Sync iPhone-Mac con conflitti occasionali.
- Vault grande e difficile da mantenere ordinato.
- Note orfane, duplicate, stale o poco collegate.
- Estetica personalizzata che può rompersi.
- Dipendenza da plugin come Dataview, Templater, Readwise integration.
- Sensazione di “giungla digitale” quando il vault non è potato.

## 4. Ambito del progetto

### Incluso nello scope
- Vault Markdown locale e open source.
- Editor bello, veloce e personalizzabile.
- Link bidirezionali, tag, YAML frontmatter, allegati.
- Dashboard personalizzabili.
- Query engine ispirato a Dataview.
- Template engine ispirato a Templater.
- Temi, icone e personalizzazioni CSS-like.
- Journaling e daily/weekly notes.
- Habit tracker leggero.
- Task leggere con checkbox, date e stato.
- Importazione highlight da Kindle/Readwise.
- Quick capture da iPhone.
- Sync affidabile Mac-iPhone.
- Strumenti di vault hygiene.
- Ricerca avanzata e grafo.
- Esportazione Markdown e PDF/base.

### Desiderabile ma non prioritario
- Widget iOS per cattura rapida e dashboard.
- Importazione da Notion, Todoist, Day One.
- Vista calendario per journal e task.
- Mappe concettuali avanzate.
- Dashboard drag-and-drop.
- Suggerimenti automatici di collegamento tra note.
- Revisione guidata settimanale.
- Statistiche del vault.
- Temi community verificati.
- Modalità “focus” o distraction-free.
- Integrazione podcast o RSS.

### Esplicitamente escluso
- Cloud proprietario obbligatorio.
- Database relazionali complessi stile Notion.
- Project management team avanzato.
- Automazioni oscure o non ispezionabili.
- Plugin system senza controllo versione.
- Telemetria obbligatoria.
- Formato note proprietario.
- Collaborazione real-time complessa.
- Sostituzione completa di Readwise come servizio esterno nella prima release.
- Editing collaborativo simultaneo.

### MVP minimo ipotizzato
- Vault Markdown con note, tag, link, YAML frontmatter.
- Editor curato esteticamente e veloce.
- Daily note e weekly note da template.
- Dashboard base con query preconfigurate.
- Query engine semplice per filtrare note, task, journal e libri.
- Template engine con variabili data, titolo, prompt.
- Import base highlight da Readwise o file Kindle.
- Sync Mac-iPhone affidabile con gestione conflitti.
- Temi base e icone.
- Strumenti minimi di vault hygiene: note orfane, link rotti, tag inutilizzati.

## 5. Requisiti funzionali

- REQ-001: Il sistema deve gestire un vault Markdown con link bidirezionali, tag, YAML frontmatter, allegati, ricerca avanzata, backlinks e graph view, mantenendo i dati come file plain text esportabili.
- REQ-002: Il sistema deve permettere cattura e importazione automatica di highlight da Kindle/Readwise, creando note strutturate con metadata, fonte, capitolo, data e suggerimenti di collegamento a note esistenti come `[[Design_System]]`.
- REQ-003: Il sistema deve fornire dashboard personalizzabili tramite query tipo Dataview, con viste pronte per review settimanale, libri letti, abitudini, note create, task aperte e prompt di journaling.
- REQ-004: Il sistema deve supportare template avanzati tipo Templater, daily/weekly notes, variabili dinamiche, snippet riutilizzabili e automazioni trasparenti, con modalità sicura per ridurre rotture e complessità.
- REQ-005: Il sistema deve sincronizzare il vault tra MacBook Pro e iPhone in modo affidabile, con storico versioni, gestione conflitti non distruttiva, copie di conflitto leggibili e strumenti di vault hygiene per note orfane, stale, duplicate o poco collegate.

## 6. Requisiti non funzionali

### Performance
- Gestione fluida di 3.000+ note, con scalabilità fino a 10.000+.
- Dashboard e query caricate in meno di 1 secondo per viste comuni.
- Ricerca istantanea su testo, tag, metadata e collegamenti.
- Sync incrementale veloce tra Mac e iPhone.
- Apertura rapida dell’app e delle note recenti.

### Sicurezza
- Vault locale come fonte primaria.
- Token API, ad esempio Readwise, salvati in modo sicuro.
- Nessun invio obbligatorio di contenuti a server esterni.
- Sync cifrata se appoggiata a servizi cloud.
- Automazioni con permessi visibili e revocabili.

### Privacy e compliance
- Nessuna telemetria obbligatoria.
- Dati personali, journal e abitudini trattati localmente o su storage scelto dall’utente.
- Telemetria anonima solo opt-in.
- Rispetto GDPR.
- Trasparenza su importazione da servizi esterni.

### Disponibilità
- Offline-first su Mac e iPhone.
- Cattura rapida disponibile anche senza rete.
- Sync quando la connessione è disponibile.
- Nessun blocco durante scrittura o journaling.
- Recupero automatico dopo crash o chiusura accidentale.

### Dispositivi e piattaforme
- Priorità: MacBook Pro macOS.
- Secondario: iPhone iOS.
- Terziario: Kindle come fonte di highlight, non come dispositivo Fub nativo.
- Possibile supporto futuro iPad.
- Interfaccia coerente tra desktop e mobile.

### Accessibilità
- Supporto VoiceOver.
- Dynamic Type o dimensione testo regolabile.
- Contrasto elevato.
- Navigazione da tastiera su Mac.
- Componenti UI chiari per checkbox, tag, link e dashboard.
- Temi accessibili e non solo estetici.

### Usabilità
- Estetica curata ma non fragile.
- Onboarding con dashboard e template iniziali.
- Modalità “semplice” per ridurre il productivity porn.
- Personalizzazione avanzata disponibile ma non obbligatoria.
- Messaggi di errore chiari su sync, query e template.
- Comando rapido per creare nota, cercare, importare e aprire dashboard.
- Linguaggio vicino al PKM: note, collegamenti, review, giardino, potatura.

### Scalabilità
- Supporto a vault in crescita oltre 10.000 note.
- Query e dashboard performanti con molti file.
- Temi e plugin gestibili senza degradare stabilità.
- Strumenti di manutenzione che scalano con il vault.
- Architettura modulare per future integrazioni.

## 7. Dati e integrazioni

### Dati principali
- Note personali, journal, note di design, note libri, podcast, ricette.
- Daily notes e weekly notes.
- Task leggere e checkbox.
- Habit tracker.
- Highlight Kindle/Readwise.
- Metadata YAML: autore, libro, fonte, data, stato, tipo nota, tag.
- Template.
- Dashboard e query salvate.
- Temi, icone, snippet CSS-like.
- Grafo e backlinks.
- Indice di ricerca.

### Origine dei dati
- Scrittura manuale.
- Quick capture da iPhone.
- Importazione Kindle highlights.
- Importazione Readwise.
- Template giornalieri/settimanali.
- Eventuale import da Notion, Todoist, Day One.
- Copia/incolla da podcast, articoli, newsletter.

### Sistemi esterni
- Readwise.
- Kindle / My Clippions / export highlights.
- iCloud o altro storage sincronizzato, se usato.
- Notion per importazione futura.
- Todoist per importazione task futura.
- Day One per importazione journal futura.
- Servizi cloud scelti dall’utente per sync.

### API o servizi da integrare
- Readwise API.
- Eventuale import file Kindle.
- API sync cloud o protocollo WebDAV.
- Motore query locale.
- Motore template.
- Motore ricerca full-text.
- Sistema notifiche iOS per promemoria o quick capture.
- Eventuale widget iOS.

### Vincoli tecnici
- Note in Markdown plain text UTF-8.
- Metadata in YAML frontmatter.
- Nessun database proprietario obbligatorio.
- Query e dashboard salvate come file leggibili o configurazioni esportabili.
- Token API non salvati in chiaro nelle note.
- Automazioni non devono corrompere il vault.
- Compatibilità con ecosistema Apple prioritaria.

### Dipendenze
- Motore Markdown.
- Motore query tipo Dataview.
- Motore template tipo Templater.
- Sistema sync.
- Indice ricerca.
- Componenti UI per dashboard.
- Readwise API o export file.
- Gestore temi e icone.

## 8. Vincoli e ipotesi

### Vincoli di business
- Fub deve essere open source.
- Deve essere attraente per utenti PKM e designer.
- Deve ridurre la dipendenza da plugin fragili.
- Non deve obbligare a servizi cloud proprietari.
- Deve offrire personalizzazione senza diventare instabile.

### Vincoli tecnici
- Priorità macOS e iOS.
- Sync robusta tra Mac e iPhone.
- Markdown come formato sorgente.
- Query engine e template engine stabili.
- Temi personalizzabili ma controllati.
- Automazioni trasparenti e reversibili.
- Gestione sicura di API key Readwise.

### Vincoli temporali
- MVP PKM entro 3 mesi.
- Import Readwise/Kindle e dashboard base entro la prima release utile.
- Sync iPhone affidabile entro beta pubblica.
- Strumenti di vault hygiene entro 6 mesi.
- Import da Notion/Todoist/Day One in release successive.

### Vincoli legali o compliance
- Rispetto GDPR per dati personali e journaling.
- Gestione corretta di highlight e contenuti protetti da copyright.
- Licenze open source compatibili.
- Telemetria solo opt-in.
- Trasparenza su accesso a Readwise e altri servizi.

### Ipotesi attuali
- Giulia accetta Markdown come formato sottostante.
- Usa Readwise o è disposta a usarlo come ponte.
- Vuole personalizzare, ma anche ridurre manutenzione.
- Il vault è personale, non collaborativo.
- La review settimanale è un rituale centrale.
- L’estetica è importante, ma non a costo della stabilità.
- iPhone è usato soprattutto per cattura e consultazione.

### Regole di business
- Il file Markdown resta fonte di verità.
- Dashboard e indici sono derivati e ricostruibili.
- Le automazioni devono essere visibili e annullabili.
- I conflitti sync non devono sovrascrivere silenziosamente note.
- I template non devono bloccare la modifica manuale.
- La personalizzazione avanzata non deve rompere l’esperienza base.
- Il vault deve poter essere potato senza perdita accidentale.

## 9. Priorità

### Must have
- Vault Markdown locale.
- Editor bello e veloce.
- Sync Mac-iPhone affidabile.
- Daily/weekly notes.
- Template engine.
- Dashboard con query.
- Import Kindle/Readwise.
- Task leggere e habit tracker.
- Temi e icone base.
- Ricerca avanzata.
- Backlinks e graph.
- Vault hygiene minima.

### Should have
- Quick capture da iPhone.
- Widget iOS.
- Import da Notion, Todoist, Day One.
- Vista calendario.
- Revisione settimanale guidata.
- Statistiche vault.
- Suggerimenti di collegamento.
- Dashboard drag-and-drop.
- Temi community verificati.
- Modalità focus.
- Esportazione PDF curata.

### Could have
- AI suggestions opzionali per tag, collegamenti e riassunti.
- OCR per screenshot o note immagini.
- Integrazione podcast.
- Integrazione RSS/newsletter.
- Mappe concettuali avanzate.
- Excalidraw o canvas.
- Spaced repetition leggera.
- Routine mattutine guidate.
- Timeline del journal.
- Dashboard tematiche predefinite.

### Won't have in questa release
- Notion-like database relazionali complessi.
- Project management team avanzato.
- Collaborazione real-time.
- Cloud proprietario obbligatorio.
- Automazioni opache.
- Sostituzione totale di Readwise come servizio.
- CRM personale avanzato.
- Finanza personale complessa.
- Integrazioni enterprise.
- Marketplace plugin non curato.

## 10. Criteri di successo

### Successo del progetto
- Giulia riesce a usare Fub come life OS personale senza tornare a Notion, Todoist, Day One o Readwise per le attività principali.
- La domenica mattina apre la dashboard settimanale e completa la review in poco tempo.
- Importa highlight Kindle e li collega a note tematiche senza passaggi manuali eccessivi.
- Passa meno tempo a configurare e più tempo a usare il sistema.
- Il vault resta curato, navigabile e sostenibile.
- I conflitti di sync sono rari e risolvibili facilmente.

### Criteri di accettazione generali
- Una dashboard settimanale mostra note create, task, abitudini, libri e prompt journaling.
- Gli highlight Kindle/Readwise vengono importati come note Markdown con metadata.
- I template generano daily/weekly notes con data e sezioni corrette.
- Le query restituiscono risultati pertinenti senza scrivere codice complesso.
- La sync tra Mac e iPhone non perde modifiche.
- I conflitti generano copie leggibili e recuperabili.
- I temi personalizzati non bloccano l’app.
- La ricerca trova note in un vault da 3.000+ note rapidamente.
- Gli strumenti di vault hygiene mostrano note orfane, tag inutilizzati e link rotti.
- L’utente può disattivare automazioni e personalizzazioni avanzate.

### Metriche di valutazione
- Tempo per completare review settimanale: target < 20 minuti.
- Tempo import highlight libro: target < 2 minuti.
- Numero di conflitti sync settimanali: target molto basso.
- Percentuale di note orfane o stale riviste: aumento nel tempo.
- Tempo speso in configurazione vs utilizzo: riduzione percepibile.
- Crash-free session: target > 99%.
- Dashboard load time: target < 1 secondo.
- Percentuale di note con almeno un collegamento o tag significativo: aumento.
- Retention settimanale: utente apre dashboard e journal con regolarità.
- Numero di plugin/configurazioni necessarie per flusso base: target minimo.

## 11. Rischi e domande aperte

### Rischi principali
- Feature creep: aggiungere troppe funzioni PKM e perdere focus.
- Productivity porn: il sistema incentiva configurare invece di usare.
- Sync iPhone-Mac complessa e fonte di conflitti.
- Query engine troppo complesso o fragile.
- Temi e personalizzazioni che si rompono.
- Import Readwise/Kindle instabile o dipendente da API esterne.
- Vault overgrowth senza strumenti efficaci di potatura.
- Dashboard belle ma lente o difficili da mantenere.
- Mobile troppo limitato rispetto al desktop.
- Aspettative alte su sostituzione di Notion, Todoist, Day One e Readwise.

### Domande aperte
- La sync deve usare iCloud, WebDAV, Syncthing o un servizio Fub self-hostable?
- Come gestire conflitti in modo comprensibile per utente non tecnico?
- Il query language deve essere compatibile con Dataview o solo ispirato?
- I template devono supportare script avanzati o solo variabili sicure?
- Come bilanciare personalizzazione totale e stabilità?
- Readwise deve essere integrazione primaria o una delle tante fonti?
- Gli highlight Kindle devono essere importati direttamente da file o via Readwise?
- Come rappresentare task, habit e journal senza creare un database complesso?
- Serve una modalità “zen” o “safe mode” senza plugin/temi?
- Come misurare la salute del vault senza ansia da produttività?

### Informazioni mancanti
- Flusso esatto attuale Kindle → Readwise → Obsidian.
- Quali plugin usa davvero ogni giorno.
- Struttura attuale del vault: cartelle, tag, MOC, daily notes.
- Come gestisce task in Todoist e journal in Day One.
- Quali viste Notion vuole replicare.
- Frequenza reale di sync e conflitti.
- Preferenze estetiche e livello di personalizzazione desiderato.
- Disponibilità a usare servizi cloud specifici.
- Necessità di widget iOS o quick capture da lock screen.
- Aspettative su import storico da altre app.

### Decisioni da prendere
- Architettura sync Mac-iPhone.
- Query language e livello di compatibilità Dataview.
- Template engine e sicurezza automazioni.
- Modello dati per task, habit, journal e libri.
- Strategia temi e icone.
- Integrazione Readwise diretta o import file.
- Strumenti di vault hygiene prioritari.
- Licenza open source.
- Packaging macOS/iOS.
- Modalità “semplice” vs “avanzata”.

## 12. Note grezze

- Giulia dice: “Il mio vault è un giardino digitale. Devo potarlo ogni tanto, altrimenti diventa una giungla.”
- È una PKM nerd: ha letto *Building a Second Brain*, segue canali YouTube su Obsidian e produttività.
- Ha 3.000+ note: journaling, habit tracker, ricette, liste libri, podcast, note di design.
- Il vault è il suo sistema operativo personale.
- Vuole sostituire Notion, Todoist, Day One e Readwise in un unico sistema.
- Vuole automatizzare Kindle highlights → Readwise → vault.
- Ama personalizzare temi, icone, dashboard, Dataview e Templater.
- Frustrazione principale: passa più tempo a configurare che a usare.
- La sync iPhone-Mac deve essere robusta e non creare conflitti fastidiosi.
- Ha bisogno di strumenti per capire cosa c’è nel vault e mantenerlo sano.
- Scenario chiave: domenica mattina, dashboard settimanale, libri finiti, abitudini, note create, prompt journaling, import highlight e collegamento a `[[Design_System]]`.
- Fub deve essere bello, aperto, personalizzabile, ma anche stabile, semplice da mantenere e orientato all’uso reale.
