---
progetto: Fub
data: 2026-07-24
intervistato: Dott.ssa Elena — Ricercatrice post-doc in Neuroscienze Cognitive
ruolo: User persona accademica, livello tecnico medio-alto
tipo_intervista: Intervista semi-strutturata per discovery requisiti
stato: bozza
---

# Brief Requisiti

## 1. Contesto e problema

### Problema principale
- Elena gestisce un database di oltre 1.200 paper scientifici e sta scrivendo una review article per una rivista Q1.
- Ha bisogno di collegare paper, concetti, evidenze e sezioni del manoscritto in modo strutturato, visivo e citazionale.
- Il flusso attuale tra Zotero, PDF, note Markdown e scrittura accademica richiede troppi passaggi manuali.

### Persone o ruoli coinvolti
- Ricercatori post-doc.
- Dottorandi e dottorande.
- Principal investigator.
- Co-autori.
- Studenti di master o PhD.
- Collaboratori internazionali.
- Librari accademici o research data manager.

### Situazione attuale
- Elena usa Obsidian insieme a Zotero.
- Ogni paper ha una nota con abstract, highlights e riflessioni critiche.
- Collega le note dei paper a temi della review, ad esempio `[[Default_Mode_Network]]`.
- Usa MacBook Pro e iPad con Apple Pencil.
- Legge paper, evidenzia PDF, importa contenuti e costruisce l’argomentazione scientifica nel vault.
- Sta scrivendo una review article complessa con molti riferimenti bibliografici.

### Limiti della soluzione attuale
- Il flusso Zotero → Obsidian richiede troppi passaggi manuali.
- Le formule matematiche in LaTeX a volte non renderizzano correttamente.
- Collaborare con co-autori è difficile perché usano Google Docs.
- L’esportazione verso LaTeX o formati accademici può richiedere pulizia manuale.
- La mappa concettuale della letteratura potrebbe essere più integrata con la scrittura.
- Le annotazioni PDF e le note Markdown non sono sempre allineate.
- La gestione di 1.200+ paper richiede performance e organizzazione robuste.

### Motivazione del progetto
- Rendere Fub uno strumento open source adatto al workflow accademico.
- Integrare Zotero, note Markdown, citazioni, grafo concettuale e export LaTeX in modo più fluido.
- Supportare scrittura scientifica, review article, letteratura e mappe concettuali.
- Mantenere il vault come mappa mentale della letteratura, ma con strumenti più automatizzati.
- Facilitare la collaborazione con co-autori senza obbligare tutti a usare lo stesso tool.

## 2. Obiettivi

### Obiettivo principale
- Permettere a Elena di importare, collegare, annotare e scrivere letteratura scientifica in un vault Markdown open source, con citazioni Zotero, rendering matematico affidabile ed export LaTeX.

### Obiettivi secondari
- Ridurre i passaggi manuali tra Zotero e vault.
- Creare mappe concettuali visive della letteratura.
- Collegare paper, temi, metodi, risultati e sezioni del manoscritto.
- Scrivere il draft della review direttamente nel vault.
- Esportare in LaTeX, BibTeX, DOCX o PDF.
- Collaborare con co-autori che usano Google Docs tramite export/import leggibili.
- Usare iPad e Apple Pencil per leggere e annotare paper.

### Risultati attesi
- Importazione di un paper da Zotero in pochi passaggi.
- Note paper con metadata, citation key, abstract, highlights e note critiche.
- Collegamenti stabili tra paper e concetti, ad esempio `[[Default_Mode_Network]]`.
- Rendering corretto di formule LaTeX inline e display.
- Grafo utile per esplorare la letteratura e costruire argomentazioni.
- Export LaTeX pulito e compilabile.
- Bozza condivisibile con co-autori in DOCX o PDF.
- Vault usabile come mappa mentale della letteratura degli ultimi 5 anni.

### Non-obiettivi
- Sostituire completamente Zotero come reference manager.
- Diventare un editor LaTeX IDE completo.
- Offrire collaborazione real-time identica a Google Docs.
- Gestire submission a riviste, peer review o editorial workflow.
- Diventare un sistema di analisi statistica o neuroimaging.
- Obbligare i co-autori a installare Fub.
- Gestire dataset sperimentali grezzi pesanti come un repository di ricerca.

## 3. Utenti e casi d’uso

