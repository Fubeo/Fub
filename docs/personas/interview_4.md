---
progetto: Fub
data: 2026-07-24
intervistato: Davide — Head of Operations / Project Manager
ruolo: User persona manageriale, knowledge worker non tecnico
tipo_intervista: Intervista semi-strutturata per discovery requisiti
stato: bozza
---

# Brief Requisiti

## 1. Contesto e problema

### Problema principale
- Davide prende molti appunti durante riunioni e call, ma poi non riesce a ritrovarli, organizzarli o trasformarli in azioni concrete.
- Ha bisogno di uno strumento semplice, veloce e immediatamente usabile per catturare decisioni, action item e riferimenti a persone e progetti.
- Vuole provare un metodo di organizzazione personale ispirato allo Zettelkasten, ma senza complessità tecnica.

### Persone o ruoli coinvolti
- Project manager e responsabili operativi.
- Head of Operations, team leader, coordinatori.
- Knowledge worker non tecnici.
- Assistenti, PMO, responsabili di progetto.
- Membri del team che ricevono task o decisioni durante le riunioni.

### Situazione attuale
- Davide gestisce un team di 20 persone.
- Partecipa a 8-10 riunioni a settimana.
- Prende appunti velocemente durante le call.
- Usa probabilmente strumenti misti: note rapide, email, fogli, app di note generiche.
- Ha già provato molte app di note senza trovare una soluzione soddisfacente.
- Vuole creare note di riunione collegate a progetti e persone, ad esempio `[[Progetto_Rinnovo_Linee]]` e `[[Marco_Rossi]]`.

### Limiti della soluzione attuale
- Le note vengono catturate ma non riutilizzate.
- Gli action item restano sepolti negli appunti.
- È difficile ritrovare una decisione o una frase detta da una persona in una riunione passata.
- Le app provate sono troppo complesse, troppo tecniche o troppo rigide.
- La sintassi Markdown viene percepita come “da programmatori”.
- Tag, link e cartelle non sono chiari come concetto organizzativo.
- Manca un flusso immediato: riunione → nota → action item → follow-up.

### Motivazione del progetto
- Creare in Fub una modalità semplice e guidata per knowledge worker non tecnici.
- Permettere cattura rapida, collegamento tra note e ricerca immediata senza configurazioni.
- Rendere i collegamenti tra persone, progetti e riunioni comprensibili anche a chi non conosce Markdown.
- Offrire un’alternativa open source che sia anche realmente usabile da utenti aziendali non tecnici.

## 2. Obiettivi

### Obiettivo principale
- Consentire a Davide di catturare rapidamente appunti di riunione, action item e decisioni, collegandoli a progetti e persone, e ritrovarli in pochi secondi.

### Obiettivi secondari
- Ridurre il tempo necessario per aprire una nota di riunione strutturata.
- Trasformare le checkbox in action item leggibili e tracciabili.
- Creare collegamenti semplici verso persone, progetti, argomenti e riunioni.
- Permettere ricerche del tipo: “cosa aveva detto Marco a marzo?”.
- Avere una vista chiara dei task assegnati e delle scadenze.
- Sincronizzare le note tra PC Windows aziendale e iPad senza configurazioni tecniche.

### Risultati attesi
- Durante la riunione del lunedì, Davide apre un template `Meeting_YYYY-MM-DD` in pochi secondi.
- Le decisioni chiave vengono scritte direttamente nella nota.
- I task assegnati sono checkbox con proprietario e scadenza.
- Venerdì, cercando `[[Marco_Rossi]]`, Davide ritrova subito la scadenza concordata.
- Le note non restano archiviate morta, ma diventano materiale ricercabile e riutilizzabile.
- L’esperienza è abbastanza semplice da non richiedere formazione tecnica.

### Non-obiettivi
- Obbligare l’utente a usare Git, terminale o CLI.
- Esporre la sintassi Markdown come elemento principale.
- Richiedere configurazione manuale di sync self-hosted complessa.
- Supportare flussi accademici avanzati come LaTeX, citazioni bibliografiche complesse o export scientifici.
- Diventare un tool di project management completo con Gantt, risorse, budget e portfolio management.
- Sostituire completamente strumenti aziendali come Outlook, Teams o ERP.

## 3. Utenti e casi d’uso

