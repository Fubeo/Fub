# Disegni, tavole

> **Per chi:** chi fa di un disegno più pagine: le schermate di un'app, le
> pagine di una presentazione, la copertina e i fogli di un quaderno.
> **Risultato:** sapere che cos'è una tavola, come la si disegna, la si
> sceglie, la si sposta e la si duplica, come le tavole si mettono in ordine
> e si rinominano, e come una nota ne mostra una sola.

Dal [livello Standard](drawing.md#il-livello-standard) un [disegno](drawing.md)
può avere più **tavole**: pagine sulla stessa tela, ognuna col suo nome e la
sua carta, una accanto all'altra. Gli oggetti restano nei livelli, e una
tavola non li contiene: è un rettangolo sulla tela. Ciò che le sta sopra però
è suo: è ciò che mostra una nota che incorpora soltanto lei, ed è ciò che la
tavola porta con sé quando la si sposta. Un disegno senza tavole è una pagina
sola, come sempre. Come il file le scrive sta in [formato della scena,
tavole](../reference/scene-format-boards.md); i comandi sono in
`apps/client/src/editors/spatial/tools/boards.ts`, l'elenco in
`boards-panel.ts` accanto.

## Dalla pagina alle tavole

- **La prima tavola nasce dalla pagina.** In un disegno senza tavole la
  pagina diventa la tavola 1, con la sua carta, e la tavola nuova viene dopo
  di lei: «La pagina è diventata Tavola 1; Tavola 2 aggiunta, 100 × 70.».
  Eliminare l'ultima tavola fa il contrario: il disegno torna una pagina
  sola, grande quanto lei e allargata quanto serve a coprire tutto il
  disegno. Una pagina con più di una carta, o con una carta senza id, non
  diventa una tavola, e l'editor lo dice.
- **I nomi** di partenza sono «Tavola 1», «Tavola 2» e così via, col primo
  numero libero. L'ordine delle tavole è quello del file, e il numero di una
  tavola è il suo posto: lo cambia l'[elenco](#lelenco-delle-tavole).
- **La tela.** Con le tavole il foglio mostra le loro carte, ognuna col suo
  nome sopra l'angolo in alto a sinistra, e non più la carta della pagina. La
  pagina resta il riquadro del disegno intero, quello che mostra la Lettura:
  copre le tavole, e si allarga da sola quando una tavola, o ciò che porta,
  ne esce. «Adatta la pagina al disegno» la porta attorno al disegno e alle
  tavole.
- **Fuori dalle tavole** si disegna come sempre. Ciò che non sta su nessuna
  tavola resta nel disegno, nel file e nella Lettura, ma non nell'immagine di
  una tavola.
- **La carta di una tavola nuova** ha il colore di quella della tavola
  scelta, o dell'ultima, o della pagina; se quella non ha carta, nemmeno la
  nuova ne ha una.
- **Una tavola non è un oggetto.** La Selezione non la prende, l'albero degli
  oggetti non la elenca, e non si blocca né si nasconde. Può stare dentro
  un'altra tavola, come un riquadro dentro una pagina.
- **Al più 1000 tavole** per disegno. Oltre, disegnarne una, «Nuova tavola» e
  «Duplica» lo dicono e non aggiungono niente.

## Lo strumento Tavola

Lo strumento **Tavola** (`F`, la lettera del Frame di Figma) è l'ultimo degli
strumenti che scelgono, prima della penna: allo Standard viene dopo il Lazo.
Sceglie tavole, non oggetti: prenderlo svuota la selezione e, se nessuna
tavola è scelta, sceglie quella che si guarda, o la prima, e lo dice:
«Strumento: Tavola. Copertina, tavola 1 di 2, 400 × 200.». In un disegno
senza tavole sceglie la pagina: «Pagina, 1600 × 1000. Disegna una tavola per
dividere il disegno in pagine.».

- **Disegnare.** Trascinando fuori dalle tavole se ne disegna una nuova, con
  le misure accanto mentre la si tira. Dentro una tavola se ne disegna
  un'altra tenendo `Maiusc` all'inizio del trascinamento. La tavola nuova va
  in fondo all'ordine, ed è lei la scelta: «Tavola 3 aggiunta, 200 × 120.».
- **Scegliere.** Un tocco sceglie la tavola sotto, la più piccola se ce n'è
  più d'una, o la pagina di un disegno senza tavole; un tocco fuori non
  sceglie niente: «Nessuna tavola scelta.». La tavola scelta ha la cornice
  con le maniglie e il nome più scuro, e la fascia dei
  [righelli](drawing-rulers.md) segna dove sta. La scelta resta quando si
  cambia strumento, e la si ritrova tornando.
- **Spostare.** Trascinando una tavola, che diventa la scelta, la si sposta
  con ciò che le sta sopra: gli oggetti che hanno il centro dentro di lei,
  bordi compresi, anche nascosti o in un livello nascosto, che altrimenti,
  tornati a vedersi, si ritroverebbero altrove. Restano dove sono gli oggetti
  bloccati, o in un livello bloccato, e le altre tavole, anche quelle che le
  stanno dentro: «Evaporazione spostata a x 530, y 50, con 1 oggetto.».
- **Le maniglie** della tavola scelta, o della pagina, ne cambiano la misura:
  un angolo con `Maiusc` tiene le proporzioni, e `Alt` tiene fermo il centro.
  Cambiare la misura di una tavola non tocca il disegno, e un tocco su una
  maniglia non cambia niente.
- **Agganciare.** Disegnando, spostando o tirando una maniglia, la tavola si
  ferma sulla griglia, con l'aggancio, e sulle guide dei righelli. Con le
  [guide intelligenti](drawing-guides.md) si ferma anche in linea con le
  altre tavole e con gli oggetti che si vedono, tranne quelli che porta, e,
  spostandola, a distanze uguali; la pagina vale soltanto in un disegno senza
  tavole. L'annuncio dice dove: «Agganciato: il bordo sinistro in linea con
  quello di Evaporazione.». `Ctrl` o `⌘` tenuto la lascia libera.

Il nome di ogni tavola sta sopra la sua carta, a ogni livello e con ogni
strumento, e gira col foglio; una tavola troppo stretta sullo schermo non lo
mostra. È un'etichetta del foglio: nell'immagine del disegno non c'è.

## Duplicare

`Ctrl+D` o `⌘D` con lo strumento Tavola, e «Duplica» nell'elenco, copiano la
tavola con ciò che le sta sopra. Gli oggetti si copiano come con «Duplica»
della barra «Disponi», con le loro [risorse](drawing-resources.md) proprie, e
la carta si copia com'è. La copia va alla destra della tavola, a 80 unità, e
più in là finché non tocca le altre, alla stessa altezza; diventa la tavola
scelta e si porta in vista: «Evaporazione copia copia aggiunta a x 1440, y 0,
con 1 oggetto.».

- **Con `Alt`** tenuto mentre si sposta una tavola, la tavola resta dov'è e
  la copia va dove la si posa; il puntatore lo mostra, e `Alt` si può
  prendere e lasciare a metà del gesto. Posata dov'era, non si copia niente.
- **I nomi:** la copia di «Copertina» si chiama «Copertina copia», la
  seguente «Copertina copia 2», poi «Copertina copia 3»; la copia di
  «Copertina copia» è «Copertina copia copia». Nell'ordine la copia viene
  subito dopo la tavola da cui nasce.
- **In un disegno senza tavole** si duplica la pagina, che prima diventa la
  tavola 1: «La pagina è diventata Tavola 1. Tavola 1 copia aggiunta a x
  180, y 0, con 1 oggetto.».
- **Niente copie a metà.** Un oggetto con parti di un altro programma, che
  FubDraw non sa copiare, ferma tutto, e l'editor lo dice: «Non duplicata: un
  oggetto sulla tavola ha parti di un altro programma, che FubDraw non sa
  copiare.».

## L'elenco delle tavole

**«Tavole»**, nella barra dopo «Pagina e griglia», apre accanto al foglio, in
cima agli altri pannelli aperti, l'elenco delle tavole, e gli porta il fuoco;
di nuovo, lo chiude. In cima ci sono quante sono, «5 tavole», e il pulsante
**«Nuova tavola»**.

- **Le righe** sono le tavole nell'ordine del disegno, ognuna col numero, il
  nome e la misura nell'unità del documento. La tavola corrente, quella
  scelta o, se nessuna lo è, quella che si guarda, ha il triangolo e il
  grassetto, e la riga lo dice a parole: «Tavola 2 di 5: Evaporazione, 1600 ×
  1000 px, corrente».
- **Un clic**, `Invio` o `Spazio` portano alla tavola: la scelgono e la
  inquadrano. Le frecce, `PagSu`, `PagGiù`, `Home` e `Fine` passano da una
  riga all'altra senza andarci.
- **Il nome.** `F2`, o un doppio clic sul nome, apre il campo: `Invio` lo
  scrive, «Ora la tavola si chiama «Copertina».», `Esc` lo lascia com'era, e
  uscire dal campo lo scrive anche lui. Il nome si scrive pulito, con gli
  spazi raccolti e al più 200 caratteri; vuoto non cambia niente. Una tavola
  con parti di un altro programma, che FubDraw non sa riscrivere, non si
  rinomina, e l'editor lo dice.
- **Gli altri tasti.** `Ctrl+D` o `⌘D` duplica la tavola; `Alt+↑` e `Alt+↓`
  la spostano prima o dopo la sua vicina, e cambiano il suo numero:
  «Condensazione ora è la tavola 2 di 3.»; `Canc` la elimina. `Esc` torna al
  foglio.
- **Il menu della tavola** si apre col clic destro, con una pressione lunga,
  con `Maiusc+F10` o col tasto del menu: «Vai», «Rinomina…», «Duplica»,
  «Sposta su», «Sposta giù» ed «Elimina». Una voce spenta dice perché: «È già
  la prima tavola.».
- **«Nuova tavola»** aggiunge una tavola con la misura e la carta di quella
  corrente, o dell'ultima, alla destra di tutte, la porta in vista e ne apre
  il nome.

Senza tavole l'elenco dice che cosa farebbe «Nuova tavola»: «Il disegno è una
pagina sola. Con «Nuova tavola» la pagina diventa la tavola 1, e accanto ne
nasce un’altra.». In un disegno senza pagina, un foglio senza bordi, la
tavola nuova racchiude tutto ciò che c'è.

## Le proprietà

Con lo strumento Tavola e una tavola scelta il [pannello delle
proprietà](drawing-properties.md) parla di lei, «Tavola 2 di 5», e la sezione
**«Tavola»** viene prima di «Documento» e «Vista»: Nome, Formato,
Orientamento, X, Y, Larghezza e Altezza, nell'unità del documento.

- **X e Y** spostano la tavola con ciò che le sta sopra, come trascinarla. Le
  misure, il formato e l'orientamento tengono fermo l'angolo in alto a
  sinistra e non toccano il disegno.
- **Formato** offre le misure pronte, ognuna coi numeri che darebbe, nel verso
  della tavola e nell'unità della misura: per una tavola orizzontale «A4 (297
  × 210 mm)», per una verticale «A4 (210 × 297 mm)». Una tavola che non ha
  nessuna di queste misure è «Su misura».
