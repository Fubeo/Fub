# Le animazioni dell'editor: pagina, scrittura e commenti

Inventario delle animazioni del prototipo dell'editor nell'area della pagina: testata e copertina, barra di formato, mini-barra, caselle e interruttori, Concentrazione, commenti, con quello che fa l'app per ognuna, nel codice del 2026-11-28.

> **Per chi:** chi porta le animazioni del prototipo nell'app.
> **Risultato:** su 22 animazioni, 2 uguali, 7 diverse, 5 mancano nell'app, 8 non applicabili, dopo il primo giro di correzioni del 2026-11-28 (dal codice; il banco lo confermerà).

## Come è misurato

- **Data:** 2026-11-28.
- **Prototipo:** `PLAN-ui/editor.html` sul ramo `piano/editor-completo`, commit `9a4cf1e94`.
- **App:** codice di `integra/editor-cornice-1` (base main `969b48510`), letto, non eseguito.
- Le righe del prototipo sono quelle del file; le righe dell'app sono relative a `apps/client/src/`, e `blocks/` sta per `editors/text/profiles/markdown/blocks/`.
- Esiti: **uguale** (stessa proprietà, durata e curva), **diverso** (l'app anima, ma con valori diversi: la riga dice quali), **manca nell'app** (nell'app quel passaggio avviene di colpo, o l'elemento non c'è), **non applicabile** (con il motivo).

## Il moto dell'app dentro il foglio

Una regola dell'app pesa su tutte e cinque le pagine: `theme/scrittoio/skin/motion.css`. Fino al 2026-11-28 spegneva ogni transizione e animazione CSS dentro il foglio («Il moto è della scocca, mai del foglio»). Da allora il suo commento dice: «Il prototipo della cornice anima dentro il foglio; la scrittura resta ferma».

- **Ferme, col moto pieno:** `.cm-editor`, `.cm-scroller`, `.cm-content`, ogni `.cm-line` e ciò che contiene (segni della sintassi, widget in riga, la casella delle cose da fare, il segno del commento), la selezione (`.cm-selectionLayer`), il cursore com'era, il margine dei numeri (`.cm-gutters`) e `.pane-editor`. Sono i pezzi che cambiano a ogni tasto: un ritardo lì si sentirebbe sotto le dita.
- **Vive:** le transizioni copiate dal prototipo fuori dalle righe: maniglia dei blocchi, schede vive, trasclusioni, commenti al margine e nell'ispettore, formule e tavolozza del blocco `$$`, diagramma, Base, immagini.
- **Concentrazione:** le righe lontane si attenuano in 0.25 s `ease`, sola opacità, come il prototipo (riga 15).
- **Moto ridotto** (del sistema o `data-motion="reduced"`): dentro il foglio non si muove niente.

Dentro il foglio si muove anche ciò che passa da `animate()` di `moto/` (Web Animations). La cornice tratteggiata della tabella (`tabella.css:311`) resta com'era. La regola è provata da `theme/sheet-motion.test.ts`.

## Il moto ridotto

- **Prototipo.** `2441` definisce `reduced()`: vero se `win.dataset.motion === "ridotto"` o se il sistema chiede `prefers-reduced-motion`. In CSS, `667` spegne animazioni e transizioni di ogni elemento di `.win[data-motion="ridotto"]`; `668` fa lo stesso dentro `@media (prefers-reduced-motion: reduce)`; `136` toglie lo scorrimento morbido. Nella colonna «moto ridotto» queste tre righe valgono per ogni animazione CSS; la colonna nomina in più la regola propria dell'area, se c'è.
- **App.** Tre livelli in `moto/` (pieno, calmo, ridotto). Col moto ridotto `animate()` non anima, salvo `whenReduced: "fade"` (dissolvenza a tempo da 90 ms). In CSS `structure/foundation.css:121-137` porta le durate a 0 s con `prefers-reduced-motion` e con `:root[data-motion="reduced"]`.

## Animazioni

| n | elemento | causa | proprietà | da → a | durata | ritardo | curva | moto ridotto | righe | app | esito |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `.fbar` (barra di formato) | nessuna regola cambia la sua opacità | opacity | — | 0.15s | — | ease | 667, 668 | 253 | `menus.css` (barra di formato), nessuna transizione d'opacità | non applicabile: nel prototipo non parte mai |
| 2 | `.fg.ctx` (gruppo contestuale della barra) | `setCtx` (3398) mostra il gruppo | opacity, transform | 0, translateX(-4px) → 1, none | 0.18s | — | ease-out | 667, 668 | 262, 266 | `menus.css:851` `format-bar-context-in` 180ms ease-out, translateX(-4px); ridotto `menus.css:905` | uguale |
| 3 | `.cover-act` (bottoni della copertina) | `.cover:hover` | opacity | 0 → 1 | 0.15s | — | ease | 667, 668 | 280 | `document-page.css:77` `.cm-fub-page-cover-tools`: nessuna transizione, e sta dentro `.cm-editor` | manca nell'app |
| 4 | `.picon` (icona della pagina) | hover | background | — → `--hover` | 0.12s | — | ease | 667, 668 | 284 | `document-page.css:122` `.cm-fub-page-icon`: nessuna transizione, dentro `.cm-editor` | manca nell'app |
| 5 | `.ptools` (strumenti della testata) | `.phead:hover`, `:focus-within` | opacity | 0 → 1 | 0.15s | — | ease | 667, 668 | 286 | `document-page.css:154`, `163` `.cm-fub-page-tools`: nessuna transizione, dentro `.cm-editor` | manca nell'app |
| 6 | `.chk` (casella della lista di cose) | hover, `.blk.done` | background, box-shadow | — → anello d'accento | 0.15s | — | ease | 667, 668 | 340 | `.cm-fub-checkbox`: ferma per scelta: sta dentro la riga, e la scrittura non si muove (`skin/motion.css`) | manca nell'app: ferma per scelta |
| 7 | `.chk .i` (segno di spunta) | `.blk.done` | tutte | opacity 0, scale(.6) → 1, none | 0.18s | — | cubic-bezier(.3, 1.6, .5, 1) | 667, 668 | 342 | nessuna transizione sul segno; l'app fa crescere tutta la casella (riga 8) | diverso: anima la casella, non il segno |
| 8 | `.chk` al clic | clic sulla casella (4362) | transform | scale(.8) → scale(1.08) → none | 260 ms | — | linear | `if (!reduced())` 4362 | 4362 | `blocks/motion.ts:666` gesto «check»: casella da scale 0.7, molla jelly (260/12, `moto/spring.ts:31`); ridotto: nessuna | diverso: molla invece di tre tappe in 260 ms, parte da 0.7 |
| 9 | `.toggle-h .tw` (freccia dell'interruttore) | `.blk.open` | transform | none → rotate(90deg) | 0.18s | — | ease | 667, 668 | 353 | `blocks/motion.ts:661` gesto «fold»: freccia da rotate ±90, molla snap (560/38) | diverso: molla invece di 0.18s ease |
| 10 | `mark.cmt` (testo commentato) | `.on` (commento scelto) | background | — → accento | 0.15s | — | ease | 667, 668 | 358 | segno del commento: ferma per scelta: sta dentro la riga, e la scrittura non si muove (`skin/motion.css`) | manca nell'app: ferma per scelta |
| 11 | `.bub` (bolla del commento al margine) | hover, `.on` | transform, box-shadow | none → translateY(-1px) + `--sh-pop` | 0.15s | — | ease | 667, 668 | 455 | `document-meta.css:333` `.cm-fub-comment-sign` transform e box-shadow `--duration-fast` (140ms) `--ease`; il margine sta in `view.scrollDOM` (`comments/margin.ts:132`), viva dal 2026-11-28 (`skin/motion.css`) | diverso: 140 ms invece di 150 (la curva `--ease` è la stessa di `ease`) |
| 12 | `.icard` (scheda del commento nell'ispettore) | hover, `.on` (3248) | box-shadow | — → `--sh-pop` | 0.15s | — | ease | 667, 668 | 606 | `document-meta.css:562` `.cm-fub-comments-card` box-shadow `--duration-fast` (140ms) `--ease`; il pannello sta nella cornice (`shells/scrittoio/frame/document-panels.ts:99`) | diverso: 140 ms invece di 150 (la curva `--ease` è la stessa di `ease`) |
| 13 | `.minibar` (mini-barra della selezione) | compare sulla selezione | opacity, transform | 0, translateY(-4px) scale(.98) → 1, none (`popin`, 471) | 120ms | — | ease-out | 667, 668 | 547 | `menus.css:577` `mini-bar-in` 120ms ease-out, translateY(2px), senza scala; montata in `#workspace` (`selection-bubble.ts:73`); ridotto `menus.css:759-761`; nella striscia contestuale nessuna animazione (`menus.css:585-586`) | diverso: sale da 2 px sotto invece di scendere da 4 px sopra, senza scala |
| 14 | `.win.focus .tbar` (barra in Concentrazione) | `.win.focus`; hover la riaccende | opacity | 1 → 0.3 | 0.3s | — | ease | 667, 668 | 641 | `frame.css:887-893` `[data-focus-mode] .titlebar`: colore e opacità del marchio `--duration-slow` (360ms) `--ease`, fondo della pillola 360ms | diverso: la barra va al grigio per colore, non per opacità, in 360 ms |
| 15 | `.win.focus .blocks > .blk` (blocchi lontani in Concentrazione) | `.win.focus`; `.cur` e `:hover` a 1 | opacity | 1 → 0.3 | 0.25s | — | ease | 667, 668 | 643 | `skin/motion.css` `[data-focus-mode] .pane-editor .cm-content > *` opacity 0.25s ease, solo col moto pieno | uguale |
| 16 | proprietà nuova | `addP` (2819) | — | — | — | — | — | — | 2819 | — | non applicabile: non è un'animazione (rAF che apre l'editor della proprietà) |
| 17 | opzione della pagina | `setOpt` (4332) | — | — | — | — | — | — | 4332 | — | non applicabile: non è un'animazione (rAF che ridisegna il margine) |
| 18 | scrittura a macchina | battuta con `typewriter` (4442) | scrollTop | salto al centro | — | — | — | — | 4442 | — | non applicabile: non è un'animazione (lo scorrimento è un salto) |
| 19 | finestra ridimensionata | `resize` (4446) | — | — | — | — | — | — | 4446 | — | non applicabile: non è un'animazione (rAF che ridisegna il margine) |
| 20 | avvio | fine dello script (4799) | — | — | — | — | — | — | 4799 | — | non applicabile: non è un'animazione (due rAF che disegnano il margine) |
| 21 | passo «stato» della guida | guida (4742) | — | — | — | — | — | — | 4742 | — | non applicabile: guida del prototipo |
| 22 | passo «scadenza» della guida | guida (4743) | — | — | — | — | — | — | 4743 | — | non applicabile: guida del prototipo |

## Animazioni in JavaScript

- `4362`: `el.animate([{ transform: "scale(.8)" }, { transform: "scale(1.08)" }, { transform: "none" }], { duration: 260 })`, solo `if (!reduced())`. Senza `easing`, la curva è `linear`, il valore di Web Animations; le tre tappe danno il rimbalzo.
- `2819`, `4332`, `4442`, `4446`, `4799`: `requestAnimationFrame` che aspetta il disegno per aprire un editor, ridisegnare il margine dei commenti o centrare il cursore. Niente si muove per gradi.
- `4742`, `4743`: passi della guida del prototipo, che scorrono la pagina e aprono un editor.
- L'app, per le stesse cause: `blocks/motion.ts` gesti «check» (`:664-668`) e «fold» (`:658-663`), con le molle di `moto/spring.ts:31`.

## Occorrenze coperte

Le regole generali del moto ridotto (`136`, `667`, `668`, `2441`) stanno qui; le altre pagine le citano soltanto.

`136:prefers-reduced-motion`
`253:transition`
`262:animation`
`266:@keyframes`
`280:transition`
`284:transition`
`286:transition`
`340:transition`
`342:transition`
`353:transition`
`358:transition`
`455:transition`
`547:animation`
`606:transition`
`641:transition`
`643:transition`
`667:transition`
`667:animation`
`667:data-motion`
`668:transition`
`668:animation`
`668:prefers-reduced-motion`
`2441:data-motion`
`2441:prefers-reduced-motion`
`2819:requestAnimationFrame`
`4332:requestAnimationFrame`
`4362:.animate`
`4442:requestAnimationFrame`
`4446:requestAnimationFrame`
`4742:requestAnimationFrame`
`4743:requestAnimationFrame`
`4799:requestAnimationFrame`
