# Budget prestazionale della Graph View

> **Ambito:** evidenza osservazionale e criteri provvisori per la Graph View.
> **Snapshot applicativo:** SHA `4383a7c9d54b1e6557d070501e5ad998224ff294`.

Questa pagina documenta tre distribuzioni dello stesso codice (locale, CI push e
CI PR). Le misure descrivono quelle esecuzioni e quella fixture deterministica;
non sono claim universali sulle macchine, sui browser o sui grafi arbitrari.

## Ambiente e comandi

Il runner registra Node, Chromium, piattaforma, CPU, viewport e preferenze media
nel referto. I comandi canonici sono lo script
[`graph-scale.mjs`](../../apps/client/bench/graph-scale.mjs), richiamato dagli
script npm in [`apps/client/package.json`](../../apps/client/package.json#L12-L16):

```bash
cd apps/client
npm run bench:graph-scale -- --nodes 2000 --seed 6 --cycles 3
npm run bench:graph-scale -- --nodes 10000 --seed 6 --cycles 1 --soak-windows 8
npm run bench:verify
```

La stessa sequenza di scala è nel workflow CI
[`ci.yml`](../../.github/workflows/ci.yml#L195-L222). Il timeout di sicurezza
canonico resta **30 s per campione**. Il gate automatico primario è il referto
`pass`; le soglie numeriche di questa pagina sono criteri di review provvisori
e **non sono applicate dalla CI**.

La distribuzione locale è stata misurata su Linux x64
`6.12.107+deb13-amd64`, Node `22.23.1`, Intel N150 con 4 CPU logiche e
16 539 889 664 byte di RAM. Il browser era Chromium `149.0.7827.55`, viewport
1280 × 800, DPR 1, `prefers-reduced-motion: reduce` e schema scuro. I due job CI
usavano `ubuntu-latest`, Node `22.23.2` e Chromium `149.0.7827.55`; Actions non
espone modello CPU e RAM dei runner, quindi quei dati restano non disponibili.

## Definizioni

- **p50/p95/max:** quantili e massimo degli intervalli tra frame, in
  millisecondi, calcolati sul campione ordinato; `p95` è l'elemento alla
  posizione `floor(count × 0,95)` (limitata all'ultimo elemento).
- **Initial:** 120 frame di interazione al primo mount, dopo l'azione
  **Riscalda**. Il campionamento viene armato prima del riscaldo, nella stessa
  chiamata al browser, per non perdere frame durante la preparazione.
- **Soak:** finestre successive attivate dalla stessa sequenza; ogni finestra
  raccoglie 120 frame.
- **Total:** `timings.totalMs` del referto, dall'avvio del runner al termine
  del teardown, prima della scrittura del report.
- **Resource delta:** risorse tracciate dopo close meno la baseline prima del
  mount, per tipo e totale. Il criterio desiderato è `0`.
- **Heap complete:** ogni finestra del soak ha un valore numerico
  `JSHeapUsedSize` dopo `HeapProfiler.collectGarbage`; da questa serie derivano
  delta, conteggio degli incrementi monotoni e pendenza della regressione
  lineare in byte/finestra.

## Evidenza delle tre distribuzioni

Tutti i referti indicati hanno `pass`; il resource delta osservato è `0`.
`eeeacc27` è il digest della fixture 2k/seed 6 e `abcf614b` quello della
fixture 10k/seed 6.

| Distribuzione sullo SHA `4383a7c9` | 2k p50/p95/max (ms) | 2k total (ms) | 10k initial p50/p95/max (ms) | 10k total soak (ms) | 10k slope (B/window) | Nota referto |
|---|---:|---:|---:|---:|---:|---|
| Locale | 16 / 17 / 21 | 5861 | 25 / 26 / 29 | 43248 | 7368.238 | 10k: 8 × 120 frame |
| CI push | 16 / 17 / 23 | 5933 | 19 / 20 / 24 | 28298 | 24336.762 | `pass`, heap complete |
| CI PR | 16 / 16 / 29 | 5164 | 16 / 17 / 23 | 19190 | 47136.095 | `pass`, heap complete |

I tempi e la pendenza sono osservazioni di queste distribuzioni, non una
promessa di prestazione per ogni ambiente.

## Budget proposti e stato

Sono budget per la review, non ancora gate CI numerici:

| Scenario | p95 | max | Tempo | Campionamento esatto | Stato |
|---|---:|---:|---:|---|---|
| 2k | ≤ 25 ms | ≤ 50 ms | total ≤ 10 s | initial: 120 frame | **Review-only**, non CI-enforced |
| 10k | initial ≤ 35 ms | ≤ 50 ms | total soak ≤ 60 s | initial: 120 frame; soak: 8 × 120 = 960 frame | **Review-only**, non CI-enforced |

Il runner già fallisce su digest inatteso, campione incompleto, interazione non
causale, risorse positive dopo close, errori primari o cleanup non riuscito;
questi sono controlli hard del referto. La review richiede inoltre heap
`complete`, conteggio degli incrementi monotoni `< 7` e slope
`≤ 65536 B/window`. Questi limiti heap restano review-only finché non sono
promossi esplicitamente a gate CI.

## Regole di memoria e risorse

La baseline è acquisita prima del mount e il controllo avviene dopo ogni close.
Un delta positivo è una regressione di lifecycle per quella distribuzione; il
valore osservato qui è `0`. Il soak raccoglie l'heap dopo GC a ogni finestra e
non deve essere dichiarato completo se il browser non espone
`JSHeapUsedSize`. Heap non disponibile è un'assenza di evidenza, non un successo.

Il cleanup deve chiudere browser e server e riportare `success: true`. La
completezza del heap, il delta delle risorse e il cleanup vanno conservati nel
referto insieme alla configurazione, al digest e all'ambiente.

## Qualità e limiti di complessità

Il contratto operativo per cardinalità è:

- tier 1, `≤ 400`: repulsione esatta `O(n²)`;
- tier 2, `401..2000`: Barnes–Hut con costo atteso `O(n log n)` e collisioni;
- tier 3, `> 2000`: Barnes–Hut atteso, collisioni saltate.

Un quadtree con nodi clustered o coincidenti può avvicinarsi al caso peggiore
`O(n²)`. Il risultato a 10k è quindi soltanto quello della fixture deterministica
con seed 6, non una garanzia per un grafo arbitrario. Digest, pass, interazione,
120 frame iniziali, soak richiesto e teardown sono qualità osservabili distinte
dalla complessità asintotica.

## Stato e ricalibrazione

Le issue [#6](https://github.com/Fubeo/Fub/issues/6) (scala e durata) e
[#12](https://github.com/Fubeo/Fub/issues/12) (modularizzazione del renderer)
restano **OPEN**. La [PR #40](https://github.com/Fubeo/Fub/pull/40) resta
**OPEN, DRAFT** e la decisione corrente è **NO-GO**; questa pagina non chiude
nessuno dei tre lavori.

Ricalibrare dopo ulteriori distribuzioni o quando cambiano browser, sistema,
hardware, fixture, renderer o algoritmo. Confrontare sempre la stessa fixture e
lo stesso digest, aggiungere le nuove distribuzioni alla serie e riesaminare
p50/p95/max, total, delta, heap e slope insieme. Fino a quel riesame, mantenere
le soglie numeriche come criteri di review osservazionali e non convertirle in
claim universali o in gate CI impliciti.