### Utenti principali
- Ricercatori e ricercatrici accademiche.
- Post-doc e PhD student.
- Utenti con livello tecnico medio-alto.
- Persone che usano Zotero, Markdown, LaTeX o Pandoc.
- Autori di review article, paper scientifici e grant proposal.

### Utenti secondari
- Co-autori che usano Google Docs o Word.
- Principal investigator che revisionano bozze.
- Studenti che costruiscono literature review.
- Research data manager.
- Librari accademici.
- Collaboratori che commentano bozze senza usare Markdown.

### Competenze degli utenti
- Familiarità con letteratura scientifica e reference manager.
- Conoscenza base o intermedia di Markdown.
- Conoscenza di LaTeX o almeno export accademico.
- Uso di PDF annotati, highlight, note critiche.
- Capacità di usare plugin, preferenze e workflow configurabili.
- Comfort con concetti come citation key, BibTeX, DOI, abstract.

### Contesto d’uso
- MacBook Pro per scrittura, importazione e gestione vault.
- iPad con Apple Pencil per lettura e annotazione.
- Scrittura di review article con scadenze editoriali.
- Lettura di paper su fMRI, memoria di lavoro, Default Mode Network.
- Costruzione di paragrafi argomentativi collegati a temi e paper.
- Collaborazione con co-autori esterni su bozze e sezioni.

### Attività principali
- Importare paper da Zotero.
- Creare note per paper con abstract, highlights e riflessioni.
- Collegare paper a concetti, metodi e sezioni della review.
- Evidenziare PDF e importare annotazioni.
- Scrivere paragrafi con citazioni.
- Inserire formule matematiche.
- Visualizzare grafo concettuale.
- Esportare draft in LaTeX, DOCX o PDF.
- Condividere bozze con co-autori.
- Recuperare rapidamente note su un tema specifico.

### Difficoltà attuali
- Troppi passaggi manuali tra Zotero e Obsidian.
- Formule LaTeX non sempre renderizzate correttamente.
- Collaborazione difficile con chi usa Google Docs.
- Gestione di grande volume di paper.
- Necessità di mantenere coerenza tra citazioni, note e manoscritto.
- Rischio di perdere collegamenti concettuali tra paper e sezioni.
- Export accademico non sempre pulito.

## 4. Ambito del progetto

### Incluso nello scope
- Integrazione con Zotero.
- Importazione metadata, citation key, abstract, tag e collezioni.
- Importazione highlight e annotazioni PDF, se supportate.
- Note Markdown con YAML frontmatter accademico.
- Rendering formule LaTeX inline e display.
- Backlinks e grafo concettuale.
- Template per paper note, review section, concept note.
- Export LaTeX, BibTeX, DOCX e PDF.
- Supporto citazioni e bibliography.
- Sync tra MacBook e iPad.
- Supporto Apple Pencil desiderabile.
- Ricerca avanzata su paper, concetti e note.

### Desiderabile ma non prioritario
- Annotazione PDF nativa dentro Fub.
- Vista kanban per sezioni del manoscritto.
- Commenti inline per co-autori.
- Track changes o revision mode.
- Integrazione con Hypothesis.
- Ricerca semantica tra note e paper.
- Dashboard review con avanzamento sezioni.
- Esportazione verso formati journal-specific.
- Gestione figure e tabelle accademiche.
- Handwriting recognition su iPad.

### Esplicitamente escluso
- Sostituzione completa di Zotero.
- Reference manager nativo complesso.
- Editing real-time multiutente stile Google Docs nella prima release.
- Submission a journal.
- Gestione peer review.
- Analisi statistica o pipeline neuroimaging.
- Cloud proprietario obbligatorio.
- Formato note non esportabile.
- Telemetria obbligatoria.
- AI generativa obbligatoria.

### MVP minimo ipotizzato
- Importazione paper da Zotero tramite Better BibTeX o API Zotero.
- Template paper note con metadata, abstract, citation key, note critiche.
- Editor Markdown con rendering formule LaTeX affidabile.
- Backlinks e vista grafo base.
- Ricerca per titolo, autore, tag, citation key, concetto.
- Export LaTeX e BibTeX.
- Export DOCX tramite Pandoc.
- Sync vault tra dispositivi Apple.
- Collegamenti tra paper e note concettuali.

## 5. Requisiti funzionali

