# Misure nella WebView

Questa guida dice come misurare i tempi di Fub nella WebView vera, con la
sonda delle prestazioni e i sei scenari del banco WebView.

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

## I sei scenari

| Scenario | Gesto | Valore |
|---|---|---|
| S1 | 200 caratteri in fondo a una nota di 5.000 righe | p95 tasto → fotogramma |
| S2 | venti passaggi fra note di un vault di 10.000 | p95 gesto → nota visibile |
| S3 | spostamento e zoom di una lavagna di 300 schede, 20 note vive | p95 e massimo fra fotogrammi |
| S4 | trascinamento del grafo di 10.000 nodi | p95 e massimo fra fotogrammi |
| S5 | tratto di penna di 3 s su un disegno di 2.000 tracciati | massimo fra fotogrammi |
| S6 | avvio a freddo fino alla prima nota | ms |

Le fixture nascono in una cartella temporanea
(`apps/client/bench/webview/fixtures.mjs`); il vault vero di chi misura non
si tocca. Gli obiettivi e le soglie stanno in
`apps/client/bench/webview/budgets.json`: `targets` sono gli obiettivi,
`ci` le soglie di peggioramento del runner, tarate sulle sue misure vere.

S5 chiede la feature `draw` dell'app: senza, un `.svg` si apre come immagine
e il referto scrive lo scenario come saltato, senza numero.

## Linux e Windows

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

Il job `webview` della CI fa lo stesso con S1–S3, sotto Xvfb e senza scheda
grafica, e carica il referto come artifact `webview-<sha>`.

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
