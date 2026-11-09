# Piano: Scrittoio 2, la cornice nuova in ogni editor

Branch: piano/scrittoio-2
Obiettivo: in ogni editor di Fub (note, documenti Word e ODT, fogli, lavagna, disegni, SVG, Craft, PDF, immagini e audio) la persona trova la stessa cornice quieta del mockup. La modalità si sceglie dalla banda in basso; la testata del foglio dice solo dove sei e se è salvato; cassetto e ispettore parlano a voce bassa; il testo da leggere è più grande; tutte le barre degli strumenti hanno la forma della barra dei fogli (la lavagna segue il piano N6). Sul telefono il foglio va da un bordo all'altro, «Salvato» e la modalità sono icone, e la modalità sta in basso a destra, alla stessa altezza di Annulla e Ripeti.
Perché: oggi la testata porta quattro tasti che pesano più del contenuto, e ogni editor ha una barra disegnata a modo suo, così la persona reimpara la forma a ogni formato. Il documento dell'utente del 2026-11-04 chiede la pagina Benvenuto ridisegnata; il brief la allarga a tutti gli editor, con la barra dei fogli come standard.
Fuori scope:
- la tavolozza e i colori, che restano quelli di oggi; le eccezioni sono la misura del testo (D2) e tre ruoli facoltativi nuovi della ricetta, chiesti dall'utente il 2026-11-04: il vassoio delle barre `--bar-tray` (T16) e l'ombra del foglio `--shadow-sheet` e `--shadow-sheet-focus` (T27);
- contratti nuovi: IPC, WIT, `fub-abi`, formati su disco;
- il ritmo dei paragrafi, la scrittura di `Ctrl+O`, il colore del gettone del vault, il tasto «/» del filtro, i sottotitoli tenui, h5 e h6;
- la lavagna oltre la cornice comune: la sua barra, le opzioni, la colonna, la banda e la tela (col suo contrasto, ~4,2:1) sono del piano N6 (`lavagna-schede.html`, T22 e T49–T52), che vince; qui la lavagna prende la cornice e l'icona della modalità (T23);
- la striscia del foglio scuro della griglia (griglia T2);
- il docx a 700 px; il movimento della barra dei fogli (K3 T19) resta del kit, e T28 lo accende anche nel documento (aggiunto il 2026-11-09);
- la colonna degli strumenti del disegno, che è di K5 (qui c'è solo la proposta);
- la WebView vera, Windows e macOS, che si vedono solo in CI;
- il telefono ridisegnato da capo: l'utente lo vuole cambiare a fondo («Comunque la GUI del telefono non mi piace proprio. Per ora do l'ok, la aggiustiamo più avanti, ma è sicuramente da modificare pesantemente»), e lo fa un piano successivo. Qui le righe del telefono restano piccole: quelle approvate per ora, e nessuna parte nuova.
Assunzioni:
- Risposte dell'utente (2026-11-04): A a D1–D9; il titolo della nota a 600; nel selettore dell'icona «Figure» prima di «Emoji»; il menu delle modalità è il B, la spunta blu a destra; il telefono è approvato per ora con la A, il tondo in basso a destra. Lo stesso giorno l'utente ha chiesto l'ombra del foglio morbida e visibile ai fianchi (T27), il vassoio delle barre meno grigio in giorno e notte (T16, T20) e le sezioni della barra a schede come le schede dell'ispettore (T20, T21). Sulle cinque domande di gusto (2026-11-04): l'ombra va bene così, ma deve stare anche sotto la linguetta accesa, fusa col foglio (T27); di notte nessun filo chiaro attorno al foglio; le sezioni restano a 13 px, 12 sotto i 900 px; la sezione scelta ha il nome più marcato (T20); il vassoio più chiaro anche per la barra a una riga e per la colonna degli strumenti del disegno se ne riparla, e intanto resta com'è nel piano.
- Valgono le «Decisioni già prese» del documento dell'utente, tranne le eccezioni di D2 e dei tre ruoli nuovi (sopra).
- Si apre una PR bozza sola (D9). T1 e T16 partono subito. Il prototipo è approvato (2026-11-04): il computer per intero, il telefono per ora, con la A; nessun task aspetta più un OK. Al massimo due task insieme.
- Differenze volute dalla bozza dell'utente:
  - (a) il menu delle modalità nasce in `state/mode-menu.ts` e non in `state/document-controller.ts`, che N6 sta cambiando;
  - (b) le stringhe nuove della shell vanno in `src/i18n/catalog.ts`, in italiano e in inglese; `bench/fake-english.ts` traduce solo i testi dell'host finto e cambia solo in T13;
  - (c) `editors/text/profiles/markdown/hints.ts` non si tocca: la pastiglia `H1` oggi si vede già solo sulla riga del cursore (`hints.ts:84`);
  - (d) `#status-standing` nasce in JS dentro `status-band.ts`, non in `index.html`;
  - (e) il titolo della nota pesa 600 e non 500. Risposta (2026-11-04): 600;
  - (f) le scorciatoie del menu si leggono da `allCommands()` e `displayBinding`, che rispettano le scorciatoie cambiate dalla persona, e non da `ui/shell-keys.generated.ts`.
Ondate: T1 T16 | T2 T11 | T5 T10 | T3 T6 | T7 T17 | T4 T8 | T18 T20 | T9 T19 | T14 T21 | T12 T22 | T13 T23 | T15 T27 | T28 | T24 | T25 | T26
Prototipo: `PLAN-ui/scrittoio-2.html`. Il computer è approvato (2026-11-04); il telefono è approvato per ora (2026-11-04), con la A, e la variante B è uscita. Le caselle «Rimetti com'era» (o `?prima=ombra,vassoio,sezioni`) rimettono l'ombra del foglio, il vassoio e le sezioni di oggi, per il confronto.

## Modifiche

- 2026-11-04 · le risposte alle cinque domande di gusto · task toccati: T20,
  T27.
  - L'ombra («l'ombra va bene così, solo che vorrei stesse sotto anche
    all'indicatore della tab, che sembra quasi non averne al momento. Deve
    sembrare fuso con il foglio anche per l'ombra»): la linguetta accesa e il
    foglio fanno un'ombra sola, con la stessa sagoma. T27 la mostra prima nel
    prototipo.
  - Di notte niente filo chiaro attorno al foglio, come nel piano.
  - Le sezioni restano a 13 px, 12 sotto i 900 px, come nel piano.
  - La sezione scelta ha il nome più marcato (T20), senza allargare la fila.
  - Il vassoio più chiaro per la barra a una riga e per la colonna degli
    strumenti: se ne riparla; T16 resta com'è.

- 2026-11-04 · l'ombra del foglio, il vassoio più chiaro, le sezioni come
  l'ispettore e il telefono approvato per ora · task toccati: T3, T11, T16,
  T20, T21, T24, T27 (nuovo); le righe del prototipo cambiano in tutti i task
  grafici.
  - L'ombra («In questo momento è praticamente un rettangolo perfetto, la
    parte bassa dell'ombra, e non si vede l'ombra laterale»): la taglia
    `#panes`, che ha `overflow: hidden`. T27, nuovo, allarga la scrivania di
    20 px verso i vicini che stanno dentro la finestra e restituisce la stessa
    misura in padding, così i fogli non si muovono; il foglio prende un'ombra
    a tre strati che si vede ai fianchi. Sul telefono in piedi l'ombra non
    c'è, sdraiato si vede solo ai fianchi. T27 gira con T15, dopo T17.
  - Il vassoio («vorrei che questo sfondo grigio fosse meno grigio, cioè che
    ci fosse meno stacco tra il bianco e quello sfondo. lo stesso vale per la
    versione scura, meno differenza di colore»): è il ruolo nuovo
    `--bar-tray`, che nasce con T16, il primo a usarlo; T20 lo porta alla
    barra a schede. Di notte i foglietti prendono la carta alzata e un filo,
    così restano staccati.
  - Le sezioni («vorrei anche che il selettore di tab dell'editor docx fosse
    più simile al selettore di collegamenti, struttura ecc. della sidebar»):
    la sezione scelta è un foglietto di carta alzata, come le schede
    dell'ispettore, nella barra a schede comune ai fogli e ai documenti (T20);
    il documento la vede quando T21 toglie le sue regole `.rich-ribbon-*`.
  - Il telefono («Per ora do l'ok, la aggiustiamo più avanti, ma è
    sicuramente da modificare pesantemente»): la A è approvata per ora, la
    variante B esce dal prototipo e da T3, e il ridisegno va in un piano
    successivo (Fuori scope). T3, T5 e T7 non aspettano più.
  - T11 lascia i ruoli nuovi a T16 e T27; T24 aspetta anche T27.

- 2026-11-04 · le risposte dell'utente e il telefono rivisto · task toccati:
  T2, T3, T5, T7, T10, T11, T14, T17, T21, T23, T24; le righe del prototipo
  cambiano in tutti i task grafici.
  - Le risposte: A a D1–D9, il titolo a 600, «Figure» prima di «Emoji»; il
    prototipo del computer è approvato. Il menu B è già nel blocco di
    `skin/menus.css`, e il blocco `titolo-500` non c'è più.
  - Il telefono, su richiesta dell'utente («vorrei che il foglio occupasse
    tutta la larghezza disponibile e che "salvato" e la modalità in cui ci
    troviamo siano delle semplici icone… Il tasto della modalità deve trovarsi
    in basso a destra, allo stesso livello dei tasti undo/redo»; «Io toglierei
    pure il logo in alto a sinistra nell'app per smartphone»): in piedi il
    foglio va da un bordo all'altro (T5), «Salvato» è la spunta (T5), il
    marchio non c'è e la pillola prende il suo posto (T7), la modalità è un
    tondo in basso a destra che, mentre si scrive, chiude la fila della barra
    di formato (T3). Sdraiato il marchio resta, e il tondo pure. Gli stati
    nuovi sono `tel-ferma`, `tel-sdraiato` e `tel-tastiera`; la variante B è
    `?telefono=tel-b`. Il telefono è in revisione: T3, T5 e T7 aspettano l'OK.
  - Il bottone della modalità esce da `.pane-toolbar`, che taglia ciò che
    sporge, e diventa figlio del foglio, dopo la barra di formato. Lo sposta
    T3, che corregge anche i clic del banco e dell'e2e che cercavano i
    segmenti della testata (nel T3 di prima restavano rotti). T2 gli dà
    l'icona, il nome in uno `span` e il suggerimento; T17 toglie la sua pelle
    della testata, che resta senza effetto, e tiene il gancio
    `pane-mode-current` con l'anello del fuoco sul selettore nuovo.
  - T7 nasconde il marchio solo in piedi: prima controlla che ogni voce del
    suo menu abbia un'altra strada, e il fuoco non resta su un marchio
    nascosto. T14 prende undici figure, perché `star` la cornice l'ha già.
  - La lavagna segue il piano N6 («preferisco quella del piano originale. Mi
    piace il piano in schede della lavagna»): qui prende solo la cornice
    comune. Escono gli stati `lavagna` e `lavagna-700` e le proposte per N6
    T49–T52; T23 si riduce all'icona della modalità e non aspetta N6; T24
    perde la scena `lavagna-barra`. Le ondate non cambiano.

## Domande per l'utente

L'utente ha risposto A a tutte (2026-11-04). Le opzioni restano scritte per
dire che cosa si è scartato.

- **D1 · Fogli affiancati.**
  - A (raccomandata): basta la banda; dice e cambia la modalità del foglio a fuoco, che la cornice già segna. In pratica, per cambiare la modalità del foglio di destra ci clicchi prima dentro; le testate restano pulite.
  - B: con due o più fogli ogni testata tiene il suo bottone `.pane-mode-current`. In pratica la modalità si vede accanto a ogni foglio, con un po' di rumore in più.
  - Risposta (2026-11-04): A.
  - Task: T3.
- **D2 · Corpo del testo.**
  - A (raccomandata): il predefinito passa a 18 px e la misura a 58 caratteri, in TS e in Rust; chi ha già scelto un valore in Aspetto lo tiene. In pratica chi non ha mai toccato la dimensione legge più grande, su righe più corte, con gli stessi a capo del mockup. Cambiano anche `recipe.ts` e i fogli generati, ma solo per `--text-reading` e `--content-width`: è un'eccezione esplicita alla «tavolozza intatta».
  - B: restano 17 px e 68 caratteri, e il mockup non si ottiene.
  - Risposta (2026-11-04): A.
  - Task: T11.
- **D3 · La riga dei dati sotto il titolo.** È «Modificata 2 ore fa · 3 collegamenti · #tema #banco» in Live, Blocchi e Lettura.
  - A (raccomandata): sì, letta dagli indici che esistono già, senza IPC nuova; in Sorgente non c'è.
  - B: no.
  - Risposta (2026-11-04): A.
  - Task: T12.
- **D4 · «In entrata».**
  - A (raccomandata): sotto la Struttura le prime 5 note che puntano qui, poi «e altri N»; nel pannello Collegamenti «Entranti» diventa «In entrata», così la parola è una sola. In pratica vedi chi cita la nota senza cambiare scheda; la Struttura fa una lettura dell'indice in più.
  - B: solo nella scheda Collegamenti, come oggi.
  - Risposta (2026-11-04): A.
  - Task: T13.
- **D5 · Conteggi nel cassetto.**
  - A (raccomandata): accanto a ogni cartella il numero dei suoi file diretti (lo zero non si scrive), e sopra l'albero «Tutte le note N».
  - B: nessun numero.
  - Risposta (2026-11-04): A.
  - Task: T8.
- **D6 · Il campo dei comandi.**
  - A (raccomandata): «Cerca o esegui un comando». Sul computer la pillola è sempre il campo dei comandi, perché il nome della nota sta già nella testata; sul telefono resta il nome della nota.
  - B: resta «Apri, cerca, comanda…», e la pillola mostra cartella e nota come oggi.
  - Risposta (2026-11-04): A.
  - Task: T7.
- **D7 · Le figure monocrome per cartelle e note.**
  - A (raccomandata): la figura si salva come `fub:<nome>` nella stessa stringa dell'icona di oggi, quindi nessun campo nuovo e nessun cambio di contratto. In pratica una versione di Fub di prima di questo piano mostra la scritta `fub:book` dove c'era la figura, finché non si aggiorna.
  - B: un campo nuovo nel contratto per il tipo d'icona. È più lavoro, tocca `fub-abi` ed esce da «niente contratti nuovi».
  - Risposta (2026-11-04): A.
  - Task: T14, T15.
- **D8 · Il gruppo raccolto nella barra a schede del documento.**
  - A (raccomandata): si apre sul posto (`openInPlace` del kit, che arriva con K3), come nei fogli.
  - B: resta il riquadro sospeso di oggi.
  - Risposta (2026-11-04): A.
  - Task: T21.
- **D9 · Le PR.**
  - A (raccomandata): una PR bozza sola per tutto il piano, con le baseline rifatte una volta alla fine dal runner. In pratica una revisione lunga, ma una sola tornata di foto.
  - B: quattro PR come nella bozza, cioè quattro tornate di baseline e quattro attese della CI completa.
  - Risposta (2026-11-04): A.
  - Task: T24, T25.

## Da decidere guardando

Le tre domande hanno la risposta. Nel prototipo le caselle «Rimetti com'era»
(o `?prima=ombra,vassoio,sezioni`) mostrano com'erano l'ombra del foglio, il
vassoio e le sezioni, per il confronto: quelle varianti non vanno nel codice.

1. Il menu delle modalità:
   - A: il punto a sinistra e la scorciatoia scritta per esteso;
   - B: la spunta blu a destra e le scorciatoie in pastiglie, come nel mockup.
   - Risposta (2026-11-04): B, «al momento preferisco la spunta blu a destra».
   - Il CSS di B è già dentro il blocco di `skin/menus.css` (righe 2096–2137, T10): non c'è più un blocco a parte.
2. Il peso del titolo della nota:
   - 600 (raccomandato), pieno come nel mockup;
   - 500, come scritto nella bozza.
   - Risposta (2026-11-04): 600. Il blocco `titolo-500` è uscito dal prototipo.