- REQ-001: Il sistema deve integrarsi con Zotero per importare metadati, citation key, abstract, autori, tag, collezioni, PDF e annotazioni/evidenziazioni in note Markdown con pochi passaggi.
- REQ-002: L’editor deve supportare formule matematiche LaTeX inline e display con rendering affidabile, anteprima corretta e conservazione della sintassi nel file Markdown.
- REQ-003: Il sistema deve fornire backlinks, note concettuali e graph view per visualizzare relazioni tra paper, temi, metodi, risultati e sezioni del manoscritto.
- REQ-004: Il sistema deve esportare il vault o singole note in LaTeX, BibTeX, DOCX e PDF preservando citazioni, formule, struttura dei capitoli e riferimenti bibliografici.
- REQ-005: Il sistema deve supportare collaborazione asincrona tramite export/import leggibili, shared vault via Git o cloud scelto dall’utente, e generazione di bozze commentabili per co-autori che usano Word o Google Docs.

## 6. Requisiti non funzionali

### Performance
- Gestione fluida di 1.200+ paper e migliaia di note.
- Ricerca rapida tra note, autori, tag, citation key e concetti.
- Grafo reattivo anche con molte relazioni.
- Import batch da Zotero senza blocchi prolungati.
- Rendering veloce di note lunghe con formule e citazioni.

### Sicurezza
- Vault locale come fonte primaria.
- Sync cifrata se usa servizi cloud.
- Nessun accesso non autorizzato a manoscritti non pubblicati.
- Plugin e integrazioni con permessi espliciti.
- Backup versionato, preferibilmente via Git o storage affidabile.

### Privacy e compliance
- Nessuna telemetria obbligatoria.
- Contenuti di ricerca non inviati a servizi esterni senza consenso.
- Rispetto GDPR e policy di ricerca.
- Gestione prudente di dati sensibili o collaborazioni riservate.
- Licenze open source chiare.

### Disponibilità
- Offline-first.
- Sync tra MacBook e iPad.
- Possibilità di lavorare su iPad senza rete.
- Recupero note dopo crash o chiusura accidentale.
- Indice ricostruibile senza perdita del vault.

### Dispositivi e piattaforme
- Priorità: MacBook Pro macOS.
- Secondario: iPad con Apple Pencil.
- Terziario: Linux e Windows per co-autori o utenti accademici.
- Supporto a tastiera, trackpad e input penna.
- Interfaccia leggibile per sessioni lunghe di scrittura.

### Accessibilità
- Supporto screen reader.
- Navigazione da tastiera.
- Contrasto elevato.
- Zoom testo e formule.
- Scorciatoie configurabili.
- Visualizzazione chiara di formule, citazioni e link.

### Usabilità
- Workflow accademico guidato ma flessibile.
- Template chiari per paper, concetti e sezioni review.
- Command palette per utenti mediamente tecnici.
- Gestione citazioni comprensibile.
- Errori di export LaTeX spiegati in modo utile.
- Possibilità di usare Markdown senza essere esperti.

### Scalabilità
- Supporto a 5.000+ paper in futuro.
- Grafo con migliaia di nodi e relazioni.
- Vault con allegati PDF e immagini.
- Indice ricerca robusto.
- Plugin system stabile per integrazioni accademiche.

## 7. Dati e integrazioni

### Dati principali
- Note paper.
- Metadata bibliografici: autori, anno, titolo, rivista, DOI, citation key.
- Abstract.
- Highlight e annotazioni PDF.
- Note critiche.
- Tag e collezioni Zotero.
- Note concettuali, ad esempio `[[Default_Mode_Network]]`.
- Sezioni del manoscritto.
- Formule LaTeX.
- Bibliografia.
- Figure e tabelle.
- Configurazione export.

### Origine dei dati
- Zotero.
- PDF scientifici.
- Inserimento manuale.
- Annotazioni su iPad.
- Bozze Markdown.
- Co-autori tramite DOCX o commenti.
- Eventuali database bibliografici esterni.

### Sistemi esterni
- Zotero.
- Better BibTeX.
- Pandoc.
- Distribuzione LaTeX.
- Git.
- Cloud storage per sync, ad esempio iCloud, Dropbox, Nextcloud, WebDAV.
- Google Docs o Word per collaborazione asincrona.
- DOI/CrossRef per metadata, se utile.
- Hypothesis o altri tool di annotazione, opzionali.

### API o servizi da integrare
- Zotero API o integrazione locale Better BibTeX.
- Motore MathJax o KaTeX.
- Pandoc per export.
- Git per versioning e collaborazione tecnica.
- API cloud storage per sync.
- Eventuale API DOI/CrossRef.
- Eventuale motore grafo locale.

