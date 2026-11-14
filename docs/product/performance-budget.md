# Budget prestazionale

> **Ambito:** i numeri e i gate di prestazione del prodotto: la Graph View
> (evidenza osservazionale e criteri provvisori), i
> [disegni grandi](#i-disegni-grandi) applicati in CI e il
> [budget d'interazione](#il-budget-dinterazione) dello Scrittoio, fuori
> dalla CI, che include [la battuta](#la-battuta),
> [l'apertura di una nota grande](#lapertura-di-una-nota-grande) e
> [il cambio di nota](#il-cambio-di-nota).
> **Snapshot applicativo della Graph View:** SHA `4383a7c9d54b1e6557d070501e5ad998224ff294`.

Questa pagina documenta tre distribuzioni dello stesso codice (locale, CI push e
CI PR). Le misure descrivono quelle esecuzioni e quella fixture deterministica;
non sono claim universali sulle macchine, sui browser o sui grafi arbitrari.

## Ambiente e comandi

Il runner registra Node, Chromium, piattaforma, CPU, viewport e preferenze media
nel referto. I comandi canonici dei banchi sono in
[testing-and-quality.md](../development/testing-and-quality.md#banchi) (lo
script è [`graph-scale.mjs`](../../apps/client/bench/graph-scale.mjs), richiamato
dagli script npm di [`apps/client/package.json`](../../apps/client/package.json)).

La stessa sequenza di scala è nel job «banchi del grafo (scala e heap)» di
[`ci.yml`](../../.github/workflows/ci.yml). Il timeout di sicurezza
canonico resta **30 s per campione**. Il referto `pass` include i controlli hard di lifecycle e, sul comando
10k/seed 6 con almeno 16 finestre, anche il gate di stabilizzazione heap.
I budget di frame time restano osservazionali e non sono applicati dalla CI.

Il banco apre la pagina con l'ora vera, non con l'ora ferma del banco visivo.
L'orologio di Playwright guida timer e `requestAnimationFrame` con timer
propri, e le loro closure restano nell'heap della pagina: fanno salire di
qualche centinaio di byte a finestra la coda che il gate misura, senza che
l'app trattenga niente. Senza di lui un frame è quello del compositore. Le
distribuzioni qui sotto sono state misurate prima, con l'ora ferma.

La macchina della distribuzione locale non è nota: non è quella su cui si
sviluppa Fub. Ne restano il sistema, Linux x64 `6.12.107+deb13-amd64`, Node
`22.23.1`, 4 CPU logiche e 16 539 889 664 byte di RAM. Il browser era
Chromium `149.0.7827.55`, viewport 1280 × 800, DPR 1,
`prefers-reduced-motion: reduce` e schema scuro. I due job CI
usavano `ubuntu-latest`, Node `22.23.2` e Chromium `149.0.7827.55`; Actions non
espone modello CPU e RAM dei runner, quindi quei dati restano non disponibili.

## Definizioni

- **p50/p95/max:** quantili e massimo degli intervalli tra frame, in
  millisecondi, calcolati sul campione ordinato; `p95` è l'elemento alla
  posizione `floor(count × 0,95)` (limitata all'ultimo elemento).
- **Initial:** 120 frame di interazione al primo mount, dopo l'azione
  **Riscalda**. Il campionamento viene armato prima del riscaldo, nella stessa
  chiamata al browser, per non perdere frame durante la preparazione.
- **Soak:** finestre successive attivate dalla stessa sequenza; ogni finestra
  raccoglie 120 frame.
- **Total:** `timings.totalMs` del referto, dall'avvio del runner al termine
  del teardown, prima della scrittura del report.
- **Resource delta:** risorse tracciate dopo close meno la baseline prima del
  mount, per tipo e totale. Il criterio desiderato è `0`.
- **Heap complete:** ogni finestra del soak attende l'esaurimento del rAF
  posseduto dal grafo, invia tre `HeapProfiler.collectGarbage` consecutivi e
  registra un valore numerico `JSHeapUsedSize`; da questa serie derivano delta,
  conteggio degli incrementi monotoni e pendenza della regressione lineare in
  byte/finestra.

## Evidenza delle tre distribuzioni

Tutti i referti indicati hanno `pass`; il resource delta osservato è `0`.
`eeeacc27` è il digest della fixture 2k/seed 6 e `abcf614b` quello della
fixture 10k/seed 6.

| Distribuzione sullo SHA `4383a7c9` | 2k p50/p95/max (ms) | 2k total (ms) | 10k initial p50/p95/max (ms) | 10k total soak (ms) | 10k slope (B/window) | Nota referto |
|---|---:|---:|---:|---:|---:|---|
| Locale | 16 / 17 / 21 | 5861 | 25 / 26 / 29 | 43248 | 7368.238 | 10k: 8 × 120 frame |
| CI push | 16 / 17 / 23 | 5933 | 19 / 20 / 24 | 28298 | 24336.762 | `pass`, heap complete |
| CI PR | 16 / 16 / 29 | 5164 | 16 / 17 / 23 | 19190 | 47136.095 | `pass`, heap complete |

I tempi e la pendenza sono osservazioni di queste distribuzioni, non una
promessa di prestazione per ogni ambiente.

## Budget proposti

Sono budget per la review, non ancora gate CI numerici:

| Scenario | p95 | max | Tempo | Campionamento esatto |
|---|---:|---:|---:|---|
| 2k | ≤ 25 ms | ≤ 50 ms | total ≤ 10 s | initial: 120 frame |
| 10k | initial ≤ 35 ms | ≤ 50 ms | total soak ≤ 60 s | initial: 120 frame; soak: 8 × 120 = 960 frame |

Il runner fallisce su digest inatteso, campione incompleto, interazione non
causale, risorse positive dopo close, errori primari o cleanup non riuscito.
Per la fixture 10k/seed 6 il gate prolungato usa 16 finestre: 8 di warm-up e
8 di misura. Dopo GC, tutte le misure di coda devono essere disponibili; la
coda deve avere meno di 7 incrementi su 7 transizioni e slope lineare
`≤ 65536 B/window`. La soglia è il precedente limite di review, ora applicato
soltanto dopo il warm-up: tollera il rumore già osservato in CI ma rifiuta una
crescita persistente superiore a circa 0,5 MiB sull'intera coda misurata.
Disponibilità incompleta o violazione di monotonia/slope rende il referto rosso.

## Regole di memoria e risorse

La baseline è acquisita prima del mount e il controllo avviene dopo ogni close.
Un delta positivo è una regressione di lifecycle per quella distribuzione; il
valore osservato qui è `0`. Il soak attende che il grafo sia quiescente e
raccoglie l'heap dopo tre GC a ogni finestra. Nel gate prolungato
`JSHeapUsedSize` deve essere disponibile per tutte le 16 finestre: heap
incompleto è un fallimento, non un successo. Il controllo di stabilizzazione è
separato dal resource delta strutturale, che resta pari a zero dopo ogni close.

Il cleanup deve chiudere browser e server e riportare `success: true`. La
completezza del heap, il delta delle risorse e il cleanup vanno conservati nel
referto insieme alla configurazione, al digest e all'ambiente.

## Qualità e limiti di complessità

Il contratto operativo per cardinalità è:

- tier 1, `≤ 400`: repulsione esatta `O(n²)`;
- tier 2, `401..2000`: Barnes–Hut con costo atteso `O(n log n)` e collisioni;
- tier 3, `> 2000`: Barnes–Hut atteso, collisioni saltate.

Il tier della fisica dipende solo dalla cardinalità, a ogni refresh dello
schermo. Il tier della resa parte dallo stesso valore e scende di un gradino
quando il frame time medio supera 1,3 volte il budget. Risale sotto 1,1 volte,
dopo almeno 5 s. Il budget è il periodo del tetto `appearance.frame-rate`, mai
sotto 1000/60 ms. Il gradino più economico nasconde soltanto le etichette di
grado basso.

Un quadtree con nodi clustered o coincidenti può avvicinarsi al caso peggiore
`O(n²)`. Il risultato a 10k è quindi soltanto quello della fixture deterministica
con seed 6, non una garanzia per un grafo arbitrario. Digest, pass, interazione,
120 frame iniziali, soak richiesto e teardown sono qualità osservabili distinte
dalla complessità asintotica.

## Ricalibrazione

Ricalibrare dopo ulteriori distribuzioni o quando cambiano browser, sistema,
hardware, fixture, renderer o algoritmo. Confrontare sempre la stessa fixture e
lo stesso digest, aggiungere le nuove distribuzioni alla serie e riesaminare
p50/p95/max, total, delta, heap e slope insieme. I budget di frame time restano osservazionali; il solo limite numerico heap
descritto sopra è invece un gate CI esplicito e limitato alla fixture canonica.

## I disegni grandi

Il banco delle scene grandi ([`large.mjs`](../../apps/client/bench/large.mjs))
apre nell'app vera, nello spazio Completo, tre lavagne di 5 000, 20 000 e
49 900 elementi, e ne controlla ogni passo: lo zoom coi tasti, la rotella,
Ctrl+rotella, la rotella e Ctrl+rotella da vicino, la scelta, i tasti di due
strumenti, un tratto a penna e Annulla. Il tempo di un passo va dall'arrivo
dell'evento al fotogramma dipinto. I budget sono gate CI, nel passo
«cinquantamila elementi si aprono e si muovono senza scatti» di
[`ci.yml`](../../.github/workflows/ci.yml):

| Budget | 5 000 | 20 000 | 49 900 | Peggio a riposo, 49 900 | Stato |
|---|---:|---:|---:|---:|---|
| Un passo che segue un gesto: la rotella, un movimento della penna | 50 ms | 50 ms | 50 ms | 11,8 ms | **CI-enforced** |
| Un passo che risponde a un comando: un tasto, la scelta, la pressione | 100 ms | 100 ms | 100 ms | 48 ms | **CI-enforced** |
| Un passo che scrive: il rilascio del tratto, Annulla | 250 ms | 500 ms | 1 000 ms | 432 ms | **CI-enforced** |
| L'assestamento della vista, un passo che ridisegna subito | 100 ms | 150 ms | 300 ms | 86 ms | **CI-enforced** |
| L'apertura, fino all'ultimo oggetto dipinto | 4 s | 6 s | 10 s | 3,08 s | **CI-enforced** |

Nessun compito lungo, oltre 50 ms, cade fuori dai passi che rispondono,
scrivono o ridisegnano e dagli assestamenti. Nelle scene grandi, da 5 000
forme, la vista in movimento porta gli strati già dipinti, con un margine
attorno alla vista; un passo che andrebbe oltre il margine, o che salta,
ridisegna subito, e 150 ms dopo che la vista si è fermata il painter
ridisegna gli strati nella vista nuova: è l'assestamento, un fotogramma che
cresce coi testi del disegno.

Le misure sono di un Ryzen 7 7730U con 16 thread, Chromium `149` senza
finestra, viewport 1280 × 800. A riposo, in otto corse, ogni budget tiene
con un margine di due volte o più. A macchina piena, sedici processi
occupati, in quattro corse escono la scelta e il rilascio del tratto a
20 000 e 49 900 elementi, fino a 368 e 1 040 ms, e una volta il primo tasto
dello zoom, 110 ms. La CI ha i tempi di questa macchina a riposo. Le misure
complete, a riposo, a macchina piena e a pagina rallentata, stanno
nell'intestazione del banco; che cosa vede chi disegna sta in
[disegni grandi](drawing-large.md).

Ricalibrare quando cambiano Chromium, la lavagna del banco, il painter o la
soglia delle scene grandi, con le stesse tre serie di corse.

## Il budget d'interazione

Quanto lo Scrittoio ci mette a rispondere a un gesto, col moto pieno e con
l'ora vera. Lo misura [`interaction.mjs`](../../apps/client/bench/interaction.mjs),
in Chromium con l'host finto; la stessa domanda nell'app vera, con la sua
WebView, la fanno i sette scenari di [Misure nella WebView](../development/webview-measurements.md):

```bash
cd apps/client
npm run bench:interaction                # cinque giri per interazione
node bench/interaction.mjs --rounds=9 --only=palette
```

Per ogni interazione il banco prende due tempi, dal `timeStamp` dell'evento
che la fa partire:

- **primo fotogramma:** il primo `requestAnimationFrame` in cui ciò che il
  gesto apre è nel documento;
- **fine del moto:** il primo fotogramma senza corse di `moto` e senza
  animazioni o transizioni del documento in corso.

Il budget vale per la mediana dei giri, e il banco esce diverso da zero se una
mediana lo supera. Non sta nella CI, perché i tempi del runner condiviso non
sono quelli della macchina di chi usa Fub.

| Interazione | Primo fotogramma | Fine del moto | Misura (mediana) |
|---|---:|---:|---:|
| Aprire un menu dell'applicazione | ≤ 100 ms | ≤ 300 ms | 10 / 160 ms |
| Aprire la palette (il lanciatore) | ≤ 100 ms | ≤ 700 ms | 14 / 598 ms |
| Aprire una nota dall'albero | ≤ 100 ms | ≤ 700 ms | 27 / 544 ms |

La misura è di server-di-fub (AMD Ryzen 7 7730U, Chromium della revisione
Playwright fissata, 1280 × 800). Il primo fotogramma ha la soglia dei
100 ms, sotto la quale una risposta si sente immediata. La fine del moto ha
per tetto la misura nella tabella con un margine: la coda di una molla che si assesta
conta, anche se l'occhio non la vede più, e un tetto più basso si sceglie
quando cambia il moto, non prima.

### La battuta

Quanto costa un carattere scritto in una nota grande: dalla transazione al
layout forzato, senza il disegno. Lo stesso banco la misura su due note
sintetiche (`live-fixture.ts`, sezioni da diciotto righe con titolo, stili,
wikilink, tag, codice, apice, evidenziato, compito, voce, recinto, callout e
tabella), con trenta battute e venti spostamenti del cursore di 200 caratteri:

```bash
cd apps/client
node bench/interaction.mjs --only=battuta
taskset -c 0-7 nice -n 19 node bench/interaction.mjs --only=battuta  # core P
```

Il budget è una **mediana di 4 ms** e un **novantesimo percentile di 8 ms**
per battuta, in ogni modalità di scrittura, anche su 7.201 righe: il banco
esce con errore se uno dei due è superato. Le cifre sono mediana · novantesimo
percentile · massimo, su pc-debian-di-fub (Intel Core i5-13600KF, Debian 13,
Chromium della revisione Playwright fissata): per ogni cifra la mediana di sei
giri del banco alternati con sei del codice di prima (`05437b3db`), il 14
novembre 2026 con un carico medio da 3,5 a 5,8 (la macchina faceva anche altri
lavori).

| Nota | Modalità | Battuta | Cursore | Prima: battuta |
|---|---|---:|---:|---:|
| 901 righe | Sorgente | 2,0 · 3,8 · 8,6 ms | 2,0 · 3,8 · 4,2 ms | 2,2 · 2,9 · 7,4 ms |
| 901 righe | Live | 3,1 · 5,6 · 19,1 ms | 2,2 · 4,0 · 4,3 ms | 3,9 · 6,4 · 22,0 ms |
| 901 righe | Blocchi | 3,7 · 6,1 · 20,8 ms | 2,3 · 3,3 · 4,4 ms | 4,1 · 7,3 · 21,9 ms |
| 7.201 righe | Sorgente | 4,2 · 6,0 · 13,5 ms | 2,1 · 2,8 · 3,7 ms | 3,6 · 5,8 · 17,4 ms |
| 7.201 righe | Live | 5,7 · 8,4 · 38,0 ms | 3,0 · 3,9 · 4,2 ms | 6,8 · 11,5 · 29,1 ms |
| 7.201 righe | Blocchi | 5,5 · 9,6 · 24,2 ms | 3,1 · 4,4 · 5,2 ms | 7,6 · 11,9 · 37,8 ms |

**Il budget non è ancora rispettato sulla nota grande.** La Sorgente, che fa
soltanto il lavoro di CodeMirror e della sessione, sta già intorno ai 4 ms, e
fra un giro e l'altro la stessa nota varia più di una correzione: il numero da
guardare è la distanza dalla Sorgente, non la cifra di un giro solo.

Sui core P (14 novembre, sei giri alternati; contano i tre con carico da 23 a
49, gli altri arrivano a 101) la nota di 7.201 righe dà di mediana: Sorgente da
3,4 a 4,9 ms, Live da 4,4 a 10,1 (prima da 6,4 a 7,8), Blocchi da 5,1 a 20,1
(prima da 6,7 a 10,2). Sopra la Sorgente restano i widget di CodeMirror (qui
sotto), le decorazioni in riga, il campo dei blocchi e i segni (0,3·0,3·0,2).

Una battuta lavora soltanto vicino alle posizioni del cambio, mai con un giro
sui blocchi di primo livello:

- **la resa** (`renderMarkdownState` con la resa di prima e le modifiche della
  transazione) tiene i nodi di primo livello in un elenco a pezzi, e rilegge
  soltanto quelli dal blocco prima della modifica al primo nodo dopo che
  l'albero nuovo ha uguale a prima; i nodi dopo restano quelli di prima,
  spostati senza toccarli. Le definizioni dei blocchi non riletti tornano dalla
  resa di prima, e le loro posizioni si calcolano soltanto se servono. Il testo
  della resa è quello di prima con le modifiche incollate, non le righe del
  documento ricomposte. Si rende tutto da capo quando la modifica tocca il
  frontmatter, un `^id` su una riga sua, una definizione, un titolo, un blocco
  HTML o un indice (anche dentro una citazione o una lista), o quando il tratto
  da rileggere supera i 256 nodi;
- **i blocchi resi della Live** sono un insieme di intervalli che una modifica
  sposta tutto in una volta; se ne rifanno soltanto quelli del tratto riletto
  e quelli che la selezione di prima o di adesso tocca. Un cursore che si
  muove rifà i blocchi da cui esce e in cui entra;
- **le decorazioni in riga della Live** (i segni nascosti, gli stili, le
  pastiglie) si rifanno soltanto nei nodi di primo livello che la modifica
  cambia, in quelli che la selezione di prima o di adesso tocca, dove un blocco
  reso compare o sparisce e ai bordi del tratto visibile che si sposta; le
  altre si spostano. Si rifanno tutte quando cambiano la politica di
  rivelazione, «A capo» di un recinto, le icone delle pagine, le definizioni,
  il frontmatter o una riga con `[^`;
- **i ripiegabili** (`details-live.ts`) e **la riga dei fatti** della nota
  (`note-facts.ts`) seguono i nodi di primo livello che la modifica cambia
  (`top-changes.ts`, la stessa regola della resa): rileggono quelli, e degli
  altri tengono quello che sapevano;
- **il modello dei Blocchi** cerca il punto da rifare e i gruppi che tornano
  uguali per posizione, con una ricerca binaria, e scorre l'albero soltanto
  dal punto della modifica al primo gruppo uguale. Un modello letto da un
  albero a metà si rifà da capo quando l'albero arriva in fondo;
- **le righe nascoste dopo i blocchi resi** della Live (quelle con altezza
  zero, `cm-markdown-gap`) non stanno nel campo dei blocchi ma in un plugin
  della vista che dà soltanto quelle del tratto visibile: CodeMirror confronta
  due volte a ogni aggiornamento tutte le decorazioni a punto della vista, e
  prima erano 1.600 sulla nota grande (fino a 1,3 ms per battuta);
- **la sintassi** (`theme.ts`, `highlightVisible`): i blocchi resi spezzano il
  tratto visibile (sette pezzi nella Live), e `syntaxHighlighting` scorreva
  l'albero dall'inizio per ognuno; il nostro plugin unisce i pezzi a meno di
  4.000 caratteri in una passata e taglia ai pezzi, con le classi di CodeMirror
  (`theme.test.ts`). Da 0,60 a 0,24 ms nella Live;
- **il rientro sospeso** (`hanging.ts`) scorre una volta il tratto visibile e a
  una battuta non rimisura se vista, altezze e prefissi restano (0,27 → 0,07);
- **la guardia dei segni** (`format-toggle.ts`) rilegge una riga a battuta.

Un blocco tornato tiene il suo widget: il suo `eq` non guarda la posizione, e
dopo l'aggiornamento della vista le coordinate `data-md-*` del DOM tornano al
posto nuovo. Se cambiano le definizioni del documento (riferimenti, note,
ancore dei titoli, sintassi) i blocchi si rendono tutti, perché potrebbero
leggerle.

Resta proporzionale alla nota il lavoro che la Sorgente fa uguale:

- **il parser di CodeMirror**: dopo una modifica, se l'albero di prima era
  completo, `LanguageState.apply` rilegge fino in fondo (fino a 20 ms), e il
  parser Markdown riusa i nodi di prima uno a uno; i linguaggi dei recinti
  (`codeLanguages`) aggiungono il parser misto, che scorre l'albero esterno. È
  CodeMirror da solo: nessun nostro chiamante chiede l'albero oltre, e
  `ensureSyntaxTree` fino in fondo nella resa trova l'albero già completo.
  Togliere i linguaggi dei recinti, in una prova a parte, non cambia la
  battuta più del rumore fra i giri;
- **la sessione del documento** tiene il testo intero come stringa e a ogni
  battuta lo ripassa (`lineFeeds`, l'operazione applicata);
- **la selezione del DOM** che CodeMirror riscrive.

Resta di CodeMirror il lavoro sui widget di blocco, che un plugin della vista
non può dare: `RangeSet.compare` li confronta tutti due volte a ogni
aggiornamento (0,25 ms sulla nota grande).

Siccome questo banco non sta nella CI, le guardie in CI contano il lavoro di
una battuta: `render-incremental.test.ts` per la resa e i blocchi della Live
(una battuta in un paragrafo, in un recinto di duemila righe, in una tabella
o in un riquadro guarda al più sei nodi; prima di questa resa tutti, 801 su
una nota di 200 sezioni), `livepreview-inline.dom.test.ts` per le decorazioni
in riga (al più otto righe lette, contro tutto il tratto visibile),
`details-live.test.ts` e `note-facts.test.ts` per i ripiegabili e la riga dei
fatti (al più sei nodi, contro 1.200 e 600), e `blocks/model.test.ts` per il
modello dei Blocchi. Dopo ogni modifica a caso il risultato è quello di una
lettura da capo dello stesso albero.

### L'apertura di una nota grande

Quanto ferma la pagina il clic che apre una nota grande: dal clic nell'albero
alla prima riga della nota nel documento, e il compito più lungo (Long Tasks
API) finché la pagina non resta quieta per mezzo secondo. La nota è il caso
`lunga-4000` di `live-fixture.ts`: 4.000 paragrafi di prosa, circa 765 KB,
aperta in Live in una pagina nuova a ogni giro:

```bash
cd apps/client
node bench/interaction.mjs --only=apertura           # la pagina com'è
node bench/interaction.mjs --only=apertura --cpu=4   # quattro volte più lenta
```

Il budget vale per la mediana dei giri: **testo visibile entro 150 ms e
nessun compito oltre 50 ms**.

La Live non legge tutto il documento prima della prima schermata. Fino a
`PREFIX_RENDER_FROM` caratteri (20.000) la resa è quella di sempre, tutta in
un colpo; oltre, `renderMarkdownStatePrefix` porta il parser di CodeMirror fin
lì e rende i blocchi di primo livello che l'albero ha chiuso. Il resto lo
legge il parser a pezzi di 8 ms quando la pagina è libera
(`requestIdleCallback`, o un `setTimeout` dove manca), e quando l'albero è in
fondo la resa si completa in una volta. Fino ad allora i blocchi più in basso
restano testo, e le definizioni di link e note scritte in fondo non sono
ancora lette; una modifica nel frattempo rifà la resa dell'inizio.

| Pagina | Prima | Dopo |
|---|---:|---:|
| com'è | 92 / 100 ms | 21 / 0 ms |
| quattro volte più lenta | 540 / 550 ms | 93 / 102 ms |

Le cifre sono testo visibile / compito più lungo, mediana di cinque giri, sul
PC fisso del maintainer (Intel 13600KF, Chromium della revisione Playwright
fissata). Zero vuol dire nessun compito oltre 50 ms. Con la pagina quattro
volte più lenta il banco dà il blocco che il collaudo ha misurato nella
WebView dell'app vera (WebKitGTK 2.54) prima della correzione: un fotogramma
di 534–609 ms. Dopo, a quella velocità, resta il costo di aprire una nota
qualsiasi: la nota piccola della Live (`panoramica`) ferma la pagina per
130–140 ms, per la scheda, la vista dell'editor e il primo layout.

Il banco non sta nella CI. La guardia in CI sono i test della resa
dell'inizio (`render-incremental.test.ts`) e dell'apertura in Live
(`livepreview.dom.test.ts`): l'apertura non porta il parser in fondo, la
tabella in cima è resa subito e quella in fondo dopo, e la resa completa è
uguale a una resa da capo.

### Il cambio di nota

Quanto costa passare da una nota piccola a un'altra già aperta: il gesto più
frequente, e un costo fisso che una nota piccola non giustifica. Tre note in
schede (`Benvenuto.md`, la `panoramica` della Live, `Sintassi di Fub.md`), un
clic nell'albero sulla prossima a ogni giro, in una pagina sola: dal clic alla
scheda nuova scelta col suo testo nel documento, e il compito più lungo fino a
due fotogrammi dopo, che comprendono la misura dell'editor:

```bash
cd apps/client
node bench/interaction.mjs --only=cambio           # la pagina com'è
node bench/interaction.mjs --only=cambio --cpu=4   # quattro volte più lenta
```

Il budget vale per la mediana dei giri: **scheda col testo entro 100 ms e
nessun compito oltre 50 ms**, alla velocità della pagina.

Un cambio di nota fa il suo lavoro una volta:

- **un giro di disegno solo.** L'apertura muta il layout, il segnale chiede
  un giro, e `openDocument` chiede il proprio: `synchronize` fonde le
  richieste che arrivano mentre un giro aspetta di partire. Un giro già
  partito non si fonde, e un altro lavoro della coda dei disegni (il cambio
  dei componenti, il cambio di vault) chiude la fusione;
- **niente layout forzati a metà.** La linguetta scelta si porta in vista
  (`scrollIntoView`) e la striscia delle schede guarda posti e scorrimento al
  fotogramma dopo, non fra la superficie vecchia smontata e quella nuova:
  nel fotogramma il layout è uno, ed è quello che l'editor appena montato
  misura;
- **il correttore con le altre estensioni.** Dal secondo editor in poi il suo
  modulo è già caricato, e la superficie lo monta prima di creare la vista,
  invece di riconfigurare CodeMirror sopra l'editor appena disegnato.

| Misura | Prima | Dopo |
|---|---:|---:|
| Banco, pagina com'è: scheda col testo / compito più lungo | 24 / 0 ms | 13–22 / 0 ms |
| Banco, quattro volte più lenta | 63–69 / 70–72 ms | 53 / 58 ms |
| WebView vera, S2 `noteSwitch` mediana / p95 | 176–179 / 188–216 ms | 140–142 / 152–165 ms |

Le cifre sono del PC fisso del maintainer (Intel 13600KF): il banco con
Chromium della revisione Playwright fissata, mediana di diciotto cambi; la
WebView è WebKitGTK 2.54 con la GPU, sullo schermo vero, quattro corse per
parte. Zero vuol dire nessun compito oltre 50 ms. La pagina com'è sta sotto
un fotogramma o due, quindi la cifra va a scatti di 16 ms.

Ciò che resta, a pagina quattro volte più lenta, è soprattutto la vista
dell'editor: ogni cambio di scheda smonta la superficie e ne monta una nuova
(circa 17 ms), le dà il testo (`setDoc`, circa 11 ms) e la dispone la prima
volta (circa 17 ms di stile e layout, al fuoco), più la misura di CodeMirror
nel fotogramma dopo (circa 9 ms). Toglierla vuol dire tenere vive le
superfici delle schede recenti, o riusare la vista del riquadro: una scelta
sul ciclo di vita della superficie, non ancora fatta.

Il banco non sta nella CI. La guardia in CI è il test del cambio in
`panels/document.test.ts` (un'apertura dipinge ogni linguetta una volta e
non chiama `scrollIntoView` prima del fotogramma) e quello della striscia in
`tab-strip.test.ts` (più cambi nello stesso fotogramma, un'occhiata sola).
