# Le animazioni dell'editor: menu, finestre, sbirciata e avvisi

Inventario delle animazioni del prototipo dell'editor per ciò che si apre sopra la pagina: menu a tendina, menu del tasto destro con testata, appunti e sottomenu, pannelli, spazio comandi, anteprima al passaggio, sbirciata e avvisi, con quello che fa l'app per ognuna.

> **Per chi:** chi porta le animazioni del prototipo nell'app.
> **Risultato:** su 31 animazioni, 2 uguali, 18 diverse, 7 mancano nell'app, 4 non applicabili, dopo il primo giro di correzioni del 2026-11-28 (dal codice; il banco lo confermerà).

## Come è misurato

- **Data:** 2026-11-28.
- **Prototipo:** `PLAN-ui/editor.html` sul ramo `piano/editor-completo`, commit `9a4cf1e94`.
- **App:** codice di `integra/editor-cornice-1` (base main `969b48510`), letto, non eseguito.
- Le righe del prototipo sono quelle del file; le righe dell'app sono relative a `apps/client/src/`.
- Esiti: **uguale** (stessa proprietà, durata e curva), **diverso** (l'app anima, ma con valori diversi: la riga dice quali), **manca nell'app** (nell'app quel passaggio avviene di colpo), **non applicabile** (con il motivo).
- Il prototipo non ha suggerimenti animati (usa il `title` del browser) e non ha finestre di dialogo oltre allo spazio comandi (`.k`) e a Esporta in PDF (`.px`, nella pagina [Formule ed esporta PDF](formule-esporta-pdf.md)). Il suggerimento dell'app (`ui/tooltip.ts`, `skin/controls.css:326`) non anima: non c'è niente da confrontare.

## Il moto ridotto e i valori dell'app

- **Moto ridotto.** Le regole generali (`136`, `667`, `668`, `2441`) sono spiegate nella pagina [Pagina, scrittura e commenti](pagina-scrittura-commenti.md#il-moto-ridotto). Quest'area ha in più `1237` (spazio comandi) e `1310`, che spegne `.pop.cx.in`, `.m.fresh *`, `.m[data-dir] *`, `.m-hl`, `.m-thl`, `.m-t`, `.m-op`. Nello script `openPop` mette `.in` solo `if (!reduced())` (`2568`), `closePop` non crea la copia che svanisce (`2578`), la pastiglia salta (`2620`) e la spunta degli appunti si salta (`2625`).
- **Il foglio.** Dal 2026-11-28 `theme/scrittoio/skin/motion.css` ferma soltanto la scrittura (righe, selezione, margine; [il moto dell'app dentro il foglio](pagina-scrittura-commenti.md#il-moto-dellapp-dentro-il-foglio)). I menu della scocca (`.context-menu`, avvisi, lanciatore, sbirciata) non sono toccati. Il pannello del «/» è un tooltip di CodeMirror dentro `.cm-editor`, fuori dalle righe: le sue transizioni CSS (`skin/menus.css:1042`) ora partono col moto pieno, e il suo moto d'entrata passa da `animate()` di `moto/`.
- **Valori dell'app.** `moto/spring.ts:31-41`: molle `snap` 560/38, `soft` 300/30, `wide` 170/24; durate `state` 90, `swap` 140, `short` 220 ms. Una corsa a tempo senza curva usa `cubic-bezier(.22, 1, .36, 1)` (`moto/easing.ts:16`). Col livello ridotto `animate()` fa una dissolvenza di 90 ms se la chiamata dice `whenReduced: "fade"`, altrimenti niente. Token CSS: `--duration-state` 90ms, `--duration-fast` 140ms, `--ease` `cubic-bezier(.25, .1, .25, 1)` (`theme/scrittoio/sheet-light.css:56-61`, uguale in `sheet-dark.css`).
- **Il menu dell'app.** Contestuale e a tendina sono lo stesso oggetto (`ui/menu.ts`, pelle `skin/menus.css`): aperto in un punto entra con `enterAtPoint` (`ui/menu.ts:565`), aperto da un bottone con `enterSurface` (`ui/motion.ts:63`). Costanti: `POINT_ENTER_MS` 180, `ENTER_EASING` `cubic-bezier(0.2, 0.85, 0.25, 1)`, `PART_STAGGER_MS` 15, `PART_STAGGER_MAX` 5, `GLIDE_MS` 150, `TAB_GLIDE_MS` 200, `SUB_SHIFT` 12, `PRESS_MS` 200 (`ui/menu.ts:283-303`).

## Animazioni

| n | elemento | causa | proprietà | da → a | durata | ritardo | curva | moto ridotto | righe | app | esito |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `.pop.in` (menu a tendina: `openMenu` senza `cx`, es. modo 4345, azioni 2882, proprietà 2800) | `openPop` toglie e rimette `.in` (2568) | opacity, transform | 0, translateY(-4px) scale(.98) → 1, none (`popin`, 471); origine `top left` (468) | 140ms | — | cubic-bezier(.2, .8, .2, 1) | `if (!reduced())` 2568; 667, 668 | 470, 471, 2568 | `ui/menu.ts:510` `enterSurface` → `ui/motion.ts:53` `.context-menu`: solo opacity 0 → 1, 90 ms (`DURATION.state`), curva `(.22, 1, .36, 1)`; ridotto: niente | diverso: 90 ms invece di 140, senza discesa né scala, altra curva |
| 2 | `.pop.slash.in` (menu del «/») | `openPop(…, { cls: "slash" })` (3141) | opacity, transform | come la riga 1 (`popin`) | 140ms | — | cubic-bezier(.2, .8, .2, 1) | `if (!reduced())` 2568; 667, 668 | 470, 471, 3141 | `panels/slash/panel.ts:689` `.slash-panel`: scale .96, y ±6, opacity 0 → riposo, molla `snap`; più le prime 8 voci da y 6 una dopo l'altra (`:695`, molla `soft`); ridotto: dissolvenza 90 ms | diverso: molla invece di 140 ms, scala .96 e 6 px, voci sfalsate che il prototipo non ha (1297) |
| 3 | `.pop.in` (pannelli: opzioni 2838, data 2851, commento 3242, link 3352, 3902) | `openPop` con un elemento (2568) | opacity, transform | come la riga 1 (`popin`) | 140ms | — | cubic-bezier(.2, .8, .2, 1) | `if (!reduced())` 2568; 667, 668 | 470, 471 | `kit/popover.ts:414` popover del kit: opacity 0, scale .96 (`:124`), 6 px dal lato (`:123`) → riposo, molla `soft`; ridotto: dissolvenza 90 ms | diverso: molla invece di 140 ms, scala .96 e 6 px |
| 4 | `.pop.cx.in` (menu del tasto destro) | `openCtx` (4232) apre con `cls: "cx"`; `.in` (2568) | opacity, transform | 0, scale(.94) → 1, none (`cxin`); origine `top left` (468) | 190ms | — | cubic-bezier(.2, .85, .25, 1) | 1310; `if (!reduced())` 2568 | 1277, 2568 | `ui/menu-enter.ts` `enterAtPoint`: scale .94, opacity 0, 190 ms (`POINT_ENTER_MS`), `ENTER_EASING` uguale; origine nel punto del clic (`growFrom` in `ui/menu.ts`); ridotto: niente; banco `menu.entrata-selezione` | diverso: cresce dal punto del clic invece che dall'angolo in alto a sinistra |
| 5 | `.pop.cx.out` (copia che svanisce) | `closePop` (2578): copia del menu, tolta a `animationend` o dopo 260 ms; dentro la copia niente riparte (1279) | opacity, transform | 1, none → 0, scale(.965) (`cxout`, `forwards`) | 170ms | — | cubic-bezier(.4, 0, .8, .4) | `!reduced()` 2578 (nessuna copia) | 1278, 1279, 2578 | `ui/motion.ts:77` `exitSurface` di `.context-menu` (`:53`): immagine che va a opacity 0, senza scala, 90 ms (`DURATION.state`), `ease-in`; ridotto: niente | diverso: 90 ms invece di 170, senza scala, `ease-in` invece di `(.4, 0, .8, .4)` |
| 6 | `.m.fresh > .m-head`, `> .m-find`, `.m-l > *`, `> .m-tiles` (parti del menu del tasto destro) | `renderList` mette `.fresh` alla prima stesura (2615); solo con `.cx` (1297) | opacity, transform | 0, translateY(5px) → 1, none (`cxrow`, `both`) | 240ms | `calc(var(--n, 0) * 15ms + 20ms)`: testata 20, appunti (`--n` 1) 35, riga k dell'elenco (`--n` k+1, fino a k = 14) 20 + (k+1)·15, ricerca in fondo (`--n` 9) 155; dalla riga 15 in poi `--n` 0, cioè 20 | cubic-bezier(.2, .8, .2, 1) | 1310 | 1280–1297 | `ui/menu-enter.ts` `enterAtPoint`: testata, appunti (o campo), voci e piede da y 5 e opacity 0, 240 ms, `cubic-bezier(.2, .8, .2, 1)`; ritardo 20 + posto·15: testata 0, appunti 1, voci da 2, piede (la ricerca) sempre 9 (155 ms); ridotto: niente; banco `menu.entrata-selezione` | diverso solo oltre la quattordicesima voce: l'app le fa arrivare con l'ultima (posto 15, 245 ms), il prototipo a 20 ms; il campo dei menu che lo hanno in alto prende il posto 1; il piede parte 5 px più in basso perché il menu dell'app è più corto e la scala lo tira su meno (eccezione in `eccezioni-editor-animazioni.json`) |
| 7 | `.m.fresh > .m-head .ic` (icona della testata) | come la riga 6 | opacity, transform | 0, scale(.5) rotate(-12deg) → 1, none (`cxpop`, `both`) | 340ms | 40ms | cubic-bezier(.3, 1.5, .5, 1) | 1310 | 1298 | `ui/menu-enter.ts` `enterAtPoint`: `.menu-head > svg` da scale .5, rotate -12°, opacity 0, 340 ms, 40 ms d'attesa, `cubic-bezier(.3, 1.5, .5, 1)`; ridotto: niente; banco `menu.entrata-selezione` | uguale |
| 8 | `.m[data-dir="in"] > .m-back`, `.m-l` (sottomenu che entra al posto del menu) | `pick` di una voce con `sub` (2639), freccia destra (2669); le righe non si sfalsano (1301) | opacity, transform | 0, translateX(12px) → 1, none (`cxsub`, `both`) | 200ms | — | cubic-bezier(.2, .8, .2, 1) | 1310 | 1299, 1301, 2639 | `ui/menu.ts:703` sottomenu a cascata accanto al menu: x ±12 (`SUB_SHIFT`), opacity 0, 140 ms, `ENTER_EASING`; col dito (`:567`) il menu nuovo prende il posto: x +12, 140 ms; ridotto: niente | diverso: 140 ms invece di 200, curva `(.2, .85, .25, 1)`; col puntatore il sottomenu si apre a lato, non al posto |
| 9 | `.m[data-dir="back"] > :not(.m-hl):not(.m-find)`, `.m-l` (ritorno al menu di prima) | «Indietro» (2653), freccia sinistra o Backspace (2670) | opacity, transform | 0, translateX(-12px) → 1, none (`cxsubb`, `both`) | 200ms | — | cubic-bezier(.2, .8, .2, 1) | 1310 | 1300, 2653, 2670 | col dito `ui/menu.ts:567`: x -12, opacity 0, 140 ms, `ENTER_EASING`; col puntatore il sottomenu a cascata si toglie di colpo (`:704`) | diverso: 140 ms invece di 200, e col puntatore nessun ritorno animato |
| 10 | `.m-hl` (pastiglia della voce accesa) | `glide` (2617) a ogni cambio di voce, anche allo scorrimento (2633); la prima volta salta (2620–2622); senza voce va a opacity 0 (2619) | transform, height, width, opacity, background | posa e altezza della voce di prima → della voce nuova; 1 → 0 quando sparisce; tinta `.danger` (1272) | transform e height 150ms, width 150ms, opacity 100ms, background 120ms | — | transform e height cubic-bezier(.2, .8, .2, 1); il resto ease | 1310; salto 2620 | 1271, 1272, 2617–2622 | `ui/menu.ts:1235` `slide`: `flip` 150 ms (`GLIDE_MS`), `ENTER_EASING`, `scale: false`; l'altezza si scrive di colpo; senza voce `hidden` (`:1214`); tinta `.danger` senza transizione (`skin/menus.css:128`, `221`) | diverso: curva `(.2, .85, .25, 1)`; altezza, tinta e uscita di colpo |
| 11 | `.m-i .lb`, `.m-i .ic` (nome e icona della voce) | `.act` colora l'icona (1220); `:active:not(.m-o)` sposta il nome (1274) | transform, color | none → translateX(1px); colore → `--acc-ink` | 120ms | — | ease | 667, 668 | 1220, 1274 | `skin/menus.css:113` `.menu-lit .menu-icon` colore d'accento, senza transizione; nessuno spostamento alla pressione | manca nell'app |
| 12 | `.m-i > .i.s:last-child` (freccia del sottomenu) | `.act` (1275) | transform, color | none → translateX(2px); `--faint` → `--muted` | transform 140ms, color 120ms | — | transform cubic-bezier(.2, .8, .2, 1); color ease | 667, 668 | 1223, 1275 | `skin/menus.css:116-121` `.menu-more`: stessa transizione, translateX(2px) con `.menu-lit`; il colore non cambia | diverso: la freccia non cambia colore |
| 13 | `.m-op` (scelte in riga) | `:hover`, `.m-o.act .m-op.on`, `:active` (1308) | background, box-shadow, color, transform | → velo e anello d'accento; translateY(-1px) al passaggio; scale(.94) premuto | colori 120ms, transform 140ms | — | colori ease; transform cubic-bezier(.2, .8, .2, 1) | 1310 | 1307, 1308, 1314 | `skin/menus.css:427` `.menu-choice`: stessa transizione; `:hover` translateY(-1px), `:active` scale(.94) (`:439-444`) | uguale |
| 14 | `.m-op.done` (scelta in riga premuta) | `flash` (2626): spunta, poi il menu si chiude dopo 200 ms | transform | scale(.86) → none (`cxdone`) | 200ms | — | cubic-bezier(.3, 1.6, .5, 1) | 1310; `flash` salta 2625 | 1302, 1303, 2626 | `ui/menu.ts:1477` `press`: `.menu-pressed` col segno di spunta (`skin/menus.css:382`, `445`), chiusura dopo 200 ms (`PRESS_MS`); nessun rimbalzo | manca nell'app (il rimbalzo; l'attesa di 200 ms è uguale) |
| 15 | `.m-thl` (linguetta degli appunti) | `paintTiles` (2643): scivola fra le parti; la prima volta salta la posa (2645) e appare con `.on` (2646); `.has-done` (2626) la fa d'accento | transform, opacity, background, box-shadow | `translateX(--ti·100%)` della parte di prima → della nuova; opacity 0 → 1; fondo chiaro → accento | transform 200ms; opacity, background, box-shadow 140ms | — | transform cubic-bezier(.2, .8, .2, 1); il resto ease | 1310 | 1319–1321, 2645, 2646 | `ui/menu.ts:1235` `slide` sulla linguetta: `flip` 200 ms (`TAB_GLIDE_MS`), `ENTER_EASING`; la prima posa di colpo; opacità e accento senza transizione (`skin/menus.css:328-347`) | diverso: curva `(.2, .85, .25, 1)`; appare e si fa d'accento di colpo |
| 16 | `.m-t` (parte degli appunti) | `.cur` (1324), `:active` (1324) | color, transform | → `--ink`; none → scale(.97) premuta | 140ms | — | color ease; transform cubic-bezier(.2, .8, .2, 1) | 1310 | 1322, 1324 | `.menu-quick` (`skin/menus.css:367-378`): colore con `.menu-lit` senza transizione; nessuna stretta alla pressione | manca nell'app |
| 17 | `.m-t .ti` (icona della parte) | `.cur` (1324) | color, transform | `--muted` → `--acc-ink` | color 140ms, transform 180ms | — | color ease; transform cubic-bezier(.2, .8, .2, 1) | 1310 | 1323, 1324 | `skin/menus.css:376` `.menu-quick.menu-lit svg` colore d'accento, senza transizione | manca nell'app |
| 18 | `.m-t + .m-t::before` (filo fra le parti) | `.m-tiles.on`, `.has-done` (1326) | opacity | 1 → 0 | 140ms | — | ease | 667, 668 | 1325, 1326 | `skin/menus.css:350-362`: il filo sparisce senza transizione | manca nell'app |
| 19 | `.m-t.done .ti` (spunta della parte premuta) | `flash` (2626), clic (2657), Invio (2665) | transform | scale(.86) → none (`cxdone`) | 220ms | — | cubic-bezier(.3, 1.6, .5, 1) | 1310; `flash` salta 2625 | 1328, 2626 | `ui/menu.ts:1477` `press`: la parte si fa d'accento con la spunta, senza rimbalzo | manca nell'app |
| 20 | `.m.finding .m-fq::after` (cursore finto della ricerca del menu) | si scrive nel menu del tasto destro (2672): `.finding` (2614) | opacity | 1 → 0 a metà (`cxb`, `steps(1)`, all'infinito) | 1.1s | — | steps(1) | 667, 668 | 1232, 2614 | `ui/menu.ts:789` `.menu-field-input`: un campo vero col cursore nativo, che lampeggia al ritmo del sistema; il campo sta in alto | diverso: cursore nativo invece del cursore disegnato a 1,1 s |
| 21 | `.veil` (velo dello spazio comandi) | Ctrl O (4173) mostra il velo | opacity | 0 → 1 (`fade`, 560) | 120ms | — | ease-out | 667, 668 | 559, 560, 4173 | `shells/scrittoio/launcher/launcher.ts:1131` velo: opacity 0 → 1, 220 ms (`DURATION.short`), curva `(.22, 1, .36, 1)`; ridotto: dissolvenza 90 ms | diverso: 220 ms invece di 120, altra curva |
| 22 | `.k` (scatola dello spazio comandi) | come la riga 21; `kin` (1235) vince sul `popin` 0.16s della riga 561 | opacity, transform | 0, translateY(-6px) scale(.975) → 1, none (`kin`); origine `top center` | 200ms | — | cubic-bezier(.2, .8, .2, 1) | 1237 | 561, 1235–1237 | `launcher.ts:1122` cresce dalla pillola della barra (`pillPose`) con opacità, molla `wide` (170/24); senza pillola (`:1129`) da scale .98, molla `wide`; origine `top center` (`skin/motion.css:5`); ridotto: dissolvenza 90 ms (`:1120`) | diverso: esce dalla pillola con una molla invece di scendere di 6 px in 200 ms |
| 23 | `.k-sc .ti` (tessere dei modi dello spazio comandi) | `:hover`, `aria-selected` (1244, 1245) | background, box-shadow, color | → `--tray-2`; scelta: velo, anello d'accento | 120ms | — | ease | 667, 668 | 1243–1245 | `skin/launcher.css:826` `.launcher-mode-tile`: le stesse tre, 140 ms (`--duration-fast`), `--ease` (`(.25, .1, .25, 1)`, cioè `ease`) | diverso: 140 ms invece di 120 |
| 24 | `.hovercard` (anteprima di un link con Ctrl) | `showHover` (3292): passaggio su un link con Ctrl (60 ms) o in Lettura (500 ms) (3297) | opacity, transform | come la riga 1 (`popin`) | 140ms | — | ease-out | 667, 668 | 555, 471, 3295 | `shells/scrittoio/sheets/link-card.ts` → `kit/hover-card.ts:127` → `kit/popover.ts:414`: scale .96, 6 px dal lato, molla `soft`; ridotto: dissolvenza 90 ms | diverso: molla invece di 140 ms `ease-out`, scala .96 e 6 px |
| 25 | `.peek` (sbirciata) | `openPeek` (3285, 3287): Alt col clic o Alt Invio su un link | transform, opacity | translateX(24px), 0 → none, 1 (`slidein`) | 220ms | — | cubic-bezier(.2, .8, .2, 1) | 667, 668: niente | 577, 578, 3287 | `state/note-peek.ts:223`: x 24, opacity 0, 220 ms, stessa curva; ridotto: dissolvenza 90 ms | diverso solo col moto ridotto: l'app dissolve in 90 ms, il prototipo appare e basta |
| 26 | `.toast` (avviso) | `toast()` (2514, 2517) | opacity, transform | 0, translate(-50%, 8px) → 1, translateX(-50%) (`toastin`) | 200ms | — | cubic-bezier(.2, .8, .2, 1) | 667, 668 | 631, 635, 2517 | `ui/notify.ts:432` `enterSurface` → `ui/motion.ts:42` `.toast`: y 12, opacity 0, molla `soft`; ridotto: dissolvenza 90 ms; l'avviso sta in basso a destra (`skin/centres.css:15`), non al centro | diverso: molla e 12 px invece di 200 ms e 8 px |
| 27 | `.ib` (bottone a icona; qui la chiusura della sbirciata, 3286) | `:hover` (190) | background, color | → `--hover`, `--ink` | 120ms | — | ease | 667, 668 | 189, 190 | `skin/sheets.css:1059-1067` `.note-peek-close:hover`: nessuna transizione | manca nell'app |
| 28 | `.pill` (campo della barra del titolo) | `:hover` (200) | background, box-shadow | → `--sheet`, filo più scuro | 120ms | — | ease | 667, 668 | 199 | — | non applicabile: barra del titolo, fuori dal lavoro |
| 29 | `.win` (la finestra del prototipo) | `data-width` piena, 700, telefono (180, 181) | max-width | larghezza → larghezza | 280ms | — | cubic-bezier(.2, .8, .2, 1) | 667, 668 | 162 | — | non applicabile: è il selettore di larghezza del simulatore |
| 30 | `.hint` (suggerimento nella banda) | nessuna regola ne cambia l'opacità | opacity | — | 200ms | — | ease | 667, 668 | 622 | — | non applicabile: banda di stato, fuori dal lavoro, e nel prototipo non parte mai |
| 31 | ispettore acceso o spento | `#insp-btn` (4347) | — | — | — | — | — | — | 4347 | — | non applicabile: non è un'animazione (rAF che ridisegna il margine) |

## Animazioni in JavaScript

- `2568`: `popEl.classList.remove("in"); void popEl.offsetWidth; popEl.classList.add("in")`, solo `if (!reduced())`: fa ripartire `popin` o `cxin` a ogni apertura.
- `2578`: il menu del tasto destro che si chiude lascia una copia `pop cx out` senza `.fresh` né `data-dir`; la copia si toglie a `animationend` o dopo 260 ms. Solo `!reduced()`. Gli altri menu e pannelli si nascondono di colpo (`2579`).
- `2617–2622` (`glide`): la pastiglia salta (transizione `none`, riflusso, transizione di nuovo) la prima volta e col moto ridotto; poi scivola con la transizione di `1271`. Segue anche lo scorrimento dell'elenco (`2633`).
- `2624–2627` (`flash`): spunta, `.done` (e `.has-done` sulla barra), poi `closePop` e il gesto dopo 200 ms. Col moto ridotto subito.
- `2643–2646` (`paintTiles`): la linguetta salta alla prima posa, poi `.on` la fa apparire con la transizione d'opacità.
- `2639`, `2653`, `2670`: `root.dataset.dir = "in"` o `"back"` e nuova stesura: il sottomenu prende il posto del menu.
- L'app, per le stesse cause: `ui/menu.ts:565-575` (`enterAtPoint`), `:703` (cascata), `:1235` (`slide` con `flip`), `:1477` (`press`); `ui/motion.ts:32-56` (le superfici); `moto/stagger.ts:19-33`.

## Moto che l'app aggiunge

Passaggi che nel prototipo avvengono di colpo e nell'app animano. Non sono contati nel «Risultato».

- Chiusura dei menu aperti da un bottone: immagine a opacity 0 in 90 ms `ease-in` (`ui/motion.ts:53`, `77`); nel prototipo `popEl.hidden = true` (`2579`).
- Chiusura dei popover del kit (pannelli, anteprima dei link): immagine a opacity 0, scale .98, 140 ms (`kit/popover.ts:292`).
- Chiusura del pannello del «/»: immagine a opacity 0, scale .98, 110 ms (`panels/slash/panel.ts:705`, `CLOSE_MS` `:51`); passi del «/» da x 14 con molla `snap` (`:471`, `:539`).
- Chiusura dello spazio comandi: la scatola torna nella pillola e il velo sfuma, 140 ms (`launcher.ts:1091-1092`); nel prototipo il velo si nasconde (`4213`).
- Chiusura di un avviso: immagine in 140 ms `ease-in`, e gli altri avvisi scivolano al posto (`ui/notify.ts:517-518`); nel prototipo `t.hidden = true` (`2518`, `2519`).

## Occorrenze coperte

`162:transition`
`189:transition`
`199:transition`
`470:animation`
`471:@keyframes`
`555:animation`
`559:animation`
`560:@keyframes`
`561:animation`
`577:animation`
`578:@keyframes`
`622:transition`
`631:animation`
`635:@keyframes`
`1232:animation`
`1232:@keyframes`
`1235:animation`
`1236:@keyframes`
`1237:animation`
`1237:data-motion`
`1243:transition`
`1271:transition`
`1274:transition`
`1275:transition`
`1277:animation`
`1277:@keyframes`
`1278:animation`
`1278:@keyframes`
`1279:animation`
`1279:transition`
`1280:animation`
`1281:@keyframes`
`1297:animation`
`1298:animation`
`1298:@keyframes`
`1299:animation`
`1299:@keyframes`
`1300:animation`
`1300:@keyframes`
`1301:animation`
`1302:animation`
`1303:@keyframes`
`1307:transition`
`1310:animation`
`1310:transition`
`1310:data-motion`
`1319:transition`
`1322:transition`
`1323:transition`
`1325:transition`
`1328:animation`
`2620:transition`
`2622:transition`
`2645:transition`
`4347:requestAnimationFrame`
