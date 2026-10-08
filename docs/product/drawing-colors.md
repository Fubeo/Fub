# Disegni, colori

> **Per chi:** chi vuole colori coerenti in tutto un disegno, li cambia in un
> colpo solo e li riprende da ciò che ha già disegnato.
> **Risultato:** sapere che cos'è un campione, come si usa la sezione
> «Colori del documento», che cosa dice il contrasto, quali colori sono
> recenti e che cosa prende il contagocce.

Dal livello Standard un disegno ha i suoi colori: i **campioni**, colori con
un nome che gli oggetti usano per riferimento, così che cambiarne uno cambia
tutti quelli che lo usano; i colori che il disegno usa, contati; e quelli
scelti di recente. Stanno nella sezione «Colori del documento» del [pannello
delle proprietà](drawing-properties.md). Il **Contagocce** (`I`) dà agli
oggetti scelti l'aspetto di un altro, o ne prende il colore. I campioni sono
in `apps/client/src/editors/spatial/tools/swatches.ts`, la sezione in
`swatches-panel.ts` e il contagocce in `eyedropper.ts`.

## I campioni

Un campione è un colore del documento con un nome, «Blu mare» o «Rosso del
logo». Chi lo usa non scrive il colore ma il campione: quando il campione
cambia colore, cambiano tutti insieme, in un passo di annulla. Il file resta
un SVG che ogni programma apre, perché il campione è una sfumatura di un
colore solo, e chi lo usa scrive anche il colore, come ripiego.

```xml
<linearGradient id="r7k2m9q4x" fub:role="swatch" fub:name="Blu mare" gradientUnits="userSpaceOnUse"><stop stop-color="#0072b2"/></linearGradient>
…
<rect id="o3c5e7g9j" x="40" y="40" width="200" height="120" fill="url(#r7k2m9q4x) #0072b2"/>
```

- **Fare un campione.** «+», «Nuovo campione…», parte dal colore degli
  oggetti scelti dove va «Applica a», o da quello con cui si disegna, col
  nome del colore della tavolozza o «Campione», e non cambia nessun oggetto.
  «Rendi campione…», nel menu di un colore usato o recente, fa il campione e
  ci porta chi ha quel colore scritto: «Colore reso campione».
- **Passare a un campione.** Nel menu di un colore usato che è anche il
  colore di un campione, «Usa il campione «Blu mare»» porta a lui chi lo
  scrive: «Oggetti passati a un campione».
- **Cambiarlo.** «Cambia colore…» cambia chi lo usa e il ripiego che scrive,
  «Colore di un campione»; «Rinomina…», o `F2`, gli dà un altro nome, «Nome
  di un campione».
- **Eliminarlo.** «Elimina campione», o `Canc`, riporta chi lo usa al suo
  colore, scritto, così che niente cambi a vederlo: «Campione eliminato».
- **Chi non si cambia resta com'è.** Un oggetto bloccato, o in un gruppo o in
  un livello bloccato, un blocco estraneo e un foglio di stile non passano a
  un campione, e l'annuncio dice quanti hanno tenuto il colore scritto; se
  usano un campione, ne seguono il colore ma tengono il ripiego che avevano.
  Un campione eliminato che uno di loro usa ancora resta fra le risorse,
  senza nome, finché lo usa.
- **I nomi** si scrivono puliti, come quelli degli oggetti: gli spazi
  raccolti, al più 200 caratteri. Due campioni non hanno lo stesso nome, con
  le maiuscole a parte, e un nome non è un colore: «nessuno», `none` o un
  codice come `#0072b2` direbbero il falso dopo un cambio di colore. Un nome
  come `red` invece va.
- **I testi** usano un campione intero. Le righe e le parole non ne usano,
  perché il formato non dà loro riferimenti: quelle che scrivono un colore
  loro lo tengono.

Un colore lo usa chi lo mostra: il riempimento delle forme e dei testi, il
contorno, il colore di un tratto a penna, anche ereditati da un gruppo o da
un livello, e il nero di SVG dove nessuno scrive un riempimento. Contano anche
le forme dei motivi e dei marcatori, che dipingono chi li usa; non i punti
delle sfumature, né il contenuto dei ritagli e delle maschere.

## La sezione «Colori del documento»

La sezione viene dopo «Aspetto», con oggetti scelti, e per prima senza. Se
gli oggetti scelti hanno un riempimento e un contorno, in cima **«Applica
a»** dice a quale dei due va un colore; altrimenti va a quello che hanno.
Sotto, tre griglie:

