# Disegni, forme dal tratto

> **Per chi:** chi disegna a mano libera e vuole forme pulite senza cambiare
> strumento: uno schema alla lavagna, una freccia fra due idee, un riquadro
> attorno a una parola.
> **Risultato:** sapere quando un tratto a penna diventa una linea, una
> freccia o una forma, come la si regola prima di alzare la penna, e come si
> fa lo stesso coi tratti già scritti.

Dal [livello Standard](drawing.md#il-livello-standard) un tratto della
**penna** tenuto fermo alla fine diventa la forma a cui somiglia, con il suo
colore e il suo spessore. Si disegna di getto, e il disegno resta in ordine.

## Tenere fermo

Si disegna con la penna come sempre e, alla fine, senza alzarla, si tiene
fermo il puntatore per mezzo secondo. Il tratto diventa:

- una **linea**, se è dritto;
- una **freccia**, se è un'asta dritta che finisce in una punta, disegnata
  senza staccare;
- un **rettangolo**, se è chiuso e ha quattro angoli quasi retti, anche
  girato;
- un'**ellisse**, se è chiuso e tondo; un **cerchio**, se i due assi
  differiscono meno di un decimo;
- un **triangolo** o un **poligono** fino a otto lati, con i vertici dove li
  ha disegnati la mano;
- una **stella**, se si incrocia girando a passi uguali attorno al centro,
  come la stella a cinque punte disegnata senza staccare.

Un rettangolo o un'ellisse storti di 8° al più si raddrizzano.

La forma prende subito il posto del tratto e si annuncia: «Rettangolo.»,
«Cerchio.», «Stella a 5 punte.». Un tratto che non somiglia a niente resta
inchiostro, e si continua a disegnare. Fermarsi a metà conta come alla fine:
la parte già disegnata diventa la sua forma, se ne ha una.

Finché la penna resta giù, la forma si regola:

- muovere il puntatore porta la fine di una linea o di una freccia, e fa
  crescere e girare una forma chiusa attorno al suo centro;
- **`Maiusc`** la tiene regolare: il rettangolo diventa un quadrato,
  l'ellisse un cerchio, il poligono e la stella regolari, e la rotazione va a
  passi di 15°, come quella di una linea o di una freccia.

Alzata la penna, la forma entra nel disegno: «Rettangolo dal tratto.». Sono
due passi di annulla, così il primo annulla riporta l'inchiostro com'era
stato disegnato, e il secondo lo toglie. `Esc`, prima di alzare la penna,
lascia il disegno com'era.

## La scrittura resta scrittura

La scrittura a mano non si riconosce. Una forma nasce da un tratto largo o
alto almeno 40 pixel sullo schermo, e il tremito della mano ferma non conta:
una lettera, una sigla o un numero restano inchiostro anche tenuti fermi. La
misura è quella dello schermo mentre si disegna: con lo zoom avanti, anche un
tratto piccolo nel disegno diventa una forma.

Il riconoscimento non tira a indovinare: lo stesso tratto dà sempre la stessa
forma, e ogni misura è relativa alla misura del tratto, così un cerchio
piccolo e uno grande si riconoscono allo stesso modo. Il tratto si riconosce
com'è sullo schermo: un cerchio disegnato in un gruppo girato o ingrandito è
un cerchio anche lì.

La tenuta vale per la penna, col puntatore: l'evidenziatore e i tratti
disegnati da tastiera restano inchiostro.

## «Rendi forma»

Con la Selezione, quando fra gli oggetti scelti c'è un tratto a penna, la
barra «Disponi» ha **«Rendi forma»**: ogni tratto a penna scelto, anche dentro
un gruppo o un collegamento, diventa la sua forma, in un solo passo di
annulla. Le parti bloccate restano come sono; i tratti che non somigliano a
una forma restano inchiostro, e l'annuncio li conta: «1 tratto è diventato una
forma. 1 tratto resta inchiostro: non somiglia a una forma.». Qui non c'è la
misura minima: chi sceglie un tratto e chiede la forma, la vuole.

## L'interruttore

In «Pagina e griglia», la casella **Forme dal tratto** accende e spegne la
tenuta. È accesa di partenza, e la scelta si ricorda con la griglia per i
disegni che si aprono dopo. Spenta, i tratti tenuti fermi restano inchiostro;
«Rendi forma» resta.

## Nel file

La forma è scritta come la scrivono gli strumenti: un `rect`, un'`ellipse`,
una `line`, la freccia come quella della barra, il triangolo e il poligono
come `polygon`, quelli regolari e la stella come il
[Poligono](drawing-shapes.md), che li cambia anche dopo. Il colore del tratto
diventa il contorno, lo spessore del pennello il suo spessore, e la forma non
si riempie:

```xml
<rect id="o00000041" x="100" y="100" width="200" height="120" fill="none" stroke="#0072b2" stroke-width="4"/>
```

Il tratto lascia il posto alla forma: lo stesso id, lo stesso posto fra gli
altri oggetti, la stessa trasformazione, e il titolo, la descrizione e gli
attributi che non riguardano l'inchiostro. Un rettangolo girato ha la
rotazione in `transform`.

## Chi monta l'editor

Il riconoscimento sta in `apps/client/src/editors/spatial/tools/recognize.ts`,
la forma che prende il posto del tratto in `inkshape.ts`, la tenuta ferma in
`editor.ts`. L'interruttore è `shapes` nella griglia che l'editor riceve e
restituisce con `onGridChange`. Il corpus dei tratti registrati, ciascuno
con la forma attesa nel suo titolo, è in `apps/client/src/__fixtures__/ink-shapes/`.

Non c'è niente da montare: le forme dal tratto vengono col livello Standard, e
nel Personalizzato sono la parte «Forme dal tratto» ([Disegni, livello
Personalizzato](drawing-custom.md)).
