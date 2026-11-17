# 2026-11-17, Linux, il tasto di S1 e l'apertura della lavagna piccola sul runner della CI

Questa pagina conserva la misura da cui vengono i giri di S1 e la soglia `ci`
di `L1.open.50.p95` in `apps/client/bench/webview/budgets.json`.

> **Per chi:** chi tara le soglie di S1 o di L1, o si chiede perché il job
> WebView è caduto su `S1.keyToPaint.p95` o su `L1.open.50.p95`.
> **Risultato:** sapere quanto oscillano le due misure sul runner, perché S1
> fa cinque giri e perché la soglia della lavagna piccola è scesa a 11 ms.

## Chi, cosa, quando

- 856 job «la WebView vera (WebKitGTK, S1–S3)» della CI con S1, dal
  2026-10-30 al 2026-11-17, su 162 rami (144 job su `main`), e i 128 di
  quei job che hanno L1 coi cinque giri (dal 2026-11-15 alle 22 al
  2026-11-17 alle 6, su 44 rami, 46 job su `main`): i file `S1.json`,
  `L1.json` e `referto.json` degli artefatti `webview-<sha>` e
  `webview-scenari-<sha>`;
- S1 con un giro per job, come era lo scenario allora: 200 caratteri in fondo
  alla nota di 5.000 righe, il p95 della sonda;
- raccolto per #293 (`S1.keyToPaint.p95` a 403 ms e poi a 182 al rilancio
  dello stesso commit, run 44013591428, soglia 330) e per #388
  (`L1.open.50.p95` a 11 ms con la soglia di allora a 10).

## La macchina

- runner della CI, 4 nuclei virtuali, 16 GiB, nessuna scheda grafica, con
  processori diversi da un job all'altro (Intel Xeon 6975P-C, AMD EPYC 9V74,
  7763 e 9V45, Intel Xeon Platinum 8573C e 8370C);
- Linux 7.0 (Azure), X11 sotto Xvfb, WebKitGTK (Safari 605.1.15);
- `performance.now()` di WebKit ha la risoluzione di 1 ms.

## S1, il tasto a schermo

La sonda misura un tasto alla volta, dal `keydown` al secondo fotogramma
dopo, e salta i tasti che arrivano mentre il precedente è in volo. Quanti
tasti misura dipende da quanto in fretta l'app li prende.

| Periodo | Job | Campioni (min–max, mediana) | p95: mediana | p90 | Peggiore (run) | Oltre 330 |
|---|---|---|---|---|---|---|
| 14–17 novembre, prima di #452 | 290 | 60–101, 99 | 160 | 211 | 234 | 0 |
| 17 novembre, dopo #452 | 15 | 31–46, 39 | 135 | 221 | 403 (44013591428) | 1 |

Millisecondi. Con #452 (un elenco lungo della view dei collegamenti disegna
200 voci invece di tutte) un fotogramma della nota lunga costa sul runner
27–47 ms (mediana 37) invece di 34–149 (mediana 92): WebDriver consegna i 200
tasti in 3,7 s di mediana invece di 20,6, e la sonda, che misura un tasto per volta, ne prende 31–46
invece di un centinaio. Il p95 di 35 campioni è il secondo più lento: due
fotogrammi lunghi nello stesso giro bastano a raddoppiarlo. Il giro di 403 ms
ha la mediana a 87 ms, come gli altri, e il rilancio dello stesso commit
182.

Dal 30 ottobre al 12 novembre altri 34 job sono passati sopra 330: 23 col
runner più lento di allora (mediana del tasto intorno a 200 ms, p95 fra 330
e 400), 10 su `piano/scrittoio-2`, che in quei giorni scriveva più lento
(mediana del tasto fino a 480 ms) e non è arrivato così in `main`, e uno su
un ramo di prova.

Rimescolando i job dopo #452 (cinque giri presi a caso fra i quindici), la
mediana passa 330 nello 0,26 % dei job, un giro solo nel 6,7 %. Un editor che
scrive più lento in ogni giro la fa cadere: due volte e mezza più lento nel
56 % dei job (un giro solo nel 53 %), tre volte nell'88 % (un giro solo nel
73 %). Il rimescolamento mette nello stesso job giri di processori diversi,
quindi esagera la dispersione dentro un job.

