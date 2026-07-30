---
progetto: Fub
data: 2026-07-24
intervistato: Priya — Software Engineer / Backend Developer
ruolo: User persona tecnica avanzata
tipo_intervista: Intervista semi-strutturata per discovery requisiti
stato: bozza
---

# Brief Requisiti

## 1. Contesto e problema

### Problema principale
- Priya ha bisogno di una knowledge base personale e tecnica basata su file plain text, completamente open source, per documentare decisioni architetturali, snippet, runbook, incident post-mortem e learning log.
- Vuole uno strumento simile a Obsidian, ma senza dipendenza da componenti proprietari, sync a pagamento o ecosistema plugin fragile.

### Persone o ruoli coinvolti
- Software engineer backend/frontend/fullstack.
- DevOps, SRE, platform engineer.
- Technical writer e documentation owner.
- Team tecnici che usano il vault per onboarding e runbook condivisi.
- Utenti power user con familiarità con terminale, Git e Markdown.

### Situazione attuale
- Priya usa Obsidian come knowledge base personale e professionale.
- Ha personalizzato il vault con CSS snippets e plugin community.
- Usa il vault per:
  - Architecture Decision Record.
  - Snippet di codice in più linguaggi.
  - Runbook di incident response.
  - Learning log su Go, Rust, Kafka, Kubernetes, database, infrastruttura.
  - Materiale di onboarding per nuovi colleghi.
- Il suo workflow è fortemente centrato su terminale, Git e Linux.

### Limiti della soluzione attuale
- L’app attuale non è completamente open source.
- La sync ufficiale è a pagamento e non allineata alla sua preferenza per soluzioni self-hosted.
- Alcuni plugin community si rompono dopo aggiornamenti dell’app.
- Il supporto a diagrammi Mermaid e tabelle complesse potrebbe essere migliore.
- Dipendenza da plugin di terze parti per query avanzate, con rischio di instabilità.
- Possibile lock-in indiretto legato a plugin, formati di metadata o workflow non portabili.

### Motivazione del progetto
- Creare Fub come alternativa open source, local-first e transparentemente estendibile.
- Garantire che le note restino sempre file Markdown leggibili e versionabili.
- Permettere a utenti tecnici di integrare il vault con Git, CLI, script e strumenti da terminale.
- Ridurre la fragilità dell’ecosistema plugin tramite API stabili e versionate.
- Supportare casi d’uso tecnici avanzati senza richiedere servizi cloud proprietari.

## 2. Obiettivi

### Obiettivo principale
- Fornire un knowledge base personale open source, basato su Markdown plain text, con ricerca avanzata, sync self-hosted e workflow integrabile da terminale.

### Obiettivi secondari
- Supportare documentazione tecnica ricca: blocchi di codice, diagrammi Mermaid, tabelle, link bidirezionali, tag e metadata.
- Permettere query avanzate sulle note, ispirate a logiche tipo Dataview.
- Offrire una CLI per creare, cercare, aprire e sincronizzare note.
- Consentire personalizzazioni tramite plugin open source con API stabili.
- Facilitare l’uso del vault come strumento di onboarding tecnico e runbook personale/team.

### Risultati attesi
- Priya può sostituire il suo attuale setup Obsidian con Fub senza perdere velocità di ricerca.
- Il vault resta completamente portabile: cartella locale, file Markdown, Git.
- La ricerca tra migliaia di note tecniche è istantanea.
- La sincronizzazione self-hosted funziona senza servizi proprietari.
- I plugin essenziali restano stabili tra release diverse.
- I runbook sono recuperabili rapidamente durante incidenti.

### Non-obiettivi
- Diventare un SaaS di note con cloud gestito obbligatorio.
- Sostituire completamente strumenti di collaborazione real-time tipo Notion o Confluence.
- Offrire un editor WYSIWYG complesso orientato a utenti non tecnici.
- Introdurre un formato proprietario non esportabile.
- Gestire nativamente permessi aziendali complessi, SSO, audit log enterprise in questa fase.
- Diventare un database relazionale o un tool di project management completo.

