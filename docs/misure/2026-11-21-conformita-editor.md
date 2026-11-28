# La conformità dell'editor al prototipo

Quanto il front-end dell'editor segue il prototipo approvato
(`PLAN-ui/editor.html` sul ramo `piano/editor-completo`), misurato con il
banco della conformità sugli stili calcolati, nelle due luci, a 1280 e a
700 px, e guardato in foto affiancate.

> **Per chi:** chi corregge l'aspetto dell'editor e chi allarga la mappa
> della conformità.
> **Risultato:** i 296 pezzi che la mappa copriva sono uguali al
> prototipo, salvo le 9 eccezioni scritte, che valgono tutte; ma la mappa
> copriva un terzo dei pezzi del prototipo. Con 37 pezzi nuovi (cornice,
> banda di stato, barra di formato, ispettore, Base nella nota, Sorgente,
> lanciatore, «/») escono 73 differenze su 24 pezzi, tutte negli attrezzi
> attorno al testo. Le più visibili: la tabella della Base dentro una nota
> prende le regole delle tabelle Markdown (testo a 9,75 px) e, a 700 px,
> la barra del titolo riduce la pillola a una lente e il vault a un'icona.

Come funziona il banco lo dice
[Banco visivo e accessibilità](../development/visual-bench.md).

## Come si è misurato

- base `25299965f` (ramo `audit/conformita-editor`), prototipo a
  `c8b643653` (`PLAN-ui/editor.html`, sha256 `69d313a9…`), 21 novembre
  2026, controllo di un agente;
- Chromium di Playwright senza GPU, sul PC fisso (Intel i5-13600KF,
  Debian 13): il prototipo a 1680 × 1000 con luce, larghezza e moto ridotto
  scelti dai suoi comandi, l'app nelle scene del banco a 1280 × 800 e
  700 × 800;
- da `apps/client`: `node bench/conformita/estrai.mjs editor`, poi
  `npm run bench:conformita -- --light=light`, `-- --light=dark` e
  `-- --attese`, dalla coda dei controlli pesanti: tutte e tre verdi a
  mappa aggiornata;
