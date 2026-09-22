# Piano per il redesign grafico e UX di Fub

Piano operativo per realizzare una GUI coerente, accessibile e sicura, preservando la struttura logica e le capacità reali di Fub. Le istruzioni sono pensate per worker che non devono prendere decisioni di prodotto autonomamente.

**Stato:** proposta di implementazione, non descrizione di funzionalità già consegnate. Tutte le checkbox sono intenzionalmente non spuntate. La stesura di questo documento non equivale all'esecuzione del piano.

**Base dell'analisi:** working tree presente il 21 settembre 2026, già contenente modifiche dell'utente; codice corrente, documentazione e shell effettiva avviata attraverso il banco visuale. Non assumere che `main`, vecchi screenshot e working tree coincidano.

**Definizione di risultato:** “perfetta” significa qui nessuna regressione funzionale, nessuna perdita di lavoro, layout senza sovrapposizioni, gerarchie visive coerenti, flussi comprensibili e criteri di accettazione superati. Il gradimento estetico richiede una review umana: nessun test certifica una perfezione soggettiva.

## 1. Come usare il piano

- [ ] **G00 — Registrare il lavoro.** Prima dell'implementazione collegare questo piano a una GitHub Issue di coordinamento; registrare owner e dipendenze dei pacchetti. Non aprire automaticamente issue, PR o branch durante la sola lettura del piano.
- [ ] **G01 — Proteggere il lavoro esistente.** Inventariare branch e modifiche presenti; distinguere il proprio intervento. Non azzerare file, non cambiare branch e non rigenerare output sopra modifiche sconosciute senza riconciliazione.
- [ ] **G02 — Leggere le regole.** Leggere [CONTRIBUTING.md](CONTRIBUTING.md), [mappa documentale](docs/README.md), [confini](docs/architecture/components-and-boundaries.md) e [frontend/IPC](docs/architecture/frontend-and-ipc.md). Poi leggere soltanto l'area assegnata.
- [ ] **G03 — Seguire l'ordine.** Eseguire i pacchetti della sezione 12 rispettando le dipendenze. Un pacchetto non è concluso perché il CSS compila: deve produrre le prove elencate.
- [ ] **G04 — Non improvvisare.** In caso di conflitto fra un'istruzione grafica e sicurezza, accessibilità o compatibilità, prevale l'invariante. Registrare la discrepanza nell'issue e farla risolvere all'integratore; non introdurre eccezioni locali.
- [ ] **G05 — Dichiarare evidenze e limiti.** Ogni consegna deve distinguere comportamento osservato, lettura del codice, ipotesi e verifica ancora mancante. Non chiamare “bug confermato” un rischio non riprodotto.

Il piano resta un allegato operativo richiesto dall'utente nella radice. Non inserirlo fra le pagine canoniche che descrivono il presente. Se diventa un TODO ufficiale di progetto, applicare prima le regole di collegamento a issue e di ciclo di vita documentale.

## 2. Come funziona realmente Fub

### 2.1 Prodotto e struttura da conservare

Fub è un'app desktop local-first basata su vault di file. Non è una dashboard SaaS. Scrivere, ritrovare documenti e gestire il lavoro locale sono le attività principali; non introdurre login, homepage commerciale, collaborazione, AI, cloud o marketplace fittizi.

| Area | Funzione reale | Proprietario da preservare |
|---|---|---|
| Vault | Aprire cartelle di lavoro e accedere a file, indici e metadati | Host/kernel; shell per selezione e presentazione |
| Navigazione sinistra | Albero, ricerca, spazi, elementi appuntati e view dichiarate | `panels/explorer.ts`, `search.ts`, `sidebar.ts`, `rail.ts`, `ui/views.ts` |
| Centro | Riquadri, tab documento e tab view, split e focus | `state/layout.ts`, `panels/document.ts` |
| Documento aperto | Buffer condiviso, dirty, revisioni, autosave, bozze e riconciliazione | `state/document-session.ts` |
| Superficie | Cursore, selezione, scroll, modalità e history locale | `editors/core/`, `editors/text/`, `editors/grid/` |
| Ispettore destro | Struttura, backlink, proprietà e altre view disponibili | Discovery dei provider e renderer `ui/views.ts` / `ui/node.ts` |
| Comandi | Azioni della shell e dei provider, tasti, disponibilità e conferme | Registro comandi, palette, interfaccia host |
| Grafo | View in una tab del centro, rendering e interazione locali | `panels/graph.ts`, `graph/` |
| Impostazioni | Configurazione, componenti, scorciatoie e vault conosciuti | `panels/settings.ts`, contratti delle impostazioni |
| Stato | Salvataggio, attività, notifiche e problemi persistenti | Sessioni, `panels/activity.ts`, `ui/notify.ts` |

**Struttura logica vincolante:** barra applicativa in alto; rail di navigazione e sidebar a sinistra; documenti/view al centro; ispettore a destra; stato in basso. I dialoghi sono superfici temporanee. Non trasformare i pannelli in pagine scollegate.

### 2.2 Formati e modalità

| Superficie | Capacità corrente da mantenere | Cosa non inventare |
|---|---|---|
| Markdown | Sorgente, Live, Lettura; collegamenti, tag e resa del provider | Parser alternativo della shell o preview finta |
| Plain text | Editing testuale sullo stesso `TextEngine` | Pulsanti Markdown o modalità di lettura non dichiarate |
| `.fubsheet` | Griglia virtualizzata, formula bar, editor in-cell, TSV, undo dedicato | Clone di Excel, calcolo autorevole in TypeScript o pivot non esistenti |
| Sorgente binaria | Superficie di indisponibilità della visualizzazione | Viewer universale, download o conversione non supportati |
| Errore/nessuna superficie | Errore comprensibile e vie di uscita sicure | Pannello vuoto presentato come caricamento perpetuo |
| View del provider | Rendering del protocollo `UiNode` e azioni dichiarate | DOM, callback o privilegi aggiunti al contratto |

La modalità viene dalla superficie attiva: non assumere una terna Markdown universale. Un documento può essere visibile contemporaneamente in più riquadri con modalità diverse.

### 2.3 Quattro strumenti distinti di ricerca e comando

| Strumento | Scopo | Entry point esistente |
|---|---|---|
| Ricerca nel vault | Cercare contenuto in più documenti | `panels/search.ts` |
| Apertura rapida | Trovare un documento per nome/percorso | `panels/quick-switcher.ts` |
| Ricerca nel documento | Cercare nel documento aperto | `panels/doc-search.ts` |
| Palette | Trovare ed eseguire azioni | `ui/palette.ts` |

Conservare questa distinzione. Unificare lo stile, non mischiare risultati, scope o semantica. Le scorciatoie visibili devono provenire dai binding effettivi, non da stringhe duplicate nel markup.

### 2.4 Invarianti che nessun worker può rompere

- [ ] **I01 — Una sessione per documento.** Ogni riquadro dello stesso documento osserva il medesimo buffer e la medesima coda di salvataggio; non creare buffer indipendenti per accomodare la nuova GUI.
- [ ] **I02 — Stato locale per superficie.** Cursore, scroll, modalità e undo locale non migrano accidentalmente all'altro riquadro. Le modifiche sincronizzate non diventano battute locali.
- [ ] **I03 — Sicurezza delle scritture.** Non aggirare revisioni, preimmagini, controlli di conflitto, bozze o scritture atomiche. Mai risolvere un conflitto automaticamente perché il dialogo è scomodo.
- [ ] **I04 — Risultati asincroni validi.** Conservare cancellazione e controlli di generazione. Un risultato vecchio non può riaprire una tab chiusa, sostituire una ricerca nuova o aggiornare il vault successivo.
- [ ] **I05 — Formati e offset.** Preservare UTF-8, offset JavaScript, caratteri multibyte e CRLF. Non normalizzare il contenuto per ottenere un allineamento grafico.
- [ ] **I06 — Bridge unico.** Solo `host/ipc.ts` e `host/dialog.ts` importano Tauri. I pannelli usano l'interfaccia host e le porte generiche esistenti.
- [ ] **I07 — CodeMirror confinato.** Gli import CodeMirror restano in `editors/text/`. Non leggere strutture private della sua history.
- [ ] **I08 — Lifecycle completo.** Ogni listener, timer, observer, menu, grafico e superficie ha owner e disposer. Nessun rimontaggio lascia risorse vive.
- [ ] **I09 — Estensioni indipendenti.** La rimozione di una feature ritira la relativa view/comando senza rompere la shell. Non hardcodare l'elenco dei provider presenti nel banco.
- [ ] **I10 — Compatibilità dei temi.** Conservare ruoli e hook pubblici; eventuali aggiunte devono avere consumer, fallback e controllo di conformità. Non rinominare ruoli a piacere.
- [ ] **I11 — Persistenza senza sorprese.** Non cancellare layout, preferenze, spazi o icone dell'utente durante il redesign. Una migrazione necessaria deve essere esplicita e verificata.

## 3. Audit della versione esaminata

### 3.1 Prove effettivamente raccolte

È stata avviata la shell vera con `npm run bench -- --host 127.0.0.1 --port 4173`. Il banco sostituisce il bridge con un host in memoria; non sostituisce il DOM della shell.