## 3. Utenti e casi d’uso

### Utenti principali
- Sviluppatori e sviluppatrici con alto livello tecnico.
- Utenti Linux e terminal-heavy user.
- Persone che documentano codice, architettura, incidenti e procedure operative.
- Power user che vogliono controllare sync, plugin e formato dei dati.

### Utenti secondari
- Team tecnici che usano vault condivisi via Git.
- Technical writer e documentation maintainer.
- Studenti di informatica o ingegneria.
- Colleghi in onboarding che consultano documentazione strutturata.
- Utenti che usano strumenti self-hosted come Syncthing, Gitea, GitLab, Nextcloud.

### Competenze degli utenti
- Alta familiarità con Markdown.
- Conoscenza di Git e workflow da terminale.
- Capacità di configurare plugin, shortcut, script e integrazioni.
- Comprensione di concetti come repository, branch, commit, conflict, CLI.
- Preferenza per strumenti keyboard-driven e automatizzabili.

### Contesto d’uso
- Lavoro remoto su Linux, spesso Arch.
- Uso intensivo di terminale, editor esterni e repository Git.
- Consultazione rapida durante incidenti di produzione.
- Scrittura di note tecniche durante studio, debugging o progettazione.
- Sincronizzazione self-hosted tra laptop e telefono Pixel.
- Possibile uso del vault come riferimento condiviso per team o onboarding.

### Attività principali
- Creare note tecniche in Markdown.
- Collegare note tra loro con link bidirezionali e tag.
- Cercare rapidamente runbook, snippet e decisioni architetturali.
- Inserire blocchi di codice con syntax highlighting.
- Creare diagrammi Mermaid.
- Gestire tabelle complesse.
- Sincronizzare il vault con Git o strumenti self-hosted.
- Usare query avanzate per filtrare note per tag, percorso, data, metadata.
- Automatizzare operazioni tramite CLI.
- Personalizzare l’interfaccia o il comportamento con plugin.

### Difficoltà attuali
- Plugin che si rompono dopo aggiornamenti.
- Sync ufficiale non desiderato perché a pagamento o non self-hosted.
- Query avanzate dipendenti da plugin esterni instabili.
- Rendering non sempre soddisfacente per Mermaid e tabelle complesse.
- Attrito tra app GUI e workflow da terminale.
- Timore di lock-in o scarsa trasparenza del software.

## 4. Ambito del progetto

### Incluso nello scope
- Vault locale basato su cartella e file Markdown.
- Editor Markdown con preview o rendering tecnico.
- Link bidirezionali, backlinks, tag e metadata YAML frontmatter.
- Ricerca full-text veloce.
- Ricerca avanzata con operatori e query strutturate.
- Blocchi di codice con syntax highlighting per molti linguaggi.
- Supporto Mermaid.
- Supporto tabelle Markdown e tabelle complesse.
- Sincronizzazione self-hosted via Git.
- CLI per operazioni principali.
- Sistema plugin open source con API versionate.
- Import/export da vault Markdown esistenti.
- Temi o personalizzazioni CSS-like.
- Offline-first.

### Desiderabile ma non prioritario
- Graph view interattiva.
- Mobile companion app per Android.
- Sync alternativa via Syncthing o WebDAV.
- Crittografia opzionale del vault.
- Export PDF/HTML.
- Template avanzati.
- Daily notes e calendar view.
- Integrazione con LSP o editor esterni.
- Collaborazione multiutente asincrona via Git.
- Dashboard personalizzabili con query.

### Esplicitamente escluso
- Cloud proprietario obbligatorio.
- Account Fub centralizzato necessario per usare l’app.
- Formato note binario o proprietario.
- Editing real-time collaborativo complesso in stile Google Docs.
- Gestione enterprise di utenti, ruoli e permessi.
- Database proprietario non ispezionabile.
- Marketplace plugin chiuso o non trasparente.
- Telemetria obbligatoria.

