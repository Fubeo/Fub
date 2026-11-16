# Le soglie in periodi sullo schermo a 180 Hz

La prima misura degli scenari F1–F3 e delle soglie in periodi dello schermo
([Le soglie in periodi](../development/webview-measurements.md#le-soglie-in-periodi)),
sullo schermo vero di `pc-debian-di-fub`.

> **Per chi:** chi tara gli obiettivi della WebView e chi lavora sulla
> fluidità su Linux.
> **Risultato:** sapere che cosa dicono F1–F3 oggi, col tetto del motore e
> il disegno in software.

## Macchina e sistema

- commit `17b152c12` (ramo `perf/banchi-frequenza-schermo`), 16 novembre
  2026, misura di un agente;
- Intel Core i5-13600KF, 20 thread, 31 GiB, NVIDIA RTX 4070; il driver è
  disallineato (modulo 550, librerie 595) e WebKit disegna con **llvmpipe**:
  i numeri valgono come confronto sulla stessa macchina, non come numeri
  assoluti;
- schermo LG ULTRAGEAR (DP-2), 2560 × 1440 a 179,96 Hz, scala 1,2;
- Debian 13, niri su Wayland, banco con `--wayland`;
- WebKitGTK 2.54, Safari 605.1.15; `webkit://gpu`: llvmpipe, vblank «Timer,
  60Hz»;
- carico: altri agenti al lavoro, carico medio fra 4 e 28 durante le misure
  (`load` di ogni scenario nel referto). Le misure sono rumorose.

## Il periodo e il tetto

| | valore |
|---|---|
| frequenza letta | 179,96 Hz, da niri (`focused-output`), P 5,56 ms |
| F1, rAF a vuoto | mediana 16 ms (62,5 Hz), due giri su due |
| tetto del motore | sì: P < 16 ms e mediana fra 15 e 18,5 ms |
| P efficace delle soglie | 16,67 ms (60 Hz) finché il tetto c'è |

## Gli scenari

Due giri, `--budgets=targets`. Le soglie in periodi valgono con P efficace
16,67 ms.

| scenario | valore | obiettivo | giro 1 | giro 2 | esito |
|---|---|---|---|---|---|
| F1 | `F1.raf.mediana` | 1,1 P = 18,3 ms | 16 ms | 16 ms | dentro |
| F2 | `F2.raf` | 0 | 0 | 0 | dentro |
| F2 | `F2.cpu.webview` | 1 % | 4,4 % | 6,3 % | fuori |
| F3 | `F3.barra.mainBlocked` | 1 P = 16,7 ms | 178 ms | 93 ms | fuori |
| F3 | `F3.scheda.mainBlocked` | 1 P = 16,7 ms | 299 ms | 1066 ms | fuori |
| F3 | `F3.cartella.mainBlocked` | 1 P = 16,7 ms | 28 ms | 65 ms | fuori |
| S1 | `S1.keyToPaint.p95` | 2 P = 33,3 ms | 546 ms (14 campioni) | nessun campione | fuori |
| S7 | `S7.frameGap.max` | 2 P = 33,3 ms | non provato | 463 ms | fuori |

In quiete la pagina non chiede fotogrammi, ma la WebView usa il 4–6 % di un
core e l'app il 2–3 %. F3 conferma il thread principale bloccato del
rapporto delle prestazioni: il cambio scheda è il gesto peggiore, la barra
dal comando viene dopo. WebKit non ha i long task: la misura viene dal
timer (5 ms di risoluzione).

## Non provati

- S3 e S9 sullo schermo vero falliscono prima di misurare: sulla finestra
  Wayland di 1049 × 1177 punti il gesto di 400 px esce dalla pagina («move
  target out of bounds»). Il difetto c'era già prima delle soglie in
  periodi.
- S2, S4, S5, S6, S8, R1, T1, I1, L1 e C1 non sono stati provati sullo
  schermo vero in questa misura.
- Lo stesso banco con la GPU vera (dopo il riavvio) e su una macchina AMD o
  Intel col vblank DRM che funziona: da rifare.
