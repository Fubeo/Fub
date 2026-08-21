# Appendice — Funzionalità future (post-M5)

Torna a [../PIANO.md](../PIANO.md) · fonti: [../personas/personas.md](../personas/personas.md) e
le sei interviste: [1 Marta, studio](../personas/interview_1.md) ·
[2 Lorenzo, scrittura](../personas/interview_2.md) ·
[3 Priya, tecnica](../personas/interview_3.md) ·
[4 Davide, manageriale](../personas/interview_4.md) ·
[5 Elena, accademica](../personas/interview_5.md) ·
[6 Giulia, PKM](../personas/interview_6.md).

## Metodo (come leggere questo documento)

Le personas e le interviste sono **una fonte di idee, non una votazione**. Il
criterio non è "quanti la chiedono" ma "è interessante? sta bene in Fub?":
la decisione finale è del maintainer (Fabio), che può promuovere una feature
chiesta da una sola persona o ignorarne una chiesta da tutte. Ogni voce qui ha
un **verdetto** (`da decidere` finché Fabio non si esprime); questo documento è
il posto dove i verdetti si accumulano, non un backlog impegnativo.

Nulla di ciò che segue tocca M2–M5: sono funzionalità che presuppongono il
confine plugin finito (M5) o piattaforme nuove. Se una voce diventa "si fa",
guadagna un documento di design suo (come [ai-autocomplete.md](ai-autocomplete.md)).

## Il principio non negoziabile: spegnibilità totale

**Ogni funzionalità oltre il core deve essere disattivabile; disattivata, deve
sparire come se non esistesse.** Non "nascosta": *inesistente* — niente comandi
nella palette, niente pannelli, niente scorciatoie, niente voci nei menu,
niente sezioni nei settings, niente decorazioni nell'editor.

L'architettura lo rende quasi gratis, ed è un motivo in più per costruire le
feature come plugin core:

- una feature = un plugin (`Plugin` + provider dei trait). **Spegnere = non
  registrare i provider**: se il `CommandProvider` non è nel registry i comandi
  non esistono, se il `ViewProvider` non c'è il pannello non c'è, se
  l'`EventHandler` non c'è la feature non reagisce a nulla. Non è un `if` nella
  UI: è assenza dal sistema.
- i **dati** di una feature spenta non inquinano: o sono `.md` puri nel vault
  (leggibili comunque, è il patto di Fub) o vivono in
  `.fub/data/plugins/<id>/` e semplicemente non vengono letti. Riattivare
  ripristina tutto; disattivare non cancella mai nulla.
- **unica eccezione ammessa**: la pagina "Funzionalità" dei settings, dove le
  feature spente compaiono col loro interruttore — altrimenti non si potrebbero
  riaccendere. È l'unico posto in tutta l'app dove una feature spenta ha il
  permesso di esistere.
- le feature "opinionate" (flashcard, AI, statistiche…) nascono **spente** o si
  presentano una sola volta; un "no" è definitivo finché non è l'utente a
  cercarle nei settings.

Checklist di accettazione per ogni feature futura: *spenta, un utente che non
la conosce può accorgersi che esiste?* Se sì, non è pronta.

Le interviste validano il principio senza saperlo: Giulia chiede una "safe
mode" senza plugin/temi e pretende che automazioni e personalizzazioni siano
"visibili, annullabili e disattivabili"; Marta esclude l'AI dal suo scope;
Davide non deve mai vedere ciò che è "da programmatori". La spegnibilità
totale è la risposta unica a tutte e tre: Fub può avere flashcard, AI,
dashboard e CLI *e allo stesso tempo* essere l'app minimale che ognuno di loro
vuole — perché ciò che è spento non esiste.

## Le funzionalità

Legenda fonti: 🎓 Marta · ✍️ Lorenzo · 💻 Priya · 📊 Davide · 🔬 Elena · 🌱 Giulia.

### Piattaforme