### Utenti principali
- Manager e responsabili operativi con basso livello tecnico.
- Project manager, team leader, coordinatori.
- Knowledge worker che partecipano a molte riunioni.
- Utenti che vogliono organizzare note e task senza imparare un linguaggio di markup.

### Utenti secondari
- Membri del team che ricevono action item.
- Assistenti o PMO che consolidano note e decisioni.
- Colleghi che cercano informazioni su progetti passati.
- Utenti iPad che prendono note in mobilità.
- Persone che vogliono passare da app di note generiche a un sistema più strutturato.

### Competenze degli utenti
- Competenze digitali di base: email, browser, Office, calendario, app di note.
- Nessuna familiarità necessaria con Markdown, Git o terminale.
- Comprensione base di concetti come riunione, progetto, task, scadenza, partecipante.
- Preferenza per interfacce visive, toolbar e azioni immediate.
- Bassa tolleranza per configurazioni tecniche o errori bloccanti.

### Contesto d’uso
- PC Windows aziendale durante riunioni, call e lavoro quotidiano.
- iPad per consultazione, lettura o note rapide.
- Riunioni frequenti, spesso back-to-back.
- Necessità di scrivere velocemente mentre qualcuno parla.
- Follow-up il venerdì o nei giorni successivi per verificare scadenze e task.
- Possibile uso in contesto aziendale con dati riservati.

### Attività principali
- Aprire rapidamente una nota di riunione.
- Scrivere decisioni, appunti e action item.
- Collegare la nota a un progetto e alle persone coinvolte.
- Spuntare task completati.
- Cercare note passate per persona, progetto, data o parola chiave.
- Ritrovare frasi o decisioni specifiche.
- Consultare le note da iPad.
- Condividere o esportare appunti quando necessario.

### Difficoltà attuali
- Non capisce la differenza tra tag, link e cartelle.
- La sintassi Markdown sembra tecnica e poco amichevole.
- Ha bisogno di qualcosa che funzioni subito, senza setup.
- Le note delle riunioni si accumulano e non vengono più rilette.
- Gli action item non sono facilmente tracciabili.
- La ricerca tra note, persone e progetti è lenta o inefficace.
- Le app precedenti erano troppo complesse o troppo generiche.

## 4. Ambito del progetto

### Incluso nello scope
- Editor visuale semplice, con Markdown nascosto o assistito.
- Template di riunione con data automatica.
- Checkbox per action item.
- Collegamenti guidati a persone, progetti e argomenti.
- Ricerca rapida e filtri semplici.
- Salvataggio automatico.
- Vista nota, vista elenco, vista attività.
- Esportazione base in Markdown, PDF o testo.
- Sincronizzazione guidata tra Windows e iPad.
- Interfaccia priva di gergo tecnico.
- Onboarding iniziale molto breve.

### Desiderabile ma non prioritario
- Integrazione con calendario per creare note riunione automaticamente.
- Promemoria per action item in scadenza.
- Importazione da altre app di note.
- Vista “persona” con tutte le note collegate a una persona.
- Vista “progetto” con tutte le riunioni e i task collegati.
- Dettatura vocale.
- Scrittura a mano su iPad.
- Grafico semplice delle relazioni tra progetti e persone.
- Condivisione read-only di una nota.
- Temi ad alto contrasto.

### Esplicitamente escluso
- Git obbligatorio.
- CLI obbligatoria.
- Configurazione manuale di repository.
- Plugin complessi gestiti dall’utente non tecnico.
- Esportazione LaTeX accademica.
- Gestione avanzata di citazioni bibliografiche.
- Automazioni complesse o scripting.
- Database proprietario non esportabile.
- Cloud obbligatorio non trasparente.
- Telemetria obbligatoria.

### MVP minimo ipotizzato
- Creazione nota da template riunione.
- Template con data automatica, partecipanti, decisioni, action item.
- Editor visuale con titoli, elenchi, checkbox, grassetti e link.
- Collegamenti guidati a persone e progetti con autocomplete.
- Ricerca istantanea per testo, persona, progetto e data.
- Salvataggio automatico.
- Vista action item con checkbox.
- Sincronizzazione semplice tra PC e iPad, anche tramite cartella cloud esistente o procedura guidata.
- Esportazione base della nota.

## 5. Requisiti funzionali