- l'inventario dei pezzi del prototipo viene da uno script a parte, fuori
  dalla repository: apre i passi del prototipo, le viste della Base, le
  schede dell'ispettore e le tre larghezze (piena, 700, telefono) e
  raccoglie i selettori con una classe che hanno un aspetto proprio. È una
  stima: 6 dei passi per larghezza (tre viste della Base, tre schede
  dell'ispettore) non si aprono dallo script;
- 14 foto affiancate, prototipo e app nello stesso Chromium: barra del
  titolo, banda di stato, barra di formato, ispettore, Base nella nota e
  Sorgente nelle due luci a 1280, barra del titolo e banda a 700.

Le differenze misurate sono entrate nella mappa
(`apps/client/bench/conformita/mappa-editor.mjs`) come voci `DA_COPRIRE`
con le loro proprietà: il banco le confronta senza fermarsi, e torna rosso
quando una diventa uguale al prototipo, così chi la corregge toglie la
voce. Le due eccezioni che valgono solo di notte ora dicono i loro stati
(`eccezioni-editor.json`): prima la corsa con la sola luce chiara le dava
per inutili e finiva rossa.

## Il riepilogo

| Misura | Valore |
|---|---|
| pezzi del prototipo, dall'inventario | 581 |
| di cui coperti dalla mappa, prima | 196 |
| di cui coperti dalla mappa, dopo | 236 |
| pezzi della mappa, prima e dopo | 296 → 333 |
| viste della mappa, prima e dopo | 39 → 43 |
| differenze dei pezzi già coperti | nessuna, oltre alle 9 eccezioni |
| differenze misurate dei pezzi nuovi (pezzo e proprietà) | 73, su 24 pezzi |
| di cui a visibilità alta | 2 |
| di cui a visibilità media | 28 |
| di cui a visibilità bassa | 43 |
| differenze viste solo in foto | 11 (1 alta, 5 medie, 5 basse) |
| eccezioni che non valgono più | nessuna (una da riscrivere) |
| pezzi con `attende "#421"` già verdi | 12 su 12 |

La copertura per area, prima e dopo, sui pezzi dell'inventario:

| Area | Pezzi | Prima | Dopo |
|---|---|---|---|
| cornice: barra del titolo e banda | 17 | 1 | 11 |
| barra di formato | 11 | 0 | 6 |
| ispettore | 15 | 0 | 3 |
| Base | 33 | 9 | 16 |
| Sorgente | 6 | 0 | 1 |
| «/» e scelte d'icona | 26 | 13 | 18 |
| lanciatore | 38 | 20 | 25 |
| pagina e testata | 21 | 14 | 15 |
| esporta PDF | 94 | 58 | 58 |
| formule | 29 | 19 | 19 |
| tabelle e fogli | 50 | 19 | 19 |
| blocchi Live | 60 | 10 | 10 |
| menu e finestre | 23 | 7 | 7 |
| diagramma | 22 | 1 | 1 |
| commenti | 16 | 0 | 0 |
| sbirciata | 7 | 0 | 0 |
| cornice di contesto (Scrittoio 2) | 48 | 6 | 6 |
| altro | 65 | 19 | 21 |

La visibilità: **alta** si nota a colpo d'occhio, in ogni nota o in un
gesto comune; **media** si nota accostando le due versioni (misure di
qualche pixel nella cornice, un colore, un fondo); **bassa** è un pixel o
un margine che non cambia la lettura.

## Le differenze, area per area

Le tabelle dicono il valore del prototipo e quello dell'app a 1280 di
giorno, e i colori anche di notte; le righe valgono in tutti e quattro gli
stati, salvo quelle segnate «(1280)», solo larghe.

### La cornice: barra del titolo

File: `apps/client/src/theme/scrittoio/skin/frame.css` (`.titlebar`,
`.pill`, `.vault-chip`, `.titlebar-btn`), misure in
`apps/client/src/theme/scrittoio/structure.css` (`--titlebar-h: 40px`,
`#pill`).

| Pezzo | Proprietà | Prototipo | App | Visibilità |
|---|---|---|---|---|
| `cornice.barra` | height | 44px | 40px | medio |
| `cornice.barra` | padding | destra 8px, sinistra 10px | destra 0px, sinistra 0px | basso |
| `cornice.barra` | gap | 6px | normal | basso |
| `cornice.barra` | color | rgb(23, 34, 27); notte rgb(228, 233, 230) | rgb(87, 98, 91); notte rgb(158, 167, 161) | basso |
| `cornice.pillola` | padding | destra 6px, sinistra 11px | destra 4px, sinistra 12px | basso |
| `cornice.pillola` | margin (1280) | destra 256.5px, sinistra 256.5px | destra 0px, sinistra 0px | basso |
| `cornice.pillola` | border-radius | 9px | 8px | basso |
| `cornice.pillola` | box-shadow | var(--border) 0px 0px 0px 1px inset | none | medio |
| `cornice.pillola` | font-size | 13px | 14px | medio |
| `cornice.pillola` | line-height | 18.85px | 20.3px | basso |
| `cornice.pillola` | background-color | rgb(234, 240, 236); notte rgb(31, 41, 34) | rgb(220, 230, 221); notte rgb(15, 26, 19) | medio |
| `cornice.pillola` | height | 30px | 28px | medio |
| `cornice.pillola-testo` | font-size (1280) | 13px | 14px | medio |
| `cornice.pillola-testo` | line-height (1280) | 18.85px | 20.3px | basso |
| `cornice.vault` | padding | sinistra 8px | sinistra 6px | basso |
| `cornice.vault` | border-radius | 7px | 8px | basso |
| `cornice.pulsante` | gap | normal | 4px | basso |
| `cornice.pulsante` | border-radius | 7px | 8px | basso |
| `cornice.pulsante` | font-size | 13px | 12px | basso |
| `cornice.pulsante` | line-height | 18.85px | 17.4px | basso |

Viste in foto (`01-barra-titolo-*`, `07-barra-titolo-700-*`):

- **alta**: a 700 px l'app riduce la pillola a una lente sola e il vault
  alla sua icona; il prototipo tiene la pillola con «Cerca o esegui un
  comando…», il tasto `Ctrl O` e il nome del vault. Regola in
  `structure.css`: sotto 960 px sparisce il nome del vault, sotto 860 px
  `#pill` diventa largo quanto un pulsante e perde titolo e posto;
- media: la pillola del prototipo ha davanti il posto («Progetti ›»);
  l'app no;
- bassa: il tasto nella pillola, «Ctrl 0» in carattere fisso nel
  prototipo, «Ctrl+O» nell'app.

### La cornice: banda di stato

File: `apps/client/src/theme/scrittoio/skin/frame.css` (`.status-band`,
`.status-item[data-tone]::before`, `.status-mode`), altezza in
`structure.css` (`--status-h: 26px`).

| Pezzo | Proprietà | Prototipo | App | Visibilità |
|---|---|---|---|---|
| `banda.fascia` | height | 32px | 26px | medio |
| `banda.fascia` | padding | destra 6px | destra 12px | basso |
| `banda.fascia` | gap | 14px | 12px | basso |
| `banda.salvato` | width | 7px | 6px | basso |
| `banda.salvato` | height | 7px | 6px | basso |
| `banda.salvato` | border-radius | 50% | 999px | basso |
| `banda.salvato` | background-color | rgb(0, 110, 70); notte rgb(83, 196, 142) | rgb(73, 112, 10); notte rgb(143, 187, 95) | medio |
| `banda.salvato` | margin | destra 6px | destra 0px | basso |
| `banda.modo` | padding | destra 8px, sinistra 8px | destra 6px, sinistra 6px | basso |
| `banda.modo` | gap | 6px | 4px | basso |
| `banda.modo` | border-radius | 7px | 6px | basso |
| `banda.modo` | font-weight | 500 | 400 | medio |
| `banda.modo` | color | rgb(23, 34, 27); notte rgb(228, 233, 230) | rgb(87, 98, 91); notte rgb(158, 167, 161) | medio |
| `banda.modo` | height | 26px | 22px | medio |
| `banda.modo-freccia` | width | 14px | 12px | basso |
| `banda.modo-freccia` | height | 14px | 12px | basso |

Il pallino «Tutto salvato» dell'app usa `--success` (#49700a di giorno),
il prototipo l'accento: la scelta del token va confermata prima di
correggerla. Viste in foto (`02-banda-*`, `07-banda-700-*`):

- media, **manca nell'app**: i suggerimenti dei tasti al centro della banda
  (`.hint`: «/ inserisce un blocco · @ persone e date · Ctrl O cerca o
  esegue · Esc seleziona il blocco»);
- bassa: l'app aggiunge «2 min di lettura», che il prototipo non ha;
- (già misurato sopra) il modo «Scrittura» nel prototipo è in colore
  testo e semigrassetto, con la matita piena; nell'app è attenuato.

### La barra di formato

File: `apps/client/src/theme/scrittoio/skin/menus.css`
(`.format-bar-follow`, righe 784–900).

| Pezzo | Proprietà | Prototipo | App | Visibilità |
|---|---|---|---|---|
| `barra.superficie` | font-size | 13px | 12px | medio |
| `barra.superficie` | line-height | 18.85px | 17.4px | basso |
| `barra.superficie` | color | rgb(23, 34, 27); notte rgb(228, 233, 230) | rgb(87, 98, 91); notte rgb(158, 167, 161) | medio |
| `barra.superficie` | height | 34px | 36px | medio |
| `barra.pulsante` | font-size | 13px | 12px | medio |
| `barra.pulsante` | line-height | 18.85px | 15.6px | basso |
| `barra.pulsante` | opacity | 1 | 0.4 | basso |
| `barra.stile` | font-size | 13px | 12px | medio |
| `barra.stile` | line-height | 18.85px | 15.6px | basso |
| `barra.freccia` | width | 14px | 12px | basso |
| `barra.freccia` | height | 14px | 12px | basso |
| `barra.inserisci` | font-size | 13px | 12px | medio |
| `barra.inserisci` | line-height | 18.85px | 15.6px | basso |

L'opacità di `barra.pulsante` non è un difetto della pelle: nella scena
«Annulla» è spento perché la nota non ha ancora una storia, nel prototipo
è acceso. In foto (`03-barra-formato-*`) la barra è molto vicina al
prototipo; il pulsante dei compiti ha un'icona diversa (elenco numerato al
posto della casella): visibilità bassa.

