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
`transform` e `opacity`, un gesto invertito a metà torna allo stato di
partenza senza salti (ogni riquadro in corsa prosegue da dov'era, lui o la
sua immagine che esce, e il referto dice com'era e com'è il riquadro che
salta), e un'uscita (un lanciatore, un cassetto, un dialogo che si chiude)
finisce entro 140 ms. Ogni file della shell e del kit che fa partire una corsa
ha la sua coreografia. I confronti restano al pixel, e per questo il banco apre
Chromium con `--disable-partial-raster` (`BROWSER_ARGS` in
`bench/motion-rules.mjs`): col raster parziale lo stesso stato raggiunto per
due strade dava ogni tanto un pixel di antialiasing diverso. Anche il budget d'interazione (`npm run bench:interaction`) apre
la pagina col movimento acceso e l'ora vera: misura in quanti millisecondi un
menu, la palette e una nota arrivano al primo fotogramma e alla fine del moto,
contro i budget del [budget prestazionale](../product/performance-budget.md#il-budget-dinterazione).
Nessuno dei due vede la webview del sistema: per quella c'è la [prova manuale
del moto](motion-smoke-test.md).

L'accessibilità verifica la pagina resa, non soltanto una tabella teorica di
colori. La carta dei fogli è uno pseudo-elemento, che axe non sa leggere dietro
il testo: per la sola misura, a scena ferma, il banco la porta sui fratelli che
le stanno sopra, col suo colore, e il contrasto del testo sul foglio diventa un
esito invece di un «da verificare».
Il catalogo contiene i campioni posizionati dentro i rispettivi riquadri;
le regioni che scorrono hanno nome accessibile e ingresso da tastiera.
Il controllo del focus distingue i discendenti di un `details` chiuso
dagli elementi realmente visibili e raggiungibili. In ogni scena con la
modalità nella banda, Invio su `#status-mode` apre il menu (che prende il
fuoco) ed Esc lo chiude riportando il fuoco sulla banda; la barra di formato e
quella del PDF sono un solo punto di Tab ciascuna.

Regole:

- controllare luce chiara e scura;
- non aggiornare baseline da un ambiente non validato sul riferimento;
- spiegare ogni cambiamento intenzionale;
- usare moto ridotto nelle scene pertinenti;
- non mascherare una regressione alzando la soglia.
