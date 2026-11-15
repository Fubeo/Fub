# 2026-11-15, Linux, il nucleo della lavagna sul runner della CI

Questa pagina conserva la misura da cui vengono le soglie `ci` dello scenario
L1 (il nucleo della lavagna in WebAssembly) in
`apps/client/bench/webview/budgets.json`.

> **Per chi:** chi tara le soglie di L1 o si chiede perché il job WebView è
> caduto su una di loro.
> **Risultato:** sapere quanto oscillano le misure di L1 sul runner, da un job
> all'altro sullo stesso codice, e perché i p95 sono la mediana di più giri.

## Chi, cosa, quando

- 192 job «la WebView vera (WebKitGTK, S1–S3)» della CI, dal 2026-11-12 al
  2026-11-15, su 54 rami (46 job su `main`): il file `L1.json` degli
  artefatti `webview-<sha>`;
- un giro di L1 per job, come era lo scenario allora: venti aperture e
  duecento commit per lavagna, il p95 di un giro solo;
- raccolto per #388: `L1.open.50.p95` cadeva a volte a 11 ms con la soglia a
  10.

## La macchina

- runner della CI: AMD EPYC 7763, 4 nuclei virtuali, 16 GiB di memoria,
  nessuna scheda grafica;
- Linux 7.0 (Azure), X11 sotto Xvfb, WebKitGTK (Safari 605.1.15);
- `performance.now()` di WebKit ha la risoluzione di 1 ms: i valori sono
  interi.

## I numeri

Millisecondi, su 192 job.

| Misura | Mediana | p95 | Peggiore (run) | Soglia di prima | Soglia nuova |
|---|---|---|---|---|---|
| istanza | 10 | 21 | 32 (43638434545) | 100 | 48 |
| open p95, 50 schede | 5 | 11 | 15 (43735086198) | 10 | 22 |
| open p95, 2.000 schede | 18 | 26 | 34 (43630221039) | 90 | 51 |
| commit p95, 50 schede | 2 | 5 | 6 (43599944203) | 10 | 10 |
| commit p95, 2.000 schede | 6 | 8 | 10 (43646942597) | 25 | 15 |

La soglia nuova segue la regola delle soglie `ci`: una volta e mezza il
peggiore visto sul runner, e mai sotto 10 ms per la risoluzione. Quella di
`open` a 50 schede, 22,5, scende all'intero; un valore intero sotto 23 passa
come sotto 22,5.

`L1.open.50.p95` superava 10 ms in 11 job su 192 (6%). L'apertura della
lavagna piccola costa 1–2 ms (mediana di un giro: 1 ms in 118 job, 2 ms in
52); il p95 di venti aperture è la seconda più lenta, e si sposta col runner:

| Mediana del giro | Job | p95 del giro |
|---|---|---|
| 1 ms | 118 | da 1 a 10 ms |
| 2 ms | 52 | da 3 a 12 ms |
| 3 ms | 16 | da 4 a 15 ms |
| 4–5 ms | 6 | da 8 a 12 ms |

Nei job dove il runner è lento tutto il giro (mediana 3–5 ms) il p95 passa
10 ms in 7 job su 22: più giri nello stesso job tolgono il giro con due intoppi, non la
lentezza del runner. Rimescolando i giri dei job con la stessa mediana, la
mediana di cinque giri passa 10 ms in circa il 2,6% dei job (un giro solo:
il 5,9%) e non passa mai 15. Con la soglia a 10 ms il metodo da solo non
basta: la soglia va ritarata, e la mediana dei giri la tiene lontana da un
giro storto.

## Che cosa cambia nel banco

- lo scenario L1 fa cinque giri (`L1_ROUNDS` in `canvas.mjs`), ognuno col
  modulo compilato da capo, e i p95 di `open` e `commit` sono la mediana dei
  giri (`l1Values`); istanza, prima apertura e primo commit restano del
  primo giro, il solo a freddo;
- un nucleo davvero più lento sposta tutti i giri: con la mediana dei p95 a
  50 schede intorno ai 5 ms di oggi, la soglia di 22 cade con un'apertura
  quattro volte più lenta; quella a 2.000 schede (mediana 18, soglia 51) con
  una tre volte più lenta.

## Che cosa non è misurato

- la mediana di cinque giri sul runner: le soglie vengono da un giro per job,
  e la mediana non supera il peggiore dei giri; dopo una trentina di job col
  metodo nuovo si possono ritarare sui suoi numeri;
- una macchina con la scheda grafica: L1 non ha ancora obiettivi.