### L'ispettore

File: `apps/client/src/theme/scrittoio/skin/frame.css` (`.inspector-tabs`,
riga 628) e `structure.css` (`#right-pane`, riga 639).

| Pezzo | Proprietà | Prototipo | App | Visibilità |
|---|---|---|---|---|
| `ispettore.superficie` | width (1280) | 268px | 264px | medio |
| `ispettore.superficie` | padding (1280) | 4px 10px 10px 6px | 0px | medio |
| `ispettore.superficie` | background-color (1280) | rgba(0, 0, 0, 0) | rgb(231, 239, 233) | medio |
| `ispettore.schede` | margin (1280) | destra 0px, sotto 12px, sinistra 0px | destra 12px, sotto 6px, sinistra 12px | basso |
| `ispettore.schede` | border-radius (1280) | 10px | 8px | basso |
| `ispettore.schede` | background-color (1280) | rgb(234, 240, 236); notte rgb(31, 41, 34) | rgb(220, 230, 221); notte rgb(15, 26, 19) | medio |
| `ispettore.schede` | height (1280) | 32px | 30px | medio |
| `ispettore.scheda-scelta` | border-radius (1280) | 8px | 6px | basso |
| `ispettore.scheda-scelta` | box-shadow (1280) | filo 1 px + ombra 0 1 3 | ombra 0 1 1 + 0 6 20, senza filo | medio |
| `ispettore.scheda-scelta` | background-color (1280) | rgb(252, 254, 253); notte rgb(19, 28, 22) | rgb(255, 255, 255); notte rgb(30, 41, 35) | medio |
| `ispettore.scheda-scelta` | height (1280) | 28px | 26px | basso |
| `ispettore.scheda` | border-radius (1280) | 8px | 6px | basso |
| `ispettore.scheda` | height (1280) | 28px | 26px | basso |

