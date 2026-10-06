# Disegni, poligoni e stelle

> **Per chi:** chi disegna forme regolari, come un esagono, un triangolo, una
> stella o un cartello dagli angoli tondi.
> **Risultato:** sapere come si disegnano poligoni e stelle, come si cambiano
> dopo e come se ne arrotondano gli angoli, anche di un rettangolo.

Dal [livello Standard](drawing.md#il-livello-standard) la barra di un
[disegno](drawing.md) ha il **Poligono** (`Y`), dopo la freccia: poligoni
regolari e stelle che restano tali. Un esagono disegnato si fa ottagono,
stella o forma dagli angoli tondi in un passo, senza ridisegnarlo. Nel file è
un tracciato che ogni programma disegna uguale.

## Disegnare

Si trascina dal centro: il puntatore tiene un vertice del poligono, o una
punta della stella, e la forma cresce e gira con lui. Con `Maiusc` resta
diritta: il poligono poggia su un lato, la stella ha una punta in alto. Il
vertice si aggancia come la fine delle altre forme, alla griglia e alle guide.
Il contorno ha il colore e lo spessore della barra, senza riempimento, ed
`Esc` lascia il disegno com'era.

Il Poligono parte da un esagono. `Y` di nuovo, o un tocco sul suo pulsante
quando è già scelto, passa alla stella, a cinque punte, e ritorno; il
pulsante dice quale delle due disegna, «Poligono» o «Stella». Mentre si
trascina:

- **`↑` e `↓`**, o `PgUp` e `PgDn`, aggiungono o tolgono un lato o una
  punta, da 3 a 1000;
- **`←` e `→`** stringono o allargano la stella: il raggio interno va a passi
  di 5%, fra l'1% e il 100% di quello delle punte. Di partenza è il 38,2%,
  la stella a cinque punte i cui lati stanno in linea a due a due.

Ogni passo si annuncia, «Ettagono.», «Stella a 6 punte.», «Raggio interno
40%.», e resta per le forme dopo. Poligono e stella ricordano ciascuno il
suo numero: tornando al poligono si ritrovano i suoi lati.

Da tastiera il Poligono va come le altre forme ([Disegni](drawing.md#da-tastiera)):
`Spazio` preme al centro, le frecce portano il vertice, `Spazio` rilascia.
Le frecce muovono il cursore, e i lati o le punte cambiano con `PgUp` e
`PgDn`; il raggio interno, con la sezione «Forma» del pannello.

## La sezione «Forma»

Nel pannello delle [proprietà](drawing-properties.md), dopo «Posizione e
misure», la sezione «Forma» cambia gli oggetti scelti, ciascuno nel suo
posto e con la sua rotazione:

- **Tipo**, Poligono o Stella. Da poligono a stella restano il centro, il
  raggio, il numero e gli angoli, e la stella prende il raggio interno dello
  strumento;
- **Lati**, o **Punte** per una stella, da 3 a 1000;
- **Raggio interno**, in percentuale, per le stelle;
- **Raggio degli angoli**, nell'unità del documento, anche per i
  rettangoli.

Un campo vale per tutti gli oggetti scelti che lo hanno, e dice «Misto» se
sono diversi. Il raggio degli angoli è quello che si vede: in un oggetto
ingrandito di due volte, 10 è 10 sul foglio. Ogni cambio è un passo di
annulla.

Senza selezione, col Poligono in mano, la sezione cambia lo strumento, «Per i
poligoni e le stelle che disegnerai».

## Gli angoli arrotondati

Con la Selezione, un poligono, una stella o un rettangolo scelto da solo ha
una maniglia in più: un anello dentro il vertice più in alto, sulla punta per
la stella. Trascinato verso il centro arrotonda tutti gli angoli insieme, e
riportato indietro li rende vivi; mentre si tira, il raggio si legge accanto.
Il raggio cresce finché due archi vicini non si toccano a metà lato. `Esc`
lascia la forma com'era, un tocco non cambia niente, e ciò che si è tirato è
un passo di annulla, «Raggio degli angoli».

La maniglia c'è quando la forma, sullo schermo, ha posto per lei, e non nel
mezzo di un altro gesto; dove copre una maniglia della cornice, vince la più
vicina al puntatore. Senza puntatore, il raggio si scrive in «Forma».

Un rettangolo ha gli angoli in `rx`: un rettangolo di un altro programma con
due raggi diversi, `rx` e `ry`, ha gli angoli ellittici, e «Forma» li dice
misti; un raggio nuovo li fa rotondi.

## Nel file

Il poligono e la stella sono un `path`: un altro programma vede un tracciato
e lo disegna uguale. Accanto, `fub:shape` e `fub:geom` portano il centro, il
raggio, i lati o le punte, il raggio interno, la rotazione e il raggio degli
angoli, e ogni cambio riscrive il `d` da lì:

```xml
<path id="o00000023" fub:shape="star" fub:geom="1100 820 70 5 0.382 0 0" d="M1100 750 L1115.72 798.37 L1166.57 798.37 L1125.43 828.26 L1141.14 876.63 L1100 846.74 L1058.86 876.63 L1074.57 828.26 L1033.43 798.37 L1084.28 798.37 Z" fill="none" stroke="#0072b2" stroke-width="4"/>
```

Spostare, scalare e ruotare cambiano soltanto `transform`, come per gli altri
oggetti. All'[Esperto](drawing-expert.md) lo strumento Nodi mostra i vertici:
portarli tutti insieme sposta la forma, che resta un poligono o una stella;
spostarne uno ne fa un tracciato. «Oggetto in tracciato» toglie i parametri e
lascia il `d`.
La grammatica è in [Formato della scena, poligoni e stelle](../reference/scene-format-shapes.md).

## Chi monta l'editor

Lo strumento sta in `apps/client/src/editors/spatial/tools/shapes.ts`, la
sezione «Forma» e la maniglia degli angoli in `reshape.ts`, la geometria e il
`d` in `apps/client/src/editors/spatial/scene/parametric.ts`. Non c'è niente
da montare: il Poligono viene col livello Standard, e nel Personalizzato è
la parte «Poligono» ([Disegni, livello Personalizzato](drawing-custom.md)).
