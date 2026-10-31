# 2026-10-31, Linux, WebKitGTK, runner della CI: la memoria e le tessere

Questa pagina conserva le due misure di K0 nella WebView vera: la memoria
dell'app per modalità (R1) e le tessere di un fotogramma (T1), la prima delle
tre vie per la tela dei motori.

> **Per chi:** chi sceglie la via della tela dei motori o stima quanta memoria
> costa una modalità.
> **Risultato:** sapere quanto pesa l'app sul runner, quanto restituisce
> chiudendo le schede e quanto costa portare una tessera nella WebView.

## Chi, cosa, quando

- commit `342b7361`, ramo `fase/k0-misure` (la CI misura il merge `24ac1120`
  della PR #269), 2026-10-31;
- misurato dal job «la WebView vera (WebKitGTK, S1–S3)» della CI, run
  41163700163, artifact `webview-24ac1120…`;
- comando: `node bench/webview/run.mjs --only=S1,S2,S3,S7,R1,T1`.

## La macchina e la WebView

La stessa della [prima misura sul runner](2026-10-30-linux-webkitgtk-runner.md):
AMD EPYC 7763, 4 nuclei virtuali, 16 GiB, nessuna scheda grafica, Linux
7.0.0-1017-azure sotto Xvfb, WebKitGTK `AppleWebKit/605.1.15`.

## R1, la memoria

PSS in MiB, letta da `/proc` sui processi dell'app e della WebView, dopo due
secondi di quiete. L'avvio riapre le due schede del riscaldamento; poi si apre
un file per modalità, uno dopo l'altro, senza chiudere i precedenti, e alla
fine si chiudono tutte le schede.

| Momento | Totale | App | WebView | Rete |
|---|---|---|---|---|
| avvio, 2 schede riaperte | 1139,5 | 505,0 | 614,5 | 20,0 |
| + nota di 5.000 righe | 1252,6 | 504,6 | 728,1 | 20,0 |
| + lavagna (disegno) | 1523,8 | 504,7 | 999,2 | 19,9 |
| + foglio da disegno | 1491,7 | 504,9 | 965,6 | 21,2 |
| + documento di Word | 1510,8 | 508,0 | 981,8 | 21,0 |
| + foglio di calcolo | 1536,3 | 510,3 | 1005,0 | 21,0 |
| + PDF | 1444,4 | 511,0 | 912,4 | 21,0 |
| + immagine (7 schede) | 1446,7 | 511,0 | 914,7 | 21,0 |
| tutte chiuse | 1458,1 | 511,0 | 926,2 | 21,0 |

- Il processo dell'app resta fermo intorno ai 505–511 MiB: i motori aperti
  non vi aggiungono quasi niente.
- La WebView cresce di 113 MiB con la nota lunga e di 271 con la lavagna; le
  altre modalità oscillano di qualche decina di MiB, perché la memoria del
  motore JavaScript si raccoglie quando vuole.
- **Chiudere tutte le schede non restituisce memoria**: dopo la chiusura il
  totale è 318,6 MiB sopra l'avvio, quanto con le schede aperte.

## T1, le tessere

Un PNG di 20,7 MB (2880 × 1800 RGBA, senza compressione), aperto con
`resource_open`. Una tessera è 256 × 256 RGBA, 256 KiB. I tempi sono in
millisecondi.

| Misura | p50 | p95 | max | Campioni |
|---|---|---|---|---|
| una tessera dalla IPC (`resource_read_chunk`, 4 pezzi da 64 KiB) | 14 | 1647 | 1947 | 60 |
| `putImageData` di una tessera | 3 | 4 | 78 | 120 |
| intervallo fra fotogrammi, una tessera per fotogramma | 27 | 43 | 172 | 120 |
| `putImageData` di un fotogramma intero | 5 | 6 | 14 | 30 |
| intervallo fra fotogrammi, un fotogramma intero per fotogramma | 29 | 35 | 53 | 30 |
| una tessera da `fub-asset:` con `Range` | non misurata | | | |
| il fotogramma da `fub-asset:` a finestre di 1 MiB | non misurato | | | |

- **La pagina non legge `fub-asset:` con `fetch`**, né con `Range` né il file
  intero: WebKitGTK risponde «Load failed». Il protocollo serve gli elementi
  `img` e `video`, che non chiedono CORS; la risposta non porta
  `Access-Control-Allow-Origin`, e una `fetch` dall'origine della pagina verso
  un altro schema lo richiede. È l'ipotesi più probabile, non provata. Per la
  via delle tessere servirebbe quell'intestazione per l'origine fidata, in
  `fub-app/src/resources.rs`.
- La IPC regge la mediana (14 ms per 256 KiB) ma ha una coda di quasi due
  secondi: una tessera su venti arriva tardi di cento fotogrammi.
- Il disegno non è il collo di bottiglia: un fotogramma intero si posa in
  5 ms anche senza GPU.

## Cosa non dice

Il runner disegna senza GPU sotto Xvfb e i suoi tempi stanno un ordine di
grandezza sopra una macchina vera. La memoria di WebKitGTK senza GPU non è
quella di WKWebView o di WebView2.

## Non provati

- `fub-asset:` con `fetch`: manca l'intestazione, vedi sopra;
- R1 e T1 su macOS, Windows e una macchina Linux con scheda grafica;
- le altre due vie per la tela (wgpu nativo, egui nella finestra): servono una
  macchina con GPU e uno schermo.
