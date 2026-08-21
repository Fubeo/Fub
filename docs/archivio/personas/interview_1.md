---
progetto: Fub — App di note-taking open source con grafo conoscitivo
data: 24/07/2026
intervistato: Marta (22 anni, studentessa Medicina 4° anno, Bologna)
ruolo: Utente finale / Studentessa universitaria
tipo_intervista: Esplorativa — discovery bisogni e pain points
stato: bozza
---

# Brief Requisiti

## 1. Contesto e problema

### Problema principale
- Devo gestire 6-7 corsi simultanei con migliaia di pagine di appunti, e non ho un modo *veloce* per collegare i concetti tra materie diverse (es. un sintomo in Patologia ha un meccanismo in Fisiologia che ha una base in Anatomia). Perdo tempo a cercare, non a studiare.

### Persone o ruoli coinvolti
- Io (studentessa), i miei compagni di corso con cui condivido appunti, i professori che caricano slide PDF, il tutor del tirocinio ospedaliero.

### Situazione attuale
- Uso un mix caotico: slide PDF scaricate, foto fatte col tablet in aula, appunti sparsi su OneNote, qualche appunto su Notion che poi abbandono perché è lento. Il "sistema" non esiste davvero.

### Limiti della soluzione attuale
- Notion: troppo lento offline, troppa formattazione, mi perdo nei database. OneNote: nessun collegamento tra note, è un quaderno digitale e basta. Obsidian: potentissimo ma la curva dei plugin mi ha bloccata dopo due giorni, e non è *davvero* open source nel senso che vorrei (il sync è a pagamento, il codice non è completamente aperto).

### Motivazione del progetto
- Un compagno di corso mi ha mostrato il suo vault su Obsidian e il grafo delle conoscenze: ho visto i collegamenti tra le sue note e ho pensato "voglio questa cosa, ma senza dover configurare 14 plugin e senza pagare il sync". Vorrei qualcosa di simile ma *semplice da subito*, gratuito, e che rispetti la mia privacy.

## 2. Obiettivi

### Obiettivo principale
- Avere un unico posto dove scrivo appunti, collego concetti tra materie, e ripasso in modo attivo (flashcard + grafo) senza perdere tempo in configurazione.

### Obiettivi secondari
- Condividere singoli appunti o piccoli gruppi di note con 2-3 compagni di studio senza dover esportare/importare file.
- Accedere ai miei appunti dal tablet Android in ospedale (reparto, ambulatorio) senza connessione internet.
- Importare le slide PDF dei prof e annotarle direttamente dentro l'app.

### Risultati attesi
- Ridurre il tempo di ripasso pre-esame del 30-40%.
- Smettere di "riscrivere" appunti: una volta scritti, li collego e li riuso.
- Avere un sistema che *funziona dal primo giorno* senza tutorial di 2 ore.

### Non-obiettivi
- Non mi serve un project manager, non mi serve un database relazionale, non mi serve pubblicare un blog o un sito.
- Non mi interessa la collaborazione in tempo reale stile Google Docs (siamo in 2-3, ci mandiamo i file).

## 3. Utenti e casi d'uso

### Utenti principali
- Studenti universitari (soprattutto facoltà con molta memorizzazione: medicina, giurisprudenza, ingegneria).

### Utenti secondari
- Studenti delle superiori che preparano la maturità; dottorandi che organizzano la letteratura.

### Competenze degli utenti
- Medio-basse. So usare Word, so cos'è un link, so installare un'app. NON so cos'è un plugin, non so cos'è YAML frontmatter, non so cos'è un regex. Se devo aprire un terminale, ho già chiuso l'app.

### Contesto d'uso
- A casa la sera (laptop Windows, 2-3 ore di studio). In biblioteca (laptop + tablet). In ospedale durante il tirocinio (solo tablet Android, spesso senza Wi-Fi). In treno Bologna→casa (offline, telefono o tablet).

