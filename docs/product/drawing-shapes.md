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

La Forma parametrica (`parametricShape`, un'aggiunta di VectorCraft) sta nello
stesso gruppo ed è una forma viva: un trascinamento dal centro la disegna,
grande e girata quanto il trascinamento, e ↑↓ e ←→ ne cambiano i numeri (i lati,
le punte, i raggi) mentre si trascina. I numeri restano nella ricetta del disegno, accanto al
tracciato: riaperto il file, un clic sul suo contorno con lo strumento la
riprende con le sue maniglie, che la ridimensionano, la girano e ne cambiano i
numeri. Un doppio clic sul vuoto ne mette una con gli ultimi numeri usati. Un
altro programma la legge come un tracciato qualunque.

Il Sagomatore (`shaper`) sta nello stesso gruppo, dopo la Forma parametrica,
e funziona come in VectorCraft. Un tratto a mano che somiglia a una forma
diventa quella forma pulita: rettangolo, ellisse, poligono o linea. Uno
scarabocchio sopra le forme le cambia:
- su una forma sola la toglie;
- su più forme le unisce, col colore di quella dove parte;
- su un gruppo del Sagomatore ne toglie o ne unisce le facce.

Le forme toccate finiscono in un gruppo del Sagomatore. Il file lo tiene come un
solo elemento, con la ricetta del disegno; dentro ci sono le forme di partenza,
trasparenti, e i pezzi che si vedono. Riaperto il file, il gruppo si scarabocchia
ancora. Un altro programma vede i pezzi come forme normali. Un clic sceglie una
faccia del gruppo; il doppio clic sceglie la forma di partenza sotto il
puntatore e passa alla Selezione. Mancano ancora i comandi del menu Oggetto ›
Shaper: rilascia, espandi e togli dal gruppo.

Il doppio clic funziona come in VectorCraft con ogni strumento del motore: con
la Selezione su un testo passa allo strumento Testo.

Il Generatore forme (`shapeBuilder`, T13 giro 7) unisce le forme scelte: il
trascinamento sulle regioni che toccano le unisce in un solo tracciato, e con
Alt toglie le regioni toccate. Servono due o più oggetti, tracciati, forme
composte o gruppi di tracciati: un'immagine o un testo non entrano, e un oggetto
bloccato spegne il gesto. Le regioni che il motore calcola si mostrano come aree
evidenziate mentre si trascina.

La Pittura dinamica funziona come in VectorCraft. Nella stessa casella del
Generatore forme ci sono due strumenti:
- il Secchiello pittura dinamica (`livePaintBucket`) colora col riempimento
  di Fub la faccia sotto il clic; sui tracciati scelti li fa prima diventare
  un gruppo vivo. Alt prende il colore della faccia; i bordi si colorano con
  l'opzione dello strumento per i contorni (`paintStrokes`);
- la Selezione pittura dinamica (`livePaintSelection`) sceglie una faccia con
  un clic (Maiusc la aggiunge) e quelle toccate con un trascinamento. Una
  faccia scelta si colora dal pannello del colore. I bordi non si scelgono
  ancora come oggetti del file.

Il menu Oggetto offre «Crea», «Unisci», «Rilascia», «Espandi» e «Opzioni
spazi vuoti». La finestra delle opzioni parte da quelle del gruppo scelto:
rileva gli spazi, fin dove il colore si ferma (spazi piccoli 3 pt, medi 6,
grandi 12, o i punti scritti fino a 72), il colore che li mostra e «Chiudi gli
spazi con tracciati», che aggiunge una linea senza colore su ogni spazio. Il
gruppo vivo va nel file con la ricetta, opzioni comprese: riaperto, si dipinge
ancora; un altro programma vede le facce e i bordi come forme normali. Manca
ancora la vista che mostra gli spazi vuoti.

La sezione «Allinea», nella scheda Design dell'ispettore, offre gli allineamenti
e le distribuzioni del motore. Alla selezione servono due oggetti; con «alla
tavola» ne basta uno per allineare. Un pulsante spento dice perché. La famiglia
`trasforma` si carica al primo clic di un pulsante, non prima.
