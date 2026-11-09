# Piano: Le celle dei fogli

Branch: piano/griglia-celle (preso da piano/k3-motori; la PR va su
piano/k3-motori finché K3 non è in main, poi su main)
Obiettivo: la griglia dei fogli scorre senza bianco e senza salti; i segni
(la cella attiva, l'intervallo, il riempimento, la copia, il taglio, i bordi
tirati) stanno nella zona dove cadono, restano e scivolano con `moto/`; la
cella aperta è la cella stessa; ciò che si scrive o si tira si vede subito;
col dito si scorre. Lo stesso livello della barra dei fogli di K3, con le
stesse molle, gli stessi tempi e lo stesso «Movimento ridotto».
Perché: l'utente, il 2026-11-03: «nella versione che gira sulla 1432 non
funziona particolarmente bene, ci sono glitch grafici e non ci sono
animazioni gradevoli. Vorrei che anche quella griglia fosse al livello della
barra in alto». Le foto hanno trovato sedici difetti, ognuno con la sua causa
nel codice (la tabella «I difetti di oggi»).
Fuori scope: la barra multifunzione, il menu «Comandi» e il loro movimento
(K3, T18 e T19); il motore e i suoi calcoli (le serie del riempimento, i
valori delle formule arrivano dal foglio come oggi); i formati dei numeri
all'inglese che si vedono nelle celle («1,234.00 €»: vengono dal file e dal
motore; un difetto a parte, per cui l'orchestratore apre un'issue); l'aspetto
`look-tema` (il foglio di calcolo offre soltanto `file` e `adattato`); la
griglia delle tabelle Markdown (`tabella/`), che ha la sua.
Assunzioni: B1–B7 qui sotto, prese dal pianificatore col prototipo; le
domande D-1…D-8 le hanno rimesse all'utente, che ha risposto a tutte (D-7
il 2026-11-04, le altre il 2026-11-05).
L'utente ha visto il prototipo: le celle vanno bene e «per il resto
funziona tutto»; ha chiesto un movimento senza scatti e un po' più svelto,
che è quello di B5, B6 e T3. Poi, provandolo col mouse: «per una frazione
di secondo la selezione cambia e viene selezionata tipo una porzione
maggiore di superficie», e ancora «glitcha e esce dal normale funzionamento
e seleziona male il tutto». Quindi i pezzi della selezione sono sempre lo
stesso rettangolo, nessuno resta indietro o si stacca, e la selezione
finisce esattamente sulla cella sotto il puntatore: il motore unico dei
segni di T3. Fra i tre modi del prototipo l'utente ha scelto «scivola»
(D-7): col puntatore la selezione scivola come coi tasti (B5).
Anche il quadratino e le maniglie del tocco sono sempre un pezzo solo,
intero: mai spezzati sul filo del blocco né lasciati sul filo dopo uno
scorrimento (B7, D-8). Il 2026-11-05, alle D-1…D-6 e D-8: «seguo i tuoi
consigli». Valgono quindi B1–B4, B6 e B7 come sono scritte e «coperte» per
D-8; e, come l'orchestratore aveva consigliato, il segno della copia (D-1)
e la velocità della selezione (D-5) diventano anche due preferenze in
Impostazioni, con di norma la scelta di B1 e di B5–B6: T9.
Ondate: T1 | T2 | T3 | T4 T7 | T5 | T6 | T9 | T8 (tutti toccano
`editors/grid/engine.ts`: T4 e T7 ne toccano parti diverse, la cella aperta
e il puntatore, e possono girare insieme; T5 e T6 toccano tutti e due la
risposta del foglio, `grid-motion.ts` e `motion-rules.mjs`, e vanno uno dopo
l'altro; T9 legge le costanti di T3 e i segni di T6 e viene dopo di loro,
prima delle foto di T8). Il primo task parte quando T19 di K3 è integrato in
piano/k3-motori: T14, T15, T18 e T19 di K3 toccano `structure.css`,
`skin/editors.css`, l'anatomia, `bench/scene.mjs`, `bench/motion-rules.mjs`
e `moto/flip.ts`, come questo piano. T16 e T17 di K3 non li toccano.
Prototipo: `PLAN-ui/celle-griglia.html`, fatto il 2026-11-03 dallo script
del pianificatore (`gen-celle.mjs`, `celle-template.html` e `celle-script.js`
in `/home/fubeo/.cache/fub-k1/tmp/k3-barra2/griglia/`, fuori dal repo); dal
2026-11-04 «Il motore dei segni» e `dragTo` sono scritti nel file stesso, e
gli script del generatore sono più vecchi: il prototipo vale, non loro.
La barra degli stati: «Stato» (a riposo, un intervallo, un intervallo oltre
la riga bloccata, la cella aperta con un testo lungo, una colonna tirata
vicino al bordo, il riempimento in attesa, copiato, tagliato, il telefono),
«Griglia: nuova / di oggi» (la griglia di oggi, coi segni dove li mette il
motore, per confronto), «Il foglio risponde» (sì dopo 1,5 s, sì subito, no
dopo 1,5 s), «Segno della copia», «Selezione col puntatore» (D-7),
«Maniglie sul filo del blocco» (D-8), la luce (quattro), la larghezza
(piena, 700 px, telefono) e «Movimento: sì / ridotto».

## Modifiche

nessuna

## I difetti di oggi

Misurati il 2026-11-03 su una copia della 1432 (ponte 1447 e Vite 1448 sul
client di piano/k3-motori @ 0862008e) con il vault del banco e una cartella
grande fatta apposta (3000 righe × 20 colonne, la riga 1 e la colonna A
bloccate), in Chromium di Playwright a 1360 × 900. La 1432 non si è toccata:
il motore è lo stesso, e il vault dell'utente non si apre con due host. Le
righe del codice sono quelle di piano/k3-motori @ 0862008e.

| # | Che cosa si vede | La causa nel codice | Task |
|---|---|---|---|
| 1 | scorrendo veloci in giù, il bianco: 16 fotogrammi su 32 hanno una fascia vuota alta fino a 374 px | `editors/grid/engine.ts`: il gestore dello scorrimento (riga 832) chiede solo un fotogramma (`#scheduleRender`, 3628–3634, un `requestAnimationFrame`); il margine è di due righe (`GRID_OVERSCAN = 2`, riga 100, usato da `#renderedIndices`, 505–527); sotto le celle non c'è niente | T2 |
| 2 | scorrendo di lato, la colonna bloccata salta: 12 fotogrammi su 25 diversi dal primo | `#columnLeft` (2173–2176) e `#freezeLines` (2631) aggiungono `scrollLeft` a mano: la posizione arriva un fotogramma dopo lo scorrimento | T1 |
| 3 | un intervallo che passa la riga bloccata è lungo circa cinque righe in più, e la sua cima sta sotto la riga bloccata | `#rangeBox` (2589–2596) aggiunge `scrollTop` alla parte bloccata; i segni stanno a `z-index: 3`, sotto la riga bloccata a 6 (`structure.css` 1555) | T1 |
| 4 | a ogni freccia le intestazioni (10), l'angolo (5) e il quadratino (5) si rifanno; il segno salta, senza movimento | `#reconcile` (2321) riconosce le righe e le celle per chiave e tutto il resto (`DRAWN`, riga 539) per `outerHTML`: un segno che si sposta è un nodo nuovo | T3 |
| 5 | il rettangolo della selezione non è simmetrico sui fili della griglia | il bordo di 2 px di `.grid-selection` (`skin/editors.css` 542) sta tutto dentro il riquadro, mentre il filo della cella sta su un lato solo | T3 |
| 6 | la cella aperta resta chiusa nei suoi 176 px, e compare di colpo | `#startEditing` mette l'editor dentro la cella (`cell.append`, 3613) e `#positionEditor` (3636) gli dà la misura della cella | T4 |
| 7 | aprendo la cella il testo cambia carattere (IBM Plex Mono), si sposta di 11 px e prende la tinta della riga attiva | l'editor è un `TextEngine` (`createTextEngine` con `field: true`, 824); il tema `editors/text/theme.ts` dà a `.cm-content` `var(--font-mono)` (riga 97) e la riga attiva | T4 |
| 8 | un numero scritto resta a sinistra per circa 1,5 s, finché il foglio non risponde | `#showWritten` (1821) mette ogni battuta come `{ kind: "text" }` | T5 |
| 9 | una colonna tirata torna com'era al rilascio e salta alla larghezza nuova dopo circa 1,8 s; la misura sta a `x + 6` (2443) ed esce dal riquadro di 156 px vicino al bordo destro | la larghezza vale solo quando torna il comando `home.columnWidth` (2521); l'etichetta è messa a destra del bordo senza guardare il riquadro | T5 |
| 10 | al rilascio del riempimento il contorno sparisce, e i valori arrivano circa 1,04 s dopo, senza niente nel mezzo | `#fillMarks` (2397–2408) disegna l'anteprima solo mentre `#drag.kind === "fill"` | T6 |
| 11 | una copia non lascia nessun segno; il taglio è un tratteggio fermo | `#copy` (3965–3980) ricorda `#copied` senza un segno; `#cutMarks` (2576–2587) è un bordo fermo | T6 |
| 12 | col dito, trascinare scorre e intanto sceglie celle | `#pointerDown` (4105) non guarda `pointerType`; la griglia non dice `touch-action` | T7 |
| 13 | ogni disegno rifà tutte le celle visibili e poi le confronta | `#render` (2178) costruisce elementi nuovi per ogni cella, e `#reconcile` sostituisce | T2 |
| 14 | nella luce scura la cella aperta ha il fondo `--bg-elev` attorno all'inchiostro della carta, con una striscia chiara | `.grid-cell-editor` (`skin/editors.css` 621–623) | T4 |
| 15 | nella luce scura i segni sono l'accento `#82a8fd` sulla carta bianca del file, circa 2,3:1; il bordo del quadratino è `var(--sheet)` | `.grid-selection` e `.grid-fill-handle` (`skin/editors.css` 542, 547–549) usano `--accent`, che nelle luci scure è chiaro, su una carta che resta chiara | T3 |
| 16 | il rettangolo passa sopra la colonna bloccata e sopra le intestazioni delle righe | ogni `.grid-row { z-index: 1 }` (`structure.css` 1551) è un contesto di sovrapposizione a sé: i segni non si ordinano con le fasce ferme | T1 |

