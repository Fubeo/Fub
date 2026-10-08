# Criteri di accettazione della Graph View

> **Ambito:** scala, lifecycle e teardown della Graph View.
> **Stato:** criteri consegnati e chiusi con la consegna integrata.

I numeri e le condizioni prestazionali sono definiti nel
[budget prestazionale](performance-budget.md). Questa pagina separa i controlli
eseguibili dai budget numerici ancora soggetti a review.

## Comandi canonici

Da `apps/client/`:

```bash
npm run bench:graph-scale -- --nodes 2000 --seed 6 --cycles 3
npm run bench:graph-scale -- --nodes 10000 --seed 6 --cycles 1 --soak-windows 8
npm run bench:graph-scale -- --nodes 10000 --seed 6 --cycles 1 --soak-windows 16
npm run bench:verify
npm run bench:fidelity
npm run bench:boards
npm run bench:connectors
```

Le fixture ammesse hanno digest `eeeacc27` per 2k/seed 6 e `abcf614b` per
10k/seed 6. Un digest diverso non è una distribuzione confrontabile.

## Matrice di acceptance

| Area | Criterio osservabile | Evidenza richiesta | Stato del controllo |
|---|---|---|---|
| Fixture | cardinalità, seed e digest coincidono con il comando | report `config` e `fixture` | automatico, hard |
| Lifecycle 2k | 3 cicli mount/close completano; nel primo ciclo initial e una finestra **Riscalda** hanno 120 frame e 119 intervalli ciascuno | report di tutti i cicli | automatico, hard |
| Lifecycle 10k | initial e 8 finestre **Riscalda** completano nello stesso mount: 9 × 120 frame, di cui 960 nel soak | report con tutte le finestre | automatico, hard |
| Causalità | l'azione **Riscalda** produce il campione successivo senza rAF sintetico del banco | interazione riuscita e campione completo | automatico, hard |
| Teardown | resource delta totale e per tipo è `0`; cleanup di pagina, contesto, browser e server riesce | `resourceDelta` e `cleanup` del report | automatico, hard |
| Heap prolungato | 16 finestre complete dopo GC; prime 8 warm-up, ultime 8 con incrementi monotoni `< 7` e slope `≤ 65536 B/window` | serie completa + `soak.stability` | automatico, hard |
| Frame time 2k | p95 `≤ 25 ms`, max `≤ 50 ms`, total `≤ 10 s` | 120 frame iniziali | review-only, non CI-enforced |
| Frame time 10k | initial p95 `≤ 35 ms`, max `≤ 50 ms`, total soak `≤ 60 s` | initial e referto completo | review-only, non CI-enforced |
| Coerenza visuale | le scene correnti coincidono con le baseline Linux | `npm run bench:verify` | automatico, hard |
| Fedeltà dei disegni | ogni scena del corpus dà gli stessi pixel sul foglio, in Lettura e nel PNG, entro lo 0,2%, anche tre tavole con la carta bianca, colorata e senza, e una tavola sola vista come il suo embed, ritagliata sulla tavola; il banco vede un colore, i caratteri e un tratteggio cambiati apposta in una strada sola, le carte delle tavole tolte al PNG e il disegno intero in Lettura al posto della tavola; gli a capo dei testi in area, in italiano e in inglese, sono quelli che il browser farebbe con le larghezze che disegna, e il banco vede quelli della stima | `npm run bench:fidelity` | automatico, hard |
| Navigazione fra le tavole | al livello Standard, nell'app vera, un disegno di 20 tavole e 1237 oggetti si percorre con `Alt+PagGiù` e `Alt+PagSu`, poi con lo strumento Tavola, `Home` e un `Tab` per tavola fino a uscire dal foglio; a ogni passo la regione viva dice la tavola giusta col suo numero, la carta sta al centro o dentro la vista e il nome scelto è uno solo; nessun compito lungo, e ogni passo dipinto entro 50 ms, tre fotogrammi; il banco vede un `Tab` di troppo e un tasto lento di 80 ms; con `--boards` arriva a 1000 tavole, e oltre 20 riferisce senza soglie | `npm run bench:boards` | automatico, hard |
| Connettori che seguono | al livello Standard, nell'app vera, un disegno di 200 forme e 300 connettori, dritti, a gomito e curvi, con punte, una trentina di etichette e forme «nodo» con molti connettori, si trascina col mouse (un nodo, poi le forme con le loro etichette, poi tutto) e si sposta con le frecce (le forme, poi tutto); a ogni gesto i capi di ogni connettore stanno sul contorno delle forme che uniscono, i connettori sono ancora 300, il file salvato e riletto è quello che si vede, e Ctrl+Z rimette tutto com'era; ogni movimento del puntatore si dipinge entro 150 ms, ogni passo che scrive (rilascio, tasto, Annulla) entro un secondo, il 95° percentile degli intervalli fra i fotogrammi di un trascinamento resta entro 85 ms e fuori dai passi non c'è un compito lungo; il banco vede un file con una forma, un connettore, un aggancio o un'etichetta guasti, un movimento di 180 ms, un rilascio di 1030 ms e un compito di 80 ms; con `--connectors` va da 6 a 2000 connettori, e oltre 300 riferisce senza soglie | `npm run bench:connectors` | automatico, hard |
| CI | workflow completi verdi sullo stesso SHA della PR | run push e pull request, tutti i job richiesti | automatico, hard |

Il timeout di sicurezza del runner resta 30 s per campione. Non è un budget di
frame e non sostituisce la review dei percentili.

## Evidenza corrente

Lo SHA applicativo `4383a7c9d54b1e6557d070501e5ad998224ff294` ha tre
distribuzioni confrontabili: locale, CI push e CI pull request. I comandi storici
2k/10k hanno restituito `pass`, heap complete e resource delta `0`; il gate
prolungato a 16 finestre è stato poi superato da due esecuzioni ordinarie
consecutive sullo SHA finale della PR #61, chiudendo il residuo di #56 e #6.
Le misure complete sono nella
[tabella delle distribuzioni](performance-budget.md#evidenza-delle-tre-distribuzioni).
I workflow [CI #808](https://github.com/Fubeo/Fub/actions/runs/34958062374) e
[CI #809](https://github.com/Fubeo/Fub/actions/runs/34958069328) sono verdi sullo
stesso SHA.

Questa evidenza vale per la fixture deterministica. I limiti di qualità e
complessità della [Graph View](search-links-and-graph.md#graph-view) impediscono
di estenderla a grafi arbitrari o a ogni ambiente.
Le consegne integrate sono chiuse. Il residuo heap trasferito da
[#6](https://github.com/Fubeo/Fub/issues/6) a [#56](https://github.com/Fubeo/Fub/issues/56)
è stato soddisfatto dal gate a 16 finestre in esecuzioni consecutive sullo stesso
SHA; i budget di frame time restano review-only.