- **Campioni**, nell'ordine del documento, e «+» per farne uno;
- **Colori usati**, quelli che il disegno scrive, dal più usato: al più 48, e
  sotto quanti restano fuori, «E altri 12 colori, usati meno.»;
- **Recenti**, dal più recente: al più 8.

Ogni colore ha un nome che si sente e che il suggerimento scrive, con quanti
oggetti lo mostrano: un campione il suo, «Blu mare, campione #0072b2, usato
da 3 oggetti», un colore della tavolozza il suo, gli altri il codice. La
forma è quella della tavolozza, o l'anello di un colore a piacere, così che
nessun colore si riconosce soltanto dal colore; quello degli oggetti scelti è
segnato.

- **Un clic, `Invio` o `Spazio`** danno il colore agli oggetti scelti, dove
  dice «Applica a», in un passo; con `Maiusc` all'altro. Senza selezione è il
  colore con cui si disegna.
- **Il menu di un colore**, col clic destro, `Maiusc+F10` o il tasto del
  menu: «Applica al riempimento» e «Applica al contorno», o «Disegna con
  questo colore»; per un campione «Rinomina…», «Cambia colore…», «Scegli gli
  oggetti con questo campione» ed «Elimina campione»; per un altro colore
  «Rendi campione…» e, se è usato, «Usa il campione…» e «Scegli gli oggetti
  con questo colore». Scegliere gli oggetti li sceglie a ogni profondità,
  anche dentro i gruppi.
- **Si scrive al suo posto.** «Nuovo campione…», «Rendi campione…»,
  «Rinomina…» e «Cambia colore…» aprono un modulo sotto i campioni, col nome,
  il colore come codice o nome e il selettore del sistema: `Invio` conferma,
  `Esc` chiude e torna al colore da cui si era partiti. Un nome vuoto o già
  preso, e un colore che non si legge, si dicono accanto al campo, e il
  modulo resta.
- **Da tastiera** ogni griglia è un punto di tabulazione: le frecce vanno al
  vicino e alla riga sopra e sotto, `Inizio` e `Fine` ai capi. Un colore
  preso col puntatore non prende il fuoco; quando quello col fuoco se ne va,
  il fuoco passa al vicino.

In un documento in sola lettura i colori si guardano e scelgono gli oggetti
che li mostrano, ma non cambiano.

## Il campo del colore e il contrasto

Nel pannello delle proprietà il campo di un colore legge anche il nome di un
campione, con le maiuscole a parte, e lo mostra col suo nome; il nome di un
campione vale prima di quello di un colore, perché è del disegno. Il menu
accanto al campo offre nessuno, i campioni, la tavolozza e i recenti.

Sotto il Riempimento e il Contorno una riga dice il **contrasto con la
carta**, con l'opacità degli oggetti se è una sola. Per il riempimento di un
testo dà il livello di WCAG del testo normale e di quello grande, per il blu
`#0072b2` sul bianco «Contrasto con la carta 5,18:1. Testo normale: AA;
testo grande: AAA.»; per il resto dice se basta il 3:1 di una forma. La
carta è la prima del disegno, o il bianco; la riga non c'è per nessun
colore, un valore misto, una sfumatura o un motivo, e con una carta di
colore ignoto.

## Disegnare con un campione

Un campione scelto senza selezione, dalla sezione o col contagocce, è il
colore con cui si disegna: gli oggetti nuovi lo usano, e lo strumento lo
ricorda. Se il campione cambia colore, anche per un annulla, lo strumento lo
segue. Lo lascia, e tiene il colore scritto, quando si sceglie un altro
colore, il campione se ne va, si passa a un altro disegno o, nel
Personalizzato, se ne va la parte «Colori del documento».

## I colori recenti

Un colore scritto e scelto entra fra i recenti: dalla sezione, dal campo del
riempimento o del contorno, come colore con cui si disegna, e col
contagocce; anche il colore con cui si disegnava prima resta fra loro. Un
campione no, perché ha la sua griglia. I recenti valgono per tutti i disegni
e li ricorda la macchina, nello stato di vista `draw.colors`; i primi tre
sono anche nel menu radiale ([Disegni, vista ruotata, gesti e menu
radiale](drawing-view.md)).

## Il contagocce