Le foto (fuori dal repo, in
`/home/fubeo/.cache/fub-k1/tmp/k3-barra2/griglia/foto/`):
`_1-oggi-scorrere.png` (1, 2, 16), `_2-oggi-cella-aperta.png` (6, 7, 14, 15),
`_3-prototipo-confronto.png` (il prototipo accanto a oggi: l'intervallo, la
cella aperta, l'intervallo oltre il blocco, la luce scura),
`_4-prototipo-gesti.png` (F2 su un testo lungo, la colonna tirata, la copia, il
riempimento tirato e la serie, il tocco lungo al telefono); i fotogrammi e le
misure in `foto/moti/` e `foto/gesti/`.

## Dal prototipo

Il prototipo è `PLAN-ui/celle-griglia.html`. I blocchi di CSS segnati «copia»
sono di Fub e non si spostano (i token delle quattro luci, `foundation.css`, la
carta del file, la geometria e la pelle della griglia di oggi); quelli segnati
«→ file» sono il codice nuovo; quelli «solo prototipo» restano lì. Le regole
marcate `data-griglia="oggi"` sono la griglia di oggi per il confronto e non
vanno in nessun file. Lo script è del prototipo: il disegno, i segni e i
movimenti si scrivono nel motore della griglia e con `moto/`, con le stesse
molle, gli stessi tempi e le costanti col nome dello script. Il prototipo ha
le larghezze fisse e righe alte uguali: il codice usa `#columns.offsets` e
`#rows.offsets`.

| Pezzo | Destinazione | Task |
|---|---|---|
| CSS `→ structure.css (T1 e T2: il piano della griglia)`: `.grid-plane`, la testa sticky (`.grid-head`), le righe del corpo (`.grid-rows`), le intestazioni delle righe e le colonne bloccate sticky nella riga, le righe senza `z-index` | `theme/scrittoio/structure.css`, al posto delle regole di posizione della griglia (`.grid-canvas`, `.grid-row`, `.grid-row.frozen`, `.grid-freeze`) | T1 |
| CSS `→ structure.css (T2 e T3: i livelli dei segni)`: `.grid-marks-body`, `-top`, `-left`, `-corner`, `.grid-lift-*`, `.grid-fixed` | `structure.css` | T1 (i livelli), T3 (i segni dentro) |
| script `buildNuova` e `layoutColumns`: il piano, i livelli per zona, i fili del blocco nei livelli fermi | `editors/grid/engine.ts` | T1 |
| script `clipRect` e il taglio di un rettangolo nelle quattro zone; `cornerZone`, `cornerSeen` e `wholeRect` per i segni d'angolo, che non si tagliano | `editors/grid/marks.ts` (nuovo, puro, con `marks.test.ts`) | T1 |
| CSS `→ structure.css (T1: la carta)`: `.grid-paper` coi fili delle righe e `.grid-rule-column`, `.grid-paper-top`, `-left`, `-corner`; le celle opache | `structure.css` e, per i colori dei fili, `skin/editors.css` | T2 |
| script `renderRows`: un riquadro di margine sopra e sotto, le righe che restano, aggiunte e tolte solo ai bordi, rifatte solo a un salto | `editors/grid/engine.ts` (`#render`, `#renderedIndices`) | T2 |
| script `pool` e `shownMarks`: i pezzi di ogni segno ci sono sempre, per zona e per nome; una freccia li sposta | `editors/grid/marks.ts`, `engine.ts` | T3 |
| CSS `→ skin/editors.css (T3: i segni)`: `--grid-mark` (`--paper-caret` sulla carta del file, `--accent` con l'aspetto adattato), i lati del rettangolo (`edge`, 2 px: uno sul filo, uno dentro), l'anello della cella attiva (`ring`), il velo (`veil`), le fasce delle intestazioni (`band-col`, `band-row`), il quadratino (`handle`), i fili del blocco (`freeze`), i colori forzati | `theme/scrittoio/skin/editors.css`, nella sezione «Il foglio di calcolo», al posto di `.grid-selection` e `.grid-fill-handle` | T3 |
| script `run`, le costanti in cima (`ENTER_SCALE`, `ANTS_STEP`, `ANTS_MS`, `GLIDE`, `SLIDE`), la geometria unica dei segni (`marksGeometry`, `marksParts`) e «Il motore dei segni» (`want`, `view`, `slowRoot`, `REST_PX`, `step`, `contain`, `beat`, `draw`, `style`, `updateMarks`) | `editors/grid/grid-motion.ts` (nuovo): il fotogramma è un ascoltatore di `onFrame` (`moto/ticker.ts`), il passo è `advanceSpring` e il riposo `springAtRest` di `moto/spring.ts`; per ciò che non segue i dieci numeri (le dissolvenze, le colonne, i valori) `animate`, `flip` e `stagger` di `moto/` | T3 |
| script «Il puntatore», `dragTo`: lo stesso punto per il movimento, lo scorrimento sotto il puntatore fermo e il rilascio | `editors/grid/engine.ts` (`#dragTo`, il gestore di `scroll`, `#endDrag`) | T3 |
| CSS `→ structure.css e skin/editors.css (T4: la cella aperta)`: `.grid-cell-editor`, `-frame`, `-text`, la crescita a colonne intere e l'andare a capo (`wraps`) | `structure.css` e `skin/editors.css` | T4 |
| script `placeEditor`: la cella aperta nel livello «lift» della sua zona, la misura a colonne intere fino al bordo del riquadro, poi a capo | `editors/grid/engine.ts` (`#startEditing`, `#positionEditor`) | T4 |
| script «La risposta del foglio»: il numero a destra subito, la formula tenue fino al valore, la larghezza subito, il ritorno scivolando con l'avviso | `editors/grid/engine.ts` (`#showWritten`, il bordo tirato), `grid-motion.ts` | T5 |
| script «Riempimento», la copia (`copy`, `flash`, `pulse`), il taglio (`cut`), le formiche (`ants`, `.grid-ants`), l'incolla che si vede subito | `editors/grid/engine.ts`, `grid-motion.ts`; CSS `.grid-mark.copy`, `.cut`, `.ants`, `.grid-ants` nei due file | T6 |
| script «Il puntatore»: `TAP_MOVE`, `LONG_PRESS_MS`, `DOUBLE_TAP_MS`, le maniglie del tocco lungo (`touch`, `data-handle`), la presa `gripAt` (`GRIP_R`) e l'ascoltatore `touchstart` che la ferma | `editors/grid/engine.ts` (`#pointerDown` e seguenti), `grid-motion.ts`; CSS `.grid-mark.touch` | T7 |
| la scelta «Segno della copia» della barra del prototipo (tratteggio e battito, solo il tratteggio, solo il battito) e le molle `GLIDE`/`SLIDE` | `crates/fub-host/src/settings.rs` (le due voci), `editors/grid/grid-motion.ts`, `engine.ts` | T9 |
| gli stati della barra del prototipo (intervallo, oltre il blocco, cella aperta, colonna tirata, riempimento, copiato, tagliato, telefono) | `apps/client/bench/scene.mjs` | T8 |
| le misure delle sonde del pianificatore (`sonde/moti.cjs`, `sonde/gesti.cjs`: fasce vuote, fotogrammi della colonna ferma, nodi rifatti per freccia, scostamento del testo, contrasto) | `apps/client/bench/grid-gestures.mjs`, un controllo per task con la sua sigla | T1–T7 |

Nel codice i nomi corti dei segni del prototipo (`.h`, `.v`, `edge`, `ring`,
`veil`, `copy`, …) prendono il prefisso della superficie (`grid-mark-edge`,
`grid-mark-ring`, …), perché ogni classe che la pelle veste è un hook
dell'anatomia; il verso (`h`, `v`) e il lato possono stare in un attributo
`data-`. L'elenco finale lo scrive chi fa T3, nel rapporto e nell'anatomia.

## Fonti

- Il prototipo e le sonde del pianificatore, qui sopra.
- `docs/architecture/grid-surface.md` («La griglia», «Scrivere nelle celle»,
  «La selezione e il riempimento», «Gli appunti»).
- `apps/client/src/moto/` (`animate`, `flip`, `stagger`, `enter`, `halt`,
  `motionLevel`; `SPRINGS`, `DURATION`, `STAGGER_MS`, `STAGGER_MAX` di
  `spring.ts`), `bench/motion.test.ts`, `bench/motion-rules.mjs`.
- `apps/client/bench/grid-gestures.mjs` (il banco dei gesti: ogni controllo
  ha la sigla del cantiere che lo fa passare, e `ACCESI` dice quali contano).
- Il piano K3 (`PLAN.md` su piano/k3-motori), T18 e T19: le stesse molle e
  lo stesso modo di scrivere il movimento.
- Scritto su piano/k3-motori @ 0862008e (2026-11-03).

## Assunzioni

- B1 · Il segno della copia è un tratteggio largo e un battito (una
  dissolvenza del contorno pieno in `DURATION.swap`). Il taglio è un
  tratteggio fitto. Le formiche camminano solo mentre il foglio non ha
  ancora risposto (un riempimento, un incolla tagliato). (D-1, D-6)
- B2 · La cella aperta cresce a destra a colonne intere, anche sopra le
  celle piene, come Excel, fino al bordo del riquadro; poi va a capo e
  cresce in giù fino a metà del riquadro, poi scorre dentro. (D-2)
- B3 · Un numero va a destra appena lo si conferma, e una larghezza o
  un'altezza tirate valgono dal primo fotogramma dopo il rilascio. Se il
  foglio dice di no, tornano com'erano scivolando, e l'avviso dice perché.
  Una formula resta com'è scritta, tenue, finché non arriva il valore. Il
  riempimento non si mostra prima: la serie la calcola il motore. (D-3)
- B4 · Al telefono un tocco sceglie, due tocchi entro `DOUBLE_TAP_MS`
  aprono la cella, un tocco lungo (`LONG_PRESS_MS`) mette le due maniglie
  per allargare la selezione; trascinare col dito scorre e basta. (D-4)
- B5 · Coi tasti (frecce, Maiusc+frecce, Ctrl+frecce, pagine, Home), coi
  comandi e col puntatore la selezione scivola con la molla `GLIDE` (il
  modo «scivola», la risposta dell'utente a D-7): la cella attiva e ogni
  lato del rettangolo, che cresca o che cali, vanno al loro posto
  scivolando, anche dopo un clic su una cella. Mentre si trascina avanti e
  indietro i pezzi restano un rettangolo solo e la cella attiva ci sta
  dentro; un lato che cala ci mette un attimo ad arrivare, e intanto la
  selezione mostra per un attimo qualche cella non scelta (nelle sonde a
  1280 px fino a 507 px), come l'utente ha scelto. Finisce sulla cella
  sotto il puntatore, anche quando la griglia scorre sotto il puntatore
  fermo e al rilascio. (D-5, D-7)
- B6 · Le molle sono della griglia, appena sovrasmorzate perché un bordo
  che rimbalza si legge come un difetto: `GLIDE` (1400/75, le radici 35 e
  40 al secondo, al 90 % in circa 105 ms) per i segni, `SLIDE` (700/53, le
  radici 25 e 28, al 90 % in circa 150 ms) per le colonne che scivolano e
  le maniglie, in cima a `grid-motion.ts`; `moto/spring.ts` non cambia. Un
  numero dei segni è fermo sul bersaglio a meno di `REST_PX` (0,1 px) e
  sotto i 2 px al secondo: `springAtRest` di `moto/` con quella precisione.
  Dalla barra restano
  `DURATION.state` (90 ms) per ciò che compare, `DURATION.swap` (140 ms) per
  ciò che esce, `STAGGER_MS` (12) e `STAGGER_MAX` (8) fra i valori che
  arrivano. Le costanti nuove, in cima a `grid-motion.ts` e col nome del
  prototipo: `ENTER_SCALE` (0,96), `ANTS_STEP` (8 px), `ANTS_MS` (320 ms);
  quelle dei gesti, in `engine.ts`: `TAP_MOVE` (8 px), `LONG_PRESS_MS`
  (450), `DOUBLE_TAP_MS` (300), `RESIZE_SLOP` (4), `FILL_SLOP` (6),
  `GRIP_R` (9).
- B7 · Il quadratino e le maniglie del tocco, i segni d'angolo, non si
  tagliano per zona come i lati: ognuno è un pezzo solo, intero, nel
  livello della zona del suo angolo, e sul filo di una colonna o di una riga
  bloccata la fascia ferma ne copre la parte che le passa sotto, come copre
  le celle; scorrendo, passa sotto la fascia insieme alla sua cella. Si
  prende dove si vede il suo angolo, per intero anche quando la fascia ne
  copre metà. (D-8)

## Domande per l'utente (tutte con la risposta)

- D-1 · Il segno della copia: tratteggio e battito (B1, consigliato), solo
  il tratteggio, o solo il battito? (Nel prototipo: «Segno della copia».)

  Risposta (2026-11-05, l'utente: «seguo i tuoi consigli»): tratteggio e
  battito di norma (B1), e una preferenza in Impostazioni per scegliere
  fra le tre (T9).

- D-2 · La cella aperta che cresce copre le celle accanto anche quando non
  sono vuote, come Excel (B2)?

  Risposta (2026-11-05, «seguo i tuoi consigli»): sì, come Excel (B2).

- D-3 · Mostrare subito una larghezza o un numero prima che il foglio
  risponda, e tornare indietro se dice di no (B3)? (Nel prototipo: «Il
  foglio risponde: no».)

  Risposta (2026-11-05, «seguo i tuoi consigli»): sì, subito, e indietro
  scivolando con l'avviso se il foglio dice di no (B3).

- D-4 · Al telefono, il tocco lungo per le maniglie va bene (B4)?

  Risposta (2026-11-05, «seguo i tuoi consigli»): sì, il tocco lungo (B4).

- D-5 · La velocità della selezione, coi tasti e quando cresce col
  puntatore: `GLIDE`, al 90 % in circa 105 ms (B5, B6)?

  Risposta (2026-11-05, «seguo i tuoi consigli»): `GLIDE` di norma (B5,
  B6), e una preferenza in Impostazioni per una selezione più svelta, più
  morbida o a scatti (T9).

- D-6 · Le formiche che camminano mentre il foglio risponde a un
  riempimento (B1)?

  Risposta (2026-11-05, «seguo i tuoi consigli»): sì, le formiche (B1).

- D-7 · La selezione col puntatore (B5). Nel prototipo: «Selezione col
  puntatore». In tutti e tre i modi i pezzi sono sempre lo stesso
  rettangolo, la cella attiva sta dentro, e la selezione finisce sulla
  cella sotto il puntatore; coi tasti scivola sempre.
  - «segue» (consigliato): cresce scivolando e cala subito, e un clic
    salta. Non mostra mai una cella che il puntatore non ha scelto; mentre
    cresce ne mostra per un attimo qualcuna in meno (il lato nuovo al 90 %
    in circa 105 ms; nelle sonde, col mouse più svelto, il lato resta
    indietro al più di 341 px a 1280 e di 271 al telefono, e di 751 con la
    CPU rallentata 4× mentre la griglia scorre da sola). Tiene il moto che
    piace all'utente dove non può sbagliare.
  - «salta»: col puntatore la selezione è in ogni fotogramma esattamente
    quella scelta e si sposta a scatti di cella, come in Fogli Google
    (nelle sonde zero fotogrammi diversi); scivola solo coi tasti. È la
    lettura più stretta di «mai un'area diversa», ma col mouse il moto non
    si vede più.
  - «scivola»: col puntatore come coi tasti, il moto di prima, adesso
    senza salti né pezzi staccati; ma un lato che cala ci mette un attimo
    ad arrivare, e intanto la selezione mostra celle non scelte (nelle
    sonde a 1280 px fino a 507 px di troppo): è la «porzione maggiore» che
    l'utente ha visto.

  Risposta (2026-11-04, l'utente): «in celle dei fogli voglio selezione
  del puntatore -> scivola sempre». Il modo «scivola»: B5 e T3 lo dicono.

- D-8 · Il quadratino e le maniglie del tocco sul filo di una colonna o di
  una riga bloccata (B7). Nel prototipo: «Maniglie sul filo del blocco».
  Prima ogni maniglia si tagliava per zona come un lato: sul filo diventava
  due ovali con una cucitura bianca, quattro pezzi su B2, e dopo uno
  scorrimento di lato ne restava uno spicchio sul filo mentre la sua cella
  era già sotto la fascia, e del quadratino di A5 restavano 4 px. Nessuna
  delle due scelte lo fa.
  - «coperte» (consigliato): la maniglia è della zona del suo angolo, e la
    fascia ferma ne copre la parte che le passa sotto: sul filo se ne vede
    metà, e scorrendo va sotto la fascia con la sua cella, senza ritardo
    perché la sposta lo scorrimento del browser come le celle. La presa
    resta intera. È la regola di tutti gli altri segni.
  - «sopra»: la maniglia intera sopra la fascia finché il suo angolo si
    vede, che è il tondo intero che l'utente vedeva sul filo, senza la
    cucitura. Ma la sposta lo script a ogni scorrimento, quindi corre un
    fotogramma dietro le celle, e quando l'angolo passa sotto la fascia
    torna giù di colpo.

  Risposta (2026-11-05, «seguo i tuoi consigli»): «coperte» (B7).

Le risposte confermano B1–B7 e «coperte»: nessun task cambia, salvo T9
che nasce dalle due preferenze. (Se un giorno si volesse «sopra» per D-8,
cambierebbe solo T3: un segno d'angolo che si vede sale nel livello della
fascia che lo coprirebbe e il gestore di `scroll` lo ridisegna, nel
prototipo `pointSpot` e `pointRect`.)

## Cancello del piano

| Fatto quando | Prova | Task |
|---|---|---|
| scorrendo veloci non si vede mai il bianco: al massimo la carta coi fili | `bench:grid` G2: quattordici rotelle di 900 px, la fascia uniforme più alta di ogni fotogramma ≤ 28 px (una riga; oggi 374); scorrimento a passi di 100 px, zero campioni senza righe | T2 |
| le fasce ferme stanno ferme | `bench:grid` G1: lo scorrimento di lato filmato, la colonna bloccata e le intestazioni delle righe uguali in ogni fotogramma (oggi 12 su 25 diversi) | T1 |
| un intervallo che passa il blocco ha l'altezza giusta e non copre mai una cella bloccata né un'intestazione | `bench:grid` G1, `marks.test.ts` | T1 |
| i segni restano e scivolano; il rettangolo è simmetrico; i segni si leggono in ogni luce | `bench:grid` G3: zero nodi aggiunti o tolti per freccia, i quattro lati uguali e alla stessa distanza dai fili, contrasto dei segni ≥ 3:1 sulla carta nelle quattro luci; `npm run bench:motion` | T3 |
| trascinando col mouse vero la selezione scivola senza salti, i suoi pezzi sono sempre un rettangolo solo, e finisce sotto il puntatore | `bench:grid` G3 `g3-mouse-fitto` (mouse a 1000 Hz, più eventi per fotogramma, avanti e indietro dentro e fuori dal blocco, con la CPU normale e rallentata 4×): in ogni fotogramma zero pezzi in disaccordo, zero numeri oltre il bersaglio o all'indietro, la cella attiva dentro, alla fine la cella sotto il puntatore; `grid-motion.test.ts` con eventi fitti | T3 |
| la cella aperta è la cella | `bench:grid` G4: zero px di scostamento del testo all'apertura, lo stesso carattere della cella, la cella aperta più larga della cella con un testo lungo, il fondo della carta nella luce scura con il testo ≥ 4,5:1 | T4 |
| ciò che si scrive o si tira si vede subito, e un no torna indietro | `bench:grid` G5: il numero a destra nel primo fotogramma dopo Invio, la larghezza nel primo fotogramma dopo il rilascio, l'etichetta della misura dentro il riquadro, il ritorno e l'avviso con un no | T5 |
| il riempimento resta finché il foglio risponde; la copia e il taglio hanno il loro segno; l'incolla si vede subito | `bench:grid` G6 | T6 |
| il quadratino e le maniglie del tocco sono un pezzo solo, intero, anche sul filo del blocco e dopo uno scorrimento | `bench:grid` G1 `g1-quadratino-intero`, G3 `g3-mouse-fitto` (zero fotogrammi con un segno d'angolo diviso o tagliato), G7 `g7-maniglia-sul-filo`; `marks.test.ts` | T1, T3, T7 |
| col dito si scorre e basta | `bench:grid` G7 col tocco: un trascinamento scorre senza intervallo, un tocco sceglie, due aprono, il tocco lungo mette due maniglie | T7 |
| la griglia si muove con `moto/` e con «ridotto» quasi si ferma | `npm run bench:motion` con le coreografie della griglia; `bench/motion.test.ts` con `src/editors/grid/**` nell'elenco | T3–T7 |
| il segno della copia e la velocità della selezione si scelgono in Impostazioni, di norma come il prototipo, e una scelta vale subito senza riaprire il foglio | `grid-motion.test.ts` (ogni scelta, il cambio a griglia aperta, «ridotto» che vince), `catalogs.rs` di fub-host, la riga in Impostazioni guardata nelle due luci | T9 |
| le foto del banco somigliano al prototipo | le scene `grid-*` nelle due luci, piena, 700 px e telefono, confrontate col prototipo; `bench:a11y` e `theme:verify` verdi; le baseline nuove dal runner | T8 |

## Regole che valgono per ogni task

- Lo stato cambia sempre prima, e il movimento lo segue: lo stato finale,
  con il movimento e senza, è lo stesso al pixel. Ogni corsa vive in
  `editors/grid/grid-motion.ts` e nel `Lifetime` della griglia: quando la
  griglia si smonta non resta niente (`check-listeners`).
- Niente transizioni né animazioni CSS: dentro `.pane-editor` le spegne
  `skin/motion.css`. Si muovono solo `transform` e `opacity`.
- Le costanti di `moto/spring.ts` e `moto/level.ts` non si toccano.
- Le classi `selected`, `active`, `grid-row`, `grid-cell` e `grid-header`
  restano dove sono: le pelli di terzi le vestono (`ui/sanitize-css.test.ts`,
  `gridHooks`). Ogni classe nuova che la pelle veste ha il suo hook in
  `theme/scrittoio/anatomia/editors.ts` (voce `grid-surface`, con il suo
  livello: i segni sono «segno»), nello stesso task; ogni hook che sparisce
  esce dall'anatomia nello stesso task.
- Il core resta il padrone dei valori, delle larghezze e delle revisioni:
  ciò che la griglia mostra prima della risposta è un'anteprima, e una
  risposta vecchia non scrive mai sopra un gesto più nuovo.
- Niente IPC per battuta, niente lavoro nuovo nell'host: questo piano tocca
  solo il client, salvo le due voci delle preferenze di T9 in
  `crates/fub-host/src/settings.rs` (chiavi, scelte e stringhe), senza
  porte nuove.
- CodeMirror resta dentro `editors/text/` (`check-codemirror-boundary`).
- Ogni task aggiunge i suoi controlli a `bench/grid-gestures.mjs` con la sua
  sigla (G1…G7) e la mette in `ACCESI`; i controlli che ci sono già (d34…d47,
  q14) restano verdi, e se leggono una classe che sparisce si cambia il
  selettore, non ciò che controllano.
- Ogni task aggiorna la sua parte di `docs/architecture/grid-surface.md`.
- Le baseline del banco non si rifanno in locale: le prende l'orchestratore
  dal runner.
- Non scrivere numeri non misurati.
- Mai il vault reale (`~/.cache/fub-live/vault-tutti/`), mai la 1432.

## T1 · Il piano a strati e le fasce ferme

Perché: i difetti 2, 3 e 16. Oggi lo script rimette a mano le fasce ferme a
ogni scorrimento, un fotogramma dopo, e ogni riga è un contesto di
sovrapposizione a sé: i segni non si ordinano con le fasce.
Tocca: `apps/client/src/editors/grid/engine.ts` (il disegno, `#columnLeft`,
`#rangeBox`, `#freezeLines`, `#place` dei segni), `editors/grid/marks.ts` e
`marks.test.ts` (nuovi), `editors/grid/engine.test.ts`,
`theme/scrittoio/structure.css` (la geometria della griglia),
`theme/scrittoio/anatomia/editors.ts`, `theme/scrittoio/skin.css`
(`npm run theme:generate`), `apps/client/bench/grid-gestures.mjs`,
`bench/fake-ipc.ts` e `bench/scene.mjs` (la cartella grande),
`docs/architecture/grid-surface.md` («La griglia»).
Non toccare: `skin/editors.css` (i colori dei segni sono di T3); la barra dei
fogli e il suo CSS (K3); `moto/`; il modello della cartella
(`workbook.ts`, `model.ts`, `merges.ts`).
Dipende da: K3 T19 integrato
Cosa fare:
- Il piano: un elemento grande quanto il foglio, una griglia CSS a una sola
  cella dove gli strati stanno uno sopra l'altro (la carta di T2, le righe
  del corpo, i livelli dei segni, la testa). La testa (la riga delle
  intestazioni e le righe bloccate) è `sticky` in alto; le intestazioni delle
  righe e le celle delle colonne bloccate sono `sticky` a sinistra dentro la
  loro riga; l'angolo è tutte e due. Le righe non hanno più `z-index`: celle,
  segni e fasce si ordinano nel piano. Nessuno script rimette a posto le
  fasce allo scorrimento: `#columnLeft`, `#rangeBox` e `#freezeLines` non
  sommano più `scrollLeft` né `scrollTop`.
- I livelli dei segni, uno per zona: il corpo (scorre), la testa (scorre
  solo di lato), la colonna ferma (scorre solo in giù), l'angolo (non
  scorre); ognuno taglia ciò che esce dalla sua zona, e le fasce opache
  coprono ciò che passa loro sotto. Ogni zona ha anche il suo livello «lift»
  (la cella aperta di T4, e i segni d'angolo: il quadratino, le maniglie
  del tocco di T7). La guida e la misura di un bordo tirato stanno in
  `.grid-fixed`, fermo nell'angolo del riquadro.
- `editors/grid/marks.ts`, puro: dato un rettangolo nelle coordinate del
  piano e la misura delle fasce ferme, dà i pezzi per zona, già tagliati.
  Un segno d'angolo (il quadratino, le maniglie del tocco) invece non si
  taglia (B7): è un pezzo solo, intero, nel livello «lift» della zona del
  suo angolo (`cornerZone`: un angolo d'inizio, in alto o a sinistra, è
  nella fascia ferma se sta prima del filo, uno di fine anche se sta sul
  filo), e la fascia ferma ne copre ciò che le passa sotto. `cornerSeen` dice
  dove si vede l'angolo nel riquadro, o che non si vede perché è passato
  sotto una fascia. Tagliato per zona come un lato, un tondo sul filo
  diventava due ovali con una cucitura bianca, e dopo uno scorrimento di
  lato ne restava uno spicchio sul filo (la settima causa in
  `DECISIONS.md`). `marks.test.ts` lo prova con un intervallo tutto nel
  corpo, uno che passa la riga bloccata, uno che passa la colonna bloccata,
  uno in tutte e quattro le zone, con zero righe o colonne bloccate, e coi
  segni d'angolo: un angolo d'inizio e uno di fine sullo stesso filo (B5 e
  A5 con la colonna A bloccata, B2 con la riga e la colonna), un pezzo solo
  e intero per segno, e dopo uno scorrimento di lato l'angolo d'inizio di B5
  sotto la fascia (`cornerSeen` dice che non si vede), quello di fine di A5
  ancora sul filo.
- I segni di oggi (la selezione, il quadratino, il riempimento, il taglio,
  lo spostamento, i riferimenti della formula, i fili del blocco) passano per
  `marks.ts` e vanno nel livello della loro zona. Restano rifatti a ogni
  disegno come oggi: li fa restare T3.
- I fili del blocco diventano segni fermi nei livelli della testa, della
  colonna e dell'angolo.
- Una cartella grande per il banco: in `bench/fake-ipc.ts`, accanto a
  `Dati/Conti.xlsx`, una sessione costruita in codice con la forma di
  `src/__fixtures__/xlsx-grid.json` (3000 righe × 20 colonne,
  `frozen_rows: 1`, `frozen_columns: 1`, numeri, date, testi lunghi che
  passano nelle celle accanto), e una scena `grid-large` in `scene.mjs` che
  la apre. Niente fixture scritta a mano dal Rust.
- In `bench/grid-gestures.mjs`, sigla G1, sulla scena `grid-large`:
  `g1-colonna-ferma` (lo scorrimento di lato filmato come d42, 1200 px a
  destra e di nuovo indietro: la colonna bloccata e le intestazioni delle
  righe, ritagliate, uguali al primo fotogramma in ogni fotogramma) e
  `g1-intervallo-oltre-il-blocco` (C1:E9 scorso in giù di 300 px: l'altezza
  del rettangolo, sommata sulle zone, uguale a quella delle righe 1–9 meno
  ciò che sta sotto la riga bloccata; nessun pezzo del rettangolo sopra una
  cella della colonna A o un'intestazione di riga, letto con
  `elementsFromPoint`), e `g1-quadratino-intero` (A5, sul filo della
  colonna bloccata, e B1, su quello della riga: il quadratino è un elemento
  solo di 8×8 col centro sul filo, e lo resta dopo 40 px di scorrimento, di
  lato per A5 e in giù per B1; nel prototipo di prima di A5 restavano 4 px).
- `d45-un-rettangolo` legge `.grid-selection`: si cambia il selettore se
  la classe cambia, e il controllo resta «un rettangolo solo».
- `grid-surface.md`, «La griglia»: il piano, le zone, chi taglia i segni.
Dal prototipo: i blocchi `→ structure.css (T1 e T2: il piano della griglia)`
e `→ structure.css (T2 e T3: i livelli dei segni)`, `buildNuova`,
`layoutColumns`, `makeRow`, `clipRect`, `cornerZone`, `cornerSeen` e
`wholeRect` dello script.
Casi limite: più righe e più colonne bloccate; nessuna bloccata (la testa
è solo la riga delle intestazioni); righe di altezza diversa; colonne e
righe nascoste (larghezza zero); un'unione che passa il filo del blocco;
gli oggetti (grafici, immagini) ancorati nella zona ferma o nel corpo, nel
livello della loro zona; lo zoom della cartella; un foglio senza fili
(`no-gridlines`); un foglio sotto i 900 px e il telefono; la finestra di un
documento; più intervalli (`#others`); i riferimenti colorati della formula;
l'ordine per chi legge: la testa può stare prima del corpo nel DOM, perché
`z-index` e `sticky` la tengono sopra comunque, e gli `aria-rowindex`
restano giusti; il cambio di foglio e il blocco tolto o messo mentre si
guarda.
Fatto quando: `g1-colonna-ferma` vede zero fotogrammi diversi (oggi 12 su
25); `g1-intervallo-oltre-il-blocco` vede l'altezza giusta (oggi circa
cinque righe in più) e nessun pezzo sopra le fasce; `marks.test.ts` e
`engine.test.ts` verdi; `npm run bench:grid` verde con G1 acceso;
`npm run bench:a11y` verde; `npm run typecheck`, `npm run theme:verify` e
`check-listeners` verdi.
Prova: scripts/check.sh --rapido, poi `npm run bench:grid` e
`npm run bench:a11y`
Stato: [x] fatto

## T2 · La carta sotto le celle e le righe che restano

Perché: i difetti 1 e 13. Lo scorrimento veloce arriva prima del disegno: il
margine è di due righe e sotto non c'è niente, quindi si vede il bianco; e
ogni disegno rifà tutte le celle.
Tocca: `editors/grid/engine.ts` (il gestore dello scorrimento,
`#scheduleRender`, `#render`, `#renderedIndices`, `GRID_OVERSCAN`),
`engine.test.ts`, `theme/scrittoio/structure.css` e `skin/editors.css` (la
carta e i suoi fili), l'anatomia, `skin.css` (generato),
`bench/grid-gestures.mjs`, `grid-surface.md` («La griglia»).
Non toccare: i segni (T3); il caricamento delle finestre di celle
(`#loadViewport`: chiede ciò che chiede oggi, con lo stesso margine di
richieste); `moto/`.
Dipende da: T1
Cosa fare:
- La carta: sotto le righe, nel piano, la carta del file coi suoi fili (i fili
  delle righe in un gradiente che si ripete con l'altezza di serie, i fili
  delle colonne come elementi sottili alle posizioni di `#columns.offsets`),
  e la sua copia nelle fasce ferme (`.grid-paper-top`, `-left`, `-corner`).
  Le celle sono opache, perché il filo della carta non si sommi al loro.
  Dove una riga non è ancora disegnata si vede la griglia vuota, mai il
  bianco. Con le righe di altezza diversa la carta segue l'altezza di serie:
  la differenza dura un fotogramma e sta sotto righe che arrivano.
- Il disegno delle righe nel gestore dello scorrimento, non in un
  `requestAnimationFrame` dopo: così le righe nuove ci sono già nel
  fotogramma che le mostra. Il fotogramma chiesto resta per tutto il resto
  (i cambi della cartella, le misure).
- Il margine: un riquadro intero sopra e sotto, e uno a sinistra e a destra
  per le colonne, al posto di `GRID_OVERSCAN = 2`.
- Le righe che restano: una mappa per indice di riga; uno scorrimento
  aggiunge e toglie righe solo ai bordi; un salto (Ctrl+Fine, «Vai a») le
  rifà tutte. Una cella cambia solo se cambia ciò che mostra (il valore, lo
  stile, lo stato, la larghezza): si riconosce per chiave e si aggiorna sul
  posto, senza un elemento nuovo.
- La cella con l'editor aperto resta disegnata anche fuori dal margine,
  come oggi (`editingPosition` di `#renderedIndices`).
- In `bench/grid-gestures.mjs`, sigla G2, sulla scena `grid-large`:
  `g2-scorrere-senza-bianco` (quattordici rotelle di 900 px a 16 ms l'una,
  filmate: per ogni fotogramma la fascia più alta di righe di pixel tutte
  uguali nell'area delle celle, a destra della colonna bloccata e sotto la
  testa; il metodo di `sonde/moti.cjs`, `scorri`) e
  `g2-righe-ai-bordi` (scorrimento a passi di 100 px: in ogni campione la
  parte del riquadro senza una riga disegnata, e i nodi `.grid-row` e
  `.grid-cell` aggiunti e tolti, con un `MutationObserver`, contro quelli
  entrati e usciti dal margine).
- Il tempo del gestore dello scorrimento, misurato sul banco prima e dopo
  (il novantesimo percentile e il peggiore in `g2-scorrere-senza-bianco`):
  i numeri nel rapporto e in `grid-surface.md`; la soglia la fissa
  l'orchestratore con la prima misura.
- `grid-surface.md`, «La griglia»: la carta, il margine, le righe che
  restano.
Dal prototipo: il blocco `→ structure.css (T1: la carta)`, `renderRows`
dello script.
Casi limite: righe alte diverse e righe nascoste; un foglio piccolo (meno
righe di un riquadro); l'ultima riga e l'ultima colonna del foglio; un
foglio senza fili (la carta senza fili, solo il fondo); l'aspetto adattato
(la carta del tema); lo zoom; il cambio di foglio a metà scorrimento; una
finestra di celle che arriva dopo lo scorrimento (le celle si riempiono
sul posto); la rotella col fuoco nell'editor (d37); il telefono (lo
scorrimento a inerzia).
Fatto quando: `g2-scorrere-senza-bianco` vede in ogni fotogramma una fascia
uniforme ≤ 28 px (oggi fino a 374 px in 16 fotogrammi su 32);
`g2-righe-ai-bordi` vede zero campioni senza righe e nessuna riga rifatta
dentro il margine; d42 resta verde; `npm run bench:grid` verde con G2
acceso; `engine.test.ts` e `npm run typecheck` verdi.
Prova: scripts/check.sh --rapido, poi `npm run bench:grid`
Stato: [x] fatto (2026-11-09: carta e righe nel gestore; tetti per giro `GRID_FRAME_REFILLS` 48, `GRID_FRAME_NEW_ROWS` 3, fascia 0,1; gestore p90 ≤ 8,5 ms, peggiore ≤ 20 ms, fotogramma ≤ 16,5 ms; a11y scuro col rosso di `live-16-elenco-a-capo`, non della griglia)

## T3 · I segni che restano e scivolano

Perché: i difetti 4, 5 e 15, e il movimento che l'utente chiede: senza
scatti, un po' più svelto, e mai una selezione a pezzi o sbagliata (le
«Assunzioni»; col puntatore il modo «scivola», D-7). Oggi un segno che si sposta è un nodo nuovo, il
rettangolo non è simmetrico, e nelle luci scure l'accento chiaro sulla carta
bianca quasi non si vede.
Tocca: `editors/grid/marks.ts` e `marks.test.ts`, `editors/grid/engine.ts`
(il disegno dei segni, `#reconcile`, `DRAWN`; `#dragTo`, il gestore di
`scroll` ed `#endDrag` per il puntatore), `editors/grid/grid-motion.ts`
e `grid-motion.test.ts` (nuovi), `engine.test.ts`,
`theme/scrittoio/structure.css` e `skin/editors.css` (i segni), l'anatomia,
`skin.css` (generato), `apps/client/bench/motion.test.ts` (l'elenco e
`STARTS`), `bench/motion-rules.mjs`, `bench/grid-gestures.mjs`,
`grid-surface.md` («La selezione e il riempimento»).
Non toccare: le costanti di `moto/`; la cella aperta (T4); la risposta del
foglio (T5); il riempimento, la copia e il taglio oltre al loro aspetto di
oggi (T6).
Dipende da: T2
Cosa fare:
- I pezzi di ogni segno ci sono sempre, per zona e per nome (i quattro lati
  del rettangolo, l'anello della cella attiva, il velo, le fasce delle
  intestazioni, il quadratino, i fili del blocco): un cambio di selezione li
  sposta, non li ricrea. Un pezzo che non serve si nasconde. `#reconcile` e
  `DRAWN` non trattano più i segni; le righe e le celle restano per chiave.
- Il rettangolo: ogni lato è largo 2 px, uno sul filo della griglia e uno
  dentro, uguale sui quattro lati. Con più celle, la cella attiva ha un
  anello sottile e il resto un velo. Le intestazioni della selezione hanno
  la loro fascia nei livelli della testa e della colonna; la classe
  `selected` resta sull'intestazione.
- Il colore: `--grid-mark` sulla `.grid-viewport`, l'inchiostro del cursore
  della carta (`--paper-caret`) con la carta del file, che resta chiara in
  ogni luce, e `--accent` con l'aspetto adattato. Il bordo del quadratino è
  la carta, non `--sheet`. I colori forzati usano `Highlight`.
- Il movimento dei segni, in `editors/grid/grid-motion.ts`, il solo modulo
  della griglia che li muove, è **un motore solo**, come «Il motore dei
  segni» del prototipo, non una corsa per pezzo. Tiene il bersaglio
  (`want`: i dieci numeri della selezione `[bL, bT, bR, bB, aL, aT, aR, aB,
  hR, hB]` in coordinate della griglia, cioè il rettangolo, la cella attiva
  e l'angolo del quadratino; la molla; se l'ultimo aggiornamento viene dal
  puntatore; se si tira il riempimento) e ciò che si vede (`view`: i dieci
  numeri e la loro velocità in px al secondo). Un evento (un tasto, il
  puntatore, un comando, lo scorrimento sotto un trascinamento) cambia
  soltanto `want` e ridisegna i pezzi da `view`: dentro un evento non avanza
  niente. Avanza un ascoltatore di `onFrame` (`moto/ticker.ts`), iscritto
  finché i numeri non sono arrivati e tolto appena arrivano: una volta per
  fotogramma, con `elapsed` (già ristretto fra 0 e 100 ms), applica le
  regole qui sotto, fa un passo di `advanceSpring` per numero e ridisegna da
  `view` tutti i pezzi di tutti i livelli. Così il moto non dipende da
  quanti eventi arrivano in un fotogramma (fino a 37 col mouse a 1000 Hz
  nelle sonde), i pezzi non possono essere in disaccordo, e ciò che si
  disegna in un fotogramma è ciò che il browser dipinge. Non `springValue`:
  dieci valori indipendenti non tengono le regole fra loro e conservano la
  velocità quando il bersaglio cambia. Niente fotogrammi WAAPI (`animate`,
  `flip`) per i segni che scivolano: corse cancellate e ripianificate a ogni
  cambio di cella erano la causa dei salti (`DECISIONS.md`).
- Le regole del passo, nell'ordine, uguali per il puntatore, i tasti e i
  comandi (il modo «scivola», D-7):
  1. per ognuno degli otto numeri del rettangolo e della cella attiva: una
     velocità che porta lontano dal bersaglio si azzera (un bersaglio nuovo
     dall'altra parte non fa mai tornare indietro); quella verso il
     bersaglio non supera la radice lenta della molla per la distanza che
     manca (`slowRoot`: 35/s per `GLIDE`, 25/s per `SLIDE`), da cui una
     molla sovrasmorzata arriva senza passarlo; dopo il passo, un numero che
     avrebbe passato il bersaglio, o fermo per `springAtRest` a `REST_PX`,
     sta esattamente sul bersaglio con velocità zero;
  2. il contenimento: su un lato dove la cella attiva esce dal rettangolo,
     il rettangolo la raggiunge se il suo bersaglio sta oltre di lei,
     altrimenti la cella attiva si ferma sul lato;
  3. il quadratino sta sull'angolo del rettangolo, o salta all'angolo del
     riempimento mentre lo si tira.
  Quindi ogni numero va al bersaglio senza superarlo e senza tornare
  indietro e la cella attiva sta sempre dentro; col puntatore un lato che
  cala ci mette un attimo ad arrivare (B5). Un gesto nuovo a metà corsa riparte dalla posa e
  dalla velocità correnti, anche col tasto tenuto giù.
- Il disegno (`draw`): ogni pezzo d'area (i lati, l'anello, il velo, le
  fasce delle intestazioni), in ogni livello dove cade, sta fermo nel suo
  rettangolo d'arrivo (`marksParts` del bersaglio, tagliato con `clipRect`
  di `marks.ts`), e un `transform` (`translate` e `scale` dall'angolo) lo
  porta al rettangolo che dice `view`, tagliato al bordo della zona
  (`loose`): un
  pezzo che passa il filo del blocco esce dal filo invece di comparire già
  grande, e uno che ne esce ci rientra. Si scrive solo ciò che cambia. Un
  pezzo senza riposo nel bersaglio (l'anello e il velo di una cella sola, un
  pezzo che esce da una zona) resta sull'ultimo riposo che aveva e si
  nasconde quando i numeri arrivano; uno senza riposo che non si vedeva non
  compare. Così l'anello e il velo crescono dal bordo e ci rientrano invece
  di comparire e sparire. Un pezzo che compare già al suo posto si dissolve
  in `DURATION.state` (`animate` sulla sola `opacity`, che non tocca il
  `transform` del motore); uno che non serve più si nasconde subito. I
  tratteggi e le formiche non scivolano.
- I segni d'angolo (il quadratino, le maniglie del tocco di T7) non si
  tagliano (B7): un elemento solo, intero, nel livello «lift» della zona
  dove `view` mette il suo angolo (`cornerZone` di T1), scelto a ogni
  fotogramma; il `transform` lo porta dall'angolo d'arrivo a quello di
  `view` (le maniglie crescono dal centro). Nel fotogramma in cui l'angolo
  passa il filo l'elemento cambia livello e tiene la sua corsa (una maniglia
  che sta crescendo continua, non ricompare). Il quadratino si prende dove
  si vede il suo angolo (`cornerSeen`), entro `FILL_SLOP` px dall'angolo,
  anche sulla metà che una fascia copre, e mai quando l'angolo è passato
  sotto la fascia (nel prototipo `hit`). In `#pointerDown` e nel doppio clic
  (riempire in giù) decide questa prova, non il bersaglio del DOM, che sul
  filo dipende da chi copre chi; il titolo `grid.fill.handle` resta. Lo
  prova `g3-quadratino-coperto`: B5, scorso di lato finché l'angolo del
  quadratino è 2 px oltre il filo, si tira dal quadratino e riempie; scorso
  finché l'angolo è 20 px sotto la fascia, lo stesso gesto parte dalla cella
  della fascia e non riempie.
