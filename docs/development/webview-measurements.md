# Misure nella WebView

Questa guida dice come misurare i tempi di Fub nella WebView vera, con la
sonda delle prestazioni e gli scenari del banco WebView.

> **Per chi:** chi cambia l'editor, il passaggio fra le note, la lavagna, il
> grafo, l'inchiostro o l'avvio, e chi prepara una versione.
> **Risultato:** un referto in [`docs/misure/`](../misure/README.md) con
> macchina, sistema, WebView e commit.

Il [budget d'interazione](../product/performance-budget.md#il-budget-dinterazione)
misura in Chromium, con l'host finto. Questa misura avviene nell'app vera:
WebKitGTK su Linux, WebView2 su Windows, WKWebView su macOS.

## La sonda

La sonda vive in `apps/client/src/perf/`. È spenta di serie e si accende con
l'impostazione di macchina **Sonda delle prestazioni** (`perf.probe`, gruppo
Diagnostica). Accesa, misura:

- per tasto, puntatore e penna, il tempo dall'evento al fotogramma che lo
  mostra: il secondo fotogramma dopo l'evento, un campione in volo alla volta;
- la distanza fra due fotogrammi, con i fotogrammi oltre 33 e oltre 50 ms;
- l'avvio a freddo, dall'inizio della pagina alla prima nota visibile;
- i segni attesi nel DOM, per esempio la nota successiva dopo un passaggio.

Da fuori la si guida con `window.__fubProbe`: `start()`, `stop()`, che rende
il referto, e `waitFor(nome, selettore, ms, testo?)`. Spenta, la sonda non
ascolta niente e non chiede fotogrammi.

## I tasti del driver

Gli scenari, e le sonde che guidano l'app vera, parlano col driver attraverso
`apps/client/bench/webview/driver.mjs`. `session.keys(testo)` segue l'«Element
Send Keys» del W3C: un modificatore nel testo resta premuto fino alla fine,
quindi `keys(KEY.control + "f")` è Ctrl+F (`keyActions`, provato da
`driver.test.mjs`). Per un accordo con un ordine preciso di pressioni e
rilasci si usa `session.actions`. I tasti speciali hanno un nome in `KEY`:
attenzione ai tasti funzione, perché `` è F1 e F2 è ``. Se una
scorciatoia sembra rotta solo sotto il driver, prima di cercare il difetto in
Fub si guardano `key`, `code` e `ctrlKey` del `keydown` che arriva davvero.

## Gli scenari