Sono stati osservati: avvio con documento, finestra senza vault, ricerca, palette, impostazioni, apertura della tab grafo; temi chiaro/scuro; viewport 1440×900, 1280×800, 1024×768 e 800×500. Sono stati misurati rettangoli DOM, stato del focus e un audit axe sulla shell chiara a 800×500.

**Limiti:** non è stata certificata l'app nativa, il filesystem, il watcher, il salvataggio reale, il calcolo dei fogli o il lifecycle WASM. I testi e le risposte dei provider del banco possono essere fixture. Per esempio, l'outline della fixture non dimostra quale documento il kernel stia indicizzando. I titoli italiani dei provider in una shell inglese del banco non dimostrano da soli un bug di localizzazione del prodotto.

### 3.2 Problemi confermati e obiettivo di correzione

| ID | Evidenza | Problema | Esito richiesto |
|---|---|---|---|
| A01 | Browser, senza vault a 1280×800; `index.html` | Centro vuoto, nessuna CTA visibile per iniziare; `#open-vault` è nascosto e l'azione si scopre dal menu | Schermata iniziale con “Apri un vault…” e spiegazione breve |
| A02 | Browser, 1024×768 e 800×500 | Barra superiore sovraffollata; testo e tasti si sovrappongono o vanno a capo fuori altezza | Riduzione progressiva del chrome e modalità spostate nel contesto del riquadro |
| A03 | Browser, tastiera nelle impostazioni | Dopo Space sul checkbox `setting-editor.line_numbers`, il valore cambia ma `document.activeElement` diventa `BODY` | Mantenere identità/focus del controllo aggiornato |
| A04 | Axe WCAG 2.2 AA, shell chiara 800×500 | `target-size` nell'albero dell'ispettore: righe interattive alte 21 px con spazio insufficiente | Target almeno 24×24 CSS px; albero a 32 px nella densità normale |
| A05 | Codice `bench/catalog.ts:204`, `bench/catalog.html:126` | Il catalogo scrive `data-result`, lo stile di allarme legge `data-esito` | Un solo attributo coerente; errore di contrasto visibile anche testualmente |
| A06 | Codice `theme/serie/skin/graph.css:22–23`, ricetta | Il conteggio grafo usa `--text-muted` e `--font-sm`, non i ruoli `--muted` e `--text-sm` | Usare i ruoli reali, senza fallback che nascondano il refuso |

L'audit axe ha anche restituito casi **incomplete** per contrasto e dimensione target: non significa che siano conformi. Devono essere controllati manualmente nella matrice finale.

### 3.3 Rischi rilevati dal codice: riprodurre prima di cambiare semantica

Questi punti sono ipotesi operative fondate su percorsi reali del codice, non perdite dati dimostrate nel runtime nativo.

- [ ] **R01 — Chiusura con persistenza fallita.** In `DocumentSessionCollection.release()` vengono tentati flush e bozza prima della chiusura. Simulare il fallimento di entrambi; verificare che la UI non faccia sparire l'unica copia recuperabile. Correggere nell'owner della sessione/chiusura, non conservando una copia segreta nel DOM.
- [ ] **R02 — Ripristino versione e buffer dirty.** `reloadCurrent()` chiama `forceReload()`, che azzera dirty prima della rilettura. Tracciare tutti i chiamanti del ripristino e riprodurre modifiche concorrenti; non inserire una conferma a valle di una scrittura già distruttiva.
- [ ] **R03 — Conflitto e Lettura.** I comandi di risoluzione e lo stato di salvataggio esistono. Verificare se Lettura continua a mostrare la versione persistita quando il buffer non è salvabile; dichiarare esplicitamente quale versione è visibile.
- [ ] **R04 — Griglia e modifiche esterne.** Verificare `GridEngine.syncDoc()` con editor in-cell non confermato e undo pendente. Una riscrittura remota non deve cancellare una digitazione in corso senza spiegazione né consentire undo che resusciti dati vecchi.
- [ ] **R05 — Attività con query fallita.** In `panels/activity.ts` il percorso di errore della riconciliazione può conservare la lista precedente senza indicarne la staleness. Verificare e aggiungere uno stato esplicito se necessario.
- [ ] **R06 — Suggerimenti oltre la prima pagina.** `paletteHost.listDocuments` in `desktop-shell.ts` richiede una finestra di 200 documenti. Verificare i campi documento della palette con una nota fuori finestra; usare la ricerca/paginazione esistente, non caricare tutto il vault.
- [ ] **R07 — Sidebar e riapertura.** `syncRail()` e `clearSearch()` riportano ai file. Definire cosa ricordare per vault e verificare che un refresh non chiuda arbitrariamente una view ancora valida. Il cambio vault non deve ereditare query o selezioni del vault precedente.
- [ ] **R08 — View dopo cambio vault.** Il montaggio delle view e `synchronize()` hanno un ordine significativo. Verificare la tab grafo dopo un cambio vault e dopo unload; non eliminare una chiamata apparentemente ridondante senza una riproduzione.

**Falsi problemi da non introdurre nel backlog:** lo zoom dell'interfaccia ha un effetto nativo in `crates/fub-app/src/lib.rs` tramite `window.set_zoom`; l'assenza di un consumo CSS di `ZOOM_KEY` non lo rende una preferenza morta. `accentPalette()` deriva già i colori dalla ricetta con ricerca del contrasto: non presumere che una tinta personalizzata sia invalida senza misurarla. Z-index locali dentro un canvas non sono automaticamente un difetto.

## 4. Direzione grafica vincolante

### 4.1 Identità

La direzione è **un ambiente editoriale calmo e preciso**, non una collezione di card. Il documento deve essere il primo elemento percepito; la shell deve restare disponibile senza competere con il contenuto.

- [ ] **V01 — Conservare l'identità.** Mantenere il lime di Fub come accento, i neutri della ricetta e le famiglie Inter, Literata e JetBrains Mono già distribuite localmente. Non introdurre font remoti, pacchetti di icone esterni o un framework UI.
- [ ] **V02 — Ridurre l'accento pieno.** Usare lime per focus, indicatore attivo e azione primaria. Le righe selezionate usano una superficie tenue e un segno laterale; evitare rettangoli lime pieni su tutte le copie della stessa nota.
- [ ] **V03 — Distinguere gli stati.** Hover, selezione persistente, riquadro attivo e focus tastiera devono apparire diversi. Non usare il medesimo bordo lime per tutti e quattro.
- [ ] **V04 — Usare superfici opache.** Nessun glassmorphism, sfondo sfocato, gradiente decorativo, ombra su ogni riga o bordo su ogni paragrafo. Ombre solo per superfici flottanti; separatori discreti nei pannelli.
- [ ] **V05 — Conservare chiaro e scuro equivalenti.** Stesse misure, gerarchia e comportamento. Non progettare prima lo scuro lasciando il chiaro come inversione automatica non controllata.

### 4.2 Colori: usare la ricetta, non valori sparsi

La fonte è `apps/client/src/theme/serie/recipe.ts`. Il redesign riusa la derivazione OKLCH e i ruoli correnti. Non sostituire il sistema con una palette parallela di hex inseriti nei componenti.

| Ruolo | Uso obbligatorio nel redesign |
|---|---|
| `--doc-bg` | Carta dell'editor e della lettura; preservare il fondo scuro corrente e la carta chiara |
| `--bg`, `--bg-chrome` | Shell e regioni di navigazione, secondo la gerarchia della ricetta |
| `--bg-elev` | Menu, popover e dialoghi, con elevazione già prevista |
| `--bg-panel`, `--bg-input` | Raggruppamenti interni e campi: non sono intercambiabili |
| `--bg-hover`, `--bg-active` | Hover e selezione persistente, separati |
| `--text`, `--muted` | Testo principale e secondario; entrambi leggibili sul fondo effettivo |
| `--accent`, `--accent-soft`, `--accent-contrast` | Accento, riempimento tenue e testo su accento pieno |
| `--focus-ring*` | Unico sistema per il focus visibile |
| `--danger` e ruoli semantici esistenti | Errori e azioni distruttive, sempre accompagnati da testo/icona |

- [ ] **V06 — Contrastare i fondi reali.** Testo normale almeno 4,5:1; testo grande almeno 3:1 secondo WCAG; indicatori e confini necessari almeno 3:1. Alto contrasto: mantenere le soglie più forti già definite, 7:1 testo e 4,5:1 UI.
- [ ] **V07 — Non scurire il testo per renderlo secondario.** Gerarchia ottenuta anche con peso, posizione e spaziatura. Informazioni essenziali, placeholder necessari e messaggi di errore non diventano quasi invisibili.
- [ ] **V08 — Verificare la composizione.** Misurare testo su hover, selezione, riga attiva dell'editor, codice, tag, badge e overlay, non soltanto coppie isolate di token.
- [ ] **V09 — Limitare eventuali ritocchi.** Se serve modificare una tonalità, farlo nella ricetta, rigenerare tutte le varianti e verificare tutte le coppie. Non aggiustare un solo screenshot con override locali.

### 4.3 Tipografia

