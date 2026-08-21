# 6 User Personas per un Editor Markdown tipo Obsidian

---

## 1. 🎓 Marta — La Studentessa Universitaria

| Campo | Dettaglio |
|---|---|
| **Età** | 22 anni |
| **Professione** | Studentessa di Medicina, 4° anno |
| **Città** | Bologna |
| **Livello tecnico** | Medio-basso |
| **Dispositivi** | Laptop Windows, tablet Android |

**Bio:** Marta segue 6-7 corsi contemporaneamente e deve memorizzare una mole enorme di informazioni. Ha provato Notion e OneNote, ma li trova troppo lenti e dispersivi. Un compagno di corso le ha consigliato Obsidian e ora sta cercando di costruire il suo "secondo cervello" per gli esami.

**Obiettivi:**
- Collegare concetti tra materie diverse (es. anatomia ↔ fisiologia) tramite link bidirezionali
- Ripassare in modo efficiente usando le flashcard (plugin Spaced Repetition)
- Avere appunti accessibili offline durante il tirocinio in ospedale

**Frustrazioni:**
- La curva di apprendimento iniziale dei plugin la spaventa
- Perde tempo a formattare invece di studiare
- Non sa come organizzare le cartelle: per materia? Per semestre? Per argomento?

**Scenario tipico:** La sera prima di un esame di Patologia, apre il suo vault, naviga il grafo delle conoscenze per ripassare i collegamenti tra sintomi e diagnosi, e ripete le flashcard generate automaticamente dai suoi appunti.

> *"Non voglio un'app bella, voglio un'app che mi faccia prendere 30."*

---

## 2. ✍️ Lorenzo — Lo Scrittore di Narrativa

| Campo | Dettaglio |
|---|---|
| **Età** | 38 anni |
| **Professione** | Scrittore freelance e copywriter |
| **Città** | Torino |
| **Livello tecnico** | Medio |
| **Dispositivi** | MacBook Air, iPhone |

**Bio:** Lorenzo sta scrivendo il suo secondo romanzo, un thriller storico ambientato su tre linee temporali. Ha bisogno di tenere traccia di decine di personaggi, luoghi, eventi storici e sottotrame intrecciate. Scrive in Markdown perché vuole separare il contenuto dalla formattazione e mantenere il controllo sui suoi file.

**Obiettivi:**
- Gestire la "bibbia" del romanzo: schede personaggio, timeline, worldbuilding
- Scrivere in modalità distraction-free per sessioni di 2-3 ore
- Esportare il manoscritto finale in formato editoriale (DOCX/PDF) senza impazzire

**Frustrazioni:**
- Gli editor WYSIWYG tradizionali "rompono" la formattazione quando copia-incolla
- Scrivener lo trova troppo complesso e costoso per le sue esigenze
- Ha paura di perdere il lavoro se il cloud non sincronizza bene

**Scenario tipico:** La mattina presto, al bar, apre il vault del romanzo sul MacBook. Scrive un nuovo capitolo in modalità Focus, poi clicca su `[[Elena_Vivaldi]]` per verificare che il colore degli occhi del personaggio sia coerente con il capitolo 12.

> *"I miei file sono miei. Se domani l'app chiude, io ho ancora tutto in cartelle di testo."*

---

## 3. 💻 Priya — La Software Engineer

| Campo | Dettaglio |
|---|---|
| **Età** | 29 anni |
| **Professione** | Backend Developer (Go/Rust) |
| **Città** | Milano (lavoro remoto per una startup di Berlino) |
| **Livello tecnico** | Molto alto |
| **Dispositivi** | Linux (Arch), telefono Pixel |

**Bio:** Priya documenta tutto: decisioni architetturali, snippet di codice, runbook di incidenti, learning log. Usa Obsidian come knowledge base personale e come strumento di onboarding per i nuovi colleghi del team. Ha personalizzato il vault con CSS snippets e plugin community.

**Obiettivi:**
- Integrare il vault con il suo workflow da terminale (Git sync, CLI tools)
- Usare blocchi di codice con syntax highlighting per 10+ linguaggi
- Cercare istantaneamente tra migliaia di note tecniche con query avanzate (Dataview)

**Frustrazioni:**
- La sync ufficiale è a pagamento e lei preferisce soluzioni self-hosted (Syncthing/Git)
- Alcuni plugin si rompono dopo gli aggiornamenti dell'app
- Vorrebbe un supporto migliore per i diagrammi Mermaid e le tabelle complesse

**Scenario tipico:** Durante un incidente di produzione alle 23:00, cerca nel vault `tag:#incident tag:#kafka`, trova il runbook che aveva scritto 8 mesi prima per un problema identico, e risolve in 10 minuti.

> *"Se non è in plain text, non esiste."*

---

## 4. 📊 Davide — Il Project Manager / Knowledge Worker

| Campo | Dettaglio |
|---|---|
| **Età** | 45 anni |
| **Professione** | Head of Operations in una PMI manifatturiera |
| **Città** | Bergamo |
| **Livello tecnico** | Basso |
| **Dispositivi** | PC Windows aziendale, iPad |

