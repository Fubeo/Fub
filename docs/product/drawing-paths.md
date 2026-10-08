# Disegni, tracciati

> **Per chi:** chi prepara un disegno da tagliare, incidere o stampare, e chi
> vuole un tracciato pulito da modificare nodo per nodo.
> **Risultato:** sapere che cosa fanno le voci del menu «Tracciato», come si
> regolano lo scostamento e la semplificazione guardandone l'anteprima, e
> che cosa resta dell'oggetto di prima.

Dal [livello Esperto](drawing-expert.md) la barra della selezione ha il
menu **«Tracciato»**, con sei voci:

- **«Oggetto in tracciato»** fa degli oggetti scelti dei tracciati (`path`),
  con ciò che si vede e le stesse regole di sempre ([Disegni, livello
  Esperto](drawing-expert.md#oggetto-in-tracciato));
- **«Contorno in tracciato»** fa del contorno una forma piena;
- **«Inchiostro in tracciato»** fa di un tratto a penna un tracciato coi
  nodi;
- **«Scostamento…»** disegna una forma più larga o più stretta di quella
  scelta;
- **«Semplifica…»** toglie nodi lasciando la forma com'è, entro uno scarto
  che si sceglie;
- **«Unisci»** (`Ctrl+J`) fa dei tracciati aperti scelti uno solo, e un
  tracciato solo lo chiude ([Disegni, curve e tagli](drawing-curves.md#unisci)).

Una voce che non ha niente da cambiare fra gli oggetti scelti è spenta, e
dice perché: «Fra gli oggetti scelti non c'è una forma col contorno.» Le
voci si trovano nel menu, che si apre anche dalla tastiera come gli altri
della barra; soltanto «Unisci» ha un tasto, `Ctrl+J`.

## Contorno in tracciato

Il contorno di ogni forma scelta diventa l'area che dipinge, come tracciato
pieno del colore e dell'opacità del contorno: un taglierino o una stampante
che seguono i bordi la ritagliano così com'è, e lo strumento Nodi la
modifica.

- **Ciò che si vede resta**: lo spessore, i trattini e gli spazi, gli
  estremi (piatti, tondi o quadrati), gli angoli (vivi, arrotondati o
  smussati) e il limite degli angoli vivi, anche ereditati da un gruppo o da
  un livello. Le curve restano curve, a meno di mezzo centesimo, e un arco di
  cerchio resta un arco.
- **Una forma senza riempimento**, come una linea, diventa il tracciato del
  suo contorno, con lo stesso id, lo stesso posto e gli stessi attributi;
  le sue [punte](drawing-tips.md) diventano parte della forma.
- **Una forma col riempimento e col contorno** diventa un gruppo con lo
  stesso id, la trasformazione, l'opacità e il titolo: dentro, sotto, la
  forma col suo riempimento e senza contorno; sopra, il contorno in
  tracciato. Si vede come prima, e le due parti si scelgono una per una
  isolando il gruppo.
- **Testi, immagini e tratti a penna restano come sono**, come le forme
  senza contorno: il comando lo dice. Il tratto a penna è già una forma
  piena; per i suoi nodi c'è «Inchiostro in tracciato».
- **Una linea a [spessore variabile](drawing-width.md)** è già il suo
  contorno pieno: diventa il tracciato che si vede, con lo stesso id e gli
  stessi attributi, senza la linea centrale e il profilo.
- **Un contorno troppo intricato**, come un tratteggio di decine di
  migliaia di trattini, resta com'è, e lo si dice.
- **È un passo solo**, «Contorno in tracciato», e la selezione resta quella.

## Inchiostro in tracciato

Un tratto a penna è una forma piena che la penna ridisegna dal suo
inchiostro, i punti per cui è passata la mano: lo strumento Nodi non ne
mostra i nodi. «Inchiostro in tracciato» ne fa la sua **spina**: un
tracciato che passa per il mezzo del tratto, con pochi nodi lisci e gli
spigoli dove la mano li ha fatti, gli stessi di «Rendi forma».

- **Il colore e lo spessore restano**: il tracciato ha il contorno del
  colore e dell'opacità dell'inchiostro, largo quanto il pennello, con gli
  angoli tondi e gli estremi tondi se il pennello li ha. Lo spessore che
  cambiava con la pressione diventa uniforme.
- **Il tratto resta lui**: stesso id, stesso posto, stessa trasformazione,
  titolo e attributi di altri programmi. Perde l'inchiostro, il pennello, lo
  strumento e l'ora.
- **Un punto** diventa una linea lunga zero, che gli estremi tondi fanno
  vedere.
- **L'evidenziatore e gli altri oggetti non contano**; un tratto col pennello
  che non si legge resta inchiostro, e lo si dice.
- **È un passo solo**, «Inchiostro in tracciato», e la selezione resta
  quella.

## Scostamento

«Scostamento…» apre una barra in fondo al foglio, che non ferma il disegno:
mentre è aperta si può cambiare la selezione, scorrere e ingrandire, e
l'anteprima segue. Ha tre campi:

- **Distanza**, nell'unità del documento: in più allarga, in meno
  restringe. La prima volta vale 4 px, 1 mm, 0,1 cm, 0,05 in o 3 pt; poi
  quella dell'ultimo scostamento. Se il documento cambia unità, la distanza
  scritta passa alla nuova.
- **Angoli**: Vivi, Arrotondati o Smussati, come quelli di un contorno.
- **Limite**, per gli angoli vivi: oltre, l'angolo si smussa, come
  `stroke-miterlimit`. Vale 4, come in SVG, e si vede solo con gli angoli
  vivi.

Mentre si scrive, il contorno di ogni forma nuova si vede sul disegno, e
la barra dice che cosa succederà: «2 tracciati nuovi.», «1 forma sparisce: è
più stretta del doppio della distanza.» **Applica**, o `Invio` in un campo,
scrive lo scostamento; **Annulla**, o `Esc`, chiude la barra senza cambiare
niente.

- **La distanza è quella che si vede**, nella scena: una forma scalata del
  doppio si scosta come le altre, e il tracciato nuovo si scrive nelle sue
  coordinate.
- **Ogni forma scelta ha un tracciato nuovo** coi suoi colori, il suo
  contorno, la sua trasformazione e gli attributi di altri programmi; dentro
  un gruppo resta nel gruppo. Allargato le sta sotto, ristretto sopra: così
  si vedono entrambi. La forma di prima resta, e dopo sono scelti i
  tracciati nuovi.
- **Si scosta l'area**, non il contorno: quella che la forma racchiude,
  anche senza riempimento, ripulita delle sovrapposizioni. Le curve restano
  curve, a meno di mezzo centesimo, e gli archi di cerchio restano archi.
- **Una forma aperta senza area**, come una linea o una spezzata, si allarga
  in una striscia attorno a lei, coi capi tondi se gli angoli sono
  arrotondati e quadrati altrimenti; restringerla non lascia niente.
- **Restringere più di metà della larghezza** fa sparire la forma, o le sue
  parti strette: una forma da cui non resta niente non ha un tracciato, e lo
  si dice.
- **Testi e immagini** non hanno un'area e restano come sono; un tratto a
  penna si scosta come la forma piena che è.
- **È un passo solo**, «Scostamento», anche per molte forme.

## Semplifica

«Semplifica…» apre la stessa barra con un cursore, **Semplificazione**:
più a destra, meno nodi e uno scarto più grande. Lo scarto va da un
diecimillesimo a un ventesimo della diagonale delle forme scelte, così il
cursore fa lo stesso su un'icona e su una mappa; la prima volta è a metà.

Mentre si sposta, sul disegno si vedono le forme semplificate e i loro
nodi, e la barra li conta: «Da 64 nodi a 8, scarto fino a 0,51.» Con più di
duemila nodi si vedono soltanto le forme. **Applica**, o `Invio`, le
scrive; **Annulla**, o `Esc`, lascia tutto com'era.

- **La forma resta lei.** Ogni punto di quella nuova sta entro lo scarto da
  quella di prima, e ogni punto di quella di prima entro lo scarto da quella
  nuova, più l'arrotondamento al centesimo con cui si scrivono i numeri. Lo
  scarto è nella scena, come lo si vede, anche su una forma scalata.
- **Gli spigoli restano spigoli**: un nodo dove il tracciato gira di più di
  35° resta, e le curve vi arrivano senza raccordarsi.
- **Le linee lunghe restano linee**, e le curve accanto ne prendono il verso:
  un rettangolo arrotondato tiene i lati dritti. Punti in fila su una retta
  diventano una linea sola.
- **Mai più nodi di prima**: un tratto che con le curve nuove ne avrebbe
  quanti o più di prima resta com'era, anche un arco. Un rettangolo non
  cambia.
- **Le forme diventano tracciati** solo se cambiano, con lo stesso id, lo
  stesso posto e gli stessi attributi, come con «Oggetto in tracciato».
- **I tratti a penna restano**: la penna li ridisegna dall'inchiostro. Per
  semplificarli li si fa prima tracciati con «Inchiostro in tracciato», e la
  barra lo ricorda.
- **Una linea a spessore variabile** semplifica la sua linea centrale, e il
  profilo la segue: il contorno si rifà dalla linea nuova.
- **È un passo solo**, «Semplifica», e la selezione resta quella.

## Dalla tastiera e con un lettore di schermo

La barra è un gruppo col nome del comando, «Scostamento» o «Semplifica».
Aprendola il fuoco va alla distanza, già scelta per riscriverla, o al
cursore; `Tab` passa fra i campi e i pulsanti. La frase che dice che cosa
succederà si legge da sola quando cambia, e il cursore si legge con lo
scarto che sceglie, «scarto fino a 0,51», invece che col numero. Dopo
Applica il fuoco torna al foglio, e si dice che cosa è cambiato: «1
tracciato nuovo, scostato di 2.»

Aprire la barra chiude quella della descrizione di un'immagine. Cambiare
livello, o aprire un documento che non si modifica, la chiude.

## Chi monta l'editor

I comandi stanno in `apps/client/src/editors/spatial/tools/paths.ts`; la
geometria del contorno e dello scostamento in `offset.ts`, la
semplificazione in `simplify.ts` e `fit.ts`, la spina dell'inchiostro in
`spine.ts`; la barra e l'anteprima in `editor.ts`. La misura dello scarto
su un corpus di tracciati, nei due versi, è in `simplify.test.ts`.

Non c'è niente da montare: il menu viene col livello Esperto, e nel
Personalizzato è la parte «Tracciato: oggetti, contorni e inchiostro in
tracciato, scostamento, semplifica, unisci» ([Disegni, livello
Personalizzato](drawing-custom.md)).