Il fondo delle schede del prototipo (#eaf0ec, #1f2922) è `--tray-2`, lo
stesso vassoio che tre eccezioni di Esporta già giustificano: l'app usa
`--bg-hover`. Se la tabella del piano lo traduce allo stesso modo, la
differenza di fondo diventa un'eccezione, non un difetto. Viste in foto
(`04-ispettore-*`):

- media: le schede non sono le stesse né nello stesso ordine. Prototipo:
  Struttura, Collegamenti, Commenti (con il numero), Compiti, Versioni;
  app: Struttura, Collegamenti, Proprietà, Versioni, Commenti, senza
  Compiti (già in `DA_COPRIRE` come `compiti.ispettore`);
- bassa: la scena del banco apre l'ispettore su Collegamenti, il
  prototipo su Struttura: la scheda scelta si confronta su due schede
  diverse.

### La Base dentro una nota

File: `apps/client/src/theme/scrittoio/skin/editors.css` (`.base-tool`
riga 3614, `.base-table` riga 4085, `.base-add-row-button` riga 4193) e,
per la tabella, `apps/client/src/theme/scrittoio/skin/document.css`
(`.markdown-rendered table`, riga 2658).

| Pezzo | Proprietà | Prototipo | App | Visibilità |
|---|---|---|---|---|
| `base.vista-scelta` | line-height | 18.2px | 18.85px | basso |
| `base.vista` | line-height | 18.2px | 18.85px | basso |
| `base.attrezzo` | padding | destra 8px, sinistra 8px | destra 6px, sinistra 6px | basso |
| `base.attrezzo` | line-height | 18.2px | 18.85px | basso |
| `base.attrezzo` | opacity | 1 | 0.5 | medio |
| `base.tabella` | font-size | 13px | 9.75px | alto |
| `base.tabella` | border-collapse | collapse | separate | alto |
| `base.nuova-riga` | font-weight | 400 | 500 | medio |
| `base.nuova-riga` | color | rgb(87, 98, 91); notte rgb(158, 167, 161) | rgb(23, 34, 27); notte rgb(228, 233, 230) | medio |

**La tabella a 9,75 px è un difetto vero.** La Base incorporata sta dentro
`.markdown-rendered`, e `.markdown-rendered table` (specificità 0,1,1)
batte `.base-table` (0,1,0): la tabella della Base prende `font-size:
0.75em`, `display: block` e i bordi separati delle tabelle Markdown. In
foto (`05-base-*`) le intestazioni e le date sono piccole, il resto delle
celle torna a 13 px per regola propria. La correzione sta nel selettore
delle tabelle Markdown (escludere le tabelle della Base) o in un selettore
della Base più forte.

Viste in foto:

- media: l'app mette sopra la tabella le pastiglie di filtro e ordine, una
  riga di spiegazione («Questa Base è un blocco dentro la nota…»), il
  pulsante «Apri come file» e «Risultati: 7 di 7»; il prototipo va dritto
  alla tabella;
- media: a 1280 la tabella dell'app esce a destra (l'ultima colonna è
  tagliata e scorre), quella del prototipo sta nella colonna;
