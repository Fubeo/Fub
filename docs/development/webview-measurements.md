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

## Gli scenari

| Scenario | Gesto | Valore |
|---|---|---|
| S1 | 200 caratteri in fondo a una nota di 5.000 righe | p95 tasto → fotogramma |
| S2 | venti passaggi fra note di un vault di 10.000 | p95 gesto → nota visibile |
| S3 | spostamento e zoom di una lavagna di 300 schede, 20 note vive, partiti quando la lavagna è ferma | p95 e massimo fra fotogrammi; l'apertura in ms, solo referto |
| S4 | trascinamento del grafo di 10.000 nodi | p95 e massimo fra fotogrammi |
| S5 | tratto di penna di 3 s su un disegno di 2.000 tracciati | massimo fra fotogrammi |
| S6 | avvio a freddo fino alla prima nota | ms |
| S7 | Blocchi su una nota di 2.000 righe: un blocco trascinato su e giù per 3 s, poi dieci trasformazioni da paragrafo a titolo e ritorno | p95 e massimo fra fotogrammi |
| S9 | la lavagna di S3 con venti fogli `.xlsx` vivi: spostamento e zoom come S3; poi una nota di quella lavagna in scrittura, 200 caratteri come S1 (`S9.keyToPaint`) | p95 e massimo fra fotogrammi; p95 tasto → fotogramma |
| S8 | la penna sulla lavagna: dieci tratti da 300 ms sopra una scheda con una tabella di 100 × 100 celle, su una lavagna con un foglio `.xlsx` di 100 × 100 celle e 2.000 tratti già scritti; poi la scheda della tabella spostata coi suoi tratti per 2 s | massimo fra fotogrammi a penna (obiettivo 33 ms) e allo spostamento; path asciutti; sha256 del `.xlsx` prima e dopo |
| S9 | spostamento e zoom di S3 sulla lavagna di S3 con in più 20 fogli vivi (`.xlsx`), la vista sul loro blocco a zoom 0,5 | numero dei fogli vivi; p95 e massimo fra fotogrammi |
| R1 | la memoria: l'app vuota, aprendo un file per modalità (nota, lavagna, disegno, documento Word, foglio Excel, PDF, immagine), dopo «chiudi tutto» e un minuto dopo | PSS in MiB, in tutto e per processo (app, WebView), soltanto Linux |
| T1 | le tessere: un fotogramma di 2880 × 1800 RGBA letto a tessere di 256 × 256 dalla IPC (`resource_read_chunk`) e da `fub-asset:` con `Range`, poi disegnato su una tela, una tessera e un fotogramma intero per fotogramma | p95 per tessera, mediana per fotogramma, ms |
| I1 | il vault durante l'indicizzazione dell'avvio (10.000 note): una nota aperta con `read_document` e una tessera letta dalla IPC, una dopo l'altra, finché `vault_status` non dice che l'indice è pronto | p95 per nota e per tessera, ms |
| L1 | il nucleo della lavagna in WebAssembly: il modulo degli asset compilato con la CSP dell'app, poi venti aperture e duecento spostamenti di una scheda su una lavagna di 50 e una di 2.000 schede | istanza; prima apertura, primo commit e p95, ms |
| C1 | i profili dei componenti: «Solo note» e poi «Tutto» applicati con `components_apply`, l'app riavviata sulla nota lunga, poi un'altra nota aperta | avvio a freddo in ms, chunk scaricati all'avvio, chunk dei componenti spegnibili arrivati (zero in tutti e due i profili) |