- **Orientamento**, «Verticale» o «Orizzontale», scambia larghezza e altezza.
  Una tavola quadrata non ha verso e il campo è spento; un formato le dà il
  suo.

| Formato | Misura |
|---|---|
| A3 | 297 × 420 mm |
| A4 | 210 × 297 mm |
| A5 | 148 × 210 mm |
| Lettera | 8,5 × 11 in |
| Legale | 8,5 × 14 in |
| Tabloid | 11 × 17 in |
| HD 16:9 | 1280 × 720 px |
| Full HD 16:9 | 1920 × 1080 px |
| Schermo 4:3 | 1024 × 768 px |
| Telefono | 390 × 844 px |
| Quadrato | 1080 × 1080 px |
| Disegno nuovo | 1600 × 1000 px |

In un disegno senza tavole la sezione «Documento» ha «Formato della pagina» e
«Orientamento della pagina», con le stesse misure pronte; con le tavole, della
pagina restano Larghezza e Altezza.

## Le tavole nelle note

Ogni tavola è una sezione del disegno, come un titolo in una nota:

- **`[[disegno#Copertina]]`** apre il disegno sulla tavola «Copertina»: la
  sceglie e la inquadra, e la selezione resta com'era. Lo stesso fanno le
  voci delle tavole nella vista Struttura, dopo il titolo del disegno, e la
  ricerca trova il disegno anche per i nomi delle sue tavole.
