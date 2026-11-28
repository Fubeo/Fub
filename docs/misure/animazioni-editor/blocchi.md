# Le animazioni dell'editor: blocchi

Inventario delle animazioni del prototipo dell'editor nell'area dei blocchi: maniglia e «+», trascinamento e atterraggio, cambio di tipo, blocchi nuovi e tolti, «/», schede vive, trasclusioni, immagini e collegamenti, con quello che fa l'app per ognuna, nel codice del 2026-11-28.

> **Per chi:** chi porta le animazioni del prototipo nell'app.
> **Risultato:** su 28 animazioni, 5 uguali, 10 diverse, 12 mancano nell'app, 1 non applicabile (dal codice; il banco lo confermerà).

## Come è misurato

- **Data:** 2026-11-28.
- **Prototipo:** `PLAN-ui/editor.html` sul ramo `piano/editor-completo`, commit `9a4cf1e94`.
- **App:** codice di `integra/editor-cornice-1` (base main `969b48510`), letto, non eseguito.
- Le righe dell'app sono relative a `apps/client/src/`; `blocks/` sta per `editors/text/profiles/markdown/blocks/`.
- Esiti e regole generali del moto ridotto (`667`, `668`, `2441`): come in [pagina, scrittura e commenti](pagina-scrittura-commenti.md#il-moto-ridotto).
- Molte regole dell'app copiano il prototipo dentro il foglio, ma `theme/scrittoio/skin/motion.css:18-23` le spegne tutte: si veda [il moto dell'app dentro il foglio](pagina-scrittura-commenti.md#il-moto-dellapp-dentro-il-foglio). Nella tabella sono «manca nell'app», con la regola copiata citata.
- Il gesto «@» e i link non hanno animazioni proprie nel prototipo: il loro menu è nella pagina «menu, finestre e sbirciata» di questa cartella.

## Animazioni

| n | elemento | causa | proprietà | da → a | durata | ritardo | curva | moto ridotto | righe | app | esito |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `.blk` (blocco scelto) | `.blk.sel` (328) | background | — → `--sel` | 0.12s | — | ease | 667, 668 | 327 | fondo del blocco scelto dentro `.cm-editor`: nessuna transizione possibile | manca nell'app |
| 2 | `.tx` (trasclusione) | `.tx.editing` (374) | box-shadow, background | — → anello d'accento e foglio | 0.15s | — | ease | 667, 668 | 366 | `transclusion.css:20` `.embed.transclusion` box-shadow e background-color 0.15s, spenta | manca nell'app |
| 3 | `.tx-h button` (bottoni della trasclusione) | `.blk:hover`, `.tx.editing` (370) | opacity | 0 → 1 | 0.12s | — | ease | 667, 668 | 369 | `transclusion.css:64` `.transclusion-head button` opacity 0.12s, spenta (anche `:200`, testata sincronizzata) | manca nell'app |
| 4 | `.card` (scheda di una nota) | `:hover` (378) | box-shadow, transform | — → ombra in rilievo | 0.15s | — | ease | 667, 668 | 377 | non trovata: cercato `transition` in `document-blocks.css`, `document.css`, `live-cards.css` | manca nell'app |
| 5 | `.gutter` (maniglia e «+») | `.gutter.on` (462) | opacity | 0 → 1 | 0.12s | — | ease | 667, 668 | 461 | `.cm-fub-block-handles`: nessuna transizione, dentro `.cm-editor` | manca nell'app |
| 6 | `.scard` (scheda viva) | `.scard.active` (729) | box-shadow | — → `0 12px 28px -18px` | 0.15s | — | ease | 667, 668 | 720 | `live-cards.css:23` `.live-card` box-shadow 0.15s, spenta | manca nell'app |
| 7 | `.scard-h button` (bottoni della scheda) | `.blk:hover`, `.scard.active` (724) | opacity | 0 → 1 | 0.12s | — | ease | 667, 668 | 723 | `live-cards.css:120` `.live-card-head button` opacity 0.12s, spenta | manca nell'app |
| 8 | `.scard::after` (bordo della scheda) | `.scard.active` (729) | box-shadow | 1px `--line-2` → 1.5px accento | 0.15s | — | ease | 667, 668 | 728 | `live-cards.css:39` `.live-card::after` box-shadow 0.15s, spenta | manca nell'app |
| 9 | `.img-h` (maniglia della larghezza dell'immagine) | `.blk:hover` (739) | opacity | 0 → 0.5 | 0.12s | — | ease | 667, 668 | 738 | maniglia delle immagini non trovata; la più vicina è `live-cards.css:524` `.live-card-resize::after` opacity 0.12s, spenta | manca nell'app |
| 10 | `.pdfn button` (pagine del PDF) | `.blk:hover`, `.scard.active` (766) | opacity | 0 → 1 | 0.12s | — | ease | 667, 668 | 765 | `live-cards.css:804` `.live-card .canvas-card-pdf-next` opacity 0.12s, spenta | manca nell'app |
| 11 | `.sl-q .ti` (tessere rapide di «/») | `.sl-q.act` (801) | background, box-shadow, color | vassoio → accento | 0.1s | — | ease | 667, 668 | 799 | `menus.css:1042` `.slash-panel .slash-tile .kit-tile-icon` background-color, box-shadow, color `--duration-state` (90ms); ridotto `menus.css:1479` | diverso: 90 ms invece di 100 |
| 12 | `.blocks.dragging > .blk` (vicini che fanno posto) | trascinamento | transform | — → posto nuovo | 0.3s | — | cubic-bezier(0.22, 1.18, 0.36, 1) | 667, 668 | 829 | `blocks/handles.ts:446-447` `PART_MS` 300, `PART_EASING` uguale, con `animate()` | uguale |
| 13 | `.lift` (spazio del blocco preso) | presa, `.lift.free` | height | altezza del blocco → altezza ridotta | 0.26s | — | cubic-bezier(0.16, 1, 0.3, 1) | 850 | 833 | per un blocco alto la copia sfuma in 200 ms ease-out e un'ombra si accorcia in scaleY da 300 ms; nessuna transizione d'altezza | diverso: sfumatura e scala invece dell'altezza |
| 14 | `.lift-c` (copia del blocco preso) | `.lift.up`, `.lift.free` | transform, opacity, box-shadow | none → scale(1.015) + ombra; libero scale(var(--fs, .86)), opacity .97 | 0.24s / 0.16s / 0.22s | — | cubic-bezier(0.3, 1.45, 0.5, 1) / ease / ease-out | 850 | 834 | `blocks/handles.ts:443-444` `LIFT_MS` 240, `LIFT_EASING` uguale; `:429-436` `FREE_SCALE` 0.86, `FREE_MS` 240, `FREE_EASING` uguale | uguale (transform; ombra e opacità non hanno durate proprie nell'app) |
| 15 | `.lift-to` (etichetta della destinazione) | compare durante il trascinamento | opacity, transform | 0, translateY(3px) scale(.94) → 1, none (`tag-in`, 843) | 0.18s | — | cubic-bezier(0.3, 1.4, 0.5, 1) | 851 | 842, 843 | `blocks/handles.ts:451-452` `TAG_IN_MS` 180, `TAG_IN_EASING` uguale, da scale 0.85 e opacity 0 | diverso: parte da scale 0.85 senza salire di 3 px |
| 16 | `.slot` (posto d'arrivo) | si sposta col puntatore | transform, background, box-shadow | — → posto nuovo | 0.3s / 0.2s | — | cubic-bezier(0.22, 1.18, 0.36, 1) / ease | 850 | 847 | `blocks/handles.ts:446-447` `PART_MS` 300, `PART_EASING` uguale | uguale |
| 17 | `.slot` alla nascita | compare | opacity | 0 → 1 (`slot-in`, 848) | 0.2s | — | ease-out | 851 | 847, 848 | `blocks/handles.ts:450` `SLOT_IN_MS` 200, ease-out | uguale |
| 18 | `.gutter .grip` (maniglia) | `:hover`, `:active` (855) | background, color | — → `--acc-soft` | 0.12s | — | ease | 667, 668 | 854 | `document.css:665` `.cm-editor .cm-fub-block-grip` opacity, background, color 0.12s, spenta | manca nell'app |
| 19 | `.gutter .grip .i` (icona della maniglia) | `.grip:hover` (857) | transform | none → scale(1.12) | 0.16s | — | cubic-bezier(0.3, 1.5, 0.5, 1) | 667, 668 | 856 | `document.css:692` `.cm-editor .cm-fub-block-grip-eyes svg` stessa curva, spenta | manca nell'app |
| 20 | blocco che cambia tipo | `setType` (2756) | opacity, transform | 0.4, scale(.985) → 1, none | 200 ms | — | cubic-bezier(.2,.8,.2,1) | `if (!reduced())` 2756 | 2756 | `blocks/motion.ts:648-657` gesto «transform»: le righe scalano dal rapporto dei caratteri con molla soft (300/30), i segni da scale 0.6 e i punti elenco da 0.4 con molla jelly | diverso: molle e scala dal carattere invece di 200 ms |
| 21 | blocco nuovo | `insertAfter` (2760) | opacity, transform | 0, translateY(6px) → 1, none | 200 ms | — | ease-out | `if (!reduced())` 2760 | 2760 | `blocks/motion.ts:622-626` gesto «born»: da y -8 e opacity 0, molla soft; ridotto: dissolvenza da 90 ms (`whenReduced: "fade"`) | diverso: scende da 8 px sopra con una molla, invece di salire da 6 px sotto |
| 22 | blocco tolto | eliminazione (2903) | opacity, transform | 1 → 0, translateY(-4px) | 120 ms | — | linear | `if (!reduced())` 2903 | 2903 | `blocks/motion.ts:46-49`, `:600` fantasmi a y -4 e opacity 0, `GONE_MS` 120, ease-out; chi sale sotto: ritardo 20 ms, 100 ms ease-out | diverso: curva ease-out invece di linear |
| 23 | blocchi che cambiano posto (FLIP) | `flip` (2916): Ctrl+Shift+frecce, tabelle, diagramma, formule | transform | translateY(dy) → none | 260 ms | — | cubic-bezier(.2,.8,.2,1) | `if (reduced()) return` 2915 | 2916 | `blocks/motion.ts:43-44` gesto «swap»: `SETTLE_MS` 340, `SETTLE_EASING` cubic-bezier(0.22, 1.12, 0.36, 1); gli altri spostamenti con molla soft; diagramma: `diagram-live.ts:243`, 200 ms cubic-bezier(0.16, 1, 0.3, 1) | diverso: 340 ms e curva d'atterraggio invece di 260 ms |
| 24 | blocco trascinato che segue il puntatore | `dragFrame` (2954), partito alla presa (2995) | transform, scrollTop | segue il puntatore | un fotogramma | — | inseguimento: x += vx·0.5, y += (ty − y)·0.72, inclinazione += (clamp(±1.1, vx·0.045) − incl.)·0.18 | resta | 2954, 2995 | `blocks/handles.ts:1754` stessi fattori 0.5, 0.72, 0.045, 0.18; `:458` `TILT_MAX` 1; `place.ts:29` calamita uguale; `place.ts:20-21` scarto laterale 1/3 fino a 28 px; `autoscroll.ts:9-13` bordo 72 px, 800 px/s, rampa 500 ms | diverso: inclinazione massima 1° invece di 1.1°, scarto laterale 1/3 invece di 0.3, scorrimento al bordo ≈ 800 px/s con rampa 500 ms invece di ≈ 780 px/s e ≈ 420 ms |
| 25 | blocco lasciato lontano | rilascio fuori vista (3009) | opacity, transform | 0, translateY(-8px) → 1, none | 220 ms | — | ease-out | `if (!reduced())` 3009 | 3009 | `blocks/handles.ts:2012` scorre al centro (`EditorView.scrollIntoView`), poi l'atterraggio della riga 27; nessuna dissolvenza trovata | diverso: niente comparsa dall'alto |
| 26 | vicini all'atterraggio | rilascio (3014) | transform | translateY(dy) → none | T = 340 ms | — | cubic-bezier(.22,1.12,.36,1) | col moto ridotto `done()` subito, 3010 | 3014 | `blocks/motion.ts:43-44` `SETTLE_MS` 340, `SETTLE_EASING` uguale | uguale |
| 27 | blocco che atterra | rilascio o Esc (3017) | transform, clipPath, boxShadow | translate + scale(1.015), ritaglio, `0 18px 40px -18px rgba(0,0,0,.42)` → none | T = 340 ms | — | cubic-bezier(.22,1.12,.36,1) | col moto ridotto `done()` subito, 3010 | 3017 | rilascio: gesto «drop», `blocks/motion.ts:40-44` `LIFT_SCALE` 1.015, 340 ms, curva uguale; Esc: `flyHome` (`blocks/handles.ts:2092`) con `PART_MS` 300 e `PART_EASING` | diverso: solo l'annullamento con Esc (300 ms, curva dei vicini) |
| 28 | passo «maniglia» della guida | guida (4740) | — | — | — | — | — | — | 4740 | — | non applicabile: guida del prototipo |

## Animazioni in JavaScript

- `2756`, `2760`, `2903`, `2916`, `3009`, `3014`, `3017`: `.animate()`. Dove manca `easing` (2903) la curva è `linear`.
- Costanti del trascinamento (2918–3020): `DH` = 104 (altezza massima del blocco preso; app `place.ts:18` `HELD_MAX` 104); soglia 4 px; fuori dalla colonna a ±90 px (app `FREE_PX` 90, `handles.ts:426`).
- Calamita: `gap·0.42·(1 − (gap/36)²)` (app `place.ts:29` `MAGNET_PX` 36, fattore 0.42).
- Scorrimento al bordo: fascia 72 px, al più 13 px a fotogramma, quadratico, rampa `edge += 0.04` a fotogramma.
- Atterraggio: `T = 340`, `ease = "cubic-bezier(.22,1.12,.36,1)"`; vale anche per Esc.
- `4740`: passo della guida, un `requestAnimationFrame` che mostra la maniglia.

## Occorrenze coperte

`327:transition`
`366:transition`
`369:transition`
`377:transition`
`461:transition`
`720:transition`
`723:transition`
`728:transition`
`738:transition`
`765:transition`
`799:transition`
`829:transition`
`833:transition`
`834:transition`
`842:animation`
`843:@keyframes`
`847:transition`
`847:animation`
`848:@keyframes`
`850:transition`
`850:data-motion`
`851:animation`
`851:data-motion`
`854:transition`
`856:transition`
`2756:.animate`
`2760:.animate`
`2903:.animate`
`2916:.animate`
`2954:requestAnimationFrame`
`2995:requestAnimationFrame`
`3009:.animate`
`3014:.animate`
`3017:.animate`
`4740:requestAnimationFrame`