### Vincoli tecnici
- Note in Markdown plain text.
- Citation key stabili e leggibili.
- YAML frontmatter per metadata bibliografici.
- Compatibilità con BibTeX/BibLaTeX.
- Formule LaTeX conservate nel testo.
- Export LaTeX compilabile.
- PDF e allegati gestiti come file, non come database chiuso.

### Dipendenze
- Zotero installato o accessibile.
- Better BibTeX o equivalente.
- Pandoc.
- LaTeX distribution per PDF.
- Motore rendering matematico.
- Motore ricerca locale.
- Componente grafo.
- Sistema sync.

## 8. Vincoli e ipotesi

### Vincoli di business
- Fub deve essere open source.
- Deve essere utile per utenti accademici senza lock-in proprietario.
- Deve supportare formati aperti e esportabili.
- Non deve obbligare co-autori a usare Fub.
- Deve rispettare la libertà di usare Zotero e strumenti esistenti.

### Vincoli tecnici
- Priorità macOS e iPad.
- Integrazione Zotero essenziale.
- Export LaTeX e BibTeX devono essere affidabili.
- Markdown deve restare source of truth.
- Sync semplice ma robusta.
- Plugin accademici devono essere mantenibili.

### Vincoli temporali
- Elena sta scrivendo una review con scadenza editoriale.
- Funzioni Zotero e export LaTeX utili entro pochi mesi.
- MVP accademico entro 3-4 mesi.
- Collaboration asincrona entro 6 mesi.
- Annotazione PDF nativa in fase successiva.

### Vincoli legali o compliance
- Rispetto copyright dei paper.
- Gestione corretta di manoscritti non pubblicati.
- Licenze open source compatibili.
- Privacy per collaborazioni e dati di ricerca.
- Eventuali policy istituzionali su dati e pubblicazioni.

### Ipotesi attuali
- Elena usa Zotero con Better BibTeX o può usarlo.
- I co-autori preferiscono Google Docs o Word.
- È accettabile collaborazione asincrona.
- Markdown è adatto come formato intermedio.
- Export LaTeX è un requisito critico.
- Il vault è personale ma condivisibile in parti selezionate.
- iPad è usato soprattutto per lettura e annotazione.

### Regole di business
- La citation key deve essere stabile e riferibile.
- Le note restano plain text.
- I PDF possono essere allegati ma non modificati distruttivamente.
- L’export deve preservare citazioni e formule.
- Il grafo è derivato dai link e metadata.
- I conflitti di sync non devono perdere versioni del manoscritto.
- I co-autori devono poter commentare senza usare Markdown se necessario.

## 9. Priorità

### Must have
- Integrazione Zotero.
- Import metadata e citation key.
- Rendering formule LaTeX.
- Backlinks e graph view.
- Export LaTeX e BibTeX.
- Export DOCX.
- Template paper note.
- Ricerca avanzata.
- Sync macOS-iPad.
- Vault Markdown open source.

### Should have
- Import annotazioni PDF da Zotero.
- Template review section.
- Vista sezioni manoscritto.
- Gestione figure e tabelle.
- Esportazione PDF.
- Commenti esportabili.
- Track changes leggero.
- Filtri grafo per autore, anno, tema.
- Query avanzate su note paper.
- Supporto Apple Pencil più profondo.

### Could have
- Annotazione PDF nativa.
- Ricerca semantica.
- Integrazione Hypothesis.
- Dashboard avanzamento review.
- Handwriting recognition.
- Esportazione journal-specific.
- Co-author portal read-only.
- AI assist per riassunti, solo opzionale.
- Import da Mendeley o EndNote.
- Visual timeline della letteratura.

### Won't have in questa release
- Collaborazione real-time completa.
- Reference manager nativo completo.
- Submission a riviste.
- Peer review workflow.
- Analisi neuroimaging.
- Gestione dataset sperimentali grezzi.
- Cloud proprietario obbligatorio.
- Editor LaTeX IDE completo.
- Automazioni complesse senza controllo utente.
- AI obbligatoria.

## 10. Criteri di successo

### Successo del progetto
- Elena importa un nuovo paper e le sue evidenze in pochi minuti.
- Collega il paper a `[[Default_Mode_Network]]` e alla sezione pertinente della review.
- Scrive il draft nel vault con citazioni corrette.
- Esporta in LaTeX senza dover correggere manualmente formule o bibliografia.
- Condivide una bozza leggibile con co-autori su Word/Google Docs.
- Usa il vault come mappa mentale affidabile della letteratura.