- **`![[disegno#Copertina]]`** incorpora soltanto quella tavola, ritagliata
  sul suo rettangolo, coi caratteri e le immagini del vault come il disegno
  intero; di un oggetto a cavallo del bordo si vede la parte dentro. La
  didascalia dice il titolo del disegno e la tavola: «Quaderno di viaggio ·
  Copertina».
- **Il titolo** del disegno resta il disegno intero: dopo il `#` mostra
  tutto, come senza.
- **I nomi si confrontano come sono scritti**: «copertina» non è
  «Copertina». Un nome che non è né il titolo né una tavola non è una
  sezione del disegno, e l'embed non si risolve; rinominare una tavola non
  riscrive i riferimenti al nome di prima. Una tavola senza nome si chiama
  col suo id.
- **Lo stesso nome due volte.** Due tavole con lo stesso nome, o una col nome
  del disegno, si possono avere: il nome porta alla prima, il titolo prima
  delle tavole, e la diagnostica lo segnala (S016).

Il banco di fedeltà (`apps/client/bench/fidelity.mjs`) confronta il foglio,
la Lettura e il PNG anche su tre tavole, con la carta bianca, colorata e
senza, e guarda una tavola sola come il suo embed, ritagliata sulla tavola.

## Da tastiera e coi lettori di schermo

`Alt+PagGiù` e `Alt+PagSu`, sul foglio e con ogni strumento, portano alla
tavola dopo o a quella prima della tavola scelta, o di quella al centro della
vista, e la inquadrano: «Copertina, tavola 1 di 2, 400 × 200.». Oltre le
estremità lo dicono, «Evaporazione è l’ultima tavola.», e in un disegno senza
tavole «Il disegno non ha tavole.». Senza `Alt`, `PagSu` e `PagGiù` restano
l'ordine degli oggetti.