### MVP minimo ipotizzato
- Apertura di una cartella vault con file Markdown.
- Creazione, modifica, eliminazione e ricerca note.
- Supporto tag, link wiki-style e YAML frontmatter.
- Ricerca full-text indicizzata e veloce.
- Blocchi di codice con syntax highlighting.
- Rendering Mermaid di base.
- Tabelle Markdown.
- CLI minima: `new`, `search`, `open`, `sync`.
- Sync Git di base: commit, pull, push con gestione conflitti semplice.
- Plugin API iniziale ma versionata.
- Compatibilità Linux desktop prioritaria.

## 5. Requisiti funzionali

- REQ-001: Il sistema deve gestire un vault come cartella locale contenente file Markdown plain text, con YAML frontmatter, tag, link bidirezionali e allegati in sottocartelle.
- REQ-002: Il sistema deve fornire ricerca full-text indicizzata e query avanzate con operatori come `tag:`, `path:`, `file:`, `created:`, `updated:`, regex e filtri su frontmatter.
- REQ-003: L’editor deve supportare rendering tecnico con syntax highlighting per almeno 10 linguaggi, diagrammi Mermaid, tabelle Markdown, code fence, inline code e blocchi espandibili.
- REQ-004: Il sistema deve permettere sincronizzazione self-hosted via Git, con operazioni da GUI e CLI, commit automatici o manuali, pull, push, rilevamento conflitti e preservazione dei file Markdown.
- REQ-005: Il sistema deve esporre un’API plugin open source versionata, con sandboxing o isolamento dei permessi, documentazione pubblica e meccanismo di compatibilità semver per ridurre rotture tra release.

## 6. Requisiti non funzionali

### Performance
- Apertura vault con almeno 10.000 note in pochi secondi.
- Ricerca base tra migliaia di note con risultato percepito istantaneo, idealmente sotto 300-500 ms.
- Indicizzazione incrementale dopo modifiche ai file.
- Rendering di note lunghe con code block e Mermaid senza blocchi evidenti.
- Avvio rapido anche su laptop Linux con risorse medie.

### Sicurezza
- Vault locale come fonte primaria; nessun invio obbligatorio di contenuti a server esterni.
- Plugin eseguiti con permessi espliciti e visibili.
- Possibilità di usare repository Git privati self-hosted.
- Supporto opzionale per crittografia at-rest o vault cifrato, almeno tramite strumenti esterni o integrazione futura.
- Nessun eseguibile o plugin firmato opaco senza verifica.

### Privacy e compliance
- Nessuna telemetria obbligatoria.
- Telemetria o crash report solo opt-in, anonimi e disattivabili.
- Nessun tracciamento dei contenuti del vault.
- Compliance GDPR-friendly: dati locali, controllo utente, nessun profilo cloud.
- Licenze open source chiare per core e plugin.

### Disponibilità
- Offline-first: l’app deve funzionare completamente senza rete.
- Sync disponibile quando la rete è presente.
- Degradazione elegante se Git remoto non raggiungibile.
- Backup locale e storico Git come meccanismi primari di recovery.

### Dispositivi e piattaforme
- Priorità: desktop Linux, con attenzione a distribuzioni rolling release come Arch.
- Secondario: telefono Pixel per consultazione, ricerca e note rapide.
- Terziario: macOS e Windows.
- Compatibilità con filesystem locali e repository Git standard.
- Supporto a editor esterni e workflow da terminale.

### Accessibilità
- Navigazione completa da tastiera.
- Command palette accessibile.
- Contrasto elevato e temi personalizzabili.
- Supporto screen reader per elementi principali.
- Scorciatoie configurabili.
- Dimensione font regolabile.

### Usabilità
- Curva di apprendimento bassa per operazioni base: creare, cercare, collegare note.
- Curva avanzata per utenti tecnici: CLI, query, plugin, Git.
- Command palette rapida.
- Shortcut personalizzabili.
- Gestione conflitti Git comprensibile, non distruttiva.
- Possibilità di usare Fub senza configurazioni complesse, ma estendibile per power user.

