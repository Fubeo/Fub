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

## Controllo del 2026-11-28, parte 2

Tre aree della tabella qui sotto entrano nella mappa: le pagine di
Esporta PDF, i blocchi della Live e l'editor nei fogli stretti della
cornice. Base `310cfff58` (ramo `integra/editor-cornice-1`), prototipo a
`9a4cf1e94`, stessa macchina e stesso Chromium del primo controllo;
estrazione e verifica nelle due luci dalla coda dei controlli pesanti.
Nell'app non si è corretto niente: ogni differenza è una voce di
`DA_COPRIRE` (`apps/client/bench/conformita/editor/da-coprire-parte-2.mjs`)
coi suoi numeri.

| Area | Pezzi aggiunti | Uguali | Diversi | Pezzi interi da coprire |
|---|---|---|---|---|
| esporta PDF, la pagina | 12 | 2 | 10 | 6 |
| blocchi Live e maniglie | 17 | 3 | 14 | 7 |
| fogli stretti (620, 540, 400, 340 px) | 4 | 1 | 2 | 2 |

Il quarto pezzo dei fogli, i margini della copertina, aspetta `#421`
come gli altri della copertina.

Le differenze più visibili:

- **il richiamo della Live**: nel prototipo è una riga flessibile, icona
  e testo, col carattere di lettura a 18 px, raggio 10 e un filo verde
  interno; nell'app è un blocco col carattere dell'interfaccia a 14 px,
  bordo grigio, raggio 8, e l'icona nel margine (44 px di rientro). Il
  titolo è verde nel prototipo, del colore del testo nell'app;
- **il collegamento**: nel prototipo è testo del documento sottolineato in
  verde, nell'app testo verde;
- **i fogli stretti**: il prototipo tiene la pagina a 60 e 24 px di
  margine e riduce «Inserisci» all'icona a 540 px e sotto; l'app stringe i
  margini (40 e 20 a 540, 18 sotto) e tiene la parola;
- **la pagina stampata**: il richiamo ha un filo verde a sinistra nel
  prototipo e una cornice grigia nell'app; la tabella ha le celle
  distanziate (`border-collapse: separate`) e senza spazio sopra e sotto;
  il compito è un elemento d'elenco e non una riga con la casella;
- **la casella dei compiti**: 17 px con un'ombra interna nel prototipo,
  16 px con un bordo nell'app; la barratura del testo fatto è più tenue
  nel prototipo.

Il resto è minore: interlinea 1,62 contro 1,65 su paragrafo, compito,
ripiegabile e trasclusione; raggi di 1 o 2 px; la didascalia a 13 px
contro 12.

I pezzi interi da coprire sono tipi che una delle due parti non mostra: la
nota della scena `esporta-pdf` non ha ripiegabili, figure, formule in
blocco, trasclusioni né schede di nota (il prototipo non ha una
citazione); nessuna scena della Live mostra la scheda di una nota, la
scadenza lontana, la persona in riga o il corpo del ripiegabile aperto;
l'icona del richiamo dell'app non è un elemento. Nei fogli stretti i
gruppi nascosti della barra non hanno stili da leggere, e la sbirciata
non ha una scena.

### Come si applica `embed.css`

Le regole dei fogli stretti non sono nel prototipo: le aggiunge il
simulatore della cornice (`simulatore-cornice/src/embed.css`), che monta
l'editor dentro un foglio `container: pane / inline-size`. Il banco ne
tiene una copia identica,
`apps/client/bench/conformita/editor/cornice-embed.css`, e gli stati
`chiaro-foglio-N` e `scuro-foglio-N` di `editor/comuni.mjs` la applicano
come la cornice: un `<style>` con la copia, e `#win` dentro un `.pane` e
un `.pane-sheet` larghi N px, con le stesse regole di contenimento di
`frame.css`. È la via più piccola che non riscrive niente: le regole
restano quelle del simulatore, byte per byte, e scattano per la stessa
ragione (la larghezza del foglio, non quella della finestra). Dal lato
dell'app lo stato stringe il foglio a fuoco a N px nella finestra a
1280. Chi aggiorna il simulatore ricopia il file.

Due correzioni al banco sono servite per i pezzi col puntatore sopra: il
gesto accetta un elenco di selettori (passa dal blocco e poi dalla
maniglia, che senza si spegne), e la verifica torna a riposo solo dopo
aver risolto i token, perché un elemento che c'è solo col puntatore sopra
non sparisca prima.

## Ciò che la mappa non copre ancora

Pezzi del prototipo senza una voce nella mappa, e perché:

| Area | Non coperti | Perché |
|---|---|---|
| esporta PDF | 24 | varianti dei pannelli che nessuna vista apre; la pagina stampata entra il 2026-11-28 (12 pezzi), ma 6 tipi di blocco la nota della scena non li ha |
| blocchi Live | 33 | entrano il 2026-11-28 testo, compiti, richiamo, collegamento, ripiegabile, immagine, trasclusione e maniglie (17 pezzi); restano la scheda di una nota, la scadenza lontana, la persona in riga, il corpo del ripiegabile e l'icona del richiamo, senza scena o senza elemento, e citazione, elenco e codice, che il prototipo non mostra |
| cornice di contesto | 42 | binario, cassetto e schede di Scrittoio 2: cornice d'altro piano, non dell'editor |
| tabelle e fogli | 31 | menu della griglia, tratteggio del taglio, scelte: nessuna vista |
| diagramma | 21 | il pannello del diagramma: nessuna vista dai due lati |
| commenti | 16 | fumetti e discussioni: il banco ha solo le scene del telefono (`mobile-commenti`) |
| menu e finestre | 16 | selettore della data, menu contestuali, finestrella d'avviso: l'avviso dell'app (`toast`) è una pila di errori in basso a destra, un altro disegno |
| ispettore | 12 | Struttura, Compiti, Versioni: la scena del banco apre Collegamenti |
| sbirciata | 7 | l'app ha `.note-peek`, ma nessuna scena del banco; nel foglio stretto (dal 2026-11-28 gli stati `*-foglio-*`) il prototipo la allarga a tutto il foglio |
| altro | 44 | pezzi minori sparsi, dall'inventario |
| le altre aree | 70 | Base 17, lanciatore 13, formule 10, «/» 8, pagina e testata 6, cornice 6, Sorgente 5, barra di formato 5: stati e varianti dei pezzi già coperti |

Ogni riga è lavoro per la mappa, non per forza un difetto: un pezzo senza
scena va prima aperto dai due lati.
