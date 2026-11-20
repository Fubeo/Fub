# La pagina del PDF disegnata in un worker

Quanto blocca il thread principale una pagina del visore dei PDF sfogliata
(S11), prima e dopo il disegno in un worker (#525).

> **Per chi:** chi lavora sulla fluidità del visore dei PDF.
> **Risultato:** la mediana del thread bloccato per pagina scende da 21–26 ms
> a 8–9 ms; resta sopra un periodo dello schermo a 180 Hz (5,56 ms), quindi
> S11 resta senza soglie in `budgets.json`.
> Il worker costa da due a due volte e mezza la misura del PDF in memoria:
> sopra 64 MiB non si apre.

Il disegno nel worker è descritto in
[Il visore dei PDF](../product/pdf-annotations.md#il-visore-dei-pdf); lo
scenario in [Misure nella WebView](../development/webview-measurements.md#gli-scenari).

## Macchina e sistema

- build di rilascio: prima da `e16c0f011`, dopo dal ramo `perf/pdf-pagina`
  con il worker, 20 novembre 2026, misura di un agente;
- Intel Core i5-13600KF, 20 thread, 31 GiB, NVIDIA RTX 4070;
- schermo DP-2 a 179,96 Hz (P 5,56 ms, da niri);
- Debian 13, kernel 6.12.113, niri su Wayland, WebKitGTK 2.54, disegno sulla
  GPU (`webkit://gpu`);
- comando: `npm run bench:webview -- --only=S11 --budgets=targets --wayland
  --native-driver=/usr/bin/WebKitWebDriver --app=BINARIO`, con il binario di
  rilascio, dalla coda dei controlli pesanti, due giri per parte.

## Risultati

| valore | prima, giro 1 | prima, giro 2 | dopo, giro 1 | dopo, giro 2 |
|---|---|---|---|---|
| `S11.pagina.mainBlocked` (mediana di 24 pagine) | 26 ms | 21 ms | 8 ms | 9 ms |
| `S11.scroll.frameGap.p95` | 6 ms | 6 ms | 6 ms | 6 ms |
| `S11.scroll.frameGap.max` | 6 ms | 15 ms | 6 ms | 6 ms |
| `S11.scroll.busy.p95` | 10 ms | 9 ms | 8 ms | 9 ms |
| carico della macchina (1 min) | 73 | 127 | 8 | 66 |

Prima, la pagina blocca il thread per due motivi, visti in una traccia di
Chromium: la lista dei comandi di pdf.js (12–15 ms) e il commit del canvas
2d verso il compositor (5–6 ms). Dopo, il thread principale chiede la pagina
al worker e mette nel canvas l'immagine pronta (`bitmaprenderer`). Gli 8 ms
che restano sono quell'immagine, larga un A4 e alta due alla risoluzione
dello schermo, consegnata al compositor; il secondo giro "dopo", con carico
66, dà gli stessi 8–13 ms per pagina del primo.

Alcuni giri hanno buchi isolati da 0,1 a 7,7 s su una pagina, prima e dopo:
cadono quando il carico della macchina passa 100 e non spostano la mediana.

## La memoria

Quanta memoria prende in più il worker, che tiene una sua copia dei byte (da
`getData()`, passata al worker spostata, non copiata) e un suo pdf.js.

- PDF generati in una cartella temporanea, mai nel repo: una pagina con del
  testo e un flusso di byte casuali che nessuno disegna, di 60 e 126 MB;
- Chromium headless di Playwright (non la WebView di Tauri: la build di
  rilascio non espone la sua memoria per processo), pagina servita dal Vite
  del banco, il caricatore vero di `pdf-view.ts` con e senza il worker;
- PSS dei processi `renderer` (`/proc/PID/smaps_rollup`), prima di aprire il
  PDF, 10 s dopo la seconda pagina chiesta (il worker ha aperto il PDF e
  disegnato), e 8 s dopo la chiusura.

| PDF | senza worker | con il worker | in più |
|---|---|---|---|
| 60 MB | +114 MB | +270 MB | 156 MB, 2,6 volte il file |
| 126 MB, senza limite | +180 MB | +451 MB | 271 MB, 2,2 volte il file |
| 126 MB, con il limite a 64 MiB | +180 MB | +175 MB | nessuno: il worker non si apre |

Il raddoppio resta grande, quindi `PDF_RENDER_WORKER_MAX_BYTES`
(`pdf-render-client.ts`) lascia nel thread principale i PDF sopra 64 MiB.
Chiuso il PDF, la memoria scende da sé (112 MB senza worker, 177 MB con il
worker dopo 8 s, il resto al giro di raccolta dopo).