S9 misura anche il tasto fino al fotogramma in una scheda di nota della stessa
lavagna (`S9.keyToPaint`, obiettivo 16,7 ms): la scheda va a zoom 0,5 al centro
della vista, si sceglie con un clic e si entra con Invio, si scrive un carattere
che non si misura (il montaggio dell'editor) e poi i 200 caratteri di S1, con la
sonda accesa. Lo fa in un'app nuova: il pan col pulsante di mezzo dei gesti di S3
lascia WebKitWebDriver con il pulsante premuto, e dopo non arrivano clic né
tasti alla lavagna. Se la sonda non registra nessun tasto, o il testo non arriva
nell'editor della scheda, il valore è `null` e il referto lo dice: la misura non
vale. Uno scenario senza campioni non scrive un valore: un tempo di zero non è
una misura, e la soglia lo conta come misura che manca.

R1 legge `/proc/<pid>/smaps_rollup` dei processi che discendono dal driver,
tolti i driver (`memory.mjs`): la PSS divide le pagine condivise fra chi le
usa, quindi la somma non conta due volte le librerie. Ogni lettura è la
mediana di tre a mezzo secondo. Il referto dà anche la RSS, i gruppi per
processo (`app` è l'host Rust con la finestra, `webview` i processi
WebKitWebProcess, poi `rete` e `gpu`) e la superficie che ogni file ha
aperto.

La procedura è fissa:

1. **vuota**: chiuse le schede che l'app riapre, 10 s di quiete, una lettura;
2. **aperte**: un file per modalità, senza chiudere i precedenti, una lettura
   3 s dopo ognuno;
3. **chiuse**: chiuse tutte le schede, una lettura dopo 10 s e una dopo 60 s
   (**chiuse.tardi**);
4. **giri**: trenta volte tutti i file aperti e poi tutto chiuso, una lettura
   10 s dopo ogni chiusura, e alla fine una dopo 60 s.

Ogni momento si legge in tutto e per gruppo di processi
(`R1.vuota.app.MiB`, `R1.vuota.webview.MiB` e così via), e il referto tiene
anche ogni processo con la sua PSS e la sua RSS.

Il **residuo dopo la chiusura** (`R1.residuo.MiB`, e `R1.residuo.app.MiB`,
`R1.residuo.webview.MiB` per processo) è «chiuse.tardi» meno «vuota»: la
memoria che le schede chiuse tengono ancora un minuto dopo. Lo fanno le cache
(caratteri, immagini decodificate, tessere), la memoria di JavaScript che la
WebView non ha ancora raccolto e le pagine che l'allocatore ha liberato ma non
ha restituito al sistema. I giri dicono se cresce: `R1.giri.primo.MiB` e
`R1.giri.ultimo.MiB` sono il residuo dopo il primo e dopo il trentesimo giro,
`R1.giri.pendenza.MiB` la mediana delle pendenze fra ogni coppia di giri (lo
stimatore di Theil e Sen), in MiB per giro, e `R1.giri.tardi.MiB` il residuo un minuto dopo l'ultimo giro; gli
stessi valori ci sono per ogni gruppo. Una pendenza vicina a zero è memoria
che torna o si riusa; una pendenza positiva è memoria che ogni giro lascia.

La memoria della WebView sale e scende a dente di sega, di circa 150 MiB, col
ritmo del suo GC. Con dieci giri e la retta dei minimi quadrati, una lettura
alta in cima o bassa in fondo spostava la pendenza di decine di MiB: sul
runner andava da -25 a 70 MiB per giro sullo stesso albero (#284). Trenta
giri e la mediana la tengono entro pochi MiB, e il job WebView dura una
dozzina di minuti in più.
La tolleranza, fissata in K0, sta in `budgets.json`: come obiettivo (il
cancello di K3) residuo entro 50 MiB e pendenza entro 1 MiB per giro, sul
runner una volta e mezza il peggiore visto.

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
ingrandisce. Se la penna non
scrive (la sonda non vede eventi `pen`, o i path asciutti non crescono),
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
di N4, 33 ms, solo fra i `targets`), `S8.keyLatency.p50` (dal tasto D al
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
violazioni che la pagina ha visto. La stessa misura gira in Node, senza app:
`node bench/webview/canvas.mjs` da `apps/client/`, dopo `npm run build`.

## Linux, con un comando solo

Dalla radice del repository:

```bash
apps/client/bench/webview/misura.sh
```

Lo script costruisce il client e l'app di release, installa `tauri-driver`
in `target/tauri-driver`, senza toccare il sistema, e misura tutti gli
scenari con le soglie `targets`. Se manca un display usa `xvfb-run`. Prima
gli serve WebKitWebDriver, cioè il pacchetto `webkit2gtk-driver`, e senza
display anche `xvfb`: se mancano, lo script lo dice e si ferma. Gli argomenti
in più vanno a `run.mjs`, per esempio `--only=R1,T1`. Su una sessione Wayland
`misura.sh` non usa Xvfb: senza `--wayland` (o, sotto Xvfb, `--x11` con la
variabile tolta) il banco si ferma, come dice la sezione che segue.

## Linux e Windows, passo per passo

1. Costruisci il client e l'app:

   ```bash
   cd apps/client && npm ci && npm run build && cd ../..
   cargo build --release --locked -p fub-app --features tauri/custom-protocol
   cargo install tauri-driver --version "=2.1.0" --locked
   ```

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
     comando: `xvfb-run -a env -u WAYLAND_DISPLAY npm run bench:webview -- … --x11`.
     `--x11` toglie `WAYLAND_DISPLAY` al driver e mette `GDK_BACKEND=x11`, e il
     referto scrive `x11` come sessione;
   - per misurare sullo schermo vero, su una sessione Wayland, `--wayland`.

   Il job `webview` della CI non ha `WAYLAND_DISPLAY` e non cambia. La guardia
   è in `bench/webview/display.mjs`, con la sua prova in
   `bench/webview/display.test.ts`: `npx vitest run bench/webview/display.test.ts`.

Il referto va in `apps/client/bench/.output/webview/referto.json`. Il comando
esce con 1 se un valore supera la soglia scelta.

Il job `webview` della CI fa lo stesso con S1–S3, S7, R1, T1, I1, L1 e C1, sotto Xvfb e
senza scheda grafica, e carica il referto come artifact `webview-<sha>`.

Una macchina con la scheda grafica non vede ciò che costa alla CI dipingere:
WebKitGTK usa la GPU anche sotto `xvfb-run`, e un'ombra o una sfumatura che
il runner ridipinge a ogni tasto lì non pesa. Per misurare come la CI, la
WebView va obbligata a Mesa in software:

```bash
__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json \
LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=llvmpipe \
xvfb-run -a npm run bench:webview -- --only=S1 --native-driver=/usr/bin/WebKitWebDriver
```

Così S1 scende a una ventina di campioni, come in CI: la sonda misura un
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
3. Conta i fotogrammi fra la punta e l'inchiostro: ogni fotogramma vale
   4,17 ms.
4. Scrivi mediana e massimo di Fub e dell'app nativa, col dispositivo, la
   versione del sistema e il commit.

L'obiettivo è al più un fotogramma dello schermo in più dell'app nativa.
