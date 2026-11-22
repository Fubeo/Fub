# Disegni, poligoni e stelle

> **Per chi:** chi apre un disegno con poligoni, stelle o forme dagli angoli
> tondi.
> **Risultato:** sapere che cosa ne fa l'editor e come stanno nel file.

L'editor di un [disegno](drawing.md) non disegna più poligoni e stelle e non
ne cambia più i lati, le punte o gli angoli: lo strumento Poligono, la sezione
«Forma» delle proprietà e la maniglia degli angoli arrotondati se ne sono
andati col livello Standard (decisione 0231). I poligoni, le stelle e i
rettangoli dagli angoli tondi che un file ha già restano dove sono e si
vedono uguali.

## Che cosa si fa con loro

Un poligono o una stella è un oggetto come gli altri: si sceglie, si sposta,
si scala, si ruota, si colora, si raggruppa e si cancella, e il pannello delle
[proprietà](drawing-properties.md) ne cambia l'aspetto, il riempimento e il
contorno. Non cambia la sua forma: il numero dei lati, il raggio interno e il
raggio degli angoli restano quelli scritti nel file. Un disegno aperto e
salvato senza modifiche resta uguale byte per byte.

## Nel file

Poligono e stella sono un `path` con `fub:shape` e `fub:geom`; un rettangolo ha
gli angoli tondi in `rx` e `ry`. La grammatica è in [Formato della scena,
poligoni e stelle](../reference/scene-format-shapes.md).

## Chi legge la forma

La geometria e il `d` stanno in
`apps/client/src/editors/spatial/scene/parametric.ts`, che la scena usa per
leggere il file. Non c'è niente da montare.

## Nel disegno completo

Con il componente «Disegno completo» acceso, la colonna ha nel gruppo delle
forme gli strumenti del motore (la famiglia `forme` del piano K6, T13): Rettangolo
arrotondato, Poligono, Stella, Segmento linea, Arco e Spirale. Rettangolo
ed Ellisse esistono anche nel Semplice, e nella stessa tendina portano
«(Completo)», come Selezione, Mano e Zoom.

Le griglie rettangolare e polare (T13 giro 7) stanno nello stesso gruppo: un
trascinamento crea un gruppo di tracciati e di linee, con i divisori come linee
normali; la finestra chiede i divisori orizzontali e verticali (o circolari e
radiali), le inclinazioni in per cento e la cornice esterna. Le forme dal vivo,
cioè con angoli e lati che si cambiano dopo, aspettano ancora la ricetta del
disegno (T27).

Il Generatore forme (`shapeBuilder`, T13 giro 7) unisce le forme scelte: il
trascinamento sulle regioni che toccano le unisce in un solo tracciato, e con
Alt toglie le regioni toccate. Servono due o più oggetti, tracciati, forme
composte o gruppi di tracciati: un'immagine o un testo non entrano, e un oggetto
bloccato spegne il gesto. Le regioni che il motore calcola si mostrano come aree
evidenziate mentre si trascina.

La sezione «Allinea», nella scheda Design dell'ispettore, offre gli allineamenti
e le distribuzioni del motore. Alla selezione servono due oggetti; con «alla
tavola» ne basta uno per allineare. Un pulsante spento dice perché. La famiglia
`trasforma` si carica al primo clic di un pulsante, non prima.
