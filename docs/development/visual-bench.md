# Banco visivo e accessibilità

Le scene fotografate, le baseline, le soglie, il palco che tiene ferma la
pagina e il banco dell'accessibilità. I comandi sono nella tabella dei
[banchi](testing-and-quality.md#banchi); come la CI rifà le baseline sulle PR
sta in [le baseline dal runner](testing-and-quality.md#le-baseline-dal-runner).

Il banco visuale usa scene deterministiche e baseline del runner Linux. In caso
di differenza, la CI conserva immagini attuali, diff e foglio di contatto.

Le baseline coprono le scene in
[`bench/scene.mjs`](../../apps/client/bench/scene.mjs), in luce scura e chiara.
L'ambiente di riferimento usa Ubuntu, Node 22, Chromium della revisione
Playwright fissata dal lockfile e i font del runner, inclusi DejaVu Sans Mono.
Prima di usare un ambiente Ubuntu ricostruito, eseguire il banco sul commit
di riferimento con le baseline invariate: tutte le scene devono passare.
Questa prova separa una differenza dell'ambiente da una modifica della UI.

La soglia colore resta `0.01` e una foto passa soltanto con al massimo lo
`0.1%` di pixel diversi. Una diversa rasterizzazione del sistema non è
una motivazione per alzare questi limiti.

Un confronto locale fuori da questo ambiente può superare il limite per
rasterizzazione di testo o canvas pur senza una regressione applicativa. Va
esaminato il diff; non va promosso a baseline. Un cambiamento intenzionale
richiede invece revisione del foglio, spiegazione delle scene coinvolte e
rigenerazione nell'ambiente Ubuntu validato: sulle PR la fa la CI
([le baseline dal runner](testing-and-quality.md#le-baseline-dal-runner)).

Oltre a ora, fuso, lingua, moto e finestra, il palco (`bench/stage.mjs`) tiene
fermi due casi che la pagina non dichiara da sé. `Math.random` è a seme fisso:
CodeMirror lo usa per cercare la posizione sotto un punto, e col caso vero una
selezione di poche lettere si dipingeva a volte come una riga intera. E un
elemento che sta per riscriversi da sé porta `data-pending` (la riga dei
suggerimenti durante la sua pausa): `prepareScene` e `stillShot` aspettano che
nella pagina non ce ne sia più nessuno, e dopo 5 s falliscono nominando
l'elemento. Un componente con un timer che cambia ciò che si vede usa lo stesso
attributo invece di chiedere al banco un'attesa a tempo.

Lo strato d'avvio ha quattro scene: `avvio-attesa` (il marchio e la riga del
vault che si apre), `avvio-lento` («Ci vuole più del solito.», a 10 s),
`avvio-guasto` (il motivo, col fuoco su Riprova) e `avvio-telefono` (l'attesa
su `mobile.html`). Il fake del banco ferma l'avvio dalla query: `avvio=attesa`
trattiene `openVault`, `avvio=guasto` fa cadere `initialVault`. Una scena che
non arriva a `data-bench="ready"` dichiara la sua condizione d'arrivo
(`ready`), e il palco ferma la scia (`.avvio-scia`) prima dello scatto.

Gli stati di Scrittoio 2 hanno sei scene: `banda-modalita` (la nota col menu
delle modalità aperto dalla banda), `nota-stretta` (la nota a 800×800, la
finestra minima del computer), `barra-formato` e `barra-formato-stretta` (la
barra di formato della nota a 1280 e a 800, con `?formatbar=1`, che dà alla
finestra principale i comandi di formato del telefono senza cambiare le altre
scene), `icone-figure` e `icone-emoji` (il selettore dell'icona aperto su una
cartella, con le figure del vault del banco e con `?icone=emoji`).

La guardia del lampo (`npm run bench:lampo`, `-- --port <n> --strictPort` per
un'altra porta) trattiene il modulo d'ingresso di `index.html` e di
`mobile.html` e guarda la pagina com'è prima di ogni modulo, in luce scura,
chiara e con una cache `fub.avvio` chiara su un sistema scuro: il fondo di
`<html>` è pieno e della luce attesa, `.avvio` copre la finestra (nove punti
cadono dentro di lui), `#app` è `inert` e nessun bottone dell'app si vede con
l'aspetto nativo. Poi rilascia il modulo e, ad avvio finito, verifica che non
restino `.avvio`, `#avvio-stile`, `data-avvio-*` né `--avvio-*` e che `#app`
sia vivo. Esce diverso da zero nominando la pagina, il caso e il controllo
caduto: senza il foglio dello strato in una pagina cade. In CI gira nel job
del banco visivo, dopo le scene.

Il banco del moto (`npm run bench:motion`) misura le coreografie dello
Scrittoio nel browser: lo stato d'arrivo coincide con quello a moto ridotto,
non resta nessuna animazione viva, i fotogrammi chiave toccano soltanto
`transform` e `opacity` (e così lo stile in linea riscritto a ogni
fotogramma, anche durante un trascinamento, dove il puntatore avanza di un
passo per fotogramma e una proprietà estranea cambiata in due fotogrammi di
fila è un errore; mentre passa soltanto il tempo lo è anche una proprietà
scritta in tre fotogrammi con tre valori diversi, di fila o no), un gesto invertito a metà torna allo stato di
partenza senza salti (ogni riquadro in corsa prosegue da dov'era, lui o la
sua immagine che esce, e il referto dice com'era e com'è il riquadro che
salta; il «dopo» si legge al primo fotogramma che il gesto contrario dipinge,
dopo le sue richiamate di `requestAnimationFrame` e prima del disegno, non
appena torna il clic), e un'uscita (un lanciatore, un cassetto, un dialogo che si chiude)
finisce entro 140 ms. Ogni file della shell e del kit che fa partire una corsa
ha la sua coreografia, e ogni gesto del trascinamento dei
[Blocchi](../product/editor-blocks.md) la sua (`blocchi-*`: la presa di un
blocco basso e di uno alto, il passaggio oltre un blocco alto, «Accanto»,
annidare e staccare, il cartellino, lo scorrimento al bordo, il rilascio, Esc,
Mod+Maiusc+↑/↓); i loro casi ai bordi hanno un test ciascuno in
`blocks/blocks.dom.test.ts`. I confronti restano al pixel, e per questo il banco apre
Chromium con `--disable-partial-raster` (`BROWSER_ARGS` in
`bench/motion-rules.mjs`): col raster parziale lo stesso stato raggiunto per
due strade dava ogni tanto un pixel di antialiasing diverso. Per la stessa
ragione ogni pagina del banco del moto parte senza lavoro a riposo in
sospeso: dopo la scena aspetta che la coda dei riscaldamenti
(`ui/warmup.ts`, `warmups.pending()`) sia vuota, perché un carattere caricato
mentre si scatta lascia sotto il blocco in mano livelli diversi di un'unità
da quelli della stessa pagina a caricamento finito. Anche il budget d'interazione (`npm run bench:interaction`) apre
la pagina col movimento acceso e l'ora vera: misura in quanti millisecondi un
menu, la palette e una nota arrivano al primo fotogramma e alla fine del moto,
contro i budget del [budget prestazionale](../product/performance-budget.md#il-budget-dinterazione).
Nessuno dei due vede la webview del sistema: per quella c'è la [prova manuale
del moto](motion-smoke-test.md).

La conformità al prototipo (`npm run bench:conformita`, `-- --light=dark|light`,
`-- --only=<inizio dell'id>`) confronta gli stili calcolati dell'app con quelli
del prototipo di un piano, proprietà per proprietà: la base grafica del
prototipo è obbligatoria, e se ne devia solo con un motivo scritto. Vive in
[`bench/conformita/`](../../apps/client/bench/conformita/), in due tempi.

- **L'estrazione**, a mano e fuori dalla CI, perché il prototipo sta sul ramo
  del piano e non in `main`: `node bench/conformita/estrai.mjs editor` (dopo
  `git fetch`) prende `PLAN-ui/editor.html` dal ramo che la mappa nomina, lo
  porta in ogni stato (Giorno/Notte, Piena/700, moto ridotto, i gesti della
  vista), legge `getComputedStyle` di ogni pezzo e scrive `editor.json`, un
  file generato con commit e sorgente nell'intestazione.
- **La verifica**, in CI nel job del banco visivo dopo la guardia del lampo:
  apre la scena del banco che la mappa nomina, alla finestra dello stato,
  legge gli stessi stili sugli elementi corrispondenti e confronta.

La mappa `mappa-<prototipo>.mjs`, scritta a mano, dice per ogni pezzo la vista
(come ci si arriva nel prototipo e quale scena del banco), gli stati, il
selettore del prototipo dentro `#win`, quello dell'app e le proprietà: di base
padding, margin, gap, bordi, raggi, ombre, carattere, colore, fondo e opacità,
più dimensioni e allineamenti dove sono fissi. Gli elementi si identificano per
classi e struttura, mai a occhio. Le tolleranze sono mezzo pixel per le
lunghezze, due punti per canale (0–255) e un centesimo d'alfa per i colori, le
ombre e i gradienti parte per parte, i caratteri per famiglia principale (il
taglio «Variable» è lo stesso carattere); il perché sta in `confronto.mjs`.

Le due tavolozze non coincidono, e il piano dice con quale token di Fub si
scrive ogni token del prototipo (`TRADUZIONE` nella mappa). L'estrazione legge
ogni pezzo una seconda volta con quei token sostituiti da colori sentinella, e
così sa di quale token, o di quale `color-mix` di due token, è fatto ogni
colore; la verifica risolve la stessa espressione coi token di Fub sotto
l'elemento dell'app. Un colore scritto a mano nel prototipo si confronta crudo.
Oltre alla tabella del piano, la traduzione dice che il velo di passaggio
`--hover` è `--overlay-hover` della pelle e che `--danger` è il `--danger` del
tema, generato dalla ricetta col contrasto garantito. Un'ombra del prototipo
scritta tutta in un token (`--sh-pop`) non passa dalle sentinelle: si confronta
per valore, parte per parte.

La traduzione dipende dal contesto del pezzo (`TRADUZIONI` nella mappa). Un
pezzo dell'interfaccia (menu, lanciatore, banda) usa `TRADUZIONE`. Un pezzo
dentro la pagina del documento (`contesto: "documento"`: tabella Markdown,
testata, proprietà, riga dei dati, maniglie) usa `TRADUZIONE_DOCUMENTO`, perché
la pagina ha una tavolozza sua, che si personalizza a parte: `--ink` diventa
`--doc-fg`, `--muted` e `--faint` diventano `--doc-gutter-fg`, `--line`
diventa `--doc-rule-soft`, `--hover` diventa `--doc-block-hover` e `--danger`
`--doc-danger`, e così via. Le traduzioni nominano gli stessi token
del prototipo, così le sentinelle sono le stesse; un colore che resta diverso
dopo la traduzione del suo contesto è una differenza vera.

È rosso, con pezzo, stato, i due selettori, proprietà, atteso e trovato, se una
proprietà differisce senza eccezione, se un selettore dell'app non trova un
elemento visibile, se `editor.json` non è quello della mappa, o se
un'eccezione non copre più niente. Le eccezioni (`eccezioni-<prototipo>.json`)
hanno pezzo, proprietà, motivo e il riferimento alla voce di DECISIONS o del
piano che le giustifica. `DA_COPRIRE` nella mappa elenca invece ciò che va
ancora corretto: un pezzo intero non si confronta; una proprietà di un pezzo
coperto si confronta, e diventa rossa quando coincide, perché la si tolga. Un
task grafico aggiunge i suoi pezzi alla mappa, rigenera l'estrazione e passa il
controllo; il referto intero va in `bench/.output/conformita/`.

Un pezzo con `attende: "#<PR>"` ha i valori attesi già estratti, ma la verifica
non lo legge finché quella PR non è in `main`: il suo selettore, e a volte la
sua scena, nascono lì. La riga di riepilogo conta i pezzi che attendono, per
lavoro. Per misurare la PR prima di unirla, su un ramo locale che la contiene:
`npm run bench:conformita -- --attese`. Chi la unisce toglie `attende` dai suoi
pezzi, e da quel momento ogni differenza è rossa come le altre.

L'accessibilità verifica la pagina resa, non soltanto una tabella teorica di
colori. La carta dei fogli è uno pseudo-elemento, che axe non sa leggere dietro
il testo: per la sola misura, a scena ferma, il banco la porta sui fratelli che
le stanno sopra, col suo colore, e il contrasto del testo sul foglio diventa un
esito invece di un «da verificare».
Il catalogo (cuore in `src/dev/catalogo/`, come «Tutti i componenti») ha i
campioni nei loro riquadri; le regioni che scorrono hanno nome e un Tab.
Il controllo del focus distingue i discendenti di un `details` chiuso
dagli elementi realmente visibili e raggiungibili. In ogni scena con la
modalità nella banda, Invio su `#status-mode` apre il menu (che prende il
fuoco) ed Esc lo chiude riportando il fuoco sulla banda; la barra di formato e
quella del PDF sono un solo punto di Tab ciascuna.
Il combobox modale (il lanciatore) mostra il fuoco col cursore e la riga
attiva, senza anello: eccezione stretta e casi in `bench/a11y-rules.mjs`.
La griglia dei fogli mostra il fuoco coi pezzi del motore dei segni (l'anello
della cella attiva, o il rettangolo quando è la cella sola), elementi a parte
sopra la cella: vale come indicatore un pezzo visibile sul bordo della cella
`aria-activedescendant`. La sua cella aperta sta nel livello dei segni e la
cella la dichiara sua con `aria-owns`, che `aria-required-children` di axe
non segue: il banco rifà la stessa visita di axe senza i sottoalberi
dichiarati da un altro elemento della griglia, e il rilievo cade solo se così
non resta niente fuori posto.
Lo scroller dell'editor di testo (`.cm-scroller`) ha l'anello dipinto dal
velo `::after` del suo `.cm-editor`, sopra i numeri di riga: il banco lo conta
solo se il velo c'è, copre tutto l'editor e dipinge un contorno o un'ombra
(`editorFrameRingGap`, stesso file).

Regole:

- controllare luce chiara e scura;
- non aggiornare baseline da un ambiente non validato sul riferimento;
- spiegare ogni cambiamento intenzionale;
- usare moto ridotto nelle scene pertinenti;
- non mascherare una regressione alzando la soglia.
