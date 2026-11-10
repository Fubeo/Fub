# Tema theme-2

Fonte generata: `npm run theme:generate`. Verifica: `npm run theme:verify`.

Il contratto richiede **154 ruoli**, espone **1603 hook**, **7 stati** (756 assegnazioni su 224 componenti) e lascia ridichiarare alla persona **186 token**. Gli elenchi, le coppie di contrasto e il vocabolario CSS in più sono in `contract.json`, generato dalle sorgenti della shell.

Dichiara anche **63 ruoli facoltativi** (`optional_roles`): i segni di Fub sulla carta del tema (`--doc-ins`, `--doc-find`, …) e la carta chiara di un file (`--paper-*`). Un tema che non li dichiara ha i ripieghi della struttura; se li dichiara, le loro coppie (`optional_pairs`) si contano come le altre.

## Strati

Ogni hook appartiene a uno strato, e `contract.json` lo dice in `layers`:

- **cornice** (1290 hook): barre, pannelli, menu, righelli, scrivania. È del tema, sempre.
- **segno** (97 hook): ciò che Fub disegna sul contenuto, cioè selezione, cursore, fuoco, ricerca, revisioni, correttore, commenti e maniglie. È del tema, con i colori della carta su cui sta (`--doc-*`).
- **contenuto** (216 hook): ciò che il file dice. Chi ne ha l'autorità lo dichiara la modalità della superficie, con uno di tre aspetti che la shell mette sulla radice del contenuto: `look-tema`, `look-file` o `look-adattato`.

Una regola sul contenuto vale quando il tema lo veste: si scrive sotto `.look-tema`, come `.look-tema .rich-heading`.

Dove una superficie offre anche `file` o `adattato` il cancello lo fa rispettare (`content_gate`): una regola che nomina una delle 13 classi di contenuto di `hooks` fuori da `.look-tema` è rifiutata (`content-look`), con `!important` o senza, e lo stesso un selettore di tipo o `*` dentro una cornice di `scopes` (`.grid-viewport`, `.rich-page`). Vale per i fogli, le pelli e i frammenti CSS.

## Struttura minima

Una cartella installabile contiene `manifest.json`, un foglio per ogni luce dichiarata (`sheet-light.css` e/o `sheet-dark.css`), `skin.css` opzionale e asset locali. Il campione `sample/` è un bundle non-serie completo, generato dagli stessi cancelli.

## Partire dalla serie

Con `"extends": "fub.serie"` nel manifest un tema parte dal tema di serie e porta solo ciò che cambia. I fogli diventano facoltativi: una luce senza foglio usa quello di serie della stessa luce e dello stesso contrasto, anche alto. Un foglio portato dal tema resta completo: passa i ruoli e i contrasti come ogni foglio. La pelle di serie resta montata, e `skin.css` si aggiunge dopo di lei: una regola del tema vince su quella di serie a parità di specificità, e un componente che il tema non nomina resta vestito dalla serie, anche quando arriva con una versione di Fub più nuova. Una `skin.css` assente o vuota è il caso normale. Quando la serie cambia, il tema eredita il cambio. Ereditare da un altro tema non si può.

Il manifest usa `engine: theme-2`; l'id deve essere un singolo componente di path sicuro e `asset_namespace` deve essere esattamente `theme://<id>/`. Il tema non dichiara permessi; può dichiarare impostazioni sue (`settings`), che la shell mostra nelle Preferenze. Un engine sconosciuto, un id insicuro, un namespace diverso, un manifest malformato o una luce non dichiarata vengono rifiutati. Un tema `theme-1` resta installato ma la shell non lo monta: lo segnala con una diagnosi e ricade sul tema di serie.

## I caratteri del tema

Un tema `theme-2` porta i suoi caratteri dichiarandoli nel manifest, non nel CSS: `@font-face` resta vietato nei fogli e nella pelle, perché un `src:` scritto a mano potrebbe chiamare la rete. Ogni voce di `fonts` ha `family`, `file`, `weight` e `style`:

```json
"fonts": [
  { "family": "Carta Serif", "file": "fonts/carta.woff2", "weight": 400, "style": "normal" },
  { "family": "Carta Serif", "file": "fonts/carta-italic.woff2", "weight": 400, "style": "italic" }
]
```

- `family`: lettere e cifre ASCII, `-` e spazi singoli, al massimo 64 caratteri; non può essere una famiglia di serie né una parola chiave del CSS (`serif`, `monospace`, …).
- `file`: un asset del tema, `fonts/<nome>.woff2`, cioè `theme://<id>/fonts/<nome>.woff2`. Solo WOFF2: il file deve cominciare con la firma `wOF2`.
- `weight`: da 100 a 900. `style`: `normal` o `italic`. La stessa faccia non si dichiara due volte.

La shell scrive da sé le regole `@font-face`, coi valori del manifest e il file in un URL `data:`, e la pelle usa la famiglia per nome: `font-family: "Carta Serif", var(--font-ui);`. Cambiato tema, i caratteri del tema precedente se ne vanno.

