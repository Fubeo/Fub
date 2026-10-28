# Disegni, proprietà

> **Per chi:** chi vuole vedere e scrivere coi numeri com'è fatto ciò che ha
> scelto, e come è fatto il disegno.
> **Risultato:** sapere che cosa c'è nel pannello delle proprietà, come vi si
> scrive un valore, e dove sta la barra della selezione.

In tutti e due gli spazi di lavoro il [disegno](drawing.md) ha il pannello
delle proprietà, nella scheda «Design» dell'ispettore. Con una selezione dice com'è fatta e come si vede,
in campi che si scrivono: posizione e misure, colori e contorno, il testo,
come disporla. Senza selezione dice com'è fatto il disegno: i suoi colori,
la pagina, l'unità di misura, la descrizione e come si vede il foglio.
Nello Scrittoio il pannello sta nella scheda **Design** dell'ispettore, a
destra, con gli attributi e le tavole; le altre schede del disegno sono
Livelli (l'albero degli oggetti), Risorse (forme e simboli, con una ricerca
sola quando ci sono tutti e due), Cronologia e Accessibilità. Dove l'editor
tiene i pannelli con sé, come nei test, il pannello sta con l'albero degli
oggetti, sotto di lui, e su un riquadro stretto va sotto il foglio
(`apps/client/src/editors/spatial/tools/properties.ts`, i campi in
`apps/client/src/editors/spatial/tools/fields.ts`).

## Aprirlo

«Proprietà», nella barra, apre e chiude il pannello. `Invio` sul foglio, o su
una riga dell'albero degli oggetti, porta il fuoco al primo campo che si
scrive, e apre il pannello se è chiuso; `Esc` riporta il fuoco al foglio.

La prima volta il pannello si apre da solo se l'editor è largo almeno 36 rem,
576 pixel coi caratteri di serie, e resta chiuso su uno schermo più stretto,
dove il foglio ha bisogno di tutto lo spazio. Aprirlo o chiuderlo è una
scelta della vista, come la griglia: non entra nel file e si ricorda su
questa macchina. Chi monta l'editor la legge e la sceglie in `grid.panel`,
con `grid`, `setGrid` e `onGridChange`.

## Le sezioni

Il pannello ha in cima ciò di cui parla, «Rettangolo», «3 oggetti», «Tavola
2 di 5» o «Il disegno», e sotto le sezioni. L'intestazione di una sezione è un
pulsante che la apre e la chiude; le sezioni chiuse si ricordano con la vista,
in `grid.closed`. Di partenza sono chiuse «Trasforma» e «Attributi», le due
del Completo. Una sezione senza niente da mostrare non c'è.

- **Posizione e misure.** X e Y sono l'angolo in alto a sinistra della
  cornice, anche di un oggetto ruotato; Larghezza e Altezza le misure lungo i
  suoi lati, contorno compreso, quelle che si leggono mentre si tira una
  maniglia ([Disegni, trasformare](drawing-transform.md)); Rotazione l'angolo
  del suo lato in alto. Più oggetti hanno il riquadro che li contiene, finché
  non ruotano insieme. Il lucchetto «Mantieni le proporzioni» parte chiuso se
  fra gli oggetti scelti c'è un gruppo, un collegamento, un tratto a penna, un
  testo o un'immagine, che deformati non sarebbero più loro, e aperto per le
  sole forme; aperto o chiuso a mano, resta così finché la selezione non
  cambia. Il lato di una linea dritta, alto zero, si legge e non si scrive.
- **Trasforma**, nel Completo: rotazione in senso orario, scale e inclinazioni,
  come la finestra «Trasforma…». I campi dicono di quanto trasformare, non
  quanto l'oggetto è trasformato: partono da ciò che non cambia niente e
  aspettano **Applica**. Dopo restano come sono, e un secondo «Applica»
  ripete la trasformazione.
- **Disponi.** Allineare i bordi e i centri, distribuire in orizzontale e in
  verticale, e l'ordine, come la barra «Disponi» di [Disegni](drawing.md). Un
  comando che adesso non serve resta raggiungibile, sbiadito, e dice perché.
