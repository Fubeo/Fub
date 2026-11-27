# I Blocchi con la GPU vera

La prima misura di S7 (un blocco trascinato e dieci trasformazioni in titolo
su una nota di 2.000 righe) con WebKit che disegna con la scheda grafica e
le soglie degli obiettivi (#283). Con S7 è ripassato S11, il PDF sfogliato.

> **Per chi:** chi lavora sulla fluidità dell'editor.
> **Risultato:** S7 ha il p95 sotto due periodi dello schermo, ma il
> fotogramma più lungo è di 57–59 ms: cinque volte l'obiettivo e sopra i
> 33 ms di #283. S11 conferma
> [La pagina del PDF disegnata in un worker](2026-11-20-linux-pdf-pagina-worker.md).

Lo scenario è in
[Misure nella WebView](../development/webview-measurements.md#gli-scenari).

## Macchina e sistema

- commit `54ac8f95f` (`main`), 27 novembre 2026, misura di un agente; build
  di rilascio di quel commit, sui core P (`taskset -c 0,2,4,6,8,10`), nice 19,
  dalla coda dei controlli pesanti;
- Intel Core i5-13600KF, 20 thread, 31 GiB, NVIDIA RTX 4070; `webkit://gpu`:
  `NVIDIA GeForce RTX 4070/PCIe/SSE2`, disegno `gpu`, buffer DMABuf, vblank
  «Timer, 60Hz»;
- schermo DP-2 a 179,96 Hz (P 5,56 ms, da niri); il rAF a vuoto segue lo
  schermo (mediana 6 ms), quindi niente tetto del motore e soglie a 180 Hz;
- Debian 13, niri su Wayland, WebKitGTK 2.54; la finestra è 1049 × 1177
  invece di 1280 × 840 (la decide il gestore di finestre);
- carico a 1 minuto fra 9 e 27: altri lavori sul PC;
- comando: `npm run bench:webview -- --only=S7,S11 --budgets=targets
  --wayland --native-driver=/usr/bin/WebKitWebDriver --app=BINARIO
  --port=1451`, tre giri.

## Risultati

| valore | giro 1 | giro 2 | giro 3 | obiettivo |
|---|---|---|---|---|
| `S7.frameGap.p95` | 18 ms | 9 ms | 10 ms | — |
| `S7.frameGap.max` | 2.780 ms | 59 ms | 57 ms | 2 P = 11,1 ms |
| fotogrammi di S7 oltre 33 ms | 21 su 1.026 | — | — | 0 (#283) |
| `S11.pagina.mainBlocked` (mediana di 24 pagine) | 12 ms | 11 ms | 11 ms | 1 P = 5,6 ms |
| `S11.scroll.frameGap.p95` | 8 ms | 7 ms | 8 ms | 1 P = 5,6 ms |
| `S11.scroll.frameGap.max` | 15 ms | 13 ms | 12 ms | 2 P = 11,1 ms |

- **S7.** Il fotogramma da 2.780 ms c'è solo nel primo giro, il primo uso dei
  Blocchi dopo l'avvio dell'app; gli altri due giri non lo hanno. Il
  fotogramma da 57–59 ms invece torna a ogni giro. Il banco non dice in quale
  gesto cade (trascinamento, posa o trasformazione in titolo): serve un
  profilo della WebView.
- **S11.** La pagina sfogliata blocca il thread 11–12 ms di mediana, dentro
  gli 8–13 ms per pagina del 20 novembre: il costo che resta è la consegna
  del bitmap al compositor. S11 resta senza soglie in `budgets.json`, per la
  ragione scritta in quella misura.