## Le icone del tema

Un tema `theme-2` può ridisegnare per nome le icone della shell. Il manifest nomina un set, un file JSON accanto a sé: `"icons": "icons.json"`. Il file dà a ogni nome i suoi tracciati, cioè i `d` dei `<path>`:

```json
{
  "search": ["M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M21 21l-5-5"],
  "folder": ["M3 7a2 2 0 0 1 2-2h3l2 2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"]
}
```

- Il file: `<nome>.json` accanto al manifest, in minuscolo, mai `manifest.json`.
- Un tracciato porta solo comandi e numeri di un tracciato SVG (`M`, `L`, `C`, `A`, `Z`…, cifre, `.`, `,`, segni e spazi). Niente markup, virgolette, `url(` o riferimenti: il set è rifiutato per intero.
- Il disegno sta nella griglia 24×24; tratto, angoli e colore (`currentColor`) restano quelli della shell e il tema non li cambia.
- Al massimo 512 nomi, 8 tracciati e 4 KiB di tracciati per nome, 256 KiB per il file.

Il tema non aggiunge icone: ridisegna quelle che ci sono. Un alias ridisegnato vale per il nome a cui punta (`folder` è `vault`). Un nome che oggi nessuno disegna non rifiuta il tema (un modulo può registrarlo più tardi), ma non si vede. Cambiato tema, o annullata l'anteprima, le icone già sullo schermo tornano a quelle del tema scelto.

I 441 nomi che un tema può ridisegnare (`theme/author/icon-names.json`, tenuto uguale a `iconNames()` da `src/ui/icon-names.test.ts`):

