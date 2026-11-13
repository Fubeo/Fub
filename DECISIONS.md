# Decisioni del lavoro a piani

Questo file serve al workflow a piani (`/pianifica`, `/orchestra`, vedi
`CLAUDE.md`). Dice che cosa l'orchestratore decide da solo e che cosa chiede,
e tiene il registro delle scelte fatte durante il lavoro, perché il piano dopo
ne tenga conto. Le scelte di architettura vere vanno in un ADR
(`docs/decisions/`); qui resta una riga che lo nomina.

## Il criterio

Il risultato migliore, anche quando costa più tempo, più lavoro o più coder:
fra due strade si sceglie quella più solida, non quella più corta. E poche
domande: l'utente decide ciò che vede e ciò che non si può disfare; il resto lo
decide l'orchestratore, lo scrive nel registro e lo dice nel resoconto. Nel
dubbio su una scelta tecnica si decide, non si chiede.

## L'orchestratore decide da solo

- l'ordine dei task pronti e quanti coder far lavorare insieme (al massimo tre);
- il come che il piano approvato lascia aperto: nomi, tipi, dove sta una
  funzione, la forma di un messaggio d'errore, la forma dei test;
- un piccolo refactor dentro i file del task;
- i formati interni che solo Fub legge e scrive (chiavi delle impostazioni,
  file di cache, il canale fra CLI e app), dentro ciò che il piano ha approvato;
- una dipendenza nuova fra crate del workspace che il piano implica, con il
  diagramma di `docs/architecture/overview.md` e `dependency_invariant`
  aggiornati;
- allargare il perimetro di un task a un file strettamente legato (il suo
  test, un chiamante, un file generato, la pagina di `docs/` che lo descrive),
  anche su richiesta del coder;
- i conflitti banali quando unisce (una riga in una lista, un indice, una
  tabella di testi);
- rilanciare un coder con un'indicazione più precisa, o finire da sé una
  correzione piccola;
- correggere un rosso di fmt, clippy o test causato dal task;
- dividere un task troppo grande in due, senza cambiarne il «Fatto quando».

Ogni decisione presa da solo che un altro piano dovrebbe conoscere va nel
registro.

## Chiede sempre

- ciò che chi usa Fub vede o fa in modo diverso da come dice il piano
  approvato;
- il contratto pubblico: ABI e WIT dei plugin, i comandi IPC del client che il
  piano non nomina, un formato su disco che leggono altri programmi o versioni
  già pubblicate;
- sicurezza e permessi;
- una dipendenza esterna nuova o una licenza;
- cambiare «Fatto quando» o «Fuori scope», saltare o rinviare un task;
- disattivare, saltare o mettere in quarantena un test;
- il merge.

Quando chiede: le domande di un momento tutte insieme, solo quelle la cui
risposta cambia davvero il risultato, con la conseguenza pratica di ogni
scelta e la raccomandazione per prima.

## Registro

La più recente in cima: data · piano · decisione · perché.

- 2026-11-13 · N6 T20a · L'orchestratore aggiunge il task del gesto che perde
  il rilascio. Perché: T20 ha visto la lavagna ferma in uno spostamento mai
  chiuso (nessuna scheda viva) quando il rilascio non arriva, e nella vita
  vera il rilascio si perde con un cambio di finestra a metà gesto; la regola
  di autonomia del 2026-11-13 lascia all'orchestratore le scelte tecniche.
- 2026-11-13 · N6 (merge di `main` fino a 05437b3db) · Dopo il merge `docs/reference/ipc-contract.md` era a 565 righe (tetto 550) e `docs/architecture/ink-and-tools.md` a 455 (tetto 450). Invece di comprimere, le parti di N6 hanno una pagina loro: «Depositare un file» (T3) va in `docs/reference/resource-write.md`, con un rimando nella sezione omonima del contratto (il commento di `host/ipc.ts` resta vero); «Lo strato della lavagna» e «Come lo usa la lavagna» vanno in `docs/architecture/canvas-ink-layer.md`, con un rimando in `ink-and-tools.md`. Entrambe in `docs/map/pagine.md` · Perché: il codice batte il piano sui tetti delle pagine, e una pagina per argomento resta leggibile anche quando N6 aggiunge altro.
- 2026-11-11 · N6 T89/T100 · la prova del pigro ha trovato che il doppio clic nel vuoto metteva la scheda al centro e solo scelta: l'orchestratore l'ha corretto da sé (T100, 4ee8c904b, una riga: `#placeText` come il doppio tocco) invece di passarlo al pianificatore; corretto anche `components.e2e.test.ts` (la spia di `getContext` che chiamava sé stessa) · Perché: `canvas-view.md` diceva già il comportamento giusto, la correzione è una riga con un test rosso prima e verde dopo; aprire un task per il pianificatore costava più del lavoro.
- 2026-11-11 · N6 T99 · in revisione l'orchestratore ha chiesto al coder di togliere il lettore dei titoli Markdown scritto in `excerpt.ts` (il terzo nel client, con `headingOffset`): la copia delle sezioni usa il sommario del provider (`documentOutline`, byte dei titoli) e l'abbinamento delle chiavi del selettore delle parti · Perché: i titoli sono del provider Markdown; con due regole la scheda poteva mostrare una sezione (anche un titolo col trattino sotto) che la copia diceva sparita. `headingOffset` di `state/card-editors.ts` resta: fuori da N6, da segnalare.
- 2026-11-11 · N6 T77 · integrato (merge 74001bf2d); l'orchestratore scrive T99 con gli avanzi di T70 (già promessi qui), di T77 (un solo `cardTarget`, il salto in Indietro) · Perché: piccoli pezzi che toccano `engine.ts`, insieme in un task dopo T98 invece che sparsi; l'ispettore della shell nello spazio Semplice resta fuori perché vuole un contratto della shell.
- 2026-11-11 · N6 T39 · integrato (merge 678bd2093). L'orchestratore aggiunge T98: il nucleo non conosce la proporzione del contenuto, e col Lazo un tratto su una scheda d'immagine o PDF ridimensionata con un'altra proporzione si sposta male · Perché: è un difetto vero lasciato da T39, che tocca il nucleo e l'operazione: un task suo, dopo T39, invece di allargare T39.
- 2026-11-11 · N6 T61 · integrato. Alt+← e Alt+→ vanno alla scheda vicina solo col fuoco su una scheda: la lavagna prende il tasto (preventDefault + stopPropagation) e Indietro non parte, anche se da quella parte non c'è niente (lo dice la regione viva); sulla lavagna senza una scheda a fuoco, e fuori, restano `shell.pane.back`/`forward` (T56). Altri scostamenti accettati: i comandi `canvas.nudge.<direzione>.fine` (Alt+Maiusc+frecce, 1 px) in `chrome/commands.ts`, che possiede i tasti; le schede `role="article"` (axe non ammette `group` su un `article`); il percorso Tab di `bench/a11y.mjs` segue le applicazioni che spostano il Tab sui loro figli; i docs in `canvas-view.md`, perché `canvas-cards.md` è al limite delle righe; nelle schede non attive i pulsanti interni si raggiungono dopo Invio. Le 6 baseline delle scene nuove arrivano dal runner · Perché: il piano dice «Alt da solo va alla scheda vicina»; un tasto ha un proprietario per contesto, come un editor di testo a fuoco tiene i suoi tasti.
- 2026-11-11 · N6 T63 · integrato. Prima il tasto laterale della penna cancellava sempre; ora segue `canvas.pen_button`, e il valore di serie `radial` apre il menu: chi lo usava per cancellare sceglie «Cancella» nelle Impostazioni. Il Testo nel menu ha l'icona `canvas-text`, non `fmt-text` del prototipo; a sud-ovest il Nero, perché il Blu di adesso sta nel mezzo · Perché: è la regola di F10 del piano, e le icone della lavagna sono quelle della colonna.
- 2026-11-11 · N6 T60 · integrato. Nel `.canvas` la ricerca ignora maiuscole e accenti (`resolutionKey` di `rules/mirrored.ts`); il contenuto delle note passa da `searchExpression`, che ignora le maiuscole ma non gli accenti: «citta» trova «città» in una scheda di testo e non in una nota. Resta così finché la ricerca del vault non cambia (è dell'indice, fuori da N6). Scrivere non muove la vista: il primo Invio va al primo risultato · Perché: la regola del piano («come la ricerca del vault») vale per le note; per il testo della lavagna si riusa la chiave di risoluzione che il client ha già.
- 2026-11-11 · N6 · fuori piano, coder Haiku: il nome di una scheda di testo è la prima riga senza i segni del Markdown (`card-name.ts`, `textCardName`), una regola sola per la testata del menu, l'avviso del Lazo, l'etichetta della penna, il titolo da lontano e l'ispettore (tre copie prima) · Perché: «Ora fa parte di # Idee» e «Un **appunto**» da lontano si leggevano male.
- 2026-11-11 · N6 · fuori piano, coder Opus: la nota ferma tiene la resa. La causa era la porta della shell (`document-controller.ts`), che attacca alla `life` il teardown di `mountMarkdown`, e quello svuota il contenitore; nuova opzione facoltativa `keepOnTeardown` di `MarkdownMountOptions`, passata solo dalla scheda di nota (gli altri consumatori svuotano come prima) · Perché: `note.ts` era già giusta, il difetto stava nella montatura condivisa; le altre specie di scheda non l'hanno.
- 2026-11-11 · N6 T54 · integrato. Il titolo grande scala con `--canvas-detail-zoom`, scritto solo a fine gesto, invece di `--canvas-zoom` del prototipo: durante il gesto niente si rimpagina; a riposo è uguale. Il blocco usa il colore come `background` (nel codice non c'è `--canvas-paper` né l'anello `::after` del prototipo). Visto nelle foto: le note `still` sono riquadri vuoti, perché `cards/note.ts` chiudendo `contentLife` perde la resa che il suo commento dice di tenere; si corregge fuori piano nel proprietario (`note.ts`) · Perché: al fit di una lavagna grande (0,15–0,35) le note sarebbero tutte bianche.
- 2026-11-11 · N6 · fuori piano, coder Opus: in `patch.rs` le toppe `ink` vicine sullo stesso livello si applicano leggendo e riscrivendo il livello una volta (`ink_run`); 2000 tratti spostati: compile 4,35 s → 17 ms, commit 4,29 s → 12 ms, annulla 4,24 s → 13 ms; `tests/ink_runs.rs` confronta 600 serie casuali con l'applicazione di prima (stesso testo o stesso errore con lo stesso `index`) · Perché: la fluidità viene prima, e il contratto delle toppe non cambia. Resta da misurare nella WebView il ridisegno del client dopo lo spostamento (~120 ms in jsdom).
- 2026-11-11 · N6 T86 · Integrato il Lazo. Fuori dal Tocca, accettati: `ink-paint.ts`, `icon-names.json` (l'icona) e la regola `ops.rs::scales` dichiarata in `a_named_rule_is_declared.rs` (porta in Rust `inkFitMode`, con gli stessi vettori `canvas-ink-fit/`). Niente prototipo per il lazo in azione: la barra dei tratti riusa le classi del menu della penna. Da fare dopo, come task a parte: in `patch.rs` ogni toppa `ink` rilegge e riscrive tutto il livello (O(n²): 2000 tratti spostati ~7,7 s, anche `erase_strokes`); le toppe consecutive dello stesso livello vanno applicate in un passaggio. Il nome «# Idee» nell'avviso viene da `cardMenuName`, come l'etichetta di T69 · fonte: report del coder, revisione dell'orchestratore.
- 2026-11-11 · N6 T42 · integrato; la domanda del coder (un accessore del motore della griglia per la formula, al posto della lettura dalla barra nascosta) diventa il task T97, dopo il porto di `grid/engine.ts` del piano griglia; la cella che esce dalla vista nelle righe bloccate è del motore e c'è già nel riquadro: issue all'utente, non in N6 · Perché: si corregge la causa nel proprietario, e `grid/engine.ts` ha conflitti aperti con la griglia.
- 2026-11-11 · N6 · fuori piano, coder Haiku: il bundle d'avvio non porta più la lavagna (la CI era rossa dal 2026-11-10 sulla guardia «un componente che si può spegnere arriva all'avvio»); chiavi, valori di serie e lettura pura delle impostazioni `canvas.*` passano in `src/rules/canvas-settings.ts`, `editors/canvas/preferences.ts` le riesporta · Perché: la radice era un import statico di `preferences.ts` da `document-controller.ts` e `canvas-intake.ts`; un modulo neutro taglia lì senza import dinamici né cambi di tempi.
- 2026-11-11 · N6 T57 · il lavoro del ramo `wip/n6-t57` era finito: l'orchestratore lo integra da sé (cherry-pick sulla punta di N6 dopo il merge di `main`, check rapido verde) invece di passarlo a un coder solo per rilanciare il check; il lampo della scheda raggiunta usa l'accento · Perché: stesso risultato, un worktree e una compilazione in meno sul PC dove l'utente lavora.
- 2026-11-11 · N6 T45 · integrato con T45b (la parte della shell, decisa dall'orchestratore dopo il report di T45): `#page=N` arriva alla pagina del PDF accanto, il riquadro vicino che mostra già il documento si riusa (`BesideOptions.reuse`, solo da `openPathBeside`: `fub://open`, l'esplorazione e i wikilink dividono come prima), un frammento che non arriva apre in cima e lo dice; il punto dal cursore della scheda e il menu dell'editor nella scheda passano dopo T97 · Perché: senza la pagina e il riuso «allo stesso punto» non era vero, e il punto dal cursore tocca i file della griglia che aspettano il suo porto.
- 2026-11-11 · N6 T65 · Ctrl+. (`Mod-.`) sulla lavagna come nel disegno (`draw.bare`, D8): stesso tasto, stesso significato, `data-bare` sulla superficie; vale solo dentro l'editor che ha il fuoco, quindi i due non si sovrappongono · Perché: un tasto per una funzione in tutti gli editor, ed è ciò che il prototipo T26 approvato mostra.
- 2026-11-11 · N6 T65 · integrato. Fuori dal Tocca, accettati: `engine.ts` (il montaggio, `data-bare`, il navigatore), `chrome/commands.ts` (il comando `canvas.bare`), le due pagine di `docs/reference/`. Chiudere l'ispettore della shell nello spazio Semplice vuole un contratto della shell che oggi non c'è: resta aperto, da fare come task a parte · fonte: report del coder, foto del banco a 700 px confrontate col prototipo.
- 2026-11-11 · N6 T64 · integrato. Fuori dal Tocca, accettati: `ink-layer.ts` (l'opzione `fingerWrites`), `chrome/icons.ts` e `icon-names.json` (l'icona), `structure.css` (le regole di `.canvas-rail-finger` accanto a «Completo»). Il palmo senza penna vicina che conta come secondo dito resta così: riconoscerlo è di N4 (`ink/`). «Il dito scrive» fra i comandi (Ctrl+/) va nel prossimo task che tocca `chrome/commands.ts` · fonte: report del coder, foto del banco.
- 2026-11-11 · N6 T70 · integrato, con «Il dito scrive» nel catalogo dei comandi (aggiunta dell'orchestratore). Fuori dal Tocca, accettati: `chrome/commands.ts` e il suo test, due test che usavano `onCreateNote`, le pagine di `docs/`. «Sostituisci il file…» nell'ispettore, la sezione in «Copia il testo qui» e il test di `canvasFreeName` vanno in un task di rifinitura dopo T92 · fonte: report del coder, lettura del diff di `document-controller.ts`.
- 2026-11-11 · N6 T78 · integrato dopo una correzione chiesta in revisione: la barra del taglio era dentro la scheda e scalava con lo zoom (a 35% non si premeva) e usciva dalla vista dopo una rotazione; ora sta come la barra della selezione, a misura fissa e sempre in vista. Fuori dal Tocca, accettati: `chrome/commands.ts`, `chrome/selection-bar.ts` (la posa sotto) coi loro test, `docs/reference/canvas-parts.md` · fonte: foto del banco a 1280, 700 e zoom 32%.
- 2026-11-10 · n6 · T51 integrato: «Raggruppa» diventa il comando `canvas.group` (Ctrl+G); «Collega» con tre o più schede è spento col perché, anche se il prototipo lo mostra acceso · Perché: una barra che chiama comandi del catalogo resta una sola strada (tasti, menu, ricerca); collegare venti schede non ha un significato unico, e un pulsante spento che dice perché è più chiaro di uno che indovina.
- 2026-11-10 · n6 · Le differenze di T41, su richiesta dell'utente («la soluzione più pulita e di qualità più alta, anche se ci vuole più tempo»): gli stati del salvataggio, la bozza ritrovata, la rinomina e i due punti aperti di T40 vanno nel task nuovo T96, che li prende dalla sessione e dalla banda, senza copie; la sola lettura segue la nota e non la lavagna (una lavagna che non si scrive non toglie la scrittura di una nota che si scrive); l'anello e la pillola vanno in T22. Restano come sono: il tasto centrale sposta la vista senza uscire dalla scrittura (si scrive, si guarda accanto, si continua); niente numeri di riga nella scheda (come la trasclusione del piano dell'editor); la barra di formato solo con `fub.formatting` (una funzione spenta non ne rende obbligatoria un'altra); `data-option="format"` è solo un nome · Perché: la scheda e il riquadro sono la stessa sessione e devono dire le stesse cose; ogni altra scelta dà più libertà o segue un'architettura che c'è già.
- 2026-11-10 · n6 · T41 integrato: la nota si scrive nella scheda con l'editor Live vero, sulla stessa sessione del riquadro; le differenze (stati ridotti, niente avviso di bozza, anello solo su `[data-card-editing]`) aspettano T22 e T44; le pagine `canvas-input.md` e `canvas-cards.md` superavano 550 righe, quindi muoversi, griglia, navigatore e «Riaprire dove eri» vanno in una pagina nuova, `canvas-view.md` · Perché: la regola delle 550 righe è un controllo di CI, e quei capitoli parlano tutti della vista.
- 2026-11-10 · n6 · L'utente sceglie (a) per la griglia di T71: i punti si vedono ogni 32 unità, la griglia resta accesa di serie, l'aggancio resta di 8; task T95, fatto dall'orchestratore · Perché: lo sfondo resta calmo come nel prototipo e la griglia si scopre da sola; le guide verdi restano (l'utente non ha chiesto altro).
- 2026-11-10 · n6 · T71 integrato con guide d'accento e punti della griglia ogni 8 px, accesi di serie come dice il piano; l'aspetto (densità dei punti, griglia accesa di serie) è chiesto all'utente perché il prototipo T26 non lo mostra · Perché: è una scelta visibile su ogni lavagna, e il prototipo approvato ha lo sfondo liscio.
- 2026-11-10 · n6 · L'utente sceglie (a) per il tratto libero negli appunti lasciato fuori da T68: un campo `fub:ink` alla radice della forma, versione sempre 1; task nuovo T94, dopo il lazo (T86) · Perché: è la stessa forma del livello della radice del `.canvas`, e chi non conosce il campo lo ignora senza rompersi.
- 2026-11-10 · n6 · L'utente sceglie (a) per il doppio clic su una scheda mancante o illeggibile (diagnosi di T91): «Ritrova…» o «Apri» al posto del campo del percorso; task nuovo T93 · Perché: il campo del percorso lì non aiuta, i pulsanti di T16 dicono già che cosa fare.
- 2026-11-10 · n6 · T74 integrato: il selettore va sotto la scheda dove a destra non c'è posto, la lista non è virtualizzata, le sezioni si scrivono nell'ordine della nota · Perché: sotto è la variante approvata a 700 px; `kit/list` non virtualizza e 300 righe reggono; l'ordine della nota è quello che la scheda mostra.
- 2026-11-10 · n6 · T56 integrato: Alt+← e Alt+→ restano di `shell.pane.back`/`forward`, che chiedono prima alla lavagna e poi passano alla cronologia del riquadro · Perché: un tasto, un proprietario; un secondo comando sulla stessa chiave avrebbe litigato col registro dei tasti.
- 2026-11-10 · n6 · T59 diviso in due passate (opzione c): prima l'ispettore con una porta finta, poi, dopo T69, tre metodi pubblici del motore (`selection()`, `doc()`, `commitPatches()`) e il cablaggio nella superficie; «Avanzate» resta dentro «Scheda» come nel prototipo · Perché: il motore era in mano a T69 e T53; un commit e un annulla passano da `#commit`, senza una seconda strada per scrivere.
- 2026-11-10 · n6 · T72: «Spargi le pagine…» resta accesa finché un PDF non si è rivelato illeggibile, poi si spegne col perché; la soglia della conferma (200) conta le pagine scelte · Perché: il menu si costruisce senza aspettare pdf.js, e la conferma serve a non creare troppe schede, non a giudicare il file.
- 2026-11-10 · n6 · T91 aggiunto al piano dopo il collaudo dell'area 12, e fatto: i gruppi stanno sempre sotto i fili, le prese di riattacco sopra i punti, la scheda PDF chiude il task di pdf.js 6 · Perché: erano difetti visti sulla 1432; l'ordine del file decideva se un gruppo copriva i fili, e un gruppo sotto è ciò che la persona si aspetta.
- 2026-11-10 · n6 · L'utente sceglie (a) per la misura e l'allineamento del testo lasciati fuori da T50: un task nuovo, T92, con un campo `fub:text` accanto a `fub:ink` e `fub:parts` · Perché: il formato resta JSON Canvas, che Obsidian legge, e il campo nuovo sta fra quelli che gli altri programmi conservano o ignorano.
- 2026-11-10 · n6 · L'utente approva i prototipi T27 (la modifica) e T28 (gli estratti) con le varianti consigliate, sapendo che cambieranno più avanti · Perché: sbloccano T41–T46 e T74–T78.
- 2026-11-10 · n6 · T55: Nascondi e Mostra il navigatore sono due comandi del catalogo, non una spunta in un menu Vista che non c'è; i tratti d'inchiostro non contano per i bordi della mappa · Perché: esiste solo ciò che si può usare, e la mappa delle schede resta leggibile.
- 2026-11-10 · n6 · T69: il bordo del tratto in corso è fatto di quattro lati sulla scena e l'etichetta vive nella vista, in coordinate dello schermo; `#render` non toglie `.canvas-ink-frames` né la cornice della scelta di T66 · Perché: il contorno sulla scheda ridipingeva tutta la scena di S8 e creava nodi a ogni tratto; così S8 resta come prima.
- 2026-11-10 · n6 · T53: l'inerzia dopo uno spostamento viene solo dal dito, non dal
  touchpad; + e − e lo zoom della banda non volano, volano i salti (0, Maiusc+1, Maiusc+2).
  · Perché: il touchpad arriva come rotella e la tela non lo distingue dal mouse; un'inerzia
  nostra raddoppierebbe quella del sistema. I passi piccoli col volo sembrano lenti.
- 2026-11-11 · N4 T23 · La seconda misura non chiude la voce del cancello:
  174 ms a penna sul foglio vivo (meta 33), 47 fotogrammi lunghi su 215, di cui
  11 col tratto in movimento, 10 al rilascio e 26 senza evento del puntatore;
  con la GPU sullo schermo vero il numero non scende (168, 180 ms). Come dice
  T23 serve un task prima di T25 che profili il disegno della scheda viva
  sotto la scia e il commit del tratto; il limite degli agenti non prevede un
  pianificatore per N4, quindi la forma del task si chiede all'utente.
  Per N6: al fit della lavagna di S8 (zoom 0,33) la scheda del foglio resta un
  segnaposto, perché `LIVE_ZOOM_MIN` è 0,35; S8 ingrandisce fuori dalla misura
  · fonte: `docs/misure/lavagna-inchiostro-foglio-2026-11-11.md`.
- 2026-11-09 · N4 T15 · Nessun task prima di T23 per i 205 ms a penna e
  gli 879 ms alla posa della scheda (S8, caso simile, Xvfb in software).
  Perché: la posa costa perché `#render` rifà tutte le schede, e N6 T11 la
  rende a chiavi prima di tutto il resto; una correzione qui andrebbe
  buttata. Il ridisegno sotto la scia pesa per la tabella di testo, che T23
  sostituisce col foglio vivo. T23 rimisura dopo N6 T11 e, se resta oltre
  33 ms, si chiede al pianificatore un task prima di T25, come dice T23.
- 2026-11-09 · N4 (PA T2, fusione di `main`) · `operation.ts` è quello di
  `main` (le toppe le applica il nucleo in WebAssembly) con i tipi della
  toppa `ink` e i costruttori `addStrokePatch`, `eraseStrokePatch`,
  `eraseStrokePatches`; `inkStep` e la copia TS se ne vanno, come diceva
  T17. Le prove dei costruttori, di `ink-record` e dei 28 vettori
  dell'inchiostro leggono e scrivono col nucleo (`openCore`,
  `openCoreNow`); una toppa illeggibile il nucleo la rifiuta come
  `request`, non `invalid` come la copia TS. L'ADR dell'inchiostro diventa
  la 0241 (la 0238 è di `main`, la 0239 di K5, la 0240 di `main`); i
  vettori `ink-*` delle toppe vanno da 87 a 103, dopo gli 86 di `main`, e i
  test dei vettori li ordinano per numero; `fub-canvas-wasm` dà `kind` ai
  due errori nuovi (`UnknownStroke` con `id`, `ForeignLayer`) · è la
  fusione più piccola che lascia verdi i due lati; `ink_layers` nel
  `.wasm` e la fine di `readInkLayers` restano a T17.