- REQ-001: Il sistema deve permettere la creazione rapida di note da template, in particolare `Meeting_YYYY-MM-DD`, con sezioni precompilate per partecipanti, agenda, decisioni, action item e note di follow-up.
- REQ-002: Il sistema deve fornire un editor visuale che nasconda la sintassi Markdown e permetta di formattare testo, elenchi, checkbox, tabelle semplici e collegamenti tramite toolbar o menu contestuali.
- REQ-003: Il sistema deve consentire collegamenti semplici verso entità come Persone, Progetti, Riunioni e Argomenti tramite autocomplete, senza richiedere all’utente di conoscere tag, link o cartelle.
- REQ-004: Il sistema deve offrire ricerca istantanea con filtri comprensibili, ad esempio persona, progetto, data, tipo nota e testo libero, supportando casi d’uso come “trovare una cosa detta da Marco a marzo”.
- REQ-005: Il sistema deve sincronizzare automaticamente il vault tra PC Windows e iPad in modalità guidata, offline-first, con gestione semplice dei conflitti e senza richiedere Git o configurazioni tecniche.

## 6. Requisiti non funzionali

### Performance
- Apertura dell’app in pochi secondi.
- Creazione nota da template in meno di 2 secondi.
- Ricerca percepita come istantanea.
- Scrittura fluida durante riunioni veloci.
- Gestione di migliaia di note di riunione senza rallentamenti evidenti.

### Sicurezza
- Note salvate localmente o su storage scelto dall’utente.
- Nessun invio obbligatorio di contenuti a servizi esterni.
- Possibilità di usare cartelle aziendali già presidiate, se consentito.
- Crittografia opzionale o integrazione con protezioni OS.
- Backup automatico o guidato.

### Privacy e compliance
- Nessuna telemetria obbligatoria.
- Dati aziendali riservati non usati per addestramento o analisi esterne.
- Telemetria anonima solo opt-in.
- Rispetto GDPR.
- Trasparenza su dove sono salvati i dati.

### Disponibilità
- Funzionamento offline completo.
- Sincronizzazione quando disponibile.
- Nessun blocco se la rete manca durante una riunione.
- Recupero automatico dopo chiusura accidentale.

### Dispositivi e piattaforme
- Priorità: PC Windows aziendale.
- Secondario: iPad.
- Interfaccia adattiva per desktop e tablet.
- Supporto a tastiera fisica e input touch.
- Possibile uso con mouse, trackpad e Apple Pencil.

### Accessibilità
- Testo leggibile e ridimensionabile.
- Contrasto elevato.
- Navigazione da tastiera.
- Supporto screen reader per elementi principali.
- Checkbox e link chiaramente identificabili.
- Linguaggio semplice e privo di gergo tecnico.

### Usabilità
- Zero configurazione iniziale complessa.
- Onboarding guidato in pochi passi.
- Toolbar visibile e intuitiva.
- Nessuna sintassi Markdown obbligatoria.
- Messaggi di errore chiari e recuperabili.
- Azioni principali raggiungibili in pochi click.
- Terminologia utente: “persone”, “progetti”, “riunioni”, “attività”, non “tag”, “frontmatter”, “repository”.

### Scalabilità
- Supporto a migliaia di note di riunione.
- Gestione di centinaia di persone e progetti.
- Indice di ricerca ricostruibile.
- Prestazioni accettabili dopo anni di utilizzo.
- Possibilità di aggiungere viste e filtri senza degradare l’esperienza base.

## 7. Dati e integrazioni

### Dati principali
- Note di riunione.
- Template.
- Persone.
- Progetti.
- Action item.
- Checkbox, scadenze, proprietari.
- Tag o etichette semplificate.
- Collegamenti tra note.
- Allegati semplici, ad esempio screenshot o documenti.
- Impostazioni utente e preferenze UI.

### Origine dei dati
- Inserimento manuale durante riunioni.
- Template precompilati.
- Importazione da altre app di note, se disponibile.
- Eventuale calendario per creare note riunione.
- Eventuali email o appunti copiati.

### Sistemi esterni
- Calendario aziendale, ad esempio Outlook o Google Calendar.
- Storage sincronizzato già usato dall’utente, ad esempio OneDrive, iCloud, Dropbox, Nextcloud o WebDAV.
- Sistema operativo Windows e iPadOS.
- Eventuali strumenti di task management, in futuro.
- Email, per copia/incolla o importazione semplice.