- Saltano al bersaglio, con `view` uguale a `want`: `glide: false` (il
  cambio di foglio, una selezione rimessa dall'host), il livello «ridotto»
  di `motionLevel()` o un motore `instant`, come in `springValue` (non si
  iscrive nessun ascoltatore; «ridotto» acceso a metà corsa porta `view` al
  bersaglio al primo aggiornamento o fotogramma e ridisegna). Nel livello calmo la molla è
  `springFor(…, calm)`, che per `GLIDE` e `SLIDE` non cambia (sono già
  sovrasmorzate). Il modulo prende il `Lifetime` della griglia: lo
  smontaggio toglie l'ascoltatore e ferma le dissolvenze (`halt`).
- Il puntatore, in `engine.ts`: lo stesso `#dragTo` serve il movimento, lo
  scorrimento e il rilascio. Con un trascinamento in corso il gestore di
  `scroll` rifà `#dragTo` all'ultimo punto (sotto il puntatore fermo passa
  un'altra cella), e `#endDrag` col commit lo rifà al punto del `pointerup`
  prima di chiudere: la selezione finisce sempre sulla cella sotto il
  puntatore. Oggi lo rilegge solo lo scorrimento automatico, non la rotella
  né il rilascio. Il motore non distingue il puntatore dai tasti (D-7).
- `bench/motion.test.ts`: `../src/editors/grid/**/*.ts` entra nell'elenco
  dei sorgenti, e `STARTS` prende anche `onFrame(` (oggi non lo cerca, e un
  moto per fotogramma passerebbe senza coreografia; fuori da `moto/` non lo
  chiama ancora nessuno). `grid-motion.ts` ha le sue coreografie in
  `motion-rules.mjs` (`sources: ["src/editors/grid/grid-motion.ts"]`): la
  freccia, Maiusc+freccia, Ctrl+freccia (un salto lontano), e il
  trascinamento che allarga col puntatore. `UNCOVERED` resta vuoto.
  `activeMotions()` conta anche gli ascoltatori di `onFrame`, quindi
  «niente di vivo a corsa finita» vale anche per il motore.
- `grid-motion.test.ts`, col motore manuale di `moto/`
  (`createManualDriver`, i cui fotogrammi servono anche `onFrame`; per i
  fotogrammi irregolari un motore che tiene la richiesta e la chiama
  all'istante scelto, come fa `value.test.ts`) e la geometria del
  prototipo, prova il motore con eventi fitti, come `sim.mjs` del
  pianificatore (in `/home/fubeo/.cache/fub-k1/tmp/griglia-moto3/`): gesti
  casuali con un seme fisso (trascinamenti avanti e indietro con salti di
  molte celle, clic e Maiusc+clic, intestazioni, frecce, Ctrl+frecce e
  pagine), da 1 a 20 eventi per fotogramma, fotogrammi regolari e
  irregolari (16,7 ms e 33–100 ms), col puntatore e coi tasti, con `GLIDE`
  e `SLIDE`. In ogni fotogramma: nessun numero oltre il
  bersaglio né più lontano di prima; la cella attiva dentro il rettangolo;
  il quadratino sull'angolo. A gesto finito tutti i numeri sono
  esattamente sul bersaglio e l'ascoltatore non c'è più. La stessa linea
  del tempo con tutti gli eventi o con solo l'ultimo di ogni fotogramma dà
  lo stesso moto, numero per numero. Con «ridotto» nessun ascoltatore si
  iscrive (`frameListeners()`), e lo smontaggio non lascia niente. Il test
  deve fallire se si toglie l'azzeramento della velocità all'indietro (la
  regola che le sonde hanno visto mancare). Un caso col filo: un trascinamento da B5 ad A5 e ritorno, e il
  livello del quadratino che cambia nel fotogramma stesso in cui il suo
  angolo passa il filo.
- In `bench/grid-gestures.mjs`, sigla G3: `g3-frecce-senza-nodi` (cinque
  frecce e cinque Maiusc+freccia con un `MutationObserver` sui livelli dei
  segni e sulle intestazioni: zero nodi aggiunti o tolti; oggi intestazioni
  ×10, angolo ×5, quadratino ×5 per cinque frecce), `g3-lati-simmetrici`
  (i quattro lati del rettangolo su B2:C5: stessa larghezza, e la stessa
  distanza dai fili delle celle su ogni lato) e `g3-contrasto-dei-segni`
  (il colore calcolato di un lato contro la carta sotto, nelle quattro luci
  e coi due aspetti: ≥ 3:1). E `g3-mouse-fitto`, come `probe5.mjs` e
  `analyze5.mjs` del pianificatore: il mouse dal CDP
  (`Input.dispatchMouseEvent`) a 1000 Hz senza aspettare le risposte, quindi
  più `pointermove` per fotogramma; trascinamenti avanti e indietro dentro e
  fuori dalla colonna e dalla riga bloccate, la rotella durante il
  trascinamento, Maiusc+clic e frecce svelte; a 1280 e a 390 px, con la CPU
  normale e rallentata 4× (`Emulation.setCPUThrottlingRate`). Un
  `ResizeObserver` su una sentinella che un rAF cambia legge, dopo i rAF e
  prima del dipinto, il rettangolo di ogni pezzo visibile di ogni livello in
  coordinate della griglia, e il bersaglio. In ogni fotogramma: tutti i
  pezzi danno lo stesso rettangolo (entro 0,5 px), nessun lato oltre il
  bersaglio o all'indietro, il velo e l'anello dentro il bordo, e ogni segno d'angolo un pezzo solo,
  intero (8×8 il quadratino), nel livello della zona del suo angolo
  (tagliati per zona, nelle sonde erano divisi o tagliati da 464 a 1586
  fotogrammi per giro); a gesto finito la selezione è la cella sotto il
  puntatore.
Dal prototipo: i blocchi `→ structure.css (T2 e T3: i livelli dei segni)`
(i segni dentro) e `→ skin/editors.css (T3: i segni)`; `pool`,
`shownMarks`, `run` e «Il motore dei segni» dello script, `dragTo` e il
gestore di `scroll`, `hit` col quadratino che si vede; le costanti in cima
allo script.
Casi limite: più intervalli (`#others`); i riferimenti colorati della
formula, che seguono la formula e non scivolano; lo spostamento col bordo
(q14); un'unione nella selezione (il rettangolo prende l'unione); righe e
colonne nascoste; la selezione di tutta una colonna, di tutta una riga, di
tutto il foglio; un rettangolo che entra ed esce dalla zona ferma a metà
corsa (i pezzi delle due zone corrono insieme); la selezione che esce dal
margine disegnato e rientra; il cambio di foglio (niente scivola fra due
fogli); il quadratino sul filo del blocco, e uno che lo passa a metà
corsa; un trascinamento che inverte più volte nello stesso fotogramma; il
puntatore fermo mentre la griglia scorre (la rotella o lo scorrimento
automatico); il rilascio fuori dalla griglia; una scheda nascosta a metà
corsa (`elapsed` resta entro 100 ms); «ridotto» acceso a metà corsa; il
livello calmo; i colori forzati; il contrasto alto.
Fatto quando: `g3-frecce-senza-nodi` vede zero nodi; `g3-lati-simmetrici`
vede quattro lati uguali e la stessa distanza dai fili (±0,5 px);
`g3-contrasto-dei-segni` vede ≥ 3:1 in ogni luce e aspetto (oggi circa 2,3:1
nella luce scura); `g3-quadratino-coperto` verde; `npm run bench:motion`
verde con le coreografie nuove (stato finale uguale con e senza movimento,
solo `transform` e `opacity`, niente di vivo a corsa finita, si torna
indietro a metà); `motion.test.ts` verde con la griglia nell'elenco e
`onFrame` in `STARTS`; `g3-mouse-fitto` vede zero fotogrammi con pezzi in
disaccordo, numeri oltre il bersaglio o all'indietro, il velo fuori dal
bordo, né segni d'angolo divisi o
tagliati, e la cella sotto il puntatore a ogni gesto finito, nei quattro
giri (1280 e 390 px, CPU 1× e 4×); `grid-motion.test.ts` verde con le prove
qui sopra (eventi fitti, «ridotto», smontaggio), e rosso senza
l'azzeramento della velocità all'indietro; d45 verde; `check-listeners`, `npm run typecheck` e
`theme:verify` verdi.
Prova: scripts/check.sh --rapido, poi `npm run bench:grid` e
`npm run bench:motion`
Stato: [ ] da fare

## T4 · La cella aperta è la cella

Perché: i difetti 6, 7 e 14. Aprire una cella cambia il carattere, sposta il
testo di 11 px, la chiude nella sua larghezza e, di notte, le mette attorno un
fondo che non è la carta.
Tocca: `editors/grid/engine.ts` (`#startEditing`, `#positionEditor`, il
posto dell'editor), `editors/grid/grid-motion.ts`, `engine.test.ts`,
`editors/text/theme.ts` (una variabile per il carattere del campo, vedi
sotto) e il suo test, `theme/scrittoio/structure.css` e `skin/editors.css`
(`.grid-cell-editor`), l'anatomia, `skin.css` (generato),
`bench/motion-rules.mjs`, `bench/grid-gestures.mjs`, `grid-surface.md`
(«Scrivere nelle celle»).
Non toccare: la barra della formula (resta in `var(--font-mono)`); il modo
in cui si scrive e si conferma (d34–d40, d46); il puntatore (T7).
Dipende da: T3
Cosa fare:
- La cella aperta sta nel livello «lift» della zona della cella, non dentro
  la cella: così esce dalla cella e dalla zona. Il testo sta dove stava nella
  cella: stesso carattere, stessa misura, stesso allineamento, stessa carta;
  la cornice (2 px di `--grid-mark`, l'ombra) è un pezzo a parte attorno.
- Il carattere: in `editors/text/theme.ts` il carattere di `.cm-content`
  diventa `var(--field-font, var(--font-mono))`, e la griglia mette
  `--field-font` sulla cella aperta al carattere della cella. Per ogni altro
  editor di testo non cambia niente. La riga attiva non ha tinta nella
  cella aperta (lo dice la griglia col suo CSS, o un'opzione del campo).
  CodeMirror resta dentro `editors/text/`.
- La misura: la cella aperta cresce a destra a colonne intere finché il
  testo ci sta, fino al bordo del riquadro (B2); poi va a capo e cresce in
  giù fino a metà del riquadro, poi scorre dentro. Una cella allineata a
  destra cresce a sinistra. Si misura a ogni cambio della bozza, senza IPC.
- La cornice compare con `enter` in `DURATION.state` (90 ms), e il resto
  della cella aperta è subito al suo posto; con «ridotto» resta la
  dissolvenza. Una coreografia in `motion-rules.mjs`: F2 su una cella con un
  testo lungo.
- Nella luce scura la cella aperta ha la carta del file e il suo inchiostro,
  come la cella: niente `--bg-elev`, niente striscia chiara.
- In `bench/grid-gestures.mjs`, sigla G4: `g4-testo-fermo` (la posizione del
  primo carattere prima e dopo F2, e il carattere calcolato: zero px, lo
  stesso), `g4-cresce` (F2 su A5 col testo lungo: la cella aperta più larga
  della cella, larga un numero intero di colonne, dentro il riquadro; un
  testo più lungo del riquadro va a capo) e `g4-luce-scura` (il fondo della
  cella aperta uguale alla carta, il contrasto del testo ≥ 4,5:1).
Dal prototipo: il blocco `→ structure.css e skin/editors.css (T4: la cella
aperta)`, `placeEditor` e `openEditor` dello script.
Casi limite: la cella in una colonna bloccata o nella riga bloccata (cresce
dentro la sua zona e oltre, nel livello «lift»); una cella unita; una cella
vicino al bordo destro (cresce a sinistra se a destra non c'è posto) o in
fondo al riquadro; Alt+Invio (a capo nella cella); la composizione e i tasti
morti (d46); la rotella mentre si scrive (d37); lo scorrimento con la cella
aperta (la cella aperta scorre con la sua zona); una formula coi riferimenti
colorati; il cambio di luce o di zoom con la cella aperta; il telefono; un
testo da destra a sinistra; il contrasto alto e i colori forzati.
Fatto quando: `g4-testo-fermo` vede zero px e lo stesso carattere (oggi +11
px e IBM Plex Mono); `g4-cresce` vede la cella aperta più larga della cella
(oggi chiusa nei suoi 176 px) e a colonne intere; `g4-luce-scura` vede la
carta e ≥ 4,5:1; d34–d40, d46 verdi; `npm run bench:motion` verde con la
coreografia nuova; i test di `editors/text/` verdi; `npm run typecheck` e
`check-codemirror-boundary` verdi.
Prova: scripts/check.sh --rapido, poi `npm run bench:grid` e
`npm run bench:motion`
Stato: [ ] da fare

## T5 · Ciò che si scrive o si tira si vede subito

Perché: i difetti 8 e 9. Un numero resta a sinistra e una colonna tirata
torna indietro per più di un secondo, finché il foglio non risponde.
Tocca: `editors/grid/engine.ts` (`#showWritten`, il bordo tirato, la misura
del bordo, l'avviso), `editors/grid/grid-motion.ts`, `engine.test.ts`,
`editors/grid/workbook.ts` (solo se la regola del numero sta lì, accanto a
`localInput` e `fileInput`), `bench/motion-rules.mjs`,
`bench/grid-gestures.mjs`, `grid-surface.md` («Scrivere nelle celle»,
«La griglia»).
Non toccare: il comando `home.columnWidth` e quello dell'altezza (si
chiamano come oggi); l'host e il motore; il riempimento (T6).
Dipende da: T4
Cosa fare:
- Il numero: `#showWritten` mostra come numero, allineato come un numero,
  una battuta che nella forma del file (`fileInput`) è un numero semplice
  (segno, cifre, un separatore decimale); tutto il resto resta testo come
  oggi. Una formula (`=…`) resta com'è scritta, tenue (lo stato `stale` che
  c'è già), finché il foglio non dà il valore, che compare con una
  dissolvenza di `DURATION.state`. Il valore che torna dal foglio vince
  sempre, anche se l'anteprima era diversa.
- Il bordo tirato: al rilascio la larghezza (o l'altezza) nuova vale subito
  nelle misure della griglia, come anteprima; le colonne dopo scivolano al
  posto nuovo (`flip`, molla `SLIDE`, con la velocità della corsa di prima). Se il foglio dice di no, la misura
  torna com'era scivolando e l'avviso dice perché (le frasi di oggi). Ogni
  anteprima ha il suo numero: una risposta che arriva dopo un altro gesto
  sullo stesso bordo non lo annulla.
- La misura del bordo (l'etichetta) sta dentro il riquadro: a destra del
  bordo, o a sinistra quando a destra non c'è posto.
- Coreografie in `motion-rules.mjs`: il bordo tirato e rilasciato; il no che
  torna indietro.
- In `bench/grid-gestures.mjs`, sigla G5: `g5-numero-a-destra` («42», Invio:
  nel primo fotogramma dopo Invio il testo della cella è allineato a destra),
  `g5-larghezza-subito` (il bordo di C tirato di 60 px e rilasciato: in ogni
  fotogramma dopo il rilascio la colonna è larga quanto al rilascio, e dopo
  la risposta resta così), `g5-misura-dentro` (un bordo tirato vicino al
  lato destro: l'etichetta dentro il riquadro; oggi fuori di 156 px) e
  `g5-un-no-torna` (il finto host del banco rifiuta `home.columnWidth` e la
  scrittura: il valore e la larghezza tornano com'erano, e c'è l'avviso di
  `#refuse` con le frasi di oggi, `grid.workbook.command_failed` o
  `command_off`).
Dal prototipo: «La risposta del foglio» e «Larghezza di una colonna» dello
script; lo stato «Una colonna tirata vicino al bordo»; «Il foglio risponde».
Casi limite: «1.5» e «1,5» con l'italiano e con l'inglese; un numero con
l'apostrofo davanti («'42», testo); una data, una percentuale, una valuta
(restano testo nell'anteprima: le riconosce il motore); più bordi tirati di
fila prima che il foglio risponda; un bordo tirato su più colonne scelte;
una colonna nascosta col bordo; un'altezza di riga; il doppio clic sul
bordo (la larghezza giusta la calcola il motore: niente anteprima); la sola
lettura (niente anteprima, l'avviso di oggi); il foglio che risponde dopo
che si è cambiato foglio; «ridotto» (tutto salta, l'avviso resta).
Fatto quando: `g5-numero-a-destra` vede il numero a destra nel primo
fotogramma (oggi dopo circa 1,5 s); `g5-larghezza-subito` vede la larghezza
nuova in ogni fotogramma (oggi torna indietro e salta dopo circa 1,8 s);
`g5-misura-dentro` vede l'etichetta dentro; `g5-un-no-torna` vede il ritorno
e l'avviso; d43 verde; `npm run bench:motion` verde; `engine.test.ts` prova
l'anteprima, il ritorno e la risposta vecchia che non scrive sopra.
Prova: scripts/check.sh --rapido, poi `npm run bench:grid` e
`npm run bench:motion`
Stato: [ ] da fare

## T6 · Riempire, copiare, tagliare, incollare

Perché: i difetti 10 e 11. Il riempimento sparisce al rilascio e i valori
arrivano dopo un secondo senza niente nel mezzo; la copia non lascia segno.
Tocca: `editors/grid/engine.ts` (`#fillMarks`, `#copy`, `#cut`, `#paste`,
`#cutMarks`), `editors/grid/grid-motion.ts`, `engine.test.ts`,
`theme/scrittoio/structure.css` e `skin/editors.css` (i segni della copia,
del taglio e delle formiche), l'anatomia, `skin.css` (generato),
`bench/motion-rules.mjs`, `bench/grid-gestures.mjs`, `grid-surface.md`
(«La selezione e il riempimento», «Gli appunti»).
Non toccare: ciò che va negli appunti (`#clipboard`, il testo e l'HTML:
d41); la serie, che la calcola il motore; l'host.
Dipende da: T5
Cosa fare:
- Il riempimento: al rilascio il contorno resta dov'è finché il foglio non
  risponde, e intanto le formiche camminano (B1, D-6); quando i valori
  arrivano, entrano uno dopo l'altro (`stagger`, `STAGGER_MS`, al massimo
  `STAGGER_MAX`, con l'opacità) e il contorno se ne va. Se il foglio dice di
  no, il contorno se ne va in `DURATION.swap` e l'avviso dice perché.
- Le formiche: un tratteggio (`ANTS_STEP`) che si sposta di un passo ogni
  `ANTS_MS`, con `transform`. `moto/animate` non ripete: è una corsa di un
  passo, lineare, che riparte quando finisce finché il segno c'è, nel
  `Lifetime` dell'attesa; la risposta e lo smontaggio la fermano. Con
  «ridotto» stanno ferme.
- La copia: un tratteggio largo attorno a ciò che si è copiato e un battito
  (il contorno pieno che svanisce in `DURATION.swap`), finché non si incolla,
  si scrive o si preme Esc (B1, D-1). Il taglio: un tratteggio fitto, come
  oggi, nei pezzi di T3.
- L'incolla: i valori si vedono subito nelle celle, come anteprima con le
  regole di T5, e quello che torna dal foglio vince.
- Coreografie in `motion-rules.mjs`: la copia (il battito); il riempimento
  con la risposta (i valori che entrano). Le formiche non sono una
  coreografia: non hanno uno stato finale finché il foglio non risponde; il
  test di `grid-motion.ts` prova che si fermano.
- In `bench/grid-gestures.mjs`, sigla G6: `g6-riempimento-resta` (C4:C5
  tirato fino a C12 col quadratino: il contorno in ogni fotogramma fino alla
  risposta, poi i valori), `g6-copia-segnata` (Ctrl+C su C4:E9: il segno
  della copia c'è; Esc lo toglie), `g6-incolla-subito` (Ctrl+V: i valori nel
  primo fotogramma). d41 resta verde.
Dal prototipo: «Riempimento» dello script, `pulse`, le formiche
(`antFlights`), gli stati «Riempimento in attesa del foglio», «Intervallo
copiato», «Intervallo tagliato», «Segno della copia».
Casi limite: Ctrl+D, Ctrl+R e Serie (stesso segno d'attesa); un riempimento
su più colonne o all'indietro; un incolla più grande del foglio o in sola
lettura; una copia da un altro foglio della cartella; una copia e poi un
cambio di foglio (il segno resta sul suo foglio, come il taglio oggi); un
taglio incollato (le formiche finché il foglio non sposta); due copie di
fila (il segno segue l'ultima); gli appunti di sistema cambiati da un'altra
app (il segno resta finché non si incolla altro: lo dice `grid-surface.md`);
«ridotto»; il telefono.
Fatto quando: `g6-riempimento-resta` vede il contorno in ogni fotogramma
fino alla risposta (oggi sparisce al rilascio, circa 1,04 s prima dei
valori); `g6-copia-segnata` vede il segno (oggi nessuno) e Esc lo toglie;
`g6-incolla-subito` vede i valori nel primo fotogramma; d41 verde;
`npm run bench:motion` verde; il test di `grid-motion.ts` prova che le
formiche si fermano alla risposta, allo smontaggio e con «ridotto»;
`check-listeners` verde.
Prova: scripts/check.sh --rapido, poi `npm run bench:grid` e
`npm run bench:motion`
Stato: [ ] da fare

## T7 · Il dito

Perché: il difetto 12. Col dito, trascinare scorre e intanto sceglie celle.
Tocca: `editors/grid/engine.ts` (`#pointerDown` e i gestori che seguono),
`editors/grid/grid-motion.ts`, `engine.test.ts`,
`theme/scrittoio/structure.css` e `skin/editors.css` (`touch-action`, le
maniglie), l'anatomia, `skin.css` (generato), `bench/motion-rules.mjs`,
`bench/grid-gestures.mjs`, `grid-surface.md` («La selezione e il
riempimento»).
Non toccare: il mouse e la penna (fanno ciò che fanno oggi); la cella aperta
(T4); `kit/` (il gesto della griglia è della griglia).
Dipende da: T3 (può girare accanto a T4)
Cosa fare:
- Con `pointerType === "touch"` (B4): trascinare oltre `TAP_MOVE` scorre e
  basta (la griglia dice `touch-action: pan-x pan-y` e non sceglie); un
  tocco sceglie la cella; due tocchi entro `DOUBLE_TAP_MS` la aprono; un
  tocco lungo (`LONG_PRESS_MS`, fermo entro `TAP_MOVE`) sceglie e mette due
  maniglie agli angoli della selezione, che si tirano per allargarla. Le
  maniglie non riempiono: al telefono il riempimento resta dal menu.
- Le maniglie sono pezzi del motore di T3: compaiono crescendo dal centro
  da `ENTER_SCALE` con la molla `SLIDE`, nello stesso fotogramma del motore
  (non `enter`, che le farebbe correre per conto loro), e seguono la
  selezione con gli altri pezzi; con «ridotto» si dissolvono soltanto. Un
  tocco altrove le toglie. Sono segni d'angolo (B7): intere, nel livello
  della zona del loro angolo; sul filo del blocco la fascia ferma ne copre
  metà, e scorrendo passano sotto la fascia con la loro cella (D-8).
- La presa è geometrica, come `gripAt` del prototipo: un cerchio di
  `GRIP_R` attorno all'angolo, se l'angolo si vede (`cornerSeen`), intero
  anche dove la fascia copre metà maniglia; le maniglie non prendono il
  puntatore (niente `pointer-events` né `touch-action` loro). Siccome la
  griglia dice `touch-action: pan-x pan-y`, un ascoltatore `touchstart` non
  passivo sul riquadro, col `Lifetime` della griglia, chiama
  `preventDefault` quando un dito solo cade nella presa: il dito tira la
  maniglia invece di far scorrere il foglio.
- Coreografie in `motion-rules.mjs`: il tocco lungo (le maniglie che
  compaiono) e la maniglia tirata.
- In `bench/grid-gestures.mjs`, sigla G7, a 390 px col tocco (`hasTouch`,
  CDP `Input.dispatchTouchEvent`): `g7-trascinare-scorre` (un trascinamento
  verticale di 300 px: lo scorrimento cambia, nessun intervallo, la cella
  attiva è quella di prima), `g7-tocco-sceglie` (un tocco su una cella in
  vista: è attiva), `g7-due-tocchi-aprono`, `g7-tocco-lungo` (due maniglie
  distinte, `data-handle`; tirata una, la selezione si allarga) e
  `g7-maniglia-sul-filo` (con la colonna A bloccata, il tocco lungo su B5:
  la maniglia d'inizio è un elemento solo, 14×14, col centro sul filo; un
  tocco al centro la tira, la selezione si allarga e il foglio non scorre;
  scorso di lato di 40 px, sul filo non resta niente della maniglia, che è
  sotto la fascia; su A5 la maniglia di fine resta intera sul filo).
Dal prototipo: «Il puntatore» dello script (`TAP_MOVE`, `LONG_PRESS_MS`,
`DOUBLE_TAP_MS`, `GRIP_R`, `gripAt` e l'ascoltatore `touchstart`), il
blocco `.grid-mark.touch`, lo stato «Al telefono».
Casi limite: un tocco su un'intestazione (sceglie la colonna o la riga); un
tocco sul quadratino; un dito sulla metà coperta di una maniglia sul filo;
una maniglia su B2, sul filo della riga e della colonna insieme; due dita
(lo zoom del sistema: la griglia non lo ferma); un dito che scorre mentre
una corsa è a metà; il tocco lungo che apre il menu contestuale del sistema
(si ferma il `contextmenu` della griglia solo col tocco); una tavoletta con
penna e dito; un tocco mentre la cella è aperta (conferma, come il clic
altrove: d36); «ridotto».
Fatto quando: `g7-trascinare-scorre` vede lo scorrimento senza intervallo
(oggi sceglie celle); `g7-tocco-sceglie`, `g7-due-tocchi-aprono`,
`g7-tocco-lungo` e `g7-maniglia-sul-filo` verdi; i controlli del mouse (d35,
d36, d45, q14) verdi; `npm run bench:motion` verde; `check-listeners` verde.
Prova: scripts/check.sh --rapido, poi `npm run bench:grid` e
`npm run bench:motion`
Stato: [ ] da fare

## T9 · Le due preferenze della griglia

Perché: l'utente vuole il prodotto più personalizzabile possibile e, alle
D-1 e D-5, ha seguito il consiglio dell'orchestratore: la scelta del
prototipo di norma, e in Impostazioni la possibilità di cambiarla.
Tocca: `crates/fub-host/src/settings.rs` (due voci nuove fra quelle
dell'editor, come `editor.soft-cursor` ed `editor.indent`: le chiavi, le
scelte, le stringhe italiane e inglesi), `editors/grid/grid-motion.ts`
(legge le due scelte), `editors/grid/engine.ts` (carica le preferenze come
`TextEngine.loadInputPreferences` e le rilegge quando una delle due
cambia), i test, `docs/architecture/grid-surface.md` e la pagina di
prodotto del foglio di calcolo o, se non c'è, `docs/product/editor-blocks.md`
accanto al «Cursore morbido».
Non toccare: `moto/spring.ts`, `moto/level.ts`, `appearance.motion` (il
movimento ridotto resta di tutta l'app e vince sempre); i valori di norma
di B1, B5 e B6.
Dipende da: T3 (le costanti e il motore dei segni), T6 (i segni della
copia)
Cosa fare:
- `editor.grid.copy-mark`, a scelta: «Tratteggio e battito» (`dash-pulse`,
  di norma, B1), «Solo il tratteggio» (`dash`), «Solo il battito»
  (`pulse`), come le tre scelte «Segno della copia» del prototipo. Il
  taglio resta il tratteggio fitto, e le formiche del riempimento non
  cambiano.
- `editor.grid.selection-speed`, a scelta: «Svelta» (`quick`, una molla
  `GLIDE_QUICK` 2800/106, le radici 50 e 56 al secondo, al 90 % in circa
  74 ms), «Come di norma» (`normal`, `GLIDE`, circa 105 ms, B6), «Morbida»
  (`soft`, la molla `SLIDE` 700/53, circa 150 ms), «A scatti» (`none`: la
  selezione è in ogni fotogramma quella scelta, come il modo «salta» di
  D-7, coi tasti e col puntatore). Vale per la cella attiva e il
  rettangolo, coi tasti, coi comandi e col puntatore; le colonne che
  scivolano e le maniglie restano su `SLIDE`. Le molle nuove stanno in
  cima a `grid-motion.ts` col loro nome; i tempi al 90 % si misurano nel
  test, non si copiano da qui.
- Le descrizioni dicono che cosa si vede, e che col movimento ridotto la
  selezione si ferma subito qualunque sia la scelta.
- Una scelta cambiata a griglia aperta vale dal gesto dopo, senza
  riaprire il foglio e senza un salto del segno che sta scivolando; un
  valore sconosciuto vale come quello di norma.
- Le regole del motore dei segni di T3 restano vere con ogni scelta: i
  pezzi sono sempre un rettangolo solo, la cella attiva ci sta dentro, la
  selezione finisce sulla cella sotto il puntatore.
- Se un mirror o una fixture del client elenca le chiavi delle
  impostazioni, si rigenera col comando scritto nella sua intestazione
  (`UPDATE_MIRROR=1`), mai a mano.
Dal prototipo: «Segno della copia»; per la velocità, i tempi di B6.
Casi limite: una preferenza scritta a mano con un valore che non esiste;
la scelta cambiata mentre un segno scivola o mentre le formiche camminano;
«A scatti» col trascinamento fitto di `g3-mouse-fitto`; due griglie aperte
in due riquadri, che cambiano insieme; la griglia smontata prima che
arrivino le impostazioni (nessun ascoltatore resta, `check-listeners`).
Fatto quando: le due voci si vedono in Impostazioni, nelle due lingue,
con di norma `dash-pulse` e `normal`; ogni scelta cambia ciò che si vede
come descritto, subito; con «ridotto» la selezione quasi si ferma con ogni
scelta; `bench:grid` G3 verde con ogni velocità (le regole dei pezzi e
della cella sotto il puntatore); `catalogs.rs` di fub-host verde; la riga
in Impostazioni guardata nelle due luci e a 700 px; lo scripts/check.sh
--rapido verde. Le baseline della scena `settings` possono cambiare solo
se la riga nuova cade nell'inquadratura: le prende l'orchestratore dal
runner.
Prova: `cargo test -p fub-host --test catalogs`, `npx vitest run
src/editors/grid`, `npm run bench:grid`, `npm run bench:motion`,
scripts/check.sh --rapido
Stato: [ ] da fare

## T8 · Le foto del banco e il confronto col prototipo

Perché: il cancello del piano è che la griglia si vede come il prototipo,
nelle due luci e alle tre larghezze, e che chi legge con un lettore di
schermo non perde niente.
Tocca: `apps/client/bench/scene.mjs` (le scene nuove), `bench/a11y.mjs`
(solo se una scena nuova ne ha bisogno), `grid-surface.md` («Dove si
trova»), e i resti dei task prima (un hook rimasto, un commento vecchio).
Non toccare: le baseline (le prende l'orchestratore dal runner); il codice
della griglia, salvo un difetto che le foto trovano (e allora il rapporto
lo dice e il task che lo possiede si riapre).
Dipende da: T1–T7, T9
Cosa fare:
- Le scene del banco come gli stati del prototipo, sulla scena `grid-large`
  e su `grid-workbook`: l'intervallo, l'intervallo oltre il blocco scorso, la
  cella aperta con un testo lungo, la colonna tirata vicino al bordo, il
  riempimento in attesa, copiato, tagliato, il telefono col tocco lungo;
  ognuna chiara e scura, piena, 700 px e telefono dove ha senso.
- Le foto del banco accanto al prototipo, stato per stato, in una scheda per
  l'utente (nel rapporto, fuori dal repo); le differenze volute scritte.
- `npm run bench:a11y` con le scene nuove.
- In `grid-surface.md` ogni sezione toccata descrive il presente: il piano e
  le zone, la carta, i segni e il loro movimento, la cella aperta,
  l'anteprima e il ritorno, la copia e le formiche, il dito, le due
  preferenze.
- Le due preferenze di T9: una foto per scelta del segno della copia,
  nelle due luci, accanto al prototipo.
Dal prototipo: gli stati della barra del prototipo.
Casi limite: le scene dei documenti e delle tabelle non cambiano
(`document-*`, `window-document`, `mobile-document*`, `live-14-tabella-attiva`,
`slash-05-tabella`); le scene della barra dei fogli di K3 cambiano solo dove
la griglia sotto si vede.
Fatto quando: le scene nuove ci sono e le foto del banco somigliano al
prototipo in ogni stato, luce e larghezza (le differenze scritte);
`npm run bench:a11y` verde; `theme:verify` verde; nella CI nessuna baseline
fuori dalle scene `grid-*` e da quelle di K3 con la griglia cambia; lo
scripts/check.sh completo verde.
Prova: scripts/check.sh, poi `npm run bench:verify`, `npm run bench:a11y`,
`npm run bench:grid` e `npm run bench:motion`
Stato: [ ] da fare