```text
activity arrow-left arrow-right backlinks backup bell canvas-connect caret-down check chevron close
cloud collection command component copy cut dashboard draw-access draw-access-info
draw-access-warning draw-align draw-align-bottom draw-align-center draw-align-left draw-align-middle
draw-align-right draw-align-top draw-anchor-end draw-anchor-middle draw-anchor-start draw-arrow
draw-back draw-color-more draw-commands draw-cover draw-design draw-distribute-x draw-distribute-y
draw-duplicate draw-ellipse draw-eraser draw-export draw-fit draw-flip-h draw-flip-v draw-group
draw-hand draw-here draw-hidden draw-hide-ui draw-highlighter draw-history draw-image
draw-into-layer draw-keys draw-landscape draw-layers draw-line draw-link draw-lock draw-mark
draw-menu draw-more draw-navigator draw-none draw-note draw-open-link draw-order draw-order-back
draw-order-backward draw-order-forward draw-order-front draw-page-grid draw-pen draw-portrait
draw-ratio draw-rect draw-redo draw-rotate draw-section draw-select draw-selection draw-simple
draw-snap draw-suggestion draw-swap draw-symbols draw-text-bold draw-text-italic draw-text-strike
draw-text-underline draw-tip-bar-end draw-tip-bar-start draw-tip-circle-end draw-tip-circle-start
draw-tip-diamond-end draw-tip-diamond-start draw-tip-none draw-tip-other-end draw-tip-other-start
draw-tip-square-end draw-tip-square-start draw-tip-triangle-end draw-tip-triangle-start
draw-tip-vee-end draw-tip-vee-start draw-tips-swap draw-to-shape draw-undo draw-ungroup draw-unlink
draw-unmark draw-zoom draw-zoom-in draw-zoom-out fmt-bold fmt-bullets fmt-callout fmt-chevron-down
fmt-clear fmt-code fmt-codeblock fmt-color fmt-columns fmt-comment fmt-cover fmt-date fmt-details
fmt-diagram fmt-embed fmt-footnote fmt-h1 fmt-h2 fmt-h3 fmt-h4 fmt-h5 fmt-h6 fmt-hide fmt-highlight
fmt-icon fmt-image fmt-indent fmt-italic fmt-link fmt-math fmt-mathblock fmt-more fmt-numbers
fmt-outdent fmt-person fmt-property fmt-quick fmt-quote fmt-redo fmt-rule fmt-star fmt-strike
fmt-subscript fmt-superscript fmt-table fmt-tasks fmt-text fmt-toc fmt-underline fmt-undo
fmt-webpage fmt-wikilink focus footnote format-drawing format-odt format-photo format-sheet
format-word gr-accounting gr-align-bottom gr-align-center gr-align-left gr-align-middle
gr-align-right gr-align-top gr-arrow-down gr-arrow-left gr-arrow-right gr-arrow-up gr-border-all
gr-border-bottom gr-border-double gr-border-inside gr-border-left gr-border-none gr-border-outside
gr-border-right gr-border-thick gr-border-thick-bottom gr-border-top gr-border-top-bottom gr-breaks
gr-bring-forward gr-bring-front gr-calc gr-calc-now gr-cell-style gr-cells gr-cf gr-cf-bars
gr-cf-icons gr-cf-scale gr-cf-top gr-chart-column gr-chart-element gr-chart-layout gr-chart-line
gr-chart-other gr-chart-pie gr-chart-recommended gr-chart-scatter gr-chart-switch gr-checkbox
gr-chevron-down gr-chevron-up gr-clear gr-comment gr-comment-delete gr-comment-new gr-convert
gr-date gr-decimal-less gr-decimal-more gr-delete gr-delete-column gr-delete-row gr-dependents
gr-duplicates gr-fill gr-fill-down gr-filter gr-filter-advanced gr-filter-clear gr-financial gr-find
gr-flash gr-font gr-format gr-freeze gr-function gr-gridlines gr-group gr-icons gr-indent-less
gr-indent-more gr-insert gr-insert-column gr-insert-row gr-link gr-lock gr-logical gr-lookup
gr-margins gr-math gr-merge gr-merge-across gr-merge-cells gr-minus gr-more gr-name gr-note
gr-number gr-orientation gr-orientation-down gr-orientation-up gr-orientation-vertical gr-page
gr-page-landscape gr-page-orientation gr-page-setup gr-paper gr-pdf gr-plus gr-precedents
gr-print-area gr-print-preview gr-print-titles gr-reapply gr-recent gr-resize gr-send-back
gr-send-backward gr-shape-ellipse gr-shape-line gr-shape-outline gr-shape-rectangle gr-shape-rounded
gr-shape-triangle gr-shapes gr-sheet gr-show-formulas gr-sort gr-sort-asc gr-sort-desc
gr-sort-filter gr-styles gr-subtotal gr-sum gr-symbol gr-table gr-table-style gr-text gr-text-box
gr-text-columns gr-theme gr-ungroup gr-unlock gr-unmerge gr-validation gr-view-normal gr-what-if
gr-wrap gr-zoom gr-zoom-100 gr-zoom-selection graph hash heading help history home info keyboard
kit-eyedropper line-number minus monitor moon more notes outline palette panel-left panel-right pin
plus properties publish query rc-align-center rc-align-justify rc-align-left rc-align-right
rc-break-column rc-break-page rc-bullets rc-chevron-down rc-chevron-up rc-clear rc-column-after
rc-column-before rc-column-delete rc-column-left rc-column-right rc-columns rc-comment-new
rc-comments rc-count rc-drawing rc-drawing-edit rc-find rc-footer rc-header rc-image rc-indent-less
rc-indent-more rc-ink-eraser rc-ink-highlighter rc-ink-lasso rc-ink-medium rc-ink-pen
rc-ink-pen-only rc-ink-select rc-ink-stroke rc-ink-thick rc-ink-thin rc-link rc-look-adapted
rc-margins rc-merge rc-mode-page rc-mode-reading rc-mode-writing rc-note rc-numbers rc-orientation
rc-page rc-painter rc-paper-size rc-quote rc-redo rc-replace rc-rev-accept rc-rev-accept-all
rc-rev-next rc-rev-previous rc-rev-reject rc-rev-reject-all rc-row-after rc-row-before rc-row-delete
rc-row-down rc-row-up rc-spacing rc-split rc-styles rc-table rc-toc rc-track rc-undo rc-wrap
rc-wrap-behind rc-wrap-front rc-wrap-inline rc-wrap-square rc-zoom-in rc-zoom-out rc-zoom-reset
restore ring search settings split square star stats sun sync tag template trash vault view warning
```

## Limiti e pubblicazione

- `manifest.json`: massimo 64 KiB.
- Ogni foglio CSS e `skin.css`: massimo 4 MiB.
- Asset: massimo 1.024 file, 64 MiB per file e 256 MiB complessivi.
- Caratteri: massimo 8 voci in `fonts`, 2 MiB per file e 6 MiB complessivi.
- Icone: massimo 512 nomi, 8 tracciati e 4 KiB per nome, 256 KiB per il file del set.
- Link simbolici, traversal e file non regolari sono rifiutati.
- L'installazione copia in `<config>/themes/.tmp-…` e pubblica con rename atomico; un id già presente è una collisione e non viene sovrascritto.

## Fallback e anteprima

La shell valida ogni luce prima di mostrarla nel catalogo. Se un tema installato non è leggibile o non supera il gate client, non viene montato e la resa ricade sul tema di serie con una diagnosi. La preview delle Preferenze è temporanea: non scrive `appearance.theme` né la cache, Annulla o la chiusura del pannello rimontano la selezione precedente, e solo Applica persiste la nuova scelta.

## Ciclo autore

Da `apps/client`: eseguire `npm run theme:generate`, poi `npm run theme:verify`; per la resa usare anche `npm run bench:verify` e `npm run bench:a11y`. Non modificare a mano `contract.json`, questo README o i file del campione: sono derivati e la verifica byte-per-byte deve restare verde.