**Bio:** Davide gestisce un team di 20 persone e partecipa a 8-10 riunioni a settimana. Prende appunti freneticamente durante le call e poi non li rilegge mai più. Ha sentito parlare del metodo Zettelkasten in un podcast sulla produttività e vuole provare a essere più organizzato.

**Obiettivi:**
- Catturare rapidamente le action item durante le riunioni
- Collegare le note delle riunioni ai progetti e alle persone coinvolte
- Ritrovare "quella cosa che aveva detto Marco a marzo" in 10 secondi

**Frustrazioni:**
- Non capisce la differenza tra tag, link e cartelle
- La sintassi Markdown gli sembra "da programmatori"
- Ha bisogno di qualcosa che funzioni subito, senza configurare nulla

**Scenario tipico:** Durante la riunione del lunedì, apre una nota template `Meeting_YYYY-MM-DD`, scrive le decisioni chiave, tagga `[[Progetto_Rinnovo_Linee]]` e assegna i task con delle checkbox. Venerdì cerca `[[Marco_Rossi]]` per ricordargli la scadenza concordata.

> *"Ho provato 15 app di note. Voglio solo che funzioni e che sia veloce."*

---

## 5. 🔬 Dott.ssa Elena — La Ricercatrice Accademica

| Campo | Dettaglio |
|---|---|
| **Età** | 34 anni |
| **Professione** | Ricercatrice post-doc in Neuroscienze Cognitive |
| **Città** | Padova |
| **Livello tecnico** | Medio-alto |
| **Dispositivi** | MacBook Pro, iPad con Apple Pencil |

**Bio:** Elena ha un database di 1.200+ paper scientifici e sta scrivendo una review article per una rivista Q1. Usa Obsidian insieme a Zotero per gestire la letteratura scientifica. Ogni paper ha una nota con abstract, highlights e le sue riflessioni critiche collegate ai temi della review.

**Obiettivi:**
- Integrare le citazioni Zotero direttamente nelle note Markdown
- Creare mappe concettuali visive della letteratura (grafo)
- Scrivere il draft della review direttamente nel vault ed esportare in LaTeX

**Frustrazioni:**
- Il flusso Zotero → Obsidian richiede troppi passaggi manuali
- Le formule matematiche in LaTeX a volte non renderizzano correttamente
- Collaborare con i co-autori è impossibile perché loro usano Google Docs

**Scenario tipico:** Mentre legge un nuovo paper su fMRI e memoria di lavoro, evidenzia i passaggi chiave nel PDF, li importa in Obsidian con il plugin Zotero Integration, e li collega alla nota `[[Default_Mode_Network]]` dove sta costruendo l'argomentazione del paragrafo 3.2 della review.

> *"Il mio vault è la mia mappa mentale della letteratura degli ultimi 5 anni."*

---

## 6. 🌱 Giulia — L'Appassionata di PKM e Produttività Personale

| Campo | Dettaglio |
|---|---|
| **Età** | 27 anni |
| **Professione** | UX Designer in un'agenzia digitale |
| **Città** | Roma |
| **Livello tecnico** | Medio |
| **Dispositivi** | MacBook Pro, iPhone, Kindle |

**Bio:** Giulia è una "PKM nerd": ha letto *Building a Second Brain* di Tiago Forte, segue 5 canali YouTube su Obsidian e ha un vault con 3.000+ note che include journaling, habit tracker, ricette, liste di libri, riflessioni sui podcast e note di design. Il suo vault è il suo sistema operativo personale.

**Obiettivi:**
- Avere un unico sistema che sostituisca Notion, Todoist, Day One e Readwise
- Automatizzare il flusso di cattura: Kindle highlights → Readwise → Obsidian
- Personalizzare l'estetica del vault con temi, icone e dashboard (plugin Dataview + Templater)

**Frustrazioni:**
- Passa più tempo a configurare il sistema che a usarlo ("productivity porn")
- La sincronizzazione tra iPhone e Mac a volte crea conflitti di file
- Il vault sta diventando così grande che non sa più cosa c'è dentro

**Scenario tipico:** La domenica mattina, apre la sua dashboard settimanale generata con Dataview: vede i libri finiti, le abitudini completate, le note create nella settimana e un prompt di journaling. Poi importa gli highlights del libro che ha letto sul Kindle e li collega alla sua nota `[[Design_System]]`.

> *"Il mio vault è un giardino digitale. Devo potarlo ogni tanto, altrimenti diventa una giungla."*

---

## Riepilogo Comparativo

| Persona | Caso d'uso principale | Priorità #1 | Plugin chiave |
|---|---|---|---|
| **Marta** 🎓 | Studio & ripasso | Velocità di cattura | Spaced Repetition, Excalidraw |
| **Lorenzo** ✍️ | Scrittura creativa | Distraction-free + organizzazione | Longform, Pandoc, Kanban |
| **Priya** 💻 | Documentazione tecnica | Ricerca + integrazione dev | Dataview, Git, Templater |
| **Davide** 📊 | Gestione riunioni & task | Semplicità assoluta | Tasks, Calendar, QuickAdd |
| **Elena** 🔬 | Ricerca accademica | Citazioni + LaTeX | Zotero Integration, Pandoc |
| **Giulia** 🌱 | PKM & life management | Personalizzazione totale | Dataview, Templater, Readwise |
