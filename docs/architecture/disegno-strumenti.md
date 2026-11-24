# Gli strumenti del motore nel Completo

> **Domanda:** come uno strumento del motore vettoriale arriva alla tela del
> Completo, con la fila delle opzioni, i tracciati, i gesti a mano libera e
> il Contagocce?
> **Fonti autorevoli:** `crates/fub-disegno/src/gesti/`,
> `crates/fub-disegno/src/famiglie/`, `apps/client/src/editors/spatial/completo/`.
> **Decisioni:** [ADR 0250](../decisions/0250-il-disegno-completo-sul-motore.md),
> [ADR 0239](../decisions/0239-il-disegno-sul-motore-vettoriale.md).

Questa pagina continua [Il disegno completo](disegno-completo.md): lì il
percorso di un comando, la mappa, l'indice e il disco; qui il percorso di
uno strumento.

## Il percorso di uno strumento del motore

I sei strumenti della 0239 hanno ognuno il suo gesto in
`crates/fub-disegno/src/gesti/`. Gli altri strumenti del motore passano da
un ponte solo (arriva con T4):

1. il client apre un gesto con `DrawingTool::Engine { id }`, dove `id` è
   l'id dello strumento nel motore; un id che il motore non ha è rifiutato
   con `UnknownTool`;
2. `drawing_gesture` porta i puntatori, come per gli strumenti della 0239,
   e in un campo accanto i tasti, il testo scritto e la composizione dell'IME;
3. il ponte, `crates/fub-disegno/src/gesti/strumento.rs`, tiene lo strumento
   attivo per sessione e gli passa gli eventi; le azioni che lo strumento
   rende passano per la differenza;
4. l'anteprima rende le sovrapposizioni dello strumento (punti, maniglie,
   misure, guide), colorate dal client con i suoi token, e lo stato dello
   strumento (il cursore, le opzioni, se aspetta testo); il client ne chiede
   al più una per fotogramma;
5. il rilascio fa un passo della cronologia di Fub; Esc o la perdita del
   fuoco annullano lo strumento e non lasciano operazioni.

**La fila delle opzioni (T11).** Lo strumento scelto prima prepara la sua
famiglia: `completo/index.ts` (`preparaStrumento`) trova la famiglia nella
voce dell'indice dello strumento e la porta con `carica.ts`. Il gesto aspetta
quella preparazione; se non arriva, lo strumento di prima resta e lo si dice.
Quando la famiglia è pronta, `carica.ts` dà le sue etichette (`testi`), e solo
allora `completo/index.ts` (`fila`) costruisce la fila con i controlli del kit
(`completo/opzioni.ts`). La testata (`tools/editor/chrome/fila-motore.ts`) la
monta nella riga delle opzioni; ogni stato registrato dello strumento la
aggiorna (`StatiStrumenti.ascolta`), e smontata la fila il suo ascolto si
spegne. Lo stato arriva con un esito: un gesto, `disegno.strumento.opzione`, o
`disegno.strumento.stato`, il comando di sola lettura che `gesti.ts`
(`preparaStrumento`) manda appena la famiglia è pronta, così la fila c'è prima
del primo gesto.

Una famiglia può registrare una fila propria per uno strumento
(`registraFila`): riceve lo stato intero e le azioni della fila
(`AzioniFila`: un comando, una lettura, una frase e `opzione`, che cambia
un'opzione dello strumento con `disegno.strumento.opzione` come la fila
generica). Così fanno i punti della Selezione diretta (`tracciati`), il
Contagocce (`colore`) e la Trasformazione libera (`trasforma`,
`opzioni-libera.ts`): Vincola sopra i tre modi del riquadro di VectorCraft
(libera, prospettica, libera distorsione), perché il modo è un testo che la
fila generica non disegna; Vincola è spenta fuori dal modo libero.

