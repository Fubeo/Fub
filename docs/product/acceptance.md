# Criteri di accettazione della Graph View

> **Ambito:** scala, lifecycle e teardown della Graph View.
> **Stato:** criteri tecnici per la PR #40; release **NO-GO**.

I numeri e le condizioni prestazionali sono definiti nel
[budget prestazionale](performance-budget.md). Questa pagina separa i controlli
eseguibili dai budget numerici ancora soggetti a review.

## Comandi canonici

Da `apps/client/`:

```bash
npm run bench:graph-scale -- --nodes 2000 --seed 6 --cycles 3
npm run bench:graph-scale -- --nodes 10000 --seed 6 --cycles 1 --soak-windows 8
npm run bench:verify
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
| Heap | disponibilità `complete`; incrementi monotoni `< 7`; slope `≤ 65536 B/window` | serie di 8 finestre e regressione | review-only, non CI-enforced |
| Frame time 2k | p95 `≤ 25 ms`, max `≤ 50 ms`, total `≤ 10 s` | 120 frame iniziali | review-only, non CI-enforced |
| Frame time 10k | initial p95 `≤ 35 ms`, max `≤ 50 ms`, total soak `≤ 60 s` | initial e referto completo | review-only, non CI-enforced |
| Coerenza visuale | le scene correnti coincidono con le baseline Linux | `npm run bench:verify` | automatico, hard |
| CI | workflow completi verdi sullo stesso SHA della PR | run push e pull request, tutti i job richiesti | automatico, hard |

Il timeout di sicurezza del runner resta 30 s per campione. Non è un budget di
frame e non sostituisce la review dei percentili.

## Evidenza corrente

Lo SHA applicativo `4383a7c9d54b1e6557d070501e5ad998224ff294` ha tre
distribuzioni confrontabili: locale, CI push e CI pull request. I due comandi
hanno restituito `pass`, heap complete e resource delta
`0`; le misure complete sono nella
[tabella delle distribuzioni](performance-budget.md#evidenza-delle-tre-distribuzioni).
I workflow [CI #808](https://github.com/Fubeo/Fub/actions/runs/34958062374) e
[CI #809](https://github.com/Fubeo/Fub/actions/runs/34958069328) sono verdi sullo
stesso SHA.

Questa evidenza vale per la fixture deterministica. I limiti di qualità e
complessità della [Graph View](search-links-and-graph.md#graph-view) impediscono
di estenderla a grafi arbitrari o a ogni ambiente.

## Stato di uscita

La PR [#40](https://github.com/Fubeo/Fub/pull/40) resta **OPEN, DRAFT**. Le issue
[#6](https://github.com/Fubeo/Fub/issues/6) e
[#12](https://github.com/Fubeo/Fub/issues/12) restano **OPEN** e il progetto
resta **NO-GO**. I criteri numerici potranno diventare gate CI solo dopo altre
distribuzioni, una decisione esplicita e l'applicazione nel runner; questa pagina
non autorizza merge, chiusura delle issue o release.