### Attività principali
- Prendere appunti durante la lezione (velocemente, anche in modo "brutto").
- Riorganizzare e collegare gli appunti la sera (link bidirezionali tra note).
- Generare flashcard dagli appunti e ripassarle con spaced repetition.
- Navigare il grafo per vedere "cosa so" e "cosa mi manca" prima di un esame.
- Cercare una parola/concetto in 3 secondi.

### Difficoltà attuali
- Non so come organizzare le cartelle: per materia? Per semestre? Per argomento trasversale? Finisco con 47 cartelle e non trovo nulla.
- I plugin di Obsidian mi spaventano: devo leggere documentazione, configurare, e se sbaglio qualcosa si rompe.
- Perdo 20 minuti a formattare una nota (grassetto, titoli, colori) invece di scrivere il contenuto.
- Il sync tra laptop e tablet su Obsidian costa, e le alternative (Syncthing) richiedono configurazione tecnica.

## 4. Ambito del progetto

### Incluso nello scope
- Editor Markdown semplice con anteprima live.
- Link bidirezionali `[[nota]]` con autocomplete.
- Grafo delle conoscenze visuale (anche semplificato, non per forza 3D).
- Sistema di flashcard integrato (spaced repetition tipo Anki ma dentro l'app).
- Funzionamento 100% offline.
- Sync gratuito tra dispositivi (anche via cartella locale / Syncthing integrato / P2P).
- Import PDF con annotazione base.
- Ricerca full-text istantanea.
- Organizzazione flessibile: cartelle + tag + link (senza obbligare una struttura).

### Desiderabile ma non prioritario
- Template per appunti di lezione (data, corso, prof, argomenti).
- Esportazione in PDF per stampare schemi.
- Modalità "esame": nasconde tutto tranne il grafo e le flashcard di una materia.
- Widget Android per ripassare una flashcard al volo.

### Esplicitamente escluso
- Pubblicazione web / blogging.
- Collaborazione real-time multi-utente.
- Database / tabelle relazionali complesse (alla Notion).
- Plugin system aperto (almeno nella v1: voglio che funzioni *senza* plugin).
- Intelligenza artificiale generativa integrata (non mi fido, e voglio che i miei appunti restino locali).

### MVP minimo ipotizzato
- Editor Markdown + link bidirezionali + grafo semplice + ricerca + flashcard base + offline + sync via cartella condivisa. Nient'altro. Se questo funziona, sono già felice.

## 5. Requisiti funzionali

- REQ-001: L'utente può creare una nota in Markdown con anteprima live in < 2 secondi dall'apertura dell'app.
- REQ-002: L'utente può collegare due note tramite `[[nome nota]]` con autocomplete; il collegamento appare in entrambe le note (backlink).
- REQ-003: L'utente può visualizzare un grafo interattivo dei collegamenti tra note, filtrabile per tag/cartella.
- REQ-004: L'utente può generare flashcard da una nota (selezionando testo o con sintassi `Q:: / A::`) e ripassarle con algoritmo spaced repetition (tipo SM-2).
- REQ-005: L'utente può cercare in tutte le note (full-text) con risultato in < 1 secondo, anche con 5000+ note.
- REQ-006: L'utente può sincronizzare il vault tra laptop Windows e tablet Android senza costi e senza account cloud proprietario.
- REQ-007: L'utente può importare un PDF e annotarlo (evidenziare, aggiungere note a margine) dentro l'app.
- REQ-008: L'utente può organizzare le note con cartelle, tag e link senza che l'app imponga una gerarchia rigida.
- REQ-009: L'app funziona al 100% offline; nessuna funzionalità richiede connessione internet.
- REQ-010: L'utente può esportare una singola nota o un gruppo di note in Markdown puro (.md) senza lock-in.

## 6. Requisiti non funzionali

### Performance
- Apertura app: < 2 sec. Apertura nota: < 500 ms. Ricerca su 5000 note: < 1 sec. Grafo con 2000 nodi: fluido, senza lag.

### Sicurezza
- I file sono in chiaro sul mio disco (Markdown). Nessuna crittografia obbligatoria che mi impedisca di aprire i file con un altro editor. Opzionale: cifratura del vault con password.

### Privacy e compliance
- ZERO telemetria. Zero analytics. Zero account obbligatorio. I miei appunti non lasciano mai i miei dispositivi se non lo decido io. GDPR-friendly by design (non raccogliendo nulla, non c'è problema).

### Disponibilità
- Funziona offline al 100%. Il sync è un "di più", non un requisito per usare l'app.

### Dispositivi e piattaforme
- Windows 10/11 (laptop), Android 12+ (tablet). Desiderabile: Linux, macOS, iOS in futuro. Priorità: Windows + Android.

### Accessibilità
- Supporto screen reader di base. Contrasto elevato. Dimensione font regolabile. Non devo usare il mouse per forza (scorciatoie da tastiera per tutto).

### Usabilità
- Un nuovo utente deve poter creare la prima nota e il primo link entro 5 minuti dall'installazione, *senza* leggere documentazione. Onboarding guidato di max 3 schermate. Niente YAML, niente config file da editare a mano.

### Scalabilità
- Il vault deve restare performante fino a 10.000 note e 50.000 link. Oltre, non è il mio caso d'uso.

## 7. Dati e integrazioni

### Dati principali
- Note in formato Markdown (.md) con metadata minima (tag, data creazione, link).
- Flashcard (domanda, risposta, intervallo SR, prossimo ripasso).
- Grafo (nodi = note, archi = link bidirezionali).
- Annotazioni PDF.

### Origine dei dati
- Tutto creato dall'utente dentro l'app. Import da: file .md esistenti, PDF, eventualmente export da Notion/Obsidian (cartella di .md).

### Sistemi esterni
- Syncthing o simile per il sync P2P (opzionale, integrato nell'app).
- Nessun cloud proprietario.

### API o servizi da integrare
- Nessuna API esterna necessaria per il core. Eventuale: import da Anki (.apkg) per le flashcard.

### Vincoli tecnici
- I file devono restare .md leggibili da qualsiasi editor di testo. No formato proprietario binario.

### Dipendenze
- Motore di rendering Markdown. Algoritmo SM-2 (o variante) per spaced repetition. Motore di ricerca full-text locale (tipo SQLite FTS5 o MiniSearch).

## 8. Vincoli e ipotesi

### Vincoli di business
- Deve essere 100% gratuito e open source (licenza tipo GPL o MIT). Nessun modello freemium, nessun "pro tier". Sostenibilità via donazioni o grant, non via lock-in.

### Vincoli tecnici
- Deve girare su hardware modesto (laptop da 500€ con 8 GB RAM, tablet Android di fascia media). No Electron se possibile (troppo pesante); preferibile Tauri, Flutter, o nativo.

### Vincoli temporali
- Per me: vorrei usarlo da settembre (inizio 5° anno). Quindi un MVP entro agosto 2026 sarebbe ideale.

### Vincoli legali o compliance
- Open source: il codice deve essere pubblico e ispezionabile. Nessun componente con licenza incompatibile.

### Ipotesi attuali
- Che esista già una community o un team che sviluppa Fub. Che il formato .md sia sufficiente per le mie esigenze (no tabelle complesse, no formule LaTeX avanzate — anche se un minimo di LaTeX per le formule di fisiologia sarebbe utile).

### Regole di business
- I dati dell'utente sono dell'utente. Punto. Nessuna clausola di "miglioramento del servizio" che legga i miei appunti.

## 9. Priorità

### Must have
- Editor Markdown veloce + link bidirezionali + backlink.
- Grafo delle conoscenze (anche 2D, anche semplice).
- Flashcard con spaced repetition integrata.
- Offline-first, zero account.
- Sync gratuito Windows ↔ Android.
- Ricerca full-text istantanea.

### Should have
- Import/annotazione PDF.
- Template base per appunti di lezione.
- Tag + cartelle flessibili.
- Scorciatoie da tastiera complete.
- Export .md senza lock-in.

### Could have
- Widget Android per flashcard.
- Modalità "esame" (focus su una materia).
- Import da Anki / Obsidian / Notion.
- Tema scuro/chiaro.
- Supporto LaTeX base.

### Won't have in questa release
- Plugin system.
- Pubblicazione web.
- Collaborazione real-time.
- AI integrata.
- Database / tabelle Notion-like.
- Versioning / history delle note (carino, ma non essenziale ora).

## 10. Criteri di successo

### Successo del progetto
- Lo uso ogni giorno per 3 mesi senza tornare a OneNote/Notion. I miei voti migliorano (o almeno il tempo di ripasso si riduce). Lo consiglio a 3+ compagni di corso.

### Criteri di accettazione generali
- Installo l'app, creo 3 note, le collego, vedo il grafo, genero 5 flashcard e le ripasso: tutto in meno di 10 minuti, senza leggere un manuale.

### Metriche di valutazione
- Tempo medio per creare una nota collegata: < 30 sec.
- Tempo per trovare un concetto nella ricerca: < 3 sec.
- Numero di flashcard ripassate/giorno: tracciato localmente (per me, non per telemetria).
- Crash/freeze: zero in uso normale.

## 11. Rischi e domande aperte

### Rischi principali
- Che il sync tra Windows e Android sia complicato da configurare (se devo usare Syncthing manualmente, mi perdo).
- Che il grafo diventi un "gomitolo" illeggibile con 1000+ note e non ci siano filtri utili.
- Che l'app sia "un altro Obsidian" con la stessa complessità nascosta sotto una UI diversa.
- Che il progetto open source muoia dopo 6 mesi per mancanza di maintainer.

### Domande aperte
- Il sync è *davvero* zero-config? Tipo: apro l'app sul tablet, inquadro un QR code dal laptop, e via?
- Le flashcard: posso generarle automaticamente da una nota (es. ogni `##` titolo diventa una domanda) o devo scrivere Q/A a mano?
- Posso avere una "vista materia" che mi mostra solo il sotto-grafo di Patologia senza tutto il resto?
- Se un giorno voglio migrare, i miei file .md sono *davvero* puliti o hanno metadata proprietaria iniettata?

### Informazioni mancanti
- Come funziona il conflitto di sync se modifico la stessa nota su laptop e tablet?
- C'è un limite alla dimensione degli allegati (PDF, immagini)?
- L'app supporta stylus sul tablet Android per annotare i PDF a mano?

### Decisioni da prendere
- Quale tecnologia per il sync: Syncthing integrato? P2P custom? Cartella cloud a scelta dell'utente (Drive, Dropbox)?
- Il grafo è "solo visualizzazione" o posso creare link trascinando i nodi?
- Le flashcard sono dentro la nota (inline) o in un database separato?

## 12. Note grezze

- Marta ha detto testualmente: *"Non voglio un'app bella, voglio un'app che mi faccia prendere 30."* → La priorità assoluta è l'efficacia nello studio, non l'estetica.
- Ha menzionato che il compagno che usa Obsidian ha impiegato "tipo una settimana" a configurarlo bene. Lei non ha una settimana: ha un esame tra 4 giorni.
- Il tablet in ospedale ha spesso zero campo: l'offline non è un "nice to have", è un requisito duro.
- Le piace l'idea del grafo ma ha paura che diventi "un casino di pallini". Vuole poter colorare i nodi per materia e filtrare.
- Ha chiesto esplicitamente: "Ma se disinstallo l'app, i miei appunti li posso aprire con Blocco Note?" → Il formato .md puro è non-negoziabile.
- È diffidente verso qualsiasi cosa che richieda un account: "Se devo registrarmi con la mail, per me è già no."
- Vorrebbe un pulsante "Ripasso oggi" che le dice: "Oggi hai 23 flashcard in scadenza, 5 di Anatomia, 12 di Patologia, 6 di Farmacologia. Inizia?" Senza che lei debba configurare nulla.
- Nota emotiva: è stressata. L'app non deve essere *un'altra cosa da configurare*. Deve essere un sollievo, non un compito in più.

---
