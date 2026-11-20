# 2026-11-16, Linux, il cambio fra schede aperte

Questa pagina conserva la misura prima e dopo le
[superfici da parte](../architecture/parked-surfaces.md) e la barra di formato
che non si rifà: il cambio fra schede di testo già aperte nel riquadro, nella
WebView vera con la GPU.

> **Per chi:** chi lavora sul cambio scheda, e chi legge il gesto «scheda» di F3.
> **Risultato:** il thread principale bloccato per cambio scende da 100 a
> 29 ms (mediana) e da 161 a 39 ms (massimo), il tasto al fotogramma da 96 a
> 28 ms (mediana) e da 216 a 32 ms (p95), i fotogrammi persi da 713 a 50.
> Resta sopra l'obiettivo di un fotogramma (16,7 ms a 60 Hz).

## Chi, cosa, quando

- Misurato il 2026-11-16 da un agente Haiku con la ricetta del coder del ramo
  `perf/cambio-scheda`.
- Tre app costruite sullo stesso commit, `82f36a071` (il banco di F3 sopra
  `main`), che differiscono soltanto per il client: **A** senza correzioni,
  **B** con le sole superfici da parte, **C** con il ramo intero (superfici da
  parte, barra di formato che non si rifà, colori senza transazione).
- Il banco è F3 di [Misure nella WebView](../development/webview-measurements.md)
  con soltanto il gesto «scheda» (Ctrl+PagGiù sedici volte su tre schede: la
  nota del riscaldamento, `Lunga`, 5.000 righe, e `S2/Nota 00001.md`) e una
  sonda in più nella pagina: dal `keydown` al primo fotogramma in cui la prima
  riga della superficie attiva è cambiata.
- Tre corse valide per app, a giri alternati (A, B, C), sullo schermo vero
  (`--wayland`), con configurazione e dati in cartelle temporanee.

## La macchina

- `pc-debian-di-fub`: Intel Core i5-13600KF (20 thread), 31 GB, NVIDIA RTX 4070
  con il driver 595.
- Debian 13, kernel 6.12, sessione Wayland (niri). Schermo a 179,96 Hz; WebKit
  disegna comunque a 60 Hz.
- WebKitGTK 2.54, disegno con la GPU, vblank di WebKit a timer.
- Carico durante le corse fra 1 e 5.

## I numeri

Quarantotto cambi per app.

| Misura | A, prima | B, da parte | C, ramo intero |
|---|---:|---:|---:|
| thread principale bloccato per cambio, mediana | 100 ms | 47 ms | 29 ms |
| thread principale bloccato per cambio, p95 / massimo | 160 / 161 ms | 66 / 72 ms | 34 / 39 ms |
| dal tasto al fotogramma, mediana | 96 ms | 42 ms | 28 ms |
| dal tasto al fotogramma, p95 | 216 ms | 62 ms | 32 ms |
| fotogrammi persi | 713 su 1.897 | 106 su 2.192 | 50 su 2.183 |
| fotogrammi, mediana / p90 | 16 / 23–25 ms | 16 / 17 ms | 16 / 17–18 ms |
| fotogramma più lungo | 217–263 ms | 67–75 ms | 46–50 ms |

Prima, il cambio verso la nota lunga era il più caro. Con le superfici da
parte il costo che resta non dipende più dalla nota; con la barra di formato
corretta il cambio sta in due fotogrammi.

## Dove andavano i 46 ms rimasti

Profilo della stessa app «dopo» con una sonda che cronometra le funzioni del
cambio, gli ascoltatori, i fotogrammi e l'IPC (sedici cambi, carico fra 4 e
17: cifre indicative, la sonda stessa costa qualcosa).

- Circa 31 ms per cambio stavano nella testata del riquadro, quasi tutti
  nella barra di formato e nella bolla della selezione: la barra si rifaceva
  da capo a ogni superficie nuova, misurava la riga (`scrollWidth`) a metà
  del cambio, obbligando il motore a impaginare la finestra due volte, e per
  sapere se ognuno dei diciotto colori era acceso costruiva una transazione
  di CodeMirror.
- Le schede, la cronologia, il salvataggio e gli ascoltatori di `layout` e
  `active-doc` stavano sotto i 4 ms in tutto; nessuna chiamata IPC dentro il
  blocco.

Corretto nello stesso ramo: la barra segue la superficie nuova senza
ridisegnare i pulsanti se forma, titoli e scorciatoie sono gli stessi, misura
la riga al fotogramma, e i colori decidono senza transazione
(`colorApplies`). Con la sonda il JavaScript dentro il blocco scende da 34 a
circa 5 ms; il resto è l'impaginazione e il disegno del motore. Senza sonda
è la colonna C della tabella.

## Non provato

- Il disegno a 180 Hz: WebKitGTK disegna comunque a 60 Hz qui.
- Il cambio verso una nota senza scheda nel riquadro (S2): non cambia.
