# 2026-11-17, Linux, l'istanza del nucleo della lavagna sul runner della CI

Questa pagina conserva la misura da cui viene la soglia `ci` di
`L1.istanza` (compilare e istanziare il modulo `fub-canvas-wasm` nella
WebView) in `apps/client/bench/webview/budgets.json`.

> **Per chi:** chi tara le soglie di L1 o si chiede perché il job WebView è
> caduto su `L1.istanza`.
> **Risultato:** sapere quanto oscilla l'istanza sul runner, perché la soglia
> guarda la mediana dei cinque giri e non la prima compilazione.

## Chi, cosa, quando

- 105 job «la WebView vera (WebKitGTK, S1–S3)» della CI, dal 2026-11-15
  alle 22 al 2026-11-17 alle 1, su 38 rami (37 job su `main`): il file
  `L1.json` degli artefatti `webview-<sha>` e `webview-scenari-<sha>`;
- tutti col modulo di 1.187.243 byte e con cinque giri di L1 per job
  (`L1_ROUNDS`), ognuno col modulo compilato da capo;
- raccolto per #434: `L1.istanza` era caduta con 52 ms (run 43796201823),
  55 ms (run 43968897258) e 90 ms (run 43989623414) contro la soglia di 48,
  su rami che non toccano la lavagna.

## La macchina

- runner della CI, 4 nuclei virtuali, nessuna scheda grafica, ma non sempre
  lo stesso processore: Intel Xeon 6975P-C su AWS (60 job), AMD EPYC 9V74
  (21), AMD EPYC 7763 (10), AMD EPYC 9V45 (7), Intel Xeon Platinum 8573C (5),
  Intel Xeon 6973P-C (1); un job senza referto;
- Linux 7.0, X11 sotto Xvfb, WebKitGTK (Safari 605.1.15);
- `performance.now()` di WebKit ha la risoluzione di 1 ms.

## I numeri

Millisecondi, su 105 job.

| Misura | Mediana | p90 | p95 | Peggiore (run) |
|---|---|---|---|---|
| istanza del primo giro (la `L1.istanza` di prima) | 17 | 29 | 40 | 90 (43989623414) |
| compilare, primo giro | 17 | 28 | 40 | 89 |
| istanziare, primo giro | 0 | 1 | 1 | 3 |
| istanza dei giri 2–5 (420 giri) | 13 | 18 | 20 | 42 |
| mediana dei cinque giri (la `L1.istanza` nuova) | 14 | 19 | 20 | 22 (43828483440) |
| primo giro meno la mediana dei giri 2–5 | 4,5 | 12 | 25 | 71 |

Istanziare costa 0–3 ms: tutta l'istanza è compilare. I giri dopo il primo
costano ancora 13 ms di mediana: WebKit non riusa il codice già compilato, e
ogni giro misura di nuovo la compilazione.

Per processore, la prima compilazione e la mediana dei giri:

| Processore | Job | Primo giro, mediana | Primo giro, peggiore | Mediana dei giri, mediana | Mediana dei giri, peggiore |
|---|---|---|---|---|---|
| Intel Xeon 6975P-C | 60 | 16 | 90 | 12 | 22 |
| AMD EPYC 9V74 | 21 | 21 | 52 | 15 | 21 |
| AMD EPYC 7763 | 10 | 24,5 | 55 | 18,5 | 22 |
| AMD EPYC 9V45 | 7 | 15 | 17 | 12 | 14 |
| Intel Xeon Platinum 8573C | 5 | 21 | 32 | 16 | 21 |

## Perché cadeva

- **la prima compilazione nella pagina ha la coda lunga**: in 8 job su 105
  passa 33 ms, in 3 passa 48, e nello stesso job gli altri quattro giri
  restano ai valori di sempre (90 ms con gli altri a 24, 22, 16 e 13). I tre
  rossi vengono da tre processori diversi, e il carico della macchina
  (`load` del referto: 1,6 e 2,4 nei due rossi che lo scrivono, 1,8 di mediana) non li spiega: è un
  campione solo, a freddo, sul runner condiviso;
- **il modulo è quasi raddoppiato**: la soglia di 48 veniva da 192 job dal 12
  al 15 novembre, col modulo di 465–611 KB (mediana 10 ms, peggiore 32). Con
  la lavagna in codice (dal 15 novembre) il modulo è di 1.187.243 byte e la
  mediana del primo giro è salita a 17 ms: la soglia stava a 2,8 volte la
  mediana invece che a 4,8. È il costo di un modulo più grande, non una
  regressione del compilatore o della misura;
- **il processore del runner sposta tutto di metà**: la mediana dei giri va
  da 12 ms (Xeon 6975P-C, EPYC 9V45) a 18,5 (EPYC 7763).

## Che cosa cambia nel banco

- `L1.istanza` è la mediana dell'istanza dei cinque giri (`l1Values` in
  `canvas.mjs`); la prima compilazione resta nel referto come
  `L1.istanza.prima`, senza soglia, come la prima apertura e il primo commit;
- la soglia segue la regola delle soglie `ci`: una volta e mezza il peggiore
  visto, 22 ms, cioè 33.

Rimescolando i giri (il primo dalle prime compilazioni, gli altri quattro dai
giri 2–5), la mediana passa 33 ms in nessuno di 200.000 job simulati; coi soli
giri dell'EPYC 7763, il processore più lento, nemmeno, e su un runner un
terzo più lento del 7763 in circa lo 0,6%. Un modulo che compila più lento in
ogni giro la fa cadere: due volte più lento in circa il 10% dei job, tre
volte nell'85%.

## Che cosa non è misurato

- perché la prima compilazione è più lenta delle altre di 4,5 ms di mediana
  (i thread del compilatore di JavaScriptCore che partono, la memoria per il
  codice): la misura dice quanto, non dove;
- una macchina con la scheda grafica: L1 non ha ancora obiettivi.
