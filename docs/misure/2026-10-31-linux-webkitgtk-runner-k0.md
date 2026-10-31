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
  41163700163, artifact `webview-24ac1120…`; secondo giro nel run
  41165492127 (commit `082f2b1e`); terzo, con la procedura fissa di R1, la
  memoria per processo e `fub-asset:` con CORS, nel run 41193655323 (commit
  `a2149269`, merge `42e51ff4`, artifact `webview-42e51ff4…`);
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
- Chiudere tutte le schede non restituisce memoria subito: dopo la chiusura
  il totale è 318,6 MiB sopra l'avvio, quanto con le schede aperte.

Il secondo giro (run 41165492127, commit `082f2b1e`, stesse schede) dice
quanto il numero dipende da quando la WebView raccoglie la memoria: avvio
984,7, picco 1435,1 con la lavagna, 1083,7 con le sette schede aperte, 1082
dopo la chiusura, **residuo 97,3 MiB**. La WebView è scesa da 1041 a 675 MiB
fra la lavagna e l'immagine, con le schede ancora aperte. Un residuo si
legge soltanto su più giri, e chiudere le schede non lo abbassa in nessuno
dei due.

### Il terzo giro, con la procedura fissa

Il terzo giro segue la procedura di
[Misure nella WebView](../development/webview-measurements.md): chiuse le
schede riaperte e 10 s di quiete, poi un file per modalità, poi tutto chiuso,
con una lettura dopo 10 s e una dopo 60 s.

| Momento | Totale | App | WebView |
|---|---|---|---|
| vuota | 981,0 | 371,5 | 589,5 |
| aperte, 7 schede | 1145,5 | 387,5 | 737,0 |
| chiuse, dopo 10 s | 1146,0 | 387,0 | 738,1 |
| chiuse, dopo 60 s | 1146,0 | 387,0 | 738,0 |
| **residuo** | **165,0** | **15,5** | **148,5** |

- Il residuo è quasi tutto della WebView (148,5 MiB su 165). Il processo
  dell'app tiene 15,5 MiB.
- In un minuto non torna niente: la lettura a 60 s è uguale a quella a 10 s.
- Il residuo è memoria che le schede chiuse tengono ancora. Vengono da qui:
  - le cache: caratteri, immagini decodificate, tessere;
  - la memoria di JavaScript che la WebView non ha ancora raccolto;
  - le pagine che l'allocatore ha liberato ma non ha reso al sistema.
- Un residuo che cresce di misura in misura è memoria che non si libera. Uno
  che oscilla è la raccolta della WebView. Nei tre giri vale 318,6, 97,3 e
  165 MiB: per ora oscilla. La tolleranza è il cancello di K3.

### Il quarto giro: dieci volte apri tutto e chiudi tutto

Il quarto giro (run 41197858474, ramo di prova `prova/k0-con-274`, merge
`583765b3`) segue la procedura con i giri: dopo la prima chiusura, dieci
volte tutti i file aperti e poi tutto chiuso, una lettura 10 s dopo ogni
chiusura e una 60 s dopo l'ultima. I valori sono PSS in MiB.

| Momento | Totale | App | WebView | Rete |
|---|---|---|---|---|
| vuota | 1041,7 | 387,3 | 634,5 | 19,9 |
| aperte, 7 schede | 1068,9 | 393,0 | 655,0 | 20,9 |
| chiuse, dopo 60 s | 1055,7 | 392,4 | 642,4 | 20,9 |
| **residuo** | **14,0** | **5,1** | **7,9** | **1,0** |

| Giri | Totale | App | WebView |
|---|---|---|---|
| residuo dopo il primo giro | 142,9 | 8,7 | 133,3 |
| residuo dopo il decimo giro | 206,2 | 15,5 | 189,6 |
| pendenza, MiB per giro | 11,88 | 0,65 | 11,22 |
| residuo 60 s dopo l'ultimo giro | 202,7 | 15,5 | 186,2 |

- **Il residuo cresce con i giri**, di circa 12 MiB a giro, e un minuto dopo
  l'ultimo giro non torna. Non sale a ogni giro: il massimo è al nono
  (263,3 MiB), il decimo scende a 206,2. Con tutto aperto la memoria va da
  1488,8 MiB al primo giro a 1754,4 al nono. Quasi tutto è della WebView (11,2 MiB a giro);
  il processo dell'app cresce di 0,65 MiB a giro.