### Scalabilità
- Supporto vault fino a 50.000 note senza degrado grave.
- Gestione di migliaia di tag, link e allegati.
- Indice di ricerca ricostruibile senza corrompere il vault.
- Plugin system capace di supportare decine di plugin attivi.
- Architettura modulare per future integrazioni sync o mobile.

## 7. Dati e integrazioni

### Dati principali
- Note in formato Markdown `.md`.
- YAML frontmatter con metadata: tag, alias, data creazione, data modifica, stato, progetto, linguaggio, severità incidente, ecc.
- Link bidirezionali e riferimenti tra note.
- Allegati: immagini, PDF, diagrammi, log, snippet.
- Configurazione plugin e temi.
- Indice di ricerca locale.
- Cronologia Git del vault.

### Origine dei dati
- File locali nel vault.
- Repository Git remoti self-hosted.
- Import da vault Markdown esistenti.
- Note create da CLI.
- Note create da app desktop.
- Eventuali note rapide da mobile in futuro.

### Sistemi esterni
- Git / GitHub / GitLab / Gitea / Forgejo.
- Syncthing come alternativa di sync file-level.
- Terminale Linux.
- Editor esterni: Vim, Neovim, Emacs, VS Code.
- Strumenti CI/CD per validazione note o linting Markdown.
- Eventuali tool di incident management o ticketing, in futuro.

### API o servizi da integrare
- Git CLI o libreria Git per sync e versioning.
- Motore di syntax highlighting.
- Renderer Mermaid.
- Motore di ricerca locale, ad esempio indice full-text.
- API plugin interna.
- Eventuale protocollo URI per aprire note da browser o CLI.
- Eventuale integrazione LSP per note tecniche, non prioritaria.

### Vincoli tecnici
- Le note devono restare plain text UTF-8.
- Il vault deve essere una normale cartella filesystem.
- Nessun database proprietario obbligatorio come unica fonte di verità.
- Metadata preferibilmente in YAML frontmatter standard.
- Compatibilità con strumenti Git esistenti.
- Plugin e temi non devono richiedere servizi cloud proprietari.

### Dipendenze
- Parser Markdown robusto e CommonMark-compatible.
- Motore di ricerca locale.
- Libreria o eseguibile Git.
- Renderer Mermaid.
- Syntax highlighter multi-linguaggio.
- Runtime plugin sicuro o isolato.
- Toolkit UI cross-platform o nativo Linux-first.

## 8. Vincoli e ipotesi

### Vincoli di business
- Il progetto deve essere completamente open source.
- Il modello non deve basarsi su sync cloud proprietaria obbligatoria.
- La community deve poter ispezionare, modificare e contribuire al codice.
- Eventuali servizi opzionali devono essere trasparenti e sostituibili.

### Vincoli tecnici
- Local-first e file-based.
- Priorità Linux desktop.
- Integrazione Git come caso di sync primario.
- CLI di prima classe, non accessorio secondario.
- Plugin system stabile e versionato.
- Nessun formato proprietario per le note.

### Vincoli temporali
- MVP entro 3 mesi per validazione con power user tecnici.
- Beta pubblica entro 6 mesi.
- Release 1.0 con plugin API stabile e documentazione completa entro 9-12 mesi.
- Supporto mobile non bloccante per la prima release.

### Vincoli legali o compliance
- Licenza open source chiara e compatibile.
- Rispetto delle licenze delle dipendenze usate.
- Nessun invio non consensuale di dati utente.
- Telemetria solo opt-in.
- Eventuale contributo community con licenza esplicita.

### Ipotesi attuali
- Gli utenti principali sono a proprio agio con Git e terminale.
- Markdown plain text è accettato come formato sorgente.
- La sync preferita è self-hosted, non cloud gestito.
- Gli utenti vogliono personalizzare workflow e plugin.
- Il vault può essere usato sia individualmente sia in team tramite repository Git.
- La compatibilità con Obsidian vault è utile ma non deve diventare dipendenza totale.