| Scenario | Gesto | Valore |
|---|---|---|
| S1 | 200 caratteri in fondo a una nota di 5.000 righe, cinque giri | p95 tasto → fotogramma, mediana dei giri |
| S2 | venti passaggi fra note di un vault di 10.000 | p95 gesto → nota visibile |
| S3 | spostamento e zoom di una lavagna di 300 schede, 20 note vive, partiti quando la lavagna è ferma | p95 e massimo fra fotogrammi; l'apertura in ms, solo referto |
| S4 | trascinamento del grafo di 10.000 nodi | p95 e massimo fra fotogrammi |
| S5 | tratto di penna di 3 s su un disegno di 2.000 tracciati | massimo fra fotogrammi |
| S6 | avvio a freddo fino alla prima nota | ms |
| S7 | Blocchi su una nota di 2.000 righe: un blocco trascinato su e giù per 3 s, poi dieci trasformazioni da paragrafo a titolo e ritorno | p95 e massimo fra fotogrammi |
| S8 | la penna sulla lavagna: dieci tratti da 300 ms sopra una scheda con una tabella di 100 × 100 celle, su una lavagna con un foglio `.xlsx` di 100 × 100 celle e 2.000 tratti già scritti; poi la scheda della tabella spostata coi suoi tratti per 2 s | massimo fra fotogrammi a penna (obiettivo 2 periodi, 33 ms a 60 Hz) e allo spostamento; path asciutti; sha256 del `.xlsx` prima e dopo |
| S9 | la lavagna di S3 con venti fogli `.xlsx` vivi, la vista sul loro blocco a zoom 0,5: spostamento e zoom come S3; poi una nota di quella lavagna in scrittura, 200 caratteri come S1 (`S9.keyToPaint`) | numero dei fogli vivi; p95 e massimo fra fotogrammi; p95 tasto → fotogramma |
| S10 | il foglio grande, `S10/Registro.xlsx` di 3.000 × 20 celle: 150 passi di `scrollTop` da 60 px in giù e 150 in su, uno per fotogramma come la rotella, dopo un giro a vuoto; poi un clic su una cella e venti frecce, giù e su a turno, che cambiano la scelta e fanno rileggere la barra dei comandi; poi la barra laterale aperta e chiusa dal comando, sei volte, che cambia la larghezza del foglio e della barra. Il job `webview` della CI non lo fa girare | p95 e massimo fra fotogrammi allo scorrimento (`S10.scroll.frameGap.*`); per frecce e barra (`S10.frecce.mainBlocked`, `S10.barra.mainBlocked`) la mediana del thread principale bloccato come F3; il thread occupato (`S10.scroll.busy.p95`) e la CPU nel referto |
| S11 | il PDF `S11/Dispense.pdf` di quaranta pagine larghe come un A4 e alte due, scritto dalle prove (`multipagePdf` in `fixtures.mjs`) con testo e tracciati, adattato alla larghezza: la pagina che si vede percorsa giù e su in 60 passi di `scrollTop` per verso, il passo dato dall'altezza che scorre, dopo un giro a vuoto; poi dodici pagine sfogliate con «Pagina successiva» e dodici indietro, ognuna una resa nuova del motore. Il job `webview` della CI non lo fa girare; senza soglie in `budgets.json`: a 180 Hz la pagina sfogliata blocca ancora 8–9 ms, più di 1 P, anche con la pagina disegnata in un worker ([misura](../misure/2026-11-20-linux-pdf-pagina-worker.md), #525) | p95 e massimo fra fotogrammi allo scorrimento (`S11.scroll.frameGap.*`), il thread occupato (`S11.scroll.busy.p95`), la mediana del thread bloccato per pagina come F3 (`S11.pagina.mainBlocked`); la CPU e la pagina dopo il ritorno nel referto |
| R1 | la memoria: l'app vuota, aprendo un file per modalità (nota, lavagna, disegno, documento Word, foglio Excel, PDF, immagine), dopo «chiudi tutto» e un minuto dopo | PSS in MiB, in tutto e per processo (app, WebView), soltanto Linux |
| T1 | le tessere: un fotogramma di 2880 × 1800 RGBA letto a tessere di 256 × 256 dalla IPC (`resource_read_chunk`) e da `fub-asset:` con `Range`, poi disegnato su una tela, una tessera e un fotogramma intero per fotogramma | p95 per tessera, mediana per fotogramma, ms |
| I1 | il vault durante l'indicizzazione dell'avvio (10.000 note): una nota aperta con `read_document` e una tessera letta dalla IPC, una dopo l'altra, finché `vault_status` non dice che l'indice è pronto | p95 per nota e per tessera, ms |
| L1 | il nucleo della lavagna in WebAssembly: il modulo degli asset compilato con la CSP dell'app, poi venti aperture e duecento spostamenti di una scheda su una lavagna di 50 e una di 2.000 schede, cinque giri | istanza come mediana dei giri, prima istanza, prima apertura e primo commit del primo giro; p95 come mediana dei giri, ms |
| C1 | i profili dei componenti: «Solo note» e poi «Tutto» applicati con `components_apply`, l'app riavviata sulla nota lunga, poi un'altra nota aperta | avvio a freddo in ms, chunk scaricati all'avvio, chunk dei componenti spegnibili arrivati (zero in tutti e due i profili) |
| F1 | rAF a vuoto: 5 s di `requestAnimationFrame` sulla shell ferma, a indice pronto | mediana fra fotogrammi confrontata col periodo dello schermo; tetto del motore; percorso di disegno |
| F2 | quiete: 20 s senza gesti | richieste di fotogramma della pagina; CPU dei processi della WebView, in % di un core |
| F3 | thread principale per gesto: la barra laterale dal comando (Ctrl+Alt+B, sei volte), il cambio scheda fra la nota lunga e una corta (Ctrl+PagGiù, otto volte), una cartella di trenta note aperta e chiusa nell'albero (otto volte) | per gesto, la mediana delle ripetizioni del tempo di thread principale bloccato; fotogrammi persi e CPU nel referto |
| F4 | il cambio scheda fra una nota e un foglio `.xlsx` (`F4/Bilancio.xlsx`, 1.000 righe × 12 colonne) nello stesso riquadro: un giro a vuoto, poi sei andate e ritorni col clic sulla scheda | per lato (`F4.foglio`, `F4.nota`), la mediana dal primo `pointerdown` sulla scheda al fotogramma dopo la prima cella con `Riga 1` (o la riga della nota), in ms, senza soglie, e del thread principale bloccato (l'anello di F3): buco più lungo (`mainBlocked`) e somma dei buchi (`mainTotal`) |

S1 scrive i 200 caratteri in cinque giri (`S1_ROUNDS` in `typing.mjs`), ognuno
su una riga nuova, e dà la mediana dei p95 dei giri, come L1
([misura](../misure/2026-11-17-banco-webview-s1-l1-runner.md), #293).

S9 misura anche il tasto fino al fotogramma in una scheda di nota della stessa
lavagna (`S9.keyToPaint`, obiettivo 2 periodi dello schermo): la scheda va a zoom 0,5 al centro
della vista, si sceglie con un clic e si entra con Invio, si scrive un carattere
che non si misura (il montaggio dell'editor) e poi i 200 caratteri di S1, con la
sonda accesa. Lo fa in un'app nuova: il pan col pulsante di mezzo dei gesti di S3
lascia WebKitWebDriver con il pulsante premuto, e dopo non arrivano clic né
tasti alla lavagna. Se la sonda non registra nessun tasto, o il testo non arriva
nell'editor della scheda, il valore è `null` e il referto lo dice: la misura non
vale. Uno scenario senza campioni non scrive un valore: un tempo di zero non è
una misura, e la soglia lo conta come misura che manca.

R1 legge la PSS dei processi dell'app, con una raccolta forzata della
WebView prima di ogni lettura a schede chiuse: la procedura, il residuo, la
pendenza dei giri e il gancio `bench-gc` sono in
[La memoria nella WebView](webview-memory.md).

S3 misura lo spostamento, non l'apertura. Il primo disegno delle 300 schede
dura secondi sul runner, e la sua coda, se cade dopo `start`, diventa il
massimo fra fotogrammi a seconda di quando lo scenario parte. Per questo S3
aspetta la lavagna ferma: dalla prima `.canvas-node` conta i fotogrammi, e
la lavagna è ferma al primo che chiude cinque intervalli di fila sotto
100 ms. Solo dopo parte la misura. Il tempo dalla prima scheda alla lavagna
ferma va nel referto come `S3.apertura`, col buco più lungo fra due
fotogrammi dentro l'apertura (`S3.apertura.buco`); non hanno soglia. Una
lavagna che non si ferma entro 15 s dalla prima scheda fa fallire lo
scenario, col buco più lungo visto.

**La misura della finestra.** L'app chiede una finestra di 1280 × 840
(`crates/fub-app/tauri.conf.json`), ma la misura la decide il gestore di
finestre: sotto Xvfb è quella; un gestore a tessere (niri, sway) la cambia,
per esempio in 800 × 1896 su una colonna di niri. Il gesto di S3 e S9 si
calcola quindi sulla pagina vera (`bench/webview/gesture.mjs`, prova in
`gesture.test.mjs`): può uscire dalla lavagna, che tiene il puntatore finché
il pulsante è premuto, ma non dalla pagina, perché WebDriver rifiuta il
punto. Parte dal centro della parte visibile di `.canvas-viewport` e va ±400
px, come nella CI, se ci sta a 8 px dai bordi; altrimenti parte dal punto
della vista più vicino al centro della pagina e va quanto ci sta (±391 px
nella colonna di niri). Sotto i 100 px lo scenario fallisce col motivo. Il
referto dà la pagina, la misura chiesta (`window`) e il gesto (`gesture`, con
`reduced`); una pagina diversa o un gesto ridotto finiscono anche fra le note
stampate: quei numeri non si confrontano uno a uno con quelli della CI.
**Il selettore e l'indice.** Il primo avvio sul vault del banco indicizza
diecimila note, e la shell risponde prima di aver finito. Il riscaldamento
aspetta l'indice (`vault_status`) prima di cercare «Lunga», e una ricerca per
nome preme Invio solo quando la prima voce è un documento: finché l'indice
non lo conosce, la prima voce del selettore comune è «Crea questa nota», e
Invio creava una `Lunga.md` vuota alla radice, che il selettore metteva poi
davanti alla vera (riscaldamento e S1 scaduti).

T1 è la prima delle tre vie del piano dei componenti per la tela dei motori
(tessere verso la WebView, superficie wgpu nativa, egui): misura il trasporto
e il disegno senza motore (`tiles.mjs`). Il tempo del motore per un fotogramma
sta nelle prove di `tools/motori-prova`. Le chiamate passano da
`__TAURI_INTERNALS__`, come fa `@tauri-apps/api`.

I1 controlla che l'indicizzazione non fermi il vault (`indexing.mjs`): ogni
avvio sul vault del banco indicizza le diecimila note, e i comandi che passano
dal workspace non devono aspettare la fine di una fetta. Lo scenario fallisce
se l'indice era già pronto all'avvio, perché allora non ha misurato niente.

C1 controlla che il codice dei componenti spegnibili non arrivi nella WebView
prima che serva. Il build scrive in `dist/switchable-chunks.json` i chunk che
contengono un pezzo del PDF, della lavagna, dei disegni, dei documenti o dei
fogli, con i moduli che ce lo portano; con «Solo note» e con «Tutto» nessuno
di questi deve comparire fra gli script scaricati, all'avvio o aprendo una
nota (`C1.<profilo>.spegnibili`, soglia 0): arrivano quando si apre un loro
file, e soltanto se il componente è acceso. Senza quel file, cioè senza
`npm run build` prima dell'app, lo scenario fallisce. Il referto elenca i
chunk di ogni profilo e, per uno spegnibile arrivato, i moduli che lo hanno
portato. C1 gira per ultimo e lascia il vault del banco a «Tutto».

Ogni scenario è un avvio dell'app. L'avvio indicizza il vault da capo, e la
shell risponde prima che abbia finito: tranne S6, gli scenari partono quando
`vault_status` non dice più `running`, perché misurano un vault pronto.

Le fixture nascono in una cartella temporanea
(`apps/client/bench/webview/fixtures.mjs`); il vault vero di chi misura non
si tocca. Gli obiettivi e le soglie stanno in
`apps/client/bench/webview/budgets.json`: `targets` sono gli obiettivi,
`ci` le soglie di peggioramento del runner, tarate sulle sue misure vere.

S5 chiede la feature `draw` dell'app: senza, un `.svg` si apre come immagine
e il referto scrive lo scenario come saltato, senza numero.

S8 apre `S8/Lezione.canvas`: la scheda `tabella` (testo con la tabella
Markdown), la scheda `voti` (il file `S8/voti.xlsx`) e i 2.000 tratti
`fub:ink`, metà sulla tabella, un quarto sul foglio e un quarto liberi,
scritti dal codificatore della §5 di [scene-format](../reference/scene-format.md#5-tratti-a-mano-libera)
dentro `fixtures.mjs`. Aspetta che i tratti asciutti siano disegnati (al più
30 s) e che la scheda `voti` sia viva con le celle
(`[data-card-kind=sheet][data-card-mode=live] [data-card-state=content]`, al
più 60 s), poi manda dieci tratti di penna sopra la scheda del foglio: la
penna scrive sulle celle del foglio vero (D-7 (c) del piano N4), non sulla
tabella di testo, che resta sulla lavagna con i suoi tratti. Il fit della
lavagna può stare sotto la soglia della scheda viva (zoom 0,35): in quel caso
lo scenario la ingrandisce con cinque scatti di Ctrl+rotella mandati dalla
pagina sulla scheda, fuori dalla misura, perché il Ctrl+rotella del driver non
ingrandisce. Se la penna non scrive (la sonda non vede eventi `pen`, o i path asciutti non crescono),
rifà i dieci tratti col mouse e D tenuto, e il referto lo dice (`input`).
WebKitWebDriver sotto Xvfb manda il `pointerdown` della penna e poi niente:
il tratto rimasto giù terrebbe la lavagna («un tratto alla volta»), quindi
prima del mouse lo scenario manda alla finestra un `blur`, che lo annulla,
fuori dalla misura. Per ogni tratto il referto dà i path asciutti
(`written`) e, per i fotogrammi oltre 33 ms, l'ultimo evento del puntatore
prima di ognuno (`phases`): il movimento, il rilascio o nessuno. Coi tratti
del mouse conta anche D (`phases.d`): le pressioni e le ripetizioni
automatiche del tasto tenuto. Un fotogramma dopo una ripetizione va nella
fase «ripetizione di D», e `S8.penFrameGap.*` non lo conta (lo prende dai
fotogrammi di `phases` senza quelli); il referto lo scrive nelle note. Lo
spostamento parte dalla testata della scheda del foglio, va avanti e indietro e la
posa 60 px più in basso. Il referto dà `S8.penFrameGap.max` (l'obiettivo
di N4, 2 periodi dello schermo, cioè 33 ms a 60 Hz, solo fra i `targets`), `S8.keyLatency.p50` (dal tasto D al
secondo fotogramma dopo, come la latenza dei tasti della sonda: almeno un
fotogramma intero), `S8.moveFrameGap.max` senza tetto, i
path asciutti prima e dopo (`S8.dryPaths.*`) e lo sha256 di `voti.xlsx`
letto dal disco prima della penna e 3 s dopo lo spostamento: il foglio non
deve cambiare. Il referto dà `sheetLive` e `sheetState`: se la scheda del
foglio non è viva con le celle entro 60 s, il referto lo dice e la misura
non vale per D-7 (c); la misura di un segnaposto non chiude la voce.

S9 apre `S9/Fogli vivi.canvas`: le 300 schede di S3, negli stessi posti, e
a sinistra della loro prima riga un blocco di 5 × 4 schede di file, i fogli
`S9/Conti-01.xlsx` … `S9/Conti-20.xlsx` (200 × 6 celle, il foglio di R1).
La lavagna ha un nome suo perché S3 apre la sua cercando «Lavagna». Quando la
lavagna è ferma, lo scenario porta la vista sul blocco, fuori dalla misura:
gli scatti di Ctrl+rotella che servono per arrivare dalla vista intera a
zoom 0,5, mandati dalla pagina alla vista della lavagna (come in S8, il
Ctrl+rotella del driver non ingrandisce), tutti sul punto che porta il
centro del blocco al centro della vista. Non c'è uno spostamento col
pulsante di mezzo: WebKitWebDriver non consegna il suo rilascio, e la
lavagna, col gesto ancora in corso, non accenderebbe le schede. Uno zoom
fuori da 0,4–0,6 fa fallire lo scenario: lo
zoom deve stare sopra 0,35, la soglia sotto cui le schede restano
segnaposto. Poi aspetta che i fogli vivi
(`[data-card-kind=sheet][data-card-mode=live]`) siano almeno 20, al più
60 s, altrimenti fallisce e non misura altro; aspetta, ancora al più 60 s,
che mostrino le celle (se non arrivano tutti il referto lo dice) e che la
lavagna sia ferma; poi fa gli stessi gesti di S3, spostamento e zoom. Il
referto dà `S9.liveCards`, i fogli vivi all'inizio della misura, e
`S9.frameGap.p95` e `S9.frameGap.max`. Gli obiettivi sono quelli di S3;
soglie della CI non ce ne sono finché non c'è una misura del runner, e il
job `webview` non lo fa girare.

L1 vive in `canvas.mjs` e segue il patto del
[modulo](../reference/canvas-operations.md#webassembly) come il caricatore
della shell: l'**istanza** è compilare e istanziare il modulo dai suoi byte,
l'**open** va dal testo della lavagna al modello letto, il **commit** dalle
toppe di uno spostamento al tratto cambiato e alle toppe dell'annulla letti.
Ogni commit rimette la scheda dov'era con l'annulla del precedente, e alla
fine il testo deve tornare uguale a quello di partenza. Il nome del modulo,
con l'hash, viene da `apps/client/dist/assets/`: `dist/` deve essere la build
che l'app di release ha dentro (`--dist=` ne sceglie un'altra). Una CSP che
non lascia compilare il modulo fa fallire lo scenario, con l'errore e le
violazioni che la pagina ha visto. Lo scenario fa cinque giri nella stessa
pagina (`L1_ROUNDS`), ognuno col modulo compilato da capo: prima istanza
(`L1.istanza.prima`), prima apertura e primo commit sono del primo giro, il
solo a freddo, e restano nel referto senza soglia; l'istanza (`L1.istanza`)
e i p95 di `open` e `commit` sono la mediana dei giri (`l1Values`). Il p95 di
venti aperture è la seconda più lenta: due intoppi del runner nello stesso
giro lo spostano, ma non spostano la mediana dei giri, mentre un nucleo più
lento sposta tutti i giri e la mediana con loro. Lo stesso per l'istanza:
WebKit non riusa il codice già compilato, ogni giro paga di nuovo la
compilazione, e la prima nella pagina ha sul runner una coda lunga (fino a
90 ms con gli altri giri sui 13) che la mediana dei giri non vede. Il referto
tiene i giri in `rounds`, con compilare e istanziare separati (`compileMs`,
`instantiateMs`). Le soglie della CI vengono da 192 job del runner
([misura](../misure/2026-11-15-lavagna-wasm-runner.md), #388); quella
dell'istanza da 105 job coi cinque giri
([misura](../misure/2026-11-17-lavagna-wasm-istanza-runner.md), #434), quella
di `L1.open.50.p95` da 128
([misura](../misure/2026-11-17-banco-webview-s1-l1-runner.md), #388). La stessa misura
gira in Node, senza app:
`node bench/webview/canvas.mjs` da `apps/client/`, dopo `npm run build`.

## Le soglie in periodi

Il traguardo è la frequenza piena dello schermo, non i 60 Hz. Per questo
una soglia di `targets` in `budgets.json` (versione 2) può valere
`{ "periodi": k }`: k volte il periodo P = 1000/Hz dello schermo dove gira
la finestra. Le regole:

| valore | soglia |
|---|---|
| fotogrammi, p95 (`S3`, `S9`, `S10`) | 1 P |
| fotogrammi, massimo (`S3`, `S5`, `S7`, `S8`, `S9`, `S10`) | 2 P |
| tasto a schermo, p95 (`S1`, `S9`) | 2 P |
| thread principale bloccato per gesto (`F3`, `S10`) | 1 P |
| rAF a vuoto, mediana (`F1`) | 1,1 P |

A 180 Hz il tasto a schermo deve stare in 11,1 ms, a 60 Hz in 33,3. Le
soglie di `ci` restano in ms: sono la soglia di peggioramento del runner
senza scheda grafica e non dipendono dallo schermo. Gli altri valori
(`S2`, `S6`, `I1`, `R1`, `C1`, `F2`) restano in ms o in unità loro.

**Da dove viene P.** Il banco la legge prima di avviare l'app
(`bench/webview/refresh.mjs`), con l'ambiente che avrà l'app:

1. `--hz=N` sulla riga di comando, se si vuole fissarla;
2. su una sessione Wayland, l'uscita a fuoco del compositor, dove si apre
   la finestra nuova: niri (`niri msg --json focused-output`), sway,
   Hyprland;
3. GDK, lo stesso `gdk_monitor_get_refresh_rate` dell'host, letto con
   `python3` e PyGObject: vale con un solo schermo, con tutti gli schermi
   alla stessa frequenza o col primario. Più schermi a frequenze diverse e
   nessun primario non danno una scelta, e il banco chiede `--hz`;
4. altrimenti 60 Hz. Sotto Xvfb GDK dà 0 Hz: P resta 16,67 ms, come nel job
   `webview` della CI.

L'host non ha una porta generica per dire la frequenza, e una IPC nuova
solo per il banco non serve: la legge il banco. Il referto la scrive in
`display`, con la fonte.

**Il tetto del motore.** WebKitGTK 2.54 su Linux disegna al più a 60 Hz
(62,5, col suo timer di 16 ms) qualunque sia lo schermo, quando il vblank
DRM non funziona. Lo dice F1, che gira prima di ogni scenario con una
soglia in periodi (il banco lo aggiunge da sé a `--only`). La regola: se
P < 16 ms e la mediana del rAF a vuoto sta fra 15 e 18,5 ms, il tetto c'è,
e le soglie in periodi valgono a 60 Hz (P efficace 16,67 ms) finché il
tetto c'è. Così uno scenario non diventa rosso per colpa del motore. Il
referto lo scrive in `cap`, e il banco stampa «tetto del motore: le soglie
in periodi valgono a 60 Hz finché il tetto c'è». Una mediana lontana sia
da P sia da 60 Hz non è il tetto: P efficace resta P, e F1 è rosso.

**Il percorso di disegno e il carico.** Prima degli scenari il banco apre
per qualche secondo una WebView WebKitGTK a parte, con l'ambiente dell'app,
e legge `webkit://gpu` (`webkitGpu` in `bench/webview/frames.mjs`, con
PyGObject e WebKit2 4.1): il renderer GL e il vblank di WebKit («Timer,
60Hz» vuol dire il tetto). Sulla shell WebGL non basta, perché WebKitGTK gli
nasconde il renderer («Apple GPU»). F1 scrive nel referto il percorso
(`render.path`: `cpu` per llvmpipe e simili, `gpu`, o `sconosciuto` senza
PyGObject), il renderer con la sua fonte, il vblank e le librerie GL che i
processi della WebView hanno caricato (`render.libraries`). Ogni scenario ha
nel referto il carico della macchina prima e dopo (`load`): con un carico
alto la misura è rumorosa.

**F3 e il thread principale.** WebKit non ha i long task. F3 tiene acceso
un anello di `setTimeout(0)`: un buco fra due giri oltre 5 ms (il timer
annidato si ferma a 4 ms) è tempo in cui il thread principale non ha potuto
eseguire niente. Per ogni ripetizione del gesto vale il buco più lungo, e
la soglia guarda la mediana delle ripetizioni; il referto tiene ogni
ripetizione, il massimo e la somma dei buchi oltre 50 ms. Se il motore ha i
long task, il referto li tiene accanto.

## Linux, con un comando solo

Dalla radice del repository:

```bash
apps/client/bench/webview/misura.sh
```

Lo script costruisce il client e l'app di release, installa `tauri-driver`
in `target/tauri-driver`, senza toccare il sistema, e misura tutti gli
scenari con le soglie `targets` (li tiene tutti `misura.test.mjs`). Se manca
un display usa `xvfb-run`. Prima gli serve WebKitWebDriver, cioè il pacchetto
`webkit2gtk-driver`, e senza display anche `xvfb`: se mancano, lo script lo
dice e si ferma. Gli argomenti
in più vanno a `run.mjs`, per esempio `--only=R1,T1`. Su una sessione Wayland
`misura.sh` non usa Xvfb: senza `--wayland` (o, sotto Xvfb, `--x11` con la
variabile tolta) il banco si ferma, come dice la sezione che segue.

## Linux e Windows, passo per passo

1. Costruisci il client e l'app:

   ```bash
   cd apps/client && npm ci && npm run build && cd ../..
   cargo build --release --locked -p fub-app --features tauri/custom-protocol,bench-gc
   cargo install tauri-driver --version "=2.1.0" --locked
   ```

   `bench-gc` serve a R1 su Linux (la [raccolta forzata](webview-memory.md)); su Windows
   non cambia niente.

2. Su Linux serve WebKitWebDriver (pacchetto `webkit2gtk-driver`); su Windows
   msedgedriver della stessa versione di WebView2, nel `PATH`.
3. Da `apps/client/`:

   ```bash
   npm run bench:webview -- --budgets=targets
   ```

   Su Linux aggiungi `--native-driver=/usr/bin/WebKitWebDriver`. Misura sia
   in una sessione Wayland sia in una X11.

   Con `WAYLAND_DISPLAY` impostato il banco non parte senza una scelta. GTK
   aprirebbe la finestra in Wayland, cioè sullo schermo di chi misura, e non in
   Xvfb dove il driver muove il puntatore: S3 fallisce con «move target out of
   bounds». Il banco si ferma e dice che cosa usare:

   - sotto Xvfb su una sessione Wayland, `--x11`, con la variabile tolta al
     comando: `xvfb-run -a -s "-screen 0 1280x800x24 -noreset" env -u WAYLAND_DISPLAY npm run bench:webview -- … --x11`.
     `--x11` toglie `WAYLAND_DISPLAY` al driver e mette `GDK_BACKEND=x11`, e il
     referto scrive `x11` come sessione;
   - per misurare sullo schermo vero, su una sessione Wayland, `--wayland`.

   Sullo schermo vero, con le soglie in periodi:
   `npm run bench:webview -- --budgets=targets --wayland --native-driver=/usr/bin/WebKitWebDriver`.

   Il job `webview` della CI non ha `WAYLAND_DISPLAY` e non cambia. La guardia
   è in `bench/webview/display.mjs`, con la sua prova in
   `bench/webview/display.test.mjs`: `npx vitest run bench/webview/display.test.mjs`
   (in `.mjs` perché usa Node, e il `tsc` del client non ha i suoi tipi).

   Sotto Xvfb serve `-noreset` fra gli argomenti del server
   (`xvfb-run -s "… -noreset"`). Senza, Xvfb si rigenera ogni volta che esce
   il suo ultimo client, cioè l'app dello scenario appena chiuso, e l'app dopo
   a volte non apre il display: GTK non parte e l'app muore con «Failed to
   initialize gtk backend!» (#287; 21 aperture fallite su 10.000 di
   `xdpyinfo` senza `-noreset`, nessuna con). Il banco lo dice all'inizio, con
   un avviso `⚠`, se trova l'Xvfb di `DISPLAY` senza `-noreset`.

   Fra un'app e la successiva il banco aspetta che l'app di prima e i
   processi della sua WebView siano usciti, guardando per PID i discendenti
   di `tauri-driver`, al più 30 s (fuori da Linux una pausa di 3 s): Fub ha
   un'istanza sola, e un'app che parte mentre la vecchia è viva le cede. Se
   l'app nuova muore lo stesso con «Failed to initialize gtk backend!», il
   banco non aspetta i cinque minuti di WebKitWebDriver: riavvia il driver e
   riprova una volta sola, con un avviso nel log che comincia con `⚠`, il
   nome dello scenario e «l'app non ha inizializzato GTK»; al secondo
   fallimento lo scenario è rosso.

   L'istanza sola passa dal bus D-Bus di sessione, non dalla cartella di
   configurazione: su un desktop dove gira un altro Fub (l'app installata, il
   banco di un'altra sessione) l'app del banco gli cederebbe. Lì il banco va
   lanciato con un bus suo, `dbus-run-session -- xvfb-run …`.

Il referto va in `apps/client/bench/.output/webview/referto.json`. Il comando
esce con 1 se un valore supera la soglia scelta.

Il job `webview` della CI fa lo stesso sotto Xvfb e senza scheda grafica, in
due macchine che compilano l'app ognuna per sé: una fa S1–S3, S7, T1, I1, L1
e C1 e carica il referto come artifact `webview-scenari-<sha>`, l'altra fa
soltanto R1, la [memoria](webview-memory.md), e lo carica come
`webview-memoria-<sha>`.

Una macchina con la scheda grafica non vede ciò che costa alla CI dipingere:
WebKitGTK usa la GPU anche sotto `xvfb-run`, e un'ombra o una sfumatura che
il runner ridipinge a ogni tasto lì non pesa. Per misurare come la CI, la
WebView va obbligata a Mesa in software:

```bash
__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json \
LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=llvmpipe \
xvfb-run -a -s "-screen 0 1280x800x24 -noreset" npm run bench:webview -- --only=S1 --native-driver=/usr/bin/WebKitWebDriver
```

Così S1 scende a una ventina di campioni per giro, come in CI: la sonda misura un
tasto alla volta, e quando un fotogramma è lento i tasti di WebDriver vi si
accodano. Pochi campioni insieme a un p95 alto vogliono dire fotogrammi lenti
da dipingere. Un confronto fra due versioni si fa alternando le corse.

## macOS

WKWebView non ha un driver WebDriver. Si misura a mano:

1. Avvia l'app di release con `FUB_VAULT` e `FUB_CONFIG_DIR` che puntano alle
   fixture: `node -e 'import("./bench/webview/fixtures.mjs").then(m => console.log(m.writeFixtures(process.argv[1])))' /tmp/fub-misure`
   da `apps/client/` le scrive e stampa i percorsi.
2. Apri l'Inspector Web di Safari sulla finestra di Fub.
3. Per ogni scenario: `__fubProbe.start()` nella console, fai il gesto della
   tabella, poi `copy(JSON.stringify(__fubProbe.stop()))`.
4. Incolla i referti in un file di `docs/misure/` col formato del README.

## La penna sui dispositivi

La sonda misura dall'evento al fotogramma, non dalla punta allo schermo. La
latenza vera della penna si misura con una telecamera a 240 fotogrammi al
secondo, su un iPad, un tablet Android e un PC con tavoletta:

1. Apri un disegno in Fub e, accanto, l'app di disegno nativa del sistema.
2. Riprendi da vicino la punta e il tratto, con la stessa luce, per dieci
   tratti veloci in ciascuna app.
3. Conta i fotogrammi fra la punta e l'inchiostro (ognuno vale 4,17 ms).
4. Scrivi mediana e massimo di Fub e dell'app nativa, col dispositivo, la
   versione del sistema e il commit.

L'obiettivo è al più un fotogramma dello schermo in più dell'app nativa.