- media, **manca nell'app** (già in `DA_COPRIRE`, #421): le pastiglie di
  Stato nelle celle, scritte come testo; la riga dei totali c'è.

### La Sorgente

File: `apps/client/src/theme/scrittoio/skin/document.css`
(`.pane-editor[data-markdown-mode="source"] .cm-content`).

| Pezzo | Proprietà | Prototipo | App | Visibilità |
|---|---|---|---|---|
| `sorgente.testo` | font-size (1280) | 13px | 14px | medio |
| `sorgente.testo` | white-space (1280) | pre-wrap | break-spaces | basso |

In foto (`06-sorgente-*`) i colori della sintassi coincidono; l'app ha un
trattino solitario in alto a destra del foglio e la riga del titolo su un
fondo proprio (la riga attiva): visibilità bassa.

### Lanciatore e «/»

I 10 pezzi nuovi (elenco, nome, posto e dati dell'anteprima del
lanciatore; nomi e icone delle tessere e delle righe del menu «/»; testo
del disegno; l'icona della testata) sono uguali al prototipo in tutti gli
stati.

### Telefono

Il banco non ha uno stato telefono: `STATI` della mappa ha solo 1280 e
700. I 15 pezzi del prototipo che compaiono solo stretti (fra cui
`.peek`, `.k-cols`, `.lift-more` e la banda del telefono) non sono
confrontati da nessuna parte.

## Il controllo del 2026-11-28

La mappa allargata a tabelle e fogli, diagramma, commenti, menu e finestre
e sbirciata. Le differenze non si sono corrette nell'app: ognuna è una voce
«controllo del 2026-11-28» in fondo a `DA_COPRIRE`, coi numeri prototipo →
app; la voce diventa rossa quando la differenza sparisce.

| Misura | Valore |
|---|---|
| viste della mappa | 43 → 53 (`editor/viste-aree.mjs`) |
| pezzi aggiunti | 97 |
| uguali al prototipo in tutti gli stati | 35 |
| con differenze, coperti in `DA_COPRIRE` | 62 pezzi, 123 coppie pezzo-proprietà |
| pezzi interi che mancano o che nessuna vista apre | 18 |

| Area | Aggiunti | Uguali | Diversi | Interi in `DA_COPRIRE` |
|---|---|---|---|---|
| tabelle (`tabella.*`) | 15 | 5 | 10 | 2 |
| foglio nella nota (`foglio.*`) | 10 | 5 | 5 | 5 |
| diagramma | 25 | 14 | 11 | 6 |
| commenti | 22 | 6 | 16 | 0 |
| sbirciata | 7 | 2 | 5 | 1 |
| menu e finestre: data | 16 | 3 | 13 | 0 |
| menu e finestre: avviso e anteprima | 2 | 0 | 2 | 4 |

Il menu della griglia della tabella è lo stesso menu contestuale (`.pop.cx`)
dei pezzi `menu.*`, già confrontati: non ha voci sue. Il taglio della
tabella resta il pezzo intero `tabella.taglio`.

Le differenze più visibili:

- **avviso**: un altro disegno. Il prototipo ha un'etichetta scura
  rovesciata in basso al centro; l'app un riquadro chiaro con l'ombra dei
  riquadri (`avviso.superficie`, `avviso.testo`).
- **diagramma**: il sorgente si scrive nelle righe del blocco di codice
  (mono da 14 px, a capo, sul fondo del codice) invece che in un riquadro
  accanto al disegno (mono da 12, Fatto in una barra alta 32); la
  didascalia è in Newsreader da 12 invece che in Hanken Grotesk da 13; la
  crocetta dell'ingrandito non è nell'angolo.
- **tabella**: niente scatola attorno (angoli da 8 e filo interno nel
  prototipo); il campo della cella in modifica sta nella cella invece di
  stendersi sopra con angoli da 6; il numero di riga e la lettera di colonna
  al passaggio non prendono il velo del prototipo.
- **foglio nella nota**: celle alte 28 px invece di 34, colonna dei numeri
  larga 52 invece di 16, corpo senza margini (22/14/14/30 nel prototipo).
- **commenti**: discussione, autore, testo e campo a 12 px invece di 13;
  segno del commento con un velo diverso; a 700 px l'app porta la bolla nel
  testo (34 × 20 px) invece che al margine (41,5 × 26).
- **sbirciata**: larga 382 px invece di 455 a 1280, con gli angoli
  arrotondati anche a destra.
- **data**: riquadro con angoli da 10 invece di 14, fondo bianco invece del
  foglio, scelte rapide e passaggi coi fondi pieni dell'app invece dei veli.

Le differenze solo di giorno (grigi 87/98/91 contro 91/102/95) sono voci con
`stati`: `DA_COPRIRE` accetta ora `stati` come le eccezioni, perché una
differenza che c'è solo in una luce non faccia rosso nell'altra.

`estrai.mjs` leggeva l'altezza della lavagna (`schede.lavagna.zona`) a 700
px diversa a ogni giro, 279 o 260 px: la finestra del prototipo scorre sulla
sua `max-width` anche col moto ridotto, e la lavagna calcola l'altezza in JS
dalla larghezza del momento. Ora aspetta la larghezza ferma: il valore vero
è 224 px. L'attesa di più di dieci minuti di un secondo giro non si è
ripetuta; i log mostrano la coda dei controlli pesanti piena (fino a 565 s
d'attesa), causa probabile, non provata.

## Le eccezioni

Le 9 voci di `apps/client/bench/conformita/eccezioni-editor.json` valgono
ancora tutte: ognuna copre una differenza che c'è (30 letture), e il
motivo scritto è ancora vero. Una sola è da riscrivere:

- `schede.pdf.pagina`: il motivo nomina `.canvas-card-pdf::after`; la regola
  vera è `:root[data-theme="dark"] .live-card
  .canvas-card-pdf[data-card-state="content"]::after`.

Le due voci che valgono solo di notte (`schede.pdf.pagina`,
`esporta.dg-miniatura-scelta`) ora dicono `"stati": ["scuro-1280",
"scuro-700"]`.

I 12 pezzi con `attende "#421"` sono verdi con `--attese`: il lavoro che
aspettavano è entrato, e chi tocca la mappa può togliere il loro
`attende`.

## Ciò che la mappa non copre ancora

Pezzi del prototipo senza una voce nella mappa, e perché:

| Area | Non coperti | Perché |
|---|---|---|
| esporta PDF | 36 | varianti dei pannelli che nessuna vista apre |
| blocchi Live | 50 | callout, toggle, link, scadenze, citazioni: il banco ha scene per alcuni (callout, toggle), la mappa non ne ha le viste |
| cornice di contesto | 42 | binario, cassetto e schede di Scrittoio 2: cornice d'altro piano, non dell'editor |
| tabelle e fogli | 7 | dal 2026-11-28 solo pezzi interi in `DA_COPRIRE`: fantasma e anteprima del riempimento (si vedono solo a metà gesto); intestazioni, numeri, totali, formule ed errori del foglio nella nota (l'app li disegna nella tela) |
| diagramma | 6 | dal 2026-11-28 solo pezzi interi: il riquadro del sorgente accanto al disegno (l'app non l'ha) e nodi, rombi, pillole, frecce, etichette (l'app mostra il diagramma come immagine) |
| commenti | 0 | coperti dal 2026-11-28 |
| menu e finestre | 4 | dal 2026-11-28 solo pezzi interi: azione e codice dell'avviso (l'app non li ha), scheda e titolo dell'anteprima di un collegamento (nessuna scena la apre) |
| ispettore | 12 | Struttura, Compiti, Versioni: la scena del banco apre Collegamenti |
| sbirciata | 1 | dal 2026-11-28 solo l'icona grande della nota, che la nota del banco non ha |
| altro | 44 | pezzi minori sparsi, dall'inventario |
| le altre aree | 70 | Base 17, lanciatore 13, formule 10, «/» 8, pagina e testata 6, cornice 6, Sorgente 5, barra di formato 5: stati e varianti dei pezzi già coperti |

Ogni riga è lavoro per la mappa, non per forza un difetto: un pezzo senza
scena va prima aperto dai due lati.