### Regole di business
- Il file Markdown sul filesystem è la fonte di verità.
- L’indice di ricerca è derivato e ricostruibile.
- La configurazione plugin è separata dal contenuto delle note.
- Le operazioni di sync non devono sovrascrivere silenziosamente il lavoro utente.
- I conflitti Git devono essere visibili e risolvibili.
- I plugin devono dichiarare permessi e versione API supportata.

## 9. Priorità

### Must have
- Vault Markdown locale plain text.
- Ricerca full-text veloce.
- Editor con preview/rendering Markdown.
- Blocchi di codice con syntax highlighting.
- Tag, link bidirezionali e YAML frontmatter.
- CLI minima.
- Sync Git self-hosted.
- Plugin API versionata.
- Supporto Linux desktop.
- Nessun cloud obbligatorio.

### Should have
- Query avanzate tipo Dataview.
- Mermaid rendering avanzato.
- Tabelle complesse e ordinabili.
- Backlinks panel.
- Template per runbook, ADR, incident post-mortem.
- Command palette avanzata.
- Temi e CSS snippets.
- Gestione conflitti Git assistita.
- Import da vault esistenti.
- Documentazione plugin completa.

### Could have
- Graph view.
- Mobile app Android per consultazione e ricerca.
- Sync Syncthing integrata o guidata.
- Crittografia vault opzionale.
- Export PDF/HTML.
- Daily notes e calendar.
- Dashboard con query salvate.
- Integrazione con editor esterni via URI.
- Plugin marketplace open source decentralizzato.
- Supporto macOS/Windows packaging.

### Won't have in questa release
- Cloud sync proprietaria a pagamento.
- Editing collaborativo real-time.
- Gestione permessi enterprise.
- Database proprietario.
- WYSIWYG avanzato stile Notion.
- Integrazioni native con tool di ticketing complesse.
- AI assistant integrato obbligatorio.
- Mobile iOS prioritario.
- Automazioni no-code complesse.

## 10. Criteri di successo

### Successo del progetto
- Priya riesce a usare Fub quotidianamente per almeno due settimane senza tornare al tool precedente.
- Durante un incidente, Priya trova un runbook salvato mesi prima in meno di pochi secondi.
- Il vault resta completamente versionabile in Git e leggibile fuori dall’app.
- I plugin essenziali non si rompono a ogni aggiornamento.
- La sync self-hosted è affidabile e trasparente.

### Criteri di accettazione generali
- Una cartella con note Markdown può essere aperta come vault senza conversione distruttiva.
- La ricerca restituisce risultati pertinenti per tag, testo e metadata.
- I blocchi di codice mostrano syntax highlighting corretto per Go, Rust, Python, TypeScript, SQL, YAML, Bash, JSON, TOML e almeno un altro linguaggio.
- I diagrammi Mermaid vengono renderizzati correttamente.
- La CLI permette almeno creazione, ricerca, apertura e sync.
- Git sync non perde modifiche locali se il remote non è raggiungibile.
- I conflitti vengono segnalati e non causano perdita silenziosa di dati.
- I plugin dichiarano versione API e permessi.
- L’app funziona offline.

### Metriche di valutazione
- Tempo medio di ricerca nota: target < 500 ms su vault da 10.000 note.
- Tempo per trovare un runbook durante scenario incidente: target < 10 secondi.
- Crash-free session: target > 99%.
- Numero di plugin core rotti dopo release: target 0 per plugin verificati.
- Tempo medio per risolvere conflitto Git: target < 2 minuti per casi semplici.
- Percentuale di operazioni completabili da tastiera: alta, idealmente 100% per flussi core.
-Retention su utenti tecnici dopo 30 giorni.
- Numero di issue legate a perdita dati: target 0.
- Tempo di indicizzazione iniziale vault 10.000 note: target < 60 secondi su hardware medio.