Con lo strumento Tavola:

- `Tab` e `Maiusc+Tab` passano alla tavola dopo e a quella prima, e la
  portano in vista; senza una tavola scelta, alla prima o all'ultima. Oltre
  le estremità il fuoco esce dal foglio. `Home` e `Fine` scelgono la prima e
  l'ultima tavola, e la portano in vista.
- Le frecce spostano la tavola scelta di 1, di 10 con `Maiusc`, con ciò che
  le sta sopra; con l'aggancio vanno alla riga seguente della griglia, a
  cinque righe con `Maiusc`. Con `Ctrl` o `⌘` allargano o stringono allo
  stesso modo il lato destro o quello in basso della tavola, o della pagina.
  Senza una tavola scelta, o con la pagina, che non si sposta, le frecce
  muovono il cursore. `Spazio` preme e rilascia come con ogni strumento, e in
  mezzo il cursore disegna, sposta o tira come il puntatore ([Disegni, da
  tastiera](drawing.md#da-tastiera)).
- `Ctrl+D` o `⌘D` duplica la tavola scelta, o la pagina. `Canc` elimina la
  tavola scelta, il disegno resta, e la tavola che prende il suo posto
  diventa la scelta: «Copertina eliminata; il disegno resta com’era.
  Evaporazione, tavola 1 di 1, 400 × 210.». Sulla pagina risponde «La pagina
  non si elimina: è il foglio del disegno.».
- `F2` rinomina la tavola scelta, nel campo dell'elenco se è aperto,
  altrimenti nella finestra «Rinomina la tavola». `Esc` lascia la tavola
  scelta: «Nessuna tavola scelta.».

`?` elenca questi tasti sotto «Tavole», con `Maiusc` e `Alt` tenuti durante
il gesto, e quelli dell'elenco sotto «Elenco delle tavole».

Ogni gesto si dice a parole: la tavola scelta col suo numero e la sua misura,
dove è andata e con quanti oggetti, a che cosa si è agganciata, il nome nuovo
e il posto nuovo nell'ordine. La cornice e il nome più scuro sono per gli
occhi, e nell'elenco la tavola corrente ha anche la parola «corrente»:
nessuno stato si legge dal solo colore. L'elenco disegna soltanto le righe
che si vedono: mille tavole scorrono come dieci. Il banco delle tavole
(`apps/client/bench/boards.mjs`) percorre 20 tavole nell'app vera, coi tasti,
e vuole a ogni passo l'annuncio giusto e il passo dipinto entro 50 ms.

Ogni comando è un passo di annulla, col suo nome nella
[cronologia](drawing-history.md): «Nuova tavola», «Spostamento di una
tavola», «Misure di una tavola», «Tavola eliminata», «Nome di una tavola»,
«Ordine delle tavole» e «Copia di una tavola». Con lo strumento Tavola,
annullare e ripetere scelgono la tavola che il passo ha toccato, se c'è.

In un documento in sola lettura le tavole si guardano e ci si va, con
`Alt+PagSu`, `Alt+PagGiù` e con l'elenco, ma non cambiano; nell'elenco gli
altri tasti dicono perché non fanno niente.

## Livelli e parti

All'Essenziale le tavole restano nel disegno e si vedono, coi loro nomi, e un
collegamento a una tavola la inquadra anche lì; non ci sono lo strumento,
l'elenco, `Alt+PagSu` e `Alt+PagGiù`. Sono la parte «Tavola» del
[Personalizzato](drawing-custom.md). Tornati all'Essenziale, o tolta la
parte, chi aveva in mano la Tavola riprende la Selezione, l'elenco si chiude
e il suo pulsante sparisce; il disegno non cambia.

## Il file

```xml
<rect id="fub-paper" fub:role="paper" fub:board="b1a2b3c4d" x="0" y="0" width="1122.52" height="793.7" fill="#ffffff"/>
<view id="b1a2b3c4d" fub:role="board" viewBox="0 0 1122.52 793.7">
  <title>Copertina</title>
</view>
```

Una tavola è un `view` di SVG, figlio della radice, col suo rettangolo nel
`viewBox` e il nome nel primo `title`; la sua carta è un `rect` con la stessa
geometria, che un altro programma disegna come un foglio sulla tela; qui è
la carta della pagina, presa dalla tavola 1. Il file resta un SVG: un browser
che apre `disegno.svg#b1a2b3c4d`, con l'id di una tavola, mostra soltanto il
suo rettangolo. L'ordine, i limiti, le operazioni e la diagnostica stanno in
[formato della scena, tavole](../reference/scene-format-boards.md).