### API o servizi da integrare
- API calendario per creare note riunione automaticamente.
- API notifiche OS per promemoria task.
- Servizi di storage per sincronizzazione guidata.
- Motore di ricerca locale.
- Eventuale servizio di trascrizione riunioni, non prioritario.

### Vincoli tecnici
- Le note devono restare esportabili in Markdown plain text.
- L’utente non deve vedere o gestire file tecnici.
- La sincronizzazione non deve richiedere Git.
- Il sistema deve funzionare in ambienti Windows aziendali con possibili restrizioni.
- I dati devono essere recuperabili anche fuori dall’app.

### Dipendenze
- Editor visuale Markdown.
- Motore di ricerca locale.
- Motore template.
- Sistema di sincronizzazione file o provider storage.
- Indice note e metadati.
- Componenti UI accessibili.

## 8. Vincoli e ipotesi

### Vincoli di business
- Fub deve essere open source.
- Deve essere usabile anche da utenti non tecnici.
- Non deve richiedere servizi cloud proprietari obbligatori.
- Deve poter essere adottato in PMI senza infrastrutture complesse.
- Deve ridurre il rischio di abbandono rispetto alle 15 app già provate da Davide.

### Vincoli tecnici
- Priorità Windows e iPad.
- Nessuna dipendenza obbligatoria da terminale o CLI.
- Markdown come formato sottostante, ma non esposto come linguaggio.
- Sincronizzazione semplice e guidata.
- Template e collegamenti devono essere gestiti da UI.
- Il sistema deve essere robusto anche con uso non tecnico.

### Vincoli temporali
- MVP semplice entro 3 mesi.
- Validazione con utenti non tecnici entro 4-5 mesi.
- Funzioni di follow-up e sync iPad entro la prima release utile.
- Integrazioni calendario in release successiva.

### Vincoli legali o compliance
- Rispetto GDPR.
- Gestione prudente di dati aziendali riservati.
- Licenze open source compatibili.
- Nessun uso non autorizzato dei contenuti.
- Telemetria solo opt-in.

### Ipotesi attuali
- Davide è disposto a usare template se riducono lo sforzo.
- Accetta collegamenti automatici a persone e progetti se presentati in modo semplice.
- Ha già una cartella cloud o un metodo di sync tra PC e iPad.
- Non vuole imparare Markdown.
- Vuole velocità più che controllo tecnico.
- Usa riunioni ricorrenti come caso principale.

### Regole di business
- La nota è la fonte principale, ma i metadati di persone/progetti/task devono essere usabili dalla UI.
- I template non devono bloccare la libertà di modifica.
- Gli action item devono restare leggibili come testo.
- La ricerca deve funzionare anche se l’utente non usa tag correttamente.
- I conflitti di sync non devono causare perdita di note.
- L’utente deve poter esportare tutto.

## 9. Priorità

### Must have
- Template riunione rapido.
- Editor visuale semplice.
- Checkbox per action item.
- Collegamenti guidati a persone e progetti.
- Ricerca veloce con filtri persona/progetto/data.
- Salvataggio automatico.
- Sincronizzazione guidata Windows-iPad.
- Esportazione base.
- Interfaccia senza gergo tecnico.

### Should have
- Vista action item in scadenza.
- Promemoria task.
- Vista persona.
- Vista progetto.
- Importazione da altre app.
- Integrazione calendario.
- Allegati semplici.
- Condivisione read-only.
- Template personalizzabili.
- Ricerca con suggerimenti automatici.

### Could have
- Grafico semplice delle relazioni.
- Dettatura vocale.
- Scrittura a mano su iPad.
- Trascrizione riunione.
- Dashboard settimanale.
- Report action item per progetto.
- Temi personalizzati.
- Scorciatoie rapide da tablet.
- Esportazione PDF avanzata.
- Promemoria ricorrenti.

### Won't have in questa release
- Git obbligatorio.
- CLI.
- Plugin avanzati gestiti dall’utente.
- LaTeX export.
- Citazioni bibliografiche accademiche.
- Project management completo.
- Gantt e resource planning.
- Automazioni complesse.
- Integrazioni ERP.
- Collaborazione real-time complessa.

## 10. Criteri di successo

### Successo del progetto
- Davide riesce ad aprire una nota riunione in pochi secondi durante una call.
- Gli action item non vengono più persi.
- Venerdì ritrova in 10 secondi una scadenza concordata con Marco.
- Non deve pensare a tag, cartelle o sintassi.
- Usa Fub con continuità senza tornare alle app precedenti.