Non rinominare i token esistenti. Usare il gradino corretto nel consumer; cambiare la scala globale solo se tutti i consumer vengono verificati.

| Elemento | Specifica normale |
|---|---|
| Testo dei controlli e delle liste | Inter 14 px, interlinea 1,5, peso 400 |
| Titoli di pannello | Inter 13 px, peso 600; niente maiuscolo esteso |
| Metadati, percorsi secondari, stato | Inter 12 px; non scendere a 11 px per far entrare testo essenziale |
| Titolo di dialogo | Inter 20 px, peso 600, interlinea 1,35 |
| Testo di lettura/Live | Preferenza utente; base 16 px, interlinea 1,7, misura 70ch |
| Sorgente, codice, coordinate/formule | JetBrains Mono 14 px di base, rispettando le preferenze pertinenti |
| Titoli Markdown | Scala del profilo/preview coerente fra Live e Lettura; H1 1,8em, H2 1,45em, H3 1,2em come obiettivo visivo |

- [ ] **V10 — Conservare le preferenze.** Chi ha scelto font, corpo, misura o interlinea non perde la scelta. Non applicare la misura 70ch alla griglia, ai menu o a un blocco di codice che richiede scroll.
- [ ] **V11 — Separare UI e documento.** Cambiare font di lettura non cambia la menubar. Il font del codice rimane monospace. I titoli Markdown non usano automaticamente il colore di errore: distinguere i ruoli sintattici da quelli della shell.
- [ ] **V12 — Curare overflow e localizzazione.** Etichette italiane e inglesi, nomi lunghi, caratteri accentati e percorso completo nei tooltip. Ellissi solo quando il contenuto integrale resta raggiungibile.

### 4.4 Spazi, misure, raggi e icone

Riutilizzare la scala esistente `2, 4, 6, 8, 10, 12, 16, 24, 32, 48 px` tramite `--space-*`. Non introdurre valori casuali per correggere il singolo pannello.

| Elemento | Densità normale |
|---|---|
| Controllo standard | Altezza 32 px; padding orizzontale 12 px |
| Azione primaria di dialogo | Altezza 36 px |
| Icon button | Area cliccabile 32×32 px; icona 16 px |
| Navigazione rail | Area cliccabile 36×36 px; icona 18 px |
| Riga di albero/lista | Altezza minima 32 px; testo multilinea espande la riga |
| Header pannello | Altezza minima 40 px |
| Gap fra icona e testo | 8 px |
| Padding interno pannello | 12 px; 16 px nei contenuti del dialogo |
| Controlli / popover / dialoghi | Raggi 4 / 6 / 8 px, dai token già presenti |
| Separatore | Tratto 1 px; hit area ridimensionamento almeno 8 px, con alternativa tastiera |

- [ ] **V13 — Gestire la densità senza rompere i target.** Compatta: righe almeno 28 px; rilassata: almeno 36 px. In tutte le densità i controlli singoli mantengono un bersaglio di almeno 24×24 CSS px. Con puntatore coarse, obiettivo 44×44 px senza promettere una nuova app mobile.
- [ ] **V14 — Unificare le icone.** Usare `ui/icons.ts`, stroke e griglia esistenti. Nessun carattere Unicode scelto al posto di un'icona funzionale. Conservare emoji/icone scelte dall'utente per file e spazi come contenuto, non eliminarle.
- [ ] **V15 — Dare nomi alle azioni.** Un pulsante con icona ha nome accessibile e tooltip. Uno spazio con emoji deve essere annunciato con il nome dello spazio, non solo con il simbolo.

### 4.5 Movimento

- [ ] **V16 — Riutilizzare il sistema motion.** Durate 120/180/240 ms esistenti; nessuna nuova animazione decorativa. I cambi di documento non fanno volare o dissolvere il testo durante la digitazione.
- [ ] **V17 — Mantenere reduced motion e forced colors.** Nessun movimento necessario per capire uno stato. In modalità ridotta, focus e apertura devono restare immediati e comprensibili.
- [ ] **V18 — Correggere l'ordine degli overlay.** Usare la scala strutturale `--z-*`; evitare un tooltip con `z-index:1000` fuori gerarchia. Alla comparsa di un dialogo chiudere il tooltip del controllo sottostante, non soltanto coprirlo.

## 5. Layout definitivo della shell

### 5.1 Composizione desktop

