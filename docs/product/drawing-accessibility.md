# Disegni, accessibilità

> **Per chi:** chi fa un disegno che altri leggeranno, uno schema in una nota
> o un'illustrazione da condividere, e vuole che arrivi anche a chi vede poco,
> a chi non distingue alcuni colori e a chi usa uno screen reader.
> **Risultato:** sapere che cosa controlla la verifica dell'accessibilità,
> come si corregge ogni problema in un passo, come si cambia l'ordine in cui
> uno screen reader incontra gli oggetti, come si descrive un'immagine appena
> aggiunta, e come si usa tutto da tastiera.

Dal [livello Standard](drawing.md#il-livello-standard) **«Accessibilità»**,
nella barra dopo «Cronologia», apre accanto al foglio, sotto gli altri
pannelli aperti, due sezioni che si aprono e si chiudono: **«Problemi»**, ciò
che rende il disegno difficile da leggere, ciascuno con la sua correzione, e
**«Ordine di lettura»**, l'ordine in cui uno screen reader incontra gli
oggetti. Il pannello segue il disegno mentre cambia, un quarto di secondo dopo
l'ultimo gesto, e da sé non cambia niente: il file lo cambiano le correzioni
che si scelgono, ciascuna un passo da annullare.

## I problemi

In cima il disegno, poi gli oggetti nell'ordine in cui si leggono: chi scorre
l'elenco percorre il disegno. Accanto al titolo del pannello si legge quanti
sono; se sono più di cento, «Mostra altri» li porta a cento alla volta. La gravità è
un'icona e una parola, «Avviso» o «Nota», mai il solo colore.

- **«Il disegno non ha un titolo»** (avviso): il titolo è il nome con cui uno
  screen reader presenta il disegno. **«Scrivi il titolo»** porta al campo
  «Che cosa hai disegnato?».
- **«Un testo si legge poco»** e **«Un tratto si vede poco»** (nota): il
  contrasto fra l'oggetto e ciò che ha sotto, la carta e le forme piene, è
  sotto 4,5:1 per un testo e sotto 3:1 per un testo grande, da 24 px o da
  18,67 px in grassetto, e per un tratto a penna; un oggetto che usa un
  [campione](drawing-colors.md) conta col colore del campione. La correzione
  mostra il colore e il contrasto che avrà: tiene la tinta e la saturazione
  e cambia la luminosità quanto basta, verso il più scuro o il più chiaro, dove
  serve meno. Un testo giallo `#f0e442` sulla carta bianca, a 1,32:1, riceve
  **«Usa #81780a (4,54:1)»**: un ocra, non un nero. Per un oggetto quasi
  trasparente nessuna luminosità basta, e non si propone niente. Dentro un
  [simbolo](drawing-symbols.md#accessibilità) il contrasto non si misura,
  perché ogni istanza ha sotto un fondo diverso.
- **«Un’immagine non ha una descrizione»** (avviso): chi non la vede non sa
  che cosa mostra. **«Descrivi…»** apre il campo nella riga: `Invio` scrive la
  descrizione, che diventa il titolo dell'immagine; `Esc` lascia com'era, e
  uscire dal campo la scrive anche lui. **«Decorativa»** dice allo screen
  reader di saltarla: per una cornice, uno sfondo, un ornamento.
- **«Un testo è molto piccolo»** (nota): a grandezza naturale, con la scala
  dei gruppi che lo contengono, una sua riga sta sotto i 12 px.
  **«Porta a 12 px»** gli dà il corpo che ci arriva.
- **«Due colori si distinguono solo per la tinta»** (nota): due colori che
  il disegno usa come codice, ciascuno in almeno due aree piene, come le
  fette di un grafico e la legenda, hanno fra loro un contrasto sotto 3:1;
  in bianco e nero, o per chi non vede le tinte, non si sa quali aree vanno
  insieme. La riga mostra i due colori. **«Dai una campitura»** dà a tutte
  le aree di quel colore la [campitura](drawing-patterns.md) pronta che il
  disegno usa meno, sul loro colore, e lo dice: «Campitura diagonale su 3
  aree.». Le aree bloccate restano.

Il pulsante col nome dell'oggetto, **«Vai a …»**, lo sceglie sul foglio e lo
mostra.
Un oggetto bloccato, nascosto o fuori dal gruppo isolato non si corregge da
qui: «Vai a» dice perché non si sceglie. Così un colore o un corpo scritti su
una riga sola di un testo: la correzione sta nella riga, e il pannello porta
all'oggetto.

Ogni correzione è un passo, col nome di annulla e ripeti: «Riempimento»,
«Colore del contorno», «Dimensione del testo», «Descrivi l’immagine»,
«Immagine decorativa», «Dai una campitura». Corretto un problema la sua
riga se ne va, e il fuoco passa alla riga che prende il suo posto, sullo
stesso genere di pulsante: i problemi si correggono uno dopo l'altro con
`Invio`. Quando non ce n'è più nessuno, il pannello lo dice.

## L'ordine di lettura

Uno screen reader incontra gli oggetti nell'ordine del documento, livello per
livello e gruppo per gruppo, ed è lo stesso ordine in cui si dipingono: il
primo sta sotto. La sezione lo mostra come l'albero degli oggetti, coi
livelli e i gruppi rientrati, e la riga attiva segue l'oggetto scelto da solo
sul foglio.

- Un clic su una riga, o `Invio`, sceglie l'oggetto sul foglio e lo mostra.
- **«Leggi prima»** e **«Leggi dopo»**, sotto l'elenco, o `Alt+↑` e `Alt+↓`,
  spostano l'oggetto fra i suoi vicini, nel suo livello o nel suo gruppo, e
  lo spostamento si dice: «… ora si legge dopo …».
- Spostare un oggetto cambia anche ciò che si vede sopra. Quando i due si
  sovrappongono il pannello lo dice prima di farlo, «… passerebbe sotto …,
  che lo copre in parte: ripeti per spostarlo lo stesso.», e ripetuto lo fa.
- Ogni spostamento è un passo, «Ordine di lettura».

## La descrizione all'inserimento

Quando un'immagine entra nel disegno, incollata, lasciata sul foglio o presa
dal vault, una barra in fondo al foglio chiede che cosa mostra, col fuoco nel
campo: «Descrivi l’immagine appena aggiunta».

- **«Scrivi»**, o `Invio`, scrive la descrizione in un passo suo: annullarla
  lascia l'immagine. Un campo vuoto non scrive niente, e lo si dice.
- **«Decorativa»** la dichiara decorativa; **«Salta»** la lascia senza
  descrizione.
- Con più immagini insieme la barra le chiede una alla volta, «Descrivi
  l’immagine 2 delle 3 appena aggiunte», con l'immagine di turno scelta sul
  foglio; alla fine tornano scelte tutte.
- `Esc` chiude la barra per tutte: quelle rimaste senza descrizione restano
  fra i problemi del pannello.

La barra non è una finestra: il foglio resta in uso mentre c'è. Se ne va da
sola quando le immagini se ne vanno, con annulla o cancellandole, e quando il
disegno passa in sola lettura o se ne apre un altro. All'Essenziale le
immagini entrano senza domande.

## Da tastiera e coi lettori di schermo

Aperto, il pannello prende il fuoco sul primo pulsante dei problemi, o
sull'ordine di lettura se i problemi sono chiusi. I pulsanti dei problemi si
percorrono con `Tab`. Nell'ordine di lettura le frecce, `PagSu`, `PagGiù`,
`Home` e `Fine` muovono la riga attiva senza scegliere l'oggetto; `Invio` o
`Spazio` lo scelgono; `Alt+↑` e `Alt+↓` lo spostano. `Esc` torna al foglio,
da tutte e due le sezioni. `?` elenca questi tasti sotto «Accessibilità».

Per un lettore di schermo le sezioni dicono se sono aperte, ogni problema
dice la sua gravità a parole, e ogni pulsante dice che cosa farà: «Usa il
colore #81780a, con contrasto 4,54 a 1». Le correzioni si dicono quando sono
fatte, coi numeri scritti come nella lingua dell'app. L'ordine di lettura è un
albero, coi suoi livelli; se ne disegnano le righe che si vedono, come nella
[cronologia](drawing-history.md), e mille oggetti scorrono come dieci.

In sola lettura i problemi si vedono e una nota dice che non si correggono da
qui: «Vai a» e l'ordine di lettura si percorrono, ma non si cambia niente.

## Quando se ne va

Tornati all'Essenziale, o tolta la parte nel
[Personalizzato](drawing-custom.md), il pannello si chiude, il pulsante
sparisce e la barra della descrizione non si apre più. Ciò che le correzioni
hanno scritto resta nel file: titoli, colori, descrizioni e immagini
decorative. Come il formato le scrive, e come si misurano i problemi, sta in
[Formato della scena, accessibilità](../reference/scene-format-accessibility.md).