## L1, l'apertura della lavagna piccola

| Misura | Job | Mediana | p90 | p95 | Peggiore (run) |
|---|---|---|---|---|---|
| p95 di un giro (640 giri) | 128 | 2 | 8 | 9 | 15 |
| mediana dei cinque giri (`L1.open.50.p95`) | 128 | 2 | 4 | 4 | 7 (44001227524, 44013591428) |
| un giro per job, dal 12 al 15 novembre | 462 | 4 | — | — | 15 (15 job oltre 10) |

Millisecondi. Con la mediana dei cinque giri la soglia di 22 ms (una volta e
mezza il peggiore di un giro solo) stava a undici volte la mediana: una
lavagna piccola che apre in 12 ms in ogni giro, sei volte più lenta, passava.
La regola delle soglie `ci` sulla mediana dei giri dà 1,5 × 7 = 10,5, cioè
11, sopra il minimo di 10 ms per la risoluzione del timer.

Rimescolando i giri, la mediana passa 11 ms in un job su centomila; coi soli
giri dell'EPYC 7763, il processore più lento (14 job, i due peggiori), nello
0,3 %; su un runner un terzo più lento del 7763 nell'11 %. Il p95 di venti
aperture da 1–2 ms sta alla risoluzione del timer: un nucleo due volte più
lento lo sposta di poco, e la soglia prende davvero un'apertura che passa i
10 ms in ogni giro.

## Sul PC

`pc-debian-di-fub`, Intel Core i5-13600KF, RTX 4070, Debian 13, WebKitGTK
2.54; il banco di prima (un giro) e quello nuovo (cinque giri) alternati
sullo stesso albero, `--only=S1`.

| Dove | Prima, un giro (ms) | Dopo, mediana di cinque (ms) | Giri del dopo (ms) | Durata del banco, prima → dopo |
|---|---|---|---|---|
| schermo vero, GPU, Wayland | 44, 43, 41, 41 | 56, 64, 50, 52 | 43–71; un primo giro a 181 con 14 campioni | 40–41 s → 49–61 s |
| Xvfb, Mesa in software | 38, 40, 35 | 38, 36, 40 | 35–47 | 39–41 s → 52–53 s |
| Xvfb, Mesa in software, due nuclei, con la macchina carica | 72, 67 | 64, 133 | 55–80; 104–1.955 col carico da 17 a 50 | 44 s → 57–116 s |

Sul PC un giro di 200 tasti dura 1–2 s. Sullo schermo vero la mediana sta
fino a 20 ms sopra il giro di prima: nei giri dopo il primo WebDriver
consegna i tasti più in fretta, la sonda ne prende 30 invece di 45, e ognuno
aspetta di più in coda. Con la macchina carica un giro solo arriva a 1.955 ms, e la mediana
resta a 133. Ogni giro in più costa sul PC circa 3,5 s (la pausa di 1,5 s,
il giro, mezzo secondo di coda); sul runner, dove un giro dura 3,7 s di
mediana, circa 6 s, cioè una ventina di secondi in più per il job S1–S3.

## Che cosa cambia nel banco

- S1 scrive i 200 caratteri cinque volte nella stessa nota (`S1_ROUNDS` in
  `typing.mjs`), ogni giro su una riga nuova, con un secondo e mezzo fra un
  giro e l'altro fuori dalla misura; `S1.keyToPaint.p95` è la mediana dei
  p95 dei giri, `null` se un giro non ha tasti misurati. La soglia resta 330;
- `L1.open.50.p95` scende da 22 a 11 ms.

## Che cosa non è misurato

- S1 coi cinque giri sul runner: la soglia di 330 viene da un giro per job e
  la mediana non supera il peggiore dei giri; dopo una trentina di job col
  metodo nuovo si può ritarare sui suoi numeri, più vicina alla mediana di
  135 ms di adesso;
- che cosa fa i due fotogrammi lunghi di un giro storto sul runner: sul PC,
  con la GPU o con Mesa in software, la scrittura non ne ha;
- le altre soglie di L1 sulla mediana dei giri: `L1.open.2000.p95` (51, il
  peggiore della mediana 23), `L1.commit.50.p95` (10, il peggiore 1) e
  `L1.commit.2000.p95` (15, il peggiore 7) restano quelle di un giro solo.