Schema logico, non nuova architettura:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Fub · menu        Vault / Cerca nel vault…        comandi · finestra │
├─────┬────────────────┬───────────────────────────┬──────────────────┤
│Rail │ Navigazione    │ Tab del riquadro          │ Ispettore        │
│     │ Spazi          │ Percorso · modalità · …   │ Schede + titolo  │
│     │ File / Ricerca │                           │                  │
│     │ View provider  │ Documento o view          │ View contestuale │
│     │                │ Eventuali split           │                  │
├─────┴────────────────┴───────────────────────────┴──────────────────┤
│ Stato documento · stato vault                Attività · Avvisi     │
└─────────────────────────────────────────────────────────────────────┘
```

| Regione | Specifica iniziale |
|---|---|
| Titlebar | 44 px; una sola riga, mai wrapping |
| Rail | 48 px |
| Sidebar | 248 px di default; ridimensionabile 200–360 px |
| Ispettore | 280 px di default; ridimensionabile 240–400 px |
| Tab strip del riquadro | 36 px |
| Toolbar contestuale | 36 px, una riga; overflow in menu |
| Statusbar | 26 px; non cresce per contenere errori lunghi |
| Riquadro centrale | Priorità allo spazio del documento; `min-width:0` dove serve |

Le misure sono CSS px alla scala 100%. La finestra nativa parte da 1280×840 e ammette 800×500: queste dimensioni sono criteri reali, non viewport arbitrari da escludere perché scomodi.

### 5.2 Regole responsive obbligatorie

| Larghezza utile | Presentazione |
|---|---|
| Almeno 1200 px | Rail, sidebar e ispettore disponibili affiancati; rispettare le scelte di visibilità |
| 960–1199 px | Ispettore chiuso automaticamente se non entra; pulsante sempre raggiungibile per aprirlo come overlay |
| 800–959 px | Sidebar e ispettore come drawer alternativi; documento usa lo spazio liberato |
| Sotto 800 px effettivi per zoom | Stessa strategia compatta; dialoghi adattivi, nessuna sovrapposizione o contenuto essenziale tagliato |

- [ ] **L01 — Separare preferenza e adattamento.** La chiusura automatica dovuta alla larghezza non sovrascrive la preferenza desktop. Tornando largo, ripristinare il layout scelto, non uno stato casuale.
- [ ] **L02 — Gestire i drawer.** Un solo drawer laterale aperto per volta in modalità compatta; titolo, chiusura, Escape, focus gestito e sfondo non interagibile. Chiudendo, riportare il focus al controllo che lo ha aperto.
- [ ] **L03 — Non distruggere gli split.** Restringere la finestra non chiude tab né trasforma il modello persistito. Minimo visivo per riquadro 320 px in orizzontale e 180 px in verticale; se gli split non entrano, scorrimento confinato al contenitore degli split e focus portato in vista.
- [ ] **L04 — Non nascondere overflow globalmente.** Vietato risolvere una sovrapposizione con `overflow:hidden` sul body o tagliando i controlli. Tabelle/codice/split possono avere scroll locale; la shell non deve richiedere uno scroll orizzontale per raggiungere Chiudi.
- [ ] **L05 — Ridimensionare in sicurezza.** Conservare i divisori e le proporzioni del layout; aggiungere semantica `separator`, orientamento e tasti appropriati dove manca. Non creare un secondo modello di split.
- [ ] **L06 — Verificare zoom nativo.** Esercitare lo zoom attraverso l'app desktop. Uno screenshot del banco a viewport ridotto non prova il side effect Tauri.

### 5.3 Barra superiore

- [ ] **L07 — Tenere globale solo ciò che è globale.** Marchio/menu, identità del vault, trigger ricerca, palette, impostazioni e controlli finestra. Spostare Sorgente/Live/Lettura nella toolbar del riquadro; non mostrarli nella titlebar come se fossero globali.
- [ ] **L08 — Ridurre progressivamente.** Sotto 1100 px sostituire la menubar estesa con un pulsante Menu applicazione che espone le stesse azioni. Ridurre prima percorso e hint dei tasti, poi il trigger ricerca a icona etichettata. Mai comprimere i controlli finestra.
- [ ] **L09 — Rendere chiaro il vault.** Mostrare il nome breve; percorso completo nel tooltip e nel selettore vault. Non usare un percorso lungo per occupare la zona del documento o i tasti di sistema.
- [ ] **L10 — Preservare il comportamento nativo.** Drag region solo nelle zone libere, niente trascinamento intercettato da input/bottoni. Conservare ordine Darwin e comportamento Linux/Windows; non duplicare controlli nativi già montati.
- [ ] **L11 — Unificare i trigger.** “Cerca nel vault…” porta al medesimo campo e scope della ricerca laterale; palette e apertura rapida mantengono azioni e nomi distinti.

## 6. Specifiche delle schermate e dei flussi

### 6.1 Avvio senza vault e apertura

- [ ] **U01 — Creare uno stato iniziale utile.** Nel centro: titolo “Apri il tuo spazio di lavoro”, testo “Un vault è una cartella di file sul tuo dispositivo”, CTA primaria “Apri un vault…”. CTA secondaria per impostazioni. Nessun account, tutorial obbligatorio o documento dimostrativo scritto nei file dell'utente.
- [ ] **U02 — Mostrare i vault recenti se disponibili.** Nome, percorso secondario e azione Apri, usando i vault conosciuti dell'host. Se assenti, non mostrare una lista finta. Non aggiungere “Crea vault” se il flusso non esiste: selezionare una cartella resta l'operazione reale.
- [ ] **U03 — Disabilitare azioni prive di contesto.** Nuova nota, ricerca nel vault e grafo non devono sembrare funzionanti senza vault. Lasciare sempre disponibili apertura, impostazioni macchina, aiuto esistente e controlli finestra.
- [ ] **U04 — Disegnare apertura e fallimento.** Durante l'apertura indicare il vault richiesto e lo stato; evitare una seconda apertura accidentale. Su errore conservare contesto e azione Riprova/Scegli cartella. Una cancellazione del file picker non è un errore.
- [ ] **U05 — Distinguere vuoti diversi.** Nessun vault, vault vuoto, cartella vuota, nessuna tab e nessun risultato hanno testo e azione differenti. “Nessun risultato” non offre di cancellare la ricerca quando non è mai stata eseguita.

**Accettazione:** a primo avvio l'utente apre un vault senza menu o scorciatoie; a picker annullato torna allo stesso stato; un errore non lascia una falsa shell pronta.

### 6.2 Rail, spazi e albero file

- [ ] **U06 — Mantenere la rail essenziale.** Note, Cerca, Grafo e view scoperte dal registro; nessuna voce hardcoded per una feature disabilitata. Posizione e tooltip coerenti; l'attivo ha indicatore e stato accessibile.
- [ ] **U07 — Rendere leggibili gli spazi.** Mostrare il nome dello spazio attivo; le altre icone hanno tooltip/nome. Gestire l'overflow con scorrimento locale o menu, mai riducendo ogni icona sotto la hit area.
- [ ] **U08 — Separare Appuntate e albero.** Conservare entrambe le proiezioni dello stesso documento senza duplicare identità. La selezione usa accento tenue; la sezione Appuntate si vede soltanto se contiene elementi.
- [ ] **U09 — Raffinare l'albero.** Rientro 16 px per livello, espansore separato dall'apertura, riga intera cliccabile, icona 16 px, nome ellissato e percorso completo disponibile. Nessun salto di larghezza quando compare un'azione hover.
- [ ] **U10 — Rendere le azioni scopribili.** Header con Nuova e menu di azioni realmente disponibili; contestuale per rinomina, spostamento, cestino, icona e organizzazione se serviti. Ogni operazione da trascinamento deve avere alternativa da tastiera/menu.
- [ ] **U11 — Gestire operazioni pendenti.** Durante rinomina/spostamento mostrare progresso sulla riga; evitare doppio invio; su errore conservare nome precedente e input recuperabile. Non simulare successo prima della risposta autorevole.
- [ ] **U12 — Mostrare limiti reali delle liste.** Se una query è paginata, offrire la pagina successiva o un caricamento progressivo verificabile. Non suggerire che la prima finestra sia l'intero vault.

**Tastiera:** frecce per albero, Home/End, Enter per apertura, contestuale via tasto Menu o Shift+F10; i binding esistenti rimappabili prevalgono. Il focus rimane sull'elemento rinominato o sul vicino sensato dopo una rimozione.

### 6.3 Ricerca, apertura rapida e palette

- [ ] **U13 — Rendere esplicito lo scope.** Etichette “Cerca nel vault”, “Apri documento”, “Cerca nel documento”, “Comandi”. Non usare un generico “Cerca…” per superfici con effetti diversi.
- [ ] **U14 — Progettare i risultati.** Titolo principale, percorso secondario per disambiguare omonimi, estratto/evidenziazione solo se forniti dal risultato. Non creare falsi snippet rileggendo ogni file dalla shell.
- [ ] **U15 — Gestire l'intero ciclo.** Stato iniziale, caricamento, risultati, zero risultati, errore e dati precedenti in aggiornamento. Un errore non si presenta come zero risultati; query e selezione restano recuperabili.
- [ ] **U16 — Proteggere focus e causalità.** Risposta obsoleta scartata; nessun salto automatico del focus dal campo alla lista. Frecce selezionano, Enter esegue, Escape chiude la superficie appropriata.
- [ ] **U17 — Conservare la query dove serve.** Aprire un risultato non azzera la ricerca. Ripristinare lo stato nella stessa sessione/vault, senza trascinarlo in un vault differente.
- [ ] **U18 — Uniformare palette e switcher.** Larghezza massima 640 px, margine minimo 16 px dal viewport, altezza massima 70vh; input 40 px; righe con titolo, descrizione opzionale e shortcut effettiva. Una riga può crescere, non tagliare l'etichetta essenziale.
- [ ] **U19 — Rendere sicuri i comandi.** Disponibilità, effetti di scrittura, raccolta dei parametri, piano/conferma e rifiuti devono rimanere nel percorso reale del comando. Non sostituire la palette con semplici click su bottoni nascosti.
- [ ] **U20 — Correggere il caso oltre 200 note.** Dopo aver riprodotto R06, usare la query per nome/prefisso disponibile per i suggerimenti oppure paginazione esplicita. Non cambiare il contratto IPC se il registro query già esprime il caso.

### 6.4 Tab, split e toolbar del documento

- [ ] **U21 — Disegnare tab distinguibili.** Nome breve, stato dirty non basato solo sul colore, close button accessibile “Chiudi nome”. Tab attiva: superficie e sottolineatura tenue; riquadro a fuoco: indicatore distinto. Le tab view non fingono di essere file.
- [ ] **U22 — Gestire molte tab.** Scorrimento della tab strip e menu elenco; tab attiva portata in vista. Nessuna compressione a pochi pixel e nessuna chiusura accidentale con il medesimo click che seleziona.
- [ ] **U23 — Portare le modalità nel riquadro.** Toolbar con percorso contestuale, modalità dichiarate e menu riquadro. Un click agisce sul riquadro corretto usando il percorso esistente di focus/mode, non una seconda verità locale.
- [ ] **U24 — Non creare modalità false.** Con una sola modalità non mostrare un segmentato inutile. Markdown espone Sorgente/Live/Lettura; le altre superfici mostrano soltanto ciò che dichiarano. ID di modalità sconosciuti non vanno cancellati dal layout persistito.
- [ ] **U25 — Rendere visibili gli split.** Menu riquadro con le azioni esistenti per dividere e chiudere; dopo split il focus e il contesto sono chiari. Non cambiare la sessione del documento per costruire il nuovo contenitore.
- [ ] **U26 — Mantenere il contenuto stabile.** Aprire ispettore, cambiare tema o salvare non ricrea `EditorView`, non azzera selezione, scroll o history. Il redesign aggiorna il chrome, non rimonta l'editor a ogni evento.

### 6.5 Editor Markdown e lettura

- [ ] **U27 — Dare respiro al documento.** Padding orizzontale 24 px quando c'è spazio, 16 px nei riquadri stretti; colonna di prosa limitata dalla preferenza, centrata senza spostamenti a ogni battuta. Gutter separato e non dominante.
- [ ] **U28 — Conservare le tre modalità.** Sorgente mostra testo/sintassi; Live conserva editing e widget; Lettura usa il provider reale. Nessuna copia parallela del parser o della sanitizzazione.
- [ ] **U29 — Allineare la resa.** Heading, paragrafi, liste, checkbox, quote, callout, tag, link, codice, tabelle ed embed usano la medesima grammatica grafica in Live e Lettura, pur rispettando le differenze di editing.
- [ ] **U30 — Contenere elementi larghi.** Codice e tabelle scorrono localmente; immagini rispettano la larghezza disponibile; link non spezzano la shell. Messaggi di embed non disponibile e limiti di profondità restano espliciti.
- [ ] **U31 — Preservare la navigazione semantica.** Wikilink, heading, backlink e ricerca devono portare al documento/blocco corretto; decorazioni non trasformano gli offset o intercettano impropriamente selezione e click.
- [ ] **U32 — Mostrare il contesto della Lettura.** Se il provider rende la versione persistita mentre esiste un buffer non salvato, mostrare un avviso non ambiguo. Non presentare dati vecchi come anteprima aggiornata e non forzare una scrittura per nascondere il problema.

### 6.6 Griglia e superfici non Markdown

- [ ] **U33 — Disegnare la griglia come superficie specifica.** Header righe/colonne leggibili, selezione/cella attiva distinte, formula bar con etichetta/coordinate, tab fogli se presenti. Niente margine 70ch o toolbar Markdown ereditati.
- [ ] **U34 — Preservare le interazioni.** Selezione estesa, scroll virtualizzato, navigazione tastiera, modifica in-cell, commit/cancel, copia/incolla TSV e undo mantengono il percorso esistente.
- [ ] **U35 — Esplicitare la valutazione.** Valutazione in corso, disponibile, errore formula e provider indisponibile sono stati diversi. In assenza del provider mostrare input grezzi e spiegazione; non visualizzare valori calcolati precedenti come attuali.
- [ ] **U36 — Riprodurre R04.** Eseguire la prova in-cell + modifica da altro riquadro e undo dopo sync. Se serve una correzione, preservare o rendere recuperabile l'input non confermato e applicare la politica nell'engine/sessione.
- [ ] **U37 — Dare una via d'uscita alle superfici non disponibili.** Nome/percorso, motivo e chiusura tab. “Copia percorso” o “Riprova” solo quando il meccanismo esiste e ha senso; non aggiungere un download fittizio.

### 6.7 Ispettore e view dichiarative

- [ ] **U38 — Rendere riconoscibile la view.** Header con icone/schede e titolo testuale della view selezionata. A larghezza sufficiente usare etichette; in compatto tooltip e nome accessibile. La view si ottiene dal registro, non da un array di titoli hardcoded.
- [ ] **U39 — Esporre il contesto.** Indicare il documento a cui si riferisce l'ispettore. Quando una tab grafo o una view non ha contesto documento, mostrare lo stato previsto dal contratto, non un outline stale senza spiegazione.
- [ ] **U40 — Correggere A04.** Le righe di outline e altri alberi hanno altezza/bersaglio adeguati. Verificare anche i button annidati: ingrandire il contenitore senza ingrandire il target effettivo non risolve il problema.
- [ ] **U41 — Mantenere la riconciliazione.** Riutilizzare il renderer keyed di `ui/node.ts`. Un refresh non distrugge input focalizzati, form compilati o selezione. Non duplicare il renderer nei pannelli del redesign.
- [ ] **U42 — Gestire assenza e unload.** Nessun heading, nessun backlink, view in caricamento, errore e provider rimosso hanno stati leggibili. Se una scheda sparisce, selezionare una view valida e spostare il focus in modo prevedibile.
- [ ] **U43 — Vestire tutto il protocollo.** Controllare nel catalogo tutte le famiglie `UiNode` effettivamente supportate, inclusi form, elenchi, alberi, tabelle, errori e renderer registrati. Il risultato non è completo se funzionano solo i tre pannelli ufficiali visibili all'avvio.

### 6.8 Grafo

- [ ] **U44 — Conservare la natura di tab.** Il grafo resta nel centro e si chiude dalla tab, senza trasformarsi in una pagina che sostituisce il workspace.
- [ ] **U45 — Migliorare il chrome, non riscrivere il motore.** Rendere leggibili conteggi, selezione e controlli già presenti; correggere A06. Raggruppare comandi di vista e parametri di simulazione senza inventare filtri o algoritmi non implementati.
- [ ] **U46 — Non affidarsi al solo canvas.** Rendere identificabile il nodo selezionato e le azioni disponibili. Verificare la navigazione da tastiera esistente; dove manca un equivalente, fornire un elenco accessibile dei nodi pertinenti usando gli stessi dati, senza duplicare il calcolo del grafo.
- [ ] **U47 — Distinguere stati.** Caricamento, grafo vuoto, errore query e simulazione in pausa non sono un canvas nero. Retry soltanto su azione o meccanismo esistente; niente retry loop aggiunto per questo redesign.
- [ ] **U48 — Conservare i limiti prestazionali.** Nessun DOM per ogni nodo del canvas, niente rendering continuo introdotto da badge o tooltip. Una lista accessibile grande va paginata/virtualizzata. Confrontare la stessa fixture prima/dopo.

### 6.9 Impostazioni

- [ ] **U49 — Conservare le quattro sezioni.** Configurazione, Componenti, Scorciatoie, Vault restano riconoscibili. Dialogo massimo 960 px, margini minimi 16 px, header e navigazione stabili, scroll nel corpo.
- [ ] **U50 — Rendere i gruppi leggibili.** In Configurazione mantenere i gruppi forniti dal contratto; titoli chiari, descrizione secondaria, controllo allineato. Riga a due colonne quando entra; etichetta sopra controllo in compatto.
- [ ] **U51 — Dichiarare scope e provenienza.** Distinguere valore di macchina, di vault e predefinito. “Ripristina predefinito” non deve sembrare un reset dell'intero vault. Non nascondere restrizioni o valori imposti da policy.
- [ ] **U52 — Correggere A03 alla fonte.** Evitare `replaceChildren()` dell'intero corpo per una singola scrittura. Aggiornare la riga con identità stabile; se un rebuild è indispensabile, ripristinare controllo, selezione e scroll senza sovrascrivere digitazioni successive.
- [ ] **U53 — Gestire pending ed errore per campo.** Mostrare l'esito vicino al controllo; bloccare solo ciò che non può accettare un altro invio. Su errore il valore autorevole e l'input dell'utente devono restare comprensibili, non sparire in un toast.
- [ ] **U54 — Salvaguardare le scorciatoie.** Registrazione, reset, conflitti e binding non fidati del vault restano espliciti. Non attivare tasti provenienti da un vault senza il percorso di fiducia esistente.
- [ ] **U55 — Rendere onesti Componenti e Vault.** Stato, permessi e azioni dipendono dall'host. Non presentare uno store plugin inesistente. Rimuovere un vault dall'elenco dei recenti non deve sembrare cancellare la cartella.
- [ ] **U56 — Tenere le preferenze operative.** Tema di sistema/chiaro/scuro, contrasto, densità, font, corpo, misura, accento, lingua dove disponibile e zoom devono continuare a funzionare. Il banco non prova da solo lo zoom nativo.

### 6.10 Stato, conflitti, bozze, cestino e attività

- [ ] **U57 — Rendere leggibile il salvataggio.** Mostrare gli stati reali della sessione con testo e simbolo: modifiche in attesa, salvataggio, salvato, errore, conflitto. I nomi visuali possono cambiare, non la semantica o l'autorità del risultato.
- [ ] **U58 — Evitare annunci a ogni battuta.** Aggiornare lo stato visuale senza martellare lo screen reader. Annunciare transizioni significative; un conflitto deve restare percepibile anche dopo la scomparsa del toast.
- [ ] **U59 — Aggiungere una superficie persistente al conflitto.** Banner nel riquadro coinvolto: documento, spiegazione, “Mantieni il mio testo” e “Usa la versione su disco”. Conferma esplicita prima di scartare/sovrascrivere, con conseguenza descritta. Usare i comandi/sessioni esistenti.
- [ ] **U60 — Non fingere un merge.** Un confronto può usare soltanto versioni realmente disponibili. Non aggiungere un pulsante Unisci se manca un algoritmo/contratto verificato. Finché il conflitto resta irrisolto, il buffer rimane recuperabile.
- [ ] **U61 — Coprire R01 e R02.** Prima della chiusura dell'ultima superficie o di un ripristino distruttivo, verificare il percorso reale di flush/bozza/conferma. Se persistenza e bozza falliscono, non completare silenziosamente la chiusura. Decisione e stato vivono nell'owner corretto.
- [ ] **U62 — Trattare le bozze come dati.** Recupero, differenza dalla versione su disco, origine e azione di scarto esplicite. Bozza divergente, nuova, superata e incerta non condividono indiscriminatamente la medesima azione primaria.
- [ ] **U63 — Distinguere cestino e cancellazione definitiva.** “Sposta nel cestino” è diverso da “Elimina definitivamente”. Il ripristino espone eventuali collisioni. Un toast non promette Annulla se il comando non è disponibile.
- [ ] **U64 — Rendere affidabile Attività.** Titolo job, stato, progresso reale o indeterminato, annullamento solo se supportato, esito finale. Conservare dati precedenti in caso di errore query ma segnalarli come non aggiornati.
- [ ] **U65 — Separare avvisi momentanei e problemi aperti.** I toast comunicano l'evento; il centro Avvisi e lo stato pertinente mantengono il problema finché rilevante. Aprire dettagli non deve obbligare a riaprire la console.
- [ ] **U66 — Mostrare il watcher non disponibile.** Quando l'host segnala assenza di rilevamento modifiche esterne, mantenerne un'indicazione persistente nel contesto vault. Non inventare “sincronizzato” per un'app local-first senza quel segnale.

## 7. Componenti condivisi e stati obbligatori

Non costruire un nuovo design system parallelo. Rifinire le primitive e le classi esistenti, registrando solo gli hook necessari nell'anatomia del tema.

| Componente | Stati da disegnare e verificare |
|---|---|
| Pulsante | Normale, hover, pressed, focus-visible, disabled, pending, distruttivo |
| Campo | Vuoto, compilato, focus, readonly, disabled, invalido, invio in corso, errore |
| Riga interattiva | Normale, hover, selezionata, focus, espansa, pending, non disponibile |
| Tab | Attiva, inattiva, focus, dirty, errore/conflitto, nome lungo, chiusura |
| Menu/popover | Aperto, bordo viewport, voce disabilitata, sottomenu se previsto, ritorno focus |
| Dialogo | Titolo, descrizione, contenuto lungo, validazione, invio, errore, annullamento |
| Stato vuoto | Motivo specifico e unica azione primaria pertinente |
| Banner/notifica | Informazione, avvertimento, errore, azione, chiusura consentita o persistenza |
| Form provider | Aggiornamento keyed, valori locali in editing, submit, errori, unload |

- [ ] **C01 — Usare HTML nativo quando possibile.** Button, input e select prima di div interattivi. Non duplicare ruoli o fermate Tab senza motivo.
- [ ] **C02 — Un solo modello di focus.** Riutilizzare `ui/a11y.ts` e la pila di `trapFocus`; dialoghi annidati non creano due trap attivi. La superficie dietro una modale non resta operabile.
- [ ] **C03 — Gestire Escape per livello.** Prima il popup interno, poi il dialogo, infine il pannello pertinente. Escape non chiude l'app o una tab documento per errore.
- [ ] **C04 — Restituire il focus.** Alla chiusura tornare al trigger; se rimosso, usare un fallback vicino e sensato. Non affidarsi al `body` come comportamento normale.
- [ ] **C05 — Non affidare informazioni al tooltip.** Nome e stato accessibili nel controllo; tooltip per aiuto e scorciatoia, visibile anche da tastiera e senza coprire il focus.
- [ ] **C06 — Errori tipizzati.** Mantenere tipo/specie dell'errore fino alla presentazione. Messaggio umano con azione possibile; dettaglio tecnico separato, senza parsing di `error.toString()`.
- [ ] **C07 — Aggiornare la lingua in place.** Stringhe shell in `i18n/strings.ts`; cambio lingua senza perdita di input, focus o selezione. Non tradurre nomi dei file o titoli forniti dall'utente.

## 8. Mappa precisa dei file

Tutti i percorsi frontend seguenti sono relativi a `apps/client/`, salvo indicazione diversa.

| Area | Sorgenti principali | Istruzione |
|---|---|---|
| Markup della shell | `index.html` | Struttura e landmark; non business logic |
| Composizione | `src/desktop-shell.ts` | Collegare owner esistenti, non accumulare logica dei pannelli |
| Scocca/responsive | `src/theme/structure.css` | Dimensioni strutturali, layout, piani e adattamento |
| Ricetta | `src/theme/serie/recipe.ts` | Token generati e varianti, una sola autorità |
| Skin | `src/theme/serie/skin/*.css`, `skin/order.ts` | Stile dei componenti; modificare i frammenti, non l'assemblato |
| Inventario tema | `src/theme/serie/anatomia.ts`, `src/theme/contrast-fixture.ts` | Hook reali e coppie effettive di contrasto |
| Runtime tema | `src/theme/theme.ts`, `loader.ts`, `reduced-motion.ts` | Preferenze e montaggio; cambiarli solo se necessario |
| Navigazione | `src/panels/explorer.ts`, `sidebar.ts`, `rail.ts`, `search.ts` | Albero, spazi, ricerca e pannelli sinistri |
| Riquadri/documenti | `src/panels/document.ts`, `src/state/layout.ts` | Chrome del riquadro e modello layout |
| Sessioni/sicurezza | `src/state/document-session.ts`, `saving.ts`, `drafts.ts` | Regole e stati, non CSS |
| Superfici | `src/editors/core/`, `src/editors/text/`, `src/editors/grid/` | Meccanica dei formati, non duplicare engine |
| Ricerca/comandi | `src/panels/quick-switcher.ts`, `doc-search.ts`, `src/ui/palette.ts`, `commands.ts`, `keyboard.ts` | Quattro scope e pipeline dei tasti |
| Ispettore/provider | `src/ui/views.ts`, `node.ts`, `panel-host.ts` | Discovery, riconciliazione, lifecycle |
| Impostazioni | `src/panels/settings.ts` | Identità dei controlli, scope, stati |
| Stato globale | `src/panels/activity.ts`, `src/ui/notify.ts` | Job e notifiche reali |
| Primitive | `src/ui/a11y.ts`, `menu.ts`, `tooltip.ts`, `icons.ts`, `motion.ts` | Riutilizzare anziché creare varianti locali |
| Banco | `bench/scene.mjs`, `catalog.ts`, `catalog.html`, `corpus.ts`, `samples.ts`, `fake-ipc.ts` | Fixture esplicite, non capacità finte in produzione |

**File generati: non modificare a mano:** `src/theme/serie/sheet-dark.css`, `sheet-light.css`, `sheet-dark-high.css`, `sheet-light-high.css`, `src/theme/serie/skin.css`, `theme/author/contract.json`, `theme/author/README.md`, `theme/author/sample/*`. Derivano da `npm run theme:generate`. Anche i binding/tipi generati devono restare derivati dalla propria sorgente.

**Backend:** non modificare ABI, WIT, IPC, schema su disco o runtime WASM per una necessità puramente grafica. Se una correzione di sicurezza attraversa realmente il confine, l'integratore assegna una modifica mirata all'owner e applica conformità e test del confine; non costruire un aggiramento frontend.

## 9. Contratto operativo per i worker

- [ ] **W01 — Leggere prima di editare.** Ogni worker legge la sezione di prodotto, i file assegnati e i test comportamentali vicini. Prima di cambiare un simbolo esportato, cercarne i riferimenti con LSP quando disponibile.
- [ ] **W02 — Riprodurre un bug prima della correzione.** Annotare setup, azione e risultato sbagliato; conservare una regressione quando difende un comportamento reale. Non testare stringhe sorgente, nomi CSS o semplice wiring come prova del comportamento.
- [ ] **W03 — Riutilizzare i contratti.** Non introdurre un nuovo store, bus eventi, registro comandi, sistema di modali o libreria CSS. Usare owner e primitive esistenti.
- [ ] **W04 — Consegnare incrementi reali.** Una schermata deve coprire dati reali, caricamento, vuoto ed errore. Non lasciare placeholder, TODO, bottoni senza effetto o mock in produzione.
- [ ] **W05 — Controllare le superfici effettive.** Fare screenshot prima/dopo sul banco e azioni da tastiera; quando il confine è nativo, provare anche l'app desktop con un vault temporaneo.
- [ ] **W06 — Evitare edit concorrenti sugli stessi file.** La tabella successiva assegna owner esclusivi. L'integratore integra stringhe, hook e markup condivisi; i worker propongono cambi precisi, non modificano a sorpresa i file comuni.
- [ ] **W07 — Evitare validazioni globali concorrenti.** Durante un'ondata con edit simultanei, i worker non avviano formatter, build, lint o suite. L'integratore esegue le verifiche focalizzate a integrazione stabile e quelle globali una volta sullo stato finale.
- [ ] **W08 — Chiudere con prove.** Riportare file toccati, invarianti preservate, schermate/scenari esercitati, esiti e limiti. La frase “dovrebbe funzionare” non supera un criterio di uscita.

## 10. Criteri di accettazione misurabili

### 10.1 Geometria e resa

- [ ] **Q01 — Viewport reali.** Verificare 800×500, 1024×768, 1280×840, 1440×900 e 1920×1080; nessun controllo indispensabile fuori viewport o coperto. Ripetere almeno 800×500 e 1280×840 in entrambe le luci.
- [ ] **Q02 — Zoom e testo.** Verificare 100%, 125%, 150% e 200% nel runtime pertinente; controlli accessibili, dialoghi scorrevoli, testo non troncato verticalmente. Distinguere zoom dell'app da corpo del documento e zoom della camera grafo.
- [ ] **Q03 — Temi e densità.** Quattro combinazioni luce/contrasto, tre densità, font di lettura disponibili e almeno tre tinte d'accento; nessuna divergenza di geometria fra chiaro e scuro.
- [ ] **Q04 — Contenuti difficili.** File con nomi lunghi e omonimi, percorso profondo, almeno venti tab, tre split, tabella larga, code block lungo, errore multilinea, form provider e testo italiano/inglese.
- [ ] **Q05 — Stabilità.** Salvataggio, cambio lingua, aggiornamento query e apertura pannello non spostano improvvisamente cursore, scroll o focus. Le schermate vengono catturate dopo font pronti e transizioni concluse, non dopo attese arbitrarie.

### 10.2 Accessibilità

- [ ] **Q06 — Tastiera completa.** Primo Tab sul link di salto; navigazione di rail, albero, tab, editor, ispettore, menu, palette e impostazioni senza mouse; nessun trap accidentale.
- [ ] **Q07 — Focus visibile e non coperto.** Indicatore distinguibile da selezione e hover; non tagliato da overflow; ritorno focus dopo ogni overlay. Verificare anche forced colors.
- [ ] **Q08 — Bersagli interattivi.** Zero violazioni `target-size` nei controlli della shell; controllare il target reale degli alberi dell'ispettore. Non aumentare solo il wrapper decorativo.
- [ ] **Q09 — Nomi e annunci.** Nessun bottone senza nome; dialoghi etichettati; progressi e errori annunciati senza ripetizioni per battuta; controlli dinamici con stato corretto.
- [ ] **Q10 — Audit automatico e umano.** Eseguire axe sulle scene, risolvere le violazioni e classificare ogni incomplete. Verificare con uno screen reader reale sulla piattaforma disponibile, dichiarando quale; non equiparare axe a certificazione completa.

### 10.3 Funzioni e dati

- [ ] **Q11 — Nessuna regressione di documento.** Una nota aperta in due riquadri mostra il medesimo buffer; undo resta locale e non annulla modifiche remote non pertinenti.
- [ ] **Q12 — Nessun falso salvataggio.** Stato Salvato solo dopo esito autorevole. Errori, conflitti e bozze non salvabili restano visibili e recuperabili.
- [ ] **Q13 — Nessuna azione fantasma.** Pulsanti e scorciatoie rispettano disponibilità, permessi e provider. Un'estensione disabilitata non lascia una tab apparentemente funzionante ma vuota.
- [ ] **Q14 — Nessuna regressione di risorse.** Ripetere mount/unmount di dialoghi, editor, view e grafo; listener, observer e timer ritornano alla baseline tracciata. Non limitarsi alla memoria heap.
- [ ] **Q15 — Nessuna falsa prova backend.** Conflitti su disco, recovery dopo riavvio, watcher, permessi nativi e zoom richiedono le rispettive prove fuori dal solo fake host.

## 11. Scenari manuali deterministici

Usare esclusivamente fixture o un vault temporaneo dedicato. Non simulare corruzione o perdita di permessi nei dati dell'utente. Preparare documenti Markdown, plain text e un `.fubsheet` valido usando le fixture/provider esistenti; includere Unicode, emoji nel contenuto e CRLF.

| ID | Preparazione e azione | Risultato richiesto |
|---|---|---|
| S01 | Avvio senza vault; aprire e annullare il picker; poi scegliere il vault temporaneo | CTA evidente, annullamento innocuo, apertura riuscita senza shell a metà |
| S02 | Aprire la shell a 800×500 e usare Menu, ricerca e impostazioni | Nessuna sovrapposizione; documento utilizzabile; drawer richiudibili |
| S03 | Espandere due livelli, rinominare un file, provocare una collisione | Identità e focus preservati; collisione esplicita; nessuna perdita |
| S04 | Cercare una parola, cambiare query mentre la risposta precedente è ritardata | Appare solo l'esito valido; errore distinto da zero risultati |
| S05 | Aprire tramite palette un parametro documento con oltre 200 note disponibili | Il documento fuori prima pagina resta trovabile o il limite è gestito esplicitamente |
| S06 | Aprire la stessa nota in due split; modificare parti separate; undo nei due riquadri | Buffer sincronizzato, history locali corrette, nessun cursore copiato |
| S07 | Passare Sorgente → Live → Lettura e tornare; aprire outline e backlink | Contenuto invariato, offset corretti, contesto della versione dichiarato |
| S08 | Tenere buffer dirty; provocare modifica esterna e conflitto controllato | Banner persistente; nessuna scelta automatica; entrambi i percorsi espliciti |
| S09 | Fallire scrittura e bozza; tentare chiusura dell'ultima tab e della finestra | Nessuna scomparsa silenziosa dell'unica copia recuperabile |
| S10 | Recuperare una bozza divergente e tentare un ripristino versione con buffer dirty | Conseguenze esplicite prima dell'azione; annullamento conserva il lavoro |
| S11 | In griglia digitare in-cell, aggiornare dal secondo riquadro, poi undo | Nessuna digitazione persa senza recupero; nessuna risurrezione di celle vecchie |
| S12 | Disabilitare la valutazione del foglio e riabilitarla | Input grezzi con stato indisponibile; risultati validi solo dal provider corrente |
| S13 | Da tastiera cambiare un checkbox impostazioni e poi premere Tab | Focus sullo stesso controllo dopo update; Tab continua alla riga seguente |
| S14 | Aprire dialogo, menu/picker interno, poi Escape ripetutamente | Chiusura dal livello interno; ritorno focus corretto; documento non chiuso |
| S15 | Aprire una view provider con campo compilato; aggiornare indice; rimuovere provider | Campo non azzerato al refresh; unload pulito e fallback esplicito |
| S16 | Aprire grafo, cambiare vault, chiudere/riaprire tab | Dati del nuovo vault, nessun canvas orfano o loop residuo |
| S17 | Far fallire la query attività mantenendo un job già visibile | Lista precedente segnalata come non aggiornata; ritorno allo stato valido alla risposta riuscita |
| S18 | Tema/lingua/densità con selezione e scroll nell'editor e campo settings focalizzato | Preferenze applicate senza perdita del contesto di lavoro |
| S19 | Vault senza watcher; lavorare e riaprire Avvisi | Indicazione persistente, nessuna promessa di sincronizzazione esterna |
| S20 | Tastiera e screen reader su outline, proprietà, grafo e dialoghi | Nomi/stati comprensibili; alternativa alle interazioni solo visive |

- [ ] **S-CHECK — Registrare gli scenari.** Per ogni riga annotare esito, ambiente, versione del codice e prova. Una riga non esercitata non è superata; una fixture non può attestare un comportamento nativo che non implementa.

## 12. Pacchetti di implementazione e dipendenze

L'integratore possiede `index.html`, `desktop-shell.ts`, `structure.css`, `recipe.ts`, `anatomia.ts`, `contrast-fixture.ts`, `i18n/strings.ts` e il registro finale delle scene. Le modifiche a questi file vengono integrate in modo seriale. La tabella assegna aree, non autorizza modifiche simultanee allo stesso file.

| Pacchetto | Dipendenza | Owner e area esclusiva | Criterio di uscita |
|---|---|---|---|
| P0 — Baseline e contratti | Nessuna | Integratore, issue e fixture | Audit riproducibile e responsabilità assegnate |
| P1 — Fondamenta visive | P0 | Integratore + worker primitive, in sequenza sui file comuni | Token, catalogo e componenti fondamentali coerenti |
| P2 — Shell adattiva | P1 | Worker shell; integrazione dei file comuni riservata | A01/A02 risolti, 800×500 utilizzabile |
| P3 — Navigazione e ricerca | P2 | Worker navigazione: explorer, sidebar, rail, search, quick-switcher, doc-search, palette | Quattro strumenti distinti e tastiera completa |
| P4 — Documento e sicurezza | P2 | Worker documento: document, layout, sessioni, superfici | Chrome contestuale e scenari anti-perdita superati |
| P5 — Ispettore e primitive provider | P2 | Worker view: views, node, panel-host | A04 risolto; renderer e unload preservati |
| P6 — Impostazioni e stato | P2 | Worker settings: settings, activity, notify | A03 risolto; errori e scope leggibili |
| P7 — Grafo | P2 | Worker grafo: panels/graph, graph, skin grafo | Resa e interazioni accessibili, scala non regredita |
| P8 — Integrazione e accettazione | P3–P7 | Integratore | Matrice finale e prove native pertinenti complete |

P3–P7 possono procedere in parallelo soltanto dopo l'accordo sui token, sulla toolbar, sui nuovi hook e sui file condivisi. `ui/node.ts` non viene modificato anche dal worker impostazioni; quest'ultimo riusa le primitive o propone un intervento al proprietario. `panels/document.ts` non viene modificato dal worker grafo per conto proprio.

### 12.1 P0 — Preparazione

- [ ] **P0.1** Riprodurre A01–A04 sullo stato di partenza; fotografare avvio, documento, ricerca, palette, settings, ispettore, grafo e viewport minimo in chiaro/scuro.
- [ ] **P0.2** Registrare i quattro scope di ricerca, i comandi e le view realmente disponibili; distinguere fixture e provider reali.
- [ ] **P0.3** Assegnare le riproduzioni R01–R08 agli owner corretti; non trasformarle automaticamente in refactor backend.
- [ ] **P0.4** Fissare modalità di raccolta delle prove e ambiente canonico delle baseline. Non creare un nuovo framework di test.

### 12.2 P1 — Sistema visivo

- [ ] **P1.1** Applicare la sezione 4 ai componenti di base usando i token correnti; mappare ogni nuova classe necessaria nell'anatomia.
- [ ] **P1.2** Correggere A05 prima di affidarsi al catalogo dei contrasti; rendere l'esito insufficiente leggibile oltre al solo colore.
- [ ] **P1.3** Integrare focus, target size, overlay e tooltip; documentare la responsabilità degli z-index strutturali senza abolire gli stacking context locali legittimi.
- [ ] **P1.4** Rigenerare gli artefatti con il comando ufficiale e verificare il catalogo in tutte le varianti, incluse preferenze dell'utente.

### 12.3 P2 — Shell

- [ ] **P2.1** Implementare geometria e breakpoint della sezione 5 senza cambiare il modello logico dei riquadri.
- [ ] **P2.2** Implementare la schermata senza vault e gli stati di apertura/fallimento U01–U05 con il flusso esistente.
- [ ] **P2.3** Preparare il contenitore della toolbar per-pane; il worker documento integra modalità e comandi nel proprio owner.
- [ ] **P2.4** Verificare controlli finestra, drag region, drawer, ripristino della preferenza e navigazione a 800×500.

### 12.4 P3 — Navigazione

- [ ] **P3.1** Applicare U06–U12 ad albero e spazi senza cambiare le regole di organizzazione autorevoli.
- [ ] **P3.2** Applicare U13–U20 alle quattro superfici di ricerca/comando, preservando query e pipeline dei tasti.
- [ ] **P3.3** Correggere R06/R07 solo dopo riproduzione; verificare liste grandi, omonimi e cambio vault.
- [ ] **P3.4** Consegnare screenshot e scenari S03–S05, menu da tastiera e stato d'errore query.

### 12.5 P4 — Documenti

- [ ] **P4.1** Applicare U21–U32 a tab, toolbar e superfici testuali; nessuna ricreazione superflua dell'engine.
- [ ] **P4.2** Applicare U33–U37 alla griglia e ai fallback; mantenere virtualizzazione e valutazione autorevole.
- [ ] **P4.3** Integrare banner e azioni di conflitto U57–U63 coordinandosi con il worker stato, senza doppio ownership del buffer.
- [ ] **P4.4** Riprodurre e correggere i problemi effettivi R01–R04 nel livello proprietario; aggiungere regressioni su perdita dati, race e undo, non su dettagli di markup.
- [ ] **P4.5** Consegnare S06–S12, chiusura finestra reale e prove di Unicode/CRLF pertinenti.

### 12.6 P5 — View e ispettore

- [ ] **P5.1** Applicare U38–U43; non ricostruire come HTML manuale gli alberi del provider.
- [ ] **P5.2** Dimostrare che A04 non si riproduce più sul target reale, in tutte le densità.
- [ ] **P5.3** Verificare refresh con form focalizzato, unload, errore di view e cambio del documento attivo.
- [ ] **P5.4** Esercitare tutte le famiglie di nodi nel catalogo e consegnare S15/S20 pertinenti.

### 12.7 P6 — Impostazioni e stato

- [ ] **P6.1** Applicare U49–U56 e correggere A03 con una prova tastiera prima/dopo.
- [ ] **P6.2** Applicare U64–U66 e riprodurre R05; distinguere nessun job, query fallita e lista non aggiornata.
- [ ] **P6.3** Coordinare con P4 le notifiche di salvataggio/conflitto: sessione autorevole, banner nel riquadro, centro Avvisi unico.
- [ ] **P6.4** Consegnare S13/S14/S17/S18/S19 e verifica del controllo zoom nel runtime nativo.

### 12.8 P7 — Grafo

- [ ] **P7.1** Applicare U44–U48 e correggere A06 nel frammento sorgente della skin.
- [ ] **P7.2** Verificare R08, focus, apertura nodo, controlli fisica e alternativa accessibile senza duplicare la simulazione.
- [ ] **P7.3** Consegnare S16/S20 e i risultati di scala previsti nella sezione 13.

### 12.9 P8 — Integrazione finale

- [ ] **P8.1** Integrare stringhe, hook, scene e file condivisi; rimuovere solo percorsi obsoleti introdotti dal redesign, non codice estraneo.
- [ ] **P8.2** Eseguire l'intera matrice Q01–Q15 e gli scenari pertinenti della sezione 11 sul medesimo stato finale.
- [ ] **P8.3** Esaminare il foglio di contatto delle schermate, anche chiaro, alto contrasto, finestre strette, errori e stati vuoti. Nessuna approvazione basata solo sullo screenshot ideale.
- [ ] **P8.4** Dopo la prova del comportamento, aggiornare solo le pagine canoniche delle invarianti realmente cambiate, il changelog se previsto e i test contrattuali interessati; rimuovere fixture/script temporanei non necessari.
- [ ] **P8.5** Riportare verifiche non eseguite e motivi. Non chiudere il lavoro finché resta una funzione richiesta soltanto disegnata o un percorso di perdita dati non risolto.

## 13. Comandi e prova finale

I comandi seguenti sono istruzioni per chi implementerà la GUI. Non sono una dichiarazione che siano stati eseguiti durante la stesura di questo piano.

### 13.1 Frontend e tema

Da `apps/client/`, usare npm e il lockfile esistente. `npm ci` serve al setup quando necessario, non a rigenerare il lockfile.

```bash
npm run theme:generate
npm run theme:verify
npm run typecheck
npm test
npm run build
npm run bench:a11y
npm run bench:verify
npm run bench:graph-scale -- --nodes 2000 --seed 6 --cycles 3
npm run bench:graph-scale -- --nodes 10000 --seed 6 --cycles 1 --soak-windows 8
```

- [ ] **T01 — Verifiche focalizzate.** Prima della suite finale eseguire i test vicini dei moduli cambiati. I nuovi test devono difendere un comportamento osservabile: focus conservato, conflitto, race, chiusura sicura, target o tastiera.
- [ ] **T02 — Baseline intenzionali.** Il redesign produce differenze attese. Esaminarle prima, aggiornare le baseline soltanto nell'ambiente Linux canonico con Playwright previsto, poi rieseguire `bench:verify` senza update. Non alzare la tolleranza per ottenere verde.
- [ ] **T03 — Scene mancanti.** Aggiungere ai banchi esistenti le scene necessarie per finestra minima, focus settings, conflitto, griglia, errore, provider assente e nomi lunghi. Fixture nuove solo se esercitano stati non rappresentati.
- [ ] **T04 — Prestazioni grafo.** Usare fixture e digest documentati; confrontare frame, risorse e heap con ambiente dichiarato. I budget numerici di [performance-budget.md](docs/product/performance-budget.md) restano criteri di review dove così documentati, non gate CI già esistenti.

### 13.2 Runtime desktop e backend

Dalla radice, avviare il desktop con un vault temporaneo:

```bash
cargo tauri dev --config crates/fub-app/tauri.conf.json
```

- [ ] **T05 — Prova nativa obbligatoria.** Apertura file picker, controlli finestra, zoom, chiusura, salvataggio e rilevamento modifiche esterne. Registrare piattaforma; il banco non sostituisce queste prove.
- [ ] **T06 — Confini modificati.** Se cambia codice Rust, eseguire test del crate e integrazione appropriata con `fub-testkit`; se cambia IPC, aggiornare mirror/fixture/fake host e conformità; se cambia WIT, additività frozen e consumer reali. Non modificare una baseline frozen per nascondere una rottura.

Per una modifica trasversale applicare il ciclo pertinente di CONTRIBUTING:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --no-fail-fast
cargo deny check
```

### 13.3 Guard e documentazione

Dalla radice:

```bash
node .github/scripts/check-codemirror-boundary.mjs
node .github/scripts/check-doc-links.mjs
node .github/scripts/check-doc-orphans.mjs
node .github/scripts/check-doc-size.mjs
node .github/scripts/check-mermaid.mjs --render
node .github/scripts/check-markdown-style.mjs
node .github/scripts/check-prose.mjs
node .github/scripts/check-tables.mjs
node .github/scripts/check-locale-loop.mjs
```

- [ ] **T07 — Non confondere i guard con prove UX.** Un controllo strutturale non dimostra che un bottone si raggiunga, che il focus resti o che un file sia salvo. Conservare anche screenshot, scenari e risultati del runtime reale.
- [ ] **T08 — Verificare questo allegato separatamente.** Alcuni guard percorrono soltanto i documenti canonici. Controllare anche link, heading, tabelle e checkbox di `piano_grafica.md`, senza assumere che venga incluso automaticamente.

## 14. Regola di completamento

- [ ] **D01 — Tutte le aree esistenti restano raggiungibili.** Nessuna capacità scompare per ottenere una schermata più pulita.
- [ ] **D02 — I problemi confermati A01–A06 sono corretti.** Prove prima/dopo disponibili, non soltanto descrizioni.
- [ ] **D03 — I rischi R01–R08 hanno un esito.** Riproduzione e correzione, oppure evidenza concreta che la precondizione non si verifica; nessun rischio dati ignorato.
- [ ] **D04 — Grafica uniforme su tutte le superfici.** Non solo editor: onboarding, albero, ricerca, palette, settings, griglia, grafo, provider, errori e dialoghi.
- [ ] **D05 — Accessibilità verificata.** Tastiera, nomi, contrasto, focus, target, reduced motion e forced colors; incomplete automatici risolti con review.
- [ ] **D06 — Dati e lifecycle preservati.** Sessioni condivise, history locali, autosave/bozze, revisioni, permessi, teardown e formati non regrediscono.
- [ ] **D07 — Artefatti corretti.** Generati tramite generatori, baseline nell'ambiente previsto, nessun file utente o cambiamento estraneo incluso.
- [ ] **D08 — Nessun finto completamento.** Niente pulsanti senza effetto, mock in produzione, schermate vuote per errori, TODO implementativi o comportamenti rinviati senza approvazione esplicita.
- [ ] **D09 — Review finale del prodotto.** Un revisore non autore esegue i flussi principali senza istruzioni privilegiate, identifica vault/documento/stato e ritrova le azioni. Ogni ambiguità osservata torna al pacchetto proprietario.

Il risultato atteso non è una nuova app con la stessa insegna: è Fub riconoscibile nella propria struttura, più leggibile e prevedibile, con una GUI che rende esplicite le garanzie già possedute dal core invece di indebolirle.