3. Il bottone della modalità sul telefono, in piedi:
   - A (raccomandata): un tondo alto un dito in basso a destra, sopra la carta; mentre si scrive diventa piatto e chiude la fila della barra di formato, dopo Annulla e Ripeti, anche sopra la tastiera. In pratica il pollice lo trova sempre allo stesso angolo, e la carta non perde righe; il tondo può coprire la fine dell'ultima riga visibile, finché non si scorre.
   - B: una fila fissa in fondo, alta un dito, che c'è sempre; il bottone ne tiene l'ultima casella e la barra di formato sale nella stessa fila. In pratica niente galleggia sul testo e niente si muove, ma il foglio perde una riga anche quando non si scrive.
   - Sdraiato tutte e due usano il tondo, all'angolo della carta.
   - Risposta (2026-11-04): A, per ora («Per ora do l'ok, la aggiustiamo più avanti, ma è sicuramente da modificare pesantemente»). B è scartata ed è uscita dal prototipo; il telefono si rifà in un piano successivo.
   - Task: T3.

## Domande per l'orchestratore

Sono proposte per gli altri piani: l'orchestratore le passa al loro pianificatore
o le decide secondo `DECISIONS.md`. Nessuna blocca questo piano.

- **K5 T25:** la testa del disegno va costruita in `kit-bar` e la colonna in `kit-rail`; il gettone del motore resta suo. Se K5 approva un prototipo diverso prima di T22, T22 segue quello.
- **N6, la lavagna:** l'utente vuole la lavagna del piano N6 (`lavagna-schede.html`), e N6 vince. Questo piano non le propone niente oltre la cornice comune:
  - N6 T41 e T50 usano `createFormatBar`, che T17 tiene con la stessa API;
  - il gettone della penna di N4 resta suo;
  - N6 T52 tiene la sua banda, e la tela resta di N6 T22;
  - T23 e N6 toccano tutti e due `editors/canvas/surface.ts` (T23 una riga sola, l'icona della modalità): chi entra per secondo ribasa.
- **A1 T12:** usare `settings-section-title` e le etichette in tondo di T10.
- **N4 e N6** su `structure.css`, `skin/editors.css`, `catalog.ts` ed `editors/canvas/surface.ts`: ognuno resta nei suoi pezzi, e chi entra per secondo ribasa.
- **T25:** per avere le foto del runner basta `gh workflow run ci.yml --ref piano/scrittoio-2`, che fa girare i banchi anche fuori dalle PR. In alternativa si segna la PR pronta, con la CI completa (Windows e macOS), che serve comunque a T26.

## Che cosa cambia, editor per editor

| Editor | Che cosa vede la persona | Task |
|---|---|---|
| Note (Markdown) | - in basso a destra «✎ Live ⌃» apre Live, Blocchi, Sorgente, poi la Lettura, con le scorciatoie<br>- la testata ha le briciole (vault › cartelle › nota), «✓ Salvato» e «…»<br>- la riga dei dati sotto il titolo<br>- il testo a 18 px su 58 caratteri, il titolo 40/46, H2 25/32<br>- i punti degli elenchi in grafite, il filo dei link a metà forza, citazione e richiamo neutri<br>- la barra di formato nella fila di serie; la Struttura con la tacca blu e «In entrata» | T2, T3, T5, T11, T12, T13, T17 |
| Documenti Word e ODT | - Pagina, Scrittura e Lettura nella banda, con le loro icone<br>- «Si scrive» passa dalla testata alla banda, mentre gli altri stati (sola lettura, chiuso) restano in testata<br>- la barra a schede prende le classi del kit, e un gruppo raccolto si apre sul posto<br>- il vassoio della barra è più vicino alla carta, e la sezione scelta è un foglietto come le schede dell'ispettore | T2, T4, T5, T16, T20, T21 |
| Fogli di calcolo | - la barra dei fogli è l'origine dello standard: la sua forma passa a `kit-ribbon-*`, il vassoio si avvicina alla carta e la sezione scelta è un foglietto come le schede dell'ispettore<br>- testata e banda come le note | T5, T16, T20 |
| Lavagna | - la cornice comune: testata, linguette, banda con la modalità<br>- la modalità con l'icona `layout-dashboard`<br>- la barra, le opzioni, la colonna e la tela sono quelle del piano N6 (`lavagna-schede.html`) | T2, T3, T5, T23 |
| Disegni | - Disegno (o Annota) e Lettura nella banda<br>- la testa del disegno nella fila di serie; la colonna degli strumenti prende la pelle `kit-rail` | T2, T3, T22 |
| SVG come testo | Diviso, Sorgente e poi Anteprima nella banda; Diviso con l'icona `split` | T2, T3 |
| File Craft | - senza anteprima, un foglietto sollevato al posto del riquadro tratteggiato<br>- le risposte sono pulsanti del kit | T19 (dopo N7) |
| PDF | - la barra di serie in cima, coi gruppi e la lente<br>- «Pagina N di M» nella banda<br>- «Apri con un'altra app» e «Copia il link alla pagina» in «…» | T18 (dopo N7) |
| Immagini e audio | solo la cornice comune: testata, linguette con la figura del formato, banda | T5, T6 |
| La shell | - la pillola diventa «Cerca o esegui un comando»<br>- i bottoni premuti del binario e della barra del titolo sono foglietti sollevati<br>- il cassetto: «Note» con ordina e nuova nota a icona, il filtro pieno con la lente, «Appuntate», «Tutte le note N», i conteggi e il gallone sottile<br>- l'ispettore a 264 px, con le schede in pozzetto e «● Segue la nota»<br>- impostazioni, componenti, avvio rapido, grafo e benvenuto con le etichette in tondo<br>- le figure accanto alle emoji nel selettore dell'icona<br>- il foglio ha un'ombra morbida a strati, che si vede ai fianchi e sfuma sotto, in giorno e notte | T7, T8, T9, T10, T14, T15, T27 |
| Telefono | - in piedi il foglio va da un bordo all'altro, senza scrivania ai fianchi né angoli tondi<br>- la testata tiene il nome, «Salvato» come spunta e «…»; un errore o un conflitto restano scritti<br>- la modalità è un'icona in un tondo in basso a destra; mentre si scrive chiude la fila della barra di formato, dopo Annulla e Ripeti, anche sopra la tastiera<br>- in piedi il marchio non c'è: la pillola, col nome della nota, parte dal bordo; sdraiato il marchio resta<br>- «Si scrive» sta in «…»<br>- in piedi il foglio non ha ombra, perché tocca i bordi; sdraiato l'ombra si vede solo ai fianchi | T2, T3, T4, T5, T7, T27 |

## Lo standard delle barre

L'origine è la barra dei fogli, `apps/client/src/kit/ribbon/ribbon.ts`, che
oggi monta i prefissi `grid-ribbon` e `rich-ribbon`. Da lì nascono tre forme,
tutte scritte una volta nel proprietario.

| Forma | Classi | Chi la usa | Dove vive |
|---|---|---|---|
| barra a schede | `kit-ribbon`, `kit-ribbon-<parte>` | fogli, documenti | comportamento in `kit/ribbon/ribbon.ts`, forma in `theme/scrittoio/structure.css`, pelle in `theme/scrittoio/skin/kit.css` |
| barra in una fila | `kit-bar`, `kit-bar-group`, `kit-bar-button`, `kit-bar-field`; per il troppo `kit-options` e `kit-options-more` (`kit/options-bar.ts`) | barra di formato delle note, testa del disegno, PDF (la lavagna segue N6) | classi sul DOM che c'è, frecce in `kit/toolbar-keys.ts` (nuovo), forma e pelle come sopra |
| colonna | `kit-rail` (`kit/tool-rail.ts`) | colonna degli strumenti del disegno | `theme/scrittoio/skin/kit.css` |

- **Barra a schede:** è il vassoio mezzo tono sotto la carta (il ruolo `--bar-tray`, che nasce con T16), coi foglietti che hanno un nome; di notte i foglietti sono di carta alzata, con un filo. I pulsanti sono alti 28, il velo d'accento segna ciò che è acceso, e i gruppi si raccolgono quando manca spazio. Le sezioni sono le schede dell'ispettore: un pozzetto, e la scelta è un foglietto di carta alzata che scorre. T20 fa emettere al kit `kit-ribbon-<parte>` accanto a `<prefisso>-<parte>`; ai fogli e ai documenti restano solo i pezzi loro (tavolozza, galleria, campioni, «Comandi», formula, schede).
- **Barra in una fila:** lo stesso vassoio e gli stessi pulsanti, su una riga. Ciò che non ci sta va in «…», oppure scorre di lato dove oggi scorre. Le frecce sono le stesse dappertutto: un solo punto di Tab per barra, frecce sinistra e destra, Home ed End.
- **Colonna:** la stessa pelle, in verticale.
- **Come la adotta un editor:** mette le classi sul DOM che ha già, toglie le sue regole di forma e di pelle che le duplicano, e tiene solo ciò che è suo.
- Nessun componente nuovo oltre `kit/toolbar-keys.ts`, nessuna IPC e nessun WIT.

## Le fasi

Sono le quattro fasi della bozza, allargate a tutti gli editor, con una fase
di prova in testa e la fase delle barre prima della chiusura.

| Fase | Task | Che cosa |
|---|---|---|
| 0 · I test che fissano oggi | T1 | menu delle modalità, banda, «Si scrive», frecce della barra di formato, briciole |
| 1 · La modalità dalla banda, la testata | T2, T3, T4, T5 | il menu in un posto solo, la voce «Live» della banda, «Si scrive» nella banda, la testata con le briciole |
| 2 · La pelle della cornice e del cassetto | T6, T7, T8, T9, T10, T27 | linguette, pillola e pulsanti premuti, cassetto, ispettore, impostazioni e affini; l'ombra del foglio (T27 gira dopo T17, che tocca i suoi stessi file) |
| 3 · La tipografia del foglio | T11 | 18/58, titoli, elenchi, link, citazione, richiamo |
| 4 · Le novità | T12, T13, T14, T15 | riga dei dati, «In entrata», figure, vault del banco |
| 5 · Lo standard delle barre | T16–T23 | kit-bar e kit-rail col vassoio più chiaro, barra di formato, PDF, Craft, kit-ribbon con le sezioni come l'ispettore, barra del documento, testa del disegno, l'icona della lavagna |
| 6 · Banco e chiusura | T24, T25, T26 | scene nuove, baseline dal runner, CI completa e rilettura |

## Come si incastra coi piani in corso

La base è `main` a `3f4f3731`. L'orchestratore fonde `main` nel ramo del piano
ogni volta che entra uno dei piani qui sotto.

| Piano | Stato (2026-11-04) | Che cosa aspetta che cosa | Chi si adatta, quando |
|---|---|---|---|
| caricamento (PR #308) | 0/4, coder di T1 al lavoro | - T3, T7 e T8 aspettano il suo T1 (`index.html`, `mobile.html`, `catalog.ts`)<br>- T5 aspetta il suo T2 (`desktop-shell.ts`)<br>- T11, T12, T13, T15 e T24 aspettano il suo T4 (`bench/fake-ipc.ts`, `bench/scene.mjs`)<br>- T17 aggiunge solo il parametro `?formatbar=1` a `bench/fake-ipc.ts`: non aspetta, e chi entra per secondo ribasa<br>- T3 cambia in `bench/scene.mjs` e `bench/interaction.mjs` solo i clic sul bottone della modalità: non aspetta il suo T4, e chi entra per secondo ribasa<br>- su `docs/architecture/frontend-and-ipc.md` (T11, T16, T17) basta stare nei propri pezzi | questo piano, dopo la sua fusione |
| N7 (PR #299) | 33/34 | T18 e T19 aspettano N7 in `main` (barra del PDF, scheda Craft, le loro scene) | questo piano, dopo la fusione |
| K2 (PR #290) | 7/7, non ancora in `main` | T10 aspetta K2 in `main` (impostazioni) | questo piano |
| K3 | 16/19 (T17, T19 da fare) | T20 e T21 aspettano K3 in `main`: porta `openInPlace` e cambia `kit/ribbon/` | questo piano |
| griglia | 0/8 (la sua PR va su `piano/k3-motori` finché K3 non è in `main`) | - T20 aspetta griglia in `main` (`skin/editors.css`, parte dei fogli)<br>- T24 aspetta il suo T8 (scene) | questo piano |
| A1 | 5/13 | - A1 T12 e T10 toccano le impostazioni: chi entra per secondo ribasa<br>- T24 aspetta A1 T13 (scene) | proposta per A1 T12 (sopra) |
| K5 | 8/30 | T22 segue il prototipo di K5 T25 se è approvato prima | proposta per K5 T25 (sopra) |
| N4 | 14/25 (T12–T17, T21–T25 aperti) | nessuna attesa; ognuno resta nei suoi pezzi di `structure.css` ed `editors.css` | — |
| N6 (PR #302) | 10/90 | - la lavagna è sua (`lavagna-schede.html`, T22 e T49–T52): qui prende solo la cornice comune<br>- T23 non lo aspetta: aggiunge una riga a `editors/canvas/surface.ts`, che N6 cambia in molti task, e chi entra per secondo ribasa<br>- T2 non tocca `document-controller.ts` per non incrociarlo | chi entra per secondo su `surface.ts` (sopra) |
| n7, k3, griglia, A1 e caricamento sul banco | — | - T24 aspetta le scene di griglia T8, A1 T13, caricamento T4, K3 T17 e N7 T32<br>- `bench/scene.test.ts` vuole tutte le baseline o nessuna: T24 le toglie tutte e T25 le rimette dal runner, una volta, con tutte le scene dentro | T24, T25 |

Quando un'ondata aspetta un piano esterno, l'orchestratore può anticipare un
task dell'ondata dopo che non aspetta niente, purché i «Tocca» restino
disgiunti da quelli del task che gira.

## Come funziona (per tutti i task)

- **CSS dal prototipo:**
  - si copia dai blocchi `<style data-destinazione="…">` di `PLAN-ui/scrittoio-2.html`: ogni task dice quali righe;
  - si incolla in coda al file di destinazione o accanto alla regola che sostituisce, togliendo la regola vecchia quando quella nuova la rende inutile;
  - ogni classe nuova entra nei ganci del suo pezzo in `src/theme/scrittoio/anatomia/`;
  - solo i gettoni della serie `theme-2`, nessun colore scritto a mano.
- **Le icone del prototipo:**
  - `dots` è `more` della cornice (`shells/scrittoio/icons.ts`), che ha già anche `check`, `plus` e `star`: queste non si ridisegnano;
  - le altre vanno in `ui/icons.ts`, nella forma `nome: '<path …/>'` della mappa `SVG`.
- **Dopo ogni CSS**, da `apps/client/`:
  - `npm run theme:generate && npm run theme:verify`;
  - `npx vitest run src/theme/scrittoio`.
  - Una regola rifiutata dal sanificatore toglie lo stile a tutta l'app: lo prende `src/theme/gate.test.ts`.
  - I file generati (`skin.css`, `sheet-*.css`, `theme/author/*`) sono gli unici che due task della stessa ondata possono toccare entrambi; dopo ogni fusione l'orchestratore li rigenera.
- **La foto:**
  - con una sonda del banco (skill `banco`): un file a punto in `apps/client/bench/`, per esempio `bench/.probe-t5.mjs`, che usa `openStage()` e `openPage()`; le PNG vanno in `$TMPDIR`, mai nel repo, e la sonda si cancella alla fine;
  - si fotografano giorno e notte e, dove il prototipo ha lo stato stretto, 700×800, poi si confrontano con il prototipo aperto da file: `file://<worktree>/PLAN-ui/scrittoio-2.html?stato=<id>&luce=light` (o `luce=dark`, `larghezza=700`);
  - il banco ha una porta sola (1431), quindi due coder non lo usano insieme: se `ss -ltn | grep 1431` la trova occupata, si aspetta;
  - mentre gira il banco non si cambiano file sotto `apps/client`;
  - il report allega i percorsi delle foto e dice che cosa resta diverso e perché.
- **Le baseline:** nessun task tocca `apps/client/bench/baseline/` prima di T24, che le toglie tutte; T25 le rimette tutte dal runner. Mai `bench:update` in locale.
- **Le stringhe:** in `src/i18n/catalog.ts`, italiano e inglese nello stesso task; le stringhe dell'host stanno nel catalogo Rust della feature, in tutte e due le lingue.
- **Ogni ascoltatore** passa da `lifetime.listen` o ha il suo disposer (`check-listeners`).
- **La pagina di `docs/`** che descrive il comportamento cambia nello stesso task, e le guardie dei documenti restano verdi.
- **I file che altri piani toccano** (`structure.css`, `skin/editors.css`, `catalog.ts`, `bench/fake-ipc.ts`): si cambiano solo i pezzi del task, senza riordinare né riformattare il resto.
- **Gli stati del prototipo e le scene del banco più vicine:**
  - nota → `live-01-panoramica`, `explore`;
  - documento → `document-docx`;
  - sola-lettura → `document-readonly`;
  - foglio → `grid-workbook`;
  - disegno → `draw-open`;
  - impostazioni → `settings`;
  - componenti → `settings-components`;
  - ricerca → `search`;
  - grafo → `graph`;
  - icone → `menu-albero-cartella`;
  - vuoto → `empty`;
  - zero → `launcher-empty`;
  - tel-nota → `mobile-startup`;
  - tel-doc → `mobile-document`;
  - con K3 in `main`: tel-foglio → `mobile-grid-ribbon`; caricamento, errore e molti → `grid-result-loading`, `grid-result-error` e `grid-result-many`;
  - con N7 in `main`: craft → `craft-domanda`; pdf → `pdf-domanda`;
  - tel-ferma → `mobile-startup` col fuoco fuori dal testo; tel-sdraiato → `mobile-startup` a 844×390; tel-tastiera → `mobile-keyboard`;
  - barra non ha ancora una scena: la sonda prepara lo stato da sé, e la scena la aggiunge T24.
  - Il cassetto sul telefono (`mobile-sheet`) non ha uno stato nel prototipo: prende le stesse regole del computer.

## Dal prototipo

Le righe sono quelle di `PLAN-ui/scrittoio-2.html` al momento della consegna.

| Pezzo | Destinazione | Task |
|---|---|---|
| ispettore a 264, schede in cima, righe degli elenchi (180–183, 192–215) | `apps/client/src/theme/scrittoio/structure.css` | T9 |
| la modalità fuori dalla testata (184–191) | `structure.css` | T3 |
| la banda stretta (216–227) | `structure.css` | T4 |
| la scrivania che lascia uscire l'ombra del foglio (228–275) | `structure.css` | T27 |
| la forma della barra a schede (277–556) | `structure.css` | T20 |
| la forma della barra in una fila (558–601) | `structure.css` | T16 |
| la galleria degli stili del documento (603–611) | `structure.css` | T21 |
| la pelle della barra a schede (615–972) | `theme/scrittoio/skin/kit.css` | T20 |
| il vassoio più chiaro della barra a schede (974–1000) | `skin/kit.css`, fuso nella pelle sopra | T20 |
| le sezioni come le schede dell'ispettore (1002–1042) | `skin/kit.css`, fuso nella pelle sopra | T20 |
| la pelle della fila e della colonna, già sul vassoio `--bar-tray` (1044–1195) | `skin/kit.css` | T16 |
| il pulsante premuto e la pillola (1199–1243) | `skin/frame.css` | T7 |
| l'ispettore (1245–1291) | `skin/frame.css` | T9 |
| la modalità nella banda (1293–1319) | `skin/frame.css` | T3 |
| «Si scrive» nella banda (1320–1338) | `skin/frame.css` | T4 |
| spazi, titolo del cassetto, etichette di sezione (1342–1480) | `skin/drawers.css` | T8 |
| il selettore dell'icona (1482–1524) | `skin/drawers.css` | T14 |
| filtro, righe, conti, gallone (1528–1596) | `skin/tree.css` | T8 |
| la testata del foglio (1600–1647) | `skin/sheets.css` | T5 |
| linguette e scrivania (1649–1674) | `skin/sheets.css` | T6 |
| l'ombra del foglio (1676–1688) | `skin/sheets.css` | T27 |
| titoli, elenchi, link, citazione, richiamo (1692–1814) | `skin/document.css` | T11 |
| la riga dei dati (1816–1856) | `skin/document.css` | T12 |
| il PDF e il contatore delle diapositive (1860–1905) | `skin/media.css` | T18 |
| i file Craft (1907–1964) | `skin/media.css` | T19 |
| la struttura e le sezioni delle viste (1968–2010, 2072–2081) | `skin/nodes.css` | T9 |
| «In entrata» e l'icona della voce (2012–2070) | `skin/nodes.css` | T13 |
| il grafo (2085–2092) | `skin/graph.css` | T10 |
| il menu delle modalità, B compreso (2096–2137) | `skin/menus.css` | T10 |
| l'avvio rapido (2141–2147) | `skin/launcher.css` | T10 |
| «Salvato» con la spunta (2151–2175) | `skin/centres.css` | T5 |
| le impostazioni (2179–2202) | `skin/settings.css` | T10 |
| il benvenuto (2206–2212) | `skin/welcome.css` | T10 |
| telefono: la testata (2216–2227) | `apps/client/src/shells/scrittoio/mobile/mobile.css` | T5 |
| telefono: «Si scrive» (2228–2232) | `mobile.css` | T4 |
| telefono: la pastiglia H1 nascosta (2233–2239) | `mobile.css` | T11 |
| telefono in piedi: l'involucro `@media (max-width: 599px)` (2241 e 2280), con dentro le tre righe sotto | `mobile.css` | T5 |
| telefono in piedi: il foglio da un bordo all'altro (2242–2252) | `mobile.css` | T5 |
| telefono in piedi: senza il marchio (2254–2265) | `mobile.css`, dentro l'involucro | T7 |
| telefono in piedi: «Salvato» in figura (2267–2279) | `mobile.css` | T5 |
| telefono: la modalità nel tondo in basso a destra, il pulsante dei commenti alla sua sinistra (2282–2330) | `mobile.css` | T3 |
| telefono in piedi: la modalità piatta nella fila della barra di formato (2332–2355) | `mobile.css` | T3 |
| telefono: l'ombra del foglio, nessuna in piedi e solo ai fianchi sdraiato (2357–2375) | `mobile.css` | T27 |
| 18 px e 58 caratteri (2378–2385) | `theme/scrittoio/series.ts`, `recipe.ts`, `state/zoom.ts`, `crates/fub-host/src/settings.rs` | T11 |
| i ruoli nuovi della ricetta (2388–2415) | `theme/scrittoio/recipe.ts` | T16 (`--bar-tray`), T27 (`--shadow-sheet`, `--shadow-sheet-focus`) |
| icone delle modalità e del cassetto (2482–2493) | `apps/client/src/ui/icons.ts` | T2 |
| figure monocrome (2494–2506, senza `star`, che la cornice ha già) | `ui/icons.ts` | T14 |
| testi nuovi | `apps/client/src/i18n/catalog.ts` | T5, T7, T8, T9, T12, T14, T18 |
| gli stati da fotografare | `apps/client/bench/scene.mjs` | T24 |

Le varianti «com'era» (righe 2418–2479, `data-variante="prima-*"`) servono
solo al confronto e non vanno nel codice.

## T1 · I test che fissano il comportamento di oggi

Perché: le fasi 1–5 spostano la modalità, «Si scrive», la testata e le frecce della barra di formato, e prima di toccarli servono test che dicano che cosa non deve cambiare.
Tocca: `apps/client/src/panels/document.test.ts`, `apps/client/src/shells/scrittoio/frame/status-band.test.ts`, `apps/client/src/panels/standing.test.ts`, `apps/client/src/panels/format-bar.test.ts`, `apps/client/src/shell.e2e.test.ts`
Non toccare: nessun file di produzione; `apps/client/bench/baseline/`; i test che ci sono già si allargano, non si riscrivono.
Dipende da: nessuno
Cosa fare:
- `document.test.ts`, il menu della modalità:
  - il clic su `.pane-mode-current` elenca le modalità della superficie e ne segna una sola (`checked`);
  - la voce scelta cambia la modalità del riquadro a fuoco e non quella dell'altro;
  - l'ordine delle voci non si fissa, perché T2 lo cambia.
- `document.test.ts`, la testata: le briciole (le cartelle con `data-folder`, poi il nome) e il menu «…» con le voci di oggi, per nome.
- `status-band.test.ts`: con due riquadri la banda dice la modalità di quello a fuoco, e cambia quando il fuoco passa all'altro; con una modalità sola `#status-mode` resta nascosto.
- `standing.test.ts`: i quattro tipi (`writes`, `closed`, `body`, `readonly`) danno il loro testo e il loro `data-standing`; `follow(null)` nasconde il chip.
- `format-bar.test.ts`: un solo punto di Tab per la barra; ← e → passano al pulsante vicino, Home e Fine al primo e all'ultimo, e i pulsanti spenti si saltano.
- `shell.e2e.test.ts`: con due riquadri aperti, `shell.mode.source` cambia solo quello a fuoco.
- Ogni test nuovo si vede rosso rompendo a mano la riga di produzione che fissa, poi la riga torna com'era; il report dice quale riga.
Dal prototipo: niente, il task non è grafico.
Casi limite: una superficie con una modalità sola (un'immagine); un riquadro senza documento; il fuoco su un riquadro vuoto; un documento in sola lettura.
Fatto quando: i test nuovi passano su `main` senza cambiare la produzione (`git diff --stat` elenca solo i cinque file di test), e ognuno è stato visto rosso.
Prova: scripts/check.sh --rapido
Stato: [x] fatto · 98a1af7f · il documento in sola lettura non si prova in `document.test.ts`, perché l'host finto non ha i file in sola lettura: lo prova `standing.test.ts` (`readonly`)

## T2 · Il menu delle modalità, in un posto solo

Perché: la banda, la testata del telefono e il comando devono aprire lo stesso menu, con lo stesso ordine, le stesse icone e le scorciatoie vere della persona.
Tocca: `apps/client/src/state/mode-menu.ts` (nuovo), `apps/client/src/state/mode-menu.test.ts` (nuovo), `apps/client/src/editors/core/registry.ts`, `apps/client/src/editors/text/profiles/markdown/surface.ts`, `apps/client/src/editors/text/profiles/svg.ts`, `apps/client/src/editors/rich/surface.ts`, `apps/client/src/ui/icons.ts`, `apps/client/src/panels/document.ts`, `apps/client/src/panels/document.test.ts`, `apps/client/src/shell.e2e.test.ts`, `docs/architecture/editor-surfaces.md`
Non toccare: `apps/client/src/state/document-controller.ts` (lo cambia N6: `selectedMode` e `setMode` si usano come sono); `apps/client/src/ui/menu.ts`; `apps/client/src/editors/spatial/modes.ts`; `apps/client/src/editors/canvas/surface.ts` (T23); `apps/client/src/editors/text/profiles/markdown/hints.ts`; `apps/client/src/shells/scrittoio/icons.ts`; `apps/client/src/ui/shell-keys.generated.ts`.
Dipende da: T1
Cosa fare:
- `SurfaceMode` (`registry.ts`) prende `icon?: string`, un nome che `icon()` di `ui/icons.ts` sa disegnare.
  - Senza icona vale quella del ruolo: `live_preview` → `pen`, `source` → `code`, `reading` → `eye`.
  - Le icone esplicite:
    - Blocchi `blocks` (`markdown/surface.ts`);
    - Diviso dell'SVG `split` (`svg.ts`);
    - Pagina, Scrittura e Lettura del documento `rc-mode-page`, `rc-mode-writing` e `rc-mode-reading` (`rich/surface.ts`), che `rich/icons.ts` registra già.
- In `ui/icons.ts`, in un pezzo solo in coda alla mappa `SVG`, vanno `pen`, `blocks`, `code`, `eye`, `compose`, `sort`, `clock` e `chevron-up`, copiate dal prototipo. `compose` e `sort` servono a T8, `clock` a T12.
- `state/mode-menu.ts` esporta `modeMenuItems(paneId): MenuItem[]` e `openModeMenu(anchor, paneId, { onClose? })`.
  - L'ordine: prima le modalità `live_preview` nell'ordine dichiarato, poi `source`, poi un separatore e la `reading`. Senza lettura, niente separatore.
  - Ogni voce porta `icon`, `choice: "radio"`, `run: () => void setMode(mode.id)`, e la corrente ha sia `checked` sia `selected`.
  - `hint` è la scorciatoia del comando che porta lì, letta da `allCommands()` (`ui/commands.ts`, che rispetta le scorciatoie cambiate dalla persona) e scritta con `displayBinding`:
    - Blocchi → `shell.mode.blocks`;
    - Lettura → `shell.mode.reading`;
    - Sorgente → `shell.mode.source`;
    - la prima `live_preview` che non è Blocchi → `shell.mode.live`;
    - un comando senza tasto lascia la voce senza `hint`.
  - `openModeMenu` porta il fuoco al riquadro (`focusPane`), mette `aria-expanded="true"` sull'ancora, apre `showContextMenu(anchor, items, { onClose })` e rimette `aria-expanded="false"` alla chiusura.
- Le modalità che prendono `icon:` restano scritte su una riga sola: `editors/core/surface-looks.test.ts` (riga 25, `MODE`) le legge dai sorgenti con una regola che non passa a capo.
- In `panels/document.ts` il bottone `.pane-mode-current` (intorno alle righe 1034–1052):
  - il clic chiama `openModeMenu` e non costruisce più le voci da sé;
  - al posto di `current.textContent = …` (intorno alla riga 1103) disegna l'icona della modalità accesa e poi `span.pane-mode-name` col nome; l'`aria-label` resta quello di oggi, e `setTooltip` gli dà il nome. L'icona si riscrive solo quando la modalità cambia. Sul telefono questo bottone diventa il tondo di T3, che mostra solo l'icona.
- `document.test.ts`: il bottone ha l'icona della modalità accesa, il nome nello `span` e il suggerimento, e li cambia quando la modalità cambia.
- `shell.e2e.test.ts` (intorno alle righe 3626–3644): l'ordine diventa Live, Blocchi, Sorgente, Lettura.
- `docs/architecture/editor-surfaces.md` dice di `icon` e dell'ordine del menu.
Dal prototipo: le icone delle modalità e del cassetto (righe 2482–2493, in `ui/icons.ts`: le otto sopra; `check`, `dots` e `plus` ci sono già nella cornice); il menu aperto dello stato `nota` per l'ordine, le icone e le scorciatoie.
Casi limite:
- una superficie con una modalità sola: nessun menu;
- la lavagna: le modalità che le dà N6 (oggi Lavagna e Sorgente, senza separatore); la sua icona arriva con T23, e fino ad allora vale quella del ruolo;
- il disegno: Disegno (o Annota), il separatore e Lettura;
- un comando senza tasto: niente `hint`;
- una scorciatoia cambiata dalla persona: compare quella;
- un'icona sconosciuta: vale quella del ruolo;
- il riquadro chiuso mentre il menu è aperto: la voce non fa niente e non lancia;
- il clic sul bottone di un riquadro senza fuoco quando il clic non dà il fuoco al bottone (Safari e la WebView di macOS): il menu, chiudendosi, rende il fuoco all'elemento di prima, l'editor dell'altro riquadro, e `setMode` (che legge `layout.focus`) cambierebbe l'altro riquadro. Visto scrivendo T1, in jsdom senza `focus()`; la voce porta il fuoco al suo riquadro prima di `setMode`, e `mode-menu.test.ts` lo prova senza dare il fuoco al bottone;
- in inglese, le etichette delle modalità vengono già dal catalogo.
Fatto quando:
- `mode-menu.test.ts` fissa l'ordine per Markdown, SVG, documento e disegno, le icone, gli `hint` (anche quello cambiato) e `setMode` sul riquadro giusto;
- `document.test.ts` vede l'icona, il nome e il suggerimento del bottone della testata, e `editors/core/surface-looks.test.ts` passa;
- i test di T1 restano verdi (tranne l'ordine, che qui cambia apposta) e l'e2e vede Live, Blocchi, Sorgente, Lettura.
Prova: scripts/check.sh --rapido
Stato: [x] fatto · e7630eef · differenze: il menu e `icon` sono descritti in `docs/architecture/frontend-and-ipc.md` («Menu delle modalità») e non in `editor-surfaces.md`, che è a 450 righe, il limite di `check-doc-size`; le modalità del documento salgono a livello di modulo (`RICH_MODES`) perché il test le legga; `split` lo registra la cornice (`shells/scrittoio/icons.ts`), quindi fuori dalla cornice il Diviso ha la penna del ruolo; il suggerimento del bottone è il nome della modalità; `ui/icons.test.ts` conta 51 icone invece di 43. `check.sh --rapido`: rossi solo `theme/runtime.test.ts` e `editors/grid/engine.test.ts` per tempo scaduto sotto carico, verdi da soli; al primo giro anche `markdown/block-id.test.ts` (passo 253), verde da solo e al secondo giro

## T3 · La modalità si sceglie dalla banda

Perché: nel mockup la modalità sta in basso a destra («✎ Live ⌃»), e la testata del foglio resta pulita. Sul telefono l'utente la vuole in basso a destra anche lui, come icona, alla stessa altezza di Annulla e Ripeti.
Tocca: `apps/client/index.html`, `apps/client/mobile.html`, `apps/client/src/shells/scrittoio/frame/status-band.ts`, `apps/client/src/shells/scrittoio/frame/status-band.test.ts`, `apps/client/src/theme/scrittoio/skin/frame.css`, `apps/client/src/theme/scrittoio/anatomia/frame.ts`, `apps/client/src/theme/scrittoio/structure.css`, `apps/client/src/shells/scrittoio/mobile/mobile.css`, `apps/client/src/panels/document.ts`, `apps/client/src/panels/document.test.ts`, `apps/client/src/surface-modes.e2e.test.ts`, `apps/client/src/shell.e2e.test.ts`, `apps/client/bench/scene.mjs`, `apps/client/bench/interaction.mjs`, `docs/product/editor-and-preview.md`
Non toccare: `apps/client/src/state/mode-menu.ts` (si usa com'è); i comandi `shell.mode.*`; i bottoni `#status-fit-width`, `#status-fit-page` e `#status-zoom`; `skin/sheets.css` e `anatomia/sheets.ts` (T6 nella stessa ondata; la pelle vecchia del bottone la toglie T17); i segmenti `.segmented` della testata, che restano nel DOM (li usano i test jsdom) e si nascondono col CSS.
Dipende da: T1, T2, T5 (le foto del telefono hanno senso con la testata e il foglio di T5)
Cosa fare:
- Il bottone `.pane-mode-current` esce dalla testata: `.pane-toolbar` taglia ciò che sporge, e sul telefono il bottone deve stare all'angolo basso della carta.
  - In `panels/document.ts` nasce dove nasce oggi (intorno alla riga 1037), ma va nel foglio subito dopo la barra di formato: `root.append(tabsShell, toolbarEl, formatBar.element, …)` (riga 432) lo prende dopo `formatBar.element`, e `bar.append(…)` (riga 1063) non lo prende più.
  - Il riquadro tiene il riferimento al bottone, al posto di `bar.querySelector(":scope > .pane-mode-current")` (riga 1069).
  - Il fuoco di riserva quando si chiude la linguetta a fuoco (`r.toolbarEl.querySelector('button[aria-haspopup="menu"]')`, intorno alla riga 569) va a «…», che resta nella testata.
  - `document.test.ts`: il bottone è un figlio del foglio dopo `.format-bar`, nel giro del Tab dopo la barra, e la chiusura della linguetta porta il fuoco a «…».
- In `index.html` e `mobile.html` `#status-mode` diventa `<button type="button" id="status-mode" class="status-item status-item--button status-mode" aria-haspopup="menu" aria-expanded="false" hidden>`, nello stesso posto dentro `#status-end`.
- `status-band.ts` lo riempie col riquadro a fuoco:
  - l'icona della modalità (quella di T2), poi `span.status-mode-name` col nome, poi `span.status-mode-arrow` con `chevron-up` e `aria-hidden`;
  - `aria-label` da `t("document.toolbar.mode_current", { mode })`;
  - resta nascosto se la superficie a fuoco ha una modalità sola o se non c'è un documento.
- Clic, Invio, Spazio e ↑ chiamano `openModeMenu(button, focusedPaneId)`. Gli ascoltatori passano da `lifetime.listen`. Alla chiusura il fuoco torna al bottone.
- `structure.css`:
  - la testata non mostra più `.pane-toolbar > .segmented`, e il bottone del foglio non si vede (righe 184–191 del prototipo);
  - escono le regole che diventano inutili: quella dei segmenti con `order: 2` (righe 908–913, e il commento sopra perde «poi il selettore») e quella del bottone con il suo `@container sheet-head (max-width: 440px)` (righe 920–937).
- `mobile.css`, dove la banda non c'è (in piedi, e sdraiato sotto i 500 px di altezza):
  - il bottone è un tondo alto un dito all'angolo basso a destra della carta, con la sola icona; il pulsante dei commenti del documento si sposta alla sua sinistra (righe 2282–2330);
  - in piedi, mentre si scrive, diventa piatto e chiude la fila della barra di formato, dopo Annulla e Ripeti, anche sopra la tastiera (righe 2332–2355);
  - la regola che nasconde la barra di formato quando non si scrive (riga 333, `.pane:not(:has(.cm-focused)) > .format-bar…`) prende anche `:not(:has(> .pane-mode-current[aria-expanded="true"]))` sul foglio: col suo menu aperto la barra resta, e il bottone non salta. Aprire il menu porta il fuoco fuori dal testo, e la tastiera si chiude.
- I clic del banco che cercavano i segmenti della testata (si nascondono, e Playwright non clicca ciò che non si vede): `bench/scene.mjs` righe 249, 258, 432–434 e 1088–1091, `bench/interaction.mjs` riga 217.
  - Un aiuto solo, in `scene.mjs`: se `#status-mode` si vede lo clicca, se no clicca `.pane.focus > .pane-mode-current`; poi `#context-menu [role="menuitemradio"]` col nome della modalità. `interaction.mjs` fa lo stesso.
- `shell.e2e.test.ts`, riga 3626: il bottone è `.pane.focus > .pane-mode-current`. I test jsdom che cercano i segmenti (righe 1165, 1209, 3620, 3628) restano come sono.
- `surface-modes.e2e.test.ts`: sul computer la modalità si cambia da `#status-mode`.
- `docs/product/editor-and-preview.md`, sezione «Modalità»: il commutatore è la voce della banda per il riquadro a fuoco; sul telefono, dove la banda non c'è, è il tondo in basso a destra, che mentre si scrive sta nella fila della barra di formato.
Dal prototipo: `structure.css` 184–191; `skin/frame.css` 1293–1319; `mobile.css` 2282–2330 e 2332–2355; gli stati `nota` (il menu aperto), `documento` (la banda dice «Pagina»), `tel-nota`, `tel-ferma`, `tel-tastiera`, `tel-sdraiato`, `tel-doc` e `tel-foglio`.
Casi limite:
- nessun documento aperto (il benvenuto): la voce della banda e il tondo sono nascosti;
- un'immagine, un PDF o un foglio di calcolo (una modalità sola): nascosti; `tel-foglio` non ha il tondo;
- due riquadri: il nome segue il fuoco;
- il riquadro si chiude col menu aperto: il menu si chiude;
- Esc chiude e il fuoco torna al bottone;
- il nome lungo in inglese («Live preview»);
- la finestra a 700 px;
- il menu vicino al bordo basso si apre verso l'alto;
- telefono: il tondo può coprire la fine dell'ultima riga visibile in basso a destra; se la foto lo mostra su testo vero, il foglio prende in fondo un margine alto un dito più lo spazio del tondo;
- telefono sdraiato a 844×390: la banda si è ritirata e c'è il tondo, all'angolo anche mentre si scrive (la barra di formato sta in cima); il marchio resta;
- telefono, `tel-doc`: il pulsante dei commenti sta a sinistra del tondo, sulla stessa riga;
- telefono, il menu aperto mentre si scrive: la fila della barra resta finché il menu è aperto, poi il fuoco torna al bottone.
Fatto quando:
- `status-band.test.ts` vede il nome e l'icona del riquadro a fuoco, il menu che si apre col bottone e `setMode` sul riquadro giusto;
- `document.test.ts` vede il bottone fuori dalla testata;
- l'e2e passa, e le scene `reading`, `source`, `nota-tre-modi` e quelle che passano dall'aiuto di `scene.mjs` (riga 1088) arrivano alla modalità giusta;
- la foto del banco di `live-01-panoramica`, in giorno e notte, a 1280 e a 700, col menu chiuso e aperto, sta accanto a `?stato=nota`, e quella di `document-docx` accanto a `?stato=documento`; la testata non ha più il bottone della modalità;
- sul telefono, in giorno e notte: `mobile-startup` accanto a `?stato=tel-nota`, la stessa col fuoco fuori dal testo accanto a `?stato=tel-ferma`, `mobile-keyboard` accanto a `?stato=tel-tastiera`, `mobile-startup` a 844×390 accanto a `?stato=tel-sdraiato`, `mobile-document` accanto a `?stato=tel-doc`.
Prova: scripts/check.sh --rapido
Stato: [x] fatto · dc57be1d..a4298fa9 · la modalità è una voce della banda (figura, nome, freccia; clic, Invio, Spazio e ↑; Esc rende il fuoco), sul telefono il tondo in basso a destra, piatto nella barra di formato mentre si scrive; nessun bottone nella testata; l'anello di PA T47 resta (6,2:1 in chiaro, 6,9:1 al buio) · differenze: dopo la scelta il fuoco va all'editor (lo fa setMode); il tondo nasce in createPane; `docs/architecture/shell-behaviours.md` aggiornata · l'orchestratore ha aggiunto a `icon-names.json` le icone di T2 (rosso dopo l'unione di main con PA T40) · resta: per un docx il tondo del telefono mostra la penna finché `useRichIcons` non si chiama al montaggio di `editors/rich/surface.ts` (da fare con T7 o T17)

## T4 · «Si scrive» nella banda

Perché: «Si scrive» è lo stato normale di un documento, e nel mockup lo dice la banda a voce bassa invece di un chip in testata; gli stati che chiedono attenzione restano in testata.
Tocca: `apps/client/src/shells/scrittoio/frame/status-band.ts`, `apps/client/src/shells/scrittoio/frame/status-band.test.ts`, `apps/client/src/panels/standing.ts`, `apps/client/src/panels/standing.test.ts`, `apps/client/src/state/store.ts`, `apps/client/src/panels/document.ts`, `apps/client/src/theme/scrittoio/structure.css`, `apps/client/src/theme/scrittoio/skin/frame.css`, `apps/client/src/theme/scrittoio/anatomia/frame.ts`, `apps/client/src/shells/scrittoio/mobile/mobile.css`, `docs/product/editor-and-preview.md`, `docs/architecture/editor-surfaces.md`, `docs/product/word-documents.md`
Non toccare: `SurfaceStandingKind` e il suo testo (`editors/core/registry.ts`); i tipi `closed`, `body` e `readonly`, che restano nel chip della testata; `index.html` (il bottone nasce in JS).
Dipende da: T1, T3
Cosa fare:
- `status-band.ts` crea in JS `#status-standing` come `button.status-item.status-item--button.status-standing[data-surface-item="standing"]`, subito prima di `#status-mode`.
  - Segue `paneOf(layout.focus)?.surface?.standing` e si vede solo col tipo `writes`.
  - Il testo è quello del chip di oggi.
- Il clic apre la stessa spiegazione del chip:
  - `standing.ts` prende `openFrom(anchor)`, usato dal chip e dalla banda;
  - la banda emette il segnale nuovo `standing-open` dello store, con l'ancora come argomento, e `document.ts` lo ascolta e apre la spiegazione del riquadro a fuoco.
- `structure.css`:
  - sul computer la testata nasconde `.pane-standing[data-standing="writes"]`;
  - sotto gli 800 px la banda nasconde `[data-surface-item="language"]` (righe 216–227 del prototipo).
- Telefono:
  - `mobile.css` nasconde il chip `writes` (righe 2228–2232);
  - il menu «…» della testata prende in cima la voce «Si scrive», che apre la stessa spiegazione;
  - gli altri tipi restano dove sono.
- Le pagine di `docs/`:
  - `docs/product/word-documents.md`, il paragrafo del chip: «Si scrive» lo dice la banda;
  - `docs/product/editor-and-preview.md`;
  - `docs/architecture/editor-surfaces.md`, la parte sullo stato della superficie.
Dal prototipo: `structure.css` 216–227; `skin/frame.css` 1320–1338; `mobile.css` 2228–2232; gli stati `documento`, `sola-lettura` e `tel-doc`.
Casi limite:
- il tipo cambia con la spiegazione aperta (il file diventa di sola lettura): la banda si spegne, la spiegazione si chiude e il chip compare in testata;
- due riquadri con tipi diversi: la banda segue il fuoco;
- il fuoco passa a un riquadro vuoto;
- a 700 px la lingua sparisce, «Si scrive» e la modalità restano;
- ogni tipo ha il suo nome per il lettore di schermo.
Fatto quando:
- `status-band.test.ts` e `standing.test.ts` vedono `writes` nella banda e non in testata, gli altri tipi in testata, e la stessa spiegazione aperta dai due posti;
- la foto di `document-docx` e `document-readonly`, in giorno e notte, a 1280 e a 700, sta accanto a `?stato=documento` e `?stato=sola-lettura`;
- quella di `mobile-document` sta accanto a `?stato=tel-doc`.
Prova: scripts/check.sh --rapido
Stato: [x] fatto · 27e7eaf0..0bd01781 · «Si scrive» lo dice la banda accanto alla modalità (apre la spiegazione del chip, segnale `standing-open`), sul telefono la prima voce di «…»; gli altri stati restano in testata; sotto gli 800 px la lingua lascia la banda · differenze: nessuna stringa nuova (il nome è quello del chip); corrette le regole `:has(> .pane-standing…)` della testata; la scena `mobile-document` misura il chip di PA T47 come «parti chiuse» per una misura sola · resta: baseline `document-docx*`, `document-objects`, `mobile-document` dal runner; il segno «Registra» del chip con `writes` lo dice solo la banda; il collegamento di `document.ts` a `standing-open` e alla voce di «…» è provato solo nel banco

## T5 · La testata: dove sei, se è salvato, «…»

Perché: oggi la testata porta il formato, la modalità e lo stato in quattro tasti; il mockup vuole solo il percorso, «✓ Salvato» e «…». Sul telefono l'utente vuole il foglio largo quanto lo schermo e «Salvato» come icona.
Tocca: `apps/client/src/panels/document.ts`, `apps/client/src/state/store.ts`, `apps/client/src/desktop-shell.ts`, `apps/client/src/shells/scrittoio/sheets/title-rename.ts`, `apps/client/src/shells/scrittoio/sheets/title-rename.test.ts`, `apps/client/src/shells/scrittoio/sheets/save-state.ts`, `apps/client/src/shells/scrittoio/sheets/save-state.test.ts`, `apps/client/src/i18n/catalog.ts`, `apps/client/src/theme/scrittoio/skin/sheets.css`, `apps/client/src/theme/scrittoio/skin/centres.css`, `apps/client/src/shells/scrittoio/mobile/mobile.css`, `apps/client/src/theme/scrittoio/anatomia/sheets.ts`, `apps/client/src/theme/scrittoio/anatomia/centres.ts`, `apps/client/src/shell.e2e.test.ts`, `docs/product/editor-and-preview.md`
Non toccare: in `save-state.ts` gli stati, i loro nomi e il riquadro che si apre (cambia solo il suggerimento); `apps/client/src/shells/scrittoio/frame/vault-chip.ts`; la rinomina in sé (stesse regole, stessi errori); il bottone della modalità (lo sposta T3).
Dipende da: T2
Cosa fare:
- `drawCrumbs` (`document.ts`, intorno alla riga 976):
  - in testa la figura della cartella e il nome del vault, poi le cartelle, poi il nome della nota in `span.crumb-name`;
  - fra i pezzi uno `span.crumb-sep` con `aria-hidden`, al posto della «/» scritta;
  - le cartelle tengono `data-folder` e quello che fanno oggi, e la briciola del vault ha `data-folder=""`;
  - il nome del vault oggi è una variabile di `desktop-shell.ts`: entra nello store (`state.vaultName` e il segnale `vault-name`, nuovi), scritto da `showVaultName` (intorno alla riga 693) sia subito sia quando arriva il nome scelto dalla persona, e la testata si ridisegna al segnale.
- `title-rename.ts` trova il nome da rinominare in `.crumb-name` e non più nell'ultimo testo delle briciole.
- `.pane-format` esce dalla testata. Il formato lo dice la linguetta: `paintTab` (intorno alla riga 900) mette in testa `svg.tab-format` con la figura del formato e il nome del formato nell'`aria-label` della linguetta. La chiave nuova del catalogo va in italiano e in inglese.
- «…» (`[data-pane-menu]`) disegna l'icona `more`, non tre caratteri, con l'`aria-label` di oggi.
- `skin/centres.css`: `.save-state` prende la spunta del prototipo. Il selettore ripete `.save-state.sheet-save`, come nel prototipo: al telefono `sheets/sheets.css` si carica dopo la pelle (struttura, `mobile.css`, pelle, `launcher.css`, poi `sheets/sheets.css`) e il suo `display: block` vincerebbe a parità di peso.
- `save-state.ts`, `sync()` (righe 116–131): il bottone prende col `setTooltip` la parola dello stato («Salvato», «Salvataggio…», …), scritta solo quando cambia. Sul telefono la parola non si vede, e il suggerimento la ridice. `save-state.test.ts` lo controlla.
- `mobile.css`:
  - la testata del telefono (righe 2216–2227);
  - in coda, l'involucro `@media (max-width: 599px)` (righe 2241 e 2280) con dentro il foglio da un bordo all'altro (`--sheet-gap: 0px` su `#panes` e gli angoli vivi, righe 2242–2252) e «Salvato» in figura (righe 2267–2279): la spunta, o il punto di ciò che è in sospeso, in un bottone alto e largo un dito; «Errore» e «Conflitto» restano scritti in rosso. T7 aggiunge poi dentro lo stesso involucro le righe 2254–2265.
- `shell.e2e.test.ts` (intorno alle righe 612–631): le attese sulla testata si riscrivono per briciole, «Salvato» e «…».
- `docs/product/editor-and-preview.md`: com'è fatta la testata, che il formato sta nella linguetta e che sul telefono in piedi il foglio prende tutta la larghezza e «Salvato» è la spunta.
Dal prototipo: `skin/sheets.css` 1600–1647; `skin/centres.css` 2151–2175; `mobile.css` 2216–2227, 2241–2252, 2267–2280; gli stati `nota`, `documento`, `tel-nota`, `tel-ferma` e `tel-foglio`.
Casi limite:
- una nota alla radice: solo il vault e il nome;
- un percorso lunghissimo: le cartelle si stringono, il nome resta intero;
- un nome lunghissimo: ellissi, col nome intero nel tooltip;
- un vault senza nome (si usa il nome della cartella);
- un riquadro senza documento;
- la rinomina che fallisce: l'errore di oggi;
- «Salvato», «Salvataggio…» ed «Errore» in giorno e notte;
- telefono: «Errore» e «Conflitto» restano parole rosse, lo stato in sospeso è il punto; sdraiato, da 600 px, la parola torna;
- telefono: il cassetto aperto in piedi copre il foglio come oggi, e il margine a sinistra quando il cassetto è chiuso resta zero;
- in inglese.
Fatto quando:
- `title-rename.test.ts`, `save-state.test.ts` e i test della testata passano con le briciole nuove;
- l'e2e passa;
- la foto di `live-01-panoramica` e `document-docx`, in giorno e notte, a 1280 e a 700, sta accanto a `?stato=nota` e `?stato=documento`;
- quella di `mobile-startup` sta accanto a `?stato=tel-nota` e, col fuoco fuori dal testo, a `?stato=tel-ferma`: il foglio da un bordo all'altro e la spunta;
- la testata ha solo briciole, «Salvato» e «…»; fino a T3 tiene ancora anche il bottone della modalità.
Prova: scripts/check.sh --rapido
Stato: [x] fatto · 0ed8f8e7..576eb118 · briciole «cartella, vault / cartelle / nome» (il nome del vault nello store, segnale `vault-name`), «✓ Salvato» col suggerimento che segue lo stato, «…» disegnato (`more` passa nelle icone di base), il formato nella figura della linguetta; telefono col foglio largo quanto lo schermo · differenze: a 700 px si stringono le cartelle e il nome resta intero; le note perdono «.md» nella briciola; «Offset e terminatori» passa in `document-model.md` per la soglia · resta: le regole `.pane-format` in `structure.css` non servono più (da togliere con T3 o T20); dopo una rinomina del vault nelle impostazioni la briciola tiene il vecchio nome fino alla riapertura, come prima; le pagine-cartella mostrano «_index»

## T6 · Le linguette e la scrivania

Perché: le linguette del mockup sono foglietti tenui con la figura del formato, e quella scelta si stacca appena; l'etichetta della scrivania parla a voce bassa.
Tocca: `apps/client/src/theme/scrittoio/skin/sheets.css`, `apps/client/src/theme/scrittoio/anatomia/sheets.ts`
Non toccare: `apps/client/src/shells/scrittoio/sheets/tab-strip.ts` e `apps/client/src/shells/scrittoio/sheets/desk.ts` (solo pelle); le regole della testata che T5 ha messo nello stesso file.
Dipende da: T5
Cosa fare:
- Copiare le righe 1649–1674 del prototipo in `skin/sheets.css`, accanto alle regole di `.tab` e `.sheet-desk-label` che sostituiscono, togliendo quelle che diventano inutili.
- `.tab-format` entra nei ganci di `anatomia/sheets.ts`.
Dal prototipo: `skin/sheets.css` 1649–1674; gli stati `nota` e `documento`.
Casi limite: molte linguette (la scena `tabs`); un nome lunghissimo; una linguetta senza figura di formato; la linguetta trascinata; il fuoco da tastiera; il contrasto alto.
Fatto quando: la foto di `live-01-panoramica`, `tabs` e `desk`, in giorno e notte, sta accanto a `?stato=nota` e `?stato=documento` (le linguette e l'etichetta della scrivania), e `npx vitest run src/theme/scrittoio` passa.
Prova: scripts/check.sh --rapido
Stato: [x] fatto · 2b026c13 · linguette con la figura del formato di 14 px, tenue a riposo e piena sull'attiva, nome dell'attiva in medio; etichette della scrivania in tondo in `--text-sm` · differenze: le righe del prototipo fuse nelle regole che c'erano (niente doppioni); `anatomia/sheets.ts` invariato, `.tab-format` l'aveva già messo T5 · resta: il contrasto alto fotografato solo emulando `prefers-contrast: more`; manca una scena col nome lunghissimo

## T7 · La pillola e i pulsanti premuti

Perché: sul computer il nome della nota sta già nella testata, quindi la pillola può essere sempre il campo dei comandi; un pulsante premuto deve sembrare un foglietto sollevato, non una macchia blu; e sul telefono l'utente toglierebbe il logo in alto a sinistra («Io toglierei pure il logo in alto a sinistra nell'app per smartphone»).
Tocca: `apps/client/src/i18n/catalog.ts`, `apps/client/index.html`, `apps/client/mobile.html`, `apps/client/src/shells/scrittoio/frame/pill.ts`, `apps/client/src/shells/scrittoio/frame/pill.test.ts`, `apps/client/src/shells/scrittoio/frame/brand-menu.ts`, `apps/client/src/shells/scrittoio/frame/brand-menu.test.ts`, `apps/client/src/shells/scrittoio/mobile/mobile.css`, `apps/client/src/theme/scrittoio/skin/frame.css`, `apps/client/src/theme/scrittoio/anatomia/frame.ts`
Non toccare: il lanciatore (`apps/client/src/shells/scrittoio/launcher/`); il comando che apre la pillola e la sua scorciatoia; le voci del menu del marchio; il marchio della schermata d'avvio (piano caricamento) e quello del computer, che restano.
Dipende da: T5 (l'involucro `@media` del telefono in `mobile.css`)
Cosa fare:
- Il catalogo, in italiano e in inglese:
  - `frame.pill` diventa «Cerca o esegui un comando» («Search or run a command»);
  - `frame.pill.empty` diventa «Cerca o esegui un comando…»;
  - `frame.pill.at` resta per il telefono.
- In `index.html`:
  - la pillola prende `data-pill="command"`;
  - il testo scritto di `#pill-title` e l'`aria-label` diventano quelli nuovi.
- In `mobile.html` cambia solo il testo scritto.
- `pill.ts`: con `data-pill="command"` la pillola non scrive più la cartella né il nome, e dice sempre `frame.pill.empty`, con l'etichetta `frame.pill`. Senza l'attributo (il telefono) fa quello che fa oggi.
- `pill.test.ts`, intorno alla riga 57: il computer dice sempre il campo dei comandi, il telefono il nome.
- `skin/frame.css`: il pulsante premuto della barra del titolo e del binario (righe 1199–1216) e la pillola (righe 1218–1243).
- Il telefono in piedi senza il marchio:
  - `mobile.css`, dentro l'involucro `@media (max-width: 599px)` di T5: `#brand-menu` non si vede (righe 2254–2265), e la pillola parte dal bordo. Il bottone resta nel DOM, perché lo cercano `brand-menu.ts` e i test. La griglia della barra (`auto minmax(0, 1fr) auto`, `mobile.css` 180) non cambia: `#titlebar-left` resta la prima colonna, vuota, e tiene solo il suo `padding` (`skin/frame.css` 19–22), che diventa il margine della pillola; il prototipo lo mostra così;
  - prima di nasconderlo si controlla che ogni voce del menu del marchio abbia un'altra strada sul telefono in piedi: un comando del lanciatore (la pillola), la barra inferiore o il gesto indietro. Si guardano tutte, comprese quelle che nascono dalle viste e dalle creazioni (per esempio «Importa disegno…»), il vault, l'aiuto e la luce. Se una manca, il marchio resta e il report dice quale;
  - `brand-menu.ts`: un ascoltatore di `matchMedia("(max-width: 599px)")`, passato da `lifetime.listen`, chiude il menu se è aperto quando il telefono si raddrizza e porta il fuoco alla pillola; e `settleFocus` (riga 29), quando il marchio non si vede, ripiega sulla pillola invece che sul marchio. Così il fuoco non resta mai su un marchio nascosto e non cade sul `body`; `brand-menu.test.ts` lo controlla;
  - i commenti di `mobile.css` che dicono «nel menu del marchio» (righe 176–179 e 265–268) dicono che in piedi le stesse voci stanno nel lanciatore e nella barra inferiore; quello del telefono sdraiato (righe 147–149) resta vero, perché sdraiato il marchio c'è.
- `docs/`: nessuna pagina cita il testo della pillola (cercato con `grep`), e nessuna descrive la barra del titolo del telefono, quindi niente da cambiare; il report lo segnala come lacuna.
Dal prototipo: `skin/frame.css` 1199–1243; `mobile.css` 2254–2265; gli stati `nota`, `vuoto`, `tel-nota` e `tel-sdraiato`.
Casi limite:
- nessun documento aperto;
- la scorciatoia cambiata dalla persona: il `kbd` la segue;
- in inglese il testo è più lungo, e la pillola stretta a 700 px lo taglia con l'ellissi;
- il lettore di schermo legge l'etichetta;
- il pulsante premuto col fuoco da tastiera;
- il contrasto alto;
- telefono: il menu del marchio aperto da sdraiato, poi il telefono si raddrizza; il benvenuto senza vault, dove aiuto e luce tornano nella barra (`#app[data-welcome]`);
- telefono: un lavoro in corso, quando `#activity-button` torna nella barra del titolo accanto alla pillola.
Fatto quando:
- `pill.test.ts` e `brand-menu.test.ts` passano per il computer e per il telefono;
- la foto di `live-01-panoramica` ed `empty`, in giorno e notte, a 1280 e a 700, sta accanto a `?stato=nota` e `?stato=vuoto`: la pillola dice «Cerca o esegui un comando» e il pulsante del binario premuto è un foglietto;
- sul telefono, in giorno e notte, `mobile-startup` sta accanto a `?stato=tel-nota` (senza marchio, la pillola dal bordo) e `mobile-startup` a 844×390 accanto a `?stato=tel-sdraiato` (il marchio c'è).
Prova: scripts/check.sh --rapido
Stato: [x] fatto · acfeab0f · sul computer la pillola è sempre «Cerca o esegui un comando…» (`data-pill="command"`), il kbd segue la scorciatoia; il pulsante premuto è un foglietto sollevato (filo `CanvasText` nei colori forzati); al telefono in piedi il marchio non si vede e il fuoco del suo menu ripiega sulla pillola, il telefono che si raddrizza a menu aperto lo chiude · l'orchestratore ha allineato anche `frame.pill.at` («{title}: cerca o esegui un comando», f8c3f11d) · differenze: l'aria-label statico di `mobile.html` segue il catalogo; a cassetto chiuso il pulsante perde anche l'ombra; il prototipo scrive la pillola senza «…», si è seguito il piano · resta: nessuna pagina di `docs/` descrive la barra del titolo del telefono

## T8 · Il cassetto

Perché: il cassetto del mockup è quieto: «Note» con «ordina» e «nuova nota» a icona, il filtro pieno con la lente, le sezioni in tondo, i conteggi e il gallone sottile.
Tocca: `apps/client/src/panels/explorer.ts`, `apps/client/src/panels/explorer-filter.ts`, `apps/client/src/panels/explorer-filter.test.ts`, `apps/client/src/panels/explorer.dom.test.ts` (nuovo), `apps/client/index.html`, `apps/client/mobile.html`, `apps/client/src/theme/scrittoio/skin/drawers.css`, `apps/client/src/theme/scrittoio/skin/tree.css`, `apps/client/src/theme/scrittoio/anatomia/drawers.ts`, `apps/client/src/theme/scrittoio/anatomia/tree.ts`, `apps/client/src/i18n/catalog.ts`, `docs/product/explorer-and-folders.md`
Non toccare: l'ordinamento (`sortContent`, `setSort`, `EXPLORER_SORTS`), che resta com'è; i comandi `shell.explorer.*`; le icone scelte dalla persona (T14).
Dipende da: T2
Cosa fare:
- In `index.html` e `mobile.html`, dentro `#files-title`:
  - `#new-note` diventa un bottone a icona (`compose`), con `aria-label` e tooltip da `explorer.new.hint`;
  - prima di `#new-note` c'è un bottone a icona (`sort`) con `aria-label` `explorer.sort` e `aria-haspopup="menu"`.
- Il bottone `sort` apre le stesse voci a radio del menu della radice: si fattorizzano in una funzione sola, usata dai due menu.
- Sopra l'albero c'è un `.panel-title` «Tutte le note», con `.panel-count` che dice il totale dei documenti del vault o dello spazio che si vede (`vaultEntries(...).total`). Il catalogo prende `explorer.all`, in italiano e in inglese.
- Ogni cartella dell'albero prende `.row-count` col numero delle sue voci dirette (`VaultFolder.entries`); lo zero non si scrive, e il numero non entra nel nome accessibile della riga.
- `explorer-filter.ts`: il filtro mostra la lente dentro il campo pieno. Il comportamento non cambia.
- `explorer.dom.test.ts`: i conteggi (anche lo zero), «Tutte le note N», il menu dell'ordinamento che cambia `state.explorerSort`.
- `docs/product/explorer-and-folders.md`: i conteggi e il bottone dell'ordinamento.
Dal prototipo: `skin/drawers.css` 1342–1480; `skin/tree.css` 1528–1596; gli stati `nota` e `ricerca`.
Casi limite:
- un vault senza note: «Tutte le note» senza numero;
- una cartella vuota: niente numero;
- mille voci: il numero si scrive com'è;
- uno spazio attivo: il totale è quello dello spazio;
- il filtro attivo: i conteggi restano quelli veri, non quelli filtrati;
- un nome lunghissimo con il numero;
- un vault in sola lettura: «nuova nota» spenta come oggi;
- il telefono.
Fatto quando:
- `explorer.dom.test.ts` passa;
- la foto di `live-01-panoramica`, `explore` e `search`, in giorno e notte, sta accanto a `?stato=nota` e `?stato=ricerca`;
- quella di `mobile-sheet` (il cassetto sul telefono, che il prototipo non ha) prende le stesse regole e non perde niente rispetto a oggi.
Prova: scripts/check.sh --rapido
Stato: [x] fatto · 6664b0dd..5ec82492 · «Note» con «ordina» e «nuova nota» a icona, filtro pieno con la lente, sezioni in tondo, «Tutte le note» col totale (una domanda di una riga al kernel per refresh), i conti delle cartelle, il gallone sottile · differenze: il totale conta ogni specie di voce, come il prototipo; col filtro aperto «Tutte le note» si nasconde; fatti anche il pozzetto degli spazi (`explorer.whole_vault.short`), la puntina fra le appuntate e `#all-title` sotto la barra della scelta multipla, come nel prototipo; tolta la chiave `explorer.new` · resta: `bench:tree` non esiste ancora (PA T45); baseline dal runner; commenti con «+ Nuova» in `shells/mobile/creation.ts`

## T9 · L'ispettore

Perché: nel mockup l'ispettore è stretto come il cassetto, le schede stanno in cima in un pozzetto, e «● Segue la nota» dice a voce bassa a che cosa è legato.
Tocca: `apps/client/src/ui/node.ts`, `apps/client/src/ui/node.test.ts`, `apps/client/src/ui/views.ts`, `apps/client/src/ui/views.test.ts`, `apps/client/src/theme/scrittoio/structure.css`, `apps/client/src/theme/scrittoio/measures.ts`, `apps/client/src/theme/scrittoio/skin/frame.css`, `apps/client/src/theme/scrittoio/skin/nodes.css`, `apps/client/src/theme/scrittoio/anatomia/frame.ts`, `apps/client/src/theme/scrittoio/anatomia/nodes.ts`, `apps/client/src/i18n/catalog.ts`
Non toccare: i limiti del divisore (`SHELL_WIDTH_LIMITS` in `state/shell-geometry.ts`, 248–440); la larghezza che la persona ha già trascinato, che resta sua; i provider delle viste in Rust; `UiNode` e il suo mirror.
Dipende da: T4
Cosa fare:
- La larghezza:
  - `--inspector-w` passa da 300 a 264 **sulla riga che c'è**, nel primo blocco `:root` di `structure.css` (riga 48), e non in un `:root` nuovo in coda;
  - in `measures.ts` la riga diventa `["inspector-w", 264, 216]`, come il cassetto. `measures.test.ts` legge il primo `:root` e vuole il passo 0 uguale alla struttura: un `:root` aggiunto in coda lo lascerebbe verde con la larghezza vera diversa, e al passo 1 l'ispettore tornerebbe largo.
- `structure.css`: `.inspector-tabs` sale in cima (`order: -1`) e le regole di `.ui-list-item`, `.ui-tree-label` e `.ui-tree-label > span` (righe 192–215 del prototipo) entrano accanto alle regole dell'albero.
- `ui/node.ts` toglie gli stili in linea di quelle tre righe, sia dove la riga nasce sia dove si riusa (intorno alle righe 378–390, 762–770 e 886–900): ora li scrive la struttura, e la pelle li può cambiare. `node.test.ts` controlla che non ci sia più l'attributo `style`.
- `ui/views.ts`, `drawFollows`: col documento la riga dice «Segue la nota» (chiave nuova `inspector.follows_doc`, «Follows the note» in inglese), e il nome della nota va nel tooltip con il testo di oggi (`inspector.follows`). Senza documento resta `inspector.follows_none`. `views.test.ts` lo controlla.
- La pelle: `skin/frame.css` righe 1245–1291 (le schede in pozzetto, il titolo, il punto blu); `skin/nodes.css` righe 1968–2010 e 2072–2081 (la struttura col filo e la tacca blu, le sezioni in tondo).
- `docs/`: nessuna pagina dice la larghezza dell'ispettore o «Segue:» (cercato con `grep`), e i limiti del divisore non cambiano: niente da cambiare.
Dal prototipo: `structure.css` 180–183 (il valore, da scrivere sulla riga che c'è) e 192–215; `skin/frame.css` 1245–1291; `skin/nodes.css` 1968–2010 e 2072–2081; lo stato `nota` (l'ispettore sulla Struttura).
Casi limite:
- la persona ha già una larghezza salvata: resta quella;
- lo spazio dell'interfaccia al passo 4: 216, mai sotto `--inspector-min`;
- un titolo di vista lungo con «Segue la nota»: si accorcia «Segue…», il titolo no;
- una vista che non segue il documento: la riga è nascosta;
- nessuna nota aperta;
- una riga d'albero lunghissima: l'ellissi resta;
- la densità compatta: le righe non scendono sotto i 28 px;
- il telefono (`mobile-inspector`).
Fatto quando:
- `node.test.ts`, `views.test.ts` e `measures.test.ts` passano;
- la foto di `inspector` e `live-01-panoramica`, in giorno e notte, a 1280 e a 700, sta accanto a `?stato=nota`;
- quella di `mobile-inspector` non perde niente rispetto a oggi.
Prova: scripts/check.sh --rapido
Stato: [x] fatto · 733d065b · differenze: per «e altri N» serve un intento non privilegiato nuovo, `fub.inspector.tab` (`fub_abi::ui::INSPECTOR_TAB_NS`, additivo, in `docs/reference/ipc-contract.md`); «Segue la nota» dice il nome nel suggerimento

## T10 · Impostazioni, componenti, avvio rapido, grafo, benvenuto e menu

Perché: le etichette in maiuscoletto spaziato sono l'ultimo resto della pelle vecchia; il mockup le scrive come si scrive, e il posto dove si è nell'indice delle impostazioni è un foglietto sollevato.
Tocca: `apps/client/src/theme/scrittoio/skin/settings.css`, `apps/client/src/theme/scrittoio/skin/graph.css`, `apps/client/src/theme/scrittoio/skin/launcher.css`, `apps/client/src/theme/scrittoio/skin/welcome.css`, `apps/client/src/theme/scrittoio/skin/menus.css`, `apps/client/src/theme/scrittoio/anatomia/settings.ts`, `apps/client/src/theme/scrittoio/anatomia/graph.ts`, `apps/client/src/theme/scrittoio/anatomia/launcher.ts`, `apps/client/src/theme/scrittoio/anatomia/welcome.ts`, `apps/client/src/theme/scrittoio/anatomia/menus.ts`
Non toccare: il DOM delle impostazioni e dei componenti (`apps/client/src/panels/settings*.ts`), che K2 e A1 cambiano; i segmenti delle impostazioni, che restano il velo d'accento.
Dipende da: nessuno (aspetta K2 in `main`)
Cosa fare:
- Copiare i blocchi del prototipo nei loro file: `skin/graph.css` (righe 2085–2092), `skin/menus.css` (2096–2137), `skin/launcher.css` (2141–2147), `skin/settings.css` (2179–2202), `skin/welcome.css` (2206–2212).
- Togliere le regole vecchie che mettono maiuscolo e spaziatura sulle stesse etichette, invece di scavalcarle.
- Ogni classe dei blocchi è già un gancio del suo pezzo; se una manca, entra nell'anatomia.
- Il menu è il B (scelta dell'utente, 2026-11-04): le sue regole sono già dentro le righe 2096–2137, senza prefisso di variante, e non c'è un altro blocco da copiare.
- `docs/`: nessuna pagina descrive queste etichette.
Dal prototipo: le righe sopra; gli stati `impostazioni`, `componenti`, `grafo`, `zero` e `vuoto` (il benvenuto con «Vault recenti»).
Casi limite: un'etichetta lunga in inglese; il contrasto alto; la densità compatta; le impostazioni a 700 px; i menu del tasto destro con un'intestazione; il pannello «/» con l'anteprima.
Fatto quando: la foto di `settings`, `settings-components`, `graph`, `launcher-search`, `launcher-empty`, `menu` ed `empty`, in giorno e notte, sta accanto a `?stato=impostazioni`, `?stato=componenti`, `?stato=grafo`, `?stato=zero` e `?stato=vuoto`, e nessuna etichetta è più in maiuscolo.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T11 · La tipografia del foglio

Perché: il mockup legge a 18 px su righe da 58 caratteri, con titoli pieni, punti in grafite, link a metà forza e citazione e richiamo neutri.
Tocca: `apps/client/src/theme/scrittoio/series.ts`, `apps/client/src/state/zoom.ts`, `apps/client/src/theme/preferences.test.ts`, `apps/client/src/theme/typography.test.ts`, `apps/client/src/state/zoom.dom.test.ts`, `apps/client/src/theme/scrittoio/recipe.ts`, `apps/client/bench/fake-ipc.ts`, `crates/fub-host/src/settings.rs`, `apps/client/src/theme/scrittoio/skin/document.css`, `apps/client/src/theme/scrittoio/anatomia/document.ts`, `apps/client/src/shells/scrittoio/mobile/mobile.css`, `docs/architecture/frontend-and-ipc.md`
Non toccare: gli altri gettoni di `recipe.ts` (la tavolozza resta com'è: cambiano solo `--text-reading` e `--content-width`; il ruolo `--bar-tray` è di T16, le ombre del foglio di T27); `crates/fub-host/src/legacy_tests/switches.rs` (si fa girare, non si cambia); `obsidian_import.rs`; l'ADR 0208, che resta com'è; i valori che la persona ha già scelto in Aspetto.
Dipende da: nessuno
Cosa fare:
- I predefiniti, uguali in TS e in Rust:
  - `series.ts` (righe 64–67): corpo 17 → 18, giustezza 68 → 58;
  - `state/zoom.ts` (riga 33): `TEXT_SIZE.fallback` 17 → 18;
  - `settings.rs` (righe 970 e 983): `APPEARANCE_BODY` 17.0 → 18.0 e `APPEARANCE_MEASURE` 68.0 → 58.0, con gli stessi limiti;
  - `recipe.ts` (righe 536 e 544): `text-reading` 17px → 18px e `content-width` 68ch → 58ch, poi `npm run theme:generate`;
  - `bench/fake-ipc.ts` (intorno alle righe 489, 492, 515 e 518): gli stessi predefiniti.
- I test che li dicono: `preferences.test.ts` (riga 31), `typography.test.ts`, `zoom.dom.test.ts` (righe 35 e 46).
- `skin/document.css`: le righe 1692–1814 del prototipo (titolo 2,22 em e H2 1,39 em, pieni; i punti degli elenchi in grafite; il filo dei link a metà forza; citazione e richiamo neutri). Le classi nuove (`cm-fub-bullet`, `cm-fub-bullet-task`) entrano in `anatomia/document.ts`.
- `mobile.css`: le righe 2233–2239 (sul telefono la pastiglia `H1` non si vede).
- Il titolo pesa 600 (risposta dell'utente, 2026-11-04), com'è già nelle righe sopra.
- `docs/architecture/frontend-and-ipc.md`, il paragrafo sui predefiniti dell'aspetto (intorno alla riga 249): corpo 18 px e giustezza 58 caratteri. `docs/product/editor-and-preview.md` (riga 53) resta vera così com'è.
Dal prototipo: `skin/document.css` 1692–1814; `mobile.css` 2233–2239; il blocco `series.ts` 2378–2385; gli stati `nota` e `tel-nota`.
Casi limite:
- chi ha scelto 17 o 68 in Aspetto: tiene il suo valore (è una scelta salvata, non il predefinito);
- lo zoom del testo ai capi (12 e 28);
- la Lettura e i Blocchi, che usano la stessa misura;
- un titolo lunghissimo su due righe;
- gli elenchi annidati e le liste di compiti;
- un link dentro una citazione;
- il contrasto alto;
- il telefono.
Fatto quando:
- i test TS e `cargo test -p fub-host` passano, compreso il confronto fra i predefiniti di TS e di Rust;
- `npm run theme:verify` rigenera i fogli uguali al byte;
- la foto di `live-01-panoramica`, `reading` e `nota-tre-modi`, in giorno e notte, a 1280 e a 700, sta accanto a `?stato=nota`: gli a capo del primo paragrafo sono quelli del prototipo.
Prova: scripts/check.sh --rapido, e `cargo test -p fub-host`
Stato: [x] fatto · 51900945 2564acb0 · differenze: le tinte per tipo dei richiami e dei loro titoli sono tolte (il colore resta sulla pastiglia `.cm-fub-callout-type` in Live); il richiamo ripiegabile tiene il triangolo; `ul > li.task` a −1.25em; gancio `document-list` nuovo; «Comportamenti della shell» spostati in `docs/architecture/shell-behaviours.md` perché `frontend-and-ipc.md` superava le 450 righe dopo l'unione con main; in Live gli a capo del primo paragrafo differiscono dal prototipo solo perché il testo del banco ha un a capo vero dopo «stato»; baseline dal runner (T25)

## T12 · La riga dei dati sotto il titolo

Perché: «Modificata 2 ore fa · 3 collegamenti · #tema #banco» dice in una riga quanto è fresca la nota, chi la cita e di che cosa parla, senza aprire l'ispettore.
Tocca: `apps/client/src/state/note-facts.ts` (nuovo), `apps/client/src/state/note-facts.test.ts` (nuovo), `apps/client/src/editors/text/profiles/markdown/note-facts.ts` (nuovo), `apps/client/src/editors/text/profiles/markdown/note-facts.test.ts` (nuovo), `apps/client/src/editors/text/profiles/markdown/profile.ts`, `apps/client/src/editors/text/profiles/markdown/surface.ts`, `apps/client/src/editors/text/profiles/markdown/blocks/page.ts`, `apps/client/src/editors/core/bootstrap.ts`, `apps/client/src/host/query.ts`, `apps/client/src/i18n/catalog.ts`, `apps/client/bench/fake-ipc.ts`, `apps/client/src/theme/scrittoio/skin/document.css`, `apps/client/src/theme/scrittoio/anatomia/document.ts`, `docs/product/editor-and-preview.md`
Non toccare: `apps/client/src/host/contract.ts` e ogni porta IPC (la riga legge porte che ci sono); il testo della nota (la riga non entra nel documento); `apps/client/src/state/document-controller.ts`.
Dipende da: T11, T14
Cosa fare:
- `host/query.ts` prende due letture piccole sulle porte di oggi:
  - le etichette di una nota: `{ kind: "tags", matching: theseDocuments([doc]) }`;
  - quante note la citano: il `total` di `{ kind: "backlinks", target: doc, page: { offset: 0, limit: 1 } }`.
- L'ultima modifica viene dall'anagrafe: `vaultEntries` con `of_kind: "document"` e `within: { path: <la cartella della nota>, descendants: false }`, in una finestra da 1000 voci, e la voce della nota fra quelle. Se la nota non c'è, la parte del tempo non si scrive.
- `state/note-facts.ts` mette insieme i tre dati per un documento:
  - un giro nuovo supera il vecchio (lo schema di `ui/race.ts`): un risultato vecchio non scrive mai sopra uno nuovo;
  - si ricalcola all'apertura, dopo un salvataggio riuscito e al segnale `documents`, mai a ogni battuta;
  - il testo del tempo viene da `relativeTime` (`ui/when.ts`).
- La riga è `div.note-facts[contenteditable=false][role=group]`, con `aria-label` dal catalogo («Dati della nota», «Note details»). Dentro:
  - `span.note-fact` con `clock` e «Modificata 2 ore fa»;
  - `span.note-fact` con l'icona dei collegamenti e «3 collegamenti» (al singolare «1 collegamento»);
  - `span.note-fact.note-fact-tags` con uno `span.note-tag` per etichetta.
  - Una parte vuota non si scrive; se sono vuote tutte e tre, la riga non c'è.
- Dove sta:
  - in Live, un widget di blocco di CodeMirror dopo la riga del primo titolo (`.cm-fub-h1-line`), scritto in `markdown/note-facts.ts` e montato da `profile.ts` e `surface.ts`; senza un H1 sta in cima;
  - nei Blocchi, sotto il titolo della testata della pagina (`blocks/page.ts`);
  - in Lettura, dopo il primo `h1` di `.markdown-rendered`;
  - in Sorgente non c'è.
  - `bootstrap.ts` passa alla superficie la lettura dei dati, così l'editor non chiama l'host da sé.
- Il clic su «3 collegamenti» apre la scheda Collegamenti dell'ispettore; il clic su un'etichetta cerca quell'etichetta, come il clic su un tag nel testo.
- `bench/fake-ipc.ts`: la nota Benvenuto risponde con due etichette e tre collegamenti, come il prototipo.
- La pelle: `skin/document.css` righe 1816–1856; i ganci `note-facts`, `note-fact`, `note-fact-tags` e `note-tag` in `anatomia/document.ts`.
- `docs/product/editor-and-preview.md`: la riga dei dati, in quali modalità c'è e da dove legge.
Dal prototipo: `skin/document.css` 1816–1856; gli stati `nota` e `tel-nota`.
Casi limite:
- una nota senza etichette né collegamenti: solo «Modificata»;
- una nota nuova, mai salvata;
- una nota fuori dall'indice (un file appena arrivato);
- cento etichette: la riga va a capo;
- la nota rinominata mentre la lettura gira: vale l'ultima;
- due riquadri sulla stessa nota;
- la riga non si seleziona col testo, e il cursore la salta con le frecce;
- copiare tutto il testo non copia la riga;
- il lettore di schermo legge il gruppo;
- in inglese («Modified 2 hours ago»);
- il telefono.
Fatto quando:
- `note-facts.test.ts` (tutti e due) passano: i tre dati, le parti vuote, il giro vecchio scartato, nessuna lettura a ogni battuta;
- in Sorgente la riga non c'è;
- la foto di `live-01-panoramica`, in giorno e notte, a 1280 e a 700, sta accanto a `?stato=nota`, e quella di `mobile-startup` accanto a `?stato=tel-nota`.
Prova: scripts/check.sh --rapido
Stato: [x] fatto

## T13 · «In entrata» sotto la Struttura

Perché: chi scrive vuole vedere chi cita la nota mentre ne guarda la struttura, senza cambiare scheda; e «Entranti» e «In entrata» per la stessa cosa sono due parole di troppo.
Tocca: `crates/fub-features/src/outline.rs`, `crates/fub-features/src/backlinks.rs`, `apps/client/bench/fake-ipc.ts`, `apps/client/bench/fake-english.ts`, `apps/client/src/ui/node.ts`, `apps/client/src/ui/node.test.ts`, `apps/client/src/theme/scrittoio/skin/nodes.css`, `apps/client/src/theme/scrittoio/anatomia/nodes.ts`, `docs/product/search-links-and-graph.md`
Non toccare: `UiNode` in `fub-abi` e il WIT (la sezione si fa con `Stack`, `Section` e `ListItem` che ci sono); la chiave `incoming` della vista Collegamenti; la feature `backlinks` dentro `outline.rs` (la Struttura legge l'indice del kernel, non la feature: con `backlinks` spenta la sezione c'è lo stesso).
Dipende da: T9, T14
Cosa fare:
- `outline.rs`, `render_view`: dopo l'albero dei titoli chiede `IndexQuery::Backlinks { target: doc, page: Some(Page { offset: 0, limit: 5 }) }` con `host.query_index`.
  - Con almeno un risultato, la radice diventa uno `Stack` con l'albero e una `Section` di chiave `outline-incoming`, titolo «In entrata · N» (N è il `total`), aperta.
  - Dentro, al più 5 `ListItem`: il titolo è il nome della nota, il sottotitolo la sua cartella, l'azione la apre e `drag` è il documento.
  - Oltre 5, una riga «e altri N» porta alla scheda Collegamenti.
  - Senza risultati la sezione non c'è. Un errore della lettura lascia la Struttura com'è, senza sezione.
  - Le stringhe nel catalogo della feature, in italiano e in inglese («Incoming · N», «and N more»).
- `backlinks.rs`: «Entranti» diventa «In entrata» e «Uscenti» «In uscita», anche nei conteggi e nella banda (righe 429, 430, 457, 458 e 466); l'inglese resta «Incoming» e «Outgoing». I test della feature seguono.
- `ui/node.ts`: un `list_item` con `drag` di tipo documento prende in testa `span.ui-list-item-icon` con l'icona della nota (quella della pagina, o la figura del formato). Vale anche per le righe dei Collegamenti, e il contratto non cambia.
- `bench/fake-ipc.ts` (intorno alla riga 861) e `bench/fake-english.ts` (righe 130–131): le stesse parole, e la Struttura di Benvenuto con tre note in entrata, come il prototipo.
- La pelle: `skin/nodes.css` righe 2012–2070; il gancio `ui-list-item-icon` in `anatomia/nodes.ts`.
- `docs/product/search-links-and-graph.md` (righe 75 e 226): le parole nuove e la sezione sotto la Struttura.
Dal prototipo: `skin/nodes.css` 2012–2070; lo stato `nota` (l'ispettore).
Casi limite:
- nessuna nota in entrata: nessuna sezione;
- esattamente 5: niente «e altri»;
- una nota che cita sé stessa;
- un link da un PDF o da un disegno;
- la nota rinominata;
- la Struttura segue anche la selezione, quindi ogni pausa del cursore rifà la lettura: una sola in più, con al più 5 righe, e un test lo conta;
- la feature `backlinks` spenta (`--no-default-features` con la sola `outline`);
- in inglese.
Fatto quando:
- i test di `outline.rs` vedono la sezione con 0, 3 e 7 note in entrata, l'errore della lettura e la feature `backlinks` spenta;
- `cargo test -p fub-features` e il suo `--no-default-features` passano;
- `node.test.ts` vede l'icona sulle righe con `drag`;
- la foto di `inspector` e `live-01-panoramica`, in giorno e notte, sta accanto a `?stato=nota`.
Prova: scripts/check.sh --rapido
Stato: [x] fatto · 0a3d9162, 9f45588c · differenze: anche i Collegamenti dicono «In entrata/In uscita» al posto di «Entranti/Uscenti»; la Struttura legge la porta `Backlinks` del nucleo, non la funzione dei collegamenti

## T14 · Le figure per cartelle e note

Perché: il mockup dà a cartelle e note figure monocrome che stanno nel tono della cornice; le emoji restano una scelta piena.
Tocca: `apps/client/src/ui/menu.ts`, `apps/client/src/ui/menu.test.ts`, `apps/client/src/ui/icons.ts`, `apps/client/src/ui/page-mark.ts` (nuovo), `apps/client/src/ui/page-mark.test.ts` (nuovo), `apps/client/src/state/page-icons.ts`, `apps/client/src/state/page-icons.test.ts`, `apps/client/src/panels/explorer.ts`, `apps/client/src/panels/document.ts`, `apps/client/src/editors/text/profiles/markdown/livepreview.ts`, `apps/client/src/editors/text/profiles/markdown/blocks/page.ts`, `apps/client/src/i18n/catalog.ts`, `apps/client/src/theme/scrittoio/skin/drawers.css`, `apps/client/src/theme/scrittoio/anatomia/drawers.ts`, `crates/fub-abi/src/organization.rs` (solo il commento del campo `icons`), `docs/reference/on-disk-layout.md`, `docs/product/explorer-and-folders.md`, `docs/product/editor-blocks.md`
Non toccare: il tipo del campo `icons` (resta `String`) e il formato di `.fub/workspace.json` (lo schema resta 1); i comandi del kernel che scrivono l'icona; le emoji già scelte, che si mostrano come oggi.
Dipende da: T8
Cosa fare:
- `ui/icons.ts`: le undici figure del prototipo (righe 2494–2506, tranne `star` alla riga 2497, che la cornice ha già: vedi «Le icone del prototipo»): `book`, `calendar`, `flag`, `bulb`, `inbox`, `archive`, `image`, `heart`, `briefcase`, `people`, `music`.
- `ui/page-mark.ts` (nuovo) è il solo posto che sa leggere un valore d'icona:
  - `fub:<nome>` con un nome noto è una figura, disegnata con `icon(nome)`;
  - ogni altro testo breve è un'emoji o una lettera, come oggi;
  - un `fub:` con un nome sconosciuto non si disegna;
  - esporta l'elemento da mettere in una riga e il testo da mettere in un nome (una figura nel testo non si scrive).
- `state/page-icons.ts`, `iconValue`: oggi rifiuta ogni `:`; accetta `fub:<nome>` e continua a rifiutare path e indirizzi.
- `ui/menu.ts`, `pickIcon` (riga 955): due gruppi col titolo, «Figure» (prima) ed «Emoji», con le stesse frecce e lo stesso campo per incollare; scegliere una figura chiama `onPick("fub:<nome>")`. Ogni bottone ha `data-icon` col valore.
- I posti che mostrano l'icona la leggono da `page-mark.ts`:
  - `explorer.ts`: `rowIcon`, la riga di una nota e di una cartella e `namedFolder` (che nei menu scrive solo il nome se l'icona è una figura);
  - `document.ts`: la linguetta e la testata;
  - `livepreview.ts`: l'icona accanto ai wikilink;
  - `blocks/page.ts`: l'icona della testata della pagina, scritta nel frontmatter come `icon: fub:book`.
- La pelle: `skin/drawers.css` righe 1482–1524; i ganci `icon-picker-title` e `icon-grid--figures` in `anatomia/drawers.ts`.
- Il catalogo: i titoli dei due gruppi e il nome di ogni figura (per il lettore di schermo), in italiano e in inglese.
- `crates/fub-abi/src/organization.rs`: il commento di `icons` dice «emoji o `fub:<nome>`»; il tipo non cambia.
- Le pagine di `docs/`:
  - `docs/reference/on-disk-layout.md`, la riga di `.fub/workspace.json`: l'icona è un'emoji o `fub:<nome>`, e una versione di prima mostra il testo;
  - `docs/product/explorer-and-folders.md`: il selettore con le figure;
  - `docs/product/editor-blocks.md`, «La testata della pagina»: `icon: fub:book`.
Dal prototipo: `skin/drawers.css` 1482–1524; `ui/icons.ts` 2494–2506 (senza `star`); gli stati `icone` e `icone-emoji`.
Casi limite:
- `fub:` con un nome sconosciuto (scritto a mano, o da una versione futura): niente figura, e nessun errore;
- `fub:book` aperto da una versione di Fub di prima: si vede il testo (D7);
- un'emoji composta (bandiere, famiglie);
- `icon:` nel frontmatter scritto da un'altra app (un URL): resta rifiutato;
- la stessa nota con l'icona nel frontmatter e nell'organizzazione: vale l'ordine di oggi;
- rinominare e spostare una cartella con una figura;
- la figura in giorno, notte e contrasto alto: prende il colore del testo;
- Esc chiude il selettore e il fuoco torna dov'era;
- il telefono.
Fatto quando:
- `page-mark.test.ts`, `page-icons.test.ts` e `menu.test.ts` passano: il valore letto, il nome sconosciuto, il rifiuto degli indirizzi, la scelta di una figura e di un'emoji;
- la foto di `menu-albero-cartella` col selettore aperto, in giorno e notte, sta accanto a `?stato=icone`.
Prova: scripts/check.sh --rapido
Stato: [x] fatto · ec7330b9..161d293a · le figure monocrome `fub:<nome>` per cartelle e note nel selettore (15 figure, come il DOM del prototipo), nell'albero, nella linguetta, nella testata dei Blocchi e accanto ai wikilink della Live (maschera `data:` in un tema di CodeMirror); gli indirizzi scritti da un'altra app si rifiutano; la figura accanto al wikilink si vede nel banco solo con T15

## T15 · Il vault del banco con le figure

Perché: le foto del banco devono mostrare le figure come il mockup, ma le emoji vanno ancora fotografate.
Tocca: `apps/client/bench/fake-ipc.ts`
Non toccare: le altre risposte dell'host finto; `bench/scene.mjs` (le scene nuove sono di T24).
Dipende da: T14
Cosa fare:
- Le icone dell'organizzazione del vault del banco (intorno alla riga 760) diventano `{ Guida: "fub:book", Diario: "fub:calendar" }`.
- Con `?icone=emoji` l'host finto risponde con le icone di oggi, così una scena le può ancora fotografare.
- `docs/`: nessuna pagina descrive il vault del banco.
Dal prototipo: gli stati `icone` e `icone-emoji`.
Casi limite: una scena che oggi conta sull'emoji di una cartella (va cercata con `grep` in `bench/`); il parametro sconosciuto; le sonde del banco che leggono il testo di una riga.
Fatto quando: aprendo il banco con e senza `?icone=emoji` il cassetto mostra le emoji e le figure, e `npx vitest run bench` passa.
Prova: scripts/check.sh --rapido
Stato: [x] fatto

## T16 · La barra in una fila e la colonna, nel kit

Perché: lo standard va scritto una volta nel proprietario, il kit, prima che una barra lo adotti; così ogni editor mette le classi e toglie le sue regole, invece di ridisegnare la stessa barra.
Tocca: `apps/client/src/theme/scrittoio/recipe.ts`, `apps/client/src/theme/scrittoio/profile.ts`, `apps/client/src/theme/recipe.test.ts`, `apps/client/src/theme/scrittoio/structure.css`, `apps/client/src/theme/scrittoio/skin/kit.css`, `apps/client/src/theme/scrittoio/anatomia/kit.ts`, `apps/client/bench/kit.ts`, `docs/architecture/frontend-and-ipc.md`
Non toccare: gli altri ruoli della ricetta (nasce solo `--bar-tray`; `--sheet-2` resta com'è, perché lo usano anche i campi e la fila delle linguette); il comportamento di `apps/client/src/kit/options-bar.ts` e `apps/client/src/kit/tool-rail.ts`; `apps/client/src/kit/ribbon/` (T20); le barre degli editor (T17–T23); `apps/client/src/editors/spatial/tools/editor/chrome/rail.ts` (K5).
Dipende da: nessuno
Cosa fare:
- Il vassoio delle barre è un ruolo facoltativo nuovo della ricetta, `--bar-tray` (l'utente, 2026-11-04: «vorrei che questo sfondo grigio fosse meno grigio, cioè che ci fosse meno stacco tra il bianco e quello sfondo. lo stesso vale per la versione scura, meno differenza di colore»):
  - `recipe.ts`: la voce `"bar-tray"` nella tavolozza, accanto a `sheet-2`, vale `high ? sheet2 : toHex(day ? lch(0.984, 0.004, paper) : lch(0.238, 0.017, paper))`: `#f8fafc` di giorno, a metà fra la carta e `--sheet-2`, e `#1a1f27` di notte, un passo sotto `--sheet-2`; col contrasto alto resta `--sheet-2`, com'è oggi. Il nome entra nell'elenco di `OPTIONAL_ROLES` (riga 586), se no diventerebbe un ruolo obbligatorio e ogni tema `theme-2` di oggi verrebbe rifiutato. Poi `npm run theme:generate` (i fogli generati e `theme/author/`);
  - `profile.ts`, `THEME_2_OPTIONAL_PAIRS`: `["text", "bar-tray", AA, …]`, `["muted", "bar-tray", AA, …]` e `["outline", "bar-tray", UI, …]`, come le coppie di `sheet-2`. Nel prototipo danno di giorno 15,78, 6,12 e 3,50, di notte 13,47, 6,69 e 3,88;
  - `recipe.test.ts` (riga 112): il conto dei ruoli facoltativi diventa `39 + 6 + 18 + 1`; i ruoli obbligatori restano 154;
  - la pelle lo legge sempre col ripiego, `var(--bar-tray, var(--sheet-2))`: un tema `theme-2` che non lo dichiara resta com'è oggi;
  - `docs/`: nessuna pagina elenca i ruoli uno per uno (cercato con `grep`); il conto e l'elenco stanno in `theme/author/`, che si rigenera.
- `structure.css`: le righe 558–601 del prototipo (la forma della fila: vassoio, foglietti, pulsanti, campo, «…»), accanto alle regole di `kit-options`.
- `skin/kit.css`: le righe 1044–1195, già sul vassoio `--bar-tray`, in una sezione nuova «Barra in una fila e colonna», prima di «Garanzie». Le regole di `kit-rail` e `kit-options` che ci sono già e che il blocco rifà si tolgono, non si scavalcano.
- `anatomia/kit.ts`: un pezzo nuovo `kit-bar` coi ganci `kit-bar`, `kit-bar-group`, `kit-bar-button` e `kit-bar-field`; `kit-rail` e `kit-options` tengono i loro. `anatomia.test.ts` vuole che le classi della pelle e i ganci coincidano nei due versi.
- `bench/kit.ts`: una sezione «Barra in una fila», con una `kit-bar` di tre foglietti (un pulsante acceso, uno spento, un campo e «…» di `kit-options`) e una `kit-rail` di `createToolRail` con due gruppi, negli stati forzati della pagina (passaggio, pressione, fuoco).
- `docs/architecture/frontend-and-ipc.md`, il paragrafo su `kit/` (intorno alla riga 226): le tre forme e dove vivono, come in «Lo standard delle barre» qui sopra.
Dal prototipo: `structure.css` 558–601; `skin/kit.css` 1044–1195; `recipe.ts` 2388–2415 (solo `--bar-tray`); lo stato `barra` (la barra di formato vestita di `kit-bar`) e `disegno` (la colonna).
Casi limite:
- la colonna del disegno usa già `kit-rail` (`chrome/rail.ts`): cambia aspetto qui, e la foto di `draw-open` va guardata;
- pulsante acceso e spento insieme;
- il campo nella fila, col fuoco;
- le tre densità dell'aspetto e la compattezza (`gate.test.ts` le prova tutte);
- il contrasto alto e `forced-colors`; col contrasto alto `--bar-tray` è `--sheet-2`, com'è oggi;
- un tema `theme-2` che non dichiara `--bar-tray`: il ripiego `--sheet-2`;
- la bolla della selezione resta una bolla, senza vassoio.
Fatto quando:
- `anatomia.test.ts`, `gate.test.ts`, `recipe.test.ts` e `npm run theme:verify` passano, e `npm run bench:a11y` resta verde (il contrasto sul vassoio nuovo);
- la foto di `kit` e `kit-focus`, in giorno e notte, mostra la sezione nuova, con la fila uguale alla barra di `?stato=barra`;
- quella di `draw-open` ha la colonna come `?stato=disegno`;
- le altre scene non cambiano, perché nessun altro DOM ha ancora le classi.
Prova: scripts/check.sh --rapido
Stato: [x] fatto · 68f48788. Differenze dal testo, decise sul codice:
- `bench/kit.html` e `bench/scene.mjs`, fuori da «Tocca»: il catalogo non aveva più posto nei 1280×800 della foto, quindi `kit` e `kit-focus` hanno una finestra di 1280×960 (`KIT_WINDOW`), e la cornice ha due classi sue (`cella-in-piedi`, perché la colonna non si stiri, e `fila-stretta`, 360 px, perché l'ultimo foglietto vada in «…»). Le altre scene del kit tengono 1280×800 e la loro foto non cambia;
- il prototipo dice che col dito i 44 px «li danno già» le regole `pointer: coarse`, ma per `kit-options-more` nessuna regola li dava (prima aveva `--control-h`, 32): `structure.css` aggiunge `@media (pointer: coarse)` coi 44 per `kit-bar-button` e `kit-options-more`;
- le regole di `kit-rail` e `kit-options` di `skin/kit.css` non sono state scavalcate: si sono spostate nella sezione nuova, fuse col blocco del prototipo (il filo fra i gruppi è `display: none`, il raggio delle caselle è `--radius-chip`, la forma della riga di `kit-options` è passata a `structure.css`);
- un pulsante acceso sotto il puntatore prende il velo del passaggio e perde quello d'accento, come `.draw-button` (il `:not()` della regola del passaggio pesa di più): è il comportamento del prototipo, e il banco mostra il passaggio su un pulsante non acceso.

## T17 · La barra di formato delle note, e le frecce del kit

Perché: la barra di formato è la prima barra in una fila: prende il vassoio e i pulsanti del kit, e le sue frecce diventano quelle di tutte le barre.
Tocca: `apps/client/src/kit/toolbar-keys.ts` (nuovo), `apps/client/src/kit/toolbar-keys.test.ts` (nuovo), `apps/client/src/kit/index.ts`, `apps/client/src/panels/format-bar.ts`, `apps/client/src/panels/format-bar.test.ts`, `apps/client/src/theme/scrittoio/skin/sheets.css`, `apps/client/src/theme/scrittoio/anatomia/sheets.ts`, `apps/client/src/theme/scrittoio/structure.css`, `apps/client/bench/fake-ipc.ts`, `docs/architecture/frontend-and-ipc.md`, `docs/architecture/editor-surfaces.md`, `docs/product/editor-and-preview.md`
Non toccare: l'API di `createFormatBar` e di `toolbarGroups` (N6 T41 e T50 le usano); `apps/client/src/panels/mini-bar.ts`; la bolla della selezione (`.selection-bubble`); `apps/client/src/kit/tool-rail.ts` e `apps/client/src/kit/ribbon/ribbon.ts`, che hanno le loro frecce.
Dipende da: T3, T6, T16
Cosa fare:
- `kit/toolbar-keys.ts` (nuovo) esporta `rovingToolbar(element, { controls, onEscape }, lifetime)`:
  - `controls` è una funzione che dà i controlli di oggi (pulsanti, elenchi e campi), perché la barra si ridisegna;
  - un solo punto di Tab (`tabIndex` 0 sul controllo corrente, -1 sugli altri);
  - le regole di oggi di `format-bar.ts` (righe 374–413): destra e sinistra avvolgono ai capi, Home ed End vanno al primo e all'ultimo, e contano solo i controlli visibili e accesi;
  - Esc resta a chi usa la barra, con `onEscape` facoltativo (la barra di formato riporta il fuoco all'editor);
  - in un campo di testo le frecce muovono il cursore del testo e passano al controllo vicino solo ai capi del testo; Home ed End restano al campo;
  - l'ascoltatore passa da `lifetime.listen`.
  - `kit/index.ts` lo esporta.
- `format-bar.ts` usa `rovingToolbar` al posto del suo codice e mette `kit-bar` sulla radice, `kit-bar-group` sui gruppi e `kit-bar-button` sui pulsanti. Le classi `format-bar*` restano, perché le usano i test, la bolla e `data-formatbar-off`.
- `skin/sheets.css`: si tolgono le regole `.format-bar*` (righe 628–696) che `kit-bar` ora veste; `.selection-bubble` e `.selection-bubble .format-bar` restano. I ganci di `anatomia/sheets.ts` seguono la pelle.
- `skin/sheets.css`, il bottone della modalità, che dopo T3 non sta più nella testata:
  - si tolgono `.pane-toolbar > .pane-mode-current` e `.pane-toolbar > .pane-mode-current::after` (la freccia «▾»), righe 493–511, che non trovano più niente;
  - `.pane-toolbar > .pane-mode-current:focus-visible` (righe 512–515) resta con il selettore nuovo `.pane > .pane-mode-current:focus-visible` e lo stesso anello rientrato: sta bene sul tondo e sulla casella piatta all'angolo, dove un anello sporgente uscirebbe dallo schermo;
  - nella regola `@container sheet-head (max-width: 320px)` (righe 516–525) si toglie la parte dei segmenti, che non sono più nella testata; resta «…» a 24 px;
  - il gancio `pane-mode-current` di `anatomia/sheets.ts` (riga 10) **resta**: l'elemento c'è ancora, una pelle o un ritaglio della persona può vestirlo (`theme/snippets.ts` ammette solo i ganci dichiarati), e `anatomia.test.ts` vuole che la classe compaia nella pelle, cosa che la regola del fuoco garantisce.
- `structure.css` (righe 997–1033): `.format-bar`, `.format-bar-group` e `.format-bar-overflow` perdono ciò che dà `.kit-bar`; restano `--format-bar-h`, `data-formatbar-off` e la bolla.
- `bench/fake-ipc.ts`: con `?formatbar=1` anche la finestra principale riceve i comandi di formato che oggi ha solo il telefono, così la barra si fotografa sul computer. È una riga sola: non aspetta il T4 di caricamento, e chi entra per secondo ribasa.
- I test: `toolbar-keys.test.ts` le frecce, i capi, Home ed End, un solo punto di Tab e una barra che si ridisegna; `format-bar.test.ts` resta verde coi test di T1 e controlla le classi del kit.
- `docs/`:
  - `frontend-and-ipc.md`: `kit/toolbar-keys.ts`;
  - `editor-surfaces.md` (intorno alla riga 164) ed `editor-and-preview.md` (intorno alla riga 442): la barra di formato veste il kit.
Dal prototipo: `structure.css` 558–601 e `skin/kit.css` 1044–1195, entrati con T16; gli stati `barra`, `barra-700` e `tel-tastiera`.
Casi limite:
- una barra con un gruppo solo;
- tutti i pulsanti spenti (sola lettura): la barra non c'è, come oggi;
- il troppo che va in «…» a 700 px: «…» è l'ultimo punto delle frecce;
- il menu di un pulsante aperto e chiuso: il fuoco torna al pulsante;
- la bolla della selezione (`mobile-keyboard` e la mini-barra): stesse frecce, senza vassoio;
- la barra spenta dalle impostazioni;
- una scorciatoia cambiata dalla persona nel tooltip;
- un campo di testo e un elenco nella fila (li avrà il PDF, T18): il test di `toolbar-keys` li prova già;
- telefono con la tastiera aperta (`tel-tastiera`): la fila sta sopra i tasti e il bottone della modalità ne chiude l'ultima casella, ma non è della barra; le frecce si fermano a «…» e il Tab passa a lui, come vuole l'ordine del DOM di T3;
- il bottone della modalità col fuoco da tastiera, tondo e piatto: l'anello rientrato si vede tutto.
Fatto quando:
- `toolbar-keys.test.ts` e `format-bar.test.ts` passano, e `anatomia.test.ts` resta verde col gancio `pane-mode-current`;
- con `?formatbar=1` la foto della nota, in giorno e notte, a 1280 e a 700, sta accanto a `?stato=barra`;
- quella di `mobile-keyboard`, in giorno e notte, sta accanto a `?stato=tel-tastiera` e non perde niente rispetto a oggi.
Prova: scripts/check.sh --rapido
Stato: [x] fatto · 8c359b05..8d61676a · `kit/toolbar-keys.ts` (frecce, giro ai capi, Home/Fine, spenti e gruppi nascosti saltati, campi di testo, un solo punto di Tab, Escape a chi usa la barra); la barra di formato del riquadro veste `kit-bar`, la bolla e la mini-barra hanno gruppi e pulsanti del kit senza vassoio · differenze: sul telefono la fila resta piatta (`mobile.css`, fuori da Tocca) e col dito la barra ha `height: auto` per i pulsanti da 44; `kit-bar` entra nei ganci; tolti i ganci `format-bar-button` e `format-bar-menu` (il contratto non è ancora congelato, PA T41) · resta: «…» della barra sul computer provato solo dai test (a 700 px ci sta tutta)

## T18 · La barra del PDF

Perché: oggi la barra del PDF è una pillola di parole che va a capo e ha otto punti di Tab; il mockup la vuole nella fila di serie, con le figure, la lente nel campo e la pagina nella banda.
Tocca: `apps/client/src/editors/media/pdf-view.ts`, `apps/client/src/editors/media/pdf-view.test.ts` (arriva con N7), `apps/client/src/editors/media/media-surface.ts`, `apps/client/src/editors/media/media-surface.test.ts`, `apps/client/src/editors/media/icons.ts` (nuovo), `apps/client/src/i18n/catalog.ts`, `apps/client/src/theme/scrittoio/skin/media.css`, `apps/client/src/theme/scrittoio/anatomia/media.ts`, `docs/product/pdf-annotations.md`
Non toccare: il motore del PDF (pdf.js e il caricamento); le annotazioni (`apps/client/src/editors/spatial/pdf/`); le parole del catalogo che ci sono, che restano per il tooltip e il nome accessibile.
Dipende da: T17 (aspetta N7 in `main`)
Cosa fare:
- `editors/media/icons.ts` (nuovo) registra con `registerIcon` (`ui/icons.ts`) le sei figure del PDF, coi tratti del prototipo: `media-page-previous`, `media-page-next`, `media-thumbnails`, `media-fit-width`, `media-two-pages`, `media-dark-pages`. Le registra come `useRichIcons` in `editors/rich/icons.ts`: alla prima barra che si monta, e le toglie quando si smonta l'ultima.
- `pdf-view.ts`, la barra:
  - `media-pdf-toolbar` prende `kit-bar`, `role="toolbar"` e `aria-label` («Strumenti del PDF»);
  - i foglietti `span.media-pdf-group.kit-bar-group[role=group]`, in quest'ordine: pagina precedente e successiva; le miniature; il sommario (`select.kit-bar-field`); la ricerca; adatta alla larghezza, due pagine e colori scuri; poi «Annota», quando c'è, in un foglietto suo;
  - i pulsanti diventano figure (`kit-bar-button`) con `aria-label` e tooltip dalle chiavi di oggi;
  - la ricerca è `span.media-pdf-search` con la lente (`search`) e il campo `kit-bar-field`;
  - «Apri con un'altra app» e «Copia il link alla pagina» vanno in «…» (`kit-options-more`, `aria-haspopup="menu"`, nome «Altre azioni del PDF»), che apre `showContextMenu`;
  - le frecce sono quelle di `rovingToolbar` (T17): un solo punto di Tab.
- `media-surface.ts` dà alla banda la voce `{ id: "page" }` con «Pagina N di M» (`SurfaceStatus`, `registry.ts`), aggiornata quando la pagina cambia. Il `p[role=status]` del visore resta per il caricamento e gli errori, e per il lettore di schermo.
- Il catalogo, in italiano e in inglese: `media.pdf.toolbar` («Strumenti del PDF»), `media.pdf.more` («Altre azioni del PDF»), `media.pdf.previous` e `media.pdf.next` («Pagina precedente» e «Pagina successiva»: oggi i due pulsanti dicono solo «‹» e «›» e non hanno un nome). Le altre parole ci sono già (`media.pdf.*`, `media.open_external`).
- La pelle: `skin/media.css` righe 1860–1905, comprese le diapositive (`.slide-status`, «3 / 12» in tondo); si tolgono le regole di `.media-pdf-toolbar` e dei suoi figli (righe 384–456 di `main`: la pillola sospesa che va a capo). I ganci `media-pdf-group` e `media-pdf-search` entrano in `anatomia/media.ts`.
- `docs/product/pdf-annotations.md`: la barra, «…» e la pagina nella banda.
Dal prototipo: `skin/media.css` 1860–1905; le figure della sonda `pdfBarra`; gli stati `pdf` e `pdf-700`.
Casi limite:
- un PDF di una pagina: precedente e successiva spente;
- un PDF senza sommario: niente elenco;
- un PDF che non si apre: la nota d'errore di oggi, e niente voce nella banda;
- la ricerca senza risultati;
- due pagine affiancate («Pagine 3–4 di 12»);
- un PDF che si può annotare e uno che no;
- 700 px: la fila scorre di lato o manda il resto in «…», e non va mai a capo;
- l'host senza «apri con un'altra app» (`onOpenExternal`): «…» ha solo il link; senza nessuno dei due, «…» non c'è;
- in inglese;
- il contrasto alto.
Fatto quando:
- `pdf-view.test.ts` vede i foglietti, i nomi accessibili, «…» col menu, un solo punto di Tab e le frecce;
- `media-surface.test.ts` vede la voce della banda e il suo cambio di pagina;
- la foto di `pdf-domanda`, in giorno e notte, a 1280 e a 700, sta accanto a `?stato=pdf`.
Prova: scripts/check.sh --rapido
Stato: [x] fatto · 55ef8b03..cad99ac5 · (barra in fila con le figure, «…», un solo punto di Tab, «Pagina N di M» nella banda; a 700 px la fila scorre di lato invece di mandare il resto in «…»; `media-pdf-group` fuori dall'anatomia perché la pelle non lo veste)

## T19 · I file Craft senza anteprima

Perché: senza anteprima la scheda Craft oggi è un riquadro tratteggiato; il mockup la vuole un foglietto di carta posato sul piano, con le risposte uguali ai pulsanti del kit.
Tocca: `apps/client/src/theme/scrittoio/skin/media.css`, `apps/client/src/theme/scrittoio/anatomia/media.ts`
Non toccare: il DOM e il comportamento di `apps/client/src/editors/craft/consent.ts` e di `apps/client/src/editors/craft/surface.ts` (arrivano con N7); le parole della domanda; la scelta salvata.
Dipende da: T18 (aspetta N7 in `main`)
Cosa fare:
- `skin/media.css`: le righe 1907–1964 del prototipo (`craft-card`, `craft-empty`, `craft-empty-name`, `craft-ask`, `craft-ask-answer`, `craft-render`), al posto delle regole di N7 che rifanno, compreso il bordo tratteggiato.
- `anatomia/media.ts`: `craft-ask` e `craft-ask-answer` entrano nei ganci di `craft-card`, se N7 non li ha già messi.
- `docs/`: nessuna pagina descrive l'aspetto della scheda.
Dal prototipo: `skin/media.css` 1907–1964; gli stati `craft` e `craft-700`.
Casi limite: un nome di file lunghissimo; la domanda e la sua risposta; «Preparo l'anteprima…»; l'anteprima fallita; le anteprime spente (`.craft-off`, col link alle impostazioni); il file oltre il peso massimo; il file che non si legge; il contrasto alto e `forced-colors` (il bordo torna); due schede Craft affiancate.
Fatto quando:
- `anatomia.test.ts` passa;
- la foto di `craft-domanda`, in giorno e notte, a 1280 e a 700, sta accanto a `?stato=craft`;
- quelle di `craft-prepara`, `craft-fallita`, `craft-spente`, `craft-peso` e `craft-rotto` hanno lo stesso foglietto e non perdono niente rispetto a N7.
Prova: scripts/check.sh --rapido
Stato: [x] fatto · e9a87102 · la scheda Craft è un foglietto sollevato con i pulsanti del kit, fuso nelle regole di N7 (niente tratteggio né accento); i pulsanti spenti come quelli del kit; le baseline craft-* cambiano e vengono dal runner

## T20 · La barra a schede nel kit

Perché: la barra dei fogli è l'origine dello standard; finché la sua forma si chiama `grid-ribbon-*`, la barra del documento la deve copiare. Nel kit diventa `kit-ribbon-*`, una volta sola.
Tocca: `apps/client/src/kit/ribbon/ribbon.ts`, `apps/client/src/kit/ribbon/ribbon.test.ts`, `apps/client/src/theme/scrittoio/structure.css`, `apps/client/src/theme/scrittoio/skin/kit.css`, `apps/client/src/theme/scrittoio/skin/editors.css`, `apps/client/src/theme/scrittoio/anatomia/kit.ts`, `apps/client/src/theme/scrittoio/anatomia/editors.ts`, `docs/architecture/grid-surface.md`
Non toccare: `apps/client/src/editors/grid/ribbon/ribbon.ts` (il comportamento della barra dei fogli); le regole `.rich-ribbon-*` (T21); le parti solo dei fogli (tavolozza, galleria, campioni, «Comandi», formula, schede); l'opzione `prefix` del kit, che resta.
Dipende da: T16 (aspetta K3 e griglia in `main`)
Cosa fare:
- `kit/ribbon/ribbon.ts`:
  - la radice prende `kit-ribbon` accanto a `<prefisso>`;
  - ogni pezzo prende `kit-ribbon-<parte>` accanto a `<prefisso>-<parte>`, nello stesso punto in cui oggi nasce la classe (`cls`, intorno alla riga 207);
  - dove `cls` serve anche a cercare un elemento, si cerca ancora con la classe del prefisso.
- `ribbon.test.ts`: ogni pezzo porta le due classi, coi prefissi `grid-ribbon` e `rich-ribbon`.
- `structure.css`: le righe 277–556 del prototipo; si tolgono le regole `.grid-ribbon-<parte>` che il blocco rifà, e restano quelle delle parti solo dei fogli.
- `skin/kit.css`: le righe 615–972 in una sezione «Barra a schede»; in `skin/editors.css` (la sezione «Il foglio di calcolo») si tolgono le regole `.grid-ribbon-<parte>` che il blocco rifà.
- Nella stessa sezione, il vassoio più chiaro (righe 974–1000) e le sezioni come le schede dell'ispettore (righe 1002–1042), scelte dell'utente del 2026-11-04 (il vassoio: «meno stacco tra il bianco e quello sfondo», anche di notte; le sezioni: «vorrei anche che il selettore di tab dell'editor docx fosse più simile al selettore di collegamenti, struttura ecc. della sidebar»):
  - si fondono nelle regole ricavate sopra: una regola per selettore e un valore per proprietà, nessuna regola che ne scavalca un'altra dello stesso file;
  - il vassoio è `var(--bar-tray, var(--sheet-2))`, il ruolo di T16 (senza il ruolo resta quello di oggi); di notte i foglietti sono `--bg-elev` col filo di luce in cima e un filo attorno, e quello aperto sul posto sale di un gradino; col contrasto alto resta il bordo pieno di oggi;
  - le sezioni sono il pozzetto delle schede dell'ispettore: segmenti alti 26, il nome in `--text-base` (in `--text-sm` quando il foglio è sotto i 900 px), in grafite; la scelta è un foglietto `--bg-elev` col nome in inchiostro, che scorre (`.kit-tab-indicator`), e il nome più marcato (600; risposta dell'utente, 2026-11-04) senza che la fila si allarghi: ogni sezione tiene già la larghezza del nome a 600, con un doppio invisibile del nome (`::after` con `content: attr(data-label)`, `font-weight: 600`, alto 0 e `visibility: hidden`), così il cambio di peso non sposta le vicine; le sezioni contestuali tengono l'accento; di giorno il pozzetto è il velo di oggi, di notte `--bg-hover`;
  - i ruoli (`tablist`, `tab`), le frecce e il fuoco della fila non cambiano: è solo pelle, comune ai fogli e ai documenti.
- I ganci: i `kit-ribbon-*` in un pezzo nuovo di `anatomia/kit.ts`; quelli `grid-ribbon-*` che non hanno più regole escono da `anatomia/editors.ts`.
- Il blocco del prototipo è ricavato dalle regole `.grid-ribbon-*` di `main` a `3f4f3731`, con lo stesso testo e la stessa specificità. Se K3 o griglia le hanno cambiate, il blocco si rifà dalle regole nuove con lo stesso cambio di nome, e il report dice che cosa è cambiato.
- `docs/architecture/grid-surface.md`: la forma della barra sta nel kit, e ai fogli restano le loro parti.
Dal prototipo: `structure.css` 277–556; `skin/kit.css` 615–972, 974–1000 e 1002–1042; gli stati `foglio`, `caricamento`, `errore`, `molti` e `tel-foglio`, e `documento` e `documento-700` per il vassoio e le sezioni; le caselle «Il vassoio delle barre» e «Le sezioni della barra» di «Rimetti com'era», per il prima e il dopo.
Casi limite:
- la barra del documento prende subito le regole `kit-ribbon-*`: la foto di `document-docx` va guardata anche qui, e le differenze che restano sono di T21;
- i gruppi raccolti a 700 px, aperti sul posto;
- le schede contestuali;
- i suggerimenti dei tasti (`keytip`);
- il telefono (`mobile-grid-ribbon`);
- la barra chiusa e aperta;
- l'ordine della cascata: le regole del kit vengono prima di quelle dei fogli, così una regola sola dei fogli vince ancora;
- le sezioni a 700 px: ci stanno tutte, quella della selezione compresa;
- `forced-colors`: la sezione scelta resta col contorno del kit (`.kit-tab[aria-selected]`).
Fatto quando:
- `ribbon.test.ts`, `anatomia.test.ts` e `npm run theme:verify` passano, e `npm run bench:a11y` resta verde (il contrasto delle sezioni e del vassoio);
- la foto di `grid-workbook`, `grid-result-loading`, `grid-result-error`, `grid-result-many` e `mobile-grid-ribbon`, in giorno e notte, a 1280 e a 700, sta accanto agli stati `foglio`, `caricamento`, `errore`, `molti` e `tel-foglio`, e la barra dei fogli non perde niente rispetto a oggi: il vassoio è quello più chiaro e la sezione scelta è il foglietto, come nel prototipo;
- la foto di `document-docx` e `document-docx-narrow` si guarda: le differenze che restano sul vassoio e sulle sezioni del documento sono di T21.
Prova: scripts/check.sh --rapido
Stato: [x] fatto · 2d0e89f7..2b6f06e3 · la barra a schede è del kit (`kit-ribbon-*` accanto ai prefissi `grid-ribbon-*` e `rich-ribbon-*`, che restano nel DOM); vassoio chiaro, sezione scelta a foglietto, nome al 600 senza spostare le vicine; nel contratto dei temi escono 22 hook `grid-ribbon-*` ed entrano 25 `kit-ribbon-*`; il documento resta a metà fino a T21

## T21 · La barra a schede del documento

Perché: la barra del documento Word e ODT è la stessa barra a schede dei fogli: prende le regole del kit, tiene solo la sua galleria degli stili, e un gruppo raccolto si apre sul posto (D8).
Tocca: `apps/client/src/editors/rich/ribbon.ts`, `apps/client/src/editors/rich/ribbon.test.ts`, `apps/client/src/theme/scrittoio/skin/editors.css`, `apps/client/src/theme/scrittoio/anatomia/editors.ts`, `apps/client/src/theme/scrittoio/structure.css`, `docs/product/word-documents.md`, `docs/architecture/rich-surface-and-proofing.md`
Non toccare: `apps/client/src/tabella/ribbon.ts`; i comandi e le schede del documento; `apps/client/src/editors/rich/icons.ts` (le figure delle modalità, che T2 usa così come sono); `apps/client/src/kit/ribbon/ribbon.ts` (T20).
Dipende da: T20 (aspetta K3 in `main`)
Cosa fare:
- `rich/ribbon.ts` passa `openInPlace: true` al kit, come fa la barra dei fogli in K3; il riquadro sospeso di oggi non si apre più per un gruppo raccolto.
- `ribbon.test.ts`: a 700 px un gruppo raccolto si apre sul posto, Esc lo chiude e il fuoco torna al suo bottone.
- `skin/editors.css` (la sezione dei documenti di videoscrittura) e `structure.css`: si tolgono le regole `.rich-ribbon-<parte>` che `kit-ribbon-*` rifà; restano la galleria degli stili, i campioni e le parti del documento.
  - Fra queste ci sono quelle che oggi danno al documento il vassoio e le sezioni (`skin/editors.css` 687–726 di `main`: `.rich-ribbon-tabs.kit-tabs`, le sue `.kit-tab`, la contestuale e `.rich-ribbon-toolbar`, in comune con `.grid-ribbon-*`, che T20 toglie). Tolte quelle, il documento prende il vassoio più chiaro e le sezioni come l'ispettore di T20, che l'utente ha chiesto proprio sul docx.
- `structure.css`: la galleria degli stili, righe 603–611 del prototipo (`rich-ribbon-styles`, `rich-ribbon-style`).
- I ganci `rich-ribbon-*` che non hanno più regole escono da `anatomia/editors.ts`.
- `docs/product/word-documents.md` e `docs/architecture/rich-surface-and-proofing.md`: la barra veste il kit, e il gruppo raccolto si apre sul posto.
Dal prototipo: `structure.css` 603–611; gli stati `documento`, `documento-700`, `sola-lettura` e `tel-doc`.
Casi limite:
- il documento in sola lettura (`document-readonly`): la barra resta com'è oggi, cambia solo la veste;
- la scheda contestuale della tabella (`tabella/ribbon.ts`);
- un gruppo raccolto aperto quando la finestra si allarga: fa come nei fogli con K3;
- la galleria degli stili con un nome lungo;
- la modalità Lettura, che nasconde la barra;
- le sezioni contestuali della tabella tengono l'accento, come nei fogli;
- il telefono (`mobile-document`, stato `tel-doc`): la barra raccolta non copre il tondo della modalità (T3), e il pulsante dei commenti gli sta a sinistra, sulla stessa riga (`mobile.css`, la regola di `.rich-side-open` di T3).
Fatto quando:
- `ribbon.test.ts` e `anatomia.test.ts` passano;
- la foto di `document-docx`, `document-docx-narrow`, `document-readonly` e `mobile-document`, in giorno e notte, sta accanto agli stati `documento`, `documento-700`, `sola-lettura` e `tel-doc`: il vassoio più chiaro e la sezione scelta come le schede dell'ispettore, uguali a quelle dei fogli;
- `npm run bench:a11y` resta verde.
Prova: scripts/check.sh --rapido
Stato: [x] fatto

## T22 · La testa del disegno

Perché: la testa del disegno ha la sua barra; nella fila di serie si legge come le altre, e il gettone del motore resta suo.
Tocca: `apps/client/src/editors/spatial/tools/editor/toolbar.ts`, `apps/client/src/theme/scrittoio/skin/draw.css`, `apps/client/src/theme/scrittoio/anatomia/draw.ts`, `apps/client/src/theme/scrittoio/structure.css`, `docs/product/drawing-view.md`, `docs/architecture/ink-and-tools.md`
Non toccare: `apps/client/src/editors/spatial/tools/editor/chrome/rail.ts` (K5); gli strumenti e i loro tasti; il gettone del motore; il piano del disegno.
Dipende da: T16, T17
Cosa fare:
- `toolbar.ts`: `draw-toolbar` prende `kit-bar`, `draw-group` prende `kit-bar-group`, i pulsanti `kit-bar-button`; le frecce sono quelle di `rovingToolbar`, e i pulsanti che oggi sono un punto di Tab ciascuno (menu, annulla, ripeti, esporta, intorno alla riga 360) entrano nello stesso giro.
- `skin/draw.css` e `structure.css` (`.draw-header` e `.draw-toolbar`, intorno alle righe 2960 e 2966): si tolgono le regole di forma e di pelle che `kit-bar` rifà; resta `data-bare` (riga 3215), che nasconde la testa.
- I ganci di `anatomia/draw.ts` seguono la pelle.
- Se K5 T25 approva un prototipo diverso prima di questo task, si segue quello (vedi «Domande per l'orchestratore»).
- `docs/product/drawing-view.md` e `docs/architecture/ink-and-tools.md`: la testa veste il kit.
Dal prototipo: gli stati `disegno` e `disegno-700`.
Casi limite:
- l'interfaccia nascosta (`Ctrl+.`): la testa resta nascosta;
- il colore e lo spessore nella fila;
- l'esportazione in corso;
- 700 px: il troppo in «…»;
- un PDF annotato (Annota): la stessa testa;
- il contrasto alto.
Fatto quando:
- i test del disegno passano;
- la foto di `draw-open`, in giorno e notte, a 1280 e a 700, sta accanto a `?stato=disegno`;
- la testa ha un solo punto di Tab.
Prova: scripts/check.sh --rapido
Stato: [x] fatto

## T23 · L'icona della modalità della lavagna

Perché: la lavagna segue il piano N6 («preferisco quella del piano originale. Mi piace il piano in schede della lavagna»), che vince; da questo piano prende solo la cornice comune (T2, T3, T5) e l'icona della sua modalità nel menu della banda e nel tondo del telefono.
Tocca: `apps/client/src/editors/canvas/surface.ts`, `apps/client/src/state/mode-menu.test.ts` (arriva con T2)
Non toccare: tutto il resto della lavagna, che è di N6: `apps/client/src/editors/canvas/engine.ts`, la sua barra, le opzioni, la colonna, la banda (N6 T52), la tela e il suo contrasto (N6 T22), le regole della lavagna in `skin/editors.css` e `structure.css`, `anatomia/editors.ts`; il gettone della penna (N4); i comandi della lavagna.
Dipende da: T2, T3 (non aspetta N6)
Cosa fare:
- `surface.ts` (righe 259–262): la modalità `canvas` prende `icon: "layout-dashboard"`, sulla stessa riga del suo letterale, perché `surface-looks.test.ts` legge le modalità riga per riga. `layout-dashboard` è già in `ui/icons.ts` (è l'alias di `dashboard`, riga 111). La modalità `source` resta senza icona e prende quella del ruolo (`code`).
- `mode-menu.test.ts`: un caso per la lavagna, le sue due voci con le loro figure e senza separatore.
- Se N6 è entrato prima in `main` e ha cambiato le righe delle modalità, si ribasa e la riga dell'icona si rimette sul letterale di oggi; se entra dopo, ribasa N6. Nessuno dei due tocca le righe dell'altro.
- `docs/`: nessuna pagina; la pagina della lavagna la cambia N6.
Dal prototipo: niente; la lavagna non ha più uno stato suo (il disegno di riferimento è `lavagna-schede.html` di N6).
Casi limite:
- la sorgente della lavagna (`source`): l'icona del ruolo;
- la lavagna in sola lettura: il menu mostra le stesse figure;
- telefono: il tondo della modalità mostra la figura della lavagna.
Fatto quando:
- `mode-menu.test.ts`, `surface-looks.test.ts` e i test della lavagna passano;
- il menu delle modalità della banda, aperto su una lavagna, mostra la figura;
- se N6 T49–T52 sono già in `main`, una foto della lavagna con la cornice comune sta accanto a `lavagna-schede.html` di N6; se non ci sono, il report lo dice.
Prova: scripts/check.sh --rapido
Stato: [x] fatto

## T24 · Le scene nuove del banco

Perché: ciò che il piano cambia deve restare fotografato, compreso ciò che oggi non ha una scena (il menu delle modalità, la barra di formato sul computer, le figure, la nota a 700 px).
Tocca: `apps/client/bench/scene.mjs`, `apps/client/bench/a11y.mjs`, `apps/client/bench/scene.test.ts`, `apps/client/bench/baseline/` (tutte le PNG, con `git rm`), `docs/development/testing-and-quality.md`
Non toccare: le scene degli altri piani; `apps/client/bench/photos.mjs`; `.github/workflows/ci.yml`.
Dipende da: T3–T23, T27, T28
Cosa fare:
- Le scene nuove in `scene.mjs`, ognuna con titolo e `prepare`:
  - `banda-modalita`: la nota col menu delle modalità aperto dalla banda (stato `nota`);
  - `nota-stretta`: la nota a 700×800 (stato `nota-700`);
  - `barra-formato` e `barra-formato-stretta`: la nota con `?formatbar=1`, a 1280 e a 700 (stati `barra` e `barra-700`);
  - `icone-figure` e `icone-emoji`: il selettore dell'icona aperto su una cartella, sulle figure e con `?icone=emoji` (stati `icone` e `icone-emoji`);
- `a11y.mjs` (`inspectKeyboard`, intorno alla riga 377): `#status-mode` apre il menu con Invio, Esc lo chiude e il fuoco torna sulla banda; la barra di formato e quella del PDF sono un punto di Tab ciascuna.
- `scene.test.ts` cambia solo se una scena nuova apre una pagina che il presidio non conosce.
- Le baseline: `bench/scene.test.ts` vuole che ci siano tutte o nessuna, quindi le scene nuove senza foto lo farebbero fallire. Il task toglie **tutte** le PNG di `bench/baseline/` con `git rm`, che è lo stato che il presidio dichiara fra le scene nuove e il loro artefatto; T25 le rimette tutte dal runner. Nessuna si rifà in locale.
- `docs/development/testing-and-quality.md`: le scene nuove.
Dal prototipo: gli stati elencati sopra; `vuoto`, `ricerca`, `grafo`, `impostazioni`, `componenti` e `zero` hanno già la loro scena.
Casi limite:
- aspetta le scene di griglia T8, A1 T13, caricamento T4, K3 T17 e N7 T32: se una arriva in `main` dopo questo task, la fusione rimette le sue baseline, e l'orchestratore le toglie di nuovo prima di spingere;
- una scena che dipende da un tempo (le animazioni ferme del banco);
- il menu aperto nella foto: la scena aspetta che sia montato;
- `?formatbar=1` non deve cambiare le scene di oggi;
- il job visivo resta rosso fino a T25, come il presidio dice.
Fatto quando:
- `npx vitest run bench` passa, con la cartella delle baseline vuota;
- in locale `npm run bench:a11y` passa sulle scene nuove;
- ogni scena nuova si apre nel banco e la sua foto locale sta accanto al suo stato del prototipo.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T25 · Le baseline dal runner

Perché: le baseline sono specifiche del runner Linux e si rifanno una volta sola, alla fine, con tutte le scene dentro.
Tocca: `apps/client/bench/baseline/` (tutte le PNG)
Non toccare: ogni altro file; nessuna PNG fatta in locale.
Dipende da: T24
Cosa fare:
- Lo fa l'orchestratore, perché un coder non lancia la CI: `gh workflow run ci.yml --ref piano/scrittoio-2`, oppure la PR segnata pronta (vedi «Domande per l'orchestratore»), e l'attesa in background.
- Il job visivo, senza baseline, fallisce e carica l'artefatto `banco-visivo-<sha>`: si scarica con `gh api repos/Fubeo/Fub/actions/artifacts/<id>/zip` in una cartella nuova e vuota sotto `$TMPDIR`.
- Si controlla che `attuale/` abbia due foto (giorno e notte) per ogni scena, cioè il numero che `scene.test.ts` si aspetta, e si copia tutta in `bench/baseline/`.
- Prima del commit si guardano le foto delle scene del piano accanto ai loro stati del prototipo, in giorno e notte; una differenza che non si spiega torna al task che l'ha fatta, e le baseline si rifanno.
- Un commit solo: `test(banco): le baseline di Scrittoio 2, dal runner (banco-visivo di <sha>)`, senza trailer.
- Si rilancia la CI: il job visivo e quello dell'accessibilità passano.
Dal prototipo: tutti gli stati.
Casi limite:
- l'artefatto è di un commit vecchio: si rifà sul commit in cima al ramo;
- una scena fallisce nel runner e non ha foto: si corregge la scena (T24), non si copia a metà;
- un piano entra in `main` fra l'artefatto e il commit: si fonde prima, e si rifà l'artefatto;
- `gh run download` rifiuta l'artefatto: si usa `gh api`.
Fatto quando: `npx vitest run bench` passa con tutte le baseline, e nella CI il job visivo e quello dell'accessibilità sono verdi sul commit delle baseline.
Prova: scripts/check.sh --rapido
Stato: [ ] da fare

## T26 · La chiusura

Perché: il piano si chiude solo con la CI completa verde, le guardie dei documenti verdi e un ultimo giro di occhi.
Tocca: `PLAN.md` (le righe `Stato:`), `DECISIONS.md` (le scelte prese durante il lavoro)
Non toccare: il codice e le baseline; se la rilettura trova un difetto, torna al task che l'ha fatto.
Dipende da: T25
Cosa fare:
- La PR segnata pronta: la CI completa, con Windows e macOS, e i banchi.
- `scripts/check.sh` completo sullo stato finale, e tutte le guardie dei documenti elencate in `CONTRIBUTING.md` fra `ci-required:start` ed `ci-required:end`.
- Il diff intero riletto: classi senza gancio, regole vecchie rimaste accanto alle nuove, stringhe solo in una lingua, ascoltatori senza disposer, pagine di `docs/` che non dicono più il presente.
- Per ogni stato del prototipo, la foto della sua scena dal runner accanto, in giorno e notte, con le differenze che restano scritte nel resoconto.
- L'anteprima sulla 1432 aggiornata col ramo, come dice `CLAUDE_DEVICE.md`.
- Ogni `Stato:` di `PLAN.md` dice il vero, e `DECISIONS.md` registra le scelte prese strada facendo.
Dal prototipo: tutti gli stati.
Casi limite: un job rosso su Windows o macOS che in Linux non si vede; un test noto come instabile (si rilancia una volta, poi si indaga); un piano entrato in `main` dopo T25, che costringe a rifare le baseline.
Fatto quando:
- la CI completa della PR è verde;
- le guardie dei documenti passano;
- il resoconto finale elenca le differenze rimaste fra le foto e il prototipo, e l'utente può dare l'OK alla fusione.
Prova: scripts/check.sh --rapido, poi `scripts/check.sh`
Stato: [ ] da fare

## T27 · L'ombra del foglio

Perché: l'utente, 2026-11-04: «Riguardo lo scrittoio… aggiustare l'ombra relativa allo spazio di lavoro, perché non è granché. In questo momento è praticamente un rettangolo perfetto, la parte bassa dell'ombra, e non si vede l'ombra laterale». L'ombra la taglia `#panes`, che ha `overflow: hidden`: ai fianchi finisce a filo del foglio, sotto dopo 8 px, e resta un rettangolo. Il foglio deve sembrare appoggiato sulla scrivania, con un'ombra morbida a strati che si vede ai fianchi, in giorno e notte.
Tocca: `apps/client/src/theme/scrittoio/recipe.ts`, `apps/client/src/theme/recipe.test.ts`, `apps/client/src/theme/scrittoio/structure.css`, `apps/client/src/theme/scrittoio/skin/sheets.css`, `apps/client/src/theme/scrittoio/skin/motion.css`, `apps/client/src/shells/scrittoio/mobile/mobile.css`
Non toccare: `overflow: hidden` di `#panes`, che resta; `--sheet-gap` e la posizione dei fogli; gli altri livelli d'ombra (`--shadow-1`…`--shadow-4`), che usano menu, cassetti e foglietti; `state/shell-geometry.ts` e i divisori; `--bar-tray` (T16).
Dipende da: T5, T6, T17 (dopo di loro su `structure.css`, `skin/sheets.css` e `mobile.css`)
Cosa fare:
- `structure.css`, `#panes` (righe 589–607 di `main`): la scrivania si allarga di `--sheet-reach` (20 px) verso i vicini che stanno dentro la finestra (il cassetto o il binario a sinistra, la banda sotto, l'ispettore agganciato a destra) con un margine negativo, e restituisce la stessa misura in padding: i fogli restano dove sono, e l'ombra ha spazio per sfumare.
  - Verso il bordo della finestra non si allarga mai, perché a destra e sotto l'eccedenza renderebbe `#app` scorrevole: a destra solo con l'ispettore agganciato, sotto niente quando la banda è spenta (`#app[data-status-off]`).
  - La fascia in più non prende i clic: `pointer-events: none` su `#panes` e `auto` sui suoi figli, così il cassetto, l'ispettore, la banda e i divisori sotto l'ombra restano vivi.
  - Niente fascia nel benvenuto (`#app[data-welcome]`), che non ha fogli, e nella modalità concentrata (`#app[data-focus-mode]`), che non ha vicini.
  - `.pane` prende `z-index: var(--z-sheet)`, così la sua ombra cade sull'ispettore, che viene dopo nel DOM e la coprirebbe; divisori, cassetti e menu restano sopra.
  - Le regole si fondono in quelle di `#panes` che ci sono (la riga di base, il padding senza cassetto, quello con l'ispettore agganciato): nessuna regola nuova in coda che scavalca la vecchia. Le regole di `#panes` del benvenuto e della concentrazione (righe 1202, 1206 e 1390 di `main`) restano e si guardano con la fascia.
- `recipe.ts`: due ruoli facoltativi nuovi nella tavolozza, accanto a `shadow-1`…`shadow-4`, e nell'elenco di `OPTIONAL_ROLES`:
  - `shadow-sheet`, il foglio a riposo: tre strati, il contatto, una penombra corta e una lunga, e le due larghe con lo spread negativo, così l'ombra scende sotto il foglio e si vede ai fianchi. Di giorno l'inchiostro di `shadow()`, `0 1px 2px` all'8 %, `0 2px 8px -1px` all'8 % e `0 8px 16px -6px` al 14 %; di notte il nero, al 40, 45 e 60 %, perché la scrivania è già quasi nera;
  - `shadow-sheet-focus`, il foglio a fuoco: lo stesso disegno un passo più fondo, `0 1px 3px`, `0 3px 10px -1px` e `0 10px 20px -6px`, di giorno al 9, 10 e 18 %, di notte al 45, 50 e 66 %;
  - col contrasto alto gli stessi valori; niente filo di luce, che sotto il 10 % non si vede e sopra è un bordo che si interrompe alla linguetta;
  - poi `npm run theme:generate` (i fogli generati e `theme/author/`).
- `recipe.test.ts` (riga 112): il conto dei ruoli facoltativi diventa `39 + 6 + 18 + 3`, con `--bar-tray` di T16; i ruoli obbligatori restano 154.
- `skin/sheets.css` (righe 10–17 di `main`): `.pane::before` prende `var(--shadow-sheet, var(--shadow-1))` e `.pane.focus::before` `var(--shadow-sheet-focus, var(--shadow-2))`, così un tema che non li dichiara tiene le ombre di oggi.
- `skin/motion.css` (righe 28–32 di `main`): la sagoma del foglio che si chiude (`.sheet-ghost::before`) prende l'ombra a riposo, `var(--shadow-sheet, var(--shadow-1))`.
- `mobile.css`: in piedi (sotto i 600 px) niente fascia e niente ombra, perché la carta va da un bordo all'altro (T5) e non c'è scrivania dove cadere; sdraiato (sotto i 500 px di altezza) niente fascia in basso, perché la banda non c'è e sotto c'è il bordo dello schermo: l'ombra si vede ai fianchi.
- `docs/`: nessuna pagina descrive l'ombra del foglio né elenca i ruoli uno per uno (cercato con `grep`); il conto e l'elenco stanno in `theme/author/`, che si rigenera.
Dal prototipo: `structure.css` 228–275; `skin/sheets.css` 1676–1688; `mobile.css` 2357–2375; `recipe.ts` 2388–2415 (solo le due ombre); gli stati `nota`, `documento`, `foglio`, `vuoto`, `molti`, `tel-nota` e `tel-sdraiato`; la casella «L'ombra del foglio» di «Rimetti com'era», per il prima e il dopo.
Casi limite:
- due fogli affiancati (`nota-tre-modi`): le ombre si incontrano nello spazio di 8 px, e la coda più lunga passa di circa 2 px sotto il vicino;
- la finestra stretta (`compact`), il cassetto nascosto, il solo binario;
- l'ispettore sospeso e l'ispettore chiuso;
- i clic e il trascinamento dei divisori dentro la fascia arrivano al cassetto, all'ispettore e alla banda;
- nessuno scorrimento in più: `scrollWidth` e `scrollHeight` di `#app` e di `#layout` restano quelli di oggi;
- il benvenuto, la concentrazione, la banda spenta;
- la linguetta accesa: l'utente (2026-11-04) vuole che stia anch'essa sull'ombra, «fuso con il foglio anche per l'ombra». La linguetta accesa e il foglio fanno un'ombra sola con la stessa sagoma: ai fianchi e sopra la linguetta l'ombra si vede, e nel punto dove la linguetta entra nel foglio non c'è nessun segno. Il prototipo non lo mostra ancora: T27 lo disegna prima lì (una via possibile: la stessa ombra sulla linguetta, tagliata sotto con `clip-path` dove incontra il foglio), lo fotografa in giorno e notte e poi lo porta nel codice; le linguette spente restano senza ombra;
- la sagoma del foglio che si chiude e la linguetta trascinata (`tab-drop`);
- il telefono in piedi e sdraiato;
- il contrasto alto.
Fatto quando:
- `npx vitest run src/theme/recipe.test.ts src/theme/scrittoio src/shells/scrittoio/stage-motion.test.ts src/shells/scrittoio/sheets/tab-drop.test.ts` e `npm run theme:verify` passano;
- le foto delle scene della scrivania, `live-01-panoramica`, `tabs`, `desk`, `empty`, `nota-tre-modi`, `concentration`, `mobile-startup` e `mobile-landscape`, in giorno e notte, stanno accanto a `?stato=nota`, `?stato=documento`, `?stato=vuoto`, `?stato=tel-nota` e `?stato=tel-sdraiato`: l'ombra si vede ai fianchi e sfuma sotto, e i `getBoundingClientRect()` dei `.pane` sono quelli di prima del task; le baseline di queste scene le rifà T25 dal runner;
- una sonda del banco clicca nei 20 px accanto al foglio e arriva al cassetto, all'ispettore e alla banda, e trascina il divisore del cassetto.
Prova: scripts/check.sh --rapido
Stato: [x] fatto · eec76470, d093ef97 · differenze: l'ombra della linguetta accesa è nel codice con `clip-path`, ed è tolta al telefono in piedi; `scrollHeight` di `#layout` cresce di 20 px come nel prototipo

## T28 · Il movimento della barra a schede del documento

Perché: l'utente, 2026-11-09, sul piano originale della barra dei fogli (K3 T18–T19, artifact «Menu comandi fogli»): «le animazioni sono completamente diverse dal piano originale della barra dei fogli, che doveva avere le stesse animazioni poi anche nelle altre». Questo piano aveva lasciato fuori il movimento (Fuori scope, K3 T19), e la barra del documento non lo accende: il kit lo dà solo a chi passa `motion: true`, e oggi lo passa solo `editors/grid/ribbon/ribbon.ts`. Una sonda del banco (moto non ridotto, ora vera) lo misura: cambiando sezione nei fogli si muovono il segno della sezione e i foglietti che entrano uno dopo l'altro, e `Ctrl+F1` muove la tenda; nel documento si muove solo il segno, e `Ctrl+F1` non muove niente. Con T21 il gruppo raccolto si apre sul posto; con T28 si muove anche come nei fogli. Decisione dell'orchestratore (DECISIONS.md, 2026-11-09).
Tocca: `apps/client/src/editors/rich/ribbon.ts`, `apps/client/src/editors/rich/ribbon.test.ts`, `apps/client/src/theme/scrittoio/structure.css`, `docs/product/word-documents.md`, `docs/architecture/rich-surface-and-proofing.md`
Non toccare: `apps/client/src/kit/ribbon/ribbon.ts` e `kit/ribbon/ribbon-motion.ts` (il movimento è già scritto una volta, nel kit: si accende, non si rifà); le costanti di `moto/`; `editors/grid/`; il livello «calmo» e il moto ridotto, che il kit rispetta già.
Dipende da: T21
Cosa fare:
- `rich/ribbon.ts` passa `motion: true` al kit, come la barra dei fogli: le sezioni che entrano dal lato giusto, il segno che scorre, la tenda del ritiro e della riapertura (`Ctrl+F1`, doppio clic su una sezione, la sbirciata della barra ritirata), il foglietto che si apre sul posto e gli altri che gli fanno posto, la sezione contestuale «Tabella» che compare e svanisce, le lettere di Alt, la pressione dei pulsanti.
- `structure.css`: ciò che nel documento sta sotto la barra (`.rich-page`, `.rich-notice`, la barra della ricerca) è la tenda: sta sopra il vassoio e ha il suo fondo, come `.grid-formula-bar`, `.grid-viewport` e gli avvisi dei fogli («La formula e la griglia stanno sopra la barra…»), così l'immagine del vassoio che svanisce resta sotto e non si vede mai una cosa attraverso l'altra. Il pannello laterale del documento e il pulsante dei commenti del telefono restano sopra la tenda.
- La tenda non cambia altezza mentre corre (`holding` del kit): controllare che la pagina del documento, che scorre, non salti né mostri una fascia vuota, e che la posizione di scorrimento resti quella di prima.
- `ribbon.test.ts`: con `motion: true` il cambio di sezione fa entrare i foglietti e `Ctrl+F1` muove la tenda (come i test della barra dei fogli e di `kit/ribbon/ribbon-motion.test.ts`); col moto ridotto lo stato cambia subito.
- Le due pagine di `docs/`: la barra del documento si muove come quella dei fogli.
- `rich/ribbon.ts`, `RICH_TABS`: il gruppo «Carattere» (`font`) entra in coda all'elenco `fold` della scheda Home, così si raccoglie anche lui quando manca spazio, come nel prototipo `tel-doc` (al telefono tutti i gruppi raccolti) e come i gruppi dei fogli; a 700 px con «Stili» aperto sul posto «Carattere» non resta più tagliato a sinistra. Il resoconto di T21 lo ha trovato; decisione dell'orchestratore (2026-11-09).
Casi limite:
- il moto ridotto e il livello «calmo»: niente corse, solo lo stato (il banco gira già col moto ridotto, quindi le baseline non cambiano);
- un gesto nuovo a metà corsa (due sezioni di fila, `Ctrl+F1` due volte): fa come nei fogli;
- la modalità Lettura, che nasconde la barra, e il documento in sola lettura;
- il cursore e la selezione nel documento durante la tenda: restano dove sono;
- il telefono (`mobile-document`): la barra raccolta e il tondo della modalità.
Fatto quando:
- `ribbon.test.ts` passa;
- una sonda del banco con il moto non ridotto e l'ora vera, sullo stesso schema di quella dei fogli, conta le animazioni nel documento e nei fogli dopo un cambio di sezione, dopo `Ctrl+F1` (ritiro e riapertura) e dopo l'apertura sul posto a 700 px: sono le stesse corse, con le stesse molle; una serie di fotogrammi (0, 40, 80, 140, 260 ms) del documento e dei fogli sta nel resoconto;
- `npm run bench:a11y` resta verde.
Prova: scripts/check.sh --rapido
Stato: [x] fatto · 753d2f0d, b876ddaf · differenze: `rich-motion.ts` non segue più la barra che si ritira (la carta restava ferma mentre il testo scendeva); `.rich-notice` sta sopra la barra, fuori dalla tenda; ricerca e pagina senza `z-index`. Prima, b22a6650: «3 collegamenti» e le etichette premute da tastiera fanno un clic vero (rosso di `bench:a11y` da T12)

## Non verificato da qui

- Nel prototipo l'ispettore e la banda degli stati `documento`, `disegno` e `pdf` mostrano ancora il contenuto di Benvenuto, perché le scene di partenza lo hanno: la foto vera dirà il contenuto giusto.
- Nella scena del disegno la scheda Collegamenti dice ancora «Entranti»: cambia con T13.
- La WebView vera, Windows e macOS: si vedono solo in CI (T26).
- I punti di Tab di oggi, contati nel prototipo: il PDF ne ha otto; T18 li riduce a uno, ma il conto vero lo fa `a11y.mjs` (T24). Quelli della lavagna sono di N6.
- I numeri di riga di `main` citati nei task si sposteranno con N4, N6, N7, K3 e griglia: valgono i nomi delle regole e delle funzioni.
- Se `showContextMenu` aperto dalla banda in basso si apre verso l'alto o si sposta da sé: si vede nella foto di `banda-modalita`.
- Il costo della lettura in più di T13 a ogni pausa della selezione, in un vault grande.
- La finestra da 1000 voci di T12 in una cartella molto piena: oltre, la riga non dice il tempo.
- Le regole di K3 e griglia sulla barra dei fogli dopo la loro fusione: T20 rifà il blocco se sono cambiate.
- Telefono: nel prototipo il bottone della modalità è spostato nel DOM da una toppa della pagina, non da `panels/document.ts`; l'ordine del Tab e i clic del banco col bottone fuori dalla testata li prova T3.
- Telefono: se ogni voce del menu del marchio ha un'altra strada in piedi lo controlla T7 sul codice; il prototipo mostra solo la barra senza il marchio.
- Telefono: il tondo della modalità può coprire l'ultima parola di una riga lunga a riposo; nella foto di `mobile-startup` si vede se il margine basta (T3).
- Telefono: la barra a schede del documento raccolta (T21) e la barra in una fila sopra la tastiera (T17) sono fotografate nel prototipo con la pelle nuova, non col DOM vero.
- L'ombra fra due fogli affiancati: nel prototipo la coda più lunga passa di circa 2 px sotto il vicino; la foto di `nota-tre-modi` dirà se si vede (T27).
- L'ombra del foglio nella WebView vera: il prototipo e il banco la disegnano in Chromium; WebKitGTK, Windows e macOS si vedono solo in CI e a mano (T26).
- Il contrasto alto dei ruoli nuovi: il prototipo lo mostra coi suoi gettoni; i fogli veri del contrasto alto li provano `recipe.test.ts` e il banco dell'accessibilità (T16, T27).
- Il vassoio e le sezioni del documento: nel prototipo hanno già la pelle nuova; nel codice arrivano solo con T21, quando escono le regole `.rich-ribbon-*`.