- Il primo giro lascia molto più della prima chiusura (142,9 contro 14
  MiB): nei giri le schede si aprono una dopo l'altra senza la pausa di 3 s
  fra l'una e l'altra.
- La partenza è divisa per processo: l'app 387,3 MiB, la WebView 634,5, il
  processo di rete 19,9.
- Dopo S3 il job si è fermato: l'avvio dell'app per S7 non ha trovato il
  display («Failed to initialize GTK»), quindi in questo giro S7, T1 e I1
  mancano. La causa non è provata; il banco adesso registra l'errore nello
  scenario e prosegue, e Xvfb accetta fino a 2048 client.

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
| una tessera da `fub-asset:` con `Range` | non misurata, vedi il terzo giro | | | |
| il fotogramma da `fub-asset:` a finestre di 1 MiB | non misurato, vedi il terzo giro | | | |

- Nei primi due giri **la pagina non legge `fub-asset:` con `fetch`**, né
  con `Range` né il file intero: WebKitGTK risponde «Load failed». Il
  protocollo serve gli elementi `img` e `video`, che non chiedono CORS. La
  risposta non portava `Access-Control-Allow-Origin`, e una `fetch`
  dall'origine della pagina verso un altro schema lo richiede. Il terzo
  giro, con l'intestazione, lo conferma.
- La IPC regge la mediana (14 ms per 256 KiB) ma ha una coda di quasi due
  secondi: una tessera su venti arriva tardi di cento fotogrammi. Il
  secondo giro conferma: p50 11, p95 2138, max 3099 ms.
- Il disegno non è il collo di bottiglia: un fotogramma intero si posa in
  5 ms anche senza GPU.

### Il terzo giro: da dove viene la coda

Il terzo giro misura la IPC due volte. La prima subito dopo l'avvio, mentre
l'app indicizza il vault di 10.000 note. La seconda dopo che `vault_status`
non dice più che l'indice lavora. Fra una tessera e l'altra c'è un comando
che non tocca il vault (`plugin:app|version`), anche lui sul thread
principale.

| Misura | p50 | p95 | max |
|---|---|---|---|
| una tessera dalla IPC, durante l'indicizzazione | 13 | 1477 | 1816 |
| il comando senza vault, nello stesso giro | 1 | 12 | 104 |
| una tessera dalla IPC, a indice finito | 6 | 20 | 28 |
| il comando senza vault, a indice finito | 1 | 11 | 14 |
| una tessera da `fub-asset:` con `Range`, a indice finito | 3 | 3 | 5 |
| il fotogramma da `fub-asset:` a finestre di 1 MiB | 158 | 173 | 173 |
| il file intero da `fub-asset:`, 20,7 MB | 174 | | |

- Le tessere lente sono quattro su sessanta, una ogni 1,5–1,9 s circa, e
  ognuna aspetta 1–1,8 s. Il comando subito dopo risponde in 1–2 ms.
- La coda non è dunque del thread principale né della IPC. È
  l'indicizzazione dell'avvio. `Host::resource_read`
  (`crates/fub-host/src/session.rs`) prende `session.workspace.read()` per
  preparare la lettura, e quel lock aspetta dietro a chi scrive l'indice.
- A indice finito la IPC porta una tessera di 256 KiB con un p95 di 20 ms.
- Con l'intestazione CORS (`aed40848`) la pagina legge `fub-asset:` con
  `fetch`, e una tessera con `Range` arriva in 3 ms. Questa misura è
  avvenuta a indice finito, quindi non dice se il protocollo aspetta
  anche lui l'indice.

## Cosa non dice

Il runner disegna senza GPU sotto Xvfb e i suoi tempi stanno un ordine di
grandezza sopra una macchina vera. La memoria di WebKitGTK senza GPU non è
quella di WKWebView o di WebView2.

## Non provati

- `fub-asset:` durante l'indicizzazione dell'avvio;
- R1 e T1 su macOS, Windows e una macchina Linux con scheda grafica;
- le altre due vie per la tela (wgpu nativo, egui nella finestra): servono una
  macchina con GPU e uno schermo.
