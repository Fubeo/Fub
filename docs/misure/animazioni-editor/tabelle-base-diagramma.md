# Le animazioni dell'editor: tabelle, Base e diagramma

Inventario delle animazioni del prototipo dell'editor nell'area delle tabelle e dei fogli (griglia, lettere e numeri, aggiunta di righe e colonne, riquadri della selezione, taglio, celle che cambiano), della Base dentro la nota e del diagramma, con quello che fa l'app per ognuna, nel codice del 2026-11-28.

> **Per chi:** chi porta le animazioni del prototipo nell'app.
> **Risultato:** su 23 animazioni, 4 uguali, 7 diverse, 11 mancano nell'app, 1 non applicabile (dal codice; il banco lo confermerà).

## Come è misurato

- **Data:** 2026-11-28.
- **Prototipo:** `PLAN-ui/editor.html` sul ramo `piano/editor-completo`, commit `9a4cf1e94`.
- **App:** codice di `integra/editor-cornice-1` (base main `969b48510`), letto, non eseguito.
- Le righe dell'app sono relative a `apps/client/src/`; `skin/` sta per `theme/scrittoio/skin/`, `frame/` per `tabella/frame/`.
- Esiti e regole generali del moto ridotto (`667`, `668`, `2441`): come in [pagina, scrittura e commenti](pagina-scrittura-commenti.md#il-moto-ridotto).
- Tabella, Base e diagramma della nota sono widget dentro `.cm-editor`: le loro transizioni CSS sono spente da `skin/motion.css:18-23` ([il moto dell'app dentro il foglio](pagina-scrittura-commenti.md#il-moto-dellapp-dentro-il-foglio)). Una regola copiata dal prototipo lì dentro è «manca nell'app», con la regola citata. Si muove solo ciò che passa da `animate()` di `moto/`, e la cornice tratteggiata del taglio.
- I menu interni delle celle e del diagramma (tasto destro) usano il menu comune del prototipo (`.pop`, `popin`): stanno nella pagina «menu, finestre e sbirciata». Qui resta solo il campione dello stile del diagramma, che ha una transizione propria.
- Il FLIP dei blocchi (`flip`, 2912–2917: 260 ms, cubic-bezier(.2,.8,.2,1)) sta in [blocchi](blocchi.md); qui sono contati i due casi in cui lo chiamano la tabella e il diagramma (righe 12 e 22).

## Animazioni

| n | elemento | causa | proprietà | da → a | durata | ritardo | curva | moto ridotto | righe | app | esito |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `.gr-let`, `.gr-num` (lettere e numeri del foglio) | `.gridw:focus-within` (717) | opacity | 0 → 1 | 0.12s | — | ease | 667, 668 | 714 | `editors/text/profiles/markdown/table-widget.ts:524-537` `.tb-letter`, `.tb-rowhead` da opacity 0 a 1 con `:focus-within`, senza transizione; dentro `.cm-editor` sarebbe comunque spenta | manca nell'app |
| 2 | `.tg .gr-let span`, `.tg .gr-num span` (lettera o numero) | `:hover`, `.on` dalla selezione (`paint`, 3560; regole 873-874) | background, color | — → `--hover` o `--acc-wash` | 0.1s | — | ease | 667, 668 | 871 | `skin/tabella.css:154-158` `.tb-letter:hover` e `::before`, senza transizione | manca nell'app |
| 3 | `.tg-add` (aggiungi riga o colonna) | `.tg:hover`, `.tg:focus-within` (877); `:hover` (876); `:active` (896) | opacity, background, transform | 0 → 1; — → `--hover`; `:active` none → scale(.94) | 0.12s | — | ease | 667, 668 | 875, 896 | `table-widget.ts:565-574` `.tb-add` da `visibility: hidden` a `visible`, senza transizione; `skin/tabella.css:397-398` fondo su `:hover` e `:active`, nessuno scale | manca nell'app (vince la regola 896, che aggiunge transform alla 875) |
| 4 | `.tg-sel`, `.tg-act`, `.tg-cut` (riquadri della selezione, della cella attiva e del taglio) | `paint()` sposta i riquadri; al primo apparire `transition = "none"` (3561-3562) | transform, width, height | riquadro di prima → riquadro nuovo | 0.12s | — | cubic-bezier(0.2, 0.8, 0.2, 1) | 897 | 887, 3561, 3562 | `frame/frame.ts:614` `animate()` da x, y, scaleX, scaleY; `frame/motion.ts:15-16` `SELECT_MS` 120, `SELECT_EASE` uguale; al primo apparire niente (`frame.ts:608`); ferma anche oltre 600 celle (`frame.ts:644`, `motionAllowed`) | diverso: scala invece di larghezza e altezza (il bordo si stira durante il moto); oltre 600 celle l'app non scivola, il prototipo sì |
| 5 | `.tg-sel .tg-fill` (quadratino di riempimento) | `:hover` (891) | transform | none → scale(1.25) | 0.12s | — | ease | 667, 668 | 890 | `skin/tabella.css:31` `.tb-fill`: nessuno stato `:hover` con scala, nessuna transizione | manca nell'app |
| 6 | `.tg-cut` (cornice tratteggiata del taglio) | taglio (`put(oCut, cut)`, 3564) | background-position | 0 → `8px 0, -8px 100%, 0 -8px, 100% 8px` (`tg-ants`, 893) | 0.6s, infinita | — | linear | 897 | 892, 893 | `skin/tabella.css:311` `tb-ants` 0.6s linear infinite `!important`, con selettore più forte di `motion.css`; stessi `background-position` (`:313-316`); ridotto `:318-321`, `:323-325` | uguale |
| 7 | cella nuova (`[data-k]` senza posto di prima) | `anim()` dopo un cambio (3575) | opacity, transform | 0 e translateY(-12px) per una riga nuova, translateX(-14px) per una colonna nuova → 1, none | 240 ms | — | cubic-bezier(.16,1,.3,1) | `reduced()` o più di 600 celle: solo `flip(render)` (3568) | 3575 | `frame/motion.ts:172-177` da opacity 0 e y −12 o x −14, `ROWS_MS` 260, `EASE` uguale; ridotto o oltre `STILL_CELLS` 600: niente (`:121`) | diverso: 260 ms invece di 240 |
| 8 | cella che cambia posto | `anim()` (3577) | transform | translate(dx, dy) → none | 260 ms | — | cubic-bezier(.16,1,.3,1) | come riga 7 | 3577 | `frame/motion.ts:180-183` da x, y, `ROWS_MS` 260, `EASE` | uguale |
| 9 | valore cambiato (`.cc` della cella) | `anim()` (3578) | opacity, transform | 0, translateY(5px) → 1, none; `fill: "backwards"` | 220 ms | `Math.min(n++, 14) * 16`, n = valori già animati | cubic-bezier(.16,1,.3,1) | come riga 7 | 3578 | `frame/motion.ts:185-192` sul primo figlio della cella, da opacity 0 e y 5, `VALUE_MS` 220, ritardo `Math.min(cascade++, 14) * 16`; `fill: "backwards"` dal motore (`moto/driver.ts:53`) | uguale |
| 10 | cella tolta (`.tg-ghost`) | `anim()` (3580) | opacity, transform | opacity 0.9 → 0 e scale(0.96) | 170 ms | — | ease-out | come riga 7 | 3580 | `frame/motion.ts:195` `REMOVE_MS` 170 ease-out, a opacity 0 e scale 0.96, al più `GHOSTS_MAX` 48; l'immagine parte dalla posa di riposo, opacità 1 (`moto/presence.ts:97`) | diverso: parte da opacità 1 invece di 0.9 |
| 11 | lettere e numeri nuovi o spostati (`.gr-let span`, `.gr-num span`, con `data-k` 3548-3549) | `anim()` (3575, 3577: `!isTd`) | opacity; transform | nuovi: 0 → 1 senza spostamento; spostati: translate(dx, dy) → none | 240 ms; 260 ms | — | cubic-bezier(.16,1,.3,1) | come riga 7 | 3575, 3577 | `frame/motion.ts:168` anima solo le celle (`#cells`, `frame.ts:497-509`); `.tb-letter` e `.tb-rowhead` non si muovono | manca nell'app |
| 12 | blocchi sotto la tabella che cresce o cala | `anim()` chiama `flip(render)` (3568, 3571) | transform | translateY(dy) → none | 260 ms | — | cubic-bezier(.2,.8,.2,1) | `if (reduced()) return` (2915) | 3568, 3571, 2916 | non trovata: né `table-widget.ts` né `tabella/frame/` muovono le righe sotto | manca nell'app |
| 13 | `.lane` (colonna della Base a bacheca) | `.lane.over` al `dragover` (3356; regola 423) | box-shadow | — → `inset 0 0 0 2px var(--acc)` | 0.12s | — | ease | 667, 668 | 422 | `editors/base/surface.ts:1850` accetta il `dragover` ma non segna la colonna; `skin/base-views.css:260` `.base-kanban-column` senza stato né transizione | manca nell'app |
| 14 | `.cal > div` (giorno del calendario della Base) | `.cal .over` al `dragover` (3356; regola 437) | background | — → `--acc-soft` | 0.12s | — | ease | 667, 668 | 431 | `skin/base-views.css:383` `.base-cal-day` background-color `--duration-fast` (140ms), stato `[data-over="true"]` `:423`: spenta nella nota, attiva solo nella Base aperta da sola | manca nell'app (nella nota) |
| 15 | `.dg-view` (tavola del diagramma) | `.dg-view.stale` dopo un errore (3857; regola 914); fondo dello stile (`dgStyle`, 3849) | background, opacity | opacity 1 → 0.5; fondo di prima → `--dg-bg` nuovo | 0.22s / 0.18s | — | ease | 962 | 912 | `skin/diagrams.css:36` `.mermaid-diagram-view` uguale, stato `.is-stale` `:50`, ma spenta dentro `.cm-editor`; ridotto `:265-272` | manca nell'app |
| 16 | `.dg-svg *` (forme del diagramma) | cambio di stile (`dgStyle`, 3849) | fill, stroke | colori di prima → nuovi | 0.22s | — | ease | 962 | 916 | non trovata: nessuna transizione delle forme in `skin/diagrams.css` | manca nell'app |
| 17 | `.dg-swp` (campione dello stile nel menu) | `.dg-sw:hover` (947) | box-shadow, transform | `inset 0 0 0 1px var(--line)` → translateY(-1px) + `0 4px 10px -6px` | 0.12s | — | ease | 667, 668 | 943 | `skin/diagrams.css:328` `.diagram-menu-swatch` box-shadow e transform 0.12s, stato `:362-366` (anche `:focus-visible`), in un menu fuori dal foglio; ridotto `:456-463` | uguale |
| 18 | `.dg-full` (diagramma a tutto schermo) | apertura (`dgFull`, 3866) | opacity | 0 → 1 (`dg-in`, 961) | 0.2s | — | cubic-bezier(0.16, 1, 0.3, 1) | 962 | 956, 961 | `ui/mermaid.ts:1015` → `ui/lightbox.ts:92` `enterSurface` su `.modale`: opacità con molla `soft` (`ui/motion.ts:29`); col moto ridotto dissolvenza di 90 ms (`whenReduced: "fade"`) | diverso: molla invece di 0.2s; col moto ridotto l'app sfuma, il prototipo no |
| 19 | disegno del diagramma rifatto | `!first` dopo una modifica (3855) | opacity | 0.25 → 1 | 200 ms | — | ease-out | `!reduced()` 3855 | 3855 | `editors/text/profiles/markdown/diagram-live.ts:148-150` da opacity 0.25, `DIAGRAM_ENTER_MS` 200, ease-out, `whenReduced: "none"`; ma su `.mermaid-diagram-view`, tavola col fondo | diverso: sfuma la tavola intera col fondo, il prototipo solo il disegno (`.dg-svg`) |
| 20 | disegno a tutto schermo che si apre | apertura (3871) | transform, opacity | scale(fit · 0.96), 0 → scale(fit), 1 | 240 ms | — | cubic-bezier(.16,1,.3,1) | `if (!reduced())` 3871 | 3871 | non trovata: `ui/lightbox.ts` non anima il disegno, la lightbox sfuma tutta insieme | manca nell'app |
| 21 | diagramma a tutto schermo che si chiude | chiusura (`dgClose`, 3879) | opacity | 1 → 0 | 140 ms | — | linear (nessun `easing`) | `if (reduced()) return el.remove()` 3879 | 3879 | `ui/motion.ts:74-77` `exitSurface`: `DURATION.swap` 140 ms (`moto/spring.ts:41`) ease-in; col moto ridotto dissolvenza di 90 ms | diverso: ease-in invece di linear; col moto ridotto l'app sfuma, il prototipo toglie subito |
| 22 | blocchi sotto il diagramma (cambio del disegno, apertura del codice) | `flip()` in `dgRender` (3854) e `dgEdit` (3863) | transform | translateY(dy) → none | 260 ms | — | cubic-bezier(.2,.8,.2,1) | `if (reduced()) return` (2915) | 3854, 3863, 2916 | `diagram-live.ts:237-244` righe sotto da y −delta, `DIAGRAM_ENTER_MS` 200, `cubic-bezier(0.16, 1, 0.3, 1)` (`:34`), al più `SLIDE_MAX` 60 righe in vista; il codice si scrive nelle righe della nota, nessun pannello che si apre | diverso: 200 ms e curva (.16,1,.3,1) invece di 260 ms e (.2,.8,.2,1) |
| 23 | margine dopo il diagramma | `dgRender` (3858) | — | — | — | — | — | — | 3858 | — | non applicabile: non è un'animazione (`requestAnimationFrame(renderMargin)` ridisegna il margine dei commenti) |

## Animazioni in JavaScript

- `paint()` (3557–3565): sposta i tre riquadri scrivendo `transform`, `width` e `height`; la transizione CSS della 887 li fa scivolare. Al primo apparire (`el.hidden`) `3561` mette `transition = "none"`, `3562` legge `getBoundingClientRect()` e rimette `transition = ""`: il riquadro compare al suo posto. Nessun limite di celle.
- `anim()` (3567–3581): esce col moto ridotto, oltre 600 celle (`rows() * cols() > 600`) o senza tabella, e allora fa solo `flip(render)`. Altrimenti legge il rettangolo di ogni `[data-k]` (celle, lettere, numeri), ridisegna con `flip(render)` e per ognuno: nuovo → 240 ms; spostato oltre 0.5 px → 260 ms; testo cambiato → `.cc` 220 ms con ritardo `Math.min(n++, 14) * 16`. Curva comune `ease = "cubic-bezier(.16,1,.3,1)"` (3572). Celle tolte: al più 49 fantasmi (`g++ > 48`), 170 ms ease-out, poi `d.remove()`.
- `dgRender` (3850–3859): `flip()` attorno al nuovo SVG (3854), poi `.animate()` del solo `.dg-svg` da opacità 0.25 (3855), mai al primo disegno; `3858` `requestAnimationFrame(renderMargin)`.
- `dgEdit` (3861–3865): `flip()` attorno all'apertura del codice accanto al disegno (3863).
- `dgFull` (3866–3878): `.animate()` dell'SVG da `scale(fit * 0.96)` e opacità 0 in 240 ms (3871), sopra la dissolvenza CSS `dg-in` del fondo. `dgClose` (3879): `.animate()` senza `easing`, quindi `linear`, 140 ms, poi `el.remove()`.

## Occorrenze coperte

`422:transition`
`431:transition`
`714:transition`
`871:transition`
`875:transition`
`887:transition`
`890:transition`
`892:animation`
`893:@keyframes`
`896:transition`
`897:transition`
`897:animation`
`897:data-motion`
`912:transition`
`916:transition`
`943:transition`
`956:animation`
`961:@keyframes`
`962:transition`
`962:animation`
`962:data-motion`
`3561:transition`
`3562:transition`
`3575:.animate`
`3577:.animate`
`3578:.animate`
`3580:.animate`
`3855:.animate`
`3858:requestAnimationFrame`
`3871:.animate`
`3879:.animate`