**I tracciati e i punti (T12).** La penna, la penna intelligente e la
curvatura fanno un tracciato a più clic (`motore/tracciati.ts`,
`A_PIU_CLIC`): al rilascio `gesti.ts` manda un'anteprima e, finché lo stato
dice `busy`, tiene il tracciato aperto e disegna i segni del motore
(`segniComeForma`, nello strato dell'anteprima, coi token del tema). Il
ponte tiene il tracciato nella sua copia finché il gesto continua (stesso
strumento, stessa revisione); Invio, Esc o lo strumento cambiato mandano il
`commit` con il tasto (o senza) e l'esito è un passo solo. Con la
Selezione diretta lo stato porta i punti scelti (`DrawingToolState.anchors`).
Il doppio clic segue VectorCraft: giù, su, giù, su e poi un evento
`double_click` a parte. `gesti.ts` lo riconosce al secondo rilascio di uno
strumento del motore (stesso strumento e puntatore, entro `DOUBLE_TAP_MS` e
`DOUBLE_TAP_PX` in pixel dello schermo) e lo manda dopo il clic: in un gesto
suo (la penna sul tracciato aperto, gli altri col `commit`), o nell'anteprima
del testo che si sta scrivendo, che resta aperto. Lo strumento che il motore
chiede (`DrawingToolState.switch_tool`) si sceglie come dalla colonna.
I tasti che lo strumento prende (`DrawingToolState.claims_keys`) vanno a
lui prima delle scorciatoie: `gesti.ts` (`tastoPreso`) li manda in un `commit`
senza puntatore. I punti scelti della Larghezza passano da una revisione
all'altra nel ponte (`Banco::scelti_dello_strumento`), che li riprende col
clic di VectorCraft quando rimette a capo lo strumento.
Il motore disegna i segni dei punti solo nell'anteprima di un gesto: a gesto
fermo `tools/editor/marks.ts` mette sul foglio i punti dei tracciati scelti e
di quelli dei punti scelti (`motore/punti-diretti.ts`, dal `d`, dai `points`
o da `x1…y2`), con le regole di VectorCraft (`selection_marks.rs`): il
contorno, tutti pieni se il tracciato è scelto intero (con le maniglie se lo
strumento cambia i punti), se no pieni quelli fra gli `anchors`; li ridisegna
a ogni stato o strumento nuovo. La cornice della selezione c'è solo con la
Selezione e con gli strumenti delle forme (`STRUMENTI_CON_LA_CORNICE`, come
`selection_overlay`). Il mouse che passa senza premere va al motore come gesto
`preview` con un `move` (`motore/gesti.ts`, `ctx.motoreSopra`, al più uno per
fotogramma), che ne dà il cursore e i segni. Il gesto dopo li riporta al motore (`DrawingGesture.anchors`,
da `StatiStrumenti`), che li rimette nella selezione
(`gesti/strumento.rs`, `punti_del_gesto`): ciò che è pieno è ciò che si
sposta;
la famiglia `tracciati` registra la sua fila (`ContestoCompleto.registraFila`,
`completo/famiglie/tracciati/opzioni-punto.ts`), che manda i comandi sui
punti con `anchors` nel `value` e dopo l'esito rilegge lo stato. Gli
strumenti e i comandi dei tracciati, e Rimodella e i pennelli che deformano
(`object.liquify`, `famiglie/pennelli.rs`), che ne spostano i punti, rifiutano l'inchiostro di Fub (`unmapped`) e la carta. I comandi su un punto solo (`path.moveAnchor`,
`setHandle`, `insertAnchor`, `removeAnchor`, `convertAnchor`, `close`,
`appendAnchor`, `split`) nominano il tracciato con `element` e i numeri del
punto, in coordinate della scena: `famiglie/tracciati_punti.rs` controlla i
numeri (`bad_args`), rifiuta un `id` del motore nel valore, e passa l'id e le
coordinate nel documento del motore; Canc coi punti scelti è
`path.deleteAnchors` (`Completo.cancellaPunti`). Il prodotto: [penne](../product/drawing-pen.md#la-penna-di-bézier-disegno-completo).

**I gesti a mano libera (T12, giro 9).** Matita (`path.freehand`), Gomma
(`path.eraseRegion`), Cancella tracciato (`path.eraseSegments`), Coltello
(`path.knife`) e Smussa (`path.smoothRegion`) sono anche comandi del disegno,
oltre agli strumenti. `famiglie/tracciati_mano.rs` ne decide il perché: senza
selezione, Cancella tracciato e Smussa sono `empty`; un'immagine o un testo
scelto è `unmapped`; un tratto della penna di Fub è `fub_ink`; un oggetto
bloccato è `locked`. I punti del valore passano da coordinate di scena a quelle
del documento, e `extend`, `connect`, `redraw` (id del motore) sono `bad_args`.
La Matita va nel livello più alto visibile, come le forme.

**La Curvatura e la penna a passi (T12, giro curvatura).** `path.curvature` crea
un tracciato che passa per i punti (con `element` ne sostituisce la forma),
`path.setAnchors` ne sostituisce la geometria; `path.curvatureEdit`,
`path.reshape`, `path.reshapeSegment` e le sei `addon.pen.*` (append, close,
segment, removePoint, togglePoint, reshape) nominano il tracciato con `element`
come i comandi su un punto (`tracciati_punti.rs`, dove stanno anche i delta
`dx`/`dy` portati con la parte lineare della radice), e `tracciati_curva.rs`
porta i punti di `path.curvature` e `path.setAnchors`. Un `id` del motore è
`bad_args`; un elemento bloccato `locked`, un tratto della penna di Fub
`unmapped`; chiudere un tracciato già chiuso è `empty`.

## Il Contagocce (T14, giri 6 e 7)

Lo strumento `eyedropper` (famiglia `colore`) copia sulla selezione riempimento,
contorno e spessore dell'oggetto sotto il primo clic: il motore fa il suo
`appearance.copyFrom` con la sorgente che sceglie lui. Il rifiuto sta prima del
motore, in `crates/fub-disegno/src/famiglie/colore.rs`
(`rifiuto_del_contagocce`): un bersaglio bloccato o non mappato, un tratto
dell'Inchiostro di Fub come bersaglio, e un'immagine come sorgente si rifiutano
(`locked`, `unmapped`, `unsupported`); una sorgente bloccata o un tratto
dell'Inchiostro si leggono senza cambiarli. Senza selezione il clic cambia i
valori predefiniti del motore (riempimento e contorno), non gli oggetti. Le sue
opzioni sono `eyedropper.setOptions`, una preferenza del motore che sta in
`draw.motore`. Quando lo strumento è attivo, la fila delle opzioni (giro 7,
`completo/famiglie/colore/opzioni-contagocce.ts`) legge le preferenze con
`disegno.prefs.get` e le cambia con `disegno.eyedropper.setOptions`: il campione
(1, 3 o 5 punti) e che cosa copia (riempimento, contorno, opacità, testo). Un
rifiuto su un'immagine dice «Il Contagocce non legge i colori di un'immagine.».
Il comando `appearance.copyFrom` con `source` resta «da fare»
(T15, famiglia `aspetto`): la sorgente è un id del motore, che Fub non traduce.