### Criteri di accettazione generali
- Il template riunione si crea automaticamente con la data corretta.
- L’utente può aggiungere partecipanti, decisioni e task senza scrivere Markdown.
- I collegamenti a persone e progetti sono creati con autocomplete.
- La ricerca restituisce risultati pertinenti per persona, progetto, data e testo.
- Le checkbox sono cliccabili e salvate correttamente.
- La nota è sincronizzata tra Windows e iPad senza intervento tecnico.
- L’esportazione produce un file leggibile fuori dall’app.
- Nessun messaggio tecnico bloccante compare all’utente.

### Metriche di valutazione
- Tempo per aprire template riunione: target < 3 secondi.
- Tempo per trovare una nota passata: target < 10 secondi.
- Percentuale di action item con proprietario e scadenza: target > 80%.
- Tasso di note riunione effettivamente riviste: aumento significativo.
- Errori di sincronizzazione percepiti: target molto basso.
- Crash-free session: target > 99%.
- Numero di utenti non tecnici che completano onboarding senza aiuto: target alto.
- Tempo medio per completare onboarding: target < 5 minuti.

## 11. Rischi e domande aperte

### Rischi principali
- Rendere l’app troppo semplice e poco flessibile.
- Nascondere Markdown ma perdere potenza di ricerca e collegamenti.
- Sincronizzazione Windows-iPad complessa in ambienti aziendali.
- Utente che non comprende comunque concetti di collegamento e ricerca.
- Template troppo rigidi per riunioni diverse.
- Action item non abbastanza strutturati o troppo strutturati.
- Conflitti di sync incomprensibili per utente non tecnico.
- Aspettative elevate dopo molte app già provate.
- Possibili restrizioni IT aziendali su installazione o storage.
- Perdita di fiducia se la ricerca non è immediata.

### Domande aperte
- Quale provider di sync è più accettabile in PMI: OneDrive, iCloud, Dropbox, WebDAV, Nextcloud?
- Come rappresentare persone e progetti senza esporre tag o cartelle?
- Gli action item devono avere scadenza formale o restare checkbox testuali?
- Serve una vista task separata o basta nella nota?
- Come gestire note create da iPad e modificate da PC?
- Quanta struttura imporre nel template riunione?
- È accettabile una modalità “semplice” e una modalità “avanzata”?
- Come importare note da app precedenti senza creare confusione?
- Serve integrazione con Outlook/Teams o basta copia/incolla?
- Come spiegare link, persone e progetti con linguaggio non tecnico?

### Informazioni mancanti
- Strumenti attuali esatti usati da Davide.
- Policy aziendali su cloud e installazione software.
- Volume reale di note mensili e annuali.
- Necessità di condividere note con il team.
- Formato preferito per export e follow-up.
- Uso reale dell’iPad: sola consultazione o anche scrittura.
- Eventuale necessità di firme, approvazioni o audit.
- Preferenze su notifiche e promemoria.

### Decisioni da prendere
- Architettura di sincronizzazione guidata.
- Modello dati per Persone, Progetti e Task.
- Grado di semplicità della UI rispetto a funzioni avanzate.
- Formato template predefiniti.
- Linguaggio delle etichette UI.
- Gestione conflitti utente.
- Import/export supportati nella prima release.
- Eventuale integrazione calendario.
- Livello di strutturazione degli action item.
- Licenza open source e distribuzione Windows/iPad.

## 12. Note grezze

- Davide ha provato 15 app di note.
- Vuole solo che funzioni e che sia veloce.
- Non vuole configurare nulla.
- Non capisce la differenza tra tag, link e cartelle.
- La sintassi Markdown gli sembra “da programmatori”.
- Scenario chiave: riunione del lunedì, template `Meeting_YYYY-MM-DD`, decisioni, task, collegamento a `[[Progetto_Rinnovo_Linee]]`.
- Venerdì cerca `[[Marco_Rossi]]` per ricordargli una scadenza.
- Deve poter ritrovare “quella cosa che aveva detto Marco a marzo” in 10 secondi.
- Il valore principale non è scrivere note, ma ritrovare decisioni e action item.
- Fub deve sembrare un assistente operativo, non un editor per sviluppatori.