- **Aspetto.** In testa, con la parte «Stili del documento», lo Stile
  grafico che gli oggetti seguono ([Disegni, stili](drawing-styles.md)); poi
  l'Opacità e, nel Completo, la Fusione, con «Isola la fusione» per gruppi e
  collegamenti ([Disegni, effetti e fusione](drawing-effects.md#la-fusione)).
- **Riempimento**, con la parte «Colori personalizzati»: il colore che
  riempie gli oggetti, con sotto il contrasto con la carta.
- **Sfumatura.** Il tipo, Pieno, Lineare o Radiale, la barra dei punti coi
  campi del punto scelto, le sfumature pronte, «Inverti» e l'Angolo;
  nel Completo anche «Oltre i capi» ([Disegni, sfumature](drawing-gradients.md)).
- **Campitura.** Il tipo, fra le campiture pronte e, nel Completo, i motivi
  del documento, e i campi della campitura: Colore, Fondo, Passo, Spessore
  e Angolo ([Disegni, campiture e motivi](drawing-patterns.md)).
- **Contorno.** Il colore, con la parte «Colori personalizzati», lo
  Spessore e il Tratteggio; nel Completo anche Estremi e Angoli, come il menu
  «Contorno» di [Disegni, strumenti avanzati](drawing-expert.md); per linee,
  connettori e tracciati aperti, «Punta d’inizio» e «Punta di fine»
  ([Disegni, punte delle linee](drawing-tips.md)).
- **Effetti**, nel Completo: le ombre, i bagliori e la sfocatura dell'oggetto,
  una riga per effetto, con «Aggiungi effetto» nell'intestazione ([Disegni,
  effetti e fusione](drawing-effects.md#la-sezione-effetti)).
- **Testo.** Con la parte «Stili del documento» lo Stile di testo, coi suoi
  stili di serie; senza, lo Stile, un corpo e un peso insieme. Poi
  Carattere, fra Inter, Literata e JetBrains Mono e, con la parte «Caratteri
  del vault» del Completo, i [caratteri del vault](drawing-fonts.md), con
  sotto il carattere usato quando uno non si carica; Dimensione, Peso,
  l'Enfasi (grassetto, corsivo, sottolineato e barrato), Interlinea,
  Spaziatura e Allineamento, per tutto il testo anche quando le sue parole
  sono diverse ([Disegni, tipografia](drawing-typography.md)).
  Con la parte «Testo in area e su tracciato», del Completo, anche il Tipo
  di testo, da punto o in area, e la Larghezza del riquadro di un testo in
  area ([il testo in area](drawing-typography.md#il-testo-in-area)).
- **Forma**, per poligoni, stelle e rettangoli: Tipo, Lati o Punte, Raggio
  interno di una stella e Raggio degli angoli; senza selezione, col Poligono
  in mano, quelli dello strumento ([Disegni, poligoni e stelle](drawing-shapes.md)).
  In testa, con la parte «Simboli», il Simbolo delle istanze scelte
  ([Disegni, simboli](drawing-symbols.md#la-riga-simbolo)).
- **Connettore**, per i connettori scelti: il Tipo, fra Dritto, A gomito e
  Curvo; l'Aggancio d’inizio e quello di fine; l'Etichetta; e «Inverti», che
  scambia inizio e fine ([Disegni, connettori](drawing-connectors.md)).
- **Ripetizione**, nel Completo, per una ripetizione scelta: il Tipo, con
  «Espandi la ripetizione», e i suoi valori, le Volte, il Raggio e il Centro
  di una radiale, le Colonne, le Righe e i passi di una griglia, l'Angolo e
  la Distanza dell'asse di uno specchio ([Disegni, ripetizioni e
  simmetria](drawing-repeats.md#la-sezione-ripetizione)).
- **Simmetria**, senza selezione, con la penna o l'evidenziatore in mano: il
  Tipo, gli Spicchi e «Specchiata» di una radiale, e il Centro ([Disegni,
  ripetizioni e simmetria](drawing-repeats.md#la-penna-in-simmetria)).
- **Esporta la selezione**, con oggetti scelti e la finestra «Esporta»
  disponibile: «Esporta…» apre la finestra con la selezione già scelta come
  cosa da esportare, e lì si scelgono formato e scala.
- **Attributi**, nel Completo: la tabella degli attributi dell'oggetto, dentro
  il pannello.
- **Documento**, senza selezione: in un disegno senza tavole Formato e
  Orientamento della pagina, con le misure pronte delle tavole; poi Larghezza
  e Altezza della pagina, l'unità di misura e la descrizione. Il titolo sta
  in cima al pannello.
- **Tavola**, senza selezione, con lo strumento Tavola e una tavola scelta:
  Nome, Formato, Orientamento, X, Y, Larghezza e Altezza della tavola
  ([Disegni, tavole](drawing-boards.md#le-proprietà)).
- **Griglia e guide**, senza selezione: le caselle della griglia,
  dell'aggancio, delle guide intelligenti, dei righelli e delle guide, e
  quella della barra della selezione, come in «Pagina e griglia».
- **Colori del documento**, in fondo, con e senza selezione: i campioni, i
  colori usati e i recenti, da dare agli oggetti scelti o con cui disegnare ([Disegni, colori](drawing-colors.md#la-sezione-colori-del-documento)).

## Scrivere un valore

- **Un valore parte con `Invio`, o lasciando il campo**, come negli
  attributi; una scelta da un elenco parte quando si fa. `Esc` riporta il
  campo a com'era e, di nuovo, torna al foglio. Nella descrizione `Invio` va
  a capo, e `Ctrl+Invio` o `⌘Invio` scrive.
- **I numeri si calcolano**: `120+15`, `200/3`, `25mm` in un documento in
  pixel, `50%` della misura di adesso. Le frecce su e giù cambiano un numero
  di 1, 10 con `Maiusc`, e partono subito: i colpi di fila si annullano
  insieme.
- **Le lunghezze sono nell'unità del documento**, col nome del campo che la
  dice, «Larghezza (mm)», come in [Disegni, righelli e
  guide](drawing-rulers.md). Lo spessore del contorno e la dimensione del
  testo sono in punti, come nei programmi di disegno e d'impaginazione, e in
  pixel in un documento in pixel. Le rotazioni sono in gradi, l'opacità e le
  scale in percentuale.
- **Un colore** si scrive come codice, `#0072b2`, come nome, `red`, col nome
  di un campione del documento, o «nessuno». Il pulsante del colore accanto
  al campo apre il selettore dei colori: in cima i consigliati, tondi e col
  nome, poi i colori del documento e i recenti, e sotto un colore qualunque
  col quadrato, la tinta e l'opacità, o scritto. Il colore si vede mentre lo
  si tira e si scrive quando lo si lascia; uno uguale a un campione del
  documento si scrive come quel campione. Sotto il campo, il contrasto con
  la carta ([Disegni, colori](drawing-colors.md#il-campo-del-colore-e-il-contrasto)).
- **Un campo misto dice «Misto»**: gli oggetti scelti hanno valori diversi.
  Scriverlo dà il valore a tutti, in un passo solo.
- **Un valore che non va non parte.** Resta scritto, il campo è segnato e
  sotto c'è che cosa ci vuole; `Invio` lo dice anche a voce. Una scala dello
  zero per cento non c'è: schiaccerebbe gli oggetti su una linea.
- **Ogni cambio è un passo di annulla**, col nome di ciò che fa,
  «Spostamento», «Ridimensionamento» o «Riempimento», come lo stesso cambio
  fatto col puntatore o coi menu. Spostare un oggetto fuori dalla pagina la
  allarga, come col puntatore. Un cambio riuscito non si annuncia: il campo
  dice già il valore.
- **Il disegno può cambiare mentre si scrive**, per un annulla, per un gesto
  sul foglio o per chi lavora insieme: i campi si aggiornano, e quello col
  fuoco tiene ciò che c'è scritto. I valori seguono un gesto quando finisce,
  non mentre lo si fa.
- **I tasti del foglio non partono dal pannello**: un `?` o un `Canc` scritti
  in un campo restano lì. Fuori da un campo di testo `Ctrl+Z` annulla come
  sul foglio, e `Ctrl+G` e `Ctrl+Maiusc+G` raggruppano e separano. I pulsanti
  del pannello non prendono il fuoco al clic, come quelli della barra: dopo
  «Allinea a sinistra» `Canc` elimina ancora; dalla tastiera una fila di
  pulsanti si percorre con le frecce.

Un documento in sola lettura ha il pannello per leggere: i campi si leggono e
non si scrivono.

## La barra accanto alla selezione

Nello spazio Completo la barra «Disponi» sta accanto a ciò che si è scelto, e
non in cima al foglio, dove l'occhio e il puntatore dovrebbero andarla a
cercare (`apps/client/src/editors/spatial/tools/bar.ts`):

- **sotto la selezione**, al centro, oltre le maniglie: non ne copre mai una;
- **sopra, se sotto non c'è posto**, e in fondo a ciò che si vede se la
  selezione riempie la vista;
- **dentro ciò che si vede**, accanto ai righelli: una selezione che esce
  dalla vista lascia la barra sul bordo più vicino.

Durante un gesto, spostare, ridimensionare o ruotare, la barra non si vede,
e torna quando il gesto finisce. `Alt+F10` le porta il fuoco come sempre.
La casella «Barra accanto alla selezione», nella sezione «Griglia e guide», la riporta
in cima al foglio, e il cambiamento si annuncia; la scelta si ricorda con la
vista, in `grid.bar`.

## Spazi e tasti

Il pannello c'è nei due spazi. Per chi monta l'editor con le sue parti è la
parte «Pannello delle proprietà»; senza, `Invio` apre la finestra «Posizione e
misure» della selezione o, senza selezione, «Proprietà del disegno». Col pannello e gli «Attributi», gli attributi sono una
sezione del pannello e il loro pulsante non c'è: `Ctrl+Maiusc+X` porta il
fuoco alla sezione e, di nuovo, al foglio. «Trasforma…» e `Ctrl+Maiusc+M`
portano il fuoco alla sezione «Trasforma»; la finestra resta per chi
monta l'editor senza il pannello.

`?` elenca i tasti del pannello: `Invio`, le frecce su e giù,
`Ctrl+Invio` nella descrizione ed `Esc`.

I campi hanno il nome sopra, che il lettore di schermo legge col valore e
l'unità; un campo misto si legge «Misto». Ciò che è scelto, l'allineamento
del testo o il lucchetto, ha il fondo attivo e un filo sotto, che lo
distingue anche senza colore; una sezione chiusa si riconosce dalla freccia girata. Col
contrasto forzato il pannello prende i colori di sistema.