Il **Contagocce** (`I`) viene dopo la Tavola. Il puntatore è un mirino, e
accanto al punto si vede che cosa prenderebbe; il contorno tenue della forma
da cui prende la segna sul foglio. Prende quando si rilascia, così il dito o
la penna possono cercare il punto; `Esc` prima di rilasciare non prende
niente. Col dito l'anteprima sta sopra il dito, che non la copre.

- **Con oggetti scelti**, un clic dà loro l'**aspetto** della forma sotto il
  puntatore, come «Incolla lo stile»: il riempimento, il contorno col suo
  spessore, il tratteggio, gli estremi e gli angoli, l'opacità dell'oggetto,
  i suoi effetti e il modo di fusione, e il carattere ([Disegni, appunti](drawing-clipboard.md#lo-stile)). È un
  passo solo, «Aspetto preso col contagocce»; una sfumatura propria arriva
  come copia, una per oggetto. L'anteprima mostra un disco col riempimento e
  un anello col contorno, col nome della forma.
- **Con `Maiusc`** prende soltanto il **colore** che si vede nel punto: il
  contorno dove sta sopra il riempimento; di una sfumatura il colore in quel
  punto; un campione resta il campione; un motivo, il motivo. Va agli oggetti
  scelti, dove dice «Applica a».
- **Senza selezione** il colore preso è quello con cui si disegna; un motivo
  no, perché non è un colore con cui disegnare.
- **Un'immagine** dà sempre il colore del pixel. Dove è trasparente, o fuori
  da ciò che il suo riquadro mostra, il contagocce guarda sotto. Un'immagine
  dal web non si legge: va messa nel vault.
- **Dove guarda.** L'oggetto più in alto che si vede nel punto, anche in un
  livello bloccato, che si legge senza cambiare; dentro un gruppo la forma
  sotto il puntatore. Un punto dentro una forma vince su uno vicino al bordo
  di un'altra più in alto. Un blocco estraneo copre ciò che ha sotto, e il
  contagocce dice che non ne prende il colore.

Da tastiera le frecce muovono il cursore, anche con oggetti scelti, e
dicono che cosa c'è sotto; `Spazio` prende l'aspetto, o il colore senza
selezione, e `Maiusc+Spazio` il solo colore. Nell'albero degli oggetti, col
Contagocce fra le parti, `I` sulla riga attiva dà agli oggetti scelti
l'aspetto del suo oggetto, anche bloccato o nascosto, e `Maiusc+I` il suo
colore, il riempimento o il contorno se non riempie; senza selezione `I` ne
prende il colore per disegnare. `Ctrl` o `⌘` con le frecce muovono la riga
attiva senza cambiare la selezione. Un livello non ha un aspetto da prendere,
e una sfumatura o un'immagine non hanno un colore solo: il contagocce lo dice,
e dice dove prenderlo.

## Fra disegni

Lo stile copiato vale per tutti i disegni aperti, e un campione che il
disegno non ha lascia il posto a quello con lo stesso nome, con le maiuscole
a parte, e lo stesso colore, o al suo colore; un'altra risorsa che manca, al
colore di ripiego. Incollando oggetti, un campione resta quello del disegno
con lo stesso id, o diventa quello con lo stesso nome e lo stesso colore, e
chi lo usa ne prende il colore come ripiego; altrimenti arriva, e con un nome
già preso, o che si legge come un colore, prende il primo libero, «Vermiglio
2» ([Disegni, risorse](drawing-resources.md#copiare-e-incollare)).

## Livelli e parti

All'Essenziale i campioni restano nel disegno, e gli oggetti che li usano si
vedono col loro colore. I colori del documento e il contagocce sono le parti
«Colori del documento» e «Contagocce» del
[Personalizzato](drawing-custom.md); i colori del documento stanno nel
pannello delle proprietà, e si vedono con lui. Senza il Contagocce chi lo
aveva in mano riprende la Selezione; senza i colori del documento lo
strumento lascia il campione e tiene il suo colore. `?` elenca i tasti del
Contagocce nella sua tabella, dopo quella delle Tavole.

## Chi monta l'editor

I recenti arrivano con `colors`, dal più recente, e ogni scelta li manda a
`onColorsChange`; `setRecentColors` li cambia senza tornare a
`onColorsChange` (`apps/client/src/editors/spatial/tools/editor.ts`). Il
formato del campione, i riferimenti e la raccolta stanno in [formato della
scena, risorse](../reference/scene-format-resources.md).
