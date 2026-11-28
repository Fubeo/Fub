# Le animazioni dell'editor: formule ed Esporta PDF

Inventario delle animazioni del prototipo dell'editor nell'area delle formule (in riga e a blocco, il loro editor, la tavolozza dei simboli, l'anteprima KaTeX) e dello spazio Esporta PDF (sezioni, interruttori, pannello, anteprima delle pagine), con quello che fa l'app per ognuna, nel codice del 2026-11-28.

> **Per chi:** chi porta le animazioni del prototipo nell'app.
> **Risultato:** su 31 animazioni, 15 uguali, 5 diverse, 8 mancano nell'app, 3 non applicabili (dal codice; il banco lo confermerà).

## Come è misurato

- **Data:** 2026-11-28.
- **Prototipo:** `PLAN-ui/editor.html` sul ramo `piano/editor-completo`, commit `9a4cf1e94`.
- **App:** codice di `integra/editor-cornice-1` (base main `969b48510`), letto, non eseguito.
- Le righe del prototipo sono quelle del file; le righe dell'app sono relative a `apps/client/src/`; `skin/` sta per `theme/scrittoio/skin/`, `md/` per `editors/text/profiles/markdown/`.
- Esiti: **uguale** (stessa proprietà, durata e curva, e lo stesso nodo che resta o si rifà), **diverso** (l'app anima, ma con valori diversi: la riga dice quali), **manca nell'app** (nell'app quel passaggio avviene di colpo, o l'elemento non c'è), **non applicabile** (con il motivo).
- Moto ridotto: le regole generali (`667`, `668`, `2441` nel prototipo; `theme/scrittoio/structure/foundation.css:120-136` nell'app) sono descritte in [pagina, scrittura e commenti](pagina-scrittura-commenti.md#il-moto-ridotto): nel prototipo `reduced()` (`2441`) e le regole `667` e `668` spengono animazioni e transizioni dentro `.win`; nell'app `prefers-reduced-motion` e `:root[data-motion="reduced"]` portano le durate a 0 s, e `animate()` di `moto/` non anima. Qui la colonna «moto ridotto» nomina in più la regola propria dell'area.

## Dove vivono i pezzi nell'app

- **La formula nel testo e il blocco `$$`** sono dentro `.cm-editor`. Dal 2026-11-28 `skin/motion.css` ferma solo la scrittura: la formula nel testo sta dentro la riga e resta ferma; il blocco `$$` è un widget fra le righe, e le sue transizioni partono col moto pieno.
- **L'editor della formula in riga** è un popover del kit (`md/math-live.ts:328`, classe `cm-fub-mx-popover`), montato in `document.body` (`kit/popover.ts:250`): fuori dal foglio, le transizioni di `skin/math.css` partono.
- **L'editor del blocco `$$`** è un widget di CodeMirror (`md/math-live.ts:404`, `MathBlockEditWidget`, classe `cm-fub-mx-block`), con la sua tavolozza dentro (`md/math/palette.ts:143`): dentro `.cm-editor` ma fuori dalle righe, le stesse transizioni partono. Nel prototipo invece l'editor del blocco (`.mblk-ed`, `4104`) sta nella pagina normale e le sue transizioni partono.
- **Lo spazio Esporta PDF** si monta in `#app` (`export/space.ts:187`; `state/document-controller-export.ts:120` non passa un contenitore), fuori dal foglio: le sue transizioni partono.

## Quando un nodo animato viene rifatto

Una transizione CSS parte solo se lo stesso nodo cambia stato. Se il nodo viene ricreato già nello stato d'arrivo, la transizione non parte. Questo decide molte righe dello spazio Esporta PDF.

- **Il pannello del prototipo si rifà a ogni scelta.** `after(k, sel)` (`4662`) chiama sempre `pxSide(sel)`, che riscrive `side.innerHTML` (`4645`): anche per i colori. Ogni interruttore, scelta a segmenti, tema, colore o freccia di sezione su cui si fa clic viene ricreato già acceso: il pomello salta, il fondo cambia di colpo. Restano animati i passaggi del puntatore (`:hover`) e i cambi dal vivo mentre si trascina un colore (`input`, `4680-4681`), che non rifanno il pannello (commento di `4678`).
- **`px-in` invece riparte a ogni rifacimento.** `.px-sb` (`1152`) e `.px-pal` (`1178`) hanno un'animazione d'entrata: a ogni `pxSide` il corpo di ogni sezione aperta, e la tavolozza aperta, rientrano da 0 a 1 salendo di 4 px. Non solo all'apertura: a ogni clic nel pannello.
- **Le pagine si rifanno, tranne che per i colori.** `after` chiama `pxVars()` solo per `col`, `bw`, `links` (`4662`); per ogni altra scelta chiama `pxRe()` (`4614`), che dopo un fotogramma chiama `pxPaginate()`: `doc.replaceChildren()` (`4563`) e fogli nuovi. Così le transizioni di colore di `.px-pg *` e `.px-slot` (`1066`) partono solo per i colori, il bianco e nero e lo stile dei link, e mentre si trascina un colore; per un tema, un margine, un carattere i fogli nuovi compaiono già coi colori nuovi. Anche il passaggio sopra un tema (`4692`) rifà le pagine.
- **L'app fa lo stesso col pannello.** `setProfile` (`export/space.ts:808-824`) chiama `renderSide()`, che fa `side.replaceChildren` (`:392`), salvo i cambi dal vivo (`change.live`, `:820`). Aprire o chiudere una sezione (`toggleSection`, `:399-403`) rifà tutto il pannello. I colori dal vivo cambiano la pastiglia sul posto (`export/sections/colors.ts:123-133`). Le pagine dell'app ricevono i colori come variabili sul contenitore, senza ridisegnare (`export/pages.ts:164-168`).

## Animazioni

| n | elemento | causa | proprietà | da → a | durata | ritardo | curva | moto ridotto | righe | app | esito |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `.mth` (formula nel testo) | `:hover`; `.on` mentre la si modifica (`4089`, tolta in `4090`) | background | trasparente → `--hover`; → `--acc-soft` (con anello, `971`) | 120 | — | ease | 667, 668 | 970, 971 | `skin/math.css:708` `.cm-fub-math.cm-fub-math-on` senza transizione; sta dentro la riga, che resta ferma | manca nell'app |
| 2 | `.mblk` (formula a blocco) | `:hover` (`976`) | background | trasparente → vassoio al 60% | 120 | — | ease | 667, 668 | 975, 976 | nessuna transizione; sta dentro la riga, che resta ferma | manca nell'app |
| 3 | `.mx-prev` (anteprima della formula col LaTeX a vista) | `.stale` dopo un errore (`4000`, 450 ms dopo l'ultimo tasto), tolta alla prima resa buona (`3999`) | opacity | 1 → 0.45 (`983`) | 180 | — | ease | 667, 668 | 982, 983 | `skin/math.css:41` `.cm-fub-mx-surface` opacity 0.18s, stato `[data-state="stale"]` (`md/math/editor.ts:566`, `:603`); popover fuori dal foglio | uguale |
| 4 | `.mx-s` (simbolo della tavolozza) | `:hover`, `:focus-visible`; `:active` | background, transform | trasparente → `--hover`; none → scale(0.93) (`1000`) | 100 | — | ease | 667, 668 | 999, 1000 | `skin/math.css:207` `.cm-fub-mx-tile` background e transform `--duration-state` (90 ms), ease, nel popover e, viva dal 2026-11-28 (`skin/motion.css`), nel blocco `$$`; ridotto `:758-765` | diverso: 90 ms invece di 100 |
| 5 | `.mx-all .i` (freccia di «Tutti») | `aria-expanded="true"` (`4077`) | transform | none → rotate(180deg) | 150 | — | ease | 667, 668 | 1003 | `skin/math.css:260` `.cm-fub-mx-all-icon` transform `--duration-fast` (140 ms), da rotate(180deg) a none (l'icona è disegnata all'inverso), nel popover e, viva dal 2026-11-28 (`skin/motion.css`), nel blocco `$$`; ridotto `:758-765` | diverso: 140 ms invece di 150 |
| 6 | `.mx.vis .mx-prev` (la formula grande, modo visivo) | `:focus-within` (`1027`); `.stale` | box-shadow; opacity | nessun anello → anello d'accento 1.5 px; 1 → 0.45 | 120; 180 | — | ease | 667, 668 | 1025, 1027 | `skin/math.css:41-45` `.cm-fub-mx-surface` box-shadow 0.12s, opacity 0.18s, `.cm-fub-mx:focus-within`; popover fuori dal foglio | uguale |
| 7 | cursore della formula (`.mx [data-cur]`, `.blk.mx-open .mblk [data-cur]`) | sempre, mentre l'editor è aperto | border-left-color | accento → trasparente a metà ciclo (`mx-blink`, `1031`) | 1060, infinita | — | steps(1) | 1035 | 1030, 1031 | `skin/math.css:61-65` `.cm-fub-mx-caret` senza animazione; il commento: «Non lampeggia, come il cursore delle note di serie» | diverso: il cursore resta fermo, per scelta scritta nel CSS |
| 8 | riquadro della formula in riga (`.pop.mxpop`) | `mathInline` → `openPop` (`4096`, `2568`) | opacity, transform | 0, translateY(-4px) scale(0.98) → none (`popin`, `470-471`); chiusura di colpo (`2579`) | 140 | — | cubic-bezier(.2, .8, .2, 1) | `if (!reduced())` 2568 | 470, 2568 | `kit/popover.ts:414-423` `animate` con molla `soft`, da opacity 0, scale 0.96, 6 px dal lato; uscita con `exitGhost` a opacity 0, scale 0.98 (`:292`); ridotto `whenReduced: "fade"` | diverso: molla e scala 0.96 invece di 140 ms e 0.98; l'app svanisce anche in uscita. Le righe `470-471` sono dell'area menu |
| 9 | blocchi sotto la formula a blocco | apertura e chiusura dell'editor del blocco: `flip(...)` (`4104`, `4100`) | transform | translateY(spostamento) → none | 260 | — | cubic-bezier(.2,.8,.2,1) | `if (reduced()) return` 2915 | 2912-2917 | non trovata: il widget `MathBlockEditWidget` cambia altezza dentro CodeMirror senza FLIP (`md/math-live.ts:404-460`) | manca nell'app. `2916:.animate` è dell'area blocchi |
| 10 | margine dopo la formula a blocco | `onLive` (`4102`) | — | — | — | — | — | — | 4102 | — | non applicabile: non è un'animazione (rAF che ridisegna il margine) |
| 11 | `.px-seg button` (scelte a segmenti) | `:hover`; `aria-checked` (`1050-1051`) | background, color | trasparente → foglio e inchiostro | 140 | — | ease | 667, 668 | 1049 | `skin/export.css:148` `.export-segment` e `:1185` `.export-choice` background, color 0.14s; ridotto `:1785-1805`, `:1330-1337`. Al clic il pannello si rifà in tutte e due | uguale (al clic, di colpo in tutte e due) |
| 12 | `.px-go` (bottone «Esporta») | `:hover`; `:active` | filter; transform | none → brightness(1.08); none → scale(0.98) | 140; 100 | — | ease | 667, 668 | 1053 | `skin/export.css:180` `.export-go` background 0.14s, transform 0.1s; hover `background: var(--accent-soft)` (`:184-186`, motivo nel commento a `:182-183`: la pelle non ammette `filter`) | diverso: cambia il fondo invece del filtro |
| 13 | `.px-slot` (foglio dell'anteprima) | colori della carta cambiati (`pxVars`, `4490`): `background: var(--p-paper)` | background-color, color, border-color, fill, stroke | colore di prima → nuovo | 200 | — | ease | 1067 | 1059, 1066, 1067 | non trovata: `.export-slot` senza transizione (`skin/export.css:215`) | manca nell'app. Vince la `1066` sulla `1059` (stessa specificità, viene dopo): l'opacità non è più animata, e il foglio fuori dall'intervallo di stampa (`.px-slot.out`, `1060`, da `pxMarkRange` `4734`) passa a 0.32 di colpo. L'app non ha il campo dell'intervallo |
| 14 | `.px-pg *` (tutto il contenuto della pagina d'anteprima) | `pxVars` senza reimpaginare: colori, bianco e nero, link (`4662`), colore trascinato (`4680-4681`) | background-color, color, border-color, fill, stroke | colori di prima → nuovi | 200 | — | ease | 1067 | 1066, 1067, 1113 | non trovata: nessuna transizione su `.export-page` e figli in `skin/export.css` | manca nell'app. Per i diagrammi nelle pagine `1113` (`.pdg .dg-svg *`, più specifica) la toglie anche nel prototipo |
| 15 | `.px-g` (guide dei margini) | sezione «Pagina» aperta (`#px[data-guides]`, `4647`): 0 → 0.4; `:hover` e trascinamento (`.dragging`, `4719`): → 1 | opacity | 0 → 0.4 → 1 | 140 | — | ease | 667, 668 | 1137, 1140 | `skin/export.css:1693` `.export-guide` opacity 0.14s; `:1740-1746` `[data-guides]` 0.4, `:hover`, `.is-dragging` 1 (`export/guides.ts:160`, `:194`); ridotto `:1785-1805` | uguale |
| 16 | `.px-sec.flash` (sezione aperta da un rimando) | clic su un blocco della pagina → `pxOpenSec` (`4650`); scorre con `behavior: "smooth"`, `.flash` per 900 ms | background | `--acc-soft` fino al 35% → trasparente (`px-flash`) | 900 | — | ease | 1153; lo scorrimento diventa `auto` con `reduced()` (`4650`) | 1148, 4650 | `export/space.ts:825-830` `openSection`: `scrollIntoView({ block: "nearest" })` senza scorrimento morbido né lampo | manca nell'app |
| 17 | `.px-sh svg` (freccia della sezione) | sezione aperta: `.px-sec.open` (`1151`) | transform | none → rotate(180deg) | 180 | — | ease | 667, 668 | 1151 | `skin/export.css:323` `.export-section-chevron` transform 0.18s; `:325` `.is-open`. In tutte e due il pannello si rifà al clic (`4664`; `export/space.ts:399-403`): la freccia gira di colpo | uguale (di colpo in tutte e due) |
| 18 | `.px-sb` (corpo della sezione) | ogni `pxSide`: apertura, e ogni scelta nel pannello per le sezioni aperte | opacity, transform | 0, translateY(-4px) → 1, none (`px-in`, `1152`) | 200 | — | cubic-bezier(.2, .8, .2, 1) | 1153 | 1152 | non trovata: `.export-section-body` senza animazione; compare con `hidden` (`export/space.ts:367`) | manca nell'app |
| 19 | `.px-tog i` (interruttore) | `aria-checked="true"` (`1159`) | background | `--line-2` → accento | 160 | — | ease | 667, 668 | 1158, 1159 | `skin/export.css:1057` `.export-toggle-knob` e `:605` `.export-dg-toggle i` background 0.16s; al clic il pannello si rifà in tutte e due | uguale (di colpo al clic in tutte e due) |
| 20 | `.px-tog i::after` (pomello) | `aria-checked="true"` (`1159`) | transform | none → translateX(12px) | 180 | — | cubic-bezier(.2, .8, .2, 1) | 667, 668 | 1158, 1159 | `skin/export.css:1069` e `:617` transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1); ridotto `:1785-1805` | uguale (di colpo al clic in tutte e due) |
| 21 | `.px-thp` (miniatura del tema) | `.px-th:hover` (`1169`); scelta `aria-pressed` (`1170`) | transform; box-shadow | none → translateY(-2px), anello → ombra; → anello d'accento 2 px | 160; 140 | — | cubic-bezier(.2, .8, .2, 1); ease | 667, 668 | 1166, 1169, 1170 | `skin/export.css:807` `.export-theme-preview` box-shadow 0.14s, transform 0.16s cubic-bezier(0.2, 0.8, 0.2, 1) | uguale |
| 22 | `.px-col` (riga di un colore) | `.open` (`1172`) | background | trasparente → `--tray` | 140 | — | ease | 667, 668 | 1172 | `skin/export.css:871` `.export-color` e `:441` `.export-dg-color` background 0.14s; `.is-open` `:873`, `:443` | uguale (la riga si rifà al clic in tutte e due) |
| 23 | `.px-chip` (pastiglia del colore) | colore trascinato dal vivo (`4680`) | background | colore di prima → nuovo | 140 | — | ease | 667, 668 | 1176 | `skin/export.css:902` `.export-color-chip` e `:493` `.export-dg-chip` background 0.14s; pastiglia cambiata sul posto (`export/sections/colors.ts:127`) | uguale |
| 24 | `.px-pal` (tavolozza dei colori) | riga aperta, e ogni `pxSide` mentre è aperta | opacity, transform | 0, translateY(-4px) → 1, none (`px-in`, `1152`) | 180 | — | cubic-bezier(.2, .8, .2, 1) | 667, 668 (`1153` non la nomina) | 1178 | non trovata: `.export-palette` (`skin/export.css:938`) senza animazione | manca nell'app |
| 25 | `.px-ps` (campione della tavolozza) | `:hover` | transform | none → scale(1.18) | 140 | — | cubic-bezier(.2, .8, .2, 1) | 667, 668 | 1179 | `skin/export.css:955` `.export-swatch` e `:530` `.export-dg-ink` transform 0.14s cubic-bezier(0.2, 0.8, 0.2, 1) | uguale |
| 26 | `.px-fonts button` (scelta del carattere) | `:hover`; `aria-checked` | background; box-shadow | trasparente → `--hover`; anello 1 px → 1.5 px d'accento | 140 | — | ease | 667, 668 | 1183 | `skin/export.css:1588` `.export-font` box-shadow, background 0.14s | uguale |
| 27 | `.px-hfs` (posto di testata e piè) | `:hover`; `.on` | background | trasparente → `--hover`; → foglio | 140 | — | ease | 667, 668 | 1187 | `skin/export.css:1117` `.export-slot-choice` background 0.14s; ridotto `:1330-1337` | uguale |
| 28 | `.px-dsw` (stile del diagramma) | `.px-dg:hover` (`1192`); `aria-pressed` | transform; box-shadow | none → translateY(-2px); → anello d'accento 2 px | 160; 140 | — | cubic-bezier(.2, .8, .2, 1); ease | 667, 668 | 1190, 1192 | `skin/export.css:380` `.export-dg-swatch` transform 0.16s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.14s | uguale |
| 29 | spazio Esporta PDF (`#px`) | apertura: `pxShow` (`4651`) | opacity, transform | 0, translateY(8px) → 1, none | 220 | — | cubic-bezier(.2,.8,.2,1) | `if (!reduced())` 4654 | 4654 | `export/space.ts:863-864` `root.animate` con gli stessi valori, `if (!reducedMotion())`; chiusura di colpo in tutte e due (`4657`; `:853`) | uguale |
| 30 | impaginazione dell'anteprima | `pxRe` (`4614`) | — | — | — | — | — | — | 4614 | — | non applicabile: non è un'animazione (rAF che reimpagina) |
| 31 | colori dell'anteprima | `pxVars` (`4488`) | — | — | — | — | — | — | 4488 | `export/pages.ts:164` `setColors` | non applicabile: imposta variabili; il moto è delle righe 13 e 14 |

## Animazioni in JavaScript

- `4654`: `el.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" })`, solo `if (!reduced())`. App `export/space.ts:863-864`, identica.
- `4650` (`pxOpenSec`): `scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" })`, poi `.flash` e `setTimeout(..., 900)` che la toglie (riga 16).
- `4662` (`after`): `pxSide(sel)` sempre; poi `pxVars()` per `col`, `bw`, `links`, altrimenti `pxRe()`. Decide quali transizioni partono ([quando un nodo animato viene rifatto](#quando-un-nodo-animato-viene-rifatto)).
- `4614` (`pxRe`): `cancelAnimationFrame` + `requestAnimationFrame(() => pxPaginate())`, che conserva lo scorrimento. `pxPaginate` (`4561-4597`) rifà i fogli e chiude con `pxVars()`.
- `4719`, `4722`: il trascinamento d'una guida aggiunge e toglie `.dragging` su `#px`; a ogni movimento `pxRe()` rifà i fogli e le guide (nuove, già a opacità 1); al rilascio i fogli restano e le guide tornano a 0.4 con la transizione di 140 ms.
- `2912-2917` (`flip`, area blocchi): usato all'apertura (`4104`) e alla chiusura (`4100`) dell'editor del blocco `$$` (riga 9): 260 ms, `cubic-bezier(.2,.8,.2,1)`, saltato con `reduced()`.
- `3999`, `4000`: `.stale` sull'anteprima dopo 450 ms da un errore, tolta alla prima resa buona (righe 3 e 6).
- `4102`: `requestAnimationFrame(renderMargin)` (riga 10).
- App: `md/math/editor.ts:433` usa `requestAnimationFrame` solo per raggruppare il disegno della formula; non muove niente.

## Occorrenze coperte

`970:transition`
`975:transition`
`982:transition`
`999:transition`
`1003:transition`
`1025:transition`
`1030:animation`
`1031:@keyframes`
`1035:animation`
`1035:data-motion`
`1049:transition`
`1053:transition`
`1059:transition`
`1066:transition`
`1067:transition`
`1067:data-motion`
`1113:transition`
`1137:transition`
`1148:animation`
`1148:@keyframes`
`1151:transition`
`1152:animation`
`1152:@keyframes`
`1153:animation`
`1153:data-motion`
`1158:transition`
`1166:transition`
`1172:transition`
`1176:transition`
`1178:animation`
`1179:transition`
`1183:transition`
`1187:transition`
`1190:transition`
`4102:requestAnimationFrame`
`4614:requestAnimationFrame`
`4654:.animate`