- 2026-11-10 · n6 · T66: la cornice di più schede scelte (non disegnata nel prototipo
  T25) è tratteggiata d'accento come il fantasma del rilascio, e i gruppi tengono le
  maniglie anche se il prototipo non le mostra. · Perché: il piano chiede la cornice, e
  senza maniglie un gruppo non si ridimensiona più; il linguaggio è quello già approvato.

- 2026-11-10 · n6 · T58: «prima i gruppi» resta alla lettera, e la regola
  «più di metà» vince sull'esempio del prototipo. · Perché: è quello che
  dice il piano, l'ordine serve anche al lettore di schermo (T61) e una
  regola scritta si prova; l'esempio del prototipo cadeva proprio sul
  confine della metà.

- 2026-11-10 · n6 · T62: «Aggiungi file…» col selettore del browser
  (`<input type="file">`) invece di `host/dialog.ts`. · Perché: il deposito
  vuole dei `File` come un rilascio, `pickFile` dà un percorso solo; lo fa
  già «Importa file…» dell'esplora, quindi non è una strada nuova.

- 2026-11-10 · n6 · T15b: «Fanne una copia» si offre anche quando il
  deposito si ferma a metà, per i file riusati prima dell'errore. · Perché:
  quelle schede nascono come nel deposito riuscito, e negare la copia solo
  perché un altro file è stato rifiutato lascerebbe la persona senza modo
  di separarle.

- 2026-11-10 · n6 · T47 integrato senza il caso del colore sconosciuto, che
  diventa T47b (sul nucleo); tolto il vecchio selettore dei colori della
  barra di N4. · Perché: il rifiuto viene da `validate_color` del nucleo,
  fuori dalla riga «Tocca» di T47; il colore resta raggiungibile dal menu e
  dalla riga delle opzioni con la stessa lista, quindi un secondo selettore
  diverso sarebbe un doppione.

- 2026-11-10 · n6 · T32b integrato con il ricordo di `reuse` tenuto da
  `host/ipc.ts`, fuori dalla riga «Tocca». · Perché: è l'unico chiamante
  di `writeResource` con la vita di una finestra; un globale di modulo
  non si potrebbe azzerare nei test.

- 2026-11-10 · n6 · T17 integrato con l'avviso di «Togli» senza stile suo
  e Ctrl+] che sulla tastiera italiana non si fa. · Perché: nessun file
  della pelle era nel task (lo stile arriva con T22/T89), e cambiare un
  tasto del catalogo è una scelta che il piano non ha fatto: resta scritta
  per chi rivede i tasti.

- 2026-11-10 · n6 · T73 integrato: `fub:parts` ha un lettore TypeScript in
  proprio accanto a quello Rust, tenuti uguali dai vettori comuni; ADR
  0242. · Perché: le schede leggono il campo senza aspettare il `.wasm`,
  e i vettori scritti a mano sono la prova del formato pubblico; il
  numero dell'ADR va ricontrollato quando N4 e N6 arrivano in `main`.