| Feature | Fonte | Note di design | Verdetto |
|---|---|---|---|
| **App companion Android** | 🎓 💻 | Il caso d'uso reale non è "Obsidian su telefono": è **consultare** (Marta in ospedale senza rete, Priya sul Pixel) — lettura, ricerca, backlink, cattura rapida, ripasso flashcard. Un companion read-mostly è un ordine di grandezza più semplice di un editor completo e copre l'80% del bisogno. Il kernel Rust è riusabile (il core non dipende da Tauri: l'invariante paga qui); UI da decidere (Tauri mobile è giovane). Offline-first obbligatorio. | da decidere |
| **App companion iOS/iPadOS** | ✍️ 🔬 📊 🌱 | Lorenzo esplicito: *"non devo scrivere capitoli; rileggere, annotare, controllare un dettaglio"*; Elena legge e annota su iPad; Davide consulta; Giulia cattura al volo (+ widget iOS). Il pattern è unanime: **consultazione + cattura rapida**, non editing completo. | da decidere |
| **CLI di prima classe** | 💻 | `fub new/search/open/sync` senza aprire la GUI. Il kernel è già una libreria headless: la CLI è un binario sottile su `fub-kernel`, e le query passano da `IndexProvider` come per la UI. Per Priya "non è un accessorio". | da decidere |
| **Protocollo URI / integrazione editor esterni** | 💻 | `fub://open?note=…` da browser/terminale; il vault resta modificabile da Vim/VS Code (già vero: il watcher riconcilia). | da decidere |

### Semplicità (la sfida di Davide)

L'intervista 4 introduce il tema più scomodo: un utente per cui *"la sintassi
Markdown è da programmatori"* e che ragiona per "persone, progetti, riunioni,
attività" — mai per "tag, frontmatter, repository". C'è una **tensione
dichiarata** con l'anti-goal WYSIWYG di Lorenzo e Priya; la risoluzione è che
il Markdown resta l'unico formato sorgente e la semplicità è un **layer di
presentazione**, mai un formato: se la si fa, è una modalità, non un fork
dell'editor.

| Feature | Fonte | Note di design | Verdetto |
|---|---|---|---|
| **Modalità semplice (Markdown assistito)** | 📊 | Toolbar per grassetti/elenchi/checkbox/link, sintassi nascosta, terminologia non tecnica. Sotto resta `.md` puro (esportabile, apribile ovunque: il patto non si tocca). Nota onesta: è la live-preview di M3 spinta fino in fondo più che una feature nuova — le decorazioni sugli `Span` sono già metà del lavoro. La "modalità" è essa stessa soggetta a spegnibilità (chi non la vuole non la vede). | da decidere |
| **Entità guidate: persone / progetti / riunioni** | 📊 | "Collega a Marco" senza sapere cosa sia un wikilink. Architettonicamente è zucchero su ciò che esiste: entità = note (`Persone/Marco Rossi.md`), collegamento = wikilink con autocomplete (c'è già), "vista persona/progetto" = pannello backlink filtrato. Un plugin core di convenzioni + template + viste, non un modello dati nuovo. | da decidere |
| **Vista attività (checkbox aggregate, proprietario, scadenza)** | 📊 | "Tutte le checkbox aperte di `[[Progetto X]]`, di chi sono, per quando": query sull'indice (`IndexQuery::Custom`) + una sintassi leggera nelle note (es. `- [ ] cosa @marco 2026-08-01`) che resta testo leggibile. I promemoria (notifiche OS) sono il pezzo platform-specific. | da decidere |
| **Integrazione calendario** | 📊 | Outlook/Google → nota riunione precompilata (titolo, ora, partecipanti). Comodissima ma è la prima feature dell'elenco che parla con un servizio esterno aziendale: permesso `network`, e da valutare per ultima. | da decidere |
| **Condivisione read-only di una nota** | 📊 | Export HTML/PDF di cortesia più che sharing infrastructure; niente server Fub. | da decidere |
| **Dettatura / scrittura a mano (tablet)** | 📊 🔬 | Input vocale e Apple Pencil. Dipende dal companion tablet; la penna che produce testo ricercabile è una domanda aperta di Elena. Lontano. | da decidere |

### Sync (il tema più trasversale)

Chiesto da tutti in forme diverse; il comune denominatore: **niente cloud
proprietario, niente account, i conflitti mai silenziosi** (coerente con la
politica buffer↔disco già decisa in [data-model.md](../architecture/data-model.md)).

| Feature | Fonte | Note di design | Verdetto |
|---|---|---|---|
| **Sync Git integrata** | 💻 | Commit/pull/push da GUI e CLI, conflitti visibili e risolvibili. Per Priya è il caso primario; è anche versioning gratuito. Il vault è già una cartella qualsiasi: serve solo l'orchestrazione (candidato naturale a **job**: fetch/push sono lavoro lungo). | da decidere |
| **Sync zero-config P2P/Syncthing** | 🎓 | Il sogno di Marta: "inquadro un QR dal laptop e via". Syncthing integrato o guidato; la fascia non tecnica non configura nulla. | da decidere |
| **Trasporto "cartella cloud" (iCloud/OneDrive/Drive)** | ✍️ 📊 | Non un backend: solo tolleranza ai trasporti file-based (lock, file sdoppiati, latenza) + una procedura *guidata* ("usa la cartella OneDrive che hai già") per chi non configura nulla. In parte è robustezza del watcher più che una feature. | da decidere |
| **Conflitti leggibili** | 🌱 📊 🎓 | Trasversale a ogni sync: mai perdita silenziosa (già legge del progetto), copie di conflitto *leggibili* e recuperabili, domanda semplice ("quale tieni?") per i non tecnici. È l'estensione naturale della politica buffer↔disco di [data-model.md](../architecture/data-model.md). | da decidere |
| **Cifratura opzionale del vault** | ✍️ 💻 | Mai obbligatoria (i file devono restare apribili con Blocco Note — Marta). | da decidere |

### Studio e ripasso

| Feature | Fonte | Note di design | Verdetto |
|---|---|---|---|
| **Flashcard + spaced repetition** | 🎓 🌱 | Sintassi nella nota (`Q:: / A::` o simile: il sorgente resta `.md` puro), scheduler SM-2, "Ripasso oggi" proattivo. Mappa pulita sui trait: parsing via SDK, stato SR in storage per-plugin, pannello via `ViewProvider`, ripasso via `CommandProvider`. **Il caso di scuola della spegnibilità**: chi non studia non deve mai sapere che esiste (Giulia la vorrebbe "leggera": stessa feature, profilo diverso). Import Anki (.apkg) come estensione. | da decidere |
| **Modalità "esame" / focus su una materia** | 🎓 | Filtra grafo, ricerca e file-list su un sottoinsieme (cartella/tag). Più una *vista* che una feature: potrebbe ricadere nei filtri del grafo di M2 — che servono comunque anche a Elena (per autore/anno/tema) e a Marta (colori per materia). | da decidere |
| **Widget Android flashcard** | 🎓 | Ha senso solo dopo companion Android + flashcard. | da decidere |

### Scrittura

| Feature | Fonte | Note di design | Verdetto |
|---|---|---|---|
| **Modalità Focus / typewriter** | ✍️ | Nasconde tutto tranne il testo; paragrafo attivo centrato. Tocca solo frontend/editor, zero contratto: potrebbe perfino anticipare (M3-adiacente). | da decidere |
| **Export editoriale DOCX/PDF** | ✍️ 🎓 🔬 | Il requisito vero di Lorenzo è preciso: manoscritto standard agenzie (pagina titolo, capitoli H1, Times 12, interlinea 1.5, margini 2.5). Export = `serialize`/render è già "generazione" nel contratto; la produzione del file è lavoro lungo → **job**. Preset pochi e fatti bene, non 200 opzioni. | da decidere |
| **Statistiche di scrittura** | ✍️ 🌱 | Parole/giorno, streak, conteggio per capitolo. `EventHandler` su `DocumentChanged` + storage; pannello `ViewProvider`. Spegnibile per definizione. | da decidere |
| **Vista timeline** | ✍️ | Eventi posizionati su linee temporali multiple. Come la graph view: superficie canvas privilegiata (vedi l'asterisco in [ui-protocol.md](../architecture/ui-protocol.md)) — costosa, valutare dopo feedback reale. | da decidere |

### Tecnico (Priya-land)

| Feature | Fonte | Note di design | Verdetto |
|---|---|---|---|
| **Query avanzate tipo Dataview** | 💻 🌱 | Filtri su tag/path/date/frontmatter, query salvate **come file leggibili**, dashboard. Il varco esiste già: `IndexQuery::Custom { ns, query }` — un plugin query-engine è il test perfetto del varco d'estensione. Sintassi *ispirata a* Dataview, non compatibile (domanda posta identica sia da Priya sia da Giulia; compatibilità totale = promessa che non manterremo). La dashboard settimanale di Giulia (libri, abitudini, note create, prompt journaling, < 1 s) è il caso d'uso di riferimento. | da decidere |
| **Mermaid** | 💻 | `custom_kind: "mermaid"` nel registro dei kind (stessa strada di callout/math a M3); rendering lazy nel frontend. | da decidere |
| **Tabelle complesse (sort/resize)** | 💻 | `custom_kind: "table"` è già riservato a M3; qui si parla dell'interazione ricca sopra. | da decidere |
| **Daily/weekly notes + journaling + habit** | 💻 🌱 📊 | Template + comando + vista calendario: plugin core piccolo, alto valore percepito. Per Giulia il rituale è la **review settimanale** (domenica, < 20 min): daily/weekly note, prompt di journaling, habit tracker leggero come testo nella nota (mai database nascosto). Un'eventuale "revisione guidata" è UI sopra le stesse query. | da decidere |
| **Linting/validazione note in CI** | 💻 | Più docs/ricette che feature: la CLI rende possibile `fub check` in una pipeline. | da decidere |
| **Modalità vim (keymap modale nell'editor)** | — | Nessuna intervista la chiede, e sta qui lo stesso perché è l'unica cosa che il piano non nomina **né per dire di sì né per dire di no**: fino a questa riga, in tutto il repo la parola compariva in un posto solo, la [0090](../decisions/0090-una-sequenza-e-una-modalita-che-scade.md), che la usa per scartare un esempio — `g d` è ineseguibile perché «sotto questa tastiera c'è un editor in cui `g` è testo di qualcuno». La frase è vera ed è **esattamente** la ragione per cui una modalità normale esiste: in vim `g` non è testo di nessuno finché non lo si dichiara. La libreria dell'editor la fornisce, e la shell ha già una modalità *che scade* (`Mod-k`) più la regola che `Escape` si tratta prima del registro — quindi il pezzo difficile, «uno stato in cui si sta», è l'unico che manca ed è quello che la 0090 dichiara di non volere («la shell non ha modi» resta vero al singolare). La domanda vera non era se piaccia: era **di chi è la superficie di scrittura**, e ha una risposta — la [0104](../decisions/0104-la-superficie-di-scrittura-si-presta.md): *«l'editor è della shell»* vuol dire **questo** editor, non *l'editing*, e la superficie **si presta** a un terzo. Quindi questa voce è il **primo cliente di quel prestito**, e il verdetto sceglie la massima personalizzazione per chi scrive: non una modalità che facciamo noi dentro l'editor di casa, ma un plugin che porta la propria esperienza di scrittura su `ViewSurface::Main` — chi non la vuole non la installa, e spegnerla è non averla. Non è fattibile oggi: chiede le **due porte** che la 0104 nomina come buco dichiarato (un evento di tastiera nel contratto — oggi un provider riceve `UiAction`, cioè un gesto già interpretato, e sotto una modalità modale l'interpretazione *è* il lavoro — e una via di disegno che non sia riservata a `Trust::Core`). Sono additive, e questa è la voce che le chiederà per prima: è il cliente giusto per progettarle, perché è precisamente il caso che ha bisogno di un tasto nudo. | **si fa**, da un terzo (dopo le due porte) |

### Accademico

| Feature | Fonte | Note di design | Verdetto |
|---|---|---|---|
| **Citazioni / integrazione Zotero** | 🔬 | L'intervista 5 la mette a fuoco: import via Better BibTeX o API Zotero (metadata, citation key **stabile**, abstract, tag, collezioni, annotazioni PDF), template "paper note", bibliografia BibTeX/CSL in export. Il dolore reale di Elena non è il PDF: è il flusso manuale Zotero→nota→manoscritto. Non si sostituisce Zotero: ci si integra. Import batch = **job**. | da decidere |
| **Export LaTeX + BibTeX** | 🔬 | Requisito critico di Elena ("compilabile al primo colpo > 95%"): si aggancia all'infrastruttura di export editoriale (stesso meccanismo, preset diverso), con citazioni e formule preservate. Pandoc come motore accettato per il DOCX accademico. | da decidere |
| **Collaborazione asincrona con co-autori** | 🔬 | I co-autori usano Google Docs/Word e **non installeranno Fub** (vincolo esplicito): la risposta non è real-time collab (anti-goal) ma un giro di andata e ritorno — export DOCX commentabile, eventuale track-changes leggero al rientro. Da progettare piccolo. | da decidere |
| **Import/annotazione PDF** | 🎓 🔬 | La voce più costosa dell'intero documento (rendering PDF, annotazioni, stylus). L'intervista 5 conferma la cautela: per Elena l'annotazione nativa è esplicitamente "fase successiva" — ciò che serve prima è l'**import degli highlight** (via Zotero). Valutare sempre l'alternativa umile: link a PDF esterni + highlight importati. | da decidere |

### Cattura e PKM

| Feature | Fonte | Note di design | Verdetto |
|---|---|---|---|
| **Template alla creazione + template engine** | 🎓 ✍️ 📊 🔬 🌱 | L'unica voce chiesta da *cinque* personas su sei (scheda personaggio, `Meeting_YYYY-MM-DD` con data automatica, paper note, ADR/runbook, daily note): è un `CommandProvider` + cartella di template `.md` nel vault. Piccolo, trasversale, probabilmente il primo della lista a diventare concreto. Giulia chiede l'engine tipo Templater: variabili dinamiche sì, **scripting arbitrario no** ("modalità sicura" — la sua stessa richiesta): le automazioni devono restare trasparenti e reversibili. | da decidere |
| **Cattura rapida (QuickAdd-style)** | 📊 🌱 | Scorciatoia globale desktop → nota/append senza aprire l'app; su iPhone quick capture + widget (dipende dal companion). Anche offline. | da decidere |
| **Vault hygiene** | 🌱 | La feature più distintiva dell'intervista 6: note orfane, link rotti, tag inutilizzati, note stale — la "potatura" del giardino digitale. Il kernel ha già quasi tutto (grafo = orfani e link rotti gratis; l'indice ha le date): è un `ViewProvider` + query, non infrastruttura nuova. Attenzione di design: strumento di cura, non ansia da metriche. | da decidere |
| **Import migrazione (Notion, Anki, Readwise/Kindle, Todoist, Day One)** | 🎓 🌱 🔬 | Import Obsidian è già gratis (stesso formato). Readwise/Kindle per Giulia è flusso quotidiano (API + token custodito in modo sicuro, import = **job**, note con metadata e fonte); gli altri sono one-shot di migrazione: convertitori CLI prima, UI poi. | da decidere |
| **Onboarding < 5 minuti** | 🎓 📊 | Non una feature ma un criterio: prima nota + primo link + grafo senza leggere docs, linguaggio senza gergo tecnico. Da tenere come test di accettazione quando l'app si apre a utenti non tecnici. | da decidere |

### Estetica

| Feature | Fonte | Note di design | Verdetto |
|---|---|---|---|
| **Temi (scuro/sepia), icone e CSS snippets** | ✍️ 💻 🌱 | I plugin dichiarano *intenti* semantici, il tema è del core ([ui-protocol.md](../architecture/ui-protocol.md)): i temi sono quindi centralizzati e sicuri — ed è la risposta strutturale alla frustrazione di Giulia ("l'estetica personalizzata si rompe dopo gli aggiornamenti"): un tema che tocca solo variabili del core non può rompersi come un CSS che patcha il DOM. CSS snippets utente = escape hatch fidato, solo desktop; eventuali "temi community verificati" solo con un canale curato. | da decidere |

## Conferme e anti-goal (quello che le interviste NON cambiano)

Le sei interviste **confermano** scelte già fatte più spesso di quanto ne
propongano di nuove — vale la pena dirlo:

- *"Se non è in plain text, non esiste"* (Priya), *"i miei appunti con Blocco
  Note"* (Marta), *"file di testo in cartelle"* (Lorenzo); anche Davide — il
  meno tecnico — pretende note "recuperabili anche fuori dall'app", ed Elena e
  Giulia vogliono query, dashboard e metadata **come file leggibili** →
  source-as-truth, niente formati proprietari: **è già l'invariante di Fub**.
- Plugin stabili che non si rompono a ogni release (Priya; Giulia sulla
  fragilità di Dataview/Templater/temi) → è esattamente il freeze del
  contratto + WIT di M4.
- Offline-first, zero account, zero telemetria non opt-in (tutti e sei, nessuna
  eccezione) → già così; da non rompere mai, nemmeno per il sync.
- Ricerca istantanea, grafo filtrabile, math affidabile, palette → già M2/M3
  (il rendering LaTeX "che non sbaglia" di Elena è un criterio di qualità per
  M3, non una feature nuova).
- I conflitti mai silenziosi (Priya, Giulia, Davide, Lorenzo) → è la stessa
  legge già cablata per buffer↔disco e overflow eventi: estenderla al sync
  sarà coerenza, non novità.

Anti-goal espliciti, coerenti fra tutte le interviste e con la visione del
progetto (se mai verranno riconsiderati, servirà un motivo forte):

- collaborazione real-time stile Google Docs (esclusa perfino da Elena, che i
  co-autori li ha davvero: chiede l'asincrono, vedi sopra);
- editor WYSIWYG / rich text **come formato** — la "modalità semplice" di
  Davide è ammissibile solo come presentazione sopra `.md` puro, mai come
  rich text;
- cloud proprietario obbligatorio, account, telemetria non opt-in;
- database relazionale stile Notion (escluso anche da chi da Notion arriva:
  Giulia e Davide);
- automazioni opache che modificano note senza controllo (Giulia) — corollario
  della spegnibilità: tutto visibile, annullabile, disattivabile;
- AI *obbligatoria* — quella opzionale è già progettata come plugin spegnibile
  ([ai-autocomplete.md](ai-autocomplete.md)), che è il modo in cui la richiesta
  di Marta ("niente AI, non mi fido"), i "suggerimenti opzionali" che Giulia ed
  Elena invece vorrebbero, e il piano esistente convivono: per chi la spegne,
  non esiste.

## Prossimi passi

1. Fabio passa sui verdetti (`da decidere` → `sì` / `no` / `più avanti`).
2. Ogni "sì" complesso diventa un documento di design in `appendix/` col suo
   piano di spegnibilità esplicito.
3. Le tensioni da sciogliere per prime, perché condizionano più voci: la
   "modalità semplice" (sì/no e quanto in profondità), la strategia sync (Git
   vs Syncthing vs cartella cloud guidata — o più d'una), e la strategia
   mobile (companion read-mostly sì/no e con quale stack).