## 11. Rischi e domande aperte

### Rischi principali
- Il sistema plugin può diventare instabile se le API cambiano troppo spesso.
- La ricerca avanzata può diventare complessa da implementare e mantenere.
- Git sync può generare conflitti difficili per utenti meno tecnici.
- Il rendering Mermaid e tabelle complesse può richiedere molta cura.
- La priorità Linux potrebbe limitare adoption se non accompagnata da packaging curato.
- La compatibilità con vault esistenti può creare aspettative troppo alte.
- Performance scadenti con vault molto grandi.
- Mobile sync può introdurre complessità non banali.
- La community può aspettarsi compatibilità totale con plugin esistenti.
- Sicurezza dei plugin se eseguiti con troppi permessi.

### Domande aperte
- Quale licenza open source usare: MIT, Apache 2.0, GPL, AGPL?
- Il query language deve essere compatibile con Dataview o solo ispirato?
- Come gestire i conflitti Git in modo comprensibile ma potente?
- Quale livello di sandboxing è realistico per i plugin?
- La CLI deve essere installata separatamente o inclusa nel pacchetto desktop?
- Il vault mobile deve essere read-only all’inizio o supportare editing completo?
- Come distribuire i plugin in modo aperto ma sicuro?
- Quali metadata standardizzare nel frontmatter?
- Serve un formato di plugin manifest standard?
- Come gestire allegati pesanti e repository Git?

### Informazioni mancanti
- Requisiti dettagliati per vault condivisi in team.
- Flussi di review delle note tramite pull request.
- Esigenze di crittografia end-to-end.
- Importazione da strumenti diversi: Notion, Logseq, Roam, Joplin.
- Supporto desiderato per note giornaliere e automazioni.
- Aspettative su collaborazione asincrona.
- Limiti massimi realistici per allegati e vault.
- Preferenze su packaging Linux: AppImage, Flatpak, AUR, pacchetti distro.

### Decisioni da prendere
- Licenza del progetto.
- Architettura plugin: processo separato, sandbox, permessi.
- Motore di ricerca e formato indice.
- Linguaggio e toolkit UI.
- Grado di compatibilità con vault e plugin esistenti.
- Sintassi query avanzata.
- Strategia mobile: app nativa, companion, PWA, repository locale.
- Default sync: Git puro, Git + helper, Syncthing, entrambi.
- Struttura standard del frontmatter.
- Policy su telemetria e crash report.

## 12. Note grezze

- Priya ripete spesso: “Se non è in plain text, non esiste.”
- Vuole poter aprire il vault con qualsiasi editor, grep, rg, fzf, Git.
- Scenario critico: incidente di produzione alle 23:00. Cerca `tag:#incident tag:#kafka`, trova il runbook scritto 8 mesi prima e risolve in 10 minuti.
- La ricerca deve essere affidabile anche sotto stress e con sonno arretrato.
- Non vuole dover configurare un account cloud per usare l’app.
- Preferisce Git o Syncthing rispetto a sync proprietaria.
- Usa Linux Arch e Pixel: il supporto Linux non deve essere di serie B.
- Ha bisogno di code block seri: Go, Rust, SQL, YAML, Bash, JSON, TOML, TypeScript, Python, Dockerfile.
- I diagrammi Mermaid sono importanti per architetture, sequence diagram e flussi incident.
- Le tabelle complesse servono per confrontare configurazioni, versioni, comandi, endpoint, feature flag.
- I plugin sono utili, ma devono rompersi il meno possibile.
- Vorrebbe un sistema di plugin più stabile, con versioni API chiare e test.
- La CLI è fondamentale: creare note, cercare, sincronizzare senza uscire dal terminale.
- Il vault è anche uno strumento di onboarding: deve essere navigabile, linkato e ricercabile.
- Fub deve sembrare uno strumento per persone tecniche, non un notes generico mascherato da developer tool.
