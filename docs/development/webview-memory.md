# La memoria nella WebView (R1)

Questa pagina dice come lo scenario R1 del [banco WebView](webview-measurements.md)
misura la memoria dell'app vera, e perché la misura è fatta così.

> **Per chi:** chi legge o cambia R1, la raccolta forzata `bench-gc` o le
> sue soglie.
> **Risultato:** sa leggere il referto di R1 e cosa lo rende rosso.

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
4. **giri**: trenta volte tutti i file aperti e poi tutto chiuso; dopo ogni
   chiusura una lettura a 10 s e poi una ogni 5 s fino a 60 s, e il giro vale
   la più bassa; alla fine la lettura **tardi**, 60 s dopo l'ultima chiusura.

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
Il giro vale la lettura più bassa del suo minuto perché la WebView raccoglie
quando vuole ciò che la lavagna lascia aprendosi: sul runner 300–400 MiB, che
una lettura sola a 10 s trovava raccolti o no a caso, e la pendenza saltava
fra −20 e +56 MiB per giro sullo stesso albero
([#284](https://github.com/Fubeo/Fub/issues/284)). Ciò che un giro lascia
davvero non scende, e la lettura più bassa lo tiene. Il referto tiene per ogni
giro anche la lettura a 10 s (`soon`) e quando è arrivata la più bassa
(`lowestAtMs`).

Prima di ogni lettura a schede chiuse (vuota, chiuse, chiuse.tardi, ogni
lettura dei giri e tardi) il banco chiede alla WebView una **raccolta
forzata** e aspetta che finisca: una raccolta piena e sincrona di
JavaScriptCore, il rilascio che WebKit fa da sé sotto memoria scarsa e
`malloc_trim`. Senza, la lettura diceva se la WebView aveva già raccolto da
sé, non quanto restava. Le letture a schede aperte non la chiedono. WebKitGTK
4.1 non ha un'API del processo dell'app per farlo (la libreria non esporta
una raccolta a comando né un evento di memoria scarsa): la fa un'estensione
web, `apps/client/bench/webview/raccolta.rs`, che
il banco costruisce con `rustc` in una cartella della corsa e che dà alla
pagina `window.__fubBenchGc`. Il gancio che la carica sta nell'app soltanto
con la feature `bench-gc` di `fub-app`, spenta di serie: l'app che si
distribuisce non sa caricare un'estensione, e con `FUB_BENCH_GC` nell'ambiente
scrive soltanto un avviso nel log. La build del banco è

```bash
cargo build --release --locked -p fub-app --features tauri/custom-protocol,bench-gc
```

e la fanno così `misura.sh` e il job `webview` della CI. In quella build l'app
carica l'estensione soltanto se trova nell'ambiente all'avvio `FUB_BENCH_GC`
con la cartella assoluta dell'estensione (`crates/fub-app/src/bench_gc.rs`):
allora la finestra principale riparte in un processo nuovo, che carica
l'estensione. Senza la variabile non succede niente. Niente comando IPC,
niente porte, niente file del vault; soltanto Linux. R1 gira su un driver
suo, con la variabile accesa, e gli altri scenari tornano su un driver
senza, così l'avvio misurato da S6 non cambia. Con l'app aperta sui sette
file il banco chiede una raccolta in più e controlla che schede e scheda
attiva restino quelle. Il referto di R1 dice in `gc` se la raccolta c'era, e
quante ce ne sono state. Chiesta a un'app costruita senza `bench-gc`, o se
l'estensione non si costruisce, R1 misura lo stesso ma è rossa, e il referto
dice «gancio assente: l'app non è costruita con bench-gc». `--gc=no` misura
senza raccolta, come prima. Ogni lettura
porta anche la PSS finita nello swap (`swap`): su una macchina sotto carico
la PSS può scendere perché il sistema ha spostato pagine, non perché la
memoria è tornata.

La memoria della WebView sale e scende a dente di sega, di circa 150 MiB, col
ritmo del suo GC. Con dieci giri e la retta dei minimi quadrati, una lettura
alta in cima o bassa in fondo spostava la pendenza di decine di MiB: sul
runner andava da -25 a 70 MiB per giro sullo stesso albero (#284). Trenta
giri e la mediana la tengono entro pochi MiB, insieme alla raccolta forzata
e alla lettura più bassa del minuto; il job WebView dura di più (circa un
minuto per giro).
La tolleranza, fissata in K0, sta in `budgets.json`: come obiettivo (il
cancello di K3) residuo entro 50 MiB e pendenza entro 1 MiB per giro, sul
runner una volta e mezza il peggiore visto.