- 2026-11-10 · n6 · T34 integrato; la banda di T52 segue subito
  `canvas.drop_folder` (correzione dell'orchestratore), e l'avviso della
  cartella esclusa uscirà a ogni deposito in una cartella esclusa (in
  T32b, che tocca lo stesso file). · Perché: banda e deposito devono dire
  la stessa cartella; e un avviso solo la prima volta tacerebbe proprio
  quando la cartella cambia verso una esclusa.

- 2026-11-10 · n6 · T52 integrato: la banda dice la cartella dove il
  deposito scrive davvero oggi, non quella che `canvas.drop_folder`
  prometterà con T34. · Perché: una banda che dice una cartella sbagliata
  inganna; T34 cambia il deposito e `dropFolderOf` insieme.

- 2026-11-10 · n6 · T50 integrato senza misura e allineamento del testo,
  in attesa della risposta dell'utente. · Perché: servono un campo nuovo
  nel `.canvas`, formato che leggono altri programmi (Obsidian): è fra le
  cose che si chiedono sempre.

- 2026-11-10 · n6 · T32 diviso in T32 (il riuso chiesto all'host, fatto) e
  T32b («Fanne una copia» con la scheda ripuntata, e il ricordo della
  seduta per l'host senza `reuse`), stesso «Fatto quando». · Perché:
  l'azione richiede una porta in `engine.ts`, che T32 non poteva toccare
  e che T50 e T52 stavano cambiando; T32b parte dopo di loro. Fino ad
  allora, sul ramo, un file già nel vault non si ricopia dalla lavagna.

- 2026-11-10 · n6 · T40 integrato: le battute di una scheda passano dal
  registro delle superfici della finestra (`onChange` con un id
  `card-editor:<n>`) e la porta le smista, invece di un registro a parte.
  · Perché: una sola strada per le modifiche, la stessa dei riquadri;
  i due casi rari della rinomina e di `release` diretto restano scritti
  nello `Stato:` per T41, che è il primo a usare la porta.

- 2026-11-10 · n6 · T49 integrato: la colonna degli strumenti affianca la
  barra di N4 invece di toglierla subito, e la sola lettura spegne tutti
  gli strumenti che scrivono. · Perché: il menu della penna e le azioni
  della barra hanno già i loro task (T50, T51), e spostarli qui avrebbe
  rifatto il loro lavoro; spegnere e non nascondere segue il prototipo
  approvato.

- 2026-11-10 · n6 · T31 integrato: il riuso è un parametro esplicito del
  trait `ResourceWrite` (non un default nascosto), e il client rifà il
  deposito senza `reuse` quando l'host risponde `bad_args`. · Perché: la
  forma deve dire sempre che cosa fa un deposito, come `expected`; e un
  host di prima rifiuta il campo che non conosce: per lui è un «non so»,
  e nel dubbio si scrive.
- 2026-11-10 · n6 · T48 integrato. (1) I tasti valgono solo coi
  modificatori scritti, anche se Ctrl+Maiusc+A e Alt+frecce smettono di
  fare ciò che facevano. (2) «Entrare e uscire», «La rotella» e «Comandi e
  tasti» passano da `canvas-cards.md` a `canvas-input.md`. · Perché: (1)
  un tasto con un modificatore in più è un altro tasto, e Alt+← è
  Indietro dello Scrittoio (ADR 0223); (2) con T35 e T48 la pagina era a
  573 righe su 550, e quelle tre sezioni parlano della tela, non dei
  renderer.
- 2026-11-10 · n6 · T35 integrato così com'è: anche in `pan` le righe e
  le pagine della rotella si convertono in pixel. · Perché: un mouse che
  manda righe spostava la lavagna di pochi pixel a scatto; la conversione
  è la stessa della lavagna del grafo.
- 2026-11-10 · n6 · T30 integrato: l'impronta calcolata da «lo stesso
  contenuto» si registra con un append fuori dal lucchetto del workspace,
  dopo aver riosservato il file e riletto la coda, invece di rientrare
  nella custodia come diceva il piano. · Perché: è la stessa disciplina
  che `EntryStore::store` già segue (0067) per un dato ricostruibile; il
  caso peggiore è un'impronta persa o una voce vecchia, che la prossima
  scansione rifà, mai una risposta sbagliata (i byte decidono sempre).
- 2026-11-10 · n6 · T33 integrato: il campo «Strumenti della colonna» usa
  le caselle a chip della skin (come `draw.toolbar`), non le caselle
  grigie del prototipo, e a valore vuoto mostra accesi i sette strumenti di
  serie. · Perché: `.setting-features` è condiviso con `draw.toolbar`,
  l'esclusione della sincronizzazione e gli indirizzi permessi; cambiarlo
  per una riga li cambierebbe tutti, e il pannello deve avere un solo
  aspetto per le liste. Le caselle accese dicono che cosa c'è davvero.
- 2026-11-10 · n6 · T36 integrato: la vista ricordata si applica quando
  arriva, ma solo a ciò che nessuno ha cambiato dall'apertura (camera,
  scelta); se la lettura fallisce non si scrive fino alla prossima
  apertura. Le rinominate ripartono dalla vista intera e lasciano una
  chiave orfana: la shell non porta gli stati di vista con il nome. ·
  Perché: lo stato si legge in modo asincrono e non deve coprire un gesto
  dell'utente né uno stato di un'altra versione; spostare gli stati con il
  nome è lavoro della shell, fuori da T36.
- 2026-11-10 · n6 · T33: (1) `canvas.toolbar` si registra in
  `panels/settings.ts` come `draw.toolbar`, con le caselle del prototipo
  approvato (il piano diceva che il pannello disegna le righe da sé, ma per
  le liste serve la registrazione). (2) Un `canvas.drop_folder_path` che
  non vale (vuoto, `..`, assoluto, dentro `.fub/`) vale `Allegati`, il
  valore di serie della chiave; il testo approvato della riga non cambia,
  e a dire dove sono andati i file ci pensa la notifica di T34. T34
  aggiornato: la cartella delle note solo se la pulizia svuota il percorso.
  Perché: fedeltà al prototipo approvato, e una regola sola per il valore
  che non vale (quella di ogni impostazione: vale quello di serie).

- 2026-11-10 · n6 · T16: se il file torna o la scheda cambia mentre
  «Ritrova…» è aperto, la scelta si scarta. Perché: regola di CLAUDE.md,
  un risultato vecchio non sovrascrive lo stato nuovo; il file tornato
  rimonta già la scheda da sé. Primo task di un Haiku a effort xhigh:
  diff pulito, un commento vecchio in `cards.ts` sistemato da me.

- 2026-11-10 · n6 · T14 provato in un Chromium vero (link non seguiti
  fuori dalla scheda attiva, Ctrl+clic li segue, rotella dentro e fuori,
  Esc, visore dell'immagine, «Apri»): un difetto, corretto prima di
  chiudere (il fuoco andava al link e non alla scheda). Perché: i test di
  jsdom non vedono il fuoco vero; la prova nel browser sì.

- 2026-11-10 · n6 · T15 integrato senza il caso «l'host rifiuta un file a
  metà»: va al task nuovo T15b, dopo T32 e T34. Perché: serve un errore
  tipizzato in `canvas-intake.ts`, che T15 non poteva toccare e che T32 e
  T34 cambiano prima; farlo dopo di loro evita conflitti, e intanto
  l'errore si vede come prima (nessuna scheda nasce, i file copiati restano
  nel vault). Ho anche rimesso al suo posto il commento di `isVaultPath`,
  spostato per sbaglio sopra `measuredImage`.

- 2026-11-10 · N6 · T14 integrato tenendo Ctrl+trascinare per spostare
  la lavagna (il piano diceva che Ctrl+clic «oggi aggiunge alla scelta», il
  codice invece sposta): Ctrl+clic senza movimento aggiunge o toglie dalla
  scelta, Ctrl+clic su un link lo segue · Perché: togliere uno spostamento
  che c'era è un cambio non chiesto; così valgono tutte e tre le cose. Una
  scheda ferma ha il contenuto `inert`: Ctrl+clic sui suoi link non li
  trova (solo le schede vive, cioè in vista, li seguono).
- 2026-11-10 · N6 · T13 integrato con gli scostamenti del coder: la
  scelta delle schede vive si rifà anche dopo ogni resa e con lo zoom da
  pulsanti e tasti; la lavagna conta nascosta se un antenato è `[hidden]` o
  `checkVisibility()` è falso (una vista nascosta con `visibility` o fuori
  schermo resta trattata come visibile: le schede in vista restano vive,
  niente si perde); la sezione nuova della pagina si chiama «Quando la tela
  cambia il modo», per non confondersi con «Schede vive e ferme» · Perché:
  ogni cambio di camera e di documento deve finire in una scelta nuova, e
  il caso scoperto costa solo memoria.
- 2026-11-10 · N6 · T29 integrato seguendo «Cosa fare» e non il «Fatto
  quando»: le misure di nascita si arrotondano a interi anche per PDF e
  immagini (PDF 360×509, non 512), e il test di T9 che le agganciava è
  riscritto; anche il rettangolo del gruppo resta coi lati interi, non
  multipli di 8. Superano il registro del 2026-11-02 («480×304»,
  «agganciate a 8 px») · Perché: è A-16 (le misure di nascita non si
  agganciano, le posizioni sì); il «Fatto quando» aveva contato solo il
  foglio.
- 2026-11-10 · N6 · T28 fatto, da approvare: `PLAN-ui/lavagna-estratti.html`
  con otto stati (selettore di nota e di PDF, blocchi, scheda-estratto,
  lettore, fonti, ritaglio, menu) e quattro note «Da decidere guardando»
  (consigliate: al rilascio, la testata con le parti, «Mostra tutto il
  file» nel menu, sotto la scheda a 700 px); una lavagna senza file dice
  una riga nella linguetta Fonti invece di togliere la sezione. · Perché:
  A-26 vuole la pagina prima di T74–T85; la quarta nota nasce dal caso
  limite dei 700 px, e una linguetta vuota senza parole sembrava rotta.

- 2026-11-10 · N6 · T12 integrato con due scostamenti accettati: `watch`
  delle schede ascolta `document_changed/removed/renamed` oltre agli
  `entry_*` (una nota cambiata manda solo `document_*`: col solo
  `entry_changed` la scheda non si rifarebbe mai), e `snapshots.forget`
  lo chiama `bootstrap.ts`, che tiene la cache · Perché: il piano diceva
  `entry_changed` pensando ai file senza formato; il comportamento chiesto
  (la scheda segue il file) vuole tutti e due.
- 2026-11-10 · N6 · prototipo T26 (`PLAN-ui/lavagna-impianto.html`)
  approvato con le varianti consigliate: la colonna del disegno con le
  tendine, il navigatore in basso a destra, l'ispettore chiuso la prima
  volta e poi come lo si lascia, sei strumenti nello spazio Semplice; il
  menu delle penne nella riga delle opzioni è solo da guardare · parole
  dell'utente: «accetto i tuoi consigli per tutte e 5». Perché: A-26, da
  qui T49–T65 possono partire quando le loro dipendenze ci sono.
- 2026-11-10 · N6 (A-15) · Riallineato a `piano/n4-inchiostro` @ bd38a567
  (N4 fino a T22 e T15, N3 dentro) prima di T11, con un merge. Conflitti:
  `PLAN.md` e `DECISIONS.md` restano quelli di N6; `i18n/catalog.ts` e
  `docs/README.md` prendono le due parti. Perché: A-15, T11 lavora sopra
  l'`engine.ts` di N4. Prove sul merge: `check.sh --rapido` verde (un
  rosso noto e instabile, `new-drawing.e2e`, verde da solo), vitest intero
  660 file / 11 620 test verdi.
- 2026-11-09 · N6 · prototipo T26 (`PLAN-ui/lavagna-impianto.html`) fatto,
  da approvare: l'impianto della lavagna copia i valori del disegno con
  classi `canvas-*` nuove (`editors/spatial/` non si tocca, K5); il menu
  delle penne di N4 passa nella riga delle opzioni; cinque note «Da
  decidere guardando», consigliate: la colonna del disegno con le tendine,
  il navigatore in basso a destra, l'ispettore chiuso la prima volta, sei
  strumenti nello spazio Semplice · Perché: T49–T65 aspettano la riga
  «Approvato» (A-26).
- 2026-11-04 · N6 · prototipo T25 (`PLAN-ui/lavagna-schede.html`)
  approvato con le varianti consigliate: titolo sopra la scheda (D-21 (a)
  confermata), gemelle con la luce calda, «Esc per uscire» nella testata,
  nomi delle impostazioni come frasi, notifica col percorso, colori come
  oggi (il filo non prende il colore) · parole dell'utente: «preferisco
  quella del piano originale. Mi piace il piano in schede della lavagna».
- 2026-11-03 · N6 · merge di piano/n4-inchiostro (509772da) in
  piano/n6-lavagna, come chiede A-15 prima di T11: PLAN.md resta quello di
  N6, DECISIONS.md tiene le voci dei due rami in ordine di data, PLAN-
  ui/lavagna-penne.html resta solo su N4; la PR #302 ora punta a
  piano/n4-inchiostro. · Perché: T11, T73 e gli altri task che usano fub-
  canvas-core e fub:ink hanno bisogno della base di N4.
- 2026-11-03 · N6 · le risposte dell'utente alle domande nuove: D-20 (a), i
  CSV in un piano suo che finisce con T88; D-21 (a), il titolo sopra la
  scheda, come Obsidian (da rivedere sul prototipo T25; N4 lo usa per il
  riquadro dell'inchiostro); D-22 (a), lazo e forme adesso sull'inchiostro
  di N4 · le consigliate, accettate dall'utente («ci sto»).
- 2026-11-03 · N4 · D-13 (a), nuova: il cursore dello spessore anche nei
  disegni e nei documenti, non solo sulla lavagna; il task lo scrive il
  pianificatore · parole dell'utente («si»): la stessa penna si usa allo
  stesso modo in tutta Fub.
- 2026-11-03 · N4 · terzo merge di `piano/n3-logica-in-rust` (fino a N3 T17
  e alla fusione di main con #303, `async-executor` 1.14.1) dentro
  `piano/n4-inchiostro`; PLAN.md resta quello di N4 e DECISIONS.md tiene le
  righe di tutti e due · senza main la versione ritirata 1.14.0 teneva rosso
  il controllo delle librerie, e N4 riceve main solo attraverso N3.
- 2026-11-02 · N6 · Le risposte dell'utente a D-1…D-19 (e merge-n3n4,
  ci-soglia): la v1 intera di `lavagna.md` (gli estratti di PDF aspettano
  PdfCraft); i file trascinati vanno dove dice un'impostazione della
  lavagna, che di serie segue quella delle note; «già nel vault» vuol dire
  lo stesso contenuto ovunque, con l'impronta come dato derivato, i byte
  provati uno per uno e dei limiti, e nel dubbio si copia; la pagina del PDF
  sta nello stato della vista; l'inchiostro si attacca alla pagina e alla
  cella; si scrive dentro le schede, sulla stessa sessione del riquadro; S9
  nasce accanto a S3; i sei colori e in più ogni colore esatto; il CSV
  aspetta il motore dei fogli (D-20); la rotella ha un'impostazione;
  Ctrl+clic apre un link; il foglio nasce 480×300; N6 va avanti sopra il
  ramo di N4 e si fonde dopo N3 e N4, con la CI completa e la revisione
  (T90). Restano D-20, D-21 e D-22 · l'utente ha risposto, e dove la
  risposta lasciava la scelta il piano ha preso la strada più sicura: nessun
  byte perso, nessun formato rotto, Obsidian vede la stessa lavagna.
- 2026-11-02 · N6 · T10: le porte della lavagna stanno in `state/canvas-
  intake.ts`. Dall'albero si tengono solo gli id che l'host conferma: una
  domanda sola a `existingDocuments` per tutte le voci, e per i file che
  l'indice dei documenti non conosce (immagini, PDF) una domanda
  `vaultEntries` per cartella invece di un `resourceOpen` per file; una nota
  non confermata si scarta. Dal computer ogni file passa da
  `depositOrReuse`; le notifiche («N file già nel vault, uso quelli», e la
  prima volta «Copiati in cartella/» con «Cambia cartella») dicono anche ciò
  che è stato fatto prima di un errore. `revealSetting` sceglie la scheda
  dalla chiave (permessi → Componenti, scorciatoie → Scorciatoie, il resto →
  Impostazioni) e apre un eventuale `<details>`. Resta in `engine.ts` (fuori
  da T10): se nessuna voce dell'albero è confermata e il trascinamento porta
  anche `text/plain`, nasce una scheda di testo. Perché: un trascinamento è
  un dato che chiunque può scrivere, e un file non si copia due volte.
- 2026-11-02 · N6 · T7: la scheda di foglio legge solo le finestre di celle
  in vista (al massimo 256×128, scorrimento a righe e colonne intere), riusa
  paintCell e le classi del foglio, chiude la sessione da ferma e a destroy
  una volta sola e non chiama mai applyGridBytes; Stale arriva come errore
  "conflict" e si riprova una volta. La copia: in produzione
  writeClipboardText scrive con navigator.clipboard, che non accetta
  un'attesa, quindi la selezione si allarga solo su celle già lette e Ctrl+C
  non scrive niente se ne trova una non letta (l'orchestratore ha rimandato
  indietro la prima versione, che copiava vuote le celle mai lette). In v1
  non mostra grafici, immagini, barre di dati, icone, commenti, riquadri
  bloccati né lo zoom; il bordo d'accento e «Esc per uscire» li disegna la
  tela (data-card-entered). Perché: una copia non deve mai contenere dati
  diversi dal file.
- 2026-11-02 · N6 · T9: le schede portate sulla lavagna nascono in griglia
  per righe (ogni colonna larga quanto la sua scheda più larga), ordinate
  per nome e poi per percorso, agganciate a 8 px e mai sotto 40; il foglio
  nasce 480×304 invece di 480×300 di D-11, perché 300 non è multiplo di 8;
  un'immagine senza misura nasce 480×360 (4:3); un PDF largo 360 con
  l'altezza della prima pagina (senza misura 360×480); un file Craft
  320×160. DROP_SNAP e DROP_MIN_SIZE copiano le costanti di engine.ts (che
  porta il DOM) e un test le tiene uguali. Perché: tutto ciò che nasce sta
  sulla griglia della tela.
- 2026-11-02 · N6 · T8: la scheda web non fa richieste da sé: mostra
  indirizzo e dominio, e l'anteprima solo con «Mostra l'anteprima» (una
  richiesta per clic); l'icona passa solo se è un data: di immagine raster
  (la regola di safeIcon delle note, perché isAllowedLink ammetterebbe icone
  http che farebbero rete); un'anteprima fallita resta sobria, col motivo
  nel suggerimento e il pulsante per riprovare; un indirizzo non valido non
  ha pulsanti. Tutte le schede dicono lo stato in data-card-state e la
  specie in data-card-kind (allineate dall'orchestratore: l'immagine usava
  data-state). Manca una chiave «Scarico l'anteprima…»: per ora «Apro…».
  Perché: una lavagna aperta non contatta nessun sito senza che lo si
  chieda.
- 2026-11-02 · N6 · T6: la scheda PDF disegna la pagina in un canvas fuori
  dal DOM e la copia in quello visibile (la cache chiude le immagini che
  scarta), larga scheda × zoom × densità, al più 2× la scheda; la parte in
  cache è snapshotPart("page-N", larghezza); la pagina di partenza viene da
  #page con pdfPageFromFragment di pdf-view.ts; PgSu/PgGiù/Home/Fine senza
  modificatori; un PDF rotto o cifrato dice «Non riesco a mostrare…». Da
  decidere in T12/T13: un cambio di zoom ridisegna solo se la tela chiama
  resize() o setMode. Perché: una scheda ferma resta leggibile senza tenere
  aperto il motore PDF.
- 2026-11-02 · N6 · T5: la scheda d'immagine riduce alla misura della scheda
  con una sola decodifica (per JPEG, WebP e BMP la larghezza si legge
  dall'intestazione), tiene in cache la parte `whole@<larghezza>` come dice
  canvas-cards.md, mostra l'SVG solo come <img> da blob (mai svg o script
  nel DOM) e, dipinto, lo tiene in cache come canvas; oltre 64 MiB, HEIC e
  AVIF dicono «Non riesco a mostrare…» con «Apri». Rischio: il canvas della
  scheda è una copia del bitmap in cache, quindi la memoria per scheda viva
  raddoppia; lo stile delle classi nuove spetta a T12/T22. Perché: una foto
  grande non pesa sulla tela più della sua scheda.
- 2026-11-02 · N6 · T4: la scheda di nota non rende da sé ma chiede alla
  shell (NoteCardPort.show, più watch e un open facoltativo per «Apri»);
  ogni accensione rifà la resa, una scheda ferma non tiene ascoltatori e
  mostra la resa di prima inerte, un contatore di generazione scarta le
  risposte tardive; lo stato sta in data-card-state; `#A#B` mostra la
  sezione più interna. Perché: la tela non importa l'editor di testo e la
  scheda legge senza mai scrivere il file.
- 2026-11-02 · N6 · T3: depositOrReuse riusa un file già depositato con gli
  stessi byte (ricevuta ReusableReceipt, esito SameFile) invece di
  duplicarlo. Perché: incollare due volte la stessa immagine non riempie il
  vault di copie.
- 2026-11-02 · N6 · T1: il contratto delle schede
  (`editors/canvas/cards.ts`, `docs/reference/canvas-cards.md`). PenQuiet
  non c'è ancora in main: `cards.ts` ha un tipo strutturale suo, `CardQuiet
  { defer(key, work) }`, con la chiave `cards`. `snapshotPart` dà sempre
  `prefisso@larghezza` (multiplo di 32, minimo 32). «Più vicine al centro»
  si misura dal centro della vista al punto più vicino della scheda; se un
  `setMode` lancia, le altre schede cambiano lo stesso e l'errore esce alla
  fine; lo stesso renderer che nomina due volte una specie non è un
  doppione.
- 2026-11-02 · N6 · T2: la cache delle immagini ferme
  (`editors/canvas/card-cache.ts`) ha un tipo suo, `CardCacheSnapshot`,
  uguale per forma a quello del contratto di T1 senza importarlo; percorso e
  parte restano chiavi separate (mai unite in una stringa); rimettere la
  stessa immagine sotto la sua chiave non la chiude; un tetto negativo o NaN
  vale 0, i byte 0, negativi o NaN contano 1. Il tetto di 64 MiB è un valore
  di partenza.
- 2026-11-02 · N4 · T20: l'utente approva il prototipo delle penne con una
  modifica: lo spessore si sceglie con un cursore (la penna da 0,5 a 20
  pixel, l'evidenziatore da 4 a 48), non con Sottile, Medio e Spesso;
  A19–A23 valgono; nei disegni e nei documenti restano i tre spessori finché
  l'utente non dice altro · l'ha chiesto guardando il prototipo, e un
  cursore dà più scelta; il prototipo ora fa anche scrivere col mouse,
  perché l'utente voleva provare le penne e non solo guardarle.
- 2026-11-02 · N4 · Le risposte dell'utente a D-1…D-11: il posto
  dell'inchiostro si decide dopo la prova con Obsidian (fino ad allora il
  `.canvas`; D-12 se si perde); il menu delle penne e la gomma che taglia
  già in N4, dopo il prototipo; due impostazioni spente di serie (ricorda
  «Scrivi col mouse», il dito sposta le schede); su immagini e PDF
  l'inchiostro scala senza deformarsi, sulle altre schede resta fermo; due
  misure, la seconda sul foglio vero con N6; N4 in `main` solo dopo N3, con
  la CI completa · D-1, D-4–D-7, D-9, D-10 e merge-n3n4 sono diverse dalla
  prima opzione con cui il piano era andato avanti: task nuovi T17–T25, T4
  e T5 da rivedere.
- 2026-11-02 · N4 · T11: la toppa ink nel client sta in `operation.ts`, con
  i costruttori dei tratti e `eraseStrokePatches` per la gomma; i vettori di
  T10 passano anche dal lato della shell. `operation.ts` e `ink-record.ts`
  si importano a vicenda, ma usano i valori dell'altro solo dentro le
  funzioni, mai al caricamento del modulo, quindi il ciclo non rompe
  l'ordine ESM. Perché: la tela e il nucleo devono costruire la stessa
  toppa.
- 2026-11-02 · N4 · T10: la toppa `ink` e le operazioni
  `add_strokes`/`erase_strokes` stanno nel nucleo; l'id di un tratto nuovo
  nasce dal seme dell'operazione, così due giri con lo stesso seme danno lo
  stesso file. Due errori nuovi, `E_OP_UNKNOWN_STROKE` ed
  `E_OP_FOREIGN_LAYER`, con le frasi anche in `fub-features` (lavagna.rs e
  lavagna/apply.rs), che altrimenti non compilava. `source.rs` non si tocca:
  il test prova che gli array annidati si accoppiano già per id. I vettori
  ink sono numerati 46–62, dopo il 45 di N3, per non avere doppioni dopo la
  fusione. Misura: su una scheda con 2000 tratti spostare la scheda dà una
  toppa d'annulla di circa 6 MB mentre il file cambia di 1 byte; un tratto
  nuovo aggiunge circa 1,5 KB al file. Perché: un agente deve poter
  aggiungere e cancellare tratti con la stessa strada dell'annulla.
- 2026-11-02 · N4 · T8: l'inchiostro fub:ink sta in fub-canvas-core (modulo
  ink), che ora dipende anche da fub-ink-codec; i campi noti di un tratto
  sono Option<Value>, così un tratto non valido si conserva com'era e il suo
  stato si calcola a parte (Drawn o Kept con il perché); la versione del
  livello resta il Number del file (1.0 resta 1.0). Aggiunti
  InkAnchor::card_of/to_value e InkLayer::is_bare per T10. Perché: leggere
  l'inchiostro non deve mai riscrivere ciò che non si capisce, e 28 vettori
  danno lo stesso esito del TypeScript.
- 2026-11-02 · N4 · T6: il codec dell'inchiostro in un crate suo,
  `fub-ink-codec`, spostato con git mv; fub-scene lo riesporta e non dipende
  più da fub-ink (`SCENE_ALLOWED_DIRECT=[fub-ink-codec, quick-xml, serde]`,
  `INK_ALLOWED_DEPENDENTS=[fub-ink-codec, fub-format-rich]`,
  `INK_CODEC_ALLOWED_DIRECT=[fub-ink]`, clienti `[fub-scene,
  fub-canvas-core]`); in overview.md un quinto diagramma, perché il primo
  era già a 20 nodi · la lavagna e il disegno leggono l'inchiostro dallo
  stesso codec senza tirarsi dietro la scena. Nel check, fub-cli
  `second_process_cannot_take_writer_and_sigint_exits_repl` è caduto per il
  timeout di 10 s sotto carico e passa da solo (3 su 3); i commenti TS
  dicono ancora «di fub-scene».
- 2026-11-02 · N4 · secondo merge di `piano/n3-logica-in-rust` (fino a N3
  T7, il commit e i vettori delle toppe) dentro `piano/n4-inchiostro`;
  PLAN.md resta quello di N4 e DECISIONS.md tiene le righe di tutti e due:
  senza il merge la PR #298 era in conflitto con la sua base e la CI non
  partiva.
- 2026-11-12 · Scrittoio 2 T26 · S3 restava rosso anche con l'ombra senza sfocatura (1235–2332 ms in tre corse): le corse CI con la cronologia dei fotogrammi (rami `prova/s3-*`) mostrano che il buco cade prima del primo `pointerdown`, nel primo disegno delle 300 schede (lavagna ferma a 1798 ms su main, 2582–2636 sul ramo), e che lo spostamento costa uguale (130–210 ms a fotogramma). Togliere `translateZ(0)` da `.pane::before` non accorcia l'apertura (2718 ms) e porta S1 a 537 ms: lo strato resta. Il difetto è di S3, che misurava dalla prima scheda: corretto in main con la PR #342 (`S3.apertura` solo referto). Baseline dell'ombra nuova dal runner (c965ede72, run 43160817254): 137 scene chiare, cambia solo l'anello dell'ombra. Il merge finale lo decide l'orchestratore, non più l'utente · parole dell'utente: «ma non eravamo d'accordo sul fatto che i merge li decidevi tu?». Delle cinque domande di gusto resta aperta solo il vassoio della barra a una riga e della colonna (vedi 2026-11-04).
- 2026-11-11 · Scrittoio 2 T26 · la WebView del runner era rossa due volte su S3 (massimo fra fotogrammi 1754 e 1806 ms, soglia 1600; main 471): rilanciata una volta, poi indagata; la causa è la `box-shadow` sfocata a tre strati del foglio (T27), che WebKit senza GPU ridipinge a ogni passo della camera (~20 ms a fotogramma); ogni strato sfocato diventa una pila di ombre nette (`sharpLayers` in `recipe.ts`), stessa forma entro pochi livelli di colore; misura con la WebKitGTK di Playwright: max 74→49 ms (main 58) · Perché: l'utente vuole l'app «estremamente fluida» e il foglio con l'ombra approvata si tiene uguale a occhio.
- 2026-11-05 · K2 · Il componente «File delle app Craft» (`fub.craft`, N7,
  arrivato da main) entra nella tabella degli editor dei componenti come
  `editors/craft`: la sua scheda si registra solo col componente acceso, e
  un `.vectorcraft`, `.pcraft`, `.figcraft` o `.xmp` a componente spento si
  apre «solo come file» invece di «Nessuna superficie disponibile», come i
  file degli altri componenti. Una foto RAW resta com'era in main (senza il
  componente non ha vista), perché non ha un formato del vault. I profili non
  toccano il gruppo «Disegnare», quindi `fub.craft` resta acceso anche con
  «Solo note». Aggiunta la descrizione che mancava · fonte: l'orchestratore
  durante l'allineamento a main.
- 2026-11-05 · K2 · Allineato a main, dove la lavagna è diventata il bundle
  `fub.lavagna` (feature cargo `lavagna`): il suo stato sta in
  `plugins.disabled` come per ogni bundle, e `components.off` resta solo per
  il PDF. Spenta, l'host non registra nemmeno il formato `.canvas` (letto da
  `plugins.disabled` prima del montaggio) e riaccenderla rimonta il vault.
  Niente migrazione: K2 non è mai uscito. Riaccesa, `plugins.disabled` resta
  scritto vuoto come per ogni bundle, e il cancello lo conta come assente ·
  fonte: l'orchestratore durante l'allineamento a main.
- 2026-11-08 · fub-pre-alpha (orchestratore) · PA T40 si integra anche se
  10.000 icone cambiate si ridisegnano in 18–35 ms (headless, macchina
  carica) e non sotto i 16 ms del piano · il ridisegno è già un passaggio
  solo con un modello per nome, il costo resta nel DOM, e la shell vera ha
  qualche centinaio di icone; il limite di 512 nomi resta, e S2 T14, che ne
  aggiunge, guarda il margine (oggi 440).
- 2026-11-08 · fub-pre-alpha (orchestratore) · la correzione del difetto
  di PA T47 trovato dalle baseline del runner (la maniglia del cassetto a
  44 px) la faccio io, e le esclusioni della regola dei 44 px stanno in
  `:not(:where(…))` · è una riga, il difetto è di peso dei selettori, e un
  `:not(.classe)` avrebbe tolto a ogni classe del telefono il diritto di
  smentire la regola.
- 2026-11-08 · fub-pre-alpha (orchestratore) · in PA T61 anche
  `Cargo.lock` fa partire la CI Mobile; le righe `cfg` del telefono nei
  crate comuni no · un aggiornamento delle dipendenze Tauri può rompere
  solo Android o iOS ed è raro; i crate comuni cambiano spesso, e quelle
  righe si provano sul push in `main`.
- 2026-11-08 · fub-pre-alpha (orchestratore) · PA T47 si allarga al
  pallino dello stato della testata dei documenti (`pane-standing-chip`),
  che la regola dei 44 px faceva diventare un cerchio · è lo stesso difetto
  della stessa regola, e il task nasce per toglierlo.
- 2026-11-08 · fub-pre-alpha (orchestratore) · PA T39 non si integra finché
  la regola dei caratteri, scritta in Rust e in TS, non è legata dal mirror
  delle regole (`rules_mirror.rs`) · due copie senza legame divergono, e il
  repo ha già il posto per legarle.
- 2026-11-08 · fub-pre-alpha (utente) · l'orchestratore decide da solo
  anche il merge in `main` e le scelte che prima chiedeva, con la soglia
  più alta di «Decide da solo, con più cura»; restano all'utente solo le
  prove con persone, licenze e segreti, e la pubblicazione della
  pre-release · l'utente vuole il risultato migliore senza aspettare le sue
  risposte, tenendo sicurezza e affidabilità.
- 2026-11-08 · fub-pre-alpha (utente) · nuovo task PA T61: i `paths` di
  `mobile.yml` coprono anche la cornice del telefono · una PR che cambia
  solo `shells/scrittoio/mobile/` non costruiva l'APK (trovato da PA T8).
- 2026-11-08 · fub-pre-alpha (orchestratore) · PA T35 accolto con le sue
  differenze: il fascio porta `inherited: { skin }` e un `extends` senza di
  esso è rifiutato; la pelle di serie ereditata non ripassa dal
  sanificatore; `replaceTheme` inserisce prima del primo canale dopo
  `pelle-tema`, quindi senza preferenze i frammenti restano ultimi (prima
  la pelle finiva dopo di loro) · la serie è codice nostro, e l'ordine
  dichiarato dei canali deve valere anche quando un canale manca.
- 2026-11-08 · fub-pre-alpha (orchestratore) · PA T60 si allarga alle 4
  sonde di test di `crates/fub-host/src/session.rs`, fuori dal suo `Tocca`
  · hanno lo stesso schema a un colpo solo delle cadute, e nessun altro
  task toccava il file; il codice vero di `session.rs` non cambia.
- 2026-11-08 · fub-pre-alpha (orchestratore) · nuovo task PA T60: tutte
  le prove che aspettano libero il lucchetto del workspace lo chiedono con
  una scadenza, come quelle corrette da PA T19; quelle che lo aspettano
  preso restano a un colpo solo · due prove dello stesso schema sono cadute
  dopo T19 (in locale e su macOS nella CI della consegna 1), e la
  pre-alpha chiede la CI completa verde sul commit del tag.

- 2026-11-08 · fub-pre-alpha · dove le persone leggono, «FubDraw» diventa
  «Fub» o «il disegno» (frasi della shell, dei disegni, dei descrittori dei
  formati e degli errori che arrivano alla shell, in italiano e in inglese);
  resta solo come nome tecnico del formato, una riga nell'«Ambito» di
  `docs/reference/scene-format.md` e una nota in coda all'ADR 0203, che non
  si riscrive; una guardia in Vitest e due test Rust lo tengono fuori (PA
  T33) · D14 A dell'utente (2026-11-07): FubDraw vive dentro Fub e la sua
  app è archiviata (ADR 0231)

- 2026-11-08 · fub-pre-alpha · un file senza permesso di scrittura (0444
  su Unix, l'attributo di sola lettura su Windows) non si sovrascrive: il
  kernel rifiuta con `PermissionDenied` tipizzato e i byte restano (nuovo
  task PA T59) · T13 ha trovato che oggi su Linux il rename del salvataggio
  atomico lo sovrascrive; alla domanda fra rifiutare e scrivere lo stesso
  l'utente: «Rifiutare (Consigliato)»

- 2026-11-08 · k3-motori · il piano è concluso: #295 è in `main`
  (fb722164) col sì dell'utente, e `PLAN.md` e
  `PLAN-ui/menu-comandi-fogli.html` escono da `main` come per gli altri
  piani conclusi · erano entrati con l'unione, e ogni ramo di piano aperto
  andava in conflitto su `PLAN.md` a ogni allineamento con `main`.

- 2026-11-08 · fub-pre-alpha (orchestratore) · PA T1: il finto del banco
  porta tutto il gruppo Aspetto dell'host (18 voci, nell'ordine di
  `appearance_settings`), non solo «Animazioni»; lo stato `aspetto` del
  simulatore ne mostra meno, ed è una differenza del simulatore · il task
  chiede «le voci che mancano», e ne mancavano nove: il finto deve dire
  quello che fa l'host, i testi vengono dai cataloghi Rust.

- 2026-11-08 · fub-pre-alpha · da 0.2.0 in poi un `enum` o un `variant`
  che attraversa il confine non prende casi nuovi, e un'interfaccia
  esportata dal plugin non prende funzioni nuove: le novità arrivano con
  interfacce nuove, come per i record; la guardia, l'ADR 0235 e i commenti
  di `abi.wit` lo dicono (nuovo task PA T58, che prova prima anche gli
  import) · T7 ha provato con componenti veri che l'una e l'altra cosa
  impediscono di caricare un plugin già compilato; alla domanda fra
  stringere la guardia e scriverlo solo nella pagina l'utente: «non importa
  quanto tempo ci vorrà, meglio la qualità»

- 2026-11-08 · fub-pre-alpha (orchestratore) · #295 unita in `main` col sì
  dell'utente (fb722164); i file del piano K3 entrati con lei escono da
  `main` con #316 (PLAN.md e PLAN-ui erano in conflitto con ogni ramo di
  piano); gli altri rami si allineano a `main` dopo #316 · l'utente: «Sì,
  unisci #295»

- 2026-11-08 · fub-pre-alpha (orchestratore) · ogni componente
  d'esempio (`esempi/*/Cargo.toml`) e `tools/varco-wasm` ha un
  `[workspace]` suo, vuoto (844c5f5b) · i coder lavorano in worktree
  annidati sotto `~/Progetti/Fub/.claude/worktrees/`: lì cargo risaliva al
  `Cargo.toml` del checkout esterno, che non li elenca, e i passi WASM di
  `check.sh` cadevano. Il comportamento fuori dai worktree annidati non
  cambia (erano già esclusi dalla radice). Serve prima di PA T7, che prova
  un componente vero.

- 2026-11-08 · fub-pre-alpha (orchestratore) · PA T3 si divide in due
  parti fatte dallo stesso coder: prima `fub-kernel` dà ai comandi in sola
  lettura (`!spec.scope.writes`) un frame tutto loro (niente batch, nessun
  cambio dell'attore condiviso, `in_provider_call` giù, la ricorsione
  controllata nel prepared, mai undo), poi `fub-host` toglie loro il turno;
  il perimetro si allarga a `workspace.rs` (e `jobs.rs` se è lo stesso
  schema); il «Fatto quando» non cambia; un comando che scrive in DryRun
  tiene il turno · il coder ha trovato che il frame di `prepare` vive nello
  stato condiviso fino a `finish` ed è il turno a isolarlo: senza turno gli
  eventi di una scrittura parallela restavano chiusi nel batch della
  lettura, e due letture MCP insieme si rifiutavano a vicenda. Il «Non
  toccare `fub-kernel`» del piano partiva da un'ipotesi sbagliata.

- 2026-11-08 · fub-pre-alpha (orchestratore) · la prima coppia è PA T3 e
  PA T4, non T3 e T13 come dice l'ondata; PA T13 parte quando #295 è in
  `main` · T13 chiede di aprire fogli e documenti come la shell, con
  `open_key` e `document_closed` dei motori, che arrivano con #295: fatto
  prima, il corpus coprirebbe metà del percorso e andrebbe rifatto. T4
  invece non aspetta niente, sta in un altro strato (il client) e sblocca
  T5 e T30.

- 2026-11-07 · fub-pre-alpha · il piano è approvato, coi 130 stati
  composti e nuovi del simulatore; resta da confermare solo la licenza del
  logo, prima di PA T49 · l'utente: «Per il resto il piano è approvato»
- 2026-11-07 · fub-pre-alpha · lavorano due coder alla volta, Opus con
  ragionamento medio, e nessun altro agente; il pianificatore del telefono
  (D1 B) lo avvia l'utente · l'utente: «il prompt per l'orchestratore che
  si occuperà di avviare 2 sub-agent per volta, Opus con effort medio che
  saranno i coder»
- 2026-11-07 · fub-pre-alpha (pianificatore) · i task PA si integrano sul
  ramo del piano ed entrano in `main` con rami di consegna
  `pre-alpha/consegna-<n>` (i commit di codice portati da `origin/main`
  con `cherry-pick -x`, la PR pronta con la CI completa, l'OK dell'utente);
  il ramo del piano non si unisce · porta `PLAN-ui/` (13 MB), e la Fase B
  ha bisogno di T48 e della skin facile già in `main`; regole in «Come si
  implementa», «Il ramo, le consegne e i due coder»
- 2026-11-07 · fub-pre-alpha (D20) · la firma di Apple per ora non si fa:
  PA T50 firma solo Windows (SignPath Foundation, o un certificato OV), il
  dmg esce con la firma ad hoc e senza notarizzazione, e «Prova la
  pre-alpha» spiega «Apri comunque» · l'utente: «Quello di Apple per ora ce
  ne freghiamo assolutamente»
- 2026-11-07 · fub-pre-alpha (D28) · Marcuzzo è un disegno dell'utente,
  ritoccato con l'AI in ArtCraft e poi passato in VectorCraft; prima di PA
  T49 l'orchestratore chiede la licenza (consiglio: CC BY-SA 4.0 con la
  nota per i fork) e il modello usato in ArtCraft, e ne legge le
  condizioni · l'utente: «Ho fatto il logo di Marcuzzo. Con l'intelligenza
  artificiale l'ho ritoccato dopo con Artcraft. Vectorcraft.»
- 2026-11-07 · fub-pre-alpha (il logo) · le forme piccole di Marcuzzo
  (minima 24, minima 16 e la simbolica che ne viene) tolgono solo i
  dettagli minuti e non ingrandiscono niente: l'occhio, la pupilla,
  l'occhiolino e il becco restano quelli del disegno · l'utente: «non mi
  piace l'icona con l'occhio strizzato ingrandito»; la prima minima aveva
  l'occhiolino più spesso e la pupilla più grande per leggersi a 16 px
- 2026-11-07 · fub-pre-alpha (il logo) · Marcuzzo, il gufo nella cartella
  dell'utente, è il logo (D26); il gufo ha colori fissi, la cartella e i
  fogli seguono la tinta, il tema e il contrasto con `logoColors()` della
  ricetta, e la cartella e il retro reggono la soglia dei controlli (3, o
  4,5 col contrasto alto) contro `--bg` e `--bg-elev` · l'utente: «la
  cartella dovrà avere il colore del tema scelto […] in modo tale che non si
  vada a sovrapporre il colore attuale con quello di sfondo»; i fondi sono
  quelli dove sta il logo (la barra e l'avvio su `--bg`, le Informazioni su
  `--bg-elev`), e le 42 varianti misurate reggono tutte
  (`logo/misure.json`).
- 2026-11-07 · fub-pre-alpha (il logo) · un tema installato che non
  dichiara `--logo-*` li riceve dalla serie al montaggio (un campo
  facoltativo nuovo di `ThemeSeries`, chiamato da `theme.ts` prima di
  `mountThemeBundle`), non dal caricatore dei temi né da un file del tema ·
  il bundle è già per luce e il contrasto si legge lì; il caricatore non
  conosce la ricetta, e chiedere i colori del logo a chi scrive un tema
  sarebbe un obbligo nuovo nel contratto. I gettoni restano facoltativi.
- 2026-11-07 · fub-pre-alpha (il logo) · l'icona del sistema è Smeraldo
  (scelta del pianificatore, l'utente la può cambiare); Menta è la scala di
  notte della ricetta, Kraft resta fra gli originali · Smeraldo è il verde di
  serie (160) e regge sia su una barra delle applicazioni chiara sia su una
  scura; Menta su una barra chiara si perde.
- 2026-11-07 · fub-pre-alpha (il logo) · la forma simbolica si fa dalla
  forma a 24 px con un filo vuoto di 45 unità dentro la cartella davanti,
  tagliato nell'ordine del disegno (`logo-simbolico.mjs`, valori di
  partenza) · un filo fuori dalla cartella o tagliato dopo tutto il disegno
  mangiava la faccia e l'ala; un filo limitato a una distanza lasciava gli
  angoli seghettati. La cartella davanti si stringe un poco ai lati e sotto,
  e a 16–24 px non si vede.
- 2026-11-07 · fub-pre-alpha (il logo) · D28 resta aperta e PA T49 aspetta
  lei; il consiglio è CC BY-SA 4.0 per i file del logo, con una nota che
  chiede ai fork di cambiare nome e logo · la risposta «A, AI» di prima
  riguardava il primo logo; per Marcuzzo servono lo strumento (le sue
  condizioni d'uso) e la licenza, che sono dell'utente.

- 2026-11-07 · fub-pre-alpha (D19) · i difetti veri del controllo di tutte
  le viste vanno in due task nuovi, PA T56 (la carta del file e il fuoco) e
  PA T57 (i bersagli e i nomi interi), più due punti in PA T47 (le righe
  che si toccano, il tondo della modalità); il simulatore li mostra già
  corretti (`92-prealpha-viste.css`) · un difetto che il coder copia dal
  simulatore torna nel prodotto: si corregge prima, e la guardia di PA T55
  lo tiene lontano.
- 2026-11-07 · fub-pre-alpha (D19) · la carta del file al buio prende
  l'anello, la sintassi e i segni della griglia dai `--paper-*` che ci sono,
  senza ruoli nuovi nel contratto del tema; la formula nella cella in
  modifica è d'inchiostro, come in Excel, e solo i riferimenti hanno colore ·
  un ruolo nuovo è un contratto pubblico (temi di terzi), e la carta ne ha
  già abbastanza; l'utente può chiedere la formula colorata, ma allora
  servono colori pensati per il bianco.
- 2026-11-07 · fub-pre-alpha (D19) · la freccia di un pulsante diviso
  della barra a schede è larga 24 px (prima 14): la fila si allunga di 10 px
  per pulsante diviso, e a piena larghezza ci sta ancora · WCAG 2.5.8 vuole
  24 px o la distanza dai vicini, e la freccia è attaccata al pulsante; è
  il cambio che si vede di più (27 stati dei fogli), quindi l'utente lo
  guarda nel simulatore.
- 2026-11-07 · fub-pre-alpha (D19) · i riscontri della sonda al telefono,
  tranne ciò che deforma la regola dei 44 px, vanno al piano del telefono
  (`prompt-piano-telefono.md`); quelli dentro le pagine dei piani (gli
  strati) vanno ai piani che le possiedono · il telefono si ridisegna (D1
  B) e una correzione di adesso sarebbe buttata; una pagina di un altro
  piano si cambia nel suo piano.

- 2026-11-07 · fub-pre-alpha (il verde) · la tinta di serie è 160
  «Smeraldo», non 159 come ha detto l'utente guardando il logo · le tinte
  della «f» del logo vanno da 157,6 a 164 e il suo foglio scuro è 160,6; i
  campioni dell'accento vanno a passi di 5°, e fra 159 e 160 l'occhio non
  vede differenza. Prima di PA T48 si chiede il sì su 160 col logo
  definitivo. (Superata lo stesso giorno: la cartella di Marcuzzo sta a
  160,1 in Smeraldo e in Menta, quindi il logo conferma 160 e PA T48 non
  aspetta altro.)
- 2026-11-07 · fub-pre-alpha (il verde) · il vassoio delle barre di S2 T16
  segue la tinta da solo (col verde #f8faf8 di giorno, #18211c di notte):
  né PA T11 né PA T48 toccano la ricetta per il vassoio · è la formula di
  S2 (`paper` = tinta − 10 di giorno, − 3 di notte); i valori a metà strada
  scritti prima erano sbagliati.
- 2026-11-07 · fub-pre-alpha (il verde) · le catture si rifanno verdi con
  due toppe sopra quelle del finto (`verde.patch`, `verde-avvio.patch`), le
  pagine dei piani con la mappa dei colori (`verde-mappa.json`); la lavagna
  (`s2/lavagna*`) resta una foto blu col DOM verde, unica eccezione ai pixel
  · il simulatore resta il client che PA T48 scriverà, e si rifà da
  un'altra macchina; la lavagna non ha una definizione per rifarla.
- 2026-11-07 · fub-pre-alpha (il logo) · il logo resta quello provvisorio
  (il nastro «f» con la pagina davanti) finché l'utente porta i file; PA T49
  aspetta i file e D28 · l'utente: «intanto lascia il logo che avevi fatto
  prima, poi ci penso io al logo, te pensa a finire il progetto».
  (Superata lo stesso giorno: l'utente ha portato Marcuzzo, D26.)
- 2026-11-07 · fub-pre-alpha (le scelte) · i consigli delle domande si
  pesano solo sulla qualità del risultato (aperto, personalizzabile, senza
  problemi), e il tempo non conta. Cambiano sei consigli (D1 B, D6 C, D8 B,
  D9 B, D11 B, D17 C), e arrivano D19–D24 dalle voci di «Fuori scope» che
  urtano col criterio (il controllo di tutte le viste, la firma, #237
  R05–R08 e A03, #242, le parti della finestra, K6). D23 e D24 consigliano
  comunque di aspettare, per una ragione di qualità. Le risposte e i 118
  stati, in 14 gruppi, si danno nella pagina «Le scelte di Fub pre-alpha»
  (https://claude.ai/artifact/Q5Lydynyn4DV8xwFDLZt18, `scelte.html`). Le
  risposte stanno nel db dell'artifact (`risposte/<D>`, `stati/<gruppo>`):
  solo il proprietario scrive, e il pianificatore le legge con
  ArtifactData. · L'utente l'ha chiesto il 2026-11-07: «voglio la qualità
  massima… open, personalizzabile… che funzioni da Dio».
- 2026-11-07 · fub-pre-alpha (simulatore v2) · il simulatore mostra il
  telefono corretto da PA T47 (`92-prealpha-telefono.css`): l'interruttore
  resta il binario di 32 × 18 della pelle, con un tocco di 44 px dato da un
  `::after` trasparente, e le schede delle impostazioni scorrono intere. Il
  confronto dei pixel toglie interruttori e schede e misura le righe che si
  accorciano · il cerchio di 44 px e i nomi in «…» sono un difetto di
  `shells/mobile/mobile.css` (differenza 47), non una forma da approvare;
  l'aspetto dell'interruttore è già approvato con Scrittoio 2. Un
  interruttore più grande solo sul telefono sarebbe stato una forma nuova
  da approvare, e non serve: il tocco di 44 px non deve per forza vedersi.
- 2026-11-07 · fub-pre-alpha (simulatore v2) · la scheda di un componente
  fermato porta `data-state="stopped"` nelle toppe, e il rosso del
  pericolo vale solo per la sua riga dello stato (`.setting-source[role=
  "status"]`) · la riscrittura delle toppe dal codice l'aveva perso, e la
  riga «Fermato…» usciva grigia come le altre; «Rimuovi» e le altre righe
  della scheda restano col loro colore.

- 2026-11-07 · fub-pre-alpha (simulatore v2) · nel confronto dei pixel lo
  spazio che il DOM nuovo prende si misura: il simulatore si riprova scorso
  di quanto il DOM nuovo spinge giù il resto, e un quadretto di 16 px che
  differisce conta come spiegato solo se si ritrova uguale nella foto del
  client spostato (in verticale o di lato, al massimo l'altezza del DOM
  nuovo più 64 px, mai oltre 480). Si tolgono anche gli elementi a cui una
  toppa cambia testo, attributi o classi · prima «spazio che il DOM nuovo
  prende» era una frase senza misura, e 37 righe restavano sopra la soglia
  con quella sola spiegazione; il quadretto deve ritrovarsi uguale, quindi
  un colore, un carattere o un CSS sbagliato resta una differenza.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · le toppe dei componenti
  (S204–S208) copiano `renderInstalledComponent` e la richiesta del
  consenso com'è oggi («Abilitato», «Consenso all'esecuzione», «Rimuovi»,
  «Concedere i permessi»); le righe nuove (lo stato «Fermato…», «Riavvia»,
  «Copia il motivo») hanno il loro commento · il codice vince sul piano
  finché l'utente non risponde a D18; il primo giro aveva inventato
  «Disinstalla» e un dialogo «Installare …?» che il codice non ha. D18
  consiglia A perché la regola del 2026-10-30 («Accendi, Spegni… Togli»)
  e il commento di `i18n/lexicon.ts` dicono «dappertutto».
- 2026-11-06 · fub-pre-alpha (simulatore v2) · nei livelli senza script
  (le pagine dei piani dentro la cornice) ogni `canvas` è sostituito da
  un'`img` con le sue misure · in un documento senza script il canvas non
  ha misura propria, e la pagina del PDF della lavagna usciva bianca.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · nel confronto dei pixel
  una differenza sopra lo 0,5 % è spiegata solo se togliendo la sua zona
  (il bottone della modalità spostato di S2 T3, l'anello del fuoco) il resto
  scende sotto la soglia; `script/foto-sim.mjs` scrive nella riga quanto
  resta. Il tema d'esempio e l'ispettore compatto di S2 T9 sono spiegati
  per stato, senza zona · una spiegazione che non si misura copre anche gli
  errori veri; così ogni riga dice se basta.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · con la finestra compatta il
  simulatore mostra l'ispettore di S2 T9 (264 → 216 px in cinque passi,
  `measures.ts`), non quello della foto: nella foto i blocchi, montati dopo
  le preferenze, lo tengono a 264 · nell'app `structure.css` viene prima
  delle preferenze e il passo compatto vince; il simulatore deve far vedere
  il prodotto dopo T9, non l'ordine dei fogli del banco.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · nelle pagine dei piani i
  caratteri di Google (Hanken Grotesk, Newsreader, IBM Plex Mono) si
  prendono dai file `@fontsource` del client · il simulatore gira senza rete
  (dentro l'artifact e da `file://`), e senza quei caratteri lo strato si
  disegnava con quelli di riserva e andava a capo altrove.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · `cattura.mjs` aspetta che
  menu, dialoghi e finestrelle di CodeMirror restino fermi due fotogrammi
  prima della foto; le tre catture del menu «/» sono rifatte così · la foto
  vecchia era presa mentre il menu si sistemava, e non coincideva col DOM
  copiato subito dopo.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · la pagina dell'artifact
  (`script/costruisci-hub.mjs`) non tiene più numeri scritti a mano: stati,
  scenari e quanti aspettano un sì vengono da `sim-stati.js`; la fase di
  ogni task dalle tabelle di «L'ordine» (con «aspetta Dn» quando la riga lo
  dice); una domanda è decisa quando il suo corpo comincia con «**Decisa
  dall'utente…**», e allora la tabella riassuntiva mostra la decisione al
  posto del consiglio · nel primo giro le fasi e i conti erano copiati
  nello script, e al secondo giro erano già sbagliati (T1–T24 contro
  T1–T45, D5 data per decisa).
- 2026-11-06 · fub-pre-alpha (simulatore v2) · gli script del ramo trovano
  Playwright, pngjs, pixelmatch, happy-dom e i caratteri in `FUB_CLIENT`
  (`script/client.mjs`), di serie `apps/client` del repository che li
  contiene; nessun percorso della macchina resta negli script del ramo
  (`script/ricattura-tutto.sh` prende i due client come argomenti) · uno
  script che punta a `~/.cache/…` non gira su un'altra macchina, e la
  richiesta del secondo giro vuole il simulatore rifacibile dal repository.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · D12 B è fatta come la
  pagina Aspetto dell'app: densità, contrasto e accento si scelgono in S234
  e restano negli altri stati finché «Aspetto di serie» non li toglie; non
  c'è una riga apposta sopra lo schermo · è il gesto del prodotto, e una
  seconda via nel simulatore sarebbe un comando che l'app non ha.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · tutte le catture si sono
  rifatte in un colpo (`script/ricattura.mjs`, 632 foto del client più 248
  delle pagine dei piani), e le vecchie stanno in `prove/catture-vecchie/`
  sulla macchina; restano le sole `s2/lavagna*`, senza definizione · metà
  delle foto vecchie aveva il CSS di prima dei blocchi o un cassetto aperto
  per sbaglio, e il confronto dei pixel non diceva più niente. Una foto
  vecchia superata da una cartella più in alto (`aspetto`, `toast`, le note
  in Blocchi, Sorgente e Lettura, «Comandi» del foglio) non si rifà: non la
  usa nessuno.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · le pagine dei piani si
  fotografano con gli argomenti di Chromium del banco anche quando la foto
  vecchia era diversa: le schede della lavagna (`p-lav-*`) vanno a capo in
  un altro punto (2–3 % dei pixel) perché le foto vecchie avevano il
  «hinting» dei caratteri acceso · la pagina è la stessa byte per byte, e
  la foto nuova si rifà uguale (0 pixel diversi) con lo script del ramo.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · `piani/ricette.html` si
  fotografa dalla copia avvolta del simulatore (con `<!doctype html>`), non
  dal file grezzo · grezzo il browser lo apre in «quirks mode» e le misure
  cambiano; nel simulatore e nell'artifact la pagina è sempre avvolta.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · i due temi d'esempio
  (`blocchi/93-tema-*`) non entrano nelle catture (`cattura.mjs` li salta) e
  il simulatore li monta solo sugli stati che li vestono · non sono CSS del
  prodotto; montati sempre, avrebbero vestito ogni foto.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · «il DOM» nel piano vuol dire
  una cosa sola per provenienza: per una cattura il DOM del client di oggi
  (uguale o cambiato da un task di Scrittoio 2), per una composta quello
  della pagina del piano, per una nuova quello di `toppe/*.html` · la
  richiesta del secondo giro diceva che la frase «si copia il DOM» non
  diceva quale.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · il file nuovo col tipo
  diventa tre task: PA T43 (il menu «Nuovo» chiede il tipo, S34), PA T44
  (il documento e il foglio vuoti, in `fub-host`) e PA T45 (la misura con
  5.000 file, S253) · un task che tocca client, host e banco non sta nella
  misura di un coder medio; il menu mostra solo i tipi che hanno un comando
  dichiarato, così T43 non aspetta T44.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · `t-foglio-errore` diventa uno
  stato suo (S286, «Telefono: l'errore di un comando») e non è più il
  telefono di «Foglio: una formula sbagliata» · la cattura è l'errore di un
  comando della griglia, non un #DIV/0! in una cella: mostrarla come la
  stessa cosa al telefono era sbagliato.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · nel menu «Nuovo» la voce
  «Cartella» non ha scorciatoia · Ctrl+Shift+N l'avevo scritta io, e il
  client non la ha: una scorciatoia inventata nel prototipo finirebbe nel
  codice.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · ogni stato ha una
  provenienza (cattura, composta, nuova) e un numero S che non cambia più
  (`script/numeri-sim.json` cresce soltanto); da approvare sono le composte
  e le nuove, 118 su 286 · l'utente approva per numero («approvo tutto
  tranne S23»), e un numero che cambiasse farebbe approvare la cosa
  sbagliata.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · il CSS nuovo ha una fonte
  sola. Per Scrittoio 2 vince il prototipo approvato del suo piano
  (`PLAN-ui/scrittoio-2.html` di `piano/scrittoio-2`), e
  `script/prova-css-fonte.mjs` controlla che i 18 blocchi del simulatore
  che vengono da lì coincidano con i suoi, tolte le varianti «com'era», i
  commenti e gli spazi. Per i pezzi di questo giro la fonte è il blocco del
  simulatore (`blocchi/92-*` e `93-*`), con destinazione e task. La
  cattura monta i blocchi per la foto ma non li copia (`cattura.mjs`), e il
  simulatore li rimonta sopra ogni cattura · due copie dello stesso CSS
  prima o poi divergono, e il coder copierebbe quella vecchia.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · le catture (560 MB) restano
  fuori dal repository; nel repository la fonte delle catture sono i dati
  già impacchettati (`sim-dati-*.js`), e `DATI=<cartella> node
  script/costruisci-sim.mjs <uscita>` rifà la pagina uguale byte per byte ·
  così blocchi, toppe, scenari e vista si cambiano dal repository senza il
  server, e la prova dice se la ricostruzione è fedele.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · una cattura presa prima di
  un cambio dei blocchi si rifà (`script/ricattura.mjs`, coi blocchi e coi
  mod di oggi) · il simulatore monta i blocchi di oggi: una foto col CSS di
  allora non confronta più niente.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · le foto del confronto, anche
  quelle delle pagine dei piani (`script/cattura-piani.mjs`), usano gli
  argomenti di Chromium del banco (`bench/stage.mjs`) · senza, il testo si
  disegna diverso e ogni parola conta come differenza.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · nel confronto dei pixel si
  nasconde la riga dei dati della nota (il mod `datiNota` la mette nel DOM
  da copiare, la foto del client non ce l'ha), si coprono le toppe e i
  pezzi composti, e gli strati si confrontano solo a tutta larghezza · la
  pagina approvata è fotografata alla sua misura; a 700 px e al telefono lo
  strato è la stessa pagina che si adatta, e la differenza è attesa.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · i gesti del telefono sono
  provvisori come il telaio A (D1): una strisciata orizzontale di almeno
  60 px apre e chiude i cassetti, dal bordo (24 px) torna indietro, la
  pressione lunga (500 ms) apre il menu del tocco; vale anche sul testo, e
  il documento ha `touch-action: pan-y pinch-zoom` · senza `pan-y` il
  browser prende la strisciata per sé (`pointercancel`); il guscio mobile
  vero li decide nel piano del telefono.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · i tempi del simulatore
  (`setTimeout`) stanno sulla finestra del simulatore, non nello schermo ·
  lo schermo è un iframe senza `allow-scripts`, e lì un timer non scatta mai.
  Solo simulatore.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · Indietro salta lo stato di
  adesso nella storia e, senza storia, torna alla «casa» dello stato (il
  foglio per un dialogo del foglio) · Indietro deve portare sempre altrove.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · il clic sul velo di un
  dialogo del kit annulla (`kit/dialog.ts`); il velo delle impostazioni le
  chiude come × (`preferences/scrim.ts`); l'icona del binario del pannello
  già davanti chiude e riapre la colonna (`panels/rail.ts`, `railClick`);
  l'indice delle impostazioni scorre, dà il fuoco al titolo e segna la voce
  con `aria-current` (`jumpTo` di `panels/settings.ts`) · il simulatore fa
  ciò che fa il prodotto, anche dove la foto non c'è.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · la colonna della lavagna
  (toppa `lav-colonna`) scrive `data-tool` e `data-tools` come
  `kit/tool-rail.ts:126` e `:244` · è lo stesso kit del disegno, e il coder
  copia il DOM che il kit produce davvero.
- 2026-11-06 · fub-pre-alpha (simulatore v2) · `prova-sim.mjs` conta come
  «coperto» solo un controllo sotto qualcosa che non è un controllo; non
  conta chi è tagliato da un antenato che scorre o ritaglia, né chi sta
  sotto un velo, uno strato, un pannello o un menu aperto, o sotto la
  striscia del bordo del cassetto (`frame/peek.ts`); dopo ogni montaggio
  aspetta le animazioni finite (al più 1,5 s) · senza, l'elenco dei
  controlli cambia fra il movimento calmo e il ridotto, e i falsi allarmi
  nascondono quelli veri.
- 2026-11-05 · fub-pre-alpha (skin facile) · la richiesta del manutentore
  («se non è facile creare una skin non andiamo da nessuna parte») entra nel
  piano come PA T34–T42 e «Fatto quando» 9, con tre domande (D15 il nome del
  campo, D16 le icone, D17 l'aspetto dei due temi) · è una scelta di
  prodotto già presa dal manutentore; il pianificatore ha deciso solo il
  come, qui sotto.
- 2026-11-05 · fub-pre-alpha (skin facile) · l'ordine: la pelle che eredita
  e i caratteri in Fase A (T34, T35, T39, T40); gli strumenti dell'autore in
  Fase B dopo le Impostazioni di S2 (T36–T38); gli hook congelati per
  ultimi, dopo tutta la Fase C (T41); i temi d'esempio dopo il congelamento
  (T42) · si congela solo ciò che la pre-alpha mostra, quando non cambia
  più; i temi d'esempio provano lo snapshot, non un contratto che si muove.
- 2026-11-05 · fub-pre-alpha (skin facile) · i canali del loader diventano
  `caratteri`, `caratteri-tema`, `foglio`, `pelle`, `pelle-tema`,
  `preferenze`, `snippets`; senza `extends` tutto resta come oggi, byte per
  byte · un canale separato, e non una fusione dei testi, tiene le
  preferenze dell'utente sopra ogni pelle e lascia smontare il tema senza
  toccare la serie.
- 2026-11-05 · fub-pre-alpha (skin facile) · `extends` accetta solo
  `fub.serie`; ereditare da un altro tema è fuori · una catena di temi
  vorrebbe un ordine, i cicli e le versioni; nessun caso lo chiede adesso.
- 2026-11-05 · fub-pre-alpha (skin facile) · una «Modalità sviluppatore»
  (`developer.mode`, gruppo «Sviluppo», livello macchina, spenta) apre
  installare e collegare da cartella; la regola sta nell'host, non solo nel
  bottone; un tema collegato alla volta, con fiducia «In sviluppo» · è la
  stessa idea dei temi in sviluppo che `TRUST_LABELS` sa già dire, e un
  programma non può accenderla da sé.
- 2026-11-05 · fub-pre-alpha (skin facile) · i caratteri del tema: le regole
  `@font-face` le scrive il loader dai campi del manifest (woff2 fra gli
  asset, firma `wOF2`, 8 file, 2 MiB l'uno, 6 MiB in tutto); `@font-face`
  resta vietato nel CSS · un `src:` scritto a mano potrebbe chiamare la
  rete; la CSP non cambia (ha già `font-src data:`).
- 2026-11-05 · fub-pre-alpha (skin facile) · le icone del tema (se D16 è A o
  C) passano `PATH_DATA` come il registro di oggi; un nome che nessuno
  disegna è un avviso nella diagnosi, non un rifiuto · i moduli registrano
  le loro icone quando si caricano, quindi al montaggio del tema non tutti i
  nomi ci sono ancora.
- 2026-11-05 · fub-pre-alpha (skin facile) · al ricaricamento di un tema
  collegato, un fascio rifiutato lascia montato l'ultimo buono (non la
  serie) e mostra la diagnosi con l'ora · chi scrive il tema salva spesso
  file a metà; cadere sulla serie a ogni errore farebbe lampeggiare l'app.
- 2026-11-05 · fub-pre-alpha (skin facile) · il codice vince sulla
  richiesta: `contract.json` è cambiato in 12 commit (non 11); `install_theme`
  c'è già nell'host senza IPC; la fiducia `development` c'è già · scritto in
  «Differenze fra piani e codice», 28–36.
- 2026-11-05 · fub-pre-alpha (secondo giro) · un coder alla volta, più al
  massimo un pianificatore, anche in questo file (prima diceva «al massimo
  tre») · è la regola dell'utente dal 2026-11-04; le «ondate» del piano sono
  file, una dopo l'altra. Stima scritta in «L'ordine»: 7–9 settimane.
- 2026-11-05 · fub-pre-alpha (secondo giro) · task nuovi decisi dal
  pianificatore: PA T25 (il controllo degli aggiornamenti vede le
  pre-release: `/releases/latest` non le dà), T26–T30 (T14 diviso in sei
  task, 27 compiti), T31 (l'APK di debug x86_64 parte in un emulatore della
  CI, senza action di terzi), T32 (`![[x.pdf#page=3]]`) · ognuno chiude un
  buco fra «Fatto quando» e il codice; le ragioni sono nelle loro sezioni.
- 2026-11-05 · fub-pre-alpha (secondo giro) · PA T4: R01 si prova con un
  test sui tre chiamanti di `release()` prima di correggere, e si chiude se
  non si riproduce; niente `demo.unsaved` · `release()` ritorna già
  `CloseResult` e `dismissIfUnwatched` tiene il testo non salvato.
- 2026-11-05 · fub-pre-alpha (secondo giro) · l'MSI usa
  `bundle.windows.wix.version = 0.2.0.N` (N di `prealpha.N`), con la
  guardia; se l'aggiornamento su Windows lascia due voci, le note dicono di
  disinstallare prima (PA T22, T23) · il `MajorUpgrade` di Tauri sostituisce
  la voce di prima, ma va visto su Windows.
- 2026-11-05 · fub-pre-alpha (secondo giro) · la proposta MCP «vista e
  accettata in Fub» esce dalla pre-alpha e va in A1 F5 («L'assistente
  dentro Fub»); PA T23 prova i flussi MCP che ci sono (`fub_write` con la
  base, `fub_canvas_apply` in prova e davvero, la ricetta proposta) ·
  nessun task la costruiva.
- 2026-11-05 · fub-pre-alpha (secondo giro) · due domande nuove per
  l'utente: D13 (la prova di K2 prima del merge di #290, come dice K2 D-2;
  consiglio A) e D14 (il nome «FubDraw» nelle frasi che le persone leggono;
  consiglio A). PA T33 aspetta D14 · cambiano ciò che si vede o una regola
  che l'utente aveva scritto.
- 2026-11-05 · fub-pre-alpha (secondo giro) · scelte dell'utente: D3 = A
  (disegnare ora N6 T26–T28 nel simulatore), D4 = A (le pagine dei piani
  composte nella cornice di Scrittoio 2, con le barre nel kit), D5 composte
  tutte e due, D12 = B (densità, contrasto e accento cambiano davvero il
  simulatore).
- 2026-11-05 · fub-pre-alpha (pianificatore) · definizione confermata
  dall'utente: gli otto punti di «Fatto quando» del piano; dentro tutti i
  piani aperti tranne K6; computer più un APK Android di prova segnato
  «sperimentale»; pre-release pubblica `v0.2.0-prealpha.1`, con #289 · scelte
  dell'utente, date con le domande della pianificazione.
- 2026-11-05 · fub-pre-alpha · «il blocco di scrittura in sola lettura» entra
  come PA T3: i comandi in sola lettura non prendono `write_turn()` in
  `FubSession::invoke_command` · nella pre-alpha l'AI legge (MCP,
  `canvas.read`) mentre la persona scrive; l'issue che N7 (2026-11-04)
  prometteva non è mai stata aperta, e il task la sostituisce.
- 2026-11-05 · fub-pre-alpha · N6 «v1 senza T79» vuol dire senza T79–T85 e
  T88 · T80–T84 dipendono da T79 e da PdfCraft P1, P2 e P4, T85 da T82, T88
  da D-20 (il piano dei CSV, che non c'è): sono le dipendenze scritte nel
  piano di N6.
- 2026-11-05 · fub-pre-alpha · `fub:abi@0.2.0` si congela nella fase A (PA
  T6, T7), non alla fine · nessun piano dentro tocca `wit/fub/abi.wit`
  (verificato su tutti i rami): la guardia stretta protegge da subito il
  lavoro delle fasi B e C.
- 2026-11-05 · fub-pre-alpha · il corpus senza perdite (PA T13) entra nella
  fase A e si allarga quando K5 e N4 entrano · ogni piano unito dopo lo deve
  tenere verde, e un difetto si trova presto.
- 2026-11-05 · fub-pre-alpha · Scrittoio 2 T23 contro N6 sulla lavagna: vince
  N6, e S2 T23 aggiunge solo l'icona · N6 ha il prototipo approvato
  `lavagna-schede` (T25, 2026-11-04). S2 T22 contro K5 (la testa del
  disegno) resta una domanda (D5), perché cambia ciò che si vede.
- 2026-11-05 · fub-pre-alpha · il simulatore scrive il corpo del testo a 18,
  il valore di S2 T11, anche dove il prototipo approvato di S2 mostra il 17
  del finto del banco · il simulatore mostra il prodotto dopo S2; è la sola
  differenza col prototipo approvato (stato `impostazioni`).
- 2026-11-05 · fub-pre-alpha · i sedici test instabili aperti entrano come tre
  task (PA T19–T21): 200 corse o la causa; la quarantena la decide l'utente ·
  la pre-alpha chiede la CI completa verde sul commit del tag.

- 2026-11-05 · k3-motori · T17, la scena `window-document` aspetta di nuovo
  che lo strato d'avvio se ne sia andato dopo aver ricaricato la pagina, come
  fa `prepareScene` · perché: la corsa 42045342312 l'ha fotografata col
  marchio fermo (93% di pixel diversi, nelle due luci). È una gara del banco
  arrivata con il piano del caricamento (#308), uguale su `main`: la scena
  ricarica la pagina dopo l'attesa comune, e quell'attesa non la copriva più.
  Correzione piccola del banco, la baseline non cambia; in prova locale 0 su
  24 foto con lo strato.
- 2026-11-05 · k3-motori · T17, il finto host del banco dichiara
  `chrome.sidebar.visible` e `chrome.inspector.visible` quando la scena apre
  una cartella di Excel (`workbook=1`), come l'host vero (`fub-host`) · perché:
  le scene della barra dei fogli chiudono i due pannelli e senza la
  dichiarazione la scrittura falliva, così le foto del runner tenevano
  l'avviso «Non ho potuto ricordare come hai lasciato i pannelli» e il 2 sulla
  campanella. Correzione piccola del banco, nessun cambio di ciò che l'utente
  vede nel prodotto; le scene delle Impostazioni non cambiano (d90a09d0).
- 2026-11-05 · k3-motori · T19, risposta dell'utente alla scelta aperta qui
  sotto: D, la griglia non cambia altezza durante la tenda, senza salti né
  bande scure. Fatto così: per la durata della corsa la griglia e chi le sta
  sotto tengono l'altezza che avevano prima del gesto, con un margine
  negativo in fondo che li fa passare sotto la barra dei fogli; a corsa
  finita (e allo smontaggio) il margine se ne va e la griglia è alta quanto
  la parte che si vede · perché: la D alla lettera, la griglia sempre alta
  come a nastro chiuso, nasconderebbe sotto la barra dei fogli la barra di
  scorrimento orizzontale e le ultime righe, e il motore usa `clientHeight`
  in più di dieci posti. Così si vede la D durante la corsa e a riposo non si
  nasconde niente. Il margine è uno stile fermo, non animato: la regola 3 del
  banco resta verde. Un'inversione a metà corsa riparte dalle altezze di
  prima del primo gesto.
- 2026-11-05 · k3-motori · T19, ciò che cambia forma o se ne va mentre era
  ancora in corsa (un foglietto che si richiude a metà apertura, i foglietti
  di una sezione lasciata a metà entrata, la scheda della tabella che
  scompare mentre compariva) lascia un'immagine (`moto/prepareExit`) che
  svanisce da dove si vedeva; chi tiene la forma prosegue dalla sua posa ·
  perché: con solo `transform` e `opacity` un riquadro che cambia misura non
  può proseguire, e la regola 4 del banco vuole che niente salti. Il banco
  dice ora com'era e com'è il riquadro che salta (`was`, `is`). Provato e
  tolto: misurare soltanto la parte visibile dei riquadri, che faceva saltare
  concentration e rich-reading senza aiutare il ritiro. Aperto: nel ritiro a
  metà riapertura la griglia cambia altezza (92 px) e il suo bordo di sotto
  non può proseguire; la scelta è dell'utente.
- 2026-11-04 · k3-motori · T18, al telefono i bottoni della barra dei fogli
  restano a 44 px, la regola della shell mobile, e non 38/88 come nel
  prototipo; la risposta dell'utente: «i tasti ok a 44px» · perché: la
  misura del tocco vale per tutta la shell mobile, e un'eccezione solo per
  la barra la romperebbe.
- K3 T15, le differenze accettate: in sola lettura un esito con modifiche si
  scarta e il provider riparte dal giornale confermato
  (`#openWorkbook(#confirmedJournal)`), invece di applicarlo;
  `setCommandEffects` e `servesCommands` nel motore, perché sia lui a sapere
  quali comandi passano in sola lettura; `READ_ONLY_DIALOGS` lascia aprire
  in sola lettura le finestre scritte a mano che non cambiano niente (find,
  goTo, goToSpecial, printPreview, nameManager); un comando `legge` con un
  parametro obbligatorio apre prima il modulo. Nella finestra del risultato
  i valori lunghi vanno a capo (`overflow-wrap: anywhere`), i numeri restano
  a precisione piena (il prototipo arrotondava a due decimali, che per un
  risultato da copiare perde dati), e `.grid-dialog-error` usa il colore del
  testo perché il rosso scuro del prototipo stava a 4.01:1. Le foto strette
  del banco sono a 1016 px (foglio 700 px), perché sotto 800 px parte la
  shell del telefono. Restano note per T17: in sola lettura «trova e
  sostituisci» rifiuta le sostituzioni dal motore, le voci di menu che
  cambiano non fanno niente, «1 celle» viene dal prototipo.
- K3 T14 (e3b8afc0): il menu «Comandi» è `editors/grid/menu-comandi.ts`
  (`openCommandMenu`) agganciato alla fila `quick` della barra; i comandi
  che la barra non ha passano da una seconda istanza della tavolozza
  (`mountGridPalette` dentro `ribbon/ribbon.ts`, vive quanto la barra).
  `ui/menu.ts` ha tre opzioni nuove (`label`, `fullSearch`,
  `reachDisabled`); la ricerca piena tiene l'altezza del posto e scorre.
  Scarti dal prototipo: il tooltip del gettone è «Comandi» e «Tutti i
  comandi del foglio» è l'aria-label del menu; l'icona è `outline` perché
  `ribbon/icons.ts` era fuori dai Tocca (da rivedere in T17 col prototipo);
  la scena `grid-commands-search` usa una ricerca senza risultati perché con
  testo lo Spazio scrive nella ricerca e la regola tastiera dell'a11y la
  boccerebbe; nessuna scena sotto 560 px (scene.test vuole finestre ≥ 800
  px; il gettone senza nome lo mostra `mobile-grid-ribbon`). Restano: il
  piede del menu non resta fisso in fondo nelle ricerche lunghe; le baseline
  delle scene nuove e di `mobile-grid-ribbon` dal runner (T17).
- K3 T13, dopo la CI di 8493f177: effetto.rs cadeva sul runner perché
  review.spelling chiede l'elenco di parole del sistema
  (/usr/share/dict/words), che il runner non ha, e GridCraft rifiuta il
  controllo prima di toccare la cartella. L'orchestratore accetta quel solo
  rifiuto, per i comandi review.*, come «non provato» (lo stampa); con
  l'elenco il comando gira e la prova vale. Provato in locale nei due modi
  (con l'elenco, e con l'elenco coperto in uno spazio dei nomi).
- K3 T13 integrata (4f244e0d). Gli effetti sono 250 cambia, 31 legge, 22
  mostra (il prototipo ne dice 250/29/24, il piano 249/29/24).
  L'orchestratore tiene la regola del piano, provata da effetto.rs, al posto
  dei conti: view.normal, view.split, view.customViews e
  formulas.watchWindow scrivono nel giornale e passano fra i Cambia (il
  prototipo li dice mostra o legge); insert.chartRecommendations,
  data.scenarioManager e file.printPreview (legge) e file.exportPdf (mostra)
  lasciano commit.edit vuoto e restano accesi in sola lettura (il prototipo
  li dice cambia). La tavolozza scrive «Scheda X della barra» solo se la
  barra mostra la scheda e il gruppo del posto, altrimenti «Comando del
  foglio di calcolo»: file, draw e pivot non hanno testi della barra, e i
  testi del menu sono di T14. Toccati in più palette/form.ts e form.test.ts,
  dove sta il tipo CatalogCommand. Rischio: l'effetto vale per comando, non
  per parametri.
- 2026-11-04 · K3 · T18 integrato con i bottoni a 44 px al telefono. La
  shell mobile impone ai bottoni almeno 44×44 (`mobile.css`), e il prototipo
  non ne teneva conto: al telefono i gruppi chiusi impilati sono alti 44
  invece di 38, il vassoio 100 invece di 88, Dati ha 0 gruppi aperti su 4
  invece di 1, Inserisci scorre di 61 invece di 54. Perché: abbassare un
  bersaglio del dito sotto il minimo della shell è una scelta di
  accessibilità e cambia il «Fatto quando», quindi è dell'utente; finché non
  risponde resta la regola della shell, che non tocca il resto del lavoro
  (un'eccezione sarebbe solo CSS dentro `.grid-ribbon`). Le baseline delle 9
  scene nuove arrivano dal runner con T17; fino ad allora `bench/scene.test`
  «ci sono tutte» resta rosso.
- K3 · D-7 (il foglietto chiuso della variante C): l'utente ha scelto
  l'ibrida il 2026-11-03, due o più chiusi a pila alti 38 px, uno rimasto
  solo a tessera alta quanto la barra (80 px). Il pianificatore l'ha scritta
  in T18, nella tabella «Dal prototipo» e nel Cancello; pila, tessera e
  dorso restano nel prototipo solo per confronto. Le varianti A e B non
  cambiano. Il piano delle celle della griglia (16 difetti misurati) è un
  piano a parte, piano/griglia-celle, perché tocca gli stessi file di T14,
  T15, T18 e T19.
- 2026-11-03 · K3 · risposta dell'utente al terzo prototipo della barra: la
  variante C (i riquadri sollevati) e le animazioni piacciono («stupenda»,
  l'apertura sul posto di Allineamento e Carattere «bellissima e comoda»,
  anche pensando al telefono). D-6 = C; A e B non piacciono e restano come sono, senza altro lavoro. Un solo difetto di C, che blocca
  l'approvazione del gruppo chiuso: il gruppo ripiegato (nome sopra, icona e
  freccia sotto, tanto spazio vuoto, proporzioni sbilanciate) è «grezzo» e
  va ridisegnato dal pianificatore prima di T18. Chiesto anche di
  pianificare le celle della griglia (oggi sulla 1432 ci sono difetti di
  disegno e animazioni povere) allo stesso livello della barra.
- 2026-11-03 · K3 · T11 integrato (95cd097e..1cfcca49): ogni DocumentSession
  ha una chiave di apertura, fatta prima della lettura e chiusa da un'uscita
  sola (#release), e tutte le letture e scritture della sessione la passano;
  RICH_FORMAT_IDS è tolto; un presidio sull'AST di TypeScript vieta
  openDocument, documentClosed e la scrittura con chiave fuori dalle
  sessioni; fuori da «Tocca» il coder ha aggiornato sei helper dei banchi e
  tre e2e, perché documentClosed è ora obbligatorio nell'API, senza
  indebolire asserzioni · dopo un ricaricamento della finestra le chiavi
  vecchie restano nell'host fino alla chiusura del vault o al tetto di 1024:
  è scritto in motori.md, e non serve codice perché il tetto LRU le
  richiude.
- 2026-11-03 · K3 · T10 integrato (d94cd18f..ed10cc56): le letture semplici
  non aprono un documento nel motore, solo una chiave di apertura (OpenKey)
  lo tiene aperto; quando le chiavi sono troppe si chiude quella usata meno
  di recente (LRU) e non la più vecchia, perché un documento appena
  riguardato non deve perdere la sua prova; Host::open_keys esiste per i
  test e per l'host finto; la pagina motori.md la aggiorna T11 · il piano
  diceva «la più vecchia», ma con l'LRU un documento in uso non si richiude
  sotto le mani.
- 2026-11-03 · K3 · D-5 (b): i nomi dei gruppi sulla barra dei fogli
  restano, ma discreti (grigi, poco evidenti, eleganti); il prototipo
  rifatto non è approvato e si rifà una terza volta, con un'organizzazione
  della barra nuova invece di quella di Excel, più identità di Fub, meno
  spazio vuoto sotto e le animazioni predisposte · parole dell'utente («mi
  piace la variante B con i nomi … un po' più discreti … in un grigio»,
  «l'organizzazione della barra mi sembra proprio una copia rispetto a
  Excel. vorrei qualcosa di nuovo, qualcosa di più bello … predisposte anche
  le animazioni»).
- 2026-11-03 · K3 · T10: l'utente dà l'OK al cambio dell'IPC (read_document
  e write_document con open?, document_closed con {open}, al più 1024 chiavi
  per vault) · parole dell'utente («ok»): le letture semplici non tengono
  più aperti i documenti; la riga nel piano la scrive l'orchestratore quando
  il pianificatore della barra ha finito.
- 2026-11-03 · K3 · il prototipo di T12 non è approvato: la barra
  multifunzione dei fogli va ridisegnata nello stile di Fub (moderno,
  minimale, stondato) invece che come Excel; si comincia dai fogli, e i
  documenti e le altre modalità la riprenderanno più avanti, quindi in K3 la
  barra degli altri editor non cambia · parole dell'utente; il menu
  «Comandi» resta, con la barra nuova.
- 2026-11-02 · K3 · Le risposte dell'utente a D-1…D-4 (e merge-k3,
  ci-soglia): D-2 (c), T8 unito e una lettura conta come apertura solo con
  la chiave di una sessione della shell, che la chiude in ogni uscita
  (contratto IPC cambiato: T10, T11); D-3 (c), un menu «Comandi» vero per i
  fogli, con il prototipo T12 da approvare prima di T13–T15, un posto e un
  effetto per ogni comando; D-4 (a), K3 si chiude e la memoria della WebView
  va in un piano a parte; il merge solo dopo la CI completa e la revisione
  (T17); il limite di R1 non si alza · ogni cosa che apre un documento lo
  deve chiudere, un comando che si trova solo con una scorciatoia è
  nascosto, e un numero rosso non si nasconde alzando la soglia.
- 2026-11-02 · K3 · T9: la misura del cancello prima (cb4213ec, codice di
  620f0acd) e dopo (c5851334) sulla stessa macchina, tre giri R1/S1/S6
  alternati per lato sotto Xvfb e i banchi; T8 non misurato. L'avvio e i
  banchi passano; gli obiettivi di R1 no, per la WebView: lo segno come
  fatto perché il «Fatto quando» di T9 è la pagina col giudizio, e il
  cancello va all'utente come D-4. In tempi.rs la lettura dopo un'altra
  cartella chiusa costa 6–15% in più (malloc_trim di T5): annotato, non
  abbassato nessun tetto.
- 2026-11-02 · K3 · T7: i titoli dei 303 comandi e i nomi dei campi stanno
  in un catalogo dei testi a parte (`editors/grid/palette/strings.ts`),
  caricato col foglio, e non in `i18n/catalog.ts`, per non gonfiare i testi
  della shell; i valori delle scelte restano come li scrive il catalogo. La
  finestra costruita dai campi serve ai 106 comandi con parametri
  obbligatori e chiede solo la forma principale; i 197 senza partono subito
  sulla selezione, come il pulsante della barra; quelli con una finestra
  scritta a mano aprono quella. Un comando spento resta in elenco col motivo.
  I comandi compaiono anche nel lanciatore dello Scrittoio. Limiti noti: i
  comandi che leggono soltanto non mostrano il risultato; due comandi hanno
  lo stesso titolo «Riempimento rapido» e si distinguono dalla scheda.

- 2026-11-02 · K3 · T8 (branch `piano/k3-ipc-motori`, in attesa di D-2):
  `Host::warm_engine` e `Host::document_closed` hanno nomi inglesi come il
  resto di `fub-host`; l'host sa quali documenti ricchi sono aperti dalle
  revisioni che ha dato alla shell (al più otto per documento) e dimentica la
  prova a vuoto per revisione (`MotoreDocumenti::dimentica`, pubblica); il
  client scalda dopo 300 ms di puntatore fermo e solo i tipi con un motore,
  e avvisa la chiusura da `DocumentSessionCollection.close`. · La revisione è
  già l'impronta dei byte con cui il motore ricorda la prova: niente disco da
  rileggere. Limite noto: le letture fuori da una sessione (l'anteprima della
  ricerca) contano come aperture senza chiusura, e allora la cache resta fino
  alla chiusura del vault.
- 2026-11-02 · K3 · `scripts/check.sh --rapido` fa girare i test di
  `fub-abi` anche quando il diff tocca soltanto documenti. · Un riquadro
  doppio nel grafo di `overview.md` è passato verde in locale e rosso in CI:
  `dependency_invariant` legge i documenti ma girava solo se cambiava un
  crate.
- 2026-11-02 · K3 · T4: `importa` e `verifica_copertura` ricevono un
  `Adattamento` dell'adattatore (posti dei menu, lessico dei nomi nudi dei
  parametri, correzioni per comando) e restituiscono tutte le mancanze, non la
  prima; `Modulo::da_schema` prende il lessico, differenza dal piano che lo
  voleva dal solo schema. Il catalogo dei fogli ha 303 comandi, 43 non serviti
  con il loro perché e 75 solo nella tavolozza. · Lo schema del motore scrive
  spesso nomi nudi (`range`, `at`) senza tipo: senza lessico i campi
  sarebbero tutti testo libero. I tipi del lessico vengono dal codice di
  GridCraft; alcune scelte portano nomi del motore (il tema «Craft») che la
  shell non deve mostrare così come sono.
- 2026-11-02 · K3 · T5 e T6: il motore dei fogli conta le istanze aperte con
  una `Presa` (cade l'ultima, si svuotano le sue cache); le cache dei documenti
  (le prove a vuoto, `documenti.prove`, con la stima dei byte misurata sul
  corpus) e i dizionari del correttore (`correttore.dizionari`) si svuotano
  alla chiusura dell'ultimo vault, passando da `fub-host/src/rich.rs` e da
  `fub_features::proof` senza nominare WordCraft · perché: chi chiude non deve
  sapere quali motori ci sono. Rischi annotati: lo svuotamento dei fogli gira
  sotto il lucchetto della superficie della griglia del kernel (toglierlo vuol
  dire toccare `fub-kernel`/`fub-host`); svuotare i dizionari toglie anche la
  sillabazione, che si ricostruisce alla prima richiesta.
- 2026-11-02 · K3 · Il test di copertura dei comandi (T4): la regola sta in
  `fub-motori` (`catalogo`, provata con specifiche finte in
  `crates/fub-motori/tests/copertura.rs`), il test vero sul motore dei fogli
  in `crates/fub-format-xlsx/tests/copertura.rs`; `fub-motori` non dipende
  da nessun adattatore, nemmeno nei test (differenza dal piano, che diceva
  una dev-dipendenza da `fub-format-xlsx`) · perché: ADR 0236, e ogni motore
  che verrà usa la stessa regola dal suo adattatore.
- 2026-11-02 · K3 · `check-motori.mjs` ammette `rfd` solo se lo porta
  `tauri-plugin-dialog` (i dialoghi di sistema della shell di Fub, non
  l'interfaccia di un motore); «librerie doppie» sono i nomi in due o più
  versioni (45 con tutte le feature e tutte le piattaforme), non i 61 nomi di
  `cargo tree -d`, che conta anche la stessa versione ripetuta · fonte:
  report del coder di T2, accettato dall'orchestratore.
- 2026-11-02 · K3 · Lavoro di notte senza l'utente: le domande del «Chiede
  sempre» si raccolgono in `PLAN.md` (D-1…D-3) e intanto vale la scelta più
  sicura e reversibile; i due IPC nuovi (scaldare, «documento chiuso») si
  scrivono su un branch a parte, `piano/k3-ipc-motori`, e non entrano nel
  branch del piano senza un sì; nessun merge · fonte: l'utente («voglio che
  tu implementi più parti possibili durante la notte … segui il piano»).
- 2026-11-02 · K3 · `fub-motori` non nomina nessun motore: dà `Pigro<T>`,
  `Servizi`, `Budget`, `Cache`, il catalogo e un registro `Motori` dinamico in
  cui ogni adattatore iscrive il suo motore («fogli», «documenti»); servizi e
  registro unici nel processo · perché: solo gli adattatori nominano i motori
  (`check-engine-boundary.mjs`, `GRIDCRAFT_OWNERS`, `WORDCRAFT_OWNERS`) e un
  campo per motore farebbe un ciclo fra `fub-motori` e gli adattatori; ADR
  0236.
- 2026-11-02 · K3 · `rayon` (gruppo di thread dei motori, suo e con un nome)
  e `libc` (`malloc_trim` su glibc) diretti in `fub-motori`: erano già
  nell'albero, nessun crate nuovo · fonte: `Cargo.lock` (rayon 1.12 da
  tantivy; libc 0.2 come in `fub-kernel`).
- 2026-11-02 · K3 · Scheda grafica e archivio dei caratteri non entrano in K3:
  nessun motore acceso li usa e `wgpu` sarebbe una dipendenza nuova; arrivano
  col primo motore che li chiede · domanda D-1 per l'utente.
- 2026-11-05 · caricamento · scelta dell'utente (A): il banco del moto non
  conta come residuo la `transform: scale(1, 1)` che CodeMirror lascia sui
  suoi strati (`.cm-layer`) dopo la cascata d'avvio, che scala il riquadro a
  0,98; la cascata resta com'è. L'eccezione vale solo per la scala neutra e
  solo sull'elemento `.cm-layer` (`editorLayerIdentity` in
  `bench/motion-rules.mjs`) · l'altra strada era togliere la scala dalla
  cascata, cioè cambiare ciò che si vede all'avvio.

- 2026-11-04 · caricamento · piano concluso. `bench:lampo` entra in CI nel
  job del banco visivo e in `ci-required`. Il controllo completo locale è
  verde salvo le otto baseline `avvio-*`, che arrivano dal runner, e quattro
  test a tempo (`runtime`, `engine`, `diagnostics`, `tips`) scaduti sotto
  carico e verdi da soli. Il rosso di «i test del workspace» nella corsa
  41910733616 era il runner senza spazio su disco: rifatto, verde.

- 2026-11-04 · caricamento (orchestratore) · lo stile dello strato d'avvio
  esce dai tre HTML: `<link id="avvio-stile">` verso `public/avvio/avvio.css`,
  e il `<noscript>` carica `public/avvio/senza-js.css`. Il piano lo voleva in
  linea, contando su `style-src 'unsafe-inline'`, ma Tauri mette un nonce a
  ogni `<style>` delle pagine e lo aggiunge a `style-src`, e con un nonce la
  WebView ignora `'unsafe-inline'`: i sei `<style>` che CodeMirror aggiunge a
  pagina avviata erano rifiutati (senza foglio) e gli editor dell'app vera
  restavano senza stile. Lo ha mostrato S7 di `bench:webview`, rosso da T1 in
  tutte le corse (la maniglia a y≈38.200: `.cm-scroller` alto quanto la nota),
  riprodotto su server-di-fub; il banco Chromium passa da Vite e non ha la CSP
  di Tauri. `pagine.test.ts` ora tiene le pagine senza `<style>` né script in
  linea. `R1.giri.pendenza` sopra soglia nelle stesse corse non è del piano:
  su main va da 3,6 a 56,8 MiB (run 41809459543, 41538788842, 41325487648).

- 2026-11-04 · caricamento T4 · perimetro allargato dall'orchestratore per due
  difetti di T1 trovati dalle scene: col moto ridotto il guasto e l'attesa
  sono visibili subito e solo l'opacità dissolve (prima `visibility` arrivava
  dopo 90 ms e «Riprova» non prendeva il fuoco); lo strato è `role=region`
  col nome `app.avvio.regione`. Nel banco `openPage` riporta a zero
  `performance.now()` a ogni documento, perché l'orologio finto di Playwright
  lo tiene per contesto e lo strato passerebbe al guasto per tempo dopo
  qualche scena. `openStage` prende `port`, `bench:lampo` `--port`.
- 2026-11-04 · caricamento T2 · tolto da «Fatto quando» il limite di 25 ms
  fra due fotogrammi con la CPU rallentata 4×. Su server-di-fub, senza
  scheda grafica, il primo fotogramma ne prende 50–67 e la pulizia 67–83;
  alla domanda l'utente ha scelto «Lasciar perdere». Restano le foto della
  cascata e `bench:motion`.
- 2026-11-04 · caricamento · prototipo approvato dall'utente: attesa «scia» e
  passaggio «cascata» (le regioni dell'app entrano in ordine di lettura con la
  molla `elastic` di `moto`, 30 ms l'una dall'altra); il passaggio «si posa»
  resta solo nel prototipo · l'utente trovava il primo passaggio «troppo
  noioso» e ha voluto un effetto elastico in linea con lo stile di Fub.
- 2026-11-04 · caricamento · lo strato d'avvio sta in linea nei tre HTML (uno
  `<style>` uguale, due script classici in `public/avvio/`, una cache
  `fub.avvio` sua) e lo consegna la shell con `moto` a finestra e vault
  pronti · deve valere al primo disegno, prima di ogni modulo e col JS spento;
  la CSP vieta lo script in linea e la pelle arriva solo dopo il sanitizer.


- 2026-11-04 · Scrittoio 2 · le cinque domande di gusto: l'ombra resta
  quella di T27 ma la linguetta accesa la condivide, con la sagoma fusa col
  foglio; di notte nessun filo chiaro; le sezioni a 13 px (12 sotto i 900);
  la sezione scelta col nome a 600, con un doppio invisibile che tiene ferma
  la fila; il vassoio della barra a una riga e della colonna degli strumenti
  resta da decidere · parole dell'utente: «Deve sembrare fuso con il foglio
  anche per l'ombra». Il «sì» alla terza domanda («13 px, 12 sugli schermi
  stretti, o sempre 12?») l'orchestratore lo legge come la prima delle due.
- 2026-11-04 · Scrittoio 2 · T1: la voce del menu delle modalità deve portare
  il fuoco al suo riquadro prima di `setMode` (nota in T2), perché dove il
  clic non dà il fuoco al bottone il menu rende il fuoco all'editor dell'altro
  riquadro · visto in jsdom scrivendo T1; nessun file di produzione cambia in
  T1, la correzione va con T2, che riscrive quel menu.
- 2026-11-04 · Scrittoio 2 · il telefono è approvato per ora con la A, il
  tondo in basso a destra, scelta dall'orchestratore perché era la
  raccomandata e l'utente non ha scelto fra le due; la B esce dal prototipo.
  Il telefono si rifà a fondo in un piano successivo · parole dell'utente:
  «Per ora do l'ok, la aggiustiamo più avanti, ma è sicuramente da modificare
  pesantemente». Lo stesso giorno, tre richieste che entrano nel piano:
  l'ombra del foglio morbida, visibile ai fianchi e sfumata sotto (T27, nuovo,
  ruoli `--shadow-sheet` e `--shadow-sheet-focus`); il vassoio delle barre
  meno staccato dalla carta, `--bar-tray` a #f8fafc di giorno e #1a1f27 di
  notte (T16); le sezioni della barra a schede come le schede dell'ispettore
  (T20, T21). Sono eccezioni dichiarate alla «tavolozza intatta».
- 2026-11-04 · Scrittoio 2 · le risposte dell'utente: D1–D9 tutte A, titolo a
  600, «Figure» prima di «Emoji», prototipo del computer approvato. Il
  telefono è in revisione su sua richiesta: foglio da bordo a bordo,
  «Salvato» e la modalità come icone, il bottone della modalità in basso a
  destra sulla riga di Annulla e Ripeti, niente marchio in alto a sinistra.
  La lavagna segue il prototipo di N6 anche sul computer («il discorso del
  Canvas che fosse meglio nel prototipo originale è vero anche per il
  computer»): T23 fa solo l'icona della modalità.
- 2026-11-04 · scrittoio-2 · il menu delle modalità è il B, la spunta blu a
  destra con le scorciatoie in pastiglie (T10 porta il blocco `menu-b` in
  `skin/menus.css`) · parole dell'utente: «al momento preferisco la spunta
  blu a destra».
- 2026-11-04 · scrittoio-2 · la barra dei fogli diventa lo standard in `kit/` e
  `skin/kit.css` (`kit-bar`, `kit-ribbon`, `kit-rail`, `kit/toolbar-keys.ts`), e
  le baseline si rifanno una volta sola alla fine: T24 svuota `bench/baseline/`
  e T25 la riempie dal runner · la forma va scritta una volta nel proprietario
  e ogni barra la adotta, e `bench/scene.test.ts` vuole tutte le baseline o
  nessuna; il menu delle modalità nasce in `state/mode-menu.ts` e non in
  `document-controller.ts`, perché quel file lo sta cambiando N6.
- CI di PR #297 (orchestratore): i job dei banchi (visual, a11y, graph,
  benches) non avevano il toolchain Rust col bersaglio wasm32-unknown-
  unknown, e Vite non poteva compilare il nucleo della lavagna quando
  serviva la pagina: la shell del banco non partiva. Aggiunto lo stesso
  passo del job client. Nella stessa corsa la WebView vera è caduta solo su
  S1 per GTK che non si inizializza sotto Xvfb (tao event_loop), con tutte
  le altre misure, L1 compreso, sotto soglia: non è di N3 · fonte: log dei
  job 126262963796, 126262963801, 126262963812, 126262963882, 126262787875
- Orchestratore, CI di #297 (client in OOM): la causa è la prima build
  fredda del nucleo WebAssembly dentro il tempo massimo della prima prova
  (shell.e2e): con target/canvas-wasm vuoto le prove scadevano una dopo
  l'altra e la memoria cresceva. Riprodotto in locale (16 prove scadute a
  freddo). Correzione: un globalSetup di Vitest (build/canvas-wasm.global-
  setup.mjs) compila il modulo una volta prima delle prove; se cargo manca
  la suite parte lo stesso e falliscono solo le prove della lavagna, col
  messaggio del plugin. A freddo dopo la correzione: 117/117, compilazione
  23 s, memoria massima come su main (circa 1,4 GB). Commit d2783ebf.
- N3 T22 (6d5fb197, dal coder ed4d8c1c): una lavagna con una chiave doppia
  si apre in sola lettura con l'avviso `canvas.unwritable` (IT ed EN, le
  sole lingue del catalogo) e torna scrivibile da sola quando la chiave se
  ne va. Differenze dal piano: la domanda al nucleo è `preview([])` e non
  `commit([])` (stessi passi, non tocca la lavagna e tiene la regola di T16
  «mai una lista vuota a commit»); la sola lettura è `#unwritable` sommata a
  `#panelReadOnly` in un getter `#readOnly`; l'avviso si calcola in
  `#drawToolbar` (prima l'avviso dell'ultimo gesto, se no
  `canvas.unwritable`, mai oltre il limite interattivo); `syncDoc` chiede al
  nucleo solo se il testo è cambiato. Aspetta: l'avviso sta in fondo alla
  barra, che va oltre lo schermo anche a 1280 px, quindi senza scorrerla non
  si vede (vale già per gli avvisi di prima); spostarlo cambia la pelle o il
  layout, fuori dal Tocca: chiesto all'utente (all'inizio della barra, una
  striscia sopra la lavagna, o com'è). Rischi: un testo con la chiave doppia
  che arriva da un'altra superficie mentre si scrive in una scheda chiude il
  campo e quel testo si perde, come con `setReadOnly` del pannello; ogni
  testo nuovo costa una `preview` in più nel nucleo, non misurata.
- N3 T21 (b652f0c1, dal coder cbdc32cf): annulla e ripeti della tela
  rimettono il tratto di prima byte per byte con un `reset` quando il testo
  è ancora quello lasciato dal passo; se no passano le toppe inverse al
  nucleo, come prima. Differenze dal piano: la versione non è un contatore
  che cresce soltanto: ogni testo nuovo (gesto, annulla per toppe, `setDoc`,
  `syncDoc` che cambia il testo) prende un numero mai usato, mentre un
  annulla o ripeti a byte ridà al testo il numero che aveva (ogni passo
  tiene `version` e `restores`), se no dopo annulla e ripeti la storia più
  vecchia ricadeva sulle toppe; il passo tiene anche le toppe dirette
  (`back`) per il passo opposto, perché un `reset` non dà inverse; oltre
  alla versione si controlla che il tratto sia davvero nel testo, e se
  `reset` rifiuta restano le toppe. Controprova del coder: forzando la via
  delle toppe cadono 11 test su 13. Rischio: un passo grande tiene in
  memoria il testo tolto, al massimo 100 passi e senza limite di byte.
- N3 T20 (1c3c37c0, dal coder f42acbcb): la riscrittura di una lavagna tiene
  i null dei campi noti, non aggiunge gli array `nodes`/`edges` assenti e le
  toppe dei collegamenti portano `at`; spostare una scheda di Obsidian
  cambia solo i byte della coordinata (test in `fub-
  features/src/lavagna/apply.rs`). Differenze dal piano: il coder ha
  rigenerato `canvas-mirror.json` con UPDATE_MIRROR, che la nota diceva di
  non toccare ma è un file derivato (25 casi cambiati, verificati uno per
  uno: solo collegamenti, null e tratti più piccoli); `operation.test.ts`
  ora ha `at: 0`; una scheda ricomposta tiene i byte dei campi che non
  cambiano; il vettore 18 è diventato `18-null-kept-on-rewrite.json`.
  Rischio: un null che prende un valore e poi si annulla sparisce del tutto
  (vettori 74 e 86), scritto nella pagina del formato; i casi del null
  richiesto e di BOM+CRLF su una riga stanno in `source_edit.rs`.
- 2026-11-03 · N3 T18 · Il TypeScript della lavagna è tolto (model.ts resta
  solo tipi; parseCanvas, serializeCanvas, isValidCanvas, emptyCanvas,
  isCanvasOperation, source-edit.ts e i loro test via): i 101 casi tolti
  sono diventati vettori canvas-read/01–81 e canvas-patches/46–70, letti da
  Rust (tests/read_vectors.rs) e dal mirror wasm; la tabella caso → vettore
  è nel resoconto del coder. Una lavagna rotta tenuta mentre il nucleo si
  carica passa alla superficie d'errore per un canale onFail
  (SurfaceCallbacks → document-controller.failSurface), toccando
  editors/canvas/surface.ts; due e2e aspettano con waitFor la superficie
  d'errore e controllano che nel frattempo non si veda niente di
  modificabile. Scartato un ready?() nel registro: rallenterebbe l'apertura
  di una lavagna buona e toglierebbe il riquadro aria-busy. I vettori di
  lettura hanno un campo extra. Rischi rimasti: commit([]) arriva al nucleo,
  che su una sorgente vuota scrive la lavagna intera (il motore non lo manda
  mai; scritto in canvas-format.md e wasm/core.test.ts); i disegni
  (spatial/lazy.ts) mostrano ancora avviso più toast invece della superficie
  d'errore; il messaggio di panic di ts_mirror.rs nomina ancora il vecchio
  mirror.test.ts · perché la regola del formato vive una volta sola, in Rust
- N3 T19 (orchestratore): `settlePending()` è pubblico invece di
  `#settlePending`, perché anche i metodi della collezione (release,
  discardUnsaved, handleExternalRemoval, il congedo) lo chiamano prima di
  leggere `dirty`. La porta ha anche `watchPending`, un'iscrizione col suo
  disposer, per check-listeners. La descrizione della porta e della cadenza
  sta in frontend-and-ipc.md («Il testo in sospeso») perché editor-
  surfaces.md era al limite delle 450 righe: lì c'è un rimando. `written()`
  usa il documento mostrato dal riquadro, perché durante un cambio di tab il
  testo registrato allo stacco è del documento di prima. Un salvataggio
  riuscito con testo ancora in sospeso tiene la bozza e la riscrive sulla
  base nuova. Ho rimesso al suo posto il commento di `renderMarkdownForCard`
  (f56444dc).
- T16 (7592cc3a): la tela usa il nucleo. Il campo di una scheda resta aperto
  attraverso `syncDoc` e il suo testo in sospeso si registra subito dopo,
  sulla scheda com'è nel testo nuovo; Invio in una scheda di testo registra
  all'input che segue (l'a capo); `setReadOnly(true)` chiude il campo; la
  seconda trappola di fila mostra l'avviso e non riprova fino al testo dopo.
  Durante il caricamento pigro la superficie usa ancora `parseCanvas` per
  dire subito che un testo non è una lavagna: T18, che toglie il modello
  TypeScript, lo sostituisce. Chiave nuova `canvas.card_invalid` accanto a
  `canvas.card_too_long` e `canvas.core_unavailable`. La porta del nucleo è
  iniettabile (`CanvasEngineOptions.core`) per i test che contano le
  chiamate; `registry.test.ts` carica il nucleo in un `beforeAll`. La tela
  non manda mai una lista vuota a `Core::commit` (risponde `request`), così
  il rischio di T14 non si presenta. Resta: un intero oltre 2^53 in un campo
  sconosciuto si arrotonda passando dal JavaScript; a 700 px la barra degli
  strumenti della tela esce a destra (già così sulla base). Il banco apre un
  `.canvas` solo dal lanciatore: l'host finto lo elenca senza visualizzatore
  (già così).
- 2026-11-03 · N3 · T15 integrato (d3c348be la CSP, il test e la decisione
  0237; 4b45dbd0 lo scenario L1; 8adf925e la misura). La CSP apre solo
  `'wasm-unsafe-eval'` in `script-src`; il test di `platform_configs.rs`
  legge la config fusa di ogni piattaforma e `devCsp`, con 16 casi in
  negativo (anche `script-src-elem`/`-attr` e una direttiva doppia). L1 in
  `bench:webview` fallisce con un messaggio chiaro su un errore di CSP;
  l'orchestratore l'ha messo nel job `webview` (57f11a32, solo il nome del
  passo e `--only`: il nome del job resta, perché lo cita il cancello del
  rilascio). Misure: modulo 449,5 KiB grezzi, 164 182 B gzip (contro i ~56
  KB della prova 1 del piano), commit su 2000 schede 5–8 ms al p95 in Node e
  in WebKitGTK 2.54; soglie ci di L1 provvisorie (3× il peggiore locale,
  minimo 10 ms), da ritarare a 1,5× il peggiore del runner dopo il primo
  giro (T23). Da sapere su server-di-fub: con sccache un cambio della sola
  `tauri.conf.json` non ricompila `generate_context!` e il binario tiene la
  CSP vecchia; per provarla si tocca `crates/fub-app/src/lib.rs` o si
  compila senza sccache.
- 2026-11-03 · N3 · le risposte dell'utente alle domande nuove: D-9 (b), le
  lavagne con valori sconosciuti in un campo noto si aprono dentro N3 (un
  prototipo e due task prima di T23, li scrive il pianificatore); D-10 (a),
  Esc registra e chiude; A14–A18 approvate; la riga di CLAUDE.md di T14
  approvata · D-9 (b) è il consiglio dell'orchestratore contro quello del
  pianificatore (a): N3 cambia già il modello della lavagna, e un file
  dell'utente che non si apre è il difetto più grave.
- 2026-11-02 · N3 · Le risposte dell'utente a D-1…D-8 e a merge-n3n4: le non
  ovvie sono tre. D-5 (c): il testo di una scheda si registra a pause di
  circa 250 ms, Esc registra invece di buttare (la D-10 nuova chiede
  conferma), il testo ancora nel campo va nelle bozze, e il ritardo della
  bozza diventa una cadenza per ogni documento (T16, T19). D-7 (c): Fub
  riscrive conservando i null dei campi noti, gli array assenti e il posto
  degli archi, l'annulla della tela torna ai byte di prima, e una lavagna
  che non si riscrive senza perdere niente si apre in sola lettura (T20–T22;
  i valori sconosciuti dei campi noti restano fuori, D-9). merge-n3n4 (b):
  N3 entra in main solo finito, dopo la CI completa e una revisione riga per
  riga (T23) · non perdere dati e non cambiare senza dirlo i file degli
  altri programmi vengono prima della comodità, e N3 a metà in main
  lascerebbe due copie della logica.
- 2026-11-02 · N3 · T17: fatto con D-4 (a), solo la misura: il banco
  `tools/ink-wasm-banco/` (nessuna crate nuova nel lock) e `wasm.bench.ts`,
  che si salta senza il `.wasm`. Il primo giro era a macchina carica; la
  pagina tiene i tre giri rifatti con il carico sotto 2,5. La condizione del
  passo 12a non è vera per intero: un evento per chiamata, il WebAssembly è
  4,3 volte più lento col mouse e il 16% con lo stabilizzatore, pari con la
  penna; il riduttore da solo è pari o più veloce. La pagina non dice che
  cosa fare: resta all'utente con D-4.
- 2026-11-02 · N3 · ADR 0234 allineato: la lavagna non è più fra i
  componenti senza bundle, perché da T10 è il bundle fub.lavagna. Perché:
  l'ADR deve dire com'è fatto il codice.
- 2026-11-02 · N3 · T12: gli strumenti MCP fub_canvas_create e
  fub_canvas_apply chiamano canvas.create e canvas.apply con gli id scritti
  come costanti, come note.create, perché fub-cli non dipende da fub-
  features; fub_canvas_apply risponde {doc, dry_run, outcome} in prova e
  {doc, dry_run, created, revision} applicato, e check_read più check_write
  valgono anche in prova (in sola lettura nemmeno la prova passa); l'MCP non
  passa il seme, quindi gli id nuovi vengono dalla revisione. Se
  fub_canvas_create crea un nome diverso da quello provato, lo dice invece
  di tacerlo. Perché: un agente crea e riempie una lavagna con le stesse
  regole di accesso degli altri strumenti.
- 2026-11-02 · N3 · T11: canvas.create scrive come sorgente la lavagna vuota
  del nucleo (patch_source su Canvas::default, riletta con Core::open prima
  di scrivere), perché il nucleo non ha una funzione apposta; senza nome
  prende il primo libero («Lavagna», «Lavagna 1», in inglese «Whiteboard»),
  e un nome preso è un conflitto che non sovrascrive. Il codice dei nomi è
  una copia di drawing.create, perché le feature non si importano fra loro;
  l'annulla porta la lavagna nel cestino e richiede la feature commands,
  come drawing.create. Perché: un file nuovo è già una lavagna che il nucleo
  apre.
- 2026-11-02 · N3 · T10: il componente «Lavagna» (fub.lavagna) porta
  canvas.apply; il seme degli id usa l'Fnv1a del contratto; spegnere
  fub.lavagna toglie solo canvas.apply, e il test fub-cli
  spegnere_la_lavagna_dice_che_la_penna_non_serve_piu è stato aggiornato di
  conseguenza (opzione a: dice con precisione che cosa sparisce, non è
  indebolito). Resta da allineare l'ADR 0234, che mette ancora la Lavagna
  fra i componenti senza bundle. Perché: la lavagna diventa un componente
  che si scrive come gli altri, e un componente spento toglie solo ciò che
  porta.
- 2026-11-02 · N3 · T9: lo specchio a caso fra fub-canvas-core e la lavagna
  TypeScript ha 2051 casi (1333 sorgenti, 718 prove con toppe) in una
  fixture di 501 KB, un sorgente per riga con le sue prove per stare sotto i
  512 KB. Ha trovato una divergenza (26 casi): in una toppa il TS trattava
  un campo noto a null diversamente dal nucleo Rust; corretto il lato TS
  secondo R7 (null vale come assente, sia nel dopo sia nel confronto del
  prima), vettori 44 e 45.
- 2026-11-02 · N3 T7 · il commit in Rust (`fub-canvas-core/src/commit.rs`:
  `Core`, `Committed{source,inverse,edit}`, `Edit::between/apply` ai confini
  di carattere, `CommitError` Stale/Invalid/Rejected/Unstable con
  `reason()`) e 43 vettori in `apps/client/src/__fixtures__/canvas-patches/`
  letti da Rust e da TS; in TS `canvasCommitOutcome` accanto a
  `commitCanvasPatches`, che non cambia; `parseNode` di `model.ts` allineato
  a Rust (limiti solo per il campo del tipo della scheda, niente limite
  sullo sfondo) · i due lati devono dare gli stessi byte; rischi: il TS ora
  scrive i campi nuovi nell'ordine di Rust (stesso valore, byte diversi),
  un'immagine con le chiavi in un altro ordine e uno sfondo di 9000 byte ora
  si aprono; manca un vettore «unstable»; una lista di toppe vuota fa in
  Rust un commit che non cambia niente, in TS dà null.
- 2026-11-02 · N4 T9 · la lettura e la scrittura dei record nel client
  (`editors/canvas/ink-record.ts`): `readInkLayers` nell'ordine dei vettori
  di T5, `inkLayerWritable`, `defaultInkLook(zoom, pressure)` con la biro di
  4 px dello schermo, `strokeRecord` coi rifiuti `full`, `failed`, `empty`,
  `toDry` e `dryStroke` con la cache dei percorsi; `ink-vectors.test.ts`
  legge i 28 vettori · lo strato chiama `look()` all'inizio del tratto: T12
  deve applicare `joined` ai pezzi `continued`.
- 2026-11-02 · N4 T7 · il kit della prova con Obsidian in
  `tools/prova-obsidian/` (una lavagna con l'inchiostro, `confronta.mjs` che
  confronta per valore prima e dopo, coi suoi test `node --test`) e la
  sezione «Obsidian» in `canvas-ink.md`; si confronta anche il `fub:ink` di
  un arco come prova sui campi sconosciuti; il test del kit non entra in CI,
  si lancia a mano · i nomi dei menu di Obsidian nel README sono in inglese
  e non verificati su un Obsidian vero.
- 2026-11-02 · N4 · merge di `piano/n3-logica-in-rust` (fino a T8) dentro
  `piano/n4-inchiostro`, con un merge e non un rebase: PLAN.md resta quello
  di N4, DECISIONS.md e `docs/README.md` tengono le righe di tutti e due ·
  senza, la PR #298 era in conflitto con la sua base e la CI non partiva; va
  rifatto quando N3 cambia di nuovo PLAN.md o DECISIONS.md.
- 2026-11-02 · N4 T5 · la forma `fub:ink` in `docs/reference/canvas-ink.md`
  con 28 vettori, uno per file, in
  `apps/client/src/__fixtures__/canvas-ink/`; ADR 0238 «proposta» (0236 è di
  K3, 0237 di N3 T15); le ragioni si guardano nell'ordine tool, anchor,
  color, brush, ink; un canale sconosciuto vale `ink`; id vuoto, tratto non
  oggetto, `fub:ink` non oggetto o `v` assente fanno il livello estraneo,
  con `strokes: []`; i livelli nell'ordine di `nodes`, poi la radice; i
  campi sconosciuti dell'ancora restano dopo kind, width, height · T8 in
  Rust e T9 in TypeScript leggono gli stessi vettori e devono dire le stesse
  ragioni.
- 2026-11-02 · N4 T4 · lo strato d'inchiostro
  (`editors/canvas/ink-layer.ts`, `ink-paint.ts`): una penna alla volta,
  perché la sessione fa un tratto alla volta (la seconda è fermata e
  ignorata); i suoi eventi si fermano con `stopImmediatePropagation` prima
  della lavagna, i click solo con `detail > 0`; un SVG annidato per ogni
  gruppo consecutivo di tratti con la stessa misura; `InkPathCache` con
  `sweep()`; `INK_ASPECT = "none"` (D-9 a); `data-ink-stroke` sui tratti per
  la gomma di T13 · la lavagna non vede mai un tratto come un trascinamento;
  rischio: l'SVG sta in `inset: 0` e un bordo vero della scheda (T16) lo
  sposterebbe.
- 2026-11-02 · N4 T3 · la scheda sotto il tratto
  (`editors/canvas/anchor.ts`): solo geometria sulle coordinate della
  lavagna, il riquadro del tratto allargato di metà spessore, nessun `NaN`
  (punti non finiti saltati, riquadro che trabocca = tratto libero) · lo
  chiede lo strato una volta sola, quando la penna si alza.
- 2026-11-02 · N4 T1 · la politica del mouse in `fub-ink` (`roles.rs`,
  `setMousePolicy`): `ink` di serie, `ignore` lascia il tasto principale a
  chi sta sotto; vale dal prossimo appoggio; un puntatore di tipo
  sconosciuto segue il mouse · la regola di serie resta com'era per i
  disegni, e la lavagna può tenere il mouse per selezionare.
- 2026-11-02 · N4 T2 · `PenQuiet` (`ink/quiet.ts`) con la coda per chiave letta viva mentre gira (un `defer` da un lavoro toglie il vecchio della stessa chiave e gira subito; un `enter` da un lavoro ferma il giro), `dispose` azzera il conto; `idleSchedule` (`ink/dom/idle.ts`) usa la `Lifetime` di `ui/lifetime.ts` con un solo smontaggio per tutte le richieste in attesa · così un lavoro vecchio non gira mai dopo uno nuovo della stessa chiave, e una lavagna aperta a lungo non accumula smontaggi; più errori nello stesso giro: si rilancia il primo e gli altri si perdono, come in `dom/pointer-adapter.ts`.
- 2026-11-02 · N4 · piano: il formato `fub:ink` sulla lavagna (campi nel
  `.canvas`, strada A, con la stringa dei punti della §5 dei disegni e la
  misura della scheda al momento del tratto) è un'assunzione del
  pianificatore, scritta di notte: l'utente la conferma (D-1, D-2) prima
  dell'ondata 2, perché altri programmi leggeranno il file e cambiarlo dopo
  vuol dire una `v: 2` e una conversione.
- 2026-11-02 · N4 · piano: il codice dei punti e dei pennelli (`ink.rs`,
  `brush.rs` di `fub-scene`) passa in un crate piccolo, `fub-ink-codec`, che
  dipende solo da `fub-ink`; il nucleo della lavagna lo usa con
  un'eccezione nominata nell'invariante delle dipendenze: il nucleo non può
  portarsi dietro il lettore XML dei disegni, e una seconda copia del codec
  sarebbe una divergenza da tenere d'occhio per sempre.
- 2026-11-02 · N4 · piano: ogni tratto è una toppa `ink` sul suo livello
  (`LayerRef`: la lavagna o una scheda), non un `upsert-node` della scheda
  intera: con 2000 tratti l'annulla terrebbe due copie della scheda intera
  per ogni tratto (la misura dei byte la fa T10).
- 2026-11-02 · N4 · piano: `PenQuiet` è puro, con lo scheduler passato da
  fuori e una chiave per lavoro: il nucleo dell'inchiostro non usa globali
  del DOM (ADR 0204), i timer passano da una `Lifetime`, e due richieste per
  la stessa cosa ne fanno una.
- 2026-11-02 · N3 T8 · operazioni d'intento (`ops.rs`): un id che non è né
  scheda né arco in `remove`/`set` dà `UnknownEdge`; `set` vale anche sugli
  archi; un id dato già preso o ripetuto in `ids` dà `DuplicateId`; `reorder
  {ids}` porta in cima gli id dati, nell'ordine dato; gli id nuovi vengono
  da SplitMix64 sul seme (`IdSource`, sedici cifre esadecimali); ogni scheda
  e arco messi passano `Canvas::validate`; l'`at` delle `remove-node` è la
  posizione all'inizio della serie, anche fra due operazioni; i vettori
  hanno l'esito `malformed` per un'operazione che non si legge · così il
  TypeScript (T14, T16) rifà lo stesso generatore e le stesse posizioni dai
  vettori, e l'inversa rimette ogni scheda al suo posto.
- 2026-11-02 · N3 · T5: `patch_source` ritocca il sorgente con uno
  scanner suo, più severo di quello TypeScript (rifiuta virgola finale e
  valori vuoti, si ferma a 256 livelli, `SourceError::TooDeep`); gli archi
  nuovi si scrivono nell'ordine di R10 (fromNode, fromSide, fromEnd,
  toNode…), costruito in `edge_value` e non dall'ordine della struct; una
  radice ricomposta senza `edges` lo riceve in fondo, come in TypeScript; un
  array che non corrisponde al modello di prima si riscrive per intero. Le
  schede si confrontano come struct e diventano JSON solo se cambiate: 2000
  schede, una cambiata, ~0,8 ms in release (macchina carica). Il confronto
  per valore è uno solo, `patch::same_value`, usato anche dal ritocco.
  Perché: stessi byte di TypeScript dove TypeScript segue R1–R10; T7 porta
  il TypeScript all'ordine R10 degli archi e lo specchio di T9 lo controlla.
- 2026-11-02 · N3 · T6: `PatchError` ha una variante per ogni rifiuto
  (`Stale` con il soggetto, `AtOutOfRange`, `NodeHasEdges`,
  `MissingEndpoint`, `NotAPermutation`), tutte con la posizione della toppa,
  dove TypeScript dà solo `null`; `after: null` si legge solo da `null`;
  `at` negativo o con la virgola è un errore di lettura (TypeScript lo
  scarta nella bozza); `draft` non chiama `Canvas::validate`, come
  `canvasDraft`: il modello di dopo lo controlla il commit (T7). Portate
  anche `upsert_node_patch` e le sorelle, che servono a T8. Restano come in
  TypeScript l'inversa di un inserimento senza `at` e l'arco rimesso in
  fondo, fissati da un test. Perché: errori tipati e stessa forma JSON.
- 2026-11-02 · N3 · T3: in Rust R2 è un solo visitor (`SafeInteger`) che
  porta il nome del campo nell'errore, R7 un `null_as_empty` su `nodes` ed
  `edges`; il nucleo espone `read::is_blank` (la regola di
  `isBlankCanvasSource`) e `model::MAX_SAFE_INTEGER`, nessuna variante nuova
  di `CanvasError`. R3, R4 e R5 li rifiutava già `serde_json`: i test li
  fissano. Fuori da R1-R10 la validazione diverge ancora: TypeScript limita
  `background` a 8192 byte e `subpath`/`url` su ogni scheda, Rust no e solo
  sul loro tipo; per la regola «nel dubbio si apre» si allinea il
  TypeScript a Rust in T7, e lo specchio di T9 lo controlla.

- 2026-11-02 · N3 · T4: `js.rs` espone, oltre a `js_number`, `js_string`,
  `encode` ed `encode_pretty`, anche `js_json_number`, `is_array_index` e
  `js_entries` (l'ordine delle chiavi di JavaScript, che serve a T5 per
  R10); `encode_pretty` non mette il `"\n"` finale, lo aggiunge chi scrive il
  file; `js_number` su `NaN` e infiniti fa come `String(x)`. Il pareggio
  esatto si cerca sull'espansione decimale solo quando è possibile
  (`x = M·2^E` con `E = unit − 1`): in release un numero costava circa 2 µs,
  ora 0,1-0,3; i test confrontano la strada veloce con l'espansione intera su
  202 000 numeri, e fuori dal repo 400 000 numeri contro Node non danno
  differenze.

- 2026-11-02 · N3 · T1: `fub-canvas-core` ha un blocco suo nel grafo delle
  dipendenze di `overview.md` (il quarto diagramma), perché il primo era già
  a 20 riquadri; `read.rs` tiene il BOM e gli spazi come li leggeva
  `fub-format-canvas` (le regole di R1-R8 sono di T3); il nucleo riesporta
  `PresetColor` e `parse`, e `fub-format-canvas/src/model.rs` è un `pub use`
  del nucleo più `FORMAT_ID` e `SCHEMA_VERSION`. Il controllo per
  `wasm32-unknown-unknown` sta nel giro completo di `scripts/check.sh` e nel
  job `invariants` della CI, che l'orchestratore ha aggiunto.

- 2026-11-02 · N3 · T2: in TypeScript i controlli di R3, R4 e R5 stanno
  nello scanner di `source-edit.ts` (`inspectCanvasJson`), una passata sola
  sul testo dopo `JSON.parse`, e non in un reviver: misurato a 2000 schede,
  il reviver portava la lettura da circa 17 a 23 ms, lo scanner la lascia a
  13-14. La regola del vuoto (`isBlankCanvasSource`) è una sola, per il
  lettore e per il riscrittore. `backgroundStyle` è qualunque stringa senza
  limite suo (resta quello di 16 MiB del file), come in Rust; `-0` si legge
  `0`, come un intero Rust.

- 2026-11-01 · regole · L'orchestratore e i coder decidono da soli il come
  tecnico, i formati interni, le dipendenze fra crate del workspace e i file
  legati al task; «Chiede sempre» resta per ciò che si vede, il contratto
  pubblico, sicurezza, dipendenze esterne, scope, test e merge; il criterio è
  il risultato migliore, non la strada più corta · fonte: l'utente («mi stai
  facendo troppe domande … ti voglio più autonomo»; «voglio sempre ottenere il
  risultato migliore, non importa se ci mettiamo più tempo o più risorse»).
- 2026-11-01 · K1 · L'assunzione A2 era sbagliata: un campo in coda a un
  record rompe i plugin compilati prima (il guest a undici campi del manifest
  non si istanzia nell'host a sedici); `0.2.0` non è pubblicata e K1 resta, ma
  dal primo rilascio un record pubblicato non cresce e le novità passano da
  interfacce nuove · fonte: prova dell'orchestratore con `ping-wasm` compilato
  su `d235d3f6`, decisione con l'utente; ADR 0235. Fuori dal Tocca, con
  l'OK dell'utente: la riga dell'esempio in `exclude` del `Cargo.toml` della
  radice e la frase sull'additività in `docs/architecture/document-model.md`.
- 2026-11-01 · K1 · Via MCP accendere e spegnere un componente con `apply`
  vogliono tutto il vault fra le radici di scrittura, come un piano che non
  dice quali note tocca: un componente cambia il comportamento di tutto il
  vault · fonte: revisione dell'orchestratore su T4 (il coder chiedeva una
  radice qualsiasi); ADR 0234.
- 2026-11-01 · K1 · `fub-cli` dipende da `fub-componenti` (con la freccia nel
  grafo di `overview.md`): i tipi del risolutore (`Stato`, `Effetto`,
  `Perche`, `Errore`) non sono riesportati da `fub-features` e la CLI li
  usa nelle firme e nei `match` · fonte: blocco del coder di T4, scelta
  dell'orchestratore (l'alternativa toccava `fub-features`, fuori dal Tocca).
- 2026-11-01 · K1 · La mappa vera (`fub-features::componenti`): le righe
  senza feature Cargo sono 7, non 4 (anche `fub.core`, `fub.maintenance`,
  `fub.importers`, che oggi si compilano sempre); `SOLO_DELLA_MAPPA` è
  `fub.markdown`, `fub.dizionari`, `fub.penna` e i due motori, ognuno col suo
  perché; una feature marcatore nuova `http-client` per le righe di sync,
  publish, updates e linkcard; `rich` e `xlsx` portano con sé i loro motori ·
  fonte: report del coder di T3; il codice vince sul «Fatto quando» del piano.
- 2026-11-01 · K1 · I requisiti che esistono solo per la mappa
  (`fub.markdown`, `fub.dizionari`: nucleo e componenti senza bundle) stanno
  nella riga di `fub-features::componenti`, non nel manifest; il manifest tiene
  i `requires` di oggi, perché il kernel soddisfa un requisito solo col
  `provides` di un bundle montato (`provider_of`) · fonte: risposta
  dell'utente al blocco del coder di T3; altrimenti le feature delle note non
  si monterebbero più.
- 2026-11-01 · K1 · T3 tocca anche i due blocchi di `mount.rs` che montano
  `fub.rich` e `fub.xlsx` fuori dal ciclo ufficiale (~376–404), solo per i
  campi della riga; righe anche per `fub.core` e `fub.maintenance` (il nucleo
  deve avere una riga); `fub.draw` resta fuori dal `default` come oggi e non
  richiede `fub.markdown` · fonte: risposta dell'utente; il resto deciso
  dall'orchestratore (il codice vince).
- 2026-11-01 · K1 · `Delivery` nel JSON è un enum con tag interno `kind`
  (`{"kind":"download","url":…}`), e la validazione di `fub-wasm-host` accetta
  lo sha256 in esadecimale maiuscolo o minuscolo; la conversione WIT → Rust di
  0.2.0 sta in `translate.rs`, `compat.rs` (ABI legacy) prende i default ·
  fonte: report del coder di T1.
- 2026-11-01 · K1 · Le regole di `fub-componenti` che il piano lasciava aperte:
  un requisito offerto via `provides` da più componenti è un errore della mappa
  (`RequisitoAmbiguo`); `attivi` segue i `requires` anche dal nucleo;
  `applica_profilo` svuota `in_attesa`; `Richiesto { da }` elenca i dipendenti
  a catena, e `spegni_con_dipendenti` dà `Nucleo` se la catena lo tocca;
  `perche` ha anche `Nucleo` e `Sconosciuto` · fonte: report del coder di T2,
  accettato dall'orchestratore; chi costruisce la mappa (T3) non può dichiarare
  due offerenti dello stesso requisito.
- 2026-11-01 · K1 · T1 tocca anche `crates/fub-abi/src/lib.rs` (`ComponentKind`
  e `Delivery` nel `pub use`, per `superficie_della_radice`) e
  `apps/client/src/host/enums.generated.ts`, solo rigenerato con
  `UPDATE_MIRROR=1 cargo test -p fub-abi --test ts_enums` · fonte: risposta
  dell'utente al blocco del coder; un enum senza payload in `fub-abi` porta
  sempre con sé la sua riga nel derivato TS.
- 2026-11-01 · K1 · Le PR #261–#269 (N13, N1, N2, K0) sono tutte in `main`:
  #269 è stata unita con lo stack intero, le altre chiuse perché contenute,
  #264 unita il 31/10 · fonte: `gh pr list`; nessun task di K1 aspetta una PR.
- 2026-10-31 · K0 · Il livello 3 della consegna sono le **edizioni**; niente
  librerie caricate a runtime (ADR 0233) · fonte: `piani/STATO.md`, risposte
  del 31/10 mattina; in K1 è il caso `Delivery::Edition` del manifest.
- 2026-10-31 · K0 · La tolleranza di R1 sta in
  `apps/client/bench/webview/budgets.json` (residuo 50 MiB, pendenza 1 MiB a
  giro; nella CI 480 e 20) · fonte: `piani/STATO.md`; è il metro di «spento non
  costa» per i task che misurano.
- 2026-10-31 · N2 · Il server MCP sta in `fub-cli mcp` sulla stessa
  `Connection` (passa dall'app se tiene il vault), protocollo scritto a mano
  (stdio, JSON-RPC sincrono), niente `rmcp` (ADR 0232,
  `docs/reference/mcp-server.md`) · fonte: `piani/STATO.md`; gli strumenti
  nuovi (i componenti di K1) seguono la stessa forma e i nomi `fub_*`.
- 2026-10-31 · N2 · Senza `--automation-write-root` il server è in sola
  lettura; senza `--automation-read-root` si legge tutto il vault;
  `fub_invoke` senza `apply` è una prova · fonte: `piani/STATO.md`; vale anche
  per accendere e spegnere componenti via MCP.
- 2026-10-30 · tasto destro (piano 2) · Le parole dei componenti sono
  Accendi, Spegni, Serve a…, Non serve più, Togli, Tienili, «Accendi…»; regola
  12: un componente spento non ha voci · fonte: `piani/STATO.md`; K1 le usa
  nei testi della CLI, K2 nel client.
- 2026-10-31 · piani · Le domande aperte dei piani seguono il loro
  «Consiglio» se l'utente non dice altro · fonte: `piani/STATO.md`,
  «Questions for the user».

- 2026-10-31 · workflow · Il piano vive in `PLAN.md` (e il prototipo in
  `PLAN-ui/`) sul branch del piano, e se ne va con l'ultimo commit prima del
  merge · una sessione sul web vede solo ciò che è su GitHub; dopo il merge
  restano il codice e questo registro.
- 2026-10-31 · workflow · Una PR in bozza ha la CI corta (Linux); segnata
  pronta ha la CI completa. I banchi del client girano sulle PR pronte solo se
  cambia `apps/client/`; su `main` gira sempre tutto · Windows, macOS e banchi
  costano tanto e servono una volta per piano, prima del merge.
- 2026-10-31 · workflow · I coder non lanciano altri agenti, non pushano e non
  toccano la CI; pusha solo l'orchestratore, una volta per task unito · un solo
  punto che integra, e la CI di ogni push copre tutto ciò che c'è prima.
- 2026-11-11 · banco · I due rossi della CI completa (79c3045a4) corretti fuori lista
  prima di T25: col menu aperto la pila dei toast si fa da parte (`structure.css`; da
  T3 il menu della modalità si apre in basso a destra, dove scendono i toast, e
  `#app` isola i suoi piani); `menu-edge` clicca l'ultima riga visibile (la riga dei
  dati di T12 spinge l'ultima del DOM sotto la banda); la pastiglia del titolo non
  fa più crescere la riga del cursore (salto di 7–9 px, già su `main`) · le
  baseline di T25 si prendono dopo, con questi cambi dentro.
