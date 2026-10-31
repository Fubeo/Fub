# Piano: <titolo>

Branch: piano/<slug>
Obiettivo: <una frase: cosa cambia per chi usa Fub>
Perché: <una o due frasi>
Fuori scope: <cosa non si fa, anche se sembra vicino>
Assunzioni: <quelle che hai visto e approvato; «nessuna» se non ce ne sono>
Ondate: T1 T2 T3 | T4 T5 | T6
Prototipo: <PLAN-ui/<schermata>.html, approvato il <data>; oppure «nessuno»>

## Modifiche

<le revisioni dopo la consegna, la più recente in cima:
data · cosa cambia · perché · task toccati. All'inizio: «nessuna».>

## Dal prototipo

<solo con grafica: dove va ogni pezzo>

| Pezzo | Destinazione | Task |
|---|---|---|
| CSS del cassetto | `apps/client/src/theme/scrittoio/skin/drawers.css` | T4 |
| classi nuove | `src/theme/scrittoio/anatomia/drawers.ts` | T4 |
| struttura | `apps/client/src/panels/<area>/` | T4 |
| testi | `apps/client/src/i18n/strings.ts` | T4 |
| stati vuoto/errore | `apps/client/bench/scene.mjs` | T5 |

## T1 · <titolo>

Perché: <il motivo, in una frase>
Tocca: <percorsi esatti; «nuovo» accanto a ciò che non esiste ancora>
Non toccare: <ciò che sembra vicino ma non va cambiato>
Dipende da: <T…, oppure «nessuno»>
Cosa fare:
- <passi concreti: tipi, funzioni, comportamento; abbastanza perché non
  servano domande>
Dal prototipo: <solo per un task grafico: quali pezzi>
Casi limite: <vuoto, enorme, nome lunghissimo, errore, interruzione…>
Fatto quando: <osservabile: un test che fallisce prima e passa dopo, una foto,
un comando>
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T2 · <titolo>

…
