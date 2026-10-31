# Misure nella WebView

Questa guida dice come misurare i tempi di Fub nella WebView vera, con la
sonda delle prestazioni e i sette scenari del banco WebView.

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
| S3 | spostamento e zoom di una lavagna di 300 schede, 20 note vive | p95 e massimo fra fotogrammi |
| S4 | trascinamento del grafo di 10.000 nodi | p95 e massimo fra fotogrammi |
| S5 | tratto di penna di 3 s su un disegno di 2.000 tracciati | massimo fra fotogrammi |
| S6 | avvio a freddo fino alla prima nota | ms |
| S7 | Blocchi su una nota di 2.000 righe: un blocco trascinato su e giù per 3 s, poi dieci trasformazioni da paragrafo a titolo e ritorno | p95 e massimo fra fotogrammi |
| R1 | la memoria: l'app vuota, aprendo un file per modalità (nota, lavagna, disegno, documento Word, foglio Excel, PDF, immagine), dopo «chiudi tutto» e un minuto dopo | PSS in MiB, in tutto e per processo (app, WebView), soltanto Linux |
| T1 | le tessere: un fotogramma di 2880 × 1800 RGBA letto a tessere di 256 × 256 dalla IPC (`resource_read_chunk`) e da `fub-asset:` con `Range`, poi disegnato su una tela, una tessera e un fotogramma intero per fotogramma | p95 per tessera, mediana per fotogramma, ms |
| I1 | il vault durante l'indicizzazione dell'avvio (10.000 note): una nota aperta con `read_document` e una tessera letta dalla IPC, una dopo l'altra, finché `vault_status` non dice che l'indice è pronto | p95 per nota e per tessera, ms |

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
4. **giri**: dieci volte tutti i file aperti e poi tutto chiuso, una lettura
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
`R1.giri.ultimo.MiB` sono il residuo dopo il primo e dopo il decimo giro,
`R1.giri.pendenza.MiB` la retta dei minimi quadrati sui dieci residui, in MiB
per giro, e `R1.giri.tardi.MiB` il residuo un minuto dopo l'ultimo giro; gli
stessi valori ci sono per ogni gruppo. Una pendenza vicina a zero è memoria
che torna o si riusa; una pendenza positiva è memoria che ogni giro lascia.
La tolleranza, fissata in K0, sta in `budgets.json`: come obiettivo (il
cancello di K3) residuo entro 50 MiB e pendenza entro 1 MiB per giro, sul
runner una volta e mezza il peggiore visto.

T1 è la prima delle tre vie del piano dei componenti per la tela dei motori
(tessere verso la WebView, superficie wgpu nativa, egui): misura il trasporto
e il disegno senza motore (`tiles.mjs`). Il tempo del motore per un fotogramma
sta nelle prove di `tools/motori-prova`. Le chiamate passano da
`__TAURI_INTERNALS__`, come fa `@tauri-apps/api`.

I1 controlla che l'indicizzazione non fermi il vault (`indexing.mjs`): ogni
avvio sul vault del banco indicizza le diecimila note, e i comandi che passano
dal workspace non devono aspettare la fine di una fetta. Lo scenario fallisce
se l'indice era già pronto all'avvio, perché allora non ha misurato niente.

Le fixture nascono in una cartella temporanea
(`apps/client/bench/webview/fixtures.mjs`); il vault vero di chi misura non
si tocca. Gli obiettivi e le soglie stanno in
`apps/client/bench/webview/budgets.json`: `targets` sono gli obiettivi,
`ci` le soglie di peggioramento del runner, tarate sulle sue misure vere.

S5 chiede la feature `draw` dell'app: senza, un `.svg` si apre come immagine
e il referto scrive lo scenario come saltato, senza numero.

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
in più vanno a `run.mjs`, per esempio `--only=R1,T1`.

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

Il referto va in `apps/client/bench/.output/webview/referto.json`. Il comando
esce con 1 se un valore supera la soglia scelta.

Il job `webview` della CI fa lo stesso con S1–S3, S7, R1, T1 e I1, sotto Xvfb e
senza scheda grafica, e carica il referto come artifact `webview-<sha>`.

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