### Criteri di accettazione generali
- Un item Zotero può essere importato come nota Markdown con metadata completi.
- Citation key e BibTeX restano coerenti.
- Formule LaTeX inline e display renderizzano correttamente.
- Il grafo mostra relazioni tra paper e concetti.
- L’export LaTeX compila senza errori legati a citazioni o formule.
- L’export DOCX è leggibile da co-autori non tecnici.
- La ricerca trova paper, note e concetti rapidamente.
- Il vault sincronizza tra MacBook e iPad senza perdita dati.
- Le annotazioni PDF importate sono attribuite al paper corretto.

### Metriche di valutazione
- Tempo import paper da Zotero: target < 60 secondi.
- Passaggi manuali per import: target < 3.
- Errori di rendering formule: target 0 su formule standard.
- Export LaTeX compilabile: target > 95% al primo tentativo.
- Tempo per trovare note su un concetto: target < 10 secondi.
- Grafo reattivo con 1.200 paper: target senza lag evidente.
- Sync success rate: target > 99%.
- Crash-free session: target > 99%.
- Numero di co-autori che riescono a commentare export DOCX senza aiuto: target alto.
- Percentuale di note paper con citation key valida: target > 98%.

## 11. Rischi e domande aperte

### Rischi principali
- Integrazione Zotero complessa e fragile.
- Cambiamenti in Zotero, Better BibTeX o API.
- Export LaTeX non robusto con formule, citazioni o tabelle.
- Grafo poco performante con molti paper.
- Collaborazione con co-autori non Markdown troppo macchinosa.
- Sync iPad-macOS con allegati PDF pesanti.
- Annotazioni PDF non allineate alle note.
- Curva di apprendimento per utenti accademici non tecnici.
- Aspettative elevate su compatibilità con Obsidian plugin.
- Gestione di bozze multiple e versioni concorrenti.

### Domande aperte
- Meglio integrare Zotero via API locale, Better BibTeX o entrambi?
- Quale formato citation usare di default: BibTeX, BibLaTeX, CSL-JSON?
- Come gestire stili citazionali diversi per journal?
- L’export DOCX deve supportare track changes nativi?
- Come sincronizzare PDF e annotazioni senza appesantire il vault?
- Il grafo deve essere esplorativo o anche editoriale?
- Serve un modulo commenti interno o basta export/commento esterno?
- Come gestire note riservate prima della pubblicazione?
- Quale livello di compatibilità mantenere con plugin Obsidian esistenti?
- Apple Pencil deve produrre testo ricercabile o solo annotazioni visive?

### Informazioni mancanti
- Workflow esatto Zotero → Obsidian attuale.
- Tipo di formule LaTeX più usate.
- Journal target e requisiti di export.
- Modalità di collaborazione preferita dai co-autori.
- Dimensione media PDF e numero allegati.
- Uso reale di iPad: lettura, scrittura, annotazione, disegno.
- Necessità di versioning formale del manoscritto.
- Eventuali vincoli istituzionali su dati e pubblicazione.

### Decisioni da prendere
- Metodo di integrazione Zotero.
- Stack export: Pandoc, LaTeX, CSL.
- Motore rendering matematico.
- Modello dati per paper, concetti e sezioni.
- Strategia collaborazione asincrona.
- Sync predefinita su macOS/iPad.
- Gestione PDF e annotazioni.
- Licenza open source.
- Compatibilità con ecosistema Obsidian.
- Priorità tra graph view, export e annotazione PDF.

## 12. Note grezze

- Elena dice: “Il mio vault è la mia mappa mentale della letteratura degli ultimi 5 anni.”
- Ha 1.200+ paper scientifici.
- Sta scrivendo una review article per rivista Q1.
- Usa Zotero come reference manager principale.
- Ogni paper ha abstract, highlights e riflessioni critiche.
- Collega paper a temi come `[[Default_Mode_Network]]`.
- Scenario: legge un paper su fMRI e memoria di lavoro, evidenzia passaggi chiave nel PDF, li importa in Obsidian con Zotero Integration e li collega alla nota `[[Default_Mode_Network]]` per costruire il paragrafo 3.2 della review.
- Il dolore principale è il passaggio manuale Zotero → note → manoscritto.
- Le formule LaTeX devono renderizzare correttamente.
- La collaborazione con co-autori su Google Docs è un punto critico.
- Fub deve essere open source ma con workflow accademico fluido, non solo un editor Markdown tecnico.
